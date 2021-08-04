const path = require('path');
const fse = require('fs-extra');
const fetch = require('node-fetch');
const fs = require('fs');

const core = require('@actions/core');
const artifact = require('@actions/artifact');
const {
    context,
    getOctokit,
} = require('@actions/github');

const utils = require('./get-meta-info');

const MESSAGE_PREFIX_NEXT = '#Assign next';
const MESSAGE_PREFIX_PREVIOUS = '#Assign previous';
const ARTIFACT_NAME = 'project-recognition';
const PATH = '.';
const ZIP_FILE_NAME = `${PATH}/${ARTIFACT_NAME}.zip`;

/** @type {ArtifactData} */
const DEFAULT_ARTIFACT = {
    level: 0,
    labels: [],
    reviewers: [],
};

(async () => {
    const github_token = core.getInput('token', {required: true});
    const labelFilename = core.getInput('label_filename', {required: true});
    const ownersFilename = core.getInput('owners_filename', {required: true});
    const ignoreFiles = core.getMultilineInput('ignore_files', {required: true});
    const branch = core.getInput('branch', {required: true});
    let workflowFilename = core.getInput('workflow_filename', {required: true}).split('/');
    workflowFilename = workflowFilename[workflowFilename.length - 1];

    core.info(branch);

    const octokit = getOctokit(github_token);

    /**
     * @returns {Promise<ArtifactData>}
     */
    const getArtifact = async () => {
        const {repo} = context;

        // https://docs.github.com/en/actions/reference/environment-variables
        const workflowName = process.env.GITHUB_WORKFLOW;

        const workflowsResponse = await octokit.rest.actions.listRepoWorkflows({
            ...repo,
            per_page: 100,
        });

        const currentWorkflow = workflowsResponse.data.workflows.find((workflow) => {
            return workflow.name = workflowName;
        });

        let workflowRunsList;

        try {
            workflowRunsList = (await octokit.rest.actions.listWorkflowRuns({
                ...repo,
                workflow_id: workflowFilename,
                branch,
            })).data.workflow_runs.filter((run) => {
                return run.conclusion === 'success'
            });
        } catch (e) {
            core.info('listWorkflowRuns not found')
            return null;
        }

        if (workflowRunsList.length === 0) {
            core.info(`There are no successful workflow runs for workflow id: ${currentWorkflow.id} on the branch: ${branch}`);
            return null;
        }

        core.info(`workflow runs list total count: ${workflowRunsList.length}`);

        core.info(workflowRunsList.map((workflowRun) => workflowRun.id).toString());

        const latestRun = workflowRunsList.reduce((current, next) => {
           return new Date(current.created_at) > new Date(next.created_at) ? current : next;
        });

        const artifactsList = (await octokit.rest.actions.listWorkflowRunArtifacts({
            ...repo,
            run_id: latestRun.id,
        })).data;

        core.info(artifactsList.total_count);
        core.info(JSON.stringify(artifactsList.artifacts));
        core.info(typeof artifactsList.artifacts);

        if (artifactsList.total_count === 0) {
            core.info(`There are no artifacts for run id: ${latestRun.id}`);
            return null;
        }

        const desiredArtifact = artifactsList.artifacts.find((artifactFile) => artifactFile.name === ARTIFACT_NAME);

        if (!desiredArtifact) {
            core.info(`There are no artifacts with the name: ${ARTIFACT_NAME}`);
            core.info(`Other artifacts on the run are ${artifactsList.artifacts.map((artifactFile) => artifactFile.name)}`);
            return null;
        }

        // Download
        const res = await fetch(desiredArtifact.archive_download_url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/zip',
                Authorization: `Bearer ${github_token}`,
            },
        });

        // Save to Folder
        await new Promise((resolve, reject) => {
            const fileStream = fs.createWriteStream(ZIP_FILE_NAME);
            res.body.pipe(fileStream);
            res.body.on("error", (err) => {
                reject(err);
            });
            fileStream.on("finish", function() {
                core.info('finished');
                resolve();
            });
        });

        // Extract
        await utils.execWithCatch(`unzip -o -q ${ZIP_FILE_NAME} -d ${PATH}`);
        const folderFiles = await fse.readdir(PATH);
        core.info(`files list in ${PATH}: ${folderFiles}`);

        // Read
        return await fse.readJSON(`${PATH}/${ARTIFACT_NAME}.json`);
    };

    /**
     * @param {ArtifactData} artifactData
     * @returns {Promise<void>}
     */
    const uploadArtifact = async (artifactData) => {
        core.info(`uploading artifact: ${JSON.stringify(artifactData)}`);
        await fse.writeJSON(`${PATH}/${ARTIFACT_NAME}.json`, artifactData);
        const artifactClient = artifact.create();
        await artifactClient.uploadArtifact(ARTIFACT_NAME, [`${ARTIFACT_NAME}.json`], PATH, {continueOnError: false});
    };

    /**
     * @param {number} pull_number
     * @returns {string[]}
     */
    const getChangedFiles = async (pull_number) => {
        const listFilesOptions = octokit.rest.pulls.listFiles.endpoint.merge({
            ...context.repo,
            pull_number,
        });

        const listFilesResponse = await octokit.paginate(listFilesOptions);

        core.info("Changed files:");
        const changedFiles = listFilesResponse.map((file) => {
            core.info(` - ${file.filename}`);

            // @see https://docs.github.com/en/actions/reference/environment-variables
            return path.join(process.env.GITHUB_WORKSPACE, file.filename);
        });

        return utils.filterChangedFiles(changedFiles, ignoreFiles)
    };

    /**
     * @param {AssignReviewersData} data
     * @returns {Promise<string[]>}
     */
    const assignReviewers = async ({
        changedFiles,
        pullRequest,
        isComment,
        artifactData,
    }) => {
        core.startGroup('Reviewers');
        core.info(`files: ${changedFiles}`);
        const {repo} = context;

        const createdBy = pullRequest.user.login;

        /** @type {string[]} */
        let reviewersOnPr = [];

        const requestedReviewers = (await octokit.rest.pulls.listRequestedReviewers({
            ...repo,
            pull_number: pullRequest.number,
        })).data;

        if (requestedReviewers.users) {
            reviewersOnPr = requestedReviewers.users.map((user) => {
                return user.login;
            });
        }

        // get reviewers
        let reviewersFiles = await utils.getMetaFiles(changedFiles, ownersFilename, artifactData.level);

        if (!reviewersFiles.length <= 0) {
            core.info('assigning the repo Owners');
            reviewersFiles = [ownersFilename];
        }

        const reviewersFromFiles = await utils.getMetaInfoFromFiles(reviewersFiles);

        const reviewersToRemove = artifactData.reviewers.filter((reviewer) => {
            return !reviewersFromFiles.includes(reviewer);
        });

        const reviewersToAdd = reviewersFromFiles.filter((reviewer) => {
            return !reviewersOnPr.includes(reviewer) && createdBy !== reviewer;
        });

        core.info(`Reviewers assigned to pull-request: ${reviewersOnPr}`);
        core.info(`Reviewers which were assigned by the action: ${artifactData.reviewers}`);
        core.info(`Reviewers to remove: ${reviewersToRemove}`);
        core.info(`Reviewers to add: ${reviewersToAdd}`);

        const queue = [];

        if (reviewersToRemove.length > 0) {
            queue.push(octokit.rest.pulls.removeRequestedReviewers({
                ...repo,
                pull_number: pullRequest.number,
                reviewers: reviewersToRemove,
            }))
        }

        if (reviewersToAdd.length > 0) {
            queue.push(octokit.rest.pulls.requestReviewers({
                ...repo,
                pull_number: pullRequest.number,
                reviewers: reviewersToAdd,
            }));
        }

        if (reviewersToAdd.length > 0 || reviewersToRemove.length > 0 || isComment) {
            const filesText = reviewersFiles.map((file) => {
                return `* \`${file}\``;
            }).join('\n');
            queue.push(octokit.rest.issues.createComment({
                ...repo,
                issue_number: pullRequest.number,
                body: `Found ${reviewersFiles.length} filenames matching: \`${ownersFilename}\` pattern!\n${filesText}`,
            }));
        }

        if (queue.length > 0) {
            await Promise.all(queue);
        }

        core.endGroup();

        return reviewersFromFiles;
    };

    /**
     * @param {AutoLabelData} data
     * @returns {Promise<string[]>}
     */
    const autoLabel = async ({
        changedFiles,
        pullRequest,
        artifactData,
    }) => {
        core.startGroup('Auto label');
        const {repo} = context;

        // get the current labels on the pull-request
        const labelsOnPr = (await octokit.rest.issues.listLabelsOnIssue({
            ...repo,
            issue_number: pullRequest.number,
        })).data.map((label) => {
            if (label) {
                return label.name;
            }
        });

        const labeledByTheAction = artifactData.labels;

        // get labels
        const labelsFiles = await utils.getMetaFiles(changedFiles, labelFilename, 0);
        const labelsFromFiles = await utils.getMetaInfoFromFiles(labelsFiles);

        const labelsToRemove = labeledByTheAction.filter((label) => {
            return !labelsFromFiles.includes(label);
        });

        const labelsToAdd = labelsFromFiles.filter((label) => {
            return !labelsOnPr.includes(label);
        });

        core.info(`Labels assigned to pull-request: ${labelsOnPr}`);
        core.info(`Labels which were added by the action: ${labeledByTheAction}`);
        core.info(`Labels to remove: ${labelsToRemove}`);
        core.info(`Labels to add: ${labelsToAdd}`);

        const queue = [];

        // add labels
        if (labelsToAdd.length > 0) {
            queue.push(octokit.rest.issues.addLabels({
                ...repo,
                issue_number: pullRequest.number,
                labels: labelsToAdd,
            }));
        }

        // remove labels
        if (labelsToRemove.length > 0) {
            queue.push(...labelsToRemove.map(async (label) => {
                return await octokit.rest.issues.removeLabel({
                    ...repo,
                    issue_number: pullRequest.number,
                    name: label,
                });
            }));
        }

        if (queue.length > 0) {
            await Promise.all(queue);
        }

        core.endGroup();

        return labelsFromFiles;
    };

    /**
     * @param {PullRequestHandlerData} data
     */
    const pullRequestHandler = async ({
        changedFiles,
        pullRequest,
        artifactData,
    }) => {
        const labels = await autoLabel({
            changedFiles,
            pullRequest,
            artifactData,
        });
        const reviewers = await assignReviewers({
            changedFiles: utils.filterChangedFiles(changedFiles, ignoreFiles),
            pullRequest,
            artifactData,
        });

        return {
            labels,
            reviewers,
        }
    };

    core.startGroup('Debug');
    core.info(Object.keys(context.payload).toString());
    core.endGroup();

    const {
        pull_request,
        issue,
        comment,
    } = context.payload;

    // Works only on pull-requests or comments
    if (!pull_request && !comment) {
        core.error('Only pull requests events or comments can trigger this action');
    }

    const pullRequest = pull_request || issue;

    /** @type {[string[], ArtifactData]} */
    let [changedFiles, artifactData] = await Promise.all([
        getChangedFiles(pullRequest.number),
        getArtifact(),
    ]);

    core.info(`changed Files after Filter: ${JSON.stringify(changedFiles)}`);

    artifactData = {
        ...artifactData,
        ...DEFAULT_ARTIFACT
    };

    core.info(`artifact: ${JSON.stringify(artifactData)}`);

    if (pull_request) {
        const handlerData = await pullRequestHandler({
            changedFiles,
            pullRequest,
            artifactData,
        });

        core.info(JSON.stringify(handlerData));

        artifactData = {
            ...artifactData,
            ...handlerData
        }

        core.info(JSON.stringify(artifactData));
    }

    if (comment) {
        const message = comment.body;
        core.info(JSON.stringify(comment));

        if (message.includes(MESSAGE_PREFIX_NEXT) || message.includes(MESSAGE_PREFIX_PREVIOUS)) {

            artifactData.level = artifactData.level + (message.includes(MESSAGE_PREFIX_NEXT) ? 1 : -1);

            artifactData.reviewers = await assignReviewers({
                changedFiles,
                pullRequest,
                isComment: true,
                artifactData,
            });
        }
    }


    await uploadArtifact(artifactData);
})().catch((error) => {
    core.setFailed(error);
    process.exit(1);
});

/**
 * @typedef {Object} PullRequestHandlerData
 * @prop {string[]} changedFiles
 * @prop {PullRequest} pullRequest
 * @prop {ArtifactData} artifactData
 * @prop {boolean} [isComment]
 */

/**
 * @typedef {Object} PullRequest
 * @prop {number} number
 * @prop {User} user
 */

/**
 * @typedef {Object} User
 * @prop {string} login
 */

/**
 * @typedef {Object} ArtifactData
 * @prop {string[]} labels
 * @prop {string[]} reviewers
 * @prop {Record<string, string[]>} [ownerFilesReviewersMap]
 * @prop {number} level
 */

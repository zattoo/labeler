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

const ARTIFACT_NAME = 'project-recognition';
const PATH = '.';
const ZIP_FILE_NAME = `${PATH}/${ARTIFACT_NAME}.zip`;
const PATH_PREFIX = process.env.GITHUB_WORKSPACE;

/** @type {ArtifactData} */
const DEFAULT_ARTIFACT = {
    labels: [],
    reviewers: {},
};

(async () => {
    const github_token = core.getInput('token', {required: true});
    const labelFilename = core.getInput('label_filename', {required: true});
    const ownersFilename = core.getInput('owners_filename', {required: true});
    const ignoreFiles = core.getMultilineInput('ignore_files', {required: true});
    let workflowFilename = core.getInput('workflow_filename', {required: true}).split('/');
    workflowFilename = workflowFilename[workflowFilename.length - 1];

    const octokit = getOctokit(github_token);

    /**
     * @returns {Promise<ArtifactData>}
     */
    const getArtifact = async () => {
        const {repo} = context;
        const branch = process.env.GITHUB_HEAD_REF;
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
            return path.join(PATH_PREFIX, file.filename);
        });

        return utils.filterChangedFiles(changedFiles, ignoreFiles)
    };

    /**
     * @param {PullRequestHandlerData} data
     * @returns {Promise<OwnersMap>}
     */
    const assignReviewers = async ({
        changedFiles,
        pull_request,
        artifactData,
    }) => {
        core.startGroup('Reviewers');
        core.info(`files: ${changedFiles}`);
        const {repo} = context;

        const createdBy = pull_request.user.login;

        /** @type {string[]} */
        let reviewersOnPr = [];

        const requestedReviewers = (await octokit.rest.pulls.listRequestedReviewers({
            ...repo,
            pull_number: pull_request.number,
        })).data;

        if (requestedReviewers.users) {
            reviewersOnPr = requestedReviewers.users.map((user) => {
                return user.login;
            });
        }

        // get reviewers
        let reviewersFiles = await utils.getMetaFiles(changedFiles, ownersFilename);

        if (reviewersFiles.length <= 0) {
            core.info('assigning the repo Owners');
            reviewersFiles = [ownersFilename];
        }

        const reviewersMap = await utils.getMetaInfoFromFiles(reviewersFiles);
        const ownersMap = utils.getOwnersMap(reviewersMap, changedFiles, createdBy);
        const reviewersFromFiles = Object.keys(ownersMap);
        const artifactReviewers = Object.keys(artifactData.reviewers);

        const reviewersToRemove = artifactReviewers.filter((reviewer) => {
            return !reviewersFromFiles.includes(reviewer);
        });

        const reviewersToAdd = reviewersFromFiles.filter((reviewer) => {
            return !reviewersOnPr.includes(reviewer) && createdBy !== reviewer;
        });

        core.info(`Reviewers assigned to pull-request: ${reviewersOnPr}`);
        core.info(`Reviewers which were assigned by the action: ${artifactReviewers}`);
        core.info(`Reviewers to remove: ${reviewersToRemove}`);
        core.info(`Reviewers to add: ${reviewersToAdd}`);

        const queue = [];

        if (reviewersToRemove.length > 0) {
            queue.push(octokit.rest.pulls.removeRequestedReviewers({
                ...repo,
                pull_number: pull_request.number,
                reviewers: reviewersToRemove,
            }))
        }

        if (reviewersToAdd.length > 0) {
            queue.push(octokit.rest.pulls.requestReviewers({
                ...repo,
                pull_number: pull_request.number,
                reviewers: reviewersToAdd,
            }));
        }

        if (reviewersToAdd.length > 0 || reviewersToRemove.length > 0) {
            queue.push(octokit.rest.issues.createComment({
                ...repo,
                issue_number: pull_request.number,
                body: utils.createReviewersComment(ownersMap, PATH_PREFIX)
            }));
        }

        if (queue.length > 0) {
            await Promise.all(queue);
        }

        core.endGroup();

        return ownersMap;
    };

    /**
     * @param {PullRequestHandlerData} data
     * @returns {Promise<string[]>}
     */
    const autoLabel = async ({
        changedFiles,
        pull_request,
        artifactData,
    }) => {
        core.startGroup('Auto label');
        const {repo} = context;

        // get the current labels on the pull-request
        const labelsOnPr = (await octokit.rest.issues.listLabelsOnIssue({
            ...repo,
            issue_number: pull_request.number,
        })).data.map((label) => {
            if (label) {
                return label.name;
            }
        });

        const labeledByTheAction = artifactData.labels;

        // get labels
        const labelsFiles = await utils.getMetaFiles(changedFiles, labelFilename);
        const labelsMap = await utils.getMetaInfoFromFiles(labelsFiles);
        const labelsFromFiles = [...new Set(Object.values(labelsMap).flat())];

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
                issue_number: pull_request.number,
                labels: labelsToAdd,
            }));
        }

        // remove labels
        if (labelsToRemove.length > 0) {
            queue.push(...labelsToRemove.map(async (label) => {
                return await octokit.rest.issues.removeLabel({
                    ...repo,
                    issue_number: pull_request.number,
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
        pull_request,
        artifactData,
    }) => {
        const labels = await autoLabel({
            changedFiles,
            pull_request,
            artifactData,
        });

        const reviewers = await assignReviewers({
            changedFiles,
            pull_request,
            artifactData,
        });

        return {
            labels,
            reviewers,
        }
    };

    core.startGroup('Debug');
    core.info(Object.keys(context).toString());
    core.info(Object.keys(context.payload).toString());
    core.endGroup();

    const {pull_request} = context.payload;

    /** @type {[string[], ArtifactData]} */
    let [changedFiles, artifactData] = await Promise.all([
        getChangedFiles(pull_request.number),
        getArtifact(),
    ]);

    core.info(`changed Files after Filter: ${JSON.stringify(changedFiles)}`);

    artifactData = {
        ...DEFAULT_ARTIFACT,
        ...artifactData,
    };

    core.info(`artifact: ${JSON.stringify(artifactData)}`);

    switch (context.eventName) {
        case 'pull_request': {

            const handlerData = await pullRequestHandler({
                changedFiles,
                pull_request,
                artifactData,
            });

            core.info(JSON.stringify(handlerData));

            artifactData = {
                ...artifactData,
                ...handlerData
            }

            core.info(JSON.stringify(artifactData));
            await uploadArtifact(artifactData);
            break;
        }

        case 'pull_request_review': {
            const {
                review,
            } = context.payload.sender;

            const reviewers = Object.keys(artifactData.reviewers);
            const {repo} = context;

            const isCodeOwner = reviewers.includes(review.user.login);

            core.info(review.state);

            if (!isCodeOwner && review.state === 'approved') {
                await octokit.rest.issues.createComment({
                    ...repo,
                    issue_number: pull_request.number,
                    body: `${review.user.login} is not a Codeowner of the changed files in this PR, not gonna approve`,
                });

                return;
            }

            if (isCodeOwner && review.state === 'approved') {
                const allReviewers = await octokit.rest.pulls.listReviews({
                    ...repo,
                    pull_number: pull_request.number,
                });

                core.info(JSON.stringify(allReviewers));

                if (artifactData.reviewers[review.user.login].ownedFiles.length === changedFiles.length) {
                    await octokit.rest.issues.createComment({
                        ...repo,
                        issue_number: pull_request.number,
                        body: `${review.user.login} own all the files, we shall approve this`,
                    });
                }
            }

            break;
        }

        default: {
            core.error('Only pull requests events or reviews can trigger this action');
        }
    }
})().catch((error) => {
    core.setFailed(error);
    process.exit(1);
});

/**
 * @typedef {Object} PullRequestHandlerData
 * @prop {string[]} changedFiles
 * @prop {PullRequest} pull_request
 * @prop {ArtifactData} artifactData
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
 * @prop {OwnersMap} reviewers
 */


/** @typedef {import('./get-meta-info').OwnersMap} OwnersMap */

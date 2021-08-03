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
const reviewersLevels = require('./reveiwers-levels');

const MESSAGE_PREFIX = '#Assign';
const ARTIFACT_NAME = 'project-recognition';
const PATH = '.';


(async () => {
    /**
     * @param {InstanceType<typeof GitHub>} octokit
     * @param {string} workflowFilename
     * @param {string} github_token
     * @returns {Promise<ArtifactData>}
     */
    const getArtifact = async (octokit, workflowFilename, github_token) => {
        const {repo} = context;

        // https://docs.github.com/en/actions/reference/environment-variables
        const workflowName = process.env.GITHUB_WORKFLOW;
        // todo does it work for issues comment?
        const branch = process.env.GITHUB_HEAD_REF;

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

        core.info(`latest successful run: ${JSON.stringify(latestRun)}`);

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


        const ZIP_FILE_NAME = `${PATH}/${ARTIFACT_NAME}.zip`;

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
        const artifactData = await fse.readJSON(`${PATH}/${ARTIFACT_NAME}.json`);

        core.info(`artifact data: ${artifactData}`);

        return artifactData;
    };

    /**
     * @param {ArtifactData} artifactInfo
     * @returns {Promise<void>}
     */
    const uploadArtifact = async (artifactInfo) => {
        core.info('writing file');
        await fse.writeJSON(`${PATH}/${ARTIFACT_NAME}.json`, artifactInfo);
        core.info('wrote file');

        const artifactClient = artifact.create();

        const folderFiles = await fse.readdir(PATH);
        core.info(`files list in ${PATH}: ${folderFiles}`);

        const uploadResponse = await artifactClient.uploadArtifact(ARTIFACT_NAME, [`${ARTIFACT_NAME}.json`], PATH, {continueOnError: false});

        core.info(JSON.stringify(uploadResponse));
    };

    /**
     * @param {InstanceType<typeof GitHub>} octokit
     * @param {number} pull_number
     * @returns {string[]}
     */
    const getChangedFiles = async (octokit, pull_number) => {
        const {repo} = context;
        const listFilesOptions = octokit.rest.pulls.listFiles.endpoint.merge({
            ...repo,
            pull_number,
        });

        const listFilesResponse = await octokit.paginate(listFilesOptions);

        core.info("Changed files:");
        const changedFiles = listFilesResponse.map((file) => {
            core.info(` - ${file.filename}`);

            // @see https://docs.github.com/en/actions/reference/environment-variables
            return path.join(process.env.GITHUB_WORKSPACE, file.filename);
        });

        return changedFiles;
    };

    /**
     *  Get the user which the token belongs to
     *  if no user found we fallback to 'github-actions'
     * @param {InstanceType<typeof GitHub>} octokit
     * @returns {string}
     */
    const getUser = async (octokit) => {
        let user = 'github-actions';

        try {
            const auth = await octokit.rest.users.getAuthenticated();
            user =  auth.data.login;
        } catch (e) {
            core.info('Failed to get the authenticated user will fallback to github-actions');
        }

        return user;
    };

    /**
     * @param {AssignReviewersData} data
     * @returns {Promise<void>}
     */
    const assignReviewers = async ({
        octokit,
        user,
        ownersFilename,
        changedFiles,
        pullRequest,
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

        // get the reviewers request history on the pull-request
        const query = await octokit.graphql(`{
            repository(owner: "${repo.owner}", name: "${repo.repo}") {
                pullRequest(number: ${pullRequest.number}) {
                    timelineItems(last: 100, itemTypes: [REVIEW_REQUESTED_EVENT]) {
                        totalCount
                        edges {
                            node {
                                __typename
                                 ... on ReviewRequestedEvent {
                                    createdAt
                                    actor {
                                        login
                                    }
                                    requestedReviewer {
                                        ... on User {
                                            login
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }`);

        /** @type {ReviewerInfo[]} */
        const reviewersInfo = query.repository.pullRequest.timelineItems.edges || [];

        core.info('now reviewers info');

        // reducing the query to labels only
        const assignedByTheAction = reviewersInfo.reduce((acc, reviewerEvent) => {
            const {login} = reviewerEvent.node.requestedReviewer;

            // If not included already, match github-actions actor and is currently used on the pull-request
            if (
                !acc.includes(login) &&
                reviewerEvent.node.actor.login === user &&
                reviewersOnPr.includes(login)
            ) {
                acc.push(login);
            }

            return acc;
        }, []);

        // get reviewers
        const reviewersFiles = await utils.getMetaFiles(changedFiles, ownersFilename);

        if (reviewersFiles.length <= 0) {
            await octokit.rest.issues.createComment({
                ...repo,
                issue_number: pullRequest.number,
                body: `No \`${ownersFilename}\` filenames were found 😟`,
            });

            return;
        }

        const reviewersFromFiles = await utils.getMetaInfoFromFiles(reviewersFiles);

        const reviewersToRemove = assignedByTheAction.filter((reviewer) => {
            return !reviewersFromFiles.includes(reviewer);
        });

        const reviewersToAdd = reviewersFromFiles.filter((reviewer) => {
            return !reviewersOnPr.includes(reviewer) && createdBy !== reviewer;
        });

        core.info(`Reviewers assigned to pull-request: ${reviewersOnPr}`);
        core.info(`Reviewers which were assigned by the action: ${assignedByTheAction}`);
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

            const filesText = reviewersFiles.map((file) => `* \`${file}\``).join('\n');
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
        octokit,
        user,
        labelFilename,
        changedFiles,
        pullRequest,
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

        // get the labels history on the pull-request
        const query = await octokit.graphql(`{
            repository(owner: "${repo.owner}", name: "${repo.repo}") {
                pullRequest(number: ${pullRequest.number}) {
                    timelineItems(last: 100, itemTypes: [LABELED_EVENT]) {
                        totalCount
                        edges {
                            node {
                                __typename
                                ... on LabeledEvent {
                                    createdAt
                                    label {
                                        name
                                    }
                                    actor {
                                        login
                                    }
                                }
                            }
                        }
                    }
                 }
            }
        }`);

        /** @type {LabelInfo[]} */
        const labelsInfo = query.repository.pullRequest.timelineItems.edges || [];

        // reducing the query to labels only
        const labeledByTheAction = labelsInfo.reduce((acc, labelInfo) => {
            const {name} = labelInfo.node.label;

            // If not included already, match github-actions actor and is currently used on the pull-request
            if (
                !acc.includes(name) &&
                labelInfo.node.actor.login === user &&
                labelsOnPr.includes(name)
            ) {
                acc.push(name);
            }

            return acc;
        }, []);


        // get labels
        const labelsFiles = await utils.getMetaFiles(changedFiles, labelFilename);
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
        octokit,
        user,
        labelFilename,
        ownersFilename,
        ignoreFiles,
        changedFiles,
        pullRequest,
    }) => {
        const labels = await autoLabel({
            octokit,
            user,
            labelFilename,
            changedFiles,
            pullRequest,
        });
        const reviewers = await assignReviewers({
            octokit,
            user,
            ownersFilename,
            changedFiles: utils.filterChangedFiles(changedFiles, ignoreFiles),
            pullRequest,
        });

        return {
            labels,
            reviewers,
        }
    };

    const github_token = core.getInput('token', {required: true});
    const labelFilename = core.getInput('label_filename', {required: true});
    const ownersFilename = core.getInput('owners_filename', {required: true});
    const ignoreFiles = core.getMultilineInput('ignore_files', {required: true});
    let workflowFilename = core.getInput('workflow_filename', {required: true}).split('/');
    workflowFilename = workflowFilename[workflowFilename.length - 1];

    const octokit = getOctokit(github_token);

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

    const [changedFiles, user, previousArtifact] = await Promise.all([
        getChangedFiles(octokit, pullRequest.number),
        getUser(octokit),
        getArtifact(octokit, workflowFilename, github_token),
    ]);

    core.info(`previous Artifact ${JSON.stringify(previousArtifact)}`);

    /** @type {ArtifactData} */
    let currentArtifact = {
        level: 0,
        labels: [],
        reviewers: [],
    };

    core.info(`Token user: ${user}`);

    if (pull_request) {
        const handlerData = await pullRequestHandler({
            octokit,
            user,
            labelFilename,
            ownersFilename,
            ignoreFiles,
            changedFiles,
            pullRequest: pull_request,
        });

        core.info(JSON.stringify(handlerData));

        currentArtifact = {
            ...currentArtifact,
            ...handlerData
        }

        core.info(JSON.stringify(currentArtifact));
    }

    if (comment) {
        core.info('me here yeay');
        const message = comment.body;
        const level = Object.values(reviewersLevels).find((reviewerLevel) => message.includes(reviewerLevel));

        if (
            message.includes(MESSAGE_PREFIX)
            && Boolean(level)
        ) {
            core.info(`pullRequestKeys ${Object.keys(pullRequest)}`);

            await assignReviewers({
                octokit,
                user,
                ownersFilename,
                changedFiles: utils.reduceFilesToLevel(utils.filterChangedFiles(changedFiles, ignoreFiles), level),
                pullRequest: pullRequest,
            });
        }
    }

    await uploadArtifact(currentArtifact);
})().catch((error) => {
    core.setFailed(error);
    process.exit(1);
});

/**
 * @typedef {Object} PullRequestHandlerData
 * @prop {InstanceType<typeof GitHub>} octokit
 * @prop {string[]} changedFiles
 * @prop {string} user
 * @prop {string} labelFilename
 * @prop {string} ownersFilename
 * @prop {string[]} ignoreFiles
 * @prop {PullRequest} pullRequest
 */

/**
 * @typedef {Omit<PullRequestHandlerData, 'ownersFilename' | 'ignoreFiles'>} AutoLabelData
 */

/**
 * @typedef {Omit<PullRequestHandlerData, 'ignoreFiles'>} AssignReviewersData
 */

/**
 * @typedef {Object} ReviewerInfo
 * @prop {ReviewerNode} node
 */

/**
 * @typedef {Object} ReviewerNode
 * @prop {string} __typename
 * @prop {string} createdAt
 * @prop {Actor} actor
 * @prop {Actor} requestedReviewer
 */

/**
 * @typedef {Object} LabelInfo
 * @prop {LabelNode} node
 */

/**
 * @typedef {Object} LabelNode
 * @prop {string} __typename
 * @prop {string} createdAt
 * @prop {Label} label
 * @prop {Actor} actor
 */

/**
 * @typedef {Object} Actor
 * @prop {string} login
 */

/**
 * @typedef {Object} Label
 * @prop {string} name
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

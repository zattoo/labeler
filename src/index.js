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

    const {repo} = context;
    const {pull_request} = context.payload;
    const pull_number = pull_request.number;
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

        const latestRun = workflowRunsList.reduce((current, next) => {
           return new Date(current.created_at) > new Date(next.created_at) ? current : next;
        });

        const artifactsList = (await octokit.rest.actions.listWorkflowRunArtifacts({
            ...repo,
            run_id: latestRun.id,
        })).data;

        if (artifactsList.total_count === 0) {
            core.info(`There are no artifacts for run id: ${latestRun.id}`);
            return null;
        }

        const desiredArtifact = artifactsList.artifacts.find((artifactFile) => artifactFile.name === ARTIFACT_NAME);

        if (!desiredArtifact) {
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

        // Read
        return await fse.readJSON(`${PATH}/${ARTIFACT_NAME}.json`);
    };

    /**
     * @param {ArtifactData} artifactData
     * @returns {Promise<void>}
     */
    const uploadArtifact = async (artifactData) => {
        core.info('uploading artifact');
        await fse.writeJSON(`${PATH}/${ARTIFACT_NAME}.json`, artifactData);
        const artifactClient = artifact.create();
        await artifactClient.uploadArtifact(ARTIFACT_NAME, [`${ARTIFACT_NAME}.json`], PATH, {continueOnError: false});
    };

    /**
     * @returns {string[]}
     */
    const getChangedFiles = async () => {
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
     * @param {string} createdBy
     * @param {string[]} changedFiles
     */
    const getCodeOwners = async (createdBy, changedFiles) => {
        let reviewersFiles = await utils.getMetaFiles(changedFiles, ownersFilename);

        if (reviewersFiles.length <= 0) {
            reviewersFiles = [ownersFilename];
        }

        const reviewersMap = await utils.getMetaInfoFromFiles(reviewersFiles);

        const ownersMap = utils.getOwnersMap(reviewersMap, changedFiles, createdBy);
        return ownersMap;
    };

    /**
     * @param {OwnersMap} reviewersByTheAction
     * @param {OwnersMap} codeowners
     * @param {string[]} reviewers
     * @returns {Promise<OwnersMap>}
     */
    const assignReviewers = async (reviewersByTheAction, codeowners, reviewers) => {
        core.startGroup('Assign Reviewers');
        const {repo} = context;

        /** @type {string[]} */
        let reviewersOnPr = [];

        const requestedReviewers = (await octokit.rest.pulls.listRequestedReviewers({
            ...repo,
            pull_number,
        })).data;

        if (requestedReviewers.users) {
            reviewersOnPr = requestedReviewers.users.map((user) => {
                return user.login;
            });
        }

        reviewersOnPr = [...new Set(reviewersOnPr, reviewers)];

        const reviewersFromFiles = Object.keys(codeowners);
        const artifactReviewers = Object.keys(reviewersByTheAction);

        const reviewersToRemove = artifactReviewers.filter((reviewer) => !reviewersFromFiles.includes(reviewer));
        const reviewersToAdd = reviewersFromFiles.filter((reviewer) => !reviewersOnPr.includes(reviewer));

        core.info(`Reviewers assigned to pull-request: ${reviewersOnPr}`);
        core.info(`Reviewers which were assigned by the action: ${artifactReviewers}`);
        core.info(`Reviewers to remove: ${reviewersToRemove}`);
        core.info(`Reviewers to add: ${reviewersToAdd}`);

        const queue = [];

        if (reviewersToRemove.length > 0) {
            queue.push(octokit.rest.pulls.removeRequestedReviewers({
                ...repo,
                pull_number,
                reviewers: reviewersToRemove,
            }))
        }

        if (reviewersToAdd.length > 0) {
            queue.push(octokit.rest.pulls.requestReviewers({
                ...repo,
                pull_number,
                reviewers: reviewersToAdd,
            }));
        }

        if (reviewersToAdd.length > 0 || reviewersToRemove.length > 0) {
            queue.push(octokit.rest.issues.createComment({
                ...repo,
                pull_number,
                body: utils.createReviewersComment(codeowners, PATH_PREFIX)
            }));
        }

        if (queue.length > 0) {
            await Promise.all(queue);
        }

        core.endGroup();
    };

    /**
     * @param {string[]} changedFiles
     * @param {string[]} labeledByTheAction
     * @returns {Promise<string[]>}
     */
    const assignLabels = async (changedFiles, labeledByTheAction) => {
        core.startGroup('Assign Labels');
        const issue_number = pull_number;

        // get the current labels on the pull-request
        const labelsOnPr = (await octokit.rest.issues.listLabelsOnIssue({
            ...repo,
            issue_number,
        })).data.map((label) => {
            if (label) {
                return label.name;
            }
        });

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
                issue_number,
                labels: labelsToAdd,
            }));
        }

        // remove labels
        if (labelsToRemove.length > 0) {
            queue.push(...labelsToRemove.map(async (label) => {
                return await octokit.rest.issues.removeLabel({
                    ...repo,
                    issue_number,
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
     * @returns {Promise<Record<string, object>>}
     */
    const getReviewers = async () => {
        const allReviewersData = (await octokit.rest.pulls.listReviews({
            ...repo,
            pull_number,
        })).data;

        const latestReviews = {};

        allReviewersData.forEach((review) => {
            const user = review.user.login;
            const hasUserAlready = Boolean(latestReviews[user]);

            if (!hasUserAlready) {
                latestReviews[user] = review;
            } else if (review.submitted_at > latestReviews[user].submitted_at) {
                latestReviews[user] = review;
            }
        });

        return latestReviews;
    };

    /** @type {[string[], ArtifactData]} */
    let [
        changedFiles,
        artifactData,
        reviewers,
    ] = await Promise.all([
        getChangedFiles(),
        getArtifact(),
        getReviewers(),
    ]);

    const codeowners = await getCodeOwners(pull_request.user.login, changedFiles);

    artifactData = {
        ...DEFAULT_ARTIFACT,
        ...artifactData,
        reviewers: codeowners,
    };

    switch (context.eventName) {
        case 'pull_request': {
            const [labels]  = await assignLabels(changedFiles, artifactData.labels);
            await assignReviewers(artifactData.reviewers, codeowners, Object.keys(reviewers));

            artifactData = {
                ...artifactData,
                labels,
            }

            break;
        }

        case 'pull_request_review': {
            const approvers = Object.keys(reviewers).filter((reviewer) => {
                return reviewers[reviewer].state === 'APPROVED';
            });

            const allApprovedFiles = [...new Set(approvers.reduce((acc, approver) => {
                if(codeowners[approver]) {
                    acc.push(...codeowners[approver].ownedFiles);
                }
                return acc;
            }, []))];
            core.info(allApprovedFiles);

            const approvalRequiredFiles = changedFiles.filter((file) => {
               return !allApprovedFiles.includes(file);
            });

            if (approvalRequiredFiles.length > 0) {
                const [user] = await Promise.all([
                    octokit.rest.users.getAuthenticated(),
                    octokit.rest.issues.createComment({
                        ...repo,
                        issue_number: pull_request.number,
                        body: utils.createRequiredApprovalsComment(codeowners, approvalRequiredFiles,PATH_PREFIX),
                    }),
                ]);

                const approvedByTheCurrentUser = Boolean(reviewers[user]);

                core.info(JSON.stringify(user));

                if (approvedByTheCurrentUser) {
                    const review = reviewers[user];
                    await octokit.rest.pulls.dismissReview({
                        ...repo,
                        pull_number,
                        review_id: review.id,
                    });
                }
            } else {
                await octokit.rest.issues.createComment({
                    ...repo,
                    issue_number: pull_number,
                    body: 'looks good should approve',
                });

                await octokit.rest.pulls.createReview({
                    ...repo,
                    pull_number,
                    event: 'APPROVE',
                    body: 'all required approvals achieved, can merge now',
                });
            }

            break;
        }

        default: {
            core.error('Only pull requests events or reviews can trigger this action');
        }

        await uploadArtifact(artifactData);
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
 * @prop {OwnersMap} codeowners
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

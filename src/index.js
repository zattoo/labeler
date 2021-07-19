const path = require('path');
const core = require('@actions/core');
const {
    context,
    getOctokit,
} = require('@actions/github');
const utils = require('./get-meta-info');
const reviewersLevels = require('./reveiwers-levels');

const MESSAGE_PREFIX = '#Assign';


(async () => {
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

    const assignReviewers = async ({
        octokit,
        user,
        ownersFilename,
        changedFiles,
        pullRequest,
    }) => {
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
        const reviewersInfo = query.repository.pullRequest.timelineItems.edges;

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
    };

    /**
     * @param {AutoLabelData} data
     * @returns {Promise<void>}
     */
    const autoLabel = async ({
        octokit,
        user,
        labelFilename,
        changedFiles,
        pullRequest,
    }) => {
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
        const labelsInfo = query.repository.pullRequest.timelineItems.edges;

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
        core.info('-----------------------------------');

        await autoLabel({
            octokit,
            user,
            labelFilename,
            changedFiles,
            pullRequest,
        });

        core.info('-----------------------------------');

        await assignReviewers({
            octokit,
            user,
            ownersFilename,
            changedFiles: utils.filterChangedFiles(changedFiles, ignoreFiles),
            pullRequest,
        });
    };

    const github_token = core.getInput('token', {required: true});
    const labelFilename = core.getInput('label_filename', {required: true});
    const ownersFilename = core.getInput('owners_filename', {required: true});
    /** @type {string[]} */
    const ignoreFiles = core.getInput('ignore_files', {required: true}).split(' ');

    const octokit = getOctokit(github_token);
    const {
        pull_request,
        comment,
    } = context.payload;

    // Works only on pull-requests or comments
    if (!pull_request || comment) {
        core.error('Only pull requests events or comments can trigger this action');
    }

    const [changedFiles, user] = await Promise.all([
        getChangedFiles(octokit, pull_request.number),
        getUser(octokit),
    ]);
    core.info(`Token user: ${user}`);

    if (pull_request) {
        await pullRequestHandler({
            octokit,
            user,
            labelFilename,
            ownersFilename,
            ignoreFiles,
            changedFiles,
            pullRequest: pull_request,
        });
    }

    if (comment) {
        const message = comment.body;
        const level = Object.values(reviewersLevels).find((reviewerLevel) => message.includes(reviewerLevel));

        if (
            message.includes(MESSAGE_PREFIX)
            && Boolean(level)
        ) {
            const {number} = context.payload.issue;
            const {repo} = context;

            const pullRequest = await octokit.rest.pulls.get({
                ...repo,
                pull_number: number,
            });

            core.info(`pullRequestKeys ${Object.keys(pull_request)}`);

            await assignReviewers({
                octokit,
                user,
                ownersFilename,
                changedFiles: utils.reduceFilesToLevel(utils.filterChangedFiles(changedFiles, ignoreFiles), level),
                pullRequest,
            });
        }
    }
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
 */

/**
 * @typedef {Omit<PullRequestHandlerData, 'ownersFilename' | 'keepersFilename'>} AutoLabelData
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

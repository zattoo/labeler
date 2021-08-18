const path = require('path');
const core = require('@actions/core');
const {
    context,
    getOctokit,
} = require('@actions/github');
const glob = require('glob-promise');

const utils = require('./get-labels');


(async () => {
    /**
     * @param {InstanceType<typeof GitHub>} octokit
     * @param {number} pull_number
     * @returns {string[]}
     */
    const getChangedFiles = async (octokit, pull_number) => {
        core.startGroup('Changed Files');
        const {repo} = context;
        const listFilesOptions = octokit.rest.pulls.listFiles.endpoint.merge({
            ...repo,
            pull_number,
        });

        const listFilesResponse = await octokit.paginate(listFilesOptions);

        const changedFiles = listFilesResponse.map((file) => {
            core.info(` - ${file.filename}`);

            // @see https://docs.github.com/en/actions/reference/environment-variables
            return path.join(process.env.GITHUB_WORKSPACE, file.filename);
        });

        core.endGroup();

        return changedFiles;
    };

    const labelFilename = core.getInput('source', {required: true});
    const token = core.getInput('token', {required: true});

    const octokit = getOctokit(token);
    const {repo} = context;
    const {pull_request} = context.payload;

    core.info(`Label to search for: ${labelFilename}`);

    // Works only on pull-requests
    if (!pull_request) {
        core.error('Only pull requests events can trigger this action');
    }

    const changedFiles= await getChangedFiles(octokit, pull_request.number);

    // get the current labels on the pull-request
    const labelsOnPr = (await octokit.rest.issues.listLabelsOnIssue({
        ...repo,
        issue_number: pull_request.number,
    })).data.map((label) => {
        if (label) {
            return label.name;
        }
    });

    const [
        allLabelsFiles,
        labelFilesFromChanges,
    ] = await Promise.all([
        glob(`**/${labelFilename}`),
        utils.getLabelsFiles(changedFiles, labelFilename),
    ]);

    const [
        allLabels,
        labelsFromChanges,
    ] = await Promise.all([
        utils.getLabelsFromFiles(allLabelsFiles),
        utils.getLabelsFromFiles(labelFilesFromChanges),
    ]);

    core.startGroup('DEBUG');
    core.info(allLabelsFiles.toString());
    core.info(allLabels.toString());
    core.endGroup();

    const labelsToRemove = allLabels.filter((label) => {
        return labelsFromChanges.includes(label);
    });

    const labelsToAdd = labelsFromChanges.filter((label) => {
        return !allLabels.includes(label);
    });

    core.info(`labels assigned to pull-request: ${labelsOnPr}`);
    core.info(`labels which the action responsible for: ${allLabels}`);
    core.info(`labels to remove: ${labelsToRemove}`);
    core.info(`labels to add: ${labelsToAdd}`);

    // add labels
    if (labelsToAdd.length > 0) {
        await octokit.rest.issues.addLabels({
            ...repo,
            issue_number: pull_request.number,
            labels: labelsToAdd,
      });
    }

    // remove labels
    if (labelsToRemove.length > 0) {
        await Promise.all(labelsToRemove.map(async (label) => {
            return await octokit.rest.issues.removeLabel({
                ...repo,
                issue_number: pull_request.number,
                name: label,
            });
        }));
    }
})().catch((error) => {
    core.setFailed(error);
    process.exit(1);
});


/**
 * @typedef {Object} LabelInfo
 * @prop {Node} node
 */

/**
 * @typedef {Object} Node
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

const path = require('path');
const core = require('@actions/core');
const {context, getOctokit} = require('@actions/github');
const utils = require('./get-labels');


async function run() {
  try {
    const github_token = core.getInput('github_token', {required: true});
    const octokit = getOctokit(github_token);

    /**
     * Get changed files split them to array and add root path
     * @see https://docs.github.com/en/actions/reference/environment-variables
     */
    const changedFiles = core.getInput('changed_files', {required: true})
        .split(' ')
        .map((filePath) => {
          return path.join(process.env.GITHUB_WORKSPACE, filePath);
        });

    const labelFilename = core.getInput('label_filename', {required: true});

    const {repo} = context;
    const {pull_request} = context.payload;

    // Works only on pull-requests
    if(!pull_request) {
      core.error('Only pull requests events can trigger this action');
    }

    // get the current labels on the pull-request
    const labelsOnPr = (await octokit.rest.issues.listLabelsOnIssue({
      ...repo,
      issue_number: pull_request.number,
    })).data.map((label) => {
      if (label) {
        return label.name;
      }
    });

    // get the labels history on the pull-request
    const query = await octokit.graphql(`{
      repository(owner: "${repo.owner}", name: "${repo.repo}") {
        pullRequest(number: ${pull_request.number}) {
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
    const labelsByGithubAction = labelsInfo.reduce((acc, labelInfo) => {
      const {name} = labelInfo.node.label;

      if (
          !acc.includes(name) &&
          labelInfo.node.actor.login === 'github-actions' &&
          labelsOnPr.includes(name)
      ) {
        acc.push(name);
      }

      return acc;
    }, []);


    // get labels
    const labelsFiles = await utils.getLabelsFiles(changedFiles, labelFilename);
    const labelsFromFiles = await utils.getLabelsFromFiles(labelsFiles);

    const labelsToRemove = labelsByGithubAction.filter((label) => {
      return !labelsFromFiles.includes(label);
    });

    const labelsToAdd = labelsFromFiles.filter((label) => {
      return !labelsByGithubAction.includes(label);
    });

    core.info(`labelsOnPr: ${labelsOnPr}`);
    core.info(`labelsByGithubAction: ${labelsByGithubAction}`);
    core.info(`labelsToRemove: ${labelsToRemove}`);
    core.info(`labelsToAdd: ${labelsToAdd}`);

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
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();


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

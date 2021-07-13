const path = require('path');
const core = require('@actions/core');
const {context, getOctokit} = require('@actions/github');
const utils = require('./get-labels');


async function run() {
  try {

    const github_token = core.getInput('github_token', {required: true});
    const octokit = getOctokit(github_token);

    const changedFiles = core.getInput('changed_files', {required: true})
        .split(' ')
        .map((filePath) => {
          return path.join(process.env.GITHUB_WORKSPACE, filePath);
        });
    const filenameFlag = core.getInput('filename', {required: true});

    // Debug log the payload.
    core.info(`Payload keys: ${Object.keys(context.payload)}`);

    const {repo} = context;
    const {pull_request} = context.payload;

    core.info(Object.keys(pull_request));

    if(!pull_request) {
      core.error('Only pull requests events can trigger this action');
    }

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


    core.info(`labelsByGithubAction: ${JSON.stringify(labelsInfo)}`);

    const labelsByGithubAction = labelsInfo.reduce((acc, labelInfo) => {
      core.info(`actor name: ${labelInfo.node.actor.login}`);

      if (labelInfo.node.actor.login === 'github-actions') {
        acc.push(labelInfo.node.label.name);
      }

      return acc;
    }, []);

    core.info(`labelsByGithubAction: ${labelsByGithubAction}`);

    core.info(changedFiles);

    const labelsFiles = await utils.getLabelsFiles(changedFiles, filenameFlag);
    core.info(labelsFiles);

    const labelsFromFiles = await utils.getLabelsFromFiles(labelsFiles);
    core.info(labelsFromFiles);

    const labelsToRemove = labelsByGithubAction.filter((label) => {
      return !labelsFromFiles.includes(label);
    });

    const labelsToAdd = labelsFromFiles.filter((label) => {
      return !labelsByGithubAction.includes(label);
    });

    core.info(`labelsToRemove: ${labelsToRemove}`);
    core.info(`labelsToAdd: ${labelsToAdd}`);

    if (labelsToAdd.length > 0) {
      await octokit.rest.issues.addLabels({
        ...repo,
        issue_number: pull_request.number,
        labels: labelsToAdd,
      });
    }

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

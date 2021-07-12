const core = require('@actions/core');
const {context, getOctokit} = require('@actions/github');

async function run() {
  try {

    const github_token = core.getInput('github_token', {required: true});
    const octokit = getOctokit(github_token);

    const changedFiles = core.getInput('changed_files', {required: true});
    const filenameFlag = core.getInput('filename', {required: true});

    // Debug log the payload.
    core.debug(`Payload keys: ${Object.keys(context.payload)}`);

    const {
      event,
      repo,
    } = context;

    if(!event.number) {
      core.error('Only pull requests events can trigger this action');
    }

    const labelsByGithubAction = await octokit.graphql(`{
      repository(owner: "${repo.owner}", name: "${repo.repo}") {
        pullRequest(number: ${event.number}) {
          timelineItems(last: 100, itemTypes: [LABELED_EVENT]) {
          totalCount
          edges {
            node {
              __typename
              ... on LabeledEvent {
                actor
                createdAt
                label {
                  name
                }
              }
            }
          }
        }
      }     
    }`);

    core.debug(`labelsByGithubAction keys: ${labelsByGithubAction.toString()}`);

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

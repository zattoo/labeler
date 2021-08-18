# Labeler

GitHub Action to recognize areas in the code that were affected and label by metadata files

## Inputs

### `token`

`string`

Required. GitHub token

### `source`

`string`

Required. Filename which contain label metadata to look for

## Usage

### Metadata file
The metadata file contains list of labels separated by break-line between which should be assigned ot all sub-paths.
```yml
# name: projects/common/.labels
project:common
```

If the changed file was `projects/common/utils/time.js` the action will search for the closest `source` (e.g `.labels`)
In the current example `projects/common/.labels` is the closest one so all the labels listed in that file will be assigned.

### Workflow

````yaml
name: Project recognition
jobs:
    assign-labels:
        name: Assign labels
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v2
          - uses: zattoo/project-recognition@v1
            with:
              token: ${{github.token}}
              label_filename: '.labels'
````

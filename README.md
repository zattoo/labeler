# Project recognition

GitHub Action to recognize areas in the code that were affected and label by metadata files

## Inputs

### `token`

`string`

Required. GitHub token

### `label_filename`

`string`

Required. Filename which contain label metadata to look for

## Usage

### Metadata file
The metadata file contains list of labels separated by break-line between which should be assigned ot all sub-paths.
```yml
# name: projects/common/.labels
infrastrucrue
```

If the changed file was `projects/common/utils/time.js` the action will search for the closest `label_filename` (e.g `.labels`)
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
              token: ${{secrets.TOKEN}}
              label_filename: '.labels'
````

# Project recognition

GitHub Action to recognize areas in the code which were affected and labeling by meta-files

## Inputs

### `changed_files`

`string`

Required. A list of modified files in space-delimited string format

### `label_filename`

`string`

Filename which contain label metadata to look for

## Usage Example

````yaml
name: Project recognition
jobs:
    assign-labels:
        name: Assign labels
        runs-on: ubuntu-latest
        steps:
          - name: changed files
            id: changed-files
            uses: jitterbit/get-changed-files@v1
            with:
              format: space-delimited
          - uses: zattoo/project-recognition@v1
            with:
              changed_files: ${{steps.changed-files.outputs.all}}
              filename: '.labels'
````

{"mode":"full","isActive":false}

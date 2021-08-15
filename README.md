# Recognition

GitHub Action to recognize and label modified code areas.

## Inputs

### `token`

`string`

Required. GitHub token.

### `source`

`string`

Required. Label metadata filename

## Usage

### Metadata file

The metadata file contains list of labels separated by break-line between which should be assigned ot all sub-paths

```yml
# name: projects/common/.labels
common
```

If the changed file was `projects/common/utils/time.js` the action will search for the closest `source` (e.g `.labels`)
In the current example `projects/common/.labels` is the closest one so all the labels listed in that file will be assigned.

### Workflow

````yaml
name: Recognition
jobs:
    recognition:
        name: Recognition
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v2
          - uses: zattoo/recognition@v2
            with:
              token: ${{secrets.TOKEN}}
              source: '.labels'
````

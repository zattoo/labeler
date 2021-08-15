# Recognition

GitHub Action to recognize affected area based on changed files. Optionally outputs labels.

## Inputs

### `labels`

`'true' | 'false'`

Optional. Defines whether to output labels

Example: `'{"project": ["account", "app", "cast"]}'`

### `matrix`

`JSON string`

Optional. Matrix schema as JSON string.

Example: `'{"project": ["account", "app", "cast"]}'`

### `source`

`string`

Required. Label metadata filename

### `token`

`string`

Required. GitHub token.

## Output

Matrix in JSON format.

For example, there were changes under `project:app` and `project:account` labels, matrix output will be:

```
{
    "project": [
        "account",
        "app",
    ]
}
```

## Usage

### Metadata file

The metadata file contains list of labels separated by break-line between which should be assigned to all sub-paths

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

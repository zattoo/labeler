All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [3.0.0] - 10.09.2029

### Infrastructure
- `action.yml`: using: `node12` → using: `node24`
- added `.nvmrc` with `v24`
- `actions/checkout@v2` → `@v7` in CI workflows
- Updated packages in packages.json
- Rebuilt dist

## [2.0.0] - 18.08.2021

Renamed to `@zattoo/labeler`

### Added
- Detect responsibility on labels by collecting all labels from the source files on the repository

### Changed
- [breaking change] renamed `label_filename` to `source`

## [1.0.0] - 14.07.2021

Initial implementation

const {getLabelsFiles, getLabelsFromFiles} = require('../src/get-labels');

describe(getLabelsFiles.name, () => {
    it('gets label files', () => {
        const changedFiles = ['test/projects/app/src/features/example.js'];
        expect(getLabelsFiles(changedFiles, 'LABEL')).toEqual(['test/projects/app/LABEL']);
    });

    it('gets label files for multiple files', () => {
        const changedFiles = ['test/projects/app/src/features/example.js', 'test/projects/cast/src/index.js'];
        expect(getLabelsFiles(changedFiles, 'LABEL')).toEqual(['test/projects/app/LABEL', 'test/projects/cast/LABEL']);
    });
});

describe(getLabelsFromFiles.name,  () => {
    it('gets labels', async () => {
        console.log(await getLabelsFromFiles(['test/projects/app/LABEL', 'test/projects/cast/LABEL']));
    });
});

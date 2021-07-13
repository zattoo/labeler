const {getLabelsFiles, getLabelsFromFiles} = require('../src/get-labels');

describe(getLabelsFiles.name, () => {
    it('gets label files', async () => {
        const changedFiles = ['test/projects/app/src/features/example.js'];
        expect(await getLabelsFiles(changedFiles, 'LABEL')).toEqual(['test/projects/app/LABEL']);
    });

    it('gets label files for multiple files', async () => {
        const changedFiles = ['test/projects/app/src/features/example.js', 'test/projects/cast/src/index.js'];
        expect(await getLabelsFiles(changedFiles, 'LABEL')).toEqual(['test/projects/app/LABEL', 'test/projects/cast/LABEL']);
    });

    it('doesnt break on dot files', async () => {
        const changedFiles = ['.github/workflows/pr.yml'];
        expect(await getLabelsFiles(changedFiles, 'LABEL')).toEqual([null]);

    });
});

describe(getLabelsFromFiles.name,  () => {
    it('gets labels', async () => {
        console.log(await getLabelsFromFiles(['test/projects/app/LABEL', 'test/projects/cast/LABEL']));
    });
});

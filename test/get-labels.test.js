const {getLabelsFiles, getLabelsFromFiles} = require('../src/get-labels');

describe(getLabelsFiles.name, () => {
    it('gets label files', async () => {
        const changedFiles = ['test/projects/app/src/features/example.js'];
        expect(await getLabelsFiles(changedFiles, '.labels')).toEqual(['test/projects/app/.labels']);
    });

    it('gets label files for multiple files', async () => {
        const changedFiles = ['test/projects/app/src/features/example.js', 'test/projects/cast/src/index.js'];
        expect(await getLabelsFiles(changedFiles, '.labels')).toEqual(['test/projects/app/.labels', 'test/projects/cast/.labels']);
    });

    it('doesnt break on dot files', async () => {
        const changedFiles = ['.github/workflows/pr.yml'];
        expect(await getLabelsFiles(changedFiles, '.labels')).toEqual([null]);

    });
});

describe(getLabelsFromFiles.name,  () => {
    it('gets labels', async () => {
        expect((await getLabelsFromFiles(['test/projects/app/.labels', 'test/projects/cast/.labels'])).sort()).toEqual(['project:app', 'project:common', 'project:cast'].sort());
    });
});

const {getMetaFiles, getMetaInfoFromFiles} = require('../src/get-meta-info');

describe(getMetaFiles.name, () => {
    it('gets label files', async () => {
        const changedFiles = ['test/mocks/'];
        expect(await getMetaFiles(changedFiles, '.owners')).toEqual(['/.owners']);
    });

    it('gets label files for multiple files', async () => {
        const changedFiles = ['test/projects/app/src/features/example.js', 'test/projects/cast/src/index.js'];
        expect(await getMetaFiles(changedFiles, '.labels')).toEqual(['test/projects/app/.labels', 'test/projects/cast/.labels']);
    });

    it('doesnt break on dot files', async () => {
        const changedFiles = ['.github/workflows/pr.yml'];
        expect(await getMetaFiles(changedFiles, '.labels')).toEqual([null]);

    });
});

describe(getMetaInfoFromFiles.name,  () => {
    it('gets labels', async () => {
        expect(await getMetaInfoFromFiles(['test/projects/app/.labels', 'test/projects/cast/.labels'])).toEqual(['project:app', 'project:common', 'project:cast']);
    });
});

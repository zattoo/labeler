const {
    getOwnersMap,
    getMetaFiles,
    getMetaInfoFromFiles,
} = require('../src/utils');

const ownersMap = {
    gothban: {
        sources: [
            '/.owners',
        ],
        ownedFiles: [
            '/.github/workflows/project-recognition.yml',
            '/projects/app/.labels',
            '/projects/app/CHANGELOG.md',
            '/projects/app/src/features/account/.labels',
            '/projects/app/src/features/entrance/index.jsx',
            '/projects/app/src/features/player/index.jsx',
        ],
    },
    nitzanashi: {
        sources: [
            '/.owners',
            '/projects/app/.owners',
        ],
        ownedFiles: [
            '/.github/workflows/project-recognition.yml',
            '/projects/app/.labels',
            '/projects/app/CHANGELOG.md',
            '/projects/app/src/features/account/.labels',
            '/projects/app/src/features/entrance/index.jsx',
            '/projects/app/src/features/player/index.jsx',
        ],
    },
    victor: {
        sources: [
            '/projects/app/src/features/player/.owners'
        ],
        ownedFiles: [
            '/projects/app/src/features/player/index.jsx',
        ],
    }
};

describe(getOwnersMap.name, () => {
    it('returns the expected map', () => {
        const changedFiles = [
            '/.github/workflows/project-recognition.yml',
            '/projects/app/.labels',
            '/projects/app/CHANGELOG.md',
            '/projects/app/src/features/account/.labels',
            '/projects/app/src/features/entrance/index.jsx',
            '/projects/app/src/features/player/index.jsx',
        ];

        const infoMap = {
            '/.owners': ['gothban', 'nitzanashi'],
            '/projects/app/.owners': ['nitzanashi'],
            '/projects/app/src/features/player/.owners': ['victor'],
        };

        expect(getOwnersMap(infoMap, changedFiles)).toEqual(ownersMap);

    });
});

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

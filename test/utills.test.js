const {
    getOwnersMap,
    createReviewersComment,
} = require('../src/get-meta-info');

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

describe(createReviewersComment.name, () => {
    it('returns a comment', () => {
       const length = Object.keys(ownersMap).length;

       expect(createReviewersComment(ownersMap)).toEqual([]);

    });
});

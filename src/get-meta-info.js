const fse = require('fs-extra');

const {findNearestFile} = require('./find-nearest-file');

const reviewersLevels = require('./reveiwers-levels');

/**
 * @param {string[]} changedFiles
 * @param {string[]} ignoreFiles
 * @returns {string[]}
 */
const filterChangedFiles = (changedFiles, ignoreFiles) => {
    return changedFiles.filter((file) => {
        return !ignoreFiles.includes(file.split('/').pop());
    });
};

/**
 * @param {string[]} changedFiles
 * @param {string} level
 * @returns {string[]}
 */
const reduceFilesToLevel = (changedFiles, level) => {
    switch (level) {
        case reviewersLevels.REPO: {
            return ['/'];
        }

        case reviewersLevels.PROJECT: {
            return [new Set(...changedFiles.map((path) => {
                const splitPath = path.split('/');
                const projectsIndex = splitPath.indexOf('projects');

                if (projectsIndex === -1) {
                    return path;
                }

                return `${splitPath[projectsIndex]}/${splitPath[projectsIndex + 1]}`;
            }))];
        }

        case reviewersLevels.OWNER:
        default: {
            return changedFiles;
        }
    }
};

/**
 * @param {string[]} changedFiles
 * @param {string} filename
 * @returns {string[]}
 */
const getMetaFiles = async (changedFiles, filename) => {
    const queue = changedFiles.map(async (filePath) => {
        return await findNearestFile(filename, filePath);
    });

    const results = await Promise.all(queue);

    return [...new Set(results)];
};

/**
 * @param {string[]} labelFiles
 * @returns {string[]}
 */
const getMetaInfoFromFiles = async (labelFiles) => {
    const labels = [];

    await Promise.all(...[labelFiles.map(async (file) => {
        if (!file) {
            return;
        }

        try {
            const fileData = await fse.readFile(file, 'utf8');
            const fileLabels = fileData.split('\n');
            labels.push(...fileLabels);
        } catch (e) {
            console.error(`file: ${file} errored while reading data: ${e}`);
            return Promise.resolve();
        }
    })]);

    return [...new Set(labels)].filter(Boolean);
};


module.exports = {
     getMetaFiles,
    getMetaInfoFromFiles,
    reduceFilesToLevel,
    filterChangedFiles,
};

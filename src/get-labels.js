const fse = require('fs-extra');

const {findNearestFile} = require('./find-nearest-file');

/**
 * @param {string[]} changedFiles
 * @param {string} filename
 * @returns {string[]}
 */
const getLabelsFiles = async (changedFiles, filename) => {
    const queue = changedFiles.map(async (filePath) => {
        return await findNearestFile(filename, filePath);
    });

    const results = await Promise.all(queue);

    console.log(results);

    console.log([...new Set(results)]);
    return [...new Set(results)];
};

/**
 * @param {string[]} labelFiles
 * @returns {string[]}
 */
const getLabelsFromFiles = async (labelFiles) => {
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
            return Promise.resolve();
        }
    })]);

    return [...new Set(labels)].filter(Boolean);
};


module.exports = {
    getLabelsFiles,
    getLabelsFromFiles,
};

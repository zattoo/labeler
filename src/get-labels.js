const fse = require('fs-extra');

const findNearestFile = require('find-nearest-file');

/**
 * @param {string[]} changedFiles
 * @param {string} filename
 * @returns {string[]}
 */
const getLabelsFiles = (changedFiles, filename) => {
    return [...new Set(changedFiles.map((file) => {
        return findNearestFile(filename, file);
    }))];
};

/**
 * @param {string[]} labelFiles
 * @returns {string[]}
 */
const getLabelsFromFiles = async (labelFiles) => {
    const labels = [];

    await Promise.all(...[labelFiles.map(async (file) => {
        const fileData = await fse.readFile(file, 'utf8');
        const fileLabels = fileData.split('\n');
        labels.push(...fileLabels);
    })]);

    return [...new Set(labels)];
};


module.exports = {
    getLabelsFiles,
    getLabelsFromFiles,
};

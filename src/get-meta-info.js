const fse = require('fs-extra');
const {promisify} = require('util');
const {exec} = require('child_process');

const {findNearestFile} = require('./find-nearest-file');

const execPromise = promisify(exec);

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
 * @param {string} filename
 * @returns {string[]}
 */
const getMetaFiles = async (changedFiles, filename) => {
    const queue = changedFiles.map(async (filePath) => {
        return await findNearestFile(filename, filePath);
    });

    const results = await Promise.all(queue);

    return [...new Set(results)].filter(Boolean);
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

/**
 * @param {string} executionCode
 * @param {string} [cwd]
 */
const execWithCatch = (executionCode, cwd = '') => {
    return execPromise(executionCode, {
        cwd,
    }).catch((err) => {
        return Promise.reject(err);
    });
};


module.exports = {
    getMetaFiles,
    getMetaInfoFromFiles,
    filterChangedFiles,
    execWithCatch,
};

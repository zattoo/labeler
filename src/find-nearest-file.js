const path = require('path');
const fse = require('fs-extra');

/**
 *
 * @param {string} directory
 */
const nextLevelUp = (directory) => {
    if (directory === '.') {
        return '/';
    }

    if (directory === path.resolve('/')) {
        return null;
    }

    return  path.dirname(directory);
};

/**
 *
 * @param {string} filename
 * @param {string} directory
 * @param {number} level
 */
const findFile = async (filename, directory, level) => {
    if (!directory) {
        return null;
    }

    const file = path.join(directory, filename);
    const nextDirectory = nextLevelUp(directory);

    try {
        const fileExists = await fse.pathExists(file);

        if (fileExists) {
            return (level === 0 || !nextDirectory)
                ? file
                : await findFile(filename, nextDirectory, level-1);
        }

        return await findFile(filename, nextDirectory, level);
    } catch (e) {
        return await findFile(filename, nextDirectory, level);
    }
};

/**
 *
 * @param {string} filename
 * @param {string} root
 * @param {number} level
 */
const findNearestFile = async (filename, root, level) => {
    if (!filename) {
        throw new Error('filename is required');
    }

    if (filename.indexOf('/') !== -1 || filename === '..') {
        throw new Error('filename must be just a filename and not a path')
    }

    return await findFile(filename, root, level);
};

module.exports = {findNearestFile}

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
 */
const findFile = async (filename, directory) => {
    if (!directory) {
        return null;
    }

    const file = path.join(directory, filename);
    console.log(file);

    try {
        const fileExists = await fse.pathExists(file);
        console.log(`${file}: ${fileExists}`);

        if (fileExists) {
            return file;
        }

        return await findFile(filename, nextLevelUp(directory));
    } catch (e) {
        return await findFile(filename, nextLevelUp(directory));
    }
};

/**
 *
 * @param {string} filename
 * @param {string} [root]
 */
const findNearestFile = async (filename, root = process.cwd()) => {
    if (!filename) {
        throw new Error('filename is required');
    }

    if (filename.indexOf('/') !== -1 || filename === '..') {
        throw new Error('filename must be just a filename and not a path')
    }

    return await findFile(filename, root);
};

module.exports = {findNearestFile}

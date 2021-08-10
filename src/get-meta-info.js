const fse = require('fs-extra');
const {promisify} = require('util');
const {exec} = require('child_process');
const path = require('path');

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
 * @param {string[]} files
 * @returns {InfoMap}
 */
const getMetaInfoFromFiles = async (files) => {
    const infoMap = {};

    await Promise.all(...[files.map(async (file) => {
        if (!file) {
            return;
        }

        try {
            const data = (await fse.readFile(file, 'utf8'));
            const dataToArray = data.split('\n');
            infoMap[file] = dataToArray.filter(Boolean);

        } catch (e) {
            console.error(`file: ${file} errored while reading data: ${e}`);
            return Promise.resolve();
        }
    })]);

    return infoMap;
};

/**
 *
 * @param {InfoMap} infoMap
 * @param {string[]} changedFiles
 * @param {string} createdBy
 * @returns {OwnersMap}
 */
const getOwnersMap = (infoMap, changedFiles, createdBy) => {
    /** @type {OwnersMap} */
    const ownersMap = {};

    /** @type {InfoMap} */
    const infoDirMap = {};

    /**
     * @param {string[]} owners
     * @param {string} filePath
     */
    const addFileToOwners = (owners, filePath) => {
        owners.forEach((owner) => {
           ownersMap[owner].ownedFiles.push(filePath);
        });
    };

    Object.entries(infoMap).forEach(([filePath, owners]) => {
        owners.forEach((owner) => {
            if (!ownersMap[owner]) {
                ownersMap[owner] = {
                    sources: [],
                    ownedFiles: []
                }
            }

            ownersMap[owner].sources.push(filePath);
        });

        const dir = path.dirname(filePath);
        infoDirMap[dir] = owners;
    });

    changedFiles.forEach((file) => {
        const owners = [...new Set(Object.keys(infoDirMap).reduce((acc, path) => {
            if (file.startsWith(path)) {
                acc.push(...infoDirMap[path]);
            }

            return acc;
        }, []))].filter(Boolean);

        addFileToOwners(owners, file);
    });

    // Remove owner of PR
    delete ownersMap[createdBy];

    return ownersMap;
};

/**
 *
 * @param {string} file
 * @param {string} pathPrefix
 * @returns {string}
 */
const removePrefixPathFromFile = (file, pathPrefix) => {
    return file.substr(pathPrefix.length + 1);
};

/**
 * @param {OwnersMap} ownersMap
 * @param {string} pathPrefix
 * @returns {string}
 */
const createReviewersComment = (ownersMap, pathPrefix) => {
    const arrayToList = (array) => {
        return (array.map((file) => `* \`${removePrefixPathFromFile(file, pathPrefix)}\``).join('\n'));
    };

    /**
     * @param {string} owner
     * @param {OwnerData} data
     */
    const createCollapsableInfo = (owner, data) => {
        return (`
<details>
 <summary>${owner} (${data.ownedFiles.length} files)</summary>

 ### Owned files:\n${arrayToList(data.ownedFiles)}
 ### sources:\n${arrayToList(data.sources)}
</details>`
        );
    };

    const AMOUNT = `Found ${Object.keys(ownersMap).length} Codeowners\n`;

    const reviewersInfo = [];

    Object.entries(ownersMap).forEach(([owner, data]) => {
        reviewersInfo.push(createCollapsableInfo(owner, data));
    })

    return AMOUNT + reviewersInfo.join('\n');
};

/**
 * @param {OwnersMap} codeowners
 * @param {string[]} files
 * @param {string} pathPrefix
 */
const createRequiredApprovalsComment = (codeowners, files, pathPrefix) => {
    const filesMap = files.map((file) => {
        const fileOwners = Object.entries(codeowners).reduce((acc, [codeowner, data]) => {
            if (data.ownedFiles.includes(file)) {
                acc.push(codeowner);
            }

            return acc;
        }, []);

        return `* ${removePrefixPathFromFile(file, pathPrefix)} (${fileOwners.join(', ')})`;
    }).join('\n');

    return (`
<details>
<summary>Approval is still required for ${files.length} files</summary>

${filesMap}
</details>
`);
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
    getOwnersMap,
    createReviewersComment,
    removePrefixPathFromFile,
    createRequiredApprovalsComment,
};

/** @typedef {Record<string, string[]>} InfoMap */

/** @typedef {Record<string, OwnerData>} OwnersMap */

/**
 * @typedef {Object} OwnerData
 * @prop {string[]} sources
 * @prop {string[]} ownedFiles
 */

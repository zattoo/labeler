const {exec} = require('child_process');
const {promisify} = require('util');

const execPromise = promisify(exec);

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
    execWithCatch
};

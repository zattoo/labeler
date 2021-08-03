const {spawn} = require('child_process');

/**
 *
 * @param {childProcessData} data
 * @returns {Promise<void>}
 */
const childProcess = (data) => {
    const command = spawn(data.command, data.args, {
        cwd: data.cwd,
        env: data.env,
        stdio: [
            process.stdin,
            process.stdout,
            process.stderr,
        ],
    });

    return new Promise((resolve, reject) => {
        command.once('exit', (code) => {
            if (code === 0) {
                resolve(undefined);
            } else {
                reject(new Error(`Exit with error code: ${code}`));
            }
        });
        command.once('error', (error) => {
            reject(error);
        });
    });
};

module.exports = {
    childProcess
};

/**
 * @typedef {import('child_process').ChildProcess} ChildProcess
 */

/**
 * @typedef {Object} childProcessData
 * @prop {string} command
 * @prop {string[]} args
 * @prop {string} cwd
 * @prop {Record<string, string>} [env]
 */

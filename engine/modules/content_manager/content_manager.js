// #region MODULE IMPORTS
const { appendToFile } = require('../utils.js');
const { saveFileConfig, loadFileConfig } = require('./operations/config_manager.js');
const { processDirectory } = require('./operations/directory_processor.js');

// #endregion

// #region MODULE EXPORTS
module.exports = {
  processDirectory: async (dirPath, rootDirectory, projectName, pluginModes = {}) => {
    /**
     * Processes a given directory, reads its structure, and loads its associated configuration.
     * @param {string} dirPath - The path to the directory to process.
     * @returns {Promise<{structure: Array<object>, config: object}>} An object containing the processed directory structure and its configuration.
     */
    const config = await loadFileConfig(dirPath);

    const structure = await processDirectory(dirPath, config.files, rootDirectory, projectName, pluginModes);
    // Return the structure based on filtered config, but return the FULL config for state management
    return { structure, config: config };
  },
  getFileConfig: async (filePath, rootDirectory) => {
    /**
     * Gets the configuration for a specific file.
     * @param {string} filePath - The absolute path to the file.
     * @param {string} rootDirectory - The project root directory.
     * @returns {Promise<object|null>} The file configuration or null.
     */
    const config = await loadFileConfig(rootDirectory);
    return config.files[filePath] || null;
  },
  saveFileConfig,
  loadFileConfig,
  appendToFile
};
// #endregion

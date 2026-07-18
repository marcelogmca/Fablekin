const fs = require('fs/promises');
const path = require('path');
const { Logger, naturalSort } = require('../../utils');
const coreFolders = require('../../config/core_folders.js');

const memorymanagement = require('../../memory_manager/memory_manager.js'); // Needed for token count

// #region MODULE IMPORTS
// #endregion

// #region CONFIGURATION
const TOKEN_ESTIMATION_RATIO = 4; // chars per token approximation
let hasAutoFileBeenCounted = false;
// #endregion

function buildPackageModeIndex(pluginModes = {}) {
  const packageModes = new Map();

  for (const [modeId, metadata] of Object.entries(pluginModes || {})) {
    const extension = metadata?.package?.extension;
    if (!extension || typeof extension !== 'string') continue;

    packageModes.set(extension.toLowerCase(), {
      modeId,
      metadata
    });
  }

  return packageModes;
}

// #region TOKEN COUNT CALCULATION
/**
 * Calculates an estimated token count for given content.
 * @param {string} content - The text content.
 * @param {boolean} [isAuto=false] - Whether the file is in 'auto' mode.
 * @returns {number} - The estimated token count.
 */
function calculateTokenCount(content, isAuto = false) {
  if (isAuto) {
    if (!hasAutoFileBeenCounted) {
      hasAutoFileBeenCounted = true;
      return memorymanagement.CONFIG.CHUNK_SIZE;
    }
    return 0;
  }
  return Math.ceil(content.length / TOKEN_ESTIMATION_RATIO);
}
// #endregion

// #region FILE EXTRACTION
/**
 * Recursively extract all file items from a directory structure.
 * @param {Array} items - The items in a directory.
 * @returns {Array} - A flat list of file objects.
 */
function getFilesRecursive(items) {
  let files = [];
  for (const item of items) {
    if (item.type === 'file') {
      files.push(item);
    } else if (item.type === 'directory' && item.children) {
      files = files.concat(getFilesRecursive(item.children));
    }
  }
  return files;
}
// #endregion

// #region DIRECTORY READING
/**
 * Recursively reads the directory structure and returns it as a hierarchical array.
 * @param {string} dirPath - The path to the directory.
 * @returns {Promise<Array<object>>} - The hierarchical structure of the directory.
 */
async function readDirectory(dirPath, config, rootDirectory, projectName, depth = 0, pluginModes = {}, packageModeIndex = buildPackageModeIndex(pluginModes)) {
  Logger.log('DirProcessor', 'Query', `Reading directory: ${dirPath} (Depth: ${depth})`, 'start');

  if (depth >= 2) {
    Logger.log('DirProcessor', 'Query', `Stopping at depth 2 for: ${dirPath}`);
    return [];
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let structure = [];
  const sortedEntries = entries.sort((a, b) => naturalSort(a.name, b.name));

  for (let i = 0; i < sortedEntries.length; i++) {
    const entry = sortedEntries[i];
    const entryPath = path.join(dirPath, entry.name);

    // Get config for this item if it exists
    const itemConfig = config[entryPath] || {};
    const mode = typeof itemConfig === 'string' ? itemConfig : (itemConfig.mode || 'not-included');
    const order = (typeof itemConfig === 'object' && itemConfig.order !== undefined) ? itemConfig.order : (i + 1) * 100;

    Logger.log('DirProcessor', 'Query', `Processing entry: ${entry.name}, Mode: ${mode}, Order: ${order}`);

    if (entry.isDirectory()) {
      if (entry.name === 'plugins' || entry.name === 'vectors' || entry.name === 'assets') {
        Logger.log('DirProcessor', 'Query', `Excluding system directory: ${entry.name}`);
        continue;
      }

      const packageMatch = Array.from(packageModeIndex.entries()).find(([extension]) =>
        entry.name.toLowerCase().endsWith(extension)
      );

      if (packageMatch) {
        const [, packageDef] = packageMatch;
        structure.push({
          name: entry.name,
          type: 'file',
          path: entryPath,
          tokenCount: 0,
          isCached: false,
          mode,
          order,
          isLocked: false,
          isPackage: true,
          packageExtension: packageMatch[0],
          packageModeId: packageDef.modeId
        });
        continue;
      }

      const children = await readDirectory(entryPath, config, rootDirectory, projectName, depth + 1, pluginModes, packageModeIndex);

      structure.push({
        name: entry.name,
        type: 'directory',
        path: entryPath,
        children,
        mode,
        order
      });
    } else if (entry.isFile()) {
      const fileExtension = path.extname(entry.name).toLowerCase();

      if (entryPath === path.join(rootDirectory, `${projectName}.db`)) {
        Logger.log('DirProcessor', 'Query', `Excluding project DB file: ${entry.name}`);
        continue;
      }

      if (fileExtension === '.config') {
        Logger.log('DirProcessor', 'Query', `Excluding project config file: ${entry.name}`);
        continue;
      }

      if (/\.(db|dbkg)-(shm|wal)$/.test(entry.name.toLowerCase())) {
        Logger.log('DirProcessor', 'Query', `Excluding temporary SQLite file: ${entry.name}`);
        continue;
      }

      if (fileExtension === '.md') {
        const content = await fs.readFile(entryPath, 'utf-8');
        structure.push({
          name: entry.name,
          type: 'file',
          path: entryPath,
          tokenCount: calculateTokenCount(content),
          isCached: false,
          mode,
          order,
          isLocked: false
        });
      } else if (fileExtension === '.db' || fileExtension === '.dbkg') {
        const isChronicles = entryPath.includes(coreFolders.FOLDERS.CHRONICLES);
        let dType = 'plugin';
        if (fileExtension === '.dbkg') dType = 'kg';
        else if (isChronicles) dType = 'chat';

        structure.push({
          name: entry.name,
          type: 'file',
          path: entryPath,
          tokenCount: 0,
          isCached: false,
          dbType: dType,
          mode,
          order,
          isLocked: false
        });
      } else {
        structure.push({
          name: entry.name,
          type: 'file',
          path: entryPath,
          tokenCount: 0,
          isCached: false,
          mode: 'auto-included',
          order,
          isLocked: true
        });
      }
    }
  }

  // Sort by order
  structure.sort((a, b) => a.order - b.order);

  Logger.log('DirProcessor', 'Query', `Finished reading directory: ${dirPath}`, 'end');
  return structure;
}
// #endregion

// #region MAIN DIRECTORY PROCESSING
/**
 * Processes the entire directory to get its structure and apply configurations.
 * @param {string} dirPath - The root directory path.
 * @param {object} config - The file configuration.
 * @returns {Promise<Array<object>>} - The processed directory structure.
 */
async function processDirectory(dirPath, config, rootDirectory, projectName, pluginModes = {}) {
  Logger.log('DirProcessor', 'Lifecycle', `Starting directory processing: ${dirPath}`, 'start');
  hasAutoFileBeenCounted = false;
  const structure = await readDirectory(dirPath, config, rootDirectory, projectName, 0, pluginModes);

  Logger.log('DirProcessor', 'Lifecycle', 'Directory processing completed', 'end');
  return structure;
}
// #endregion

// #region EXPORTS
module.exports = {
  processDirectory,
  getFilesRecursive
};
// #endregion

const fs = require('fs/promises');
const path = require('path');
const { Logger, ensureDirectoryExists } = require('../../utils');

// #region MODULE IMPORTS
// #endregion

// #region CONFIGURATION
const baseCacheDir = path.join(__dirname, '../cache');
// #endregion

// #region CACHE PATH GENERATION
/**
 * Generate cache directory path based on a hash of the directory path.
 * @param {string} dirPath - The path of the directory to be cached.
 * @returns {string} - The path to the cache directory.
 */
function getDirCachePath(dirPath) {
  const dirHash = Buffer.from(dirPath).toString('base64').replace(/[/+=]/g, '_');
  return path.join(baseCacheDir, dirHash);
}
// #endregion

// #region CACHE DIRECTORY MANAGEMENT
/**
 * Ensures the base cache directory exists.
 * @param {string} cachePath - The specific cache path to ensure.
 * @returns {Promise<void>}
 */
async function ensureCacheDir(cachePath) {
    await ensureDirectoryExists(cachePath);
}
// #endregion

// #region CACHED CONTENT MANAGEMENT
/**
 * Check if a cached file exists and return its content.
 * @param {string} cachePath - The path to the cache directory.
 * @param {string} filename - The name of the file (without extension).
 * @param {string} extension - The file extension (e.g., 'summary', 'synopsis').
 * @returns {Promise<string|null>} - The content of the cached file or null if it doesn't exist.
 */
async function getCachedContent(cachePath, filename, extension) {
  const cacheFile = path.join(cachePath, `${filename}.${extension}`);
  try {
    const content = await fs.readFile(cacheFile, 'utf-8');
    Logger.log('CacheManager', `Using cached ${extension} for: ${filename}`);
    return content;
  } catch (error) {
    if (error.code !== 'ENOENT') {
        Logger.error('CacheManager', `Error reading cache file ${cacheFile}`, error);
    }
    return null;
  }
}

/**
 * Save content to a cache file.
 * @param {string} cachePath - The path to the cache directory.
 * @param {string} filename - The name of the file (without extension).
 * @param {string} extension - The file extension (e.g., 'summary', 'synopsis').
 * @param {string} content - The content to save.
 * @returns {Promise<void>}
 */
async function saveCachedContent(cachePath, filename, extension, content) {
  await ensureCacheDir(cachePath);
  const cacheFile = path.join(cachePath, `${filename}.${extension}`);
  await fs.writeFile(cacheFile, content);
  Logger.log('CacheManager', `Cached ${extension} saved for: ${filename}`);
}
// #endregion

// #region SYNOPSIS FILE CHECK
/**
 * Check if a synopsis file exists in the cache.
 * @param {string} cachePath - The path to the cache directory.
 * @param {string} filename - The name of the file (without extension).
 * @returns {Promise<boolean>} - True if the synopsis file exists, false otherwise.
 */
async function hasSynopsisFile(cachePath, filename) {
  const synopsisFile = path.join(cachePath, `${filename}.synopsis`);
  try {
    await fs.access(synopsisFile);
    return true;
  } catch {
    return false;
  }
}
// #endregion

// #region EXPORTS
module.exports = {
    getDirCachePath,
    ensureCacheDir,
    getCachedContent,
    saveCachedContent,
    hasSynopsisFile,
    baseCacheDir
};
// #endregion
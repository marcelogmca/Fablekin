// modules/devcache.js
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const { Logger, ensureDirectoryExists, compressString, decompressToString } = require('../../utils.js');

const CACHE_DB_PATH = path.join(__dirname, '..', '..', '..', '..', 'workspace', 'devcache', 'cache.db');
const MAX_CACHE_SIZE = 2000;

let db = null;

/**
 * Initializes the dev cache database.
 */
async function init() {
  if (db) return;

  try {
    await ensureDirectoryExists(path.dirname(CACHE_DB_PATH));
    
    db = await open({
      filename: CACHE_DB_PATH,
      driver: sqlite3.Database,
    });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS llm_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_crc TEXT NOT NULL,
        model TEXT NOT NULL,
        response BLOB NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cache_lookup ON llm_cache (request_crc, model);
    `);

    Logger.log('DevCache', 'Database initialized.');
  } catch (error) {
    Logger.error('DevCache', 'Failed to initialize database.', error);
    throw error;
  }
}

/**
 * Retrieves a cached response.
 * @param {string} crc - The CRC32 of the request.
 * @param {string} model - The model name.
 * @returns {Promise<object|string|null>}
 */
async function get(crc, model) {
  if (!db) await init();
  
  try {
    const row = await db.get(
      'SELECT response FROM llm_cache WHERE request_crc = ? AND model = ? ORDER BY timestamp DESC LIMIT 1',
      [crc, model]
    );

    if (row) {
      const decompressed = await decompressToString(row.response);
      return JSON.parse(decompressed);
    }
    return null;
  } catch (error) {
    Logger.error('DevCache', 'Failed to get from cache.', error);
    return null;
  }
}

/**
 * Saves a response to the cache and maintains the 500-record limit.
 * @param {string} crc - The CRC32 of the request.
 * @param {string} model - The model name.
 * @param {object|string} response - The response to cache.
 */
async function set(crc, model, response) {
  if (!db) await init();

  try {
    const compressed = await compressString(JSON.stringify(response));
    
    await db.run(
      'INSERT INTO llm_cache (request_crc, model, response) VALUES (?, ?, ?)',
      [crc, model, compressed]
    );

    // Maintain 500 records limit
    await db.run(`
      DELETE FROM llm_cache WHERE id IN (
        SELECT id FROM llm_cache ORDER BY timestamp DESC LIMIT -1 OFFSET ?
      )
    `, [MAX_CACHE_SIZE]);

  } catch (error) {
    Logger.error('DevCache', 'Failed to save to cache.', error);
  }
}

module.exports = {
  get,
  set
};

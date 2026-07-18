// chaptermanagement.js - Chapter Management Module
// #region MODULE IMPORTS
const { Logger, ensureDirectoryExists, compressString, decompressToString, readSettings } = require('./utils.js');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs/promises');
const TurnContext = require('./turncontext.js');
const {
  serializeWriterPromptSnapshot,
  deserializeWriterPromptSnapshot
} = require('./writer_prompt_snapshot.js');
const memorymanagement = require('./memory_manager/memory_manager.js');
const { parseTurnStorageKey } = require('./turn_storage_key.js');

const DB_OPERATION_TIMEOUT = 30000; // 30 seconds
// #endregion

// This will hold the database connection for the current project.
const settings = readSettings();
const CONFIG = {
  FULL_CHAPTERS: settings?.infrastructure?.narrative_history?.full_chapters || 6,
  SUMMARY_CHAPTERS: settings?.infrastructure?.narrative_history?.summary_chapters || 12,
  SYNOPSIS_CHAPTERS: settings?.infrastructure?.narrative_history?.synopsis_chapters ?? -1,
};
let db = null;
let currentProjectName = null;
let currentChatDbFullPath = null;
let currentProjectRoot = null;
const INTERLUDE_INTEGRATION_STATES = new Set(['none', 'pending', 'integrated', 'failed']);

const CANONICAL_TABLE_COLUMNS = Object.freeze({
  chat_turns: [
    'id', 'project_name', 'creation_turn_number', 'turn_context_snapshot', 'title',
    'abstract_title', 'synopsis', 'summary', 'fulltext', 'writer_prompt_snapshot',
    'thumbnail', 'dialogue_count', 'timestamp'
  ],
  viewer_state: [
    'id', 'last_turn_number', 'last_dialogue_index', 'scene_mode', 'interlude_id',
    'storage_turn_key'
  ],
  chat_interludes: [
    'id', 'project_name', 'parent_turn_id', 'ordinal', 'label', 'turn_context_snapshot',
    'title', 'abstract_title', 'synopsis', 'summary', 'thumbnail', 'is_story_relevant',
    'integration_state', 'integration_note', 'integration_updated_at', 'timestamp'
  ]
});

async function assertCanonicalTableSchemas(database) {
  for (const [tableName, expectedColumns] of Object.entries(CANONICAL_TABLE_COLUMNS)) {
    const columns = await database.all(`PRAGMA table_info(${tableName})`);
    const actualColumns = columns.map((column) => String(column.name || '').toLowerCase());
    const missingColumns = expectedColumns.filter((column) => !actualColumns.includes(column));
    if (missingColumns.length > 0) {
      throw new Error(
        `Unsupported ${tableName} schema; missing ${missingColumns.join(', ')}. `
        + 'This pre-release build does not migrate existing databases. Delete and recreate the project database.'
      );
    }
  }
}

function normalizeInterludeIntegrationState(state, fallback = 'none') {
  const candidate = typeof state === 'string' ? state.trim().toLowerCase() : '';
  if (INTERLUDE_INTEGRATION_STATES.has(candidate)) return candidate;
  return fallback;
}

async function hasFactsTurnKeyColumn() {
  if (!db) return false;
  try {
    const columns = await db.all(`PRAGMA table_info(facts)`);
    return Array.isArray(columns) && columns.some(c => String(c?.name || '').toLowerCase() === 'turn_key');
  } catch {
    return false;
  }
}

async function cleanupFactsByTurnKeyExact(turnKey) {
  if (!db || !currentProjectName || !turnKey) return;
  if (!(await hasFactsTurnKeyColumn())) return;
  try {
    await db.run(`DELETE FROM facts WHERE project_name = ? AND turn_key = ?`, [currentProjectName.toLowerCase(), String(turnKey)]);
    Logger.log('ChapterMgmt', 'Persistence', `Cleaned facts for turn_key=${turnKey}.`);
  } catch (error) {
    Logger.warn('ChapterMgmt', 'Persistence', `Failed facts cleanup for turn_key=${turnKey}: ${error.message}`);
  }
}

async function cleanupFactsByBaseTurn(baseTurnNumber) {
  if (!db || !currentProjectName || !Number.isInteger(baseTurnNumber) || baseTurnNumber < 1) return;
  if (!(await hasFactsTurnKeyColumn())) return;
  try {
    await db.run(
      `DELETE FROM facts
       WHERE project_name = ?
         AND (turn_key = ? OR turn_key LIKE ?)`,
      [currentProjectName.toLowerCase(), String(baseTurnNumber), `${baseTurnNumber}.%`]
    );
    Logger.log('ChapterMgmt', 'Persistence', `Cleaned facts for base turn ${baseTurnNumber} and attached interlude keys.`);
  } catch (error) {
    Logger.warn('ChapterMgmt', 'Persistence', `Failed base turn facts cleanup for ${baseTurnNumber}: ${error.message}`);
  }
}

// #region BLOB CACHE
// Request-scoped cache for decompressed turn snapshots.
// Populated by getTurnBlob/getTurnBlobs on first fetch; subsequent calls
// for the same dbId within a pipeline run return the in-memory object.
//
// LIFECYCLE: cleared at the START of generateVNTurn() in main.js (so each
// turn generation gets a fresh cache) and also on init() (so switching chat
// DBs never carries over stale data from a previous file).
//
// We do NOT call clearBlobCache() mid-pipeline unless you explicitly
// want every subsequent ensureFull() to re-hit the database. The correct
// contract is: one clear per turn generation, at the very beginning.
//
// If a plugin modifies a historical turn in-flight (via updateTurn)
// and then re-reads it via ensureFull(), it will get the PRE-UPDATE cached
// version. This is safe today because updateTurn() is only called in late
// persistence hooks, after all readers are done. If you add mid-pipeline
// updateTurn() callers, you must call clearBlobCache() or selectively
// invalidate the affected dbId.
//
// Anyway, this comment is just to remember how blob cache is implemented.
let _blobCache = new Map();

/**
 * Clears the in-memory blob cache.
 * Should be called at the start of each turn generation pipeline run.
 */
function clearBlobCache() {
  const count = _blobCache.size;
  _blobCache = new Map();
  if (count > 0) {
    Logger.log('ChapterMgmt', 'BlobCache', `Cleared ${count} cached blob(s).`);
  }
}
// #endregion

async function buildSerializedWriterPromptSnapshot(turnContextInstance) {
  const payload = turnContextInstance?.processed?.promptBuilder?.writerPromptSnapshot;
  if (!payload || typeof payload !== 'object') return null;

  const compressed = await serializeWriterPromptSnapshot(payload);
  if (!compressed) {
    Logger.warn('ChapterMgmt', 'Persistence', `Writer prompt snapshot serialization failed for turn ${turnContextInstance?.creationTurnNumber || 'unknown'}.`);
  }
  return compressed;
}

function getTurnFulltext(turnContextInstance) {
  const fulltext = turnContextInstance?.output?.fulltext;
  if (typeof fulltext === 'string') return fulltext;
  return turnContextInstance?.processed?.narrativeEngine?.writerResponse || '';
}

// #region INITIALIZATION
/**
 * Initializes the Chapter Management module for a specific project by opening its database.
 * @param {string} chatDbFullPath - The absolute path to the .db file.
 * @returns {Promise<void>}
 */
async function init(chatDbFullPath) {
  currentChatDbFullPath = chatDbFullPath;
  clearBlobCache(); // Switching DBs - invalidate any cached blobs from the previous connection
  Logger.log('ChapterMgmt', 'Lifecycle', `init called for chat DB full path: ${chatDbFullPath}`, 'start');

  const parts = chatDbFullPath.split(path.sep);
  const projectsIndex = parts.indexOf('projects');
  let projectFolderName = 'default_project';
  if (projectsIndex !== -1 && parts.length > projectsIndex + 1) {
    projectFolderName = parts[projectsIndex + 1];
  }
  currentProjectName = projectFolderName;
  // Derive project root: DB is at [ProjectRoot]/3_Chronicles/[ProjectName].db
  // So ProjectRoot is two levels up from the DB file.
  currentProjectRoot = path.resolve(path.dirname(path.dirname(chatDbFullPath)));
  Logger.log('ChapterMgmt', 'Lifecycle', `Derived project root: ${currentProjectRoot}`);

  try {
    const dbDir = path.dirname(chatDbFullPath);
    const dbPath = chatDbFullPath;

    await ensureDirectoryExists(dbDir);

    Logger.log('ChapterMgmt', 'Database', `Initializing database at path: ${dbPath}`);
    db = await Promise.race([
      open({
        filename: dbPath,
        driver: sqlite3.Database,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite database open timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);
    Logger.log('ChapterMgmt', 'Database', `Database connection established: ${db !== null}`);
    await db.exec('PRAGMA foreign_keys = ON;');

    // NEW SCHEMA: Store serialized TurnContext instances
    await Promise.race([
      db.exec(`
      CREATE TABLE IF NOT EXISTS chat_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        creation_turn_number INTEGER NOT NULL,
        turn_context_snapshot BLOB NOT NULL,
        title TEXT,
        abstract_title TEXT,
        synopsis TEXT,
        summary TEXT,
        fulltext TEXT,
        writer_prompt_snapshot BLOB,
        thumbnail TEXT,
        dialogue_count INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite table creation timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);

    // Initialize viewer_state table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS viewer_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_turn_number INTEGER,
          last_dialogue_index INTEGER,
          scene_mode TEXT DEFAULT 'mainline',
          interlude_id INTEGER,
          storage_turn_key TEXT
      )
    `);

    // Initialize arc_compression_cache table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS arc_compression_cache (
          hash TEXT PRIMARY KEY,
          compressed_text TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Initialize interlude table (non-canonical side scenes linked to a parent turn)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS chat_interludes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_name TEXT NOT NULL,
          parent_turn_id INTEGER NOT NULL,
          ordinal INTEGER NOT NULL,
          label TEXT,
          turn_context_snapshot BLOB NOT NULL,
          title TEXT,
          abstract_title TEXT,
          synopsis TEXT,
          summary TEXT,
          thumbnail TEXT,
          is_story_relevant INTEGER NOT NULL DEFAULT 0,
          integration_state TEXT NOT NULL DEFAULT 'none',
          integration_note TEXT,
          integration_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(project_name, parent_turn_id, ordinal),
          FOREIGN KEY(parent_turn_id) REFERENCES chat_turns(id) ON DELETE CASCADE
      )
    `);

    await assertCanonicalTableSchemas(db);

    Logger.log('ChapterMgmt', 'Lifecycle', `Database initialized successfully for project: ${projectFolderName}`, 'end');
  } catch (error) {
    Logger.error('ChapterMgmt', 'Lifecycle', 'Failed to initialize database.', error);
    db = null;
    throw error;
  }
}
// #endregion

// #region CORE FUNCTIONS
/**
 * Appends a TurnContext instance to the database.
 * @param {TurnContext} turnContextInstance - The TurnContext instance to save.
 * @param {string} [thumbnail=null] - Optional base64 thumbnail string.
 * @returns {Promise<number>} New message count.
 */
async function appendMessage(turnContextInstance, thumbnail = null) {
  if (!db) {
    Logger.error('ChapterMgmt', 'Persistence', 'Database not initialized. Call init() first.');
    throw new Error('Database not initialized.');
  }
  if (!currentProjectName) {
    Logger.error('ChapterMgmt', 'Persistence', 'currentProjectName not set. Call init() first.');
    throw new Error('currentProjectName not set.');
  }
  if (typeof turnContextInstance.serialize !== 'function') {
    Logger.error('ChapterMgmt', 'Persistence', 'Invalid argument: appendMessage expects a TurnContext-like instance with a serialize method.');
    throw new Error('Invalid argument: appendMessage expects a TurnContext-like instance with a serialize method.');
  }

  Logger.log('ChapterMgmt', 'Persistence', `Appending TurnContext for project: ${currentProjectName}, turn: ${turnContextInstance.creationTurnNumber}`, 'start');
  try {
    // Serialize the TurnContext, but remove any transient `processed.temp` data
    // so it doesn't get stored in the DB and waste space.
    const snapshotObj = (typeof turnContextInstance.serialize === 'function')
      ? turnContextInstance.serialize()
      : (turnContextInstance && typeof turnContextInstance === 'object' ? turnContextInstance : {});

    if (snapshotObj && snapshotObj.processed && Object.prototype.hasOwnProperty.call(snapshotObj.processed, 'temp')) {
      try {
        delete snapshotObj.processed.temp;
      } catch (e) {
        // If delete fails for some reason, log and continue with the original snapshot.
        Logger.error('ChapterMgmt', 'Persistence', `Failed to delete processed.temp from snapshot: ${e.message}`, e);
      }
    }

    const title = turnContextInstance.output?.title || "";
    const abstractTitle = turnContextInstance.output?.abstractTitle || "";
    const synopsis = turnContextInstance.output?.synopsis || "";
    const summary = turnContextInstance.output?.summary || "";
    const fulltext = getTurnFulltext(turnContextInstance);
    const dialogueCount = turnContextInstance.output?.sequence?.length || 0;
    const snapshotJson = JSON.stringify(snapshotObj);
    const compressedSnapshot = await compressString(snapshotJson);
    const writerPromptSnapshot = await buildSerializedWriterPromptSnapshot(turnContextInstance);

    // Layer 3 Safety Net: Log warning if snapshot is suspiciously large
    const COMPRESSED_SIZE_WARN_THRESHOLD = 2 * 1024 * 1024; // 2 MB compressed
    if (compressedSnapshot.length > COMPRESSED_SIZE_WARN_THRESHOLD) {
      Logger.error('ChapterMgmt', 'Persistence', `[CRITICAL SIZE WARNING] Compressed snapshot is ${(compressedSnapshot.length / 1024 / 1024).toFixed(1)} MB for turn ${turnContextInstance.creationTurnNumber}. Uncompressed: ${(snapshotJson.length / 1024 / 1024).toFixed(1)} MB. This may indicate recursive data leakage!`);
    }

    // SIMPLIFIED: Just insert a new row. The DB handles the unique ID.
    const result = await Promise.race([
      db.run(
        `INSERT INTO chat_turns (project_name, creation_turn_number, turn_context_snapshot, title, abstract_title, synopsis, summary, fulltext, writer_prompt_snapshot, thumbnail, dialogue_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [currentProjectName, turnContextInstance.creationTurnNumber, compressedSnapshot, title, abstractTitle, synopsis, summary, fulltext, writerPromptSnapshot, thumbnail, dialogueCount]
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite INSERT chat_turns timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);
    // Assign the newly generated dbId to the TurnContext instance
    if (result && result.lastID) {
      turnContextInstance.dbId = result.lastID;
      Logger.log('ChapterMgmt', 'Persistence', `Assigned new dbId ${turnContextInstance.dbId} to TurnContext instance.`);
    }
    Logger.log('ChapterMgmt', 'Persistence', `Inserted turn: project=${currentProjectName}, turn_number=${turnContextInstance.creationTurnNumber}`);


    const messageCount = await getChapterCount();
    Logger.log('ChapterMgmt', 'Persistence', `There are now ${messageCount} turns in ${currentProjectName}.db`, 'end');
    return messageCount;
  } catch (error) {
    Logger.error('ChapterMgmt', 'Persistence', `Failed to append/update TurnContext: ${error.message}`, error);
    throw error;
  }
}

/**
 * Appends an interlude TurnContext linked to an existing canonical turn.
 * Interludes do not advance canonical timeline numbering.
 * @param {number} parentTurnDbId - Canonical parent turn DB id (chat_turns.id).
 * @param {TurnContext} turnContextInstance - Generated interlude context.
 * @param {object} [options]
 * @param {string|null} [options.label=null]
 * @param {string|null} [options.thumbnail=null]
 * @param {number|null} [options.ordinal=null]
 * @param {boolean} [options.isStoryRelevant=false]
 * @param {string|null} [options.integrationState=null]
 * @param {string|null} [options.integrationNote=null]
 * @returns {Promise<{id:number, ordinal:number, isStoryRelevant:boolean, integrationState:string}>}
 */
async function appendInterlude(parentTurnDbId, turnContextInstance, options = {}) {
  if (!db) throw new Error('Database not initialized.');
  if (!currentProjectName) throw new Error('currentProjectName not set. Call init() first.');
  if (!Number.isInteger(parentTurnDbId) || parentTurnDbId < 1) throw new Error('parentTurnDbId must be a positive integer.');
  if (typeof turnContextInstance?.serialize !== 'function') {
    throw new Error('Invalid argument: appendInterlude expects a TurnContext-like instance with serialize().');
  }

  const label = options.label || null;
  const thumbnail = options.thumbnail || turnContextInstance.thumbnail || null;
  const isStoryRelevant = options.isStoryRelevant === true ? 1 : 0;
  const integrationState = normalizeInterludeIntegrationState(
    options.integrationState,
    isStoryRelevant ? 'pending' : 'none'
  );
  const integrationNote = options.integrationNote || null;

  const parent = await db.get(
    `SELECT id, creation_turn_number FROM chat_turns WHERE id = ? AND project_name = ?`,
    [parentTurnDbId, currentProjectName]
  );
  if (!parent) {
    throw new Error(`Parent turn not found for dbId=${parentTurnDbId}.`);
  }

  const requestedOrdinal = Number.isInteger(options.ordinal) && options.ordinal > 0 ? options.ordinal : null;
  const nextOrdinal = await getNextInterludeOrdinal(parentTurnDbId);
  const ordinal = requestedOrdinal || nextOrdinal;
  if (requestedOrdinal && requestedOrdinal !== nextOrdinal) {
    Logger.warn('ChapterMgmt', 'Persistence', `appendInterlude ordinal mismatch for parent=${parentTurnDbId}: requested=${requestedOrdinal}, next=${nextOrdinal}.`);
  }

  turnContextInstance.interludeOrdinal = ordinal;
  if (turnContextInstance.runtime?.interlude && typeof turnContextInstance.runtime.interlude === 'object') {
    turnContextInstance.runtime.interlude.ordinal = ordinal;
    if (Number.isInteger(parent.creation_turn_number) && parent.creation_turn_number > 0) {
      turnContextInstance.runtime.interlude.storageTurnKey = `${parent.creation_turn_number}.${ordinal}`;
    }
  }

  const snapshotObj = turnContextInstance.serialize();
  const title = turnContextInstance.output?.title || '';
  const abstractTitle = turnContextInstance.output?.abstractTitle || '';
  const synopsis = turnContextInstance.output?.synopsis || '';
  const summary = turnContextInstance.output?.summary || '';
  const snapshotJson = JSON.stringify(snapshotObj);
  const compressedSnapshot = await compressString(snapshotJson);

  const result = await db.run(
    `INSERT INTO chat_interludes
     (project_name, parent_turn_id, ordinal, label, turn_context_snapshot, title, abstract_title, synopsis, summary, thumbnail, is_story_relevant, integration_state, integration_note, integration_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [currentProjectName, parentTurnDbId, ordinal, label, compressedSnapshot, title, abstractTitle, synopsis, summary, thumbnail, isStoryRelevant, integrationState, integrationNote]
  );

  let parentRefresh = null;
  if (options.refreshParentMemory !== false) {
    try {
      parentRefresh = await refreshParentInterludeMemory(parentTurnDbId, {
        reason: `append_interlude:${result.lastID}`
      });
    } catch (error) {
      Logger.warn('ChapterMgmt', 'InterludeMemory', `Parent refresh after interlude append failed for parent dbId=${parentTurnDbId}: ${error.message}`);
    }
  }

  return {
    id: result.lastID,
    ordinal,
    isStoryRelevant: isStoryRelevant === 1,
    integrationState,
    parentRefresh
  };
}

async function getNextInterludeOrdinal(parentTurnDbId) {
  if (!db) throw new Error('Database not initialized.');
  if (!Number.isInteger(parentTurnDbId) || parentTurnDbId < 1) {
    throw new Error('parentTurnDbId must be a positive integer.');
  }

  const rows = await db.all(
    `SELECT ordinal
     FROM chat_interludes
     WHERE project_name = ? AND parent_turn_id = ?
     ORDER BY ordinal ASC`,
    [currentProjectName, parentTurnDbId]
  );
  const used = new Set(
    (Array.isArray(rows) ? rows : [])
      .map(row => Number.parseInt(row?.ordinal, 10))
      .filter(value => Number.isInteger(value) && value > 0)
  );
  let ordinal = 1;
  while (used.has(ordinal)) ordinal += 1;
  return ordinal;
}

/**
 * Returns all interlude metadata for timeline/UI display.
 * @returns {Promise<Array<object>>}
 */
async function getInterludeMetadata() {
  if (!db) return [];
  const rows = await db.all(
    `SELECT
      i.id,
      i.parent_turn_id,
      i.ordinal,
      i.label,
      i.title,
      i.abstract_title,
      i.synopsis,
      i.summary,
      i.thumbnail,
      i.is_story_relevant,
      i.integration_state,
      i.integration_note,
      t.creation_turn_number as parent_creation_turn_number
     FROM chat_interludes i
     INNER JOIN chat_turns t ON t.id = i.parent_turn_id
     WHERE i.project_name = ?
     ORDER BY i.parent_turn_id ASC, i.ordinal ASC`,
    [currentProjectName]
  );
  return rows || [];
}

/**
 * Returns a fully hydrated interlude TurnContext by interlude id.
 * @param {number} interludeId
 * @returns {Promise<TurnContext|null>}
 */
async function getInterludeContext(interludeId) {
  if (!db) return null;
  if (!Number.isInteger(interludeId) || interludeId < 1) throw new Error('interludeId must be a positive integer.');

  const row = await db.get(
    `SELECT i.id, i.parent_turn_id, i.ordinal, i.label, i.turn_context_snapshot, i.thumbnail, i.is_story_relevant, i.integration_state, i.integration_note, t.creation_turn_number as parent_creation_turn_number
     FROM chat_interludes i
     INNER JOIN chat_turns t ON t.id = i.parent_turn_id
     WHERE i.project_name = ? AND i.id = ?`,
    [currentProjectName, interludeId]
  );
  if (!row) return null;

  const decompressed = await decompressToString(row.turn_context_snapshot);
  const snapshotData = JSON.parse(decompressed);
  const tc = TurnContext.fromSnapshot(
    snapshotData,
    currentProjectName,
    row.parent_creation_turn_number,
    currentChatDbFullPath,
    currentProjectRoot,
    null,
    row.thumbnail
  );
  tc.sceneMode = 'interlude';
  tc.parentTurnDbId = row.parent_turn_id;
  tc.interludeOrdinal = row.ordinal;
  tc.turnNumber = row.parent_creation_turn_number;
  tc.runtime.interlude = {
    id: row.id,
    label: row.label || null,
    ordinal: row.ordinal,
    storageTurnKey: `${row.parent_creation_turn_number}.${row.ordinal}`,
    isStoryRelevant: row.is_story_relevant === 1,
    integrationState: normalizeInterludeIntegrationState(row.integration_state),
    integrationNote: row.integration_note || null
  };
  tc.setChapterManagement(module.exports);
  return tc;
}

async function _getInterludeRecord(interludeId) {
  return await db.get(
    `SELECT
      id,
      project_name,
      parent_turn_id,
      ordinal,
      label,
      is_story_relevant,
      integration_state,
      integration_note
     FROM chat_interludes
     WHERE project_name = ? AND id = ?`,
    [currentProjectName, interludeId]
  );
}

/**
 * Updates interlude story relevance and integration metadata.
 * This is a persistence scaffold for future canonicalization workflows.
 * @param {number} interludeId
 * @param {object} patch
 * @param {boolean} [patch.isStoryRelevant]
 * @param {string} [patch.integrationState]
 * @param {string|null} [patch.integrationNote]
 * @returns {Promise<object>}
 */
async function updateInterludeMetadata(interludeId, patch = {}) {
  if (!db) throw new Error('Database not initialized.');
  if (!Number.isInteger(interludeId) || interludeId < 1) throw new Error('interludeId must be a positive integer.');

  const existing = await _getInterludeRecord(interludeId);
  if (!existing) throw new Error(`Interlude ${interludeId} not found.`);

  const updates = [];
  const params = [];

  if (typeof patch.isStoryRelevant === 'boolean') {
    const value = patch.isStoryRelevant ? 1 : 0;
    updates.push('is_story_relevant = ?');
    params.push(value);

    if (typeof patch.integrationState !== 'string') {
      // Default state transitions when caller only toggles relevance.
      const defaultState = value === 1 ? 'pending' : 'none';
      updates.push('integration_state = ?');
      params.push(defaultState);
    }
  }

  if (typeof patch.integrationState === 'string') {
    const normalized = normalizeInterludeIntegrationState(patch.integrationState, 'none');
    updates.push('integration_state = ?');
    params.push(normalized);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'integrationNote')) {
    updates.push('integration_note = ?');
    params.push(patch.integrationNote || null);
  }

  if (updates.length === 0) {
    return {
      id: existing.id,
      parentTurnDbId: existing.parent_turn_id,
      ordinal: existing.ordinal,
      isStoryRelevant: existing.is_story_relevant === 1,
      integrationState: normalizeInterludeIntegrationState(existing.integration_state),
      integrationNote: existing.integration_note || null
    };
  }

  updates.push('integration_updated_at = CURRENT_TIMESTAMP');
  params.push(interludeId, currentProjectName);

  await db.run(
    `UPDATE chat_interludes
     SET ${updates.join(', ')}
     WHERE id = ? AND project_name = ?`,
    params
  );

  const updated = await _getInterludeRecord(interludeId);
  return {
    id: updated.id,
    parentTurnDbId: updated.parent_turn_id,
    ordinal: updated.ordinal,
    isStoryRelevant: updated.is_story_relevant === 1,
    integrationState: normalizeInterludeIntegrationState(updated.integration_state),
    integrationNote: updated.integration_note || null
  };
}

/**
 * Lists interludes that are marked story-relevant and pending integration.
 * @param {object} [options]
 * @param {number|null} [options.parentTurnDbId=null]
 * @param {number} [options.limit=50]
 * @returns {Promise<Array<object>>}
 */
async function getPendingInterludeIntegrations(options = {}) {
  if (!db) return [];
  const parentTurnDbId = Number.isInteger(options.parentTurnDbId) ? options.parentTurnDbId : null;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 50;

  let sql = `
    SELECT
      i.id,
      i.parent_turn_id,
      i.ordinal,
      i.label,
      i.title,
      i.synopsis,
      i.summary,
      i.integration_note,
      t.creation_turn_number as parent_creation_turn_number
    FROM chat_interludes i
    INNER JOIN chat_turns t ON t.id = i.parent_turn_id
    WHERE i.project_name = ?
      AND i.is_story_relevant = 1
      AND i.integration_state = 'pending'
  `;
  const params = [currentProjectName];

  if (parentTurnDbId) {
    sql += ` AND i.parent_turn_id = ?`;
    params.push(parentTurnDbId);
  }

  sql += ` ORDER BY i.parent_turn_id ASC, i.ordinal ASC LIMIT ?`;
  params.push(limit);

  const rows = await db.all(sql, params);
  return rows || [];
}

/**
 * Retrieves TurnContext skeletons for all turns in the current project.
 * @returns {Promise<Array<TurnContext>>}
 */
async function getChapterMetadata() {
  if (!db) return [];
  try {
    const rows = await db.all(
      `SELECT id, creation_turn_number, title, abstract_title, synopsis, summary, thumbnail, dialogue_count FROM chat_turns WHERE project_name = ? ORDER BY id ASC`,
      [currentProjectName]
    );
    return rows.map((row, i) => {
      const tc = new TurnContext(currentProjectName, currentChatDbFullPath, currentProjectRoot);
      tc.dbId = row.id;
      tc.creationTurnNumber = row.creation_turn_number;
      tc.turnNumber = i + 1;
      tc.output.title = row.title;
      tc.output.abstractTitle = row.abstract_title;
      tc.output.synopsis = row.synopsis;
      tc.output.summary = row.summary;
      tc.thumbnail = row.thumbnail;
      tc.dialogueCount = row.dialogue_count || 0;
      tc.isSkeleton = true;
      tc.setChapterManagement(module.exports);
      return tc;
    });
  } catch (error) {
    Logger.error('ChapterMgmt', 'Metadata', 'Failed to get chapter metadata', error);
    return [];
  }
}

/**
 * Retrieves a single TurnContext skeleton for a specific turn number.
 * @param {number} turnNumber - 1-based turn number.
 * @returns {Promise<TurnContext|null>}
 */
async function getTurnMetadata(turnNumber) {
  if (!db) return null;
  try {
    const row = await db.get(
      `SELECT id, creation_turn_number, title, abstract_title, synopsis, summary, thumbnail, dialogue_count FROM chat_turns WHERE project_name = ? ORDER BY id ASC LIMIT 1 OFFSET ?`,
      [currentProjectName, turnNumber - 1]
    );
    if (!row) return null;
    const tc = new TurnContext(currentProjectName, currentChatDbFullPath, currentProjectRoot);
    tc.dbId = row.id;
    tc.creationTurnNumber = row.creation_turn_number;
    tc.turnNumber = turnNumber;
    tc.output.title = row.title;
    tc.output.abstractTitle = row.abstract_title;
    tc.output.synopsis = row.synopsis;
    tc.output.summary = row.summary;
    tc.thumbnail = row.thumbnail;
    tc.dialogueCount = row.dialogue_count || 0;
    tc.isSkeleton = true;
    tc.setChapterManagement(module.exports);
    return tc;
  } catch (error) {
    Logger.error('ChapterMgmt', 'Metadata', `Failed to get turn metadata for ${turnNumber}`, error);
    return null;
  }
}

/**
 * Fetches the full turn_context_snapshot JSON from the database and decompresses it.
 * @param {number} id - The permanent database ID of the turn.
 * @returns {Promise<object|null>}
 */
async function getTurnBlob(id) {
  if (!db) return null;

  // Cache hit: return the already-decompressed snapshot without touching SQLite
  if (_blobCache.has(id)) {
    Logger.log('ChapterMgmt', 'BlobCache', `Cache hit for blob dbId=${id}`);
    return _blobCache.get(id);
  }

  try {
    const row = await db.get(`SELECT turn_context_snapshot FROM chat_turns WHERE id = ?`, [id]);
    if (!row) return null;

    const decompressed = await decompressToString(row.turn_context_snapshot);
    const snapshot = JSON.parse(decompressed);
    _blobCache.set(id, snapshot);
    return snapshot;
  } catch (error) {
    Logger.error('ChapterMgmt', 'Blob', `Failed to get turn blob for ID ${id}`, error);
    return null;
  }
}

async function getWriterPromptSnapshotByDbId(dbId) {
  if (!db) return null;
  if (!Number.isInteger(dbId) || dbId < 1) throw new Error('dbId must be a positive integer.');

  try {
    const row = await db.get(
      `SELECT writer_prompt_snapshot FROM chat_turns WHERE project_name = ? AND id = ?`,
      [currentProjectName, dbId]
    );
    const compressed = row?.writer_prompt_snapshot;
    if (!compressed) return null;

    const decoded = await deserializeWriterPromptSnapshot(compressed);
    if (!decoded) return null;

    if (decoded.incompatible) {
      Logger.warn('ChapterMgmt', 'PromptSnapshot', `Incompatible writer prompt snapshot schema on turn dbId=${dbId}. Falling back to rebuild.`);
      return null;
    }

    return decoded.payload || null;
  } catch (error) {
    Logger.error('ChapterMgmt', 'PromptSnapshot', `Failed to load writer prompt snapshot for dbId=${dbId}`, error);
    return null;
  }
}

/**
 * Retrieves all TurnContext instances for the current project.
 * By default, it returns skeletons for performance.
 * @returns {Promise<Array<TurnContext>>} An array of TurnContext instances.
 */
async function getChapters() {
  Logger.log('ChapterMgmt', 'Query', `getChapters CALLED FOR PROJECT: [${currentProjectName}]. Returning SKELETONS.`, 'start');
  return await getChapterMetadata();
}

async function getChapterCount() {
  if (!db) return 0;
  const result = await db.get(`SELECT COUNT(*) as count FROM chat_turns WHERE project_name = ?`, [currentProjectName]);
  return result ? result.count : 0;
}

function normalizeViewerStateForSave(turnNumberOrState, dialogueIndex) {
  const rawState = (turnNumberOrState && typeof turnNumberOrState === 'object')
    ? turnNumberOrState
    : { turnNumber: turnNumberOrState, dialogueIndex };
  const parsedTurnNumber = Number.parseInt(rawState.turnNumber, 10);
  const parsedDialogueIndex = Number.parseInt(rawState.dialogueIndex, 10);
  const sceneMode = String(rawState.sceneMode || 'mainline').trim().toLowerCase() === 'interlude'
    ? 'interlude'
    : 'mainline';
  const parsedInterludeId = Number.parseInt(rawState.interludeId, 10);
  const interludeId = sceneMode === 'interlude' && Number.isInteger(parsedInterludeId) && parsedInterludeId > 0
    ? parsedInterludeId
    : null;

  return {
    turnNumber: Number.isInteger(parsedTurnNumber) ? parsedTurnNumber : 0,
    dialogueIndex: Number.isInteger(parsedDialogueIndex) && parsedDialogueIndex >= 0 ? parsedDialogueIndex : 0,
    sceneMode: interludeId ? 'interlude' : 'mainline',
    interludeId,
    storageTurnKey: typeof rawState.storageTurnKey === 'string' && rawState.storageTurnKey.trim()
      ? rawState.storageTurnKey.trim()
      : null
  };
}

/**
 * Saves the current viewer state (scene identity, turn, and dialogue position) to the database.
 * @param {number|object} turnNumberOrState - Legacy turn number or full viewer state payload.
 * @param {number} [dialogueIndex] - Legacy dialogue index.
 */
async function saveViewerState(turnNumberOrState, dialogueIndex) {
  if (!db) return;
  try {
    const state = normalizeViewerStateForSave(turnNumberOrState, dialogueIndex);
    await db.run(`
      INSERT INTO viewer_state (id, last_turn_number, last_dialogue_index, scene_mode, interlude_id, storage_turn_key)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_turn_number = excluded.last_turn_number,
        last_dialogue_index = excluded.last_dialogue_index,
        scene_mode = excluded.scene_mode,
        interlude_id = excluded.interlude_id,
        storage_turn_key = excluded.storage_turn_key
    `, [state.turnNumber, state.dialogueIndex, state.sceneMode, state.interludeId, state.storageTurnKey]);
  } catch (error) {
    Logger.error('ChapterMgmt', 'Persistence', 'Failed to save viewer state', error);
  }
}

/**
 * Retrieves the last saved viewer state.
 * @returns {Promise<{turnNumber: number, dialogueIndex: number, sceneMode: string, interludeId: number|null, storageTurnKey: string|null}|null>}
 */
async function getViewerState() {
  if (!db) return null;
  try {
    const row = await db.get(`
      SELECT last_turn_number, last_dialogue_index, scene_mode, interlude_id, storage_turn_key
      FROM viewer_state
      WHERE id = 1
    `);
    if (row) {
      const parsedTurnNumber = Number.parseInt(row.last_turn_number, 10);
      if (!Number.isInteger(parsedTurnNumber) || parsedTurnNumber <= 0) {
        return null;
      }

      const sceneMode = String(row.scene_mode || 'mainline').toLowerCase() === 'interlude'
        ? 'interlude'
        : 'mainline';
      const parsedInterludeId = Number.parseInt(row.interlude_id, 10);
      return {
        turnNumber: parsedTurnNumber,
        dialogueIndex: row.last_dialogue_index,
        sceneMode,
        interludeId: sceneMode === 'interlude' && Number.isInteger(parsedInterludeId) && parsedInterludeId > 0
          ? parsedInterludeId
          : null,
        storageTurnKey: row.storage_turn_key || null
      };
    }
    return null;
  } catch (error) {
    Logger.error('ChapterMgmt', 'Persistence', 'Failed to get viewer state', error);
    return null;
  }
}

/**
 * Retrieves cached compressed text for an Arc.
 * @param {string} hash - The hash of the combined synopses text.
 * @returns {Promise<string|null>} The compressed text, or null if not found.
 */
async function getArcCompression(hash) {
  if (!db) return null;
  try {
    const row = await db.get(`SELECT compressed_text FROM arc_compression_cache WHERE hash = ?`, [hash]);
    return row ? row.compressed_text : null;
  } catch (error) {
    Logger.error('ChapterMgmt', 'ArcCompression', `Failed to get arc compression for hash ${hash}`, error);
    return null;
  }
}

function getArcCompressionCacheLimit() {
  const settings = readSettings();
  const rawLimit = settings?.infrastructure?.narrative_history?.memory_lod?.arc_compression_cache_limit ??
    settings?.infrastructure?.narrative_history?.memory_lod?.arcCompressionCacheLimit ??
    settings?.infrastructure?.narrative_history?.compressed_history?.arc_tail?.cache_limit ??
    settings?.infrastructure?.narrative_history?.compressed_history?.arc_tail?.cacheLimit;
  const parsed = Number(rawLimit);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 200;
}

/**
 * Saves compressed text for an Arc into the cache.
 * @param {string} hash - The hash of the combined synopses text.
 * @param {string} compressedText - The LLM-generated compression.
 */
async function saveArcCompression(hash, compressedText) {
  if (!db) return;
  try {
    const cacheLimit = getArcCompressionCacheLimit();
    await db.run(`
      INSERT OR REPLACE INTO arc_compression_cache (hash, compressed_text)
      VALUES (?, ?)
    `, [hash, compressedText]);

    // Trim old arc summaries without involving the unrelated dev cache.
    await db.run(`
      DELETE FROM arc_compression_cache
      WHERE hash NOT IN (
          SELECT hash FROM arc_compression_cache
          ORDER BY timestamp DESC
          LIMIT ?
      )
    `, [cacheLimit]);
  } catch (error) {
    Logger.error('ChapterMgmt', 'ArcCompression', `Failed to save arc compression for hash ${hash}`, error);
  }
}

/**
 * Retrieves the TurnContext for a specific chapter number.

/**
 * Categorizes TurnContext instances into full, summary, and synopsis sections.
 * Supports metadata-first retrieval and batch inflation for performance.
 * @param {object} overrides - Optional turn-based tier overrides (e.g., { 5: 'full' }).
 * @param {object} options - Optional retrieval options.
 * @param {number|null} options.maxTurnNumber - Upper bound (inclusive) using creation turn numbers.
 * @returns {Promise<{fullchapters: Array<TurnContext>, summarychapters: Array<TurnContext>, synopsischapters: Array<TurnContext>}>}
 */
async function retrieveDatedChapters(overrides = {}, options = {}) {
  const allSkeletons = await getChapterMetadata();
  const parsedMaxTurn = Number.parseInt(options?.maxTurnNumber, 10);
  const hasMaxTurnBound = Number.isInteger(parsedMaxTurn) && parsedMaxTurn > 0;

  const boundedSkeletons = hasMaxTurnBound
    ? allSkeletons.filter((skeleton) => {
      const creationTurnNumber = Number.isInteger(skeleton?.creationTurnNumber) && skeleton.creationTurnNumber > 0
        ? skeleton.creationTurnNumber
        : null;
      const dynamicTurnNumber = Number.isInteger(skeleton?.turnNumber) && skeleton.turnNumber > 0
        ? skeleton.turnNumber
        : null;
      const candidateTurnNumber = creationTurnNumber || dynamicTurnNumber || Number.MAX_SAFE_INTEGER;
      return candidateTurnNumber <= parsedMaxTurn;
    })
    : allSkeletons;

  if (hasMaxTurnBound && boundedSkeletons.length !== allSkeletons.length) {
    Logger.log(
      'ChapterMgmt',
      'HistoryBoundary',
      `retrieveDatedChapters applied maxTurnNumber=${parsedMaxTurn} (kept ${boundedSkeletons.length}/${allSkeletons.length} chapters).`
    );
  }

  const total = boundedSkeletons.length;

  const fullStart = Math.max(total - CONFIG.FULL_CHAPTERS, 0);
  const summaryStart = Math.max(fullStart - CONFIG.SUMMARY_CHAPTERS, 0);

  // Calculate synopsis start if a limit is set, otherwise it's 0.
  let synopsisStart = 0;
  if (CONFIG.SYNOPSIS_CHAPTERS !== -1) {
    synopsisStart = Math.max(summaryStart - CONFIG.SYNOPSIS_CHAPTERS, 0);
  }

  const fullChapters = [];
  const summaryChapters = [];
  const synopsisChapters = [];

  for (let i = 0; i < total; i++) {
    const turnNum = i + 1;
    const skeleton = boundedSkeletons[i];
    let tier = null;

    if (i >= fullStart) tier = 'full';
    else if (i >= summaryStart) tier = 'summary';
    else if (i >= synopsisStart) tier = 'synopsis';

    // Apply Overrides from TurnContext.processed.historyOverrides
    if (overrides && overrides[turnNum]) {
      tier = overrides[turnNum];
      Logger.log('ChapterMgmt', 'Tiering', `Applying override for turn ${turnNum}: ${tier}`);
    }

    if (tier === 'full') fullChapters.push(skeleton);
    else if (tier === 'summary') summaryChapters.push(skeleton);
    else if (tier === 'synopsis') synopsisChapters.push(skeleton);
  }

  // Batch Inflation for 'full' chapters to ensure they have the full snapshot
  if (fullChapters.length > 0) {
    const ids = fullChapters.map(c => c.dbId);
    const blobs = await getTurnBlobs(ids);
    for (const skeleton of fullChapters) {
      const blob = blobs.find(b => b.id === skeleton.dbId);
      if (blob) {
        skeleton.inflate(blob.snapshot);
      }
    }
  }

  return {
    fullchapters: fullChapters,
    summarychapters: summaryChapters,
    synopsischapters: synopsisChapters,
  };
}
// #endregion

// configure remains the same

// #region EXPORTS
/**
 * Fetches multiple turn_context_snapshot JSONs from the database in a single pass.
 * @param {Array<number>} ids - Array of permanent database IDs.
 * @returns {Promise<Array<{id: number, snapshot: object}>>}
 */
async function getTurnBlobs(ids) {
  if (!db || !ids || ids.length === 0) return [];
  try {
    // Serve cached entries immediately; only query SQLite for cache misses
    const results = [];
    const missIds = [];

    for (const id of ids) {
      if (_blobCache.has(id)) {
        Logger.log('ChapterMgmt', 'BlobCache', `Cache hit for blob dbId=${id} (batch)`);
        results.push({ id, snapshot: _blobCache.get(id) });
      } else {
        missIds.push(id);
      }
    }

    if (missIds.length > 0) {
      const placeholders = missIds.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT id, turn_context_snapshot FROM chat_turns WHERE id IN (${placeholders})`,
        missIds
      );
      for (const row of rows) {
        const decompressed = await decompressToString(row.turn_context_snapshot);
        const snapshot = JSON.parse(decompressed);
        _blobCache.set(row.id, snapshot);
        results.push({ id: row.id, snapshot });
      }
    }

    return results;
  } catch (error) {
    Logger.error('ChapterMgmt', 'Blob', `Failed to batch fetch turn blobs`, error);
    return [];
  }
}

/**
 * Retrieves a specific TurnContext entry by 1-based index (entry number X).
 * @param {number} index - 1-based entry index to retrieve (1 = first entry).
 * @returns {Promise<TurnContext|null>} The TurnContext instance, or null if not found.
 */
async function getTurnContext(index) {
  if (!db) {
    Logger.warn('ChapterMgmt', 'Query', 'getTurnContext called but database is not initialized. Returning null.');
    return null;
  }
  if (!currentProjectName) {
    Logger.error('ChapterMgmt', 'Query', 'currentProjectName not set. Call init() first.');
    throw new Error('currentProjectName not set.');
  }
  if (!Number.isInteger(index) || index < 1) {
    throw new Error('index must be a positive integer (1-based).');
  }

  try {
    // Logger.log('ChapterMgmt', 'Query', `Retrieving TurnContext by index ${index} for project: ${currentProjectName}`, 'start');
    const row = await Promise.race([
      db.get(
        `SELECT id, creation_turn_number, turn_context_snapshot, thumbnail FROM chat_turns WHERE project_name = ? ORDER BY id ASC LIMIT 1 OFFSET ?`,
        [currentProjectName, index - 1]
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite getTurnContext timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);

    if (row && row.turn_context_snapshot) {
      const decompressed = await decompressToString(row.turn_context_snapshot);
      const snapshotData = JSON.parse(decompressed);
      const turnContextInstance = TurnContext.fromSnapshot(snapshotData, currentProjectName, row.creation_turn_number, currentChatDbFullPath, currentProjectRoot, row.id, row.thumbnail);

      // SET THE DYNAMIC TURN NUMBER - we know it because the system asked for it by index.
      turnContextInstance.turnNumber = index;

      turnContextInstance.setChapterManagement(module.exports);
      // Logger.log('ChapterMgmt', 'Query', `Successfully retrieved TurnContext at index ${index}.`, 'end');
      return turnContextInstance;
    }
    Logger.log('ChapterMgmt', 'Query', `No TurnContext found at index ${index}.`, 'end');
    return null;
  } catch (error) {
    Logger.error('ChapterMgmt', 'Query', `Failed to retrieve TurnContext by index ${index}: ${error.message}`, error);
    throw error;
  }
}

/**
 * Retrieves a TurnContext by permanent DB ID.
 * @param {number} dbId
 * @returns {Promise<TurnContext|null>}
 */
async function getTurnContextByDbId(dbId) {
  if (!db) {
    Logger.warn('ChapterMgmt', 'Query', 'getTurnContextByDbId called but database is not initialized. Returning null.');
    return null;
  }
  if (!Number.isInteger(dbId) || dbId < 1) throw new Error('dbId must be a positive integer.');

  const row = await db.get(
    `SELECT id, creation_turn_number, turn_context_snapshot, thumbnail
     FROM chat_turns
     WHERE project_name = ? AND id = ?`,
    [currentProjectName, dbId]
  );
  if (!row || !row.turn_context_snapshot) return null;

  const decompressed = await decompressToString(row.turn_context_snapshot);
  const snapshotData = JSON.parse(decompressed);
  const turnContext = TurnContext.fromSnapshot(
    snapshotData,
    currentProjectName,
    row.creation_turn_number,
    currentChatDbFullPath,
    currentProjectRoot,
    row.id,
    row.thumbnail
  );
  turnContext.turnNumber = await getPositionOfTurn(row.id);
  turnContext.setChapterManagement(module.exports);
  return turnContext;
}

async function getTurnContextByCreationTurnNumber(creationTurnNumber) {
  if (!db) {
    Logger.warn('ChapterMgmt', 'Query', 'getTurnContextByCreationTurnNumber called but database is not initialized. Returning null.');
    return null;
  }
  if (!Number.isInteger(creationTurnNumber) || creationTurnNumber < 1) {
    throw new Error('creationTurnNumber must be a positive integer.');
  }

  const row = await db.get(
    `SELECT id
     FROM chat_turns
     WHERE project_name = ? AND creation_turn_number = ?
     ORDER BY id DESC
     LIMIT 1`,
    [currentProjectName, creationTurnNumber]
  );
  if (!row?.id) return null;
  return await getTurnContextByDbId(row.id);
}

async function getLatestTurnContext() {
  if (!db) {
    Logger.warn('ChapterMgmt', 'Query', 'getLatestTurnContext called but database is not initialized. Returning null.');
    return null;
  }

  const row = await db.get(
    `SELECT id
     FROM chat_turns
     WHERE project_name = ?
     ORDER BY id DESC
     LIMIT 1`,
    [currentProjectName]
  );
  if (!row?.id) return null;
  return await getTurnContextByDbId(row.id);
}

async function getInterludeContextByParentAndOrdinal(parentCreationTurnNumber, ordinal) {
  if (!db) return null;
  if (!Number.isInteger(parentCreationTurnNumber) || parentCreationTurnNumber < 1) return null;
  if (!Number.isInteger(ordinal) || ordinal < 1) return null;

  const row = await db.get(
    `SELECT i.id
     FROM chat_interludes i
     INNER JOIN chat_turns t ON t.id = i.parent_turn_id
     WHERE i.project_name = ?
       AND t.project_name = i.project_name
       AND t.creation_turn_number = ?
       AND i.ordinal = ?
     ORDER BY i.id DESC
     LIMIT 1`,
    [currentProjectName, parentCreationTurnNumber, ordinal]
  );

  if (!row?.id) return null;
  return await getInterludeContext(row.id);
}

async function getTurnContextByStorageKey(storageKey) {
  const parsed = parseTurnStorageKey(storageKey);
  if (!parsed) return null;

  if (Number.isInteger(parsed.ordinal) && parsed.ordinal > 0) {
    return await getInterludeContextByParentAndOrdinal(parsed.baseTurn, parsed.ordinal);
  }

  return await getTurnContextByCreationTurnNumber(parsed.baseTurn);
}

function buildInterludeCapsuleText(interlude, interludeTc) {
  const source = interlude.integration_note
    || interlude.summary
    || interlude.synopsis
    || interlude.title
    || interludeTc?.output?.summary
    || interludeTc?.output?.synopsis
    || interludeTc?.output?.title
    || '';
  const compact = String(source || '').trim().replace(/\s+/g, ' ');
  if (!compact) return '';
  const maxLen = 600;
  const clipped = compact.length > maxLen ? `${compact.slice(0, maxLen - 3)}...` : compact;
  return clipped;
}

async function getInterludesForParent(parentTurnDbId, options = {}) {
  if (!db) return [];
  if (!Number.isInteger(parentTurnDbId) || parentTurnDbId < 1) return [];
  const includeAllInterludes = options.includeAllInterludes !== false;

  let sql = `
    SELECT
      id,
      parent_turn_id,
      ordinal,
      label,
      title,
      synopsis,
      summary,
      is_story_relevant,
      integration_state,
      integration_note
    FROM chat_interludes
    WHERE project_name = ?
      AND parent_turn_id = ?
  `;
  const params = [currentProjectName, parentTurnDbId];
  if (!includeAllInterludes) {
    sql += ` AND is_story_relevant = 1`;
  }
  sql += ` ORDER BY ordinal ASC`;

  const rows = await db.all(sql, params);
  return Array.isArray(rows) ? rows : [];
}

async function buildInterludeCapsulesForParent(parentTurnDbId, parentTurnNumber, options = {}) {
  const interludes = await getInterludesForParent(parentTurnDbId, options);
  if (!Array.isArray(interludes) || interludes.length === 0) return [];

  const capsules = await Promise.all(interludes.map(async (row) => {
    let text = buildInterludeCapsuleText(row, null);
    if (!text) {
      try {
        const interludeTc = await getInterludeContext(row.id);
        text = buildInterludeCapsuleText(row, interludeTc);
      } catch {
        text = '';
      }
    }
    if (!text) return null;

    return {
      interludeId: row.id,
      parentTurnDbId,
      ordinal: row.ordinal,
      label: row.label || null,
      capsule: text,
      sourceState: normalizeInterludeIntegrationState(row.integration_state, 'none'),
      isStoryRelevant: row.is_story_relevant === 1,
      displayTurn: `${parentTurnNumber}.${row.ordinal}`,
      integratedAt: new Date().toISOString()
    };
  }));

  return capsules
    .filter(Boolean)
    .sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
}

function composeParentNarrativeForMemory(parentTurn, capsules = []) {
  const baseNarrative = String(
    parentTurn?.processed?.dialogueProcessor?.dialogue
    || parentTurn?.output?.fulltext
    || parentTurn?.output?.summary
    || parentTurn?.output?.synopsis
    || ''
  ).trim();

  if (!Array.isArray(capsules) || capsules.length === 0) {
    return baseNarrative;
  }

  const lines = capsules.map(c => {
    const label = c.label ? ` - ${c.label}` : '';
    return `- ${c.displayTurn}${label}: ${c.capsule}`;
  });
  const interludeBlock = `[Interlude Summaries]\n${lines.join('\n')}`;
  return baseNarrative ? `${baseNarrative}\n\n${interludeBlock}` : interludeBlock;
}

/**
 * Rebuilds parent chapter memory from its live interlude list.
 * This keeps capsules, summary/synopsis, and RAG embeddings in sync after
 * interlude create/delete/integration operations.
 * @param {number} parentTurnDbId
 * @param {object} [options]
 * @param {boolean} [options.includeAllInterludes=true]
 * @param {boolean} [options.recomputeNarrativeArtifacts=true]
 * @param {boolean} [options.updateRag=true]
 * @param {string} [options.reason='unspecified']
 * @returns {Promise<object|null>}
 */
async function refreshParentInterludeMemory(parentTurnDbId, options = {}) {
  if (!db) throw new Error('Database not initialized.');
  if (!Number.isInteger(parentTurnDbId) || parentTurnDbId < 1) {
    throw new Error('parentTurnDbId must be a positive integer.');
  }

  const reason = typeof options.reason === 'string' ? options.reason : 'unspecified';
  const includeAllInterludes = options.includeAllInterludes !== false;
  const recomputeNarrativeArtifacts = options.recomputeNarrativeArtifacts !== false;
  const updateRag = options.updateRag !== false;

  const parentTurn = await getTurnContextByDbId(parentTurnDbId);
  if (!parentTurn) return null;

  const parentTurnNumber = Number.isInteger(parentTurn.creationTurnNumber) && parentTurn.creationTurnNumber > 0
    ? parentTurn.creationTurnNumber
    : parentTurn.turnNumber;

  const capsules = await buildInterludeCapsulesForParent(parentTurnDbId, parentTurnNumber, { includeAllInterludes });

  if (!parentTurn.processed.plugins || typeof parentTurn.processed.plugins !== 'object') {
    parentTurn.processed.plugins = {};
  }
  parentTurn.processed.plugins.interludeCapsules = capsules;

  const composedNarrative = composeParentNarrativeForMemory(parentTurn, capsules);
  let summaryUpdated = false;
  let synopsisUpdated = false;
  let ragUpdated = false;

  if (recomputeNarrativeArtifacts && composedNarrative) {
    try {
      const summary = await memorymanagement.SummarizationService.generateSummary(
        parentTurn,
        composedNarrative,
        { includeUserPrompt: true }
      );
      if (typeof summary === 'string' && summary.trim()) {
        parentTurn.output.summary = summary.trim();
        summaryUpdated = true;
      }
    } catch (error) {
      Logger.warn('ChapterMgmt', 'InterludeMemory', `Parent summary recompute failed for dbId=${parentTurnDbId}: ${error.message}`);
    }

    try {
      const synopsisResult = await memorymanagement.SummarizationService.generateSynopsis(
        parentTurn,
        composedNarrative,
        { includeUserPrompt: true }
      );
      const synopsis = typeof synopsisResult?.synopsis === 'string' ? synopsisResult.synopsis.trim() : '';
      if (synopsis) {
        parentTurn.output.synopsis = synopsis;
        synopsisUpdated = true;
      }
    } catch (error) {
      Logger.warn('ChapterMgmt', 'InterludeMemory', `Parent synopsis recompute failed for dbId=${parentTurnDbId}: ${error.message}`);
    }
  }

  if (updateRag && composedNarrative) {
    const ragTurnNumber = Number.isInteger(parentTurn.creationTurnNumber) && parentTurn.creationTurnNumber > 0
      ? parentTurn.creationTurnNumber
      : parentTurn.turnNumber;
    try {
      const overview = parentTurn.output.synopsis || parentTurn.output.summary || parentTurn.output.title || '';
      await memorymanagement.updateChapter(
        composedNarrative,
        ragTurnNumber,
        { overview, turn_number: ragTurnNumber },
        currentProjectName
      );
      ragUpdated = true;
    } catch (error) {
      Logger.warn('ChapterMgmt', 'InterludeMemory', `Parent RAG refresh failed for dbId=${parentTurnDbId}: ${error.message}`);
    }
  }

  await updateTurn(parentTurn);
  _blobCache.delete(parentTurnDbId);

  Logger.log(
    'ChapterMgmt',
    'InterludeMemory',
    `Refreshed parent interlude memory for turn dbId=${parentTurnDbId} (${reason}). Capsules=${capsules.length}, summaryUpdated=${summaryUpdated}, synopsisUpdated=${synopsisUpdated}, ragUpdated=${ragUpdated}`
  );

  return {
    parentTurnDbId,
    parentTurnNumber,
    capsulesCount: capsules.length,
    summaryUpdated,
    synopsisUpdated,
    ragUpdated,
    reason
  };
}

/**
 * Integrates a story-relevant interlude into its parent turn as a memory capsule.
 * This does not alter canonical fulltext; it enriches parent structured memory fields.
 * @param {number} interludeId
 * @param {object} [options]
 * @param {boolean} [options.force=false]
 * @returns {Promise<object>}
 */
async function integrateInterludeIntoParent(interludeId, options = {}) {
  if (!db) throw new Error('Database not initialized.');
  if (!Number.isInteger(interludeId) || interludeId < 1) throw new Error('interludeId must be a positive integer.');
  const force = options.force === true;

  const interlude = await _getInterludeRecord(interludeId);
  if (!interlude) throw new Error(`Interlude ${interludeId} not found.`);

  const isStoryRelevant = interlude.is_story_relevant === 1;
  const currentState = normalizeInterludeIntegrationState(interlude.integration_state);

  if (!isStoryRelevant && !force) {
    throw new Error(`Interlude ${interludeId} is not story-relevant.`);
  }
  if (!force && currentState !== 'pending') {
    throw new Error(`Interlude ${interludeId} is not pending integration (state=${currentState}).`);
  }

  const parentTurn = await getTurnContextByDbId(interlude.parent_turn_id);
  if (!parentTurn) throw new Error(`Parent turn dbId=${interlude.parent_turn_id} not found.`);

  const interludeTc = await getInterludeContext(interludeId);
  if (!interludeTc) throw new Error(`Interlude context ${interludeId} not found.`);

  const capsuleText = buildInterludeCapsuleText(interlude, interludeTc);
  if (!capsuleText) throw new Error(`Interlude ${interludeId} has no usable capsule content.`);

  const integrationSummary = `[Integrated ${parentTurn.turnNumber}.${interlude.ordinal}] ${capsuleText}`;
  const updatedMeta = await updateInterludeMetadata(interludeId, {
    isStoryRelevant: true,
    integrationState: 'integrated',
    integrationNote: integrationSummary
  });

  let parentRefresh = null;
  try {
    parentRefresh = await refreshParentInterludeMemory(interlude.parent_turn_id, {
      reason: `integrate_interlude:${interludeId}`
    });
  } catch (error) {
    Logger.warn('ChapterMgmt', 'InterludeMemory', `Parent refresh after interlude integration failed for parent dbId=${interlude.parent_turn_id}: ${error.message}`);
  }

  return {
    interludeId,
    parentTurnDbId: interlude.parent_turn_id,
    parentTurnNumber: parentTurn.turnNumber,
    ordinal: interlude.ordinal,
    displayTurn: `${parentTurn.turnNumber}.${interlude.ordinal}`,
    capsule: capsuleText,
    interlude: updatedMeta,
    parentRefresh
  };
}
/**
 * Deletes a single interlude by id.
 * Also removes its plugin storage folder (<parentTurnNumber>.<ordinal>) when present.
 * @param {number} interludeId
 * @returns {Promise<{interludeId:number,parentTurnDbId:number,parentTurnNumber:number,ordinal:number}|null>}
 */
async function deleteInterlude(interludeId) {
  if (!db) {
    Logger.error('ChapterMgmt', 'Persistence', 'Database not initialized. Call init() first.');
    throw new Error('Database not initialized.');
  }
  if (!currentProjectName) {
    Logger.error('ChapterMgmt', 'Persistence', 'currentProjectName not set. Call init() first.');
    throw new Error('currentProjectName not set.');
  }
  if (!Number.isInteger(interludeId) || interludeId < 1) {
    throw new Error('interludeId must be a positive integer.');
  }

  const row = await db.get(
    `SELECT i.id, i.parent_turn_id, i.ordinal, t.creation_turn_number as parent_turn_number
     FROM chat_interludes i
     INNER JOIN chat_turns t ON t.id = i.parent_turn_id
     WHERE i.project_name = ? AND i.id = ?`,
    [currentProjectName, interludeId]
  );

  if (!row) return null;

  const parentTurnNumber = Number.isInteger(row.parent_turn_number) ? row.parent_turn_number : null;
  const ordinal = Number.isInteger(row.ordinal) ? row.ordinal : null;

  if (currentChatDbFullPath && currentProjectRoot && Number.isInteger(parentTurnNumber) && Number.isInteger(ordinal)) {
    const chatName = path.basename(currentChatDbFullPath, '.db');
    const interludeDir = path.join(currentProjectRoot, 'plugins', chatName, `${parentTurnNumber}.${ordinal}`);
    try {
      await fs.rm(interludeDir, { recursive: true, force: true });
      Logger.log('ChapterMgmt', 'Persistence', `Physically deleted interlude plugin storage: ${interludeDir}`);
    } catch {
      Logger.warn('ChapterMgmt', 'Persistence', `Failed to delete interlude plugin storage: ${interludeDir}`);
    }
  }

  if (Number.isInteger(parentTurnNumber) && Number.isInteger(ordinal)) {
    await cleanupFactsByTurnKeyExact(`${parentTurnNumber}.${ordinal}`);
  }

  await db.run(
    `DELETE FROM chat_interludes WHERE project_name = ? AND id = ?`,
    [currentProjectName, interludeId]
  );

  let parentRefresh = null;
  try {
    parentRefresh = await refreshParentInterludeMemory(row.parent_turn_id, {
      reason: `delete_interlude:${interludeId}`
    });
  } catch (error) {
    Logger.warn('ChapterMgmt', 'InterludeMemory', `Parent refresh after interlude delete failed for parent dbId=${row.parent_turn_id}: ${error.message}`);
  }

  return {
    interludeId: row.id,
    parentTurnDbId: row.parent_turn_id,
    parentTurnNumber,
    ordinal,
    parentRefresh
  };
}

/**
 * Deletes the latest turn for the current project.
 * @returns {Promise<boolean>} True if a turn was deleted, false otherwise.
 */
//TODO, it needs to be changed since we now have creation_turn_number and id
async function deleteLatestTurn() {
  if (!db) {
    Logger.error('ChapterMgmt', 'Persistence', 'Database not initialized. Call init() first.');
    throw new Error('Database not initialized.');
  }
  if (!currentProjectName) {
    Logger.error('ChapterMgmt', 'Persistence', 'currentProjectName not set. Call init() first.');
    throw new Error('currentProjectName not set.');
  }

  Logger.log('ChapterMgmt', 'Persistence', `Attempting to delete the latest turn for project: ${currentProjectName}`, 'start');
  try {
    const latestTurn = await Promise.race([
      db.get(
        `SELECT id, creation_turn_number FROM chat_turns WHERE project_name = ? ORDER BY id DESC LIMIT 1`,
        [currentProjectName]
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite deleteLatestTurn (get latest row) timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);

    if (latestTurn && Number.isInteger(latestTurn.id)) {
      const idToDelete = latestTurn.id;
      const creationTurnNumber = Number.isInteger(latestTurn.creation_turn_number) ? latestTurn.creation_turn_number : null;
      const interludes = await db.all(
        `SELECT id, ordinal FROM chat_interludes WHERE project_name = ? AND parent_turn_id = ? ORDER BY ordinal ASC`,
        [currentProjectName, idToDelete]
      );

      // Physically delete the plugin storage for this turn if it exists
      if (currentChatDbFullPath && currentProjectRoot) {
        const chatName = path.basename(currentChatDbFullPath, '.db');
        const turnDir = creationTurnNumber
          ? path.join(currentProjectRoot, 'plugins', chatName, String(creationTurnNumber))
          : null;
        const pluginChatDir = path.join(currentProjectRoot, 'plugins', chatName);
        try {
          if (turnDir) {
            await fs.rm(turnDir, { recursive: true, force: true });
            Logger.log('ChapterMgmt', 'Persistence', `Physically deleted plugin storage for turn ${creationTurnNumber} at: ${turnDir}`);
          }

          if (creationTurnNumber) {
            const entries = await fs.readdir(pluginChatDir, { withFileTypes: true }).catch(() => []);
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;
              if (!entry.name.startsWith(`${creationTurnNumber}.`)) continue;
              const interludeDir = path.join(pluginChatDir, entry.name);
              await fs.rm(interludeDir, { recursive: true, force: true });
              Logger.log('ChapterMgmt', 'Persistence', `Physically deleted interlude plugin storage: ${interludeDir}`);
            }
          }
        } catch {
          Logger.warn('ChapterMgmt', 'Persistence', `Failed to delete plugin storage for turn ${creationTurnNumber || idToDelete}.`);
        }
      }

      await db.run(
        `DELETE FROM chat_interludes WHERE project_name = ? AND parent_turn_id = ?`,
        [currentProjectName, idToDelete]
      );

      if (Number.isInteger(creationTurnNumber) && creationTurnNumber > 0) {
        await cleanupFactsByBaseTurn(creationTurnNumber);
      }

      await Promise.race([
        db.run(
          `DELETE FROM chat_turns WHERE project_name = ? AND id = ?`, // Use the 'id' column
          [currentProjectName, idToDelete]
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("SQLite deleteLatestTurn (DELETE) timed out")), DB_OPERATION_TIMEOUT)
        )
      ]);
      _blobCache.delete(idToDelete);
      Logger.log('ChapterMgmt', 'Persistence', `Deleted turn dbId=${idToDelete} and ${interludes.length} attached interlude(s).`);
      Logger.log('ChapterMgmt', 'Persistence', `Successfully deleted turn with id ${idToDelete} for project: ${currentProjectName}`, 'end');
      return true;
    } else {
      Logger.log('ChapterMgmt', 'Persistence', `No turns found to delete for project: ${currentProjectName}`, 'end');
      return false;
    }
  } catch (error) {
    Logger.error('ChapterMgmt', 'Persistence', `Failed to delete latest turn: ${error.message}`, error);
    throw error;
  }
}

async function deleteTurnIfLatest(dbId) {
  if (!Number.isInteger(dbId) || dbId < 1) return false;
  if (!db) {
    Logger.error('ChapterMgmt', 'Persistence', 'Database not initialized. Call init() first.');
    throw new Error('Database not initialized.');
  }
  if (!currentProjectName) {
    Logger.error('ChapterMgmt', 'Persistence', 'currentProjectName not set. Call init() first.');
    throw new Error('currentProjectName not set.');
  }

  const latestTurn = await Promise.race([
    db.get(
      `SELECT id FROM chat_turns WHERE project_name = ? ORDER BY id DESC LIMIT 1`,
      [currentProjectName]
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("SQLite deleteTurnIfLatest (get latest row) timed out")), DB_OPERATION_TIMEOUT)
    )
  ]);

  if (!latestTurn || latestTurn.id !== dbId) {
    Logger.warn('ChapterMgmt', 'Persistence', `Skipped cancellation cleanup for dbId=${dbId}; it is not the latest turn.`);
    return false;
  }

  return await deleteLatestTurn();
}

/**
 * Calculates the 1-based position of a turn given its permanent database ID.
 * @param {number} dbId - The permanent `id` of the turn from the chat_turns table.
 * @returns {Promise<number>} The 1-based chronological position of the turn.
 */
async function getPositionOfTurn(dbId) {
  if (!db) throw new Error('Database not initialized.');

  try {
    // This query counts how many rows have a smaller (earlier) permanent ID.
    // The position is that count + 1.
    const result = await Promise.race([
      db.get(
        `SELECT COUNT(*) as position FROM chat_turns WHERE project_name = ? AND id < ?`,
        [currentProjectName, dbId]
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite getPositionOfTurn timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);
    return result.position + 1;
  } catch (error) {
    Logger.error('ChapterMgmt', `Failed to get position for turn ID ${dbId}: ${error.message}`, error);
    return -1; // Return an error indicator
  }
}

/**
 * Closes the database connection.
 * @returns {Promise<void>}
 */
async function close() {
  if (db) {
    Logger.log('ChapterMgmt', 'Lifecycle', 'Closing database connection.', 'start');
    await Promise.race([
      db.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite close timeout")), DB_OPERATION_TIMEOUT)
      )
    ]);
    db = null;
    Logger.log('ChapterMgmt', 'Lifecycle', 'Database connection closed.', 'end');
  }
}

/**
 * Creates a branched copy of the current database by trimming history.
 * @param {string} newDbPath - Absolute path for the new .db file.
 * @param {number} branchDbId - The database ID (primary key) to branch from.
 * @returns {Promise<void>}
 */
async function branchChat(newDbPath, branchDbId, branchTurnNumber) {
  Logger.log('ChapterMgmt', 'Persistence', `Trimming branched DB at: ${newDbPath} from turnNumber: ${branchTurnNumber}`, 'start');
  let newDb = null;
  try {
    newDb = await open({
      filename: newDbPath,
      driver: sqlite3.Database,
    });
    await newDb.exec('PRAGMA foreign_keys = ON;');

    // 1. Delete turns strictly after the branch point based on turn number
    const deleteResult = await newDb.run(`DELETE FROM chat_turns WHERE creation_turn_number > ?`, [branchTurnNumber]);
    Logger.log('ChapterMgmt', 'Persistence', `Deleted ${deleteResult.changes} turns from branched DB.`);

    // Keep facts aligned with the trimmed timeline.
    try {
      const factsDelete = await newDb.run(`DELETE FROM facts WHERE turn_number > ?`, [branchTurnNumber]);
      Logger.log('ChapterMgmt', 'Persistence', `Deleted ${factsDelete.changes} facts beyond branch turn.`);
    } catch (factsError) {
      Logger.warn('ChapterMgmt', 'Persistence', `Facts pruning skipped during branch trim: ${factsError.message}`);
    }

    // 2. Update viewer state to the branch point for a seamless start
    await newDb.run(`
      INSERT OR REPLACE INTO viewer_state (id, last_turn_number, last_dialogue_index)
      VALUES (1, ?, 0)
    `, [branchTurnNumber]);

    // 3. Vacuum to optimize the now smaller file
    await newDb.run(`VACUUM`);

    Logger.log('ChapterMgmt', 'Persistence', `Branched DB cleanup complete.`, 'end');
  } catch (error) {
    Logger.error('ChapterMgmt', 'Persistence', `Failed to trim branched chat DB at ${newDbPath}`, error);
    throw error;
  } finally {
    if (newDb) await newDb.close();
  }
}

/**
 * Retrieves the latest N TurnContext instances for the current project.
 * If fewer than N chapters exist, all available chapters are returned.
 * The returned array is ordered chronologically (oldest of the N first, newest last).
 * @param {number} n - The maximum number of latest chapters to retrieve.
 * @returns {Promise<Array<TurnContext>>} An array of the latest TurnContext instances.
 */
async function getLatestNChapters(n) {
  if (!db) {
    Logger.error('ChapterMgmt', 'Query', 'Database not initialized. Call init() first.');
    throw new Error('Database not initialized.');
  }
  if (!currentProjectName) {
    Logger.error('ChapterMgmt', 'Query', 'currentProjectName not set. Call init() first.');
    throw new Error('currentProjectName not set.');
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('n must be a positive integer.');
  }

  Logger.log('ChapterMgmt', 'Query', `Retrieving latest ${n} TurnContext instances for project: ${currentProjectName}`, 'start');
  try {
    // Fetch the latest N rows, ordered by id DESC to get the newest first
    const rows = await Promise.race([
      db.all(
        `SELECT id, creation_turn_number, turn_context_snapshot, thumbnail FROM chat_turns WHERE project_name = ? ORDER BY id DESC LIMIT ?`,
        [currentProjectName, n]
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite getLatestNChapters timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);

    // Rows are currently in reverse chronological order (newest first).
    // We must reverse them to process in chronological order.
    rows.reverse();

    const turnContexts = [];
    const totalChapterCount = await getChapterCount();
    const startGlobalTurnNumber = Math.max(1, totalChapterCount - rows.length + 1);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const decompressed = await decompressToString(row.turn_context_snapshot);
        const snapshotData = JSON.parse(decompressed);
        const turnContext = TurnContext.fromSnapshot(snapshotData, currentProjectName, row.creation_turn_number, currentChatDbFullPath, currentProjectRoot, row.id, row.thumbnail);
        turnContext.turnNumber = startGlobalTurnNumber + i; // Assign the correct global chronological turn number
        turnContext.setChapterManagement(module.exports); // Inject dependency
        turnContexts.push(turnContext);
      } catch (e) {
        Logger.error('ChapterMgmt', 'Query', `Failed to parse TurnContext snapshot for turn ${row.creation_turn_number}: ${e.message}`, e);
      }
    }

    Logger.log('ChapterMgmt', 'Query', `Retrieved ${turnContexts.length} latest TurnContext instances.`, 'end');
    return turnContexts;
  } catch (error) {
    Logger.error('ChapterMgmt', 'Query', `Failed to retrieve latest ${n} TurnContext instances: ${error.message}`, error);
    throw error;
  }
}

/**
 * Updates an existing TurnContext in the database with a new TurnContext instance.
 * The entire turn_context_snapshot will be overwritten.
 * @param {TurnContext} turnContextInstance - The TurnContext instance to update the database with.
 *                                          Must have a valid dbId.
 * @returns {Promise<void>}
 */
async function updateTurn(turnContextInstance) {
  if (!db) {
    Logger.error('ChapterMgmt', 'Persistence', 'Database not initialized. Call init() first.');
    throw new Error('Database not initialized.');
  }
  if (!turnContextInstance || !turnContextInstance.dbId) {
    Logger.error('ChapterMgmt', 'Persistence', 'Invalid TurnContext instance for update: missing dbId.');
    throw new Error('Invalid TurnContext instance for update: missing dbId.');
  }

  Logger.log('ChapterMgmt', 'Persistence', `Updating TurnContext with dbId: ${turnContextInstance.dbId}`, 'start');
  try {
    // 1. Serialize and Cleanup (Matching appendMessage logic to avoid bloat)
    const snapshotObj = (typeof turnContextInstance.serialize === 'function')
      ? turnContextInstance.serialize()
      : (turnContextInstance && typeof turnContextInstance === 'object' ? turnContextInstance : {});

    if (snapshotObj && snapshotObj.processed && Object.prototype.hasOwnProperty.call(snapshotObj.processed, 'temp')) {
      try {
        delete snapshotObj.processed.temp;
      } catch (e) {
        Logger.error('ChapterMgmt', 'Persistence', `Failed to delete processed.temp from snapshot during update: ${e.message}`, e);
      }
    }

    const title = turnContextInstance.output?.title || "";
    const abstractTitle = turnContextInstance.output?.abstractTitle || "";
    const synopsis = turnContextInstance.output?.synopsis || "";
    const summary = turnContextInstance.output?.summary || "";
    const fulltext = getTurnFulltext(turnContextInstance);
    const dialogueCount = turnContextInstance.output?.sequence?.length || 0;
    const snapshotJson = JSON.stringify(snapshotObj);
    const compressedSnapshot = await compressString(snapshotJson);
    const writerPromptSnapshot = await buildSerializedWriterPromptSnapshot(turnContextInstance);
    const shouldUpdateWriterPromptSnapshot = !!writerPromptSnapshot;

    // Layer 3 Safety Net: Log warning if snapshot is suspiciously large
    const COMPRESSED_SIZE_WARN_THRESHOLD = 2 * 1024 * 1024; // 2 MB compressed
    if (compressedSnapshot.length > COMPRESSED_SIZE_WARN_THRESHOLD) {
      Logger.error('ChapterMgmt', 'Persistence', `[CRITICAL SIZE WARNING] Compressed snapshot is ${(compressedSnapshot.length / 1024 / 1024).toFixed(1)} MB for turn dbId=${turnContextInstance.dbId}. Uncompressed: ${(snapshotJson.length / 1024 / 1024).toFixed(1)} MB. This may indicate recursive data leakage!`);
    }

    // 2. Perform Update relying ONLY on ID (Primary Key)
    // Update both snapshot and thumbnail if thumbnail is present
    let result;
    if (turnContextInstance.thumbnail) {
      if (shouldUpdateWriterPromptSnapshot) {
        result = await Promise.race([
          db.run(
            `UPDATE chat_turns SET turn_context_snapshot = ?, title = ?, abstract_title = ?, synopsis = ?, summary = ?, fulltext = ?, writer_prompt_snapshot = ?, thumbnail = ?, dialogue_count = ? WHERE id = ?`,
            [compressedSnapshot, title, abstractTitle, synopsis, summary, fulltext, writerPromptSnapshot, turnContextInstance.thumbnail, dialogueCount, turnContextInstance.dbId]
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("SQLite UPDATE turn_context_snapshot/writer_prompt_snapshot and thumbnail timed out")), DB_OPERATION_TIMEOUT)
          )
        ]);
      } else {
        result = await Promise.race([
          db.run(
            `UPDATE chat_turns SET turn_context_snapshot = ?, title = ?, abstract_title = ?, synopsis = ?, summary = ?, fulltext = ?, thumbnail = ?, dialogue_count = ? WHERE id = ?`,
            [compressedSnapshot, title, abstractTitle, synopsis, summary, fulltext, turnContextInstance.thumbnail, dialogueCount, turnContextInstance.dbId]
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("SQLite UPDATE turn_context_snapshot and thumbnail timed out")), DB_OPERATION_TIMEOUT)
          )
        ]);
      }
    } else {
      if (shouldUpdateWriterPromptSnapshot) {
        result = await Promise.race([
          db.run(
            `UPDATE chat_turns SET turn_context_snapshot = ?, title = ?, abstract_title = ?, synopsis = ?, summary = ?, fulltext = ?, writer_prompt_snapshot = ?, dialogue_count = ? WHERE id = ?`,
            [compressedSnapshot, title, abstractTitle, synopsis, summary, fulltext, writerPromptSnapshot, dialogueCount, turnContextInstance.dbId]
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("SQLite UPDATE turn_context_snapshot/writer_prompt_snapshot timed out")), DB_OPERATION_TIMEOUT)
          )
        ]);
      } else {
        result = await Promise.race([
          db.run(
            `UPDATE chat_turns SET turn_context_snapshot = ?, title = ?, abstract_title = ?, synopsis = ?, summary = ?, fulltext = ?, dialogue_count = ? WHERE id = ?`,
            [compressedSnapshot, title, abstractTitle, synopsis, summary, fulltext, dialogueCount, turnContextInstance.dbId]
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("SQLite UPDATE turn_context_snapshot timed out")), DB_OPERATION_TIMEOUT)
          )
        ]);
      }
    }

    // 3. Verify changes were actually made
    if (result && result.changes === 0) {
      Logger.warn('ChapterMgmt', 'Persistence', `Update operation finished but 0 rows were modified for dbId: ${turnContextInstance.dbId}. This implies the ID was not found.`);
    } else {
      _blobCache.delete(turnContextInstance.dbId);
      Logger.log('ChapterMgmt', 'Persistence', `Successfully updated TurnContext for dbId: ${turnContextInstance.dbId}`);
    }
    Logger.log('ChapterMgmt', 'Persistence', 'Update operation complete.', 'end');
  } catch (error) {
    Logger.error('ChapterMgmt', 'Persistence', `Failed to update TurnContext for dbId ${turnContextInstance.dbId}: ${error.message}`, error);
    throw error;
  }
}


/**
 * Executes a generic, read-only SQL query.
 * Throws an error if the query is not a SELECT statement.
 * @param {string} sql - The SQL query to execute.
 * @param {Array<any>} [params=[]] - The parameters for the SQL query.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of rows.
 */
async function genericQuery(sql, params = []) {
  if (!db) {
    Logger.error('ChapterMgmt', 'Query', 'genericQuery failed: Database not initialized.');
    throw new Error('Database not initialized.');
  }
  const trimmedUpper = sql.trim().toUpperCase();
  if (!sql || !(trimmedUpper.startsWith('SELECT') || trimmedUpper.startsWith('PRAGMA') || trimmedUpper.startsWith('EXPLAIN'))) {
    throw new Error("Validation Error: genericQuery only accepts SELECT, PRAGMA, or EXPLAIN statements.");
  }
  try {
    const rows = await db.all(sql, params);
    return rows;
  } catch (error) {
    Logger.error('ChapterMgmt', 'Query', `genericQuery failed for SQL: ${sql}`, error);
    throw error;
  }
}

/**
 * Executes a generic SQL command for writing data (INSERT, UPDATE, DELETE).
 * Throws an error if the query is a SELECT statement.
 * @param {string} sql - The SQL command to execute.
 * @param {Array<any>} [params=[]] - The parameters for the SQL command.
 * @returns {Promise<Object>} A promise that resolves to the result of the `run` command (e.g., { changes, lastID }).
 */
async function genericExecute(sql, params = []) {
  if (!db) {
    Logger.error('ChapterMgmt', 'Persistence', 'genericExecute failed: Database not initialized.');
    throw new Error('Database not initialized.');
  }
  if (!sql || sql.trim().toUpperCase().startsWith('SELECT')) {
    throw new Error("Validation Error: genericExecute cannot be used for SELECT statements.");
  }
  try {
    const result = await db.run(sql, params);
    return result;
  } catch (error) {
    Logger.error('ChapterMgmt', 'Persistence', `genericExecute failed for SQL: ${sql}`, error);
    throw error;
  }
}


/**
 * Retrieves a range of TurnContext instances (inclusive).
 * @param {number} start - 1-based start index.
 * @param {number} end - 1-based end index.
 * @returns {Promise<Array<TurnContext>>}
 */
async function getTurnRange(start, end) {
  if (!db) throw new Error('Database not initialized.');
  if (start > end) [start, end] = [end, start];

  const limit = end - start + 1;
  const offset = start - 1;

  Logger.log('ChapterMgmt', 'Query', `Retrieving range ${start}-${end} for project: ${currentProjectName}`);
  try {
    const rows = await Promise.race([
      db.all(
        `SELECT id, creation_turn_number, turn_context_snapshot, thumbnail FROM chat_turns WHERE project_name = ? ORDER BY id ASC LIMIT ? OFFSET ?`,
        [currentProjectName, limit, offset]
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite getTurnRange timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);

    const turnContexts = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const decompressed = await decompressToString(row.turn_context_snapshot);
        const snapshotData = JSON.parse(decompressed);
        const turnContext = TurnContext.fromSnapshot(snapshotData, currentProjectName, row.creation_turn_number, currentChatDbFullPath, currentProjectRoot, row.id, row.thumbnail);
        turnContext.turnNumber = start + i;
        turnContext.setChapterManagement(module.exports);
        turnContexts.push(turnContext);
      } catch (e) {
        Logger.error('ChapterMgmt', 'Query', `Failed to parse TurnContext snapshot for range: ${e.message}`);
      }
    }
    return turnContexts;
  } catch (error) {
    Logger.error('ChapterMgmt', 'Query', `Failed to retrieve TurnContext range: ${error.message}`);
    throw error;
  }
}

module.exports = {
  init,
  appendMessage,
  appendInterlude,
  getNextInterludeOrdinal,
  getChapters,
  getChapterMetadata,
  getTurnMetadata,
  getTurnBlob,
  getTurnBlobs,
  getWriterPromptSnapshotByDbId,
  getChapterCount,
  retrieveDatedChapters,
  getTurnContext,
  getTurnContextByDbId,
  getTurnContextByCreationTurnNumber,
  getTurnContextByStorageKey,
  getLatestTurnContext,
  getPositionOfTurn,
  getInterludeMetadata,
  getInterludeContext,
  updateInterludeMetadata,
  getPendingInterludeIntegrations,
  refreshParentInterludeMemory,
  integrateInterludeIntoParent,
  deleteInterlude,
  deleteLatestTurn,
  deleteTurnIfLatest,
  getLatestNChapters,
  getTurnRange,
  updateTurn,
  saveViewerState,
  getViewerState,
  getArcCompression,
  saveArcCompression,
  close,
  branchChat,
  genericQuery,
  genericExecute,
  clearBlobCache,
  CONFIG,
  get db() {
    return db;
  },

  /**
   * Checks if the database is initialized.
   * @returns {boolean}
   */
  isInitialized() {
    return !!db;
  },
};
// #endregion

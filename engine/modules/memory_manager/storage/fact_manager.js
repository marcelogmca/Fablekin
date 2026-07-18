// modules/fact_manager.js

// #region MODULE IMPORTS
const { Logger, ensureDirectoryExists } = require('../../utils.js');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

const DB_OPERATION_TIMEOUT = 30000; // 30 seconds
// #endregion

// #region CONFIGURATION
// This will hold the database connection for the current project.
let db = null;
let currentProjectName = 'default_project';
const DEFAULT_CORE_PLUGIN_ID = 'core';
// #endregion

function normalizeTurnKey(turnKey, turnNumber) {
  if (typeof turnKey === 'string') {
    const trimmed = turnKey.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  }
  const numericTurn = Number.isInteger(turnNumber) ? turnNumber : 0;
  return String(numericTurn);
}

function normalizeSceneMode(sceneMode) {
  const normalized = typeof sceneMode === 'string' ? sceneMode.trim().toLowerCase() : '';
  return normalized === 'interlude' ? 'interlude' : 'mainline';
}

async function assertCanonicalFactsTableSchema() {
  if (!db) return;
  const columns = await db.all(`PRAGMA table_info(facts)`);
  const expectedColumns = [
    'id', 'project_name', 'turn_number', 'turn_key', 'scene_mode', 'interlude_id',
    'interlude_ordinal', 'plugin_id', 'source', 'target', 'predicate', 'fact_value',
    'context', 'timestamp'
  ];
  const actualColumns = new Set((columns || []).map((column) => String(column.name || '').toLowerCase()));
  const missingColumns = expectedColumns.filter((column) => !actualColumns.has(column));
  if (missingColumns.length > 0) {
    throw new Error(
      `Unsupported facts schema; missing ${missingColumns.join(', ')}. `
      + 'This pre-release build does not migrate existing databases. Delete and recreate the project database.'
    );
  }
}

// #region INITIALIZATION
/**
 * Initializes the Fact Manager for a specific project by opening its database.
 * @param {string} projectName - The name of the current project.
 * @returns {Promise<void>}
 */
async function init(chatDbFullPath) {
  Logger.log('FactManager', 'Lifecycle', `init called for chat DB full path: ${chatDbFullPath}`, 'start');

  const parts = chatDbFullPath.split(path.sep);
  const projectsIndex = parts.indexOf('projects');
  let projectFolderName = 'default_project';
  if (projectsIndex !== -1 && parts.length > projectsIndex + 1) {
    projectFolderName = parts[projectsIndex + 1];
  }
  currentProjectName = projectFolderName;

  try {
    const dbDir = path.dirname(chatDbFullPath);
    const dbPath = chatDbFullPath;

    await ensureDirectoryExists(dbDir);

    Logger.log('FactManager', 'Database', `Initializing database at path: ${dbPath}`);
    db = await Promise.race([
      open({
        filename: dbPath,
        driver: sqlite3.Database,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite database open timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);
    Logger.log('FactManager', 'Database', `Database connection established: ${db !== null}`);

    await Promise.race([
      db.exec(`
            CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_name TEXT NOT NULL,
                turn_number INTEGER NOT NULL,
                turn_key TEXT NOT NULL DEFAULT '0',
                scene_mode TEXT NOT NULL DEFAULT 'mainline',
                interlude_id INTEGER,
                interlude_ordinal INTEGER,
                plugin_id TEXT NOT NULL DEFAULT 'core',
                source TEXT, 
                target TEXT, 
                predicate TEXT, 
                fact_value TEXT,
                context TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(project_name, turn_key, plugin_id, source, target, predicate) ON CONFLICT REPLACE
            );
        `),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite table creation timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);
    await assertCanonicalFactsTableSchema();
    Logger.log('FactManager', 'Lifecycle', `Database initialized successfully for project: ${projectFolderName}`, 'end');

  } catch (error) {
    Logger.error('FactManager', 'Lifecycle', 'Failed to initialize database.', error);
    db = null;
    throw error;
  }
}
// #endregion

// #region CORE FUNCTIONALITY
// #endregion

// #region UTILITY FUNCTIONS
/**
 * Adds a new fact to the database.
 * @param {object} fact - The fact object { turn_number, source, target, predicate, fact_value, context }.
 * @param {string} projectName - Optional project name override.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
async function addFact(fact, projectName = currentProjectName) {
  if (!db) {
    Logger.error('FactManager', 'Persistence', 'addFact failed: Database not initialized.');
    return false;
  }
  try {
    await Promise.race([
      db.run(
        `INSERT INTO facts (
          turn_number, turn_key, scene_mode, interlude_id, interlude_ordinal, plugin_id,
          project_name, source, target, predicate, fact_value, context
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fact.turn_number || 0,
          normalizeTurnKey(fact.turn_key, fact.turn_number),
          normalizeSceneMode(fact.scene_mode),
          Number.isInteger(fact.interlude_id) ? fact.interlude_id : null,
          Number.isInteger(fact.interlude_ordinal) ? fact.interlude_ordinal : null,
          typeof fact.plugin_id === 'string' && fact.plugin_id.trim() ? fact.plugin_id.trim() : DEFAULT_CORE_PLUGIN_ID,
          projectName.toLowerCase(),
          fact.source ? fact.source.toLowerCase() : null,
          fact.target ? fact.target.toLowerCase() : null,
          fact.predicate,
          fact.fact_value,
          fact.context || null
        ]
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite addFact insert timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);
    return true;
  } catch (error) {
    Logger.error('FactManager', 'Persistence', `Failed to add fact:`, error);
    return false;
  }
}

async function clearFactsForScope(scope, projectName = currentProjectName) {
  if (!db) {
    Logger.error('FactManager', 'Persistence', 'clearFactsForScope failed: Database not initialized.');
    return { changes: 0 };
  }

  const turnKey = normalizeTurnKey(scope?.turn_key, scope?.turn_number);
  const pluginId = typeof scope?.plugin_id === 'string' && scope.plugin_id.trim() ? scope.plugin_id.trim() : DEFAULT_CORE_PLUGIN_ID;
  const predicates = Array.isArray(scope?.predicates) ? scope.predicates.filter(Boolean) : [];
  const source = typeof scope?.source === 'string' && scope.source.trim() ? scope.source.trim().toLowerCase() : null;
  const target = typeof scope?.target === 'string' && scope.target.trim() ? scope.target.trim().toLowerCase() : null;

  let sql = `DELETE FROM facts WHERE project_name = ? AND turn_key = ? AND plugin_id = ?`;
  const params = [projectName.toLowerCase(), turnKey, pluginId];

  if (predicates.length > 0) {
    const likes = [];
    const equals = [];
    for (const p of predicates) {
      if (typeof p !== 'string') continue;
      if (p.includes('%') || p.includes('_')) likes.push(p);
      else equals.push(p);
    }
    const clauses = [];
    if (equals.length > 0) {
      clauses.push(`predicate IN (${equals.map(() => '?').join(',')})`);
      params.push(...equals);
    }
    for (const likeValue of likes) {
      clauses.push('predicate LIKE ?');
      params.push(likeValue);
    }
    if (clauses.length > 0) {
      sql += ` AND (${clauses.join(' OR ')})`;
    }
  }

  if (source) {
    sql += ` AND source = ?`;
    params.push(source);
  }
  if (target) {
    sql += ` AND target = ?`;
    params.push(target);
  }

  try {
    return await db.run(sql, params);
  } catch (error) {
    Logger.error('FactManager', 'Persistence', `clearFactsForScope failed: ${error.message}`, error);
    throw error;
  }
}

async function pruneOrphanInterludeFacts(projectName = currentProjectName) {
  if (!db) {
    Logger.error('FactManager', 'Persistence', 'pruneOrphanInterludeFacts failed: Database not initialized.');
    return { changes: 0 };
  }

  const normalizedProject = String(projectName || currentProjectName).toLowerCase();
  let totalChanges = 0;
  let invitedFactsBefore = 0;
  try {
    const row = await db.get(
      `SELECT COUNT(*) AS count
       FROM facts
       WHERE LOWER(project_name) = LOWER(?)
         AND scene_mode = 'interlude'
         AND predicate = 'CAMP_REST_INVITED'`,
      [normalizedProject]
    );
    invitedFactsBefore = Number(row?.count || 0);
  } catch {
    invitedFactsBefore = 0;
  }

  // Remove rows that point to deleted interlude records.
  try {
    const byInterludeId = await db.run(
      `DELETE FROM facts
       WHERE LOWER(project_name) = LOWER(?)
         AND scene_mode = 'interlude'
         AND interlude_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM chat_interludes i
           WHERE LOWER(i.project_name) = LOWER(facts.project_name)
             AND i.id = facts.interlude_id
         )`,
      [normalizedProject]
    );
    totalChanges += Number(byInterludeId?.changes || 0);
  } catch (error) {
    Logger.warn('FactManager', 'Persistence', `Interlude-id orphan prune skipped: ${error.message}`);
  }

  // Remove interlude rows whose parent chapter no longer exists when no interlude_id was recorded.
  try {
    const byMissingParent = await db.run(
      `DELETE FROM facts
       WHERE LOWER(project_name) = LOWER(?)
         AND scene_mode = 'interlude'
         AND interlude_id IS NULL
         AND instr(turn_key, '.') > 0
         AND CAST(substr(turn_key, 1, instr(turn_key, '.') - 1) AS INTEGER) NOT IN (
           SELECT creation_turn_number
           FROM chat_turns
           WHERE LOWER(project_name) = LOWER(facts.project_name)
         )`,
      [normalizedProject]
    );
    totalChanges += Number(byMissingParent?.changes || 0);
  } catch (error) {
    Logger.warn('FactManager', 'Persistence', `Missing-parent interlude prune skipped: ${error.message}`);
  }

  if (totalChanges > 0) {
    Logger.log('FactManager', 'Persistence', `Pruned ${totalChanges} orphan interlude fact row(s).`);
  }
  try {
    const row = await db.get(
      `SELECT COUNT(*) AS count
       FROM facts
       WHERE LOWER(project_name) = LOWER(?)
         AND scene_mode = 'interlude'
         AND predicate = 'CAMP_REST_INVITED'`,
      [normalizedProject]
    );
    const invitedFactsAfter = Number(row?.count || 0);
    if (invitedFactsAfter !== invitedFactsBefore) {
      Logger.warn(
        'FactManager',
        'Persistence',
        `[camp_rest_interludes][invites] Invitation fact count changed during orphan prune: before=${invitedFactsBefore}, after=${invitedFactsAfter}, totalPruned=${totalChanges}, project=${normalizedProject}`
      );
    }
  } catch {
    // Debug-only accounting should never affect pruning.
  }
  return { changes: totalChanges };
}

/**
 * Retrieves the most recent facts matching a specific predicate for each unique source.
 * This is useful for state-tracking (e.g., getting the current Location or Gender for all characters).
 * @param {string} predicate - The predicate to filter by (e.g., 'HAS_GENDER', 'CURRENT_LOCATION').
 * @param {string} projectName - Optional project name override.
 * @param {number|null} maxTurnNumber - Optional maximum turn number to include (temporal boundary).
 * @returns {Promise<Array<object>>} An array of objects: { source, target, fact_value, turn_number }
 */
async function getLatestFactsByPredicate(predicate, projectName = currentProjectName, maxTurnNumber = null) {
  if (!db) {
    Logger.error('FactManager', 'Query', 'getLatestFactsByPredicate failed: Database not initialized.');
    return [];
  }
  try {
    let sql = `
         SELECT T1.source, T1.target, T1.fact_value, T1.turn_number
         FROM facts T1
         INNER JOIN (
             SELECT source, MAX(id) AS max_id
             FROM facts
             WHERE project_name = ? AND predicate = ?
    `;
    const params = [projectName.toLowerCase(), predicate];

    if (maxTurnNumber !== null) {
      sql += ` AND turn_number <= ?`;
      params.push(maxTurnNumber);
    }

    sql += `
             GROUP BY source
         ) AS T2
         ON T1.source = T2.source AND T1.id = T2.max_id
         WHERE T1.project_name = ? AND T1.predicate = ?`;

    params.push(projectName.toLowerCase(), predicate);

    const facts = await Promise.race([
      db.all(sql, params),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite getLatestFactsByPredicate timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);
    return facts;
  } catch (error) {
    Logger.error('FactManager', 'Query', `Failed to get latest facts for predicate ${predicate}:`, error);
    return [];
  }
}

/**
 * Retrieves all facts for a given project, grouped by turn (turnNumber).
 * @param {string} projectName - The name of the project.
 * @param {number|null} maxTurnNumber - Optional maximum turn number to include (temporal boundary).
 * @returns {Promise<object|null>} An object where keys are turn numbers and values are arrays of facts, or null on failure.
 */
async function getAllFactsGroupedByTurn(projectName = currentProjectName, maxTurnNumber = null) {
  if (!db) {
    Logger.error('FactManager', 'Query', 'Database not initialized. Call init() first.');
    throw new Error('Database not initialized.');
  }
  if (!projectName) {
    Logger.error('FactManager', 'Query', 'Project name not set. Call init() first or provide projectName.');
    throw new Error('Project name not set.');
  }

  Logger.log('FactManager', 'Query', `Retrieving all facts grouped by turn for project: ${projectName}${maxTurnNumber !== null ? ` (up to turn ${maxTurnNumber})` : ''}`, 'start');
  try {
    let sql = `SELECT turn_number, source, target, predicate, fact_value, timestamp
             FROM facts
             WHERE project_name = ?`;
    const params = [projectName];

    if (maxTurnNumber !== null) {
      sql += ` AND turn_number <= ?`;
      params.push(maxTurnNumber);
    }

    sql += ` ORDER BY turn_number ASC, timestamp ASC`;

    const rows = await Promise.race([
      db.all(sql, params),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite getAllFactsGroupedByTurn timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);

    const groupedFacts = [];
    let currentTurn = null;
    let currentTurnFacts = [];

    for (const row of rows) {
      if (row.turn_number !== currentTurn) {
        if (currentTurn !== null) {
          groupedFacts.push({ turn_number: currentTurn, facts: currentTurnFacts });
        }
        currentTurn = row.turn_number;
        currentTurnFacts = [];
      }
      currentTurnFacts.push({
        source: row.source,
        target: row.target,
        predicate: row.predicate,
        fact_value: row.fact_value,
        timestamp: row.timestamp
      });
    }
    if (currentTurn !== null) {
      groupedFacts.push({ turn_number: currentTurn, facts: currentTurnFacts });
    }

    Logger.log('FactManager', 'Query', `Retrieved ${rows.length} facts across ${groupedFacts.length} turns.`, 'end');
    return groupedFacts;
  } catch (error) {
    Logger.error('FactManager', 'Query', `Failed to retrieve facts grouped by turn: ${error.message}`, error);
    throw error;
  }
}

/**
 * Updates a specific fact in the database.
 * @param {number} factId - The unique ID of the fact to update.
 * @param {object} updatedFactData - An object containing the fields to update (e.g., { source, target, predicate, value }).
 * @returns {Promise<boolean>} True on success, false on failure.
 */
async function updateFact(factId, updatedFactData) {
  Logger.log('FactManager', 'Persistence', `updateFact called for factId: ${factId}`, 'start');
  if (!db) {
    Logger.error('FactManager', 'Persistence', 'Database not initialized.');
    return false;
  }
  try {
    const allowedFields = ['source', 'target', 'predicate', 'value', 'context', 'turn_number'];
    const fieldsToUpdate = Object.keys(updatedFactData).filter(field => allowedFields.includes(field));

    if (fieldsToUpdate.length === 0) {
      Logger.warn('FactManager', 'Persistence', 'Update called with no valid fields to update.');
      return false;
    }

    const setClause = fieldsToUpdate.map(field => {
      if (field === 'value') return 'fact_value = ?';
      return `${field} = ?`;
    }).join(', ');
    const values = fieldsToUpdate.map(field => updatedFactData[field]);
    values.push(factId);

    const result = await Promise.race([
      db.run(`UPDATE facts SET ${setClause} WHERE id = ?`, values),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite updateFact timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);

    if (result.changes === 0) {
      Logger.warn('FactManager', 'Persistence', `No fact found with id ${factId} to update.`);
      return false;
    }

    Logger.log('FactManager', 'Persistence', `Successfully updated factId: ${factId}`, 'end');
    return true;
  } catch (error) {
    Logger.error('FactManager', 'Persistence', `Failed to update fact ${factId}.`, error);
    return false;
  }
}

/**
 * Deletes a specific fact from the database.
 * @param {number} factId - The unique ID of the fact to delete.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
async function deleteFact(factId) {
  Logger.log('FactManager', 'Persistence', `deleteFact called for factId: ${factId}`, 'start');
  if (!db) {
    Logger.error('FactManager', 'Persistence', 'Database not initialized.');
    return false;
  }
  try {
    const result = await Promise.race([
      db.run(`DELETE FROM facts WHERE id = ?`, [factId]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite deleteFact timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);

    if (result.changes === 0) {
      Logger.warn('FactManager', 'Persistence', `No fact found with id ${factId} to delete.`);
      return false;
    }

    Logger.log('FactManager', 'Persistence', `Successfully deleted factId: ${factId}`, 'end');
    return true;
  } catch (error) {
    Logger.error('FactManager', 'Persistence', `Failed to delete fact ${factId}.`, error);
    return false;
  }
}
// #endregion

// #region EXPORTS
/**
 * Closes the database connection.
 * @returns {Promise<void>}
 */
async function close() {
  if (db) {
    Logger.log('FactManager', 'Lifecycle', 'Closing database connection.', 'start');
    await Promise.race([
      db.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite close timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);
    db = null;
    Logger.log('FactManager', 'Lifecycle', 'Database connection closed.', 'end');
  }
}

/**
 * Identifies new characters introduced in the current turn and stores them as facts.
 * @param {TurnContext} turnContext - The TurnContext object for the current turn.
 * @returns {Promise<Array<string>>} An array of names of the new characters introduced.
 */
async function identifyNewCharacters(turnContext) {
  const turnNumber = turnContext.turnNumber;
  const projectName = turnContext.projectName;
  const currentParty = turnContext.output.party;

  Logger.log('FactManager', 'Generation', `identifyNewCharacters called for turnNumber: ${turnNumber}, project: ${projectName}`, 'start');

  if (!db) {
    Logger.error('FactManager', 'Generation', 'Cannot identify new characters, database not initialized.');
    return [];
  }

  if (!currentParty || currentParty.length === 0) {
    Logger.log('FactManager', 'Generation', 'No party members found in turnContext.output.party. Skipping character check.', 'end');
    return [];
  }

  try {
    // 1. Get all characters ever introduced in the project
    const existingCharactersResult = await Promise.race([
      db.all(
        `SELECT DISTINCT source FROM facts WHERE project_name = ? AND predicate = 'CHARACTER_INTRODUCTION'`,
        [projectName.toLowerCase()]
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite identifyNewCharacters query timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);

    const existingCharacters = existingCharactersResult.map(row => row.source);
    Logger.log('FactManager', 'Generation', `Found existing characters: ${existingCharacters.join(', ')}`);

    // 2. Identify new characters
    const newCharacters = currentParty.filter(character => !existingCharacters.includes(character.toLowerCase()));

    if (newCharacters.length === 0) {
      Logger.log('FactManager', 'Generation', 'No new characters introduced in this turn.', 'end');
      return [];
    }

    Logger.log('FactManager', 'Generation', `New characters detected: ${newCharacters.join(', ')}`);

    // 3. Return new characters (Persistence is now handled externally after triage)
    Logger.log('FactManager', 'Generation', 'Finished character identification.', 'end');
    return newCharacters;

  } catch (error) {
    Logger.error('FactManager', 'Generation', 'Failed to identify or store new characters.', error);
    return []; // Return empty array on error
  }
}



/**
 * Retrieves the currently active ledger entries for a specific category and formats them.
 * @param {string} category - The category of the ledger (e.g., 'director').
 * @param {string} projectName - The project name.
 * @returns {Promise<string>} Formatted string of ledger entries.
 */
async function getFormattedLedger(category = 'director', projectName = currentProjectName, maxTurnNumber = null) {
  if (!db) {
    Logger.error('FactManager', 'Query', 'getFormattedLedger failed: Database not initialized.');
    return 'Empty.';
  }
  try {
    let sql = `
      SELECT f1.target, f1.fact_value
      FROM facts f1
      INNER JOIN (
          SELECT target, MAX(turn_number) as max_turn
          FROM facts
          WHERE project_name = ? AND source = ? AND predicate = 'LEDGER_ENTRY'
    `;
    const params = [projectName.toLowerCase(), category.toLowerCase()];

    if (maxTurnNumber !== null) {
      sql += ` AND turn_number <= ?`;
      params.push(maxTurnNumber);
    }

    sql += `
          GROUP BY target
      ) f2 ON f1.target = f2.target AND f1.turn_number = f2.max_turn
      WHERE f1.project_name = ? AND f1.source = ? AND f1.predicate = 'LEDGER_ENTRY' 
        AND (f1.context IS NULL OR f1.context != 'DELETED')
    `;
    params.push(projectName.toLowerCase(), category.toLowerCase());

    if (maxTurnNumber !== null) {
      sql += ` AND f1.turn_number <= ?`;
      params.push(maxTurnNumber);
    }

    sql += ` ORDER BY f1.id ASC`;
    const facts = await Promise.race([
      db.all(sql, params),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SQLite getFormattedLedger timed out")), DB_OPERATION_TIMEOUT)
      )
    ]);

    if (facts.length === 0) return 'Empty.';

    return facts.map(f => `[${f.target || 'UNKNOWN'}] ${f.fact_value}`).join('\n');
  } catch (error) {
    Logger.error('FactManager', 'Query', `Failed to get formatted ledger:`, error);
    return 'Empty.';
  }
}

/**
 * Parses and executes ledger operations (INSERT, UPDATE, DELETE) from a text block.
 * @param {string} operationsText - The text containing the operations.
 * @param {number} turnNumber - The current turn number.
 * @param {string} projectName - The project name.
 * @param {string} category - The category of the ledger (e.g., 'director').
 * @returns {Promise<void>}
 */
async function processLedgerOperations(operationsText, turnNumber, projectName = currentProjectName, category = 'director') {
  const result = { applied: 0, ignored: 0 };
  if (!operationsText || !db) return result;

  const lines = operationsText.split('\n');
  const sourceCategory = category.toLowerCase();

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Syntax: DELETE [ID]
    const deleteMatch = line.match(/^DELETE\s+\[([a-zA-Z0-9_-]+)\]/i);
    if (deleteMatch) {
      const targetId = deleteMatch[1];
      await addFact({
        turn_number: turnNumber,
        source: sourceCategory,
        target: targetId,
        predicate: 'LEDGER_ENTRY',
        fact_value: '',
        context: 'DELETED'
      }, projectName);
      Logger.log('FactManager', 'Ledger', `Deleted (Appended DELETED record for turn ${turnNumber}) ledger entry ID [${targetId}].`);
      result.applied++;
      continue;
    }

    // Syntax: UPDATE [ID] text
    const updateMatch = line.match(/^UPDATE\s+\[([a-zA-Z0-9_-]+)\]\s+(.*)/i);
    if (updateMatch) {
      const targetId = updateMatch[1];
      const newText = updateMatch[2].trim();
      await addFact({
        turn_number: turnNumber,
        source: sourceCategory,
        target: targetId,
        predicate: 'LEDGER_ENTRY',
        fact_value: newText,
        context: null
      }, projectName);
      Logger.log('FactManager', 'Ledger', `Updated (Appended record for turn ${turnNumber}) ledger entry ID [${targetId}].`);
      result.applied++;
      continue;
    }

    // Syntax: INSERT [ID] text
    const insertMatch = line.match(/^INSERT\s+\[([a-zA-Z0-9_-]+)\]\s+(.*)/i);
    if (insertMatch) {
      const targetId = insertMatch[1];
      const newText = insertMatch[2].trim();
      await addFact({
        turn_number: turnNumber,
        source: sourceCategory,
        target: targetId,
        predicate: 'LEDGER_ENTRY',
        fact_value: newText,
        context: null
      }, projectName);
      Logger.log('FactManager', 'Ledger', `Inserted (Appended record for turn ${turnNumber}) ledger entry [${targetId}].`);
      result.applied++;
      continue;
    }

    // Implicit UPSERT Syntax: [ID] text
    const implicitMatch = line.match(/^\[([a-zA-Z0-9_-]+)\]\s+(.*)/i);
    if (implicitMatch) {
      const targetId = implicitMatch[1];
      const newText = implicitMatch[2].trim();
      await addFact({
        turn_number: turnNumber,
        source: sourceCategory,
        target: targetId,
        predicate: 'LEDGER_ENTRY',
        fact_value: newText,
        context: null
      }, projectName);
      Logger.log('FactManager', 'Ledger', `Implicitly upserted (Appended record for turn ${turnNumber}) ledger entry [${targetId}].`);
      result.applied++;
      continue;
    }

    result.ignored++;
  }

  if (result.applied === 0 && result.ignored > 0) {
    Logger.warn('FactManager', 'Ledger', `No parseable ledger operations found in ${result.ignored} non-empty line(s) for turn ${turnNumber}.`);
  }

  return result;
}

module.exports = {
  init,
  getAllFactsGroupedByTurn,
  updateFact,
  deleteFact,
  close,
  identifyNewCharacters,
  addFact,
  clearFactsForScope,
  pruneOrphanInterludeFacts,
  getLatestFactsByPredicate,
  getFormattedLedger,
  processLedgerOperations,
};
// #endregion

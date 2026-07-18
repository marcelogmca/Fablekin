// modules/memory_manager/storage/static_data_manager.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs/promises');

// --- AI & LOGIC IMPORTS ---
const { Logger, slugifyProjectName } = require("../../utils");
const { runRAGPipeline } = require("../retrieval/rag_pipeline");

const DB_OPERATION_TIMEOUT = 30000; // 30 seconds
const MAX_DB_RETRIES = 5;
const DB_RETRY_DELAY_MS = 1000; // 1 second

// Promisified helper for new sqlite3.Database
function openDb(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) reject(err);
            else resolve(db);
        });
    });
}

// Promisified helper for db.run
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database connection is not initialized."));
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// Promisified helper for db.all
function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database connection is not initialized."));
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []); // Ensure we always resolve with an array
        });
    });
}

// Promisified helper for db.get
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database connection is not initialized."));
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

class StaticDataManager {
    constructor(projectName, projectRootDirectory) {
        this.projectName = projectName;
        this.projectRootDirectory = projectRootDirectory;
        this.dbPath = null;
        this.db = null;
        this.initializationPromise = null;
        // kgManager property is removed as this class now handles it directly
    }

    async getDatabasePath(projectName, projectRootDirectory) {
        const dbDirectory = projectRootDirectory;
        await fs.mkdir(dbDirectory, { recursive: true });

        const safeName = slugifyProjectName(projectName);
        const safePath = path.join(dbDirectory, `${safeName}.db`);

        return safePath;
    }

    async initialize() {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        const doInitialize = async () => {
            let lastError = null;
            for (let i = 0; i < MAX_DB_RETRIES; i++) {
                let tempDb = null;
                try {
                    this.dbPath = await this.getDatabasePath(this.projectName, this.projectRootDirectory);
                    tempDb = await openDb(this.dbPath);

                    tempDb.configure("busyTimeout", DB_OPERATION_TIMEOUT);
                    Logger.log('StaticDataManager', 'Lifecycle', `Opened static database: ${this.dbPath}`, 'start');

                    // 1. Character Sheets Table
                    await dbRun(tempDb, `
                        CREATE TABLE IF NOT EXISTS character_sheets (
                            project_name TEXT NOT NULL,
                            character_name TEXT NOT NULL,
                            source_file TEXT,
                            character_sheet_data TEXT,
                            content_hash TEXT,
                            PRIMARY KEY (project_name, character_name)
                        )
                    `);

                    await dbRun(tempDb, `
                        CREATE INDEX IF NOT EXISTS idx_character_sheets_source_file ON character_sheets (source_file);
                    `);

                    // 2. Project Settings Table
                    await dbRun(tempDb, `
                        CREATE TABLE IF NOT EXISTS project_settings (
                            setting_key TEXT PRIMARY KEY,
                            setting_value TEXT
                        )
                    `);

                    // 7. Summaries Table
                    await dbRun(tempDb, `
                        CREATE TABLE IF NOT EXISTS summaries (
                            file_path TEXT PRIMARY KEY,
                            summary_data TEXT,
                            content_hash TEXT NOT NULL
                        )
                    `);

                    await dbRun(tempDb, `
                        CREATE INDEX IF NOT EXISTS idx_summaries_file_path ON summaries (file_path);
                    `);

                    // NOTE: Static Knowledge Graph table initialization has been removed from here.
                    // It is now handled by the KnowledgeGraph class in Reference mode.

                    this.db = tempDb; // Assign ONLY after all table creations are successful.
                    Logger.log('StaticDataManager', 'Lifecycle', `Database initialization for ${this.projectName} successful.`, 'end');
                    return; // Exit loop on success

                } catch (err) {
                    lastError = err;
                    Logger.warn('StaticDataManager', 'Lifecycle', `Initialization failed for ${this.projectName}: ${err.message}. Retrying... (${i + 1}/${MAX_DB_RETRIES})`);
                    if (tempDb) {
                        tempDb.close((closeErr) => {
                            if (closeErr) Logger.error('StaticDataManager', 'Lifecycle', 'Error closing DB during retry:', closeErr.message);
                        });
                    }
                    await new Promise(resolve => setTimeout(resolve, DB_RETRY_DELAY_MS));
                }
            }
            Logger.error('StaticDataManager', 'Lifecycle', `Initialization failed for ${this.projectName} after ${MAX_DB_RETRIES} retries. Last error: ${lastError.message}`, lastError);
            this.db = null; // Ensure db is null if all retries fail
            throw lastError; // Re-throw the last error after all retries fail        
        };

        this.initializationPromise = doInitialize();
        return this.initializationPromise;
    }

    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) { Logger.error('StaticDataManager', 'Lifecycle', 'Error closing static database:', err.message); }
                else { Logger.log('StaticDataManager', 'Lifecycle', 'Static database closed.'); }
            });
            this.db = null;
        }
        this.initializationPromise = null;
    }

    // ==========================================================
    // --- BASIC STORAGE METHODS ---
    // ==========================================================

    async saveSetting(key, value) {
        await this.initialize();
        return dbRun(this.db, `INSERT OR REPLACE INTO project_settings (setting_key, setting_value) VALUES (?, ?)`, [key, value]);
    }

    async getSetting(key) {
        await this.initialize();
        const row = await dbGet(this.db, `SELECT setting_value FROM project_settings WHERE setting_key = ?`, [key]);
        return row ? row.setting_value : null;
    }

    async saveCharacterSheet(characterName, characterSheetData, contentHash) {
        await this.initialize();
        const result = await dbRun(this.db, `INSERT OR REPLACE INTO character_sheets (project_name, character_name, character_sheet_data, content_hash) VALUES (?, ?, ?, ?)`, [this.projectName, characterName, characterSheetData, contentHash]);
        return result.lastID;
    }

    async getCharacterSheet(characterName) {
        await this.initialize();
        const row = await dbGet(this.db, `SELECT character_sheet_data, content_hash FROM character_sheets WHERE project_name = ? AND character_name = ?`, [this.projectName, characterName]);
        return row ? { character_sheet_data: row.character_sheet_data, content_hash: row.content_hash } : null;
    }

    async saveSummary(filePath, summaryData, contentHash) {
        await this.initialize();
        const result = await dbRun(this.db, `INSERT OR REPLACE INTO summaries (file_path, summary_data, content_hash) VALUES (?, ?, ?)`, [filePath, summaryData, contentHash]);
        return result.lastID;
    }

    async getSummary(filePath) {
        await this.initialize();
        const row = await dbGet(this.db, `SELECT summary_data, content_hash FROM summaries WHERE file_path = ?`, [filePath]);
        return row ? { summary_data: row.summary_data, content_hash: row.content_hash } : null;
    }

    // ==========================================================
    // --- BASIC STORAGE METHODS ---
    // ==========================================================

    /**
     * Executes a generic, read-only SQL query for plugins.
     * @param {string} sql - The SQL query to execute.
     * @param {Array<any>} [params=[]] - The parameters for the SQL query.
     * @returns {Promise<Array<Object>>} A promise that resolves to an array of rows.
     */
    async genericQuery(sql, params = []) {
        await this.initialize();
        if (!this.db) {
            throw new Error("StaticDataManager DB not initialized.");
        }
        if (!sql || !sql.trim().toUpperCase().startsWith('SELECT')) {
            throw new Error("Validation Error: genericQuery only accepts SELECT statements.");
        }
        try {
            // Use the promisified dbAll helper
            const rows = await dbAll(this.db, sql, params);
            return rows;
        } catch (error) {
            Logger.error('StaticDataManager', 'Database', `genericQuery failed for SQL: ${sql}`, error);
            throw error;
        }
    }

    /**
     * Executes a generic SQL command for writing data (INSERT, UPDATE, DELETE) for plugins.
     * @param {string} sql - The SQL command to execute.
     * @param {Array<any>} [params=[]] - The parameters for the SQL command.
     * @returns {Promise<Object>} A promise that resolves to the result of the `run` command (e.g., { changes, lastID }).
     */
    async genericExecute(sql, params = []) {
        await this.initialize();
        if (!this.db) {
            throw new Error("StaticDataManager DB not initialized.");
        }
        if (!sql || sql.trim().toUpperCase().startsWith('SELECT')) {
            throw new Error("Validation Error: genericExecute cannot be used for SELECT statements.");
        }
        try {
            // Use the promisified dbRun helper
            const result = await dbRun(this.db, sql, params);
            return result;
        } catch (error) {
            Logger.error('StaticDataManager', 'Persistence', `genericExecute failed for SQL: ${sql}`, error);
            throw error;
        }
    }

    // ==========================================================
    // --- VECTOR STORE / RAG PROCESSING ---
    // ==========================================================

    async processAndEmbedFile(fileContent, fileId, metadata, projectName, storeType) {
        return await runRAGPipeline(fileContent, fileId, metadata, projectName, storeType, "StaticDataManager");
    }
}

module.exports = StaticDataManager;

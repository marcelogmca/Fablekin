const lancedb = require('@lancedb/lancedb');
const { OllamaEmbeddings } = require("@langchain/ollama");
const { Logger, readSettings, slugifyProjectName } = require("../../utils");
const path = require('path');
const fs = require('fs');

// #region MODULE CONFIGURATION
const settings = readSettings();
const stores = {};
const initPromises = {}; // Cache for in-progress initializations
let currentProjectRoot = null;

const embeddings = new OllamaEmbeddings({
    model: settings.infrastructure?.providers?.ollama?.model,
    base_url: settings.infrastructure?.providers?.ollama?.base_url,
    timeout: settings.infrastructure?.providers?.ollama?.embeddingsTimeout || 60000,
    numCtx: settings.infrastructure?.providers?.ollama?.context_window || 8192,
});

/**
 * Sets the root directory for the current project.
 * Called by main.js during project selection.
 */
function setProjectRoot(root) {
    Logger.log('VectorStoreManager', 'Lifecycle', `Setting active project root: ${root}`);
    currentProjectRoot = root;
    // Clear cache when switching projects
    for (const key in stores) delete stores[key];
}

function sanitizeString(str) {
    if (!str) return str;
    let clean = str.toWellFormed();
    clean = clean.replace(/[─-╿]/g, ""); // Remove box drawing
    clean = clean.replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{Sc}\n\r]/gu, '');
    return clean;
}

/**
 * Translates a MongoDB-style filter (used by the app's old Chroma logic) to a LanceDB SQL filter.
 * Currently handles basic $and with $eq.
 */
function translateFilter(filter) {
    if (!filter) return null;
    if (typeof filter === 'string') return filter; // Support raw SQL strings

    const formatValue = (v) => {
        if (typeof v === 'string') {
            // Escape single quotes for SQL: ' becomes ''
            const escaped = v.replace(/'/g, "''");
            return `'${escaped}'`;
        }
        return v; // Return as is for booleans, numbers
    };

    const quoteKey = (k) => k === 'turn_number' ? k : `"${k}"`;

    if (filter.$and) {
        return filter.$and.map(cond => {
            const key = Object.keys(cond)[0];
            const condVal = cond[key];
            const qKey = quoteKey(key);
            if (condVal && typeof condVal === 'object') {
                if (condVal.$eq !== undefined) return `${qKey} = ${formatValue(condVal.$eq)}`;
                if (condVal.$like !== undefined) return `${qKey} LIKE ${formatValue(condVal.$like)}`;
                if (condVal.$lte !== undefined) return `${qKey} <= ${formatValue(condVal.$lte)}`;
                if (condVal.$lt !== undefined) return `${qKey} < ${formatValue(condVal.$lt)}`;
                if (condVal.$gte !== undefined) return `${qKey} >= ${formatValue(condVal.$gte)}`;
                if (condVal.$gt !== undefined) return `${qKey} > ${formatValue(condVal.$gt)}`;
            }
            return `${qKey} = ${formatValue(condVal)}`;
        }).join(' AND ');
    }
    // Basic key-value fallback
    const key = Object.keys(filter)[0];
    if (key) {
        const condVal = filter[key];
        const qKey = quoteKey(key);
        if (condVal && typeof condVal === 'object') {
            if (Array.isArray(condVal)) {
                const inValues = condVal.map(v => formatValue(v)).join(', ');
                return `${qKey} IN (${inValues})`;
            }
            if (condVal.$in !== undefined && Array.isArray(condVal.$in)) {
                const inValues = condVal.$in.map(v => formatValue(v)).join(', ');
                return `${qKey} IN (${inValues})`;
            }
            if (condVal.$eq !== undefined) return `${qKey} = ${formatValue(condVal.$eq)}`;
            if (condVal.$like !== undefined) return `${qKey} LIKE ${formatValue(condVal.$like)}`;
            if (condVal.$lte !== undefined) return `${qKey} <= ${formatValue(condVal.$lte)}`;
            if (condVal.$lt !== undefined) return `${qKey} < ${formatValue(condVal.$lt)}`;
            if (condVal.$gte !== undefined) return `${qKey} >= ${formatValue(condVal.$gte)}`;
            if (condVal.$gt !== undefined) return `${qKey} > ${formatValue(condVal.$gt)}`;
        }
        return `${qKey} = ${formatValue(condVal)}`;
    }
    return null;
}

function mapRowToDocument(row) {
    const { text, metadata_json, ...metadata } = row;
    delete metadata.vector;
    delete metadata._distance;

    let parsedMetadata = { ...metadata };
    if (metadata_json) {
        try {
            const parsed = JSON.parse(metadata_json);
            parsedMetadata = { ...parsed, ...parsedMetadata };
        } catch { }
    }

    return {
        pageContent: text,
        metadata: parsedMetadata
    };
}
// #endregion

// #region LANCE STORE WRAPPER
/**
 * A wrapper class that mimics the LangChain/Chroma interface for compatibility.
 */
class LanceDBStore {
    constructor(db, table, tableName, embeddings) {
        this.db = db;
        this.table = table;
        this.tableName = tableName;
        this.embeddings = embeddings;
    }

    async addDocuments(documents) {
        const maxRetries = 3;
        let attempt = 0;

        while (attempt < maxRetries) {
            try {
                const batchSize = 100;
                for (let i = 0; i < documents.length; i += batchSize) {
                    const batchDocs = documents.slice(i, i + batchSize);
                    const texts = batchDocs.map(d => sanitizeString(d.pageContent));
                    const vectors = await this.embeddings.embedDocuments(texts);

                    const data = [];
                    for (let j = 0; j < batchDocs.length && j < vectors.length; j++) {
                        const vector = vectors[j];
                        const text = texts[j];

                        // Skip rows with empty vectors or empty text.
                        // LanceDB/Arrow throws "Need at least 8 bytes in buffers[0]... but got 0" 
                        // if a Float64 array/vector is provided as a zero-length buffer.
                        if (!vector || vector.length === 0) {
                            Logger.warn('LanceDBStore', 'Persistence', `Skipping document at index ${j} due to empty/null vector embedding.`);
                            continue;
                        }

                        if (!text || text.trim().length === 0) {
                            Logger.warn('LanceDBStore', 'Persistence', `Skipping document at index ${j} due to empty text after sanitization.`);
                            continue;
                        }

                        const doc = batchDocs[j];
                        // LanceDB's `initialData` always creates columns for turn_number and source.
                        // If they are missing ENTIRELY from the object's keys, the LanceDB Arrow JS builder 
                        // crashes with "Need at least 8 bytes in buffers[0] in array of type Float64, but got 0".
                        // Providing them as undefined fixes this by pushing a valid null into the Float64 column buffer.
                        const flatData = {
                            vector: vector,
                            text: text,
                            turn_number: undefined,
                            source: undefined,
                            contentHash: undefined,
                            metadata_json: undefined
                        };

                        if (doc.metadata) {
                            flatData.metadata_json = JSON.stringify(doc.metadata);
                            Object.entries(doc.metadata).forEach(([k, v]) => {
                                flatData[k] = v;
                            });
                        }
                        data.push(flatData);
                    }

                    if (data.length > 0) {
                        await this.table.add(data);
                    }

                    if (documents.length > batchSize) {
                        Logger.log('LanceDBStore', 'Persistence', `Added batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)} (Processed ${data.length}/${batchDocs.length} docs)`);
                    }
                }
                return true;
            } catch (error) {
                attempt++;
                const isConflict = error.message.includes('conflicting transaction') || error.message.includes('version 1') || error.message.includes('LanceError(Schema)');

                if (isConflict && attempt < maxRetries) {
                    Logger.warn('LanceDBStore', 'Persistence', `Transaction conflict detected (attempt ${attempt}). Retrying in 1s...`);
                    // Optional: Refresh table handle if we suspect it's stale
                    try {
                        this.table = await this.db.openTable(this.tableName);
                    } catch (openErr) {
                        Logger.error('LanceDBStore', 'Persistence', `Failed to refresh table handle: ${openErr.message}`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                Logger.error('LanceDBStore', 'Persistence', `Failed to add documents: ${error.message}`);
                throw error;
            }
        }
    }

    async similaritySearch(query, k = 4, filter = null) {
        try {
            let queryBuilder;
            const sqlFilter = translateFilter(filter);

            if (typeof query === 'string' && query.trim().length > 0) {
                const vector = await this.embeddings.embedQuery(query);
                queryBuilder = this.table.vectorSearch(vector);
                if (sqlFilter) {
                    queryBuilder = queryBuilder.where(sqlFilter);
                }
                queryBuilder = queryBuilder.limit(k);
            } else {
                // Scalar Search (Metadata Scan)
                // Select all columns by default to avoid schema access which can be flaky on new tables
                queryBuilder = this.table.query();
                if (sqlFilter) {
                    queryBuilder = queryBuilder.where(sqlFilter);
                }
                queryBuilder = queryBuilder.limit(k);
            }

            const results = await queryBuilder.toArray();

            return results.map(r => {
                const document = mapRowToDocument(r);
                // Double check if turn_number is in metadata. If it was added via ALTER TABLE it might be null initially.
                if (document.metadata.turn_number === undefined && filter?.turn_number !== undefined) {
                    // This is a safety fallback for when the column exists but isn't returned for some reason
                }
                return document;
            });
        } catch (error) {
            // Handle schema error specifically
            if (error.message.includes('No field named turn_number')) {
                Logger.warn('LanceDBStore', 'Query', `Table missing turn_number column. Attempting to add it...`);
                try {
                    await this.table.add([{ vector: new Array(this.embeddings.dimensions || 1536).fill(0), text: "_schema_fix_", turn_number: 0 }]);
                    // After adding a row with the field, LanceDB should recognize the column
                    return await this.similaritySearch(query, k, null); // Retry without filter first to avoid infinite recursion
                } catch (addErr) {
                    Logger.error('LanceDBStore', 'Query', `Schema fix failed: ${addErr.message}`);
                }
            }
            Logger.error('LanceDBStore', 'Query', `Similarity search failed: ${error.message}`);
            return [];
        }
    }

    async search(query, k = 4, filter = null) {
        return await this.similaritySearch(query, k, filter);
    }

    async metadataSearch(filter = null, limit = 10000) {
        try {
            const sqlFilter = translateFilter(filter);
            let queryBuilder = this.table.query();
            if (sqlFilter) {
                queryBuilder = queryBuilder.where(sqlFilter);
            }
            queryBuilder = queryBuilder.limit(limit);

            const results = await queryBuilder.toArray();
            return results.map(mapRowToDocument);
        } catch (error) {
            Logger.error('LanceDBStore', 'Query', `Metadata search failed: ${error.message}`);
            return [];
        }
    }

    async delete(filter) {
        const sqlFilter = translateFilter(filter);
        if (sqlFilter) {
            await this.table.delete(sqlFilter);
        }
    }

    async deleteCollection() {
        // LanceDB tables are deleted from the database
        await this.db.dropTable(this.tableName);
    }

    get collection() {
        // Compatibility shim for direct count calls
        const self = this;
        return {
            count: async () => {
                return await self.table.countRows();
            },
            get: async () => {
                // Minimal shim for inspectStore
                const rows = await self.table.query().toArray();
                return {
                    ids: rows.map((_, i) => i.toString()),
                    documents: rows.map(r => r.text),
                    metadatas: rows.map(r => {
                        const { metadata_json, ...meta } = r;
                        let parsedMeta = { ...meta };
                        if (metadata_json) {
                            try {
                                parsedMeta = { ...JSON.parse(metadata_json), ...parsedMeta };
                            } catch { }
                        }
                        return parsedMeta;
                    })
                };
            }
        };
    }

    async rowCount() {
        return await this.table.countRows();
    }
}
// #endregion

// #region STORE RETRIEVAL/INITIALIZATION
/**
 * Checks if the embedding service (Ollama) is reachable.
 * @returns {Promise<boolean>}
 */
async function isEmbeddingServiceAvailable() {
    let timer = null;
    try {
        const baseUrl = settings.infrastructure?.providers?.ollama?.base_url || 'http://127.0.0.1:11434';
        const controller = new globalThis.AbortController();
        timer = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(baseUrl, { method: 'HEAD', signal: controller.signal });
        return response.ok || response.status === 404; // Ollama returns 404 for HEAD /
    } catch {
        return false;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Retrieves or initializes a LanceDB vector store instance for a given project and collection suffix.
 * @param {string} [projectName="default"] - The name of the project.
 * @param {string} [collectionSuffix="memory_store"] - The suffix for the collection name.
 * @param {object} [options={}] - Additional options (e.g., { rawPath: 'path/to/db' })
 * @returns {Promise<LanceDBStore>} The LanceDB vector store instance.
 */
async function getStore(projectName = "default", collectionSuffix = "memory_store", options = {}) {
    // Ensure projectName is a valid string
    if (!projectName) projectName = "default";

    // Determine path
    let projectPath;
    const safeProjectName = slugifyProjectName(projectName);
    const safeCurrentRootName = currentProjectRoot ? slugifyProjectName(path.basename(currentProjectRoot)) : null;

    if (currentProjectRoot && (projectName === "default" || safeCurrentRootName === safeProjectName)) {
        projectPath = currentProjectRoot;
    } else {
        // Fallback to searching in PROJECTS_ROOT if not set or mismatched
        projectPath = path.join(process.cwd(), 'workspace', 'projects', projectName);
    }

    let dbPath;
    if (options.rawPath) {
        dbPath = options.rawPath;
    } else {
        dbPath = path.join(projectPath, 'vectors', collectionSuffix);
    }

    if (stores[dbPath]) return stores[dbPath];
    if (initPromises[dbPath]) return initPromises[dbPath];

    // If using a raw path for reading, we might want to check if it exists first
    // but lancedb.connect will handle the directory creation if allowed.
    if (!fs.existsSync(path.dirname(dbPath))) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    initPromises[dbPath] = (async () => {
        Logger.log('VectorStoreManager', 'Lifecycle', `Initializing LanceDB at: ${dbPath}`, 'start');
        try {
            const db = await lancedb.connect(dbPath);
            const tableName = 'embeddings';
            let table;

            const tableNames = await db.tableNames();
            if (tableNames.includes(tableName)) {
                table = await db.openTable(tableName);
            } else {
                // IMPORTANT: If this is a rawPath (external megalore), we should NOT create a dummy doc.
                // If the table doesn't exist in a rawPath, it's either the wrong path or an empty export.
                if (options.rawPath) {
                    throw new Error(`Table 'embeddings' not found in external knowledge base at ${dbPath}`);
                }

                try {
                    // BEFORE creating, check if Ollama is even there.
                    const isAvailable = await isEmbeddingServiceAvailable();
                    if (!isAvailable) {
                        throw new Error("Ollama connection refused. Embedding service is offline.");
                    }

                    // Create table with a minimal dummy document to establish core schema
                    const dummyVector = await embeddings.embedQuery("initialization");
                    const initialData = [{
                        vector: dummyVector,
                        text: "initialization",
                        turn_number: 0,
                        source: "system",
                        contentHash: "system",
                        metadata_json: "{}"
                    }];
                    table = await db.createTable(tableName, initialData);
                } catch (createError) {
                    // Fallback in case of a race condition between tableNames() check and createTable()
                    if (createError.message.includes('already exists')) {
                        table = await db.openTable(tableName);
                    } else {
                        throw createError;
                    }
                }
            }

            const store = new LanceDBStore(db, table, tableName, embeddings);
            stores[dbPath] = store;
            delete initPromises[dbPath];
            Logger.log('VectorStoreManager', 'Lifecycle', `Initialization complete for: ${dbPath}`, 'end');
            return store;
        } catch (error) {
            delete initPromises[dbPath];

            // Check for connection errors specifically to be less "scary" in logs
            const isConnError = error.message.includes('ECONNREFUSED') || error.message.includes('connection refused') || error.message.includes('fetch failed');
            if (isConnError) {
                Logger.warn('VectorStoreManager', 'Lifecycle', `Vector store degradation: Embedding service (Ollama) is offline. Vector features will be skipped for ${dbPath}.`);
            } else {
                Logger.error('VectorStoreManager', 'Lifecycle', 'Initialization failed:', error);
            }

            throw new Error(`Vector store init failed for path ${dbPath}: ${error.message}`);
        }
    })();

    return initPromises[dbPath];
}
// #endregion

// #region CHAPTER INDEX STORE RETRIEVAL
async function getChapterIndexStore(projectName = "default") {
    return getStore(projectName, "chapter_index");
}
// #endregion

// #region STORE DELETION
async function deleteStore(projectName, suffix) {
    // Simply delete the directory for LanceDB
    const safeName = slugifyProjectName(projectName);
    const projectPath = currentProjectRoot || path.join(process.cwd(), 'workspace', 'projects', safeName);
    const dbPath = path.join(projectPath, 'vectors', suffix);

    Logger.log('VectorStoreManager', 'Persistence', `Deleting LanceDB directory: ${dbPath}`, 'start');
    try {
        if (fs.existsSync(dbPath)) {
            fs.rmSync(dbPath, { recursive: true, force: true });
        }
        delete stores[dbPath];
        Logger.log('VectorStoreManager', 'Persistence', `Successfully deleted directory: ${dbPath}`, 'end');
    } catch (error) {
        Logger.error('VectorStoreManager', 'Persistence', `Failed to delete directory ${dbPath}:`, error);
        throw error;
    }
}
// #endregion

// #region EXPORTS
module.exports = { getStore, getChapterIndexStore, deleteStore, embeddings, setProjectRoot };
// #endregion

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const levenshtein = require('js-levenshtein');
const fs = require('fs');
const { resolveTurnStorageKey } = require('../../../modules/turn_storage_key.js');

// #region CONFIGURATION & DEFAULTS
const PREDICATE_WEIGHTS = {
    // Identity & Family (Deepest)
    'IS_A': 5, 'IDENTITY': 5, 'FAMILY': 5, 'MOTHER': 5, 'FATHER': 5, 'SON': 5, 'DAUGHTER': 5, 'SPOUSE': 5, 'IS_SISTER_OF': 5, 'IS_BROTHER_OF': 5,
    // Emotional & Core Alignment (Deep)
    'TRUSTS': 10, 'HATES': 10, 'LOVES': 10, 'ENEMY_OF': 10, 'ALLY_OF': 10,
    // Professional/Social (Medium)
    'WORKS_FOR': 25, 'MEMBER_OF': 25, 'LEADER_OF': 25,
    // Acquaintance/Location (Shallow)
    'KNOWS': 40, 'LIVES_IN': 40, 'VISITED': 40, 'ORIGIN': 30,
    // Default
    'DEFAULT': 20
};

const DEFAULTS = {
    PROCESS_TURN_TIMEOUT: 90000,
    DIRECT_TRIPLES_LIMIT: 50,
    ALIAS_AUTO_ACCEPT_THRESHOLD: 0.85,
    DEDUPLICATION_THRESHOLD: 0.95,
    NARRATIVE_ENERGY_BUDGET: 100,
    MAX_TRIPLES_PER_TURN: 60,
    VECTOR_CANDIDATE_LIMIT: 4000,
    VECTOR_SCORE_THRESHOLD: 0.4,
    TEXT_DEDUPLICATION_THRESHOLD: 0.92,
    MIN_STORY_CHARS_FOR_EXTRACTION: 80,
    MAX_CONTEXT_CHARS: 220
};

const getKGSettings = (tools) => {
    const globalSettings = tools.settings.get?.() || {};
    const selfSettings = tools.settings.getSelf?.() || {};
    const scopedSettings = globalSettings.plugins?.knowledge_graph || {};
    return { ...scopedSettings, ...selfSettings };
};

const toBoundedNumber = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
};

const toBoundedInteger = (value, fallback, min, max) => {
    return Math.round(toBoundedNumber(value, fallback, min, max));
};

const getKGConfig = (tools) => {
    const KG_SETTINGS = getKGSettings(tools);
    return {
        ENTITY_EXTRACTOR: KG_SETTINGS.entity_extractor || {
            model: 'highendmodel',
            llm_params: { temperature: 0.0, max_tokens: 512 },
            enabled: true, retries: 2, timeout: 60000
        },
        EXTRACTOR: KG_SETTINGS.extractor || {
            model: 'mediumendmodel',
            llm_params: { temperature: 0.2, max_tokens: 2048 },
            enabled: true, retries: 1, timeout: 120000
        },
        RUNTIME: {
            maxTriplesPerTurn: toBoundedInteger(KG_SETTINGS.max_triples_per_turn, DEFAULTS.MAX_TRIPLES_PER_TURN, 5, 500),
            vectorCandidateLimit: toBoundedInteger(KG_SETTINGS.vector_candidate_limit, DEFAULTS.VECTOR_CANDIDATE_LIMIT, 100, 100000),
            vectorScoreThreshold: toBoundedNumber(KG_SETTINGS.vector_min_score, DEFAULTS.VECTOR_SCORE_THRESHOLD, 0, 1),
            textDeduplicationThreshold: toBoundedNumber(KG_SETTINGS.text_dedupe_threshold, DEFAULTS.TEXT_DEDUPLICATION_THRESHOLD, 0.5, 1),
            aliasAutoAcceptThreshold: toBoundedNumber(KG_SETTINGS.alias_auto_accept_threshold, DEFAULTS.ALIAS_AUTO_ACCEPT_THRESHOLD, 0.7, 0.99),
            minStoryCharsForExtraction: toBoundedInteger(KG_SETTINGS.min_story_chars_for_extraction, DEFAULTS.MIN_STORY_CHARS_FOR_EXTRACTION, 0, 5000),
            maxContextChars: toBoundedInteger(KG_SETTINGS.max_context_chars, DEFAULTS.MAX_CONTEXT_CHARS, 40, 1200)
        }
    };
};

const TEMPORARY_PREDICATE_PATTERNS = [
    /^IS_(AT|IN|ON|LOCATED(_AT)?|NOW(_AT)?)$/,
    /^HAS_(INVENTORY|TASK|QUEST|GOAL)$/,
    /^NEEDS_TO$/,
    /^WANTS_TO$/,
    /^IS_(FEELING|DOING|TRAVELING|MOVING|SEARCHING)$/
];

const REGEX = {
    TRIPLE_EXTRACTION: new RegExp('^NO_LORE_TRIPLES_EXTRACTED$|^\\(.*?;.*?;.*?\\)$', 'm'),
};

const NO_LORE_KEYWORD = 'NO_LORE_TRIPLES_EXTRACTED';
// #endregion

class KnowledgeGraph {
    // #region PROPERTIES
    db = null;
    dbPath = null;
    tableName = 'knowledge_graph';
    initialized = false;
    processing = false;
    isChatDb = false; // "Sophisticated" mode for the active story

    promptsDir = path.join(__dirname, '../prompts');
    entityExtractorPrompt = '';
    extractionPrompt = '';
    runtimeConfig = {
        maxTriplesPerTurn: DEFAULTS.MAX_TRIPLES_PER_TURN,
        vectorCandidateLimit: DEFAULTS.VECTOR_CANDIDATE_LIMIT,
        vectorScoreThreshold: DEFAULTS.VECTOR_SCORE_THRESHOLD,
        textDeduplicationThreshold: DEFAULTS.TEXT_DEDUPLICATION_THRESHOLD,
        aliasAutoAcceptThreshold: DEFAULTS.ALIAS_AUTO_ACCEPT_THRESHOLD,
        minStoryCharsForExtraction: DEFAULTS.MIN_STORY_CHARS_FOR_EXTRACTION,
        maxContextChars: DEFAULTS.MAX_CONTEXT_CHARS
    };
    // #endregion

    // #region INITIALIZATION & SHUTDOWN
    constructor(dbPath, tableName = 'knowledge_graph') {
        this.dbPath = dbPath;
        this.tableName = tableName;
    }

    async initialize(tools, options = { readOnly: false, isChatDb: false }) {
        if (this.initialized) return;

        this.isChatDb = options.isChatDb;
        this.runtimeConfig = getKGConfig(tools).RUNTIME;
        tools.logger.log(`Initializing DB at ${this.dbPath} (Mode: ${this.isChatDb ? 'Chat/Sophisticated' : 'Reference/Simple'}, Table: ${this.tableName})`);

        // Load prompts
        try {
            this.entityExtractorPrompt = fs.readFileSync(path.join(this.promptsDir, 'knowledge_graph_entity_extractor_prompt.txt'), 'utf8');
            this.extractionPrompt = fs.readFileSync(path.join(this.promptsDir, 'knowledge_graph_extraction_prompt.txt'), 'utf8');
        } catch (e) {
            tools.logger.error('KnowledgeGraph: Failed to load one or more prompts.', e);
        }

        try {
            const dbOptions = {
                filename: this.dbPath,
                driver: sqlite3.Database
            };
            if (options.readOnly) {
                dbOptions.mode = sqlite3.OPEN_READONLY;
            }

            this.db = await open(dbOptions);

            if (!options.readOnly) {
                await this.db.exec('PRAGMA journal_mode = WAL');
                await this.db.exec('PRAGMA busy_timeout = 5000');
            }

            if (this.isChatDb || !options.readOnly) {
                await this._initSchema();
            }

            this.initialized = true;
            tools.logger.log(`Initialization complete for ${this.dbPath}.`);
        } catch (error) {
            tools.logger.error(`Failed to initialize SQLite database at ${this.dbPath}:`, error);
            this.initialized = false; this.db = null;
            throw error;
        }
    }

    async _initSchema() {
        // 1. Base Table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subject TEXT NOT NULL,
                predicate TEXT NOT NULL,
                object TEXT NOT NULL,
                context TEXT,
                turn_number INTEGER NOT NULL DEFAULT -1,
                turn_created INTEGER NOT NULL DEFAULT -1,
                turn_key TEXT,
                scene_mode TEXT NOT NULL DEFAULT 'mainline',
                interlude_id INTEGER,
                interlude_ordinal INTEGER,
                source_type TEXT DEFAULT 'dynamic_turn',
                source_file TEXT,
                confidence REAL DEFAULT 0.5,
                provenance TEXT,
                active INTEGER DEFAULT 1,
                valid_from INTEGER,
                valid_to INTEGER,
                contradiction_flag INTEGER DEFAULT 0,
                context_embedding BLOB,
                UNIQUE(subject, predicate, object, source_type, source_file)
            );
        `);

        // 2. Migration: Add missing columns if they don't exist
        const columns = await this.db.all(`PRAGMA table_info(${this.tableName})`);
        const columnNames = columns.map(c => c.name);

        if (!columnNames.includes('turn_created')) {
            await this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN turn_created INTEGER NOT NULL DEFAULT -1`);
        }
        if (!columnNames.includes('turn_key')) {
            await this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN turn_key TEXT`);
        }
        if (!columnNames.includes('scene_mode')) {
            await this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN scene_mode TEXT NOT NULL DEFAULT 'mainline'`);
        }
        if (!columnNames.includes('interlude_id')) {
            await this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN interlude_id INTEGER`);
        }
        if (!columnNames.includes('interlude_ordinal')) {
            await this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN interlude_ordinal INTEGER`);
        }
        if (!columnNames.includes('context_embedding')) {
            await this.db.exec(`ALTER TABLE ${this.tableName} ADD COLUMN context_embedding BLOB`);
        }

        await this.db.exec(`
            UPDATE ${this.tableName}
            SET turn_key = COALESCE(NULLIF(TRIM(turn_key), ''), CAST(COALESCE(turn_created, turn_number, -1) AS TEXT))
            WHERE turn_key IS NULL OR TRIM(turn_key) = ''
        `);

        await this.db.exec(`
            UPDATE ${this.tableName}
            SET scene_mode = COALESCE(NULLIF(TRIM(scene_mode), ''), 'mainline')
            WHERE scene_mode IS NULL OR TRIM(scene_mode) = ''
        `);

        // 3. Create indices
        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_kg_${this.tableName}_subject ON ${this.tableName} (subject);
            CREATE INDEX IF NOT EXISTS idx_kg_${this.tableName}_object ON ${this.tableName} (object);
            CREATE INDEX IF NOT EXISTS idx_kg_${this.tableName}_active ON ${this.tableName} (active);
            CREATE INDEX IF NOT EXISTS idx_kg_${this.tableName}_turn_created ON ${this.tableName} (turn_created);
            CREATE INDEX IF NOT EXISTS idx_kg_${this.tableName}_turn_key ON ${this.tableName} (turn_key);
            CREATE INDEX IF NOT EXISTS idx_kg_${this.tableName}_scene_mode ON ${this.tableName} (scene_mode);
        `);

        // 4. Create FTS table
        await this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName}_fts USING fts5(
                subject, predicate, object, context,
                content='${this.tableName}', content_rowid='id', tokenize='porter'
            );
        `);

        if (this.isChatDb) {
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS aliases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    canonical TEXT NOT NULL,
                    alias TEXT NOT NULL,
                    last_seen_turn INTEGER,
                    confidence REAL DEFAULT 0.5,
                    UNIQUE(canonical, alias)
                );

                CREATE TABLE IF NOT EXISTS predicates (
                    predicate TEXT PRIMARY KEY,
                    seen_count INTEGER DEFAULT 0,
                    last_seen_turn INTEGER,
                    mutable INTEGER DEFAULT 0,
                    weight REAL DEFAULT 1.0
                );
            `);
        }

        // Table for tracking processed static files
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS file_hashes (
                file_path TEXT PRIMARY KEY,
                hash TEXT NOT NULL,
                last_processed_turn INTEGER
            );
        `);

        // Triggers for FTS maintenance
        await this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS ${this.tableName}_ai AFTER INSERT ON ${this.tableName} BEGIN
                INSERT INTO ${this.tableName}_fts(rowid, subject, predicate, object, context) VALUES (new.id, new.subject, new.predicate, new.object, new.context);
            END;
            CREATE TRIGGER IF NOT EXISTS ${this.tableName}_ad AFTER DELETE ON ${this.tableName} BEGIN
                INSERT INTO ${this.tableName}_fts(${this.tableName}_fts, rowid, subject, predicate, object, context) VALUES ('delete', old.id, old.subject, old.predicate, old.object, old.context);
            END;
            CREATE TRIGGER IF NOT EXISTS ${this.tableName}_au AFTER UPDATE ON ${this.tableName} BEGIN
                INSERT INTO ${this.tableName}_fts(${this.tableName}_fts, rowid, subject, predicate, object, context) VALUES ('delete', old.id, old.subject, old.predicate, old.object, old.context);
                INSERT INTO ${this.tableName}_fts(rowid, subject, predicate, object, context) VALUES (new.id, new.subject, new.predicate, new.object, new.context);
            END;
        `);
    }

    async close() {
        if (this.db) {
            try { await this.db.close(); } catch { }
        }
        this.initialized = false; this.db = null;
    }
    // #endregion

    // #region HELPERS
    /**
     * Executes a database operation with retries on SQLITE_BUSY or SQLITE_LOCKED.
     */
    async withRetry(operation, tools, maxRetries = 10, initialDelay = 100) {
        let lastError = null;
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                const isBusy = error.message.includes('SQLITE_BUSY') || error.message.includes('database is locked') || error.code === 'SQLITE_BUSY';
                if (isBusy && i < maxRetries - 1) {
                    const delay = initialDelay * Math.pow(2, i) * (0.5 + Math.random()); // Exponential backoff with jitter
                    tools.logger.warn('KnowledgeGraph', `Database busy/locked. Retry ${i + 1}/${maxRetries} in ${Math.round(delay)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }
    // #endregion

    // #region SHARED LOGIC (THE BRAIN) - USED BY STATIC MANAGER & PROCESS TURN

    /**
     * Extracts entities/concepts from text using LLM.
     */
    async extractEntities(text, turnNumber = null, tools) {
        if (!text) return { search: [], entities: [], actions: [], concepts: [], synonyms: [] };
        const systemPrompt = this.entityExtractorPrompt;
        const userPrompt = `<TEXT>${text}</TEXT>

Analyze the text above and provide the structured output as instructed.`;
        const CONFIG = getKGConfig(tools);

        const truncatedInput = text.length > 200 ? text.substring(0, 200).replace(/\n/g, ' ') + '...' : text.replace(/\n/g, ' ');
        tools.logger.log(`KnowledgeGraph: Extracting entities from: "${truncatedInput}"`);

        try {
            const llmResult = await tools.llm.runTask({
                msg: "KnowledgeGraph Entity Extraction",
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                model: CONFIG.ENTITY_EXTRACTOR.model,
                provider: CONFIG.ENTITY_EXTRACTOR.provider,
                params: {
                    validationRegex: /(ENTITIES:.*[\r\n]+ACTIONS:.*[\r\n]+CONCEPTS:.*[\r\n]+SYNONYMS:.*)/s,
                    ...CONFIG.ENTITY_EXTRACTOR
                }
            });
            const llmResponse = llmResult.content;

            const truncatedOutput = llmResponse.length > 200 ? llmResponse.substring(0, 200).replace(/\n/g, ' ') + '...' : llmResponse.replace(/\n/g, ' ');
            tools.logger.log(`KnowledgeGraph: LLM Response (Entities): "${truncatedOutput}"`);

            if (llmResponse) {
                const getSection = (name) => {
                    const re = new RegExp(name + ':(.*?)(?=ENTITIES:|ACTIONS:|CONCEPTS:|SYNONYMS:|$)', 'is');
                    const m = llmResponse.match(re);
                    if (!m) return [];
                    return m[1].trim().split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
                };

                const rawEntities = getSection('ENTITIES');
                const rawActions = getSection('ACTIONS');
                const rawConcepts = getSection('CONCEPTS');
                const rawSynonyms = getSection('SYNONYMS');

                // Canonicalize / normalize entities & synonyms when possible
                const canonicalizeList = async (list) => {
                    return await Promise.all(list.map(async item => {
                        if (!item) return null;
                        if (this.isChatDb && this.initialized && this.db) return await this.canonicalizeEntity(item, turnNumber);
                        return this.normalizeEntityName(item);
                    })).then(arr => arr.filter(Boolean));
                };

                const [canonicalEntities, canonicalSynonyms] = await Promise.all([
                    canonicalizeList(rawEntities),
                    canonicalizeList(rawSynonyms)
                ]);

                return {
                    search: [...new Set([...(canonicalEntities || []), ...(canonicalSynonyms || [])])],
                    entities: canonicalEntities || [],
                    actions: rawActions || [],
                    concepts: rawConcepts || [],
                    synonyms: canonicalSynonyms || []
                };
            }
            return { search: [], entities: [], actions: [], concepts: [], synonyms: [] };
        } catch (error) {
            tools.logger.error('KnowledgeGraph: Failed to extract entities/concepts using LLM.', error);
            tools.logger.log(`KnowledgeGraph: FAILED INPUT PROMPT (ENTITIES): "${userPrompt}"`);
            return { search: [], entities: [] };
        }
    }

    /**
     * Generates raw triples from text, given a list of existing context triples.
     */
    async generateTriplesFromText(text, existingTriplesContext = [], tools) {
        const CONFIG = getKGConfig(tools);
        if (!CONFIG.EXTRACTOR.enabled || !text) return [];

        const existingTriplesString = existingTriplesContext.length > 0
            ? existingTriplesContext.map(t => `(${t.subject}; ${t.predicate}; ${t.object})`).join('\n')
            : 'None.';

        const systemPrompt = this.extractionPrompt.replace('${existingTriples}', existingTriplesString);
        const userPrompt = `[FINAL INSTRUCTION]\nAnalyze this text. Extract only NEW, IMMUTABLE facts using the specified format.\n\n<TEXT>\n${text}\n</TEXT>`;

        const truncatedInput = text.length > 200 ? text.substring(0, 200).replace(/\n/g, ' ') + '...' : text.replace(/\n/g, ' ');
        tools.logger.log(`KnowledgeGraph: Generating triples from: "${truncatedInput}"`);

        try {
            const llmResult = await tools.llm.runTask({
                msg: "KnowledgeGraph Triple Generation",
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                model: CONFIG.EXTRACTOR.model,
                provider: CONFIG.EXTRACTOR.provider,
                params: {
                    validationRegex: REGEX.TRIPLE_EXTRACTION,
                    ...CONFIG.EXTRACTOR
                }
            });
            const llmResponse = llmResult.content;

            const truncatedOutput = llmResponse.length > 200 ? llmResponse.substring(0, 200).replace(/\n/g, ' ') + '...' : llmResponse.replace(/\n/g, ' ');
            tools.logger.log(`KnowledgeGraph: LLM Response (Triples): "${truncatedOutput}"`);

            return this.parseLLMResponse(llmResponse);
        } catch (error) {
            tools.logger.error(`KnowledgeGraph: Failed to generate triples for text: "${truncatedInput}"`, error);
            tools.logger.log(`KnowledgeGraph: FAILED INPUT PROMPT (TRIPLES): "${userPrompt}"`);
            return [];
        }
    }

    parseLLMResponse(llmResponse) {
        const triples = [];
        if (!llmResponse || llmResponse.trim().includes(NO_LORE_KEYWORD)) return triples;

        const lines = llmResponse.trim().split(/\r?\n/);
        for (const line of lines) {
            try {
                const trimmedLine = line.trim();
                // Find potential triple starting with '(' and ending with ')'
                const start = trimmedLine.indexOf('(');
                const end = trimmedLine.lastIndexOf(')');

                if (start === -1 || end === -1 || end <= start) continue;

                const content = trimmedLine.slice(start + 1, end);
                const [triplePart, contextPart] = content.split('|').map(p => p.trim());
                const parts = triplePart.split(';').map(p => p.trim());

                if (parts.length === 3 && parts.every(p => p)) {
                    // Extract context if present after '|'
                    let context = null;
                    if (contextPart) {
                        context = contextPart.replace(/^context:\s*/i, '').trim();
                    }
                    triples.push({ subject: parts[0], predicate: parts[1], object: parts[2], context });
                }
            } catch {
                // Ignore malformed lines
            }
        }
        return triples;
    }
    // #endregion

    // #region TURN PROCESSING & STORAGE
    async processTurn(turnContext, tools) {
        if (!this.initialized || this.processing || !this.isChatDb) return;
        const config = getKGConfig(tools);
        this.runtimeConfig = config.RUNTIME;
        const sceneMode = String(turnContext?.sceneMode || '').trim().toLowerCase() === 'interlude' ? 'interlude' : 'mainline';
        const runtimeInterlude = turnContext?.runtime?.interlude || {};
        const turnScope = {
            turnKey: resolveTurnStorageKey(turnContext),
            sceneMode,
            interludeId: Number.isInteger(runtimeInterlude.id) ? runtimeInterlude.id : null,
            interludeOrdinal: Number.isInteger(turnContext?.interludeOrdinal)
                ? turnContext.interludeOrdinal
                : (Number.isInteger(runtimeInterlude.ordinal) ? runtimeInterlude.ordinal : null)
        };

        const dialogue = turnContext?.processed?.dialogueProcessor?.dialogue || turnContext?.output?.fulltext || "";
        const userPrompt = turnContext?.input?.userPrompt || "";
        const combinedText = `[USER ACTION]\n${userPrompt}\n\n[NARRATIVE]\n${dialogue}`.trim();

        if (combinedText === '') return;
        if (combinedText.length < this.runtimeConfig.minStoryCharsForExtraction) return;

        this.processing = true;
        try {
            const entities = await this.extractEntities(combinedText, turnContext.turnNumber, tools);
            turnContext.processed.extractedEntities = entities;

            const existingTriples = await this.findDirectlyRelatedTriples(entities.search, DEFAULTS.DIRECT_TRIPLES_LIMIT);
            const rawTriples = await this.generateTriplesFromText(combinedText, existingTriples, tools);

            if (rawTriples.length > 0) {
                const normalizedTriples = await Promise.all(rawTriples.map(async (triple) => {
                    const subject = await this.canonicalizeEntity(triple.subject, turnContext.turnNumber);
                    const object = await this.canonicalizeEntity(triple.object, turnContext.turnNumber);
                    const predicate = this.normalizePredicate(triple.predicate);
                    const normalizedTriple = {
                        subject,
                        predicate,
                        object,
                        context: this.normalizeContext(triple.context, this.runtimeConfig.maxContextChars)
                    };
                    return {
                        ...normalizedTriple,
                        confidence: this.computeTripleConfidence(normalizedTriple, existingTriples),
                        provenance: `turn:${turnContext.turnNumber}`
                    };
                }));

                const processedTriples = this.consolidateTurnTriples(normalizedTriples, existingTriples, this.runtimeConfig);
                await this.storeTriples(processedTriples, turnContext.turnNumber, tools, this.runtimeConfig, turnScope);
            }
        } finally {
            this.processing = false;
        }
    }

    async storeTriples(triples, turnNumber, tools, runtimeConfig = this.runtimeConfig, turnScope = null) {
        if (!this.db || !triples || triples.length === 0) return;
        const config = runtimeConfig || this.runtimeConfig || getKGConfig(tools).RUNTIME;
        const normalizedScope = {
            turnKey: String(turnScope?.turnKey || turnNumber || -1),
            sceneMode: String(turnScope?.sceneMode || 'mainline').trim().toLowerCase() === 'interlude' ? 'interlude' : 'mainline',
            interludeId: Number.isInteger(turnScope?.interludeId) ? turnScope.interludeId : null,
            interludeOrdinal: Number.isInteger(turnScope?.interludeOrdinal) ? turnScope.interludeOrdinal : null
        };

        const sql = `INSERT OR IGNORE INTO ${this.tableName} (subject, predicate, object, context, turn_number, turn_created, turn_key, scene_mode, interlude_id, interlude_ordinal, source_type, source_file, confidence, provenance, active, valid_from, context_embedding)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        try {
            const duplicateTouchIds = new Set();
            const embeddingCandidates = [];

            // Pre-check exact SPO duplicates before embedding to avoid unnecessary vector calls.
            for (const triple of triples) {
                const existingRows = await this.db.all(
                    `SELECT id, context, context_embedding FROM ${this.tableName} WHERE subject = ? AND predicate = ? AND object = ? AND active = 1`,
                    [triple.subject, triple.predicate, triple.object]
                );

                if (!existingRows || existingRows.length === 0) {
                    embeddingCandidates.push({ triple, existingRows: [] });
                    continue;
                }

                const knownMatch = existingRows.find((row) =>
                    this.isNearDuplicateContext(triple.context, row.context, config.textDeduplicationThreshold)
                );

                if (knownMatch) {
                    duplicateTouchIds.add(knownMatch.id);
                    continue;
                }

                embeddingCandidates.push({ triple, existingRows });
            }

            // PRE-CALCULATE EMBEDDINGS OUTSIDE TRANSACTION
            // External network calls while holding a DB lock is the main cause of SQLITE_BUSY
            tools.logger.log('KnowledgeGraph', `Preparing embeddings for ${embeddingCandidates.length}/${triples.length} triples...`, 'start');
            const preparedTriples = await Promise.all(embeddingCandidates.map(async ({ triple, existingRows }) => {
                const fingerprint = `${triple.subject} ${triple.predicate} ${triple.object} ${triple.context || ''}`;
                const embedding = await tools.vector.embed(fingerprint);
                const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
                return { ...triple, existingRows, embedding, embeddingBlob };
            }));
            tools.logger.log('KnowledgeGraph', `Embeddings prepared.`, 'end');

            // EXECUTE TRANSACTION WITH RETRY
            await this.withRetry(async () => {
                await this.db.run('BEGIN IMMEDIATE TRANSACTION');
                try {
                    for (const id of duplicateTouchIds) {
                        await this.db.run(`UPDATE ${this.tableName} SET turn_created = ? WHERE id = ?`, [turnNumber, id]);
                    }

                    for (const triple of preparedTriples) {
                        let isDuplicate = false;
                        for (const row of triple.existingRows || []) {
                            if (row.context_embedding) {
                                const existingVector = new Float32Array(row.context_embedding.buffer, row.context_embedding.byteOffset, row.context_embedding.byteLength / 4);
                                const similarity = this.cosineSimilarity(triple.embedding, existingVector);
                                if (similarity > DEFAULTS.DEDUPLICATION_THRESHOLD) {
                                    await this.db.run(`UPDATE ${this.tableName} SET turn_created = ? WHERE id = ?`, [turnNumber, row.id]);
                                    isDuplicate = true;
                                    break;
                                }
                            }
                        }

                        if (isDuplicate) continue;

                        if (this.isChatDb) {
                            await this.registerPredicate(triple.predicate, turnNumber);
                            if (await this.isPredicateMutable(triple.predicate)) {
                                await this.db.run(`UPDATE ${this.tableName} SET active = 0, valid_to = ? WHERE subject = ? AND predicate = ? AND active = 1`, [turnNumber, triple.subject, triple.predicate]);
                            }
                        }

                        await this.db.run(sql, [
                            triple.subject, triple.predicate, triple.object, triple.context, turnNumber, turnNumber,
                            normalizedScope.turnKey, normalizedScope.sceneMode, normalizedScope.interludeId, normalizedScope.interludeOrdinal,
                            triple.source_type || 'dynamic_turn', triple.source_file || '',
                            triple.confidence || 0.5, triple.provenance || `turn:${turnNumber}`, 1, turnNumber,
                            triple.embeddingBlob
                        ]);
                    }
                    await this.db.run('COMMIT');
                } catch (error) {
                    await this.db.run('ROLLBACK');
                    throw error; // Rethrow to let withRetry handle it
                }
            }, tools);

        } catch (error) {
            tools.logger.error('KnowledgeGraph', 'storeTriples failed after retries.', error);
        }
    }

    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    tripleKey(triple) {
        return `${triple.subject}|${triple.predicate}|${triple.object}`;
    }

    normalizePredicate(predicate) {
        if (!predicate || typeof predicate !== 'string') return '';
        const normalized = predicate
            .trim()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(token => token.toUpperCase())
            .join('_');
        return normalized;
    }

    normalizeContext(context, maxChars = DEFAULTS.MAX_CONTEXT_CHARS) {
        if (!context || typeof context !== 'string') return null;
        const cleaned = context.replace(/\s+/g, ' ').trim();
        if (!cleaned) return null;
        if (cleaned.length <= maxChars) return cleaned;
        return `${cleaned.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
    }

    isLikelyTemporaryTriple(triple) {
        const predicate = triple?.predicate || '';
        if (!predicate) return true;
        if (TEMPORARY_PREDICATE_PATTERNS.some(re => re.test(predicate))) return true;

        const context = (triple?.context || '').toLowerCase();
        if (!context) return false;

        const temporaryHints = [
            'currently',
            'right now',
            'for now',
            'at the moment',
            'temporarily',
            'just now'
        ];
        return temporaryHints.some(hint => context.includes(hint));
    }

    contextSimilarity(textA, textB) {
        if (!textA && !textB) return 1;
        if (!textA || !textB) return 0;
        const a = String(textA).toLowerCase().replace(/\s+/g, ' ').trim();
        const b = String(textB).toLowerCase().replace(/\s+/g, ' ').trim();
        if (!a || !b) return 0;
        if (a === b) return 1;

        const maxLen = Math.max(a.length, b.length, 1);
        if (maxLen > 220) {
            // Keep Levenshtein affordable for long contexts while preserving signal.
            return this.contextSimilarity(a.slice(0, 220), b.slice(0, 220));
        }

        const distance = levenshtein(a, b);
        return 1 - (distance / maxLen);
    }

    isNearDuplicateContext(newContext, existingContext, threshold = DEFAULTS.TEXT_DEDUPLICATION_THRESHOLD) {
        if (!newContext && !existingContext) return true;
        if (!newContext || !existingContext) return false;
        return this.contextSimilarity(newContext, existingContext) >= threshold;
    }

    triplePriorityScore(triple) {
        const confidence = Number.isFinite(triple?.confidence) ? triple.confidence : 0.5;
        const predicateWeight = PREDICATE_WEIGHTS[triple?.predicate] || PREDICATE_WEIGHTS.DEFAULT;
        const predicatePriority = 1 / Math.max(predicateWeight, 1);
        const contextBonus = Math.min(((triple?.context || '').length / 120), 1) * 0.2;
        return confidence + predicatePriority + contextBonus;
    }

    consolidateTurnTriples(triples, existingTriples, runtimeConfig) {
        if (!triples || triples.length === 0) return [];

        const existingByKey = new Map();
        for (const row of existingTriples || []) {
            const key = this.tripleKey(row);
            if (!existingByKey.has(key)) existingByKey.set(key, []);
            existingByKey.get(key).push(row);
        }

        const deduped = new Map();
        for (const triple of triples) {
            if (!triple?.subject || !triple?.predicate || !triple?.object) continue;
            if (this.isLikelyTemporaryTriple(triple)) continue;

            const key = this.tripleKey(triple);
            const alreadyKnown = existingByKey.get(key) || [];
            const isKnownDuplicate = alreadyKnown.some((known) =>
                this.isNearDuplicateContext(triple.context, known.context, runtimeConfig.textDeduplicationThreshold)
            );
            if (isKnownDuplicate) continue;

            const currentBest = deduped.get(key);
            if (!currentBest || this.triplePriorityScore(triple) > this.triplePriorityScore(currentBest)) {
                deduped.set(key, triple);
            }
        }

        return Array.from(deduped.values())
            .sort((a, b) => this.triplePriorityScore(b) - this.triplePriorityScore(a))
            .slice(0, runtimeConfig.maxTriplesPerTurn);
    }
    // #endregion

    // #region RETRIEVAL
    async findDirectlyRelatedTriples(entities, limit, maxTurnNumber = null, offset = 0) {
        if (!this.db || !entities || entities.length === 0) return [];
        const ftsQuery = entities.map(e => `"${String(e).replace(/"/g, '""')}"`).join(' OR ');

        try {
            const inner = `SELECT rowid FROM ${this.tableName}_fts WHERE ${this.tableName}_fts MATCH ? LIMIT ? OFFSET ?`;
            const rows = await this.db.all(inner, [ftsQuery, limit * 2, offset]);
            if (!rows || rows.length === 0) return [];

            const ids = rows.map(r => r.rowid);
            let query = `SELECT * FROM ${this.tableName} WHERE id IN (${ids.map(() => '?').join(',')}) AND active = 1`;
            const params = [...ids];

            if (maxTurnNumber !== null) {
                query += ` AND turn_number <= ?`;
                params.push(maxTurnNumber);
            }

            query += ` LIMIT ?;`;
            params.push(limit);

            return await this.db.all(query, params);
        } catch {
            let query = `SELECT * FROM ${this.tableName} WHERE (subject IN (${entities.map(() => '?').join(',')}) OR object IN (${entities.map(() => '?').join(',')})) AND active = 1`;
            const params = [...entities, ...entities];

            if (maxTurnNumber !== null) {
                query += ` AND turn_number <= ?`;
                params.push(maxTurnNumber);
            }

            query += ` LIMIT ?`;
            params.push(limit);

            return await this.db.all(query, params);
        }
    }

    /**
     * Finds triples based on thematic vector similarity.
     */
    async findThematicallyRelatedTriples(probeEmbedding, limit = 20, maxTurnNumber = null, offset = 0, options = {}) {
        if (!this.db || !probeEmbedding) return [];

        const candidateLimit = toBoundedInteger(
            options.candidateLimit,
            this.runtimeConfig?.vectorCandidateLimit || DEFAULTS.VECTOR_CANDIDATE_LIMIT,
            100,
            100000
        );
        const scoreThreshold = toBoundedNumber(
            options.scoreThreshold,
            this.runtimeConfig?.vectorScoreThreshold || DEFAULTS.VECTOR_SCORE_THRESHOLD,
            0,
            1
        );

        let query = `SELECT id, subject, predicate, object, context, turn_number, turn_created, context_embedding FROM ${this.tableName} WHERE active = 1 AND context_embedding IS NOT NULL`;
        const params = [];

        if (maxTurnNumber !== null) {
            query += ` AND turn_number <= ?`;
            params.push(maxTurnNumber);
        }

        query += ` ORDER BY turn_created DESC`;
        if (candidateLimit > 0) {
            query += ` LIMIT ?`;
            params.push(candidateLimit);
        }

        const rows = await this.db.all(query, params);

        const scored = rows.map(row => {
            const rowVector = new Float32Array(row.context_embedding.buffer, row.context_embedding.byteOffset, row.context_embedding.byteLength / 4);
            return {
                ...row,
                score: this.cosineSimilarity(probeEmbedding, rowVector)
            };
        });

        return scored
            .filter(r => r.score >= scoreThreshold)
            .sort((a, b) => b.score - a.score)
            .slice(offset, offset + limit);
    }

    /**
     * Finds entities that connect TWO given entities (The Triangle Check).
     */
    async findBridges(entityA, entityB, maxTurnNumber = null) {
        if (!this.db) return [];

        let query = `
            SELECT t1.*, t2.*
            FROM ${this.tableName} t1
            JOIN ${this.tableName} t2 ON (t1.subject = t2.subject OR t1.subject = t2.object OR t1.object = t2.subject OR t1.object = t2.object)
            WHERE ((t1.subject = ? OR t1.object = ?) AND (t2.subject = ? OR t2.object = ?))
            AND t1.active = 1 AND t2.active = 1
        `;
        const params = [entityA, entityA, entityB, entityB];

        if (maxTurnNumber !== null) {
            query += ` AND t1.turn_number <= ? AND t2.turn_number <= ?`;
            params.push(maxTurnNumber, maxTurnNumber);
        }

        query += ` LIMIT 10`;
        return await this.db.all(query, params);
    }

    /**
     * Weighted BFS (Narrative Energy) to find paths between entities.
     */
    async findWeightedPaths(startEntity, endEntities, energyBudget = DEFAULTS.NARRATIVE_ENERGY_BUDGET, maxTurnNumber = null) {
        if (!this.db) return [];
        const results = [];
        const targets = new Set(endEntities);

        // Queue: [currentEntity, pathSoFar, remainingEnergy]
        let queue = [[startEntity, [], energyBudget]];
        const visited = new Map([[startEntity, energyBudget]]);

        while (queue.length > 0) {
            const [current, path, energy] = queue.shift();

            if (energy <= 0) continue;

            let query = `SELECT * FROM ${this.tableName} WHERE (subject = ? OR object = ?) AND active = 1`;
            const params = [current, current];

            if (maxTurnNumber !== null) {
                query += ` AND turn_number <= ?`;
                params.push(maxTurnNumber);
            }

            const neighbors = await this.db.all(query, params);

            for (const n of neighbors) {
                const isOutgoing = n.subject === current;
                const neighbor = isOutgoing ? n.object : n.subject;

                const weight = PREDICATE_WEIGHTS[n.predicate] || PREDICATE_WEIGHTS.DEFAULT;
                const newEnergy = energy - weight;

                if (newEnergy < 0) continue;

                const newPath = [...path, n];

                if (targets.has(neighbor)) {
                    results.push(newPath);
                }

                if (!visited.has(neighbor) || visited.get(neighbor) < newEnergy) {
                    visited.set(neighbor, newEnergy);
                    queue.push([neighbor, newPath, newEnergy]);
                }
            }
        }
        return results;
    }

    async getStats() {
        if (!this.db) return { tripleCount: 0, entityCount: 0 };
        try {
            const counts = await this.db.get(`SELECT COUNT(*) as count FROM ${this.tableName} WHERE active = 1`);
            const entities = await this.db.get(`
                SELECT COUNT(DISTINCT name) as count FROM (
                    SELECT subject as name FROM ${this.tableName} WHERE active = 1
                    UNION
                    SELECT object as name FROM ${this.tableName} WHERE active = 1
                )
            `);
            return { tripleCount: counts.count, entityCount: entities.count };
        } catch {
            return { tripleCount: 0, entityCount: 0 };
        }
    }

    async getAllTriples(maxTurnNumber = null) {
        if (!this.db) return [];

        let query = `SELECT * FROM ${this.tableName}`;
        const params = [];

        if (maxTurnNumber !== null) {
            query += ` WHERE turn_number <= ?`;
            params.push(maxTurnNumber);
        }

        query += ` ORDER BY id DESC`;
        return await this.db.all(query, params);
    }

    async getCompactionStats() {
        if (!this.db) {
            return { totalActive: 0, duplicateCandidates: 0 };
        }

        try {
            const totalRow = await this.db.get(`SELECT COUNT(*) as count FROM ${this.tableName} WHERE active = 1`);
            const duplicateRow = await this.db.get(`
                SELECT COUNT(*) as count FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY subject, predicate, object
                               ORDER BY turn_created DESC, confidence DESC, id DESC
                           ) AS rn
                    FROM ${this.tableName}
                    WHERE active = 1
                ) ranked
                WHERE rn > 1
            `);

            return {
                totalActive: totalRow?.count || 0,
                duplicateCandidates: duplicateRow?.count || 0
            };
        } catch {
            // Fallback path for older SQLite engines without window function support.
            const rows = await this.db.all(
                `SELECT subject, predicate, object FROM ${this.tableName} WHERE active = 1`
            );
            const keyCounts = new Map();
            for (const row of rows) {
                const key = `${row.subject}|${row.predicate}|${row.object}`;
                keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
            }
            let duplicateCandidates = 0;
            for (const count of keyCounts.values()) {
                if (count > 1) duplicateCandidates += (count - 1);
            }

            return {
                totalActive: rows.length,
                duplicateCandidates
            };
        }
    }

    async compact(options = {}, tools = null) {
        if (!this.db) {
            return { totalBefore: 0, removedDuplicates: 0, totalAfter: 0 };
        }

        const dryRun = options.dryRun !== false;
        const before = await this.getCompactionStats();

        if (dryRun || before.duplicateCandidates <= 0) {
            return {
                totalBefore: before.totalActive,
                removedDuplicates: 0,
                totalAfter: before.totalActive,
                duplicateCandidates: before.duplicateCandidates
            };
        }

        let removedDuplicates = 0;
        const deleteSql = `
            DELETE FROM ${this.tableName}
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY subject, predicate, object
                               ORDER BY turn_created DESC, confidence DESC, id DESC
                           ) AS rn
                    FROM ${this.tableName}
                    WHERE active = 1
                ) ranked
                WHERE rn > 1
            )
        `;

        try {
            await this.withRetry(async () => {
                await this.db.run('BEGIN IMMEDIATE TRANSACTION');
                try {
                    const result = await this.db.run(deleteSql);
                    removedDuplicates = result?.changes || 0;
                    await this.db.run('COMMIT');
                } catch (error) {
                    await this.db.run('ROLLBACK');
                    throw error;
                }
            }, tools || { logger: { warn: () => { } } });
        } catch (error) {
            if (tools?.logger?.error) {
                tools.logger.error('KnowledgeGraph', `Compaction failed for ${this.tableName}.`, error);
            }
            throw error;
        }

        const after = await this.getCompactionStats();
        return {
            totalBefore: before.totalActive,
            removedDuplicates,
            totalAfter: after.totalActive,
            duplicateCandidates: before.duplicateCandidates
        };
    }

    /**
     * Cleans up string identifiers for natural language injection.
     */
    formatTriple(triple) {
        const clean = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const s = clean(triple.subject);
        const p = triple.predicate.toLowerCase().replace(/_/g, ' ');
        const o = clean(triple.object);
        const context = triple.context ? ` | Context: ${triple.context}` : '';
        return `${s} ${p} ${o}${context}`;
    }
    // #endregion

    // #region INTERNAL HELPERS (SOPHISTICATED)
    normalizeEntityName(name) {
        if (!name || typeof name !== 'string') return name;
        let s = name.trim().replace(/^[Tt]he\s+/, '').replace(/[^\w\s-']/g, '');
        return s.split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('_');
    }

    async canonicalizeEntity(entity, turnNumber = null) {
        const normalized = this.normalizeEntityName(entity);
        if (!normalized || !this.db || !this.isChatDb) return normalized;
        const exact = await this.db.get(`SELECT canonical FROM aliases WHERE alias = ? COLLATE NOCASE LIMIT 1`, [normalized]);
        if (exact) return exact.canonical;

        // Fuzzy canonicalization against known aliases to reduce near-dupe entities.
        const normalizedLower = normalized.toLowerCase();
        const prefix = normalizedLower.slice(0, 3);
        const threshold = this.runtimeConfig?.aliasAutoAcceptThreshold || DEFAULTS.ALIAS_AUTO_ACCEPT_THRESHOLD;

        const candidates = await this.db.all(
            `SELECT canonical, alias FROM aliases
             WHERE lower(alias) LIKE ? OR lower(canonical) LIKE ?
             LIMIT 200`,
            [`${prefix}%`, `${prefix}%`]
        );

        let bestCanonical = null;
        let bestScore = 0;
        for (const candidate of candidates) {
            const aliasScore = this.contextSimilarity(normalizedLower, String(candidate.alias || '').toLowerCase());
            const canonicalScore = this.contextSimilarity(normalizedLower, String(candidate.canonical || '').toLowerCase());
            const score = Math.max(aliasScore, canonicalScore);
            if (score > bestScore) {
                bestScore = score;
                bestCanonical = candidate.canonical;
            }
        }

        if (bestCanonical && bestScore >= threshold) {
            await this.db.run(
                `INSERT OR IGNORE INTO aliases (canonical, alias, last_seen_turn, confidence) VALUES (?, ?, ?, ?)`,
                [bestCanonical, normalized, turnNumber, bestScore]
            );
            return bestCanonical;
        }

        await this.db.run(
            `INSERT OR IGNORE INTO aliases (canonical, alias, last_seen_turn, confidence) VALUES (?, ?, ?, ?)`,
            [normalized, normalized, turnNumber, 0.5]
        );
        return normalized;
    }

    computeTripleConfidence(triple, existingTriples = []) {
        if (existingTriples.some(t => t.subject === triple.subject && t.predicate === triple.predicate && t.object === triple.object)) return 0.9;
        return 0.6;
    }

    async registerPredicate(predicate, turnNumber) {
        if (!this.isChatDb) return;
        try {
            await this.db.run(`INSERT OR IGNORE INTO predicates (predicate, seen_count, last_seen_turn) VALUES (?, 0, ?)`, [predicate, turnNumber]);
            await this.db.run(`UPDATE predicates SET seen_count = seen_count + 1, last_seen_turn = ? WHERE predicate = ?`, [turnNumber, predicate]);
        } catch { }
    }

    async isPredicateMutable(predicate) {
        if (!this.isChatDb) return false;
        const row = await this.db.get(`SELECT mutable FROM predicates WHERE predicate = ?`, [predicate]);
        return row ? !!row.mutable : false;
    }

    async detectAndFlagConflictsDynamic(_subject, _predicate, _object) {
        // Logic for detecting contradictions in active Chat DB
    }

    async getFileHash(filePath) {
        if (!this.db) return null;
        const row = await this.db.get(`SELECT hash FROM file_hashes WHERE file_path = ?`, [filePath]);
        return row ? row.hash : null;
    }

    async updateFileHash(filePath, hash, turnNumber) {
        if (!this.db) return;
        await this.db.run(
            `INSERT INTO file_hashes (file_path, hash, last_processed_turn) 
             VALUES (?, ?, ?) 
             ON CONFLICT(file_path) DO UPDATE SET hash = excluded.hash, last_processed_turn = excluded.last_processed_turn`,
            [filePath, hash, turnNumber]
        );
    }
    // #endregion
}

module.exports = KnowledgeGraph;

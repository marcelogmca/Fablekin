// plugins/knowledge_graph/logic.js

const path = require('path');
const KnowledgeGraph = require('./lib/knowledge_graph.js');
const { resolveTurnStorageKey } = require('../../modules/turn_storage_key.js');

const toBoundedNumber = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
};

const toBoundedInteger = (value, fallback, min, max) => {
    return Math.round(toBoundedNumber(value, fallback, min, max));
};

class KnowledgeGraphPluginLogic {
    constructor() {
        this.chatKG = null;
        this.projectKG = null;
        this.isInitialized = false;
        this.projectRootDirectory = null;
    }

    _getPluginSettings(tools) {
        const globalSettings = tools.settings.get?.() || {};
        const selfSettings = tools.settings.getSelf?.() || {};
        const scopedSettings = globalSettings.plugins?.knowledge_graph || {};
        return { ...scopedSettings, ...selfSettings };
    }

    _isInterludeTurn(turnContext) {
        return String(turnContext?.sceneMode || '').trim().toLowerCase() === 'interlude';
    }

    _shouldRunDuringInterludes(tools) {
        const settings = this._getPluginSettings(tools);
        return settings.run_during_interludes === true || settings.runDuringInterludes === true;
    }

    shouldRunForTurn(turnContext, tools) {
        if (!this._isInterludeTurn(turnContext)) return true;
        return this._shouldRunDuringInterludes(tools);
    }

    getTurnScope(turnContext) {
        const runtimeInterlude = turnContext?.runtime?.interlude || {};
        const interludeId = Number.isInteger(runtimeInterlude.id) ? runtimeInterlude.id : null;
        const interludeOrdinal = Number.isInteger(turnContext?.interludeOrdinal)
            ? turnContext.interludeOrdinal
            : (Number.isInteger(runtimeInterlude.ordinal) ? runtimeInterlude.ordinal : null);

        return {
            turnNumber: Number.isInteger(turnContext?.turnNumber) ? turnContext.turnNumber : 0,
            turnKey: resolveTurnStorageKey(turnContext),
            sceneMode: this._isInterludeTurn(turnContext) ? 'interlude' : 'mainline',
            interludeId,
            interludeOrdinal
        };
    }

    async cleanupForCurrentRun(turnContext, tools) {
        const turnNumber = Number.isInteger(turnContext?.turnNumber) ? turnContext.turnNumber : 0;
        if (!turnNumber) return;

        await this._ensureChatKG(turnContext, tools);
        const chatKG = this.chatKG;
        if (!chatKG || !chatKG.db) return;

        const scope = this.getTurnScope(turnContext);
        const columns = await chatKG.db.all(`PRAGMA table_info(${chatKG.tableName})`);
        const columnNames = new Set((columns || []).map(c => c.name));

        if (scope.sceneMode === 'interlude') {
            // Future-ready path: interlude cleanup must be exact-scope, never turn-number broad delete.
            if (columnNames.has('turn_key')) {
                await chatKG.db.run(
                    `DELETE FROM ${chatKG.tableName} WHERE turn_key = ?`,
                    [scope.turnKey]
                );
            } else {
                tools.logger.warn('Cleanup', `[KnowledgeGraph] Skipped interlude cleanup for ${scope.turnKey}: table has no turn_key column.`);
            }
        } else if (columnNames.has('turn_created')) {
            // Existing behavior for mainline regeneration/rewind: clear current and future.
            await chatKG.db.run(
                `DELETE FROM ${chatKG.tableName} WHERE turn_created >= ?`,
                [turnNumber]
            );
        } else if (columnNames.has('turn_number')) {
            await chatKG.db.run(
                `DELETE FROM ${chatKG.tableName} WHERE turn_number >= ?`,
                [turnNumber]
            );
        }

        // Keep FTS table in sync after cleanup (best-effort for legacy DB variants).
        try {
            await chatKG.db.run(`DELETE FROM ${chatKG.tableName}_fts WHERE rowid NOT IN (SELECT id FROM ${chatKG.tableName})`);
        } catch {
            // FTS may not exist in legacy/partial tables.
        }
    }

    async initProject(rootDirectory, tools) {
        this.projectRootDirectory = rootDirectory;
        const projectName = path.basename(rootDirectory);
        const projectDbPath = path.join(rootDirectory, `${projectName}.db`);

        // Initialize Project KG (Lore)
        tools.logger.log(`Initializing Project KG at: ${projectDbPath}`);
        try {
            this.projectKG = new KnowledgeGraph(projectDbPath, 'static_knowledge_graph');
            await this.projectKG.initialize(tools, { readOnly: false, isChatDb: false });
        } catch (error) {
            tools.logger.error(`Failed to set Project KG:`, error);
        }
    }

    async _ensureChatKG(turnContext, tools) {
        const chatDbPath = turnContext?.chatDbFullPath;
        if (!chatDbPath) return false;

        if (this.chatKG && this.chatKG.dbPath === chatDbPath) {
            return true;
        }

        if (this.chatKG) {
            await this.chatKG.close();
        }

        tools.logger.log(`Lazy-initializing main chat KG for: ${chatDbPath}`);
        try {
            this.chatKG = new KnowledgeGraph(chatDbPath, 'knowledge_graph');
            await this.chatKG.initialize(tools, { readOnly: false, isChatDb: true });
            return true;
        } catch (error) {
            tools.logger.error(`Failed to lazy-initialize main chat KG at ${chatDbPath}:`, error);
            this.chatKG = null;
            return false;
        }
    }

    async setChatKG(chatDbPath, tools) {
        // This is now effectively legacy/internal, but we'll keep it for explicit calls if needed
        if (this.chatKG && this.chatKG.dbPath === chatDbPath) {
            return;
        }

        if (this.chatKG) {
            await this.chatKG.close();
        }

        tools.logger.log(`Setting main chat KG to: ${chatDbPath}`);
        try {
            this.chatKG = new KnowledgeGraph(chatDbPath, 'knowledge_graph');
            await this.chatKG.initialize(tools, { readOnly: false, isChatDb: true });
        } catch (error) {
            tools.logger.error(`Failed to set main chat KG at ${chatDbPath}:`, error);
            this.chatKG = null;
        }
    }

    /**
     * The Librarian: Generates precise search intents from the high-context turn.
     */
    async extractEntities(turnContext, tools) {
        if (!this.shouldRunForTurn(turnContext, tools)) return;

        // Ensure Chat KG is ready before doing anything
        await this._ensureChatKG(turnContext, tools);

        if (!this.chatKG) {
            tools.logger.warn('Librarian', 'Chat KG not available for Librarian.');
            return;
        }

        // Librarian Input: Previous Turn + User Prompt
        const previousChapter = await turnContext.getPreviousChapter();
        const lastTurnText = previousChapter?.processed?.dialogueProcessor?.dialogue || previousChapter?.output?.fulltext || "";
        const userPrompt = turnContext.input.userPrompt || "";
        const contextBlob = `[LAST TURN]\n${lastTurnText}\n\n[USER ACTION]\n${userPrompt}`;

        tools.logger.log('Librarian', 'Librarian: Generating search intents from context...', 'start');

        try {
            const settings = this._getPluginSettings(tools);
            const modelDef = settings.librarian_model_def || { model: 'mediumendmodel' };

            const messages = [
                { role: 'system', content: 'You are a Narrative Librarian. Your task is to identify 3-5 specific search queries to retrieve relevant world lore and past facts for the current scene. Focus on characters, locations, and mysterious items mentioned. Output as a comma-separated list.' },
                { role: 'user', content: contextBlob }
            ];
            const llmResult = await tools.llm.runTask({
                msg: "KnowledgeGraph Librarian",
                messages,
                model: modelDef.model,
                provider: modelDef.provider
            });
            const intents = llmResult.content;

            const searchIntents = intents.split(',').map(s => s.trim()).filter(Boolean);

            // Perform basic entity extraction for pathfinding anchors using the COMBINED context
            const baseResult = await this.chatKG.extractEntities(contextBlob, turnContext.turnNumber, tools);

            turnContext.processed.extractedEntities = {
                ...baseResult,
                search: [...new Set([...baseResult.search, ...searchIntents])]
            };

            tools.logger.log('Librarian', `Librarian generated ${searchIntents.length} intents.`, 'end');
        } catch (error) {
            tools.logger.error('Librarian', 'Librarian failed, falling back to basic extraction:', null, error);
            const entitiesResult = await this.chatKG.extractEntities(userPrompt, turnContext.turnNumber, tools);
            turnContext.processed.extractedEntities = entitiesResult;
        }
    }

    async processStaticFile(file, content, turnContext, tools) {
        if (!this.projectKG) return;

        const crypto = require('crypto');
        const fileHash = crypto.createHash('sha256').update(content).digest('hex');
        const existingHash = await this.projectKG.getFileHash(file.path);

        if (existingHash === fileHash) {
            // File has not changed, skip LLM processing
            return;
        }

        tools.logger.log('StaticProcessing', `Processing new/modified static file: ${file.path}`, 'start');

        try {
            const turnNumber = turnContext?.turnNumber || 1;
            const newTriples = await this.projectKG.generateTriplesFromText(content, [], tools);
            if (newTriples.length > 0) {
                const triplesWithMeta = newTriples.map(t => ({
                    ...t,
                    source_type: 'static_lore',
                    source_file: file.path
                }));
                await this.projectKG.storeTriples(triplesWithMeta, turnNumber, tools);
            }
            // Update hash in DB after successful processing
            await this.projectKG.updateFileHash(file.path, fileHash, turnNumber);
            tools.logger.log('StaticProcessing', `Finished processing static file: ${file.path}`, 'end');
        } catch (error) {
            tools.logger.error('StaticProcessing', `Failed to process static file ${file.path}:`, null, error);
        }
    }

    async syncAndInject(turnContext, tools) {
        if (!this.shouldRunForTurn(turnContext, tools)) return;

        // Ensure Chat KG is ready
        await this._ensureChatKG(turnContext, tools);

        const settings = this._getPluginSettings(tools);
        const currentTurn = turnContext.turnNumber || 0;
        const vectorCandidateLimit = toBoundedInteger(settings.vector_candidate_limit ?? settings.vectorCandidateLimit, 4000, 100, 100000);
        const vectorMinScore = toBoundedNumber(settings.vector_min_score ?? settings.vectorMinScore, 0.4, 0, 1);
        const maxInjectedTriples = toBoundedInteger(settings.max_injected_triples ?? settings.maxInjectedTriples, 40, 5, 200);

        tools.logger.log('SyncInject', 'Starting KG sync and inject process...', 'start');

        // 1. Narrative Probe (Thematic Search)
        tools.logger.log('ThematicProbe', 'Step 1: Thematic Probe', 'start');
        const previousChapter = await turnContext.getPreviousChapter();
        const lastSummary = previousChapter?.output?.summary || "";
        const probeString = `${turnContext.input.userPrompt} ${lastSummary}`.trim();
        const probeEmbedding = await tools.vector.embed(probeString);

        const thematicTriples = [];
        if (this.chatKG) thematicTriples.push(...(await this.chatKG.findThematicallyRelatedTriples(probeEmbedding, 15, currentTurn, 0, { candidateLimit: vectorCandidateLimit, scoreThreshold: vectorMinScore })).map(t => ({ ...t, source: 'History' })));
        if (this.projectKG) thematicTriples.push(...(await this.projectKG.findThematicallyRelatedTriples(probeEmbedding, 15, currentTurn, 0, { candidateLimit: vectorCandidateLimit, scoreThreshold: vectorMinScore })).map(t => ({ ...t, source: 'Lore' })));
        tools.logger.log('ThematicProbe', `Found ${thematicTriples.length} thematic triples.`, 'end');

        // 2. Social Pathfinding (Narrative Energy BFS)
        tools.logger.log('SocialPathfinding', 'Step 2: Social Pathfinding & Bridge Hunting', 'start');
        const activeEntities = new Set([
            turnContext.input.playerCharacterName,
            ...(turnContext.processed.extractedEntities?.entities || []),
            ...(turnContext.input.party || [])
        ].filter(Boolean));

        const pathTriples = [];
        const entityList = Array.from(activeEntities);
        const energyBudget = toBoundedInteger(settings.energy_budget ?? settings.energyBudget, 100, 10, 5000);

        if (this.chatKG && entityList.length > 1) {
            // BFS Pathfinding
            for (let i = 0; i < entityList.length; i++) {
                const start = entityList[i];
                const others = entityList.slice(i + 1);
                if (others.length === 0) continue;
                const paths = await this.chatKG.findWeightedPaths(start, others, energyBudget);
                paths.forEach(p => pathTriples.push(...p.map(t => ({ ...t, source: 'Social' }))));
            }
            // Bridge Hunting (Triangles)
            if (entityList.length >= 2) {
                const bridges = await this.chatKG.findBridges(entityList[0], entityList[1]);
                pathTriples.push(...bridges.map(t => ({ ...t, source: 'Bridge' })));
            }
        }
        tools.logger.log('SocialPathfinding', `Found ${pathTriples.length} path triples.`, 'end');

        // 3. Recency Decay Scorer & Temporal Anchoring
        tools.logger.log('Scoring', 'Step 3: Scoring & Re-ranking', 'start');
        const allCandidates = new Map();

        // Identify IDs of triples that should be "Anchored" (linked to recent full text turns)
        const anchoredThreshold = toBoundedInteger(settings.anchored_threshold ?? settings.anchoredThreshold, 3, 1, 200);
        const recencyThreshold = toBoundedInteger(settings.recency_threshold ?? settings.recencyThreshold, 10, 1, 2000);

        const addCandidate = (t, type) => {
            const id = `${t.subject}|${t.predicate}|${t.object}`;
            if (!allCandidates.has(id)) {
                const vectorSimilarity = t.score || 0;

                let recencyBoost = 0;
                let temporalAnchorBoost = 0;
                if (t.turn_created !== undefined && t.turn_created !== -1) {
                    const age = Math.max(0, currentTurn - t.turn_created);
                    if (age <= anchoredThreshold) temporalAnchorBoost = 1.0;
                    if (age <= recencyThreshold) recencyBoost = 1.0;
                    else if (age <= (recencyThreshold * 10)) recencyBoost = Math.max(0, 1.0 - (age - recencyThreshold) / (recencyThreshold * 9));
                }

                const centrality = (type === 'Social' || type === 'Bridge') ? 1.0 : 0.0;

                // Final Formula: Weighted sum
                const finalScore = (vectorSimilarity * 0.4) + (temporalAnchorBoost * 0.3) + (recencyBoost * 0.2) + (centrality * 0.1);
                allCandidates.set(id, { ...t, finalScore });
            }
        };

        thematicTriples.forEach(t => addCandidate(t, 'Thematic'));
        pathTriples.forEach(t => addCandidate(t, t.source));

        const sortedResults = Array.from(allCandidates.values())
            .sort((a, b) => b.finalScore - a.finalScore)
            .slice(0, maxInjectedTriples);

        // Save a snapshot into the turnContext for later temporal linking
        turnContext.processed.kgSnapshot = sortedResults.map(t => ({ subject: t.subject, predicate: t.predicate, object: t.object }));
        tools.logger.log('Scoring', `Ranked ${sortedResults.length} triples.`, 'end');

        // 4. Natural Language Context Injection
        if (sortedResults.length > 0) {
            const social = sortedResults.filter(t => t.source === 'Social' || t.source === 'Bridge');
            const anchored = sortedResults.filter(t => t.finalScore >= 0.7 && t.source !== 'Social' && t.source !== 'Bridge');
            const thematic = sortedResults.filter(t => t.finalScore < 0.7 && t.source !== 'Social' && t.source !== 'Bridge');

            let injectionContent = '';

            if (social.length > 0) {
                const socialContent = social.map(t => `- ${this.chatKG.formatTriple(t)}`).join('\n');
                injectionContent += tools.prompt.wrap('direct_relationships_and_connections', socialContent) + '\n';
            }

            if (anchored.length > 0) {
                const anchoredContent = anchored.map(t => `- ${this.chatKG.formatTriple(t)}`).join('\n');
                injectionContent += tools.prompt.wrap('living_memory_anchors', anchoredContent) + '\n';
            }

            if (thematic.length > 0) {
                const thematicContent = thematic.map(t => `- ${this.chatKG.formatTriple(t)}`).join('\n');
                injectionContent += tools.prompt.wrap('thematic_context', thematicContent) + '\n';
            }

            const leadIn = "The following relevant world knowledge and past facts were retrieved from the Knowledge Graph to help you maintain narrative consistency:\n\n";
            const wrappedInjection = tools.prompt.wrap('knowledge_graph_context', leadIn + injectionContent.trim());

            tools.prompt.inject('dynamic_knowledge', wrappedInjection, 'root');
            tools.logger.log('SyncInject', `Injected ${sortedResults.length} scored triples into context.`);
        }
        tools.logger.log('SyncInject', 'KG sync and inject process finished.', 'end');
    }

    async processTurn(turnContext, tools) {
        if (!this.shouldRunForTurn(turnContext, tools)) return;

        // Ensure Chat KG is ready
        await this._ensureChatKG(turnContext, tools);

        if (!this.chatKG) return;
        tools.logger.log('BackgroundUpdate', 'Updating Knowledge Graph from turn output...', 'start');
        try {
            await this.chatKG.processTurn(turnContext, tools);
            tools.logger.log('BackgroundUpdate', 'Knowledge Graph update complete.', 'end');
        } catch (error) {
            tools.logger.error('BackgroundUpdate', 'KG processTurn failed:', null, error);
        }
    }

    // #region EXPORTED API IMPLEMENTATIONS

    /**
     * Internal helper to get all active KG instances.
     */
    _getActiveKGs(sourceType = 'all') {
        const kgs = [];
        if ((sourceType === 'all' || sourceType === 'history') && this.chatKG) kgs.push(this.chatKG);
        if ((sourceType === 'all' || sourceType === 'lore') && this.projectKG) kgs.push(this.projectKG);
        return kgs;
    }

    /**
     * Cross-KG search implementation.
     */
    async search(query, options = {}, tools) {
        const turnNumber = tools.turnContext?.turnNumber;
        const settings = this._getPluginSettings(tools);
        const vectorCandidateLimit = toBoundedInteger(settings.vector_candidate_limit ?? settings.vectorCandidateLimit, 4000, 100, 100000);
        const vectorMinScore = toBoundedNumber(settings.vector_min_score ?? settings.vectorMinScore, 0.4, 0, 1);
        // Ensure context is ready if we are in a turn
        if (tools.turnContext) await this._ensureChatKG(tools.turnContext, tools);

        const limit = options.limit || 20;
        const offset = options.offset || 0;
        const type = options.type || 'hybrid';
        const kgs = this._getActiveKGs(options.source || 'all');

        let results = [];
        const seen = new Set();

        // Increase internal limit to allow for better merging/deduplication before slicing
        const internalLimit = limit + offset + 50;

        if (type === 'fts' || type === 'hybrid') {
            for (const kg of kgs) {
                const ftsResults = await kg.findDirectlyRelatedTriples([query], internalLimit, turnNumber, 0);
                results.push(...ftsResults.map(t => ({ ...t, kg_source: kg.tableName, matchType: 'fts' })));
            }
        }

        if ((type === 'vector' || type === 'hybrid') && query) {
            const embedding = await tools.vector.embed(query);
            for (const kg of kgs) {
                const vecResults = await kg.findThematicallyRelatedTriples(embedding, internalLimit, turnNumber, 0, {
                    candidateLimit: vectorCandidateLimit,
                    scoreThreshold: vectorMinScore
                });
                results.push(...vecResults.map(t => ({ ...t, kg_source: kg.tableName, matchType: 'vector' })));
            }
        }

        // Calculate "Total" found before slicing
        // Note: This matches the "980 additional" behavior by seeing how many were matched in our wide search
        const total = results
            .filter(t => {
                const key = `${t.subject}|${t.predicate}|${t.object}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).length;

        seen.clear();
        const paginated = results
            .filter(t => {
                const key = `${t.subject}|${t.predicate}|${t.object}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => {
                // FTS matches always win over purely vector matches
                if (a.matchType === 'fts' && b.matchType !== 'fts') return -1;
                if (b.matchType === 'fts' && a.matchType !== 'fts') return 1;
                // Otherwise sort by score if available (vector) or keep original order
                return (b.score || 0) - (a.score || 0);
            })
            .slice(offset, offset + limit);

        return { results: paginated, total };
    }

    /**
     * Filtered triple retrieval.
     */
    async getTriples(filter = {}, tools) {
        const turnNumber = tools.turnContext?.turnNumber;
        if (tools.turnContext) await this._ensureChatKG(tools.turnContext, tools);

        const kgs = this._getActiveKGs(filter.source || 'all');
        const results = [];

        for (const kg of kgs) {
            if (!kg.db) continue;

            // Check if turn_created exists to avoid SQL errors
            const columns = await kg.db.all(`PRAGMA table_info(${kg.tableName})`);
            const hasTurnCreated = columns.some(c => c.name === 'turn_created');
            const orderByField = hasTurnCreated ? 'turn_created' : 'id';

            let sql = `SELECT * FROM ${kg.tableName} WHERE active = 1`;
            const params = [];

            if (filter.subject) { sql += ` AND subject = ?`; params.push(filter.subject); }
            if (filter.predicate) { sql += ` AND predicate = ?`; params.push(filter.predicate); }
            if (filter.object) { sql += ` AND object = ?`; params.push(filter.object); }

            // Phase 2: Temporal Boundary
            if (hasTurnCreated && turnNumber !== undefined) {
                sql += ` AND turn_created <= ?`;
                params.push(turnNumber);
            }

            sql += ` ORDER BY ${orderByField} DESC LIMIT ?`;

            // Ensure limit is an integer to avoid SQLITE_MISMATCH
            let limit = parseInt(filter.limit);
            if (isNaN(limit) || limit <= 0) limit = 100;
            params.push(limit);

            const offset = parseInt(filter.offset) || 0;
            if (offset > 0) {
                sql += ` OFFSET ?`;
                params.push(offset);
            }

            const rows = await kg.db.all(sql, params);
            results.push(...rows.map(r => ({ ...r, kg_source: kg.tableName })));
        }

        // Add a total count for triples matching this filter
        let overallTotal = 0;
        for (const kg of kgs) {
            if (!kg.db) continue;
            let countSql = `SELECT count(*) as count FROM ${kg.tableName} WHERE active = 1`;
            const countParams = [];
            if (filter.subject) { countSql += ` AND subject = ?`; countParams.push(filter.subject); }
            if (filter.predicate) { countSql += ` AND predicate = ?`; countParams.push(filter.predicate); }
            if (filter.object) { countSql += ` AND object = ?`; countParams.push(filter.object); }
            if (turnNumber !== undefined) { countSql += ` AND turn_created <= ?`; countParams.push(turnNumber); }
            const countRow = await kg.db.get(countSql, countParams);
            overallTotal += countRow?.count || 0;
        }

        return { triples: results, total: overallTotal };
    }

    /**
     * Pathfinding implementation.
     */
    async findPaths(startEntity, endEntity, energy, tools) {
        if (tools.turnContext) await this._ensureChatKG(tools.turnContext, tools);
        if (!this.chatKG) return [];

        return await this.chatKG.findWeightedPaths(startEntity, [endEntity], energy || 100);
    }

    /**
     * Entity list retrieval.
     */
    async getEntities(limit = 100, tools, offset = 0) {
        if (tools.turnContext) await this._ensureChatKG(tools.turnContext, tools);
        const kgs = this._getActiveKGs();
        const entities = new Set();

        let parsedLimit = parseInt(limit);
        if (isNaN(parsedLimit) || parsedLimit <= 0) parsedLimit = 100;

        for (const kg of kgs) {
            if (!kg.db) continue;
            const rows = await kg.db.all(`
                SELECT subject as name FROM ${kg.tableName} WHERE active = 1
                UNION
                SELECT object as name FROM ${kg.tableName} WHERE active = 1
                LIMIT ? OFFSET ?
            `, [parsedLimit + offset, offset]);
            rows.forEach(r => entities.add(r.name));
            if (entities.size >= limit + offset) break;
        }

        // Global total unique entities count across KGs
        let globalTotal = 0;
        for (const kg of kgs) {
            if (!kg.db) continue;
            const countRow = await kg.db.get(`SELECT count(DISTINCT name) as count FROM (SELECT subject as name FROM ${kg.tableName} WHERE active = 1 UNION SELECT object as name FROM ${kg.tableName} WHERE active = 1)`);
            globalTotal += countRow?.count || 0;
        }

        return { entities: Array.from(entities).slice(offset, offset + limit), total: globalTotal };
    }

    async previewCompaction(tools, options = {}) {
        if (tools.turnContext) await this._ensureChatKG(tools.turnContext, tools);
        const kgs = this._getActiveKGs(options.source || 'all');

        const perSource = [];
        for (const kg of kgs) {
            if (!kg?.db) continue;
            const stats = await kg.getCompactionStats();
            perSource.push({
                kg_source: kg.tableName,
                db_path: kg.dbPath,
                totalBefore: stats.totalActive,
                duplicateCandidates: stats.duplicateCandidates
            });
        }

        const totals = perSource.reduce((acc, item) => {
            acc.totalBefore += item.totalBefore;
            acc.duplicateCandidates += item.duplicateCandidates;
            return acc;
        }, { totalBefore: 0, duplicateCandidates: 0 });

        return {
            ...totals,
            perSource
        };
    }

    async compact(tools, options = {}) {
        if (tools.turnContext) await this._ensureChatKG(tools.turnContext, tools);
        const kgs = this._getActiveKGs(options.source || 'all');

        const perSource = [];
        for (const kg of kgs) {
            if (!kg?.db) continue;
            const result = await kg.compact({ dryRun: false }, tools);
            perSource.push({
                kg_source: kg.tableName,
                db_path: kg.dbPath,
                totalBefore: result.totalBefore,
                removedDuplicates: result.removedDuplicates,
                totalAfter: result.totalAfter
            });
        }

        const totals = perSource.reduce((acc, item) => {
            acc.totalBefore += item.totalBefore;
            acc.removedDuplicates += item.removedDuplicates;
            acc.totalAfter += item.totalAfter;
            return acc;
        }, { totalBefore: 0, removedDuplicates: 0, totalAfter: 0 });

        return {
            ...totals,
            perSource
        };
    }

    // #endregion
}

module.exports = new KnowledgeGraphPluginLogic();

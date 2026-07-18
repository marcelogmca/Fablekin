// plugins/knowledge_graph/index.js

const logic = require('./logic.js');

module.exports = {
    id: 'knowledge_graph',
    name: 'Knowledge Graph',
    author: 'Fablekin Core',
    version: '1.3.0',
    category: 'World',
    experimental: true,
    wizard: {
        include: true,
        order: 540,
        group: 'World',
        label: 'Knowledge Graph',
        recommended_enabled: true,
        author_note: 'Useful for campaigns where places, factions, and facts should stay connected over time.',
        enabled_note: 'Builds graph-style knowledge links that can improve world continuity and retrieval.',
        disabled_note: 'World information remains flatter and less connected across modules.',
        settings_note: 'Tune graph extraction, relation limits, and model use in plugin settings.'
    },
    description: 'A hybrid GraphRAG system that maintains a persistent factual web of the story world using vector search and social pathfinding.',

    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Maintains a persistent, evolving web of factual connections between people, places, and events in the world.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'A hybrid GraphRAG system that uses vector embeddings for semantic search and social pathfinding (narrative energy) to discover non-obvious links. It differentiates between "Anchored" (recent) and "Global" (long-term) truth, prioritizing fresh information to maintain situational awareness.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'High',
            immersion: 'None',
            cost: 'High',
            latency: 'Low'
        },

        librarian_model_def: {
            type: 'select',
            label: 'Librarian Model',
            description: 'The LLM model used to analyze the current scene and generate search queries for relevant world lore.',
            options: 'llm-aliases',
            default: { model: 'mediumendmodel' }
        },
        energy_budget: {
            type: 'number',
            label: 'Narrative Energy Budget',
            description: 'Controls how deep the system searches for connections between characters. Higher values find deeper but potentially less relevant links.',
            default: 100,
            min: 10,
            max: 500
        },
        anchored_threshold: {
            type: 'number',
            label: 'Anchored Memory Threshold (Turns)',
            description: 'Facts created within this many turns are considered "Anchored" and are prioritized in the prompt.',
            default: 3,
            min: 1,
            max: 20
        },
        recency_threshold: {
            type: 'number',
            label: 'Recent Memory Threshold (Turns)',
            description: 'Facts created within this many turns receive a recency boost during retrieval.',
            default: 10,
            min: 1,
            max: 50
        },
        max_triples_per_turn: {
            type: 'number',
            label: 'Max Triples Per Turn',
            description: 'Hard cap for how many new dynamic-turn triples can be stored per turn after filtering.',
            default: 60,
            min: 5,
            max: 300
        },
        max_injected_triples: {
            type: 'number',
            label: 'Max Injected Triples',
            description: 'Upper bound of triples injected into prompt context each turn after ranking.',
            default: 40,
            min: 5,
            max: 200
        },
        vector_candidate_limit: {
            type: 'number',
            label: 'Vector Candidate Limit',
            description: 'How many triples are scored for vector similarity before top-k selection.',
            default: 4000,
            min: 100,
            max: 100000
        },
        vector_min_score: {
            type: 'number',
            label: 'Vector Min Score',
            description: 'Minimum cosine similarity score required for vector candidates.',
            default: 0.4,
            min: 0,
            max: 1
        },
        text_dedupe_threshold: {
            type: 'number',
            label: 'Text Dedup Threshold',
            description: 'Context similarity threshold for treating same SPO facts as duplicates.',
            default: 0.92,
            min: 0.5,
            max: 0.99
        },
        alias_auto_accept_threshold: {
            type: 'number',
            label: 'Alias Auto-Merge Threshold',
            description: 'String similarity threshold for auto-merging new entity aliases to existing canon names.',
            default: 0.85,
            min: 0.7,
            max: 0.99
        },
        min_story_chars_for_extraction: {
            type: 'number',
            label: 'Min Story Chars',
            description: 'Skip dynamic KG extraction for very short turns below this character count.',
            default: 80,
            min: 0,
            max: 5000
        },
        max_context_chars: {
            type: 'number',
            label: 'Max Context Chars',
            description: 'Maximum context length stored per triple after normalization.',
            default: 220,
            min: 40,
            max: 1200
        },
        run_during_interludes: {
            type: 'boolean',
            label: 'Run During Interludes',
            description: 'If enabled, the Knowledge Graph runs on interlude chapters; if disabled, interludes are skipped.',
            default: false
        }
    },

    timelineProviders: [
        {
            type: 'branch',
            side: 'left',
            fn: async (turnContext, tools) => {
                const turnNumber = turnContext.turnNumber;
                if (!turnNumber) return null;

                // Ensure chatKG is accessible
                await logic._ensureChatKG(turnContext, tools);
                if (!logic.chatKG || !logic.chatKG.db) return null;

                try {
                    // Fetch up to 5 triples created exactly AT or RECENTLY BEFORE this turn
                    // We look back a few turns just in case there's no lore this exact turn, 
                    // but we prioritize exactly this turn's discoveries.
                    const rows = await logic.chatKG.db.all(
                        `SELECT subject, predicate, object, turn_created 
                         FROM ${logic.chatKG.tableName} 
                         WHERE active = 1 AND turn_created <= ? AND turn_created >= ?
                         ORDER BY turn_created DESC, id DESC`,
                        [turnNumber, Math.max(1, turnNumber - 5)]
                    );

                    if (!rows || rows.length === 0) return null;

                    const children = rows.map(t => {
                        return {
                            title: t.subject,
                            text: `<span style="opacity: 0.7; font-size: 0.9em; margin-right: 4px; font-style: italic;">${t.predicate.replace(/_/g, ' ')}</span> <span style="color: #4dd0e1; font-weight: bold;">${t.object}</span>`
                        };
                    });

                    return {
                        id: 'lore',
                        icon: '🕸️',
                        title: 'World Lore',
                        label: 'LORE <span style="font-size: 0.75em; opacity: 0.8; font-weight: 500;"> (Knowledge Graphs)</span>',
                        content: `${rows.length} new fact${rows.length > 1 ? 's' : ''} discovered.`,
                        children: children
                    };

                } catch (e) {
                    tools.logger.error('Timeline', 'Failed to fetch KB data for timeline: ' + e.message);
                    return null;
                }
            }
        }
    ],

    hooks: {
        /**
         * Phase 1: Universal Cleanup
         * Clears any triples created during the current or future turns to ensure a clean slate for retries.
         */
        'HOOK_PRE_VN_GENERATION': {
            priority: 5, // Run early
            allowInterlude: true,
            run: async (turnContext, tools) => {
                const turnNumber = turnContext.turnNumber;
                if (!turnNumber) return;
                if (!logic.shouldRunForTurn(turnContext, tools)) return;

                tools.logger.runtime(`[Cleanup] Purging chat KG triples for current scope (turn=${turnNumber}).`);
                await logic.cleanupForCurrentRun(turnContext, tools);
            }
        },
        /**
         * Triggered when a project is loaded in main.js.
         */
        'HOOK_PROJECT_LOADED': {
            priority: 10,
            mode: 'sequential',
            run: async (context, tools) => {
                tools.logger.log('Lifecycle', 'Initializing KG project...', 'start');
                await logic.initProject(context.rootDirectory, tools);
                tools.logger.log('Lifecycle', 'KG project initialized.', 'end');
            }
        },

        /**
         * Triggered when a chat database is initialized.
         */
        'HOOK_CHAT_DB_INITIALIZED': {
            priority: 10,
            mode: 'sequential',
            run: async (context, tools) => {
                const { chatDbPath } = context;
                if (chatDbPath) {
                    tools.logger.log('Lifecycle', `Initializing Chat KG: ${chatDbPath}`, 'start');
                    await logic.setChatKG(chatDbPath, tools);
                    tools.logger.log('Lifecycle', `Chat KG initialized.`, 'end');
                }
            }
        },

        /**
         * Sequential hook to extract entities for RAG and KG search.
         */
        'HOOK_EXTRACT_ENTITIES': {
            priority: 10,
            mode: 'sequential',
            allowInterlude: true,
            eta: { default: { min: 10000, max: 30000 } },
            run: async (turnContext, tools) => {
                if (!logic.shouldRunForTurn(turnContext, tools)) return;
                tools.logger.log('Extraction', 'Extracting entities for RAG/KG...', 'start');
                await logic.extractEntities(turnContext, tools);
                tools.logger.log('Extraction', 'Entities extracted.', 'end');
            }
        },

        /**
         * Sequential hook called after a static file is processed.
         */
        'HOOK_POST_FILE_PROCESSING': {
            priority: 10,
            mode: 'sequential',
            eta: { default: { min: 10000, max: 45000 } },
            run: async (turnContext, tools) => {
                const { file, content, mode } = turnContext.temp || {};

                // Only process files in 'full' or 'summary' mode
                if (mode !== 'full' && mode !== 'summary') return;

                // Restrict processing to files in the '2_Building' folder
                const path = require('path');
                const rootDir = turnContext.runtime.rootDirectory;
                const relativePath = path.relative(rootDir, file.path);
                const folder = relativePath.split(path.sep)[0];

                if (folder !== '2_Building') {
                    // tools.logger.log('StaticProcessing', `Skipping static file (not in 2_Building): ${file.path}`);
                    return;
                }

                tools.logger.log('StaticProcessing', `Processing static file: ${file.path} (Mode: ${mode})`, 'start');
                await logic.processStaticFile(file, content, turnContext, tools);
                tools.logger.log('StaticProcessing', `Finished static file: ${file.path}`, 'end');
            }
        },

        /**
         * Sequential hook called after prompt components are gathered.
         * Used for KG sync, injection, and synthesis.
         */
        'HOOK_POST_PROMPT_BUILDER': {
            priority: 20, // After entity extraction and RAG
            mode: 'parallel',
            allowInterlude: true,
            eta: { default: { min: 5000, max: 15000 } },
            run: async (turnContext, tools) => {
                if (!logic.shouldRunForTurn(turnContext, tools)) return;
                tools.logger.log('Synthesis', 'Syncing and injecting KG data...', 'start');
                await logic.syncAndInject(turnContext, tools);
                tools.logger.log('Synthesis', 'KG data injected.', 'end');
            }
        },

        /**
         * Background task to update the Knowledge Graph from the turn output.
         */
        'HOOK_VN_BACKGROUND_TASKS': {
            priority: 50,
            mode: 'parallel',
            allowInterlude: true,
            eta: { default: { min: 60000, max: 300000 }, turn1: { min: 120000, max: 600000 } },
            run: async (turnContext, tools) => {
                if (!logic.shouldRunForTurn(turnContext, tools)) return;
                await tools.jobs.withJob('Updating world knowledge graph...', {
                    id: 'knowledge_graph_update',
                    scope: 'turn',
                    rethrow: false,
                    notifyOnComplete: false
                }, async (job) => {
                    job.progress(10, 'Preparing KG update...');
                    try {
                        tools.logger.log('BatchExtraction', 'Processing turn for KG update (background)', 'start');
                        await logic.processTurn(turnContext, tools);
                        tools.logger.log('BatchExtraction', 'KG update complete (background)', 'end');
                        job.progress(100, 'Knowledge graph update complete.');
                    } catch (error) {
                        tools.logger.error('BatchExtraction', `Error updating KG: ${error.message}`);
                        throw error;
                    }
                });
            }
        }
    },

    terminalCommands: {
        '/kg': {
            description: 'Knowledge Graph toolkit. Usage: /kg [subcommand] [query]',
            run: async (args, tools) => {
                const colors = { reset: "\x1b[0m", bright: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", grey: "\x1b[90m", bold: "\x1b[1m" };
                const subcommand = args[0]?.toLowerCase();

                if (!subcommand || subcommand === 'help') {
                    return `\r\n${colors.bright}Knowledge Graph Toolkit${colors.reset}\r\n` +
                           `Usage: /kg ${colors.cyan}[subcommand]${colors.reset} ${colors.yellow}[query]${colors.reset} ${colors.grey}[options]${colors.reset}\r\n\r\n` +
                           `${colors.bright}Subcommands:${colors.reset}\r\n` +
                           `  ${colors.cyan}stats${colors.reset}      - Show graph database statistics and triple counts.\r\n` +
                           `  ${colors.cyan}list${colors.reset}       - List all graph entries (use -n and -p for paging).\r\n` +
                           `  ${colors.cyan}find${colors.reset}       - Search specifically for a subject or object.\r\n` +
                           `  ${colors.cyan}search${colors.reset}     - Full-text search across all graph fields.\r\n` +
                           `  ${colors.cyan}compact${colors.reset}    - Deduplicate graph entries (requires explicit confirm).\r\n` +
                           `  ${colors.cyan}showgui${colors.reset}    - Launch the visual Knowledge Graph window.\r\n\r\n` +
                           `${colors.bright}Options:${colors.reset}\r\n` +
                           `  -n [num]   - Set result limit (default: 20).\r\n` +
                           `  -p [num]   - Set page number.\r\n\r\n` +
                           `${colors.bright}Examples:${colors.reset}\r\n` +
                           `  /kg search dragon\r\n` +
                           `  /kg list entities -n 50 -p 2\r\n`;
                }
                
                // Helper: Parse pagination flags
                let requestedLimit = 20;
                let page = 1;

                const nIndex = args.indexOf('-n');
                if (nIndex !== -1 && args[nIndex + 1]) {
                    const val = parseInt(args[nIndex + 1]);
                    if (!isNaN(val)) requestedLimit = val;
                }

                const pIndex = args.indexOf('-p');
                if (pIndex !== -1 && args[pIndex + 1]) {
                    const val = parseInt(args[pIndex + 1]);
                    if (!isNaN(val) && val > 0) page = val;
                }

                const softCap = requestedLimit;
                const hardCap = 1000;
                const displayLimit = Math.min(softCap, hardCap);
                const offset = (page - 1) * displayLimit;

                const formatTripleLine = (t) => `${colors.cyan}${t.subject}${colors.reset} ${colors.grey}${t.predicate.toLowerCase().replace(/_/g, ' ')}${colors.reset} ${colors.green}${t.object}${colors.reset}`;

                const applyCapping = (results, totalAvailable = -1) => {
                    const displayed = results;
                    let output = displayed.map(t => `- ${formatTripleLine(t)}`).join('\r\n');
                    
                    const hidden = totalAvailable !== -1 ? Math.max(0, totalAvailable - (offset + results.length)) : 0;
                    
                    if (hidden > 0) {
                        output += `\r\n${colors.yellow}${hidden} additional knowledge graph pairs not shown${colors.reset}`;
                        output += `\r\n${colors.yellow}Use -p ${page + 1} to see more results...${colors.reset}`;
                    }

                    output += `\r\n${colors.grey}Page ${page}${totalAvailable !== -1 ? ` of ~${Math.ceil(totalAvailable / displayLimit)} (${totalAvailable} total matches)` : ''}${colors.reset}`;
                    return output;
                };

                if (subcommand === 'showgui') {
                    tools.gui.openWindow({ title: 'Knowledge Graph Viewer', path: 'views/kg_viewer.html', width: 1200, height: 800 });
                    return 'Opening Knowledge Graph Viewer...';
                }

                if (subcommand === 'compact') {
                    const confirmed = String(args[1] || '').toLowerCase() === 'confirm';
                    const preview = await logic.previewCompaction(tools, { source: 'all' });
                    const reducibleOver = preview.totalBefore || 0;

                    if (!confirmed) {
                        return `Warning: This will attempt to reduce over ${reducibleOver} knowledge graphs. This will result in permanent loss of data.\r\nIf you are sure, us /kg compact confirm`;
                    }

                    if ((preview.duplicateCandidates || 0) <= 0) {
                        return `${colors.grey}Compaction skipped: no duplicate knowledge graph entries were found.${colors.reset}`;
                    }

                    const result = await logic.compact(tools, { source: 'all' });
                    const bySource = result.perSource
                        .map(s => `- ${s.kg_source}: ${s.totalBefore} -> ${s.totalAfter} (${s.removedDuplicates} removed)`)
                        .join('\r\n');

                    return [
                        `${colors.bold}${colors.magenta}Knowledge Graph Compaction Complete${colors.reset}`,
                        `${colors.yellow}Removed:${colors.reset} ${result.removedDuplicates} duplicate entries`,
                        `${colors.cyan}Before:${colors.reset} ${result.totalBefore}`,
                        `${colors.green}After:${colors.reset} ${result.totalAfter}`,
                        bySource ? `\r\n${bySource}` : ''
                    ].join('\r\n');
                }

                if (subcommand === 'stats') {
                    const chatStats = logic.chatKG ? await logic.chatKG.getStats() : { tripleCount: 0, entityCount: 0 };
                    const loreStats = logic.projectKG ? await logic.projectKG.getStats() : { tripleCount: 0, entityCount: 0 };
                    return [
                        `${colors.bold}${colors.magenta}Knowledge Graph Statistics${colors.reset}`,
                        `${colors.cyan}History (Chat):${colors.reset} ${chatStats.tripleCount} triples, ${chatStats.entityCount} entities`,
                        `${colors.green}Lore (Project):${colors.reset} ${loreStats.tripleCount} triples, ${loreStats.entityCount} entities`,
                        `${colors.yellow}Total:${colors.reset} ${chatStats.tripleCount + loreStats.tripleCount} triples`
                    ].join('\r\n');
                }

                if (subcommand === 'find') {
                    const entity = args[1];
                    if (!entity) return `${colors.yellow}Usage: /kg find <entity_name> [-n <limit>] [-p <page>]${colors.reset}`;
                    const { triples: results, total } = await logic.getTriples({ subject: entity, limit: displayLimit, offset }, tools);
                    let finalResults = results;
                    let finalTotal = total;
                    
                    if (results.length < displayLimit && offset === 0) {
                         const { triples: objResults, total: objTotal } = await logic.getTriples({ object: entity, limit: displayLimit - results.length, offset }, tools);
                         finalResults = [...results, ...objResults];
                         finalTotal = total + objTotal;
                    }

                    if (finalResults.length === 0 && page === 1) return `${colors.grey}No records found for "${entity}".${colors.reset}`;
                    if (finalResults.length === 0) return `${colors.grey}No more results on page ${page}.${colors.reset}`;
                    return `${colors.bold}Results for "${entity}":${colors.reset}\r\n` + applyCapping(finalResults, finalTotal);
                }

                if (subcommand === 'search') {
                    const query = args.slice(1).filter(a => !['-n', '-p'].includes(a) && !['-n', '-p'].includes(args[args.indexOf(a) - 1])).join(' ');
                    if (!query) return `${colors.yellow}Usage: /kg search <query> [-n <limit>] [-p <page>]${colors.reset}`;
                    const { results, total } = await logic.search(query, { limit: displayLimit, offset }, tools);
                    if (results.length === 0 && page === 1) return `${colors.grey}No results for "${query}".${colors.reset}`;
                    if (results.length === 0) return `${colors.grey}No more results for "${query}" on page ${page}.${colors.reset}`;
                    return `${colors.bold}Search results for "${query}":${colors.reset}\r\n` + applyCapping(results, total);
                }

                if (subcommand === 'list') {
                    const type = args[1]?.toLowerCase();
                    if (type === 'entities') {
                        const { entities: items, total } = await logic.getEntities(displayLimit, tools, offset);
                        if (items.length === 0) return `${colors.grey}No (more) entities found.${colors.reset}`;
                        let output = items.map(e => `${colors.cyan}- ${e}${colors.reset}`).join('\r\n');
                        
                        const hidden = Math.max(0, total - (offset + items.length));
                        if (hidden > 0) output += `\r\n${colors.yellow}${hidden} additional entities not shown. Use -p ${page + 1} to see more...${colors.reset}`;
                        
                        output += `\r\n${colors.grey}Page ${page} of ~${Math.ceil(total / displayLimit)} (${total} unique entities)${colors.reset}`;
                        return `${colors.bold}Unique Entities:${colors.reset}\r\n` + output;
                    }
                    return `${colors.yellow}Usage: /kg list entities [-n <limit>] [-p <page>]${colors.reset}`;
                }

                return [
                    `${colors.bold}Knowledge Graph Toolkit Usage:${colors.reset}`,
                    `  ${colors.cyan}/kg stats${colors.reset} - Show graph size and statistics`,
                    `  ${colors.cyan}/kg list entities [-n <n>] [-p <p>]${colors.reset} - List unique names`,
                    `  ${colors.cyan}/kg find <name> [-n <n>] [-p <p>]${colors.reset} - Show basic triples`,
                    `  ${colors.cyan}/kg search <text> [-n <n>] [-p <p>]${colors.reset} - semantic & exact search`,
                    `  ${colors.cyan}/kg compact${colors.reset} - Preview destructive dedup step`,
                    `  ${colors.cyan}/kg showgui${colors.reset} - Open the full visual graph viewer`,
                    `\r\n${colors.grey}Flags: -n <limit> (default 20, max 1000), -p <page> (default 1)${colors.reset}`
                ].join('\r\n');

            }
        }
    },

    /**
     * Exported functions for other plugins to interact with the Knowledge Graph.
     */
    exports: {
        /**
         * Performs a search across active Knowledge Graphs (History and Lore).
         * @param {string} query - The search query (entity name or thematic string).
         * @param {Object} options - { limit: 20, type: 'hybrid'|'vector'|'fts', source: 'all'|'history'|'lore' }
         */
        search: async (context, tools, query, options = {}) => {
            return await logic.search(query, options, tools);
        },

        /**
         * Retrieves triples matching specific criteria.
         * @param {Object} filter - { subject, predicate, object, limit }
         */
        getTriples: async (context, tools, filter = {}) => {
            return await logic.getTriples(filter, tools);
        },

        /**
         * Finds connections between two entities using the Narrative Energy BFS.
         * @param {string} startEntity - The starting entity name.
         * @param {string} endEntity - The target entity name.
         * @param {number} energy - Optional narrative energy budget (default 100).
         */
        findPaths: async (context, tools, startEntity, endEntity, energy) => {
            return await logic.findPaths(startEntity, endEntity, energy, tools);
        },

        /**
         * Returns a list of unique entities present in the Knowledge Graph.
         * @param {number} limit - Maximum number of entities to return.
         */
        getEntities: async (context, tools, limit = 100) => {
            return await logic.getEntities(limit, tools);
        }
    },
    socketListeners: {
        /**
         * Returns all triples from active KGs (chat history and project lore).
         */
        'get-all-knowledge-graph': async (data, tools) => {
            try {
                // 1. Ensure chatKG is initialized if possible
                if (!logic.chatKG && tools.turnContext?.chatDbFullPath) {
                    await logic.setChatKG(tools.turnContext.chatDbFullPath, tools);
                }

                let allTriples = [];

                // 2. Collect from Chat History KG
                if (logic.chatKG) {
                    const chatTriples = await logic.chatKG.getAllTriples();
                    for (const t of chatTriples) {
                        allTriples.push({ ...t, source: 'History' });
                    }
                }

                // 3. Collect from Project Lore KG
                if (logic.projectKG) {
                    const projectTriples = await logic.projectKG.getAllTriples();
                    for (const t of projectTriples) {
                        allTriples.push({ ...t, source: 'Lore' });
                    }
                }

                // NOTE: External KGs (.dbkg files) are excluded from the viewer 
                // because they can be massive (150k+ triples) and crash the renderer.

                if (allTriples.length === 0) {
                    tools.logger.warn('No triples found in any KG source.');
                } else {
                    tools.logger.log(`Found ${allTriples.length} total triples for viewer.`);
                }

                tools.socket.emit('get-all-knowledge-graph-response', { success: true, triples: allTriples });
            } catch (error) {
                tools.logger.error('Error fetching knowledge graph triples:', error);
                tools.socket.emit('get-all-knowledge-graph-response', { success: false, error: error.message });
            }
        }
    }
};

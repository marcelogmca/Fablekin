const path = require('path');
const fs = require('fs');

const DB_SCHEMA = `
    CREATE TABLE IF NOT EXISTS lore_entries (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT    NOT NULL DEFAULT 'New Entry',
        keywords         TEXT    NOT NULL DEFAULT '[]',
        content          TEXT    NOT NULL DEFAULT '',
        priority         INTEGER NOT NULL DEFAULT 50,
        enabled          INTEGER NOT NULL DEFAULT 1,
        constant         INTEGER NOT NULL DEFAULT 0,
        position         TEXT    NOT NULL DEFAULT 'after_system',
        category         TEXT             DEFAULT 'General',
        case_sensitive   INTEGER NOT NULL DEFAULT 0,
        use_regex        INTEGER NOT NULL DEFAULT 0,
        match_whole_word INTEGER NOT NULL DEFAULT 0,
        scan_depth       INTEGER          DEFAULT NULL,
        comment          TEXT             DEFAULT '',
        hit_count        INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT             DEFAULT (datetime('now')),
        updated_at       TEXT             DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lore_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`;

/**
 * Shared connection cache to prevent SQLITE_CANTOPEN and lock contention.
 * Stores handles by their absolute file path.
 */
const loreDbConnections = new Map();

/**
 * Retrieves or opens a shared database connection.
 * @param {Object} tools 
 * @param {string} filePath 
 * @returns {Promise<Object>}
 */
async function getSharedLoreDb(tools, filePath) {
    if (loreDbConnections.has(filePath)) {
        return loreDbConnections.get(filePath);
    }

    const db = await tools.db.open(filePath);
    await db.exec(DB_SCHEMA);
    loreDbConnections.set(filePath, db);
    return db;
}

const estimateTokens = (text) => Math.ceil((text || '').length / 4);

function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseKeywords(raw) {
    if (Array.isArray(raw)) {
        return raw
            .map((keyword) => String(keyword || '').trim())
            .filter(Boolean);
    }

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];

        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parseKeywords(parsed);
            }
        } catch {
            return trimmed
                .split(',')
                .map((keyword) => keyword.trim())
                .filter(Boolean);
        }
    }

    return [];
}

function sanitizeEntry(entry = {}) {
    const scanDepth =
        entry.scan_depth === null || entry.scan_depth === undefined || entry.scan_depth === ''
            ? null
            : Math.max(0, toInt(entry.scan_depth, 0));

    return {
        id: entry.id ? toInt(entry.id, null) : null,
        name: typeof entry.name === 'string' ? entry.name.trim() : '',
        keywords: parseKeywords(entry.keywords),
        content: typeof entry.content === 'string' ? entry.content : '',
        priority: toInt(entry.priority, 50),
        enabled: entry.enabled !== false,
        constant: !!entry.constant,

        category: String(entry.category || 'General').trim() || 'General',
        case_sensitive: !!entry.case_sensitive,
        use_regex: !!entry.use_regex,
        match_whole_word: !!entry.match_whole_word,
        scan_depth: scanDepth,
        comment: typeof entry.comment === 'string' ? entry.comment : '',
    };
}

function serializeEntry(entry) {
    const sanitized = sanitizeEntry(entry);
    let finalName = sanitized.name;
    if (!finalName) {
        if (sanitized.keywords && sanitized.keywords.length > 0) {
            finalName = sanitized.keywords.join(', ').substring(0, 32).trim();
            if (sanitized.keywords.join(', ').length > 32) finalName += '...';
        }
        if (!finalName) finalName = 'New Entry';
    }

    return {
        ...sanitized,
        name: finalName,
        keywords: JSON.stringify(sanitized.keywords),
        enabled: sanitized.enabled ? 1 : 0,
        constant: sanitized.constant ? 1 : 0,
        case_sensitive: sanitized.case_sensitive ? 1 : 0,
        use_regex: sanitized.use_regex ? 1 : 0,
        match_whole_word: sanitized.match_whole_word ? 1 : 0,
    };
}

function deserializeEntry(row) {
    const safeRow = row || {};
    return {
        ...safeRow,
        keywords: parseKeywords(safeRow.keywords),
        priority: toInt(safeRow.priority, 50),
        enabled: !!safeRow.enabled,
        constant: !!safeRow.constant,
        case_sensitive: !!safeRow.case_sensitive,
        use_regex: !!safeRow.use_regex,
        match_whole_word: !!safeRow.match_whole_word,
        scan_depth: safeRow.scan_depth === undefined ? null : safeRow.scan_depth,
        hit_count: toInt(safeRow.hit_count, 0),
    };
}

function matchesKeywords(keywords, searchContext, { caseSensitive, useRegex, matchWholeWord }) {
    for (const keyword of keywords) {
        if (!keyword || !keyword.trim()) continue;
        const needle = keyword.trim();

        try {
            if (useRegex) {
                const flags = caseSensitive ? '' : 'i';
                if (new RegExp(needle, flags).test(searchContext)) return true;
                continue;
            }

            if (matchWholeWord) {
                const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const flags = caseSensitive ? '' : 'i';
                if (new RegExp(`\\b${escaped}\\b`, flags).test(searchContext)) return true;
                continue;
            }

            const haystack = caseSensitive ? searchContext : searchContext.toLowerCase();
            const candidate = caseSensitive ? needle : needle.toLowerCase();
            if (haystack.includes(candidate)) return true;
        } catch {
            continue;
        }
    }

    return false;
}

async function withLoreDb(tools, filePath, work) {
    try {
        const db = await getSharedLoreDb(tools, filePath);
        return await work(db);
    } catch (err) {
        // If a shared connection fails due to being closed or corrupted, 
        // clear it from cache to allow recovery on next attempt.
        if (err.message?.includes('closed') || err.message?.includes('database is closed')) {
            loreDbConnections.delete(filePath);
        }
        throw err;
    }
}

function buildPromptBlock(tools, entries) {
    if (!entries.length) return null;

    const body = entries
        .map((entry) => {
            return `**${entry.name}**: ${entry.content}`;
        })
        .join('\n\n');

    return tools.prompt.wrap('lore_context', body, {
        count: String(entries.length),
    });
}

module.exports = {
    id: 'lore_book',
    name: 'Lore Book',
    author: 'Fablekin Core',
    version: '2.0.0',
    category: 'World',
    wizard: {
        include: true,
        order: 500,
        group: 'World',
        label: 'Lore Book',
        recommended_enabled: true,
        author_note: 'Recommended for authored settings, canon facts, and anything you want explicitly available.',
        enabled_note: 'Keyword-triggered lore entries can be injected into prompts with controlled token budgets.',
        disabled_note: 'Authored lore will not be automatically surfaced unless another system includes it.',
        settings_note: 'Tune token budgets, recursion, and lore editor behavior in plugin settings.'
    },
    description: 'Keyword-triggered lore book with recursive injection and a socket-driven custom editor.',
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Keyword-triggered lore book with recursive injection and a token-budgeted prompt assembly.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Utilizes a multi-pass keyword scanner to inject relevant world-building data into the narrative context. It supports recursive scanning (where lore entries can trigger other lore entries) and strictly adheres to a per-turn token budget. Entries are prioritized by "Importance" and can be conditionally injected into different prompt locations (System, User, or Narrative Blocks).'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'High',
            immersion: 'None',
            cost: 'None',
            latency: 'None'
        },
        max_tokens: {
            type: 'number',
            label: 'Max Lore Tokens (total budget)',
            description: 'Combined token budget across all selected lore books.',
            default: 2000,
            min: 100,
            max: 16000
        },
        max_recursive_depth: {
            type: 'number',
            label: 'Max Recursive Depth',
            description: 'How many additional passes injected lore can trigger.',
            default: 2,
            min: 0,
            max: 5
        },
        default_scan_depth: {
            type: 'number',
            label: 'Default Scan Depth (turns)',
            description: 'How many previous turns are scanned for keyword matches.',
            default: 3,
            min: 0,
            max: 30
        },
        writing_style: {
            type: 'project-directive',
            label: 'Lore & Writing Style',
            description: 'Define the project-wide narrative voice, tone, and vocabulary constraints. This affects the Writer agent\'s prose.',
            placeholder: '"Prose should be gothic and descriptive, emphasizing the decay of the setting. Use archaic vocabulary for magic."',
            isProjectDirective: true
        }
    },
    terminalCommands: {
        '/lore': {
            description: 'Inspect Lore Book entries. Usage: /lore [subcommand] [query]',
            run: async (args, tools) => {
                const colors = { reset: "\x1b[0m", bright: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", grey: "\x1b[90m", bold: "\x1b[1m" };
                const subcommand = args[0]?.toLowerCase();

                if (!subcommand || subcommand === 'help') {
                    return `\r\n${colors.bright}Lore Book Toolkit${colors.reset}\r\n` +
                        `Usage: /lore ${colors.cyan}[subcommand]${colors.reset} ${colors.yellow}[query]${colors.reset}\r\n\r\n` +
                        `${colors.bright}Subcommands:${colors.reset}\r\n` +
                        `  ${colors.cyan}list${colors.reset}       - List all entries across all active lore databases.\r\n` +
                        `  ${colors.cyan}search${colors.reset}     - Full-text search across all fields (name, content, keywords).\r\n` +
                        `  ${colors.cyan}stats${colors.reset}      - Show database stats including total entries and hit counts.\r\n\r\n` +
                        `${colors.bright}Examples:${colors.reset}\r\n` +
                        `  /lore search excalibur\r\n` +
                        `  /lore list\r\n`;
                }

                const query = args.slice(1).join(' ');

                // Instead of relying on turnContext (which might be null/skeletal),
                // we check the project config for all files set to 'lore_entry' mode.
                const config = await tools.project.getFullProjectConfig();
                const loreFiles = Object.entries(config)
                    .filter(([filePath, settings]) => {
                        if (filePath.startsWith('__')) return false; // skip metadata keys
                        const mode = typeof settings === 'string' ? settings : (settings.mode || 'none');
                        return mode === 'lore_entry';
                    })
                    .map(([absPath]) => ({
                        path: absPath,
                        name: path.basename(absPath)
                    }));

                if (loreFiles.length === 0) return 'No Lore Book databases found in the current project.';

                if (subcommand === 'list') {
                    let output = `\r\n\x1b[1;32mLore Book Entries:\x1b[0m\r\n`;
                    for (const file of loreFiles) {
                        const rows = await withLoreDb(tools, file.path, (db) =>
                            db.query('SELECT name, enabled, constant, priority FROM lore_entries ORDER BY priority DESC')
                        );
                        output += `\x1b[1;33m[${path.basename(file.path)}]\x1b[0m\r\n`;
                        rows.forEach(r => {
                            const status = r.enabled ? (r.constant ? '\x1b[1;35m[C]\x1b[0m' : '\x1b[1;32m[E]\x1b[0m') : '\x1b[1;31m[D]\x1b[0m';
                            output += `  ${status} \x1b[1;36m${r.name}\x1b[0m (P:${r.priority})\r\n`;
                        });
                    }
                    return output;
                } else if (subcommand === 'search') {
                    if (!query) return 'Usage: /lore search <query>';
                    let output = `\r\n\x1b[1;32mLore Search Results for "${query}":\x1b[0m\r\n`;
                    let found = false;

                    for (const file of loreFiles) {
                        const rows = await withLoreDb(tools, file.path, (db) =>
                            db.query('SELECT name, content FROM lore_entries WHERE name LIKE ? OR content LIKE ? OR keywords LIKE ?', [`%${query}%`, `%${query}%`, `%${query}%`])
                        );
                        if (rows.length > 0) {
                            found = true;
                            output += `\x1b[1;33m[${path.basename(file.path)}]\x1b[0m\r\n`;
                            rows.forEach(r => {
                                output += `  \x1b[1;36m${r.name}\x1b[0m: \x1b[0;90m${r.content.substring(0, 80)}...\x1b[0m\r\n`;
                            });
                        }
                    }
                    return found ? output : `No matches found for "${query}".`;
                } else if (subcommand === 'stats') {
                    let output = `\r\n\x1b[1;32mLore Book Statistics:\x1b[0m\r\n`;
                    for (const file of loreFiles) {
                        const stats = await withLoreDb(tools, file.path, async (db) => {
                            const total = await db.get('SELECT COUNT(*) as count FROM lore_entries');
                            const hits = await db.get('SELECT SUM(hit_count) as total_hits FROM lore_entries');
                            const top = await db.get('SELECT name, hit_count FROM lore_entries ORDER BY hit_count DESC LIMIT 1');
                            return { count: total.count, hits: hits.total_hits || 0, top };
                        });
                        output += `\x1b[1;33m[${path.basename(file.path)}]\x1b[0m\r\n`;
                        output += `  Total Entries: ${stats.count}\r\n`;
                        output += `  Total Cache Hits: ${stats.hits}\r\n`;
                        if (stats.top) output += `  Most Frequent: \x1b[1;36m${stats.top.name}\x1b[0m (${stats.top.hit_count} hits)\r\n`;
                    }
                    return output;
                }

                return 'Unknown subcommand. Use /lore [list|search|stats]';
            }
        }
    },

    hooks: {
        HOOK_SYSTEM_BOOT: {
            priority: 10,
            run: async (_turnContext, tools) => {
                tools.logger.log('Lore Book', 'Registering lore entry file mode.');
                tools.project.registerFileMode('lore_entry', {
                    label: 'Lore Entry',
                    description: 'SQLite file managed by the Lore Book editor.',
                    color: 'var(--area-lore)',
                    backgroundColor: 'rgba(var(--area-lore-rgb), 0.1)',
                    customEditor: true,
                    conversion: {
                        targetExtension: '.db',
                        title: 'Convert to Lore Book',
                        message: 'Convert this file into a Lore Book database?'
                    }
                });
            }
        },

        HOOK_FILE_CONVERTED: {
            run: async (_turnContext, tools, { pluginId, mode, newPath }) => {
                if (pluginId !== 'lore_book' || mode !== 'lore_entry') return;
                tools.logger.log('Lore Book', `Initializing DB for ${path.basename(newPath)}`);
                await withLoreDb(tools, newPath, async () => { });
            }
        },

        HOOK_POST_PROMPT_BUILDER: {
            run: async (turnContext, tools) => {
                const settings = tools.settings.getSelf();
                const maxTokens = settings.max_tokens ?? 2000;
                const maxRecursiveDepth = settings.max_recursive_depth ?? 2;
                const defaultScanDepth = settings.default_scan_depth ?? 3;

                const selectedFiles = turnContext.input.selectedFiles || [];
                const loreFiles = selectedFiles.filter((file) =>
                    file &&
                    file.mode === 'lore_entry' &&
                    typeof file.path === 'string' &&
                    file.path.toLowerCase().endsWith('.db')
                );
                if (loreFiles.length === 0) return;

                const currentInput = turnContext.input.userPrompt || '';
                const history = await turnContext.retrieveDatedChapters();
                const turns = [...(history.fullchapters || [])].sort((a, b) => a.turnNumber - b.turnNumber);
                const recentTurns = turns.slice(-defaultScanDepth);

                const contextParts = [];
                for (const turn of recentTurns) {
                    // TurnContext items from history might be skeletons, ensure they are fully loaded
                    await turn.ensureFull();
                    contextParts.push(turn.processed?.dialogueProcessor?.dialogue || turn.output?.fulltext || '');
                }

                const baseContext = [...contextParts, currentInput]
                    .filter(Boolean)
                    .join('\n\n')
                    .trim();

                let allEntries = [];
                for (const file of loreFiles) {
                    const rows = await withLoreDb(tools, file.path, (db) =>
                        db.query('SELECT * FROM lore_entries WHERE enabled = 1')
                    );
                    rows.forEach((row) => {
                        allEntries.push({ ...deserializeEntry(row), _sourcePath: file.path });
                    });
                }

                allEntries.sort((a, b) =>
                    Number(b.constant) - Number(a.constant) ||
                    b.priority - a.priority ||
                    a.name.localeCompare(b.name)
                );

                // DIAGNOSTIC LOG
                if (allEntries.length > 0) {
                    const first = allEntries[0];
                    tools.logger.log('Lore Book', `[DEBUG] Context Snippet: "${baseContext.substring(0, 100)}..." (${baseContext.length} chars)`);
                    tools.logger.log('Lore Book', `[DEBUG] First Entry Name: ${first.name} | Keywords: ${JSON.stringify(first.keywords)}`);
                }

                const injected = new Set();
                const triggeredEntries = [];
                const hitUpdates = [];

                let tokenBudget = maxTokens;
                let scanContext = baseContext;
                let deepestInjectedDepth = -1;

                let checkedTotal = 0;
                let budgetSkipped = 0;
                let constantCount = 0;
                let matchCount = 0;
                const matchNames = [];

                for (let depth = 0; depth <= maxRecursiveDepth; depth++) {
                    let anyNew = false;

                    for (const entry of allEntries) {
                        const key = `${entry._sourcePath}:${entry.id}`;
                        if (injected.has(key)) continue;

                        const entryTokens = estimateTokens(entry.content);
                        if (entryTokens > tokenBudget) {
                            budgetSkipped++;
                            continue;
                        }

                        checkedTotal++;

                        // Determine the search context for this specific entry
                        let entrySearchContext = scanContext;
                        if (entry.scan_depth !== null && entry.scan_depth !== undefined) {
                            const scopedTurns = turns.slice(-entry.scan_depth);
                            const scopedParts = [];
                            for (const turn of scopedTurns) {
                                await turn.ensureFull();
                                scopedParts.push(turn.processed?.dialogueProcessor?.dialogue || turn.output?.fulltext || '');
                            }
                            entrySearchContext = [...scopedParts, currentInput]
                                .filter(Boolean)
                                .join('\n\n')
                                .trim();
                        }

                        const shouldInject =
                            entry.constant ||
                            matchesKeywords(entry.keywords, entrySearchContext, {
                                caseSensitive: entry.case_sensitive,
                                useRegex: entry.use_regex,
                                matchWholeWord: entry.match_whole_word,
                            });

                        if (!shouldInject) continue;

                        injected.add(key);
                        deepestInjectedDepth = Math.max(deepestInjectedDepth, depth);

                        if (entry.constant) {
                            constantCount++;
                        } else {
                            matchCount++;
                            matchNames.push(entry.name);
                        }

                        triggeredEntries.push(entry);
                        hitUpdates.push({ sourcePath: entry._sourcePath, id: entry.id });
                        tokenBudget -= entryTokens;
                        anyNew = true;

                        if (depth < maxRecursiveDepth) {
                            scanContext = `${scanContext}\n${entry.content}`.trim();
                        }
                    }

                    if (!anyNew) break;
                }

                const loreBlock = buildPromptBlock(tools, triggeredEntries);
                if (loreBlock) {
                    tools.prompt.inject('dynamic_knowledge', loreBlock, 'root');
                }

                const totalInjected = triggeredEntries.length;
                const tokensUsed = maxTokens - tokenBudget;
                const matchSummary = matchNames.length > 0 ? ` [Matches: ${matchNames.join(', ')}]` : '';

                tools.logger.log(
                    'Lore Book',
                    `Scan Stats: Pool: ${allEntries.length} | Scanned: ${checkedTotal} | Budget Skipped: ${budgetSkipped} | Depth: ${Math.max(deepestInjectedDepth, 0)}\n` +
                    `Results: Injected: ${totalInjected} (Constant: ${constantCount}, Matched: ${matchCount})${matchSummary}\n` +
                    `Budget: ${tokensUsed}/${maxTokens} tokens (~${Math.round((tokensUsed / maxTokens) * 100)}%)`
                );

                if (hitUpdates.length === 0) return;

                setImmediate(async () => {
                    const idsByFile = {};
                    for (const { sourcePath, id } of hitUpdates) {
                        if (!idsByFile[sourcePath]) idsByFile[sourcePath] = [];
                        idsByFile[sourcePath].push(id);
                    }

                    for (const [sourcePath, ids] of Object.entries(idsByFile)) {
                        try {
                            await withLoreDb(tools, sourcePath, async (db) => {
                                for (const id of ids) {
                                    await db.execute(
                                        'UPDATE lore_entries SET hit_count = hit_count + 1 WHERE id = ?',
                                        [id]
                                    );
                                }
                            });
                        } catch { }
                    }
                });
            }
        }
    },

    exports: {
        provideFileView: async (_turnContext, tools, { filePath }) => {
            tools.logger.log('Lore Book', `Serving editor for ${path.basename(filePath)}`);
            try {
                await withLoreDb(tools, filePath, async () => { });
            } catch { }

            const pluginDir = __dirname;
            const html = fs.readFileSync(path.join(pluginDir, 'ui.html'), 'utf8');
            const css = fs.readFileSync(path.join(pluginDir, 'ui.css'), 'utf8');
            const js = fs.readFileSync(path.join(pluginDir, 'ui.js'), 'utf8');

            const safePath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const finalJs = js.replace('{{LORE_BOOK_PATH}}', safePath);

            const content = `
<style>${css}</style>
${html}
<script>${finalJs}</script>
`;
            return { content, type: 'html' };
        }
    },

    socketListeners: {
        'lore-book:ping': async (_data, tools) => {
            tools.logger.log('Lore Book', 'Socket ping received from lore editor.');
            tools.socket.emit('lore-book:pong', {
                message: 'Archive link stable.',
                serverTime: new Date().toISOString()
            });
        },

        'lore-book:load': async ({ filePath }, tools) => {
            try {
                tools.logger.log('Lore Book', `Socket load request for ${path.basename(filePath || '')}`);
                const rows = await withLoreDb(tools, filePath, (db) =>
                    db.query('SELECT * FROM lore_entries ORDER BY constant DESC, priority DESC, name ASC')
                );

                tools.socket.emit('lore-book:loaded', {
                    filePath,
                    entries: rows.map(deserializeEntry)
                });
            } catch (error) {
                tools.socket.emit('lore-book:error', { message: error.message });
            }
        },

        'lore-book:upsert-entry': async ({ filePath, entry }, tools) => {
            try {
                tools.logger.log(
                    'Lore Book',
                    `Socket upsert request for ${path.basename(filePath || '')}: ${entry?.id ? `update #${entry.id}` : 'create'}`
                );
                const serialized = serializeEntry(entry);
                const payload = await withLoreDb(tools, filePath, async (db) => {
                    if (serialized.id) {
                        await db.execute(`
                            UPDATE lore_entries SET
                                name = ?,
                                keywords = ?,
                                content = ?,
                                priority = ?,
                                enabled = ?,
                                constant = ?,
                                category = ?,
                                case_sensitive = ?,
                                use_regex = ?,
                                match_whole_word = ?,
                                scan_depth = ?,
                                comment = ?,
                                updated_at = datetime('now')
                            WHERE id = ?
                        `, [
                            serialized.name,
                            serialized.keywords,
                            serialized.content,
                            serialized.priority,
                            serialized.enabled,
                            serialized.constant,
                            serialized.category,
                            serialized.case_sensitive,
                            serialized.use_regex,
                            serialized.match_whole_word,
                            serialized.scan_depth,
                            serialized.comment,
                            serialized.id
                        ]);

                        const updated = await db.get('SELECT * FROM lore_entries WHERE id = ?', [serialized.id]);
                        if (!updated) throw new Error('Lore entry could not be saved.');
                        return { isNew: false, entry: deserializeEntry(updated) };
                    }

                    const result = await db.execute(`
                        INSERT INTO lore_entries
                            (name, keywords, content, priority, enabled, constant,
                             category, case_sensitive, use_regex, match_whole_word, scan_depth, comment)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        serialized.name,
                        serialized.keywords,
                        serialized.content,
                        serialized.priority,
                        serialized.enabled,
                        serialized.constant,
                        serialized.category,
                        serialized.case_sensitive,
                        serialized.use_regex,
                        serialized.match_whole_word,
                        serialized.scan_depth,
                        serialized.comment
                    ]);

                    const inserted = await db.get('SELECT * FROM lore_entries WHERE id = ?', [result.lastID]);
                    if (!inserted) throw new Error('Lore entry could not be created.');
                    return { isNew: true, entry: deserializeEntry(inserted) };
                });

                tools.socket.emit('lore-book:entry-saved', { filePath, ...payload });
            } catch (error) {
                tools.socket.emit('lore-book:error', { message: error.message });
            }
        },

        'lore-book:delete-entry': async ({ filePath, id }, tools) => {
            try {
                tools.logger.log('Lore Book', `Socket delete request for ${path.basename(filePath || '')}: #${id}`);
                await withLoreDb(tools, filePath, (db) =>
                    db.execute('DELETE FROM lore_entries WHERE id = ?', [id])
                );
                tools.socket.emit('lore-book:entry-deleted', { filePath, id });
            } catch (error) {
                tools.socket.emit('lore-book:error', { message: error.message });
            }
        },

        'lore-book:export': async ({ filePath }, tools) => {
            try {
                tools.logger.log('Lore Book', `Socket export request for ${path.basename(filePath || '')}`);
                const rows = await withLoreDb(tools, filePath, (db) =>
                    db.query('SELECT * FROM lore_entries ORDER BY constant DESC, priority DESC, name ASC')
                );

                tools.socket.emit('lore-book:exported', {
                    filePath,
                    data: {
                        version: '2.0',
                        exported: new Date().toISOString(),
                        book: path.basename(filePath),
                        entries: rows.map(deserializeEntry)
                    }
                });
            } catch (error) {
                tools.socket.emit('lore-book:error', { message: error.message });
            }
        },

        'lore-book:import': async ({ filePath, importData, mode }, tools) => {
            try {
                tools.logger.log(
                    'Lore Book',
                    `Socket import request for ${path.basename(filePath || '')}: ${(importData?.entries || []).length} entries (${mode})`
                );
                const entries = Array.isArray(importData?.entries) ? importData.entries : [];
                const rows = await withLoreDb(tools, filePath, async (db) => {
                    if (mode === 'replace') {
                        await db.execute('DELETE FROM lore_entries');
                    }

                    for (const entry of entries) {
                        const serialized = serializeEntry(entry);
                        await db.execute(`
                            INSERT INTO lore_entries
                                (name, keywords, content, priority, enabled, constant,
                                 category, case_sensitive, use_regex, match_whole_word, scan_depth, comment)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [
                            serialized.name,
                            serialized.keywords,
                            serialized.content,
                            serialized.priority,
                            serialized.enabled,
                            serialized.constant,
                            serialized.category,
                            serialized.case_sensitive,
                            serialized.use_regex,
                            serialized.match_whole_word,
                            serialized.scan_depth,
                            serialized.comment
                        ]);
                    }

                    return db.query('SELECT * FROM lore_entries ORDER BY constant DESC, priority DESC, name ASC');
                });

                tools.socket.emit('lore-book:loaded', {
                    filePath,
                    entries: rows.map(deserializeEntry)
                });
                tools.status.showTemporary(`Imported ${entries.length} entries (${mode})`, 3000, '#00e5ff');
            } catch (error) {
                tools.socket.emit('lore-book:error', { message: error.message });
            }
        },

        'lore-book:bulk-toggle': async ({ filePath, ids, enabled }, tools) => {
            try {
                tools.logger.log(
                    'Lore Book',
                    `Socket bulk-toggle request for ${path.basename(filePath || '')}: ${(ids || []).length} entries => ${enabled ? 'enabled' : 'disabled'}`
                );
                const safeIds = Array.isArray(ids)
                    ? ids.map((id) => toInt(id, null)).filter((id) => id !== null)
                    : [];

                const rows = await withLoreDb(tools, filePath, async (db) => {
                    const value = enabled ? 1 : 0;
                    for (const id of safeIds) {
                        await db.execute(
                            'UPDATE lore_entries SET enabled = ?, updated_at = datetime(\'now\') WHERE id = ?',
                            [value, id]
                        );
                    }

                    return db.query('SELECT * FROM lore_entries ORDER BY constant DESC, priority DESC, name ASC');
                });

                tools.socket.emit('lore-book:loaded', {
                    filePath,
                    entries: rows.map(deserializeEntry)
                });
            } catch (error) {
                tools.socket.emit('lore-book:error', { message: error.message });
            }
        }
    }
};

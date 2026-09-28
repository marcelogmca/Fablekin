const path = require('path');
const fs = require('fs');
const { analyzeImport, normalizeImport } = require('./import_adapter');

const DB_SCHEMA = `
    CREATE TABLE IF NOT EXISTS lore_entries (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT    NOT NULL DEFAULT 'New Entry',
        keywords         TEXT    NOT NULL DEFAULT '[]',
        secondary_keywords TEXT  NOT NULL DEFAULT '[]',
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
        scan_depth_unit  TEXT    NOT NULL DEFAULT 'chapters',
        comment          TEXT             DEFAULT '',
        selective        INTEGER NOT NULL DEFAULT 0,
        selective_logic  INTEGER NOT NULL DEFAULT 0,
        probability      INTEGER NOT NULL DEFAULT 100,
        use_probability  INTEGER NOT NULL DEFAULT 0,
        exclude_recursion INTEGER NOT NULL DEFAULT 0,
        prevent_recursion INTEGER NOT NULL DEFAULT 0,
        delay_until_recursion INTEGER NOT NULL DEFAULT 0,
        ignore_budget    INTEGER NOT NULL DEFAULT 0,
        include_name_in_prompt INTEGER NOT NULL DEFAULT 1,
        source_format    TEXT             DEFAULT '',
        source_uid       TEXT             DEFAULT '',
        source_payload   TEXT             DEFAULT '{}',
        import_warnings  TEXT             DEFAULT '[]',
        hit_count        INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT             DEFAULT (datetime('now')),
        updated_at       TEXT             DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lore_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`;

const ADDITIVE_ENTRY_COLUMNS = {
    secondary_keywords: "TEXT NOT NULL DEFAULT '[]'",
    scan_depth_unit: "TEXT NOT NULL DEFAULT 'chapters'",
    selective: 'INTEGER NOT NULL DEFAULT 0',
    selective_logic: 'INTEGER NOT NULL DEFAULT 0',
    probability: 'INTEGER NOT NULL DEFAULT 100',
    use_probability: 'INTEGER NOT NULL DEFAULT 0',
    exclude_recursion: 'INTEGER NOT NULL DEFAULT 0',
    prevent_recursion: 'INTEGER NOT NULL DEFAULT 0',
    delay_until_recursion: 'INTEGER NOT NULL DEFAULT 0',
    ignore_budget: 'INTEGER NOT NULL DEFAULT 0',
    include_name_in_prompt: 'INTEGER NOT NULL DEFAULT 1',
    source_format: "TEXT DEFAULT ''",
    source_uid: "TEXT DEFAULT ''",
    source_payload: "TEXT DEFAULT '{}'",
    import_warnings: "TEXT DEFAULT '[]'",
};

async function ensureLoreSchema(db) {
    await db.exec(DB_SCHEMA);
    const columns = await db.query('PRAGMA table_info(lore_entries)');
    const existing = new Set(columns.map((column) => column.name));
    for (const [name, definition] of Object.entries(ADDITIVE_ENTRY_COLUMNS)) {
        if (!existing.has(name)) {
            await db.exec(`ALTER TABLE lore_entries ADD COLUMN ${name} ${definition}`);
        }
    }
}

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
    const normalizedPath = path.resolve(filePath);
    if (loreDbConnections.has(normalizedPath)) {
        return loreDbConnections.get(normalizedPath);
    }

    const db = await tools.db.open(normalizedPath);
    await ensureLoreSchema(db);
    loreDbConnections.set(normalizedPath, db);
    return db;
}

async function closeSharedLoreDb(filePath) {
    const normalizedPath = path.resolve(filePath);
    const db = loreDbConnections.get(normalizedPath);
    if (!db) return false;

    loreDbConnections.delete(normalizedPath);
    await db.close();
    return true;
}

const estimateTokens = (text) => Math.ceil((text || '').length / 4);
const PLACEMENTS = new Set(['shared_dynamic', 'shared_canon', 'writer_dynamic', 'director_dynamic']);

function normalizePlacement(value) {
    const normalized = String(value || '').trim();
    if (PLACEMENTS.has(normalized)) return normalized;
    return 'shared_dynamic';
}

function normalizeScanUnit(value) {
    return value === 'messages' ? 'messages' : 'chapters';
}

function normalizeBookSettings(input = {}) {
    const rawBudget = input.token_budget;
    const rawDepth = input.default_scan_depth;
    const parsedBudget = rawBudget === null || rawBudget === undefined || rawBudget === ''
        ? null
        : Math.max(0, toInt(rawBudget, 0));
    const parsedDepth = rawDepth === null || rawDepth === undefined || rawDepth === ''
        ? null
        : Math.max(0, toInt(rawDepth, 0));

    return {
        token_budget: parsedBudget && parsedBudget > 0 ? parsedBudget : null,
        default_scan_depth: parsedDepth,
        scan_depth_unit: normalizeScanUnit(input.scan_depth_unit),
        recursive_scanning: input.recursive_scanning !== false,
    };
}

async function readLoreSetting(db, key, fallback = null) {
    const row = await db.get('SELECT value FROM lore_settings WHERE key = ?', [key]);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return fallback; }
}

async function writeLoreSetting(db, key, value) {
    await db.execute(
        'INSERT OR REPLACE INTO lore_settings (key, value) VALUES (?, ?)',
        [key, JSON.stringify(value)]
    );
}

async function readBookSettings(db) {
    return normalizeBookSettings(await readLoreSetting(db, 'book_settings', {}));
}

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
        secondary_keywords: parseKeywords(entry.secondary_keywords),
        content: typeof entry.content === 'string' ? entry.content : '',
        priority: toInt(entry.priority, 50),
        enabled: entry.enabled !== false,
        constant: !!entry.constant,
        position: normalizePlacement(entry.position),

        category: String(entry.category || 'General').trim() || 'General',
        case_sensitive: !!entry.case_sensitive,
        use_regex: !!entry.use_regex,
        match_whole_word: !!entry.match_whole_word,
        scan_depth: scanDepth,
        scan_depth_unit: normalizeScanUnit(entry.scan_depth_unit),
        comment: typeof entry.comment === 'string' ? entry.comment : '',
        selective: !!entry.selective,
        selective_logic: Math.max(0, Math.min(3, toInt(entry.selective_logic, 0))),
        probability: Math.max(0, Math.min(100, toInt(entry.probability, 100))),
        use_probability: !!entry.use_probability,
        exclude_recursion: !!entry.exclude_recursion,
        prevent_recursion: !!entry.prevent_recursion,
        delay_until_recursion: Math.max(0, toInt(entry.delay_until_recursion, 0)),
        ignore_budget: !!entry.ignore_budget,
        include_name_in_prompt: entry.include_name_in_prompt !== false,
        source_format: typeof entry.source_format === 'string' ? entry.source_format : '',
        source_uid: entry.source_uid === undefined || entry.source_uid === null ? '' : String(entry.source_uid),
        source_payload: typeof entry.source_payload === 'string' ? entry.source_payload : '{}',
        import_warnings: Array.isArray(entry.import_warnings) ? entry.import_warnings : parseKeywords(entry.import_warnings),
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
        secondary_keywords: JSON.stringify(sanitized.secondary_keywords),
        enabled: sanitized.enabled ? 1 : 0,
        constant: sanitized.constant ? 1 : 0,
        case_sensitive: sanitized.case_sensitive ? 1 : 0,
        use_regex: sanitized.use_regex ? 1 : 0,
        match_whole_word: sanitized.match_whole_word ? 1 : 0,
        selective: sanitized.selective ? 1 : 0,
        use_probability: sanitized.use_probability ? 1 : 0,
        exclude_recursion: sanitized.exclude_recursion ? 1 : 0,
        prevent_recursion: sanitized.prevent_recursion ? 1 : 0,
        ignore_budget: sanitized.ignore_budget ? 1 : 0,
        include_name_in_prompt: sanitized.include_name_in_prompt ? 1 : 0,
        import_warnings: JSON.stringify(sanitized.import_warnings),
    };
}

function deserializeEntry(row) {
    const safeRow = row || {};
    return {
        ...safeRow,
        keywords: parseKeywords(safeRow.keywords),
        secondary_keywords: parseKeywords(safeRow.secondary_keywords),
        priority: toInt(safeRow.priority, 50),
        enabled: !!safeRow.enabled,
        constant: !!safeRow.constant,
        case_sensitive: !!safeRow.case_sensitive,
        use_regex: !!safeRow.use_regex,
        match_whole_word: !!safeRow.match_whole_word,
        scan_depth: safeRow.scan_depth === undefined ? null : safeRow.scan_depth,
        scan_depth_unit: normalizeScanUnit(safeRow.scan_depth_unit),
        position: normalizePlacement(safeRow.position),
        selective: !!safeRow.selective,
        selective_logic: toInt(safeRow.selective_logic, 0),
        probability: toInt(safeRow.probability, 100),
        use_probability: !!safeRow.use_probability,
        exclude_recursion: !!safeRow.exclude_recursion,
        prevent_recursion: !!safeRow.prevent_recursion,
        delay_until_recursion: toInt(safeRow.delay_until_recursion, 0),
        ignore_budget: !!safeRow.ignore_budget,
        include_name_in_prompt: safeRow.include_name_in_prompt !== 0,
        import_warnings: parseKeywords(safeRow.import_warnings),
        hit_count: toInt(safeRow.hit_count, 0),
    };
}

function matchesKeywords(keywords, searchContext, { caseSensitive, useRegex, matchWholeWord }) {
    for (const keyword of keywords) {
        if (!keyword || !keyword.trim()) continue;
        const needle = keyword.trim();

        try {
            if (!useRegex && needle.startsWith('/') && needle.lastIndexOf('/') > 0) {
                const closingSlash = needle.lastIndexOf('/');
                const pattern = needle.slice(1, closingSlash);
                const flags = needle.slice(closingSlash + 1);
                if (/^[dgimsuvy]*$/.test(flags) && new RegExp(pattern, flags).test(searchContext)) return true;
                continue;
            }

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

function evaluateEntryKeywords(entry, searchContext) {
    const options = {
        caseSensitive: entry.case_sensitive,
        useRegex: entry.use_regex,
        matchWholeWord: entry.match_whole_word,
    };
    const primaryMatches = entry.keywords.filter((keyword) =>
        matchesKeywords([keyword], searchContext, options)
    );
    const primaryMatch = primaryMatches.length > 0;
    if (!primaryMatch || !entry.selective || entry.secondary_keywords.length === 0) {
        return {
            matched: primaryMatch,
            reason: primaryMatch ? 'primary_match' : 'primary_not_found',
            primaryMatches,
            secondaryMatches: [],
            secondaryMissing: entry.secondary_keywords.slice()
        };
    }

    const secondaryMatches = entry.secondary_keywords.filter((keyword) =>
        matchesKeywords([keyword], searchContext, options)
    );
    const secondaryMissing = entry.secondary_keywords.filter((keyword) =>
        !secondaryMatches.includes(keyword)
    );
    const anySecondary = secondaryMatches.length > 0;
    const allSecondary = secondaryMatches.length === entry.secondary_keywords.length;
    let matched;

    switch (entry.selective_logic) {
        case 1: matched = !allSecondary; break; // NOT ALL
        case 2: matched = !anySecondary; break; // NOT ANY
        case 3: matched = allSecondary; break;  // AND ALL
        case 0:
        default: matched = anySecondary; break; // AND ANY
    }

    return {
        matched,
        reason: matched ? 'secondary_condition_passed' : 'secondary_condition_failed',
        primaryMatches,
        secondaryMatches,
        secondaryMissing
    };
}

async function buildContextCatalog(turns, currentInput, maxHistoryTurns = null) {
    const chapters = [];
    const messages = [];
    const scopedTurns = Number.isFinite(maxHistoryTurns)
        ? turns.slice(-Math.max(0, maxHistoryTurns))
        : turns;

    for (const turn of scopedTurns) {
        await turn.ensureFull();
        const userInput = String(turn.input?.userPrompt || '').trim();
        const narrative = String(
            turn.processed?.dialogueProcessor?.dialogue || turn.output?.fulltext || ''
        ).trim();
        const chapter = [userInput, narrative].filter(Boolean).join('\n\n');
        if (chapter) chapters.push(chapter);
        if (userInput) messages.push(userInput);
        if (narrative) messages.push(narrative);
    }

    return { chapters, messages, currentInput: String(currentInput || '').trim() };
}

function contextForScope(catalog, depth, unit) {
    const safeDepth = Math.max(0, toInt(depth, 0));
    if (unit === 'messages') {
        const messageStream = [...catalog.messages, catalog.currentInput].filter(Boolean);
        return (safeDepth > 0 ? messageStream.slice(-safeDepth) : messageStream.slice(-1)).join('\n\n').trim();
    }

    const chapters = safeDepth > 0 ? catalog.chapters.slice(-safeDepth) : [];
    return [...chapters, catalog.currentInput].filter(Boolean).join('\n\n').trim();
}

function resolveEntryScope(entry, bookSettings, globalDepth) {
    if (entry.scan_depth !== null && entry.scan_depth !== undefined) {
        return { depth: entry.scan_depth, unit: normalizeScanUnit(entry.scan_depth_unit) };
    }
    if (bookSettings.default_scan_depth !== null && bookSettings.default_scan_depth !== undefined) {
        return {
            depth: bookSettings.default_scan_depth,
            unit: normalizeScanUnit(bookSettings.scan_depth_unit)
        };
    }
    return { depth: globalDepth, unit: 'chapters' };
}

function diagnosticRecord(status, reason, entry, depth, details = {}) {
    return {
        status,
        reason,
        depth,
        placement: normalizePlacement(entry.position),
        evaluated_at: new Date().toISOString(),
        ...details
    };
}

async function withLoreDb(tools, filePath, work) {
    try {
        const db = await getSharedLoreDb(tools, filePath);
        return await work(db);
    } catch (err) {
        // If a shared connection fails due to being closed or corrupted, 
        // clear it from cache to allow recovery on next attempt.
        if (err.message?.includes('closed') || err.message?.includes('database is closed')) {
            loreDbConnections.delete(path.resolve(filePath));
        }
        throw err;
    }
}

function buildPromptBlock(tools, entries) {
    if (!entries.length) return null;

    const body = entries
        .map((entry) => {
            return entry.include_name_in_prompt
                ? `**${entry.name}**: ${entry.content}`
                : entry.content;
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
    version: '2.2.0',
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
            content: 'Uses a multi-pass keyword scanner with primary and secondary conditions, exact chapter or message scan scopes, per-book limits beneath the global safety budget, explainable activation diagnostics, and Fablekin-native shared or agent-specific prompt placement.'
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

        HOOK_FILE_WILL_DELETE: {
            run: async (_turnContext, tools, { filePath }) => {
                if (!filePath) return;
                if (await closeSharedLoreDb(filePath)) {
                    tools.logger.log('Lore Book', `Released DB handle before deleting ${path.basename(filePath)}`);
                }
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
                const bookStates = new Map();
                const diagnosticsByFile = new Map();
                const allEntries = [];
                for (const file of loreFiles) {
                    const payload = await withLoreDb(tools, file.path, async (db) => ({
                        rows: await db.query('SELECT * FROM lore_entries WHERE enabled = 1'),
                        settings: await readBookSettings(db)
                    }));
                    const state = {
                        settings: payload.settings,
                        remainingTokens: payload.settings.token_budget ?? Number.POSITIVE_INFINITY
                    };
                    bookStates.set(file.path, state);
                    diagnosticsByFile.set(file.path, {
                        evaluatedAt: new Date().toISOString(),
                        chapter: turnContext.turnNumber,
                        entries: {}
                    });
                    payload.rows.forEach((row) => {
                        allEntries.push({
                            ...deserializeEntry(row),
                            _sourcePath: file.path,
                            _bookSettings: state.settings
                        });
                    });
                }

                allEntries.sort((a, b) =>
                    Number(b.constant) - Number(a.constant) ||
                    b.priority - a.priority ||
                    a.name.localeCompare(b.name)
                );
                const requiredHistoryTurns = allEntries.reduce((maximum, entry) => {
                    const scope = resolveEntryScope(entry, entry._bookSettings, defaultScanDepth);
                    return Math.max(maximum, scope.depth);
                }, defaultScanDepth);
                const contextCatalog = await buildContextCatalog(turns, currentInput, requiredHistoryTurns);

                const injected = new Set();
                const triggeredEntries = [];
                const hitUpdates = [];
                const recursiveContent = [];
                const placementGroups = new Map();
                let tokenBudget = maxTokens;
                let deepestInjectedDepth = -1;

                let checkedTotal = 0;
                let budgetSkipped = 0;
                let constantCount = 0;
                let matchCount = 0;
                const matchNames = [];
                const diagnosticRank = {
                    recursion_disabled: 10,
                    recursion_excluded: 10,
                    recursion_delayed: 10,
                    not_matched: 20,
                    secondary_failed: 30,
                    budget_skipped: 60,
                    probability_skipped: 70,
                    injected: 100
                };
                const recordDiagnostic = (entry, record) => {
                    const snapshot = diagnosticsByFile.get(entry._sourcePath);
                    if (!snapshot) return;
                    const key = String(entry.id);
                    const existing = snapshot.entries[key];
                    if (!existing || (diagnosticRank[record.status] || 0) >= (diagnosticRank[existing.status] || 0)) {
                        snapshot.entries[key] = record;
                    }
                };

                for (let depth = 0; depth <= maxRecursiveDepth; depth++) {
                    let anyNew = false;

                    for (const entry of allEntries) {
                        const key = `${entry._sourcePath}:${entry.id}`;
                        if (injected.has(key)) continue;
                        const bookState = bookStates.get(entry._sourcePath);
                        if (depth > 0 && !bookState.settings.recursive_scanning) {
                            recordDiagnostic(entry, diagnosticRecord('recursion_disabled', 'This lorebook has recursive scanning disabled.', entry, depth));
                            continue;
                        }
                        if (depth > 0 && entry.exclude_recursion) {
                            recordDiagnostic(entry, diagnosticRecord('recursion_excluded', 'This entry cannot be activated by recursive lore.', entry, depth));
                            continue;
                        }
                        if (entry.delay_until_recursion > depth) {
                            recordDiagnostic(entry, diagnosticRecord('recursion_delayed', `Waiting until recursion depth ${entry.delay_until_recursion}.`, entry, depth));
                            continue;
                        }

                        const scope = resolveEntryScope(entry, bookState.settings, defaultScanDepth);
                        const baseContext = contextForScope(contextCatalog, scope.depth, scope.unit);
                        const entrySearchContext = [baseContext, ...recursiveContent].filter(Boolean).join('\n\n').trim();
                        const evaluation = entry.constant
                            ? { matched: true, reason: 'constant_entry', primaryMatches: [], secondaryMatches: [], secondaryMissing: [] }
                            : evaluateEntryKeywords(entry, entrySearchContext);
                        checkedTotal++;

                        if (!evaluation.matched) {
                            recordDiagnostic(entry, diagnosticRecord(
                                evaluation.reason === 'secondary_condition_failed' ? 'secondary_failed' : 'not_matched',
                                evaluation.reason === 'secondary_condition_failed'
                                    ? 'Primary keywords matched, but the secondary condition failed.'
                                    : 'No primary keyword matched the scanned context.',
                                entry,
                                depth,
                                {
                                    scan_depth: scope.depth,
                                    scan_unit: scope.unit,
                                    primary_matches: evaluation.primaryMatches,
                                    secondary_matches: evaluation.secondaryMatches,
                                    secondary_missing: evaluation.secondaryMissing
                                }
                            ));
                            continue;
                        }

                        const entryTokens = estimateTokens(entry.content);
                        const exceedsGlobalBudget = entryTokens > tokenBudget;
                        const exceedsBookBudget = entryTokens > bookState.remainingTokens;
                        if (!entry.ignore_budget && (exceedsGlobalBudget || exceedsBookBudget)) {
                            budgetSkipped++;
                            const budgetName = exceedsGlobalBudget && exceedsBookBudget
                                ? 'global and per-book budgets'
                                : (exceedsGlobalBudget ? 'global budget' : 'per-book budget');
                            recordDiagnostic(entry, diagnosticRecord(
                                'budget_skipped',
                                `Matched, but ${entryTokens} tokens exceeded the remaining ${budgetName}.`,
                                entry,
                                depth,
                                {
                                    primary_matches: evaluation.primaryMatches,
                                    secondary_matches: evaluation.secondaryMatches,
                                    entry_tokens: entryTokens,
                                    global_tokens_remaining: tokenBudget,
                                    book_tokens_remaining: Number.isFinite(bookState.remainingTokens) ? bookState.remainingTokens : null
                                }
                            ));
                            continue;
                        }

                        if (entry.use_probability && entry.probability < 100) {
                            injected.add(key);
                            if ((Math.random() * 100) >= entry.probability) {
                                recordDiagnostic(entry, diagnosticRecord(
                                    'probability_skipped',
                                    `Matched, but failed its ${entry.probability}% activation roll.`,
                                    entry,
                                    depth,
                                    { primary_matches: evaluation.primaryMatches, secondary_matches: evaluation.secondaryMatches }
                                ));
                                continue;
                            }
                        }

                        injected.add(key);
                        deepestInjectedDepth = Math.max(deepestInjectedDepth, depth);

                        if (entry.constant) {
                            constantCount++;
                        } else {
                            matchCount++;
                            matchNames.push(entry.name);
                        }

                        triggeredEntries.push(entry);
                        const placement = normalizePlacement(entry.position);
                        if (!placementGroups.has(placement)) placementGroups.set(placement, []);
                        placementGroups.get(placement).push(entry);
                        hitUpdates.push({ sourcePath: entry._sourcePath, id: entry.id });
                        if (!entry.ignore_budget) {
                            tokenBudget -= entryTokens;
                            if (Number.isFinite(bookState.remainingTokens)) bookState.remainingTokens -= entryTokens;
                        }
                        recordDiagnostic(entry, diagnosticRecord(
                            'injected',
                            depth > 0 ? `Activated by recursive lore at depth ${depth}.` : 'Activated from the scanned narrative context.',
                            entry,
                            depth,
                            {
                                primary_matches: evaluation.primaryMatches,
                                secondary_matches: evaluation.secondaryMatches,
                                scan_depth: scope.depth,
                                scan_unit: scope.unit,
                                entry_tokens: entryTokens,
                                ignored_budget: entry.ignore_budget
                            }
                        ));
                        anyNew = true;

                        if (depth < maxRecursiveDepth && !entry.prevent_recursion && bookState.settings.recursive_scanning) {
                            recursiveContent.push(entry.content);
                        }
                    }

                    if (!anyNew) break;
                }

                const placementTargets = {
                    shared_dynamic: ['dynamic_knowledge', 'root'],
                    shared_canon: ['canon', 'root'],
                    writer_dynamic: ['dynamic_knowledge', 'writer'],
                    director_dynamic: ['dynamic_knowledge', 'director']
                };
                const placementPieces = {
                    shared_dynamic: 'lore_shared_dynamic',
                    shared_canon: 'lore_shared_canon',
                    writer_dynamic: 'lore_writer_dynamic',
                    director_dynamic: 'lore_director_dynamic'
                };
                for (const [placement, entries] of placementGroups) {
                    const loreBlock = buildPromptBlock(tools, entries);
                    if (loreBlock) tools.prompt.contribute(placementPieces[placement] || 'lore_shared_dynamic', { entries: loreBlock });
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

                setImmediate(async () => {
                    const idsByFile = {};
                    for (const { sourcePath, id } of hitUpdates) {
                        if (!idsByFile[sourcePath]) idsByFile[sourcePath] = [];
                        idsByFile[sourcePath].push(id);
                    }

                    for (const [sourcePath, snapshot] of diagnosticsByFile) {
                        try {
                            await withLoreDb(tools, sourcePath, async (db) => {
                                for (const id of idsByFile[sourcePath] || []) {
                                    await db.execute(
                                        'UPDATE lore_entries SET hit_count = hit_count + 1 WHERE id = ?',
                                        [id]
                                    );
                                }
                                await writeLoreSetting(db, 'last_activation_diagnostics', snapshot);
                            });
                            tools.socket.emit('lore-book:diagnostics-updated', {
                                filePath: sourcePath,
                                diagnostics: snapshot
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
                const payload = await withLoreDb(tools, filePath, async (db) => {
                    const [rows, settings, diagnostics] = await Promise.all([
                        db.query('SELECT * FROM lore_entries ORDER BY constant DESC, priority DESC, name ASC'),
                        readBookSettings(db),
                        readLoreSetting(db, 'last_activation_diagnostics', null)
                    ]);
                    const diagnosticEntries = diagnostics?.entries || {};
                    return {
                        settings,
                        diagnostics,
                        entries: rows.map((row) => ({
                            ...deserializeEntry(row),
                            last_diagnostic: diagnosticEntries[String(row.id)] || null
                        }))
                    };
                });

                tools.socket.emit('lore-book:loaded', {
                    filePath,
                    ...payload
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
                                secondary_keywords = ?,
                                content = ?,
                                priority = ?,
                                enabled = ?,
                                constant = ?,
                                position = ?,
                                category = ?,
                                case_sensitive = ?,
                                use_regex = ?,
                                match_whole_word = ?,
                                scan_depth = ?,
                                scan_depth_unit = ?,
                                comment = ?,
                                selective = ?,
                                selective_logic = ?,
                                probability = ?,
                                use_probability = ?,
                                exclude_recursion = ?,
                                prevent_recursion = ?,
                                delay_until_recursion = ?,
                                ignore_budget = ?,
                                include_name_in_prompt = ?,
                                updated_at = datetime('now')
                            WHERE id = ?
                        `, [
                            serialized.name,
                            serialized.keywords,
                            serialized.secondary_keywords,
                            serialized.content,
                            serialized.priority,
                            serialized.enabled,
                            serialized.constant,
                            serialized.position,
                            serialized.category,
                            serialized.case_sensitive,
                            serialized.use_regex,
                            serialized.match_whole_word,
                            serialized.scan_depth,
                            serialized.scan_depth_unit,
                            serialized.comment,
                            serialized.selective,
                            serialized.selective_logic,
                            serialized.probability,
                            serialized.use_probability,
                            serialized.exclude_recursion,
                            serialized.prevent_recursion,
                            serialized.delay_until_recursion,
                            serialized.ignore_budget,
                            serialized.include_name_in_prompt,
                            serialized.id
                        ]);

                        const updated = await db.get('SELECT * FROM lore_entries WHERE id = ?', [serialized.id]);
                        if (!updated) throw new Error('Lore entry could not be saved.');
                        return { isNew: false, entry: deserializeEntry(updated) };
                    }

                    const result = await db.execute(`
                        INSERT INTO lore_entries
                            (name, keywords, secondary_keywords, content, priority, enabled, constant,
                             position, category, case_sensitive, use_regex, match_whole_word, scan_depth,
                             scan_depth_unit, comment, selective, selective_logic, probability,
                             use_probability, exclude_recursion, prevent_recursion, delay_until_recursion,
                             ignore_budget, include_name_in_prompt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        serialized.name,
                        serialized.keywords,
                        serialized.secondary_keywords,
                        serialized.content,
                        serialized.priority,
                        serialized.enabled,
                        serialized.constant,
                        serialized.position,
                        serialized.category,
                        serialized.case_sensitive,
                        serialized.use_regex,
                        serialized.match_whole_word,
                        serialized.scan_depth,
                        serialized.scan_depth_unit,
                        serialized.comment,
                        serialized.selective,
                        serialized.selective_logic,
                        serialized.probability,
                        serialized.use_probability,
                        serialized.exclude_recursion,
                        serialized.prevent_recursion,
                        serialized.delay_until_recursion,
                        serialized.ignore_budget,
                        serialized.include_name_in_prompt
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
                const payload = await withLoreDb(tools, filePath, async (db) => ({
                    rows: await db.query('SELECT * FROM lore_entries ORDER BY constant DESC, priority DESC, name ASC'),
                    settings: await readBookSettings(db)
                }));

                tools.socket.emit('lore-book:exported', {
                    filePath,
                    data: {
                        version: '2.2',
                        exported: new Date().toISOString(),
                        book: path.basename(filePath),
                        settings: payload.settings,
                        entries: payload.rows.map(deserializeEntry)
                    }
                });
            } catch (error) {
                tools.socket.emit('lore-book:error', { message: error.message });
            }
        },

        'lore-book:analyze-import': async ({ filePath, importData }, tools) => {
            try {
                const report = analyzeImport(importData);
                tools.socket.emit('lore-book:import-analysis', { filePath, report });
            } catch (error) {
                tools.socket.emit('lore-book:import-analysis', {
                    filePath,
                    error: error.message || 'The selected file could not be analyzed.'
                });
            }
        },

        'lore-book:save-settings': async ({ filePath, settings }, tools) => {
            try {
                const normalized = normalizeBookSettings(settings);
                await withLoreDb(tools, filePath, (db) => writeLoreSetting(db, 'book_settings', normalized));
                tools.socket.emit('lore-book:settings-saved', { filePath, settings: normalized });
            } catch (error) {
                tools.socket.emit('lore-book:error', { message: error.message });
            }
        },

        'lore-book:import': async ({ filePath, importData, mode, applySourceSettings = false }, tools) => {
            try {
                const normalized = normalizeImport(importData);
                const entries = normalized.entries;
                const hasRecommendedSettings = Object.keys(normalized.report.recommendedSettings || {}).length > 0;
                const appliedSourceSettings = !!applySourceSettings && hasRecommendedSettings;
                const resultReport = { ...normalized.report, appliedSourceSettings };
                tools.logger.log(
                    'Lore Book',
                    `Socket import request for ${path.basename(filePath || '')}: ${normalized.report.sourceEntries} source entries, ${entries.length} importable (${mode})`
                );
                const payload = await withLoreDb(tools, filePath, async (db) => {
                    if (entries.length === 0) {
                        return {
                            rows: await db.query('SELECT * FROM lore_entries ORDER BY constant DESC, priority DESC, name ASC'),
                            settings: await readBookSettings(db)
                        };
                    }

                    await db.exec('BEGIN IMMEDIATE TRANSACTION');
                    try {
                        if (mode === 'replace') {
                            await db.execute('DELETE FROM lore_entries');
                        }

                        for (const entry of entries) {
                            const serialized = serializeEntry(entry);
                            await db.execute(`
                                INSERT INTO lore_entries
                                    (name, keywords, secondary_keywords, content, priority, enabled, constant,
                                     position, category, case_sensitive, use_regex, match_whole_word, scan_depth, comment,
                                     scan_depth_unit,
                                     selective, selective_logic, probability, use_probability,
                                     exclude_recursion, prevent_recursion, delay_until_recursion, ignore_budget,
                                     include_name_in_prompt, source_format, source_uid, source_payload, import_warnings)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `, [
                                serialized.name,
                                serialized.keywords,
                                serialized.secondary_keywords,
                                serialized.content,
                                serialized.priority,
                                serialized.enabled,
                                serialized.constant,
                                serialized.position,
                                serialized.category,
                                serialized.case_sensitive,
                                serialized.use_regex,
                                serialized.match_whole_word,
                                serialized.scan_depth,
                                serialized.comment,
                                serialized.scan_depth_unit,
                                serialized.selective,
                                serialized.selective_logic,
                                serialized.probability,
                                serialized.use_probability,
                                serialized.exclude_recursion,
                                serialized.prevent_recursion,
                                serialized.delay_until_recursion,
                                serialized.ignore_budget,
                                serialized.include_name_in_prompt,
                                serialized.source_format,
                                serialized.source_uid,
                                serialized.source_payload,
                                serialized.import_warnings
                            ]);
                        }

                        if (appliedSourceSettings) {
                            const currentSettings = await readBookSettings(db);
                            await writeLoreSetting(db, 'book_settings', normalizeBookSettings({
                                ...currentSettings,
                                ...normalized.report.recommendedSettings
                            }));
                        }
                        await writeLoreSetting(db, 'last_import', {
                            importedAt: new Date().toISOString(),
                            bookMetadata: normalized.bookMetadata,
                            report: resultReport
                        });
                        await db.exec('COMMIT');
                    } catch (error) {
                        try { await db.exec('ROLLBACK'); } catch { }
                        throw error;
                    }

                    return {
                        rows: await db.query('SELECT * FROM lore_entries ORDER BY constant DESC, priority DESC, name ASC'),
                        settings: await readBookSettings(db)
                    };
                });

                tools.socket.emit('lore-book:loaded', {
                    filePath,
                    entries: payload.rows.map(deserializeEntry),
                    settings: payload.settings,
                    diagnostics: null
                });
                tools.socket.emit('lore-book:imported', {
                    filePath,
                    mode,
                    report: resultReport,
                    settings: payload.settings
                });
                tools.status.showTemporary(`Imported ${entries.length} of ${normalized.report.sourceEntries} entries (${mode})`, 3000, '#00e5ff');
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

module.exports.__test = {
    buildContextCatalog,
    contextForScope,
    evaluateEntryKeywords,
    normalizeBookSettings,
    normalizePlacement,
    resolveEntryScope,
};

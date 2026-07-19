'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const plugin = require('./index');
const { normalizeImport } = require('./import_adapter');
const runtime = plugin.__test;

function sampleBook() {
    return {
        name: 'Compatibility Test',
        scan_depth: 5,
        token_budget: 1200,
        recursive_scanning: false,
        entries: {
            0: {
                uid: 0,
                key: ['Gojo'],
                keysecondary: ['teacher'],
                selective: true,
                selectiveLogic: 0,
                content: 'Gojo is a teacher.',
                order: 10,
                position: 0,
                excludeRecursion: true,
                characterFilter: { isExclude: false, names: [], tags: [] }
            },
            1: {
                uid: 1,
                key: ['event'],
                content: 'A grouped event.',
                order: 10,
                position: 0,
                group: 'random-events'
            },
            2: {
                uid: 2,
                key: ['empty'],
                content: ''
            }
        }
    };
}

test('normalizes UID-keyed SillyTavern entries without aborting on unknown rules', () => {
    const result = normalizeImport(sampleBook());
    assert.equal(result.report.sourceEntries, 3);
    assert.equal(result.report.importedEntries, 2);
    assert.equal(result.report.skippedEntries, 1);
    assert.equal(result.report.disabledEntries, 1);
    assert.equal(result.entries[0].scan_depth, null);
    assert.equal(result.entries[0].scan_depth_unit, 'messages');
    assert.deepEqual(result.report.recommendedSettings, {
        default_scan_depth: 5,
        scan_depth_unit: 'messages',
        token_budget: 1200,
        recursive_scanning: false
    });
    assert.deepEqual(result.entries[0].secondary_keywords, ['teacher']);
    assert.equal(result.entries[0].prevent_recursion, false);
    assert.equal(result.entries[0].include_name_in_prompt, false);
    assert.equal(result.entries[0].position, 'shared_dynamic');
    assert.equal(result.entries[1].enabled, false);
    assert.ok(result.report.warnings.some((warning) => warning.code === 'unsafe_rules_disabled'));
    assert.ok(result.report.warnings.some((warning) =>
        warning.code === 'position_0_mapped' && warning.severity === 'info'
    ));
    assert.equal(result.report.warnings.some((warning) => warning.code === 'scan_depth_approximated'), false);
});

test('imports normalized entries transactionally into a new lore database', async () => {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '.test-lore-import-'));
    const dbPath = path.join(tempDir, 'test.db');
    let rawDb;
    const events = [];
    const tools = {
        db: {
            open: async (filename) => {
                rawDb = await open({ filename, driver: sqlite3.Database });
                return {
                    execute: (sql, params = []) => rawDb.run(sql, params),
                    query: (sql, params = []) => rawDb.all(sql, params),
                    get: (sql, params = []) => rawDb.get(sql, params),
                    exec: (sql) => rawDb.exec(sql),
                    close: () => rawDb.close()
                };
            }
        },
        logger: { log: () => {} },
        socket: { emit: (name, payload) => events.push({ name, payload }) },
        status: { showTemporary: () => {} }
    };

    try {
        await plugin.socketListeners['lore-book:import']({
            filePath: dbPath,
            importData: sampleBook(),
            mode: 'replace',
            applySourceSettings: true
        }, tools);

        const errorEvent = events.find((event) => event.name === 'lore-book:error');
        assert.equal(errorEvent, undefined);
        const counts = await rawDb.get(`
            SELECT COUNT(*) AS total,
                   SUM(selective) AS selective,
                   SUM(enabled) AS enabled,
                   SUM(prevent_recursion) AS prevented
            FROM lore_entries
        `);
        assert.deepEqual(counts, { total: 2, selective: 1, enabled: 1, prevented: 0 });

        const secondary = await rawDb.get(
            'SELECT secondary_keywords FROM lore_entries WHERE source_uid = ?',
            ['0']
        );
        assert.equal(secondary.secondary_keywords, '["teacher"]');
        const settingsRow = await rawDb.get('SELECT value FROM lore_settings WHERE key = ?', ['book_settings']);
        assert.deepEqual(JSON.parse(settingsRow.value), {
            token_budget: 1200,
            default_scan_depth: 5,
            scan_depth_unit: 'messages',
            recursive_scanning: false
        });
        assert.ok(events.some((event) => event.name === 'lore-book:imported'));
    } finally {
        if (rawDb) await rawDb.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('message scan depth counts historical user and narrative messages independently', async () => {
    const turns = [
        {
            input: { userPrompt: 'user one' },
            output: { fulltext: 'narrative one' },
            processed: {},
            ensureFull: async () => {}
        },
        {
            input: { userPrompt: 'user two' },
            output: { fulltext: 'narrative two' },
            processed: {},
            ensureFull: async () => {}
        }
    ];
    const catalog = await runtime.buildContextCatalog(turns, 'current user');
    assert.equal(
        runtime.contextForScope(catalog, 3, 'messages'),
        'user two\n\nnarrative two\n\ncurrent user'
    );
    assert.equal(
        runtime.contextForScope(catalog, 1, 'chapters'),
        'user two\n\nnarrative two\n\ncurrent user'
    );
});

test('advanced secondary logic reports why an entry passed or failed', () => {
    const entry = {
        keywords: ['Gojo'],
        secondary_keywords: ['teacher', 'strongest'],
        selective: true,
        selective_logic: 1,
        case_sensitive: false,
        use_regex: false,
        match_whole_word: false
    };
    const passed = runtime.evaluateEntryKeywords(entry, 'Gojo is a teacher.');
    assert.equal(passed.matched, true);
    assert.deepEqual(passed.primaryMatches, ['Gojo']);
    assert.deepEqual(passed.secondaryMatches, ['teacher']);

    const failed = runtime.evaluateEntryKeywords(entry, 'Gojo is the strongest teacher.');
    assert.equal(failed.matched, false);
    assert.equal(failed.reason, 'secondary_condition_failed');
});

test('runtime applies per-book settings, injects placement, and persists activation diagnostics', async () => {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '.test-lore-runtime-'));
    const dbPath = path.join(tempDir, 'runtime.db');
    let rawDb;
    const emitted = [];
    const injections = [];
    const tools = {
        db: {
            open: async (filename) => {
                rawDb = await open({ filename, driver: sqlite3.Database });
                return {
                    execute: (sql, params = []) => rawDb.run(sql, params),
                    query: (sql, params = []) => rawDb.all(sql, params),
                    get: (sql, params = []) => rawDb.get(sql, params),
                    exec: (sql) => rawDb.exec(sql),
                    close: () => rawDb.close()
                };
            }
        },
        logger: { log: () => {} },
        socket: { emit: (name, payload) => emitted.push({ name, payload }) },
        status: { showTemporary: () => {} },
        settings: { getSelf: () => ({ max_tokens: 2000, max_recursive_depth: 2, default_scan_depth: 3 }) },
        prompt: {
            wrap: (tag, content) => `<${tag}>${content}</${tag}>`,
            inject: (slot, content, target) => injections.push({ slot, content, target })
        }
    };

    try {
        await plugin.socketListeners['lore-book:import']({
            filePath: dbPath,
            importData: sampleBook(),
            mode: 'replace',
            applySourceSettings: true
        }, tools);

        const historyTurn = {
            turnNumber: 1,
            input: { userPrompt: 'Ask the teacher for help.' },
            output: { fulltext: 'The classroom grows quiet.' },
            processed: {},
            ensureFull: async () => {}
        };
        const turnContext = {
            turnNumber: 2,
            input: {
                userPrompt: 'Gojo enters.',
                selectedFiles: [{ mode: 'lore_entry', path: dbPath }]
            },
            retrieveDatedChapters: async () => ({ fullchapters: [historyTurn] })
        };

        await plugin.hooks.HOOK_POST_PROMPT_BUILDER.run(turnContext, tools);
        assert.equal(injections.length, 1);
        assert.equal(injections[0].slot, 'dynamic_knowledge');
        assert.equal(injections[0].target, 'root');
        assert.match(injections[0].content, /Gojo is a teacher/);

        await new Promise((resolve) => setTimeout(resolve, 25));
        const diagnosticRow = await rawDb.get(
            'SELECT value FROM lore_settings WHERE key = ?',
            ['last_activation_diagnostics']
        );
        const diagnostics = JSON.parse(diagnosticRow.value);
        const gojo = Object.values(diagnostics.entries).find((entry) =>
            entry.primary_matches?.includes('Gojo')
        );
        assert.equal(gojo.status, 'injected');
        assert.deepEqual(gojo.secondary_matches, ['teacher']);
        assert.equal(gojo.scan_unit, 'messages');
    } finally {
        if (rawDb) await rawDb.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('opens an existing v2.0 lore database with additive schema migration', async () => {
    const tempDir = fs.mkdtempSync(path.join(__dirname, '.test-old-schema-'));
    const dbPath = path.join(tempDir, 'old.db');
    let rawDb = await open({ filename: dbPath, driver: sqlite3.Database });
    const events = [];

    try {
        await rawDb.exec(`
            CREATE TABLE lore_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL DEFAULT 'New Entry',
                keywords TEXT NOT NULL DEFAULT '[]',
                content TEXT NOT NULL DEFAULT '',
                priority INTEGER NOT NULL DEFAULT 50,
                enabled INTEGER NOT NULL DEFAULT 1,
                constant INTEGER NOT NULL DEFAULT 0,
                position TEXT NOT NULL DEFAULT 'after_system',
                category TEXT DEFAULT 'General',
                case_sensitive INTEGER NOT NULL DEFAULT 0,
                use_regex INTEGER NOT NULL DEFAULT 0,
                match_whole_word INTEGER NOT NULL DEFAULT 0,
                scan_depth INTEGER DEFAULT NULL,
                comment TEXT DEFAULT '',
                hit_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT,
                updated_at TEXT
            );
            CREATE TABLE lore_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        `);
        await rawDb.close();
        rawDb = null;

        const tools = {
            db: {
                open: async (filename) => {
                    rawDb = await open({ filename, driver: sqlite3.Database });
                    return {
                        execute: (sql, params = []) => rawDb.run(sql, params),
                        query: (sql, params = []) => rawDb.all(sql, params),
                        get: (sql, params = []) => rawDb.get(sql, params),
                        exec: (sql) => rawDb.exec(sql),
                        close: () => rawDb.close()
                    };
                }
            },
            logger: { log: () => {} },
            socket: { emit: (name, payload) => events.push({ name, payload }) }
        };

        await plugin.socketListeners['lore-book:load']({ filePath: dbPath }, tools);
        assert.equal(events.some((event) => event.name === 'lore-book:error'), false);
        const columns = (await rawDb.all('PRAGMA table_info(lore_entries)')).map((column) => column.name);
        assert.ok(columns.includes('secondary_keywords'));
        assert.ok(columns.includes('scan_depth_unit'));
        assert.ok(columns.includes('source_format'));
    } finally {
        if (rawDb) await rawDb.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

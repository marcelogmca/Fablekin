const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function load(id) {
    return require(path.join(__dirname, id, 'index.js'));
}

test('settings example reads defaults and demonstrates set and update', async () => {
    const plugin = load('example_plugin_settings');
    const current = Object.fromEntries(
        Object.entries(plugin.settingsSchema).map(([key, field]) => [key, field.default])
    );
    const calls = [];
    const emitted = [];
    const tools = {
        settings: {
            getSelf: () => ({ ...current }),
            set: async (key, value) => { calls.push(['set', key, value]); current[key] = value; },
            update: async value => { calls.push(['update', value]); Object.assign(current, value); }
        },
        logger: { log() {} },
        socket: { emit: (event, value) => emitted.push([event, value]) }
    };

    await plugin.hooks.HOOK_SYSTEM_BOOT.run({}, tools);
    await plugin.socketListeners['example_plugin_settings:write'](
        { action: 'set_name', value: 'Ada' },
        tools
    );
    await plugin.socketListeners['example_plugin_settings:write']({ action: 'reset' }, tools);

    assert.deepEqual(calls[0], ['set', 'user_name', 'Ada']);
    assert.equal(calls[1][0], 'update');
    assert.equal(emitted.every(([, value]) => value.success), true);
});

test('terminal example validates arguments and bounds its query', async () => {
    const plugin = load('example_terminal_commands');
    assert.equal(await plugin.terminalCommands['/example-ping'].run([]), 'Pong!');
    assert.equal(
        await plugin.terminalCommands['/example-recent-turns'].run(['9'], {}),
        'Usage: /example-recent-turns [1-5]'
    );
    let query;
    const reply = await plugin.terminalCommands['/example-recent-turns'].run(['2'], {
        db: { chat: { query: async (...args) => {
            query = args;
            return [{ chapter_number: 8 }, { chapter_number: 7 }];
        } } }
    });
    assert.deepEqual(query[1], [2]);
    assert.equal(reply, 'Recent chapters: 8, 7');
});

test('custom file example registers a mode and ignores malformed files', async () => {
    const plugin = load('example_custom_file_type');
    const modes = [];
    const injections = [];
    const tools = {
        project: {
            registerFileMode: (id, config) => modes.push([id, config]),
            getSelectedFiles: async () => [
                { mode: 'example_item', path: 'valid.json', name: 'Valid' },
                { mode: 'example_item', path: 'broken.json', name: 'Broken' },
                { mode: 'other', path: 'ignored.json' }
            ],
            readFile: async file => file === 'valid.json'
                ? JSON.stringify({ title: 'Elixir', quantity: 2, category: 'Potion', is_rare: true })
                : '{bad'
        },
        prompt: {
            wrap: (_id, value) => value,
            inject: (...args) => injections.push(args)
        },
        logger: { warn() {} }
    };
    await plugin.hooks.HOOK_PROJECT_LOADED.run({}, tools);
    await plugin.hooks.HOOK_PRE_PROMPT_BUILDER.run({}, tools);
    assert.equal(modes[0][0], 'example_item');
    assert.equal(modes[0][1].viewer, true);
    assert.equal(injections.length, 1);
    assert.match(injections[0][1], /2 rare Elixir/);
});

test('custom file example renders escaped content and handles malformed views', async () => {
    const plugin = load('example_custom_file_type');
    const warnings = [];
    const tools = {
        project: {
            readFile: async file => file === 'valid.json'
                ? JSON.stringify({ title: '<script>bad()</script>', quantity: 2, category: 'Potion', is_rare: true })
                : '{bad'
        },
        logger: { warn: message => warnings.push(message) }
    };
    const rendered = await plugin.exports.provideFileView({}, tools, {
        modeId: 'example_item',
        filePath: 'valid.json'
    });
    const malformed = await plugin.exports.provideFileView({}, tools, {
        modeId: 'example_item',
        filePath: 'broken.json'
    });
    assert.equal(rendered.type, 'html');
    assert.match(rendered.content, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(rendered.content, /<script>/);
    assert.equal(malformed.type, 'text');
    assert.match(malformed.content, /malformed/i);
    assert.equal(warnings.length, 1);
});

test('director example registers a capability and incorporates directives and feedback', async () => {
    const plugin = load('example_director_integration');
    const capabilities = [];
    const notes = [];
    await plugin.hooks.HOOK_DIRECTOR_PRE_PROMPT.run({}, {
        directives: { getFormatted: () => 'Favor quiet discoveries.' },
        director: {
            getFeedback: async () => 'Keep the handoff shorter.',
            registerCapability: value => capabilities.push(value),
            cot: { add: value => notes.push(value) }
        }
    });
    assert.equal(capabilities[0].phase, 'EXAMPLE_DISCOVERY');
    assert.match(notes[0].content, /Favor quiet discoveries/);
    assert.match(notes[0].content, /Keep the handoff shorter/);
});

test('background job example reports progress and handles the requested failure', async () => {
    const plugin = load('example_background_job');
    const progress = [];
    let options;
    const tools = {
        jobs: {
            withJob: async (_name, jobOptions, work) => {
                options = jobOptions;
                const job = {
                    progress: (...args) => progress.push(args),
                    throwIfCancelled() {}
                };
                try {
                    return await work(job);
                } catch (error) {
                    if (jobOptions.rethrow === false) return jobOptions.errorValue;
                    throw error;
                }
            }
        }
    };
    assert.equal(
        await plugin.terminalCommands['/example-job'].run([], tools),
        'The example job completed successfully.'
    );
    assert.equal(
        await plugin.terminalCommands['/example-job'].run(['fail'], tools),
        'The requested example failure was handled.'
    );
    assert.equal(options.scope, 'turn');
    assert.equal(options.rethrow, false);
    assert.ok(progress.some(([value]) => value === 100));
});

test('VN frontend injection loads assets, responds over its namespace, and declares cleanup', async () => {
    const plugin = load('example_vn_frontend_injection');
    const descriptor = await plugin.hooks.HOOK_FRONTEND_INJECTION.run({}, {
        logger: { error() {} }
    });
    assert.equal(descriptor.id, 'example_vn_frontend_injection');
    assert.match(descriptor.html, /example_vn_frontend_injection/);
    assert.match(descriptor.js, /runtime\.onSocket/);
    assert.match(descriptor.js, /runtime\.onWindow/);
    assert.match(descriptor.js, /runtime\.onDispose/);

    const emitted = [];
    await plugin.socketListeners['example_vn_frontend_injection:get-status'](
        { dialogueIndex: 2 },
        {
            turnContext: { turnNumber: 7 },
            socket: { emit: (...args) => emitted.push(args) }
        }
    );
    assert.deepEqual(emitted[0], ['example_vn_frontend_injection:status', {
        success: true,
        message: 'Persistent VN injection is connected.',
        dialogueIndex: 2,
        turnNumber: 7
    }]);
});

test('documentation and custom view assets are registered and self-contained', () => {
    const docs = load('example_plugin_documentation');
    const view = load('example_custom_view');
    assert.ok(fs.existsSync(path.join(__dirname, docs.id, docs.documentation[0].path)));
    const html = fs.readFileSync(path.join(__dirname, view.id, view.views[0].entry), 'utf8');
    assert.match(html, /bridge\.request/);
    assert.match(html, /example_custom_view:get-status/);
});

test('the central SDK example catalog is discoverable by the documentation scanner', async () => {
    const { scanDocs } = require('../../modules/utils/doc_scanner');
    const docsRoot = path.resolve(__dirname, '../../views/docs/documents/core');
    const documents = await scanDocs(docsRoot, 'documents/core');
    const catalog = documents.find(document => document.path === 'documents/core/plugin_dev/examples.md');
    assert.equal(catalog.title, 'Plugin Example Catalog');
    assert.equal(catalog.category, 'Plugin Dev');
});

test('secret example reports status without exposing the secret', async () => {
    const plugin = load('example_secret_storage');
    const logs = [];
    await plugin.hooks.HOOK_SYSTEM_BOOT.run({}, {
        settings: { getSelf: () => ({ api_token: 'DO_NOT_LEAK', public_name: 'Ada' }) },
        logger: { log: (...args) => logs.push(args) }
    });
    const serialized = JSON.stringify(logs);
    assert.doesNotMatch(serialized, /DO_NOT_LEAK/);
    assert.match(serialized, /api_token_configured/);
});

test('plugin export validates input and consumer handles both outcomes', async () => {
    const api = load('example_plugin_api');
    const consumer = load('example_plugin_api_consumer');
    await assert.rejects(() => api.exports.formatGreeting({}, {}, ''), /non-empty/);
    assert.deepEqual(
        await api.exports.formatGreeting({}, {}, ' Ada ', { excited: true }),
        { text: 'Hello, Ada!', normalizedName: 'Ada' }
    );
    const command = consumer.terminalCommands['/example-greet'];
    assert.equal(await command.run(['Ada'], {
        plugins: { tryCall: async () => ({ text: 'Hello, Ada!' }) }
    }), 'Hello, Ada!');
    assert.equal(await command.run(['Ada'], {
        plugins: { tryCall: async (_id, _name, _args, options) =>
            options.fallback({ reason: 'missing_plugin' }) }
    }), 'Greeting provider is not enabled.');
});

test('prompt example makes an alias-only structured call and injects validation result', async () => {
    const plugin = load('example_prompt_llm');
    let request;
    const injections = [];
    await plugin.hooks.HOOK_POST_PROMPT_BUILDER.run(
        { input: { userPrompt: 'A quiet reunion.' } },
        {
            settings: { getSelf: () => ({ model_def: { model: 'lowendmodel' } }) },
            llm: { withSchema: async value => {
                request = value;
                return { content: { tone: 'calm', guidance: 'Use restrained dialogue.' } };
            } },
            prompt: {
                wrap: (_id, value) => value,
                inject: (...args) => injections.push(args)
            },
            logger: { warn() {} }
        }
    );
    assert.equal(request.model, 'lowendmodel');
    assert.equal(Object.hasOwn(request, 'provider'), false);
    assert.match(injections[0][1], /Tone: calm/);
});

test('state example isolates runtime, turn, and fact writes', async () => {
    const plugin = load('example_plugin_state');
    const runtime = {};
    const turn = {};
    const facts = [];
    const tools = {
        pluginState: {
            runtime: defaults => Object.assign(runtime, { ...defaults, ...runtime }),
            turn: defaults => Object.assign(turn, { ...defaults, ...turn })
        },
        facts: {
            cleanUpFactsDb: async value => facts.push(['clean', value]),
            appendToFactsDb: async value => facts.push(['append', value])
        }
    };
    await plugin.hooks.HOOK_TURN_START.run({ turnNumber: 4 }, tools);
    await plugin.hooks.HOOK_POST_DB_UPDATE.run({ turnNumber: 4 }, tools);
    assert.equal(runtime.executions, 1);
    assert.equal(turn.turnNumber, 4);
    assert.deepEqual(facts[0][1].predicates, ['example_execution_count']);
    assert.equal(facts[1][1].source, 'example_plugin_state');
});

test('state example exposes its scoped fact as a timeline card', async () => {
    const plugin = load('example_plugin_state');
    let query;
    const card = await plugin.timelineProviders[0].fn(
        { projectName: 'Demo', turnNumber: 4 },
        {
            db: { chat: { query: async (...args) => {
                query = args;
                return [{ fact_value: '1', context: 'Example state for turn 4' }];
            } } }
        }
    );
    assert.deepEqual(query[1], ['demo', 'example_plugin_state', 'example_execution_count', 4]);
    assert.equal(card.title, 'Example Plugin State');
    assert.equal(card.fields[0].value, '1');
});

test('VN event example emits canonical timed and line-scoped descriptors', async () => {
    const plugin = load('example_vn_client_events');
    const lines = Array.from({ length: 4 }, () => ({ type: 'dialogue' }));
    await plugin.hooks.HOOK_POST_DIALOGUE_PROCESSING.run(
        { processed: { dialogueProcessor: { processedLines: lines } } },
        {
            plugins: { tryCall: async () => '' },
            logger: { log() {} }
        }
    );
    const events = lines.flatMap(line => line.clientEvents || []);
    assert.ok(events.some(event => event.type === 'vfx:trigger'));
    assert.ok(events.some(event => event.type === 'vfx:start-rain' && event.payload.duration === 3000));
    assert.ok(events.some(event => event.type === 'vfx:state' && event.payload.duration === 3));
    assert.ok(events.some(event => event.type === 'vfx:clear'));
    assert.doesNotMatch(JSON.stringify(events), /stickyUntil/);
});

test('intercept examples register descriptors and expose cleanup-aware payloads', async () => {
    const pixi = load('example_pixi_intercept');
    const gui = load('example_vn_gui_intercept');
    const runtime = [];
    const persistent = [];
    const tools = {
        gui: {
            registerRuntimeIntercept: value => runtime.push(value),
            registerPersistentIntercept: value => persistent.push(value)
        }
    };
    await pixi.hooks.HOOK_GUI_GATEKEEPER.run({}, tools);
    await gui.hooks.HOOK_GUI_GATEKEEPER.run({}, tools);
    assert.ok(runtime.some(item => item.renderer === 'pixi'));
    assert.ok(runtime.some(item => item.interceptId === 'example_gui_chain_a'));
    assert.equal(persistent[0].interceptId, 'example_gui_persisted_banner');
    const payload = await gui.exports.guiIntercepts.example_gui_backend({}, {}, {});
    assert.match(payload.js, /lifecycle\.onDispose/);
    assert.match(payload.js, /socket\.off/);
});

test('GUI backend uses the selected alias and returns namespaced success and errors', async () => {
    const { runLlmTask, REPLY_EVENT } = require('./example_vn_gui_intercept/backend');
    const emitted = [];
    await runLlmTask({ requestId: 'one', prompt: 'Hi' }, {
        settings: { getSelf: () => ({
            model_def: { model: 'mediumendmodel' },
            retries: 2,
            timeout_ms: 4000
        }) },
        llm: { call: async (_messages, params) => {
            assert.equal(params.model, 'mediumendmodel');
            assert.equal(Object.hasOwn(params, 'provider'), false);
            return { content: 'Hello' };
        } },
        socket: { emit: (...args) => emitted.push(args) }
    });
    assert.deepEqual(emitted[0], [REPLY_EVENT, {
        requestId: 'one',
        ok: true,
        text: 'Hello'
    }]);
});

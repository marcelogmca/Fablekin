const assert = require('node:assert/strict');
const test = require('node:test');
const TurnContext = require('../../turncontext.js');
const { Prompt, PreparedPrompt } = require('../../prompt/prompt.js');
const { buildTools } = require('./tools_builder.js');
const { initializeVnBackgroundLlmContext, buildVnBackgroundPrompt } = require('../../vn_manager/background_llm_cache.js');
const { compilePluginRequest } = require('../../prompt/request_compiler.js');

function setup() {
    const manager = {
        plugins: new Map([['world_state_tracker', { id: 'world_state_tracker' }]]),
        disabledPlugins: new Map(),
        promptRegistry: new Map()
    };
    const context = new TurnContext('Test Story');
    const tools = buildTools(manager, 'world_state_tracker', context);
    return { manager, context, tools };
}

test('static promptPieces declarations are rejected before a plugin is registered', () => {
    const manager = require('../plugin_manager.js');
    const id = 'static_prompt_manifest_probe';
    assert.throws(() => manager.registerPlugin({
        id,
        promptPieces: { note: { target: 'root', slot: 'canon', label: 'Note', description: 'Old declaration.' } }
    }), /removed static promptPieces/);
    assert.equal(manager.plugins.has(id), false);
    assert.equal(manager.promptRegistry.has(id), false);
});

test('advanced composition cannot author another source or core piece', () => {
    const { tools } = setup();
    tools.prompt.contribute({ id: 'state', to: 'root.simulation', text: 'Clear skies.' });
    assert.throws(() => tools.prompt.compose('bad_request', draft => {
        draft.user(message => message.add('world_state_tracker.state', 'Rewritten state.'));
    }), /Use message.include\(id\)/);
    assert.throws(() => tools.prompt.compose('bad_core', draft => {
        draft.user(message => message.add('root.simulation', 'Rewritten simulation.'));
    }), /Use message.include\(id\)/);
    const included = tools.prompt.compose('good_request', draft => {
        draft.user(message => message.include('world_state_tracker.state'));
    });
    assert.equal(included.messages[0].content, 'Clear skies.');
});

test('one contribution defines its own registered hierarchy and renders with provenance', () => {
    const { manager, context, tools } = setup();
    assert.equal(tools.prompt.contribute({
        id: 'world_state_context', to: 'root.simulation', directable: true,
        label: 'World state context', description: 'Current world state.',
        children: {
            previous_turn_update: '<previous>Quiet.</previous>',
            current_state: { time: { date: 'Day 3' } }
        }
    }), true);
    const stored = context.promptComponents.root.simulation[0];
    assert.equal(stored.owner, 'world_state_tracker');
    assert.equal(stored.componentId, 'world_state_tracker.world_state_context');
    assert.deepEqual(stored.children.map(item => item.componentId), [
        'world_state_tracker.world_state_context.previous_turn_update',
        'world_state_tracker.world_state_context.current_state'
    ]);
    assert.equal(stored.children[1].children[0].children[0].text, 'Day 3');
    assert.equal(manager.promptRegistry.get('world_state_tracker').world_state_context.target, 'root');
    assert.equal(manager.promptRegistry.get('world_state_tracker').world_state_context.children[1].label, 'Current State');
    assert.ok(stored.sourceId && stored.children[1].children[0].sourceId);

    const prompt = new Prompt({ id: 'test.world_state', turnContext: context, pluginManager: manager });
    prompt.registerDynamicComponent('core.test_layout', {
        parent: 'root', label: 'Test layout', description: 'Layout containing a simulation contribution.', owner: 'core'
    });
    prompt.user(message => message.add('core.test_layout', layout => {
        layout.include(context, 'root', 'simulation', stored.sourceId);
    }));
    const prepared = prompt.prepare();
    assert.match(prepared.messages[0].content, /directable_plugin="world_state_tracker"/);
    assert.match(prepared.messages[0].content, /Day 3/);
    assert.ok(prepared.manifest.occurrences.some(item => item.componentId === 'world_state_tracker.world_state_context.current_state.time.date'));
});

test('contribution identity is scoped to the calling plugin', () => {
    const { manager, context, tools } = setup();
    tools.prompt.contribute({ id: 'state', to: 'root.simulation', text: 'Harbor.' });
    manager.plugins.set('observer', { id: 'observer' });
    const observer = buildTools(manager, 'observer', context);
    observer.prompt.contribute({ id: 'state', to: 'root.simulation', text: 'Observed harbor.' });
    assert.deepEqual(context.promptComponents.root.simulation.map(item => item.componentId), [
        'world_state_tracker.state', 'observer.state'
    ]);
    assert.equal(manager.promptRegistry.get('observer').state.target, 'root');
    assert.deepEqual(context.promptComponents.root.simulation.map(item => item.owner), ['world_state_tracker', 'observer']);
});

test('new children may appear on later turns; conflicts, invalid input and frozen root are atomic', () => {
    const { manager, context, tools } = setup();
    const contribute = children => tools.prompt.contribute({
        id: 'world_state_context', to: 'root.simulation', children
    });
    contribute({ previous_turn_update: 'Earlier', current_state: 'At dawn' });
    contribute({ previous_turn_update: 'Earlier', previous_inventory_disposal: 'Removed rope', current_state: 'At noon' });
    assert.deepEqual(context.promptComponents.root.simulation[1].children.map(item => item.componentId.split('.').at(-1)), [
        'previous_turn_update', 'previous_inventory_disposal', 'current_state'
    ]);
    const beforeLength = context.promptComponents.root.simulation.length;
    const beforeKeys = manager.promptRegistry.get('world_state_tracker').world_state_context.children.map(item => item.key);
    assert.throws(() => tools.prompt.contribute({ id: 'world_state_context', to: 'root.canon', text: 'Wrong destination' }), /cannot move/);
    assert.throws(() => contribute({ current_state: { bad_child: 7 } }), /must be text or a nested child map/);
    assert.equal(context.promptComponents.root.simulation.length, beforeLength);
    assert.deepEqual(manager.promptRegistry.get('world_state_tracker').world_state_context.children.map(item => item.key), beforeKeys);
    context.runtime.promptBuilder = { sharedPrefixFrozen: true };
    assert.throws(() => contribute({ current_state: 'Too late' }), /after the shared prefix froze/);
    assert.equal(context.promptComponents.root.simulation.length, beforeLength);
});

test('simple plugin instruction is compiled to PreparedPrompt before the LLM wrapper', async () => {
    const { tools } = setup();
    const llm = require('../../llm.js');
    const original = llm.callLLM;
    let captured;
    llm.callLLM = async request => {
        captured = request;
        assert.ok(request.prompt instanceof PreparedPrompt);
        assert.equal(request.prompt.messages[0].content, 'Extract the new world state.');
        assert.ok(request.prompt.manifest.occurrences.some(item => item.componentId === 'world_state_tracker.extraction_request'));
        await request.validateFn({ world_state_events: [] }, request.prompt.messages);
        return { content: { world_state_events: [] } };
    };
    try {
        const response = await tools.llm.withSchema({
            requestId: 'extraction_request', instruction: 'Extract the new world state.',
            model: 'mediumendmodel'
        }, value => Array.isArray(value.world_state_events));
        assert.deepEqual(response.content, { world_state_events: [] });
        assert.equal(captured.prompt.manifest.components['world_state_tracker.extraction_request'].owner, 'world_state_tracker');
        await assert.rejects(tools.llm.json({ instruction: 'Missing request id', model: 'mediumendmodel' }), /requestId/);
        await assert.rejects(tools.llm.json({ requestId: 'extraction', instruction: 'Hello', messages: [], model: 'mediumendmodel' }), /messages/);
    } finally {
        llm.callLLM = original;
    }
});

test('plain prompt text is a toolkit convenience, not a raw core LLM request', async () => {
    const { tools } = setup();
    const llm = require('../../llm.js');
    const original = llm.callLLM;
    let firstHash;
    llm.callLLM = async request => {
        assert.ok(request.prompt instanceof PreparedPrompt);
        assert.equal(request.prompt.messages[0].content, 'Name one unresolved thread.');
        assert.equal(request.prompt.manifest.components['world_state_tracker.thread_review'].parent, 'core.plugin_tasks');
        if (firstHash) assert.equal(request.prompt.hash, firstHash);
        firstHash = request.prompt.hash;
        return { content: { thread: 'The locked vault' } };
    };
    try {
        const task = { requestId: 'thread_review', prompt: 'Name one unresolved thread.', model: 'mediumendmodel' };
        assert.deepEqual((await tools.llm.json(task)).content, { thread: 'The locked vault' });
        await tools.llm.json(task);
        await assert.rejects(tools.llm.json({ ...task, instruction: 'Conflicting text' }), /both/);
    } finally {
        llm.callLLM = original;
    }
});

test('structured plugin request groups history across messages and separates two pieces in one message', async () => {
    const { tools } = setup();
    const llm = require('../../llm.js');
    const original = llm.callLLM;
    let prepared;
    llm.callLLM = async options => {
        prepared = options.prompt;
        return { content: { contradiction: false } };
    };
    try {
        await tools.llm.json({
            requestId: 'continuity_review', model: 'mediumendmodel',
            prompt: { messages: [
                { role: 'system', piece: 'rules', text: 'Check continuity.' },
                { role: 'user', piece: 'history.chapter_3.question', text: 'Where is the key?' },
                { role: 'assistant', piece: 'history.chapter_3.answer', text: 'Inside the vault.' },
                { role: 'user', separator: '\n\n', parts: [
                    { id: 'current_state', text: 'The vault is sealed.' },
                    { id: 'task', text: 'Identify a contradiction.' }
                ] }
            ] }
        });
    } finally {
        llm.callLLM = original;
    }
    assert.ok(prepared instanceof PreparedPrompt);
    assert.deepEqual(prepared.messages.map(message => message.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(prepared.messages[3].content, 'The vault is sealed.\n\nIdentify a contradiction.');
    const base = 'world_state_tracker.continuity_review';
    assert.equal(prepared.manifest.components[`${base}.history`].parent, base);
    assert.equal(prepared.manifest.components[`${base}.history.chapter_3.answer`].parent, `${base}.history.chapter_3`);
    const owned = id => prepared.manifest.spans.filter(span =>
        prepared.manifest.occurrences.some(occ => occ.occurrenceId === span.occurrenceId && occ.componentId === id));
    assert.deepEqual(owned(`${base}.history.chapter_3.question`).map(span => span.messageIndex), [1]);
    assert.deepEqual(owned(`${base}.history.chapter_3.answer`).map(span => span.messageIndex), [2]);
    assert.deepEqual(owned(`${base}.current_state`).map(span => span.messageIndex), [3]);
    assert.deepEqual(owned(`${base}.task`).map(span => span.messageIndex), [3]);
    assert.equal(prepared.manifest.components[`${base}.rules`].owner, 'world_state_tracker');
});

test('advanced compose defines pieces at add time without a plugin manifest', () => {
    const { tools } = setup();
    const prepared = tools.prompt.compose('review', draft => {
        draft.system(message => message.add('rules', 'Follow the evidence.'));
        draft.user(message => message.add('history', history => {
            history.add('earlier_question', 'Who opened the door?');
        }));
        draft.assistant(message => message.add('history.earlier_answer', 'Ari did.'));
    });
    assert.deepEqual(prepared.messages.map(message => message.role), ['system', 'user', 'assistant']);
    assert.equal(prepared.manifest.components['world_state_tracker.review.history.earlier_question'].parent,
        'world_state_tracker.review.history');
    assert.equal(prepared.manifest.components['world_state_tracker.review.history.earlier_answer'].parent,
        'world_state_tracker.review.history');
    assert.throws(() => tools.prompt.compose('bad_review', draft => {
        draft.user(message => message.text('Unattributed text'));
    }), /Name message text/);
});

test('advanced compose defines nested pieces under the request without a manifest', () => {
    const { tools } = setup();
    const prepared = tools.prompt.compose('review', draft => {
        draft.user(message => message.add('existing_task', task => task.add('detail', 'Existing content.')));
    });
    assert.equal(prepared.messages[0].content, 'Existing content.');
    assert.equal(prepared.manifest.components['world_state_tracker.review.existing_task.detail'].parent,
        'world_state_tracker.review.existing_task');
});

test('raw role/content message arrays remain rejected at the plugin boundary', async () => {
    const { tools } = setup();
    await assert.rejects(tools.llm.json({ requestId: 'bad', messages: [{ role: 'user', content: 'Raw' }], model: 'mediumendmodel' }),
        /task\.messages/);
    await assert.rejects(tools.llm.json({ requestId: 'bad', prompt: { messages: [{ role: 'user', content: 'Raw' }] }, model: 'mediumendmodel' }),
        /Raw \{role,content\}/);
});

test('VN-background keeps its frozen prefix while giving a named suffix to the plugin', async () => {
    const { context, tools } = setup();
    context.processed.narrativeEngine.writerResponse = 'Ari opens the vault.';
    const prefix = initializeVnBackgroundLlmContext(context);
    const llm = require('../../llm.js');
    const original = llm.callLLM;
    let prepared;
    llm.callLLM = async options => {
        prepared = options.prompt;
        return { content: { tension: 2 } };
    };
    try {
        await tools.llm.vnBackground.json({
            scene: 'raw', requestId: 'tension_score',
            instruction: 'Score the scene tension.', msg: 'Tension score'
        });
    } finally {
        llm.callLLM = original;
    }
    assert.ok(prepared instanceof PreparedPrompt);
    assert.deepEqual(prepared.messages.slice(0, 2), prefix.messages.map(({ role, content }) => ({ role, content })));
    assert.equal(prepared.messages.at(-1).content, 'Score the scene tension.');
    assert.equal(prepared.manifest.components['world_state_tracker.tension_score'].owner, 'world_state_tracker');
    assert.ok(prepared.manifest.inclusions.some(item => item.sourceHash === prefix.prefixHash));
    assert.equal(initializeVnBackgroundLlmContext(context).prefixHash, prefix.prefixHash);
});

test('VN-background can append a multi-message plugin-owned suffix without changing prefix', () => {
    const { manager, context } = setup();
    const prefix = initializeVnBackgroundLlmContext(context);
    const suffix = compilePluginRequest('world_state_tracker', 'scene_advice', {
        messages: [
            { role: 'user', piece: 'instruction', text: 'Suggest staging.' },
            { role: 'assistant', piece: 'example', text: 'Put Ari near the door.' }
        ]
    }, { turnContext: context, pluginManager: manager });
    const prepared = buildVnBackgroundPrompt(context, null, { scene: 'none', preparedSuffix: suffix });
    assert.deepEqual(prepared.messages.slice(0, 2), prefix.messages);
    assert.deepEqual(prepared.messages.slice(2).map(item => item.role), ['user', 'assistant']);
    assert.equal(prepared.manifest.components['world_state_tracker.scene_advice.example'].owner, 'world_state_tracker');
    assert.ok(prepared.manifest.inclusions.some(item => item.sourcePromptId === suffix.id));
});

test('batch compiles each named instruction or structured message independently', async () => {
    const { tools } = setup();
    const llm = require('../../llm.js');
    const original = llm.callLLM;
    const seen = [];
    llm.callLLM = async options => {
        seen.push(options.prompt);
        return { content: { task: options.prompt.id } };
    };
    try {
        const results = await tools.llm.batch([
            { requestId: 'first', instruction: 'Describe the vault.', model: 'mediumendmodel' },
            { requestId: 'second', prompt: { messages: [
                { role: 'system', piece: 'rules', text: 'Be concise.' },
                { role: 'user', piece: 'task', text: 'Describe the key.' }
            ] }, model: 'mediumendmodel' }
        ], { concurrency: 2, json: true });
        assert.equal(results.length, 2);
    } finally {
        llm.callLLM = original;
    }
    assert.deepEqual(seen.map(item => item.id).sort(), [
        'world_state_tracker.first', 'world_state_tracker.second'
    ]);
    assert.ok(seen.every(item => item instanceof PreparedPrompt));
    assert.deepEqual(seen.find(item => item.id.endsWith('.second')).messages.map(item => item.role), ['system', 'user']);
    await assert.rejects(tools.llm.batch([{ messages: [{ role: 'user', content: 'Raw' }] }]), /cannot supply raw messages/);
});

test('verbatim reuse of a known piece keeps source identity and spans', () => {
    const { context, tools } = setup();
    tools.prompt.contribute({ id: 'world_state_context', to: 'root.simulation', children: { current_state: 'Harbor at dawn.' } });
    const prepared = tools.prompt.compose('travel_review', draft => {
        draft.user(message => {
            message.include('world_state_tracker.world_state_context');
            message.add('task', 'Assess travel conditions.');
        });
    });
    const stored = context.promptComponents.root.simulation[0];
    const included = prepared.manifest.occurrences.find(item => item.componentId === 'world_state_tracker.world_state_context');
    assert.ok(included);
    assert.equal(included.source.sourceId, stored.sourceId);
    assert.equal(included.source.target, 'root');
    assert.equal(included.source.slot, 'simulation');
    const content = prepared.messages[0].content;
    assert.match(content, /Harbor at dawn/);
    assert.match(content, /Assess travel conditions/);
    assert.throws(() => tools.prompt.compose('bad_review', draft => {
        draft.user(message => message.include('world_state_tracker.missing_piece'));
    }), /Unknown prompt component/);
});

test('history selection sends one attributed view plus the plugin instruction', () => {
    const { context, tools } = setup();
    context.runtime.historyData = { compressedHistory: { brief: 'Short past.', balanced: 'Longer past.', deep: 'Full past.' } };
    const prepared = tools.prompt.compose('objective_review', draft => {
        draft.user(message => {
            message.history('balanced');
            message.separator('\n\n');
            message.add('task', 'Identify unresolved objectives.');
        });
    });
    assert.equal(prepared.messages[0].content, 'Longer past.\n\nIdentify unresolved objectives.');
    const historyOcc = prepared.manifest.occurrences.find(item => item.componentId === 'core.history.compressed.balanced');
    assert.ok(historyOcc);
    assert.equal(historyOcc.historyView.preset, 'balanced');
    assert.equal(historyOcc.historyView.renderedChars, 'Longer past.'.length);
    const fresh = setup();
    assert.throws(() => fresh.tools.prompt.compose('early_review', draft => {
        draft.user(message => message.history('balanced'));
    }), /precomputed compressedHistory/);
});

test('history selection uses Memory LOD’s configured view without rebuilding or relabeling chapters', async () => {
    const { context, tools } = setup();
    const { buildCompressedHistoryViews } = require('../../memory_manager/processing/memory_lod.js');
    const chapters = Array.from({ length: 8 }, (_unused, index) => {
        const number = index + 1;
        return { tc: {
            turnNumber: number,
            input: { userPrompt: `user ${number}` },
            processed: { dialogueProcessor: { dialogue: `dialogue ${number}` }, plugins: {} },
            output: { summary: `summary ${number}`, synopsis: `synopsis ${number}` }
        }, nativeTier: 'synopsis' };
    });
    const settings = { infrastructure: { narrative_history: { compressed_history: {
        arc_tail: { enabled: false },
        presets: {
            brief: { full_chapters: 0, summary_chapters: 1, synopsis_chapters: 1 },
            balanced: { full_chapters: 1, summary_chapters: 2, synopsis_chapters: 2 },
            deep: { full_chapters: 2, summary_chapters: 3, synopsis_chapters: 3 }
        }
    } } } };
    const formatters = {
        applyGlobalReplacements: text => String(text),
        wrap: (tag, text) => `<${tag}>${text}</${tag}>`
    };
    const views = await buildCompressedHistoryViews(chapters, context, formatters, { settings });
    assert.notEqual(views.brief, views.balanced);
    assert.match(views.balanced, /\[USER\]: user 8/);
    assert.match(views.balanced, /summary 7/);
    context.runtime.historyData = { compressedHistory: views };

    const prepared = tools.prompt.compose('history_lod_probe', draft => {
        draft.user(message => message.history('balanced'));
    });
    assert.equal(prepared.messages[0].content, views.balanced);
    const history = prepared.manifest.occurrences.find(item => item.componentId === 'core.history.compressed.balanced');
    assert.equal(history.historyView.fullChars, views.balanced.length);
    assert.equal(history.historyView.renderedChars, views.balanced.length);

    const limited = tools.prompt.compose('history_lod_limited', draft => {
        draft.user(message => message.history({ preset: 'deep', maxChars: 40 }));
    });
    assert.equal(limited.messages[0].content, views.deep.slice(0, 40));
    assert.equal(limited.manifest.occurrences.find(item => item.componentId === 'core.history.compressed.deep').historyView.renderedChars, 40);
});

test('structured history and include parts share one resolver with compose', async () => {
    const { context, tools } = setup();
    context.runtime.historyData = { compressedHistory: { brief: 'Short past.', balanced: 'Balanced past.', deep: 'Full past.' } };
    tools.prompt.contribute({ id: 'world_state_context', to: 'root.simulation', children: { current_state: 'Harbor at dawn.' } });
    const llm = require('../../llm.js');
    const original = llm.callLLM;
    let prepared;
    llm.callLLM = async options => { prepared = options.prompt; return { content: {} }; };
    try {
        await tools.llm.json({ requestId: 'objective_review', model: 'mediumendmodel', prompt: { messages: [
            { role: 'system', piece: 'rules', text: 'Check continuity.' },
            { role: 'user', piece: 'task', text: 'Summarize.' },
            { role: 'user', history: 'balanced' },
            { role: 'user', parts: [{ include: 'world_state_tracker.world_state_context' }, { id: 'task2', text: 'Assess travel.' }] }
        ] } });
    } finally { llm.callLLM = original; }
    assert.deepEqual(prepared.messages.map(item => item.role), ['system', 'user', 'user', 'user']);
    assert.equal(prepared.messages[2].content, 'Balanced past.');
    const included = prepared.manifest.occurrences.find(item => item.componentId === 'world_state_tracker.world_state_context');
    assert.ok(included && included.source);
    // Explicit duplicate inclusion in one request needs no silent guard: the
    // caller asked for it, the bytes render twice, both spans are recorded.
    const dup = tools.prompt.compose('dup_review', draft => {
        draft.user(message => { message.history('balanced'); message.history('balanced'); });
    });
    assert.equal(dup.messages[0].content, 'Balanced past.Balanced past.');
    assert.equal(dup.manifest.occurrences.filter(item => item.componentId === 'core.history.compressed.balanced').length, 2);
});

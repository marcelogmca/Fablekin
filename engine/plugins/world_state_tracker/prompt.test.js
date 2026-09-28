const assert = require('node:assert/strict');
const test = require('node:test');
const TurnContext = require('../../modules/turncontext.js');
const { buildTools } = require('../../modules/plugin_manager/runtime/tools_builder.js');
const { buildVnBackgroundPrefix } = require('../../modules/vn_manager/background_llm_cache.js');
const {
    buildWriterPromptSnapshotPayload, mergePromptComponentsFromSnapshot,
    mergePromptDefinitionsFromSnapshot
} = require('../../modules/writer_prompt_snapshot.js');
const plugin = require('./index.js');
const logic = require('./logic.js');
const llm = require('../../modules/llm.js');

test('World State defines its section at contribution time without promptPieces', async () => {
    assert.equal(plugin.promptPieces, undefined);
    const context = new TurnContext('Pilot');
    context.turnNumber = 2;
    context.input.playerCharacterName = 'Ari';
    const manager = {
        plugins: new Map([[plugin.id, plugin]]),
        disabledPlugins: new Map(), promptRegistry: new Map()
    };
    const tools = buildTools(manager, plugin.id, context);
    tools.settings.get = () => true;
    tools.db.chat.query = async () => [];
    const originalSynthesize = logic.synthesizeWorldState;
    const originalUpdate = logic.buildPreviousTurnUpdate;
    logic.synthesizeWorldState = async () => ({
        synthesizedText: 'Harbor at dawn.',
        structuredData: { locations: ['Harbor'], weatherChange: 'Clear' }
    });
    logic.buildPreviousTurnUpdate = async () => 'Quiet overnight.';
    try {
        await plugin.hooks.HOOK_POST_PROMPT_BUILDER.run(context, tools);
    } finally {
        logic.synthesizeWorldState = originalSynthesize;
        logic.buildPreviousTurnUpdate = originalUpdate;
    }
    const stored = context.promptComponents.root.simulation[0];
    assert.equal(stored.componentId, 'world_state_tracker.world_state_context');
    assert.deepEqual(stored.children.map(child => child.componentId), [
        'world_state_tracker.world_state_context.previous_turn_update',
        'world_state_tracker.world_state_context.current_state'
    ]);
    assert.equal(manager.promptRegistry.get(plugin.id).world_state_context.slot, 'simulation');
    const expected = [
        '<plugin_context directable_plugin="world_state_tracker">',
        '<previous_turn_update>', 'Quiet overnight.', '</previous_turn_update>',
        '', '<current_state>', '<world_state>', 'Harbor at dawn.',
        '</world_state>', '</current_state>', '</plugin_context>'
    ].join('\n');
    assert.equal(context.renderPromptSlot('root', 'simulation'), expected);
    const vnPrefix = buildVnBackgroundPrefix(context);
    assert.match(vnPrefix.messages[1].content, /Harbor at dawn/);
    assert.ok(vnPrefix.manifest.occurrences.some(item => item.componentId === 'world_state_tracker.world_state_context.current_state'));

    // Definition and source identity survive restart; historical VN/interlude
    // composition does not depend on this hook having run in the new process.
    const restored = TurnContext.fromSnapshot(context.serialize(), 'Pilot', 2);
    assert.deepEqual(restored.promptDefinitions, context.promptDefinitions);
    assert.equal(restored.promptComponents.root.simulation[0].sourceId, stored.sourceId);
    const historicalPrefix = buildVnBackgroundPrefix(restored);
    assert.ok(historicalPrefix.manifest.occurrences.some(item => item.componentId === 'world_state_tracker.world_state_context.current_state'));

    const parentPrompt = buildWriterPromptSnapshotPayload(context);
    assert.equal(parentPrompt.promptComponents.root.simulation[0].sourceId, stored.sourceId);
    assert.equal(parentPrompt.promptComponents.root.simulation[0].directablePluginId, plugin.id);
    const interlude = new TurnContext('Pilot');
    interlude.promptDefinitions = parentPrompt.promptDefinitions;
    mergePromptComponentsFromSnapshot(interlude.promptComponents, parentPrompt.promptComponents, { slots: ['simulation'] });
    const interludePrefix = buildVnBackgroundPrefix(interlude);
    assert.ok(interludePrefix.manifest.occurrences.some(item => item.componentId === 'world_state_tracker.world_state_context.current_state'));

    const currentDefinitions = structuredClone(parentPrompt.promptDefinitions);
    currentDefinitions.world_state_tracker.world_state_context.children = [{
        key: 'previous_inventory_disposal', label: 'Previous Inventory Disposal',
        description: 'Previous Inventory Disposal contributed by world_state_tracker.'
    }];
    const mergedDefinitions = mergePromptDefinitionsFromSnapshot(currentDefinitions, parentPrompt.promptDefinitions);
    assert.deepEqual(mergedDefinitions.world_state_tracker.world_state_context.children.map(item => item.key), [
        'previous_inventory_disposal', 'previous_turn_update', 'current_state'
    ]);
    assert.throws(() => mergePromptDefinitionsFromSnapshot({ world_state_tracker: {
        world_state_context: { ...currentDefinitions.world_state_tracker.world_state_context, slot: 'canon' }
    } }, parentPrompt.promptDefinitions), /changed identity or placement/);
});

test('Turn 1 extraction renders typed canon and sends a named prepared instruction', async () => {
    const context = new TurnContext('Pilot');
    context.turnNumber = 1;
    context.processed.narrativeEngine.writerResponse = 'Ari finds a compass.';
    context.addPromptOccurrence('root', 'canon', {
        kind: 'component', componentId: 'core.canon.static_lore_file', owner: 'core',
        text: 'Ari began with no compass.', children: [], instanceKey: null
    });
    const manager = {
        plugins: new Map([[plugin.id, plugin]]), disabledPlugins: new Map(), promptRegistry: new Map()
    };
    const tools = buildTools(manager, plugin.id, context);
    const facts = [];
    tools.facts.cleanUpFactsDb = async () => {};
    tools.facts.appendToFactsDb = async fact => { facts.push(fact); };
    tools.director.getFeedback = async () => '';
    tools.directives.getFormatted = () => '';
    tools.settings.getSelf = () => ({ model_def: { model: 'mediumendmodel' } });
    const originalCall = llm.callLLM;
    let request;
    llm.callLLM = async options => {
        request = options;
        await options.validateFn({ world_state_events: [] }, options.prompt.messages);
        return {
            content: {
                world_state_events: [{ line: 0, time_passed_minutes: 10, inventory_changes: [{ item: 'Compass', change: 1 }] }]
            }
        };
    };
    try {
        assert.equal(await logic.extractAndStoreWorldState(context, tools), true);
    } finally {
        llm.callLLM = originalCall;
    }
    assert.equal(request.prompt.id, 'world_state_tracker.extraction_request');
    assert.match(request.prompt.messages[0].content, /Ari began with no compass/);
    assert.doesNotMatch(request.prompt.messages[0].content, /\[object Object\]/);
    assert.ok(request.prompt.manifest.occurrences.some(item => item.componentId === 'world_state_tracker.extraction_request'));
    assert.ok(facts.some(fact => fact.predicate === 'inventory' && fact.target === 'Compass'));
});

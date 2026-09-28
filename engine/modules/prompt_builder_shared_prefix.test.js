const test = require('node:test');
const assert = require('node:assert/strict');
const promptBuilder = require('./prompt_builder.js');
const director = require('./director.js');
const { buildTools } = require('./plugin_manager/runtime/tools_builder.js');
const {
  getSharedNarrativeMessages,
  getSharedNarrativePrefix,
  isSharedPrefixFrozen
} = require('./shared_narrative_prompt.js');
const {
  WRITER_PROMPT_SNAPSHOT_SCHEMA_VERSION,
  isWriterPromptSnapshotCompatible
} = require('./writer_prompt_snapshot.js');
const { ensurePromptComponentSourceIds } = require('./turncontext.js');

// Test-side insertion stamping: production producers use
// TurnContext.addPromptOccurrence(); plain-object test doubles must stamp
// stable sourceIds themselves. Read paths never backfill.
function stampSourceIds(promptComponents) {
  for (const pillar of Object.values(promptComponents || {})) {
    for (const items of Object.values(pillar || {})) {
      if (Array.isArray(items)) for (const item of items) ensurePromptComponentSourceIds(item);
    }
  }
  return promptComponents;
}

function createContext() {
  const TurnContext = require('./turncontext.js');
  const context = new TurnContext('SharedPromptTest');
  context.turnNumber = 3;
  context.creationTurnNumber = 3;
  context.sceneMode = 'mainline';
  context.writerCoTEnabled = true;
  context.input.playerCharacterName = 'Ari';
  context.input.userPrompt = 'Open the observatory door.';
  context.input.softFeedback = 'Keep the discovery quiet.';
  context.processed.promptBuilder.foundationGathered = true;
  context.processed.director.writerBrief = 'Reveal the old telescope, but not its origin.';
  // Structured slots: ordered occurrences, not strings. Core ids resolve
  // in the catalogue; instanceKeys disambiguate repeats in one slot.
  context.addPromptOccurrence('root', 'protocol', { kind: 'component', componentId: 'root.protocol', instanceKey: 'test-protocol-0', text: '<system_directives>Shared style directive.</system_directives>', children: [], owner: 'core' });
  context.addPromptOccurrence('root', 'canon', { kind: 'component', componentId: 'core.canon.static_lore_file', instanceKey: 'test-canon-0', text: 'The observatory is abandoned.', children: [], owner: 'core' });
  context.addPromptOccurrence('root', 'dynamic_knowledge', { kind: 'component', componentId: 'root.dynamic_knowledge', instanceKey: null, text: 'Ari found a brass key.', children: [], owner: 'core' });
  context.addPromptOccurrence('root', 'simulation', { kind: 'component', componentId: 'root.simulation', instanceKey: null, text: 'Location: Observatory entrance.', children: [], owner: 'core' });
  context.addPromptOccurrence('root', 'directives', { kind: 'component', componentId: 'root.directives', instanceKey: null, text: 'Avoid melodrama.', children: [], owner: 'core' });
  context.addPromptOccurrence('writer', 'simulation', { kind: 'component', componentId: 'writer.simulation', instanceKey: null, text: 'Writer sees a private sensory note.', children: [], owner: 'core' });
  context.addPromptOccurrence('writer', 'directives', { kind: 'component', componentId: 'writer.directives', instanceKey: null, text: 'Writer-only final override.', children: [], owner: 'core' });
  context.addPromptOccurrence('director', 'protocol', { kind: 'component', componentId: 'director.protocol', instanceKey: null, text: 'Director-private protocol addition.', children: [], owner: 'core' });
  context.addPromptOccurrence('director', 'simulation', { kind: 'component', componentId: 'director.simulation', instanceKey: null, text: 'Director sees a private long-term plan.', children: [], owner: 'core' });
  context.addPromptOccurrence('director', 'directives', { kind: 'component', componentId: 'director.directives', instanceKey: null, text: 'Director-only planning constraint.', children: [], owner: 'core' });
  context.runtime.historyData = {
    narrativeHistory: 'Chapter 1 narrative.',
    summaryHistory: 'Chapter 1 summary.',
    chatHistory: [
      { role: 'user', content: 'Ari: Where does this key belong?' },
      { role: 'assistant', content: 'The key glints beneath the moon.' }
    ]
  };
  context.runtime.chapterHistory = {
    synopsischapters: [],
    summarychapters: [],
    fullchapters: [{
      turnNumber: 2,
      postContent: { userInputInjection: 'The observatory alarm remains disabled.' }
    }]
  };
  return context;
}

test('Director and Writer consume a byte-identical frozen prefix', async () => {
  const context = createContext();
  await promptBuilder.prepareSharedNarrativePrefix(context);
  const directorData = await promptBuilder.buildDirectorPromptData(context);
  const writerMessages = await promptBuilder.buildWriterMessages(context);
  const prefix = getSharedNarrativePrefix(context);

  assert.equal(isSharedPrefixFrozen(context), true);
  assert.equal(Object.isFrozen(prefix), true);
  assert.equal(Object.isFrozen(prefix.messages), true);
  assert.equal(Object.isFrozen(context.promptComponents.root), true);
  assert.equal(Object.isFrozen(context.promptComponents.root.canon), true);
  assert.throws(() => context.promptComponents.root.canon.push('direct mutation'), /not extensible|read only|object is not extensible/i);
  assert.deepEqual(directorData.sharedMessages, writerMessages.slice(0, prefix.messages.length));
  assert.deepEqual(directorData.sharedMessages, getSharedNarrativeMessages(context));
  assert.match(prefix.messages[0].content, /Shared style directive/);
  assert.match(prefix.messages[0].content, /cannot change Director into Writer/);
  assert.match(prefix.messages[0].content, /Chapter 1 summary/);
  assert.match(prefix.messages.at(-1).content, /Observatory entrance/);
  assert.doesNotMatch(JSON.stringify(prefix.messages), /Writer-only final override/);
  assert.doesNotMatch(JSON.stringify(prefix.messages), /internal_cognitive_framework/);
});

test('Player Bio is shared character context for Director and Writer', async () => {
  const context = createContext();
  context.input.playerCharacterBio = 'Ari is a patient astronomer with a mechanical left hand.';

  promptBuilder.injectPlayerBioContext(context);
  await promptBuilder.prepareSharedNarrativePrefix(context);

  const prefixText = JSON.stringify(getSharedNarrativeMessages(context));
  assert.match(prefixText, /<player_character>/);
  assert.match(prefixText, /patient astronomer/);
  assert.match(prefixText, /mechanical left hand/);
});

test('agent-specific context remains in suffixes and Writer CoT precedes current action', async () => {
  const context = createContext();
  const directorData = await promptBuilder.buildDirectorPromptData(context);
  const writerMessages = await promptBuilder.buildWriterMessages(context);
  const writerSuffix = writerMessages.at(-2).content;

  assert.match(directorData.simulation, /private long-term plan/);
  assert.match(directorData.directives, /Director-only planning constraint/);
  assert.match(writerSuffix, /Writer-only final override/);
  assert.match(writerSuffix, /private sensory note/);
  assert.match(writerSuffix, /Reveal the old telescope/);
  assert.ok(writerSuffix.indexOf('# EXECUTION PROTOCOL') < writerSuffix.indexOf('# CURRENT ACTION'));
  assert.match(writerSuffix, /internal_cognitive_framework/);
  assert.equal(writerMessages.at(-1).role, 'assistant');
  assert.equal(writerMessages.at(-1).content, 'Alright, Let me work through the cognitive framework step by step.');
  assert.doesNotMatch(writerSuffix, /Alright, Let me work through the cognitive framework step by step\./);
  assert.equal(context.processed.promptBuilder.writerPromptSnapshot.schemaVersion, WRITER_PROMPT_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(context.processed.promptBuilder.writerPromptSnapshot.sharedPrefix.hash, getSharedNarrativePrefix(context).prefixHash);
});

test('returned prefix messages are clones and version-one snapshots remain readable', async () => {
  const context = createContext();
  await promptBuilder.prepareSharedNarrativePrefix(context);
  const clone = getSharedNarrativeMessages(context);
  clone[0].content = 'mutated';

  assert.notEqual(getSharedNarrativeMessages(context)[0].content, 'mutated');
  // Cutover: v4 structured snapshots carry source ids and dynamic definitions. v1-v3 are
  // rejected loudly, never coerced.
  assert.equal(isWriterPromptSnapshotCompatible({ schemaVersion: 1 }), false);
  assert.equal(isWriterPromptSnapshotCompatible({ schemaVersion: 2 }), false);
  assert.equal(isWriterPromptSnapshotCompatible({ schemaVersion: 3 }), false);
  assert.equal(isWriterPromptSnapshotCompatible({ schemaVersion: 4 }), true);
  assert.equal(isWriterPromptSnapshotCompatible({ schemaVersion: 99 }), false);
});

test('both Director calls retain the shared prefix before private messages', async () => {
  const context = createContext();
  await promptBuilder.prepareSharedNarrativePrefix(context);
  const sharedPrepared = context.processed.promptBuilder.sharedPrefixPrepared;
  const prompt = {
    sharedMessages: sharedPrepared.messages.map(message => ({ role: message.role, content: message.content })),
    sharedPrefixHash: 'test',
    sharedPrepared: {
      id: sharedPrepared.id,
      messages: sharedPrepared.messages.map(message => ({ role: message.role, content: message.content })),
      manifest: sharedPrepared.manifest,
      hash: sharedPrepared.hash,
      characterCount: sharedPrepared.characterCount
    },
    taskText: 'Director task framing.',
    contextBody: 'Director-private context.',
    constraintsText: '<global_constraints>\nAri\n</global_constraints>',
    inventoryIntentText: '',
    currentActionText: '# CURRENT ACTION\nAri opens the door.',
    contextMessage: '# AGENT TASK: DIRECTOR\nDirector task framing.\nDirector-private context.\n\n<global_constraints>\nAri\n</global_constraints>\n\n# CURRENT ACTION\nAri opens the door.',
    analysisInstructions: 'Director analysis protocol',
    ledgerInstructions: 'Director ledger protocol'
  };
  const prepared = director.buildDirectorPreparedPrompts(prompt);
  const withLedger = director.buildDirectorPreparedPrompts(prompt, { analysisResponse: 'Analysis response' });
  const sharedCount = prompt.sharedMessages.length;

  assert.deepEqual(prepared.analysis.messages.slice(0, sharedCount), prompt.sharedMessages);
  assert.deepEqual(withLedger.ledger.messages.slice(0, sharedCount), prompt.sharedMessages);
  assert.equal(withLedger.ledger.messages.at(-2).role, 'assistant');
  assert.equal(withLedger.ledger.messages.at(-1).content, 'Director ledger protocol');
});

test('factored shared prefix is byte-identical with acovering manifest', async () => {
  const context = createContext();
  await promptBuilder.prepareSharedNarrativePrefix(context);
  const frozen = getSharedNarrativePrefix(context);
  const prepared = context.processed.promptBuilder.sharedPrefixPrepared;
  assert.ok(prepared?.manifest, 'shared prefix manifest must be recorded');
  assert.equal(prepared.manifest.promptId, 'core.narrative.shared');
  assert.equal(prepared.manifest.version, 2);
  assert.deepEqual(
    prepared.messages.map(message => ({ role: message.role, content: message.content })),
    frozen.messages.map(message => ({ role: message.role, content: message.content }))
  );
  const sorted = prepared.manifest.spans.slice().sort((a, b) => a.messageIndex - b.messageIndex || a.start - b.start);
  assert.equal(sorted[0].start, 0);
  frozen.messages.forEach((message, index) => {
    const covered = sorted
      .filter(span => span.messageIndex === index)
      .map(span => message.content.slice(span.start, span.end))
      .join('');
    assert.equal(covered, message.content, `shared message ${index} must reconstruct`);
  });
});

test('Director prepared analysis matches legacy messages with traced provenance', async () => {
  const context = createContext();
  await promptBuilder.prepareSharedNarrativePrefix(context);
  const frozen = getSharedNarrativePrefix(context);
  const sharedPrepared = context.processed.promptBuilder.sharedPrefixPrepared;
  assert.ok(sharedPrepared, 'shared prepared prefix must be available');

  // Cache shape: the composer emits ONE context user message joining the
  // pieces with '\n\n' (same as the legacy contextMessage), with per-piece
  // provenance inside it via the context_message container.
  const contextPieces = [
    '# AGENT TASK: DIRECTOR\nDirector task framing.\nDirector-private context.',
    'Director-private context.',
    '<global_constraints>\nAri\n</global_constraints>',
    '# CURRENT ACTION\nAri opens the door.'
  ];
  const contextMessage = contextPieces.join('\n\n');
  const promptObj = {
    sharedMessages: frozen.messages.map(message => ({ role: message.role, content: message.content })),
    sharedPrefixHash: frozen.prefixHash,
    sharedPrepared: {
      id: sharedPrepared.id,
      messages: sharedPrepared.messages.map(message => ({ role: message.role, content: message.content })),
      manifest: sharedPrepared.manifest,
      hash: sharedPrepared.hash,
      characterCount: sharedPrepared.characterCount
    },
    taskText: 'Director task framing.\nDirector-private context.',
    contextBody: 'Director-private context.',
    constraintsText: '<global_constraints>\nAri\n</global_constraints>',
    inventoryIntentText: '',
    currentActionText: '# CURRENT ACTION\nAri opens the door.',
    contextMessage,
    analysisInstructions: 'Director analysis protocol.',
    ledgerInstructions: 'Director ledger protocol.'
  };
  const prepared = director.buildDirectorPreparedPrompts(promptObj);
  // Composer layout: [shared..., ONE contextMessage, analysis_instructions].
  // Per-piece provenance lives inside the single context message via the
  // context_message container ('\n\n' separator). Fixtures pin the bytes.
  const contextIndex = promptObj.sharedMessages.length;
  assert.equal(prepared.analysis.messages[contextIndex].role, 'user');
  assert.equal(prepared.analysis.messages[contextIndex].content, contextMessage);
  assert.equal(prepared.analysis.messages[contextIndex + 1].content, 'Director analysis protocol.');
  assert.equal(prepared.analysis.manifest.inclusions[0].kind, 'prefix');
  assert.equal(prepared.analysis.manifest.inclusions[0].sourcePromptId, 'core.narrative.shared');
  assert.ok(prepared.analysis.manifest.occurrences.some(o => o.componentId === 'core.director.context_message'));
  assert.ok(prepared.analysis.manifest.occurrences.some(o => o.componentId === 'core.director.task'));
  assert.ok(prepared.analysis.manifest.occurrences.some(o => o.componentId === 'core.director.current_action'));
  // The container owns the joins; pieces own their bytes. Slice the context
  // message by spans to prove each piece reconstructs exactly.
  const byId = new Map(prepared.analysis.manifest.occurrences.map(o => [o.occurrenceId, o.componentId]));
  const pieceTexts = prepared.analysis.manifest.spans
    .filter(span => span.messageIndex === contextIndex)
    .sort((a, b) => a.start - b.start)
    .map(span => ({
      componentId: byId.get(span.occurrenceId),
      text: prepared.analysis.messages[contextIndex].content.slice(span.start, span.end)
    }))
    .filter(piece => piece.componentId !== 'core.director.context_message');
  assert.deepEqual(pieceTexts.map(piece => piece.text), contextPieces);

  // Follow-ups extend the observed analysis shape with the real response as
  // core.director.analysis_response — model output re-injected, not protocol.
  // Call 2 = [analysis..., assistant(response), user(ledger)]: fixtures pin it.
  const withLedger = director.buildDirectorPreparedPrompts({ ...promptObj, sharedPrepared: promptObj.sharedPrepared }, { analysisResponse: 'Analysis response text.' });
  assert.deepEqual(
    withLedger.ledger.messages.slice(0, contextIndex + 2).map(message => ({ role: message.role, content: message.content })),
    prepared.analysis.messages.map(message => ({ role: message.role, content: message.content }))
  );
  assert.equal(withLedger.ledger.messages.at(-2).content, 'Analysis response text.');
  assert.equal(withLedger.ledger.messages.at(-1).content, 'Director ledger protocol.');
  const responseOcc = withLedger.ledger.manifest.occurrences.find(o => o.componentId === 'core.director.analysis_response');
  assert.ok(responseOcc, 'analysis response must be traced');
  const responseSpan = withLedger.ledger.manifest.spans.find(span => span.occurrenceId === responseOcc.occurrenceId);
  assert.equal(withLedger.ledger.messages[responseSpan.messageIndex].content.slice(responseSpan.start, responseSpan.end), 'Analysis response text.');
  assert.equal(withLedger.ledger.manifest.inclusions[0].kind, 'block');
});

test('structured contributions record attributed pieces and degrade honestly on divergence', async () => {
  // Full lifecycle: contribute pre-freeze (like a real HOOK_POST_PROMPT_BUILDER
  // plugin), run the real finalize + composer, tampering degrades. Uses the
  // live path: prepareSharedNarrativePrefix() with a StaticDataManager stub
  // (foundationGathered cleared) so gatherFoundation runs its real hook +
  // finalize sequence — no hook monkey-patching.
  const context = createContext();
  context.processed.promptBuilder.foundationGathered = false;
  context.runtime.historyData = { narrativeHistory: 'No story yet.', chatHistory: [], summaryHistory: '' };
  context.runtime.staticDataManager = {
    initialize: async () => {},
    processAndEmbedFile: async () => {},
    getStaticLoreFiles: async () => []
  };
  context.input.selectedFiles = [];
  context.runtime.rootDirectory = 'C:\\test-root';
  context.runtime.settings = { infrastructure: { static_lore: { top_k: 5 } } };
  const pluginManager = require('./plugin_manager/plugin_manager.js');
  const tools = buildTools({ plugins: new Map(), disabledPlugins: new Map(), promptRegistry: new Map() }, 'world_state_tracker', context);
  const contributed = [];
  const originalExecuteHook = pluginManager.executeHook;
  pluginManager.executeHook = async (hook, hookContext, ...rest) => {
    const result = await originalExecuteHook.call(pluginManager, hook, hookContext, ...rest);
    if (hook === 'HOOK_POST_PROMPT_BUILDER' && hookContext === context && contributed.length === 0) {
      contributed.push(tools.prompt.contribute({
        id: 'world_state_context', to: 'root.simulation',
        label: 'World state context', description: 'Pre-action world state and continuity updates.',
        children: {
          previous_turn_update: '<previous_turn_update>Calm.</previous_turn_update>',
          current_state: '<current_state>Harbor at dawn.</current_state>'
        },
        directable: true
      }));
    }
    return result;
  };
  try {
    await promptBuilder.prepareSharedNarrativePrefix(context);
  } finally {
    pluginManager.executeHook = originalExecuteHook;
  }
  assert.deepEqual(contributed, [true]);

  const liveEntry = context.promptComponents.root.simulation.at(-1);
  assert.ok(liveEntry, 'contribution must be recorded during HOOK_POST_PROMPT_BUILDER');
  assert.equal(liveEntry.componentId, 'world_state_tracker.world_state_context');
  assert.equal(liveEntry.owner, 'world_state_tracker');

  // Structured slot carries the rendered bytes for explicit readers.
  const TurnContext = require('./turncontext.js');
  const slotText = TurnContext.prototype.renderPromptSlot.call(context, 'root', 'simulation');
  assert.match(slotText, /<previous_turn_update>Calm/);
  assert.match(slotText, /Harbor at dawn/);
  assert.match(slotText, /directable_plugin="world_state_tracker"/);

  // Manifest attributes the bytes to plugin pieces under the slot anchor.
  const manifest = context.processed.promptBuilder.sharedPrefixManifest;
  const pieceIds = manifest.occurrences.map(o => o.componentId).filter(Boolean);
  assert.ok(pieceIds.some(id => id === 'world_state_tracker.world_state_context'), `missing parent piece (have: ${pieceIds.join(', ')})`);
  assert.ok(pieceIds.some(id => id === 'world_state_tracker.world_state_context.current_state'), `missing child piece (have: ${pieceIds.join(', ')})`);

  // Span-level acceptance: the prepared simulation user message contains the
  // directable wrapper, and slicing the parent occurrence's spans returns
  // the wrapper bytes. Per-piece spans slice to their own text.
  const simMessage = context.processed.promptBuilder.sharedPrefixPrepared.messages.find(m => m.role === 'user');
  assert.match(simMessage.content, /directable_plugin="world_state_tracker"/);
  const byId = new Map(manifest.occurrences.map(o => [o.occurrenceId, o.componentId]));
  const parentOcc = manifest.occurrences.find(o => o.componentId === 'world_state_tracker.world_state_context');
  assert.ok(parentOcc, 'parent occurrence must exist');
  const parentSpans = manifest.spans.filter(s => s.occurrenceId === parentOcc.occurrenceId);
  // The directable framing is the occurrence's own prefix/suffix wrapper, so
  // its span covers the full <plugin_context>…</plugin_context> bytes.
  const parentBytes = parentSpans.map(s => simMessage.content.slice(s.start, s.end)).join('');
  assert.match(parentBytes, /directable_plugin="world_state_tracker"/);
  // Child spans carry the turn content: the parent span covers its own
  // framing (prefix/suffix); children own their text spans (exclusive
  // ownership — no double-counting). Collect the occurrence SUBTREE spans
  // (parent + descendants) to prove the full wrapper bytes reconstruct.
  const subtreeIds = new Set([parentOcc.occurrenceId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const occ of manifest.occurrences) {
      if (occ.containerOccurrenceId && subtreeIds.has(occ.containerOccurrenceId) && !subtreeIds.has(occ.occurrenceId)) {
        subtreeIds.add(occ.occurrenceId);
        grew = true;
      }
    }
  }
  const subtreeBytes = manifest.spans
    .filter(s => subtreeIds.has(s.occurrenceId))
    .sort((a, b) => a.start - b.start)
    .map(s => simMessage.content.slice(s.start, s.end)).join('');
  assert.match(subtreeBytes, /Harbor at dawn/);
  assert.match(subtreeBytes, /Calm\./);
  // Writer path stores the same prepared prefix: Director inherits it via
  // usePrefix, so both agents share identical leading bytes AND spans.
  const stored = context.processed.promptBuilder.sharedPrefixPrepared;
  assert.ok(stored && typeof stored.id === 'string' && stored.id.length > 0, 'stored prepared prefix must carry its id for rehydration');

  // Tampering with the slot text after the fact is visible: structured
  // occurrences carry their own text, so a divergent downstream path cannot
  // silently rewrite them — the composer renders what is stored.
  // NOTE: root slots AND the root object are frozen after
  // prepareSharedNarrativePrefix.
  const TurnContext2 = require('./turncontext.js');
  assert.match(TurnContext2.prototype.renderPromptSlot.call(context, 'root', 'simulation'), /Harbor at dawn/);
  assert.equal(liveEntry.children.length, 2);
});

test('plugin root contribution closes after freezing while scoped suffix contribution remains open', async () => {
  const context = createContext();
  await promptBuilder.prepareSharedNarrativePrefix(context);
  const tools = buildTools({ plugins: new Map(), disabledPlugins: new Map(), promptRegistry: new Map() }, 'test_plugin', context);
  const rootCount = context.promptComponents.root.canon.length;
  const writerCount = context.promptComponents.writer.canon.length;

  assert.throws(() => tools.prompt.contribute({ id: 'late_note', to: 'root.canon', text: 'too late' }), /after the shared prefix froze/);
  assert.equal(tools.prompt.contribute({ id: 'suffix_note', to: 'writer.canon', text: 'writer suffix' }), true);
  assert.equal(context.promptComponents.root.canon.length, rootCount);
  assert.equal(context.promptComponents.writer.canon.length, writerCount + 1);
});

test('directable prompt contributions identify the calling plugin', () => {
  const context = createContext();
  const tools = buildTools({ plugins: new Map(), disabledPlugins: new Map(), promptRegistry: new Map() }, 'world_state_tracker', context);

  assert.equal(tools.prompt.contribute({ id: 'sky_note', to: 'root.simulation', text: '<world_state>Clear skies.</world_state>', directable: true }), true);
  const last = context.promptComponents.root.simulation.at(-1);
  assert.equal(last.componentId, 'world_state_tracker.sky_note');
  assert.equal(last.directable, true);
  // Leaf pieces store content as the occurrence's own text (no children).
  assert.equal(last.text, '<world_state>Clear skies.</world_state>');
  assert.deepEqual(last.children, []);
  const TurnContext3 = require('./turncontext.js');
  assert.match(TurnContext3.prototype.renderPromptSlot.call(context, 'root', 'simulation'), /directable_plugin="world_state_tracker"/);

  tools.prompt.contribute({ id: 'ambient_note', to: 'root.simulation', text: '<ambient>Birdsong.</ambient>' });
  assert.equal(context.promptComponents.root.simulation.at(-1).text, '<ambient>Birdsong.</ambient>');
});

test('Director feedback placeholder defaults to self and can request all plugins', async () => {
  const context = createContext();
  const tools = buildTools({ plugins: new Map(), disabledPlugins: new Map() }, 'world_state_tracker', context);

  assert.equal(await tools.director.getFeedback(), '');
  assert.deepEqual(await tools.director.getFeedback({ allPlugins: true }), {});
});

test('interludes restore current root and Writer components before freezing', async () => {
  const context = createContext();
  context.sceneMode = 'interlude';
  context.parentTurnDbId = 12;
  context.writerCoTEnabled = false;
  context.ensureChapterManagementInitialized = async () => {};
  const occ = (componentId, text) => ({ kind: 'component', componentId, instanceKey: null, text, children: [], owner: 'core' });
  context._chapterManagement = {
    getWriterPromptSnapshotByDbId: async () => {
      const restored = {
        schemaVersion: 4,
        promptComponents: {
          root: {
            canon: [occ('core.canon.static_lore_file', 'Restored parent canon.')],
            dynamic_knowledge: [],
            simulation: [occ('root.simulation', 'Restored parent state.')]
          },
          writer: {
            canon: [],
            dynamic_knowledge: [],
            simulation: [occ('writer.simulation', 'Restored Writer-private state.')],
            directives: [occ('writer.directives', 'Restored Writer-only instruction.')]
          }
        }
      };
      stampSourceIds(restored.promptComponents);
      return restored;
    }
  };

  const writerMessages = await promptBuilder.buildWriterMessages(context);
  const prefixText = JSON.stringify(getSharedNarrativeMessages(context));
  assert.match(prefixText, /Restored parent canon/);
  assert.match(prefixText, /Restored parent state/);
  assert.match(writerMessages.at(-1).content, /Restored Writer-private state/);
  assert.doesNotMatch(writerMessages.at(-1).content, /Restored Writer-only instruction/);
});

test('turn one and Director-less preparation produce a valid Writer prompt', async () => {
  const context = createContext();
  context.turnNumber = 1;
  context.writerCoTEnabled = false;
  context.directorEnabled = false;
  context.processed.director = {};
  context.runtime.chapterHistory = { synopsischapters: [], summarychapters: [], fullchapters: [] };

  const messages = await promptBuilder.buildWriterMessages(context);
  assert.ok(messages.length >= 2);
  assert.match(messages.at(-1).content, /# AGENT TASK: WRITER/);
  assert.doesNotMatch(messages.at(-1).content, /writer_brief/);
});

test('shadow prepared Writer prompt is byte-identical with a covering manifest', async () => {
  const context = createContext();
  const messages = await promptBuilder.buildWriterMessages(context);

  const manifest = context.processed.promptBuilder.writerPromptManifest;
  assert.ok(manifest, 'shadow manifest must be recorded for diagnostics');
  assert.equal(manifest.version, 2);
  assert.equal(manifest.promptId, 'core.writer');
  assert.equal(context.processed.promptBuilder.writerPromptPreparedHash.length, 16);

  // Every legacy message is covered by manifest spans with no gaps.
  const sorted = manifest.spans.slice().sort((a, b) => a.messageIndex - b.messageIndex || a.start - b.start);
  assert.equal(sorted[0].start, 0);
  messages.forEach((message, index) => {
    const covered = sorted
      .filter(span => span.messageIndex === index)
      .map(span => message.content.slice(span.start, span.end))
      .join('');
    // Message-owned join separators (messageFormats) are legitimate coverage
    // that reconstructs the bytes without belonging to any component.
    const expected = message.content;
    assert.ok(covered.length <= expected.length, `message ${index} over-covered`);
    assert.equal(covered.replace(/\n\n---\n\n/g, ''), expected.replace(/\n\n---\n\n/g, ''), `message ${index} must reconstruct`);
  });

  // Provenance spot-checks: the Writer directives block carries the pushed
  // brief text (soft feedback + writer_brief + pacing) as one writer.directives
  // occurrence; the final action is a first-class component.
  const byId = {};
  for (const occurrence of manifest.occurrences) {
    byId[occurrence.componentId] = byId[occurrence.componentId] || [];
    byId[occurrence.componentId].push(occurrence);
  }
  assert.ok(byId['writer.directives']?.length >= 1, 'Writer directives must be traced');
  const suffixText = messages.at(-2)?.content || messages.at(-1)?.content || '';
  assert.match(suffixText, /Reveal the old telescope/, 'legacy suffix carries the pushed brief');
  assert.ok(byId['core.writer.current_action']?.length === 1, 'Current action must appear exactly once');
  assert.ok(byId['root.simulation']?.length >= 1, 'Simulation must be traced');
});

test('shadow prepared prompt stays byte-identical without CoT', async () => {
  const context = createContext();
  context.writerCoTEnabled = false;
  context.processed.director = {};
  delete context.input.softFeedback;

  const messages = await promptBuilder.buildWriterMessages(context);
  const manifest = context.processed.promptBuilder.writerPromptManifest;
  assert.ok(manifest, 'shadow manifest must be recorded without CoT');
  assert.equal(messages.at(-1).role, 'user');
  assert.ok(manifest.occurrences.some(o => o.componentId === 'core.writer.current_action'));
});

test('shadow prepared prompt survives placeholders and virtual names with exact spans', async () => {
  const context = createContext();
  // Final-text transforms must live inside preparation: the manifest hash and
  // spans describe the exact bytes compared and sent, not pre-transform text.
  //
  // NOTE on legacy quirks this fixture documents: placeholder replacement
  // applies to the whole shared system message, the shared chat replay, and
  // the Writer suffix, but NOT to the precomputed simulation user message;
  // the virtual-name strip applies to the system message and suffix only.
  // Legacy chat content keeps its virtual-name text verbatim (precomputed).
  context.input.playerCharacterName = 'Ari';
  context.input.userPrompt = '[USER_CHARACTER] touches the vault console.';
  const occ = (componentId, text, instanceKey = null) => ({ kind: 'component', componentId, instanceKey, text, children: [], owner: 'core' });
  context.promptComponents.root.canon = [occ('core.canon.static_lore_file', '[USER_CHARACTER] keeps a z_virtual_brass key.', 'test-canon-0')];
  context.promptComponents.root.simulation = [occ('root.simulation', 'Ari stands by the vault door.')];
  stampSourceIds(context.promptComponents);
  context.runtime.historyData.chatHistory = [
    { role: 'user', content: '[USER_CHARACTER] asks about the z_virtual_key.' },
    { role: 'assistant', content: 'It glints on the z_virtual_hook.' }
  ];
  delete context.input.softFeedback;

  const messages = await promptBuilder.buildWriterMessages(context);
  const prepared = context.processed.promptBuilder.writerPromptPrepared;
  assert.ok(prepared?.manifest, 'prepared copy must be recorded for the post-hook gate');
  assert.equal(prepared.hash, context.processed.promptBuilder.writerPromptPreparedHash);

  const joined = messages.map(m => m.content).join('\n');
  assert.match(joined, /Ari touches the/);
  assert.match(joined, /Ari keeps a brass key/);
  assert.doesNotMatch(joined, /\[USER_CHARACTER\] keeps/);
  for (const message of messages) {
    if (message.role !== 'user' || !message.content.includes('asks about')) continue;
    assert.match(message.content, /z_virtual_key/, 'legacy replay keeps virtual names verbatim');
  }
  const sorted = prepared.manifest.spans.slice().sort((a, b) => a.messageIndex - b.messageIndex || a.start - b.start);
  assert.equal(sorted[0].start, 0);
  messages.forEach((message, index) => {
    const covered = sorted
      .filter(span => span.messageIndex === index)
      .map(span => message.content.slice(span.start, span.end))
      .join('');
    assert.equal(covered, message.content, `message ${index} spans must reconstruct final bytes`);
  });
});

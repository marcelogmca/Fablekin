const test = require('node:test');
const assert = require('node:assert/strict');
const cancellation = require('../pipeline_cancellation.js');
const TurnContext = require('../turncontext.js');
const {
  buildVnBackgroundMessages,
  buildVnBackgroundPrefix,
  buildVnBackgroundPrompt,
  initializeVnBackgroundLlmContext,
  waitForVnBackgroundCacheSlot
} = require('./background_llm_cache.js');

const occ = (componentId, text, owner = 'core') =>
  ({ kind: 'component', componentId, instanceKey: null, text, children: [], owner });

function createTurnContext() {
  const context = new TurnContext('Test Story');
  context.turnNumber = 7;
  context.input.playerCharacterName = 'Ari';
  context.input.userPrompt = 'Open the door.';
  context.output.party = ['Ari', 'Mira'];
  context.processed.director = { writerBrief: 'End on a discovery.' };
  context.processed.narrativeEngine = { writerResponse: 'Ari opens the door.' };
  context.processed.vnManager = { processedLines: [{ line: 'Mira: Careful.' }] };
  context.addPromptOccurrence('root', 'canon', occ('root.canon', 'The door is ancient.'));
  context.addPromptOccurrence('root', 'dynamic_knowledge', occ('root.dynamic_knowledge', 'Mira distrusts ruins.'));
  context.addPromptOccurrence('root', 'simulation', occ('root.simulation', 'Location: Vault'));
  context.addPromptOccurrence('root', 'history', occ('root.history', 'They found the vault last turn.'));
  return context;
}

test('background context excludes the current scene and shares an exact prefix', () => {
  const turnContext = createTurnContext();
  const shared = initializeVnBackgroundLlmContext(turnContext);
  turnContext.processed.vnManager.processedLines[0].line = 'Changed later.';

  const relationship = buildVnBackgroundMessages(turnContext, 'Extract relationships.', { scene: 'raw' });
  const objective = buildVnBackgroundMessages(turnContext, 'Extract objectives.', { scene: 'indexedScene' });

  assert.equal(initializeVnBackgroundLlmContext(turnContext), shared);
  assert.deepEqual(relationship.slice(0, 2), objective.slice(0, 2));
  assert.doesNotMatch(relationship[1].content, /Ari opens the door|Mira: Careful/);
  assert.match(relationship[2].content, /Ari opens the door/);
  assert.match(objective[2].content, /0\. Changed later\./);
  assert.notEqual(relationship[3].content, objective[3].content);
});

test('followers release in two waves without waiting for leader completion', async () => {
  const turnContext = createTurnContext();
  const settings = { infrastructure: { prompt_caching: { vn_background: { enabled: true, follower_delay_ms: 20 } } } };
  const leader = await waitForVnBackgroundCacheSlot(turnContext, 'summary', { settings });
  const started = Date.now();
  const warmupPromise = waitForVnBackgroundCacheSlot(turnContext, 'plugin-a', { settings })
    .then(result => ({ result, elapsed: Date.now() - started }));
  const followerPromise = waitForVnBackgroundCacheSlot(turnContext, 'plugin-b', { settings })
    .then(result => ({ result, elapsed: Date.now() - started }));
  const [warmup, follower] = await Promise.all([warmupPromise, followerPromise]);

  assert.equal(leader.role, 'leader');
  assert.equal(warmup.result.role, 'warmup_follower');
  assert.equal(follower.result.role, 'follower');
  assert.equal(follower.result.leaderKey, 'summary');
  assert.equal(follower.result.warmupFollowerKey, 'plugin-a');
  assert.ok(warmup.elapsed >= 10);
  assert.ok(follower.elapsed >= 30);
});

test('disabled gates and independent turns do not share leaders', async () => {
  const disabledSettings = { infrastructure: { prompt_caching: { vn_background: { enabled: false } } } };
  const disabled = await waitForVnBackgroundCacheSlot(createTurnContext(), 'disabled', { settings: disabledSettings });
  const first = await waitForVnBackgroundCacheSlot(createTurnContext(), 'first', {
    settings: { infrastructure: { prompt_caching: { vn_background: { follower_delay_ms: 0 } } } }
  });
  const second = await waitForVnBackgroundCacheSlot(createTurnContext(), 'second', {
    settings: { infrastructure: { prompt_caching: { vn_background: { follower_delay_ms: 0 } } } }
  });

  assert.equal(disabled.role, 'disabled');
  assert.equal(first.role, 'leader');
  assert.equal(second.role, 'leader');
});

test('shared messages require a suffix', () => {
  assert.throws(() => buildVnBackgroundMessages(createTurnContext(), ''), /non-empty suffix/);
});

test('plugin simulation pieces keep provenance inside the capsule message', () => {
  const context = createTurnContext();
  const { buildTools } = require('../plugin_manager/runtime/tools_builder.js');
  const tools = buildTools(
    { plugins: new Map(), disabledPlugins: new Map(), promptRegistry: new Map() },
    'world_state_tracker', context
  );
  assert.equal(tools.prompt.contribute({
    id: 'world_state_context', to: 'root.simulation',
    label: 'World state context', description: 'Pre-action world state and continuity updates.',
    children: { current_state: '<current_state>Harbor at dawn.</current_state>' },
    directable: true
  }), true);

  const prepared = buildVnBackgroundPrompt(context, 'Extract relationships.', { scene: 'none' });
  // Exactly system + capsule + suffix for scene none.
  assert.equal(prepared.messages.length, 3);
  const capsule = prepared.messages[1].content;
  assert.match(capsule, /Harbor at dawn/);
  assert.match(capsule, /directable_plugin="world_state_tracker"/);
  assert.match(capsule, /SELECTED DYNAMIC KNOWLEDGE:\nMira distrusts ruins\./);
  // Trusted inclusion: the capsule message carries the plugin BYTES with its
  // semantic catalogue identity — EXACTLY parent + child (no synthetic
  // duplicates), spans slice to actual text, and the `source` reference
  // (stable sourceId, never a positional index) ties this rendering to the
  // same stored TurnContext occurrence Writer/Director use. No reparenting:
  // the componentIds still parent to root.simulation.
  assert.match(capsule, /Harbor at dawn/);
  const pluginOccs = prepared.manifest.occurrences.filter(o => String(o.componentId || '').startsWith('world_state_tracker.'));
  assert.equal(pluginOccs.length, 2, `exactly parent + child occurrences (have ${pluginOccs.length})`);
  const parentOcc = pluginOccs.find(o => o.componentId === 'world_state_tracker.world_state_context');
  const childOcc = pluginOccs.find(o => o.componentId === 'world_state_tracker.world_state_context.current_state');
  assert.ok(parentOcc && childOcc, 'parent and child must both render');
  const storedOcc = context.promptComponents.root.simulation.find(o => o.componentId === 'world_state_tracker.world_state_context');
  const storedChild = storedOcc.children[0];
  assert.deepEqual(parentOcc.source, { target: 'root', slot: 'simulation', sourceId: storedOcc.sourceId });
  assert.deepEqual(childOcc.source, { target: 'root', slot: 'simulation', sourceId: storedChild.sourceId });
  assert.notEqual(storedChild.sourceId, storedOcc.sourceId, 'parent and child sourceIds must differ');
  assert.equal(childOcc.containerOccurrenceId, parentOcc.occurrenceId, 'child must nest under the rendered parent, not a wrapper');
  // Every occurrence's own spans reconstruct its owned bytes; sorted spans
  // reconstruct the whole capsule with no gaps.
  const ownBytes = (occurrenceId) => prepared.manifest.spans
    .filter(s => s.occurrenceId === occurrenceId)
    .sort((a, b) => a.start - b.start)
    .map(s => capsule.slice(s.start, s.end)).join('');
  assert.match(ownBytes(childOcc.occurrenceId), /Harbor at dawn/);
  assert.equal(prepared.manifest.components['world_state_tracker.world_state_context'].parent, 'root.simulation');
  // Byte-equality gate: the prepared capsule message and the array twin
  // agree exactly (same sections, same envelope newlines).
  const { _private } = require('./background_llm_cache.js');
  assert.equal(capsule, _private.buildBackgroundCapsule(context));
});

test('capsule prefix matches the pinned byte fixture', () => {
  const context = createTurnContext();
  const { buildTools } = require('../plugin_manager/runtime/tools_builder.js');
  const tools = buildTools(
    { plugins: new Map(), disabledPlugins: new Map(), promptRegistry: new Map() },
    'world_state_tracker', context
  );
  tools.prompt.contribute({
    id: 'world_state_context', to: 'root.simulation',
    label: 'World state context', description: 'Pre-action world state and continuity updates.',
    children: { current_state: '<current_state>Harbor at dawn.</current_state>' },
    directable: true
  });
  const prepared = buildVnBackgroundPrefix(context);
  // Byte baseline (restored to the pre-cutover HEAD envelope): HEAD's
  // buildBackgroundCapsule() template joined envelope markers to sections
  // with '\n\n' — `${sections.join('\n\n')}\n\n${CLOSE}`. The typed composer
  // preserves that rule exactly: `${OPEN}\n` + sections, `\n\n` between
  // sections, `\n\n` before CLOSE. The old string template could never render
  // structured occurrences (joinSlot would emit '[object Object]'), so the
  // *rule* is what is preserved — verified here with a fixed literal. Any
  // intentional envelope change must update this fixture AND the hash below.
  const expectedCapsule = '=== SHARED VN BACKGROUND CONTEXT ===\n'
    + 'PROJECT: Test Story\nTURN: 7\nPLAYER: Ari\nPARTY: Ari, Mira\n\n'
    + 'CURRENT USER INPUT:\nOpen the door.\n\n'
    + 'DIRECTOR BRIEF:\nEnd on a discovery.\n\n'
    + 'SELECTED CANON:\nThe door is ancient.\n\n'
    + 'SELECTED DYNAMIC KNOWLEDGE:\nMira distrusts ruins.\n\n'
    + 'CURRENT SIMULATION CONTEXT:\nLocation: Vault\n\n<plugin_context directable_plugin="world_state_tracker">\n<current_state>Harbor at dawn.</current_state>\n</plugin_context>\n\n'
    + 'SELECTED NARRATIVE HISTORY:\nThey found the vault last turn.\n\n'
    + '=== END SHARED VN BACKGROUND CONTEXT ===';
  assert.equal(prepared.messages.length, 2);
  assert.equal(prepared.messages[1].role, 'user');
  assert.equal(prepared.messages[1].content, expectedCapsule);
  // The composer hash IS the memoized prefix hash (exactly [system, capsule]).
  const shared = initializeVnBackgroundLlmContext(context);
  assert.equal(shared.prefixHash, prepared.hash);
  // Hash covers exactly [system, capsule] — scene/suffix never leak into it.
  const { buildVnBackgroundPrompt } = require('./background_llm_cache.js');
  const withScene = buildVnBackgroundPrompt(context, 'Task.', { scene: 'raw' });
  assert.equal(withScene.messages[0].content, prepared.messages[0].content);
  assert.equal(withScene.messages[1].content, prepared.messages[1].content);
});

test('a cancelled follower rejects before reaching its LLM call', async () => {
  const run = cancellation.createRunContext('background-cache-cancel');
  const turnContext = createTurnContext();
  const settings = { infrastructure: { prompt_caching: { vn_background: { follower_delay_ms: 20 } } } };

  await cancellation.runWithContext(run, async () => {
    await waitForVnBackgroundCacheSlot(turnContext, 'leader', { settings });
    const follower = waitForVnBackgroundCacheSlot(turnContext, 'follower', { settings });
    setTimeout(() => {
      run.cancelled = true;
      run.reason = 'test cancellation';
    }, 5);
    await assert.rejects(follower, /Generation cancelled/);
  });
});

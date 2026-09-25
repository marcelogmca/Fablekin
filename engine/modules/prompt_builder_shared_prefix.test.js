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

function createContext() {
  return {
    projectName: 'SharedPromptTest',
    turnNumber: 3,
    creationTurnNumber: 3,
    sceneMode: 'mainline',
    writerCoTEnabled: true,
    input: {
      playerCharacterName: 'Ari',
      userPrompt: 'Open the observatory door.',
      softFeedback: 'Keep the discovery quiet.'
    },
    processed: {
      promptBuilder: { foundationGathered: true, messages: [] },
      director: { writerBrief: 'Reveal the old telescope, but not its origin.' },
      writerCoTInsertions: []
    },
    promptComponents: {
      root: {
        protocol: ['<system_directives>Shared style directive.</system_directives>'],
        canon: ['The observatory is abandoned.'],
        dynamic_knowledge: ['Ari found a brass key.'],
        simulation: ['Location: Observatory entrance.'],
        history: [],
        directives: ['Avoid melodrama.']
      },
      writer: {
        protocol: [],
        canon: [],
        dynamic_knowledge: [],
        simulation: ['Writer sees a private sensory note.'],
        history: [],
        directives: ['Writer-only final override.']
      },
      director: {
        protocol: ['Director-private protocol addition.'],
        canon: [],
        dynamic_knowledge: [],
        simulation: ['Director sees a private long-term plan.'],
        history: [],
        directives: ['Director-only planning constraint.']
      }
    },
    runtime: {
      historyData: {
        narrativeHistory: 'Chapter 1 narrative.',
        summaryHistory: 'Chapter 1 summary.',
        chatHistory: [
          { role: 'user', content: 'Ari: Where does this key belong?' },
          { role: 'assistant', content: 'The key glints beneath the moon.' }
        ]
      },
      chapterHistory: {
        synopsischapters: [],
        summarychapters: [],
        fullchapters: [{
          turnNumber: 2,
          postContent: { userInputInjection: 'The observatory alarm remains disabled.' }
        }]
      }
    }
  };
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
  assert.equal(isWriterPromptSnapshotCompatible({ schemaVersion: 1 }), false);
  assert.equal(isWriterPromptSnapshotCompatible({ schemaVersion: 2 }), true);
  assert.equal(isWriterPromptSnapshotCompatible({ schemaVersion: 99 }), false);
});

test('both Director calls retain the shared prefix before private messages', async () => {
  const context = createContext();
  const directorData = await promptBuilder.buildDirectorPromptData(context);
  const prompt = {
    sharedMessages: directorData.sharedMessages,
    contextMessage: 'Director private context',
    analysisInstructions: 'Director analysis protocol',
    ledgerInstructions: 'Director ledger protocol'
  };
  const analysis = director._test.buildDirectorAnalysisMessages(prompt);
  const ledger = director._test.buildDirectorLedgerMessages(prompt, 'Analysis response');

  assert.deepEqual(analysis.slice(0, directorData.sharedMessages.length), directorData.sharedMessages);
  assert.deepEqual(ledger.slice(0, directorData.sharedMessages.length), directorData.sharedMessages);
  assert.equal(ledger.at(-2).role, 'assistant');
  assert.equal(ledger.at(-1).content, 'Director ledger protocol');
});

test('plugin root injection closes after freezing while scoped suffix injection remains open', async () => {
  const context = createContext();
  await promptBuilder.prepareSharedNarrativePrefix(context);
  const tools = buildTools({ plugins: new Map(), disabledPlugins: new Map() }, 'test_plugin', context);
  const rootCount = context.promptComponents.root.canon.length;
  const writerCount = context.promptComponents.writer.canon.length;

  assert.equal(tools.prompt.inject('canon', 'too late', 'root'), false);
  assert.equal(tools.prompt.inject('canon', 'writer suffix', 'writer'), true);
  assert.equal(context.promptComponents.root.canon.length, rootCount);
  assert.equal(context.promptComponents.writer.canon.length, writerCount + 1);
});

test('directable prompt injections identify the calling plugin', () => {
  const context = createContext();
  const tools = buildTools({ plugins: new Map(), disabledPlugins: new Map() }, 'world_state_tracker', context);

  assert.equal(tools.prompt.inject('simulation', '<world_state>Clear skies.</world_state>', 'root', { directable: true }), true);
  assert.equal(
    context.promptComponents.root.simulation.at(-1),
    '<plugin_context directable_plugin="world_state_tracker">\n<world_state>Clear skies.</world_state>\n</plugin_context>'
  );

  tools.prompt.inject('simulation', '<ambient>Birdsong.</ambient>', 'root');
  assert.equal(context.promptComponents.root.simulation.at(-1), '<ambient>Birdsong.</ambient>');
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
  context._chapterManagement = {
    getWriterPromptSnapshotByDbId: async () => ({
      schemaVersion: 2,
      promptComponents: {
        root: {
          canon: ['Restored parent canon.'],
          dynamic_knowledge: [],
          simulation: ['Restored parent state.']
        },
        writer: {
          canon: [],
          dynamic_knowledge: [],
          simulation: ['Restored Writer-private state.'],
          directives: ['Restored Writer-only instruction.']
        }
      }
    })
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
  assert.equal(manifest.version, 1);
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
  context.promptComponents.root.canon = ['[USER_CHARACTER] keeps a z_virtual_brass key.'];
  context.promptComponents.root.simulation = ['Ari stands by the vault door.'];
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

const assert = require('node:assert');
const test = require('node:test');
const logic = require('./logic.js');

function dialogue(character, text) {
  return {
    type: 'dialogue',
    character,
    text,
    line: `${character}: ${text}`,
    crc: '0'
  };
}

function narrative(line) {
  return {
    type: 'narrative',
    line,
    crc: '0'
  };
}

test('speaker label audit lists parser-derived speaker candidates', () => {
  const lines = [
    dialogue('Candace, nervous', "Guys, let's move!"),
    dialogue('Storm far away', 'we hear thundering.'),
    narrative('The dunes swallow the echo.')
  ];

  const audit = logic._private.formatSpeakerLabelAudit(lines);

  assert.match(audit, /<speaker_label_candidates>/);
  assert.match(audit, /label="Candace, nervous"/);
  assert.match(audit, /example: Candace, nervous: Guys, let's move!/);
  assert.match(audit, /label="Storm far away"/);
});

test('checker messages include speaker label audit before the tagged draft', () => {
  const lines = [
    dialogue('Candace, nervous', "Guys, let's move!"),
    dialogue('Storm far away', 'we hear thundering.')
  ];
  const turnContext = {
    processed: {
      promptBuilder: { messages: [] },
      vnManager: { processedLines: lines },
      dialogueProcessor: {
        dialogue: logic.buildScriptFromLines(lines)
      }
    }
  };

  const messages = logic.buildCheckerMessages(turnContext, 'Prompt body.', { speaker_label_audit: true });
  const content = messages[messages.length - 1].content;

  assert(content.indexOf('<speaker_label_candidates>') < content.indexOf('<draft_to_validate>'));
  assert.match(content, /label="Candace, nervous"/);
});

test('checker sends instructions plus the review target, without cloning the Writer conversation', () => {
  const writerMessages = [
    { role: 'system', content: 'Writer system prompt.' },
    { role: 'user', content: 'Write the next scene.' }
  ];
  const lines = [dialogue('Aether', 'We should go.')];
  const turnContext = {
    runtime: { narrativeEngine: { writerRequestMessages: writerMessages } },
    processed: {
      promptBuilder: { messages: writerMessages },
      narrativeEngine: { writerResponse: 'Aether studies the road.\nAether: We should go.' },
      vnManager: { processedLines: lines },
      dialogueProcessor: { dialogue: logic.buildScriptFromLines(lines) }
    }
  };

  const messages = logic.buildCheckerMessages(turnContext, 'Check this draft.', {});

  assert.deepStrictEqual(messages.map(m => m.role), ['system', 'user']);
  assert.equal(messages[0].content, 'Check this draft.');
  assert.match(messages[1].content, /<draft_to_validate>/);
  // The Writer's conversation must never be replayed into the checker.
  const joined = messages.map(m => m.content).join('\n');
  assert.doesNotMatch(joined, /Writer system prompt\./);
  assert.doesNotMatch(joined, /Write the next scene\./);
});

test('checker messages are named semantically, not by position', () => {
  const named = logic._private.namePromptMessages([
    { role: 'system', content: 'Instructions.' },
    { role: 'user', content: 'Draft.' }
  ], 'check');
  assert.deepStrictEqual(named.map(m => m.piece), ['check.instructions', 'check.review_target']);
  const single = logic._private.namePromptMessages([{ role: 'user', content: 'Only.' }], 'flag.consistency');
  assert.deepStrictEqual(single.map(m => m.piece), ['flag.consistency']);
});

test('checker model assignment reuses the Writer by default', () => {
  const settings = logic.resolveSettings({});
  const tools = {
    llm: {
      getCoreModel: () => ({
        model: 'veryhighendmodel',
        resolvedModel: 'deepseek/deepseek-v4-pro-cheaper:thinking',
        subprovider: 'deepseek'
      }),
      getPluginModel: () => ({
        model: 'highendmodel',
        resolvedModel: 'deepseek/deepseek-v4-flash:thinking',
        subprovider: null
      })
    }
  };

  const assignment = logic._private.resolveCheckerModelAssignment(settings, tools);

  assert.equal(assignment.source, 'writer');
  assert.equal(assignment.model, 'veryhighendmodel');
  assert.equal(assignment.provider, 'nano_gpt');
  assert.equal(assignment.subprovider, 'deepseek');
});

test('checker model assignment uses its plugin model when reuse is disabled', () => {
  const settings = logic.resolveSettings({ reuse_writer_model: false });
  const tools = {
    llm: {
      getCoreModel: () => ({ model: 'veryhighendmodel' }),
      getPluginModel: () => ({
        model: 'highendmodel',
        resolvedModel: 'deepseek/deepseek-v4-flash:thinking'
      })
    }
  };

  const assignment = logic._private.resolveCheckerModelAssignment(settings, tools);

  assert.equal(assignment.source, 'plugin');
  assert.equal(assignment.model, 'highendmodel');
  assert.equal(assignment.provider, 'openrouter');
});

test('patches may convert a small number of dialogue lines to narration', () => {
  const lines = [
    dialogue('Candace', "Guys, let's move!"),
    dialogue('Storm far away', 'we hear thundering.'),
    dialogue('Aether', 'Stay close.'),
    dialogue('Dehya', 'I have the rear.')
  ];
  const patchScript = [
    '<<<<<<< SEARCH',
    'Storm far away: we hear thundering.',
    '=======',
    'Storm far away, thunder rolls.',
    '>>>>>>> REPLACE'
  ].join('\n');

  const result = logic.applySearchReplaceScriptToLines(lines, patchScript, {
    dialogue_count_delta_percent: 0.05,
    dialogue_count_delta_max: 3
  });

  assert.strictEqual(result.stats.acceptedCount, 1);
  assert.strictEqual(result.stats.dialogueCountDelta, -1);
  assert.strictEqual(lines[1].type, 'narrative');
  assert.strictEqual(lines[1].line, 'Storm far away, thunder rolls.');
});

test('HQ settings default to disabled with quality model and limits', () => {
  const settings = logic.resolveSettings({});

  assert.equal(settings.hq_multipass_enabled, false);
  assert.equal(settings.hq_quality_model_def.model, 'lowendmodel');
  assert.equal(settings.hq_corrector_max_tokens, 2000);
  assert.equal(settings.hq_max_flags_per_agent, 4);
  assert.equal(settings.hq_history_count, 10);
  assert.equal(settings.hq_concurrency, 6);
});

test('HQ settings preserve explicit multipass values', () => {
  const settings = logic.resolveSettings({
    hq_multipass_enabled: true,
    hq_quality_model_def: { model: 'mediumendmodel' },
    hq_corrector_max_tokens: 1500,
    hq_max_flags_per_agent: 2,
    hq_history_count: 5,
    hq_concurrency: 3
  });

  assert.equal(settings.hq_multipass_enabled, true);
  assert.equal(settings.hq_quality_model_def.model, 'mediumendmodel');
  assert.equal(settings.hq_corrector_max_tokens, 1500);
  assert.equal(settings.hq_max_flags_per_agent, 2);
  assert.equal(settings.hq_history_count, 5);
  assert.equal(settings.hq_concurrency, 3);
});

test('compressed flag messages exclude the full Writer prompt', () => {
  const messages = logic.buildCompressedFlagMessages('Category rules.', {
    dialogueText: 'Aether: We move at dawn.',
    historyText: 'Chapter 1 [SUMMARY]: They met.',
    activeCharacters: ['Aether'],
    characterGenders: {},
    worldStateSummary: ''
  }, {});

  assert.equal(messages.length, 1);
  const content = messages[0].content;
  assert.match(content, /Category rules\./);
  assert.match(content, /<draft_to_validate>/);
  assert.match(content, /Aether: We move at dawn\./);
  assert.match(content, /<compact_history>/);
  assert.match(content, /They met\./);
  assert.ok(!content.includes('Writer system prompt'));
});

test('flag findings parse JSON arrays and cap per-agent counts', () => {
  const content = JSON.stringify([
    { quote: 'a', reason: 'r1', rewrite_hint: 'h1' },
    { quote: 'b', reason: 'r2', rewrite_hint: 'h2' },
    { quote: '', reason: 'r3', rewrite_hint: 'h3' },
    { quote: 'c', reason: 'r4' }
  ]);

  const findings = logic.parseFlagFindings(content, 'cat1_banned_phrases', 2);

  assert.equal(findings.length, 2);
  assert.equal(findings[0].category, 'cat1_banned_phrases');
  assert.equal(findings[0].quote, 'a');
  assert.deepEqual(logic.parseFlagFindings('not json at all', 'cat1_banned_phrases', 4), []);
  assert.deepEqual(logic.parseFlagFindings('[]', 'cat1_banned_phrases', 4), []);
  assert.deepEqual(logic.parseFlagFindings('', 'cat1_banned_phrases', 4), []);
});

test('corrector sends instructions plus findings and the tagged draft, without the Writer conversation', () => {
  const writerMessages = [
    { role: 'system', content: 'Writer system prompt.' },
    { role: 'user', content: 'Write the next scene.' }
  ];
  const lines = [dialogue('Aether', 'We should go.')];
  const turnContext = {
    processed: {
      promptBuilder: { messages: writerMessages },
      narrativeEngine: { writerResponse: 'Aether: We should go.' },
      vnManager: { processedLines: lines },
      dialogueProcessor: { dialogue: logic.buildScriptFromLines(lines) }
    }
  };
  const findings = [{
    key: 'consistency',
    label: 'Consistency',
    findings: [{ quote: 'Aether: We should go.', reason: 'Wrong direction.', rewrite_hint: 'Change to stay.' }]
  }];

  const messages = logic.buildCorrectorMessages(turnContext, 'Fix it.', findings, {});

  assert.deepStrictEqual(messages.map(m => m.role), ['system', 'user']);
  assert.equal(messages[0].content, 'Fix it.');
  const review = messages[1].content;
  assert.match(review, /<flagged_findings>/);
  assert.match(review, /Wrong direction\./);
  assert.match(review, /<draft_to_validate>/);
  const joined = messages.map(m => m.content).join('\n');
  assert.doesNotMatch(joined, /Writer system prompt\./);
});

function makeHqTurnContext(lines) {
  return {
    processed: {
      promptBuilder: { messages: [{ role: 'user', content: 'Write.' }] },
      narrativeEngine: { writerResponse: 'Aether keeps polishing his sword.\nAether: I used to be a warrior, all I knew was duty, but now I feel free.' },
      vnManager: { processedLines: lines },
      dialogueProcessor: { dialogue: logic.buildScriptFromLines(lines) }
    },
    async getFormattedHistory() {
      return 'Chapter 1 [SUMMARY]: Prior events.';
    }
  };
}

function hqTwoLineContext() {
  const lines = [
    dialogue('Aether', 'We ride at dawn.'),
    dialogue('Aether', 'I used to be a warrior, all I knew was rigidity and duty, but now I feel free.')
  ];
  return { lines, turnContext: makeHqTurnContext(lines) };
}

const HQ_FLAGGED_LINE = 'Aether: I used to be a warrior, all I knew was rigidity and duty, but now I feel free.';
const HQ_FIXED_LINE = 'Aether: I used to be a warrior, all I knew was rigidity and duty, but now I choose my own road.';

function makeHqTools(state, calls, { withBatch = true, failFlag = null, correctorPatch = true } = {}) {
  const tools = {
    settings: { getSelf: () => ({ hq_multipass_enabled: true }) },
    llm: {
      getPluginModel: () => null,
      getCoreModel: () => null,
      runTask: async (task) => {
        calls.push(task.msg);
        if (task.msg.startsWith('Post Writer HQ Flag')) {
          if (failFlag && task.msg.includes(failFlag)) {
            throw new Error(`flag agent boom: ${failFlag}`);
          }
          if (task.msg.includes('Banned')) {
            return {
              content: JSON.stringify([{
                quote: HQ_FLAGGED_LINE,
                reason: 'Identity-reset monologue.',
                rewrite_hint: 'Show the change through action instead.'
              }])
            };
          }
          return { content: '[]' };
        }
        if (!correctorPatch) return { content: 'No corrections needed.' };
        return {
          content: [
            '<<<<<<< SEARCH',
            HQ_FLAGGED_LINE,
            '=======',
            HQ_FIXED_LINE,
            '>>>>>>> REPLACE'
          ].join('\n')
        };
      }
    },
    logger: { log: () => {}, runtime: () => {} },
    pluginState: { turn: () => state }
  };
  if (withBatch) {
    tools.llm.batch = async (items, factory) => {
      const results = [];
      for (let i = 0; i < items.length; i++) {
        const task = await factory(items[i], i, items);
        try {
          results.push({ status: 'fulfilled', value: await tools.llm.runTask(task), index: i });
        } catch (error) {
          results.push({ status: 'rejected', reason: error, index: i });
        }
      }
      return results;
    };
  }
  return tools;
}

test('HQ check fans out to 6 flaggers then corrects with patches', async () => {
  const { lines, turnContext } = hqTwoLineContext();
  const calls = [];
  const state = {};
  const tools = makeHqTools(state, calls, { withBatch: true });

  const stats = await logic.runHqCheck(turnContext, tools);

  assert.equal(stats.mode, 'hq');
  assert.equal(stats.acceptedCount, 1);
  assert.equal(stats.flagCount, 1);
  assert.equal(stats.perAgent.length, 6);
  const flagCalls = calls.filter(msg => msg.startsWith('Post Writer HQ Flag'));
  assert.equal(flagCalls.length, 6);
  assert.ok(calls.includes('Post Writer HQ Corrector'));
  assert.match(lines[1].line, /choose my own road/);
  assert.ok(Array.isArray(state.hqFindings));
  assert.equal(state.hqFindings.length, 6);
  const banned = state.hqFindings.find(agent => agent.key === 'cat1_banned_phrases');
  assert.equal(banned.findings.length, 1);
});

test('HQ check works without tools.llm.batch via the settled fallback', async () => {
  const { lines, turnContext } = hqTwoLineContext();
  const calls = [];
  const state = {};
  const tools = makeHqTools(state, calls, { withBatch: false });

  const stats = await logic.runHqCheck(turnContext, tools);

  assert.equal(stats.mode, 'hq');
  assert.equal(stats.acceptedCount, 1);
  assert.equal(calls.filter(msg => msg.startsWith('Post Writer HQ Flag')).length, 6);
  assert.match(lines[1].line, /choose my own road/);
});

test('HQ check continues when a flag agent fails', async () => {
  const { lines, turnContext } = hqTwoLineContext();
  const calls = [];
  const state = {};
  const tools = makeHqTools(state, calls, { withBatch: false, failFlag: 'Dialogue', correctorPatch: false });

  const stats = await logic.runHqCheck(turnContext, tools);

  assert.equal(stats.mode, 'hq');
  assert.equal(stats.acceptedCount, 0);
  assert.equal(stats.flagCount, 1);
  const dialogueAgent = stats.perAgent.find(agent => agent.key === 'cat3_dialogue');
  assert.equal(dialogueAgent.failed, true);
  assert.ok(calls.includes('Post Writer HQ Corrector'));
  assert.match(lines[1].line, /rigidity and duty/);
});

test('patches are rejected when cumulative dialogue count delta exceeds tolerance', () => {
  const lines = [
    dialogue('Storm far away', 'we hear thundering.'),
    dialogue('Wind over camp', 'canvas snaps.'),
    dialogue('Aether', 'Stay close.'),
    dialogue('Dehya', 'I have the rear.')
  ];
  const patchScript = [
    '<<<<<<< SEARCH',
    'Storm far away: we hear thundering.',
    'Wind over camp: canvas snaps.',
    '=======',
    'Storm far away, thunder rolls.',
    'Wind over camp, canvas snaps.',
    '>>>>>>> REPLACE'
  ].join('\n');

  const result = logic.applySearchReplaceScriptToLines(lines, patchScript, {
    dialogue_count_delta_percent: 0.05,
    dialogue_count_delta_max: 3
  });

  assert.strictEqual(result.stats.acceptedCount, 0);
  assert.strictEqual(result.stats.rejectedCount, 1);
  assert.strictEqual(result.stats.rejections[0].reason, 'dialogue_count_delta_exceeded');
  assert.strictEqual(lines[0].type, 'dialogue');
  assert.strictEqual(lines[1].type, 'dialogue');
});

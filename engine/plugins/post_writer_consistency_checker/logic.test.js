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

test('checker messages preserve the Writer context then append output and review instructions', () => {
  const writerMessages = [
    { role: 'system', content: 'Writer system prompt.' },
    { role: 'user', content: 'Write the next scene.' }
  ];
  const lines = [dialogue('Aether', 'We should go.')];
  const turnContext = {
    processed: {
      promptBuilder: { messages: writerMessages },
      narrativeEngine: { writerResponse: 'Aether studies the road.\nAether: We should go.' },
      vnManager: { processedLines: lines },
      dialogueProcessor: { dialogue: logic.buildScriptFromLines(lines) }
    }
  };

  const messages = logic.buildCheckerMessages(turnContext, 'Check this draft.', {});

  assert.deepStrictEqual(messages.slice(0, 2), writerMessages);
  assert.deepStrictEqual(messages[2], {
    role: 'assistant',
    content: 'Aether studies the road.\nAether: We should go.'
  });
  assert.equal(messages[3].role, 'user');
  assert.match(messages[3].content, /^Check this draft\./);
  assert.match(messages[3].content, /<draft_to_validate>/);
});

test('checker messages prefer the exact runtime Writer request snapshot', () => {
  const exactWriterMessages = [
    { role: 'system', content: 'Exact cached prefix.' },
    { role: 'user', content: 'Exact Writer request.' }
  ];
  const lines = [dialogue('Aether', 'Forward.')];
  const turnContext = {
    runtime: {
      narrativeEngine: { writerRequestMessages: exactWriterMessages }
    },
    processed: {
      promptBuilder: {
        messages: [{ role: 'user', content: 'Stale prompt builder state.' }]
      },
      narrativeEngine: { writerResponse: 'Aether: Forward.' },
      vnManager: { processedLines: lines },
      dialogueProcessor: { dialogue: logic.buildScriptFromLines(lines) }
    }
  };

  const messages = logic.buildCheckerMessages(turnContext, 'Review.', {});

  assert.deepStrictEqual(messages.slice(0, 2), exactWriterMessages);
  assert.equal(messages[2].role, 'assistant');
  assert.equal(messages[3].role, 'user');
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

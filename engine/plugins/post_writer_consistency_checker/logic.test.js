const assert = require('node:assert');
const test = require('node:test');
const logic = require('./logic.js');
const plugin = require('./index.js');

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

test('flag payloads end with CoT procedure plus an entry message that starts the review', () => {
  const named = logic._private.namePromptMessages(
    [{ role: 'system', content: 'Rules.' }, { role: 'user', content: 'Draft.' }],
    'flag.cat3_dialogue'
  );
  const payload = logic.withFlagEntryMessage(named, undefined, [logic.buildCat3DialogueCotMessage()]);
  assert.deepStrictEqual(payload.map(m => m.role), ['system', 'user', 'assistant', 'assistant']);
  const cot = payload[payload.length - 2];
  assert.equal(cot.piece, 'flag.cat3_dialogue.review_procedure');
  assert.match(cot.text, /Dialogue Review Procedure/);
  const entry = payload[payload.length - 1];
  assert.equal(entry.piece, 'flag.entry');
  assert.match(entry.text, /review procedure pass by pass/);

  // The structured payload must compile through the real request compiler with
  // both assistant turns preserved in trailing position.
  const { compilePluginRequest } = require('../../modules/prompt/request_compiler.js');
  const prepared = compilePluginRequest('post_writer_consistency_checker', 'hq_flag_cat3_dialogue', { messages: payload }, {});
  const roles = prepared.messages.map(m => m.role);
  assert.deepStrictEqual(roles, ['system', 'user', 'assistant', 'assistant']);
  assert.match(prepared.messages[2].content, /Dialogue Review Procedure/);
  assert.match(prepared.messages[3].content, /Pass 1/);
});

test('withFlagEntryMessage leaves single-message payloads usable and never mutates', () => {
  const named = [{ role: 'user', piece: 'flag.check.review_target', text: 'Draft.' }];
  const payload = logic.withFlagEntryMessage(named);
  assert.equal(named.length, 1);
  assert.deepStrictEqual(payload.map(m => m.role), ['user', 'assistant']);
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
        provider: 'nano_gpt',
        resolvedModel: 'deepseek/deepseek-v4-pro-cheaper:thinking',
        subprovider: 'deepseek'
      }),
      getPluginModel: () => ({
        model: 'highendmodel',
        provider: 'openrouter',
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

test('unified HQ assignment uses the quality route, not the Writer', () => {
  const settings = logic.resolveSettings({});
  const tools = {
    llm: {
      getCoreModel: () => ({
        model: 'veryhighendmodel',
        provider: 'nano_gpt',
        resolvedModel: 'vendor/high',
        subprovider: null
      }),
      getPluginModel: (pluginId, key) => key === 'hq_quality_model_def' ? {
        model: 'highendmodel',
        provider: 'generic',
        resolvedModel: 'generic/high',
        subprovider: null
      } : null
    }
  };

  const assignment = logic.resolveUnifiedHqAssignment(settings, tools);

  assert.equal(assignment.source, 'hq_quality');
  assert.equal(assignment.model, 'highendmodel');
  assert.equal(assignment.provider, 'generic');
});

test('unified HQ assignment falls back to settings quality model without a plugin model', () => {
  const settings = logic.resolveSettings({});
  const tools = {
    llm: {
      getCoreModel: () => ({
        model: 'veryhighendmodel',
        provider: 'nano_gpt'
      }),
      getPluginModel: () => null
    }
  };

  const assignment = logic.resolveUnifiedHqAssignment(settings, tools);

  assert.equal(assignment.source, 'hq_quality');
  assert.equal(assignment.model, 'lowendmodel');
});

test('checker model assignment uses its plugin model when reuse is disabled', () => {  const settings = logic.resolveSettings({ reuse_writer_model: false });
  const tools = {
    llm: {
      getCoreModel: () => ({ model: 'veryhighendmodel' }),
      getPluginModel: () => ({
        model: 'highendmodel',
        provider: 'openrouter',
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

test('HQ settings default to disabled with quality model and token allowances', () => {
  const settings = logic.resolveSettings({});

  assert.equal(settings.hq_multipass_enabled, false);
  assert.equal(settings.hq_quality_model_def.model, 'lowendmodel');
  assert.equal(settings.hq_corrector_max_tokens, 8000);
  assert.equal(settings.hq_flag_max_tokens, 3000);
  assert.equal(settings.hq_context_lines, 5);
  assert.equal(settings.hq_history_count, 10);
  assert.equal(settings.hq_concurrency, 6);
});

test('HQ settings preserve explicit multipass values', () => {
  const settings = logic.resolveSettings({
    hq_multipass_enabled: true,
    hq_quality_model_def: { model: 'mediumendmodel' },
    hq_corrector_max_tokens: 1500,
    hq_flag_max_tokens: 4500,
    hq_context_lines: 8,
    hq_history_count: 5,
    hq_concurrency: 3
  });

  assert.equal(settings.hq_multipass_enabled, true);
  assert.equal(settings.hq_quality_model_def.model, 'mediumendmodel');
  assert.equal(settings.hq_corrector_max_tokens, 1500);
  assert.equal(settings.hq_flag_max_tokens, 4500);
  assert.equal(settings.hq_context_lines, 8);
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
  assert.match(content, /1 \| Aether: We move at dawn\./);
  assert.match(content, /<compact_history>/);
  assert.match(content, /They met\./);
  assert.ok(!content.includes('Writer system prompt'));
});

test('flag findings group sparse occurrences and are not capped at four', () => {
  const content = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({
    rule: 'repetition',
    reason: 'Eureka is repeated.',
    scope: 'line',
    occurrences: [{ line: 10 + i, quote: `Bea: Eureka! (${i})` }, { line: 70 + i, quote: `Bea: Eureka! (${i + 6})` }]
  })));

  const findings = logic.parseFlagFindings(content, 'cat2_repetition');

  assert.equal(findings.length, 6);
  assert.equal(findings[0].category, 'cat2_repetition');
  assert.equal(findings[0].occurrences[1].line, 70);
  assert.deepEqual(logic.parseFlagFindings('not json at all', 'cat2_repetition'), []);
  assert.deepEqual(logic.parseFlagFindings('[]', 'cat2_repetition'), []);
  assert.deepEqual(logic.parseFlagFindings('', 'cat2_repetition'), []);
});

test('HQ consistency receives numbered draft and compact history without the Writer conversation', () => {
  const lines = [dialogue('Bea', 'Eureka!'), narrative('A rusted lock opened.')];
  const turnContext = { processed: { vnManager: { processedLines: lines } } };
  const messages = logic.buildCheckerMessages(turnContext, 'Consistency rules.', {}, {
    historyText: 'Bea has already found two locks.',
    worldStateSummary: 'At the vault.',
    activeCharacters: ['Bea']
  });
  assert.match(messages[1].content, /<compact_history>/);
  assert.match(messages[1].content, /1 \| Bea: Eureka!/);
  assert.match(messages[1].content, /2 \| A rusted lock opened\./);
});

test('finding verification checks each exact line and passes passage findings to the corrector', () => {
  const lines = [
    dialogue('Bea', 'Eureka!'), narrative('A door opens.'), dialogue('Bea', 'Eureka!'),
    dialogue('Bea', 'Eureka!')
  ];
  const agents = [{ key: 'repetition', findings: [
    { rule: 'catchphrase', reason: 'Repeated three times.', scope: 'line', occurrences: [
      { line: 1, quote: 'Bea: Eureka!' }, { line: 3, quote: 'Bea: Eureka!' },
      { line: 3, quote: 'Bea: Eureka!' }, { line: 2, quote: 'Bea: Eureka!' },
      { line: 4, quote: 'Bea: Eureka?' }
    ] },
    { rule: 'pacing', reason: 'This entire scene needs restructuring.', scope: 'passage', occurrences: [
      { line: 2, quote: 'A door opens.' }
    ] },
    { rule: 'hallucinated', reason: 'Not in the draft.', scope: 'line', occurrences: [
      { line: 8, quote: 'Bea: Eureka!' }
    ] }
  ] }];
  const result = logic.validateFlagFindings(agents, lines);
  assert.equal(result.flagCount, 2);
  assert.equal(result.actionable.length, 2);
  assert.equal(result.passageCount, 1);
  assert.equal(result.invalidAnchorCount, 3);
  assert.equal(result.invalidFindingCount, 1);
  assert.deepEqual(result.actionable[0].occurrences.map(x => x.line), [1, 3]);
  assert.deepEqual(result.agents[0].findings.map(x => x.id), ['F1', 'F2']);
});

test('HQ corrections can target many non-adjacent occurrences without an arbitrary eight-patch cap', () => {
  const lines = Array.from({ length: 21 }, (_, index) => index % 2 === 0
    ? dialogue('Bea', 'Eureka!') : narrative(`The room shifts ${index}.`));
  const finding = { id: 'F1', rule: 'catchphrase', scope: 'line', occurrences: lines
    .map((line, index) => index % 2 === 0 ? { line: index + 1, quote: line.line } : null)
    .filter(Boolean) };
  const hunks = finding.occurrences.map((entry, index) => ({
    start_line: entry.line, end_line: entry.line, finding_ids: ['F1'],
    replacement_lines: [`Bea: Another discovery ${index}.`]
  }));
  const result = logic.applyHqCorrectionsToLines(lines, hunks, [finding]);
  assert.equal(result.valid, true);
  assert.equal(result.stats.acceptedCount, 11);
  assert.equal(result.stats.editedLineCount, 11);
  assert.equal(lines[0].text, 'Eureka!');
  assert.equal(result.lines[1], lines[1]);
  assert.equal(result.lines[1].crc, '0');
  assert.equal(result.lines[20].text, 'Another discovery 10.');
  assert.notEqual(result.lines[20].crc, '0');
});

test('HQ can rewrite lines 10–15 around a cited line, remove lines, and insert dialogue', () => {
  const lines = Array.from({ length: 18 }, (_, i) => narrative(`Original line ${i + 1}.`));
  const findings = [{ id: 'F1', rule: 'pacing', scope: 'passage', occurrences: [
    { line: 12, quote: 'Original line 12.' }, { line: 14, quote: 'Original line 14.' }
  ] }];
  const result = logic.applyHqCorrectionsToLines(lines, [{
    start_line: 10, end_line: 15, finding_ids: ['F1'],
    replacement_lines: [
      'The lock shifts beneath Bea’s hand.',
      'Bea: Wait. There is another catch.',
      'Ari holds the door while she frees it.',
      'The mechanism clicks open.'
    ]
  }], findings);
  assert.equal(result.valid, true);
  assert.equal(result.stats.lineCountDelta, -2);
  assert.equal(result.stats.dialogueCountDelta, 1);
  assert.equal(result.lines.length, 16);
  assert.strictEqual(result.lines[8], lines[8]);
  assert.strictEqual(result.lines[13], lines[15]);
  assert.equal(result.lines[10].character, 'Bea');
  assert.notEqual(result.lines[10].crc, '0');
  assert.equal(lines[11].line, 'Original line 12.');
});

test('HQ accepts a speaker-label fix without a dialogue or line-count quota', () => {
  const lines = [dialogue('Storm far away', 'thunder rolls.'), dialogue('Bea', 'Stay close.')];
  const result = logic.applyHqCorrectionsToLines(lines, [
    { start_line: 1, end_line: 1, finding_ids: ['F1'], replacement_lines: ['Thunder rolls in the distance.'] }
  ], [{ id: 'F1', rule: 'speaker_label', scope: 'line', occurrences: [
    { line: 1, quote: 'Storm far away: thunder rolls.' }
  ] }]);
  assert.equal(result.valid, true);
  assert.equal(result.stats.acceptedCount, 1);
  assert.equal(result.stats.dialogueCountDelta, -1);
  assert.equal(result.lines[0].type, 'narrative');
});

test('HQ passage rewrites can insert lines while preserving unrelated line objects', () => {
  const lines = [narrative('The hinge refuses to move.'), dialogue('Bea', 'Eureka!'), narrative('The group retreats.')];
  const result = logic.applyHqCorrectionsToLines(lines, [{
    start_line: 2, end_line: 2, finding_ids: ['F1'],
    replacement_lines: ['Bea: The hinge has a catch.', 'Bea lifts the latch.', 'Ari: There.']
  }], [{ id: 'F1', rule: 'catchphrase', scope: 'passage', occurrences: [{ line: 2, quote: 'Bea: Eureka!' }] }]);
  assert.equal(result.valid, true);
  assert.equal(result.stats.lineCountDelta, 2);
  assert.equal(result.lines.length, 5);
  assert.strictEqual(result.lines[0], lines[0]);
  assert.strictEqual(result.lines[4], lines[2]);
  assert.equal(result.lines[2].type, 'narrative');
  assert.equal(result.lines[3].character, 'Ari');
});

test('HQ can remove a flagged line entirely while keeping its neighbors', () => {
  const lines = [narrative('The door shakes.'), dialogue('Bea', 'Eureka!'), narrative('The latch clicks.')];
  const result = logic.applyHqCorrectionsToLines(lines, [{
    start_line: 2, end_line: 2, finding_ids: ['F1'], replacement_lines: []
  }], [{ id: 'F1', rule: 'repetition', scope: 'line', occurrences: [{ line: 2, quote: 'Bea: Eureka!' }] }]);
  assert.equal(result.valid, true);
  assert.equal(result.stats.lineCountDelta, -1);
  assert.deepEqual(result.lines, [lines[0], lines[2]]);
  assert.equal(result.text, 'The door shakes.\nThe latch clicks.');
});

test('one local passage can resolve overlapping findings on the same cited line', () => {
  const lines = [dialogue('Bea', 'Eureka!'), narrative('The lock opens.')];
  const findings = ['F1', 'F2'].map(id => ({
    id, rule: id === 'F1' ? 'catchphrase' : 'voice', scope: 'line',
    occurrences: [{ line: 1, quote: 'Bea: Eureka!' }]
  }));
  const result = logic.applyHqCorrectionsToLines(lines, [{
    start_line: 1, end_line: 2, finding_ids: ['F1', 'F2'],
    replacement_lines: ['Bea: The tumblers gave way.', 'The lock opens.']
  }], findings);
  assert.equal(result.valid, true);
  assert.equal(result.stats.editedLineCount, 1);
  assert.equal(result.stats.addressedOccurrenceCount, 2);
  assert.equal(result.lines[0].character, 'Bea');
});

test('HQ rejects incomplete, unrelated, overlapping or unchanged passage edits atomically', () => {
  const lines = [dialogue('Bea', 'Eureka!'), narrative('The door holds.'), dialogue('Bea', 'Eureka!')];
  const findings = [{ id: 'F1', rule: 'catchphrase', scope: 'line', occurrences: [
    { line: 1, quote: 'Bea: Eureka!' }, { line: 3, quote: 'Bea: Eureka!' }
  ] }];
  const first = { start_line: 1, end_line: 1, finding_ids: ['F1'], replacement_lines: ['Bea: The lock shifted.'] };
  const attempts = [
    [first],
    [first, { start_line: 1, end_line: 3, finding_ids: ['F1'], replacement_lines: ['The door opens.'] }],
    [{ start_line: 1, end_line: 3, finding_ids: ['F1'], replacement_lines: ['Bea: Eureka!'] }],
    [{ start_line: 1, end_line: 3, finding_ids: ['F9'], replacement_lines: ['The door opens.'] }],
    [{ start_line: 1, end_line: 3, finding_ids: ['F1'], replacement_lines: ['1 | Numbered draft output.'] }]
  ];
  for (const hunks of attempts) {
    const result = logic.applyHqCorrectionsToLines(lines, hunks, findings);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length);
    assert.equal(lines[0].line, 'Bea: Eureka!');
    assert.equal(lines[2].line, 'Bea: Eureka!');
  }
});

test('HQ rejects a distant passage and a correction that empties the entire scene', () => {
  const lines = Array.from({ length: 18 }, (_, i) => narrative(`Line ${i + 1}.`));
  const finding = [{ id: 'F1', rule: 'pacing', scope: 'passage', repair_targets: [12],
    occurrences: [{ line: 12, quote: 'Line 12.' }] }];
  const distant = logic.applyHqCorrectionsToLines(lines, [
    { start_line: 1, end_line: 18, finding_ids: ['F1'], replacement_lines: ['A wholly new chapter.'] }
  ], finding);
  assert.equal(distant.valid, false);
  assert.match(distant.errors.join(' '), /local context/);
  const empty = logic.applyHqCorrectionsToLines([narrative('Line 12.')], [
    { start_line: 1, end_line: 1, finding_ids: ['F1'], replacement_lines: [] }
  ], [{ ...finding[0], repair_targets: [1], occurrences: [{ line: 1, quote: 'Line 12.' }] }]);
  assert.equal(empty.valid, false);
  assert.match(empty.errors.join(' '), /cannot be empty/);
});

test('ownership findings cite setup as evidence but require only the problem line to change', () => {
  const lines = [
    dialogue('Lena', 'I want the middle seat.'),
    dialogue('Marco', 'I want the middle too.'),
    narrative('They board the carriage.'),
    dialogue('Lena', "Exactly. I'll take the side, I prefer the side.")
  ];
  const agents = [{ key: 'cat3_dialogue', findings: [{
    rule: 'in_scene_ownership',
    reason: 'Lena reverses her stated seat preference with no reason given.',
    scope: 'line',
    occurrences: [
      { line: 1, quote: 'Lena: I want the middle seat.' },
      { line: 2, quote: 'Marco: I want the middle too.' },
      { line: 4, quote: "Lena: Exactly. I'll take the side, I prefer the side." }
    ],
    repair_targets: [4]
  }] }];
  const result = logic.validateFlagFindings(agents, lines);
  assert.equal(result.flagCount, 1);
  assert.deepEqual(result.actionable[0].repair_targets, [4]);

  // Fixing only the problem line while keeping the evidence verbatim is valid.
  const fixed = logic.applyHqCorrectionsToLines(lines, [{
    start_line: 4, end_line: 4, finding_ids: ['F1'],
    replacement_lines: ["Lena: Fine. Take the middle, I'll squeeze onto the side."]
  }], result.actionable);
  assert.equal(fixed.valid, true);
  assert.equal(fixed.lines[0].line, 'Lena: I want the middle seat.');
  assert.equal(fixed.lines[1].line, 'Marco: I want the middle too.');

  // A hunk that rewrites only the evidence while leaving the problem line
  // untouched must fail: the repair target was not addressed.
  const dodged = logic.applyHqCorrectionsToLines(lines, [{
    start_line: 1, end_line: 2, finding_ids: ['F1'],
    replacement_lines: ['Lena: I want the side seat.', 'Marco: I want the middle too.']
  }], result.actionable);
  assert.equal(dodged.valid, false);
  assert.match(dodged.errors.join(' '), /F1 line 4 was not rewritten/);
});

test('repair_targets outside the cited occurrences are rejected', () => {
  const agents = [{ key: 'cat3_dialogue', findings: [{
    rule: 'in_scene_ownership', reason: 'Bad target.', scope: 'line',
    occurrences: [{ line: 1, quote: 'Lena: I want the middle seat.' }],
    repair_targets: [2]
  }] }];
  const lines = [dialogue('Lena', 'I want the middle seat.'), dialogue('Marco', 'No.')];
  const result = logic.validateFlagFindings(agents, lines);
  assert.equal(result.flagCount, 0);
  assert.equal(result.invalidFindingCount, 1);
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
    id: 'F1', category: 'consistency', rule: 'direction', scope: 'line',
    reason: 'Wrong direction.', occurrences: [{ line: 1, quote: 'Aether: We should go.' }]
  }];

  const messages = logic.buildCorrectorMessages(turnContext, 'Fix it.', findings, {});

  assert.deepStrictEqual(messages.map(m => m.role), ['system', 'user']);
  assert.equal(messages[0].content, 'Fix it.');
  const review = messages[1].content;
  assert.match(review, /<flagged_findings>/);
  assert.match(review, /Wrong direction\./);
  assert.match(review, /"id": "F1"/);
  assert.match(review, /<draft_to_validate>/);
  assert.match(review, /1 \| Aether: We should go\./);
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
const HQ_FIXED_LINE = 'Aether: Hand me the whetstone. The blade needs an edge before dawn.';

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
                rule: 'identity_reset',
                reason: 'Identity-reset monologue.',
                scope: 'line',
                occurrences: [{ line: 2, quote: HQ_FLAGGED_LINE }]
              }])
            };
          }
          return { content: '[]' };
        }
        if (!correctorPatch) return { content: '{"hunks":[]}' };
        return {
          content: JSON.stringify({ hunks: [
            { start_line: 2, end_line: 2, finding_ids: ['F1'], replacement_lines: [HQ_FIXED_LINE] }
          ] })
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

test('HQ check fans out to 6 flaggers then commits a complete passage correction', async () => {
  const { lines, turnContext } = hqTwoLineContext();
  turnContext.output = {};
  Object.defineProperty(turnContext.output, 'fulltext', {
    get: () => turnContext.processed.narrativeEngine.writerResponse
  });
  turnContext.runtime = { lastSearchstring: turnContext.processed.narrativeEngine.writerResponse.substring(0, 500) };
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
  assert.match(turnContext.processed.vnManager.processedLines[1].line, /whetstone/);
  assert.equal(turnContext.output.fulltext, 'Aether: We ride at dawn.\n' + HQ_FIXED_LINE);
  assert.equal(turnContext.runtime.lastSearchstring, 'Aether: We ride at dawn.\n' + HQ_FIXED_LINE);
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
  assert.match(turnContext.processed.vnManager.processedLines[1].line, /whetstone/);
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

test('HQ sends passage-scope findings to the corrector instead of dismissing them', async () => {
  const { lines, turnContext } = hqTwoLineContext();
  const calls = [];
  const state = {};
  const tools = makeHqTools(state, calls, { withBatch: true });
  const baseRunTask = tools.llm.runTask;
  tools.llm.runTask = task => task.msg.includes('Banned')
    ? Promise.resolve({ content: JSON.stringify([{
      rule: 'scene_structure', reason: 'The scene needs broader restructuring.', scope: 'passage',
      occurrences: [{ line: 2, quote: HQ_FLAGGED_LINE }]
    }]) })
    : baseRunTask(task);

  const stats = await logic.runHqCheck(turnContext, tools);
  assert.equal(stats.flagCount, 1);
  assert.equal(stats.unaddressedCount, 0);
  assert.equal(stats.actionableCount, 1);
  assert.equal(stats.passageCount, 1);
  assert.equal(stats.acceptedCount, 1);
  assert.equal(calls.includes('Post Writer HQ Corrector'), true);
  assert.equal(state.hqFindings.find(x => x.key === 'cat1_banned_phrases').findings[0].scope, 'passage');
  assert.equal(lines[1].line, HQ_FLAGGED_LINE);
  assert.equal(turnContext.processed.vnManager.processedLines[1].line, HQ_FIXED_LINE);
});

test('HQ gives the corrector both line- and passage-scope verified findings', async () => {
  const { turnContext } = hqTwoLineContext();
  const calls = [];
  const tools = makeHqTools({}, calls, { withBatch: false });
  const baseRunTask = tools.llm.runTask;
  let correctorPayload;
  tools.llm.runTask = task => {
    if (task.msg.includes('Dialogue')) return Promise.resolve({ content: JSON.stringify([{
      rule: 'scene_balance', reason: 'A broader issue.', scope: 'passage',
      occurrences: [{ line: 1, quote: 'Aether: We ride at dawn.' }]
    }]) });
    if (task.msg === 'Post Writer HQ Corrector') {
      correctorPayload = task;
      return Promise.resolve({ content: JSON.stringify({ hunks: [
        { start_line: 1, end_line: 1, finding_ids: ['F2'], replacement_lines: ['Aether: The others should come too.'] },
        { start_line: 2, end_line: 2, finding_ids: ['F1'], replacement_lines: [HQ_FIXED_LINE] }
      ] }) });
    }
    return baseRunTask(task);
  };
  const stats = await logic.runHqCheck(turnContext, tools);
  assert.equal(stats.flagCount, 2);
  assert.equal(stats.actionableCount, 2);
  assert.equal(stats.passageCount, 1);
  assert.equal(stats.acceptedCount, 2);
  const prompt = correctorPayload.prompt.messages[1].text;
  assert.match(prompt, /"id": "F1"/);
  assert.match(prompt, /"id": "F2"/);
  assert.match(prompt, /A broader issue/);
  assert.match(prompt, /"scope": "passage"/);
  // The corrector CoT procedure plus entry message trail the payload.
  const roles = correctorPayload.prompt.messages.map(m => m.role);
  assert.deepStrictEqual(roles.slice(-2), ['assistant', 'assistant']);
  assert.match(correctorPayload.prompt.messages[correctorPayload.prompt.messages.length - 2].text, /Mandatory Correction Procedure/);
  assert.match(correctorPayload.prompt.messages[correctorPayload.prompt.messages.length - 1].text, /Step 1/);
});

test('corrector CoT file carries the six-step finding-only procedure', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(path.join(__dirname, 'hq', 'corrector_cot.txt'), 'utf8');
  for (const step of ['STEP 1', 'STEP 2', 'STEP 3', 'STEP 4', 'STEP 5', 'STEP 6']) {
    assert.match(text, new RegExp(step));
  }
  // Finding-only: the procedure maps supplied findings, never hunts new defects.
  assert.match(text, /Do not output your working notes/);
  assert.doesNotMatch(text, /cliché|participation|Visit every line/i);
  assert.match(text, /Finish mapping every finding before drafting/);
  assert.match(text, /Finish ALL ranges first/);
  assert.match(text, /Do not generate competing versions/);
});

test('cat3 dialogue CoT file carries the three-pass review procedure', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(path.join(__dirname, 'hq', 'cat3_dialogue_cot.txt'), 'utf8');
  for (const pass of ['Pass 1', 'Pass 2', 'Pass 3']) {
    assert.match(text, new RegExp(pass));
  }
  assert.match(text, /Do not draft replacement wording/);
});

test('HQ preserves findings alongside stats when the pluginState toolkit is absent', async () => {
  const { turnContext } = hqTwoLineContext();
  const tools = makeHqTools({}, [], { withBatch: false });
  delete tools.pluginState;
  const stats = await logic.runHqCheck(turnContext, tools);
  const saved = turnContext.processed.plugins.post_writer_consistency_checker;
  assert.equal(stats.acceptedCount, 1);
  assert.equal(saved.stats.acceptedCount, 1);
  assert.equal(saved.hqFindings.find(agent => agent.key === 'cat1_banned_phrases').findings[0].occurrences[0].line, 2);
});

test('HQ retries malformed corrector JSON with feedback and commits only the repaired response', async () => {
  const { turnContext } = hqTwoLineContext();
  const calls = [];
  const state = {};
  const tools = makeHqTools(state, calls, { withBatch: false });
  const baseRunTask = tools.llm.runTask;
  tools.llm.runTask = task => task.msg === 'Post Writer HQ Corrector'
    ? Promise.resolve({ content: '[{"finding_id":"F1","line":2,"replacement":' })
    : baseRunTask(task);

  const stats = await logic.runHqCheck(turnContext, tools);
  assert.equal(stats.flagCount, 1);
  assert.equal(stats.correctionAttempts, 2);
  assert.equal(stats.unaddressedCount, 0);
  assert.equal(stats.acceptedCount, 1);
  assert.ok(calls.includes('Post Writer HQ Corrector Repair'));
  assert.equal(turnContext.processed.vnManager.processedLines[1].line, HQ_FIXED_LINE);
});

test('HQ keeps original script and writerResponse when retry still misses a cited line', async () => {
  const { lines, turnContext } = hqTwoLineContext();
  const originalWriterResponse = turnContext.processed.narrativeEngine.writerResponse;
  const state = {};
  const tools = makeHqTools(state, [], { withBatch: false });
  const baseRunTask = tools.llm.runTask;
  let repairFeedback = '';
  tools.llm.runTask = task => {
    if (task.msg.includes('Dialogue')) return Promise.resolve({ content: JSON.stringify([{
      rule: 'dialogue', reason: 'Opening line is stale.', scope: 'line',
      occurrences: [{ line: 1, quote: 'Aether: We ride at dawn.' }]
    }]) });
    if (task.msg.startsWith('Post Writer HQ Corrector')) {
      // Initial call ends with the assistant entry message; the repair retry
      // appends validation feedback as a trailing user message.
      if (task.msg.endsWith('Repair')) repairFeedback = task.prompt.messages[task.prompt.messages.length - 1].text;
      return Promise.resolve({ content: JSON.stringify({ hunks: [
        { start_line: 2, end_line: 2, finding_ids: ['F1'], replacement_lines: [HQ_FIXED_LINE] }
      ] }) });
    }
    return baseRunTask(task);
  };

  const stats = await logic.runHqCheck(turnContext, tools);
  assert.equal(stats.correctionAttempts, 2);
  assert.equal(stats.acceptedCount, 0);
  assert.equal(stats.unaddressedCount, 2);
  assert.match(stats.validationErrors.join(' '), /F2 line 1/);
  assert.match(repairFeedback, /F2 line 1/);
  assert.strictEqual(turnContext.processed.vnManager.processedLines, lines);
  assert.equal(lines[1].line, HQ_FLAGGED_LINE);
  assert.equal(turnContext.processed.narrativeEngine.writerResponse, originalWriterResponse);
  assert.equal(state.stats.unaddressedCount, 2);
});

test('HQ does not apply a partial correction if a flagger cites an unverifiable line', async () => {
  const { lines, turnContext } = hqTwoLineContext();
  const tools = makeHqTools({}, [], { withBatch: false });
  const baseRunTask = tools.llm.runTask;
  let correctorCalled = false;
  tools.llm.runTask = task => {
    if (task.msg.includes('Banned')) return Promise.resolve({ content: JSON.stringify([{
      rule: 'identity_reset', reason: 'Repeated identity speech.', scope: 'line',
      occurrences: [{ line: 2, quote: HQ_FLAGGED_LINE }, { line: 1, quote: 'Aether: This is not in the draft.' }]
    }]) });
    if (task.msg.startsWith('Post Writer HQ Corrector')) correctorCalled = true;
    return baseRunTask(task);
  };
  const originalFulltext = turnContext.processed.narrativeEngine.writerResponse;
  const stats = await logic.runHqCheck(turnContext, tools);
  assert.equal(correctorCalled, false);
  assert.equal(stats.invalidAnchorCount, 1);
  assert.equal(stats.unaddressedCount, 1);
  assert.strictEqual(turnContext.processed.vnManager.processedLines, lines);
  assert.equal(turnContext.processed.narrativeEngine.writerResponse, originalFulltext);
});

test('HQ with genuinely empty findings never invokes the corrector', async () => {
  const { turnContext } = hqTwoLineContext();
  const tools = makeHqTools({}, [], { withBatch: false });
  tools.llm.runTask = async task => {
    assert.ok(task.msg.startsWith('Post Writer HQ Flag'));
    return { content: '[]' };
  };
  const stats = await logic.runHqCheck(turnContext, tools);
  assert.equal(stats.flagCount, 0);
  assert.equal(stats.acceptedCount, 0);
  assert.equal(stats.unaddressedCount, 0);
});

test('HQ mode runs after dialogue processing instead of registering a late VN pipeline task', async () => {
  const { turnContext } = hqTwoLineContext();
  const tools = makeHqTools({}, [], { withBatch: false });
  const hqTask = await plugin.hooks.HOOK_VN_PIPELINE_TASKS.run(turnContext, tools);
  assert.equal(hqTask, null);
  const stats = await plugin.hooks.HOOK_POST_DIALOGUE_PROCESSING.run(turnContext, tools);
  assert.equal(stats.acceptedCount, 1);
  assert.equal(turnContext.processed.narrativeEngine.writerResponse, 'Aether: We ride at dawn.\n' + HQ_FIXED_LINE);
  tools.settings.getSelf = () => ({ hq_multipass_enabled: false });
  assert.equal(await plugin.hooks.HOOK_POST_DIALOGUE_PROCESSING.run(turnContext, tools), null);
  const singleTask = await plugin.hooks.HOOK_VN_PIPELINE_TASKS.run(turnContext, tools);
  assert.equal(singleTask.before[0], 'spriteResolution');
});

test('HQ post-dialogue hook respects the interlude opt-out', async () => {
  const { turnContext } = hqTwoLineContext();
  turnContext.sceneMode = 'interlude';
  const tools = makeHqTools({}, [], { withBatch: false });
  tools.settings.getSelf = () => ({ hq_multipass_enabled: true, enable_interludes: false });
  assert.equal(await plugin.hooks.HOOK_POST_DIALOGUE_PROCESSING.run(turnContext, tools), null);
  assert.equal(await plugin.hooks.HOOK_VN_PIPELINE_TASKS.run(turnContext, tools), null);
  assert.equal(turnContext.processed.vnManager.processedLines[1].line, HQ_FLAGGED_LINE);
});

test('HQ distinguishes a malformed flag response from a genuine empty findings list', async () => {
  const { turnContext } = hqTwoLineContext();
  const tools = makeHqTools({}, [], { withBatch: true });
  const baseRunTask = tools.llm.runTask;
  tools.llm.runTask = task => task.msg.includes('Dialogue')
    ? Promise.resolve({ content: '[{"rule":"dialogue"' })
    : baseRunTask(task);

  const stats = await logic.runHqCheck(turnContext, tools);
  assert.equal(stats.flagCount, 1);
  assert.equal(stats.invalidFlagOutputCount, 1);
  assert.equal(stats.perAgent.find(agent => agent.key === 'cat3_dialogue').invalidOutput, true);
  assert.equal(stats.perAgent.find(agent => agent.key === 'cat4_familiarity').invalidOutput, false);
});

test('patches are rejected when cumulative dialogue count delta exceeds tolerance', () => {  const lines = [
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

// Shared-prefix reuse: a stored prepared prefix is rehydrated through the
// real compiler, so the HQ suffix leads with byte-identical prefix messages.
function makeStoredPrefix() {
  const { compilePluginRequest } = require('../../modules/prompt/request_compiler.js');
  const prepared = compilePluginRequest('post_writer_consistency_checker', 'test_shared_prefix', {
    messages: [
      { role: 'system', piece: 'contract', text: 'Shared contract text.' },
      { role: 'user', piece: 'simulation', text: 'Current state text.' }
    ]
  }, {});
  return JSON.parse(JSON.stringify({ id: prepared.id, messages: prepared.messages, manifest: prepared.manifest }));
}

function makeComposeStub(seen) {
  const { createPluginPromptScope } = require('../../modules/prompt/request_compiler.js');
  return (requestId, build) => {
    seen.push(requestId);
    const scope = createPluginPromptScope('post_writer_consistency_checker', requestId, {});
    const draft = scope.prompt;
    const wrap = (add) => (fn) => {
      draft[add]((message) => fn({
        add: (id, text) => message.add(scope.addPiece(id, {}), text)
      }));
    };
    const api = {
      usePrefix: (prepared) => { draft.usePrefix(prepared); return api; },
      user: wrap('user'),
      assistant: wrap('assistant')
    };
    build(api);
    return draft.prepare();
  };
}

function hqPrefixedHarness() {
  const { lines, turnContext } = hqTwoLineContext();
  turnContext.processed.promptBuilder.sharedPrefixPrepared = makeStoredPrefix();
  const prompts = [];
  const state = {};
  const tools = makeHqTools(state, [], { withBatch: false });
  const baseRunTask = tools.llm.runTask;
  tools.llm.runTask = (task) => {
    prompts.push(task);
    return baseRunTask(task);
  };
  tools.prompt = { compose: makeComposeStub([]) };
  tools._composeSeen = tools.prompt.compose;
  return { lines, turnContext, tools, prompts, state };
}

test('getSharedPrefixPrepared falls back when no prepared prefix exists', () => {
  assert.equal(logic.getSharedPrefixPrepared({ processed: { promptBuilder: {} } }), null);
  assert.equal(logic.getSharedPrefixPrepared(null), null);
  const stored = makeStoredPrefix();
  assert.deepEqual(
    logic.getSharedPrefixPrepared({ processed: { promptBuilder: { sharedPrefixPrepared: stored } } }),
    stored
  );
});

test('consistency flagger leads with the shared prefix bytes when available', async () => {
  const { turnContext, tools, prompts } = hqPrefixedHarness();
  const seen = [];
  tools.prompt = { compose: makeComposeStub(seen) };

  await logic.runHqCheck(turnContext, tools);

  assert.ok(seen.includes('hq_flag_consistency'));
  const flagTask = prompts.find(task => task.msg === 'Post Writer HQ Flag: Consistency');
  assert.ok(flagTask, 'consistency task was sent');
  // A composed PreparedPrompt, not a {messages} structure.
  assert.ok(Array.isArray(flagTask.prompt.messages));
  assert.ok(flagTask.prompt.manifest);
  const stored = turnContext.processed.promptBuilder.sharedPrefixPrepared;
  const leading = flagTask.prompt.messages.slice(0, stored.messages.length);
  assert.deepStrictEqual(
    leading.map(m => ({ role: m.role, content: m.content })),
    stored.messages.map(m => ({ role: m.role, content: m.content }))
  );
  // Suffix follows: task rules + review target, then the entry fake-out.
  const trailing = flagTask.prompt.messages.slice(stored.messages.length);
  assert.deepStrictEqual(trailing.map(m => m.role), ['user', 'assistant']);
  assert.match(trailing[0].content, /consistency flagger/);
  assert.match(trailing[0].content, /<draft_to_validate>/);
  assert.match(trailing[1].content, /consistency checks rule by rule/);
  // The five other flaggers keep the standalone messages shape.
  const dialogueTask = prompts.find(task => task.msg === 'Post Writer HQ Flag: Dialogue Dynamics');
  assert.ok(dialogueTask.prompt.messages);
  assert.equal(dialogueTask.prompt.manifest, undefined);
});

test('corrector leads with the shared prefix bytes and keeps CoT plus entry', async () => {
  const { turnContext, tools, prompts } = hqPrefixedHarness();
  const seen = [];
  tools.prompt = { compose: makeComposeStub(seen) };

  const stats = await logic.runHqCheck(turnContext, tools);
  assert.equal(stats.acceptedCount, 1);

  assert.ok(seen.includes('hq_corrector'));
  const correctorTask = prompts.find(task => task.msg === 'Post Writer HQ Corrector');
  assert.ok(correctorTask, 'corrector task was sent');
  const stored = turnContext.processed.promptBuilder.sharedPrefixPrepared;
  const leading = correctorTask.prompt.messages.slice(0, stored.messages.length);
  assert.deepStrictEqual(
    leading.map(m => ({ role: m.role, content: m.content })),
    stored.messages.map(m => ({ role: m.role, content: m.content }))
  );
  const trailing = correctorTask.prompt.messages.slice(stored.messages.length);
  assert.deepStrictEqual(trailing.map(m => m.role), ['user', 'assistant', 'assistant']);
  assert.match(trailing[0].content, /<flagged_findings>/);
  assert.match(trailing[1].content, /Mandatory Correction Procedure/);
  assert.match(trailing[2].content, /correction procedure step by step/);
});

test('corrector retry recomposes on the prefix with feedback as a trailing part', async () => {
  const { turnContext, tools, prompts } = hqPrefixedHarness();
  const seen = [];
  tools.prompt = { compose: makeComposeStub(seen) };
  const baseRunTask = tools.llm.runTask;
  let calls = 0;
  tools.llm.runTask = (task) => {
    prompts.push(task);
    if (task.msg === 'Post Writer HQ Corrector' && calls++ === 0) {
      return Promise.resolve({ content: '{"hunks":[]}' });
    }
    return baseRunTask(task);
  };

  const stats = await logic.runHqCheck(turnContext, tools);
  assert.equal(stats.correctionAttempts, 2);
  assert.ok(seen.includes('hq_corrector_repair'));
  const retryTask = prompts.find(task => task.msg === 'Post Writer HQ Corrector Repair');
  assert.ok(retryTask, 'repair retry was sent');
  const stored = turnContext.processed.promptBuilder.sharedPrefixPrepared;
  assert.deepStrictEqual(
    retryTask.prompt.messages.slice(0, stored.messages.length).map(m => m.content),
    stored.messages.map(m => m.content)
  );
  assert.match(retryTask.prompt.messages[stored.messages.length].content, /rejected/);
});

test('corrector CoT states the draft-first precedence rule', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(path.join(__dirname, 'hq', 'corrector_cot.txt'), 'utf8');
  assert.match(text, /Precedence/);
  assert.match(text, /never invent facts the draft does not support/);
});

test('fast dialogue miner settings default and resolve', () => {
  const defaults = logic.resolveSettings({});
  assert.equal(defaults.hq_cat3_fast_enabled, false);
  assert.equal(defaults.hq_cat3_fast_target, 20);
  assert.equal(defaults.hq_cat3_fast_threshold, 80);
  assert.equal(defaults.hq_cat3_fast_max_tokens, 6000);
  assert.equal(defaults.hq_cat3_fast_model_def.model, 'veryhighendmodel');

  const custom = logic.resolveSettings({ hq_cat3_fast_enabled: true, hq_cat3_fast_target: 12, hq_cat3_fast_threshold: 65, hq_cat3_fast_max_tokens: 9000, hq_cat3_fast_model_def: { model: 'lowendmodel' } });
  assert.equal(custom.hq_cat3_fast_enabled, true);
  assert.equal(custom.hq_cat3_fast_target, 12);
  assert.equal(custom.hq_cat3_fast_threshold, 65);
  assert.equal(custom.hq_cat3_fast_max_tokens, 9000);
  assert.equal(custom.hq_cat3_fast_model_def.model, 'lowendmodel');
});

test('fast cat3 model assignment uses the fast model setting', () => {
  const settings = logic.resolveSettings({ hq_cat3_fast_model_def: { model: 'lowendmodel', provider: 'generic' } });
  const assignment = logic.resolveFastCat3ModelAssignment(settings, {});
  assert.equal(assignment.model, 'lowendmodel');
  assert.equal(assignment.provider, 'generic');
  assert.equal(assignment.source, 'hq_cat3_fast');
});

test('normalizeFlagFinding carries an optional clamped confidence', () => {
  const base = {
    rule: 'in_scene_ownership',
    reason: 'conflict',
    scope: 'line',
    occurrences: [{ line: 3, quote: 'x' }]
  };
  assert.equal(logic._private.normalizeFlagFinding(base, 'cat3_dialogue').confidence, null);
  assert.equal(logic._private.normalizeFlagFinding({ ...base, confidence: 87.6 }, 'cat3_dialogue').confidence, 88);
  assert.equal(logic._private.normalizeFlagFinding({ ...base, confidence: 140 }, 'cat3_dialogue').confidence, 100);
  assert.equal(logic._private.normalizeFlagFinding({ ...base, confidence: -5 }, 'cat3_dialogue').confidence, 0);
  assert.equal(logic._private.normalizeFlagFinding({ ...base, confidence: 'n/a' }, 'cat3_dialogue').confidence, null);
});

test('applyConfidenceGate keeps only candidates at or above the threshold', () => {
  const agents = [{
    key: 'cat3_dialogue',
    label: 'Dialogue Dynamics',
    findings: [
      { id: 'F1', rule: 'r', scope: 'line', confidence: 95, occurrences: [{ line: 1, quote: 'a' }], repair_targets: [1], reason: 'strong' },
      { id: 'F2', rule: 'r', scope: 'line', confidence: 40, occurrences: [{ line: 2, quote: 'b' }], repair_targets: [2], reason: 'weak' },
      { id: 'F3', rule: 'r', scope: 'line', confidence: null, occurrences: [{ line: 3, quote: 'c' }], repair_targets: [3], reason: 'unscored' }
    ]
  }];
  const verified = { agents, actionable: agents[0].findings, flagCount: 3, passageCount: 0, invalidAnchorCount: 0, invalidFindingCount: 0 };

  const gated = logic.applyConfidenceGate(verified, 'cat3_dialogue', 80);

  assert.equal(gated.stats.candidates, 3);
  assert.equal(gated.stats.accepted, 1);
  assert.equal(gated.stats.belowThreshold, 1);
  assert.equal(gated.stats.missingConfidence, 1);
  assert.deepStrictEqual(gated.verified.actionable.map(f => f.id), ['F1']);
  assert.equal(gated.verified.flagCount, 1);
  assert.equal(gated.rejected.length, 2);
  // Non-target agents pass through untouched.
  const other = logic.applyConfidenceGate({ agents: [{ key: 'cat1', findings: [{ id: 'X', confidence: 1 }] }], actionable: [], flagCount: 0 }, 'cat3_dialogue', 80);
  assert.equal(other.stats.candidates, 0);
  assert.equal(other.verified.agents[0].findings.length, 1);
});

test('buildFlagMessages omits the CoT and entry for the fast miner', () => {
  const fast = logic.buildFlagMessages({
    key: 'cat3_dialogue',
    fast: true,
    messages: [{ role: 'user', content: 'candidates please' }]
  });
  assert.deepStrictEqual(fast.map(m => m.role), ['user']);

  const normal = logic.buildFlagMessages({
    key: 'cat3_dialogue',
    entryText: logic.HQ_FLAG_ENTRY_MESSAGE,
    cotTrail: [{ role: 'assistant', piece: 'x', text: 'cot' }],
    messages: [{ role: 'user', content: 'review please' }]
  });
  assert.deepStrictEqual(normal.map(m => m.role), ['user', 'assistant', 'assistant']);
  assert.equal(normal[1].text, 'cot');
});

test('applyCandidateTarget substitutes the target count', () => {
  assert.equal(logic.applyCandidateTarget('Aim for {{CANDIDATE_TARGET}} candidates.', 12), 'Aim for 12 candidates.');
  assert.equal(logic.applyCandidateTarget('Aim for {{CANDIDATE_TARGET}} candidates.', 0), 'Aim for 20 candidates.');
});

test('candidate prompt file carries every rule and the target placeholder', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(path.join(__dirname, 'hq', 'cat3_dialogue_candidates.txt'), 'utf8');
  for (const rule of ['dialogue_presence', 'character_participation', 'narrated_silence', 'uniform_ping_pong', 'in_scene_ownership', 'friction_and_memory']) {
    assert.match(text, new RegExp(`RULE\\s*\\d+: ${rule}`));
  }
  assert.match(text, /\{\{CANDIDATE_TARGET\}\}/);
});

for (const withBatch of [false, true]) {
test(`fast cat3 filters final scores after review and preserves diagnostics (${withBatch ? 'batch' : 'fallback'})`, async () => {
  const { lines, turnContext } = hqTwoLineContext();
  turnContext.output = {};
  Object.defineProperty(turnContext.output, 'fulltext', {
    get: () => turnContext.processed.narrativeEngine.writerResponse
  });
  turnContext.runtime = { lastSearchstring: turnContext.processed.narrativeEngine.writerResponse.substring(0, 500) };

  const state = {};
  const tasks = [];
  const tools = makeHqTools(state, [], { withBatch });
  const baseRunTask = tools.llm.runTask;
  tools.llm.runTask = (task) => {
    tasks.push(task);
    if (task.msg === 'Post Writer HQ Flag: Dialogue Dynamics') {
      return Promise.resolve({ content: JSON.stringify([
        {
          rule: 'in_scene_ownership', scope: 'line', reason: 'strong conflict',
          occurrences: [{ line: 2, quote: HQ_FLAGGED_LINE }], repair_targets: [2],
          draft_confidence: 45,
          review: { counterevidence_lines: [], assessment: 'No bridge explains the conflict.', verdict: 'supported' },
          confidence: 96
        },
        {
          rule: 'in_scene_ownership', scope: 'line', reason: 'weak suspicion',
          occurrences: [{ line: 1, quote: 'Aether: We ride at dawn.' }], repair_targets: [1],
          draft_confidence: 95,
          review: { counterevidence_lines: [2], assessment: 'The surrounding text explains it.', verdict: 'explained' },
          confidence: 30
        },
        {
          rule: 'in_scene_ownership', scope: 'line', reason: 'missing final score',
          occurrences: [{ line: 1, quote: 'Aether: We ride at dawn.' }], repair_targets: [1],
          draft_confidence: 99,
          review: { counterevidence_lines: [], assessment: 'Still appears unsupported by a bridge.', verdict: 'supported' }
        }
      ]) });
    }
    if (task.msg.startsWith('Post Writer HQ Flag')) {
      return Promise.resolve({ content: '[]' });
    }
    return baseRunTask(task);
  };
  tools.settings = { getSelf: () => ({ hq_multipass_enabled: true, hq_cat3_fast_enabled: true, hq_cat3_fast_threshold: 80 }) };

  const stats = await logic.runHqCheck(turnContext, tools);

  const dialogueTask = tasks.find(task => task.msg === 'Post Writer HQ Flag: Dialogue Dynamics');
  assert.ok(dialogueTask, 'dialogue task sent');
  // Direct output: no assistant entry/CoT, reasoning forced off, larger budget.
  assert.deepStrictEqual(dialogueTask.prompt.messages.map(m => m.role), ['user']);
  assert.deepStrictEqual(dialogueTask.params.reasoning, { effort: 'off' });
  assert.equal(dialogueTask.params.max_tokens, 6000);
  // The fast miner runs on its own reasoning-off-capable model.
  assert.equal(dialogueTask.model, 'veryhighendmodel');
  assert.match(dialogueTask.prompt.messages[0].content ?? dialogueTask.prompt.messages[0].text, /candidate detector/);
  // The other agents keep their own (unified) model and no reasoning override.
  const consistencyTask = tasks.find(task => task.msg === 'Post Writer HQ Flag: Consistency');
  assert.equal(consistencyTask.params.reasoning, undefined);

  assert.ok(stats.cat3Fast, 'gate stats recorded');
  assert.equal(stats.cat3Fast.candidates, 3);
  assert.equal(stats.cat3Fast.accepted, 1);
  assert.equal(stats.cat3Fast.belowThreshold, 1);
  assert.equal(stats.cat3Fast.missingConfidence, 1);
  assert.equal(stats.flagCount, 1);

  const correctorTask = tasks.find(task => task.msg === 'Post Writer HQ Corrector');
  assert.ok(correctorTask, 'corrector ran');
  const correctorPayload = correctorTask.prompt.messages.map(m => m.content ?? m.text).join('\n');
  assert.match(correctorPayload, /strong conflict/);
  assert.doesNotMatch(correctorPayload, /weak suspicion/);
  assert.doesNotMatch(correctorPayload, /missing final score/);
  assert.doesNotMatch(correctorPayload, /draft_confidence|counterevidence_lines/);

  const saved = state.hqFindings.find(agent => agent.key === 'cat3_dialogue').findings;
  assert.equal(saved[0].draft_confidence, 45);
  assert.equal(saved[0].confidence, 96);
  assert.equal(saved[0].review.verdict, 'supported');
  assert.equal(saved[0].confidenceStatus, 'accepted');
  assert.equal(saved[1].draft_confidence, 95);
  assert.equal(saved[1].confidence, 30);
  assert.deepStrictEqual(saved[1].review.counterevidence_lines, [2]);
  assert.equal(saved[1].confidenceStatus, 'rejected');
  assert.equal(saved[2].confidence, null);
  assert.equal(saved[2].filterReason, 'missing_confidence');
  assert.equal(stats.cat3Fast.rejected[0].draft_confidence, 95);
  assert.equal(stats.cat3Fast.rejected[0].review.verdict, 'explained');
});
}

test('missing final scores stay missing through parsing and validation, even at threshold zero', () => {
  const candidate = {
    rule: 'in_scene_ownership', reason: 'provisional', scope: 'line',
    occurrences: [{ line: 1, quote: 'Ari: The key is here.' }], repair_targets: [1],
    draft_confidence: 98,
    review: { counterevidence_lines: [], assessment: 'No explanation located.', verdict: 'supported' }
  };
  for (const confidence of [undefined, null, '', 'n/a', false]) {
    const findings = logic.parseFlagFindings(JSON.stringify([{ ...candidate, confidence }]), 'cat3_dialogue');
    const verified = logic.validateFlagFindings([{ key: 'cat3_dialogue', findings }], [dialogue('Ari', 'The key is here.')]);
    assert.equal(verified.agents[0].findings[0].confidence, null);
    assert.equal(verified.agents[0].findings[0].draft_confidence, 98);
    const gated = logic.applyConfidenceGate(verified, 'cat3_dialogue', 0);
    assert.equal(gated.stats.missingConfidence, 1);
    assert.equal(gated.verified.actionable.length, 0);
  }
});

test('ordered review examples have exact anchors and filter only on their final scores', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(path.join(__dirname, 'hq', 'cat3_dialogue_candidates.txt'), 'utf8');
  const sections = text.split(/OUTPUT EXAMPLE [A-D] — /).slice(1);
  assert.equal(sections.length, 4);
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const scriptLines = [...section.matchAll(/^\d+ \| (.*)$/gm)].map(match => ({ type: 'narrative', line: match[1] }));
    const json = section.match(/\[\n  \{[\s\S]*?\n\]/)[0];
    const raw = JSON.parse(json)[0];
    assert.deepStrictEqual(Object.keys(raw), [
      'rule', 'scope', 'reason', 'occurrences', 'repair_targets', 'draft_confidence', 'review', 'confidence'
    ]);
    const findings = logic.parseFlagFindings(json, 'cat3_dialogue');
    const verified = logic.validateFlagFindings([{ key: 'cat3_dialogue', findings }], scriptLines);
    assert.equal(verified.invalidAnchorCount, 0);
    assert.equal(verified.invalidFindingCount, 0);
    assert.deepStrictEqual(verified.agents[0].findings[0].review, raw.review);
    const gated = logic.applyConfidenceGate(verified, 'cat3_dialogue', 80);
    assert.equal(gated.verified.actionable.length, index === 1 ? 1 : 0);
  }
});

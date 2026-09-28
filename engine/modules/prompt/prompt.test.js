const test = require('node:test');
const assert = require('node:assert/strict');

const { Prompt, PreparedPrompt, PROMPT_MANIFEST_VERSION } = require('./prompt.js');
const { CORE_COMPONENTS } = require('./prompt_core_catalog.js');

function writerPrompt() {
  return new Prompt({ id: 'core.writer' });
}

test('many pieces inside one system message render in order with shared-ancestor metadata', () => {
  const prepared = writerPrompt()
    .system(message => {
      message.add('core.shared.engine_contract', 'CONTRACT');
      message.add('core.shared.interpretation_lock', 'LOCK');
      message.add('root.canon', canon => {
        canon.text('# THE CANON\n');
        canon.add('core.canon.player_bio', 'BIO');
        canon.add('core.canon.static_lore_file', 'LORE-A', { instanceKey: 'lore/a.md' });
        canon.add('core.canon.static_lore_file', 'LORE-B', { instanceKey: 'lore/b.md' });
      });
    })
    .prepare();

  assert.ok(prepared instanceof PreparedPrompt);
  assert.equal(prepared.messages.length, 1);
  assert.deepEqual(prepared.messages[0], {
    role: 'system',
    content: 'CONTRACTLOCK# THE CANON\nBIOLORE-ALORE-B'
  });
  assert.equal(prepared.manifest.version, PROMPT_MANIFEST_VERSION);
  assert.equal(prepared.manifest.promptId, 'core.writer');

  // Every component plus its catalogue ancestors is described in the manifest.
  for (const id of ['root.canon', 'core.canon.player_bio', 'core.canon.static_lore_file']) {
    assert.ok(prepared.manifest.components[id], `manifest must describe ${id}`);
  }
  assert.ok(prepared.manifest.components.root, 'manifest must describe the root ancestor');

  // Exclusive byte ownership: no gaps, no overlaps.
  const spans = prepared.manifest.spans
    .filter(span => span.messageIndex === 0)
    .sort((a, b) => a.start - b.start);
  assert.equal(spans[0].start, 0);
  assert.equal(spans[spans.length - 1].end, prepared.messages[0].content.length);
  for (let i = 1; i < spans.length; i++) {
    assert.equal(spans[i].start, spans[i - 1].end, 'spans must be contiguous and non-overlapping');
    assert.ok(spans[i].occurrenceId !== spans[i - 1].occurrenceId || spans[i].start !== spans[i - 1].start);
  }

  // Parent owns its own bytes only; children own theirs (no double-counting).
  const occurrenceFor = {};
  for (const occurrence of prepared.manifest.occurrences) {
    const key = `${occurrence.componentId}\\u0000${occurrence.instanceKey ?? ''}\\u0000${occurrence.containerOccurrenceId ?? ''}`;
    occurrenceFor[key] = occurrence;
  }
  const ownText = occurrenceId =>
    prepared.manifest.spans
      .filter(span => span.occurrenceId === occurrenceId)
      .map(span => prepared.messages[span.messageIndex].content.slice(span.start, span.end))
      .join('');
  const parentId = occurrenceFor['root.canon\\u0000\\u0000'].occurrenceId;
  assert.equal(ownText(parentId), '# THE CANON\n');

  // Instance keys repeat the same component visibly, never deduplicated.
  const leaves = prepared.manifest.occurrences.filter(o => o.componentId === 'core.canon.static_lore_file');
  assert.deepEqual(leaves.map(o => o.instanceKey).sort(), ['lore/a.md', 'lore/b.md']);

  assert.equal(prepared.hash.length, 16);
  assert.equal(prepared.characterCount, prepared.messages[0].content.length);
});

test('one semantic component can own spans across many messages', () => {
  const history = new Prompt({ id: 'core.history.replay' });
  for (const chapter of [{ id: '51', action: 'ACT51', narrative: 'NAR51' }, { id: '52', action: 'ACT52', narrative: 'NAR52' }]) {
    history.user(message => {
      message.add('core.canon.static_lore_file', chapter.action, { instanceKey: `chapter-${chapter.id}-action` });
    });
    history.assistant(message => {
      message.add('core.history.full_chapter', chapter.narrative, { instanceKey: `chapter-${chapter.id}` });
    });
  }
  const replay = history.prepare();
  assert.equal(replay.messages.length, 4);
  assert.deepEqual(replay.messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);

  const shared = new Prompt({ id: 'core.narrative.shared' });
  shared.system(message => {
    message.add('core.shared.engine_contract', 'CONTRACT');
  });
  shared.append(replay);
  shared.user(message => {
    message.add('core.canon.player_bio', 'CURRENT');
  });
  const prepared = shared.prepare();

  assert.equal(prepared.messages.length, 6);
  assert.equal(prepared.messages[0].role, 'system');
  assert.equal(prepared.manifest.inclusions.length, 1);
  // kind records block vs prefix inclusion; append() is recorded as 'block'.
  assert.equal(prepared.manifest.inclusions[0].kind, 'block');
  assert.equal(prepared.manifest.inclusions[0].sourcePromptId, 'core.history.replay');

  const actions = prepared.manifest.occurrences.filter(o => o.componentId === 'core.canon.static_lore_file');
  assert.equal(actions.length, 2);
  for (const occurrence of actions) {
    assert.equal(occurrence.origin.sourcePromptId, 'core.history.replay');
    assert.equal(occurrence.origin.sourceHash, replay.hash);
  }
});

test('usePrefix composes an immutable leading block and distinct suffixes', () => {
  const shared = new Prompt({ id: 'core.narrative.shared' });
  shared.system(message => {
    message.add('core.shared.engine_contract', 'CONTRACT');
    message.add('core.canon.player_bio', 'BIO');
  });
  const sharedPrefix = shared.prepare();

  const writer = new Prompt({ id: 'core.writer' });
  writer.usePrefix(sharedPrefix);
  writer.user(message => {
    message.add('core.writer.brief', 'BRIEF');
    message.add('core.writer.current_action', 'ACT');
  });
  const writerPrepared = writer.prepare();

  const director = new Prompt({ id: 'core.director' });
  director.usePrefix(sharedPrefix);
  director.user(message => {
    message.add('director.directives', 'GUIDE');
  });
  const directorPrepared = director.prepare();

  assert.deepEqual(writerPrepared.messages[0], sharedPrefix.messages[0]);
  assert.equal(writerPrepared.manifest.inclusions[0].kind, 'prefix');
  assert.equal(writerPrepared.manifest.inclusions[0].sourcePromptId, 'core.narrative.shared');
  assert.equal(writerPrepared.manifest.inclusions[0].messageStart, 0);
  assert.notEqual(writerPrepared.messages[1].content, directorPrepared.messages[1].content);
  // Exact reuse: identical leading bytes for both consumers.
  assert.equal(
    writerPrepared.messages[0].content,
    directorPrepared.messages[0].content
  );

  // The receiving builder cannot insert content inside the frozen prefix.
  assert.throws(() => {
    const bad = new Prompt({ id: 'bad' });
    bad.user(message => message.add('core.canon.player_bio', 'X'));
    bad.usePrefix(sharedPrefix);
  }, /first operation/);
});

test('ordering: appends stay in order, prepend is the only escape hatch', () => {
  const prepared = writerPrompt()
    .system(message => {
      message.add('core.shared.engine_contract', 'FIRST-');
      message.add('core.shared.interpretation_lock', 'SECOND');
      message.prepend('core.canon.player_bio', 'ZERO-');
    })
    .prepare();
  assert.equal(prepared.messages[0].content, 'ZERO-FIRST-SECOND');

  // Same-role messages never merge.
  const two = writerPrompt()
    .user(message => message.add('core.writer.brief', 'ONE'))
    .user(message => message.add('core.writer.current_action', 'TWO'))
    .prepare();
  assert.equal(two.messages.length, 2);
});

test('message-level separators are message-owned formatting, not component bytes', () => {
  const prepared = writerPrompt()
    .system(message => {
      message.add('core.shared.engine_contract', 'FIRST');
      message.add('core.shared.interpretation_lock', 'SECOND');
    }, { separator: '\n\n---\n\n' })
    .prepare();

  assert.equal(prepared.messages[0].content, 'FIRST\n\n---\n\nSECOND');
  const formats = prepared.manifest.messageFormats;
  assert.equal(formats.length, 1);
  assert.equal(formats[0].messageIndex, 0);
  assert.equal(formats[0].separator, '\n\n---\n\n');
  // The separator span has no occurrence: it is excluded from every rollup.
  const separatorSpan = prepared.manifest.spans.find(span => span.occurrenceId == null);
  assert.ok(separatorSpan, 'separator must be recorded as a span');
  assert.equal(
    prepared.messages[0].content.slice(separatorSpan.start, separatorSpan.end),
    '\n\n---\n\n'
  );
  const componentSpans = prepared.manifest.spans.filter(span => span.occurrenceId != null);
  const componentBytes = componentSpans.reduce((sum, span) => sum + (span.end - span.start), 0);
  assert.equal(componentBytes, 'FIRSTSECOND'.length);
  assert.throws(() => writerPrompt().user(() => {}, { separator: 1 }), /separator.*must be a string/);
  assert.throws(() => writerPrompt().user(() => {}, 'nope'), /options must be an object/);
});

test('formatting options attribute their bytes to the owning component', () => {
  const prepared = writerPrompt()
    .system(message => {
      message.add(
        'root.canon',
        canon => {
          canon.add('core.canon.player_bio', 'BIO');
          canon.add('core.canon.static_lore_file', 'LORE', { instanceKey: 'lore/x.md' });
        },
        { prefix: '# THE CANON\n<canon_data>\n', separator: '\n\n', suffix: '\n</canon_data>' }
      );
    })
    .prepare();

  assert.equal(
    prepared.messages[0].content,
    '# THE CANON\n<canon_data>\nBIO\n\nLORE\n</canon_data>'
  );
  const content = prepared.messages[0].content;
  const canonOccurrence = prepared.manifest.occurrences.find(o => o.componentId === 'root.canon');
  const canonSpans = prepared.manifest.spans.filter(s => s.occurrenceId === canonOccurrence.occurrenceId);
  const owned = canonSpans.map(s => content.slice(s.start, s.end)).join('|');
  assert.ok(owned.includes('# THE CANON'), 'parent owns its prefix');
  assert.ok(owned.includes('\n\n'), 'parent owns the separator');
  assert.ok(owned.includes('</canon_data>'));
});

test('validation: unknown ids, bad nesting, duplicate instances, broken structure all fail', () => {
  assert.throws(() => writerPrompt().system(m => m.add('writer.brief', 'x')), /Unknown prompt component/);
  assert.throws(
    () => writerPrompt().user(m => m.add('root.canon', c => c.add('core.writer.brief', 'x'))),
    /not a catalogue descendant/
  );
  assert.throws(() => writerPrompt().user(m => m.add('root.canon')), /must be a string or a builder function/);
  assert.throws(() => writerPrompt().user(m => m.add('root.canon', 'x', { separator: 1 })), /must be a string/);
  assert.throws(
    () => writerPrompt().user(m => {
      m.add('core.canon.static_lore_file', 'A', { instanceKey: 'same.md' });
      m.add('core.canon.static_lore_file', 'B', { instanceKey: 'same.md' });
    }).prepare(),
    /Duplicate instanceKey/
  );
  assert.throws(() => writerPrompt().prepare(), /no messages/);
  assert.throws(() => writerPrompt().user(m => m.add('core.writer.brief', '')).prepare(), /empty .* message/);
  assert.throws(() => writerPrompt().system(m => m.add('core.shared.engine_contract', 'x')).assistant(), /builder function/);
  assert.throws(() => writerPrompt().system(() => {}).system(() => {}), /first message/);
  assert.throws(() => writerPrompt().message('tool', () => {}), /Invalid message role/);
  assert.throws(() => new Prompt({ id: '' }), /non-empty string id/);
  assert.throws(() => new Prompt({ id: 'x', catalog: [] }), /must be an object/);
  // Sealing: no edits after prepare().
  const prompt = writerPrompt().user(m => m.add('core.writer.brief', 'x'));
  prompt.prepare();
  assert.throws(() => prompt.user(() => {}), /sealed/);
});

test('prepared results are immutable, nested under the pillar and fully attributable', () => {
  const prepared = writerPrompt()
    .system(message => {
      message.add('core.shared.engine_contract', 'CONTRACT');
      message.add('core.writer.brief', 'BRIEF');
    })
    .prepare();

  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.messages), true);
  assert.equal(Object.isFrozen(prepared.manifest), true);
  const before = prepared.messages[0].content;
  assert.equal(Object.isFrozen(prepared.messages[0]), true);
  assert.throws(() => { 'use strict'; prepared.messages[0].content = 'MUTATED'; }, TypeError);
  assert.equal(prepared.messages[0].content, before);

  // finalizeText must be a function when provided; per-occurrence overrides
  // accept functions or explicit null (pre-finalized input).
  assert.throws(() => new Prompt({ id: 'x', finalizeText: 'nope' }), /finalizeText must be a function/);
  assert.throws(
    () => writerPrompt().user(m => m.add('core.writer.brief', 'x', { finalizeText: 'nope' })),
    /finalizeText option must be a function/
  );

  // Catalogue parent links still govern placement: the brief hangs off its slot.
  assert.equal(CORE_COMPONENTS['core.writer.brief'].parent, 'writer.directives');
  assert.ok(prepared.manifest.components['core.writer.brief'], 'manifest must describe the brief');
  assert.ok(prepared.manifest.components['writer.directives'], 'manifest must describe its slot ancestor');

  // The manifest covers every rendered byte — reconstruction proof.
  const sorted = prepared.manifest.spans.slice().sort((a, b) => a.messageIndex - b.messageIndex || a.start - b.start);
  const reconstructed = [];
  for (const span of sorted) {
    reconstructed.push(prepared.messages[span.messageIndex].content.slice(span.start, span.end));
  }
  assert.equal(reconstructed.join(''), prepared.messages.map(m => m.content).join(''));
});

test('finalizeText transforms owned units inside preparation, keeping provenance', () => {
  const prepared = new Prompt({
    id: 'core.writer',
    finalizeText: (text) => text.replaceAll('[HERO]', 'Ari').replaceAll('z_virtual_', '')
  })
    .system(message => {
      // Separator carries the placeholder through message-owned formatting.
      message.add('core.shared.engine_contract', 'Dear [HERO]');
      message.add('core.shared.interpretation_lock', 'Signed z_virtual_[HERO]');
    }, { separator: '|z_virtual_-' })
    .user(message => {
      message.add('core.writer.brief', '[HERO] acts', { prefix: '>>[HERO]:', suffix: ':z_virtual_end' });
    })
    .prepare();

  assert.equal(prepared.messages[0].content, 'Dear Ari|-Signed Ari');
  assert.equal(prepared.messages[1].content, '>>Ari:Ari acts:end');

  // Spans still reconstruct the final bytes exactly.
  const sorted = prepared.manifest.spans.slice().sort((a, b) => a.messageIndex - b.messageIndex || a.start - b.start);
  const reconstructed = sorted.map(span => prepared.messages[span.messageIndex].content.slice(span.start, span.end)).join('');
  assert.equal(reconstructed, prepared.messages.map(m => m.content).join(''));

  // The transform must not reinvent component identity: same components,
  // same occurrence count, same message formats as without the transform.
  const plain = writerPrompt()
    .system(message => {
      message.add('core.shared.engine_contract', 'Dear [HERO]');
      message.add('core.shared.interpretation_lock', 'Signed z_virtual_[HERO]');
    }, { separator: '|z_virtual_|' })
    .user(message => {
      message.add('core.writer.brief', '[HERO] acts', { prefix: '>>[HERO]:', suffix: ':z_virtual_end' });
    })
    .prepare();
  assert.equal(prepared.manifest.occurrences.length, plain.manifest.occurrences.length);
  assert.deepEqual(
    prepared.manifest.occurrences.map(o => o.componentId).sort(),
    plain.manifest.occurrences.map(o => o.componentId).sort()
  );
  assert.equal(prepared.manifest.messageFormats.length, plain.manifest.messageFormats.length);

  // Inclusions keep the bytes their own composer finalized: the receiving
  // prompt's finalizeText applies to suffix pieces only, never rewrites the
  // included prefix. The transform boundary is the prompt that rendered them.
  const frozen = writerPrompt()
    .system(message => message.add('core.shared.engine_contract', '[HERO] FROZEN'))
    .prepare();
  const combined = new Prompt({ id: 'core.writer', finalizeText: (text) => text.replaceAll('[HERO]', 'Ari') })
    .usePrefix(frozen)
    .user(message => message.add('core.writer.current_action', '[HERO] acts'))
    .prepare();
  assert.equal(combined.messages[0].content, '[HERO] FROZEN');
  assert.equal(combined.messages[1].content, 'Ari acts');
});

test('rehydrate restores a prepared result and rejects stale copies', () => {
  const original = writerPrompt()
    .system(message => message.add('core.shared.engine_contract', 'CONTRACT'))
    .prepare();
  const plain = {
    id: original.id,
    messages: original.messages.map(message => ({ role: message.role, content: message.content })),
    manifest: JSON.parse(JSON.stringify(original.manifest))
  };
  const restored = PreparedPrompt.rehydrate(plain);
  assert.ok(restored instanceof PreparedPrompt);
  assert.deepEqual(
    restored.messages.map(message => ({ role: message.role, content: message.content })),
    plain.messages
  );
  assert.equal(restored.hash, original.hash);

  // A tampered copy (messages no longer match the manifest spans) throws
  // instead of claiming false provenance.
  const tampered = {
    id: plain.id,
    messages: [{ role: 'system', content: 'TAMPERED ENTIRELY DIFFERENT BYTES' }],
    manifest: plain.manifest
  };
  assert.throws(() => PreparedPrompt.rehydrate(tampered), /do not cover message/);
  assert.throws(() => PreparedPrompt.rehydrate({ id: '', messages: plain.messages, manifest: plain.manifest }), /non-empty string id/);
  // Forged provenance fails even when bytes are intact: duplicate occurrence
  // ids, dangling span references, unknown physical parents, cycles, and
  // malformed source refs are all structure errors.
  const forgedDup = JSON.parse(JSON.stringify(plain));
  forgedDup.manifest.occurrences.push({ ...forgedDup.manifest.occurrences[0] });
  assert.throws(() => PreparedPrompt.rehydrate(forgedDup), /Duplicate manifest occurrence/);
  const forgedSpan = JSON.parse(JSON.stringify(plain));
  // A zero-length span at the message start: span coverage still holds, but
  // the occurrence reference is dangling — structure validation must catch it.
  forgedSpan.manifest.spans.unshift({ occurrenceId: 'occ-nope', messageIndex: 0, start: 0, end: 0 });
  assert.throws(() => PreparedPrompt.rehydrate(forgedSpan), /unknown occurrence/);
  const forgedParent = JSON.parse(JSON.stringify(plain));
  forgedParent.manifest.occurrences[0].containerOccurrenceId = 'occ-nope';
  assert.throws(() => PreparedPrompt.rehydrate(forgedParent), /unknown physical parent/);
  const forgedCycle = JSON.parse(JSON.stringify(plain));
  // Self-parent: the occurrence claims itself as its own physical container.
  forgedCycle.manifest.occurrences[0].containerOccurrenceId = forgedCycle.manifest.occurrences[0].occurrenceId;
  assert.throws(() => PreparedPrompt.rehydrate(forgedCycle), /Cycle in prompt manifest/);
  // v1 manifests carry no source refs: a v1 manifest WITH source refs is a
  // version lie and must throw; a clean v1 manifest rehydrates as v1.
  const v1lie = JSON.parse(JSON.stringify(plain));
  v1lie.manifest.version = 1;
  v1lie.manifest.occurrences[0].source = { target: 'root', slot: 'protocol', sourceId: 'pcs-x' };
  assert.throws(() => PreparedPrompt.rehydrate(v1lie), /v1 carries no source refs/);
  const v1clean = JSON.parse(JSON.stringify(plain));
  v1clean.manifest.version = 1;
  for (const o of v1clean.manifest.occurrences) delete o.source;
  assert.ok(PreparedPrompt.rehydrate(v1clean) instanceof PreparedPrompt);
});

test('per-occurrence finalizeText marks pre-finalized inputs without forking bytes', () => {
  const legacyChat = 'Ari asks about the z_virtual_key.';
  const prepared = new Prompt({ id: 'core.writer', finalizeText: (text) => text.replaceAll('z_virtual_', '') })
    .user(message => {
      // Chat replay arrives pre-finalized from the shared prefix (placeholder
      // replacement, no virtual-name strip): the per-occurrence transform
      // reproduces exactly the legacy bytes for that piece.
      message.add('root.history', '[HERO] asks about the z_virtual_key.', { instanceKey: 'history-chat-0-user', finalizeText: (text) => text.replaceAll('[HERO]', 'Ari') });
      message.add('core.writer.current_action', 'open the z_virtual_door');
    })
    .prepare();

  assert.equal(prepared.messages[0].content, `${legacyChat}open the door`);
  const sorted = prepared.manifest.spans.slice().sort((a, b) => a.start - b.start);
  const reconstructed = sorted.map(span => prepared.messages[0].content.slice(span.start, span.end)).join('');
  assert.equal(reconstructed, prepared.messages[0].content);
});

test('agent-only role policy preserves a late system message without relaxing ordinary prompts', () => {
  const agent = new Prompt({ id: 'core.agent_review', rolePolicy: 'agent' });
  agent.system(message => message.add('core.shared.engine_contract', 'First system.'));
  agent.user(message => message.add('core.writer.current_action', 'Do the task.'));
  agent.system(message => message.add('core.shared.interpretation_lock', 'Finalize now.'));
  const prepared = agent.prepare();
  assert.deepEqual(prepared.messages.map(message => message.role), ['system', 'user', 'system']);
  assert.equal(prepared.manifest.rolePolicy, 'agent');
  assert.deepEqual(PreparedPrompt.rehydrate(JSON.parse(JSON.stringify(prepared))).messages, prepared.messages);
  const standard = new Prompt({ id: 'core.standard_review' });
  standard.user(message => message.add('core.writer.current_action', 'Do the task.'));
  assert.throws(() => standard.system(message => message.add('core.shared.interpretation_lock', 'Finalize now.')),
    /first message/);
  const disguised = JSON.parse(JSON.stringify(prepared));
  delete disguised.manifest.rolePolicy;
  assert.throws(() => PreparedPrompt.rehydrate(disguised), /initial system message/);
});

test('include() renders a stored occurrence without reparenting it', () => {
  // Trusted inclusion: the caller supplies ONLY {target, slot, sourceId};
  // the componentId is DERIVED from the resolved source (never caller input,
  // so a source cannot be mislabelled). Uses a real TurnContext so identity
  // flows through validated registration + getPromptSource().
  const TurnContext = require('../turncontext.js');
  const context = new TurnContext('Include Test');
  const { buildTools } = require('../plugin_manager/runtime/tools_builder.js');
  const tools = buildTools(
    { plugins: new Map(), disabledPlugins: new Map(), promptRegistry: new Map() },
    'world_state_tracker', context
  );
  tools.prompt.contribute({
    id: 'world_state_context', to: 'root.simulation',
    label: 'World state context', description: 'Pre-action world state.',
    children: { current_state: 'Harbor at dawn.' }, directable: true
  });
  const storedId = context.promptComponents.root.simulation[0].sourceId;
  const prompt = new Prompt({ id: 'core.vn_background.shared', turnContext: context });
  prompt.registerOccurrenceIdentity(context.promptComponents.root.simulation[0], ['root.simulation']);
  prompt.registerDynamicComponent('core.vn_background.capsule', {
    parent: 'root', label: 'VN background capsule', description: 'Test layout container.', owner: 'core'
  });
  prompt.user(message => {
    message.add('core.vn_background.capsule', capsule => {
      capsule.text('HEAD\n');
      capsule.include(context, 'root', 'simulation', storedId);
      capsule.text('\nTAIL');
    });
  });
  const prepared = prompt.prepare();
  assert.match(prepared.messages[0].content, /Harbor at dawn/);
  assert.match(prepared.messages[0].content, /directable_plugin="world_state_tracker"/);
  // Semantic ancestry unchanged: catalogue snapshot (core + validated plugin
  // declarations, resolved through the PluginManager module test double).
  assert.equal(prepared.manifest.components['world_state_tracker.world_state_context'].parent, 'root.simulation');
  assert.equal(prepared.manifest.components['world_state_tracker.world_state_context'].owner, 'world_state_tracker');
  // EXACT tree: one occurrence per stored node (parent + child = 2, plus the
  // capsule layout wrapper — no synthetic duplicate parents).
  const wstOccs = prepared.manifest.occurrences.filter(o => String(o.componentId || '').startsWith('world_state_tracker.'));
  assert.equal(wstOccs.length, 2, `exactly parent + child occurrences (have ${wstOccs.length})`);
  const parentOcc = wstOccs.find(o => o.componentId === 'world_state_tracker.world_state_context');
  const childOcc = wstOccs.find(o => o.componentId === 'world_state_tracker.world_state_context.current_state');
  assert.ok(parentOcc && childOcc, 'parent and child must both render');
  // Source reference ties this rendering to the stored occurrence.
  assert.deepEqual(parentOcc.source, { target: 'root', slot: 'simulation', sourceId: storedId });
  const storedChildId = context.promptComponents.root.simulation[0].children[0].sourceId;
  assert.ok(typeof storedChildId === 'string' && storedChildId, 'stored child must carry a stable sourceId');
  assert.notEqual(storedChildId, storedId, 'parent and child sourceIds must differ');
  assert.deepEqual(childOcc.source, { target: 'root', slot: 'simulation', sourceId: storedChildId });
  // Physical containment: child nests under the rendered parent, not a wrapper.
  assert.equal(childOcc.containerOccurrenceId, parentOcc.occurrenceId);
  // Child span slices to its actual text.
  const childBytes = prepared.manifest.spans
    .filter(s => s.occurrenceId === childOcc.occurrenceId)
    .sort((a, b) => a.start - b.start)
    .map(s => prepared.messages[0].content.slice(s.start, s.end)).join('');
  assert.equal(childBytes, 'Harbor at dawn.');
  // Unknown sources throw instead of rendering phantom bytes. (Resolution
  // is eager at include() time — identity must exist before bytes do.)
  const bad = new Prompt({ id: 'bad', turnContext: context });
  assert.throws(() => bad.user(message => {
    message.add('root', container => {
      container.include(context, 'root', 'simulation', 'pcs-does-not-exist');
    });
  }), /Unknown prompt source/);
  // Mismatched identity is impossible by construction: include() derives the
  // componentId from the resolved source. Re-resolving the same sourceId
  // yields the same id; a different stored node yields a different id.
  const prompt2 = new Prompt({ id: 'second', turnContext: context });
  prompt2.registerOccurrenceIdentity(context.promptComponents.root.simulation[0], ['root.simulation']);
  prompt2.user(message => {
    message.add('root', container => {
      container.include(context, 'root', 'simulation', storedId);
    });
  });
  const prepared2 = prompt2.prepare();
  const parent2 = prepared2.manifest.occurrences.find(o => o.componentId === 'world_state_tracker.world_state_context');
  assert.deepEqual(parent2.source.sourceId, storedId, 'same stored source renders the same identity everywhere');
});

test('include() renders a three-level plugin tree with exact physical nesting', () => {
  // time -> date: the plan's canonical deep-tree case. Proves recursion (not
  // one-level flattening) and immediate-parent containment at every level.
  const TurnContext = require('../turncontext.js');
  const context = new TurnContext('Deep Tree Test');
  const { buildTools } = require('../plugin_manager/runtime/tools_builder.js');
  const tools = buildTools(
    { plugins: new Map(), disabledPlugins: new Map(), promptRegistry: new Map() },
    'world_state_tracker', context
  );
  tools.prompt.contribute({
    id: 'world_state_context', to: 'root.simulation',
    label: 'World state context', description: 'Pre-action world state.',
    children: { time: { date: 'The 3rd of March.' } }
  });
  const stored = context.promptComponents.root.simulation[0];
  const prompt = new Prompt({ id: 'deep-tree', turnContext: context });
  prompt.registerOccurrenceIdentity(stored, ['root.simulation']);
  prompt.user(message => {
    message.add('root', container => {
      container.include(context, 'root', 'simulation', stored.sourceId);
    });
  });
  const prepared = prompt.prepare();
  const wstOccs = prepared.manifest.occurrences.filter(o => String(o.componentId || '').startsWith('world_state_tracker.'));
  assert.equal(wstOccs.length, 3, `exactly one occurrence per stored node (have ${wstOccs.length})`);
  const byId = new Map(wstOccs.map(o => [o.componentId, o]));
  const ctxNode = byId.get('world_state_tracker.world_state_context');
  const timeNode = byId.get('world_state_tracker.world_state_context.time');
  const dateNode = byId.get('world_state_tracker.world_state_context.time.date');
  assert.ok(ctxNode && timeNode && dateNode, 'all three levels must render');
  assert.equal(timeNode.containerOccurrenceId, ctxNode.occurrenceId, 'time nests under context');
  assert.equal(dateNode.containerOccurrenceId, timeNode.occurrenceId, 'date nests under time');
  assert.deepEqual(dateNode.source.sourceId, stored.children[0].children[0].sourceId);
  const dateBytes = prepared.manifest.spans
    .filter(s => s.occurrenceId === dateNode.occurrenceId)
    .sort((a, b) => a.start - b.start)
    .map(s => prepared.messages[0].content.slice(s.start, s.end)).join('');
  assert.equal(dateBytes, 'The 3rd of March.');
  // Catalogue ancestry unchanged at every level.
  assert.equal(prepared.manifest.components['world_state_tracker.world_state_context.time.date'].parent, 'world_state_tracker.world_state_context.time');
});

test('registerOccurrenceIdentity rejects forged owner, unknown id, and wrong anchor', () => {
  const TurnContext = require('../turncontext.js');
  const context = new TurnContext('Forgery Test');
  const { buildTools } = require('../plugin_manager/runtime/tools_builder.js');
  const tools = buildTools(
    { plugins: new Map(), disabledPlugins: new Map(), promptRegistry: new Map() },
    'world_state_tracker', context
  );
  tools.prompt.contribute({
    id: 'world_state_context', to: 'root.simulation',
    label: 'World state context', description: 'Pre-action world state.',
    text: 'Harbor at dawn.'
  });
  const stored = context.promptComponents.root.simulation[0];

  const prompt = new Prompt({ id: 'forgery', turnContext: context });
  // Correct placement resolves.
  prompt.registerOccurrenceIdentity(stored, ['root.simulation']);

  // Unknown component id is never grantable, even with a plausible shape.
  assert.throws(
    () => prompt.registerOccurrenceIdentity({ ...stored, componentId: 'evil.forged' }, ['root.simulation']),
    /not registered/
  );
  // Forged owner disagrees with the validated registration.
  assert.throws(
    () => prompt.registerOccurrenceIdentity({ ...stored, owner: 'imaginary_plugin' }, ['root.simulation']),
    /claims owner 'imaginary_plugin'/
  );
  // Wrong slot anchor: catalogue ancestry does not lead under root.canon.
  assert.throws(
    () => prompt.registerOccurrenceIdentity(stored, ['root.canon']),
    /not catalogue-ancestored under slot anchor root.canon/
  );
});

test('registerOccurrenceIdentity enforces descendant catalogue parentage', () => {
  const TurnContext = require('../turncontext.js');
  const context = new TurnContext('Descendant Test');
  const { buildTools } = require('../plugin_manager/runtime/tools_builder.js');
  const tools = buildTools(
    { plugins: new Map(), disabledPlugins: new Map(), promptRegistry: new Map() },
    'world_state_tracker', context
  );
  tools.prompt.contribute({
    id: 'world_state_context', to: 'root.simulation',
    label: 'World state context', description: 'Pre-action world state.',
    children: { current_state: 'Harbor at dawn.' }
  });
  const stored = context.promptComponents.root.simulation[0];
  const prompt = new Prompt({ id: 'descendant', turnContext: context });
  prompt.registerOccurrenceIdentity(stored, ['root.simulation']);

  // A child claiming a catalogue parent that is not the node it nests under
  // (or is unregistered) fails.
  const forged = {
    ...stored,
    children: [{ ...stored.children[0], componentId: 'world_state_tracker.world_state_context.time' }]
  };
  assert.throws(() => prompt.registerOccurrenceIdentity(forged, ['root.simulation']), /not registered/);
});

test('includeComponent selects one repeated source by instanceKey without claiming its key twice', () => {
  const TurnContext = require('../turncontext.js');
  const context = new TurnContext('Repeated lore');
  for (const [instanceKey, text] of [['first', 'Old lore.'], ['second', 'Current lore.']]) {
    context.addPromptOccurrence('root', 'canon', {
      kind: 'component', componentId: 'core.canon.static_lore_file',
      instanceKey, text, children: [], owner: 'core'
    });
  }
  const selected = context.promptComponents.root.canon[1];
  const prompt = new Prompt({ id: 'selected-lore', turnContext: context });
  prompt.user(message => message.includeComponent('core.canon.static_lore_file', { instanceKey: 'second' }));
  const prepared = prompt.prepare();
  assert.equal(prepared.messages[0].content, 'Current lore.');
  const occurrence = prepared.manifest.occurrences.find(item => item.componentId === 'core.canon.static_lore_file');
  assert.equal(occurrence.instanceKey, 'second');
  assert.equal(occurrence.source.sourceId, selected.sourceId);
  const bySourceId = new Prompt({ id: 'selected-by-source', turnContext: context });
  bySourceId.user(message => message.includeComponent('core.canon.static_lore_file', { sourceId: selected.sourceId }));
  assert.equal(bySourceId.prepare().messages[0].content, 'Current lore.');
  const ambiguous = new Prompt({ id: 'ambiguous-lore', turnContext: context });
  assert.throws(() => ambiguous.user(message => message.includeComponent('core.canon.static_lore_file')), /Ambiguous prompt component/);
});

test('included source must reside beneath its registered slot, including low-level includes', () => {
  const TurnContext = require('../turncontext.js');
  const context = new TurnContext('Misplaced lore');
  context.addPromptOccurrence('root', 'simulation', {
    kind: 'component', componentId: 'core.canon.static_lore_file',
    instanceKey: null, text: 'Misplaced lore.', children: [], owner: 'core'
  });
  const sourceId = context.promptComponents.root.simulation[0].sourceId;
  const byId = new Prompt({ id: 'bad-id', turnContext: context });
  assert.throws(() => byId.user(message => message.includeComponent('core.canon.static_lore_file')), /root\.simulation/);
  const bySource = new Prompt({ id: 'bad-source', turnContext: context });
  assert.throws(() => bySource.user(message => message.include(context, 'root', 'simulation', sourceId)), /root\.simulation/);
});

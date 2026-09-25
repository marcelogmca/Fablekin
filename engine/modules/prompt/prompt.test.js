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

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderOccurrenceText,
  renderSlotText,
  fragmentizeOccurrence,
  emitOccurrence,
  walkOccurrence
} = require('./slot_renderer.js');

function leaf(componentId, text) {
  return { kind: 'component', componentId, instanceKey: null, text, children: [], owner: 'core' };
}
function container(componentId, text, children) {
  return { kind: 'component', componentId, instanceKey: null, text, children, owner: 'core' };
}

// Collect the bytes a composer would render: container opens/closes, nested
// text, and nested component leaves. Mirrors ComponentBuilder's structure.
function renderViaEmitter(occurrence) {
  const parts = [];
  const makeEmitter = () => ({
    emitLeaf: (componentId, text, opts) => {
      if (opts?.prefix) parts.push(opts.prefix);
      parts.push(text);
      if (opts?.suffix) parts.push(opts.suffix);
    },
    emitContainer: (componentId, opts, build) => {
      if (opts?.prefix) parts.push(opts.prefix);
      build(makeEmitter());
      if (opts?.suffix) parts.push(opts.suffix);
    },
    separator: (text) => parts.push(text),
    text: (text) => parts.push(text)
  });
  emitOccurrence(makeEmitter(), occurrence);
  return parts.join('');
}

test('fragmentizeOccurrence is the single render order', () => {
  const node = container('x.p', '', [leaf('x.a', 'AAA'), leaf('x.b', 'BBB')]);
  assert.deepEqual(
    fragmentizeOccurrence(node).map(f => f.kind === 'child' ? `child:${f.node.componentId}` : `own:${f.text}`),
    ['child:x.a', 'own:\n\n', 'child:x.b']
  );
  assert.equal(renderOccurrenceText(node), 'AAA\n\nBBB');
});

test('emitOccurrence renders each child exactly once (no double-render)', () => {
  const node = container('x.p', '', [leaf('x.a', 'AAA'), leaf('x.b', 'BBB')]);
  const emitted = renderViaEmitter(node);
  assert.equal(emitted, renderOccurrenceText(node), 'composed bytes must equal the flat projection');
  assert.equal(emitted, 'AAA\n\nBBB');
});

test('own text and children compose once, in order', () => {
  const node = container('x.p', 'HEAD', [leaf('x.a', 'AAA'), leaf('x.b', 'BBB')]);
  const emitted = renderViaEmitter(node);
  assert.equal(emitted, renderOccurrenceText(node));
  assert.equal(emitted, 'HEAD\n\nAAA\n\nBBB');
});

test('directable framing is node-owned and appears once', () => {
  const node = {
    kind: 'component', componentId: 'x.p', instanceKey: null, text: 'Body.', children: [], owner: 'x',
    directable: true, directablePluginId: 'world_state_tracker'
  };
  const emitted = renderViaEmitter(node);
  assert.equal(emitted, renderOccurrenceText(node));
  assert.equal((emitted.match(/directable_plugin="world_state_tracker"/g) || []).length, 1);
  assert.equal(emitted, '<plugin_context directable_plugin="world_state_tracker">\nBody.\n</plugin_context>');
});

test('walkOccurrence events align with the flat projection', () => {
  const node = container('x.p', '', [leaf('x.a', 'AAA'), leaf('x.b', 'BBB')]);
  const events = [];
  walkOccurrence(node, {
    enter: (n) => events.push(`enter:${n.componentId}`),
    ownText: (n, text) => events.push(`own:${n.componentId}:${JSON.stringify(text)}`),
    leave: (n) => events.push(`leave:${n.componentId}`)
  });
  assert.deepEqual(events, [
    'enter:x.p',
    'enter:x.a', 'own:x.a:"AAA"', 'leave:x.a',
    'own:x.p:"\\n\\n"',
    'enter:x.b', 'own:x.b:"BBB"', 'leave:x.b',
    'leave:x.p'
  ]);
});

test('slot projection joins occurrences and skips empties', () => {
  const items = [leaf('root.simulation', 'One.'), leaf('root.simulation', ''), leaf('root.simulation', 'Two.')];
  assert.equal(renderSlotText(items), 'One.\n\nTwo.');
});

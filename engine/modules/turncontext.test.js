const { test } = require('node:test');
const assert = require('node:assert/strict');
const TurnContext = require('./turncontext.js');

// Deterministic sourceIds for snapshot assertions (uuids otherwise).
globalThis.__promptSourceIdForTests = (() => {
  let n = 0;
  return () => `pcs-test-${++n}`;
})();

function occ(componentId, text, children = []) {
  return { kind: 'component', componentId, instanceKey: null, text, children, owner: 'core' };
}

test('sourceIds persist through serialize/fromSnapshot and stay unique', () => {
  const context = new TurnContext('Snapshot Test');
  context.addPromptOccurrence('root', 'simulation', occ(
    'world_state_tracker.world_state_context', '',
    [occ('world_state_tracker.world_state_context.current_state', 'Harbor at dawn.')]
  ));
  const parent = context.promptComponents.root.simulation[0];
  const parentId = parent.sourceId;
  const childId = parent.children[0].sourceId;
  assert.ok(parentId && childId && parentId !== childId);

  const snapshot = context.serialize();
  const snapParent = snapshot.promptComponents.root.simulation[0];
  assert.equal(snapParent.sourceId, parentId, 'snapshot must carry the persisted sourceId');
  assert.equal(snapParent.children[0].sourceId, childId);

  const restored = TurnContext.fromSnapshot(snapshot, 'Snapshot Test', 1);
  const again = restored.promptComponents.root.simulation[0];
  assert.equal(again.sourceId, parentId, 'restore must preserve sourceIds exactly');
  assert.equal(again.children[0].sourceId, childId);

  // Same source rendering twice resolves to the same stored node.
  assert.equal(restored.getPromptSource('root', 'simulation', parentId), again);

  // Old string-era snapshots (no sourceIds) are rejected at the boundary.
  const legacy = JSON.parse(JSON.stringify(snapshot));
  delete legacy.promptComponents.root.simulation[0].sourceId;
  assert.throws(() => TurnContext.fromSnapshot(legacy, 'Snapshot Test', 1), /lacks a stable sourceId/);

  // Forged plugin identity in a snapshot is a shape/registration error at
  // compose time, not a silent provenance grant (asserted in prompt.test.js).
  delete globalThis.__promptSourceIdForTests;
});

test('post-freeze nested mutation of a frozen subtree throws', () => {
  const context = new TurnContext('Freeze Test');
  context.addPromptOccurrence('root', 'simulation', occ('root.simulation', 'Vault.'));
  const { deepFreezePromptOccurrence } = require('./turncontext.js');
  deepFreezePromptOccurrence(context.promptComponents.root.simulation[0]);
  assert.throws(() => {
    'use strict';
    context.promptComponents.root.simulation[0].text = 'MUTATED';
  }, TypeError);
  assert.equal(context.promptComponents.root.simulation[0].text, 'Vault.');
});

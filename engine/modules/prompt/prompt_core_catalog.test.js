const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CORE_COMPONENTS,
  getCoreComponent,
  getSlotGroup,
  getChildren,
  validateCatalog,
  validatePromptPieces
} = require('./prompt_core_catalog.js');

const PILLARS = ['root', 'writer', 'director'];
const SLOTS = ['protocol', 'canon', 'dynamic_knowledge', 'simulation', 'history', 'directives'];

test('pillars are top-level and each slot anchor belongs to its pillar', () => {
  assert.equal(validateCatalog(), true);
  for (const target of PILLARS) {
    assert.equal(CORE_COMPONENTS[target].parent, null, `${target} must be top-level`);
    for (const slot of SLOTS) {
      const id = `${target}.${slot}`;
      assert.ok(CORE_COMPONENTS[id], `missing ${id}`);
      assert.equal(CORE_COMPONENTS[id].parent, target, `${id} must belong to ${target}`);
    }
  }
});

test('slot placement is derived by the system, not supplied by contributors', () => {
  assert.equal(getSlotGroup('root', 'simulation'), CORE_COMPONENTS['root.simulation']);
  assert.equal(getSlotGroup('writer', 'directives'), CORE_COMPONENTS['writer.directives']);
  assert.throws(() => getSlotGroup('root', 'bogus'), /Unknown prompt target\/slot/);
  assert.throws(() => getSlotGroup('plugin', 'simulation'), /Unknown prompt target\/slot/);
  assert.equal(getCoreComponent('toString'), null);
  assert.equal(getCoreComponent('__proto__'), null);
});

test('hierarchy is expressed purely as parent relationships', () => {
  assert.deepEqual(getChildren('root').sort(), [
    'root.canon', 'root.directives', 'root.dynamic_knowledge',
    'root.history', 'root.protocol', 'root.simulation'
  ]);
  assert.equal(getChildren('writer.canon').length, 0);
  assert.deepEqual(getChildren('root.canon').sort(), ['core.canon.player_bio', 'core.canon.static_lore_file']);
  assert.deepEqual(getChildren('writer.directives'), ['core.writer.brief']);
  assert.deepEqual(getChildren('core.writer.brief'), []);
  assert.equal(CORE_COMPONENTS['core.writer.brief'].parent, 'writer.directives');
});

test('every entry carries exactly parent, label, description and owner', () => {
  const allowed = new Set(['parent', 'label', 'description', 'owner']);
  for (const [id, entry] of Object.entries(CORE_COMPONENTS)) {
    assert.deepEqual(Object.keys(entry).sort(), [...allowed].sort(), `${id} has unexpected metadata`);
    assert.equal(typeof entry.description, 'string');
    assert.ok(entry.description.trim().length > 0, `${id} needs a description`);
    assert.equal(entry.owner, 'core', `${id} owner must be core`);
  }
  assert.equal(Object.isFrozen(CORE_COMPONENTS), true);
});

test('plugin prompt piece trees validate at registration', () => {
  validatePromptPieces('world_state_tracker', {
    world_state_context: {
      target: 'root', slot: 'simulation',
      label: 'World state context', description: 'Continuity updates.',
      children: [{ key: 'current_state', label: 'Current state', description: 'Live state.' }]
    }
  });
  assert.throws(() => validatePromptPieces('p', { BadKey: { target: 'root', slot: 'simulation' } }), /snake_case/);
  assert.throws(() => validatePromptPieces('p', { a: { target: 'root', slot: 'bogus' } }), /Unknown prompt target\/slot/);
  assert.throws(() => validatePromptPieces('p', {
    dup: { target: 'root', slot: 'simulation', label: 'Dup', description: 'Dup.', children: [{ key: 'dup', label: 'x', description: 'y' }] }
  }), /Duplicate/);
  assert.throws(() => validatePromptPieces('p', {
    nolabel: { target: 'root', slot: 'simulation', label: '', description: 'Has desc.' }
  }), /label must be a non-empty string/);
  assert.throws(() => validatePromptPieces('p', {
    nodesc: { target: 'root', slot: 'simulation', label: 'No desc', description: '' }
  }), /description must be a non-empty string/);
  assert.throws(() => validatePromptPieces('p', 'nope'), /must be an object/);
  assert.throws(() => validatePromptPieces('p', {}), /at least one piece/);
  // buildPluginCatalogueEntries: plugin ids namespace to toolkit-stamped
  // parents — never caller-supplied hierarchy.
  const { buildPluginCatalogueEntries } = require('./prompt_core_catalog.js');
  const entries = buildPluginCatalogueEntries(new Map(Object.entries({
    world_state_tracker: {
      world_state_context: {
        target: 'root', slot: 'simulation',
        label: 'World state context', description: 'Continuity updates.',
        children: [{ key: 'current_state', label: 'Current state', description: 'Live state.' }]
      }
    }
  })));
  assert.equal(entries['world_state_tracker.world_state_context'].parent, 'root.simulation');
  assert.equal(entries['world_state_tracker.world_state_context'].owner, 'world_state_tracker');
  assert.equal(entries['world_state_tracker.world_state_context.current_state'].parent, 'world_state_tracker.world_state_context');
});

test('invalid hierarchy or missing identity fields are rejected', () => {
  assert.throws(() => validateCatalog({ a: { parent: 'missing', label: 'a', description: 'd', owner: 'core' } }), /unknown parent/);
  assert.throws(() => validateCatalog({ a: { parent: 'b', label: 'a', description: 'd', owner: 'core' }, b: { parent: 'a', label: 'b', description: 'd', owner: 'core' } }), /Cycle/);
  assert.throws(() => validateCatalog({ a: { parent: null, label: '', description: 'd', owner: 'core' } }), /Invalid prompt component/);
  assert.throws(() => validateCatalog({ a: { parent: null, label: 'a', owner: 'core' } }), /Invalid prompt component/);
  assert.throws(() => validateCatalog({ a: { parent: null, label: 'a', description: 'd' } }), /Invalid prompt component/);
  assert.throws(() => validateCatalog(['nope']), /must be an object/);
});

/**
 * Core prompt components: a flat identity + parent map.
 *
 * There is no separate "group" type. A component that others name as their
 * parent simply behaves as a group; the three pillars (root, writer, director)
 * are top-level, their slot anchors belong to them, and named payloads hang
 * off slots. Every entry declares a short description and an owner. Sizes,
 * budgets and token impact are deliberately absent — they come from observed
 * prompt manifests, never from static guesses.
 */

const CORE_COMPONENTS = Object.freeze({
  // Pillars: top-level owners, each holding its six slot anchors.
  root: { parent: null, label: 'Shared prefix', description: 'Context shared by the Director and the Writer.', owner: 'core' },
  writer: { parent: null, label: 'Writer', description: 'Private suffix read only by the Writer.', owner: 'core' },
  director: { parent: null, label: 'Director', description: 'Private suffix read only by the Director.', owner: 'core' },

  // Slot anchors. One per target+slot that core contributes to; these are the
  // stable parents a plugin contribution is placed under automatically.
  'root.protocol': { parent: 'root', label: 'Shared protocol', description: 'Shared system rules and execution contracts.', owner: 'core' },
  'root.canon': { parent: 'root', label: 'Shared canon', description: 'Shared lore, character sheets and player reference material.', owner: 'core' },
  'root.dynamic_knowledge': { parent: 'root', label: 'Shared dynamic knowledge', description: 'Retrieved world knowledge gathered for this turn.', owner: 'core' },
  'root.simulation': { parent: 'root', label: 'Shared simulation', description: 'Live world state, relationships, personality and inventory.', owner: 'core' },
  'root.history': { parent: 'root', label: 'Shared history', description: 'Narrative history at the assembled memory-LOD tiers.', owner: 'core' },
  'root.directives': { parent: 'root', label: 'Shared directives', description: 'High-priority shared directives for the current turn.', owner: 'core' },
  'writer.protocol': { parent: 'writer', label: 'Writer protocol', description: 'Writer-only reasoning and output scaffolding.', owner: 'core' },
  'writer.canon': { parent: 'writer', label: 'Writer-private canon', description: 'Canon reference material visible only to the Writer.', owner: 'core' },
  'writer.dynamic_knowledge': { parent: 'writer', label: 'Writer-private dynamic knowledge', description: 'Retrieved context visible only to the Writer.', owner: 'core' },
  'writer.simulation': { parent: 'writer', label: 'Writer-private simulation', description: 'Simulation state visible only to the Writer.', owner: 'core' },
  'writer.history': { parent: 'writer', label: 'Writer-private history', description: 'Historical context visible only to the Writer.', owner: 'core' },
  'writer.directives': { parent: 'writer', label: 'Writer directives', description: 'Writer-only overrides, brief and directives.', owner: 'core' },
  'director.protocol': { parent: 'director', label: 'Director protocol', description: 'Director-only reasoning and output scaffolding.', owner: 'core' },
  'director.canon': { parent: 'director', label: 'Director-private canon', description: 'Canon reference material visible only to the Director.', owner: 'core' },
  'director.dynamic_knowledge': { parent: 'director', label: 'Director-private dynamic knowledge', description: 'Retrieved context visible only to the Director.', owner: 'core' },
  'director.simulation': { parent: 'director', label: 'Director-private simulation', description: 'Simulation state visible only to the Director.', owner: 'core' },
  'director.history': { parent: 'director', label: 'Director-private history', description: 'Historical context visible only to the Director.', owner: 'core' },
  'director.directives': { parent: 'director', label: 'Director directives', description: 'Director-only directives and guidance.', owner: 'core' },

  // Named core payloads whose identity matters independently of their slot.
  'core.shared.engine_contract': { parent: 'root.protocol', label: 'Engine contract', description: 'Role contract heading shared system message.', owner: 'core' },
  'core.shared.interpretation_lock': { parent: 'root.protocol', label: 'Directive interpretation lock', description: 'Locks each stage to its role so directives cannot swap agents.', owner: 'core' },
  'core.canon.static_lore_file': { parent: 'root.canon', label: 'Static lore file', description: 'A single lore file included from the Lore Book.', owner: 'core' },
  'core.canon.player_bio': { parent: 'root.canon', label: 'Player bio', description: 'The player character biography.', owner: 'core' },
  'core.history.full_chapter': { parent: 'root.history', label: 'Full-text chapter replay', description: 'Verbatim replay of a recent chapter as chat messages.', owner: 'core' },
  'core.writer.thinking_framework': { parent: 'writer.protocol', label: 'Thinking framework', description: 'The Writer chain-of-thought framework.', owner: 'core' },
  'core.writer.brief': { parent: 'writer.directives', label: 'Director brief', description: "The Director's brief guiding the Writer.", owner: 'core' },
  'core.writer.task': { parent: 'writer', label: 'Writer task', description: 'The agent-task instruction heading the Writer suffix.', owner: 'core' },
  'core.writer.current_action': { parent: 'writer', label: 'Current action', description: 'The player action or scene prompt the Writer must narrate.', owner: 'core' },
  'core.writer.private_context': { parent: 'writer', label: 'Writer-private context', description: 'Combined Writer-private canon, knowledge, history and simulation.', owner: 'core' },
  'core.writer.inventory_intent': { parent: 'writer', label: 'Inventory intent', description: 'Player inventory use or disposal intent for this turn.', owner: 'core' },
  'core.writer.bottom_instruction': { parent: 'writer', label: 'Bottom instruction', description: 'Trailing instruction appended after the Writer suffix.', owner: 'core' }
});

function getCoreComponent(id) {
  return typeof id === 'string' && Object.hasOwn(CORE_COMPONENTS, id) ? CORE_COMPONENTS[id] : null;
}

// The anchor a plugin contribution is placed under, derived from its
// destination. Throws so an unknown target/slot fails loudly at wiring time.
function getSlotGroup(target, slot) {
  const id = `${target}.${slot}`;
  const component = getCoreComponent(id);
  if (!component || component.parent !== target) {
    throw new RangeError(`Unknown prompt target/slot: ${id}`);
  }
  return component;
}

function getChildren(id) {
  return Object.entries(CORE_COMPONENTS)
    .filter(([, component]) => component.parent === id)
    .map(([childId]) => childId);
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Accepts a catalogue so malformed hierarchies can be tested without weakening
// the frozen core definition. Identity fields are mandatory; every parent must
// exist and cycles are rejected.
function validateCatalog(catalog = CORE_COMPONENTS) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new TypeError('Prompt catalogue must be an object.');
  }
  for (const [id, entry] of Object.entries(catalog)) {
    if (!entry || !isNonBlankString(entry.label) || !isNonBlankString(entry.description) || !isNonBlankString(entry.owner)) {
      throw new Error(`Invalid prompt component: ${id}`);
    }
    if (entry.parent != null && !Object.hasOwn(catalog, entry.parent)) {
      throw new Error(`Prompt component ${id} has an unknown parent: ${entry.parent}`);
    }
    const seen = new Set();
    let current = id;
    while (current != null) {
      if (seen.has(current)) throw new Error(`Cycle in prompt catalogue at ${current}`);
      seen.add(current);
      current = catalog[current]?.parent ?? null;
    }
  }
  return true;
}

validateCatalog();

module.exports = {
  CORE_COMPONENTS,
  getCoreComponent,
  getSlotGroup,
  getChildren,
  validateCatalog
};

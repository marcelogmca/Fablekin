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
  'core.writer.bottom_instruction': { parent: 'writer', label: 'Bottom instruction', description: 'Trailing instruction appended after the Writer suffix.', owner: 'core' },

  // Director named payloads: the private context assembly, task framing, and
  // instruction suffixes that distinguish the Director's four call variants.
  'core.director.context_message': { parent: 'director', label: 'Director context message', description: 'The single Director context user message joining task, context, constraints and action.', owner: 'core' },
  'core.director.task': { parent: 'core.director.context_message', label: 'Director task', description: 'The agent-task instruction heading the Director context message.', owner: 'core' },
  'core.director.context': { parent: 'core.director.context_message', label: 'Director context', description: 'Director-private canon, knowledge, history, simulation, ledger and advisories.', owner: 'core' },
  'core.director.constraints': { parent: 'core.director.context_message', label: 'Director constraints', description: 'Player name, directives and global constraints for the Director.', owner: 'core' },
  'core.director.inventory_intent': { parent: 'core.director.context_message', label: 'Director inventory intent', description: 'Player inventory intent section in the Director context message.', owner: 'core' },
  'core.director.current_action': { parent: 'core.director.context_message', label: 'Director current action', description: 'The player action the Director must weigh in its analysis.', owner: 'core' },
  'core.director.analysis_instructions': { parent: 'director.protocol', label: 'Analysis instructions', description: 'Cognitive framework and output format for the Director analysis call.', owner: 'core' },
  'core.director.ledger_instructions': { parent: 'director.protocol', label: 'Ledger instructions', description: 'Output format for the Director ledger update call.', owner: 'core' },
  'core.director.plugin_feedback_instructions': { parent: 'director.protocol', label: 'Plugin feedback instructions', description: 'Instructions for the Director plugin-feedback call.', owner: 'core' },
  'core.director.analysis_response': { parent: 'director', label: 'Analysis response', description: 'Model-generated analysis re-injected as context for ledger and feedback calls.', owner: 'core' },
  // Plugin task requests: a neutral parent for plugin-owned LLM calls that
  // are their own request (not Writer/Director/VN-background context). Plugin
  // task components parent here, never under an agent pillar they do not own.
  'core.plugin_tasks': { parent: null, label: 'Plugin tasks', description: 'Standalone plugin-owned LLM requests with their own suffix and schema.', owner: 'core' },

  // VN-background capsule pieces: the shared post-turn context plus the
  // per-call scene excerpt and task suffix. Plugin-owned slot content inside
  // the capsule keeps its provenance via the shared-prefix occurrences.
  // The capsule + scene + suffix ids are resolved with per-prompt dynamic
  // registration (see buildVnBackgroundPrompt) because several section ids
  // below are request-local, not static catalogue entries.
  'core.vn_background.system': { parent: 'root.protocol', label: 'VN background system', description: 'Role contract for post-turn VN background analysis.', owner: 'core' },

  // Core VN calls: the small shared scene-capsule family used by asset
  // selection and VN analysis. Deliberately separate from the larger
  // plugin VN-background capsule (canon/history). Neutral `core.vn`
  // parents — never Writer/Director/VN-background.
  'core.vn': { parent: null, label: 'Core VN calls', description: 'Small shared scene context for core visual-novel analysis and asset selection.', owner: 'core' },
  'core.vn.system': { parent: 'core.vn', label: 'Core VN system', description: 'Role contract for core VN post-processing analysis.', owner: 'core' },
  'core.vn.scene_capsule': { parent: 'core.vn', label: 'Core VN scene capsule', description: 'Frozen player and current-input capsule shared by core VN calls.', owner: 'core' },
  'core.vn.scene': { parent: 'core.vn', label: 'Core VN scene', description: 'Formatted current-chapter scene excerpt for a core VN call.', owner: 'core' },
  'core.vn.task': { parent: 'core.vn', label: 'Core VN task', description: 'Task-specific instructions for a core VN call.', owner: 'core' },
  'core.vn.dialogue_transform': { parent: 'core.vn', label: 'Dialogue transform', description: 'Raw chapter text plus dialogue-tagging instructions for the dialogue processor.', owner: 'core' },
  'core.vn.emotion_classification': { parent: 'core.vn', label: 'Emotion classification', description: 'Indexed dialogue chunk plus emotion/mood taxonomy for the emotion classifier.', owner: 'core' },

  // Standalone core memory calls: RAG overview, query expansion, summaries.
  // No shared prefix — each request is one system/user pair (or a single
  // user message) with its own stable prompt id.
  'core.memory': { parent: null, label: 'Core memory calls', description: 'Standalone retrieval and summarization LLM calls.', owner: 'core' },
  'core.memory.rag_overview': { parent: 'core.memory', label: 'RAG overview', description: 'Ultra-brief setting/event overview stored in vector metadata.', owner: 'core' },
  'core.memory.query_generation': { parent: 'core.memory', label: 'Query generation', description: 'Alternative retrieval queries expanded from the user question.', owner: 'core' },
  'core.memory.summary_system': { parent: 'core.memory', label: 'Summary system', description: 'Role contract for summary generation.', owner: 'core' },
  'core.memory.summary_content': { parent: 'core.memory', label: 'Summary content', description: 'Source text to summarize.', owner: 'core' },
  'core.memory.synopsis_system': { parent: 'core.memory', label: 'Synopsis system', description: 'Role contract for synopsis generation.', owner: 'core' },
  'core.memory.synopsis_content': { parent: 'core.memory', label: 'Synopsis content', description: 'Source text to turn into a titled synopsis.', owner: 'core' },
  'core.memory.arc_compression': { parent: 'core.memory', label: 'Arc compression', description: 'Ultra-compression instruction plus old-synopsis content for an arc bucket.', owner: 'core' }
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

function normalizePluginKey(value, what) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Prompt piece ${what} must be a non-empty string.`);
  }
  const key = value.trim();
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key)) {
    throw new TypeError(`Prompt piece ${what} '${value}' must be snake_case starting with a letter.`);
  }
  return key;
}

function validatePromptPieceTree(pluginId, piece, seen) {
  const key = normalizePluginKey(piece.key, 'key');
  if (seen.has(key)) {
    throw new Error(`Duplicate prompt piece key '${key}' for plugin '${pluginId}'.`);
  }
  seen.add(key);
  if (typeof piece.label !== 'string' || !piece.label.trim()) {
    throw new TypeError(`Prompt piece '${key}' label must be a non-empty string.`);
  }
  if (typeof piece.description !== 'string' || !piece.description.trim()) {
    throw new TypeError(`Prompt piece '${key}' description must be a non-empty string.`);
  }
  const children = piece.children === undefined ? [] : piece.children;
  if (!Array.isArray(children)) {
    throw new TypeError(`Prompt piece '${key}' children must be an array.`);
  }
  for (const child of children) {
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      throw new TypeError(`Prompt piece '${key}' has a malformed child.`);
    }
    validatePromptPieceTree(pluginId, child, seen);
  }
  return key;
}

// Registered-key prompt model: plugins declare identity ONCE at load time;
// turns only supply content. Ownership and top-level placement come from the
// toolkit, never from per-turn injection arguments.
function validatePromptPieces(pluginId, pieces) {
  if (!pieces || typeof pieces !== 'object' || Array.isArray(pieces)) {
    throw new TypeError(`Plugin '${pluginId}' registered prompt definitions must be an object.`);
  }
  const entries = Object.entries(pieces);
  if (entries.length === 0) {
    throw new TypeError(`Plugin '${pluginId}' registered prompt definitions must contain at least one piece.`);
  }
  const seen = new Set();
  for (const [key, piece] of entries) {
    if (!piece || typeof piece !== 'object' || Array.isArray(piece)) {
      throw new TypeError(`Plugin '${pluginId}' prompt piece '${key}' must be an object.`);
    }
    if (key !== (piece.key || key)) {
      throw new TypeError(`Plugin '${pluginId}' prompt piece key mismatch: '${key}'.`);
    }
    // Two declaration shapes:
    //  - slot contribution: { target, slot } — top parent derived from slot.
    //  - standalone task:  { parent }      — explicit catalogue parent
    //    (e.g. core.plugin_tasks) for plugin-owned LLM requests.
    const hasSlot = piece.target !== undefined || piece.slot !== undefined;
    const hasParent = piece.parent !== undefined;
    if (hasSlot && hasParent) {
      throw new TypeError(`Plugin '${pluginId}' prompt piece '${key}' must declare either target/slot or parent, not both.`);
    }
    if (hasSlot) {
      if (typeof piece.target !== 'string' || typeof piece.slot !== 'string') {
        throw new TypeError(
          `Plugin '${pluginId}' prompt piece '${key}' must declare target and slot.`
        );
      }
      getSlotGroup(piece.target, piece.slot);
    } else if (hasParent) {
      if (typeof piece.parent !== 'string' || !piece.parent) {
        throw new TypeError(`Plugin '${pluginId}' prompt piece '${key}' parent must be a non-empty string.`);
      }
      if (!Object.hasOwn(CORE_COMPONENTS, piece.parent)) {
        throw new Error(`Plugin '${pluginId}' prompt piece '${key}' has an unknown parent: ${piece.parent}.`);
      }
    } else {
      throw new TypeError(`Plugin '${pluginId}' prompt piece '${key}' must declare target/slot or parent.`);
    }
    validatePromptPieceTree(pluginId, { ...piece, key }, seen);
  }
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Immutable catalogue entries for ACTIVE plugins: core definitions plus
// every validated contribution-time plugin tree, namespaced `${pluginId}.${key}`
// with toolkit-stamped ownership. Composers receive a frozen snapshot of
// this (never a stored occurrence's embedded declaration) — see
// PluginManager.rebuildPromptCatalogueSnapshot().
function buildPluginCatalogueEntries(promptPiecesByPlugin) {
  const entries = Object.create(null);
  if (!promptPiecesByPlugin) return entries;
  const source = promptPiecesByPlugin instanceof Map
    ? promptPiecesByPlugin.entries()
    : Object.entries(promptPiecesByPlugin);
  for (const [pluginId, pieces] of source) {
    if (!pieces || typeof pieces !== 'object') continue;
    for (const [key, piece] of Object.entries(pieces)) {
      const localKey = normalizePluginKey(piece.key || key, 'key');
      const topId = `${pluginId}.${localKey}`;
      // Slot contributions MUST resolve through getSlotGroup (throws on
      // unknown target/slot); standalone tasks use their declared parent.
      // NOTE: getSlotGroup returns the catalogue ENTRY (no .id field) — the
      // anchor id is `${target}.${slot}` by construction.
      const parentId = piece.target !== undefined
        ? `${piece.target}.${piece.slot}`
        : piece.parent;
      if (piece.target !== undefined) getSlotGroup(piece.target, piece.slot);
      entries[topId] = Object.freeze({
        parent: parentId,
        label: String(piece.label).trim(),
        description: String(piece.description).trim(),
        owner: pluginId
      });
      const walk = (children, ancestry) => {
        for (const child of children || []) {
          const childKey = normalizePluginKey(child.key, 'key');
          const childId = `${pluginId}.${[...ancestry, childKey].join('.')}`;
          entries[childId] = Object.freeze({
            parent: `${pluginId}.${ancestry.join('.')}`,
            label: String(child.label).trim(),
            description: String(child.description).trim(),
            owner: pluginId
          });
          walk(child.children, [...ancestry, childKey]);
        }
      };
      walk(piece.children, [localKey]);
    }
  }
  return entries;
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
  isNonBlankString,
  normalizePluginKey,
  buildPluginCatalogueEntries,
  validateCatalog,
  validatePromptPieces
};

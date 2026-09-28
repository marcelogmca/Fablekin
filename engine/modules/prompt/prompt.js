/**
 * Fablekin Prompt composer — Prompt + PreparedPrompt.
 *
 * A Prompt is the only supported way to assemble an LLM request once callers
 * migrate to it. It owns three separate concerns:
 *
 *   - sequence:    the ordered stream of messages (Prompt).
 *   - composition: ordered pieces inside one message role (MessageBuilder).
 *   - meaning:     parent relationships from the catalogue (parent links).
 *
 * Catalogue entries supply identity (id, label, description, owner) and
 * placement (parent). This module supplies exact provenance: every rendered
 * character belongs to exactly one occurrence, and the manifest records
 * message indices plus JS-string offsets (exclusive end) so that
 * `content.slice(span.start, span.end)` always reconstructs the bytes.
 *
 * Raw composition concatenates exactly what it receives — no implicit
 * trimming, newlines, headings, or XML tags. Formatting helpers (prefix,
 * separator, suffix) attribute their bytes to the owning component.
 *
 * Sizes and token estimates are deliberately absent here. They are computed
 * from PreparedPrompt manifests by analysis tooling, never guessed in static
 * definitions.
 */

const crypto = require('crypto');
const { CORE_COMPONENTS } = require('./prompt_core_catalog.js');

// v2: occurrences may carry a `source` reference (TurnContext slot entry +
// stable index within that entry's text order) alongside the semantic
// componentId/parent. Semantic ancestry is unchanged; the source records
// which stored occurrence a rendered node was included FROM.
const PROMPT_MANIFEST_VERSION = 2;
// Hex chars of the sha256 over the rendered messages. Same convention as the
// shared narrative prefixHash.
const PROMPT_HASH_LENGTH = 16;
const VALID_ROLES = new Set(['system', 'user', 'assistant']);

function resolveComponent(catalog, id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError(`Prompt component id must be a non-empty string, got ${String(id)}.`);
  }
  const entry = Object.hasOwn(catalog, id) ? catalog[id] : undefined;
  if (!entry) {
    throw new RangeError(`Unknown prompt component: ${id}`);
  }
  return entry;
}

function ancestorIds(catalog, id) {
  const chain = [];
  const seen = new Set();
  let current = catalog[id] ? catalog[id].parent : null;
  while (current != null) {
    if (seen.has(current)) {
      throw new Error(`Cycle in prompt catalogue at ${current}`);
    }
    seen.add(current);
    chain.push(current);
    current = Object.hasOwn(catalog, current) ? catalog[current].parent : null;
  }
  return chain;
}

function isDescendantOf(catalog, childId, ancestorId) {
  return ancestorIds(catalog, childId).includes(ancestorId);
}

function normalizeOptions(options) {
    if (options == null) options = {};
    if (typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('Prompt add() options must be an object.');
    }
    const { instanceKey = null, prefix = '', separator = '', suffix = '', finalizeText = undefined, historyView = undefined } = options;
    if (instanceKey != null && (typeof instanceKey !== 'string' || instanceKey.length === 0)) {
        throw new TypeError('instanceKey must be a non-empty string.');
    }
    for (const [name, value] of [['prefix', prefix], ['separator', separator], ['suffix', suffix]]) {
        if (typeof value !== 'string') {
            throw new TypeError(`${name} must be a string.`);
        }
    }
    if (finalizeText !== undefined && finalizeText !== null && typeof finalizeText !== 'function') {
        throw new TypeError('finalizeText option must be a function.');
    }
    // historyView is composer-internal metadata for attributed history views
    // ({preset, fullChars, renderedChars}); never part of the prompt DSL.
    if (historyView !== undefined) {
        if (!historyView || typeof historyView !== 'object' || Array.isArray(historyView) ||
            typeof historyView.preset !== 'string' || !Number.isInteger(historyView.fullChars) ||
            !Number.isInteger(historyView.renderedChars)) {
            throw new TypeError('historyView must be {preset, fullChars, renderedChars}.');
        }
    }
    // Undefined = inherit the prompt finalize; explicit null = pre-finalized.
    // The node must distinguish the two, so keep undefined as-is.
    return { instanceKey, prefix, separator, suffix, finalizeText, historyView };
}

function makeLeafNode(componentId, opts, text) {
  // separator is meaningless on leaves (no children); prefix/suffix wrap the leaf.
  return {
    kind: 'component',
    componentId,
    instanceKey: opts.instanceKey,
    prefix: opts.prefix,
    separator: '',
    suffix: opts.suffix,
    finalizeText: opts.finalizeText,
    ...(opts.historyView !== undefined ? { optionsHistoryView: { ...opts.historyView } } : {}),
    text,
    children: null
  };
}

function makeContainerNode(componentId, opts) {
  return {
    kind: 'component',
    componentId,
    instanceKey: opts.instanceKey,
    prefix: opts.prefix,
    separator: opts.separator,
    suffix: opts.suffix,
    finalizeText: opts.finalizeText,
    ...(opts.historyView !== undefined ? { optionsHistoryView: { ...opts.historyView } } : {}),
    text: null,
    children: []
  };
}

function makeTextNode(text) {
  return { kind: 'text', text };
}

// Trusted-inclusion node: a reference to a TurnContext occurrence subtree
// resolved via turnContext.getPromptSource(). Unlike add(), it does NOT
// reparent: included nodes keep their semantic componentId/owner/ancestry.
// The manifest occurrence records `source` (slot + stable sourceId) so
// Writer/Director/VN renderings of the same stored occurrence are
// recognizable as the same source.
function makeIncludeNode(componentId, opts, source) {
  return {
    kind: 'include',
    componentId,
    instanceKey: opts.instanceKey,
    prefix: opts.prefix,
    separator: opts.separator,
    suffix: opts.suffix,
    finalizeText: opts.finalizeText,
    source,
    children: null,
    text: null
  };
}

function assertIncludeSource(source) {
  // Trusted source reference: { target, slot, sourceId }. The sourceId is the
  // stable id stamped on the stored occurrence at insertion time — never a
  // positional index (placement is not identity). componentId is always
  // derived from the resolved source, never caller-supplied.
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('include() source must be an object.');
  }
  const { target, slot, sourceId } = source;
  if (typeof target !== 'string' || !target || typeof slot !== 'string' || !slot) {
    throw new TypeError('include() source requires { target, slot, sourceId }.');
  }
  if (typeof sourceId !== 'string' || !sourceId) {
    throw new TypeError('include() source sourceId must be a non-empty string.');
  }
  return { target, slot, sourceId };
}

// Builds a child node but does not attach it, so a throwing builder callback
// discards the partial node instead of leaving it in the tree. The prompt's
// dynamic-component overlay is consulted alongside the static catalogue so
// runtime plugin pieces resolve during composition (see _effectiveCatalog).
function createChildNode(prompt, catalog, containerIdOrNull, componentId, textOrBuild, options) {
  const opts = normalizeOptions(options);
  const effective = prompt && typeof prompt._effectiveCatalog === 'function' ? prompt._effectiveCatalog() : catalog;
  resolveComponent(effective, componentId);
  // A component nested inside ITSELF is a re-emission, not a hierarchy
  // violation: the occurrence renders as a leaf at that position (its text
  // is already the fully-formed slot content). Genuine cross-component
  // misplacement still throws.
  if (containerIdOrNull != null && componentId !== containerIdOrNull &&
      !isDescendantOf(effective, componentId, containerIdOrNull)) {
    throw new Error(`Cannot nest ${componentId} inside ${containerIdOrNull}: not a catalogue descendant.`);
  }
  if (typeof textOrBuild === 'string') {
    return makeLeafNode(componentId, opts, textOrBuild);
  }
  if (typeof textOrBuild === 'function') {
    const node = makeContainerNode(componentId, opts);
    const effective = prompt && typeof prompt._effectiveCatalog === 'function' ? prompt._effectiveCatalog() : catalog;
    const builder = new ComponentBuilder(prompt, node, effective);
    textOrBuild(builder);
    return node;
  }
  throw new TypeError(`Content for ${componentId} must be a string or a builder function.`);
}

class ComponentBuilder {
  constructor(prompt, node, catalog) {
    this._prompt = prompt;
    this._node = node;
    this._catalog = catalog;
  }

  // Registers a runtime (non-core) component identity for this prompt only.
  // Used for dynamic plugin pieces whose parent is system-derived (slot
  // anchor or ancestor piece). Core catalogue entries are never modified.
  // NOTE: this registers on the builder's composition-time catalogue view.
  // createChildNode() resolves against the prompt overlay, so callers that
  // pre-register a chain and then add() into the same prompt must register
  // through the PROMPT's overlay — see Prompt.registerDynamicComponent.
  registerDynamicComponent(componentId, entry) {
    this._prompt._assertMutable();
    return this._prompt._registerDynamicComponent(componentId, entry);
  }

  // NOTE: this._catalog is the composition-time snapshot. createChildNode()
  // consults the prompt's live overlay (see _effectiveCatalog), so dynamic
  // pieces registered mid-composition resolve here. Do NOT "fix" this by
  // passing a refreshed catalog — the prompt is the source of truth.
  // DEBUG-TRACE (prompt.js): uncomment the line inside createChildNode to
  // log every resolution (componentId + whether the overlay has it).
  add(componentId, textOrBuild, options) {
    this._prompt._assertMutable();
    const child = createChildNode(this._prompt, this._catalog, this._node.componentId, componentId, textOrBuild, options);
    this._node.children.push(child);
    return this;
  }

  prepend(componentId, textOrBuild, options) {
    this._prompt._assertMutable();
    const child = createChildNode(this._prompt, this._catalog, this._node.componentId, componentId, textOrBuild, options);
    this._node.children.unshift(child);
    return this;
  }

  // Raw bytes owned by this component (headings, wrappers, punctuation).
  text(value) {
    this._prompt._assertMutable();
    if (typeof value !== 'string') {
      throw new TypeError('Component text() must be a string.');
    }
    if (value.length > 0) {
      this._node.children.push(makeTextNode(value));
    }
    return this;
  }

  // Trusted inclusion: render a TurnContext occurrence subtree (resolved via
  // turnContext.getPromptSource(target, slot, sourceId)) at this position
  // WITHOUT reparenting it. The componentId is DERIVED from the resolved
  // source — callers never supply a second id that could mislabel the bytes.
  // Included nodes keep their semantic componentId/owner/ancestry; the
  // manifest records sourceId so renderings of the same stored occurrence are
  // recognizable across Writer/Director/VN requests.
  include(turnContext, target, slot, sourceId, options) {
    this._prompt._assertMutable();
    const resolved = this._prompt._resolvePromptSource(turnContext, target, slot, sourceId);
    const opts = normalizeOptions(options);
    const node = makeIncludeNode(resolved.componentId, opts, {
      target,
      slot,
      sourceId: resolved.sourceId
    });
    this._node.children.push(node);
    return this;
  }

  // Verbatim reuse of a KNOWN component id at component level: resolves the
  // current turn's stored occurrence (exact id, catalogue-checked,
  // disambiguated) and renders it unchanged under the source identity.
  includeComponent(componentId, options = {}) {
    this._prompt._assertMutable();
    const opts = options && typeof options === 'object' ? { ...options } : {};
    const includeTurnContext = this._prompt._turnContext || opts.includeTurnContext || null;
    delete opts.includeTurnContext;
    const resolved = this._prompt._resolveKnownComponent(includeTurnContext, componentId, opts);
    // instanceKey selects the stored source; the rendered occurrence takes
    // that key from the source itself. Claiming it on the include placeholder
    // would claim the same key twice during prepare().
    const nodeOpts = normalizeOptions({ ...opts, instanceKey: null });
    const node = makeIncludeNode(resolved.componentId, nodeOpts, {
      target: resolved.target,
      slot: resolved.slot,
      sourceId: resolved.sourceId
    });
    this._node.children.push(node);
    return this;
  }

  // The catalogue component id of the container being built. Cutover code
  // uses this to avoid self-nesting an occurrence inside its own slot anchor
  // (a component is never its own catalogue descendant).
  get containerId() {
    return this._node?.componentId || null;
  }
}

class MessageBuilder {
  constructor(prompt, spec, catalog) {
    this._prompt = prompt;
    this._spec = spec;
    this._catalog = catalog;
    this._separator = '';
  }

  // Optional join separator emitted between top-level children, owned by the
  // message itself. Messages are sequences, not catalogue components, so the
  // separator is recorded as message-owned formatting rather than attributed
  // to a parent piece.
  separator(value) {
    this._prompt._assertMutable();
    if (typeof value !== 'string') {
      throw new TypeError('Message separator() must be a string.');
    }
    this._spec.separator = value;
    return this;
  }

  // Top-level message builders expose no anonymous text(): content must first
  // name a registered component so every byte has an owner.
  add(componentId, textOrBuild, options) {
    this._prompt._assertMutable();
    const child = createChildNode(this._prompt, this._catalog, null, componentId, textOrBuild, options);
    this._spec.children.push(child);
    return this;
  }

  // Trusted inclusion at message level: same contract as ComponentBuilder.
  // Slot occurrences render as top-level message children while keeping
  // their semantic catalogue identity; the id comes from the resolved source.
  include(turnContext, target, slot, sourceId, options) {
    this._prompt._assertMutable();
    const resolved = this._prompt._resolvePromptSource(turnContext, target, slot, sourceId);
    const opts = normalizeOptions(options);
    const node = makeIncludeNode(resolved.componentId, opts, {
      target,
      slot,
      sourceId: resolved.sourceId
    });
    this._spec.children.push(node);
    return this;
  }

  // Verbatim reuse of a KNOWN component id at message level.
  includeComponent(componentId, options = {}) {
    this._prompt._assertMutable();
    const opts = options && typeof options === 'object' ? { ...options } : {};
    const includeTurnContext = this._prompt._turnContext || opts.includeTurnContext || null;
    delete opts.includeTurnContext;
    const resolved = this._prompt._resolveKnownComponent(includeTurnContext, componentId, opts);
    const nodeOpts = normalizeOptions({ ...opts, instanceKey: null });
    const node = makeIncludeNode(resolved.componentId, nodeOpts, {
      target: resolved.target,
      slot: resolved.slot,
      sourceId: resolved.sourceId
    });
    this._spec.children.push(node);
    return this;
  }

  // Attributed history view at message level: one precomputed
  // brief/balanced/deep view as a core-owned piece (see request_compiler).
  history(presetOrSelection, options = {}) {
    this._prompt._assertMutable();
    const scope = this._prompt._requestScope;
    if (!scope || typeof scope.addHistoryPart !== 'function') {
      throw new Error('message.history() is available only on plugin request prompts; use {history} in compilePluginRequest input.');
    }
    scope.addHistoryPart(this, presetOrSelection, options);
    return this;
  }

  prepend(componentId, textOrBuild, options) {
    this._prompt._assertMutable();
    const child = createChildNode(this._prompt, this._catalog, null, componentId, textOrBuild, options);
    this._spec.children.unshift(child);
    return this;
  }
}

function assertPrepared(value) {
  if (!(value instanceof PreparedPrompt)) {
    throw new TypeError('Expected a PreparedPrompt returned by Prompt.prepare().');
  }
}

// Manifest versions: 1 = pre-source era (no trusted inclusion `source`
// refs); 2 = typed inclusion with {target, slot, sourceId} per included
// node. Rehydrate enforces the distinction below: v1 manifests are NOT
// interpretable as v2 — callers must re-prepare, not read source refs.
const SUPPORTED_MANIFEST_VERSIONS = Object.freeze([1, 2]);

function verifySpanCoverage(messages, spans) {
  const byMessage = new Map();
  for (const span of spans) {
    if (!byMessage.has(span.messageIndex)) byMessage.set(span.messageIndex, []);
    byMessage.get(span.messageIndex).push(span);
  }
  messages.forEach((message, index) => {
    const list = (byMessage.get(index) || []).slice().sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const span of list) {
      if (span.start !== cursor) {
        throw new Error(`Prompt manifest has a span gap/overlap in message ${index} at offset ${cursor}.`);
      }
      cursor = span.end;
    }
    if (cursor !== message.content.length) {
      throw new Error(
        `Prompt manifest spans do not cover message ${index} (covered ${cursor} of ${message.content.length}).`
      );
    }
  });
}

// Structural manifest validation beyond byte coverage: unique occurrence
// ids, every span bound to a real occurrence (or the declared message-format
// span), physical parents that exist in the same message without cycles,
// and well-formed source references + catalogue metadata.
function verifyManifestStructure(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new TypeError('PreparedPrompt.rehydrate requires a manifest object.');
  }
  if (!SUPPORTED_MANIFEST_VERSIONS.includes(manifest.version)) {
    throw new Error(
      `Unsupported prompt manifest version ${manifest.version}; expected one of ${SUPPORTED_MANIFEST_VERSIONS.join(', ')}.`
    );
  }
  if (manifest.rolePolicy !== undefined && (manifest.version < 2 || manifest.rolePolicy !== 'agent')) {
    throw new Error(`Unsupported prompt manifest role policy: ${String(manifest.rolePolicy)}.`);
  }
  const occurrences = manifest.occurrences;
  const spans = manifest.spans;
  if (!Array.isArray(occurrences) || !Array.isArray(spans)) {
    throw new TypeError('Prompt manifest requires occurrences and spans arrays.');
  }
  if (manifest.version === 1 && occurrences.some(o => o && o.source !== undefined && o.source !== null)) {
    throw new Error('Prompt manifest v1 carries no source refs; re-prepare as v2 instead of reading v1 as v2 provenance.');
  }
  const byId = new Map();
  for (const occurrence of occurrences) {
    if (!occurrence || typeof occurrence.occurrenceId !== 'string' || !occurrence.occurrenceId) {
      throw new TypeError('Prompt manifest occurrence requires an occurrenceId.');
    }
    if (byId.has(occurrence.occurrenceId)) {
      throw new Error(`Duplicate manifest occurrence '${occurrence.occurrenceId}'.`);
    }
    if (typeof occurrence.componentId !== 'string' || !occurrence.componentId) {
      throw new TypeError(`Prompt manifest occurrence '${occurrence.occurrenceId}' requires a componentId.`);
    }
    if (occurrence.containerOccurrenceId !== null && occurrence.containerOccurrenceId !== undefined &&
        typeof occurrence.containerOccurrenceId !== 'string') {
      throw new TypeError(`Prompt manifest occurrence '${occurrence.occurrenceId}' has an invalid container.`);
    }
    if (occurrence.source !== undefined && occurrence.source !== null) {
      const { target, slot, sourceId } = occurrence.source;
      if (typeof target !== 'string' || !target || typeof slot !== 'string' || !slot ||
          typeof sourceId !== 'string' || !sourceId) {
        throw new TypeError(`Prompt manifest occurrence '${occurrence.occurrenceId}' has a malformed source reference.`);
      }
    }
    if (occurrence.historyView !== undefined && occurrence.historyView !== null) {
      const { preset, fullChars, renderedChars } = occurrence.historyView;
      if (typeof preset !== 'string' || !preset || !Number.isInteger(fullChars) || !Number.isInteger(renderedChars) ||
          fullChars < 0 || renderedChars < 0 || renderedChars > fullChars) {
        throw new TypeError(`Prompt manifest occurrence '${occurrence.occurrenceId}' has a malformed historyView.`);
      }
    }
    byId.set(occurrence.occurrenceId, occurrence);
  }
  for (const span of spans) {
    if (!span || (typeof span.occurrenceId !== 'string' && span.occurrenceId !== null)) {
      throw new TypeError('Prompt manifest span requires an occurrenceId or explicit null.');
    }
    // Declared message-format spans carry occurrenceId null.
    if (span.occurrenceId === null) continue;
    if (!byId.has(span.occurrenceId)) {
      throw new Error(`Prompt manifest span references unknown occurrence '${span.occurrenceId}'.`);
    }
  }
  // Physical containment: every non-null parent must exist, the parent chain
  // must terminate (no cycles), and a parent/child that both carry spans must
  // share at least one message (a physical parent can never live in a
  // different message than its child).
  const messagesByOccurrence = new Map();
  for (const span of spans) {
    if (span.occurrenceId == null) continue;
    if (!messagesByOccurrence.has(span.occurrenceId)) messagesByOccurrence.set(span.occurrenceId, new Set());
    messagesByOccurrence.get(span.occurrenceId).add(span.messageIndex);
  }
  for (const occurrence of occurrences) {
    let current = occurrence.containerOccurrenceId;
    const seen = new Set([occurrence.occurrenceId]);
    while (current !== null && current !== undefined) {
      if (seen.has(current)) {
        throw new Error(`Cycle in prompt manifest physical tree at '${current}'.`);
      }
      seen.add(current);
      const parent = byId.get(current);
      if (!parent) {
        throw new Error(`Prompt manifest occurrence '${occurrence.occurrenceId}' has an unknown physical parent '${current}'.`);
      }
      current = parent.containerOccurrenceId;
    }
    if (occurrence.containerOccurrenceId != null) {
      const childMsgs = messagesByOccurrence.get(occurrence.occurrenceId);
      const parentMsgs = messagesByOccurrence.get(occurrence.containerOccurrenceId);
      if (childMsgs && parentMsgs && ![...childMsgs].some(m => parentMsgs.has(m))) {
        throw new Error(
          `Prompt manifest occurrence '${occurrence.occurrenceId}' and its physical parent ` +
          `'${occurrence.containerOccurrenceId}' do not share a message.`
        );
      }
    }
  }
  const components = manifest.components;
  if (components !== undefined && (components === null || typeof components !== 'object' || Array.isArray(components))) {
    throw new TypeError('Prompt manifest components must be an object.');
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    if (Array.isArray(value)) {
      value.forEach(deepFreeze);
    } else {
      Object.values(value).forEach(deepFreeze);
    }
    Object.freeze(value);
  }
  return value;
}

class Prompt {
  constructor({ id, catalog = null, finalizeText = null, turnContext = null, pluginManager = null, rolePolicy = 'standard' } = {}) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('Prompt requires a non-empty string id.');
    }
    if (finalizeText != null && typeof finalizeText !== 'function') {
      throw new TypeError('Prompt finalizeText must be a function.');
    }
    if (rolePolicy !== 'standard' && rolePolicy !== 'agent') {
      throw new RangeError(`Unknown prompt role policy: ${String(rolePolicy)}.`);
    }
    // Catalogue resolution order: explicit catalog > live PluginManager
    // snapshot (core + contribution-time definitions) > core only. Prompts
    // that compose plugin content MUST resolve through a manager-backed
    // snapshot; core-only is the fallback for engine-local requests. The
    // manager may be the PluginManager singleton or an instance supplied by
    // the plugin toolkit.
    const managerSnapshot = () => {
      const candidates = [];
      if (pluginManager) candidates.push(pluginManager);
      if (turnContext && turnContext.pluginManager) candidates.push(turnContext.pluginManager);
      // The prompt toolkit owns Prompt; PluginManager gets Prompt (never the
      // reverse, even lazily). Callers needing plugin identities must pass a
      // catalogue or manager into the constructor.
      for (const candidate of candidates) {
        if (candidate && typeof candidate.getPromptCatalogueSnapshot === 'function') {
          const snapshot = candidate.getPromptCatalogueSnapshot();
          if (snapshot && typeof snapshot === 'object') return snapshot;
        }
        // A toolkit test double may hold a contribution-time registry but
        // omit PluginManager's snapshot method. Validate that registry here.
        if (candidate && candidate.promptRegistry) {
          const { CORE_COMPONENTS: CORE, buildPluginCatalogueEntries, validatePromptPieces } = require('./prompt_core_catalog.js');
          const piecesSource = candidate.promptRegistry instanceof Map
            ? [...candidate.promptRegistry.entries()]
            : Object.entries(candidate.promptRegistry);
          for (const [pluginId, pieces] of piecesSource) validatePromptPieces(pluginId, pieces);
          const entries = buildPluginCatalogueEntries(candidate.promptRegistry);
          const snapshot = Object.assign(Object.create(null), CORE);
          for (const [id, entry] of Object.entries(entries)) snapshot[id] = entry;
          return Object.freeze(snapshot);
        }
      }
      return null;
    };
    let resolved = catalog || managerSnapshot() || CORE_COMPONENTS;
    // Contribution-time definitions travel with the turn. An interlude may
    // restore a parent chapter whose producing plugin did not run this time;
    // validate the saved catalogue independently of the occurrence text.
    const savedDefinitions = turnContext?.promptDefinitions;
    if (!catalog && savedDefinitions && Object.keys(savedDefinitions).length > 0) {
      const { buildPluginCatalogueEntries, validatePromptPieces, validateCatalog } = require('./prompt_core_catalog.js');
      for (const [pluginId, pieces] of Object.entries(savedDefinitions)) validatePromptPieces(pluginId, pieces);
      const savedEntries = buildPluginCatalogueEntries(savedDefinitions);
      const merged = Object.assign(Object.create(null), resolved);
      for (const [componentId, entry] of Object.entries(savedEntries)) {
        const current = merged[componentId];
        if (current && (current.parent !== entry.parent || current.owner !== entry.owner)) {
          throw new Error(`Restored prompt definition '${componentId}' conflicts with the active catalogue.`);
        }
        merged[componentId] = entry;
      }
      validateCatalog(merged);
      resolved = Object.freeze(merged);
    }
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
      throw new TypeError('Prompt catalog must be an object.');
    }
    this._id = id;
    this._catalog = resolved;
    this._rolePolicy = rolePolicy;
    // The TurnContext this prompt composes FROM. include() nodes resolve
    // their stored occurrences through it at prepare() time (live read, no
    // build-time copies that can go stale mid-composition).
    this._turnContext = turnContext || null;
    // Runtime overlay for dynamic (plugin) component identities registered
    // during composition. Core entries are never mutated; the overlay resolves
    // beside them and is snapshotted into the manifest's components map.
    this._dynamicCatalog = Object.create(null);
    this._finalizeText = finalizeText || null;
    this._items = [];
    this._sealed = false;
  }

  get id() {
    return this._id;
  }

  _assertMutable() {
    if (this._sealed) {
      throw new Error(`Prompt "${this._id}" is sealed: prepare() was already called.`);
    }
  }

  // Trusted source resolution: include() nodes carry { target, slot,
  // sourceId } only. The LIVE stored occurrence is resolved here at render
  // time — never from a stale build-time snapshot, and never from an
  // occurrence's embedded declaration. Identity comes from validated
  // registration + the resolver, not from caller input.
  //
  // The store may be a real TurnContext (has getPromptSource) or a plain
  // test double exposing promptComponents; in the latter case resolution
  // walks the same {target, slot, sourceId} triple. Anything else throws:
  // include() without a resolvable store would emit phantom bytes.
  _resolvePromptSource(store, target, slot, sourceId) {
    let stored = null;
    if (store && typeof store.getPromptSource === 'function') {
      stored = store.getPromptSource(target, slot, sourceId);
    } else if (store && store.promptComponents && typeof store.promptComponents === 'object') {
      // Plain test double: walk the same {target, slot, sourceId} triple the
      // real TurnContext.getPromptSource() walks. Structured occurrences only.
      // No backfill: sourceId is stamped at insertion (addPromptOccurrence);
      // a missing id here is a producer bug, not something lookup repairs.
      const items = store.promptComponents?.[target]?.[slot];
      if (!Array.isArray(items)) {
        throw new Error(`Unknown prompt target/slot: ${target}.${slot}`);
      }
      const found = [];
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.sourceId === sourceId) found.push(node);
        for (const child of node.children || []) walk(child);
      };
      for (const item of items) walk(item);
      if (found.length === 0) {
        throw new Error(`Unknown prompt source '${sourceId}' in ${target}.${slot}.`);
      }
      if (found.length > 1) {
        throw new Error(`Duplicate prompt source '${sourceId}' in ${target}.${slot}.`);
      }
      stored = found[0];
    } else {
      throw new TypeError('include() requires a TurnContext with getPromptSource().');
    }
    if (!stored || typeof stored !== 'object' || typeof stored.componentId !== 'string' || !stored.componentId) {
      throw new Error(`include() resolved an invalid stored occurrence for ${target}.${slot}#${sourceId}.`);
    }
    if (typeof stored.sourceId !== 'string' || !stored.sourceId) {
      throw new Error(`include() resolved a stored occurrence without a stable sourceId (${target}.${slot}).`);
    }
    this._validateSourcePlacement(stored, target, slot);
    return stored;
  }

  _validateSourcePlacement(stored, target, slot) {
    const catalog = this._effectiveCatalog();
    const anchor = `${target}.${slot}`;
    if (!Object.hasOwn(catalog, anchor)) {
      throw new Error(`Unknown prompt slot ${anchor}.`);
    }
    const id = stored.componentId;
    const entry = Object.hasOwn(catalog, id) ? catalog[id] : null;
    if (!entry) {
      throw new Error(`Prompt component '${id}' is not registered. Declare it via contribute() before including it.`);
    }
    if (stored.owner && entry.owner !== stored.owner) {
      throw new Error(`Prompt component '${id}' claims owner '${stored.owner}' but is registered to '${entry.owner}'.`);
    }
    if (id !== anchor && !isDescendantOf(catalog, id, anchor)) {
      throw new Error(`Prompt component '${id}' is stored in ${anchor}, but its catalogue ancestry does not lead under that slot.`);
    }
  }

  // Exact known-component resolution for verbatim reuse: find the stored
  // occurrence for a fully-qualified component id on THIS turn (plus optional
  // instanceKey/sourceId disambiguation), validate it against the registered
  // catalogue, and return its live {target, slot, sourceId} reference. Never
  // guesses, never picks the first of several matches, never mints ids.
  _resolveKnownComponent(turnContext, componentId, options = {}) {
    if (typeof componentId !== 'string' || !componentId.trim()) {
      throw new TypeError('includeComponent requires a fully-qualified component id.');
    }
    const id = componentId.trim();
    if (!id.includes('.')) {
      throw new TypeError(`includeComponent requires a fully-qualified component id, got '${componentId}'.`);
    }
    const store = turnContext || this._turnContext;
    if (!store || typeof store.promptComponents !== 'object') {
      throw new TypeError('includeComponent requires a TurnContext with promptComponents.');
    }
    const allowedOptionKeys = ['instanceKey', 'sourceId', 'includeTurnContext', 'includeTarget', 'includeSlot', 'includeSourceId', 'prefix', 'separator', 'suffix', 'finalizeText'];
    for (const key of Object.keys(options || {})) {
      if (!allowedOptionKeys.includes(key)) {
        throw new TypeError(`includeComponent accepts only instanceKey/sourceId and prompt formatting, not '${key}'.`);
      }
    }
    const { instanceKey = null, sourceId = null } = options || {};
    if (instanceKey != null && (typeof instanceKey !== 'string' || !instanceKey)) {
      throw new TypeError('includeComponent instanceKey must be a non-empty string.');
    }
    if (sourceId != null && (typeof sourceId !== 'string' || !sourceId)) {
      throw new TypeError('includeComponent sourceId must be a non-empty string.');
    }
    const matches = [];
    const pillars = store.promptComponents;
    for (const [target, pillar] of Object.entries(pillars)) {
      if (!pillar || typeof pillar !== 'object') continue;
      for (const [slot, items] of Object.entries(pillar)) {
        if (!Array.isArray(items)) continue;
        const walk = (node) => {
          if (!node || typeof node !== 'object') return;
          if (node.componentId === id) {
            if ((instanceKey == null || node.instanceKey === instanceKey) &&
                (sourceId == null || node.sourceId === sourceId)) {
              matches.push({ node, target, slot });
            }
          }
          for (const child of node.children || []) walk(child);
        };
        for (const item of items) walk(item);
      }
    }
    if (matches.length === 0) {
      throw new Error(`Unknown prompt component '${id}' on this turn: no stored occurrence.`);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous prompt component '${id}': ${matches.length} stored occurrences; pass instanceKey or sourceId.`);
    }
    const { node, target, slot } = matches[0];
    if (typeof node.sourceId !== 'string' || !node.sourceId) {
      throw new Error(`Prompt component '${id}' has no stable sourceId; it was not stored via addPromptOccurrence().`);
    }
    // Resolve again through the same trusted path as low-level include():
    // identity, owner, and the actual stored slot must all agree.
    const stored = this._resolvePromptSource(store, target, slot, node.sourceId);
    return { componentId: stored.componentId, target, slot, sourceId: stored.sourceId };
  }

  _resolveIncludeSource(node, turnContext) {
    const source = node?.source;
    assertIncludeSource(source);
    const stored = this._resolvePromptSource(turnContext, source.target, source.slot, source.sourceId);
    // sourceId is an ENUMERABLE plain string on stored occurrences (persisted
    // in snapshots, survives the spread below). __includeSource carries the
    // slot reference alongside it.
    return { ...stored, __includeSource: { ...source } };
  }

  _registerDynamicComponent(componentId, entry) {
    if (typeof componentId !== 'string' || componentId.length === 0) {
      throw new TypeError('Dynamic prompt component id must be a non-empty string.');
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('Dynamic prompt component entry must be an object.');
    }
    const { parent, label, description, owner } = entry;
    if (typeof parent !== 'string' || parent.length === 0 || typeof label !== 'string' || !label.trim() ||
        typeof description !== 'string' || !description.trim() || typeof owner !== 'string' || !owner.trim()) {
      throw new TypeError('Dynamic prompt component entry requires parent, label, description and owner.');
    }
    const resolvedCatalog = this._effectiveCatalog();
    if (Object.hasOwn(resolvedCatalog, componentId)) {
      const existing = resolvedCatalog[componentId];
      if (existing.parent !== parent || existing.owner !== owner.trim()) {
        throw new Error(`Dynamic prompt component ${componentId} conflicts with an existing registration.`);
      }
      return this;
    }
    // Parents must already resolve (core entry or earlier dynamic piece):
    // a plugin can extend the chain but never reparent it.
    if (!Object.hasOwn(resolvedCatalog, parent)) {
      throw new Error(`Dynamic prompt component ${componentId} has an unregistered parent: ${parent}.`);
    }
    this._dynamicCatalog[componentId] = Object.freeze({ parent, label: label.trim(), description: description.trim(), owner: owner.trim() });
    return this;
  }

  _effectiveCatalog() {
    return Object.assign(Object.create(null), this._catalog, this._dynamicCatalog);
  }

  // Prompt-level dynamic registration: same validation as the builder hook,
  // but the registration lands on the overlay that createChildNode() resolves
  // against. Prefer this when pre-registering a chain before add() calls.
  registerDynamicComponent(componentId, entry) {
    this._assertMutable();
    return this._registerDynamicComponent(componentId, entry);
  }

  // Validation-only helper: a structured occurrence's identity (plugin piece
  // or core id) plus its descendant chain must already exist in the prompt's
  // catalogue snapshot (core definitions + PluginManager-validated plugin
  // declarations). Self-certification is forbidden: an occurrence's embedded
  // `declaration` or `owner` is never proof of registration. Unknown ids,
  // forged owner, and catalogue-inconsistent parentage all throw.
  //
  // `ancestors` is the semantic ancestor chain; its last entry is the slot
  // anchor the top occurrence must belong under (a core slot anchor like
  // root.simulation, or the anchor component itself for core slot rows).
  registerOccurrenceIdentity(occurrence, ancestors = []) {
    this._assertMutable();
    if (!occurrence || typeof occurrence !== 'object') {
      throw new TypeError('registerOccurrenceIdentity requires an occurrence object.');
    }
    const componentId = occurrence.componentId;
    if (typeof componentId !== 'string' || !componentId) {
      throw new TypeError('Prompt occurrence requires a componentId.');
    }
    const effectiveCatalog = this._effectiveCatalog();
    const entryOf = (id) => (Object.hasOwn(effectiveCatalog, id) ? effectiveCatalog[id] : null);
    const requireRegistered = (id, owner) => {
      const entry = entryOf(id);
      if (!entry) {
        const ownerHint = owner && owner !== 'core' ? ` (owner '${owner}')` : '';
        throw new Error(
          `Prompt occurrence ${id}${ownerHint} is not registered. ` +
          `Contribute it through tools.prompt.contribute({id, to, ...}) before composing the prompt.`
        );
      }
      return entry;
    };
    const checkOwner = (node, entry) => {
      if (typeof node.owner === 'string' && node.owner && entry.owner && node.owner !== entry.owner) {
        throw new Error(
          `Prompt occurrence ${node.componentId} claims owner '${node.owner}' but is registered to '${entry.owner}'.`
        );
      }
    };
    // Strict catalogue parentage for descendants: a child's declared catalogue
    // parent must be exactly the node it is nested under.
    const checkDescendants = (node) => {
      const entry = requireRegistered(node.componentId, node.owner);
      checkOwner(node, entry);
      for (const child of node.children || []) {
        const childEntry = requireRegistered(child.componentId, child.owner);
        const declaredParent = childEntry.parent ?? null;
        if (declaredParent !== node.componentId) {
          throw new Error(
            `Prompt occurrence ${child.componentId} declares catalogue parent ${declaredParent ?? 'null'} ` +
            `but is nested under ${node.componentId}.`
          );
        }
        checkDescendants(child);
      }
    };
    requireRegistered(componentId, occurrence.owner);
    checkOwner(occurrence, entryOf(componentId));
    const anchor = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
    if (anchor != null && anchor !== componentId) {
      // The top occurrence must belong under the declared slot anchor via its
      // catalogue ancestry (never a caller-asserted position).
      let cursor = componentId;
      const seen = new Set();
      let underAnchor = false;
      while (cursor != null && !seen.has(cursor)) {
        if (cursor === anchor) { underAnchor = true; break; }
        seen.add(cursor);
        const entry = entryOf(cursor);
        cursor = entry ? (entry.parent ?? null) : null;
      }
      if (!underAnchor) {
        throw new Error(
          `Prompt occurrence ${componentId} is not catalogue-ancestored under slot anchor ${anchor}.`
        );
      }
    }
    checkDescendants(occurrence);
    return this;
  }

  message(role, build, options) {
    this._assertMutable();
    if (!VALID_ROLES.has(role)) {
      throw new RangeError(`Invalid message role: ${String(role)} (expected system, user, or assistant).`);
    }
    if (typeof build !== 'function') {
      throw new TypeError('message() requires a builder function.');
    }
    if (role === 'system' && this._rolePolicy === 'standard' && this._items.length > 0) {
      throw new Error('The system message must be the first message in a prompt.');
    }
    const spec = { kind: 'message', role, children: [], separator: '' };
    const builder = new MessageBuilder(this, spec, this._catalog);
    if (options !== undefined) {
      if (options == null || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('message() options must be an object.');
      }
      if (options.separator !== undefined) builder.separator(options.separator);
    }
    build(builder);
    this._items.push(spec);
    return this;
  }

  system(build, options) {
    return this.message('system', build, options);
  }

  user(build, options) {
    return this.message('user', build, options);
  }

  assistant(build, options) {
    return this.message('assistant', build, options);
  }

  // Inserts a prepared sequence at this exact point, preserving its message
  // order, boundaries, identities, and exact rendered text.
  append(prepared) {
    this._assertMutable();
    assertPrepared(prepared);
    this._items.push({ kind: 'block', prepared });
    return this;
  }

  // Reuses an immutable, already-ordered prefix as an indivisible leading
  // block. Must be the first operation on an empty prompt; the prefix bytes
  // cannot be modified through the receiving builder.
  usePrefix(prepared) {
    this._assertMutable();
    assertPrepared(prepared);
    if (this._items.length > 0) {
      throw new Error('usePrefix() must be the first operation on an empty prompt.');
    }
    this._items.push({ kind: 'prefix', prepared });
    return this;
  }

  prepare() {
    this._assertMutable();
    if (this._items.length === 0) {
      throw new Error(`Prompt "${this._id}" has no messages.`);
    }
    // Include() nodes resolve LIVE through this prompt's TurnContext. A
    // prompt without one cannot render includes — fail here rather than
    // emitting phantom bytes or resolving against a stale copy.
    const needsTurnContext = this._items.some(item =>
      item.kind === 'message'
        ? item.children.some(child => child.kind === 'include')
        : false
    );
    if (needsTurnContext && !this._turnContext) {
      throw new Error(`Prompt "${this._id}" uses include() but has no turnContext; pass turnContext to the constructor.`);
    }
    const catalog = this._effectiveCatalog();
    const finalMessages = [];
    const occurrences = [];
    const spans = [];
    const inclusions = [];
    const messageFormats = [];
    const usedComponents = new Set();
    const seenInstanceKeys = new Map();
    let occurrenceCounter = 0;
    const nextOccurrenceId = () => `occ-${++occurrenceCounter}`;

    const claimInstanceKey = (componentId, instanceKey, occurrenceId) => {
      if (instanceKey == null) return;
      const key = `${componentId}\\u0000${instanceKey}`;
      const first = seenInstanceKeys.get(key);
      if (first !== undefined) {
        throw new Error(
          `Duplicate instanceKey '${instanceKey}' for component ${componentId} (${first} and ${occurrenceId}).`
        );
      }
      seenInstanceKeys.set(key, occurrenceId);
    };

    for (const item of this._items) {
      if (item.kind === 'message') {
        const messageIndex = finalMessages.length;
        const parts = [];
        let offset = 0;
        const pushText = (text, occurrenceId) => {
          if (!text) return;
          parts.push(text);
          const span = { occurrenceId, messageIndex, start: offset, end: offset + text.length };
          spans.push(span);
          if (occurrenceId == null && item.separator) {
            messageFormats.push({ messageIndex, separator: item.separator, span });
          }
          offset += text.length;
        };
        // Message-level join separators are message-owned formatting: they
        // have no catalogue parent, so they are recorded as spans with a null
        // occurrenceId. verifySpanCoverage counts them toward coverage but the
        // accounting rule keeps them out of every component rollup.
        const MESSAGE_FORMAT_OCCURRENCE_ID = null;
        // finalizeText transforms each owned text unit (component text,
        // prefix/suffix wraps, separators) before it is recorded, so span
        // offsets always describe the final bytes. The transform runs on
        // whole atomic units (leaf text, one wrapper string), never across
        // ownership boundaries. A per-occurrence finalizeText override marks
        // pre-finalized inputs (e.g. shared-prefix chat replay): null means
        // the identity transform for that occurrence.
        const promptFinalize = this._finalizeText;
        const renderNode = (node, containerOccurrenceId, inheritedFinalize = promptFinalize) => {
          const occurrenceId = nextOccurrenceId();
          claimInstanceKey(node.componentId, node.instanceKey, occurrenceId);
          usedComponents.add(node.componentId);
          occurrences.push({
            occurrenceId,
            componentId: node.componentId,
            instanceKey: node.instanceKey,
            containerOccurrenceId,
            origin: null,
            // Typed inclusions record their TurnContext source so the same
            // stored occurrence is recognizable across Writer/Director/VN
            // renderings. Semantic componentId/parent are NOT rewritten.
            ...(node.kind === 'include' ? { source: { ...node.source } } : {}),
            // Attributed history views record which precomputed view was
            // selected and how much of it was actually rendered. Node options
            // are the carrier (normalizeOptions keeps historyView through).
            ...((node.kind === 'component' && node.optionsHistoryView !== undefined) ? { historyView: { ...node.optionsHistoryView } } : {}),
            ...(node.historyView !== undefined ? { historyView: { ...node.historyView } } : {})
          });
          const nodeFinalize = ('finalizeText' in node && node.finalizeText !== undefined)
            ? node.finalizeText
            : inheritedFinalize;
          const pushNodeText = (text) => {
            pushText(nodeFinalize ? nodeFinalize(text) : text, occurrenceId);
          };
          if (node.kind === 'include') {
            // Trusted inclusion: the node RESOLVES to the stored TurnContext
            // occurrence (live read, never a stale build-time copy) and the
            // stored subtree renders INLINE — the include occurrence IS the
            // stored top node (one occurrence, not a layout wrapper plus a
            // duplicate). Semantic ancestry comes from the catalogue, never
            // from the layout. The `source` reference makes the same stored
            // occurrence recognizable across Writer/Director/VN renderings.
            const included = this._resolveIncludeSource(node, this._turnContext);
            pushNodeText(node.prefix);
            emitIncludedSubtree(included, containerOccurrenceId, nodeFinalize, occurrenceId);
            pushNodeText(node.suffix);
            return occurrenceId;
          }
          if (node.children == null) {
            pushNodeText(node.prefix);
            pushNodeText(node.text);
            pushNodeText(node.suffix);
          } else {
            pushNodeText(node.prefix);
            node.children.forEach((child, index) => {
              if (index > 0) pushNodeText(node.separator);
              if (child.kind === 'text') {
                pushNodeText(child.text);
              } else {
                renderNode(child, occurrenceId, nodeFinalize);
              }
            });
            pushNodeText(node.suffix);
          }
          return occurrenceId;
        };
        // Single recursive render for an included stored subtree: EXACTLY ONE
        // manifest occurrence per stored node (no synthetic duplicates). The
        // include node's own occurrenceId IS the stored top node's rendering
        // (renamed in place); each descendant renders once with its IMMEDIATE
        // rendered parent as containerOccurrenceId. Semantic
        // componentId/owner/ancestry are unchanged; physical containment is
        // containerOccurrenceId only. Source identity comes from the stored
        // sourceId (stable), never a positional slot index.
        const emitIncludedSubtree = (stored, physicalParentId, inheritedFinalize, reuseOccurrenceId) => {
          // Register the included chain on this prompt's overlay so nested
          // plugin ids resolve; parents come from the stored declaration.
          // (Before emitting: identity must exist before bytes reference it.)
          this.registerOccurrenceIdentity(stored, []);
          // Rename the include occurrence in place: it BECOMES the stored top
          // node (same occurrenceId, stored componentId/instanceKey/source).
          // No second occurrence is created for the same stored node.
          const topEntry = occurrences.find(o => o.occurrenceId === reuseOccurrenceId);
          topEntry.componentId = stored.componentId;
          topEntry.instanceKey = stored.instanceKey;
          topEntry.source = { ...stored.__includeSource, sourceId: stored.sourceId };
          topEntry.containerOccurrenceId = physicalParentId;
          usedComponents.add(stored.componentId);
          claimInstanceKey(stored.componentId, stored.instanceKey, reuseOccurrenceId);
          // Owned bytes come from the shared walkOccurrence event stream
          // (slot_renderer.js) — the same rule the flat reader uses. One
          // occurrence per stored node: the include occurrence IS the stored
          // top (renamed in place); each descendant gets exactly one fresh
          // occurrence with its IMMEDIATE rendered parent. XML escaping lives
          // in the shared formatting utility so rendering never imports
          // PluginManager at prepare() time.
          const { walkOccurrence } = require('./slot_renderer.js');
          const fin = inheritedFinalize ? inheritedFinalize : (t) => t;
          const stack = [];
          walkOccurrence({ ...stored, instanceKey: null }, {
            enter: (entered) => {
              const isTop = stack.length === 0;
              const nodeId = isTop ? reuseOccurrenceId : nextOccurrenceId();
              const parentId = isTop ? physicalParentId : stack[stack.length - 1];
              claimInstanceKey(entered.componentId, isTop ? null : entered.instanceKey, nodeId);
              usedComponents.add(entered.componentId);
              if (!isTop) {
                occurrences.push({
                  occurrenceId: nodeId,
                  componentId: entered.componentId,
                  instanceKey: entered.instanceKey,
                  containerOccurrenceId: parentId,
                  origin: null,
                  source: { ...stored.__includeSource, sourceId: entered.sourceId }
                });
              }
              stack.push(nodeId);
            },
            ownText: (owner, text) => {
              pushText(fin(text), stack[stack.length - 1]);
            },
            leave: () => { stack.pop(); }
          });
        };
        // Message-owned join separators are also finalizable text: the legacy
        // path replaces placeholders inside fully joined strings, so the
        // transform must apply here or parity breaks. Separators have no
        // component owner (MESSAGE_FORMAT_OCCURRENCE_ID), recorded so coverage
        // stays gapless while rollups exclude them.
        const pushMessageSeparator = (text) => {
          pushText(promptFinalize ? promptFinalize(text) : text, MESSAGE_FORMAT_OCCURRENCE_ID);
        };
        item.children.forEach((child, index) => {
          if (index > 0) pushMessageSeparator(item.separator || '');
          renderNode(child, null);
        });
        const content = parts.join('');
        if (content.length === 0) {
          throw new Error(
            `Prompt "${this._id}" rendered an empty ${item.role} message (index ${messageIndex}); omit it instead.`
          );
        }
        finalMessages.push({ role: item.role, content });
      } else {
        // prefix or block inclusion: remap occurrence ids and message indices,
        // keep rendered bytes identical. Inclusions were finalized when their
        // own prompt prepared, so no transform runs here — including the
        // receiving prompt's own finalizeText. The transform boundary is the
        // prompt that rendered the bytes: prefix bytes stay exactly as their
        // composer finalized them, suffix bytes finalize in this prompt.
        const source = item.prepared;
        const messageStart = finalMessages.length;
        const idMap = new Map();
        for (const occurrence of source.manifest.occurrences) {
          const newId = nextOccurrenceId();
          idMap.set(occurrence.occurrenceId, newId);
          claimInstanceKey(occurrence.componentId, occurrence.instanceKey, newId);
          usedComponents.add(occurrence.componentId);
        }
        for (const occurrence of source.manifest.occurrences) {
          occurrences.push({
            occurrenceId: idMap.get(occurrence.occurrenceId),
            componentId: occurrence.componentId,
            instanceKey: occurrence.instanceKey,
            containerOccurrenceId:
              occurrence.containerOccurrenceId == null ? null : idMap.get(occurrence.containerOccurrenceId),
            origin: {
              sourcePromptId: source.id,
              sourceHash: source.hash,
              sourceOccurrenceId: occurrence.occurrenceId
            },
            // Preserve typed-inclusion sources across prefix/block reuse so
            // the same stored TurnContext occurrence stays recognizable
            // through usePrefix()/append().
            ...(occurrence.source ? { source: { ...occurrence.source } } : {}),
            // Preserve attributed-history metadata through prefix/block reuse.
            ...(occurrence.historyView ? { historyView: { ...occurrence.historyView } } : {})
          });
        }
        for (const span of source.manifest.spans) {
          spans.push({
            // Separator spans carry occurrenceId null (message-owned
            // formatting); idMap.get(null) would yield undefined and fail
            // verification, so preserve null explicitly.
            occurrenceId: span.occurrenceId == null ? null : idMap.get(span.occurrenceId),
            messageIndex: messageStart + span.messageIndex,
            start: span.start,
            end: span.end
          });
        }
        for (const message of source.messages) {
          finalMessages.push({ role: message.role, content: message.content });
        }
        inclusions.push({
          kind: item.kind,
          sourcePromptId: source.id,
          sourceHash: source.hash,
          messageStart,
          messageEnd: finalMessages.length - 1
        });
      }
    }

    const systemIndices = [];
    finalMessages.forEach((message, index) => {
      if (message.role === 'system') systemIndices.push(index);
    });
    if (this._rolePolicy === 'standard' && systemIndices.length > 1) {
      throw new Error(`Prompt "${this._id}" has ${systemIndices.length} system messages; at most one is allowed.`);
    }
    if (this._rolePolicy === 'standard' && systemIndices.length === 1 && systemIndices[0] !== 0) {
      throw new Error(`Prompt "${this._id}" has its system message at index ${systemIndices[0]}; it must be first.`);
    }

    verifySpanCoverage(finalMessages, spans);

    // Component metadata for every used component plus its catalogue
    // ancestors, snapshotted here so historical logs survive later catalogue
    // changes. Falls back to source manifests when the current catalogue no
    // longer defines an id.
    const sourceMetadata = new Map();
    for (const item of this._items) {
      if (item.kind === 'message') continue;
      const snapshot = item.prepared.manifest.components || {};
      for (const [componentId, metadata] of Object.entries(snapshot)) {
        if (!sourceMetadata.has(componentId)) sourceMetadata.set(componentId, metadata);
      }
    }
    const components = {};
    const collectWithAncestors = componentId => {
      if (components[componentId]) return;
      const entry = Object.hasOwn(catalog, componentId) ? catalog[componentId] : null;
      const fallback = !entry ? sourceMetadata.get(componentId) : null;
      const parent = entry ? entry.parent ?? null : fallback ? fallback.parent ?? null : null;
      components[componentId] = {
        id: componentId,
        parent,
        label: entry ? entry.label ?? componentId : fallback ? fallback.label ?? componentId : componentId,
        description: entry ? entry.description ?? null : fallback ? fallback.description ?? null : null,
        owner: entry ? entry.owner ?? null : fallback ? fallback.owner ?? null : null
      };
      if (parent != null) collectWithAncestors(parent);
    };
    for (const componentId of usedComponents) {
      collectWithAncestors(componentId);
    }

    const manifest = {
      version: PROMPT_MANIFEST_VERSION,
      promptId: this._id,
      ...(this._rolePolicy === 'agent' ? { rolePolicy: 'agent' } : {}),
      components,
      occurrences,
      spans,
      inclusions,
      messageFormats
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(finalMessages)).digest('hex').slice(0, PROMPT_HASH_LENGTH);
    const characterCount = finalMessages.reduce((sum, message) => sum + message.content.length, 0);

    this._sealed = true;
    return new PreparedPrompt({ id: this._id, messages: finalMessages, manifest, hash, characterCount });
  }
}

class PreparedPrompt {
  constructor({ id, messages, manifest, hash, characterCount }) {
    this.id = id;
    this.messages = deepFreeze(messages);
    this.manifest = deepFreeze(manifest);
    this.hash = hash;
    this.characterCount = characterCount;
    Object.freeze(this);
  }

  // Rehydrates a prepared result from plain JSON (seeds, turn snapshots,
  // cross-module handoffs) without re-running composition. Recomputes the
  // hash/characterCount from the messages and rejects mismatches so a stale
  // or tampered copy can never claim provenance it did not observe.
  static rehydrate({ id, messages, manifest }) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('PreparedPrompt.rehydrate requires a non-empty string id.');
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new TypeError('PreparedPrompt.rehydrate requires a non-empty messages array.');
    }
    for (const message of messages) {
      if (!message || (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') {
        throw new TypeError('PreparedPrompt.rehydrate requires {role, content} messages.');
      }
    }
    if (!manifest || typeof manifest !== 'object' || manifest.promptId !== id || !Array.isArray(manifest.spans)) {
      throw new TypeError('PreparedPrompt.rehydrate requires a manifest for the same prompt id.');
    }
    if (manifest.rolePolicy !== 'agent') {
      const systemIndices = messages.flatMap((message, index) => message.role === 'system' ? [index] : []);
      if (systemIndices.length > 1 || (systemIndices.length === 1 && systemIndices[0] !== 0)) {
        throw new Error('Standard prepared prompts allow at most one initial system message.');
      }
    }
    // NOTE: the hash covers MESSAGES ONLY (prefix-cache observation). A
    // tampered manifest with intact messages passes the hash but must still
    // fail verifyManifestStructure below — provenance tampering is a
    // structure error, not a byte error. Callers needing manifest integrity
    // must add a separate manifest digest; do not fold it into this hash.
    const hash = crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex').slice(0, PROMPT_HASH_LENGTH);
    const characterCount = messages.reduce((sum, message) => sum + message.content.length, 0);
    verifySpanCoverage(messages, manifest.spans);
    verifyManifestStructure(manifest);
    return new PreparedPrompt({ id, messages, manifest, hash, characterCount });
  }
}

module.exports = {
  Prompt,
  PreparedPrompt,
  PROMPT_MANIFEST_VERSION,
  SUPPORTED_MANIFEST_VERSIONS
};

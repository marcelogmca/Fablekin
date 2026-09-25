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

const PROMPT_MANIFEST_VERSION = 1;
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
  const { instanceKey = null, prefix = '', separator = '', suffix = '', finalizeText = undefined } = options;
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
  // Undefined = inherit the prompt finalize; explicit null = pre-finalized.
  // The node must distinguish the two, so keep undefined as-is.
  return { instanceKey, prefix, separator, suffix, finalizeText };
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
    text: null,
    children: []
  };
}

function makeTextNode(text) {
  return { kind: 'text', text };
}

// Builds a child node but does not attach it, so a throwing builder callback
// discards the partial node instead of leaving it in the tree.
function createChildNode(prompt, catalog, containerIdOrNull, componentId, textOrBuild, options) {
  const opts = normalizeOptions(options);
  resolveComponent(catalog, componentId);
  if (containerIdOrNull != null && !isDescendantOf(catalog, componentId, containerIdOrNull)) {
    throw new Error(`Cannot nest ${componentId} inside ${containerIdOrNull}: not a catalogue descendant.`);
  }
  if (typeof textOrBuild === 'string') {
    return makeLeafNode(componentId, opts, textOrBuild);
  }
  if (typeof textOrBuild === 'function') {
    const node = makeContainerNode(componentId, opts);
    const builder = new ComponentBuilder(prompt, node, catalog);
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
  constructor({ id, catalog = CORE_COMPONENTS, finalizeText = null } = {}) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('Prompt requires a non-empty string id.');
    }
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
      throw new TypeError('Prompt catalog must be an object.');
    }
    if (finalizeText != null && typeof finalizeText !== 'function') {
      throw new TypeError('Prompt finalizeText must be a function.');
    }
    this._id = id;
    this._catalog = catalog;
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

  message(role, build, options) {
    this._assertMutable();
    if (!VALID_ROLES.has(role)) {
      throw new RangeError(`Invalid message role: ${String(role)} (expected system, user, or assistant).`);
    }
    if (typeof build !== 'function') {
      throw new TypeError('message() requires a builder function.');
    }
    if (role === 'system' && this._items.length > 0) {
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
    const catalog = this._catalog;
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
            origin: null
          });
          const nodeFinalize = ('finalizeText' in node && node.finalizeText !== undefined)
            ? node.finalizeText
            : inheritedFinalize;
          const pushNodeText = (text) => {
            pushText(nodeFinalize ? nodeFinalize(text) : text, occurrenceId);
          };
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
        // own prompt prepared, so no transform runs here.
        const source = item.prepared;
        if (this._finalizeText) {
          throw new Error(
            `Prompt "${this._id}" uses finalizeText with ${item.kind} inclusion from "${source.id}"; ` +
            'mixing finalizable composition with pre-rendered inclusions is not supported.'
          );
        }
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
            }
          });
        }
        for (const span of source.manifest.spans) {
          spans.push({
            occurrenceId: idMap.get(span.occurrenceId),
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
    if (systemIndices.length > 1) {
      throw new Error(`Prompt "${this._id}" has ${systemIndices.length} system messages; at most one is allowed.`);
    }
    if (systemIndices.length === 1 && systemIndices[0] !== 0) {
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
}

module.exports = {
  Prompt,
  PreparedPrompt,
  PROMPT_MANIFEST_VERSION
};

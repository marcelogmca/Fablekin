/**
 * Shared slot renderer: the ONE rule that turns ordered typed TurnContext
 * occurrences into owned text + attributed spans.
 *
 * fragmentizeOccurrence() is the single source of render ORDER: it returns the
 * ordered fragment sequence for one node — its OWN bytes (framing, own text,
 * sibling separators) interleaved with child markers at their exact positions.
 *
 * Both projections consume that same sequence:
 *   - flat readers concatenate own fragments and recurse into child markers;
 *   - the attributed projection emits one manifest occurrence per stored node
 *     and nests child markers as physical children.
 *
 * Semantic parentage is never rewritten here: an occurrence renders with its
 * registered catalogue id/owner/ancestry. The caller decides the physical
 * layout (nested under a slot anchor, or included inside another message).
 */

function isNode(value) {
  return !!value && typeof value === 'object';
}

function flattenOccurrences(items) {
  return Array.isArray(items) ? items.filter(isNode) : [];
}

function childrenOf(node) {
  return Array.isArray(node?.children) ? node.children.filter(isNode) : [];
}

function occurrenceSlotAnchor(occurrence, fallbackAnchor) {
  if (occurrence && typeof occurrence.slotAnchor === 'string' && occurrence.slotAnchor) return occurrence.slotAnchor;
  return fallbackAnchor;
}

function directableFraming(occurrence) {
  if (occurrence?.directable === true && occurrence?.directablePluginId) {
    const { escapeXmlAttribute } = require('./xml_format.js');
    return {
      prefix: `<plugin_context directable_plugin="${escapeXmlAttribute(occurrence.directablePluginId)}">\n`,
      suffix: '\n</plugin_context>'
    };
  }
  return { prefix: '', suffix: '' };
}

// Ordered fragment sequence for ONE node. Fragment kinds:
//   { kind: 'own', text, framing?: 'prefix'|'suffix' } — bytes this node owns
//   { kind: 'child', node }                            — recurse here
//
// Own-text rule: a node emits its non-blank own text, then '\n\n' before each
// child that follows own text OR a prior child, then the framing suffix. A
// childless node with blank own text emits only its framing (if any).
function fragmentizeOccurrence(occurrence) {
  const framing = directableFraming(occurrence);
  const fragments = [];
  if (framing.prefix) fragments.push({ kind: 'own', text: framing.prefix, framing: 'prefix' });
  const hasOwnText = typeof occurrence?.text === 'string' && occurrence.text.trim().length > 0;
  if (hasOwnText) fragments.push({ kind: 'own', text: occurrence.text });
  const children = childrenOf(occurrence);
  children.forEach((child, index) => {
    if (index > 0 || hasOwnText) fragments.push({ kind: 'own', text: '\n\n' });
    fragments.push({ kind: 'child', node: child });
  });
  if (framing.suffix) fragments.push({ kind: 'own', text: framing.suffix, framing: 'suffix' });
  return fragments;
}

// Flat projection for one occurrence: concatenate own fragments, recursing
// into child markers inline. ONE traversal rule (fragmentizeOccurrence).
function renderOccurrenceText(occurrence) {
  const parts = [];
  for (const fragment of fragmentizeOccurrence(occurrence)) {
    if (fragment.kind === 'own') parts.push(fragment.text);
    else parts.push(renderOccurrenceText(fragment.node));
  }
  return parts.join('');
}

// Flat projection for a whole slot: occurrence texts joined with '\n\n',
// skipping empties — identical to the legacy joined-slot path.
function renderSlotText(items) {
  return flattenOccurrences(items)
    .map(renderOccurrenceText)
    .filter(text => text && text.trim())
    .join('\n\n');
}

// Single attributed traversal: emits a depth-first event stream over ONE
// occurrence subtree, aligned with fragmentizeOccurrence order.
//
//   enter(node)          — node starts
//   ownText(node, text)  — bytes OWNED by node (framing, own text, separators)
//   leave(node)          — node ends
//
// Consumers project the same stream: the flat reader concatenates ownText and
// recurses (renderOccurrenceText above); Prompt.include() opens one occurrence
// on enter, attributes ownText to the open occurrence, and recurses with the
// immediate physical parent. No consumer reimplements ordering.
function walkOccurrence(node, visitor) {
  visitor.enter(node);
  for (const fragment of fragmentizeOccurrence(node)) {
    if (fragment.kind === 'own') visitor.ownText(node, fragment.text);
    else walkOccurrence(fragment.node, visitor);
  }
  visitor.leave(node);
}

// Attributed projection: emit ONE stored occurrence subtree into a composer
// container via { emitLeaf, emitContainer, text }. Delegates ORDER to
// fragmentizeOccurrence, exactly like the flat reader. Each child is emitted
// EXACTLY ONCE as a nested occurrence; framing travels in opts as the node's
// own prefix/suffix so it stays node-owned. The container owns only its own
// text and the '\n\n' separators between its children.
function emitOccurrence(emitter, occurrence, pieceFinalize) {
  const opts = {};
  if (pieceFinalize !== undefined) opts.finalizeText = pieceFinalize;
  const fragments = fragmentizeOccurrence(occurrence);
  const framing = directableFraming(occurrence);
  if (framing.prefix) opts.prefix = framing.prefix;
  if (framing.suffix) opts.suffix = framing.suffix;
  const hasChild = fragments.some(fragment => fragment.kind === 'child');
  if (!hasChild) {
    emitter.emitLeaf(occurrence.componentId, occurrence?.text || '', opts);
    return;
  }
  emitter.emitContainer(occurrence.componentId, opts, (nested) => {
    for (const fragment of fragments) {
      if (fragment.kind === 'child') {
        emitOccurrence(nested, fragment.node, undefined);
      } else if (fragment.framing === undefined) {
        // Non-framing own bytes (own text, sibling separators). Framing moves
        // through opts as node prefix/suffix and is emitted by the composer.
        nested.text(fragment.text);
      }
    }
  });
}

// Attributed projection for a whole slot: each occurrence emitted in order
// with '\n\n' owned separators between them (owned by the CALLER's separator
// callback — the slot anchor or section passes its own text()).
function emitSlot(emitter, items, pieceFinalize) {
  flattenOccurrences(items).forEach((occurrence, index) => {
    if (index > 0) emitter.separator('\n\n');
    emitOccurrence(emitter, occurrence, pieceFinalize);
  });
}

module.exports = {
  flattenOccurrences,
  occurrenceSlotAnchor,
  directableFraming,
  fragmentizeOccurrence,
  walkOccurrence,
  renderOccurrenceText,
  renderSlotText,
  emitOccurrence,
  emitSlot
};

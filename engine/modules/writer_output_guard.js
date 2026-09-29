// A particularly destructive model failure is an unbroken inventory of
// unrelated comma-separated words. It cannot be repaired by the dialogue
// formatter; sending it downstream only burns multiple expensive retries.
function hasRunawayWordList(content) {
  if (typeof content !== 'string') return false;
  return /(?:\b[\p{L}\p{N}_-]{2,}\b,\s*){40,}/u.test(content);
}

// The Writer's EXECUTION PROTOCOL asks reasoning models to draft inside
// <thinking> tags. Those blocks are working notes for the model, not narration,
// so both the tags and everything between them are removed before the text is
// transformed into a scene. Whitespace left behind by a removed block is
// collapsed so a leading or trailing block does not leave blank lines.
// The block is consumed together with the newline it sits on, so removing one
// does not leave the blank line behind.
const THINKING_BLOCK_PATTERN = /<thinking\b[^>]*>[\s\S]*?<\/thinking\s*>[ \t]*\n?/gi;

function stripThinkingBlocks(content) {
  if (typeof content !== 'string' || !content.includes('<')) return content;
  const withoutBlocks = content.replace(THINKING_BLOCK_PATTERN, '');
  if (withoutBlocks === content) return content;
  return withoutBlocks.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { hasRunawayWordList, stripThinkingBlocks };

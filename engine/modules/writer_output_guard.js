// A particularly destructive model failure is an unbroken inventory of
// unrelated comma-separated words. It cannot be repaired by the dialogue
// formatter; sending it downstream only burns multiple expensive retries.
function hasRunawayWordList(content) {
  if (typeof content !== 'string') return false;
  return /(?:\b[\p{L}\p{N}_-]{2,}\b,\s*){40,}/u.test(content);
}

module.exports = { hasRunawayWordList };

function getLineText(line) {
  return String(line?.text ?? line?.line ?? '').trim();
}

function isDialogueLine(line) {
  return line?.type === 'dialogue';
}

function formatIndexedSceneLine(line, index) {
  const text = getLineText(line);
  if (!text) return '';
  if (isDialogueLine(line)) {
    return `${index}. ${line?.character || 'Unknown'}: ${text}`;
  }
  return `${index}. ${text}`;
}

function formatIndexedScene(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map(formatIndexedSceneLine)
    .filter(Boolean)
    .join('\n');
}

function resolveDialogueContextRange(lines, targetLineIndexes) {
  if (!(targetLineIndexes instanceof Set) || targetLineIndexes.size === 0) {
    return { start: 0, end: lines.length - 1 };
  }

  const targets = [...targetLineIndexes]
    .filter(index => Number.isInteger(index) && index >= 0 && index < lines.length)
    .sort((a, b) => a - b);
  if (targets.length === 0) return { start: 0, end: lines.length - 1 };

  let start = targets[0];
  while (start > 0 && !isDialogueLine(lines[start - 1])) start -= 1;
  return { start, end: targets[targets.length - 1] };
}

function formatIndexedDialogueWithNarrative(lines = [], options = {}) {
  const source = Array.isArray(lines) ? lines : [];
  const targetLineIndexes = options.targetLineIndexes instanceof Set
    ? options.targetLineIndexes
    : new Set(Array.isArray(options.targetLineIndexes) ? options.targetLineIndexes : []);
  const range = resolveDialogueContextRange(source, targetLineIndexes);
  const output = [];

  for (let index = range.start; index <= range.end; index += 1) {
    const line = source[index];
    const text = getLineText(line);
    if (!text) continue;
    if (isDialogueLine(line)) {
      if (targetLineIndexes.size === 0 || targetLineIndexes.has(index)) {
        output.push(`${index}. ${line?.character || 'Unknown'}: ${text}`);
      }
    } else {
      output.push(text);
    }
  }

  return output.join('\n');
}

function getProcessedSceneLines(turnContext) {
  return Array.isArray(turnContext?.processed?.vnManager?.processedLines)
    ? turnContext.processed.vnManager.processedLines
    : [];
}

module.exports = {
  formatIndexedDialogueWithNarrative,
  formatIndexedScene,
  formatIndexedSceneLine,
  getProcessedSceneLines,
  isDialogueLine
};

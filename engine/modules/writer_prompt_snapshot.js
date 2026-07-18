const { Logger, compressString, decompressToString } = require('./utils.js');

const WRITER_PROMPT_SNAPSHOT_SCHEMA_VERSION = 2;
const PROMPT_PILLARS = ['root', 'writer'];
const PROMPT_SLOTS = ['protocol', 'canon', 'dynamic_knowledge', 'simulation', 'history', 'directives'];

function cloneArrayOfStrings(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function clonePromptComponentsSubset(promptComponents) {
  const snapshot = {};
  for (const pillar of PROMPT_PILLARS) {
    snapshot[pillar] = {};
    for (const slot of PROMPT_SLOTS) {
      snapshot[pillar][slot] = cloneArrayOfStrings(promptComponents?.[pillar]?.[slot]);
    }
  }
  return snapshot;
}

function buildWriterPromptSnapshotPayload(turnContext, context = {}) {
  const {
    part1Canon = '',
    part2DynamicKnowledge = '',
    part3History = '',
    part4Simulation = '',
    part5ExecutionProtocol = '',
    finalUserPrompt = '',
    finalUserMessage = '',
    sharedPrefixHash = '',
    sharedMessageCount = 0,
    writerSuffix = ''
  } = context || {};

  return {
    schemaVersion: WRITER_PROMPT_SNAPSHOT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source: {
      projectName: turnContext?.projectName || null,
      sceneMode: turnContext?.sceneMode || 'mainline',
      turnNumber: Number.isInteger(turnContext?.turnNumber) ? turnContext.turnNumber : null,
      creationTurnNumber: Number.isInteger(turnContext?.creationTurnNumber) ? turnContext.creationTurnNumber : null,
      dbId: Number.isInteger(turnContext?.dbId) ? turnContext.dbId : null
    },
    sharedPrefix: {
      hash: String(sharedPrefixHash || ''),
      messageCount: Number(sharedMessageCount || 0)
    },
    parts: {
      part1Canon: String(part1Canon || ''),
      part2DynamicKnowledge: String(part2DynamicKnowledge || ''),
      part3History: String(part3History || ''),
      part4Simulation: String(part4Simulation || ''),
      part5ExecutionProtocol: String(part5ExecutionProtocol || '')
    },
    user: {
      finalUserPrompt: String(finalUserPrompt || ''),
      finalUserMessage: String(finalUserMessage || ''),
      writerSuffix: String(writerSuffix || finalUserMessage || '')
    },
    promptComponents: clonePromptComponentsSubset(turnContext?.promptComponents || {})
  };
}

function isWriterPromptSnapshotCompatible(payload) {
  return Number(payload?.schemaVersion) === WRITER_PROMPT_SNAPSHOT_SCHEMA_VERSION;
}

async function serializeWriterPromptSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  try {
    const json = JSON.stringify(payload);
    return await compressString(json);
  } catch (error) {
    Logger.error('WriterPromptSnapshot', 'Serialize', `Failed to serialize writer prompt snapshot: ${error.message}`, error);
    return null;
  }
}

async function deserializeWriterPromptSnapshot(blob) {
  if (!blob) return null;
  try {
    const json = await decompressToString(blob);
    const payload = JSON.parse(json);
    if (!isWriterPromptSnapshotCompatible(payload)) {
      return {
        incompatible: true,
        payload
      };
    }
    return {
      incompatible: false,
      payload
    };
  } catch (error) {
    Logger.error('WriterPromptSnapshot', 'Deserialize', `Failed to deserialize writer prompt snapshot: ${error.message}`, error);
    return null;
  }
}

function mergePromptComponentsFromSnapshot(targetPromptComponents, snapshotPromptComponents, options = {}) {
  if (!targetPromptComponents || !snapshotPromptComponents) return 0;
  const allowedSlots = Array.isArray(options?.slots) && options.slots.length > 0
    ? options.slots
    : PROMPT_SLOTS;

  let mergedSlots = 0;
  for (const pillar of PROMPT_PILLARS) {
    if (!targetPromptComponents[pillar] || typeof targetPromptComponents[pillar] !== 'object') {
      targetPromptComponents[pillar] = {};
    }

    for (const slot of allowedSlots) {
      const savedItems = cloneArrayOfStrings(snapshotPromptComponents?.[pillar]?.[slot]);
      const currentItems = cloneArrayOfStrings(targetPromptComponents?.[pillar]?.[slot]);
      if (savedItems.length === 0 && currentItems.length === 0) continue;

      const seen = new Set();
      const merged = [];

      for (const item of [...savedItems, ...currentItems]) {
        if (seen.has(item)) continue;
        seen.add(item);
        merged.push(item);
      }

      targetPromptComponents[pillar][slot] = merged;
      mergedSlots += 1;
    }
  }

  return mergedSlots;
}

module.exports = {
  WRITER_PROMPT_SNAPSHOT_SCHEMA_VERSION,
  buildWriterPromptSnapshotPayload,
  serializeWriterPromptSnapshot,
  deserializeWriterPromptSnapshot,
  isWriterPromptSnapshotCompatible,
  mergePromptComponentsFromSnapshot
};

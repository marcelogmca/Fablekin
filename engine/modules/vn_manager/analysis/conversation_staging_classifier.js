const { Logger, TurnLogger, settings, readFileSync } = require('../../utils.js');
const { callLLM, resolveModelAlias } = require('../../llm.js');
const { buildCoreVnLlmMessages } = require('../shared_llm_context.js');

const TIMING_OFFSETS_MS = Object.freeze({
  interrupt: -250,
  overlap: -75,
  snap: 0,
  normal: 200,
  hesitate: 650,
  pause: 1600
});

const CONFIG = {
  ENABLED: settings.narrative_agents?.conversation_staging_classifier?.enabled !== false,
  MODEL: settings.narrative_agents?.conversation_staging_classifier?.model || 'lowendmodel',
  PROMPT_PATH: 'engine/prompts/conversation_staging_classifier.txt',
  RETRIES: settings.narrative_agents?.conversation_staging_classifier?.retries || 3,
  TIMEOUT: settings.narrative_agents?.conversation_staging_classifier?.timeout || 120000
};

function normalizeCharacterName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getSceneLines(turnContext) {
  const lines = turnContext?.processed?.vnManager?.processedLines;
  return Array.isArray(lines) ? lines : [];
}

function getNpcDialogueEntries(turnContext) {
  const playerName = normalizeCharacterName(turnContext?.input?.playerCharacterName || 'Player');
  return getSceneLines(turnContext)
    .map((line, sceneLineIndex) => ({ line, sceneLineIndex }))
    .filter(({ line }) => line?.type === 'dialogue'
      && normalizeCharacterName(line.character)
      && normalizeCharacterName(line.character) !== playerName);
}

function buildPresentCharacters(turnContext, npcDialogueEntries = getNpcDialogueEntries(turnContext)) {
  const characters = [];
  const seen = new Set();
  const add = (value) => {
    const normalized = normalizeCharacterName(value);
    if (!normalized || normalized === 'narrator' || normalized === 'system' || seen.has(normalized)) return;
    seen.add(normalized);
    characters.push(normalized);
  };

  npcDialogueEntries.forEach(({ line }) => add(line.character));
  add(turnContext?.input?.playerCharacterName || 'Player');
  (Array.isArray(turnContext?.output?.party) ? turnContext.output.party : []).forEach(add);
  return characters;
}

function buildConversationStagingPrompt(template, options = {}) {
  const presentCharacters = Array.isArray(options.presentCharacters) ? options.presentCharacters : [];
  return String(template || '')
    .replace('{PRESENT_CHARACTERS}', presentCharacters.join('\n'))
    .replace('{PLAYER_CHARACTER}', normalizeCharacterName(options.playerName || 'Player'))
    .replace(/\{EXPECTED_OUTPUT_ROWS\}/g, String(options.expectedRowCount || 0))
    .replace('{SCENE}', 'Use the CURRENT INDEXED SCENE message above.')
    .replace('${project_directives}', options.projectDirectives || '');
}

function parseClassificationResponse(responseContent, npcDialogueEntries, presentCharacters) {
  const expectedEntries = Array.isArray(npcDialogueEntries) ? npcDialogueEntries : [];
  const validTargets = new Set(Array.isArray(presentCharacters) ? presentCharacters.map(normalizeCharacterName) : []);
  const trimmedResponse = String(responseContent || '').trim();
  const rows = trimmedResponse ? trimmedResponse.split(/\r?\n/) : [];
  const classifications = [];

  for (let index = 0; index < expectedEntries.length && index < rows.length; index += 1) {
    const entry = expectedEntries[index];
    const fields = rows[index].split(',');
    const timingClass = normalizeCharacterName(fields[0]);
    const target = fields.length === 2 ? normalizeCharacterName(fields[1]) : '';
    const speaker = normalizeCharacterName(entry?.line?.character);
    const classification = { sceneLineIndex: entry.sceneLineIndex };

    if (Object.prototype.hasOwnProperty.call(TIMING_OFFSETS_MS, timingClass)) {
      classification.fto = {
        class: timingClass,
        offsetMs: TIMING_OFFSETS_MS[timingClass]
      };
    }

    if (target === 'group' || (validTargets.has(target) && target !== speaker)) {
      classification.speakerTarget = target;
    }

    if (classification.fto || classification.speakerTarget) {
      classifications.push(classification);
    }
  }

  return {
    classifications,
    expectedRowCount: expectedEntries.length,
    receivedRowCount: rows.length
  };
}

function applyConversationStaging(lines, classifications) {
  const targetLines = Array.isArray(lines) ? lines : [];
  if (!Array.isArray(classifications)) return targetLines;

  for (const classification of classifications) {
    const sceneLineIndex = Number(classification?.sceneLineIndex);
    if (!Number.isInteger(sceneLineIndex) || sceneLineIndex < 0 || sceneLineIndex >= targetLines.length) continue;
    const line = targetLines[sceneLineIndex];
    if (!line || line.type !== 'dialogue') continue;

    if (classification.fto
      && Object.prototype.hasOwnProperty.call(TIMING_OFFSETS_MS, classification.fto.class)) {
      line.fto = {
        class: classification.fto.class,
        offsetMs: TIMING_OFFSETS_MS[classification.fto.class]
      };
    }
    if (classification.speakerTarget) {
      line.speakerTarget = classification.speakerTarget;
    }
  }

  return targetLines;
}

async function classifyConversationStaging(turnContext) {
  if (!CONFIG.ENABLED || turnContext?.conversationStagingClassifierEnabled === false) {
    Logger.log('ConversationStagingClassifier', 'Execution', 'Conversation staging classifier is disabled. Skipping.');
    return [];
  }

  const npcDialogueEntries = getNpcDialogueEntries(turnContext);
  if (npcDialogueEntries.length === 0) return [];

  try {
    const presentCharacters = buildPresentCharacters(turnContext, npcDialogueEntries);
    const playerName = normalizeCharacterName(turnContext?.input?.playerCharacterName || 'Player');
    let prompt = readFileSync(CONFIG.PROMPT_PATH);
    if (!prompt) throw new Error(`Failed to load conversation staging prompt from ${CONFIG.PROMPT_PATH}`);

    const projectDirectives = turnContext.getFormattedDirective('conversation_staging_classifier', {
      header: '=== PROJECT DIRECTIVES ==='
    });
    prompt = buildConversationStagingPrompt(prompt, {
      presentCharacters,
      playerName,
      expectedRowCount: npcDialogueEntries.length,
      projectDirectives
    });

    const messages = buildCoreVnLlmMessages(turnContext, prompt, { scene: 'indexedScene' });
    Logger.log(
      'ConversationStagingClassifier',
      'Request',
      `Classifying ${npcDialogueEntries.length} NPC dialogue lines...`,
      'start'
    );
    TurnLogger.logRequest('Conversation Staging Classifier', messages, CONFIG.MODEL, resolveModelAlias(CONFIG.MODEL).provider);

    const { content: responseContent, model: actualModel } = await callLLM({
      model: CONFIG.MODEL,
      messages,
      callingModule: 'ConversationStagingClassifier',
      retries: CONFIG.RETRIES,
      timeout: CONFIG.TIMEOUT,
      turnLogTitle: 'Conversation Staging Classifier'
    });

    TurnLogger.logResponse(
      'Conversation Staging Classifier',
      responseContent,
      actualModel,
      resolveModelAlias(CONFIG.MODEL).provider
    );

    const parsed = parseClassificationResponse(responseContent, npcDialogueEntries, presentCharacters);
    if (parsed.receivedRowCount !== parsed.expectedRowCount) {
      Logger.warn(
        'ConversationStagingClassifier',
        'Parsing',
        `Expected ${parsed.expectedRowCount} rows but received ${parsed.receivedRowCount}; salvaging positional fields.`
      );
    }
    Logger.log(
      'ConversationStagingClassifier',
      'Parsing',
      `Parsed usable staging metadata for ${parsed.classifications.length}/${parsed.expectedRowCount} lines.`,
      'end'
    );
    return parsed.classifications;
  } catch (error) {
    Logger.error('ConversationStagingClassifier', 'Execution', 'Conversation staging classification failed:', error);
    return [];
  }
}

module.exports = {
  TIMING_OFFSETS_MS,
  applyConversationStaging,
  buildConversationStagingPrompt,
  buildPresentCharacters,
  classifyConversationStaging,
  getNpcDialogueEntries,
  parseClassificationResponse
};

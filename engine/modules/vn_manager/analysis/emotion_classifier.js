const { getFilename, Logger, TurnLogger, readSettings, readFileSync, normalizeText } = require('../../utils.js');
const { callLLM, resolveModelAlias } = require('../../llm.js');
const {
  formatIndexedDialogueWithNarrative,
  getProcessedSceneLines
} = require('../scene_prompt_formatter.js');

// #region CONFIGURATION
const settings = readSettings();
const DEFAULT_EMOTIONS = ['neutral'];

const CONFIG = {
  ENABLED: settings.narrative_agents?.emotion_classifier?.enabled !== false,
  MODEL: settings.narrative_agents?.emotion_classifier?.model || 'highendmodel',
  RETRIES: settings.narrative_agents?.emotion_classifier?.retries,
  TIMEOUT: settings.narrative_agents?.emotion_classifier?.timeout,
  LLM_PARAMS: settings.narrative_agents?.emotion_classifier?.llm_params
    ? settings.narrative_agents.emotion_classifier.llm_params
    : {
      max_tokens: 5000,
      temperature: 0.3
    }
};

const MOOD_LIST = settings.narrative_agents?.emotion_classifier?.moods || ['neutral', 'happy', 'sad', 'angry', 'annoyed', 'surprised', 'fearful', 'caring', 'injured'];
const emotionPrompt = readFileSync("engine/prompts/emotion_classification_prompt.txt");

const ROTATION_SUFFIXES = new Set(['front', 'back', 'left', 'right']);
const RESERVED_TRAILING = new Set(['icon', 'reference']);
// #endregion

// #region EMOTION EXTRACTION
function stripAnimationAndRotationSuffixes(name) {
  if (!name) return '';

  let normalized = name;
  if (normalized.endsWith('_talk_blink')) {
    normalized = normalized.slice(0, -11);
  } else if (normalized.endsWith('_talk')) {
    normalized = normalized.slice(0, -5);
  } else if (normalized.endsWith('_blink')) {
    normalized = normalized.slice(0, -6);
  }

  const parts = normalized.split('_');
  const trailing = parts[parts.length - 1];
  if (ROTATION_SUFFIXES.has(trailing)) {
    parts.pop();
    normalized = parts.join('_');
  }

  return normalized;
}

function extractEmotionFromSpriteName(spritePath) {
  const filename = getFilename(spritePath);
  if (!filename) return null;

  let nameWithoutExt = filename.replace(/\.[^/.]+$/, "").toLowerCase();
  if (nameWithoutExt.startsWith('generic_npc')) return null;

  nameWithoutExt = stripAnimationAndRotationSuffixes(nameWithoutExt);
  if (!nameWithoutExt) return null;

  const parts = nameWithoutExt.split('_');
  if (parts.length < 2) return null;

  const trailing = parts[parts.length - 1];
  if (!trailing || RESERVED_TRAILING.has(trailing)) return null;

  // Split from the end:
  // sandra_reid_happy -> character=sandra_reid, emotion=happy
  // frieren_happy -> character=frieren, emotion=happy
  return trailing;
}

/**
 * Extracts a unique list of emotions from sprite filenames.
 * @param {string[]} sprites - Available sprite files.
 * @returns {string[]} - List of unique emotions.
 */
function extractEmotionList(sprites) {
  const emotionList = [...DEFAULT_EMOTIONS];

  for (const sprite of sprites) {
    const emotion = extractEmotionFromSpriteName(sprite);
    if (emotion && !emotionList.includes(emotion)) emotionList.push(emotion);
  }

  Logger.log('EmotionClassifier', 'Extraction', `Extracted emotions: ${emotionList.join(', ')}`);
  return emotionList;
}

function normalizeVariantKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function buildCharacterKeyCandidates(candidateCharacterKeys = []) {
  const keyCandidates = [];
  for (const key of candidateCharacterKeys) {
    if (typeof key !== 'string' || key.trim() === '') continue;
    const normalized = normalizeText(key);
    keyCandidates.push(key);
    keyCandidates.push(normalized);
    keyCandidates.push(normalized.replace(/_/g, ''));
  }
  return [...new Set(keyCandidates)];
}

function readVariantLockValue(lockRegistry, key) {
  if (!lockRegistry || !key) return undefined;
  if (lockRegistry instanceof Map) return lockRegistry.get(key);
  return lockRegistry[key];
}

function extractScheduleDialogueIndex(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const candidates = [entry.dialogueIndex, entry.dialogue, entry.fromDialogue, entry.line];

  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  return null;
}

function extractScheduleCharacterKey(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const raw = entry.characterKey ?? entry.character ?? entry.char;
  if (typeof raw !== 'string' || raw.trim() === '') return '';
  return normalizeText(raw);
}

function extractScheduleVariantValue(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(entry, 'variant')) return entry.variant;
  if (Object.prototype.hasOwnProperty.call(entry, 'variantKey')) return entry.variantKey;
  if (Object.prototype.hasOwnProperty.call(entry, 'value')) return entry.value;
  return undefined;
}

function resolveCatalogCharacterKey(rawName, spriteCatalog) {
  if (typeof rawName !== 'string' || rawName.trim() === '') return '';

  const catalogCharacters = spriteCatalog?.characters || {};
  const lookups = spriteCatalog?.lookups || {};

  const normalized = normalizeText(rawName);
  const firstName = normalizeText(rawName.trim().split(/\s+/)[0] || '');
  const candidates = buildCharacterKeyCandidates([rawName, normalized, firstName]);

  for (const candidate of candidates) {
    if (catalogCharacters[candidate]) return candidate;
  }

  for (const candidate of candidates) {
    const aliasMatches = lookups.byAlias?.[candidate];
    if (Array.isArray(aliasMatches) && aliasMatches.length > 0) return aliasMatches[0];
    const firstNameMatches = lookups.byFirstName?.[candidate];
    if (Array.isArray(firstNameMatches) && firstNameMatches.length > 0) return firstNameMatches[0];
  }

  return '';
}

function getSceneVariantLock(turnContext, candidateCharacterKeys = [], sceneLineIndex = null) {
  const vnManagerState = turnContext?.processed?.vnManager || {};
  const lockRegistry = vnManagerState.spriteVariantLocks;
  const lockSchedule = Array.isArray(vnManagerState.spriteVariantLockSchedule)
    ? vnManagerState.spriteVariantLockSchedule
    : [];

  const keyCandidates = buildCharacterKeyCandidates(candidateCharacterKeys);
  const keySet = new Set(keyCandidates);

  const currentSceneLineIndex = Number.isFinite(Number(sceneLineIndex))
    ? Number.parseInt(sceneLineIndex, 10)
    : null;

  if (currentSceneLineIndex != null && currentSceneLineIndex >= 0 && lockSchedule.length > 0) {
    let winner = null;

    lockSchedule.forEach((entry, scheduleOrder) => {
      const entryDialogue = extractScheduleDialogueIndex(entry);
      if (entryDialogue == null || entryDialogue > currentSceneLineIndex) return;

      const entryCharacterKey = extractScheduleCharacterKey(entry);
      if (!entryCharacterKey) return;

      const entryKeyCandidates = buildCharacterKeyCandidates([entryCharacterKey]);
      const characterMatches = entryKeyCandidates.some(key => keySet.has(key));
      if (!characterMatches) return;

      const entryVariant = extractScheduleVariantValue(entry);

      if (!winner ||
        entryDialogue > winner.dialogue ||
        (entryDialogue === winner.dialogue && scheduleOrder > winner.scheduleOrder)) {
        winner = { dialogue: entryDialogue, scheduleOrder, variant: entryVariant };
      }
    });

    if (winner) {
      if (typeof winner.variant === 'string' && winner.variant.trim() !== '') {
        return normalizeVariantKey(winner.variant);
      }
      return null;
    }
  }

  for (const key of keyCandidates) {
    const value = readVariantLockValue(lockRegistry, key);
    if (typeof value === 'string' && value.trim() !== '') {
      return normalizeVariantKey(value);
    }
  }

  return null;
}

function sanitizeEmotionArray(emotions, fallbackEmotionList) {
  const normalized = [];
  const seen = new Set();

  const source = Array.isArray(emotions) ? emotions : [];
  for (const emotion of source) {
    const value = normalizeVariantKey(String(emotion || ''));
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  if (normalized.length === 0) {
    return Array.isArray(fallbackEmotionList) && fallbackEmotionList.length > 0
      ? [...fallbackEmotionList]
      : ['neutral'];
  }

  return normalized;
}

function getAllowedEmotionsForDialogueLine(dialogueLine, dialogueIndex, turnContext, spriteCatalog, fallbackEmotionList) {
  const rawCharacter = dialogueLine?.character || '';
  if (!rawCharacter || !spriteCatalog?.characters) {
    return sanitizeEmotionArray(fallbackEmotionList, fallbackEmotionList);
  }

  const characterKey = resolveCatalogCharacterKey(rawCharacter, spriteCatalog);
  if (!characterKey) {
    return sanitizeEmotionArray(fallbackEmotionList, fallbackEmotionList);
  }

  const characterState = spriteCatalog.characters[characterKey];
  if (!characterState) {
    return sanitizeEmotionArray(fallbackEmotionList, fallbackEmotionList);
  }

  const firstName = rawCharacter.trim().split(/\s+/)[0] || '';
  const sceneVariantLock = getSceneVariantLock(
    turnContext,
    [rawCharacter, characterKey, firstName],
    dialogueIndex
  );

  if (sceneVariantLock && characterState.variantData?.[sceneVariantLock]) {
    const variantEmotions = sanitizeEmotionArray(
      characterState.variantData[sceneVariantLock].emotions,
      fallbackEmotionList
    );
    if (variantEmotions.length > 0) return variantEmotions;
  }

  return sanitizeEmotionArray(characterState.emotions, fallbackEmotionList);
}

function buildEmotionClassificationContext(dialogues, sprites, turnContext) {
  const fallbackEmotionList = extractEmotionList(sprites);
  const spriteCatalog = turnContext?.runtime?.vnManager?.spriteCatalog;
  const spriteMetadata = turnContext?.runtime?.vnManager?.spriteMetadata;

  if (!spriteCatalog || !spriteCatalog.characters) {
    return {
      globalEmotionList: fallbackEmotionList,
      lineAllowedEmotions: dialogues.map(() => [...fallbackEmotionList]),
      lineCharacterKeys: dialogues.map(() => ''),
      characterProfiles: {}
    };
  }

  const lineAllowedEmotions = [];
  const lineCharacterKeys = [];
  const characterProfiles = {};

  dialogues.forEach((dialogue, index) => {
    const dialogueIndex = Number.isInteger(dialogue?.sceneLineIndex) ? dialogue.sceneLineIndex : index;
    const rawCharacter = dialogue?.character || '';
    const characterKey = resolveCatalogCharacterKey(rawCharacter, spriteCatalog);
    lineCharacterKeys.push(characterKey || '');

    const allowedEmotions = getAllowedEmotionsForDialogueLine(
      dialogue,
      dialogueIndex,
      turnContext,
      spriteCatalog,
      fallbackEmotionList
    );
    lineAllowedEmotions.push(allowedEmotions);

    const profileKey = characterKey || normalizeText(rawCharacter || `line_${dialogueIndex}`) || `line_${dialogueIndex}`;
    if (!characterProfiles[profileKey]) {
      characterProfiles[profileKey] = {
        key: characterKey || '',
        displayName: rawCharacter || 'Unknown',
        emotionGuidance: '',
        allowedEmotions: []
      };
    }

    const profile = characterProfiles[profileKey];
    allowedEmotions.forEach(emotion => {
      if (!profile.allowedEmotions.includes(emotion)) {
        profile.allowedEmotions.push(emotion);
      }
    });

    if (characterKey && !profile.emotionGuidance) {
      const guidance = spriteMetadata?.characters?.[characterKey]?.emotionGuidance;
      if (typeof guidance === 'string' && guidance.trim() !== '') {
        profile.emotionGuidance = guidance.trim();
      }
    }
  });

  const globalSet = new Set(fallbackEmotionList);
  lineAllowedEmotions.forEach(list => list.forEach(emotion => globalSet.add(emotion)));

  return {
    globalEmotionList: Array.from(globalSet),
    lineAllowedEmotions,
    lineCharacterKeys,
    characterProfiles
  };
}

function formatCharacterEmotionProfiles(characterProfiles = {}) {
  const profiles = Object.values(characterProfiles || {});
  if (!Array.isArray(profiles) || profiles.length === 0) return 'None';

  return profiles.map((profile, index) => {
    const keyPart = profile.key ? ` (key: ${profile.key})` : '';
    const allowed = Array.isArray(profile.allowedEmotions) && profile.allowedEmotions.length > 0
      ? profile.allowedEmotions.join(', ')
      : 'neutral';
    const guidance = profile.emotionGuidance && profile.emotionGuidance.trim() !== ''
      ? profile.emotionGuidance.trim()
      : 'none';
    return `${index + 1}. ${profile.displayName || 'Unknown'}${keyPart} -> allowed: ${allowed} | guidance: ${guidance}`;
  }).join('\n');
}

function buildMoodClassificationContext(dialogues, turnContext) {
  const moodCatalog = turnContext?.runtime?.ttsVoiceMoodCatalog || null;
  const catalogGlobal = Array.isArray(moodCatalog?.globalMoods) ? moodCatalog.globalMoods : [];
  const sharedMoods = Array.isArray(moodCatalog?.sharedMoods) ? moodCatalog.sharedMoods : [];

  const globalMoodSet = new Set(MOOD_LIST.map(m => normalizeText(m)));
  catalogGlobal.forEach(m => globalMoodSet.add(normalizeText(m)));
  globalMoodSet.add('neutral');
  const globalMoodList = Array.from(globalMoodSet).filter(Boolean);
  return { globalMoodList, sharedMoods };
}
// #endregion

// #region PROMPT GENERATION
/**
 * Creates the prompt for batch emotion classification.
 * @param {Array} dialogues - Dialogue objects.
 * @param {object} classificationContext - Context with global and per-line allowed emotions.
 * @returns {string} - The prompt.
 */
function createEmotionClassificationPrompt(turnContext, dialogues, classificationContext, customMoods = null) {
  if (!emotionPrompt) return "";

  const currentMoodList = Array.isArray(classificationContext?.globalMoodList) && classificationContext.globalMoodList.length > 0
    ? classificationContext.globalMoodList
    : (customMoods || MOOD_LIST);
  const globalEmotionList = Array.isArray(classificationContext?.globalEmotionList)
    ? classificationContext.globalEmotionList
    : ['neutral'];
  const lineAllowedEmotions = Array.isArray(classificationContext?.lineAllowedEmotions)
    ? classificationContext.lineAllowedEmotions
    : dialogues.map(() => globalEmotionList);
  const lineEmotionConstraints = dialogues.map((dialogue, index) => {
    const allowed = Array.isArray(lineAllowedEmotions[index]) && lineAllowedEmotions[index].length > 0
      ? lineAllowedEmotions[index]
      : globalEmotionList;
    const lineIndex = Number.isInteger(dialogue?.sceneLineIndex) ? dialogue.sceneLineIndex : index;
    return `${lineIndex}. ${dialogue.character || 'Unknown'} -> ${allowed.join(', ')}`;
  }).join('\n');
  const characterEmotionProfiles = formatCharacterEmotionProfiles(classificationContext?.characterProfiles || {});
  const sharedMoods = Array.isArray(classificationContext?.sharedMoods) && classificationContext.sharedMoods.length > 0
    ? classificationContext.sharedMoods.join(', ')
    : 'None';
  const projectDirectives = turnContext.getFormattedDirective('emotion_classifier', { header: 'Project-specific creative directives:' });
  const sceneLines = getProcessedSceneLines(turnContext);
  const targetLineIndexes = dialogues.map((dialogue, index) => (
    Number.isInteger(dialogue?.sceneLineIndex) ? dialogue.sceneLineIndex : index
  ));
  const narrativeAssistedDialogues = sceneLines.length > 0
    ? formatIndexedDialogueWithNarrative(sceneLines, { targetLineIndexes })
    : dialogues.map((dialogue, index) => {
        const lineIndex = Number.isInteger(dialogue?.sceneLineIndex) ? dialogue.sceneLineIndex : index;
        return `${lineIndex}. ${dialogue.character || 'Unknown'}: ${dialogue.text || dialogue.line || ''}`;
      }).join('\n');

  return emotionPrompt
    .replace('${emotionList}', globalEmotionList.join(', '))
    .replace('${lineEmotionConstraints}', lineEmotionConstraints)
    .replace('${characterEmotionProfiles}', characterEmotionProfiles)
    .replace('${sharedTtsMoods}', sharedMoods)
    .replace('${moodList}', currentMoodList.join(', '))
    .replace('${project_directives}', projectDirectives)
    .replace('${dialogues}', narrativeAssistedDialogues);
}
// #endregion

// #region RESPONSE PARSING
/**
 * Parses the emotion classification response from the LLM.
 * @param {string} response - LLM response.
 * @param {object} classificationContext - Context with global and per-line allowed emotions.
 * @param {Array} dialogues - Original dialogues for fallback.
 * @returns {string[]} - Parsed emotions.
 */
function parseEmotionResponse(response, classificationContext, dialogues, customMoods = null) {
  const lines = response.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const parsedResults = [];
  const currentMoodList = Array.isArray(classificationContext?.globalMoodList) && classificationContext.globalMoodList.length > 0
    ? classificationContext.globalMoodList
    : (customMoods || MOOD_LIST);
  const globalEmotionList = Array.isArray(classificationContext?.globalEmotionList) && classificationContext.globalEmotionList.length > 0
    ? classificationContext.globalEmotionList
    : ['neutral'];
  const lineAllowedEmotions = Array.isArray(classificationContext?.lineAllowedEmotions)
    ? classificationContext.lineAllowedEmotions
    : dialogues.map(() => globalEmotionList);
  const escapeRegExp = (text) => String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalizeRawEmotion = (text) => normalizeVariantKey(String(text || '').replace(/^\d+[\).:\-\s]*/, ''));
  const detectEmotionFromLine = (lineText, allowedEmotions) => {
    if (!Array.isArray(allowedEmotions) || allowedEmotions.length === 0) return null;
    const sorted = [...allowedEmotions].sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`\\b(${sorted.map(escapeRegExp).join('|')})\\b`, 'i');
    const match = String(lineText || '').match(pattern);
    return match ? normalizeVariantKey(match[1]) : null;
  };
  const detectMoodFromLine = (lineText) => {
    const sorted = [...currentMoodList].sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`\\b(${sorted.map(escapeRegExp).join('|')})\\b`, 'i');
    const match = String(lineText || '').match(pattern);
    return match ? normalizeVariantKey(match[1]) : null;
  };

  const indexedLines = new Map();
  for (const line of lines) {
    const match = line.match(/^(?:line\s+)?(\d+)\s*[).:\-]\s*(.+)$/i);
    if (!match) continue;
    const lineIndex = Number(match[1]);
    if (!indexedLines.has(lineIndex)) indexedLines.set(lineIndex, match[2].trim());
  }
  const mayUseLegacyPosition = indexedLines.size === 0 && lines.length === dialogues.length;

  for (let i = 0; i < dialogues.length; i++) {
    const sceneLineIndex = Number.isInteger(dialogues[i]?.sceneLineIndex) ? dialogues[i].sceneLineIndex : i;
    const line = indexedLines.get(sceneLineIndex) || (mayUseLegacyPosition ? lines[i] : '') || '';
    const parts = line.split(',').map(p => p.trim().toLowerCase());
    const allowedEmotions = Array.isArray(lineAllowedEmotions[i]) && lineAllowedEmotions[i].length > 0
      ? lineAllowedEmotions[i]
      : globalEmotionList;

    let emotion = normalizeRawEmotion(parts[0]);
    let mood = parts[1] || 'neutral';

    if (!allowedEmotions.includes(emotion)) {
      const detected = detectEmotionFromLine(line, allowedEmotions);
      emotion = detected || (allowedEmotions.includes('neutral') ? 'neutral' : allowedEmotions[0] || 'neutral');
    }

    mood = normalizeVariantKey(mood);
    if (!currentMoodList.includes(mood)) {
      const detectedMood = detectMoodFromLine(line);
      mood = detectedMood && currentMoodList.includes(detectedMood) ? detectedMood : 'neutral';
    }

    parsedResults.push({ emotion, mood });
  }

  return parsedResults.slice(0, dialogues.length);
}
// #endregion

// #region CORE CLASSIFICATION
function buildEmotionClassificationPrompt(turnContext, dialogues, classificationContext, customMoods, chunkIndex = 0) {
  const { Prompt } = require('../../prompt/prompt.js');
  const promptText = createEmotionClassificationPrompt(turnContext, dialogues, classificationContext, customMoods);
  const prompt = new Prompt({ id: 'core.vn.emotion_chunk' });
  prompt.user(message => {
    message.add('core.vn.emotion_classification', promptText, { instanceKey: `chunk-${chunkIndex}` });
  });
  return prompt.prepare();
}

/**
 * Helper to process a single chunk of dialogues.
 */
async function _classifyEmotionChunk(turnContext, dialogues, classificationContext, customMoods, chunkIndex = 0) {
  const prepared = buildEmotionClassificationPrompt(turnContext, dialogues, classificationContext, customMoods, chunkIndex);
  try {
    const { content: responseContent, model: resolvedModel } = await callLLM({
      model: CONFIG.MODEL,
      retries: CONFIG.RETRIES,
      timeout: CONFIG.TIMEOUT,
      prompt: prepared,
      ...CONFIG.LLM_PARAMS,
      callingModule: 'EmotionClassifier',
      turnLogTitle: 'Emotion Classifier - Chunk'
    });
    return parseEmotionResponse(responseContent, classificationContext, dialogues, customMoods);
  } catch (error) {
    Logger.error('EmotionClassifier', 'ChunkClassification', 'Emotion classification chunk failed:', error);
    return dialogues.map(() => ({ emotion: 'neutral', mood: 'neutral' })); // Fallback on error
  }
}

/**
 * Classifies emotions for dialogue lines in a batch, with parallel chunking.
 * @param {Array} dialogues - Dialogue objects with text.
 * @param {string[]} sprites - Available sprite files.
 * @param {object} turnContext - The current turn context.
 * @returns {Promise<string[]>} - Array of classified emotions.
 */
async function batchClassifyEmotions(dialogues, sprites, turnContext) {
  if (dialogues == null || dialogues.length === 0) {
    Logger.log('EmotionClassifier', 'Classification', 'No dialogues provided for emotion classification.');
    return [];
  }
  if (!CONFIG.ENABLED || turnContext?.emotionClassifierEnabled === false) {
    Logger.log('EmotionClassifier', 'Classification', 'Emotion classification is disabled by settings or context.');
    return dialogues.map(() => ({ emotion: 'neutral', mood: 'neutral' }));
  }

  const classificationContext = buildEmotionClassificationContext(dialogues, sprites, turnContext);
  const moodClassificationContext = buildMoodClassificationContext(dialogues, turnContext);
  classificationContext.globalMoodList = moodClassificationContext.globalMoodList;
  classificationContext.sharedMoods = moodClassificationContext.sharedMoods;
  const customMoods = (turnContext?.runtime?.customTtsMoods && Array.isArray(turnContext.runtime.customTtsMoods))
    ? turnContext.runtime.customTtsMoods
    : null;

  // Rule: Split in batches of 50, but only if the remaining is > 25 (total max 75 per batch)
  const chunks = [];
  let i = 0;
  while (i < dialogues.length) {
    const remaining = dialogues.length - i;
    let chunkSize = 50;

    // If remaining is 75 or less, we process it as one final chunk
    if (remaining <= 75) {
      chunkSize = remaining;
    }

    const chunkDialogues = dialogues.slice(i, i + chunkSize);
    const chunkLineAllowed = classificationContext.lineAllowedEmotions.slice(i, i + chunkSize);
    const chunkLineCharacterKeys = classificationContext.lineCharacterKeys.slice(i, i + chunkSize);
    const chunkGlobalSet = new Set(['neutral']);
    const chunkGlobalMoodSet = new Set(classificationContext.globalMoodList || ['neutral']);
    chunkLineAllowed.forEach(lineList => {
      (lineList || []).forEach(emotion => chunkGlobalSet.add(emotion));
    });

    const chunkCharacterProfiles = {};
    chunkLineCharacterKeys.forEach((characterKey, lineIdx) => {
      const rawDisplayName = chunkDialogues[lineIdx]?.character || 'Unknown';
      const profileLookupKey = characterKey || normalizeText(rawDisplayName || `line_${lineIdx + 1}`) || `line_${lineIdx + 1}`;
      const sourceProfile = classificationContext.characterProfiles?.[profileLookupKey];

      if (!chunkCharacterProfiles[profileLookupKey]) {
        chunkCharacterProfiles[profileLookupKey] = {
          key: sourceProfile?.key || characterKey || '',
          displayName: sourceProfile?.displayName || rawDisplayName,
          emotionGuidance: sourceProfile?.emotionGuidance || '',
          allowedEmotions: []
        };
      }

      const profile = chunkCharacterProfiles[profileLookupKey];
      const lineAllowed = Array.isArray(chunkLineAllowed[lineIdx]) ? chunkLineAllowed[lineIdx] : [];
      lineAllowed.forEach(emotion => {
        if (!profile.allowedEmotions.includes(emotion)) {
          profile.allowedEmotions.push(emotion);
        }
      });
    });

    chunks.push({
      dialogues: chunkDialogues,
      classificationContext: {
        globalEmotionList: Array.from(chunkGlobalSet),
        globalMoodList: Array.from(chunkGlobalMoodSet),
        sharedMoods: classificationContext.sharedMoods || [],
        lineAllowedEmotions: chunkLineAllowed,
        lineCharacterKeys: chunkLineCharacterKeys,
        characterProfiles: chunkCharacterProfiles
      }
    });
    i += chunkSize;
  }

  Logger.log('EmotionClassifier', 'Classification', `Starting batch emotion classification (${dialogues.length} lines, ${chunks.length} chunks)...`, 'start');

  try {
    // Process all chunks in parallel
    const chunkPromises = chunks.map(chunk =>
      _classifyEmotionChunk(turnContext, chunk.dialogues, chunk.classificationContext, customMoods)
    );
    const results = await Promise.all(chunkPromises);

    // Flatten results back into a single array
    const flatEmotions = results.flat();

    Logger.log('EmotionClassifier', 'Classification', 'Emotion classification for all chunks complete.', 'end');
    return flatEmotions;
  } catch (error) {
    Logger.error('EmotionClassifier', 'Classification', 'Batch emotion classification failed:', error);
    return dialogues.map(() => ({ emotion: 'neutral', mood: 'neutral' })); // Final fallback
  }
}
// #endregion

// #region EXPORTS
module.exports = {
  batchClassifyEmotions,
  getAllowedEmotionsForDialogueLine,
  resolveCatalogCharacterKey,
  _private: {
    buildEmotionClassificationPrompt,
    createEmotionClassificationPrompt,
    parseEmotionResponse
  }
};
// #endregion

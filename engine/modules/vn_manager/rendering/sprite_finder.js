const { getFilename, stripExtension, normalizeText, Logger, listFilesRecursive, relativizeAssetPath } = require('../../utils.js');
const fs = require('fs');
const path = require('path');
const GenderGuesser = require('../analysis/genderguesser.js');
const stringSimilarity = require('string-similarity');

// #region MODULE IMPORTS
const factManager = require('../../memory_manager/storage/fact_manager.js');
// #endregion

// #region CONSTANTS
const FUZZY_MATCH_THRESHOLD = 0.7;
const GENDER_CONFIDENCE_THRESHOLD = 0.6;

// Common Japanese honorifics for character name cleanup
const JAPANESE_HONORIFICS = [
  'san', 'chan', 'kun', 'sama', 'sensei', 'senpai', 'dono', 'shi', 'tan',
  'nii', 'nee', 'ba', 'ji', 'bō', 'chin', 'cchi', 'pē', 'rin', 'pon',
  'pyon', 'maru', 'hime', 'ouji', 'hakase', 'shachou'
];

const ROTATION_KEYWORDS = ['front', 'left', 'right', 'back'];
const ROTATION_KEYWORD_SET = new Set(ROTATION_KEYWORDS);
// #endregion

// #region GENDER GUESSER INITIALIZATION
let genderGuesserInstance;
/**
 * Lazily initializes and returns the GenderGuesser instance.
 * @returns {GenderGuesser|null} An instance of GenderGuesser, or null if initialization failed.
 */
function getGenderGuesser() {
  if (!genderGuesserInstance) {
    try {
      genderGuesserInstance = new GenderGuesser();
    } catch (error) {
      Logger.error('SpriteFinder', 'Gender guesser initialization failed:', error);
      genderGuesserInstance = null;
    }
  }
  return genderGuesserInstance;
}
// #endregion

// #region UTILITY FUNCTIONS
/**
 * Removes Japanese honorifics from character names
 * @param {string} name - The character name to clean
 * @returns {string} - The cleaned name
 */
function stripHonorifics(name) {
  if (typeof name !== 'string') return '';

  const honorificsPattern = `[-‐–—]?(${JAPANESE_HONORIFICS.join('|')})\\b`;
  const regex = new RegExp(honorificsPattern, 'gi');
  return name.replace(regex, '').trim();
}


/**
 * Generates a deterministic index based on a string and a maximum count.
 * This ensures that a character name (e.g. "Stella") always maps to the same 
 * variant index (1..N) if the character list doesn't change.
 * @param {string} str - The string to hash (e.g. character name).
 * @param {number} count - The number of available variants.
 * @returns {number} A stable index between 0 and count-1.
 */
function getDeterministicIndex(str, count) {
  if (count <= 1) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash) % count;
}

function normalizeSpritePath(spritePath) {
  return String(spritePath || '').replace(/\\/g, '/');
}

function normalizeVariantKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function naturalSortSprites(sprites = []) {
  return [...sprites].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function escapeRegExp(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const candidates = [
    entry.dialogueIndex,
    entry.dialogue,
    entry.fromDialogue,
    entry.line
  ];

  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
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

/**
 * Resolves a scene variant lock for a character. Supports:
 * 1) Static map/object lock: processed.vnManager.spriteVariantLocks[character] = "winter_clothes"
 * 2) Dialogue-index schedule: processed.vnManager.spriteVariantLockSchedule = [
 *      { dialogue: 65, character: "frieren", variant: "winter_clothes" },
 *      { dialogue: 110, character: "frieren", variant: null } // clear lock
 *    ]
 *
 * Schedule semantics:
 * - Entries apply from their dialogue index onward.
 * - Highest dialogue index <= current dialogue wins.
 * - If same dialogue index has multiple entries, later array entry wins.
 *
 * @param {object} turnContext
 * @param {string[]} candidateCharacterKeys
 * @param {number|null} dialogueIndex - 1-based dialogue index in current turn.
 * @returns {string|null} Normalized variant key or null.
 */
function getSceneVariantLock(turnContext, candidateCharacterKeys = [], dialogueIndex = null) {
  const vnManagerState = turnContext?.processed?.vnManager || {};
  const lockRegistry = vnManagerState.spriteVariantLocks;
  const lockSchedule = Array.isArray(vnManagerState.spriteVariantLockSchedule)
    ? vnManagerState.spriteVariantLockSchedule
    : [];

  const keyCandidates = buildCharacterKeyCandidates(candidateCharacterKeys);
  const keySet = new Set(keyCandidates);

  // 1) Dialogue schedule overlay (if dialogue index is available)
  const currentDialogueIndex = Number.isFinite(Number(dialogueIndex))
    ? Number.parseInt(dialogueIndex, 10)
    : null;

  if (currentDialogueIndex && currentDialogueIndex > 0 && lockSchedule.length > 0) {
    let winner = null;

    lockSchedule.forEach((entry, scheduleOrder) => {
      const entryDialogue = extractScheduleDialogueIndex(entry);
      if (!entryDialogue || entryDialogue > currentDialogueIndex) return;

      const entryCharacterKey = extractScheduleCharacterKey(entry);
      if (!entryCharacterKey) return;

      const entryKeyCandidates = buildCharacterKeyCandidates([entryCharacterKey]);
      const characterMatches = entryKeyCandidates.some(key => keySet.has(key));
      if (!characterMatches) return;

      const entryVariant = extractScheduleVariantValue(entry);

      if (!winner ||
        entryDialogue > winner.dialogue ||
        (entryDialogue === winner.dialogue && scheduleOrder > winner.scheduleOrder)) {
        winner = {
          dialogue: entryDialogue,
          scheduleOrder,
          variant: entryVariant
        };
      }
    });

    if (winner) {
      if (typeof winner.variant === 'string' && winner.variant.trim() !== '') {
        return normalizeVariantKey(winner.variant);
      }
      // Null/empty variant explicitly clears lock from this dialogue onward.
      return null;
    }
  }

  // 2) Static direct lock fallback
  for (const key of keyCandidates) {
    const value = readVariantLockValue(lockRegistry, key);
    if (typeof value === 'string' && value.trim() !== '') {
      return normalizeVariantKey(value);
    }
  }

  return null;
}

function filterSpritesForVariant(sprites, characterFolderCandidates, variantKey) {
  if (!Array.isArray(sprites) || !variantKey) return [];

  const normalizedVariant = normalizeVariantKey(variantKey);
  const candidateKeys = new Set(
    characterFolderCandidates.map(normalizeVariantKey).filter(Boolean)
  );

  return sprites.filter(sprite => {
    const pathContext = extractSpritePathContext(sprite);
    if (normalizeVariantKey(pathContext.variantKey) !== normalizedVariant) return false;

    const signature = parseSpriteSignature(sprite);
    const characterKey = resolveCharacterKey(signature, pathContext);
    return candidateKeys.has(normalizeVariantKey(characterKey));
  });
}

function isUtilityOrAnimationSprite(filenameNoExt) {
  if (typeof filenameNoExt !== 'string' || !filenameNoExt) return false;
  return filenameNoExt.endsWith('_blink') ||
    filenameNoExt.endsWith('_talk') ||
    filenameNoExt.endsWith('_talk_blink') ||
    filenameNoExt.endsWith('_icon') ||
    filenameNoExt.endsWith('_reference');
}

function buildEmotionCandidates(requestedEmotion) {
  const normalizedRequestedEmotion = normalizeVariantKey(requestedEmotion || 'neutral') || 'neutral';
  const candidates = [normalizedRequestedEmotion];

  if (!candidates.includes('neutral')) {
    candidates.push('neutral');
  }

  return candidates;
}

function findAnyCharacterBaseMatch(sprites, normalizedChar, firstName) {
  if (!Array.isArray(sprites) || sprites.length === 0) return null;

  const normalizedFirstName = normalizeText(firstName || '');
  const matchesCharacter = (filenameNoExt) => {
    if (!filenameNoExt) return false;
    return filenameNoExt === normalizedChar ||
      filenameNoExt.startsWith(`${normalizedChar}_`) ||
      (normalizedFirstName &&
        (filenameNoExt === normalizedFirstName || filenameNoExt.startsWith(`${normalizedFirstName}_`)));
  };

  // Prefer non-rotation/non-animation base if available.
  for (const sprite of sprites) {
    const filenameNoExt = stripExtension(getFilename(sprite)).toLowerCase();
    if (!matchesCharacter(filenameNoExt)) continue;
    if (isUtilityOrAnimationSprite(filenameNoExt)) continue;
    if (filenameNoExt.endsWith('_left') || filenameNoExt.endsWith('_right') || filenameNoExt.endsWith('_back')) continue;
    return sprite;
  }

  // Fallback to any non-utility sprite for the character inside the same pool.
  for (const sprite of sprites) {
    const filenameNoExt = stripExtension(getFilename(sprite)).toLowerCase();
    if (!matchesCharacter(filenameNoExt)) continue;
    if (isUtilityOrAnimationSprite(filenameNoExt)) continue;
    return sprite;
  }

  return null;
}

function getAvailableRotationsForImage(sprites, imagePath) {
  if (!imagePath || !Array.isArray(sprites) || sprites.length === 0) return [];

  const spriteSet = new Set(
    sprites.map(sprite => stripExtension(normalizeSpritePath(sprite)).toLowerCase())
  );

  let basePath = stripExtension(normalizeSpritePath(imagePath)).toLowerCase();
  for (const keyword of ROTATION_KEYWORDS) {
    const suffix = `_${keyword}`;
    if (basePath.endsWith(suffix)) {
      basePath = basePath.slice(0, -suffix.length);
      break;
    }
  }

  const rotations = [];
  for (const keyword of ROTATION_KEYWORDS) {
    if (spriteSet.has(`${basePath}_${keyword}`)) {
      rotations.push(keyword);
    }
  }

  if (spriteSet.has(basePath) && !rotations.includes('front')) {
    rotations.push('front');
  }

  return [...new Set(rotations)];
}

function detectAnimationLayer(nameWithoutExtension) {
  if (nameWithoutExtension.endsWith('_talk_blink')) return 'talk_blink';
  if (nameWithoutExtension.endsWith('_talk')) return 'talk';
  if (nameWithoutExtension.endsWith('_blink')) return 'blink';
  return null;
}

function stripAnimationLayer(nameWithoutExtension, animationLayer) {
  if (!animationLayer) return nameWithoutExtension;
  if (animationLayer === 'talk_blink') return nameWithoutExtension.slice(0, -11);
  if (animationLayer === 'talk') return nameWithoutExtension.slice(0, -5);
  if (animationLayer === 'blink') return nameWithoutExtension.slice(0, -6);
  return nameWithoutExtension;
}

function extractGenericProfileKey(filenameNoExt) {
  if (typeof filenameNoExt !== 'string' || !filenameNoExt) return '';

  const animationLayer = detectAnimationLayer(filenameNoExt);
  let workingName = stripAnimationLayer(filenameNoExt, animationLayer);
  const parts = workingName.split('_').filter(Boolean);
  if (parts.length === 0) return '';

  if (ROTATION_KEYWORD_SET.has(parts[parts.length - 1])) {
    parts.pop();
  }

  while (parts.length > 0 && /^\d+$/.test(parts[0])) {
    parts.shift();
  }

  if (parts.length === 0) return '';
  if (parts[0] === 'generic' && parts[1] === 'npc') return '';
  if (parts.length === 1 && parts[0] === 'generic') return 'generic';
  if (parts[parts.length - 1] !== 'generic') return '';

  const profileParts = parts.slice(0, -1);
  if (profileParts.length === 0) return 'generic';
  if (profileParts[0] === 'generic' && profileParts[1] === 'npc') return '';
  return normalizeVariantKey(profileParts.join('_'));
}

function extractSpritePathContext(spritePath) {
  const normalizedPath = normalizeSpritePath(spritePath);
  const lowerPath = normalizedPath.toLowerCase();
  const marker = '/sprites/';
  const markerIndex = lowerPath.lastIndexOf(marker);

  let relativePath = markerIndex >= 0
    ? normalizedPath.slice(markerIndex + marker.length)
    : normalizedPath.replace(/^sprites\//i, '');

  // If we still couldn't isolate from "sprites/", fallback to full path split.
  if (!relativePath || relativePath === normalizedPath) {
    relativePath = normalizedPath;
  }

  const segments = relativePath.split('/').filter(Boolean);
  let characterFolder = '';
  let variantKey = 'default';

  // Supported variant topology:
  // sprites/<character>/<variant>/<file>
  if (segments.length >= 3) {
    characterFolder = normalizeVariantKey(segments[0]);
    variantKey = normalizeVariantKey(segments[1]) || 'default';
  }

  return {
    normalizedPath,
    relativePath,
    characterFolder,
    variantKey
  };
}

function parseSpriteSignature(spritePath) {
  const filenameNoExt = stripExtension(getFilename(spritePath)).toLowerCase();
  if (!filenameNoExt) return null;

  const animationLayer = detectAnimationLayer(filenameNoExt);
  let workingName = stripAnimationLayer(filenameNoExt, animationLayer);

  let isIcon = false;
  let isReference = false;
  if (workingName.endsWith('_icon')) {
    isIcon = true;
    workingName = workingName.slice(0, -5);
  } else if (workingName.endsWith('_reference')) {
    isReference = true;
    workingName = workingName.slice(0, -10);
  }

  const parts = workingName.split('_').filter(Boolean);
  let rotation = null;
  if (parts.length > 0 && ROTATION_KEYWORD_SET.has(parts[parts.length - 1])) {
    rotation = parts.pop();
  }

  let emotion = null;
  if (!isIcon && !isReference && parts.length >= 2) {
    emotion = parts.pop();
  }

  const characterFromName = normalizeVariantKey(parts.join('_'));
  const isGeneric = filenameNoExt.startsWith('generic_npc') || filenameNoExt.includes('generic');
  const genericProfileKey = isGeneric ? extractGenericProfileKey(filenameNoExt) : '';
  const effectiveRotation = (!isIcon && !isReference) ? (rotation || 'front') : null;

  // Keep this filter fully aligned with VNManager's baseSprites behavior:
  // - Exclude animation layers, icon/reference, left/right/back rotations
  // - Keep plain + _front versions
  const isBaseSprite = !isIcon &&
    !isReference &&
    !animationLayer &&
    rotation !== 'left' &&
    rotation !== 'right' &&
    rotation !== 'back';

  return {
    filenameNoExt,
    animationLayer,
    isIcon,
    isReference,
    isGeneric,
    genericProfileKey,
    rotation,
    effectiveRotation,
    emotion,
    characterFromName,
    isBaseSprite
  };
}

function createCapabilities() {
  return { talk: false, blink: false, talkBlink: false };
}

function applyCapabilities(capabilities, animationLayer) {
  if (!capabilities || !animationLayer) return;

  if (animationLayer === 'talk') {
    capabilities.talk = true;
    return;
  }

  if (animationLayer === 'blink') {
    capabilities.blink = true;
    return;
  }

  if (animationLayer === 'talk_blink') {
    capabilities.talk = true;
    capabilities.blink = true;
    capabilities.talkBlink = true;
  }
}

function resolveCharacterKey(signature, pathContext) {
  if (!signature || signature.isGeneric) return '';
  if (pathContext.characterFolder) return pathContext.characterFolder;
  return signature.characterFromName || '';
}

/**
 * Builds a runtime sprite catalog so modules/plugins can reason about available
 * character assets before sprite picking begins.
 * @param {string[]} sprites - List of sprite paths (usually relative "sprites/...").
 * @returns {object} Runtime sprite catalog.
 */
function buildSpriteCatalog(sprites = []) {
  const inputSprites = Array.isArray(sprites) ? sprites : [];

  const allSprites = new Set();
  const baseSprites = new Set();
  const neutralSprites = new Set();
  const genericSprites = new Set();
  const genericProfileMap = new Map();
  const iconSprites = new Set();
  const referenceSprites = new Set();
  const ignoredSprites = new Set();
  const explicitRotationSprites = new Set();

  const characterMap = new Map();

  const ensureCharacter = (characterKey) => {
    if (!characterMap.has(characterKey)) {
      characterMap.set(characterKey, {
        key: characterKey,
        aliases: new Set([characterKey]),
        files: new Set(),
        baseSprites: new Set(),
        neutralSprites: new Set(),
        emotions: new Set(),
        rotations: new Set(),
        capabilities: createCapabilities(),
        variants: new Map()
      });
    }
    return characterMap.get(characterKey);
  };

  const ensureVariant = (characterState, variantKey) => {
    if (!characterState.variants.has(variantKey)) {
      characterState.variants.set(variantKey, {
        key: variantKey,
        files: new Set(),
        baseSprites: new Set(),
        neutralSprites: new Set(),
        emotions: new Set(),
        rotations: new Set(),
        capabilities: createCapabilities()
      });
    }
    return characterState.variants.get(variantKey);
  };

  for (const spritePath of inputSprites) {
    const normalizedPath = normalizeSpritePath(spritePath);
    if (!normalizedPath) continue;

    const signature = parseSpriteSignature(normalizedPath);
    if (!signature) continue;

    const pathContext = extractSpritePathContext(normalizedPath);

    allSprites.add(normalizedPath);

    if (signature.isGeneric) genericSprites.add(normalizedPath);
    if (signature.isGeneric && signature.isBaseSprite && signature.genericProfileKey) {
      if (!genericProfileMap.has(signature.genericProfileKey)) {
        genericProfileMap.set(signature.genericProfileKey, new Set());
      }
      genericProfileMap.get(signature.genericProfileKey).add(normalizedPath);
    }
    if (signature.isIcon) {
      iconSprites.add(normalizedPath);
      ignoredSprites.add(normalizedPath);
    }
    if (signature.isReference) {
      referenceSprites.add(normalizedPath);
      ignoredSprites.add(normalizedPath);
    }
    if (signature.rotation) {
      explicitRotationSprites.add(normalizedPath);
    }

    if (signature.isBaseSprite) {
      baseSprites.add(normalizedPath);
    }

    if (signature.emotion === 'neutral' && !signature.isIcon && !signature.isReference) {
      neutralSprites.add(normalizedPath);
    }

    const characterKey = resolveCharacterKey(signature, pathContext);
    if (!characterKey) continue;

    const variantKey = pathContext.variantKey || 'default';
    const characterState = ensureCharacter(characterKey);
    const variantState = ensureVariant(characterState, variantKey);

    if (signature.characterFromName) {
      characterState.aliases.add(signature.characterFromName);
    }
    if (pathContext.characterFolder) {
      characterState.aliases.add(pathContext.characterFolder);
    }

    characterState.files.add(normalizedPath);
    variantState.files.add(normalizedPath);

    if (signature.isBaseSprite) {
      characterState.baseSprites.add(normalizedPath);
      variantState.baseSprites.add(normalizedPath);
    }

    if (signature.emotion) {
      characterState.emotions.add(signature.emotion);
      variantState.emotions.add(signature.emotion);
      if (signature.emotion === 'neutral') {
        characterState.neutralSprites.add(normalizedPath);
        variantState.neutralSprites.add(normalizedPath);
      }
    }

    if (signature.effectiveRotation) {
      characterState.rotations.add(signature.effectiveRotation);
      variantState.rotations.add(signature.effectiveRotation);
    }

    applyCapabilities(characterState.capabilities, signature.animationLayer);
    applyCapabilities(variantState.capabilities, signature.animationLayer);
  }

  const toArray = (set) => Array.from(set || []);
  const characters = {};
  const lookupsByFirstName = {};
  const lookupsByAlias = {};

  for (const [characterKey, characterState] of characterMap.entries()) {
    const variantData = {};
    const variantKeys = [];

    for (const [variantKey, variantState] of characterState.variants.entries()) {
      variantKeys.push(variantKey);
      variantData[variantKey] = {
        key: variantKey,
        files: toArray(variantState.files),
        baseSprites: toArray(variantState.baseSprites),
        neutralSprites: toArray(variantState.neutralSprites),
        emotions: toArray(variantState.emotions),
        rotations: toArray(variantState.rotations),
        capabilities: { ...variantState.capabilities },
        hasNeutral: variantState.neutralSprites.size > 0
      };
    }

    const firstNameKey = characterKey.split('_')[0] || characterKey;
    if (!lookupsByFirstName[firstNameKey]) lookupsByFirstName[firstNameKey] = [];
    lookupsByFirstName[firstNameKey].push(characterKey);

    for (const alias of characterState.aliases) {
      if (!alias) continue;
      if (!lookupsByAlias[alias]) lookupsByAlias[alias] = [];
      lookupsByAlias[alias].push(characterKey);
    }

    characters[characterKey] = {
      key: characterKey,
      firstNameKey,
      aliases: toArray(characterState.aliases),
      files: toArray(characterState.files),
      baseSprites: toArray(characterState.baseSprites),
      neutralSprites: toArray(characterState.neutralSprites),
      emotions: toArray(characterState.emotions),
      rotations: toArray(characterState.rotations),
      capabilities: { ...characterState.capabilities },
      variants: variantKeys,
      defaultVariant: variantKeys.includes('default')
        ? 'default'
        : (variantKeys.includes('neutral') ? 'neutral' : (variantKeys[0] || 'default')),
      hasNeutral: characterState.neutralSprites.size > 0,
      variantData
    };
  }

  const characterKeys = Object.keys(characters);
  const variantAwareCharacterCount = characterKeys.filter(key => {
    const variants = characters[key]?.variants || [];
    return variants.some(v => v !== 'default');
  }).length;
  const genericProfiles = {};
  for (const [profileKey, files] of genericProfileMap.entries()) {
    genericProfiles[profileKey] = {
      key: profileKey,
      files: naturalSortSprites(toArray(files))
    };
  }
  const genericProfileKeys = Object.keys(genericProfiles);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalSprites: allSprites.size,
      baseSpriteCount: baseSprites.size,
      neutralSpriteCount: neutralSprites.size,
      genericSpriteCount: genericSprites.size,
      genericProfileCount: genericProfileKeys.length,
      semanticGenericProfileCount: genericProfileKeys.filter(key => key !== 'generic').length,
      characterCount: characterKeys.length,
      variantAwareCharacterCount,
      hasRotationSprites: explicitRotationSprites.size > 0
    },
    global: {
      allSprites: toArray(allSprites),
      baseSprites: toArray(baseSprites),
      neutralSprites: toArray(neutralSprites),
      genericSprites: toArray(genericSprites),
      genericProfiles,
      iconSprites: toArray(iconSprites),
      referenceSprites: toArray(referenceSprites),
      ignoredSprites: toArray(ignoredSprites)
    },
    characters,
    lookups: {
      byFirstName: lookupsByFirstName,
      byAlias: lookupsByAlias
    }
  };
}


/**
 * Finds an exact match for a sprite based on normalized character name and emotion.
 * @param {string[]} sprites - An array of available sprite paths.
 * @param {string} normalizedChar - The normalized character name.
 * @param {string} emotion - The emotion state.
 * @returns {string|undefined} The matching sprite path, or undefined if not found.
 */
function findExactMatch(sprites, normalizedChar, emotion) {
  // Strategy 1: Look for a direct hit (e.g. sprites/dehya_neutral_front.webp)
  let match = sprites.find(sprite =>
    stripExtension(getFilename(sprite)).toLowerCase() === `${normalizedChar}_${emotion}`
  );

  // 2. Try _front suffix fallback (e.g., dehya_angry_front)
  if (!match) {
    match = sprites.find(sprite =>
      stripExtension(getFilename(sprite)).toLowerCase() === `${normalizedChar}_${emotion}_front`
    );
  }

  return match;
}

/**
 * Finds a sprite match based on the character's first name and emotion.
 * @param {string[]} sprites - An array of available sprite paths.
 * @param {string} firstName - The first name of the character.
 * @param {string} emotion - The emotion state.
 * @returns {string|undefined} The matching sprite path, or undefined if not found.
 */
function findFirstNameMatch(sprites, firstName, emotion) {
  // 1. Try exact base match (e.g., dehya_angry)
  let match = sprites.find(sprite =>
    stripExtension(getFilename(sprite)).toLowerCase() === `${firstName}_${emotion}`
  );

  // 2. Try _front suffix fallback (e.g., dehya_angry_front)
  if (!match) {
    match = sprites.find(sprite =>
      stripExtension(getFilename(sprite)).toLowerCase() === `${firstName}_${emotion}_front`
    );
  }

  return match;
}

/**
 * Finds a fuzzy match for a sprite based on normalized character name and emotion.
 * @param {string[]} sprites - An array of available sprite paths.
 * @param {string} normalizedChar - The normalized character name.
 * @param {string} emotion - The emotion state.
 * @returns {string|null} The matching sprite path, or null if not found.
 */
function findFuzzyCharacterMatch(sprites, normalizedChar, emotion) {
  // First, filter sprites that at least mention the character's name somewhere in the filename
  const charSprites = sprites.filter(sprite => {
    const filename = stripExtension(getFilename(sprite)).toLowerCase();
    return filename.includes(normalizedChar) && filename.includes(emotion);
  });

  if (charSprites.length === 0) return null;

  const matches = stringSimilarity.findBestMatch(
    normalizedChar,
    charSprites.map(s => stripExtension(getFilename(s)).replace(/_[\\w]+$/, ''))
  );

  if (matches.bestMatch.rating > FUZZY_MATCH_THRESHOLD) {
    return charSprites[matches.bestMatchIndex];
  }

  return null;
}

/**
 * Finds a sprite match based on emotion, then character name similarity.
 * @param {string[]} sprites - An array of available sprite paths.
 * @param {string} normalizedChar - The normalized character name.
 * @param {string} emotion - The emotion state.
 * @returns {string|null} The matching sprite path, or null if not found.
 */
function findEmotionMatch(sprites, normalizedChar, emotion) {
  // CRITICAL FIX: We must ensure the sprite actually belongs to the character!
  // Previous logic was too broad and would return the Scholar for Badi if Badi didn't have the emotion.
  const emotionSprites = sprites.filter(sprite => {
    const filename = stripExtension(getFilename(sprite)).toLowerCase();
    return filename.includes(normalizedChar) && filename.includes(emotion);
  });

  if (emotionSprites.length === 0) return null;

  const matches = stringSimilarity.findBestMatch(
    normalizedChar,
    emotionSprites.map(s => stripExtension(getFilename(s)))
  );

  if (matches.bestMatch.rating > 0.6) {
    return emotionSprites[matches.bestMatchIndex];
  }

  return null;
}

/**
 * Finds a neutral emotion sprite for a given character.
 * @param {string[]} sprites - An array of available sprite paths.
 * @param {string} normalizedChar - The normalized character name.
 * @param {string} firstName - The first name of the character.
 * @returns {string|undefined} The matching sprite path, or undefined if not found.
 */
function findCharacterNeutralMatch(sprites, normalizedChar, firstName) {
  return sprites.find(sprite => {
    const filename = stripExtension(getFilename(sprite)).toLowerCase();
    return (filename.includes(normalizedChar) || filename.includes(firstName)) &&
      filename.includes('neutral');
  });
}

/**
 * Finds a gender-based generic sprite if a confident gender can be guessed for the character.
 * @param {string[]} sprites - An array of available sprite paths.
 * @param {string} character - The character name.
 * @param {object} turnContext - The current turn context.
 * @returns {Promise<{image: string, gender: string}|null>} The matching sprite path and gender, or null if not found.
 */
async function findGenderBasedMatch(sprites, character, turnContext) {
  const genderGuesser = getGenderGuesser();
  if (!genderGuesser) return null;

  const result = await genderGuesser.guessGender(character.split(" ")[0], turnContext);
  Logger.log('SpriteFinder', 'Gender', `Gender guess for ${character}: ${result.guess} (conf: ${result.confidence.toFixed(2)})`);

  if (result.confidence > GENDER_CONFIDENCE_THRESHOLD && (result.guess === 'male' || result.guess === 'female')) {
    const gender = result.guess;
    const prefix = `generic_npc_${gender}`;

    // 1. Identify all matching variants for this gender (e.g. generic_npc_female, generic_npc_female_1, etc.)
    const candidates = sprites.filter(sprite => {
      const filename = stripExtension(getFilename(sprite)).toLowerCase();
      // Match exact prefix OR prefix with a numeric suffix (e.g. _1, _2)
      return filename === prefix || filename.startsWith(`${prefix}_`);
    });

    if (candidates.length > 0) {
      // 2. Sort naturally to ensure consistency (e.g. _2 before _10)
      candidates.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

      // 3. Pick deterministically based on character name
      const index = getDeterministicIndex(character, candidates.length);
      const image = candidates[index];

      Logger.log('SpriteFinder', 'Gender', `Selected generic variant ${index + 1}/${candidates.length} for ${character}: ${getFilename(image)}`);
      return { image, gender };
    }
  }

  return null;
}

function readGenericProfilePayload(registry, key) {
  if (!registry || !key) return null;
  const value = registry[key];
  if (typeof value === 'string') return { profileKey: normalizeVariantKey(value), source: 'payload' };
  if (value && typeof value === 'object') {
    return {
      profileKey: normalizeVariantKey(value.profileKey || value.profile || value.fact_value || value.value),
      source: value.source || 'payload'
    };
  }
  return null;
}

function getGenericProfilePayloadForCharacter(turnContext, candidateKeys = []) {
  const registry = turnContext?.processed?.vnManager?.genericSpriteProfiles;
  if (!registry || typeof registry !== 'object') return null;

  const lookupKeys = [];
  for (const key of candidateKeys) {
    if (typeof key !== 'string' || key.trim() === '') continue;
    lookupKeys.push(key.trim().toLowerCase());
    lookupKeys.push(normalizeText(key));
  }

  for (const key of [...new Set(lookupKeys)]) {
    const payload = readGenericProfilePayload(registry, key);
    if (payload?.profileKey) return payload;
  }

  return null;
}

function getGenericProfileCandidatesFromCatalog(turnContext, profileKey, poolSprites = []) {
  const profiles = turnContext?.runtime?.vnManager?.spriteCatalog?.global?.genericProfiles || {};
  const profileData = profiles[profileKey];
  if (!profileData || !Array.isArray(profileData.files) || profileData.files.length === 0) {
    return [];
  }

  const poolByNormalized = new Map();
  for (const sprite of poolSprites) {
    poolByNormalized.set(normalizeSpritePath(sprite).toLowerCase(), sprite);
  }

  const candidates = [];
  for (const file of profileData.files) {
    const normalized = normalizeSpritePath(file).toLowerCase();
    if (poolByNormalized.has(normalized)) {
      candidates.push(poolByNormalized.get(normalized));
    }
  }

  return naturalSortSprites(candidates);
}

function findProfileGenericMatch(sprites, character, turnContext, candidateKeys = []) {
  const payload = getGenericProfilePayloadForCharacter(turnContext, candidateKeys);
  if (!payload?.profileKey) return null;

  const candidates = getGenericProfileCandidatesFromCatalog(turnContext, payload.profileKey, sprites);
  if (candidates.length === 0) {
    Logger.warn('SpriteFinder', 'GenericProfile', `Generic sprite profile '${payload.profileKey}' for ${character} has no usable sprites in the current pool.`);
    return null;
  }

  const index = getDeterministicIndex(character, candidates.length);
  const image = candidates[index];
  Logger.log('SpriteFinder', 'GenericProfile', `Selected profile '${payload.profileKey}' variant ${index + 1}/${candidates.length} for ${character}: ${getFilename(image)}`);
  return { image, genericProfile: payload.profileKey };
}

/**
 * Finds a generic sprite (e.g., 'generic_npc') from the available sprites.
 * @param {string[]} sprites - An array of available sprite paths.
 * @returns {string|undefined} The matching sprite path, or undefined if not found.
 */
function findGenericMatch(sprites) {
  return sprites.find(sprite =>
    stripExtension(getFilename(sprite)).toLowerCase().includes('generic')
  );
}

// #endregion

// #region MAIN SPRITE FINDER
/**
 * Finds the most appropriate sprite for a character and emotion using a series of matching strategies.
 * @param {string} character - Character name.
 * @param {string} emotion - Emotion state.
 * @param {string[]} sprites - Available sprites (filtered base sprites for matching).
 * @param {string} mainCharacter - Main character name (to skip).
 * @param {object} turnContext - The current turn context.
 * @param {string[]} allSprites - All available sprites (unfiltered, for rotation scanning).
 * @param {number|null} dialogueIndex - 1-based dialogue index in current turn.
 * @returns {Promise<{image: string|null, gender: string|null, rotations: string[]}>} - Sprite path, gender, and available rotations.
 */
async function findSprite(character, emotion, sprites, mainCharacter, turnContext, allSprites, dialogueIndex = null) {
  const cleanCharacter = stripHonorifics(character);
  const characterNameLower = cleanCharacter.toLowerCase();

  // Lazy initialization of the Shared Gender Registry if it's empty or invalid
  if (!(turnContext.processed.characterGenders instanceof Map)) {
    Logger.warn('SpriteFinder', 'characterGenders is not a Map. Re-initializing.');
    turnContext.processed.characterGenders = new Map();
  }

  if (turnContext.processed.characterGenders.size === 0) {
    Logger.log('SpriteFinder', 'Initialization', 'Character Gender Registry is empty. Attempting lazy population from DB...');
    try {
      const projectName = turnContext.projectName;
      const genderFacts = await factManager.getLatestFactsByPredicate('HAS_GENDER', projectName);
      genderFacts.forEach(fact => {
        turnContext.processed.characterGenders.set(fact.source.toLowerCase(), fact.fact_value);
      });
      Logger.log('SpriteFinder', 'Initialization', `Lazy populated ${turnContext.processed.characterGenders.size} genders.`);
    } catch (error) {
      Logger.error('SpriteFinder', 'Initialization', 'Lazy population of gender registry failed:', error);
    }
  }

  const registeredGender = turnContext.processed.characterGenders.get(characterNameLower) || null;

  // Robustly check if the character is the main character or a meta-character (Narrator, System, etc.)
  const metaCharacters = ['narrator', 'system', 'player', 'user', 'protagonist', 'hero', 'main character'];
  if (mainCharacter && typeof mainCharacter === 'string' && mainCharacter.trim().length > 0) {
    metaCharacters.push(mainCharacter.trim().toLowerCase());
  }

  if (metaCharacters.includes(characterNameLower)) {
    return { image: null, gender: registeredGender, rotations: [] };
  }

  if (!cleanCharacter || cleanCharacter.trim() === '') {
    return { image: 'generic_npc.png', gender: registeredGender, rotations: [] };
  }

  const cleanEmotion = emotion ? emotion.replace(/^\d+\.\s*/, '').trim().toLowerCase() : '';
  const normalizedChar = normalizeText(cleanCharacter);
  const firstName = cleanCharacter.split(/\s+/)[0].toLowerCase();
  const characterFolderCandidates = [
    normalizedChar,
    normalizedChar.replace(/_/g, ''),
    normalizeText(firstName)
  ].filter(Boolean);

  const sceneVariantLock = getSceneVariantLock(turnContext, [cleanCharacter, normalizedChar, firstName], dialogueIndex);
  const safeAllSprites = Array.isArray(allSprites) && allSprites.length > 0 ? allSprites : sprites;

  let primarySprites = sprites;
  let primaryAllSprites = safeAllSprites;
  let usingVariantPool = false;

  if (sceneVariantLock) {
    const variantSprites = filterSpritesForVariant(sprites, characterFolderCandidates, sceneVariantLock);
    const variantAllSprites = filterSpritesForVariant(safeAllSprites, characterFolderCandidates, sceneVariantLock);

    if (variantSprites.length > 0) {
      primarySprites = variantSprites;
      primaryAllSprites = variantAllSprites.length > 0 ? variantAllSprites : variantSprites;
      usingVariantPool = true;
      Logger.log('SpriteFinder', 'Variant', `Using scene-locked variant '${sceneVariantLock}' for ${cleanCharacter}.`);
    } else {
      Logger.warn('SpriteFinder', 'Variant', `Variant lock '${sceneVariantLock}' has no sprites for ${cleanCharacter}. Falling back to default pool.`);
    }
  }

  const emotionCandidates = buildEmotionCandidates(cleanEmotion || 'neutral');

  const runMatchingStrategies = async (poolSprites, poolAllSprites) => {
    const executeStrategies = async (strategyList) => {
      for (const strategy of strategyList) {
        const result = await Promise.resolve(strategy.fn());
        if (!result) continue;

        const imagePath = typeof result === 'string' ? result : result.image;

        // Safeguard: ensure strategy did not return utility/animation-only assets.
        const filenameNoExt = stripExtension(getFilename(imagePath)).toLowerCase();
        if (imagePath && isUtilityOrAnimationSprite(filenameNoExt)) {
          Logger.warn('SpriteFinder', 'Matching', `Strategy '${strategy.name}' incorrectly returned a utility/animation sprite: ${getFilename(imagePath)}. Skipping.`);
          continue;
        }

        if (typeof result === 'string') {
          const rotations = getAvailableRotationsForImage(poolAllSprites || poolSprites, result);
          return { image: result, gender: registeredGender, rotations };
        }

        if (typeof result === 'object' && result.image) {
          return { image: result.image, gender: result.gender || registeredGender, rotations: [] };
        }
      }

      return null;
    };

    for (const emotionCandidate of emotionCandidates) {
      const emotionStrategies = [
        { name: `findExactMatch(${emotionCandidate})`, fn: () => findExactMatch(poolSprites, normalizedChar, emotionCandidate) },
        { name: `findFirstNameMatch(${emotionCandidate})`, fn: () => findFirstNameMatch(poolSprites, firstName, emotionCandidate) },
        { name: `findFuzzyCharacterMatch(${emotionCandidate})`, fn: () => findFuzzyCharacterMatch(poolSprites, normalizedChar, emotionCandidate) },
        { name: `findEmotionMatch(${emotionCandidate})`, fn: () => findEmotionMatch(poolSprites, normalizedChar, emotionCandidate) }
      ];

      const emotionResult = await executeStrategies(emotionStrategies);
      if (emotionResult) {
        if (emotionCandidate !== emotionCandidates[0]) {
          Logger.log('SpriteFinder', 'EmotionFallback', `Applied emotion fallback for ${cleanCharacter}: '${emotionCandidates[0]}' -> '${emotionCandidate}'.`);
        }
        return emotionResult;
      }
    }

    const fallbackStrategies = [
      { name: 'findCharacterNeutralMatch', fn: () => findCharacterNeutralMatch(poolSprites, normalizedChar, firstName) },
      { name: 'findProfileGenericMatch', fn: () => findProfileGenericMatch(poolSprites, cleanCharacter, turnContext, [characterNameLower, normalizedChar, firstName]) },
      { name: 'findGenderBasedMatch', fn: () => findGenderBasedMatch(poolSprites, cleanCharacter, turnContext) },
      { name: 'findGenericMatch', fn: () => findGenericMatch(poolSprites) }
    ];

    return await executeStrategies(fallbackStrategies);
  };

  const primaryResult = await runMatchingStrategies(primarySprites, primaryAllSprites);
  if (primaryResult) return primaryResult;

  // Lock-preserving degradation: if locked pool failed, keep outfit by selecting any base match in that pool.
  if (usingVariantPool) {
    const lockPreservingMatch = findAnyCharacterBaseMatch(primarySprites, normalizedChar, firstName);
    if (lockPreservingMatch) {
      const rotations = getAvailableRotationsForImage(primaryAllSprites || primarySprites, lockPreservingMatch);
      Logger.warn(
        'SpriteFinder',
        'Variant',
        `No exact emotion match in locked variant '${sceneVariantLock}' for ${cleanCharacter}. Keeping locked outfit with fallback sprite ${getFilename(lockPreservingMatch)}.`
      );
      return { image: lockPreservingMatch, gender: registeredGender, rotations };
    }

    // Absolute last resort.
    const fallbackResult = await runMatchingStrategies(sprites, safeAllSprites);
    if (fallbackResult) {
      Logger.warn(
        'SpriteFinder',
        'Variant',
        `Locked variant '${sceneVariantLock}' had no usable base sprite for ${cleanCharacter}. Falling back to global sprite pool.`
      );
      return fallbackResult;
    }
  }

  return { image: null, gender: registeredGender, rotations: [] };
}
// #endregion

// #region CATALOG UTILITIES
/**
 * Retrieves and builds a complete sprite catalog for the current project.
 * It will attempt to use the active turn context first, then fall back to scanning the project's assets/sprites directory.
 * @param {string} projectRoot - The absolute path to the project root directory.
 * @param {Object} [turnContext=null] - Optional. The current turn context to extract live runtime sprites from.
 * @returns {Promise<{catalog: Object|null, searchedDir: string}>}
 */
async function getProjectSpriteCatalog(projectRoot, turnContext = null) {
  let allSprites = [];
  const searchedDir = projectRoot ? path.join(projectRoot, 'assets', 'sprites') : 'None (projectRoot is null)';

  if (turnContext && turnContext.runtime?.assets?.sprites?.length > 0) {
    allSprites = [
      ...(turnContext.runtime.assets.sprites || []),
      ...(turnContext.runtime.assets.extraSprites || [])
    ].map(s => relativizeAssetPath(s, projectRoot));
  }

  if (allSprites.length === 0 && projectRoot) {
    if (fs.existsSync(searchedDir)) {
      const found = await listFilesRecursive(searchedDir, ['.webp', '.png', '.jpg', '.jpeg'], 0, 10);
      allSprites = found.map(s => relativizeAssetPath(s, projectRoot));
    }
  }

  if (allSprites.length === 0) {
    return { catalog: null, searchedDir };
  }

  const catalog = buildSpriteCatalog(allSprites);

  // Enhance catalog with specific emotion capabilities for UI rendering
  for (const charKey in catalog.characters) {
    const char = catalog.characters[charKey];
    char.isComplex = false;
    
    for (const variantKey in char.variantData) {
      const variant = char.variantData[variantKey];
      const emotionsMap = {};
      variant.hasIcon = false;
      variant.hasReference = false;

      for (const file of variant.files) {
        const sig = parseSpriteSignature(file);
        if (!sig) continue;

        if (sig.isIcon) variant.hasIcon = true;
        if (sig.isReference) variant.hasReference = true;

        const emo = sig.emotion || 'neutral';
        if (!emotionsMap[emo]) {
          emotionsMap[emo] = { F: false, R: false, L: false, B: false, I: false, R_ref: false, T: false, B_layer: false, TB: false };
        }

        if (sig.isIcon) emotionsMap[emo].I = true;
        else if (sig.isReference) emotionsMap[emo].R_ref = true;
        else {
          // If it has actual rotation or animation, it's complex
          if (sig.rotation || sig.animationLayer || sig.emotion) {
            char.isComplex = true;
          }
          
          const rot = sig.effectiveRotation;
          if (rot === 'front' || !rot) emotionsMap[emo].F = true;
          if (rot === 'right') emotionsMap[emo].R = true;
          if (rot === 'left') emotionsMap[emo].L = true;
          if (rot === 'back') emotionsMap[emo].B = true;

          if (sig.animationLayer === 'talk') emotionsMap[emo].T = true;
          if (sig.animationLayer === 'blink') emotionsMap[emo].B_layer = true;
          if (sig.animationLayer === 'talk_blink') emotionsMap[emo].TB = true;
        }
      }
      variant.emotionData = emotionsMap;
    }
  }

  return { catalog, searchedDir };
}
// #endregion

// #region EXPORTS
module.exports = { findSprite, stripHonorifics, buildSpriteCatalog, getProjectSpriteCatalog, getSceneVariantLock };
// #endregion

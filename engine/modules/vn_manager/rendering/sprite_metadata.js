// engine/modules/vn_manager/rendering/sprite_metadata.js

const fs = require('fs');
const path = require('path');
const { Logger } = require('../../utils.js');

const MIN_CHARACTER_SCALE = 0.1;
const MAX_CHARACTER_SCALE = 3.0;

function normalizeSpriteToken(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeGuidanceText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeCharacterScale(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(MIN_CHARACTER_SCALE, Math.min(MAX_CHARACTER_SCALE, parsed));
}

function mergeSpriteMetadataRegistry(targetRegistry, incomingRegistry) {
  if (!incomingRegistry || typeof incomingRegistry !== 'object') return;

  for (const [characterKey, incomingCharacter] of Object.entries(incomingRegistry.characters || {})) {
    if (!targetRegistry.characters[characterKey]) {
      targetRegistry.characters[characterKey] = {
        emotionGuidance: '',
        scale: null,
        variants: {}
      };
    }

    const targetCharacter = targetRegistry.characters[characterKey];
    if (incomingCharacter.emotionGuidance) {
      targetCharacter.emotionGuidance = incomingCharacter.emotionGuidance;
    }
    if (Number.isFinite(incomingCharacter.scale)) {
      targetCharacter.scale = incomingCharacter.scale;
    }

    for (const [variantKey, incomingVariant] of Object.entries(incomingCharacter.variants || {})) {
      if (!targetCharacter.variants[variantKey]) {
        targetCharacter.variants[variantKey] = { emotionGuidance: '' };
      }
      if (incomingVariant.emotionGuidance) {
        targetCharacter.variants[variantKey].emotionGuidance = incomingVariant.emotionGuidance;
      }
    }
  }
}

function extractSpriteMetadataRegistry(parsedMetadata) {
  if (!parsedMetadata || typeof parsedMetadata !== 'object' || Array.isArray(parsedMetadata)) {
    return null;
  }

  const extracted = {
    characters: {}
  };

  const rawCharacters = parsedMetadata.characters;
  if (!rawCharacters || typeof rawCharacters !== 'object' || Array.isArray(rawCharacters)) {
    return extracted;
  }

  for (const [rawCharacterKey, rawCharacterBlock] of Object.entries(rawCharacters)) {
    if (!rawCharacterBlock || typeof rawCharacterBlock !== 'object' || Array.isArray(rawCharacterBlock)) continue;

    const characterKey = normalizeSpriteToken(rawCharacterKey);
    if (!characterKey) continue;

    const characterEntry = extracted.characters[characterKey] || {
      emotionGuidance: '',
      scale: null,
      variants: {}
    };
    characterEntry.emotionGuidance = normalizeGuidanceText(
      rawCharacterBlock.emotionGuidance ||
      rawCharacterBlock.emotion_guidance ||
      rawCharacterBlock.guidance ||
      characterEntry.emotionGuidance
    );
    const characterScale = normalizeCharacterScale(rawCharacterBlock.scale);
    if (Number.isFinite(characterScale)) {
      characterEntry.scale = characterScale;
    }

    const rawVariants = rawCharacterBlock.variants;
    if (rawVariants && typeof rawVariants === 'object' && !Array.isArray(rawVariants)) {
      for (const [rawVariantKey, rawVariantBlock] of Object.entries(rawVariants)) {
        const variantKey = normalizeSpriteToken(rawVariantKey);
        if (!variantKey || !rawVariantBlock || typeof rawVariantBlock !== 'object' || Array.isArray(rawVariantBlock)) continue;

        if (!characterEntry.variants[variantKey]) {
          characterEntry.variants[variantKey] = { emotionGuidance: '' };
        }

        characterEntry.variants[variantKey].emotionGuidance = normalizeGuidanceText(
          rawVariantBlock.emotionGuidance ||
          rawVariantBlock.emotion_guidance ||
          rawVariantBlock.guidance ||
          characterEntry.variants[variantKey].emotionGuidance
        );
      }
    }

    extracted.characters[characterKey] = characterEntry;
  }

  return extracted;
}

function collectSpriteMetadataCandidateDirs(spritePaths = []) {
  const dirs = new Set();

  for (const spritePath of spritePaths) {
    if (typeof spritePath !== 'string' || !path.isAbsolute(spritePath)) continue;

    let current = path.dirname(spritePath);
    let guard = 0;

    while (current && guard < 20) {
      dirs.add(current);

      if (path.basename(current).toLowerCase() === 'sprites') break;

      const parent = path.dirname(current);
      if (!parent || parent === current) break;
      current = parent;
      guard++;
    }
  }

  return Array.from(dirs).sort((a, b) => {
    const depthA = a.split(/[\\/]+/).length;
    const depthB = b.split(/[\\/]+/).length;
    return depthA - depthB;
  });
}

function loadSpriteMetadataRegistry(spritePaths = []) {
  const mergedRegistry = {
    characters: {},
    sources: []
  };

  const candidateDirs = collectSpriteMetadataCandidateDirs(spritePaths);
  for (const dir of candidateDirs) {
    const metadataPath = path.join(dir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) continue;

    try {
      const raw = fs.readFileSync(metadataPath, 'utf8');
      const parsed = JSON.parse(raw);
      const extracted = extractSpriteMetadataRegistry(parsed);

      if (extracted) {
        mergeSpriteMetadataRegistry(mergedRegistry, extracted);
        mergedRegistry.sources.push(metadataPath);
      }
    } catch (error) {
      Logger.warn('VNManager', 'SpriteMetadata', `Failed to parse metadata.json in ${dir}: ${error.message}`);
    }
  }

  const hasCharacterMetadata = Object.values(mergedRegistry.characters).some(characterEntry => {
    const hasCharacterGuidance = typeof characterEntry?.emotionGuidance === 'string' && characterEntry.emotionGuidance.trim() !== '';
    const hasCharacterScale = Number.isFinite(characterEntry?.scale);
    const hasVariantMetadata = Object.values(characterEntry?.variants || {}).some(variantEntry => {
      const hasVariantGuidance = typeof variantEntry?.emotionGuidance === 'string' && variantEntry.emotionGuidance.trim() !== '';
      return hasVariantGuidance;
    });
    return hasCharacterGuidance || hasCharacterScale || hasVariantMetadata;
  });

  if (!hasCharacterMetadata) {
    return null;
  }

  return mergedRegistry;
}

module.exports = {
  normalizeSpriteToken,
  normalizeGuidanceText,
  normalizeCharacterScale,
  mergeSpriteMetadataRegistry,
  extractSpriteMetadataRegistry,
  collectSpriteMetadataCandidateDirs,
  loadSpriteMetadataRegistry
};

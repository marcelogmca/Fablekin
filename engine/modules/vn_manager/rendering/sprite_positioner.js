const { getFilename, stripExtension, normalizeText, Logger } = require('../../utils.js');
const path = require('path');

// #region MODULE IMPORTS
// #endregion

// #region CONSTANTS
const DEFAULT_MAX_SPRITE_SLOTS = 5;
const MAX_SPRITE_SLOTS = DEFAULT_MAX_SPRITE_SLOTS; // Backwards-compatible export for callers that only need the default.
const CAMEO_LINE_RATIO_THRESHOLD = 0.35;

/**
 * Generates a fill order that starts from the center and spirals outwards.
 */
function getFillOrder(max) {
  const center = Math.floor(max / 2);
  const order = [center];
  for (let i = 1; i <= Math.max(center, max - 1 - center); i++) {
    if (center - i >= 0) order.push(center - i);
    if (center + i < max) order.push(center + i);
  }
  return order;
}

function normalizeMaxSpriteSlots(value, fallback = DEFAULT_MAX_SPRITE_SLOTS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function getMaxSpriteSlotsFromSettings(settings, fallback = DEFAULT_MAX_SPRITE_SLOTS) {
  return normalizeMaxSpriteSlots(
    settings?.visual_novel?.settings?.visuals?.max_sprite_slots
      ?? settings?.visuals?.max_sprite_slots,
    fallback
  );
}
// #endregion

function isGenericSpritePath(spritePath) {
  if (!spritePath) return false;
  return stripExtension(getFilename(spritePath)).toLowerCase().includes('generic');
}

function normalizeMetadataScale(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

function getCharacterMetadataScale(character, spriteMetadata) {
  const characterKey = normalizeText(character || '');
  if (!characterKey) return 1;
  const scale = spriteMetadata?.characters?.[characterKey]?.scale;
  return normalizeMetadataScale(scale);
}

function getSpriteVisualIdentity(spriteOrPath) {
  const rawPath = typeof spriteOrPath === 'string'
    ? spriteOrPath
    : (spriteOrPath?.path || spriteOrPath?.image || '');
  if (!rawPath) return '';

  const normalizedPath = String(rawPath)
    .replace(/\\/g, '/')
    .split(/[?#]/)[0]
    .toLowerCase();
  const withoutExtension = normalizedPath.replace(/\.[^/.]+$/, '');
  return withoutExtension.replace(/_(?:talk_blink|talk|blink)$/i, '');
}

function normalizeActorAlias(actorName) {
  return typeof actorName === 'string' ? actorName.trim().toLowerCase() : '';
}

function addSpriteVisualAlias(sprite, actorName) {
  if (!sprite || typeof actorName !== 'string') return;
  const trimmed = actorName.trim();
  if (!trimmed) return;

  const existingAliases = Array.isArray(sprite.visualAliases) ? sprite.visualAliases : [];
  const seen = new Set(existingAliases.map(normalizeActorAlias).filter(Boolean));
  const ownCharacterKey = normalizeActorAlias(sprite.character);
  if (sprite.character && ownCharacterKey && !seen.has(ownCharacterKey)) {
    existingAliases.unshift(sprite.character);
    seen.add(ownCharacterKey);
  }

  const aliasKey = normalizeActorAlias(trimmed);
  if (aliasKey && !seen.has(aliasKey)) {
    existingAliases.push(trimmed);
  }

  sprite.visualAliases = existingAliases.filter(alias => typeof alias === 'string' && alias.trim());
}

function suppressDuplicateSpriteVisuals(sprites) {
  if (!Array.isArray(sprites) || sprites.length === 0) return sprites;

  const seen = new Map();
  return sprites.map(sprite => {
    if (!sprite) return sprite;
    const visualIdentity = getSpriteVisualIdentity(sprite);
    if (!visualIdentity) return sprite;
    const existingSprite = seen.get(visualIdentity);
    if (existingSprite) {
      addSpriteVisualAlias(existingSprite, sprite.character);
      if (Array.isArray(sprite.visualAliases)) {
        for (const alias of sprite.visualAliases) addSpriteVisualAlias(existingSprite, alias);
      }
      return null;
    }
    seen.set(visualIdentity, sprite);
    return sprite;
  });
}

function spriteRepresentsCharacter(sprite, characterLower) {
  const targetCharacter = normalizeActorAlias(characterLower);
  if (!sprite || !targetCharacter) return false;
  if (normalizeActorAlias(sprite.character) === targetCharacter) return true;
  return Array.isArray(sprite.visualAliases)
    && sprite.visualAliases.some(alias => normalizeActorAlias(alias) === targetCharacter);
}

function findSpriteRepresentingCharacter(sprites, characterLower) {
  const targetCharacter = normalizeActorAlias(characterLower);
  if (!Array.isArray(sprites) || !targetCharacter) return null;
  return sprites.find(sprite => spriteRepresentsCharacter(sprite, targetCharacter)) || null;
}

// #region ACTION DETERMINATION
/**
 * Determines the action to be performed based on a command object.
 * @param {object} cmd - The command object.
 * @returns {string} The action to perform ('hide', 'show', or empty string).
 */
function determineAction(cmd) {
  if (cmd.line) {
    const trimmed = cmd.line.trim().toLowerCase();
    if (trimmed.startsWith('hide ')) return 'hide';
    if (trimmed.includes('cast:flush')) return 'flush';
  }
  if (cmd.image) {
    return 'show';
  }
  return '';
}
// #endregion

// #region POSITION MANAGEMENT
/**
 * Finds the best position to replace when all positions are occupied.
 * It prioritizes positions with characters that have lower 'heat' (appeared less recently/frequently).
 * @param {object} positions - The current sprite positions (left, center, right).
 * @param {object} characterHeat - An object tracking character appearance frequency.
 * @returns {string} The position to replace ('left', 'center', or 'right').
 */
function findReplacementPosition(positions, characterHeat, replaceOrder) {
  const candidates = positions
    .map((data, idx) => ({
      idx,
      data,
      heat: data ? (characterHeat[data.character.toLowerCase()] || 0) : -1,
      replacePriority: replaceOrder.indexOf(idx)
    }))
    .filter(c => c.data !== null) // Only consider occupied slots for replacement
    .sort((a, b) => a.heat - b.heat || a.replacePriority - b.replacePriority);

  return candidates.length > 0 ? candidates[0].idx : replaceOrder[0];
}

/**
 * Handles the logic for showing a sprite, placing it in an available position or replacing an existing one.
 * @param {string} character - The unique name of the character.
 * @param {string} image - The image path of the sprite to show.
 * @param {Array} availableRotations - List of available rotation keywords for this sprite.
 * @param {object} positions - The current sprite positions (left, center, right).
 * @param {object} characterHeat - An object tracking character appearance frequency.
 * @param {object} characterPositions - An object mapping characters to their current positions.
 * @returns {object} The updated sprite positions.
 */
function handleShowAction(character, image, availableRotations, positions, characterHeat, characterPositions, metadataScale = 1, fillOrder = [], replaceOrder = []) {
  if (!character) return positions;
  
  const charKey = character.toLowerCase();
  characterHeat[charKey] = (characterHeat[charKey] || 0) + 1;
  
  if (characterPositions[charKey] !== undefined) {
    const currentIdx = characterPositions[charKey];
    if (image) {
      positions[currentIdx] = { character, image, availableRotations, metadataScale: normalizeMetadataScale(metadataScale) };
    } else {
      if (positions[currentIdx] && positions[currentIdx].character.toLowerCase() !== charKey) {
        positions[currentIdx] = null;
      }
    }
  } else if (image) {
    const emptyIdx = fillOrder.find(idx => positions[idx] === null);
    if (emptyIdx !== undefined) {
      positions[emptyIdx] = { character, image, availableRotations, metadataScale: normalizeMetadataScale(metadataScale) };
      characterPositions[charKey] = emptyIdx;
    } else {
      const replaceIdx = findReplacementPosition(positions, characterHeat, replaceOrder);
      const oldCharData = positions[replaceIdx];
      if(oldCharData) {
          delete characterPositions[oldCharData.character.toLowerCase()];
      }
      positions[replaceIdx] = { character, image, availableRotations, metadataScale: normalizeMetadataScale(metadataScale) };
      characterPositions[charKey] = replaceIdx;
    }
  }

  return positions;
}

/**
 * Handles the logic for hiding a sprite from the scene.
 * @param {string} character - The unique name of the character to hide.
 * @param {object} positions - The current sprite positions (left, center, right).
 * @param {object} characterPositions - An object mapping characters to their current positions.
 * @returns {object} The updated sprite positions.
 */
function handleHideAction(character, positions, characterPositions) {
  if (!character) return positions;

  const charKey = character.toLowerCase();
  if (characterPositions[charKey] !== undefined) {
    const idx = characterPositions[charKey];
    if (positions[idx] && positions[idx].character.toLowerCase() === charKey) {
      positions[idx] = null;
    }
    delete characterPositions[charKey];
  }
  return positions;
}
// #endregion

// #region CORE SPRITE POSITION COMPUTATION
/**
 * Computes sprite positions for all commands in a sequence.
 * @param {Array} commands - Array of command objects.
 * @param {Array<string>} allSprites - The complete, unfiltered list of all available sprite files.
 * @returns {Array} - Commands with detailed sprite positioning information.
 */
function computeSpritePositions(commands, allSprites = [], options = {}) {
  const maxSpriteSlots = normalizeMaxSpriteSlots(options?.maxSpriteSlots);
  const positionFillOrder = getFillOrder(maxSpriteSlots);
  const positionReplaceOrder = [...Array(maxSpriteSlots).keys()];
  let positions = new Array(maxSpriteSlots).fill(null);
  const characterHeat = {}; 
  const characterPositions = {}; 
  const spriteMetadata = options?.spriteMetadata || null;

  const allSpritesSet = new Set(allSprites); // Use a Set for faster lookups

  // --- PRE-ANALYSIS: Identify characters who should leave early or temporarily ---
  const dialogueLines = commands.filter(cmd => cmd.type === 'dialogue');
  const totalDialogueCount = dialogueLines.length;
  
  // Dynamic thresholds: Don't hide for tiny gaps
  const leaveEarlyThreshold = totalDialogueCount * 0.6; // If last line < 60%, leave forever
  const gapThreshold = Math.max(8, totalDialogueCount * 0.3);        // If silent for > 30% (min 8 lines), leave temporarily

  // Map relative dialogue indices to absolute command indices for efficient lookup
  const dialogueIdxToAbsIdx = [];
  commands.forEach((cmd, idx) => {
    if (cmd.type === 'dialogue') dialogueIdxToAbsIdx.push(idx);
  });

  // 1. Map every speaking instance for every character
  const speakingOccurrences = {}; // character -> [dialogueIndex1, dialogueIndex2, ...]
  dialogueLines.forEach((cmd, idx) => {
    if (cmd.character) {
      const char = cmd.character.toLowerCase();
      if (!speakingOccurrences[char]) speakingOccurrences[char] = [];
      speakingOccurrences[char].push(idx);
    }
  });

  const autoHideTriggers = new Set(); // strings: "absCommandIndex_characterName"
  const mostCommonLineCount = Math.max(0, ...Object.values(speakingOccurrences).map(indices => indices.length));
  
  Object.entries(speakingOccurrences).forEach(([char, indices]) => {
    // A. Check for Temporary Gaps
    for (let i = 0; i < indices.length - 1; i++) {
        const currentIdx = indices[i];
        const nextIdx = indices[i + 1];
        const gap = nextIdx - currentIdx;

        if (gap >= gapThreshold) {
            // Use +1 to ensure they stay for the line they just spoke!
            const absIndex = dialogueIdxToAbsIdx[currentIdx] + 1;
            autoHideTriggers.add(`${absIndex}_${char}`);
            Logger.log('SpritePositioner', 'AutoLeave', `Character '${char}' marked for GAP-EXIT after command ${absIndex} (Gap of ${gap} lines)`);
        }
    }

    // B. Cameo characters should leave immediately after their final line.
    // This prevents one-off late-turn NPCs from lingering through the finale.
    const lineRatio = mostCommonLineCount > 0 ? indices.length / mostCommonLineCount : 1;
    if (lineRatio <= CAMEO_LINE_RATIO_THRESHOLD) {
        const lastIdx = indices[indices.length - 1];
        const absIndex = dialogueIdxToAbsIdx[lastIdx] + 1;
        if (absIndex < commands.length) {
            autoHideTriggers.add(`${absIndex}_${char}`);
            Logger.log('SpritePositioner', 'AutoLeave', `Character '${char}' marked for CAMEO-EXIT after command ${absIndex} (${indices.length}/${mostCommonLineCount} voice lines)`);
        }
    }

    // C. Check for Early Permanent Exit
    const lastIdx = indices[indices.length - 1];
    if (lastIdx < leaveEarlyThreshold) {
        // Use +2 as a linger buffer. If that would land past the turn, keep
        // the sprite visible through the final frame instead of hiding it early.
        const absIndex = dialogueIdxToAbsIdx[lastIdx] + 2;
        if (absIndex >= commands.length) return;
        autoHideTriggers.add(`${absIndex}_${char}`);
        Logger.log('SpritePositioner', 'AutoLeave', `Character '${char}' marked for PERMANENT-EXIT after command ${absIndex} (Dialogue ${lastIdx}/${totalDialogueCount})`);
    }
  });
  // -----------------------------------------------------------------

  const result = commands.map((cmd, index) => {
    const newPositions = [...positions]; 
    const action = determineAction(cmd);
    
    // If it's a dialogue line, we always want to handle the show action even if image is null
    // to ensure the heat map and characterPositions map stay updated.
    if (cmd.type === 'dialogue') {
      handleShowAction(
        cmd.character,
        cmd.image,
        cmd.availableRotations || [],
        newPositions,
        characterHeat,
        characterPositions,
        cmd.metadataScale ?? getCharacterMetadataScale(cmd.character, spriteMetadata),
        positionFillOrder,
        positionReplaceOrder
      );
    } else if (cmd.image && action === 'show') {
      handleShowAction(
        cmd.character,
        cmd.image,
        cmd.availableRotations || [],
        newPositions,
        characterHeat,
        characterPositions,
        cmd.metadataScale ?? getCharacterMetadataScale(cmd.character, spriteMetadata),
        positionFillOrder,
        positionReplaceOrder
      );
    } else if (action === 'hide') {
      handleHideAction(cmd.character || cmd.image, newPositions, characterPositions);
    } else if (action === 'flush') {
      newPositions.fill(null);
      // Clear the map of character positions
      Object.keys(characterPositions).forEach(char => delete characterPositions[char]);
      Logger.log('SpritePositioner', 'Action', `Scene flushed by 'cast:flush' at command ${index}`);
    }

    // --- AUTO-LEAVE CHECK ---
    Object.keys(characterPositions).forEach(char => {
        if (autoHideTriggers.has(`${index}_${char.toLowerCase()}`)) {
            handleHideAction(char, newPositions, characterPositions);
        }
    });
    // ------------------------

    // Update the main positions state for the next iteration
    positions = newPositions;

    // Build the new, detailed sprites array
    const finalSpritesArray = positions.map((spriteData, idx) => {
      if (spriteData && spriteData.image) {
        const ext = path.extname(spriteData.image);
        const basePath = spriteData.image.slice(0, -ext.length);
        const normalizedBasePath = basePath.replace(/\\/g, '/'); 

        const blinkCheck = `${normalizedBasePath}_blink${ext}`;
        const hasBlink = allSpritesSet.has(blinkCheck);
        if (!hasBlink) {
          // Log the failing check and a few set entries that contain the character name
          const charWord = spriteData.character.toLowerCase();
          void [...allSpritesSet].filter(s => s.toLowerCase().includes(charWord)).slice(0, 5);
        }

        return {
          character: spriteData.character,
          path: spriteData.image,
          slot: idx, // Include original slot index for stability
          metadataScale: normalizeMetadataScale(spriteData.metadataScale),
          availableRotations: spriteData.availableRotations || [],
          hasBlink: hasBlink,
          hasTalk: allSpritesSet.has(`${normalizedBasePath}_talk${ext}`),
          hasTalkBlink: allSpritesSet.has(`${normalizedBasePath}_talk_blink${ext}`)
        };
      }
      return null;
    });

    return {
      ...cmd,
      sprites: suppressDuplicateSpriteVisuals(finalSpritesArray)
    };
  });
  
  return result.filter(cmd => {
    const trimmed = cmd.line.trim().toLowerCase();
    return !trimmed.startsWith('hide ') && !trimmed.includes('cast:flush');
  });
}
// #endregion

/**
 * Applies rotation logic to the final sequence based on the Gaze Director LLM instructions.
 * @param {Array} sequence - The final turn sequence with sprites and slots.
 * @param {Array} focusInstructions - Array from LLM: [{ line: 2, commands: ["focus:away"] }, ...]
 * @param {string} playerCharacterName - Name of the player character (off-screen).
 * @param {Set} allSpritesSet - A Set of all available sprite paths for flag recomputation.
 */
function applyRotationLogic(sequence, focusInstructions, playerCharacterName, allSpritesSet) {
  const playerLower = (playerCharacterName || 'player').toLowerCase();
  
  // Detect if player speaks in this sequence
  const playerIsPresentInDialogue = sequence.some(cmd => cmd.type === 'dialogue' && (cmd.character || '').toLowerCase() === playerLower);

  
  // Convert LLM output into an easy-to-read Map: { lineIndex: ["focus:...", "look:..."] }
  // Build active commands map
  const activeCommands = new Map();
  if (Array.isArray(focusInstructions)) {
    Logger.log('SpritePositioner', 'Gaze', `Received ${focusInstructions.length} focus instructions from LLM.`);
    focusInstructions.forEach(inst => {
      // Handle both 1-indexed (from LLM) and 0-indexed formats just in case
      let lineIdx = inst.line;
      if (typeof lineIdx === 'string') lineIdx = parseInt(lineIdx, 10);
      if (isNaN(lineIdx)) return;
      
      // Assume 1-indexed from prompt, convert to 0-indexed for array access
      const zeroIndexed = Math.max(0, lineIdx - 1);
      activeCommands.set(zeroIndexed, inst.commands || []);
      Logger.log('SpritePositioner', 'Gaze', `Line ${lineIdx} (idx ${zeroIndexed}) commands: ${JSON.stringify(inst.commands)}`);
    });
  } else {
    Logger.warn('SpritePositioner', 'Gaze', 'focusInstructions is not an array.');
  }

  // --- STATE VARIABLES ---
  let groupFocus = { target: 'auto', untilLine: Infinity }; 
  let activeOverrides = {}; // Format: { "dehya": { target: "candace", untilLine: 15 } }
  let dialogueLineIndex = 0; 
  let lastOnScreenSpeakerLower = null;
  let previousSpeaker = null; // Track who spoke BEFORE the current speaker
  // Track the last rotation applied to each character, so non-dialogue lines can inherit it

  const lastComputedRotations = {};

  for (let i = 0; i < sequence.length; i++) {
    const cmd = sequence[i];

    // For non-dialogue lines that still have sprites (narrative, empty, etc.),
    // apply the last known rotations without advancing the gaze state machine.
    if (cmd.type !== 'dialogue') {
      if (cmd.sprites && Object.keys(lastComputedRotations).length > 0) {
        for (const sprite of cmd.sprites) {
          if (!sprite || !sprite.character) continue;
          const spriteCharLower = sprite.character.toLowerCase();
          if (isGenericSpritePath(sprite.path)) continue;

          const lastRotation = lastComputedRotations[spriteCharLower];
          if (lastRotation) {
            const ext = path.extname(sprite.path);
            let cleanPath = sprite.path.slice(0, -ext.length);
            const suffixes = ['_front', '_left', '_right', '_back'];
            for (const s of suffixes) {
              if (cleanPath.toLowerCase().endsWith(s)) { cleanPath = cleanPath.slice(0, -s.length); break; }
            }
            sprite.path = `${cleanPath}_${lastRotation}${ext}`;
            if (allSpritesSet) {
              const newBasePath = sprite.path.slice(0, -ext.length).replace(/\\/g, '/');
              sprite.hasBlink = allSpritesSet.has(`${newBasePath}_blink${ext}`);
              sprite.hasTalk = allSpritesSet.has(`${newBasePath}_talk${ext}`);
              sprite.hasTalkBlink = allSpritesSet.has(`${newBasePath}_talk_blink${ext}`);
            }
          }
        }
      }
      continue;
    }

    dialogueLineIndex++;
    const speakerLower = (cmd.character || '').toLowerCase();
    const isNarrator = speakerLower === 'narrator' || speakerLower === 'system' || speakerLower === '' || speakerLower === playerLower;

    // Track the last actual character who spoke, to preserve gaze during narrator lines
    if (!isNarrator) {
      if (lastOnScreenSpeakerLower && lastOnScreenSpeakerLower !== speakerLower) {
        previousSpeaker = lastOnScreenSpeakerLower;
      }
      lastOnScreenSpeakerLower = speakerLower;
    }


    // 1. CLEAN UP EXPIRED STATES
    // Group Focus Expiration
    if (dialogueLineIndex > groupFocus.untilLine) {
       groupFocus = { target: 'auto', untilLine: Infinity };
    }
    // Individual Override Expiration
    for (const char in activeOverrides) {
      const untilIdx = activeOverrides[char].untilLine - 1;
      if (dialogueLineIndex > untilIdx) {
        delete activeOverrides[char];
      }
    }

    // 2. PROCESS NEW INSTRUCTIONS FOR THIS LINE
    const currentCommands = activeCommands.get(dialogueLineIndex) || [];
    for (const commandStr of currentCommands) {
      const parts = commandStr.split(':');
      const action = parts[0];

      if (action === 'focus' && parts[1]) {
        const target = parts[1].toLowerCase();
        // focus:auto has no untilLine. Others should.
        const untilLine = parts[2] ? parseInt(parts[2], 10) - 1 : Infinity;
        groupFocus = { target: target, untilLine: untilLine };
      } 
      else if (action === 'look' && parts.length >= 4) {
        // look:<character>:<target>:<until_line>
        const charName = parts[1].toLowerCase();
        const targetName = parts[2].toLowerCase();
        const untilLine = parseInt(parts[3], 10);
        
        if (!isNaN(untilLine)) {
          activeOverrides[charName] = { target: targetName, untilLine: untilLine };
        }
      }
    }

    // 3. CALCULATE ROTATION FOR EVERY SPRITE ON SCREEN
    for (const sprite of cmd.sprites) {
      if (!sprite || !sprite.character) continue;

      const spriteCharLower = sprite.character.toLowerCase();
      let intendedTarget = '';

      // A. Determine Intended Target (Override > Group Focus)
      if (activeOverrides[spriteCharLower]) {
        intendedTarget = activeOverrides[spriteCharLower].target;
      } else {
        intendedTarget = groupFocus.target;
      }
      

      // B. Resolve Target to Rotation
      let rotation = 'front';
      if (intendedTarget === 'player') {
        rotation = 'front';
      } else if (intendedTarget === 'away') {
        rotation = 'back';
      } else if (intendedTarget === 'auto') {
        const effectiveSpeaker = isNarrator ? lastOnScreenSpeakerLower : speakerLower;

        if (!effectiveSpeaker) {
          rotation = 'front'; // First line is narrator, no previous speaker
        } else if (spriteCharLower === effectiveSpeaker) {
          // If the player isn't part of the conversation, try to look at the previous speaker
          if (!playerIsPresentInDialogue && previousSpeaker && previousSpeaker !== speakerLower) {
            const targetSprite = findSpriteRepresentingCharacter(cmd.sprites, previousSpeaker);
            if (targetSprite) {
              if (targetSprite.slot < sprite.slot) rotation = 'left';
              else if (targetSprite.slot > sprite.slot) rotation = 'right';
              else rotation = 'front';
            } else {
              rotation = 'front';
            }
          } else {
            rotation = 'front'; // Speaker looks at camera
          }
        } else {

          // In auto mode, listeners look at the effective speaker
          const targetSprite = findSpriteRepresentingCharacter(cmd.sprites, effectiveSpeaker);
          if (!targetSprite) {
             rotation = 'front'; // Speaker not on screen, fallback
          } else {
            if (targetSprite.slot < sprite.slot) rotation = 'left';
            else if (targetSprite.slot > sprite.slot) rotation = 'right';
          }
        }
      } else {
        // Explicit character target
        if (intendedTarget === spriteCharLower) {
          rotation = 'front'; // Looking at self -> look at camera
        } else {
          // Find target on screen
          const targetSprite = findSpriteRepresentingCharacter(cmd.sprites, intendedTarget);
          if (!targetSprite) {
            rotation = 'front'; 
          } else {
            // Compare slots: lower index is "Left", higher is "Right"
            if (targetSprite.slot < sprite.slot) {
              rotation = 'left';  // Target is to my left
            } else if (targetSprite.slot > sprite.slot) {
              rotation = 'right'; // Target is to my right
            }
          }
        }
      }


      // 4. APPLY ROTATION TO SPRITE PATH
      // Skip rotation for generic NPCs as they only have 3 base files
      if (isGenericSpritePath(sprite.path)) {
        continue;
      }

      // Safety check: Does this character actually have this angle asset?
      const availableRotations = cmd.availableRotations || sprite.availableRotations || [];
      if (rotation !== 'front' && !availableRotations.includes(rotation)) {
         rotation = 'front'; // Fallback if asset is missing
      }

      // Clean the path of existing suffixes
      const ext = path.extname(sprite.path);
      let cleanPath = sprite.path.slice(0, -ext.length);
      const suffixes = ['_front', '_left', '_right', '_back'];
      
      for (const s of suffixes) {
        if (cleanPath.toLowerCase().endsWith(s)) {
          cleanPath = cleanPath.slice(0, -s.length);
          break;
        }
      }

      // Append the new rotation suffix (even if it's _front, to ensure correctness)
      sprite.path = `${cleanPath}_${rotation}${ext}`;

      // Store the computed rotation for this character so non-dialogue lines can inherit it
      lastComputedRotations[spriteCharLower] = rotation;

      // 5. RECOMPUTE ANIMATION FLAGS FOR THE NEW PATH
      // This is critical because dehya_happy_front needs dehya_happy_front_blink.webp
      if (allSpritesSet) {
        const newBasePath = sprite.path.slice(0, -ext.length);
        const normalizedNewBasePath = newBasePath.replace(/\\/g, '/');
        
        sprite.hasBlink = allSpritesSet.has(`${normalizedNewBasePath}_blink${ext}`);
        sprite.hasTalk = allSpritesSet.has(`${normalizedNewBasePath}_talk${ext}`);
        sprite.hasTalkBlink = allSpritesSet.has(`${normalizedNewBasePath}_talk_blink${ext}`);
      }
    }
  }
}

// #endregion

// #region EXPORTS
module.exports = {
  DEFAULT_MAX_SPRITE_SLOTS,
  MAX_SPRITE_SLOTS,
  normalizeMaxSpriteSlots,
  getMaxSpriteSlotsFromSettings,
  getSpriteVisualIdentity,
  suppressDuplicateSpriteVisuals,
  spriteRepresentsCharacter,
  findSpriteRepresentingCharacter,
  computeSpritePositions,
  applyRotationLogic
};
// #endregion

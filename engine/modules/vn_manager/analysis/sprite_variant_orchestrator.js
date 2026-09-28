const { Logger, TurnLogger, settings, readFileSync, normalizeText } = require('../../utils.js');
const { callLLM } = require('../../llm.js');
const { buildCoreVnPreparedPrompt } = require('../shared_llm_context.js');

const CONFIG = {
  ENABLED: settings.narrative_agents?.sprite_variant_orchestrator?.enabled !== false,
  MODEL: settings.narrative_agents?.sprite_variant_orchestrator?.model ||
    settings.narrative_agents?.gaze_director?.model ||
    'highendmodel',
  PROVIDER: settings.narrative_agents?.sprite_variant_orchestrator?.provider ||
    settings.narrative_agents?.gaze_director?.provider,
  PROMPT_PATH: 'engine/prompts/sprite_variant_orchestrator_instructions.txt',
  RETRIES: settings.narrative_agents?.sprite_variant_orchestrator?.retries ||
    settings.narrative_agents?.gaze_director?.retries ||
    3,
  TIMEOUT: settings.narrative_agents?.sprite_variant_orchestrator?.timeout ||
    settings.narrative_agents?.gaze_director?.timeout ||
    120000
};

function normalizeVariantKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function readVariantLockValue(lockRegistry, key) {
  if (!lockRegistry || !key) return undefined;
  if (lockRegistry instanceof Map) return lockRegistry.get(key);
  return lockRegistry[key];
}

function buildCharacterKeyCandidates(candidateCharacterKeys = []) {
  const keyCandidates = [];
  for (const key of candidateCharacterKeys) {
    if (typeof key !== 'string' || key.trim() === '') continue;
    const normalized = normalizeText(key);
    const compact = normalized.replace(/_/g, '');
    keyCandidates.push(key);
    keyCandidates.push(normalized);
    keyCandidates.push(compact);
  }
  return [...new Set(keyCandidates)];
}

function resolveCharacterKeyFromCatalog(rawName, spriteCatalog) {
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
    if (Array.isArray(aliasMatches) && aliasMatches.length > 0) {
      return aliasMatches[0];
    }
    const firstNameMatches = lookups.byFirstName?.[candidate];
    if (Array.isArray(firstNameMatches) && firstNameMatches.length > 0) {
      return firstNameMatches[0];
    }
  }

  return '';
}

function getDialogueLines(turnContext) {
  return (turnContext?.processed?.dialogueProcessor?.processedLines || [])
    .filter(line => line?.type === 'dialogue' && typeof line.character === 'string' && line.character.trim() !== '');
}

function buildSceneVariantEntries(dialogueLines, spriteCatalog) {
  const entries = [];
  const seenCharacterKeys = new Set();

  for (const line of dialogueLines) {
    const displayName = (line.character || '').trim();
    if (!displayName) continue;

    const characterKey = resolveCharacterKeyFromCatalog(displayName, spriteCatalog);
    if (!characterKey || seenCharacterKeys.has(characterKey)) continue;

    const characterState = spriteCatalog?.characters?.[characterKey];
    if (!characterState) continue;

    const variants = Array.isArray(characterState.variants)
      ? characterState.variants.map(normalizeVariantKey).filter(Boolean)
      : [];

    // We only orchestrate characters that actually expose non-default choices.
    const hasVariantChoice = variants.some(variant => variant !== 'default');
    if (!hasVariantChoice) continue;

    const defaultVariant = normalizeVariantKey(characterState.defaultVariant || 'default') || 'default';
    entries.push({
      displayName,
      characterKey,
      variants,
      variantSet: new Set(variants),
      defaultVariant
    });
    seenCharacterKeys.add(characterKey);
  }

  return entries;
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

function resolveVariantForSceneEntry(rawVariant, sceneEntry, { allowClear = false } = {}) {
  if (!sceneEntry) return null;

  if (rawVariant == null) {
    return allowClear ? null : null;
  }

  if (typeof rawVariant !== 'string') return null;

  const trimmed = rawVariant.trim();
  if (!trimmed) {
    return allowClear ? null : null;
  }

  const normalized = normalizeVariantKey(trimmed);
  if (normalized === 'default') {
    if (sceneEntry.variantSet.has(sceneEntry.defaultVariant)) return sceneEntry.defaultVariant;
    if (sceneEntry.variantSet.has('default')) return 'default';
    return sceneEntry.variants[0] || sceneEntry.defaultVariant || 'default';
  }

  if (sceneEntry.variantSet.has(normalized)) {
    return normalized;
  }

  return null;
}

function resolveFinalPreviousVariant(vnManagerState, sceneEntry) {
  if (!sceneEntry) return 'default';

  const keyCandidates = buildCharacterKeyCandidates([sceneEntry.characterKey, sceneEntry.displayName]);
  const keySet = new Set(keyCandidates);
  const lockRegistry = vnManagerState?.spriteVariantLocks;
  const lockSchedule = Array.isArray(vnManagerState?.spriteVariantLockSchedule)
    ? vnManagerState.spriteVariantLockSchedule
    : [];

  let winner = null;
  lockSchedule.forEach((entry, scheduleOrder) => {
    const entryDialogue = extractScheduleDialogueIndex(entry);
    if (entryDialogue == null) return;

    const entryCharacterKey = extractScheduleCharacterKey(entry);
    if (!entryCharacterKey) return;

    const entryKeyCandidates = buildCharacterKeyCandidates([entryCharacterKey]);
    const matchesCharacter = entryKeyCandidates.some(key => keySet.has(key));
    if (!matchesCharacter) return;

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
    const scheduleVariant = resolveVariantForSceneEntry(winner.variant, sceneEntry, { allowClear: true });
    if (scheduleVariant) return scheduleVariant;
    return 'default';
  }

  for (const key of keyCandidates) {
    const value = readVariantLockValue(lockRegistry, key);
    const resolved = resolveVariantForSceneEntry(value, sceneEntry, { allowClear: false });
    if (resolved) return resolved;
  }

  return 'default';
}

async function getLastVariantsByCharacter(turnContext, sceneEntries) {
  const lastVariants = {};
  for (const entry of sceneEntries) {
    lastVariants[entry.characterKey] = 'default';
  }

  if (sceneEntries.length === 0 || typeof turnContext?.getPreviousChapter !== 'function') {
    return lastVariants;
  }

  try {
    const previousTurn = await turnContext.getPreviousChapter();
    if (!previousTurn) return lastVariants;

    if (typeof previousTurn.ensureFull === 'function') {
      await previousTurn.ensureFull();
    }

    const vnManagerState = previousTurn.processed?.vnManager || {};
    for (const entry of sceneEntries) {
      lastVariants[entry.characterKey] = resolveFinalPreviousVariant(vnManagerState, entry);
    }
  } catch (error) {
    Logger.warn('SpriteVariantOrchestrator', 'History', `Failed to retrieve previous turn variant state: ${error.message}`);
  }

  return lastVariants;
}

function buildSceneEntryResolver(sceneEntries) {
  const lookup = new Map();

  for (const entry of sceneEntries) {
    const firstName = normalizeText(entry.displayName.split(/\s+/)[0] || '');
    const candidates = buildCharacterKeyCandidates([entry.characterKey, entry.displayName, firstName]);
    for (const candidate of candidates) {
      if (!lookup.has(candidate)) lookup.set(candidate, entry);
    }
  }

  return {
    resolve(rawCharacter) {
      if (typeof rawCharacter !== 'string' || rawCharacter.trim() === '') return null;
      const firstName = normalizeText(rawCharacter.split(/\s+/)[0] || '');
      const candidates = buildCharacterKeyCandidates([rawCharacter, firstName]);
      for (const candidate of candidates) {
        if (lookup.has(candidate)) return lookup.get(candidate);
      }
      return null;
    }
  };
}

function sanitizeVariantLocks(rawLocks, sceneResolver) {
  const sanitized = {};
  if (!rawLocks || typeof rawLocks !== 'object' || Array.isArray(rawLocks)) return sanitized;

  for (const [rawCharacter, rawVariant] of Object.entries(rawLocks)) {
    const sceneEntry = sceneResolver.resolve(rawCharacter);
    if (!sceneEntry) continue;

    const resolvedVariant = resolveVariantForSceneEntry(rawVariant, sceneEntry, { allowClear: false });
    if (!resolvedVariant) continue;

    sanitized[sceneEntry.characterKey] = resolvedVariant;
  }

  return sanitized;
}

function sanitizeVariantSchedule(rawSchedule, sceneResolver) {
  const sanitized = [];
  if (!Array.isArray(rawSchedule)) return sanitized;

  rawSchedule.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;

    const dialogueIndex = extractScheduleDialogueIndex(entry);
    if (dialogueIndex == null) return;

    const rawCharacter = entry.characterKey ?? entry.character ?? entry.char;
    const sceneEntry = sceneResolver.resolve(rawCharacter);
    if (!sceneEntry) return;

    const rawVariant = extractScheduleVariantValue(entry);
    const resolvedVariant = resolveVariantForSceneEntry(rawVariant, sceneEntry, { allowClear: true });

    // Only allow null clears for explicit null/empty values.
    const isExplicitClear = rawVariant == null ||
      (typeof rawVariant === 'string' && rawVariant.trim() === '');
    if (!resolvedVariant && !isExplicitClear) return;

    sanitized.push({
      line: dialogueIndex,
      character: sceneEntry.characterKey,
      variant: resolvedVariant
    });
  });

  return sanitized;
}

function buildCharactersAndVariantsBlock(sceneEntries) {
  if (!Array.isArray(sceneEntries) || sceneEntries.length === 0) return 'None';

  return sceneEntries.map((entry, index) => {
    const variants = entry.variants.join(', ');
    return `${index + 1}. ${entry.displayName} (key: ${entry.characterKey}) -> variants: ${variants}`;
  }).join('\n');
}

function buildLastVariantsBlock(sceneEntries, lastVariantsByCharacter) {
  if (!Array.isArray(sceneEntries) || sceneEntries.length === 0) return 'None';

  return sceneEntries.map((entry, index) => {
    const lastVariant = lastVariantsByCharacter?.[entry.characterKey] || 'default';
    return `${index + 1}. ${entry.characterKey}: ${lastVariant}`;
  }).join('\n');
}

function getTurnOneIntroContext(turnContext) {
  if (Number(turnContext?.turnNumber) !== 1) {
    return 'Not applicable after Turn 1.';
  }

  const introText = String(turnContext?.processed?.turnOneIntroText || '').trim();
  return introText || 'No Intro / Prologue files were selected for Turn 1.';
}

function applyStableVariantLocks(rawLocks, sceneEntries, lastVariantsByCharacter) {
  const stableLocks = { ...(rawLocks || {}) };

  for (const entry of sceneEntries) {
    if (Object.prototype.hasOwnProperty.call(stableLocks, entry.characterKey)) continue;

    const previousVariant = lastVariantsByCharacter?.[entry.characterKey] || 'default';
    const resolvedPrevious = resolveVariantForSceneEntry(previousVariant, entry, { allowClear: false });
    if (resolvedPrevious) {
      stableLocks[entry.characterKey] = resolvedPrevious;
    }
  }

  return stableLocks;
}

function getWorldStateHint(turnContext) {
  const extraDetails = turnContext?.processed?.assetSelector?.extraDetails;
  if (typeof extraDetails === 'string' && extraDetails.trim() !== '') {
    return extraDetails.trim();
  }

  const synthesized = turnContext?.output?.worldStateSynthesized;
  if (typeof synthesized === 'string' && synthesized.trim() !== '') {
    return synthesized.trim();
  }

  return 'Unavailable';
}

async function orchestrateSpriteVariants(turnContext, spriteCatalog = null) {
  if (!CONFIG.ENABLED || turnContext?.spriteVariantOrchestratorEnabled === false) {
    Logger.log('SpriteVariantOrchestrator', 'Execution', 'Sprite variant orchestrator is disabled by settings or context. Skipping.');
    return { spriteVariantLocks: {}, spriteVariantLockSchedule: [] };
  }

  const activeCatalog = spriteCatalog || turnContext?.runtime?.vnManager?.spriteCatalog;
  const hasVariantAwareSprites = (activeCatalog?.summary?.variantAwareCharacterCount || 0) > 0;
  if (!activeCatalog || !hasVariantAwareSprites) {
    return { spriteVariantLocks: {}, spriteVariantLockSchedule: [] };
  }

  const dialogueLines = getDialogueLines(turnContext);
  if (dialogueLines.length === 0) {
    return { spriteVariantLocks: {}, spriteVariantLockSchedule: [] };
  }

  const sceneEntries = buildSceneVariantEntries(dialogueLines, activeCatalog);
  if (sceneEntries.length === 0) {
    Logger.log('SpriteVariantOrchestrator', 'Request', 'No variant-aware characters in scene. Skipping.');
    return { spriteVariantLocks: {}, spriteVariantLockSchedule: [] };
  }

  try {
    const lastVariantsByCharacter = await getLastVariantsByCharacter(turnContext, sceneEntries);

    let prompt = readFileSync(CONFIG.PROMPT_PATH);
    if (!prompt) {
      throw new Error(`Failed to load variant orchestrator prompt from ${CONFIG.PROMPT_PATH}`);
    }

    prompt = prompt
      .replace('{{charactersAndVariants}}', buildCharactersAndVariantsBlock(sceneEntries))
      .replace('{{lastVariants}}', buildLastVariantsBlock(sceneEntries, lastVariantsByCharacter))
      .replace('{{turnOneIntro}}', getTurnOneIntroContext(turnContext))
      .replace('{{dialogues}}', 'Use the CURRENT INDEXED SCENE message above')
      .replace('{{worldState}}', getWorldStateHint(turnContext))
      .replace('${project_directives}', turnContext.getFormattedDirective('sprite_variant_orchestrator', { header: '=== PROJECT DIRECTIVES ===' }));
    const prepared = buildCoreVnPreparedPrompt(turnContext, {
      id: 'core.vn_analysis.sprite_variants',
      task: prompt,
      scene: 'indexedScene'
    });

    Logger.log('SpriteVariantOrchestrator', 'Request', `Analyzing ${sceneEntries.length} variant-aware characters...`, 'start');

    const { content: responseContent, model: actualModel } = await callLLM({
      model: CONFIG.MODEL,
      provider: CONFIG.PROVIDER,
      prompt: prepared,
      callingModule: 'SpriteVariantOrchestrator',
      retries: CONFIG.RETRIES,
      timeout: CONFIG.TIMEOUT,
      turnLogTitle: 'Sprite Variant Orchestrator'
    });

    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      Logger.warn('SpriteVariantOrchestrator', 'Parsing', 'Could not find JSON object in LLM response.');
      return { spriteVariantLocks: {}, spriteVariantLockSchedule: [] };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      Logger.warn('SpriteVariantOrchestrator', 'Parsing', `JSON parsing failed: ${parseError.message}`);
      return { spriteVariantLocks: {}, spriteVariantLockSchedule: [] };
    }

    const rawLocks = parsed.spritevariantlock ||
      parsed.spriteVariantLock ||
      parsed.sprite_variant_lock ||
      {};

    const rawSchedule = parsed.spritevariantlockschedule ||
      parsed.spriteVariantLockSchedule ||
      parsed.sprite_variant_lock_schedule ||
      [];

    const sceneResolver = buildSceneEntryResolver(sceneEntries);
    const spriteVariantLocks = applyStableVariantLocks(
      sanitizeVariantLocks(rawLocks, sceneResolver),
      sceneEntries,
      lastVariantsByCharacter
    );
    const spriteVariantLockSchedule = sanitizeVariantSchedule(rawSchedule, sceneResolver);

    Logger.log(
      'SpriteVariantOrchestrator',
      'Parsing',
      `Parsed ${Object.keys(spriteVariantLocks).length} lock(s) and ${spriteVariantLockSchedule.length} scheduled change(s).`,
      'end'
    );

    return { spriteVariantLocks, spriteVariantLockSchedule };
  } catch (error) {
    Logger.error('SpriteVariantOrchestrator', 'Execution', 'Variant orchestration failed:', error);
    return { spriteVariantLocks: {}, spriteVariantLockSchedule: [] };
  }
}

module.exports = { orchestrateSpriteVariants };

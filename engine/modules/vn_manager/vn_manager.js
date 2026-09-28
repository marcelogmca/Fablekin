// #region MODULE IMPORTS
const chaptermanagement = require('../chaptermanagement.js');
const { Logger, stripExtension, getFilename, readSettings, relativizeAssetPath } = require('../utils.js');
const { SummarizationService } = require('../memory_manager/memory_manager.js');
const { selectBestBackground, selectBestOST } = require('./rendering/asset_selector.js');
const { batchClassifyEmotions } = require('./analysis/emotion_classifier.js');
const { findSprite, buildSpriteCatalog } = require('./rendering/sprite_finder.js');
const { computeSpritePositions, applyRotationLogic, getMaxSpriteSlotsFromSettings } = require('./rendering/sprite_positioner.js');
const { processDialogueLines } = require('./analysis/dialogue_processor.js');
const { generateThumbnail } = require('./rendering/thumbnail_generator.js');
const pluginManager = require('../plugin_manager/plugin_manager.js');
const { identifyFocusInstructions } = require('./analysis/focus_analyzer.js');
const {
  applyConversationStaging,
  classifyConversationStaging
} = require('./analysis/conversation_staging_classifier.js');
const { directReactions } = require('./analysis/reaction_director.js');
const { orchestrateSpriteVariants } = require('./analysis/sprite_variant_orchestrator.js');
const { classifyScenePhaseHandoff } = require('./analysis/scene_phase_classifier.js');

const { loadSpriteMetadataRegistry } = require('./rendering/sprite_metadata.js');
const { handleNewCharacterExtraction } = require('./analysis/character_bootstrapper.js');
const { PLACEHOLDERS, applyTextFormatting } = require('./helpers/text_formatting.js');
const { applySpriteVariantOrchestration } = require('./helpers/variant_applicator.js');
const cancellation = require('../pipeline_cancellation.js');
const { runWithDiagnosticContext } = require('../diagnostic_context.js');
const { initializeCoreVnSharedLlmContext } = require('./shared_llm_context.js');
const { createCacheGroupScheduler, sortReadyTaskKeys } = require('./cache_group_scheduler.js');
const { initializeVnBackgroundLlmContext } = require('./background_llm_cache.js');
const { resolveModelAlias } = require('../llm.js');
// #endregion

// #region CONFIGURATION & CONSTANTS
let socketEmitter = null;

function setSocketEmitter(emitter) {
  socketEmitter = emitter;
}

function emitSocketEvent(eventName, payload) {
  if (!socketEmitter || typeof socketEmitter.emit !== 'function') return;
  socketEmitter.emit(eventName, payload);
}

function getTurnPipelineFlags(turnContext) {
  const settings = readSettings() || {};
  const agents = settings.narrative_agents || {};
  const runtimePolicy = turnContext?.runtime?.turnPipeline || {};
  const canonicalWrites = runtimePolicy.canonicalWrites !== false
    && runtimePolicy.persistenceMode !== 'virtual';
  const isVirtualTurn = !canonicalWrites || turnContext?.sceneMode === 'interlude';
  const waitBackgroundTasks = runtimePolicy.awaitBackgroundTasks === true
    || (turnContext?.sceneMode === 'interlude' && runtimePolicy.awaitBackgroundTasks !== false);
  const cachePolicy = settings.infrastructure?.prompt_caching?.vn_pipeline || {};
  const cacheDelayMs = Number.isFinite(Number(cachePolicy.follower_delay_ms))
    ? Math.max(0, Math.round(Number(cachePolicy.follower_delay_ms)))
    : 5000;
  const cacheGroupsEnabled = cachePolicy.enabled !== false;
  const routeGroup = (model) => {
    if (!cacheGroupsEnabled || !model) return null;
    const route = resolveModelAlias(model);
    return `core-vn-scene:${route.provider}:${route.model}:${route.subprovider || ''}`;
  };

  const gaze = agents.gaze_director || {};
  const variants = agents.sprite_variant_orchestrator || {};
  const assetSelector = agents.asset_selector || {};
  const summarizer = agents.summarizer || {};
  const scenePhase = agents.scene_phase_classifier || {};

  return {
    gazeDirectorEnabled: settings.narrative_agents?.gaze_director?.enabled === true,
    conversationStagingEnabled: settings.narrative_agents?.conversation_staging_classifier?.enabled !== false,
    reactionDirectorEnabled: settings.narrative_agents?.reaction_director?.enabled !== false,
    spriteVariantOrchestratorEnabled: settings.narrative_agents?.sprite_variant_orchestrator?.enabled !== false,
    assetSelectorEnabled: settings.narrative_agents?.asset_selector?.enabled !== false,
    summarizerEnabled: settings.narrative_agents?.summarizer?.enabled !== false,
    isVirtualTurn,
    canonicalWrites,
    waitForBackgroundTasks: waitBackgroundTasks,
    cacheDelayMs,
    cacheGroups: {
      gaze: routeGroup(gaze.model || 'highendmodel'),
      variants: routeGroup(variants.model || gaze.model || 'highendmodel'),
      background: routeGroup(assetSelector.background_model || 'highendmodel'),
      ost: routeGroup(assetSelector.ost_model || 'highendmodel'),
      scenePhase: routeGroup(scenePhase.model || 'mediumendmodel'),
      synopsis: routeGroup(summarizer.synopsis_model || 'mediumendmodel'),
      summary: routeGroup(summarizer.summary_model || 'mediumendmodel')
    }
  };
}
// #endregion

// #region HELPER FUNCTIONS

function flattenTaskResults(results) {
  const flat = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    flat.push(value);
  };
  visit(results);
  return flat;
}

function normalizeDependencyList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

function normalizePipelineDependencyList(value, direction = 'after') {
  return normalizeDependencyList(value).map(item => {
    if (item !== 'processedLines') return item;
    return direction === 'before' ? 'emotionClassification' : 'spriteResolution';
  });
}

function normalizePluginPipelineTasks(taskResults) {
  return flattenTaskResults(taskResults)
    .filter(task => task && typeof task === 'object')
    .map(task => ({
      ...task,
      key: String(task.key || '').trim(),
      blocking: task.blocking !== false,
      after: normalizePipelineDependencyList(task.after, 'after'),
      before: normalizePipelineDependencyList(task.before, 'before')
    }))
    .filter(task => {
      if (!task.key || typeof task.fn !== 'function') {
        Logger.warn('VNManager', 'Pipeline', 'Ignoring invalid plugin pipeline task descriptor.');
        return false;
      }
      return true;
    });
}

function getCorePipelineTaskComponent(key) {
  const components = {
    dialogueDerivedState: 'DialogueState',
    spriteVariantOrchestration: 'SpriteVariantOrchestrator',
    emotionClassification: 'EmotionClassifier',
    reactionClassification: 'ReactionDirector',
    reactionSpriteResolution: 'SpriteResolver',
    spriteResolution: 'SpriteResolver',
    finalBackground: 'AssetSelector',
    finalOst: 'AssetSelector',
    newCharacterIdentification: 'CharacterBootstrapper',
    conversationStaging: 'ConversationStagingClassifier',
    focusInstructions: 'GazeDirector',
    scenePhaseClassification: 'ScenePhaseClassifier',
    currentTurnSummary: 'Summarizer',
    currentTurnSynopsis: 'Summarizer'
  };
  return components[key] || 'VNManager';
}

function attachCorePipelineDiagnostics(steps) {
  return steps.map(step => ({
    ...step,
    diagnostics: {
      ...(step.diagnostics && typeof step.diagnostics === 'object' ? step.diagnostics : {}),
      executionLane: 'core_vn_pipeline_task',
      phase: 'VN Pipeline',
      taskKey: step.key,
      component: getCorePipelineTaskComponent(step.key),
      blocking: step.blocking !== false,
      after: step.after,
      before: step.before,
      promptCacheGroup: step.cacheGroup || null,
      promptCacheLeader: step.cacheLeader === true,
      promptCacheDelayMs: step.cacheDelayMs || 0,
      promptCachePrefixHash: step.promptCachePrefixHash || null
    }
  }));
}

function buildTaskDependencyGraph(steps) {
  const taskMap = new Map();

  for (const step of steps) {
    if (!step || !step.key || typeof step.fn !== 'function') continue;
    if (taskMap.has(step.key)) {
      Logger.warn('VNManager', 'Pipeline', `Ignoring duplicate VN pipeline task key "${step.key}".`);
      continue;
    }
    taskMap.set(step.key, {
      ...step,
      after: normalizePipelineDependencyList(step.after, 'after'),
      before: normalizePipelineDependencyList(step.before, 'before'),
      dependents: new Set()
    });
  }

  for (const task of taskMap.values()) {
    for (const beforeKey of task.before) {
      const target = taskMap.get(beforeKey);
      if (target && !target.after.includes(task.key)) {
        target.after.push(task.key);
      }
    }
  }

  for (const task of taskMap.values()) {
    task.after = task.after.filter(dependencyKey => {
      if (dependencyKey === task.key) {
        Logger.warn('VNManager', 'Pipeline', `Task "${task.key}" cannot depend on itself. Ignoring dependency.`);
        return false;
      }
      if (!taskMap.has(dependencyKey)) {
        Logger.warn('VNManager', 'Pipeline', `Task "${task.key}" depends on unknown task "${dependencyKey}". Ignoring dependency.`);
        return false;
      }
      return true;
    });

    for (const dependencyKey of task.after) {
      taskMap.get(dependencyKey).dependents.add(task.key);
    }
  }

  return taskMap;
}

async function runBlockingTaskGraph(steps, executeStep) {
  const taskMap = buildTaskDependencyGraph(steps);
  const remainingDependencies = new Map();
  const ready = [];
  const running = new Map();
  const completed = new Set();
  const results = {};
  const cacheScheduler = createCacheGroupScheduler({ logger: Logger });

  for (const task of taskMap.values()) {
    remainingDependencies.set(task.key, task.after.length);
    if (task.after.length === 0) ready.push(task.key);
  }

  const startReadyTasks = () => {
    const orderedReady = sortReadyTaskKeys(ready.splice(0), taskMap);
    for (const key of orderedReady) {
      if (completed.has(key) || running.has(key)) continue;
      const task = taskMap.get(key);
      const cacheReservation = cacheScheduler.reserve(task);
      running.set(key, Promise.resolve()
        .then(async () => {
          const waitMs = await cacheScheduler.getWaitMs(cacheReservation, task.key);
          if (waitMs > 0) {
            await new Promise(resolve => setTimeout(resolve, waitMs));
          }
          cacheScheduler.markStarted(cacheReservation);
        })
        .then(() => executeStep(task))
        .then(result => ({ key, result })));
    }
  };

  startReadyTasks();

  while (completed.size < taskMap.size) {
    if (running.size === 0) {
      const blocked = [...taskMap.keys()].filter(key => !completed.has(key));
      throw new Error(`VN pipeline task dependency cycle detected: ${blocked.join(', ')}`);
    }

    const { key, result } = await Promise.race(running.values());
    running.delete(key);
    completed.add(key);
    results[key] = result;

    for (const dependentKey of taskMap.get(key).dependents) {
      const nextCount = (remainingDependencies.get(dependentKey) || 0) - 1;
      remainingDependencies.set(dependentKey, nextCount);
      if (nextCount === 0) ready.push(dependentKey);
    }

    startReadyTasks();
  }

  return results;
}

/**
 * Returns the current canonical VN dialogue line array.
 */
function getCanonicalDialogueLines(turnContext) {
  const lines = turnContext?.processed?.vnManager?.processedLines;
  return Array.isArray(lines) ? lines : [];
}

function syncDialogueProcessorFromCanonicalLines(turnContext, dialogueLines = getCanonicalDialogueLines(turnContext)) {
  if (!turnContext?.processed) return dialogueLines;
  if (!turnContext.processed.dialogueProcessor || typeof turnContext.processed.dialogueProcessor !== 'object') {
    turnContext.processed.dialogueProcessor = {};
  }

  const lines = Array.isArray(dialogueLines) ? dialogueLines : [];
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    if (line.type === 'dialogue' && line.character && typeof line.text === 'string') {
      line.line = `${line.character}: ${line.text}`;
    } else if (line.type === 'narrative' && !line.line && typeof line.text === 'string') {
      line.line = line.text;
    }
  }

  turnContext.processed.dialogueProcessor.processedLines = lines;
  turnContext.processed.dialogueProcessor.dialogue = lines.map(line => line.line || '').join('\n');
  return lines;
}

/**
 * Recomputes derived character lists from the current canonical dialogue lines.
 */
async function updateDialogueDerivedState(turnContext, pluginManagerApi = pluginManager) {
  const playerCharacterName = turnContext.input.playerCharacterName || 'Player';
  const dialogueLines = syncDialogueProcessorFromCanonicalLines(turnContext);

  const allCharactersInScene = dialogueLines.map(line => line.character).filter(Boolean);
  const uniqueCharactersInScene = [...new Set(allCharactersInScene)].filter(char => char !== playerCharacterName);
  turnContext.output.party = uniqueCharactersInScene;

  await pluginManagerApi.executeHook('HOOK_PARTY_CALCULATED', turnContext);
  cancellation.throwIfCancelled('party calculation hook');

  const voiceLineCounts = dialogueLines.reduce((acc, line) => {
    if (line.type === 'dialogue' && line.character) {
      acc[line.character] = (acc[line.character] || 0) + 1;
    }
    return acc;
  }, {});

  turnContext.output.prominentCharacters = Object.entries(voiceLineCounts)
    .sort(([, countA], [, countB]) => countB - countA)
    .map(([character]) => character);

  await pluginManagerApi.executeHook('HOOK_PROMINENT_CHARACTERS', turnContext);
  cancellation.throwIfCancelled('prominent characters hook');

  return {
    party: turnContext.output.party,
    prominentCharacters: turnContext.output.prominentCharacters
  };
}

/**
 * Classifies dialogue emotions/moods without resolving sprites.
 */
async function classifyLineEmotions(turnContext, sprites, dialogueLines = getCanonicalDialogueLines(turnContext), deps = {}) {
  Logger.log('VNManager', 'EmotionClassification', 'Starting batch emotion classification...', 'start');
  const classifyEmotions = deps.batchClassifyEmotions || batchClassifyEmotions;
  const lines = Array.isArray(dialogueLines) ? dialogueLines : [];
  const dialoguesToClassify = lines
    .map((line, sceneLineIndex) => ({ ...line, sceneLineIndex }))
    .filter(line => line.type === 'dialogue');

  const results = await classifyEmotions(dialoguesToClassify, sprites, turnContext);

  let resultIndex = 0;
  for (const line of lines) {
    if (line.type === 'dialogue') {
      const result = results[resultIndex];
      if (result) {
        line.emotion = result.emotion;
        line.mood = result.mood;
      }
      resultIndex++;
    }
  }

  turnContext.processed.vnManager.processedLines = lines;
  syncDialogueProcessorFromCanonicalLines(turnContext, lines);
  Logger.log('VNManager', 'EmotionClassification', 'Batch emotion classification complete.', 'end');
  return lines;
}

/**
 * Resolves sprites for emotion-classified dialogue lines.
 */
async function resolveLineSprites(turnContext, sprites, allSprites, dialogueLines = getCanonicalDialogueLines(turnContext), deps = {}) {
  Logger.log('VNManager', 'SpriteResolution', 'Starting sprite resolution...', 'start');
  const spriteFinder = deps.findSprite || findSprite;
  const relativize = deps.relativizeAssetPath || relativizeAssetPath;
  const mainCharacter = turnContext.input.playerCharacterName;
  const lines = Array.isArray(dialogueLines) ? dialogueLines : [];

  for (let sceneLineIndex = 0; sceneLineIndex < lines.length; sceneLineIndex += 1) {
    const line = lines[sceneLineIndex];
    if (line.type !== 'dialogue') continue;

    const emotion = line.emotion || 'neutral';
    const spriteResult = await spriteFinder(line.character, emotion, sprites, mainCharacter, turnContext, allSprites, sceneLineIndex);
    if (spriteResult && spriteResult.image) {
      line.image = relativize(spriteResult.image, turnContext.runtime.rootDirectory);
    }
    line.gender = spriteResult ? spriteResult.gender : null;
    line.availableRotations = spriteResult ? spriteResult.rotations : [];
  }

  turnContext.processed.vnManager.processedLines = lines;
  syncDialogueProcessorFromCanonicalLines(turnContext, lines);
  Logger.log('VNManager', 'SpriteResolution', 'Sprite resolution complete.', 'end');
  return lines;
}

async function resolveReactionSprites(turnContext, sprites, allSprites, reactions = null, deps = {}) {
  const spriteFinder = deps.findSprite || findSprite;
  const relativize = deps.relativizeAssetPath || relativizeAssetPath;
  const mainCharacter = turnContext.input.playerCharacterName;
  const lines = getCanonicalDialogueLines(turnContext);
  const directives = Array.isArray(reactions)
    ? reactions
    : (turnContext?.processed?.vnManager?.reactionDirector?.reactions || []);

  for (const reaction of directives) {
    const sceneLineIndex = Number(reaction?.line);
    if (!Number.isInteger(sceneLineIndex) || sceneLineIndex < 0 || sceneLineIndex >= lines.length) continue;
    const line = lines[sceneLineIndex];
    if (!line || (line.type === 'dialogue'
      && String(line.character || '').trim().toLowerCase() === String(reaction.character || '').trim().toLowerCase())) continue;

    const spriteResult = await spriteFinder(
      reaction.character,
      reaction.emotion,
      sprites,
      mainCharacter,
      turnContext,
      allSprites,
      sceneLineIndex
    );
    if (!spriteResult?.image) continue;

    if (!Array.isArray(line.reactionChanges)) line.reactionChanges = [];
    line.reactionChanges.push({
      character: reaction.character,
      emotion: reaction.emotion,
      image: relativize(spriteResult.image, turnContext.runtime.rootDirectory),
      availableRotations: Array.isArray(spriteResult.rotations) ? spriteResult.rotations : []
    });
  }

  return lines;
}

// #endregion

// #region MAIN TRANSFORMATION FUNCTIONS

/**
 * Transforms story text and chapter data into a complete visual novel turn.
 * Populates the turnContext.output and turnContext.processed fields.
 */
async function transformVNProject(turnContext) {
  Logger.log('VNManager', 'Lifecycle', 'Starting VN project transformation', 'start');
  const pipelineFlags = getTurnPipelineFlags(turnContext);
  cancellation.throwIfCancelled('VN transformation start');
  // ###### PLUGIN HOOK: PRE_VN_GENERATION #########################################
  // Triggered at the very start. Good for injecting initial context or modifying the turn request.
  await pluginManager.executeHook('HOOK_PRE_VN_GENERATION', turnContext);
  cancellation.throwIfCancelled('pre VN generation hook');
  // ###############################################################################

  if (!turnContext.input.playerCharacterName) {
    Logger.warn('VNManager', 'Lifecycle', 'turnContext.input.playerCharacterName is missing! Defaulting to "Player".');
    turnContext.input.playerCharacterName = 'Player';
  }

  const allSpritesRaw = [
    ...(turnContext.runtime?.assets?.sprites || []),
    ...(turnContext.runtime?.assets?.extraSprites || [])
  ];
  const allSprites = allSpritesRaw.map(s => relativizeAssetPath(s, turnContext.runtime.rootDirectory));
  const spriteCatalog = buildSpriteCatalog(allSprites);
  const spriteMetadata = loadSpriteMetadataRegistry(allSpritesRaw);

  if (!turnContext.runtime.vnManager || typeof turnContext.runtime.vnManager !== 'object') {
    turnContext.runtime.vnManager = {};
  }
  turnContext.runtime.vnManager.spriteCatalog = spriteCatalog;
  turnContext.runtime.vnManager.spriteMetadata = spriteMetadata;

  const hasRotations = !!spriteCatalog?.summary?.hasRotationSprites;
  const hasVariantAwareSprites = (spriteCatalog?.summary?.variantAwareCharacterCount || 0) > 0;
  const baseSprites = Array.isArray(spriteCatalog?.global?.baseSprites)
    ? spriteCatalog.global.baseSprites
    : [];

  Logger.log('VNManager', 'SpriteCatalog', `Sprite catalog built: ${spriteCatalog.summary.characterCount} characters, ${spriteCatalog.summary.variantAwareCharacterCount} with variants.`);
  if (spriteMetadata) {
    Logger.log(
      'VNManager',
      'SpriteMetadata',
      `Sprite metadata loaded from ${spriteMetadata.sources.length} file(s): ${Object.keys(spriteMetadata.characters).length} character metadata profile(s).`
    );
  }
  await pluginManager.executeHook('HOOK_SPRITE_CATALOG_READY', turnContext, spriteCatalog);

  // Extract character icons
  const characterIcons = {};
  allSprites.forEach(sprite => {
    const filename = getFilename(sprite);
    const filenameNoExt = stripExtension(filename);
    if (filenameNoExt.toLowerCase().endsWith('_icon')) {
      // Extract character name (e.g., "Dehya_icon" -> "Dehya")
      const charName = filenameNoExt.substring(0, filenameNoExt.length - 5);
      // We store the relative path for easier usage in the frontend
      characterIcons[charName] = relativizeAssetPath(sprite, turnContext.runtime.rootDirectory, true);
    }
  });
  turnContext.output.characterIcons = characterIcons;

  Logger.log('VNManager', 'Lifecycle', 'VN transformation stats:', null, {
    projectName: turnContext.projectName,
    textLength: (turnContext.processed?.narrativeEngine?.writerResponse || '').length,
    assetCounts: {
      sprites: allSprites.length,
      baseSprites: baseSprites.length,
      backgrounds: (turnContext.runtime?.assets?.backgrounds?.length || 0) + (turnContext.runtime?.assets?.extraBackgrounds?.length || 0),
      osts: (turnContext.runtime?.assets?.osts?.length || 0) + (turnContext.runtime?.assets?.extraOsts?.length || 0)
    }
  });

  try {
    turnContext.runtime.progress.currentStep++;

    // Fallback search string setup
    if (!turnContext.runtime.lastSearchstring && (turnContext.processed?.narrativeEngine?.writerResponse || '').length > 0) {
      Logger.log('VNManager', 'Lifecycle', 'Using text as fallback searchstring');
      turnContext.runtime.lastSearchstring = turnContext.processed.narrativeEngine.writerResponse.substring(0, 500);
    }

    // ###### PLUGIN HOOK: PRE_DIALOGUE_PROCESSING ###################################
    // Triggered before raw text is parsed. Good for sanitization or regex pre-processing.
    await pluginManager.executeHook('HOOK_PRE_DIALOGUE_PROCESSING', turnContext);
    cancellation.throwIfCancelled('pre dialogue processing hook');
    // ###############################################################################

    Logger.log('VNManager', 'DialogueProcessing', 'Starting dialogue parsing...', 'start');
    const { processedLines: processedDialogue } = await runWithDiagnosticContext({
      executionLane: 'core',
      phase: 'VN Transformation',
      component: 'DialogueProcessor',
      taskKey: 'dialogueProcessing',
      blocking: true
    }, async () => processDialogueLines(turnContext));
    cancellation.throwIfCancelled('dialogue processing');
    Logger.log('VNManager', 'DialogueProcessing', 'Dialogue parsing complete.', 'end');

    // Text Formatting (Capitalization & Placeholder Replacement)
    const playerCharacterName = turnContext.input.playerCharacterName;
    // Create regex once for efficiency
    const placeholderRegex = new RegExp('\\b(' + PLACEHOLDERS.join('|') + ')\\b', 'gi');

    for (const line of processedDialogue) {
      if (line.type === 'dialogue' && line.text) {
        const newText = applyTextFormatting(line.text, playerCharacterName, placeholderRegex);
        if (newText !== line.text) {
          line.text = newText;
          line.line = `${line.character}: ${newText}`;
        }
      } else if (line.type === 'narrative' && line.line) {
        const newLine = applyTextFormatting(line.line, playerCharacterName, placeholderRegex);
        line.line = newLine;
      }
    }

    turnContext.processed.dialogueProcessor.processedLines = processedDialogue;
    turnContext.processed.dialogueProcessor.dialogue = processedDialogue.map(p => p.line).join('\n');

    // Filter out empty lines to ensure consistent indexing across all asset selection and rendering steps
    const filteredDialogue = processedDialogue.filter(line => line.line && line.line.trim() !== '');
    turnContext.processed.vnManager.processedLines = filteredDialogue;

    turnContext.runtime.progress.currentStep++;

    // ###### PLUGIN HOOK: POST_DIALOGUE_PROCESSING ##################################
    // Triggered after text is parsed into objects. Good for modifying specific lines, 
    // forcing emotions, or tagging lines for specific behavior before assets are assigned.
    await pluginManager.executeHook('HOOK_POST_DIALOGUE_PROCESSING', turnContext);
    cancellation.throwIfCancelled('post dialogue processing hook');
    // ###############################################################################

    const sharedLlmContext = initializeCoreVnSharedLlmContext(turnContext);
    if (sharedLlmContext) {
      Logger.log(
        'VNManager',
        'PromptCache',
        `Initialized immutable shared VN LLM prefix ${sharedLlmContext.prefixHash}.`
      );
    }

    const variantWillCall = hasVariantAwareSprites && pipelineFlags.spriteVariantOrchestratorEnabled;
    const gazeWillCall = hasRotations && pipelineFlags.gazeDirectorEnabled;
    const highGroupLeader = variantWillCall ? 'variants' : (gazeWillCall ? 'gaze' : null);
    const mediumGroupLeader = pipelineFlags.summarizerEnabled ? 'synopsis' : 'background';
    const cacheTask = (routeName, options = {}) => ({
      cacheGroup: pipelineFlags.cacheGroups[routeName],
      cacheDelayMs: pipelineFlags.cacheDelayMs,
      cacheLeader: options.leader === true,
      promptCachePrefixHash: sharedLlmContext?.prefixHash || null
    });

    // Define Blocking and Non-Blocking Steps
    const allSteps = attachCorePipelineDiagnostics([
      {
        key: 'dialogueDerivedState',
        blocking: true,
        fn: async () => {
          return await updateDialogueDerivedState(turnContext);
        }
      },
      {
        key: 'spriteVariantOrchestration',
        blocking: true,
        after: ['dialogueDerivedState'],
        ...cacheTask('variants', { leader: highGroupLeader === 'variants' }),
        fn: async () => {
          const result = (hasVariantAwareSprites && pipelineFlags.spriteVariantOrchestratorEnabled)
            ? await orchestrateSpriteVariants(turnContext, spriteCatalog)
            : { spriteVariantLocks: {}, spriteVariantLockSchedule: [] };
          applySpriteVariantOrchestration(turnContext, result);
          return result;
        }
      },
      {
        key: 'emotionClassification',
        blocking: true,
        after: ['spriteVariantOrchestration'],
        fn: async () => {
          return await classifyLineEmotions(turnContext, baseSprites);
        }
      },
      {
        key: 'reactionClassification',
        blocking: true,
        after: ['emotionClassification'],
        fn: async () => {
          const reactions = pipelineFlags.reactionDirectorEnabled
            ? await directReactions(turnContext, spriteCatalog)
            : [];
          turnContext.processed.vnManager.reactionDirector = { reactions };
          return reactions;
        }
      },
      {
        key: 'spriteResolution',
        blocking: true,
        after: ['emotionClassification', 'newCharacterIdentification'],
        fn: async () => {
          return await resolveLineSprites(turnContext, baseSprites, allSprites);
        }
      },
      {
        key: 'reactionSpriteResolution',
        blocking: true,
        after: ['reactionClassification', 'newCharacterIdentification'],
        fn: async () => {
          return await resolveReactionSprites(turnContext, baseSprites, allSprites);
        }
      },
      {
        key: 'finalBackground', blocking: true,
        ...cacheTask('background', { leader: mediumGroupLeader === 'background' }),
        fn: async () => {
          if (!pipelineFlags.assetSelectorEnabled) return null;
          Logger.log('VNManager', 'AssetSelection', 'Starting finalBackground', 'start');
          const res = await selectBestBackground(turnContext);
          const bgChanges = (res.changes || []).map(c => ({
            line: c.line,
            path: relativizeAssetPath(c.path, turnContext.runtime.rootDirectory)
          }));
          turnContext.output.bgChanges = bgChanges;
          turnContext.processed.assetSelector.backgroundDraft = res.path
            ? relativizeAssetPath(res.path, turnContext.runtime.rootDirectory)
            : null;
          turnContext.processed.assetSelector.backgroundChangesDraft = bgChanges;
          Logger.log('VNManager', 'AssetSelection', 'Finished finalBackground', 'end');
          return res.path;
        }
      },
      {
        key: 'finalOst', blocking: true, after: ['finalBackground'],
        ...cacheTask('ost'),
        fn: async () => {
          if (!pipelineFlags.assetSelectorEnabled) return null;
          Logger.log('VNManager', 'AssetSelection', 'Starting finalOst', 'start');
          const res = await selectBestOST(turnContext);
          turnContext.output.ostChanges = (res.changes || []).map(c => ({
            line: c.line,
            path: relativizeAssetPath(c.path, turnContext.runtime.rootDirectory)
          }));
          Logger.log('VNManager', 'AssetSelection', 'Finished finalOst', 'end');
          return res.path;
        }
      },
      {
        key: 'newCharacterIdentification', blocking: true, after: ['dialogueDerivedState'], fn: async () => {
          // Refactored to helper function
          return await handleNewCharacterExtraction(turnContext);
        }
      },
      {
        key: 'conversationStaging', blocking: true, after: ['dialogueDerivedState'],
        fn: async () => {
          if (!pipelineFlags.conversationStagingEnabled) return [];
          return await classifyConversationStaging(turnContext);
        }
      },
      {
        key: 'focusInstructions', blocking: true, after: ['dialogueDerivedState'],
        ...cacheTask('gaze', { leader: highGroupLeader === 'gaze' }),
        fn: async () => {
          if (!hasRotations || !pipelineFlags.gazeDirectorEnabled) return [];
          return await identifyFocusInstructions(turnContext);
        }
      },
      {
        key: 'scenePhaseClassification', blocking: true,
        ...cacheTask('scenePhase'),
        fn: async () => {
          return await classifyScenePhaseHandoff(turnContext);
        }
      },
      // Non-Blocking Steps
      {
        key: 'currentTurnSummary', blocking: false,
        ...cacheTask('summary'),
        fn: async () => {
          if (!pipelineFlags.summarizerEnabled) {
            const fallback = turnContext.processed.dialogueProcessor.dialogue || turnContext.output.fulltext || '';
            turnContext.output.summary = fallback;
            return fallback;
          }
          Logger.log('VNManager', 'BackgroundTasks', 'Starting currentTurnSummary (background)', 'start');
          try {
            const narrativeText = turnContext.processed.dialogueProcessor.dialogue || turnContext.output.fulltext || '';
            const res = await SummarizationService.generateSummary(turnContext, narrativeText, {
              includeUserPrompt: true
            });
            Logger.log('VNManager', 'BackgroundTasks', 'Finished currentTurnSummary (background)', 'end');
            turnContext.output.summary = res;
            return res;
          } catch (error) {
            Logger.error('VNManager', 'BackgroundTasks', 'currentTurnSummary (background) failed, using fallback.', error);
            const fallback = turnContext.processed.dialogueProcessor.dialogue || turnContext.output.fulltext || '';
            turnContext.output.summary = fallback;
            return fallback;
          }
        }
      },
      {
        key: 'currentTurnSynopsis', blocking: true,
        ...cacheTask('synopsis', { leader: mediumGroupLeader === 'synopsis' }),
        fn: async () => {
          if (!pipelineFlags.summarizerEnabled) {
            turnContext.output.title = turnContext.output.title || 'Untitled Scene';
            turnContext.output.abstractTitle = turnContext.output.abstractTitle || '';
            turnContext.output.synopsis = turnContext.output.synopsis || '';
            return {
              title: turnContext.output.title,
              abstractTitle: turnContext.output.abstractTitle,
              synopsis: turnContext.output.synopsis
            };
          }
          Logger.log('VNManager', 'Lifecycle', 'Starting currentTurnSynopsis (blocking)', 'start');
          try {
            const narrativeText = turnContext.processed.dialogueProcessor.dialogue || turnContext.output.fulltext || '';
            const { title, abstractTitle, synopsis } = await SummarizationService.generateSynopsis(turnContext, narrativeText, { includeUserPrompt: true });
            Logger.log('VNManager', 'Lifecycle', 'Finished currentTurnSynopsis (blocking)', 'end');
            turnContext.output.title = title;
            turnContext.output.abstractTitle = abstractTitle;
            turnContext.output.synopsis = synopsis;
            return { title, abstractTitle, synopsis };
          } catch (error) {
            Logger.error('VNManager', 'Lifecycle', 'currentTurnSynopsis failed.', error);
            turnContext.runtime.pipelineErrors.push({ step: 'Synopsis Generation', error: error.message });
            return { title: 'Untitled Synopsis', abstractTitle: '', synopsis: '' };
          }
        }
      }
    ]);

    const pluginTaskResults = await pluginManager.executeHook('HOOK_VN_PIPELINE_TASKS', turnContext, {
      coreTaskKeys: allSteps.map(step => step.key)
    });
    cancellation.throwIfCancelled('VN pipeline task registration hook');
    const pluginSteps = normalizePluginPipelineTasks(pluginTaskResults);
    allSteps.push(...pluginSteps);

    const wrapStep = async (step) => {
      try {
        if (step.diagnostics && typeof step.diagnostics === 'object') {
          return await runWithDiagnosticContext(step.diagnostics, async () => step.fn());
        }
        return await step.fn();
      } catch (error) {
        Logger.error('VNManager', 'Pipeline', `Non-catastrophic error in step [${step.key}]:`, error);
        turnContext.runtime.pipelineErrors.push({ step: step.key, error: error.message });

        // Return appropriate fallback values
        if (step.key === 'finalBackground') return null;
        if (step.key === 'finalOst') return null;
        if (step.key === 'newCharacterIdentification') return [];
        if (step.key === 'focusInstructions') return [];
        if (step.key === 'spriteVariantOrchestration') {
          const fallback = { spriteVariantLocks: {}, spriteVariantLockSchedule: [] };
          applySpriteVariantOrchestration(turnContext, fallback);
          return fallback;
        }
        if (step.key === 'emotionClassification' || step.key === 'spriteResolution') {
          return getCanonicalDialogueLines(turnContext);
        }
        if (step.key === 'scenePhaseClassification') {
          return {
            capability: 'none',
            requestedPluginId: null,
            confidence: 0,
            isHandoff: false,
            boundaryExcerpt: '',
            boundaryType: 'none',
            boundaryStrength: 'none',
            interruptibility: 'clear',
            currentEngagement: '',
            cadence: {
              capabilityKey: '',
              recentCount: 0,
              consecutiveCount: 0,
              turnsSinceLast: null,
              overused: false
            },
            capabilityTemperature: [],
            directorAdvisory: {
              severity: 'none',
              capability: '',
              topic: '',
              message: '',
              expiresAfterTurns: 0
            },
            repetitionRisk: 'low',
            reason: '',
            repetitionNote: '',
            gatingNotes: [`Fallback due to step failure: ${error.message}`],
            resolvedPhase: 'NORMAL',
            resolvedPluginId: null
          };
        }
        return null;
      }
    };

    const blockingSteps = allSteps.filter(s => s.blocking);

    // --- Execute Blocking Steps ---
    Logger.log('VNManager', 'Lifecycle', 'Executing parallel blocking steps...', 'start');
    cancellation.throwIfCancelled('VN blocking tasks');
    const [resultObj] = await Promise.all([
      runBlockingTaskGraph(blockingSteps, async (step) => {
        cancellation.throwIfCancelled(`VN blocking task ${step.key}`);
        // These phases define the canonical dialogue/sprite contract for the frontend.
        if (step.key === 'dialogueDerivedState' || step.key === 'emotionClassification' || step.key === 'spriteResolution') {
          if (step.diagnostics && typeof step.diagnostics === 'object') {
            return await runWithDiagnosticContext(step.diagnostics, async () => step.fn());
          }
          return await step.fn();
        }
        return await wrapStep(step);
      }),
      pluginManager.executeHook('HOOK_VN_BLOCKING_TASKS', turnContext).catch(err => {
        Logger.error('VNManager', 'Hooks', 'Error in HOOK_VN_BLOCKING_TASKS:', err);
        turnContext.runtime.pipelineErrors.push({ step: 'Plugin Blocking Tasks', error: err.message });
      })
    ]);
    cancellation.throwIfCancelled('VN blocking tasks');
    Logger.log('VNManager', 'Lifecycle', 'All blocking promise steps completed.', 'end');

    // Note: Plugin results from HOOK_VN_BLOCKING_TASKS are not automatically added to resultObj
    // because that hook can have multiple listeners. Plugins should modify turnContext directly.

    const scenePhaseDecision = resultObj.scenePhaseClassification || {
      capability: 'none',
      requestedPluginId: null,
      confidence: 0,
      isHandoff: false,
      boundaryExcerpt: '',
      boundaryType: 'none',
      boundaryStrength: 'none',
      interruptibility: 'clear',
      currentEngagement: '',
      cadence: {
        capabilityKey: '',
        recentCount: 0,
        consecutiveCount: 0,
        turnsSinceLast: null,
        overused: false
      },
      capabilityTemperature: [],
      directorAdvisory: {
        severity: 'none',
        capability: '',
        topic: '',
        message: '',
        expiresAfterTurns: 0
      },
      repetitionRisk: 'low',
      reason: '',
      repetitionNote: '',
      gatingNotes: ['Classifier result missing; defaulting to NORMAL.'],
      resolvedPhase: 'NORMAL',
      resolvedPluginId: null
    };

    // Final scene phase is resolved here, after writer output exists and classifier gating is applied.
    turnContext.processed.director.scenePhase = scenePhaseDecision.resolvedPhase || 'NORMAL';
    turnContext.processed.director.scenePluginId = scenePhaseDecision.resolvedPluginId || null;
    turnContext.processed.scenePhaseClassifier = scenePhaseDecision;
    Logger.log(
      'VNManager',
      'ScenePhase',
      `Final scene phase: ${turnContext.processed.director.scenePhase}${turnContext.processed.director.scenePluginId ? ` via ${turnContext.processed.director.scenePluginId}` : ''}`
    );

    // Store the enriched lines in TurnContext for plugins to access.
    const finalProcessedLines = resultObj.spriteResolution || getCanonicalDialogueLines(turnContext);
    const conversationStaging = Array.isArray(resultObj.conversationStaging)
      ? resultObj.conversationStaging
      : [];
    applyConversationStaging(finalProcessedLines, conversationStaging);
    turnContext.processed.vnManager.processedLines = finalProcessedLines;
    turnContext.processed.vnManager.conversationStaging = conversationStaging;
    turnContext.thumbnail = resultObj.thumbnail || null;

    // ###### PLUGIN HOOK: HOOK_VN_DIALOGUE_READY ####################################
    // Triggered as soon as dialogue lines have emotions, images, and genders assigned.
    // This is ideal for fire-and-forget tasks like TTS generation.
    Logger.log('VNManager', 'Lifecycle', 'Triggering HOOK_VN_DIALOGUE_READY...', 'start');
    await pluginManager.executeHook('HOOK_VN_DIALOGUE_READY', turnContext);
    cancellation.throwIfCancelled('VN dialogue ready hook');
    // ###############################################################################

    // ###### PLUGIN HOOK: POST_BLOCKING_TASKS #######################################
    // Allows plugins to manipulate the `processedLines` (which now have images) 
    // before the heat map calculates positions.
    await pluginManager.executeHook('HOOK_PRE_SPRITE_POSITIONING', turnContext, finalProcessedLines);
    cancellation.throwIfCancelled('sprite positioning hook');
    // ###############################################################################

    Logger.log('VNManager', 'VNTransformation', 'Computing sprite positions...', 'start');
    const maxSpriteSlots = getMaxSpriteSlotsFromSettings(readSettings() || {});
    const finalOutput = computeSpritePositions(finalProcessedLines, allSprites, { spriteMetadata, maxSpriteSlots });
    for (const line of finalProcessedLines) {
      if (line && typeof line === 'object') delete line.reactionChanges;
    }
    cancellation.throwIfCancelled('sprite positioning');

    // --- Apply Focus Rotations ---
    if (hasRotations && (pipelineFlags.conversationStagingEnabled || pipelineFlags.gazeDirectorEnabled)) {
      Logger.log('VNManager', 'VNTransformation', 'Applying sprite rotations based on focus...', 'start');
      const allSpritesSet = new Set(allSprites);
      const focusInstructions = pipelineFlags.gazeDirectorEnabled && Array.isArray(resultObj.focusInstructions)
        ? resultObj.focusInstructions
        : [];
      applyRotationLogic(finalOutput, focusInstructions, playerCharacterName, allSpritesSet);
      Logger.log('VNManager', 'VNTransformation', 'Sprite rotations applied.', 'end');
    }

    // Inject CG overlays if provided by a plugin
    const cgOverlays = turnContext.processed.cgOverlays;
    if (cgOverlays && Array.isArray(cgOverlays)) {
      for (const overlay of cgOverlays) {
        if (overlay.image && typeof overlay.startIdx === 'number' && typeof overlay.endIdx === 'number') {
          for (let i = overlay.startIdx; i <= overlay.endIdx && i < finalOutput.length; i++) {
            finalOutput[i].cg = overlay.image;
          }
        }
      }
    }

    // --- 4. Inject Multi-Asset Changes (Phase 3) ---
    // We convert relativized changes from turnContext.output into clientEvents
    // that the viewer's DirectorCompiler and Engine already know how to handle.
    const bgChanges = turnContext.output.bgChanges || [];
    const ostChanges = turnContext.output.ostChanges || [];

    for (const change of bgChanges) {
      if (change.path && typeof change.line === 'number' && change.line < finalOutput.length) {
        const line = finalOutput[change.line];
        if (!line.clientEvents) line.clientEvents = [];

        // scene:transition is the internal type that triggers vn:background-override
        line.clientEvents.push({
          type: 'scene:transition',
          payload: {
            src: change.path,
            isVideo: change.path.toLowerCase().endsWith('.mp4') || change.path.toLowerCase().endsWith('.webm'),
            instant: false
          }
        });
      }
    }

    for (const change of ostChanges) {
      if (change.path && typeof change.line === 'number' && change.line < finalOutput.length) {
        const line = finalOutput[change.line];
        if (!line.clientEvents) line.clientEvents = [];

        // vn:ost-change is the internal type for music swapping
        // We strip the 'ost/' prefix because the viewer's listener prepends it, 
        // unlike the background renderer which uses relative paths directly.
        line.clientEvents.push({
          type: 'vn:ost-change',
          payload: {
            file: change.path.replace(/^ost\//, '')
          }
        });
      }
    }

    turnContext.output.sequence = finalOutput;
    Logger.log('VNManager', 'VNTransformation', 'Sprite positions computed.', 'end');

    // #region EXTRACT PROMINENT SPRITES
    // Logic to find top 3 prominent sprites for UI/Save file thumbnails
    // (Party was calculated earlier)

    // 1. Get character appearance frequencies (excluding the player)
    const characterCounts = finalOutput.reduce((acc, line) => {
      if (line.character) {
        const charName = line.character.trim().toLowerCase();
        const playerPlayerNormalized = (playerCharacterName || "").trim().toLowerCase();
        if (charName !== playerPlayerNormalized) {
          acc[charName] = (acc[charName] || 0) + 1;
        }
      }
      return acc;
    }, {});

    // 2. Sort characters by frequency and get the top three
    const topCharacters = Object.entries(characterCounts)
      .sort(([, countA], [, countB]) => countB - countA)
      .slice(0, 3)
      .map(([character]) => character);

    // 3. For each top character, find their most used sprite
    const prominentSprites = topCharacters.map(character => {
      const spriteCounts = finalOutput
        .filter(line => line.character && line.character.trim().toLowerCase() === character && line.image)
        .reduce((acc, line) => {
          acc[line.image] = (acc[line.image] || 0) + 1;
          return acc;
        }, {});

      if (Object.keys(spriteCounts).length === 0) return null;

      const mostProminentSprite = Object.entries(spriteCounts)
        .sort(([, countA], [, countB]) => countB - countA)[0][0];

      return mostProminentSprite;
    }).filter(Boolean);

    turnContext.output.prominentSprites = prominentSprites;
    // #endregion

    turnContext.runtime.progress.currentStep++;

    Logger.log('VNManager', 'VNTransformation', 'Transformation complete:', null, {
      sequenceLength: finalOutput.length,
      background: resultObj.finalBackground,
      song: resultObj.finalOst
    });

    // Populate final output and processed data
    turnContext.output.finalBackground = resultObj.finalBackground ? relativizeAssetPath(resultObj.finalBackground, turnContext.runtime.rootDirectory) : null;
    turnContext.output.finalSong = resultObj.finalOst ? relativizeAssetPath(resultObj.finalOst, turnContext.runtime.rootDirectory) : null;

    turnContext.processed.emotionClassifier.emotions = finalProcessedLines.map(line => line.emotion);
    turnContext.processed.assetSelector.background = resultObj.finalBackground ? relativizeAssetPath(resultObj.finalBackground, turnContext.runtime.rootDirectory) : null;
    turnContext.processed.assetSelector.ost = resultObj.finalOst ? relativizeAssetPath(resultObj.finalOst, turnContext.runtime.rootDirectory) : null;
    turnContext.processed.newlyIntroducedCharacters = resultObj.newCharacterIdentification;

    // --- Core Chapter Intro Population ---
    if (!turnContext.processed.chapterIntroConfig) {
      const isInterlude = String(turnContext.sceneMode || '').toLowerCase() === 'interlude';
      const chapterNumber = Number.isInteger(turnContext.turnNumber) ? turnContext.turnNumber : 1;
      const interludeOrdinal = Number.isInteger(turnContext.interludeOrdinal) ? turnContext.interludeOrdinal : null;
      const introText = isInterlude
        ? `Chapter ${chapterNumber} Interlude ${interludeOrdinal || 1}`
        : `Chapter ${chapterNumber}`;

      turnContext.processed.chapterIntroConfig = {
        enabled: true,
        text: introText,
        subtext: turnContext.output.abstractTitle || "",
        preset: 'chapter_intro'
      };
    }

    // PRE-COMMIT TURN TO DB
    // This resolves a race condition where background tasks try to update the database
    // before the main loop has executed its initial commit to assign a row dbId.
    if (!pipelineFlags.isVirtualTurn) {
      Logger.log('VNManager', 'Persistence', 'Pre-committing turn to generate DB ID for background tasks.');
      if (typeof turnContext.commit === 'function') {
        cancellation.throwIfCancelled('VN pre-commit');
        await turnContext.commit();
      }
    } else {
      Logger.log('VNManager', 'Persistence', 'Skipping canonical pre-commit for virtual turn mode.');
    }

    // --- Execute Background Steps ---
    // We include core background steps + the thumbnail generation which now has all data ready
    const backgroundSteps = allSteps.filter(s => !s.blocking);
    let runBackgroundTasks = null;

    if (backgroundSteps.length > 0 || pluginManager.hooks.has('HOOK_VN_BACKGROUND_TASKS')) {
      runBackgroundTasks = async () => {
        cancellation.throwIfCancelled('VN background tasks');
        const backgroundLlmContext = initializeVnBackgroundLlmContext(turnContext);
        if (backgroundLlmContext) {
          Logger.log('VNManager', 'PromptCache', `Initialized finalized VN background prefix ${backgroundLlmContext.prefixHash}.`);
        }
        const backgroundPromises = [
          ...backgroundSteps.map(step => {
            return wrapStep(step).catch(err => {
              Logger.error('VNManager', 'BackgroundTasks', `Error in background step [${step.key}]:`, err);
              turnContext.runtime.pipelineErrors.push({ step: step.key, error: err.message });
            });
          }),
          (async () => {
            try {
              Logger.log('VNManager', 'ThumbnailGen', 'Starting thumbnail generation (background)', 'start');
              const res = await generateThumbnail(turnContext);
              turnContext.thumbnail = res;
              Logger.log('VNManager', 'ThumbnailGen', 'Finished thumbnail generation (background)', 'end');
              return res;
            } catch (error) {
              Logger.error('VNManager', 'ThumbnailGen', 'Thumbnail generation failed:', error);
              turnContext.runtime.pipelineErrors.push({ step: 'Thumbnail Generation', error: error.message });
              return null;
            }
          })(),
          pluginManager.executeHook('HOOK_VN_BACKGROUND_TASKS', turnContext).catch(err => {
            Logger.error('VNManager', 'Hooks', 'Error in HOOK_VN_BACKGROUND_TASKS:', err);
            turnContext.runtime.pipelineErrors.push({ step: 'Plugin Background Tasks', error: err.message });
          })
        ];

        Logger.log('VNManager', 'BackgroundTasks', `Starting ${backgroundPromises.length} background tasks.`, 'start');
        await Promise.all(backgroundPromises);
        cancellation.throwIfCancelled('VN background tasks');

        Logger.log('VNManager', 'BackgroundTasks', 'All background tasks have completed.', 'end');
        Logger.log('TurnLifecycle', '[TURN GEN ENDS] (Absolute)', 'end');
        emitSocketEvent('vn-processing-complete', { message: 'All background tasks finished!' });

        // ###### PLUGIN HOOK: BACKGROUND_TASKS_COMPLETE ######################
        // After all background tasks complete. Good for cleanup and validation.
        try {
          await pluginManager.executeHook('HOOK_BACKGROUND_TASKS_COMPLETE', turnContext);
          cancellation.throwIfCancelled('background completion hook');
        } catch (error) {
          Logger.error('VNManager', 'Hooks', 'Error in HOOK_BACKGROUND_TASKS_COMPLETE:', error);
          turnContext.runtime.pipelineErrors.push({ step: 'Plugin Background Completion', error: error.message });
        }
        // ############################################################################

        // Final Database Update after background tasks (critical to save the thumbnail)
        if (!pipelineFlags.isVirtualTurn) {
          if (turnContext.dbId) {
            try {
              cancellation.throwIfCancelled('post-background DB update');
              await chaptermanagement.updateTurn(turnContext);
              Logger.log('VNManager', 'Database', `Successfully updated TurnContext ${turnContext.dbId} in DB after background tasks.`);
              // ###### PLUGIN HOOK: POST_DB_UPDATE ####################################
              // After turn is updated in database. Plugins can sync to external systems.
              await pluginManager.executeHook('HOOK_POST_DB_UPDATE', turnContext);
              // ############################################################################
            } catch (error) {
              Logger.error('VNManager', 'Database', `Failed to update TurnContext ${turnContext.dbId} in DB after background tasks:`, error);
            }
          } else {
            Logger.warn('VNManager', 'Database', 'TurnContext dbId not found, skipping DB update after background tasks.');
          }
        } else {
          Logger.log('VNManager', 'Database', 'Skipping canonical DB update after background tasks (virtual turn mode).');
        }
      };

      if (!pipelineFlags.waitForBackgroundTasks) {
        runBackgroundTasks().catch(error => {
          Logger.error('VNManager', 'BackgroundTasks', 'A background task failed.', error);
          emitSocketEvent('vn-processing-error', { message: 'A background task failed.', details: error.message });
        });
      }
    }

    // ###### PLUGIN HOOK: POST_VN_GENERATION ########################################
    // Triggered at the very end. The `turnContext` is fully populated.
    // Last chance to modify the output before it is sent to the frontend.
    await pluginManager.executeHook('HOOK_POST_VN_GENERATION', turnContext);
    cancellation.throwIfCancelled('post VN generation hook');
    // ###############################################################################

    if (pipelineFlags.waitForBackgroundTasks && runBackgroundTasks) {
      await runBackgroundTasks();
    }

    cancellation.throwIfCancelled('VN frontend handoff');
    // Notify only AFTER all blocking work (including POST_VN_GENERATION) is done
    emitSocketEvent('vn-processing-background', { message: 'Scene ready!' });

    // Snapshot the context for frontend-triggered hooks
    pluginManager.setCurrentTurnContext(turnContext);
    Logger.log('VNManager', 'Lifecycle', 'VN project transformation complete.', 'end');

  } catch (error) {
    Logger.error('VNManager', 'Lifecycle', 'Transformation Error:', error);
    emitSocketEvent('vn-transform-error', { message: 'An error occurred during transformation.', details: error.message });
    throw error;
  }
}
// #endregion

// #region EXPORTS
module.exports = {
  transformVNProject,
  setSocketEmitter,
  _private: {
    normalizePluginPipelineTasks,
    buildTaskDependencyGraph,
    runBlockingTaskGraph,
    classifyLineEmotions,
    resolveLineSprites,
    resolveReactionSprites,
    updateDialogueDerivedState,
    getCanonicalDialogueLines,
    syncDialogueProcessorFromCanonicalLines
  }
};
// #endregion

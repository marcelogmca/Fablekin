// modules/narrativeEngine.js

// #region MODULE IMPORTS
const { TurnLogger, Logger, readSettings, sendUiNotification } = require('./utils.js');
const { callLLM } = require('./llm.js');
const promptBuilder = require('./prompt_builder.js');
const director = require('./director.js');
const pluginManager = require('./plugin_manager/plugin_manager.js');
const cancellation = require('./pipeline_cancellation.js');
const { runWithDiagnosticContext } = require('./diagnostic_context.js');
const { logSharedPrefixUsage } = require('./shared_narrative_prompt.js');
const { hasRunawayWordList } = require('./writer_output_guard.js');
// #endregion

// #region CONFIGURATION
function buildWriterConfig() {
  const settings = readSettings() || {};
  const writer = settings.narrative_agents?.writer || {};
  return {
    model: writer.model,
    provider: writer.provider,
    retries: writer.retries,
    timeout: writer.timeout,
    // No application-wide sampling defaults: every model runs its own native
    // settings unless the project explicitly configures writer.llm_params.
    llmParams: writer.llm_params || {}
  };
}
// #endregion

// #region MODULE STATE
// #endregion

// #region CORE NARRATIVE GENERATION
/**
 * Generates the next chapter of the narrative using LLM, incorporating lore and managing turns.
 * This function now orchestrates pre-writer analysis and injects the resulting feedback.
 * Populates turnContext.processed.narrativeEngine.writerResponse.
 *
 * @param {TurnContext} turnContext - The TurnContext object containing all necessary data.
 * @returns {Promise<void>} A promise that resolves when generation is complete.
 */
async function generateNextChapter(turnContext) {
  const config = buildWriterConfig();
  const isFirstTurn = turnContext.turnNumber === 1;

  Logger.log('TurnLifecycle', '[TURN GEN START]', 'start');
  Logger.log('NarrativeEngine', 'Lifecycle', 'Starting generateNextChapter', 'start');

  sendUiNotification({
    id: 'narrative_pipeline',
    message: isFirstTurn ? '🎬 Starting first scene... (this may take extra time)' : '🎬 Starting scene generation...',
    blocking: true,
    priority: 100,
    icon: '🎬'
  });

  // ###### PLUGIN HOOK ############################################################
  await pluginManager.executeHook('HOOK_NARRATIVE_START', turnContext);
  cancellation.throwIfCancelled('narrative start hook');
  // ###############################################################################

  // --- STEP 3: Build the prompt context ---
  // We first gather the Foundation (Shared Context)
  sendUiNotification({
    id: 'narrative_pipeline',
    message: '📚 Gathering lore and memories...',
    blocking: true,
    priority: 100,
    icon: '📚'
  });
  Logger.log('NarrativeEngine', 'PromptBuilding', 'Gathering Foundation (70% shared context)...', 'start');
  await promptBuilder.gatherFoundation(turnContext);
  cancellation.throwIfCancelled('foundation gathering');
  Logger.log('NarrativeEngine', 'PromptBuilding', 'Foundation gathered.', 'end');


  // --- STEP 4: Precompute History ---
  sendUiNotification({
    id: 'narrative_pipeline',
    message: '⏳ Searching memory archives...',
    blocking: true,
    priority: 100,
    icon: '⏳'
  });
  await promptBuilder.precomputeHistory(turnContext);
  cancellation.throwIfCancelled('history precompute');

  let writerLlmCallPromise;

  // --- STEP 5: Conditional Orchestrator Run ---

  // ###### PLUGIN HOOK ############################################################
  await pluginManager.executeHook('HOOK_PRE_ORCHESTRATOR', turnContext);
  cancellation.throwIfCancelled('pre-orchestrator hook');
  await promptBuilder.prepareSharedNarrativePrefix(turnContext);
  cancellation.throwIfCancelled('shared narrative prefix preparation');
  // ###############################################################################

  Logger.log('NarrativeEngine', 'Orchestration', `Director status: ${turnContext.directorEnabled}`, 'start');
  Logger.log(
    'NarrativeEngine',
    'InterludeDirector',
    `sceneMode=${turnContext.sceneMode || 'mainline'}, directorEnabled=${turnContext.directorEnabled === true}, hasManualDirectorPrompt=${!!turnContext.input.directorPrompt}`
  );
  if (turnContext.input.directorPrompt) {
    Logger.log('NarrativeEngine', 'Orchestration', 'Manual Director Directive detected. Skipping automated director.');
    turnContext.processed.director.writerBrief = turnContext.input.directorPrompt;
    await director.runDirectorPrePromptHooks(turnContext);
    cancellation.throwIfCancelled('director-adjacent hooks after manual directive');
  } else if (turnContext.directorEnabled) {
    const directorMessage = isFirstTurn
      ? '🎭 Director is setting up your world... This may take a while.'
      : '🎭 Director is crafting scene guidance... This may take a while.';
    sendUiNotification({
      id: 'narrative_pipeline',
      message: directorMessage,
      blocking: true,
      priority: 100,
      icon: '🎭'
    });
    await director.runPeriodic(turnContext);
    cancellation.throwIfCancelled('director generation');
  } else {
    Logger.log('NarrativeEngine', 'Orchestration', 'Director is DISABLED for this turn.');
    await director.runDirectorPrePromptHooks(turnContext);
    cancellation.throwIfCancelled('director-adjacent hooks while director disabled');
  }
  Logger.log('NarrativeEngine', 'Orchestration', `Director orchestration finished.`, 'end');

  // ###### PLUGIN HOOK ############################################################
  await pluginManager.executeHook('HOOK_POST_ORCHESTRATOR', turnContext);
  cancellation.throwIfCancelled('post-orchestrator hook');
  // ###############################################################################

  // --- STEP 6: Final Writer Prompt Assembly ---
  // Now we assemble the Writer's Sleeve, which includes the fresh brief from the director.
  sendUiNotification({
    id: 'narrative_pipeline',
    message: '📝 Preparing story prompt...',
    blocking: true,
    priority: 100,
    icon: '📝'
  });
  Logger.log('NarrativeEngine', 'PromptBuilding', 'Assembling Writer Sleeve...', 'start');
  await promptBuilder.buildWriterMessages(turnContext);
  cancellation.throwIfCancelled('writer prompt assembly');
  logSharedPrefixUsage(turnContext, 'Writer', config.model, config.provider);
  Logger.log('NarrativeEngine', 'PromptBuilding', 'Writer Sleeve assembled.', 'end');

  const messages = turnContext.processed.promptBuilder.messages;

  Logger.log('NarrativeEngine', 'PromptBuilding', 'Final message preparation completed', null, { totalMessages: messages.length });

  // ###### PLUGIN HOOK ############################################################
  await pluginManager.executeHook('HOOK_PRE_WRITER', turnContext);
  cancellation.throwIfCancelled('pre-writer hook');
  // ###############################################################################

  // --- STEP 7: Call the Writer LLM (and await parallel Orchestrator if applicable) ---
  const writerMessage = isFirstTurn
    ? '✍️ AI is writing your first story... This may take a while.'
    : '✍️ AI is writing your story... This may take a while.';
  sendUiNotification({
    id: 'narrative_pipeline',
    message: writerMessage,
    blocking: true,
    priority: 100,
    icon: '✍️'
  });
  const writerLlmParams = { ...config.llmParams };
  Logger.log('NarrativeEngine', 'Generation', 'Writer CoT is ' + (turnContext.writerCoTEnabled ? 'ENABLED' : 'DISABLED') + ' for this turn.');
  const writerRequestMessages = messages.map(message => ({
    role: message.role,
    content: message.content
  }));
  turnContext.runtime.narrativeEngine = turnContext.runtime.narrativeEngine || {};
  turnContext.runtime.narrativeEngine.writerRequestMessages = writerRequestMessages;
  // Authoritative composer: narrativeengine sends the prepared result.
  // HOOK_PRE_WRITER ran above; a hook that mutates writer slots after
  // assembly must surface as a hard error here, never a silent legacy send.
  const { PreparedPrompt } = require('./prompt/prompt.js');
  const storedPrepared = turnContext.processed.promptBuilder.writerPromptPrepared || null;
  let writerPrepared = null;
  try {
    writerPrepared = storedPrepared ? PreparedPrompt.rehydrate(storedPrepared) : null;
  } catch (error) {
    throw new Error(`Writer prepared prompt failed verification: ${error.message}`);
  }
  if (!writerPrepared) {
    throw new Error('Writer prepared prompt is missing; buildWriterMessages() must produce it before the LLM call.');
  }
  const preparedMatchesPostHook = writerPrepared.messages.length === writerRequestMessages.length
    && writerPrepared.messages.every((message, index) =>
      message.role === writerRequestMessages[index].role
      && message.content === writerRequestMessages[index].content
    );
  if (!preparedMatchesPostHook) {
    throw new Error(
      'Writer prepared prompt no longer matches the post-HOOK_PRE_WRITER messages; ' +
      'a hook mutated prompt state after assembly. Migrate that hook to contribute() before assembly.'
    );
  }

  const writerResult = await runWithDiagnosticContext({
    executionLane: 'core',
    phase: 'Narrative',
    component: 'Writer',
    taskKey: 'writerGeneration',
    promptCachePrefixHash: turnContext.processed.promptBuilder.sharedPrefixHash,
    blocking: true
  }, async () => {
    // Prepared-only: callLLM logs request/response centrally with the
    // manifest + callId; no manual TurnLogger calls (no duplicate entries).
    writerLlmCallPromise = callLLM({
      prompt: writerPrepared,
      model: config.model,
      provider: config.provider,
      retries: config.retries,
      timeout: config.timeout,
      extra: { ...writerLlmParams },
      minWords: turnContext.writerMinimumWordCount,
      callingModule: 'NarrativeEngine',
      turnLogTitle: 'Writer'
    });

    Logger.log('NarrativeEngine', 'Generation', 'Awaiting Writer LLM call...');
    const result = await writerLlmCallPromise;
    return result;
  });
  cancellation.throwIfCancelled('writer generation');
  const outputContent = writerResult.content;
  if (hasRunawayWordList(outputContent)) {
    throw new Error('Writer produced a runaway word list instead of a scene. The response was rejected before VN processing; try a different Writer model or adjust its sampling settings.');
  }

  Logger.log('NarrativeEngine', 'Generation', 'Writer LLM response received.', 'end');

  // --- STEP 8: Populate the TurnContext with the final output ---
  // Filter out lines that simply have asterisks and spaces (often used as scene separators in LLMs)
  const filteredContent = outputContent.split('\n').filter(line => {
    const trimmed = line.trim();
    // Remove if it's not empty AND consists only of asterisks and whitespace
    return !(trimmed.length > 0 && /^[\s\*]+$/.test(trimmed));
  }).join('\n');
  turnContext.processed.narrativeEngine.writerResponse = filteredContent;
  
  sendUiNotification({
    id: 'narrative_pipeline',
    message: '📖 Writing complete. Transforming to scene...',
    blocking: true,
    priority: 100,
    icon: '📖'
  });

  // ###### PLUGIN HOOK ############################################################
  await pluginManager.executeHook('HOOK_POST_WRITER', turnContext);
  cancellation.throwIfCancelled('post-writer hook');
  // ###############################################################################

  Logger.log('NarrativeEngine', 'Lifecycle', 'generateNextChapter finished.', 'end');
  Logger.log('TurnLifecycle', 'Narrative', '[TURN GEN ENDS] (Narrative)', 'end');
  // No explicit return value needed, as turnContext is modified by reference
}
// #endregion

// #region EXPORTS
module.exports = {
  generateNextChapter
};
// #endregion

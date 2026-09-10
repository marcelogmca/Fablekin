const { Logger, TurnLogger, settings, readFileSync } = require('../../utils.js');
const { callLLM, resolveModelAlias } = require('../../llm.js');
const { buildCoreVnLlmMessages } = require('../shared_llm_context.js');

// #region CONFIGURATION
const CONFIG = {
  ENABLED: settings.narrative_agents?.gaze_director?.enabled !== false,
  MODEL: settings.narrative_agents?.gaze_director?.model || 'highendmodel',
  PROMPT_PATH: 'engine/prompts/sprite_gaze_instructions.txt',
  RETRIES: settings.narrative_agents?.gaze_director?.retries || 3,
  TIMEOUT: settings.narrative_agents?.gaze_director?.timeout || 120000
};
// #endregion

/**
 * Identifies focus instructions (who to look at) using the Gaze Director prompt.
 * @param {object} turnContext - The current turn context.
 * @returns {Promise<Array>} - An array of focus instruction objects from the LLM script.
 */
async function identifyFocusInstructions(turnContext) {
  if (!CONFIG.ENABLED || turnContext?.focusAnalyzerEnabled === false) {
    Logger.log('FocusAnalyzer', 'Execution', 'Focus analyzer is disabled by settings or context. Skipping.');
    return [];
  }

  const dialogueLines = turnContext.processed.dialogueProcessor.processedLines.filter(line => line.type === 'dialogue');

  if (dialogueLines.length === 0) {
    return [];
  }

  try {
    const playerCharacterName = turnContext.input.playerCharacterName || 'Player';
    let focusPrompt = readFileSync(CONFIG.PROMPT_PATH);
    if (!focusPrompt) {
      throw new Error(`Failed to load gaze instructions from ${CONFIG.PROMPT_PATH}`);
    }
    focusPrompt = focusPrompt.replace('{{playerName}}', playerCharacterName);
    const projectDirectives = turnContext.getFormattedDirective('focus_analyzer', { header: '=== PROJECT DIRECTIVES ===' });
    
    focusPrompt = focusPrompt
      .replace('{{dialogues}}', 'Use the CURRENT DIALOGUE-ONLY SCENE message above')
      .replace('${project_directives}', projectDirectives);
    const messages = buildCoreVnLlmMessages(turnContext, focusPrompt, { scene: 'dialogue' });

    Logger.log('FocusAnalyzer', 'Request', `Identifying gaze for ${dialogueLines.length} lines...`, 'start');
    TurnLogger.logRequest('Gaze Director', messages, CONFIG.MODEL, resolveModelAlias(CONFIG.MODEL).provider);

    const { content: responseContent, model: actualModel } = await callLLM({
      model: CONFIG.MODEL,
      messages,
      callingModule: 'FocusAnalyzer',
      retries: CONFIG.RETRIES,
      timeout: CONFIG.TIMEOUT,
      turnLogTitle: 'Gaze Director'
    });

    TurnLogger.logResponse('Gaze Director', responseContent, actualModel, resolveModelAlias(CONFIG.MODEL).provider);

    // Parse JSON from the response (now looking for the "script" field)
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const fullResponse = JSON.parse(jsonMatch[0]);
        const focusInstructions = fullResponse.script || [];
        Logger.log('FocusAnalyzer', 'Parsing', `Parsed ${focusInstructions.length} gaze commands from Gaze Director.`, 'end');
        return focusInstructions;
      } catch (parseError) {
        Logger.warn('FocusAnalyzer', 'Parsing', `JSON parsing failed: ${parseError.message}`);
      }
    }

    Logger.warn('FocusAnalyzer', 'Parsing', 'Could not find valid JSON object in LLM response, returning empty script.');
    return [];
  } catch (error) {
    Logger.error('FocusAnalyzer', 'Execution', 'Gaze instruction identification failed:', error);
    return [];
  }
}

module.exports = { identifyFocusInstructions };

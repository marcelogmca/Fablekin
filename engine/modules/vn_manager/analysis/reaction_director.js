const { Logger, TurnLogger, readSettings, readFileSync } = require('../../utils.js');
const { callLLM, resolveModelAlias } = require('../../llm.js');
const { buildCoreVnLlmMessages } = require('../shared_llm_context.js');
const {
  getAllowedEmotionsForDialogueLine,
  resolveCatalogCharacterKey
} = require('./emotion_classifier.js');

const settings = readSettings() || {};
const CONFIG = {
  ENABLED: settings.narrative_agents?.reaction_director?.enabled !== false,
  MODEL: settings.narrative_agents?.reaction_director?.model || 'lowendmodel',
  PROMPT_PATH: 'engine/prompts/reaction_director.txt',
  RETRIES: settings.narrative_agents?.reaction_director?.retries || 3,
  TIMEOUT: settings.narrative_agents?.reaction_director?.timeout || 120000,
  LLM_PARAMS: settings.narrative_agents?.reaction_director?.llm_params || {
    max_tokens: 3000,
    temperature: 0.1
  }
};

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getSceneLines(turnContext) {
  const lines = turnContext?.processed?.vnManager?.processedLines;
  return Array.isArray(lines) ? lines : [];
}

function buildReactionProfiles(turnContext, spriteCatalog) {
  const lines = getSceneLines(turnContext);
  const playerName = normalizeName(turnContext?.input?.playerCharacterName || 'Player');
  const candidateNames = [];
  const seenNames = new Set();
  const addCandidate = (value) => {
    const normalized = normalizeName(value);
    if (!normalized || normalized === playerName || normalized === 'narrator' || normalized === 'system' || seenNames.has(normalized)) return;
    seenNames.add(normalized);
    candidateNames.push(String(value).trim());
  };

  lines.filter(line => line?.type === 'dialogue').forEach(line => addCandidate(line.character));
  (Array.isArray(turnContext?.output?.party) ? turnContext.output.party : []).forEach(addCandidate);

  const spriteMetadata = turnContext?.runtime?.vnManager?.spriteMetadata;
  const profiles = [];
  for (const displayName of candidateNames) {
    const characterKey = resolveCatalogCharacterKey(displayName, spriteCatalog);
    const characterState = characterKey ? spriteCatalog?.characters?.[characterKey] : null;
    const emotions = [...new Set((characterState?.emotions || []).map(normalizeName).filter(Boolean))];
    if (emotions.length < 2) continue;
    profiles.push({
      displayName,
      normalizedName: normalizeName(displayName),
      characterKey,
      emotions,
      guidance: String(spriteMetadata?.characters?.[characterKey]?.emotionGuidance || '').trim()
    });
  }
  return profiles;
}

function formatReactionProfiles(profiles) {
  return profiles.map(profile => {
    const guidance = profile.guidance ? ` | guidance: ${profile.guidance}` : '';
    return `${profile.normalizedName}: ${profile.emotions.join(', ')}${guidance}`;
  }).join('\n');
}

function formatEmotionAnnotatedScene(turnContext) {
  return getSceneLines(turnContext).map((line, index) => {
    const text = String(line?.text ?? line?.line ?? '').trim();
    if (!text) return '';
    if (line.type === 'dialogue') {
      const emotion = normalizeName(line.emotion || 'neutral') || 'neutral';
      return `${index}. ${line.character || 'Unknown'} [speaker expression: ${emotion}]: ${text}`;
    }
    return `${index}. Narration: ${text}`;
  }).filter(Boolean).join('\n');
}

function buildReactionPrompt(template, options = {}) {
  return String(template || '')
    .replace('{REACTION_PROFILES}', formatReactionProfiles(options.profiles || []))
    .replace('{INDEXED_SCENE_WITH_SPEAKER_EXPRESSIONS}', options.indexedScene || '')
    .replace('${project_directives}', options.projectDirectives || '');
}

function extractReactionArray(responseContent) {
  const match = String(responseContent || '').match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed?.reactions) ? parsed.reactions : [];
  } catch {
    return [];
  }
}

function parseReactionResponse(responseContent, turnContext, spriteCatalog, profiles) {
  const lines = getSceneLines(turnContext);
  const profileByName = new Map((profiles || []).map(profile => [profile.normalizedName, profile]));
  const rawReactions = extractReactionArray(responseContent);
  const candidates = [];
  const seenAtLine = new Set();

  for (const rawReaction of rawReactions) {
    const sceneLineIndex = Number(rawReaction?.line);
    const character = normalizeName(rawReaction?.character);
    const emotion = normalizeName(rawReaction?.emotion);
    const profile = profileByName.get(character);
    if (!Number.isInteger(sceneLineIndex) || sceneLineIndex < 0 || sceneLineIndex >= lines.length || !profile || !emotion) continue;

    const line = lines[sceneLineIndex];
    if (line?.type === 'dialogue' && normalizeName(line.character) === character) continue;

    const allowedEmotions = getAllowedEmotionsForDialogueLine(
      { character: profile.displayName },
      sceneLineIndex,
      turnContext,
      spriteCatalog,
      profile.emotions
    ).map(normalizeName);
    if (!allowedEmotions.includes(emotion)) continue;

    const lineCharacterKey = `${sceneLineIndex}:${character}`;
    if (seenAtLine.has(lineCharacterKey)) continue;
    seenAtLine.add(lineCharacterKey);
    candidates.push({
      line: sceneLineIndex,
      character: profile.displayName,
      emotion,
      reason: typeof rawReaction.reason === 'string' ? rawReaction.reason.trim().slice(0, 300) : ''
    });
  }

  candidates.sort((left, right) => left.line - right.line);
  const currentEmotion = new Map();
  const reactionsByLine = new Map();
  for (const reaction of candidates) {
    if (!reactionsByLine.has(reaction.line)) reactionsByLine.set(reaction.line, []);
    reactionsByLine.get(reaction.line).push(reaction);
  }

  const accepted = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line?.type === 'dialogue' && line.character) {
      currentEmotion.set(normalizeName(line.character), normalizeName(line.emotion || 'neutral'));
    }
    for (const reaction of reactionsByLine.get(lineIndex) || []) {
      const characterKey = normalizeName(reaction.character);
      if (currentEmotion.get(characterKey) === reaction.emotion) continue;
      currentEmotion.set(characterKey, reaction.emotion);
      accepted.push(reaction);
    }
  }
  return accepted;
}

async function directReactions(turnContext, spriteCatalog) {
  if (!CONFIG.ENABLED || turnContext?.reactionDirectorEnabled === false) {
    Logger.log('ReactionDirector', 'Execution', 'Reaction Director is disabled. Skipping.');
    return [];
  }

  const profiles = buildReactionProfiles(turnContext, spriteCatalog);
  if (profiles.length === 0 || getSceneLines(turnContext).length === 0) return [];

  try {
    const template = readFileSync(CONFIG.PROMPT_PATH);
    if (!template) throw new Error(`Failed to load Reaction Director prompt from ${CONFIG.PROMPT_PATH}`);
    const projectDirectives = turnContext.getFormattedDirective('reaction_director', {
      header: '=== PROJECT DIRECTIVES ==='
    });
    const prompt = buildReactionPrompt(template, {
      profiles,
      indexedScene: formatEmotionAnnotatedScene(turnContext),
      projectDirectives
    });
    const messages = buildCoreVnLlmMessages(turnContext, prompt, { scene: 'none' });

    Logger.log('ReactionDirector', 'Request', `Reviewing reactions for ${profiles.length} expression-capable characters...`, 'start');
    TurnLogger.logRequest('Reaction Director', messages, CONFIG.MODEL, resolveModelAlias(CONFIG.MODEL).provider);
    const { content: responseContent, model: actualModel } = await callLLM({
      model: CONFIG.MODEL,
      messages,
      retries: CONFIG.RETRIES,
      timeout: CONFIG.TIMEOUT,
      ...CONFIG.LLM_PARAMS,
      callingModule: 'ReactionDirector',
      turnLogTitle: 'Reaction Director'
    });
    TurnLogger.logResponse('Reaction Director', responseContent, actualModel, resolveModelAlias(CONFIG.MODEL).provider);

    const reactions = parseReactionResponse(responseContent, turnContext, spriteCatalog, profiles);
    Logger.log('ReactionDirector', 'Parsing', `Accepted ${reactions.length} sparse expression changes.`, 'end');
    return reactions;
  } catch (error) {
    Logger.error('ReactionDirector', 'Execution', 'Reaction direction failed:', error);
    return [];
  }
}

module.exports = {
  buildReactionProfiles,
  buildReactionPrompt,
  directReactions,
  formatEmotionAnnotatedScene,
  parseReactionResponse
};

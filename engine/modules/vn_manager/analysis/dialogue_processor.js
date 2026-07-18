const { Logger, readSettings, TurnLogger, readFileSync, sanitizeForCrc } = require('../../utils.js');
const { callLLM } = require('../../llm.js');
const crc32 = require('crc-32');

// #region MODULE IMPORTS
// #endregion

// CONFIG is now a dynamic getter to ensure settings updates are reflected
const getConfig = () => {
  const settings = readSettings();
  return {
    MODEL: settings.narrative_agents?.dialogue_processor?.model ?? 'highendmodel',
    PROVIDER: settings.narrative_agents?.dialogue_processor?.provider,
    RETRIES: settings.narrative_agents?.dialogue_processor?.retries,
    TIMEOUT: settings.narrative_agents?.dialogue_processor?.timeout,
    LLM_PARAMS: settings.narrative_agents?.dialogue_processor?.llm_params
      ? settings.narrative_agents.dialogue_processor.llm_params
      : {
        max_tokens: 10000,
        temperature: 0.3
      },
    ENABLED: settings.narrative_agents?.dialogue_processor?.enabled !== false, // default true
    // Logic Thresholds
    PARALLEL_SPLIT_THRESHOLD: 2500,
    PARALLEL_SPLIT_TARGET: 2000,
    FAST_PATH_MIN_DIALOGUE_RATIO: 0.20,
    MAX_STRIP_HEADERS: 3,
    MAX_CHARACTER_WORDS: 3
  };
};

const JUNK_HEADER_PATTERNS = [
  /^(\*\*|#)*\s*(Chapter|Turn)\s*\d+[:]?\s*(\*\*)*$/i,
  /^Attempts to:/i,
  /^(\*\*|#)*\s*\[.*\]\s*(\*\*)*$/,
  /^(\*\*|#)*\s*(Narration|Narrative)\s*(\*\*)*$/i,
];

const JUNK_FOOTER_PATTERNS = [
  /^(\*\*|#)*\s*\[?\s*end of (chapter|scene|story|transmission|response|turn|text)\s*\]?\s*(\*\*)*$/i,
  /^(\*\*|#)*\s*\[?\s*(end|fin|the end)\s*\]?\s*(\*\*)*$/i,
  /^(\*\*|#)*\s*<\|?end[_\-\s]?(of[_\-\s]?(text|turn|response|chapter|scene|of_turn))?\|?>\s*(\*\*)*$/i,
  /^(\*\*|#)*\s*<\/s>\s*(\*\*)*$/i,
];

const GLOBAL_CLEANUP_PATTERNS = [
  /(\*\*|#)*\s*\[beat[^\]]*\]\s*(\*\*|#)*/gi,
  /(\*\*|#)*\s*\[scene[^\]]*\]\s*(\*\*|#)*/gi,
  /(\*\*|#)*\s*\(transition[^)]*\)\s*(\*\*|#)*/gi,
];

const LEAKED_TAG_PATTERNS = [
  /<\/?(thinking|analysis|reasoning)\b[^>]*>/gi,
  /<\/?(meta_context|dialogue)\b[^>]*>/gi,
  /```(?:[\w-]+)?|```/g,
];

const STANDALONE_STRUCTURE_PATTERNS = [
  /^\s*(?:[#>*-]+\s*)?(?:beat|scene|chapter|act|arc|part|section)\s*(?:[ivxlcdm]+|\d+)?(?:\s*[-:]\s*.*)?$/i,
  /^\s*(?:[#>*-]+\s*)?(?:output|format|instructions?|analysis|reasoning|meta[_\s-]?context|dialogue|objective|foreshadowing(?:\s+seed)?)\s*[:\-]\s*.*$/i,
  /^\s*(?:[-*]\s*)?(?:internal monologues?|objectives?|foreshadowing(?:\s+seed)?)\s*[:\-]\s*.*$/i,
];

const META_SPEAKER_WORDS = new Set([
  'beat', 'scene', 'chapter', 'act', 'arc', 'part', 'section',
  'output', 'format', 'instruction', 'instructions', 'analysis', 'reasoning',
  'dialogue', 'narrative', 'objective', 'objectives', 'foreshadowing',
  'system', 'assistant', 'user'
]);

const DOUBLE_QUOTE_CHAR_REGEX = /^["\u201C\u201D]/;
const QUOTED_FRAGMENT_REGEX = /["\u201C\u201D]([^"\u201C\u201D\n]+)["\u201C\u201D]/g;
const QUOTED_SPAN_REGEX = /["\u201C\u201D][^"\u201C\u201D\n]+["\u201C\u201D]/g;

const dialogueProcessorPrompt = readFileSync("engine/prompts/dialogue_processor_prompt.txt");
const dialogueTagRegex = /<dialogue>([\s\S]*?)<\/dialogue>/is;
const validationFormatRegex = /<dialogue>(?=[\s\S]*?[^\s:<>][^\s:<>]*\s*:\s*[^\s<][\s\S]*?[^\s:<>][^\s:<>]*\s*:\s*[^\s<])[\s\S]*?<\/dialogue>/is;
// #region SHARED HELPERS
/**
 * Strips junk headers from the beginning of an array of lines.
 * @param {string[]} lines - Array of strings.
 * @param {number} maxStrip - Maximum lines to strip.
 * @returns {string[]} The remaining lines.
 */
function stripLeadingHeaders(lines, maxStrip = 3) {
  let stripped = 0;
  while (lines.length > 0 && stripped < maxStrip) {
    const line = lines[0].trim();
    if (JUNK_HEADER_PATTERNS.some(p => p.test(line))) {
      lines.shift();
      stripped++;
    } else {
      break;
    }
  }
  return lines;
}

/**
 * Strips junk footers from the end of an array of lines.
 * @param {string[]} lines - Array of strings.
 * @returns {string[]} The remaining lines.
 */
function stripTrailingJunk(lines) {
  while (lines.length > 0) {
    const lastLine = lines[lines.length - 1].trim();
    if (lastLine === "" || JUNK_FOOTER_PATTERNS.some(p => p.test(lastLine))) {
      lines.pop();
    } else {
      break;
    }
  }
  return lines;
}

function isStandaloneStructuralLine(line) {
  return STANDALONE_STRUCTURE_PATTERNS.some(pattern => pattern.test(line));
}

function collapseQuotedInterjectionsForTts(text) {
  if (typeof text !== 'string' || !/["\u201C\u201D]/.test(text)) return text;

  const trimmed = text.trim();
  if (!DOUBLE_QUOTE_CHAR_REGEX.test(trimmed)) return text;

  const matches = [...trimmed.matchAll(QUOTED_FRAGMENT_REGEX)];
  if (matches.length < 2) return text;

  const fragments = matches.map(m => m[1].trim()).filter(Boolean);
  if (fragments.length < 2) return text;

  let merged = fragments[0];
  for (let i = 1; i < fragments.length; i++) {
    const cleanFragment = fragments[i].replace(/^[,;:-]+\s*/, '').trim();
    if (!cleanFragment) continue;
    if (/[.!?…]$/.test(merged)) merged += ` ${cleanFragment}`;
    else if (/[,;:]$/.test(merged)) merged += ` ${cleanFragment}`;
    else merged += `, ${cleanFragment}`;
  }

  return `"${merged}"`;
}

function normalizeDialogueTagTail(fragment) {
  if (typeof fragment !== 'string') return '';
  let tail = fragment.trim();
  if (!tail) return '';
  tail = tail.replace(/^[,;:.\-!?()\[\]\s]+/, '').trim();
  return tail;
}

function isMostlyDialogueTagClause(fragment) {
  if (!fragment || typeof fragment !== 'string') return false;
  const tail = normalizeDialogueTagTail(fragment);
  if (!tail) return true;

  const compact = tail.replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!compact) return true;
  const tokens = compact.split(' ').filter(Boolean);
  return tokens.length <= 10;
}

function normalizeDialogueTextCore(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const quoteMatches = [...trimmed.matchAll(QUOTED_FRAGMENT_REGEX)];
  if (quoteMatches.length === 0) return trimmed;

  const outside = trimmed.replace(QUOTED_SPAN_REGEX, ' ').replace(/\s+/g, ' ').trim();
  if (!outside) return collapseQuotedInterjectionsForTts(trimmed);

  if (isMostlyDialogueTagClause(outside)) {
    const fragments = quoteMatches.map(m => m[1].trim()).filter(Boolean);
    if (fragments.length > 0) {
      return collapseQuotedInterjectionsForTts(`"${fragments.join('", "')}"`);
    }
  }

  return collapseQuotedInterjectionsForTts(trimmed);
}
// #endregion

// #region VALIDATION UTILITIES
/**
 * Counts the number of dialogue tags and total dialogue length in a given text.
 * @param {string} text - The text to analyze.
 * @returns {{tagCount: number, totalLength: number}}
 */
function countDialogueTagsAndLength(text) {
  let tagCount = 0;
  let totalLength = 0;
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^([^:\n]{1,50}):\s*(.*)/);
    if (match && isValidCharacterName(match[1].trim())) {
      tagCount++;
      totalLength += match[2].trim().length;
    }
  }
  return { tagCount, totalLength };
}

/**
 * Validates the output of the dialogue processor against the original text.
 * @param {string} responseContent - The LLM's response.
 * @param {Array} messages - The messages sent to the LLM (used to extract original text).
 * @returns {boolean} True if valid, throws error if invalid.
 */
function validateDialogueProcessing(responseContent, messages) {
  // Extract the original text from the last message (user prompt)
  const lastMessage = messages[messages.length - 1].content;
  const originalTextMatch = lastMessage.match(/\[Text to convert\]\s*([\s\S]*)$/i);
  if (!originalTextMatch) return true; // Can't find original text, skip validation

  const originalText = originalTextMatch[1];
  const originalStats = countDialogueTagsAndLength(originalText);

  // Extract dialogue from response if tags are present
  let processedDialogue = responseContent;
  const tagMatch = responseContent.match(/<dialogue>([\s\S]*?)<\/dialogue>/is);
  if (tagMatch) {
    processedDialogue = tagMatch[1].trim();
  }
  const processedStats = countDialogueTagsAndLength(processedDialogue);

  // Apply thresholds
  // 1. Tag count: Must preserve at least 85% of original tags
  if (originalStats.tagCount > 0) {
    const tagThreshold = originalStats.tagCount * 0.85;
    if (processedStats.tagCount < tagThreshold) {
      throw new Error(`Dialogue loss detected (Tags). Original: ${originalStats.tagCount}, Processed: ${processedStats.tagCount}. Expected at least ${Math.ceil(tagThreshold)}.`);
    }
  }

  // 2. Character count: Must preserve at least 75% of original dialogue text
  if (originalStats.totalLength > 0) {
    const lengthThreshold = originalStats.totalLength * 0.75;
    if (processedStats.totalLength < lengthThreshold) {
      throw new Error(`Dialogue loss detected (Content). Original: ${originalStats.totalLength} chars, Processed: ${processedStats.totalLength} chars. Expected at least ${Math.ceil(lengthThreshold)}.`);
    }
  }

  return true;
}

/**
 * Validates if a given string is a valid character name for dialogue processing.
 * @param {string} character - The character name to validate.
 * @returns {boolean} True if the character name is valid, false otherwise.
 */
function isValidCharacterName(character) {
  if (!character || typeof character !== 'string') return false;

  const trimmed = character.trim();
  const lower = trimmed.toLowerCase();

  // Reject names with markdown or systemic symbols to prevent junk like "**Visible Crack"
  if (/[*#\[\]()<>{}_]/.test(trimmed)) return false;

  // --- TIER 1: STRUCTURAL HEURISTICS (AUTO-REJECT NON-CHARACTERS) ---

  // 1. Pure numbers (e.g., "00", "12")
  if (/^\d+$/.test(trimmed)) return false;

  // 2. Time expressions (e.g., "10:00 AM", "5:30", "3 PM", "Five O'Clock")
  if (/^\d{1,2}[:.]\d{2}\s*(AM|PM)?$/i.test(trimmed)) return false;
  if (/^\d{1,2}\s*(AM|PM)$/i.test(trimmed)) return false;
  if (lower.endsWith("o'clock") || /^(half past|quarter to)\b/i.test(trimmed)) return false;

  // 3. Time-of-day words and common non-entities
  const NON_ENTITY_WORDS = new Set([
    'morning', 'afternoon', 'evening', 'night', 'midnight', 'dawn', 'dusk', 'noon', 'sunrise', 'sunset',
    'narrator', 'system', '???', 'unknown', 'voice', 'thoughts', 'inner voice', 'conscience', 'flashback', 'memory', 'dream', 'vision', 'echo'
  ]);
  if (NON_ENTITY_WORDS.has(lower)) return false;
  if (META_SPEAKER_WORDS.has(lower)) return false;
  if (/^(beat|scene|chapter|act|arc|part|section)\b/i.test(trimmed)) return false;

  // 4. Dates (e.g., "March 15th", "Jan 3")
  const MONTHS_REGEX = /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i;
  if (MONTHS_REGEX.test(trimmed) && /\d+/.test(trimmed)) return false;

  // 5. Durations (e.g., "3 hours later", "2 days ago")
  if (/^\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*(later|ago|earlier)?$/i.test(trimmed)) return false;

  // --- STANDARD NAME VALIDATION ---
  const wordCount = trimmed.split(/\s+/).length;

  // Target action phrases, not word suffixes (to avoid rejecting Sterling, Red, etc)
  const isActionPhrase = /^(walking|running|looking|standing|moving|attacked|continued|visible)\b/i.test(trimmed);
  
  // "King's" but not "Amos"
  const hasPossessive = /'.+s$/i.test(trimmed);

  return !isActionPhrase && !hasPossessive && wordCount <= getConfig().MAX_CHARACTER_WORDS;
}
// #endregion

// removed local sanitizeForCrc to use the one from utils.js

// #region PROMPT CREATION
/**
 * Creates a prompt for the LLM to transform raw text into structured dialogue.
 * @param {object} turnContext - The turn context.
 * @param {string} [textOverride=null] - Optional text to transform instead of the default.
 * @returns {string} The prompt string for dialogue transformation.
 */
function createDialogueTransformPrompt(turnContext, textOverride = null) {
  const sourceText = textOverride || turnContext.processed.narrativeEngine.writerResponse;
  const playerCharacterName = turnContext.input.playerCharacterName || 'Player';
  const projectDirectives = turnContext.getFormattedDirective('dialogue_processor', { header: 'CREATIVE DIRECTIVES:' });

  let prompt = dialogueProcessorPrompt
    .replace('${text}', sourceText)
    .replace('${playerCharacterName}', playerCharacterName)
    .replace('${project_directives}', projectDirectives);

  return prompt;
}

/**
 * Splits text into two parts at a logical paragraph break near a target word count.
 * @param {string} text - The text to split.
 * @param {number} targetWordCount - The approximate word count where to split.
 * @returns {string[]} An array with [part1, part2].
 */
function splitTextAtWordCount(text, targetWordCount) {
  const lines = text.split('\n');
  let currentWordCount = 0;
  let splitLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const wordCount = lines[i].trim().split(/\s+/).filter(w => w.length > 0).length;
    currentWordCount += wordCount;
    if (currentWordCount >= targetWordCount) {
      splitLineIndex = i;
      break;
    }
  }

  if (splitLineIndex === -1 || splitLineIndex === lines.length - 1) {
    return [text, ""];
  }

  const part1 = lines.slice(0, splitLineIndex + 1).join('\n');
  const part2 = lines.slice(splitLineIndex + 1).join('\n');
  return [part1, part2];
}

/**
 * Extracts dialogue content from an LLM response.
 * @param {string} responseContent - The raw LLM response.
 * @returns {string}
 */
function extractDialogue(responseContent) {
  const tagMatch = responseContent.match(dialogueTagRegex);
  if (tagMatch) {
    return tagMatch[1].trim();
  }
  return responseContent.trim();
}
// #endregion

// #region CORE DIALOGUE PROCESSING
/**
 * Processes raw text into structured dialogue lines.
 * @param {object} turnContext - The turn context.
 * @returns {Promise<{processedLines: Array, dialogue: string}>}
 */
async function processDialogueLines(turnContext) {
  const config = getConfig();
  let text = turnContext.processed.narrativeEngine.writerResponse;

  // Strip [Interlude Summaries] and anything that follows it
  const interludeIndex = text.search(/(?:^|\n)[ \t]*\[Interlude Summaries\]/i);
  if (interludeIndex !== -1) {
    text = text.substring(0, interludeIndex);
  }

  if (!config.ENABLED || turnContext.dialogueProcessorEnabled === false) {
    Logger.log('DialogueProcessor', 'Generation', 'Dialogue processor is disabled. Using dumb fallback.');
    const lineFilter = l => l.trim().length > 0 && !/^(\*\*|#)*\s*(Narration|Narrative)\s*(\*\*)*$/i.test(l.trim());
    const lines = text.split('\n').filter(lineFilter).map(line => ({ line: line.trim(), type: 'narrative' }));
    return { processedLines: lines, dialogue: text };
  }

  const pacerMode = turnContext.processed?.pacer?.mode || 'COMPLEX';
  const fastPathThreshold = pacerMode === 'SIMPLE' ? (config.FAST_PATH_MIN_DIALOGUE_RATIO / 2) : config.FAST_PATH_MIN_DIALOGUE_RATIO;

  // --- FAST PATH HEURISTIC ---
  let rawLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  rawLines = stripLeadingHeaders(rawLines, config.MAX_STRIP_HEADERS);

  let validDialogueLineCount = 0;
  for (const line of rawLines) {
    const match = line.match(/^([^:\n]{1,50}):\s*(.*)/);
    if (match && isValidCharacterName(match[1].trim())) {
      validDialogueLineCount++;
    }
  }

  const hasTags = text.includes('<thinking>') || text.includes('<dialogue>');
  const dialogueRatio = rawLines.length > 0 ? (validDialogueLineCount / rawLines.length) : 0;
  const isFastPathEligible = !hasTags && dialogueRatio >= fastPathThreshold && validDialogueLineCount > 0;

  if (isFastPathEligible) {
    Logger.log('DialogueProcessor', 'Generation', `Fast path enabled! Dialogue ratio: ${(dialogueRatio * 100).toFixed(1)}% (Threshold: ${(fastPathThreshold * 100).toFixed(1)}%). Skipping LLM call.`);
    text = rawLines.join('\n');
  } else {
    Logger.log('DialogueProcessor', 'Generation', 'Starting dialogue processing...', 'start');
    try {
      const wordCount = text.trim().split(/\s+/).length;
      let responseContent = "";

      // Parallel Processing
      if (wordCount > config.PARALLEL_SPLIT_THRESHOLD) {
        const [part1, part2] = splitTextAtWordCount(text, config.PARALLEL_SPLIT_TARGET);
        if (part2.length > 0) {
          Logger.log('DialogueProcessor', 'Generation', `Large input (${wordCount} words). Splitting parallel.`);
          const prompt1 = createDialogueTransformPrompt(turnContext, part1);
          const prompt2 = createDialogueTransformPrompt(turnContext, part2);

          TurnLogger.logRequest('DialogueProcessor (Parallel 1)', prompt1, config.MODEL, config.PROVIDER);
          TurnLogger.logRequest('DialogueProcessor (Parallel 2)', prompt2, config.MODEL, config.PROVIDER);

          const startTime = Date.now();
          const [res1, res2] = await Promise.all([
            callLLM({
              model: config.MODEL, provider: config.PROVIDER, retries: config.RETRIES, timeout: config.TIMEOUT,
              messages: [{ role: 'user', content: prompt1 }],
              validationRegex: validationFormatRegex, validateFn: validateDialogueProcessing,
              ...config.LLM_PARAMS, callingModule: 'DialogueProcessor',
              turnLogTitle: 'DialogueProcessor (Parallel 1)'
            }),
            callLLM({
              model: config.MODEL, provider: config.PROVIDER, retries: config.RETRIES, timeout: config.TIMEOUT,
              messages: [{ role: 'user', content: prompt2 }],
              validationRegex: validationFormatRegex, validateFn: validateDialogueProcessing,
              ...config.LLM_PARAMS, callingModule: 'DialogueProcessor',
              turnLogTitle: 'DialogueProcessor (Parallel 2)'
            })
          ]);

          TurnLogger.logResponse('DialogueProcessor (Parallel 1)', res1.content, res1.model, config.PROVIDER);
          TurnLogger.logResponse('DialogueProcessor (Parallel 2)', res2.content, res2.model, config.PROVIDER);

          const p1 = extractDialogue(res1.content);
          const p2 = extractDialogue(res2.content);
          responseContent = `<dialogue>${p1}\n${p2}</dialogue>`;
          Logger.log('DialogueProcessor', 'Generation', `Parallel processing completed in ${Date.now() - startTime}ms.`, 'end');
        }
      }

      // Single-call flow
      if (!responseContent) {
        const prompt = createDialogueTransformPrompt(turnContext);
        TurnLogger.logRequest('DialogueProcessor', prompt, config.MODEL, config.PROVIDER);
        const { content: singleResponse, model: resolvedModel } = await callLLM({
          model: config.MODEL, provider: config.PROVIDER, retries: config.RETRIES, timeout: config.TIMEOUT,
          messages: [{ role: 'user', content: prompt }],
          validationRegex: validationFormatRegex, validateFn: validateDialogueProcessing,
          ...config.LLM_PARAMS, callingModule: 'DialogueProcessor',
          turnLogTitle: 'DialogueProcessor'
        });
        TurnLogger.logResponse('DialogueProcessor', singleResponse, resolvedModel, config.PROVIDER);
        responseContent = singleResponse;
        Logger.log('DialogueProcessor', 'Generation', 'DialogueProcessor response finalized.', 'end');
      }

      text = responseContent;

      // Safe Placeholder Replacement (excluding Narrator)
      const playerCharacterName = turnContext.input.playerCharacterName || 'Player';
      const PLACEHOLDERS_REGEX = /\b(Player|User|Protagonist|Hero|Main Character)\b/gi;
      text = text.replace(PLACEHOLDERS_REGEX, playerCharacterName);

    } catch (error) {
      Logger.error('DialogueProcessor', 'Generation', 'DialogueProcessor error, falling back:', error);
      Logger.log('DialogueProcessor', 'Generation', 'Aborting performance marker.', 'end');
      const lineFilter = l => l.trim().length > 0 && !/^(\*\*|#)*\s*(Narration|Narrative)\s*(\*\*)*$/i.test(l.trim());
      const lines = text.split('\n').filter(lineFilter).map(line => ({ line: line.trim(), type: 'narrative' }));
      return { processedLines: lines, dialogue: text };
    }
  }

  let dialogue = '';
  let scriptToProcess = text;
  const tagMatch = text.match(dialogueTagRegex);

  if (tagMatch) {
    dialogue = tagMatch[1].trim();
    scriptToProcess = dialogue;
  } else {
    // If no tags, the entire text is the dialogue
    dialogue = text;
    if (!isFastPathEligible) {
      Logger.warn('DialogueProcessor', 'Parsing', 'Dialogue tags not found. Using full text.');
    }
  }

  // Global cleanups (Beat markers, structural junk, etc)
  for (const pattern of GLOBAL_CLEANUP_PATTERNS) {
    scriptToProcess = scriptToProcess.replace(pattern, ' ');
  }
  for (const pattern of LEAKED_TAG_PATTERNS) {
    scriptToProcess = scriptToProcess.replace(pattern, ' ');
  }
  
  // Remove markdown leftovers and stray formatting symbols
  scriptToProcess = scriptToProcess.replace(/(\*\*|__|~~)/g, ''); // Bold, underline, strikethrough
  scriptToProcess = scriptToProcess.replace(/^\s*#+\s*/gm, '');   // Leading hashes (headers)
  
  scriptToProcess = scriptToProcess.replace(/  +/g, ' ');

  let scriptLines = scriptToProcess.split('\n').map(l => l.trim());
  scriptLines = stripLeadingHeaders(scriptLines, config.MAX_STRIP_HEADERS);
  scriptLines = stripTrailingJunk(scriptLines);
  scriptLines = scriptLines.filter(line => !isStandaloneStructuralLine(line));
  
  // Fast Path Sanity Check
  if (isFastPathEligible) {
    const dialogueCount = scriptLines.filter(line => {
      const match = line.match(/^([^:\n]{1,50}):\s*(.*)/);
      return match && isValidCharacterName(match[1].trim());
    }).length;
    if (dialogueCount === 0 && rawLines.length > 3) {
      Logger.warn('DialogueProcessor', 'FastPath', 'Fast path produced zero dialogue lines. Fallback recommended next time.');
    }
  }

  const processedLines = [];
  const PLAYER_PLACEHOLDERS = new Set(['player', 'user', 'protagonist', 'hero', 'main character']);
  const playerCharacterName = turnContext.input.playerCharacterName || 'Player';

  for (const line of scriptLines) {
    if (/^(\*\*|#)*\s*(Narration|Narrative)\s*(\*\*)*$/i.test(line)) continue;
    if (isStandaloneStructuralLine(line)) continue;

    const dialogueMatch = line.match(/^([^:\n]{1,50}):\s*(.*)/);
    if (dialogueMatch && isValidCharacterName(dialogueMatch[1].trim())) {
      let character = dialogueMatch[1].trim();
      const textVal = normalizeDialogueTextCore(dialogueMatch[2].trim());
      
      // Fix placeholder character tags
      if (PLAYER_PLACEHOLDERS.has(character.toLowerCase())) {
        character = playerCharacterName;
      }

      const crc = crc32.str(sanitizeForCrc(`${character}:${textVal}`)) >>> 0;
      processedLines.push({
        line: `${character}: ${textVal}`,
        character: character,
        text: textVal,
        crc: String(crc),
        type: 'dialogue'
      });
    } else if (line === '') {
      // Consecutive empty line collapsing
      if (processedLines.length > 0 && processedLines[processedLines.length - 1].type !== 'empty') {
        processedLines.push({ line: '', type: 'empty' });
      }
    } else {
      const crc = crc32.str(sanitizeForCrc(`Narrator:${line}`)) >>> 0;
      processedLines.push({ line: line, crc: String(crc), type: 'narrative' });
    }
  }

  Logger.log('DialogueProcessor', 'Parsing', 'Finished parsing dialogue lines.', 'end');
  return { processedLines, dialogue };
}
// #endregion

// #region EXPORTS
module.exports = { processDialogueLines, isValidCharacterName };
// #endregion

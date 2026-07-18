const { getFilename, Logger, TurnLogger, readSettings, uniqueAssetDirs, readFileSync, relativizeAssetPath } = require('../../utils.js');
const { callLLM, resolveModelAlias } = require('../../llm.js');
const { getStore } = require('../../memory_manager/storage/vector_store_manager.js');
const fs = require('fs');
const path = require('path');
const fuzzysort = require('fuzzysort');
const { filterForegroundOcclusionAssets } = require('./background_asset_helpers.js');
const { buildCoreVnLlmMessages } = require('../shared_llm_context.js');

// #region MODULE IMPORTS
// #endregion

// #region CONFIGURATION
const settings = readSettings();

const CONFIG = {
  BACKGROUND_MODEL: settings.narrative_agents?.asset_selector?.background_model || 'highendmodel',
  OST_MODEL: settings.narrative_agents?.asset_selector?.ost_model || 'highendmodel',
  BACKGROUND_PARAMS: settings.narrative_agents?.asset_selector?.background_params
    ? settings.narrative_agents.asset_selector.background_params
    : {
      max_tokens: 1500,
      temperature: 0.3,
      retries: 1,
      timeout: 120000
    },
  OST_PARAMS: settings.narrative_agents?.asset_selector?.ost_params
    ? settings.narrative_agents.asset_selector.ost_params
    : {
      max_tokens: 1500,
      temperature: 0.3,
      retries: 1,
      timeout: 120000
    }
};

const bgBasicPrompt = readFileSync("engine/prompts/bg_basic_prompt.txt");
const bgSmartFiltersPrompt = readFileSync("engine/prompts/bg_smart_filters_prompt.txt");
const bgSmartSelectionPrompt = readFileSync("engine/prompts/bg_smart_selection_prompt.txt");
const ostBasicPrompt = readFileSync("engine/prompts/ost_basic_prompt.txt");
const ostCategorySplitPrompt = readFileSync("engine/prompts/ost_category_split_prompt.txt");
const ostSmartFiltersPrompt = readFileSync("engine/prompts/ost_smart_filters_prompt.txt");
const ostSmartSelectionPrompt = readFileSync("engine/prompts/ost_smart_selection_prompt.txt");

const OST_CATEGORIES = ['calm', 'happy', 'sad', 'battle'];

/**
 * Retrieves the recently played OST history.
 * @param {TurnContext} turnContext - Current turn context.
 * @param {number} depth - How many turns to look back.
 * @returns {Promise<string[]>} List of recently played OST paths.
 */
async function getRecentOSTHistory(turnContext, depth = 10) {
  const recentSongs = [];
  let current = turnContext;
  for (let i = 0; i < depth; i++) {
    try {
      const prev = await current.getPreviousChapter();
      if (!prev) break;
      const song = prev.output?.finalSong;
      if (song) recentSongs.push(song);
      current = prev;
    } catch { break; }
  }
  return recentSongs;
}

/**
 * Samples a diverse set of candidates from a scored list, penalizing recently played assets.
 * @param {Array<object>} scored - List of candidates with compositeScore.
 * @param {string[]} recentAssetPaths - Paths of recently played assets.
 * @param {number} count - How many candidates to sample.
 * @param {number} topPoolSize - Size of the pool to sample from.
 * @returns {Array<object>} The sampled candidates.
 */
function sampleDiverseCandidates(scored, recentAssetPaths, count = 8, topPoolSize = 30) {
  if (!scored || scored.length === 0) return [];

  const recentSet = new Set(recentAssetPaths.map(s => path.parse(s).name.toLowerCase()));
  const pool = scored.slice(0, topPoolSize).map(candidate => {
    const isRecent = recentSet.has(candidate.name.toLowerCase());
    return {
      ...candidate,
      samplingWeight: isRecent
        ? candidate.compositeScore * 0.15
        : candidate.compositeScore
    };
  });

  // Weighted sampling without replacement
  const selected = [];
  const remaining = [...pool];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const totalWeight = remaining.reduce((sum, c) => sum + Math.max(c.samplingWeight, 0.01), 0);
    let r = Math.random() * totalWeight;
    let picked = remaining.length - 1;
    for (let j = 0; j < remaining.length; j++) {
      r -= Math.max(remaining[j].samplingWeight, 0.01);
      if (r <= 0) { picked = j; break; }
    }
    selected.push(remaining[picked]);
    remaining.splice(picked, 1);
  }
  return selected;
}

const OST_DIVERSITY_SEEDS = [
  'Prioritize tracks you have NOT suggested recently.',
  'Lean toward underrated or lesser-known tracks in the library.',
  'Try to diversify from your usual selections.',
  'Consider tracks that are unexpected but still fitting.',
  'Weight variety higher than perfect fit this time.',
  'Explore tracks from different regions or composers than usual.'
];

function getDiversitySeed(turnNumber) {
  return OST_DIVERSITY_SEEDS[turnNumber % OST_DIVERSITY_SEEDS.length];
}

function formatSelectedBackgroundSignal(turnContext) {
  const bgChanges = Array.isArray(turnContext?.output?.bgChanges)
    ? turnContext.output.bgChanges
    : [];
  const draftBackground =
    turnContext?.processed?.assetSelector?.backgroundDraft ||
    turnContext?.processed?.assetSelector?.background ||
    turnContext?.output?.finalBackground ||
    '';

  const entries = bgChanges
    .filter(change => change && change.path)
    .map(change => {
      const rawLine = Number(change.line);
      const line = Number.isFinite(rawLine) ? Math.max(0, Math.round(rawLine)) : 0;
      return `Line ${line}: ${getFilename(change.path) || path.basename(change.path)}`;
    });

  if (draftBackground && !entries.some(entry => entry.startsWith('Line 0:'))) {
    entries.unshift(`Line 0: ${getFilename(draftBackground) || path.basename(draftBackground)}`);
  }

  if (entries.length === 0) return '';

  return [
    '### BACKGROUND SELECTOR SIGNAL (SOFT HINT):',
    'The background selector has already chosen visual setting changes for these script lines.',
    'Use this as a gentle timing, location, and atmosphere hint when it agrees with the script, especially for OST changes near the same line.',
    'This is just important in case you want to change the OST based on location, in this situation its ideal to match the same line as the background for a smooth transition.',
    'However, not override the emotional tone of the scene just to match a background filename!',
    'This is also not mandatory in any way, if it makes sense, change the music whenever you want, after all, there might be OST changes without any location changes! Combat, emotional moments, a different area, etc, there are lot of reasons.',
    '',
    ...entries
  ].join('\n');
}

/**
 * Shared schema discovery for metadata-driven asset selection.
 * Collects up to 6 maximally distinct sample values per string field.
 * @param {Array<object>} metadataList - The parsed metadata.json array.
 * @returns {{ schemaDesc: string, keyTypes: object, numericRanges: object }}
 */
function buildSchemaDescription(metadataList) {
  const SAMPLE_COUNT = 6;
  const SKIP_KEYS = new Set(['name', 'slug', 'src']);

  const schemaKeys = new Set();
  const keyTypes = {};       // 'numeric' | 'string'
  const numericRanges = {};  // { key: { min, max } }
  const allStringValues = {};  // { key: Set<string> }

  // â”€â”€ Pass 1: collect types, ranges, and all unique string values â”€â”€â”€â”€â”€â”€
  for (const item of metadataList) {
    for (const k of Object.keys(item)) {
      if (SKIP_KEYS.has(k)) continue;
      schemaKeys.add(k);

      if (!keyTypes[k]) {
        keyTypes[k] = typeof item[k] === 'number' ? 'numeric' : 'string';
      }

      if (keyTypes[k] === 'numeric' && typeof item[k] === 'number') {
        if (!numericRanges[k]) numericRanges[k] = { min: item[k], max: item[k] };
        numericRanges[k].min = Math.min(numericRanges[k].min, item[k]);
        numericRanges[k].max = Math.max(numericRanges[k].max, item[k]);
      } else if (keyTypes[k] === 'string' && typeof item[k] === 'string' && item[k].trim()) {
        if (!allStringValues[k]) allStringValues[k] = new Set();
        allStringValues[k].add(item[k].trim());
      }
    }
  }

  // â”€â”€ Pass 2: pick up to SAMPLE_COUNT maximally diverse samples â”€â”€â”€â”€â”€â”€â”€â”€
  const diverseSamples = {}; // { key: string[] }

  for (const k of schemaKeys) {
    if (keyTypes[k] !== 'string' || !allStringValues[k]) continue;
    const pool = Array.from(allStringValues[k]);
    if (pool.length <= SAMPLE_COUNT) {
      diverseSamples[k] = pool;
      continue;
    }

    // Greedy diversity selection using token-overlap
    const tokenize = v => new Set(v.toLowerCase().split(/[\s,;|/]+/).filter(Boolean));
    const selected = [pool[0]];
    const selectedTokenSets = [tokenize(pool[0])];

    while (selected.length < SAMPLE_COUNT) {
      let bestIdx = -1;
      let bestScore = Infinity; // lower overlap = better
      for (let i = 0; i < pool.length; i++) {
        if (selected.includes(pool[i])) continue;
        const candidateTokens = tokenize(pool[i]);
        // Sum of overlap ratios with every already-selected sample
        let overlapSum = 0;
        for (const st of selectedTokenSets) {
          let shared = 0;
          for (const t of candidateTokens) { if (st.has(t)) shared++; }
          const union = new Set([...candidateTokens, ...st]).size;
          overlapSum += union > 0 ? shared / union : 0;
        }
        if (overlapSum < bestScore) {
          bestScore = overlapSum;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;
      selected.push(pool[bestIdx]);
      selectedTokenSets.push(tokenize(pool[bestIdx]));
    }
    diverseSamples[k] = selected;
  }

  // â”€â”€ Build the schema description string â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const schemaDesc = Array.from(schemaKeys).map(k => {
    const type = keyTypes[k];
    if (type === 'numeric' && numericRanges[k]) {
      return `- ${k} [${type}, range: ${numericRanges[k].min}â€“${numericRanges[k].max}]`;
    }
    const examples = diverseSamples[k] || [];
    return `- ${k} [${type}] (examples: ${examples.join(', ')})`;
  }).join('\n');

  return { schemaDesc, keyTypes, numericRanges };
}

/**
 * Shared helper to parse LLM responses that follow the "Line X: [AssetName]" format.
 * Returns { path: string, changes: Array<{line, path}> }
 */
function parseMultiAssetSelection(llmSelection, assets, filenames, defaultPath = null) {
  // 1. Build an index for O(1) exact lookups
  const assetMap = new Map();
  assets.forEach((p, i) => {
    const filename = filenames[i].toLowerCase();
    const basename = path.parse(filename).name.toLowerCase();
    assetMap.set(filename, p);
    // Only map basename if it's unique, otherwise prioritize full filename
    if (!assetMap.has(basename)) {
      assetMap.set(basename, p);
    }
  });

  // Pre-calculate sorted filenames for regex-free matching (longest first)
  const sortedKeys = Array.from(assetMap.keys()).sort((a, b) => b.length - a.length);

  const lines = llmSelection.split('\n');
  const allChanges = [];

  for (const line of lines) {
    // Accept common markdown wrappers such as:
    // - "**Line 10:** Track.mp3"
    // - "* Line 10: Track.mp3"
    // - "- Line 10: Track.mp3"
    const normalizedLine = String(line || '').trim();
    const lineMatch = normalizedLine.match(/^(?:[-*]\s*)?(?:\*{1,2}\s*)?Line\s+(\d+)\s*:\s*(?:\*{1,2}\s*)?(.*)$/i);
    if (!lineMatch) continue;

    const lineIdx = parseInt(lineMatch[1], 10);
    const lineText = lineMatch[2].toLowerCase();
    let matchedPath = null;

    // 2. Search for the longest exact filename/basename match in this line
    for (const key of sortedKeys) {
      if (lineText.includes(key)) {
        matchedPath = assetMap.get(key);
        break;
      }
    }

    // 3. Last-ditch Fuzzy Fallback if no exact match found
    if (!matchedPath) {
      const options = assets.map(p => ({ path: p, filename: path.basename(p), basename: path.parse(p).name }));
      const res = fuzzysort.go(lineText.split('//')[0].split('-')[0].trim(), options, { key: 'filename' });
      if (res && res.length > 0 && res[0].score > -1500) {
        matchedPath = res[0].obj.path;
      }
    }

    if (matchedPath && !allChanges.find(c => c.line === lineIdx)) {
      allChanges.push({ line: lineIdx, path: matchedPath });
    }
  }

  // 4. Fallback if no lines matched structured criteria
  if (allChanges.length === 0) {
    const fullText = llmSelection.toLowerCase();
    for (const key of sortedKeys) {
      if (fullText.includes(key)) {
        const p = assetMap.get(key);
        return { path: p, changes: [{ line: 0, path: p }] };
      }
    }
    if (defaultPath) {
      Logger.warn('AssetSelector', 'AssetParse', `No structured line matches found in multi-asset selection. Falling back to default path: ${getFilename(defaultPath) || defaultPath}`);
      return { path: defaultPath, changes: [] };
    }
    Logger.warn('AssetSelector', 'AssetParse', 'No structured line matches found in multi-asset selection and no default path was provided.');
    return null;
  }

  // Identify starting asset (Line 0 or Default)
  const line0Entry = allChanges.find(c => c.line === 0);
  const startingPath = line0Entry ? line0Entry.path : defaultPath;

  return { path: startingPath, changes: allChanges };
}

/**
 * Scores a list of assets based on provided filters.
 * @param {Array<object>} metadataList - The parsed metadata entries.
 * @param {Array<object>} filters - The LLM-generated filters.
 * @param {object} keyTypes - Types of metadata keys.
 * @param {object} numericRanges - Ranges for numeric keys.
 * @returns {Array<object>} Sorted list of scored candidates.
 */
function scoreAssets(metadataList, filters, keyTypes, numericRanges) {
  if (!filters || !Array.isArray(filters) || filters.length === 0) return [];

  return metadataList.map(item => {
    if (!item.name) return null;

    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const filter of filters) {
      const itemValue = item[filter.key];
      if (itemValue === undefined || itemValue === null) continue;

      const weight = Math.max(0.1, Math.min(1.0, filter.weight || 0.5));
      let score = 0;

      if (keyTypes[filter.key] === 'numeric' && typeof itemValue === 'number') {
        const desired = parseFloat(filter.value);
        if (isNaN(desired)) continue;
        const range = numericRanges[filter.key];
        const span = range ? (range.max - range.min) : 0;

        if (span === 0) {
          score = itemValue === desired ? 1.0 : 0.0;
        } else if (filter.operator === '>') {
          score = itemValue >= desired ? 1.0 : Math.max(0, 1 - (desired - itemValue) / span);
        } else if (filter.operator === '<') {
          score = itemValue <= desired ? 1.0 : Math.max(0, 1 - (itemValue - desired) / span);
        } else {
          const distance = Math.abs(itemValue - desired);
          score = Math.max(0, 1 - distance / span);
        }
      } else {
        const filterTokens = String(filter.value).toLowerCase().split(/[,;|]+/).map(t => t.trim()).filter(Boolean);
        const itemTokens = String(itemValue).toLowerCase().split(/[,;|]+/).map(t => t.trim()).filter(Boolean);

        if (filterTokens.length === 0 || itemTokens.length === 0) continue;

        let matchCount = 0;
        for (const ft of filterTokens) {
          for (const it of itemTokens) {
            if (it.includes(ft) || ft.includes(it)) {
              matchCount++;
              break;
            }
          }
        }

        const union = new Set([...filterTokens, ...itemTokens]).size;
        score = union > 0 ? matchCount / union : 0;
      }

      totalWeightedScore += score * weight;
      totalWeight += weight;
    }

    const compositeScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
    return { name: item.name, compositeScore, metadata: item };
  }).filter(Boolean).sort((a, b) => b.compositeScore - a.compositeScore);
}
// #endregion

// #region BACKGROUND SELECTION
/**
 * Selects the best background image for a scene
 * @param {string} sceneDescription - Description of the scene
 * @param {string[]} backgrounds - Available background images
 * @returns {Promise<string>} - Selected background path
 */
async function selectBestBackground(turnContext) {
  const sceneDescription = turnContext.processed.narrativeEngine.writerResponse;
  const backgrounds = filterForegroundOcclusionAssets([
    ...(turnContext.runtime?.assets?.backgrounds || []),
    ...(turnContext.runtime?.assets?.extraBackgrounds || [])
  ]);

  let previousTurnContext = null;
  let previousPreviousTurnContext = null;

  let prevBackground = null;
  let prevOST = null;
  let prevText = null;

  let prevPrevBackground = null;
  let prevPrevOST = null;
  let prevPrevText = null;

  if (turnContext.turnNumber > 0) {
    try {
      previousTurnContext = await turnContext.getPreviousChapter();
      if (previousTurnContext) {
        prevBackground = previousTurnContext.output.finalBackground || '';
        prevOST = previousTurnContext.output.finalSong || '';
        prevText = previousTurnContext.output.summary || previousTurnContext.output.synopsis || previousTurnContext.output.fulltext || '';

        if (turnContext.turnNumber > 1) {
          // Only try to get previousPreviousTurnContext if previousTurnContext exists
          previousPreviousTurnContext = await previousTurnContext.getPreviousChapter();
          if (previousPreviousTurnContext) {
            prevPrevBackground = previousPreviousTurnContext.output.finalBackground || '';
            prevPrevOST = previousPreviousTurnContext.output.finalSong || '';
            prevPrevText = previousPreviousTurnContext.output.summary || previousPreviousTurnContext.output.synopsis || previousPreviousTurnContext.output.fulltext || '';
          }
        }
      }
    } catch (error) {
      Logger.error('AssetSelector', 'Background', 'Failed to retrieve previous turn context for background selection:', error);
      // If an error occurs (e.g., chapter management not set), treat as no previous context
      previousTurnContext = null;
      previousPreviousTurnContext = null;
    }
  }

  // Asset selector enable/disable check
  if (settings.narrative_agents?.asset_selector && settings.narrative_agents.asset_selector.enable_background === false) {
    Logger.log('AssetSelector', 'Background', 'Background selection is disabled by settings.');
    const fallback = backgrounds[0] || '';
    return { path: fallback, changes: [{ line: 0, path: fallback }] };
  }

  if (!backgrounds || backgrounds.length === 0) {
    Logger.error('AssetSelector', 'Background', 'No backgrounds available to select from.');
    return '';
  }

  const backgroundFilenames = backgrounds.map(getFilename);
  const extraDetails = turnContext.processed?.assetSelector?.extraDetails || '';

  // â”€â”€ Smart Metadata-Driven Selection (Aggregated) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let metadataList = [];
  try {
    const uniqueDirs = uniqueAssetDirs(backgrounds);
    for (const dir of uniqueDirs) {
      const metadataPath = path.join(dir, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const metadataRaw = fs.readFileSync(metadataPath, 'utf8');
          const parsed = JSON.parse(metadataRaw);
          if (Array.isArray(parsed)) {
            metadataList = metadataList.concat(parsed);
          }
        } catch (dirErr) {
          Logger.warn('AssetSelector', 'Background', `Failed to parse metadata.json in ${dir}: ${dirErr.message}`);
        }
      }
    }
    if (metadataList.length > 0) {
      Logger.log('AssetSelector', 'Background', `Found aggregated metadata with ${metadataList.length} entries. Triggering Smart Metadata Selection.`);
    }
  } catch (e) {
    Logger.warn('AssetSelector', 'Background', `Error during metadata aggregation: ${e.message}`);
  }

  const projectDirectives = turnContext.getFormattedDirective('bg_selector', { header: 'CREATIVE DIRECTIVES:' });
  if (metadataList && metadataList.length > 0) {
    const smartResult = await selectMetadataDrivenBackground(turnContext, backgrounds, metadataList, { prevBackground, prevOST, prevText, prevPrevBackground, prevPrevOST, prevPrevText }, extraDetails, projectDirectives);
    if (smartResult) return smartResult;
  }

  // â”€â”€ Basic Selection (no metadata) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const prompt = createBackgroundSelectionPrompt(turnContext, sceneDescription, backgroundFilenames, { prevBackground, prevOST, prevText, prevPrevBackground, prevPrevOST, prevPrevText }, extraDetails);

  try {
    Logger.log('AssetSelector', 'Background', 'Selecting best background...', 'start');
    const messages = buildCoreVnLlmMessages(turnContext, prompt);
    TurnLogger.logRequest('Select Best Background', messages, CONFIG.BACKGROUND_MODEL, resolveModelAlias(CONFIG.BACKGROUND_MODEL).provider);
    const { content: responseContent, model: resolvedModel } = await callLLM({
      model: CONFIG.BACKGROUND_MODEL,
      provider: resolveModelAlias(CONFIG.BACKGROUND_MODEL).provider,
      retries: CONFIG.BACKGROUND_PARAMS.retries,
      timeout: CONFIG.BACKGROUND_PARAMS.timeout,
      messages,
      ...CONFIG.BACKGROUND_PARAMS,
      callingModule: 'AssetSelector',
      turnLogTitle: 'Select Best Background'
    });
    TurnLogger.logResponse('Select Best Background', responseContent, resolvedModel, resolveModelAlias(CONFIG.BACKGROUND_MODEL).provider);
    Logger.log('AssetSelector', 'Background', `Background selection response received.`, 'end');

    const result = parseMultiAssetSelection(responseContent, backgrounds, backgroundFilenames, prevBackground);
    if (result && result.changes.length > 0) {
      Logger.log('AssetSelector', 'Background', `LLM chose background(s). Starting change assigned to: ${getFilename(result.path)}`);
      return result;
    }

    const fallback = backgrounds[0] || '';
    return { path: fallback, changes: [{ line: 0, path: fallback }] };
  } catch (error) {
    Logger.error('AssetSelector', 'Background', 'Background selection error:', error);
    const fallback = backgrounds[0] || '';
    return { path: fallback, changes: [{ line: 0, path: fallback }] };
  }
}

/**
 * Creates the prompt for the LLM to select the best background image.
 * @param {string} scene - The description of the scene.
 * @param {string[]} filenames - An array of available background filenames.
 * @returns {string} The generated prompt for background selection.
 */
function createBackgroundSelectionPrompt(
  turnContext,
  scene,
  filenames,
  historyTokens,
  extraDetails = ''
) {
  const { prevBackground, prevOST, prevText, prevPrevBackground, prevPrevOST, prevPrevText } = historyTokens;
  let historyContext = `Previous chapters:\n`;

  if (prevPrevText) {
    historyContext += `Chapter -2:\n${prevPrevText}\n`;
    historyContext += `Choice: ${getFilename(prevPrevOST) || 'none'} / ${getFilename(prevPrevBackground) || 'none'}\n`;
  }
  if (prevText) {
    historyContext += `Chapter -1:\n${prevText}\n`;
    historyContext += `Choice: ${getFilename(prevOST) || 'none'} / ${getFilename(prevBackground) || 'none'}\n`;
  }

  if (!bgBasicPrompt) return "";

  const processedDialogue = turnContext.processed.vnManager.processedLines || [];
  const numberedScript = processedDialogue.map((line, i) => `[Line ${i}] ${line.character || 'Narrator'}: ${line.text || line.line}`).join('\n');
  // Creative direction for background selection
  const projectDirectives = turnContext.getFormattedDirective('bg_selector', { header: 'CREATIVE DIRECTIVES:' });

  return bgBasicPrompt
    .replace('${historyContext}', historyContext)
    .replace('${numberedScript}', numberedScript)
    .replace('${extraDetails}', extraDetails ? `Additional Details: ${extraDetails}\n` : "")
    .replace('${project_directives}', projectDirectives)
    .replace('${filenames}', filenames.map(bg => `- ${bg}`).join('\n'));
}

// #region SMART METADATA-DRIVEN BACKGROUND SELECTION
/**
 * Metadata-driven intelligent Background selection using LLM-generated structured filters
 * and multi-dimensional scoring (Jaccard for strings, proximity for numerics).
 */
async function selectMetadataDrivenBackground(turnContext, backgrounds, metadataList, historyTokens, extraDetails, projectDirectives = '') {
  const sceneDescription = turnContext.processed.narrativeEngine.writerResponse;
  const { prevBackground, prevText } = historyTokens;

  try {
    const { schemaDesc, keyTypes, numericRanges } = buildSchemaDescription(metadataList);

    // â”€â”€ Step 2: LLM Generates Structured JSON Filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const MAX_SCENE_LENGTH = 2500;
    let truncatedScene = sceneDescription;
    if (truncatedScene.length > MAX_SCENE_LENGTH) {
      Logger.log('AssetSelector', 'Background (Smart)', `Truncating scene description (${truncatedScene.length} -> ${MAX_SCENE_LENGTH} chars)`);
      truncatedScene = truncatedScene.substring(0, MAX_SCENE_LENGTH) + '...';
    }

    let filterPromptContext = "";
    if (prevBackground) filterPromptContext += `Location from previous chapter: ${path.parse(prevBackground).name}\n\n`;

    if (!bgSmartFiltersPrompt) throw new Error("bg_smart_filters_prompt.txt not found");

    const filterPrompt = bgSmartFiltersPrompt
      .replace('${truncatedScene}', truncatedScene)
      .replace('${extraDetails}', extraDetails ? `World State: ${extraDetails}\n\n` : "")
      .replace('${prevText}', prevText ? `Previous chapter text/summary: ${prevText}\n\n` : "")
      .replace('${prevBackground}', filterPromptContext)
      .replace('${schemaDesc}', schemaDesc)
      .replace('${project_directives}', projectDirectives);

    const filterMessages = buildCoreVnLlmMessages(turnContext, filterPrompt);
    TurnLogger.logRequest('Smart Background Filters', filterMessages, CONFIG.BACKGROUND_MODEL, resolveModelAlias(CONFIG.BACKGROUND_MODEL).provider);
    const { content: llmFilterResponse, model: resolvedModelFilter } = await callLLM({
      model: CONFIG.BACKGROUND_MODEL,
      provider: resolveModelAlias(CONFIG.BACKGROUND_MODEL).provider,
      messages: filterMessages,
      ...CONFIG.BACKGROUND_PARAMS,
      expectJson: true,
      callingModule: 'AssetSelector',
      turnLogTitle: 'Smart Background Filters'
    });
    TurnLogger.logResponse('Smart Background Filters', llmFilterResponse, resolvedModelFilter, resolveModelAlias(CONFIG.BACKGROUND_MODEL).provider);

    // â”€â”€ Step 3: Multi-Category Scoring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const categories = ['calm', 'happy', 'sad', 'battle'];
    const categorizedCandidates = {};
    let totalCandidateCount = 0;

    for (const cat of categories) {
      const catFilters = llmFilterResponse[cat]?.filters || [];
      if (catFilters.length === 0) {
        Logger.warn('AssetSelector', 'Background (Smart)', `No filters generated for category: ${cat}`);
        continue;
      }

      const scored = scoreAssets(metadataList, catFilters, keyTypes, numericRanges);
      categorizedCandidates[cat] = scored.slice(0, 5); // Top 5 per category
      totalCandidateCount += categorizedCandidates[cat].length;
    }

    if (totalCandidateCount === 0) throw new Error('No candidates found across all categories.');

    Logger.log('AssetSelector', 'Background (Smart)', `Generated categorized candidates: ${Object.entries(categorizedCandidates).map(([cat, list]) => `${cat}(${list.length})`).join(', ')}`);

    // â”€â”€ Step 4: Final LLM Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let candidateSummaries = "";
    for (const cat of categories) {
      const list = categorizedCandidates[cat];
      if (!list || list.length === 0) continue;

      candidateSummaries += `### ${cat.toUpperCase()} OPTIONS:\n`;
      list.forEach((t, i) => {
        const metaStr = Object.entries(t.metadata)
          .filter(([k]) => k !== 'slug' && k !== 'src' && k !== 'name')
          .map(([k, v]) => `${k}: ${v}`).join(', ');
        candidateSummaries += `${i + 1}. [${t.name}] (Score: ${t.compositeScore.toFixed(3)}) -> ${metaStr}\n`;
      });
      candidateSummaries += "\n";
    }

    if (!bgSmartSelectionPrompt) throw new Error("bg_smart_selection_prompt.txt not found");

    const processedDialogue = turnContext.processed.vnManager.processedLines || [];
    const numberedScript = processedDialogue.map((line, i) => `[Line ${i}] ${line.character || 'Narrator'}: ${line.text || line.line}`).join('\n');

    const selectionPrompt = bgSmartSelectionPrompt
      .replace('${numberedScript}', numberedScript)
      .replace('${extraDetails}', extraDetails ? `Current World State: ${extraDetails}\n` : "")
      .replace('${candidateCount}', totalCandidateCount)
      .replace('${candidateSummaries}', candidateSummaries)
      .replace('${project_directives}', projectDirectives);

    const selectionMessages = buildCoreVnLlmMessages(turnContext, selectionPrompt);
    TurnLogger.logRequest('Smart Background Select', selectionMessages, CONFIG.BACKGROUND_MODEL, resolveModelAlias(CONFIG.BACKGROUND_MODEL).provider);
    const { content: llmSelection, model: resolvedModelSelect } = await callLLM({
      model: CONFIG.BACKGROUND_MODEL,
      provider: resolveModelAlias(CONFIG.BACKGROUND_MODEL).provider,
      messages: selectionMessages,
      ...CONFIG.BACKGROUND_PARAMS,
      callingModule: 'AssetSelector',
      turnLogTitle: 'Smart Background Select'
    });
    TurnLogger.logResponse('Smart Background Select', llmSelection, resolvedModelSelect, resolveModelAlias(CONFIG.BACKGROUND_MODEL).provider);

    // â”€â”€ Step 5: Fuzzy Match to Filesystem â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const bgFilenames = backgrounds.map(getFilename);
    const result = parseMultiAssetSelection(llmSelection, backgrounds, bgFilenames, prevBackground);
    if (result) return result;

    // Fallback to top candidate from any category if direct match fails
    const allScored = Object.values(categorizedCandidates).flat().sort((a, b) => b.compositeScore - a.compositeScore);
    if (allScored.length > 0) {
      const options = backgrounds.map(p => ({
        path: p,
        basename: path.parse(p).name
      }));
      const fallbackRes = fuzzysort.go(allScored[0].name, options, { key: 'basename' });
      if (fallbackRes && fallbackRes.length > 0) {
        const fallbackPath = fallbackRes[0].obj.basename;
        Logger.log('AssetSelector', 'Background (Smart)', `Match failed, using top scored fallback: ${fallbackPath}`);
        return { path: fallbackRes[0].obj.path, changes: [{ line: 0, path: fallbackRes[0].obj.path }] };
      }
    }
  } catch (error) {
    Logger.error('AssetSelector', 'Background (Smart)', 'Smart selection failed, falling back to basic:', error);
  }

  // Pure fallback to basic
  return null;
}
// #endregion

// #region MUSIC (OST) SELECTION
/**
 * Performs a vector similarity search for OST files based on a scene description.
 * @param {string} sceneDescription - The description of the scene.
 * @param {string[]} ostList - An array of available OST file paths.
 * @param {string} cacheKey - A unique key for caching the vector store.
 * @returns {Promise<string[]>} An array of OST file paths ranked by relevance.
 */
async function performVectorSearch(sceneDescription, ostList, cacheKey, recentSongs = []) {
  try {
    const vectorStore = await getStore(cacheKey, 'ost_store');
    if (!vectorStore) return ostList.slice(0, 250);

    const MAX_EMBEDDING_LENGTH = 500;
    let embeddingSceneDescription = sceneDescription;
    if (sceneDescription.length > MAX_EMBEDDING_LENGTH) {
      Logger.warn('AssetSelector', 'OST', `Scene description for embedding truncated from ${sceneDescription.length} to ${MAX_EMBEDDING_LENGTH} characters.`);
      embeddingSceneDescription = sceneDescription.substring(0, MAX_EMBEDDING_LENGTH);
    }

    const K_RESULTS = 100;
    const results = await vectorStore.similaritySearch(
      embeddingSceneDescription,
      Math.min(ostList.length, K_RESULTS)
    );

    return mapVectorSearchResults(results, ostList, recentSongs);
  } catch (error) {
    Logger.error('AssetSelector', 'OST', 'Vector search failed:', error);
    return ostList.slice(0, 250);
  }
}

/**
 * Maps vector search results back to original OST file paths and orders them with diversity injection.
 * @param {Array<Document>} results - The search results from the vector store.
 * @param {string[]} ostList - The original list of OST file paths.
 * @param {string[]} recentSongs - Recent songs
 * @returns {string[]} An ordered list of unique OST file paths based on search results.
 */
function mapVectorSearchResults(results, ostList, recentSongs = []) {
  const filenameMap = new Map();
  ostList.forEach(ost => {
    filenameMap.set(path.parse(ost).name.toLowerCase(), ost);
  });

  const scoredResults = [];
  const seen = new Set();

  results.forEach((doc, index) => {
    const filename = filenameMap.get(doc.pageContent.toLowerCase());
    if (filename && !seen.has(filename)) {
      // Create a mock score based on similarity rank for sampleDiverseCandidates
      const mockScore = 1.0 - (index / results.length);
      scoredResults.push({
        path: filename,
        name: path.parse(filename).name,
        compositeScore: mockScore
      });
      seen.add(filename);
    }
  });

  // Apply diversity sampling (Component 3): Sample 60 from top 100
  const sampled = sampleDiverseCandidates(scoredResults, recentSongs, 60, 100);
  const orderedResults = sampled.map(s => s.path);

  Logger.log('AssetSelector', 'OST', `Vector search returned ${orderedResults.length} diverse candidates (from ${scoredResults.length} results).`);
  return orderedResults;
}

function createEmptyOstCategoryBucket() {
  return { calm: [], happy: [], sad: [], battle: [] };
}

function ensureOstCategoryState(turnContext) {
  if (!turnContext.processed || typeof turnContext.processed !== 'object') {
    turnContext.processed = {};
  }
  if (!turnContext.processed.assetSelector || typeof turnContext.processed.assetSelector !== 'object') {
    turnContext.processed.assetSelector = {};
  }

  const state = turnContext.processed.assetSelector;
  if (!state.ostChoicesByCategory || typeof state.ostChoicesByCategory !== 'object') {
    state.ostChoicesByCategory = createEmptyOstCategoryBucket();
  }

  for (const category of OST_CATEGORIES) {
    if (!Array.isArray(state.ostChoicesByCategory[category])) {
      state.ostChoicesByCategory[category] = [];
    }
  }

  if (!state.ostChoicesMeta || typeof state.ostChoicesMeta !== 'object') {
    state.ostChoicesMeta = {};
  }

  return state;
}

function normalizeCandidateNameList(rawValue) {
  let list = rawValue;

  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    if (Array.isArray(rawValue.tracks)) list = rawValue.tracks;
    else if (Array.isArray(rawValue.options)) list = rawValue.options;
    else if (Array.isArray(rawValue.items)) list = rawValue.items;
  }

  if (!Array.isArray(list)) return [];

  return list
    .map(item => {
      if (typeof item === 'string') return item.trim();
      if (!item || typeof item !== 'object') return '';
      return String(item.filename || item.name || item.track || item.value || '').trim();
    })
    .filter(Boolean);
}

function buildOstCandidateOptions(candidatePaths) {
  return (candidatePaths || [])
    .filter(p => typeof p === 'string' && p.trim())
    .map(p => ({
      path: p,
      filename: getFilename(p),
      filenameLower: getFilename(p).toLowerCase(),
      basename: path.parse(p).name,
      basenameLower: path.parse(p).name.toLowerCase()
    }));
}

function findPathByCandidateName(rawName, candidateOptions) {
  if (!rawName || typeof rawName !== 'string') return null;
  const cleanedRaw = rawName.replace(/[\[\]"']/g, '').trim();
  if (!cleanedRaw) return null;

  const lower = cleanedRaw.toLowerCase();

  let match = candidateOptions.find(opt => opt.filenameLower === lower);
  if (match) return match.path;

  match = candidateOptions.find(opt => opt.basenameLower === lower);
  if (match) return match.path;

  match = candidateOptions.find(opt => lower.includes(opt.filenameLower) || lower.includes(opt.basenameLower));
  if (match) return match.path;

  const fuzzy = fuzzysort.go(cleanedRaw, candidateOptions, { key: 'filename' });
  if (fuzzy && fuzzy.length > 0 && fuzzy[0].score > -2500) {
    return fuzzy[0].obj.path;
  }

  return null;
}

function buildHeuristicFallbackCategories(candidatePaths, perCategory = 6) {
  const categories = createEmptyOstCategoryBucket();
  const options = buildOstCandidateOptions(candidatePaths);

  const keywordRules = {
    calm: /(calm|peace|ambient|quiet|rest|village|night|soft|gentle|lounge|home)/i,
    happy: /(happy|joy|cheer|bright|festival|fun|smile|upbeat|sunny|celebration)/i,
    sad: /(sad|sorrow|melanch|grief|tear|loss|lonely|mourn|tragic|dark)/i,
    battle: /(battle|combat|fight|boss|war|danger|chase|attack|epic|intense)/i
  };

  const usedByCategory = {
    calm: new Set(),
    happy: new Set(),
    sad: new Set(),
    battle: new Set()
  };

  for (const option of options) {
    for (const category of OST_CATEGORIES) {
      if (categories[category].length >= perCategory) continue;
      if (!keywordRules[category].test(option.basenameLower) && !keywordRules[category].test(option.filenameLower)) continue;
      if (usedByCategory[category].has(option.path)) continue;
      categories[category].push(option.path);
      usedByCategory[category].add(option.path);
    }
  }

  for (const category of OST_CATEGORIES) {
    if (categories[category].length >= perCategory) continue;
    for (const option of options) {
      if (categories[category].length >= perCategory) break;
      if (usedByCategory[category].has(option.path)) continue;
      categories[category].push(option.path);
      usedByCategory[category].add(option.path);
    }
  }

  return categories;
}

function mapCategorizedNamesToPaths(rawCategories, candidatePaths, perCategory = 6) {
  const mapped = createEmptyOstCategoryBucket();
  const candidateOptions = buildOstCandidateOptions(candidatePaths);

  for (const category of OST_CATEGORIES) {
    const names = normalizeCandidateNameList(rawCategories?.[category]);
    const seen = new Set();
    for (const name of names) {
      if (mapped[category].length >= perCategory) break;
      const resolved = findPathByCandidateName(name, candidateOptions);
      if (!resolved || seen.has(resolved)) continue;
      mapped[category].push(resolved);
      seen.add(resolved);
    }
  }

  const fallback = buildHeuristicFallbackCategories(candidatePaths, perCategory);
  for (const category of OST_CATEGORIES) {
    const seen = new Set(mapped[category]);
    for (const fallbackPath of fallback[category]) {
      if (mapped[category].length >= perCategory) break;
      if (seen.has(fallbackPath)) continue;
      mapped[category].push(fallbackPath);
      seen.add(fallbackPath);
    }
  }

  return mapped;
}

function persistOstCategoryChoices(turnContext, categorizedPaths, meta = {}) {
  const state = ensureOstCategoryState(turnContext);
  const rootDir = turnContext.runtime?.rootDirectory || turnContext.rootDirectory;
  const normalized = createEmptyOstCategoryBucket();

  for (const category of OST_CATEGORIES) {
    const rawList = Array.isArray(categorizedPaths?.[category]) ? categorizedPaths[category] : [];
    const deduped = [...new Set(rawList.filter(Boolean))];
    normalized[category] = deduped.map(p => relativizeAssetPath(p, rootDir));
  }

  state.ostChoicesByCategory = normalized;
  state.ostChoicesMeta = {
    ...state.ostChoicesMeta,
    source: meta.source || state.ostChoicesMeta.source || '',
    candidatePoolSize: Number.isFinite(meta.candidatePoolSize) ? meta.candidatePoolSize : (state.ostChoicesMeta.candidatePoolSize || 0),
    updatedAt: new Date().toISOString(),
    categoriesAvailable: OST_CATEGORIES.reduce((acc, category) => {
      acc[category] = normalized[category].length;
      return acc;
    }, {})
  };
}

function createOstCategorySplitPrompt(turnContext, sceneDescription, candidatePaths, historyTokens, extraDetails = '', recentSongs = [], projectDirectives = '', diversitySeed = '') {
  const { prevBackground, prevOST, prevText, prevPrevBackground, prevPrevOST, prevPrevText } = historyTokens;

  let historyContext = "";
  if (prevPrevText) {
    historyContext += `Chapter -2:\n${prevPrevText}\n`;
    historyContext += `Choice: ${getFilename(prevPrevOST) || 'none'} / ${getFilename(prevPrevBackground) || 'none'}\n\n`;
  }
  if (prevText) {
    historyContext += `Chapter -1:\n${prevText}\n`;
    historyContext += `Choice: ${getFilename(prevOST) || 'none'} / ${getFilename(prevBackground) || 'none'}\n\n`;
  }

  if (!ostCategorySplitPrompt) return "";

  const processedDialogue = turnContext.processed.vnManager.processedLines || [];
  const numberedScript = processedDialogue.map((line, i) => `[Line ${i}] ${line.character || 'Narrator'}: ${line.text || line.line}`).join('\n');
  const backgroundSelectionSignal = formatSelectedBackgroundSignal(turnContext);

  const recentHistorySignal = recentSongs.length > 0
    ? `### RECENTLY PLAYED TRACKS:\n${recentSongs.map((s, i) => `- ${path.parse(s).name} (${i + 1} turns ago)`).join('\n')}\n\n`
    : "";

  return ostCategorySplitPrompt
    .replace('${historyContext}', historyContext)
    .replace('${numberedScript}', numberedScript)
    .replace('${sceneDescription}', sceneDescription)
    .replace('${extraDetails}', extraDetails ? `Current World State: ${extraDetails}\n` : "")
    .replace('${backgroundSelectionSignal}', backgroundSelectionSignal ? `${backgroundSelectionSignal}\n` : "")
    .replace('${project_directives}', projectDirectives)
    .replace('${recentOSTHistory}', recentHistorySignal)
    .replace('${diversitySeed}', diversitySeed || '')
    .replace('${filenames}', candidatePaths.map(ost => `- ${getFilename(ost)}`).join('\n'));
}

async function buildNormalPathOstCategoryChoices(turnContext, sceneDescription, candidatePaths, historyTokens, extraDetails, recentSongs, projectDirectives, diversitySeed) {
  const perCategory = 6;
  if (!candidatePaths || candidatePaths.length === 0) {
    return createEmptyOstCategoryBucket();
  }

  if (!ostCategorySplitPrompt) {
    return buildHeuristicFallbackCategories(candidatePaths, perCategory);
  }

  const prompt = createOstCategorySplitPrompt(
    turnContext,
    sceneDescription,
    candidatePaths,
    historyTokens,
    extraDetails,
    recentSongs,
    projectDirectives,
    diversitySeed
  );

  if (!prompt) {
    return buildHeuristicFallbackCategories(candidatePaths, perCategory);
  }

  try {
    const messages = buildCoreVnLlmMessages(turnContext, prompt);
    TurnLogger.logRequest('OST Category Split (Basic)', messages, CONFIG.OST_MODEL, resolveModelAlias(CONFIG.OST_MODEL).provider);
    const { content: responseContent, model: resolvedModel } = await callLLM({
      model: CONFIG.OST_MODEL,
      provider: resolveModelAlias(CONFIG.OST_MODEL).provider,
      retries: CONFIG.OST_PARAMS.retries,
      timeout: CONFIG.OST_PARAMS.timeout,
      messages,
      ...CONFIG.OST_PARAMS,
      expectJson: true,
      callingModule: 'AssetSelector',
      turnLogTitle: 'OST Category Split (Basic)'
    });
    TurnLogger.logResponse('OST Category Split (Basic)', responseContent, resolvedModel, resolveModelAlias(CONFIG.OST_MODEL).provider);

    return mapCategorizedNamesToPaths(responseContent, candidatePaths, perCategory);
  } catch (error) {
    Logger.warn('AssetSelector', 'OST', `Category split LLM failed on normal path. Falling back to heuristic buckets. Reason: ${error.message}`);
    return buildHeuristicFallbackCategories(candidatePaths, perCategory);
  }
}

/**
 * Selects the best OST for a scene
 * @param {string} sceneDescription - Scene description
 * @param {string[]} ostList - Available OST files
 * @param {boolean} useVectorSearch - Whether to use vector search
 * @param {string} cacheKey - A unique key for caching (e.g., projectName)
 * @returns {Promise<string>} - Selected OST path
 */
async function selectBestOST(turnContext) {
  let sceneDescription = turnContext.processed.narrativeEngine.writerResponse;
  const ostList = [
    ...(turnContext.runtime?.assets?.osts || []),
    ...(turnContext.runtime?.assets?.extraOsts || [])
  ];
  const useVectorSearch = true;
  const cacheKey = turnContext.projectName;

  // Gather recent history for diversity injection (Component 1)
  const recentSongs = await getRecentOSTHistory(turnContext, 10);
  const diversitySeed = getDiversitySeed(turnContext.turnNumber);

  let previousTurnContext = null;
  let previousPreviousTurnContext = null;

  let prevBackground = null;
  let prevOST = null;
  let prevText = null;

  let prevPrevBackground = null;
  let prevPrevOST = null;
  let prevPrevText = null;

  if (turnContext.turnNumber > 0) {
    try {
      previousTurnContext = await turnContext.getPreviousChapter();
      if (previousTurnContext) {
        prevBackground = previousTurnContext.output.finalBackground || '';
        prevOST = previousTurnContext.output.finalSong || '';
        prevText = previousTurnContext.output.summary || previousTurnContext.output.synopsis || previousTurnContext.output.fulltext || '';

        if (turnContext.turnNumber > 1) {
          previousPreviousTurnContext = await previousTurnContext.getPreviousChapter();
          if (previousPreviousTurnContext) {
            prevPrevBackground = previousPreviousTurnContext.output.finalBackground || '';
            prevPrevOST = previousPreviousTurnContext.output.finalSong || '';
            prevPrevText = previousPreviousTurnContext.output.summary || previousPreviousTurnContext.output.synopsis || previousPreviousTurnContext.output.fulltext || '';
          }
        }
      }
    } catch (error) {
      Logger.error('AssetSelector', 'OST', 'Failed to retrieve previous turn context for OST selection:', error);
      previousTurnContext = null;
      previousPreviousTurnContext = null;
    }
  }

  if (settings.narrative_agents?.asset_selector && settings.narrative_agents.asset_selector.enable_ost === false) {
    Logger.log('AssetSelector', 'OST', 'OST selection is disabled by settings.');
    const fallback = ostList[0] || '';
    return { path: fallback, changes: [{ line: 0, path: fallback }] };
  }

  if (!ostList || ostList.length === 0) {
    Logger.error('AssetSelector', 'OST', 'No OST files available to select from.');
    return '';
  }

  const extraDetails = turnContext.processed?.assetSelector?.extraDetails || '';

  // â”€â”€ Smart Metadata-Driven Selection (Aggregated) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let metadataList = [];
  try {
    const uniqueDirs = uniqueAssetDirs(ostList);
    for (const dir of uniqueDirs) {
      const metadataPath = path.join(dir, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const metadataRaw = fs.readFileSync(metadataPath, 'utf8');
          const parsed = JSON.parse(metadataRaw);
          if (Array.isArray(parsed)) {
            metadataList = metadataList.concat(parsed);
          }
        } catch (dirErr) {
          Logger.warn('AssetSelector', 'OST', `Failed to parse metadata.json in ${dir}: ${dirErr.message}`);
        }
      }
    }
    if (metadataList.length > 0) {
      Logger.log('AssetSelector', 'OST', `Found aggregated metadata with ${metadataList.length} entries. Triggering Smart Metadata Selection.`);
    }
  } catch (e) {
    Logger.warn('AssetSelector', 'OST', `Error during metadata aggregation: ${e.message}`);
  }

  const projectDirectives = turnContext.getFormattedDirective('ost_selector', { header: 'CREATIVE DIRECTIVES:' });
  if (metadataList && metadataList.length > 0) {
    const smartResult = await selectMetadataDrivenOST(turnContext, ostList, metadataList, { prevBackground, prevOST, prevText, prevPrevBackground, prevPrevOST, prevPrevText }, extraDetails, projectDirectives, recentSongs, diversitySeed);
    if (smartResult) return smartResult;
  }

  // â”€â”€ Basic Selection (no metadata) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let candidates = ostList;

  if (typeof sceneDescription !== 'string') {
    sceneDescription = String(sceneDescription);
  }

  if (useVectorSearch && ostList.length > 50) {
    candidates = await performVectorSearch(sceneDescription, ostList, cacheKey, recentSongs);
  }

  if (candidates.length === 0) {
    candidates = ostList;
  }

  try {
    const normalPathCategories = await buildNormalPathOstCategoryChoices(
      turnContext,
      sceneDescription,
      candidates,
      { prevBackground, prevOST, prevText, prevPrevBackground, prevPrevOST, prevPrevText },
      extraDetails,
      recentSongs,
      projectDirectives,
      diversitySeed
    );

    persistOstCategoryChoices(turnContext, normalPathCategories, {
      source: 'normal_path',
      candidatePoolSize: candidates.length
    });
  } catch (categoryError) {
    Logger.warn('AssetSelector', 'OST', `Normal-path category split failed. Continuing with direct OST selection. Reason: ${categoryError.message}`);
  }

  const prompt = createOSTSelectionPrompt(turnContext, sceneDescription, candidates, { prevBackground, prevOST, prevText, prevPrevBackground, prevPrevOST, prevPrevText }, extraDetails, recentSongs);

  try {
    Logger.log('AssetSelector', 'OST', 'Selecting best OST...', 'start');
    const messages = buildCoreVnLlmMessages(turnContext, prompt);
    TurnLogger.logRequest('Select Best Ost', messages, CONFIG.OST_MODEL, resolveModelAlias(CONFIG.OST_MODEL).provider);
    const { content: responseContent, model: resolvedModel } = await callLLM({
      model: CONFIG.OST_MODEL,
      provider: resolveModelAlias(CONFIG.OST_MODEL).provider,
      retries: CONFIG.OST_PARAMS.retries,
      timeout: CONFIG.OST_PARAMS.timeout,
      messages,
      ...CONFIG.OST_PARAMS,
      callingModule: 'AssetSelector',
      turnLogTitle: 'Select Best Ost'
    });
    TurnLogger.logResponse('Select Best Ost', responseContent, resolvedModel, resolveModelAlias(CONFIG.OST_MODEL).provider);
    Logger.log('AssetSelector', 'OST', `OST selection response received.`, 'end');

    const selectedOST = findMatchingOST(responseContent, ostList);
    Logger.log('AssetSelector', 'OST', `Selected OST: ${getFilename(selectedOST)}`);

    return { path: selectedOST, changes: [{ line: 0, path: selectedOST }] };
  } catch (error) {
    Logger.error('AssetSelector', 'OST', 'OST selection error:', error);
    const fallback = ostList[0] || '';
    return { path: fallback, changes: [{ line: 0, path: fallback }] };
  }
}

/**
 * Creates the prompt for the LLM to select the best OST.
 * @param {string} sceneDescription - The description of the scene.
 * @param {string[]} filenames - An array of candidate OST filenames.
 * @param {Object} historyTokens - History context
 * @param {string} extraDetails - Extra details
 * @param {string[]} recentSongs - Recent songs
 * @returns {string} The generated prompt for OST selection.
 */
function createOSTSelectionPrompt(turnContext, sceneDescription, filenames, historyTokens, extraDetails = '', recentSongs = []) {
  const { prevBackground, prevOST, prevText, prevPrevBackground, prevPrevOST, prevPrevText } = historyTokens;

  let historyContext = "";
  if (prevPrevText) {
    historyContext += `Chapter -2:\n${prevPrevText}\n`;
    historyContext += `Choice: ${getFilename(prevPrevOST) || 'none'} / ${getFilename(prevPrevBackground) || 'none'}\n\n`;
  }
  if (prevText) {
    historyContext += `Chapter -1:\n${prevText}\n`;
    historyContext += `Choice: ${getFilename(prevOST) || 'none'} / ${getFilename(prevBackground) || 'none'}\n`;
  }

  if (!ostBasicPrompt) return "";

  const processedDialogue = turnContext.processed.vnManager.processedLines || [];
  const numberedScript = processedDialogue.map((line, i) => `[Line ${i}] ${line.character || 'Narrator'}: ${line.text || line.line}`).join('\n');
  const backgroundSelectionSignal = formatSelectedBackgroundSignal(turnContext);
  // Creative direction for music selection
  const projectDirectives = turnContext.getFormattedDirective('ost_selector', { header: 'CREATIVE DIRECTIVES:' });

  const recentHistorySignal = recentSongs.length > 0
    ? `### RECENTLY PLAYED TRACKS (AVOID repeating these unless the scene truly demands it):\n${recentSongs.map((s, i) => `- ${path.parse(s).name} (${i + 1} turns ago)`).join('\n')}\n\n`
    : "";

  return ostBasicPrompt
    .replace('${historyContext}', historyContext)
    .replace('${numberedScript}', numberedScript)
    .replace('${sceneDescription}', sceneDescription)
    .replace('${extraDetails}', extraDetails ? `Current World State: ${extraDetails}\n` : "")
    .replace('${backgroundSelectionSignal}', backgroundSelectionSignal ? `${backgroundSelectionSignal}\n` : "")
    .replace('${project_directives}', projectDirectives)
    .replace('${recentOSTHistory}', recentHistorySignal)
    .replace('${filenames}', filenames.map(ost => `- ${getFilename(ost)}`).join('\n'));
}

/**
 * Finds the best matching OST file path from the available list based on the LLM's response.
 * @param {string} response - The LLM's response containing the selected filename.
 * @param {string[]} ostList - An array of available OST file paths.
 * @returns {string} The path to the selected OST file, or a fallback.
 */
function findMatchingOST(response, ostList) {
  const filenames = ostList.map(getFilename);

  const escapedFilenames = filenames.map(f => f.replace(/[.*+?^${}()|[\]]/g, '\\$&'));
  const filenameRegex = new RegExp(`(${escapedFilenames.join('|')})`, 'i');
  const match = response.match(filenameRegex);

  if (match) {
    const found = ostList.find(ost => getFilename(ost).toLowerCase() === match[1].toLowerCase());
    if (found) return found;
  }

  const cleaned = response.replace(/["']/g, '').trim();
  const close = ostList.find(ost => getFilename(ost).toLowerCase() === cleaned.toLowerCase());
  if (close) return close;

  return ostList[0] || '';
}

// #region SMART METADATA-DRIVEN OST SELECTION
/**
 * Metadata-driven intelligent OST selection using LLM-generated structured filters
 * and multi-dimensional scoring (Jaccard for strings, proximity for numerics).
 */
async function selectMetadataDrivenOST(turnContext, ostList, metadataList, historyTokens, extraDetails, projectDirectives = '', recentSongs = [], diversitySeed = '') {
  const sceneDescription = turnContext.processed.narrativeEngine.writerResponse;
  const { prevOST, prevText } = historyTokens;
  const backgroundSelectionSignal = formatSelectedBackgroundSignal(turnContext);

  try {
    const { schemaDesc, keyTypes, numericRanges } = buildSchemaDescription(metadataList);

    // â”€â”€ Step 2: LLM Generates Structured JSON Filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const MAX_SCENE_LENGTH = 2500;
    let truncatedScene = sceneDescription;
    if (truncatedScene.length > MAX_SCENE_LENGTH) {
      Logger.log('AssetSelector', 'OST (Smart)', `Truncating scene description (${truncatedScene.length} -> ${MAX_SCENE_LENGTH} chars)`);
      truncatedScene = truncatedScene.substring(0, MAX_SCENE_LENGTH) + '...';
    }

    let filterPromptContext = "";
    if (prevOST) filterPromptContext += `Previous track: ${path.parse(prevOST).name}\n\n`;

    if (!ostSmartFiltersPrompt) throw new Error("ost_smart_filters_prompt.txt not found");

    const filterPrompt = ostSmartFiltersPrompt
      .replace('${truncatedScene}', truncatedScene)
      .replace('${extraDetails}', extraDetails ? `World State: ${extraDetails}\n\n` : "")
      .replace('${backgroundSelectionSignal}', backgroundSelectionSignal ? `${backgroundSelectionSignal}\n\n` : "")
      .replace('${prevText}', prevText ? `Previous chapter text/summary: ${prevText}\n\n` : "")
      .replace('${prevOST}', filterPromptContext)
      .replace('${schemaDesc}', schemaDesc)
      .replace('${project_directives}', projectDirectives + (diversitySeed ? `\n\nVARIETY NUDGE: ${diversitySeed}` : ""));

    const filterMessages = buildCoreVnLlmMessages(turnContext, filterPrompt);
    TurnLogger.logRequest('Smart OST Filters', filterMessages, CONFIG.OST_MODEL, resolveModelAlias(CONFIG.OST_MODEL).provider);
    const { content: llmFilterResponse, model: resolvedModelFilter } = await callLLM({
      model: CONFIG.OST_MODEL,
      provider: resolveModelAlias(CONFIG.OST_MODEL).provider,
      messages: filterMessages,
      ...CONFIG.OST_PARAMS,
      expectJson: true,
      callingModule: 'AssetSelector',
      turnLogTitle: 'Smart OST Filters'
    });
    TurnLogger.logResponse('Smart OST Filters', llmFilterResponse, resolvedModelFilter, resolveModelAlias(CONFIG.OST_MODEL).provider);

    // â”€â”€ Step 3: Multi-Category Scoring & Diversity Injection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const categories = ['calm', 'happy', 'sad', 'battle'];
    const categorizedCandidates = {};
    let totalCandidateCount = 0;

    for (const cat of categories) {
      const catFilters = llmFilterResponse[cat]?.filters || [];
      if (catFilters.length === 0) {
        Logger.warn('AssetSelector', 'OST (Smart)', `No filters generated for category: ${cat}`);
        continue;
      }

      const scored = scoreAssets(metadataList, catFilters, keyTypes, numericRanges);
      // Diversity Injection: Sample 8 from top 30 instead of deterministic top 5 (Component 2)
      categorizedCandidates[cat] = sampleDiverseCandidates(scored, recentSongs, 8, 30);
      totalCandidateCount += categorizedCandidates[cat].length;
    }

    if (totalCandidateCount === 0) throw new Error('No candidates found across all categories.');

    Logger.log('AssetSelector', 'OST (Smart)', `Generated categorized candidates: ${Object.entries(categorizedCandidates).map(([cat, list]) => `${cat}(${list.length})`).join(', ')}`);

    const categorizedPaths = createEmptyOstCategoryBucket();
    const candidateOptions = buildOstCandidateOptions(ostList);
    for (const cat of OST_CATEGORIES) {
      const entries = categorizedCandidates[cat] || [];
      const categorySeen = new Set();
      for (const entry of entries) {
        const resolvedPath = findPathByCandidateName(entry?.name, candidateOptions);
        if (!resolvedPath || categorySeen.has(resolvedPath)) continue;
        categorizedPaths[cat].push(resolvedPath);
        categorySeen.add(resolvedPath);
      }
    }

    persistOstCategoryChoices(turnContext, categorizedPaths, {
      source: 'metadata_smart',
      candidatePoolSize: ostList.length
    });

    // â”€â”€ Step 4: Final LLM Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let candidateSummaries = "";
    for (const cat of categories) {
      const list = categorizedCandidates[cat];
      if (!list || list.length === 0) continue;

      candidateSummaries += `### ${cat.toUpperCase()} OPTIONS:\n`;
      list.forEach((t, i) => {
        const metaStr = Object.entries(t.metadata)
          .filter(([k]) => k !== 'slug' && k !== 'src' && k !== 'name')
          .map(([k, v]) => `${k}: ${v}`).join(', ');
        candidateSummaries += `${i + 1}. [${t.name}] (Score: ${t.compositeScore.toFixed(3)}) -> ${metaStr}\n`;
      });
      candidateSummaries += "\n";
    }

    if (!ostSmartSelectionPrompt) throw new Error("ost_smart_selection_prompt.txt not found");

    const processedDialogue = turnContext.processed.vnManager.processedLines || [];
    const numberedScript = processedDialogue.map((line, i) => `[Line ${i}] ${line.character || 'Narrator'}: ${line.text || line.line}`).join('\n');

    const recentHistorySignal = recentSongs.length > 0
      ? `### RECENTLY PLAYED TRACKS (AVOID repeating these unless the scene truly demands it):\n${recentSongs.map((s, i) => `- ${path.parse(s).name} (${i + 1} turns ago)`).join('\n')}\n\n`
      : "";

    const selectionPrompt = ostSmartSelectionPrompt
      .replace('${numberedScript}', numberedScript)
      .replace('${extraDetails}', extraDetails ? `Current World State: ${extraDetails}\n` : "")
      .replace('${backgroundSelectionSignal}', backgroundSelectionSignal ? `${backgroundSelectionSignal}\n` : "")
      .replace('${candidateCount}', totalCandidateCount)
      .replace('${candidateSummaries}', candidateSummaries)
      .replace('${project_directives}', projectDirectives)
      .replace('${recentOSTHistory}', recentHistorySignal);

    const selectionMessages = buildCoreVnLlmMessages(turnContext, selectionPrompt);
    TurnLogger.logRequest('Smart OST Select', selectionMessages, CONFIG.OST_MODEL, resolveModelAlias(CONFIG.OST_MODEL).provider);
    const { content: llmSelection, model: resolvedModelSelect } = await callLLM({
      model: CONFIG.OST_MODEL,
      provider: resolveModelAlias(CONFIG.OST_MODEL).provider,
      messages: selectionMessages,
      ...CONFIG.OST_PARAMS,
      callingModule: 'AssetSelector',
      turnLogTitle: 'Smart OST Select'
    });
    TurnLogger.logResponse('Smart OST Select', llmSelection, resolvedModelSelect, resolveModelAlias(CONFIG.OST_MODEL).provider);

    // â”€â”€ Step 5: Fuzzy Match to Filesystem â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const ostFilenames = ostList.map(getFilename);
    const result = parseMultiAssetSelection(llmSelection, ostList, ostFilenames, prevOST);
    if (result) return result;

    // Fallback to top candidate from any category if direct match fails
    const allScored = Object.values(categorizedCandidates).flat().sort((a, b) => b.compositeScore - a.compositeScore);
    if (allScored.length > 0) {
      const options = ostList.map(p => ({
        path: p,
        basename: path.parse(p).name
      }));
      const fallbackRes = fuzzysort.go(allScored[0].name, options, { key: 'basename' });
      if (fallbackRes && fallbackRes.length > 0) {
        const fallbackPath = fallbackRes[0].obj.basename;
        Logger.log('AssetSelector', 'OST (Smart)', `Match failed, using top scored fallback: ${fallbackPath}`);
        return { path: fallbackRes[0].obj.path, changes: [{ line: 0, path: fallbackRes[0].obj.path }] };
      }
    }

  } catch (error) {
    Logger.error('AssetSelector', 'OST (Smart)', 'Smart selection failed, falling back to basic:', error);
  }

  // Pure fallback to basic
  return null;
}
// #endregion

// #region EXPORTS
module.exports = {
  selectBestBackground,
  selectBestOST
};
// #endregion

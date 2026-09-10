const path = require('path');
const tags = require('./tags.js');
const prompts = require('./prompts.js');

/**
 * Logic for the Narrative Architect plugin.
 */

function parseEpisodeTags(episode) {
    try {
        const parsed = typeof episode.tags_json === 'string'
            ? JSON.parse(episode.tags_json || '[]')
            : episode.tags_json;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function getUniqueSeries(episodes) {
    const seriesSet = new Set();
    episodes.forEach(ep => {
        if (ep.series) seriesSet.add(ep.series);
    });
    return Array.from(seriesSet);
}

async function loadEpisodes(tools) {
    const dbPath = path.join(__dirname, 'episodes.db');
    const db = await tools.db.open(dbPath);
    try {
        const episodes = await db.query("SELECT filename, series, summary, tags_json FROM episodes WHERE status = 'done'");
        return {
            episodes,
            seriesList: getUniqueSeries(episodes)
        };
    } finally {
        await db.close();
    }
}

async function buildCooldownMap(turnContext, tools) {
    const currentTurn = turnContext.turnNumber || 0;
    const usedEpisodes = await tools.db.chat.query(
        `SELECT target as filename, fact_value as turn FROM facts
         WHERE predicate = 'architect_used' AND project_name = ?
           AND turn_number <= ?`,
        [turnContext.projectName.toLowerCase(), currentTurn]
    );

    const cooldownMap = new Map();
    usedEpisodes.forEach(row => {
        const usedTurn = parseInt(row.turn, 10);
        if (!Number.isFinite(usedTurn)) return;

        if (!cooldownMap.has(row.filename) || cooldownMap.get(row.filename) < usedTurn) {
            cooldownMap.set(row.filename, usedTurn);
        }
    });

    return cooldownMap;
}

function isEpisodeOffCooldown(filename, cooldownMap, currentTurn, cooldownWindow) {
    const lastUsed = cooldownMap.get(filename);
    return !lastUsed || (currentTurn - lastUsed >= cooldownWindow);
}

function normalizeSentence(sentence, maxLength = 220) {
    const compact = String(sentence || '').replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength - 3).trim()}...`;
}

function pushUniqueLesson(lessons, lesson, maxLessons) {
    const normalized = normalizeSentence(lesson);
    if (!normalized || lessons.includes(normalized)) return;
    if (lessons.length < maxLessons) lessons.push(normalized);
}

function inferCraftLesson(chunk, position, totalChunks) {
    const lower = String(chunk || '').toLowerCase();

    if (/\b(after|aftermath|recover|recovery|wound|exhaust|rest)\b/.test(lower)) {
        return 'Let the consequences of pressure show through a practical recovery beat before returning to plot momentum.';
    }
    if (/\b(meal|cook|market|work|routine|chore|festival|shop|tea|home)\b/.test(lower)) {
        return 'Use an ordinary task or local routine to reveal emotional residue and culture at the same time.';
    }
    if (/\b(secret|clue|reveal|truth|hidden|mystery|discover|evidence)\b/.test(lower)) {
        return 'Make information arrive through a choice, clue, or changed behavior rather than a direct exposition dump.';
    }
    if (/\b(friend|trust|bond|promise|protect|comfort|apology|confess|understand)\b/.test(lower)) {
        return 'Let relationship movement prove itself through a small changed behavior before anyone names the feeling.';
    }
    if (/\b(argue|conflict|fight|duel|attack|danger|threat|enemy)\b/.test(lower)) {
        return 'Turn external pressure into a values test so the scene changes a relationship or priority, not just the danger level.';
    }
    if (/\b(choice|decide|refuse|accept|sacrifice|risk|leave|stay)\b/.test(lower)) {
        return 'Frame the beat around a concrete decision where each option costs something legible.';
    }
    if (position === 0) {
        return 'Open with a concrete situation already in motion so emotion and premise arrive through action.';
    }
    if (position === totalChunks - 1) {
        return 'End on a visible behavioral change or unresolved social pressure instead of explaining the moral.';
    }
    return 'Let the middle beat complicate the situation by changing what a character wants, fears, or is willing to risk.';
}

function deriveLessonsFromSummary(summaryText, maxLessons = 4) {
    if (!summaryText) return [];

    const rawChunks = String(summaryText)
        .split(/\n+|(?<=[.!?])\s+/g)
        .map(chunk => normalizeSentence(chunk))
        .filter(chunk => chunk.length >= 28);

    const lessons = [];
    rawChunks.forEach((chunk, index) => {
        pushUniqueLesson(lessons, inferCraftLesson(chunk, index, rawChunks.length), maxLessons);
    });

    if (lessons.length < maxLessons && rawChunks.length > 0) {
        pushUniqueLesson(
            lessons,
            'Borrow the rhythm of setup, complication, and release, but replace all plot specifics with current cast and location logic.',
            maxLessons
        );
    }

    if (lessons.length === 0) {
        lessons.push('Use this reference only for abstract pacing: setup a specific pressure, complicate it through character choice, then end with changed behavior.');
    }

    return lessons;
}

function buildPlannerPatternObjects(selectedEpisodes) {
    return selectedEpisodes.map(ep => ({
        source: ep.filename,
        series: ep.series || 'Unknown',
        score: Number.isFinite(ep.score) ? ep.score : 0,
        tags: Array.isArray(ep.matchedTags) ? ep.matchedTags : [],
        matchedTags: Array.isArray(ep.matchedTags) ? ep.matchedTags : [],
        lessons: deriveLessonsFromSummary(ep.summary, 4)
    }));
}

function buildPlannerGuidanceBlock(patterns, metadata = {}) {
    if (!patterns || patterns.length === 0) return '';

    const requestedTags = Array.isArray(metadata.requestedTags) ? metadata.requestedTags : [];
    const requestedSeries = Array.isArray(metadata.requestedSeries) ? metadata.requestedSeries : [];
    const selectionMode = metadata.selectionMode || 'unknown';

    const lines = [
        '<architect_structural_guidance>',
        '[INSPIRATION ONLY - DO NOT COPY PLOTS, NAMES, LORE, OR SCENES]',
        'Use these as structural craft references for pacing, escalation, release, and beat timing.',
        `Selection mode: ${selectionMode}.`
    ];

    if (requestedTags.length > 0) {
        lines.push(`Requested tags: ${requestedTags.join(', ')}`);
    }
    if (requestedSeries.length > 0) {
        lines.push(`Requested series: ${requestedSeries.join(', ')}`);
    }

    patterns.forEach((pattern, index) => {
        lines.push('');
        lines.push(`Pattern ${index + 1}:`);
        lines.push(`- Source: ${pattern.source}`);
        lines.push(`- Series: ${pattern.series}`);
        lines.push(`- Match score: ${pattern.score.toFixed(2)}`);
        if (pattern.matchedTags.length > 0) {
            lines.push(`- Matched tags: ${pattern.matchedTags.join(', ')}`);
        }
        lines.push('- Lessons:');
        pattern.lessons.forEach(lesson => lines.push(`  - ${lesson}`));
    });

    lines.push('</architect_structural_guidance>');
    return lines.join('\n');
}

function parseCachedGuidancePayload(rawValue) {
    if (!rawValue) return null;
    try {
        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== 'object') return null;
        if (parsed.schema !== 'architect_cache_v2') return null;
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Extracts context tags using a cheap LLM.
 */
async function extractContextTags(turnContext, tools, settings, seriesList = []) {
    const contextDepth = settings.context_depth || 3;

    // 1. Gather recent summaries using TurnContext abstraction
    let recentSummaries = '';
    try {
        const { fullchapters, summarychapters, synopsischapters } = await turnContext.retrieveDatedChapters();
        const allChapters = [...synopsischapters, ...summarychapters, ...fullchapters];
        const recent = allChapters.slice(-contextDepth);

        if (recent.length > 0) {
            recentSummaries = recent
                .map(tc => `Turn ${tc.turnNumber}: ${tc.output.summary || tc.output.synopsis || 'No summary'}`)
                .join('\n');
        }
    } catch (error) {
        tools.logger.error('Logic', `Failed to gather recent summaries via TurnContext: ${error.message}`);
    }

    const directorBrief = turnContext.processed.director?.writerBrief || '';

    // 2. Build prompt and call LLM
    const modelDef = settings.model_def || { model: 'mediumendmodel' };
    const useSharedModel = tools.llm.vnBackground?.isSelected?.(modelDef) === true;
    const systemPrompt = prompts.getTagExtractionPrompt(
        useSharedModel ? 'Use SELECTED NARRATIVE HISTORY from the shared background context.' : recentSummaries,
        useSharedModel ? 'Use DIRECTOR BRIEF from the shared background context.' : directorBrief,
        seriesList
    );
    const messages = [{ role: 'user', content: systemPrompt }];
    const resolvedModelDef = tools.llm.resolveModelDefinition?.(modelDef) || modelDef;

    tools.logger.log('Extraction', 'Calling LLM for structural tag extraction...', 'start');

    try {
        const task = {
            msg: 'Narrative Architect: Tag Extraction',
            params: {
                callingModule: 'Plugin:narrative_architect:extraction'
            }
        };
        const schema = {
            type: 'object',
            required: ['tags', 'series'],
            properties: {
                tags: { type: 'array' },
                series: { type: 'array' }
            }
        };
        const response = useSharedModel
            ? await tools.llm.vnBackground.withSchema({ ...task, scene: 'none', suffix: systemPrompt }, schema)
            : await tools.llm.withSchema({ ...task, messages, model: resolvedModelDef.model, provider: resolvedModelDef.provider }, schema);

        const extractedData = response.content || {};
        const validTags = tags.validateTags(extractedData.tags || []);
        const validSeries = Array.isArray(extractedData.series) ? extractedData.series : [];
        tools.logger.log('Extraction', `Extracted ${validTags.length} tags and ${validSeries.length} series recommendations.`, 'end');
        return { tags: validTags, series: validSeries };
    } catch (error) {
        tools.logger.error('Extraction', `LLM call failed: ${error.message}`);
        return { tags: [], series: [] };
    }
}

/**
 * Scores all episodes in the DB based on tag overlap.
 */
function scoreEpisodes(requestedTags, requestedSeries, episodes) {
    if ((!requestedTags || requestedTags.length === 0) && (!requestedSeries || requestedSeries.length === 0)) {
        return episodes.map(ep => ({ ...ep, score: 0, matchedTags: [], matchedSeries: [] }));
    }

    return episodes.map(ep => {
        const epTags = parseEpisodeTags(ep);
        let score = 0;
        let totalPossibleWeight = 0;

        requestedTags.forEach(tag => {
            totalPossibleWeight += tags.CATEGORY_WEIGHTS[tags.getCategoryForTag(tag)] || 1.0;
        });

        requestedSeries.forEach(() => {
            totalPossibleWeight += tags.SERIES_MATCH_WEIGHT || 3.0;
        });

        const matchedTags = [];
        epTags.forEach(tag => {
            if (requestedTags.includes(tag)) {
                score += tags.CATEGORY_WEIGHTS[tags.getCategoryForTag(tag)] || 1.0;
                matchedTags.push(tag);
            }
        });

        const matchedSeries = [];
        if (ep.series && requestedSeries.includes(ep.series)) {
            score += tags.SERIES_MATCH_WEIGHT || 3.0;
            matchedSeries.push(ep.series);
        }

        const finalScore = totalPossibleWeight > 0 ? (score / totalPossibleWeight) : 0;
        return {
            ...ep,
            score: finalScore,
            matchedTags,
            matchedSeries
        };
    }).sort((a, b) => b.score - a.score);
}

function pickPlannerCandidates(scoredEpisodes, cooldownMap, currentTurn, maxCooldown, limit) {
    if (!Array.isArray(scoredEpisodes) || scoredEpisodes.length === 0) return [];

    const offCooldown = scoredEpisodes.filter(ep =>
        isEpisodeOffCooldown(ep.filename, cooldownMap, currentTurn, maxCooldown)
    );

    const selected = offCooldown.slice(0, limit);
    if (selected.length >= limit) return selected;

    for (const episode of scoredEpisodes) {
        if (selected.find(item => item.filename === episode.filename)) continue;
        selected.push(episode);
        if (selected.length >= limit) break;
    }

    return selected;
}

async function selectStructuralPatternPayload(turnContext, tools, settings = {}, options = {}) {
    let episodes;
    let seriesList;
    try {
        const loaded = await loadEpisodes(tools);
        episodes = loaded.episodes;
        seriesList = loaded.seriesList;
    } catch (error) {
        tools.logger.error('ArchitectService', `Failed to load episode corpus: ${error.message}`);
        return null;
    }

    if (!Array.isArray(episodes) || episodes.length === 0) return null;

    const limit = Math.max(1, Math.min(8, parseInt(options.limit || settings.planner_reference_limit || 4, 10) || 4));
    const maxCooldown = settings.max_cooldown || 15;
    const currentTurn = turnContext.turnNumber || 0;
    const allowFreshExtraction = options.allowFreshExtraction === true;

    let requestedTags = tags.validateTags(options.tags || []);
    let requestedSeries = Array.isArray(options.series) ? options.series : [];
    let selectionMode = 'fallback_random';

    const projectName = turnContext.projectName.toLowerCase();
    if (requestedTags.length === 0 && requestedSeries.length === 0) {
        const rows = await tools.db.chat.query(
            `SELECT fact_value, context FROM facts
             WHERE project_name = ? AND predicate = 'architect_cache'
               AND turn_number <= ?
             ORDER BY turn_number DESC, id DESC LIMIT 1`,
            [projectName, currentTurn]
        );

        if (rows && rows.length > 0) {
            try {
                const cachedPayload = parseCachedGuidancePayload(rows[0].fact_value);
                const cachedContext = JSON.parse(rows[0].context || '{}');

                if (cachedPayload?.patterns && options.forceReselect !== true) {
                    return {
                        source: 'narrative_architect',
                        mode: options.mode || 'planner',
                        selectionMode: 'cached_guidance',
                        requestedTags: cachedPayload.requestedTags || [],
                        requestedSeries: cachedPayload.requestedSeries || [],
                        patterns: cachedPayload.patterns || [],
                        guidanceBlock: cachedPayload.guidanceBlock || ''
                    };
                }

                const context = JSON.parse(rows[0].context || '{}');
                requestedTags = tags.validateTags(
                    context.requestedTags
                    || cachedPayload?.requestedTags
                    || cachedContext.requestedTags
                    || context.tags
                    || []
                );
                requestedSeries = Array.isArray(context.requestedSeries)
                    ? context.requestedSeries
                    : (Array.isArray(cachedPayload?.requestedSeries)
                        ? cachedPayload.requestedSeries
                        : (Array.isArray(context.series) ? context.series : []));
                if (requestedTags.length > 0 || requestedSeries.length > 0) {
                    selectionMode = 'cached_context';
                }
            } catch { }
        }
    }

    if (requestedTags.length === 0 && requestedSeries.length === 0 && allowFreshExtraction && !settings.disable_llm) {
        const extraction = await extractContextTags(turnContext, tools, settings, seriesList);
        requestedTags = extraction.tags;
        requestedSeries = extraction.series;
        if (requestedTags.length > 0 || requestedSeries.length > 0) {
            selectionMode = 'fresh_extraction';
        }
    }

    let scoredEpisodes = scoreEpisodes(requestedTags, requestedSeries, episodes);
    if (selectionMode === 'fallback_random') {
        scoredEpisodes = [...episodes]
            .map(ep => ({ ...ep, score: Math.random(), matchedTags: [], matchedSeries: [] }))
            .sort((a, b) => b.score - a.score);
    }

    const cooldownMap = await buildCooldownMap(turnContext, tools);
    const selectedEpisodes = pickPlannerCandidates(scoredEpisodes, cooldownMap, currentTurn, maxCooldown, limit);
    const patterns = buildPlannerPatternObjects(selectedEpisodes);
    const guidanceBlock = buildPlannerGuidanceBlock(patterns, {
        requestedTags,
        requestedSeries,
        selectionMode
    });

    return {
        source: 'narrative_architect',
        mode: options.mode || 'planner',
        selectionMode,
        requestedTags,
        requestedSeries,
        patterns,
        guidanceBlock
    };
}

/**
 * Selects the best episode based on score and cooldown.
 */
async function selectBestEpisode(turnContext, tools, scoredEpisodes, settings) {
    if (scoredEpisodes.length === 0) return null;

    const maxCooldown = settings.max_cooldown || 15;
    const currentTurn = turnContext.turnNumber || 0;
    const cooldownMap = await buildCooldownMap(turnContext, tools);

    let candidates = scoredEpisodes.filter(ep =>
        isEpisodeOffCooldown(ep.filename, cooldownMap, currentTurn, maxCooldown)
    );

    if (candidates.length === 0 && scoredEpisodes.length > 0) {
        tools.logger.warn('Logic', 'All episodes on cooldown. Retrying with reduced window.');
        const reducedCooldown = Math.floor(maxCooldown / 2);
        candidates = scoredEpisodes.filter(ep =>
            isEpisodeOffCooldown(ep.filename, cooldownMap, currentTurn, reducedCooldown)
        );
    }

    if (candidates.length === 0) return scoredEpisodes[0];

    if (settings.enable_quality_mode && candidates.length > 1) {
        const top3 = candidates.slice(0, 3);
        const margin = top3[0].score - top3[1].score;
        if (margin < 0.1) {
            tools.logger.log('Selection', 'Quality mode: Top candidates tied. Refining with LLM...');
            try {
                // Placeholder for optional refinement call.
            } catch { }
        }
    }

    return candidates[0];
}

async function getPlannerStructuralGuidance(turnContext, tools, settings = {}, options = {}) {
    const payload = await selectStructuralPatternPayload(turnContext, tools, settings, options);
    return payload?.guidanceBlock || '';
}

async function getStructuralPatterns(turnContext, tools, settings = {}, options = {}) {
    const payload = await selectStructuralPatternPayload(turnContext, tools, settings, {
        ...options,
        mode: options.mode || 'planner'
    });

    if (!payload) {
        return {
            source: 'narrative_architect',
            mode: options.mode || 'planner',
            selectionMode: 'unavailable',
            requestedTags: [],
            requestedSeries: [],
            patterns: []
        };
    }

    const structuredPayload = { ...payload };
    delete structuredPayload.guidanceBlock;
    return structuredPayload;
}

/**
 * Main background task orchestration.
 */
async function processTurnAnalysis(turnContext, tools, settings) {
    // Ensure no leftover architect data from a retried turn
    await tools.facts.cleanUpFactsDb();

    let episodes = [];
    let seriesList = [];
    try {
        const loaded = await loadEpisodes(tools);
        episodes = loaded.episodes;
        seriesList = loaded.seriesList;
    } catch (error) {
        tools.logger.error('Logic', `Failed to read episodes.db at ${path.join(__dirname, 'episodes.db')}: ${error.message}`);
        return;
    }

    if (episodes.length === 0) return;

    let requestedTags = [];
    let requestedSeries = [];

    if (settings.disable_llm) {
        tools.logger.log('Logic', 'LLM analysis disabled. Proceeding with random selection.');
    } else {
        const extraction = await extractContextTags(turnContext, tools, settings, seriesList);
        requestedTags = extraction.tags;
        requestedSeries = extraction.series;
    }

    let winner = null;
    if (settings.disable_llm) {
        const scored = episodes
            .map(ep => ({ ...ep, score: Math.random(), matchedTags: [], matchedSeries: [] }))
            .sort((a, b) => b.score - a.score);
        winner = await selectBestEpisode(turnContext, tools, scored, settings);
    } else {
        if (requestedTags.length === 0 && requestedSeries.length === 0) return;
        const scored = scoreEpisodes(requestedTags, requestedSeries, episodes);
        winner = await selectBestEpisode(turnContext, tools, scored, settings);
    }

    if (winner) {
        tools.logger.log('Selection', `Selected episode structural reference: ${winner.filename} (Score: ${winner.score.toFixed(2)})`);
        const turnNumber = turnContext.turnNumber;
        const pattern = buildPlannerPatternObjects([winner])[0];
        const guidanceBlock = buildPlannerGuidanceBlock([pattern], {
            requestedTags,
            requestedSeries,
            selectionMode: 'turn_analysis_winner'
        });

        const payload = {
            schema: 'architect_cache_v2',
            type: 'planner_structural_guidance',
            requestedTags: requestedTags || [],
            requestedSeries: requestedSeries || [],
            patterns: [pattern],
            guidanceBlock,
            generatedAtTurn: turnNumber
        };

        const contextData = {
            requestedTags: requestedTags || [],
            requestedSeries: requestedSeries || [],
            tags: winner.matchedTags || [],
            series: winner.matchedSeries || [],
            schema: payload.schema
        };

        await tools.facts.appendToFactsDb({
            source: 'architect',
            target: winner.filename,
            predicate: 'architect_cache',
            fact_value: JSON.stringify(payload),
            context: JSON.stringify(contextData)
        }, { turn_number: turnNumber });

        await tools.facts.appendToFactsDb({
            source: 'architect',
            target: winner.filename,
            predicate: 'architect_used',
            fact_value: turnNumber.toString()
        }, { turn_number: turnNumber });
    }
}

module.exports = {
    processTurnAnalysis,
    getPlannerStructuralGuidance,
    getStructuralPatterns
};

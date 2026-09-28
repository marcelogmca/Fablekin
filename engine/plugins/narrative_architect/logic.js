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
async function extractContextTags(turnContext, tools, settings, seriesList = [], batch = {}) {
    const currentDirection = [
        turnContext.input?.userPrompt,
        turnContext.input?.softFeedback,
        turnContext.input?.directorPrompt
    ].filter(Boolean).join('\n\n');

    const modelDef = settings.model_def || { model: 'mediumendmodel' };
    const systemPrompt = prompts.getTagExtractionPrompt(
        batch.promptText || '',
        currentDirection,
        seriesList,
        batch
    );
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
        const response = await tools.llm.withSchema({
            ...task,
            requestId: 'context_tag_extraction',
            prompt: systemPrompt,
            model: resolvedModelDef.model,
            provider: resolvedModelDef.provider
        }, schema);

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

function clampInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function getChapterNumber(chapter) {
    const creationTurn = Number.parseInt(chapter?.creationTurnNumber, 10);
    if (Number.isInteger(creationTurn) && creationTurn > 0) return creationTurn;
    const turn = Number.parseInt(chapter?.turnNumber, 10);
    return Number.isInteger(turn) && turn > 0 ? turn : 0;
}

function buildChapterDigest(chapter, maxChars) {
    const output = chapter?.output || {};
    const text = output.summary || output.synopsis || output.fulltext || 'No chapter summary available.';
    const compact = String(text).replace(/\s+/g, ' ').trim();
    const bounded = compact.length > maxChars
        ? `${compact.slice(0, Math.max(1, maxChars - 3)).trim()}...`
        : compact;
    return `Chapter ${getChapterNumber(chapter)}: ${bounded}`;
}

async function getLastBatchCursor(turnContext, tools) {
    const projectName = String(turnContext.projectName || '').toLowerCase();
    const currentTurn = Number(turnContext.turnNumber || 0);
    const batchRows = await tools.db.chat.query(
        `SELECT turn_number, context FROM facts
         WHERE project_name = ? AND predicate = 'architect_tag_batch'
           AND turn_number <= ?
         ORDER BY turn_number DESC, id DESC LIMIT 1`,
        [projectName, currentTurn]
    );

    if (batchRows?.length) {
        let context = {};
        try { context = JSON.parse(batchRows[0].context || '{}'); } catch { }
        return {
            analysisTurn: Number(batchRows[0].turn_number || 0),
            batchEndTurn: Number(context.batchEndTurn || 0)
        };
    }

    // Migration path: the former autonomous task wrote architect_cache once per chapter.
    const cacheRows = await tools.db.chat.query(
        `SELECT turn_number FROM facts
         WHERE project_name = ? AND predicate = 'architect_cache'
           AND turn_number < ?
         ORDER BY turn_number DESC, id DESC LIMIT 1`,
        [projectName, currentTurn]
    );
    const legacyTurn = Number(cacheRows?.[0]?.turn_number || 0);
    return { analysisTurn: legacyTurn, batchEndTurn: legacyTurn };
}

async function collectChapterBatch(turnContext, tools, settings, request) {
    const cursor = await getLastBatchCursor(turnContext, tools);
    const requestedEndTurn = Math.max(0, Number(request?.batchEndTurn || Number(turnContext.turnNumber || 0) - 1));
    const legacyDepth = clampInteger(settings.context_depth, 12, 1, 50);
    const maxChapters = clampInteger(settings.batch_max_chapters, legacyDepth, 1, 50);
    const maxChars = clampInteger(settings.batch_chapter_max_chars, 900, 200, 2400);
    const history = await turnContext.retrieveDatedChapters();
    const byTurn = new Map();

    for (const chapter of [
        ...(history.synopsischapters || []),
        ...(history.summarychapters || []),
        ...(history.fullchapters || [])
    ]) {
        const chapterNumber = getChapterNumber(chapter);
        if (chapterNumber <= cursor.batchEndTurn || chapterNumber > requestedEndTurn) continue;
        byTurn.set(chapterNumber, chapter);
    }

    const chapters = Array.from(byTurn.values())
        .sort((a, b) => getChapterNumber(a) - getChapterNumber(b))
        .slice(-maxChapters);
    const startTurn = chapters.length ? getChapterNumber(chapters[0]) : 0;
    const endTurn = chapters.length ? getChapterNumber(chapters[chapters.length - 1]) : cursor.batchEndTurn;

    return {
        cursor,
        chapters,
        startTurn,
        endTurn,
        requestedEndTurn,
        promptText: chapters.map(chapter => buildChapterDigest(chapter, maxChars)).join('\n')
    };
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
    try {
        const loaded = await loadEpisodes(tools);
        episodes = loaded.episodes;
    } catch (error) {
        tools.logger.error('ArchitectService', `Failed to load episode corpus: ${error.message}`);
        return null;
    }

    if (!Array.isArray(episodes) || episodes.length === 0) return null;

    const limit = Math.max(1, Math.min(8, parseInt(options.limit || settings.planner_reference_limit || 4, 10) || 4));
    const maxCooldown = settings.max_cooldown || 15;
    const currentTurn = turnContext.turnNumber || 0;
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
 * Processes a Grand Planner-requested batch. This function is intentionally not
 * called by any autonomous Narrative Architect cadence.
 */
async function processRequestedBatch(turnContext, tools, settings = {}, request = {}) {
    if (request.requestedBy !== 'grand_story_planner') {
        return { status: 'ignored', reason: 'missing_grand_planner_request' };
    }

    const batch = await collectChapterBatch(turnContext, tools, settings, request);
    if (batch.cursor.analysisTurn === Number(turnContext.turnNumber || 0)) {
        return { status: 'already_completed', batchEndTurn: batch.cursor.batchEndTurn };
    }
    if (batch.chapters.length === 0) {
        tools.logger.log('Logic', 'Grand Planner requested tagging, but no completed chapters were added since the last Architect batch.');
        return { status: 'no_new_chapters', batchEndTurn: batch.cursor.batchEndTurn };
    }

    // Clear only this plugin's current-turn outputs so a retried request is idempotent.
    await tools.facts.cleanUpFactsDb({
        predicates: ['architect_cache', 'architect_used', 'architect_tag_batch']
    });

    let episodes = [];
    let seriesList = [];
    try {
        const loaded = await loadEpisodes(tools);
        episodes = loaded.episodes;
        seriesList = loaded.seriesList;
    } catch (error) {
        tools.logger.error('Logic', `Failed to read episodes.db at ${path.join(__dirname, 'episodes.db')}: ${error.message}`);
        return { status: 'failed', reason: 'episode_corpus_unavailable' };
    }

    if (episodes.length === 0) return { status: 'failed', reason: 'episode_corpus_empty' };

    let requestedTags = [];
    let requestedSeries = [];

    if (settings.disable_llm) {
        tools.logger.log('Logic', 'LLM analysis disabled. Proceeding with random selection.');
    } else {
        const extraction = await extractContextTags(turnContext, tools, settings, seriesList, batch);
        requestedTags = extraction.tags;
        requestedSeries = extraction.series;
    }

    let scored = [];
    if (settings.disable_llm) {
        scored = episodes
            .map(ep => ({ ...ep, score: Math.random(), matchedTags: [], matchedSeries: [] }))
            .sort((a, b) => b.score - a.score);
    } else {
        if (requestedTags.length === 0 && requestedSeries.length === 0) {
            return { status: 'failed', reason: 'tag_extraction_returned_no_signal' };
        }
        scored = scoreEpisodes(requestedTags, requestedSeries, episodes);
    }

    const limit = clampInteger(settings.planner_reference_limit, 4, 1, 8);
    const cooldownMap = await buildCooldownMap(turnContext, tools);
    const selected = pickPlannerCandidates(
        scored,
        cooldownMap,
        Number(turnContext.turnNumber || 0),
        settings.max_cooldown || 15,
        limit
    );

    if (selected.length > 0) {
        tools.logger.log('Selection', `Prepared ${selected.length} structural reference(s) for the upcoming Grand Planner run.`);
        const turnNumber = turnContext.turnNumber;
        const patterns = buildPlannerPatternObjects(selected);
        const guidanceBlock = buildPlannerGuidanceBlock(patterns, {
            requestedTags,
            requestedSeries,
            selectionMode: 'grand_planner_requested_batch'
        });

        const payload = {
            schema: 'architect_cache_v2',
            type: 'planner_structural_guidance',
            requestedTags: requestedTags || [],
            requestedSeries: requestedSeries || [],
            patterns,
            guidanceBlock,
            generatedAtTurn: turnNumber,
            batchStartTurn: batch.startTurn,
            batchEndTurn: batch.endTurn,
            chapterCount: batch.chapters.length
        };

        const contextData = {
            requestedTags: requestedTags || [],
            requestedSeries: requestedSeries || [],
            schema: payload.schema,
            batchStartTurn: batch.startTurn,
            batchEndTurn: batch.endTurn,
            chapterCount: batch.chapters.length
        };

        await tools.facts.appendToFactsDb({
            source: 'architect',
            target: selected[0].filename,
            predicate: 'architect_cache',
            fact_value: JSON.stringify(payload),
            context: JSON.stringify(contextData)
        }, { turn_number: turnNumber });

        for (const episode of selected) await tools.facts.appendToFactsDb({
            source: 'architect',
            target: episode.filename,
            predicate: 'architect_used',
            fact_value: turnNumber.toString()
        }, { turn_number: turnNumber });

        await tools.facts.appendToFactsDb({
            source: 'architect',
            target: `${batch.startTurn}-${batch.endTurn}`,
            predicate: 'architect_tag_batch',
            fact_value: JSON.stringify({ tags: requestedTags, series: requestedSeries }),
            context: JSON.stringify({
                requestedBy: request.requestedBy,
                batchStartTurn: batch.startTurn,
                batchEndTurn: batch.endTurn,
                chapterCount: batch.chapters.length
            })
        }, { turn_number: turnNumber });

        return {
            status: 'completed',
            batchStartTurn: batch.startTurn,
            batchEndTurn: batch.endTurn,
            chapterCount: batch.chapters.length,
            referenceCount: selected.length
        };
    }

    return { status: 'failed', reason: 'no_structural_references_available' };
}

module.exports = {
    processRequestedBatch,
    getPlannerStructuralGuidance,
    getStructuralPatterns,
    collectChapterBatch
};

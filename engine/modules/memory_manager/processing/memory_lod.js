const path = require('path');
const { Logger, readSettings, generateHash, TurnLogger } = require('../../utils.js');
const memorymanagement = require('../memory_manager.js');
const chaptermanagement = require('../../chaptermanagement.js');
const { callLLM, resolveModelAlias } = require('../../llm.js');
const { Prompt } = require('../../prompt/prompt.js');
const { runWithDiagnosticContext } = require('../../diagnostic_context.js');

const DEFAULT_COMPRESSED_HISTORY_PRESETS = Object.freeze({
    brief: Object.freeze({ full_chapters: 0, summary_chapters: 5, synopsis_chapters: 10 }),
    balanced: Object.freeze({ full_chapters: 1, summary_chapters: 10, synopsis_chapters: 20 }),
    deep: Object.freeze({ full_chapters: 2, summary_chapters: 16, synopsis_chapters: 40 })
});
const ARC_COMPRESSION_CACHE_VERSION = 'memory-lod-arc-v3';
const DEFAULT_ARC_TILE_CHAPTERS = 25;
const DEFAULT_ARC_ROLLOVER_GRACE_CHAPTERS = 5;
const DEFAULT_ARC_TAIL_MAX_INPUT_CHARS = 60000;
const DEFAULT_ARC_TARGET_WORDS = 300;

function readNumberSetting(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function readCountSetting(source, snakeKey, camelKey, fallback) {
    const value = source?.[snakeKey] ?? source?.[camelKey];
    const parsed = readNumberSetting(value, fallback);
    return Math.max(0, Math.floor(parsed));
}

function readBoundedNumberSetting(source, snakeKey, camelKey, fallback, min = 0, max = Number.POSITIVE_INFINITY) {
    const value = source?.[snakeKey] ?? source?.[camelKey];
    const parsed = readNumberSetting(value, fallback);
    return Math.max(min, Math.min(max, parsed));
}

function getMemoryLODSettings(settings = readSettings()) {
    return settings?.infrastructure?.narrative_history?.memory_lod || {};
}

function getSummarizerSettings(settings = readSettings()) {
    return settings?.narrative_agents?.summarizer || {};
}

function getCompressedHistoryArcTailConfig(settings = readSettings()) {
    const historySettings = settings?.infrastructure?.narrative_history || {};
    const compressedHistorySettings = historySettings.compressed_history || {};
    const tailSettings = compressedHistorySettings.arc_tail || {};
    const lodSettings = historySettings.memory_lod || {};
    const summarizerSettings = getSummarizerSettings(settings);
    const lodArcEnabled = lodSettings.enable_arc_compression ?? lodSettings.enableArcCompression ?? false;
    const rolloverGraceChapters = Math.max(1, readCountSetting(
        tailSettings,
        'rollover_grace_chapters',
        'rolloverGraceChapters',
        readCountSetting(
            compressedHistorySettings,
            'arc_rollover_grace_chapters',
            'arcRolloverGraceChapters',
            readCountSetting(
                lodSettings,
                'arc_rollover_grace_chapters',
                'arcRolloverGraceChapters',
                DEFAULT_ARC_ROLLOVER_GRACE_CHAPTERS
            )
        )
    ));

    const model = tailSettings.arc_compression_model || tailSettings.arcCompressionModel ||
        summarizerSettings.arc_compression_model || summarizerSettings.arcCompressionModel ||
        lodSettings.arc_compression_model || lodSettings.arcCompressionModel || 'lowendmodel';

    return {
        enabled: tailSettings.enabled ?? compressedHistorySettings.include_arc_tail ?? lodArcEnabled,
        rolloverGraceChapters,
        minChapters: Math.max(1, readCountSetting(
            tailSettings,
            'min_chapters',
            'minChapters',
            readNumberSetting(
                lodSettings.arc_compress_old_chapter_min_threshold ?? lodSettings.arcCompressOldChapterMinThreshold,
                3
            )
        )),
        tileChapters: Math.max(rolloverGraceChapters, readCountSetting(
            tailSettings,
            'tile_chapters',
            'tileChapters',
            readCountSetting(
                tailSettings,
                'max_chapters_per_chunk',
                'maxChaptersPerChunk',
                readCountSetting(
                    lodSettings,
                    'arc_tile_chapters',
                    'arcTileChapters',
                    DEFAULT_ARC_TILE_CHAPTERS
                )
            )
        )),
        maxInputChars: Math.max(1000, readCountSetting(
            tailSettings,
            'max_input_chars',
            'maxInputChars',
            DEFAULT_ARC_TAIL_MAX_INPUT_CHARS
        )),
        targetWords: Math.max(80, readCountSetting(
            tailSettings,
            'target_words',
            'targetWords',
            DEFAULT_ARC_TARGET_WORDS
        )),
        model,
        provider: resolveModelAlias(model).provider,
        retries: readBoundedNumberSetting(
            tailSettings,
            'arc_compression_retries',
            'arcCompressionRetries',
            readBoundedNumberSetting(lodSettings, 'arc_compression_retries', 'arcCompressionRetries', 1, 0, 6),
            0,
            6
        ),
        timeout: readBoundedNumberSetting(
            tailSettings,
            'arc_compression_timeout',
            'arcCompressionTimeout',
            readBoundedNumberSetting(lodSettings, 'arc_compression_timeout', 'arcCompressionTimeout', 60000, 5000, 300000),
            5000,
            300000
        ),
        minCharacters: readBoundedNumberSetting(
            tailSettings,
            'arc_compression_min_characters',
            'arcCompressionMinCharacters',
            readBoundedNumberSetting(lodSettings, 'arc_compression_min_characters', 'arcCompressionMinCharacters', 100, 1, 2000),
            1,
            2000
        )
    };
}

function getCompressedHistoryPresets(settings = readSettings()) {
    const configuredPresets = settings?.infrastructure?.narrative_history?.compressed_history?.presets || {};
    const presets = {};

    for (const [name, defaults] of Object.entries(DEFAULT_COMPRESSED_HISTORY_PRESETS)) {
        const configured = configuredPresets?.[name] || {};
        presets[name] = {
            full_chapters: readCountSetting(configured, 'full_chapters', 'fullChapters', defaults.full_chapters),
            summary_chapters: readCountSetting(configured, 'summary_chapters', 'summaryChapters', defaults.summary_chapters),
            synopsis_chapters: readCountSetting(configured, 'synopsis_chapters', 'synopsisChapters', defaults.synopsis_chapters)
        };
    }

    return presets;
}

function createEmptyCompressedHistory() {
    return {
        brief: 'No story yet.',
        balanced: 'No story yet.',
        deep: 'No story yet.'
    };
}

function getDocContent(doc) {
    return String(doc?.content ?? doc?.pageContent ?? '').trim();
}

function getDocTurnNumber(doc) {
    return Number(doc?.turnNumber ?? doc?.metadata?.turn_number);
}

function normalizeContentForKey(content) {
    return String(content || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getChunkDedupeKey(doc) {
    const content = getDocContent(doc);
    if (!content) return null;

    const turnNum = getDocTurnNumber(doc);
    const metadata = doc?.metadata || {};
    const chunkPosition = metadata.chunkPosition;
    const contentHash = metadata.contentHash;

    if (!isNaN(turnNum) && chunkPosition !== undefined && contentHash) {
        return `${turnNum}:${chunkPosition}:${contentHash}`;
    }

    return `content:${generateHash(normalizeContentForKey(content), 'sha256').substring(0, 16)}`;
}

function appendSlottedRagChunk(turnContext, turnNum, content) {
    const trimmed = String(content || '').trim();
    if (!trimmed || isNaN(turnNum)) return false;

    if (!turnContext.processed.slottedRAG[turnNum]) {
        turnContext.processed.slottedRAG[turnNum] = "";
    } else {
        turnContext.processed.slottedRAG[turnNum] += "\n\n";
    }

    turnContext.processed.slottedRAG[turnNum] += trimmed;
    return true;
}

function shuffleInPlace(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

async function collectRandomSlottedRagDocs(projectName, eligibleTurnNumbers, budget, usedChunkKeys) {
    if (budget <= 0 || eligibleTurnNumbers.length === 0) return [];

    const vectorStore = await memorymanagement.initVectorStore(projectName, 'chapters');
    const poolLimit = Math.min(50000, Math.max(1000, eligibleTurnNumbers.length * 20, budget * 100));
    const rawDocs = typeof vectorStore.metadataSearch === 'function'
        ? await vectorStore.metadataSearch({ turn_number: { $in: eligibleTurnNumbers } }, poolLimit)
        : await vectorStore.similaritySearch("", poolLimit, { turn_number: { $in: eligibleTurnNumbers } });

    const shuffledDocs = shuffleInPlace(rawDocs
        .map(doc => ({
            content: doc.pageContent,
            turnNumber: Number(doc.metadata?.turn_number),
            metadata: doc.metadata || {}
        }))
        .filter(doc => !isNaN(doc.turnNumber) && eligibleTurnNumbers.includes(doc.turnNumber) && getDocContent(doc)));

    const selected = [];
    for (const doc of shuffledDocs) {
        if (selected.length >= budget) break;
        const key = getChunkDedupeKey(doc);
        if (!key || usedChunkKeys.has(key)) continue;
        usedChunkKeys.add(key);
        selected.push(doc);
    }

    return selected;
}

function buildInterludeCapsuleBlock(turnContextLike) {
    const capsules = turnContextLike?.processed?.plugins?.interludeCapsules;
    if (!Array.isArray(capsules) || capsules.length === 0) return '';

    const lines = capsules
        .slice()
        .sort((a, b) => (a?.ordinal || 0) - (b?.ordinal || 0))
        .map((capsule) => {
            const text = typeof capsule?.capsule === 'string' ? capsule.capsule.trim() : '';
            if (!text) return null;
            const label = capsule?.label ? ` - ${capsule.label}` : '';
            const displayTurn = capsule?.displayTurn || `${turnContextLike.turnNumber}.${capsule?.ordinal || '?'}`;
            return `- ${displayTurn}${label}: ${text}`;
        })
        .filter(Boolean);

    if (lines.length === 0) return '';
    return `[Interlude Summaries]\n${lines.join('\n')}`;
}

function appendInterludeCapsulesIfMissing(content, turnContextLike) {
    const normalized = typeof content === 'string' ? content : String(content || '');
    const block = buildInterludeCapsuleBlock(turnContextLike);
    if (!block) return normalized;

    if (normalized.includes('[Interlude Summaries]')) {
        return normalized;
    }

    return normalized.trim()
        ? `${normalized}\n\n${block}`
        : block;
}

function normalizeChapterItem(item) {
    return item?.tc ? item : { tc: item, nativeTier: item?.nativeTier || 'unknown' };
}

function orderChapterItems(allChapters) {
    return (Array.isArray(allChapters) ? allChapters : [])
        .map(normalizeChapterItem)
        .filter(item => item?.tc && Number.isFinite(Number(item.tc.turnNumber)))
        .sort((a, b) => Number(a.tc.turnNumber) - Number(b.tc.turnNumber));
}

function getTimelineRoutingForTurn(routing, turnNum) {
    const rawPre = routing?.pre?.[turnNum];
    const rawPost = routing?.post?.[turnNum];
    const pre = rawPre ? (rawPre.startsWith('[') ? `${rawPre}\n` : `[${rawPre}]\n`) : '';
    const post = rawPost ? (rawPost.endsWith(']') ? `\n${rawPost}` : `\n[${rawPost}]`) : '';
    return { pre, post };
}

function getStretchedSynopsisCount(availableChapters, configuredCount, rolloverGraceChapters) {
    if (configuredCount <= 0 || rolloverGraceChapters <= 0) return configuredCount;

    const grace = Math.min(configuredCount, rolloverGraceChapters);
    const baseCount = configuredCount - grace;
    if (availableChapters <= baseCount) return availableChapters;

    return baseCount + ((availableChapters - baseCount) % grace);
}

function selectCompressedHistoryItems(allChapters, preset, rolloverGraceChapters = 0) {
    const ordered = orderChapterItems(allChapters);

    const selectedTiers = new Map();
    let cursor = ordered.length - 1;

    const takeNewest = (tier, count) => {
        for (let i = 0; i < count && cursor >= 0; i++, cursor--) {
            selectedTiers.set(Number(ordered[cursor].tc.turnNumber), tier);
        }
    };

    takeNewest('full', preset.full_chapters);
    takeNewest('summary', preset.summary_chapters);
    const availableForSynopsis = cursor + 1;
    const synopsisCount = getStretchedSynopsisCount(
        availableForSynopsis,
        preset.synopsis_chapters,
        rolloverGraceChapters
    );
    takeNewest('synopsis', synopsisCount);

    return ordered
        .filter(item => selectedTiers.has(Number(item.tc.turnNumber)))
        .map(item => ({
            item,
            tier: selectedTiers.get(Number(item.tc.turnNumber))
        }));
}

function getChapterTextForArc(item) {
    const tc = item?.tc || item;
    return String(
        tc?.output?.summary ||
        tc?.output?.synopsis ||
        tc?.output?.fulltext ||
        ''
    ).trim();
}

function buildArcCombinedText(bucket) {
    return bucket
        .map(item => {
            const turnNum = Number(item?.tc?.turnNumber);
            const content = getChapterTextForArc(item);
            return !isNaN(turnNum) && content ? `Chapter ${turnNum}:\n${content}` : '';
        })
        .filter(Boolean)
        .join('\n\n');
}

function getArcCacheKey(combinedText, targetWords) {
    const primaryPayload = JSON.stringify({
        version: ARC_COMPRESSION_CACHE_VERSION,
        targetWords,
        combinedText
    });

    return generateHash(primaryPayload, 'sha256');
}

function createArcCompressionPrompt(combinedText, targetWords = DEFAULT_ARC_TARGET_WORDS) {
    return `You are tasked with ultra-compressing a sequence of old narrative synopses.
Output around ${targetWords} words.
Extract and retain ONLY the most critical historical plot points, massive world changes, and key character introductions.
Strip out all minor dialogue, pacing, and emotional flavor. Condense this down to an ultra-dense bulleted or short-paragraph summary.
Do not include any pleasantries, comments, or XML tags in your response. Do not talk. Just output the compressed data.

Content to compress:
${combinedText}`;
}

function getArcCompressionAdapters(options = {}) {
    const injected = options.arcCompression || {};
    return {
        get: injected.get || options.getArcCompression || chaptermanagement.getArcCompression,
        save: injected.save || options.saveArcCompression || chaptermanagement.saveArcCompression,
        call: injected.callLLM || options.callLLM || callLLM
    };
}

async function compressArcBucket(bucket, options = {}) {
    const combinedText = buildArcCombinedText(bucket);
    if (!combinedText) return null;

    const config = {
        targetWords: DEFAULT_ARC_TARGET_WORDS,
        model: 'lowendmodel',
        provider: resolveModelAlias('lowendmodel').provider,
        retries: 1,
        timeout: 60000,
        minCharacters: 100,
        ...options.config
    };
    const primary = getArcCacheKey(combinedText, config.targetWords);
    const adapters = getArcCompressionAdapters(options);

    try {
        const cachedPrimary = await adapters.get(primary);
        if (cachedPrimary) {
            return {
                text: cachedPrimary,
                cacheHit: true,
                cacheKey: primary,
                combinedText
            };
        }

    } catch (error) {
        Logger.error('MemoryLOD', 'ArcCompression', 'Failed while checking arc compression cache.', error);
    }

    const inFlight = options.arcCompressionInFlight;
    if (inFlight instanceof Map && inFlight.has(primary)) {
        return inFlight.get(primary);
    }

    const compressionPromise = (async () => {
        const promptStr = createArcCompressionPrompt(combinedText, config.targetWords);
        const prepared = new Prompt({ id: 'core.memory.arc_compression' })
            .user(message => message.add('core.memory.arc_compression', promptStr))
            .prepare();
        const { content: llmResult } = await runWithDiagnosticContext({
            executionLane: 'core',
            phase: 'Memory LOD',
            component: 'MemoryLOD',
            taskKey: 'arcCompression',
            blocking: options.blocking !== false
        }, async () => {
            const title = 'MemoryLOD Arc Compression';
            try {
                const result = await adapters.call({
                    prompt: prepared,
                    model: config.model,
                    provider: config.provider,
                    retries: config.retries,
                    timeout: config.timeout,
                    minCharacters: config.minCharacters,
                    extra: { reasoning: { effort: 'none' } },
                    callingModule: 'ArcCompression',
                    turnLogTitle: title
                });
                return result;
            } catch (error) {
                throw error;
            }
        });

        if (llmResult) {
            await adapters.save(primary, llmResult);
            return {
                text: llmResult,
                cacheHit: false,
                cacheKey: primary,
                combinedText
            };
        }

        return null;
    })();

    if (!(inFlight instanceof Map)) return compressionPromise;

    inFlight.set(primary, compressionPromise);
    try {
        return await compressionPromise;
    } finally {
        if (inFlight.get(primary) === compressionPromise) inFlight.delete(primary);
    }
}

function buildArcTailChunks(tailItems, config) {
    const chunks = [];
    let current = [];
    let currentChars = 0;
    let previousTurnNum = null;
    let currentTileIndex = null;

    const flush = () => {
        if (current.length > 0) {
            chunks.push(current);
            current = [];
            currentChars = 0;
            previousTurnNum = null;
            currentTileIndex = null;
        }
    };

    for (const item of tailItems) {
        const turnNum = Number(item?.tc?.turnNumber);
        const content = getChapterTextForArc(item);
        if (isNaN(turnNum) || !content) continue;

        const entryChars = content.length + 32;
        const tileIndex = Math.floor((turnNum - 1) / config.tileChapters);
        const breaksContinuity = previousTurnNum !== null && turnNum !== previousTurnNum + 1;
        const crossesTileBoundary = currentTileIndex !== null && tileIndex !== currentTileIndex;
        const exceedsCharLimit = current.length > 0 && currentChars + entryChars > config.maxInputChars;

        if (breaksContinuity || crossesTileBoundary || exceedsCharLimit) {
            flush();
        }

        current.push(item);
        currentChars += entryChars;
        previousTurnNum = turnNum;
        currentTileIndex = tileIndex;
    }

    flush();
    return chunks;
}

function appendArcRun(processedItems, run, config) {
    if (run.length === 0) return;

    const grace = Math.max(1, config.rolloverGraceChapters);
    const readyCount = run.length - (run.length % grace);
    const readyItems = run.slice(0, readyCount);
    const openItems = run.slice(readyCount);

    for (const tile of buildArcTailChunks(readyItems, config)) {
        if (tile.length >= config.minChapters) {
            processedItems.push({ type: 'arc', bucket: tile });
        } else {
            tile.forEach(item => processedItems.push({ type: 'single', item }));
        }
    }

    openItems.forEach(item => processedItems.push({ type: 'single', item }));
}

async function buildCompressedHistoryArcTail(orderedItems, selections, turnContext, formatters, settings, options, presetName) {
    const config = getCompressedHistoryArcTailConfig(settings);
    if (!config.enabled || orderedItems.length === 0) return [];

    const selectedTurns = selections
        .map(selection => Number(selection?.item?.tc?.turnNumber))
        .filter(turnNum => !isNaN(turnNum));
    const oldestSelected = selectedTurns.length > 0 ? Math.min(...selectedTurns) : Infinity;
    const tailItems = orderedItems.filter(item => Number(item.tc.turnNumber) < oldestSelected);
    if (tailItems.length === 0) return [];

    const chunks = buildArcTailChunks(tailItems, config);
    if (chunks.length === 0) return [];

    Logger.log('MemoryLOD', 'CompressedHistory', `Preset "${presetName}" adding ${tailItems.length} out-of-scope chapter(s) as ${chunks.length} arc tail chunk(s).`);

    const resolveChunk = async (chunk) => {
        const chunkParts = [];
        const startChapter = chunk[0].tc.turnNumber;
        const endChapter = chunk[chunk.length - 1].tc.turnNumber;

        if (chunk.length < config.minChapters) {
            for (const item of chunk) {
                const formatted = await formatChapterForCompressedHistory({ item, tier: 'synopsis' }, turnContext, formatters);
                if (formatted) chunkParts.push(formatted);
            }
            return chunkParts;
        }

        try {
            const result = await compressArcBucket(chunk, {
                ...options,
                config
            });
            if (result?.text) {
                Logger.log(
                    'MemoryLOD',
                    'ArcCompression',
                    `CompressedHistory.${presetName} arc ${startChapter}-${endChapter} ${result.cacheHit ? 'reused cache' : 'compressed'} (${result.combinedText.length} characters -> ${result.text.length} characters).`
                );
                const compressed = formatters.applyGlobalReplacements(result.text, turnContext);
                chunkParts.push(`Chapter ${startChapter} to ${endChapter}:\n${compressed}`);
                return chunkParts;
            }
        } catch (error) {
            Logger.error('MemoryLOD', 'ArcCompression', `CompressedHistory.${presetName} arc ${startChapter}-${endChapter} failed. Falling back to individual synopses.`, error);
        }

        for (const item of chunk) {
            const formatted = await formatChapterForCompressedHistory({ item, tier: 'synopsis' }, turnContext, formatters);
            if (formatted) chunkParts.push(formatted);
        }
        return chunkParts;
    };

    const chunkParts = await Promise.all(chunks.map(resolveChunk));
    return chunkParts.flat();
}

async function formatChapterForCompressedHistory(selection, turnContext, formatters) {
    const histTurn = selection?.item?.tc;
    const tier = selection?.tier;
    if (!histTurn || !tier) return '';

    const turnNum = Number(histTurn.turnNumber);
    const routing = turnContext.runtime?.timelineRouting || { pre: {}, post: {} };
    const { pre, post } = getTimelineRoutingForTurn(routing, turnNum);

    if (tier === 'full') {
        if (histTurn?.isSkeleton && typeof histTurn.ensureFull === 'function') {
            await histTurn.ensureFull();
        }
        const userPrompt = formatters.applyGlobalReplacements(histTurn.input?.userPrompt || '', turnContext);
        const narrativeRaw = formatters.applyGlobalReplacements(
            histTurn.processed?.dialogueProcessor?.dialogue ||
            histTurn.output?.fulltext ||
            histTurn.output?.summary ||
            histTurn.output?.synopsis ||
            '',
            turnContext
        );
        const narrative = appendInterludeCapsulesIfMissing(narrativeRaw, histTurn);
        if (!userPrompt && !narrative) return '';
        return `Chapter ${turnNum}:\n${pre}[USER]: ${userPrompt}\n[NARRATIVE]: ${narrative}${post}`;
    }

    if (tier === 'summary') {
        const summaryRaw = formatters.applyGlobalReplacements(
            histTurn.output?.summary || histTurn.output?.synopsis || histTurn.output?.fulltext || '',
            turnContext
        );
        const summary = appendInterludeCapsulesIfMissing(summaryRaw, histTurn);
        if (!summary) return '';
        return `Chapter ${turnNum}:\n${pre}${summary}${post}`;
    }

    let synopsisText = histTurn.output?.synopsis || histTurn.output?.summary || histTurn.output?.fulltext || '';
    if (turnContext.processed?.slottedRAG && turnContext.processed.slottedRAG[turnNum]) {
        synopsisText += '\n' + formatters.wrap('relevant_memories', turnContext.processed.slottedRAG[turnNum]);
    }
    const synopsisRaw = formatters.applyGlobalReplacements(synopsisText, turnContext);
    const synopsis = appendInterludeCapsulesIfMissing(synopsisRaw, histTurn);
    if (!synopsis) return '';
    return `Chapter ${turnNum}:\n${pre}${synopsis}${post}`;
}

async function buildCompressedHistoryViews(allChapters, turnContext, formatters, options = {}) {
    const settings = options.settings || readSettings();
    const presets = getCompressedHistoryPresets(settings);
    const arcConfig = getCompressedHistoryArcTailConfig(settings);
    const rolloverGraceChapters = arcConfig.enabled ? arcConfig.rolloverGraceChapters : 0;
    const orderedItems = orderChapterItems(allChapters);
    const compressedHistory = {};

    const presetEntries = Object.entries(presets).map(([name, preset]) => ({
        name,
        selections: selectCompressedHistoryItems(orderedItems, preset, rolloverGraceChapters)
    }));
    const arcCompressionInFlight = options.arcCompressionInFlight instanceof Map
        ? options.arcCompressionInFlight
        : new Map();
    const arcOptions = { ...options, arcCompressionInFlight };
    const arcTailParts = await Promise.all(presetEntries.map(({ name, selections }) =>
        buildCompressedHistoryArcTail(orderedItems, selections, turnContext, formatters, settings, arcOptions, name)
    ));

    for (let index = 0; index < presetEntries.length; index++) {
        const { name, selections } = presetEntries[index];
        const parts = arcTailParts[index];

        for (const selection of selections) {
            const formatted = await formatChapterForCompressedHistory(selection, turnContext, formatters);
            if (formatted) parts.push(formatted);
        }

        compressedHistory[name] = parts.length > 0 ? parts.join('\n\n') : 'No story yet.';
    }

    return compressedHistory;
}

/**
 * Ensures that all past chapters in the SQLite database have been processed into the LanceDB vector store.
 * If the vector DB was wiped or is missing chapters, this will sequentially rebuild them.
 */
async function ensureAllChaptersIngested(projectName) {
    try {
        const chaptermanagement = require('../../chaptermanagement.js');
        const chapters = await chaptermanagement.getChapters(); // Returns skeletons
        if (!chapters || chapters.length === 0) return;

        let missingCount = 0;
        for (const skeleton of chapters) {
            const turnNum = Number(skeleton.creationTurnNumber);
            if (isNaN(turnNum)) continue;

            // We need a stable hash to check. Since we don't have the full text yet, 
            // we will fetch the full turn if it isn't processed, using a dummy hash first 
            // to see if the turn_number exists at all.
            const vectorStore = await memorymanagement.initVectorStore(projectName, 'chapters');
            const results = await vectorStore.similaritySearch("", 1, {
                turn_number: { $eq: turnNum }
            });

            if (results.length === 0) {
                missingCount++;
                if (missingCount === 1) {
                    Logger.log('MemoryLOD', 'RAG', `Detected missing chapters in Vector DB. Starting auto-rebuild process...`, 'start');
                }

                await skeleton.ensureFull(); // Inflate the skeleton to get full text
                const content = skeleton.processed?.dialogueProcessor?.dialogue || skeleton.output?.fulltext || skeleton.output?.summary || "";

                const overviewText = skeleton.output?.synopsis || skeleton.output?.summary || skeleton.output?.title || "";

                if (content.trim()) {
                    Logger.log('MemoryLOD', 'RAG', `Rebuilding vectors for chapter: (Turn ${turnNum})`);
                    await memorymanagement.updateChapter(content, turnNum, { overview: overviewText, turn_number: turnNum }, projectName);
                }
            }
        }

        if (missingCount > 0) {
            Logger.log('MemoryLOD', 'RAG', `Successfully rebuilt vector embeddings for ${missingCount} missing chapters.`, 'end');
        }
    } catch (error) {
        Logger.error('MemoryLOD', 'RAG', 'Failed to run background vector DB sync:', error);
    }
}

/**
 * Ingests chapters into RAG, retrieves relevant memories, and groups them by chapter ID.
 * This runs ONCE before prompt construction.
 */
async function retrieveAndGroupMemories(autoChapters, searchString, projectName, searchStringHandler, contextEntities, turnContext) {
    const settings = readSettings();
    if (settings?.narrative_agents?.memory_retriever?.enabled === false) {
        Logger.log('MemoryLOD', 'RAG', 'Memory retriever is disabled. Skipping slotted RAG retrieval.');
        return;
    }

    const historySettings = settings?.infrastructure?.narrative_history || {};
    const autoSlotEnabled = historySettings.auto_slot_rag_old_chapters ?? true;

    if (autoChapters.length === 0 || !autoSlotEnabled) {
        if (!autoSlotEnabled && autoChapters.length > 0) Logger.log('MemoryLOD', 'RAG', 'Slotted RAG disabled by settings.');
        return;
    }

    Logger.log('MemoryLOD', 'RAG', `Pre-processing RAG for ${autoChapters.length} synopsis chapters ("chunks").`, 'start');

    // Step 0: Ensure all historical chapters exist in the vector store (Auto-rebuild)
    await ensureAllChaptersIngested(projectName);

    // Step 1: Collect auto chapter turn numbers for RAG scoping
    const autoTurnNumbers = [];
    for (const fileInfo of autoChapters) {
        const turnNumber = Number(fileInfo.metadata.turn_number);
        if (turnNumber !== undefined && !isNaN(turnNumber)) {
            autoTurnNumbers.push(turnNumber);
        }
    }

    const maxChunks = Math.max(0, readNumberSetting(historySettings.max_chunks_auto_slot_rag_old_chapters, 10));
    const randomChunkBudget = Math.max(0, readNumberSetting(historySettings.random_slot_rag_chunks, 0));

    if (searchStringHandler) {
        searchStringHandler(searchString);
        Logger.log('MemoryLOD', 'RAG', 'Search string sent to handler');
    }

    // Request more chunks if dynamic LOD is enabled so we have a good sample size to rank
    const lodSettings = historySettings.memory_lod || {};
    const dynamicLODEnabled = lodSettings.enabled ?? false;
    const shouldRunSmartSearch = dynamicLODEnabled || maxChunks > 0;
    const fetchLimit = dynamicLODEnabled ? 50 : maxChunks;

    let memoryResult = null;
    if (shouldRunSmartSearch) {
        // Step 2: Perform a single memory search across all ingested chapters
        Logger.log('MemoryLOD', 'RAG', `Currently searching within ${autoTurnNumbers.length} RAG chunks (synopsis chapters). Fetch limit: ${fetchLimit}`);
        memoryResult = await memorymanagement.memoryProcessor([searchString], {
            projectName,
            autoTurnNumbers,
            contextEntities,
            storeType: 'chapters',
            top_k: fetchLimit
        });
    } else {
        Logger.log('MemoryLOD', 'RAG', 'Smart slotted RAG search skipped because Max Slotted Chunks is 0 and Dynamic Elevation is disabled.');
    }

    // Step 3: Parse the retrieved memory chunks and populate the SLOTTED RAG registry
    // The registry uses stable turn numbers as keys.
    turnContext.processed.slottedRAG = {};

    const retrievedDocs = memoryResult?.memories?.fullText || [];
    if (shouldRunSmartSearch && !memoryResult?.context && randomChunkBudget <= 0) {
        Logger.log('MemoryLOD', 'RAG', 'No memory context returned from RAG.', 'end');
        return;
    } else if (shouldRunSmartSearch && !memoryResult?.context) {
        Logger.log('MemoryLOD', 'RAG', 'No smart memory context returned; continuing with random memory sprinkle.');
    }

    // --- NEW DYNAMIC LOD LOGIC ---
    if (dynamicLODEnabled && retrievedDocs.length > 0) {
        // 1. Group chunks by turn number and count hits
        const hitCounts = {};
        for (const doc of retrievedDocs) {
            const turnNum = Number(doc.turnNumber);
            if (!isNaN(turnNum)) {
                hitCounts[turnNum] = (hitCounts[turnNum] || 0) + 1;
            }
        }

        // 2. Rank turns by hit count descending
        const rankedTurns = Object.keys(hitCounts)
            .map(turnNum => ({ turnNum: Number(turnNum), hits: hitCounts[turnNum] }))
            .sort((a, b) => b.hits - a.hits); // Descending

        const targetFull = readNumberSetting(
            lodSettings.full_chapters ?? lodSettings.fullChapters,
            0
        );
        const targetSummary = readNumberSetting(
            lodSettings.summary_chapters ?? lodSettings.summaryChapters,
            0
        );

        if (!turnContext.processed.historyOverrides) {
            turnContext.processed.historyOverrides = {};
        }

        // --- ELEVATION OVERRIDES BYPASS ---
        const pluginOverrides = turnContext.processed.elevationOverrides || { fulltext: [], summaries: [] };
        const hasPluginOverrides = (pluginOverrides.fulltext && pluginOverrides.fulltext.length > 0) ||
            (pluginOverrides.summaries && pluginOverrides.summaries.length > 0);

        if (hasPluginOverrides) {
            // Bypass hit-counting and use the plugin's exact specifications
            Logger.log('MemoryLOD', 'Elevation', 'Plugin Elevation Overrides detected. Bypassing native hit-counting RAG logic.');

            if (pluginOverrides.fulltext) {
                for (const turnNum of pluginOverrides.fulltext) {
                    if (autoTurnNumbers.includes(Number(turnNum))) {
                        turnContext.processed.historyOverrides[Number(turnNum)] = 'full';
                    }
                }
            }
            if (pluginOverrides.summaries) {
                for (const turnNum of pluginOverrides.summaries) {
                    if (autoTurnNumbers.includes(Number(turnNum))) {
                        turnContext.processed.historyOverrides[Number(turnNum)] = 'summary';
                    }
                }
            }
        } else {
            // NATIVE PATH: Rank and Elevate based on hits
            let fullAssigned = 0;
            let summaryAssigned = 0;

            for (const { turnNum } of rankedTurns) {
                // Only elevate if it's currently a synopsis (it's in autoTurnNumbers)
                // and hasn't already been explicitly overridden by a plugin.
                if (autoTurnNumbers.includes(turnNum) && !turnContext.processed.historyOverrides[turnNum]) {
                    if (fullAssigned < targetFull) {
                        turnContext.processed.historyOverrides[turnNum] = 'full';
                        Logger.log('MemoryLOD', 'RAG', `Dynamically elevated Turn ${turnNum} to FULL text (${hitCounts[turnNum]} hits)`);
                        fullAssigned++;
                    } else if (summaryAssigned < targetSummary) {
                        turnContext.processed.historyOverrides[turnNum] = 'summary';
                        Logger.log('MemoryLOD', 'RAG', `Dynamically elevated Turn ${turnNum} to SUMMARY (${hitCounts[turnNum]} hits)`);
                        summaryAssigned++;
                    }
                }
            }
        } // End of NATIVE PATH else block

        const fullArr = [];
        const sumArr = [];
        for (const [turn, override] of Object.entries(turnContext.processed.historyOverrides)) {
            if (override === 'full') fullArr.push(turn);
            else if (override === 'summary') sumArr.push(turn);
        }

        if (fullArr.length > 0 || sumArr.length > 0) {
            Logger.log('MemoryLOD', 'Elevation', `Elevated chapters [${fullArr.join(',')}] to full text, elevated chapters [${sumArr.join(',')}] to summary.`);
        }
    }
    // --- END DYNAMIC LOD LOGIC ---

    // Filter out chunks that belong to elevated turns. They shouldn't get slotted RAG.
    const eligibleTurnNumbers = autoTurnNumbers.filter(turnNum =>
        !turnContext.processed.historyOverrides || !['full', 'summary'].includes(turnContext.processed.historyOverrides[turnNum])
    );
    const eligibleDocs = retrievedDocs.filter(doc => eligibleTurnNumbers.includes(getDocTurnNumber(doc)));

    // Apply the standard slotted RAG limit to the *remaining* eligible documents.
    const boundedDocs = eligibleDocs.slice(0, maxChunks);

    Logger.log('MemoryLOD', 'RAG', `Found ${eligibleDocs.length} eligible RAG chunks (limiting slotted injection to ${maxChunks}).`);

    const usedChunkKeys = new Set();
    let slottedCount = 0;
    for (const doc of boundedDocs) {
        const key = getChunkDedupeKey(doc);
        if (!key || usedChunkKeys.has(key)) continue;
        usedChunkKeys.add(key);

        const turnNum = getDocTurnNumber(doc);
        if (appendSlottedRagChunk(turnContext, turnNum, getDocContent(doc))) {
            slottedCount++;
        }
    }

    let randomSlottedCount = 0;
    if (randomChunkBudget > 0) {
        try {
            const randomDocs = await collectRandomSlottedRagDocs(projectName, eligibleTurnNumbers, randomChunkBudget, usedChunkKeys);
            for (const doc of randomDocs) {
                if (appendSlottedRagChunk(turnContext, getDocTurnNumber(doc), getDocContent(doc))) {
                    randomSlottedCount++;
                }
            }

            if (randomSlottedCount < randomChunkBudget) {
                Logger.log('MemoryLOD', 'RandomRAG', `Requested ${randomChunkBudget} random memory chunks, injected ${randomSlottedCount}; unique eligible pool was smaller than requested.`);
            } else {
                Logger.log('MemoryLOD', 'RandomRAG', `Injected ${randomSlottedCount} random memory sprinkle chunks.`);
            }
        } catch (error) {
            Logger.error('MemoryLOD', 'RandomRAG', 'Random memory sprinkle failed; continuing with smart slotted RAG only.', error);
        }
    }

    Logger.log('MemoryLOD', 'RAG', `Found ${eligibleDocs.length} relevant RAG chunks leftover after elevation, ${slottedCount} smart chunks and ${randomSlottedCount} random chunks injected into synopses.`, 'end');
}

/**
 * Assembles the historical turn data combining full text, summaries, and synopses with slotted RAG.
 */
async function buildHistoricalChapterMessages(chapterHistory, rootDirectory, prompt, searchStringHandler, mainCharacterName, contextEntities, turnContext, formatters) {
    const chatHistory = []; // Verbatim chat for Writer
    const summaryList = []; // Summaries/Synopses for Writer System Prompt
    const narrativeParts = []; // Full history string for Orchestrator

    const projectName = path.basename(rootDirectory);

    // Prepare data for RAG (only for synopsis chapters)
    const autoChaptersForRAG = chapterHistory.synopsischapters.map(tc => ({
        content: tc.output.synopsis,
        metadata: { turn_number: tc.turnNumber }
    }));

    if (autoChaptersForRAG.length > 0) {
        const lastFileContentForRAG = autoChaptersForRAG[autoChaptersForRAG.length - 1].content;
        const fullSearchStringForRAG = formatters.createSearchString(lastFileContentForRAG, prompt);
        try {
            await retrieveAndGroupMemories(autoChaptersForRAG, fullSearchStringForRAG, projectName, searchStringHandler, contextEntities, turnContext);
        } catch (error) {
            Logger.error('MemoryLOD', 'RAG', 'Failed during chronological chat history RAG pre-processing:', error);
        }
    }

    // --- UNIFY TIMELINES ---
    // Merge all known arrays into a single list so we can iterate in strict chronological order.
    // We attach a `nativeTier` to remember where it came from.
    const allChapters = [
        ...chapterHistory.synopsischapters.map(tc => ({ tc, nativeTier: 'synopsis' })),
        ...chapterHistory.summarychapters.map(tc => ({ tc, nativeTier: 'summary' })),
        ...chapterHistory.fullchapters.map(tc => ({ tc, nativeTier: 'full' }))
    ];

    // Sort heavily to guarantee timeline integers are flawless
    allChapters.sort((a, b) => a.tc.turnNumber - b.tc.turnNumber);

    // Apply the Dynamic LOD overrides to determine the `effectiveTier` for each element.
    const overrides = turnContext.processed.historyOverrides || {};
    allChapters.forEach(item => {
        item.effectiveTier = overrides[item.tc.turnNumber] || item.nativeTier;
        item.isElevatedFull = (item.effectiveTier === 'full' && item.nativeTier !== 'full');
    });
    // --- END UNIFY TIMELINES ---

    // --- ARC COMPRESSION PREPARATION ---
    const settings = readSettings();
    const lodSettings = getMemoryLODSettings(settings);
    const arcConfig = getCompressedHistoryArcTailConfig(settings);
    const arcCompressionInFlight = new Map();
    const compressedHistoryPromise = buildCompressedHistoryViews(allChapters, turnContext, formatters, {
        settings,
        arcCompressionInFlight
    });
    const arcEnabled = lodSettings.enable_arc_compression ?? lodSettings.enableArcCompression ?? false;
    const arcThreshold = readNumberSetting(
        lodSettings.arc_compress_old_chapter_min_threshold ?? lodSettings.arcCompressOldChapterMinThreshold,
        3
    );
    const arcOldLimit = readNumberSetting(
        lodSettings.arc_compress_older_chapters_than ?? lodSettings.arcCompressOlderChaptersThan,
        10
    );
    const mainArcConfig = {
        ...arcConfig,
        minChapters: Math.max(1, Math.floor(arcThreshold))
    };

    // Determine the current turn (using the topmost turn in the full/summary array, or essentially the last input turn)
    let currentTurnNum = turnContext.turnNumber;

    const processedItems = []; // Array of either Single Turns or Arc Buckets

    if (arcEnabled) {
        let currentBucket = [];
        const flushCurrentBucket = () => {
            appendArcRun(processedItems, currentBucket, mainArcConfig);
            currentBucket = [];
        };

        for (let i = 0; i < allChapters.length; i++) {
            const item = allChapters[i];
            const histTurn = item.tc;
            const age = currentTurnNum - histTurn.turnNumber;
            const hasSlottedRAG = turnContext.processed.slottedRAG && turnContext.processed.slottedRAG[histTurn.turnNumber];

            // Arc Compression only applies to effective synopses
            if (item.effectiveTier === 'synopsis' && age > arcOldLimit && !hasSlottedRAG) {
                // Check if contiguous with the existing bucket
                if (currentBucket.length === 0 || currentBucket[currentBucket.length - 1].tc.turnNumber === histTurn.turnNumber - 1) {
                    currentBucket.push(item);
                } else {
                    flushCurrentBucket();
                    currentBucket = [item];
                }
            } else {
                flushCurrentBucket();
                processedItems.push({ type: 'single', item: item });
            }
        }

        flushCurrentBucket();

    } else {
        // If disabled, everything is a single item
        allChapters.forEach(t => processedItems.push({ type: 'single', item: t }));
    }

    // --- DIGESTIBLE LOD PLAN LOGGING ---
    const planLines = [];
    let currentBlock = null;

    processedItems.forEach(node => {
        if (node.type === 'arc') {
            if (currentBlock) {
                const label = currentBlock.start === currentBlock.end ? `[${currentBlock.start}]` : `[${currentBlock.start} to ${currentBlock.end}]`;
                planLines.push(`${label} - ${currentBlock.tier}`);
                currentBlock = null;
            }
            const start = node.bucket[0].tc.turnNumber;
            const end = node.bucket[node.bucket.length - 1].tc.turnNumber;
            planLines.push(`[${start} to ${end}] - compressed into one arc`);
        } else if (node.type === 'single') {
            const turnNum = node.item.tc.turnNumber;
            let tier = node.item.effectiveTier;
            if (node.item.isElevatedFull) tier += ' (Elevated)';

            const hasSlots = turnContext.processed.slottedRAG && turnContext.processed.slottedRAG[turnNum];
            if (hasSlots) {
                if (currentBlock) {
                    const label = currentBlock.start === currentBlock.end ? `[${currentBlock.start}]` : `[${currentBlock.start} to ${currentBlock.end}]`;
                    planLines.push(`${label} - ${currentBlock.tier}`);
                    currentBlock = null;
                }
                const slotCount = turnContext.processed.slottedRAG[turnNum].split('\n\n').length;
                planLines.push(`[${turnNum}] - has ${slotCount} slotted memories`);
            } else {
                if (!currentBlock) {
                    currentBlock = { start: turnNum, end: turnNum, tier: tier };
                } else if (currentBlock.tier === tier && currentBlock.end === turnNum - 1) {
                    currentBlock.end = turnNum;
                } else {
                    const label = currentBlock.start === currentBlock.end ? `[${currentBlock.start}]` : `[${currentBlock.start} to ${currentBlock.end}]`;
                    planLines.push(`${label} - ${currentBlock.tier}`);
                    currentBlock = { start: turnNum, end: turnNum, tier: tier };
                }
            }
        }
    });

    if (currentBlock) {
        const label = currentBlock.start === currentBlock.end ? `[${currentBlock.start}]` : `[${currentBlock.start} to ${currentBlock.end}]`;
        planLines.push(`${label} - ${currentBlock.tier}`);
    }

    Logger.log('MemoryLOD', 'Plan', `Memory LOD Assembly Plan:\n  ${planLines.join('\n  ')}`);
    // --- END DIGESTIBLE LOGGING ---

    // --- ITEM RESOLUTION & FORMATTING EXECUTION ---
    // At this point we have chunks of work. We map them to an array of Promises so LLM calls run concurrently.
    const routing = turnContext.runtime?.timelineRouting || { pre: {}, post: {} };

    const resolutionPromises = processedItems.map(async (processNode) => {
        if (processNode.type === 'single') {
            const histTurn = processNode.item.tc;
            const turnNum = histTurn.turnNumber;
            const effectiveTier = processNode.item.effectiveTier;
            const isElevatedFull = processNode.item.isElevatedFull;

            const rawPre = routing.pre[turnNum];
            const rawPost = routing.post[turnNum];
            const pre = rawPre ? (rawPre.startsWith('[') ? `${rawPre}\n` : `[${rawPre}]\n`) : '';
            const post = rawPost ? (rawPost.endsWith(']') ? `\n${rawPost}` : `\n[${rawPost}]`) : '';

            // NATIVE FULL CHAT
            if (effectiveTier === 'full' && !isElevatedFull) {
                await histTurn.ensureFull();
                const userPrompt = formatters.applyGlobalReplacements(histTurn.input.userPrompt || "", turnContext);
                const narrativeRaw = formatters.applyGlobalReplacements(histTurn.processed?.dialogueProcessor?.dialogue || "", turnContext);
                const narrative = appendInterludeCapsulesIfMissing(narrativeRaw, histTurn);
                const chatPair = [
                    { role: 'user', content: userPrompt },
                    { role: 'assistant', content: `Chapter ${turnNum}:\n${pre}${narrative}${post}` }
                ];
                const fullTextContent = `Chapter ${turnNum}:\n${pre}[USER]: ${userPrompt}\n[NARRATIVE]: ${narrative}${post}`;
                return { destination: 'chat', narrativeBlock: fullTextContent, chatPair };
            }

            // ELEVATED FULL CHAT (Sent as summary block)
            if (effectiveTier === 'full' && isElevatedFull) {
                await histTurn.ensureFull();
                const userPrompt = formatters.applyGlobalReplacements(histTurn.input.userPrompt || "", turnContext);
                const narrativeRaw = formatters.applyGlobalReplacements(histTurn.processed?.dialogueProcessor?.dialogue || "", turnContext);
                const narrative = appendInterludeCapsulesIfMissing(narrativeRaw, histTurn);
                // Return exactly as a standard array insertion, avoiding the chatHistory list
                const formattedElevatedText = `Chapter ${turnNum}:\n${pre}[USER]: ${userPrompt}\n[NARRATIVE]: ${narrative}${post}`;
                return { destination: 'summary', content: formattedElevatedText };
            }

            // SUMMARY
            if (effectiveTier === 'summary') {
                const summaryRaw = formatters.applyGlobalReplacements(histTurn.output.summary, turnContext);
                const innerContent = appendInterludeCapsulesIfMissing(summaryRaw, histTurn);
                const content = `Chapter ${turnNum}:\n${pre}${innerContent}${post}`;
                return { destination: 'summary', content };
            }

            // SYNOPSIS
            if (effectiveTier === 'synopsis') {
                let innerContent = histTurn.output.synopsis;
                if (turnContext.processed.slottedRAG && turnContext.processed.slottedRAG[turnNum]) {
                    innerContent += '\n' + formatters.wrap('relevant_memories', turnContext.processed.slottedRAG[turnNum]);
                }
                const synopsisRaw = formatters.applyGlobalReplacements(innerContent, turnContext);
                const synopsisWithCapsules = appendInterludeCapsulesIfMissing(synopsisRaw, histTurn);
                const formattedSynopsis = `Chapter ${turnNum}:\n${pre}${synopsisWithCapsules}${post}`;
                return { destination: 'summary', content: formattedSynopsis };
            }
        }
        else if (processNode.type === 'arc') {
            const startChapter = processNode.bucket[0].tc.turnNumber;
            const endChapter = processNode.bucket[processNode.bucket.length - 1].tc.turnNumber;

            const rawPreArc = routing.pre[startChapter];
            const rawPostArc = routing.post[endChapter];
            const preArc = rawPreArc ? (rawPreArc.startsWith('[') ? `${rawPreArc}\n` : `[${rawPreArc}]\n`) : '';
            const postArc = rawPostArc ? (rawPostArc.endsWith(']') ? `\n${rawPostArc}` : `\n[${rawPostArc}]`) : '';

            try {
                const result = await compressArcBucket(processNode.bucket, {
                    arcCompressionInFlight,
                    config: {
                        targetWords: arcConfig.targetWords,
                        model: arcConfig.model,
                        provider: arcConfig.provider,
                        retries: arcConfig.retries,
                        timeout: arcConfig.timeout,
                        minCharacters: arcConfig.minCharacters
                    }
                });

                if (result?.text) {
                    Logger.log('MemoryLOD', 'ArcCompression', `Chapters ${startChapter} to ${endChapter} got arc compressed${result.cacheHit ? ' (Cache Hit)' : ''}. ${result.combinedText.length} characters -> ${result.text.length} characters`);
                    return {
                        destination: 'summary',
                        content: `Chapter ${startChapter} to ${endChapter}:\n${preArc}${formatters.applyGlobalReplacements(result.text, turnContext)}${postArc}`
                    };
                }
            } catch (err) {
                Logger.error('MemoryLOD', 'ArcCompression', `Compression failed for ${startChapter}-${endChapter}. Falling back to standard synopses.`, err);
            }

            // Fallback: If LLM fails, just return everything individually
            const fallbackStr = processNode.bucket.map(b => {
                const num = b.tc.turnNumber;
                const innerRawPre = routing.pre[num];
                const innerRawPost = routing.post[num];
                const innerPre = innerRawPre ? (innerRawPre.startsWith('[') ? `${innerRawPre}\n` : `[${innerRawPre}]\n`) : '';
                const innerPost = innerRawPost ? (innerRawPost.endsWith(']') ? `\n${innerRawPost}` : `\n[${innerRawPost}]`) : '';

                const content = b.tc.output.synopsis;
                return `Chapter ${num}:\n${innerPre}${formatters.applyGlobalReplacements(content, turnContext)}${innerPost}`;
            }).join('\n\n');
            return { destination: 'summary', content: fallbackStr };
        }
    });

    // Both history representations are independent, so their arc batches can run together.
    // Promise.all preserves the chronological and preset ordering assembled above.
    const [resolvedNodes, compressedHistory] = await Promise.all([
        Promise.all(resolutionPromises),
        compressedHistoryPromise
    ]);

    // Fold the structured resolutions into the true arrays
    resolvedNodes.forEach(node => {
        if (!node) return;

        if (node.destination === 'summary') {
            // Summary destination: Add to system prompt text blob and narrative history.
            const splitBlocks = node.content.split('\n\n'); // Arc compression safety fallback
            splitBlocks.forEach(part => {
                if (part) {
                    summaryList.push(part);
                    narrativeParts.push(part);
                }
            });
        }
        else if (node.destination === 'chat') {
            // Native Full Text: Send to chat simulation Array
            chatHistory.push(node.chatPair[0]);
            chatHistory.push(node.chatPair[1]);
            narrativeParts.push(node.narrativeBlock);
        }
    });

    const narrativeHistory = narrativeParts.length > 0 ? narrativeParts.join('\n\n') : "No story yet.";

    return {
        narrativeHistory,
        chatHistory,
        summaryHistory: summaryList.join('\n\n'),
        compressedHistory
    };
}

module.exports = {
    buildHistoricalChapterMessages,
    buildCompressedHistoryViews,
    createEmptyCompressedHistory
};

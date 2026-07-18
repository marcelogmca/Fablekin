// timeline.js - Timeline Data Aggregator
// Emits cheap turn skeletons first, then lazily hydrates plugin data by visible range.

const { Logger } = require('../utils.js');

// #region STATE
let chapterManager = null;
let pluginManager = null;
let io = null;
let refreshInFlight = null;
let activeCacheDbKey = null;
const HYDRATION_ROW_CONCURRENCY = 2;
const HYDRATION_PROVIDER_CONCURRENCY = 3;
const DIAG_SLOW_PROVIDER_MS = 75;
const DIAG_SLOW_CACHE_WAIT_MS = 50;
const DIAG_SLOW_ROW_MS = 250;

// Registered providers from plugins.
// Each entry: { pluginId, type: 'card'|'branch', side: 'left'|'right', fn }
const providers = [];

// Per-process, per-chat-db provider result cache.
const providerResultCache = new Map();
// #endregion

// #region INITIALIZATION

function init(_chapterManager, _pluginManager, _io) {
    chapterManager = _chapterManager;
    pluginManager = _pluginManager;
    io = _io;
    Logger.log('Timeline', 'Initialized.');
}

// #endregion

// #region PROVIDER REGISTRATION

function registerProvider(pluginId, providerDef) {
    if (!providerDef || typeof providerDef.fn !== 'function') {
        Logger.warn('Timeline', `Plugin '${pluginId}' attempted to register an invalid timeline provider.`);
        return;
    }

    const entry = {
        pluginId,
        type: providerDef.type || 'branch',
        side: providerDef.side || 'left',
        fn: providerDef.fn
    };

    providers.push(entry);
    Logger.log('Timeline', `Registered ${entry.type} provider on ${entry.side} side from plugin '${pluginId}'.`);
}

// #endregion

// #region DATA COLLECTION & REFRESH

function getProviderKey(provider) {
    return `${provider.pluginId}:${provider.type}/${provider.side}`;
}

function getDbKeyFromSkeletons(skeletons) {
    const first = Array.isArray(skeletons) ? skeletons[0] : null;
    return first?.chatDbFullPath || first?.projectName || 'unknown';
}

function ensureCacheForDb(dbKey) {
    if (!dbKey || activeCacheDbKey === dbKey) return;
    providerResultCache.clear();
    activeCacheDbKey = dbKey;
    Logger.log('Timeline', 'Cache', `Timeline provider cache initialized for ${dbKey}.`);
}

function getProviderCacheKey(dbKey, turnContext, provider) {
    const turnKey = turnContext?.dbId || turnContext?.turnNumber || 'unknown-turn';
    return `${dbKey}:${turnKey}:${getProviderKey(provider)}`;
}

function recordProviderTiming(timings, provider, elapsedMs) {
    const key = getProviderKey(provider);
    if (!timings.has(key)) {
        timings.set(key, {
            pluginId: provider.pluginId,
            type: provider.type,
            side: provider.side,
            calls: 0,
            totalMs: 0,
            maxMs: 0
        });
    }

    const stat = timings.get(key);
    stat.calls += 1;
    stat.totalMs += elapsedMs;
    stat.maxMs = Math.max(stat.maxMs, elapsedMs);
}

function logProviderTimingSummary(scope, timings, totalMs) {
    if (!timings || timings.size === 0) return;

    const summary = Array.from(timings.values())
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, 8)
        .map(stat => {
            const avgMs = stat.calls > 0 ? stat.totalMs / stat.calls : 0;
            return `${stat.pluginId} ${stat.type}/${stat.side}: total=${Math.round(stat.totalMs)}ms avg=${avgMs.toFixed(1)}ms max=${Math.round(stat.maxMs)}ms calls=${stat.calls}`;
        })
        .join(' | ');

    Logger.log('Timeline', scope, `Total ${Math.round(totalMs)}ms. Slowest providers: ${summary}`);
}

function summarizeProviderResult(provider, result) {
    if (!result) return 'null';
    if (provider.type === 'card') {
        const fields = Array.isArray(result.fields) ? result.fields.length : 0;
        const hasHtml = !!result.html;
        const hasMapBundle = !!result.mapBundle;
        return `card title="${result.title || ''}" fields=${fields} html=${hasHtml} mapBundle=${hasMapBundle}`;
    }

    const items = Array.isArray(result) ? result : [result];
    const childCount = items.reduce((count, item) => count + (Array.isArray(item?.children) ? item.children.length : 0), 0);
    return `branch items=${items.length} children=${childCount}`;
}

function logHydrationDiagnostics(diagnostics, totalMs) {
    if (!diagnostics) return;

    const slowRows = diagnostics.rowTimings
        .filter(row => row.elapsedMs >= DIAG_SLOW_ROW_MS)
        .sort((a, b) => b.elapsedMs - a.elapsedMs)
        .slice(0, 10);

    if (slowRows.length > 0) {
        const rowSummary = slowRows
            .map(row => `turn=${row.turnNumber} index=${row.index} elapsed=${row.elapsedMs}ms cards=${row.leftCardCount}/${row.rightCardCount} branches=${row.leftBranchCount}/${row.rightBranchCount}`)
            .join(' | ');
        Logger.log('Timeline', 'RangeDiagnostics', `Slow hydrated rows: ${rowSummary}`);
    }

    const slowProviders = diagnostics.providerCalls
        .sort((a, b) => b.elapsedMs - a.elapsedMs)
        .slice(0, 12);

    if (slowProviders.length > 0) {
        const providerSummary = slowProviders
            .map(call => {
                const cacheLabel = call.cacheHit ? 'cache-wait' : 'miss';
                return `turn=${call.turnNumber} ${call.providerKey} ${cacheLabel} ${call.elapsedMs}ms ${call.summary || ''}`;
            })
            .join(' | ');
        Logger.log('Timeline', 'RangeDiagnostics', `Slow provider calls: ${providerSummary}`);
    }

    Logger.log(
        'Timeline',
        'RangeDiagnostics',
        `Hydration diagnostics request=${diagnostics.requestId || 'n/a'} rows=${diagnostics.rowTimings.length} slowRows=${slowRows.length} slowProviderCalls=${diagnostics.providerCalls.length} total=${totalMs}ms concurrency=row${HYDRATION_ROW_CONCURRENCY}/provider${HYDRATION_PROVIDER_CONCURRENCY}`
    );
}

async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));

    async function worker() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex++;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    }

    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
}

function buildSkeletonTurnData(tc, index = null) {
    return {
        index,
        turnNumber: tc.turnNumber,
        title: tc.output?.title || `Turn ${tc.turnNumber}`,
        abstractTitle: tc.output?.abstractTitle || '',
        synopsis: tc.output?.synopsis || tc.output?.summary || '',
        thumbnail: tc.thumbnail || null,
        leftCard: [],
        rightCard: [],
        leftBranches: [],
        rightBranches: [],
        hydrated: false
    };
}

function applyProviderResult(turnData, provider, result) {
    if (!result) return;

    if (provider.type === 'card') {
        if (provider.side === 'left') {
            turnData.leftCard.push(result);
        } else {
            turnData.rightCard.push(result);
        }
        return;
    }

    if (provider.type === 'branch') {
        const items = Array.isArray(result) ? result : [result];
        const target = provider.side === 'left' ? turnData.leftBranches : turnData.rightBranches;
        target.push(...items);
    }
}

async function getSkeletonsWithTiming(scope = 'RefreshTiming') {
    const metadataStartedAt = Date.now();
    const skeletons = await chapterManager.getChapterMetadata();
    Logger.log('Timeline', scope, `chapterManager.getChapterMetadata: ${Date.now() - metadataStartedAt}ms`);
    ensureCacheForDb(getDbKeyFromSkeletons(skeletons));
    return Array.isArray(skeletons) ? skeletons : [];
}

async function getProviderResult(dbKey, turnContext, provider, providerTimings, cacheStats, diagnostics = null) {
    const cacheKey = getProviderCacheKey(dbKey, turnContext, provider);
    const providerKey = getProviderKey(provider);

    if (providerResultCache.has(cacheKey)) {
        cacheStats.hits += 1;
        const cacheStartedAt = Date.now();
        const cached = await providerResultCache.get(cacheKey);
        const elapsedMs = Date.now() - cacheStartedAt;
        if (diagnostics && elapsedMs >= DIAG_SLOW_CACHE_WAIT_MS) {
            diagnostics.providerCalls.push({
                turnNumber: turnContext.turnNumber,
                providerKey,
                elapsedMs,
                cacheHit: true,
                summary: cached?.ok ? summarizeProviderResult(provider, cached.result) : cached?.error || 'error'
            });
        }
        return cached;
    }

    cacheStats.misses += 1;
    const resultPromise = (async () => {
        let providerStartedAt = null;
        try {
            const tools = pluginManager._buildTools(provider.pluginId, turnContext);
            providerStartedAt = Date.now();
            const result = await provider.fn(turnContext, tools);
            const elapsedMs = Date.now() - providerStartedAt;
            recordProviderTiming(providerTimings, provider, elapsedMs);
            if (diagnostics && elapsedMs >= DIAG_SLOW_PROVIDER_MS) {
                diagnostics.providerCalls.push({
                    turnNumber: turnContext.turnNumber,
                    providerKey,
                    elapsedMs,
                    cacheHit: false,
                    summary: summarizeProviderResult(provider, result)
                });
            }
            return { ok: true, result: result || null };
        } catch (err) {
            if (providerStartedAt !== null) {
                const elapsedMs = Date.now() - providerStartedAt;
                recordProviderTiming(providerTimings, provider, elapsedMs);
                if (diagnostics) {
                    diagnostics.providerCalls.push({
                        turnNumber: turnContext.turnNumber,
                        providerKey,
                        elapsedMs,
                        cacheHit: false,
                        summary: `error=${err.message}`
                    });
                }
            }
            Logger.error('Timeline', `Provider '${provider.pluginId}' (${provider.type}/${provider.side}) failed for turn ${turnContext.turnNumber}:`, err.message);
            return { ok: false, result: null, error: err.message };
        }
    })();

    providerResultCache.set(cacheKey, resultPromise);
    const resolved = await resultPromise;
    providerResultCache.set(cacheKey, resolved);
    return resolved;
}

async function hydrateTurnData(turnContext, index, dbKey, providerTimings, cacheStats, diagnostics = null) {
    const rowStartedAt = Date.now();
    const turnData = buildSkeletonTurnData(turnContext, index);
    turnData.hydrated = true;

    const providerResults = await mapWithConcurrency(providers, HYDRATION_PROVIDER_CONCURRENCY, async (provider) => ({
        provider,
        providerResult: await getProviderResult(dbKey, turnContext, provider, providerTimings, cacheStats, diagnostics)
    }));

    for (const { provider, providerResult } of providerResults) {
        if (providerResult?.ok) {
            applyProviderResult(turnData, provider, providerResult.result);
        }
    }

    if (diagnostics) {
        diagnostics.rowTimings.push({
            index,
            turnNumber: turnContext.turnNumber,
            elapsedMs: Date.now() - rowStartedAt,
            leftCardCount: turnData.leftCard.length,
            rightCardCount: turnData.rightCard.length,
            leftBranchCount: turnData.leftBranches.length,
            rightBranchCount: turnData.rightBranches.length
        });
    }

    return turnData;
}

async function performRefresh(options = {}) {
    if (!chapterManager || !io) {
        Logger.warn('Timeline', 'Cannot refresh: not initialized.');
        return;
    }

    const startedAt = Date.now();
    const reason = options?.reason ? ` (${options.reason})` : '';

    Logger.log('Timeline', 'Refresh', `Refreshing timeline skeletons${reason}...`, 'start');

    try {
        const skeletons = await getSkeletonsWithTiming('RefreshTiming');

        if (!skeletons || skeletons.length === 0) {
            Logger.log('Timeline', 'Refresh', 'No turns found. Emitting empty timeline.', 'end');
            io.emit('timeline-data', { turns: [] });
            return;
        }

        const turns = skeletons.map((tc, index) => buildSkeletonTurnData(tc, index));

        Logger.log('Timeline', 'Refresh', `Emitting timeline skeletons: ${turns.length} turns.`, 'end');
        Logger.log('Timeline', 'RefreshTiming', `Skeleton payload total ${Date.now() - startedAt}ms.`);
        io.emit('timeline-data', { turns });
    } catch (error) {
        Logger.error('Timeline', 'Refresh', 'Failed to refresh timeline skeletons:', error);
        io.emit('timeline-data', { turns: [], error: error.message });
    }
}

async function refresh(options = {}) {
    if (refreshInFlight) {
        Logger.log('Timeline', 'Refresh', `Refresh already in progress; joining existing refresh${options?.reason ? ` (${options.reason})` : ''}.`);
        return refreshInFlight;
    }

    refreshInFlight = performRefresh(options).finally(() => {
        refreshInFlight = null;
    });
    return refreshInFlight;
}

async function hydrateRange(socket, data = {}) {
    if (!chapterManager || !socket) {
        Logger.warn('Timeline', 'Cannot hydrate range: not initialized.');
        return;
    }

    const startedAt = Date.now();
    const requestId = data?.requestId || null;
    const rawStart = Number(data?.startIndex);
    const rawEnd = Number(data?.endIndex);
    const providerTimings = new Map();
    const cacheStats = { hits: 0, misses: 0 };
    const diagnostics = {
        requestId,
        rowTimings: [],
        providerCalls: []
    };

    try {
        const skeletons = await getSkeletonsWithTiming('RangeTiming');
        const totalTurns = skeletons.length;
        if (totalTurns === 0) {
            socket.emit('timeline-range-data', { requestId, startIndex: 0, endIndex: -1, totalTurns: 0, turns: [] });
            return;
        }

        const startIndex = Math.max(0, Math.min(totalTurns - 1, Number.isFinite(rawStart) ? Math.floor(rawStart) : 0));
        const endIndex = Math.max(startIndex, Math.min(totalTurns - 1, Number.isFinite(rawEnd) ? Math.floor(rawEnd) : startIndex));
        const dbKey = getDbKeyFromSkeletons(skeletons);
        ensureCacheForDb(dbKey);

        Logger.log('Timeline', 'RangeHydration', `Hydrating timeline rows ${startIndex}-${endIndex} (${endIndex - startIndex + 1} turns).`, 'start');

        const rangeItems = [];
        for (let index = startIndex; index <= endIndex; index++) {
            rangeItems.push({ turnContext: skeletons[index], index });
        }
        const turns = await mapWithConcurrency(rangeItems, HYDRATION_ROW_CONCURRENCY, ({ turnContext, index }) => {
            return hydrateTurnData(turnContext, index, dbKey, providerTimings, cacheStats, diagnostics);
        });

        Logger.log('Timeline', 'RangeHydration', `Emitting hydrated timeline rows ${startIndex}-${endIndex}.`, 'end');
        const totalMs = Date.now() - startedAt;
        Logger.log('Timeline', 'RangeHydration', `Cache hits=${cacheStats.hits}, misses=${cacheStats.misses}, total=${totalMs}ms.`);
        logProviderTimingSummary('RangeTiming', providerTimings, totalMs);
        logHydrationDiagnostics(diagnostics, totalMs);

        socket.emit('timeline-range-data', {
            requestId,
            startIndex,
            endIndex,
            totalTurns,
            turns,
            diagnostics: {
                backendTotalMs: totalMs,
                rowCount: turns.length,
                cacheHits: cacheStats.hits,
                cacheMisses: cacheStats.misses,
                slowProviderCount: diagnostics.providerCalls.length,
                slowRowCount: diagnostics.rowTimings.filter(row => row.elapsedMs >= DIAG_SLOW_ROW_MS).length
            }
        });
    } catch (error) {
        Logger.error('Timeline', 'RangeHydration', 'Failed to hydrate timeline range:', error);
        socket.emit('timeline-range-data', {
            requestId,
            startIndex: Number.isFinite(rawStart) ? Math.floor(rawStart) : 0,
            endIndex: Number.isFinite(rawEnd) ? Math.floor(rawEnd) : 0,
            turns: [],
            error: error.message
        });
    }
}

function reset() {
    Logger.log('Timeline', 'Reset. Emitting empty state.');
    providerResultCache.clear();
    activeCacheDbKey = null;
    if (io) {
        io.emit('timeline-data', { turns: [] });
    }
}

// #endregion

// #region EXPORTS
module.exports = {
    init,
    registerProvider,
    refresh,
    hydrateRange,
    reset
};
// #endregion

const { resolveTurnStorageKey, parseTurnStorageKey } = require('../../turn_storage_key.js');

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function normalizeSceneMode(turnContext) {
    return String(turnContext?.sceneMode || '').trim().toLowerCase() === 'interlude'
        ? 'interlude'
        : 'mainline';
}

function normalizeTurn(turnContext) {
    if (!turnContext || typeof turnContext !== 'object') return null;

    const sceneMode = normalizeSceneMode(turnContext);
    const runtimeInterlude = turnContext?.runtime?.interlude || {};
    const turnNumber = isPositiveInteger(turnContext?.turnNumber) ? turnContext.turnNumber : null;
    const creationTurnNumber = isPositiveInteger(turnContext?.creationTurnNumber)
        ? turnContext.creationTurnNumber
        : (sceneMode === 'interlude' ? turnNumber : null);
    const interludeOrdinal = isPositiveInteger(turnContext?.interludeOrdinal)
        ? turnContext.interludeOrdinal
        : (isPositiveInteger(runtimeInterlude?.ordinal) ? runtimeInterlude.ordinal : null);

    const output = turnContext.output || {};
    const input = turnContext.input || {};

    return {
        context: turnContext,
        dbId: isPositiveInteger(turnContext?.dbId) ? turnContext.dbId : null,
        turnNumber,
        creationTurnNumber,
        storageKey: resolveTurnStorageKey(turnContext),
        sceneMode,
        isInterlude: sceneMode === 'interlude',
        parentDbId: isPositiveInteger(turnContext?.parentTurnDbId) ? turnContext.parentTurnDbId : null,
        parentTurnNumber: sceneMode === 'interlude' ? creationTurnNumber : null,
        interludeId: isPositiveInteger(runtimeInterlude?.id) ? runtimeInterlude.id : null,
        interludeOrdinal,
        isSkeleton: !!turnContext?.isSkeleton,
        input,
        output,
        sequence: Array.isArray(output?.sequence) ? output.sequence : [],
        meta: {
            title: output?.title || '',
            abstractTitle: output?.abstractTitle || '',
            synopsis: output?.synopsis || '',
            summary: output?.summary || '',
            thumbnail: turnContext?.thumbnail || output?.thumbnail || null,
            dialogueCount: Number.isInteger(turnContext?.dialogueCount)
                ? turnContext.dialogueCount
                : (Array.isArray(output?.sequence) ? output.sequence.length : 0)
        }
    };
}

function buildTurnsTools({ pluginManager, context, pluginId }) {
    const getChapterManager = () => {
        if (!pluginManager?.chapterManager) {
            throw new Error(`tools.turns failed: Chat DB manager not available for plugin '${pluginId}'.`);
        }
        return pluginManager.chapterManager;
    };

    const getCurrent = () => normalizeTurn(context);

    const getByDbId = async (dbId) => {
        if (!isPositiveInteger(dbId)) {
            throw new Error('tools.turns.getByDbId expects a positive integer dbId.');
        }
        const chapterManager = getChapterManager();
        const turnContext = await chapterManager.getTurnContextByDbId(dbId);
        return normalizeTurn(turnContext);
    };

    const get = async (n) => {
        if (!isPositiveInteger(n)) {
            throw new Error('tools.turns.get expects a positive integer turn number.');
        }
        const chapterManager = getChapterManager();
        const turnContext = await chapterManager.getTurnContext(n);
        return normalizeTurn(turnContext);
    };

    const getByCreationTurnNumber = async (n) => {
        if (!isPositiveInteger(n)) {
            throw new Error('tools.turns.getByCreationTurnNumber expects a positive integer.');
        }
        const chapterManager = getChapterManager();
        if (typeof chapterManager.getTurnContextByCreationTurnNumber === 'function') {
            const turnContext = await chapterManager.getTurnContextByCreationTurnNumber(n);
            return normalizeTurn(turnContext);
        }
        return get(n);
    };

    const getByStorageKey = async (key) => {
        const parsed = parseTurnStorageKey(key);
        if (!parsed) return null;

        const chapterManager = getChapterManager();
        if (typeof chapterManager.getTurnContextByStorageKey === 'function') {
            const turnContext = await chapterManager.getTurnContextByStorageKey(parsed.key);
            return normalizeTurn(turnContext);
        }

        if (parsed.ordinal) return null;
        return getByCreationTurnNumber(parsed.baseTurn);
    };

    const resolve = async (turnRef = null) => {
        if (!turnRef) return getCurrent();

        if (typeof turnRef === 'number') return get(turnRef);

        if (typeof turnRef === 'string') return getByStorageKey(turnRef);

        if (turnRef?.context && typeof turnRef.context === 'object') {
            return normalizeTurn(turnRef.context);
        }

        if (turnRef?.output && turnRef?.input) {
            return normalizeTurn(turnRef);
        }

        if (isPositiveInteger(turnRef?.dbId)) return getByDbId(turnRef.dbId);

        if (typeof turnRef?.storageKey === 'string') return getByStorageKey(turnRef.storageKey);

        if (isPositiveInteger(turnRef?.turnNumber)) return get(turnRef.turnNumber);

        if (isPositiveInteger(turnRef?.creationTurnNumber)) return getByCreationTurnNumber(turnRef.creationTurnNumber);

        return null;
    };

    const count = async () => {
        const chapterManager = getChapterManager();
        return await chapterManager.getChapterCount();
    };

    const getLatest = async (options = {}) => {
        const chapterManager = getChapterManager();
        let turnContext = null;

        if (typeof chapterManager.getLatestTurnContext === 'function') {
            turnContext = await chapterManager.getLatestTurnContext();
        } else {
            const total = await chapterManager.getChapterCount();
            if (isPositiveInteger(total)) {
                turnContext = await chapterManager.getTurnContext(total);
            }
        }

        if (turnContext) return normalizeTurn(turnContext);
        if (options?.fallbackToCurrent === false) return null;
        return getCurrent();
    };

    const getRange = async (start, end) => {
        if (!isPositiveInteger(start) || !isPositiveInteger(end)) {
            throw new Error('tools.turns.getRange expects positive integer start and end.');
        }
        const chapterManager = getChapterManager();
        const turns = await chapterManager.getTurnRange(start, end);
        return (Array.isArray(turns) ? turns : []).map(normalizeTurn).filter(Boolean);
    };

    const getPrevious = async (amount = 1, options = {}) => {
        if (!isPositiveInteger(amount)) return [];

        const anchor = await resolve(options?.from || null);
        const anchorTurnNumber = anchor?.turnNumber;
        if (!isPositiveInteger(anchorTurnNumber)) return [];

        const end = options?.includeCurrent ? anchorTurnNumber : anchorTurnNumber - 1;
        if (!isPositiveInteger(end)) return [];
        const start = Math.max(1, end - amount + 1);
        const turns = await getRange(start, end);

        return options?.order === 'desc' ? turns.slice().reverse() : turns;
    };

    const getMeta = async (n) => {
        if (!isPositiveInteger(n)) {
            throw new Error('tools.turns.getMeta expects a positive integer turn number.');
        }
        const chapterManager = getChapterManager();
        const turnContext = await chapterManager.getTurnMetadata(n);
        return normalizeTurn(turnContext);
    };

    const getSequence = async (turnRef = null) => {
        const turn = turnRef ? await resolve(turnRef) : getCurrent();
        if (!turn) return [];
        return Array.isArray(turn.sequence) ? turn.sequence : [];
    };

    return {
        get,
        getCurrent,
        getLatest,
        getRange,
        getPrevious,
        getByStorageKey,
        getByDbId,
        getByCreationTurnNumber,
        getMeta,
        count,
        getSequence,
        resolve
    };
}

module.exports = { buildTurnsTools };

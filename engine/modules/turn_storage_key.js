function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function toCleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function resolveBaseTurnNumber(turnContext) {
    if (isPositiveInteger(turnContext?.creationTurnNumber)) return turnContext.creationTurnNumber;
    if (isPositiveInteger(turnContext?.turnNumber)) return turnContext.turnNumber;
    return 0;
}

function parseTurnStorageKey(value) {
    const text = toCleanString(value);
    const match = text.match(/^(\d+)(?:\.(\d+))?$/);
    if (!match) return null;
    const baseTurn = Number.parseInt(match[1], 10);
    const ordinal = match[2] ? Number.parseInt(match[2], 10) : null;
    if (!Number.isFinite(baseTurn) || baseTurn < 1) return null;
    if (ordinal !== null && (!Number.isFinite(ordinal) || ordinal < 1)) return null;
    return { baseTurn, ordinal, key: ordinal ? `${baseTurn}.${ordinal}` : String(baseTurn) };
}

function resolveTurnStorageKey(turnContext) {
    const explicitKey = toCleanString(turnContext?.runtime?.interlude?.storageTurnKey);
    const parsedExplicit = parseTurnStorageKey(explicitKey);
    if (parsedExplicit) return parsedExplicit.key;

    const baseTurn = resolveBaseTurnNumber(turnContext);
    if (!isPositiveInteger(baseTurn)) return '0';

    const isInterlude = String(turnContext?.sceneMode || '').trim().toLowerCase() === 'interlude';
    if (!isInterlude) return String(baseTurn);

    const ordinal = isPositiveInteger(turnContext?.interludeOrdinal)
        ? turnContext.interludeOrdinal
        : (isPositiveInteger(turnContext?.runtime?.interlude?.ordinal) ? turnContext.runtime.interlude.ordinal : null);

    if (ordinal) return `${baseTurn}.${ordinal}`;
    return String(baseTurn);
}

module.exports = {
    parseTurnStorageKey,
    resolveTurnStorageKey,
    resolveBaseTurnNumber
};

const KM_TO_MILES = 0.621371;

function normalizeDistanceUnit(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'miles' || normalized === 'mile' || normalized === 'mi'
        ? 'miles'
        : 'kilometres';
}

function getDistanceUnitDefinition(value) {
    const key = normalizeDistanceUnit(value);
    return key === 'miles'
        ? { key, label: 'miles', singular: 'mile', short: 'mi', fromKm: KM_TO_MILES, toKm: 1 / KM_TO_MILES }
        : { key, label: 'kilometres', singular: 'kilometre', short: 'km', fromKm: 1, toKm: 1 };
}

function roundDisplayValue(value, precision = null) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const resolvedPrecision = Number.isInteger(precision)
        ? Math.max(0, Math.min(3, precision))
        : (Math.abs(numeric) < 10 && Math.abs(numeric - Math.round(numeric)) > 0.01 ? 1 : 0);
    const rounded = Number(numeric.toFixed(resolvedPrecision));
    return Object.is(rounded, -0) ? 0 : rounded;
}

function convertKm(kilometres, unit) {
    const definition = getDistanceUnitDefinition(unit);
    const numeric = Number(kilometres);
    return Number.isFinite(numeric) ? numeric * definition.fromKm : null;
}

function configuredDistanceToKm(value, unit) {
    const definition = getDistanceUnitDefinition(unit);
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric * definition.toKm : null;
}

function formatDistanceKm(kilometres, unit, options = {}) {
    const definition = getDistanceUnitDefinition(unit);
    const converted = convertKm(kilometres, definition.key);
    if (!Number.isFinite(converted)) return options.fallback || `? ${definition.short}`;
    const value = roundDisplayValue(converted, options.precision);
    const unitText = options.long === true
        ? (Math.abs(value) === 1 ? definition.singular : definition.label)
        : definition.short;
    return `${value}${options.compact === true ? '' : ' '}${unitText}`;
}

function replaceDistanceMentions(text, unit) {
    return String(text || '').replace(
        /(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?|mi|miles?)(?=\b|[^a-z])/gi,
        (_match, rawValue, sourceUnit) => {
            const numeric = Number(rawValue);
            if (!Number.isFinite(numeric)) return _match;
            const source = String(sourceUnit).toLowerCase();
            const kilometres = source === 'mi' || source.startsWith('mile')
                ? numeric / KM_TO_MILES
                : numeric;
            return formatDistanceKm(kilometres, unit);
        }
    );
}

module.exports = {
    KM_TO_MILES,
    normalizeDistanceUnit,
    getDistanceUnitDefinition,
    convertKm,
    configuredDistanceToKm,
    formatDistanceKm,
    replaceDistanceMentions
};

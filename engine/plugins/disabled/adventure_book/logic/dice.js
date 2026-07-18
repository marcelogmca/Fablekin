const crypto = require('crypto');

function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
}

function deriveD20Target(successChance) {
    const chance = clampNumber(successChance, 5, 95, 50);
    return Math.max(2, Math.min(20, Math.floor(21 - (chance / 5))));
}

function deriveSuccessChanceFromD20Target(d20Target) {
    const rawTarget = Number(d20Target);
    if (Number.isFinite(rawTarget) && rawTarget >= 21) return 0;
    const target = clampNumber(d20Target, 2, 20, 11);
    return Math.max(5, Math.min(95, Math.round((21 - target) * 5)));
}

function resolveRollOutcome(option, roll) {
    if (option?.resolutionType === 'automatic') return 'automatic';
    const normalizedRoll = clampNumber(roll, 1, 20, 10);
    const rawTarget = Number(option?.d20Target);
    if (Number.isFinite(rawTarget) && rawTarget >= 21) {
        return normalizedRoll === 1 ? 'critical_failure' : 'failure';
    }
    if (normalizedRoll === 1) return 'critical_failure';
    if (normalizedRoll === 20) return 'critical_success';
    const target = clampNumber(option?.d20Target, 2, 20, deriveD20Target(option?.successChance));
    return normalizedRoll >= target ? 'success' : 'failure';
}

function rollD20() {
    return crypto.randomInt(1, 21);
}

function createPendingRollId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `roll_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function findStateOption(state, optionKey) {
    return (Array.isArray(state?.options) ? state.options : [])
        .find(candidate => candidate.optionKey === optionKey);
}

function buildRollResult(option, roll = null, getOutcomeHint = null) {
    const isAutomatic = option?.resolutionType === 'automatic';
    const outcome = isAutomatic ? 'automatic' : resolveRollOutcome(option, roll);
    return {
        roll: isAutomatic ? null : roll,
        outcome,
        resolutionType: option?.resolutionType || 'check',
        checkType: option?.checkType || '',
        d20Target: option?.d20Target,
        successChance: option?.successChance,
        outcomeHint: typeof getOutcomeHint === 'function' ? getOutcomeHint(option, outcome) : '',
        success: outcome === 'automatic' || outcome === 'success' || outcome === 'critical_success'
    };
}

function ensurePendingRolls(session) {
    if (!session.pendingRolls || typeof session.pendingRolls !== 'object') session.pendingRolls = {};
    return session.pendingRolls;
}

module.exports = {
    deriveD20Target,
    deriveSuccessChanceFromD20Target,
    resolveRollOutcome,
    rollD20,
    createPendingRollId,
    findStateOption,
    buildRollResult,
    ensurePendingRolls
};

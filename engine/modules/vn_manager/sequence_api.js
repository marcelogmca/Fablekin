/**
 * engine/modules/sequence_api.js
 *
 * Provides a clean API for plugins to query and modify the VN sequence
 * on turnContext.output.sequence. All command injection uses the canonical
 * UCP parser to ensure consistent grammar across the engine.
 */

const { parseCommandToUCP } = require('./ucp_parser.js');
const { Logger } = require('../utils.js');

const SHADOW_OPTION_KEYS = Object.freeze({
    angleDegrees: 'angle_degrees',
    angle_degrees: 'angle_degrees',
    angle: 'angle',
    opacity: 'opacity',
    strength: 'opacity',
    length: 'length',
    blur: 'blur'
});

function serializeShadowOptions(options = {}) {
    if (!options || typeof options !== 'object') return '';

    const segments = [];
    for (const [rawKey, rawValue] of Object.entries(options)) {
        if (rawKey === 'enabled') continue;
        const key = SHADOW_OPTION_KEYS[rawKey];
        if (!key) continue;
        if (rawValue === undefined || rawValue === null || rawValue === '') continue;
        segments.push(`${key}=${rawValue}`);
    }
    return segments.length > 0 ? `|${segments.join('|')}` : '';
}

function buildShadowCommand(characterName, shadow = {}) {
    const name = String(characterName || '').trim();
    if (!name) return null;

    if (shadow && typeof shadow === 'object' && shadow.enabled === false) {
        return `shadow:off:${name}`;
    }

    return `shadow:on:${name}${serializeShadowOptions(shadow)}`;
}

/**
 * Gets the sequence array from the turnContext.
 * @param {Object} turnContext
 * @returns {Array} The sequence array, or empty array if none.
 */
function getSequence(turnContext) {
    return turnContext?.output?.sequence || [];
}

/**
 * Gets a specific line from the sequence safely.
 * @param {Object} turnContext
 * @param {number} index - Zero-based line index.
 * @returns {Object|null} The Scene object, or null if out of bounds.
 */
function getLine(turnContext, index) {
    const seq = getSequence(turnContext);
    return seq[index] || null;
}

/**
 * Finds all lines matching a predicate.
 * @param {Object} turnContext
 * @param {Function} predicate - (scene, index) => boolean
 * @returns {Array<{ index: number, scene: Object }>}
 */
function findLines(turnContext, predicate) {
    const seq = getSequence(turnContext);
    const results = [];
    for (let i = 0; i < seq.length; i++) {
        if (predicate(seq[i], i)) {
            results.push({ index: i, scene: seq[i] });
        }
    }
    return results;
}

/**
 * Finds the first line where a specific character speaks.
 * Case-insensitive match.
 * @param {Object} turnContext
 * @param {string} characterName
 * @returns {{ index: number, scene: Object }|null}
 */
function findCharacter(turnContext, characterName) {
    const lower = characterName.toLowerCase();
    const seq = getSequence(turnContext);
    for (let i = 0; i < seq.length; i++) {
        if (seq[i].character && seq[i].character.toLowerCase() === lower) {
            return { index: i, scene: seq[i] };
        }
    }
    return null;
}

/**
 * Creates a validated UCP event object from a command string.
 * @param {string} cmdString - UCP command (e.g. "sfx:trigger:boom.mp3")
 * @returns {{ type: string, payload: Object }|null} Parsed event, or null if invalid.
 */
function createEvent(cmdString) {
    if (typeof cmdString !== 'string' || !cmdString.trim()) return null;

    return parseCommandToUCP(cmdString);
}

/**
 * Adds a UCP command to a specific line in the sequence.
 * @param {Object} turnContext
 * @param {number} lineIndex - Zero-based line index.
 * @param {string} cmdString - UCP command string.
 * @returns {boolean} True if the command was added, false if invalid.
 */
function addCommand(turnContext, lineIndex, cmdString) {
    const seq = getSequence(turnContext);
    if (!seq[lineIndex]) {
        Logger.warn('SequenceAPI', `addCommand: Line ${lineIndex} does not exist (sequence length: ${seq.length})`);
        return false;
    }

    const event = createEvent(cmdString);
    if (!event) {
        Logger.warn('SequenceAPI', `addCommand: Invalid UCP command: "${cmdString}"`);
        return false;
    }

    if (!seq[lineIndex].clientEvents) seq[lineIndex].clientEvents = [];
    seq[lineIndex].clientEvents.push(event);
    return true;
}

/**
 * Adds a UCP command to every line where a specific character speaks.
 * @param {Object} turnContext
 * @param {string} characterName - Case-insensitive character name.
 * @param {string} cmdString - UCP command string.
 * @returns {number} Number of lines the command was added to.
 */
function addCommandToCharacter(turnContext, characterName, cmdString) {
    const matches = findLines(turnContext, (scene) =>
        scene.character && scene.character.toLowerCase() === characterName.toLowerCase()
    );

    let count = 0;
    for (const { index } of matches) {
        if (addCommand(turnContext, index, cmdString)) count++;
    }
    return count;
}

/**
 * Adds a UCP command to the first line of the sequence (scene establishment).
 * @param {Object} turnContext
 * @param {string} cmdString - UCP command string.
 * @returns {boolean}
 */
function addCommandToOpening(turnContext, cmdString) {
    return addCommand(turnContext, 0, cmdString);
}

/**
 * Adds a UCP command to the last non-virtual line of the sequence.
 * @param {Object} turnContext
 * @param {string} cmdString - UCP command string.
 * @returns {boolean}
 */
function addCommandToClosing(turnContext, cmdString) {
    const seq = getSequence(turnContext);
    if (seq.length === 0) return false;

    // Find last non-virtual line
    let lastIdx = seq.length - 1;
    while (lastIdx > 0 && seq[lastIdx].isVirtual) lastIdx--;
    return addCommand(turnContext, lastIdx, cmdString);
}

/**
 * Adds a sprite shadow command to a specific sequence line.
 * @param {Object} turnContext
 * @param {number} lineIndex
 * @param {string} characterName - Character name, plugin actor id, "*" or "all".
 * @param {Object} shadow - Shadow config. Use { enabled: false } to disable.
 * @returns {boolean}
 */
function addShadowCommand(turnContext, lineIndex, characterName, shadow = {}) {
    const command = buildShadowCommand(characterName, shadow);
    return command ? addCommand(turnContext, lineIndex, command) : false;
}

function enableShadow(turnContext, lineIndex, characterName, options = {}) {
    return addShadowCommand(turnContext, lineIndex, characterName, { ...(options || {}), enabled: true });
}

function disableShadow(turnContext, lineIndex, characterName) {
    return addShadowCommand(turnContext, lineIndex, characterName, { enabled: false });
}

module.exports = {
    getSequence,
    getLine,
    findLines,
    findCharacter,
    createEvent,
    addCommand,
    addCommandToCharacter,
    addCommandToOpening,
    addCommandToClosing,
    buildShadowCommand,
    addShadowCommand,
    enableShadow,
    disableShadow
};

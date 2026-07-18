const crypto = require('crypto');
const encounterSchema = require('../frontend/runtime/encounter_schema.js');
const capabilityProfileModule = require('../frontend/runtime/v1_capability_profile.js');

const COMPILER_VERSION = '1.0.0';
const MARKER_START = 'BEGIN_TDS_ENCOUNTER_FACADE';
const MARKER_END = 'END_TDS_ENCOUNTER_FACADE';

const V1_PROFILE = capabilityProfileModule?.profile || {};
const SUPPORTED_PATTERN_TYPES = new Set(Array.isArray(V1_PROFILE.patternTypes) ? V1_PROFILE.patternTypes : ['spiral', 'radial', 'fan', 'aimed', 'line', 'rain']);

const STYLE_SET = new Set(['readable', 'mobile_crossfire', 'duel', 'swarm', 'ring_pressure', 'aimed_pressure']);
const ENCOUNTER_LENGTH_SECONDS = Object.freeze({ short: 45, medium: 75, long: 105 });
const MODE_SET = new Set(['waves', 'survive', 'boss']);
const DIFFICULTY_SET = new Set(['easy', 'normal', 'hard']);
const ROLE_SET = new Set(['chaser', 'turret', 'ranger', 'charger']);
const COUNT_SET = new Set(['solo', 'small', 'medium', 'large']);
const PRESSURE_SET = new Set(['light', 'medium', 'heavy']);
const SPAWN_SET = new Set(['edge', 'random', 'center']);
const PICKUP_SET = new Set(['none', 'heal', 'cooldown']);
const BOSS_PICKUP_SET = new Set(['none', 'heal', 'cooldown', 'both']);
const ADDS_SET = new Set(['none', 'light', 'medium']);

const BANNED_OPTION_KEYS = new Set([
    'hp', 'speed', 'radius', 'damage', 'every', 'interval', 'duration', 'spread',
    'budget', 'modifier', 'phaseThreshold', 'phase_threshold', 'cooldown',
    'attackInterval', 'attack_interval', 'lifeTicks', 'life_ticks', 'vz'
]);

const CUTOFF_KEYWORDS = new Set([
    'hazard', 'object', 'capture', 'protect', 'status', 'music', 'flag', 'counter',
    'actiongroup', 'action_group', 'initialflags', 'initialcounters', 'arena_modifier',
    'modifiers', 'phase', 'start', 'after', 'every', 'when'
]);

const COUNT_PRESETS = Object.freeze({
    solo: 1,
    small: 2,
    medium: 4,
    large: 6
});

const DIFFICULTY_PRESETS = Object.freeze({
    easy: {
        playerHpBonus: 1,
        enemyHpMul: 0.85,
        enemyCountMul: 0.75,
        bulletCountMul: 0.85,
        projectileSpeedMul: 0.9
    },
    normal: {
        playerHpBonus: 0,
        enemyHpMul: 1,
        enemyCountMul: 1,
        bulletCountMul: 1,
        projectileSpeedMul: 1
    },
    hard: {
        playerHpBonus: 0,
        enemyHpMul: 1.15,
        enemyCountMul: 1.25,
        bulletCountMul: 1.15,
        projectileSpeedMul: 1.08
    }
});

const ROLE_PRESETS = Object.freeze({
    chaser: { behavior: 'chase_player', hp: 10, speed: 1.28, radius: 22, attackEverySeconds: 1.2 },
    turret: { behavior: 'stationary_turret', hp: 14, speed: 0.3, radius: 24, attackEverySeconds: 1.05 },
    ranger: { behavior: 'keep_distance', hp: 12, speed: 0.9, radius: 21, attackEverySeconds: 1.1 },
    charger: { behavior: 'charge_telegraphed', hp: 18, speed: 1.35, radius: 24, attackEverySeconds: 1.35 }
});

const PATTERN_PRESETS = Object.freeze({
    fan: { count: 6, speed: 2.7, spreadDegrees: 44 },
    spiral: { count: 4, speed: 3.1, spreadDegrees: 48 },
    radial: { count: 10, speed: 2.4, spreadDegrees: 360 },
    aimed: { count: 1, speed: 3.6, spreadDegrees: 0 },
    line: { count: 7, speed: 2.9, spacing: 56, spreadDegrees: 56 },
    rain: { count: 8, speed: 2.5, width: 860, spreadDegrees: 80 }
});

const PRESSURE_PRESETS = Object.freeze({
    light: {
        countMul: 0.92,
        speedMul: 0.95,
        spawnEverySeconds: 8.5,
        telegraphEverySeconds: 10,
        emitterIntervalSeconds: 1.05,
        emitterDurationSeconds: 6.5,
        attackEveryMul: 1.08
    },
    medium: {
        countMul: 1,
        speedMul: 1,
        spawnEverySeconds: 7,
        telegraphEverySeconds: 8.5,
        emitterIntervalSeconds: 0.92,
        emitterDurationSeconds: 7.5,
        attackEveryMul: 1
    },
    heavy: {
        countMul: 1.15,
        speedMul: 1.07,
        spawnEverySeconds: 5.8,
        telegraphEverySeconds: 6.5,
        emitterIntervalSeconds: 0.82,
        emitterDurationSeconds: 8.5,
        attackEveryMul: 0.92
    }
});

function stableHash(text) {
    return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 16);
}

function stripFacadeMarkers(source) {
    const text = String(source || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const start = text.indexOf(MARKER_START);
    const end = text.indexOf(MARKER_END);
    if (start >= 0 && end > start) {
        return text.slice(start + MARKER_START.length, end).trim();
    }
    return text.trim();
}

function createDiagnostic(level, code, message, line = 0, column = 1, hint = '') {
    return {
        level: String(level || 'error'),
        code: String(code || 'TDSF-E000'),
        line: Number.isInteger(line) ? line : 0,
        column: Number.isInteger(column) ? column : 1,
        message: String(message || ''),
        hint: String(hint || '')
    };
}

function pushDiagnostic(state, level, code, message, token = null, hint = '') {
    state.diagnostics.push(createDiagnostic(
        level,
        code,
        message,
        Number.isInteger(token?.line) ? token.line : 0,
        Number.isInteger(token?.column) ? token.column : 1,
        hint
    ));
}

function hasErrors(diagnostics) {
    return diagnostics.some((item) => item.level === 'error');
}

function tokenizeLine(line, lineNumber) {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
        while (i < line.length && /\s/.test(line[i])) i += 1;
        if (i >= line.length) break;
        if (line[i] === '#') break;
        const column = i + 1;
        if (line[i] === '"') {
            i += 1;
            let value = '';
            let closed = false;
            while (i < line.length) {
                const ch = line[i];
                if (ch === '\\' && i + 1 < line.length) {
                    const next = line[i + 1];
                    value += next === 'n' ? '\n' : next;
                    i += 2;
                    continue;
                }
                if (ch === '"') {
                    closed = true;
                    i += 1;
                    break;
                }
                value += ch;
                i += 1;
            }
            tokens.push({ value, line: lineNumber, column, quoted: true, closed });
            continue;
        }
        let value = '';
        while (i < line.length && !/\s/.test(line[i])) {
            value += line[i];
            i += 1;
        }
        if (!value || value[0] === '#') break;
        tokens.push({ value, line: lineNumber, column, quoted: false, closed: true });
    }
    return tokens;
}

function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[-_ ]+([a-z0-9])/g, (_m, ch) => ch.toUpperCase());
}

function sanitizeId(value) {
    return String(value || '').trim();
}

function isValidId(id) {
    return /^[A-Za-z][A-Za-z0-9_:-]{0,63}$/.test(String(id || ''));
}

function parseOptions(tokens, startIndex = 0) {
    const options = {};
    const positionals = [];
    let i = startIndex;
    while (i < tokens.length) {
        const token = tokens[i];
        const raw = String(token.value || '');
        const eq = raw.indexOf('=');
        if (eq > 0) {
            const key = normalizeKey(raw.slice(0, eq));
            options[key] = {
                value: raw.slice(eq + 1),
                token
            };
            i += 1;
            continue;
        }
        if (i + 1 < tokens.length && !String(tokens[i + 1].value || '').includes('=')) {
            const key = normalizeKey(raw);
            options[key] = {
                value: tokens[i + 1].value,
                token
            };
            i += 2;
            continue;
        }
        positionals.push(token);
        i += 1;
    }
    return { options, positionals };
}

function optionValue(options, keys, fallback = null) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
        const normalized = normalizeKey(key);
        if (Object.prototype.hasOwnProperty.call(options, normalized)) {
            return options[normalized].value;
        }
    }
    return fallback;
}

function toInt(value, fallback = null) {
    const n = Number.parseInt(String(value || '').trim(), 10);
    return Number.isInteger(n) ? n : fallback;
}

function toNumber(value, fallback = null) {
    const n = Number(String(value || '').trim());
    return Number.isFinite(n) ? n : fallback;
}

function parseHexColor(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (!match) return null;
    let hex = match[1];
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    return Number.parseInt(hex, 16);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function roundToInt(value, fallback = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.round(n));
}

function createParseState(source) {
    return {
        source,
        diagnostics: [],
        encounter: null,
        styles: [],
        waves: [],
        boss: null
    };
}

function rejectLowLevelOption(state, key, value, token) {
    const normalized = normalizeKey(key);
    if (BANNED_OPTION_KEYS.has(normalized)) {
        pushDiagnostic(
            state,
            'error',
            'TDSF-E040',
            'Option "' + normalized + '" is low-level and not allowed in EncounterFacade v1.',
            token,
            'Use semantic knobs like length, difficulty, pressure, pattern, and role presets.'
        );
    }
    if (normalized === 'count') {
        const numericCount = toNumber(value, null);
        if (Number.isFinite(numericCount)) {
            pushDiagnostic(
                state,
                'error',
                'TDSF-E041',
                'Numeric count "' + String(value) + '" is not allowed in EncounterFacade v1.',
                token,
                'Use count presets: solo, small, medium, large.'
            );
        }
    }
}

function ensureValidEnum(state, value, set, code, token, label) {
    const normalized = String(value || '').trim().toLowerCase();
    if (set.has(normalized)) return normalized;
    pushDiagnostic(
        state,
        'error',
        code,
        'Unsupported ' + label + ' "' + String(value || '') + '".',
        token
    );
    return '';
}

function parseEncounterLine(state, tokens) {
    if (tokens.length < 2) {
        pushDiagnostic(state, 'error', 'TDSF-E010', 'encounter line requires a quoted title.', tokens[0], 'Example: encounter "Glass Ambush" id glass_ambush length=medium difficulty=normal mode=boss');
        return;
    }
    const title = String(tokens[1]?.value || '').trim();
    const { options, positionals } = parseOptions(tokens, 2);
    for (const [key, item] of Object.entries(options)) {
        rejectLowLevelOption(state, key, item.value, item.token);
    }
    if (positionals.length > 0) {
        pushDiagnostic(state, 'warning', 'TDSF-W011', 'Ignoring extra positional values on encounter line.', positionals[0]);
    }
    const id = sanitizeId(optionValue(options, 'id', ''));
    const length = ensureValidEnum(state, optionValue(options, 'length', ''), new Set(Object.keys(ENCOUNTER_LENGTH_SECONDS)), 'TDSF-E012', options.length?.token || tokens[0], 'length');
    const difficulty = ensureValidEnum(state, optionValue(options, 'difficulty', ''), DIFFICULTY_SET, 'TDSF-E013', options.difficulty?.token || tokens[0], 'difficulty');
    const mode = ensureValidEnum(state, optionValue(options, 'mode', ''), MODE_SET, 'TDSF-E014', options.mode?.token || tokens[0], 'mode');
    const seed = String(optionValue(options, 'seed', '') || '').trim();
    const bgHex = String(optionValue(options, ['bg', 'background'], '') || '').trim();
    const backgroundColor = bgHex ? parseHexColor(bgHex) : null;
    if (!id) {
        pushDiagnostic(state, 'error', 'TDSF-E015', 'encounter requires id.', tokens[0], 'Add id=your_encounter_id');
    } else if (!isValidId(id)) {
        pushDiagnostic(state, 'error', 'TDSF-E016', 'Encounter id "' + id + '" is invalid.', options.id?.token || tokens[0]);
    }
    if (bgHex && !Number.isInteger(backgroundColor)) {
        pushDiagnostic(state, 'error', 'TDSF-E018', 'Encounter background must be a #hex color like #c9a36a.', options.bg?.token || options.background?.token || tokens[0]);
    }
    const allowed = new Set(['id', 'length', 'difficulty', 'mode', 'seed', 'bg', 'background']);
    for (const key of Object.keys(options)) {
        if (!allowed.has(key)) {
            pushDiagnostic(state, 'error', 'TDSF-E017', 'Unsupported encounter option "' + key + '".', options[key]?.token || tokens[0]);
        }
    }
    state.encounter = {
        title: title || id || 'Generated Encounter',
        id,
        seed: seed || id,
        length,
        difficulty,
        mode,
        backgroundColor: Number.isInteger(backgroundColor) ? backgroundColor : null
    };
}

function parseStyleLine(state, tokens) {
    if (tokens.length <= 1) return;
    for (let i = 1; i < tokens.length; i += 1) {
        const value = String(tokens[i]?.value || '').trim().toLowerCase();
        if (!value) continue;
        if (!STYLE_SET.has(value)) {
            pushDiagnostic(state, 'error', 'TDSF-E020', 'Unsupported style token "' + value + '".', tokens[i]);
            continue;
        }
        if (!state.styles.includes(value)) state.styles.push(value);
    }
}

function parseWaveLine(state, tokens) {
    const id = sanitizeId(tokens[1]?.value);
    if (!id) {
        pushDiagnostic(state, 'error', 'TDSF-E021', 'wave line requires an id.', tokens[0], 'Example: wave opening enemy=chaser count=small pressure=light pattern=fan spawn=edge');
        return;
    }
    if (!isValidId(id)) {
        pushDiagnostic(state, 'error', 'TDSF-E022', 'Wave id "' + id + '" is invalid.', tokens[1] || tokens[0]);
        return;
    }
    const { options, positionals } = parseOptions(tokens, 2);
    for (const [key, item] of Object.entries(options)) {
        rejectLowLevelOption(state, key, item.value, item.token);
    }
    if (positionals.length > 0) {
        pushDiagnostic(state, 'warning', 'TDSF-W023', 'Ignoring extra positional values on wave line.', positionals[0]);
    }
    const enemy = ensureValidEnum(state, optionValue(options, 'enemy', ''), ROLE_SET, 'TDSF-E024', options.enemy?.token || tokens[0], 'wave enemy');
    const count = ensureValidEnum(state, optionValue(options, 'count', ''), COUNT_SET, 'TDSF-E025', options.count?.token || tokens[0], 'wave count');
    const pressure = ensureValidEnum(state, optionValue(options, 'pressure', ''), PRESSURE_SET, 'TDSF-E026', options.pressure?.token || tokens[0], 'wave pressure');
    const pattern = ensureValidEnum(state, optionValue(options, 'pattern', 'auto'), new Set(['auto', ...Array.from(SUPPORTED_PATTERN_TYPES)]), 'TDSF-E027', options.pattern?.token || tokens[0], 'wave pattern');
    const spawn = ensureValidEnum(state, optionValue(options, 'spawn', ''), SPAWN_SET, 'TDSF-E028', options.spawn?.token || tokens[0], 'wave spawn');
    const pickup = ensureValidEnum(state, optionValue(options, 'pickup', 'none'), PICKUP_SET, 'TDSF-E029', options.pickup?.token || tokens[0], 'wave pickup');
    const allowed = new Set(['enemy', 'count', 'pressure', 'pattern', 'spawn', 'pickup']);
    for (const key of Object.keys(options)) {
        if (!allowed.has(key)) {
            pushDiagnostic(state, 'error', 'TDSF-E02A', 'Unsupported wave option "' + key + '".', options[key]?.token || tokens[0]);
        }
    }
    state.waves.push({ id, enemy, count, pressure, pattern, spawn, pickup });
}

function parseBossLine(state, tokens) {
    const id = sanitizeId(tokens[1]?.value);
    if (!id) {
        pushDiagnostic(state, 'error', 'TDSF-E030', 'boss line requires an id.', tokens[0], 'Example: boss glass_captain name="Glass Captain" deck=fan,radial,line pressure=medium phases=3 adds=light pickup=heal');
        return;
    }
    if (!isValidId(id)) {
        pushDiagnostic(state, 'error', 'TDSF-E031', 'Boss id "' + id + '" is invalid.', tokens[1] || tokens[0]);
        return;
    }
    const { options, positionals } = parseOptions(tokens, 2);
    for (const [key, item] of Object.entries(options)) {
        rejectLowLevelOption(state, key, item.value, item.token);
    }
    if (positionals.length > 0) {
        pushDiagnostic(state, 'warning', 'TDSF-W032', 'Ignoring extra positional values on boss line.', positionals[0]);
    }
    const name = String(optionValue(options, 'name', id) || '').trim() || id;
    const deckRaw = String(optionValue(options, 'deck', '') || '').trim();
    const pressure = ensureValidEnum(state, optionValue(options, 'pressure', ''), PRESSURE_SET, 'TDSF-E033', options.pressure?.token || tokens[0], 'boss pressure');
    const phases = toInt(optionValue(options, 'phases', ''), null);
    if (!(phases === 2 || phases === 3)) {
        pushDiagnostic(state, 'error', 'TDSF-E034', 'Boss phases must be 2 or 3.', options.phases?.token || tokens[0]);
    }
    const adds = ensureValidEnum(state, optionValue(options, 'adds', 'none'), ADDS_SET, 'TDSF-E035', options.adds?.token || tokens[0], 'boss adds');
    const pickup = ensureValidEnum(state, optionValue(options, 'pickup', 'none'), BOSS_PICKUP_SET, 'TDSF-E036', options.pickup?.token || tokens[0], 'boss pickup');
    const allowed = new Set(['name', 'deck', 'pressure', 'phases', 'adds', 'pickup']);
    for (const key of Object.keys(options)) {
        if (!allowed.has(key)) {
            pushDiagnostic(state, 'error', 'TDSF-E037', 'Unsupported boss option "' + key + '".', options[key]?.token || tokens[0]);
        }
    }
    const deck = deckRaw
        .split(',')
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean);
    if (deck.length === 0) {
        pushDiagnostic(state, 'error', 'TDSF-E038', 'Boss deck is required.', options.deck?.token || tokens[0], 'Use deck=fan,radial,line');
    }
    for (const patternType of deck) {
        if (!SUPPORTED_PATTERN_TYPES.has(patternType)) {
            pushDiagnostic(state, 'error', 'TDSF-E039', 'Unknown boss deck pattern "' + patternType + '".', options.deck?.token || tokens[0]);
        }
    }
    state.boss = { id, name, deck, pressure, phases: phases || 3, adds, pickup };
}

function parseFacade(source) {
    const cleanSource = stripFacadeMarkers(source);
    const state = createParseState(cleanSource);
    const lines = cleanSource.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const lineNumber = i + 1;
        const tokens = tokenizeLine(lines[i], lineNumber);
        if (tokens.length === 0) continue;
        const unclosed = tokens.find((token) => token.closed === false);
        if (unclosed) {
            pushDiagnostic(state, 'error', 'TDSF-E001', 'Unclosed quoted string.', unclosed);
            continue;
        }
        const command = String(tokens[0].value || '').trim().toLowerCase();
        if (CUTOFF_KEYWORDS.has(command)) {
            pushDiagnostic(state, 'error', 'TDSF-E002', 'Keyword "' + command + '" is not available in EncounterFacade v1.', tokens[0]);
            continue;
        }
        if (command === 'encounter') parseEncounterLine(state, tokens);
        else if (command === 'style') parseStyleLine(state, tokens);
        else if (command === 'wave') parseWaveLine(state, tokens);
        else if (command === 'boss') parseBossLine(state, tokens);
        else {
            pushDiagnostic(
                state,
                'error',
                'TDSF-E003',
                'Unknown command "' + command + '".',
                tokens[0],
                'Allowed commands: encounter, style, wave, boss.'
            );
        }
    }

    if (!state.encounter) {
        pushDiagnostic(state, 'error', 'TDSF-E004', 'Missing encounter line.', null, 'Add an encounter line at the top of the facade script.');
    } else if (state.encounter.mode === 'boss' && !state.boss) {
        pushDiagnostic(state, 'error', 'TDSF-E005', 'Mode "boss" requires a boss line.');
    }
    if ((state.encounter?.mode === 'waves' || state.encounter?.mode === 'survive') && state.waves.length === 0) {
        pushDiagnostic(state, 'error', 'TDSF-E006', 'At least one wave line is required for mode "' + state.encounter.mode + '".');
    }
    if (state.waves.length > 0) {
        const seenIds = new Set();
        for (const wave of state.waves) {
            if (seenIds.has(wave.id)) {
                pushDiagnostic(state, 'error', 'TDSF-E007', 'Duplicate wave id "' + wave.id + '".');
            }
            seenIds.add(wave.id);
        }
    }

    return state;
}

function resolveAutoPattern(wave) {
    const pressure = String(wave?.pressure || 'medium');
    if (pressure === 'heavy') return 'line';
    if (pressure === 'light') return 'fan';
    return 'spiral';
}

function resolveSpawnSpec(spawn) {
    const value = String(spawn || 'edge');
    if (value === 'center') return { at: { x: 0, y: -120 } };
    if (value === 'random') return { formation: 'random' };
    return { formation: 'left_right' };
}

function maybePushModifier(pattern, modifier) {
    if (!pattern || !modifier || typeof modifier !== 'object') return;
    if (!Array.isArray(pattern.modifiers)) pattern.modifiers = [];
    pattern.modifiers.push(modifier);
}

function createPattern(patternType, pressureLevel, difficultySpec, styles, context = {}) {
    const base = PATTERN_PRESETS[patternType] || PATTERN_PRESETS.spiral;
    const pressureSpec = PRESSURE_PRESETS[pressureLevel] || PRESSURE_PRESETS.medium;
    const count = roundToInt(base.count * difficultySpec.bulletCountMul * pressureSpec.countMul, 1);
    const speed = Number((base.speed * difficultySpec.projectileSpeedMul * pressureSpec.speedMul).toFixed(2));
    const pattern = {
        type: patternType,
        count: Math.max(1, count),
        speed: Math.max(0.2, speed),
        spreadDegrees: Number(base.spreadDegrees || 48),
        projectileType: 'enemy_default_bullet'
    };
    if (patternType === 'line') pattern.spacing = Number(base.spacing || 56);
    if (patternType === 'rain') pattern.width = Number(base.width || 860);
    if (patternType === 'aimed' || patternType === 'fan' || patternType === 'line') {
        pattern.aim = { type: 'toward_player' };
    }

    const styleSet = new Set(Array.isArray(styles) ? styles : []);
    const readable = styleSet.has('readable');
    if ((patternType === 'line' || patternType === 'fan') && (readable || pressureLevel !== 'light')) {
        maybePushModifier(pattern, { type: 'accelerate', perSecond: pressureLevel === 'heavy' ? 0.42 : 0.3 });
    }
    if (pressureLevel === 'heavy' && (patternType === 'radial' || patternType === 'rain')) {
        maybePushModifier(pattern, { type: 'sine_wave', amplitude: 8, frequency: 1.2 });
    }
    if (pressureLevel === 'heavy' && patternType === 'aimed') {
        maybePushModifier(pattern, { type: 'home_to_player', maxTurnRateDegPerSecond: 72, delaySeconds: 0.25 });
    }
    if (context.isBossFinalPattern === true) {
        maybePushModifier(pattern, { type: 'split_after_time', timeSeconds: 0.95, count: 3, speed: Math.max(2, speed * 0.82) });
    }
    return pattern;
}

function buildWaveEnemyType(wave, difficultySpec, patternId) {
    const role = ROLE_PRESETS[wave.enemy] || ROLE_PRESETS.chaser;
    return {
        hp: Math.max(1, roundToInt(role.hp * difficultySpec.enemyHpMul, role.hp)),
        radius: role.radius,
        speed: Number(role.speed.toFixed(2)),
        behavior: role.behavior,
        attackPatternId: patternId,
        attackIntervalMs: Math.max(240, Math.round((role.attackEverySeconds * 1000) * (PRESSURE_PRESETS[wave.pressure]?.attackEveryMul || 1)))
    };
}

function applyBossDifficulty(baseHp, difficultySpec, pressureSpec) {
    const hp = baseHp * difficultySpec.enemyHpMul * (pressureSpec.countMul || 1);
    return Math.max(20, roundToInt(hp, baseHp));
}

function createBossEnemy(state, bossPatternIds, difficultySpec, styles) {
    const bossSpec = state.boss;
    const pressureSpec = PRESSURE_PRESETS[bossSpec.pressure] || PRESSURE_PRESETS.medium;
    const attackEvery = clamp(1.25 * pressureSpec.attackEveryMul, 0.55, 2.5);
    const attackDeck = bossPatternIds.map((patternId, index) => ({
        id: 'boss_attack_' + (index + 1),
        pattern: patternId,
        everySeconds: Number(attackEvery.toFixed(2)),
        weight: patternId.includes('aimed') ? 1 : 2
    }));
    const bossPhases = [];
    const phaseCount = bossSpec.phases === 2 ? 2 : 3;
    for (let i = 0; i < phaseCount; i += 1) {
        const untilHpRatio = i < phaseCount - 1 ? Number(((phaseCount - i - 1) / phaseCount).toFixed(2)) : null;
        bossPhases.push({
            id: 'phase_' + (i + 1),
            untilHpRatio,
            attackDeckMode: 'weighted_deck',
            attackDeck: attackDeck.map((item) => item.id),
            noRepeatWindow: 1
        });
    }

    const styleSet = new Set(styles || []);
    const baseHp = styleSet.has('duel') ? 145 : 165;
    return {
        hp: applyBossDifficulty(baseHp, difficultySpec, pressureSpec),
        radius: 40,
        speed: 0.9,
        behavior: 'boss_anchor',
        boss: true,
        bossId: bossSpec.id,
        displayName: bossSpec.name,
        attackPatternId: bossPatternIds[0] || 'enemy_spiral_pressure',
        attackIntervalMs: Math.round(attackEvery * 1000),
        attacks: attackDeck,
        bossPhases
    };
}

function resolveArenaBackgroundColor(base) {
    if (Number.isInteger(base?.backgroundColor)) return base.backgroundColor;
    return 0x080d1f;
}

function scaledWaveCount(wave, difficultySpec) {
    const base = COUNT_PRESETS[wave.count] || 2;
    return Math.max(1, roundToInt(base * difficultySpec.enemyCountMul, base));
}

function buildWavePhase(wave, index, totalWaves, encounterLength, patternId, enemyTypeId, difficultySpec, emitterId = null) {
    const phaseDuration = Math.max(14, Math.floor(encounterLength / Math.max(1, totalWaves)));
    const enter = [
        { type: 'show_banner', text: 'Wave ' + (index + 1) },
        { type: 'spawn_enemy', enemyType: enemyTypeId, count: scaledWaveCount(wave, difficultySpec), ...resolveSpawnSpec(wave.spawn) }
    ];
    const rules = [
        {
            when: { type: 'phase_elapsed', seconds: Math.max(2, Math.floor(phaseDuration * 0.35)) },
            do: [{ type: 'telegraph_then_fire', pattern: patternId, source: { type: 'random_arena' }, shape: 'circle', radius: 160, durationSeconds: 0.7, style: 'danger' }]
        }
    ];

    if (wave.pressure !== 'light') {
        rules.push({
            when: { type: 'phase_elapsed', seconds: Math.max(3, Math.floor(phaseDuration * 0.55)) },
            do: [{ type: 'spawn_enemy', enemyType: enemyTypeId, count: Math.max(1, Math.round(scaledWaveCount(wave, difficultySpec) * 0.5)), ...resolveSpawnSpec('random') }]
        });
    }

    if (wave.pickup === 'heal') {
        rules.push({
            when: { type: 'phase_elapsed', seconds: Math.max(4, Math.floor(phaseDuration * 0.5)) },
            do: [{ type: 'spawn_pickup', pickup: 'facade_heal_orb', at: { type: 'arena_center' } }]
        });
    } else if (wave.pickup === 'cooldown') {
        rules.push({
            when: { type: 'phase_elapsed', seconds: Math.max(4, Math.floor(phaseDuration * 0.5)) },
            do: [{ type: 'spawn_pickup', pickup: 'facade_cooldown_orb', at: { type: 'arena_center' } }]
        });
    }

    if (emitterId) {
        rules.push({
            when: { type: 'phase_elapsed', seconds: Math.max(1, Math.floor(phaseDuration * 0.15)) },
            do: [{ type: 'spawn_emitter', emitter: emitterId }]
        });
        rules.push({
            when: { type: 'phase_elapsed', seconds: Math.max(7, Math.floor(phaseDuration * 0.8)) },
            do: [{ type: 'clear_emitters' }]
        });
    }

    if (index < totalWaves - 1) {
        rules.push({
            when: { type: 'all_enemies_defeated' },
            do: [{ type: 'transition_phase', phase: 'wave_' + (index + 2) }]
        });
    }

    return {
        id: 'wave_' + (index + 1),
        objective: 'Survive and clear wave ' + (index + 1) + '.',
        enter,
        rules
    };
}

function buildEncounterFromFacade(state) {
    const base = state.encounter;
    const difficultySpec = DIFFICULTY_PRESETS[base.difficulty] || DIFFICULTY_PRESETS.normal;
    const lengthSeconds = ENCOUNTER_LENGTH_SECONDS[base.length] || ENCOUNTER_LENGTH_SECONDS.medium;
    const styles = state.styles.slice();
    const patterns = {};
    const enemyTypes = {};
    const emitters = {};
    const phases = [];
    const objectives = [];
    const pickups = {
        facade_heal_orb: { id: 'facade_heal_orb', type: 'heal_orb', radius: 18, durationSeconds: 11 },
        facade_cooldown_orb: { id: 'facade_cooldown_orb', type: 'cooldown_reset', radius: 18, durationSeconds: 10 }
    };

    const wavePatternById = new Map();
    const waveEnemyById = new Map();

    for (const wave of state.waves) {
        const resolvedPatternType = wave.pattern === 'auto' ? resolveAutoPattern(wave) : wave.pattern;
        const patternId = 'pattern_wave_' + wave.id;
        patterns[patternId] = createPattern(resolvedPatternType, wave.pressure, difficultySpec, styles);
        wavePatternById.set(wave.id, patternId);
        const enemyTypeId = 'enemy_wave_' + wave.id;
        enemyTypes[enemyTypeId] = buildWaveEnemyType(wave, difficultySpec, patternId);
        waveEnemyById.set(wave.id, enemyTypeId);
        if (wave.pressure === 'heavy') {
            const pressureSpec = PRESSURE_PRESETS[wave.pressure] || PRESSURE_PRESETS.medium;
            emitters['emitter_' + wave.id] = {
                emitterId: 'emitter_' + wave.id,
                source: wave.spawn === 'edge'
                    ? { type: 'arena_edge', edge: 'top', position: 0.5 }
                    : (wave.spawn === 'center'
                        ? { type: 'arena_center' }
                        : { type: 'random_arena' }),
                pattern: patternId,
                intervalSeconds: Number(pressureSpec.emitterIntervalSeconds.toFixed(2)),
                durationSeconds: Number(pressureSpec.emitterDurationSeconds.toFixed(2)),
                startDelaySeconds: 0.2,
                aim: { type: 'toward_player' },
                movement: { type: 'none' }
            };
        }
    }

    let bossPatternIds = [];
    if (state.boss) {
        const deck = Array.isArray(state.boss.deck) ? state.boss.deck : [];
        bossPatternIds = deck.map((patternType, index) => {
            const patternId = 'pattern_boss_' + (index + 1);
            const isFinal = index === deck.length - 1 && state.boss.phases === 3;
            patterns[patternId] = createPattern(patternType, state.boss.pressure, difficultySpec, styles, { isBossFinalPattern: isFinal });
            return patternId;
        });
        enemyTypes[state.boss.id] = createBossEnemy(state, bossPatternIds, difficultySpec, styles);
    }

    let objectiveType = 'defeat_count';
    if (base.mode === 'survive') {
        objectiveType = 'survive_time';
        objectives.push({
            id: 'survive_main',
            type: 'survive_time',
            title: 'Survive the pressure',
            target: lengthSeconds,
            required: true
        });
        const primaryWave = state.waves[0];
        const primaryEnemyId = primaryWave ? waveEnemyById.get(primaryWave.id) : null;
        const primaryPatternId = primaryWave ? wavePatternById.get(primaryWave.id) : null;
        const enter = [];
        if (primaryWave && primaryEnemyId) {
            enter.push({ type: 'show_banner', text: 'Hold for ' + lengthSeconds + ' seconds' });
            enter.push({ type: 'spawn_enemy', enemyType: primaryEnemyId, count: scaledWaveCount(primaryWave, difficultySpec), ...resolveSpawnSpec(primaryWave.spawn) });
        }
        const rules = [];
        const totalWaves = Math.max(1, state.waves.length);
        const segmentSeconds = Math.max(8, Math.floor(lengthSeconds / totalWaves));
        for (let i = 0; i < state.waves.length; i += 1) {
            const wave = state.waves[i];
            const patternId = wavePatternById.get(wave.id);
            const enemyTypeId = waveEnemyById.get(wave.id);
            const startAt = i === 0 ? 3 : Math.max(3, Math.floor((i * segmentSeconds) + 1));
            rules.push({
                when: { type: 'phase_elapsed', seconds: startAt },
                do: [{ type: 'spawn_enemy', enemyType: enemyTypeId, count: Math.max(1, Math.round(scaledWaveCount(wave, difficultySpec) * 0.75)), ...resolveSpawnSpec(wave.spawn) }]
            });
            if (patternId) {
                rules.push({
                    when: { type: 'phase_elapsed', seconds: Math.max(4, startAt + 2) },
                    do: [{ type: 'telegraph_then_fire', pattern: patternId, source: { type: 'random_arena' }, shape: 'circle', radius: 170, durationSeconds: 0.75, style: 'danger' }]
                });
            }
            if (wave.pressure === 'heavy') {
                const emitterId = 'emitter_' + wave.id;
                if (emitters[emitterId]) {
                    rules.push({
                        when: { type: 'phase_elapsed', seconds: Math.max(4, startAt + 1) },
                        do: [{ type: 'spawn_emitter', emitter: emitterId }]
                    });
                }
            }
            if (wave.pickup === 'heal') {
                rules.push({
                    when: { type: 'phase_elapsed', seconds: Math.max(6, startAt + Math.floor(segmentSeconds * 0.45)) },
                    do: [{ type: 'spawn_pickup', pickup: 'facade_heal_orb', at: { type: 'arena_center' } }]
                });
            } else if (wave.pickup === 'cooldown') {
                rules.push({
                    when: { type: 'phase_elapsed', seconds: Math.max(6, startAt + Math.floor(segmentSeconds * 0.45)) },
                    do: [{ type: 'spawn_pickup', pickup: 'facade_cooldown_orb', at: { type: 'arena_center' } }]
                });
            }
        }
        rules.push({ when: { type: 'objective_completed', objective: 'survive_main' }, do: [{ type: 'clear_emitters' }, { type: 'win' }] });
        if (primaryPatternId) {
            rules.push({
                when: { type: 'phase_elapsed', seconds: Math.max(5, Math.floor(lengthSeconds * 0.3)) },
                do: [{ type: 'telegraph_then_fire', pattern: primaryPatternId, source: { type: 'random_arena' }, shape: 'circle', radius: 190, durationSeconds: 0.8, style: 'danger' }]
            });
        }
        phases.push({
            id: 'survive',
            objective: 'Stay alive and dodge sustained pressure.',
            enter,
            rules
        });
    } else if (base.mode === 'waves') {
        objectiveType = 'defeat_count';
        const target = state.waves.reduce((sum, wave) => sum + scaledWaveCount(wave, difficultySpec), 0);
        objectives.push({
            id: 'waves_clear',
            type: 'defeat_count',
            title: 'Clear all waves',
            target: Math.max(1, target),
            required: true
        });
        for (let i = 0; i < state.waves.length; i += 1) {
            const wave = state.waves[i];
            phases.push(buildWavePhase(
                wave,
                i,
                state.waves.length,
                lengthSeconds,
                wavePatternById.get(wave.id),
                waveEnemyById.get(wave.id),
                difficultySpec,
                emitters['emitter_' + wave.id] ? 'emitter_' + wave.id : null
            ));
        }
        if (phases.length > 0) {
            const last = phases[phases.length - 1];
            last.rules.push({ when: { type: 'objective_completed', objective: 'waves_clear' }, do: [{ type: 'clear_emitters' }, { type: 'win' }] });
        }
    } else {
        objectiveType = 'defeat_boss';
        objectives.push({
            id: 'boss_down',
            type: 'defeat_boss',
            title: 'Defeat ' + state.boss.name,
            target: 1,
            required: true,
            enemyType: state.boss.id
        });
        if (state.waves.length > 0) {
            const setupWave = state.waves[0];
            const setupPatternId = wavePatternById.get(setupWave.id);
            const setupEnemyId = waveEnemyById.get(setupWave.id);
            phases.push({
                id: 'setup',
                objective: 'Break through the opening guard.',
                enter: [
                    { type: 'show_banner', text: 'Approach the boss' },
                    { type: 'spawn_enemy', enemyType: setupEnemyId, count: scaledWaveCount(setupWave, difficultySpec), ...resolveSpawnSpec(setupWave.spawn) }
                ],
                rules: [
                    { when: { type: 'phase_elapsed', seconds: 4 }, do: [{ type: 'telegraph_then_fire', pattern: setupPatternId, source: { type: 'random_arena' }, shape: 'circle', radius: 150, durationSeconds: 0.7, style: 'danger' }] },
                    { when: { type: 'all_enemies_defeated' }, do: [{ type: 'transition_phase', phase: 'boss' }] }
                ]
            });
        }

        const bossPhaseRules = [];
        const bossPressureSpec = PRESSURE_PRESETS[state.boss.pressure] || PRESSURE_PRESETS.medium;
        const bossDeck = Array.isArray(bossPatternIds) ? bossPatternIds : [];
        for (let i = 0; i < bossDeck.length; i += 1) {
            const patternId = bossDeck[i];
            const startAt = Math.max(3, 3 + (i * 2));
            bossPhaseRules.push({
                when: { type: 'phase_elapsed', seconds: startAt },
                repeat: { everySeconds: Number(bossPressureSpec.telegraphEverySeconds.toFixed(2)), limit: 30 },
                do: [{ type: 'telegraph_then_fire', pattern: patternId, source: { type: 'random_arena' }, shape: 'circle', radius: 185, durationSeconds: 0.75, style: 'danger' }]
            });
        }
        if (state.boss.adds !== 'none') {
            const addWave = state.waves.find((wave) => wave.enemy === 'chaser')
                || state.waves[0]
                || { id: 'boss_adds', enemy: 'chaser', count: state.boss.adds === 'medium' ? 'medium' : 'small', pressure: 'medium', pattern: 'fan', spawn: 'edge', pickup: 'none' };
            const addPatternType = addWave.pattern === 'auto' ? resolveAutoPattern(addWave) : addWave.pattern;
            const addPatternId = 'pattern_boss_adds';
            if (!patterns[addPatternId]) patterns[addPatternId] = createPattern(addPatternType, addWave.pressure, difficultySpec, styles);
            const addEnemyTypeId = 'enemy_boss_adds';
            if (!enemyTypes[addEnemyTypeId]) {
                enemyTypes[addEnemyTypeId] = buildWaveEnemyType(addWave, difficultySpec, addPatternId);
            }
            const addCount = state.boss.adds === 'medium' ? 2 : 1;
            bossPhaseRules.push({
                when: { type: 'phase_elapsed', seconds: 7 },
                repeat: { everySeconds: state.boss.adds === 'medium' ? 12 : 16, limit: 8 },
                do: [{ type: 'spawn_enemy', enemyType: addEnemyTypeId, count: addCount, ...resolveSpawnSpec('random') }]
            });
        }

        if (state.boss.pickup === 'heal' || state.boss.pickup === 'both') {
            bossPhaseRules.push({
                when: { type: 'phase_elapsed', seconds: Math.max(8, Math.floor(lengthSeconds * 0.35)) },
                do: [{ type: 'spawn_pickup', pickup: 'facade_heal_orb', at: { type: 'arena_center' } }]
            });
        }
        if (state.boss.pickup === 'cooldown' || state.boss.pickup === 'both') {
            bossPhaseRules.push({
                when: { type: 'phase_elapsed', seconds: Math.max(10, Math.floor(lengthSeconds * 0.52)) },
                do: [{ type: 'spawn_pickup', pickup: 'facade_cooldown_orb', at: { type: 'arena_center' } }]
            });
        }

        if (state.boss.phases === 3) {
            bossPhaseRules.push({
                when: { type: 'phase_elapsed', seconds: Math.max(9, Math.floor(lengthSeconds * 0.35)) },
                do: [{ type: 'show_banner', text: 'Boss phase 2' }]
            });
            bossPhaseRules.push({
                when: { type: 'phase_elapsed', seconds: Math.max(15, Math.floor(lengthSeconds * 0.67)) },
                do: [{ type: 'show_banner', text: 'Boss final phase' }]
            });
        } else {
            bossPhaseRules.push({
                when: { type: 'phase_elapsed', seconds: Math.max(11, Math.floor(lengthSeconds * 0.5)) },
                do: [{ type: 'show_banner', text: 'Boss final phase' }]
            });
        }

        bossPhaseRules.push({ when: { type: 'objective_completed', objective: 'boss_down' }, do: [{ type: 'clear_emitters' }, { type: 'win' }] });

        phases.push({
            id: 'boss',
            objective: 'Defeat ' + state.boss.name + '.',
            enter: [
                { type: 'show_banner', text: 'Boss: ' + state.boss.name },
                { type: 'spawn_enemy', enemyType: state.boss.id, count: 1, at: { x: 0, y: -120 } }
            ],
            rules: bossPhaseRules
        });
    }

    if (Object.values(pickups).length === 0) {
        pickups.facade_heal_orb = { id: 'facade_heal_orb', type: 'heal_orb', radius: 18, durationSeconds: 10 };
    }

    const backgroundColor = resolveArenaBackgroundColor(base);
    const encounter = {
        schemaVersion: 2,
        id: base.id,
        title: base.title,
        seed: base.seed || base.id,
        budgets: {
            maxEnemiesAlive: clamp(roundToInt(22 * difficultySpec.enemyCountMul, 22), 6, 60),
            maxEnemyBulletsAlive: clamp(roundToInt(360 * difficultySpec.bulletCountMul, 360), 80, 900),
            maxPlayerBulletsAlive: 140,
            maxEmittersAlive: 24,
            maxHazardsAlive: 0,
            maxPickupsAlive: 24,
            maxTelegraphsAlive: 80,
            maxActionsPerSecond: 120,
            maxEncounterSeconds: clamp(lengthSeconds + 20, 30, 220)
        },
        arena: {
            mapSize: 1500,
            gridSpacing: 96,
            shape: 'diamond',
            bounds: 'soft',
            backgroundColor,
            modifiers: []
        },
        runtimeSettings: {
            showDamageNumbers: false,
            enableMicroHitStop: true
        },
        player: {
            hp: 6 + (difficultySpec.playerHpBonus || 0)
        },
        playerKit: {
            id: 'default',
            maxHp: 6 + (difficultySpec.playerHpBonus || 0),
            moveSpeed: 4.5
        },
        patterns,
        enemyTypes,
        pickups,
        emitters,
        objectives,
        resultRules: [
            {
                id: 'low_hp_finish',
                when: { type: 'player_hp_below', ratio: 0.34 },
                tags: ['hard_won'],
                grade: 'desperate'
            }
        ],
        sequence: {
            startPhase: phases[0]?.id || 'opening',
            phases
        }
    };

    const summary = {
        presetVersion: 'encounter_facade_v1',
        mode: base.mode,
        length: base.length,
        lengthSeconds,
        difficulty: base.difficulty,
        styles: styles.slice(),
        waveCount: state.waves.length,
        bossId: state.boss?.id || null,
        objectiveType
    };

    return { encounter, summary };
}

function compileEncounterFacade(source, options = {}) {
    const cleanSource = stripFacadeMarkers(source);
    const parseState = parseFacade(cleanSource);
    let encounter = null;
    let expandedEncounterSummary = null;

    if (!hasErrors(parseState.diagnostics)) {
        const expanded = buildEncounterFromFacade(parseState);
        encounter = expanded.encounter;
        expandedEncounterSummary = expanded.summary;
        const validation = encounterSchema?.validateEncounterDefinition
            ? encounterSchema.validateEncounterDefinition(encounter, { capabilityProfile: 'v1', strictCapabilities: true })
            : { ok: true, encounter, warnings: [], errors: [] };

        for (const warning of (Array.isArray(validation?.warnings) ? validation.warnings : [])) {
            parseState.diagnostics.push(createDiagnostic('warning', 'TDSF-W900', String(warning || '')));
        }
        for (const error of (Array.isArray(validation?.errors) ? validation.errors : [])) {
            parseState.diagnostics.push(createDiagnostic('error', 'TDSF-E900', String(error || '')));
        }
    }

    const diagnostics = parseState.diagnostics.slice();
    const ok = !hasErrors(diagnostics) && !!encounter;
    if (!ok) encounter = null;

    return {
        ok,
        encounter,
        diagnostics,
        metadata: {
            compilerVersion: COMPILER_VERSION,
            scriptKind: 'encounter_facade_v1',
            sourceHash: stableHash(cleanSource),
            lineCount: cleanSource ? cleanSource.split('\n').length : 0,
            expandedEncounterSummary: expandedEncounterSummary || null,
            optionsUsed: {
                validate: options?.validate !== false
            }
        }
    };
}

module.exports = {
    COMPILER_VERSION,
    MARKER_START,
    MARKER_END,
    stripFacadeMarkers,
    stableHash,
    compileEncounterFacade
};

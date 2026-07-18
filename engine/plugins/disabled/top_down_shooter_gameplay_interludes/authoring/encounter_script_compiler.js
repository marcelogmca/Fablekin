const crypto = require('crypto');
const encounterSchema = require('../frontend/runtime/encounter_schema.js');
const capabilityProfileModule = require('../frontend/runtime/v1_capability_profile.js');

const COMPILER_VERSION = '1.0.0';
const MARKER_START = 'BEGIN_TDS_ENCOUNTER_SCRIPT';
const MARKER_END = 'END_TDS_ENCOUNTER_SCRIPT';
const V1_PROFILE = capabilityProfileModule?.profile || {};
const SUPPORTED_PATTERN_TYPES = new Set(Array.isArray(V1_PROFILE.patternTypes) ? V1_PROFILE.patternTypes : ['spiral', 'radial', 'fan', 'aimed', 'line', 'rain']);
const SAFE_BEHAVIORS = new Set(Array.isArray(V1_PROFILE.enemyBehaviors) ? V1_PROFILE.enemyBehaviors : [
    'chase_player',
    'stationary_turret',
    'keep_distance',
    'charge_telegraphed',
    'boss_anchor'
]);
const SUPPORTED_OBJECTIVE_TYPES = new Set(Array.isArray(V1_PROFILE.objectiveTypes) ? V1_PROFILE.objectiveTypes : ['survive_time', 'defeat_count', 'defeat_enemy_type', 'defeat_boss']);
const SUPPORTED_PICKUP_TYPES = new Set(Array.isArray(V1_PROFILE.pickupTypes) ? V1_PROFILE.pickupTypes : ['heal_orb', 'cooldown_reset']);
const SUPPORTED_ACTION_TYPES = new Set(Array.isArray(V1_PROFILE.actionTypes) ? V1_PROFILE.actionTypes : []);
const SUPPORTED_TRIGGER_TYPES = new Set(Array.isArray(V1_PROFILE.triggerTypes) ? V1_PROFILE.triggerTypes : []);
const BEHAVIOR_ALIASES = Object.freeze({
    chaser: 'chase_player',
    chase: 'chase_player',
    turret: 'stationary_turret',
    stationary: 'stationary_turret',
    boss: 'boss_anchor'
});

const COLOR_NAMES = Object.freeze({
    enemy_default_bullet: 0xff00cc,
    player_default_bullet: 0x00f2ff,
    pink: 0xff5dd8,
    red: 0xff4d68,
    orange: 0xff9c3a,
    yellow: 0xffd54a,
    green: 0x65ff9a,
    cyan: 0x40d4ff,
    blue: 0x59d6ff,
    violet: 0xb66cff,
    purple: 0xa564ff,
    white: 0xf6f3ff
});

const DEFAULT_PROJECTILES = Object.freeze({
    enemy_default_bullet: {
        team: 'enemy',
        damage: 1,
        radius: 8,
        lifeTicks: 320,
        vz: -0.05,
        color: 0xff00cc
    },
    player_default_bullet: {
        team: 'player',
        damage: 1,
        radius: 7,
        lifeTicks: 220,
        vz: -0.06,
        color: 0x00f2ff
    }
});

function stableHash(text) {
    return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 16);
}

function stripScriptMarkers(source) {
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
        code: String(code || 'TDSC-E000'),
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
            if (line[i] === '#') break;
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

function optionToken(options, keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
        const normalized = normalizeKey(key);
        if (Object.prototype.hasOwnProperty.call(options, normalized)) {
            return options[normalized].token;
        }
    }
    return null;
}

function parseNumberValue(value, fallback = null) {
    const n = Number(String(value || '').trim().replace(/%$/, ''));
    return Number.isFinite(n) ? n : fallback;
}

function parseIntegerValue(value, fallback = null) {
    const n = Number.parseInt(String(value || '').trim(), 10);
    return Number.isInteger(n) ? n : fallback;
}

function parseSeconds(value, fallback = null) {
    const raw = String(value || '').trim().toLowerCase();
    const match = raw.match(/^(-?\d+(?:\.\d+)?)(?:s|sec|secs|second|seconds)?$/);
    if (!match) return fallback;
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(value, fallback = false) {
    const raw = String(value || '').trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'on'].includes(raw)) return true;
    if (['false', 'no', 'n', '0', 'off'].includes(raw)) return false;
    return fallback;
}

function parseColor(value, fallback = null) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return fallback;
    if (Object.prototype.hasOwnProperty.call(COLOR_NAMES, raw)) return COLOR_NAMES[raw];
    if (/^0x[0-9a-f]{6}$/i.test(raw)) return Number.parseInt(raw.slice(2), 16);
    if (/^#[0-9a-f]{6}$/i.test(raw)) return Number.parseInt(raw.slice(1), 16);
    return fallback;
}

function ensureUnique(state, bucket, id, label, token) {
    if (!isValidId(id)) {
        pushDiagnostic(state, 'error', 'TDSC-E010', label + ' id "' + id + '" is invalid.', token, 'Use letters, numbers, underscores, hyphens, or colons, starting with a letter.');
        return false;
    }
    if (Object.prototype.hasOwnProperty.call(bucket, id)) {
        pushDiagnostic(state, 'error', 'TDSC-E011', 'Duplicate ' + label + ' id "' + id + '".', token, 'Each id must be unique within its definition type.');
        return false;
    }
    return true;
}

function buildState(source) {
    return {
        source,
        diagnostics: [],
        meta: {
            id: '',
            title: '',
            durationSeconds: 90,
            seed: ''
        },
        arena: {
            shape: 'diamond',
            mapSize: 1500,
            backgroundPreset: 'crimson_grid'
        },
        player: {
            hp: 6,
            kit: 'default'
        },
        projectiles: {
            enemy_default_bullet: { ...DEFAULT_PROJECTILES.enemy_default_bullet },
            player_default_bullet: { ...DEFAULT_PROJECTILES.player_default_bullet }
        },
        patterns: {},
        enemies: {},
        pickups: {},
        hazards: {},
        objectives: {},
        phases: [],
        currentPhase: null,
        hasWinAction: false
    };
}

function parseEncounterLine(state, tokens) {
    if (tokens.length < 2) {
        pushDiagnostic(state, 'error', 'TDSC-E020', 'encounter requires a title.', tokens[0], 'Example: encounter "Glass Ambush" id glass_ambush duration 90');
        return;
    }
    state.meta.title = String(tokens[1].value || '').trim();
    const { options } = parseOptions(tokens, 2);
    state.meta.id = sanitizeId(optionValue(options, 'id', state.meta.id));
    state.meta.durationSeconds = parseSeconds(optionValue(options, 'duration', state.meta.durationSeconds), state.meta.durationSeconds);
    state.meta.seed = String(optionValue(options, 'seed', state.meta.seed || state.meta.id || 'tds_generated_seed')).trim();
    if (!state.meta.id) {
        pushDiagnostic(state, 'error', 'TDSC-E021', 'encounter requires id.', tokens[0], 'Add: id your_encounter_id');
    } else if (!isValidId(state.meta.id)) {
        pushDiagnostic(state, 'error', 'TDSC-E022', 'Encounter id "' + state.meta.id + '" is invalid.', optionToken(options, 'id') || tokens[0]);
    }
    if (!Number.isFinite(state.meta.durationSeconds) || state.meta.durationSeconds < 15 || state.meta.durationSeconds > 600) {
        pushDiagnostic(state, 'error', 'TDSC-E023', 'encounter duration must be between 15 and 600 seconds.', optionToken(options, 'duration') || tokens[0]);
    }
}

function parseArenaLine(state, tokens) {
    const shape = String(tokens[1]?.value || state.arena.shape).trim().toLowerCase();
    const { options } = parseOptions(tokens, 2);
    state.arena.shape = shape;
    state.arena.mapSize = parseIntegerValue(optionValue(options, ['size', 'mapSize'], state.arena.mapSize), state.arena.mapSize);
    state.arena.backgroundPreset = String(optionValue(options, 'background', state.arena.backgroundPreset)).trim() || state.arena.backgroundPreset;
}

function parsePlayerLine(state, tokens) {
    const { options } = parseOptions(tokens, 1);
    state.player.hp = parseIntegerValue(optionValue(options, ['hp', 'health'], state.player.hp), state.player.hp);
    state.player.kit = String(optionValue(options, 'kit', state.player.kit)).trim() || 'default';
    if (state.player.hp < 1 || state.player.hp > 30) {
        pushDiagnostic(state, 'error', 'TDSC-E030', 'player hp must be between 1 and 30.', optionToken(options, ['hp', 'health']) || tokens[0]);
    }
}

function parseProjectileLine(state, tokens) {
    const id = sanitizeId(tokens[1]?.value);
    if (!ensureUnique(state, state.projectiles, id, 'projectile', tokens[1] || tokens[0])) return;
    const { options } = parseOptions(tokens, 2);
    const color = parseColor(optionValue(options, 'color', id), COLOR_NAMES.enemy_default_bullet);
    state.projectiles[id] = {
        team: String(optionValue(options, 'team', 'enemy')).toLowerCase() === 'player' ? 'player' : 'enemy',
        damage: Math.max(0, parseNumberValue(optionValue(options, 'damage', 1), 1)),
        radius: Math.max(2, parseNumberValue(optionValue(options, 'radius', 8), 8)),
        lifeTicks: Math.max(10, parseIntegerValue(optionValue(options, ['lifeTicks', 'life'], 320), 320)),
        vz: parseNumberValue(optionValue(options, 'vz', -0.05), -0.05),
        color
    };
}

function ensureProjectile(state, id, token = null) {
    const projectileId = sanitizeId(id || 'enemy_default_bullet');
    if (!projectileId) return 'enemy_default_bullet';
    if (state.projectiles[projectileId]) return projectileId;
    const color = parseColor(projectileId, COLOR_NAMES.enemy_default_bullet);
    state.projectiles[projectileId] = {
        ...DEFAULT_PROJECTILES.enemy_default_bullet,
        color
    };
    if (!Object.prototype.hasOwnProperty.call(COLOR_NAMES, projectileId)) {
        pushDiagnostic(state, 'warning', 'TDSC-W031', 'Projectile "' + projectileId + '" was auto-created with default enemy bullet settings.', token, 'Define it with: projectile ' + projectileId + ' color=#ff00cc');
    }
    return projectileId;
}

function parsePatternLine(state, tokens) {
    const id = sanitizeId(tokens[1]?.value);
    if (!ensureUnique(state, state.patterns, id, 'pattern', tokens[1] || tokens[0])) return;
    const type = String(tokens[2]?.value || '').trim().toLowerCase();
    if (!SUPPORTED_PATTERN_TYPES.has(type)) {
        pushDiagnostic(state, 'error', 'TDSC-E040', 'Unsupported pattern type "' + type + '".', tokens[2] || tokens[0], 'Allowed: ' + Array.from(SUPPORTED_PATTERN_TYPES).join(', '));
        return;
    }
    const { options } = parseOptions(tokens, 3);
    const projectileType = ensureProjectile(state, optionValue(options, 'projectile', 'enemy_default_bullet'), optionToken(options, 'projectile'));
    const aim = String(optionValue(options, 'aim', type === 'aimed' ? 'player' : '')).trim().toLowerCase();
    const pattern = {
        type,
        count: Math.max(1, parseIntegerValue(optionValue(options, 'count', type === 'line' ? 5 : 4), type === 'line' ? 5 : 4)),
        speed: Math.max(0.1, parseNumberValue(optionValue(options, 'speed', 3.2), 3.2)),
        spreadDegrees: Math.max(0, parseNumberValue(optionValue(options, ['spread', 'spreadDegrees'], type === 'radial' ? 360 : 48), type === 'radial' ? 360 : 48)),
        projectileType
    };
    if (optionValue(options, 'spacing', null) !== null) pattern.spacing = Math.max(0, parseNumberValue(optionValue(options, 'spacing'), 60));
    if (optionValue(options, 'width', null) !== null) pattern.width = Math.max(0, parseNumberValue(optionValue(options, 'width'), 900));
    if (optionValue(options, 'burst', null) !== null) pattern.burstCount = Math.max(1, parseIntegerValue(optionValue(options, 'burst'), 1));
    if (optionValue(options, 'burstEvery', null) !== null) pattern.burstIntervalSeconds = Math.max(0, parseSeconds(optionValue(options, 'burstEvery'), 0));
    if (aim === 'player' || aim === 'toward_player') pattern.aim = { type: 'toward_player' };
    state.patterns[id] = pattern;
}

function parseEnemyLine(state, tokens, forcedBoss = false) {
    const id = sanitizeId(tokens[1]?.value);
    if (!ensureUnique(state, state.enemies, id, forcedBoss ? 'boss' : 'enemy', tokens[1] || tokens[0])) return;
    const { options } = parseOptions(tokens, 2);
    const rawBehavior = String(optionValue(options, 'behavior', forcedBoss ? 'boss_anchor' : 'chase_player')).trim().toLowerCase();
    const behavior = BEHAVIOR_ALIASES[rawBehavior] || rawBehavior;
    if (!SAFE_BEHAVIORS.has(behavior)) {
        pushDiagnostic(state, 'error', 'TDSC-E050', 'Unsupported enemy behavior "' + behavior + '".', optionToken(options, 'behavior') || tokens[0], 'Use one of: ' + Array.from(SAFE_BEHAVIORS).join(', '));
        return;
    }
    const attackPatternId = sanitizeId(optionValue(options, ['attack', 'pattern'], 'enemy_spiral_pressure'));
    const everySeconds = parseSeconds(optionValue(options, 'every', 1.2), 1.2);
    const isBoss = forcedBoss || parseBoolean(optionValue(options, 'boss', false), false);
    const attackIds = String(optionValue(options, 'attacks', attackPatternId))
        .split(',')
        .map((item) => sanitizeId(item))
        .filter(Boolean);
    const enemy = {
        hp: Math.max(1, parseIntegerValue(optionValue(options, 'hp', isBoss ? 90 : 10), isBoss ? 90 : 10)),
        radius: Math.max(6, parseNumberValue(optionValue(options, 'radius', isBoss ? 34 : 22), isBoss ? 34 : 22)),
        speed: Math.max(0.05, parseNumberValue(optionValue(options, 'speed', isBoss ? 0.95 : 1.25), isBoss ? 0.95 : 1.25)),
        behavior,
        attackPatternId,
        attackIntervalMs: Math.max(120, Math.round(everySeconds * 1000)),
        attacks: attackIds.map((patternId, index) => ({
            id: 'attack_' + (index + 1),
            pattern: patternId,
            everySeconds,
            weight: 1
        }))
    };
    if (isBoss) {
        const phaseCount = Math.max(1, Math.min(5, parseIntegerValue(optionValue(options, 'phases', 3), 3)));
        const noRepeatWindow = Math.max(0, Math.min(10, parseIntegerValue(optionValue(options, ['noRepeatWindow', 'noRepeat'], 1), 1)));
        enemy.boss = true;
        enemy.bossId = String(optionValue(options, 'bossId', id)).trim() || id;
        enemy.displayName = String(optionValue(options, ['name', 'displayName'], id)).trim() || id;
        enemy.bossSubtitle = String(optionValue(options, ['subtitle', 'title'], '')).trim();
        enemy.bossPhases = [];
        for (let i = 0; i < phaseCount; i += 1) {
            const untilHpRatio = i < phaseCount - 1 ? Number(((phaseCount - i - 1) / phaseCount).toFixed(2)) : null;
            enemy.bossPhases.push({
                id: 'phase_' + (i + 1),
                untilHpRatio,
                attackDeckMode: 'weighted_deck',
                attackDeck: attackIds.slice(),
                noRepeatWindow
            });
        }
    }
    state.enemies[id] = enemy;
}

function parsePickupLine(state, tokens) {
    const id = sanitizeId(tokens[1]?.value);
    if (!ensureUnique(state, state.pickups, id, 'pickup', tokens[1] || tokens[0])) return;
    const kind = String(tokens[2]?.value || 'heal').trim().toLowerCase();
    const { options } = parseOptions(tokens, 3);
    const typeByKind = {
        heal: 'heal_orb',
        healing: 'heal_orb',
        cooldown: 'cooldown_reset',
        reset: 'cooldown_reset',
        shield: 'shield_pickup',
        charge: 'charge_pickup',
        ammo: 'ammo_pickup'
    };
    const type = typeByKind[kind] || kind;
    if (!SUPPORTED_PICKUP_TYPES.has(type)) {
        pushDiagnostic(
            state,
            'error',
            'TDSC-E055',
            'Unsupported pickup type "' + type + '" for V1.',
            tokens[2] || tokens[0],
            'Use pickup kinds: heal, cooldown.'
        );
        return;
    }
    state.pickups[id] = {
        id,
        type,
        radius: Math.max(4, parseNumberValue(optionValue(options, 'radius', 20), 20)),
        durationSeconds: Math.max(0.2, parseSeconds(optionValue(options, 'duration', 12), 12)),
        dropWeight: Math.max(0, parseNumberValue(optionValue(options, 'weight', 1), 1))
    };
    const statusOnPickup = optionValue(options, 'status', '');
    if (statusOnPickup) state.pickups[id].statusOnPickup = String(statusOnPickup).trim();
}

function parseHazardLine(state, tokens) {
    pushDiagnostic(
        state,
        'error',
        'TDSC-E062',
        'hazard definitions are disabled in V1.',
        tokens[0],
        'Use bullet patterns, enemy waves, telegraphs, or emitters for pressure.'
    );
}

function parseObjectiveLine(state, tokens) {
    const id = sanitizeId(tokens[1]?.value);
    if (!ensureUnique(state, state.objectives, id, 'objective', tokens[1] || tokens[0])) return;
    const kind = String(tokens[2]?.value || '').trim().toLowerCase();
    const { options } = parseOptions(tokens, 4);
    const targetToken = tokens[3] || optionToken(options, ['target', 'count', 'duration']);
    const rawTarget = tokens[3]?.value || optionValue(options, ['target', 'count', 'duration'], null);
    let objective = null;
    if (kind === 'survive') {
        const seconds = parseSeconds(rawTarget, null);
        if (!Number.isFinite(seconds) || seconds <= 0) {
            pushDiagnostic(state, 'error', 'TDSC-E060', 'survive objective requires a positive duration.', targetToken || tokens[0], 'Example: objective hold survive 45s');
            return;
        }
        objective = { id, type: 'survive_time', title: String(optionValue(options, 'title', 'Survive')), target: seconds, required: true };
    } else if (kind === 'defeat') {
        const target = Math.max(1, parseIntegerValue(rawTarget, parseIntegerValue(optionValue(options, 'count', 1), 1)));
        const enemyType = sanitizeId(optionValue(options, 'enemy', ''));
        objective = {
            id,
            type: enemyType ? 'defeat_enemy_type' : 'defeat_count',
            title: String(optionValue(options, 'title', enemyType ? 'Defeat ' + enemyType : 'Defeat enemies')),
            target,
            required: true
        };
        if (enemyType) objective.enemyType = enemyType;
    } else if (kind === 'boss') {
        const bossId = sanitizeId(rawTarget || optionValue(options, 'enemy', ''));
        objective = {
            id,
            type: 'defeat_boss',
            title: String(optionValue(options, 'title', 'Defeat the boss')),
            target: 1,
            required: true,
            enemyType: bossId
        };
    } else {
        pushDiagnostic(state, 'error', 'TDSC-E061', 'Unsupported objective type "' + kind + '".', tokens[2] || tokens[0], 'Allowed: survive, defeat, boss.');
        return;
    }
    if (parseBoolean(optionValue(options, 'optional', false), false)) {
        objective.required = false;
        objective.optional = true;
    }
    state.objectives[id] = objective;
}

function parsePhaseLine(state, tokens) {
    const id = sanitizeId(tokens[1]?.value);
    if (!isValidId(id)) {
        pushDiagnostic(state, 'error', 'TDSC-E070', 'Invalid phase id "' + id + '".', tokens[1] || tokens[0]);
        return;
    }
    if (state.phases.some((phase) => phase.id === id)) {
        pushDiagnostic(state, 'error', 'TDSC-E071', 'Duplicate phase id "' + id + '".', tokens[1] || tokens[0]);
        return;
    }
    const range = String(tokens[2]?.value || '').trim();
    const rangeMatch = range.match(/^(\d+(?:\.\d+)?)\.\.(\d+(?:\.\d+)?)$/);
    if (!rangeMatch) {
        pushDiagnostic(state, 'error', 'TDSC-E072', 'phase requires a start..end range.', tokens[2] || tokens[0], 'Example: phase opening 0..25');
        return;
    }
    const startSeconds = Number(rangeMatch[1]);
    const endSeconds = Number(rangeMatch[2]);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
        pushDiagnostic(state, 'error', 'TDSC-E073', 'phase range must end after it starts.', tokens[2] || tokens[0]);
        return;
    }
    const phase = {
        id,
        startSeconds,
        endSeconds,
        objective: '',
        enter: [],
        rules: []
    };
    state.phases.push(phase);
    state.currentPhase = phase;
}

function sourceFromOptions(options, fallback = { type: 'arena_center' }) {
    const x = parseNumberValue(optionValue(options, 'x', null), null);
    const y = parseNumberValue(optionValue(options, 'y', null), null);
    if (Number.isFinite(x) || Number.isFinite(y)) return { type: 'fixed_point', x: x || 0, y: y || 0 };
    const at = String(optionValue(options, ['at', 'from', 'source'], '')).trim().toLowerCase();
    if (at === 'center' || at === 'arena_center') return { type: 'arena_center' };
    if (at === 'edge' || at === 'arena_edge') return { type: 'arena_edge' };
    if (at === 'random' || at === 'random_arena') return { type: 'random_arena' };
    if (at === 'player') return { type: 'player' };
    return fallback;
}

function spawnAtForEnemy(options) {
    const x = parseNumberValue(optionValue(options, 'x', null), null);
    const y = parseNumberValue(optionValue(options, 'y', null), null);
    if (Number.isFinite(x) || Number.isFinite(y)) return { at: { x: x || 0, y: y || 0 } };
    const at = String(optionValue(options, 'at', '')).trim().toLowerCase();
    if (at === 'edge' || at === 'ring') return { formation: 'left_right' };
    if (at === 'random') return { formation: 'random' };
    if (at === 'center') return { at: { x: 0, y: 0 } };
    return {};
}

function parseAction(state, tokens) {
    if (!tokens.length) return null;
    const verb = String(tokens[0].value || '').trim().toLowerCase();
    if (verb === 'banner') {
        const text = tokens.slice(1).map((token) => token.value).join(' ').trim();
        return { type: 'show_banner', text };
    }
    if (verb === 'music') {
        pushDiagnostic(
            state,
            'error',
            'TDSC-E082',
            'music actions are disabled in V1.',
            tokens[0],
            'Use banners, telegraphs, waves, and pattern cadence for escalation.'
        );
        return null;
    }
    if (verb === 'spawn') {
        const enemyType = sanitizeId(tokens[1]?.value);
        const { options } = parseOptions(tokens, 2);
        return {
            type: 'spawn_enemy',
            enemyType,
            count: Math.max(1, parseIntegerValue(optionValue(options, 'count', 1), 1)),
            ...spawnAtForEnemy(options)
        };
    }
    if (verb === 'fire') {
        const pattern = sanitizeId(tokens[1]?.value);
        const { options } = parseOptions(tokens, 2);
        const source = sourceFromOptions(options, { type: 'arena_center' });
        return { type: 'fire_pattern', pattern, source };
    }
    if (verb === 'telegraph') {
        const sub = String(tokens[1]?.value || '').trim().toLowerCase();
        if (sub !== 'fire') {
            pushDiagnostic(state, 'error', 'TDSC-E080', 'telegraph only supports "telegraph fire <pattern>".', tokens[1] || tokens[0]);
            return null;
        }
        const pattern = sanitizeId(tokens[2]?.value);
        const { options } = parseOptions(tokens, 3);
        return {
            type: 'telegraph_then_fire',
            pattern,
            source: sourceFromOptions(options, { type: 'arena_center' }),
            shape: String(optionValue(options, 'shape', 'circle')).toLowerCase(),
            radius: Math.max(16, parseNumberValue(optionValue(options, 'radius', 180), 180)),
            durationSeconds: Math.max(0.15, parseSeconds(optionValue(options, ['duration', 'telegraph'], 0.7), 0.7)),
            style: 'danger'
        };
    }
    if (verb === 'pickup') {
        const pickup = sanitizeId(tokens[1]?.value);
        const { options } = parseOptions(tokens, 2);
        return { type: 'spawn_pickup', pickup, at: sourceFromOptions(options, { type: 'arena_center' }) };
    }
    if (verb === 'hazard') {
        pushDiagnostic(
            state,
            'error',
            'TDSC-E083',
            'hazard actions are disabled in V1.',
            tokens[0],
            'Use telegraph fire, fire, enemy waves, or emitters.'
        );
        return null;
    }
    if (verb === 'clear') {
        const target = String(tokens[1]?.value || '').trim().toLowerCase();
        if (target === 'hazards') {
            pushDiagnostic(state, 'error', 'TDSC-E084', 'clear hazards is disabled in V1.', tokens[1] || tokens[0]);
            return null;
        }
        if (target === 'pickups') return { type: 'clear_pickups' };
        if (target === 'emitters') return { type: 'clear_emitters' };
        if (target === 'telegraphs') return { type: 'clear_telegraphs' };
    }
    if (verb === 'objective') {
        const objective = sanitizeId(tokens[1]?.value);
        const sub = String(tokens[2]?.value || '').trim().toLowerCase();
        if (sub === 'complete') return { type: 'complete_objective', objective };
        if (sub === 'fail') return { type: 'fail_objective', objective };
        if (sub === 'activate') return { type: 'activate_objective', objective };
    }
    if (verb === 'goto') return { type: 'transition_phase', phase: sanitizeId(tokens[1]?.value) };
    if (verb === 'win') {
        state.hasWinAction = true;
        return { type: 'win' };
    }
    if (verb === 'set' && String(tokens[1]?.value || '').toLowerCase() === 'flag') {
        pushDiagnostic(state, 'error', 'TDSC-E085', 'flag actions are disabled in V1.', tokens[0], 'Use phases and simple objective/trigger rules.');
        return null;
    }
    if (verb === 'add' && String(tokens[1]?.value || '').toLowerCase() === 'counter') {
        pushDiagnostic(state, 'error', 'TDSC-E086', 'counter actions are disabled in V1.', tokens[0], 'Use phase transitions, timers, and objective triggers.');
        return null;
    }
    pushDiagnostic(state, 'error', 'TDSC-E081', 'Unknown action "' + verb + '".', tokens[0], 'Use spawn, fire, telegraph fire, pickup, banner, clear pickups/emitters/telegraphs, objective actions, goto, or win.');
    return null;
}

function parseWhenRule(state, phase, tokens) {
    const subject = String(tokens[1]?.value || '').trim().toLowerCase();
    let cursor = 2;
    let when = null;
    if (subject === 'objective') {
        const objective = sanitizeId(tokens[cursor]?.value);
        const status = String(tokens[cursor + 1]?.value || '').trim().toLowerCase();
        cursor += 2;
        if (status === 'complete' || status === 'completed') when = { type: 'objective_completed', objective };
        else if (status === 'fail' || status === 'failed') when = { type: 'objective_failed', objective };
    } else if (subject === 'all' && String(tokens[2]?.value || '').toLowerCase() === 'enemies' && String(tokens[3]?.value || '').toLowerCase() === 'defeated') {
        when = { type: 'all_enemies_defeated' };
        cursor = 4;
    } else if (subject === 'time') {
        when = { type: 'time_elapsed', seconds: parseSeconds(tokens[cursor]?.value, 0) };
        cursor += 1;
    } else if (subject === 'phase') {
        when = { type: 'phase_elapsed', seconds: parseSeconds(tokens[cursor]?.value, 0) };
        cursor += 1;
    } else if (subject === 'defeated') {
        const enemyType = sanitizeId(tokens[cursor]?.value);
        const { options } = parseOptions(tokens, cursor + 1);
        when = { type: 'enemy_type_defeated_count', enemyType, count: Math.max(1, parseIntegerValue(optionValue(options, 'count', 1), 1)) };
        cursor = tokens.length - 1;
    } else if (subject === 'boss') {
        const enemyType = sanitizeId(tokens[cursor]?.value);
        when = { type: 'enemy_type_defeated_count', enemyType, count: 1 };
        cursor += 2;
    }
    if (!when) {
        pushDiagnostic(state, 'error', 'TDSC-E090', 'Unsupported when condition.', tokens[0], 'Example: when objective hold complete win');
        return;
    }
    const actionTokens = tokens.slice(cursor);
    const action = parseAction(state, actionTokens);
    if (!action) return;
    phase.rules.push({ when, do: [action] });
}

function parsePhaseBodyLine(state, tokens) {
    const phase = state.currentPhase;
    if (!phase) {
        pushDiagnostic(state, 'error', 'TDSC-E100', 'Phase action appears before any phase declaration.', tokens[0], 'Add a line like: phase opening 0..30');
        return;
    }
    const keyword = String(tokens[0].value || '').trim().toLowerCase();
    if (keyword === 'start') {
        const action = parseAction(state, tokens.slice(1));
        if (action) phase.enter.push(action);
        return;
    }
    if (keyword === 'after') {
        const seconds = parseSeconds(tokens[1]?.value, null);
        if (!Number.isFinite(seconds) || seconds < 0) {
            pushDiagnostic(state, 'error', 'TDSC-E101', 'after requires a non-negative duration.', tokens[1] || tokens[0]);
            return;
        }
        const action = parseAction(state, tokens.slice(2));
        if (action) phase.rules.push({ when: { type: 'phase_elapsed', seconds }, do: [action] });
        return;
    }
    if (keyword === 'every') {
        const seconds = parseSeconds(tokens[1]?.value, null);
        if (!Number.isFinite(seconds) || seconds <= 0) {
            pushDiagnostic(state, 'error', 'TDSC-E102', 'every requires a positive duration.', tokens[1] || tokens[0]);
            return;
        }
        const action = parseAction(state, tokens.slice(2));
        if (action) phase.rules.push({
            when: { type: 'phase_elapsed', seconds },
            repeat: { everySeconds: seconds },
            do: [action]
        });
        return;
    }
    if (keyword === 'when') {
        parseWhenRule(state, phase, tokens);
        return;
    }
    pushDiagnostic(state, 'error', 'TDSC-E103', 'Unknown phase directive "' + keyword + '".', tokens[0], 'Use start, after, every, or when.');
}

function parseScript(source) {
    const cleanSource = stripScriptMarkers(source);
    const state = buildState(cleanSource);
    const lines = cleanSource.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const lineNumber = i + 1;
        const tokens = tokenizeLine(lines[i], lineNumber);
        if (tokens.length === 0) continue;
        const unclosed = tokens.find((token) => token.closed === false);
        if (unclosed) {
            pushDiagnostic(state, 'error', 'TDSC-E001', 'Unclosed quoted string.', unclosed);
            continue;
        }
        const command = String(tokens[0].value || '').trim().toLowerCase();
        if (command === 'encounter') parseEncounterLine(state, tokens);
        else if (command === 'arena') parseArenaLine(state, tokens);
        else if (command === 'player') parsePlayerLine(state, tokens);
        else if (command === 'projectile') parseProjectileLine(state, tokens);
        else if (command === 'pattern') parsePatternLine(state, tokens);
        else if (command === 'enemy') parseEnemyLine(state, tokens, false);
        else if (command === 'boss') parseEnemyLine(state, tokens, true);
        else if (command === 'pickup') parsePickupLine(state, tokens);
        else if (command === 'hazard') parseHazardLine(state, tokens);
        else if (command === 'objective') parseObjectiveLine(state, tokens);
        else if (command === 'phase') parsePhaseLine(state, tokens);
        else parsePhaseBodyLine(state, tokens);
    }
    return state;
}

function validateStateAgainstV1Profile(state) {
    for (const [objectiveId, objective] of Object.entries(state.objectives || {})) {
        const objectiveType = String(objective?.type || '').toLowerCase();
        if (!objectiveType || SUPPORTED_OBJECTIVE_TYPES.has(objectiveType)) continue;
        pushDiagnostic(
            state,
            'error',
            'TDSC-E160',
            'Objective "' + objectiveId + '" uses unsupported V1 type "' + objectiveType + '".',
            null,
            'Allowed: survive_time, defeat_count, defeat_enemy_type, defeat_boss.'
        );
    }

    for (const [pickupId, pickup] of Object.entries(state.pickups || {})) {
        const pickupType = String(pickup?.type || '').toLowerCase();
        if (!pickupType || SUPPORTED_PICKUP_TYPES.has(pickupType)) continue;
        pushDiagnostic(
            state,
            'error',
            'TDSC-E161',
            'Pickup "' + pickupId + '" uses unsupported V1 type "' + pickupType + '".',
            null,
            'Allowed pickup types: heal_orb, cooldown_reset.'
        );
    }

    for (const phase of (Array.isArray(state.phases) ? state.phases : [])) {
        const phaseId = String(phase?.id || '');
        const actions = [
            ...(Array.isArray(phase?.enter) ? phase.enter : []),
            ...((Array.isArray(phase?.rules) ? phase.rules : []).flatMap((rule) => Array.isArray(rule?.do) ? rule.do : []))
        ];
        for (const action of actions) {
            const type = String(action?.type || '').toLowerCase();
            if (!type || SUPPORTED_ACTION_TYPES.size === 0 || SUPPORTED_ACTION_TYPES.has(type)) continue;
            pushDiagnostic(
                state,
                'error',
                'TDSC-E162',
                'Action "' + type + '" in phase "' + phaseId + '" is disabled in V1.',
                null
            );
        }
        for (const rule of (Array.isArray(phase?.rules) ? phase.rules : [])) {
            const whenType = String(rule?.when?.type || '').toLowerCase();
            if (!whenType || SUPPORTED_TRIGGER_TYPES.size === 0 || SUPPORTED_TRIGGER_TYPES.has(whenType)) continue;
            pushDiagnostic(
                state,
                'error',
                'TDSC-E163',
                'Trigger "' + whenType + '" in phase "' + phaseId + '" is disabled in V1.',
                null
            );
        }
    }
}

function validateStateReferences(state) {
    if (!state.meta.id) pushDiagnostic(state, 'error', 'TDSC-E110', 'Missing encounter line.', null, 'Add an encounter declaration at the top.');
    if (state.phases.length === 0) pushDiagnostic(state, 'error', 'TDSC-E111', 'No phases declared.', null, 'Add at least one phase.');
    if (!state.hasWinAction) {
        pushDiagnostic(state, 'error', 'TDSC-E112', 'No explicit win action found.', null, 'Add a line like: when objective main complete win');
    }
    if (Object.keys(state.patterns).length === 0) {
        state.patterns.enemy_spiral_pressure = {
            type: 'spiral',
            count: 4,
            speed: 3.5,
            spreadDegrees: 48,
            projectileType: 'enemy_default_bullet',
            aim: { type: 'toward_player' }
        };
    } else if (!state.patterns.enemy_spiral_pressure) {
        const firstPattern = Object.keys(state.patterns)[0];
        state.patterns.enemy_spiral_pressure = { ...state.patterns[firstPattern] };
    }
    for (const [enemyId, enemy] of Object.entries(state.enemies)) {
        const refs = [enemy.attackPatternId, ...(Array.isArray(enemy.attacks) ? enemy.attacks.map((attack) => attack.pattern) : [])];
        for (const patternId of refs) {
            if (patternId && !state.patterns[patternId]) {
                pushDiagnostic(state, 'error', 'TDSC-E120', 'Enemy "' + enemyId + '" references unknown pattern "' + patternId + '".');
            }
        }
    }
    for (const phase of state.phases) {
        const duration = phase.endSeconds - phase.startSeconds;
        if (duration <= 0) {
            pushDiagnostic(state, 'error', 'TDSC-E130', 'Phase "' + phase.id + '" has invalid timing.');
        }
        const actions = [
            ...(Array.isArray(phase.enter) ? phase.enter : []),
            ...phase.rules.flatMap((rule) => Array.isArray(rule.do) ? rule.do : [])
        ];
        for (const action of actions) {
            const type = String(action?.type || '');
            if (type === 'spawn_enemy' && !state.enemies[action.enemyType]) {
                pushDiagnostic(state, 'error', 'TDSC-E140', 'Action references unknown enemy "' + String(action.enemyType || '') + '".');
            }
            if ((type === 'fire_pattern' || type === 'telegraph_then_fire') && !state.patterns[action.pattern]) {
                pushDiagnostic(state, 'error', 'TDSC-E141', 'Action references unknown pattern "' + String(action.pattern || '') + '".');
            }
            if (type === 'spawn_pickup' && !state.pickups[action.pickup]) {
                pushDiagnostic(state, 'error', 'TDSC-E142', 'Action references unknown pickup "' + String(action.pickup || '') + '".');
            }
            if (type === 'spawn_hazard' && !state.hazards[action.hazard]) {
                pushDiagnostic(state, 'error', 'TDSC-E143', 'Action references unknown hazard "' + String(action.hazard || '') + '".');
            }
            if ((type === 'complete_objective' || type === 'fail_objective' || type === 'activate_objective') && !state.objectives[action.objective]) {
                pushDiagnostic(state, 'error', 'TDSC-E144', 'Action references unknown objective "' + String(action.objective || '') + '".');
            }
            if (type === 'transition_phase' && !state.phases.some((phaseItem) => phaseItem.id === action.phase)) {
                pushDiagnostic(state, 'error', 'TDSC-E145', 'Action transitions to unknown phase "' + String(action.phase || '') + '".');
            }
        }
    }
    for (let i = 1; i < state.phases.length; i += 1) {
        const previous = state.phases[i - 1];
        const current = state.phases[i];
        if (current.startSeconds < previous.endSeconds) {
            pushDiagnostic(state, 'error', 'TDSC-E150', 'Phase "' + current.id + '" overlaps previous phase "' + previous.id + '".');
        }
    }
}

function withGeneratedTransitions(state) {
    const phases = state.phases.map((phase) => ({
        id: phase.id,
        objective: phase.objective || buildPhaseObjectiveText(state, phase),
        enter: phase.enter.slice(),
        rules: phase.rules.slice()
    }));
    for (let i = 0; i < phases.length - 1; i += 1) {
        const original = state.phases[i];
        const duration = Math.max(0.1, original.endSeconds - original.startSeconds);
        phases[i].rules.push({
            when: { type: 'phase_elapsed', seconds: duration },
            do: [{ type: 'transition_phase', phase: phases[i + 1].id }]
        });
    }
    return phases;
}

function buildPhaseObjectiveText(state, phase) {
    const firstRequired = Object.values(state.objectives).find((objective) => objective.required !== false);
    if (firstRequired?.title) return firstRequired.title;
    return 'Survive phase ' + phase.id;
}

function buildEncounter(state) {
    const durationSeconds = Math.max(
        state.meta.durationSeconds,
        ...state.phases.map((phase) => phase.endSeconds)
    );
    const encounter = {
        schemaVersion: 2,
        id: state.meta.id,
        title: state.meta.title || state.meta.id,
        seed: state.meta.seed || state.meta.id,
        budgets: {
            maxEnemiesAlive: 24,
            maxEnemyBulletsAlive: 420,
            maxPlayerBulletsAlive: 140,
            maxEmittersAlive: 24,
            maxHazardsAlive: 80,
            maxPickupsAlive: 24,
            maxTelegraphsAlive: 80,
            maxActionsPerSecond: 160,
            maxEncounterSeconds: Math.ceil(durationSeconds)
        },
        arena: {
            mapSize: state.arena.mapSize,
            gridSpacing: 100,
            shape: state.arena.shape,
            bounds: 'soft',
            backgroundPreset: state.arena.backgroundPreset,
            modifiers: []
        },
        runtimeSettings: {
            showDamageNumbers: false,
            enableMicroHitStop: true
        },
        player: {
            hp: state.player.hp
        },
        playerKit: {
            id: state.player.kit,
            maxHp: state.player.hp,
            moveSpeed: 4.5
        },
        projectileTypes: state.projectiles,
        patterns: Object.keys(state.patterns).length > 0 ? state.patterns : {
            enemy_spiral_pressure: {
                type: 'spiral',
                count: 4,
                speed: 3.5,
                spreadDegrees: 48,
                projectileType: 'enemy_default_bullet',
                aim: { type: 'toward_player' }
            }
        },
        enemyTypes: state.enemies,
        pickups: state.pickups,
        objectives: Object.values(state.objectives),
        resultRules: [
            {
                id: 'low_hp_finish',
                when: { type: 'player_hp_below', ratio: 0.34 },
                tags: ['hard_won'],
                grade: 'desperate'
            },
            {
                id: 'long_fight',
                when: { type: 'duration_above', seconds: Math.max(30, Math.floor(durationSeconds * 0.8)) },
                tag: 'attrition_victory'
            }
        ],
        sequence: {
            startPhase: state.phases[0]?.id || 'opening',
            phases: withGeneratedTransitions(state)
        }
    };
    return encounter;
}

function appendSchemaDiagnostics(state, validation) {
    for (const message of Array.isArray(validation?.errors) ? validation.errors : []) {
        const raw = String(message || '');
        const match = raw.match(/^(TDSV-[EW]\d+):\s*(.*)$/);
        pushDiagnostic(state, 'error', match?.[1] || 'TDSC-E900', match?.[2] || raw);
    }
    for (const message of Array.isArray(validation?.warnings) ? validation.warnings : []) {
        const raw = String(message || '');
        const match = raw.match(/^(TDSV-[EW]\d+):\s*(.*)$/);
        pushDiagnostic(state, 'warning', match?.[1] || 'TDSC-W900', match?.[2] || raw);
    }
}

function compileEncounterScript(source, options = {}) {
    const cleanSource = stripScriptMarkers(source);
    const state = parseScript(cleanSource);
    validateStateReferences(state);
    validateStateAgainstV1Profile(state);
    let encounter = null;
    if (!hasErrors(state.diagnostics)) {
        encounter = buildEncounter(state);
        if (options.validate !== false && encounterSchema?.validateEncounterDefinition) {
            const validation = encounterSchema.validateEncounterDefinition(encounter, {
                capabilityProfile: 'v1',
                strictCapabilities: true
            });
            appendSchemaDiagnostics(state, validation);
            if (validation?.encounter) encounter = validation.encounter;
        }
    }
    const diagnostics = state.diagnostics.slice();
    return {
        ok: !hasErrors(diagnostics),
        encounter: !hasErrors(diagnostics) ? encounter : null,
        diagnostics,
        metadata: {
            compilerVersion: COMPILER_VERSION,
            sourceHash: stableHash(cleanSource),
            lineCount: cleanSource ? cleanSource.split('\n').length : 0
        }
    };
}

module.exports = {
    COMPILER_VERSION,
    MARKER_START,
    MARKER_END,
    compileEncounterScript,
    stripScriptMarkers,
    stableHash
};

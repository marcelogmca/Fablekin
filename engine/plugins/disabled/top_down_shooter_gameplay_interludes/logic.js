const fs = require('fs');
const path = require('path');
const { generateEncounterFromScene } = require('./authoring/encounter_generation.js');
const { compileEncounterFacade } = require('./authoring/encounter_facade_compiler.js');

const PLUGIN_ID = 'top_down_shooter_gameplay_interludes';
const MAIN_INTERCEPT_ID_PREFIX = 'top_down_shooter_gameplay_interludes_combat_overlay_turn_';
const REGENERATE_ENCOUNTER_EVENT = PLUGIN_ID + ':regenerate-encounter';

const UI_HTML_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'templates', 'overlay.html'), 'utf8');
const UI_CSS_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'styles', 'overlay.css'), 'utf8');
const UI_COMBAT_SCENE_RUNTIME_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'combat_scene_runtime.js'), 'utf8');
const UI_INPUT_CONTROLLER_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'input_controller.js'), 'utf8');
const UI_ENTITY_MANAGER_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'entity_manager.js'), 'utf8');
const UI_RENDERER_LAYERS_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'renderer_layers.js'), 'utf8');
const UI_EVENT_BUS_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'event_bus.js'), 'utf8');
const UI_RNG_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'rng.js'), 'utf8');
const UI_PLAYER_RUNTIME_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'player_runtime.js'), 'utf8');
const UI_AUDIO_CONTROLLER_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'audio_controller.js'), 'utf8');
const UI_V1_CAPABILITY_PROFILE_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'v1_capability_profile.js'), 'utf8');
const UI_ENCOUNTER_SCHEMA_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'encounter_schema.js'), 'utf8');
const UI_EXAMPLE_ENCOUNTER_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'encounters', 'example_encounter.js'), 'utf8');
const UI_BASIC_WAVE_CLEAR_EXAMPLE_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'encounters', 'basic_wave_clear_example.js'), 'utf8');
const UI_SURVIVE_TIMER_EXAMPLE_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'encounters', 'survive_timer_example.js'), 'utf8');
const UI_BOSS_DUEL_EXAMPLE_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'encounters', 'boss_duel_example.js'), 'utf8');
const UI_PROJECTILE_SHOWCASE_EXAMPLE_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'encounters', 'projectile_showcase_example.js'), 'utf8');
const UI_ENCOUNTER_LOADER_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'encounter_loader.js'), 'utf8');
const UI_PATTERN_REGISTRY_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'patterns', 'pattern_registry.js'), 'utf8');
const UI_ACTION_REGISTRY_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'registries', 'action_registry.js'), 'utf8');
const UI_TRIGGER_REGISTRY_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'registries', 'trigger_registry.js'), 'utf8');
const UI_BEHAVIOR_REGISTRY_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'registries', 'behavior_registry.js'), 'utf8');
const UI_ENEMY_RUNTIME_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'enemy_runtime.js'), 'utf8');
const UI_SEQUENCE_RUNNER_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'sequence_runner.js'), 'utf8');
const UI_RESULT_BUILDER_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'result_builder.js'), 'utf8');
const UI_COMBAT_RUNTIME_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'combat_runtime.js'), 'utf8');
const UI_SHOOTER_RUNTIME_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'runtime', 'shooter_game_runtime.js'), 'utf8');
const UI_JS_TEMPLATE = fs.readFileSync(path.join(__dirname, 'frontend', 'overlay', 'ui_controller.js'), 'utf8');
const DEFAULT_ENCOUNTER_ID = 'tds_glass_ambush_v1';
const FORCED_DEBUG_ENCOUNTER_FACADE_PATH = path.join(__dirname, 'encounter_debug_test.txt');
const FORCED_DEBUG_ENCOUNTER_JSON_PATH = path.join(__dirname, 'encounter_debug_test.json');
const FORCED_DEBUG_ENCOUNTER_SOURCE = 'forced_debug_test_file';

function parseEncounterIdFromTemplate(template) {
    const raw = String(template || '');
    if (!raw) return '';
    const match = raw.match(/\bid\s*:\s*['"]([^'"]+)['"]/);
    return match && match[1] ? String(match[1]).trim() : '';
}

const ENCOUNTER_TEMPLATE_CATALOG = (() => {
    const byId = new Map();
    const orderedTemplates = [];
    const rawTemplates = [
        UI_EXAMPLE_ENCOUNTER_TEMPLATE,
        UI_BASIC_WAVE_CLEAR_EXAMPLE_TEMPLATE,
        UI_SURVIVE_TIMER_EXAMPLE_TEMPLATE,
        UI_BOSS_DUEL_EXAMPLE_TEMPLATE,
        UI_PROJECTILE_SHOWCASE_EXAMPLE_TEMPLATE
    ];
    for (const template of rawTemplates) {
        const encounterId = parseEncounterIdFromTemplate(template);
        if (!encounterId || byId.has(encounterId)) continue;
        byId.set(encounterId, template);
        orderedTemplates.push(template);
    }
    return { byId, orderedTemplates };
})();

const SETTINGS_SCHEMA = Object.freeze({
    PLUGIN_BRIEF: {
        type: 'description',
        content: 'Adds optional combat interlude handoffs that can turn selected scenes into playable top-down encounters.'
    },
    PLUGIN_METRICS: {
        type: 'metrics',
        narrative_impact: 'High',
        immersion: 'High',
        cost: 'Medium',
        latency: 'Medium'
    },
    enabled: {
        type: 'checkbox',
        label: 'Enable Plugin',
        description: 'Enable top-down shooter combat overlay handoffs.',
        default: true
    },
    force_offer_every_turn: {
        type: 'checkbox',
        label: 'Force Overlay Every Turn',
        description: 'Testing mode: always register combat overlay at end of each mainline turn.',
        default: false
    },
    use_character_sprites_for_player: {
        type: 'checkbox',
        label: 'Use Character Sprites For Player',
        description: 'When possible, use VN character sprites as the gameplay player model (directional when available).',
        default: true
    },
    generate_dynamic_encounters: {
        type: 'checkbox',
        label: 'Generate Dynamic Encounters',
        description: 'Use a two-call LLM pipeline (EncounterFacade + flavor pack) to generate scene-specific combat when no encounter id/definition is supplied.',
        default: true
    },
    encounter_generation_model: {
        type: 'select',
        label: 'Encounter Generation Model',
        description: 'Model used for EncounterFacade and flavor-pack generation calls.',
        options: 'llm-aliases',
        default: { model: 'highendmodel' }
    },
    encounter_generation_timeout_ms: {
        type: 'number',
        label: 'Encounter Generation Timeout (ms)',
        description: 'Maximum time for each staged LLM call in the dynamic encounter pipeline.',
        min: 10000,
        max: 600000,
        default: 120000
    }
});

function normalizePhase(value) {
    return String(value || '').trim().toUpperCase();
}

function toInt(value, fallback = null) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

function toStringSafe(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hasRegisteredIntercept(context, interceptId) {
    const list = Array.isArray(context?.output?.guiIntercepts) ? context.output.guiIntercepts : [];
    return list.some(item => item && item.interceptId === interceptId);
}

function normalizeCharacterKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function toFileStem(input) {
    const normalized = String(input || '').replace(/\\/g, '/');
    const fileName = normalized.split('/').pop() || '';
    return fileName.replace(/\.[^.]+$/, '').toLowerCase();
}

function parseSpriteDirection(pathLike) {
    const fullNoExt = String(pathLike || '')
        .replace(/\\/g, '/')
        .replace(/\.[^.]+$/, '')
        .toLowerCase();
    const fileStem = toFileStem(pathLike);
    if (!fullNoExt || !fileStem) return null;
    if (fileStem.endsWith('_icon') || fileStem.endsWith('_reference')) return null;
    if (fileStem.endsWith('_talk') || fileStem.endsWith('_blink') || fileStem.endsWith('_talk_blink')) return null;

    const match = fullNoExt.match(/^(.*)_(left|right|back|front)$/i);
    if (match) {
        return {
            stem: match[1],
            direction: String(match[2] || '').toLowerCase()
        };
    }

    return {
        stem: fullNoExt,
        direction: 'front'
    };
}

function scoreStemDirectionMap(directionMap, stem) {
    const dirs = directionMap.get(stem) || {};
    const hasFront = !!dirs.front;
    const hasLeft = !!dirs.left;
    const hasRight = !!dirs.right;
    const hasBack = !!dirs.back;
    const fullCount = (hasFront ? 1 : 0) + (hasLeft ? 1 : 0) + (hasRight ? 1 : 0) + (hasBack ? 1 : 0);
    const neutralBonus = stem.includes('_neutral') ? 1 : 0;
    return (fullCount * 100) + (neutralBonus * 10);
}

function getStemCharacterRoot(stem) {
    const value = String(stem || '');
    if (!value) return '';
    const slash = value.lastIndexOf('/');
    const prefix = slash >= 0 ? value.slice(0, slash + 1) : '';
    const file = slash >= 0 ? value.slice(slash + 1) : value;
    const lastUnderscore = file.lastIndexOf('_');
    if (lastUnderscore <= 0) return value;
    return prefix + file.slice(0, lastUnderscore);
}

function buildDirectionalFromBestFront(byStem, stemScores) {
    if (!(byStem instanceof Map) || byStem.size === 0) return null;

    const orderedStems = Array.from(byStem.keys())
        .sort((a, b) => (stemScores.get(b) || 0) - (stemScores.get(a) || 0));
    const frontStem = orderedStems.find(stem => !!(byStem.get(stem) || {}).front);
    if (!frontStem) return null;

    const frontDirs = byStem.get(frontStem) || {};
    const characterRoot = getStemCharacterRoot(frontStem);
    const out = { front: frontDirs.front, left: '', right: '', back: '' };

    const pickDirection = (dir) => {
        if (frontDirs[dir]) return frontDirs[dir];

        for (const stem of orderedStems) {
            if (getStemCharacterRoot(stem) !== characterRoot) continue;
            const dirs = byStem.get(stem) || {};
            if (dirs[dir]) return dirs[dir];
        }

        for (const stem of orderedStems) {
            const dirs = byStem.get(stem) || {};
            if (dirs[dir]) return dirs[dir];
        }

        return '';
    };

    out.left = pickDirection('left');
    out.right = pickDirection('right');
    out.back = pickDirection('back');
    return (out.front && out.left && out.right && out.back) ? out : null;
}

function resolveCharacterSpriteProfileFromFiles(filePaths) {
    const files = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
    if (files.length === 0) return { directional: null, staticFront: null };

    const byStem = new Map();
    for (const pathValue of files) {
        const parsed = parseSpriteDirection(pathValue);
        if (!parsed || !parsed.stem) continue;
        if (!byStem.has(parsed.stem)) byStem.set(parsed.stem, {});
        const dirMap = byStem.get(parsed.stem);
        if (!dirMap[parsed.direction]) dirMap[parsed.direction] = String(pathValue);
    }

    if (byStem.size === 0) return { directional: null, staticFront: null };

    const stemScores = new Map();
    let bestDirectionalStem = null;
    let bestDirectionalScore = -1;
    let bestStaticStem = null;
    let bestStaticScore = -1;

    for (const stem of byStem.keys()) {
        const dirs = byStem.get(stem) || {};
        const score = scoreStemDirectionMap(byStem, stem);
        stemScores.set(stem, score);
        const hasDirectionalSet = !!(dirs.front && dirs.left && dirs.right && dirs.back);
        const hasStaticFront = !!dirs.front;

        if (hasDirectionalSet && score > bestDirectionalScore) {
            bestDirectionalScore = score;
            bestDirectionalStem = stem;
        }
        if (hasStaticFront && score > bestStaticScore) {
            bestStaticScore = score;
            bestStaticStem = stem;
        }
    }

    let directional = bestDirectionalStem
        ? {
            front: byStem.get(bestDirectionalStem).front,
            left: byStem.get(bestDirectionalStem).left,
            right: byStem.get(bestDirectionalStem).right,
            back: byStem.get(bestDirectionalStem).back
        }
        : null;
    if (!directional) {
        directional = buildDirectionalFromBestFront(byStem, stemScores);
    }

    const staticFront = bestStaticStem
        ? { front: byStem.get(bestStaticStem).front }
        : null;

    return { directional, staticFront };
}

function resolveCatalogCharacterKey(spriteCatalog, characterName) {
    const normalizedName = normalizeCharacterKey(characterName);
    if (!normalizedName) return '';
    const direct = spriteCatalog?.characters?.[normalizedName];
    if (direct) return normalizedName;

    const byAlias = spriteCatalog?.lookups?.byAlias || {};
    if (typeof byAlias[normalizedName] === 'string') return byAlias[normalizedName];

    const firstName = normalizeCharacterKey(String(characterName || '').split(/\s+/)[0] || '');
    const byFirstName = spriteCatalog?.lookups?.byFirstName || {};
    if (firstName && typeof byFirstName[firstName] === 'string') return byFirstName[firstName];

    return '';
}

function resolveCharacterSpriteProfile(spriteCatalog, characterName) {
    const key = resolveCatalogCharacterKey(spriteCatalog, characterName);
    if (!key) return { key: '', profile: { directional: null, staticFront: null } };
    const charState = spriteCatalog?.characters?.[key] || null;
    if (!charState) return { key: '', profile: { directional: null, staticFront: null } };
    const files = Array.isArray(charState.files) ? charState.files : [];
    return {
        key,
        profile: resolveCharacterSpriteProfileFromFiles(files)
    };
}

function extractSpritePathValue(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry.trim();
    if (typeof entry === 'object') {
        return String(entry.path || entry.src || entry.image || entry.file || '').trim();
    }
    return '';
}

function collectCharacterSpritePathsFromSequence(context, characterName) {
    const sequence = Array.isArray(context?.output?.sequence)
        ? context.output.sequence
        : [];
    const characterKey = normalizeCharacterKey(characterName);
    if (!characterKey || sequence.length === 0) return [];

    const out = [];
    const seen = new Set();
    const addPath = (pathValue) => {
        const normalized = String(pathValue || '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        out.push(normalized);
    };

    for (const line of sequence) {
        const lineCharKey = normalizeCharacterKey(line?.character);
        if (!lineCharKey || lineCharKey !== characterKey) continue;

        addPath(line?.image);

        const sprites = line?.sprites;
        if (Array.isArray(sprites)) {
            for (const entry of sprites) addPath(extractSpritePathValue(entry));
        } else if (sprites && typeof sprites === 'object') {
            for (const entry of Object.values(sprites)) addPath(extractSpritePathValue(entry));
        }
    }

    return out;
}

function resolveCharacterSpriteProfileWithFallback(context, spriteCatalog, characterName) {
    const primary = resolveCharacterSpriteProfile(spriteCatalog, characterName);
    if (primary.profile.directional || primary.profile.staticFront) return primary;

    const sequenceSpritePaths = collectCharacterSpritePathsFromSequence(context, characterName);
    if (sequenceSpritePaths.length === 0) return primary;

    return {
        key: primary.key || normalizeCharacterKey(characterName),
        profile: resolveCharacterSpriteProfileFromFiles(sequenceSpritePaths)
    };
}

function dedupeCharacterList(rawList, playerName) {
    const out = [];
    const seen = new Set();
    const playerNormalized = normalizeCharacterKey(playerName);
    for (const entry of Array.isArray(rawList) ? rawList : []) {
        const name = String(entry || '').trim();
        if (!name) continue;
        const key = normalizeCharacterKey(name);
        if (!key || key === playerNormalized || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

function resolveCombatPlayerSpriteSelection(context, settings, descriptorPayload = null) {
    const enabled = settings?.use_character_sprites_for_player === true;
    if (!enabled) {
        return { enabled: false, mode: 'none', source: null, characterName: null, sprites: null };
    }

    const fromDescriptor = descriptorPayload?.combatPlayerSprite;
    if (fromDescriptor && typeof fromDescriptor === 'object') {
        const mode = String(fromDescriptor.mode || '').toLowerCase();
        const hasSprites = !!fromDescriptor?.sprites && typeof fromDescriptor.sprites === 'object';
        if (hasSprites && (mode === 'directional' || mode === 'static')) {
            return fromDescriptor;
        }
    }

    const playerCharacterName = toStringSafe(context?.input?.playerCharacterName, '');
    const party = dedupeCharacterList(context?.output?.party, playerCharacterName);
    const spriteCatalog = context?.runtime?.vnManager?.spriteCatalog || null;
    if (!spriteCatalog || !spriteCatalog.characters || Object.keys(spriteCatalog.characters).length === 0) {
        return { enabled: true, mode: 'none', source: null, characterName: null, sprites: null };
    }

    // 1) Player with full directional set
    if (playerCharacterName) {
        const playerResolved = resolveCharacterSpriteProfileWithFallback(context, spriteCatalog, playerCharacterName);
        if (playerResolved.profile.directional) {
            return {
                enabled: true,
                mode: 'directional',
                source: 'player',
                characterName: playerCharacterName,
                characterKey: playerResolved.key,
                sprites: playerResolved.profile.directional
            };
        }
    }

    // 2) Party member with full directional set
    for (const name of party) {
        const resolved = resolveCharacterSpriteProfileWithFallback(context, spriteCatalog, name);
        if (resolved.profile.directional) {
            return {
                enabled: true,
                mode: 'directional',
                source: 'party',
                characterName: name,
                characterKey: resolved.key,
                sprites: resolved.profile.directional
            };
        }
    }

    // 3) Player static front
    if (playerCharacterName) {
        const playerResolved = resolveCharacterSpriteProfileWithFallback(context, spriteCatalog, playerCharacterName);
        if (playerResolved.profile.staticFront) {
            return {
                enabled: true,
                mode: 'static',
                source: 'player',
                characterName: playerCharacterName,
                characterKey: playerResolved.key,
                sprites: playerResolved.profile.staticFront
            };
        }
    }

    // 4) Party static front
    for (const name of party) {
        const resolved = resolveCharacterSpriteProfileWithFallback(context, spriteCatalog, name);
        if (resolved.profile.staticFront) {
            return {
                enabled: true,
                mode: 'static',
                source: 'party',
                characterName: name,
                characterKey: resolved.key,
                sprites: resolved.profile.staticFront
            };
        }
    }

    return { enabled: true, mode: 'none', source: null, characterName: null, sprites: null };
}

function extractBattleOstChoices(context, descriptorPayload = null) {
    const sourceCandidates = [
        descriptorPayload?.combatOstChoices,
        descriptorPayload?.battleOstChoices,
        context?.processed?.assetSelector?.ostChoicesByCategory?.combat,
        context?.processed?.assetSelector?.ostChoicesByCategory?.battle
    ];
    for (const source of sourceCandidates) {
        if (!Array.isArray(source) || source.length === 0) continue;
        const out = [];
        const seen = new Set();
        for (const entry of source) {
            let raw = '';
            if (typeof entry === 'string') {
                raw = entry;
            } else if (entry && typeof entry === 'object') {
                raw = String(entry.file || entry.path || entry.src || entry.ost || entry.id || '').trim();
            }
            raw = String(raw || '').trim();
            if (!raw) continue;
            if (seen.has(raw)) continue;
            seen.add(raw);
            out.push(raw);
            if (out.length >= 24) break;
        }
        if (out.length > 0) return out;
    }
    return [];
}

function sanitizeEncounterId(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed || '';
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isEncounterDefinitionCandidate(value) {
    if (!isPlainObject(value)) return false;
    return (
        !!value.sequence
        || !!value.enemyTypes
        || !!value.patterns
        || !!value.projectileTypes
        || Number.isFinite(Number(value.schemaVersion))
    );
}

function cloneJsonSafe(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function summarizeDiagnostics(diagnostics, maxItems = 3) {
    const items = Array.isArray(diagnostics) ? diagnostics : [];
    if (!items.length) return '';
    const rows = [];
    for (const item of items) {
        if (rows.length >= maxItems) break;
        const code = String(item?.code || '').trim();
        const message = String(item?.message || '').trim();
        if (code && message) rows.push(code + ': ' + message);
        else if (message) rows.push(message);
    }
    return rows.join(' | ');
}

function loadForcedDebugEncounterDefinition(tools = null) {
    try {
        if (fs.existsSync(FORCED_DEBUG_ENCOUNTER_FACADE_PATH)) {
            const rawFacade = fs.readFileSync(FORCED_DEBUG_ENCOUNTER_FACADE_PATH, 'utf8');
            const compiled = compileEncounterFacade(rawFacade, { validate: true });
            const candidate = compiled?.encounter;
            if (compiled?.ok && isEncounterDefinitionCandidate(candidate)) {
                return cloneJsonSafe(candidate);
            }
            const detail = summarizeDiagnostics(compiled?.diagnostics);
            tools?.logger?.warn?.(
                '[' + PLUGIN_ID + '] encounter_debug_test.txt is present but failed EncounterFacade compilation.'
                + (detail ? ' ' + detail : '')
            );
        }

        if (!fs.existsSync(FORCED_DEBUG_ENCOUNTER_JSON_PATH)) return null;
        const rawJson = fs.readFileSync(FORCED_DEBUG_ENCOUNTER_JSON_PATH, 'utf8');
        const parsed = JSON.parse(rawJson);
        if (!isEncounterDefinitionCandidate(parsed)) {
            tools?.logger?.warn?.('[' + PLUGIN_ID + '] encounter_debug_test.json is present but does not look like an encounter definition.');
            return null;
        }
        return cloneJsonSafe(parsed);
    } catch (error) {
        tools?.logger?.warn?.('[' + PLUGIN_ID + '] Failed to load forced debug encounter file.', error);
        return null;
    }
}

function resolveEncounterPayload(context, descriptorPayload = null, settings = null, tools = null) {
    const forcedDebugEncounterDefinition = loadForcedDebugEncounterDefinition(tools);
    if (forcedDebugEncounterDefinition) {
        return {
            encounterId: null,
            encounterDefinition: forcedDebugEncounterDefinition,
            encounterSource: FORCED_DEBUG_ENCOUNTER_SOURCE,
            generatedEncounter: null,
            debugEncounterPack: false,
            forcedDebugEncounter: true
        };
    }

    const director = context?.processed?.director || {};
    const encounterIdCandidates = [
        descriptorPayload?.encounterId,
        director?.encounterId,
        director?.combatEncounterId,
        director?.encounter?.id,
        director?.combatEncounter?.id,
        context?.output?.encounterId
    ];
    let encounterId = '';
    for (const candidate of encounterIdCandidates) {
        encounterId = sanitizeEncounterId(candidate);
        if (encounterId) break;
    }

    const encounterDefinitionCandidates = [
        descriptorPayload?.encounterDefinition,
        director?.encounterDefinition,
        director?.combatEncounterDefinition,
        director?.encounter,
        director?.combatEncounter
    ];
    let encounterDefinition = null;
    for (const candidate of encounterDefinitionCandidates) {
        if (!isEncounterDefinitionCandidate(candidate)) continue;
        encounterDefinition = cloneJsonSafe(candidate);
        if (encounterDefinition) break;
    }

    let encounterSource = toStringSafe(descriptorPayload?.encounterSource, '');
    if (!encounterSource && encounterDefinition) {
        encounterSource = descriptorPayload?.encounterDefinition ? 'payload_definition' : 'director_definition';
    } else if (!encounterSource && encounterId) {
        encounterSource = descriptorPayload?.encounterId ? 'payload_encounter_id' : 'director_encounter_id';
    }

    const debugEncounterPack = descriptorPayload?.debugEncounterPack === true || settings?.force_offer_every_turn === true;
    const generatedEncounter = isPlainObject(descriptorPayload?.generatedEncounter)
        ? cloneJsonSafe(descriptorPayload.generatedEncounter)
        : null;
    return {
        encounterId: encounterId || null,
        encounterDefinition: encounterDefinition || null,
        encounterSource: encounterSource || null,
        generatedEncounter,
        debugEncounterPack,
        forcedDebugEncounter: false
    };
}

function shouldGenerateDynamicEncounter(settings, encounterPayload) {
    if (settings?.generate_dynamic_encounters === false) return false;
    if (encounterPayload?.debugEncounterPack === true) return false;
    if (encounterPayload?.encounterDefinition) return false;
    if (encounterPayload?.encounterId) return false;
    return true;
}

function resolveEncounterGenerationOptions(settings) {
    const configuredModel = settings?.encounter_generation_model || { model: 'highendmodel' };
    const timeoutMsRaw = Number(settings?.encounter_generation_timeout_ms);
    return {
        modelDef: configuredModel,
        timeoutMs: Number.isFinite(timeoutMsRaw) ? timeoutMsRaw : 120000
    };
}

async function resolveTurnContextForGenerationRequest(request, tools) {
    const requestedTurnNumber = toInt(request?.parentTurnNumber, null);
    if (Number.isInteger(requestedTurnNumber) && requestedTurnNumber > 0 && typeof tools?.turns?.resolve === 'function') {
        try {
            const resolved = await tools.turns.resolve({ turnNumber: requestedTurnNumber });
            if (resolved?.context) return resolved.context;
        } catch (error) {
            tools?.logger?.warn?.('[' + PLUGIN_ID + '] Failed to resolve requested turn for combat regeneration.', error);
        }
    }

    if (typeof tools?.turns?.getCurrent === 'function') {
        try {
            const current = await tools.turns.getCurrent();
            if (current?.context) return current.context;
        } catch (error) {
            tools?.logger?.warn?.('[' + PLUGIN_ID + '] Failed to resolve current turn for combat regeneration.', error);
        }
    }

    return null;
}

function buildGenerationFailurePayload(generated, message) {
    return {
        success: true,
        ok: false,
        encounterId: DEFAULT_ENCOUNTER_ID,
        encounterDefinition: null,
        encounterSource: generated?.encounterSource || 'generated_encounter_facade_fallback',
        generatedEncounter: generated?.generatedEncounter || {
            script: '',
            scriptKind: 'encounter_facade_v1',
            compilerVersion: 'unknown',
            sourceHash: '',
            repaired: false,
            expandedEncounterSummary: null,
            generationPipeline: 'facade_plus_flavor_v1',
            flavorPack: null,
            flavorPackHash: '',
            warnings: [],
            errors: [{
                code: 'TDSG-E000',
                line: 0,
                column: 1,
                message: message || 'Dynamic encounter generation failed; default encounter selected.',
                hint: ''
            }]
        },
        warning: message || 'Dynamic encounter generation failed; default encounter selected.'
    };
}

async function regenerateEncounterSocket(request, tools) {
    const responseEvent = REGENERATE_ENCOUNTER_EVENT + '-response';
    const emitResponse = (payload) => {
        if (typeof tools?.socket?.emit === 'function') {
            tools.socket.emit(responseEvent, payload || {});
        }
    };

    try {
        const settings = tools?.settings?.getSelf?.() || {};
        if (settings.enabled === false) {
            emitResponse({
                success: false,
                error: 'Top-down shooter gameplay plugin is disabled.'
            });
            return;
        }

        const context = await resolveTurnContextForGenerationRequest(request, tools);
        if (!context) {
            emitResponse({
                success: false,
                error: 'Could not resolve a turn context for combat regeneration.'
            });
            return;
        }

        const options = resolveEncounterGenerationOptions(settings);
        const runGeneration = async () => generateEncounterFromScene(context, tools, options);
        const generated = (typeof tools?.status?.withTask === 'function')
            ? await tools.status.withTask('Regenerating shooter encounter...', {
                id: 'top_down_shooter_gameplay_interludes_regenerate_encounter'
            }, runGeneration)
            : await runGeneration();

        if (generated?.ok && generated.encounterDefinition) {
            emitResponse({
                success: true,
                ok: true,
                encounterId: null,
                encounterDefinition: generated.encounterDefinition,
                encounterSource: generated.encounterSource || 'generated_encounter_facade',
                generatedEncounter: generated.generatedEncounter || null
            });
            return;
        }

        emitResponse(buildGenerationFailurePayload(
            generated,
            'Combat regeneration failed validation; using the default encounter.'
        ));
    } catch (error) {
        tools?.logger?.warn?.('[' + PLUGIN_ID + '] Combat regeneration failed.', error);
        emitResponse({
            success: false,
            error: error?.message || 'Combat regeneration failed.'
        });
    }
}

async function generateDynamicEncounterPayload(context, tools, settings, encounterPayload) {
    if (!shouldGenerateDynamicEncounter(settings, encounterPayload)) return encounterPayload;
    const options = resolveEncounterGenerationOptions(settings);
    const runGeneration = async () => generateEncounterFromScene(context, tools, options);
    const generated = (typeof tools?.status?.withTask === 'function')
        ? await tools.status.withTask('Generating shooter encounter...', {
            id: 'top_down_shooter_gameplay_interludes_encounter_generation'
        }, runGeneration)
        : await runGeneration();

    if (generated?.ok && generated.encounterDefinition) {
        return {
            ...encounterPayload,
            encounterId: null,
            encounterDefinition: generated.encounterDefinition,
            encounterSource: generated.encounterSource || 'generated_encounter_facade',
            generatedEncounter: generated.generatedEncounter || null
        };
    }

    return {
        ...encounterPayload,
        encounterId: DEFAULT_ENCOUNTER_ID,
        encounterDefinition: null,
        encounterSource: generated?.encounterSource || 'generated_encounter_facade_fallback',
        generatedEncounter: generated?.generatedEncounter || {
            script: '',
            scriptKind: 'encounter_facade_v1',
            compilerVersion: 'unknown',
            sourceHash: '',
            repaired: false,
            expandedEncounterSummary: null,
            generationPipeline: 'facade_plus_flavor_v1',
            flavorPack: null,
            flavorPackHash: '',
            warnings: [],
            errors: [{
                code: 'TDSG-E000',
                line: 0,
                column: 1,
                message: 'Dynamic encounter generation failed; default encounter selected.',
                hint: ''
            }]
        }
    };
}

function resolveEncounterTemplatesForPayload(payload) {
    const byId = ENCOUNTER_TEMPLATE_CATALOG.byId;
    const orderedTemplates = ENCOUNTER_TEMPLATE_CATALOG.orderedTemplates;
    const defaultTemplate = byId.get(DEFAULT_ENCOUNTER_ID) || orderedTemplates[0] || '';
    if (payload?.debugEncounterPack === true) return orderedTemplates.slice();

    const selectedId = sanitizeEncounterId(payload?.encounterId);
    const selectedTemplate = selectedId ? byId.get(selectedId) : null;
    const out = [];
    if (defaultTemplate) out.push(defaultTemplate);
    if (selectedTemplate && selectedTemplate !== defaultTemplate) out.push(selectedTemplate);
    return out;
}

function shouldOfferCombatOverlay(context, settings) {
    if (settings?.enabled === false) return false;
    if (context?.sceneMode !== 'mainline') return false;
    if (settings?.force_offer_every_turn === true) return true;

    const director = context?.processed?.director || {};
    const phase = normalizePhase(director.scenePhase);
    const scenePluginId = toStringSafe(director.scenePluginId, '');

    if (!['COMBAT', 'BATTLE', 'SKIRMISH'].includes(phase)) return false;
    if (scenePluginId && scenePluginId !== PLUGIN_ID) return false;
    return true;
}

function replaceToken(template, token, value) {
    return template.split(token).join(value);
}

function renderUiTemplate({ mode, bodyHtml, payload }) {
    const uiId = 'top_down_shooter_gameplay_interludes_ui_' + Date.now() + '_' + Math.random().toString(16).slice(2, 8);

    const html = replaceToken(
        replaceToken(
            replaceToken(UI_HTML_TEMPLATE, '{{UI_MODE}}', escapeHtml(mode)),
            '{{UI_ID}}',
            escapeHtml(uiId)
        ),
        '{{UI_BODY}}',
        bodyHtml
    );

    const uiJs = replaceToken(
        replaceToken(
            replaceToken(UI_JS_TEMPLATE, '__UI_ID_JSON__', JSON.stringify(uiId)),
            '__MODE_JSON__',
            JSON.stringify(mode)
        ),
        '__PAYLOAD_JSON__',
        JSON.stringify(payload || {})
    );

    const encounterTemplates = resolveEncounterTemplatesForPayload(payload || {});

    const js = [
        UI_COMBAT_SCENE_RUNTIME_TEMPLATE,
        UI_INPUT_CONTROLLER_TEMPLATE,
        UI_ENTITY_MANAGER_TEMPLATE,
        UI_RENDERER_LAYERS_TEMPLATE,
        UI_EVENT_BUS_TEMPLATE,
        UI_RNG_TEMPLATE,
        UI_PLAYER_RUNTIME_TEMPLATE,
        UI_AUDIO_CONTROLLER_TEMPLATE,
        UI_V1_CAPABILITY_PROFILE_TEMPLATE,
        UI_ENCOUNTER_SCHEMA_TEMPLATE,
        ...encounterTemplates,
        UI_ENCOUNTER_LOADER_TEMPLATE,
        UI_PATTERN_REGISTRY_TEMPLATE,
        UI_ACTION_REGISTRY_TEMPLATE,
        UI_TRIGGER_REGISTRY_TEMPLATE,
        UI_BEHAVIOR_REGISTRY_TEMPLATE,
        UI_ENEMY_RUNTIME_TEMPLATE,
        UI_SEQUENCE_RUNNER_TEMPLATE,
        UI_RESULT_BUILDER_TEMPLATE,
        UI_COMBAT_RUNTIME_TEMPLATE,
        UI_SHOOTER_RUNTIME_TEMPLATE,
        uiJs
    ].join('\n');

    return {
        html,
        css: UI_CSS_TEMPLATE,
        js,
        autoDismiss: false,
        visualState: {
            hideMainSpritesWhileVisible: true
        }
    };
}

function buildCombatOverlayBody() {
    return `<div class="tds-combat-shell" data-role="menu-shell">
    <div class="tds-combat-panel">
        <div class="tds-combat-chip">Combat Gameplay</div>
        <h2 class="tds-combat-title">Experience the combat events of this chapter?</h2>
        <p class="tds-combat-subtitle">
            Start the optional gameplay encounter now, or continue reading and come back later.
        </p>
        <div class="tds-combat-controls">
            <button type="button" class="tds-combat-btn" data-action="start-gameplay">Play</button>
            <button type="button" class="tds-combat-btn secondary" data-action="continue-story">Continue</button>
        </div>
        <div class="tds-combat-controls tds-combat-controls-secondary">
            <button type="button" class="tds-combat-btn secondary" data-action="regenerate-gameplay" data-role="regenerate-gameplay">Regenerate Combat</button>
            <button type="button" class="tds-combat-btn secondary" data-action="retry-gameplay" data-role="retry-gameplay" hidden>Retry</button>
        </div>
        <p class="tds-combat-status" data-role="status"></p>
    </div>
</div>
<div class="tds-gameplay-controls" data-role="gameplay-controls" hidden>
    <button type="button" class="tds-combat-btn secondary" data-action="back-to-menu" data-role="back-to-menu">Back to Menu</button>
</div>`;
}

async function buildCombatOverlayIntercept(context, tools, descriptor) {
    const parentTurnNumber = toInt(descriptor?.payload?.parentTurnNumber, context?.turnNumber);
    const battleOstChoices = extractBattleOstChoices(context, descriptor?.payload);
    const settings = tools.settings.getSelf() || {};
    const combatPlayerSprite = resolveCombatPlayerSpriteSelection(context, settings, descriptor?.payload);
    const encounterPayload = resolveEncounterPayload(context, descriptor?.payload, settings, tools);

    return renderUiTemplate({
        mode: 'combat',
        bodyHtml: buildCombatOverlayBody(),
        payload: {
            parentTurnNumber,
            title: 'Top-Down Shooter Encounter',
            subtitle: 'Survive or continue the chapter when ready.',
            battleOstChoices,
            combatPlayerSprite,
            encounterId: encounterPayload.encounterId,
            encounterDefinition: encounterPayload.encounterDefinition,
            encounterSource: encounterPayload.encounterSource,
            generatedEncounter: encounterPayload.generatedEncounter,
            debugEncounterPack: encounterPayload.debugEncounterPack === true,
            forcedDebugEncounter: encounterPayload.forcedDebugEncounter === true
        }
    });
}

function resolveGuiInterceptBuilder(descriptor) {
    const handlerRef = toStringSafe(descriptor?.handlerRef, '');
    if (handlerRef.endsWith('top_down_shooter_gameplay_overlay')) return buildCombatOverlayIntercept;

    const interceptId = toStringSafe(descriptor?.interceptId || descriptor?.id, '');
    if (interceptId.startsWith(MAIN_INTERCEPT_ID_PREFIX)) return buildCombatOverlayIntercept;

    return null;
}

async function buildGuiIntercept(context, tools, descriptor, request) {
    const builder = resolveGuiInterceptBuilder(descriptor || request?.descriptor || {});
    if (typeof builder === 'function') {
        return builder(context, tools, descriptor, request);
    }

    tools?.logger?.warn?.('[' + PLUGIN_ID + '] Could not resolve GUI intercept builder for descriptor.');
    return renderUiTemplate({
        mode: 'combat',
        bodyHtml: '<div class="tds-combat-shell"><div class="tds-combat-panel"><h2 class="tds-combat-title">Combat Overlay</h2><p class="tds-combat-subtitle">Intercept descriptor is outdated. Continuing chapter.</p></div></div>',
        payload: {
            parentTurnNumber: null
        }
    });
}

async function runDirectorPrePrompt(context, tools) {
    const settings = tools.settings.getSelf() || {};
    if (settings.enabled === false) return;
    if (context?.sceneMode !== 'mainline') return;

    tools.director.registerCapability({
        phase: 'COMBAT',
        description: 'Top-down shooter combat overlay with player-driven encounter pacing.',
        handoffHint: 'If combat begins or escalates, hand off just before the first active exchange.'
    });
}

async function runPostVnGeneration(context, tools) {
    const settings = tools.settings.getSelf() || {};
    if (!shouldOfferCombatOverlay(context, settings)) return;

    const parentTurnNumber = toInt(context?.turnNumber, null);
    if (!Number.isInteger(parentTurnNumber) || parentTurnNumber < 1) return;

    const interceptId = MAIN_INTERCEPT_ID_PREFIX + String(parentTurnNumber);
    if (hasRegisteredIntercept(context, interceptId)) return;
    const battleOstChoices = extractBattleOstChoices(context);
    const combatPlayerSprite = resolveCombatPlayerSpriteSelection(context, settings, null);
    let encounterPayload = resolveEncounterPayload(context, null, settings, tools);
    encounterPayload = await generateDynamicEncounterPayload(context, tools, settings, encounterPayload);

    tools.gui.registerPersistentIntercept({
        interceptId,
        checkpoint: 'during_user_input',
        blocking: true,
        autoDismiss: false,
        priority: 120,
        replayPolicy: 'every_enter',
        hideMainSpritesWhileVisible: true,
        visualState: {
            hideMainSpritesWhileVisible: true
        },
        handlerRef: 'guiIntercepts.top_down_shooter_gameplay_overlay',
        payload: {
            parentTurnNumber,
            battleOstChoices,
            combatPlayerSprite,
            encounterId: encounterPayload.encounterId,
            encounterDefinition: encounterPayload.encounterDefinition,
            encounterSource: encounterPayload.encounterSource,
            generatedEncounter: encounterPayload.generatedEncounter,
            debugEncounterPack: encounterPayload.debugEncounterPack === true
        }
    });
}

module.exports = {
    PLUGIN_ID,
    MAIN_INTERCEPT_ID_PREFIX,
    REGENERATE_ENCOUNTER_EVENT,
    SETTINGS_SCHEMA,
    runDirectorPrePrompt,
    runPostVnGeneration,
    regenerateEncounterSocket,
    buildCombatOverlayIntercept,
    buildGuiIntercept,
    extractBattleOstChoices
};

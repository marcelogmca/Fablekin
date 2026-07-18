const fs = require('fs');
const path = require('path');
const { TurnLogger } = require('../../modules/utils.js');
const { buildSpriteCatalog, getSceneVariantLock } = require('../../modules/vn_manager/rendering/sprite_finder.js');

const PLUGIN_ID = 'camp_rest_interludes';
const SOCKET_BIND_EVENT = 'camp-rest-interludes:bind-option-interlude';
const SAVE_INVITATION_EVENT = 'camp-rest-interludes:save-invitation';
const SAVE_LAYOUT_EVENT = 'camp-rest-interludes:save-overlay-layout';
const CHARACTER_CLASSIFIER_PLUGIN_ID = 'character_classifier';
const WORLD_LOCATION_TRACKER_PLUGIN_ID = 'world_location_tracker';
const MAIN_INTERCEPT_ID_PREFIX = 'camp_rest_interludes_overlay_turn_';
const DEFAULT_RUN_PROFILE_ID = 'interlude_sandbox';
const OPTION_TAG_PREFIX = '[CAMP_REST_INTERLUDES_OPTION=';
const OPTION_FACT_PREDICATE = 'CAMP_REST_OPTION';
const PANEL_LAYOUT_SETTINGS_KEY = 'overlay_panels_layout';
const PANEL_LAYOUT_VERSION = 2;
const DEFAULT_OVERLAY_PANELS_LAYOUT = {
    version: PANEL_LAYOUT_VERSION,
    left: {
        unit: 'relative',
        xRatio: 0,
        yRatio: 0.086867,
        widthRatio: 0.15585,
        heightRatio: 0.733195
    },
    right: {
        unit: 'relative',
        xRatio: 0.642596,
        yRatio: 0,
        widthRatio: 0.173675,
        heightRatio: 0.36091
    }
};
const CAMP_PROJECT_DIR_REL = path.join('assets', 'backgrounds', 'camp');
const CAMP_PLUGIN_FALLBACK_DIR = path.join(__dirname, 'assets', 'camp');
const CAMP_MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm']);
const CAMP_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);

const UI_HTML_TEMPLATE = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
const UI_CSS_TEMPLATE = fs.readFileSync(path.join(__dirname, 'ui.css'), 'utf8');
const UI_SCENE_RUNTIME_TEMPLATE = fs.readFileSync(path.join(__dirname, 'ui_scene_runtime.js'), 'utf8');
const UI_JS_TEMPLATE = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');

const DEFAULT_CHOICES = Object.freeze([
    {
        optionKey: 'market_supplies',
        label: 'Two companions go to the market for supplies',
        prompt: 'Write a cozy downtime scene where two party members visit the local market to buy food and travel essentials. Keep it grounded, character-focused, and low-stakes.',
        participants: []
    },
    {
        optionKey: 'small_act_of_kindness',
        label: 'A companion helps a local with a small problem',
        prompt: 'Write a short downtime scene where one companion helps a local solve a small, human problem. Keep the emotional tone warm and personal.',
        participants: []
    },
    {
        optionKey: 'fireside_questions',
        label: 'A quiet fireside conversation reveals old memories',
        prompt: 'Write an intimate rest scene where two companions talk about old memories and worldview differences, with subtle emotional development.',
        participants: []
    }
]);

const SETTINGS_SCHEMA = Object.freeze({
    PLUGIN_BRIEF: {
        type: 'description',
        content: 'Offers cozy rest/camp interludes that let the story breathe between main plot beats.'
    },
    PLUGIN_METRICS: {
        type: 'metrics',
        narrative_impact: 'High',
        immersion: 'High',
        cost: 'Medium',
        latency: 'Medium'
    },
    model_def: {
        type: 'select',
        label: 'Choice Generator Model',
        description: 'Model used to generate rest/camp interlude choices.',
        options: 'llm-aliases',
        default: { model: 'highendmodel' }
    },
    enabled: {
        type: 'checkbox',
        label: 'Enable Plugin',
        description: 'Master toggle for camp/rest interlude behavior.',
        default: true
    },
    force_offer_every_turn: {
        type: 'checkbox',
        label: 'Force Overlay Every Turn',
        description: 'Testing mode: always offer camp/rest options at end of every mainline turn.',
        default: false
    },
    use_llm_for_choices: {
        type: 'checkbox',
        label: 'Use LLM For Choices',
        description: 'If disabled, the plugin uses deterministic fallback choices.',
        default: true
    },
    run_director_for_interludes: {
        type: 'checkbox',
        label: 'Run Director For Interludes',
        description: 'When enabled, generated camp interludes run Director analysis before Writer (ledger call remains disabled for interludes).',
        default: true
    }
});

function buildParentScope(parentTurnNumber) {
    const turnNumber = toInt(parentTurnNumber, 0);
    return {
        turnNumber,
        turnKey: String(turnNumber),
        sceneMode: 'mainline',
        pluginId: PLUGIN_ID
    };
}

function buildInterludeScope(parentTurnNumber, interludeOrdinal, interludeId = null) {
    const turnNumber = toInt(parentTurnNumber, 0);
    const ordinal = toInt(interludeOrdinal, 0);
    return {
        turnNumber,
        turnKey: `${turnNumber}.${ordinal}`,
        sceneMode: 'interlude',
        interludeId: isPositiveInteger(interludeId) ? interludeId : null,
        interludeOrdinal: ordinal,
        pluginId: PLUGIN_ID
    };
}

function safeJsonParse(value, fallback) {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    try {
        return JSON.parse(value);
    } catch (_error) {
        return fallback;
    }
}

function normalizePhase(value) {
    return String(value || '').trim().toUpperCase();
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function toInt(value, fallback = null) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max, fallback = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function toStringSafe(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

function sanitizeOverlayPanelRect(rawRect) {
    if (!rawRect || typeof rawRect !== 'object') return null;
    const isRelativeLayout =
        String(rawRect.unit || rawRect.mode || rawRect.space || '').trim().toLowerCase() === 'relative'
        || rawRect.xRatio !== undefined
        || rawRect.yRatio !== undefined
        || rawRect.widthRatio !== undefined
        || rawRect.heightRatio !== undefined;

    if (isRelativeLayout) {
        const xRatio = clampNumber(rawRect.xRatio, 0, 1, null);
        const yRatio = clampNumber(rawRect.yRatio, 0, 1, null);
        const widthRatio = clampNumber(rawRect.widthRatio, 0, 1, null);
        const heightRatio = clampNumber(rawRect.heightRatio, 0, 1, null);
        if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio) || !Number.isFinite(widthRatio) || !Number.isFinite(heightRatio)) {
            return null;
        }
        return {
            unit: 'relative',
            xRatio: Number(xRatio.toFixed(6)),
            yRatio: Number(yRatio.toFixed(6)),
            widthRatio: Number(widthRatio.toFixed(6)),
            heightRatio: Number(heightRatio.toFixed(6))
        };
    }

    const x = clampNumber(rawRect.x, -10000, 10000, null);
    const y = clampNumber(rawRect.y, -10000, 10000, null);
    const width = clampNumber(rawRect.width, 180, 2200, null);
    const height = clampNumber(rawRect.height, 120, 2200, null);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
    }
    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
    };
}

function sanitizeOverlayPanelsLayout(rawLayout) {
    if (!rawLayout || typeof rawLayout !== 'object') return null;
    const layoutVersion = toInt(rawLayout.version, null);
    if (layoutVersion !== PANEL_LAYOUT_VERSION) return null;
    const left = sanitizeOverlayPanelRect(rawLayout.left);
    const right = sanitizeOverlayPanelRect(rawLayout.right);
    if (!left && !right) return null;
    return {
        version: PANEL_LAYOUT_VERSION,
        left: left || null,
        right: right || null
    };
}

function sanitizeLabel(value, fallback) {
    const label = toStringSafe(value, fallback).replace(/\s+/g, ' ').trim();
    return label.slice(0, 140);
}

function sanitizePrompt(value, fallback) {
    const prompt = toStringSafe(value, fallback).trim();
    return prompt.slice(0, 2000);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function slugify(value) {
    const slug = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    return slug || 'scene';
}

function dedupeStrings(values) {
    if (!Array.isArray(values)) return [];
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const str = toStringSafe(value, '');
        if (!str) continue;
        const key = str.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(str);
    }
    return out;
}

function getInvitationParticipantSignature(participants) {
    const normalized = dedupeStrings(participants)
        .map(name => name.toLowerCase())
        .sort();
    return normalized.length > 0 ? normalized.join('|') : '';
}

function shouldPreferInvitationScene(candidate, existing) {
    const candidateId = toInt(candidate?.interludeId, 0);
    const existingId = toInt(existing?.interludeId, 0);
    if (candidateId !== existingId) return candidateId > existingId;

    const candidateOrdinal = toInt(candidate?.interludeOrdinal, 0);
    const existingOrdinal = toInt(existing?.interludeOrdinal, 0);
    return candidateOrdinal > existingOrdinal;
}

function dedupeInvitationScenesByParticipants(scenes) {
    if (!Array.isArray(scenes) || scenes.length === 0) return [];

    const bySignature = new Map();
    const passthrough = [];
    for (const scene of scenes) {
        const signature = getInvitationParticipantSignature(scene?.participants || []);
        if (!signature) {
            passthrough.push(scene);
            continue;
        }

        const existing = bySignature.get(signature);
        if (!existing || shouldPreferInvitationScene(scene, existing)) {
            bySignature.set(signature, scene);
        }
    }

    return [...passthrough, ...bySignature.values()].sort((a, b) => {
        const ordA = isPositiveInteger(toInt(a?.interludeOrdinal, null)) ? toInt(a.interludeOrdinal, null) : Number.MAX_SAFE_INTEGER;
        const ordB = isPositiveInteger(toInt(b?.interludeOrdinal, null)) ? toInt(b.interludeOrdinal, null) : Number.MAX_SAFE_INTEGER;
        if (ordA !== ordB) return ordA - ordB;
        return toInt(a?.interludeId, 0) - toInt(b?.interludeId, 0);
    });
}

function normalizeImportance(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function isClassifierAcceptedForInvitation(importance) {
    const normalized = normalizeImportance(importance);
    return normalized === 'core' || normalized === 'major';
}

function isCharacterClassifierInstalled(tools) {
    try {
        return tools?.plugins?.isInstalled?.(CHARACTER_CLASSIFIER_PLUGIN_ID) === true;
    } catch (_) {
        return false;
    }
}

function getCachedClassifierImportance(context, tools, characterName) {
    const key = toStringSafe(characterName, '').toLowerCase();
    if (!key) return '';

    const contextImportance = normalizeImportance(context?.processed?.characterMetadata?.[key]?.importance);
    if (contextImportance) return contextImportance;

    return normalizeImportance(tools?.turnContext?.processed?.characterMetadata?.[key]?.importance);
}

function cacheClassifierImportance(context, tools, characterName, importance) {
    const normalized = normalizeImportance(importance);
    const key = toStringSafe(characterName, '').toLowerCase();
    if (!key || !normalized) return;

    for (const holder of [context, tools?.turnContext]) {
        if (!holder || typeof holder !== 'object') continue;
        if (!holder.processed) holder.processed = {};
        if (!holder.processed.characterMetadata) holder.processed.characterMetadata = {};
        const existing = holder.processed.characterMetadata[key] || {};
        holder.processed.characterMetadata[key] = { ...existing, importance: normalized };
    }
}

async function getClassifierImportanceForCamp(context, tools, characterName) {
    const cached = getCachedClassifierImportance(context, tools, characterName);
    if (cached) return cached;
    if (!isCharacterClassifierInstalled(tools)) return '';

    const importance = normalizeImportance(
        await tools.plugins.call(CHARACTER_CLASSIFIER_PLUGIN_ID, 'getImportance', characterName)
    );
    cacheClassifierImportance(context, tools, characterName, importance);
    return importance;
}

async function filterInvitableCharactersByClassifier(context, tools, characterNames, reason = 'camp_invitation') {
    const deduped = dedupeStrings(characterNames);
    if (deduped.length === 0 || !isCharacterClassifierInstalled(tools)) return deduped;

    const accepted = [];
    const rejected = [];
    for (const characterName of deduped) {
        try {
            const importance = await getClassifierImportanceForCamp(context, tools, characterName);
            if (isClassifierAcceptedForInvitation(importance)) {
                accepted.push(characterName);
            } else {
                rejected.push(`${characterName}:${importance || 'unclassified'}`);
            }
        } catch (error) {
            accepted.push(characterName);
            tools?.logger?.warn?.(`[${PLUGIN_ID}] Character classifier failed while filtering '${characterName}' for ${reason}; keeping it to avoid breaking Camp Rest.`, error);
        }
    }

    if (rejected.length > 0) {
        tools?.logger?.runtime?.(`[${PLUGIN_ID}] Classifier filtered ${rejected.length}/${deduped.length} camp invitation candidate(s) for ${reason}: ${rejected.join(', ')}`);
    }

    return accepted;
}

async function filterCampParticipantsPreservingPlayer(context, tools, participants, reason = 'camp_participants') {
    const rawParticipants = dedupeStrings(participants);
    const playerName = toStringSafe(context?.input?.playerCharacterName || tools?.turnContext?.input?.playerCharacterName, '');
    const playerKey = playerName.toLowerCase();
    const preservedPlayerParticipants = playerKey
        ? rawParticipants.filter(name => toStringSafe(name, '').toLowerCase() === playerKey)
        : [];
    const nonPlayerParticipants = playerKey
        ? rawParticipants.filter(name => toStringSafe(name, '').toLowerCase() !== playerKey)
        : rawParticipants;

    return dedupeStrings([
        ...preservedPlayerParticipants,
        ...(await filterInvitableCharactersByClassifier(
            context,
            tools,
            nonPlayerParticipants,
            reason
        ))
    ]);
}

async function filterInvitationScenesByClassifier(context, tools, scenes, reason = 'invitation_scenes') {
    if (!Array.isArray(scenes) || scenes.length === 0) return [];
    if (!isCharacterClassifierInstalled(tools)) return dedupeInvitationScenesByParticipants(scenes);

    const filtered = [];
    for (const scene of scenes) {
        const participants = await filterInvitableCharactersByClassifier(
            context,
            tools,
            Array.isArray(scene?.participants) ? scene.participants : [],
            reason
        );
        if (participants.length === 0) continue;

        const fallbackLabel = participants.length > 0
            ? `Invitation with ${participants.join(', ')}`
            : scene?.label;
        filtered.push({
            ...scene,
            label: sanitizeLabel(scene?.label, fallbackLabel),
            participants
        });
    }

    return dedupeInvitationScenesByParticipants(filtered);
}

async function resolveRunDirectorForInterludesSetting(tools) {
    const coerceBoolean = (value) => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') return true;
            if (normalized === 'false') return false;
        }
        return null;
    };

    const currentPluginPaths = [
        `plugins.${PLUGIN_ID}.run_director_for_interludes`,
        `${PLUGIN_ID}.run_director_for_interludes`
    ];
    for (const settingPath of currentPluginPaths) {
        const value = tools?.settings?.get ? tools.settings.get(settingPath) : undefined;
        const parsed = coerceBoolean(value);
        if (parsed !== null) return parsed;
    }

    const explicitSelfSetting = tools?.settings?.get
        ? tools.settings.get(`plugins.${PLUGIN_ID}.run_director_for_interludes`)
        : undefined;
    const parsedSelfSetting = coerceBoolean(explicitSelfSetting);
    if (parsedSelfSetting !== null) return parsedSelfSetting;

    const selfSettings = tools?.settings?.getSelf ? (tools.settings.getSelf() || {}) : {};
    const parsedDefaultedSelfSetting = coerceBoolean(selfSettings.run_director_for_interludes);
    return parsedDefaultedSelfSetting !== null ? parsedDefaultedSelfSetting : true;
}

function isCustomInvitationMeta(interludeMeta) {
    if (!interludeMeta || typeof interludeMeta !== 'object') return false;
    const optionKey = toStringSafe(interludeMeta.optionKey, '').toLowerCase();
    return interludeMeta.isCustomInvite === true || optionKey.startsWith('custom_invite_');
}

function logInvitationDebug(tools, phase, payload = {}) {
    try {
        const safePayload = JSON.stringify(payload);
        if (tools?.logger && typeof tools.logger.log === 'function') {
            tools.logger.log('Camp Rest Invitations', `${phase}: ${safePayload}`);
        }
    } catch (_) { }
}

async function getInvitationDebugSnapshot(tools, projectName, parentTurnNumber) {
    const normalizedParentTurn = toInt(parentTurnNumber, 0);
    if (!isPositiveInteger(normalizedParentTurn)) {
        return { parentTurnNumber, facts: [], interludes: [] };
    }

    const normalizedProjectName = toStringSafe(projectName, 'default_project').toLowerCase();
    const facts = await tools.db.chat.query(`
        SELECT id, turn_key, interlude_id, interlude_ordinal, target
        FROM facts
        WHERE LOWER(project_name) = LOWER(?)
          AND turn_number = ?
          AND plugin_id = ?
          AND LOWER(source) = LOWER(?)
          AND predicate = 'CAMP_REST_INVITED'
        ORDER BY interlude_ordinal ASC, interlude_id ASC, target ASC
        LIMIT 40
    `, [normalizedProjectName, normalizedParentTurn, PLUGIN_ID, PLUGIN_ID]);

    const interludes = await tools.db.chat.query(`
        SELECT i.id, i.ordinal, COALESCE(i.label, '') AS label
        FROM chat_interludes i
        INNER JOIN chat_turns t ON t.id = i.parent_turn_id
        WHERE LOWER(i.project_name) = LOWER(?)
          AND LOWER(t.project_name) = LOWER(i.project_name)
          AND t.creation_turn_number = ?
        ORDER BY i.ordinal ASC, i.id ASC
        LIMIT 40
    `, [normalizedProjectName, normalizedParentTurn]);

    return {
        parentTurnNumber: normalizedParentTurn,
        facts: Array.isArray(facts) ? facts : [],
        interludes: Array.isArray(interludes) ? interludes : []
    };
}

async function getSnapshotInvitationInterludes(tools, projectName, parentTurnNumber) {
    const normalizedParentTurn = toInt(parentTurnNumber, 0);
    if (!isPositiveInteger(normalizedParentTurn)) return [];

    const normalizedProjectName = toStringSafe(projectName, 'default_project').toLowerCase();
    const rows = await tools.db.chat.query(`
        SELECT
            i.id AS interlude_id,
            i.ordinal AS interlude_ordinal,
            COALESCE(i.label, '') AS interlude_label
        FROM chat_interludes i
        INNER JOIN chat_turns t
            ON t.id = i.parent_turn_id
        WHERE LOWER(i.project_name) = LOWER(?)
          AND LOWER(t.project_name) = LOWER(i.project_name)
          AND t.creation_turn_number = ?
        ORDER BY i.ordinal ASC, i.id ASC
    `, [normalizedProjectName, normalizedParentTurn]);

    const invitations = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        const interludeOrdinal = toInt(row?.interlude_ordinal, null);
        if (!isPositiveInteger(interludeOrdinal)) continue;

        const interludeTurn = await tools.turns.getByStorageKey(`${normalizedParentTurn}.${interludeOrdinal}`);
        const interludeMeta = interludeTurn?.context?.runtime?.interlude || {};
        if (!isCustomInvitationMeta(interludeMeta)) continue;

        const interludeId = toInt(row?.interlude_id, null);
        if (!isPositiveInteger(interludeId)) continue;
        const participants = await filterInvitableCharactersByClassifier(
            tools?.turnContext,
            tools,
            Array.isArray(interludeMeta.participants) ? interludeMeta.participants : [],
            'snapshot_invitation_read'
        );
        if (participants.length === 0) continue;

        invitations.push({
            interludeId,
            interludeOrdinal: isPositiveInteger(interludeOrdinal) ? interludeOrdinal : null,
            label: sanitizeLabel(row?.interlude_label, participants.length > 0
                ? `Invitation with ${participants.join(', ')}`
                : `Invitation Scene ${interludeOrdinal || interludeId}`),
            participants
        });
    }

    return dedupeInvitationScenesByParticipants(invitations);
}

async function backfillInvitationFactsFromSnapshotScenes(tools, projectName, parentTurnNumber, snapshotScenes, reason = 'snapshot_recovery') {
    const normalizedParentTurn = toInt(parentTurnNumber, 0);
    if (!isPositiveInteger(normalizedParentTurn) || !Array.isArray(snapshotScenes) || snapshotScenes.length === 0) {
        return 0;
    }

    const normalizedProjectName = toStringSafe(projectName, 'default_project').toLowerCase();
    const existingRows = await tools.db.chat.query(`
        SELECT interlude_id, target
        FROM facts
        WHERE LOWER(project_name) = LOWER(?)
          AND turn_number = ?
          AND plugin_id = ?
          AND LOWER(source) = LOWER(?)
          AND predicate = 'CAMP_REST_INVITED'
          AND interlude_id IS NOT NULL
    `, [normalizedProjectName, normalizedParentTurn, PLUGIN_ID, PLUGIN_ID]);

    const existing = new Set((Array.isArray(existingRows) ? existingRows : []).map((row) => {
        return `${toInt(row?.interlude_id, 0)}::${toStringSafe(row?.target, '').toLowerCase()}`;
    }));

    let inserted = 0;
    for (const scene of dedupeInvitationScenesByParticipants(snapshotScenes)) {
        const interludeId = toInt(scene?.interludeId, null);
        const interludeOrdinal = toInt(scene?.interludeOrdinal, null);
        if (!isPositiveInteger(interludeId) || !isPositiveInteger(interludeOrdinal)) continue;

        const participants = await filterInvitableCharactersByClassifier(
            tools?.turnContext,
            tools,
            Array.isArray(scene?.participants) ? scene.participants : [],
            'snapshot_invitation_backfill'
        );
        for (const participant of participants) {
            const key = `${interludeId}::${participant.toLowerCase()}`;
            if (existing.has(key)) continue;
            await tools.db.chat.execute(`
                INSERT INTO facts (
                    turn_number,
                    turn_key,
                    scene_mode,
                    interlude_id,
                    interlude_ordinal,
                    plugin_id,
                    project_name,
                    source,
                    target,
                    predicate,
                    fact_value,
                    context
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                normalizedParentTurn,
                `${normalizedParentTurn}.${interludeOrdinal}`,
                'interlude',
                interludeId,
                interludeOrdinal,
                PLUGIN_ID,
                normalizedProjectName,
                PLUGIN_ID,
                participant,
                'CAMP_REST_INVITED',
                JSON.stringify({ invited: true, recoveredFrom: reason, timestamp: Date.now() }),
                JSON.stringify({
                    parentTurnNumber: normalizedParentTurn,
                    interludeId,
                    interludeOrdinal,
                    recoveredFrom: reason
                })
            ]);
            existing.add(key);
            inserted += 1;
        }
    }

    if (inserted > 0) {
        logInvitationDebug(tools, 'backfilled_missing_invitation_facts', {
            projectName: normalizedProjectName,
            parentTurnNumber: normalizedParentTurn,
            inserted,
            reason
        });
    }
    return inserted;
}

function normalizeCampDirection(value) {
    const dir = String(value || '').trim().toLowerCase();
    return dir === 'left' ? 'left' : 'right';
}

function normalizeCharacterKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function stripFileExtension(value) {
    return String(value || '').replace(/\.[^.]+$/, '');
}

function parseCampSpriteSignature(spritePath) {
    const normalizedPath = String(spritePath || '').replace(/\\/g, '/');
    const filename = path.basename(normalizedPath);
    if (!filename) return null;

    let stem = stripFileExtension(filename).toLowerCase();
    if (!stem) return null;

    let animationLayer = null;
    if (stem.endsWith('_talk_blink')) {
        animationLayer = 'talk_blink';
        stem = stem.slice(0, -11);
    } else if (stem.endsWith('_talk')) {
        animationLayer = 'talk';
        stem = stem.slice(0, -5);
    } else if (stem.endsWith('_blink')) {
        animationLayer = 'blink';
        stem = stem.slice(0, -6);
    }

    if (stem.endsWith('_icon') || stem.endsWith('_reference')) return null;

    const parts = stem.split('_').filter(Boolean);
    if (parts.length === 0) return null;

    let rotation = 'front';
    const last = parts[parts.length - 1];
    if (last === 'front' || last === 'left' || last === 'right' || last === 'back') {
        rotation = parts.pop();
    }

    let emotion = 'neutral';
    if (parts.length >= 2) {
        emotion = parts.pop();
    }

    const characterFromName = normalizeCharacterKey(parts.join('_'));
    return {
        rotation,
        animationLayer,
        emotion: normalizeCharacterKey(emotion) || 'neutral',
        characterFromName
    };
}

function collectTopLevelCampVariantFiles(spriteFiles, characterKeys) {
    const variants = new Map();
    const keys = Array.isArray(characterKeys) ? characterKeys.filter(Boolean) : [];

    for (const spritePath of Array.isArray(spriteFiles) ? spriteFiles : []) {
        const normalizedPath = String(spritePath || '').replace(/\\/g, '/');
        const marker = '/sprites/';
        const markerIndex = normalizedPath.toLowerCase().lastIndexOf(marker);
        const relativePath = markerIndex >= 0
            ? normalizedPath.slice(markerIndex + marker.length)
            : normalizedPath.replace(/^sprites\//i, '');
        const segments = relativePath.split('/').filter(Boolean);

        // Alternate project layout: sprites/<variant>/<file>. Only classify it
        // when the same character occurs in multiple such folders; a lone
        // sprites/<character>/<file> directory remains the normal default layout.
        if (segments.length !== 2) continue;

        const signature = parseCampSpriteSignature(spritePath);
        if (!signature?.characterFromName) continue;
        if (!keys.some((key) => keysLikelyMatch(signature.characterFromName, key))) continue;

        const variantKey = normalizeCharacterKey(segments[0]);
        if (!variantKey) continue;
        if (!variants.has(variantKey)) variants.set(variantKey, []);
        variants.get(variantKey).push(spritePath);
    }

    return variants.size > 1 ? variants : null;
}

function normalizeCampPosition(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return {
        x,
        y,
        direction: typeof raw.direction === 'string' && raw.direction.trim()
            ? normalizeCampDirection(raw.direction)
            : null,
        slot: toStringSafe(raw.slot, `slot_${index + 1}`)
    };
}

function normalizeCampShadow(raw) {
    if (!raw || typeof raw !== 'object' || raw.enabled !== true) return null;
    const out = { enabled: true };
    const copyNumber = (sourceKey, targetKey = sourceKey) => {
        const value = Number(raw[sourceKey]);
        if (Number.isFinite(value)) out[targetKey] = value;
    };

    copyNumber('angleDegrees');
    copyNumber('angle_degrees');
    copyNumber('opacity');
    copyNumber('strength', 'opacity');
    copyNumber('length');
    copyNumber('blur');

    return out;
}

function parseCampLooseLayoutText(rawText) {
    if (typeof rawText !== 'string' || !rawText.trim()) return null;

    const lines = rawText
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    if (lines.length === 0) return null;

    const positions = [];
    let perspectiveRatio = null;
    let perspectiveScaleFar = null;
    let perspectiveScaleNearby = null;

    for (const line of lines) {
        const perspectiveMatch = line.match(/^perspective_ratio\s*[:=]?\s*(-?\d+(?:\.\d+)?)$/i);
        if (perspectiveMatch) {
            const parsed = Number(perspectiveMatch[1]);
            if (Number.isFinite(parsed)) perspectiveRatio = parsed;
            continue;
        }

        const perspectiveFarMatch = line.match(/^(?:perspective_scale_far|perspactive_scale_far)\s*[:=]?\s*(-?\d+(?:\.\d+)?)$/i);
        if (perspectiveFarMatch) {
            const parsed = Number(perspectiveFarMatch[1]);
            if (Number.isFinite(parsed)) perspectiveScaleFar = parsed;
            continue;
        }

        const perspectiveNearMatch = line.match(/^(?:perspective_scale_nearby|perspactive_scale_nearby|perspective_scale_near|perspactive_scale_near)\s*[:=]?\s*(-?\d+(?:\.\d+)?)$/i);
        if (perspectiveNearMatch) {
            const parsed = Number(perspectiveNearMatch[1]);
            if (Number.isFinite(parsed)) perspectiveScaleNearby = parsed;
            continue;
        }

        // Example:
        // 433, 711 right convo 1
        const posMatch = line.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s+(left|right)\s+(.+)$/i);
        if (!posMatch) continue;

        const x = Number(posMatch[1]);
        const y = Number(posMatch[2]);
        const direction = normalizeCampDirection(posMatch[3]);
        const rawSlot = String(posMatch[4] || '').trim();
        const slot = slugify(rawSlot) || `slot_${positions.length + 1}`;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        positions.push({ x, y, direction, slot });
    }

    if (positions.length === 0) return null;

    return {
        positions,
        perspectiveScaleFar: Number.isFinite(perspectiveScaleFar)
            ? perspectiveScaleFar
            : (Number.isFinite(perspectiveRatio) ? perspectiveRatio : null),
        perspectiveScaleNearby: Number.isFinite(perspectiveScaleNearby)
            ? perspectiveScaleNearby
            : (Number.isFinite(perspectiveRatio) ? perspectiveRatio : null),
        perspectiveRatio: Number.isFinite(perspectiveRatio) ? perspectiveRatio : null
    };
}

function parseCampSceneLayout(rawJson) {
    if (typeof rawJson !== 'string' || !rawJson.trim()) return null;

    // Be tolerant of UTF-8 BOM and trailing whitespace produced by some editors/tools.
    const sanitizedJson = rawJson.replace(/^\uFEFF/, '').trim();

    let parsed = null;
    try {
        parsed = JSON.parse(sanitizedJson);
    } catch (_error) {
        return parseCampLooseLayoutText(sanitizedJson);
    }

    const root = (parsed && typeof parsed === 'object') ? parsed : {};
    const rawPositions = Array.isArray(root.positions)
        ? root.positions
        : (
            root.positions && typeof root.positions === 'object'
                ? Object.values(root.positions)
                : (Array.isArray(parsed) ? parsed : [])
        );
    const positions = rawPositions
        .map((entry, index) => normalizeCampPosition(entry, index))
        .filter(Boolean);

    if (positions.length === 0) return null;

    const perspectiveRatio = Number(root.perspective_ratio);
    const perspectiveScaleFar = Number(root.perspective_scale_far ?? root.perspactive_scale_far);
    const perspectiveScaleNearby = Number(root.perspective_scale_nearby ?? root.perspactive_scale_nearby ?? root.perspective_scale_near ?? root.perspactive_scale_near);
    const shadow = normalizeCampShadow(root.shadow);

    return {
        positions,
        perspectiveScaleFar: Number.isFinite(perspectiveScaleFar)
            ? perspectiveScaleFar
            : (Number.isFinite(perspectiveRatio) ? perspectiveRatio : null),
        perspectiveScaleNearby: Number.isFinite(perspectiveScaleNearby)
            ? perspectiveScaleNearby
            : (Number.isFinite(perspectiveRatio) ? perspectiveRatio : null),
        perspectiveRatio: Number.isFinite(perspectiveRatio) ? perspectiveRatio : null,
        shadow
    };
}

function collectCampScenesFromDirectory(directoryPath, { source, buildBackgroundUrl, logger }) {
    if (!directoryPath || !fs.existsSync(directoryPath)) return [];

    let entries = [];
    try {
        entries = fs.readdirSync(directoryPath, { withFileTypes: true }).filter(entry => entry.isFile());
    } catch (error) {
        logger?.warn?.(`[${PLUGIN_ID}] Failed reading camp directory '${directoryPath}': ${error.message}`);
        return [];
    }

    const grouped = new Map();
    for (const entry of entries) {
        const ext = path.extname(entry.name).toLowerCase();
        const base = path.basename(entry.name, ext);
        if (!base) continue;
        if (!grouped.has(base)) {
            grouped.set(base, { mediaName: null, jsonName: null });
        }
        const row = grouped.get(base);
        if (ext === '.json') {
            row.jsonName = entry.name;
        } else if (CAMP_MEDIA_EXTENSIONS.has(ext) && !row.mediaName) {
            row.mediaName = entry.name;
        }
    }

    const out = [];
    const sortedBases = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
    for (const base of sortedBases) {
        const pair = grouped.get(base);
        if (!pair?.mediaName || !pair?.jsonName) continue;

        const jsonPath = path.join(directoryPath, pair.jsonName);
        const mediaExt = path.extname(pair.mediaName).toLowerCase();
        let parsedLayout = null;
        try {
            const rawJson = fs.readFileSync(jsonPath, 'utf8');
            parsedLayout = parseCampSceneLayout(rawJson);
        } catch (error) {
            logger?.warn?.(`[${PLUGIN_ID}] Failed reading camp layout JSON '${jsonPath}': ${error.message}`);
            continue;
        }
        if (!parsedLayout) {
            logger?.warn?.(`[${PLUGIN_ID}] Camp layout JSON is invalid or has no positions: '${jsonPath}'`);
            continue;
        }

        const backgroundUrl = buildBackgroundUrl(pair.mediaName);
        if (!backgroundUrl) continue;

        out.push({
            id: base,
            source,
            backgroundUrl,
            backgroundIsVideo: CAMP_VIDEO_EXTENSIONS.has(mediaExt),
            positions: parsedLayout.positions,
            perspectiveScaleFar: parsedLayout.perspectiveScaleFar,
            perspectiveScaleNearby: parsedLayout.perspectiveScaleNearby,
            perspectiveRatio: parsedLayout.perspectiveRatio,
            shadow: parsedLayout.shadow
        });
    }

    return out;
}

function pickRandomEntry(list) {
    if (!Array.isArray(list) || list.length === 0) return null;
    if (list.length === 1) return list[0];
    const idx = Math.floor(Math.random() * list.length);
    return list[idx];
}

function resolveCampSceneSelection(context, tools, projectName) {
    const normalizedProject = toStringSafe(projectName, 'default_project');
    const projectCampDir = path.join(process.cwd(), 'workspace', 'projects', normalizedProject, CAMP_PROJECT_DIR_REL);
    const logger = tools?.logger;

    const projectScenes = collectCampScenesFromDirectory(projectCampDir, {
        source: 'project',
        logger,
        buildBackgroundUrl: (mediaName) => {
            const rel = path.posix.join('assets', 'backgrounds', 'camp', mediaName.replace(/\\/g, '/'));
            return tools.assets.resolveUrl(rel, { projectNameOverride: normalizedProject });
        }
    });

    if (projectScenes.length > 0) {
        return pickRandomEntry(projectScenes);
    }

    const fallbackScenes = collectCampScenesFromDirectory(CAMP_PLUGIN_FALLBACK_DIR, {
        source: 'plugin_fallback',
        logger,
        buildBackgroundUrl: (mediaName) => {
            const rel = path.posix.join('assets', 'camp', mediaName.replace(/\\/g, '/'));
            // Use the intercept bridge's explicit plugin scheme. A relative plugin path
            // would otherwise be resolved again as a project asset by the overlay UI.
            return `plugin://${PLUGIN_ID}/${rel}`;
        }
    });

    if (fallbackScenes.length > 0) {
        return pickRandomEntry(fallbackScenes);
    }

    return null;
}

function resolveCatalogCharacterKey(rawCharacterName, spriteCatalog) {
    const normalized = normalizeCharacterKey(rawCharacterName);
    if (!normalized || !spriteCatalog || !spriteCatalog.characters) return null;
    if (spriteCatalog.characters[normalized]) return normalized;

    const aliasMap = spriteCatalog.lookups?.byAlias || {};
    const compactKey = normalized.replace(/_/g, '');
    const aliasCandidates = [normalized, compactKey];
    for (const candidate of aliasCandidates) {
        const hits = Array.isArray(aliasMap[candidate]) ? aliasMap[candidate] : [];
        if (hits.length > 0) return hits[0];
    }

    const firstNameMap = spriteCatalog.lookups?.byFirstName || {};
    const firstName = normalized.split('_')[0];
    const firstHits = Array.isArray(firstNameMap[firstName]) ? firstNameMap[firstName] : [];
    if (firstHits.length > 0) return firstHits[0];

    const characterKeys = Object.keys(spriteCatalog.characters);
    const fuzzy = characterKeys.find((key) => key.includes(normalized) || normalized.includes(key));
    return fuzzy || null;
}

function keysLikelyMatch(a, b) {
    const normA = normalizeCharacterKey(a);
    const normB = normalizeCharacterKey(b);
    if (!normA || !normB) return false;
    if (normA === normB) return true;
    const compactA = normA.replace(/_/g, '');
    const compactB = normB.replace(/_/g, '');
    if (compactA && compactB && compactA === compactB) return true;
    return compactA.includes(compactB) || compactB.includes(compactA);
}

async function buildCampSpriteProfiles(context, tools, allCharacters, _projectName) {
    const profiles = {};
    const projectSpriteFiles = await tools.assets.listSprites({ source: 'filesystem', format: 'asset' });
    const spriteMetadata = await tools.assets.getSpriteMetadata();
    const runtimeSpriteCatalog = context?.runtime?.vnManager?.spriteCatalog || null;
    // GUI intercepts rebuilt from a saved turn do not retain runtime state. Rebuild the
    // same catalog shape from project assets instead of pooling all of a character's files.
    const projectSpriteCatalog = buildSpriteCatalog(projectSpriteFiles);
    const toFrontendUrl = (relativeSpritePath) => {
        const rel = String(relativeSpritePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
        return tools.assets.resolveUrl(rel, { kind: 'sprites' });
    };

    for (const characterName of allCharacters) {
        const normalizedName = normalizeCharacterKey(characterName);
        if (!normalizedName) continue;

        const runtimeCatalogKey = resolveCatalogCharacterKey(characterName, runtimeSpriteCatalog);
        const projectCatalogKey = resolveCatalogCharacterKey(characterName, projectSpriteCatalog);
        const catalogKey = runtimeCatalogKey || projectCatalogKey || normalizedName;
        const characterState = runtimeCatalogKey
            ? runtimeSpriteCatalog?.characters?.[runtimeCatalogKey]
            : projectSpriteCatalog?.characters?.[projectCatalogKey];
        const variantData = characterState?.variantData || {};
        const lockedVariant = getSceneVariantLock(
            context,
            [catalogKey, characterName, normalizedName],
            Number.MAX_SAFE_INTEGER
        );
        const variantCandidates = [
            lockedVariant,
            characterState?.defaultVariant,
            ...(Array.isArray(characterState?.variants) ? characterState.variants : [])
        ].filter((variant, index, values) => typeof variant === 'string' && variant && values.indexOf(variant) === index);
        const topLevelVariantFiles = collectTopLevelCampVariantFiles(
            projectSpriteFiles,
            [catalogKey, characterName, normalizedName]
        );
        const variantKey = topLevelVariantFiles
            ? variantCandidates.find((variant) => (topLevelVariantFiles.get(variant) || []).length > 0)
            : variantCandidates.find((variant) => Array.isArray(variantData?.[variant]?.files) && variantData[variant].files.length > 0);
        const variantState = variantKey ? variantData[variantKey] : null;
        const sourceFiles = topLevelVariantFiles
            ? [...(topLevelVariantFiles.get(variantKey) || [])]
            : (Array.isArray(variantState?.files) ? [...variantState.files] : []);
        const metadata = spriteMetadata?.characters?.[catalogKey]
            || await tools.assets.getCharacterSpriteMetadata(characterName);

        if (sourceFiles.length === 0) continue;

        const emotionMap = {};
        let fallbackSprite = '';
        let hasBlink = false;
        let hasTalk = false;
        let hasTalkBlink = false;
        const layerPriority = { base: 0, blink: 1, talk: 2, talk_blink: 3 };
        const sortedSourceFiles = [...sourceFiles].sort((a, b) => {
            const aSig = parseCampSpriteSignature(a);
            const bSig = parseCampSpriteSignature(b);
            const aLayer = aSig?.animationLayer || 'base';
            const bLayer = bSig?.animationLayer || 'base';
            const aRank = Object.prototype.hasOwnProperty.call(layerPriority, aLayer) ? layerPriority[aLayer] : 99;
            const bRank = Object.prototype.hasOwnProperty.call(layerPriority, bLayer) ? layerPriority[bLayer] : 99;
            if (aRank !== bRank) return aRank - bRank;
            return String(a).localeCompare(String(b));
        });

        for (const sourceFile of sortedSourceFiles) {
            const sig = parseCampSpriteSignature(sourceFile);
            if (!sig) continue;

            if (sig.animationLayer === 'blink') hasBlink = true;
            if (sig.animationLayer === 'talk') hasTalk = true;
            if (sig.animationLayer === 'talk_blink') {
                hasTalk = true;
                hasBlink = true;
                hasTalkBlink = true;
            }

            const frontendUrl = toFrontendUrl(sourceFile);
            if (!frontendUrl) continue;
            if (!fallbackSprite) fallbackSprite = frontendUrl;

            const emotionKey = sig.emotion || 'neutral';
            if (!emotionMap[emotionKey]) {
                emotionMap[emotionKey] = {
                    front: '',
                    left: '',
                    right: '',
                    back: '',
                    any: ''
                };
            }
            if (!emotionMap[emotionKey].any) emotionMap[emotionKey].any = frontendUrl;
            if (!emotionMap[emotionKey][sig.rotation]) {
                emotionMap[emotionKey][sig.rotation] = frontendUrl;
            }
        }

        const emotionKeys = Object.keys(emotionMap);
        if (emotionKeys.length === 0) continue;

        profiles[normalizedName] = {
            characterName: characterName,
            catalogKey,
            variantKey,
            rotations: Array.isArray(characterState?.rotations) ? characterState.rotations : [],
            capabilities: {
                hasBlink,
                hasTalk,
                hasTalkBlink
            },
            emotions: emotionKeys,
            byEmotion: emotionMap,
            fallbackSprite,
            metadataScale: Number.isFinite(Number(metadata?.scale)) && Number(metadata.scale) > 0
                ? Number(metadata.scale)
                : 1
        };
    }

    return profiles;
}

function gatherCharacterPool(context) {
    const party = Array.isArray(context?.output?.party) ? context.output.party : [];
    const prominent = Array.isArray(context?.output?.prominentCharacters) ? context.output.prominentCharacters : [];
    const playerCharName = String(context?.input?.playerCharacterName || '').trim().toLowerCase();
    const all = dedupeStrings([...party, ...prominent])
        .filter(char => char && String(char).trim().toLowerCase() !== playerCharName);
    return all.slice(0, 10);
}

function normalizeLocationKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getWorldLocationName(location) {
    return toStringSafe(location?.name || location?.characterName || location?.character_name, '');
}

function getWorldLocationAnchor(location) {
    return toStringSafe(
        location?.anchorNode
        || location?.anchor_node
        || location?.anchor
        || location?.specificLocation
        || location?.specific_location,
        ''
    );
}

function getWorldLocationSpecific(location) {
    return toStringSafe(
        location?.specificLocation
        || location?.specific_location
        || location?.location
        || location?.anchorNode
        || location?.anchor_node,
        ''
    );
}

function getLatestLocationTimelineEntry(context) {
    const timeline = Array.isArray(context?.output?.locationTimeline) ? context.output.locationTimeline : [];
    if (timeline.length === 0) return null;
    return timeline[timeline.length - 1] || null;
}

function collectCurrentAnchorKeys(context, worldLocations, sceneCharacters) {
    const anchorKeys = new Set();
    const addAnchor = (value) => {
        const key = normalizeLocationKey(value);
        if (key) anchorKeys.add(key);
    };

    const finalLocation = getLatestLocationTimelineEntry(context);
    if (finalLocation) {
        addAnchor(finalLocation.anchorNode || finalLocation.anchor_node || finalLocation.anchor);
        if (anchorKeys.size === 0) {
            addAnchor(finalLocation.name || finalLocation.specificLocation || finalLocation.specific_location);
        }
    }

    const sceneCharacterKeys = new Set(
        dedupeStrings([...(Array.isArray(sceneCharacters) ? sceneCharacters : []), context?.input?.playerCharacterName])
            .map(normalizeCharacterKey)
            .filter(Boolean)
    );

    for (const location of Array.isArray(worldLocations) ? worldLocations : []) {
        const nameKey = normalizeCharacterKey(getWorldLocationName(location));
        if (!nameKey || !sceneCharacterKeys.has(nameKey)) continue;
        addAnchor(getWorldLocationAnchor(location));
    }

    return anchorKeys;
}

function formatWorldReachNote(location) {
    const name = getWorldLocationName(location);
    const specific = getWorldLocationSpecific(location);
    const anchor = getWorldLocationAnchor(location);
    const context = toStringSafe(location?.context, '');
    const place = specific && anchor && normalizeLocationKey(specific) !== normalizeLocationKey(anchor)
        ? `${specific} (${anchor})`
        : (specific || anchor || 'same anchor');
    const contextSuffix = context ? `, context: ${context}` : '';
    return `${name}: reachable at ${place}${contextSuffix}`;
}

async function gatherWorldLocationReach(context, tools, basePool) {
    const result = { names: [], notesByKey: new Map() };
    try {
        if (!tools?.plugins?.isInstalled?.(WORLD_LOCATION_TRACKER_PLUGIN_ID)) return result;

        const worldLocations = await tools.plugins.call(WORLD_LOCATION_TRACKER_PLUGIN_ID, 'getAllCharacterLocations');
        if (!Array.isArray(worldLocations) || worldLocations.length === 0) return result;

        const anchorKeys = collectCurrentAnchorKeys(context, worldLocations, basePool);
        if (anchorKeys.size === 0) return result;

        const baseKeys = new Set(dedupeStrings(basePool).map(normalizeCharacterKey).filter(Boolean));
        const playerKey = normalizeCharacterKey(context?.input?.playerCharacterName);

        for (const location of worldLocations) {
            const name = getWorldLocationName(location);
            const nameKey = normalizeCharacterKey(name);
            if (!name || !nameKey || nameKey === playerKey || baseKeys.has(nameKey)) continue;

            const anchorKey = normalizeLocationKey(getWorldLocationAnchor(location));
            if (!anchorKey || !anchorKeys.has(anchorKey)) continue;

            result.names.push(name);
            result.notesByKey.set(nameKey, formatWorldReachNote(location));
        }
    } catch (error) {
        tools?.logger?.warn?.(`[${PLUGIN_ID}] Failed to gather same-anchor characters from ${WORLD_LOCATION_TRACKER_PLUGIN_ID}; using scene-local camp roster.`, error);
    }
    return result;
}

async function gatherDedicatedSpritePartyFallback(context, tools) {
    const playerKey = normalizeCharacterKey(context?.input?.playerCharacterName);
    const party = dedupeStrings(Array.isArray(context?.output?.party) ? context.output.party : [])
        .filter(name => normalizeCharacterKey(name) !== playerKey);
    if (party.length === 0) return [];

    const profiles = await buildCampSpriteProfiles(context, tools, party, context?.projectName);
    return party.filter(name => !!profiles[normalizeCharacterKey(name)]);
}

async function gatherInvitableCharacterPoolWithReach(context, tools) {
    const rawPool = gatherCharacterPool(context);
    const worldReach = await gatherWorldLocationReach(context, tools, rawPool);
    const mergedPool = dedupeStrings([...rawPool, ...worldReach.names]);
    let filteredPool = await filterInvitableCharactersByClassifier(
        context,
        tools,
        mergedPool,
        'active_invitation_pool'
    );
    if (filteredPool.length === 0) {
        filteredPool = await gatherDedicatedSpritePartyFallback(context, tools);
        if (filteredPool.length > 0) {
            tools?.logger?.warn?.(`[${PLUGIN_ID}] Classifier returned no inviteable characters; using current party members with dedicated sprites: ${filteredPool.join(', ')}`);
        }
    }
    const slicedPool = filteredPool.slice(0, 12);
    const acceptedKeys = new Set(slicedPool.map(normalizeCharacterKey).filter(Boolean));
    const reachNotes = Array.from(worldReach.notesByKey.entries())
        .filter(([key]) => acceptedKeys.has(key))
        .map(([, note]) => note)
        .slice(0, 8);

    return {
        characters: slicedPool,
        reachNotes
    };
}

async function gatherInvitableCharacterPool(context, tools) {
    const reach = await gatherInvitableCharacterPoolWithReach(context, tools);
    return reach.characters;
}

function extractJson(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const trimmed = text.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) return trimmed;

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
        const candidate = fenced[1].trim();
        if ((candidate.startsWith('[') && candidate.endsWith(']')) || (candidate.startsWith('{') && candidate.endsWith('}'))) return candidate;
    }

    const matchArray = trimmed.match(/\[[\s\S]*\]/);
    const matchObj = trimmed.match(/\{[\s\S]*\}/);
    if (matchArray && matchObj) {
        return matchArray.index < matchObj.index ? matchArray[0] : matchObj[0];
    }
    return matchArray ? matchArray[0] : (matchObj ? matchObj[0] : null);
}

function normalizeChoice(raw, index, fallbackParticipants = []) {
    const fallbackLabel = DEFAULT_CHOICES[index % DEFAULT_CHOICES.length].label;
    const label = sanitizeLabel(raw?.label || raw?.title, fallbackLabel);
    const prompt = sanitizePrompt(raw?.prompt, `Write this interlude scene: ${label}`);
    const optionKey = slugify(raw?.optionKey || raw?.key || label || `scene_${index + 1}`);
    const participants = dedupeStrings(Array.isArray(raw?.participants) ? raw.participants : fallbackParticipants);

    return {
        optionKey,
        label,
        prompt,
        participants
    };
}

function buildFallbackChoices(context, charactersOverride = null) {
    const pool = Array.isArray(charactersOverride)
        ? dedupeStrings(charactersOverride)
        : gatherCharacterPool(context);
    const [a, b, c] = pool;

    return DEFAULT_CHOICES.map((choice, index) => {
        const participants = [];
        if (index === 0) {
            if (a) participants.push(a);
            if (b) participants.push(b);
        } else if (index === 1) {
            if (b || a) participants.push(b || a);
        } else if (index === 2) {
            if (a) participants.push(a);
            if (c || b) participants.push(c || b);
        }

        return {
            ...choice,
            participants: dedupeStrings(participants)
        };
    });
}

async function getStoredInterludeQuote(tools, projectName, parentTurnNumber) {
    const scope = buildParentScope(parentTurnNumber);
    let rows = await tools.db.chat.query(`
        SELECT fact_value
        FROM facts
        WHERE LOWER(project_name) = LOWER(?)
          AND turn_number = ?
          AND turn_key = ?
          AND plugin_id = ?
          AND LOWER(source) = LOWER(?)
          AND predicate = 'CAMP_REST_QUOTE'
    `, [projectName, scope.turnNumber, scope.turnKey, scope.pluginId, PLUGIN_ID]);

    if (!Array.isArray(rows) || rows.length === 0) {
        rows = await tools.db.chat.query(`
            SELECT fact_value
            FROM facts
            WHERE LOWER(project_name) = LOWER(?)
              AND turn_number = ?
              AND LOWER(source) = LOWER(?)
              AND predicate = 'CAMP_REST_QUOTE'
        `, [projectName, scope.turnNumber, PLUGIN_ID]);
    }

    if (Array.isArray(rows) && rows.length > 0) {
        return rows[0].fact_value || '';
    }
    return '';
}

async function getStoredInterludeSummary(tools, projectName, parentTurnNumber) {
    const scope = buildParentScope(parentTurnNumber);
    let rows = await tools.db.chat.query(`
        SELECT fact_value
        FROM facts
        WHERE LOWER(project_name) = LOWER(?)
          AND turn_number = ?
          AND turn_key = ?
          AND plugin_id = ?
          AND LOWER(source) = LOWER(?)
          AND predicate = 'CAMP_REST_SUMMARY'
    `, [projectName, scope.turnNumber, scope.turnKey, scope.pluginId, PLUGIN_ID]);

    if (!Array.isArray(rows) || rows.length === 0) {
        rows = await tools.db.chat.query(`
            SELECT fact_value
            FROM facts
            WHERE LOWER(project_name) = LOWER(?)
              AND turn_number = ?
              AND LOWER(source) = LOWER(?)
              AND predicate = 'CAMP_REST_SUMMARY'
        `, [projectName, scope.turnNumber, PLUGIN_ID]);
    }

    if (Array.isArray(rows) && rows.length > 0) {
        return rows[0].fact_value || '';
    }
    return '';
}

async function getStoredOptions(tools, projectName, parentTurnNumber) {
    const scope = buildParentScope(parentTurnNumber);
    let rows = await tools.db.chat.query(`
        SELECT target AS option_key, fact_value
        FROM facts
        WHERE LOWER(project_name) = LOWER(?)
          AND turn_number = ?
          AND turn_key = ?
          AND plugin_id = ?
          AND LOWER(source) = LOWER(?)
          AND predicate = ?
        ORDER BY id ASC
    `, [projectName, scope.turnNumber, scope.turnKey, scope.pluginId, PLUGIN_ID, OPTION_FACT_PREDICATE]);

    const options = [];
    for (const row of rows) {
        const payload = safeJsonParse(row.fact_value, {});
        const optionKey = slugify(payload.optionKey || row.option_key || 'scene');
        const fallback = DEFAULT_CHOICES[options.length % DEFAULT_CHOICES.length];
        const participants = await filterCampParticipantsPreservingPlayer(
            tools?.turnContext,
            tools,
            Array.isArray(payload.participants) ? payload.participants : [],
            'stored_option_participants'
        );
        options.push({
            optionKey,
            label: sanitizeLabel(payload.label, fallback.label),
            prompt: sanitizePrompt(payload.prompt, fallback.prompt),
            participants,
            interludeId: toInt(payload.interludeId, null),
            runProfileId: toStringSafe(payload.runProfileId, DEFAULT_RUN_PROFILE_ID)
        });
    }

    const boundInterludeIds = Array.from(
        new Set(
            options
                .map(option => toInt(option.interludeId, null))
                .filter(id => isPositiveInteger(id))
        )
    );

    if (boundInterludeIds.length > 0) {
        const placeholders = boundInterludeIds.map(() => '?').join(', ');
        const liveRows = await tools.db.chat.query(
            `SELECT id
             FROM chat_interludes
             WHERE LOWER(project_name) = LOWER(?)
               AND id IN (${placeholders})`,
            [toStringSafe(projectName, 'default_project').toLowerCase(), ...boundInterludeIds]
        );
        const liveIds = new Set(liveRows.map(row => toInt(row.id, null)).filter(id => isPositiveInteger(id)));
        const stale = options.filter(option => isPositiveInteger(option.interludeId) && !liveIds.has(option.interludeId));

        for (const option of stale) {
            option.interludeId = null;
            await bindInterludeToChoice(
                tools,
                projectName,
                parentTurnNumber,
                option.optionKey,
                null,
                option.runProfileId || DEFAULT_RUN_PROFILE_ID
            );
        }
    }

    return options;
}

async function deleteStoredOptions(tools, projectName, parentTurnNumber, optionKey = null) {
    const scope = buildParentScope(parentTurnNumber);
    const normalizedProjectName = toStringSafe(projectName, 'default_project').toLowerCase();
    if (optionKey) {
        await tools.db.chat.execute(`
            DELETE FROM facts
            WHERE turn_number = ?
              AND turn_key = ?
              AND LOWER(project_name) = LOWER(?)
              AND plugin_id = ?
              AND LOWER(source) = LOWER(?)
              AND predicate = ?
              AND LOWER(target) = LOWER(?)
        `, [scope.turnNumber, scope.turnKey, normalizedProjectName, scope.pluginId, PLUGIN_ID, OPTION_FACT_PREDICATE, String(optionKey).toLowerCase()]);

        return;
    }

    await tools.db.chat.execute(`
        DELETE FROM facts
        WHERE turn_number = ?
          AND turn_key = ?
          AND LOWER(project_name) = LOWER(?)
          AND plugin_id = ?
          AND LOWER(source) = LOWER(?)
          AND predicate = ?
    `, [scope.turnNumber, scope.turnKey, normalizedProjectName, scope.pluginId, PLUGIN_ID, OPTION_FACT_PREDICATE]);

}

async function upsertChoices(tools, projectName, parentTurnNumber, choices, runProfileId = DEFAULT_RUN_PROFILE_ID, interludeQuote = '', interludeSummary = '') {
    const scope = buildParentScope(parentTurnNumber);
    const normalizedProjectName = toStringSafe(projectName, 'default_project').toLowerCase();
    // Turn-scoped write policy: always clear previous turn payload before inserting a fresh set.
    await deleteStoredOptions(tools, normalizedProjectName, scope.turnNumber);

    await tools.db.chat.execute(`
        DELETE FROM facts
        WHERE LOWER(project_name) = LOWER(?)
          AND turn_number = ?
          AND turn_key = ?
          AND plugin_id = ?
          AND LOWER(source) = LOWER(?)
          AND predicate IN ('CAMP_REST_QUOTE', 'CAMP_REST_SUMMARY')
    `, [normalizedProjectName, scope.turnNumber, scope.turnKey, scope.pluginId, PLUGIN_ID]);

    if (interludeQuote) {
        await tools.db.chat.execute(`
            INSERT INTO facts (
                turn_number,
                turn_key,
                scene_mode,
                interlude_id,
                interlude_ordinal,
                plugin_id,
                project_name,
                source,
                target,
                predicate,
                fact_value,
                context
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            scope.turnNumber,
            scope.turnKey,
            scope.sceneMode,
            null,
            null,
            scope.pluginId,
            normalizedProjectName,
            PLUGIN_ID,
            'interlude_quote',
            'CAMP_REST_QUOTE',
            interludeQuote,
            null
        ]);
    }

    if (interludeSummary) {
        await tools.db.chat.execute(`
            INSERT INTO facts (
                turn_number,
                turn_key,
                scene_mode,
                interlude_id,
                interlude_ordinal,
                plugin_id,
                project_name,
                source,
                target,
                predicate,
                fact_value,
                context
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            scope.turnNumber,
            scope.turnKey,
            scope.sceneMode,
            null,
            null,
            scope.pluginId,
            normalizedProjectName,
            PLUGIN_ID,
            'interlude_summary',
            'CAMP_REST_SUMMARY',
            interludeSummary,
            null
        ]);
    }

    for (const choice of choices) {
        const participants = await filterCampParticipantsPreservingPlayer(
            tools?.turnContext,
            tools,
            choice.participants || [],
            'upsert_choice_participants'
        );
        const factValue = JSON.stringify({
            optionKey: choice.optionKey,
            label: choice.label,
            prompt: choice.prompt,
            participants,
            interludeId: null,
            runProfileId
        });

        await tools.db.chat.execute(`
            INSERT INTO facts (
                turn_number,
                turn_key,
                scene_mode,
                interlude_id,
                interlude_ordinal,
                plugin_id,
                project_name,
                source,
                target,
                predicate,
                fact_value,
                context
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            scope.turnNumber,
            scope.turnKey,
            scope.sceneMode,
            null,
            null,
            scope.pluginId,
            normalizedProjectName,
            PLUGIN_ID,
            choice.optionKey,
            OPTION_FACT_PREDICATE,
            factValue,
            JSON.stringify({ parentTurnNumber, runProfileId })
        ]);
    }
}

async function bindInterludeToChoice(tools, projectName, parentTurnNumber, optionKey, interludeId, runProfileId = DEFAULT_RUN_PROFILE_ID) {
    const scope = buildParentScope(parentTurnNumber);
    const normalizedProjectName = toStringSafe(projectName, 'default_project').toLowerCase();
    const rows = await tools.db.chat.query(`
        SELECT target AS option_key, fact_value
        FROM facts
        WHERE LOWER(project_name) = LOWER(?)
          AND turn_number = ?
          AND turn_key = ?
          AND plugin_id = ?
          AND LOWER(source) = LOWER(?)
          AND predicate = ?
          AND LOWER(target) = LOWER(?)
        ORDER BY id DESC
        LIMIT 1
    `, [normalizedProjectName, scope.turnNumber, scope.turnKey, scope.pluginId, PLUGIN_ID, OPTION_FACT_PREDICATE, String(optionKey).toLowerCase()]);
    const row = rows[0];
    if (!row) return;

    const payload = safeJsonParse(row.fact_value, {});
    const filteredParticipants = await filterCampParticipantsPreservingPlayer(
        tools?.turnContext,
        tools,
        Array.isArray(payload.participants) ? payload.participants : [],
        'bind_option_participants'
    );
    const existing = {
        optionKey: slugify(payload.optionKey || row.option_key || optionKey || 'scene'),
        label: sanitizeLabel(payload.label, 'Downtime Scene'),
        prompt: sanitizePrompt(payload.prompt, 'Write a grounded downtime scene that fits the current context.'),
        participants: filteredParticipants,
        runProfileId: toStringSafe(payload.runProfileId, runProfileId || DEFAULT_RUN_PROFILE_ID)
    };

    // Replace this option's turn-row atomically (delete then insert) to avoid stale duplicates.
    await deleteStoredOptions(tools, normalizedProjectName, scope.turnNumber, existing.optionKey);

    const normalizedInterludeId = isPositiveInteger(interludeId) ? interludeId : null;
    const resolvedRunProfileId = toStringSafe(runProfileId, existing.runProfileId || DEFAULT_RUN_PROFILE_ID);
    const factValue = JSON.stringify({
        optionKey: existing.optionKey,
        label: existing.label,
        prompt: existing.prompt,
        participants: dedupeStrings(existing.participants || []),
        interludeId: normalizedInterludeId,
        runProfileId: resolvedRunProfileId
    });

    const contextPayload = {
        parentTurnNumber,
        runProfileId: resolvedRunProfileId
    };
    if (normalizedInterludeId) {
        contextPayload.boundInterlude = normalizedInterludeId;
    }

    await tools.db.chat.execute(`
        INSERT INTO facts (
            turn_number,
            turn_key,
            scene_mode,
            interlude_id,
            interlude_ordinal,
            plugin_id,
            project_name,
            source,
            target,
            predicate,
            fact_value,
            context
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        scope.turnNumber,
        scope.turnKey,
        scope.sceneMode,
        null,
        null,
        scope.pluginId,
        normalizedProjectName,
        PLUGIN_ID,
        existing.optionKey,
        OPTION_FACT_PREDICATE,
        factValue,
        JSON.stringify(contextPayload)
    ]);
}

function shouldOfferCampOverlay(context, settings) {
    if (settings.enabled === false) return false;
    if (context?.sceneMode !== 'mainline') return false;
    if (settings.force_offer_every_turn === true) return true;

    const director = context?.processed?.director || {};
    const phase = normalizePhase(director.scenePhase);
    const pluginId = toStringSafe(director.scenePluginId, '');

    if (!['CAMP', 'REST', 'RESTING'].includes(phase)) return false;
    if (pluginId && pluginId !== PLUGIN_ID) return false;
    return true;
}

function truncateText(value, maxChars = 12000) {
    const text = toStringSafe(value, '');
    if (!text) return '';
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function collectPromptSection(context, slotName) {
    const pc = context?.promptComponents || {};
    const root = Array.isArray(pc?.root?.[slotName]) ? pc.root[slotName] : [];
    const writer = Array.isArray(pc?.writer?.[slotName]) ? pc.writer[slotName] : [];
    const joined = [...root, ...writer].filter(Boolean).join('\n\n');
    return joined;
}

function buildChoiceContextPrompt(context, characters, reachContext = {}) {
    const partyText = characters.length > 0 ? characters.join(', ') : 'Unknown';
    const reachNotes = Array.isArray(reachContext?.reachNotes)
        ? reachContext.reachNotes.filter(Boolean)
        : [];
    const reachText = reachNotes.length > 0
        ? reachNotes.map(note => `- ${note}`).join('\n')
        : '(none)';
    const playerName = toStringSafe(context?.input?.playerCharacterName, 'Player');

    const canonData = truncateText(collectPromptSection(context, 'canon'), 32000);
    const dynamicKnowledge = truncateText(collectPromptSection(context, 'dynamic_knowledge'), 28000);
    const simulationState = truncateText(collectPromptSection(context, 'simulation'), 24000);
    const promptHistory = collectPromptSection(context, 'history');
    const narrativeHistory = toStringSafe(context?.runtime?.narrativeHistory, '');
    const history = truncateText(narrativeHistory || promptHistory || context?.runtime?.historyData?.summaryHistory || '', 42000);
    const writerBrief = truncateText(context?.processed?.director?.writerBrief || '', 6000);
    const latestChapter = truncateText(context?.processed?.narrativeEngine?.writerResponse || '', 12000);
    const currentAction = truncateText(context?.input?.userPrompt || '', 2500);

    return `
# PART 1: THE CANON (REFERENCE DATA)
${canonData || '(none)'}

# PART 2: DYNAMIC KNOWLEDGE
${dynamicKnowledge || '(none)'}

# PART 3: THE NARRATIVE STREAM (HISTORY)
${history || '(none)'}

# PART 4: THE SIMULATION (CURRENT STATE)
${simulationState || '(none)'}

# PART 5: CURRENT TURN SNAPSHOT
PLAYER CHARACTER: ${playerName}
Inviteable nearby/reachable character pool: ${partyText}
Reach evidence for offscreen same-anchor characters:
${reachText}
Current player action: ${currentAction || '(none)'}
Director brief excerpt: ${writerBrief || '(none)'}

# PART 6: LATEST CHAPTER EXCERPT
${latestChapter || '(none)'}
`.trim();
}

function buildChoiceMessages(context, characters, reachContext = {}) {
    const contextPrompt = buildChoiceContextPrompt(context, characters, reachContext);
    const taskPrompt = `
You are generating optional downtime interlude hooks for a visual novel.

Return ONLY a valid JSON object with exactly three fields:
1. "interludeQuote": A mood-setting line or quote for this turn's interlude. For example: "The fire crackles expectantly... who shall join your circle tonight?", "The wind howls outside the tavern, but the hearth is warm.", "A tense silence falls over the camp.", "The group wanders through the streets.", Make it grounded and highly specific to the current setting/location.
2. "interludeSummary": A beautifully written context sentence summarizing the current environment or interlude setting. For example: "A moment of rest while the party enjoys their pleasant evening in Jandor City.", "The party settles around a soft campfire under the desert stars.", "Downtime falls upon the bustling town." Make it grounded in the current location.
3. "characterList": The list of all nearby/reachable characters in the inviteable character pool that could be invited to the interlude.
4. "mainCharacterList": The list of the main characters out of the characterList.
5. "choices": A JSON array with 3 to 5 objects.

Each choice object must include:
- "label": a vivid player-facing scene title, max 12 words
- "prompt": a summary of the scene with up to 80 words
- "participants": array of character names
- "tone": one of ["comedic", "intimate", "tense", "romantic", "melancholy", "mischievous", "reflective", "warm", "awkward"]

Goal:
Create downtime scenes that feel like hand-authored companion content, not generic errands.

Hard requirements:
- Every scene must be anchored to at least TWO specifics from the current story context:
  - a recent event
  - a current location detail
  - a known character conflict
  - a relationship dynamic
  - a named NPC
  - a strange object
  - an unresolved question
  - a running joke
  - a wound, fear, promise, debt, lie, rumor, or habit
  - etc.
- Keep scenes low-stakes, character-driven, and suitable for camp/rest/town downtime.
- No major canon shifts, no world-ending revelations, no timeline jumps.
- Do not resolve major plot arcs. You may deepen, complicate, tease, or foreshadow them.
- Prefer participants from the inviteable nearby/reachable character pool.
- Characters listed in Reach evidence share the current world-location anchor and may be invited even if they were not in the immediate VN scene.
- Treat reach evidence as advisory if the latest chapter clearly says a character has become unavailable or left the area.
- You may include nearby NPCs only if they are specific and relevant.
- Keep each option distinct in emotional tone, interaction style, and participant mix.

Scene quality rules:
- The label should imply a situation, not just a category.
- The prompt must describe the opening situation, the source of tension, and what the scene should explore.
- Use concrete nouns, gestures, locations, props, and social stakes.
- Make the scene playable in one VN scene.
- Avoid vague words like "memories", "supplies", "problem", "conversation", "moment", unless paired with specific context.

IMPORTANT RULES:
The player character should not be in every scene.
A scene can have only 1 character, or all of them. Variety in participant count is encouraged.
There should be at least one scene with only 1 character.
The focus should be on the MAIN CHARACTERS, what is a main character? From the narrative you can infer who is important by their level of involvement in the story!
EXCLUDE unnamed generic NPCs/characters. (Guard, Merchant, Villager, etc.) (Any job title, even if unusual, should be excluded unless they are a MAIN CHARACTER.)
NO scene with JUST the player character.
Do not create scenes without at least one MAIN CHARACTER.
A scene MUST HAVE at least one MAIN CHARACTER.

At least one scene must be for a solo character.
You should have it sparsely dynamic, there should be a scene with 1 participant (at least) and all the way up to a few. Theres no specific number, just make it highly varied.

IF the scene does not include the player then DO NOT INCLUDE THE PLAYER in the prompt, they are simply not present in the scene.
Scenes without the player character should focus on the MAIN CHARACTERS present.

CRITICAL: THE SCENE SHOULD NOT BE A CONTINUATION OF THE CURRENT CHAPTER'S MAIN SCENE. It should be a side moment that could plausibly fit into the current location and story context, but does not directly follow from the latest chapter's main events. It can be a flashback or a side scene happening in parallel to the main story, but it should not be the next logical scene after the latest chapter.

Before outputting, silently check:
1. Could this scene happen only in this current story/location/party?
2. Does it reveal or pressure a character dynamic?
3. Would the player understand why this option is interesting from the label alone?
4. Is it different from the other options?

Return only JSON.
`.trim();

    return [
        {
            role: 'system',
            content: `You are a narrative gameplay option generator. Output strict JSON only, no prose, no markdown.\n\n${contextPrompt}`
        },
        {
            role: 'user',
            content: `${taskPrompt}`
        }
    ];
}

async function generateChoices(context, tools, settings) {
    const reachContext = await gatherInvitableCharacterPoolWithReach(context, tools);
    const characters = reachContext.characters;
    if (settings.use_llm_for_choices === false) {
        return buildFallbackChoices(context, characters);
    }

    const messages = buildChoiceMessages(context, characters, reachContext);
    const resolvedModel = 'highendmodel';
    let resolvedProvider = null;

    try {
        const response = await tools.llm.runTask({
            msg: `Camp Rest Choice Generator`,
            messages,
            model: resolvedModel,
            params: {
                expectJson: false,
                retries: 2,
                timeout: 90000,
                extra: { reasoning: { effort: 'none' } },
                callingModule: `Plugin:${PLUGIN_ID}`
            }
        });
        resolvedProvider = response?.provider || null;

        const raw = extractJson(response?.content || '');
        if (!raw) {
            tools.logger.warn(`[${PLUGIN_ID}] Choice generator returned no JSON. Using fallback choices.`);
            return buildFallbackChoices(context, characters);
        }

        const parsedContent = safeJsonParse(raw, null);
        let choicesList = [];
        let interludeQuote = '';
        let interludeSummary = '';

        if (parsedContent && typeof parsedContent === 'object' && !Array.isArray(parsedContent)) {
            interludeQuote = parsedContent.interludeQuote || parsedContent.quote || '';
            interludeSummary = parsedContent.interludeSummary || parsedContent.summary || '';
            choicesList = Array.isArray(parsedContent.choices) ? parsedContent.choices : [];
        } else if (Array.isArray(parsedContent)) {
            choicesList = parsedContent;
        }

        if (choicesList.length === 0) {
            tools.logger.warn(`[${PLUGIN_ID}] Choice generator JSON was invalid/empty. Using fallback choices.`);
            return buildFallbackChoices(context, characters);
        }

        const normalized = choicesList.slice(0, 6).map((entry, index) => normalizeChoice(entry, index, characters));
        const unique = [];
        const seen = new Set();
        for (const choice of normalized) {
            if (seen.has(choice.optionKey)) continue;
            seen.add(choice.optionKey);
            unique.push(choice);
        }

        while (unique.length < 3) {
            const fallback = normalizeChoice(DEFAULT_CHOICES[unique.length % DEFAULT_CHOICES.length], unique.length, characters);
            if (!seen.has(fallback.optionKey)) {
                seen.add(fallback.optionKey);
                unique.push(fallback);
            } else {
                fallback.optionKey = `${fallback.optionKey}_${unique.length + 1}`;
                seen.add(fallback.optionKey);
                unique.push(fallback);
            }
        }

        unique.interludeQuote = interludeQuote || '';
        unique.interludeSummary = interludeSummary || '';
        return unique;
    } catch (error) {
        TurnLogger.logResponse(
            `Camp Rest Choice Generator (error)`,
            `ERROR: ${error.message || String(error)}`,
            resolvedModel,
            resolvedProvider,
            false,
            null
        );
        tools.logger.error(`[${PLUGIN_ID}] Choice generation failed. Using fallback choices.`, error);
        return buildFallbackChoices(context, characters);
    }
}

function hasRegisteredIntercept(context, interceptId) {
    const list = Array.isArray(context?.output?.guiIntercepts) ? context.output.guiIntercepts : [];
    return list.some(item => item && item.interceptId === interceptId);
}

function replaceToken(template, token, value) {
    return template.split(token).join(value);
}

function renderUiTemplate({ mode, bodyHtml, payload }) {
    const uiId = `camp_rest_interludes_ui_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
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
        JSON.stringify(payload)
    );
    const js = `${UI_SCENE_RUNTIME_TEMPLATE}\n${uiJs}`;

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

function buildOverlayBody(options, allCharacters, invitedCharacters, invitationScenes, characterIcons, projectName, interludeQuote, interludeSummary, tools = null) {
    const sceneEntries = [];
    (Array.isArray(options) ? options : []).forEach((option) => {
        const participants = Array.isArray(option.participants) ? option.participants : [];
        sceneEntries.push({
            kind: 'option',
            label: sanitizeLabel(option?.label, 'Camp Scene'),
            description: sanitizePrompt(option?.prompt, 'A quiet downtime scene.'),
            participants,
            optionKey: option?.optionKey || '',
            interludeId: toInt(option?.interludeId, null),
            tags: [isPositiveInteger(option?.interludeId) ? 'Replay' : 'Scene']
        });
    });

    (Array.isArray(invitationScenes) ? invitationScenes : []).forEach((scene) => {
        const interludeId = toInt(scene?.interludeId, null);
        if (!isPositiveInteger(interludeId)) return;
        const label = sanitizeLabel(
            scene?.label,
            `Invitation Scene ${toInt(scene?.interludeOrdinal, interludeId)}`
        );
        const participants = dedupeStrings(Array.isArray(scene?.participants) ? scene.participants : []);
        sceneEntries.push({
            kind: 'invitation',
            label,
            description: 'Invitation scene replay',
            participants,
            interludeId,
            tags: ['Invitation', 'Replay']
        });
    });

    const sceneWheelHtml = sceneEntries.map((scene, index) => {
        const participants = Array.isArray(scene.participants) ? scene.participants : [];
        const badgesHtml = participants.map(p => `<span class="camp-rest-participant-badge">${escapeHtml(p)}</span>`).join(' ');
        const tagsHtml = (Array.isArray(scene.tags) ? scene.tags : [])
            .map(tag => `<span class="camp-rest-test-tag">${escapeHtml(tag)}</span>`)
            .join(' ');
        const kindClass = scene.kind === 'invitation' ? 'camp-rest-scene-kind-invitation camp-rest-invitation-replay' : 'camp-rest-scene-kind-option camp-rest-test-option';
        const optionData = scene.kind === 'option'
            ? `data-option-key="${escapeHtml(scene.optionKey)}"`
            : `data-interlude-id="${escapeHtml(scene.interludeId)}"`;
        return `
            <button
                type="button"
                class="camp-rest-scene-wheel-item ${kindClass}"
                data-wheel-index="${index}"
                data-scene-kind="${escapeHtml(scene.kind)}"
                ${optionData}
            >
                <div class="camp-rest-scene-card-sheen"></div>
                <div class="camp-rest-scene-card-topline">
                    ${tagsHtml}
                </div>
                <h3 class="camp-rest-option-title">${escapeHtml(scene.label)}</h3>
                <p class="camp-rest-option-desc">${escapeHtml(scene.description)}</p>
                <div class="camp-rest-option-participants">
                    ${badgesHtml || '<span class="camp-rest-participant-badge">Downtime</span>'}
                </div>
            </button>
        `;
    }).join('');

    const normalizedIcons = {};
    if (characterIcons) {
        for (const key in characterIcons) {
            normalizedIcons[key.toLowerCase().trim()] = characterIcons[key];
        }
    }
    const invitedKeys = new Set((Array.isArray(invitedCharacters) ? invitedCharacters : [])
        .map(name => String(name || '').trim().toLowerCase())
        .filter(Boolean));

    const companionIconsHtml = (Array.isArray(allCharacters) ? allCharacters : []).map(char => {
        const normalizedChar = String(char || '').trim().toLowerCase();
        const isInvited = invitedKeys.has(normalizedChar);
        const invitedClass = isInvited ? 'invited' : '';
        const disabledAttr = isInvited ? 'disabled' : '';
        const iconSrc = normalizedIcons[normalizedChar];
        let resolvedIconUrl = '';
        if (iconSrc && tools?.assets?.resolveUrl) {
            try {
                resolvedIconUrl = tools.assets.resolveUrl(iconSrc, { kind: 'sprites' });
            } catch (_error) {
                resolvedIconUrl = '';
            }
        }

        const avatarHtml = resolvedIconUrl
            ? `<img src="${escapeHtml(resolvedIconUrl)}" class="camp-rest-circle-img-avatar" alt="${escapeHtml(char)}">`
            : `<div class="camp-rest-circle-avatar"><em>${escapeHtml(char.slice(0, 1).toUpperCase())}</em></div>`;

        return `
            <button
                type="button"
                class="camp-rest-invite-avatar camp-rest-companion-circle-item ${invitedClass}"
                data-character="${escapeHtml(char)}"
                data-invited="${isInvited ? 'true' : 'false'}"
                ${disabledAttr}
                title="${isInvited ? `${escapeHtml(char)} already has an invitation scene` : `Invite ${escapeHtml(char)}`}"
            >
                <div class="camp-rest-companion-visual">
                    ${avatarHtml}
                    <span class="camp-rest-companion-name">${escapeHtml(char)}</span>
                </div>
            </button>
        `;
    }).join('');

    let formattedSummary = interludeSummary || '';
    if (formattedSummary && !formattedSummary.includes('?')) {
        formattedSummary = formattedSummary.trim();
        if (!formattedSummary.endsWith('.')) {
            formattedSummary += '.';
        }
        formattedSummary += ' What will you do?';
    }

    return `
        <div class="camp-rest-top-header">
            <div class="camp-rest-cycle-tag">Downtime Scenes</div>
        </div>
        <div class="camp-rest-test-card">
            <!-- LEFT COLUMN: Chronicles -->
            <div class="camp-rest-left-panel">
                <div class="camp-rest-section-header">SCENE SELECTION</div>
                <div class="camp-rest-scene-wheel" data-scene-count="${sceneEntries.length}">
                    <button type="button" class="camp-rest-wheel-arrow camp-rest-wheel-arrow-up" data-wheel-shift="-1" aria-label="Previous scene"></button>
                    <div class="camp-rest-scene-wheel-viewport">
                        <div class="camp-rest-scene-wheel-track">
                            ${sceneWheelHtml || '<div class="camp-rest-test-empty">No scenes available.</div>'}
                        </div>
                    </div>
                    <button type="button" class="camp-rest-wheel-arrow camp-rest-wheel-arrow-down" data-wheel-shift="1" aria-label="Next scene"></button>
                </div>
            </div>

            <!-- CENTER CONTEXT SUMMARY & TIP -->
            <div class="camp-rest-center-summary-box">
                ${formattedSummary
            ? `<div class="camp-rest-center-summary">${escapeHtml(formattedSummary)}</div>`
            : `
                    <div class="camp-rest-center-instructions">
                        Write your action when you are ready to move on to next chapter.
                    </div>
                `}
            </div>

            <!-- RIGHT COLUMN: Summon to the Hearth -->
            <div class="camp-rest-right-panel">
                <div class="camp-rest-section-header">CHARACTER INVITATIONS</div>
                <div class="camp-rest-companion-box">
                    <div class="camp-rest-invite-title-block">
                        <div class="camp-rest-sub-header">Choose Companions</div>
                        <div class="camp-rest-invite-note">Each character can only be invited once per parent scene.</div>
                    </div>

                    <div class="camp-rest-invite-buckets">
                        <div class="camp-rest-bucket-label">All inviteable characters</div>
                        <div class="camp-rest-avatar-bar camp-rest-avatar-bar-available" id="camp-rest-available-characters">
                            ${companionIconsHtml || '<div class="camp-rest-test-empty">No companions available for this turn.</div>'}
                        </div>

                        <div class="camp-rest-bucket-label">Selected characters</div>
                        <div class="camp-rest-avatar-bar camp-rest-avatar-bar-selected" id="camp-rest-selected-characters">
                            <div class="camp-rest-selected-empty">Click a portrait above to add them here.</div>
                        </div>
                    </div>

                    <div class="camp-rest-invite-actions">
                        <button type="button" class="camp-rest-invite-btn" id="camp-rest-invite-trigger-btn">
                            INVITE TO SCENE
                        </button>
                    </div>
                </div>
            </div>

            <div class="camp-rest-test-status"></div>
        </div>

        <!-- CUSTOM INVITE MODAL -->
        <div class="camp-rest-custom-invite-modal" id="camp-rest-custom-invite-modal" style="display: none;">
            <div class="camp-rest-custom-invite-content">
                <div class="camp-rest-modal-header">
                    <h3>Invite to Scene</h3>
                    <button type="button" class="camp-rest-modal-close" id="camp-rest-modal-close-btn">&times;</button>
                </div>
                <div class="camp-rest-modal-body">
                    <p class="camp-rest-modal-subtitle">Writing action for invited companions: <strong id="invited-names-list"></strong></p>
                    <textarea class="camp-rest-modal-textarea" id="invited-prompt-input" placeholder="What will you do? Example: We chat around the campfire, talking about past quests and sharing a meal..."></textarea>
                    <div class="camp-rest-modal-actions">
                        <button type="button" class="camp-rest-send-btn" id="camp-rest-send-invitation-btn">SEND INVITATION</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function runDirectorPrePrompt(context, tools) {
    const settings = tools.settings.getSelf() || {};
    if (settings.enabled === false) return;
    if (context?.sceneMode !== 'mainline') return;

    tools.director.registerCapability({
        phase: 'CAMP',
        description: 'Optional camp/rest/town downtime interludes with side scenes at a clean social regroup point.',
        handoffHint: 'Hand off only after an active beat has settled into open camp/town downtime. Do not hand off mid-romance, mid-argument, mid-fight, mid-cooking, mid-shopping, or during any unresolved personal encounter.'
    });
}

async function runPostVnGeneration(context, tools) {
    const settings = tools.settings.getSelf() || {};
    if (settings.enabled === false) return;
    if (context?.sceneMode === 'interlude') return;

    if (!shouldOfferCampOverlay(context, settings)) return;

    const projectName = context?.projectName || 'default_project';
    const parentTurnNumber = context?.turnNumber;
    if (!isPositiveInteger(parentTurnNumber)) return;

    // Regeneration-safe behavior: always regenerate options for this turn and replace persisted rows.
    const generated = await generateChoices(context, tools, settings);
    await upsertChoices(tools, projectName, parentTurnNumber, generated, DEFAULT_RUN_PROFILE_ID, generated.interludeQuote, generated.interludeSummary);
    const options = await getStoredOptions(tools, projectName, parentTurnNumber);
    const runDirector = await resolveRunDirectorForInterludesSetting(tools);

    if (options.length === 0) {
        tools.logger.warn(`[${PLUGIN_ID}] No options available for turn ${parentTurnNumber}; skipping intercept registration.`);
        return;
    }

    const interceptId = `${MAIN_INTERCEPT_ID_PREFIX}${parentTurnNumber}`;
    if (hasRegisteredIntercept(context, interceptId)) return;

    tools.gui.registerPersistentIntercept({
        interceptId,
        checkpoint: 'during_user_input',
        blocking: false,
        autoDismiss: false,
        preserveOnBeforeSubmit: true,
        priority: 120,
        replayPolicy: 'every_enter',
        hideMainSpritesWhileVisible: true,
        visualState: {
            hideMainSpritesWhileVisible: true
        },
        handlerRef: 'guiIntercepts.camp_rest_overlay',
        payload: {
            parentTurnNumber,
            runProfileId: DEFAULT_RUN_PROFILE_ID,
            runDirector
        }
    });
}

async function saveCharacterInvitations(tools, projectName, parentTurnNumber, interludeOrdinal, interludeId, characterNames) {
    const scope = buildInterludeScope(parentTurnNumber, interludeOrdinal, interludeId);
    if (!isPositiveInteger(scope.turnNumber) || !isPositiveInteger(scope.interludeOrdinal)) {
        throw new Error('Invalid interlude scope for invitations.');
    }
    const normalizedProjectName = toStringSafe(projectName, 'default_project').toLowerCase();
    const filteredCharacterNames = await filterInvitableCharactersByClassifier(
        tools?.turnContext,
        tools,
        characterNames,
        'save_invitation'
    );
    const debugBefore = await getInvitationDebugSnapshot(tools, normalizedProjectName, scope.turnNumber);
    logInvitationDebug(tools, 'save_before_delete', {
        projectName: normalizedProjectName,
        parentTurnNumber: scope.turnNumber,
        interludeId: scope.interludeId,
        interludeOrdinal: scope.interludeOrdinal,
        requestedCharacterNames: dedupeStrings(characterNames),
        characterNames: filteredCharacterNames,
        existingFacts: debugBefore.facts,
        knownInterludes: debugBefore.interludes
    });

    // Regeneration safety for this exact interlude only.
    // Prefer interlude_id scoping so one invite cannot wipe sibling interlude rows.
    if (isPositiveInteger(scope.interludeId)) {
        const deleteResult = await tools.db.chat.execute(`
            DELETE FROM facts
            WHERE LOWER(project_name) = LOWER(?)
              AND turn_number = ?
              AND interlude_id = ?
              AND plugin_id = ?
              AND LOWER(source) = LOWER(?)
              AND predicate = 'CAMP_REST_INVITED'
        `, [normalizedProjectName, scope.turnNumber, scope.interludeId, scope.pluginId, PLUGIN_ID]);
        logInvitationDebug(tools, 'save_delete_by_interlude_id', {
            interludeId: scope.interludeId,
            changes: Number(deleteResult?.changes || 0)
        });
    } else {
        const deleteResult = await tools.db.chat.execute(`
            DELETE FROM facts
            WHERE LOWER(project_name) = LOWER(?)
              AND turn_number = ?
              AND turn_key = ?
              AND plugin_id = ?
              AND LOWER(source) = LOWER(?)
              AND predicate = 'CAMP_REST_INVITED'
        `, [normalizedProjectName, scope.turnNumber, scope.turnKey, scope.pluginId, PLUGIN_ID]);
        logInvitationDebug(tools, 'save_delete_by_turn_key', {
            turnKey: scope.turnKey,
            changes: Number(deleteResult?.changes || 0)
        });
    }

    for (const name of filteredCharacterNames) {
        if (!name) continue;
        await tools.db.chat.execute(`
            INSERT INTO facts (
                turn_number,
                turn_key,
                scene_mode,
                interlude_id,
                interlude_ordinal,
                plugin_id,
                project_name,
                source,
                target,
                predicate,
                fact_value,
                context
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            scope.turnNumber,
            scope.turnKey,
            scope.sceneMode,
            scope.interludeId,
            scope.interludeOrdinal,
            scope.pluginId,
            normalizedProjectName,
            PLUGIN_ID,
            name,
            'CAMP_REST_INVITED',
            JSON.stringify({ invited: true, timestamp: Date.now() }),
            JSON.stringify({
                parentTurnNumber: scope.turnNumber,
                interludeId: scope.interludeId,
                interludeOrdinal: scope.interludeOrdinal
            })
        ]);
    }

    const debugAfter = await getInvitationDebugSnapshot(tools, normalizedProjectName, scope.turnNumber);
    logInvitationDebug(tools, 'save_after_insert', {
        projectName: normalizedProjectName,
        parentTurnNumber: scope.turnNumber,
        interludeId: scope.interludeId,
        interludeOrdinal: scope.interludeOrdinal,
        facts: debugAfter.facts,
        knownInterludes: debugAfter.interludes
    });
}

async function getCharacterInvitations(tools, projectName, parentTurnNumber) {
    const normalizedParentTurn = toInt(parentTurnNumber, 0);
    if (!isPositiveInteger(normalizedParentTurn)) return [];

    const normalizedProjectName = toStringSafe(projectName, 'default_project').toLowerCase();
    const rows = await tools.db.chat.query(`
        SELECT f.target AS character_name
        FROM facts f
        INNER JOIN chat_interludes i
            ON i.id = f.interlude_id
           AND LOWER(i.project_name) = LOWER(f.project_name)
        WHERE LOWER(f.project_name) = LOWER(?)
          AND f.turn_number = ?
          AND f.scene_mode = 'interlude'
          AND f.plugin_id = ?
          AND LOWER(f.source) = LOWER(?)
          AND f.predicate = 'CAMP_REST_INVITED'
    `, [normalizedProjectName, normalizedParentTurn, PLUGIN_ID, PLUGIN_ID]);

    const snapshotScenes = await getSnapshotInvitationInterludes(tools, projectName, parentTurnNumber);
    await backfillInvitationFactsFromSnapshotScenes(tools, projectName, parentTurnNumber, snapshotScenes, 'character_lock_read');

    const invited = new Set(rows.map(row => row.character_name).filter(Boolean));
    for (const scene of snapshotScenes) {
        for (const participant of Array.isArray(scene?.participants) ? scene.participants : []) {
            if (participant) invited.add(participant);
        }
    }

    return await filterInvitableCharactersByClassifier(
        tools?.turnContext,
        tools,
        Array.from(invited),
        'stored_invitation_locks'
    );
}

async function getStoredInvitationScenes(tools, projectName, parentTurnNumber) {
    const normalizedParentTurn = toInt(parentTurnNumber, 0);
    if (!isPositiveInteger(normalizedParentTurn)) return [];

    const normalizedProjectName = toStringSafe(projectName, 'default_project').toLowerCase();
    const rows = await tools.db.chat.query(`
        SELECT
            f.interlude_id AS interlude_id,
            MAX(f.interlude_ordinal) AS interlude_ordinal,
            COALESCE(MAX(i.label), '') AS interlude_label,
            GROUP_CONCAT(f.target, '||') AS invited_names
        FROM facts f
        INNER JOIN chat_interludes i
            ON i.id = f.interlude_id
           AND LOWER(i.project_name) = LOWER(f.project_name)
        WHERE LOWER(f.project_name) = LOWER(?)
          AND f.turn_number = ?
          AND f.scene_mode = 'interlude'
          AND f.plugin_id = ?
          AND LOWER(f.source) = LOWER(?)
          AND f.predicate = 'CAMP_REST_INVITED'
          AND f.interlude_id IS NOT NULL
        GROUP BY f.interlude_id
        ORDER BY MAX(f.interlude_ordinal) ASC, f.interlude_id ASC
    `, [normalizedProjectName, normalizedParentTurn, PLUGIN_ID, PLUGIN_ID]);

    const scenesById = new Map();
    for (const row of rows) {
        const interludeId = toInt(row?.interlude_id, null);
        if (!isPositiveInteger(interludeId)) continue;
        const interludeOrdinal = toInt(row?.interlude_ordinal, null);
        const participants = dedupeStrings(
            toStringSafe(row?.invited_names, '')
                .split('||')
                .map(name => toStringSafe(name, ''))
        );
        const fallbackLabel = participants.length > 0
            ? `Invitation with ${participants.join(', ')}`
            : `Invitation Scene ${interludeOrdinal || interludeId}`;

        scenesById.set(interludeId, {
            interludeId,
            interludeOrdinal: isPositiveInteger(interludeOrdinal) ? interludeOrdinal : null,
            label: sanitizeLabel(row?.interlude_label, fallbackLabel),
            participants
        });
    }

    // If older invite facts were pruned, the interlude row still carries the
    // custom-invite metadata in its snapshot. Use that as a recovery source.
    const snapshotScenes = await getSnapshotInvitationInterludes(tools, projectName, parentTurnNumber);
    await backfillInvitationFactsFromSnapshotScenes(tools, projectName, parentTurnNumber, snapshotScenes, 'scene_list_read');
    for (const scene of snapshotScenes) {
        if (!isPositiveInteger(scene?.interludeId)) continue;
        if (scenesById.has(scene.interludeId)) {
            const existing = scenesById.get(scene.interludeId);
            const participants = existing.participants.length > 0
                ? existing.participants
                : dedupeStrings(scene.participants || []);
            scenesById.set(scene.interludeId, {
                ...existing,
                label: existing.label || scene.label,
                participants
            });
            continue;
        }
        scenesById.set(scene.interludeId, scene);
    }

    const finalScenes = dedupeInvitationScenesByParticipants(Array.from(scenesById.values()))
        .sort((a, b) => {
            const ordA = isPositiveInteger(a.interludeOrdinal) ? a.interludeOrdinal : Number.MAX_SAFE_INTEGER;
            const ordB = isPositiveInteger(b.interludeOrdinal) ? b.interludeOrdinal : Number.MAX_SAFE_INTEGER;
            if (ordA !== ordB) return ordA - ordB;
            return (a.interludeId || 0) - (b.interludeId || 0);
        });
    logInvitationDebug(tools, 'read_invitation_scenes', {
        projectName: normalizedProjectName,
        parentTurnNumber: normalizedParentTurn,
        factGroupedRows: rows.length,
        snapshotScenes: snapshotScenes.map(scene => ({
            interludeId: scene.interludeId,
            interludeOrdinal: scene.interludeOrdinal,
            participants: scene.participants
        })),
        finalScenes
    });
    return await filterInvitationScenesByClassifier(
        tools?.turnContext,
        tools,
        finalScenes,
        'stored_invitation_scenes'
    );
}

async function resolveInvitationInterludeOrdinal(tools, projectName, parentTurnNumber, interludeId, interludeOrdinal) {
    const directOrdinal = toInt(interludeOrdinal, null);
    if (isPositiveInteger(directOrdinal)) return directOrdinal;

    const resolvedInterludeId = toInt(interludeId, null);
    if (!isPositiveInteger(resolvedInterludeId)) return null;

    const normalizedProjectName = toStringSafe(projectName, 'default_project').toLowerCase();
    const row = await tools.db.chat.query(`
        SELECT i.ordinal, t.creation_turn_number AS parent_turn_number
        FROM chat_interludes i
        INNER JOIN chat_turns t ON t.id = i.parent_turn_id
        WHERE LOWER(i.project_name) = LOWER(?)
          AND i.id = ?
        LIMIT 1
    `, [normalizedProjectName, resolvedInterludeId]);
    const hit = Array.isArray(row) ? row[0] : null;
    if (!hit) return null;

    const resolvedParentTurn = toInt(hit.parent_turn_number, null);
    if (!isPositiveInteger(resolvedParentTurn) || resolvedParentTurn !== toInt(parentTurnNumber, -1)) {
        return null;
    }

    const resolvedOrdinal = toInt(hit.ordinal, null);
    return isPositiveInteger(resolvedOrdinal) ? resolvedOrdinal : null;
}

async function buildCampRestOverlayIntercept(context, tools, descriptor) {
    const projectName = context?.projectName || 'default_project';
    const settings = tools.settings.getSelf() || {};
    const runDirector = await resolveRunDirectorForInterludesSetting(tools);
    const panelLayout =
        sanitizeOverlayPanelsLayout(settings[PANEL_LAYOUT_SETTINGS_KEY])
        || sanitizeOverlayPanelsLayout(DEFAULT_OVERLAY_PANELS_LAYOUT);
    const parentTurnNumber = toInt(descriptor?.payload?.parentTurnNumber, context?.turnNumber);
    const campScene = resolveCampSceneSelection(context, tools, projectName);
    if (!isPositiveInteger(parentTurnNumber)) {
        return renderUiTemplate({
            mode: 'overlay',
            bodyHtml: `<div class="camp-rest-test-card"><strong>Camp Rest:</strong> missing parent turn context.</div>`,
            payload: {
                parentTurnNumber: null,
                options: [],
                bindEventName: SOCKET_BIND_EVENT,
                saveInvitationEventName: SAVE_INVITATION_EVENT,
                saveLayoutEventName: SAVE_LAYOUT_EVENT,
                defaultRunProfileId: DEFAULT_RUN_PROFILE_ID,
                runDirector,
                campScene,
                panelLayout,
                optionTagPrefix: OPTION_TAG_PREFIX,
                autoContinue: true,
                fallbackReason: 'missing_parent_turn_context',
                fallbackMessage: 'Camp Rest: missing parent chapter context. Continuing chapter.'
            }
        });
    }

    const options = await getStoredOptions(tools, projectName, parentTurnNumber);
    const allCharacters = await gatherInvitableCharacterPool(context, tools);
    const campSpriteProfiles = await buildCampSpriteProfiles(context, tools, allCharacters, projectName);
    const invitedCharacters = await getCharacterInvitations(tools, projectName, parentTurnNumber);
    const invitationScenes = await getStoredInvitationScenes(tools, projectName, parentTurnNumber);
    const characterIcons = context?.output?.characterIcons || {};
    const interludeQuote = await getStoredInterludeQuote(tools, projectName, parentTurnNumber);
    const interludeSummary = await getStoredInterludeSummary(tools, projectName, parentTurnNumber);

    return renderUiTemplate({
        mode: 'overlay',
        bodyHtml: buildOverlayBody(options, allCharacters, invitedCharacters, invitationScenes, characterIcons, projectName, interludeQuote, interludeSummary, tools),
        payload: {
            parentTurnNumber,
            options,
            allCharacters,
            invitedCharacters,
            invitationScenes,
            bindEventName: SOCKET_BIND_EVENT,
            saveInvitationEventName: SAVE_INVITATION_EVENT,
            saveLayoutEventName: SAVE_LAYOUT_EVENT,
            defaultRunProfileId: DEFAULT_RUN_PROFILE_ID,
            runDirector,
            campScene,
            campSpriteProfiles,
            panelLayout,
            optionTagPrefix: OPTION_TAG_PREFIX,
            autoContinue: options.length === 0 && invitationScenes.length === 0,
            fallbackReason: 'no_interlude_options',
            fallbackMessage: 'No interlude options or invitation scenes available. Continuing chapter.'
        }
    });
}

function resolveGuiInterceptBuilder(descriptor) {
    const handlerRef = toStringSafe(descriptor?.handlerRef, '');
    if (handlerRef.endsWith('camp_rest_overlay')) return buildCampRestOverlayIntercept;

    const interceptId = toStringSafe(descriptor?.interceptId || descriptor?.id, '');
    if (interceptId.startsWith(MAIN_INTERCEPT_ID_PREFIX)) return buildCampRestOverlayIntercept;

    return null;
}

async function buildGuiIntercept(context, tools, descriptor, request) {
    const builder = resolveGuiInterceptBuilder(descriptor || request?.descriptor || {});
    if (typeof builder === 'function') {
        return builder(context, tools, descriptor, request);
    }

    tools.logger.warn(`[${PLUGIN_ID}] Could not resolve GUI intercept builder for intercept '${descriptor?.interceptId || descriptor?.id || 'unknown'}' (handlerRef='${descriptor?.handlerRef || ''}').`);
    return renderUiTemplate({
        mode: 'overlay',
        bodyHtml: `<div class="camp-rest-test-card"><strong>Camp Rest:</strong> unable to resolve this intercept descriptor.</div>`,
        payload: {
            parentTurnNumber: null,
            options: [],
            bindEventName: SOCKET_BIND_EVENT,
            saveInvitationEventName: SAVE_INVITATION_EVENT,
            saveLayoutEventName: SAVE_LAYOUT_EVENT,
            defaultRunProfileId: DEFAULT_RUN_PROFILE_ID,
            panelLayout: null,
            optionTagPrefix: OPTION_TAG_PREFIX,
            autoContinue: true,
            fallbackReason: 'unresolved_intercept_descriptor',
            fallbackMessage: 'Camp Rest: this intercept is outdated. Continuing chapter.'
        }
    });
}

async function bindOptionInterludeSocket(data, tools) {
    try {
        const parentTurnNumber = toInt(data?.parentTurnNumber, null);
        const optionKey = toStringSafe(data?.optionKey, '');
        const interludeId = toInt(data?.interludeId, null);
        const runProfileId = toStringSafe(data?.runProfileId, DEFAULT_RUN_PROFILE_ID);
        const projectName = tools?.turnContext?.projectName || 'default_project';

        if (!isPositiveInteger(parentTurnNumber) || !optionKey || !isPositiveInteger(interludeId)) return;

        await bindInterludeToChoice(
            tools,
            projectName,
            parentTurnNumber,
            optionKey,
            interludeId,
            runProfileId
        );
    } catch (error) {
        tools.logger.error(`[${PLUGIN_ID}] Failed binding interlude to choice`, error);
    }
}

async function bindInvitationSocket(data, tools) {
    try {
        const parentTurnNumber = toInt(data?.parentTurnNumber, null);
        const interludeId = toInt(data?.interludeId, null);
        const interludeOrdinal = toInt(data?.interludeOrdinal, null);
        const characterNames = Array.isArray(data?.characterNames) ? data.characterNames : [];
        const projectName = tools?.turnContext?.projectName || 'default_project';
        logInvitationDebug(tools, 'socket_save_received', {
            projectName,
            parentTurnNumber,
            interludeId,
            interludeOrdinal,
            characterNames: dedupeStrings(characterNames)
        });

        if (!isPositiveInteger(parentTurnNumber) || characterNames.length === 0) {
            logInvitationDebug(tools, 'socket_save_rejected_invalid_data', {
                parentTurnNumber,
                characterCount: characterNames.length
            });
            return { success: false, error: 'Invalid invitation data' };
        }

        const filteredCharacterNames = await filterInvitableCharactersByClassifier(
            tools?.turnContext,
            tools,
            characterNames,
            'socket_save_invitation'
        );
        if (filteredCharacterNames.length === 0) {
            logInvitationDebug(tools, 'socket_save_rejected_classifier', {
                projectName,
                parentTurnNumber,
                requestedCharacterNames: dedupeStrings(characterNames)
            });
            return { success: false, error: 'No classifier-approved invitation characters' };
        }

        const resolvedOrdinal = await resolveInvitationInterludeOrdinal(
            tools,
            projectName,
            parentTurnNumber,
            interludeId,
            interludeOrdinal
        );
        if (!isPositiveInteger(resolvedOrdinal)) {
            logInvitationDebug(tools, 'socket_save_rejected_invalid_scope', {
                projectName,
                parentTurnNumber,
                interludeId,
                interludeOrdinal,
                resolvedOrdinal
            });
            return { success: false, error: 'Invalid invitation interlude scope' };
        }
        logInvitationDebug(tools, 'socket_save_scope_resolved', {
            projectName,
            parentTurnNumber,
            interludeId,
            interludeOrdinal,
            resolvedOrdinal
        });

        await saveCharacterInvitations(
            tools,
            projectName,
            parentTurnNumber,
            resolvedOrdinal,
            interludeId,
            filteredCharacterNames
        );
        return { success: true };
    } catch (error) {
        tools.logger.error(`[${PLUGIN_ID}] Failed saving character invitations`, error);
        return { success: false, error: error.message };
    }
}

async function bindOverlayLayoutSocket(data, tools) {
    try {
        const partialLayout = sanitizeOverlayPanelsLayout(data?.layout);
        if (!partialLayout) {
            return { success: false, error: 'Invalid panel layout payload.' };
        }

        const settings = tools.settings.getSelf() || {};
        const currentLayout = sanitizeOverlayPanelsLayout(settings[PANEL_LAYOUT_SETTINGS_KEY]);
        const mergedLayout = sanitizeOverlayPanelsLayout({
            version: PANEL_LAYOUT_VERSION,
            left: partialLayout.left || currentLayout?.left || null,
            right: partialLayout.right || currentLayout?.right || null
        });
        if (!mergedLayout) {
            return { success: false, error: 'No valid panel layout values to save.' };
        }

        await tools.settings.update({
            [PANEL_LAYOUT_SETTINGS_KEY]: mergedLayout
        });
        return { success: true };
    } catch (error) {
        tools.logger.error(`[${PLUGIN_ID}] Failed saving overlay panel layout`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Hook function to augment the user prompt for interlude turns belonging to this plugin.
 * Handles the "Attempts to" injection for custom invites and adds narrative constraints.
 */
async function handleInterludePromptAugmentation(context, tools) {
    // Only apply to interludes owned by this plugin
    if (context.sceneMode !== 'interlude' || context.runtime.interlude?.pluginId !== PLUGIN_ID) {
        return;
    }

    const interlude = context.runtime.interlude;
    const isCustomInvite = interlude.isCustomInvite === true || String(interlude.optionKey || '').startsWith('custom_invite_');
    const playerChar = context.input.playerCharacterName || 'Player';
    if (!Array.isArray(interlude.participants)) {
        interlude.participants = [];
    }

    interlude.participants = await filterCampParticipantsPreservingPlayer(
        context,
        tools,
        interlude.participants,
        isCustomInvite ? 'custom_invite_prompt' : 'option_interlude_prompt'
    );

    // We keep a copy of the original participants for the "Focus" note
    const originalParticipants = [...interlude.participants];

    if (isCustomInvite) {
        // 1. Wrap the prompt in the "Attempts to" pattern
        const character = (playerChar && playerChar !== 'None') ? playerChar : 'Player';
        context.input.userPrompt = `ALL the following actions are performed by ${character}:\n${character} attempts to: > ${context.input.userPrompt} <\n(It can be successful or not, it has to make sense in this context. The characters must react accordingly if something outlandish is attempted. **Narrate the outcome of this attempt directly within the story.**)\n`;

        // 2. Ensure player character is in the participating list for the core roster builder
        if (playerChar && playerChar !== 'None' && !interlude.participants.includes(playerChar)) {
            interlude.participants.unshift(playerChar);
        }
    }

    // 3. Append Focus and Conclusion notes to the user prompt
    const focusText = originalParticipants.length > 0
        ? `Other characters can appear *briefly*, but the POV and focus is solely on [${originalParticipants.join(', ')}].`
        : '';
    const conclusionNote = "The scene should NOT advance time or move the narrative; This is an interlogue scene, so it should reach somewhat of a conclusion.";

    context.input.userPrompt = [
        context.input.userPrompt,
        focusText,
        conclusionNote
    ].filter(Boolean).join('\n').trim();
}

module.exports = {
    PLUGIN_ID,
    SOCKET_BIND_EVENT,
    SAVE_INVITATION_EVENT,
    SAVE_LAYOUT_EVENT,
    SETTINGS_SCHEMA,
    runDirectorPrePrompt,
    runPostVnGeneration,
    buildCampRestOverlayIntercept,
    buildGuiIntercept,
    bindOptionInterludeSocket,
    bindInvitationSocket,
    bindOverlayLayoutSocket,
    handleInterludePromptAugmentation
};

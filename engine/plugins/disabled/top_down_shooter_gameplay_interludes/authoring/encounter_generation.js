const fs = require('fs');
const path = require('path');
const {
    COMPILER_VERSION,
    MARKER_START,
    MARKER_END,
    compileEncounterFacade,
    stripFacadeMarkers,
    stableHash
} = require('./encounter_facade_compiler.js');

const DEFAULT_TIMEOUT_MS = 120000;
const GENERATION_PIPELINE = 'facade_plus_flavor_v1';
const FLAVOR_SCHEMA_VERSION = 1;

const FLAVOR_EVENT_IDS = Object.freeze([
    'combat_start',
    'hit_taken',
    'hp_low',
    'momentum_1',
    'momentum_2',
    'boss_pressure',
    'victory',
    'defeat'
]);
const FLAVOR_EVENT_SET = new Set(FLAVOR_EVENT_IDS);
const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

const FACADE_GRAMMAR_SUMMARY_FALLBACK = `
EncounterFacade v1 is line-oriented. Do not output JSON.

Required encounter line:
encounter "Title" id your_id length=short|medium|long difficulty=easy|normal|hard mode=waves|survive|boss

Optional style line:
style readable mobile_crossfire duel swarm ring_pressure aimed_pressure

Wave lines:
wave wave_id enemy=chaser|turret|ranger|charger count=solo|small|medium|large pressure=light|medium|heavy pattern=auto|fan|spiral|radial|aimed|line|rain spawn=edge|random|center pickup=none|heal|cooldown

Boss line (required for mode=boss):
boss boss_id name="Display Name" deck=fan,radial,line,aimed,spiral,rain pressure=light|medium|heavy phases=2|3 adds=none|light|medium pickup=none|heal|cooldown|both

Optional encounter background:
encounter ... bg=#c9a36a

Only these commands are allowed:
encounter, style, wave, boss

Do not write low-level tuning numbers (hp, speed, radius, damage, cooldowns, intervals, bullet counts, spread, budgets, phase thresholds, modifiers).
Do not use cut mechanics (hazards, objects, capture/protect goals, statuses, arena modifiers, music scripting, flags/counters, nested delayed action groups).
`.trim();

const FACADE_EXAMPLE_FALLBACK = `
${MARKER_START}
encounter "Glass Ambush" id glass_ambush length=medium difficulty=normal mode=boss
style readable mobile_crossfire
wave opening enemy=chaser count=small pressure=light pattern=fan spawn=edge
wave pressure enemy=ranger count=medium pressure=medium pattern=line pickup=heal spawn=random
boss glass_captain name="Glass Captain" deck=fan,radial,line pressure=medium phases=3 adds=light pickup=heal
${MARKER_END}
`.trim();

const FACADE_SYSTEM_PROMPT_FALLBACK = [
    'You write EncounterFacade v1 for a top-down shooter combat interlude.',
    'Output only one facade script between the required markers.',
    'Do not output JSON.',
    'Do not explain your choices.',
    'This V1 is focused on bullet pressure, readable telegraphs, enemy waves, and boss rhythm.',
    'Author semantic intent only: roles, pressure, patterns, counts as enums, and simple mode structure.',
    'Do not output low-level tuning numbers or unsupported mechanics.'
].join('\n');

const FACADE_USER_TEMPLATE_FALLBACK = [
    'Scene context:',
    '{{SCENE_CONTEXT}}',
    '',
    'Relevant lore / characters / factions:',
    '{{LORE_CONTEXT}}',
    '',
    'Recent player context:',
    '{{PLAYER_CONTEXT}}',
    '',
    'EncounterFacade v1 grammar:',
    '{{FACADE_GRAMMAR_SUMMARY}}',
    '',
    'Example facade:',
    '{{FACADE_EXAMPLE}}',
    '',
    'Required output:',
    '{{MARKER_START}}',
    '...',
    '{{MARKER_END}}'
].join('\n');

const FLAVOR_SYSTEM_PROMPT_FALLBACK = [
    'You write short combat flavor lines for party characters.',
    'Return only JSON.',
    'No markdown fences, no prose, no explanation.',
    'Use the provided event ids and keep each line concise and in-character.'
].join('\n');

const FLAVOR_USER_TEMPLATE_FALLBACK = [
    'Scene context:',
    '{{SCENE_CONTEXT}}',
    '',
    'Part 1 - Canon data:',
    '{{CANON_CONTEXT}}',
    '',
    'Part 3 - Narrative history (balanced):',
    '{{BALANCED_HISTORY_CONTEXT}}',
    '',
    'Relevant lore context:',
    '{{LORE_CONTEXT}}',
    '',
    'Party / prominent character names:',
    '{{CHARACTER_NAMES_JSON}}',
    '',
    'Compiled encounter summary:',
    '{{COMPILED_SUMMARY_JSON}}',
    '',
    'Return exactly one JSON object in this format:',
    '{{FLAVOR_RESPONSE_SCHEMA_JSON}}',
    '',
    'Allowed event ids: {{FLAVOR_EVENT_IDS_CSV}}'
].join('\n');

const DEFAULT_FLAVOR_TEXT_BY_EVENT = Object.freeze({
    combat_start: 'Eyes up. Hostiles are in range.',
    hit_taken: 'That hit connected. Keep moving.',
    hp_low: 'You are running on fumes. Dash and reset.',
    momentum_1: 'Nice rhythm. Keep that lane clear.',
    momentum_2: 'Pressure is breaking. Push through.',
    boss_pressure: 'The boss is ramping up. Read the telegraph.',
    victory: 'Area secure. Regroup and move.',
    defeat: 'Fall back. We can reset and try again.'
});

function readPromptText(fileName, fallbackText) {
    const fullPath = path.join(PROMPTS_DIR, fileName);
    try {
        const text = fs.readFileSync(fullPath, 'utf8');
        const trimmed = String(text || '').trim();
        return trimmed || String(fallbackText || '').trim();
    } catch (_error) {
        return String(fallbackText || '').trim();
    }
}

function renderPromptTemplate(template, slots = {}) {
    let out = String(template || '');
    for (const [key, rawValue] of Object.entries(slots || {})) {
        const token = '{{' + String(key) + '}}';
        const replacement = String(rawValue == null ? '' : rawValue);
        out = out.split(token).join(replacement);
    }
    return out.trim();
}

const FACADE_GRAMMAR_SUMMARY = readPromptText('encounter_facade_grammar_v1.txt', FACADE_GRAMMAR_SUMMARY_FALLBACK);
const FACADE_EXAMPLE = readPromptText('encounter_facade_example_v1.txt', FACADE_EXAMPLE_FALLBACK);
const FACADE_SYSTEM_PROMPT = readPromptText('encounter_facade_system.txt', FACADE_SYSTEM_PROMPT_FALLBACK);
const FACADE_USER_TEMPLATE = readPromptText('encounter_facade_user_template.txt', FACADE_USER_TEMPLATE_FALLBACK);
const FLAVOR_SYSTEM_PROMPT = readPromptText('encounter_flavor_system.txt', FLAVOR_SYSTEM_PROMPT_FALLBACK);
const FLAVOR_USER_TEMPLATE = readPromptText('encounter_flavor_user_template.txt', FLAVOR_USER_TEMPLATE_FALLBACK);

function toStringSafe(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function clampText(text, maxChars) {
    const raw = String(text || '').trim();
    if (raw.length <= maxChars) return raw;
    return raw.slice(0, maxChars - 24).trimEnd() + '\n...[truncated]';
}

function resolveModelParams(options = {}) {
    const modelDef = options.modelDef || options.model || null;
    if (!modelDef) return {};
    if (typeof modelDef === 'string') return { model: modelDef };
    if (modelDef && typeof modelDef === 'object') {
        const out = {};
        if (modelDef.model) out.model = modelDef.model;
        if (modelDef.provider) out.provider = modelDef.provider;
        return out;
    }
    return {};
}

function normalizeTimeout(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(10000, Math.min(600000, Math.floor(n))) : DEFAULT_TIMEOUT_MS;
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function flattenTextFragments(value, out = []) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) out.push(trimmed);
        return out;
    }
    if (Array.isArray(value)) {
        for (const item of value) flattenTextFragments(item, out);
        return out;
    }
    if (isPlainObject(value)) {
        for (const item of Object.values(value)) flattenTextFragments(item, out);
    }
    return out;
}

function collectPromptSlotText(context, pillar, slot, maxItems = 8) {
    const raw = context?.promptComponents?.[pillar]?.[slot];
    return flattenTextFragments(raw).slice(0, maxItems);
}

function dedupeStrings(items) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
        const text = String(item || '').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out;
}

function buildSceneContext(context) {
    const output = context?.output || {};
    const director = context?.processed?.director || {};
    const sequence = Array.isArray(output.sequence) ? output.sequence : [];
    const dialogue = sequence.slice(0, 12).map((line) => {
        const character = toStringSafe(line?.character, 'Narration').trim() || 'Narration';
        const text = toStringSafe(line?.text || line?.dialogue || line?.content, '').trim();
        return text ? character + ': ' + text : '';
    }).filter(Boolean);
    const payload = {
        turnNumber: context?.turnNumber || null,
        playerCharacterName: toStringSafe(context?.input?.playerCharacterName, ''),
        playerAction: toStringSafe(context?.input?.userPrompt, ''),
        directorPhase: toStringSafe(director.scenePhase, ''),
        directorBrief: toStringSafe(director.writerBrief || director.sceneBrief || director.feedback, ''),
        chapterText: toStringSafe(output.text || output.content || output.narrative, ''),
        dialogue
    };
    return clampText(JSON.stringify(payload, null, 2), 7000);
}

function buildLoreContext(context) {
    const processedPromptBuilder = context?.processed?.promptBuilder || {};
    const fragments = [
        ...collectPromptSlotText(context, 'root', 'canon', 10),
        ...collectPromptSlotText(context, 'root', 'dynamic_knowledge', 8),
        ...collectPromptSlotText(context, 'writer', 'canon', 6),
        ...collectPromptSlotText(context, 'writer', 'dynamic_knowledge', 6),
        ...collectPromptSlotText(context, 'director', 'canon', 6),
        ...collectPromptSlotText(context, 'director', 'dynamic_knowledge', 6),
        toStringSafe(processedPromptBuilder.lorebook, ''),
        toStringSafe(processedPromptBuilder.staticLore, ''),
        toStringSafe(context?.input?.playerCharacterBio, '')
    ];
    const joined = dedupeStrings(fragments).join('\n\n---\n\n');
    return clampText(joined || 'No explicit lore context was available. Use only the current scene context.', 9000);
}

function buildCanonContext(context) {
    const fragments = [
        ...collectPromptSlotText(context, 'root', 'canon', 14),
        ...collectPromptSlotText(context, 'writer', 'canon', 8),
        ...collectPromptSlotText(context, 'director', 'canon', 8),
        toStringSafe(context?.processed?.promptBuilder?.lorebook, '')
    ];
    const joined = dedupeStrings(fragments).join('\n\n---\n\n');
    return clampText(joined || 'No canonical context available for this turn.', 12000);
}

function buildBalancedNarrativeHistoryContext(context) {
    const balanced = toStringSafe(context?.runtime?.historyData?.compressedHistory?.balanced, '');
    if (balanced) return clampText(balanced, 14000);

    const fragments = [
        ...collectPromptSlotText(context, 'root', 'history', 10),
        ...collectPromptSlotText(context, 'writer', 'history', 8),
        ...collectPromptSlotText(context, 'director', 'history', 8),
        toStringSafe(context?.runtime?.historyData?.summaryHistory, '')
    ];
    const joined = dedupeStrings(fragments).join('\n\n---\n\n');
    return clampText(joined || 'No narrative history available for this turn.', 10000);
}

function buildRecentPlayerContext(context) {
    const director = context?.processed?.director || {};
    const fragments = [
        'Player character: ' + toStringSafe(context?.input?.playerCharacterName, 'Unknown'),
        'Player action: ' + toStringSafe(context?.input?.userPrompt, 'No explicit player action.'),
        toStringSafe(context?.input?.directorPrompt, '') ? 'Manual director prompt: ' + toStringSafe(context.input.directorPrompt, '') : '',
        toStringSafe(context?.input?.softFeedback, '') ? 'Player soft feedback: ' + toStringSafe(context.input.softFeedback, '') : '',
        toStringSafe(director.writerBrief || director.sceneBrief || director.feedback, '') ? 'Director brief: ' + toStringSafe(director.writerBrief || director.sceneBrief || director.feedback, '') : '',
        ...collectPromptSlotText(context, 'root', 'history', 4),
        ...collectPromptSlotText(context, 'writer', 'history', 4),
        ...collectPromptSlotText(context, 'root', 'simulation', 4),
        ...collectPromptSlotText(context, 'writer', 'simulation', 4)
    ].filter(Boolean);
    return clampText(dedupeStrings(fragments).join('\n\n---\n\n'), 7000);
}

function buildProminentCharacterNames(context, max = 6) {
    const names = [];
    const add = (value) => {
        const text = String(value || '').trim();
        if (!text) return;
        if (/^(narrator|system|scene)$/i.test(text)) return;
        names.push(text);
    };

    add(context?.input?.playerCharacterName);

    const party = Array.isArray(context?.output?.party) ? context.output.party : [];
    for (const name of party) add(name);

    const sequence = Array.isArray(context?.output?.sequence) ? context.output.sequence : [];
    for (const line of sequence.slice(0, 20)) add(line?.character);

    return dedupeStrings(names).slice(0, max);
}

function responseContentToText(result) {
    const content = result?.content ?? result;
    if (typeof content === 'string') return content;
    if (isPlainObject(content) && typeof content.text === 'string') return content.text;
    if (isPlainObject(content) && typeof content.content === 'string') return content.content;
    return String(content || '');
}

function extractFacadeBlock(content) {
    const raw = String(content || '').trim();
    const start = raw.indexOf(MARKER_START);
    const end = raw.indexOf(MARKER_END);
    if (start >= 0 && end > start) return raw.slice(start, end + MARKER_END.length).trim();
    return raw;
}

function parseJsonLoose(content) {
    const raw = String(content || '').trim();
    if (!raw) return null;
    const candidates = [raw];

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) candidates.push(String(fenced[1]).trim());

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidates.push(raw.slice(firstBrace, lastBrace + 1).trim());
    }

    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            const parsed = JSON.parse(candidate);
            if (isPlainObject(parsed)) return parsed;
        } catch (_error) {
            // Ignore and continue trying additional extraction strategies.
        }
    }
    return null;
}

function normalizeFlavorEventId(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeCharacters(raw, fallback = []) {
    const candidates = Array.isArray(raw) ? raw : fallback;
    const out = [];
    const seen = new Set();
    for (const entry of candidates) {
        const text = String(entry || '').trim();
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text);
        if (out.length >= 8) break;
    }
    if (out.length > 0) return out;
    const fallbackName = String(fallback[0] || '').trim();
    if (fallbackName) return [fallbackName];
    return ['Narrator'];
}

function chooseSpeaker(rawSpeaker, characterPool, fallbackIndex = 0) {
    const fallback = characterPool[fallbackIndex % Math.max(1, characterPool.length)] || 'Narrator';
    const speaker = String(rawSpeaker || '').trim();
    if (!speaker) return fallback;
    const match = characterPool.find((name) => name.toLowerCase() === speaker.toLowerCase());
    return match || fallback;
}

function buildFallbackFlavorPack(characters) {
    const safeCharacters = normalizeCharacters(characters, characters);
    const lines = FLAVOR_EVENT_IDS.map((eventId, index) => ({
        event: eventId,
        speaker: safeCharacters[index % safeCharacters.length] || 'Narrator',
        text: DEFAULT_FLAVOR_TEXT_BY_EVENT[eventId] || 'Keep moving. We can recover this fight.'
    }));
    return {
        schemaVersion: FLAVOR_SCHEMA_VERSION,
        characters: safeCharacters,
        lines
    };
}

function normalizeFlavorPackResponse(rawContent, fallbackCharacters = []) {
    const warnings = [];
    const parsed = parseJsonLoose(rawContent);
    if (!parsed) {
        warnings.push({
            code: 'TDSG-W100',
            line: 0,
            column: 1,
            message: 'Flavor pack response was not valid JSON; using fallback lines.',
            hint: 'LLM B should return a single JSON object with schemaVersion, characters, and lines.'
        });
        return {
            flavorPack: buildFallbackFlavorPack(fallbackCharacters),
            warnings
        };
    }

    const characterPool = normalizeCharacters(parsed.characters, fallbackCharacters);
    const linesByEvent = new Map();
    const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];

    for (const item of rawLines) {
        if (!isPlainObject(item)) continue;
        const eventId = normalizeFlavorEventId(item.event);
        if (!FLAVOR_EVENT_SET.has(eventId)) continue;
        if (linesByEvent.has(eventId)) continue;
        const text = String(item.text || '').trim();
        if (!text) continue;
        const speaker = chooseSpeaker(item.speaker, characterPool, linesByEvent.size);
        linesByEvent.set(eventId, { event: eventId, speaker, text });
    }

    for (let i = 0; i < FLAVOR_EVENT_IDS.length; i += 1) {
        const eventId = FLAVOR_EVENT_IDS[i];
        if (linesByEvent.has(eventId)) continue;
        warnings.push({
            code: 'TDSG-W101',
            line: 0,
            column: 1,
            message: 'Flavor pack is missing event "' + eventId + '"; using fallback line.',
            hint: 'Provide exactly one line for each supported event id.'
        });
        linesByEvent.set(eventId, {
            event: eventId,
            speaker: chooseSpeaker('', characterPool, i),
            text: DEFAULT_FLAVOR_TEXT_BY_EVENT[eventId] || 'Hold formation.'
        });
    }

    return {
        flavorPack: {
            schemaVersion: FLAVOR_SCHEMA_VERSION,
            characters: characterPool,
            lines: FLAVOR_EVENT_IDS.map((eventId) => linesByEvent.get(eventId))
        },
        warnings
    };
}

function diagnosticsToWarnings(diagnostics = []) {
    return diagnostics
        .filter((item) => item && item.level === 'warning')
        .map((item) => ({
            code: item.code,
            line: item.line,
            column: item.column,
            message: item.message,
            hint: item.hint
        }));
}

function diagnosticsToErrors(diagnostics = []) {
    return diagnostics
        .filter((item) => item && item.level === 'error')
        .map((item) => ({
            code: item.code,
            line: item.line,
            column: item.column,
            message: item.message,
            hint: item.hint
        }));
}

function makeGeneratedEncounter(script, compileResult, flavorPack, flavorWarnings = [], extraErrors = []) {
    const diagnostics = Array.isArray(compileResult?.diagnostics) ? compileResult.diagnostics : [];
    const warnings = diagnosticsToWarnings(diagnostics).concat(flavorWarnings);
    const errors = diagnosticsToErrors(diagnostics).concat(
        (Array.isArray(extraErrors) ? extraErrors : []).map((message) => ({
            code: 'TDSG-E000',
            line: 0,
            column: 1,
            message: String(message || ''),
            hint: ''
        }))
    );
    const safeFlavorPack = isPlainObject(flavorPack) ? flavorPack : buildFallbackFlavorPack([]);
    return {
        script: stripFacadeMarkers(script || ''),
        scriptKind: compileResult?.metadata?.scriptKind || 'encounter_facade_v1',
        compilerVersion: compileResult?.metadata?.compilerVersion || COMPILER_VERSION,
        sourceHash: compileResult?.metadata?.sourceHash || stableHash(stripFacadeMarkers(script || '')),
        repaired: false,
        expandedEncounterSummary: compileResult?.metadata?.expandedEncounterSummary || null,
        generationPipeline: GENERATION_PIPELINE,
        flavorPack: safeFlavorPack,
        flavorPackHash: stableHash(JSON.stringify(safeFlavorPack)),
        warnings,
        errors
    };
}

async function callFacadeModel(context, tools, options) {
    if (typeof tools?.llm?.runTask !== 'function') {
        throw new Error('tools.llm.runTask is unavailable.');
    }

    const sceneContext = buildSceneContext(context);
    const loreContext = buildLoreContext(context);
    const playerContext = buildRecentPlayerContext(context);
    const facadeUserPrompt = renderPromptTemplate(FACADE_USER_TEMPLATE, {
        SCENE_CONTEXT: sceneContext,
        LORE_CONTEXT: loreContext,
        PLAYER_CONTEXT: playerContext,
        FACADE_GRAMMAR_SUMMARY,
        FACADE_EXAMPLE,
        MARKER_START,
        MARKER_END
    });

    const messages = [
        {
            role: 'system',
            content: FACADE_SYSTEM_PROMPT
        },
        {
            role: 'user',
            content: facadeUserPrompt
        }
    ];

    const result = await tools.llm.runTask({
        title: 'TDS Encounter Facade',
        msg: 'Top-Down Shooter Encounter Facade',
        messages,
        ...resolveModelParams(options),
        temperature: 0.35,
        timeout: normalizeTimeout(options.timeoutMs),
        minCharacters: 120
    });

    return extractFacadeBlock(responseContentToText(result));
}

async function callFlavorModel(context, tools, options, compileResult) {
    if (typeof tools?.llm?.runTask !== 'function') {
        throw new Error('tools.llm.runTask is unavailable.');
    }

    const sceneContext = buildSceneContext(context);
    const canonContext = buildCanonContext(context);
    const balancedHistoryContext = buildBalancedNarrativeHistoryContext(context);
    const loreContext = buildLoreContext(context);
    const characters = buildProminentCharacterNames(context, 6);
    const summaryText = clampText(JSON.stringify(compileResult?.metadata?.expandedEncounterSummary || {}, null, 2), 1200);
    const flavorSchemaExample = JSON.stringify({
        schemaVersion: 1,
        characters: ['Name A', 'Name B'],
        lines: FLAVOR_EVENT_IDS.map((eventId) => ({
            event: eventId,
            speaker: 'Name A',
            text: 'One short in-character line.'
        }))
    }, null, 2);
    const flavorUserPrompt = renderPromptTemplate(FLAVOR_USER_TEMPLATE, {
        SCENE_CONTEXT: sceneContext,
        CANON_CONTEXT: canonContext,
        BALANCED_HISTORY_CONTEXT: balancedHistoryContext,
        LORE_CONTEXT: loreContext,
        CHARACTER_NAMES_JSON: JSON.stringify(characters),
        COMPILED_SUMMARY_JSON: summaryText,
        FLAVOR_RESPONSE_SCHEMA_JSON: flavorSchemaExample,
        FLAVOR_EVENT_IDS_CSV: FLAVOR_EVENT_IDS.join(', ')
    });

    const messages = [
        {
            role: 'system',
            content: FLAVOR_SYSTEM_PROMPT
        },
        {
            role: 'user',
            content: flavorUserPrompt
        }
    ];

    const result = await tools.llm.runTask({
        title: 'TDS Encounter Flavor Pack',
        msg: 'Top-Down Shooter Encounter Flavor Pack',
        messages,
        ...resolveModelParams(options),
        temperature: 0.55,
        timeout: normalizeTimeout(options.timeoutMs),
        minCharacters: 120
    });

    return responseContentToText(result);
}

function failedResult(script, compileResult, errors = [], fallbackCharacters = []) {
    return {
        ok: false,
        encounterDefinition: null,
        encounterSource: 'generated_encounter_facade_fallback',
        generatedEncounter: makeGeneratedEncounter(
            script,
            compileResult,
            buildFallbackFlavorPack(fallbackCharacters),
            [],
            errors
        )
    };
}

async function generateEncounterFromScene(context, tools, options = {}) {
    let script = '';
    let compileResult = null;
    const fallbackCharacters = buildProminentCharacterNames(context, 6);

    try {
        script = await callFacadeModel(context, tools, options);
        compileResult = compileEncounterFacade(script);
        if (!compileResult.ok || !compileResult.encounter) {
            tools?.logger?.warn?.('[top_down_shooter_gameplay_interludes] Generated EncounterFacade failed validation; using fallback encounter.');
            return failedResult(script, compileResult, [], fallbackCharacters);
        }

        let flavorWarnings = [];
        let flavorPack = buildFallbackFlavorPack(fallbackCharacters);
        try {
            const rawFlavor = await callFlavorModel(context, tools, options, compileResult);
            const normalizedFlavor = normalizeFlavorPackResponse(rawFlavor, fallbackCharacters);
            flavorPack = normalizedFlavor.flavorPack;
            flavorWarnings = normalizedFlavor.warnings;
        } catch (error) {
            const message = error?.message || String(error);
            tools?.logger?.warn?.('[top_down_shooter_gameplay_interludes] Flavor pack generation failed: ' + message);
            flavorWarnings.push({
                code: 'TDSG-W102',
                line: 0,
                column: 1,
                message: 'Flavor pack generation failed; using fallback lines.',
                hint: message
            });
        }

        return {
            ok: true,
            encounterDefinition: compileResult.encounter,
            encounterSource: 'generated_encounter_facade',
            generatedEncounter: makeGeneratedEncounter(script, compileResult, flavorPack, flavorWarnings, [])
        };
    } catch (error) {
        const message = error?.message || String(error);
        tools?.logger?.warn?.('[top_down_shooter_gameplay_interludes] Dynamic encounter generation failed: ' + message);
        return failedResult(script, compileResult, [message], fallbackCharacters);
    }
}

module.exports = {
    DEFAULT_TIMEOUT_MS,
    GENERATION_PIPELINE,
    FLAVOR_EVENT_IDS,
    FLAVOR_SCHEMA_VERSION,
    FACADE_GRAMMAR_SUMMARY,
    FACADE_EXAMPLE,
    generateEncounterFromScene
};

/*
 * DEVELOPER NOTE:
 * 1. Custom Title Presets:
 *    Inject into tools.pluginState.turn().titlePresets = { "my_preset": "title:{\"text\":\"{{text}}\",...}" }
 *
 * 2. Extra LLM Commands:
 *    Inject into tools.pluginState.turn().extraCommands = "- \"my:cmd:[char]\" (Description of what it does)"
 *    These will be appended to the Cinematographer's System Prompt at runtime.
 *    If there is a plugin listening and understanding those commands, it should process them normally.
 */

const fs = require('fs');
const path = require('path');
const { parseCommandToUCP } = require('../../modules/vn_manager/ucp_parser.js');
const { formatIndexedSceneLine } = require('../../modules/vn_manager/scene_prompt_formatter.js');

const CAMERA_SILENT_DIRECTOR_PASS = fs.readFileSync(
    path.join(__dirname, 'prompts', 'camera_silent_director_pass.txt'),
    'utf8'
).trim();
const MAIN_SILENT_PLANNING_WORKFLOW = fs.readFileSync(
    path.join(__dirname, 'prompts', 'main_silent_planning_workflow.txt'),
    'utf8'
).trim();

const CATEGORY_TO_SETTING = Object.freeze({
    camera: 'enable_camera_commands',
    spatial: 'enable_camera_commands',
    composition: 'enable_composition_commands',
    animation: 'enable_animation_commands',
    ost: 'enable_ost_commands',
    cast: 'enable_cast_commands',
    emote: 'enable_emote_commands',
    title: 'enable_title_commands',
    vfx: 'enable_vfx_commands',
    sfx: 'enable_sfx_commands'
});

const DEFAULT_TITLE_PRESETS = Object.freeze([
    'character_intro',
    'locationchange',
    'boss',
    'newitem',
    'major_event',
    'discovery',
    'landmark'
]);

const TITLE_EVENT_OWNER = 'vn_cinematographer';
const TITLE_COMPOSITION_VERSION = 1;
const LLM_TITLE_SOURCE = 'vn_cinematographer_llm';
const EXACT_TIME_PATTERN = /(?:\bday\s+\d+\b|\b\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)\b)/i;

const BASE_PROMPT_INTRO = `
You are the Lead Cinematographer for a high-end, cinematic Visual Novel.
Output a Director Track as atomic UCP commands that elevate pacing, blocking, tension, and emotional impact.

You operate on a "Less is More" philosophy:
- Do not spam commands.
- Keep camera MODES stable; "cam:auto" supplies dynamic speaker coverage without requiring a command on every line.
- Use visual/audio changes as punctuation, not constant noise.
`.trim();

const CRITICAL_RULES = `
=== CINEMATOGRAPHY RULES (CRITICAL) ===
1. PACING: Do not toggle manually between wide and auto every line. Auto already follows each visible non-POV speaker.
2. HOLD: Treat camera commands as persistent coverage modes. Enter the mode that serves the beat, then let it work for multiple lines.
3. ESTABLISHING SHOT: New location beats should often anchor with environment framing first.
4. HARSH EFFECT SAFETY: Assume heavy effects must be short-lived for viewer comfort.
5. CAST FLUSH: "cast:flush" is rare and only for hard scene cuts or full party exits.
`.trim();

const CAMERA_SECTION = `
CAMERA:
- "cam:wide" -> Reset to room/environment framing.
- "cam:auto" -> Follow current non-POV speaker automatically.
- "cam:background[:for=N][:zoom=Z][:instant][:ease=name]" -> Focus scenery, hide sprites temporarily, and gently push into the background.
- For "cam:background", zoom is a scalar multiplier (not percent). Use values like 1.04, 1.08, 1.12. Keep zoom in 1.00-1.35.

CAMERA GUIDANCE:
- "cam:auto" is the normal, commonly used coverage mode for character-led conversation. It automatically follows each current visible non-POV speaker, so emit it once when dialogue coverage begins and keep it active across the exchange.
- Do NOT reserve "cam:auto" only for emotional spikes. Ordinary banter, explanations, questions, replies, and conversational back-and-forth usually benefit from it too.
- "cam:wide" should also feel common, but use it when the space or group matters: establishing a location, showing a group tableau or physical action, restoring spatial context, or giving a scene a visual breath/release.
- A typical dialogue scene may establish in "cam:wide", enter "cam:auto" near the first sustained character exchange, remain in auto for several speakers, and return to wide for a meaningful spatial or release beat.
- Avoid leaving a character-led multi-line conversation entirely in wide unless group blocking, action, or environment is genuinely more important than the speakers.
- Use "cam:background" for scenery reverence, awe, world-lore reveals, location identity, or travel beats.
- Avoid "cam:background" during direct back-and-forth dialogue unless the line explicitly calls for environmental focus.
`.trim();

const COMPOSITION_SECTION = `
COMPOSITION (Sprite Staging):
Use these to make subtle emotional staging adjustments while preserving the current left/right character order. They remain sticky until changed.
DO NOT forget to unstick!
Use these sparingly - its not mandatory to use them - if the scene doesn't make sense for any of them do not use them.
Do not use composition commands to resize one character relative to another or to restage the whole group.

Available presets:
- "comp:default"
- "comp:duel:[A]:[B]"
- "comp:separate:[A]:[B]"
- "comp:intimate:[A]:[B]"
- "comp:triangle:[A]:[B]:[C]"
- "comp:protective:[A]:[B]:[C]"
- "comp:observer:[A]:[B]:[C]"
- "comp:lineup:[A]:[B]:[C]"
- "comp:cluster:[PartyA]:[PartyB]:[PartyC]:side=left|right"

Optional modifiers:
- ":for=[lines]" (example: "comp:duel:Stella:Beatrice:for=8")
- ":locked"
- ":instant"
- ":ease=[name]"

COMPOSITION MINI-HANDBOOK:
1) default
Meaning: Balanced baseline staging with no special emphasis.
Best use: Neutral conversation or scene return after stylized framing.
Example: "comp:default"
Avoid: High-drama beats where relationship geometry matters.

2) duel
Meaning: Two-character confrontation lane.
Best use: Verbal sparring, challenge, rivalry, tense negotiations.
Example: "comp:duel:Stella:Beatrice"
Avoid: Tender moments or ensemble chatter.

3) separate
Meaning: Deliberate physical/emotional distance.
Best use: Conflict, distrust, social rupture, awkward silence.
Example: "comp:separate:Stella:Beatrice"
Avoid: Cooperative or affectionate interaction.

4) intimate
Meaning: Tight emotional proximity between two characters.
Best use: Confession, affection, vulnerability, intimacy.
Example: "comp:intimate:Stella:Beatrice"
Avoid: Combat, argument, or comedic chaos.

5) triangle
Meaning: Three-way tension with clear center/periphery.
Best use: Mediation, jealousy, power imbalance among three.
Example: "comp:triangle:Stella:Beatrice:Nilou"
Avoid: Simple two-person exchanges.

6) protective
Meaning: One character shielding or guarding another.
Best use: Threat response, bodyguard beats, loyalty posture.
Example: "comp:protective:Beatrice:Aether:Stella"
Avoid: Casual banter with no danger.

7) observer
Meaning: A watcher frames two active subjects.
Best use: Suspicion, surveillance, judgement from sidelines.
Example: "comp:observer:Stark:Stella:Beatrice"
Avoid: Scenes where all characters are equally active.

8) lineup
Meaning: Formal side-by-side arrangement with role clarity.
Best use: introductions, roll call, synchronized response beat.
Example: "comp:lineup:Stella:Beatrice:Nilou"
Avoid: emotionally charged asymmetrical blocking.

9) cluster
Meaning: Named actors grouped to one side; others counter-stage opposite.
Best use: New character(s) introduced to the group (the group stands on one side, the new character(s) stand on the other), team-vs-team dynamics, etc.
Example: "comp:cluster:Stella:Beatrice:Nilou:side=right"
Avoid: intimate two-person moments.
`.trim();

const ANIMATION_SECTION = `
ANIMATIONS:
- "anim:bounce:[character]" -> Excitement / energy.
- "anim:shake:[character]" -> Fear / damage / anger.
- "anim:sink:[character]" -> Acceptance / nod-like concession.
- "anim:slowsink:[character]" -> Defeat / sadness / sigh.
- "anim:panic:[character]" -> Frantic/comedic panic.
`.trim();

const OST_SECTION = `
OST:
- "ost:silence:[lines]"
Use very sparingly for revelation, dread, suspense, or intimate pressure.
Do not stack repeated silence windows in one short scene.
`.trim();

const CAST_SECTION = `
CAST MANAGEMENT:
- "cast:flush" -> Clears all active sprites. Use only for hard scene breaks, POV shifts, or full exits.
`.trim();

const EMOTE_SECTION = `
EMOTES:
- "emote:exclamation:[char]"
- "emote:question:[char]"
- "emote:sweat:[char]"
- "emote:anger:[char]"
- "emote:heart:[char]"
- "emote:music:[char]"
- "emote:gloom:[char]"
- "emote:tear:[char]"
`.trim();

const buildTitleSection = (titlePresets, authority = {}) => `
TITLES:
- "title:[preset]|[text]|[optionalsubtext]"
Use "|" separators so text can safely include ":".
Use very sparingly for chapter-like moments, introductions, discoveries, or major transitions.
Example: "title:major_event|A Quiet Promise|The vow is made"
Available presets: ${titlePresets.join(', ')}
${authority.location ? 'Location titles are supplied programmatically. Do not create or infer location titles.' : ''}
${authority.time ? 'Exact dates and clock times are supplied programmatically. Do not write exact dates or clock values in titles.' : ''}
`.trim();

function normalizeLineEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
        .map(entry => {
            const line = Number.parseInt(entry?.line, 10);
            if (!Number.isFinite(line) || line < 0) return null;
            const commands = Array.isArray(entry?.commands)
                ? entry.commands.filter(cmd => typeof cmd === 'string' && cmd.trim())
                : [];
            if (commands.length === 0) return null;
            return { line, commands };
        })
        .filter(Boolean);
}

function commandCategoryFor(cmd) {
    if (typeof cmd !== 'string') return null;
    const prefix = String(cmd.split(':')[0] || '').trim().toLowerCase();
    if (prefix === 'cam') return 'camera';
    if (prefix === 'spatial' || prefix === 'stage') return 'spatial';
    if (prefix === 'comp') return 'composition';
    if (prefix === 'anim') return 'animation';
    if (prefix === 'ost') return 'ost';
    if (prefix === 'cast') return 'cast';
    if (prefix === 'emote') return 'emote';
    if (prefix === 'title') return 'title';
    if (prefix === 'vfx') return 'vfx';
    if (prefix === 'sfx') return 'sfx';
    return null;
}

function isCategoryEnabled(settings, category) {
    const settingKey = CATEGORY_TO_SETTING[category];
    if (!settingKey) return true;
    return settings[settingKey] !== false;
}

function filterDirectorTrackBySettings(data, settings) {
    if (!data || !data.script) return null;

    const scriptEntries = Array.isArray(data.script) ? data.script : Object.values(data.script || {});
    const filtered = [];

    for (const entry of scriptEntries) {
        const line = Number.parseInt(entry?.line, 10);
        if (!Number.isFinite(line) || line < 0) continue;
        const commands = Array.isArray(entry?.commands) ? entry.commands : Object.values(entry?.commands || {});
        const kept = commands.filter((cmd) => {
            if (typeof cmd !== 'string' || !cmd.trim()) return false;
            const category = commandCategoryFor(cmd);
            if (!category) return true;
            return isCategoryEnabled(settings, category);
        });
        if (kept.length > 0) filtered.push({ line, commands: kept });
    }

    return { ...data, script: filtered };
}

function filterTrackByAllowedCategories(data, allowedCategories) {
    if (!data || !data.script) return null;
    const allowed = new Set(Array.isArray(allowedCategories) ? allowedCategories : []);
    const scriptEntries = Array.isArray(data.script) ? data.script : Object.values(data.script || {});
    const filtered = [];

    for (const entry of scriptEntries) {
        const line = Number.parseInt(entry?.line, 10);
        if (!Number.isFinite(line) || line < 0) continue;
        const commands = Array.isArray(entry?.commands) ? entry.commands : Object.values(entry?.commands || {});
        const kept = commands.filter((cmd) => {
            if (typeof cmd !== 'string' || !cmd.trim()) return false;
            const category = commandCategoryFor(cmd);
            if (!category) return false;
            return allowed.has(category);
        });
        if (kept.length > 0) filtered.push({ line, commands: kept });
    }

    return { ...data, script: filtered };
}

function mergeDirectorTracks(cameraTrack, mainTrack) {
    const camEntries = normalizeLineEntries(Array.isArray(cameraTrack?.script) ? cameraTrack.script : Object.values(cameraTrack?.script || {}));
    const mainEntries = normalizeLineEntries(Array.isArray(mainTrack?.script) ? mainTrack.script : Object.values(mainTrack?.script || {}));
    const map = new Map();

    for (const entry of camEntries) {
        const slot = map.get(entry.line) || { line: entry.line, cam: [], main: [] };
        slot.cam.push(...entry.commands);
        map.set(entry.line, slot);
    }
    for (const entry of mainEntries) {
        const slot = map.get(entry.line) || { line: entry.line, cam: [], main: [] };
        slot.main.push(...entry.commands);
        map.set(entry.line, slot);
    }

    const script = Array.from(map.values())
        .sort((a, b) => a.line - b.line)
        .map((entry) => {
            const merged = [...entry.cam, ...entry.main];
            const deduped = [];
            const seen = new Set();
            for (const cmd of merged) {
                if (seen.has(cmd)) continue;
                seen.add(cmd);
                deduped.push(cmd);
            }
            return { line: entry.line, commands: deduped };
        })
        .filter(entry => entry.commands.length > 0);

    return {
        reasoning: [cameraTrack?.reasoning, mainTrack?.reasoning].filter(Boolean).join('\n\n'),
        script
    };
}

function collectBackgroundChanges(turnContext) {
    const changes = Array.isArray(turnContext?.output?.bgChanges)
        ? turnContext.output.bgChanges
        : Array.isArray(turnContext?.processed?.assetSelector?.backgroundChangesDraft)
            ? turnContext.processed.assetSelector.backgroundChangesDraft
            : [];

    return changes
        .map(change => ({
            line: Number.parseInt(change?.line, 10),
            path: String(change?.path || '').trim()
        }))
        .filter(change => Number.isFinite(change.line) && change.line >= 0 && change.path)
        .sort((a, b) => a.line - b.line);
}

function getInitialBackgroundHint(turnContext) {
    return turnContext?.processed?.assetSelector?.backgroundDraft
        || turnContext?.processed?.assetSelector?.background
        || turnContext?.output?.finalBackground
        || null;
}

function buildScriptLinesForPrompt(turnContext) {
    const sequence = Array.isArray(turnContext?.output?.sequence) ? turnContext.output.sequence : [];
    const changes = collectBackgroundChanges(turnContext);
    const changesByLine = new Map();
    for (const change of changes) {
        if (!changesByLine.has(change.line)) changesByLine.set(change.line, []);
        changesByLine.get(change.line).push(change.path);
    }

    const lines = [];
    const initialBackground = getInitialBackgroundHint(turnContext);
    if (initialBackground) {
        lines.push(`-- initial background: ${initialBackground} --`);
    }
    lines.push('NOTE: Backgrounds are visual anchor points. If a line emphasizes scenery, place, scale, or awe, camera/background framing can prioritize environment.');

    for (let i = 0; i < sequence.length; i++) {
        if (changesByLine.has(i)) {
            for (const path of changesByLine.get(i)) {
                lines.push(`-- background changed to: ${path} --`);
            }
        }
        const scene = sequence[i] || {};
        lines.push(formatIndexedSceneLine(scene, i));
    }

    return lines.join('\n');
}

function enabledPromptSections({ settings, titlePresets, titleAuthority, vfxPrompt, sfxPrompt, extraCommands }, categories) {
    const sections = [];
    for (const category of categories) {
        if (!isCategoryEnabled(settings, category)) continue;
        if (category === 'camera') sections.push(CAMERA_SECTION);
        if (category === 'composition') sections.push(COMPOSITION_SECTION);
        if (category === 'animation') sections.push(ANIMATION_SECTION);
        if (category === 'ost') sections.push(OST_SECTION);
        if (category === 'cast') sections.push(CAST_SECTION);
        if (category === 'emote') sections.push(EMOTE_SECTION);
        if (category === 'title') sections.push(buildTitleSection(titlePresets, titleAuthority));
        if (category === 'vfx' && vfxPrompt) sections.push(vfxPrompt);
        if (category === 'sfx' && sfxPrompt) sections.push(sfxPrompt);
    }
    if (extraCommands) {
        sections.push(`EXTRA COMMANDS (FROM PLUGINS):\n${extraCommands}`);
    }
    return sections;
}

function allowedPrefixesForCategories(categories) {
    const map = {
        camera: ['cam'],
        spatial: ['spatial', 'stage'],
        composition: ['comp'],
        animation: ['anim'],
        ost: ['ost'],
        cast: ['cast'],
        emote: ['emote'],
        title: ['title'],
        vfx: ['vfx'],
        sfx: ['sfx']
    };

    const prefixes = new Set();
    for (const category of categories || []) {
        const bucket = map[category] || [];
        for (const prefix of bucket) prefixes.add(prefix);
    }
    return Array.from(prefixes);
}

function buildOutputExampleForCategories(categories) {
    const categorySet = new Set(Array.isArray(categories) ? categories : []);
    const isCameraTrack = categorySet.size > 0 && Array.from(categorySet).every(cat => ['camera', 'composition'].includes(cat));
    const isMainTrack = categorySet.size > 0 && Array.from(categorySet).every(cat => ['animation', 'ost', 'cast', 'emote', 'title', 'vfx', 'sfx'].includes(cat));

    if (isCameraTrack) {
        return `{
  "reasoning": "Briefly explain your camera and composition choices.",
  "script": [
    {"line": 0, "commands": ["cam:wide"]},
    {"line": 2, "commands": ["cam:auto"]},
    {"line": 11, "commands": ["cam:wide"]}
  ]
}`;
    }

    if (isMainTrack) {
        return `{
  "reasoning": "Briefly explain your non-camera cinematic choices.",
  "script": [
    {"line": 0, "commands": ["sfx:start:wind.mp3", "vfx:start:rain"]},
    {"line": 8, "commands": ["emote:tear:Stella", "title:major_event|A Quiet Promise|Nightfall"]}
  ]
}`;
    }

    return `{
  "reasoning": "Briefly explain your choices.",
  "script": [
    {"line": 0, "commands": ["cam:wide", "sfx:start:wind.mp3"]},
    {"line": 2, "commands": ["cam:auto"]},
    {"line": 11, "commands": ["cam:wide"]}
  ]
}`;
}

function addAmbientCandidate(candidates, id, reason) {
    if (!candidates.has(id)) candidates.set(id, []);
    if (reason && !candidates.get(id).includes(reason)) candidates.get(id).push(reason);
}

function collectVfxGroundingText(turnContext, worldState, locationText) {
    const parts = [
        locationText,
        worldState?.weatherChange,
        worldState?.safetyLevel,
        worldState?.crowdDensity,
        getInitialBackgroundHint(turnContext),
        ...collectBackgroundChanges(turnContext).map(change => change.path)
    ];

    const sequence = Array.isArray(turnContext?.output?.sequence) ? turnContext.output.sequence : [];
    for (const scene of sequence) {
        parts.push(scene?.line, scene?.text, scene?.character);
    }

    return parts
        .filter(value => value !== null && value !== undefined)
        .map(value => String(value))
        .join('\n')
        .toLowerCase();
}

function buildGroundedAmbientVfxSection(turnContext, worldState, locationText, allowedCategories) {
    if (!Array.isArray(allowedCategories) || !allowedCategories.includes('vfx')) return '';

    const groundingText = collectVfxGroundingText(turnContext, worldState, locationText);
    const candidates = new Map();

    if (/\b(rain|raining|rainstorm|downpour|storm|thunderstorm)\b/.test(groundingText)) {
        addAmbientCandidate(candidates, 'rain', 'rain, storm, or downpour is present in weather, location, background, or narration');
    }
    if (/\b(thunder|lightning|storm|thunderstorm)\b/.test(groundingText)) {
        addAmbientCandidate(candidates, 'thunder', 'thunder, lightning, or storm activity is present');
    }
    if (/\b(snow|snowing|snowfall|blizzard|frost|frozen|icy|icefield|winter|tundra)\b/.test(groundingText)) {
        addAmbientCandidate(candidates, 'snow', 'snow, frost, ice, winter, or frozen terrain is present');
    }
    if (/\b(fog|foggy|mist|misty|haze|hazy|smog|murk|swamp|marsh)\b/.test(groundingText)) {
        addAmbientCandidate(candidates, 'fog', 'fog, mist, haze, swamp, marsh, or murky air is present');
    }
    if (/\b(cloud|clouds|cloudy|overcast|sky|skies|outdoor|outside|open air|windy|breeze)\b/.test(groundingText)
        && !/\b(underground|cave|cavern|indoors|interior|basement|tunnel)\b/.test(groundingText)) {
        addAmbientCandidate(candidates, 'clouds', 'outdoor sky, clouds, wind, or overcast conditions are present');
    }
    if (/\b(desert|dune|sand|sandy|dust|dusty|arid|dry|canyon|wasteland|badlands|ruins)\b/.test(groundingText)) {
        addAmbientCandidate(candidates, 'desert-dust', 'dry, sandy, dusty, ruined, or desert-like conditions are present');
    }
    if (/\b(fire|flame|flames|burning|burned|smoke|smoky|ash|ashes|ember|embers|forge|volcanic|lava)\b/.test(groundingText)) {
        addAmbientCandidate(candidates, 'embers', 'fire, ash, smoke, forge heat, or volcanic conditions are present');
    }
    if (/\b(forest|woods|woodland|grove|tree|trees|leaf|leaves|autumn|garden|canopy)\b/.test(groundingText)) {
        addAmbientCandidate(candidates, 'leaves', 'trees, forest, garden, canopy, leaves, or autumn conditions are present');
    }
    if (/\b(magic|magical|spell|aura|glow|glowing|mana|ley|shrine|ritual|divine|dream|ethereal|mystic|mystical)\b/.test(groundingText)) {
        addAmbientCandidate(candidates, 'magic-dust', 'magic, aura, ritual, shrine, divine, dream, or ethereal cues are present');
    }
    if (/\b(sunbeam|sunlight|sunrise|sunset|dawn|golden light|holy|divine|cathedral|temple|radiant)\b/.test(groundingText)) {
        addAmbientCandidate(candidates, 'godray', 'sunbeams, radiant light, holy space, temple, or divine lighting is present');
    }

    const candidateLines = Array.from(candidates.entries())
        .map(([id, reasons]) => `- "${id}": ${reasons.join('; ')}.`)
        .join('\n');

    const candidateText = candidateLines || '- No strong ambient candidates were detected from pre-scene context; only use VFX if the scene script itself clearly justifies them.';

    return `
=== GROUNDED AMBIENT VFX GUIDANCE ===
Ambient VFX should be more proactive than impact VFX, but every effect still needs evidence.
Use these candidates when they improve continuity, especially near the first relevant line:
${candidateText}

Do not treat this list as mandatory. If the scene contradicts a candidate, omit it.
Do not emit rain, snow, dust, fire, magic, or sky effects unless weather, location, background, or narration supports them.
Persistent ambient VFX should be cleared when the environment no longer supports them.
`.trim();
}

function buildSystemPrompt({
    turnContext,
    tools,
    settings: _settings,
    charRules,
    worldState,
    locationText,
    sections,
    trackRole,
    allowedCategories
}) {
    const allowedPrefixes = allowedPrefixesForCategories(allowedCategories);
    const outputExample = buildOutputExampleForCategories(allowedCategories);
    const prefixRule = allowedPrefixes.length > 0
        ? `You may ONLY emit commands using these prefixes: ${allowedPrefixes.join(', ')}.`
        : 'Use only valid known command prefixes.';
    const groundedAmbientVfxSection = buildGroundedAmbientVfxSection(turnContext, worldState, locationText, allowedCategories);

    return `
${BASE_PROMPT_INTRO}

TRACK ROLE:
${trackRole}

${CRITICAL_RULES}

${tools.directives.getFormatted('camera_directives', { header: '### CINEMATOGRAPHY DIRECTIVES' })}

${charRules}

=== COMMAND GRAMMAR (STRICT) ===
All commands must be plain strings in atomic colon format.
Do NOT include JSON inside command strings.
Do NOT invent unknown command prefixes.
${prefixRule}
If a command idea is outside your allowed prefixes, omit it.

${sections.map((section, idx) => `${idx + 1}. ${section}`).join('\n\n')}

IF doing a storm that includes thunder, prefer matching thunder VFX + thunder SFX together and stop both when the beat ends.
${groundedAmbientVfxSection ? `\n\n${groundedAmbientVfxSection}` : ''}

=== WORLD STATE CONTEXT ===
${locationText}
Environment: ${worldState.weatherChange || 'Neutral'} / ${worldState.safetyLevel || 'Safe'} / ${worldState.crowdDensity || 'Sparse'}
This state is from scene start and may evolve in the script.

=== CHARACTER CONTEXT ===
Main POV character: ${turnContext.input.playerCharacterName || 'the player'}
The POV character is NOT on camera and should never be targeted by camera directives.

=== OUTPUT FORMAT ===
You must output VALID JSON.
${outputExample}

Only include lines where change occurs. Line indices reference the scene script exactly.
`.trim();
}

function buildTrackMessages(systemPrompt, scriptLines, assistantPrimer = '') {
    return [
        { role: 'system', content: systemPrompt },
        ...(assistantPrimer ? [{ role: 'assistant', content: assistantPrimer }] : []),
        { role: 'user', content: `=== SCENE SCRIPT ===\n${scriptLines}` }
    ];
}

async function runTrackLLM({ tools, settings: _settings, modelDef, reasoningConfig, systemPrompt, assistantPrimer = '', scriptLines, msg }) {
    const built = buildTrackMessages(systemPrompt, scriptLines, assistantPrimer);
    const response = await tools.llm.json({
        msg,
        requestId: `cinematography_${String(msg || 'track').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'track'}`,
        prompt: { messages: built.map((message, index) => ({
            role: message.role,
            piece: `track.message_${index + 1}`,
            text: String(message.content ?? '')
        })) },
        model: modelDef.model,
        params: {
            extra: { reasoning: reasoningConfig },
            callingModule: 'Plugin:vn_cinematographer'
        }
    });
    return response.content;
}

module.exports = {
    id: 'vn_cinematographer',
    name: 'VN Cinematographer',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Visual',
    wizard: {
        include: true,
        order: 600,
        group: 'Visual',
        label: 'VN Cinematographer',
        recommended_enabled: true,
        author_note: 'Recommended for VN mode if you want camera, VFX, and SFX direction instead of static staging.',
        enabled_note: 'Adds a cinematic director track for camera composition, effects, and sound cues.',
        disabled_note: 'VN output remains simpler and relies more on base scene rendering.',
        settings_note: 'Tune cinematographer model, command budget, and dependency usage in plugin settings.'
    },
    description: 'Controls camera, composition, VFX, and SFX as a cinematic director track.',
    optionalDependencies: [
        { id: 'vn_pixijs_vfx', reason: 'Lets the cinematographer schedule visual effects and shader moments.' },
        { id: 'vn_sfx', reason: 'Lets the cinematographer schedule scene-specific sound cues.' },
        { id: 'world_state_tracker', reason: 'Supplies weather, time, and other world conditions for cinematic direction.' },
        { id: 'world_location_tracker', reason: 'Supplies location and travel context for camera and staging choices.' },
        { id: 'character_classifier', reason: 'Helps the cinematographer prioritize important characters and avoid generic staging.' }
    ],
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Serves as the Lead Cinematographer for the Visual Novel, automating camera work, composition, VFX, and SFX.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Operates in a post-generation phase. It analyzes scene lines and generates a director track of UCP commands consumed by the VN viewer.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'None',
            immersion: 'High',
            cost: 'Medium',
            latency: 'Medium'
        },
        model_def: {
            type: 'select',
            label: 'Cinematographer Model',
            description: 'Model used to design visual choreography for each scene.',
            options: 'llm-aliases',
            default: { model: 'mediumendmodel' }
        },
        skip_reasoning: {
            type: 'checkbox',
            label: 'Skip LLM Reasoning',
            description: 'If enabled, requests no reasoning tokens for lower latency.',
            default: true
        },
        standalone_camera_llm: {
            type: 'checkbox',
            label: 'Standalone Camera LLM',
            description: 'Enable to have a separate LLM handle complex camera composition.',
            default: true
        },
        enable_camera_commands: {
            type: 'checkbox',
            label: 'Enable Camera Commands',
            default: true
        },
        enable_composition_commands: {
            type: 'checkbox',
            label: 'Enable Composition Commands',
            default: true
        },
        enable_animation_commands: {
            type: 'checkbox',
            label: 'Enable Animation Commands',
            default: true
        },
        enable_ost_commands: {
            type: 'checkbox',
            label: 'Enable OST Commands',
            default: true
        },
        enable_cast_commands: {
            type: 'checkbox',
            label: 'Enable Cast Commands',
            default: true
        },
        enable_emote_commands: {
            type: 'checkbox',
            label: 'Enable Emote Commands',
            default: true
        },
        enable_title_commands: {
            type: 'checkbox',
            label: 'Enable Title Commands',
            default: true
        },
        enable_vfx_commands: {
            type: 'checkbox',
            label: 'Enable VFX Commands',
            default: true
        },
        enable_sfx_commands: {
            type: 'checkbox',
            label: 'Enable SFX Commands',
            default: true
        },
        auto_wobble_on_zoom: {
            type: 'checkbox',
            label: 'Auto Wobble on Zoom',
            description: 'Auto enables wobble on cam:auto and clears it on cam:wide.',
            default: true
        },
        comp_auto_zoom_cooldown_lines: {
            type: 'number',
            label: 'Comp Auto-Zoom Cooldown (Dialogue Lines)',
            description: 'After a composition switch, suppresses cam:auto for this many dialogue lines.',
            default: 3
        },
        auto_end_harsh_effects: {
            type: 'checkbox',
            label: 'Auto End Harsh Effects',
            description: 'Terminates harsh effects if they overstay.',
            default: true
        },
        harsh_effect_limit: {
            type: 'number',
            label: 'Harsh Effect Line Limit',
            description: 'Maximum lines a harsh effect can persist.',
            default: 5
        },
        camera_directives: {
            type: 'project-directive',
            label: 'Cinematography & Visual Timing',
            description: 'Project-level guidance for camera style, VFX use, and cinematic pacing.',
            placeholder: 'e.g., "Use dramatic zooms during revelations. Keep SFX subtle and atmospheric."',
            isProjectDirective: true
        }
    },

    hooks: {
        'HOOK_POST_VN_GENERATION': {
            priority: 100,
            mode: 'parallel',
            allowInterlude: true,
            run: async (turnContext, tools) => {
                const results = await runCinematographer(turnContext, tools);
                if (results) applyDirectorTrack(turnContext, tools, results);
            }
        },

        'HOOK_FRONTEND_INJECTION': {
            allowInterlude: true,
            run: async (turnContext, tools) => {
                const settings = tools.settings.getSelf();
                return {
                    id: 'vn_cinematographer_settings',
                    js: `window.CINEMATOGRAPHER_SETTINGS = ${JSON.stringify(settings)};`
                };
            }
        }
    },

    exports: {
        applyDirectorTrack: (turnContext, tools, data) => {
            return applyDirectorTrack(turnContext, tools, data);
        },

        replaceTitleContributions: (turnContext, tools, request) => {
            return replaceTitleContributions(turnContext, tools, request);
        },

        isNewCharacter: async (turnContext, tools, characterName) => {
            if (!characterName) return false;
            return await tools.plugins.tryCall(
                'character_classifier',
                'isNewCharacter',
                [turnContext, tools, characterName],
                { fallback: false, silent: true }
            );
        }
    }
};

async function getNewMajorCharacters(turnContext, tools) {
    const party = turnContext.output?.party || [];
    if (party.length === 0) return [];

    const newChars = [];
    for (const charName of party) {
        const isNew = await tools.plugins.tryCall(
            'character_classifier',
            'isNewCharacter',
            [turnContext, tools, charName],
            { fallback: false, silent: true }
        );
        if (isNew) newChars.push(charName);
    }
    return newChars;
}

async function getTitleAuthority(turnContext, tools) {
    const time = tools.plugins.isInstalled('world_state_tracker');
    let location = false;

    if (tools.plugins.isInstalled('world_location_tracker')) {
        const status = await tools.plugins.tryCall(
            'world_location_tracker',
            'getOperationalStatus',
            [],
            { fallback: { active: false }, silent: true }
        );
        location = status?.active === true;
    }

    const authority = { location, time };
    turnContext.runtime = turnContext.runtime || {};
    turnContext.runtime.vnCinematographer = turnContext.runtime.vnCinematographer || {};
    turnContext.runtime.vnCinematographer.titleAuthority = authority;
    return authority;
}

function getAvailableTitlePresets(turnContext, tools, authority = {}) {
    const dynamicPresets = tools?.pluginState?.turn?.()?.titlePresets;
    const presets = dynamicPresets && Object.keys(dynamicPresets).length > 0
        ? Object.keys(dynamicPresets)
        : DEFAULT_TITLE_PRESETS.slice();
    return authority.location ? presets.filter(preset => preset !== 'locationchange') : presets;
}

function parseTitleCommandParts(cmd) {
    if (typeof cmd !== 'string' || !cmd.startsWith('title:')) return null;
    const usesPipes = cmd.includes('|');
    const parts = usesPipes
        ? ['title', ...cmd.substring(6).split('|')]
        : cmd.split(':');
    if (parts.length < 3) return null;
    return {
        preset: String(parts[1] || '').trim(),
        text: String(parts[2] || '').trim(),
        subtext: parts.slice(3).join(usesPipes ? '|' : ':').trim()
    };
}

function createProgrammaticTitleConfig(composition) {
    const location = composition.location?.text || '';
    const time = composition.time?.text || '';
    return {
        text: location || time,
        subtext: '',
        locationText: '',
        timeText: location ? time : '',
        style: {
            fill: '#ffd700',
            fontWeight: '900',
            fontSize: 90,
            stroke: '#332200',
            strokeThickness: 4
        },
        timeStyle: {
            fill: '#f1e3ae',
            fontSize: 28,
            fontStyle: 'normal',
            fontWeight: '600'
        },
        anim: { in: 'top', out: 'bottom', hold: 3000 },
        pos: { x: 0.5, y: 0.2, align: 'center' },
        effects: { type: 'ghost' }
    };
}

function findOwnedTitleEvent(scene) {
    return (scene?.clientEvents || []).find(event => (
        event?.type === 'vn:title-popout'
        && event?.payload?.titleComposition?.owner === TITLE_EVENT_OWNER
    )) || null;
}

function rebuildOwnedTitleEvent(scene, event) {
    const composition = event?.payload?.titleComposition;
    if (!composition) return null;
    const creativeConfig = composition.creative?.config || null;
    const hasLocation = !!composition.location?.text;
    const hasTime = !!composition.time?.text;

    if (!creativeConfig && !hasLocation && !hasTime) {
        scene.clientEvents = (scene.clientEvents || []).filter(candidate => candidate !== event);
        return null;
    }

    const config = creativeConfig
        ? {
            ...creativeConfig,
            locationText: hasLocation ? composition.location.text : '',
            timeText: hasTime ? composition.time.text : '',
            locationStyle: {
                fill: '#ffd866',
                fontSize: 34,
                fontStyle: 'normal',
                fontWeight: '700',
                ...(creativeConfig.locationStyle || {})
            },
            timeStyle: {
                fill: '#f1e3ae',
                fontSize: 27,
                fontStyle: 'normal',
                fontWeight: '600',
                ...(creativeConfig.timeStyle || {})
            }
        }
        : createProgrammaticTitleConfig(composition);

    event.payload = {
        ...config,
        titleComposition: composition
    };
    return event;
}

function upsertTitleAtLine(turnContext, contribution) {
    const sequence = turnContext?.output?.sequence;
    const line = Number.parseInt(contribution?.line, 10);
    if (!Array.isArray(sequence) || !Number.isInteger(line) || line < 0 || line >= sequence.length) return null;

    const scene = sequence[line];
    scene.clientEvents = Array.isArray(scene.clientEvents) ? scene.clientEvents : [];
    let event = findOwnedTitleEvent(scene);
    if (!event) {
        event = {
            type: 'vn:title-popout',
            payload: {
                titleComposition: {
                    version: TITLE_COMPOSITION_VERSION,
                    owner: TITLE_EVENT_OWNER,
                    creative: null,
                    location: null,
                    time: null
                }
            }
        };
        scene.clientEvents.push(event);
    }

    const composition = event.payload.titleComposition;
    if (contribution.kind === 'creative' && contribution.config) {
        composition.creative = {
            source: contribution.source || LLM_TITLE_SOURCE,
            preset: contribution.preset || null,
            config: JSON.parse(JSON.stringify(contribution.config))
        };
    } else if (['location', 'time'].includes(contribution.kind) && contribution.text) {
        composition[contribution.kind] = {
            source: contribution.source,
            text: String(contribution.text).trim()
        };
    }

    return rebuildOwnedTitleEvent(scene, event);
}

function replaceTitleContributions(turnContext, tools, request = {}) {
    const settings = tools.settings.getSelf();
    const sequence = turnContext?.output?.sequence;
    const source = String(request.source || '').trim();
    if (!Array.isArray(sequence) || !source) return [];

    for (const scene of sequence) {
        const event = findOwnedTitleEvent(scene);
        const composition = event?.payload?.titleComposition;
        if (!composition) continue;
        for (const kind of ['creative', 'location', 'time']) {
            if (composition[kind]?.source === source) composition[kind] = null;
        }
        rebuildOwnedTitleEvent(scene, event);
    }

    if (settings.enable_title_commands === false) return [];

    const applied = [];
    for (const raw of (Array.isArray(request.contributions) ? request.contributions : [])) {
        const kind = String(raw?.kind || '').trim().toLowerCase();
        if (!['location', 'time', 'creative'].includes(kind)) continue;
        const event = upsertTitleAtLine(turnContext, { ...raw, kind, source });
        if (event) applied.push({ line: Number(raw.line), kind });
    }
    return applied;
}

function convertTitleCommand(cmd, turnContext, tools) {
    if (!cmd.startsWith('title:')) return cmd;

    let parts = [];
    if (cmd.includes('|')) {
        parts = ['title', ...cmd.substring(6).split('|')];
    } else {
        parts = cmd.split(':');
    }
    if (parts.length < 3) return cmd;

    const preset = parts[1];
    const text = parts[2];
    const subtext = parts.slice(3).join(cmd.includes('|') ? '|' : ':');

    const dynamicPresets = tools?.pluginState?.turn?.()?.titlePresets;
    if (dynamicPresets && dynamicPresets[preset]) {
        return dynamicPresets[preset].replace(/{{text}}/g, text).replace(/{{subtext}}/g, subtext);
    }

    let config = null;
    switch (preset) {
        case 'character_intro':
            config = {
                text,
                subtext,
                style: { fill: '#ffffff', fontWeight: '900', stroke: '#000000', strokeThickness: 6, letterSpacing: 8 },
                subStyle: { fill: '#aaaaaa', fontStyle: 'italic', fontSize: 34 },
                anim: { in: 'left', out: 'right', hold: 4000 },
                pos: { x: 0.1, y: 0.5, align: 'left' },
                effects: { type: 'magic', color: 0xffffff }
            };
            break;
        case 'locationchange':
            config = {
                text,
                subtext,
                style: { fill: '#ffd700', fontWeight: '900', fontSize: 90, stroke: '#332200', strokeThickness: 4 },
                anim: { in: 'top', out: 'bottom', hold: 3000 },
                pos: { x: 0.5, y: 0.2, align: 'center' },
                effects: { type: 'ghost' }
            };
            break;
        case 'boss':
            config = {
                text,
                subtext: 'THREAT DETECTED',
                style: { fill: '#ff0000', fontWeight: '900', fontSize: 120, stroke: '#000000', strokeThickness: 10, letterSpacing: 12 },
                subStyle: { fill: '#ff6666', fontWeight: '700', fontSize: 40 },
                anim: { in: 'fade', out: 'fade', hold: 5000 },
                pos: { x: 0.5, y: 0.4, align: 'center' },
                effects: { type: 'fire' }
            };
            break;
        case 'newitem':
            config = {
                text: `+ ${text}`,
                subtext,
                style: { fill: '#ffff00', fontSize: 50, stroke: '#444400', strokeThickness: 4 },
                anim: { in: 'right', out: 'top', hold: 3000 },
                pos: { x: 0.85, y: 0.1, align: 'right' },
                effects: { type: 'magic', color: 0xffff00 }
            };
            break;
        case 'major_event':
            config = {
                text,
                style: { fill: '#ffffff', fontWeight: '900', fontSize: 80, letterSpacing: 20 },
                anim: { in: 'fade', out: 'fade', hold: 4000 },
                pos: { x: 0.5, y: 0.7, align: 'center' },
                effects: { type: 'magic' }
            };
            break;
        case 'discovery':
        case 'landmark':
            config = {
                text,
                subtext: preset === 'landmark' ? 'Landmark Reached' : 'New Discovery',
                style: { fill: '#00ffaa', fontSize: 60, stroke: '#004422', strokeThickness: 4 },
                anim: { in: 'bottom', out: 'right', hold: 3000 },
                pos: { x: 0.9, y: 0.9, align: 'right' },
                effects: { type: 'ghost' }
            };
            break;
    }

    return config ? `title:${JSON.stringify(config)}` : cmd;
}

async function runCinematographer(turnContext, tools) {
    try {
        const settings = tools.settings.getSelf();
        const narrative = turnContext.processed.narrativeEngine?.writerResponse;
        if (!narrative) return null;

        const worldState = turnContext.processed.worldState || {};
        const locationText = turnContext.processed.assetSelector?.extraDetails || 'Unknown Location';
        const newMajorChars = await getNewMajorCharacters(turnContext, tools);
        const titleAuthority = await getTitleAuthority(turnContext, tools);
        const titlePresets = getAvailableTitlePresets(turnContext, tools, titleAuthority);

        const charRules = newMajorChars.length > 0
            ? `=== CHARACTER CLASSIFICATION RULES ===
New character(s) detected: ${newMajorChars.join(', ')}.
Ignore non-characters and generic roles.
If a remaining named character is a meaningful first appearance, use "title:character_intro|Name|Role".`
            : `=== CHARACTER CONTEXT ===
All visible characters are known. Do not use intro titles for known characters.`;

        const vfxPrompt = tools.plugins.get('vn_pixijs_vfx')?.exports?.getVfxPrompt
            ? await tools.plugins.get('vn_pixijs_vfx').exports.getVfxPrompt(turnContext, tools)
            : '';
        const sfxPrompt = tools.plugins.get('vn_sfx')?.exports?.getSfxPrompt
            ? await tools.plugins.get('vn_sfx').exports.getSfxPrompt(turnContext, tools)
            : '';
        const extraCommands = tools.pluginState.turn().extraCommands || '';
        const scriptLines = buildScriptLinesForPrompt(turnContext);

        const modelDef = settings.model_def || { model: 'mediumendmodel' };
        const reasoningConfig = settings.skip_reasoning ? { effort: 'none' } : {};

        const basePromptContext = { settings, titlePresets, titleAuthority, vfxPrompt, sfxPrompt, extraCommands };
        const cameraCompEnabled = isCategoryEnabled(settings, 'camera') || isCategoryEnabled(settings, 'composition');
        const mainTrackCategories = ['animation', 'ost', 'cast', 'emote', 'title', 'vfx', 'sfx'];
        const mainTrackEnabled = mainTrackCategories.some(category => isCategoryEnabled(settings, category));
        const standaloneCamera = settings.standalone_camera_llm !== false && cameraCompEnabled;

        if (!standaloneCamera) {
            const categories = ['camera', 'composition', 'animation', 'ost', 'cast', 'emote', 'title', 'vfx', 'sfx'];
            const sections = enabledPromptSections(basePromptContext, categories);
            if (sections.length === 0) {
                tools.logger.log('Cinematographer', 'All command categories are disabled; skipping LLM call.');
                return null;
            }

            const systemPrompt = buildSystemPrompt({
                turnContext,
                tools,
                settings,
                charRules,
                worldState,
                locationText,
                sections,
                trackRole: 'Single-track director. You may use any enabled command categories.',
                allowedCategories: categories
            });

            const single = await runTrackLLM({
                tools,
                settings,
                modelDef,
                reasoningConfig,
                systemPrompt,
                assistantPrimer: [
                    cameraCompEnabled ? CAMERA_SILENT_DIRECTOR_PASS : '',
                    mainTrackEnabled ? MAIN_SILENT_PLANNING_WORKFLOW : ''
                ].filter(Boolean).join('\n\n'),
                scriptLines,
                msg: 'Cinematographer'
            });
            return filterTrackByAllowedCategories(filterDirectorTrackBySettings(single, settings), categories);
        }

        const cameraSections = enabledPromptSections(basePromptContext, ['camera', 'composition']);
        const mainSections = enabledPromptSections(basePromptContext, ['animation', 'ost', 'cast', 'emote', 'title', 'vfx', 'sfx']);

        const cameraPrompt = cameraSections.length > 0
            ? buildSystemPrompt({
                turnContext,
                tools,
                settings,
                charRules,
                worldState,
                locationText,
                sections: cameraSections,
                trackRole: 'Camera/Composition specialist. Output only camera + composition commands.',
                allowedCategories: ['camera', 'composition']
            })
            : null;

        const mainPrompt = mainSections.length > 0
            ? buildSystemPrompt({
                turnContext,
                tools,
                settings,
                charRules,
                worldState,
                locationText,
                sections: mainSections,
                trackRole: 'Non-camera specialist. Do not emit camera or composition commands.',
                allowedCategories: ['animation', 'ost', 'cast', 'emote', 'title', 'vfx', 'sfx']
            })
            : null;

        const tasks = [];
        if (cameraPrompt) {
            tasks.push(runTrackLLM({
                tools,
                settings,
                modelDef,
                reasoningConfig,
                systemPrompt: cameraPrompt,
                assistantPrimer: CAMERA_SILENT_DIRECTOR_PASS,
                scriptLines,
                msg: 'Cinematographer-CameraTrack'
            }));
        } else {
            tasks.push(Promise.resolve(null));
        }

        if (mainPrompt) {
            tasks.push(runTrackLLM({
                tools,
                settings,
                modelDef,
                reasoningConfig,
                systemPrompt: mainPrompt,
                assistantPrimer: MAIN_SILENT_PLANNING_WORKFLOW,
                scriptLines,
                msg: 'Cinematographer-MainTrack'
            }));
        } else {
            tasks.push(Promise.resolve(null));
        }

        const [cameraRaw, mainRaw] = await Promise.all(tasks);
        const cameraFiltered = filterTrackByAllowedCategories(
            filterDirectorTrackBySettings(cameraRaw, settings),
            ['camera', 'composition']
        );
        const mainFiltered = filterTrackByAllowedCategories(
            filterDirectorTrackBySettings(mainRaw, settings),
            ['animation', 'ost', 'cast', 'emote', 'title', 'vfx', 'sfx']
        );

        if (!cameraFiltered && !mainFiltered) return null;
        if (!cameraFiltered) return mainFiltered;
        if (!mainFiltered) return cameraFiltered;
        return mergeDirectorTracks(cameraFiltered, mainFiltered);
    } catch (error) {
        tools.logger.error('Cinematographer', 'Failed to run cinematographer:', error);
        return null;
    }
}

function applyDirectorTrack(turnContext, tools, data) {
    if (!data || !data.script) return;

    const sequence = turnContext.output.sequence;
    const scriptEntries = Array.isArray(data.script) ? data.script : Object.values(data.script);
    const titleAuthority = turnContext?.runtime?.vnCinematographer?.titleAuthority || {};

    replaceTitleContributions(turnContext, tools, {
        source: LLM_TITLE_SOURCE,
        contributions: []
    });

    scriptEntries.forEach(entry => {
        const lineIdx = entry.line;
        if (lineIdx === undefined || lineIdx < 0 || lineIdx >= sequence.length) return;

        const scene = sequence[lineIdx];
        if (!scene.clientEvents) scene.clientEvents = [];

        const commands = Array.isArray(entry.commands) ? entry.commands : Object.values(entry.commands);

        commands.forEach(cmd => {
            if (typeof cmd !== 'string') return;

            let normalizedCommand = cmd;
            if (normalizedCommand.startsWith('title:')) {
                const titleParts = parseTitleCommandParts(normalizedCommand);
                if (!titleParts) return;
                if (titleAuthority.location && titleParts.preset === 'locationchange') return;
                if (titleAuthority.time && EXACT_TIME_PATTERN.test(titleParts.text) && !titleParts.subtext) return;
                if (titleAuthority.time && EXACT_TIME_PATTERN.test(titleParts.subtext)) {
                    const separator = normalizedCommand.includes('|') ? '|' : ':';
                    normalizedCommand = `title:${titleParts.preset}${separator}${titleParts.text}${separator}`;
                }
                normalizedCommand = convertTitleCommand(normalizedCommand, turnContext, tools);
            }

            const event = parseCommandToUCP(normalizedCommand);
            if (!event) return;

            if (event.type === 'vn:title-popout') {
                const originalParts = parseTitleCommandParts(cmd);
                upsertTitleAtLine(turnContext, {
                    line: lineIdx,
                    kind: 'creative',
                    source: LLM_TITLE_SOURCE,
                    preset: originalParts?.preset || null,
                    config: event.payload
                });
                return;
            }

            if (event.type === 'sfx:play' || event.type === 'sfx:stop') {
                const extraSounds = tools.pluginState.forPlugin('vn_sfx').fromContext(turnContext).turn().extraSounds || [];
                const customSound = extraSounds.find(s => s.file === event.payload.file);
                if (customSound && customSound.servePath) {
                    event.payload.srcOverride = customSound.servePath;
                }
            }

            scene.clientEvents.push(event);

            const settings = tools.settings.getSelf();
            if (settings.auto_wobble_on_zoom) {
                if (event.type === 'cam:auto_zoom') {
                    scene.clientEvents.push({ type: 'vfx:state', payload: { id: 'wobble' } });
                } else if (event.type === 'cam:wide') {
                    scene.clientEvents.push({ type: 'vfx:clear', payload: { id: 'wobble' } });
                }
            }
        });
    });

    tools.logger.log('Cinematographer', `Applied director track with ${scriptEntries.length} trigger points.`);
}

module.exports.__test = {
    commandCategoryFor,
    filterDirectorTrackBySettings,
    filterTrackByAllowedCategories,
    mergeDirectorTracks,
    buildScriptLinesForPrompt,
    collectBackgroundChanges,
    getInitialBackgroundHint,
    enabledPromptSections,
    buildTitleSection,
    getAvailableTitlePresets,
    getTitleAuthority,
    buildGroundedAmbientVfxSection,
    buildTrackMessages
};

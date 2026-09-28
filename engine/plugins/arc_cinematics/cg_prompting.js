const { renderPromptTemplate } = require('./prompt_templates.js');

const DEFAULT_CG_PROMPT_MODE = 'diffusion_positive';
const CG_PROMPT_MODES = new Set([
    'diffusion_positive',
    'llm_instruction',
    'llm_instruction_with_references'
]);

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isGenericCharacterName(name) {
    const text = String(name || '').trim().toLowerCase();
    return !text || text === 'narrator' || text === 'system' || /\bgeneric\b/.test(text) || /\bnpc\b/.test(text);
}

function dedupeStrings(values = []) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const text = String(value || '').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out;
}

function normalizeCgPromptMode(value) {
    const text = String(value || '').trim();
    return CG_PROMPT_MODES.has(text) ? text : DEFAULT_CG_PROMPT_MODE;
}

function normalizeStringArray(values = [], maxItems = 8) {
    return dedupeStrings((Array.isArray(values) ? values : String(values || '').split(/[,;\n]/))
        .map(value => String(value || '').trim())
        .filter(value => value && !isGenericCharacterName(value)))
        .slice(0, maxItems);
}

function normalizeEnvironmentVibes(raw = {}, fallbackAtmosphere = '') {
    if (typeof raw === 'string') {
        const text = raw.trim();
        return text ? { atmosphere: text } : (fallbackAtmosphere ? { atmosphere: fallbackAtmosphere } : {});
    }

    const source = isPlainObject(raw) ? raw : {};
    const visualMotifs = normalizeStringArray(
        source.visualMotifs || source.visual_motifs || source.motifs || [],
        8
    );
    const environment = {
        locationType: String(source.locationType || source.location_type || '').trim(),
        atmosphere: String(source.atmosphere || fallbackAtmosphere || '').trim(),
        timeOfDay: String(source.timeOfDay || source.time_of_day || '').trim(),
        weather: String(source.weather || '').trim(),
        palette: String(source.palette || '').trim(),
        visualMotifs
    };

    for (const key of Object.keys(environment)) {
        if (Array.isArray(environment[key])) {
            if (environment[key].length === 0) delete environment[key];
        } else if (!environment[key]) {
            delete environment[key];
        }
    }
    return environment;
}

function environmentVibesToText(environmentVibes = {}) {
    if (!isPlainObject(environmentVibes)) return '';
    const lines = [
        environmentVibes.locationType ? `Location type: ${environmentVibes.locationType}` : '',
        environmentVibes.atmosphere ? `Atmosphere: ${environmentVibes.atmosphere}` : '',
        environmentVibes.timeOfDay ? `Time of day: ${environmentVibes.timeOfDay}` : '',
        environmentVibes.weather ? `Weather: ${environmentVibes.weather}` : '',
        environmentVibes.palette ? `Palette: ${environmentVibes.palette}` : '',
        Array.isArray(environmentVibes.visualMotifs) && environmentVibes.visualMotifs.length
            ? `Visual motifs: ${environmentVibes.visualMotifs.join(', ')}`
            : ''
    ].filter(Boolean);
    return lines.join('\n');
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripCharacterNames(text, characterNames = []) {
    let out = String(text || '');
    for (const name of normalizeStringArray(characterNames, 12)) {
        const escaped = escapeRegex(name);
        if (!escaped) continue;
        out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
    }
    return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

function compactPrompt(text, maxChars = 1800) {
    const compacted = String(text || '')
        .replace(/\r?\n+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    if (compacted.length <= maxChars) return compacted;
    return compacted.slice(0, Math.max(0, maxChars - 1)).trimEnd();
}

function getStanzaRelevantCharacters(stanza = {}, manifest = {}) {
    const fromStanza = [
        ...(Array.isArray(stanza.relevantCharacters) ? stanza.relevantCharacters : []),
        ...(Array.isArray(stanza.characters) ? stanza.characters : [])
    ];
    const fromSprites = (Array.isArray(manifest.assets?.sprites) ? manifest.assets.sprites : [])
        .map(sprite => sprite?.name)
        .filter(Boolean);
    return normalizeStringArray([...fromStanza, ...fromSprites], 6);
}

function buildStanzaVisualPlanText(stanza = {}, manifest = {}) {
    const stanzaText = Array.isArray(stanza.lines) ? stanza.lines.join('\n') : '';
    const environmentText = environmentVibesToText(stanza.environmentVibes);
    const relevantCharacters = getStanzaRelevantCharacters(stanza, manifest);
    return [
        stanzaText ? `Poem stanza:\n${stanzaText}` : '',
        stanza.mood ? `Stanza mood: ${stanza.mood}` : '',
        manifest.request?.mood ? `Requested mood: ${manifest.request.mood}` : '',
        manifest.request?.styleHint ? `Style hint: ${manifest.request.styleHint}` : '',
        environmentText ? `Environment vibes:\n${environmentText}` : '',
        relevantCharacters.length ? `Relevant characters: ${relevantCharacters.join(', ')}` : ''
    ].filter(Boolean).join('\n\n');
}

function buildDiffusionPromptFallback(stanza = {}, manifest = {}) {
    const characterNames = getStanzaRelevantCharacters(stanza, manifest);
    const environment = stanza.environmentVibes || {};
    const motifs = Array.isArray(environment.visualMotifs) ? environment.visualMotifs : [];
    const parts = [
        'anime visual novel background',
        'widescreen opening cinematic',
        'painterly 2D game environment',
        environment.locationType || '',
        environment.atmosphere || stanza.mood || manifest.request?.mood || '',
        environment.timeOfDay || '',
        environment.weather || '',
        environment.palette || manifest.request?.styleHint || '',
        ...motifs,
        'empty environment',
        'unoccupied scene',
        'environmental storytelling',
        'atmospheric lighting',
        'layered depth',
        'clean composition with open space for poem text',
        'text-free',
        'interface-free'
    ]
        .map(part => stripCharacterNames(part, characterNames))
        .map(part => part.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    const seen = new Set();
    const uniqueParts = [];
    for (const part of parts) {
        const key = part.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueParts.push(part);
    }
    return compactPrompt(uniqueParts.join(', '), 900);
}

async function compileDiffusionPositivePrompt({ tools, manifest, stanza, settings, pluginId, describeError }) {
    const fallbackPrompt = buildDiffusionPromptFallback(stanza, manifest);
    if (!tools?.llm?.withSchema) return { prompt: fallbackPrompt, source: 'fallback' };

    const characterNames = getStanzaRelevantCharacters(stanza, manifest);
    const schema = {
        type: 'object',
        required: ['prompt'],
        properties: {
            prompt: { type: 'string' }
        }
    };
    const instruction = renderPromptTemplate('cg_diffusion_compiler.txt', {
        visualPlan: buildStanzaVisualPlanText(stanza, manifest),
        characterNamesToOmit: characterNames.length ? `\nCharacter names to omit: ${characterNames.join(', ')}` : ''
    });

    const modelDef = settings.model_def || {};
    try {
        const response = await tools.llm.withSchema({
            msg: 'Arc Cinematic CG Prompt Compiler',
            requestId: 'cg_prompt_compilation',
            prompt: instruction,
            model: modelDef.model || 'mediumendmodel',
            params: {
                callingModule: `Plugin:${pluginId}:cg_prompt_compiler`
            }
        }, schema);
        const compiled = stripCharacterNames(response?.content?.prompt || response?.prompt || '', characterNames);
        const prompt = compactPrompt(compiled, 900);
        return { prompt: prompt || fallbackPrompt, source: prompt ? 'llm_compiler' : 'fallback' };
    } catch (error) {
        tools?.logger?.warn?.('ArcCinematics', `CG prompt compiler failed; using fallback diffusion prompt. ${describeError(error)}`);
        return { prompt: fallbackPrompt, source: 'fallback' };
    }
}

function buildLlmInstructionCgPrompt(stanza = {}, manifest = {}, options = {}) {
    const withReferences = options.withReferences === true;
    const relevantCharacters = getStanzaRelevantCharacters(stanza, manifest);
    const referenceNames = normalizeStringArray(options.referenceNames || [], 6);
    let characterHandling = 'Do not attempt specific character portraits without references; express the emotional beat through the environment and symbolic details.';
    if (withReferences && referenceNames.length) {
        characterHandling = `Referenced characters available: ${referenceNames.join(', ')}. Use attached references for identity/style if characters appear.`;
    } else if (withReferences && relevantCharacters.length) {
        characterHandling = `Relevant characters: ${relevantCharacters.join(', ')}, but no usable reference images were attached. Avoid specific portraits and express them symbolically through the environment.`;
    }

    const requestContext = [
        manifest.request?.title ? `Title seed: ${manifest.request.title}` : '',
        manifest.request?.reason ? `Why this intro is playing: ${manifest.request.reason}` : '',
        manifest.request?.mood ? `Requested mood: ${manifest.request.mood}` : '',
        manifest.request?.styleHint ? `Style hint: ${manifest.request.styleHint}` : ''
    ].filter(Boolean).join('\n');

    return compactPrompt(renderPromptTemplate('cg_llm_instruction.txt', {
        requestContext,
        stanzaText: Array.isArray(stanza.lines) ? stanza.lines.join('\n') : '',
        environmentDirection: environmentVibesToText(stanza.environmentVibes) || 'Use the current story environment as inspiration.',
        characterHandling,
        referenceGuidance: withReferences
            ? 'If including characters, keep the environment dominant and use the references to avoid malformed or unrelated designs.'
            : 'Prefer a background, landscape, room, symbolic object composition, or environmental mood piece over character art.'
    }), 2200);
}

async function collectStanzaReferenceImages({ tools, stanza = {}, manifest = {}, normalizeProjectAssetPath, isGenericSpritePath }) {
    const names = getStanzaRelevantCharacters(stanza, manifest);
    const references = [];
    const usedPaths = new Set();

    for (const name of names) {
        let spritePath = '';
        try {
            const result = await tools?.assets?.findCharacterSprite?.(name, 'neutral', { source: 'auto' });
            spritePath = result?.image || result?.assetPath || '';
        } catch (_) {
            spritePath = '';
        }
        if (!spritePath) {
            const existing = (Array.isArray(manifest.assets?.sprites) ? manifest.assets.sprites : [])
                .find(sprite => String(sprite?.name || '').toLowerCase() === String(name || '').toLowerCase());
            spritePath = existing?.path || '';
        }

        const normalized = normalizeProjectAssetPath(spritePath, 'sprite');
        if (!normalized || isGenericSpritePath(normalized) || usedPaths.has(normalized)) continue;
        usedPaths.add(normalized);
        references.push({
            name,
            path: normalized
        });
        if (references.length >= 4) break;
    }

    return references;
}

async function buildCgRequestForStanza({
    tools,
    manifest,
    stanza,
    settings,
    outputPath,
    normalizeProjectAssetPath,
    isGenericSpritePath,
    pluginId,
    describeError
}) {
    const promptMode = normalizeCgPromptMode(manifest.request?.cgPromptMode || manifest.cg?.promptMode || settings.cg_prompt_mode);
    let promptSource = 'direct';
    let prompt = '';
    let references = [];

    if (promptMode === 'diffusion_positive') {
        const compiled = await compileDiffusionPositivePrompt({ tools, manifest, stanza, settings, pluginId, describeError });
        prompt = compiled.prompt;
        promptSource = compiled.source;
    } else {
        if (promptMode === 'llm_instruction_with_references') {
            references = await collectStanzaReferenceImages({
                tools,
                stanza,
                manifest,
                normalizeProjectAssetPath,
                isGenericSpritePath
            });
        }
        prompt = buildLlmInstructionCgPrompt(stanza, manifest, {
            withReferences: promptMode === 'llm_instruction_with_references',
            referenceNames: references.map(ref => ref.name).filter(Boolean)
        });
    }

    const request = {
        prompt,
        modelTier: settings.cg_model_tier,
        outputPath
    };
    if (references.length > 0) request.references = references;

    return {
        request,
        promptMode,
        promptSource,
        references,
        prompt
    };
}

module.exports = {
    DEFAULT_CG_PROMPT_MODE,
    CG_PROMPT_MODES,
    normalizeCgPromptMode,
    normalizeStringArray,
    normalizeEnvironmentVibes,
    environmentVibesToText,
    buildDiffusionPromptFallback,
    compileDiffusionPositivePrompt,
    buildLlmInstructionCgPrompt,
    collectStanzaReferenceImages,
    buildCgRequestForStanza
};

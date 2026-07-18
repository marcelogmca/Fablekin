const { renderPromptTemplate } = require('./prompt_templates.js');

const RESTRAINED_INTRO_VFX = Object.freeze([
    'fog',
    'clouds',
    'desert-dust',
    'snow',
    'embers',
    'magic-dust',
    'leaves',
    'godray',
    'vignette',
    'bloom'
]);

const PRIMARY_INTRO_VFX = Object.freeze([
    'intro-raymarch-fractal',
    'intro-octagrams',
    'intro-fractal-pyramid',
    'intro-shader-art',
    'intro-protean-clouds',
    'intro-star-nest',
    'intro-monster',
    'intro-tunnel-runner',
    'intro-palace-of-mind',
    'intro-blue-002',
    'intro-ether',
    'intro-zippy-zaps',
    'intro-biomine',
    'intro-bal-khan-tunnel',
    'intro-warp-speed',
    'intro-gilded-kaleidoscope',
    'intro-topologica',
    'intro-transparent-cube-field'
]);

const FALLBACK_INTRO_VFX = Object.freeze([...PRIMARY_INTRO_VFX, ...RESTRAINED_INTRO_VFX]);

function normalizeVfxId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeIntroVfxIds(ids) {
    const out = [];
    const seen = new Set(['none']);
    for (const value of Array.isArray(ids) ? ids : []) {
        const id = normalizeVfxId(value);
        if (!id || id === 'none' || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return ['none', ...out];
}

function normalizeEmotionKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'neutral';
}

function emotionHasDisplayableSprite(emotionData = {}) {
    return emotionData.F === true
        || emotionData.R === true
        || emotionData.L === true
        || emotionData.B === true
        || emotionData.T === true
        || emotionData.B_layer === true
        || emotionData.TB === true;
}

async function collectAvailableSpriteEmotions(tools) {
    const emotions = new Set(['neutral']);
    let catalog = null;
    try {
        catalog = await tools?.assets?.getSpriteCatalog?.({ source: 'auto' });
    } catch (_) {
        catalog = null;
    }

    for (const character of Object.values(catalog?.characters || {})) {
        for (const variant of Object.values(character?.variantData || {})) {
            const emotionData = variant?.emotionData || {};
            for (const [emotion, flags] of Object.entries(emotionData)) {
                if (!emotionHasDisplayableSprite(flags)) continue;
                emotions.add(normalizeEmotionKey(emotion));
            }
        }
    }

    return Array.from(emotions).sort((left, right) => {
        if (left === 'neutral') return -1;
        if (right === 'neutral') return 1;
        return left.localeCompare(right);
    });
}

async function collectAvailableIntroVfx(tools, settings = {}) {
    if (settings.enable_shaders === false || settings.enable_vfx === false) {
        return {
            enabled: false,
            ids: ['none'],
            prompt: 'Arc intro VFX are disabled in the arc_cinematics settings.'
        };
    }

    const installed = tools?.plugins?.isInstalled?.('vn_pixijs_vfx') === true
        || !!tools?.plugins?.get?.('vn_pixijs_vfx');
    if (!installed) {
        return {
            enabled: false,
            ids: ['none'],
            prompt: 'VN PixiJS VFX is not installed or active; choose none for every stanza.'
        };
    }

    let pluginPrompt = '';
    let pluginIds = [];
    try {
        const plugin = tools?.plugins?.get?.('vn_pixijs_vfx');
        if (plugin?.exports?.getVfxPromptForBucket) {
            pluginPrompt = await plugin.exports.getVfxPromptForBucket('intro');
        } else if (plugin?.exports?.getIntroVfxPrompt) {
            pluginPrompt = await plugin.exports.getIntroVfxPrompt();
        } else if (plugin?.exports?.getVfxPrompt) {
            pluginPrompt = await plugin.exports.getVfxPrompt(null, tools);
        } else if (tools?.plugins?.tryCall) {
            pluginPrompt = await tools.plugins.tryCall('vn_pixijs_vfx', 'getVfxPromptForBucket', ['intro'], { fallback: '' });
            if (!pluginPrompt) {
                pluginPrompt = await tools.plugins.tryCall('vn_pixijs_vfx', 'getVfxPrompt', [], { fallback: '' });
            }
        }

        if (plugin?.exports?.getVfxEffectIds) {
            pluginIds = await plugin.exports.getVfxEffectIds('intro');
        } else if (tools?.plugins?.tryCall) {
            const calledIds = await tools.plugins.tryCall('vn_pixijs_vfx', 'getVfxEffectIds', ['intro'], { fallback: [] });
            pluginIds = Array.isArray(calledIds) ? calledIds : [];
        }
    } catch (_) {
        pluginPrompt = '';
        pluginIds = [];
    }

    const sourceIds = normalizeIntroVfxIds(pluginIds.length > 0 ? pluginIds : FALLBACK_INTRO_VFX);
    const primaryIds = sourceIds.filter(id => id.startsWith('intro-'));
    const sourceSet = new Set(sourceIds);
    const legacyIds = RESTRAINED_INTRO_VFX.filter(id => sourceSet.has(id));
    const availableIds = normalizeIntroVfxIds(legacyIds);

    return {
        enabled: true,
        ids: availableIds,
        primaryIds,
        prompt: [
            'VN PixiJS VFX is installed. Arc Cinematics may automatically assign intro-only global VFX per stanza when that pool has effects.',
            primaryIds.length > 0 ? `Automatic global stanza VFX pool, not for vfxBeat: ${primaryIds.join(', ')}.` : 'No intro-only global stanza VFX are currently available.',
            legacyIds.length > 0 ? `Optional additional atmospheric vfxBeat ids: ${availableIds.join(', ')}.` : 'No optional atmospheric vfxBeat ids are available.',
            'For vfxBeat, choose only from the optional atmospheric ids below, and choose none often.',
            'Do not put intro-* effects in vfxBeat; intro-only effects are applied globally by the arc cinematic player.',
            'Do not choose rain/clouds for indoor, underground, cave, or enclosed scenes.',
            pluginPrompt ? `Reference from the VFX plugin intro bucket:\n${pluginPrompt}` : ''
        ].filter(Boolean).join('\n')
    };
}

async function buildPoemMessages({
    manifest,
    sourceTurns,
    settings,
    turnContext,
    tools,
    buildSourceDigest,
    buildRangeContextLabel,
    getStorySoFarForPoem
}) {
    const request = manifest.request || {};
    const sourceDigest = manifest.sourceDigest || buildSourceDigest(sourceTurns);
    const lineCount = settings.poem_line_count;
    const stanzaCount = Math.max(1, Math.ceil(lineCount / 4));
    const storySoFar = await getStorySoFarForPoem(turnContext, tools, manifest);
    const availableSpriteEmotions = Array.isArray(settings.available_sprite_emotions)
        ? settings.available_sprite_emotions
        : await collectAvailableSpriteEmotions(tools);
    const introVfx = settings.intro_vfx
        || await collectAvailableIntroVfx(tools, settings);
    const requestHints = [
        request.title ? `Title seed: ${request.title}` : '',
        request.reason ? `Trigger: ${request.reason}` : '',
        request.mood ? `Mood: ${request.mood}` : '',
        request.styleHint ? `Style: ${request.styleHint}` : ''
    ].filter(Boolean).join('\n') || 'No special title, mood, or style seed was provided.';

    const storyMessage = renderPromptTemplate('poem_story_context.txt', {
        storySource: storySoFar.source,
        storyText: storySoFar.text,
        rangeLabel: typeof buildRangeContextLabel === 'function' ? buildRangeContextLabel(manifest) : '',
        sourceDigest: sourceDigest || 'No focused recap is available. Treat this as a graceful opening for the current story moment.'
    });

    const instructionMessage = renderPromptTemplate('poem_instructions.txt', {
        requestHints,
        lineCount,
        stanzaCount,
        availableSpriteEmotions: availableSpriteEmotions.join(', '),
        nonNeutralSpriteEmotions: availableSpriteEmotions.filter(emotion => emotion !== 'neutral').join(', ') || 'none',
        vfxAvailability: introVfx.prompt || 'Arc intro VFX are unavailable; choose none for every stanza.',
        availableIntroVfxIds: Array.isArray(introVfx.ids) ? introVfx.ids.join(', ') : 'none'
    });

    return [
        { role: 'user', content: storyMessage },
        { role: 'user', content: instructionMessage }
    ];
}

module.exports = {
    RESTRAINED_INTRO_VFX,
    PRIMARY_INTRO_VFX,
    FALLBACK_INTRO_VFX,
    collectAvailableSpriteEmotions,
    collectAvailableIntroVfx,
    buildPoemMessages
};

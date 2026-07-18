const VFX_EFFECT_BUCKETS = Object.freeze({
    vn: Object.freeze({
        label: 'VN Cinematographer',
        rules: Object.freeze([
            'THE AMBIENT RULE: Environmental VFX are part of scene continuity. Use grounded ambient effects more readily when weather, location, background, or narration supports them.',
            'THE IMPACT RESTRAINT RULE: VFX like "shake", "shockwave", "glitch", "blood", or heavy "bloom" are jarring. Save them for physical impacts, profound magical events, or massive emotional damage.',
            'THE CONTINUITY RULE: Pay attention to the location. If it is "Underground", do not use "rain" or "clouds". Do not invent weather or hazards just to use an effect.'
        ]),
        categories: Object.freeze({
            ENVIRONMENTAL: Object.freeze(['rain', 'snow', 'fog', 'clouds', 'desert-dust', 'embers', 'thunder']),
            OVERLAYS: Object.freeze(['magic-dust', 'leaves', 'vignette', 'bloom', 'crt', 'ascii', 'cross-hatch', 'godray', 'grayscale', 'motion-blur', 'old-film', 'pixelate', 'glitch', 'blood', 'fadetoblack']),
            DYNAMIC: Object.freeze(['shake', 'shockwave'])
        })
    }),
    intro: Object.freeze({
        label: 'Intro Cinematics',
        rules: Object.freeze([
            'INTRO-ONLY RULE: These effects are reserved for authored intros, openings, recaps, and other non-dialogue cinematic sequences.',
            'Do not expose intro-only effects to automatic VN scene cinematography prompts.',
            'The STANZA_GLOBAL category is reserved for future whole-stanza intro looks. Empty is valid when no intro-only effects are installed.'
        ]),
        categories: Object.freeze({
            STANZA_GLOBAL: Object.freeze(['intro-raymarch-fractal', 'intro-octagrams', 'intro-fractal-pyramid', 'intro-shader-art', 'intro-protean-clouds', 'intro-star-nest', 'intro-monster', 'intro-tunnel-runner', 'intro-palace-of-mind', 'intro-blue-002', 'intro-ether', 'intro-zippy-zaps', 'intro-biomine', 'intro-bal-khan-tunnel', 'intro-warp-speed', 'intro-gilded-kaleidoscope', 'intro-topologica', 'intro-transparent-cube-field']),
            OPTIONAL_ATMOSPHERIC: Object.freeze(['fog', 'clouds', 'desert-dust', 'snow', 'embers', 'magic-dust', 'leaves', 'godray', 'vignette', 'bloom'])
        })
    })
});

const DEFAULT_VFX_PROMPT_BUCKET = 'vn';

const VFX_BUCKET_ALIASES = Object.freeze({
    default: DEFAULT_VFX_PROMPT_BUCKET,
    cinematographer: 'vn',
    scene: 'vn',
    vn: 'vn',
    arc_intro: 'intro',
    intro: 'intro',
    opening: 'intro'
});

function normalizeBucketName(bucket) {
    const key = String(bucket || DEFAULT_VFX_PROMPT_BUCKET).trim().toLowerCase();
    return VFX_BUCKET_ALIASES[key] || DEFAULT_VFX_PROMPT_BUCKET;
}

function getBucketCatalog(bucket = DEFAULT_VFX_PROMPT_BUCKET) {
    return VFX_EFFECT_BUCKETS[normalizeBucketName(bucket)] || VFX_EFFECT_BUCKETS[DEFAULT_VFX_PROMPT_BUCKET];
}

function getBucketEffectIds(bucket = DEFAULT_VFX_PROMPT_BUCKET) {
    const catalog = getBucketCatalog(bucket);
    return Object.values(catalog.categories).flat();
}

function formatQuotedIds(ids) {
    return ids.map(id => `"${id}"`).join(', ');
}

function formatVfxPrompt(bucket = DEFAULT_VFX_PROMPT_BUCKET) {
    const catalog = getBucketCatalog(bucket);
    const categories = Object.entries(catalog.categories)
        .filter(([, ids]) => ids.length > 0)
        .map(([label, ids]) => `${label}: ${formatQuotedIds(ids)}`);

    const availableSection = categories.length > 0
        ? categories.join('\n')
        : 'No effects are registered in this bucket yet.';

    return `
=== VISUAL EFFECTS (VFX) RULES: ${catalog.label.toUpperCase()} BUCKET ===
${catalog.rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

=== VFX COMMAND GRAMMAR ===
- "vfx:start:[id]" (Enable persistent effect)
- "vfx:clear:[id]" (Disable persistent effect)
- "vfx:trigger:[id]" (One-off impact e.g. shockwave)

AMBIENT VS IMPACT:
- Ambient effects such as "rain", "snow", "fog", "clouds", "desert-dust", "embers", "leaves", "magic-dust", and "godray" may run across multiple lines when grounded by the scene.
- Impact effects such as "shake", "shockwave", "glitch", "blood", "motion-blur", "pixelate", and heavy "bloom" require a concrete on-screen event.
- Prefer starting grounded ambient VFX near the first relevant line, and clear persistent VFX when the environment no longer supports them.

=== AVAILABLE VFX ASSETS ===
${availableSection}
    `.trim();
}

module.exports = {
    DEFAULT_VFX_PROMPT_BUCKET,
    VFX_EFFECT_BUCKETS,
    formatVfxPrompt,
    getBucketCatalog,
    getBucketEffectIds,
    normalizeBucketName
};

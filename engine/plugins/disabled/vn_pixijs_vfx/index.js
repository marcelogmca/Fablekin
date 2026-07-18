const fs = require('fs/promises');
const path = require('path');
const {
    DEFAULT_VFX_PROMPT_BUCKET,
    VFX_EFFECT_BUCKETS,
    formatVfxPrompt,
    getBucketCatalog,
    getBucketEffectIds,
    normalizeBucketName
} = require('./vfx-catalog.js');

module.exports = {
    id: 'vn_pixijs_vfx',
    name: 'VN PixiJS VFX',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Visual',
    wizard: {
        include: true,
        order: 610,
        group: 'Visual',
        label: 'VN PixiJS VFX',
        recommended_enabled: true,
        author_note: 'Recommended for VN presentation unless you want the lightest possible frontend.',
        enabled_note: 'Adds rain, fog, shake, shockwave, and other triggerable visual effects to scenes.',
        disabled_note: 'VN scenes keep core sprites/backgrounds but lose cinematic environmental effects.',
        settings_note: 'Tune forced effects, buckets, and shader behavior in plugin settings.'
    },
    description: 'Provides triggerable high-quality PixelJS v8 shaders for Clouds and Volumetric Fog.',
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Adds high-fidelity environmental effects and cinematic overlays. Shaders are optimized for PixiJS v8 and can be triggered dynamically via narrative cues.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'The system uses custom GLSL shaders (FBM Noise, Convolution, etc.) injected directly into the frontend renderer. It supports persistent effects (Rain, Snow, Fog) and one-off triggers (Shockwave, Thunder). THE RESTRAINT RULE: Shaders are powerful tools but should be used sparingly to maintain narrative impact—Writer agents are instructed to only invoke JARRED effects (like "shake" or "glitch") for high-stakes moments.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'None',
            immersion: 'High',
            cost: 'None',
            latency: 'None'
        },
        force_rain: {
            type: 'checkbox',
            label: 'Force Enable Rain',
            default: false,
            description: 'Forces the Procedural Rain VFX to render constantly for debug purposes.'
        },
        force_thunder: {
            type: 'checkbox',
            label: 'Force Enable Thunder',
            default: false,
            description: 'Forces the Thunder/Lightning VFX to render constantly for debug purposes.'
        },
        force_clouds: {
            type: 'checkbox',
            label: 'Force Enable Clouds',
            default: false,
            description: 'Cloud shader, simulates cloud shadows slowly passing across the screen.'
        },
        force_fog: {
            type: 'checkbox',
            label: 'Force Enable Fog',
            default: false,
            description: 'Fog shader, simulates volumetric fog.'
        },
        force_desert_dust: {
            type: 'checkbox',
            label: 'Force Enable Desert Dust',
            default: false,
            description: 'Desert dust shader, simulates a dusty wind.'
        },
        force_snow: {
            type: 'checkbox',
            label: 'Force Enable Snow',
            default: false,
            description: 'Snow shader, simulates softly falling snow.'
        },
        force_embers: {
            type: 'checkbox',
            label: 'Force Enable Embers',
            default: false,
            description: 'Embers/Ash shader, simulates upward drifting glowing particles.'
        },
        force_magic_dust: {
            type: 'checkbox',
            label: 'Force Enable Magic Dust',
            default: false,
            description: 'Magic dust shader, simulates twinkling floating particles.'
        },
        force_leaves: {
            type: 'checkbox',
            label: 'Force Enable Falling Leaves',
            default: false,
            description: 'Falling leaves shader, simulates fluttering leaves.'
        },
        force_shake: {
            type: 'checkbox',
            label: 'Force Enable Camera Shake',
            default: false,
            description: 'Continuously shakes the camera.'
        },
        force_wobble: {
            type: 'checkbox',
            label: 'Force Enable Camera Wobble',
            default: false,
            description: 'Continuously wobbles the camera.'
        },
        force_vignette: {
            type: 'checkbox',
            label: 'Force Enable Vignette',
            default: false,
            description: 'Applies a dark radial gradient vignette over the whole screen.'
        },
        force_bloom: {
            type: 'checkbox',
            label: 'Force Enable Bloom',
            default: false,
            description: 'Applies a bright convolution bloom over the whole screen.'
        },
        force_crt: {
            type: 'checkbox',
            label: 'Force Enable CRT',
            default: false,
            description: 'Applies a nostalgic CRT (Cathode Ray Tube) effect with scanlines and curvature.'
        },
        force_ascii: {
            type: 'checkbox',
            label: 'Force Enable Ascii',
            default: false,
            description: 'Applies a retro ASCII art effect to the screen.'
        },
        force_cross_hatch: {
            type: 'checkbox',
            label: 'Force Enable CrossHatch',
            default: false,
            description: 'Applies a retro cross-hatch sketching effect to the screen.'
        },
        force_godray: {
            type: 'checkbox',
            label: 'Force Enable Godray',
            default: false,
            description: 'Applies a radial light scattering effect (God Rays).'
        },
        force_grayscale: {
            type: 'checkbox',
            label: 'Force Enable Grayscale',
            default: false,
            description: 'Converts the screen to black and white.'
        },
        force_motion_blur: {
            type: 'checkbox',
            label: 'Force Enable Motion Blur',
            default: false,
            description: 'Applies a directional motion blur effect.'
        },
        force_old_film: {
            type: 'checkbox',
            label: 'Force Enable Old Film',
            default: false,
            description: 'Applies a retro film effect with grain, scratches, and sepia.'
        },
        force_pixelate: {
            type: 'checkbox',
            label: 'Force Enable Pixelate',
            default: false,
            description: 'Applies a blocky pixelation effect to the screen.'
        },
        force_shockwave: {
            type: 'checkbox',
            label: 'Force Enable Shockwave',
            default: false,
            description: 'Applies a continuous radial shockwave ripple from the center of the screen.'
        },
        force_blood: {
            type: 'checkbox',
            label: 'Force Enable Blood Splatters',
            default: false,
            description: 'Applies a faint red vignette and procedural blood splatters on the corners.'
        },
        force_glitch: {
            type: 'checkbox',
            label: 'Force Enable Glitch',
            default: false,
            description: 'Applies a cyberpunk glitch effect with digital noise and tearing.'
        },
        force_fade_to_black: {
            type: 'checkbox',
            label: 'Force Enable FadeToBlack',
            default: false,
            description: 'Applies a cinematic eyelid closing/opening transition (FadeToBlack).'
        }
    },

    exports: {
        /**
         * Returns a summarized, LLM-friendly string explaining the available effects 
         * and how to trigger them. Defaults to the VN-safe bucket used by the
         * cinematographer so intro-only effects never leak into automatic scene prompts.
         */
        'getVfxPrompt': async (_turnContext, _tools, options = {}) => {
            return formatVfxPrompt(options.bucket || DEFAULT_VFX_PROMPT_BUCKET);
        },

        /**
         * Explicit bucket-aware prompt export for non-VN systems like authored intros.
         */
        'getVfxPromptForBucket': async (bucket = DEFAULT_VFX_PROMPT_BUCKET) => {
            return formatVfxPrompt(bucket);
        },

        'getIntroVfxPrompt': async () => {
            return formatVfxPrompt('intro');
        },

        'getVfxCatalog': async (bucket = DEFAULT_VFX_PROMPT_BUCKET) => {
            return getBucketCatalog(bucket);
        },

        'getVfxEffectIds': async (bucket = DEFAULT_VFX_PROMPT_BUCKET) => {
            return getBucketEffectIds(bucket);
        },

        'normalizeVfxBucket': async (bucket = DEFAULT_VFX_PROMPT_BUCKET) => {
            return normalizeBucketName(bucket);
        },

        'VFX_EFFECT_BUCKETS': VFX_EFFECT_BUCKETS

    },

    hooks: {
        'HOOK_FRONTEND_INJECTION': {
            priority: 10,
            run: async (context, tools) => {
                try {
                    const pluginSettings = tools.settings.getSelf();

                    // Read module files in dependency order
                    const moduleFiles = [
                        'vfx-constants.js',
                        'vfx-helpers.js',
                        'vfx-containers.js',
                        'vfx-particles.js',
                        'vfx-filters.js',
                        'vfx-tick.js',
                        'vfx-events.js',
                        'vfx-intro.js',
                        'ui.js',
                    ];
                    const moduleSource = (
                        await Promise.all(
                            moduleFiles.map(f => fs.readFile(path.join(__dirname, f), 'utf8'))
                        )
                    ).join('\n\n');

                    // Read shaders
                    const readShader = f => fs.readFile(path.join(__dirname, 'shaders', f), 'utf8');
                    const [vertSource, cloudGlsl, fogGlsl, rainGlsl, desertDustGlsl,
                        snowGlsl, embersGlsl, bloomGlsl, bloodGlsl, fadeToBlackGlsl,
                        introRaymarchFractalGlsl, introOctagramsGlsl, introFractalPyramidGlsl,
                        introShaderArtGlsl, introProteanCloudsGlsl, introStarNestGlsl,
                        introMonsterGlsl, introTunnelRunnerGlsl, introPalaceOfMindGlsl,
                        introBlue002Glsl, introEtherGlsl, introZippyZapsGlsl,
                        introBiomineGlsl, introBalKhanTunnelGlsl,
                        introWarpSpeedGlsl, introGildedKaleidoscopeGlsl,
                        introTopologicaGlsl, introTransparentCubeFieldGlsl] = await Promise.all([
                            readShader('default.vert'),
                            readShader('fbm_clouds.glsl'),
                            readShader('fbm_fog.glsl'),
                            readShader('rain.glsl'),
                            readShader('desert_dust.glsl'),
                            readShader('snow.glsl'),
                            readShader('embers.glsl'),
                            readShader('bloom.glsl'),
                            readShader('blood.glsl'),
                            readShader('fadetoblack.glsl'),
                            readShader(path.join('intros', 'raymarch_fractal.glsl')),
                            readShader(path.join('intros', 'octagrams.glsl')),
                            readShader(path.join('intros', 'fractal_pyramid.glsl')),
                            readShader(path.join('intros', 'shader_art.glsl')),
                            readShader(path.join('intros', 'protean_clouds.glsl')),
                            readShader(path.join('intros', 'star_nest.glsl')),
                            readShader(path.join('intros', 'monster.glsl')),
                            readShader(path.join('intros', 'tunnel_runner.glsl')),
                            readShader(path.join('intros', 'palace_of_mind.glsl')),
                            readShader(path.join('intros', 'blue_002.glsl')),
                            readShader(path.join('intros', 'ether.glsl')),
                            readShader(path.join('intros', 'zippy_zaps.glsl')),
                            readShader(path.join('intros', 'biomine.glsl')),
                            readShader(path.join('intros', 'bal_khan_tunnel.glsl')),
                            readShader(path.join('intros', 'warp_speed.glsl')),
                            readShader(path.join('intros', 'gilded_kaleidoscope.glsl')),
                            readShader(path.join('intros', 'topologica.glsl')),
                            readShader(path.join('intros', 'transparent_cube_field.glsl')),
                        ]);

                    const escape = s => s.replace(/`/g, '\\`');
                    const injectionHeader = `
                    const VFX_SETTINGS = ${JSON.stringify(pluginSettings)};
                    const SHADER_VERT         = \`${escape(vertSource)}\`;
                    const SHADER_FBM_CLOUDS   = \`${escape(cloudGlsl)}\`;
                    const SHADER_FBM_FOG      = \`${escape(fogGlsl)}\`;
                    const SHADER_RAIN         = \`${escape(rainGlsl)}\`;
                    const SHADER_DESERT_DUST  = \`${escape(desertDustGlsl)}\`;
                    const SHADER_SNOW         = \`${escape(snowGlsl)}\`;
                    const SHADER_EMBERS       = \`${escape(embersGlsl)}\`;
                    const SHADER_BLOOM        = \`${escape(bloomGlsl)}\`;
                    const SHADER_BLOOD        = \`${escape(bloodGlsl)}\`;
                    const SHADER_FADETOBLACK  = \`${escape(fadeToBlackGlsl)}\`;
                    const SHADER_INTRO_RAYMARCH_FRACTAL = \`${escape(introRaymarchFractalGlsl)}\`;
                    const SHADER_INTRO_OCTAGRAMS = \`${escape(introOctagramsGlsl)}\`;
                    const SHADER_INTRO_FRACTAL_PYRAMID = \`${escape(introFractalPyramidGlsl)}\`;
                    const SHADER_INTRO_SHADER_ART = \`${escape(introShaderArtGlsl)}\`;
                    const SHADER_INTRO_PROTEAN_CLOUDS = \`${escape(introProteanCloudsGlsl)}\`;
                    const SHADER_INTRO_STAR_NEST = \`${escape(introStarNestGlsl)}\`;
                    const SHADER_INTRO_MONSTER = \`${escape(introMonsterGlsl)}\`;
                    const SHADER_INTRO_TUNNEL_RUNNER = \`${escape(introTunnelRunnerGlsl)}\`;
                    const SHADER_INTRO_PALACE_OF_MIND = \`${escape(introPalaceOfMindGlsl)}\`;
                    const SHADER_INTRO_BLUE_002 = \`${escape(introBlue002Glsl)}\`;
                    const SHADER_INTRO_ETHER = \`${escape(introEtherGlsl)}\`;
                    const SHADER_INTRO_ZIPPY_ZAPS = \`${escape(introZippyZapsGlsl)}\`;
                    const SHADER_INTRO_BIOMINE = \`${escape(introBiomineGlsl)}\`;
                    const SHADER_INTRO_BAL_KHAN_TUNNEL = \`${escape(introBalKhanTunnelGlsl)}\`;
                    const SHADER_INTRO_WARP_SPEED = \`${escape(introWarpSpeedGlsl)}\`;
                    const SHADER_INTRO_GILDED_KALEIDOSCOPE = \`${escape(introGildedKaleidoscopeGlsl)}\`;
                    const SHADER_INTRO_TOPOLOGICA = \`${escape(introTopologicaGlsl)}\`;
                    const SHADER_INTRO_TRANSPARENT_CUBE_FIELD = \`${escape(introTransparentCubeFieldGlsl)}\`;
                `;

                    return { id: 'vn_pixijs_vfx', js: injectionHeader + '\n\n' + moduleSource };
                } catch (error) {
                    tools.logger.error('Frontend', 'Failed to read vn_pixijs_vfx files:', error);
                    return null;
                }
            }
        }
    }
};

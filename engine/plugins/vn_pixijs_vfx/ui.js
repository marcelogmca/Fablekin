// ui.js
// Runs inside the renderer via inject-permanent-assets.
// context = { PIXI, pixiApp, pixiSpriteManager, state, socket, debugLog, debugError }
//
// This file is the orchestrator. It wires together all the focused sub-modules via
// the shared window.__VFX namespace.  Load order matters — inject these files first:
//
//   1. vfx-constants.js   (no deps)
//   2. vfx-helpers.js     (no deps)
//   3. vfx-containers.js  (needs: helpers)
//   4. vfx-particles.js   (no deps on other VFX modules)
//   5. vfx-filters.js     (needs: helpers)
//   6. vfx-tick.js        (no deps on other VFX modules)
//   7. vfx-events.js      (no deps on other VFX modules)
//   8. ui.js              (needs: all of the above)

(function (context) {
    const { PIXI, pixiApp, debugLog, debugError } = context;

    window.VN.pixiPlugins.register('vn_pixijs_vfx', (runtime) => {
        debugLog('[vn_pixijs_vfx] Script execution started (Modular FBM Version).');

        try {
            // ------------------------------------------------------------------ //
            // Config & settings
            // ------------------------------------------------------------------ //

            const {
                GAME_WIDTH, GAME_HEIGHT,
                NUM_MAGIC, NUM_LEAVES,
                TARGET_OPACITIES,
                EFFECT_SETTING_MAP,
            } = window.__VFX.constants;

            const settings = typeof VFX_SETTINGS !== 'undefined' ? VFX_SETTINGS : {}; // eslint-disable-line no-undef

            // Validate that all required shader globals were injected by the backend
            if (
                typeof SHADER_VERT === 'undefined' || // eslint-disable-line no-undef
                typeof SHADER_FBM_CLOUDS === 'undefined' || // eslint-disable-line no-undef
                typeof SHADER_FBM_FOG === 'undefined' || // eslint-disable-line no-undef
                typeof SHADER_RAIN === 'undefined' || // eslint-disable-line no-undef
                typeof SHADER_DESERT_DUST === 'undefined' || // eslint-disable-line no-undef
                typeof SHADER_SNOW === 'undefined' || // eslint-disable-line no-undef
                typeof SHADER_EMBERS === 'undefined' || // eslint-disable-line no-undef
                typeof SHADER_BLOOM === 'undefined' || // eslint-disable-line no-undef
                typeof SHADER_BLOOD === 'undefined' || // eslint-disable-line no-undef
                typeof SHADER_FADETOBLACK === 'undefined'    // eslint-disable-line no-undef
            ) {
                throw new Error('GLSL Shader constants were not injected by backend hook.');
            }

            if (!PIXI.Filter || !PIXI.GlProgram) {
                debugError('[vn_pixijs_vfx] Critical: PIXI.Filter API not found! Ensure client runs PixiJS v8.');
                return;
            }

            // ------------------------------------------------------------------ //
            // Mutable effect state
            // All runtime flags, opacities, and time counters live on this single
            // object so every module can read/write shared state by reference.
            // ------------------------------------------------------------------ //

            const state = {
                // Enable flags (seeded from VFX_SETTINGS force-flags)
                isCloudsEnabled: !!settings.force_clouds,
                isFogEnabled: !!settings.force_fog,
                isThunderEnabled: !!settings.force_thunder,
                isRainEnabled: !!settings.force_rain,
                isDesertDustEnabled: !!settings.force_desert_dust,
                isSnowEnabled: !!settings.force_snow,
                isEmbersEnabled: !!settings.force_embers,
                isMagicDustEnabled: !!settings.force_magic_dust,
                isLeavesEnabled: !!settings.force_leaves,
                isShakeEnabled: !!settings.force_shake,
                shakeIntensity: 0.0,
                isWobbleEnabled: !!settings.force_wobble,
                wobbleTime: 0.0,
                isVignetteEnabled: !!settings.force_vignette,
                currentOpacityVignette: 0.0,
                isBloomEnabled: !!settings.force_bloom,
                currentOpacityBloom: 0.0,
                isCRTEnabled: !!settings.force_crt,
                isAsciiEnabled: !!settings.force_ascii,
                isCrossHatchEnabled: !!settings.force_cross_hatch,
                isGodrayEnabled: !!settings.force_godray,
                isGrayscaleEnabled: !!settings.force_grayscale,
                isMotionBlurEnabled: !!settings.force_motion_blur,
                isOldFilmEnabled: !!settings.force_old_film,
                isPixelateEnabled: !!settings.force_pixelate,
                isShockwaveEnabled: !!settings.force_shockwave,
                isBloodEnabled: !!settings.force_blood,
                isGlitchEnabled: !!settings.force_glitch,
                isFadeToBlackEnabled: !!settings.force_fade_to_black,

                // Smooth-fade opacity trackers (all start at 0 — fade in when enabled)
                currentOpacity: 0.0, // clouds
                currentOpacityFog: 0.0,
                currentOpacityRain: 0.0,
                currentOpacityDesertDust: 0.0,
                currentOpacitySnow: 0.0,
                currentOpacityEmbers: 0.0,
                currentOpacityMagicDust: 0.0,
                currentOpacityLeaves: 0.0,
                currentOpacityBlood: 0.0,
                currentOpacityGlitch: 0.0,
                currentOpacityFadeToBlack: 0.0,
                currentOpacityGodray: 0.0,

                // Progress tracking for fadetoblack
                fadeToBlackProgress: 0.0,

                // Per-effect elapsed time counters (staggered to diversify noise patterns)
                elapsedTime: 0.0,    // clouds (also shared by thunder)
                elapsedTimeFog: 1000.0,
                elapsedTimeRain: 2000.0,
                elapsedTimeDesertDust: 3000.0,
                elapsedTimeSnow: 4000.0,
                elapsedTimeEmbers: 5000.0,
                elapsedTimeMagicDust: 6000.0,
                elapsedTimeLeaves: 7000.0,
                elapsedTimeCRT: 0.0,
                elapsedTimeAscii: 0.0,
                elapsedTimeCrossHatch: 0.0,
                elapsedTimeGodray: 0.0,
                elapsedTimeOldFilm: 0.0,
                elapsedTimeBlood: 0.0,
                elapsedTimeGlitch: 0.0,

                // Thunder-specific
                nextThunderTime: 0.0,
                currentThunderOpacity: 0.0,
                isFlashing: false,

                // Dynamic parameter overrides (optional payload)
                parameters: {},
            };

            // ------------------------------------------------------------------ //
            // Build PIXI display objects
            // ------------------------------------------------------------------ //

            const { createContainers } = window.__VFX.containers;
            const { createParticleSystem } = window.__VFX.particles;
            const { createFilters } = window.__VFX.filters;

            const containers = createContainers(PIXI, GAME_WIDTH, GAME_HEIGHT);

            const { vignetteSprite, magicParticles, leafParticles } =
                createParticleSystem(PIXI, containers, GAME_WIDTH, GAME_HEIGHT, NUM_MAGIC, NUM_LEAVES);

            const filters = createFilters(PIXI, containers, GAME_WIDTH, GAME_HEIGHT);

            // ------------------------------------------------------------------ //
            // Animation tick
            // ------------------------------------------------------------------ //

            const { createVfxTick } = window.__VFX.tick;

            const vfxTick = createVfxTick({
                state, containers, filters, vignetteSprite,
                magicParticles, leafParticles,
                pixiApp, settings,
                GAME_WIDTH, GAME_HEIGHT,
                NUM_MAGIC, NUM_LEAVES,
                TARGET_OPACITIES,
                debugLog,
            });

            // ------------------------------------------------------------------ //
            // Event listeners + server settings sync
            // ------------------------------------------------------------------ //

            const lockedEffects = {};
            const activeTimeouts = {};

            const { registerVfxEvents } = window.__VFX.events;

            registerVfxEvents({
                state, filters, vignetteSprite,
                settings, lockedEffects, activeTimeouts,
                debugLog,
                GAME_WIDTH, GAME_HEIGHT,
                EFFECT_SETTING_MAP,
            }, runtime);

            // Real-time settings pushed from the server (e.g. plugin settings panel)
            if (context.socket) {
                runtime.onSocket('plugin:settings-updated:vn_pixijs_vfx', (newSettings) => {
                    debugLog('[vn_pixijs_vfx] Received real-time settings update:', newSettings);

                    // Merge partial updates
                    Object.assign(settings, newSettings);

                    // Sync all enable flags from the fresh settings
                    state.isCloudsEnabled = !!settings.force_clouds;
                    state.isFogEnabled = !!settings.force_fog;
                    state.isThunderEnabled = !!settings.force_thunder;
                    state.isRainEnabled = !!settings.force_rain;
                    state.isDesertDustEnabled = !!settings.force_desert_dust;
                    state.isSnowEnabled = !!settings.force_snow;
                    state.isEmbersEnabled = !!settings.force_embers;
                    state.isMagicDustEnabled = !!settings.force_magic_dust;
                    state.isLeavesEnabled = !!settings.force_leaves;

                    state.isShakeEnabled = !!settings.force_shake;
                    if (state.isShakeEnabled) state.shakeIntensity = 1.0;

                    state.isWobbleEnabled = !!settings.force_wobble;
                    state.isVignetteEnabled = !!settings.force_vignette;
                    state.isBloomEnabled = !!settings.force_bloom;
                    state.isCRTEnabled = !!settings.force_crt;
                    state.isAsciiEnabled = !!settings.force_ascii;
                    state.isCrossHatchEnabled = !!settings.force_cross_hatch;
                    state.isGodrayEnabled = !!settings.force_godray;
                    state.isGrayscaleEnabled = !!settings.force_grayscale;
                    state.isMotionBlurEnabled = !!settings.force_motion_blur;
                    state.isOldFilmEnabled = !!settings.force_old_film;
                    state.isPixelateEnabled = !!settings.force_pixelate;

                    state.isShockwaveEnabled = !!settings.force_shockwave;
                    if (state.isShockwaveEnabled) {
                        filters.shockwaveFilter.time = 0;
                        filters.shockwaveFilter.center = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
                    }

                    state.isBloodEnabled = !!settings.force_blood;
                    state.isGlitchEnabled = !!settings.force_glitch;
                    state.isFadeToBlackEnabled = !!settings.force_fade_to_black;
                });
            }

            // ------------------------------------------------------------------ //
            // Engine readiness polling + final mount
            // ------------------------------------------------------------------ //

            const initVfx = () => {
                if (runtime.disposed) return;

                // Wait until both the layers and the application ticker are fully ready
                if (!pixiApp?.layers?.fx || !pixiApp?.layers?.background || !pixiApp?.app?.ticker) {
                    requestAnimationFrame(initVfx);
                    return;
                }

                if (!containers.vfxContainer.parent) {
                    // Mount foreground VFX to the fx layer
                    pixiApp.layers.fx.addChild(containers.vfxContainer);

                    // Mount background VFX; force background layer to sort by zIndex so
                    // dynamically loaded background images (zIndex 0) don't overdraw it
                    pixiApp.layers.background.addChild(containers.vfxContainerBg);
                    pixiApp.layers.background.sortableChildren = true;
                    containers.vfxContainerBg.zIndex = 10;

                    // Vignette and blood are mounted to app.stage (the immovable root)
                    // so they remain screen-fixed and unaffected by world transforms
                    pixiApp.app.stage.addChild(vignetteSprite);
                    pixiApp.app.stage.addChild(containers.vfxContainerBlood);
                    pixiApp.app.stage.sortableChildren = true;

                    const rendererType = pixiApp.app?.renderer?.type;
                    const rendererName = pixiApp.app?.renderer?._id || 'unknown';
                    debugLog(`[vn_pixijs_vfx] High-Quality VFX Containers initialized. Renderer Type: ${rendererType}, Name: ${rendererName}`);
                }

                if (pixiApp.hooks?.addPreRender) {
                    runtime.onPreRender(vfxTick, 0);
                    debugLog('[vn_pixijs_vfx] FBM Cloud & Fog animation hooks registered.');
                } else {
                    debugError('[vn_pixijs_vfx] pixiApp.hooks.addPreRender not found!');
                }
            };

            debugLog('[vn_pixijs_vfx] Starting polling for engine readiness.');
            initVfx();

            // Custom dispose: destroy PIXI containers and filters
            runtime.onDispose(() => {
                if (containers.vfxContainer?.parent) {
                    containers.vfxContainer.parent.removeChild(containers.vfxContainer);
                }
                if (containers.vfxContainerBg?.parent) {
                    containers.vfxContainerBg.parent.removeChild(containers.vfxContainerBg);
                }
                if (vignetteSprite?.parent) {
                    vignetteSprite.parent.removeChild(vignetteSprite);
                }
                if (containers.vfxContainerBlood?.parent) {
                    containers.vfxContainerBlood.parent.removeChild(containers.vfxContainerBlood);
                }
                try { containers.vfxContainer?.destroy({ children: true }); } catch { }
                try { containers.vfxContainerBg?.destroy({ children: true }); } catch { }
                try { vignetteSprite?.destroy({ children: true }); } catch { }
                try { containers.vfxContainerBlood?.destroy({ children: true }); } catch { }
                if (pixiApp?.viewport) {
                    pixiApp.viewport.filters = null;
                }
            });

        } catch (error) {
            debugError('[vn_pixijs_vfx] Fatal error during shader initialization:', error);
        }
    }); // End of register

})(context);

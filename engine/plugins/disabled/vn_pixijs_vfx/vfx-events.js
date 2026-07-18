// vfx-events.js
// Registers every window event listener for the VFX system.
//
// The enormous repetition of start/clear listener pairs is eliminated by
// registerEffectListeners(), which generates both listeners from a single config object.
// One-of-a-kind events (godray, shockwave, clear-sky, sync, etc.) are wired individually.
//
// Injection order: no dependencies on other VFX modules (all deps are passed in).

(function () {

    /**
     * @param {object} deps
     * @param {object} deps.state           - Mutable effect state
     * @param {object} deps.filters         - All filter instances
     * @param {object} deps.vignetteSprite  - The vignette PIXI.Sprite
     * @param {object} deps.settings        - VFX_SETTINGS
     * @param {object} deps.lockedEffects   - Shared lock map { [effectId]: bool }
     * @param {object} deps.activeTimeouts  - Shared timeout map { [effectId]: timeoutId }
     * @param {function} deps.debugLog
     * @param {number} deps.GAME_WIDTH
     * @param {number} deps.GAME_HEIGHT
     * @param {object} deps.EFFECT_SETTING_MAP
     */
    function registerVfxEvents(deps, runtime) {
        const {
            state, filters, vignetteSprite,
            settings, lockedEffects, activeTimeouts,
            debugLog,
            GAME_WIDTH, GAME_HEIGHT,
            EFFECT_SETTING_MAP,
        } = deps;

        const { shockwaveFilter, godrayFilter } = filters;
        const DEFAULT_GODRAY_CENTER = { x: -300, y: -300 };

        // -------------------------------------------------------------------------
        // Timeout helpers
        // -------------------------------------------------------------------------

        function registerEffectTimeout(effectId, clearEventName, detail) {
            if (activeTimeouts[effectId]) {
                clearTimeout(activeTimeouts[effectId]);
                delete activeTimeouts[effectId];
            }
            const duration = detail?.duration || detail?.timeout;
            if (typeof duration === 'number' && duration > 0) {
                activeTimeouts[effectId] = setTimeout(() => {
                    window.dispatchEvent(new CustomEvent(clearEventName));
                    delete activeTimeouts[effectId];
                }, duration);
            }
        }

        function clearEffectTimeout(effectId) {
            if (activeTimeouts[effectId]) {
                clearTimeout(activeTimeouts[effectId]);
                delete activeTimeouts[effectId];
            }
        }

        function toPixelCoord(value, size) {
            return value <= 1.0 ? value * size : value;
        }

        function getOptionalAliveBgLightHint() {
            const runtimeState = window.state || window.ALIVE_BG_STATE;
            const currentBg = runtimeState?.currentBackground || null;
            if (!currentBg) return null;

            const hint = window.__ALIVE_BG?.getLightHint?.(currentBg) || null;
            if (!hint || typeof hint !== 'object') return null;
            if (!Number.isFinite(hint.confidence) || hint.confidence < 0.22) return null;
            if (!Number.isFinite(hint.x) || !Number.isFinite(hint.y)) return null;
            return hint;
        }

        function projectAliveBgHintOffscreen(hint) {
            if (!hint) return null;

            const anchorX = toPixelCoord(hint.x, GAME_WIDTH);
            const anchorY = toPixelCoord(hint.y, GAME_HEIGHT);
            let dirX = 0.0;
            let dirY = 1.0;

            if (Number.isFinite(hint.targetX) && Number.isFinite(hint.targetY)) {
                dirX = toPixelCoord(hint.targetX, GAME_WIDTH) - anchorX;
                dirY = toPixelCoord(hint.targetY, GAME_HEIGHT) - anchorY;
            } else if (Number.isFinite(hint.angle)) {
                const radians = (hint.angle * Math.PI) / 180;
                dirX = Math.cos(radians);
                dirY = Math.sin(radians);
            }

            const len = Math.hypot(dirX, dirY);
            if (!Number.isFinite(len) || len < 0.0001) {
                return { x: anchorX, y: -GAME_HEIGHT * 1.1 };
            }

            const reverseX = -dirX / len;
            const reverseY = -dirY / len;
            const bounds = {
                left: -GAME_WIDTH * 0.9,
                right: GAME_WIDTH * 1.9,
                top: -GAME_HEIGHT * 1.1,
                bottom: GAME_HEIGHT * 1.1,
            };
            const candidates = [];

            if (reverseX < -0.0001) candidates.push((bounds.left - anchorX) / reverseX);
            if (reverseX > 0.0001) candidates.push((bounds.right - anchorX) / reverseX);
            if (reverseY < -0.0001) candidates.push((bounds.top - anchorY) / reverseY);
            if (reverseY > 0.0001) candidates.push((bounds.bottom - anchorY) / reverseY);

            const t = candidates
                .filter(value => Number.isFinite(value) && value > 0)
                .sort((a, b) => a - b)[0];

            if (!Number.isFinite(t)) {
                return { x: anchorX, y: -GAME_HEIGHT * 1.1 };
            }

            return {
                x: anchorX + (reverseX * t),
                y: anchorY + (reverseY * t),
                anchorX,
                anchorY,
            };
        }

        function logGodraySourceResolution(mode, data = null) {
            debugLog(`[vn_pixijs_vfx] Godray source resolution: ${mode}`, data);
        }

        function applyGodraySource(detail = null) {
            if (detail && Number.isFinite(detail.x) && Number.isFinite(detail.y)) {
                godrayFilter.center = {
                    x: toPixelCoord(detail.x, GAME_WIDTH),
                    y: toPixelCoord(detail.y, GAME_HEIGHT),
                };
                logGodraySourceResolution('manual-center', {
                    x: godrayFilter.center.x,
                    y: godrayFilter.center.y,
                    angle: Number.isFinite(detail.angle) ? detail.angle : '(auto-or-filter-default)',
                });
                return;
            }

            if (detail?.auto === false) {
                godrayFilter.center = { ...DEFAULT_GODRAY_CENTER };
                logGodraySourceResolution('auto-disabled -> default-offscreen');
                return;
            }

            const hint = getOptionalAliveBgLightHint();
            if (hint) {
                const projected = projectAliveBgHintOffscreen(hint);
                godrayFilter.center = projected || { ...DEFAULT_GODRAY_CENTER };
                logGodraySourceResolution('alive-bg-hint-offscreen', {
                    src: hint.src || '(unknown)',
                    anchorX: hint.x,
                    anchorY: hint.y,
                    centerX: godrayFilter.center.x,
                    centerY: godrayFilter.center.y,
                    angle: hint.angle,
                    confidence: hint.confidence,
                    hasDepth: hint.hasDepth,
                });
                return;
            }

            godrayFilter.center = { ...DEFAULT_GODRAY_CENTER };
            logGodraySourceResolution('no-hint -> default-offscreen');
        }

        // -------------------------------------------------------------------------
        // Generic start/clear listener factory
        //
        // For the vast majority of effects, start = set flag true, clear = set flag false.
        // 'onClear' is optional for effects that need extra state cleanup (bloom, vignette, etc.).
        // -------------------------------------------------------------------------

        function registerEffectListeners(id, flagKey, settingKey, onClear = null) {
            runtime.onWindow(`vfx:start-${id}`, (e) => {
                state[flagKey] = true;
                if (e.detail?.locked) lockedEffects[id] = true;

                // Capture optional parameters (excluding internal keys like duration/locked)
                const { ...params } = e.detail || {};
                if (Object.keys(params).length > 0) {
                    state.parameters[id] = params;
                }

                registerEffectTimeout(id, `vfx:clear-${id}`, e.detail);
                debugLog(`[vn_pixijs_vfx] Event: start-${id}` + (e.detail?.locked ? ' (LOCKED)' : '') + (Object.keys(params).length > 0 ? ` (PAYLOAD: ${JSON.stringify(params)})` : ''));
            });

            runtime.onWindow(`vfx:clear-${id}`, (e) => {
                if (lockedEffects[id] && !e?.detail?.force) return;
                if (!settings[settingKey]) {
                    state[flagKey]    = false;
                    lockedEffects[id] = false;
                    if (onClear) onClear();
                }
                clearEffectTimeout(id);
                debugLog(`[vn_pixijs_vfx] Event: clear-${id}`);
            });
        }

        // -------------------------------------------------------------------------
        // Standard effect pairs (generated — no repetition)
        // -------------------------------------------------------------------------

        registerEffectListeners('clouds',      'isCloudsEnabled',      'force_clouds');
        registerEffectListeners('fog',         'isFogEnabled',         'force_fog');
        registerEffectListeners('thunder',     'isThunderEnabled',     'force_thunder');
        registerEffectListeners('rain',        'isRainEnabled',        'force_rain');
        registerEffectListeners('desert-dust', 'isDesertDustEnabled',  'force_desert_dust');
        registerEffectListeners('snow',        'isSnowEnabled',        'force_snow');
        registerEffectListeners('embers',      'isEmbersEnabled',      'force_embers');
        registerEffectListeners('magic-dust',  'isMagicDustEnabled',   'force_magic_dust');
        registerEffectListeners('leaves',      'isLeavesEnabled',      'force_leaves',
            () => { state.currentOpacityLeaves = 0.0; });
        registerEffectListeners('wobble',      'isWobbleEnabled',      'force_wobble');
        registerEffectListeners('vignette',    'isVignetteEnabled',    'force_vignette');
        registerEffectListeners('bloom',       'isBloomEnabled',       'force_bloom',
            () => { state.currentOpacityBloom = 0.0; });
        registerEffectListeners('blood',       'isBloodEnabled',       'force_blood');
        registerEffectListeners('glitch',      'isGlitchEnabled',      'force_glitch');
        registerEffectListeners('crt',         'isCRTEnabled',         'force_crt');
        registerEffectListeners('ascii',       'isAsciiEnabled',       'force_ascii');
        registerEffectListeners('cross-hatch', 'isCrossHatchEnabled',  'force_cross_hatch');
        registerEffectListeners('grayscale',   'isGrayscaleEnabled',   'force_grayscale');
        registerEffectListeners('motion-blur', 'isMotionBlurEnabled',  'force_motion_blur');
        registerEffectListeners('old-film',    'isOldFilmEnabled',     'force_old_film');
        registerEffectListeners('pixelate',    'isPixelateEnabled',    'force_pixelate');
        registerEffectListeners('fadetoblack', 'isFadeToBlackEnabled', 'force_fade_to_black');

        // -------------------------------------------------------------------------
        // One-of-a-kind events (unique enough to warrant individual handlers)
        // -------------------------------------------------------------------------

        // Shake — trigger-only (no start/clear pair); auto-decays via internal physics
        runtime.onWindow('vfx:trigger-shake', () => {
            state.isShakeEnabled = true;
            state.shakeIntensity = 1.0;
            debugLog('[vn_pixijs_vfx] Event: trigger-shake');
        });

        // Godray — start sets optional custom center position from pixel or normalised coords
        runtime.onWindow('vfx:start-godray', (e) => {
            state.isGodrayEnabled = true;
            if (e.detail?.locked) lockedEffects['godray'] = true;

            // Capture optional parameters
            const { ...params } = e.detail || {};
            state.parameters['godray'] = params;
            applyGodraySource(e.detail || null);

            registerEffectTimeout('godray', 'vfx:clear-godray', e.detail);
            debugLog(`[vn_pixijs_vfx] Event: start-godray` + (e.detail?.locked ? ' (LOCKED)' : '') + (Object.keys(params).length > 0 ? ` (PAYLOAD: ${JSON.stringify(params)})` : ''));
        });
        runtime.onWindow('vfx:clear-godray', (e) => {
            if (lockedEffects['godray'] && !e?.detail?.force) return;
            if (!settings.force_godray) {
                state.isGodrayEnabled   = false;
                lockedEffects['godray'] = false;
                delete state.parameters['godray'];
                godrayFilter.center = { ...DEFAULT_GODRAY_CENTER };
            }
            clearEffectTimeout('godray');
            debugLog('[vn_pixijs_vfx] Event: clear-godray');
        });

        // Shockwave — trigger-only, positions from event payload or defaults to screen centre
        runtime.onWindow('vfx:trigger-shockwave', (e) => {
            state.isShockwaveEnabled = true;
            shockwaveFilter.time     = 0;

            if (e.detail && typeof e.detail.x === 'number' && typeof e.detail.y === 'number') {
                const px = e.detail.x <= 1.0 ? e.detail.x * GAME_WIDTH  : e.detail.x;
                const py = e.detail.y <= 1.0 ? e.detail.y * GAME_HEIGHT : e.detail.y;
                shockwaveFilter.center = { x: px, y: py };
            } else {
                shockwaveFilter.center = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
            }

            debugLog('[vn_pixijs_vfx] Event: trigger-shockwave');
        });
        runtime.onWindow('vfx:clear-shockwave', () => {
            if (!settings.force_shockwave) {
                state.isShockwaveEnabled = false;
                shockwaveFilter.time     = 10.0;
            }
            debugLog('[vn_pixijs_vfx] Event: clear-shockwave');
        });

        // Pixelate sweep-catchup log (flag + timeout already handled by generic pair above)
        runtime.onWindow('vfx:start-pixelate', (e) => {
            if (e.detail?._isSweepCatchup) debugLog('[vn_pixijs_vfx] (Sweep Catchup Enabled)');
        });

        // -------------------------------------------------------------------------
        // Bulk clear events
        // -------------------------------------------------------------------------

        /**
         * Shared helper: clears one effect unless it is locked (or force=true overrides locking).
         * onExtra handles effects that need more than a flag flip (opacity resets, sprite hides, etc.).
         */
        function clearOne(force, flagKey, id, settingKey, onExtra = null) {
            if (!force && lockedEffects[id]) return;
            if (!settings[settingKey]) {
                state[flagKey]    = false;
                lockedEffects[id] = false;
                delete state.parameters[id]; // Clear dynamic overrides
                if (onExtra) onExtra();
            }
        }

        function clearAllEffects(force) {
            clearOne(force, 'isCloudsEnabled',      'clouds',       'force_clouds');
            clearOne(force, 'isFogEnabled',          'fog',          'force_fog');
            clearOne(force, 'isThunderEnabled',      'thunder',      'force_thunder');
            clearOne(force, 'isRainEnabled',         'rain',         'force_rain');
            clearOne(force, 'isDesertDustEnabled',   'desert-dust',  'force_desert_dust');
            clearOne(force, 'isSnowEnabled',         'snow',         'force_snow');
            clearOne(force, 'isEmbersEnabled',       'embers',       'force_embers');
            clearOne(force, 'isMagicDustEnabled',    'magic-dust',   'force_magic_dust');
            clearOne(force, 'isLeavesEnabled',       'leaves',       'force_leaves',
                () => { state.currentOpacityLeaves = 0.0; });
            clearOne(force, 'isCRTEnabled',          'crt',          'force_crt');
            clearOne(force, 'isAsciiEnabled',        'ascii',        'force_ascii');
            clearOne(force, 'isCrossHatchEnabled',   'cross-hatch',  'force_cross_hatch');
            clearOne(force, 'isGodrayEnabled',       'godray',       'force_godray');
            clearOne(force, 'isGrayscaleEnabled',    'grayscale',    'force_grayscale');
            clearOne(force, 'isMotionBlurEnabled',   'motion-blur',  'force_motion_blur');
            clearOne(force, 'isOldFilmEnabled',      'old-film',     'force_old_film');
            clearOne(force, 'isPixelateEnabled',     'pixelate',     'force_pixelate');
            clearOne(force, 'isShockwaveEnabled',    'shockwave',    'force_shockwave',
                () => { shockwaveFilter.time = 10.0; });
            clearOne(force, 'isVignetteEnabled',     'vignette',     'force_vignette', () => {
                state.currentOpacityVignette = 0.0;
                if (vignetteSprite) { vignetteSprite.alpha = 0.0; vignetteSprite.visible = false; }
            });
            clearOne(force, 'isBloomEnabled',        'bloom',        'force_bloom',
                () => { state.currentOpacityBloom = 0.0; });
            clearOne(force, 'isShakeEnabled',        'shake',        'force_shake',
                () => { state.shakeIntensity = 0.0; });
            clearOne(force, 'isWobbleEnabled',       'wobble',       'force_wobble');
            clearOne(force, 'isBloodEnabled',        'blood',        'force_blood',
                () => { state.currentOpacityBlood = 0.0; });
            clearOne(force, 'isGlitchEnabled',       'glitch',       'force_glitch',
                () => { state.currentOpacityGlitch = 0.0; });
            clearOne(force, 'isFadeToBlackEnabled',  'fadetoblack',  'force_fade_to_black',
                () => { state.currentOpacityFadeToBlack = 0.0; });
        }

        // vfx:clear-sky — backwards-compatible bulk clear (also clears all timeouts)
        runtime.onWindow('vfx:clear-sky', (e) => {
            const force = !!e?.detail?.force;
            Object.keys(activeTimeouts).forEach(id => {
                if (!lockedEffects[id] || force) clearEffectTimeout(id);
            });
            clearAllEffects(force);
            debugLog(`[vn_pixijs_vfx] Event: clear-sky (ALL)` + (force ? ' [FORCED]' : ''));
        });

        // system:clear-all-volatile-events — catch-up sweep cleanup (skips locked effects unless forced)
        runtime.onWindow('system:clear-all-volatile-events', (e) => {
            const force = !!e?.detail?.force;

            const clearVerbose = (flagKey, id, settingKey, onExtra = null) => {
                if (!force && lockedEffects[id]) {
                    debugLog(`[vn_pixijs_vfx] system:clear-all-volatile-events >> Skipping locked effect: ${id}`);
                    return;
                }
                if (!settings[settingKey]) {
                    state[flagKey]    = false;
                    lockedEffects[id] = false;
                    if (onExtra) onExtra();
                }
            };

            clearVerbose('isCloudsEnabled',    'clouds',       'force_clouds');
            clearVerbose('isFogEnabled',        'fog',          'force_fog');
            clearVerbose('isThunderEnabled',    'thunder',      'force_thunder');
            clearVerbose('isRainEnabled',       'rain',         'force_rain');
            clearVerbose('isDesertDustEnabled', 'desert-dust',  'force_desert_dust');
            clearVerbose('isSnowEnabled',       'snow',         'force_snow');
            clearVerbose('isEmbersEnabled',     'embers',       'force_embers');
            clearVerbose('isMagicDustEnabled',  'magic-dust',   'force_magic_dust');
            clearVerbose('isLeavesEnabled',     'leaves',       'force_leaves',
                () => { state.currentOpacityLeaves = 0.0; });
            clearVerbose('isShakeEnabled',      'shake',        'force_shake');
            clearVerbose('isWobbleEnabled',     'wobble',       'force_wobble');
            clearVerbose('isVignetteEnabled',   'vignette',     'force_vignette',
                () => { state.currentOpacityVignette = 0.0; });
            clearVerbose('isBloomEnabled',      'bloom',        'force_bloom',
                () => { state.currentOpacityBloom = 0.0; });
            clearVerbose('isCRTEnabled',        'crt',          'force_crt');
            clearVerbose('isAsciiEnabled',      'ascii',        'force_ascii');
            clearVerbose('isCrossHatchEnabled', 'cross-hatch',  'force_cross_hatch');
            clearVerbose('isGodrayEnabled',     'godray',       'force_godray');
            clearVerbose('isGrayscaleEnabled',  'grayscale',    'force_grayscale');
            clearVerbose('isMotionBlurEnabled', 'motion-blur',  'force_motion_blur');
            clearVerbose('isOldFilmEnabled',    'old-film',     'force_old_film');
            clearVerbose('isPixelateEnabled',   'pixelate',     'force_pixelate');
            clearVerbose('isShockwaveEnabled',  'shockwave',    'force_shockwave',
                () => { shockwaveFilter.time = 10.0; });
            clearVerbose('isGlitchEnabled',     'glitch',       'force_glitch',
                () => { state.currentOpacityGlitch = 0.0; });
            clearVerbose('isFadeToBlackEnabled','fadetoblack',  'force_fade_to_black',
                () => { state.currentOpacityFadeToBlack = 0.0; });
        });

        // -------------------------------------------------------------------------
        // vfx:sync — server-driven bulk enable/disable (used by the story engine)
        // -------------------------------------------------------------------------

        const effectSetterMap = {
            'clouds':      ()          => { state.isCloudsEnabled     = true; },
            'fog':         ()          => { state.isFogEnabled        = true; },
            'thunder':     ()          => { state.isThunderEnabled    = true; },
            'rain':        ()          => { state.isRainEnabled       = true; },
            'snow':        ()          => { state.isSnowEnabled       = true; },
            'embers':      ()          => { state.isEmbersEnabled     = true; },
            'desert-dust': ()          => { state.isDesertDustEnabled = true; },
            'magic-dust':  ()          => { state.isMagicDustEnabled  = true; },
            'leaves':      ()          => { state.isLeavesEnabled     = true; },
            'crt':         ()          => { state.isCRTEnabled        = true; },
            'ascii':       ()          => { state.isAsciiEnabled      = true; },
            'cross-hatch': ()          => { state.isCrossHatchEnabled = true; },
            'bloom':       ()          => { state.isBloomEnabled      = true; },
            'godray':      ()          => { state.isGodrayEnabled     = true; },
            'grayscale':   ()          => { state.isGrayscaleEnabled  = true; },
            'motion-blur': ()          => { state.isMotionBlurEnabled = true; },
            'old-film':    ()          => { state.isOldFilmEnabled    = true; },
            'pixelate':    ()          => { state.isPixelateEnabled   = true; },
            'blood':       ()          => { state.isBloodEnabled      = true; },
            'glitch':      ()          => { state.isGlitchEnabled     = true; },
            'vignette':    ()          => { state.isVignetteEnabled   = true; },
            'fadetoblack': ()          => { state.isFadeToBlackEnabled   = true; },
            'wobble':      ()          => { state.isWobbleEnabled     = true; },
            'shake':       (intensity) => { state.isShakeEnabled = true; if (intensity !== undefined) state.shakeIntensity = intensity; },
            'shockwave':   ()          => { state.isShockwaveEnabled = true; shockwaveFilter.time = 0; },
        };

        const effectDisablerMap = {
            'clouds':      () => { state.isCloudsEnabled     = false; },
            'fog':         () => { state.isFogEnabled        = false; },
            'thunder':     () => { state.isThunderEnabled    = false; },
            'rain':        () => { state.isRainEnabled       = false; },
            'snow':        () => { state.isSnowEnabled       = false; },
            'embers':      () => { state.isEmbersEnabled     = false; },
            'desert-dust': () => { state.isDesertDustEnabled = false; },
            'magic-dust':  () => { state.isMagicDustEnabled  = false; },
            'leaves':      () => { state.isLeavesEnabled     = false; },
            'crt':         () => { state.isCRTEnabled        = false; },
            'ascii':       () => { state.isAsciiEnabled      = false; },
            'cross-hatch': () => { state.isCrossHatchEnabled = false; },
            'bloom':       () => { state.isBloomEnabled      = false; },
            'godray':      () => { state.isGodrayEnabled     = false; },
            'grayscale':   () => { state.isGrayscaleEnabled  = false; },
            'motion-blur': () => { state.isMotionBlurEnabled = false; },
            'old-film':    () => { state.isOldFilmEnabled    = false; },
            'pixelate':    () => { state.isPixelateEnabled   = false; },
            'blood':       () => { state.isBloodEnabled      = false; },
            'glitch':      () => { state.isGlitchEnabled     = false; },
            'vignette':    () => { state.isVignetteEnabled      = false; },
            'fadetoblack': () => { state.isFadeToBlackEnabled   = false; },
            'shake':       () => { state.isShakeEnabled = false; state.shakeIntensity = 0; },
            'wobble':      () => { state.isWobbleEnabled     = false; },
            'shockwave':   () => { state.isShockwaveEnabled  = false; shockwaveFilter.time = 10.0; },
        };

        // UCP-native direct events. The legacy VFX runtime listens for per-effect
        // event names, so bridge generic commands to the existing handlers.
        runtime.onWindow('vfx:state', (e) => {
            const detail = e.detail || {};
            if (!detail.id) return;
            window.dispatchEvent(new CustomEvent(`vfx:start-${detail.id}`, { detail }));
        });

        runtime.onWindow('vfx:clear', (e) => {
            const detail = e.detail || {};
            if (!detail.id) return;
            window.dispatchEvent(new CustomEvent(`vfx:clear-${detail.id}`, { detail }));
        });

        // -------------------------------------------------------------------------
        // Generic vfx:trigger — used for one-off impacts
        // If it's a native trigger (shockwave, shake), it fires those specific listeners.
        // If it's a persistent effect (rain, clouds), it starts it for a default duration.
        // -------------------------------------------------------------------------
        runtime.onWindow('vfx:trigger', (e) => {
            const { id } = e.detail || {};
            if (!id) return;

            // 1. Check for native trigger handlers
            if (id === 'shockwave') {
                window.dispatchEvent(new CustomEvent('vfx:trigger-shockwave', { detail: e.detail }));
                return;
            }
            if (id === 'shake') {
                window.dispatchEvent(new CustomEvent('vfx:trigger-shake', { detail: e.detail }));
                return;
            }

            // 2. Fallback: Trigger a persistent effect for a default duration (3s)
            const detail = { ...e.detail };
            if (!detail.duration && !detail.timeout) {
                detail.duration = 3000;
            }
            window.dispatchEvent(new CustomEvent(`vfx:start-${id}`, { detail }));
        });

        runtime.onWindow('vfx:sync', (e) => {
            const { vfx } = e.detail || {};
            if (!vfx || !Array.isArray(vfx)) return;

            const requestedIds = new Set(vfx.map(v => v.id));

            // 1. Soft disable (fade out): turn off anything not in the new list
            Object.keys(effectDisablerMap).forEach(id => {
                const settingKey = EFFECT_SETTING_MAP[id];
                const isForced   = settingKey && settings[settingKey];
                if (!requestedIds.has(id) && !lockedEffects[id] && !isForced) {
                    effectDisablerMap[id]();
                }
            });

            // 2. Enable or update intensity/parameters for the requested effects
            vfx.forEach(v => {
                const setter = effectSetterMap[v.id];
                if (setter) {
                    setter(v.intensity);
                    // Store extra payload if present in the sync entry
                    const { id, ...params } = v;
                    if (Object.keys(params).length > 0) {
                        state.parameters[id] = params;
                    }
                } else {
                    debugLog(`[vn_pixijs_vfx] Sync: Unknown effect ID: ${v.id}`);
                }
            });

            debugLog(`[vn_pixijs_vfx] Sync (Soft) Complete. Active effects: ${vfx.map(v => v.id).join(', ')}`);
        });
    }

    window.__VFX = window.__VFX || {};
    window.__VFX.events = { registerVfxEvents };
})();

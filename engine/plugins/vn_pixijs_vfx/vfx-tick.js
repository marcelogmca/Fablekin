// vfx-tick.js
// Factory that returns the vfxTick function — the per-frame update loop for the
// entire VFX system.  All PIXI / shader logic is unchanged; it is just organised
// here with inline helpers to remove repetition in the fade/update pattern.
//
// Injection order: no dependencies on other VFX modules (all deps are passed in).

(function () {

    /**
     * Returns the main vfxTick(tickerProps) function.
     *
     * @param {object} deps
     * @param {object} deps.state          - Mutable effect state object (flags, opacities, times)
     * @param {object} deps.containers     - All PIXI containers / rects from createContainers()
     * @param {object} deps.filters        - All filter instances from createFilters()
     * @param {object} deps.vignetteSprite - The vignette PIXI.Sprite
     * @param {Array}  deps.magicParticles - Magic dust particle pool
     * @param {Array}  deps.leafParticles  - Leaf particle pool
     * @param {object} deps.pixiApp        - The game's pixiApp handle
     * @param {object} deps.settings       - The VFX_SETTINGS object
     * @param {number} deps.GAME_WIDTH
     * @param {number} deps.GAME_HEIGHT
     * @param {number} deps.NUM_MAGIC
     * @param {number} deps.NUM_LEAVES
     * @param {object} deps.TARGET_OPACITIES
     * @param {function} deps.debugLog
     */
    function createVfxTick(deps) {
        const {
            state, containers, filters, vignetteSprite,
            magicParticles, leafParticles,
            pixiApp, settings,
            GAME_WIDTH, GAME_HEIGHT,
            NUM_MAGIC, NUM_LEAVES,
            TARGET_OPACITIES,
            debugLog,
        } = deps;

        const {
            vfxContainer, vfxContainerBg,
            bgShadowRect, bgFogRect, bgRainRect, bgThunderRect,
            bgDesertDustRect, bgDesertDustRectBg,
            bgSnowRect, bgSnowRectBg,
            bgEmbersRect, bgEmbersRectBg,
            bgBloodRect,
            bgFadeToBlackRect,
            magicDustContainer, magicDustContainerBg,
            leavesContainer, leavesContainerBg,
        } = containers;

        const {
            shadowFilter, fogFilter, rainFilter,
            desertDustFilter, desertDustFilterBg,
            snowFilter, snowFilterBg,
            embersFilter, embersFilterBg,
            bloodFilter,
            bloomFilter, asciiFilter, crossHatchFilter, crtFilter,
            godrayFilter, grayscaleFilter, motionBlurFilter, oldFilmFilter,
            pixelateFilter, shockwaveFilter, glitchFilter,
            fadeToBlackFilter,
        } = filters;

        let tickLogCounter = 0;
        const DEFAULT_GODRAY_CENTER = { x: -300, y: -300 };
        let lastGodrayTraceSummary = '';

        function isDisplayObjectAlive(displayObject) {
            return !!displayObject
                && displayObject.destroyed !== true
                && !!displayObject.worldTransform;
        }

        function areCoreDisplayObjectsAlive() {
            return [
                vfxContainer,
                vfxContainerBg,
                magicDustContainer,
                magicDustContainerBg,
                leavesContainer,
                leavesContainerBg,
                vignetteSprite,
            ].every(isDisplayObjectAlive);
        }

        function toPixelCoord(value, size) {
            return value <= 1.0 ? value * size : value;
        }

        function roundForTrace(value, digits = 2) {
            const scale = 10 ** digits;
            return Math.round(value * scale) / scale;
        }

        function getOptionalAliveBgLightHint() {
            const runtimeState = window.state || window.ALIVE_BG_STATE;
            const currentBg = runtimeState?.currentBackground || null;
            if (!currentBg) return null;

            const hint = window.__ALIVE_BG?.getLightHint?.(currentBg) || null;
            if (!hint || typeof hint !== 'object') return null;
            if (!Number.isFinite(hint.confidence) || hint.confidence < 0.22) return null;
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

        function resolveGodrayCenter(params, autoHint) {
            if (Number.isFinite(params.x) && Number.isFinite(params.y)) {
                return {
                    x: toPixelCoord(params.x, GAME_WIDTH),
                    y: toPixelCoord(params.y, GAME_HEIGHT),
                };
            }

            if (params.auto === false) return null;
            if (autoHint && Number.isFinite(autoHint.x) && Number.isFinite(autoHint.y)) {
                return projectAliveBgHintOffscreen(autoHint);
            }

            return null;
        }

        function resolveGodrayAngle(params, autoHint) {
            if (Number.isFinite(params.angle)) return params.angle;
            if (params.auto === false) return null;
            return (autoHint && Number.isFinite(autoHint.angle)) ? autoHint.angle : null;
        }

        function traceGodrayResolution(centerSource, angleSource, center, angle, autoHint = null) {
            const roundedX = roundForTrace(center?.x ?? DEFAULT_GODRAY_CENTER.x, 1);
            const roundedY = roundForTrace(center?.y ?? DEFAULT_GODRAY_CENTER.y, 1);
            const roundedAngle = Number.isFinite(angle) ? roundForTrace(angle, 1) : 'unchanged';
            const summary = `${centerSource}|${angleSource}|${roundedX}|${roundedY}|${roundedAngle}|${autoHint?.src || 'none'}`;
            if (lastGodrayTraceSummary === summary) return;
            lastGodrayTraceSummary = summary;
            debugLog('[vn_pixijs_vfx] Godray live resolution', {
                centerSource,
                angleSource,
                center: center || { ...DEFAULT_GODRAY_CENTER },
                angle: Number.isFinite(angle) ? angle : '(unchanged)',
                hint: autoHint ? {
                    src: autoHint.src || '(unknown)',
                    confidence: roundForTrace(autoHint.confidence ?? 0, 3),
                    hasDepth: !!autoHint.hasDepth,
                } : null,
            });
        }

        // -------------------------------------------------------------------------
        // Internal helpers — remove the ~7-line repeated pattern for each shader effect
        // -------------------------------------------------------------------------

        /**
         * Fades a single-layer shader effect (one filter + one rect, FG camera only).
         * Used by: clouds, fog, rain.
         */
        function tickSingleLayerShader(id, enabled, opacityKey, elapsedKey, targetOpacity, filter, rect, flipValue, dt) {
            if (!enabled && state[opacityKey] <= 0.005) {
                rect.visible = false;
                state[opacityKey] = 0.0;
                return;
            }

            const params = state.parameters[id] || {};
            const finalTargetOpacity = params.opacity ?? targetOpacity;
            const target = enabled ? finalTargetOpacity : 0.0;
            state[opacityKey] += (target - state[opacityKey]) * 0.05 * dt;

            if (state[opacityKey] > 0.005) {
                const speed = params.speed ?? params.timeMultiplier ?? 1.0;
                state[elapsedKey] += dt * 0.016 * speed;

                const u = filter.resources.cloudUniforms.uniforms;
                u.uTime    = state[elapsedKey];
                u.uOpacity = state[opacityKey];
                u.uFlipY   = flipValue;
                u.uScaleMultiplier = (params.scale ?? params.scaleMultiplier ?? 1.0) * (filter._originalScaleMultiplier || 1.0);

                const wt = vfxContainer.worldTransform;
                u.uCameraPos[0] = wt.tx;
                u.uCameraPos[1] = wt.ty;
                u.uCameraScale  = wt.a;

                rect.visible = true;
            } else {
                rect.visible      = false;
                state[opacityKey] = 0.0;
            }
        }

        /**
         * Fades a dual-layer shader effect (FG + BG pair, each gets its own camera transform).
         * Used by: desertDust, snow, embers.
         */
        function tickDualLayerShader(id, enabled, opacityKey, elapsedKey, targetOpacity, filterFg, filterBg, rectFg, rectBg, flipValue, dt) {
            if (!enabled && state[opacityKey] <= 0.005) {
                rectFg.visible = false;
                rectBg.visible = false;
                state[opacityKey] = 0.0;
                return;
            }

            const params = state.parameters[id] || {};
            const finalTargetOpacity = params.opacity ?? targetOpacity;
            const target = enabled ? finalTargetOpacity : 0.0;
            state[opacityKey] += (target - state[opacityKey]) * 0.05 * dt;

            if (state[opacityKey] > 0.005) {
                const speed = params.speed ?? params.timeMultiplier ?? 1.0;
                state[elapsedKey] += dt * 0.016 * speed;

                const scale = (params.scale ?? params.scaleMultiplier ?? 1.0);

                const uFg = filterFg.resources.cloudUniforms.uniforms;
                uFg.uTime    = state[elapsedKey];
                uFg.uOpacity = state[opacityKey];
                uFg.uFlipY   = flipValue;
                uFg.uScaleMultiplier = scale * (filterFg._originalScaleMultiplier || 1.0);

                const uBg = filterBg.resources.cloudUniforms.uniforms;
                uBg.uTime    = state[elapsedKey];
                uBg.uOpacity = state[opacityKey];
                uBg.uFlipY   = flipValue;
                uBg.uScaleMultiplier = scale * (filterBg._originalScaleMultiplier || 1.0);

                const wt = vfxContainer.worldTransform;
                uFg.uCameraPos[0] = wt.tx;
                uFg.uCameraPos[1] = wt.ty;
                uFg.uCameraScale  = wt.a;

                const wtBg = vfxContainerBg.worldTransform;
                uBg.uCameraPos[0] = wtBg.tx;
                uBg.uCameraPos[1] = wtBg.ty;
                uBg.uCameraScale  = wtBg.a;

                rectFg.visible = true;
                rectBg.visible = true;
            } else {
                rectFg.visible    = false;
                rectBg.visible    = false;
                state[opacityKey] = 0.0;
            }
        }

        // One-time capture of original scale multipliers from filters
        if (shadowFilter.resources.cloudUniforms.uniforms.uScaleMultiplier) {
            shadowFilter._originalScaleMultiplier       = shadowFilter.resources.cloudUniforms.uniforms.uScaleMultiplier.value;
            fogFilter._originalScaleMultiplier          = fogFilter.resources.cloudUniforms.uniforms.uScaleMultiplier.value;
            rainFilter._originalScaleMultiplier         = rainFilter.resources.cloudUniforms.uniforms.uScaleMultiplier.value;
            desertDustFilter._originalScaleMultiplier   = desertDustFilter.resources.cloudUniforms.uniforms.uScaleMultiplier.value;
            desertDustFilterBg._originalScaleMultiplier = desertDustFilterBg.resources.cloudUniforms.uniforms.uScaleMultiplier.value;
            snowFilter._originalScaleMultiplier         = snowFilter.resources.cloudUniforms.uniforms.uScaleMultiplier.value;
            snowFilterBg._originalScaleMultiplier       = snowFilterBg.resources.cloudUniforms.uniforms.uScaleMultiplier.value;
            embersFilter._originalScaleMultiplier       = embersFilter.resources.cloudUniforms.uniforms.uScaleMultiplier.value;
            embersFilterBg._originalScaleMultiplier     = embersFilterBg.resources.cloudUniforms.uniforms.uScaleMultiplier.value;
        }

        // -------------------------------------------------------------------------
        // The tick function itself
        // -------------------------------------------------------------------------

        return function vfxTick(tickerProps) {
            if (!pixiApp?.app || pixiApp.app.destroyed || !areCoreDisplayObjectsAlive()) return;

            const dt = tickerProps.deltaTime;

            if (tickLogCounter < 5) {
                tickLogCounter++;
                debugLog(`[vn_pixijs_vfx] vfxTick: clouds=${state.currentOpacity.toFixed(3)}(${state.isCloudsEnabled}), fog=${state.currentOpacityFog.toFixed(3)}(${state.isFogEnabled})`);
            }

            // Determine Y-flip based on whether any viewport-level post-processing filters are active.
            // In PixiJS v8, rendering to a filter texture inverts the Y-coordinate compared 
            // to rendering directly to the screen. Our custom shaders must account for this.
            
            // Check if any effect that pushes a filter to pixiApp.viewport.filters is active.
            const screenSpaceEffectsActive = (
                state.isCRTEnabled || state.isAsciiEnabled || state.isCrossHatchEnabled || 
                state.isBloomEnabled || state.isGodrayEnabled || state.isGrayscaleEnabled || 
                state.isMotionBlurEnabled || state.isOldFilmEnabled || state.isPixelateEnabled || 
                state.isShockwaveEnabled || state.isGlitchEnabled || settings.force_glitch ||
                (shockwaveFilter.time < 3.0)
            );

            // If screen-space filters are active, PixiJS renders to a texture (Y=0 at bottom natively).
            // Based on user feedback: 
            // - No Filters + flipValue 1.0 = UP (Wrong) -> Needs 0.0
            // - Godray (Filter) + flipValue 1.0 = DOWN (Right) -> Needs 1.0
            const flipValue = screenSpaceEffectsActive ? 1.0 : 0.0;

            // --- Viewport / Camera Helpers ---
            const wt          = vfxContainer.worldTransform;
            const camInvScale = 1.0 / wt.a;
            const wrapW       = GAME_WIDTH  * camInvScale;
            const wrapH       = GAME_HEIGHT * camInvScale;
            const offsetX     = -wt.tx * camInvScale;
            const offsetY     = -wt.ty * camInvScale;

            // --- Atmospheric / particle effects ---

            tickSingleLayerShader(
                'clouds', state.isCloudsEnabled, 'currentOpacity', 'elapsedTime',
                TARGET_OPACITIES.clouds, shadowFilter, bgShadowRect, flipValue, dt
            );

            tickSingleLayerShader(
                'fog', state.isFogEnabled, 'currentOpacityFog', 'elapsedTimeFog',
                TARGET_OPACITIES.fog, fogFilter, bgFogRect, flipValue, dt
            );

            tickSingleLayerShader(
                'rain', state.isRainEnabled, 'currentOpacityRain', 'elapsedTimeRain',
                TARGET_OPACITIES.rain, rainFilter, bgRainRect, flipValue, dt
            );

            tickDualLayerShader(
                'desert-dust', state.isDesertDustEnabled, 'currentOpacityDesertDust', 'elapsedTimeDesertDust',
                TARGET_OPACITIES.desertDust,
                desertDustFilter, desertDustFilterBg,
                bgDesertDustRect, bgDesertDustRectBg,
                flipValue, dt
            );

            tickDualLayerShader(
                'snow', state.isSnowEnabled, 'currentOpacitySnow', 'elapsedTimeSnow',
                TARGET_OPACITIES.snow,
                snowFilter, snowFilterBg,
                bgSnowRect, bgSnowRectBg,
                flipValue, dt
            );

            tickDualLayerShader(
                'embers', state.isEmbersEnabled, 'currentOpacityEmbers', 'elapsedTimeEmbers',
                TARGET_OPACITIES.embers,
                embersFilter, embersFilterBg,
                bgEmbersRect, bgEmbersRectBg,
                flipValue, dt
            );

            // --- Magic Dust (sprite particle system) ---
            if (state.isMagicDustEnabled || state.currentOpacityMagicDust > 0.005) {
                const params = state.parameters['magic-dust'] || {};
                const target = state.isMagicDustEnabled ? (params.opacity ?? TARGET_OPACITIES.magicDust) : 0.0;
                state.currentOpacityMagicDust += (target - state.currentOpacityMagicDust) * 0.05 * dt;

                if (state.currentOpacityMagicDust > 0.005) {
                    const speed = params.speed ?? params.timeMultiplier ?? 1.0;
                    state.elapsedTimeMagicDust += dt * 0.016 * speed;

                    for (let i = 0; i < NUM_MAGIC; i++) {
                        const p = magicParticles[i];
                        if (!isDisplayObjectAlive(p)) continue;

                        p.y += p.vy * dt * 0.5;
                        p.x += (p.vx + Math.sin(state.elapsedTimeMagicDust + p.seed) * 0.2) * dt * 0.5;

                        const twinkle = (Math.sin(state.elapsedTimeMagicDust * 3.0 + p.seed * 5.0) * 0.5 + 0.5);
                        p.alpha = twinkle * state.currentOpacityMagicDust;

                        if (p.y > offsetY + wrapH + 50)  p.y = offsetY - 50;
                        if (p.x < offsetX - 50)           p.x = offsetX + wrapW + 50;
                        if (p.x > offsetX + wrapW + 50)   p.x = offsetX - 50;
                    }

                    magicDustContainer.visible   = true;
                    magicDustContainerBg.visible = true;
                } else {
                    magicDustContainer.visible    = false;
                    magicDustContainerBg.visible  = false;
                    state.currentOpacityMagicDust = 0.0;
                }
            }

            // --- Leaves (sprite particle system with lifecycle) ---
            let anyLeafActive = false;

            if (vfxContainer && (state.isLeavesEnabled || leavesContainer.visible || leavesContainerBg.visible)) {
                const params = state.parameters['leaves'] || {};
                const leafTarget = (state.isLeavesEnabled && vfxContainer) ? (params.opacity ?? TARGET_OPACITIES.leaves) : 0.0;
                state.currentOpacityLeaves += (leafTarget - state.currentOpacityLeaves) * 0.05 * dt;

                const speed = params.speed ?? params.timeMultiplier ?? 1.0;
                state.elapsedTimeLeaves += dt * 0.016 * speed;

                for (let i = 0; i < NUM_LEAVES; i++) {
                    const p = leafParticles[i];
                    if (!isDisplayObjectAlive(p)) continue;

                    // Spawn from above when effect is enabled
                    if (state.isLeavesEnabled && !p.isActive) {
                        p.isActive = true;
                        p.x = offsetX + Math.random() * wrapW;
                        p.y = offsetY - 50 - (Math.random() * wrapH);
                    }

                    // Kill leaves that are still far above the viewport after disabling
                    if (!state.isLeavesEnabled && p.isActive && p.y < offsetY - 50) {
                        p.isActive = false;
                        p.visible  = false;
                    }

                    if (p.isActive) {
                        anyLeafActive = true;

                        p.alpha   = p.baseAlpha * state.currentOpacityLeaves;
                        p.visible = (p.alpha > 0.005);

                        p.y += p.vy * dt * 0.5;

                        const sway = Math.sin(state.elapsedTimeLeaves * 1.5 + p.seedX) * 2.0;
                        p.x += sway * dt * 0.5;

                        const targetRot = Math.cos(state.elapsedTimeLeaves * 1.5 + p.seedX) * 0.5
                                        + Math.sin(state.elapsedTimeLeaves * 0.5 + p.seedRot);
                        p.rotation += (targetRot - p.rotation) * 0.1 * dt;

                        if (p.y > offsetY + wrapH + 50) {
                            if (state.isLeavesEnabled) {
                                // Wrap to the top for continuous rain of leaves
                                p.y = offsetY - 50;
                                p.x = offsetX + Math.random() * wrapW;
                            } else {
                                // Graceful despawn once off-screen
                                p.isActive = false;
                                p.visible  = false;
                            }
                        }

                        // Horizontal wrap
                        if (p.x < offsetX - 50)          p.x = offsetX + wrapW + 50;
                        if (p.x > offsetX + wrapW + 50)  p.x = offsetX - 50;
                    }
                }

                leavesContainer.visible   = anyLeafActive;
                leavesContainerBg.visible = anyLeafActive;
            }

            // --- Camera Shake ---
            let shakeX = 0;
            let shakeY = 0;

            if (state.isShakeEnabled || state.shakeIntensity > 0.01) {
                if (state.isShakeEnabled && settings.force_shake) {
                    // Constant violent shake for debug/force mode
                    state.shakeIntensity = 1.0;
                } else {
                    // Decaying one-off shake
                    state.shakeIntensity -= dt * 0.02;
                    if (state.shakeIntensity <= 0.01) {
                        state.shakeIntensity = 0;
                        state.isShakeEnabled = false;
                    }
                }

                if (state.shakeIntensity > 0.0) {
                    shakeX = (Math.random() - 0.5) * 50.0 * state.shakeIntensity;
                    shakeY = (Math.random() - 0.5) * 50.0 * state.shakeIntensity;
                }
            }

            // --- Camera Wobble ---
            let wobbleX = 0;
            let wobbleY = 0;

            if (state.isWobbleEnabled) {
                state.wobbleTime += dt * 0.012; // 75% of original 0.016
                wobbleX = Math.sin(state.wobbleTime * 0.5) * 7.5;  // 75% of original 10.0
                wobbleY = Math.cos(state.wobbleTime * 0.7) * 3.75; // 75% of original 5.0
            }

            // Apply combined camera offsets to the master viewport pivot
            if (pixiApp.viewport && (shakeX !== 0 || shakeY !== 0 || wobbleX !== 0 || wobbleY !== 0)) {
                pixiApp.viewport.pivot.set(
                    (pixiApp.LOGICAL_WIDTH  / 2) + shakeX + wobbleX,
                    (pixiApp.LOGICAL_HEIGHT / 2) + shakeY + wobbleY
                );
            } else if (pixiApp.viewport) {
                pixiApp.viewport.pivot.set(pixiApp.LOGICAL_WIDTH / 2, pixiApp.LOGICAL_HEIGHT / 2);
            }

            // --- Screen-Space Post-Processing (Viewport Filters) ---
            const screenFilters = [];

            if (state.isCRTEnabled) {
                const params = state.parameters['crt'] || {};
                state.elapsedTimeCRT += dt * 0.016 * (params.speed ?? 1.0);
                crtFilter.time = state.elapsedTimeCRT;
                crtFilter.seed = Math.random();
                screenFilters.push(crtFilter);
            }

            if (state.isAsciiEnabled) {
                const params = state.parameters['ascii'] || {};
                asciiFilter.size = params.size ?? 8;
                screenFilters.push(asciiFilter);
            }

            if (state.isCrossHatchEnabled) screenFilters.push(crossHatchFilter);

            if (state.isGodrayEnabled || state.currentOpacityGodray > 0.005) {
                const params = state.parameters['godray'] || {};
                const godrayTarget = state.isGodrayEnabled ? (params.opacity ?? 1.0) : 0.0;
                const autoHint = (params.auto === false) ? null : getOptionalAliveBgLightHint();

                // Smooth fade in/out when toggled
                state.currentOpacityGodray += (godrayTarget - state.currentOpacityGodray) * 0.05 * dt;

                // Time drives the internal FBM noise seed — must crawl for lazy ray drift
                state.elapsedTimeGodray += dt * 0.016 * (params.speed ?? 0.15);
                godrayFilter.time = state.elapsedTimeGodray;

                // Organic breathing: sum-of-sines on a separate slow clock so it
                // doesn't couple to the ray-drift speed. Smoothstep creates "sticky"
                // plateaus at both 0 and 1 — rays linger at full brightness, then
                // fade to genuine absence and hold there before gently returning.
                const breathClock = state.elapsedTimeGodray * 0.4; // Drastically slowed down
                const noise = Math.sin(breathClock)
                            + 0.5  * Math.sin(breathClock * 2.3 + 1.5)
                            + 0.25 * Math.sin(breathClock * 4.1 + 3.2);
                // Shifted offset from 0.45 to 0.55 so the bias heavily favors the ON state
                const raw = Math.max(0, Math.min(1, noise * 0.55 + 0.55));
                const breather = raw * raw * (3 - 2 * raw); // smoothstep

                // Alpha = true transparency. Gain & lacunarity stay FIXED so the
                // ray positions/count never recompute — no jitter, no disco.
                godrayFilter.alpha = (params.alpha ?? 1.0) * state.currentOpacityGodray * breather;
                godrayFilter.gain       = params.gain       ?? 0.5;
                godrayFilter.lacunarity = params.lacunarity  ?? 2.5;
                const resolvedCenter = resolveGodrayCenter(params, autoHint);
                godrayFilter.center = resolvedCenter || { ...DEFAULT_GODRAY_CENTER };
                const resolvedAngle = resolveGodrayAngle(params, autoHint);
                if (resolvedAngle !== null) godrayFilter.angle = resolvedAngle;
                const centerSource = Number.isFinite(params.x) && Number.isFinite(params.y)
                    ? 'manual'
                    : (params.auto === false ? 'default-offscreen' : (autoHint ? 'alive-bg-offscreen' : 'default-offscreen'));
                const angleSource = Number.isFinite(params.angle)
                    ? 'manual'
                    : (params.auto === false ? 'unchanged' : ((autoHint && Number.isFinite(autoHint.angle)) ? 'alive-bg' : 'unchanged'));
                traceGodrayResolution(centerSource, angleSource, godrayFilter.center, resolvedAngle ?? godrayFilter.angle, autoHint);

                screenFilters.push(godrayFilter);
            }

            if (state.isGrayscaleEnabled) screenFilters.push(grayscaleFilter);

            if (state.isMotionBlurEnabled) {
                const params = state.parameters['motion-blur'] || {};
                // Constant base velocity for a 'directional blur' look + camera influence
                const baseVx = params.velocityX ?? params.vx ?? 60.0;
                const baseVy = params.velocityY ?? params.vy ?? 0.0;
                const vx = baseVx + (shakeX + wobbleX) * 0.5;
                const vy = baseVy + (shakeY + wobbleY) * 0.5;
                motionBlurFilter.velocity = [vx, vy];
                screenFilters.push(motionBlurFilter);
            }

            if (state.isOldFilmEnabled) {
                const params = state.parameters['old-film'] || {};
                state.elapsedTimeOldFilm += dt * 0.016 * (params.speed ?? 1.0);
                oldFilmFilter.time = state.elapsedTimeOldFilm;
                oldFilmFilter.seed = Math.random();
                oldFilmFilter.sepia = params.sepia ?? 0.3;
                screenFilters.push(oldFilmFilter);
            }

            if (state.isPixelateEnabled) {
                const params = state.parameters['pixelate'] || {};
                pixelateFilter.size = params.size ?? 8;
                screenFilters.push(pixelateFilter);
            }

            // Bloom fades in/out (unlike most post-fx which snap on/off)
            if (state.isBloomEnabled || state.currentOpacityBloom > 0.005) {
                const params = state.parameters['bloom'] || {};
                const bloomTarget = state.isBloomEnabled ? 1.0 : 0.0;
                state.currentOpacityBloom += (bloomTarget - state.currentOpacityBloom) * 0.05 * dt;
                bloomFilter.strength = state.currentOpacityBloom * (params.strength ?? 4);
                screenFilters.push(bloomFilter);
            }

            // --- Glitch ---
            if (state.isGlitchEnabled || settings.force_glitch || state.currentOpacityGlitch > 0.005) {
                const params = state.parameters['glitch'] || {};
                const glitchTarget = (state.isGlitchEnabled || settings.force_glitch) ? 1.0 : 0.0;
                state.currentOpacityGlitch += (glitchTarget - state.currentOpacityGlitch) * 0.05 * dt;
                state.elapsedTimeGlitch    += dt * 0.016 * (params.speed ?? 1.0);

                // Periodic 'spasms' every ~0.5 seconds
                if (Math.sin(state.elapsedTimeGlitch * 12.0) > 0.8) {
                    glitchFilter.seed      = Math.random();
                    glitchFilter.slices    = params.slices ?? (5 + Math.floor(Math.random() * 15));
                    glitchFilter.offset    = params.offset ?? (10 + Math.random() * 30);
                    glitchFilter.direction = params.direction ?? (Math.random() * 360);
                } else {
                    glitchFilter.seed += 0.01 * dt; // Subtle baseline jitter
                }

                // Fade RGB split with opacity
                const rgbSplit = params.rgbSplit ?? 1.0;
                glitchFilter.red   = [-2 * state.currentOpacityGlitch * rgbSplit,  2 * state.currentOpacityGlitch * rgbSplit];
                glitchFilter.green = [-4 * state.currentOpacityGlitch * rgbSplit,  4 * state.currentOpacityGlitch * rgbSplit];
                glitchFilter.blue  = [ 2 * state.currentOpacityGlitch * rgbSplit, -2 * state.currentOpacityGlitch * rgbSplit];

                screenFilters.push(glitchFilter);
            }

            // --- Blood ---
            if (state.isBloodEnabled || settings.force_blood || state.currentOpacityBlood > 0.005) {
                const params = state.parameters['blood'] || {};
                const bloodTarget = (state.isBloodEnabled || settings.force_blood) ? (params.opacity ?? TARGET_OPACITIES.blood) : 0.0;
                const bFadeSpeed  = state.isBloodEnabled ? 0.05 : 0.15; // Faster fade-out than fade-in
                state.currentOpacityBlood += (bloodTarget - state.currentOpacityBlood) * bFadeSpeed * dt;
                state.elapsedTimeBlood    += dt * 0.016 * (params.speed ?? 1.0);

                const bu = bloodFilter.resources.bloodUniforms.uniforms;
                bu.uOpacity = state.currentOpacityBlood;
                bu.uTime    = state.elapsedTimeBlood * 1000.0;
                bu.uFlipY   = flipValue; // Use the same master flip logic

                bgBloodRect.visible = true;
            } else {
                bgBloodRect.visible = false;
            }

            // --- Shockwave ---
            if (state.isShockwaveEnabled || shockwaveFilter.time < 3.0) {
                const params = state.parameters['shockwave'] || {};
                const speed = params.speed ?? 1.0;
                shockwaveFilter.time += dt * 0.016 * speed;

                if (settings.force_shockwave) {
                    // Loop only in force-enable mode
                    if (shockwaveFilter.time > 2.0) {
                        shockwaveFilter.time   = 0;
                        shockwaveFilter.center = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
                    }
                }

                if (shockwaveFilter.time < 3.0) {
                    shockwaveFilter.amplitude = params.amplitude ?? 30;
                    shockwaveFilter.wavelength = params.wavelength ?? 160;
                    screenFilters.push(shockwaveFilter);
                } else if (state.isShockwaveEnabled && !settings.force_shockwave) {
                    // Kill the trigger flag so it stops rather than looping
                    state.isShockwaveEnabled = false;
                    shockwaveFilter.time     = 10.0;
                }
            }

            // Apply or clear the collected screen filters on the VIEWPORT (not stage!).
            // Applying to stage causes PixiJS to render-to-texture with viewport transforms,
            // which flips the coordinate space for custom shaders inside the viewport.
            pixiApp.viewport.filters = screenFilters.length > 0 ? screenFilters : null;

            // --- Thunder (flashbang) ---
            if (state.isThunderEnabled) {
                state.elapsedTime += dt * 0.016;

                if (!state.isFlashing) {
                    if (state.elapsedTime > state.nextThunderTime) {
                        state.isFlashing            = true;
                        state.nextThunderTime       = state.elapsedTime + 3.0 + (Math.random() * 15.0);
                        state.currentThunderOpacity = 0.8 + (Math.random() * 0.2);
                        bgThunderRect.visible       = true;

                        // 30% chance of a rapid double-flash
                        if (Math.random() > 0.7) {
                            setTimeout(() => {
                                if (bgThunderRect) {
                                    state.currentThunderOpacity = 0.6 + (Math.random() * 0.4);
                                }
                            }, 100 + Math.random() * 150);
                        }
                    }
                } else {
                    state.currentThunderOpacity -= 3.0 * (dt * 0.016);

                    if (state.currentThunderOpacity <= 0.0) {
                        state.currentThunderOpacity = 0.0;
                        state.isFlashing            = false;
                        bgThunderRect.visible       = false;
                    }
                }

                if (state.isFlashing) {
                    bgThunderRect.alpha = state.currentThunderOpacity;
                }
            } else if (bgThunderRect.visible) {
                // Instantly kill any in-progress flash if thunder is disabled mid-strike
                bgThunderRect.visible       = false;
                state.isFlashing            = false;
                state.currentThunderOpacity = 0.0;
            }

            // --- FadeToBlack (Eyelid) ---
            if (state.isFadeToBlackEnabled || settings.force_fade_to_black || state.currentOpacityFadeToBlack > 0.005 || (state.fadeToBlackProgress || 0) > 0.005) {
                const params = state.parameters['fadetoblack'] || {};
                const target = (state.isFadeToBlackEnabled || settings.force_fade_to_black) ? (params.opacity ?? 1.0) : 0.0;
                
                // Opacity fade
                state.currentOpacityFadeToBlack += (target - state.currentOpacityFadeToBlack) * 0.1 * dt;

                // Progress animation
                if (state.isFadeToBlackEnabled || settings.force_fade_to_black) {
                    state.fadeToBlackProgress = state.fadeToBlackProgress || 0.0;
                    const speed = params.speed ?? 0.05;
                    state.fadeToBlackProgress += (1.0 - state.fadeToBlackProgress) * speed * dt;
                } else {
                    state.fadeToBlackProgress = state.fadeToBlackProgress || 0.0;
                    const speed = params.speed ?? 0.1;
                    state.fadeToBlackProgress += (0.0 - state.fadeToBlackProgress) * speed * dt;
                }

                const eu = fadeToBlackFilter.resources.fadeToBlackUniforms.uniforms;
                eu.uOpacity  = state.currentOpacityFadeToBlack;
                eu.uProgress = state.fadeToBlackProgress;

                bgFadeToBlackRect.visible = true;
            } else {
                bgFadeToBlackRect.visible = false;
                state.fadeToBlackProgress = 0.0;
            }

            // --- Vignette ---
            if (state.isVignetteEnabled || state.currentOpacityVignette > 0.005) {
                const vigTarget = state.isVignetteEnabled ? 1.0 : 0.0;
                state.currentOpacityVignette += (vigTarget - state.currentOpacityVignette) * 0.05 * dt;
                vignetteSprite.alpha   = state.currentOpacityVignette;
                vignetteSprite.visible = true;

                // Dynamically size to the physical screen (stage has no transforms)
                if (pixiApp.app) {
                    vignetteSprite.width  = pixiApp.app.screen.width;
                    vignetteSprite.height = pixiApp.app.screen.height;
                }
            } else {
                vignetteSprite.visible = false;
            }
        };
    }

    window.__VFX = window.__VFX || {};
    window.__VFX.tick = { createVfxTick };
})();

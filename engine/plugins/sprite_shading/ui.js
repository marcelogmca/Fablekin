// Runs inside the renderer via inject-permanent-assets
// context = { PIXI, pixiApp, pixiSpriteManager, state, socket, debugLog, debugError }
(function (context) {
    const { PIXI, pixiApp, pixiSpriteManager, debugLog, debugError } = context;

    window.VN.pixiPlugins.register('sprite_shading', (runtime) => {
        // Cap RT dimensions to avoid GPU MAX_TEXTURE_SIZE issues with high-res sprites.
        const MAX_RT_DIM = 1024;

        const S = {
            enable_blurred_edge: true,
            blurred_edge_blur: 3,
            blurred_edge_opacity: 0.9,
            enable_ambient_lighting: true,
            ambient_lighting_opacity: 0.33,
            ambient_lighting_contrast: 150,
            enable_shadow_shading: true,
            shadow_shading_opacity: 0.33,
            shadow_shading_contrast: 1000,
            shadow_offset_x: 30,
            shadow_offset_y: 30,
            enable_debug_pips: false,
            enable_outline: true,
            outline_thickness: 2,
            outline_color_matching: false,
            outline_color: '#000000',
            enable_breathing: true,
            breathing_intensity: 0.003,
            breathing_speed: 3.5,
            breathing_randomness: 20,
            debug_logs: false,
        };

        function syncSettings(incomingSettings = null) {
            const pluginSettings = incomingSettings ||
                context.state?.vnSettings?.plugins?.sprite_shading ||
                context.state?.vnSettings?.sprite_shading ||
                context.state?.sprite_shading;
            if (!pluginSettings || typeof pluginSettings !== 'object') return false;

            Object.assign(S, pluginSettings);

            if (incomingSettings && context.state) {
                context.state.vnSettings = context.state.vnSettings || {};
                context.state.vnSettings.plugins = context.state.vnSettings.plugins || {};
                context.state.vnSettings.plugins.sprite_shading = {
                    ...(context.state.vnSettings.plugins.sprite_shading || {}),
                    ...pluginSettings,
                };
            }

            return true;
        }

        function applySettingsUpdate(pluginSettings, source) {
            if (!syncSettings(pluginSettings)) return;
            debugLog(`[sprite_shading] Received live settings update (${source})`, pluginSettings);
            for (const [charName, charObj] of Object.entries(pixiSpriteManager.activeSprites)) {
                rebuildEffectsForChar(charName, charObj, source);
            }
        }

        const effects = {};
        const retiredEffects = new Set();
        const RETIRED_EFFECT_LIFETIME_MS = 1000;
        const WORLD_STATE_EPSILON = 0.01;
        let nextFxDebugId = 1;
        let nextBodyDebugId = 1;
        const deferredDisposeQueue = [];
        let deferredDisposeHook = null;

        function enqueueDeferredDispose(fn) {
            if (typeof fn !== 'function') return;
            deferredDisposeQueue.push(fn);
        }

        function flushDeferredDisposals() {
            if (!deferredDisposeQueue.length) return;
            const tasks = deferredDisposeQueue.splice(0, deferredDisposeQueue.length);
            for (const task of tasks) {
                try { task(); } catch { }
            }
        }

        function installDeferredDisposeHook() {
            if (deferredDisposeHook) return;
            deferredDisposeHook = () => flushDeferredDisposals();
            pixiApp.hooks.addPostRender(deferredDisposeHook);
        }

        function uninstallDeferredDisposeHook() {
            if (!deferredDisposeHook) return;
            removeHook(deferredDisposeHook);
            deferredDisposeHook = null;
        }

        function getDebugFilter() {
            const raw = window.__spriteShadingDebugChar;
            return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        }

        function shouldLogChar(charName) {
            const filter = getDebugFilter();
            if (!filter && S.debug_logs !== true) return false;
            if (!filter) return true;
            return (charName || '').toLowerCase() === filter;
        }

        function getBodyDebugId(body) {
            if (!body) return 'body:none';
            if (!body.__spriteShadingDebugId) {
                body.__spriteShadingDebugId = `body#${nextBodyDebugId++}`;
            }
            return body.__spriteShadingDebugId;
        }

        function logCharState(charName, message, data = null) {
            if (!shouldLogChar(charName)) return;
            debugLog(`[sprite_shading][${charName}] ${message}`, data);
        }

        function summarizeFx(fx, charObj) {
            const ownerBody = fx?.ownerBody || null;
            const currentBody = charObj?.body || null;
            return {
                fxId: fx?.debugId || null,
                ownerBody: getBodyDebugId(ownerBody),
                currentBody: getBodyDebugId(currentBody),
                ownerMatchesCurrent: !!ownerBody && !!currentBody && ownerBody === currentBody,
                mounted: !!fx?.displayObjectsMounted,
                retired: !!fx?.retired,
                canDoWorldFX: !!fx?.canDoWorldFX,
                needsWorldFX: !!fx?.needsWorldFX,
                dirtySilhouette: !!fx?.dirtySilhouette,
                dirtyWorld: !!fx?.dirtyWorld,
                forceSilhouetteRefreshFrames: fx?.forceSilhouetteRefreshFrames || 0,
                forceWorldRefreshFrames: fx?.forceWorldRefreshFrames || 0,
                preRenderRuns: fx?.preRenderRuns || 0,
                bodyChildren: currentBody?.children?.length ?? 0,
                bodyVisible: currentBody?.visible,
                bodyAlpha: currentBody?.alpha,
                containerAlpha: charObj?.container?.alpha,
                baseAlpha: charObj?.layers?.base?.alpha,
                baseVisible: charObj?.layers?.base?.visible,
                bgSnapshotReady: !!fx?.bgSnapshotTexture && !fx.bgSnapshotTexture.destroyed,
                outlineAttached: hasAttachedDisplayObject(fx?.outline, ownerBody),
                glowAttached: hasAttachedDisplayObject(fx?.glow, ownerBody),
                ambientAttached: hasAttachedDisplayObject(fx?.ambientOverlay, ownerBody),
                shadowAttached: hasAttachedDisplayObject(fx?.shadowOverlay, ownerBody),
            };
        }

        function logFxState(charName, phase, fx, charObj, extra = null) {
            if (!shouldLogChar(charName)) return;
            const payload = { ...summarizeFx(fx, charObj) };
            if (extra && typeof extra === 'object') Object.assign(payload, extra);
            logCharState(charName, phase, payload);
        }

        function textureMb(texture) {
            const width = Number(texture?.width) || 0;
            const height = Number(texture?.height) || 0;
            return width && height ? (width * height * 4) / (1024 * 1024) : 0;
        }

        function getEffectRenderTextures(fx) {
            if (!fx) return [];
            return [
                ['bodyRT', fx.bodyRT],
                ['charBgRT', fx.charBgRT],
                ['bodyRTIdentity', fx.bodyRTIdentity],
                ['filteredMaskRT', fx.filteredMaskRT],
                ['processedBgRT', fx.processedBgRT],
                ['ambientBgRT', fx.ambientBgRT],
                ['outlineRT', fx.outlineRT]
            ].filter(([, rt]) => rt && rt.destroyed !== true);
        }

        function summarizeEffectMemory(fx) {
            const renderTextures = getEffectRenderTextures(fx).map(([name, rt]) => ({
                name,
                width: Number(rt?.width) || 0,
                height: Number(rt?.height) || 0,
                approxRgbaMb: Number(textureMb(rt).toFixed(1))
            }));
            return {
                charName: fx?.charName || '',
                debugId: fx?.debugId || '',
                retired: fx?.retired === true,
                canDoWorldFX: fx?.canDoWorldFX === true,
                rtW: fx?.rtW || 0,
                rtH: fx?.rtH || 0,
                renderTextureCount: renderTextures.length,
                approxRgbaMb: Number(renderTextures.reduce((sum, item) => sum + item.approxRgbaMb, 0).toFixed(1)),
                renderTextures
            };
        }

        function getSpriteShadingMemoryDebug() {
            const active = Object.values(effects).map(summarizeEffectMemory);
            const retired = Array.from(retiredEffects).map(summarizeEffectMemory);
            const all = [...active, ...retired];
            return {
                maxRenderTextureDim: MAX_RT_DIM,
                activeEffects: active.length,
                retiredEffects: retired.length,
                deferredDisposeQueue: deferredDisposeQueue.length,
                approxRgbaMb: Number(all.reduce((sum, item) => sum + item.approxRgbaMb, 0).toFixed(1)),
                active,
                retired
            };
        }

        window.__spriteShadingMemoryDebug = getSpriteShadingMemoryDebug;



        // ─── Cleanup ──────────────────────────────────────────────────────────────

        function removeHook(fn) {
            if (fn) pixiApp.hooks.remove(fn);
        }

        function destroyDisplayObject(displayObject) {
            if (!displayObject) return;
            try { displayObject.renderable = false; } catch { }
            try { displayObject.visible = false; } catch { }
            try { displayObject.filters = null; } catch { }
            try { displayObject.mask = null; } catch { }
            if (PIXI?.Texture?.EMPTY && ('texture' in displayObject)) {
                try { displayObject.texture = PIXI.Texture.EMPTY; } catch { }
            }
            enqueueDeferredDispose(() => {
                if (displayObject.parent) {
                    try { displayObject.parent.removeChild(displayObject); } catch { }
                }
                if (!displayObject.destroyed) {
                    try {
                        displayObject.destroy({ children: true, texture: false, baseTexture: false });
                    } catch { }
                }
            });
        }

        function destroyRenderTexture(renderTexture) {
            if (!renderTexture || renderTexture.destroyed) return;
            enqueueDeferredDispose(() => {
                if (!renderTexture.destroyed) {
                    renderTexture.destroy(true);
                }
            });
        }

        function destroyFilter(filter) {
            if (!filter || filter.destroyed) return;
            enqueueDeferredDispose(() => {
                if (filter.destroyed) return;
                try {
                    filter.destroy();
                } catch { }
            });
        }

        function isLiveDisplayObject(displayObject) {
            return !!displayObject
                && displayObject.destroyed !== true
                && !!displayObject.position
                && !!displayObject.scale;
        }

        function isRenderableCharObj(charObj) {
            return !!charObj
                && charObj.isDestroying !== true
                && isLiveDisplayObject(charObj.container)
                && isLiveDisplayObject(charObj.body)
                && !!charObj.layers?.base?.texture
                && charObj.layers.base.texture.destroyed !== true;
        }

        function stopBreathingTween(fx, resetScale = true) {
            if (!fx) return;
            if (fx.breathTween) {
                try { fx.breathTween.kill(); } catch { }
                fx.breathTween = null;
            }
            if (fx.breathTarget?.scale) {
                try { gsap.killTweensOf(fx.breathTarget.scale); } catch { }
            }
            if (resetScale && isLiveDisplayObject(fx.ownerBody)) {
                const scaleX = Number.isFinite(fx.breathBaseScaleX) ? fx.breathBaseScaleX : 1;
                const scaleY = Number.isFinite(fx.breathBaseScaleY) ? fx.breathBaseScaleY : 1;
                fx.ownerBody.scale.set(scaleX, scaleY);
            }
            fx.breathTarget = null;
        }

        function createMaskFilter(maskSprite) {
            const filter = new PIXI.MaskFilter({ sprite: maskSprite });
            filter.padding = 0;
            return filter;
        }

        function syncSilhouetteSourceSprite(sourceSprite, baseLayer) {
            if (!sourceSprite || !baseLayer) return;
            sourceSprite.texture = baseLayer.texture;
            sourceSprite.anchor.copyFrom(baseLayer.anchor);
            sourceSprite.position.copyFrom(baseLayer.position);
            sourceSprite.scale.copyFrom(baseLayer.scale);
            sourceSprite.skew.copyFrom(baseLayer.skew);
            sourceSprite.pivot.copyFrom(baseLayer.pivot);
            sourceSprite.rotation = baseLayer.rotation;
            sourceSprite.visible = true;
            sourceSprite.renderable = true;
            sourceSprite.alpha = 1;
            sourceSprite.tint = 0xFFFFFF;
        }

        function destroyEffectSet(fx, reason = 'destroy') {
            if (!fx) return;

            logFxState(fx.charName, `destroy:${reason}`, fx, fx.charObj);

            fx.displayObjectsMounted = false;
            removeHook(fx.preRenderHook);
            fx.preRenderHook = null;
            retiredEffects.delete(fx);
            stopBreathingTween(fx);

            if (fx.debugContainer) {
                try { pixiApp.app?.stage.removeChild(fx.debugContainer); } catch { }
            }

            if (fx.bgSampleSprite && fx.bgCompositeContainer) {
                try { fx.bgCompositeContainer.removeChild(fx.bgSampleSprite); } catch { }
            }

            destroyDisplayObject(fx.glow);
            destroyDisplayObject(fx.outline);
            destroyDisplayObject(fx.ambientOverlay);
            destroyDisplayObject(fx.shadowOverlay);
            destroyDisplayObject(fx.silhouetteSourceSprite);
            destroyDisplayObject(fx.tempMaskSprite);
            destroyDisplayObject(fx.tempProcessedSprite);
            destroyDisplayObject(fx.tempAmbientSprite);
            destroyDisplayObject(fx.bgMaskSprite);
            destroyDisplayObject(fx.bgSampleSprite);
            destroyDisplayObject(fx.bgCompositeContainer);
            destroyDisplayObject(fx.debugContainer);
            destroyFilter(fx.shadowMaskFilter);
            destroyFilter(fx.ambientMaskFilter);

            destroyRenderTexture(fx.bodyRT);
            destroyRenderTexture(fx.charBgRT);
            destroyRenderTexture(fx.bodyRTIdentity);
            destroyRenderTexture(fx.filteredMaskRT);
            destroyRenderTexture(fx.processedBgRT);
            destroyRenderTexture(fx.ambientBgRT);
            destroyRenderTexture(fx.outlineRT);

            if (effects[fx.charName] === fx) {
                delete effects[fx.charName];
            }

            fx.charObj = null;
            fx.ownerBody = null;
            fx.baseTexture = null;
            fx.bgSnapshotTexture = null;
            fx.lastWorldState = null;
            fx.breathTarget = null;
            fx.glow = null;
            fx.outline = null;
            fx.ambientOverlay = null;
            fx.shadowOverlay = null;
            fx.silhouetteSourceSprite = null;
            fx.tempMaskSprite = null;
            fx.tempProcessedSprite = null;
            fx.tempAmbientSprite = null;
            fx.bgMaskSprite = null;
            fx.bgSampleSprite = null;
            fx.bgCompositeContainer = null;
            fx.debugContainer = null;
            fx.shadowMaskFilter = null;
            fx.ambientMaskFilter = null;
            fx.bodyRT = null;
            fx.charBgRT = null;
            fx.bodyRTIdentity = null;
            fx.filteredMaskRT = null;
            fx.processedBgRT = null;
            fx.ambientBgRT = null;
            fx.outlineRT = null;
        }

        function retireEffectSet(fx, reason = 'retire') {
            if (!fx || fx.retired) return;

            logFxState(fx.charName, `retire:${reason}`, fx, fx.charObj);

            fx.retired = true;
            fx.displayObjectsMounted = false;
            removeHook(fx.preRenderHook);
            fx.preRenderHook = null;

            // Kill any local animations immediately so they don't fight with the new effect set
            stopBreathingTween(fx, false);

            retiredEffects.add(fx);

            window.setTimeout(() => {
                if (retiredEffects.has(fx)) {
                    enqueueDeferredDispose(() => {
                        if (retiredEffects.has(fx)) {
                            destroyEffectSet(fx, `${reason}:timeout`);
                        }
                    });
                }
            }, RETIRED_EFFECT_LIFETIME_MS);
        }

        function getBodyWorldState(charObj, ownerBody) {
            const container = charObj?.container;
            const body = ownerBody || charObj?.body;
            const containerScaleX = container?.scale?.x ?? 1;
            const containerScaleY = container?.scale?.y ?? containerScaleX;
            const bodyScaleX = body?.scale?.x ?? 1;
            const bodyScaleY = body?.scale?.y ?? 1;

            return {
                x: (container?.x ?? 0) + ((body?.x ?? 0) * containerScaleX),
                y: (container?.y ?? 0) + ((body?.y ?? 0) * containerScaleY),
                scaleX: containerScaleX * bodyScaleX,
                scaleY: containerScaleY * bodyScaleY,
                rotation: body?.rotation ?? 0,
            };
        }

        function hasWorldStateChanged(previousState, nextState) {
            if (!previousState) return true;

            return (
                Math.abs(previousState.x - nextState.x) > WORLD_STATE_EPSILON ||
                Math.abs(previousState.y - nextState.y) > WORLD_STATE_EPSILON ||
                Math.abs(previousState.scaleX - nextState.scaleX) > WORLD_STATE_EPSILON ||
                Math.abs(previousState.scaleY - nextState.scaleY) > WORLD_STATE_EPSILON ||
                Math.abs(previousState.rotation - nextState.rotation) > WORLD_STATE_EPSILON
            );
        }

        function syncBgCompositeTransform(fx, worldState) {
            if (!fx?.bgSampleSprite) return;

            const effectiveScale = Math.max(Math.abs(worldState.scaleX) || 0, 0.0001);
            const mapScale = fx.rtScale / effectiveScale;
            const offX = S.enable_shadow_shading ? (S.shadow_offset_x || 0) : 0;
            const offY = S.enable_shadow_shading ? (S.shadow_offset_y || 0) : 0;

            fx.bgSampleSprite.scale.set(mapScale);
            fx.bgSampleSprite.x = (-worldState.x + offX) * mapScale + fx.rtW / 2;
            fx.bgSampleSprite.y = (-worldState.y + offY) * mapScale + fx.rtH;
        }

        function hasAttachedDisplayObject(displayObject, expectedParent) {
            return !!displayObject && !displayObject.destroyed && displayObject.parent === expectedParent;
        }

        function isEffectSetIntact(fx) {
            if (!fx || fx.retired || !fx.ownerBody || fx.ownerBody.destroyed) return false;
            if (!fx.preRenderHook) return false;
            if (!fx.bodyRT || fx.bodyRT.destroyed) return false;

            const liveBgSnapshot = fx.needsWorldFX ? window.VN?.background.getSnapshot() : null;
            if (fx.needsWorldFX && !fx.canDoWorldFX && liveBgSnapshot && !liveBgSnapshot.destroyed) {
                return false;
            }

            if (S.enable_outline && !hasAttachedDisplayObject(fx.outline, fx.ownerBody)) return false;
            if (S.enable_blurred_edge && !hasAttachedDisplayObject(fx.glow, fx.ownerBody)) return false;

            if (fx.canDoWorldFX) {
                if (!fx.bgSnapshotTexture || fx.bgSnapshotTexture.destroyed) return false;
                if (!fx.bgSampleSprite || fx.bgSampleSprite.destroyed) return false;
                if (!fx.charBgRT || fx.charBgRT.destroyed) return false;
                if (!fx.filteredMaskRT || fx.filteredMaskRT.destroyed) return false;
                if (!fx.processedBgRT || fx.processedBgRT.destroyed) return false;
                if (!fx.ambientBgRT || fx.ambientBgRT.destroyed) return false;
                if (S.enable_ambient_lighting && !hasAttachedDisplayObject(fx.ambientOverlay, fx.ownerBody)) return false;
                if (S.enable_shadow_shading && !hasAttachedDisplayObject(fx.shadowOverlay, fx.ownerBody)) return false;
            }

            return true;
        }

        function ensureEffectsForChar(charName, charObj, source = 'unknown') {
            if (!isRenderableCharObj(charObj)) {
                logCharState(charName, `ensure:${source}:invalid_char_obj`, {
                    hasCharObj: !!charObj,
                    isDestroying: charObj?.isDestroying === true,
                    hasContainer: !!charObj?.container,
                    containerDestroyed: charObj?.container?.destroyed === true,
                    hasBody: !!charObj?.body,
                    bodyDestroyed: charObj?.body?.destroyed === true,
                    hasBaseTexture: !!charObj?.layers?.base?.texture
                });
                clearEffectsForChar(charName, `invalid_char_obj:${source}`);
                return null;
            }
            const currentFx = effects[charName];
            if (currentFx) {
                currentFx.charObj = charObj;
                if (currentFx.ownerBody === charObj.body) {
                    const intact = isEffectSetIntact(currentFx);
                    logFxState(charName, `ensure:${source}`, currentFx, charObj, { intact });
                    if (intact) {
                        return currentFx;
                    }
                    destroyEffectSet(currentFx, `ensure_not_intact:${source}`);
                } else {
                    logFxState(charName, `ensure:${source}:body_mismatch`, currentFx, charObj);
                    retireEffectSet(currentFx, `body_mismatch:${source}`);
                }
            } else {
                logCharState(charName, `ensure:${source}:no_current_fx`, {
                    currentBody: getBodyDebugId(charObj?.body),
                    bodyChildren: charObj?.body?.children?.length ?? 0,
                    spritePath: charObj?.spritePath || null,
                });
            }
            return applyEffectsToChar(charName, charObj, false, source);
        }
        function rebuildEffectsForChar(charName, charObj, source = 'rebuild') {
            logCharState(charName, `rebuild:${source}`, {
                currentBody: getBodyDebugId(charObj?.body),
                spritePath: charObj?.spritePath || null,
            });
            clearEffectsForChar(charName, `rebuild:${source}`);
            return applyEffectsToChar(charName, charObj, true, `rebuild:${source}`); // skipDelay=true for settings refreshes
        }

        function clearEffectsForChar(charName, source = 'clear') {
            const fx = effects[charName];
            if (fx) destroyEffectSet(fx, source);

            for (const retiredFx of Array.from(retiredEffects)) {
                if (retiredFx.charName === charName) {
                    destroyEffectSet(retiredFx, `${source}:retired`);
                }
            }
            return;
        }

        // ─── Apply ────────────────────────────────────────────────────────────────

        function applyEffectsToChar(charName, charObj, skipDelay = false, source = 'apply') {
            if (!isRenderableCharObj(charObj)) return null;
            debugLog(`[sprite_shading] Applying to ${charName} (skipDelay=${skipDelay})`);
            syncSettings();

            const charEffects = {
                charName,
                charObj,
                ownerBody: charObj.body,
                debugId: `fx#${nextFxDebugId++}`,
                rtScale: 0,
                rtW: 0,
                rtH: 0,
                dirtySilhouette: true,
                dirtyWorld: false,
                lastWorldRenderAt: 0,
                lastWorldState: null,
                displayObjectsMounted: false,
                retired: false,
                needsWorldFX: false,
                bgSnapshotTexture: null,
                forceSilhouetteRefreshFrames: 0,
                forceWorldRefreshFrames: 0,
                preRenderRuns: 0,
                lastSkipReason: null,
                breathTween: null,
                breathTarget: null,
                breathBaseScaleX: 1,
                breathBaseScaleY: 1,
            };
            effects[charName] = charEffects;
            logCharState(charName, `apply:start:${source}`, {
                fxId: charEffects.debugId,
                ownerBody: getBodyDebugId(charObj.body),
                spritePath: charObj?.spritePath || null,
                skipDelay,
            });

            // --- RT dimensions (capped) ------------------------------------------
            const texW = charObj.layers.base.texture.width;
            const texH = charObj.layers.base.texture.height;
            const rtScale = Math.min(1.0, MAX_RT_DIM / Math.max(texW, texH));
            const rtW = Math.ceil(texW * rtScale);
            const rtH = Math.ceil(texH * rtScale);
            charEffects.rtScale = rtScale;
            charEffects.rtW = rtW;
            charEffects.rtH = rtH;
            debugLog(`[sprite_shading] ${charName}: tex=${texW}x${texH} rt=${rtW}x${rtH} rtScale=${rtScale.toFixed(4)}`);

            // --- Owned RenderTextures --------------------------------------------
            const bodyRT = PIXI.RenderTexture.create({ width: rtW, height: rtH });
            charEffects.bodyRT = bodyRT;
            charEffects.baseTexture = charObj.layers.base.texture;
            const silhouetteSourceSprite = new PIXI.Sprite(charObj.layers.base.texture);
            syncSilhouetteSourceSprite(silhouetteSourceSprite, charObj.layers.base);
            charEffects.silhouetteSourceSprite = silhouetteSourceSprite;

            const needsWorldFX = S.enable_ambient_lighting || S.enable_shadow_shading;
            const bgSnapshot = window.VN?.background.getSnapshot();
            const canDoWorldFX = needsWorldFX && !!bgSnapshot && !bgSnapshot.destroyed;
            charEffects.needsWorldFX = needsWorldFX;
            charEffects.canDoWorldFX = canDoWorldFX;
            charEffects.dirtyWorld = canDoWorldFX;
            charEffects.bgSnapshotTexture = bgSnapshot || null;
            logFxState(charName, `apply:worldfx:${source}`, charEffects, charObj, {
                snapshotAvailable: !!bgSnapshot,
                snapshotDestroyed: !!bgSnapshot?.destroyed,
            });

            const charBgRT = canDoWorldFX
                ? PIXI.RenderTexture.create({ width: rtW, height: rtH })
                : null;
            charEffects.charBgRT = charBgRT;

            const filteredMaskRT = canDoWorldFX
                ? PIXI.RenderTexture.create({ width: rtW, height: rtH })
                : null;
            charEffects.filteredMaskRT = filteredMaskRT;

            // processedBgRT is now REQUIRED for the actual shadow overlay, not just debugging.
            const processedBgRT = canDoWorldFX
                ? PIXI.RenderTexture.create({ width: rtW, height: rtH })
                : null;
            charEffects.processedBgRT = processedBgRT;

            // ambientBgRT holds the saturated, blurred background for the tint map overlay
            const ambientBgRT = canDoWorldFX
                ? PIXI.RenderTexture.create({ width: rtW, height: rtH })
                : null;
            charEffects.ambientBgRT = ambientBgRT;


            // --- Transform matrices (computed once per effect lifetime) ----------
            //
            // Container position/scale is set synchronously by updateSprites() before
            // vn:pixi-sprite-ready fires, and only changes when updateSprites() runs
            // again — which triggers applyEffectsToChar to rebuild. So these values
            // are stable for the entire lifetime of this effect set.

            // bodyOffsetMatrix:
            //   Renders charObj.body (sprites with anchor 0.5,1 at local origin)
            //   into bodyRT so the silhouette fills the RT exactly.
            //   Derivation:
            //     Sprite local corner (-texW/2, -texH) → scale → (-rtW/2, -rtH) → translate → (0,0) ✓
            //     Sprite local corner (+texW/2,     0) → scale → (+rtW/2,     0) → translate → (rtW, rtH) ✓
            const bodyOffsetMatrix = new PIXI.Matrix()
                .scale(rtScale, rtScale)
                .translate(rtW / 2, rtH);

            // bgSampleMatrix:
            //   Renders the bgSnapshot (1920×1080 logical canvas) into charBgRT
            //   so that ONLY the region behind this character fills the RT.
            //
            //   Character logical bounds:
            //     left  = cx - texW/2·cs      right  = cx + texW/2·cs
            //     top   = cy - texH·cs        bottom = cy
            //
            //   We want: logical pixel (px,py) → RT ((px−cx)·mapScale + rtW/2, (py−cy)·mapScale + rtH)
            //   where mapScale = rtScale / cs  (accounts for both "shrink to RT" and "undo cs")
            //
            //   Verification:
            //     (cx, cy)                  → (0·mapScale + rtW/2, 0·mapScale + rtH) = (rtW/2, rtH) ✓ bottom-center
            const cs = charObj.container.scale.x;
            const cx = charObj.container.x;
            const cy = charObj.container.y;
            const mapScale = rtScale / cs;

            // bgSampleSprite: wraps the live bgSnapshotTexture (updated every frame
            // by pixi_renderer._refreshBgSnapshot).
            const bgSampleSprite = bgSnapshot ? new PIXI.Sprite(bgSnapshot) : null;
            charEffects.bgSampleSprite = bgSampleSprite;

            let bgCompositeContainer = null;
            let tempMaskSprite = null;
            let finalMaskSprite = null;

            if (canDoWorldFX) {
                bgCompositeContainer = new PIXI.Container();
                if (bgSampleSprite) {
                    // Apply the transformation directly to the sprite using position and scale.
                    // Offset is applied here to simulate 3D depth for the shadow.
                    const offX = S.enable_shadow_shading ? (S.shadow_offset_x || 0) : 0;
                    const offY = S.enable_shadow_shading ? (S.shadow_offset_y || 0) : 0;

                    bgSampleSprite.scale.set(mapScale);
                    bgSampleSprite.x = (-cx + offX) * mapScale + rtW / 2;
                    bgSampleSprite.y = (-cy + offY) * mapScale + rtH;

                    bgCompositeContainer.addChild(bgSampleSprite);

                    finalMaskSprite = new PIXI.Sprite(filteredMaskRT);
                    finalMaskSprite.anchor.set(0, 0);
                    finalMaskSprite.position.set(0, 0);
                    charEffects.bgMaskSprite = finalMaskSprite;

                    // Set up the temporary sprite that will bake the binary silhouette mask.
                    tempMaskSprite = new PIXI.Sprite(bodyRT);
                    const binaryFilter = new PIXI.ColorMatrixFilter();
                    binaryFilter.matrix = [
                        0, 0, 0, 0, 1, // R = 1
                        0, 0, 0, 0, 1, // G = 1
                        0, 0, 0, 0, 1, // B = 1
                        0, 0, 0, 255, -2   // A: Map values > ~0.01 to 1 instead of requiring 1.0 (prevents holes on soft edges)
                    ];
                    tempMaskSprite.filters = [binaryFilter];
                }
                charEffects.bgCompositeContainer = bgCompositeContainer;
                charEffects.tempMaskSprite = tempMaskSprite;
            }

            let tempProcessedSprite = null;
            let tempAmbientSprite = null;

            if (canDoWorldFX) {
                const shadowMaskFilter = createMaskFilter(finalMaskSprite);
                charEffects.shadowMaskFilter = shadowMaskFilter;
                tempProcessedSprite = new PIXI.Sprite(charBgRT);
                const cmShadow = new PIXI.ColorMatrixFilter();

                // Replicate Paint.NET "Max Contrast" -> pure black and white threshold
                const m = (S.shadow_shading_contrast || 1000) / 100;
                const bias = 0.5 - 0.5 * m;

                cmShadow.matrix = [
                    0.3 * m, 0.59 * m, 0.11 * m, 0, bias,
                    0.3 * m, 0.59 * m, 0.11 * m, 0, bias,
                    0.3 * m, 0.59 * m, 0.11 * m, 0, bias,
                    0, 0, 0, 1, 0
                ];

                const blurShadow = new PIXI.BlurFilter({ strength: 6 });
                tempProcessedSprite.filters = [shadowMaskFilter, cmShadow, blurShadow];

                const ambientMaskFilter = createMaskFilter(finalMaskSprite);
                charEffects.ambientMaskFilter = ambientMaskFilter;
                tempAmbientSprite = new PIXI.Sprite(charBgRT);
                const cmAmbient = new PIXI.ColorMatrixFilter();

                // Replicate Paint.NET "Saturation increase"
                cmAmbient.saturate((S.ambient_lighting_saturation || 200) / 100, false);
                const blurAmbient = new PIXI.BlurFilter({ strength: 12 }); // Heavier blur for sweeping ambient colors

                tempAmbientSprite.filters = [ambientMaskFilter, cmAmbient, blurAmbient];
            }
            charEffects.tempProcessedSprite = tempProcessedSprite;
            charEffects.tempAmbientSprite = tempAmbientSprite;


            // --- Pre-render hook -------------------------------------------------
            const preRenderHook = () => {
                try {
                    charEffects.preRenderRuns += 1;

                    let skipReason = null;
                    if (!pixiApp.app?.renderer || !charEffects.ownerBody) skipReason = 'renderer_or_owner_missing';
                    else if (charObj.destroyed || charObj.isDestroying || bodyRT.destroyed || charEffects.retired) skipReason = 'char_or_rt_invalid';
                    else if (effects[charName] !== charEffects || charObj.body !== charEffects.ownerBody) skipReason = 'stale_fx_or_body_mismatch';
                    if (skipReason) {
                        if (charEffects.lastSkipReason !== skipReason) {
                            charEffects.lastSkipReason = skipReason;
                            logFxState(charName, `prerender:skip:${skipReason}`, charEffects, charObj);
                        }
                        return;
                    }
                    charEffects.lastSkipReason = null;

                    const liveBgSnapshot = charEffects.needsWorldFX ? window.VN?.background.getSnapshot() : null;
                    if (charEffects.needsWorldFX && !charEffects.canDoWorldFX) {
                        if (liveBgSnapshot && !liveBgSnapshot.destroyed) {
                            debugLog(`[sprite_shading] ${charName}: background snapshot became available, rebuilding world FX`);
                            logFxState(charName, 'prerender:rebuild_snapshot_now_available', charEffects, charObj);
                            rebuildEffectsForChar(charName, charObj, 'snapshot_now_available');
                            return;
                        }
                    } else if (charEffects.canDoWorldFX && liveBgSnapshot && !liveBgSnapshot.destroyed) {
                        if (charEffects.bgSnapshotTexture !== liveBgSnapshot) {
                            charEffects.bgSnapshotTexture = liveBgSnapshot;
                            if (charEffects.bgSampleSprite) {
                                charEffects.bgSampleSprite.texture = liveBgSnapshot;
                            }
                            charEffects.dirtyWorld = true;
                            charEffects.forceWorldRefreshFrames = 2;
                            logFxState(charName, 'prerender:snapshot_rebound', charEffects, charObj);
                        }
                    }

                    if (charEffects.displayObjectsMounted && !isEffectSetIntact(charEffects)) {
                        debugLog(`[sprite_shading] ${charName}: effect nodes detached, rebuilding`);
                        logFxState(charName, 'prerender:rebuild_not_intact', charEffects, charObj);
                        rebuildEffectsForChar(charName, charObj, 'not_intact');
                        return;
                    }

                    const worldState = getBodyWorldState(charObj, charEffects.ownerBody);
                    const now = performance.now();
                    if (charEffects.baseTexture !== charObj.layers.base.texture) {
                        charEffects.baseTexture = charObj.layers.base.texture;
                        syncSilhouetteSourceSprite(charEffects.silhouetteSourceSprite, charObj.layers.base);
                        charEffects.dirtySilhouette = true;
                        charEffects.dirtyWorld = true;
                        charEffects.forceSilhouetteRefreshFrames = 2;
                        charEffects.forceWorldRefreshFrames = 2;
                        logFxState(charName, 'prerender:base_texture_changed', charEffects, charObj);
                    }

                    if ((charEffects.forceSilhouetteRefreshFrames || 0) > 0) {
                        charEffects.dirtySilhouette = true;
                    }

                    if (canDoWorldFX && hasWorldStateChanged(charEffects.lastWorldState, worldState)) {
                        syncBgCompositeTransform(charEffects, worldState);
                        charEffects.lastWorldState = { ...worldState };
                        charEffects.dirtyWorld = true;
                    }

                    if (canDoWorldFX && (charEffects.forceWorldRefreshFrames || 0) > 0) {
                        charEffects.dirtyWorld = true;
                    }

                    if (canDoWorldFX && (now - (charEffects.lastWorldRenderAt || 0)) >= 33) {
                        charEffects.dirtyWorld = true;
                    }

                    if (charEffects.dirtySilhouette) {
                        // Render only the base body silhouette so talk/blink swaps do not
                        // thrash the outline/blur textures.
                        syncSilhouetteSourceSprite(charEffects.silhouetteSourceSprite, charObj.layers.base);
                        pixiApp.app.renderer.render({
                            container: charEffects.silhouetteSourceSprite,
                            target: bodyRT,
                            clear: true,
                            transform: bodyOffsetMatrix,
                        });

                        if (charEffects.tempMaskSprite && filteredMaskRT && !filteredMaskRT.destroyed) {
                            pixiApp.app.renderer.render({
                                container: charEffects.tempMaskSprite,
                                target: filteredMaskRT,
                                clear: true,
                            });
                        }

                        charEffects.dirtySilhouette = false;
                        if ((charEffects.forceSilhouetteRefreshFrames || 0) > 0) {
                            charEffects.forceSilhouetteRefreshFrames -= 1;
                        }
                        if (canDoWorldFX) {
                            charEffects.dirtyWorld = true;
                        }
                        if (charEffects.preRenderRuns <= 3 || charEffects.forceSilhouetteRefreshFrames > 0) {
                            logFxState(charName, 'prerender:silhouette_rendered', charEffects, charObj);
                        }
                    }

                    if (canDoWorldFX && charEffects.dirtyWorld) {
                        if (!charEffects.lastWorldState) {
                            syncBgCompositeTransform(charEffects, worldState);
                            charEffects.lastWorldState = { ...worldState };
                        }

                        if (charEffects.bgCompositeContainer && charBgRT && !charBgRT.destroyed) {
                            pixiApp.app.renderer.render({
                                container: charEffects.bgCompositeContainer,
                                target: charBgRT,
                                clear: true,
                            });
                        }

                        if (charEffects.tempProcessedSprite && processedBgRT && !processedBgRT.destroyed) {
                            pixiApp.app.renderer.render({
                                container: charEffects.tempProcessedSprite,
                                target: processedBgRT,
                                clear: true,
                            });
                        }

                        if (charEffects.tempAmbientSprite && ambientBgRT && !ambientBgRT.destroyed) {
                            pixiApp.app.renderer.render({
                                container: charEffects.tempAmbientSprite,
                                target: ambientBgRT,
                                clear: true,
                            });
                        }

                        charEffects.dirtyWorld = false;
                        charEffects.lastWorldRenderAt = now;
                        if ((charEffects.forceWorldRefreshFrames || 0) > 0) {
                            charEffects.forceWorldRefreshFrames -= 1;
                        }
                        if (charEffects.preRenderRuns <= 3 || charEffects.forceWorldRefreshFrames > 0) {
                            logFxState(charName, 'prerender:world_rendered', charEffects, charObj);
                        }
                    }

                    if (S.enable_debug_pips && charEffects.bodyRTIdentity && !charEffects.bodyRTIdentity.destroyed) {
                        const sx = charObj.container.scale.x;
                        const sy = charObj.container.scale.y;
                        charObj.container.scale.set(1);
                        pixiApp.app.renderer.render({
                            container: charEffects.ownerBody,
                            target: charEffects.bodyRTIdentity,
                            clear: true,
                            transform: new PIXI.Matrix().scale(rtScale, rtScale).translate(rtW / 2, rtH),
                        });
                        charObj.container.scale.set(sx, sy);
                    }

                    if (S.enable_debug_pips && charEffects.debugLabel) {
                        const charIdx = Object.keys(pixiSpriteManager.activeSprites).indexOf(charName);
                        charEffects.debugContainer.x = charIdx * (rtW * 0.12 * 3 + 60) + 30;
                        charEffects.debugContainer.y = 30;
                        charEffects.debugLabel.text =
                            `${charName}\nNat: ${texW}x${texH}\nRT: ${rtW}x${rtH}\n` +
                            `cs: ${worldState.scaleX.toFixed(3)}  rtScale: ${rtScale.toFixed(3)}`;
                    }
                } catch (error) {
                    debugError(`[sprite_shading] preRenderHook failed for ${charName}`, error);
                    logFxState(charName, 'prerender:error', charEffects, charObj, {
                        errorMessage: error?.message || String(error),
                    });
                }
            };

            // Run after background/VFX snapshot updates so world shading samples the latest frame.
            pixiApp.hooks.addPreRender(preRenderHook, -15);
            charEffects.preRenderHook = preRenderHook;

            // Prime silhouette RTs immediately so outline/blur are ready from frame 1,
            // but let world-light passes wait for ordered pre-render frames.
            syncSilhouetteSourceSprite(charEffects.silhouetteSourceSprite, charObj.layers.base);
            pixiApp.app.renderer.render({
                container: charEffects.silhouetteSourceSprite,
                target: bodyRT,
                clear: true,
                transform: bodyOffsetMatrix,
            });

            if (charEffects.tempMaskSprite && filteredMaskRT && !filteredMaskRT.destroyed) {
                pixiApp.app.renderer.render({
                    container: charEffects.tempMaskSprite,
                    target: filteredMaskRT,
                    clear: true,
                });
            }

            charEffects.dirtySilhouette = false;
            charEffects.dirtyWorld = canDoWorldFX;
            charEffects.lastWorldRenderAt = 0;
            charEffects.forceSilhouetteRefreshFrames = 2;
            charEffects.forceWorldRefreshFrames = canDoWorldFX ? 2 : 0;

            // ─── Effects in LOCAL SPACE (frontFX / backFX) ───────────────────────

            if (canDoWorldFX) {
                // Effects live in frontFX (not body) so blink/talk layer changes
                // don't dirty the container and cause visual jitter. frontFX shares
                // the same local coordinate space as body.
                const addLocalOverlay = (blendMode, opacity, texture) => {
                    const overlay = new PIXI.Sprite(texture);
                    overlay.anchor.set(0.5, 1);
                    // Scale(1/rtScale): in local space this makes the sprite texW × texH,
                    overlay.scale.set(1 / rtScale);
                    overlay.blendMode = blendMode;
                    overlay.alpha = opacity;

                    // NO MASK NEEDED! The background texture is already shaped like the silhouette.

                    // ADD TO BODY: This ensures the overlay follows the GSAP stumble/leaning 
                    // and correctly inherits alpha during morph transitions.
                    charEffects.ownerBody.addChild(overlay);
                    return overlay;
                };

                if (S.enable_ambient_lighting) {
                    charEffects.ambientOverlay = addLocalOverlay(
                        'multiply', S.ambient_lighting_opacity, ambientBgRT
                    );
                }
                if (S.enable_shadow_shading) {
                    charEffects.shadowOverlay = addLocalOverlay(
                        'multiply', S.shadow_shading_opacity, processedBgRT
                    );
                }
            }

            // --- Cel Outline (backFX local space, multi-sprite) ------------------
            if (S.enable_outline) {
                const outlineGroup = new PIXI.Container();
                const colorArr = new PIXI.Color(S.outline_color || '#000000').toArray();

                // 1. ColorMatrixFilter to determine color style
                const cmOutline = new PIXI.ColorMatrixFilter();
                if (S.outline_color_matching) {
                    // Dim the original colors to 40% to make it look like a shaded border
                    cmOutline.brightness(0.4, false);
                } else {
                    // Force to solid target color
                    cmOutline.matrix = [
                        0, 0, 0, 0, colorArr[0],
                        0, 0, 0, 0, colorArr[1],
                        0, 0, 0, 0, colorArr[2],
                        0, 0, 0, 1, 0
                    ];
                }
                outlineGroup.filters = [cmOutline];

                const t = S.outline_thickness || 2;
                const cs = charObj.container.scale.x;

                // 2. Add 8 shifted sprites to expand the mask (manual dilation)
                const angles = [0, 45, 90, 135, 180, 225, 270, 315];
                for (let i = 0; i < angles.length; i++) {
                    const rad = angles[i] * Math.PI / 180;
                    const outlineSprite = new PIXI.Sprite(bodyRT);

                    // Keep exactly the same coordinate mapping as the blur glow effect
                    outlineSprite.anchor.set(0.5, 1);
                    outlineSprite.scale.set(1 / rtScale);

                    // Offset radially based on thickness, accounting for global character scale
                    outlineSprite.position.set(
                        (t * Math.cos(rad)) / cs,
                        (t * Math.sin(rad)) / cs
                    );

                    outlineGroup.addChild(outlineSprite);
                }

                // ADD TO BODY (INDEX 0): Glow and Outline should be behind the character layers.
                // Using addChildAt(0) ensures they render behind the base/blink/talk layers.
                charEffects.ownerBody.addChildAt(outlineGroup, 0);
                charEffects.outline = outlineGroup;
            }

            // --- Blurred glow (body local space, behind sprite) -------------------
            if (S.enable_blurred_edge) {
                const glow = new PIXI.Sprite(bodyRT);
                glow.anchor.set(0.5, 1);
                glow.scale.set(1 / rtScale);
                glow.alpha = S.blurred_edge_opacity;
                glow.filters = [new PIXI.BlurFilter({ strength: S.blurred_edge_blur })];
                // Add to back of the body (at index 0).
                charEffects.ownerBody.addChildAt(glow, 0);
                charEffects.glow = glow;
            }

            // --- Breathing Effect (body local scale) --------------------------
            if (S.enable_breathing) {
                // Using a random delay for regular ready events to prevent characters from breathing in lockstep.
                // skipDelay=true is used when tweaking settings to provide immediate visual feedback.
                const startDelay = skipDelay ? 0 : Math.random() * S.breathing_speed;

                // Apply randomness to duration (variation per character)
                const r = (S.breathing_randomness || 0) / 100;
                const variance = 1 + (Math.random() * 2 - 1) * r;
                const finalDuration = (S.breathing_speed / 2) * variance;

                const breathTarget = charEffects.ownerBody;
                const baseScaleX = Number.isFinite(breathTarget?.scale?.x) ? breathTarget.scale.x : 1;
                const baseScaleY = Number.isFinite(breathTarget?.scale?.y) ? breathTarget.scale.y : 1;
                charEffects.breathTarget = breathTarget;
                charEffects.breathBaseScaleX = baseScaleX;
                charEffects.breathBaseScaleY = baseScaleY;

                // Tween the ObservablePoint directly. Using PixiPlugin here can explode
                // if a scene reset destroys the body before the repeat initializes.
                charEffects.breathTween = gsap.to(breathTarget.scale, {
                    y: baseScaleY * (1 + S.breathing_intensity),
                    x: baseScaleX * (1 + (S.breathing_intensity * 0.3)),
                    duration: finalDuration,
                    ease: "sine.inOut",
                    yoyo: true,
                    repeat: -1,
                    delay: startDelay
                });
                debugLog(`[sprite_shading] Started breathing for ${charName} (intensity=${S.breathing_intensity}, delay=${startDelay.toFixed(2)}s)`);
            }

            // --- Debug PIP thumbnails (on stage, screen space) -------------------
            if (S.enable_debug_pips) {
                const debugContainer = new PIXI.Container();
                const pipScale = Math.min(0.13, 160 / Math.max(rtW, rtH));
                const pipStep = rtW * pipScale + 20;

                const mkPip = (rt, borderColor, slot) => {
                    const pip = new PIXI.Sprite(rt || bodyRT);
                    pip.scale.set(pipScale);
                    pip.x = pipStep * slot;
                    pip.addChild(
                        new PIXI.Graphics()
                            .rect(0, 0, rt ? rt.width : rtW, rt ? rt.height : rtH)
                            .stroke({ width: 36 / pipScale, color: borderColor })
                    );
                    return pip;
                };

                const bodyRTIdentity = PIXI.RenderTexture.create({ width: rtW, height: rtH });
                charEffects.bodyRTIdentity = bodyRTIdentity;

                debugContainer.addChild(
                    mkPip(bodyRT, 0xFFFF00, 0),   // Yellow = silhouette
                    mkPip(bodyRTIdentity, 0xFF0000, 1),   // Red = identity-scale body
                    mkPip(charBgRT, 0x00FF00, 2),   // Green  = bg sample (raw, pre-mask)
                    mkPip(processedBgRT, 0x00FFFF, 3), // Cyan = processed shadow sample
                    mkPip(ambientBgRT, 0xFF00FF, 4)  // Magenta = processed ambient sample
                );

                const debugLabel = new PIXI.Text({
                    text: 'loading...',
                    style: {
                        fontFamily: 'Arial', fontSize: 20, fill: 0xFFFFFF,
                        stroke: { color: 0x000000, width: 4 }
                    },
                });
                debugLabel.y = rtH * pipScale + 4;
                debugContainer.addChild(debugLabel);
                charEffects.debugLabel = debugLabel;

                pixiApp.app.stage.addChild(debugContainer);
                charEffects.debugContainer = debugContainer;
            }

            charEffects.displayObjectsMounted = true;
            logFxState(charName, `apply:mounted:${source}`, charEffects, charObj);
            return charEffects;
        }

        // ─── Event listeners ──────────────────────────────────────────────────────

        runtime.onWindow('vn:pixi-sprite-ready', (e) => ensureEffectsForChar(e.detail.charName, e.detail.charObj, 'sprite-ready'));
        runtime.onWindow('vn:pixi-sprite-updated', (e) => ensureEffectsForChar(e.detail.charName, e.detail.charObj, 'sprite-updated'));
        runtime.onWindow('vn:pixi-sprite-removed', (e) => clearEffectsForChar(e.detail.charName, 'sprite-removed'));

        runtime.onWindow('vn:background-updated', () => {
            for (const n in pixiSpriteManager.activeSprites) {
                const charObj = pixiSpriteManager.activeSprites[n];
                const fx = ensureEffectsForChar(n, charObj, 'background-updated');
                if (!fx) continue;
                const liveBgSnapshot = window.VN?.background.getSnapshot();

                if (fx.needsWorldFX && !fx.canDoWorldFX) {
                    if (liveBgSnapshot && !liveBgSnapshot.destroyed) {
                        rebuildEffectsForChar(n, charObj, 'background-updated_snapshot_available');
                    }
                } else if (fx.canDoWorldFX) {
                    if (liveBgSnapshot && !liveBgSnapshot.destroyed && fx.bgSnapshotTexture !== liveBgSnapshot) {
                        fx.bgSnapshotTexture = liveBgSnapshot;
                        if (fx.bgSampleSprite) {
                            fx.bgSampleSprite.texture = liveBgSnapshot;
                        }
                    }
                    fx.dirtyWorld = true;
                    fx.forceWorldRefreshFrames = 2;
                }
            }
        });

        // Primary live-refresh path, matching vn_pixijs_vfx.
        runtime.onSocket('plugin:settings-updated:sprite_shading', (pluginSettings) => {
            applySettingsUpdate(pluginSettings, 'targeted-settings-updated');
        });

        installDeferredDisposeHook();
        syncSettings();
        debugLog('[sprite_shading] Plugin initialized (local-space mode)');

        // Custom dispose: clean up all active character effects
        runtime.onDispose(() => {
            for (const charName of Object.keys(effects)) {
                clearEffectsForChar(charName, 'plugin-dispose');
            }
            // Also clean up any retired effects
            for (const fx of Array.from(retiredEffects)) {
                destroyEffectSet(fx, 'plugin-dispose:retired');
            }
            flushDeferredDisposals();
            uninstallDeferredDisposeHook();
            if (window.__spriteShadingMemoryDebug === getSpriteShadingMemoryDebug) {
                delete window.__spriteShadingMemoryDebug;
            }
        });

    }); // End of register

})(context);

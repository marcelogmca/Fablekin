import { pixiApp } from './pixi_engine.js';
import { debugLog, debugError, getCharacterNameFromPath, getSpriteCharacterKey, getAssetUrl, normalizeCharacterKey } from './utils.js';
import { state } from './state.js';
import { CharacterShadow, normalizeSpriteShadowConfig } from './pixi_sprite_shadows.js';
import { pixiSpatialStage } from './pixi_spatial_stage.js';

const SPATIAL_STAGE_NOOP_ROLES = new Set(['tiny_in_world', 'group_small']);
const SPATIAL_STAGE_CLOSE_Y = Object.freeze({
    close_subject: 0.86,
    close_support: 0.74
});
const SPATIAL_STAGE_OVER_SHOULDER_Y = Object.freeze({
    over_shoulder_foreground: 0.96,
    over_shoulder_subject: 0.74
});
const OPAQUE_PIXEL_ALPHA_THRESHOLD = 16;
const OPAQUE_BOUNDS_MAX_ANALYSIS_SIZE = 384;
const OPAQUE_BOUNDS_SAMPLE_PADDING = 2;
// Pixi-side negative cache: a sprite path the backend already failed stays
// local-only for this long instead of re-emitting a socket request on every
// texture reload (~1/sec per visible sprite while failing).
const OPAQUE_BOUNDS_NEGATIVE_CACHE_MS = 5 * 60 * 1000;


export const pixiSpriteManager = {
    activeSprites: {}, // { charName: { container, backFX, body, frontFX, layers: { base, blink, talk, talkBlink }, config } }
    pendingLoads: new Map(), // { charName: Promise }
    spriteAssetCache: new Map(), // { url: { texture, loadPromise, lastUsed, unloading, unloadPromise, loadingCount } }
    spriteAssetPruneTimer: null,
    spriteTextureGCTimer: null,
    spriteTransientAssetPins: new Map(), // { url: refCount } for layers being assembled off-stage
    spriteLookaheadAssetUrls: new Set(),
    spriteLookbehindAssetUrls: new Set(),
    spriteAdjacentPreloadToken: 0,
    muppetIntervals: {},
    updateSequence: 0,
    spatialStageHooksReady: false,
    textureOpaqueBounds: new WeakMap(),
    textureOpaqueBoundsPromises: new WeakMap(),
    opaqueBoundsRequestId: 0,
    opaqueBoundsFailedPaths: new Map(),
    gpuPreparedSpriteTextures: new WeakSet(),
    gpuPrepareSpritePromises: new WeakMap(),

    _normalizeOpaqueBoundsNormalized(rawBounds) {
        if (!rawBounds || typeof rawBounds !== 'object') return null;
        const x = Number(rawBounds.x);
        const y = Number(rawBounds.y);
        const width = Number(rawBounds.width);
        const height = Number(rawBounds.height);
        if (![x, y, width, height].every(Number.isFinite)) return null;
        if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
        if (x > 1 || y > 1 || width > 1 || height > 1) return null;
        if ((x + width) > 1.000001 || (y + height) > 1.000001) return null;
        return { x, y, width, height };
    },

    _opaqueBoundsFromNormalized(texture, rawBounds, detected = true) {
        const normalized = this._normalizeOpaqueBoundsNormalized(rawBounds);
        if (!normalized) return null;
        const width = Math.max(1, Math.round(texture?.width || texture?.orig?.width || 1));
        const height = Math.max(1, Math.round(texture?.height || texture?.orig?.height || 1));
        const left = Math.max(0, Math.floor(normalized.x * width));
        const top = Math.max(0, Math.floor(normalized.y * height));
        const right = Math.min(width, Math.ceil((normalized.x + normalized.width) * width));
        const bottom = Math.min(height, Math.ceil((normalized.y + normalized.height) * height));
        return {
            x: left,
            y: top,
            width: Math.max(1, right - left),
            height: Math.max(1, bottom - top),
            detected: detected === true
        };
    },

    _getTextureResource(texture) {
        const resourceCandidates = [
            texture?.source?.resource,
            texture?.source?.resource?.source,
            texture?.source?.source,
            texture?.baseTexture?.resource,
            texture?.baseTexture?.resource?.source,
            texture?.baseTexture?.source
        ].filter(Boolean);
        return resourceCandidates.find(candidate =>
            typeof candidate.width === 'number' && typeof candidate.height === 'number'
        ) || null;
    },

    _computeDownscaledTextureOpaqueBounds(texture) {
        const width = Math.max(1, Math.round(texture?.width || texture?.orig?.width || 1));
        const height = Math.max(1, Math.round(texture?.height || texture?.orig?.height || 1));
        const fullBounds = { x: 0, y: 0, width, height, detected: false };

        try {
            const source = this._getTextureResource(texture);
            if (!source) throw new Error('Texture source pixels are unavailable');

            const analysisScale = Math.min(1, OPAQUE_BOUNDS_MAX_ANALYSIS_SIZE / Math.max(width, height));
            const analysisWidth = Math.max(1, Math.round(width * analysisScale));
            const analysisHeight = Math.max(1, Math.round(height * analysisScale));
            const canvas = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(analysisWidth, analysisHeight)
                : document.createElement('canvas');
            canvas.width = analysisWidth;
            canvas.height = analysisHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('Unable to create a 2D canvas context');
            context.drawImage(source, 0, 0, analysisWidth, analysisHeight);

            const alpha = context.getImageData(0, 0, analysisWidth, analysisHeight).data;
            let minX = analysisWidth;
            let minY = analysisHeight;
            let maxX = -1;
            let maxY = -1;

            for (let y = 0; y < analysisHeight; y++) {
                for (let x = 0; x < analysisWidth; x++) {
                    if (alpha[((y * analysisWidth) + x) * 4 + 3] < OPAQUE_PIXEL_ALPHA_THRESHOLD) continue;
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }

            if (maxX < minX || maxY < minY) return fullBounds;
            minX = Math.max(0, minX - OPAQUE_BOUNDS_SAMPLE_PADDING);
            minY = Math.max(0, minY - OPAQUE_BOUNDS_SAMPLE_PADDING);
            maxX = Math.min(analysisWidth - 1, maxX + OPAQUE_BOUNDS_SAMPLE_PADDING);
            maxY = Math.min(analysisHeight - 1, maxY + OPAQUE_BOUNDS_SAMPLE_PADDING);

            return this._opaqueBoundsFromNormalized(texture, {
                x: minX / analysisWidth,
                y: minY / analysisHeight,
                width: (maxX - minX + 1) / analysisWidth,
                height: (maxY - minY + 1) / analysisHeight
            }, true) || fullBounds;
        } catch (error) {
            debugLog('[SpriteManager] Could not inspect sprite transparency; using full texture bounds.', error?.message || error);
            return fullBounds;
        }
    },

    _getTextureOpaqueBounds(texture) {
        const width = Math.max(1, Math.round(texture?.width || texture?.orig?.width || 1));
        const height = Math.max(1, Math.round(texture?.height || texture?.orig?.height || 1));
        const fullBounds = { x: 0, y: 0, width, height, detected: false };
        if (!texture || typeof texture !== 'object') return fullBounds;

        const cached = this.textureOpaqueBounds.get(texture);
        if (cached) return cached;
        const bounds = this._computeDownscaledTextureOpaqueBounds(texture) || fullBounds;
        this.textureOpaqueBounds.set(texture, bounds);
        return bounds;
    },

    _requestPersistentSpriteOpaqueBounds(spritePath) {
        if (
            !window.socket
            || typeof window.socket.emit !== 'function'
            || typeof window.socket.once !== 'function'
        ) {
            return Promise.resolve(null);
        }
        const requestId = `${Date.now().toString(36)}-${++this.opaqueBoundsRequestId}`;
        const responseEvent = `sprite-opaque-bounds:get-response:${requestId}`;
        return new Promise((resolve) => {
            let settled = false;
            let timer = null;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                window.socket.off?.(responseEvent, finish);
                resolve(result || null);
            };
            timer = setTimeout(() => finish(null), 15000);
            window.socket.once(responseEvent, finish);
            window.socket.emit('sprite-opaque-bounds:get', { spritePath, requestId });
        });
    },

    async _primeTextureOpaqueBounds(texture, spritePath) {
        if (!texture || typeof texture !== 'object') return null;
        const cached = this.textureOpaqueBounds.get(texture);
        if (cached) return cached;
        const pending = this.textureOpaqueBoundsPromises.get(texture);
        if (pending) return pending;

        // Negative cache: if the backend already failed this exact sprite
        // path, skip the socket round-trip and reuse the local analysis
        // instead of re-emitting a request every time the texture reloads.
        const failedKey = String(spritePath || '');
        const failedAt = this.opaqueBoundsFailedPaths?.get(failedKey) || 0;
        if (failedAt && (Date.now() - failedAt) < OPAQUE_BOUNDS_NEGATIVE_CACHE_MS) {
            const fallback = this._computeDownscaledTextureOpaqueBounds(texture);
            this.textureOpaqueBounds.set(texture, fallback);
            return fallback;
        }

        const assetUrl = String(texture.__vnSpriteAssetUrl || '').trim();
        if (assetUrl) this._pinSpriteAssetUrl(assetUrl);
        const work = (async () => {
            try {
                const result = await this._requestPersistentSpriteOpaqueBounds(spritePath);
                const persisted = result?.success
                    ? this._opaqueBoundsFromNormalized(texture, result.boundsNormalized, result.detected)
                    : null;
                if (persisted) {
                    this.textureOpaqueBounds.set(texture, persisted);
                    this.opaqueBoundsFailedPaths?.delete(failedKey);
                    return persisted;
                }
                // Backend answered but without usable bounds: remember the
                // miss so we fall back locally without re-asking each time.
                this.opaqueBoundsFailedPaths?.set(failedKey, Date.now());
            } catch (error) {
                debugLog('[SpriteManager] Persistent sprite bounds unavailable; using local downscaled analysis.', error?.message || error);
                this.opaqueBoundsFailedPaths?.set(failedKey, Date.now());
            }

            const fallback = this._computeDownscaledTextureOpaqueBounds(texture);
            this.textureOpaqueBounds.set(texture, fallback);
            return fallback;
        })().finally(() => {
            this.textureOpaqueBoundsPromises.delete(texture);
            if (assetUrl) this._unpinSpriteAssetUrl(assetUrl);
        });

        this.textureOpaqueBoundsPromises.set(texture, work);
        return work;
    },



    _killTweensOfTarget(target) {
        if (!target || typeof gsap === 'undefined') return;
        try { gsap.killTweensOf(target); } catch { }
    },

    _killAlphaTween(target) {
        if (!target || typeof gsap === 'undefined') return;
        try { gsap.killTweensOf(target, 'alpha'); } catch { }
    },

    _killTweensDeep(displayObject) {
        if (!displayObject) return;

        this._killTweensOfTarget(displayObject);
        this._killTweensOfTarget(displayObject.position);
        this._killTweensOfTarget(displayObject.pivot);
        this._killTweensOfTarget(displayObject.scale);
        this._killTweensOfTarget(displayObject.skew);

        if (Array.isArray(displayObject.children)) {
            for (const child of displayObject.children) {
                this._killTweensDeep(child);
            }
        }
    },

    _isPluginActor(charObj) {
        return !!charObj?.isPluginActor;
    },

    _normalizePluginActorId(rawActorId) {
        const normalized = normalizeCharacterKey(rawActorId);
        if (!normalized) return null;
        if (normalized.startsWith('plugin_actor_')) return normalized;
        return `plugin_actor_${normalized.replace(/[^a-z0-9_]/g, '_')}`;
    },

    _shouldHideMainSprites() {
        const userSettingHidden = state.vnSettings.visuals?.hide_main_sprites === true;
        const lockMap = state.interceptRuntime?.visualLocks?.mainSpritesHideRunIds;
        const hiddenByIntercept = !!(lockMap && Object.keys(lockMap).length > 0);
        return userSettingHidden || hiddenByIntercept;
    },

    _applyMainSpriteVisibility(charObj, hidden) {
        if (!charObj) return;
        const effectiveHidden = hidden && !this._isPluginActor(charObj);

        // Hide the whole character render stack (backFX/body/frontFX + any transitional bodies),
        // not just the active body layer.
        if (charObj.container) {
            charObj.container.visible = !effectiveHidden;
        }
        if (charObj.body) {
            charObj.body.visible = !effectiveHidden;
        }
    },

    _normalizeSpriteEntries(sprites) {
        if (Array.isArray(sprites)) {
            return sprites
                .map((s, idx) => (s ? { ...s, slot: (s.slot !== undefined ? s.slot : idx) } : null))
                .filter(s => s !== null);
        }

        if (sprites && typeof sprites === 'object') {
            const slotOrder = { left: 0, center: 1, right: 2 };
            return Object.keys(sprites)
                .filter(key => sprites[key] && slotOrder[key] !== undefined)
                .map(key => ({
                    ...(typeof sprites[key] === 'object' ? sprites[key] : { path: sprites[key] }),
                    slot: slotOrder[key]
                }));
        }

        return [];
    },

    _getCameraFocusKeyForTurn(currentTurnCharacters, requestedFocusCharacter = undefined) {
        if (requestedFocusCharacter !== undefined) {
            const requestedKey = normalizeCharacterKey(requestedFocusCharacter);
            if (!requestedKey) return null;
            if (currentTurnCharacters && !currentTurnCharacters.has(requestedKey)) return null;
            return requestedKey;
        }

        const targetKey = normalizeCharacterKey(pixiApp.cam?.lastZoomedChar);
        if (!targetKey) return null;
        if (currentTurnCharacters && !currentTurnCharacters.has(targetKey)) return null;
        return targetKey;
    },

    _suppressNonFocusedActorDuringUpdate(charObj, focusKey) {
        if (!focusKey || !charObj?.container || charObj.container.destroyed) return false;
        if (normalizeCharacterKey(charObj.charName) === focusKey) return false;
        charObj.container.alpha = 0;
        return true;
    },

    async updateSprites(sprites, options = {}) {
        if (!pixiApp.layers.characters) return;
        this._ensureSpatialStageHooks();
        pixiApp.layers.characters.sortableChildren = true;
        const updateToken = ++this.updateSequence;

        const spriteArray = this._normalizeSpriteEntries(sprites);

        const activeCount = spriteArray.length;
        const activeSlots = spriteArray.map(s => s.slot);
        const currentTurnCharacters = new Set(spriteArray
            .map(spriteData => getSpriteCharacterKey(spriteData))
            .filter(Boolean));
        const hasRequestedFocus = Object.prototype.hasOwnProperty.call(options || {}, 'focusCharacter');
        const updateFocusKey = this._getCameraFocusKeyForTurn(
            currentTurnCharacters,
            hasRequestedFocus ? options.focusCharacter : undefined
        );

        const slotXPositions = this._getSlotPositions(activeCount, activeSlots);
        pixiSpatialStage.primeBackground(state.currentBackground, state.currentVN?.projectName || null);

        for (const spriteData of spriteArray) {
            const spritePath = spriteData.path;
            const config = { ...spriteData };
            const hasShadowInFrame = Object.prototype.hasOwnProperty.call(config, 'shadow');
            const charName = getSpriteCharacterKey(spriteData);
            if (!charName || !spritePath) continue;
            const slot = spriteData.slot;
            currentTurnCharacters.add(charName);

            let charObj = this.activeSprites[charName];

            if (!charObj) {
                // Concurrency Guard: If already loading, wait for existing promise
                if (this.pendingLoads.has(charName)) {
                    await this.pendingLoads.get(charName);
                    if (this._isUpdateTokenStale(updateToken)) return;
                    charObj = this.activeSprites[charName];
                }
                if (!charObj) {
                    const loadPromise = this._createCharacterSprite(charName, spritePath, config, updateToken);
                    this.pendingLoads.set(charName, loadPromise);
                    charObj = await loadPromise;
                    if (this.pendingLoads.get(charName) === loadPromise) {
                        this.pendingLoads.delete(charName);
                    }
                    if (this._isUpdateTokenStale(updateToken)) {
                        if (charObj) {
                            this._destroyCharacterShadow(charObj);
                            this._killTweensDeep(charObj.container);
                            try { charObj.container?.destroy?.({ children: true }); } catch { }
                            this._scheduleSpriteAssetPrune('stale-native-create');
                        }
                        return;
                    }
                    if (!charObj) return;
                    this.activeSprites[charName] = charObj;

                    pixiApp.layers.characters.addChild(charObj.container);
                    charObj.container.alpha = 0;
                    charObj.needsEntranceFade = true;

                    console.log(`[ANIM DEBUG] Created ${charName}: hasBlink=${config.hasBlink}, hasTalk=${config.hasTalk}, hasTalkBlink=${config.hasTalkBlink}, layers.blink=${!!charObj.layers.blink}, layers.talk=${!!charObj.layers.talk}`);
                    this.startBlinking(charName);
                }
            }

            charObj = this.activeSprites[charName];
            if (!charObj) return;

            if (!hasShadowInFrame && Object.prototype.hasOwnProperty.call(charObj.config || {}, 'shadow')) {
                config.shadow = charObj.config.shadow;
            }

            charObj.config = { ...(charObj.config || {}) };
            if (Array.isArray(config.visualAliases)) {
                charObj.config.visualAliases = [...config.visualAliases];
            } else {
                delete charObj.config.visualAliases;
            }

            if (charObj.spritePath !== spritePath) {
                if (this.pendingLoads.has(charName)) {
                    await this.pendingLoads.get(charName);
                    if (this._isUpdateTokenStale(updateToken)) return;
                    charObj = this.activeSprites[charName];
                }
                if (charObj && charObj.spritePath !== spritePath) {
                    const loadPromise = this._updateCharacterTextures(charObj, spritePath, config, updateToken);
                    this.pendingLoads.set(charName, loadPromise);
                    await loadPromise;
                    if (this.pendingLoads.get(charName) === loadPromise) {
                        this.pendingLoads.delete(charName);
                    }
                    if (this._isUpdateTokenStale(updateToken)) return;
                    charObj = this.activeSprites[charName];
                    if (!charObj) return;

                    // If character now has blinks but was not blinking before, start it
                    if (config.hasBlink && !charObj.blinkTimeout) {
                        this.startBlinking(charName);
                    }
                }
            } else if (config.hasBlink && !charObj.blinkTimeout) {
                // If path hasn't changed but blink loop stopped (rare) or was just enabled
                this.startBlinking(charName);
            }

            // Visibility is controlled by user setting OR active intercept visual locks.
            this._applyMainSpriteVisibility(charObj, this._shouldHideMainSprites());

            if (hasShadowInFrame) {
                charObj.config = {
                    ...(charObj.config || {}),
                    shadow: config.shadow
                };
                this._configureCharacterShadow(charObj, config.shadow);
            }

            // Position, scale, depth and alpha in LOGICAL space
            this._applySpriteTransform(charObj, spriteData, slotXPositions, activeCount);
            this._suppressNonFocusedActorDuringUpdate(charObj, updateFocusKey);
            if (charObj.needsEntranceFade) {
                if (!charObj.container || charObj.container.destroyed) continue;
                const targetAlpha = Number.isFinite(charObj.container.alpha) ? charObj.container.alpha : 1;
                charObj.container.alpha = 0;
                charObj.needsEntranceFade = false;
                this._killTweensDeep(charObj.container);
                gsap.to(charObj.container, {
                    alpha: targetAlpha,
                    duration: 0.5,
                    ease: "power2.out"
                });
            }
            this.syncTalkingState(charName);

            debugLog(`[SpriteManager] Updated ${charName}: Slot=${slot}, X=${charObj.container.x.toFixed(1)}, Scale=${charObj.container.scale.x.toFixed(3)}`);

            window.dispatchEvent(new CustomEvent('vn:pixi-sprite-ready', {
                detail: { charName, charObj }
            }));
        }

        // Remove characters not in current turn
        for (const charName in this.activeSprites) {
            if (this._isPluginActor(this.activeSprites[charName])) continue;
            if (!currentTurnCharacters.has(charName)) {
                const charObj = this.activeSprites[charName];
                if (charObj.isDestroying) continue; // Already in flight

                charObj.isDestroying = true;

                // Signal removal immediately so plugins can stop hooks/rendering
                window.dispatchEvent(new CustomEvent('vn:pixi-sprite-removed', {
                    detail: { charName, charObj }
                }));

                if (!charObj.container || charObj.container.destroyed) {
                    delete this.activeSprites[charName];
                    if (this.muppetIntervals[charName]) {
                        clearInterval(this.muppetIntervals[charName]);
                        delete this.muppetIntervals[charName];
                    }
                    continue;
                }

                gsap.to(charObj.container, {
                    alpha: 0,
                    duration: 0.5,
                    ease: "power2.in",
                    onComplete: () => {
                        this._killTweensDeep(charObj.container);
                        this._destroyCharacterShadow(charObj);
                        if (pixiApp.layers.characters && charObj.container.parent === pixiApp.layers.characters) {
                            pixiApp.layers.characters.removeChild(charObj.container);
                        } else if (charObj.container.parent) {
                            charObj.container.parent.removeChild(charObj.container);
                        }
                        try { charObj.container.destroy({ children: true }); } catch { }
                        this._scheduleSpriteAssetPrune('native-remove-complete');
                    }
                });

                delete this.activeSprites[charName];
                if (this.muppetIntervals[charName]) {
                    clearInterval(this.muppetIntervals[charName]);
                    delete this.muppetIntervals[charName];
                }
            }
        }

        // --- DYNAMIC CAM TRACKING ---
        // If the camera is currently zoomed in on a specific character, their screen position
        // may have just changed due to the slot reshuffling above. We need to instantly snap
        // the camera to their new position, or reset it if they walked off screen.
        if (pixiApp.cam.lastZoomedChar) {
            const targetChar = pixiApp.cam.lastZoomedChar;
            const targetKey = normalizeCharacterKey(targetChar);
            const targetRegion = pixiApp.cam.lastZoomRegion || 'top';

            // Check lowercase normalized name against current active characters
            if (targetKey && this.activeSprites[targetKey]) {
                debugLog(`[SpriteManager] Dynamic re-framing cam to ${targetChar} (Slot changed)`);
                // Using instant=true (duration=0), _isSweepCatchup=false
                pixiApp.cam.zoomToCharacter(targetChar, targetRegion, 0, 40, 0, false);
            } else {
                debugLog(`[SpriteManager] Cam target ${targetChar} left the scene. Resetting cam.`);
                pixiApp.cam.reset(1.5);
            }
        }

        void this.preloadVNAdjacentSprites(state.currentIndex);
    },

    _getActiveSprite(rawCharName) {
        const charName = normalizeCharacterKey(rawCharName);
        if (!charName) return null;
        return this.activeSprites[charName] || this.activeSprites[rawCharName] || null;
    },

    _spriteRepresentsCharacter(charObj, rawCharName) {
        const charName = normalizeCharacterKey(rawCharName);
        if (!charObj || !charName) return false;
        if (normalizeCharacterKey(charObj.charName) === charName) return true;
        const aliases = Array.isArray(charObj.config?.visualAliases) ? charObj.config.visualAliases : [];
        return aliases.some(alias => normalizeCharacterKey(alias) === charName);
    },

    _getActiveSpriteRepresenting(rawCharName) {
        const directSprite = this._getActiveSprite(rawCharName);
        if (directSprite) return directSprite;

        const charName = normalizeCharacterKey(rawCharName);
        if (!charName) return null;
        return Object.values(this.activeSprites).find(charObj => this._spriteRepresentsCharacter(charObj, charName)) || null;
    },

    getActiveSprite(rawCharName) {
        return this._getActiveSprite(rawCharName);
    },

    getManagedSpriteEntries() {
        return Object.entries(this.activeSprites).map(([charName, charObj]) => ({
            charName,
            charObj,
            isPluginActor: this._isPluginActor(charObj)
        }));
    },

    getSpriteMemoryDebug() {
        const pinnedUrls = this._collectPinnedSpriteAssetUrls();
        const liveUrls = this._collectLiveSpriteAssetUrls();
        const cacheEntries = Array.from(this.spriteAssetCache.entries()).map(([url, entry]) => {
            const texture = entry?.texture || null;
            const width = Number(texture?.width) || 0;
            const height = Number(texture?.height) || 0;
            return {
                url,
                live: liveUrls.has(url),
                pinned: pinnedUrls.has(url),
                lookahead: this.spriteLookaheadAssetUrls?.has?.(url) === true,
                lookbehind: this.spriteLookbehindAssetUrls?.has?.(url) === true,
                transientPins: this.spriteTransientAssetPins?.get?.(url) || 0,
                loadingCount: entry?.loadingCount || 0,
                loading: !!entry?.loadPromise,
                unloading: entry?.unloading === true,
                destroyed: texture?.destroyed === true,
                sourceDestroyed: texture?.source?.destroyed === true,
                directBitmap: texture?.__vnSpriteDirectBitmap === true,
                hasOwnedBitmap: !!texture?.__vnOwnedImageBitmap,
                opaqueBoundsPrimed: !!texture && this.textureOpaqueBounds.has(texture),
                gpuPrepared: !!texture && this.gpuPreparedSpriteTextures.has(texture),
                width,
                height,
                approxRgbaMb: width && height ? Number(((width * height * 4) / (1024 * 1024)).toFixed(1)) : 0
            };
        });
        const actors = Object.entries(this.activeSprites).map(([charName, charObj]) => ({
            charName,
            plugin: this._isPluginActor(charObj),
            spritePath: charObj?.spritePath || '',
            bodyChildren: charObj?.body?.children?.length || 0,
            containerChildren: charObj?.container?.children?.length || 0,
            hasShadow: !!charObj?.shadow
        }));
        return {
            activeActors: actors.length,
            pluginActors: actors.filter(actor => actor.plugin).length,
            spriteAssetCacheSize: this.spriteAssetCache.size,
            pinnedAssetUrls: pinnedUrls.size,
            liveAssetUrls: liveUrls.size,
            transientPinnedAssetUrls: this.spriteTransientAssetPins.size,
            pendingLoads: this.pendingLoads.size,
            lookaheadAssetUrls: this.spriteLookaheadAssetUrls.size,
            lookbehindAssetUrls: this.spriteLookbehindAssetUrls.size,
            approxCachedRgbaMb: Number(cacheEntries.reduce((sum, entry) => sum + entry.approxRgbaMb, 0).toFixed(1)),
            actors,
            cacheEntries
        };
    },

    setSpriteShadow(rawCharName, rawShadow) {
        const targetName = String(rawCharName || '').trim();
        if (!targetName) return false;

        const applyShadow = (charObj) => {
            if (!charObj) return false;
            charObj.config = {
                ...(charObj.config || {}),
                shadow: rawShadow
            };
            this._configureCharacterShadow(charObj, rawShadow);
            this._syncCharacterShadow(charObj);
            window.dispatchEvent(new CustomEvent('vn:pixi-sprite-updated', {
                detail: { charName: charObj.charName, charObj, shadowChanged: true }
            }));
            return true;
        };

        const normalizedTarget = targetName.toLowerCase();
        if (normalizedTarget === '*' || normalizedTarget === 'all') {
            let count = 0;
            for (const charObj of Object.values(this.activeSprites)) {
                if (applyShadow(charObj)) count++;
            }
            return count;
        }

        const pluginActorKey = this._normalizePluginActorId(targetName);
        const charObj = this._getActiveSprite(targetName) || (pluginActorKey ? this.activeSprites[pluginActorKey] : null);
        return applyShadow(charObj);
    },

    _isUpdateTokenStale(updateToken) {
        return updateToken !== this.updateSequence;
    },

    _destroyLayerSet(layers) {
        if (!layers) return;
        this._releaseLayerSetAssetPins(layers);
        for (const layer of Object.values(layers)) {
            if (!layer) continue;
            this._killTweensDeep(layer);
            try {
                if (typeof layer.destroy === 'function') {
                    layer.destroy({ children: true });
                }
            } catch { }
        }
        this._scheduleSpriteAssetPrune('destroy-layer-set');
    },

    _getSpriteTextureCacheLimit() {
        const raw = Number(state.vnSettings?.performance?.sprite_texture_cache_limit);
        if (!Number.isFinite(raw)) return 0;
        return Math.max(0, Math.floor(raw));
    },

    _getSpriteTextureUnloadDelayMs() {
        const raw = Number(state.vnSettings?.performance?.sprite_texture_unload_delay_ms);
        if (!Number.isFinite(raw)) return 1500;
        return Math.max(250, Math.floor(raw));
    },

    _shouldPreloadVNAdjacentSprites() {
        return state.vnSettings?.performance?.sprite_texture_vn_lookahead !== false;
    },

    _shouldPreloadVNLookaheadSprites() {
        return this._shouldPreloadVNAdjacentSprites();
    },

    _shouldUseDirectSpriteBitmapLoader() {
        return state.vnSettings?.performance?.sprite_texture_direct_bitmap_loader !== false;
    },

    _ensureSpriteAssetEntry(assetUrl) {
        const url = String(assetUrl || '').trim();
        if (!url) return null;
        const entry = this.spriteAssetCache.get(url) || {
            texture: null,
            loadPromise: null,
            lastUsed: 0,
            unloading: false,
            unloadPromise: null,
            loadingCount: 0
        };
        if (!this.spriteAssetCache.has(url)) {
            this.spriteAssetCache.set(url, entry);
        }
        return entry;
    },

    _registerSpriteAsset(assetUrl, texture = null) {
        const url = String(assetUrl || '').trim();
        if (!url) return;
        const entry = this._ensureSpriteAssetEntry(url);
        if (!entry) return;
        if (texture) {
            entry.texture = texture;
            try { texture.__vnSpriteAssetUrl = url; } catch { }
        }
        entry.lastUsed = Date.now();
        entry.unloading = false;
        entry.unloadPromise = null;
        this.spriteAssetCache.set(url, entry);
        this._scheduleSpriteAssetPrune('register-sprite-asset');
    },

    _pinSpriteAssetUrl(assetUrl) {
        const url = String(assetUrl || '').trim();
        if (!url) return;
        this.spriteTransientAssetPins.set(url, (this.spriteTransientAssetPins.get(url) || 0) + 1);
    },

    _unpinSpriteAssetUrl(assetUrl) {
        const url = String(assetUrl || '').trim();
        if (!url) return;
        const count = this.spriteTransientAssetPins.get(url) || 0;
        if (count <= 1) {
            this.spriteTransientAssetPins.delete(url);
        } else {
            this.spriteTransientAssetPins.set(url, count - 1);
        }
    },

    _trackLayerSetAsset(layers, assetUrl) {
        const url = String(assetUrl || '').trim();
        if (!layers || !url) return;
        if (!Array.isArray(layers.__assetUrls)) {
            Object.defineProperty(layers, '__assetUrls', {
                value: [],
                enumerable: false,
                configurable: true,
                writable: true
            });
        }
        layers.__assetUrls.push(url);
        this._pinSpriteAssetUrl(url);
    },

    _releaseLayerSetAssetPins(layers) {
        if (!layers || !Array.isArray(layers.__assetUrls)) return;
        for (const url of layers.__assetUrls) {
            this._unpinSpriteAssetUrl(url);
        }
        layers.__assetUrls.length = 0;
    },

    async _waitForSpriteAssetUnload(assetUrl) {
        const url = String(assetUrl || '').trim();
        if (!url) return;
        const entry = this.spriteAssetCache.get(url);
        if (!entry?.unloading || !entry.unloadPromise) return;
        try {
            await entry.unloadPromise;
        } catch { }
    },

    _beginSpriteAssetLoad(assetUrl) {
        const url = String(assetUrl || '').trim();
        if (!url) return () => { };
        const entry = this._ensureSpriteAssetEntry(url);
        if (!entry) return () => { };
        entry.loadingCount = (entry.loadingCount || 0) + 1;
        entry.lastUsed = Date.now();
        return () => {
            const currentEntry = this.spriteAssetCache.get(url);
            if (!currentEntry) return;
            currentEntry.loadingCount = Math.max(0, (currentEntry.loadingCount || 0) - 1);
            currentEntry.lastUsed = Date.now();
            this._scheduleSpriteAssetPrune('sprite-load-finished');
        };
    },

    _isSpriteTextureUsable(texture) {
        return !!texture
            && texture.destroyed !== true
            && !!texture.source
            && texture.source.destroyed !== true
            && Number(texture.width) > 0
            && Number(texture.height) > 0;
    },

    registerPreloadedSpriteAssets(assetUrls = []) {
        if (!Array.isArray(assetUrls)) return;
        for (const assetUrl of assetUrls) {
            this._registerSpriteAsset(assetUrl, null);
        }
    },

    _collectLiveSpriteAssetUrls() {
        const live = new Set();
        const visit = (displayObject) => {
            if (!displayObject || displayObject.destroyed) return;
            const assetUrl = displayObject.texture?.__vnSpriteAssetUrl;
            if (assetUrl) live.add(assetUrl);
            if (Array.isArray(displayObject.children)) {
                for (const child of displayObject.children) visit(child);
            }
        };

        for (const charObj of Object.values(this.activeSprites)) {
            visit(charObj?.container);
        }
        visit(pixiApp.layers?.characters);
        visit(pixiApp.layers?.interceptActors);

        return live;
    },

    _collectPinnedSpriteAssetUrls() {
        const pinned = this._collectLiveSpriteAssetUrls();
        for (const url of this.spriteTransientAssetPins.keys()) {
            pinned.add(url);
        }
        for (const [url, entry] of this.spriteAssetCache.entries()) {
            if ((entry?.loadingCount || 0) > 0) pinned.add(url);
        }
        if (this._shouldPreloadVNLookaheadSprites()) {
            for (const url of this.spriteLookaheadAssetUrls || []) {
                if (url) pinned.add(url);
            }
            for (const url of this.spriteLookbehindAssetUrls || []) {
                if (url) pinned.add(url);
            }
        }
        return pinned;
    },

    _touchLiveSpriteAssets(liveUrls) {
        const now = Date.now();
        for (const url of liveUrls) {
            const entry = this.spriteAssetCache.get(url);
            if (entry) entry.lastUsed = now;
        }
    },

    _scheduleSpriteAssetPrune(reason = 'scheduled') {
        if (this.spriteAssetPruneTimer) {
            return;
        }
        this.spriteAssetPruneTimer = setTimeout(() => {
            this.spriteAssetPruneTimer = null;
            this._pruneSpriteAssetCache(reason);
        }, this._getSpriteTextureUnloadDelayMs());
    },

    _pruneSpriteAssetCache(reason = 'prune') {
        if (!this.spriteAssetCache || this.spriteAssetCache.size === 0) return;
        if (!window.PIXI?.Assets && !window.PIXI?.Texture) return;

        const limit = this._getSpriteTextureCacheLimit();
        const liveUrls = this._collectPinnedSpriteAssetUrls();
        this._touchLiveSpriteAssets(liveUrls);
        const targetSize = Math.max(limit, liveUrls.size);
        if (this.spriteAssetCache.size <= targetSize) return;

        const candidates = Array.from(this.spriteAssetCache.entries())
            .filter(([url, entry]) => !liveUrls.has(url) && !entry?.unloading && !(entry?.loadingCount > 0))
            .sort((a, b) => (a[1]?.lastUsed || 0) - (b[1]?.lastUsed || 0));

        let projectedSize = this.spriteAssetCache.size;
        for (const [url, entry] of candidates) {
            if (projectedSize <= targetSize) break;
            projectedSize -= 1;
            this._unloadSpriteAsset(url, entry, reason);
        }
    },

    _scheduleRendererTextureGC(reason = 'sprite-texture-gc') {
        if (this.spriteTextureGCTimer) return;
        this.spriteTextureGCTimer = setTimeout(() => {
            this.spriteTextureGCTimer = null;
            try { pixiApp.app?.renderer?.textureGC?.run?.(); } catch { }
            try { pixiApp.app?.renderer?.renderableGC?.run?.(); } catch { }
            try { pixiApp.app?.renderer?.texture?.gc?.run?.(); } catch { }
            debugLog(`[SpriteManager] Renderer texture GC requested (${reason})`);
        }, 250);
    },

    _removeSpriteTextureFromPixiCaches(assetUrl, texture = null) {
        const url = String(assetUrl || '').trim();
        try {
            if (url && window.PIXI?.Cache?.remove) {
                window.PIXI.Cache.remove(url);
            }
        } catch { }
        try {
            if (url && window.PIXI?.Assets?.cache?.remove) {
                window.PIXI.Assets.cache.remove(url);
            }
        } catch { }
        try {
            if (texture && window.PIXI?.Cache?.remove) {
                window.PIXI.Cache.remove(texture);
            }
        } catch { }
        try {
            if (texture?.__vnOwnedImageBitmap && window.PIXI?.Cache?.remove) {
                window.PIXI.Cache.remove(texture.__vnOwnedImageBitmap);
            }
        } catch { }
    },

    _closeOwnedSpriteBitmap(texture) {
        if (!texture) return;
        const ownedBitmap = texture.__vnOwnedImageBitmap || null;
        try {
            if (ownedBitmap && typeof ownedBitmap.close === 'function') {
                ownedBitmap.close();
            }
        } catch { }
        try { texture.__vnOwnedImageBitmap = null; } catch { }
    },

    _destroySpriteTexture(texture, assetUrl = '') {
        if (!texture) return;
        this._removeSpriteTextureFromPixiCaches(assetUrl, texture);
        try {
            if (!texture.destroyed && typeof texture.destroy === 'function') {
                texture.destroy(true);
            }
        } catch { }
        this._closeOwnedSpriteBitmap(texture);
        this._scheduleRendererTextureGC('sprite-texture-destroy');
    },

    _applySpriteTextureQuality(texture) {
        if (!texture?.source) return;
        try { texture.source.autoGenerateMipmaps = true; } catch { }
        try {
            if (texture.source.style) {
                texture.source.style.scaleMode = 'linear';
                texture.source.style.addressMode = 'clamp-to-edge';
            }
        } catch { }
    },

    async _prepareSpriteTextureForGpu(texture, token = null) {
        if (!this._isSpriteTextureUsable(texture)) return false;
        if (token !== null && token !== this.spriteAdjacentPreloadToken) return false;
        if (this.gpuPreparedSpriteTextures.has(texture)) return true;

        const pending = this.gpuPrepareSpritePromises.get(texture);
        if (pending) return pending;
        const prepare = pixiApp.app?.renderer?.prepare;
        if (!prepare || typeof prepare.upload !== 'function') return false;

        const work = Promise.resolve()
            .then(() => prepare.upload(texture))
            .then(() => {
                if (this._isSpriteTextureUsable(texture)) {
                    this.gpuPreparedSpriteTextures.add(texture);
                    return true;
                }
                return false;
            })
            .catch((error) => {
                debugLog('[SpriteManager] Upcoming base texture GPU preparation failed.', error?.message || error);
                return false;
            })
            .finally(() => {
                this.gpuPrepareSpritePromises.delete(texture);
            });

        this.gpuPrepareSpritePromises.set(texture, work);
        return work;
    },

    async _loadSpriteTextureFromUrl(assetUrl) {
        const url = String(assetUrl || '').trim();
        if (!url) throw new Error('Missing sprite asset URL');

        if (this._shouldUseDirectSpriteBitmapLoader()
            && typeof fetch === 'function'
            && typeof createImageBitmap === 'function'
            && window.PIXI?.Texture?.from) {
            let bitmap = null;
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} while loading ${url}`);
                }
                const blob = await response.blob();
                bitmap = await createImageBitmap(blob);
                const texture = window.PIXI.Texture.from(bitmap);
                texture.__vnOwnedImageBitmap = bitmap;
                texture.__vnSpriteDirectBitmap = true;
                texture.__vnSpriteAssetUrl = url;
                return texture;
            } catch (error) {
                try {
                    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
                } catch { }
                throw error;
            }
        }

        const texture = await window.PIXI.Assets.load(url);
        try { texture.__vnSpriteDirectBitmap = false; } catch { }
        try { texture.__vnSpriteAssetUrl = url; } catch { }
        return texture;
    },

    async _spriteAssetUrlExists(assetUrl) {
        const url = String(assetUrl || '').trim();
        if (!url) return false;
        if (typeof fetch !== 'function') return true;

        try {
            const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
            if (head.ok) return true;
            if (head.status && head.status !== 405 && head.status !== 501) return false;
        } catch { }

        try {
            const response = await fetch(url, {
                method: 'GET',
                cache: 'no-store',
                headers: { Range: 'bytes=0-0' }
            });
            return response.ok || response.status === 206;
        } catch {
            return false;
        }
    },

    _unloadSpriteAsset(url, entry, reason = 'unload') {
        if (!url || !entry || entry.unloading) return;
        entry.unloading = true;

        const unloadPromise = Promise.resolve().then(async () => {
            const currentEntry = this.spriteAssetCache.get(url);
            if (currentEntry !== entry) return 'stale';
            let keepEntry = false;
            const textureToDestroy = entry.texture || null;

            const liveUrls = this._collectPinnedSpriteAssetUrls();
            if (liveUrls.has(url) || (entry.loadingCount || 0) > 0) {
                entry.lastUsed = Date.now();
                keepEntry = true;
                return 'pinned';
            }

            try {
                if (!textureToDestroy?.__vnSpriteDirectBitmap && window.PIXI?.Assets?.unload) {
                    await window.PIXI.Assets.unload(url);
                }

                // Unload is async; a rapid sprite swap can make this asset live
                // again while PIXI.Assets is working. Re-check before force-destroying
                // the texture wrapper, otherwise Pixi can render a node whose internals
                // were just torn out from under it.
                const liveUrlsAfterUnload = this._collectPinnedSpriteAssetUrls();
                if (liveUrlsAfterUnload.has(url)) {
                    entry.lastUsed = Date.now();
                    keepEntry = true;
                    return 'repinned';
                }

                this._destroySpriteTexture(textureToDestroy, url);
                debugLog(`[SpriteManager] Unloaded inactive sprite texture (${reason}): ${url}`);
            } catch (error) {
                debugError(`[SpriteManager] Failed to unload inactive sprite texture (${reason}): ${url}`, error);
                try {
                    const liveUrlsAfterError = this._collectPinnedSpriteAssetUrls();
                    if (!liveUrlsAfterError.has(url)) {
                        this._destroySpriteTexture(textureToDestroy, url);
                    }
                } catch { }
            } finally {
                if (this.spriteAssetCache.get(url) === entry) {
                    entry.unloading = false;
                    entry.unloadPromise = null;
                    if (!keepEntry) {
                        this.spriteAssetCache.delete(url);
                    }
                }
            }
        });
        entry.unloadPromise = unloadPromise;
    },

    _getCharacterFlipSign(charObj) {
        return Number(charObj?.container?.scale?.x) < 0 ? -1 : 1;
    },

    _getShadowQualityDefaults() {
        const performanceDefaults = state.vnSettings?.performance?.sprite_shadows;
        if (performanceDefaults && typeof performanceDefaults === 'object') return performanceDefaults;
        const legacyVisualDefaults = state.vnSettings?.visuals?.sprite_shadows;
        return (legacyVisualDefaults && typeof legacyVisualDefaults === 'object') ? legacyVisualDefaults : null;
    },

    _configureCharacterShadow(charObj, rawShadow) {
        if (!charObj) return false;
        const shadowConfig = normalizeSpriteShadowConfig(rawShadow, this._getShadowQualityDefaults());
        if (!shadowConfig) {
            this._destroyCharacterShadow(charObj);
            return false;
        }
        if (!charObj.backFX || !charObj.layers?.base?.texture) return false;

        if (!charObj.shadow) {
            charObj.shadow = new CharacterShadow({
                PIXI,
                host: charObj.backFX,
                charName: charObj.charName,
                debugLog,
                debugError
            });
        }

        try {
            return charObj.shadow.updateTexture(charObj.layers.base.texture, shadowConfig, {
                flipSign: this._getCharacterFlipSign(charObj)
            });
        } catch (error) {
            debugError(`[SpriteManager] Failed to build contact shadow for ${charObj.charName}`, error);
            this._destroyCharacterShadow(charObj);
            return false;
        }
    },

    _syncCharacterShadow(charObj) {
        if (!charObj?.shadow) return;
        try {
            charObj.shadow.syncTransform({
                flipSign: this._getCharacterFlipSign(charObj)
            });
        } catch (error) {
            debugError(`[SpriteManager] Failed to sync contact shadow for ${charObj.charName}`, error);
        }
    },

    _destroyCharacterShadow(charObj) {
        if (!charObj?.shadow) return;
        try { charObj.shadow.destroy(); } catch { }
        charObj.shadow = null;
    },

    _applySpatialStageShadowOverride(charObj, shadowConfig) {
        if (!charObj || this._isPluginActor(charObj)) return;

        if (!shadowConfig) {
            if (!charObj._spatialStageShadowBackup) return;
            const backup = charObj._spatialStageShadowBackup;
            delete charObj._spatialStageShadowBackup;

            charObj.config = { ...(charObj.config || {}) };
            if (backup.hadOwnShadow) {
                charObj.config.shadow = backup.shadowValue;
            } else {
                delete charObj.config.shadow;
            }
            this._configureCharacterShadow(charObj, charObj.config.shadow);
            return;
        }

        if (!charObj._spatialStageShadowBackup) {
            charObj._spatialStageShadowBackup = {
                hadOwnShadow: Object.prototype.hasOwnProperty.call(charObj.config || {}, 'shadow'),
                shadowValue: charObj.config?.shadow
            };
        }

        charObj.config = {
            ...(charObj.config || {}),
            shadow: shadowConfig
        };
        this._configureCharacterShadow(charObj, shadowConfig);
    },

    _ensureSpatialStageHooks() {
        if (this.spatialStageHooksReady || typeof window === 'undefined') return;
        this.spatialStageHooksReady = true;

        pixiSpatialStage.init();

        window.addEventListener('spatial-stage:refresh-request', () => {
            this.repositionAll();
        });

        window.addEventListener('vn:background-updated', () => {
            pixiSpatialStage.primeBackground(state.currentBackground, state.currentVN?.projectName || null);
            this.repositionAll();
        });
    },

    init() {
        this._ensureSpatialStageHooks();
        // Register GSAP PixiPlugin if available
        if (window.gsap && window.PIXI && window.PixiPlugin) {
            gsap.registerPlugin(PixiPlugin);
            PixiPlugin.registerPIXI(PIXI);
        }

        // --- ANIMATION EVENT LISTENERS ---
        window.addEventListener('vn:anim-bounce', (e) => {
            const { charName } = e.detail;
            this.bounce(charName);
        });

        window.addEventListener('vn:anim-shake', (e) => {
            const { charName } = e.detail;
            this.shake(charName);
        });

        window.addEventListener('vn:anim-sink', (e) => {
            const { charName } = e.detail;
            this.sink(charName);
        });

        window.addEventListener('vn:anim-slowsink', (e) => {
            const { charName } = e.detail;
            this.slowSink(charName);
        });

        window.addEventListener('vn:anim-panic', (e) => {
            const { charName } = e.detail;
            this.panic(charName);
        });

        window.addEventListener('vn:emote', (e) => {
            const { charName, type } = e.detail;
            console.log(`[ANIM DEBUG] Emote event received: char=${charName}, type=${type}`);
            this.showEmote(charName, type);
        });

        window.addEventListener('vn:sprite-shadow', (e) => {
            const detail = e.detail || {};
            const charName = detail.charName || detail.actor || detail.character;
            this.setSpriteShadow(charName, detail.shadow || null);
        });
    },

    reset() {
        this.updateSequence += 1;
        this.stopAllTalking();
        for (const charName in this.activeSprites) {
            const charObj = this.activeSprites[charName];
            try {
                window.dispatchEvent(new CustomEvent('vn:pixi-sprite-removed', {
                    detail: {
                        charName,
                        charObj,
                        isPluginActor: this._isPluginActor(charObj),
                        reason: 'sprite-manager-reset'
                    }
                }));
            } catch (_) { }
            if (charObj.blinkTimeout) clearTimeout(charObj.blinkTimeout);
            if (this.muppetIntervals[charName]) clearInterval(this.muppetIntervals[charName]);

            if (charObj.container?.parent) {
                this._killTweensDeep(charObj.container);
                charObj.container.parent.removeChild(charObj.container);
            }
            this._destroyCharacterShadow(charObj);
            try { charObj.container.destroy({ children: true }); } catch { }
        }
        this.activeSprites = {};
        this.pendingLoads.clear();
        this.muppetIntervals = {};
        this.spriteAdjacentPreloadToken += 1;
        this.spriteLookaheadAssetUrls.clear();
        this.spriteLookbehindAssetUrls.clear();

        // Boundary resets must remove untracked fade-out containers too. Those
        // can exist after updateSprites() deletes bookkeeping before GSAP ends.
        [pixiApp.layers.characters, pixiApp.layers.interceptActors].forEach((layer) => {
            if (!layer) return;
            for (const child of [...layer.children]) {
                this._killTweensDeep(child);
                try {
                    if (child.parent) child.parent.removeChild(child);
                } catch { }
                try { child.destroy({ children: true }); } catch { }
            }
        });
        this._scheduleSpriteAssetPrune('sprite-manager-reset');
        debugLog('[PixiSpriteManager] Reset complete');
    },

    _getSlotPositions(count, slots) {
        const width = pixiApp.LOGICAL_WIDTH;
        const pos = {};
        const ratios = this._getSlotRatios(count);

        // Sort slot indices to ensure consistent horizontal order
        const sortedSlots = [...slots].sort((a, b) => a - b);

        for (let i = 0; i < count; i++) {
            const ratio = ratios[i] ?? 0.5;
            pos[sortedSlots[i]] = width * ratio;
        }
        return pos;
    },

    _getSlotRatios(count) {
        if (count <= 0) return [];
        if (count === 1) return [0.5];
        if (count === 2) return [1 / 3, 2 / 3];
        if (count === 3) return [1 / 6, 0.5, 5 / 6];

        const margin = count >= 5 ? 0.08 : 0.12;
        const span = 1 - (margin * 2);
        return Array.from({ length: count }, (_unused, idx) => margin + (span * (idx / (count - 1))));
    },

    _applyHorizontalPadding(normalizedX) {
        const parsedX = Number(normalizedX);
        const x = Number.isFinite(parsedX) ? parsedX : 0.5;
        const parsedPadding = Number(state.vnSettings.visuals?.sprite_horizontal_padding);
        const paddingPercent = Number.isFinite(parsedPadding)
            ? Math.min(40, Math.max(0, parsedPadding))
            : 0;
        const availableWidth = 1 - ((paddingPercent / 100) * 2);
        return 0.5 + ((x - 0.5) * availableWidth);
    },

    _getSpatialStageLayoutParams({
        layout,
        normalizedXFromSlot,
        normalizedY,
        layoutScale,
        alpha,
        baseZIndex,
        layoutRole
    }) {
        const role = String(layoutRole || '');
        if (SPATIAL_STAGE_NOOP_ROLES.has(role)) {
            return {
                normalizedX: normalizedXFromSlot,
                normalizedY: 1,
                layoutScale: 1,
                alpha: 1,
                baseZIndex: 0,
                layoutRole: '',
                hasExplicitLayout: false
            };
        }

        if (Object.prototype.hasOwnProperty.call(SPATIAL_STAGE_CLOSE_Y, role)) {
            return {
                normalizedX: Number.isFinite(Number(layout?.x)) ? Number(layout.x) : normalizedXFromSlot,
                normalizedY: SPATIAL_STAGE_CLOSE_Y[role],
                layoutScale: 1,
                alpha,
                baseZIndex,
                layoutRole: role,
                hasExplicitLayout: true
            };
        }

        if (Object.prototype.hasOwnProperty.call(SPATIAL_STAGE_OVER_SHOULDER_Y, role)) {
            return {
                normalizedX: Number.isFinite(Number(layout?.x)) ? Number(layout.x) : normalizedXFromSlot,
                normalizedY: SPATIAL_STAGE_OVER_SHOULDER_Y[role],
                layoutScale: 1,
                alpha,
                baseZIndex,
                layoutRole: role,
                hasExplicitLayout: true
            };
        }

        return {
            normalizedX: Number.isFinite(Number(layout?.x)) ? Number(layout.x) : normalizedXFromSlot,
            normalizedY,
            layoutScale,
            alpha,
            baseZIndex,
            layoutRole: role,
            hasExplicitLayout: !!layout
        };
    },

    _applySpriteTransform(charObj, spriteData, slotXPositions, activeCount = 0) {
        if (!charObj || !spriteData) return;

        const layout = (spriteData.layout && typeof spriteData.layout === 'object') ? spriteData.layout : null;
        const spriteOffset = state.vnSettings.visuals?.sprite_offset || 0;
        const slotFallbackX = slotXPositions[spriteData.slot] ?? (pixiApp.LOGICAL_WIDTH / 2);

        this._resizeCharacterToFit(charObj);
        const baseScale = Number.isFinite(charObj.container.scale?.x) ? charObj.container.scale.x : 1;

        const normalizedXFromSlot = slotFallbackX / pixiApp.LOGICAL_WIDTH;
        const normalizedY = Number.isFinite(Number(layout?.y))
            ? Number(layout.y)
            : 1;
        const layoutScale = Number.isFinite(Number(layout?.scale))
            ? Number(layout.scale)
            : 1;
        const metadataScale = Number.isFinite(Number(spriteData.metadataScale)) && Number(spriteData.metadataScale) > 0
            ? Number(spriteData.metadataScale)
            : 1;
        const alpha = Number.isFinite(Number(layout?.alpha))
            ? Number(layout.alpha)
            : 1;
        const baseZIndex = Number.isFinite(Number(layout?.zIndex))
            ? Number(layout.zIndex)
            : 0;
        const layoutRole = String(layout?.role || '');
        const spatialParams = this._getSpatialStageLayoutParams({
            layout,
            normalizedXFromSlot,
            normalizedY,
            layoutScale,
            alpha,
            baseZIndex,
            layoutRole
        });

        const spatialProjection = pixiSpatialStage.projectSprite({
            backgroundPath: state.currentBackground,
            projectName: state.currentVN?.projectName || null,
            normalizedX: spatialParams.normalizedX,
            normalizedY: spatialParams.normalizedY,
            layoutScale: spatialParams.layoutScale,
            baseZIndex: spatialParams.baseZIndex,
            alpha: spatialParams.alpha,
            hasExplicitLayout: spatialParams.hasExplicitLayout,
            layoutRole: spatialParams.layoutRole,
            activeCount
        });

        if (spatialProjection) {
            const stageBaseScale = this._getCharacterFitScale(charObj, { useSpriteSizeMultiplier: false });
            const scaleSign = Number(charObj.container.scale?.x) < 0 ? -1 : 1;
            charObj.container.x = spatialProjection.x;
            // Spatial stage sidecars define the actor foot point directly.
            // Global VN sprite offset/size knobs only belong to classic flat layout.
            charObj.container.y = spatialProjection.y;
            charObj.container.scale.set(
                stageBaseScale * spatialProjection.scaleMultiplier * metadataScale * scaleSign,
                stageBaseScale * spatialProjection.scaleMultiplier * metadataScale
            );
            charObj.container.alpha = spatialProjection.alpha;
            charObj.container.zIndex = spatialProjection.zIndex;
            charObj.spatialStageState = {
                active: true,
                normalizedX: spatialParams.normalizedX,
                normalizedY: spatialParams.normalizedY,
                depth: spatialProjection.depth,
                x: spatialProjection.x,
                y: spatialProjection.y,
                role: spatialParams.layoutRole
            };
            this._applySpatialStageShadowOverride(charObj, spatialProjection.shadow || null);
            this._syncCharacterShadow(charObj);
            return;
        }

        charObj.spatialStageState = null;
        this._applySpatialStageShadowOverride(charObj, null);
        if (layout) {
            const resolvedNormalizedX = Number.isFinite(Number(layout.x))
                ? Number(layout.x)
                : normalizedXFromSlot;
            const resolvedX = this._applyHorizontalPadding(resolvedNormalizedX) * pixiApp.LOGICAL_WIDTH;
            const resolvedY = (normalizedY * pixiApp.LOGICAL_HEIGHT) + spriteOffset;
            charObj.container.x = resolvedX;
            charObj.container.y = resolvedY;
            charObj.container.scale.set(baseScale * layoutScale * metadataScale);
            charObj.container.alpha = alpha;
            charObj.container.zIndex = baseZIndex;
            this._syncCharacterShadow(charObj);
            return;
        }

        const paddedNormalizedX = this._applyHorizontalPadding(normalizedXFromSlot);
        charObj.container.x = paddedNormalizedX * pixiApp.LOGICAL_WIDTH;
        charObj.container.y = pixiApp.LOGICAL_HEIGHT + spriteOffset;
        charObj.container.scale.set(baseScale * metadataScale);
        charObj.container.alpha = 1;
        charObj.container.zIndex = 0;
        this._syncCharacterShadow(charObj);
    },

    _getCharacterFitScale(charObj, { useSpriteSizeMultiplier = true } = {}) {
        if (!charObj?.layers?.base?.texture) return 1;
        const multiplier = useSpriteSizeMultiplier
            ? (state.vnSettings.visuals?.sprite_size_multiplier || 1.0)
            : 1.0;
        const targetHeight = pixiApp.LOGICAL_HEIGHT * 0.85 * multiplier;
        return targetHeight / Math.max(1, charObj.layers.base.texture.height);
    },

    _resizeCharacterToFit(charObj, options = {}) {
        if (!charObj.container || !charObj.layers.base) return;

        // Scale relative to LOGICAL height (1080)
        // We use a fixed height percentage so all characters have a consistent vertical baseline
        // independent of their texture's natural aspect ratio.
        const scale = this._getCharacterFitScale(charObj, options);

        charObj.container.scale.set(scale);
    },

    _pruneStaleBodies(charObj, keepBodies = []) {
        if (!charObj?.container) return;

        const keep = new Set(keepBodies.filter(Boolean));
        const staleBodies = charObj.container.children.filter((child) => {
            return child?.label === 'body' && !keep.has(child);
        });

        if (staleBodies.length === 0) return;

        debugLog(`[SpriteManager] Pruning ${staleBodies.length} stale body container(s) for ${charObj.charName}`);

        for (const body of staleBodies) {
            this._killTweensDeep(body);
            if (body.parent === charObj.container) {
                try { charObj.container.removeChild(body); } catch { }
            }
            try {
                body.destroy({ children: true });
            } catch { }
        }
    },

    async _createCharacterSprite(charName, spritePath, config, updateToken = null) {
        const rootContainer = new PIXI.Container();
        rootContainer.label = `CharRoot_${charName}`;

        // THE RENDER STACK
        const backFX = new PIXI.Container(); backFX.label = "backFX";
        const body = new PIXI.Container(); body.label = "body";
        const frontFX = new PIXI.Container(); frontFX.label = "frontFX";

        rootContainer.addChild(backFX, body, frontFX);

        const layers = await this._loadLayers(spritePath, config);
        if (updateToken !== null && this._isUpdateTokenStale(updateToken)) {
            this._destroyLayerSet(layers);
            try { rootContainer.destroy({ children: true }); } catch { }
            return null;
        }

        // Add layers to the BODY, not the root
        body.addChild(layers.base);
        if (layers.blink) { layers.blink.alpha = 0; body.addChild(layers.blink); }
        if (layers.talk) { layers.talk.alpha = 0; body.addChild(layers.talk); }
        if (layers.talkBlink) { layers.talkBlink.alpha = 0; body.addChild(layers.talkBlink); }

        body.children.forEach(c => {
            if (c instanceof PIXI.Sprite) c.anchor.set(0.5, 1);
        });

        const charObj = {
            charName,
            spritePath,
            container: rootContainer,
            backFX, body, frontFX,
            layers,
            config,
            isBlinking: false,
            isTalking: false,
            isMouthOpen: false
        };

        this._releaseLayerSetAssetPins(layers);
        this._configureCharacterShadow(charObj, config?.shadow);
        return charObj;
    },

    async _updateCharacterTextures(charObj, spritePath, config, updateToken = null) {
        const newLayers = await this._loadLayers(spritePath, config);
        if (updateToken !== null && this._isUpdateTokenStale(updateToken)) {
            this._destroyLayerSet(newLayers);
            return false;
        }

        // Create a temporary body container for the new layers
        const newBody = new PIXI.Container();
        newBody.label = "body";
        newBody.alpha = 0;

        newBody.addChild(newLayers.base);
        if (newLayers.blink) { newLayers.blink.alpha = 0; newBody.addChild(newLayers.blink); }
        if (newLayers.talk) { newLayers.talk.alpha = 0; newBody.addChild(newLayers.talk); }
        if (newLayers.talkBlink) { newLayers.talkBlink.alpha = 0; newBody.addChild(newLayers.talkBlink); }

        newBody.children.forEach(c => {
            if (c instanceof PIXI.Sprite) c.anchor.set(0.5, 1);
        });

        // Insert new body at the same position as the old body in the render stack
        const oldBody = charObj.body;
        this._pruneStaleBodies(charObj, [oldBody]);
        let bodyIndex = 0;
        let frontFXIndex = charObj.container.children.length;
        try { bodyIndex = charObj.container.getChildIndex(oldBody); } catch { }
        try { frontFXIndex = charObj.container.getChildIndex(charObj.frontFX); } catch { }
        const targetIndex = Math.min(bodyIndex + 1, frontFXIndex);
        charObj.container.addChildAt(newBody, targetIndex);
        this._releaseLayerSetAssetPins(newLayers);

        // Handle Sprite Morphing based on settings
        const morphMethod = state.vnSettings.visuals?.sprite_morph_method || 'motion_blend';

        if (morphMethod === 'motion_blend') {
            // Motion Blend: 400ms alpha crossfade + 600ms motion jiggle
            const alphaDuration = 0.25; // Snappier crossfade
            const motionDuration = 0.6;

            // Accelerated Fade-out of the old sprite (Power3.in for sharper cut)
            gsap.to(oldBody, {
                alpha: 0,
                duration: 0.18,
                ease: "power3.in",
                onComplete: () => {
                    this._killTweensDeep(oldBody);
                    if (oldBody.parent === charObj.container) {
                        charObj.container.removeChild(oldBody);
                    } else if (oldBody.parent) {
                        oldBody.parent.removeChild(oldBody);
                    }
                    try { oldBody.destroy({ children: true }); } catch { }
                    this._pruneStaleBodies(charObj, [charObj.body]);
                    this._scheduleSpriteAssetPrune('sprite-morph-old-body');
                }
            });

            // Dynamic "Slingshot" Settle: Each character gets a unique, randomized stumble 
            // to avoid looking choreographed.
            const startPos = {
                x: (Math.random() * 80 - 40), // -40px to +40px
                y: (Math.random() * 30 - 20), // -20px to +10px (mostly upward pop)
                scaleX: 1.0,
                scaleY: 1.0
            };
            const startAngle = (Math.random() * 6 - 3); // -6 to +6 DEGREES

            // The "Slingshot" transition. Avoid PixiPlugin here because scene
            // boundary resets can destroy PIXI transforms before plugin init.
            newBody.x = startPos.x;
            newBody.y = startPos.y;
            newBody.scale.set(startPos.scaleX, startPos.scaleY);
            newBody.angle = startAngle;
            gsap.to(newBody, {
                x: 0,
                y: 0,
                angle: 0,
                duration: motionDuration,
                ease: "power2.out"
            });
            gsap.to(newBody.scale, {
                x: 1,
                y: 1,
                duration: motionDuration,
                ease: "power2.out"
            });

            // Fade-in of the new sprite (starting instantly with the motion)
            gsap.to(newBody, {
                alpha: 1,
                duration: alphaDuration,
                ease: "power2.inOut"
            });
        } else if (morphMethod === 'cross_fade') {
            // Traditional Crossfade: (Original 150ms)
            gsap.to(oldBody, {
                alpha: 0,
                duration: 0.15,
                ease: "power2.out",
                onComplete: () => {
                    this._killTweensDeep(oldBody);
                    if (oldBody.parent === charObj.container) {
                        charObj.container.removeChild(oldBody);
                    } else if (oldBody.parent) {
                        oldBody.parent.removeChild(oldBody);
                    }
                    try { oldBody.destroy({ children: true }); } catch { }
                    this._pruneStaleBodies(charObj, [charObj.body]);
                    this._scheduleSpriteAssetPrune('sprite-crossfade-old-body');
                }
            });

            gsap.to(newBody, {
                alpha: 1,
                duration: 0.15,
                ease: "power2.in"
            });
        } else {
            // 'none': Instant swap
            this._killTweensDeep(oldBody);
            if (oldBody.parent === charObj.container) {
                charObj.container.removeChild(oldBody);
            } else if (oldBody.parent) {
                oldBody.parent.removeChild(oldBody);
            }
            try { oldBody.destroy({ children: true }); } catch { }
            newBody.alpha = 1;
            this._pruneStaleBodies(charObj, [newBody]);
            this._scheduleSpriteAssetPrune('sprite-instant-old-body');
        }

        // Update charObj references
        charObj.body = newBody;
        charObj.layers = newLayers;
        charObj.spritePath = spritePath;
        charObj.config = config;
        this._configureCharacterShadow(charObj, config?.shadow);
        this.resolveVisuals(charObj.charName);

        window.dispatchEvent(new CustomEvent('vn:pixi-sprite-updated', {
            detail: { charName: charObj.charName, charObj }
        }));
    },

    _getSpriteVariantAttemptPaths(spritePath, suffix = '') {
        const dot = spritePath.lastIndexOf('.');
        if (dot === -1) return suffix ? [spritePath + suffix] : [spritePath];
        const base = spritePath.substring(0, dot);
        const ext = spritePath.substring(dot);

        // Extract directory to ensure neutral fallbacks stay in the same folder
        const lastSlash = base.lastIndexOf('/');
        const dir = lastSlash !== -1 ? base.substring(0, lastSlash + 1) : '';
        const charName = getCharacterNameFromPath(spritePath);

        // Helper to strip rotation suffixes
        const stripRotation = (pathBase) => {
            const rotations = ['_front', '_left', '_right', '_back'];
            for (const r of rotations) {
                if (pathBase.toLowerCase().endsWith(r)) return pathBase.slice(0, -r.length);
            }
            return pathBase;
        };

        const baseNoRotation = stripRotation(base);
        const attempts = [
            `${base}${suffix}${ext}`,                            // 1. Original (e.g. dehya_happy_front_blink)
            `${baseNoRotation}${suffix}${ext}`,                  // 2. Mood only (e.g. dehya_happy_blink)
            `${dir}${charName}_neutral${suffix}${ext}`,          // 3. Neutral fallback
            `${dir}${charName}_neutral_front${suffix}${ext}`     // 4. Neutral Front fallback
        ];

        // Normalize: Filter out duplicates (if base is already neutral or has _front)
        // and avoid double _front suffixes
        return Array.from(new Set(attempts))
            .filter(a => !a.includes('_front_front'));
    },

    async _loadSpriteTextureVariant(spritePath, suffix = '') {
        const uniqueAttempts = this._getSpriteVariantAttemptPaths(spritePath, suffix);

        for (let i = 0; i < uniqueAttempts.length; i++) {
            const assetUrl = getAssetUrl(uniqueAttempts[i]);
            await this._waitForSpriteAssetUnload(assetUrl);
            const cachedEntry = this.spriteAssetCache.get(assetUrl);
            if (this._isSpriteTextureUsable(cachedEntry?.texture)) {
                this._registerSpriteAsset(assetUrl, cachedEntry.texture);
                if (suffix === '') {
                    await this._primeTextureOpaqueBounds(cachedEntry.texture, uniqueAttempts[i]);
                }
                return { texture: cachedEntry.texture, assetUrl };
            }

            if (cachedEntry?.loadPromise) {
                try {
                    const texture = await cachedEntry.loadPromise;
                    if (this._isSpriteTextureUsable(texture)) {
                        this._registerSpriteAsset(assetUrl, texture);
                        if (suffix === '') {
                            await this._primeTextureOpaqueBounds(texture, uniqueAttempts[i]);
                        }
                        return { texture, assetUrl };
                    }
                } catch (err) {
                    if (i === uniqueAttempts.length - 1) {
                        if (suffix !== '') {
                            debugError(`[SpriteManager] Failed all fallbacks for ${uniqueAttempts[0]}`);
                        }
                        throw err;
                    }
                    debugLog(`[SpriteManager] ${uniqueAttempts[i]} not found, trying ${uniqueAttempts[i + 1]}...`);
                    continue;
                }
            }

            const endAssetLoad = this._beginSpriteAssetLoad(assetUrl);
            const entry = this._ensureSpriteAssetEntry(assetUrl);
            const loadPromise = (async () => {
                const texture = await this._loadSpriteTextureFromUrl(assetUrl);
                if (!this._isSpriteTextureUsable(texture)) {
                    throw new Error(`PIXI returned an unusable texture for ${assetUrl}`);
                }

                // --- HIGH QUALITY DOWNSCALING FOR NO ALIASING ---
                this._applySpriteTextureQuality(texture);
                return texture;
            })();

            if (entry) {
                entry.loadPromise = loadPromise;
                entry.lastUsed = Date.now();
            }

            try {
                const texture = await loadPromise;
                this._registerSpriteAsset(assetUrl, texture);
                if (suffix === '') {
                    await this._primeTextureOpaqueBounds(texture, uniqueAttempts[i]);
                }
                return { texture, assetUrl };
            } catch (err) {
                if (i === uniqueAttempts.length - 1) {
                    if (suffix !== '') {
                        debugError(`[SpriteManager] Failed all fallbacks for ${uniqueAttempts[0]}`);
                    }
                    throw err;
                }
                debugLog(`[SpriteManager] ${uniqueAttempts[i]} not found, trying ${uniqueAttempts[i + 1]}...`);
            } finally {
                const currentEntry = this.spriteAssetCache.get(assetUrl);
                if (currentEntry === entry && currentEntry.loadPromise === loadPromise) {
                    currentEntry.loadPromise = null;
                }
                endAssetLoad();
            }
        }

        throw new Error(`Unable to load sprite texture variant: ${spritePath}${suffix}`);
    },

    async _preloadSpriteTextureVariants(spritePath, config = {}, token = null, options = {}) {
        const loadedUrls = [];
        const transientPins = new Set();
        const prepareBase = options?.prepareBase === true;
        const isStale = () => token !== null && token !== this.spriteAdjacentPreloadToken;
        const loadOptional = async (suffix) => {
            if (isStale()) return false;
            try {
                const result = await this._loadSpriteTextureVariant(spritePath, suffix);
                if (result?.assetUrl) {
                    loadedUrls.push(result.assetUrl);
                    if (!transientPins.has(result.assetUrl)) {
                        transientPins.add(result.assetUrl);
                        this._pinSpriteAssetUrl(result.assetUrl);
                    }
                }
                if (suffix === '' && prepareBase && result?.texture && !isStale()) {
                    await this._prepareSpriteTextureForGpu(result.texture, token);
                }
                if (isStale()) {
                    this._scheduleSpriteAssetPrune('stale-vn-adjacent-load');
                    return false;
                }
                return true;
            } catch { }
            return !isStale();
        };

        try {
            if (!await loadOptional('')) return loadedUrls;
            if (config.hasBlink && !await loadOptional('_blink')) return loadedUrls;
            if (config.hasTalk && !await loadOptional('_talk')) return loadedUrls;
            if (config.hasTalkBlink) await loadOptional('_talk_blink');
            return loadedUrls;
        } finally {
            for (const assetUrl of transientPins) {
                this._unpinSpriteAssetUrl(assetUrl);
            }
        }
    },

    _collectVNLookaheadSpriteEntries(index = state.currentIndex) {
        const sequence = state.currentVN?.sequence;
        if (!Array.isArray(sequence) || !sequence[index]) return [];

        const currentEntries = this._normalizeSpriteEntries(sequence[index]?.sprites)
            .filter(entry => entry?.path);
        const nextEntries = this._normalizeSpriteEntries(sequence[index + 1]?.sprites)
            .filter(entry => entry?.path);
        const currentBySlot = new Map(currentEntries.map(entry => [String(entry.slot), entry]));
        const adjacentSlots = new Set([
            ...currentEntries.map(entry => String(entry.slot)),
            ...nextEntries.map(entry => String(entry.slot))
        ]);
        const lookaheadBySlot = new Map();

        for (const slotKey of adjacentSlots) {
            const currentEntry = currentBySlot.get(slotKey) || null;
            const currentPath = currentEntry?.path || null;

            for (let i = index + 1; i < sequence.length; i++) {
                const entries = this._normalizeSpriteEntries(sequence[i]?.sprites);
                const entry = entries.find(item => String(item.slot) === slotKey && item?.path);

                // If the slot is currently occupied and becomes empty, there is no
                // next sprite to keep warm yet. Let the old texture unload cleanly.
                if (!entry) break;

                if (!currentPath || entry.path !== currentPath) {
                    lookaheadBySlot.set(slotKey, entry);
                    break;
                }
            }
        }

        return Array.from(lookaheadBySlot.values());
    },

    _collectVNLookbehindSpriteEntries(index = state.currentIndex) {
        const sequence = state.currentVN?.sequence;
        if (!Array.isArray(sequence) || !sequence[index]) return [];

        const currentEntries = this._normalizeSpriteEntries(sequence[index]?.sprites)
            .filter(entry => entry?.path);
        const previousEntries = this._normalizeSpriteEntries(sequence[index - 1]?.sprites)
            .filter(entry => entry?.path);
        const currentBySlot = new Map(currentEntries.map(entry => [String(entry.slot), entry]));
        const adjacentSlots = new Set([
            ...currentEntries.map(entry => String(entry.slot)),
            ...previousEntries.map(entry => String(entry.slot))
        ]);
        const lookbehindBySlot = new Map();

        for (const slotKey of adjacentSlots) {
            const currentEntry = currentBySlot.get(slotKey) || null;
            const currentPath = currentEntry?.path || null;

            for (let i = index - 1; i >= 0; i--) {
                const entries = this._normalizeSpriteEntries(sequence[i]?.sprites);
                const entry = entries.find(item => String(item.slot) === slotKey && item?.path);

                // If the slot was occupied and becomes empty when going backward,
                // there is no prior texture to keep warm for that slot yet.
                if (!entry) break;

                if (!currentPath || entry.path !== currentPath) {
                    lookbehindBySlot.set(slotKey, entry);
                    break;
                }
            }
        }

        return Array.from(lookbehindBySlot.values());
    },

    async preloadVNAdjacentSprites(index = state.currentIndex) {
        const token = ++this.spriteAdjacentPreloadToken;
        if (!this._shouldPreloadVNAdjacentSprites()) {
            this.spriteLookaheadAssetUrls.clear();
            this.spriteLookbehindAssetUrls.clear();
            this._scheduleSpriteAssetPrune('vn-adjacent-preload-disabled');
            return;
        }

        const lookaheadEntries = this._collectVNLookaheadSpriteEntries(index);
        const lookbehindEntries = this._collectVNLookbehindSpriteEntries(index);
        const nextUrls = new Set();
        const previousUrls = new Set();
        this._scheduleSpriteAssetPrune('vn-adjacent-preload-refresh-start');

        for (const entry of lookaheadEntries) {
            if (token !== this.spriteAdjacentPreloadToken) return;
            try {
                const urls = await this._preloadSpriteTextureVariants(entry.path, entry, token, { prepareBase: true });
                if (token !== this.spriteAdjacentPreloadToken) {
                    this._scheduleSpriteAssetPrune('stale-vn-adjacent-preload');
                    return;
                }
                for (const url of urls) nextUrls.add(url);
                this.spriteLookaheadAssetUrls = new Set(nextUrls);
            } catch (error) {
                debugError(`[SpriteManager] VN lookahead preload failed for ${entry.path}`, error);
            }
        }

        for (const entry of lookbehindEntries) {
            if (token !== this.spriteAdjacentPreloadToken) return;
            try {
                const urls = await this._preloadSpriteTextureVariants(entry.path, entry, token, { prepareBase: false });
                if (token !== this.spriteAdjacentPreloadToken) {
                    this._scheduleSpriteAssetPrune('stale-vn-adjacent-preload');
                    return;
                }
                for (const url of urls) previousUrls.add(url);
                this.spriteLookbehindAssetUrls = new Set(previousUrls);
            } catch (error) {
                debugError(`[SpriteManager] VN lookbehind preload failed for ${entry.path}`, error);
            }
        }

        if (token !== this.spriteAdjacentPreloadToken) return;
        this.spriteLookaheadAssetUrls = nextUrls;
        this.spriteLookbehindAssetUrls = previousUrls;
        this._scheduleSpriteAssetPrune('vn-adjacent-preload-updated');
        const entryCount = lookaheadEntries.length + lookbehindEntries.length;
        const urlCount = new Set([...nextUrls, ...previousUrls]).size;
        if (entryCount > 0) {
            debugLog(`[SpriteManager] VN adjacent preload pinned ${urlCount} asset(s) across ${entryCount} slot change(s).`);
        }
    },

    async preloadVNLookaheadSprites(index = state.currentIndex) {
        return this.preloadVNAdjacentSprites(index);
    },

    async _loadLayers(spritePath, config) {
        const layers = {};
        Object.defineProperty(layers, '__assetUrls', {
            value: [],
            enumerable: false,
            configurable: true,
            writable: true
        });

        const loadLayer = async (suffix = '') => {
            const result = await this._loadSpriteTextureVariant(spritePath, suffix);
            this._trackLayerSetAsset(layers, result.assetUrl);
            return new PIXI.Sprite(result.texture);
        };

        layers.base = await loadLayer('');

        if (config.hasBlink) {
            try { layers.blink = await loadLayer('_blink'); } catch { }
        }
        if (config.hasTalk) {
            try { layers.talk = await loadLayer('_talk'); } catch { }
        }
        if (config.hasTalkBlink) {
            try { layers.talkBlink = await loadLayer('_talk_blink'); } catch { }
        }

        return layers;
    },

    _setLayerAlpha(layer, alpha) {
        if (layer && layer.alpha !== alpha) {
            layer.alpha = alpha;
        }
    },

    resolveVisuals(charName) {
        const charObj = this._getActiveSpriteRepresenting(charName);
        if (!charObj) return;

        const { layers, config, isTalking, isBlinking, isMouthOpen } = charObj;
        const mouthShouldBeOpen = isTalking && isMouthOpen;
        let activeLayer = 'base';

        if (mouthShouldBeOpen && isBlinking && config.hasTalkBlink && layers.talkBlink) {
            activeLayer = 'talkBlink';
        } else if (mouthShouldBeOpen && config.hasTalk && layers.talk) {
            activeLayer = 'talk';
        } else if (isBlinking && config.hasBlink && layers.blink) {
            activeLayer = 'blink';
        }

        this._setLayerAlpha(layers.base, activeLayer === 'base' ? 1 : 0);
        this._setLayerAlpha(layers.blink, activeLayer === 'blink' ? 1 : 0);
        this._setLayerAlpha(layers.talk, activeLayer === 'talk' ? 1 : 0);
        this._setLayerAlpha(layers.talkBlink, activeLayer === 'talkBlink' ? 1 : 0);
    },

    startTalking(rawCharName) {
        const charName = normalizeCharacterKey(rawCharName);
        if (!charName) return;
        const charObj = this._getActiveSpriteRepresenting(charName);
        if (!charObj || !charObj.config.hasTalk) return;
        const intervalKey = normalizeCharacterKey(charObj.charName) || charName;

        charObj.isTalking = true;
        charObj.isMouthOpen = true;
        this.resolveVisuals(intervalKey);

        if (this.muppetIntervals[intervalKey]) clearInterval(this.muppetIntervals[intervalKey]);
        this.muppetIntervals[intervalKey] = setInterval(() => {
            charObj.isMouthOpen = !charObj.isMouthOpen;
            this.resolveVisuals(intervalKey);
        }, 200);
    },

    stopTalking(rawCharName) {
        const charName = normalizeCharacterKey(rawCharName);
        if (!charName) return;
        const charObj = this._getActiveSpriteRepresenting(charName);
        if (!charObj) return;
        const intervalKey = normalizeCharacterKey(charObj.charName) || charName;

        charObj.isTalking = false;
        charObj.isMouthOpen = false;
        if (this.muppetIntervals[intervalKey]) {
            clearInterval(this.muppetIntervals[intervalKey]);
            delete this.muppetIntervals[intervalKey];
        }
        this.resolveVisuals(intervalKey);
    },

    stopAllTalking() {
        for (const charName in this.activeSprites) {
            this.stopTalking(charName);
        }
    },

    syncTalkingState(rawCharName) {
        const charName = normalizeCharacterKey(rawCharName);
        if (!charName) return;

        const representedCharacter = normalizeCharacterKey(this._getActiveSprite(charName)?.charName || charName);
        if (state.isAudioPlaying && !!state.activeTalkingCharacters?.[representedCharacter]) {
            this.startTalking(charName);
            return;
        }

        this.stopTalking(charName);
    },

    repositionAll() {
        const sequence = state.currentVN?.sequence;
        if (!sequence || !sequence[state.currentIndex]) return;

        const sprites = sequence[state.currentIndex].sprites;

        const spriteArray = this._normalizeSpriteEntries(sprites);

        const slotXPositions = this._getSlotPositions(spriteArray.length, spriteArray.map(s => s.slot));

        for (const charName in this.activeSprites) {
            const charObj = this.activeSprites[charName];
            const spriteData = spriteArray.find(s => getSpriteCharacterKey(s) === charName);

            if (spriteData) {
                this._applySpriteTransform(charObj, spriteData, slotXPositions, spriteArray.length);
            }
        }
    },

    updateVerticalOffset(offset) {
        void offset; // Offset is consumed via state in repositionAll.
        this.repositionAll();
    },

    updateSpriteMultiplier(_multiplier) {
        void _multiplier; // Multiplier is consumed via state in repositionAll.
        this.repositionAll();
    },

    updateHorizontalPadding(_paddingPercent) {
        void _paddingPercent; // Padding is consumed via state in repositionAll.
        this.repositionAll();
    },

    updateSpriteVisibility() {
        const hidden = this._shouldHideMainSprites();
        for (const charName in this.activeSprites) {
            this._applyMainSpriteVisibility(this.activeSprites[charName], hidden);
        }
    },

    _collectCurrentSceneSpriteEntries() {
        const scene = state.currentVN?.sequence?.[state.currentIndex];
        const sprites = scene?.sprites;
        if (!sprites) return [];
        return this._normalizeSpriteEntries(sprites);
    },

    _resolveSceneSpriteForCharacter(rawCharacter) {
        const target = normalizeCharacterKey(rawCharacter);
        if (!target) return null;
        const entries = this._collectCurrentSceneSpriteEntries();
        return entries.find((entry) => getSpriteCharacterKey(entry) === target) || null;
    },

    _resolvePluginActorSource(options = {}) {
        if (typeof options.spritePath === 'string' && options.spritePath.trim()) {
            return {
                spritePath: options.spritePath.trim(),
                config: {},
                referenceScale: null,
                referenceX: null,
                referenceY: null
            };
        }

        const preferredCharacter = normalizeCharacterKey(options.character || options.referenceCharacter);
        if (preferredCharacter) {
            const liveChar = this.activeSprites[preferredCharacter];
            if (liveChar && !this._isPluginActor(liveChar) && liveChar.spritePath) {
                return {
                    spritePath: liveChar.spritePath,
                    config: { ...(liveChar.config || {}) },
                    referenceScale: Number.isFinite(liveChar.container?.scale?.x) ? liveChar.container.scale.x : null,
                    referenceX: Number.isFinite(liveChar.container?.x) ? liveChar.container.x : null,
                    referenceY: Number.isFinite(liveChar.container?.y) ? liveChar.container.y : null
                };
            }

            const sceneSprite = this._resolveSceneSpriteForCharacter(preferredCharacter);
            if (sceneSprite?.path) {
                return {
                    spritePath: sceneSprite.path,
                    config: {
                        hasBlink: sceneSprite.hasBlink === true,
                        hasTalk: sceneSprite.hasTalk === true,
                        hasTalkBlink: sceneSprite.hasTalkBlink === true
                    },
                    referenceScale: null,
                    referenceX: null,
                    referenceY: null
                };
            }
        }

        return null;
    },

    _applyPluginActorTransform(charObj, options = {}, source = {}) {
        if (!charObj?.container || !charObj?.layers?.base?.texture) return;

        const baseTexture = charObj.layers.base.texture;
        const baseWidth = Math.max(1, baseTexture.width || 1);
        const baseHeight = Math.max(1, baseTexture.height || 1);

        const width = Number(options.width);
        const height = Number(options.height);
        const scale = Number(options.scale);
        const scaleX = Number(options.scaleX);
        const scaleY = Number(options.scaleY);
        const flipX = Number(options.flipX);
        const hasFlipX = Number.isFinite(flipX) && flipX !== 0;
        const flipSign = hasFlipX && flipX < 0 ? -1 : 1;
        const applyFlipX = (value) => hasFlipX ? Math.abs(value) * flipSign : value;

        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
            charObj.container.scale.set(applyFlipX(width / baseWidth), height / baseHeight);
        } else if (Number.isFinite(width) && width > 0) {
            const ratio = width / baseWidth;
            charObj.container.scale.set(applyFlipX(ratio), ratio);
        } else if (Number.isFinite(height) && height > 0) {
            const ratio = height / baseHeight;
            charObj.container.scale.set(applyFlipX(ratio), ratio);
        } else if (Number.isFinite(scaleX) || Number.isFinite(scaleY)) {
            const resolvedX = Number.isFinite(scaleX) ? scaleX : (Number.isFinite(scaleY) ? scaleY : 1);
            const resolvedY = Number.isFinite(scaleY) ? scaleY : resolvedX;
            charObj.container.scale.set(applyFlipX(resolvedX), resolvedY);
        } else if (Number.isFinite(scale) && scale > 0) {
            charObj.container.scale.set(applyFlipX(scale), scale);
        } else if (Number.isFinite(source.referenceScale) && source.referenceScale > 0) {
            charObj.container.scale.set(applyFlipX(source.referenceScale), source.referenceScale);
        } else if (hasFlipX) {
            const currentX = Number(charObj.container.scale?.x);
            const currentY = Number(charObj.container.scale?.y);
            const fallbackScale = Math.abs(Number.isFinite(currentX) && currentX !== 0 ? currentX : 1);
            const fallbackY = Math.abs(Number.isFinite(currentY) && currentY !== 0 ? currentY : fallbackScale);
            charObj.container.scale.set(fallbackScale * flipSign, fallbackY);
        } else {
            this._resizeCharacterToFit(charObj);
        }

        const defaultY = pixiApp.LOGICAL_HEIGHT + (state.vnSettings.visuals?.sprite_offset || 0);
        const resolvedX = Number.isFinite(Number(options.x))
            ? Number(options.x)
            : (Number.isFinite(source.referenceX) ? source.referenceX : (pixiApp.LOGICAL_WIDTH * 0.5));
        const resolvedY = Number.isFinite(Number(options.y))
            ? Number(options.y)
            : (Number.isFinite(source.referenceY) ? source.referenceY : defaultY);

        charObj.container.x = resolvedX;
        charObj.container.y = resolvedY;

        const alpha = Number(options.alpha);
        if (Number.isFinite(alpha)) {
            charObj.container.alpha = Math.max(0, Math.min(1, alpha));
        }

        const zIndex = Number(options.zIndex);
        if (Number.isFinite(zIndex)) {
            charObj.container.zIndex = zIndex;
        }

        this._syncCharacterShadow(charObj);
    },

    async spawnPluginActor(options = {}) {
        const rawActorId = options.actorId || options.id || options.character || `actor_${Date.now()}`;
        const actorKey = this._normalizePluginActorId(rawActorId);
        if (!actorKey) {
            throw new Error('spawnPluginActor requires a valid actorId.');
        }

        if (this.activeSprites[actorKey]) {
            this.removePluginActor(actorKey, 'respawn');
        }

        const source = this._resolvePluginActorSource(options);
        if (!source?.spritePath) {
            throw new Error(`Unable to resolve sprite source for actor '${rawActorId}'. Provide spritePath or a visible character reference.`);
        }

        const config = {
            hasBlink: options.hasBlink === true || source.config?.hasBlink === true,
            hasTalk: options.hasTalk === true || source.config?.hasTalk === true,
            hasTalkBlink: options.hasTalkBlink === true || source.config?.hasTalkBlink === true,
            shadow: options.shadow
        };

        const charObj = await this._createCharacterSprite(actorKey, source.spritePath, config);
        if (!charObj) {
            throw new Error(`Failed to create actor '${rawActorId}'.`);
        }

        charObj.isPluginActor = true;
        charObj.pluginActorId = actorKey;
        charObj.pluginSourceCharacter = normalizeCharacterKey(options.character || options.referenceCharacter) || null;
        charObj.container.sortableChildren = true;

        const layer =
            pixiApp.layers.interceptActors ||
            pixiApp.layers.characters ||
            pixiApp.world ||
            pixiApp.app?.stage;
        if (!layer) {
            charObj.container.destroy({ children: true });
            throw new Error('PIXI layer unavailable for plugin actor rendering.');
        }

        layer.addChild(charObj.container);
        this._applyPluginActorTransform(charObj, options, source);

        this.activeSprites[actorKey] = charObj;
        if (config.hasBlink) {
            this.startBlinking(actorKey);
        }
        this.syncTalkingState(actorKey);
        if (options.talking === true) {
            this.startTalking(actorKey);
        }

        window.dispatchEvent(new CustomEvent('vn:pixi-sprite-ready', {
            detail: { charName: actorKey, charObj, isPluginActor: true }
        }));

        return actorKey;
    },

    async updatePluginActor(rawActorId, patch = {}) {
        const actorKey = this._normalizePluginActorId(rawActorId) || normalizeCharacterKey(rawActorId);
        if (!actorKey) return null;
        const charObj = this.activeSprites[actorKey];
        if (!charObj || !this._isPluginActor(charObj)) return null;
        const hasShadowPatch = Object.prototype.hasOwnProperty.call(patch, 'shadow');

        if (typeof patch.spritePath === 'string' && patch.spritePath.trim() && patch.spritePath.trim() !== charObj.spritePath) {
            const updatedConfig = {
                hasBlink: patch.hasBlink === true || charObj.config?.hasBlink === true,
                hasTalk: patch.hasTalk === true || charObj.config?.hasTalk === true,
                hasTalkBlink: patch.hasTalkBlink === true || charObj.config?.hasTalkBlink === true,
                shadow: hasShadowPatch ? patch.shadow : charObj.config?.shadow
            };
            await this._updateCharacterTextures(charObj, patch.spritePath.trim(), updatedConfig);
            if (updatedConfig.hasBlink && !charObj.blinkTimeout) {
                this.startBlinking(actorKey);
            }
        } else if (hasShadowPatch) {
            charObj.config = {
                ...(charObj.config || {}),
                shadow: patch.shadow
            };
            this._configureCharacterShadow(charObj, patch.shadow);
        }

        const hasTransformPatch = [
            'x',
            'y',
            'width',
            'height',
            'scale',
            'scaleX',
            'scaleY',
            'flipX',
            'alpha',
            'zIndex'
        ].some((key) => Object.prototype.hasOwnProperty.call(patch, key));

        if (hasTransformPatch) {
            this._applyPluginActorTransform(charObj, patch, {
                referenceScale: Number.isFinite(charObj.container?.scale?.x) ? charObj.container.scale.x : null,
                referenceX: Number.isFinite(charObj.container?.x) ? charObj.container.x : null,
                referenceY: Number.isFinite(charObj.container?.y) ? charObj.container.y : null
            });
        }

        if (patch.talking === true) this.startTalking(actorKey);
        if (patch.talking === false) this.stopTalking(actorKey);

        window.dispatchEvent(new CustomEvent('vn:pixi-sprite-updated', {
            detail: { charName: actorKey, charObj, isPluginActor: true }
        }));

        return actorKey;
    },

    removePluginActor(rawActorId, reason = 'plugin-removed') {
        const actorKey = this._normalizePluginActorId(rawActorId) || normalizeCharacterKey(rawActorId);
        if (!actorKey) return false;
        const charObj = this.activeSprites[actorKey];
        if (!charObj || !this._isPluginActor(charObj)) return false;

        this.stopTalking(actorKey);
        if (charObj.blinkTimeout) {
            clearTimeout(charObj.blinkTimeout);
            charObj.blinkTimeout = null;
        }

        window.dispatchEvent(new CustomEvent('vn:pixi-sprite-removed', {
            detail: { charName: actorKey, charObj, isPluginActor: true, reason }
        }));

        this._killTweensDeep(charObj.container);
        if (charObj.container?.parent) {
            charObj.container.parent.removeChild(charObj.container);
        }
        this._destroyCharacterShadow(charObj);
        try { charObj.container?.destroy?.({ children: true }); } catch { }
        this._scheduleSpriteAssetPrune('plugin-actor-remove');

        delete this.activeSprites[actorKey];
        if (this.muppetIntervals[actorKey]) {
            clearInterval(this.muppetIntervals[actorKey]);
            delete this.muppetIntervals[actorKey];
        }
        return true;
    },

    clearPluginActors() {
        const keys = Object.keys(this.activeSprites).filter((key) => this._isPluginActor(this.activeSprites[key]));
        for (const key of keys) {
            this.removePluginActor(key, 'clear-all');
        }
    },

    // --- Blink Logic ---
    startBlinking(charName) {
        const charObj = this._getActiveSprite(charName);
        if (!charObj || !charObj.config.hasBlink) {
            console.log(`[ANIM DEBUG] startBlinking(${charName}) SKIPPED: charObj=${!!charObj}, hasBlink=${charObj?.config?.hasBlink}`);
            return;
        }

        console.log(`[ANIM DEBUG] startBlinking(${charName}) STARTED`);
        this._scheduleNextBlink(charName);
    },

    _scheduleNextBlink(charName) {
        const charObj = this._getActiveSprite(charName);
        if (!charObj) return;

        const nextBlinkTime = Math.random() * 3000 + 2000;
        charObj.blinkTimeout = setTimeout(() => {
            this._triggerBlink(charName);
        }, nextBlinkTime);
    },

    _triggerBlink(charName) {
        const charObj = this._getActiveSprite(charName);
        if (!charObj) return;

        charObj.isBlinking = true;
        this.resolveVisuals(charName);

        setTimeout(() => {
            const activeChar = this._getActiveSprite(charName);
            if (activeChar) {
                activeChar.isBlinking = false;
                this.resolveVisuals(charName);
                this._scheduleNextBlink(charName);
            }
        }, 150);
    },

    // --- FX Utilities ---
    addFX(charName, position, displayObject) {
        const char = this._getActiveSprite(charName);
        if (!char) return;
        if (position === 'back') char.backFX.addChild(displayObject);
        if (position === 'front') char.frontFX.addChild(displayObject);
    },

    clearFX(charName) {
        const char = this._getActiveSprite(charName);
        if (!char) return;
        const shadowDisplay = char.shadow?.displayObject || null;
        for (const child of [...char.backFX.children]) {
            if (child === shadowDisplay) continue;
            char.backFX.removeChild(child);
        }
        if (shadowDisplay && shadowDisplay.parent !== char.backFX) {
            char.backFX.addChildAt(shadowDisplay, 0);
        } else if (shadowDisplay) {
            try { char.backFX.setChildIndex(shadowDisplay, 0); } catch { }
        }
        char.frontFX.removeChildren();
        char.body.filters = null; // Clear any body filters
    },

    // --- New Cam/Zoom Helpers ---
    getCharacterInfo(charName) {
        const normalizedName = normalizeCharacterKey(charName);
        if (!normalizedName) return null;
        const charObj = this._getActiveSprite(normalizedName);
        if (!charObj) return null;

        // Returns absolute logical coordinates and dimensions
        // Note: container.y is the baseline (feet), and anchor is (0.5, 1)
        // Convert screen-space bounds back to logical world-space
        // However, it's easier to just use the logical properties directly
        const width = charObj.layers.base.texture.width * charObj.container.scale.x;
        const height = charObj.layers.base.texture.height * charObj.container.scale.y;
        const x = charObj.container.x - (width / 2); // Center-anchored
        const y = charObj.container.y - height;      // Bottom-anchored

        return { x, y, width, height };
    },

    getCharacterVisibleInfo(charName) {
        const normalizedName = normalizeCharacterKey(charName);
        const charObj = this._getActiveSprite(normalizedName);
        const info = this.getCharacterInfo(normalizedName);
        if (!charObj?.layers?.base?.texture || !info) return info;

        const opaqueBounds = this._getTextureOpaqueBounds(charObj.layers.base.texture);
        const scaleX = charObj.container.scale.x;
        const scaleY = charObj.container.scale.y;
        return {
            ...info,
            x: info.x + (opaqueBounds.x * scaleX),
            y: info.y + (opaqueBounds.y * scaleY),
            width: opaqueBounds.width * scaleX,
            height: opaqueBounds.height * scaleY,
            detected: opaqueBounds.detected
        };
    },


    setFocusCharacter(charName, options = {}) {
        const targetKey = normalizeCharacterKey(charName);
        if (!targetKey) return;
        const targetDurationRaw = Number(options?.duration);
        const targetDuration = Number.isFinite(targetDurationRaw) ? Math.max(0, targetDurationRaw) : 0.5;
        for (const name in this.activeSprites) {
            const charObj = this.activeSprites[name];
            if (!charObj?.container || charObj.container.destroyed) continue;
            // We use alpha instead of visible to avoid breaking any plugins that rely on .visible
            // but for "hiding" in this context, alpha 0 is clean.
            const isTarget = normalizeCharacterKey(name) === targetKey;
            const alpha = isTarget ? 1 : 0;
            const duration = isTarget ? targetDuration : 0;
            if (duration === 0) {
                this._killAlphaTween(charObj.container);
                charObj.container.alpha = alpha;
            } else {
                gsap.to(charObj.container, {
                    alpha,
                    duration,
                    ease: "power2.out",
                    overwrite: "auto"
                });
            }
        }
    },

    clearFocus() {
        for (const name in this.activeSprites) {
            const charObj = this.activeSprites[name];
            if (!charObj?.container || charObj.container.destroyed) continue;
            gsap.to(charObj.container, {
                alpha: 1,
                duration: 0.5,
                ease: "power2.out"
            });
        }
    },

    _getDirectionalVariantCache(charObj) {
        if (!charObj || typeof charObj.spritePath !== 'string') return null;
        const dot = charObj.spritePath.lastIndexOf('.');
        if (dot <= 0) return null;

        const baseWithRotation = charObj.spritePath.substring(0, dot);
        const ext = charObj.spritePath.substring(dot);
        const base = baseWithRotation.replace(/_(front|left|right|back)$/i, '');
        const cacheKey = `${base}${ext}`;

        if (!charObj.directionalVariantCache || charObj.directionalVariantCache.cacheKey !== cacheKey) {
            charObj.directionalVariantCache = {
                cacheKey,
                base,
                ext,
                variants: Object.create(null)
            };
        }

        return charObj.directionalVariantCache;
    },

    async _getDirectionalVariantPath(charObj, direction) {
        const normalizedDirection = String(direction || '').toLowerCase();
        if (!['front', 'left', 'right', 'back'].includes(normalizedDirection)) return null;

        const cache = this._getDirectionalVariantCache(charObj);
        if (!cache) return null;

        if (Object.prototype.hasOwnProperty.call(cache.variants, normalizedDirection)) {
            return cache.variants[normalizedDirection] || null;
        }

        const candidate = `${cache.base}_${normalizedDirection}${cache.ext}`;
        if (candidate === charObj.spritePath) {
            cache.variants[normalizedDirection] = candidate;
            return candidate;
        }

        try {
            if (await this._spriteAssetUrlExists(getAssetUrl(candidate))) {
                cache.variants[normalizedDirection] = candidate;
                return candidate;
            }
        } catch {
        }

        cache.variants[normalizedDirection] = null;
        debugLog(`[SpriteManager] Directional variant missing for ${charObj.charName}: ${candidate}`);
        return null;
    },

    async _swapCharacterTextureImmediate(charObj, spritePath) {
        if (!charObj?.container || !charObj?.body || !spritePath) return false;
        if (charObj.spritePath === spritePath) return true;

        let newLayers;
        try {
            newLayers = await this._loadLayers(spritePath, charObj.config || {});
        } catch (_err) {
            debugLog(`[SpriteManager] Failed to load directional sprite for ${charObj.charName}: ${spritePath}`);
            return false;
        }

        const oldBody = charObj.body;
        if (!oldBody || oldBody.destroyed || oldBody.parent !== charObj.container) {
            this._destroyLayerSet(newLayers);
            return false;
        }

        const newBody = new PIXI.Container();
        newBody.label = "body";
        newBody.alpha = 1;
        newBody.addChild(newLayers.base);
        if (newLayers.blink) { newLayers.blink.alpha = 0; newBody.addChild(newLayers.blink); }
        if (newLayers.talk) { newLayers.talk.alpha = 0; newBody.addChild(newLayers.talk); }
        if (newLayers.talkBlink) { newLayers.talkBlink.alpha = 0; newBody.addChild(newLayers.talkBlink); }
        newBody.children.forEach(c => {
            if (c instanceof PIXI.Sprite) c.anchor.set(0.5, 1);
        });

        const bodyIndex = charObj.container.getChildIndex(oldBody);
        const frontFXIndex = charObj.container.getChildIndex(charObj.frontFX);
        const targetIndex = Math.min(bodyIndex + 1, frontFXIndex);
        charObj.container.addChildAt(newBody, targetIndex);
        this._releaseLayerSetAssetPins(newLayers);

        this._killTweensDeep(oldBody);
        try { charObj.container.removeChild(oldBody); } catch { }
        try { oldBody.destroy({ children: true }); } catch { }

        this._pruneStaleBodies(charObj, [newBody]);

        charObj.body = newBody;
        charObj.layers = newLayers;
        charObj.spritePath = spritePath;
        this.resolveVisuals(charObj.charName);

        window.dispatchEvent(new CustomEvent('vn:pixi-sprite-updated', {
            detail: { charName: charObj.charName, charObj }
        }));

        return true;
    },

    async _setPanicFacing(charObj, direction, panicState) {
        if (!charObj?.container || !panicState) return;

        const normalizedDirection = String(direction || '').toLowerCase();
        if (!['left', 'right'].includes(normalizedDirection)) return;

        const directionalPath = await this._getDirectionalVariantPath(charObj, normalizedDirection);
        if (directionalPath) {
            await this._swapCharacterTextureImmediate(charObj, directionalPath);
            charObj.container.scale.x = panicState.baseScaleX;
            return;
        }

        const dirSign = normalizedDirection === 'left' ? -1 : 1;
        charObj.container.scale.x = panicState.baseScaleAbs * panicState.baseScaleSign * dirSign;
    },

    _tweenCharacterTo(charObj, tweenParams = {}) {
        return new Promise((resolve) => {
            if (!charObj?.container || charObj.container.destroyed) {
                resolve(false);
                return;
            }

            try {
                gsap.to(charObj.container, {
                    ...tweenParams,
                    onComplete: () => resolve(true),
                    onInterrupt: () => resolve(false)
                });
            } catch (_) {
                resolve(false);
            }
        });
    },

    _getPanicHorizontalBounds(charObj, stageWidth) {
        const spatialState = charObj?.spatialStageState;
        if (spatialState?.active && Number.isFinite(Number(spatialState.depth))) {
            const bounds = pixiSpatialStage.getHorizontalBoundsAtDepth({
                backgroundPath: state.currentBackground,
                projectName: state.currentVN?.projectName || null,
                depth: Number(spatialState.depth)
            });
            const width = Number(bounds?.rightX) - Number(bounds?.leftX);
            if (bounds && Number.isFinite(width) && width > 80) {
                const inset = Math.min(Math.max(24, width * 0.06), width * 0.28);
                return {
                    leftEdge: bounds.leftX + inset,
                    rightEdge: bounds.rightX - inset
                };
            }
        }

        const edgeInset = Math.max(48, stageWidth * 0.1);
        return {
            leftEdge: edgeInset,
            rightEdge: stageWidth - edgeInset
        };
    },

    // --- Animations ---
    bounce(charName) {
        const char = this._getActiveSprite(charName);
        if (!char) return;
        const tl = gsap.timeline();
        const baseV = char.container.y;
        tl.to(char.container, { y: baseV - 40, duration: 0.1, ease: "power2.out" })
            .to(char.container, { y: baseV, duration: 0.2, ease: "bounce.out" });
    },

    shake(charName) {
        const char = this._getActiveSprite(charName);
        if (!char) return;
        const tl = gsap.timeline();
        const baseX = char.container.x;
        tl.to(char.container, { x: baseX - 10, duration: 0.05 })
            .to(char.container, { x: baseX + 10, duration: 0.05 })
            .to(char.container, { x: baseX - 10, duration: 0.05 })
            .to(char.container, { x: baseX + 10, duration: 0.05 })
            .to(char.container, { x: baseX, duration: 0.05 });
    },

    sink(charName) {
        const char = this._getActiveSprite(charName);
        if (!char) return;
        const baseV = char.container.y;
        gsap.to(char.container, {
            y: baseV + 20,
            duration: 0.4,
            ease: "power2.inOut",
            yoyo: true,
            repeat: 1
        });
    },

    slowSink(charName) {
        const char = this._getActiveSprite(charName);
        if (!char) return;
        const baseV = char.container.y;
        gsap.to(char.container, {
            y: baseV + 20,
            duration: 1.2,
            ease: "power1.inOut",
            yoyo: true,
            repeat: 1
        });
    },

    async panic(charName) {
        const char = this._getActiveSprite(charName);
        if (!char?.container) return;
        if (char.isPanicking) return; // Non-looping one-shot; ignore overlap.

        char.isPanicking = true;

        const stageWidth = pixiApp.LOGICAL_WIDTH;
        const panicState = {
            originalSpritePath: char.spritePath,
            originX: Number.isFinite(char.container.x) ? char.container.x : (stageWidth * 0.5),
            baseY: Number.isFinite(char.container.y) ? char.container.y : pixiApp.LOGICAL_HEIGHT,
            baseScaleX: Number.isFinite(char.container.scale?.x) ? char.container.scale.x : 1
        };
        panicState.baseScaleAbs = Math.max(Math.abs(panicState.baseScaleX), 0.0001);
        panicState.baseScaleSign = panicState.baseScaleX < 0 ? -1 : 1;

        const { leftEdge, rightEdge } = this._getPanicHorizontalBounds(char, stageWidth);

        if (!(leftEdge < rightEdge)) {
            char.isPanicking = false;
            return;
        }

        const firstDirection = Math.random() < 0.5 ? 'left' : 'right';
        const secondDirection = firstDirection === 'left' ? 'right' : 'left';
        const firstX = firstDirection === 'left' ? leftEdge : rightEdge;
        const secondX = secondDirection === 'left' ? leftEdge : rightEdge;

        try {
            this._killTweensDeep(char.container);

            await this._setPanicFacing(char, firstDirection, panicState);
            await this._tweenCharacterTo(char, { x: firstX, duration: 0.63, ease: "none" });

            await this._setPanicFacing(char, secondDirection, panicState);
            await this._tweenCharacterTo(char, { x: secondX, duration: 0.83, ease: "none" });

            const returnDirection = panicState.originX < secondX ? 'left' : 'right';
            await this._setPanicFacing(char, returnDirection, panicState);
            await this._tweenCharacterTo(char, { x: panicState.originX, duration: 0.63, ease: "sine.inOut" });
        } catch (err) {
            debugError(`[SpriteManager] Panic animation failed for ${charName}`, err);
        } finally {
            const liveChar = this._getActiveSprite(charName);
            if (!liveChar?.container) return;

            try {
                if (panicState.originalSpritePath && liveChar.spritePath !== panicState.originalSpritePath) {
                    await this._swapCharacterTextureImmediate(liveChar, panicState.originalSpritePath);
                }
            } catch { }

            liveChar.container.x = panicState.originX;
            liveChar.container.y = panicState.baseY;
            liveChar.container.scale.x = panicState.baseScaleX;
            liveChar.isPanicking = false;
        }
    },

    async showEmote(charName, emoteType) {
        const char = this._getActiveSprite(charName);
        if (!char) return;

        try {
            let emoteId = emoteType.toLowerCase().trim();
            if (emoteId === 'heart') emoteId = 'hearts';

            const assetPath = `./assets/emotes/${emoteId}.webp`;

            // 1. Load using the custom animated decoder
            const { loadAnimatedWebP } = await import('./animated_webp_loader.js');
            const emoteSprite = await loadAnimatedWebP(assetPath);

            const emoteContainer = new PIXI.Container();
            emoteContainer.label = `EmoteContainer_${emoteId}`;
            char.frontFX.addChild(emoteContainer);

            // 2. Setup Sprite
            emoteSprite.anchor.set(0.5, 0.5);
            emoteContainer.addChild(emoteSprite);

            // 3. Positioning: Target the head area (82% up), Top-Left
            const rawWidth = char.layers.base.texture.width;
            const rawHeight = char.layers.base.texture.height;

            emoteContainer.x = -(rawWidth * 0.22); // Shift Left
            emoteContainer.y = -(rawHeight * 0.92); // Head level (raised from 0.82)
            const opaqueBounds = this._getTextureOpaqueBounds(char.layers.base.texture);
            const contentLeft = -(rawWidth / 2) + opaqueBounds.x;
            const contentTop = -rawHeight + opaqueBounds.y;
            const contentCenterX = contentLeft + (opaqueBounds.width / 2);

            // Re-anchor effects to the actual visible art, not transparent padding.
            emoteContainer.x = contentCenterX - (opaqueBounds.width * 0.22);
            emoteContainer.y = contentTop + (opaqueBounds.height * 0.08);


            // 4. Scaling: 75% smaller than the previous 250px target (approx 62px)
            const stageScale = char.container.scale.x;
            const targetLogicalSize = 62;
            const finalScale = (targetLogicalSize / emoteSprite.texture.height) / stageScale;

            emoteContainer.scale.set(0);

            // 5. Animation & Playback
            emoteSprite.play?.();

            gsap.to(emoteContainer.scale, {
                x: finalScale,
                y: finalScale,
                duration: 0.25,
                ease: "back.out(2)"
            });

            // 6. Cleanup
            setTimeout(() => {
                if (emoteContainer.parent && !emoteContainer.destroyed) {
                    gsap.to(emoteContainer, {
                        alpha: 0,
                        duration: 0.5,
                        onComplete: () => {
                            emoteContainer.destroy({ children: true });
                        }
                    });
                }
            }, 2500);

        } catch (err) {
            debugError(`[Emote] Failed to show ${emoteType}`, err);
        }
    }
};

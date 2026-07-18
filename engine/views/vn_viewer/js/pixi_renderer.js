import { pixiApp } from './pixi_engine.js';
import { state } from './state.js';
import { debugLog, debugError, getAssetUrl } from './utils.js';

const FOREGROUND_OCCLUSION_SUFFIX = '_foreground';
const FOREGROUND_OCCLUSION_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];

function killTweensDeep(displayObject) {
    if (!displayObject || typeof gsap === 'undefined') return;
    try { gsap.killTweensOf(displayObject); } catch (_) { }
    try { gsap.killTweensOf(displayObject.position); } catch (_) { }
    try { gsap.killTweensOf(displayObject.pivot); } catch (_) { }
    try { gsap.killTweensOf(displayObject.scale); } catch (_) { }
    try { gsap.killTweensOf(displayObject.skew); } catch (_) { }
    if (Array.isArray(displayObject.children)) {
        for (const child of displayObject.children) killTweensDeep(child);
    }
}

function isRemoteOrOpaqueAsset(src) {
    const value = String(src || '').trim().toLowerCase();
    return value.startsWith('http://')
        || value.startsWith('https://')
        || value.startsWith('data:')
        || value.startsWith('blob:');
}

function stripUrlDecorators(value) {
    return String(value || '').replace(/\\/g, '/').split(/[?#]/)[0];
}

function isForegroundOcclusionAsset(src) {
    const clean = stripUrlDecorators(src);
    const filename = clean.split('/').pop() || '';
    const dotIndex = filename.lastIndexOf('.');
    const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
    return base.toLowerCase().endsWith(FOREGROUND_OCCLUSION_SUFFIX);
}

function getForegroundOcclusionCandidates(src) {
    if (!src || isRemoteOrOpaqueAsset(src) || isForegroundOcclusionAsset(src)) return [];
    const clean = stripUrlDecorators(src);
    const slashIndex = clean.lastIndexOf('/');
    const dir = slashIndex >= 0 ? clean.slice(0, slashIndex + 1) : '';
    const filename = slashIndex >= 0 ? clean.slice(slashIndex + 1) : clean;
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex <= 0) return [];

    const base = filename.slice(0, dotIndex);
    return FOREGROUND_OCCLUSION_IMAGE_EXTENSIONS.map(ext => `${dir}${base}${FOREGROUND_OCCLUSION_SUFFIX}${ext}`);
}

export const pixiRenderer = {
    backgroundSprite: null,
    backgroundVideo: null,
    foregroundOcclusionSprite: null,
    cgSprite: null,
    bgSnapshotTexture: null,
    currentSrc: null,
    currentIsVideo: false,
    currentForegroundOcclusionSrc: null,
    backgroundUpdateToken: 0,
    cgUpdateToken: 0,
    foregroundOcclusionLookupCache: new Map(),
    visualAssetCache: new Map(),

    _textureApproxMb(texture) {
        const width = Number(texture?.width) || 0;
        const height = Number(texture?.height) || 0;
        return width && height ? Number(((width * height * 4) / (1024 * 1024)).toFixed(1)) : 0;
    },

    _getForegroundBackgroundBlurStrength() {
        const raw = Number(state.vnSettings?.visuals?.foreground_background_blur_strength);
        if (!Number.isFinite(raw) || raw <= 0) return 0;
        return Math.min(20, raw);
    },

    _applyForegroundBackgroundBlurToDisplay(displayObject, hasForegroundOcclusion = false) {
        if (!displayObject || displayObject.destroyed) return;

        const strength = hasForegroundOcclusion ? this._getForegroundBackgroundBlurStrength() : 0;
        let blurFilter = displayObject.__vnForegroundBackgroundBlurFilter || null;
        const existingFilters = Array.isArray(displayObject.filters)
            ? displayObject.filters.filter(filter => filter && filter !== blurFilter)
            : [];

        if (strength > 0) {
            if (!blurFilter) {
                blurFilter = new PIXI.BlurFilter();
                blurFilter.quality = 3;
                displayObject.__vnForegroundBackgroundBlurFilter = blurFilter;
            }
            blurFilter.blur = strength;
            displayObject.filters = [...existingFilters, blurFilter];
            return;
        }

        if (blurFilter) {
            displayObject.__vnForegroundBackgroundBlurFilter = null;
            try { blurFilter.destroy?.(); } catch (_) { }
        }
        displayObject.filters = existingFilters.length > 0 ? existingFilters : null;
    },

    applyForegroundBackgroundBlur() {
        const hasForegroundOcclusion = !!this.foregroundOcclusionSprite;
        this._applyForegroundBackgroundBlurToDisplay(this.backgroundSprite, hasForegroundOcclusion);
        this._applyForegroundBackgroundBlurToDisplay(this.backgroundVideo, hasForegroundOcclusion);
    },

    _registerVisualAsset(assetUrl, texture, kind = 'visual') {
        if (!assetUrl || !texture) return;
        try { texture.__vnVisualAssetUrl = assetUrl; } catch (_) { }
        this.visualAssetCache.set(assetUrl, {
            texture,
            kind,
            lastUsed: Date.now()
        });
    },

    _isVisualAssetLive(assetUrl) {
        if (!assetUrl) return false;
        const candidates = [this.backgroundSprite, this.backgroundVideo, this.foregroundOcclusionSprite, this.cgSprite].filter(Boolean);
        return candidates.some(sprite => sprite?.texture?.__vnVisualAssetUrl === assetUrl);
    },

    _isCurrentBackgroundAsset(assetUrl) {
        if (!assetUrl || !this.currentSrc) return false;
        try {
            return getAssetUrl(this.currentSrc) === assetUrl;
        } catch (_) {
            return false;
        }
    },

    _shouldRetainVisualAsset(assetUrl) {
        return this._isVisualAssetLive(assetUrl) || this._isCurrentBackgroundAsset(assetUrl);
    },

    _isManagedBackgroundDisplay(displayObject) {
        if (!displayObject) return false;
        if (displayObject === this.backgroundSprite || displayObject === this.backgroundVideo) return true;
        if (displayObject.__vnRendererManagedBackground === true) return true;

        const assetUrl = displayObject.texture?.__vnVisualAssetUrl || null;
        const cachedKind = assetUrl ? this.visualAssetCache.get(assetUrl)?.kind : null;
        return cachedKind === 'background' || cachedKind === 'background-video';
    },

    _isManagedForegroundOcclusionDisplay(displayObject) {
        if (!displayObject) return false;
        if (displayObject === this.foregroundOcclusionSprite) return true;
        if (displayObject.__vnRendererManagedForegroundOcclusion === true) return true;

        const assetUrl = displayObject.texture?.__vnVisualAssetUrl || null;
        const cachedKind = assetUrl ? this.visualAssetCache.get(assetUrl)?.kind : null;
        return cachedKind === 'foreground-occlusion';
    },

    _hasRenderableTexture(displayObject) {
        const texture = displayObject?.texture || null;
        if (!displayObject || displayObject.destroyed) return false;
        if (!texture || texture.destroyed) return false;
        if (texture.source?.destroyed) return false;
        return true;
    },

    _hasSnapshotReadyTexture(displayObject) {
        return this._hasRenderableTexture(displayObject) && !!displayObject?.texture?.source;
    },

    _discardDisplayForRender(displayObject) {
        if (!displayObject || displayObject.destroyed) return;
        try { displayObject.renderable = false; } catch (_) { }
        try { displayObject.visible = false; } catch (_) { }
        try {
            if (displayObject.texture && PIXI?.Texture?.EMPTY) {
                displayObject.texture = PIXI.Texture.EMPTY;
            }
        } catch (_) { }
    },

    _releaseVisualTexture(assetUrl, texture, reason = 'release') {
        if (!assetUrl || !texture) return;
        const release = async () => {
            if (this._shouldRetainVisualAsset(assetUrl)) return;
            try {
                if (PIXI?.Assets?.unload && !this._shouldRetainVisualAsset(assetUrl)) {
                    await PIXI.Assets.unload(assetUrl);
                }
                if (this._shouldRetainVisualAsset(assetUrl)) return;
                if (!texture.destroyed) {
                    texture.destroy(true);
                }
                if (this.visualAssetCache.get(assetUrl)?.texture === texture) {
                    this.visualAssetCache.delete(assetUrl);
                }
                debugLog(`[PixiRenderer] Released ${reason} texture: ${assetUrl}`);
            } catch (error) {
                debugError(`[PixiRenderer] Failed to release ${reason} texture: ${assetUrl}`, error);
            }
        };
        setTimeout(() => { release(); }, 250);
    },

    async _loadFreshTexture(assetUrl, reason = 'visual') {
        let texture = await PIXI.Assets.load(assetUrl);
        if (texture?.destroyed || texture?.source?.destroyed || !texture?.source) {
            debugLog(`[PixiRenderer] Reloading stale ${reason} texture: ${assetUrl}`);
            try {
                if (PIXI?.Assets?.unload) await PIXI.Assets.unload(assetUrl);
            } catch (_) { }
            texture = await PIXI.Assets.load(assetUrl);
        }
        return texture;
    },

    getMemoryDebug() {
        const visualEntries = Array.from(this.visualAssetCache.entries()).map(([url, entry]) => {
            const texture = entry?.texture || null;
            return {
                url,
                kind: entry?.kind || 'visual',
                live: this._isVisualAssetLive(url),
                destroyed: texture?.destroyed === true,
                sourceDestroyed: texture?.source?.destroyed === true,
                width: Number(texture?.width) || 0,
                height: Number(texture?.height) || 0,
                approxRgbaMb: this._textureApproxMb(texture)
            };
        });
        return {
            currentBackground: this.currentSrc || null,
            currentIsVideo: this.currentIsVideo === true,
            currentForegroundOcclusion: this.currentForegroundOcclusionSrc || null,
            hasCg: !!this.cgSprite,
            visualAssetCacheSize: this.visualAssetCache.size,
            approxVisualAssetRgbaMb: Number(visualEntries.reduce((sum, entry) => sum + entry.approxRgbaMb, 0).toFixed(1)),
            bgSnapshot: {
                exists: !!this.bgSnapshotTexture,
                width: Number(this.bgSnapshotTexture?.width) || 0,
                height: Number(this.bgSnapshotTexture?.height) || 0,
                approxRgbaMb: this._textureApproxMb(this.bgSnapshotTexture)
            },
            visualEntries
        };
    },

    initBgSnapshot() {
        if (this.bgSnapshotTexture) return;

        this.bgSnapshotTexture = PIXI.RenderTexture.create({
            width: pixiApp.LOGICAL_WIDTH,
            height: pixiApp.LOGICAL_HEIGHT,
        });

        // Refresh the snapshot late enough that background VFX/state updates have
        // already run, but still before the main frame render (-25).
        pixiApp.hooks.addPreRender(() => this._refreshBgSnapshot(), -5);
        
        debugLog('[PixiJS] Background Snapshotting Initialized');
    },

    _refreshBgSnapshot() {
        if (!this.bgSnapshotTexture || !pixiApp.layers.background || !pixiApp.app) return;

        this._pruneInvalidBackgroundDisplays();
        const hasSnapshotPendingBackground = [...pixiApp.layers.background.children]
            .filter(child => this._isManagedBackgroundDisplay(child))
            .some(child => !this._hasSnapshotReadyTexture(child));
        if (hasSnapshotPendingBackground) return;

        // Render the background layer into the snapshot texture.
        try {
            pixiApp.app.renderer.render({
                container: pixiApp.layers.background,
                target: this.bgSnapshotTexture,
                clear: true
            });
        } catch (error) {
            debugError('[PixiRenderer] Background snapshot refresh failed', error);
            this._pruneInvalidBackgroundDisplays();
        }
    },

    async _assetUrlExists(assetUrl) {
        if (!assetUrl || typeof fetch !== 'function') return false;
        try {
            const response = await fetch(assetUrl, { method: 'HEAD', cache: 'no-store' });
            return response.ok;
        } catch {
            return false;
        }
    },

    async _resolveForegroundOcclusionAsset(src) {
        const cacheKey = String(src || '').trim().replace(/\\/g, '/').toLowerCase();
        if (!cacheKey) return null;
        if (this.foregroundOcclusionLookupCache.has(cacheKey)) {
            return this.foregroundOcclusionLookupCache.get(cacheKey);
        }

        const candidates = getForegroundOcclusionCandidates(src);
        for (const candidate of candidates) {
            const assetUrl = getAssetUrl(candidate);
            if (await this._assetUrlExists(assetUrl)) {
                const result = { src: candidate, assetUrl };
                this.foregroundOcclusionLookupCache.set(cacheKey, result);
                return result;
            }
        }

        this.foregroundOcclusionLookupCache.set(cacheKey, null);
        return null;
    },

    async _loadForegroundOcclusion(src) {
        const resolved = await this._resolveForegroundOcclusionAsset(src);
        if (!resolved?.assetUrl) return null;

        const texture = await PIXI.Assets.load(resolved.assetUrl);
        this._registerVisualAsset(resolved.assetUrl, texture, 'foreground-occlusion');
        if (texture.source) {
            texture.source.autoGenerateMipmaps = true;
            if (texture.source.style) {
                texture.source.style.scaleMode = 'linear';
            }
        }

        return {
            ...resolved,
            texture
        };
    },

    async updateBackground(src, isVideo = false, instant = false) {
        if (!pixiApp.layers.background) return;

        // Skip if this is already the current visual content
        const activeBackground = isVideo ? this.backgroundVideo : this.backgroundSprite;
        if (this.currentSrc === src && this.currentIsVideo === isVideo && activeBackground?.parent) return;

        const requestToken = ++this.backgroundUpdateToken;
        this.currentSrc = src;
        this.currentIsVideo = isVideo;

        const fullPath = getAssetUrl(src);
        const oldSprite = this.backgroundSprite || this.backgroundVideo;
        const oldForegroundSprite = this.foregroundOcclusionSprite;
        const foregroundLoadPromise = this._loadForegroundOcclusion(src).catch(() => null);

        try {
            const texture = await this._loadFreshTexture(fullPath, isVideo ? 'background-video' : 'background');
            this._registerVisualAsset(fullPath, texture, isVideo ? 'background-video' : 'background');
            
            // --- HIGH QUALITY DOWNSCALING FOR NO ALIASING ---
            if (texture.source) {
                texture.source.autoGenerateMipmaps = true;
                if (texture.source.style) {
                    texture.source.style.scaleMode = 'linear';
                }
            }
            
            if (isVideo) {
                // In PixiJS v8, VideoSource has the HTMLVideoElement directly stored in .resource
                const videoElement = texture.source?.resource;
                if (videoElement instanceof window.HTMLVideoElement) {
                    videoElement.loop = true;
                    videoElement.play().catch(e => debugError('[PixiJS] Video play failed', e));
                    
                    // Fallback to guarantee looping even if browser ignores the property
                    videoElement.onended = () => {
                        videoElement.currentTime = 0;
                        videoElement.play().catch(e => debugError('[PixiJS] Video loop fallback failed', e));
                    };
                } else {
                    debugError('[PixiJS] Could not find HTMLVideoElement on texture source', texture.source);
                }
            }

            if (requestToken !== this.backgroundUpdateToken || this.currentSrc !== src || this.currentIsVideo !== isVideo) {
                this._releaseVisualTexture(fullPath, texture, 'stale-background-load');
                return;
            }

            const foreground = await foregroundLoadPromise;
            if (requestToken !== this.backgroundUpdateToken || this.currentSrc !== src || this.currentIsVideo !== isVideo) {
                this._releaseVisualTexture(fullPath, texture, 'stale-background-load');
                if (foreground?.texture) {
                    this._releaseVisualTexture(foreground.assetUrl, foreground.texture, 'stale-foreground-occlusion-load');
                }
                return;
            }

            const newSprite = new PIXI.Sprite(texture);
            let newForegroundSprite = null;

            newSprite.__vnRendererManagedBackground = true;
            newSprite.anchor.set(0.5);
            newSprite.alpha = 0;
            this._resizeSpriteToCover(newSprite);
            pixiApp.layers.background.addChild(newSprite);
            this._pruneBackgroundLayer([oldSprite, newSprite]);

            const fadeDuration = instant ? 0 : 1;

            if (foreground?.texture && pixiApp.layers.foregroundOcclusion) {
                newForegroundSprite = new PIXI.Sprite(foreground.texture);
                newForegroundSprite.__vnRendererManagedForegroundOcclusion = true;
                newForegroundSprite.anchor.set(0.5);
                newForegroundSprite.alpha = 0;
                this._resizeSpriteToCover(newForegroundSprite);
                pixiApp.layers.foregroundOcclusion.addChild(newForegroundSprite);
                this._pruneForegroundOcclusionLayer([oldForegroundSprite, newForegroundSprite]);
                this.currentForegroundOcclusionSrc = foreground.src;
                this.foregroundOcclusionSprite = newForegroundSprite;
            } else {
                if (foreground?.texture) {
                    this._releaseVisualTexture(foreground.assetUrl, foreground.texture, 'unused-foreground-occlusion-load');
                }
                this.currentForegroundOcclusionSrc = null;
                this.foregroundOcclusionSprite = null;
            }

            this._applyForegroundBackgroundBlurToDisplay(newSprite, !!newForegroundSprite);

            // Crossfade
            if (oldSprite) {
                gsap.to(oldSprite, {
                    alpha: 0,
                    duration: fadeDuration,
                    ease: "power2.inOut",
                    onComplete: () => {
                        this._destroyBackgroundDisplay(oldSprite);
                    }
                });
            }

            if (oldForegroundSprite && oldForegroundSprite !== newForegroundSprite) {
                gsap.to(oldForegroundSprite, {
                    alpha: 0,
                    duration: fadeDuration,
                    ease: "power2.inOut",
                    onComplete: () => {
                        this._destroyForegroundOcclusionDisplay(oldForegroundSprite);
                    }
                });
            }

            gsap.to(newSprite, {
                alpha: 1,
                duration: fadeDuration,
                ease: "power2.inOut",
                onComplete: () => {
                    if (requestToken !== this.backgroundUpdateToken) return;
                    window.dispatchEvent(new CustomEvent('vn:background-updated', {
                        detail: { background: src, isVideo }
                    }));
                }
            });

            if (newForegroundSprite) {
                gsap.to(newForegroundSprite, {
                    alpha: 1,
                    duration: fadeDuration,
                    ease: "power2.inOut"
                });
            }

            if (isVideo) {
                this.backgroundVideo = newSprite;
                this.backgroundSprite = null;
            } else {
                this.backgroundSprite = newSprite;
                this.backgroundVideo = null;
            }
        } catch (error) {
            debugError('[PixiJS] Background Update Failed', error);
        }
    },

    _destroyBackgroundDisplay(displayObject) {
        if (!displayObject) return;
        const texture = displayObject.texture || null;
        const assetUrl = texture?.__vnVisualAssetUrl || null;
        killTweensDeep(displayObject);
        this._discardDisplayForRender(displayObject);
        try {
            if (displayObject.parent) displayObject.parent.removeChild(displayObject);
        } catch (_) { }
        try { displayObject.destroy({ children: true, texture: false, baseTexture: false }); } catch (_) { }
        this._releaseVisualTexture(assetUrl, texture, 'background-display');
    },

    _destroyForegroundOcclusionDisplay(displayObject) {
        if (!displayObject) return;
        const texture = displayObject.texture || null;
        const assetUrl = texture?.__vnVisualAssetUrl || null;
        killTweensDeep(displayObject);
        try {
            if (displayObject.parent) displayObject.parent.removeChild(displayObject);
        } catch { }
        try { displayObject.destroy({ children: true, texture: false, baseTexture: false }); } catch { }
        this._releaseVisualTexture(assetUrl, texture, 'foreground-occlusion-display');
    },

    _pruneBackgroundLayer(except = []) {
        if (!pixiApp.layers.background) return;
        const keep = new Set(except.filter(Boolean));
        const staleChildren = [...pixiApp.layers.background.children]
            .filter(child => !keep.has(child) && this._isManagedBackgroundDisplay(child));
        staleChildren.forEach(child => this._destroyBackgroundDisplay(child));
    },

    _pruneInvalidBackgroundDisplays() {
        if (!pixiApp.layers.background) return;
        const invalidChildren = [...pixiApp.layers.background.children]
            .filter(child => this._isManagedBackgroundDisplay(child))
            .filter(child => !this._hasRenderableTexture(child));
        invalidChildren.forEach(child => this._destroyBackgroundDisplay(child));
    },

    _pruneForegroundOcclusionLayer(except = []) {
        if (!pixiApp.layers.foregroundOcclusion) return;
        const keep = new Set(except.filter(Boolean));
        const staleChildren = [...pixiApp.layers.foregroundOcclusion.children]
            .filter(child => !keep.has(child) && this._isManagedForegroundOcclusionDisplay(child));
        staleChildren.forEach(child => this._destroyForegroundOcclusionDisplay(child));
    },

    _clearForegroundOcclusion(instant = false) {
        const layerChildren = pixiApp.layers.foregroundOcclusion ? [...pixiApp.layers.foregroundOcclusion.children] : [];
        const managedLayerChildren = layerChildren.filter(child => this._isManagedForegroundOcclusionDisplay(child));
        const oldSprites = new Set([
            this.foregroundOcclusionSprite,
            ...managedLayerChildren
        ].filter(Boolean));

        this.currentForegroundOcclusionSrc = null;
        this.foregroundOcclusionSprite = null;

        if (oldSprites.size === 0) return;
        if (instant) {
            oldSprites.forEach(oldSprite => this._destroyForegroundOcclusionDisplay(oldSprite));
            return;
        }

        oldSprites.forEach(oldSprite => {
            gsap.to(oldSprite, {
                alpha: 0,
                duration: 1,
                ease: "power2.inOut",
                onComplete: () => this._destroyForegroundOcclusionDisplay(oldSprite)
            });
        });
    },

    clearBackground(instant = false) {
        this.backgroundUpdateToken += 1;
        const layerChildren = pixiApp.layers.background ? [...pixiApp.layers.background.children] : [];
        const managedLayerChildren = layerChildren.filter(child => this._isManagedBackgroundDisplay(child));
        const oldSprites = new Set([
            this.backgroundSprite,
            this.backgroundVideo,
            ...managedLayerChildren
        ].filter(Boolean));
        this.currentSrc = null;
        this.currentIsVideo = false;
        this.backgroundSprite = null;
        this.backgroundVideo = null;
        this._clearForegroundOcclusion(instant);

        if (oldSprites.size === 0) return;

        const removeOld = (oldSprite) => {
            this._destroyBackgroundDisplay(oldSprite);
        };

        if (instant) {
            oldSprites.forEach(removeOld);
            return;
        }

        oldSprites.forEach(oldSprite => {
            gsap.to(oldSprite, {
                alpha: 0,
                duration: 1,
                ease: "power2.inOut",
                onComplete: () => removeOld(oldSprite)
            });
        });
    },

    reset() {
        this.backgroundUpdateToken += 1;
        this._pruneBackgroundLayer();
        this._pruneForegroundOcclusionLayer();
        this.backgroundSprite = null;
        this.backgroundVideo = null;
        this.foregroundOcclusionSprite = null;
        if (this.cgSprite) {
            this._destroyCgDisplay(this.cgSprite);
            this.cgSprite = null;
        }
        this.currentSrc = null;
        this.currentIsVideo = false;
        this.currentForegroundOcclusionSrc = null;
        debugLog('[PixiRenderer] Reset complete');
    },

    async updateCg(src, instant = false) {
        if (!pixiApp.layers.cg) return;

        const requestToken = ++this.cgUpdateToken;
        const oldSprite = this.cgSprite;

        // If explicitly clearing the CG
        if (!src) {
            this.cgSprite = null;
            if (oldSprite) {
                const fadeDuration = instant ? 0 : 1;
                gsap.to(oldSprite, {
                    alpha: 0,
                    duration: fadeDuration,
                    ease: "power2.inOut",
                    onComplete: () => {
                        this._destroyCgDisplay(oldSprite);
                        if (pixiApp.layers.characters) {
                            pixiApp.layers.characters.visible = true;
                        }
                    }
                });
            } else if (pixiApp.layers.characters) {
                pixiApp.layers.characters.visible = true;
            }
            return;
        }

        const fullPath = getAssetUrl(src);

        try {
            const texture = await PIXI.Assets.load(fullPath);
            this._registerVisualAsset(fullPath, texture, 'cg');

            // --- HIGH QUALITY DOWNSCALING FOR NO ALIASING ---
            if (texture.source) {
                texture.source.autoGenerateMipmaps = true;
                if (texture.source.style) {
                    texture.source.style.scaleMode = 'linear';
                }
            }

            if (requestToken !== this.cgUpdateToken) {
                this._releaseVisualTexture(fullPath, texture, 'stale-cg-load');
                return;
            }

            const newSprite = new PIXI.Sprite(texture);
            
            newSprite.anchor.set(0.5);
            newSprite.alpha = 0;
            this._resizeSpriteToCover(newSprite);
            pixiApp.layers.cg.addChild(newSprite);

            const fadeDuration = instant ? 0 : 1;

            if (oldSprite) {
                gsap.to(oldSprite, {
                    alpha: 0,
                    duration: fadeDuration,
                    ease: "power2.inOut",
                    onComplete: () => {
                        this._destroyCgDisplay(oldSprite);
                    }
                });
            }

            gsap.to(newSprite, {
                alpha: 1,
                duration: fadeDuration,
                ease: "power2.inOut",
                onStart: () => {
                    if (pixiApp.layers.characters) {
                        pixiApp.layers.characters.visible = false;
                    }
                }
            });

            this.cgSprite = newSprite;
        } catch (error) {
            debugError('[PixiJS] CG Update Failed', error);
        }
    },

    _destroyCgDisplay(displayObject) {
        if (!displayObject) return;
        const texture = displayObject.texture || null;
        const assetUrl = texture?.__vnVisualAssetUrl || null;
        killTweensDeep(displayObject);
        try {
            if (pixiApp.layers.cg && displayObject.parent === pixiApp.layers.cg) {
                pixiApp.layers.cg.removeChild(displayObject);
            } else if (displayObject.parent) {
                displayObject.parent.removeChild(displayObject);
            }
        } catch (_) { }
        try { displayObject.destroy({ children: true, texture: false, baseTexture: false }); } catch (_) { }
        this._releaseVisualTexture(assetUrl, texture, 'cg-display');
    },

    _listenersInitialized: false,
    initRuntimeListeners() {
        if (this._listenersInitialized) return;

        // Higher-level background override that respects normal turn flow
        window.addEventListener('vn:background-override', (e) => {
            const { src, isVideo, instant, _isSweepCatchup } = e.detail;
            const finalInstant = instant || _isSweepCatchup;
            debugLog(`[PixiRenderer] Background Override: ${src} (Instant: ${finalInstant})`);
            this.updateBackground(src, !!isVideo, finalInstant);
        });

        // Restore natural background when volatile events are cleared
        window.addEventListener('system:clear-all-volatile-events', () => {
             import('./state.js').then(m => {
                  if (m.state?.isApplyingVNResult === true) return;
                  const { currentBackground } = m.state;
                  if (currentBackground && this.currentSrc !== currentBackground) {
                      debugLog(`[PixiRenderer] Restoring natural background: ${currentBackground}`);
                     const isVideo = currentBackground.endsWith('.mp4') || currentBackground.endsWith('.webm');
                     // We use crossfade here usually, as it's a "soft" restoration
                     this.updateBackground(currentBackground, isVideo, false);
                 }
             });
        });

        this._listenersInitialized = true;
        debugLog('[PixiRenderer] Background Runtime Listeners Initialized');
    },

    _resizeSpriteToCover(sprite) {
        if (!sprite || !sprite.texture || !pixiApp.app) return;

        // Use logical dimensions instead of physical screen dimensions
        // Add 10% overscan (1.1x) to prevent black bars during camera shakes/wobbles
        const targetWidth = pixiApp.LOGICAL_WIDTH * 1.1;
        const targetHeight = pixiApp.LOGICAL_HEIGHT * 1.1;

        const targetAspect = targetWidth / targetHeight;
        const textureAspect = sprite.texture.width / sprite.texture.height;

        if (targetAspect > textureAspect) {
            sprite.width = Math.ceil(targetWidth);
            sprite.height = Math.ceil(targetWidth / textureAspect);
        } else {
            sprite.height = Math.ceil(targetHeight);
            sprite.width = Math.ceil(targetHeight * textureAspect);
        }

        // Center within the logical viewport (1920x1080)
        sprite.x = pixiApp.LOGICAL_WIDTH / 2;
        sprite.y = pixiApp.LOGICAL_HEIGHT / 2;
    }
};

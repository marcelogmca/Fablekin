import { elements } from './elements.js';
import { state } from './state.js';
import { debugLog, debugError } from './utils.js';

const DEFAULT_MAX_FPS = 60;
const MIN_MAX_FPS = 15;
const MAX_MAX_FPS = 240;

export const pixiApp = {
    app: null,
    LOGICAL_WIDTH: 1920,
    LOGICAL_HEIGHT: 1080,
    _activeMaxFps: null,
    
    // The Viewport handles window resizing (always keeps logical center)
    viewport: null, 
    // The World handles Cam Zoom/Pan
    world: null,    

    layers: {
        background: null,
        characters: null,
        interceptActors: null,
        foregroundOcclusion: null,
        cg: null,
        fx: null,
        titles: null
    },

    hooks: {
        addPreRender(fn, priority = 0) {
            // PixiJS v8 render is at UPDATE_PRIORITY.LOW (-25)
            // Anything > -25 runs before the frame renders
            pixiApp.app.ticker.add(fn, null, priority);
        },
        addPostRender(fn) {
            // UTILITY (-50) is below LOW (-25), runs after the frame
            const utilityPriority = (typeof PIXI.UPDATE_PRIORITY !== 'undefined') ? PIXI.UPDATE_PRIORITY.UTILITY : -50;
            pixiApp.app.ticker.add(fn, null, utilityPriority);
        },
        remove(fn) {
            pixiApp.app.ticker.remove(fn);
        }
    },

    _scrubDestroyedDisplayObjects(root = null) {
        const parent = root || this.app?.stage;
        if (!parent || !Array.isArray(parent.children)) return 0;

        let removed = 0;
        for (let i = parent.children.length - 1; i >= 0; i--) {
            const child = parent.children[i];
            if (!child || child.destroyed === true) {
                try { parent.removeChildAt(i); } catch (_) { }
                removed += 1;
                continue;
            }
            removed += this._scrubDestroyedDisplayObjects(child);
        }
        return removed;
    },

    _isBrokenRenderableTexture(texture) {
        if (!texture) return true;
        if (typeof PIXI !== 'undefined' && texture === PIXI.Texture?.EMPTY) return false;
        return texture.destroyed === true
            || !texture.source
            || texture.source.destroyed === true;
    },

    _shouldScrubDisplayObjectTexture(displayObject) {
        if (!displayObject || typeof PIXI === 'undefined') return false;
        if (PIXI.Graphics && displayObject instanceof PIXI.Graphics) return false;
        if (PIXI.Text && displayObject instanceof PIXI.Text) return false;

        const textureBackedTypes = [
            PIXI.Sprite,
            PIXI.AnimatedSprite,
            PIXI.TilingSprite,
            PIXI.NineSliceSprite
        ].filter(Boolean);

        return textureBackedTypes.some((Type) => displayObject instanceof Type);
    },

    _scrubBrokenTextures(root = null) {
        const displayObject = root || this.app?.stage;
        if (!displayObject || displayObject.destroyed === true) return 0;

        let scrubbed = 0;
        if (
            this._shouldScrubDisplayObjectTexture(displayObject)
            && this._isBrokenRenderableTexture(displayObject.texture)
        ) {
            try { displayObject.renderable = false; } catch (_) { }
            try { displayObject.visible = false; } catch (_) { }
            try {
                if (typeof PIXI !== 'undefined' && PIXI.Texture?.EMPTY) {
                    displayObject.texture = PIXI.Texture.EMPTY;
                }
            } catch (_) { }
            scrubbed += 1;
        }

        if (Array.isArray(displayObject.children)) {
            for (const child of displayObject.children) {
                scrubbed += this._scrubBrokenTextures(child);
            }
        }
        return scrubbed;
    },

    _installRenderSafetyScrubber() {
        if (!this.app?.ticker || this._renderSafetyScrubber) return;
        this._renderSafetyScrubber = () => {
            try {
                const removed = this._scrubDestroyedDisplayObjects(this.app?.stage);
                const scrubbedTextures = this._scrubBrokenTextures(this.app?.stage);
                if (removed > 0) {
                    debugLog(`[PixiJS] Detached ${removed} destroyed display object(s) before render.`);
                }
                if (scrubbedTextures > 0) {
                    debugLog(`[PixiJS] Neutralized ${scrubbedTextures} display object(s) with destroyed textures before render.`);
                }
            } catch (error) {
                debugError('[PixiJS] Render safety scrubber failed', error);
            }
        };
        // Sprite/effect plugins may destroy nodes in earlier pre-render hooks.
        // Run just before Pixi's LOW-priority render pass to keep dead nodes out
        // of the renderer's traversal list.
        this.app.ticker.add(this._renderSafetyScrubber, null, -20);
    },

    _isDragging: false,
    _lastPointerPos: { x: 0, y: 0 },

    getConfiguredMaxFps() {
        const rawValue = state.vnSettings?.performance?.max_fps;
        const numericValue = Number(rawValue);
        const safeValue = Number.isFinite(numericValue) ? numericValue : DEFAULT_MAX_FPS;
        const rounded = Math.round(safeValue);
        return Math.max(MIN_MAX_FPS, Math.min(MAX_MAX_FPS, rounded));
    },

    applyFpsCap() {
        const maxFps = this.getConfiguredMaxFps();
        if (this.app?.ticker) {
            this.app.ticker.maxFPS = maxFps;
        }
        if (PIXI?.Ticker?.shared) {
            PIXI.Ticker.shared.maxFPS = maxFps;
        }
        if (this._activeMaxFps !== maxFps) {
            this._activeMaxFps = maxFps;
            debugLog(`[PixiJS] Max FPS cap applied: ${maxFps}`);
        }
    },
    
    async init() {
        if (this.app) return;

        try {
            this.app = new PIXI.Application();
            await this.app.init({
                canvas: document.getElementById('vn-canvas'),
                resizeTo: elements.gameContainer,
                backgroundAlpha: 0,
                autoDensity: true,
                antialias: true,
                resolution: window.devicePixelRatio || 1,
                preference: 'webgl', // Force WebGL to support advanced custom GLSL VFX filters
            });

            this.applyFpsCap();

            this.viewport = new PIXI.Container();
            this.viewport.label = "Viewport";
            this.world = new PIXI.Container();
            this.world.label = "World";
            
            // Set up Layer Hierarchy
            this.layers.background = new PIXI.Container();
            this.layers.background.label = "Layer_Background";
            this.layers.characters = new PIXI.Container();
            this.layers.characters.label = "Layer_Characters";
            this.layers.interceptActors = new PIXI.Container();
            this.layers.interceptActors.label = "Layer_InterceptActors";
            this.layers.foregroundOcclusion = new PIXI.Container();
            this.layers.foregroundOcclusion.label = "Layer_ForegroundOcclusion";
            this.layers.cg = new PIXI.Container();
            this.layers.cg.label = "Layer_CG";
            this.layers.fx = new PIXI.Container();
            this.layers.fx.label = "Layer_FX";
            this.layers.titles = new PIXI.Container();
            this.layers.titles.label = "Layer_Titles";

            this.world.addChild(
                this.layers.background,
                this.layers.characters,
                this.layers.interceptActors,
                this.layers.foregroundOcclusion,
                this.layers.fx,
                this.layers.cg,
                this.layers.titles
            );

            this.viewport.addChild(this.world);
            this.app.stage.addChild(this.viewport);

            // Initialize world center
            this.world.position.set(this.LOGICAL_WIDTH / 2, this.LOGICAL_HEIGHT / 2);
            this.world.pivot.set(this.LOGICAL_WIDTH / 2, this.LOGICAL_HEIGHT / 2);

            window.addEventListener('resize', () => this._onResize());
            
            // Add ResizeObserver for robust layout-based resizing (e.g. HUD toggle)
            if (window.ResizeObserver) {
                this.resizeObserver = new window.ResizeObserver(() => {
                    // Use requestAnimationFrame to ensure we resize after the browser has finished layout
                    requestAnimationFrame(() => this._onResize());
                });
                this.resizeObserver.observe(elements.gameContainer);
            }

            this._onResize(); // Initial scaling
            this._installRenderSafetyScrubber();
            this._initDebugListeners();
            import('./pixi_sprite_manager.js').then(m => m.pixiSpriteManager.init());

            // Register with plugin lifecycle runtime
            const pixiPluginRuntime = window.VN?.pixiPlugins;
            if (pixiPluginRuntime) {
                pixiPluginRuntime.setPixiApp(this);
            }

            // Apply runtime FPS cap updates when VN settings change.
            window.addEventListener('vn:settings-updated', () => this.applyFpsCap());

            debugLog('[PixiJS] Application Initialized with Virtual Viewport');
        } catch (error) {
            debugError('[PixiJS] Initialization Failed', error);
        }
    },

    _initDebugListeners() {
        const canvas = document.getElementById('vn-canvas');
        if (!canvas) return;

        canvas.addEventListener('wheel', (e) => {
            if (!state.vnSettings.debug?.debug_viewport || state.currentCg) return;
            e.preventDefault();

            // --- CURSOR-CENTRIC ZOOM ---
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Get pointer position relative to the viewport (world-space before zoom)
            const worldPos = this.viewport.toLocal(new PIXI.Point(x, y));

            const zoomSpeed = 0.001;
            const delta = -e.deltaY * zoomSpeed;
            const oldScale = this.viewport.scale.x;
            const newScale = Math.max(0.05, Math.min(20, oldScale + delta));

            this.viewport.scale.set(newScale);

            // Shift viewport position to keep worldPos under the cursor
            const newWorldPos = this.viewport.toGlobal(worldPos);
            this.viewport.x += x - newWorldPos.x;
            this.viewport.y += y - newWorldPos.y;
            // ---------------------------
        }, { passive: false });

        canvas.addEventListener('pointerdown', (e) => {
            if (!state.vnSettings.debug?.debug_viewport || state.currentCg) return;
            this._isDragging = true;
            this._lastPointerPos = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!this._isDragging) return;
            const dx = e.clientX - this._lastPointerPos.x;
            const dy = e.clientY - this._lastPointerPos.y;
            
            this.viewport.x += dx;
            this.viewport.y += dy;
            
            this._lastPointerPos = { x: e.clientX, y: e.clientY };
        });

        canvas.addEventListener('pointerup', (e) => {
            this._isDragging = false;
            try { canvas.releasePointerCapture(e.pointerId); } catch {}
        });

        canvas.addEventListener('pointercancel', () => {
            this._isDragging = false;
        });

        // --- CAM EVENT LISTENERS ---
        window.addEventListener('vn:cam-zoom-to-rect', (e) => {
            const { x1, y1, x2, y2, duration, focusCharacter, _isSweepCatchup, instant, blur } = e.detail;
            const finalDuration = (instant || _isSweepCatchup) ? 0 : duration;
            this.cam.zoomToRect(x1, y1, x2, y2, finalDuration, focusCharacter, blur, _isSweepCatchup);
        });

        window.addEventListener('vn:cam-zoom-to-character', (e) => {
            const { charName, region, duration, padding, _isSweepCatchup, instant, blur } = e.detail;
            const finalDuration = (instant || _isSweepCatchup) ? 0 : duration;
            this.cam.zoomToCharacter(charName, region, finalDuration, padding, blur, _isSweepCatchup);
        });

        window.addEventListener('vn:cam-reset', (e) => {
            const { duration, _isSweepCatchup, instant } = e.detail || {};
            const finalDuration = (instant || _isSweepCatchup) ? 0 : (duration !== undefined ? duration : 0);
            this.cam.reset(finalDuration);
        });

        window.addEventListener('vn:cam-lock', () => {
             this.cam.lock();
        });
    },

    resetViewport() {
        this._onResize();
    },

    _onResize() {
        if (!this.app || !this.viewport) return;
        this.app.renderer.resize(elements.gameContainer.clientWidth, elements.gameContainer.clientHeight);

        // Scale viewport to "Cover" the screen (like CSS background-size: cover)
        const scaleX = this.app.screen.width / this.LOGICAL_WIDTH;
        const scaleY = this.app.screen.height / this.LOGICAL_HEIGHT;
        const scale = Math.max(scaleX, scaleY);

        this.viewport.scale.set(scale);
        
        // Keep the logical center in the middle of the physical screen
        this.viewport.position.set(this.app.screen.width / 2, this.app.screen.height / 2);
        this.viewport.pivot.set(this.LOGICAL_WIDTH / 2, this.LOGICAL_HEIGHT / 2);

        // Re-resize background elements to match logical dimensions if needed
        import('./pixi_renderer.js').then(m => {
            if (m.pixiRenderer.backgroundSprite) m.pixiRenderer._resizeSpriteToCover(m.pixiRenderer.backgroundSprite);
            if (m.pixiRenderer.backgroundVideo) m.pixiRenderer._resizeSpriteToCover(m.pixiRenderer.backgroundVideo);
            if (m.pixiRenderer.foregroundOcclusionSprite) m.pixiRenderer._resizeSpriteToCover(m.pixiRenderer.foregroundOcclusionSprite);
        });
    },

    cam: {
        lastZoomedChar: null,
        lastZoomRegion: null,

        zoom(level, duration = 1) {
            if (!pixiApp.world || pixiApp.world.destroyed || !pixiApp.world.scale || state.currentCg) return;
            // Center the world pivot for zooming
            pixiApp.world.pivot.set(pixiApp.LOGICAL_WIDTH / 2, pixiApp.LOGICAL_HEIGHT / 2);
            pixiApp.world.position.set(pixiApp.LOGICAL_WIDTH / 2, pixiApp.LOGICAL_HEIGHT / 2);
            
            gsap.to(pixiApp.world.scale, { 
                x: level, 
                y: level, 
                duration: duration, 
                ease: "power2.inOut",
                overwrite: true
            });
        },
        
        pan(x, y, duration = 1) {
            if (!pixiApp.world || pixiApp.world.destroyed || !pixiApp.world.pivot || state.currentCg) return;
            
            const currentScale = pixiApp.world.scale.x;
            const halfW = (pixiApp.LOGICAL_WIDTH / 2) / currentScale;
            const halfH = (pixiApp.LOGICAL_HEIGHT / 2) / currentScale;

            // If zoomed out (scale < 1), we just snap to center to avoid black bars on both sides
            const clampedX = (halfW > pixiApp.LOGICAL_WIDTH / 2) ? (pixiApp.LOGICAL_WIDTH / 2) : Math.max(halfW, Math.min(pixiApp.LOGICAL_WIDTH - halfW, x));
            const clampedY = (halfH > pixiApp.LOGICAL_HEIGHT / 2) ? (pixiApp.LOGICAL_HEIGHT / 2) : Math.max(halfH, Math.min(pixiApp.LOGICAL_HEIGHT - halfH, y));

            // X and Y here should be logical coordinates (0 to 1920)
            gsap.to(pixiApp.world.pivot, { 
                x: clampedX, 
                y: clampedY, 
                duration: duration, 
                ease: "power2.inOut",
                overwrite: true
            });
        },

        zoomToRect(x1, y1, x2, y2, duration = 1, focusCharacter = null, blur = 0, _isSweepCatchup = false) {
            if (!pixiApp.world || pixiApp.world.destroyed || !pixiApp.world.pivot || !pixiApp.world.scale || state.currentCg) return;

            const finalDuration = (duration === 0) ? 0 : duration;

            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const rectWidth = Math.abs(x2 - x1);
            const rectHeight = Math.abs(y2 - y1);

            const scaleX = pixiApp.LOGICAL_WIDTH / rectWidth;
            const scaleY = pixiApp.LOGICAL_HEIGHT / rectHeight;
            const targetScale = Math.min(scaleX, scaleY);

            debugLog(`[Cam] Calculated Scale: ${targetScale}, Target: (${centerX}, ${centerY})`);

            pixiApp.world.position.set(pixiApp.LOGICAL_WIDTH / 2, pixiApp.LOGICAL_HEIGHT / 2);

            if (focusCharacter) {
                import('./pixi_sprite_manager.js').then(m => m.pixiSpriteManager.setFocusCharacter(focusCharacter, { duration: finalDuration }));
            }

            // Handle Background Blur (DOF)
            if (blur > 0) {
                if (!pixiApp.backgroundBlurFilter) {
                    pixiApp.backgroundBlurFilter = new PIXI.BlurFilter();
                    pixiApp.backgroundBlurFilter.blur = 0;
                    pixiApp.backgroundBlurFilter.quality = 3;
                    
                    const existingFilters = pixiApp.layers.background.filters || [];
                    if (!existingFilters.includes(pixiApp.backgroundBlurFilter)) {
                        pixiApp.layers.background.filters = [...existingFilters, pixiApp.backgroundBlurFilter];
                    }
                }
                gsap.to(pixiApp.backgroundBlurFilter, {
                    blur: blur,
                    duration: finalDuration,
                    ease: "power2.inOut",
                    overwrite: true
                });
            } else if (pixiApp.backgroundBlurFilter) {
                gsap.to(pixiApp.backgroundBlurFilter, {
                    blur: 0,
                    duration: finalDuration,
                    ease: "power2.inOut",
                    overwrite: true
                });
            }

            const halfW = (pixiApp.LOGICAL_WIDTH / 2) / targetScale;
            const halfH = (pixiApp.LOGICAL_HEIGHT / 2) / targetScale;

            const clampedX = (halfW > pixiApp.LOGICAL_WIDTH / 2) ? (pixiApp.LOGICAL_WIDTH / 2) : Math.max(halfW, Math.min(pixiApp.LOGICAL_WIDTH - halfW, centerX));
            const clampedY = (halfH > pixiApp.LOGICAL_HEIGHT / 2) ? (pixiApp.LOGICAL_HEIGHT / 2) : Math.max(halfH, Math.min(pixiApp.LOGICAL_HEIGHT - halfH, centerY));

            gsap.to(pixiApp.world.pivot, {
                x: clampedX,
                y: clampedY,
                duration: finalDuration,
                ease: "power2.inOut",
                overwrite: true
            });
            gsap.to(pixiApp.world.scale, {
                x: targetScale,
                y: targetScale,
                duration: finalDuration,
                ease: "power2.inOut",
                overwrite: true
            });

            // --- SMART DEFAULTS: Automatic Handheld Wobble ---
            // Only apply if not already locked or sweep-catchup
            if (!this._isLocked && !_isSweepCatchup) {
                window.dispatchEvent(new CustomEvent('vfx:start-wobble', { 
                    detail: { intensity: 0.15 } // Subtle breathing
                }));
            }
        },

        async zoomToCharacter(charName, region = 'top', duration = 0, padding = 40, blur = 0, _isSweepCatchup = false) {
            if (state.currentCg) return;
            debugLog(`[Cam] Zooming to ${charName} (Region: ${region}, Duration: ${duration})`);

            this.lastZoomedChar = charName;
            this.lastZoomRegion = region;

            const { pixiSpriteManager } = await import('./pixi_sprite_manager.js');
            const info = pixiSpriteManager.getCharacterVisibleInfo(charName);
            if (!info) return;

            let frameWidth = (info.width + (padding * 2)) * 1.5;
            if (region === 'top' || region === 'face') {
                // Tighter framing for face shots, but widened significantly (50% more zoomed out than before)
                // Was 0.85, now 0.85 * 1.5 = ~1.275
                frameWidth = info.width * 1.275;
            }

            const frameHeight = frameWidth * (pixiApp.LOGICAL_HEIGHT / pixiApp.LOGICAL_WIDTH);

            const centerX = info.x + (info.width / 2);
            let centerY = info.y + (info.height / 2);

            if (region === 'top' || region === 'face') {
                // Focus on the upper ~12% of the visible character bounds (where the head is usually located)
                centerY = info.y + (info.height * 0.12);
            } else if (region === 'bottom') {
                centerY = (info.y + info.height) - (frameHeight / 2);
            }

            this.zoomToRect(
                centerX - (frameWidth / 2),
                centerY - (frameHeight / 2),
                centerX + (frameWidth / 2),
                centerY + (frameHeight / 2),
                duration,
                charName,
                blur,
                _isSweepCatchup
            );
        },

        reset(duration = 0, _force = false) {
            if (!pixiApp.world || pixiApp.world.destroyed || !pixiApp.world.pivot || !pixiApp.world.scale) return;
            
            this.lastZoomedChar = null;
            this.lastZoomRegion = null;
            
            import('./pixi_sprite_manager.js').then(m => m.pixiSpriteManager.clearFocus());
            
            pixiApp.world.position.set(pixiApp.LOGICAL_WIDTH / 2, pixiApp.LOGICAL_HEIGHT / 2);

            if (pixiApp.backgroundBlurFilter) {
                gsap.to(pixiApp.backgroundBlurFilter, {
                    blur: 0,
                    duration: duration,
                    ease: "power2.inOut",
                    overwrite: true
                });
            }

            gsap.to(pixiApp.world.pivot, {
                x: pixiApp.LOGICAL_WIDTH / 2,
                y: pixiApp.LOGICAL_HEIGHT / 2,
                duration: duration,
                ease: "power2.inOut",
                overwrite: true
            });
            gsap.to(pixiApp.world.scale, {
                x: 1,
                y: 1,
                duration: duration,
                ease: "power2.inOut",
                overwrite: true
            });

            // --- SMART DEFAULTS: Reset Wobble & Lock ---
            this._isLocked = false;
            window.dispatchEvent(new CustomEvent('vfx:clear-wobble'));
        },

        _isLocked: false,
        lock() {
            this._isLocked = true;
            window.dispatchEvent(new CustomEvent('vfx:clear-wobble'));
            debugLog('[Cam] Viewport Locked (Wobble Disabled)');
        }
    }
};

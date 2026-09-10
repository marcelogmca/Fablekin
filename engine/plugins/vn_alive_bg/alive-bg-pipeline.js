// alive-bg-pipeline.js
// PixiJS rendering pipeline for depth-aware effects.

(function(context) {
    const { PIXI, pixiApp } = context;
    const debugLog = () => {};
    const ALIVE_BG_SHADER_REV = '2026-04-18z';

    let pipeline = null;

    class AlivePipeline {
        constructor() {
            this.active = true;
            this.rtWidth = 1280; // Higher-quality RTs to reduce geometric artifacts
            this.rtHeight = 720;
            this.analysisWidth = 64;
            this.analysisHeight = 36;

            this.bloomRT = PIXI.RenderTexture.create({ width: this.rtWidth, height: this.rtHeight });
            this.giRT = PIXI.RenderTexture.create({ width: this.rtWidth, height: this.rtHeight });
            this.parallaxRT = PIXI.RenderTexture.create({ width: pixiApp.LOGICAL_WIDTH, height: pixiApp.LOGICAL_HEIGHT });
            this.depthAlignedRT = PIXI.RenderTexture.create({ width: this.rtWidth, height: this.rtHeight });
            this.depthParallaxRT = PIXI.RenderTexture.create({ width: pixiApp.LOGICAL_WIDTH, height: pixiApp.LOGICAL_HEIGHT });
            this.analysisRT = PIXI.RenderTexture.create({ width: this.analysisWidth, height: this.analysisHeight });
            this.analysisDepthRT = PIXI.RenderTexture.create({ width: this.analysisWidth, height: this.analysisHeight });

            this.sceneLuma = 0.45;
            this.sceneBrightnessKey = null;
            this.lastBrightnessSampleAt = 0;
            this.lastAdaptiveDisable = false;
            this.lastAnalysisPixels = null;
            this.lastAnalysisKey = null;
            this.lastAnalysisAt = 0;
            this.lightHint = null;
            this.lightHintSceneKey = null;
            this.lightHintSampleAt = 0;
            this.lightHintDepthSignature = 'none';
            this.lastLightHintDebugSummary = '';
            this.parallaxPointerTarget = { x: 0, y: 0 };
            this.parallaxPointerCurrent = { x: 0, y: 0 };
            this.parallaxLastMoveAt = performance.now() / 1000;
            this.parallaxLastFrameAt = this.parallaxLastMoveAt;
            this.pointerMoveHandler = null;
            this.pointerLeaveHandler = null;
            this.pointerCanvas = null;
            this.parallaxDepthStats = null;
            this.parallaxDepthStatsSceneKey = null;
            this.parallaxDepthStatsSignature = 'none';
            this.parallaxDepthStatsSampleAt = 0;
            this.lastParallaxDepthStatsDebug = '';
            this.lastParallaxUvDebug = '';
            this.parallaxBoundSprites = new Set();
            this.effectLayer = null;
            this.effectLayerOwned = false;
            // For static-image scenes we intentionally run expensive passes below display FPS.
            this.staticSceneUpdateIntervalSec = 1 / 12;
            this.lastStaticSceneRenderAt = 0;
            this.lastStaticSceneKey = null;
            this.lastStaticDepthSignature = 'none';
            this.wasPausedForVideo = false;

            // Dummy white texture for when depth is not ready
            this.dummyDepth = PIXI.Texture.WHITE;

            this.initShaders();
            this.initSprites();
            this.bindParallaxPointerInput();

            this.preRenderHook = this.onPreRender.bind(this);
            pixiApp.hooks.addPreRender(this.preRenderHook, -10);
            debugLog(`[Alive BG] Pipeline Initialized (rev=${ALIVE_BG_SHADER_REV})`);
        }

        getSettings() {
            return window.ALIVE_BG_SETTINGS || {};
        }

        initShaders() {
            const vertexShader = `
                in vec2 aPosition;
                out vec2 vTextureCoord;
                uniform vec4 uInputSize;
                uniform vec4 uOutputFrame;
                uniform vec4 uOutputTexture;
                void main() {
                    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
                    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
                    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
                    gl_Position = vec4(position, 0.0, 1.0);
                    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
                }
            `;

            const parallaxVertexShader = `
                in vec2 aPosition;
                out vec2 vTextureCoord;
                out vec2 vFilterCoord;
                uniform vec4 uInputSize;
                uniform vec4 uOutputFrame;
                uniform vec4 uOutputTexture;
                void main(void) {
                    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
                    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
                    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
                    gl_Position = vec4(position, 0.0, 1.0);
                    // Color UV in Pixi's framed texture space.
                    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
                    // Filter UV in strict fullscreen [0..1] space for depth sampling.
                    vFilterCoord = aPosition;
                }
            `;

            this.bloomFilter = new PIXI.Filter({
                glProgram: new PIXI.GlProgram({
                    fragment: window.SHADER_ALIVE_BLOOM,
                    vertex: vertexShader,
                }),
                resources: {
                    aliveBloomUniforms: {
                        uThreshold: { value: 0.65, type: 'f32' },
                        uKnee: { value: 0.2, type: 'f32' },
                        uIntensity: { value: 0.6, type: 'f32' },
                        uWarmthBias: { value: 0.5, type: 'f32' },
                        uFlickerStrength: { value: 0.05, type: 'f32' },
                        uResolutionX: { value: this.rtWidth, type: 'f32' },
                        uResolutionY: { value: this.rtHeight, type: 'f32' },
                        uFlickerTime: { value: 0.0, type: 'f32' },
                        uSceneDimming: { value: 1.0, type: 'f32' },
                    },
                    uDepthMap: this.dummyDepth.source || this.dummyDepth,
                },
            });
            this.bloomFilter.padding = 0;

            this.giFilter = new PIXI.Filter({
                glProgram: new PIXI.GlProgram({
                    fragment: window.SHADER_ALIVE_GI,
                    vertex: vertexShader,
                }),
                resources: {
                    aliveGiUniforms: {
                        uRadius: { value: 6.0, type: 'f32' },
                        uIntensity: { value: 0.2, type: 'f32' },
                        uResolutionX: { value: this.rtWidth, type: 'f32' },
                        uResolutionY: { value: this.rtHeight, type: 'f32' },
                        uTime: { value: 0.0, type: 'f32' },
                        uSceneDarkness: { value: 0.5, type: 'f32' },
                    },
                    uDepthMap: this.dummyDepth.source || this.dummyDepth,
                },
            });
            this.giFilter.padding = 0;

            this.parallaxFilter = null;
            if (window.SHADER_ALIVE_PARALLAX) {
                try {
                    this.parallaxFilter = new PIXI.Filter({
                        glProgram: new PIXI.GlProgram({
                            fragment: window.SHADER_ALIVE_PARALLAX,
                            vertex: parallaxVertexShader,
                        }),
                        resources: {
                            aliveParallaxUniforms: {
                                uPointerX: { value: 0.0, type: 'f32' },
                                uPointerY: { value: 0.0, type: 'f32' },
                                uStrength: { value: 0.016, type: 'f32' },
                                uDepthInfluence: { value: 1.0, type: 'f32' },
                                uInvertDepth: { value: 0.0, type: 'f32' },
                                uVerticalDamping: { value: 0.58, type: 'f32' },
                                uIdleAmount: { value: 0.0, type: 'f32' },
                                uTime: { value: 0.0, type: 'f32' },
                                uEdgeClamp: { value: 0.0025, type: 'f32' },
                                uDepthCutoff: { value: 0.34, type: 'f32' },
                                uDepthFeather: { value: 0.08, type: 'f32' },
                                uDepthNormMin: { value: 0.0, type: 'f32' },
                                uDepthNormMax: { value: 1.0, type: 'f32' },
                                uResolutionX: { value: pixiApp.LOGICAL_WIDTH, type: 'f32' },
                                uResolutionY: { value: pixiApp.LOGICAL_HEIGHT, type: 'f32' },
                                uDebugMode: { value: 0.0, type: 'f32' },
                                uDepthUvScaleX: { value: 1.0, type: 'f32' },
                                uDepthUvScaleY: { value: 1.0, type: 'f32' },
                                uDepthUvOffsetX: { value: 0.0, type: 'f32' },
                                uDepthUvOffsetY: { value: 0.0, type: 'f32' },
                            },
                            uDepthMap: this.dummyDepth.source || this.dummyDepth,
                        },
                    });
                    this.parallaxFilter.padding = 0;
                    this.parallaxFilter.autoFit = true;
                    // Critical for depth UV alignment: avoid clipping the filter input to viewport.
                    // If clipped, UVs become "cropped-frame UVs", which misalign with full depth-map UVs.
                    this.parallaxFilter.clipToViewport = false;
                } catch (error) {
                    this.parallaxFilter = null;
                    console.warn('[Alive BG] Failed to initialize parallax shader, disabling parallax effect.', error);
                }
            } else {
                console.warn('[Alive BG] Missing parallax shader source. Cursor parallax is disabled.');
            }
        }

        initSprites() {
            // Use Pixi's string blend mode API for maximum compatibility in this runtime.
            this.nonDarkeningBlendMode = 'add';

            this.passSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
            this.passSprite.anchor.set(0, 0);
            this.passSprite.position.set(0, 0);
            this.passSprite.width = this.rtWidth;
            this.passSprite.height = this.rtHeight;

            this.analysisSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
            this.analysisSprite.anchor.set(0, 0);
            this.analysisSprite.position.set(0, 0);
            this.analysisSprite.width = this.analysisWidth;
            this.analysisSprite.height = this.analysisHeight;

            this.depthAnalysisSprite = new PIXI.Sprite(this.depthAlignedRT);
            this.depthAnalysisSprite.anchor.set(0, 0);
            this.depthAnalysisSprite.position.set(0, 0);
            this.depthAnalysisSprite.width = this.analysisWidth;
            this.depthAnalysisSprite.height = this.analysisHeight;

            this.depthAlignSprite = new PIXI.Sprite(this.dummyDepth);
            this.depthAlignSprite.anchor.set(0.5);
            this.depthAlignSprite.x = this.rtWidth / 2;
            this.depthAlignSprite.y = this.rtHeight / 2;

            this.depthParallaxSprite = new PIXI.Sprite(this.depthAlignedRT);
            this.depthParallaxSprite.anchor.set(0, 0);
            this.depthParallaxSprite.position.set(0, 0);
            this.depthParallaxSprite.width = pixiApp.LOGICAL_WIDTH;
            this.depthParallaxSprite.height = pixiApp.LOGICAL_HEIGHT;

            this.depthDebugOverlay = new PIXI.Sprite(this.dummyDepth);
            this.depthDebugOverlay.anchor.set(0.5);
            this.depthDebugOverlay.x = pixiApp.LOGICAL_WIDTH / 2;
            this.depthDebugOverlay.y = pixiApp.LOGICAL_HEIGHT / 2;
            this.depthDebugOverlay.width = pixiApp.LOGICAL_WIDTH;
            this.depthDebugOverlay.height = pixiApp.LOGICAL_HEIGHT;
            this.depthDebugOverlay.blendMode = 'normal';
            this.depthDebugOverlay.visible = false;

            this.parallaxOverlay = new PIXI.Sprite(this.parallaxRT);
            this.parallaxOverlay.anchor.set(0.5);
            this.parallaxOverlay.x = pixiApp.LOGICAL_WIDTH / 2;
            this.parallaxOverlay.y = pixiApp.LOGICAL_HEIGHT / 2;
            this.parallaxOverlay.width = pixiApp.LOGICAL_WIDTH;
            this.parallaxOverlay.height = pixiApp.LOGICAL_HEIGHT;
            this.parallaxOverlay.blendMode = 'normal';
            this.parallaxOverlay.alpha = 1.0;
            this.parallaxOverlay.visible = false;

            this.bloomOverlay = new PIXI.Sprite(this.bloomRT);
            this.bloomOverlay.anchor.set(0.5);
            this.bloomOverlay.x = pixiApp.LOGICAL_WIDTH / 2;
            this.bloomOverlay.y = pixiApp.LOGICAL_HEIGHT / 2;
            this.bloomOverlay.width = pixiApp.LOGICAL_WIDTH;
            this.bloomOverlay.height = pixiApp.LOGICAL_HEIGHT;
            this.bloomOverlay.blendMode = this.nonDarkeningBlendMode;
            this.bloomOverlay.visible = false;
            // Bloom softness is now handled inside the bloom shader to avoid edge halo artifacts.
            this.bloomOverlay.filters = null;

            this.giOverlay = new PIXI.Sprite(this.giRT);
            this.giOverlay.anchor.set(0.5);
            this.giOverlay.x = pixiApp.LOGICAL_WIDTH / 2;
            this.giOverlay.y = pixiApp.LOGICAL_HEIGHT / 2;
            this.giOverlay.width = pixiApp.LOGICAL_WIDTH;
            this.giOverlay.height = pixiApp.LOGICAL_HEIGHT;
            this.giOverlay.blendMode = this.nonDarkeningBlendMode;
            this.giOverlay.visible = false;
            this.giSoftenFilter = new PIXI.BlurFilter();
            this.giSoftenFilter.blur = 1.6;
            this.giSoftenFilter.quality = 2;
            this.giOverlay.filters = [this.giSoftenFilter];

            // Effects go between background and characters.
            this.effectLayer = this.ensureEffectLayer();
            if (this.effectLayer) {
                this.effectLayer.addChild(this.parallaxOverlay);
                this.effectLayer.addChild(this.giOverlay);
                this.effectLayer.addChild(this.bloomOverlay);
            } else {
                pixiApp.app.stage.addChild(this.parallaxOverlay);
                pixiApp.app.stage.addChild(this.giOverlay);
                pixiApp.app.stage.addChild(this.bloomOverlay);
            }

            // Keep debug overlay in FX so it can truly override and stay visible.
            if (pixiApp.layers.fx) {
                pixiApp.layers.fx.addChild(this.depthDebugOverlay);
            } else {
                pixiApp.app.stage.addChild(this.depthDebugOverlay);
            }

            debugLog(`[Alive BG] Overlay blend modes (bloom=${this.bloomOverlay.blendMode}, gi=${this.giOverlay.blendMode})`);
            debugLog(`[Alive BG] Cursor parallax ${this.parallaxFilter ? 'initialized' : 'disabled (shader unavailable)'}.`);
        }

        ensureEffectLayer() {
            if (this.effectLayer) return this.effectLayer;

            const existing = pixiApp.layers?.aliveBgUnderlay;
            if (existing) {
                this.effectLayerOwned = false;
                return existing;
            }

            const layer = new PIXI.Container();
            layer.label = 'Layer_AliveBG_UnderCharacters';

            if (pixiApp.world && pixiApp.layers?.background && pixiApp.layers?.characters) {
                const world = pixiApp.world;
                const bgIndex = world.getChildIndex(pixiApp.layers.background);
                const insertIndex = Math.max(0, bgIndex + 1);
                world.addChildAt(layer, Math.min(insertIndex, world.children.length));
            } else if (pixiApp.app?.stage) {
                pixiApp.app.stage.addChild(layer);
            }

            if (pixiApp.layers) {
                pixiApp.layers.aliveBgUnderlay = layer;
            }

            this.effectLayerOwned = true;
            return layer;
        }

        syncEffectLayerOrder() {
            if (!this.effectLayer || !pixiApp.world || !pixiApp.layers?.background || !pixiApp.layers?.characters) return;

            const world = pixiApp.world;
            if (this.effectLayer.parent !== world) {
                world.addChild(this.effectLayer);
            }

            const bgIndex = world.getChildIndex(pixiApp.layers.background);
            const charIndex = world.getChildIndex(pixiApp.layers.characters);
            if (bgIndex < 0 || charIndex < 0) return;

            const currentIndex = world.getChildIndex(this.effectLayer);
            const targetIndex = Math.max(0, Math.min(charIndex, bgIndex + 1));
            if (currentIndex !== targetIndex) {
                world.setChildIndex(this.effectLayer, targetIndex);
            }
        }

        smoothstep(edge0, edge1, x) {
            const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
            return t * t * (3 - 2 * t);
        }

        clamp01(value) {
            return Math.max(0, Math.min(1, value));
        }

        roundForDebug(value, digits = 3) {
            const scale = 10 ** digits;
            return Math.round(value * scale) / scale;
        }

        logLightHintDebug(sceneKey, status, data = null) {
            const summary = `${sceneKey}|${status}`;
            if (this.lastLightHintDebugSummary === summary) return;
            this.lastLightHintDebugSummary = summary;
            debugLog(`[Alive BG] Light hint ${status}`, data);
        }

        clamp(value, min, max) {
            return Math.max(min, Math.min(max, value));
        }

        bindParallaxPointerInput() {
            if (this.pointerMoveHandler) return;

            const canvas = pixiApp.app?.canvas || document.getElementById('vn-canvas');
            if (!canvas) return;

            this.pointerCanvas = canvas;
            this.pointerMoveHandler = (event) => {
                if (!this.pointerCanvas) return;
                const rect = this.pointerCanvas.getBoundingClientRect();
                if (!rect || rect.width <= 0 || rect.height <= 0) return;

                const normX = ((event.clientX - rect.left) / rect.width) * 2.0 - 1.0;
                const normY = ((event.clientY - rect.top) / rect.height) * 2.0 - 1.0;

                this.parallaxPointerTarget.x = this.clamp(normX, -1, 1);
                this.parallaxPointerTarget.y = this.clamp(normY, -1, 1);
                this.parallaxLastMoveAt = performance.now() / 1000;
            };
            this.pointerLeaveHandler = () => {
                this.parallaxPointerTarget.x = 0;
                this.parallaxPointerTarget.y = 0;
            };

            window.addEventListener('pointermove', this.pointerMoveHandler, { passive: true });
            this.pointerCanvas.addEventListener('pointerleave', this.pointerLeaveHandler);
            this.pointerCanvas.addEventListener('pointercancel', this.pointerLeaveHandler);
        }

        unbindParallaxPointerInput() {
            if (this.pointerMoveHandler) {
                window.removeEventListener('pointermove', this.pointerMoveHandler);
            }

            if (this.pointerCanvas && this.pointerLeaveHandler) {
                this.pointerCanvas.removeEventListener('pointerleave', this.pointerLeaveHandler);
                this.pointerCanvas.removeEventListener('pointercancel', this.pointerLeaveHandler);
            }

            this.pointerMoveHandler = null;
            this.pointerLeaveHandler = null;
            this.pointerCanvas = null;
        }

        isParallaxTargetSprite(displayObject) {
            return !!(
                displayObject &&
                displayObject.texture &&
                (displayObject.texture.width > 0) &&
                (displayObject.texture.height > 0)
            );
        }

        getPrimaryBackgroundSprite() {
            const backgroundLayer = pixiApp.layers?.background;
            const children = Array.isArray(backgroundLayer?.children) ? backgroundLayer.children : [];
            if (!children.length) return null;

            let best = null;
            let bestScore = -1;

            for (const child of children) {
                if (!child || !this.isParallaxTargetSprite(child)) continue;
                if (child.visible === false) continue;

                const width = Math.abs(child.width || 0);
                const height = Math.abs(child.height || 0);
                if (width <= 0 || height <= 0) continue;

                const alpha = (typeof child.alpha === 'number') ? this.clamp(child.alpha, 0, 1) : 1;
                const score = width * height * Math.max(0.001, alpha);

                if (score > bestScore) {
                    bestScore = score;
                    best = child;
                }
            }

            return best;
        }

        syncParallaxSpriteFilters() {
            const backgroundLayer = pixiApp.layers?.background;
            if (!backgroundLayer || !this.parallaxFilter) return;

            const children = Array.isArray(backgroundLayer.children) ? backgroundLayer.children : [];
            const candidates = [];

            for (let i = 0; i < children.length; i += 1) {
                const child = children[i];
                if (!this.isParallaxTargetSprite(child)) continue;
                candidates.push(child);
            }

            for (const child of candidates) {
                const existingFilters = Array.isArray(child.filters) ? child.filters : [];
                const otherFilters = existingFilters.filter((filter) => filter !== this.parallaxFilter);

                if (existingFilters.length !== otherFilters.length) {
                    child.filters = otherFilters.length ? otherFilters : null;
                }
            }

            for (const sprite of this.parallaxBoundSprites) {
                if (!sprite) continue;
                const existingFilters = Array.isArray(sprite.filters) ? sprite.filters : [];
                const otherFilters = existingFilters.filter((filter) => filter !== this.parallaxFilter);
                if (existingFilters.length !== otherFilters.length) {
                    sprite.filters = otherFilters.length ? otherFilters : null;
                }
            }

            this.parallaxBoundSprites = new Set();
        }

        updateParallax(now, backgroundTexture, depthTexture, hasRealDepth, settings, forceDisable = false) {
            const debugMode = settings.show_parallax_sample_debug === true;
            const enabled =
                !forceDisable &&
                !!this.parallaxFilter &&
                !!hasRealDepth &&
                (settings.enable_parallax !== false || debugMode);
            // We now render parallax in an explicit offscreen pass (not as a filter on sprites),
            // to keep color/depth UV spaces identical and avoid displaced cross-quadrant sampling.
            this.syncParallaxSpriteFilters(false);
            if (!enabled || !this.parallaxFilter || !backgroundTexture) {
                if (this.parallaxOverlay) this.parallaxOverlay.visible = false;
                return;
            }

            const dt = this.clamp(now - this.parallaxLastFrameAt, 0.001, 0.08);
            this.parallaxLastFrameAt = now;

            const followSpeed = Math.max(2.0, settings.parallax_follow_speed ?? 8.5);
            const blend = 1.0 - Math.exp(-followSpeed * dt);

            this.parallaxPointerCurrent.x += (this.parallaxPointerTarget.x - this.parallaxPointerCurrent.x) * blend;
            this.parallaxPointerCurrent.y += (this.parallaxPointerTarget.y - this.parallaxPointerCurrent.y) * blend;

            const idleSeconds = Math.max(0, now - this.parallaxLastMoveAt);
            const idleAmount =
                Math.max(0.0, settings.parallax_idle_motion ?? 0.2) *
                this.smoothstep(0.75, 2.1, idleSeconds);

            const depthStats = this.parallaxDepthStats;
            const userInvert = settings.parallax_invert_depth === true;
            const polarityStats = userInvert ? depthStats?.near : depthStats?.far;
            const contrast = polarityStats?.contrast ?? depthStats?.contrast ?? 0.22;
            const contrastScale = this.clamp((contrast - 0.05) / 0.25, 0.25, 1.0);

            const strengthBase = Math.max(0.0, settings.parallax_strength ?? 0.016);
            const strengthRaw = hasRealDepth ? strengthBase : (strengthBase * 0.42);
            const motionScale = this.clamp(settings.parallax_motion_scale ?? 0.2, 0.05, 2.0);
            const strength = strengthRaw * contrastScale * 0.82 * motionScale;

            // Stable behavior: default profile biases far/background drift.
            // Users can explicitly flip polarity via setting when needed.
            const finalInvert = userInvert;

            const userCutoff = this.clamp(settings.parallax_depth_cutoff ?? 0.72, 0.0, 1.0);
            const autoCutoff = this.clamp(polarityStats?.autoCutoff ?? 0.78, 0.0, 1.0);
            const cutoffFloor = hasRealDepth ? 0.74 : 0.86;
            const cutoff = Math.max(cutoffFloor, userCutoff, autoCutoff);

            const userFeather = this.clamp(settings.parallax_depth_feather ?? 0.08, 0.005, 0.35);
            const autoFeather = this.clamp(polarityStats?.autoFeather ?? 0.08, 0.005, 0.35);
            const feather = this.clamp(Math.max(0.03, (userFeather + autoFeather) * 0.5), 0.02, 0.20);

            const depthNormMin = this.clamp(polarityStats?.normMin ?? 0.0, 0.0, 0.95);
            const depthNormMax = this.clamp(
                polarityStats?.normMax ?? 1.0,
                Math.max(depthNormMin + 0.02, 0.02),
                1.0
            );

            const uniforms = this.parallaxFilter.resources.aliveParallaxUniforms.uniforms;
            uniforms.uPointerX = this.parallaxPointerCurrent.x;
            uniforms.uPointerY = this.parallaxPointerCurrent.y;
            uniforms.uStrength = strength;
            uniforms.uDepthInfluence = 1.0;
            uniforms.uInvertDepth = finalInvert ? 1.0 : 0.0;
            uniforms.uVerticalDamping = 0.58;
            uniforms.uIdleAmount = idleAmount;
            uniforms.uTime = now;
            uniforms.uEdgeClamp = 0.0025;
            uniforms.uDepthCutoff = cutoff;
            uniforms.uDepthFeather = feather;
            uniforms.uDepthNormMin = depthNormMin;
            uniforms.uDepthNormMax = depthNormMax;
            uniforms.uDebugMode = debugMode ? 1.0 : 0.0;
            uniforms.uResolutionX = this.rtWidth;
            uniforms.uResolutionY = this.rtHeight;

            // Map fullscreen UVs to the exact depth-texture frame region.
            // This prevents vertical/horizontal stretching when the texture frame
            // is smaller than its backing source (e.g., high-DPI render targets).
            let depthUvScaleX = 1.0;
            let depthUvScaleY = 1.0;
            let depthUvOffsetX = 0.0;
            let depthUvOffsetY = 0.0;

            const depthFrame = depthTexture?.frame || null;
            const depthSourceObj = depthTexture?.source || null;
            const sourceWLogical = Math.max(1, depthSourceObj?.width || depthTexture?.width || 1);
            const sourceHLogical = Math.max(1, depthSourceObj?.height || depthTexture?.height || 1);
            const sourceWStorage = Math.max(sourceWLogical, depthSourceObj?.pixelWidth || 0);
            const sourceHStorage = Math.max(sourceHLogical, depthSourceObj?.pixelHeight || 0);
            const sourceW = sourceWStorage > sourceWLogical ? sourceWStorage : sourceWLogical;
            const sourceH = sourceHStorage > sourceHLogical ? sourceHStorage : sourceHLogical;

            if (depthFrame && Number.isFinite(depthFrame.width) && Number.isFinite(depthFrame.height)) {
                depthUvScaleX = this.clamp(depthFrame.width / sourceW, 0.0001, 1.0);
                depthUvScaleY = this.clamp(depthFrame.height / sourceH, 0.0001, 1.0);
                depthUvOffsetX = this.clamp(depthFrame.x / sourceW, 0.0, 1.0 - depthUvScaleX);
                depthUvOffsetY = this.clamp(depthFrame.y / sourceH, 0.0, 1.0 - depthUvScaleY);
            }

            uniforms.uDepthUvScaleX = depthUvScaleX;
            uniforms.uDepthUvScaleY = depthUvScaleY;
            uniforms.uDepthUvOffsetX = depthUvOffsetX;
            uniforms.uDepthUvOffsetY = depthUvOffsetY;

            const uvSummary = `${this.roundForDebug(depthUvScaleX, 3)}|${this.roundForDebug(depthUvScaleY, 3)}|${this.roundForDebug(depthUvOffsetX, 3)}|${this.roundForDebug(depthUvOffsetY, 3)}`;
            if (this.lastParallaxUvDebug !== uvSummary) {
                this.lastParallaxUvDebug = uvSummary;
                debugLog('[Alive BG] Parallax depth UV remap', {
                    scaleX: this.roundForDebug(depthUvScaleX, 4),
                    scaleY: this.roundForDebug(depthUvScaleY, 4),
                    offsetX: this.roundForDebug(depthUvOffsetX, 4),
                    offsetY: this.roundForDebug(depthUvOffsetY, 4),
                    sourceWLogical,
                    sourceHLogical,
                    sourceWStorage,
                    sourceHStorage,
                    sourceW,
                    sourceH,
                });
            }
            this.parallaxFilter.resources.uDepthMap = depthTexture
                ? (depthTexture.source || depthTexture)
                : (this.dummyDepth.source || this.dummyDepth);

            this.passSprite.texture = backgroundTexture;
            this.passSprite.width = pixiApp.LOGICAL_WIDTH;
            this.passSprite.height = pixiApp.LOGICAL_HEIGHT;
            this.passSprite.filters = [this.parallaxFilter];

            pixiApp.app.renderer.render({
                container: this.passSprite,
                target: this.parallaxRT,
                clear: true,
            });

            this.passSprite.filters = null;
            this.parallaxOverlay.alpha = 1.0;
            this.parallaxOverlay.visible = true;
        }

        percentileFromSorted(sortedValues, q) {
            if (!sortedValues || !sortedValues.length) return 0;
            const n = sortedValues.length;
            const clampedQ = this.clamp(q, 0, 1);
            const index = (n - 1) * clampedQ;
            const lower = Math.floor(index);
            const upper = Math.min(n - 1, lower + 1);
            const t = index - lower;
            return sortedValues[lower] * (1 - t) + sortedValues[upper] * t;
        }

        buildParallaxPolarityStats(sortedValues) {
            const p10 = this.percentileFromSorted(sortedValues, 0.10);
            const p55 = this.percentileFromSorted(sortedValues, 0.55);
            const p72 = this.percentileFromSorted(sortedValues, 0.72);
            const p80 = this.percentileFromSorted(sortedValues, 0.80);
            const p90 = this.percentileFromSorted(sortedValues, 0.90);
            const p92 = this.percentileFromSorted(sortedValues, 0.92);
            const contrast = this.clamp(p90 - p10, 0.001, 1.0);

            return {
                autoCutoff: this.clamp(Math.max(0.72, p80), 0.65, 0.97),
                autoFeather: this.clamp(Math.max(0.02, Math.min(0.10, contrast * 0.30)), 0.015, 0.12),
                contrast,
                normMin: p10,
                normMax: Math.max(p10 + 0.02, p90),
                p10,
                p55,
                p72,
                p80,
                p90,
                p92,
            };
        }

        shouldResampleParallaxDepthStats(sceneKey, depthSignature, nowSeconds) {
            if (!this.parallaxDepthStats) return true;
            if (!this.parallaxDepthStatsSceneKey || this.parallaxDepthStatsSceneKey !== sceneKey) return true;
            if (this.parallaxDepthStatsSignature !== depthSignature) return true;
            if (this.isVideoSource(sceneKey)) return (nowSeconds - this.parallaxDepthStatsSampleAt) > 1.2;
            return (nowSeconds - this.parallaxDepthStatsSampleAt) > 3.2;
        }

        updateParallaxDepthStats(sceneKey, depthSignature, nowSeconds) {
            const pixels = this.renderDepthAnalysisPixels(this.depthAlignedRT);
            const pixelCount = this.analysisWidth * this.analysisHeight;
            if (!pixels || pixels.length < pixelCount * 4) return null;

            const nearCandidates = new Array(pixelCount);
            const farCandidates = new Array(pixelCount);
            for (let y = 0; y < this.analysisHeight; y++) {
                for (let x = 0; x < this.analysisWidth; x++) {
                    const idx = (y * this.analysisWidth) + x;
                    const offset = idx * 4;
                    const value = pixels[offset] / 255;
                    nearCandidates[idx] = value;
                    farCandidates[idx] = 1.0 - value;
                }
            }

            nearCandidates.sort((a, b) => a - b);
            farCandidates.sort((a, b) => a - b);

            const nearStats = this.buildParallaxPolarityStats(nearCandidates);
            const farStats = this.buildParallaxPolarityStats(farCandidates);

            this.parallaxDepthStats = {
                near: nearStats,
                far: farStats,
                contrast: farStats.contrast,
            };
            this.parallaxDepthStatsSceneKey = sceneKey;
            this.parallaxDepthStatsSignature = depthSignature;
            this.parallaxDepthStatsSampleAt = nowSeconds;

            const debugSummary = `${sceneKey}|${depthSignature}|${this.roundForDebug(farStats.autoCutoff, 2)}|${this.roundForDebug(farStats.contrast, 2)}`;
            if (this.lastParallaxDepthStatsDebug !== debugSummary) {
                this.lastParallaxDepthStatsDebug = debugSummary;
                debugLog('[Alive BG] Parallax depth stats updated', {
                    far: {
                        autoCutoff: this.roundForDebug(farStats.autoCutoff, 3),
                        autoFeather: this.roundForDebug(farStats.autoFeather, 3),
                        contrast: this.roundForDebug(farStats.contrast, 3),
                        normMin: this.roundForDebug(farStats.normMin, 3),
                        normMax: this.roundForDebug(farStats.normMax, 3),
                        p10: this.roundForDebug(farStats.p10, 3),
                        p55: this.roundForDebug(farStats.p55, 3),
                        p72: this.roundForDebug(farStats.p72, 3),
                        p80: this.roundForDebug(farStats.p80, 3),
                        p90: this.roundForDebug(farStats.p90, 3),
                        p92: this.roundForDebug(farStats.p92, 3),
                    },
                    near: {
                        autoCutoff: this.roundForDebug(nearStats.autoCutoff, 3),
                        autoFeather: this.roundForDebug(nearStats.autoFeather, 3),
                        contrast: this.roundForDebug(nearStats.contrast, 3),
                        normMin: this.roundForDebug(nearStats.normMin, 3),
                        normMax: this.roundForDebug(nearStats.normMax, 3),
                        p10: this.roundForDebug(nearStats.p10, 3),
                        p55: this.roundForDebug(nearStats.p55, 3),
                        p72: this.roundForDebug(nearStats.p72, 3),
                        p80: this.roundForDebug(nearStats.p80, 3),
                        p90: this.roundForDebug(nearStats.p90, 3),
                        p92: this.roundForDebug(nearStats.p92, 3),
                    },
                });
            }

            return this.parallaxDepthStats;
        }

        isVideoSource(source) {
            return /\.(mp4|webm|mov)(\?.*)?$/i.test(String(source || ''));
        }

        shouldRenderStaticSceneFrame(sceneKey, depthSignature, nowSeconds, forceRealtime = false) {
            if (forceRealtime) return true;
            if (!this.lastStaticSceneKey || this.lastStaticSceneKey !== sceneKey) return true;
            if (this.lastStaticDepthSignature !== depthSignature) return true;
            return (nowSeconds - this.lastStaticSceneRenderAt) >= this.staticSceneUpdateIntervalSec;
        }

        markStaticSceneFrame(sceneKey, depthSignature, nowSeconds) {
            this.lastStaticSceneKey = sceneKey;
            this.lastStaticDepthSignature = depthSignature;
            this.lastStaticSceneRenderAt = nowSeconds;
        }

        extractPixelsFromRenderTexture(target) {
            const renderer = pixiApp.app?.renderer;
            if (!renderer || !target) return null;

            let pixels = null;
            try {
                if (renderer.extract && typeof renderer.extract.pixels === 'function') {
                    pixels = renderer.extract.pixels(target);
                }
            } catch {
                try {
                    if (renderer.extract && typeof renderer.extract.pixels === 'function') {
                        pixels = renderer.extract.pixels({ target });
                    }
                } catch (extractError) {
                    console.warn('[Alive BG] RenderTexture pixel extraction failed:', extractError);
                    return null;
                }
            }

            return (pixels && pixels.length) ? pixels : null;
        }

        renderSceneAnalysisPixels(sceneKey, backgroundTexture, nowSeconds) {
            const renderer = pixiApp.app?.renderer;
            if (!renderer || !backgroundTexture) {
                this.logLightHintDebug(sceneKey, 'analysis-skip (missing-renderer-or-background)');
                return null;
            }

            this.analysisSprite.texture = backgroundTexture;

            try {
                renderer.render({
                    container: this.analysisSprite,
                    target: this.analysisRT,
                    clear: true,
                });
            } catch (error) {
                this.logLightHintDebug(sceneKey, 'analysis-failed (render-to-analysis-rt)', error?.message || error || '(unknown)');
                return null;
            }

            const pixels = this.extractPixelsFromRenderTexture(this.analysisRT);
            if (pixels && pixels.length) {
                this.lastAnalysisPixels = pixels;
                this.lastAnalysisKey = sceneKey;
                this.lastAnalysisAt = nowSeconds;
            } else {
                this.logLightHintDebug(sceneKey, 'analysis-failed (extract-pixels-empty)');
            }
            return pixels;
        }

        renderDepthAnalysisPixels(depthTexture) {
            const renderer = pixiApp.app?.renderer;
            if (!renderer || !depthTexture) return null;

            this.depthAnalysisSprite.texture = depthTexture;

            try {
                renderer.render({
                    container: this.depthAnalysisSprite,
                    target: this.analysisDepthRT,
                    clear: true,
                });
            } catch {
                return null;
            }

            return this.extractPixelsFromRenderTexture(this.analysisDepthRT);
        }

        shouldResampleSceneBrightness(sceneKey, nowSeconds) {
            if (!this.sceneBrightnessKey || this.sceneBrightnessKey !== sceneKey) return true;
            if (this.isVideoSource(sceneKey)) return (nowSeconds - this.lastBrightnessSampleAt) > 1.2;
            return (nowSeconds - this.lastBrightnessSampleAt) > 3.0;
        }

        updateSceneBrightnessFromPixels(sceneKey, pixels, nowSeconds) {
            if (!pixels || !pixels.length) return;
            this.sceneBrightnessKey = sceneKey;
            this.lastBrightnessSampleAt = nowSeconds;

            let lumaSum = 0;
            const pixelCount = pixels.length / 4;
            for (let i = 0; i < pixels.length; i += 4) {
                const r = pixels[i] / 255;
                const g = pixels[i + 1] / 255;
                const b = pixels[i + 2] / 255;
                lumaSum += (0.299 * r) + (0.587 * g) + (0.114 * b);
            }

            if (pixelCount > 0) {
                this.sceneLuma = lumaSum / pixelCount;
            }
        }

        updateSceneBrightnessFromTexture(sceneKey, backgroundTexture, nowSeconds) {
            const pixels = this.renderSceneAnalysisPixels(sceneKey, backgroundTexture, nowSeconds);
            if (!pixels || !pixels.length) return null;
            this.updateSceneBrightnessFromPixels(sceneKey, pixels, nowSeconds);
            return pixels;
        }

        shouldResampleLightHint(sceneKey, depthSignature, nowSeconds) {
            if (!this.lightHint || !this.lightHintSceneKey || this.lightHintSceneKey !== sceneKey) return true;
            if (this.lightHintDepthSignature !== depthSignature) return true;
            if (this.isVideoSource(sceneKey)) return (nowSeconds - this.lightHintSampleAt) > 1.2;
            return (nowSeconds - this.lightHintSampleAt) > 3.0;
        }

        updateLightHintFromPixels(sceneKey, pixels, depthTexture, nowSeconds, sourceId = null) {
            const width = this.analysisWidth;
            const height = this.analysisHeight;
            const widthMax = Math.max(1, width - 1);
            const heightMax = Math.max(1, height - 1);
            const pixelCount = width * height;
            const depthSignature = depthTexture ? `depth:${depthTexture.uid || depthTexture._updateID || 'live'}` : 'none';

            this.lightHintSceneKey = sceneKey;
            this.lightHintSampleAt = nowSeconds;
            this.lightHintDepthSignature = depthSignature;

            if (!pixels || pixels.length < pixelCount * 4) {
                this.lightHint = null;
                this.logLightHintDebug(sceneKey, 'rejected (analysis-pixels-missing)');
                return null;
            }

            const depthPixels = depthTexture ? this.renderDepthAnalysisPixels(this.depthAlignedRT) : null;
            const hasDepth = !!(depthPixels && depthPixels.length >= pixelCount * 4);
            const lumaValues = new Float32Array(pixelCount);
            const depthValues = hasDepth ? new Float32Array(pixelCount) : null;

            for (let i = 0; i < pixelCount; i++) {
                const offset = i * 4;
                const r = pixels[offset] / 255;
                const g = pixels[offset + 1] / 255;
                const b = pixels[offset + 2] / 255;
                lumaValues[i] = (0.299 * r) + (0.587 * g) + (0.114 * b);
                if (depthValues) {
                    depthValues[i] = depthPixels[offset] / 255;
                }
            }

            const readDepth = (x, y) => {
                if (!depthValues) return 0.35;
                const clampedX = Math.max(0, Math.min(widthMax, x));
                const clampedY = Math.max(0, Math.min(heightMax, y));
                return depthValues[(clampedY * width) + clampedX];
            };

            let sourceWeightSum = 0.0;
            let sourceXSum = 0.0;
            let sourceYSum = 0.0;
            let bestSourceScore = 0.0;

            for (let y = 0; y < height; y++) {
                const yNorm = y / heightMax;
                for (let x = 0; x < width; x++) {
                    const xNorm = x / widthMax;
                    const idx = (y * width) + x;
                    const offset = idx * 4;
                    const r = pixels[offset] / 255;
                    const g = pixels[offset + 1] / 255;
                    const b = pixels[offset + 2] / 255;
                    const luma = lumaValues[idx];
                    const peak = Math.max(r, Math.max(g, b));
                    const depth = readDepth(x, y);

                    const brightness = this.smoothstep(0.60, 0.98, Math.max(luma, peak * 0.92));
                    const topBias = 1.0 - this.smoothstep(0.12, 0.60, yNorm);
                    const farBias = hasDepth ? (1.0 - depth) : 0.72;
                    const warmBias = this.clamp01(((r - b) * 1.15) + ((g - b) * 0.35) + 0.22);
                    const coolBias = this.clamp01(((b - r) * 1.10) + ((b - g) * 0.40) + 0.18);
                    const colorBias = 0.76 + (0.24 * Math.max(warmBias, coolBias));

                    let sourceScore = brightness * brightness * (0.42 + (0.58 * topBias)) * (0.64 + (0.36 * farBias)) * colorBias;
                    if (yNorm > 0.60) sourceScore *= 0.08;
                    else if (yNorm > 0.46) sourceScore *= 0.30;
                    if (xNorm < 0.02 || xNorm > 0.98) sourceScore *= 0.65;

                    sourceWeightSum += sourceScore;
                    sourceXSum += xNorm * sourceScore;
                    sourceYSum += yNorm * sourceScore;
                    if (sourceScore > bestSourceScore) {
                        bestSourceScore = sourceScore;
                    }
                }
            }

            if (sourceWeightSum <= 0.0001) {
                this.lightHint = null;
                this.logLightHintDebug(sceneKey, 'rejected (no-source-energy)');
                return null;
            }

            let sourceX = sourceXSum / sourceWeightSum;
            let sourceY = sourceYSum / sourceWeightSum;
            const sourceMean = sourceWeightSum / pixelCount;
            const sourcePeakiness = this.clamp01(bestSourceScore / Math.max(0.08, sourceMean * 4.5));
            const topConfidence = 1.0 - this.smoothstep(0.24, 0.48, sourceY);
            const energyConfidence = this.smoothstep(0.16, 0.52, sourceWeightSum / Math.max(1.0, pixelCount * 0.42));
            let confidence = this.clamp01((sourcePeakiness * 0.48) + (topConfidence * 0.34) + (energyConfidence * 0.18));

            if (sourceY > 0.48 || bestSourceScore < 0.08) {
                this.lightHint = null;
                const reason = (sourceY > 0.48) ? 'source-too-low' : 'source-too-weak';
                this.logLightHintDebug(sceneKey, `rejected (${reason})`, {
                    sourceY: this.roundForDebug(sourceY),
                    bestSourceScore: this.roundForDebug(bestSourceScore),
                    sourceWeightSum: this.roundForDebug(sourceWeightSum),
                });
                return null;
            }

            sourceX = this.clamp01(sourceX);
            sourceY = Math.min(0.42, this.clamp01(sourceY));

            let occluderWeightSum = 0.0;
            let occluderXSum = 0.0;
            let occluderYSum = 0.0;

            for (let y = 0; y < height; y++) {
                const yNorm = y / heightMax;
                if (yNorm <= sourceY + 0.04) continue;

                for (let x = 0; x < width; x++) {
                    const idx = (y * width) + x;
                    const luma = lumaValues[idx];
                    const depth = readDepth(x, y);
                    const depthDx = readDepth(x + 1, y) - readDepth(x - 1, y);
                    const depthDy = readDepth(x, y + 1) - readDepth(x, y - 1);
                    const depthEdge = this.clamp01(Math.sqrt((depthDx * depthDx) + (depthDy * depthDy)) * 3.6);
                    const nearBias = hasDepth ? this.smoothstep(0.28, 0.95, depth) : 0.35;
                    const darkBias = this.smoothstep(0.18, 0.92, 1.0 - luma);
                    const verticalBias = this.smoothstep(sourceY + 0.04, 0.92, yNorm);
                    const occluderScore = depthEdge * (0.36 + (0.64 * nearBias)) * (0.52 + (0.48 * darkBias)) * (0.42 + (0.58 * verticalBias));

                    occluderWeightSum += occluderScore;
                    occluderXSum += (x / widthMax) * occluderScore;
                    occluderYSum += yNorm * occluderScore;
                }
            }

            let targetX = 0.5 + ((sourceX - 0.5) * 0.22);
            let targetY = Math.max(0.60, sourceY + 0.20);
            if (occluderWeightSum > 0.0001) {
                targetX = occluderXSum / occluderWeightSum;
                targetY = occluderYSum / occluderWeightSum;
            }

            targetX = this.clamp01(targetX);
            targetY = this.clamp01(Math.max(targetY, sourceY + 0.14));

            const dx = (targetX - sourceX) * pixiApp.LOGICAL_WIDTH;
            const dy = Math.max(1.0, (targetY - sourceY) * pixiApp.LOGICAL_HEIGHT);
            let angle = Math.atan2(dy, dx || 0.0001) * (180 / Math.PI);
            if (!Number.isFinite(angle)) angle = 90;
            angle = Math.max(25, Math.min(155, angle));

            if (!hasDepth) {
                confidence *= 0.78;
            }

            confidence = this.clamp01(confidence);

            const hint = {
                src: sourceId || sceneKey,
                sceneKey,
                x: sourceX,
                y: sourceY,
                targetX,
                targetY,
                angle,
                confidence,
                hasDepth,
                computedAt: nowSeconds,
            };

            this.lightHint = hint;
            this.logLightHintDebug(sceneKey, `ready angle=${this.roundForDebug(angle, 1)} conf=${this.roundForDebug(confidence, 2)}`, {
                src: hint.src,
                x: this.roundForDebug(hint.x),
                y: this.roundForDebug(hint.y),
                targetX: this.roundForDebug(hint.targetX),
                targetY: this.roundForDebug(hint.targetY),
                angle: this.roundForDebug(hint.angle, 1),
                confidence: this.roundForDebug(hint.confidence, 2),
                hasDepth: hint.hasDepth,
            });
            window.dispatchEvent(new CustomEvent('alive-bg:light-hint-ready', {
                detail: hint,
            }));
            return hint;
        }

        getLightHint(src = null) {
            if (!this.lightHint) return null;
            if (!src) return this.lightHint;
            return (this.lightHint.src === src || this.lightHint.sceneKey === src) ? this.lightHint : null;
        }

        async computeLightHintFromImageUrl(sceneKey, imageUrl, sourceId = null) {
            if (!imageUrl) {
                this.logLightHintDebug(sceneKey || '(unknown)', 'image-fallback-skip (missing-url)');
                return null;
            }

            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.crossOrigin = 'anonymous';
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error(`Failed to load image for light hint: ${imageUrl}`));
                image.src = imageUrl;
            });

            const canvas = document.createElement('canvas');
            canvas.width = this.analysisWidth;
            canvas.height = this.analysisHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
                this.logLightHintDebug(sceneKey || '(unknown)', 'image-fallback-failed (no-2d-context)');
                return null;
            }

            ctx.drawImage(img, 0, 0, this.analysisWidth, this.analysisHeight);
            const pixels = ctx.getImageData(0, 0, this.analysisWidth, this.analysisHeight).data;
            const now = performance.now() / 1000;
            this.lastAnalysisPixels = pixels;
            this.lastAnalysisKey = sceneKey;
            this.lastAnalysisAt = now;
            this.updateSceneBrightnessFromPixels(sceneKey, pixels, now);
            const hint = this.updateLightHintFromPixels(sceneKey, pixels, null, now, sourceId || sceneKey);
            this.logLightHintDebug(sceneKey, hint ? 'image-fallback-ready' : 'image-fallback-no-hint');
            return hint;
        }

        debugLightHint(src = null) {
            const hint = this.getLightHint(src);
            const runtimeState = window.state || window.ALIVE_BG_STATE;
            const currentBg = runtimeState?.currentBackground || null;
            debugLog(`[Alive BG] Light hint debug request (${src || 'current'})`, hint || {
                status: '(none)',
                currentBackground: currentBg,
                lightHintSceneKey: this.lightHintSceneKey,
                lightHintDepthSignature: this.lightHintDepthSignature,
                lastAnalysisKey: this.lastAnalysisKey,
                lastAnalysisAt: this.lastAnalysisAt,
                sceneBrightnessKey: this.sceneBrightnessKey,
                sceneLuma: this.roundForDebug(this.sceneLuma),
            });
            return hint;
        }

        updateDepthAlignment(depthTexture) {
            const sourceTexture = depthTexture || this.dummyDepth;
            this.depthAlignSprite.texture = sourceTexture;
            this.depthAlignSprite.rotation = 0;
            this.depthAlignSprite.skew.set(0, 0);

            const bgSprite = this.getPrimaryBackgroundSprite();
            if (bgSprite && Number.isFinite(bgSprite.width) && Number.isFinite(bgSprite.height)) {
                const sx = this.rtWidth / Math.max(1, pixiApp.LOGICAL_WIDTH);
                const sy = this.rtHeight / Math.max(1, pixiApp.LOGICAL_HEIGHT);

                const sourceAnchorX = Number.isFinite(bgSprite.anchor?.x) ? bgSprite.anchor.x : 0.5;
                const sourceAnchorY = Number.isFinite(bgSprite.anchor?.y) ? bgSprite.anchor.y : 0.5;
                const sourceX = Number.isFinite(bgSprite.x) ? bgSprite.x : (pixiApp.LOGICAL_WIDTH / 2);
                const sourceY = Number.isFinite(bgSprite.y) ? bgSprite.y : (pixiApp.LOGICAL_HEIGHT / 2);
                const sourceW = Number.isFinite(bgSprite.width) ? bgSprite.width : (pixiApp.LOGICAL_WIDTH * 1.1);
                const sourceH = Number.isFinite(bgSprite.height) ? bgSprite.height : (pixiApp.LOGICAL_HEIGHT * 1.1);

                this.depthAlignSprite.anchor.set(sourceAnchorX, sourceAnchorY);
                this.depthAlignSprite.position.set(sourceX * sx, sourceY * sy);

                let alignedW = sourceW * sx;
                let alignedH = sourceH * sy;
                if (Math.abs(alignedW) < 1) alignedW = alignedW < 0 ? -1 : 1;
                if (Math.abs(alignedH) < 1) alignedH = alignedH < 0 ? -1 : 1;

                this.depthAlignSprite.width = alignedW;
                this.depthAlignSprite.height = alignedH;
            } else {
                // Fallback when a live background sprite is not yet available.
                const texW = Math.max(1, sourceTexture.width || 1);
                const texH = Math.max(1, sourceTexture.height || 1);
                const targetWidth = this.rtWidth * 1.1;
                const targetHeight = this.rtHeight * 1.1;
                const targetAspect = targetWidth / targetHeight;
                const textureAspect = texW / texH;

                let drawW;
                let drawH;

                if (targetAspect > textureAspect) {
                    drawW = targetWidth;
                    drawH = targetWidth / textureAspect;
                } else {
                    drawH = targetHeight;
                    drawW = targetHeight * textureAspect;
                }

                this.depthAlignSprite.anchor.set(0.5, 0.5);
                this.depthAlignSprite.position.set(this.rtWidth / 2, this.rtHeight / 2);
                this.depthAlignSprite.width = Math.ceil(drawW);
                this.depthAlignSprite.height = Math.ceil(drawH);
            }

            pixiApp.app.renderer.render({
                container: this.depthAlignSprite,
                target: this.depthAlignedRT,
                clear: true,
            });
        }

        updateParallaxDepthTexture() {
            // Reproject aligned depth into a fullscreen RT that shares the same
            // logical geometry as the background snapshot/parallax pass.
            this.depthParallaxSprite.texture = this.depthAlignedRT;
            this.depthParallaxSprite.width = pixiApp.LOGICAL_WIDTH;
            this.depthParallaxSprite.height = pixiApp.LOGICAL_HEIGHT;

            pixiApp.app.renderer.render({
                container: this.depthParallaxSprite,
                target: this.depthParallaxRT,
                clear: true,
            });
        }

        onPreRender() {
            if (!this.active) return;
            this.syncEffectLayerOrder();

            if (this.bloomOverlay.blendMode !== this.nonDarkeningBlendMode) {
                this.bloomOverlay.blendMode = this.nonDarkeningBlendMode;
            }
            if (this.giOverlay.blendMode !== this.nonDarkeningBlendMode) {
                this.giOverlay.blendMode = this.nonDarkeningBlendMode;
            }

            const backgroundTexture = window.VN?.background.getSnapshot();
            if (!backgroundTexture) {
                this.syncParallaxSpriteFilters(false);
                this.depthDebugOverlay.visible = false;
                this.parallaxOverlay.visible = false;
                this.bloomOverlay.visible = false;
                this.giOverlay.visible = false;
                return;
            }

            const runtimeState = window.state || window.ALIVE_BG_STATE;
            const currentBg =
                (window.__ALIVE_BG?.getActiveBackgroundSource && window.__ALIVE_BG.getActiveBackgroundSource()) ||
                (window.__ALIVE_BG?.getLatestBackgroundSource && window.__ALIVE_BG.getLatestBackgroundSource()) ||
                runtimeState?.currentBackground ||
                null;
            const settings = this.getSettings();
            const showDepthDebug = settings.show_depth_debug === true;
            const now = performance.now() / 1000;
            const sceneKey = currentBg || `snapshot:${backgroundTexture.uid || 'unknown'}`;
            const isVideoBackground = this.isVideoSource(currentBg || '');

            // Video backgrounds can still get one-frame depth analysis, but the
            // expensive live overlay effects remain paused until a static image returns.
            if (isVideoBackground) {
                if (!this.wasPausedForVideo) {
                    debugLog(`[Alive BG] Pausing pipeline for video background: ${currentBg || '(unknown video)'}`);
                }
                this.wasPausedForVideo = true;
                this.syncParallaxSpriteFilters(false);
                this.passSprite.filters = null;
                this.depthDebugOverlay.visible = false;
                this.parallaxOverlay.visible = false;
                this.bloomOverlay.visible = false;
                this.giOverlay.visible = false;
                return;
            }

            if (this.wasPausedForVideo) {
                debugLog('[Alive BG] Resuming pipeline (static image background detected).');
                this.wasPausedForVideo = false;
            }

            const currentDepthTexture =
                (currentBg && window.__ALIVE_BG?.getDepthTexture(currentBg)) ||
                null;
            const resolvedDepthTexture =
                currentDepthTexture ||
                (window.__ALIVE_BG?.getLastDepthTexture && window.__ALIVE_BG.getLastDepthTexture()) ||
                null;
            const lightDepthSignature = currentDepthTexture ? `depth:${currentDepthTexture.uid || currentDepthTexture._updateID || 'live'}` : 'none';
            const hasRealDepthForParallax = !!currentDepthTexture;
            const shouldProcessSceneFrame = this.shouldRenderStaticSceneFrame(sceneKey, lightDepthSignature, now, showDepthDebug);

            if (!shouldProcessSceneFrame) {
                // Keep expensive scene processing throttled, but still update cursor parallax every frame
                // so pointer motion is smooth at the configured global FPS cap.
                this.updateParallax(
                    now,
                    backgroundTexture,
                    this.depthParallaxRT,
                    hasRealDepthForParallax,
                    settings,
                    showDepthDebug
                );
                this.depthDebugOverlay.visible = false;
                return;
            }

            const depthTexture = resolvedDepthTexture || this.dummyDepth;
            this.updateDepthAlignment(depthTexture);
            this.updateParallaxDepthTexture();
            const depthSource = this.depthAlignedRT;
            const parallaxDepthSource = this.depthParallaxRT;

            const shouldUpdateBrightness = this.shouldResampleSceneBrightness(sceneKey, now);
            const shouldUpdateLightHint = this.shouldResampleLightHint(sceneKey, lightDepthSignature, now);
            const shouldUpdateParallaxStats = this.shouldResampleParallaxDepthStats(sceneKey, lightDepthSignature, now);
            let analysisPixels = null;

            if (shouldUpdateParallaxStats && currentDepthTexture) {
                this.updateParallaxDepthStats(sceneKey, lightDepthSignature, now);
            } else if (shouldUpdateParallaxStats && !currentDepthTexture) {
                this.parallaxDepthStats = null;
                this.parallaxDepthStatsSceneKey = sceneKey;
                this.parallaxDepthStatsSignature = lightDepthSignature;
                this.parallaxDepthStatsSampleAt = now;
            }

            this.updateParallax(
                now,
                backgroundTexture,
                parallaxDepthSource,
                hasRealDepthForParallax,
                settings,
                showDepthDebug
            );

            if (shouldUpdateBrightness || shouldUpdateLightHint) {
                analysisPixels = this.renderSceneAnalysisPixels(sceneKey, backgroundTexture, now);
            }
            if (shouldUpdateBrightness && analysisPixels) {
                this.updateSceneBrightnessFromPixels(sceneKey, analysisPixels, now);
            }
            if (shouldUpdateLightHint) {
                const hintPixels = analysisPixels || ((this.lastAnalysisKey === sceneKey) ? this.lastAnalysisPixels : null);
                if (hintPixels) {
                    this.updateLightHintFromPixels(sceneKey, hintPixels, currentDepthTexture, now, currentBg || sceneKey);
                } else {
                    this.lightHint = null;
                    this.lightHintSceneKey = sceneKey;
                    this.lightHintSampleAt = now;
                    this.lightHintDepthSignature = lightDepthSignature;
                    this.logLightHintDebug(sceneKey, 'analysis-failed (no-hint-pixels-after-resample)');
                }
            }

            this.markStaticSceneFrame(sceneKey, lightDepthSignature, now);

            const brightnessSuppression = this.smoothstep(0.58, 0.80, this.sceneLuma);
            const sceneDimming = Math.max(0.0, 1.0 - brightnessSuppression);
            const sceneDarkness = Math.max(0.0, 1.0 - this.sceneLuma);
            const strongAttenuation = sceneDimming < 0.12;

            if (strongAttenuation !== this.lastAdaptiveDisable) {
                this.lastAdaptiveDisable = strongAttenuation;
                debugLog(
                    strongAttenuation
                        ? `[Alive BG] Adaptive lighting heavily attenuated for bright scene (avgLuma=${this.sceneLuma.toFixed(3)}).`
                        : `[Alive BG] Adaptive lighting normalized (avgLuma=${this.sceneLuma.toFixed(3)}).`
                );
            }

            const enableBloom = settings.enable_depth_bloom !== false;
            const enableGi = settings.enable_color_bleed !== false;

            if (showDepthDebug) {
                this.depthDebugOverlay.texture = this.depthAlignedRT;
                this.depthDebugOverlay.visible = true;
                this.parallaxOverlay.visible = false;
                this.bloomOverlay.visible = false;
                this.giOverlay.visible = false;
                return;
            }

            this.depthDebugOverlay.visible = false;

            this.passSprite.texture = backgroundTexture;
            this.passSprite.width = this.rtWidth;
            this.passSprite.height = this.rtHeight;

            const time = now;
            const baseFlickerStrength = (settings.enable_flicker === false) ? 0.0 : (settings.flicker_strength ?? 0.05);
            const flickerStrength = baseFlickerStrength > 0.0 ? Math.max(0.10, baseFlickerStrength) : 0.0;

            if (enableBloom) {
                const baseBloomIntensity = settings.bloom_intensity ?? 0.6;
                const adaptiveBloomScale = Math.max(
                    0.05,
                    sceneDimming * (0.82 + (sceneDarkness * 1.05))
                );
                const adaptiveBloomIntensity = baseBloomIntensity * adaptiveBloomScale;

                if (adaptiveBloomIntensity <= 0.01) {
                    this.bloomOverlay.alpha = 1.0;
                    this.bloomOverlay.visible = false;
                } else {
                    const uniforms = this.bloomFilter.resources.aliveBloomUniforms.uniforms;
                    uniforms.uThreshold = (settings.bloom_threshold ?? 0.65) + (brightnessSuppression * 0.10);
                    uniforms.uKnee = 0.22;
                    uniforms.uIntensity = adaptiveBloomIntensity;
                    uniforms.uWarmthBias = settings.warmth_bias ?? 0.5;
                    uniforms.uFlickerStrength = flickerStrength * 1.15;
                    uniforms.uResolutionX = this.rtWidth;
                    uniforms.uResolutionY = this.rtHeight;
                    uniforms.uFlickerTime = time;
                    uniforms.uSceneDimming = Math.max(0.08, sceneDimming);

                    this.bloomFilter.resources.uDepthMap = depthSource.source || depthSource;
                    this.passSprite.filters = [this.bloomFilter];

                    pixiApp.app.renderer.render({
                        container: this.passSprite,
                        target: this.bloomRT,
                        clear: true,
                    });

                    this.passSprite.filters = null;
                    if (flickerStrength > 0.0) {
                        const wave = (
                            Math.sin(time * 2.3) +
                            Math.sin(time * 5.9) * 0.52 +
                            Math.sin(time * 11.8) * 0.26
                        ) / 1.78;
                        const amplitude = Math.min(0.26, Math.max(0.12, flickerStrength * 2.05));
                        const alpha = 0.9 + wave * amplitude;
                        const intensityAlpha = Math.max(0.10, Math.min(0.34, adaptiveBloomScale * 0.62));
                        this.bloomOverlay.alpha = Math.max(0.05, Math.min(0.36, alpha * intensityAlpha));
                    } else {
                        this.bloomOverlay.alpha = Math.max(0.05, Math.min(0.32, adaptiveBloomScale * 0.85));
                    }
                    this.bloomOverlay.visible = true;
                }
            } else {
                this.bloomOverlay.alpha = 1.0;
                this.bloomOverlay.visible = false;
            }

            if (enableGi) {
                const baseRadius = settings.gi_radius ?? 6;
                const baseGiIntensity = settings.gi_intensity ?? 0.2;
                const adaptiveRadius = baseRadius * (0.90 + (sceneDarkness * 1.25));
                const adaptiveGiIntensity = baseGiIntensity * Math.max(0.16, sceneDimming * (0.95 + (sceneDarkness * 2.15)));

                if (adaptiveGiIntensity <= 0.01) {
                    this.giOverlay.alpha = 1.0;
                    this.giOverlay.visible = false;
                } else {
                    const uniforms = this.giFilter.resources.aliveGiUniforms.uniforms;
                    uniforms.uRadius = adaptiveRadius;
                    uniforms.uIntensity = Math.min(2.0, adaptiveGiIntensity);
                    uniforms.uResolutionX = this.rtWidth;
                    uniforms.uResolutionY = this.rtHeight;
                    uniforms.uTime = time;
                    uniforms.uSceneDarkness = sceneDarkness;

                    this.giFilter.resources.uDepthMap = depthSource.source || depthSource;
                    this.passSprite.filters = [this.giFilter];

                    pixiApp.app.renderer.render({
                        container: this.passSprite,
                        target: this.giRT,
                        clear: true,
                    });

                    this.passSprite.filters = null;
                    this.giOverlay.alpha = Math.max(0.14, Math.min(0.95, adaptiveGiIntensity * 1.18));
                    this.giOverlay.visible = true;
                }
            } else {
                this.giOverlay.alpha = 1.0;
                this.giOverlay.visible = false;
            }
        }

        updateSettings(_newSettings) {
            // Settings are read every frame from window.ALIVE_BG_SETTINGS.
        }

        destroy() {
            this.active = false;
            this.syncParallaxSpriteFilters(false);
            this.unbindParallaxPointerInput();
            if (this.depthDebugOverlay?.parent) this.depthDebugOverlay.parent.removeChild(this.depthDebugOverlay);
            if (this.parallaxOverlay?.parent) this.parallaxOverlay.parent.removeChild(this.parallaxOverlay);
            if (this.bloomOverlay?.parent) this.bloomOverlay.parent.removeChild(this.bloomOverlay);
            if (this.giOverlay?.parent) this.giOverlay.parent.removeChild(this.giOverlay);
            if (this.effectLayerOwned && this.effectLayer?.parent) this.effectLayer.parent.removeChild(this.effectLayer);
            if (pixiApp.layers?.aliveBgUnderlay === this.effectLayer) {
                delete pixiApp.layers.aliveBgUnderlay;
            }
            if (this.preRenderHook) pixiApp.hooks.remove(this.preRenderHook);

            this.bloomRT.destroy(true);
            this.giRT.destroy(true);
            this.parallaxRT.destroy(true);
            this.depthAlignedRT.destroy(true);
            this.depthParallaxRT.destroy(true);
            this.analysisRT.destroy(true);
            this.analysisDepthRT.destroy(true);
            if (this.parallaxFilter?.destroy) {
                this.parallaxFilter.destroy();
            }
        }
    }

    window.__ALIVE_PIPELINE = {
        init() {
            if (pipeline) return;
            pipeline = new AlivePipeline();
        },
        update(s) {
            if (pipeline) pipeline.updateSettings(s);
        },
        getLightHint(src = null) {
            return pipeline?.getLightHint(src) || null;
        },
        async computeLightHintFromImageUrl(sceneKey, imageUrl, sourceId = null) {
            return pipeline?.computeLightHintFromImageUrl(sceneKey, imageUrl, sourceId) || null;
        },
        debugLightHint(src = null) {
            return pipeline?.debugLightHint(src) || null;
        },
    };

})(context);

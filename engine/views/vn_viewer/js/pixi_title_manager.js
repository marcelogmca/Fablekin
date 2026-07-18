import { pixiApp } from './pixi_engine.js';
import { debugLog, debugError } from './utils.js';

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

/**
 * Handles ultra-versatile stylized "Title Popouts" using PixiJS and GSAP.
 * Supports deep configuration for fonts, colors, animations, and advanced WebGL effects.
 */
export const pixiTitleManager = {
    activeTitles: [],
    loadedFonts: new Set(),
    noiseTexture: null,
    initialized: false,
    _titleEventHandler: null,
    _titleTickerHandler: null,

    _disposeTitle(container, reason = 'dispose') {
        if (!container || container.__vnTitleDisposed) return false;
        container.__vnTitleDisposed = true;

        if (container.__vnTitleTimeoutId !== undefined && container.__vnTitleTimeoutId !== null) {
            clearTimeout(container.__vnTitleTimeoutId);
            container.__vnTitleTimeoutId = null;
        }

        if (reason !== 'complete' && container.__vnTitleTimeline) {
            try { container.__vnTitleTimeline.kill(); } catch (_) { }
        }

        const cleanupTargets = Array.isArray(container.__vnTitleCleanupTargets)
            ? container.__vnTitleCleanupTargets
            : [];
        for (const target of cleanupTargets) {
            try { gsap.killTweensOf(target); } catch (_) { }
        }

        killTweensDeep(container);
        try {
            if (container.parent) container.parent.removeChild(container);
        } catch (_) { }
        try {
            if (!container.destroyed) container.destroy({ children: true });
        } catch (_) { }

        this.activeTitles = this.activeTitles.filter(t => t !== container);
        debugLog(`[PixiTitleManager] Disposed title ${container.label || ''} (${reason}).`);
        return true;
    },

    /**
     * Internal helper to create a noise texture for displacement effects.
     */
    getNoiseTexture() {
        if (this.noiseTexture) return this.noiseTexture;
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(size, size);
        for (let i = 0; i < imgData.data.length; i += 4) {
            const val = Math.floor(Math.random() * 255);
            imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = val;
            imgData.data[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        this.noiseTexture = PIXI.Texture.from(canvas);
        return this.noiseTexture;
    },

    /**
     * Loads a custom font from the project directory.
     * @param {string} fontFamily Name to use for the font.
     * @param {string} url Path to the .ttf/.woff file.
     */
    async loadFont(fontFamily, url) {
        if (this.loadedFonts.has(fontFamily)) return;
        try {
            const font = new FontFace(fontFamily, `url(${url})`);
            await font.load();
            document.fonts.add(font);
            this.loadedFonts.add(fontFamily);
            debugLog(`[PixiTitleManager] Font loaded: ${fontFamily} from ${url}`);
        } catch (e) {
            debugError(`[PixiTitleManager] Failed to load font ${fontFamily}:`, e);
        }
    },

    /**
     * Shows a highly customized title with optional WebGL effects.
     */
    async showTitle(config) {
        const {
            text = '',
            subtext = '',
            locationText = '',
            timeText = '',
            fontPath = null, // Optional .ttf path
            style = {},
            subStyle = {},
            locationStyle = {},
            timeStyle = {},
            anim = {},
            pos = {},
            effects = {}
        } = config;

        // --- Core Chapter Intro Preset Overrides ---
        if (config.preset === 'chapter_intro') {
            debugLog('[PixiTitleManager] Preset Triggered: chapter_intro', config);
            const defaults = {
                text: config.text || '',
                subtext: config.subtext || '',
                style: {
                    fontFamily: 'Noto Serif, Georgia, serif',
                    fontSize: 90,
                    fontWeight: '700',
                    letterSpacing: 8,
                    fill: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 2,
                    dropShadow: { alpha: 0.8, blur: 4, color: '#000000', distance: 6 }
                },
                subStyle: {
                    fontFamily: 'Noto Serif, Georgia, serif',
                    fontSize: 45,
                    fontWeight: '400',
                    fontStyle: 'italic',
                    letterSpacing: 4,
                    fill: '#cccccc'
                },
                anim: { in: 'top', out: 'bottom', hold: 5000, distance: 150 },
                pos: { x: 0.5, y: 0.4, align: 'center' },
                effects: { typewriter: true }
            };

            // Merge user overrides into defaults
            const finalConfig = {
                ...defaults,
                ...config,
                style: { ...defaults.style, ...(config.style || {}) },
                subStyle: { ...defaults.subStyle, ...(config.subStyle || {}) },
                anim: { ...defaults.anim, ...(config.anim || {}) },
                preset: null // Clear preset to prevent recursion
            };

            // Core Dimming Logic (No Plugins)
            if (pixiApp.layers.background) gsap.to(pixiApp.layers.background, { alpha: 0.4, duration: 1.5, ease: "power2.inOut" });
            if (pixiApp.layers.characters) gsap.to(pixiApp.layers.characters, { alpha: 0.4, duration: 1.5, ease: "power2.inOut" });

            return this.showTitle(finalConfig);
        }

        debugLog('[PixiTitleManager] Executing showTitle for:', text);

        if (!pixiApp.layers.titles) {
            debugError('[PixiTitleManager] Titles layer not initialized');
            return;
        }

        // Load custom font if requested
        if (fontPath && style.fontFamily) {
            await this.loadFont(style.fontFamily, fontPath);
        }

        const container = new PIXI.Container();
        container.label = `TitlePopout_${text.substring(0, 10)}`;
        container.alpha = 0;
        pixiApp.layers.titles.addChild(container);
        debugLog('[PixiTitleManager] Container added to titles layer.', container.label);

        // --- 1. STYLING ---
        const createStyle = (overrides, isSub = false) => {
            return new PIXI.TextStyle({
                fontFamily: 'Noto Sans',
                fontSize: isSub ? 40 : 80,
                fontWeight: isSub ? '400' : '900',
                fill: '#ffffff',
                fontStyle: isSub ? 'italic' : 'normal',
                letterSpacing: isSub ? 2 : 4,
                padding: 40, // More padding for filters/glow
                stroke: '#000000',
                strokeThickness: 0,
                wordWrap: true,
                wordWrapWidth: pixiApp.LOGICAL_WIDTH * 0.8,
                align: pos.align || 'left',
                dropShadow: {
                    alpha: 0.5,
                    blur: 0,
                    color: '#000000',
                    distance: 4,
                },
                ...overrides
            });
        };

        const titleText = new PIXI.Text({
            text: text,
            style: createStyle(style),
            resolution: (window.devicePixelRatio || 1) * 3
        });
        titleText.roundPixels = true;
        container.addChild(titleText);

        let supportingTextY = titleText.height - 20;
        const addSupportingText = (content, textStyle) => {
            if (!content) return null;
            const supportingText = new PIXI.Text({
                text: content,
                style: createStyle(textStyle, true),
                resolution: (window.devicePixelRatio || 1) * 3
            });
            supportingText.roundPixels = true;
            supportingText.y = supportingTextY;
            supportingText.x = (pos.align === 'center') ? (titleText.width - supportingText.width) / 2 : 5;
            supportingTextY += Math.max(24, supportingText.height - 18);
            container.addChild(supportingText);
            return supportingText;
        };

        if (subtext) {
            const subtitleText = new PIXI.Text({
                text: subtext,
                style: createStyle(subStyle, true),
                resolution: (window.devicePixelRatio || 1) * 3
            });
            subtitleText.roundPixels = true;
            subtitleText.y = supportingTextY;
            subtitleText.x = (pos.align === 'center') ? (titleText.width - subtitleText.width) / 2 : 5;
            container.addChild(subtitleText);
            supportingTextY += Math.max(24, subtitleText.height - 18);

            if (config.showLine !== false) {
                const line = new PIXI.Graphics();
                line.beginFill(style.fill || '#ffffff', 0.5);
                const lineWidth = Math.max(titleText.width, subtitleText.width) * 0.4;
                const lineX = (pos.align === 'center') ? (titleText.width - lineWidth) / 2 : 0;
                line.drawRect(lineX, titleText.height - 10, lineWidth, 2);
                line.endFill();
                container.addChild(line);
            }
        }

        addSupportingText(locationText, {
            fill: '#ffd866',
            fontSize: 34,
            fontStyle: 'normal',
            fontWeight: '700',
            ...locationStyle
        });
        addSupportingText(timeText, {
            fill: '#f1e3ae',
            fontSize: 27,
            fontStyle: 'normal',
            fontWeight: '600',
            ...timeStyle
        });

        // --- 2. POSITIONING ---
        let finalX = pos.x ?? 0.1;
        if (finalX <= 1.0) finalX *= pixiApp.LOGICAL_WIDTH;

        let finalY = pos.y;
        if (finalY === null || finalY === undefined) {
            finalY = (pixiApp.LOGICAL_HEIGHT / 2 - (container.height / 2) - 100);
        } else if (finalY <= 1.0) {
            finalY *= pixiApp.LOGICAL_HEIGHT;
        }

        if (pos.align === 'center') container.pivot.x = container.width / 2;
        else if (pos.align === 'right') container.pivot.x = container.width;

        container.position.set(finalX, finalY);
        debugLog(`[PixiTitleManager] Positioning: x=${finalX}, y=${finalY}, align=${pos.align}`);

        // --- 3. ADVANCED WEBGL EFFECTS ---
        const activeFilters = [];
        const cleanupTargets = [];
        const tl = gsap.timeline({
            onComplete: () => {
                const disposed = this._disposeTitle(container, 'complete');
                if (disposed && this.activeTitles.length === 0) {
                    debugLog('[PixiTitleManager] All titles cleared, restoring layer alpha.');
                    this.restoreLayers();
                }
            }
        });
        container.__vnTitleTimeline = tl;
        container.__vnTitleCleanupTargets = cleanupTargets;

        // Effect: Glitch
        if (effects.type === 'glitch') {
            const glitch = new PIXI.filters.GlitchFilter({
                slices: effects.slices || 5,
                offset: effects.offset || 10,
                fillMode: 2
            });
            activeFilters.push(glitch);
            cleanupTargets.push(glitch);
            // Independent loop (don't add to timeline 'tl' to avoid Infinity duration)
            gsap.to(glitch, {
                seed: 1,
                duration: 0.2,
                repeat: -1,
                repeatRefresh: true,
                ease: "none"
            });
        }

        // Effect: Magic / Shimmer
        if (effects.type === 'magic') {
            const glow = new PIXI.filters.GlowFilter({
                distance: 15,
                outerStrength: 2,
                innerStrength: 0,
                color: effects.color || 0xFFFFFF,
                quality: 0.5
            });
            activeFilters.push(glow);
            cleanupTargets.push(glow);
            // Independent loop
            gsap.to(glow, {
                outerStrength: 6,
                duration: 1.5,
                repeat: -1,
                yoyo: true,
                ease: "sine.inOut"
            });
        }

        // Effect: Fire / Burning (Distortion + Glow)
        if (effects.type === 'fire') {
            const noise = this.getNoiseTexture();
            const displacementSprite = new PIXI.Sprite(noise);
            displacementSprite.texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
            const displacementFilter = new PIXI.DisplacementFilter({ sprite: displacementSprite, scale: 8 });
            cleanupTargets.push(displacementSprite);

            const fireGlow = new PIXI.filters.GlowFilter({
                distance: 20,
                outerStrength: 4,
                color: 0xFF4400,
                quality: 0.5
            });

            activeFilters.push(fireGlow, displacementFilter);
            cleanupTargets.push(fireGlow);

            // Animate displacement for "heat wave" look (Independent)
            gsap.to(displacementSprite, {
                x: 256,
                y: 256,
                duration: 1.2,
                repeat: -1,
                ease: "none"
            });

            // Flicker Glow (Slower, smoother) (Independent)
            gsap.to(fireGlow, {
                outerStrength: 6,
                duration: 0.6,
                repeat: -1,
                yoyo: true,
                ease: "sine.inOut"
            });

            // Jitter position (Subtler) (Independent)
            gsap.to(container, {
                x: "+=1",
                y: "+=1",
                duration: 0.1,
                repeat: -1,
                yoyo: true,
                ease: "none"
            });
        }

        // Effect: Ghost
        if (effects.type === 'ghost') {
            if (effects.blur) {
                const blur = new PIXI.BlurFilter({ strength: effects.blur, quality: 3 });
                activeFilters.push(blur);
                cleanupTargets.push(blur);
            }
            // Independent loop
            gsap.to(container, {
                alpha: 0.8,
                duration: 1.2,
                repeat: -1,
                yoyo: true,
                ease: "sine.inOut"
            });
        }

        container.filters = activeFilters.length > 0 ? activeFilters : (container.filters || null);

        // --- 4. CORE ANIMATION ---
        this.activeTitles.push(container);
        const inType = anim.in || 'left';
        const outType = anim.out || 'right';
        const holdTime = (anim.hold || 3000) / 1000;

        // Cleanup: If the timeline hangs or takes too long, force restore the layers
        const emergencyTimeout = (holdTime + 5) * 1000;
        container.__vnTitleTimeoutId = setTimeout(() => {
            if (!container.__vnTitleDisposed && this.activeTitles.includes(container)) {
                debugError(`[PixiTitleManager] Title ${text} timed out. Forcing restoration.`);
                tl.progress(1); // Jump to end to trigger onComplete
            }
        }, emergencyTimeout);
        const moveDist = anim.distance || 100;

        const getOff = (type) => {
            if (type === 'left') return { x: -moveDist, y: 0 };
            if (type === 'right') return { x: moveDist, y: 0 };
            if (type === 'top') return { x: 0, y: -moveDist };
            if (type === 'bottom') return { x: 0, y: moveDist };
            return { x: 0, y: 0 };
        };

        const inO = getOff(inType);
        const outO = getOff(outType);

        tl.fromTo(container,
            { x: finalX + inO.x, y: finalY + inO.y, alpha: 0 },
            { x: finalX, y: finalY, alpha: 1, duration: 1.2, ease: "elastic.out(0.5, 0.8)" },
            0 // Start at same time as filters
        );

        if (effects.typewriter) {
            const fullText = text;
            titleText.text = '';
            const typeObj = { progress: 0 };
            cleanupTargets.push(typeObj);
            tl.to(typeObj, {
                progress: 1.0,
                duration: 1.0,
                onUpdate: () => {
                    const charCount = Math.floor(typeObj.progress * fullText.length);
                    titleText.text = fullText.substring(0, charCount);
                },
                onComplete: () => {
                    debugLog('[PixiTitleManager] Typewriter finished for:', fullText);
                }
            }, 0.5);
        }

        tl.to(container, {
            x: finalX + (outO.x * 0.1), y: finalY + (outO.y * 0.1),
            duration: holdTime, ease: "none"
        });

        tl.to(container, {
            x: finalX + outO.x, y: finalY + outO.y, alpha: 0,
            duration: 1.0, ease: "power4.in"
        });

        debugLog(`[PixiTitleManager] Showing Advanced Title: ${text}`);
    },

    /**
     * Forcefully restores the alpha of all key layers.
     */
    restoreLayers() {
        if (pixiApp.layers.background) gsap.to(pixiApp.layers.background, { alpha: 1.0, duration: 1.0, ease: "power2.out", overwrite: true });
        if (pixiApp.layers.characters) gsap.to(pixiApp.layers.characters, { alpha: 1.0, duration: 1.0, ease: "power2.out", overwrite: true });
    },

    /**
     * Immediately removes all active title containers and restores layers.
     */
    clearAll() {
        debugLog(`[PixiTitleManager] clearAll requested. Active: ${this.activeTitles.length}`);
        
        [...this.activeTitles].forEach(container => {
            this._disposeTitle(container, 'clearAll');
        });
        
        this.activeTitles = [];
        this.restoreLayers();
    },

    init() {
        if (this.initialized) return;

        // Register GSAP PixiPlugin if available
        if (window.gsap && window.PIXI && window.PixiPlugin) {
            gsap.registerPlugin(PixiPlugin);
            PixiPlugin.registerPIXI(PIXI);
        }

        this._titleEventHandler = (e) => {
            this.showTitle(e.detail);
        };
        window.addEventListener('vn:title-popout', this._titleEventHandler);

        // Inverse Camera Transform Loop (Fixed-size logic)
        this._titleTickerHandler = () => {
            if (pixiApp.layers.titles && pixiApp.world) {
                const world = pixiApp.world;
                const titles = pixiApp.layers.titles;
                const invScale = 1 / world.scale.x;
                titles.scale.set(invScale);
                titles.x = world.pivot.x - (pixiApp.LOGICAL_WIDTH / 2) * invScale;
                titles.y = world.pivot.y - (pixiApp.LOGICAL_HEIGHT / 2) * invScale;
            }
        };
        pixiApp.app.ticker.add(this._titleTickerHandler);

        this.initialized = true;
        debugLog('[PixiTitleManager] Advanced Title System Ready');
    }
};

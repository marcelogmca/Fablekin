/* global SHADER_VERT, SHADER_INTRO_RAYMARCH_FRACTAL, SHADER_INTRO_OCTAGRAMS, SHADER_INTRO_FRACTAL_PYRAMID, SHADER_INTRO_SHADER_ART, SHADER_INTRO_PROTEAN_CLOUDS, SHADER_INTRO_STAR_NEST, SHADER_INTRO_MONSTER, SHADER_INTRO_TUNNEL_RUNNER, SHADER_INTRO_PALACE_OF_MIND, SHADER_INTRO_BLUE_002, SHADER_INTRO_ETHER, SHADER_INTRO_ZIPPY_ZAPS, SHADER_INTRO_BIOMINE, SHADER_INTRO_BAL_KHAN_TUNNEL, SHADER_INTRO_WARP_SPEED, SHADER_INTRO_GILDED_KALEIDOSCOPE, SHADER_INTRO_TOPOLOGICA, SHADER_INTRO_TRANSPARENT_CUBE_FIELD */

// vfx-intro.js
// Intro-only VFX controller scaffold. The intro bucket is intentionally separate
// from normal VN cinematography so future opening effects cannot leak into scene prompts.

(function () {
    const INTRO_EFFECTS = new Map();
    let introApi = null;

    function normalizeEffectId(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/_/g, '-')
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function registerEffect(id, factory) {
        const normalized = normalizeEffectId(id);
        if (!normalized || !normalized.startsWith('intro-') || typeof factory !== 'function') {
            return false;
        }
        INTRO_EFFECTS.set(normalized, factory);
        if (introApi) introApi.INTRO_EFFECT_IDS = Array.from(INTRO_EFFECTS.keys());
        return true;
    }

    function normalizePaletteColor(color) {
        const rgb = Array.isArray(color?.rgb) ? color.rgb : [];
        if (rgb.length < 3) return null;
        const values = rgb.slice(0, 3).map(value => {
            const number = Number(value);
            if (!Number.isFinite(number)) return 0;
            return Math.max(0, Math.min(1, number > 1 ? number / 255 : number));
        });
        return values;
    }

    function normalizeShaderPalette(shaderPalette) {
        const colors = Array.isArray(shaderPalette?.colors)
            ? shaderPalette.colors.map(normalizePaletteColor).filter(Boolean).slice(0, 5)
            : [];
        return {
            source: shaderPalette?.source || '',
            path: shaderPalette?.path || '',
            colors,
            strength: colors.length > 0 ? 0.9 : 0
        };
    }

    function createPaletteUniforms(shaderPalette) {
        const palette = normalizeShaderPalette(shaderPalette);
        const uniforms = {
            uPaletteCount: { value: palette.colors.length, type: 'f32' },
            uPaletteStrength: { value: palette.strength, type: 'f32' },
        };
        for (let index = 0; index < 5; index += 1) {
            const color = palette.colors[index] || [0, 0, 0];
            uniforms[`uPalette${index}R`] = { value: color[0], type: 'f32' };
            uniforms[`uPalette${index}G`] = { value: color[1], type: 'f32' };
            uniforms[`uPalette${index}B`] = { value: color[2], type: 'f32' };
        }
        return { uniforms, palette };
    }

    const INTRO_SHADER_PALETTE_HEADER = `
uniform float uPaletteCount;
uniform float uPaletteStrength;
uniform float uPalette0R;
uniform float uPalette0G;
uniform float uPalette0B;
uniform float uPalette1R;
uniform float uPalette1G;
uniform float uPalette1B;
uniform float uPalette2R;
uniform float uPalette2G;
uniform float uPalette2B;
uniform float uPalette3R;
uniform float uPalette3G;
uniform float uPalette3B;
uniform float uPalette4R;
uniform float uPalette4G;
uniform float uPalette4B;

vec3 arcPaletteColor(float index, vec3 fallbackColor) {
    if (uPaletteCount < 1.0) return fallbackColor;
    if (index < 0.5 && uPaletteCount >= 1.0) return vec3(uPalette0R, uPalette0G, uPalette0B);
    if (index < 1.5 && uPaletteCount >= 2.0) return vec3(uPalette1R, uPalette1G, uPalette1B);
    if (index < 2.5 && uPaletteCount >= 3.0) return vec3(uPalette2R, uPalette2G, uPalette2B);
    if (index < 3.5 && uPaletteCount >= 4.0) return vec3(uPalette3R, uPalette3G, uPalette3B);
    if (index < 4.5 && uPaletteCount >= 5.0) return vec3(uPalette4R, uPalette4G, uPalette4B);
    return fallbackColor;
}

vec3 arcApplyPalette(vec3 originalColor) {
    float strength = clamp(uPaletteStrength, 0.0, 1.0);
    if (uPaletteCount < 1.0 || strength <= 0.0) return originalColor;
    float luminance = dot(originalColor, vec3(0.299, 0.587, 0.114));
    float brightness = max(max(originalColor.r, originalColor.g), originalColor.b);
    vec3 primary = arcPaletteColor(0.0, originalColor);
    vec3 secondary = arcPaletteColor(1.0, primary);
    vec3 accent = arcPaletteColor(2.0, secondary);
    vec3 shadow = arcPaletteColor(3.0, primary) * 0.7;
    vec3 highlight = arcPaletteColor(4.0, primary);
    vec3 tonal = mix(shadow, highlight, smoothstep(0.05, 0.9, luminance));
    tonal = mix(tonal, mix(primary, secondary, 0.50), 0.76);
    tonal = mix(tonal, accent, smoothstep(0.42, 1.1, brightness) * 0.48);
    tonal *= max(0.18, brightness * 1.15);
    float tonalGray = dot(tonal, vec3(0.299, 0.587, 0.114));
    tonal = mix(vec3(tonalGray), tonal, 1.24);
    float tonalBrightness = max(max(tonal.r, tonal.g), tonal.b);
    if (tonalBrightness > 0.001) {
        tonal *= max(brightness, 0.36) / tonalBrightness;
    }
    tonal = clamp(tonal, 0.0, 1.55);
    return mix(originalColor, tonal, strength);
}
`;

    function prepareIntroShader(shader) {
        let prepared = String(shader || '');
        if (!prepared.includes('uPaletteCount')) {
            prepared = prepared.replace('uniform float uOpacity;', `uniform float uOpacity;\n${INTRO_SHADER_PALETTE_HEADER}`);
        }
        const replacements = [
            ['gl_FragColor = vec4(col * alpha, alpha);', 'gl_FragColor = vec4(arcApplyPalette(col) * alpha, alpha);'],
            ['gl_FragColor = vec4(color * alpha, alpha);', 'gl_FragColor = vec4(arcApplyPalette(color) * alpha, alpha);'],
            ['gl_FragColor = vec4(finalCol * alpha, alpha);', 'gl_FragColor = vec4(arcApplyPalette(finalCol) * alpha, alpha);'],
            ['gl_FragColor = vec4(col.rgb * alpha, alpha);', 'gl_FragColor = vec4(arcApplyPalette(col.rgb) * alpha, alpha);'],
            ['gl_FragColor = vec4(accumColor * alpha, alpha);', 'gl_FragColor = vec4(arcApplyPalette(accumColor) * alpha, alpha);']
        ];
        for (const [from, to] of replacements) {
            prepared = prepared.split(from).join(to);
        }
        return prepared;
    }

    function smoothWindowEdge(edge0, edge1, value) {
        const denominator = Math.max(0.0001, edge1 - edge0);
        const t = Math.max(0, Math.min(1, (value - edge0) / denominator));
        return t * t * (3 - (2 * t));
    }

    function getClearImageWindowMultiplier(stanzaProgress = 0, backgroundVisibility = 0) {
        const bgVisibility = Math.max(0, Math.min(1, Number(backgroundVisibility) || 0));
        if (bgVisibility < 0.92) return 1;
        const progress = Math.max(0, Math.min(1, Number(stanzaProgress) || 0));
        const fadeOut = smoothWindowEdge(0.40, 0.49, progress);
        const fadeIn = smoothWindowEdge(0.64, 0.75, progress);
        const clearAmount = Math.max(0, Math.min(1, fadeOut * (1 - fadeIn)));
        return 1 - clearAmount;
    }

    function createController({
        PIXI,
        root,
        app,
        logicalWidth = 1280,
        logicalHeight = 720,
        debugLog = () => {},
    } = {}) {
        if (!PIXI || !root || !app) {
            return null;
        }

        const effectRoot = new PIXI.Container();
        effectRoot.label = 'Intro_VFX_Root';
        effectRoot.sortableChildren = true;
        effectRoot.zIndex = 12;
        root.addChild(effectRoot);

        const state = {
            activeId: 'none',
            activeInstance: null,
            targets: {}
        };

        function clear(id = state.activeId) {
            const normalized = normalizeEffectId(id);
            if (!normalized || normalized === 'none') return;
            debugLog('[vn_pixijs_vfx:intro] clear', { id: normalized, activeId: state.activeId });
            if (state.activeInstance && (normalized === state.activeId || normalized === 'all')) {
                try { state.activeInstance.destroy?.(); } catch { }
                state.activeInstance = null;
                state.activeId = 'none';
            }
        }

        function activate({
            id,
            intensity = 'subtle',
            stanzaIndex = 0,
            stanzaDurationMs = 1000,
            shaderPalette = null,
            softenOverImage = false,
            backgroundSprites = [],
            characterSprites = [],
            textObjects = [],
            elapsedMs = 0,
        } = {}) {
            const effectId = normalizeEffectId(id);
            const factory = INTRO_EFFECTS.get(effectId);
            if (!factory) {
                if (effectId && effectId !== 'none') {
                    debugLog('[vn_pixijs_vfx:intro] unavailable', { id: effectId, stanzaIndex });
                }
                return false;
            }

            clear(state.activeId);
            state.activeId = effectId;
            state.targets = { backgroundSprites, characterSprites, textObjects };
            debugLog('[vn_pixijs_vfx:intro] activate', {
                id: effectId,
                intensity,
                stanzaIndex,
                stanzaDurationMs,
                paletteSource: shaderPalette?.source || null,
                paletteColorCount: Array.isArray(shaderPalette?.colors) ? shaderPalette.colors.length : 0,
                softenOverImage,
                backgroundCount: Array.isArray(backgroundSprites) ? backgroundSprites.length : 0,
                characterCount: Array.isArray(characterSprites) ? characterSprites.length : 0,
                textCount: Array.isArray(textObjects) ? textObjects.length : 0
            });

            try {
                state.activeInstance = factory({
                    PIXI,
                    root,
                    app,
                    effectRoot,
                    logicalWidth,
                    logicalHeight,
                    intensity,
                    stanzaIndex,
                    stanzaDurationMs,
                    backgroundSprites,
                    characterSprites,
                    textObjects,
                    shaderPalette,
                    softenOverImage,
                    elapsedMs,
                    debugLog
                }) || null;
            } catch (error) {
                debugLog('[vn_pixijs_vfx:intro] activation failed', { id: effectId, error: error?.message || String(error) });
                state.activeId = 'none';
                state.activeInstance = null;
                return false;
            }
            return true;
        }

        function update({ backgroundSprites, characterSprites, textObjects, ...frame } = {}) {
            if (Array.isArray(backgroundSprites)) state.targets.backgroundSprites = backgroundSprites;
            if (Array.isArray(characterSprites)) state.targets.characterSprites = characterSprites;
            if (Array.isArray(textObjects)) state.targets.textObjects = textObjects;
            try {
                state.activeInstance?.update?.({
                    ...frame,
                    ...state.targets
                });
            } catch (error) {
                debugLog('[vn_pixijs_vfx:intro] update failed', { id: state.activeId, error: error?.message || String(error) });
                clear(state.activeId);
            }
        }

        function destroy() {
            debugLog('[vn_pixijs_vfx:intro] destroy', { activeId: state.activeId });
            clear(state.activeId);
            try { effectRoot.destroy?.({ children: true }); } catch { }
        }

        return {
            activate,
            update,
            clear,
            destroy,
            isIntroEffect: id => INTRO_EFFECTS.has(normalizeEffectId(id)),
            getIntroEffectIds: () => Array.from(INTRO_EFFECTS.keys()),
        };
    }

    function makeIntroFilter(PIXI, fragmentShader, uniformsName, uniforms) {
        return new PIXI.Filter({
            glProgram: new PIXI.GlProgram({ vertex: SHADER_VERT, fragment: prepareIntroShader(fragmentShader) }),
            resources: {
                [uniformsName]: uniforms
            },
        });
    }

    function createShaderOverlayEffect({
        PIXI,
        effectRoot,
        logicalWidth = 1280,
        logicalHeight = 720,
        intensity = 'medium',
        elapsedMs = 0,
        debugLog = () => {},
        id = 'intro-shader-overlay',
        label = 'Intro_VFX_ShaderOverlay',
        shader,
        uniformsName = 'introShaderUniforms',
        shaderPalette = null,
        softenOverImage = false,
        mediumOpacity = 0.58,
        subtleOpacity = 0.38,
        blendMode = 'add'
    } = {}) {
        const rect = new PIXI.Graphics();
        rect.label = label;
        rect.rect(0, 0, logicalWidth, logicalHeight);
        rect.fill({ color: 0xffffff, alpha: 1 });
        rect.blendMode = blendMode;
        rect.alpha = 1;
        rect.zIndex = 0;

        const imageOpacityMultiplier = softenOverImage ? 0.35 : 1;
        const baseOpacity = intensity === 'medium' ? mediumOpacity : subtleOpacity;
        const paletteUniformData = createPaletteUniforms(shaderPalette);
        const filter = makeIntroFilter(PIXI, shader, uniformsName, {
            uTime: { value: Math.max(0, elapsedMs) / 1000, type: 'f32' },
            uResolutionX: { value: logicalWidth, type: 'f32' },
            uResolutionY: { value: logicalHeight, type: 'f32' },
            uOpacity: { value: 0, type: 'f32' },
            ...paletteUniformData.uniforms,
        });
        filter.padding = 0;
        rect.filters = [filter];
        effectRoot.addChild(rect);

        debugLog(`[vn_pixijs_vfx:${id}] created`, {
            intensity,
            logicalWidth,
            logicalHeight,
            baseOpacity,
            imageOpacityMultiplier,
            softenOverImage,
            paletteSource: paletteUniformData.palette.source || null,
            paletteColorCount: paletteUniformData.palette.colors.length
        });

        return {
            update({ elapsedMs: frameElapsedMs = 0, stanzaProgress = 0, backgroundVisibility = 0 } = {}) {
                const uniforms = filter.resources[uniformsName].uniforms;
                const fadeIn = Math.min(1, Math.max(0, stanzaProgress / 0.12));
                const fadeOut = Math.min(1, Math.max(0, (1 - stanzaProgress) / 0.16));
                const pulse = 0.92 + Math.sin(frameElapsedMs / 1400) * 0.08;
                const bgVisibility = Math.max(0, Math.min(1, Number(backgroundVisibility) || 0));
                const dynamicOpacityMultiplier = softenOverImage
                    ? 1 - ((1 - imageOpacityMultiplier) * bgVisibility)
                    : 1;
                const clearImageWindowMultiplier = getClearImageWindowMultiplier(stanzaProgress, bgVisibility);
                const blackBackgroundPopMultiplier = 1 + ((1 - bgVisibility) * 1.18);
                uniforms.uTime = Math.max(0, frameElapsedMs) / 1000;
                uniforms.uOpacity = baseOpacity * blackBackgroundPopMultiplier * dynamicOpacityMultiplier * clearImageWindowMultiplier * fadeIn * fadeOut * pulse;
            },
            destroy() {
                try { rect.destroy?.({ children: true }); } catch { }
                try { filter.destroy?.(); } catch { }
            }
        };
    }

    function createRaymarchFractalEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-raymarch-fractal',
            label: 'Intro_VFX_RaymarchFractal',
            shader: SHADER_INTRO_RAYMARCH_FRACTAL,
            uniformsName: 'introRaymarchUniforms',
            mediumOpacity: 0.58,
            subtleOpacity: 0.38
        });
    }

    function createOctagramsEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-octagrams',
            label: 'Intro_VFX_Octagrams',
            shader: SHADER_INTRO_OCTAGRAMS,
            uniformsName: 'introOctagramsUniforms',
            mediumOpacity: 0.52,
            subtleOpacity: 0.34
        });
    }

    function createFractalPyramidEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-fractal-pyramid',
            label: 'Intro_VFX_FractalPyramid',
            shader: SHADER_INTRO_FRACTAL_PYRAMID,
            uniformsName: 'introFractalPyramidUniforms',
            mediumOpacity: 0.56,
            subtleOpacity: 0.36
        });
    }

    function createShaderArtEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-shader-art',
            label: 'Intro_VFX_ShaderArt',
            shader: SHADER_INTRO_SHADER_ART,
            uniformsName: 'introShaderArtUniforms',
            mediumOpacity: 0.34,
            subtleOpacity: 0.22
        });
    }

    function createProteanCloudsEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-protean-clouds',
            label: 'Intro_VFX_ProteanClouds',
            shader: SHADER_INTRO_PROTEAN_CLOUDS,
            uniformsName: 'introProteanCloudsUniforms',
            mediumOpacity: 0.42,
            subtleOpacity: 0.27
        });
    }

    function createStarNestEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-star-nest',
            label: 'Intro_VFX_StarNest',
            shader: SHADER_INTRO_STAR_NEST,
            uniformsName: 'introStarNestUniforms',
            mediumOpacity: 0.50,
            subtleOpacity: 0.32
        });
    }

    function createMonsterEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-monster',
            label: 'Intro_VFX_Monster',
            shader: SHADER_INTRO_MONSTER,
            uniformsName: 'introMonsterUniforms',
            mediumOpacity: 0.42,
            subtleOpacity: 0.26
        });
    }

    function createTunnelRunnerEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-tunnel-runner',
            label: 'Intro_VFX_TunnelRunner',
            shader: SHADER_INTRO_TUNNEL_RUNNER,
            uniformsName: 'introTunnelRunnerUniforms',
            mediumOpacity: 0.46,
            subtleOpacity: 0.30
        });
    }

    function createPalaceOfMindEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-palace-of-mind',
            label: 'Intro_VFX_PalaceOfMind',
            shader: SHADER_INTRO_PALACE_OF_MIND,
            uniformsName: 'introPalaceOfMindUniforms',
            mediumOpacity: 0.46,
            subtleOpacity: 0.30
        });
    }

    function createBlue002Effect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-blue-002',
            label: 'Intro_VFX_Blue002',
            shader: SHADER_INTRO_BLUE_002,
            uniformsName: 'introBlue002Uniforms',
            mediumOpacity: 0.48,
            subtleOpacity: 0.31
        });
    }

    function createEtherEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-ether',
            label: 'Intro_VFX_Ether',
            shader: SHADER_INTRO_ETHER,
            uniformsName: 'introEtherUniforms',
            mediumOpacity: 0.44,
            subtleOpacity: 0.28
        });
    }

    function createZippyZapsEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-zippy-zaps',
            label: 'Intro_VFX_ZippyZaps',
            shader: SHADER_INTRO_ZIPPY_ZAPS,
            uniformsName: 'introZippyZapsUniforms',
            mediumOpacity: 0.38,
            subtleOpacity: 0.24
        });
    }

    function createBiomineEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-biomine',
            label: 'Intro_VFX_Biomine',
            shader: SHADER_INTRO_BIOMINE,
            uniformsName: 'introBiomineUniforms',
            mediumOpacity: 0.40,
            subtleOpacity: 0.25
        });
    }

    function createBalKhanTunnelEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-bal-khan-tunnel',
            label: 'Intro_VFX_BalKhanTunnel',
            shader: SHADER_INTRO_BAL_KHAN_TUNNEL,
            uniformsName: 'introBalKhanTunnelUniforms',
            mediumOpacity: 0.42,
            subtleOpacity: 0.27
        });
    }

    function createWarpSpeedEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-warp-speed',
            label: 'Intro_VFX_WarpSpeed',
            shader: SHADER_INTRO_WARP_SPEED,
            uniformsName: 'introWarpSpeedUniforms',
            mediumOpacity: 0.44,
            subtleOpacity: 0.28
        });
    }

    function createGildedKaleidoscopeEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-gilded-kaleidoscope',
            label: 'Intro_VFX_GildedKaleidoscope',
            shader: SHADER_INTRO_GILDED_KALEIDOSCOPE,
            uniformsName: 'introGildedKaleidoscopeUniforms',
            mediumOpacity: 0.40,
            subtleOpacity: 0.25
        });
    }

    function createTopologicaEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-topologica',
            label: 'Intro_VFX_Topologica',
            shader: SHADER_INTRO_TOPOLOGICA,
            uniformsName: 'introTopologicaUniforms',
            mediumOpacity: 0.42,
            subtleOpacity: 0.27
        });
    }

    function createTransparentCubeFieldEffect(options = {}) {
        return createShaderOverlayEffect({
            ...options,
            id: 'intro-transparent-cube-field',
            label: 'Intro_VFX_TransparentCubeField',
            shader: SHADER_INTRO_TRANSPARENT_CUBE_FIELD,
            uniformsName: 'introTransparentCubeFieldUniforms',
            mediumOpacity: 0.44,
            subtleOpacity: 0.28
        });
    }

    registerEffect('intro-raymarch-fractal', createRaymarchFractalEffect);
    registerEffect('intro-octagrams', createOctagramsEffect);
    registerEffect('intro-fractal-pyramid', createFractalPyramidEffect);
    registerEffect('intro-shader-art', createShaderArtEffect);
    registerEffect('intro-protean-clouds', createProteanCloudsEffect);
    registerEffect('intro-star-nest', createStarNestEffect);
    registerEffect('intro-monster', createMonsterEffect);
    registerEffect('intro-tunnel-runner', createTunnelRunnerEffect);
    registerEffect('intro-palace-of-mind', createPalaceOfMindEffect);
    registerEffect('intro-blue-002', createBlue002Effect);
    registerEffect('intro-ether', createEtherEffect);
    registerEffect('intro-zippy-zaps', createZippyZapsEffect);
    registerEffect('intro-biomine', createBiomineEffect);
    registerEffect('intro-bal-khan-tunnel', createBalKhanTunnelEffect);
    registerEffect('intro-warp-speed', createWarpSpeedEffect);
    registerEffect('intro-gilded-kaleidoscope', createGildedKaleidoscopeEffect);
    registerEffect('intro-topologica', createTopologicaEffect);
    registerEffect('intro-transparent-cube-field', createTransparentCubeFieldEffect);

    window.__VFX = window.__VFX || {};
    introApi = {
        createController,
        registerEffect,
        INTRO_EFFECT_IDS: Array.from(INTRO_EFFECTS.keys())
    };
    window.__VFX.intro = introApi;
})();

// vfx-filters.js
// Instantiates every PIXI filter used by the VFX system and wires each one
// to its corresponding rect via .filters = [].
//
// Atmospheric effects use makeShaderFilter() (cloudUniforms layout).
// Blood uses a separate bloodUniforms layout.
// All pixi-filters post-processing instances are created here too.
//
// Injection order: requires vfx-helpers.js to be loaded first.

/* global SHADER_VERT, SHADER_FBM_CLOUDS, SHADER_FBM_FOG, SHADER_RAIN,
          SHADER_DESERT_DUST, SHADER_SNOW, SHADER_EMBERS, SHADER_BLOOD, SHADER_FADETOBLACK */

(function () {
    const { makeShaderFilter } = window.__VFX.helpers;

    /**
     * @param {object} PIXI
     * @param {object} containers  - From createContainers()
     * @param {number} W           - Game width
     * @param {number} H           - Game height
     * @returns {object}  All named filter instances
     */
    function createFilters(PIXI, containers, W, H) {
        const {
            bgShadowRect,
            bgFogRect,
            bgRainRect,
            bgDesertDustRect,
            bgDesertDustRectBg,
            bgSnowRect,
            bgSnowRectBg,
            bgEmbersRect,
            bgEmbersRectBg,
            bgBloodRect,
            bgFadeToBlackRect,
        } = containers;

        // -------------------------------------------------------------------------
        // Atmospheric shader filters
        // Time offsets are staggered so FG/BG instances and different effects never
        // share identical noise patterns at startup.
        // -------------------------------------------------------------------------

        const shadowFilter = makeShaderFilter(PIXI, SHADER_FBM_CLOUDS, {
            uTime: 0.0, uBaseColor: [0.0, 0.0, 0.0], uTimeMultiplier: 0.015, uScaleMultiplier: 3.0, gameWidth: W, gameHeight: H,
        });
        bgShadowRect.filters = [shadowFilter];

        const fogFilter = makeShaderFilter(PIXI, SHADER_FBM_FOG, {
            uTime: 1000.0, uBaseColor: [0.9, 0.95, 1.0], uTimeMultiplier: -0.005, uScaleMultiplier: 1.5, gameWidth: W, gameHeight: H,
        });
        bgFogRect.filters = [fogFilter];

        const rainFilter = makeShaderFilter(PIXI, SHADER_RAIN, {
            uTime: 2000.0, uBaseColor: [0.8, 0.8, 0.9], uTimeMultiplier: 1.0, uScaleMultiplier: 1.0, gameWidth: W, gameHeight: H,
        });
        bgRainRect.filters = [rainFilter];

        // Desert Dust — FG is faster/larger, BG is slower/smaller for depth
        const desertDustFilter = makeShaderFilter(PIXI, SHADER_DESERT_DUST, {
            uTime: 3000.0, uBaseColor: [0.8, 0.7, 0.6], uTimeMultiplier: 1.0, uScaleMultiplier: 1.0, gameWidth: W, gameHeight: H,
        });
        bgDesertDustRect.filters = [desertDustFilter];

        const desertDustFilterBg = makeShaderFilter(PIXI, SHADER_DESERT_DUST, {
            uTime: 3500.0, uBaseColor: [0.8, 0.7, 0.6], uTimeMultiplier: 0.5, uScaleMultiplier: 1.5, gameWidth: W, gameHeight: H,
        });
        bgDesertDustRectBg.filters = [desertDustFilterBg];

        // Snow
        const snowFilter = makeShaderFilter(PIXI, SHADER_SNOW, {
            uTime: 4000.0, uBaseColor: [1.0, 1.0, 1.0], uTimeMultiplier: 1.0, uScaleMultiplier: 1.0, gameWidth: W, gameHeight: H,
        });
        bgSnowRect.filters = [snowFilter];

        const snowFilterBg = makeShaderFilter(PIXI, SHADER_SNOW, {
            uTime: 4500.0, uBaseColor: [1.0, 1.0, 1.0], uTimeMultiplier: 0.5, uScaleMultiplier: 1.5, gameWidth: W, gameHeight: H,
        });
        bgSnowRectBg.filters = [snowFilterBg];

        // Embers
        const embersFilter = makeShaderFilter(PIXI, SHADER_EMBERS, {
            uTime: 5000.0, uBaseColor: [1.0, 0.5, 0.0], uTimeMultiplier: 1.0, uScaleMultiplier: 1.0, gameWidth: W, gameHeight: H,
        });
        bgEmbersRect.filters = [embersFilter];

        const embersFilterBg = makeShaderFilter(PIXI, SHADER_EMBERS, {
            uTime: 5500.0, uBaseColor: [1.0, 0.5, 0.0], uTimeMultiplier: 0.5, uScaleMultiplier: 1.5, gameWidth: W, gameHeight: H,
        });
        bgEmbersRectBg.filters = [embersFilterBg];

        // -------------------------------------------------------------------------
        // Blood — uses its own uniform layout (no uBaseColor / camera uniforms)
        // -------------------------------------------------------------------------
        const bloodFilter = new PIXI.Filter({
            glProgram: new PIXI.GlProgram({ vertex: SHADER_VERT, fragment: SHADER_BLOOD }),
            resources: {
                bloodUniforms: {
                    uTime:        { value: 0.0, type: 'f32' },
                    uResolutionX: { value: W,   type: 'f32' },
                    uResolutionY: { value: H,   type: 'f32' },
                    uOpacity:     { value: 0.0, type: 'f32' },
                    uFlipY:       { value: 1.0, type: 'f32' },
                },
            },
        });
        bloodFilter.padding   = 0;
        bgBloodRect.filters   = [bloodFilter];
        
        const fadeToBlackFilter = new PIXI.Filter({
            glProgram: new PIXI.GlProgram({ vertex: SHADER_VERT, fragment: SHADER_FADETOBLACK }),
            resources: {
                fadeToBlackUniforms: {
                    uProgress:    { value: 0.0, type: 'f32' },
                    uResolutionX: { value: W,   type: 'f32' },
                    uResolutionY: { value: H,   type: 'f32' },
                    uOpacity:     { value: 0.0, type: 'f32' },
                },
            },
        });
        fadeToBlackFilter.padding = 0;
        bgFadeToBlackRect.filters = [fadeToBlackFilter];

        // -------------------------------------------------------------------------
        // pixi-filters screen post-processing
        // -------------------------------------------------------------------------

        const bloomFilter = new PIXI.filters.BloomFilter({ strength: 2, quality: 4 });

        const asciiFilter = new PIXI.filters.AsciiFilter({ size: 8 });

        const crossHatchFilter = new PIXI.filters.CrossHatchFilter();

        const crtFilter = new PIXI.filters.CRTFilter({
            curvature:       2.0,
            lineWidth:       2.0,
            lineContrast:    0.3,
            noise:           0.1,
            noiseSize:       1.0,
            vignetting:      0.3,
            vignettingAlpha: 0.7,
            vignettingBlur:  0.3,
        });

        const godrayFilter = new PIXI.filters.GodrayFilter({
            angle:      30,
            gain:       0.5,
            lacunarity: 2.5,
            parallel:   false,
            center:     { x: -300, y: -300 }, // Default well off-screen; overridden by event payload
            brightness: 1,
            alpha:      1,
        });

        // AdjustmentFilter used for guaranteed, absolute desaturation
        const grayscaleFilter = new PIXI.filters.AdjustmentFilter({
            saturation: 0,   // Kill ALL colour
            contrast:   1.4, // High contrast for dramatic look
            brightness: 0.7, // Significantly darker
            gamma:      1.0,
        });

        const motionBlurFilter = new PIXI.filters.MotionBlurFilter({
            velocity:   [0, 0],
            kernelSize: 5,
            offset:     0,
        });

        const oldFilmFilter = new PIXI.filters.OldFilmFilter({
            sepia:           0.3,
            noise:           0.3,
            noiseSize:       1.0,
            scratch:         0.5,
            scratchDensity:  0.3,
            scratchWidth:    1.0,
            vignetting:      0.3,
            vignettingAlpha: 1.0,
            vignettingBlur:  0.3,
        });

        // PixiJS v8 / pixi-filters v6: first argument is the pixel size directly
        const pixelateFilter = new PIXI.filters.PixelateFilter(8);

        const shockwaveFilter = new PIXI.filters.ShockwaveFilter({
            amplitude:  30,   // Pixel intensity
            wavelength: 160,  // Pixel ripple width
            speed:      500,  // Pixels per second
            brightness: 1,
            radius:     -1,   // Infinite
        });
        shockwaveFilter.center  = { x: W / 2, y: H / 2 };
        shockwaveFilter.time    = 10.0; // Start in 'finished' state so it doesn't play on load
        shockwaveFilter.padding = 100;

        const glitchFilter = new PIXI.filters.GlitchFilter({
            slices:    10,
            offset:    20,
            direction: 0,
            fillMode:  2,    // Transparent
            seed:      0.5,
            average:   false,
            red:       [-2,  2],
            green:     [-4,  4],
            blue:      [ 2, -2],
        });

        return {
            // Atmospheric
            shadowFilter,
            fogFilter,
            rainFilter,
            desertDustFilter,
            desertDustFilterBg,
            snowFilter,
            snowFilterBg,
            embersFilter,
            embersFilterBg,
            bloodFilter,
            fadeToBlackFilter,
            // Screen post-processing
            bloomFilter,
            asciiFilter,
            crossHatchFilter,
            crtFilter,
            godrayFilter,
            grayscaleFilter,
            motionBlurFilter,
            oldFilmFilter,
            pixelateFilter,
            shockwaveFilter,
            glitchFilter,
        };
    }

    window.__VFX = window.__VFX || {};
    window.__VFX.filters = { createFilters };
})();

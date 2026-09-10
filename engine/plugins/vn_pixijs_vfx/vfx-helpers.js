// vfx-helpers.js
// Low-level PIXI factory utilities shared across the VFX system.
// These eliminate the ~10x repeated rect-creation and ~8x repeated shader-filter-creation boilerplate.
//
// Injection order: must be loaded BEFORE vfx-containers.js and vfx-filters.js.

(function () {
    /**
     * Creates a full-screen white Graphics rect — the standard canvas for every shader-driven overlay.
     * The rect itself is just a white quad; the GLSL filter assigned to it does all the visual work.
     *
     * @param {object}  PIXI       - The injected PIXI namespace
     * @param {object}  container  - Parent container to add the rect to (pass null to skip)
     * @param {string}  blendMode  - e.g. 'add', 'multiply', 'normal'
     * @param {boolean} visible    - Initial visibility (default false — most effects start hidden)
     * @param {number}  w          - Game/render width
     * @param {number}  h          - Game/render height
     */
    function makeEffectRect(PIXI, container, blendMode = 'normal', visible = false, w = 1920, h = 1080) {
        const rect = new PIXI.Graphics();
        rect.rect(0, 0, w, h);
        rect.fill({ color: 0xFFFFFF, alpha: 1.0 });
        rect.blendMode = blendMode;
        rect.visible   = visible;
        if (container) container.addChild(rect);
        return rect;
    }

    /**
     * Creates a custom GLSL Filter using the standard "cloudUniforms" resource layout
     * shared by all atmospheric effects (clouds, fog, rain, snow, dust, embers).
     *
     * Only the values that differ between effects need to be supplied — everything else gets
     * a safe default so call-sites stay short and readable.
     *
     * NOTE: SHADER_VERT is a global injected by the backend before this script runs.
     *
     * @param {object} PIXI
     * @param {string} fragmentShader  - One of the injected SHADER_* globals
     * @param {object} opts
     * @param {number}   opts.uTime            - Starting time offset (stagger per-effect to vary patterns)
     * @param {number[]} opts.uBaseColor       - RGB triple, e.g. [0.9, 0.95, 1.0]
     * @param {number}   opts.uTimeMultiplier  - Controls speed/direction of the noise animation
     * @param {number}   opts.uScaleMultiplier - Controls zoom level of the noise pattern
     * @param {number}   opts.gameWidth
     * @param {number}   opts.gameHeight
     */
    function makeShaderFilter(PIXI, fragmentShader, {
        uTime            = 0.0,
        uBaseColor       = [1.0, 1.0, 1.0],
        uTimeMultiplier  = 1.0,
        uScaleMultiplier = 1.0,
        gameWidth        = 1920,
        gameHeight       = 1080,
    } = {}) {
        const filter = new PIXI.Filter({
            glProgram: new PIXI.GlProgram({ vertex: SHADER_VERT, fragment: fragmentShader }), // eslint-disable-line no-undef
            resources: {
                cloudUniforms: {
                    uTime:            { value: uTime,                            type: 'f32' },
                    uResolutionX:     { value: gameWidth,                        type: 'f32' },
                    uResolutionY:     { value: gameHeight,                       type: 'f32' },
                    uOpacity:         { value: 0.0,                              type: 'f32' },
                    uBaseColor:       { value: new Float32Array(uBaseColor),     type: 'vec3<f32>' },
                    uTimeMultiplier:  { value: uTimeMultiplier,                  type: 'f32' },
                    uScaleMultiplier: { value: uScaleMultiplier,                 type: 'f32' },
                    uCameraPos:       { value: new Float32Array([0.0, 0.0]),     type: 'vec2<f32>' },
                    uCameraScale:     { value: 1.0,                              type: 'f32' },
                    uFlipY:           { value: 1.0,                              type: 'f32' },
                },
            },
        });
        filter.padding = 0;
        return filter;
    }

    window.__VFX = window.__VFX || {};
    window.__VFX.helpers = { makeEffectRect, makeShaderFilter };
})();

// vfx-containers.js
// Creates and returns every PIXI Container, Graphics rect, and particle sub-container
// used by the VFX system.  Nothing is added to the stage here — that happens in initVfx()
// once the engine layers are confirmed ready.
//
// Injection order: requires vfx-helpers.js to be loaded first.

(function () {
    const { makeEffectRect } = window.__VFX.helpers;

    /**
     * @param {object} PIXI
     * @param {number} W  - Game width
     * @param {number} H  - Game height
     * @returns {object}  All named PIXI display objects
     */
    function createContainers(PIXI, W, H) {

        // -------------------------------------------------------------------------
        // Top-level layer containers
        // -------------------------------------------------------------------------

        // Foreground VFX — mounted to pixiApp.layers.fx
        const vfxContainer = new PIXI.Container();
        vfxContainer.label = 'VFX_Container_FG';

        // Background VFX — mounted to pixiApp.layers.background (zIndex 10, sortable)
        const vfxContainerBg = new PIXI.Container();
        vfxContainerBg.label = 'VFX_Container_BG';

        // Blood splatter — mounted directly to app.stage so it is truly screen-fixed
        // and never covered by viewport transforms or other VFX layers.
        const vfxContainerBlood = new PIXI.Container();
        vfxContainerBlood.label  = 'VFX_Container_Blood';
        vfxContainerBlood.zIndex = 2000;

        // -------------------------------------------------------------------------
        // Foreground shader quads
        // Start hidden by default so inactive effects do not consume render work.
        // -------------------------------------------------------------------------
        const bgShadowRect     = makeEffectRect(PIXI, vfxContainer,      'multiply', false, W, H); // Cloud shadows
        const bgFogRect        = makeEffectRect(PIXI, vfxContainer,      'add',      false, W, H); // Volumetric fog
        const bgRainRect       = makeEffectRect(PIXI, vfxContainer,      'add',      false, W, H); // Procedural rain
        const bgThunderRect    = makeEffectRect(PIXI, vfxContainer,      'add',      false, W, H); // Lightning flash
        const bgDesertDustRect = makeEffectRect(PIXI, vfxContainer,      'normal',   false, W, H); // Desert dust (FG)
        const bgSnowRect       = makeEffectRect(PIXI, vfxContainer,      'normal',   false, W, H); // Snow (FG)
        const bgEmbersRect     = makeEffectRect(PIXI, vfxContainer,      'add',      false, W, H); // Embers (FG)
        const bgBloodRect      = makeEffectRect(PIXI, vfxContainerBlood, 'normal',   false, W, H); // Blood splatter
        const bgFadeToBlackRect = makeEffectRect(PIXI, vfxContainerBlood, 'normal',   false, W, H); // FadeToBlack transition

        // -------------------------------------------------------------------------
        // Background shader quads (parallax layer — slower / smaller than FG)
        // -------------------------------------------------------------------------
        const bgDesertDustRectBg = makeEffectRect(PIXI, vfxContainerBg, 'normal', false, W, H);
        const bgSnowRectBg       = makeEffectRect(PIXI, vfxContainerBg, 'normal', false, W, H);
        const bgEmbersRectBg     = makeEffectRect(PIXI, vfxContainerBg, 'add',    false, W, H);

        // -------------------------------------------------------------------------
        // Particle sub-containers (Foreground)
        // -------------------------------------------------------------------------
        const magicDustContainer = new PIXI.Container();
        magicDustContainer.visible = false;
        vfxContainer.addChild(magicDustContainer);

        const leavesContainer = new PIXI.Container();
        leavesContainer.visible = false;
        vfxContainer.addChild(leavesContainer);

        // -------------------------------------------------------------------------
        // Particle sub-containers (Background)
        // -------------------------------------------------------------------------
        const magicDustContainerBg = new PIXI.Container();
        magicDustContainerBg.visible = false;
        vfxContainerBg.addChild(magicDustContainerBg);

        const leavesContainerBg = new PIXI.Container();
        leavesContainerBg.visible = false;
        vfxContainerBg.addChild(leavesContainerBg);

        return {
            // Layer roots
            vfxContainer,
            vfxContainerBg,
            vfxContainerBlood,

            // FG shader quads
            bgShadowRect,
            bgFogRect,
            bgRainRect,
            bgThunderRect,
            bgDesertDustRect,
            bgSnowRect,
            bgEmbersRect,
            bgBloodRect,
            bgFadeToBlackRect,

            // BG shader quads
            bgDesertDustRectBg,
            bgSnowRectBg,
            bgEmbersRectBg,

            // Particle sub-containers
            magicDustContainer,
            magicDustContainerBg,
            leavesContainer,
            leavesContainerBg,
        };
    }

    window.__VFX = window.__VFX || {};
    window.__VFX.containers = { createContainers };
})();

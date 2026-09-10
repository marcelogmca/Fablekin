// vfx-particles.js
// Generates canvas-based textures and initialises the particle pools
// for Magic Dust and Falling Leaves.
// Also builds the Vignette sprite (canvas radial-gradient, not a shader).
//
// Injection order: no dependencies on other VFX modules — can be loaded any time after vfx-constants.js.

(function () {

    // ---------------------------------------------------------------------------
    // Texture factories
    // ---------------------------------------------------------------------------

    /** Soft glowing radial dot — the building block for every magic-dust sprite. */
    function createMagicTexture(PIXI) {
        const canvas = document.createElement('canvas');
        canvas.width  = 32;
        canvas.height = 32;
        const ctx      = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0,   'rgba(50, 200, 255, 1.0)'); // cyan/blue core
        gradient.addColorStop(0.2, 'rgba(0, 150, 255, 0.8)');  // mid glow
        gradient.addColorStop(1,   'rgba(0, 50, 100, 0.0)');   // fade out
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(16, 16, 16, 0, Math.PI * 2);
        ctx.fill();
        return PIXI.Texture.from(canvas);
    }

    /** Almond-shaped leaf with a linear gradient fill and a short stem stroke. */
    function makeLeafTexture(PIXI, color1, color2, color3) {
        const canvas = document.createElement('canvas');
        canvas.width  = 64;
        canvas.height = 64;
        const ctx  = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 64, 64);
        grad.addColorStop(0,   color1);
        grad.addColorStop(0.5, color2);
        grad.addColorStop(1,   color3);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(10, 32);
        ctx.quadraticCurveTo(32, 10, 54, 32);
        ctx.quadraticCurveTo(32, 54, 10, 32);
        ctx.fill();

        ctx.strokeStyle = '#4A1D0B';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(10, 32);
        ctx.lineTo(2, 40);
        ctx.stroke();

        return PIXI.Texture.from(canvas);
    }

    /** Three autumn-hued leaf textures (rust orange, olive green, mustard yellow). */
    function createLeafTextures(PIXI) {
        return [
            makeLeafTexture(PIXI, '#D45D3B', '#E5993B', '#6E2A15'), // Rust Orange → Gold
            makeLeafTexture(PIXI, '#5B8A42', '#86B049', '#2E4C18'), // Olive → Lime Green
            makeLeafTexture(PIXI, '#E2A72F', '#F0D43A', '#8F6611'), // Mustard → Bright Yellow
        ];
    }

    /**
     * Canvas radial-gradient vignette — completely decoupled from the shader pipeline.
     * Mounted to app.stage so it remains screen-fixed regardless of viewport transforms.
     */
    function createVignetteSprite(PIXI, W, H) {
        const canvas = document.createElement('canvas');
        canvas.width  = 512;
        canvas.height = 512;
        const ctx  = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 300);
        grad.addColorStop(0,   'rgba(0,0,0,0)');
        grad.addColorStop(0.5, 'rgba(0,0,0,0.1)');  // subtle inner
        grad.addColorStop(1,   'rgba(0,0,0,0.85)'); // dark outer
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);

        const sprite     = new PIXI.Sprite(PIXI.Texture.from(canvas));
        sprite.width     = W;
        sprite.height    = H;
        sprite.blendMode = 'multiply';
        sprite.visible   = false;
        sprite.zIndex    = 999; // Topmost within stage
        return sprite;
    }

    // ---------------------------------------------------------------------------
    // Particle pool initialisers
    // ---------------------------------------------------------------------------

    /**
     * Builds the magic-dust sprite pool and adds each particle to the correct
     * FG or BG sub-container.  Even-indexed → FG, odd-indexed → BG.
     */
    function initMagicParticles(PIXI, texture, containers, W, H, count) {
        const { magicDustContainer, magicDustContainerBg } = containers;
        const particles = [];

        for (let i = 0; i < count; i++) {
            const isBg = (i % 2 !== 0);
            const p    = new PIXI.Sprite(texture);
            p.anchor.set(0.5);
            p.x     = Math.random() * W;
            p.y     = Math.random() * H;
            p.scale.set(isBg ? 0.15 + Math.random() * 0.2 : 0.3 + Math.random() * 0.4);
            p.blendMode = 'add';
            p.alpha     = 0;

            // Custom physics properties
            p.vx   = (Math.random() - 0.5) * (isBg ? 0.25 : 0.5);
            p.vy   = 0.2 + Math.random() * (isBg ? 0.25 : 0.5);
            p.seed = Math.random() * 100;
            p.isBg = isBg;

            particles.push(p);
            if (isBg) magicDustContainerBg.addChild(p);
            else      magicDustContainer.addChild(p);
        }

        return particles;
    }

    /**
     * Builds the leaf sprite pool.  Each leaf starts inactive (off-screen, hidden)
     * and is spawned by the tick when the leaves effect becomes enabled.
     */
    function initLeafParticles(PIXI, leafTextures, containers, count) {
        const { leavesContainer, leavesContainerBg } = containers;
        const particles = [];

        for (let i = 0; i < count; i++) {
            const isBg = (i % 2 !== 0);
            const tex  = leafTextures[Math.floor(Math.random() * leafTextures.length)];
            const p    = new PIXI.Sprite(tex);
            p.anchor.set(0.5);
            p.x = 0;
            p.y = 0;
            p.scale.set(isBg ? 0.15 + Math.random() * 0.2 : 0.4 + Math.random() * 0.3);

            // Custom physics properties
            p.vy        = (isBg ? 0.5 : 1.0) + Math.random() * (isBg ? 0.75 : 1.5); // Fall speed
            p.seedX     = Math.random() * 100; // Offset for horizontal sine wave
            p.seedRot   = Math.random() * 100;
            p.alpha     = isBg ? 0.6 : 0.9;
            p.baseAlpha = isBg ? 0.6 : 0.9;
            p.isActive  = false; // Custom state flag — managed by the tick
            p.visible   = false;
            p.isBg      = isBg;

            particles.push(p);
            if (isBg) leavesContainerBg.addChild(p);
            else      leavesContainer.addChild(p);
        }

        return particles;
    }

    // ---------------------------------------------------------------------------
    // Unified entry point
    // ---------------------------------------------------------------------------

    /**
     * Creates all textures, the vignette sprite, and both particle pools in one call.
     *
     * @returns {{ vignetteSprite, magicParticles, leafParticles }}
     */
    function createParticleSystem(PIXI, containers, W, H, NUM_MAGIC, NUM_LEAVES) {
        const magicTexture   = createMagicTexture(PIXI);
        const leafTextures   = createLeafTextures(PIXI);
        const vignetteSprite = createVignetteSprite(PIXI, W, H);

        const magicParticles = initMagicParticles(PIXI, magicTexture, containers, W, H, NUM_MAGIC);
        const leafParticles  = initLeafParticles(PIXI, leafTextures, containers, NUM_LEAVES);

        return { vignetteSprite, magicParticles, leafParticles };
    }

    window.__VFX = window.__VFX || {};
    window.__VFX.particles = { createParticleSystem };
})();

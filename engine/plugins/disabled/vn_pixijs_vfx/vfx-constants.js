// vfx-constants.js
// All static, never-changing configuration for the VFX system.
// Edit values here rather than hunting through the main files.
//
// Injection order: must be loaded FIRST (no dependencies).

(function () {
    const GAME_WIDTH  = 1920;
    const GAME_HEIGHT = 1080;

    // Particle pool sizes (FG + BG interleaved, so both halves get equal counts)
    const NUM_MAGIC  = 30; // 15 BG, 15 FG
    const NUM_LEAVES = 25; // 12 BG, 13 FG

    // Peak opacity each atmospheric effect fades up to when active
    const TARGET_OPACITIES = {
        clouds:     0.35,
        fog:        0.45, // Can be thicker since fog is soft
        rain:       1.0,
        desertDust: 0.8,
        snow:       1.0,
        embers:     1.0,
        magicDust:  1.0,
        leaves:     1.0,
        blood:      1.0,
        fadetoblack: 1.0,
    };

    // Maps event/sync effect IDs → VFX_SETTINGS keys
    const EFFECT_SETTING_MAP = {
        'clouds':       'force_clouds',
        'fog':          'force_fog',
        'thunder':      'force_thunder',
        'rain':         'force_rain',
        'snow':         'force_snow',
        'embers':       'force_embers',
        'desert-dust':  'force_desert_dust',
        'magic-dust':   'force_magic_dust',
        'leaves':       'force_leaves',
        'crt':          'force_crt',
        'ascii':        'force_ascii',
        'cross-hatch':  'force_cross_hatch',
        'bloom':        'force_bloom',
        'godray':       'force_godray',
        'grayscale':    'force_grayscale',
        'motion-blur':  'force_motion_blur',
        'old-film':     'force_old_film',
        'pixelate':     'force_pixelate',
        'blood':        'force_blood',
        'glitch':       'force_glitch',
        'vignette':     'force_vignette',
        'shake':        'force_shake',
        'wobble':       'force_wobble',
        'shockwave':    'force_shockwave',
        'fadetoblack':  'force_fade_to_black',
    };

    window.__VFX = window.__VFX || {};
    window.__VFX.constants = { GAME_WIDTH, GAME_HEIGHT, NUM_MAGIC, NUM_LEAVES, TARGET_OPACITIES, EFFECT_SETTING_MAP };
})();

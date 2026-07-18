const fs = require('fs/promises');
const path = require('path');

module.exports = {
    id: 'sprite_shading',
    name: 'Sprite Shading',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Visual',
    wizard: {
        include: true,
        order: 640,
        group: 'Visual',
        label: 'Sprite Shading',
        recommended_enabled: true,
        author_note: 'Recommended if you use VN sprites; it is mostly visual polish without model cost.',
        enabled_note: 'Sprites receive ambient lighting, shadows, outlines, and softer integration with backgrounds.',
        disabled_note: 'Sprites render more plainly and may look less grounded in varied backgrounds.',
        settings_note: 'Tune edge, shadow, outline, and ambient lighting options in plugin settings.'
    },
    description: 'Attemps to shade sprites based on the background image for a more immersive feel. Adds a soft edge to the sprite and a dynamic ambient lighting effect.',
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Adds high-fidelity environmental effects and cinematic overlays. Shaders are optimized for PixiJS v8 and can be triggered dynamically via narrative cues.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Uses a multi-pass rendering pipeline: \n1. AMBIENT: Samples the background at character bounds, saturates and blurs it to create a dynamic lighting tint. \n2. SHADOW: Samples the background, applies high-contrast thresholding, and offsets the result to simulate depth. \n3. BLURRED EDGE: Softens the character silhouette against the background. \n4. CEL OUTLINE: Adds a crisp mathematical border for an anime-inspired aesthetic. \nThis approach ensures characters feel "grounded" in every unique background without manual lighting adjustments.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'None',
            immersion: 'High',
            cost: 'None',
            latency: 'None'
        },
        enable_blurred_edge: {
            type: 'checkbox',
            label: 'Enable Blurred Edge',
            description: 'Adds a blurry edge to the sprite for better contrast. Can help the sprite blend into the background without looking like a sticker.',
            default: true
        },
        blurred_edge_blur: {
            type: 'number',
            label: 'Blurred Edge Blur',
            description: 'Amount of blur for the background edge (px).',
            default: 3,
            min: 0,
            max: 100
        },
        blurred_edge_opacity: {
            type: 'number',
            label: 'Blurred Edge Opacity',
            description: 'Opacity of the blurred background sprite (0.0 to 1.0).',
            default: 0.9,
            min: 0,
            max: 1,
            step: 0.05
        },
        enable_ambient_lighting: {
            type: 'checkbox',
            label: 'Enable Ambient Lighting',
            description: 'Dynamically tints the character based on the current background image.',
            default: true
        },
        ambient_lighting_opacity: {
            type: 'number',
            label: 'Ambient Lighting Opacity',
            description: 'The intensity of the environmental overlay (0.0 to 1.0).',
            default: 0.20,
            min: 0,
            max: 1,
            step: 0.05
        },
        ambient_lighting_saturation: {
            type: 'number',
            label: 'Ambient Lighting Saturation %',
            description: 'Adjusts the saturation of the background cutout before applying it as a tint map (e.g. 200%).',
            default: 200,
            min: 100,
            max: 500
        },
        enable_shadow_shading: {
            type: 'checkbox',
            label: 'Enable Shadow Shading',
            description: 'Adds a high-contrast grayscale overlay on top of the lighting shader for better depth.',
            default: true
        },
        shadow_shading_opacity: {
            type: 'number',
            label: 'Shadow Shading Opacity',
            description: 'The intensity of the shadow overlay (0.0 to 1.0).',
            default: 0.33,
            min: 0,
            max: 1,
            step: 0.05
        },
        shadow_shading_contrast: {
            type: 'number',
            label: 'Shadow Shading Contrast %',
            description: 'Adjusts the contrast of the shadow overlay (e.g., 1000% for deep shadows).',
            default: 1000,
            min: 100,
            max: 2000
        },
        shadow_offset_x: {
            type: 'number',
            label: 'Shadow Depth Offset X (px)',
            description: 'Horizontally shifts the background cutout to simulate depth (misaligns character shadow from wall shadow).',
            default: 30,
            min: -200,
            max: 200
        },
        shadow_offset_y: {
            type: 'number',
            label: 'Shadow Depth Offset Y (px)',
            description: 'Vertically shifts the background cutout to simulate depth.',
            default: 30,
            min: -200,
            max: 200
        },
        enable_outline: {
            type: 'checkbox',
            label: 'Enable Cel Outline',
            description: 'Adds a crisp black outline around the character (Anime 3d game style).',
            default: true
        },
        outline_thickness: {
            type: 'number',
            label: 'Outline Thickness (px)',
            description: 'Thickness of the black outline.',
            default: 2,
            min: 1,
            max: 10
        },
        outline_color: {
            type: 'color',
            label: 'Outline Color',
            description: 'The color of the outline (usually black).',
            default: '#000000'
        },
        outline_color_matching: {
            type: 'checkbox',
            label: 'Outline Color Matching',
            description: 'If enabled, the outline will use the colors from the sprite edges instead of a solid color.',
            default: false
        },
        enable_debug_pips: {
            type: 'checkbox',
            label: 'Enable Debug PIPs',
            description: 'Shows diagnostic render target thumbnails on the screen (Yellow, Red, Green, Cyan, Magenta).',
            default: false
        },
        enable_breathing: {
            type: 'checkbox',
            label: 'Enable Breathing',
            description: 'Adds a subtle, slow breathing animation to the character sprites.',
            default: true
        },
        breathing_intensity: {
            type: 'number',
            label: 'Breathing Intensity',
            description: 'The amount of scale change during breathing (e.g., 0.003 for 0.3%).',
            default: 0.003,
            min: 0.001,
            max: 0.01,
            step: 0.001
        },
        breathing_speed: {
            type: 'number',
            label: 'Breathing Cycle Speed (s)',
            description: 'Duration of a full inhale and exhale cycle.',
            default: 6,
            min: 1,
            max: 10,
            step: 0.5
        },
        breathing_randomness: {
            type: 'number',
            label: 'Breathing Duration Randomness %',
            description: 'Adds variation to the breathing speed so characters don\'t feel mechanical (e.g. 20%).',
            default: 40,
            min: 0,
            max: 100,
            step: 5
        }
    },
    hooks: {
        'HOOK_FRONTEND_INJECTION': {
            priority: 10,
            run: async (context, tools) => {
                try {
                    const jsPath = path.join(__dirname, 'ui.js');
                    const js = await fs.readFile(jsPath, 'utf8');

                    return {
                        id: 'sprite_shading',
                        js
                    };
                } catch (error) {
                    tools.logger.error('Frontend', 'Failed to read sprite_shading assets:', error);
                    return null;
                }
            }
        }
    }
};

const fs = require('fs/promises');
const path = require('path');

function getDepthSourcesFromAssetPath(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const assetsIndex = normalized.toLowerCase().lastIndexOf('/assets/');
    if (assetsIndex < 0) return [];

    const assetRelative = normalized.slice(assetsIndex + '/assets/'.length).replace(/^\/+/, '');
    if (!assetRelative.toLowerCase().startsWith('backgrounds/')) return [];

    const withAssets = `assets/${assetRelative}`;
    return [...new Set([
        assetRelative,
        `/${assetRelative}`,
        withAssets,
        `/${withAssets}`,
    ])];
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doesPathExist(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function waitForFileDeletion(filePath, { timeoutMs = 2500, pollMs = 100 } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (!(await doesPathExist(filePath))) {
            return true;
        }
        await sleep(pollMs);
    }
    return !(await doesPathExist(filePath));
}

module.exports = {
    id: 'vn_alive_bg',
    name: 'VN Alive Backgrounds',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Visual',
    wizard: {
        include: true,
        order: 630,
        group: 'Visual',
        label: 'VN Alive Backgrounds',
        recommended_enabled: true,
        author_note: 'Recommended for visual polish if your VN backgrounds have usable depth maps.',
        enabled_note: 'Adds depth-aware bloom, parallax, flicker, and light spread to static backgrounds.',
        disabled_note: 'Backgrounds remain static and lighter to render.',
        settings_note: 'Tune bloom, parallax, flicker, and color bleed in plugin settings.'
    },
    description: 'Adds depth-aware ambient lighting, bloom, light spread, and cursor parallax to background images.',
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Makes static 2D backgrounds feel alive using a cinematic multi-pass lighting pipeline. High-quality light extraction and depth-aware bloom.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'None',
            immersion: 'High',
            cost: 'Low',
            latency: 'Low'
        },
        enable_depth_bloom: {
            type: 'checkbox',
            label: 'Enable Depth-Aware Bloom',
            default: true,
            description: 'Extracts bright areas and applies a soft glow that scales with depth.'
        },
        enable_parallax: {
            type: 'checkbox',
            label: 'Enable Cursor Parallax',
            default: true,
            description: 'Adds subtle mouse-follow parallax movement using the depth map.'
        },
        enable_color_bleed: {
            type: 'checkbox',
            label: 'Enable Light Spread',
            default: true,
            description: 'Simulates indirect light by bleeding background colors onto nearby surfaces based on depth.'
        },
        enable_flicker: {
            type: 'checkbox',
            label: 'Enable Light Flicker',
            default: true,
            description: 'Makes extracted light sources subtly breathe or pulse over time.'
        },
        bloom_threshold: {
            type: 'slider',
            label: 'Bloom Threshold',
            min: 0.3,
            max: 0.9,
            step: 0.05,
            default: 0.65,
            description: 'What brightness counts as a light source.'
        },
        bloom_intensity: {
            type: 'slider',
            label: 'Bloom Intensity',
            min: 0.0,
            max: 2.0,
            step: 0.1,
            default: 0.6,
            description: 'How strong the glow is.'
        },
        parallax_strength: {
            type: 'slider',
            label: 'Parallax Strength',
            min: 0.0,
            max: 0.04,
            step: 0.001,
            default: 0.016,
            description: 'How much layers shift with cursor movement.'
        },
        parallax_motion_scale: {
            type: 'slider',
            label: 'Parallax Motion Scale',
            min: 0.05,
            max: 1.0,
            step: 0.05,
            default: 0.2,
            description: 'Global multiplier for parallax movement (lower is subtler).'
        },
        parallax_idle_motion: {
            type: 'slider',
            label: 'Parallax Idle Motion',
            min: 0.0,
            max: 0.6,
            step: 0.05,
            default: 0.2,
            description: 'Subtle background drift when cursor is idle.'
        },
        parallax_follow_speed: {
            type: 'slider',
            label: 'Parallax Follow Speed',
            min: 2.0,
            max: 20.0,
            step: 0.5,
            default: 8.5,
            description: 'How quickly parallax catches up to cursor movement.'
        },
        parallax_invert_depth: {
            type: 'checkbox',
            label: 'Invert Parallax Depth',
            default: false,
            description: 'Enable this if near/far motion feels reversed on your assets.'
        },
        parallax_depth_cutoff: {
            type: 'slider',
            label: 'Parallax Depth Cutoff',
            min: 0.0,
            max: 1.0,
            step: 0.02,
            default: 0.72,
            description: 'Only areas deeper than this point get parallax movement.'
        },
        parallax_depth_feather: {
            type: 'slider',
            label: 'Parallax Depth Softness',
            min: 0.01,
            max: 0.30,
            step: 0.01,
            default: 0.08,
            description: 'Soft transition width around the depth cutoff.'
        },
        gi_intensity: {
            type: 'slider',
            label: 'Light Spread Intensity',
            min: 0.0,
            max: 1.0,
            step: 0.05,
            default: 0.2,
            description: 'How strong the ambient light spread effect is.'
        },
        gi_radius: {
            type: 'slider',
            label: 'Light Spread Radius',
            min: 1,
            max: 15,
            step: 1,
            default: 6,
            description: 'How far nearby light can spread across surfaces.'
        },
        flicker_strength: {
            type: 'slider',
            label: 'Flicker Strength',
            min: 0.0,
            max: 0.3,
            step: 0.01,
            default: 0.05,
            description: 'The amplitude of light source breathing.'
        },
        warmth_bias: {
            type: 'slider',
            label: 'Warmth Bias',
            min: 0.0,
            max: 1.0,
            step: 0.1,
            default: 0.5,
            description: 'Biases light extraction toward warmer (yellow/orange) tones.'
        },
        enable_persistent_depth_cache: {
            type: 'checkbox',
            label: 'Enable Persistent Depth Cache',
            default: true,
            description: 'Stores generated depth maps locally so repeated backgrounds load instantly on future runs.'
        },
        force_enable: {
            type: 'checkbox',
            label: 'Debug: Force Enable All',
            default: false,
            description: 'Forces all effects to render regardless of narrative context.'
        },
        show_parallax_sample_debug: {
            type: 'checkbox',
            label: 'Debug: Parallax Weight View',
            default: false,
            description: 'Renders parallax diagnostics (far-depth mask + displacement strength) to help tune/fix movement.'
        }
    },

    socketListeners: {
        'delete-file': async (data, tools) => {
            const sources = getDepthSourcesFromAssetPath(data?.filePath);
            if (!sources.length) return;

            const filePath = data?.filePath;
            if (!filePath) return;

            const deleted = await waitForFileDeletion(filePath);
            if (!deleted) {
                tools.logger.warn('Alive BG cache invalidation skipped; file still exists after delete request:', filePath);
                return;
            }

            tools.socket.broadcast('vn-alive-bg:asset-deleted', { sources, filePath: data.filePath });
        }
    },

    hooks: {
        'HOOK_FRONTEND_INJECTION': {
            priority: 20, // Load after vn_pixijs_vfx
            run: async (context, tools) => {
                try {
                    const pluginSettings = tools.settings.getSelf();

                    const moduleFiles = [
                        'alive-bg-depth.js',
                        'alive-bg-pipeline.js',
                        'ui.js',
                    ];

                    const moduleSource = (
                        await Promise.all(
                            moduleFiles.map(f => fs.readFile(path.join(__dirname, f), 'utf8'))
                        )
                    ).join('\n\n');

                    // Read shaders
                    const readShader = f => fs.readFile(path.join(__dirname, 'shaders', f), 'utf8');
                    const [bloomGlsl, giGlsl, compositeGlsl, parallaxGlsl] = await Promise.all([
                        readShader('alive_bloom.glsl'),
                        readShader('alive_gi.glsl'),
                        readShader('alive_composite.glsl'),
                        readShader('alive_parallax.glsl')
                    ]);

                    const injectionHeader = `
                        window.ALIVE_BG_SETTINGS = ${JSON.stringify(pluginSettings)};
                        window.SHADER_ALIVE_BLOOM = ${JSON.stringify(bloomGlsl)};
                        window.SHADER_ALIVE_GI = ${JSON.stringify(giGlsl)};
                        window.SHADER_ALIVE_COMPOSITE = ${JSON.stringify(compositeGlsl)};
                        window.SHADER_ALIVE_PARALLAX = ${JSON.stringify(parallaxGlsl)};
                        window.ALIVE_BG_STATE = context.state;
                        const __aliveBgPluginBase = (() => {
                            const relPath = typeof context?.resolvePluginPath === 'function'
                                ? context.resolvePluginPath('vn_alive_bg', '')
                                : '../../plugins/vn_alive_bg/';
                            const absoluteUrl = new URL(relPath, window.location.href).href;
                            return absoluteUrl.endsWith('/') ? absoluteUrl.slice(0, -1) : absoluteUrl;
                        })();
                        window.ALIVE_BG_SERVER_URL = window.socket?.io?.uri || 'http://localhost:14541';
                        const __aliveBgPluginAssetBase = (() => {
                            const absoluteUrl = new URL('/plugins/vn_alive_bg/', window.ALIVE_BG_SERVER_URL).href;
                            return absoluteUrl.endsWith('/') ? absoluteUrl.slice(0, -1) : absoluteUrl;
                        })();
                        window.ALIVE_BG_PLUGIN_ASSET_URL = __aliveBgPluginAssetBase;
                        window.ALIVE_BG_PLUGIN_URL = __aliveBgPluginBase;
                        window.ALIVE_BG_WORKER_URL = new URL('depth-worker.js', __aliveBgPluginBase + '/').href;
                    `;

                    return { id: 'vn_alive_bg', js: injectionHeader + '\n\n' + moduleSource };
                } catch (error) {
                    tools.logger.error('Frontend', 'Failed to read vn_alive_bg files:', error);
                    return null;
                }
            }
        }
    }
};

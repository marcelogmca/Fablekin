// ui.js
// Frontend orchestrator for the Alive Backgrounds plugin.

(function (context) {
    const { socket } = context;
    const debugLog = () => {};

    window.VN.pixiPlugins.register('vn_alive_bg', (runtime) => {
        let settingsButtonHooked = false;

        function ensureDefaultSettings() {
            if (!window.ALIVE_BG_SETTINGS) window.ALIVE_BG_SETTINGS = {};
            if (typeof window.ALIVE_BG_SETTINGS.show_depth_debug !== 'boolean') window.ALIVE_BG_SETTINGS.show_depth_debug = false;
            if (typeof window.ALIVE_BG_SETTINGS.show_parallax_sample_debug !== 'boolean') window.ALIVE_BG_SETTINGS.show_parallax_sample_debug = false;
            if (typeof window.ALIVE_BG_SETTINGS.enable_parallax !== 'boolean') window.ALIVE_BG_SETTINGS.enable_parallax = true;
            if (typeof window.ALIVE_BG_SETTINGS.enable_depth_bloom !== 'boolean') window.ALIVE_BG_SETTINGS.enable_depth_bloom = true;
            if (typeof window.ALIVE_BG_SETTINGS.enable_color_bleed !== 'boolean') window.ALIVE_BG_SETTINGS.enable_color_bleed = true;
            if (typeof window.ALIVE_BG_SETTINGS.enable_flicker !== 'boolean') window.ALIVE_BG_SETTINGS.enable_flicker = true;
        }

        function savePluginSettings() {
            if (!socket || !window.ALIVE_BG_SETTINGS) return;

            socket.emit(
                'save-plugin-settings',
                {
                    pluginId: 'vn_alive_bg',
                    settings: { ...window.ALIVE_BG_SETTINGS },
                },
                (response) => {
                    if (response && response.success === false) {
                        debugLog(`[Alive BG] Failed to persist settings: ${response.error || 'unknown error'}`);
                    }
                }
            );
        }

        function syncInjectedSettingsControls() {
            ensureDefaultSettings();
            const settings = window.ALIVE_BG_SETTINGS;

            const debugToggle = document.getElementById('alive-bg-show-depth-debug-toggle');
            if (debugToggle) debugToggle.checked = !!settings.show_depth_debug;

            const parallaxToggle = document.getElementById('alive-bg-enable-parallax-toggle');
            if (parallaxToggle) parallaxToggle.checked = !!settings.enable_parallax;

            const parallaxSampleDebugToggle = document.getElementById('alive-bg-show-parallax-sample-debug-toggle');
            if (parallaxSampleDebugToggle) parallaxSampleDebugToggle.checked = !!settings.show_parallax_sample_debug;

            const bloomToggle = document.getElementById('alive-bg-enable-bloom-toggle');
            if (bloomToggle) bloomToggle.checked = !!settings.enable_depth_bloom;

            const giToggle = document.getElementById('alive-bg-enable-gi-toggle');
            if (giToggle) giToggle.checked = !!settings.enable_color_bleed;

            const flickerToggle = document.getElementById('alive-bg-enable-flicker-toggle');
            if (flickerToggle) flickerToggle.checked = !!settings.enable_flicker;
        }

        function bindToggleListener(toggle, settingKey, label) {
            if (!toggle || toggle.dataset.aliveBgBound === '1') return;
            toggle.dataset.aliveBgBound = '1';

            toggle.addEventListener('change', (event) => {
                ensureDefaultSettings();
                window.ALIVE_BG_SETTINGS[settingKey] = !!event.target.checked;

                if (window.__ALIVE_BG && typeof window.__ALIVE_BG.onSettingsUpdated === 'function') {
                    window.__ALIVE_BG.onSettingsUpdated(window.ALIVE_BG_SETTINGS);
                }
                if (window.__ALIVE_PIPELINE) {
                    window.__ALIVE_PIPELINE.update(window.ALIVE_BG_SETTINGS);
                }

                savePluginSettings();
                debugLog(`[Alive BG] ${label} ${event.target.checked ? 'enabled' : 'disabled'} from VN settings.`);
            });
        }

        function ensureSettingsUiInjected() {
            const settingsContent = document.getElementById('vn-settings-content');
            if (!settingsContent) return;

            let block = settingsContent.querySelector('#alive-bg-settings-block');
            if (!block) {
                block = document.createElement('div');
                block.className = 'setting-item';
                block.id = 'alive-bg-settings-block';
                block.innerHTML = `
                <div class="settings-group-title">Alive BG</div>
                <label class="checkbox-container">
                    <input type="checkbox" id="alive-bg-show-depth-debug-toggle">
                    <span class="checkbox-label">Show Depth Map</span>
                </label>
                <label class="checkbox-container">
                    <input type="checkbox" id="alive-bg-enable-bloom-toggle">
                    <span class="checkbox-label">Enable Bloom</span>
                </label>
                <label class="checkbox-container">
                    <input type="checkbox" id="alive-bg-enable-parallax-toggle">
                    <span class="checkbox-label">Enable Parallax</span>
                </label>
                <label class="checkbox-container">
                    <input type="checkbox" id="alive-bg-show-parallax-sample-debug-toggle">
                    <span class="checkbox-label">Debug Parallax Weights</span>
                </label>
                <label class="checkbox-container">
                    <input type="checkbox" id="alive-bg-enable-gi-toggle">
                    <span class="checkbox-label">Enable Light Spread</span>
                </label>
                <label class="checkbox-container">
                    <input type="checkbox" id="alive-bg-enable-flicker-toggle">
                    <span class="checkbox-label">Enable Flicker</span>
                </label>
            `;
                settingsContent.appendChild(block);
            }

            bindToggleListener(
                block.querySelector('#alive-bg-show-depth-debug-toggle'),
                'show_depth_debug',
                'Depth map debug'
            );
            bindToggleListener(
                block.querySelector('#alive-bg-enable-bloom-toggle'),
                'enable_depth_bloom',
                'Bloom'
            );
            bindToggleListener(
                block.querySelector('#alive-bg-enable-parallax-toggle'),
                'enable_parallax',
                'Parallax'
            );
            bindToggleListener(
                block.querySelector('#alive-bg-show-parallax-sample-debug-toggle'),
                'show_parallax_sample_debug',
                'Parallax weight debug'
            );
            bindToggleListener(
                block.querySelector('#alive-bg-enable-gi-toggle'),
                'enable_color_bleed',
                'Light spread'
            );
            bindToggleListener(
                block.querySelector('#alive-bg-enable-flicker-toggle'),
                'enable_flicker',
                'Flicker'
            );

            syncInjectedSettingsControls();
        }

        function hookSettingsButtonOnce() {
            if (settingsButtonHooked) return;

            const btn = document.getElementById('vn-settings-btn');
            if (!btn) return;

            btn.addEventListener('click', () => {
                // Modal content may be moved/rebuilt by core.
                setTimeout(ensureSettingsUiInjected, 0);
            });

            settingsButtonHooked = true;
        }

        function applySettings(mySettings) {
            if (!mySettings) return;

            if (!window.ALIVE_BG_SETTINGS) {
                window.ALIVE_BG_SETTINGS = {};
            }
            Object.assign(window.ALIVE_BG_SETTINGS, mySettings);
            ensureDefaultSettings();

            if (window.__ALIVE_PIPELINE) {
                window.__ALIVE_PIPELINE.update(window.ALIVE_BG_SETTINGS);
            }

            if (window.__ALIVE_BG && typeof window.__ALIVE_BG.onSettingsUpdated === 'function') {
                window.__ALIVE_BG.onSettingsUpdated(window.ALIVE_BG_SETTINGS);
            }

            syncInjectedSettingsControls();
        }

        async function bootstrapCurrentBackground() {
            const runtimeState = window.ALIVE_BG_STATE || window.state;
            const background = runtimeState?.currentBackground;
            if (!background) return;
            if (!window.__ALIVE_BG) return;

            debugLog(`[Alive BG] Bootstrapping current background analysis for: ${background}`);
            const result = await window.__ALIVE_BG.analyzeBackground?.(background, {
                isVideo: /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(String(background))
            });
            const hintResult = result?.hintResult;
            const depthResult = result?.depthResult;

            if (hintResult?.status === 'rejected') {
                debugLog(`[Alive BG] Bootstrap light-hint failed: ${hintResult.reason?.message || hintResult.reason || 'unknown error'}`);
            }
            if (depthResult?.status === 'rejected') {
                debugLog(`[Alive BG] Bootstrap depth failed: ${depthResult.reason?.message || depthResult.reason || 'unknown error'}`);
            }
        }

        function pollForEngine() {
            if (window.VN && window.__ALIVE_PIPELINE) {
                initPlugin();
            } else {
                setTimeout(pollForEngine, 100);
            }
        }

        function initPlugin() {
            debugLog('[Alive BG] Initializing system...');
            ensureDefaultSettings();

            window.__ALIVE_PIPELINE.init();
            hookSettingsButtonOnce();
            ensureSettingsUiInjected();

            // Sync settings from backend
            runtime.onSocket('vn-settings-updated', (allSettings) => {
                const mySettings = allSettings.plugins?.vn_alive_bg || allSettings.vn_alive_bg;
                if (mySettings) {
                    applySettings(mySettings);
                    debugLog('[Alive BG] Settings synced');
                }
            });

            runtime.onSocket('plugin:settings-updated:vn_alive_bg', (mySettings) => {
                applySettings(mySettings);
                debugLog('[Alive BG] Targeted settings synced');
            });

            runtime.onSocket('vn-alive-bg:asset-deleted', async (payload) => {
                const sources = Array.isArray(payload?.sources) ? payload.sources : [];
                if (!sources.length) return;
                if (!window.__ALIVE_BG || typeof window.__ALIVE_BG.invalidateDepthForSource !== 'function') return;

                const uniqueSources = [...new Set(sources)];
                for (const src of uniqueSources) {
                    try {
                        await window.__ALIVE_BG.invalidateDepthForSource(src);
                    } catch (error) {
                        debugLog(`[Alive BG] Failed to invalidate cache for "${src}": ${error?.message || error}`);
                    }
                }

                debugLog(`[Alive BG] Invalidated depth cache for deleted asset: ${uniqueSources[0]}`);
            });

            bootstrapCurrentBackground().catch((error) => {
                debugLog(`[Alive BG] Bootstrap analysis failed: ${error?.message || error}`);
            });

            debugLog('[Alive BG] Plugin fully active.');
        }

        // Start polling
        pollForEngine();

        // Custom dispose
        runtime.onDispose(() => {
            // Resources are handled by ALIVE_PIPELINE, but we can call an update if needed
        });

    }); // End of register
})(context);

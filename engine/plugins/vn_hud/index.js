const fs = require('fs/promises');
const path = require('path');

const PANEL_VISIBILITY_SETTING_KEY = 'vn_hud.panel_visibility';

function normalizePanelPreferences(value) {
    const source = value && typeof value === 'object' ? value : {};
    const normalized = {};
    for (const [key, raw] of Object.entries(source)) {
        const id = String(key || '').trim();
        if (!id) continue;
        normalized[id] = raw !== false;
    }
    return normalized;
}

module.exports = {
    id: 'vn_hud',
    name: 'VN HUD Plugin',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Visual',
    wizard: {
        include: true,
        order: 620,
        group: 'Visual',
        label: 'VN HUD',
        recommended_enabled: true,
        author_note: 'Recommended if you want world, character, and relationship state visible during play.',
        enabled_note: 'Adds an extensible HUD surface for maps, statuses, relationship info, and plugin panels.',
        disabled_note: 'The VN view stays cleaner but loses integrated state panels and HUD extensions.',
        settings_note: 'Tune HUD presentation and extension behavior in plugin settings.'
    },
    description: 'Provides a managed on-canvas HUD for compact plugin panels, fullscreen views, and shared information modals.',
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'A managed on-canvas layer for the minimap, story threads, world status, relationships, characters, inventory, and other compact HUD panels.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Owns left and right edge docks over the VN canvas. Plugins register independently collapsible panels while the HUD preserves per-project visibility, responsive behavior, fullscreen takeovers, shared modals, and priority ordering.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'None',
            immersion: 'Medium',
            cost: 'None',
            latency: 'None'
        }
    },
    socketListeners: {
        'vn-hud:get-panel-preferences': async (_data, tools) => {
            try {
                const rows = await tools.db.project.query(
                    'SELECT setting_value FROM project_settings WHERE setting_key = ?',
                    [PANEL_VISIBILITY_SETTING_KEY]
                );
                let preferences = {};
                if (rows?.[0]?.setting_value) {
                    try {
                        preferences = normalizePanelPreferences(JSON.parse(rows[0].setting_value));
                    } catch {
                        preferences = {};
                    }
                }
                tools.socket.emit('vn-hud:get-panel-preferences-response', {
                    success: true,
                    preferences
                });
            } catch (error) {
                tools.logger.error('VN HUD', 'Failed to load panel preferences:', error);
                tools.socket.emit('vn-hud:get-panel-preferences-response', {
                    success: false,
                    error: error.message,
                    preferences: {}
                });
            }
        },
        'vn-hud:save-panel-preferences': async (data, tools) => {
            try {
                const preferences = normalizePanelPreferences(data?.preferences);
                await tools.db.project.execute(
                    'INSERT OR REPLACE INTO project_settings (setting_key, setting_value) VALUES (?, ?)',
                    [PANEL_VISIBILITY_SETTING_KEY, JSON.stringify(preferences)]
                );
                tools.socket.emit('vn-hud:save-panel-preferences-response', {
                    success: true,
                    preferences
                });
            } catch (error) {
                tools.logger.error('VN HUD', 'Failed to save panel preferences:', error);
                tools.socket.emit('vn-hud:save-panel-preferences-response', {
                    success: false,
                    error: error.message
                });
            }
        }
    },
    hooks: {
        'HOOK_FRONTEND_INJECTION': {
            priority: 20,
            mode: 'parallel',
            run: async (context, tools) => {
                try {
                    const htmlPath = path.join(__dirname, 'ui.html');
                    const cssPath = path.join(__dirname, 'ui.css');
                    const jsPath = path.join(__dirname, 'ui.js');

                    const [html, css, js] = await Promise.all([
                        fs.readFile(htmlPath, 'utf8'),
                        fs.readFile(cssPath, 'utf8'),
                        fs.readFile(jsPath, 'utf8')
                    ]);

                    return { id: 'vn_hud', html, css, js };
                } catch (error) {
                    tools.logger.error('Frontend', 'Failed to read frontend injection files for vn_hud:', error);
                    return null;
                }
            }
        },
        'HOOK_CHAT_DB_INITIALIZED': {
            priority: 10,
            mode: 'background',
            run: async (context, tools) => {
                // Auto-push data to frontend when a new DB is loaded
                tools.socket.emit('vn-hud-force-refresh');
            }
        }
    }
};

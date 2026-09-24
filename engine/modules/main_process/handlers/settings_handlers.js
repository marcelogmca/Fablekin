const path = require('path');
const providerPresets = require('../../llm_provider_presets.json');
const { applyStarterProfile, normalizeProviderKey } = require('../../model_routing.js');

let providerSecretSaveQueue = Promise.resolve();

const DEFAULT_VN_SETTINGS = {
    audio: { ost_volume: 0.5, tts_volume: 0.5, bgm_sfx_volume: 0.3, sfx_volume: 0.5 },
    visuals: { sprite_offset: 0, dialogue_width: 100, dialogue_height: 200, toolbar_vertical_offset: 0, panel_transparency: 0.75, panel_blur: 10, font_size_multiplier: 1.0, sprite_size_multiplier: 1.0, sprite_horizontal_padding: 0, max_sprite_slots: 5, foreground_background_blur_strength: 0, write_speed: 30 },
    interface: { text_alignment: 'center', auto_play_delay: 500, natural_conversation_timing: true },
    performance: { max_fps: 60 }
};

function canonicalizeGlobalPath(settingPath) {
    if (settingPath === 'theme') return 'infrastructure.theme';
    if (settingPath === 'socket_port') return 'infrastructure.socket_port';
    if (settingPath === 'socket_host') return 'infrastructure.socket_host';
    if (settingPath === 'socket_url') return 'infrastructure.socket_url';
    return settingPath;
}

function isBlockedCharacterSheetSummarizerPath(settingPath) {
    return settingPath === 'narrative_agents.summarizer.character_sheet_model'
        || settingPath === 'narrative_agents.summarizer.character_sheet_provider';
}

function createSettingsHandlers({
    fs,
    engineDir,
    io,
    emitResponse,
    Logger,
    updateSettings,
    readSettings,
    getProjectName,
    secureStorage,
    keyMapping,
    patchSettingsWithSecrets
}) {
    async function applyProviderProfile(provider) {
        const providerKey = normalizeProviderKey(provider);
        const profile = providerPresets[providerKey];
        if (!profile) {
            throw new Error(`No starter profile is available for provider '${providerKey}'.`);
        }

        const settings = readSettings() || {};
        const routes = applyStarterProfile(settings, providerKey, profile);
        const aliases = settings.infrastructure.llm_routing.aliases;
        const saved = await updateSettings('infrastructure.llm_routing.aliases', aliases);
        if (!saved) {
            throw new Error(`Failed to persist the starter profile for provider '${providerKey}'.`);
        }

        io.emit('global-setting-updated', {
            path: 'infrastructure.llm_routing.aliases',
            value: aliases
        });
        return routes;
    }

    const handlers = {
        async getAvailableThemes(socket) {
            try {
                const themesDir = path.join(engineDir, 'themes');
                const files = await fs.readdir(themesDir);
                const themes = files.filter(f => f.endsWith('.css'));
                socket.emit('get-available-themes-response', { success: true, themes });
            } catch (error) {
                Logger.error('Main', 'SettingsMgmt', 'Error listing themes', error);
                socket.emit('get-available-themes-response', { success: false, error: error.message });
            }
        },

        async updateTheme(socket, { theme }) {
            try {
                await handlers._applyThemeSideEffects(theme);

                socket.emit('update-theme-response', { success: true });
            } catch (error) {
                Logger.error('Main', 'SettingsMgmt', 'Error updating theme', error);
                socket.emit('update-theme-response', { success: false, error: error.message });
            }
        },

        async getGlobalSettings(socket) {
            try {
                const settings = readSettings() || {};
                if (settings.narrative_agents?.summarizer) {
                    delete settings.narrative_agents.summarizer.character_sheet_model;
                    delete settings.narrative_agents.summarizer.character_sheet_provider;
                }
                socket.emit('get-global-settings-response', { success: true, settings });
            } catch (error) {
                socket.emit('get-global-settings-response', { success: false, error: error.message });
            }
        },

        async saveVNSettings(socket, { vnSettings }) {
            try {
                // 1. Handle persistence for settings that live in the root 'plugins' key
                if (vnSettings.plugins) {
                    for (const [pluginId, pSettings] of Object.entries(vnSettings.plugins)) {
                        await updateSettings(`plugins.${pluginId}`, pSettings);
                    }
                }

                // 2. Persist the core visual_novel.settings (exclude the plugin clones)
                const coreVNSettings = { ...vnSettings };
                delete coreVNSettings.plugins;
                await updateSettings('visual_novel.settings', coreVNSettings);

                const projectName = getProjectName();
                io.emit('vn-settings-updated', { ...vnSettings, projectName });
                emitResponse('save-vn-settings-response', { success: true });
                Logger.log('Main', 'SettingsMgmt', `Saved VN settings globally (including plugins).`);
            } catch (error) {
                Logger.error('Main', 'SettingsMgmt', 'Error saving VN settings', error);
                emitResponse('save-vn-settings-response', { success: false, error: error.message });
            }
        },

        async getVNSettings(_socket) {
            try {
                const allSettings = readSettings();
                const vnSettings = allSettings.visual_novel?.settings || { ...DEFAULT_VN_SETTINGS };

                // Merge root-level plugin settings for the viewer context
                if (allSettings.plugins) {
                    vnSettings.plugins = {
                        sprite_shading: allSettings.plugins.sprite_shading
                    };
                }

                emitResponse('get-vn-settings-response', { success: true, vnSettings });
            } catch (error) {
                Logger.error('Main', 'SettingsMgmt', 'Error getting VN settings', error);
                emitResponse('get-vn-settings-response', { success: false, error: error.message });
            }
        },

        async getProviderSecrets(socket) {
            try {
                const systemSecrets = secureStorage.getPluginSecrets('system');
                const providersStatus = {};

                for (const key of Object.keys(keyMapping)) {
                    if (key.endsWith('_API_KEY')) {
                        providersStatus[key] = !!systemSecrets[key];
                    }
                }

                socket.emit('get-provider-secrets-response', { success: true, providersStatus });
            } catch (error) {
                Logger.error('Main', 'SettingsMgmt', 'Error getting provider secrets status', error);
                socket.emit('get-provider-secrets-response', { success: false, error: error.message });
            }
        },

        async saveProviderSecret(socket, { key, value }) {
            providerSecretSaveQueue = providerSecretSaveQueue.then(async () => {
                try {
                    if (!keyMapping[key]) throw new Error(`Invalid provider key: ${key}`);

                    const systemSecrets = secureStorage.getPluginSecrets('system') || {};
                    const hadProviderKey = Object.keys(keyMapping).some(secretKey =>
                        secretKey.endsWith('_API_KEY') && !!systemSecrets[secretKey]
                    );

                    await secureStorage.setSecret('system', key, value);
                    patchSettingsWithSecrets({ [key]: value });

                    let starterProvider = null;
                    const providerKey = normalizeProviderKey(keyMapping[key]?.[2]);
                    if (!hadProviderKey && key.endsWith('_API_KEY') && providerPresets[providerKey]) {
                        await applyProviderProfile(providerKey);
                        starterProvider = providerKey;
                    }

                    socket.emit('save-provider-secret-response', { success: true, starterProvider });
                    Logger.log('Main', 'SettingsMgmt', `Provider secret ${key} saved securely.`);
                } catch (error) {
                    Logger.error('Main', 'SettingsMgmt', `Error saving provider secret for ${key}`, error);
                    socket.emit('save-provider-secret-response', { success: false, error: error.message });
                }
            });
            return await providerSecretSaveQueue;
        },

        async applyProviderStarterProfile(socket, { provider }) {
            try {
                const providerKey = normalizeProviderKey(provider);
                const routes = await applyProviderProfile(providerKey);
                socket.emit('apply-provider-starter-profile-response', {
                    success: true,
                    provider: providerKey,
                    routes
                });
            } catch (error) {
                socket.emit('apply-provider-starter-profile-response', { success: false, error: error.message });
            }
        },
        async updateGlobalSetting(socket, { path: settingPath, value }) {
            try {
                const canonicalPath = canonicalizeGlobalPath(settingPath);
                if (isBlockedCharacterSheetSummarizerPath(canonicalPath)) {
                    socket.emit('update-global-setting-response', {
                        success: false,
                        error: 'Character sheet settings are not supported in summarizer module.'
                    });
                    return;
                }
                const saved = await updateSettings(canonicalPath, value);
                if (!saved) {
                    throw new Error(`Failed to persist setting "${canonicalPath}" to disk.`);
                }

                // Handle side-effects for specific settings
                if (canonicalPath === 'infrastructure.theme') {
                    await handlers._applyThemeSideEffects(value);
                }

                // Broadcast the update so other views can stay in sync
                io.emit('global-setting-updated', { path: canonicalPath, value });
                socket.emit('update-global-setting-response', { success: true, path: canonicalPath });
            } catch (error) {
                Logger.error('Main', 'SettingsMgmt', `Error updating global setting ${settingPath}`, error);
                socket.emit('update-global-setting-response', { success: false, error: error.message });
            }
        },

        /**
         * Helper to synchronize the theme file and broadcast the update.
         */
        async _applyThemeSideEffects(theme) {
            try {
                // Ensure the setting is updated (if called via updateTheme)
                await updateSettings('infrastructure.theme', theme);

                // Copy the selected theme to active/global.css
                const themesDir = path.join(engineDir, 'themes');
                const activeDir = path.join(themesDir, 'active');
                const sourcePath = path.join(themesDir, theme);
                const targetPath = path.join(activeDir, 'global.css');

                await fs.mkdir(activeDir, { recursive: true });
                await fs.copyFile(sourcePath, targetPath);
                Logger.log('Main', 'SettingsMgmt', `Copied ${theme} to active/global.css`);
                
                // Broadcast for UI updates
                io.emit('theme-updated', { theme });
            } catch (error) {
                Logger.error('Main', 'SettingsMgmt', `Failed to apply theme side effects: ${error.message}`);
                throw error;
            }
        }
    };
    return handlers;
}

module.exports = {
    createSettingsHandlers
};

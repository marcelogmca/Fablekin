const { listModelAliases } = require('../../model_routing.js');
const METRIC_VALUES = new Set(['None', 'Low', 'Medium', 'High', 'Critical']);

const MODEL_ALIAS_NOTES = {
    veryhighendmodel: 'Best available reasoning and planning. Reserve for the Writer or high-stakes story decisions.',
    highendmodel: 'Strong general-purpose intelligence. Good for orchestration, analysis helpers, and quality-sensitive work.',
    mediumendmodel: 'Balanced cost and quality. Good for secondary analysis and cleanup.',
    lowendmodel: 'Fast and inexpensive. Best for simple classification, audits, or utility tasks.'
};
const MODEL_TIER_ORDER = ['lowendmodel', 'mediumendmodel', 'highendmodel', 'veryhighendmodel'];

function normalizeMetricValue(value) {
    const text = String(value || 'None').trim();
    if (!text) return 'None';
    const normalized = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    return METRIC_VALUES.has(normalized) ? normalized : text;
}

function normalizeMetrics(raw = {}) {
    return {
        narrative_impact: normalizeMetricValue(raw.narrative_impact),
        immersion: normalizeMetricValue(raw.immersion),
        cost: normalizeMetricValue(raw.cost),
        latency: normalizeMetricValue(raw.latency)
    };
}

function titleFromId(id) {
    return String(id || '')
        .split('_')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Unnamed';
}

function normalizeWizard(rawWizard = {}, fallback = {}) {
    const wizard = rawWizard && typeof rawWizard === 'object' ? rawWizard : {};
    return {
        include: wizard.include !== false,
        order: Number.isFinite(Number(wizard.order)) ? Number(wizard.order) : fallback.order,
        group: wizard.group || fallback.group || 'General',
        label: wizard.label || fallback.label || titleFromId(fallback.id),
        recommended_enabled: wizard.recommended_enabled !== undefined
            ? !!wizard.recommended_enabled
            : fallback.recommended_enabled,
        author_note: wizard.author_note || fallback.author_note || '',
        enabled_note: wizard.enabled_note || fallback.enabled_note || '',
        disabled_note: wizard.disabled_note || fallback.disabled_note || '',
        settings_note: wizard.settings_note || fallback.settings_note || '',
        toggleable: wizard.toggleable !== undefined ? !!wizard.toggleable : fallback.toggleable
    };
}

function providerHasConfiguredKey(providerId, secureStorage, keyMapping) {
    const systemSecrets = secureStorage.getPluginSecrets('system') || {};
    const secretKey = Object.keys(keyMapping || {}).find(key => {
        const pathParts = keyMapping[key] || [];
        return pathParts[0] === 'infrastructure'
            && pathParts[1] === 'providers'
            && pathParts[2] === providerId
            && pathParts[pathParts.length - 1] === 'apiKey';
    });

    if (secretKey && systemSecrets[secretKey]) return true;
    if (providerId === 'ollama') return true;
    return false;
}

function getModelAliases(settings = {}) {
    return listModelAliases(settings).map(item => ({
        alias: item.alias,
        note: MODEL_ALIAS_NOTES[item.alias] || item.description,
        provider: item.provider || '',
        model: item.model || '',
        valid: item.valid
    }));
}

function normalizeCoreModules(settings) {
    const agents = settings?.narrative_agents || {};
    return Object.entries(agents)
        .map(([id, agent], index) => {
            const wizard = normalizeWizard(agent?.wizard, {
                id,
                order: index * 10,
                group: id === 'writer' || id === 'director' ? 'Narrative' : 'Core',
                label: titleFromId(id),
                recommended_enabled: agent?.enabled !== false,
                author_note: agent?.description || '',
                enabled_note: agent?.description || '',
                disabled_note: agent?.disabled_behavior || '',
                settings_note: 'Fine-tune this module in Settings when you want deeper control.',
                toggleable: id !== 'writer'
            });

            if (!wizard.include) return null;

            return {
                id,
                label: wizard.label,
                group: wizard.group,
                order: wizard.order,
                description: agent?.description || '',
                disabled_behavior: agent?.disabled_behavior || '',
                metrics: normalizeMetrics(agent?.metrics),
                enabled: id === 'writer' ? true : agent?.enabled !== false,
                locked: id === 'writer',
                toggleable: id !== 'writer' && wizard.toggleable !== false,
                recommended_enabled: wizard.recommended_enabled,
                wizard
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function normalizePlugin(plugin) {
    const metrics = normalizeMetrics(plugin?.settingsSchema?.PLUGIN_METRICS);
    const metricsSchema = plugin?.settingsSchema?.PLUGIN_METRICS || {};
    const settingsKeys = plugin?.settingsSchema
        ? Object.keys(plugin.settingsSchema).filter(key => key !== 'PLUGIN_METRICS' && plugin.settingsSchema[key]?.type !== 'metrics')
        : [];
    const wizard = normalizeWizard(plugin?.wizard, {
        id: plugin.id,
        order: 100,
        group: plugin.category || 'Plugins',
        label: plugin.name || titleFromId(plugin.id),
        recommended_enabled: plugin.enabled,
        author_note: metricsSchema.description || metricsSchema.recommendation || plugin.description || '',
        enabled_note: plugin.description || '',
        disabled_note: 'This plugin will not participate in the generation pipeline or contribute its UI/runtime features.',
        settings_note: metricsSchema.recommendation || 'Open the Plugin Manager for detailed plugin settings.',
        toggleable: true
    });

    if (!wizard.include) return null;

    return {
        id: plugin.id,
        name: plugin.name || plugin.id,
        label: wizard.label,
        group: wizard.group,
        order: wizard.order,
        description: plugin.description || '',
        author: plugin.author || 'Unknown',
        category: plugin.category || 'Uncategorized',
        version: plugin.version || '1.0.0',
        enabled: !!plugin.enabled,
        isTestPlugin: !!plugin.isTestPlugin,
        isExamplePlugin: !!plugin.isExamplePlugin,
        experimental: !!plugin.experimental,
        isDeveloperPlugin: !!plugin.isDeveloperPlugin,
        dependencies: plugin.dependencies || [],
        optionalDependencies: plugin.optionalDependencies || [],
        screenshots: plugin.screenshots || [],
        hasSettings: settingsKeys.length > 0,
        metrics,
        recommended_enabled: wizard.recommended_enabled,
        wizard
    };
}

async function checkOllama(settings) {
    const ollama = settings?.infrastructure?.providers?.ollama || {};
    const baseUrl = ollama.base_url || 'http://127.0.0.1:11434';
    let timer = null;

    try {
        const controller = new globalThis.AbortController();
        timer = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(baseUrl, { method: 'HEAD', signal: controller.signal });
        return {
            reachable: response.ok || response.status === 404,
            status: response.ok || response.status === 404 ? 'reachable' : 'offline',
            base_url: baseUrl,
            model: ollama.model || '',
            statusCode: response.status
        };
    } catch (error) {
        return {
            reachable: false,
            status: 'offline',
            base_url: baseUrl,
            model: ollama.model || '',
            error: error?.name === 'AbortError' ? 'Timed out' : (error?.message || 'Connection failed')
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function createHomeHandlers({
    Logger,
    io,
    path,
    shell,
    readSettings,
    pluginManager,
    secureStorage,
    keyMapping
}) {
    return {
        async getHomeSetupData(socket, _data, callback) {
            try {
                const settings = readSettings() || {};
                const providers = settings.infrastructure?.providers || {};
                const providerStatus = Object.entries(providers).map(([id, config]) => ({
                    id,
                    configured: providerHasConfiguredKey(id, secureStorage, keyMapping),
                    hasModels: getModelAliases(settings).some(alias => alias.provider === id && alias.valid),
                    base_url: id === 'ollama' ? (config.base_url || '') : undefined
                })).sort((a, b) => a.id.localeCompare(b.id));

                await pluginManager.refreshPluginPreviews();
                const plugins = pluginManager.getAllPluginsMetadata()
                    .filter(plugin => !plugin.isDeveloperPlugin)
                    .map(normalizePlugin)
                    .filter(Boolean)
                    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

                const payload = {
                    success: true,
                    providers: providerStatus,
                    modelAliases: getModelAliases(settings),
                    ollama: await checkOllama(settings),
                    coreModules: normalizeCoreModules(settings),
                    plugins,
                    settings: {
                        narrative_agents: {
                            writer: {
                                enable_chain_of_thought: settings.narrative_agents?.writer?.enable_chain_of_thought !== false
                            }
                        }
                    },
                    notes: {
                        provider_author_note: 'Start with one reliable paid provider for the Writer and Director, then move smaller helpers to cheaper aliases once the story feels stable.',
                        memory_author_note: 'Memory LoD is powerful, but you do not need to tune it on day one. The defaults are meant to keep long stories manageable while you learn the rest of Fablekin.'
                    }
                };

                if (typeof callback === 'function') callback(payload);
                else socket.emit('get-home-setup-data-response', payload);
            } catch (error) {
                Logger.error('Main', 'Home', 'Failed to build Home setup data', error);
                const response = { success: false, error: error.message };
                if (typeof callback === 'function') callback(response);
                else socket.emit('get-home-setup-data-response', response);
            }
        },

        async checkOllamaStatus(socket, _data, callback) {
            const response = {
                success: true,
                ollama: await checkOllama(readSettings() || {})
            };
            if (typeof callback === 'function') callback(response);
            else socket.emit('check-ollama-status-response', response);
        },

        openSettingsSection(_socket, payload = {}) {
            io.emit('switch-tab', { tab: 'settings_manager' });
            io.emit('settings-manager:open-section', payload || {});
            setTimeout(() => io.emit('settings-manager:open-section', payload || {}), 150);
        },

        openPluginSettings(_socket, payload = {}) {
            io.emit('switch-tab', { tab: 'plugins' });
            io.emit('plugin-manager:open-settings', payload || {});
            setTimeout(() => io.emit('plugin-manager:open-settings', payload || {}), 150);
        },

        async openWriterCotFile(_socket, _payload = {}, callback) {
            try {
                const promptPath = path.resolve(__dirname, '../../../prompts/writer_chain_of_thought.txt');
                const errorMessage = await shell.openPath(promptPath);
                if (errorMessage) {
                    throw new Error(errorMessage);
                }
                const response = { success: true, path: promptPath };
                if (typeof callback === 'function') callback(response);
                else _socket.emit('open-writer-cot-file-response', response);
            } catch (error) {
                Logger.error('Main', 'Home', 'Failed to open Writer CoT file', error);
                const response = { success: false, error: error.message };
                if (typeof callback === 'function') callback(response);
                else _socket.emit('open-writer-cot-file-response', response);
            }
        },

        async openDirectorPromptFolder(_socket, _payload = {}, callback) {
            try {
                const promptPath = path.resolve(__dirname, '../../../prompts/director');
                const errorMessage = await shell.openPath(promptPath);
                if (errorMessage) {
                    throw new Error(errorMessage);
                }
                const response = { success: true, path: promptPath };
                if (typeof callback === 'function') callback(response);
                else _socket.emit('open-director-prompt-folder-response', response);
            } catch (error) {
                Logger.error('Main', 'Home', 'Failed to open Director prompt folder', error);
                const response = { success: false, error: error.message };
                if (typeof callback === 'function') callback(response);
                else _socket.emit('open-director-prompt-folder-response', response);
            }
        }
    };
}

module.exports = {
    createHomeHandlers
};

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getPlugin(pluginManager, pluginId) {
    return pluginManager?.plugins?.get(pluginId)
        || pluginManager?.disabledPlugins?.get(pluginId)
        || null;
}

function createLlmModelRegistry({ pluginManager, readSettings, resolveModelAlias }) {
    const buildAssignment = ({ scope, ownerId, role, settingKey, label, model, enabled, inheritedFrom = null, definition = null }) => {
        const modelAlias = String(model || '').trim();
        if (!modelAlias) return null;
        const resolved = resolveModelAlias(modelAlias);
        return {
            scope, ownerId, role, settingKey,
            label: label || role,
            enabled: enabled !== false,
            model: modelAlias,
            provider: resolved.provider,
            resolvedModel: resolved.model,
            subprovider: resolved.subprovider || null,
            inheritedFrom,
            definition: definition || { model: modelAlias }
        };
    };

    const getCoreModels = (moduleId = null) => {
        const agents = (readSettings() || {}).narrative_agents || {};
        const assignments = [];
        for (const [agentId, agent] of Object.entries(agents)) {
            if (moduleId && agentId !== moduleId) continue;
            if (!isObject(agent)) continue;
            for (const [settingKey, rawModel] of Object.entries(agent)) {
                if (settingKey !== 'model' && !settingKey.endsWith('_model')) continue;
                const role = settingKey === 'model' ? 'main' : settingKey.slice(0, -'_model'.length);
                const assignment = buildAssignment({
                    scope: 'core', ownerId: agentId, role, settingKey,
                    label: role === 'main' ? 'Main' : role,
                    model: isObject(rawModel) ? rawModel.model : rawModel,
                    enabled: agentId === 'writer' || agent.enabled !== false
                });
                if (assignment) assignments.push(assignment);
            }
        }
        return assignments.sort((a, b) => a.ownerId.localeCompare(b.ownerId) || a.role.localeCompare(b.role));
    };

    const getCoreModel = (moduleId, role = 'main') => {
        if (!moduleId) return null;
        const assignment = getCoreModels(moduleId).find(item => item.role === role || item.settingKey === role) || null;
        if (assignment || moduleId !== 'vn_background_tasks') return assignment;
        return buildAssignment({
            scope: 'core', ownerId: 'vn_background_tasks', role: 'main', settingKey: 'model',
            label: 'VN Background Tasks', model: 'highendmodel', enabled: true
        });
    };

    const getPluginModels = (pluginId = null) => {
        const settings = readSettings() || {};
        const pluginIds = pluginId ? [pluginId] : Array.from(new Set([
            ...Array.from(pluginManager?.plugins?.keys?.() || []),
            ...Array.from(pluginManager?.disabledPlugins?.keys?.() || [])
        ]));
        const assignments = [];
        for (const targetPluginId of pluginIds) {
            const plugin = getPlugin(pluginManager, targetPluginId);
            if (!plugin || !isObject(plugin.settingsSchema)) continue;
            const persisted = isObject(settings.plugins?.[targetPluginId]) ? settings.plugins[targetPluginId] : {};
            for (const [settingKey, schema] of Object.entries(plugin.settingsSchema)) {
                if (!isObject(schema)) continue;
                if (schema.options !== 'llm-aliases' && schema.isLlmAlias !== true) continue;
                const rawValue = persisted[settingKey] !== undefined ? persisted[settingKey] : schema.default;
                let model;
                let inheritedFrom = null;
                let definition = null;
                if (isObject(rawValue) && rawValue.inherit === 'vn_background') {
                    const shared = getCoreModel('vn_background_tasks');
                    if (!shared) continue;
                    model = shared.model;
                    inheritedFrom = 'vn_background';
                    definition = { inherit: 'vn_background' };
                } else {
                    model = isObject(rawValue) ? rawValue.model : rawValue;
                }
                const assignment = buildAssignment({
                    scope: 'plugin', ownerId: targetPluginId, role: settingKey, settingKey,
                    label: schema.label || settingKey, model,
                    enabled: pluginManager?.plugins?.has(targetPluginId), inheritedFrom, definition
                });
                if (assignment) assignments.push(assignment);
            }
        }
        return assignments.sort((a, b) => a.ownerId.localeCompare(b.ownerId) || a.role.localeCompare(b.role));
    };

    const getPluginModel = (pluginId, settingKey = 'model_def') => {
        if (!pluginId || !settingKey) return null;
        return getPluginModels(pluginId).find(item => item.settingKey === settingKey || item.role === settingKey) || null;
    };

    const resolveDefinition = (definition) => {
        if (isObject(definition) && definition.inherit === 'vn_background') {
            const assignment = getCoreModel('vn_background_tasks');
            return assignment ? { ...assignment, inheritedFrom: 'vn_background', definition: { inherit: 'vn_background' } } : null;
        }
        const model = isObject(definition) ? definition.model : definition;
        if (!model) return null;
        return buildAssignment({
            scope: 'definition', ownerId: null, role: 'main', settingKey: null,
            model, enabled: true, definition: { model: String(model) }
        });
    };

    return { getCoreModel, getCoreModels, getPluginModel, getPluginModels, resolveDefinition };
}

module.exports = { createLlmModelRegistry };

const fs = require('fs/promises');
const path = require('path');
const JSON5 = require('json5');
const { Logger } = require('../../utils.js');
const { discoverPluginScreenshots } = require('./plugin_preview_discovery.js');

function getDependencyId(dependency) {
    return typeof dependency === 'string' ? dependency : dependency?.id;
}

function extractObjectLiteralByKey(content, keyName) {
    if (typeof content !== 'string' || !content) return null;
    const keyRegex = new RegExp(`\\b${keyName}\\b\\s*:`, 'm');
    const keyMatch = keyRegex.exec(content);
    if (!keyMatch) return null;

    const colonIndex = content.indexOf(':', keyMatch.index);
    if (colonIndex === -1) return null;
    let objectStart = colonIndex + 1;
    while (objectStart < content.length && /\s/.test(content[objectStart])) {
        objectStart++;
    }
    if (content[objectStart] !== '{') return null;

    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escape = false;

    for (let i = objectStart; i < content.length; i++) {
        const ch = content[i];
        const next = content[i + 1];

        if (inLineComment) {
            if (ch === '\n') inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inSingle) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '\'') {
                inSingle = false;
            }
            continue;
        }

        if (inDouble) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"') {
                inDouble = false;
            }
            continue;
        }

        if (inTemplate) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '`') {
                inTemplate = false;
            }
            continue;
        }

        if (ch === '/' && next === '/') {
            inLineComment = true;
            i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }

        if (ch === '\'') {
            inSingle = true;
            continue;
        }
        if (ch === '"') {
            inDouble = true;
            continue;
        }
        if (ch === '`') {
            inTemplate = true;
            continue;
        }

        if (ch === '{') {
            depth++;
            continue;
        }
        if (ch === '}') {
            depth--;
            if (depth === 0) {
                return content.slice(objectStart, i + 1);
            }
        }
    }

    return null;
}

function attachSafePluginMetrics(metadata, contents) {
    if (metadata?.settingsSchema?.PLUGIN_METRICS) return true;

    for (const content of contents) {
        const metricsLiteral = extractObjectLiteralByKey(content, 'PLUGIN_METRICS');
        if (!metricsLiteral) continue;
        try {
            if (!metadata.settingsSchema || typeof metadata.settingsSchema !== 'object') {
                metadata.settingsSchema = {};
            }
            metadata.settingsSchema.PLUGIN_METRICS = JSON5.parse(metricsLiteral);
            return true;
        } catch {
            // Continue scanning other static sources.
        }
    }

    return false;
}

/**
 * Safely reads plugin metadata from index.js without executing code using regex.
 * @param {string} pluginPath 
 * @returns {Promise<Object|null>}
 */
async function readPluginMetadataSafely(pluginPath, pluginsDir = null) {
    try {
        const entryPoint = path.join(pluginPath, 'index.js');
        const content = await fs.readFile(entryPoint, 'utf8');
        const moduleExportsIndex = content.search(/module\.exports\s*=/);
        const metadataContent = moduleExportsIndex >= 0 ? content.slice(moduleExportsIndex) : content;

        const metadata = {
            // A dynamic manifest ID falls back to the folder name; do not mistake a nested dependency ID for it.
            id: extractRegex(metadataContent, /module\.exports\s*=\s*\{\s*id:\s*['"]([^'"]+)['"]/),
            name: extractRegex(metadataContent, /name:\s*['"]([^'"]+)['"]/),
            author: extractRegex(metadataContent, /author:\s*['"]([^'"]+)['"]/),
            version: extractRegex(metadataContent, /version:\s*['"]([^'"]+)['"]/),
            description: extractRegex(metadataContent, /description:\s*['"]([^'"]+)['"]/),
            dependencies: [],
            optionalDependencies: []
        };

        const depMatch = metadataContent.match(/dependencies:\s*(\[[^\]]*\])/);
        if (depMatch) {
            try { metadata.dependencies = JSON5.parse(depMatch[1]); } catch { }
        }
        const optDepMatch = metadataContent.match(/optionalDependencies:\s*(\[[^\]]*\])/);
        if (optDepMatch) {
            try { metadata.optionalDependencies = JSON5.parse(optDepMatch[1]); } catch { }
        }

        metadata.isTestPlugin = extractRegex(metadataContent, /isTestPlugin:\s*(true|false)/) === 'true';
        metadata.isExamplePlugin = extractRegex(metadataContent, /isExamplePlugin:\s*(true|false)/) === 'true';
        metadata.experimental = extractRegex(metadataContent, /experimental:\s*(true|false)/) === 'true';
        metadata.isDeveloperPlugin = metadata.isTestPlugin || metadata.isExamplePlugin || metadata.experimental;

        metadata.category = extractRegex(metadataContent, /category:\s*['"`]([^'"`]+)['"`]/) || 'Uncategorized';

        const schemaLiteral = extractObjectLiteralByKey(metadataContent, 'settingsSchema');
        if (schemaLiteral) {
            try {
                metadata.settingsSchema = JSON5.parse(schemaLiteral);
            } catch {
                Logger.warn('PluginManager', `Found settingsSchema in ${path.basename(pluginPath)} but could not parse it safely.`);
            }
        }

        if (!metadata.settingsSchema?.PLUGIN_METRICS) {
            let logicContent = '';
            try {
                logicContent = await fs.readFile(path.join(pluginPath, 'logic.js'), 'utf8');
            } catch {
                // Not every plugin uses a separate logic module.
            }
            attachSafePluginMetrics(metadata, [content, logicContent]);
        }

        const wizardLiteral = extractObjectLiteralByKey(metadataContent, 'wizard');
        if (wizardLiteral) {
            try {
                metadata.wizard = JSON5.parse(wizardLiteral);
            } catch {
                Logger.warn('PluginManager', `Found wizard metadata in ${path.basename(pluginPath)} but could not parse it safely.`);
            }
        }

        if (!metadata.id) {
            metadata.id = path.basename(pluginPath);
        }

        metadata._pluginPath = pluginPath;
        metadata.screenshots = await discoverPluginScreenshots(pluginPath, pluginsDir || path.dirname(pluginPath), Logger);

        return metadata;
    } catch (error) {
        Logger.warn('PluginManager', `Failed to safely read metadata from ${pluginPath}:`, error.message);
        return null;
    }
}

function extractRegex(content, regex) {
    const match = content.match(regex);
    return match ? match[1] : null;
}

/**
 * Scans for plugins and initializes them.
 */
async function initializePlugins(pluginManager, pluginsDir) {
    try {
        await fs.access(pluginsDir).catch(() => {
            Logger.log('PluginManager', `Plugins directory not found at ${pluginsDir}, creating it.`);
            return fs.mkdir(pluginsDir, { recursive: true });
        });

        const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
        const pluginRegistry = [];
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== 'disabled') {
                const pPath = path.join(pluginsDir, entry.name);
                const meta = await readPluginMetadataSafely(pPath, pluginsDir);
                if (meta && meta.id) {
                    pluginRegistry.push({ path: pPath, meta });
                }
            }
        }

        let changed = true;
        const toLoad = [...pluginRegistry];
        const loadedIds = new Set();

        while (changed && toLoad.length > 0) {
            changed = false;
            for (let i = 0; i < toLoad.length; i++) {
                const { path: pPath, meta } = toLoad[i];
                const deps = (meta.dependencies || []).map(getDependencyId).filter(Boolean);
                const allDepsMet = deps.every(id => loadedIds.has(id));

                if (allDepsMet) {
                    const loaded = await pluginManager.loadPlugin(pPath);
                    if (loaded === true && pluginManager.plugins.has(meta.id)) {
                        loadedIds.add(meta.id);
                        toLoad.splice(i, 1);
                        i--;
                        changed = true;
                    } else {
                        Logger.warn('PluginManager', `Plugin '${meta.id}' did not register successfully; dependencies will remain unavailable.`);
                    }
                }
            }
        }

        for (const { meta } of toLoad) {
            const missing = (meta.dependencies || []).map(getDependencyId).filter(id => id && !loadedIds.has(id));
            const bootError = missing.length > 0
                ? `Missing dependencies: ${missing.join(', ')}`
                : 'Plugin failed to load or register.';
            Logger.warn('PluginManager', `CRITICAL: Could NOT boot plugin '${meta.id || meta.name}'. ${bootError}`);

            if (meta.id) {
                pluginManager.disabledPlugins.set(meta.id, {
                    ...meta,
                    enabled: false,
                    bootError
                });
            }
        }

        const disabledDir = path.join(pluginsDir, 'disabled');
        await fs.access(disabledDir).catch(() => fs.mkdir(disabledDir, { recursive: true }));

        const disabledEntries = await fs.readdir(disabledDir, { withFileTypes: true });
        for (const entry of disabledEntries) {
            if (entry.isDirectory()) {
                const metadata = await readPluginMetadataSafely(path.join(disabledDir, entry.name), pluginsDir);
                if (metadata && metadata.id) {
                    pluginManager.disabledPlugins.set(metadata.id, metadata);
                }
            }
        }

        Logger.log('PluginManager', `Initialization complete. Loaded ${pluginManager.plugins.size} active and ${pluginManager.disabledPlugins.size} disabled plugins.`);
    } catch (error) {
        Logger.error('PluginManager', 'Failed to initialize plugins:', error);
    }
}

async function findPluginDirName(baseDir, pluginId) {
    const pluginsDir = path.basename(baseDir) === 'disabled' ? path.dirname(baseDir) : baseDir;
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'disabled') {
            const metadata = await readPluginMetadataSafely(path.join(baseDir, entry.name), pluginsDir);
            if (metadata && metadata.id === pluginId) return entry.name;
        }
    }
    return null;
}

module.exports = {
    readPluginMetadataSafely,
    initializePlugins,
    findPluginDirName
};

const fs = require('fs/promises');
const path = require('path');

const SCREENSHOT_PATTERN = /^screenshot([1-9])\.(webp|gif|png|jpg)$/i;
const FORMAT_PRIORITY = Object.freeze({ webp: 0, gif: 1, png: 2, jpg: 3 });

function buildPluginAssetUrl(pluginPath, pluginsDir, filename) {
    const relativeDirectory = path.relative(pluginsDir, pluginPath)
        .split(path.sep)
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
    return `/plugins/${relativeDirectory}/${encodeURIComponent(filename)}`;
}

async function discoverPluginScreenshots(pluginPath, pluginsDir, logger = null) {
    if (!pluginPath || !pluginsDir) return [];

    let entries;
    try {
        entries = await fs.readdir(pluginPath, { withFileTypes: true });
    } catch {
        return [];
    }

    const selected = new Map();
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const match = entry.name.match(SCREENSHOT_PATTERN);
        if (!match) continue;

        const index = Number(match[1]);
        const format = match[2].toLowerCase();
        const candidate = { index, filename: entry.name, format };
        const existing = selected.get(index);
        if (!existing || FORMAT_PRIORITY[format] < FORMAT_PRIORITY[existing.format]) {
            if (existing) {
                logger?.warn?.('PluginManager', `Multiple screenshots found for ${path.basename(pluginPath)} slot ${index}; using ${entry.name}.`);
            }
            selected.set(index, candidate);
        } else {
            logger?.warn?.('PluginManager', `Multiple screenshots found for ${path.basename(pluginPath)} slot ${index}; keeping ${existing.filename}.`);
        }
    }

    return Array.from(selected.values())
        .sort((a, b) => a.index - b.index)
        .map(screenshot => ({
            ...screenshot,
            url: buildPluginAssetUrl(pluginPath, pluginsDir, screenshot.filename)
        }));
}

module.exports = { discoverPluginScreenshots };

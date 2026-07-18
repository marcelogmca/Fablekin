const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { discoverPluginScreenshots } = require('./plugin_preview_discovery.js');

async function makeFixture(files) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fablekin-plugin-preview-'));
    const pluginsDir = path.join(root, 'plugins');
    const pluginDir = path.join(pluginsDir, 'disabled', 'example plugin');
    await fs.mkdir(pluginDir, { recursive: true });
    await Promise.all(files.map(filename => fs.writeFile(path.join(pluginDir, filename), 'preview')));
    return { root, pluginsDir, pluginDir };
}

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        throw error;
    }
}

runTest('discovers supported filenames case-insensitively in numeric order', async () => {
    const fixture = await makeFixture(['screenshot9.jpg', 'SCREENSHOT2.GIF', 'screenshot1.webp', 'screenshot0.png', 'preview.png']);
    try {
        const screenshots = await discoverPluginScreenshots(fixture.pluginDir, fixture.pluginsDir);
        assert.deepStrictEqual(screenshots.map(item => [item.index, item.filename, item.format]), [
            [1, 'screenshot1.webp', 'webp'],
            [2, 'SCREENSHOT2.GIF', 'gif'],
            [9, 'screenshot9.jpg', 'jpg']
        ]);
        assert.strictEqual(screenshots[0].url, '/plugins/disabled/example%20plugin/screenshot1.webp');

        const activePluginDir = path.join(fixture.pluginsDir, 'active plugin');
        await fs.mkdir(activePluginDir);
        await fs.writeFile(path.join(activePluginDir, 'screenshot1.png'), 'preview');
        const activeScreenshots = await discoverPluginScreenshots(activePluginDir, fixture.pluginsDir);
        assert.strictEqual(activeScreenshots[0].url, '/plugins/active%20plugin/screenshot1.png');
    } finally {
        await fs.rm(fixture.root, { recursive: true, force: true });
    }
});

runTest('uses the documented format priority and reports duplicate slots', async () => {
    const fixture = await makeFixture(['screenshot3.jpg', 'screenshot3.png', 'screenshot3.gif', 'screenshot3.webp']);
    const warnings = [];
    try {
        const screenshots = await discoverPluginScreenshots(fixture.pluginDir, fixture.pluginsDir, {
            warn: (...args) => warnings.push(args)
        });
        assert.deepStrictEqual(screenshots, [{
            index: 3,
            filename: 'screenshot3.webp',
            format: 'webp',
            url: '/plugins/disabled/example%20plugin/screenshot3.webp'
        }]);
        assert.strictEqual(warnings.length, 3);
    } finally {
        await fs.rm(fixture.root, { recursive: true, force: true });
    }
});

runTest('returns no previews when the plugin directory is missing', async () => {
    const screenshots = await discoverPluginScreenshots(path.join(os.tmpdir(), 'missing-fablekin-plugin'), path.join(os.tmpdir(), 'plugins'));
    assert.deepStrictEqual(screenshots, []);
});

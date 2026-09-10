const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('plugin webviews resolve through the runtime HTTP server instead of file URLs', () => {
    const source = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
    assert.match(source, /window\.getAppServerUrl/);
    assert.match(source, /new URL\(view\.entry, `\$\{appServerUrl\}\//);
    assert.doesNotMatch(source, /const pluginViewUrl = `\$\{view\.entry\}\?/);
});

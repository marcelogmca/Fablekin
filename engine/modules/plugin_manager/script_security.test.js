const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ScriptSecurity = require('./script_security.js');

test('normalizes line endings when hashing Story Script content', () => {
    assert.equal(
        ScriptSecurity.hashContent('first\r\nsecond\r\n'),
        ScriptSecurity.hashContent('first\nsecond\n')
    );
});

test('readScript returns the exact content associated with its hash', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fablekin-story-script-'));
    const filePath = path.join(tempDir, 'example.md');
    const content = '```js\nmodule.exports = { hooks: {} };\n```\n';

    try {
        await fs.writeFile(filePath, content, 'utf8');
        const script = await ScriptSecurity.readScript(filePath);

        assert.equal(script.content, content);
        assert.equal(script.hash, ScriptSecurity.hashContent(content));
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

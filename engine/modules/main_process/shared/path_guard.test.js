const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isPathInsideRoot } = require('./path_guard.js');

test('rejects ordinary path traversal', () => {
    assert.equal(isPathInsideRoot('C:/project/../outside/file.txt', 'C:/project'), false);
    assert.equal(isPathInsideRoot('C:/project/content/file.txt', 'C:/project'), true);
});

test('rejects a junction or symlink that escapes the root', async (t) => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fablekin-project-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fablekin-outside-'));
    const linkedPath = path.join(projectRoot, 'linked-outside');

    try {
        try {
            await fs.symlink(outsideRoot, linkedPath, 'junction');
        } catch (error) {
            t.skip(`Junctions are unavailable in this environment: ${error.code || error.message}`);
            return;
        }

        assert.equal(isPathInsideRoot(path.join(linkedPath, 'secret.txt'), projectRoot), false);
    } finally {
        await fs.rm(projectRoot, { recursive: true, force: true });
        await fs.rm(outsideRoot, { recursive: true, force: true });
    }
});

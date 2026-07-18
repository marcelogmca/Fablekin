const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateStoryScript } = require('./story_script_evaluator.js');

test('evaluates CommonJS exports without Node host globals', () => {
    const result = evaluateStoryScript(`
        module.exports = {
            requireType: typeof require,
            processType: typeof process,
            bufferType: typeof Buffer,
            consolePrototypeIsNull: Object.getPrototypeOf(console) === null,
            logPrototypeIsNull: Object.getPrototypeOf(console.log) === null
        };
    `);

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
        requireType: 'undefined',
        processType: 'undefined',
        bufferType: 'undefined',
        consolePrototypeIsNull: true,
        logPrototypeIsNull: true
    });
});

test('blocks string-based code generation', () => {
    const result = evaluateStoryScript(`
        let blocked = false;
        try { eval('1 + 1'); } catch { blocked = true; }
        module.exports = { blocked };
    `);

    assert.equal(result.blocked, true);
});

test('times out blocking module initialization', () => {
    assert.throws(
        () => evaluateStoryScript('while (true) {}', { timeoutMs: 20 }),
        error => error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
    );
});

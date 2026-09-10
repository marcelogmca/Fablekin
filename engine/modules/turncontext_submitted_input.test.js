const assert = require('node:assert/strict');
const test = require('node:test');
const TurnContext = require('./turncontext.js');

test('submitted VN inputs survive serialization independently of pipeline prompt mutations', () => {
    const context = new TurnContext('Submitted Input Test');
    context.input.userPrompt = 'Original action';
    context.input.directorPrompt = 'Hard direction';
    context.input.softFeedback = 'Soft direction';
    context.input.submitted = {
        userPrompt: context.input.userPrompt,
        directorPrompt: context.input.directorPrompt,
        softFeedback: context.input.softFeedback
    };

    context.input.userPrompt = 'SYSTEM-ADDED PREFIX\nOriginal action';
    const snapshot = context.serialize();

    assert.deepEqual(snapshot.input.submitted, {
        userPrompt: 'Original action',
        directorPrompt: 'Hard direction',
        softFeedback: 'Soft direction'
    });
});

const assert = require('node:assert');
const test = require('node:test');
const logic = require('./logic.js');

test('dialogue context prioritizes lines spoken by the character', () => {
    const dialogue = [
        'Narrator: Chiori waits by the door.',
        'Aether: Chiori, are you coming?',
        '  CHIORI : "Give me a moment."',
        'Chiori: "All right, let us go."'
    ].join('\n');

    const context = logic.extractRelevantContext(dialogue, 'Chiori', 2, 0);

    assert.equal(context, '  CHIORI : "Give me a moment."\nChiori: "All right, let us go."');
});

test('dialogue context falls back to character mentions when they do not speak', () => {
    const dialogue = [
        'Narrator: Chiori waits by the door.',
        'Aether: Chiori, are you coming?',
        'Paimon: We should wait for her.'
    ].join('\n');

    const context = logic.extractRelevantContext(dialogue, 'Chiori', 2, 0);

    assert.equal(context, 'Narrator: Chiori waits by the door.\nAether: Chiori, are you coming?');
});

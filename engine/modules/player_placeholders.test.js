const assert = require('assert');
const { replacePlayerPlaceholders } = require('./player_placeholders.js');

assert.strictEqual(
    replacePlayerPlaceholders('[USER_CHARACTER] meets <USER_CHARACTER>.', { playerName: 'Mira' }),
    'Mira meets Mira.'
);

assert.strictEqual(
    replacePlayerPlaceholders('[USER_SUBJECT_CAP] keep [USER_POSSESSIVE] word for [USER_OBJECT].'),
    'They keep their word for them.'
);

assert.strictEqual(
    replacePlayerPlaceholders('[USER_SUBJECT] chose the path [USER_REFLEXIVE].', {
        pronouns: { subject: 'she', reflexive: 'herself' }
    }),
    'she chose the path herself.'
);

assert.strictEqual(
    replacePlayerPlaceholders('[USER_CHARACTER]', { fallbackName: 'the protagonist' }),
    'the protagonist'
);

console.log('player_placeholders tests passed');
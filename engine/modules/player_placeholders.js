const PLAYER_PLACEHOLDER_PATTERN = /(\x5B|<)(USER_CHARACTER|USER_SUBJECT|USER_OBJECT|USER_POSSESSIVE|USER_POSSESSIVE_PRONOUN|USER_REFLEXIVE)(_CAP)?(\x5D|>)/gi;

const DEFAULT_PRONOUNS = Object.freeze({
    subject: 'they',
    object: 'them',
    possessive: 'their',
    possessivePronoun: 'theirs',
    reflexive: 'themselves'
});

function cleanValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function capitalizeFirst(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function replacePlayerPlaceholders(text, options = {}) {
    if (typeof text !== 'string' || !text) return text;

    const pronouns = options.pronouns && typeof options.pronouns === 'object'
        ? options.pronouns
        : {};
    const replacements = {
        USER_CHARACTER: cleanValue(options.playerName) || cleanValue(options.fallbackName) || 'the protagonist',
        USER_SUBJECT: cleanValue(pronouns.subject) || DEFAULT_PRONOUNS.subject,
        USER_OBJECT: cleanValue(pronouns.object) || DEFAULT_PRONOUNS.object,
        USER_POSSESSIVE: cleanValue(pronouns.possessive || pronouns.possessiveAdjective) || DEFAULT_PRONOUNS.possessive,
        USER_POSSESSIVE_PRONOUN: cleanValue(pronouns.possessivePronoun) || DEFAULT_PRONOUNS.possessivePronoun,
        USER_REFLEXIVE: cleanValue(pronouns.reflexive) || DEFAULT_PRONOUNS.reflexive
    };

    return text.replace(PLAYER_PLACEHOLDER_PATTERN, (match, opening, token, capitalization, closing) => {
        if ((opening === '[' && closing !== ']') || (opening === '<' && closing !== '>')) return match;
        const replacement = replacements[String(token).toUpperCase()];
        return capitalization ? capitalizeFirst(replacement) : replacement;
    });
}

module.exports = {
    DEFAULT_PRONOUNS,
    replacePlayerPlaceholders
};
/**
 * Character Sheets - Sanitizer Library
 * Handles cleaning up LLM JSON outputs, specifically flattening nested objects/arrays into strings.
 */

function flattenValue(value) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (Array.isArray(value)) {
        return value.map(flattenValue).join(', ');
    }
    if (typeof value === 'object' && value !== null) {
        // Convert object to "key: value" pairs
        return Object.entries(value)
            .map(([k, v]) => `${k}: ${flattenValue(v)}`)
            .join('; ');
    }
    return String(value);
}

function sanitizeCharacter(char) {
    const cleanChar = { ...char };

    // Normalize keys
    if (cleanChar.Name && !cleanChar.name) { cleanChar.name = cleanChar.Name; delete cleanChar.Name; }
    if (cleanChar.character_name && !cleanChar.name) { cleanChar.name = cleanChar.character_name; delete cleanChar.character_name; }

    // Ensure name is flattened (e.g. if it came as an array ["Name"])
    if (cleanChar.name) {
        cleanChar.name = flattenValue(cleanChar.name);
    }

    // Skip 'name' and metadata, sanitize content fields
    for (const key in cleanChar) {
        if (key === 'name' || key === 'status') continue;
        cleanChar[key] = flattenValue(cleanChar[key]);
    }
    return cleanChar;
}

function sanitizeBatch(characters) {
    if (!Array.isArray(characters)) return [];
    return characters.map(sanitizeCharacter);
}

module.exports = {
    flattenValue,
    sanitizeCharacter,
    sanitizeBatch
};
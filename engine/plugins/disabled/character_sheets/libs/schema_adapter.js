const fs = require('fs/promises');
const path = require('path');

let schemaCache = null;

function getFieldPriority(field) {
    const direct = typeof field?.priority === 'string' ? field.priority : '';
    const behavior = typeof field?.behavior?.priority === 'string' ? field.behavior.priority : '';
    return (direct || behavior || 'normal').trim().toLowerCase();
}

async function loadSchema() {
    if (schemaCache) return schemaCache;
    const schemaPath = path.join(__dirname, '../schema.json');
    const content = await fs.readFile(schemaPath, 'utf-8');
    schemaCache = JSON.parse(content);
    return schemaCache;
}

function getFields(schema, mode = 'full') {
    // Mode can be 'full', 'lite', 'minimum', direct resolution integer, or settings labels
    let maxResolution = 3;

    if (typeof mode === 'number') {
        maxResolution = mode;
    } else {
        switch (mode.toLowerCase()) {
            case 'low':
            case 'minimum':
                maxResolution = 1;
                break;
            case 'medium':
            case 'lite':
                maxResolution = 2;
                break;
            case 'high':
            case 'full':
            default:
                maxResolution = 3;
                break;
        }
    }

    return schema.fields.filter(f => f.resolution <= maxResolution);
}

function generatePromptSchema(fields) {
    const base = fields.map((f, index) => {
        const priority = getFieldPriority(f);
        const priorityLine = priority === 'hard' ? '\nPriority: hard (must remain stable and may be repeated as late prompt continuity)' : '';
        return `LAYER ${index}: ${f.label}${priorityLine}\nInstructions: ${f.instructions}`;
    }).join('\n\n');

    // Always append Aliases as a core requirement
    return base + `\n\nALIASES\nInstructions: List known aliases, nicknames, or titles (comma-separated). ONLY include distinguishable (non-generic titles) aliases and in a straight forward manner. E.g. "King", "Big Sis", "Boss of Fortune (called by Beatrice)", "Master (as refered to by...)", are all BAD aliases. If no meaningful identifiers exist, return an empty string (do NOT use placeholders like "N/A" or "None").`;
}

function generateList(fields) {
    return fields.map((f, index) => {
        const priority = getFieldPriority(f);
        const suffix = priority === 'hard' ? ' [priority=hard]' : '';
        return `- LAYER ${index}: ${f.label}${suffix}`;
    }).join('\n');
}

function generateJsonStructure(fields) {
    const struct = {};
    // Always include name
    struct['name'] = "Character Name";
    fields.forEach(f => {
        struct[f.id] = `[${f.label}]`;
    });
    // Always include aliases in JSON structure
    struct['aliases'] = "Alias1, Alias2, or empty string";
    return JSON.stringify(struct, null, 2);
}

function getPredicateToIdMap(fields) {
    const map = {};
    fields.forEach(f => {
        if (f.predicate) map[f.predicate] = f.id;
    });
    return map;
}

module.exports = {
    loadSchema,
    getFields,
    generatePromptSchema,
    generateList,
    generateJsonStructure,
    getPredicateToIdMap
};

/**
 * Character Sheets - Parser Library
 * Handles string manipulation, section extraction, and fuzzy SEARCH/REPLACE patching.
 */
const stringSimilarity = require('string-similarity');
const schemaAdapter = require('./schema_adapter.js'); // Assuming schema_adapter.js is in the same directory

function getDetailInstruction(detailLevel) {
    switch (detailLevel) {
        case 'Medium': return "DETAIL LEVEL (Medium): Provide a balanced and descriptive summary. Use 3-4 descriptive sentences per section (aim for ~200-300 words total).";
        case 'High': return "DETAIL LEVEL (High): Provide an extensive and detailed summary. Use rich, evocative language (aim for ~500 words total).";
        case 'Low': default: return "DETAIL LEVEL (Low): Be concise but informative. Use 1-2 clear sentences per section (max ~100 words total).";
    }
}

async function parseCharacterSheet(tools, text, metadata = {}) {
    tools.logger.runtime(`parser: parseCharacterSheet, text length=${text?.length || 0}`);
    const schema = await schemaAdapter.loadSchema();
    const fields = schemaAdapter.getFields(schema, 'full'); // Use all fields to parse whatever is there

    const capsule = {
        metadata: {
            name: '', source_file: '', content_hash: '',
            first_turn_appeared: null, last_updated_turn: 0, ...metadata
        }
    };

    // Initialize fields based on schema
    fields.forEach(f => {
        capsule[f.id] = '';
    });
    // Add aliases (not in schema explicitly but handled in old parser)
    capsule.aliases = '';

    const nameMatch = text.match(/PYRAMID OF PERSONA:\s*([^\n\r]+)/i);
    if (nameMatch) {
        capsule.metadata.name = nameMatch[1].trim();
        tools.logger.runtime(`parseCharacterSheet: Extracted character name '${capsule.metadata.name}'`);
    }

    // Construct regexes dynamically based on schema
    // The old parser had specific headers like "LAYER 0: HIGH-LEVEL SUMMARY".
    // We'll construct regexes that are flexible about the layer number but match the label.
    // e.g. /LAYER \d+:\s*HIGH-LEVEL SUMMARY/i
    
    const sections = fields.map(f => ({
        key: f.id,
        // Match "LAYER X: LABEL" or just "LABEL" if layer number is missing/flexible
        header: new RegExp(`(?:LAYER\\s*\\d*:\\s*)?${escapeRegExp(f.label)}`, 'i')
    }));

    // Add explicit handling for ALIASES if needed, though it might be better in schema
    sections.push({ key: 'aliases', header: /ALIASES:/i });

    const positions = sections.map(s => ({ key: s.key, pos: text.search(s.header) }))
        .filter(p => p.pos !== -1).sort((a, b) => a.pos - b.pos);

    tools.logger.runtime(`parseCharacterSheet: Identified ${positions.length} sections`);

    for (let i = 0; i < positions.length; i++) {
        const start = positions[i].pos;
        const end = (i + 1 < positions.length) ? positions[i + 1].pos : text.length;
        
        // Find the end of the header line to start capturing content
        const headerMatch = text.substring(start).match(/^[^\n\r]*[\r\n]+/);
        const contentStart = start + (headerMatch ? headerMatch[0].length : 0);
        
        let chunk = text.substring(contentStart, end).trim();
        if (chunk) {
            capsule[positions[i].key] = chunk;
            // No verbose dump of chunk content
        }
    }
    return capsule;
}

function parseTaggedSections(text, tools = null) {
    if (tools?.logger?.runtime) {
        tools.logger.runtime(`parser: parseTaggedSections, text length=${text?.length || 0}`);
    }
    const sections = {};
    const regex = /\[([A-Z_]+)\]:?([\s\S]*?)(?=\[|$)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        sections[match[1]] = match[2].trim();
    }
    if (tools?.logger?.runtime) {
        tools.logger.runtime(`parseTaggedSections: Extracted ${Object.keys(sections).length} tagged sections`);
    }
    return sections;
}

function getFieldAnchor(searchStr) {
    const match = String(searchStr || '').trim().match(/^\[([a-z][a-z0-9_]*)\]$/i);
    return match ? match[1].toLowerCase() : '';
}

function replaceFieldValueById(currentText, field, replaceStr, tools) {
    const headerRegex = new RegExp(`(^|\\n)(LAYER\\s*\\d+\\s*:\\s*${escapeRegExp(field.label)}(?:\\s*\\[READ-ONLY\\])?\\s*)\\r?\\n`, 'i');
    const match = headerRegex.exec(currentText);
    if (!match) {
        tools.logger.runtime(`replaceFieldValueById: Could not find field header for ${field.id}`);
        return { applied: false, text: currentText };
    }

    const valueStart = match.index + match[0].length;
    const nextHeaderRegex = /\nLAYER\s*\d+\s*:/gi;
    nextHeaderRegex.lastIndex = valueStart;
    const nextMatch = nextHeaderRegex.exec(currentText);
    const rawEnd = nextMatch ? nextMatch.index + 1 : currentText.length;

    let valueEnd = rawEnd;
    while (valueEnd > valueStart && /\s/.test(currentText[valueEnd - 1])) valueEnd--;

    return {
        applied: true,
        text: `${currentText.slice(0, valueStart)}${String(replaceStr || '').trim()}${currentText.slice(valueEnd)}`
    };
}

function applySearchReplacePatches(currentText, patchScript, tools, options = {}) {
    tools.logger.runtime(`parser: applySearchReplacePatches, script length=${patchScript?.length || 0}`);
    if (!currentText) {
        tools.logger.runtime('applySearchReplacePatches: No current text provided, returning patch script');
        return patchScript;
    }
    const patchRegex = /<<<<<<< SEARCH\s*[\r\n]+([\s\S]*?)[\r\n]+=======\s*[\r\n]+([\s\S]*?)[\r\n]+>>>>>>> REPLACE/g;
    const fieldMap = new Map((options.fields || []).map(field => [field.id.toLowerCase(), field]));
    const mutableFieldIds = options.mutableFieldIds
        ? new Set(Array.from(options.mutableFieldIds).map(id => String(id).toLowerCase()))
        : null;
    let updatedText = currentText;
    let match;
    let patchCount = 0;
    let fuzzyCount = 0;
    let fieldAnchorCount = 0;

    while ((match = patchRegex.exec(patchScript)) !== null) {
        let searchStr = match[1].trim();
        let replaceStr = match[2].trim();
        if (!searchStr && !replaceStr) continue;

        const fieldAnchor = getFieldAnchor(searchStr);
        if (fieldAnchor && fieldMap.size > 0) {
            const field = fieldMap.get(fieldAnchor);
            if (!field) {
                tools.logger.runtime(`applySearchReplacePatches: Unknown field anchor [${fieldAnchor}]`);
                continue;
            }
            if (mutableFieldIds && !mutableFieldIds.has(field.id.toLowerCase())) {
                tools.logger.runtime(`applySearchReplacePatches: Field anchor [${field.id}] is read-only for this update`);
                continue;
            }

            const result = replaceFieldValueById(updatedText, field, replaceStr, tools);
            if (result.applied) {
                updatedText = result.text;
                patchCount++;
                fieldAnchorCount++;
            }
            continue;
        }

        if (updatedText.includes(searchStr)) {
            updatedText = updatedText.replace(searchStr, replaceStr);
            patchCount++;
            continue;
        }

        const lines = updatedText.split(/\r?\n/);
        const searchLines = searchStr.split(/\r?\n/);
        const windowSize = searchLines.length;
        let bestScore = 0;
        let bestText = '';

        for (let i = 0; i <= lines.length - windowSize; i++) {
            const currentWindow = lines.slice(i, i + windowSize).join('\n');
            const score = stringSimilarity.compareTwoStrings(currentWindow, searchStr);
            if (score > bestScore) {
                bestScore = score;
                bestText = currentWindow;
            }
        }
        if (bestScore > 0.75) {
            updatedText = updatedText.replace(bestText, replaceStr);
            patchCount++;
            fuzzyCount++;
        } else {
            tools.logger.runtime(`applySearchReplacePatches: Failed to apply patch (best score: ${bestScore.toFixed(2)})`);
        }
    }
    tools.logger.runtime(`applySearchReplacePatches: Applied ${patchCount} patches (${fuzzyCount} fuzzy, ${fieldAnchorCount} field anchors)`);
    return updatedText;
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(16);
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    getDetailInstruction, parseCharacterSheet,
    parseTaggedSections, applySearchReplacePatches, simpleHash
};

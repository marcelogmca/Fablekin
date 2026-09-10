const levenshtein = require('js-levenshtein');

const OUTCOMES = new Set(['MAPPED', 'UNMAPPED', 'AMBIGUOUS']);
const STOP_WORDS = new Set(['a', 'an', 'at', 'in', 'of', 'on', 'the', 'to', 'toward', 'towards']);

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitAliases(value, output = []) {
    if (Array.isArray(value)) {
        value.forEach(item => splitAliases(item, output));
    } else if (typeof value === 'string' || typeof value === 'number') {
        String(value).split(/[,\n;|]+/).map(item => item.trim()).filter(Boolean).forEach(item => output.push(item));
    }
    return output;
}

function nodeAliases(node) {
    const values = [];
    for (const key of ['name', 'displayName', 'display_name', 'label', 'alias', 'aliases', 'altName', 'alt_name', 'altNames', 'alt_names', 'alternateName', 'alternate_name', 'alternateNames', 'alternate_names', 'shortName', 'short_name', 'commonName', 'common_name', 'commonNames', 'common_names']) {
        splitAliases(node?.[key], values);
    }
    return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function exactNode(nodes, mention) {
    const normalized = normalizeText(mention);
    if (!normalized) return null;
    const matches = (nodes || []).filter(node => String(node?.uid || '').toLowerCase() === String(mention || '').trim().toLowerCase()
        || nodeAliases(node).includes(normalized));
    return matches.length === 1 ? matches[0] : null;
}

function tokenSet(value) {
    return new Set(normalizeText(value).split(' ').filter(token => token && !STOP_WORDS.has(token)));
}

function overlapScore(left, right) {
    if (!left.size || !right.size) return 0;
    let intersection = 0;
    for (const token of left) if (right.has(token)) intersection += 1;
    return intersection / new Set([...left, ...right]).size;
}

function stringScore(query, candidate) {
    if (!query || !candidate) return 0;
    const maxLength = Math.max(query.length, candidate.length);
    const edit = maxLength ? 1 - (levenshtein(query, candidate) / maxLength) : 0;
    const containment = candidate.includes(query) || query.includes(candidate)
        ? Math.min(query.length, candidate.length) / maxLength
        : 0;
    return Math.max(edit * 0.7, containment * 0.95, overlapScore(tokenSet(query), tokenSet(candidate)) * 0.9);
}

function rankCandidates(nodes, mention, limit = 5) {
    const query = normalizeText(mention);
    if (!query) return [];
    return (nodes || []).map(node => {
        const aliasScore = Math.max(0, ...nodeAliases(node).map(alias => stringScore(query, alias)));
        const metadata = [node?.type, node?.region, node?.parent_nation, node?.tags, node?.description].filter(Boolean).join(' ');
        const metadataScore = overlapScore(tokenSet(query), tokenSet(metadata)) * 0.45;
        return { node, score: Math.max(aliasScore, metadataScore) };
    }).filter(item => item.score >= 0.18)
        .sort((left, right) => right.score - left.score || String(left.node.name).localeCompare(String(right.node.name)))
        .slice(0, Math.max(1, limit));
}

function collectReferences(result, previousNavigationState = null) {
    const byMention = new Map();
    const add = (id, kind, mention, evidenceLine = 0) => {
        const normalized = normalizeText(mention);
        if (!normalized) return;
        if (!byMention.has(normalized)) byMention.set(normalized, { key: normalized, mention: String(mention).trim(), references: [] });
        byMention.get(normalized).references.push({ id, kind, evidence_line: Number(evidenceLine || 0) });
    };

    for (const [index, event] of (Array.isArray(result?.location_events) ? result.location_events : []).entries()) {
        add(`event:${index}:anchor`, 'anchor', event.anchor_reference || event.anchor_node || event.location, event.line);
        if (String(event.status || '').toUpperCase() === 'TRANSIT') {
            add(`event:${index}:destination`, 'destination', event.destination_mention || event.destination, event.line);
        }
    }
    const intent = result?.navigation_intent || {};
    if (['SET_JOURNEY', 'SET_LEG'].includes(String(intent.operation || '').toUpperCase())) {
        add('navigation:destination', 'navigation', intent.destination_mention || intent.destination, intent.evidence_line);
    } else if (String(intent.operation || '').toUpperCase() === 'KEEP' && previousNavigationState?.active_target?.map_status === 'ambiguous') {
        add('navigation:pending', 'navigation_pending', previousNavigationState.active_target.name, previousNavigationState.active_target.evidence_line);
    }
    const update = result?.navigation_update || {};
    for (const layerName of ['journey', 'immediate']) {
        const layer = update[layerName] || {};
        if (String(layer.operation || '').toUpperCase() === 'SET') {
            add(`navigation_update:${layerName}`, layerName, layer.destination_mention || layer.destination, layer.evidence_line);
        }
    }
    if (String(update.deliberation?.operation || '').toUpperCase() === 'REPLACE') {
        for (const [index, option] of (update.deliberation.options || []).entries()) {
            add(`navigation_update:deliberation:${index}`, 'deliberation', option.destination_mention || option.destination, option.evidence_lines?.[0]);
        }
    }
    return [...byMention.values()];
}

function validateDecision(raw, item) {
    const outcome = String(raw?.outcome || 'AMBIGUOUS').toUpperCase();
    if (!OUTCOMES.has(outcome)) return { outcome: 'ambiguous', selected_node: null };
    if (outcome !== 'MAPPED') return { outcome: outcome.toLowerCase(), selected_node: null };
    const selected = item.candidates.find(candidate => String(candidate.node.uid) === String(raw?.selected_uid));
    return selected
        ? { outcome: 'mapped', selected_node: selected.node }
        : { outcome: 'ambiguous', selected_node: null };
}

module.exports = {
    normalizeText,
    nodeAliases,
    exactNode,
    rankCandidates,
    collectReferences,
    validateDecision
};

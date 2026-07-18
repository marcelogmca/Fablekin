// engine/plugins/relationship_tracker/logic/relevance.js

const { getCurrentRelationshipStates, getRelationshipOrigins, getRelationshipHistorySummary, getRecentBeats, getCanonicalPair, getCoreCharacters } = require('./db_operations');
const { evaluatePairDynamic, evaluatePairDynamicDetailed, getDominantVector } = require('./archetypes');

/**
 * Prepares a narrative block describing current relationship states for LLM consumption.
 */
async function synthesizeTargetedRelationshipStates(tools, projectName, party = [], options = {}) {
    const maxTurn = options.turnNumber !== undefined ? options.turnNumber : null;
    const selfSettings = tools.settings.getSelf();

    const [states, origins] = await Promise.all([
        getCurrentRelationshipStates(tools, projectName, maxTurn),
        getRelationshipOrigins(tools, projectName, maxTurn)
    ]);

    if (Object.keys(states).length === 0) return 'No relationship states found.';

    const uniquePairs = new Set();
    const pairsToProcess = [];
    const sourceKeys = Object.keys(states);
    const relevantCharacters = new Set(party.map(p => p.toLowerCase()));

    for (const source of sourceKeys) {
        const targets = Object.keys(states[source]);
        for (const target of targets) {
            if (relevantCharacters.size > 0 && !relevantCharacters.has(source.toLowerCase()) && !relevantCharacters.has(target.toLowerCase())) continue;
            const [p1, p2] = getCanonicalPair(source, target);
            const pairKey = `${p1}|${p2}`;
            if (!uniquePairs.has(pairKey)) {
                uniquePairs.add(pairKey);
                pairsToProcess.push({ p1, p2 });
            }
        }
    }

    if (pairsToProcess.length === 0) return 'No notable relationship states found for the current context.';

    let narrativeBlock = '### Active Relationship Dynamics\n';
    let hasContent = false;

    for (const pair of pairsToProcess) {
        const stats = states[pair.p1] ? states[pair.p1][pair.p2] || {} : {};
        if (Object.keys(stats).length === 0) continue;

        const dynamicDescription = evaluatePairDynamic(pair.p1, pair.p2, stats);
        if (dynamicDescription) {
            narrativeBlock += `#### ${pair.p1.toUpperCase()} & ${pair.p2.toUpperCase()}\n`;
            narrativeBlock += `- **Status**: ${dynamicDescription.split(']: ')[1]}\n`;
            const pairKey = `${pair.p1}|${pair.p2}`;
            if (origins[pairKey]) narrativeBlock += `- **Foundational History**: ${origins[pairKey]}\n`;

            if (selfSettings.enable_rolling_ledger !== false) {
                const historySummary = await getRelationshipHistorySummary(tools, projectName, pair.p1, pair.p2);
                if (historySummary.text) narrativeBlock += `- **Evolution**: ${historySummary.text}\n`;
                const recentBeats = await getRecentBeats(tools, projectName, pair.p1, pair.p2, historySummary.turn, maxTurn);
                if (recentBeats.length > 0) narrativeBlock += `- **Recent Developments**:\n  * ${recentBeats.join('\n  * ')}\n`;
            }
            narrativeBlock += '\n';
            hasContent = true;
        }
    }

    return hasContent ? narrativeBlock : 'No notable relationship states found for the current context.';
}

/**
 * Calculates a relevance score for a relationship based on its vectors and current context.
 */
function calculateRelationshipRelevance(stats, options = {}) {
    const { inParty = false, prominenceIndex = -1, totalProminent = 0 } = options;
    let relevanceScore =
        (Math.max(0, stats.romance || 0) * 5.0) +
        (Math.max(0, stats.friendship || 0) * 2.5) +
        (Math.max(0, stats.trust || 0) * 1.5) +
        (Math.abs(stats.respect || 0) * 1.0) +
        (Math.abs(stats.fear || 0) * 0.5);

    if (inParty) relevanceScore += 1000;
    if (prominenceIndex !== -1) relevanceScore += (totalProminent - prominenceIndex) * 100;

    return relevanceScore;
}

/**
 * Fetches top relevant relationships for a character.
 */
async function getTopRelationships(tools, projectName, characterName, options = {}) {
    const { limit = 5, turnNumber = null, emphasizeParty = true } = options;
    const states = await getCurrentRelationshipStates(tools, projectName, turnNumber);
    const charKey = Object.keys(states).find(k => k.toLowerCase() === characterName.toLowerCase());
    if (!charKey || !states[charKey]) return [];

    const charRelationships = states[charKey];
    const results = [];
    let party = [];
    let prominent = [];

    if (emphasizeParty && tools.turnContext) {
        party = (tools.turnContext.output?.party || []).map(p => p.toLowerCase());
        prominent = (tools.turnContext.output?.prominentCharacters || []).map(p => p.toLowerCase());
    }

    const playerName = options.playerName || tools?.turnContext?.input?.playerCharacterName || null;
    const coreCharacters = await getCoreCharacters(tools, projectName, playerName);
    const sourceIsCore = coreCharacters.has(charKey.toLowerCase());
    const origins = await getRelationshipOrigins(tools, projectName, turnNumber);

    for (const targetName in charRelationships) {
        const targetKey = targetName.toLowerCase();
        const stats = charRelationships[targetName];
        const isMainRelationship = sourceIsCore && coreCharacters.has(targetKey);
        const relevance = calculateRelationshipRelevance(stats, {
            inParty: party.includes(targetKey),
            prominenceIndex: prominent.indexOf(targetKey),
            totalProminent: prominent.length
        });

        const detailed = evaluatePairDynamicDetailed(charKey, targetName, stats);
        const dominant = getDominantVector(stats);
        const history = await getRelationshipHistorySummary(tools, projectName, charKey, targetName, turnNumber);
        const [p1, p2] = getCanonicalPair(charKey, targetName);
        const origin = origins[`${p1}|${p2}`];

        results.push({
            character: targetName,
            relevance,
            detailTier: isMainRelationship ? 'main' : 'supporting',
            isMainRelationship,
            stats,
            archetype: detailed?.archetype || 'Acquaintances',
            guidance: detailed?.guidance || 'No established bond.',
            dominant,
            origin,
            evolution: history?.text
        });
    }

    const mainRelationships = results
        .filter(r => r.isMainRelationship)
        .sort((a, b) => b.relevance - a.relevance);
    const supportingRelationships = results
        .filter(r => !r.isMainRelationship)
        .sort((a, b) => b.relevance - a.relevance);

    const remainingSlots = Math.max(0, limit - mainRelationships.length);
    return [
        ...mainRelationships,
        ...supportingRelationships.slice(0, remainingSlots)
    ];
}

/**
 * Ranks all known associates of a character by State, emotional Weight, and semantic Relevance.
 */
async function getTieredRelevantRelationships(tools, turnContext, characterName, _options = {}) {
    const projectName = turnContext.projectName;
    const turnNumber = turnContext.turnNumber || 0;
    const playerCharacterName = turnContext.input.playerCharacterName || 'Player';

    const states = await getCurrentRelationshipStates(tools, projectName, turnNumber);
    const charKey = characterName.toLowerCase();
    const associatesMap = states[charKey];
    if (!associatesMap) return [];

    const party = (turnContext.output?.party || []).map(p => p.toLowerCase());
    let thematicNames = new Set();
    try {
        const lastTurnSummary = turnContext.output?.summary || "";
        const userPrompt = turnContext.input.userPrompt || "";
        const combinedQuery = `${lastTurnSummary}\n\n${userPrompt}`;

        if (combinedQuery.trim()) {
            const vectorResults = await tools.vector.query(combinedQuery, 10, null, 'social_registry');
            if (vectorResults) {
                vectorResults.forEach(res => {
                    if (res.metadata?.name) thematicNames.add(res.metadata.name.toLowerCase());
                });
            }
        }
    } catch { }

    const candidates = [];
    for (const targetName in associatesMap) {
        const targetKey = targetName.toLowerCase();
        const stats = associatesMap[targetName];
        let tier = 3;
        let priority = 0;

        const isPlayer = targetKey === playerCharacterName.toLowerCase();
        const isInParty = party.includes(targetKey);
        let isCore = false;
        try {
            const imp = await tools.db.chat.query(
                "SELECT fact_value FROM facts WHERE project_name = ? AND source = ? AND predicate = 'IMPORTANCE' AND turn_number <= ? ORDER BY turn_number DESC LIMIT 1",
                [projectName.toLowerCase(), targetKey, turnNumber]
            );
            if (imp && imp[0] && (imp[0].fact_value.toUpperCase() === 'CORE')) isCore = true;
        } catch { }

        if (isPlayer || isInParty || isCore) {
            tier = 1;
            priority = isPlayer ? 100 : (isCore ? 90 : 80);
        } else {
            const significance = Math.max(...Object.values(stats).map(v => Math.abs(v)));
            const isThematic = thematicNames.has(targetKey);
            if (significance >= 40) {
                tier = 2;
                priority = significance;
            } else if (isThematic) {
                tier = 3;
                priority = 50;
            }
        }

        if (tier <= 3 && priority > 0) {
            const detailed = evaluatePairDynamicDetailed(characterName, targetName, stats);
            candidates.push({
                name: targetName,
                tier,
                priority,
                stats,
                archetype: detailed?.archetype || 'Acquaintances',
                guidance: detailed?.guidance || 'An established bond.',
                isThematic: thematicNames.has(targetKey)
            });
        }
    }

    candidates.sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return b.priority - a.priority;
    });

    return candidates;
}

module.exports = {
    synthesizeTargetedRelationshipStates,
    calculateRelationshipRelevance,
    getTopRelationships,
    getTieredRelevantRelationships
};

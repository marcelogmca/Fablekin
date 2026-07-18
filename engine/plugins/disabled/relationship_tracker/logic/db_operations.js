// engine/plugins/relationship_tracker/logic/db_operations.js

const { getRelationshipCurveMultiplier } = require('./scoring');

/**
 * Core Character Fetcher
 */
async function getCoreCharacters(tools, projectName, playerName) {
    const coreSet = new Set();
    if (playerName && playerName !== 'None') {
        coreSet.add(playerName.toLowerCase());
    }
    try {
        const rows = await tools.db.project.query("SELECT character_name FROM character_sheets WHERE project_name = ?", [projectName.toLowerCase()]);
        for (const row of rows) {
            coreSet.add(row.character_name.toLowerCase());
        }
    } catch {
        // Fallback or ignore if no sheet integration
    }
    return coreSet;
}

async function getRelationshipDetailTier(tools, projectName, charA, charB, playerName = null) {
    let resolvedPlayerName = playerName || tools?.turnContext?.input?.playerCharacterName || null;
    if (!resolvedPlayerName) {
        try {
            const rows = await tools.db.project.query("SELECT setting_value FROM project_settings WHERE setting_key = 'player_character_name'");
            if (rows && rows.length > 0) resolvedPlayerName = rows[0].setting_value;
        } catch { }
    }

    const [p1, p2] = getCanonicalPair(charA, charB);
    const coreCharacters = await getCoreCharacters(tools, projectName, resolvedPlayerName);
    return coreCharacters.has(p1) && coreCharacters.has(p2) ? 'main' : 'supporting';
}

/**
 * Returns the canonical order for a character pair to ensure symmetry.
 */
function getCanonicalPair(charA, charB) {
    const a = charA.toLowerCase().trim();
    const b = charB.toLowerCase().trim();
    return a < b ? [a, b] : [b, a];
}

/**
 * Sets a symmetrical relationship fact in the database.
 */
async function setRelationshipFact(tools, { charA, charB, predicate, value, projectName, turnNumber, context }) {
    try {
        const [source, target] = getCanonicalPair(charA, charB);
        const contextTurnNumber = Number.isInteger(tools?.turnContext?.turnNumber) ? tools.turnContext.turnNumber : null;
        const effectiveTurnNumber = Number.isInteger(turnNumber) ? turnNumber : (contextTurnNumber ?? 0);

        let currentScore = 0;
        try {
            const row = await tools.db.chat.query(
                `SELECT SUM(fact_value) as score
                 FROM facts
                 WHERE project_name = ? AND source = ? AND target = ? AND predicate = ?
                   AND turn_number <= ?`,
                [projectName.toLowerCase(), source, target, `relationship_${predicate.toLowerCase()}`, effectiveTurnNumber]
            );
            if (row && row.length > 0 && row[0].score !== null) {
                currentScore = row[0].score;
            }
        } catch { }

        let finalDelta = value;
        const isNumericVector = ['friendship', 'romance', 'trust', 'fear', 'respect'].includes(predicate.toLowerCase());

        if (isNumericVector) {
            const multiplier = getRelationshipCurveMultiplier(currentScore, value);
            finalDelta = value * multiplier;
            if (Math.abs(finalDelta) < 0.2) finalDelta = finalDelta > 0 ? 0.2 : -0.2;
            tools.logger.runtime(`[Relation Curve] Score: ${currentScore}, Base Delta: ${value}, Multiplier: ${multiplier.toFixed(2)}x, Final Delta: ${finalDelta.toFixed(2)}`);
        }

        const MAX_CAP = 120;
        let clampedDelta = finalDelta;
        if (isNumericVector) {
            const projectedSum = currentScore + finalDelta;
            if (projectedSum > MAX_CAP) {
                clampedDelta = MAX_CAP - currentScore;
                if (clampedDelta < 0) clampedDelta = 0;
            } else if (projectedSum < -MAX_CAP) {
                clampedDelta = -MAX_CAP - currentScore;
                if (clampedDelta > 0) clampedDelta = 0;
            }
        }

        if (isNumericVector && Math.abs(clampedDelta) < 0.01) {
            tools.logger.runtime(`[Relation Cap] ${source} <-> ${target} boundary hit for ${predicate}. No change applied.`);
            return;
        }

        const scopeOverrides = (
            Number.isInteger(contextTurnNumber) && effectiveTurnNumber === contextTurnNumber
        )
            ? {}
            : {
                turn_number: effectiveTurnNumber,
                turn_key: String(effectiveTurnNumber),
                scene_mode: 'mainline',
                intermission_id: null,
                intermission_ordinal: null
            };

        const normalizedContext = context === undefined ? 'Initial relationship vector' : context;

        await tools.facts.appendToFactsDb({
            source,
            target,
            predicate: `relationship_${predicate.toLowerCase()}`,
            fact_value: clampedDelta,
            context: normalizedContext
        }, scopeOverrides);
        tools.logger.log(`Set symmetrical relationship fact for ${source} <-> ${target} [${predicate}: ${clampedDelta}]`);
        tools.logger.runtime(`Database Update: ${source} <-> ${target} | ${predicate.toUpperCase()} = ${clampedDelta > 0 ? '+' : ''}${clampedDelta.toFixed(2)}.`);
    } catch (error) {
        if (error.message.includes('Database not initialized')) {
            tools.logger.warn('Database', 'Chat database not initialized. Cannot set relationship fact.');
            tools.logger.runtime(`Database Error: Chat DB not ready.`);
            return;
        }
        tools.logger.error(`Failed to set relationship fact for ${charA} <-> ${charB}`, error);
        tools.logger.runtime(`Database Error for ${charA}/${charB}: ${error.message}`);
    }
}

/**
 * Fetches current relationship scores from the database.
 */
async function getCurrentRelationshipStates(tools, projectName, maxTurnNumber = null) {
    try {
        tools.logger.runtime(`Fetching current bond states for project '${projectName}'.`);
        const effectiveMaxTurn = Number.isInteger(maxTurnNumber)
            ? maxTurnNumber
            : (Number.isInteger(tools?.turnContext?.turnNumber) ? tools.turnContext.turnNumber : null);
        let query = `
            SELECT source, target, predicate, SUM(fact_value) as score
            FROM facts
            WHERE project_name = ? AND predicate LIKE 'relationship_%' AND predicate != 'relationship_origin'
        `;
        const params = [projectName.toLowerCase()];

        if (effectiveMaxTurn !== null && effectiveMaxTurn !== undefined) {
            query += ` AND turn_number <= ? `;
            params.push(effectiveMaxTurn);
        }

        query += ` GROUP BY source, target, predicate `;

        const rows = await tools.db.chat.query(query, params);

        const states = {};
        for (const row of rows) {
            const s = row.source;
            const t = row.target;
            const vector = row.predicate.replace('relationship_', '');

            if (!states[s]) states[s] = {};
            if (!states[s][t]) states[s][t] = {};
            states[s][t][vector] = row.score;

            if (!states[t]) states[t] = {};
            if (!states[t][s]) states[t][s] = {};
            states[t][s][vector] = row.score;
        }
        tools.logger.runtime(`Successfully retrieved ${Object.keys(states).length} character relationship maps.`);
        return states;
    } catch (error) {
        if (error.message.includes('Database not initialized')) {
            tools.logger.warn('Database', 'Chat database is not yet initialized. Returning empty states.');
            return {};
        }
        tools.logger.error('Failed to get current relationship states.', error);
        return {};
    }
}

/**
 * Fetches relationship origins from the database.
 */
async function getRelationshipOrigins(tools, projectName, maxTurnNumber = null) {
    try {
        const effectiveMaxTurn = Number.isInteger(maxTurnNumber)
            ? maxTurnNumber
            : (Number.isInteger(tools?.turnContext?.turnNumber) ? tools.turnContext.turnNumber : null);
        let query = "SELECT source, target, context FROM facts WHERE project_name = ? AND predicate = 'relationship_origin'";
        const params = [projectName.toLowerCase()];
        if (effectiveMaxTurn !== null && effectiveMaxTurn !== undefined) {
            query += " AND turn_number <= ?";
            params.push(effectiveMaxTurn);
        }
        const rows = await tools.db.chat.query(query, params);
        const origins = {};
        for (const row of rows) {
            const [p1, p2] = getCanonicalPair(row.source, row.target);
            origins[`${p1}|${p2}`] = row.context;
        }
        return origins;
    } catch {
        return {};
    }
}

/**
 * Fetches the latest history summary for a pair.
 */
async function getRelationshipHistorySummary(tools, projectName, charA, charB, maxTurnNumber = null) {
    try {
        const [p1, p2] = getCanonicalPair(charA, charB);
        const effectiveMaxTurn = Number.isInteger(maxTurnNumber)
            ? maxTurnNumber
            : (Number.isInteger(tools?.turnContext?.turnNumber) ? tools.turnContext.turnNumber : null);
        let query = "SELECT context, turn_number FROM facts WHERE project_name = ? AND source = ? AND target = ? AND predicate = 'relationship_history_summary'";
        const params = [projectName.toLowerCase(), p1, p2];
        if (effectiveMaxTurn !== null && effectiveMaxTurn !== undefined) {
            query += " AND turn_number <= ?";
            params.push(effectiveMaxTurn);
        }
        query += " ORDER BY turn_number DESC LIMIT 1";
        const rows = await tools.db.chat.query(query, params);
        return rows && rows.length > 0 ? { text: rows[0].context, turn: rows[0].turn_number } : { text: '', turn: 0 };
    } catch {
        return { text: '', turn: 0 };
    }
}

/**
 * Fetches relationship beats since a specific turn.
 */
async function getRecentBeats(tools, projectName, charA, charB, sinceTurn, maxTurnNumber = null) {
    try {
        const [p1, p2] = getCanonicalPair(charA, charB);
        const effectiveMaxTurn = Number.isInteger(maxTurnNumber)
            ? maxTurnNumber
            : (Number.isInteger(tools?.turnContext?.turnNumber) ? tools.turnContext.turnNumber : null);
        let query = `SELECT DISTINCT turn_number, context FROM facts 
             WHERE project_name = ? AND source = ? AND target = ? 
             AND predicate LIKE 'relationship_%' AND predicate != 'relationship_origin' AND predicate != 'relationship_history_summary'
             AND turn_number > ?
             AND context IS NOT NULL
             AND TRIM(context) != ''`;
        const params = [projectName.toLowerCase(), p1, p2, sinceTurn];
        if (effectiveMaxTurn !== null && effectiveMaxTurn !== undefined) {
            query += " AND turn_number <= ?";
            params.push(effectiveMaxTurn);
        }
        query += " ORDER BY turn_number ASC";
        const rows = await tools.db.chat.query(query, params);
        return rows.map(r => `Turn ${r.turn_number}: ${r.context}`);
    } catch {
        return [];
    }
}

/**
 * Purges relationship facts for a specific turn and project.
 * Follows the "Upsert-by-Turn" guideline.
 */
async function purgeRelationshipFacts(tools, projectName, turnNumber = 0) {
    try {
        tools.logger.runtime(`[Cleanup] Purging relationship facts for ${projectName} at turn ${turnNumber} scope.`);
        await tools.facts.cleanUpFactsDb({
            turn_number: turnNumber,
            turn_key: String(turnNumber),
            scene_mode: 'mainline',
            intermission_id: null,
            intermission_ordinal: null,
            predicates: ['relationship_%']
        });
        return true;
    } catch (error) {
        tools.logger.error('Database', `Failed to purge relationship facts for turn ${turnNumber}.`, error);
        return false;
    }
}

module.exports = {
    getCoreCharacters,
    getRelationshipDetailTier,
    getCanonicalPair,
    setRelationshipFact,
    getCurrentRelationshipStates,
    getRelationshipOrigins,
    getRelationshipHistorySummary,
    getRecentBeats,
    purgeRelationshipFacts
};

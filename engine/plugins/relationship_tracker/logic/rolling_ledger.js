// engine/plugins/relationship_tracker/logic/rolling_ledger.js

const fs = require('fs/promises');
const path = require('path');
const { getCanonicalPair, getRelationshipDetailTier, getRelationshipHistorySummary, getRecentBeats, getRelationshipOrigins, setRelationshipFact } = require('./db_operations');

/**
 * Consolidates relationship history for character pairs periodically.
 */
async function consolidateMultipleRelationships(tools, projectName, pairs) {
    const selfSettings = tools.settings.getSelf();
    if (selfSettings.enable_rolling_ledger === false) {
        tools.logger.runtime(`Rolling Ledger is disabled in settings.`);
        return;
    }

    const turnContext = tools.turnContext;
    const currentTurn = turnContext.turnNumber;
    const isTestOverride = currentTurn === 1;

    tools.logger.runtime(`Checking if any character pairs need bond ledger consolidation.`);

    const pairsToConsolidate = [];
    for (const [charA, charB] of pairs) {
        const [p1, p2] = getCanonicalPair(charA, charB);
        const lastSummary = await getRelationshipHistorySummary(tools, projectName, p1, p2);

        const shouldConsolidate = isTestOverride || (currentTurn - lastSummary.turn >= (selfSettings.ledger_consolidation_interval || 5));

        if (shouldConsolidate) {
            const recentBeats = await getRecentBeats(tools, projectName, p1, p2, lastSummary.turn);
            if (recentBeats.length > 0) {
                const origin = (await getRelationshipOrigins(tools, projectName))[`${p1}|${p2}`] || 'Unknown';
                const detailTier = await getRelationshipDetailTier(tools, projectName, p1, p2, turnContext.input.playerCharacterName);
                pairsToConsolidate.push({
                    p1, p2,
                    detailTier,
                    origin,
                    lastSummary: lastSummary.text,
                    recentBeats
                });
            }
        }
    }

    if (pairsToConsolidate.length === 0) {
        tools.logger.runtime(`No pairs meet the milestone for consolidation this turn.`);
        return;
    }

    tools.logger.log('Ledger', `Consolidating relationship history for ${pairsToConsolidate.length} pairs...`, 'start');
    const ledgerInterval = selfSettings.ledger_consolidation_interval || 5;

    const pairBlocks = pairsToConsolidate.map((p, i) => `
### RELATIONSHIP ${i + 1}: ${p.p1} and ${p.p2}
- **Detail Tier**: ${p.detailTier === 'main' ? 'MAIN' : 'SUPPORTING'}
- **Target Length**: ${p.detailTier === 'main' ? '180-350 words' : '25-70 words'}
- **How it started (Origin)**: ${p.origin}
- **How it was ${ledgerInterval} chapters ago (Previous Ledger)**: ${p.lastSummary || 'No previous summary.'}
- **How it is going (Recent Developments from the last ${ledgerInterval} chapters)**:
  ${p.recentBeats.join('\n  ')}
`).join('\n---\n');

    const modelDef = selfSettings.ledger_consolidation_model_def || selfSettings.generator_model_def || {};
    const useSharedModel = tools.llm.vnBackground?.isSelected?.(modelDef) === true;
    const canon = useSharedModel
        ? 'Use SELECTED CANON from the shared background context.'
        : turnContext.renderPromptSlot('root', 'canon') || 'No canon data available.';
    const history = useSharedModel
        ? 'Use SELECTED NARRATIVE HISTORY from the shared background context.'
        : turnContext.renderPromptSlot('root', 'history') || 'No narrative history available.';

    const promptTemplatePath = path.join(__dirname, '../prompts/relationship_ledger_consolidator_prompt.txt');
    const promptTemplate = await fs.readFile(promptTemplatePath, 'utf-8');
    const prompt = promptTemplate
        .replace('${canon}', canon)
        .replace('${history}', history)
        .replace('${pairBlocks}', pairBlocks);

    const resolvedModelDef = tools.llm.resolveModelDefinition?.(modelDef) || modelDef || {};
    const model = resolvedModelDef.model || 'meta-llama/llama-3-8b-instruct';
    const provider = resolvedModelDef.provider;
    const retries = selfSettings.retries ?? 1;
    const timeout = selfSettings.timeout ?? 120000;

    try {
        const task = {
            msg: 'RelationshipLedgerConsolidator',
            requestId: 'relationship_ledger_consolidation',
            params: {
                max_tokens: 64000,
                retries,
                timeout,
                callingModule: 'Plugin:relationship_tracker'
            }
        };
        const response = useSharedModel
            ? await tools.llm.vnBackground.json({ ...task, scene: 'none', instruction: prompt })
            : await tools.llm.json({ ...task, prompt, model, provider });

        const results = response.content;
        if (Array.isArray(results)) {
            for (const result of results) {
                if (result.pair && result.summary) {
                    const [p1, p2] = getCanonicalPair(result.pair[0], result.pair[1]);
                    await setRelationshipFact(tools, {
                        charA: p1, charB: p2, predicate: 'history_summary', value: 0,
                        projectName, turnNumber: currentTurn, context: result.summary
                    });
                }
            }
            tools.logger.log('Ledger', `History consolidated for ${results.length} pairs.`, 'end');
        }
    } catch (error) {
        tools.logger.error('Ledger', `Failed to consolidate history batch: ${error.message}`);
    }
}

/**
 * Fetches all relationship summaries for a project.
 */
async function getAllRelationshipSummaries(tools, projectName) {
    try {
        const maxTurn = Number.isInteger(tools?.turnContext?.turnNumber) ? tools.turnContext.turnNumber : null;
        let query = `SELECT source, target, context, turn_number 
             FROM facts 
             WHERE project_name = ? AND predicate = 'relationship_history_summary'`;
        const params = [projectName.toLowerCase()];
        if (maxTurn !== null && maxTurn !== undefined) {
            query += ` AND turn_number <= ?`;
            params.push(maxTurn);
        }
        query += ` ORDER BY turn_number DESC`;
        const rows = await tools.db.chat.query(
            query,
            params
        );

        const summaries = {};
        for (const row of rows) {
            const [p1, p2] = getCanonicalPair(row.source, row.target);
            const key = `${p1}|${p2}`;
            if (!summaries[key]) {
                summaries[key] = { text: row.context, turn: row.turn_number };
            }
        }
        return summaries;
    } catch {
        return {};
    }
}

module.exports = {
    consolidateMultipleRelationships,
    getAllRelationshipSummaries
};

/**
 * Character Sheets - Capsule Auditor (Garbage Collector)
 * Periodically reviews recently created lite capsules and reclassifies
 * obvious junk (timestamps, fragments, generic labels) as MINOR.
 */
const path = require('path');
const fs = require('fs/promises');
const storage = require('./storage.js');

/**
 * Runs the capsule audit. Queries recent lite capsules, sends them to an LLM
 * for validation, and reclassifies flagged entries as MINOR.
 *
 * @param {object} turnContext - The current turn context.
 * @param {object} tools - The tools object.
 * @returns {Promise<{audited: number, flagged: number, names: string[]}>}
 */
async function runCapsuleAudit(turnContext, tools) {
    const turnNumber = turnContext.turnNumber || 0;
    const settings = { ...tools.settings.get(), ...tools.settings.getSelf() };
    const frequency = settings.auditor_frequency || 10;
    const projectName = turnContext.projectName.toLowerCase();

    tools.logger.log('Character Sheets', `Capsule Auditor: Starting audit (window: last ${frequency} turns)`, 'start');

    // 1. Get all characters with IMPORTANCE = MAJOR from the last N turns
    const windowStart = Math.max(0, turnNumber - frequency);
    const candidates = await tools.db.chat.query(
        `SELECT DISTINCT f.source, f.fact_value as importance
         FROM facts f
         WHERE f.predicate = 'IMPORTANCE'
           AND UPPER(f.fact_value) = 'MAJOR'
           AND f.project_name = ?
           AND f.turn_number >= ?
         ORDER BY f.source`,
        [projectName, windowStart]
    );

    if (candidates.length === 0) {
        tools.logger.log('Character Sheets', 'Capsule Auditor: No recent MAJOR capsules to audit.', 'end');
        return { audited: 0, flagged: 0, names: [] };
    }

    tools.logger.runtime(`Capsule Auditor: Found ${candidates.length} MAJOR candidates in turns ${windowStart}-${turnNumber}`);

    // 2. Filter out protected characters
    // 2a. Get CORE characters
    const coreRows = await tools.db.chat.query(
        `SELECT DISTINCT source FROM facts WHERE predicate = 'IMPORTANCE' AND UPPER(fact_value) = 'CORE' AND project_name = ?`,
        [projectName]
    );
    const coreNames = new Set(coreRows.map(r => r.source.toLowerCase()));

    // 2b. Get characters with full sheets in project DB
    await storage.initializeDatabase(tools);
    const sheetRows = await tools.db.project.query(`SELECT character_name FROM character_sheets`);
    const sheetNames = new Set(sheetRows.map(r => r.character_name.toLowerCase()));

    // 2c. Get player character
    const playerName = (settings.player_character_name || '').toLowerCase();

    const filteredCandidates = candidates.filter(c => {
        const low = c.source.toLowerCase();
        if (coreNames.has(low)) {
            tools.logger.runtime(`Capsule Auditor: Skipping CORE character '${c.source}'`);
            return false;
        }
        if (sheetNames.has(low)) {
            tools.logger.runtime(`Capsule Auditor: Skipping full-sheet character '${c.source}'`);
            return false;
        }
        if (low === playerName) {
            tools.logger.runtime(`Capsule Auditor: Skipping player character '${c.source}'`);
            return false;
        }
        return true;
    });

    if (filteredCandidates.length === 0) {
        tools.logger.log('Character Sheets', 'Capsule Auditor: All candidates are protected. Nothing to audit.', 'end');
        return { audited: 0, flagged: 0, names: [] };
    }

    // 3. Fetch briefs for each candidate
    const candidateData = [];
    for (const c of filteredCandidates) {
        const briefRows = await tools.db.chat.query(
            `SELECT fact_value FROM facts WHERE source = ? AND predicate = 'CHAR_SHEET:BRIEF' ORDER BY turn_number DESC LIMIT 1`,
            [c.source]
        );
        candidateData.push({
            name: c.source,
            brief: briefRows.length > 0 ? briefRows[0].fact_value : '(no description available)'
        });
    }

    // 4. Build the numbered candidate list
    const candidateList = candidateData.map((c, i) =>
        `${i + 1}. Name: "${c.name}" — Brief: "${c.brief}"`
    ).join('\n');

    // 5. Load prompt and call LLM
    const promptPath = path.join(__dirname, '../prompts/capsule_auditor_prompt.txt');
    const promptTemplate = await fs.readFile(promptPath, 'utf-8');
    const prompt = promptTemplate.replace('${candidateList}', candidateList);

    const modelDef = settings.auditor_model || settings.lowendmodel || { model: 'lowendmodel' };

    tools.logger.runtime(`Capsule Auditor: Sending ${candidateData.length} candidates for LLM review`);

    let invalidIndices = [];
    try {
        const response = await tools.llm.json({
            msg: 'Capsule Auditor',
            requestId: 'capsule_auditor',
            prompt,
            model: modelDef.model,
            provider: modelDef.provider,
            params: {
                temperature: 0.0,
                max_tokens: 200,
                callingModule: 'Plugin:character_sheets:capsule_auditor'
            }
        });

        const data = response.content || {};
        invalidIndices = Array.isArray(data.invalid) ? data.invalid : [];
    } catch (error) {
        tools.logger.error('Auditor', `LLM call failed: ${error.message}`);
        return { audited: candidateData.length, flagged: 0, names: [] };
    }

    // 6. Reclassify flagged characters as MINOR
    const flaggedNames = [];
    for (const idx of invalidIndices) {
        const candidate = candidateData[idx - 1]; // 1-indexed
        if (!candidate) continue;

        const lowerName = candidate.name.toLowerCase();
        flaggedNames.push(candidate.name);

        tools.logger.log('Character Sheets', `Capsule Auditor: Reclassifying '${candidate.name}' as MINOR (junk)`);

        // Update IMPORTANCE to MINOR
        await tools.db.chat.execute(
            `UPDATE facts SET fact_value = 'MINOR' WHERE source = ? AND predicate = 'IMPORTANCE' AND project_name = ?`,
            [lowerName, projectName]
        );

        // Remove from social_registry vector store
        if (tools.vector) {
            try {
                await tools.vector.delete('social_registry', { name: candidate.name });
                tools.logger.runtime(`Capsule Auditor: Removed '${candidate.name}' from social_registry`);
            } catch (e) {
                tools.logger.runtime(`Capsule Auditor: Failed to remove '${candidate.name}' from vector store: ${e.message}`);
            }
        }
    }

    tools.logger.log('Character Sheets', `Capsule Auditor: Audit complete. Audited ${candidateData.length}, flagged ${flaggedNames.length}: ${flaggedNames.join(', ') || 'none'}`, 'end');

    return { audited: candidateData.length, flagged: flaggedNames.length, names: flaggedNames };
}

module.exports = { runCapsuleAudit };

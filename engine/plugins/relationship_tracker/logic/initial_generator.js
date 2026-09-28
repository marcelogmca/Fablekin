// engine/plugins/relationship_tracker/logic/initial_generator.js

const fs = require('fs/promises');
const path = require('path');
const { generateRelationshipScoringGuide } = require('./scoring');
const { getCoreCharacters, getCanonicalPair, setRelationshipFact, purgeRelationshipFacts } = require('./db_operations');

/**
 * Checks if initial relationship vectors already exist for a character.
 */
async function hasInitialRelationshipVectors(tools, characterName, projectName) {
    try {
        const row = await tools.db.chat.query(
            `SELECT COUNT(*) as count FROM facts
             WHERE project_name = ? AND turn_number = 0 AND predicate LIKE 'relationship_%'
               AND (source = ? OR target = ?) `,
            [projectName.toLowerCase(), characterName.toLowerCase(), characterName.toLowerCase()]
        );
        return row[0].count > 0;
    } catch (error) {
        if (error.message.includes('Database not initialized')) return false;
        tools.logger.error('Database', `Failed to check for existing initial relationships for ${characterName}.`, null, error);
        return false;
    }
}

/**
 * Generates initial relationship bonds using an LLM.
 */
async function generateInitialRelationships(turnContext, tools, options = {}) {
    const settings = tools.settings.get();
    const selfSettings = tools.settings.getSelf();
    const pluginSettings = settings.plugins?.relationship_tracker?.generator || {};
    const generator_model_def = selfSettings.generator_model_def || {};

    const config = {
        MODEL: generator_model_def.model || pluginSettings.model || 'meta-llama/llama-3-70b-instruct',
        PROVIDER: generator_model_def.provider || pluginSettings.provider,
        ENABLED: pluginSettings.enabled !== false,
        RETRIES: selfSettings.retries ?? pluginSettings.retries ?? 1,
        TIMEOUT: selfSettings.timeout ?? pluginSettings.timeout ?? 120000
    };

    if (!config.ENABLED) return;

    const { mode = 'static_sheets', dynamicCharacterName = null, dynamicSceneText = null } = options;
    const projectName = turnContext.projectName;
    const playerName = turnContext.input.playerCharacterName || 'The Player';
    const coreCharacters = await getCoreCharacters(tools, projectName, playerName);
    const turnCoreSheets = tools.pluginState.forPlugin('character_sheets').turn().sheets || [];
    for (const sheet of turnCoreSheets) {
        if (sheet?.name) coreCharacters.add(sheet.name.toLowerCase());
    }
    const coreCharacterList = Array.from(coreCharacters)
        .filter(name => name && name !== playerName.toLowerCase())
        .join(', ') || 'none';

    try {
        let prompt;
        let contentHash = null;
        const scoringGuide = generateRelationshipScoringGuide();

        if (mode === 'dynamic_character') {
            if (await hasInitialRelationshipVectors(tools, dynamicCharacterName, turnContext.projectName)) return;

            const promptTemplatePath = path.join(__dirname, '../prompts/relationship_generator_dynamic_prompt.txt');
            const promptTemplate = await fs.readFile(promptTemplatePath, 'utf-8');
            prompt = promptTemplate
                .replace('${characterName}', dynamicCharacterName)
                .replace('${sceneText}', dynamicSceneText)
                .replace('${playerName}', playerName)
                .replace('${coreCharacters}', coreCharacterList)
                .replace('${scoringGuide}', scoringGuide);
        } else {
            let npcSheetEntries = [];
            if (tools.plugins.isInstalled('character_sheets')) {
                npcSheetEntries = tools.pluginState.forPlugin('character_sheets').turn().sheets || [];
            }

            let playerSheet = null;
            try {
                const maxTurn = Number.isInteger(turnContext?.turnNumber) ? turnContext.turnNumber : 0;
                const rows = await tools.db.chat.query(
                    `SELECT fact_value
                     FROM facts
                     WHERE project_name = ?
                       AND source = ?
                       AND predicate IN ('CHAR_SHEET:BRIEF', 'CHAR_SHEET:BIOGRAPHY')
                       AND turn_number <= ?
                     ORDER BY CASE WHEN predicate = 'CHAR_SHEET:BIOGRAPHY' THEN 1 ELSE 2 END
                     LIMIT 1`,
                    [projectName.toLowerCase(), playerName.toLowerCase(), maxTurn]
                );
                if (rows.length > 0) playerSheet = rows[0].fact_value;
            } catch { }

            let characterSheets = npcSheetEntries.map(s => s.sheet).join('\n\n---\n\n');
            if (playerSheet) characterSheets = `PLAYER CHARACTER CAPSULE:\n${playerSheet}\n\n---\n\n` + characterSheets;

            const proactiveMajor = turnContext.processed.proactiveMajorCharacters || [];
            if (proactiveMajor.length > 0) {
                const majorBlocks = proactiveMajor.map(m => `### MAJOR CHARACTER: ${m.name}\nBRIEF: ${m.brief}`).join('\n\n---\n\n');
                characterSheets += `\n\n--- SUPPORTING CHARACTERS ---\n\n` + majorBlocks;
            }

            if (!characterSheets.trim()) return;

            const loreContext = (turnContext.promptComponents.root.canon.join('\n') || '');
            const { generateHash } = require('../../../modules/utils.js');
            contentHash = generateHash(characterSheets + loreContext + scoringGuide);

            try {
                await tools.db.project.execute(`CREATE TABLE IF NOT EXISTS relationship_start_cache (project_name TEXT PRIMARY KEY, content_hash TEXT, relationship_data TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
                const cached = await tools.db.project.query("SELECT relationship_data, content_hash FROM relationship_start_cache WHERE project_name = ?", [projectName]);

                if (cached && cached.length > 0 && cached[0].content_hash === contentHash) {
                    const relationshipData = JSON.parse(cached[0].relationship_data);
                    await applyRelationshipData(tools, relationshipData, projectName, { playerName, forceInitialize: true });
                    return;
                }
            } catch { }

            const promptTemplatePath = path.join(__dirname, '../prompts/relationship_generator_prompt.txt');
            const promptTemplate = await fs.readFile(promptTemplatePath, 'utf-8');
            prompt = promptTemplate
                .replace('${characterSheets}', characterSheets)
                .replace('${lore}', loreContext)
                .replace('${playerName}', playerName)
                .replace('${coreCharacters}', coreCharacterList)
                .replace('${scoringGuide}', scoringGuide);
        }

        const response = await tools.llm.json({
            msg: `RelationshipGenerator`,
            requestId: 'relationship_initial_generation',
            prompt,
            model: config.MODEL,
            provider: config.PROVIDER,
            params: {
                max_tokens: 32000,
                retries: config.RETRIES,
                timeout: config.TIMEOUT,
                callingModule: 'Plugin:relationship_tracker'
            }
        });

        const relationshipData = response.content;
        if (!relationshipData || (!Array.isArray(relationshipData) && typeof relationshipData !== 'object')) return;

        if (mode === 'static_sheets' && contentHash) {
            try {
                await tools.db.project.execute("INSERT OR REPLACE INTO relationship_start_cache (project_name, content_hash, relationship_data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)", [projectName, contentHash, JSON.stringify(relationshipData)]);
            } catch { }
        }

        await applyRelationshipData(tools, relationshipData, projectName, { playerName, forceInitialize: true });
    } catch (error) {
        tools.logger.error('InitialGeneration', 'Failed to generate initial relationships.', null, error);
    }
}

/**
 * Applies generated relationship data to the database.
 */
async function applyRelationshipData(tools, relationshipData, projectName, options = {}) {
    if (!Array.isArray(relationshipData)) return;

    // Purge existing Turn 0 relationship facts before applying new ones (Guideline compliance)
    await purgeRelationshipFacts(tools, projectName, 0);

    const csSettings = tools.settings.get('character_sheets') || {};
    const isCSInstalled = tools.plugins.isInstalled('character_sheets');
    const trackingMode = isCSInstalled ? (csSettings.track_major_relationships || 'Core Anchored') : 'All';

    let playerName = options.playerName || 'Player';
    if (!options.playerName) {
        try {
            const rows = await tools.db.project.query("SELECT setting_value FROM project_settings WHERE setting_key = 'player_character_name'");
            if (rows && rows.length > 0) playerName = rows[0].setting_value;
        } catch { }
    }

    const coreCharacters = await getCoreCharacters(tools, projectName, playerName);

    for (const entry of relationshipData) {
        const { pair, origin_story, ...vectors } = entry;
        if (!pair || !Array.isArray(pair) || pair.length !== 2) continue;

        const [p1, p2] = getCanonicalPair(pair[0], pair[1]);

        if (trackingMode !== 'All' && !options.forceInitialize) {
            const isP1Core = coreCharacters.has(p1.toLowerCase());
            const isP2Core = coreCharacters.has(p2.toLowerCase());
            if (trackingMode === 'Core Anchored' && !isP1Core && !isP2Core) continue;
            if (trackingMode === 'Core Only' && (!isP1Core || !isP2Core)) continue;
        }

        if (origin_story) {
            await setRelationshipFact(tools, { charA: p1, charB: p2, predicate: 'origin', value: 0, projectName, turnNumber: 0, context: origin_story });
        }

        for (const vector in vectors) {
            const value = vectors[vector];
            if (typeof value === 'number') {
                await setRelationshipFact(tools, { charA: p1, charB: p2, predicate: vector, value: value, projectName, turnNumber: 0 });
            }
        }
    }
}

module.exports = {
    hasInitialRelationshipVectors,
    generateInitialRelationships,
    applyRelationshipData
};

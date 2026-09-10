// engine/plugins/relationship_tracker/logic/change_extractor.js

const fs = require('fs/promises');
const path = require('path');
const { generateRelationshipScoringGuide } = require('./scoring');
const { getCanonicalPair, setRelationshipFact, getCoreCharacters } = require('./db_operations');
const { synthesizeTargetedRelationshipStates } = require('./relevance');

/**
 * Analyzes dialogue and stores relationship changes in the database.
 */
async function extractAndStoreRelationshipChanges(turnContext, tools) {
    const settings = tools.settings.get();
    const selfSettings = tools.settings.getSelf();
    const pluginSettings = settings.plugins?.relationship_tracker?.change_extractor || {};
    const extractorModelDef = selfSettings.extractor_model_def || {};
    const resolvedModelDef = tools.llm.resolveModelDefinition?.(extractorModelDef) || extractorModelDef || {};

    const config = {
        MODEL: resolvedModelDef.model || pluginSettings.model || 'meta-llama/llama-3-8b-instruct',
        PROVIDER: resolvedModelDef.provider || pluginSettings.provider,
        PACING_MULTIPLIER: selfSettings.pacing_multiplier ?? pluginSettings.pacing_multiplier ?? 1,
        ENABLED: pluginSettings.enabled !== false,
        RETRIES: selfSettings.retries ?? pluginSettings.retries ?? 1,
        TIMEOUT: selfSettings.timeout ?? pluginSettings.timeout ?? 120000
    };

    if (!config.ENABLED) return;

    tools.logger.log('ChangeExtraction', 'Starting relationship change extraction...', 'start');
    const projectName = turnContext.projectName;
    const turnNumber = turnContext.turnNumber;

    try {
        const party = turnContext.output.party || [];
        const currentRelationshipsText = await synthesizeTargetedRelationshipStates(tools, projectName, party);
        const sceneText = turnContext.processed.dialogueProcessor.dialogue;
        const playerName = turnContext.input.playerCharacterName || 'The Player';

        const promptTemplatePath = path.join(__dirname, '../prompts/relationship_change_extractor_prompt.txt');
        const promptTemplate = await fs.readFile(promptTemplatePath, 'utf-8');
        const scoringGuide = generateRelationshipScoringGuide();

        const useSharedModel = tools.llm.vnBackground?.isSelected?.(extractorModelDef) === true;
        const prompt = promptTemplate
            .replaceAll('${playerName}', playerName)
            .replace('${currentRelationships}', currentRelationshipsText)
            .replace('${sceneText}', useSharedModel ? 'Use FINAL WRITER CHAPTER and FINAL PROCESSED DIALOGUE from the shared background context.' : sceneText)
            .replace('${scoringGuide}', scoringGuide);

        const messages = [{ role: 'user', content: prompt }];

        const task = {
            msg: 'RelationshipChangeExtractor',
            params: {
                max_tokens: 32000,
                retries: config.RETRIES,
                timeout: config.TIMEOUT,
                callingModule: 'Plugin:relationship_tracker'
            }
        };
        const response = useSharedModel
            ? await tools.llm.vnBackground.json({ ...task, suffix: prompt })
            : await tools.llm.json({ ...task, messages, model: config.MODEL, provider: config.PROVIDER });

        const changeData = response.content;
        if (!changeData || !Array.isArray(changeData)) return [];

        const csSettings = tools.settings.get('character_sheets') || {};
        const isCSInstalled = tools.plugins.isInstalled('character_sheets');
        const trackingMode = isCSInstalled ? (csSettings.track_major_relationships || 'Core Anchored') : 'All';
        const coreCharacters = await getCoreCharacters(tools, projectName, playerName);
        const recallCandidates = [];

        for (const entry of changeData) {
            const { pair, reason, relationship_recall: relationshipRecall, ...vectors } = entry;
            if (!pair || !Array.isArray(pair) || pair.length !== 2) continue;

            const [p1, p2] = getCanonicalPair(pair[0], pair[1]);

            if (trackingMode !== 'All') {
                const isP1Core = coreCharacters.has(p1.toLowerCase());
                const isP2Core = coreCharacters.has(p2.toLowerCase());
                if (trackingMode === 'Core Anchored' && !isP1Core && !isP2Core) continue;
                if (trackingMode === 'Core Only' && (!isP1Core || !isP2Core)) continue;
            }

            // Persist the narrative reason only once per pair update to reduce DB duplication.
            const numericVectors = Object.entries(vectors)
                .filter(([, value]) => typeof value === 'number' && value !== 0);

            for (let i = 0; i < numericVectors.length; i++) {
                const [vector, value] = numericVectors[i];
                const pacedValue = value * config.PACING_MULTIPLIER;
                await setRelationshipFact(tools, {
                    charA: p1,
                    charB: p2,
                    predicate: vector,
                    value: pacedValue,
                    projectName,
                    turnNumber,
                    context: i === 0 ? (reason || 'Scene-based change') : null
                });
            }

            if (Array.isArray(relationshipRecall) && relationshipRecall.length > 0) {
                recallCandidates.push(...relationshipRecall);
            }
        }

        if (recallCandidates.length > 0) {
            try {
                const stored = await tools.plugins.tryCall(
                    'memory_recall',
                    'storeMemories',
                    [recallCandidates, { sourcePlugin: 'relationship_tracker', domain: 'relationship' }],
                    { fallback: null, silent: true }
                );
                if (stored !== null && stored !== undefined) {
                    tools.logger.runtime(`Stored ${recallCandidates.length} relationship-derived recall candidates.`);
                }
            } catch (error) {
                tools.logger.warn('ChangeExtraction', `Failed to store relationship recall candidates: ${error.message}`);
            }
        }
        return changeData;
    } catch (error) {
        tools.logger.error('ChangeExtraction', 'Failed to extract relationship changes.', null, error);
        return [];
    }
}

module.exports = { extractAndStoreRelationshipChanges };

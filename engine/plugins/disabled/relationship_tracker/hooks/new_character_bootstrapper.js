// engine/plugins/relationship_tracker/hooks/new_character_bootstrapper.js

const logic = require('../logic.js');

const newCharacterBootstrapperHook = {
    priority: 50,
    mode: 'parallel',
    eta: { default: { min: 10000, max: 20000 } },
    run: async (turnContext, tools) => {
        const rawNewCharacters = turnContext.processed.newlyIntroducedCharacters || [];
        tools.logger.runtime(`HOOK_NEW_CHARACTER_IDENTIFIED: Checking ${rawNewCharacters.length} new entities.`);

        if (rawNewCharacters.length === 0) return;

        const metadata = turnContext.processed.characterMetadata || {};
        const csSettings = tools.settings.get('character_sheets') || {};
        const trackingMode = csSettings.track_major_relationships || 'Core Anchored';

        const newCharacters = rawNewCharacters.filter(charName => {
            const charKey = charName.toLowerCase();
            const charMetadata = metadata[charKey];
            let importance = charMetadata?.importance;
            if (typeof importance === 'string') importance = importance.toLowerCase();

            if (importance === 'minor' || importance === 'noncharacter') {
                tools.logger.log('InitialGeneration', `Skipping relationship initialization for ${importance.toUpperCase()} entity: ${charName}`);
                tools.logger.runtime(`'${charName}' is ${importance.toUpperCase()}. Skipping bond initialization.`);
                return false;
            }

            if (importance === 'major' && trackingMode === 'Core Only') {
                tools.logger.runtime(`Skipping '${charName}' relationship bootstrap due to Core Only mode.`);
                return false;
            }

            return true;
        });

        if (newCharacters.length === 0) {
            tools.logger.log('InitialGeneration', 'No major new characters to process for relationships.');
            tools.logger.runtime(`No major new characters require relationship bootstrapping.`);
            return;
        }

        const sceneText = turnContext.processed.dialogueProcessor.dialogue;

        await tools.jobs.withJob('Establishing bonds for new characters...', {
            id: 'relationship_tracker_new_character_bootstrap',
            scope: 'turn',
            rethrow: false,
            notifyOnComplete: false
        }, async (job) => {
            try {
                job.progress(15, `Bootstrapping ${newCharacters.length} character bond sets...`);
                tools.logger.log('InitialGeneration', `HOOK_NEW_CHARACTER_IDENTIFIED fired. Major new characters: ${JSON.stringify(newCharacters)}`, 'start');
                tools.logger.runtime(`Bootstrapping bonds for: ${newCharacters.join(', ')}.`);

                const generationPromises = newCharacters.map(charName => {
                    return logic.generateInitialRelationships(turnContext, tools, {
                        mode: 'dynamic_character',
                        dynamicCharacterName: charName,
                        dynamicSceneText: sceneText
                    });
                });

                await Promise.all(generationPromises);
                tools.logger.log('InitialGeneration', 'Initial relationship generation complete.', 'end');
                tools.logger.runtime(`Initial bond generation complete.`);
                job.progress(100, 'Relationship bootstrapping complete.');
            } catch (error) {
                tools.logger.error('InitialGeneration', `Error in new character relationship identification: ${error.message}`);
                tools.logger.runtime(`ERROR during bond initialization: ${error.message}`);
                throw error;
            }
        });
    }
};

module.exports = newCharacterBootstrapperHook;

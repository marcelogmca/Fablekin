// engine/plugins/relationship_tracker/hooks/pre_prompt_bootstrapper.js

const logic = require('../logic.js');

const prePromptBootstrapperHook = {
    priority: 25, // After character_sheets and personality_tracker
    mode: 'sequential',
    eta: { default: { min: 20000, max: 60000 }, turn1: { min: 60000, max: 180000 } },
    run: async (turnContext, tools) => {
        const isTurnOne = (turnContext.turnNumber === 1);
        const proactiveChars = turnContext.processed.proactiveMajorCharacters || [];
        const hasProactive = proactiveChars.length > 0;

        tools.logger.runtime(`HOOK_PRE_PROMPT_BUILDER: Checking for character relationship initialization.`);

        if (isTurnOne) {
            tools.logger.log('InitialGeneration', 'Turn 1 detected. Ensuring batch relationship generation for Core and Major characters...');
            tools.logger.runtime(`Turn 1: Bootstrapping baseline relationships for all major characters.`);
            await logic.generateInitialRelationships(turnContext, tools, {
                mode: 'static_sheets'
            });
        }

        if (hasProactive) {
            tools.logger.log('InitialGeneration', `Initializing relationships for ${proactiveChars.length} proactive characters.`);
            tools.logger.runtime(`Proactive discovery: Initializing bonds for ${proactiveChars.map(c => c.name).join(', ')}.`);
            const generationPromises = proactiveChars.map(char => {
                return logic.generateInitialRelationships(turnContext, tools, {
                    mode: 'dynamic_character',
                    dynamicCharacterName: char.name,
                    dynamicSceneText: `BRIEF: ${char.brief}`
                });
            });
            await Promise.all(generationPromises);
        }
    }
};

module.exports = prePromptBootstrapperHook;

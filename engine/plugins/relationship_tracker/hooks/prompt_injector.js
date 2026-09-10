// engine/plugins/relationship_tracker/hooks/prompt_injector.js

const logic = require('../logic.js');

const promptInjectorHook = {
    priority: 30,
    mode: 'parallel',
    eta: { default: { min: 5000, max: 15000 } },
    run: async (turnContext, tools) => {
        const projectName = turnContext.projectName;

        // 0. DETECT CHARACTER_SHEETS: If character_sheets is active, it handles relationship injection
        // inside Layer 9 of each character. We skip global injection to avoid duplication.
        if (tools.plugins.isInstalled('character_sheets')) {
            tools.logger.runtime(`HOOK_POST_PROMPT_BUILDER: 'character_sheets' is active. Skipping global relationship injection.`);
            return;
        }

        tools.logger.runtime(`HOOK_POST_PROMPT_BUILDER: Preparing relationship context for LLM prompt.`);
        tools.logger.log('Synthesis', 'Starting relationship synthesis...', 'start');

        // Determine characters for synthesis (main character + anyone in recent party)
        const charactersSet = new Set();
        const mainChar = turnContext.input.playerCharacterName;
        if (mainChar && mainChar !== 'None') {
            charactersSet.add(mainChar.toLowerCase());
            tools.logger.runtime(`Including player character '${mainChar}' in synthesis.`);
        }

        // Try to find party from previous turn if available
        const history = await turnContext.retrieveDatedChapters();
        const allPrev = [...(history.synopsischapters || []), ...(history.summarychapters || []), ...(history.fullchapters || [])];
        const lastTurn = allPrev.length > 0 ? allPrev[allPrev.length - 1] : null;

        if (lastTurn && lastTurn.output && Array.isArray(lastTurn.output.party)) {
            tools.logger.runtime(`Found previous turn party members: ${lastTurn.output.party.join(', ')}.`);
            lastTurn.output.party.forEach(char => charactersSet.add(char.toLowerCase()));
        }

        if (charactersSet.size > 0) {
            tools.logger.log('Synthesis', `Synthesizing relationships for: ${Array.from(charactersSet).join(', ')}`);
            tools.logger.runtime(`Generating dynamics for pairs involving: ${Array.from(charactersSet).join(', ')}.`);
            const relationshipSummary = await logic.synthesizeTargetedRelationshipStates(
                tools,
                projectName,
                Array.from(charactersSet)
            );

            if (relationshipSummary && relationshipSummary.length > 0 && relationshipSummary !== 'No notable relationship states found for the current context.') {
                const wrappedSnapshot = tools.prompt.wrap('active_relationships', relationshipSummary);
                tools.prompt.inject('simulation', wrappedSnapshot, 'root');
                tools.logger.log('Synthesis', 'Injected relationship snapshot into simulation slot.');
                tools.logger.runtime(`Injected active dynamics into prompt.`);
            } else {
                tools.logger.runtime(`No significant bonds discovered for active participants.`);
            }
        } else {
            tools.logger.runtime(`No active characters identified for relationship context.`);
        }
        tools.logger.log('Synthesis', 'Relationship synthesis complete.', 'end');
    }
};

module.exports = promptInjectorHook;

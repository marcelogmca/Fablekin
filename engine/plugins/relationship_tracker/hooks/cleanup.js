// engine/plugins/relationship_tracker/hooks/cleanup.js

const cleanupHook = {
    priority: 5, // Run early
    run: async (turnContext, tools) => {
        if (!turnContext?.turnNumber) return;

        tools.logger.runtime(`[Cleanup] Purging relationship tracker facts for current scoped run.`);
        await tools.facts.cleanUpFactsDb({
            predicates: ['relationship_%']
        });
    }
};

module.exports = cleanupHook;

const logic = require('./logic.js');

module.exports = {
    id: logic.PLUGIN_ID,
    name: 'Story Arc Tracker',
    description: 'Tracks narrative arc boundaries and requests Arc Cinematics intros at stable arc openings.',
    version: '1.0.0',
    author: 'Fablekin',
    category: 'Narrative',
    dependencies: [
        { id: 'arc_cinematics', reason: 'Required because this tracker asks Arc Cinematics to present transitions when a new story arc begins.' }
    ],
    wizard: {
        include: true,
        order: 655,
        group: 'Narrative',
        label: 'Story Arc Tracker',
        recommended_enabled: true,
        author_note: 'Recommended when Arc Cinematics is enabled; decides when story movement is ready for an intro.',
        enabled_note: 'Tracks story arcs and queues cinematic intros when a new arc begins.',
        disabled_note: 'Arc Cinematics can still be manually requested, but automatic arc openings are disabled.',
        settings_note: 'Tune trigger strictness, cooldowns, and debug dry-run behavior.'
    },
    settingsSchema: logic.SETTINGS_SCHEMA,
    hooks: {
        HOOK_PRE_WRITER: {
            priority: 70,
            mode: 'sequential',
            allowInterlude: true,
            run: logic.runPreWriter
        },
        HOOK_POST_VN_GENERATION: {
            priority: 82,
            mode: 'background',
            allowInterlude: true,
            useSharedVnLlm: true,
            run: logic.runPostVnGeneration
        }
    },
    exports: {
        getArcState: async (turnContext, tools, options = {}) => {
            return await logic.getPreviousArcState(turnContext, tools, options);
        },
        classifyArcBoundary: logic.classifyAndPersistArcState
    }
};

const logic = require('./logic.js');

module.exports = {
    id: 'adventure_book',
    name: 'Adventure Book',
    description: 'Blocking storybook challenge loops with d20-style narrative uncertainty and clean VN continuation handoff.',
    version: '1.0.0',
    author: 'Fablekin',
    isTestPlugin: false,
    category: 'Gameplay',
    optionalDependencies: [
        { id: 'arc_cinematics', reason: 'Provides richer CG prompt planning when this plugin creates Adventure Book chapter artwork.' },
        { id: 'cg_generator', reason: 'Allows the adventure book to request generated CG artwork for its special scenes.' }
    ],
    wizard: {
        include: true,
        order: 820,
        group: 'Gameplay',
        label: 'Adventure Book',
        recommended_enabled: true,
        author_note: 'Adds structured storybook choices for investigations, journeys, hazards, and other bounded challenge scenes.',
        enabled_note: 'Suitable challenge beats can become short book-style choice loops that hand back into the next VN turn.',
        disabled_note: 'Fablekin keeps challenge resolution inside ordinary prose and user prompts.',
        settings_note: 'Tune the model, max steps, visible odds, CG model tier, and optional CG integration.'
    },
    settingsSchema: logic.SETTINGS_SCHEMA,
    documentation: [
        {
            id: 'adventure_book',
            title: 'Adventure Book',
            description: 'Storybook challenge loops, d20 odds, and VN continuation handoff.',
            path: 'docs/adventure_book.html',
            category: 'Plugins'
        }
    ],

    hooks: {
        HOOK_DIRECTOR_PRE_PROMPT: {
            priority: 22,
            allowInterlude: false,
            run: logic.runDirectorPrePrompt
        },
        HOOK_POST_VN_GENERATION: {
            priority: 112,
            allowInterlude: false,
            run: logic.runPostVnGeneration
        }
    },

    socketListeners: {
        [logic.START_EVENT]: logic.startChallengeSocket,
        [logic.ROLL_EVENT]: logic.rollChallengeSocket,
        [logic.ADVANCE_EVENT]: logic.advanceChallengeSocket,
        [logic.REBUILD_EVENT]: logic.rebuildChallengeSocket,
        [logic.CG_EVENT]: logic.generateCgSocket,
        [logic.FINALIZE_EVENT]: logic.finalizeChallengeSocket
    },

    exports: {
        guiIntercepts: {
            adventure_book_overlay: logic.buildAdventureBookOverlayIntercept,
            default: logic.buildGuiIntercept
        },
        deriveD20Target: logic.deriveD20Target,
        resolveRollOutcome: logic.resolveRollOutcome,
        normalizeOption: logic.normalizeOption,
        shouldOfferAdventureBook: logic.shouldOfferAdventureBook
    }
};

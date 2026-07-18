const logic = require('./logic.js');

module.exports = {
    id: logic.PLUGIN_ID,
    name: 'Top-Down Shooter Gameplay',
    description: 'Combat-focused top-down shooter overlay capability.',
    version: '1.0.0',
    author: 'Fablekin',
    isTestPlugin: false,
    experimental: true,
    category: 'Gameplay',
    wizard: {
        include: true,
        order: 800,
        group: 'Gameplay',
        label: 'Top-Down Shooter Gameplay',
        recommended_enabled: false,
        author_note: 'Optional genre layer; keep it off unless you want playable combat interludes.',
        enabled_note: 'Selected scenes can offer top-down shooter combat overlays with generated encounters.',
        disabled_note: 'Fablekin stays focused on narrative/VN flow without playable combat handoffs.',
        settings_note: 'Tune dynamic encounter generation, model, and timeout behavior in plugin settings.'
    },
    settingsSchema: logic.SETTINGS_SCHEMA,

    hooks: {
        HOOK_DIRECTOR_PRE_PROMPT: {
            priority: 20,
            allowInterlude: true,
            run: logic.runDirectorPrePrompt
        },
        HOOK_POST_VN_GENERATION: {
            priority: 110,
            allowInterlude: true,
            run: logic.runPostVnGeneration
        }
    },

    socketListeners: {
        [logic.REGENERATE_ENCOUNTER_EVENT]: logic.regenerateEncounterSocket
    },

    exports: {
        guiIntercepts: {
            top_down_shooter_gameplay_overlay: logic.buildCombatOverlayIntercept,
            default: logic.buildGuiIntercept
        }
    }
};

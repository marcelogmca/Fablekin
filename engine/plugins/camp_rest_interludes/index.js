const logic = require('./logic.js');

module.exports = {
    id: logic.PLUGIN_ID,
    name: 'Camp Rest',
    description: 'Capability-driven camp/rest overlays with invitation interludes and scene replay.',
    version: '1.0.0',
    author: 'Fablekin',
    isTestPlugin: false,
    experimental: false,
    category: 'Narrative',
    wizard: {
        include: true,
        order: 240,
        group: 'Narrative',
        label: 'Camp Rest',
        recommended_enabled: true,
        author_note: 'Recommended if you want the story to breathe between major plot beats.',
        enabled_note: 'Adds player-facing rest or camp choices that create lower-stakes character interludes.',
        disabled_note: 'The story stays more direct and fewer dedicated downtime scenes are offered.',
        settings_note: 'Tune the choice model, default options, and overlay layout in plugin settings.'
    },
    optionalDependencies: [
        { id: 'character_classifier', reason: 'Helps camp scenes focus on established characters instead of treating every passing NPC as a participant.' },
        { id: 'world_location_tracker', reason: 'Supplies the current place and travel context so rest scenes fit where the party actually is.' }
    ],
    settingsSchema: logic.SETTINGS_SCHEMA,

    hooks: {
        HOOK_DIRECTOR_PRE_PROMPT: {
            priority: 20,
            allowInterlude: true,
            run: logic.runDirectorPrePrompt
        },
        HOOK_POST_VN_GENERATION: {
            priority: 100,
            mode: 'parallel',
            allowInterlude: true,
            run: logic.runPostVnGeneration
        },
        HOOK_POST_PROMPT_BUILDER: {
            priority: 50,
            allowInterlude: true,
            run: logic.handleInterludePromptAugmentation
        }
    },

    exports: {
        guiIntercepts: {
            camp_rest_overlay: logic.buildCampRestOverlayIntercept,
            default: logic.buildGuiIntercept
        }
    },

    socketListeners: {
        [logic.SOCKET_BIND_EVENT]: logic.bindOptionInterludeSocket,
        [logic.SAVE_INVITATION_EVENT]: logic.bindInvitationSocket,
        [logic.SAVE_LAYOUT_EVENT]: logic.bindOverlayLayoutSocket
    }
};

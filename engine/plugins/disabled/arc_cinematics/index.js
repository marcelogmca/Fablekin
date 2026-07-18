const logic = require('./logic.js');

module.exports = {
    id: logic.PLUGIN_ID,
    name: 'Arc Cinematics',
    description: 'Passive arc intro cinematic capability for VN scenes.',
    version: '1.0.0',
    author: 'Fablekin',
    category: 'Visual',
    wizard: {
        include: true,
        order: 660,
        group: 'Visual',
        label: 'Arc Cinematics',
        recommended_enabled: false,
        author_note: 'Optional polish for campaigns that want arc-opening cinematic recaps.',
        enabled_note: 'New story arcs can open with short VN cinematics, effects, music, and optional CG handoff.',
        disabled_note: 'Arc starts remain plain narrative transitions without cinematic recap overlays.',
        settings_note: 'Tune poem length, CG usage, shader style, and debug forcing in plugin settings.'
    },
    optionalDependencies: [
        { id: 'cg_generator', reason: 'Adds generated CG artwork to arc-opening cinematic moments.' },
        { id: 'vn_pixijs_vfx', reason: 'Adds shader and visual-effect treatment to cinematic transitions.' },
        { id: 'story_arc_tracker', reason: 'Provides detected arc boundaries so cinematics can trigger at natural story openings.' }
    ],
    settingsSchema: logic.SETTINGS_SCHEMA,

    hooks: {
        HOOK_TURN_START: {
            priority: 85,
            mode: 'parallel',
            allowInterlude: true,
            run: logic.runTurnStart
        },
        HOOK_PRE_WRITER: {
            priority: 85,
            mode: 'parallel',
            allowInterlude: true,
            run: logic.runPreWriter
        },
        HOOK_POST_VN_GENERATION: {
            priority: 85,
            mode: 'sequential',
            allowInterlude: true,
            run: logic.runPostVnGeneration
        }
    },

    exports: {
        requestArcCinematic: logic.requestArcCinematic,
        prepareArcCinematic: logic.requestArcCinematic,
        getCapabilityPrompt: logic.getCapabilityPrompt,
        buildDiffusionPromptFallback: logic.getDiffusionPromptFallback,
        buildCgRequestForStanza: logic.buildCgRequestForStanza,
        guiIntercepts: {
            arc_cinematic: logic.buildGuiIntercept,
            arc_cinematic_pending_notice: logic.buildPendingNoticeIntercept,
            default: logic.buildGuiIntercept
        }
    },

    socketListeners: {
        'arc-cinematics-status': logic.handleManifestStatusSocket
    }
};

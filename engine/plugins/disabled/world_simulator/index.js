const logic = require('./logic.js');

module.exports = {
    id: 'world_simulator',
    name: 'World Simulator',
    author: 'Fablekin Core',
    version: '0.1.0',
    category: 'World',
    experimental: true,
    wizard: {
        include: true,
        order: 520,
        group: 'World',
        label: 'World Simulator',
        recommended_enabled: true,
        author_note: 'Recommended when you want the world to feel alive outside the active scene.',
        enabled_note: 'Runs off-screen simulation and feeds grounded changes into world trackers.',
        disabled_note: 'The world mostly changes only when the current scene directly mentions it.',
        settings_note: 'Tune simulation model, cadence, and scope in plugin settings.'
    },
    description: 'Runs low-latency off-screen world simulation and saves grounded changes into world trackers.',
    dependencies: [
        { id: 'world_location_tracker', reason: 'Required to track off-screen movement, places, and location events.' },
        { id: 'world_state_tracker', reason: 'Required to save grounded changes to time, weather, inventory, and the broader world.' }
    ],
    optionalDependencies: [
        { id: 'character_sheets', reason: 'Adds richer character context to off-screen simulation decisions.' },
        { id: 'character_classifier', reason: 'Helps the simulator spend attention on established characters instead of minor NPC noise.' }
    ],

    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Periodically advances off-screen character whereabouts and location events so the world keeps moving outside the active party.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Runs in background after VN generation. It reads current map, world state, character whereabouts, recent history, and optional character sheets, then saves validated simulation updates into World Location Tracker and World State Tracker.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'Medium',
            immersion: 'Medium',
            cost: 'Low',
            latency: 'None'
        },
        model_def: {
            type: 'select',
            label: 'Simulation Model',
            description: 'Model used to simulate off-screen world changes.',
            options: 'llm-aliases',
            allowVnBackgroundModel: true,
            default: { inherit: 'vn_background' }
        },
        update_interval: {
            type: 'number',
            label: 'Update Interval (Turns)',
            description: 'How many turns to wait between background world simulation runs.',
            default: 3,
            min: 1,
            max: 30
        },
        character_update_limit: {
            type: 'number',
            label: 'Character Updates',
            description: 'Maximum non-party characters to update per run.',
            default: 3,
            min: 0,
            max: 12
        },
        location_event_limit: {
            type: 'number',
            label: 'Location Events',
            description: 'Maximum off-party locations to update per run.',
            default: 3,
            min: 0,
            max: 12
        },
        prompt_event_limit: {
            type: 'number',
            label: 'Prompt Event Limit',
            description: 'Maximum simulated location events to inject into the shared simulation prompt slot.',
            default: 6,
            min: 0,
            max: 20
        },
        history_depth: {
            type: 'number',
            label: 'History Depth',
            description: 'Recent compressed chapters to include in the simulation dossier.',
            default: 6,
            min: 1,
            max: 20
        },
        request_timeout_ms: {
            type: 'number',
            label: 'Request Timeout (ms)',
            description: 'Maximum time to wait for one world simulation LLM attempt before treating it as failed.',
            default: 120000,
            min: 15000,
            max: 600000
        },
        retries: {
            type: 'number',
            label: 'LLM Retries',
            description: 'How many additional attempts to make after the first world simulation LLM request fails.',
            default: 1,
            min: 0,
            max: 5
        },
        force_update: {
            type: 'checkbox',
            label: 'Force Every Turn',
            description: 'Run the simulator every turn, ignoring the interval.',
            default: false
        }
    },

    hooks: {
        'HOOK_POST_PROMPT_BUILDER': {
            priority: 45,
            mode: 'parallel',
            run: async (turnContext, tools) => {
                const settings = tools.settings.getSelf ? tools.settings.getSelf() : {};
                const result = await logic.injectWorldEventsIntoPrompt(turnContext, tools, settings);
                if (result?.injected) {
                    tools.logger.runtime(`Injected ${result.count} world simulator event(s) into simulation slot.`);
                }
            }
        },
        'HOOK_VN_BACKGROUND_TASKS': {
            priority: 90,
            mode: 'parallel',
            useSharedVnLlm: true,
            run: async (turnContext, tools) => {
                await tools.jobs.withJob('Simulating off-screen world...', {
                    id: 'world_simulator_update',
                    scope: 'turn',
                    rethrow: false,
                    notifyOnComplete: false
                }, async (job) => {
                    job.progress(10, 'Preparing simulation dossier...');
                    const settings = tools.settings.getSelf ? tools.settings.getSelf() : {};
                    const result = await logic.processSimulation(turnContext, tools, settings);
                    job.progress(100, result?.status || 'World simulation checked.');
                });
            }
        }
    },

    exports: {
        runSimulation: async (turnContext, tools, options = {}) => {
            const settings = { ...(tools.settings.getSelf ? tools.settings.getSelf() : {}), ...options };
            return await logic.processSimulation(turnContext, tools, settings);
        }
    }
};

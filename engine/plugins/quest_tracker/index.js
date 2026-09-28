const fs = require('fs/promises');
const path = require('path');
const logic = require('./logic.js');

module.exports = {
    id: 'quest_tracker',
    name: 'Story Objective Tracker',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Narrative',
    optionalDependencies: [
        { id: 'vn_hud', reason: 'Displays tracked objectives and updates in the VN interface.' },
        { id: 'vn_sfx', reason: 'Adds sound feedback when objectives advance, complete, or change.' }
    ],
    wizard: {
        include: true,
        order: 520,
        group: 'Narrative',
        label: 'Story Objective Tracker',
        recommended_enabled: true,
        author_note: 'Recommended if you want a small player-facing reminder of recent accomplishments and current story threads.',
        enabled_note: 'Maintains a stable, minimalist objective tracker from story-visible evidence only.',
        disabled_note: 'The VN view will not show the compact Story Threads HUD panel.',
        settings_note: 'Tune extraction model, history depth, and HUD visibility in plugin settings.'
    },
    description: 'Tracks player-facing story objectives and renders an independent compact Story Threads HUD panel.',
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Maintains a minimalist story objective tracker: last completed thread, current activity, and up to three active goals.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Runs as a background task after each turn. It uses previous tracker state, compressed narrative history, current player input, and current chapter text. It intentionally ignores hidden planning systems and validates LLM output with strong anti-jitter rules.'
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
            label: 'Objective Tracking Model',
            description: 'Model used to conservatively patch the story objective tracker after each turn.',
            options: 'llm-aliases',
            allowVnBackgroundModel: true,
            default: { inherit: 'vn_background' }
        },
        history_preset: {
            type: 'select',
            label: 'History Preset',
            description: 'Compressed history view used by the tracker.',
            options: [
                { label: 'brief', description: 'Lowest cost, shortest recall window.' },
                { label: 'balanced', description: 'Recommended mix of recall and cost.' },
                { label: 'deep', description: 'Largest recall window, higher prompt cost.' }
            ],
            default: 'balanced'
        },
        max_active_goals: {
            type: 'number',
            label: 'Max Active Goals',
            description: 'Maximum number of active goals shown in the HUD.',
            default: 3,
            min: 1,
            max: 6
        },
        enabled_in_hud: {
            type: 'checkbox',
            label: 'Show In HUD',
            description: 'Show the Story Threads panel in the VN HUD.',
            default: true
        },
        quest_notifications_enabled: {
            type: 'checkbox',
            label: 'Quest Notifications',
            description: 'Show RPG-style quest outcome notifications when VN playback reaches the resolving dialogue line.',
            default: true
        },
        quest_notification_sfx: {
            type: 'text',
            label: 'Quest Notification SFX',
            description: 'Optional vn_sfx effect filename to play with quest notifications.',
            default: 'success_jingle.wav'
        },
        quest_notification_duration_ms: {
            type: 'number',
            label: 'Quest Notification Duration (ms)',
            description: 'How long quest outcome notifications remain on screen.',
            default: 4200,
            min: 1500,
            max: 12000
        }
    },
    exports: {
        getObjectiveState: async (turnContext, tools, options = {}) => {
            const context = options.context || turnContext;
            return await logic.getObjectiveStateForContext(context, tools);
        },
        getQuestRegistry: async (turnContext, tools, options = {}) => {
            const context = options.context || turnContext;
            return await logic.getQuestRegistryForContext(context, tools, options);
        },
        getQuestRenownSummary: async (turnContext, tools, options = {}) => {
            const context = options.context || turnContext;
            const turnNumber = options.turnNumber || context?.turnNumber || tools?.turnContext?.turnNumber || 1;
            const registry = await logic.getQuestRegistryForContext(context, tools, { ...options, turnNumber });
            return logic.buildQuestRenownSummary(registry, { turnNumber });
        },
        getQuestProgressBrief: async (turnContext, tools, options = {}) => {
            const context = options.context || turnContext;
            return await logic.getQuestProgressBrief(context, tools, options);
        },
        getQuestImmediateReminderBrief: async (turnContext, tools, options = {}) => {
            const context = options.context || turnContext;
            return await logic.getQuestImmediateReminderBrief(context, tools, options);
        },
        guiIntercepts: {
            quest_notification: logic.buildQuestNotificationIntercept,
            default: logic.buildQuestNotificationIntercept
        },
        refreshQuestRegistry: async (turnContext, tools, options = {}) => {
            const context = options.context || turnContext;
            const result = await logic.refreshQuestRegistryFromCanonical(context, tools, options);
            if (options.emitHud !== false) {
                const settings = await Promise.resolve(tools.settings.getSelf());
                if (settings.enabled_in_hud !== false) {
                    const state = await logic.getObjectiveStateForContext(context, tools);
                    const projection = logic.projectQuestRegistryForDialogue(result.registry, {
                        turnNumber: options.turnNumber || context?.turnNumber || null,
                        dialogueIndex: options.dialogueIndex
                    });
                    const projectedState = logic.projectObjectiveStateForDialogue(state, {
                        turnNumber: options.turnNumber || context?.turnNumber || null,
                        dialogueIndex: options.dialogueIndex
                    });
                    tools.socket.emit('quest-tracker-data', {
                        enabledInHud: true,
                        turnNumber: options.turnNumber || context?.turnNumber || null,
                        dialogueIndex: options.dialogueIndex ?? null,
                        state: projectedState,
                        registry: projection.registry,
                        pendingNotifications: settings.quest_notifications_enabled === false ? [] : projection.pendingNotifications,
                        notificationSettings: {
                            enabled: settings.quest_notifications_enabled !== false,
                            sfx: settings.quest_notification_sfx || 'success_jingle.wav',
                            durationMs: settings.quest_notification_duration_ms || 4200
                        }
                    });
                }
            }
            return result;
        }
    },
    hooks: {
        'HOOK_DIRECTOR_PRE_PROMPT': {
            priority: 28,
            mode: 'parallel',
            run: async (turnContext, tools) => {
                const briefOptions = {
                    turnNumber: turnContext.turnNumber,
                    includeCurrent: false,
                    limit: 6,
                    maxAgeTurns: 4
                };
                const [brief, immediateBrief] = await Promise.all([
                    logic.getQuestProgressBrief(turnContext, tools, briefOptions),
                    logic.getQuestImmediateReminderBrief(turnContext, tools, briefOptions)
                ]);
                if (!brief && !immediateBrief) return;

                const contentByKey = {};
                if (brief) {
                    contentByKey.consequences = tools.prompt.wrap('quest_outcome_consequences', brief);
                }
                if (immediateBrief) {
                    contentByKey.immediate_reminder = tools.prompt.wrap('quest_outcome_immediate_reminder', immediateBrief);
                }
                tools.prompt.contribute('quest_director_outcomes', contentByKey);
                tools.director?.cot?.add?.({
                    id: 'quest_tracker.outcome_consequences',
                    step: '13.4Q',
                    title: 'Quest Outcome Consequences',
                    content: 'Read <quest_outcome_consequences> and <quest_outcome_immediate_reminder> when present. If a quest was completed, failed, expired, or dropped, the Writer Brief must preserve that consequence. Do not list active quests; only route resolved outcomes into mandatory orders when they affect this scene.'
                });
            }
        },
        'HOOK_FRONTEND_INJECTION': {
            priority: 26,
            mode: 'parallel',
            run: async (_context, tools) => {
                try {
                    const [css, js] = await Promise.all([
                        fs.readFile(path.join(__dirname, 'ui.css'), 'utf8'),
                        fs.readFile(path.join(__dirname, 'ui.js'), 'utf8')
                    ]);
                    return { id: 'quest_tracker', css, js };
                } catch (error) {
                    tools.logger.error('Frontend', `Failed to read frontend injection files for quest_tracker: ${error.message}`);
                    return null;
                }
            }
        },
        'HOOK_POST_ORCHESTRATOR': {
            priority: 8,
            mode: 'parallel',
            run: async (turnContext, tools) => {
                const briefOptions = {
                    turnNumber: turnContext.turnNumber,
                    includeCurrent: false,
                    limit: 6,
                    maxAgeTurns: 4
                };
                const [brief, immediateBrief] = await Promise.all([
                    logic.getQuestProgressBrief(turnContext, tools, briefOptions),
                    logic.getQuestImmediateReminderBrief(turnContext, tools, briefOptions)
                ]);
                if (!brief && !immediateBrief) return;

                const contentByKey = {};
                if (brief) {
                    contentByKey.consequences = tools.prompt.wrap('quest_outcome_consequences', brief);
                }
                if (immediateBrief) {
                    contentByKey.immediate_reminder = tools.prompt.wrap('quest_outcome_immediate_reminder', immediateBrief);
                }
                tools.prompt.contribute('quest_writer_outcomes', contentByKey);
            }
        },
        'HOOK_VN_BACKGROUND_TASKS': {
            priority: 50,
            mode: 'parallel',
            useSharedVnLlm: true,
            run: async (turnContext, tools) => {
                await tools.jobs.withJob('Updating story threads...', {
                    id: 'quest_tracker_update',
                    scope: 'turn',
                    rethrow: false,
                    notifyOnComplete: false
                }, async (job) => {
                    job.progress(20, 'Preparing story objective context...');
                    const state = await logic.updateQuestTracker(turnContext, tools);
                    job.progress(90, 'Refreshing story objective HUD...');
                    const settings = await Promise.resolve(tools.settings.getSelf());
                    if (settings.enabled_in_hud !== false) {
                        const registry = await logic.getQuestRegistryForContext(turnContext, tools, {
                            turnNumber: turnContext.turnNumber
                        });
                        logic.registerQuestNotificationIntercepts(turnContext, tools, registry, settings);
                        const projection = logic.projectQuestRegistryForDialogue(registry, {
                            turnNumber: turnContext.turnNumber,
                            dialogueIndex: null
                        });
                        const projectedState = logic.projectObjectiveStateForDialogue(state, {
                            turnNumber: turnContext.turnNumber,
                            dialogueIndex: null
                        });
                        tools.socket.emit('quest-tracker-data', {
                            enabledInHud: true,
                            turnNumber: turnContext.turnNumber,
                            dialogueIndex: null,
                            state: projectedState,
                            registry: projection.registry,
                            pendingNotifications: [],
                            notificationSettings: {
                                enabled: settings.quest_notifications_enabled !== false,
                                sfx: settings.quest_notification_sfx || 'success_jingle.wav',
                                durationMs: settings.quest_notification_duration_ms || 4200
                            }
                        });
                    }
                    job.progress(100, 'Story threads updated.');
                });
            }
        }
    },
    socketListeners: {
        'quest-tracker-fetch-data': async (data, tools) => {
            try {
                const settings = await Promise.resolve(tools.settings.getSelf());
                if (settings.enabled_in_hud === false) {
                    tools.socket.emit('quest-tracker-data', { enabledInHud: false, state: null });
                    return;
                }

                let context = tools.turnContext;
                if (data?.turnNumber) {
                    const historicalTurn = await tools.turns.get(data.turnNumber);
                    if (historicalTurn?.context) context = historicalTurn.context;
                }
                const dialogueIndex = Number.isFinite(Number(data?.dialogueIndex))
                    ? Math.max(0, Math.round(Number(data.dialogueIndex)))
                    : null;

                const state = await logic.getObjectiveStateForContext(context, tools);
                const registry = await logic.getQuestRegistryForContext(context, tools, {
                    turnNumber: context?.turnNumber || data?.turnNumber || null
                });
                const projection = logic.projectQuestRegistryForDialogue(registry, {
                    turnNumber: context?.turnNumber || data?.turnNumber || null,
                    dialogueIndex
                });
                const projectedState = logic.projectObjectiveStateForDialogue(state, {
                    turnNumber: context?.turnNumber || data?.turnNumber || null,
                    dialogueIndex
                });
                tools.socket.emit('quest-tracker-data', {
                    enabledInHud: true,
                    turnNumber: context?.turnNumber || data?.turnNumber || null,
                    dialogueIndex,
                    state: projectedState,
                    registry: projection.registry,
                    pendingNotifications: settings.quest_notifications_enabled === false ? [] : projection.pendingNotifications,
                    notificationSettings: {
                        enabled: settings.quest_notifications_enabled !== false,
                        sfx: settings.quest_notification_sfx || 'success_jingle.wav',
                        durationMs: settings.quest_notification_duration_ms || 4200
                    }
                });
            } catch (error) {
                tools.logger.error('QuestTracker', `Failed to fetch quest tracker data: ${error.message}`);
                tools.socket.emit('quest-tracker-data', {
                    enabledInHud: true,
                    error: error.message,
                    state: null
                });
            }
        },
        'quest-tracker-request-full-log': async (data, tools) => {
            try {
                let context = tools.turnContext;
                let turnNumber = data?.turnNumber;
                if (turnNumber === undefined || turnNumber === null) {
                    try {
                        const latestTurn = await tools.turns.getLatest({ fallbackToCurrent: true });
                        turnNumber = latestTurn?.turnNumber || context?.turnNumber || 1;
                    } catch {
                        turnNumber = context?.turnNumber || 1;
                    }
                }
                if (turnNumber && Number(turnNumber) !== Number(context?.turnNumber)) {
                    const historicalTurn = await tools.turns.get(turnNumber);
                    if (historicalTurn?.context) context = historicalTurn.context;
                }
                const dialogueIndex = Number.isFinite(Number(data?.dialogueIndex))
                    ? Math.max(0, Math.round(Number(data.dialogueIndex)))
                    : null;

                const registry = await logic.getQuestRegistryForContext(context, tools, { turnNumber });
                const projection = logic.projectQuestRegistryForDialogue(registry, { turnNumber, dialogueIndex });
                let styles = '';
                try {
                    styles = await fs.readFile(path.join(__dirname, 'ui.css'), 'utf8');
                } catch { }

                tools.socket.emit('vn-hud-show-modal', {
                    title: `Story Quest Log (${projection.registry.length}) - Turn ${turnNumber}`,
                    html: logic.buildQuestLogModalHtml(projection.registry, { turnNumber, dialogueIndex }),
                    styles,
                    scope: 'canvas',
                    modalClass: 'quest-log-modal'
                });
            } catch (error) {
                tools.logger.error('QuestTracker', `Failed to open quest log: ${error.message}`);
                tools.socket.emit('vn-hud-show-modal', {
                    title: 'Story Quest Log',
                    html: '<div class="quest-log-empty">Quest log is unavailable right now.</div>',
                    scope: 'canvas',
                    modalClass: 'quest-log-modal'
                });
            }
        }
    }
};

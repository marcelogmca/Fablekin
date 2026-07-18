const logic = require('./logic.js');
const fs = require('fs/promises');
const path = require('path');

module.exports = {
    id: 'narrative_pacing',
    name: 'Narrative Pacing & Strategy',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Narrative',
    experimental: true,
    wizard: {
        include: true,
        order: 220,
        group: 'Narrative',
        label: 'Narrative Pacing',
        recommended_enabled: true,
        author_note: 'Recommended for sessions that otherwise rush emotional or plot beats.',
        enabled_note: 'Adds pacing analysis and guidance so scenes can slow down, escalate, or resolve at better times.',
        disabled_note: 'The writer has less explicit pressure to manage rhythm and scene tempo.',
        settings_note: 'Tune pacing model, thresholds, and intervention strength in plugin settings.'
    },
    description: 'Analyzes pacing in scenes and suggests strategies to the writer based on a target budget.',
    exports: {
        getInitialPacingSynthesis: async (turnContext, tools) => {
            return await logic.getInitialPacingSynthesis(turnContext, tools);
        },
        getCurrentPacingSynthesis: async (turnContext, tools) => {
            return await logic.getCurrentPacingSynthesis(turnContext, tools);
        }
    },

    hooks: {
        'HOOK_CONTENT_MANAGER_GUI_READY': async (turnContext, tools) => {
            const metadata = await tools.project.getMetadata();
            const budget = metadata?.pacing_budget || logic.DEFAULT_PACING_BUDGET;

            const presetsPath = path.join(__dirname, 'presets.json');
            let presets = {};
            try {
                const data = await fs.readFile(presetsPath, 'utf8');
                presets = JSON.parse(data);
            } catch {
                // Ignore if not present
            }

            const panelOpen = metadata?.pacing_panel_open !== undefined ? metadata.pacing_panel_open : false;
            const html = logic.getGuiHtml(budget, presets, panelOpen);
            const css = logic.getGuiCss();
            const js = logic.getGuiJs();

            tools.gui.inject({
                html: html,
                css: css,
                js: js,
                selector: '#plugin-injection-container'
            }, 'content_manager');
        },

        'HOOK_VN_BACKGROUND_TASKS': {
            priority: 100,
            mode: 'sequential',
            run: async (turnContext, tools) => {
                const settings = await tools.settings.getSelf();
                await logic.scoreAndSavePacing(turnContext, tools, settings).catch(err => {
                    tools.logger.error('Failed to score pacing', err);
                });
                await logic.recordCharacterTurnStats(turnContext, tools, settings).catch(err => {
                    tools.logger.error('Failed to record narrative pacing character stats', err);
                });
                await logic.runCharacterCleanup(turnContext, tools, settings).catch(err => {
                    tools.logger.error('Failed to run narrative pacing character cleanup', err);
                });
            }
        },

        'HOOK_DIRECTOR_PRE_PROMPT': {
            priority: 50,
            mode: 'sequential',
            run: async (turnContext, tools) => {
                const settings = await tools.settings.getSelf();
                await logic.synthesizePacingStrategy(turnContext, tools, settings);
            }
        }
    },

    socketListeners: {
        'save-pacing-budget': async (data, tools) => {
            try {
                const metadata = await tools.project.getMetadata();
                metadata.pacing_budget = data.budget;
                await tools.project.updateMetadata(metadata);
                tools.socket.emit('save-pacing-budget-response', { success: true });
                tools.logger.log('Pacing budget saved successfully.');
            } catch (err) {
                tools.logger.error('Error saving pacing budget', err);
                tools.socket.emit('save-pacing-budget-response', { success: false, error: err.message });
            }
        },
        'save-pacing-preset': async (data, tools) => {
            try {
                const presetsPath = path.join(__dirname, 'presets.json');
                let presets = {};
                try {
                    const fileData = await fs.readFile(presetsPath, 'utf8');
                    presets = JSON.parse(fileData);
                } catch { }

                presets[data.name] = data.budget;
                await fs.writeFile(presetsPath, JSON.stringify(presets, null, 4));

                tools.socket.emit('save-pacing-preset-response', { success: true, name: data.name, budget: data.budget });
                tools.logger.log(`Pacing preset '${data.name}' saved successfully.`);
            } catch (err) {
                tools.logger.error('Error saving pacing preset', err);
                tools.socket.emit('save-pacing-preset-response', { success: false, error: err.message });
            }
        },
        'delete-pacing-preset': async (data, tools) => {
            try {
                const presetsPath = path.join(__dirname, 'presets.json');
                let presets = {};
                try {
                    const fileData = await fs.readFile(presetsPath, 'utf8');
                    presets = JSON.parse(fileData);
                } catch { }

                if (presets[data.name]) {
                    delete presets[data.name];
                    await fs.writeFile(presetsPath, JSON.stringify(presets, null, 4));
                }

                tools.socket.emit('delete-pacing-preset-response', { success: true, name: data.name });
                tools.logger.log(`Pacing preset '${data.name}' deleted successfully.`);
            } catch (err) {
                tools.logger.error('Error deleting pacing preset', err);
                tools.socket.emit('delete-pacing-preset-response', { success: false, error: err.message });
            }
        },
        'save-pacing-panel-state': async (data, tools) => {
            try {
                const metadata = await tools.project.getMetadata();
                metadata.pacing_panel_open = data.open;
                await tools.project.updateMetadata(metadata);
            } catch (err) {
                tools.logger.error('Error saving pacing panel state', err);
            }
        }
    },
    timelineProviders: [
        {
            type: 'branch',
            side: 'left',
            fn: async (turnContext, tools) => {
                const projectName = turnContext.projectName;
                if (!projectName) return null;
                const targetTurn = turnContext.turnNumber;

                try {
                    const facts = await tools.db.chat.query(
                        `SELECT target as metric, fact_value as score
                         FROM facts 
                         WHERE project_name = ? 
                           AND predicate = 'pacing_score' 
                           AND turn_number = ?
                         ORDER BY id DESC`,
                        [projectName.toLowerCase(), targetTurn]
                    );

                    if (!facts || facts.length === 0) return null;

                    let totalScore = 0;
                    const scores = {};
                    for (const fact of facts) {
                        const val = parseFloat(fact.score) || 0;
                        totalScore += val;
                        scores[fact.metric] = val;
                    }

                    if (totalScore === 0) return null;

                    const percentages = {};
                    for (const metric in scores) {
                        percentages[metric] = ((scores[metric] / totalScore) * 100).toFixed(0);
                    }

                    const sortedMetrics = Object.entries(percentages)
                        .filter(([_, val]) => parseFloat(val) > 0)
                        .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));

                    const breakdown = sortedMetrics.map(([m, val]) =>
                        `<span style="color:var(--text-color); font-weight:600;">${m.toUpperCase()}</span> <span style="color:var(--accent);">${val}%</span>`
                    ).join(' &nbsp;|&nbsp; ');

                    return {
                        icon: '⏱️',
                        label: 'Scene Pacing',
                        content: breakdown,
                        children: []
                    };
                } catch (e) {
                    tools.logger.error('Failed to provide pacing timeline data', e);
                    return null;
                }
            }
        }
    ],

    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'The "Invisible Hand" of your story. Analyzes narrative momentum and tension to guide the Director AI between high-intensity action and emotional wind-downs.'
        },
        PLUGIN_TECHNICAL_OVERVIEW: {
            type: 'description',
            content: 'Analyzes structural flow using multi-turn tension modeling. It maintains a "Running Pacing Ledger" comparing actual development against a target budget and informs the Director with pacing synthesis.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'High',
            immersion: 'None',
            cost: 'Low',
            latency: 'Low'
        },
        min_turns_threshold: {
            type: 'number',
            label: 'Min Turns Before Synthesis',
            description: 'The narrative engine will wait this many turns before it starts suggesting pacing adjustments based on history.',
            min: 1,
            max: 20,
            default: 2
        },
        enable_character_stats: {
            type: 'checkbox',
            label: 'Track Character Turn Stats',
            description: 'Stores per-turn dialogue stats (lines/chars) for each speaking character. Used by cleanup heuristics.',
            default: true
        },
        enable_character_cleanup: {
            type: 'checkbox',
            label: 'Enable Character Cleanup',
            description: 'Periodically demotes likely garbage MAJOR entries to MINOR using conservative heuristics.',
            default: false
        },
        character_cleanup_frequency: {
            type: 'number',
            label: 'Character Cleanup Frequency (Turns)',
            description: 'How often the cleanup cycle runs.',
            min: 3,
            max: 100,
            default: 10
        },
        character_cleanup_min_total_lines: {
            type: 'number',
            label: 'Cleanup Min Total Lines',
            description: 'Characters below this lifetime line count are considered low-signal.',
            min: 0,
            max: 50,
            default: 3
        },
        character_cleanup_min_turns_seen: {
            type: 'number',
            label: 'Cleanup Min Turns Seen',
            description: 'Characters seen in fewer turns than this are considered low-signal.',
            min: 1,
            max: 20,
            default: 2
        },
        character_cleanup_stale_turns: {
            type: 'number',
            label: 'Cleanup Stale Turns',
            description: 'Low-signal MAJOR characters older than this many turns since last seen can be demoted.',
            min: 1,
            max: 200,
            default: 12
        },
        scoring_model: {
            type: 'select',
            label: 'Scoring Model',
            description: 'Model used to analyze and score the pacing of each individual scene.',
            options: 'llm-aliases',
            default: { model: 'mediumendmodel' }
        }
    }
};

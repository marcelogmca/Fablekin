const logic = require('./logic.js');

module.exports = {
    id: 'character_echoes',
    name: 'Character Echoes',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Characters',
    experimental: true,
    wizard: {
        include: true,
        order: 440,
        group: 'Characters',
        label: 'Character Echoes',
        recommended_enabled: false,
        author_note: 'Optional depth layer; useful when you want reflective inner lives for major characters.',
        enabled_note: 'Periodically generates introspective character reflections for later narrative guidance.',
        disabled_note: 'Character depth relies on ordinary scene text, sheets, and memory systems.',
        settings_note: 'Tune echo frequency, questions, delay, and model in plugin settings.'
    },
    description: 'Periodically interviews core characters with introspective questions, adding depth and self-awareness to guide less repetitive storytelling.',
    dependencies: [
        { id: 'character_sheets', reason: 'Required source material for each character\'s private questions, motives, and ongoing inner life.' }
    ],

    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Gives your characters a private inner voice. Every few turns, core characters are "pulled aside" and asked introspective questions — about their goals, frustrations, and observations — generating personal reflections that can later guide the narrative.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'Medium',
            immersion: 'Low',
            cost: 'Medium',
            latency: 'Medium'
        },
        echo_frequency: {
            type: 'number',
            label: 'Echo Frequency (Turns)',
            description: 'How often to run the introspection cycle.',
            default: 5,
            min: 2,
            max: 50
        },
        questions_per_session: {
            type: 'number',
            label: 'Questions Per Character',
            description: 'How many random questions to ask each character per session.',
            default: 3,
            min: 1,
            max: 8
        },
        inter_character_delay: {
            type: 'number',
            label: 'Delay Between Characters (ms)',
            description: 'Pause between sequential LLM calls to allow prompt caching. 5000ms recommended.',
            default: 5000,
            min: 0,
            max: 15000
        },
        include_player: {
            type: 'checkbox',
            label: 'Include Player Character',
            description: 'If enabled, the player character will also be asked to reflect (as if in a journal).',
            default: false
        },
        model_def: {
            type: 'select',
            label: 'Introspection Model',
            description: 'The LLM model used for character introspection. A high-end model is recommended for better "voice".',
            options: 'llm-aliases',
            default: { model: 'highendmodel' }
        },
        echo_directives: {
            type: 'project-directive',
            label: 'Internal Monologue & Thought Style',
            description: 'Define how character thoughts, introspection, and internal voices should be expressed during echo sessions.',
            placeholder: 'e.g., "Thoughts should be stream-of-consciousness and reveal hidden insecurities. Focus on the character\'s immediate sensory regrets."',
            isProjectDirective: true
        }
    },

    hooks: {
        'HOOK_VN_BACKGROUND_TASKS': {
            priority: 40, // After character_sheets (P20/30)
            mode: 'background',
            run: async (turnContext, tools) => {
                await logic.runEchoSession(turnContext, tools);
            }
        }
    },

    terminalCommands: {
        '/echoes': {
            description: 'Inspect character introspection echoes. Usage: /echoes [show|history] [character_name]',
            run: async (args, tools) => {
                const colors = { reset: "\x1b[0m", bright: "\x1b[1m", cyan: "\x1b[36m", yellow: "\x1b[33m" };
                const subcommand = args[0]?.toLowerCase();
                const charName = args[1]?.toLowerCase();
                const projectName = tools.turnContext.projectName.toLowerCase();

                if (subcommand === 'show' && charName) {
                    const currentTurn = tools.turnContext.turnNumber || 0;
                    const rows = await tools.db.chat.query(
                        `SELECT predicate, fact_value, turn_number FROM facts 
                         WHERE project_name = ? AND source = ? AND predicate LIKE 'ECHO:%' 
                         AND turn_number <= ? 
                         ORDER BY turn_number DESC, id DESC LIMIT 10`,
                        [projectName, charName, currentTurn]
                    );

                    if (!rows || rows.length === 0) return `No echoes found for ${args[1]}.`;

                    let output = `\r\n${colors.bright}Latest Echoes for ${args[1]}:${colors.reset}\r\n`;
                    rows.forEach(r => {
                        if (r.predicate === 'ECHO:monologue') {
                            output += `${colors.yellow}[Monologue] (Turn ${r.turn_number})${colors.reset}:\r\n"${r.fact_value}"\r\n\n`;
                        } else {
                            const questionId = r.predicate.replace('ECHO:', '');
                            output += `${colors.yellow}[${questionId}] (Turn ${r.turn_number})${colors.reset}: ${r.fact_value}\r\n\n`;
                        }
                    });
                    return output;
                }

                if (subcommand === 'history') {
                    const currentTurn = tools.turnContext.turnNumber || 0;
                    const rows = await tools.db.chat.query(
                        `SELECT DISTINCT turn_number FROM facts 
                         WHERE project_name = ? AND predicate LIKE 'ECHO:%' 
                         AND turn_number <= ? 
                         ORDER BY turn_number DESC LIMIT 10`,
                        [projectName, currentTurn]
                    );
                    if (!rows || rows.length === 0) return 'No echo history found.';

                    let output = `\r\n${colors.bright}Recent Echo Sessions:${colors.reset}\r\n`;
                    rows.forEach(r => {
                        output += ` - Turn ${r.turn_number}\r\n`;
                    });
                    return output;
                }

                return 'Usage: /echoes show [character_name] | /echoes history';
            }
        }
    },

    exports: {
        getLatestEchoes: async (context, tools, charName, opts) => {
            return await logic.getLatestEchoes(charName, opts?.turnNumber, tools);
        }
    }
};

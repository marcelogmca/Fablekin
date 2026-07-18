// Runtime, turn, and fact state have different lifetimes; keep persisted facts plugin-scoped.
const PLUGIN_ID = 'example_plugin_state';

module.exports = {
    id: PLUGIN_ID,
    name: 'Example: Plugin State and Facts',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates runtime state, persisted turn state, and scoped fact writes.',

    timelineProviders: [
        {
            type: 'card',
            side: 'right',
            fn: async (turnContext, tools) => {
                const projectName = String(turnContext?.projectName || '').trim().toLowerCase();
                const turnNumber = Number(turnContext?.turnNumber);
                if (!projectName || !Number.isInteger(turnNumber)) return null;

                const rows = await tools.db.chat.query(
                    'SELECT fact_value, context FROM facts WHERE project_name = ? AND plugin_id = ? AND predicate = ? AND turn_number = ? ORDER BY id DESC LIMIT 1',
                    [projectName, PLUGIN_ID, 'example_execution_count', turnNumber]
                );
                const fact = rows?.[0];
                if (!fact) return null;

                return {
                    icon: 'S',
                    title: 'Example Plugin State',
                    fields: [
                        { label: 'Executions', value: String(fact.fact_value || '0') },
                        { label: 'Context', value: String(fact.context || `Turn ${turnNumber}`) }
                    ]
                };
            }
        }
    ],

    hooks: {
        HOOK_TURN_START: {
            priority: 100,
            run: async (turnContext, tools) => {
                const runtime = tools.pluginState.runtime({ executions: 0 });
                const turn = tools.pluginState.turn({ executions: 0 });
                runtime.executions += 1;
                turn.executions += 1;
                turn.turnNumber = turnContext.turnNumber;
            }
        },
        HOOK_POST_DB_UPDATE: {
            priority: 100,
            run: async (turnContext, tools) => {
                const turn = tools.pluginState.turn({ executions: 0 });
                await tools.facts.cleanUpFactsDb({ predicates: ['example_execution_count'] });
                await tools.facts.appendToFactsDb({
                    source: PLUGIN_ID,
                    target: '',
                    predicate: 'example_execution_count',
                    fact_value: String(turn.executions || 0),
                    context: `Example state for turn ${turnContext.turnNumber}`
                });
            }
        }
    },

    terminalCommands: {
        '/example-state': {
            description: 'Shows this plugin state and its latest scoped fact.',
            run: async (_args, tools) => {
                const runtime = tools.pluginState.runtime({ executions: 0 });
                const turn = tools.pluginState.turn({ executions: 0 });
                const rows = await tools.db.chat.query(
                    'SELECT turn_key, fact_value FROM facts WHERE project_name = ? AND plugin_id = ? AND predicate = ? ORDER BY id DESC LIMIT 1',
                    [String(tools.turnContext?.projectName || '').toLowerCase(), PLUGIN_ID, 'example_execution_count']
                );
                return JSON.stringify({
                    runtimeExecutions: runtime.executions || 0,
                    turnExecutions: turn.executions || 0,
                    latestFact: rows?.[0] || null
                }, null, 2);
            }
        }
    }
};

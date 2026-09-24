const logic = require('./logic.js');
const { parseCommandArguments } = require('../../modules/agent_text_interpreter.js');

function parseAgentList(value) {
    if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function clampAgentLimit(value, fallback = 4) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(8, parsed));
}

function createNarrativeArchitectAgentTool(turnContext, tools) {
    return {
        name: 'narrative_architect',
        description: [
            'Retrieve distilled structural references from Narrative Architect.',
            'Commands: current [--limit N] uses the cached story match;',
            'search [--tags "tag_a,tag_b"] [--series "Series A,Series B"] [--limit N] selects references for diagnosed needs.',
            'References are inspiration for pacing and structure, never plots to copy.'
        ].join(' '),
        schema: {
            type: 'object',
            required: ['command'],
            properties: { command: { type: 'string' } }
        },
        execute: async (args = {}) => {
            const command = String(args.command || '');
            const parsed = parseCommandArguments(command);
            if (!['current', 'search'].includes(parsed.verb)) {
                throw new Error('Unsupported architect command. Use current or search.');
            }

            const settings = await tools.settings.getSelf() || {};
            const isSearch = parsed.verb === 'search';
            const payload = await logic.getStructuralPatterns(turnContext, tools, settings, {
                mode: 'agent_research',
                limit: clampAgentLimit(parsed.options.limit, 4),
                tags: isSearch ? parseAgentList(parsed.options.tags) : [],
                series: isSearch ? parseAgentList(parsed.options.series) : [],
                forceReselect: isSearch
            });

            return {
                command,
                mode: parsed.verb,
                ...payload
            };
        }
    };
}

module.exports = {
    id: 'narrative_architect',
    name: 'Narrative Architect',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Narrative',
    wizard: {
        include: true,
        order: 200,
        group: 'Narrative',
        label: 'Narrative Architect',
        recommended_enabled: true,
        author_note: 'Recommended for reducing repetitive scene shapes and improving long-form structure.',
        enabled_note: 'Planning modules get structural references for pacing, tension, and emotional rhythm.',
        disabled_note: 'Planner output becomes more generic and may repeat familiar scene patterns more often.',
        settings_note: 'Tune structural matching, cooldown, and quality mode in plugin settings.'
    },
    description: 'Provides structural guidance from acclaimed episodes so planning modules can avoid cliches and improve pacing quality.',
    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Prevents repetitive and predictable scene structures by giving the planning layer a professional structural reference for pacing, tension, and emotional rhythm.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'High',
            immersion: 'None',
            cost: 'Low',
            latency: 'Low'
        },
        model_def: {
            type: 'select',
            label: 'Tag Extraction Model',
            description: 'The cheap LLM model used to analyze a chapter batch when Grand Story Planner requests it.',
            options: 'llm-aliases',
            allowVnBackgroundModel: true,
            default: { inherit: 'vn_background' }
        },
        max_cooldown: {
            type: 'number',
            label: 'Episode Cooldown (Turns)',
            description: 'Number of turns to wait before an episode structure can be reused.',
            default: 5,
            min: 1,
            max: 50
        },
        context_depth: {
            type: 'number',
            label: 'Legacy Context Depth',
            description: 'Legacy fallback for batch size when Batch Chapter Limit is unavailable.',
            default: 3,
            min: 1,
            max: 10
        },
        batch_max_chapters: {
            type: 'number',
            label: 'Batch Chapter Limit',
            description: 'Maximum number of chapters to analyze together when Grand Story Planner requests a tag refresh.',
            default: 12,
            min: 1,
            max: 50
        },
        batch_chapter_max_chars: {
            type: 'number',
            label: 'Chars Per Chapter',
            description: 'Maximum digest length per chapter in the batched tag-extraction prompt.',
            default: 900,
            min: 200,
            max: 2400
        },
        enable_quality_mode: {
            type: 'checkbox',
            label: 'Enable Quality Mode (Experimental)',
            description: 'If top candidates tie, use an additional cheap LLM call to refine the selection.',
            default: false
        },
        disable_llm: {
            type: 'checkbox',
            label: 'Disable LLM Selection',
            description: 'If enabled, the plugin will skip LLM analysis and pick a random episode (respecting cooldown). Cheaper but less context-aware.',
            default: false
        },
        planner_reference_limit: {
            type: 'number',
            label: 'Planner Reference Count',
            description: 'How many structural references should be returned to the Grand Story Planner service call.',
            default: 4,
            min: 1,
            max: 8
        }
    },
    exports: {
        getAgentTools: async (turnContext, tools) => {
            return [createNarrativeArchitectAgentTool(turnContext, tools)];
        },
        getPlannerStructuralGuidance: async (turnContext, tools, options = {}) => {
            const settings = await tools.settings.getSelf();
            return await logic.getPlannerStructuralGuidance(turnContext, tools, settings || {}, options || {});
        },
        getStructuralPatterns: async (turnContext, tools, options = {}) => {
            const settings = await tools.settings.getSelf();
            return await logic.getStructuralPatterns(turnContext, tools, settings || {}, options || {});
        }
    },
    hooks: {
        /**
         * Narrative Architect never schedules itself. Grand Story Planner places a
         * request in this plugin's TurnContext runtime slot when its own run is due.
         */
        'HOOK_NARRATIVE_START': {
            priority: 2,
            mode: 'background',
            run: async (turnContext, tools) => {
                const state = tools.pluginState.runtime();
                const request = state.taggingRequest;
                if (!request || request.requestedBy !== 'grand_story_planner') return;
                if (Number(request.requestedAtTurn) !== Number(turnContext.turnNumber)) return;
                if (request.status !== 'requested') return;

                request.status = 'running';
                request.startedAt = new Date().toISOString();
                const settings = await tools.settings.getSelf();
                await logic.processRequestedBatch(turnContext, tools, settings, request).then(result => {
                    request.status = result?.status || 'completed';
                    request.result = result || null;
                    request.completedAt = new Date().toISOString();
                }).catch(err => {
                    request.status = 'failed';
                    request.error = err.message;
                    tools.logger.error('Architect', `Error in Narrative Architect analysis: ${err.message}`);
                });
            }
        }
    },

    terminalCommands: {
        '/architect': {
            description: 'Inspect Structural Architect history and current state.',
            run: async (args, tools) => {
                const colors = { reset: "\x1b[0m", bright: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m" };
                const subcommand = args[0]?.toLowerCase();

                if (subcommand === 'current') {
                    const turnNumber = tools.turnContext?.turnNumber || 0;
                    const rows = await tools.db.chat.query(
                        `SELECT target, fact_value, context FROM facts 
                         WHERE project_name = ? AND predicate = 'architect_cache' 
                         AND turn_number <= ?
                         ORDER BY turn_number DESC, id DESC LIMIT 1`,
                        [tools.turnContext.projectName.toLowerCase(), turnNumber]
                    );

                    if (!rows || rows.length === 0) return 'No structural architect currently cached.';

                    const contextData = JSON.parse(rows[0].context || '{}');
                    const shownTags = Array.isArray(contextData.requestedTags) && contextData.requestedTags.length > 0
                        ? contextData.requestedTags
                        : (Array.isArray(contextData.tags) ? contextData.tags : []);
                    const shownSeries = Array.isArray(contextData.requestedSeries) && contextData.requestedSeries.length > 0
                        ? contextData.requestedSeries
                        : (Array.isArray(contextData.series) ? contextData.series : []);

                    const tagsStr = shownTags.length > 0 ? shownTags.slice(0, 5).join(', ') : 'None';
                    const seriesStr = shownSeries.length > 0 ? shownSeries.join(', ') : 'None';
                    let guidanceText = rows[0].fact_value;

                    try {
                        const payload = JSON.parse(rows[0].fact_value || '{}');
                        if (payload && payload.schema === 'architect_cache_v2') {
                            guidanceText = payload.guidanceBlock || rows[0].fact_value;
                        }
                    } catch { }

                    return `\r\n${colors.bright}Active Structural Reference:${colors.reset} ${colors.cyan}${rows[0].target}${colors.reset}\r\n` +
                        `${colors.yellow}Requested Tags:${colors.reset} ${tagsStr}\r\n` +
                        `${colors.yellow}Requested Series:${colors.reset} ${seriesStr}\r\n` +
                        `${guidanceText}\r\n`;
                }

                if (subcommand === 'history') {
                    const limit = parseInt(args[1]) || 5;
                    const turnNumber = tools.turnContext?.turnNumber || 0;
                    const rows = await tools.db.chat.query(
                        `SELECT turn_number, target, context FROM facts 
                         WHERE project_name = ? AND predicate = 'architect_used' 
                         AND turn_number <= ?
                         ORDER BY turn_number DESC LIMIT ?`,
                        [tools.turnContext.projectName.toLowerCase(), turnNumber, limit]
                    );

                    if (!rows || rows.length === 0) return 'No architect history found.';

                    let output = `\r\n${colors.bright}Architect History (Last ${rows.length}):${colors.reset}\r\n`;
                    rows.forEach(r => {
                        output += `  [Turn ${r.turn_number}] ${colors.cyan}${r.target}${colors.reset}\r\n`;
                    });
                    return output;
                }

                return 'Usage: /architect [current|history]';
            }
        }
    }
};

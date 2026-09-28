const logic = require('./logic.js');
const { parseCommandArguments } = require('../../modules/agent_text_interpreter.js');

function clampAgentLimit(value, fallback = 8) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(20, parsed));
}

function boundAgentText(value, maxChars = 12000) {
    const text = String(value || '');
    if (text.length <= maxChars) return { content: text, truncated: false };
    return { content: `${text.slice(0, maxChars - 22)}\n...[output truncated]`, truncated: true };
}

function createMemoryRecallAgentTool(turnContext, tools) {
    return {
        name: 'memory_recall',
        description: [
            'Retrieve continuity memories through the Memory Recall plugin.',
            'Commands: recall --subject "Name" [--query "topic"] [--domain personality|relationship|world|location|general] [--limit N];',
            'context [--query "topic"] [--limit N]. The recall command requires a subject.'
        ].join(' '),
        schema: {
            type: 'object',
            required: ['command'],
            properties: { command: { type: 'string' } }
        },
        execute: async (args = {}) => {
            const command = String(args.command || '');
            const parsed = parseCommandArguments(command);
            const limit = clampAgentLimit(parsed.options.limit, 8);

            if (parsed.verb === 'recall') {
                const subject = String(parsed.options.subject || parsed.positional.join(' ')).trim();
                if (!subject) throw new Error('recall requires --subject "Name".');
                const memories = await logic.getRelevantMemories(turnContext, tools, subject, {
                    query: parsed.options.query || '',
                    domain: parsed.options.domain,
                    limit
                });
                return {
                    command,
                    mode: 'recall',
                    subject,
                    domain: parsed.options.domain || 'general',
                    resultCount: memories.length,
                    memories
                };
            }

            if (parsed.verb === 'context') {
                const content = await logic.formatRecallContext(turnContext, tools, {
                    query: parsed.options.query || '',
                    characterLimit: limit,
                    personalityLimit: limit,
                    relationshipLimit: limit,
                    worldLimit: limit,
                    locationLimit: limit
                });
                return {
                    command,
                    mode: 'context',
                    ...boundAgentText(content)
                };
            }

            throw new Error('Unsupported memory command. Use recall or context.');
        }
    };
}

module.exports = {
    id: 'memory_recall',
    name: 'Memory Recall',
    author: 'Fablekin Core',
    version: '1.0.0',
    category: 'Memory',
    wizard: {
        include: true,
        order: 300,
        group: 'Memory',
        label: 'Memory Recall',
        recommended_enabled: true,
        author_note: 'Recommended once you expect campaigns to last more than a short test session.',
        enabled_note: 'Relevant memories about characters, relationships, locations, and world state are injected into prompts.',
        disabled_note: 'Long-term recall becomes weaker and continuity relies more on recent context.',
        settings_note: 'Tune recall limits and extraction thresholds in plugin settings.'
    },
    description: 'Stores and retrieves concise character, relationship, world, and location memories for prompt-time recall.',
    optionalDependencies: [
        { id: 'character_sheets', reason: 'Makes character-sheet facts available for more useful long-term recall.' },
        { id: 'personality_tracker', reason: 'Lets recalled memories include how characters have changed over time.' },
        { id: 'relationship_tracker', reason: 'Lets recall surface relevant relationship history and current tensions.' },
        { id: 'world_state_tracker', reason: 'Lets recall preserve facts about time, weather, inventory, and the wider world.' },
        { id: 'world_location_tracker', reason: 'Lets recall bring back places, travel, and location history.' }
    ],
    interludeMode: 'all',

    settingsSchema: {
        PLUGIN_BRIEF: {
            type: 'description',
            content: 'Injects concise remembered facts about characters, relationships, places, and world state into the prompt.'
        },
        PLUGIN_METRICS: {
            type: 'metrics',
            narrative_impact: 'High',
            immersion: 'Medium',
            cost: 'Low',
            latency: 'Low'
        },
        max_total_results: {
            type: 'number',
            label: 'Max Retrieval Results',
            description: 'Maximum number of memory candidates retrieved before ranking.',
            default: 48,
            min: 4,
            max: 80
        },
        per_character_limit: {
            type: 'number',
            label: 'Per Character Recall Limit',
            description: 'Default number of recall memories injected per character.',
            default: 8,
            min: 1,
            max: 20
        },
        world_recall_limit: {
            type: 'number',
            label: 'World Recall Limit',
            description: 'Number of world-level recall memories injected into dynamic knowledge.',
            default: 4,
            min: 1,
            max: 20
        },
        location_recall_limit: {
            type: 'number',
            label: 'Location Recall Limit',
            description: 'Number of location recall memories injected per active place.',
            default: 4,
            min: 1,
            max: 20
        },
        personality_per_character_limit: {
            type: 'number',
            label: 'Personality Recall Limit',
            description: 'Number of personality recall memories injected per active character.',
            default: 3,
            min: 1,
            max: 20
        },
        relationship_per_character_limit: {
            type: 'number',
            label: 'Relationship Recall Limit',
            description: 'Number of relationship recall memories injected per active character.',
            default: 8,
            min: 1,
            max: 20
        },
        active_character_limit: {
            type: 'number',
            label: 'Active Character Limit',
            description: 'Maximum number of active characters considered for dynamic recall injection.',
            default: 12,
            min: 1,
            max: 40
        },
        min_memory_length: {
            type: 'number',
            label: 'Minimum Memory Length',
            description: 'Ignore tiny or noisy extracted memories below this length.',
            default: 14,
            min: 8,
            max: 80
        }
    },

    exports: {
        getAgentTools: async (turnContext, tools) => {
            return [createMemoryRecallAgentTool(turnContext, tools)];
        },
        storeMemories: async (context, tools, memories, options = {}) => {
            return await logic.storeMemories(context, tools, memories, options);
        },
        getRelevantMemories: async (context, tools, characterName, options = {}) => {
            return await logic.getRelevantMemories(context, tools, characterName, options);
        },
        formatRecallBlock: async (context, tools, characterName, options = {}) => {
            return await logic.formatRecallBlock(context, tools, characterName, options);
        },
        formatRecallContext: async (context, tools, options = {}) => {
            return await logic.formatRecallContext(context, tools, options);
        }
    },

    hooks: {
        'HOOK_PRE_VN_GENERATION': {
            priority: 5,
            run: async (turnContext, tools) => {
                if (!turnContext?.turnNumber) return;
                await logic.cleanupCurrentTurn(turnContext, tools);
            }
        },
        'HOOK_POST_PROMPT_BUILDER': {
            priority: 45,
            mode: 'sequential',
            run: async (turnContext, tools) => {
                const settings = tools.settings.getSelf() || {};
                const recallContext = await logic.formatRecallContext(turnContext, tools, {
                    characterLimit: settings.active_character_limit
                });
                if (!recallContext) return;

                tools.prompt.contribute({
                    id: 'recalled_memories', to: 'root.dynamic_knowledge',
                    label: 'Recalled memories',
                    description: 'Continuity memories recalled for the current turn.',
                    children: { memories: recallContext }
                });
                tools.logger.runtime('Injected dynamic memory recall context into prompt.');
            }
        }
    }
};

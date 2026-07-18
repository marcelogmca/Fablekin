// Store only the model alias; global routing supplies provider and concrete model at call time.
const TONE_SCHEMA = {
    type: 'object',
    properties: {
        tone: { type: 'string', enum: ['calm', 'tense', 'hopeful', 'uncertain'] },
        guidance: { type: 'string', minLength: 1, maxLength: 240 }
    },
    required: ['tone', 'guidance']
};

module.exports = {
    id: 'example_prompt_llm',
    name: 'Example: Prompt and LLM',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates an alias-routed structured LLM call and validated prompt injection.',

    settingsSchema: {
        model_def: {
            type: 'select',
            label: 'Analysis Model',
            description: 'Global alias used for the example structured call.',
            options: 'llm-aliases',
            default: { model: 'lowendmodel' }
        }
    },

    hooks: {
        HOOK_POST_PROMPT_BUILDER: {
            priority: 100,
            run: async (turnContext, tools) => {
                const userPrompt = String(turnContext?.input?.userPrompt || '').trim();
                if (!userPrompt) return;
                const model = tools.settings.getSelf().model_def?.model;
                if (!model) throw new Error('Example Prompt and LLM requires a configured model alias.');

                try {
                    const response = await tools.llm.withSchema({
                        title: 'Example Tone Analysis',
                        messages: [
                            { role: 'system', content: 'Classify the requested scene tone and provide one short writing instruction.' },
                            { role: 'user', content: userPrompt }
                        ],
                        model,
                        params: {
                            retries: 1,
                            timeout: 30000,
                            temperature: 0.1,
                            max_tokens: 120,
                            callingModule: 'Plugin:example_prompt_llm'
                        }
                    }, TONE_SCHEMA);
                    const result = response.content;
                    const text = `Tone: ${result.tone}. Guidance: ${result.guidance}`;
                    tools.prompt.inject('simulation', tools.prompt.wrap('example_tone_guidance', text), 'root');
                } catch (error) {
                    tools.logger.warn(`Tone analysis skipped: ${error.message}`);
                }
            }
        }
    }
};

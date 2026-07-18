/**
 * Toolkit Demo Plugin
 * 
 * This plugin serves as a reference and testing ground for the new 
 * Plugin Manager Toolkit enhancements.
 */
module.exports = {
    id: 'toolkit_demo',
    name: 'Toolkit Demo',
    version: '1.0.0',
    category: 'Utility',
    experimental: true,
    description: 'Demonstrates tools.utils, tools.pipeline, tools.plugins.fireHook, and tools.llm.countTokens.',

    // settingsSchema allows the user to toggle features from the UI
    settingsSchema: {
        demoAbortion: {
            type: 'checkbox',
            label: 'Demo Pipeline Abort',
            description: 'If enabled, the next turn will be aborted before generation starts.',
            default: false
        },
        logTokenCounts: {
            type: 'checkbox',
            label: 'Log Token Counts',
            description: 'Log estimated token counts for incoming prompts.',
            default: true
        }
    },

    hooks: {
        /**
         * HOOK_PRE_PROMPT_BUILDER: Triggered before the prompt is assembled.
         */
        'HOOK_PRE_PROMPT_BUILDER': {
            priority: 1,
            run: async (context, tools) => {
                const settings = tools.settings.getSelf();
                tools.logger.log('ToolkitDemo', '--- Turn Start Demo ---', 'start');

                // 1. Test tools.utils
                const sampleText = "Hello World! This is a test string.";
                const crc = tools.utils.calculateCrc(sampleText);
                const hash = tools.utils.generateHash(sampleText, 'md5');
                tools.logger.log('ToolkitDemo', `Utils Test -> CRC: ${crc}, MD5: ${hash}`);

                // 2. Test tools.llm.countTokens
                if (settings.logTokenCounts) {
                    const estimatedTokens = tools.llm.countTokens(context.input.userPrompt || "");
                    tools.logger.log('ToolkitDemo', `LLM Test -> Estimated prompt tokens: ${estimatedTokens}`);
                }

                // 3. Test tools.plugins.fireHook (Inter-plugin communication)
                // We'll fire a custom hook that this same plugin (or others) can react to.
                tools.logger.log('ToolkitDemo', 'Firing custom event: TOOLKIT_DEMO_PING');
                await tools.plugins.fireHook('TOOLKIT_DEMO_PING', {
                    timestamp: Date.now(),
                    message: "Greetings from the demo plugin!"
                });

                // 4. Test tools.pipeline.abort
                if (settings.demoAbortion) {
                    tools.logger.log('ToolkitDemo', 'Testing Pipeline Abort...');
                    // This will stop the generation and notify the UI
                    tools.pipeline.abort('DEMO_ABORT: Pipeline abortion triggered by Toolkit Demo plugin settings.');
                }

                tools.logger.log('ToolkitDemo', '--- Turn Start Demo Finished ---', 'end');
            }
        },

        /**
         * Reaction to the custom hook fired above.
         */
        'TOOLKIT_DEMO_PING': {
            run: async (context, tools, payload) => {
                tools.logger.log('ToolkitDemo', `[REACTION] Received ping! Payload: ${JSON.stringify(payload)}`);
                tools.status.update('Demo: Custom hook received!', { color: '#00ff00', timeout: 3000 });
            }
        },

        /**
         * HOOK_PRE_WRITER: Demonstrates reading processed data and using utils.
         */
        'HOOK_PRE_WRITER': {
            run: async (context, tools) => {
                const writerBrief = context.processed.director?.writerBrief || "";
                if (writerBrief) {
                    const cleanBrief = tools.utils.normalizeText(writerBrief.substring(0, 50));
                    tools.logger.log('ToolkitDemo', `Pre-Writer Check -> Normalized brief snippet: ${cleanBrief}`);
                }
            }
        }
    }
};

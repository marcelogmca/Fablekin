// Timed payloads use milliseconds; line-scoped state uses line counts plus an explicit clear.
module.exports = {
    id: 'example_vn_client_events',
    name: 'Example: VN Client Events',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates one-shot, millisecond-timed, and line-scoped VN client events.',
    optionalDependencies: [
        { id: 'vn_pixijs_vfx', reason: 'Renders the example VFX events when installed.' }
    ],

    hooks: {
        HOOK_POST_DIALOGUE_PROCESSING: {
            priority: 100,
            run: async (turnContext, tools) => {
                const lines = turnContext?.processed?.dialogueProcessor?.processedLines;
                if (!Array.isArray(lines)) return;
                const dialogue = lines.filter(line => line?.type === 'dialogue');
                if (dialogue.length === 0) return;

                const addEvent = (line, event) => {
                    if (!Array.isArray(line.clientEvents)) line.clientEvents = [];
                    line.clientEvents.push(event);
                };

                addEvent(dialogue[0], {
                    type: 'vfx:trigger',
                    payload: { id: 'shockwave', intensity: 0.7 }
                });
                addEvent(dialogue[0], {
                    type: 'vfx:state',
                    payload: { id: 'snow', intensity: 0.45, duration: 3 }
                });
                addEvent(dialogue[Math.min(1, dialogue.length - 1)], {
                    type: 'vfx:start-rain',
                    payload: { intensity: 0.6, duration: 3000 }
                });
                if (dialogue.length > 3) {
                    addEvent(dialogue[3], {
                        type: 'vfx:clear',
                        payload: { id: 'snow' }
                    });
                }

                const prompt = await tools.plugins.tryCall(
                    'vn_pixijs_vfx',
                    'getVfxPrompt',
                    [],
                    { fallback: '', silent: true }
                );
                tools.logger.log(prompt ? 'VFX plugin API is available.' : 'VFX events were added without an installed renderer.');
            }
        }
    }
};

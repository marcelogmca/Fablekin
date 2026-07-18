// Director capabilities describe optional scene phases; planning notes shape the current Director pass.
const PLUGIN_ID = 'example_director_integration';

module.exports = {
    id: PLUGIN_ID,
    name: 'Example: Director Integration',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Narrative',
    isExamplePlugin: true,
    description: 'Demonstrates a Director capability, a project directive, and previous-turn feedback.',

    settingsSchema: {
        scene_guidance: {
            type: 'project-directive',
            label: 'Example Scene Guidance',
            description: 'Optional project-specific guidance used by this example during Director planning.',
            placeholder: 'For example: Favor quiet discoveries over sudden combat.',
            isProjectDirective: true
        }
    },

    hooks: {
        HOOK_DIRECTOR_PRE_PROMPT: {
            priority: 100,
            run: async (_turnContext, tools) => {
                const projectGuidance = tools.directives.getFormatted('scene_guidance', {
                    header: '### EXAMPLE PROJECT GUIDANCE'
                });
                const previousFeedback = await tools.director.getFeedback();

                tools.director.registerCapability({
                    phase: 'EXAMPLE_DISCOVERY',
                    description: 'An optional, low-stakes discovery beat that reveals one useful detail about the current setting.',
                    handoffHint: 'Use only when the scene has room for a brief discovery without interrupting urgent action.'
                });

                tools.director.cot.add({
                    id: `${PLUGIN_ID}.discovery_check`,
                    step: '13.9',
                    title: 'Consider an Example Discovery Beat',
                    content: [
                        'Consider whether one small environmental discovery would improve this scene. Do not force the beat.',
                        projectGuidance,
                        previousFeedback ? `Previous Director feedback:\n${previousFeedback}` : ''
                    ].filter(Boolean).join('\n\n')
                });
            }
        }
    }
};

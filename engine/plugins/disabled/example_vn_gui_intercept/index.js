// Keep scenario registration separate from backend work and frontend payload construction.
const payloads = require('./payloads');
const { TASK_EVENT, runLlmTask } = require('./backend');

const descriptors = [
    {
        interceptId: 'example_gui_backend',
        checkpoint: 'before_first_dialogue',
        priority: 10,
        blocking: true,
        replayPolicy: 'every_enter',
        timeoutMs: 50000,
        payload: { prompt: 'Give one short welcoming sentence for a fantasy story.' }
    },
    {
        interceptId: 'example_gui_chain_a',
        checkpoint: 'on_dialogue_enter',
        dialogueIndex: 1,
        priority: 20,
        blocking: true,
        replayPolicy: 'every_enter'
    },
    {
        interceptId: 'example_gui_chain_b',
        checkpoint: 'on_dialogue_enter',
        dialogueIndex: 1,
        priority: 21,
        blocking: true,
        replayPolicy: 'every_enter'
    },
    {
        interceptId: 'example_gui_banner',
        checkpoint: 'on_dialogue_enter',
        dialogueIndex: 2,
        priority: 100,
        blocking: false,
        durationMs: 1800,
        replayPolicy: 'once_per_turn'
    },
    {
        interceptId: 'example_gui_pixi',
        checkpoint: 'on_dialogue_enter',
        dialogueIndex: 4,
        priority: 30,
        blocking: true,
        renderer: 'pixi',
        replayPolicy: 'until_resolved',
        timeoutMs: 60000
    },
    {
        interceptId: 'example_gui_before_submit',
        checkpoint: 'before_submit',
        priority: 40,
        blocking: true,
        replayPolicy: 'every_enter'
    }
];

module.exports = {
    id: 'example_vn_gui_intercept',
    name: 'Example: VN GUI Intercepts',
    version: '4.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Advanced reference for blocking, chained, timed, backend-backed, and PixiJS VN intercepts.',

    settingsSchema: {
        model_def: {
            type: 'select',
            label: 'Backend Task Model',
            options: 'llm-aliases',
            default: { model: 'lowendmodel' }
        },
        retries: {
            type: 'number',
            label: 'Backend Task Retries',
            default: 1,
            min: 0,
            max: 5
        },
        timeout_ms: {
            type: 'number',
            label: 'Backend Task Timeout (ms)',
            default: 30000,
            min: 1000,
            max: 120000
        }
    },

    hooks: {
        HOOK_GUI_GATEKEEPER: {
            priority: 100,
            run: async (_context, tools) => {
                for (const descriptor of descriptors) {
                    tools.gui.registerRuntimeIntercept({ ...descriptor });
                }
                tools.gui.registerPersistentIntercept({
                    interceptId: 'example_gui_persisted_banner',
                    checkpoint: 'on_dialogue_enter',
                    dialogueIndex: 0,
                    priority: 190,
                    blocking: false,
                    durationMs: 1800,
                    replayPolicy: 'every_enter'
                });
            }
        }
    },

    exports: {
        guiIntercepts: {
            async example_gui_backend(_context, _tools, descriptor) {
                return payloads.backendGate(descriptor);
            },
            async example_gui_chain_a() {
                return payloads.chainStep('Chain step A', 'first');
            },
            async example_gui_chain_b() {
                return payloads.chainStep('Chain step B', 'second');
            },
            async example_gui_banner() {
                return payloads.banner('Once-per-turn non-blocking intercept');
            },
            async example_gui_persisted_banner() {
                return payloads.banner('Persisted intercept replay');
            },
            async example_gui_pixi() {
                return payloads.pixiTakeover();
            },
            async example_gui_before_submit() {
                return payloads.beforeSubmit();
            }
        }
    },

    socketListeners: {
        [TASK_EVENT]: runLlmTask
    }
};

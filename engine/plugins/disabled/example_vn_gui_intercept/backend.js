// The backend accepts an alias only and lets the central LLM layer resolve its route.
const TASK_EVENT = 'example_vn_gui_intercept:run-llm';
const REPLY_EVENT = 'example_vn_gui_intercept:llm-result';

async function runLlmTask(data, tools) {
    try {
        const settings = tools.settings.getSelf();
        const model = settings.model_def?.model;
        if (!model) throw new Error('Choose a model alias in this plugin\'s settings.');
        const prompt = String(data?.prompt || 'Give one short welcoming sentence.').trim();
        const response = await tools.llm.call([{ role: 'user', content: prompt }], {
            model,
            retries: Number(settings.retries ?? 1),
            timeout: Number(settings.timeout_ms ?? 30000),
            max_tokens: 100,
            callingModule: 'Plugin:example_vn_gui_intercept'
        });
        tools.socket.emit(REPLY_EVENT, {
            requestId: data?.requestId,
            ok: true,
            text: String(response.content || '')
        });
    } catch (error) {
        tools.socket.emit(REPLY_EVENT, {
            requestId: data?.requestId,
            ok: false,
            error: error.message
        });
    }
}

module.exports = { TASK_EVENT, REPLY_EVENT, runLlmTask };

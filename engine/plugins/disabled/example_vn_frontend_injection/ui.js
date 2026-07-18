// Persistent injections use the VN runtime, not the checkpoint-scoped intercept bridge.
(function initializeExampleFrontendInjection(context) {
    const PLUGIN_ID = 'example_vn_frontend_injection';
    const REQUEST_EVENT = `${PLUGIN_ID}:get-status`;
    const RESPONSE_EVENT = `${PLUGIN_ID}:status`;
    const root = document.getElementById(PLUGIN_ID);
    const status = root?.querySelector('[data-example-status]');
    const socket = context?.socket || window.socket;

    if (!root || !status || !socket || !window.VN?.pixiPlugins) return;

    window.VN.pixiPlugins.register(PLUGIN_ID, runtime => {
        const requestStatus = dialogueIndex => socket.emit(REQUEST_EVENT, { dialogueIndex });

        runtime.onSocket(RESPONSE_EVENT, payload => {
            if (!payload?.success) {
                status.textContent = 'Backend unavailable.';
                return;
            }
            const line = Number.isInteger(payload.dialogueIndex) ? ` Dialogue ${payload.dialogueIndex + 1}.` : '';
            status.textContent = `Turn ${payload.turnNumber}.${line}`;
        });

        runtime.onWindow('vn:dialogue-enter', event => {
            const index = Number(event?.detail?.dialogueIndex);
            requestStatus(Number.isInteger(index) ? index : null);
        });

        runtime.onDispose(() => root.remove());
        requestStatus(null);
    });
})(typeof context !== 'undefined' ? context : null);

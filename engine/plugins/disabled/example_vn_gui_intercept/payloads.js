// Injected handlers register lifecycle cleanup before they expose any exit action.
const { TASK_EVENT, REPLY_EVENT } = require('./backend');

const MODAL_CSS = `
    .example-intercept { width:min(680px,90vw); padding:24px; border:1px solid #5db8ff;
        border-radius:14px; background:#111a28; color:#eef6ff; box-shadow:0 18px 60px #0009; }
    .example-intercept h2 { margin:0 0 8px; }
    .example-intercept .actions { display:flex; gap:10px; margin-top:18px; flex-wrap:wrap; }
    .example-intercept button { padding:9px 14px; border:0; border-radius:8px; cursor:pointer;
        background:#55b5ff; color:#08131f; font-weight:700; }
    .example-intercept button.secondary { background:#aeb9c6; }
    .example-intercept output { display:block; margin-top:16px; padding:12px; background:#09111c;
        border-radius:8px; white-space:pre-wrap; }
`;

function backendGate(descriptor) {
    const prompt = descriptor?.payload?.prompt || 'Give one short welcoming sentence.';
    return {
        html: `<section class="example-intercept">
            <h2>Backend round trip</h2>
            <p>This blocking intercept asks the plugin backend to make an alias-routed LLM call.</p>
            <div class="actions"><button id="example-run">Run task</button>
            <button class="secondary" id="example-skip">Skip</button></div>
            <output id="example-output" hidden></output>
        </section>`,
        css: MODAL_CSS,
        js: `
            const requestId = 'gui-' + Date.now() + '-' + Math.random().toString(16).slice(2);
            const output = document.getElementById('example-output');
            let settled = false;
            const cleanup = () => {
                if (typeof socket.off === 'function') socket.off('${REPLY_EVENT}', onReply);
            };
            const finish = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                bridge.intercept.resolve(value);
            };
            const onReply = (message) => {
                if (message?.requestId !== requestId) return;
                cleanup();
                output.hidden = false;
                output.textContent = message.ok ? message.text : 'Task failed: ' + message.error;
                const done = document.createElement('button');
                done.textContent = 'Continue';
                done.onclick = () => finish({ backendTask: message.ok ? 'complete' : 'failed' });
                output.after(done);
            };
            socket.on('${REPLY_EVENT}', onReply);
            bridge.lifecycle.onDispose(cleanup);
            bridge.lifecycle.setTimeout(() => finish({ backendTask: 'timed_out' }), 45000);
            document.getElementById('example-run').onclick = () =>
                socket.emit('${TASK_EVENT}', { requestId, prompt: ${JSON.stringify(prompt)} });
            document.getElementById('example-skip').onclick = () => finish({ backendTask: 'skipped' });
        `
    };
}

function chainStep(label, nextChoice) {
    return {
        html: `<section class="example-intercept"><h2>${label}</h2>
            <p>Two blocking intercepts can run in priority order at one checkpoint.</p>
            <div class="actions"><button id="example-chain">Continue chain</button></div></section>`,
        css: MODAL_CSS,
        js: `
            const button = document.getElementById('example-chain');
            button.onclick = () => bridge.intercept.resolve({ chainChoice: '${nextChoice}' });
            bridge.lifecycle.onDispose(() => { button.onclick = null; });
        `
    };
}

function banner(text) {
    return {
        html: `<div class="example-banner">${text}</div>`,
        css: '.example-banner{position:fixed;top:24px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:999px;background:#102134ee;color:#dff2ff;border:1px solid #55b5ff;font-weight:700;}',
        js: 'bridge.lifecycle.onDispose(() => {});'
    };
}

function beforeSubmit() {
    return {
        html: `<section class="example-intercept"><h2>Before submit</h2>
            <p>Accept the current input, or reject this submission.</p>
            <div class="actions"><button id="example-accept">Accept</button>
            <button class="secondary" id="example-reject">Reject</button></div></section>`,
        css: MODAL_CSS,
        js: `
            const accept = document.getElementById('example-accept');
            const reject = document.getElementById('example-reject');
            accept.onclick = () => bridge.intercept.resolve({ accepted: true });
            reject.onclick = () => bridge.intercept.reject('example_rejected');
            bridge.lifecycle.onDispose(() => { accept.onclick = null; reject.onclick = null; });
        `
    };
}

function pixiTakeover() {
    return {
        renderer: 'pixi',
        js: `
            const { PIXI, pixiApp, pixiLayer, pluginRuntime, runId } = context;
            if (!pixiLayer) { bridge.takeover.abort('missing_pixi_layer'); return; }
            const app = pixiApp.app || pixiApp;
            const runtimeId = 'example_vn_gui_' + runId;
            const bg = new PIXI.Graphics().rect(0, 0, app.screen.width, app.screen.height)
                .fill({ color: 0x101b33, alpha: 0.96 });
            bg.eventMode = 'static';
            bg.cursor = 'pointer';
            pixiLayer.addChild(bg);
            const text = new PIXI.Text({ text:'GUI INTERCEPT TAKEOVER\\nClick to continue',
                style:{ fill:0xffffff, fontSize:30, align:'center' } });
            text.anchor.set(0.5);
            text.position.set(app.screen.width / 2, app.screen.height / 2);
            pixiLayer.addChild(text);
            const cleanup = () => pluginRuntime?.dispose?.(runtimeId);
            bridge.lifecycle.onDispose(cleanup);
            pluginRuntime?.register?.(runtimeId, runtime => runtime.onDispose(() => {
                bg.removeAllListeners(); bg.destroy(); text.destroy();
            }));
            bg.on('pointerdown', () => { cleanup(); bridge.takeover.finish({ clicked:true }); });
        `
    };
}

module.exports = { backendGate, chainStep, banner, beforeSubmit, pixiTakeover };

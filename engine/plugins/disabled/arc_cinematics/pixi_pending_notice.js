const { PIXI, pixiLayer, payload } = context || {};

if (!PIXI || !pixiLayer) {
    bridge.takeover.finish({ reason: 'pixi_unavailable' });
    return;
}

const app = context?.pixiApp?.app || context?.pixiApp || {};
const screen = app.screen || {};
const width = Number(screen.width) || 1920;
const height = Number(screen.height) || 1080;
const manifestPath = String(payload?.manifestPath || '').trim();
const requestId = String(payload?.requestId || '').trim();
const titleText = String(payload?.title || 'Arc Cinematic').trim();
const pollIntervalMs = Math.max(1000, Number(payload?.pollIntervalMs) || 2500);
const maximumWaitMs = Math.max(15000, Number(payload?.maximumWaitMs) || 600000);
const startedAt = Date.now();
let finished = false;
let lastStatus = payload?.initialStatus || null;

function isReady(status) {
    return status && status.ready === true;
}

if (isReady(lastStatus) || !manifestPath) {
    bridge.takeover.finish({
        reason: isReady(lastStatus) ? 'already_ready' : 'missing_manifest_path',
        status: lastStatus
    });
    return;
}

function makeText(text, style) {
    return new PIXI.Text({
        text,
        style: {
            fontFamily: 'Georgia',
            fontSize: 24,
            fill: 0xffffff,
            align: 'center',
            ...style
        }
    });
}

function drawRoundedRect(graphics, x, y, w, h, radius, fill, alpha = 1, stroke = null) {
    graphics.roundRect(x, y, w, h, radius);
    graphics.fill({ color: fill, alpha });
    if (stroke) graphics.stroke(stroke);
}

const root = new PIXI.Container();
root.sortableChildren = true;
pixiLayer.addChild(root);
bridge.lifecycle.onDispose(() => {
    try {
        root.destroy({ children: true });
    } catch (_) { }
});

const veil = new PIXI.Graphics();
veil.rect(0, 0, width, height);
veil.fill({ color: 0x050607, alpha: 0.36 });
root.addChild(veil);

const cardWidth = Math.min(760, width - 80);
const cardHeight = 260;
const cardX = (width - cardWidth) / 2;
const cardY = Math.max(80, height * 0.18);

const shadow = new PIXI.Graphics();
drawRoundedRect(shadow, cardX + 10, cardY + 14, cardWidth, cardHeight, 26, 0x000000, 0.42);
root.addChild(shadow);

const card = new PIXI.Graphics();
drawRoundedRect(card, cardX, cardY, cardWidth, cardHeight, 26, 0x11100c, 0.94, {
    color: 0xd8b35f,
    width: 2,
    alpha: 0.85
});
root.addChild(card);

const kicker = makeText('ARC INTRO PREPARING', {
    fontFamily: 'Trebuchet MS',
    fontSize: 18,
    letterSpacing: 4,
    fill: 0xd8b35f
});
kicker.anchor.set(0.5, 0);
kicker.x = width / 2;
kicker.y = cardY + 34;
root.addChild(kicker);

const title = makeText(titleText, {
    fontSize: 38,
    fill: 0xfff4d2,
    wordWrap: true,
    wordWrapWidth: cardWidth - 120
});
title.anchor.set(0.5, 0);
title.x = width / 2;
title.y = cardY + 68;
root.addChild(title);

const statusLine = makeText('Cinematic images are still generating.', {
    fontFamily: 'Trebuchet MS',
    fontSize: 20,
    fill: 0xf0e0bb,
    wordWrap: true,
    wordWrapWidth: cardWidth - 120
});
statusLine.anchor.set(0.5, 0);
statusLine.x = width / 2;
statusLine.y = cardY + 126;
root.addChild(statusLine);

const detailLine = makeText('You can wait for the finished intro, or continue now with fallback visuals.', {
    fontFamily: 'Trebuchet MS',
    fontSize: 16,
    fill: 0xa99b7a,
    wordWrap: true,
    wordWrapWidth: cardWidth - 120
});
detailLine.anchor.set(0.5, 0);
detailLine.x = width / 2;
detailLine.y = cardY + 158;
root.addChild(detailLine);

const ring = new PIXI.Graphics();
ring.x = cardX + 54;
ring.y = cardY + 54;
root.addChild(ring);

function drawRing() {
    ring.clear();
    ring.circle(0, 0, 18);
    ring.stroke({ color: 0x66532b, width: 4, alpha: 0.85 });
    ring.arc(0, 0, 18, 0, Math.PI * 1.35);
    ring.stroke({ color: 0xf2c86d, width: 4, alpha: 1 });
}
drawRing();

const buttonWidth = 190;
const buttonHeight = 44;
const buttonX = width / 2 - buttonWidth / 2;
const buttonY = cardY + cardHeight - 66;
const skipButton = new PIXI.Container();
skipButton.eventMode = 'static';
skipButton.cursor = 'pointer';
skipButton.x = buttonX;
skipButton.y = buttonY;
const buttonBg = new PIXI.Graphics();
drawRoundedRect(buttonBg, 0, 0, buttonWidth, buttonHeight, 16, 0x2b2418, 0.96, {
    color: 0xd8b35f,
    width: 1,
    alpha: 0.7
});
skipButton.addChild(buttonBg);
const buttonLabel = makeText('Continue Now', {
    fontFamily: 'Trebuchet MS',
    fontSize: 18,
    fill: 0xfff4d2
});
buttonLabel.anchor.set(0.5);
buttonLabel.x = buttonWidth / 2;
buttonLabel.y = buttonHeight / 2;
skipButton.addChild(buttonLabel);
root.addChild(skipButton);

function finish(reason, status = lastStatus) {
    if (finished) return;
    finished = true;
    bridge.takeover.finish({ reason, status });
}

skipButton.on('pointerdown', () => finish('user_continue_now'));

function updateStatus(status) {
    lastStatus = status || lastStatus || {};
    const cgStatus = String(lastStatus.cgStatus || 'unknown');
    const generatedCount = Number(lastStatus.generatedCount) || 0;
    if (lastStatus.error) {
        statusLine.text = 'Still preparing. Status check reported a temporary issue.';
        detailLine.text = String(lastStatus.error);
        return;
    }
    if (lastStatus.cgRequested) {
        statusLine.text = generatedCount > 0
            ? `Generated images ready: ${generatedCount}. Finalizing intro...`
            : `Cinematic image generation is ${cgStatus}.`;
    } else {
        statusLine.text = `Intro preparation is ${String(lastStatus.status || 'running')}.`;
    }
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    detailLine.text = `Waiting ${elapsed}s. Continue now to use fallback visuals.`;
}

async function pollStatus() {
    if (finished) return;
    if (Date.now() - startedAt >= maximumWaitMs) {
        finish('maximum_wait_elapsed', lastStatus);
        return;
    }

    let status = null;
    try {
        status = await bridge.socket.request('arc-cinematics-status', {
            requestId,
            manifestPath,
            nonce: `${context.runId || 'run'}_${Date.now()}`
        }, 7000);
    } catch (error) {
        status = { error: error?.message || String(error) };
    }

    if (finished) return;
    updateStatus(status);
    if (isReady(status)) {
        finish('manifest_ready', status);
        return;
    }
    bridge.lifecycle.setTimeout(pollStatus, pollIntervalMs);
}

let spin = 0;
if (context.pluginRuntime) {
    context.pluginRuntime.register(`arc_cinematic_pending_notice_${context.runId}`, (rt) => {
        rt.onPreRender((ticker) => {
            spin += (ticker.deltaTime || 1) * 0.08;
            ring.rotation = spin;
        }, 0);
        rt.onDispose(() => {});
    });
    bridge.lifecycle.onDispose(() => {
        context.pluginRuntime.dispose(`arc_cinematic_pending_notice_${context.runId}`);
    });
}

updateStatus(lastStatus);
bridge.lifecycle.setTimeout(pollStatus, 250);

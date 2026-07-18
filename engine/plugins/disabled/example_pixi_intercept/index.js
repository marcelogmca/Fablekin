// A takeover must release renderer resources on every lifecycle exit, not only on click.
const INTERCEPT_ID = 'example_pixi_takeover';

module.exports = {
    id: 'example_pixi_intercept',
    name: 'Example: PixiJS Intercept',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Utility',
    isExamplePlugin: true,
    description: 'Demonstrates a minimal blocking PixiJS takeover with transition and lifecycle cleanup.',

    hooks: {
        HOOK_GUI_GATEKEEPER: {
            priority: 100,
            run: async (_context, tools) => {
                tools.gui.registerRuntimeIntercept({
                    interceptId: INTERCEPT_ID,
                    checkpoint: 'before_first_dialogue',
                    blocking: true,
                    renderer: 'pixi',
                    replayPolicy: 'every_enter',
                    timeoutMs: 60000,
                    transitionIn: { effect: 'circle_fade', scope: 'intercept', durationMs: 500 },
                    transitionOut: { effect: 'fade', scope: 'intercept', direction: 'out', durationMs: 350 }
                });
            }
        }
    },

    exports: {
        guiIntercepts: {
            async [INTERCEPT_ID]() {
                return {
                    renderer: 'pixi',
                    js: `
                        const { PIXI, pixiApp, pixiLayer, pluginRuntime, runId } = context;
                        if (!pixiLayer) {
                            bridge.takeover.abort('missing_pixi_layer');
                            return;
                        }

                        const app = pixiApp.app || pixiApp;
                        const width = app.screen?.width || 1920;
                        const height = app.screen?.height || 1080;
                        const runtimeId = 'example_pixi_intercept_' + runId;

                        const background = new PIXI.Graphics();
                        background.rect(0, 0, width, height);
                        background.fill({ color: 0x0a0a1a, alpha: 0.92 });
                        background.eventMode = 'static';
                        background.cursor = 'pointer';
                        pixiLayer.addChild(background);

                        const panel = new PIXI.Graphics();
                        panel.roundRect(-150, -100, 300, 200, 16);
                        panel.fill({ color: 0x4488ff, alpha: 0.8 });
                        panel.stroke({ color: 0x88bbff, width: 3 });
                        panel.position.set(width / 2, height / 2);
                        pixiLayer.addChild(panel);

                        const title = new PIXI.Text({
                            text: 'PIXI INTERCEPT EXAMPLE',
                            style: { fontFamily: 'Arial', fontSize: 28, fontWeight: 'bold', fill: 0xffffff }
                        });
                        title.anchor.set(0.5);
                        title.position.set(width / 2, height / 2 - 20);
                        pixiLayer.addChild(title);

                        const hint = new PIXI.Text({
                            text: 'Click anywhere to return to the VN.',
                            style: { fontFamily: 'Arial', fontSize: 16, fill: 0xaaccff }
                        });
                        hint.anchor.set(0.5);
                        hint.position.set(width / 2, height / 2 + 30);
                        pixiLayer.addChild(hint);

                        let elapsed = 0;
                        const cleanup = () => pluginRuntime?.dispose?.(runtimeId);
                        bridge.lifecycle?.onDispose?.(cleanup);

                        pluginRuntime?.register?.(runtimeId, (runtime) => {
                            runtime.onPreRender((ticker) => {
                                elapsed += ticker.deltaTime * 0.05;
                                panel.scale.set(1 + Math.sin(elapsed) * 0.08);
                            }, 0);
                            runtime.onDispose(() => {});
                        });

                        background.on('pointerdown', () => {
                            cleanup();
                            bridge.takeover.finish({ result: 'clicked' });
                        });
                    `
                };
            }
        }
    }
};

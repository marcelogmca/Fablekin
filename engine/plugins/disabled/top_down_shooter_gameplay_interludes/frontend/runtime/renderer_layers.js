(() => {
    function createRendererLayers(PIXI, app) {
        const container = new PIXI.Container();
        app.stage.addChild(container);

        const dustLayer = new PIXI.Container();
        const gameLayer = new PIXI.Container();
        const bloomLayer = new PIXI.Container();

        container.addChild(dustLayer);
        container.addChild(gameLayer);
        container.addChild(bloomLayer);

        return {
            container,
            dustLayer,
            gameLayer,
            bloomLayer
        };
    }

    window.TDSRendererLayers = {
        create: createRendererLayers
    };
})();

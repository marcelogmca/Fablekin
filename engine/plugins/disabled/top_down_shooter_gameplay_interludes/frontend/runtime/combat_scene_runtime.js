(() => {
    function createTopDownShooterSceneRuntime({ bridge }) {
        let alive = false;

        return {
            async start() {
                alive = true;
                try {
                    if (bridge?.player?.ui?.lock) {
                        // No actor/background mutations here. This runtime reserves a stable place
                        // for future combat-scene orchestration hooks.
                    }
                } catch (_) {}
            },
            stop() {
                alive = false;
            },
            isActive() {
                return alive;
            }
        };
    }

    window.TopDownShooterSceneRuntime = createTopDownShooterSceneRuntime;
})();

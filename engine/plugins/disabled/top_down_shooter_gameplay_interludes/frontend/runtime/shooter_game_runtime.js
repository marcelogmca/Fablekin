(() => {
    function createTopDownShooterGameplayRuntime(args) {
        const factory = window.TDSCombatRuntime?.create;
        if (typeof factory !== 'function') {
            return {
                async start() { },
                stop() { }
            };
        }
        return factory(args);
    }

    window.TopDownShooterGameplayRuntime = createTopDownShooterGameplayRuntime;
})();

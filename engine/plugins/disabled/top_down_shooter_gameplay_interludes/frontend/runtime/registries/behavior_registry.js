(() => {
    function createRegistry() {
        const handlers = Object.create(null);

        function normalizeType(type) {
            return String(type || '').trim().toLowerCase();
        }

        function register(type, handler) {
            const key = normalizeType(type);
            if (!key || typeof handler !== 'function') return false;
            handlers[key] = handler;
            return true;
        }

        function has(type) {
            const key = normalizeType(type);
            return !!handlers[key];
        }

        function get(type) {
            const key = normalizeType(type);
            return handlers[key] || null;
        }

        function list() {
            return Object.keys(handlers).sort();
        }

        return { register, has, get, list };
    }

    window.TDSBehaviorRegistry = {
        create: createRegistry
    };
})();

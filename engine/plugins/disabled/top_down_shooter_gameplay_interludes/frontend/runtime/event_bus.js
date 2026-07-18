(() => {
    function createEventBus(options = {}) {
        const listeners = new Map();
        const history = [];
        const maxEvents = Math.max(10, Number.parseInt(options.maxEvents, 10) || 80);

        function emit(type, payload = {}) {
            const eventType = String(type || '').trim();
            if (!eventType) return null;
            const event = {
                ts: Date.now(),
                type: eventType,
                payload: (payload && typeof payload === 'object') ? payload : {}
            };
            history.push(event);
            if (history.length > maxEvents) history.splice(0, history.length - maxEvents);

            const subs = listeners.get(eventType);
            if (subs && subs.size > 0) {
                for (const fn of subs) {
                    try { fn(event); } catch (_) {}
                }
            }
            const wildcard = listeners.get('*');
            if (wildcard && wildcard.size > 0) {
                for (const fn of wildcard) {
                    try { fn(event); } catch (_) {}
                }
            }
            return event;
        }

        function on(type, handler) {
            const eventType = String(type || '').trim();
            if (!eventType || typeof handler !== 'function') return () => {};
            if (!listeners.has(eventType)) listeners.set(eventType, new Set());
            const set = listeners.get(eventType);
            set.add(handler);
            return () => off(eventType, handler);
        }

        function off(type, handler) {
            const eventType = String(type || '').trim();
            const set = listeners.get(eventType);
            if (!set) return false;
            const removed = set.delete(handler);
            if (set.size === 0) listeners.delete(eventType);
            return removed;
        }

        function recent(limit = 30) {
            const take = Math.max(1, Number.parseInt(limit, 10) || 30);
            if (history.length <= take) return history.slice();
            return history.slice(history.length - take);
        }

        function clear() {
            history.splice(0, history.length);
            listeners.clear();
        }

        return {
            emit,
            on,
            off,
            recent,
            clear
        };
    }

    window.TDSEventBus = {
        create: createEventBus
    };
})();

(() => {
    function stringToSeed(input) {
        const text = String(input || 'tds_default_seed');
        let hash = 2166136261 >>> 0;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619) >>> 0;
        }
        if (hash === 0) hash = 0x9e3779b9;
        return hash >>> 0;
    }

    function createSeededRng(seedInput) {
        let state = stringToSeed(seedInput);
        const initialSeed = state >>> 0;

        function next() {
            // xorshift32
            state ^= (state << 13) >>> 0;
            state ^= (state >>> 17) >>> 0;
            state ^= (state << 5) >>> 0;
            return ((state >>> 0) / 4294967296);
        }

        return {
            next,
            nextRange(min, max) {
                const a = Number(min) || 0;
                const b = Number(max) || 0;
                if (b <= a) return a;
                return a + ((b - a) * next());
            },
            nextInt(min, max) {
                const a = Math.floor(Number(min) || 0);
                const b = Math.floor(Number(max) || 0);
                if (b <= a) return a;
                return a + Math.floor(next() * ((b - a) + 1));
            },
            getInitialSeed() {
                return initialSeed;
            }
        };
    }

    window.TDSRng = {
        createSeededRng,
        stringToSeed
    };
})();

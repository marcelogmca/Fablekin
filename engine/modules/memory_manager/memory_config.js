const CONFIG = Object.freeze({
    CHUNK_SIZE: 500,
    CHUNK_OVERLAP: 50,
    FULL_TEXT_THRESHOLD: 0.75,
    TOP_K_FULL: 16,
    TOP_K_SUMMARY: 32,
    MAX_CONTEXT_TOKENS: 4000,
    COLLECTION_NAME: "memory_store",
    INITIAL_MULTIPLIER: 2
});

module.exports = { CONFIG };

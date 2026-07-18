const { runRAGPipeline, isProcessed } = require("../retrieval/rag_pipeline");

// #region CORE PROCESSING
/**
 * Processes a chapter by splitting it into semantically coherent chunks, generating a single overview, and storing them.
 */
async function processChapter(chapterText, turnNumber, metadata = {}, projectName = "default", config, storeType) {
    return await runRAGPipeline(chapterText, turnNumber, metadata, projectName, storeType, "ChapterProcessor");
}
// #endregion

// #region EXPORTS
module.exports = { processChapter, isChapterProcessed: isProcessed };
// #endregion

const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { Logger, generateHash, TurnLogger, readSettings } = require("../../utils");
const { callLLM } = require("../../llm.js");
const { getStore } = require("../storage/vector_store_manager");
const { CONFIG } = require("../memory_config.js");
const { runWithDiagnosticContext } = require("../../diagnostic_context.js");



/**
 * Checks if a unit (file or chapter) has already been processed.
 */
async function isProcessed(turnNumber, contentHash, projectName, storeType, caller = "RAGPipeline") {
    const originalIdentifier = turnNumber;
    let numericTurn = Number(turnNumber);
    if (isNaN(numericTurn) && typeof turnNumber === 'string' && turnNumber.startsWith('turn_')) {
        numericTurn = Number(turnNumber.replace('turn_', ''));
    }

    // If it's a number, use turn_number. If it's a string (like a file path), use sourceFile.
    const filter = !isNaN(numericTurn)
        ? { $and: [{ turn_number: { $eq: numericTurn } }, { contentHash: { $eq: contentHash } }] }
        : { $and: [{ sourceFile: { $eq: originalIdentifier } }, { contentHash: { $eq: contentHash } }] };

    try {
        const vectorStore = await getStore(projectName, storeType);
        const results = await vectorStore.similaritySearch("", 1, filter);
        return results.length > 0;
    } catch (error) {
        Logger.error(caller, 'RAG', `${caller} processing check failed for ${originalIdentifier}:`, error);
        return false;
    }
}

/**
 * The unified RAG processing pipeline.
 * Handles overview generation, semantic chunking, metadata attachment, and vector storage.
 */
async function runRAGPipeline(text, turnNumber, metadata = {}, projectName = "default", storeType, caller = "RAGPipeline") {
    const originalIdentifier = turnNumber;
    let numericTurn = Number(turnNumber);
    if (isNaN(numericTurn) && typeof turnNumber === 'string' && turnNumber.startsWith('turn_')) {
        numericTurn = Number(turnNumber.replace('turn_', ''));
    } else if (isNaN(numericTurn) && metadata && metadata.turn_number !== undefined) {
        numericTurn = Number(metadata.turn_number);
    }

    const displayId = isNaN(numericTurn) ? originalIdentifier : numericTurn;
    Logger.log(caller, 'RAG', `Starting unified RAG pipeline for turn: ${displayId} in store: ${storeType}`, 'start');

    const contentHash = generateHash(text.trim(), 'sha256').substring(0, 16);

    if (await isProcessed(originalIdentifier, contentHash, projectName, storeType, caller)) {
        Logger.log(caller, 'RAG', `Already processed with identical content: ${displayId}`, 'end');
        return 0;
    }

    // Check if previous chunks exist but have a different content hash.
    // If so, delete the old chunks first so we don't have duplicated chunks for the same turn.
    const vectorStore = await getStore(projectName, storeType);
    try {
        Logger.log(caller, 'RAG', `Deleting existing chunks for identifier ${displayId} before re-ingestion.`);
        const deleteFilter = !isNaN(numericTurn)
            ? { turn_number: { $eq: numericTurn } }
            : { sourceFile: { $eq: originalIdentifier } };

        await vectorStore.delete(deleteFilter);
    } catch (err) {
        Logger.warn(caller, 'RAG', `Failed to delete previous chunks or no chunks existed for ${displayId}: ${err.message}`);
    }

    // 1. Generate High-Level Overview
    // Note: The "RAG Overview" is a technical "Global Context Anchor" stored in the vector metadata. 
    // It differs from the "Narrative Synopsis" (which is user-facing and larger). 
    // For story chapters, it provides a safety net context. For static lore files (which have no 
    // chronology or synopsis), it is the primary way the LLM understands the "big picture" 
    // of a retrieved snippet.
    let overview = metadata.overview;
    if (!overview) {
        const messages = [
            { role: 'system', content: "Create ultra-brief overview (max 25 words) capturing core setting and main event:" },
            { role: 'user', content: text }
        ];

        const currentSettings = readSettings();
        const modelUsed = currentSettings.narrative_agents?.summarizer?.summary_model || 'mediumendmodel';
        const providerUsed = resolveModelAlias(modelUsed).provider;
        const response = await runWithDiagnosticContext({
            executionLane: 'core',
            phase: 'Memory Retrieval',
            component: 'RAGPipeline',
            taskKey: 'ragOverview',
            blocking: true
        }, async () => {
            if (TurnLogger && TurnLogger.logRequest) {
                TurnLogger.logRequest(`RAG Overview`, { messages }, modelUsed, providerUsed);
            }

            const result = await callLLM({
                messages,
                model: modelUsed,
                provider: providerUsed,
                retries: currentSettings.narrative_agents?.summarizer?.retries,
                timeout: currentSettings.narrative_agents?.summarizer?.timeout,
                callingModule: caller,
                turnLogTitle: 'RAG Overview'
            });

            if (TurnLogger && TurnLogger.logResponse) {
                TurnLogger.logResponse(`RAG Overview`, result, modelUsed, providerUsed);
            }
            return result;
        });
        overview = response.content;
    } else {
        Logger.log(caller, 'RAG', `Skipping overview generation, reusing existing metadata.`, 'end');
    }

    // 2. Prepare Base Metadata
    const fullMetadata = {
        ...metadata,
        contentHash: contentHash,
        overview: overview.trim(),
        lastUpdated: new Date().toISOString()
    };

    // Ensure turn_number is correctly derived.
    if (fullMetadata.turn_number === undefined && !isNaN(numericTurn)) {
        fullMetadata.turn_number = numericTurn;
    }

    // If turn_number is still NaN, don't store it as NaN in metadata (causes issues in some stores)
    if (isNaN(fullMetadata.turn_number)) {
        delete fullMetadata.turn_number;
    }

    // 3. Text Splitting (Recursive Character)
    const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: CONFIG.CHUNK_SIZE || 500,
        chunkOverlap: CONFIG.CHUNK_OVERLAP || 50,
    });

    const docs = await textSplitter.createDocuments([text], [fullMetadata]);

    // 4. Enrich Chunks
    docs.forEach((doc, index) => {
        doc.metadata.chunkPosition = index;
        doc.metadata.summary = doc.pageContent.substring(0, 150) + "...";
    });

    // 5. Vector Storage with Batching
    const settings = readSettings();
    const store = await getStore(projectName, storeType);
    const threshold = settings.infrastructure?.embedding?.large_file_threshold_bytes || 2097152; // 2MB default
    const batchSize = settings.infrastructure?.embedding?.large_file_batch_size || 3000;
    const unitSize = Buffer.from(text).length;

    if (unitSize > threshold) {
        Logger.log(caller, 'RAG', `Large unit detected (${unitSize} bytes). Using batching strategy (size: ${batchSize}).`);
        for (let i = 0; i < docs.length; i += batchSize) {
            const batch = docs.slice(i, i + batchSize);
            await store.addDocuments(batch);
        }
    } else {
        await store.addDocuments(docs);
    }

    Logger.log(caller, 'Persistence', `Stored ${docs.length} semantic chunks for ${displayId}`, 'end');
    return docs.length;
}

module.exports = {
    runRAGPipeline,
    isProcessed
};

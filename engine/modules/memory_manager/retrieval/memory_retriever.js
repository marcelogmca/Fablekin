const { Logger } = require("../../utils");
const { getStore } = require("../storage/vector_store_manager");
const { CONFIG } = require("../memory_config.js");

/**
 * Calculates a Reciprocal Rank Fusion score.
 * Lower 'k' penalizes items lower in the list more heavily.
 * Standard value is 60.
 */
function calculateRRFScore(rank, k = 60) {
    return 1 / (k + rank);
}

/**
 * extracts boostable keywords from the generated queries and combines them 
 * with the explicit Entities provided by the Knowledge Graph / TurnContext.
 * 
 * @param {string[]} queries - The queries generated for this turn.
 * @param {string[]} contextEntities - High-value entities (Names, Locations, Unique Artifacts) passed from TurnContext.
 */
function extractBoostKeywords(queries, contextEntities = []) {
    const keywords = new Set();
    // Common words to ignore to prevent boosting generic text
    const stopWords = new Set(['the', 'and', 'is', 'in', 'at', 'of', 'a', 'an', 'to', 'for', 'with', 'from', 'by']);

    // 1. Add the explicit Context Entities (The "Gold" Standard)
    if (Array.isArray(contextEntities)) {
        contextEntities.forEach(e => {
            // Filter out empty strings or very short noise
            if (e && typeof e === 'string' && e.length > 2) {
                keywords.add(e);
            }
        });
    }

    // 2. Extract potential Proper Nouns from the queries (The "Search" Standard)
    queries.forEach(q => {
        // Remove symbols and split by whitespace
        const terms = q.replace(/[^\w\s]/gi, '').split(/\s+/);
        terms.forEach(t => {
            if (t.length > 3 && !stopWords.has(t.toLowerCase())) {
                // Heuristic: If it starts with a Capital letter, it's likely important (Proper Noun)
                if (t[0] === t[0].toUpperCase()) {
                    keywords.add(t);
                }
            }
        });
    });

    return Array.from(keywords);
}

/**
 * Retrieves relevant memories by running multiple queries in parallel against the vector store.
 * 
 * Uses Reciprocal Rank Fusion (RRF) and Keyword/Entity Boosting to improve accuracy
 * when searching large, dense lore files.
 * 
 * @param {string[]} queries - An array of query strings to search for.
 * @param {object} [options={}] - Options for retrieval.
 * @param {string} [options.projectName="default"] - The name of the project.
 * @param {string} [options.storeType="chapters"] - The collection to search in.
 * @param {number} [options.top_k=5] - The number of results to fetch for EACH query.
 * @param {string[]} [options.contextEntities=[]] - List of active entities/concepts to boost relevance.
 * @returns {Promise<object>} An object containing retrieved full-text documents.
 */
async function retrieve(queries, options = {}) {
    if (!queries || queries.length === 0) {
        Logger.warn('MemoryRetriever', 'Retrieval', 'Retrieve called with no queries. Returning empty results.');
        return { fullText: [], summaries: [] };
    }

    const {
        projectName = "default",
        storeType = "chapters",
        top_k = 5,
        contextEntities = [],
        autoTurnNumbers = null
    } = options;

    Logger.log('MemoryRetriever', 'Retrieval', `Starting parallel retrieval for ${queries.length} queries on store '${storeType}'...`, 'start');
    const startTime = Date.now();

    // 1. Get the target vector store.
    const vectorStore = await getStore(projectName, storeType);

    // 2. FETCH WIDE STRATEGY
    // We request 5x the desired amount from the DB to allow for RRF re-ranking.
    // If we only fetched top_k, we wouldn't have enough overlap to perform fusion.
    const fetchK = top_k * 5;

    // Apply filter if we are specifically looking for certain chapters (Slotted RAG)
    let searchFilter = null;
    if (autoTurnNumbers && autoTurnNumbers.length > 0) {
        searchFilter = { turn_number: { $in: autoTurnNumbers } };
    }

    const searchPromises = queries.map(query => vectorStore.similaritySearch(query, fetchK, searchFilter));
    const allSearchResults = await Promise.all(searchPromises);

    // 3. RECIPROCAL RANK FUSION (RRF) SETUP
    // Map Structure: ContentString -> { doc, score, hits, sources }
    const docMap = new Map();
    const boostKeywords = extractBoostKeywords(queries, contextEntities);

    if (boostKeywords.length > 0) {
        Logger.log('MemoryRetriever', 'Retrieval', `Boosting results containing: [${boostKeywords.slice(0, 5).join(', ')}${boostKeywords.length > 5 ? '...' : ''}]`);
    }

    // 4. PROCESS RESULTS & APPLY RRF
    allSearchResults.forEach((resultSet, _queryIndex) => {
        resultSet.forEach((doc, rank) => {
            const content = doc.pageContent;

            if (!docMap.has(content)) {
                docMap.set(content, {
                    doc: doc,
                    score: 0,
                    hits: 0
                });
            }

            const entry = docMap.get(content);

            // RRF Score: The higher it appears in the raw vector list, the more base points it gets.
            // rank is 0-indexed, so we add 1.
            entry.score += calculateRRFScore(rank + 1);
            entry.hits += 1;
        });
    });

    // 5. APPLY BOOSTING & FINAL SORT
    let scoredDocs = Array.from(docMap.values()).map(entry => {
        let finalScore = entry.score;

        // A. Keyword/Entity Boost
        // If the chunk contains a known entity (e.g., "Surtalogi") or query keyword, boost it.
        // This anchors vague vector matches to specific context.
        boostKeywords.forEach(kw => {
            // Case-insensitive boundary match
            const regex = new RegExp(`\\b${kw}\\b`, 'i');
            if (regex.test(entry.doc.pageContent)) {
                finalScore *= 1.3; // 30% Boost per keyword match
            }
        });

        // B. Consensus Boost
        // If multiple DIFFERENT queries found this chunk, it is highly likely to be relevant.
        if (entry.hits > 1) {
            finalScore *= 1.5; // 50% Boost for consensus
        }

        return { ...entry, finalScore };
    });

    // Sort by final score descending (highest relevance first)
    scoredDocs.sort((a, b) => b.finalScore - a.finalScore);

    // 6. CUTOFF & FORMATTING
    // Take the top_k requested by the user from the re-ranked list
    const topDocs = scoredDocs.slice(0, top_k);

    const contextPieces = { fullText: [], summaries: [] };
    let tokenCount = 0;
    const maxTokens = CONFIG.MAX_CONTEXT_TOKENS;

    for (const item of topDocs) {
        const doc = item.doc;

        // Basic safety check for token length estimation (approx 4 chars per token)
        const tokens = doc.pageContent.length / 4;
        if (tokenCount + tokens > maxTokens) break;

        contextPieces.fullText.push({
            content: doc.pageContent,
            turnNumber: doc.metadata.turn_number,
            metadata: doc.metadata,
            // Debug info useful for logs to see why a chunk was picked
            _debugScore: item.finalScore.toFixed(4)
        });
        tokenCount += tokens;
    }

    Logger.log('MemoryRetriever', 'Retrieval', `Retrieved ${contextPieces.fullText.length} final docs. RRF filtered ${docMap.size} candidates down to ${top_k}.`);
    Logger.log('MemoryRetriever', 'Retrieval', `Duration: ${Date.now() - startTime}ms`, 'end');

    return contextPieces;
}

/**
 * Assembles the final context string from relevant memories.
 * Groups content by Source File or Chapter ID for better LLM comprehension.
 */
async function assembleContext(relevantMemories, systemPrompt = "", debugMode) {
    if (!relevantMemories || (!relevantMemories.fullText?.length && !relevantMemories.summaries?.length)) {
        return systemPrompt ? systemPrompt.trim() : "";
    }

    let finalContext = systemPrompt ? `${systemPrompt}\n\n` : '';

    const allMemories = [
        ...relevantMemories.fullText.map(m => ({ ...m, type: 'full' })),
        ...relevantMemories.summaries.map(m => ({ ...m, type: 'summary' }))
    ];

    // Grouping by Source File (or Chapter ID) makes it easier for the LLM to read
    const sourcesMap = new Map();

    for (const memory of allMemories) {
        // Fallback: Use sourceFile (for static lore) or turnNumber (for chat history)
        let sourceId = memory.turnNumber !== undefined ? memory.turnNumber : (memory.metadata.sourceFile || 'Unknown Source');

        // If it's a full path, just get the filename
        if (sourceId !== 'Unknown Source' && typeof sourceId === 'string') {
            const path = require('path');
            sourceId = path.basename(sourceId, '.md');
        }

        if (!sourcesMap.has(sourceId)) {
            sourcesMap.set(sourceId, []);
        }
        sourcesMap.get(sourceId).push(memory);
    }

    // Sort sources alphabetically for consistency
    const sortedSources = Array.from(sourcesMap.keys()).sort();

    for (const source of sortedSources) {
        const memories = sourcesMap.get(source);

        // Sort memories by position within the file if available
        memories.sort((a, b) => (a.metadata.chunkPosition || 0) - (b.metadata.chunkPosition || 0));

        // Dedup content within the same source just in case of overlap
        const uniqueContent = [...new Set(memories.map(m => m.content))];

        // If the source is a number (a chapter turn), we don't need the excerpt headers.
        // If it's a static file name, we keep the headers for context clarity.
        const isChapterTurn = typeof source === 'number' || !isNaN(Number(source));

        if (!isChapterTurn) {
            finalContext += `\n[Excerpt from: ${source}]\n`;
        } else {
            finalContext += `\n`;
        }

        for (const content of uniqueContent) {
            if (!isChapterTurn) {
                finalContext += `"${content.trim()}"\n\n`;
            } else {
                finalContext += `${content.trim()}\n\n`;
            }
        }

        if (!isChapterTurn) {
            finalContext += `[End Excerpt]\n`;
        }
    }

    if (debugMode) {
        const fs = require('fs');
        const path = require('path');
        const logDir = path.resolve(__dirname, '../../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        // Log the assembled context for debugging
        const logFile = path.join(logDir, `context_${Date.now()}.txt`);
        fs.writeFileSync(logFile, finalContext, 'utf-8');
    }
    return finalContext.trim();
}

module.exports = {
    retrieve,
    assembleContext,
};

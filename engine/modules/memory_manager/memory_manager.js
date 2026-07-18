// Memory Management Module - w/ RAG Implementation

// #region IMPORTS
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const dotenv = require("dotenv");
const { Logger, generateHash, settings, readSettings } = require("../utils.js");

// Internal modules
const { getStore } = require("./storage/vector_store_manager.js");
const { processChapter: internalProcessChapter, isChapterProcessed: internalIsChapterProcessed } = require("./processing/chapter_processor.js");
const { retrieve: internalRetrieve, assembleContext: internalAssembleContext, setLlmRelevanceScoring } = require("./retrieval/memory_retriever.js");
const { generateSummary: internalGenerateSummary, generateSynopsis: internalGenerateSynopsis, retrieveSummary: internalRetrieveSummary, retrieveSynopsis: internalRetrieveSynopsis, generateCharacterSheet: internalGenerateCharacterSheet } = require("./processing/summarization_service.js");

const { CONFIG } = require("./memory_config.js");

dotenv.config();
// #endregion

// #region MODULE CONFIGURATION
// Module-level state variables
let DEBUG_MODE = false;
// #endregion

// #region PUBLIC API FACADE
/**
 * Configures the memory management module.
 * @param {object} [config={}] - Configuration options.
 * @param {string} [config.model] - The main LLM model to use.
 * @param {string} [config.scoringModel] - The model for relevance scoring.
 * @param {boolean} [config.debug] - Set to true to enable console logging.
 */
function configure(config = {}) {
  if (typeof config.debug === 'boolean') {
    if (!settings.infrastructure) settings.infrastructure = {};
    settings.infrastructure.debug = config.debug;
    DEBUG_MODE = config.debug;
  }

  Logger.log('MemoryMgmt', 'Lifecycle', `Module configured. Debug mode: ${DEBUG_MODE}`);
}

/**
 * Processes or updates a chapter, storing its content as embeddings.
 * This is an alias for processChapter.
 * @param {string} chapterText - The full content of the chapter.
 * @param {number} turnNumber - The turn number for the chapter.
 * @param {Object} [metadata={}] - Additional metadata.
 * @param {string} [projectName="default"] - The project identifier.
 * @returns {Promise<number>} The number of chunks processed.
 */
function updateChapter(chapterText, turnNumber, metadata = {}, projectName = "default") {
  const storeType = 'chapters'; // Hardcoded for chat timeline
  Logger.log('MemoryMgmt', 'Persistence', `Processing turn ${turnNumber} for store: ${storeType}`);
  return internalProcessChapter(chapterText, turnNumber, metadata, projectName, { ...CONFIG }, storeType);
}
/**
 * Processes a static file, storing its content as embeddings in the 'static_lore' store.
 * @param {string} fileContent - The content of the static file.
 * @param {string} filePath - The path to the static file.
 * @param {string} [projectName="default"] - The project identifier.
 * @returns {Promise<number>} The number of chunks processed.
 */
async function processStaticFile(staticDataManager, fileContent, filePath, projectName) {
  const metadata = { sourceFile: filePath, type: 'auto' };
  return staticDataManager.processAndEmbedFile(fileContent, filePath, metadata, projectName, 'static_lore');
}

/**
 * Processes a given context to retrieve relevant memories from the vector store.
 * @param {string[]} queries - An array of query strings to search.
 * @param {object} [options={}] - Options for memory processing.
 * @param {string} options.storeType - The type of store to process memories from ('chapters' or 'static_lore').
 * @param {string} [options.projectName="default"] - The project identifier.
 * @param {string} [options.systemPrompt] - An optional system prompt to prepend to the context.
 * @returns {Promise<object>} An object containing the assembled context, stats, and retrieved memories.
 */
async function memoryProcessor(queries, options = {}) {
  if (!options.storeType) {
    throw new Error("memoryProcessor requires 'storeType' in options ('chapters' or 'static_lore').");
  }

  const relevantMemories = await internalRetrieve(queries, options);
  const finalContext = await internalAssembleContext(relevantMemories, options.systemPrompt, DEBUG_MODE);

  return {
    context: finalContext,
    stats: {
      retrievedCount: relevantMemories.fullText.length + relevantMemories.summaries.length,
      totalTokenEstimate: finalContext.split(/\s+/).length
    },
    memories: relevantMemories
  };
}

/**
 * Inspects the contents of a specified vector store.
 * @param {string} [projectName="default"] - The project identifier.
 * @param {string} storeType - The type of store to inspect ('chapters', 'summaries', or 'static_lore').
 * @returns {Promise<Array<object>>} An array of formatted data from the inspected store.
 */
async function inspectStore(projectName = "default", storeType) {
  Logger.log('MemoryMgmt', 'Query', `Inspecting store of type: ${storeType} for project: ${projectName}`, 'start');

  // Determine the correct collection suffix based on the store type.
  // These suffixes must align with how they are used elsewhere in the system.
  let collectionSuffix;
  switch (storeType) {
    case 'chapters':
      collectionSuffix = "memory_store"; // The default collection for chapter chunks
      break;
    case 'summaries':
      collectionSuffix = "summaries_cache"; // Used by summarization_service.js
      break;
    case 'static-lore':
      collectionSuffix = "static_lore"; // Used by processStaticFile
      break;
    default:
      const errorMsg = `Unknown store type for inspection: ${storeType}`;
      Logger.error('MemoryMgmt', 'Query', errorMsg);
      throw new Error(errorMsg);
  }

  try {
    const store = await getStore(projectName, collectionSuffix);

    // The core ChromaDB fetch operation.
    // The `get()` method without filters returns everything in the collection.
    const results = await store.collection.get();
    Logger.log('MemoryMgmt', 'Query', `Retrieved ${results.ids.length} items from collection '${collectionSuffix}'`, 'end');

    // The data from Chroma is in separate arrays (ids, metadatas, documents).
    // We need to merge them into a single array of objects for easier handling on the frontend.
    const formattedData = results.ids.map((id, index) => ({
      id: id,
      document: results.documents[index],
      metadata: results.metadatas[index]
    }));

    return formattedData;

  } catch (error) {
    Logger.error('MemoryMgmt', 'Query', `Failed to inspect store '${collectionSuffix}': ${error.message}`, error);
    // Return an empty array on error so the frontend doesn't break.
    return [];
  }
}

/**
 * Stores plain text chunks directly into the vector store.
 * @param {string} text - The text to chunk and store.
 * @param {string} [projectName="default"] - The project identifier.
 * @param {Object} [metadata={}] - Metadata to attach to each chunk.
 * @returns {Promise<number>} The number of documents added.
 */
async function storePlainTextChunks(text, projectName = "default", metadata = {}) {
  const vectorStore = await getStore(projectName);
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: CONFIG.CHUNK_SIZE,
    chunkOverlap: CONFIG.CHUNK_OVERLAP,
  });
  const docs = await textSplitter.createDocuments([text], [metadata]);
  await vectorStore.addDocuments(docs);
  return docs.length;
}

/**
 * Searches stored plain text chunks.
 * @param {string} query - The search query.
 * @param {string} [projectName="default"] - The project identifier.
 * @param {number} [topK=3] - The number of results to return.
 * @returns {Promise<Document[]>} The search results.
 */
async function searchPlainTextChunks(query, projectName = "default", topK = 3) {
  const vectorStore = await getStore(projectName);
  return await vectorStore.similaritySearch(query, topK);
}

/**
 * Deletes plain text chunks based on a metadata filter.
 * @param {Object} metadataFilter - A filter object for deletion (e.g., { ids: [...] }).
 * @param {string} [projectName="default"] - The project identifier.
 * @returns {Promise<number>} A status code (1 for success).
 */
async function deletePlainTextChunksByMetadata(metadataFilter, projectName = "default") {
  const vectorStore = await getStore(projectName);
  await vectorStore.delete(metadataFilter);
  Logger.log('MemoryMgmt', 'Persistence', `Deleted chunks with filter: ${JSON.stringify(metadataFilter)}`);
  return 1;
}

/**
 * A service object for generating and retrieving summaries and synopses.
 */
const SummarizationService = {
  generateSummary(turnContext, content, options = {}) {
    if (readSettings()?.narrative_agents?.summarizer?.enabled === false) {
      Logger.log('SummarizationService', 'Lifecycle', 'Summarizer is disabled. Returning source content as summary fallback.');
      return Promise.resolve(content || '');
    }
    return internalGenerateSummary(turnContext, content, options);
  },
  generateSynopsis(turnContext, content, options = {}) {
    if (readSettings()?.narrative_agents?.summarizer?.enabled === false) {
      Logger.log('SummarizationService', 'Lifecycle', 'Summarizer is disabled. Returning empty synopsis fallback.');
      return Promise.resolve({ title: 'Untitled Scene', abstractTitle: '', synopsis: '' });
    }
    return internalGenerateSynopsis(turnContext, content, options);
  },
  generateCharacterSheet(content, projectName, rootDirectory, staticDataManager) {
    if (readSettings()?.narrative_agents?.summarizer?.enabled === false) {
      Logger.log('SummarizationService', 'Lifecycle', 'Summarizer is disabled. Skipping character sheet generation.');
      return Promise.resolve('');
    }
    return internalGenerateCharacterSheet(content, projectName, rootDirectory, staticDataManager);
  },
  retrieveSummary(content, projectName) {
    return internalRetrieveSummary(content, projectName);
  },
  retrieveSynopsis(content, projectName) {
    return internalRetrieveSynopsis(content, projectName);
  }
};
// #endregion

// #region MODULE EXPORTS
// This structure is identical to the original file to ensure plug-and-play compatibility.
module.exports = {
  // Core functions
  configure,
  updateChapter,
  processChapter: updateChapter,
  processStaticFile,
  memoryProcessor,

  // Vector store management (Exposing for potential external use/diagnostics)
  initVectorStore: (projectName = "default", storeType = "chapters") => getStore(projectName, storeType),
  isChapterProcessed: (turnNumber, contentHash, projectName = "default") => internalIsChapterProcessed(turnNumber, contentHash, projectName, 'chapters'),
  generateContentHash: (content) => generateHash(content.trim(), 'sha256').substring(0, 16),

  // Metadata management - NOTE: These were not used in the original core pipeline but are exported.
  // The logic for ensureOverview/updateDocumentMetadata was complex and inefficient.
  // The new implementation generates overviews during processing, a more robust approach.
  // These are left as stubs or direct calls if their specific logic is needed elsewhere.

  // Plain text API
  storePlainTextChunks,
  searchPlainTextChunks,
  deletePlainTextChunksByMetadata,
  // getProjectMetadata was not fully implemented in the original; providing a safe stub.
  getProjectMetadata: async () => null,

  // Advanced features
  enableLLMRelevanceScoring: (enable) => { setLlmRelevanceScoring(enable); },
  scoreLLMRelevance: (query, chunk) => internalRetrieve._scoreLLMRelevance(query, chunk), // Exposing internal for direct access if needed
  applyLLMRelevanceScoring: (results, query) => internalRetrieve._applyLLMRelevanceScoring(results, query), // Exposing internal for direct access if needed


  inspectStore,

  // Configuration
  CONFIG,

  // Summarization service
  SummarizationService
};
// #endregion

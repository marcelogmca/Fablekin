const {
    Logger,
    TurnLogger,
    generateHash,
    readFileSync,
    readSettings
} = require("../../utils");
const { callLLM, resolveModelAlias } = require("../../llm.js");
const { buildCoreVnLlmMessages } = require("../../vn_manager/shared_llm_context.js");
const {
    buildVnBackgroundMessages,
    getVnBackgroundAssignment,
    waitForVnBackgroundCacheSlot
} = require("../../vn_manager/background_llm_cache.js");
const { getStore } = require("../storage/vector_store_manager");
const { getDiagnosticContext, runWithDiagnosticContext } = require("../../diagnostic_context.js");

// #region MODULE IMPORTS
const settings = readSettings();

const DB_OPERATION_TIMEOUT = 30000; // 30 seconds
// #endregion

// #region CONFIGURATION
// Read prompts once at module load
const summaryPrompt = readFileSync("engine/prompts/summary_prompt.txt");
const synopsisPrompt = readFileSync("engine/prompts/synopsis_prompt.txt");
// #endregion

async function runLoggedSummarizerCall(title, messages, model, provider, callOptions = {}, fallbackDiagnostics = {}) {
    provider = resolveModelAlias(model).provider;
    const activeDiagnostics = getDiagnosticContext();
    const diagnostics = activeDiagnostics
        ? { component: 'SummarizationService', subTaskKey: title }
        : {
            executionLane: 'core',
            phase: 'Summarization',
            component: 'SummarizationService',
            taskKey: title,
            blocking: true,
            ...fallbackDiagnostics
        };

    return await runWithDiagnosticContext(diagnostics, async () => {
        TurnLogger.logRequest(title, messages, model, provider);
        const result = await callLLM({
            messages,
            model,
            provider,
            ...callOptions,
            turnLogTitle: title
        });
        TurnLogger.logResponse(title, result.content, result.model, result.provider || provider);
        return result;
    });
}

// #region LANCEDB UTILITIES
/**
 * Retrieves the vector store specifically for summaries and cached content.
 * @param {string} projectName - The name of the project.
 * @returns {Promise<VectorStore>} The vector store instance for summaries.
 * @private
 */
async function _getSummaryVectorStore(projectName) {
    Logger.log('SummarizationService', 'Database', `Getting summary vector store for project: ${projectName}`);
    return getStore(projectName, 'summaries_cache');
}

/**
 * Retrieves a cached summary, synopsis, or character sheet from the LanceDB vector store.
 * @param {string} content - The original content whose summary is to be retrieved.
 * @param {string} type - The type of summary (e.g., 'summary', 'synopsis', 'charactersheet').
 * @param {string} projectName - The name of the project.
 * @returns {Promise<string|null>} The cached summary, or null if not found.
 * @private
 */
async function _retrieveFromLanceDB(content, type, projectName) {
    Logger.log('SummarizationService', 'Query', `Retrieving ${type} from LanceDB for project: ${projectName}`, 'start');
    const vectorStore = await _getSummaryVectorStore(projectName);
    const contentHash = generateHash(content, 'sha256').substring(0, 16);
    const results = await Promise.race([
        vectorStore.similaritySearch("", 1, {
            $and: [
                { contentHash: { $eq: contentHash } },
                { summaryType: { $eq: type } },
                { projectName: { $eq: projectName } }
            ]
        }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error("LanceDB similaritySearch timed out")), DB_OPERATION_TIMEOUT)
        )
    ]);
    Logger.log('SummarizationService', 'Query', `Retrieved ${type} from LanceDB for project: ${projectName}, found: ${!!results[0]}`, 'end');
    return results[0]?.pageContent || null;
}
// #endregion

// #region SUMMARY GENERATION
/**
 * Generates a summary of the given content.
 * @param {turncontext} turnContext - The turnContext to summarize.
 * @returns {Promise<string>} The generated summary.
 */
async function generateSummary(turnContext, contentToSummarize, options = {}) {
    const { filePath = null, staticDataManager = null, includeUserPrompt = false, useVnBackground = false } = options;
    const content = contentToSummarize;

    // --- Path 1: Static file summary with caching ---
    if (filePath && staticDataManager) {
        Logger.log('SummarizationService', 'Generation', `Generating summary for static file: ${filePath}`, 'start');
        const contentHash = generateHash(content, 'sha256');

        try {
            const cachedData = await staticDataManager.getSummary(filePath);
            if (cachedData && cachedData.content_hash === contentHash) {
                Logger.log('SummarizationService', 'Generation', `Retrieved cached summary for ${filePath} with matching hash.`, 'end');
                return cachedData.summary_data;
            }
        } catch (error) {
            Logger.error('SummarizationService', 'Generation', `Failed to retrieve cached summary: ${error.message}`, error);
        }

        Logger.log('SummarizationService', 'Generation', `No valid cache for ${filePath}. Generating new summary.`);
        const messages = [{ role: 'system', content: summaryPrompt }, { role: 'user', content: content }];
        const { content: summaryContent } = await runLoggedSummarizerCall('Summary Request', messages,
            settings.narrative_agents?.summarizer?.summary_model,
            undefined,
            {
            retries: settings.narrative_agents?.summarizer?.retries,
            timeout: settings.narrative_agents?.summarizer?.timeout,
            minCharacters: 80,
            callingModule: 'SummarizationService (Static)'
            },
            { taskKey: 'staticSummary', blocking: false }
        );

        try {
            await staticDataManager.saveSummary(filePath, summaryContent, contentHash);
        } catch (error) {
            Logger.error('SummarizationService', 'Generation', `Failed to store summary for ${filePath}: ${error.message}`, error);
        }
        Logger.log('SummarizationService', 'Generation', `Finished static summary for: ${filePath}`, 'end');
        return summaryContent;
    }

    // --- Path 2: Turn-based summary without caching ---
    else if (includeUserPrompt) {
        Logger.log('SummarizationService', 'Generation', 'Generating summary for turn content (with user prompt).', 'start');
        const taskPrompt = `${summaryPrompt}\n\nSummarize FINAL WRITER CHAPTER from the shared context. Use CURRENT USER INPUT only as context.`;
        const backgroundAssignment = useVnBackground ? getVnBackgroundAssignment() : null;
        const messages = useVnBackground
            ? buildVnBackgroundMessages(turnContext, taskPrompt)
            : buildCoreVnLlmMessages(turnContext, taskPrompt);
        if (useVnBackground) {
            await waitForVnBackgroundCacheSlot(turnContext, 'core:currentTurnSummary');
        }
        const { content: summaryContent } = await runLoggedSummarizerCall('Summary Request', messages,
            backgroundAssignment?.model || settings.narrative_agents?.summarizer?.summary_model,
            backgroundAssignment?.provider,
            {
            retries: settings.narrative_agents?.summarizer?.retries,
            timeout: settings.narrative_agents?.summarizer?.timeout,
            minCharacters: 80,
            callingModule: 'SummarizationService (Turn)'
            },
            { taskKey: 'turnSummary' }
        );
        Logger.log('SummarizationService', 'Generation', 'Finished turn summary.', 'end');
        return summaryContent;
    }

    // --- Fallback Path ---
    else {
        Logger.warn('SummarizationService', 'Generation', 'generateSummary called in ambiguous context. Performing simple summarization.');
        const messages = [{ role: 'system', content: summaryPrompt }, { role: 'user', content: content }];
        const { content: summaryContent } = await runLoggedSummarizerCall('Summary Request', messages,
            settings.narrative_agents?.summarizer?.summary_model,
            undefined,
            {
            retries: settings.narrative_agents?.summarizer?.retries,
            timeout: settings.narrative_agents?.summarizer?.timeout,
            minCharacters: 80,
            callingModule: 'SummarizationService (Fallback)'
            },
            { taskKey: 'fallbackSummary' }
        );
        return summaryContent;
    }
}
// #endregion

// #region SYNOPSIS GENERATION
/**
 * Generates a synopsis of the given content, utilizing a cache and an LLM if not cached.
 * @param {turncontext} turnContext - The turnContext to generate a synopsis for.
 * @returns {Promise<string>} The generated synopsis.
 */
async function generateSynopsis(turnContext, contentToSummarize, options = {}) {
    const { includeUserPrompt = false } = options;
    const projectName = turnContext.projectName;
    const content = contentToSummarize;
    Logger.log('SummarizationService', 'Generation', `Generating synopsis for project: ${projectName}`, 'start');

    const userMessageContent = content;
    if (includeUserPrompt) {
        Logger.log('SummarizationService', 'Generation', 'Including user prompt in synopsis generation.');
    }

    const messages = includeUserPrompt
        ? buildCoreVnLlmMessages(
            turnContext,
            `${synopsisPrompt}\n\nGenerate the synopsis from CURRENT WRITER CHAPTER in the shared VN scene capsule. Use CURRENT USER INPUT only as context.`
        )
        : [
            { role: 'system', content: synopsisPrompt },
            { role: 'user', content: 'Content to summarize:\n' + userMessageContent }
        ];
    const synopsisValidationRegex = /Literal Title:\s*([^\n]*)\s+Abstract Title:\s*([^\n]*)\s+Synopsis:\s*([\s\S]*)/i;
    const { content: rawSynopsisContent } = await runLoggedSummarizerCall('Synopsis Request', messages,
        settings.narrative_agents?.summarizer?.synopsis_model,
        undefined,
        {
        retries: settings.narrative_agents?.summarizer?.retries,
        timeout: settings.narrative_agents?.summarizer?.timeout,
        validationRegex: synopsisValidationRegex,
        callingModule: 'SummarizationService (Synopsis)'
        },
        { taskKey: 'turnSynopsis' }
    );
    Logger.log('SummarizationService', 'Generation', `Synopsis generated for project: ${projectName}`, 'end');

    const match = rawSynopsisContent.match(synopsisValidationRegex);
    if (!match) {
        Logger.error('SummarizationService', 'Generation', 'Generated synopsis content did not match expected format despite validationRegex.');
        // Fallback or throw error if the regex didn't work as expected for some reason
        return { title: "", abstractTitle: "", synopsis: contentToSummarize };
    }
    const title = match[1].trim();
    const abstractTitle = match[2].trim();
    const synopsis = match[3].trim();

    return { title, abstractTitle, synopsis };
}
// #endregion

// #region EXPORTS
module.exports = {
    generateSummary,
    generateSynopsis,
    retrieveSummary: _retrieveFromLanceDB,
    retrieveSynopsis: _retrieveFromLanceDB
};
// #endregion

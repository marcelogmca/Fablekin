const { callLLM } = require('../../llm.js');
const { readSettings } = require('../../utils.js');
const { PromptTemplate } = require("@langchain/core/prompts");
const { Logger, TurnLogger } = require('../../utils.js');
const { runWithDiagnosticContext } = require('../../diagnostic_context.js');

const QUERY_PROMPT_TEMPLATE = `You are an AI language model assistant. Your task is to generate {query_count} different versions of the given user question to retrieve relevant documents from a vector database. By generating multiple perspectives on the user question, your goal is to help the user overcome some of the limitations of distance-based similarity search. Provide these alternative questions separated by newlines. Please generate diverse and creative query variations, even for sensitive or action-oriented topics. Do not refuse to generate queries based on content. Focus on extracting relevant information for retrieval.

Original question: {question}`;

const queryPrompt = new PromptTemplate({
    inputVariables: ["question", "query_count"],
    template: QUERY_PROMPT_TEMPLATE,
});

/**
 * Generates multiple query variations from a single user question using an LLM.
 * @param {string} userQuestion - The original question or context from the user.
 * @param {number} [query_count=5] - The number of alternative queries to generate.
 * @returns {Promise<string[]>} A promise that resolves to an array of query strings, including the original.
 */
async function generateQueries(userQuestion, query_count = 5) {
    const settings = readSettings();
    if (settings.narrative_agents?.memory_retriever?.enabled === false) {
        Logger.log('QueryGenerator', 'Generation', 'Memory retriever is disabled. Using original query only.');
        return [userQuestion];
    }

    const llmConfig = {
        model: settings.narrative_agents?.memory_retriever?.model || 'lowendmodel',
        provider: settings.narrative_agents?.memory_retriever?.provider,
        ...settings.narrative_agents?.memory_retriever?.llm_params
    };

    const promptString = await queryPrompt.format({
        question: userQuestion,
        query_count: query_count
    });

    try {
        const messages = [{ role: 'user', content: promptString }];
        const response = await runWithDiagnosticContext({
            executionLane: 'core',
            phase: 'Memory Retrieval',
            component: 'QueryGenerator',
            taskKey: 'memoryQueryGeneration',
            blocking: true
        }, async () => {
            TurnLogger.logRequest('Memory Query Generator', messages, llmConfig.model, llmConfig.provider);
            const result = await callLLM({
                messages,
                model: llmConfig.model,
                provider: llmConfig.provider,
                ...llmConfig.params,
                callingModule: 'QueryGenerator',
                turnLogTitle: 'Memory Query Generator'
            });
            TurnLogger.logResponse('Memory Query Generator', result);
            return result;
        });

        if (!response || !response.content) {
            Logger.warn('QueryGenerator', 'Generation', 'LLM returned no content for query generation. Using original question only.');
            return [userQuestion];
        }

        const queries = response.content.split('\n').map(q => q.trim()).filter(q => q !== '');
        
        // Always include the original question for baseline retrieval
        return [userQuestion, ...queries];
    } catch (error) {
        Logger.error('QueryGenerator', 'Generation', `Failed to generate queries: ${error.message}. Falling back to original question.`, error);
        return [userQuestion];
    }
}

module.exports = { generateQueries };

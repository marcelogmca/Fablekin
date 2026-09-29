const { HumanMessage, AIMessage, SystemMessage } = require("@langchain/core/messages");
const { ChatOpenAI } = require("@langchain/openai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatAnthropic } = require("@langchain/anthropic");
const { Logger, TurnLogger, readSettings, calculateCrc, sendUiNotification, repairHallucinatedLists } = require('./utils');
const cancellation = require('./pipeline_cancellation.js');
const liveTracker = require('./llm_live_tracker.js');
const { PipelineAbortError } = require('./plugin_manager/runtime/errors.js');
const devCache = require('./memory_manager/storage/devcache');
const JSON5 = require('json5');
const { jsonrepair } = require('jsonrepair');
const { extractReasoningContent } = require('./llm_response_metadata.js');
const { resolveModelAlias: resolveModelAliasFromSettings } = require('./model_routing.js');

const DEFAULT_LLM_TIMEOUT_MS = 300000;

function createLlmTimeoutError(timeoutMs) {
  const error = new Error(`LLM request timed out after ${timeoutMs}ms.`);
  error.name = 'TimeoutError';
  error.code = 'ETIMEDOUT';
  error.kind = 'timeout';
  return error;
}

function createLlmAbortError(reason) {
  if (reason instanceof Error) return reason;
  const error = new Error(String(reason || 'LLM request aborted.'));
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

/**
 * Invokes a LangChain model with an application-owned deadline. Some adapters
 * accept the `timeout` invocation option without actually terminating a stuck
 * HTTP request, so the local race is required in addition to aborting the
 * underlying request.
 */
async function invokeModelWithDeadline(configuredModel, messages, options = {}) {
  const parsedTimeout = Number(options.timeout);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? Math.floor(parsedTimeout)
    : DEFAULT_LLM_TIMEOUT_MS;
  const externalSignal = options.signal || null;
  const requestController = typeof globalThis.AbortController === 'function'
    ? new globalThis.AbortController()
    : null;
  const requestSignal = requestController?.signal || externalSignal;

  let timeoutTimer = null;
  let externalAbortHandler = null;

  const deadlinePromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(() => {
      const error = createLlmTimeoutError(timeoutMs);
      reject(error);
      if (requestController && !requestController.signal.aborted) {
        requestController.abort(error);
      }
    }, timeoutMs);
  });

  const competingPromises = [
    configuredModel.invoke(messages, requestSignal ? { timeout: timeoutMs, signal: requestSignal } : { timeout: timeoutMs }),
    deadlinePromise
  ];

  if (externalSignal) {
    competingPromises.push(new Promise((_, reject) => {
      externalAbortHandler = () => {
        const error = createLlmAbortError(externalSignal.reason);
        reject(error);
        if (requestController && !requestController.signal.aborted) {
          requestController.abort(error);
        }
      };

      if (externalSignal.aborted) externalAbortHandler();
      else externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }));
  }

  try {
    return await Promise.race(competingPromises);
  } finally {
    clearTimeout(timeoutTimer);
    if (externalSignal && externalAbortHandler) {
      externalSignal.removeEventListener('abort', externalAbortHandler);
    }
  }
}

// #region REFUSAL DETECTION
const levenshtein = require('js-levenshtein');

const REFUSAL_STRINGS = [
  "I'm unable to fulfill",
  "I can't fulfill",
  "I'm sorry, but I can't help with that",
  "I’m sorry, but I can’t help with that",
  "I cannot fulfill",
  "I can't help",
  "I cannot create",
  "I am unable to write",
  "I'm sorry, but it goes against",
  "I'm here to promote",
  "I'm an artificial intelligence",
  "can't complete your request",
  "unable to assist",
  "programmed to adhere",
  "strict content",
  "strict contente",
  "safety guidelines",
  "ethical guidelines"
];

/**
 * Checks if the LLM output contains refusal phrases.
 * This is not to jailbreak, but to prevent the system from "accepting" a refusal output and pollute the DB permanently.
 * If the LLM call exceeds retries the system will usually handle it with graceful degradation, it's better than polluting the DB with refusals.
 */
function containsRefusalFuzzy(text) {
  if (!text || typeof text !== 'string') return false;
  // Check first 1000 characters
  const searchArea = text.substring(0, 1000).toLowerCase();

  for (const refusal of REFUSAL_STRINGS) {
    const target = refusal.toLowerCase();

    // Quick exact match first
    if (searchArea.includes(target)) {
      return true;
    }

    const targetLen = target.length;
    const threshold = 0.9;
    const maxEdits = Math.floor(targetLen * (1 - threshold));

    // Sliding window for substring fuzzy match
    for (let i = 0; i <= searchArea.length - targetLen + maxEdits; i++) {
      for (let lenOffset = -maxEdits; lenOffset <= maxEdits; lenOffset++) {
        const subLen = targetLen + lenOffset;
        if (i + subLen > searchArea.length || subLen <= 0) continue;

        const sub = searchArea.substring(i, i + subLen);
        const dist = levenshtein(sub, target);
        if (dist <= maxEdits) {
          return true;
        }
      }
    }
  }
  return false;
}
// #endregion

// #region JSON REPAIR
function extractJsonCandidate(content) {
  const text = String(content ?? '');
  const startBrace = text.indexOf('{');
  const startBracket = text.indexOf('[');
  let startIdx = -1;
  if (startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) startIdx = startBrace;
  else if (startBracket !== -1) startIdx = startBracket;

  const endBrace = text.lastIndexOf('}');
  const endBracket = text.lastIndexOf(']');
  let endIdx = -1;
  if (endBrace !== -1 && (endBracket === -1 || endBrace > endBracket)) endIdx = endBrace;
  else if (endBracket !== -1) endIdx = endBracket;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return text.substring(startIdx, endIdx + 1);
  }

  return text;
}

/**
 * Parses JSON-ish LLM output using the same tolerant repair cascade as callLLM.
 * @param {string|object} input Raw LLM text, persisted JSON text, or an already parsed object.
 * @param {object} [options]
 * @param {boolean} [options.returnMeta=false] Return { data, method } instead of the parsed value.
 * @returns {object|Array|any}
 */
function repairJson(input, options = {}) {
  const returnMeta = options.returnMeta === true;

  if (input && typeof input === 'object') {
    return returnMeta ? { data: input, method: 'already_object' } : input;
  }

  const content = String(input ?? '');
  if (!content.trim()) {
    throw new Error('Cannot parse empty JSON content.');
  }

  let cleaned = extractJsonCandidate(content);
  cleaned = repairHallucinatedLists(cleaned);

  const attempts = [
    {
      method: 'JSON.parse',
      parse: () => JSON.parse(cleaned)
    },
    {
      method: 'JSON5',
      parse: () => JSON5.parse(cleaned)
    },
    {
      method: 'jsonrepair',
      parse: () => JSON5.parse(jsonrepair(cleaned))
    },
    {
      method: 'jsonrepair_whole_content',
      parse: () => JSON5.parse(jsonrepair(content))
    }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const data = attempt.parse();
      return returnMeta ? { data, method: attempt.method } : data;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`JSON parsing failed after all attempts (JSON.parse, JSON5, jsonrepair). Final error: ${lastError?.message || 'unknown parse error'}`);
}
// #endregion

// #region MODULE IMPORTS
// Removed top-level settings read to ensure we always use the latest patched settings
// const settings = readSettings(); 
// #endregion

// #region PROVIDER INSTANTIATION
function normalizeProviderKey(providerKey) {
  const key = String(providerKey || '').trim().toLowerCase();
  if (key === 'nano gpt' || key === 'nano-gpt' || key === 'nanogpt' || key === 'nano_gpt') {
    return 'nano_gpt';
  }
  return key;
}

function resolveCallProviderKey(routeProvider, providerOverride = null) {
  const providerKey = normalizeProviderKey(routeProvider);
  const overrideKey = normalizeProviderKey(providerOverride);
  if (overrideKey && overrideKey !== providerKey) {
    throw new Error(
      `Resolved model route uses '${providerKey}', but '${overrideKey}' was passed as an override. ` +
      'Provider overrides are no longer supported; configure the alias in Settings > Models & Routing.'
    );
  }
  return providerKey;
}

function isFallbackEligibleError(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.cause?.status,
    error?.cause?.statusCode
  ];
  const status = candidates.find(value => Number.isInteger(Number(value)));
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return true;

  const message = String(error?.message || error || '');
  const statusMatch = message.match(/\b(408|429|5\d{2})\b/);
  if (statusMatch) return true;

  return /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b|network error|fetch failed|service unavailable|gateway timeout|request timed out/i.test(message);
}

function normalizeProviderConfig(providerConfig) {
  if (providerConfig && typeof providerConfig === 'object' && !Array.isArray(providerConfig)) {
    return providerConfig;
  }

  if (typeof providerConfig === 'string') {
    const trimmed = providerConfig.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON5.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      Logger.warn('LLM', `Failed to parse provider config JSON string: ${error.message}`);
      return {};
    }
  }

  return {};
}

function getProviderConfig(settings, providerKey) {
  const providerRegistry = settings.infrastructure?.providers || {};

  if (providerKey === 'nano_gpt') {
    return normalizeProviderConfig(
      providerRegistry.nano_gpt
      || providerRegistry.nanogpt
      || providerRegistry['nano-gpt']
      || providerRegistry['nano gpt']
      || {}
    );
  }

  return normalizeProviderConfig(providerRegistry[providerKey] || {});
}

function getConfiguredProviderKeys(settings) {
  return Object.keys(settings.infrastructure?.providers || {});
}

/**
 * Normalizes a configured provider URL into an OpenAI-compatible API root.
 * The OpenAI SDK appends its own route to `configuration.baseURL`, so a URL that
 * already points at `/chat/completions` (e.g. pasted from a curl example) would
 * otherwise be requested as `.../chat/completions/chat/completions` and 404.
 */
function normalizeOpenAICompatibleBaseUrl(rawUrl) {
  return String(rawUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/+$/, '');
}

/**
 * Ensures that a specific provider is instantiated with the latest settings.
 * @param {string} providerKey 
 * @returns {object|null}
 */
function getProviderInstance(providerKey, fallbackModel = null, settingsOverride = null) {
  const settings = settingsOverride || readSettings();
  const providerKeyLower = normalizeProviderKey(providerKey);

  // Return cached instance if it exists
  // if (providers[providerKeyLower]) return providers[providerKeyLower];

  // We re-instantiate if called, OR we could cache. 
  // Given that settings can change (API keys), caching might be tricky unless we invalidate.
  // For now, let's instantiate on demand to ensure latest keys are used.

  try {
    switch (providerKeyLower) {
      case 'openai': {
        const config = getProviderConfig(settings, 'openai');
        if (config.apiKey && !config.apiKey.startsWith('YOUR_')) {
          return new ChatOpenAI({ apiKey: config.apiKey });
        }
        break;
      }
      case 'openrouter': {
        const config = getProviderConfig(settings, 'openrouter');
        if (config.apiKey && !config.apiKey.startsWith('YOUR_')) {
          return new ChatOpenAI({
            apiKey: config.apiKey,
            configuration: {
              baseURL: normalizeOpenAICompatibleBaseUrl(config.url),
              defaultHeaders: {
                'HTTP-Referer': 'http://localhost:14541',
                'X-Title': 'Fablekin Engine',
              },
            },
          });
        }
        break;
      }
      case 'gemini': {
        const config = getProviderConfig(settings, 'gemini');
        if (config.apiKey && !config.apiKey.startsWith('YOUR_')) {
          const geminiRoute = Object.values(settings.infrastructure?.llm_routing?.aliases || {})
            .find(route => normalizeProviderKey(route?.provider) === 'gemini' && String(route?.model || '').trim());
          const bootstrapModel = String(fallbackModel || geminiRoute?.model || '').trim();
          if (!bootstrapModel) {
            throw new Error('Gemini has no configured model alias. Configure a Gemini route in Settings > Models & Routing.');
          }
          return new ChatGoogleGenerativeAI({
            apiKey: config.apiKey,
            model: bootstrapModel,
          });
        }
        break;
      }
      case 'anthropic': {
        const config = getProviderConfig(settings, 'anthropic');
        if (config.apiKey && !config.apiKey.startsWith('YOUR_')) {
          return new ChatAnthropic({ apiKey: config.apiKey });
        }
        break;
      }
      case 'deepseek': {
        const config = getProviderConfig(settings, 'deepseek');
        if (config.apiKey && !config.apiKey.startsWith('YOUR_')) {
          return new ChatOpenAI({
            apiKey: config.apiKey,
            configuration: { baseURL: normalizeOpenAICompatibleBaseUrl(config.url) },
          });
        }
        break;
      }
      case 'generic': {
        const config = getProviderConfig(settings, 'generic');
        const baseURL = normalizeOpenAICompatibleBaseUrl(config.url);
        // Key is optional (local no-auth servers); URL is required.
        if (baseURL) {
          const apiKey = (config.apiKey && !config.apiKey.startsWith('YOUR_'))
            ? config.apiKey
            : 'not-needed';
          return new ChatOpenAI({
            apiKey,
            configuration: { baseURL },
          });
        }
        break;
      }
      case 'nano_gpt': {
        const config = getProviderConfig(settings, 'nano_gpt');
        if (config.apiKey && !config.apiKey.startsWith('YOUR_')) {
          return new ChatOpenAI({
            apiKey: config.apiKey,
            configuration: {
              baseURL: normalizeOpenAICompatibleBaseUrl(config.url || 'https://nano-gpt.com/api/v1'),
            },
          });
        }
        break;
      }
    }
  } catch (err) {
    Logger.error('LLM', `Failed to instantiate ${providerKey} client`, err);
  }

  return null;
}
// #endregion

// #region MODEL RESOLUTION
/**
 * Resolves a global model alias to its provider-backed route.
 * @param {string} modelAlias - The alias such as "veryhighendmodel".
 * @returns {{alias: string, provider: string, model: string, subprovider?: string}}
 */
function resolveModelAlias(modelAlias) {
  return resolveModelAliasFromSettings(readSettings(), modelAlias);
}

function parseSubproviderList(subprovider) {
  return String(subprovider || '')
    .split(',')
    .map(slug => slug.trim())
    .filter(Boolean);
}

function normalizeOpenRouterReasoningModel(modelName, extra = {}) {
  const baseExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
  const model = String(modelName || '');
  const match = model.match(/:(thinking|no[_-]?thinking|nothinking)$/i);
  if (!match) return { model, extra: baseExtra };

  const marker = match[1].toLowerCase().replace(/[-_]/g, '');
  const effort = marker === 'thinking' ? 'high' : 'none';
  const effectiveEffort = baseExtra.reasoning?.effort || effort;
  const normalizedExtra = {
    ...baseExtra,
    reasoning: {
      ...(baseExtra.reasoning && typeof baseExtra.reasoning === 'object' && !Array.isArray(baseExtra.reasoning)
        ? baseExtra.reasoning
        : {}),
      effort: effectiveEffort
    }
  };

  return {
    model: model.slice(0, -match[0].length),
    extra: normalizedExtra,
    reasoningMarker: match[0],
    reasoningEffort: effectiveEffort
  };
}

function applyRouteReasoningEffort(route, extra = {}) {
  const normalizedExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {};
  const effort = String(route?.reasoning_effort || '').trim().toLowerCase();
  const existingReasoning = normalizedExtra.reasoning && typeof normalizedExtra.reasoning === 'object' && !Array.isArray(normalizedExtra.reasoning)
    ? { ...normalizedExtra.reasoning }
    : {};
  if (effort && !existingReasoning.effort && !normalizedExtra.reasoning_effort) {
    normalizedExtra.reasoning = { ...existingReasoning, effort };
  }
  return normalizedExtra;
}

function normalizeReasoningParamsForProvider(providerKey, extra = {}) {
  const normalized = { ...(extra || {}) };
  if (normalized.reasoning && typeof normalized.reasoning === 'object' && !Array.isArray(normalized.reasoning)) {
    normalized.reasoning = { ...normalized.reasoning };
  }
  if (normalized.reasoning && (providerKey === 'openai' || providerKey === 'deepseek' || providerKey === 'generic')) {
    const effort = normalized.reasoning.effort;
    if (providerKey === 'generic') {
      // Commander GOAT (and OpenAI-compatible relays generally) only accept
      // low/medium/high/xhigh/max. 'none' means "no reasoning" — send nothing.
      // 'minimal' has no upstream equivalent; 'low' is the closest level.
      const mapped = effort === 'minimal' ? 'low' : effort;
      if (mapped && mapped !== 'none' && !normalized.reasoning_effort) {
        normalized.reasoning_effort = mapped;
      }
    } else if (effort && !normalized.reasoning_effort) {
      normalized.reasoning_effort = providerKey === 'deepseek' && effort === 'minimal' ? 'low' : effort;
    }
    delete normalized.reasoning;
  } else if (normalized.reasoning && providerKey !== 'openrouter' && providerKey !== 'nano_gpt') {
    // The pinned Anthropic, Gemini, and Ollama adapters do not expose the same
    // effort-level contract. Do not forward an incompatible router parameter.
    delete normalized.reasoning;
  }
  if (!['openrouter', 'nano_gpt', 'openai', 'deepseek', 'generic'].includes(providerKey)) {
    delete normalized.reasoning_effort;
  }
  if (providerKey === 'generic' && (normalized.reasoning_effort === 'none' || normalized.reasoning_effort === 'minimal')) {
    // Same Commander GOAT contract as above, for callers that set
    // reasoning_effort directly instead of via reasoning.effort.
    if (normalized.reasoning_effort === 'none') delete normalized.reasoning_effort;
    else normalized.reasoning_effort = 'low';
  }
  return normalized;
}

/**
 * Executes a single, side-effect-free LLM request against an explicit provider
 * and raw model id. This is intentionally narrower than callLLM: it does not
 * resolve aliases, retry, validate, use the local dev cache, emit generation
 * notifications, or link usage into TurnLogger.
 */
async function callLLMDirect({ messages, provider, model, timeout = DEFAULT_LLM_TIMEOUT_MS, extra = {}, signal = null }) {
  const settings = readSettings();
  const providerKey = normalizeProviderKey(provider);
  const rawModel = String(model || '').trim();

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Arena requests require at least one message.');
  }
  if (!rawModel) throw new Error('Arena requests require a raw model id.');

  const configuredProviders = getConfiguredProviderKeys(settings).map(normalizeProviderKey);
  if (!configuredProviders.includes(providerKey)) {
    throw new Error(`Provider '${providerKey}' is not configured.`);
  }

  const baseModelInstance = getProviderInstance(providerKey, rawModel);
  if (!baseModelInstance) {
    const providerConfig = getProviderConfig(settings, providerKey);
    if (providerKey === 'generic' && !String(providerConfig.url || '').trim()) {
      throw new Error(`Provider 'generic' has no endpoint URL. Set it in Settings > Models & Routing > Provider Connections.`);
    }
    if (providerKey !== 'ollama' && providerKey !== 'generic' && providerConfig && Object.keys(providerConfig).length > 0 && !providerConfig.apiKey) {
      throw new Error(`Provider '${providerKey}' has no configured API key.`);
    }
    throw new Error(`Provider '${providerKey}' is unavailable.`);
  }

  const suffixReasoningRoute = (providerKey === 'openrouter' || providerKey === 'nano_gpt')
    ? normalizeOpenRouterReasoningModel(rawModel, extra)
    : { model: rawModel, extra };
  const normalizedRoute = providerKey === 'nano_gpt'
    ? { ...suffixReasoningRoute, model: rawModel }
    : suffixReasoningRoute;
  const resolvedModel = normalizedRoute.model;
  const callExtraParams = normalizeReasoningParamsForProvider(providerKey, normalizedRoute.extra);
  if (providerKey === 'openrouter' && settings.infrastructure?.include_cache_usage) {
    callExtraParams.usage = { include: true };
  }

  const dynamicInstance = new baseModelInstance.constructor({
    ...baseModelInstance.lc_kwargs,
    model: resolvedModel,
    modelName: resolvedModel,
    modelKwargs: callExtraParams,
    ...(baseModelInstance instanceof ChatOpenAI ? { __includeRawResponse: true } : {})
  });
  const configuredModel = dynamicInstance.withConfig({ retries: 0 });
  const langChainMessages = messages.map((message) => {
    const content = message?.content ?? '';
    if (message?.role === 'system') return new SystemMessage(content);
    if (message?.role === 'assistant') return new AIMessage(content);
    return new HumanMessage(content);
  });

  const startedAt = Date.now();
  const response = await invokeModelWithDeadline(configuredModel, langChainMessages, { timeout, signal });
  let content = response.content;
  const reasoning = extractReasoningContent(response);

  if (typeof content === 'string' && settings.infrastructure?.sanitize_responses?.enabled) {
    content = content.replace(/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf\u3400-\u4dbf]/g, '');
  }

  return {
    content,
    reasoning,
    model: resolvedModel,
    provider: providerKey,
    usage: normalizeUsageData(providerKey, response),
    durationMs: Date.now() - startedAt
  };
}

function listConfiguredProviders() {
  return getConfiguredProviderKeys(readSettings())
    .map(normalizeProviderKey)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));
}

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = asFiniteNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function mergePlainUsageObjects(...objects) {
  const merged = {};
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    Object.assign(merged, obj);
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

function getNestedUsageValue(usage, path) {
  if (!usage || typeof usage !== 'object') return undefined;
  return path.reduce((current, key) => current?.[key], usage);
}

function extractReasoningTokenCount(usage) {
  return firstFiniteNumber(
    usage?.reasoning_tokens,
    usage?.reasoningTokens,
    usage?.native_tokens_reasoning,
    usage?.nativeTokensReasoning,
    usage?.completion_tokens_details?.reasoning_tokens,
    usage?.completionTokensDetails?.reasoningTokens,
    usage?.completionTokensDetails?.reasoning_tokens,
    usage?.output_token_details?.reasoning,
    usage?.outputTokenDetails?.reasoning,
    getNestedUsageValue(usage, ['output_token_details', 'reasoning_tokens']),
    getNestedUsageValue(usage, ['outputTokenDetails', 'reasoning_tokens'])
  );
}

function extractCachedInputTokenCount(usage) {
  return firstFiniteNumber(
    usage?.cached_input_tokens,
    usage?.cachedInputTokens,
    usage?.cache_read_tokens,
    usage?.cacheReadTokens,
    usage?.cache_read_input_tokens,
    usage?.prompt_tokens_details?.cached_tokens,
    usage?.promptTokensDetails?.cachedTokens,
    usage?.input_token_details?.cache_read,
    usage?.input_token_details?.cached_tokens,
    usage?.inputTokenDetails?.cacheRead,
    usage?.inputTokenDetails?.cachedTokens,
    usage?.cachedTokens
  );
}

function extractCacheWriteTokenCount(usage) {
  return firstFiniteNumber(
    usage?.cache_write_tokens,
    usage?.cacheWriteTokens,
    usage?.cache_creation_input_tokens,
    usage?.prompt_tokens_details?.cache_write_tokens,
    usage?.promptTokensDetails?.cacheWriteTokens,
    usage?.input_token_details?.cache_write,
    usage?.inputTokenDetails?.cacheWrite
  );
}

function normalizeUsageData(providerKey, response) {
  const additionalKwargs = mergePlainUsageObjects(
    response?.additional_kwargs,
    response?.lc_kwargs?.additional_kwargs
  ) || {};
  const responseMetadata = response?.response_metadata || {};
  const tokenUsage = mergePlainUsageObjects(
    responseMetadata.tokenUsage,
    responseMetadata.token_usage
  );
  const usageMetadata = mergePlainUsageObjects(
    response?.usage_metadata,
    response?.usageMetadata
  );

  const usage = mergePlainUsageObjects(
    additionalKwargs.usage,
    responseMetadata.usage,
    tokenUsage,
    usageMetadata
  );

  if (!usage) return null;

  const promptTokens = firstFiniteNumber(
    usage.prompt_tokens,
    usage.promptTokens,
    usage.input_tokens,
    usage.inputTokens
  );
  const completionTokens = firstFiniteNumber(
    usage.completion_tokens,
    usage.completionTokens,
    usage.output_tokens,
    usage.outputTokens
  );
  const totalTokens = firstFiniteNumber(
    usage.total_tokens,
    usage.totalTokens,
    promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null
  );
  const reasoningTokens = extractReasoningTokenCount(usage);
  const cachedInputTokens = extractCachedInputTokenCount(usage);
  const cacheWriteTokens = extractCacheWriteTokenCount(usage);
  const visibleCompletionTokens = firstFiniteNumber(
    usage.visible_completion_tokens,
    usage.visibleCompletionTokens,
    usage.output_token_details?.visible,
    usage.outputTokenDetails?.visible
  );
  const generationTokens = firstFiniteNumber(
    usage.generation_tokens,
    usage.generationTokens,
    completionTokens,
    visibleCompletionTokens !== null || reasoningTokens !== null
      ? Math.max(visibleCompletionTokens || 0, (visibleCompletionTokens || 0) + (reasoningTokens || 0))
      : null
  );

  const normalized = { ...usage };
  normalized.provider = normalized.provider || providerKey;

  if (promptTokens !== null) {
    normalized.prompt_tokens = promptTokens;
    normalized.promptTokens = promptTokens;
  }
  if (completionTokens !== null) {
    normalized.completion_tokens = completionTokens;
    normalized.completionTokens = completionTokens;
  }
  if (totalTokens !== null) {
    normalized.total_tokens = totalTokens;
    normalized.totalTokens = totalTokens;
  }
  if (generationTokens !== null) {
    normalized.generation_tokens = generationTokens;
    normalized.generationTokens = generationTokens;
  }
  if (reasoningTokens !== null) {
    normalized.reasoning_tokens = reasoningTokens;
    normalized.reasoningTokens = reasoningTokens;
    normalized.completion_tokens_details = {
      ...(normalized.completion_tokens_details || {}),
      reasoning_tokens: reasoningTokens
    };
    normalized.output_token_details = {
      ...(normalized.output_token_details || {}),
      reasoning: reasoningTokens
    };
  }
  if (visibleCompletionTokens !== null) {
    normalized.visible_completion_tokens = visibleCompletionTokens;
    normalized.visibleCompletionTokens = visibleCompletionTokens;
  } else if (generationTokens !== null && reasoningTokens !== null) {
    const inferredVisibleTokens = Math.max(0, generationTokens - reasoningTokens);
    normalized.visible_completion_tokens = inferredVisibleTokens;
    normalized.visibleCompletionTokens = inferredVisibleTokens;
  }
  if (cachedInputTokens !== null) {
    normalized.cached_input_tokens = cachedInputTokens;
    normalized.cachedInputTokens = cachedInputTokens;
    normalized.cache_read_tokens = cachedInputTokens;
    normalized.cacheReadTokens = cachedInputTokens;
  }
  if (cacheWriteTokens !== null) {
    normalized.cache_write_tokens = cacheWriteTokens;
    normalized.cacheWriteTokens = cacheWriteTokens;
  }
  if (promptTokens !== null && cachedInputTokens !== null) {
    const boundedCachedTokens = Math.min(Math.max(0, cachedInputTokens), Math.max(0, promptTokens));
    const boundedCacheWriteTokens = Math.min(
      Math.max(0, cacheWriteTokens || 0),
      Math.max(0, promptTokens - boundedCachedTokens)
    );
    normalized.uncached_input_tokens = Math.max(0, promptTokens - boundedCachedTokens - boundedCacheWriteTokens);
    normalized.uncachedInputTokens = normalized.uncached_input_tokens;
    normalized.cache_hit_ratio = promptTokens > 0 ? boundedCachedTokens / promptTokens : 0;
    normalized.cacheHitRatio = normalized.cache_hit_ratio;
  }

  return normalized;
}
// #endregion

// #region MASTER LLM CALL
/**
 * A robust, universal function for making requests to Large Language Models (LLMs) via LangChain.
 *
 * This is the central entry point for all LLM interactions in the system. It provides a consistent,
 * resilient, and observable interface, abstracting away provider-specific complexities.
 *
 * Key Features:
 * - **Multi-Provider Support:** Works with any configured LangChain provider (e.g., OpenRouter, Ollama).
 * - **Custom Retry Logic:** Implements a manual retry loop with configurable attempts, providing detailed
 *   logging for each attempt and preventing conflicts with library-level retries.
 * - **Resilient JSON Parsing:** If `expectJson` is true, it cleans the LLM response (removing markdown fences
 *   and conversational fluff) before attempting to parse, and retries the entire call if parsing fails.
 * - **Flexible Regex Validation:** Can validate the raw text response against a regular expression,
 *   retrying the call if the pattern does not match.
 * - **Provider-Specific Routing:** Lets aliases use `subprovider` for OpenRouter and NanoGPT routing,
 *   ensuring deterministic behavior and cost control.
 * - **Response Sanitization:** Optionally removes CJK character artifacts from responses, configurable in settings.
 *
 * @param {object} params - The parameters for the LLM call.
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} [params.messages] - The message payload in standard OpenAI format. Legacy path.
 * @param {PreparedPrompt} [params.prompt] - A PreparedPrompt from engine/modules/prompt/prompt.js. Exactly one of messages/prompt is required.
 * @param {string} params.model - A global model alias such as 'veryhighendmodel'. Its route selects the provider and concrete model.
 * @param {number} [params.retries=1] - The number of times to automatically retry on API errors or validation failures. (Total attempts = retries + 1).
 * @param {number} [params.timeout=300000] - The enforced per-attempt request timeout in milliseconds.
 * @param {object} [params.extra={}] - Extra parameters (e.g., temperature, topP) to be passed into the `modelKwargs` of the LangChain call.
 * @param {boolean} [params.expectJson=false] - If true, validates and parses the response as JSON.
 * @param {RegExp} [params.validationRegex=null] - If provided, tests the string response against this regex. The call fails and retries if the regex does not match.
 * @param {function} [params.validateFn=null] - If provided, an optional validation function that receives (content, messages) and must return true/false or throw an error.
 * @param {number} [params.minWords=0] - Minimum number of whitespace-delimited words required in a string response. Undersized responses are retried.
 * @returns {Promise<{content: (string|object), model: string}>} A promise that resolves to an object containing the LLM's response content (as a string, or a parsed object if expectJson is true) and the final resolved model name used for the call.
 * @throws {Error} Throws an error if the provider is invalid, or if all retry attempts fail. The error will contain the message from the last failed attempt.
 */
async function callLLM({ prompt, model, provider = null, retries = 1, timeout = DEFAULT_LLM_TIMEOUT_MS, extra = {}, expectJson = false, validationRegex = null, validateFn = null, minCharacters = 0, minWords = 0, callingModule = 'LLM', turnLogTitle = null }) {
  const safeModule = callingModule || 'LLM';
  const numericMinWords = Number(minWords);
  const effectiveMinWords = Number.isFinite(numericMinWords) ? Math.max(0, Math.floor(numericMinWords)) : 0;
  const settings = readSettings();
  // Prepared-only (cutover): the provider payload derives from the immutable
  // PreparedPrompt. The manifest never reaches the provider, only logging.
  const { PreparedPrompt } = require('./prompt/prompt.js');
  if (!(prompt instanceof PreparedPrompt)) {
    throw new TypeError('callLLM requires a PreparedPrompt returned by Prompt.prepare(). Migrate the caller to compose its request.');
  }
  const messages = prompt.messages.map(message => ({ role: message.role, content: message.content }));
  const promptTrace = {
    promptId: prompt.id,
    hash: prompt.hash,
    characterCount: prompt.characterCount,
    manifest: prompt.manifest
  };
  cancellation.throwIfCancelled(`LLM request for ${safeModule}`);

  const primaryRoute = resolveModelAlias(model);
  const fallbackRoute = primaryRoute.fallback || null;
  const buildAttemptRoute = (route, { useProviderOverride = false } = {}) => {
    const providerKey = useProviderOverride
      ? resolveCallProviderKey(route.provider, provider)
      : normalizeProviderKey(route.provider);
    const baseModelInstance = getProviderInstance(providerKey);
    if (!baseModelInstance) {
      const providerConfig = getProviderConfig(settings, providerKey);
      if (providerKey === 'generic' && !String(providerConfig.url || '').trim()) {
        throw new Error(`Provider 'generic' has no endpoint URL. Set it in Settings > Models & Routing > Provider Connections.`);
      }
      if (providerKey !== 'ollama' && providerKey !== 'generic' && providerConfig && Object.keys(providerConfig).length > 0 && !providerConfig.apiKey) {
        throw new Error(`Provider '${providerKey}' is configured but has no API key. Set it in Settings > Secrets.`);
      }
      const available = getConfiguredProviderKeys(settings).join(', ');
      throw new Error(`Model alias '${model}' routes through unavailable provider '${providerKey}'. Available providers are: ${available}`);
    }

    const routeExtra = applyRouteReasoningEffort(route, extra);
    const normalizedRoute = providerKey === 'openrouter'
      ? normalizeOpenRouterReasoningModel(route.model, routeExtra)
      : { model: route.model, extra: routeExtra };
    return {
      providerKey,
      baseModelInstance,
      resolvedModel: normalizedRoute.model,
      normalizedExtra: normalizedRoute.extra,
      subprovider: route.subprovider,
      reasoningMarker: normalizedRoute.reasoningMarker,
      reasoningEffort: normalizedRoute.reasoningEffort
    };
  };

  const primaryAttemptRoute = buildAttemptRoute(primaryRoute, { useProviderOverride: true });
  let usingFallback = false;

  const totalAttempts = retries + 1;

  // Live LLM road + turn logs: one stable callId spans every retry attempt
  // so the viewer renders a single bar per logical call and the turn log can
  // join request/response/error entries to their prepared prompt trace.
  const liveCallId = liveTracker.start({
    title: turnLogTitle || safeModule,
    callingModule: safeModule,
    model: primaryAttemptRoute.resolvedModel,
    provider: primaryAttemptRoute.providerKey,
    maxAttempts: totalAttempts
  });
  // Central logging: the promptTrace joins the request entry; the
  // response/error entries reuse the same callId instead of the title.
  if (turnLogTitle) {
    TurnLogger.logRequest(turnLogTitle, messages, model, provider, false, null, {
      promptTrace: { ...promptTrace, callId: liveCallId }
    });
  }
  let liveCallSettled = false;
  const settleLiveCall = (payload) => {
    if (liveCallSettled) return;
    liveCallSettled = true;
    liveTracker.end(liveCallId, payload);
  };

  try {
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      cancellation.throwIfCancelled(`LLM request for ${safeModule}`);
      let providerKey = primaryAttemptRoute.providerKey;
      let baseModelInstance = primaryAttemptRoute.baseModelInstance;
      let resolvedModel = primaryAttemptRoute.resolvedModel;
      let normalizedExtra = primaryAttemptRoute.normalizedExtra;
      let subprovider = primaryAttemptRoute.subprovider;
      let requestCrc = null;
      try {
        const attemptRoute = usingFallback
          ? buildAttemptRoute(fallbackRoute)
          : primaryAttemptRoute;
        ({ providerKey, baseModelInstance, resolvedModel, normalizedExtra, subprovider } = attemptRoute);
        if (attemptRoute.reasoningMarker) {
          Logger.log(
            safeModule,
            resolvedModel,
            `Translated OpenRouter model suffix ${attemptRoute.reasoningMarker} to reasoning.effort=${attemptRoute.reasoningEffort}.`
          );
        }

        if (settings.infrastructure?.enable_dev_cache) {
          const requestFingerprint = {
            messages,
            provider: providerKey,
            model: resolvedModel,
            subprovider,
            extra: normalizedExtra,
            expectJson,
            validationRegex: validationRegex ? validationRegex.source : null,
            minCharacters
          };
          if (effectiveMinWords > 0) requestFingerprint.minWords = effectiveMinWords;
          requestCrc = calculateCrc(JSON.stringify(requestFingerprint));
          const cached = await devCache.get(requestCrc, resolvedModel);
          if (cached) {
            cancellation.throwIfCancelled(`LLM cache hit for ${safeModule}`);
            Logger.log(safeModule, resolvedModel, 'LOCAL DEV CACHE HIT');
            const usageData = { is_local_cache: true, cost: 0, prompt_tokens: 0, completion_tokens: 0 };
            TurnLogger.linkUsage(providerKey, resolvedModel, cached, usageData);
            settleLiveCall({ status: 'done', model: resolvedModel, provider: providerKey, cached: true, attempt });
            // A local dev-cache hit serves the same-size request locally: log
            // it as cached, never as a zero-sized prompt.
            if (promptTrace && turnLogTitle) {
              TurnLogger.logResponse(turnLogTitle, {
                content: cached,
                model: resolvedModel,
                provider: providerKey,
                usage: { ...usageData, prompt_trace_hash: promptTrace.hash },
                reasoning: null,
                extraPayload: { callId: liveCallId, cacheHit: true }
              });
            }
            return { content: cached, model: resolvedModel, provider: providerKey, usage: usageData };
          }
        }

        const callExtraParams = normalizeReasoningParamsForProvider(providerKey, normalizedExtra);
        // --- REASONING NORMALIZATION ---
        if (callExtraParams.reasoning) {
          const r = callExtraParams.reasoning;
          if (providerKey === 'openrouter' || providerKey === 'nano_gpt') {
            // Router-style providers support the unified reasoning object directly.
            // No changes needed to the structure, but we ensure it persists here.
            Logger.log(safeModule, resolvedModel, `Reasoning configuration detected: ${JSON.stringify(r)}`);
          }
        }

        // Let aliases use the same `subprovider` field across providers, then map it
        // to each upstream API's routing shape.
        const providerOrder = parseSubproviderList(subprovider);
        if (providerOrder.length > 0) {
          const existingProviderPrefs =
            callExtraParams.provider && typeof callExtraParams.provider === 'object' && !Array.isArray(callExtraParams.provider)
              ? callExtraParams.provider
              : {};

          if (providerKey === 'openrouter') {
            callExtraParams.provider = {
              ...existingProviderPrefs,
              order: providerOrder,
              allow_fallbacks: false
            };
            Logger.log(
              safeModule,
              resolvedModel,
              `Forcing OpenRouter provider order [${providerOrder.join(', ')}] with fallbacks disabled.`
            );
          } else if (providerKey === 'nano_gpt') {
            callExtraParams.provider = {
              ...existingProviderPrefs,
              only: providerOrder,
              allow_fallbacks: false
            };
            Logger.log(
              safeModule,
              resolvedModel,
              `Forcing NanoGPT provider selection [${providerOrder.join(', ')}] with fallbacks disabled.`
            );
          }
        }

        if (providerKey === 'openrouter') {
          // Conditionally add usage: {include: true} for OpenRouter if setting is enabled
          if (settings.infrastructure?.include_cache_usage) {
            callExtraParams.usage = { include: true };
            Logger.log(safeModule, resolvedModel, `Including usage stats for OpenRouter call.`);
          }
        }

        Logger.log(safeModule, resolvedModel, `Making API call attempt ${attempt}/${totalAttempts} via [${providerKey}]`, 'start');

        // Create a dynamic instance for this specific call to avoid mutating the base instance
        const dynamicInstance = new baseModelInstance.constructor({
          ...baseModelInstance.lc_kwargs, // Copy original configuration (API key, baseURL)
          model: resolvedModel,           // Support both 'model' (Gemini, Anthropic)
          modelName: resolvedModel,       // and 'modelName' (OpenAI)
          modelKwargs: callExtraParams,    // Pass extra params directly to the API request body
          ...(baseModelInstance instanceof ChatOpenAI ? { __includeRawResponse: true } : {}),
        });

        // Disable LangChain's internal retries to rely solely on our custom loop
        const configuredModel = dynamicInstance.withConfig({ retries: 0 });

        // Convert standard message format to LangChain's message objects
        const langChainMessages = messages.map(msg => {
          switch (msg.role) {
            case 'system': return new SystemMessage(msg.content);
            case 'user': return new HumanMessage(msg.content);
            case 'assistant': return new AIMessage(msg.content);
            default: return new HumanMessage(msg.content);
          }
        });

        const slowThresholdMs = 90000;
        let slowWarningTimer = setTimeout(() => {
          Logger.log(safeModule, resolvedModel, `API call is taking longer than ${Math.round(slowThresholdMs / 1000)}s... Waiting on [${providerKey}].`);
        }, slowThresholdMs);

        let response;
        let llmAbort = null;
        try {
          llmAbort = cancellation.registerLlmCall({
            callingModule: safeModule,
            provider: providerKey,
            model: resolvedModel,
            attempt
          });
          response = await invokeModelWithDeadline(configuredModel, langChainMessages, {
            timeout,
            signal: llmAbort.signal
          });
          llmAbort.throwIfCancelled(`LLM response for ${safeModule}`);
        } finally {
          clearTimeout(slowWarningTimer);
          if (llmAbort) llmAbort.done();
        }

        let content = response.content;
        const reasoning = extractReasoningContent(response);
        cancellation.throwIfCancelled(`LLM response handling for ${safeModule}`);

        // Sanitize CJK artifacts from multi-language models if enabled
        if (content && typeof content === 'string') {
          const sanitizeEnabled = settings.infrastructure?.sanitize_responses?.enabled ?? false;
          if (sanitizeEnabled) {
            const sanitizerRegex = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf\u3400-\u4dbf]/g;
            const originalLength = content.length;
            content = content.replace(sanitizerRegex, '');
            if (content.length < originalLength) {
              Logger.log(safeModule, resolvedModel, `Sanitized ${originalLength - content.length} Asian character artifacts from response.`);
            }
          }
        }

        // --- Minimum Characters Validation ---
        // We treat an empty response (length 0) as invalid by default to trigger a retry.
        const effectiveMinChars = Math.max(minCharacters, 1);
        if (content.length < effectiveMinChars) {
          throw new Error(`Response too short. Expected at least ${effectiveMinChars} characters, got ${content.length}. Retrying...`);
        }

        // --- Minimum Words Validation ---
        if (effectiveMinWords > 0) {
          const responseWordCount = typeof content === 'string'
            ? (content.match(/\S+/g) || []).length
            : 0;
          if (responseWordCount < effectiveMinWords) {
            throw new Error(`Response too short. Expected at least ${effectiveMinWords} words, got ${responseWordCount}. Retrying...`);
          }
        }

        // --- Refusal Detection ---
        if (typeof content === 'string' && containsRefusalFuzzy(content)) {
          throw new Error(`AI refusal detected in response. Retrying to avoid polluting the DB...`);
        }

        // --- JSON Validation and Parsing ---
        let finalContent = content;
        if (expectJson) {
          try {
            const parsed = repairJson(content, { returnMeta: true });
            finalContent = parsed.data;
            Logger.log(safeModule, resolvedModel, `[${providerKey}] JSON parsed successfully via ${parsed.method} on attempt ${attempt}.`);
          } catch (parseError) {
            if (validateFn) {
              try {
                const rawAccepted = await validateFn(content, messages);
                if (rawAccepted !== false) {
                  finalContent = content;
                  Logger.warn(
                    safeModule,
                    resolvedModel,
                    `[${providerKey}] JSON parsing failed, but raw text passed custom validation; accepting raw response.`
                  );
                } else {
                  throw new Error('Custom validation function returned false for raw text.');
                }
              } catch (rawValidationError) {
                throw new Error(`Failed to parse JSON: ${parseError.message}. Raw text validation also failed: ${rawValidationError.message}. Original content: "${content}"`);
              }
            } else {
            // If parsing fails, throw an error to trigger the main catch block for a retry
              throw new Error(`Failed to parse JSON: ${parseError.message}. Original content: "${content}"`);
            }
          }
        } else if (validationRegex) {
          // --- Regex Validation ---
          if (validationRegex.test(content)) {
            Logger.log(safeModule, resolvedModel, `Validation regex passed on attempt ${attempt}.`);
          } else {
            // If the regex doesn't match, throw an error to trigger a retry
            const preview = typeof content === 'string' ? content.slice(0, 240) : String(content).slice(0, 240);
            throw new Error(`Validation regex failed to match. Regex: /${validationRegex.source}/. Response length: ${content.length}. Preview: "${preview}${content.length > 240 ? '…' : ''}"`);
          }
        }

        // --- Custom Validation Function ---
        if (validateFn) {
          try {
            const isValid = await validateFn(finalContent, messages);
            if (isValid === false) {
              throw new Error(`Custom validation function returned false.`);
            }
            Logger.log(safeModule, resolvedModel, `Custom validation function passed on attempt ${attempt}.`);
          } catch (valError) {
            throw new Error(`Custom validation failed: ${valError.message}`);
          }
        }

        // If all validations pass (or none were required), save to cache if enabled
        if (settings.infrastructure?.enable_dev_cache && requestCrc) {
          cancellation.throwIfCancelled(`LLM cache write for ${safeModule}`);
          if (resolvedModel) {
            await devCache.set(requestCrc, resolvedModel, finalContent);
          } else {
            Logger.warn(safeModule, 'Cache', `Skipping dev cache save: resolvedModel is empty for request CRC ${requestCrc}`);
          }
        }

        Logger.log(safeModule, resolvedModel, `[${providerKey}] call successful on attempt ${attempt}.`, 'end', { responseLength: typeof finalContent === 'string' ? finalContent.length : JSON.stringify(finalContent).length });

        // Extract detailed usage information if available. LangChain and
        // OpenAI-compatible providers expose this under slightly different
        // shapes, so normalize it before writing turn logs.
        let usageData = normalizeUsageData(providerKey, response);
        if (usageData) {
          if (usageData.cached_input_tokens !== undefined) {
            const promptTokens = Number(usageData.prompt_tokens || 0);
            const cachedTokens = Number(usageData.cached_input_tokens || 0);
            const cachePercent = promptTokens > 0 ? ((cachedTokens / promptTokens) * 100).toFixed(1) : '0.0';
            Logger.log(safeModule, resolvedModel, `Prompt cache read: ${cachedTokens} / ${promptTokens} input tokens (${cachePercent}%).`);
          } else if (providerKey === 'openrouter' && usageData.cache_discount !== undefined) {
            Logger.log(safeModule, resolvedModel, `OpenRouter cache discount: ${usageData.cache_discount}`);
          }
        }

        if ((usageData || reasoning) && finalContent) {
          TurnLogger.linkUsage(providerKey, resolvedModel, finalContent, usageData, reasoning);
        }

        settleLiveCall({ status: 'done', model: resolvedModel, provider: providerKey, attempt });
        // Central logging for the prepared path only. Legacy callers keep
        // their manual logRequest/logResponse; the same callId joins request
        // and response entries into one logical call.
        if (promptTrace && turnLogTitle) {
          TurnLogger.logResponse(turnLogTitle, {
            content: finalContent,
            model: resolvedModel,
            provider: providerKey,
            usage: usageData,
            reasoning,
            extraPayload: { callId: liveCallId }
          });
        }
        return { content: finalContent, model: resolvedModel, provider: providerKey, usage: usageData, reasoning };

      } catch (error) {
        if (error instanceof PipelineAbortError) {
          settleLiveCall({ status: 'error', model: resolvedModel, provider: providerKey, error: 'cancelled' });
          if (promptTrace && turnLogTitle) {
            TurnLogger.logError(turnLogTitle, error, resolvedModel, providerKey, false, { callId: liveCallId });
            error.turnLoggerLogged = true;
          }
          throw error;
        }
        if (cancellation.isCancelled()) {
          settleLiveCall({ status: 'error', model: resolvedModel, provider: providerKey, error: 'cancelled' });
          if (promptTrace && turnLogTitle && !error.turnLoggerLogged) {
            TurnLogger.logError(turnLogTitle, error, resolvedModel, providerKey, false, { callId: liveCallId });
            error.turnLoggerLogged = true;
          }
          cancellation.throwIfCancelled(`LLM request for ${safeModule}`);
          throw error;
        }

        Logger.error(safeModule, resolvedModel, `Attempt ${attempt}/${totalAttempts} failed: ${error.message}`, 'end');

        if (attempt === totalAttempts) {
          Logger.error(safeModule, resolvedModel, `All ${totalAttempts} attempts failed. Propagating error.`);
          settleLiveCall({ status: 'error', model: resolvedModel, provider: providerKey, error: error.message, attempt });
          if (turnLogTitle && !error.turnLoggerLogged) {
            error.kind = error.kind || 'retry_exhausted';
            error.attemptNumber = attempt;
            error.retriesLeft = 0;
            if (promptTrace) {
              TurnLogger.logError(turnLogTitle, error, resolvedModel, providerKey, false, { callId: liveCallId });
            } else {
              TurnLogger.logError(turnLogTitle, error, resolvedModel, providerKey);
            }
            error.turnLoggerLogged = true;
          }
          throw error; // Propagate the final error up the call stack
        }

        if (!usingFallback && fallbackRoute && isFallbackEligibleError(error)) {
          usingFallback = true;
          Logger.warn(
            safeModule,
            resolvedModel,
            `Transient provider failure detected. Switching immediately to configured fallback ${fallbackRoute.provider}/${fallbackRoute.model} for attempt ${attempt + 1}/${totalAttempts}.`
          );
          liveTracker.update(liveCallId, {
            status: 'retrying',
            attempt: attempt + 1,
            model: fallbackRoute.model,
            provider: fallbackRoute.provider,
            message: `Fallback -> ${fallbackRoute.model}`
          });
          sendUiNotification({
            id: `retry_${safeModule}`,
            message: `⚡ LLM fallback: ${safeModule} is switching to its backup model...`,
            blocking: true,
            priority: 110,
            icon: '⚡'
          });
          continue;
        }

        // Notify the user about the retry to keep the UI alive and informative
        liveTracker.update(liveCallId, {
          status: 'retrying',
          attempt: attempt + 1,
          model: resolvedModel,
          provider: providerKey,
          message: error.message
        });
        sendUiNotification({
          id: `retry_${safeModule}`,
          message: `🔄 LLM retry: ${safeModule} (Attempt ${attempt}/${totalAttempts})...`,
          blocking: true,
          priority: 110,
          icon: '🔄'
        });

        // Wait before the next retry
        await new Promise(res => setTimeout(res, 1500));
      }
    }
  } finally {
    // Safety net: never leave a bar stuck "running" if the call exits via an
    // unexpected path (e.g. a throw outside the retry loop).
    if (!liveCallSettled) {
      settleLiveCall({ status: 'error', error: 'aborted' });
    }
    // Ensure the retry notification is cleared regardless of outcome
    sendUiNotification({ id: `retry_${safeModule}`, type: 'clear' });
  }
}
// #endregion

// #region LANGCHAIN MODEL CONFIG
/**
 * Creates and configures a LangChain model instance based on settings.
 * This is the bridge between our custom LLM logic and the LangChain ecosystem.
 *
 * @param {object} params - The configuration parameters.
 * @param {string} params.model - A global model alias such as 'veryhighendmodel'.
 * @param {number} [params.retries=3] - Number of retries for the LangChain instance.
 * @param {object} [params.extra={}] - Extra parameters like temperature, topP, etc.
 * @returns {{model: object, resolvedModelName: string}} A configured LangChain model object and the resolved model name string.
 */
function getLangChainModel({ model, provider = null, retries = 3, extra = {} }) {
  const route = resolveModelAlias(model);
  const providerKey = route.provider;
  if (provider && normalizeProviderKey(provider) !== providerKey) {
    throw new Error(`Model alias '${model}' routes through '${providerKey}', not '${provider}'.`);
  }
  const baseModelInstance = getProviderInstance(providerKey);

  if (!baseModelInstance) {
    const available = getConfiguredProviderKeys(readSettings()).join(', ');
    throw new Error(`Model alias '${model}' routes through unavailable provider '${providerKey}'. Available: ${available}`);
  }

  const rawResolvedModelName = route.model;
  const routeExtra = applyRouteReasoningEffort(route, extra);
  const openRouterReasoningModel = providerKey === 'openrouter'
    ? normalizeOpenRouterReasoningModel(rawResolvedModelName, routeExtra)
    : { model: rawResolvedModelName, extra: routeExtra };
  const resolvedModelName = openRouterReasoningModel.model;
  const normalizedExtra = normalizeReasoningParamsForProvider(providerKey, openRouterReasoningModel.extra);

  // Create a new, dynamically configured instance for this specific call
  const dynamicInstance = new baseModelInstance.constructor({
    ...baseModelInstance.lc_kwargs, // Inherit base config (API key, baseURL)
    model: resolvedModelName,       // Support both 'model' (Gemini, Anthropic)
    modelName: resolvedModelName,   // and 'modelName' (OpenAI)
    ...normalizedExtra,              // Apply params like temperature, max_tokens
    ...(baseModelInstance instanceof ChatOpenAI ? { __includeRawResponse: true } : {}),
  });

  // Apply LangChain-specific configurations like retries
  const configuredModel = dynamicInstance.withConfig({
    retries: retries,
  });

  // Return both the model object for chaining and the name for logging
  return { model: configuredModel, resolvedModelName };
}
// #endregion

// #region EXPORTS
module.exports = {
  callLLM,
  callLLMDirect,
  containsRefusalFuzzy,
  getProviderInstance,
  normalizeOpenAICompatibleBaseUrl,
  listConfiguredProviders,
  getLangChainModel,
  repairJson,
  resolveModelAlias,
  normalizeProviderKey,
  normalizeOpenRouterReasoningModel,
  applyRouteReasoningEffort,
  normalizeReasoningParamsForProvider,
  resolveCallProviderKey,
  isFallbackEligibleError,
  invokeModelWithDeadline,
  DEFAULT_LLM_TIMEOUT_MS
};
// #endregion

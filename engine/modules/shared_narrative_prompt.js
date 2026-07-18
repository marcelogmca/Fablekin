const crypto = require('crypto');
const { Logger } = require('./utils.js');
const { resolveModelAlias } = require('./llm.js');

function cloneMessages(messages = []) {
  return messages.map(message => ({
    role: String(message?.role || 'user'),
    content: String(message?.content || '')
  }));
}

function getRuntime(turnContext) {
  if (!turnContext?.runtime) return null;
  turnContext.runtime.promptBuilder = turnContext.runtime.promptBuilder || {};
  return turnContext.runtime.promptBuilder;
}

function initializeSharedNarrativePrefix(turnContext, messages) {
  const runtime = getRuntime(turnContext);
  if (!runtime) throw new Error('Shared narrative prompt runtime is unavailable.');
  if (runtime.sharedNarrativePrefix) return runtime.sharedNarrativePrefix;

  const frozenMessages = cloneMessages(messages).map(message => Object.freeze(message));
  const serialized = JSON.stringify(frozenMessages);
  const prefix = Object.freeze({
    messages: Object.freeze(frozenMessages),
    prefixHash: crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 16),
    characterCount: frozenMessages.reduce((sum, message) => sum + message.content.length, 0),
    estimatedTokens: Math.ceil(frozenMessages.reduce((sum, message) => sum + message.content.length, 0) / 4)
  });

  runtime.sharedNarrativePrefix = prefix;
  runtime.sharedPrefixFrozen = true;
  runtime.sharedPrefixRoutes = runtime.sharedPrefixRoutes || {};
  turnContext.processed.promptBuilder.sharedPrefixHash = prefix.prefixHash;
  turnContext.processed.promptBuilder.sharedPrefixCharacterCount = prefix.characterCount;
  turnContext.processed.promptBuilder.sharedPrefixEstimatedTokens = prefix.estimatedTokens;
  return prefix;
}

function getSharedNarrativePrefix(turnContext) {
  return getRuntime(turnContext)?.sharedNarrativePrefix || null;
}

function getSharedNarrativeMessages(turnContext) {
  const prefix = getSharedNarrativePrefix(turnContext);
  if (!prefix) throw new Error('Shared narrative prompt has not been prepared.');
  return cloneMessages(prefix.messages);
}

function isSharedPrefixFrozen(turnContext) {
  return getRuntime(turnContext)?.sharedPrefixFrozen === true;
}

function describeRoute(model, provider) {
  const resolved = resolveModelAlias(model);
  return {
    model: String(model || ''),
    provider: resolved.provider,
    resolvedModel: resolved.model,
    subprovider: resolved?.subprovider || null
  };
}

function logSharedPrefixUsage(turnContext, actor, model, provider) {
  const runtime = getRuntime(turnContext);
  const prefix = runtime?.sharedNarrativePrefix;
  if (!runtime || !prefix) return null;

  const route = describeRoute(model, provider);
  const actorKey = String(actor || 'unknown').toLowerCase();
  runtime.sharedPrefixRoutes[actorKey] = route;
  Logger.log(
    actor || 'NarrativePrompt',
    'PromptCache',
    `Using shared prefix ${prefix.prefixHash} (${prefix.characterCount} chars, ~${prefix.estimatedTokens} tokens) on ${route.provider}/${route.resolvedModel}${route.subprovider ? ` via ${route.subprovider}` : ''}.`
  );

  const routes = Object.entries(runtime.sharedPrefixRoutes);
  if (routes.length > 1) {
    const signatures = new Set(routes.map(([, item]) =>
      `${item.provider}\u0000${item.resolvedModel}\u0000${item.subprovider || ''}`
    ));
    if (signatures.size > 1 && runtime.sharedPrefixRouteMismatchWarned !== true) {
      runtime.sharedPrefixRouteMismatchWarned = true;
      Logger.warn(
        'NarrativePrompt',
        `Director/Writer shared prefix ${prefix.prefixHash} cannot share provider cache because their resolved routes differ.`
      );
    }
  }
  return route;
}

module.exports = {
  cloneMessages,
  getSharedNarrativeMessages,
  getSharedNarrativePrefix,
  initializeSharedNarrativePrefix,
  isSharedPrefixFrozen,
  logSharedPrefixUsage
};

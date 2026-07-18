const MODEL_ALIAS_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

const BUILT_IN_MODEL_ALIASES = Object.freeze([
  'lowendmodel',
  'mediumendmodel',
  'highendmodel',
  'veryhighendmodel'
]);

const BUILT_IN_MODEL_ALIAS_META = Object.freeze({
  lowendmodel: Object.freeze({
    label: 'Low',
    description: 'Fast and inexpensive. Best for simple classification, audits, and utility work.'
  }),
  mediumendmodel: Object.freeze({
    label: 'Medium',
    description: 'Balanced cost and quality for secondary analysis, extraction, and cleanup.'
  }),
  highendmodel: Object.freeze({
    label: 'High',
    description: 'Strong general-purpose intelligence for orchestration and quality-sensitive work.'
  }),
  veryhighendmodel: Object.freeze({
    label: 'Very High',
    description: 'The strongest configured route for the Writer and high-stakes planning.'
  })
});

function normalizeProviderKey(providerKey) {
  const key = String(providerKey || '').trim().toLowerCase();
  if (key === 'nano gpt' || key === 'nano-gpt' || key === 'nanogpt' || key === 'nano_gpt') {
    return 'nano_gpt';
  }
  return key;
}

function normalizeModelRoute(route) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) return {};
  const normalized = {
    provider: normalizeProviderKey(route.provider),
    model: String(route.model || '').trim()
  };
  const subprovider = String(route.subprovider || '').trim();
  if (subprovider) normalized.subprovider = subprovider;
  return normalized;
}

function normalizeAliasRegistry(rawAliases) {
  if (!rawAliases || typeof rawAliases !== 'object' || Array.isArray(rawAliases)) return {};
  const aliases = {};
  for (const [rawAlias, rawRoute] of Object.entries(rawAliases)) {
    const alias = String(rawAlias || '').trim();
    if (!MODEL_ALIAS_ID_PATTERN.test(alias)) continue;
    aliases[alias] = normalizeModelRoute(rawRoute);
  }
  return aliases;
}

function getAliasRegistry(settings) {
  return normalizeAliasRegistry(settings?.infrastructure?.llm_routing?.aliases);
}

function getModelAliasMeta(alias) {
  return BUILT_IN_MODEL_ALIAS_META[alias] || {
    label: alias,
    description: 'Custom model alias managed in workspace/settings.json.'
  };
}

function listModelAliases(settings, { includeInvalid = true } = {}) {
  const aliases = getAliasRegistry(settings);
  const orderedKeys = [
    ...BUILT_IN_MODEL_ALIASES.filter(alias => Object.prototype.hasOwnProperty.call(aliases, alias)),
    ...Object.keys(aliases)
      .filter(alias => !BUILT_IN_MODEL_ALIASES.includes(alias))
      .sort((a, b) => a.localeCompare(b))
  ];

  return orderedKeys
    .map(alias => {
      const route = aliases[alias];
      const valid = !!route.provider && !!route.model;
      return {
        alias,
        ...getModelAliasMeta(alias),
        ...route,
        builtIn: BUILT_IN_MODEL_ALIASES.includes(alias),
        valid,
        error: valid ? null : `Alias '${alias}' requires both a provider and a model.`
      };
    })
    .filter(item => includeInvalid || item.valid);
}

function resolveModelAlias(settings, rawAlias) {
  const alias = String(rawAlias || '').trim();
  if (!alias) {
    throw new Error('No model alias was provided. Choose a model tier in Settings > Engine Management.');
  }
  if (!MODEL_ALIAS_ID_PATTERN.test(alias)) {
    throw new Error(`Invalid model alias '${alias}'. Alias IDs must match ${MODEL_ALIAS_ID_PATTERN}.`);
  }

  const aliases = getAliasRegistry(settings);
  const route = aliases[alias];
  if (!route) {
    throw new Error(`Unknown model alias '${alias}'. Define it in Settings > Models & Routing or workspace/settings.json.`);
  }
  if (!route.provider || !route.model) {
    throw new Error(`Model alias '${alias}' is incomplete. Set both its provider and model in Settings > Models & Routing.`);
  }

  const providers = settings?.infrastructure?.providers || {};
  if (!Object.prototype.hasOwnProperty.call(providers, route.provider)) {
    throw new Error(`Model alias '${alias}' references unknown provider '${route.provider}'. Configure it in Settings > Models & Routing.`);
  }

  return {
    alias,
    provider: route.provider,
    model: route.model,
    ...(route.subprovider ? { subprovider: route.subprovider } : {})
  };
}

function applyStarterProfile(settings, provider, profile) {
  const providerKey = normalizeProviderKey(provider);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error(`No starter profile is available for provider '${providerKey}'.`);
  }

  const nextRoutes = {};
  for (const alias of BUILT_IN_MODEL_ALIASES) {
    const preset = normalizeModelRoute({ provider: providerKey, ...(profile[alias] || {}) });
    if (!preset.model) {
      throw new Error(`Starter profile '${providerKey}' is missing model alias '${alias}'.`);
    }
    nextRoutes[alias] = preset;
  }

  settings.infrastructure = settings.infrastructure || {};
  settings.infrastructure.llm_routing = settings.infrastructure.llm_routing || {};
  const currentAliases = normalizeAliasRegistry(settings.infrastructure.llm_routing.aliases);
  settings.infrastructure.llm_routing.aliases = {
    ...currentAliases,
    ...nextRoutes
  };
  return nextRoutes;
}

module.exports = {
  BUILT_IN_MODEL_ALIASES,
  BUILT_IN_MODEL_ALIAS_META,
  MODEL_ALIAS_ID_PATTERN,
  applyStarterProfile,
  getAliasRegistry,
  getModelAliasMeta,
  listModelAliases,
  normalizeAliasRegistry,
  normalizeModelRoute,
  normalizeProviderKey,
  resolveModelAlias
};

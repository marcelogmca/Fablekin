const fs = require('fs');
const path = require('path');

function workspacePricingPath() {
  return path.join(process.cwd(), 'workspace', 'model_pricing.json');
}

function seedPricingPath() {
  return path.join(__dirname, 'model_pricing.defaults.json');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clonePricing(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripMetadata(table) {
  const out = {};
  for (const [provider, models] of Object.entries(table || {})) {
    if (provider.startsWith('_') || !isPlainObject(models)) continue;
    out[provider] = {};
    for (const [model, entry] of Object.entries(models)) {
      if (isPlainObject(entry)) out[provider][model] = { ...entry };
    }
  }
  return out;
}

// Shipped seed table (tracked in git). Used when the user's workspace copy
// is missing or unparsable, so engine consumers never crash on a deleted or
// broken file. The workspace copy is the editable one; this seed only gains
// new models on engine updates.
function readSeedPricing() {
  try {
    const raw = fs.readFileSync(seedPricingPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) return stripMetadata(parsed);
  } catch {
    // Corrupt seed is a bug, not a user error - fall through to null.
  }
  return null;
}


let cachedWorkspacePricing = null;
let cachedWorkspaceMtimeMs = 0;

function readWorkspacePricing() {
  let stat = null;
  try {
    stat = fs.statSync(workspacePricingPath());
  } catch {
    return null;
  }
  if (cachedWorkspacePricing && stat.mtimeMs === cachedWorkspaceMtimeMs) {
    return cachedWorkspacePricing;
  }
  try {
    const raw = fs.readFileSync(workspacePricingPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    cachedWorkspacePricing = stripMetadata(parsed);
    cachedWorkspaceMtimeMs = stat.mtimeMs;
    return cachedWorkspacePricing;
  } catch {
    return null;
  }
}

function clearPricingCache() {
  cachedWorkspacePricing = null;
  cachedWorkspaceMtimeMs = 0;
}

// Shipped defaults: the user's workspace copy when present, else the seed
// table. Returned by value (deep clone) so callers can never mutate it.
function getDefaultPricing() {
  return clonePricing(readWorkspacePricing() || readSeedPricing() || {});
}

// User overlay from settings: infrastructure.model_costs. Sparse by design —
// only models the user customized. Entries merge per model over the defaults.
function getPricingOverlay(settings) {
  const overlay = settings?.infrastructure?.model_costs;
  return isPlainObject(overlay) ? overlay : {};
}

// Merged view: defaults overlaid with the user's settings table, per model.
// Neither input is mutated.
function getAllPricing(settings) {
  const merged = getDefaultPricing();
  const overlay = getPricingOverlay(settings);
  for (const [provider, models] of Object.entries(overlay)) {
    if (!isPlainObject(models)) continue;
    merged[provider] = merged[provider] || {};
    for (const [model, entry] of Object.entries(models)) {
      if (!isPlainObject(entry)) continue;
      merged[provider][model] = { ...(merged[provider][model] || {}), ...entry };
    }
  }
  return merged;
}

// Single-model lookup on the merged view. Returns null when unpriced.
function getModelPricing(settings, provider, model) {
  if (!provider || !model) return null;
  const overlayEntry = getPricingOverlay(settings)?.[provider]?.[model];
  const defaults = getDefaultPricing();
  const defaultEntry = defaults?.[provider]?.[model];
  if (isPlainObject(overlayEntry) || isPlainObject(defaultEntry)) {
    return { ...(isPlainObject(defaultEntry) ? defaultEntry : {}), ...(isPlainObject(overlayEntry) ? overlayEntry : {}) };
  }
  return null;
}

module.exports = {
  getDefaultPricing,
  getPricingOverlay,
  getAllPricing,
  getModelPricing,
  workspacePricingPath,
  clearPricingCache
};

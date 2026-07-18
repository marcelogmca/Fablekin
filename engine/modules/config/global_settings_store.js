const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const JSON5 = require('json5');
const { normalizeAliasRegistry } = require('../model_routing.js');

const SETTINGS_PATH = path.join(process.cwd(), 'workspace', 'settings.json');
const SETTINGS_DIR = path.dirname(SETTINGS_PATH);
const SETTINGS_FILENAME = path.basename(SETTINGS_PATH);
const SETTINGS_TEMP_PREFIX = `${SETTINGS_FILENAME}.`;
const SETTINGS_TEMP_SUFFIX = '.tmp';
const TEMP_CLEANUP_MIN_AGE_MS = 2 * 60 * 1000;

let cachedSettings = null;
let saveQueue = Promise.resolve();

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureObject(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
}

function assertCanonicalSettingsShape(settings) {
  const deprecatedRootKeys = ['theme', 'socket_host', 'socket_port', 'socket_url'];
  const present = deprecatedRootKeys.filter((key) => Object.prototype.hasOwnProperty.call(settings, key));
  if (present.length > 0) {
    throw new Error(
      `Unsupported settings format (${present.join(', ')}). `
      + 'This pre-release build does not migrate settings.json; recreate it with the nested infrastructure schema.'
    );
  }
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
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeSettings(input) {
  const settings = deepClone(ensureObject(input));
  assertCanonicalSettingsShape(settings);
  settings.infrastructure = ensureObject(settings.infrastructure);
  settings.infrastructure.logging = ensureObject(settings.infrastructure.logging);
  settings.infrastructure.providers = ensureObject(settings.infrastructure.providers);
  settings.infrastructure.llm_routing = ensureObject(settings.infrastructure.llm_routing);
  settings.infrastructure.llm_routing.aliases = normalizeAliasRegistry(
    settings.infrastructure.llm_routing.aliases);
  settings.infrastructure.narrative_history = ensureObject(settings.infrastructure.narrative_history);
  if (settings.infrastructure.logging.retention_enabled === undefined) {
    settings.infrastructure.logging.retention_enabled = true;
  }
  if (settings.infrastructure.logging.retention_days === undefined) {
    settings.infrastructure.logging.retention_days = 30;
  }
  if (settings.infrastructure.narrative_history.random_slot_rag_chunks === undefined) {
    settings.infrastructure.narrative_history.random_slot_rag_chunks = 0;
  }
  settings.narrative_agents = ensureObject(settings.narrative_agents);
  settings.narrative_agents.writer = ensureObject(settings.narrative_agents.writer);
  if (settings.narrative_agents.writer.enable_chain_of_thought === undefined) {
    settings.narrative_agents.writer.enable_chain_of_thought = true;
  }
  settings.narrative_agents.summarizer = ensureObject(settings.narrative_agents.summarizer);
  const memoryLod = ensureObject(settings.infrastructure.narrative_history.memory_lod);
  if (settings.narrative_agents.summarizer.arc_compression_model === undefined && memoryLod.arc_compression_model !== undefined) {
    settings.narrative_agents.summarizer.arc_compression_model = memoryLod.arc_compression_model;
  }
  delete memoryLod.arc_compression_model;

  for (const [providerKey, providerConfig] of Object.entries(settings.infrastructure.providers)) {
    settings.infrastructure.providers[providerKey] = normalizeProviderConfig(providerConfig);
  }

  return settings;
}

function scrubProviderSecretsForDisk(settings) {
  const persisted = deepClone(settings);
  const providers = persisted?.infrastructure?.providers;
  if (!providers || typeof providers !== 'object') return persisted;

  for (const providerConfig of Object.values(providers)) {
    if (providerConfig && typeof providerConfig === 'object' && !Array.isArray(providerConfig)) {
      delete providerConfig.apiKey;
      delete providerConfig.api_key;
      delete providerConfig.apikey;
    }
  }

  return persisted;
}

function readFromDiskSync() {
  const raw = fsSync.readFileSync(SETTINGS_PATH, 'utf8');
  return JSON5.parse(raw);
}

function isSettingsTempFileName(fileName) {
  return fileName.startsWith(SETTINGS_TEMP_PREFIX) && fileName.endsWith(SETTINGS_TEMP_SUFFIX);
}

async function cleanupOrphanSettingsTemps() {
  let dirEntries = [];
  try {
    dirEntries = await fs.readdir(SETTINGS_DIR, { withFileTypes: true });
  } catch {
    return;
  }

  const now = Date.now();
  const staleFiles = dirEntries.filter((entry) => entry.isFile() && isSettingsTempFileName(entry.name));

  for (const staleFile of staleFiles) {
    const fullPath = path.join(SETTINGS_DIR, staleFile.name);
    try {
      const stat = await fs.stat(fullPath);
      if ((now - stat.mtimeMs) < TEMP_CLEANUP_MIN_AGE_MS) continue;
      await fs.unlink(fullPath);
    } catch {
      // Best-effort cleanup only. If another process owns it, leave it alone.
    }
  }
}

async function renameWithRetry(fromPath, toPath) {
  const transientCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);
  const maxAttempts = 5;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.rename(fromPath, toPath);
      return;
    } catch (error) {
      lastError = error;
      if (!transientCodes.has(error?.code) || attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 50));
    }
  }

  throw lastError;
}

function initGlobalSettings() {
  if (cachedSettings) return cachedSettings;
  // Housekeeping for leftover temp files from interrupted/crashed prior runs.
  void cleanupOrphanSettingsTemps();
  const raw = readFromDiskSync();
  cachedSettings = normalizeSettings(raw);
  return cachedSettings;
}

function getGlobalSettingsRef() {
  return cachedSettings || initGlobalSettings();
}

async function saveGlobalSettings(settingsObj = null) {
  const op = async () => {
    const source = settingsObj || getGlobalSettingsRef();
    const normalized = normalizeSettings(source);
    const persisted = scrubProviderSecretsForDisk(normalized);
    const uniqueToken = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const tempPath = `${SETTINGS_PATH}.${uniqueToken}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(persisted, null, 2), 'utf8');
      await renameWithRetry(tempPath, SETTINGS_PATH);
      cachedSettings = normalized;
      return true;
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // If unlink fails, cleanupOrphanSettingsTemps() will catch it in a later pass.
      }
      throw error;
    }
  };

  saveQueue = saveQueue.then(op, op);
  return saveQueue;
}

function setPathValue(target, pathStr, value) {
  const keys = String(pathStr || '').split('.').filter(Boolean);
  if (keys.length === 0) return target;

  let current = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
  return target;
}

async function setGlobalSettingsPath(pathStr, value) {
  const current = getGlobalSettingsRef();
  setPathValue(current, pathStr, value);
  return saveGlobalSettings(current);
}

module.exports = {
  initGlobalSettings,
  getGlobalSettingsRef,
  saveGlobalSettings,
  setGlobalSettingsPath,
  normalizeSettings
};

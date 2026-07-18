const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const chalk = require('chalk');
const globalSettingsStore = require('./config/global_settings_store.js');
const { getDiagnosticContext } = require('./diagnostic_context.js');
const { getAliasRegistry, resolveModelAlias } = require('./model_routing.js');
// Load settings once at startup
let settings = loadSettings();

const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// API Key Mapping for SecureStorage
const keyMapping = {
  'OPENROUTER_API_KEY': ['infrastructure', 'providers', 'openrouter', 'apiKey'],
  'OPENAI_API_KEY': ['infrastructure', 'providers', 'openai', 'apiKey'],
  'ANTHROPIC_API_KEY': ['infrastructure', 'providers', 'anthropic', 'apiKey'],
  'DEEPSEEK_API_KEY': ['infrastructure', 'providers', 'deepseek', 'apiKey'],
  'GEMINI_API_KEY': ['infrastructure', 'providers', 'gemini', 'apiKey'],
  'NANO_GPT_API_KEY': ['infrastructure', 'providers', 'nano_gpt', 'apiKey'],
  'OLLAMA_API_KEY': ['infrastructure', 'providers', 'ollama', 'apiKey'],
  'OLLAMA_BASE_URL': ['infrastructure', 'providers', 'ollama', 'base_url']
};

// #region CONFIGURATION
/**
 * Loads settings from settings.json.
 * @returns {object|null} The loaded settings object, or null if an error occurred.
 */
function loadSettings() {
  try {
    return globalSettingsStore.initGlobalSettings();
  } catch (error) {
    console.error('FATAL: Could not load settings.json. Please ensure it exists and is valid.', error);
    // Return a minimal config to avoid crashing everything, though functionality will be broken
    return null;
  }
}


/**
 * Persists the current in-memory settings to settings.json.
 * @returns {Promise<boolean>}
 */
async function saveSettings() {
  try {
    await globalSettingsStore.saveGlobalSettings(settings);
    settings = globalSettingsStore.getGlobalSettingsRef();
    return true;
  } catch (error) {
    Logger.error('Settings', 'Failed to save settings.json:', error);
    return false;
  }
}

/**
 * Updates a specific path in the settings and saves to disk.
 * @param {string} pathStr - Dot-notated path (e.g., 'plugins.my_plugin.enabled')
 * @param {any} value - The value to set.
 */
async function updateSettings(pathStr, value) {
  const ok = await globalSettingsStore.setGlobalSettingsPath(pathStr, value);
  settings = globalSettingsStore.getGlobalSettingsRef();
  return ok;
}

/**
 * Patches the in-memory settings with values from SecureStorage.
 * Secrets from SecureStorage take priority over .env and settings.json.
 * @param {object} secrets - Map of key names to values.
 */
function patchSettingsWithSecrets(secrets) {
  if (!secrets || typeof secrets !== 'object') return;

  for (const [key, value] of Object.entries(secrets)) {
    const pathParts = keyMapping[key];
    if (pathParts && value) {
      let current = settings;
      for (let i = 0; i < pathParts.length - 1; i++) {
        const nextNode = current[pathParts[i]];
        if (!nextNode || typeof nextNode !== 'object') {
          if (typeof nextNode === 'string') {
            const trimmed = nextNode.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              try {
                current[pathParts[i]] = JSON.parse(trimmed);
              } catch {
                current[pathParts[i]] = {};
              }
            } else {
              current[pathParts[i]] = {};
            }
          } else {
            current[pathParts[i]] = {};
          }
        }
        current = current[pathParts[i]];
      }
      current[pathParts[pathParts.length - 1]] = value;
      Logger.log('Settings', `Patched ${key} into settings from SecureStorage.`);
    }
  }
}
// #endregion

// #region LOGGER
let _systemLogSequence = 0;
const _systemLogBuffer = [];

function _appendSystemLogEntry(entry) {
  _systemLogBuffer.push(entry);
}

/**
 * A simple logger utility.
 * @param {string} level - 'log' or 'error' or 'warn'.
 * @param {string} section - The module or section logging the message.
 * @param {...any} args - Flexible arguments: (message), (message, startEnd), (subSection, message, startEnd), etc.
 */
function log(level, section, ...args) {
  if (!settings.infrastructure?.debug && level !== 'error') return;

  let message = '';
  let subSection = null;
  let startEnd = null;
  let extraArgs = [];

  // Flexible Argument Parsing
  if (args.length === 1) {
    // log(level, section, message)
    message = args[0];
  } else if (args.length === 2) {
    // If the SECOND argument is 'start' or 'end', it's (message, startEnd)
    if (args[1] === 'start' || args[1] === 'end') {
      message = args[0];
      startEnd = args[1];
    }
    // Otherwise, if both are strings, it's (subSection, message)
    else if (typeof args[0] === 'string' && typeof args[1] === 'string') {
      subSection = args[0];
      message = args[1];
    }
    // Fallback: (message, extraData)
    else {
      message = args[0];
      extraArgs = [args[1]];
    }
  } else if (args.length >= 3) {
    // Case 1: (subSection, message, startEnd, ...extra)
    if (args[2] === 'start' || args[2] === 'end') {
      subSection = args[0];
      message = args[1];
      startEnd = args[2];
      extraArgs = args.slice(3);
    }
    // Case 2: (message, startEnd, ...extra)
    else if (args[1] === 'start' || args[1] === 'end') {
      message = args[0];
      startEnd = args[1];
      extraArgs = args.slice(2);
    }
    // Case 3: (subSection, message, ...extra)
    else {
      subSection = args[0];
      message = args[1];
      extraArgs = args.slice(2);
    }
  }

  const timestamp = new Date().toISOString();
  const payloadMessage = (typeof message === 'object' && message !== null) ? JSON.stringify(message) : String(message);
  const payloadExtraArgs = extraArgs.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)));

  // Prepare components for both console (color) and file (raw)
  const rawSection = `[${section}]`;
  const rawSubSection = `[${subSection || ''}]`;
  const rawStartMarker = startEnd === 'start' ? '>>> ' : '';
  const rawEndMarker = startEnd === 'end' ? ' <<<' : '';

  let colorizedPrefix = chalk.gray(`[${timestamp}]`) + ' ' + getModuleColor(section);
  if (subSection) {
    colorizedPrefix += ' ' + getModuleColor(subSection);
  }

  let processedMessage = payloadMessage;
  if (startEnd === 'start') {
    processedMessage = chalk.green.bold('>>> ') + processedMessage;
  } else if (startEnd === 'end') {
    processedMessage = processedMessage + chalk.red.bold(' <<<');
  }

  // Console logging with color
  const consoleMethod = console[level] ? level : 'log';
  const coloredLine = level === 'error' ? chalk.red(`${colorizedPrefix} ${processedMessage}`) : `${colorizedPrefix} ${processedMessage}`;

  if (extraArgs.length > 0) {
    console[consoleMethod](coloredLine, ...extraArgs);
  } else {
    console[consoleMethod](coloredLine);
  }

  const ansiLine = payloadExtraArgs.length > 0
    ? `${coloredLine} ${payloadExtraArgs.join(' ')}`
    : coloredLine;

  const systemLogEntry = {
    logId: ++_systemLogSequence,
    isoTimestamp: timestamp,
    timestamp: new Date(timestamp).toLocaleTimeString(),
    level,
    section,
    subSection,
    sectionAnsiTag: getModuleAnsiTag(section),
    subSectionAnsiTag: subSection ? getModuleAnsiTag(subSection) : '',
    message: payloadMessage,
    startEnd,
    extraArgs: payloadExtraArgs,
    ansiLine
  };

  _appendSystemLogEntry(systemLogEntry);

  // Emit system log to frontend for live consoles
  if (typeof _ioInstance !== 'undefined' && _ioInstance) {
    _ioInstance.emit('system-log', systemLogEntry);
  }

  // File logging (append to console log file) - STRIP COLORS
  const consoleLogPath = TurnLogger.getCurrentConsoleLogPath();
  if (consoleLogPath) {
    const filePrefix = `[${timestamp}] ${rawSection} ${rawSubSection}`;
    const fileMessage = `${filePrefix} ${rawStartMarker}${processedMessage}${rawEndMarker}` + (extraArgs.length > 0 ? ` ${JSON.stringify(extraArgs)}` : '') + '\n';
    fs.appendFile(consoleLogPath, fileMessage, 'utf-8').catch(err => {
      console.error('Failed to write to console log file:', err);
    });
  }
}

const Logger = {
  // Flexible arguments: (section, message), (section, subSection, message), (section, message, startEnd), (section, subSection, message, startEnd)
  log: (section, ...args) => log('log', section, ...args),
  error: (section, ...args) => log('error', section, ...args),
  warn: (section, ...args) => log('warn', section, ...args),
};
exports.Logger = Logger;
// #endregion

// #region TURN-BASED FILE LOGGER
const TurnLogger = (() => {
  // Internal state
  let currentLogFile = null;
  let currentConsoleLogFile = null;
  let logQueue = Promise.resolve();

  // Session-based pseudo-turn (for logs that happen outside a specific turn)
  const sessionTimestamp = Date.now();
  let systemLogFile = null;
  let systemConsoleLogFile = null;

  const logsDir = path.join(__dirname, '..', '..', 'workspace', 'logs');

  function _resolveAliasRouteForLog(model, provider) {
    const alias = String(model || '').trim();
    const currentSettings = settings || {};
    const aliases = getAliasRegistry(currentSettings);
    if (!alias || !Object.prototype.hasOwnProperty.call(aliases, alias)) {
      return { model, provider };
    }

    try {
      const route = resolveModelAlias(currentSettings, alias);
      return {
        model: route.model,
        provider: provider || route.provider
      };
    } catch {
      // Logging must not hide the clearer validation error raised by the LLM call itself.
      return { model, provider };
    }
  }

  /**
   * Ensures the system log directory and files exist.
   * @private
   */
  function _ensureSystemLogs() {
    if (systemLogFile) return;

    const systemLogDir = path.resolve(logsDir, 'system');
    if (!fsSync.existsSync(systemLogDir)) {
      fsSync.mkdirSync(systemLogDir, { recursive: true });
    }

    systemLogFile = path.join(systemLogDir, `system_${sessionTimestamp}.json`);
    systemConsoleLogFile = path.join(systemLogDir, `console_${sessionTimestamp}.log`);

    if (!fsSync.existsSync(systemLogFile)) {
      fsSync.writeFileSync(systemLogFile, '{}', 'utf-8');
    }
    if (!fsSync.existsSync(systemConsoleLogFile)) {
      fsSync.writeFileSync(systemConsoleLogFile, '', 'utf-8');
    }
  }

  /**
   * Performs the actual file read-modify-write operation.
   * @private
   /**
    * Internal registry to automatically link LLM response metadata to log entries.
    * Keyed by a hash of provider, model, and content snippet.
    * @type {Map<string, object>}
    */
   const usageRegistry = new Map();

   /**
    * Cleans up old entries in the usage registry to prevent memory growth.
    */
   function _pruneUsageRegistry() {
     if (usageRegistry.size > 100) {
       const keys = Array.from(usageRegistry.keys());
       for (let i = 0; i < 50; i++) usageRegistry.delete(keys[i]);
     }
   }

   /**
    * Generates a lookup key for the usage registry.
    */
   function _getUsageKey(provider, model, content) {
     const snippet = typeof content === 'string' ? content.substring(0, 500) : JSON.stringify(content).substring(0, 500);
     return `${provider || ''}:${model || ''}:${snippet}`;
   }

   /**
    * @param {string} title - The title for the log entry.
    * @param {any} content - The content to log.
    */
  async function _performLog(title, content, model, provider, other = false, usage = null, reasoning = null) {
    const resolvedRoute = _resolveAliasRouteForLog(model, provider);
    model = resolvedRoute.model;
    provider = resolvedRoute.provider;

    // Auto-link metadata when callers log only the response content.
    if ((usage === null || reasoning === null) && content) {
      const key = _getUsageKey(provider, model, content);
      if (usageRegistry.has(key)) {
        const linkedMetadata = usageRegistry.get(key);
        if (usage === null) usage = linkedMetadata.usage;
        if (reasoning === null) reasoning = linkedMetadata.reasoning;
        usageRegistry.delete(key); // Use once and remove
      }
    }

    // If no active turn log, fallback to system log
    if (!currentLogFile) {
      _ensureSystemLogs();
    }

    const targetFile = currentLogFile || systemLogFile;

    let logData = {};
    try {
      if (fsSync.existsSync(targetFile)) {
        const fileContent = await fs.readFile(targetFile, 'utf-8');
        if (fileContent) {
          logData = JSON.parse(fileContent);
        }
      }
    } catch (err) {
      console.error('TurnLogger', `Error reading or parsing log file ${targetFile}.`, err);
      logData = {};
    }

    if (!logData[title]) {
      logData[title] = [];
    }

    const now = new Date();
    const isoTimestamp = now.toISOString();

    const entry = {
      timestamp: isoTimestamp,
      payload: {
        content: content,
        model: model,
        provider: provider,
        usage: usage
      },
    };
    if (reasoning !== null && reasoning !== undefined && reasoning !== '') {
      entry.payload.reasoning = reasoning;
    }
    const diagnostics = getDiagnosticContext();
    if (diagnostics) {
      entry.payload.diagnostics = diagnostics;
    }

    if (other) entry.other = true;

    logData[title].push(entry);

    try {
      await fs.writeFile(targetFile, JSON.stringify(logData, null, 2), 'utf-8');

      // Notify log-aware frontends that a JSON turn/system log was updated.
      const filename = path.basename(targetFile);
      const projectName = path.basename(path.dirname(targetFile));
      const isJsonTurnOrSystemLog =
        filename.endsWith('.json') && (filename.startsWith('turn_') || filename.startsWith('system_'));

      if (_ioInstance && isJsonTurnOrSystemLog) {
        _ioInstance.emit('turn-log-updated', {
          projectName,
          filename,
          title,
          isLlmPair: / - (Request|Response|Error)$/.test(String(title || '')),
          updatedAt: isoTimestamp
        });
      }
    } catch (err) {
      console.error('TurnLogger', `Failed to write to log file ${targetFile}`, err);
    }
  }


  return {
    /**
     * Starts a new log for a turn.
     * @param {string} projectName - The name of the project for which to start the log.
     */
    async startNewTurnLog(projectName) {
      if (!projectName) {
        Logger.error('TurnLogger', 'startNewTurnLog called without a projectName.');
        projectName = 'default_project';
      }

      const projectLogDir = path.resolve(process.cwd(), 'workspace', 'logs', projectName);
      await ensureDirectoryExists(projectLogDir); // Ensure it exists

      const timestamp = Date.now();
      const turnLogFilename = `turn_${timestamp}.json`;
      const consoleLogFilename = `console_${timestamp}.log`;

      currentLogFile = path.join(projectLogDir, turnLogFilename);
      currentConsoleLogFile = path.join(projectLogDir, consoleLogFilename);

      logQueue = Promise.resolve();
      Logger.log('TurnLogger', `New turn log started for project '${projectName}': ${currentLogFile}`);
      await fs.writeFile(currentLogFile, '{}', 'utf-8');
      await fs.writeFile(currentConsoleLogFile, '', 'utf-8');
    },

    /**
     * Links response metadata to a specific content/model/provider combo for automatic logging.
     * Called by llm.js to facilitate "Smart Logging" without caller changes.
     */
    linkUsage(provider, model, content, usage, reasoning = null) {
      if ((!usage && !reasoning) || !content) return;
      _pruneUsageRegistry();
      const key = _getUsageKey(provider, model, content);
      usageRegistry.set(key, { usage, reasoning });
    },

    /**
     * Queues a request log entry to be written to the current turn's log file.
     * @param {string|object} title - The title for the log entry or a log object.
     * @param {any} [content] - The content to log.
     * @param {string} [model] - The model used for the exchange, if applicable.
     */
    logRequest(title, content, model = null, provider = null, other = false, usage = null) {
      if (typeof title === 'object' && title !== null && !Array.isArray(title)) {
        const obj = title;
        title = (obj.msg || obj.title || "Plugin Log") + " - Request";
        content = obj.content || obj.messages || content;
        model = obj.model || model;
        provider = obj.provider || provider;
        other = obj.other || other;
        usage = obj.usage || usage;
      } else {
        title = title + " - Request";
      }

      logQueue = logQueue.then(() => _performLog(title, content, model, provider, other, usage));
    },

    /**
     * Queues a response log entry to be written to the current turn's log file.
     * @param {string|object} title - The title for the log entry or a log object.
     * @param {any} [content] - The content to log.
     * @param {string} [model] - The model used for the exchange, if applicable.
     */
    logResponse(title, content, model = null, provider = null, other = false, usage = null, reasoning = null) {
      if (typeof title === 'object' && title !== null && !Array.isArray(title)) {
        const obj = title;
        title = (obj.msg || obj.title || "Plugin Log") + " - Response";
        content = obj.content || obj.messages || content;
        model = obj.model || model;
        provider = obj.provider || provider;
        other = obj.other || other;
        usage = obj.usage || usage;
        reasoning = obj.reasoning ?? reasoning;
      } else {
        title = title + " - Response";
      }

      // Smart Detection: If content is a full LLM response object, extract its metadata.
      // we extract the metadata automatically to simplify caller code.
      if (content && typeof content === 'object' && content.content !== undefined && content.usage !== undefined) {
        usage = content.usage || usage;
        model = content.model || model;
        provider = content.provider || provider;
        reasoning = content.reasoning ?? reasoning;
        content = content.content; // Flatten to just the actual text/JSON for the log
      }

      logQueue = logQueue.then(() => _performLog(title, content, model, provider, other, usage, reasoning));
    },

    /**
     * Queues a failed LLM exchange entry. This keeps failed/aborted calls visible
     * in diagnostics and the waterfall instead of leaving orphaned requests.
     */
    logError(title, error, model = null, provider = null, other = false) {
      if (typeof title === 'object' && title !== null && !Array.isArray(title)) {
        const obj = title;
        title = (obj.msg || obj.title || "Plugin Log") + " - Error";
        error = obj.error || obj.content || error;
        model = obj.model || model;
        provider = obj.provider || provider;
        other = obj.other || other;
      } else {
        title = title + " - Error";
      }

      const content = {
        message: error?.message || String(error || 'Unknown error'),
        name: error?.name || null,
        status: error?.status || error?.response?.status || null,
        code: error?.code || error?.error?.code || null,
        type: error?.type || error?.error?.type || null,
        kind: error?.kind || error?.failureKind || error?.reason || error?.error?.kind || null,
        attemptNumber: error?.attemptNumber || null,
        retriesLeft: error?.retriesLeft || null
      };

      logQueue = logQueue.then(() => _performLog(title, content, model, provider, other));
    },

    /**
     * Queues a generic log entry to be written to the current turn's log file.
     * @param {string|object} title - The title for the log entry or a log object.
     * @param {any} [content] - The content to log.
     */
    log(title, content, model = null, provider = null, other = false) {
      if (typeof title === 'object' && title !== null && !Array.isArray(title)) {
        const obj = title;
        title = (obj.msg || obj.title || "Plugin Log");
        content = obj.content || obj.messages || content;
        model = obj.model || model;
        provider = obj.provider || provider;
        other = obj.other || other;
      }

      logQueue = logQueue.then(() => _performLog(title, content, model, provider, other));
    },

    /**
     * Gets the path of the current log file for this turn.
     * @returns {string|null}
     */
    getCurrentLogPath() {
      return currentLogFile || systemLogFile;
    },

    /**
     * Gets the path of the current console log file for this turn.
     * @returns {string|null}
     */
    getCurrentConsoleLogPath() {
      if (!currentConsoleLogFile) {
        _ensureSystemLogs();
      }
      return currentConsoleLogFile || systemConsoleLogFile;
    },

    /**
     * Finds the path of the most recent log file in the logs directory.
     * @returns {Promise<string|null>} The full path to the latest log file, or null if none are found.
     */
    async getLatestLogPath() {
      try {
        await ensureDirectoryExists(logsDir);
        const files = await fs.readdir(logsDir);

        const logFiles = files.filter(file => file.startsWith('turn_') && file.endsWith('.json'));

        if (logFiles.length === 0) {
          Logger.log('TurnLogger', 'No turn log files found in the logs directory.');
          return null;
        }

        // Sort files by timestamp in the filename (descending)
        logFiles.sort((a, b) => {
          const timeA = parseInt(a.split('_')[1].split('.')[0], 10);
          const timeB = parseInt(b.split('_')[1].split('.')[0], 10);
          return timeB - timeA;
        });

        return path.join(logsDir, logFiles[0]);

      } catch (err) {
        Logger.error('TurnLogger', 'Error finding the latest log file.', err);
        return null;
      }
    },

    /**
     * Reads and parses the content of the most recent log file.
     * @returns {Promise<object|null>} The parsed JSON content of the latest log, or null on error.
     */
    async readLatestLog() {
      const latestLogPath = await this.getLatestLogPath();

      if (!latestLogPath) {
        return null;
      }

      try {
        const fileContent = await fs.readFile(latestLogPath, 'utf-8');
        if (!fileContent) return null;
        return JSON.parse(fileContent);
      } catch (err) {
        Logger.error('TurnLogger', `Failed to read or parse latest log file: ${latestLogPath}`, err);
        return null;
      }
    }
  };
})();
exports.TurnLogger = TurnLogger;
// #endregion

// #region FILESYSTEM UTILITIES
/**
 * Reads a file synchronously from your project root.
 * @param {string} relPath – a path relative to your project root, e.g. "prompts/test.txt"
 * @returns {string|null} file contents, or null on error
 */
function readFileSync(relPath) {
  try {
    // process.cwd() is wherever you ran "electron ." (i.e. your project root)
    const absolutePath = path.resolve(process.cwd(), relPath);
    return fsSync.readFileSync(absolutePath, 'utf8'); // <-- use fsSync here
  } catch (err) {
    console.error('Error reading file:', err);
    return null;
  }
}

/**
 * Ensures a directory exists, creating it if necessary.
 * @param {string} dirPath - The path to the directory.
 * @returns {Promise<void>}
 */
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      Logger.error('FileSystem', `Failed to create directory: ${dirPath}`, error);
      throw error;
    }
  }
}

/**
 * Synchronously ensures a directory exists.
 * @param {string} dirPath - The path to the directory.
 */
function ensureDirectoryExistsSync(dirPath) {
  if (!fsSync.existsSync(dirPath)) {
    fsSync.mkdirSync(dirPath, { recursive: true });
    Logger.log('FileSystem', `Created directory: ${dirPath}`);
  }
}


/**
 * Recursively lists files in a directory with specific extensions.
 * @param {string} dir - The directory to start from.
 * @param {string[]} validExtensions - Array of valid extensions (e.g., ['.txt', '.md']).
 * @param {number} [depth=0] - Internal recursion depth.
 * @param {number} [maxDepth=2] - Maximum directory depth to traverse.
 * @returns {Promise<string[]>} A list of full file paths.
 */
async function listFilesRecursive(dir, validExtensions, depth = 0, maxDepth = 2) {
  let results = [];
  if (depth >= maxDepth) return results; // Stop at configured depth to keep scans predictable

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'plugins' || entry.name === 'vectors') continue;
        results = results.concat(await listFilesRecursive(fullPath, validExtensions, depth + 1, maxDepth));
      } else if (validExtensions.includes(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath.replace(/\\/g, '/'));
      }
    }
  } catch (err) {
    Logger.error('FileSystem', `Error reading directory ${dir}`, err.message);
  }
  return results;
}

/**
 * Appends content to a file, adding newlines for separation.
 * @param {string} filePath - The path to the file.
 * @param {string} content - The content to append.
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
async function appendToFile(filePath, content) {
  try {
    const newContent = '\n\n' + content;
    await fs.appendFile(filePath, newContent, 'utf-8');
    Logger.log('FileSystem', `Content appended to: ${filePath}`);
    return true;
  } catch (error) {
    Logger.error('FileSystem', `Error appending to file: ${filePath}`, error);
    return false;
  }
}
// #endregion

// #region STRING & HASHING UTILITIES
/**
 * Replaces all occurrences of a substring in a string.
 * @param {string} str - The original string.
 * @param {string} search - The substring to search for.
 * @param {string} replacement - The replacement string.
 * @returns {string}
 */
function replaceAll(str, search, replacement) {
  if (!search || typeof str !== 'string') return str;
  return str.split(search).join(replacement);
}

/**
 * Generates a hash for the given content.
 * @param {string} content - The content to hash.
 * @param {string} [algorithm='sha256'] - The hashing algorithm (e.g., 'sha1', 'sha256').
 * @returns {string} The hex digest of the hash.
 */
function generateHash(content, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(content).digest('hex');
}

/**
 * Normalizes text for comparison (lowercase, replaces spaces with underscores).
 * @param {string} text - Text to normalize.
 * @returns {string}
 */
function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Converts a project name into a path-safe, lowercase slug.
 * Removes non-alphanumeric characters (except underscores/hyphens) and replaces spaces with underscores.
 * @param {string} text - The project name to slugify.
 * @returns {string}
 */
function slugifyProjectName(text) {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')           // Replace spaces with underscores
    .replace(/[^\w-]/g, '')         // Remove all non-word chars (except hyphens)
    .replace(/--+/g, '-')           // Replace multiple hyphens with single hyphen
    .replace(/__+/g, '_')           // Replace multiple underscores with single underscore
    .replace(/^_+|_+$/g, '');       // Trim leading/trailing underscores
}

/**
 * Extracts the filename from a full path.
 * @param {string} filepath - The full file path.
 * @returns {string}
 */
function getFilename(filepath) {
  if (typeof filepath !== 'string') return '';
  return path.basename(filepath);
}

/**
 * Extracts unique directory paths from a list of file paths.
 * @param {string[]} filePaths - Array of file paths.
 * @returns {string[]} Array of unique directory paths.
 */
function uniqueAssetDirs(filePaths) {
  if (!Array.isArray(filePaths)) return [];
  const dirs = new Set();
  filePaths.forEach(fp => {
    if (typeof fp === 'string') {
      dirs.add(path.dirname(fp));
    }
  });
  return Array.from(dirs);
}

/**
 * Normalizes a path to be relative to the project assets directory.
 * Useful for paths sent to the frontend.
 * @param {string} absolutePath - The absolute path to the asset.
 * @param {string} rootDir - The project root directory.
 * @param {boolean} [keepAssetsPrefix=false] - If true, keeps the "assets/" prefix in the relative path.
 * @returns {string} The relative path (e.g., 'sprites/my_sprite.webp' or 'assets/sprites/my_sprite.webp').
 */
function relativizeAssetPath(absolutePath, rootDir, keepAssetsPrefix = false) {
  if (!absolutePath || typeof absolutePath !== 'string') return absolutePath;
  if (!path.isAbsolute(absolutePath)) return absolutePath; // Already relative or remote URL
  if (!rootDir) return absolutePath;

  const resolvedRoot = path.resolve(rootDir).replace(/\\/g, '/');
  const assetsDir = path.join(resolvedRoot, 'assets').replace(/\\/g, '/');
  const normalizedPath = path.resolve(absolutePath).replace(/\\/g, '/');

  // Case-insensitive check for the prefix (especially drive letters on Windows)
  if (normalizedPath.toLowerCase().startsWith(assetsDir.toLowerCase())) {
    let rel = normalizedPath.substring(assetsDir.length);
    if (rel.startsWith('/')) rel = rel.substring(1);
    return keepAssetsPrefix ? `assets/${rel}` : rel;
  }

  return normalizedPath;
}

/**
 * Strips any valid image extension from a filename.
 * @param {string} filename - The filename to strip.
 * @returns {string} The filename without its extension.
 */
function stripExtension(filename) {
  if (typeof filename !== 'string') return '';
  // We use a broader check for extensions to be safe, but focused on image types
  const ext = path.extname(filename).toLowerCase();
  const validExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
  if (validExtensions.includes(ext)) {
    return filename.slice(0, -ext.length);
  }
  return filename;
}

/**
 * Fixes a common hallucination where the LLM outputs a comma-separated list of strings
 * (e.g., "key": "val1", "val2") instead of an array ("key": ["val1", "val2"]).
 * @param {string} jsonStr 
 * @returns {string}
 */
function repairHallucinatedLists(jsonStr) {
  // Regex Explanation:
  // 1. (["\w]+"\s*:\s*)  -> Capture Group 1: The Key and Colon (e.g., "voice_samples": )
  // 2. (                 -> Capture Group 2: The sequence of strings
  //    (?:"(?:[^"\\]|\\.)*"\s*,\s*)+  -> One or more "String", 
  //    (?:"(?:[^"\\]|\\.)*")          -> Ending with a "String"
  //    )
  // 3. (?!\s*:)          -> Negative Lookahead: Ensure the last string is NOT followed by a colon 
  //                         (which would mean it was actually a key).

  const pattern = /("[a-zA-Z0-9_]+"\s*:\s*)((?:"(?:[^"\\]|\\.)*"\s*,\s*)+(?:"(?:[^"\\]|\\.)*"))(?!\s*:)/g;

  return jsonStr.replace(pattern, '$1[$2]');
}
// #endregion

// #endregion

// #region SORTING
/**
 * Natural sort comparison function for file/folder names.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

let _ioInstance = null; // Private variable to hold the Socket.IO instance

/**
 * Sets the Socket.IO instance for utility functions.
 * @param {object} io - The Socket.IO server instance.
 */
function setIoInstance(io) {
  _ioInstance = io;
}

/**
 * Retrieves buffered system logs captured since boot.
 * @param {object} options
 * @param {number} [options.afterId=0] - Return only logs with id greater than this value.
 * @param {number} [options.limit=0] - Max number of logs returned. Non-positive values return all buffered logs.
 * @returns {{logs: object[], lastLogId: number}}
 */
function getSystemLogBuffer({ afterId = 0, limit = 0 } = {}) {
  const safeAfterId = Number.isFinite(Number(afterId)) ? Number(afterId) : 0;
  const numericLimit = Number(limit);
  const safeLimit = Number.isFinite(numericLimit) && numericLimit > 0 ? Math.floor(numericLimit) : 0;
  const filtered = _systemLogBuffer.filter(entry => entry.logId > safeAfterId);
  const logs = safeLimit > 0 && filtered.length > safeLimit
    ? filtered.slice(filtered.length - safeLimit)
    : filtered.slice();
  return {
    logs,
    lastLogId: _systemLogSequence
  };
}

/**
 * Sends a structured UI notification to the renderer process.
 * Supports multiple concurrent notifications via unique IDs.
 * 
 * @param {object} payload - The notification payload.
 * @param {string} payload.id - Unique ID for this notification (e.g., 'tts_core').
 * @param {string} [payload.type='update'] - 'update' to show/update, 'clear' to remove.
 * @param {string} [payload.message] - The text or HTML content to display.
 * @param {number} [payload.progress] - Optional progress percentage (0-100).
 * @param {string} [payload.color] - Optional CSS color (e.g., '#00f2ff').
 * @param {string} [payload.icon] - Optional emoji or icon character.
 * @param {number} [payload.timeout] - Optional timeout in ms to auto-hide.
 * @param {boolean} [payload.blocking] - If true, triggers the central popout.
 * @param {number} [payload.priority] - Priority for display in popout (higher = more prominent).
 */
function sendUiNotification(payload) {
  if (_ioInstance) {
    if (!payload.id) {
      Logger.warn('StatusUpdate', 'sendUiNotification called without an ID.');
      return;
    }
    _ioInstance.emit('status-update', {
      type: 'update',
      startTime: Date.now(), // Track start time for elapsed timer
      ...payload
    });
  } else {
    Logger.warn('StatusUpdate', 'ioInstance not initialized. Cannot send UI notification.');
  }
}


/**
 * Emits a generic event to all connected clients.
 * @param {string} eventName - The name of the event.
 * @param {any} data - The data to send.
 */
function emitEvent(eventName, data) {
  if (_ioInstance) {
    _ioInstance.emit(eventName, data);
  } else {
    Logger.warn('Socket', `ioInstance not initialized. Cannot emit event: ${eventName}`);
  }
}

// #region EXPORTS
// Logger and TurnLogger are exported above to prevent circular dependency issues during module loading.

module.exports = {
  ...module.exports, // Keep existing exports (Logger, TurnLogger)
  ensureDirectoryExists,
  ensureDirectoryExistsSync,
  listFilesRecursive,
  uniqueAssetDirs,
  appendToFile,
  replaceAll,
  generateHash,
  normalizeText,
  slugifyProjectName,
  getFilename,
  stripExtension,
  relativizeAssetPath,
  naturalSort,
  readFileSync,
  setIoInstance,
  getSystemLogBuffer,
  sendUiNotification,
  emitEvent,
  compressString: async (data) => await gzip(data),
  decompressToString: async (buffer) => (await gunzip(buffer)).toString('utf-8'),
  // Exporting settings in case other modules need to read from it
  readSettings: () => settings,
  updateSettings,
  saveSettings,
  patchSettingsWithSecrets,
  keyMapping,
  repairHallucinatedLists,
  settings: settings,
  getModuleColor, // Export getModuleColor

  // TTS & CRC Utilities
  calculateCrc: (text) => {
    const crc32 = require('crc-32');
    return (crc32.str(text) >>> 0).toString();
  },
  sanitizeForCrc: (str) => {
    if (typeof str !== 'string') return '';
    return str.replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/\*/g, '') // Remove asterisks
      .trim();
  },
  cleanTtsText: (text) => {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/\*+/g, '') // Remove Markdown emphasis markers while preserving spoken words.
      .replace(/\[.*?\]/g, '') // Remove [brackets] (tags)
      .replace(/\(.*?\)/g, '') // Remove (parentheses)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/\s+/g, ' ')   // Normalize spaces
      .trim();
  },
  renderTable: (data, columns = null) => {
    if (!Array.isArray(data) || data.length === 0) return 'No data available.';

    // Default columns to keys of first item if not provided
    const keys = columns || Object.keys(data[0]);

    // Calculate column widths
    const widths = {};
    keys.forEach(k => {
      widths[k] = k.length;
      data.forEach(row => {
        const val = String(row[k] === null || row[k] === undefined ? '' : row[k]);
        widths[k] = Math.max(widths[k], val.length);
      });
      // Cap width to reasonable terminal size
      widths[k] = Math.min(widths[k], 50);
    });

    // Build header
    let header = '| ' + keys.map(k => k.toUpperCase().padEnd(widths[k])).join(' | ') + ' |';
    let separator = '|-' + keys.map(k => '-'.repeat(widths[k])).join('-|-') + '-|';

    // Build rows
    const rows = data.map(row => {
      return '| ' + keys.map(k => {
        let val = String(row[k] === null || row[k] === undefined ? '' : row[k]).replace(/[\r\n]/g, ' ');
        if (val.length > widths[k]) val = val.substring(0, widths[k] - 3) + '...';
        return val.padEnd(widths[k]);
      }).join(' | ') + ' |';
    });

    return `\r\n${header}\r\n${separator}\r\n${rows.join('\r\n')}\r\n`;
  }
};
// #endregion

// --- Color Assignment Logic ---
const colorCache = {};
const ansiTagCache = {};
const colors = [
  chalk.cyan, chalk.magenta, chalk.yellow, chalk.blue,
  chalk.green, chalk.red, chalk.cyanBright, chalk.magentaBright,
  chalk.yellowBright, chalk.blueBright, chalk.greenBright, chalk.redBright
];
const ansiColorCodes = ['36', '35', '33', '34', '32', '31', '96', '95', '93', '94', '92', '91'];

function getModuleColorIndex(moduleName) {
  const normalized = String(moduleName || '').trim();
  if (!normalized) return 0;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % colors.length;
}

/**
 * Generates a consistent color for a module name.
 * Uses a simple hash and a predefined color palette. Caches results for performance.
 * @param {string} moduleName - The name of the module (e.g., 'VNManager').
 * @returns {string} The colorized, bracketed module name.
 */
function getModuleColor(moduleName) {
  if (colorCache[moduleName]) {
    return colorCache[moduleName];
  }

  const colorFunc = colors[getModuleColorIndex(moduleName)];
  const coloredModuleName = colorFunc(`[${moduleName}]`);
  colorCache[moduleName] = coloredModuleName;
  return coloredModuleName;
}

function getModuleAnsiTag(moduleName) {
  const normalized = String(moduleName || '').trim();
  if (!normalized) return '';
  if (ansiTagCache[normalized]) return ansiTagCache[normalized];
  const colorCode = ansiColorCodes[getModuleColorIndex(normalized)] || '37';
  const ansiTag = `\x1b[${colorCode}m[${normalized}]\x1b[0m`;
  ansiTagCache[normalized] = ansiTag;
  return ansiTag;
}

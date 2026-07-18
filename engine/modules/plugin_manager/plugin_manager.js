const fs = require('fs/promises');
const path = require('path');
const { Logger, readSettings } = require('../utils.js');
const { buildTools } = require('./runtime/tools_builder.js');
const { executeHook, callPluginFunction, provideFileView } = require('./runtime/hook_executor.js');
const { readPluginMetadataSafely, initializePlugins, findPluginDirName } = require('./runtime/loader.js');
const { discoverPluginScreenshots } = require('./runtime/plugin_preview_discovery.js');
const { evaluateStoryScript } = require('./runtime/story_script_evaluator.js');
const ScriptSecurity = require('./script_security.js');
const SecureStorage = require('../main_process/secure_storage.js');
const { getProjectDirectives, setProjectDirective } = require('../config/project_config_store.js');

const CORE_DIRECTIVES = require('../config/core_directives.js');
const { scanDocs } = require('../utils/doc_scanner.js');

function getDependencyId(dependency) {
    return typeof dependency === 'string' ? dependency : dependency?.id;
}

const QUIET_SOCKET_DISPATCH_EVENTS = new Set([
    'vn-hud-fetch-data',
    'vn-location-fetch-data',
    'quest-tracker-fetch-data'
]);

class PluginManager {
    constructor() {
        this.plugins = new Map();
        this.disabledPlugins = new Map(); // Store metadata for disabled plugins
        this.hooks = new Map();
        this.socketListeners = new Map(); // Store socket listeners from plugins
        this.views = new Map(); // Store view definitions from plugins
        this.exportedFunctions = new Map(); // Store exported functions from plugins
        this.registeredRoutes = new Set(); // Track registered Express routes to prevent duplicates
        this.registeredFileModes = new Map(); // Store custom file modes registered by plugins
        this.terminalCommands = new Map(); // Store terminal commands registered by plugins
        this.registeredDocs = new Map(); // Store documentation registered by plugins
        this.isInitialized = false;
        this.chapterManager = null;
        this.staticDataManager = null;
        this.projectRoot = null; // Single source of truth for the active project
        this.io = null; // Store Socket.IO instance
        this.appExpress = null; // Store Express app instance
        this.currentTurnContext = null; // Snapshot of the latest turn context
        this.securityDecisionResolver = null; // Resolver for a pending security decision
        this.pluginsDir = null; // Store the root plugins directory
        this.repoRoot = null; // High-level repository root (parent of engine/workspace)
        this.isProcessingStoryScripts = false; // Flag to prevent concurrent story script handling
        this.sessionDeclinedHashes = new Set(); // Remember hashes declined via "Safe Mode" this session
        this.storyScriptsSafeMode = false; // Safe Mode blocks every Story Script until restart
    }

    /**
     * Sets the top-level repository root (sandbox limit).
     * @param {string} root - Absolute path to the repository/workspace root.
     */
    setRepoRoot(root) {
        Logger.log('PluginManager', `Repository sandbox root set to: ${root}`);
        this.repoRoot = root;
    }

    /**
     * Sets the active project root directory.
     * @param {string} root - Absolute path to the project root.
     */
    setProjectRoot(root) {
        Logger.log('PluginManager', `Active project root set to: ${root}`);
        this.projectRoot = root;
    }

    /**
     * Gets metadata for all registered and discovered plugins.
     * @returns {Array<Object>}
     */
    getAllPluginsMetadata() {
        const metadata = [];
        const allSettings = readSettings();
        const activeAliases = this.getActiveModelAliases();
        const { resolveModelAlias } = require('../llm.js');
        const { createLlmModelRegistry } = require('./runtime/llm_model_registry.js');
        const modelRegistry = createLlmModelRegistry({
            pluginManager: this,
            readSettings,
            resolveModelAlias
        });

        // Helper to process schema and inject dynamic options
        const processSchema = (schema) => {
            if (!schema) return null;
            const processed = {};
            for (const key in schema) {
                // Filter out project directives from the standard plugin settings view
                if (schema[key].type === 'project-directive' || schema[key].isProjectDirective) {
                    continue;
                }

                processed[key] = { ...schema[key] };
                if (processed[key].type === 'select' && processed[key].options === 'llm-aliases') {
                    processed[key].options = processed[key].allowVnBackgroundModel === true
                        ? [
                            { label: 'Inherit VN Background Model', value: { inherit: 'vn_background' } },
                            ...activeAliases
                        ]
                        : activeAliases;
                    processed[key].isLlmAlias = true; // Mark as a global model-alias assignment
                }
            }
            return Object.keys(processed).length > 0 ? processed : null;
        };

        // Active Plugins
        for (const plugin of this.plugins.values()) {
            const currentSettings = (allSettings.plugins && allSettings.plugins[plugin.id]) || {};

            // Mask secrets
            const maskedSettings = { ...currentSettings };
            if (plugin.settingsSchema) {
                for (const [key, schema] of Object.entries(plugin.settingsSchema)) {
                    if (schema.type === 'secret' && SecureStorage.getSecret(plugin.id, key)) {
                        maskedSettings[key] = '********';
                    }
                }
            }

            metadata.push({
                id: plugin.id,
                name: plugin.name || plugin.id,
                version: plugin.version || '1.0.0',
                description: plugin.description || 'No description provided.',
                author: plugin.author || 'Unknown',
                enabled: true,
                dependencies: plugin.dependencies || [],
                optionalDependencies: plugin.optionalDependencies || [],
                isTestPlugin: !!plugin.isTestPlugin,
                isExamplePlugin: !!plugin.isExamplePlugin,
                experimental: !!plugin.experimental,
                isDeveloperPlugin: !!(plugin.isTestPlugin || plugin.isExamplePlugin || plugin.experimental),
                category: plugin.category || 'Uncategorized',
                wizard: plugin.wizard || null,
                screenshots: plugin.screenshots || [],
                settingsSchema: processSchema(plugin.settingsSchema),
                settings: maskedSettings,
                llmModelAssignments: modelRegistry.getPluginModels(plugin.id)
            });
        }

        // Disabled Plugins
        for (const plugin of this.disabledPlugins.values()) {
            const currentSettings = (allSettings.plugins && allSettings.plugins[plugin.id]) || {};

            // Mask secrets
            const maskedSettings = { ...currentSettings };
            if (plugin.settingsSchema) {
                for (const [key, schema] of Object.entries(plugin.settingsSchema)) {
                    if (schema.type === 'secret' && SecureStorage.getSecret(plugin.id, key)) {
                        maskedSettings[key] = '********';
                    }
                }
            }

            metadata.push({
                id: plugin.id,
                name: plugin.name || plugin.id,
                version: plugin.version || '1.0.0',
                description: plugin.description || 'No description provided.',
                author: plugin.author || 'Unknown',
                enabled: false,
                dependencies: plugin.dependencies || [],
                optionalDependencies: plugin.optionalDependencies || [],
                isTestPlugin: !!plugin.isTestPlugin,
                isExamplePlugin: !!plugin.isExamplePlugin,
                experimental: !!plugin.experimental,
                isDeveloperPlugin: !!(plugin.isTestPlugin || plugin.isExamplePlugin || plugin.experimental),
                category: plugin.category || 'Uncategorized',
                wizard: plugin.wizard || null,
                screenshots: plugin.screenshots || [],
                settingsSchema: processSchema(plugin.settingsSchema),
                settings: maskedSettings,
                llmModelAssignments: modelRegistry.getPluginModels(plugin.id)
            });
        }

        return metadata;
    }

    /**
     * Returns global model aliases for plugin settings dropdowns.
     */
    getActiveModelAliases() {
        const { listModelAliases } = require('../model_routing.js');
        return listModelAliases(readSettings()).map(item => ({
            label: item.label,
            value: { model: item.alias },
            disabled: !item.valid,
            description: item.valid
                ? `${item.provider} - ${item.model}`
                : item.error
        }));
    }
    /**
     * Toggles a plugin's status by moving its directory between 'plugins' and 'plugins/disabled'.
     * @param {string} pluginId 
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async togglePluginStatus(pluginId) {
        Logger.log('PluginManager', `Toggling status for plugin: ${pluginId}`);
        const isActive = this.plugins.has(pluginId);
        const isDisabled = this.disabledPlugins.has(pluginId);

        if (!isActive && !isDisabled) {
            return { success: false, error: 'Plugin not found.' };
        }

        const pluginsDir = this.pluginsDir;
        const disabledDir = path.join(pluginsDir, 'disabled');

        try {
            if (isActive) {
                // Deactivating: plugins/name -> plugins/disabled/name
                const dirName = await findPluginDirName(pluginsDir, pluginId);
                if (!dirName) throw new Error(`Could not find directory for plugin ${pluginId}`);

                const oldPath = path.join(pluginsDir, dirName);
                const newPath = path.join(disabledDir, dirName);

                await fs.rename(oldPath, newPath);
                this._unloadPlugin(pluginId);

                // Add to disabled list
                const metadata = await readPluginMetadataSafely(newPath, pluginsDir);
                this.disabledPlugins.set(pluginId, metadata || { id: pluginId });

                Logger.log('PluginManager', `Plugin ${pluginId} deactivated.`);
            } else {
                // Activating: plugins/disabled/name -> plugins/name
                const dirName = await findPluginDirName(disabledDir, pluginId);
                if (!dirName) throw new Error(`Could not find directory for plugin ${pluginId} in disabled folder`);

                const oldPath = path.join(disabledDir, dirName);
                const newPath = path.join(pluginsDir, dirName);

                // Check dependencies before moving
                const metadata = await readPluginMetadataSafely(oldPath, pluginsDir);
                if (metadata && metadata.dependencies && metadata.dependencies.length > 0) {
                    const missing = metadata.dependencies
                        .map(getDependencyId)
                        .filter(depId => depId && !this.plugins.has(depId));
                    if (missing.length > 0) {
                        return {
                            success: false,
                            error: `Cannot activate '${pluginId}'. Missing hard dependencies: ${missing.join(', ')}. Please activate them first.`
                        };
                    }
                }

                await fs.rename(oldPath, newPath);
                this.disabledPlugins.delete(pluginId);

                // Clear require cache just in case it was loaded before
                const entryPoint = path.join(newPath, 'index.js');
                delete require.cache[require.resolve(entryPoint)];

                await this.loadPlugin(newPath);
                Logger.log('PluginManager', `Plugin ${pluginId} activated.`);
            }

            await this.refreshPluginPreviews();
            return { success: true };
        } catch (error) {
            Logger.error('PluginManager', `Failed to toggle plugin ${pluginId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Gets all registered views from all plugins.
     * @returns {Array<Object>}
     */
    getRegisteredViews() {
        const allViews = [];
        for (const [pluginId, views] of this.views.entries()) {
            views.forEach(view => {
                allViews.push({
                    ...view,
                    pluginId: pluginId,
                    // Ensure entry path is relative to the plugins root for the frontend
                    entry: `/plugins/${pluginId}/${view.entry}`
                });
            });
        }
        return allViews;
    }

    /**
     * Gets all registered terminal commands.
     * @returns {Map<string, Object>}
     */
    getRegisteredTerminalCommands() {
        return this.terminalCommands;
    }

    /**
     * Snapshots the current turn context for use by external hooks (e.g., frontend-triggered).
     * @param {Object} turnContext - The TurnContext instance to snapshot.
     */
    setCurrentTurnContext(turnContext) {
        this.currentTurnContext = turnContext;
    }

    /**
     * Gets the latest snapshotted turn context.
     */
    getCurrentTurnContext() {
        return this.currentTurnContext;
    }

    /**
     * Requests GUI payload for a declarative intercept from a plugin export.
     * Expected export patterns:
     * - exports.guiIntercepts[interceptId](context, tools, descriptor, request)
     * - exports.guiIntercept(context, tools, descriptor, request)
     * - exports.buildGuiIntercept(context, tools, descriptor, request)
     * - plugin.guiIntercepts[interceptId](context, tools, descriptor, request)
     * - plugin.guiIntercept(context, tools, descriptor, request)
     * - plugin.buildGuiIntercept(context, tools, descriptor, request)
     * @param {Object} request
     * @returns {Promise<Object|null>}
     */
    async getGuiInterceptPayload(request = {}) {
        const pluginId = request.pluginId;
        if (!pluginId) throw new Error('pluginId is required.');

        if (!this.plugins.has(pluginId)) {
            Logger.warn('PluginManager', `GUI intercept requested for plugin '${pluginId}', but it is not loaded. This is likely due to a persistent intercept from a previous session.`);
            return null;
        }

        const exportsObj = this.exportedFunctions.get(pluginId) || {};
        const pluginObj = this.plugins.get(pluginId) || {};
        const candidateSources = [exportsObj, pluginObj];
        const context = this.currentTurnContext;
        const tools = this._buildTools(pluginId, context);
        const descriptor = request.descriptor || {};
        const interceptId = request.interceptId || descriptor.interceptId || descriptor.id;
        const handlerRefId = typeof descriptor.handlerRef === 'string'
            ? descriptor.handlerRef.split('.').pop()
            : null;

        try {
            for (const source of candidateSources) {
                if (!source || typeof source !== 'object') continue;

                if (
                    source.guiIntercepts &&
                    typeof source.guiIntercepts === 'object' &&
                    !Array.isArray(source.guiIntercepts)
                ) {
                    const candidate =
                        (handlerRefId && source.guiIntercepts[handlerRefId]) ||
                        (interceptId && source.guiIntercepts[interceptId]) ||
                        source.guiIntercepts.default;
                    if (typeof candidate === 'function') {
                        return await candidate(context, tools, descriptor, request);
                    }
                }

                if (typeof source.guiIntercept === 'function') {
                    return await source.guiIntercept(context, tools, descriptor, request);
                }

                if (typeof source.buildGuiIntercept === 'function') {
                    return await source.buildGuiIntercept(context, tools, descriptor, request);
                }
            }
        } catch (error) {
            Logger.error('PluginManager', `Error while building GUI intercept payload for plugin '${pluginId}':`, error);
            throw error;
        }

        Logger.warn(
            'PluginManager',
            `Plugin '${pluginId}' does not expose a GUI intercept builder for intercept '${interceptId || 'unknown'}'.`
        );
        return null;
    }

    /**
     * Resolves a pending security decision with the provided decision ('trust' or 'safe').
     * @param {string} decision - The user's decision.
     */
    resolveSecurityDecision(decision) {
        if (this.securityDecisionResolver) {
            Logger.log('PluginManager', `Resolving security decision: ${decision}`);
            this.securityDecisionResolver(decision);
            this.securityDecisionResolver = null;
        } else {
            Logger.warn('PluginManager', 'Received security decision but no resolver was pending.');
        }
    }

    /**
     * Registers a custom file mode for the Content Manager.
     * @param {string} modeId 
     * @param {string|Object} labelOrMetadata - Either a label string or an object with {label, description, color, backgroundColor, viewer, isAdvanced}
     * @param {string} pluginId - The ID of the plugin registering the mode.
     */
    registerFileMode(modeId, labelOrMetadata, pluginId = 'core') {
        if (this.registeredFileModes.has(modeId)) {
            Logger.warn('PluginManager', `File mode '${modeId}' is already registered by plugin '${this.registeredFileModes.get(modeId).pluginId}'. Ignoring registration from '${pluginId}'.`);
            return;
        }

        let metadata = labelOrMetadata;
        if (typeof labelOrMetadata === 'string') {
            metadata = { label: labelOrMetadata };
        }

        metadata.pluginId = pluginId;
        // Default to not advanced unless specified
        metadata.isAdvanced = !!metadata.isAdvanced;

        Logger.log('PluginManager', `Registering custom file mode: ${modeId} (${metadata.label}) for plugin ${pluginId}${metadata.isAdvanced ? ' [Advanced]' : ''}`);
        this.registeredFileModes.set(modeId, metadata);

        // Inform the frontend about the update if IO is available
        if (this.io) {
            this.io.emit('plugin-modes-updated', this.getRegisteredFileModes());
        }
    }

    /**
     * Gets all registered custom file modes.
     * @returns {Object}
     */
    getRegisteredFileModes() {
        return Object.fromEntries(this.registeredFileModes);
    }

    /**
     * Gets metadata for all project directives (Core + Plugin-contributed).
     * @returns {Promise<Array<Object>>}
     */
    async getProjectDirectivesMetadata() {
        const results = [];
        const config = this.projectRoot ? await require('../content_manager/content_manager.js').loadFileConfig(this.projectRoot) : {};
        const currentDirectives = getProjectDirectives(config);

        // 1. Add Core Modules
        for (const [id, meta] of Object.entries(CORE_DIRECTIVES)) {
            results.push({
                id: id,
                name: meta.name,
                description: meta.description,
                type: 'core',
                fields: [
                    {
                        key: 'creative_style',
                        label: 'Directives',
                        type: 'textarea',
                        placeholder: meta.placeholder,
                        value: currentDirectives[id]?.creative_style || ''
                    }
                ]
            });
        }

        // 2. Add Plugins with project-directive fields
        for (const plugin of this.plugins.values()) {
            if (!plugin.settingsSchema) continue;

            const directiveFields = [];
            for (const [key, schema] of Object.entries(plugin.settingsSchema)) {
                if (schema.type === 'project-directive' || schema.isProjectDirective) {
                    directiveFields.push({
                        key: key,
                        label: schema.label || key,
                        type: 'textarea',
                        placeholder: schema.placeholder || schema.description || '',
                        value: currentDirectives[plugin.id]?.[key] || ''
                    });
                }
            }

            if (directiveFields.length > 0) {
                results.push({
                    id: plugin.id,
                    name: plugin.name || plugin.id,
                    description: plugin.description || '',
                    type: 'plugin',
                    fields: directiveFields
                });
            }
        }

        return results;
    }

    /**
     * Updates a specific project directive field.
     * @param {string} entityId - Core module ID or Plugin ID.
     * @param {string} fieldKey - The schema key.
     * @param {string} value - The new instruction.
     */
    async updateProjectDirective(entityId, fieldKey, value) {
        if (!this.projectRoot) return { success: false, error: 'No active project.' };

        const contentManager = require('../content_manager/content_manager.js');
        const config = await contentManager.loadFileConfig(this.projectRoot);
        const updatedConfig = setProjectDirective(config, entityId, fieldKey, value);
        await contentManager.saveFileConfig(this.projectRoot, updatedConfig);

        Logger.log('PluginManager', `Project directive updated for ${entityId}.${fieldKey}`);

        // Broadcast to clients
        if (this.io) {
            this.io.emit('project-directives-updated', await this.getProjectDirectivesMetadata());
        }

        return { success: true };
    }

    /**
     * Retrieves all project directives for the current project context.
     * @param {string} projectRoot - The root of the project to load from.
     * @returns {Promise<Object>} Map of pluginId/moduleId -> { fieldKey: value }
     */
    async getProjectDirectivesValues(projectRoot) {
        if (!projectRoot) return {};
        const contentManager = require('../content_manager/content_manager.js');
        const config = await contentManager.loadFileConfig(projectRoot);
        return getProjectDirectives(config);
    }

    /**
     * Gets all registered documentation from all plugins.
     * @returns {Array<Object>}
     */
    getRegisteredDocs() {
        const allDocs = [];
        for (const [pluginId, docs] of this.registeredDocs.entries()) {
            docs.forEach(doc => {
                allDocs.push({
                    ...doc,
                    pluginId: pluginId,
                    // Ensure path is relative to the Docs portal (views/docs/docs.html)
                    path: pluginId === 'core' ? doc.path : `../../plugins/${pluginId}/${doc.path}`
                });
            });
        }
        return allDocs;
    }

    async initialize(chapterManager, staticDataManager, pluginsDir, io = null, appExpress = null) {
        if (this.isInitialized) {
            Logger.log('PluginManager', 'Already initialized.');
            return;
        }
        this.chapterManager = chapterManager;
        this.staticDataManager = staticDataManager;
        this.io = io;
        this.appExpress = appExpress;
        this.pluginsDir = pluginsDir;

        await initializePlugins(this, pluginsDir);
        
        // Scan and register core documentation
        await this._registerCoreDocs();

        this.isInitialized = true;

        // Initialize ScriptSecurity
        const { app } = require('electron');
        await ScriptSecurity.initialize(app.getPath('userData'));

        // Register internal hook for Story Scripts
        if (!this.hooks.has('HOOK_PROJECT_LOADED')) this.hooks.set('HOOK_PROJECT_LOADED', []);
        this.hooks.get('HOOK_PROJECT_LOADED').push({
            pluginId: 'core_story_scripts',
            priority: 999, // Run late so core plugins are ready
            mode: 'sequential',
            fn: async (context, tools) => {
                await this._handleStoryScripts(context, tools);
            }
        });

        // Also re-scan and reload story scripts when a chat DB is initialized (switching adventures)
        if (!this.hooks.has('HOOK_CHAT_DB_INITIALIZED')) this.hooks.set('HOOK_CHAT_DB_INITIALIZED', []);
        this.hooks.get('HOOK_CHAT_DB_INITIALIZED').push({
            pluginId: 'core_story_scripts_reload',
            priority: 999,
            mode: 'sequential',
            fn: async (context, tools) => {
                await this._handleStoryScripts(context, tools);
            }
        });
    }

    /**
     * Internal handler to discover, verify, and execute Story Scripts (.md files).
     */
    async _handleStoryScripts(context, _tools) {
        if (this.storyScriptsSafeMode) {
            Logger.log('PluginManager', 'Story Scripts are disabled by Safe Mode for this session.');
            return;
        }

        if (this.isProcessingStoryScripts) {
            Logger.log('PluginManager', 'Already handling story scripts, skipping concurrent call.');
            return;
        }

        this.isProcessingStoryScripts = true;
        try {
            Logger.log('PluginManager', 'Scanning for Story Scripts...');
            const contentManager = require('../content_manager/content_manager.js');
            const path = require('path');

            // Unload any previously loaded story scripts (they have IDs starting with 'story_script_')
            for (const [pluginId] of this.plugins.entries()) {
                if (pluginId.startsWith('story_script_')) {
                    this._unloadPlugin(pluginId);
                }
            }

            if (!this.projectRoot) {
                return;
            }

            const config = await contentManager.loadFileConfig(this.projectRoot);
            const scriptFiles = Object.entries(config.files)
                .filter(([filePath, settings]) => {
                    const mode = typeof settings === 'string' ? settings : (settings.mode || 'none');
                    return mode === 'story-script' && filePath.endsWith('.md');
                })
                .map(([filePath]) => filePath);

            if (scriptFiles.length === 0) {
                Logger.log('PluginManager', 'No Story Scripts found.');
                return;
            }

            const unapprovedScripts = [];
            const approvedScripts = [];

            // Verification Phase. Keep the exact content that was hashed so a file
            // cannot be changed between approval and execution.
            for (const filePath of scriptFiles) {
                const script = await ScriptSecurity.readScript(filePath);
                if (script) {
                    const { content, hash } = script;
                    if (ScriptSecurity.isHashApproved(hash)) {
                        approvedScripts.push({ filePath, hash, content });
                    } else if (this.sessionDeclinedHashes.has(hash)) {
                        Logger.log('PluginManager', `Script ${filePath} was already declined this session. Skipping.`);
                    } else {
                        // Quick preliminary scan for high-risk patterns
                        const redFlags = /\b(fs|child_process|http|https|fetch|axios|eval|require|import|remote|ipcRenderer|process\.env|readFileSync|writeFileSync|rmSync|exec|spawn)\b/;
                        const hasDangerousKeywords = redFlags.test(content);

                        unapprovedScripts.push({
                            filePath,
                            hash,
                            name: path.basename(filePath),
                            content,
                            hasDangerousKeywords
                        });
                    }
                }
            }

            // Trust-On-First-Use Gatekeeper. Review one script at a time so one
            // approval never silently approves every script in the project.
            for (const script of unapprovedScripts) {
                Logger.warn('PluginManager', `Story Script requires review: ${script.filePath}`);
                const decision = await new Promise((resolve) => {
                    if (!this.io) {
                        Logger.error('PluginManager', 'IO not available to prompt user for script security. Blocking scripts.');
                        resolve('safe'); // Fallback
                        return;
                    }

                    // Store the resolver so it can be called via resolveSecurityDecision
                    this.securityDecisionResolver = resolve;

                    this.io.emit('gui-security-warning', {
                        scripts: [script],
                        responseEvent: 'gui-security-decision' // Use a static event name for the response
                    });
                });

                if (decision === 'trust') {
                    Logger.log('PluginManager', `User approved Story Script: ${script.filePath}`);
                    await ScriptSecurity.approveHash(script.hash, { path: script.filePath, project: context.projectName });
                    approvedScripts.push(script);
                } else {
                    Logger.log('PluginManager', 'User selected SAFE MODE. Blocking Story Scripts for this session.');
                    this.storyScriptsSafeMode = true;
                    for (const sc of unapprovedScripts) {
                        this.sessionDeclinedHashes.add(sc.hash);
                    }
                    return;
                }
            }

            // Execution Phase
            Logger.log('PluginManager', `Executing ${approvedScripts.length} approved Story Scripts...`);
            for (const sc of approvedScripts) {
                try {
                    // Sanitize markdown artifacts (e.g. ```javascript blocks) if user wrapped it
                    const rawJsMatch = sc.content.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
                    const jsCode = rawJsMatch ? rawJsMatch[1] : sc.content;

                    const pluginDef = evaluateStoryScript(jsCode, {
                        filename: sc.filePath,
                        logger: Logger
                    });

                    if (pluginDef && pluginDef.hooks) {
                        // Ensure unique ID that marks it as a story script
                        const baseId = pluginDef.id || path.basename(sc.filePath, '.md');
                        pluginDef.id = `story_script_${baseId}`;

                        this.registerPlugin(pluginDef);
                        Logger.log('PluginManager', `Successfully loaded Story Script: ${pluginDef.id} from ${sc.filePath}`);
                    } else {
                        Logger.warn('PluginManager', `Story Script ${sc.filePath} evaluated but returned invalid plugin structure (missing hooks).`);
                    }

                } catch (e) {
                    Logger.error('PluginManager', `Failed to execute Story Script ${sc.filePath}:`, e);
                }
            }

        } catch (e) {
            Logger.error('PluginManager', `Error handling story scripts: ${e.message}`);
        } finally {
            this.isProcessingStoryScripts = false;
        }
    }

    /**
     * Updates plugin settings by validating against schema (if present) and persisting to settings.json.
     * @param {string} pluginId 
     * @param {Object} newSettings 
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async updatePluginSettings(pluginId, newSettings) {
        Logger.log('PluginManager', `Updating settings for plugin: ${pluginId}`);
        const { updateSettings, readSettings } = require('../utils.js');

        try {
            const plugin = this.plugins.get(pluginId) || this.disabledPlugins.get(pluginId);
            const sanitizedSettings = { ...newSettings };

            if (plugin && plugin.settingsSchema) {
                for (const [key, schema] of Object.entries(plugin.settingsSchema)) {
                    if (schema.type === 'secret' && sanitizedSettings[key] !== undefined) {
                        const secretValue = sanitizedSettings[key];

                        // If the value is '********', it means the user didn't change it (masked value from UI)
                        if (secretValue === '********') {
                            delete sanitizedSettings[key];
                            continue;
                        }

                        // Save to secure storage
                        await SecureStorage.setSecret(pluginId, key, secretValue);

                        // Remove from the settings object that goes to settings.json
                        delete sanitizedSettings[key];
                    }
                }
            }

            await updateSettings(`plugins.${pluginId}`, sanitizedSettings);

            // Broadcast the update to all clients (including VN viewer)
            if (this.io) {
                const allSettings = readSettings();
                this.io.emit('vn-settings-updated', {
                    plugins: allSettings.plugins || {},
                    // Include any other relevant global settings if needed
                });

                // Emit a targeted event specifically for this plugin
                this.io.emit(`plugin:settings-updated:${pluginId}`, newSettings);
            }

            return { success: true };
        } catch (error) {
            Logger.error('PluginManager', `Failed to update settings for ${pluginId}:`, error);
            return { success: false, error: error.message };
        }
    }

    async loadPlugin(pluginPath) {
        try {
            const entryPoint = path.join(pluginPath, 'index.js');

            try { await fs.access(entryPoint); } catch {
                Logger.warn('PluginManager', `No index.js found in ${pluginPath}, skipping.`);
                return false;
            }

            const plugin = require(entryPoint);
            plugin._pluginPath = pluginPath;
            plugin.screenshots = await discoverPluginScreenshots(pluginPath, this.pluginsDir, Logger);

            if (!plugin.id || (!plugin.hooks && !plugin.socketListeners && !plugin.terminalCommands)) {
                Logger.warn('PluginManager', `Skipping invalid plugin at ${pluginPath}: Missing 'id', 'hooks', 'socketListeners' or 'terminalCommands'.`);
                return false;
            }

            this.registerPlugin(plugin);
            return this.plugins.has(plugin.id);
        } catch (error) {
            Logger.error('PluginManager', `Error loading plugin at ${pluginPath}:`, error);
            return false;
        }
    }

    async refreshPluginPreviews() {
        const refresh = async plugin => {
            if (!plugin?._pluginPath) return;
            plugin.screenshots = await discoverPluginScreenshots(plugin._pluginPath, this.pluginsDir, Logger);
        };

        await Promise.all([
            ...Array.from(this.plugins.values()).map(refresh),
            ...Array.from(this.disabledPlugins.values()).map(refresh)
        ]);
    }

    registerPlugin(plugin) {
        Logger.log('PluginManager', `Registering plugin: '${plugin.id}'`);
        this.plugins.set(plugin.id, plugin);
        const pluginInterludeMode = String(plugin?.interludeMode || '').trim().toLowerCase();
        const pluginAllowInterludeDefault = pluginInterludeMode === 'all'
            || plugin?.allowInterlude === true
            || plugin?.runOnInterlude === true;
        const pluginSceneModes = Array.isArray(plugin?.sceneModes)
            ? plugin.sceneModes
                .map(mode => String(mode || '').trim().toLowerCase())
                .filter(Boolean)
            : null;

        // Auto-initialize settings if missing and schema exists
        if (plugin.settingsSchema) {
            const { updateSettings } = require('../utils.js');
            const allSettings = readSettings();
            if (!allSettings.plugins || !allSettings.plugins[plugin.id]) {
                const defaults = {};
                for (const [key, schema] of Object.entries(plugin.settingsSchema)) {
                    if (schema.default !== undefined) {
                        defaults[key] = schema.default;
                    }
                }
                if (Object.keys(defaults).length > 0) {
                    Logger.log('PluginManager', `  - Initializing default settings for '${plugin.id}'`);
                    updateSettings(`plugins.${plugin.id}`, defaults).catch(err => {
                        Logger.error('PluginManager', `Failed to initialize settings for ${plugin.id}:`, err);
                    });
                }
            }
        }

        // Register Exports
        if (plugin.exports && typeof plugin.exports === 'object') {
            this.exportedFunctions.set(plugin.id, plugin.exports);
        }

        // Register Views
        if (plugin.views && Array.isArray(plugin.views)) {
            this.views.set(plugin.id, plugin.views);
        }

        // Register Terminal Commands
        if (plugin.terminalCommands && typeof plugin.terminalCommands === 'object') {
            for (const [cmd, def] of Object.entries(plugin.terminalCommands)) {
                if (this.terminalCommands.has(cmd)) {
                    Logger.warn('PluginManager', `Terminal command '${cmd}' is already registered by plugin '${this.terminalCommands.get(cmd).pluginId}'. Skipping registration from '${plugin.id}'.`);
                    continue;
                }
                this.terminalCommands.set(cmd, {
                    ...def,
                    pluginId: plugin.id,
                    run: typeof def === 'function' ? def : def.run
                });
            }
        }

        // Register Hooks
        if (plugin.hooks) {
            for (const [rawHookName, hookDef] of Object.entries(plugin.hooks)) {
                const hookName = rawHookName.split(':')[0];
                if (!this.hooks.has(hookName)) this.hooks.set(hookName, []);
                const hookObj = (hookDef && (typeof hookDef === 'object' || typeof hookDef === 'function') && !Array.isArray(hookDef)) ? hookDef : {};

                const normalizedHook = {
                    pluginId: plugin.id,
                    fn: typeof hookDef === 'function' ? hookDef : hookDef.run,
                    priority: hookObj.priority || 100,
                    mode: hookObj.mode || 'sequential',
                    allowInterlude: (
                        hookObj.allowInterlude === true
                        || hookObj.runOnInterlude === true
                        || (
                            pluginAllowInterludeDefault
                            && hookObj.allowInterlude !== false
                            && hookObj.runOnInterlude !== false
                        )
                    ),
                    sceneModes: Array.isArray(hookObj.sceneModes)
                        ? hookObj.sceneModes
                            .map(mode => String(mode || '').trim().toLowerCase())
                            .filter(Boolean)
                        : pluginSceneModes,
                    useSharedVnLlm: hookObj.useSharedVnLlm === true
                };

                this.hooks.get(hookName).push(normalizedHook);
            }

            for (const listeners of this.hooks.values()) {
                listeners.sort((a, b) => a.priority - b.priority);
            }
        }

        // Register Documentation
        if (plugin.documentation && Array.isArray(plugin.documentation)) {
            Logger.log('PluginManager', `  - Registering ${plugin.documentation.length} documentation items for '${plugin.id}'`);
            this.registeredDocs.set(plugin.id, plugin.documentation);

            // Broadcast the update if IO is available
            if (this.io) {
                this.io.emit('docs:index-updated', this.getRegisteredDocs());
            }
        }

        // Register Socket Listeners
        if (plugin.socketListeners) {
            const socketEvents = Object.keys(plugin.socketListeners);
            Logger.log('PluginManager', `  - Registering ${socketEvents.length} socket listeners for '${plugin.id}'`);

            for (const [eventName, listenerFn] of Object.entries(plugin.socketListeners)) {
                if (!this.socketListeners.has(eventName)) this.socketListeners.set(eventName, []);
                this.socketListeners.get(eventName).push({
                    pluginId: plugin.id,
                    fn: listenerFn
                });

                if (this.io) {
                    for (const socket of this.io.sockets.sockets.values()) {
                        this._attachPluginSocketProxy(socket, eventName);
                    }
                }
            }
        }

        // Register Timeline Providers
        if (plugin.timelineProviders && Array.isArray(plugin.timelineProviders)) {
            const timeline = require('../vn_manager/timeline.js');
            for (const providerDef of plugin.timelineProviders) {
                timeline.registerProvider(plugin.id, providerDef);
            }
        }
    }

    /**
     * Internal helper to unload a plugin and cleanup its hooks, listeners, and views.
     * @param {string} pluginId 
     */
    _unloadPlugin(pluginId) {
        Logger.log('PluginManager', `Unloading plugin: '${pluginId}'`);

        // 1. Remove Hooks
        for (const [hookName, listeners] of this.hooks.entries()) {
            this.hooks.set(hookName, listeners.filter(l => l.pluginId !== pluginId));
        }

        // 2. Remove Socket Listeners
        for (const [eventName, listeners] of this.socketListeners.entries()) {
            this.socketListeners.set(eventName, listeners.filter(l => l.pluginId !== pluginId));
        }

        // 3. Remove Views
        this.views.delete(pluginId);

        // 4. Remove Documentation
        if (this.registeredDocs.has(pluginId)) {
            this.registeredDocs.delete(pluginId);
            if (this.io) {
                this.io.emit('docs:index-updated', this.getRegisteredDocs());
            }
        }

        // 5. Remove Exported Functions
        this.exportedFunctions.delete(pluginId);

        // 5. Remove from main plugins map
        this.plugins.delete(pluginId);

        // 6. Remove Terminal Commands
        for (const [cmd, def] of this.terminalCommands.entries()) {
            if (def.pluginId === pluginId) {
                this.terminalCommands.delete(cmd);
            }
        }
    }

    /**
     * Scans the engine docs directory and registers core documentation items.
     * This makes the system fully dynamic and avoids the need for a manual docs_index.js.
     */
    async _registerCoreDocs() {
        const coreDocsDir = path.join(this.repoRoot, 'engine', 'views', 'docs', 'documents', 'core');
        Logger.log('PluginManager', `Scanning core documentation in: ${coreDocsDir}`);
        
        const coreDocs = await scanDocs(coreDocsDir, 'documents/core');
        if (coreDocs.length > 0) {
            Logger.log('PluginManager', `  - Automatically registered ${coreDocs.length} core documentation items.`);
            this.registeredDocs.set('core', coreDocs);
        }
    }

    _attachDocsIndexProxy(socket) {
        if (socket.__pluginManagerDocsProxyAttached) return;
        socket.__pluginManagerDocsProxyAttached = true;

        socket.on('docs:req-index', () => {
            const dynamicDocs = this.getRegisteredDocs();
            Logger.log('PluginManager', `Docs index requested. Sending ${dynamicDocs.length} dynamic items.`);
            socket.emit('docs:res-index', dynamicDocs);
        });
    }

    _attachPluginSocketProxy(socket, eventName) {
        if (!socket.__pluginManagerProxyEvents) {
            socket.__pluginManagerProxyEvents = new Set();
        }

        if (socket.__pluginManagerProxyEvents.has(eventName)) return;
        socket.__pluginManagerProxyEvents.add(eventName);

        socket.on(eventName, (data) => {
            const currentListeners = this.socketListeners.get(eventName) || [];
            if (!QUIET_SOCKET_DISPATCH_EVENTS.has(eventName)) {
                Logger.log(
                    'PluginManager',
                    `Socket event '${eventName}' received on ${socket.id}; dispatching to ${currentListeners.length} listener(s).`
                );
            }

            if (currentListeners.length === 0) return;

            currentListeners.forEach(listener => {
                try {
                    const tools = buildTools(this, listener.pluginId, this.currentTurnContext, socket);
                    Promise.resolve(listener.fn(data, tools)).catch((error) => {
                        Logger.error('PluginManager', `Error in async socket listener '${eventName}' for plugin '${listener.pluginId}':`, error);
                    });
                } catch (error) {
                    Logger.error('PluginManager', `Error in socket listener '${eventName}' for plugin '${listener.pluginId}':`, error);
                }
            });
        });
    }

    /**
     * Attaches dynamic proxy listeners to a new socket connection.
     * These proxies will check the latest registered listeners in this.socketListeners.
     * @param {Object} socket - The Socket.IO socket instance.
     */
    registerSocketOnConnection(socket) {
        this._attachDocsIndexProxy(socket);
        const eventNames = Array.from(this.socketListeners.keys());
        if (eventNames.length > 0) {
            Logger.log('PluginManager', `Attaching ${eventNames.length} plugin socket proxies to new socket ${socket.id}`);
            for (const eventName of eventNames) {
                this._attachPluginSocketProxy(socket, eventName);
            }
        }
    }

    /**
     * Internal helper to build tools for a plugin.
     * @param {string} pluginId 
     * @param {Object} turnContext 
     * @param {Object} socket 
     * @param {Object} extra 
     * @returns {Object}
     */
    _buildTools(pluginId, turnContext, socket = null, extra = {}) {
        return buildTools(this, pluginId, turnContext, socket, extra);
    }

    async executeHook(hookName, turnContext = null, ...args) {
        return await executeHook(this, hookName, turnContext, ...args);
    }

    /**
     * Executes an exported function from a specific plugin.
     * @param {string} pluginId - The ID of the plugin.
     * @param {string} functionName - The name of the function to call.
     * @param {Object} turnContext - The current turn context.
     * @param {...any} args - Arguments to pass to the function.
     * @returns {Promise<any>}
     */
    async callPluginFunction(pluginId, functionName, turnContext, ...args) {
        return await callPluginFunction(this, pluginId, functionName, turnContext, ...args);
    }

    /**
     * Requests a custom file view from a plugin.
     * @param {string} pluginId 
     * @param {string} modeId 
     * @param {string} filePath 
     * @returns {Promise<{success: boolean, content?: string, type?: 'html'|'text', error?: string}>}
     */
    async provideFileView(pluginId, modeId, filePath) {
        return await provideFileView(this, pluginId, modeId, filePath);
    }
}

const instance = new PluginManager();
module.exports = instance;

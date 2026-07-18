const { getPendingRenames, clearPendingRenames, getProjectMetadata, setProjectMetadata } = require('../../config/project_config_store.js');

function createProjectSelectHandler({
    fs,
    path,
    projectsRoot,
    engineDir,
    VectorStoreManager,
    Logger,
    getProjectName,
    getMainWindow,
    getRendererSocketQuery,
    runtimeSocketState,
    contentManager,
    pluginManager,
    io,
    getStaticDataManager,
    setStaticDataManager,
    StaticDataManager,
    chaptermanagement,
    initFactManager,
    emitResponse,
    setRootDirectory,
    invalidateFrontendInjectionCache,
    setMainCharacterName,
    setMainCharacterBio,
    setActiveChatPathGlobal
}) {
    return async function selectProject(socket, { projectName }) {
        try {
            // Fallback to current project name if not provided
            const finalProjectName = projectName || getProjectName();
            if (finalProjectName === 'default_project' && !projectName) {
                throw new Error('Project name is required for selection.');
            }
            const projectPath = path.join(projectsRoot, finalProjectName);
            await fs.access(projectPath);
            setRootDirectory(projectPath);
            VectorStoreManager.setProjectRoot(projectPath);
            Logger.log('Main', 'ProjectMgmt', 'Project selection started', 'start', projectPath);

            const newProjectName = getProjectName();
            const selectedRootDirectory = projectPath;
            const mainWindow = getMainWindow();
            mainWindow.loadFile(path.join(engineDir, 'index.html'), { query: getRendererSocketQuery(runtimeSocketState) });

            mainWindow.webContents.once('did-finish-load', async () => {
                try {
                    // Stamp "last opened" first so the selector can sort by recency.
                    let workingConfig = await contentManager.loadFileConfig(selectedRootDirectory);
                    const metadataWithLastOpened = {
                        ...getProjectMetadata(workingConfig),
                        last_opened_at: Date.now()
                    };
                    workingConfig = setProjectMetadata(workingConfig, metadataWithLastOpened);

                    // Handle deferred renames before scanning directory
                    const pending = getPendingRenames(workingConfig);
                    if (Object.keys(pending).length > 0) {
                        const updatedConfig = clearPendingRenames(workingConfig);

                        for (const [oldP, newP] of Object.entries(pending)) {
                            try {
                                await fs.rename(oldP, newP);
                                Logger.log('Main', 'Startup', `Applied deferred rename: ${oldP} -> ${newP}`);
                                // Update keys in config
                                for (const key in updatedConfig) {
                                    if (path.normalize(key) === path.normalize(oldP)) {
                                        const fileSettings = updatedConfig[key];
                                        delete updatedConfig[key];
                                        updatedConfig[newP] = fileSettings;
                                    }
                                }

                                // Also rename associated plugin storage if it's a .db file
                                if (oldP.toLowerCase().endsWith('.db')) {
                                    const oldDirName = path.basename(oldP, '.db');
                                    const newDirName = path.basename(newP, '.db');
                                    const oldPluginDir = path.join(selectedRootDirectory, 'plugins', oldDirName);
                                    const newPluginDir = path.join(selectedRootDirectory, 'plugins', newDirName);
                                    try {
                                        await fs.access(oldPluginDir);
                                        await fs.rename(oldPluginDir, newPluginDir);
                                        Logger.log('Main', 'Startup', `Renamed deferred plugin storage: ${oldPluginDir} -> ${newPluginDir}`);
                                    } catch (err) {
                                        if (err.code !== 'ENOENT') throw err;
                                    }
                                }
                            } catch (renameErr) {
                                Logger.error('Main', 'Startup', `Failed to apply deferred rename: ${oldP} -> ${newP}`, renameErr);
                            }
                        }
                        workingConfig = updatedConfig;
                    }
                    await contentManager.saveFileConfig(selectedRootDirectory, workingConfig);
                    const processed = await contentManager.processDirectory(selectedRootDirectory, selectedRootDirectory, newProjectName, pluginManager.getRegisteredFileModes());

                    io.emit('project-changed', { projectName: newProjectName });
                    Logger.log('Main', 'ProjectMgmt', `Broadcasting project-changed event for: ${newProjectName}`);

                    const currentStaticDataManager = getStaticDataManager();
                    if (currentStaticDataManager) {
                        await currentStaticDataManager.close();
                    }

                    // Initialize StaticDataManager
                    const nextStaticDataManager = new StaticDataManager(newProjectName, selectedRootDirectory);
                    await nextStaticDataManager.initialize();
                    setStaticDataManager(nextStaticDataManager);
                    Logger.log('Main', 'Database', `StaticDataManager initialized for project: ${newProjectName}`);

                    // Update PluginManager with project-specific managers
                    pluginManager.chapterManager = chaptermanagement;
                    pluginManager.staticDataManager = nextStaticDataManager;
                    pluginManager.setProjectRoot(selectedRootDirectory);
                    Logger.log('Main', 'ProjectMgmt', `PluginManager updated for project: ${newProjectName}. Root: ${selectedRootDirectory}`);

                    // Trigger HOOK_PROJECT_LOADED
                    await pluginManager.executeHook('HOOK_PROJECT_LOADED', { projectName: newProjectName, rootDirectory: selectedRootDirectory });

                    // Story scripts may have been loaded/unloaded by HOOK_PROJECT_LOADED;
                    // invalidate the injection cache so new sockets get fresh assets.
                    invalidateFrontendInjectionCache();

                    // Retrieve player character metadata from config (New Source of Truth)
                    const config = processed.config;
                    const metadata = getProjectMetadata(config);
                    const playerMetadata = metadata.player || { name: '', bio: '' };

                    setMainCharacterName(playerMetadata.name || '');
                    setMainCharacterBio(playerMetadata.bio || '');
                    io.emit('player-character-updated', { ...playerMetadata, projectName: newProjectName }); // Emit full metadata with project name

                    // Handle first-time project load: switch to Content Manager
                    if (playerMetadata.firstTimeLoad) {
                        Logger.log('Main', 'ProjectMgmt', `Detected first-time load for project: ${newProjectName}. Switching to content_manager tab.`);
                        
                        // Emit switch-tab to the frontend
                        io.emit('switch-tab', { tab: 'content_manager' });

                        // Remove the flag so it doesn't happen again
                        delete playerMetadata.firstTimeLoad;
                        const updatedConfig = setProjectMetadata(config, metadata); // metadata.player is already updated by reference if it was used, but let's be safe
                        await contentManager.saveFileConfig(selectedRootDirectory, updatedConfig);
                    }

                    Logger.log('Main', 'ProjectMgmt', `Loaded player character data: "${playerMetadata.name || ''}" (from config)`);
                    Logger.log('Main', 'ProjectMgmt', `Initializing FactManager for project: ${newProjectName}`);
                    Logger.log('Main', 'ProjectMgmt', `FactManager initialized for project: ${newProjectName}`);

                    emitResponse('project-ready', {
                        ...processed,
                        projectName: newProjectName,
                        pluginModes: pluginManager.getRegisteredFileModes()
                    });

                    // AUTO-INIT Active Chat if found in config
                    let activeChatPath = null;
                    for (const filePath in config.files) {
                        const mode = typeof config.files[filePath] === 'string' ? config.files[filePath] : config.files[filePath].mode;
                        if (mode === 'chat') {
                            activeChatPath = filePath;
                            setActiveChatPathGlobal(filePath); // Update global tracking
                            break;
                        }
                    }

                    if (activeChatPath) {
                        Logger.log('Main', 'ProjectOperations', `[State Restoration] Auto-initializing active chat DB: ${activeChatPath}`);
                        await chaptermanagement.init(activeChatPath);

                        // Fetch last known viewer state
                        const viewerState = await chaptermanagement.getViewerState();
                        Logger.log('Main', 'ProjectOperations', `[State Restoration] Broadcasting chat-db-switched. Path: ${activeChatPath}, State: ${JSON.stringify(viewerState)}`);
                        io.emit('chat-db-switched', { path: activeChatPath, viewerState });

                        Logger.log('Main', 'ProjectOperations', `Initializing FactManager for project: ${newProjectName} with DB: ${activeChatPath}`);
                        await initFactManager(activeChatPath);

                        await pluginManager.executeHook('HOOK_CHAT_DB_INITIALIZED', { chatDbPath: activeChatPath });
                        Logger.log('Main', 'ProjectOperations', `[State Restoration] HOOK_CHAT_DB_INITIALIZED complete for: ${activeChatPath}`);
                    }

                    Logger.log('Main', 'ProjectMgmt', 'Project selection complete', 'end');
                } catch (processingError) {
                    Logger.error('Main', 'ProjectMgmt', 'Error processing directory after load', null, processingError);
                }
            });
        } catch (error) {
            Logger.error('Main', 'ProjectMgmt', 'Error during project selection', null, error);
            emitResponse('select-project-response', { success: false, error: 'Failed to select project. It might not exist.' });
        }
    };
}

module.exports = {
    createProjectSelectHandler
};

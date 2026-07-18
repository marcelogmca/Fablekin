const { setPendingRename } = require('../../config/project_config_store.js');

function createFileHandlers({
    fs,
    path,
    shell,
    Logger,
    emitResponse,
    isPathInsideRoot,
    resolvePathInsideRoot,
    scriptSecurity,
    contentManager,
    getProjectName,
    pluginManager,
    getRootDirectory,
    chaptermanagement,
    closeFactManager,
    getStaticDataManager,
    setActiveChatPathGlobal,
    getActiveChatPathGlobal,
    initFactManager,
    getSettings,
    narrativeEngine,
    setStartTime,
    setCurrentStep,
    io,
    TurnLogger,
    timeline
}) {
    function getFileMode(fileConfig) {
        return typeof fileConfig === 'string' ? fileConfig : fileConfig?.mode;
    }

    function isIntroMode(fileConfig) {
        return getFileMode(fileConfig) === 'intro';
    }

    async function isIntroFilePath(rootDirectory, filePath) {
        if (!rootDirectory || !filePath) return false;
        try {
            const config = await contentManager.loadFileConfig(rootDirectory);
            const normalizedTarget = path.normalize(filePath);
            return Object.entries(config.files).some(([configuredPath, fileConfig]) => {
                return path.normalize(configuredPath) === normalizedTarget && isIntroMode(fileConfig);
            });
        } catch (error) {
            Logger.error('Main', 'FileOperations', 'Failed to inspect file config for intro update.', error);
            return false;
        }
    }

    function emitPrologueContentInvalidated(reason, extra = {}) {
        if (!io || typeof io.emit !== 'function') return;
        io.emit('prologue-content-invalidated', {
            reason,
            ...extra,
            timestamp: Date.now()
        });
    }

    async function openFolderInExplorer(responseEvent, targetPath, label) {
        const rootDirectory = getRootDirectory();
        if (!rootDirectory) {
            return emitResponse(responseEvent, { success: false, error: 'Project not loaded.' });
        }
        if (!targetPath || !isPathInsideRoot(targetPath, rootDirectory)) {
            Logger.error('Main', 'FileOperations', `Refused to open ${label}: target outside project root.`, { rootDirectory, targetPath });
            return emitResponse(responseEvent, { success: false, error: 'Unauthorized folder access.' });
        }

        try {
            await fs.mkdir(targetPath, { recursive: true });
            const errorMessage = await shell.openPath(targetPath);
            if (errorMessage) {
                throw new Error(errorMessage);
            }
            Logger.log('Main', 'FileOperations', `Opened ${label} in file explorer: ${targetPath}`);
            return emitResponse(responseEvent, { success: true, path: targetPath });
        } catch (error) {
            Logger.error('Main', 'FileOperations', `Error opening ${label} in file explorer`, error);
            return emitResponse(responseEvent, { success: false, error: error.message });
        }
    }

    return {
        async openProjectFolder() {
            const rootDirectory = getRootDirectory();
            return openFolderInExplorer('open-project-folder-response', rootDirectory, 'project folder');
        },

        async openProjectAssetsFolder() {
            const rootDirectory = getRootDirectory();
            const assetsDirectory = rootDirectory ? path.join(rootDirectory, 'assets') : null;
            return openFolderInExplorer('open-project-assets-folder-response', assetsDirectory, 'project assets folder');
        },

        async getFileContent(socket, { filePath }) {
            const rootDirectory = getRootDirectory();
            if (!isPathInsideRoot(filePath, rootDirectory)) {
                Logger.error('Main', 'FileOperations', 'Unauthorized file access attempt.', { rootDirectory, filePath });
                return emitResponse('get-file-content-response', { success: false, error: 'Unauthorized file access.' });
            }
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                emitResponse('get-file-content-response', { success: true, content, filePath });
            } catch (error) {
                Logger.error('Main', 'FileOperations', 'Error reading file content', error);
                emitResponse('get-file-content-response', { success: false, error: error.message });
            }
        },

        async peekFileContent(socket, { filePath }) {
            const rootDirectory = getRootDirectory();
            if (!isPathInsideRoot(filePath, rootDirectory)) {
                return emitResponse('peek-file-content-response', { success: false, error: 'Unauthorized.' });
            }
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                emitResponse('peek-file-content-response', { success: true, content });
            } catch (error) {
                emitResponse('peek-file-content-response', { success: false, error: error.message });
            }
        },

        async saveFileContent(socket, { filePath, content }) {
            const rootDirectory = getRootDirectory();
            if (!isPathInsideRoot(filePath, rootDirectory)) {
                Logger.error('Main', 'FileOperations', 'Unauthorized file access attempt.', { rootDirectory, filePath });
                return emitResponse('save-file-content-response', { success: false, error: 'Unauthorized file access.' });
            }
            try {
                const affectsIntro = await isIntroFilePath(rootDirectory, filePath);
                await fs.writeFile(filePath, content, 'utf8');

                // Calculate hash for story scripts or any .md file and return it
                let fileHash = null;
                if (filePath.endsWith('.md')) {
                    fileHash = await scriptSecurity.calculateHash(filePath);
                }

                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());
                emitResponse('save-file-content-response', {
                    success: true,
                    hash: fileHash,
                    directory: {
                        ...directory,
                        pluginModes: pluginManager.getRegisteredFileModes()
                    }
                });
                if (affectsIntro) emitPrologueContentInvalidated('intro-file-saved', { filePath });
            } catch (error) {
                Logger.error('Main', 'FileOperations', 'Error saving file', error);
                emitResponse('save-file-content-response', { success: false, error: error.message });
            }
        },

        async createNewFile(socket, { directoryPath, fileName }) {
            const rootDirectory = getRootDirectory();
            if (!isPathInsideRoot(directoryPath, rootDirectory)) {
                Logger.error('Main', 'FileOperations', 'Unauthorized file access attempt.', { rootDirectory, directoryPath });
                return emitResponse('create-new-file-response', { success: false, error: 'Unauthorized file access.' });
            }
            let finalFileName = fileName;
            if (!finalFileName.toLowerCase().endsWith('.md')) {
                finalFileName += '.md';
            }
            try {
                const filePath = path.join(directoryPath, finalFileName);
                if (!isPathInsideRoot(filePath, rootDirectory)) {
                    Logger.error('Main', 'FileOperations', 'Unauthorized file access attempt (create target outside root).', { rootDirectory, filePath });
                    return emitResponse('create-new-file-response', { success: false, error: 'Unauthorized file access.' });
                }

                // Check if file already exists to prevent accidental overwrite
                try {
                    await fs.access(filePath);
                    return emitResponse('create-new-file-response', { success: false, error: 'File already exists.' });
                } catch {
                    // File does not exist, safe to proceed
                }

                await fs.writeFile(filePath, '', 'utf8');
                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());
                emitResponse('create-new-file-response', {
                    success: true,
                    directory: {
                        ...directory,
                        pluginModes: pluginManager.getRegisteredFileModes()
                    }
                });
            } catch (error) {
                Logger.error('Main', 'FileOperations', 'Error creating new file', error);
                emitResponse('create-new-file-response', { success: false, error: error.message });
            }
        },

        async createNewChatDb(socket, { directoryPath, fileName }) {
            const rootDirectory = getRootDirectory();
            if (!isPathInsideRoot(directoryPath, rootDirectory)) {
                Logger.error('Main', 'FileOperations', 'Unauthorized file access attempt.', { rootDirectory, directoryPath });
                return emitResponse('create-new-chat-db-response', { success: false, error: 'Unauthorized file access.' });
            }
            let finalFileName = fileName;
            if (!finalFileName.toLowerCase().endsWith('.db')) {
                finalFileName += '.db';
            }
            try {
                const filePath = path.join(directoryPath, finalFileName);
                if (!isPathInsideRoot(filePath, rootDirectory)) {
                    Logger.error('Main', 'FileOperations', 'Unauthorized file access attempt (create DB target outside root).', { rootDirectory, filePath });
                    return emitResponse('create-new-chat-db-response', { success: false, error: 'Unauthorized file access.' });
                }

                // Check if file already exists
                try {
                    await fs.access(filePath);
                    return emitResponse('create-new-chat-db-response', { success: false, error: 'File already exists.' });
                } catch {
                    // Safe to proceed
                }

                // Temporarily use chaptermanagement to init the schema
                // We save the current DB path to restore it after
                const previousDbPath = chaptermanagement.currentChatDbFullPath;

                Logger.log('Main', 'FileOperations', `Initializing new Chat DB at: ${filePath}`);
                await chaptermanagement.init(filePath);

                // If we had a previous DB, re-init it to restore connection
                if (previousDbPath && previousDbPath !== filePath) {
                    Logger.log('Main', 'FileOperations', `Restoring previous Chat DB connection: ${previousDbPath}`);
                    await chaptermanagement.init(previousDbPath);
                }

                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());
                emitResponse('create-new-chat-db-response', {
                    success: true,
                    directory: {
                        ...directory,
                        pluginModes: pluginManager.getRegisteredFileModes()
                    }
                });
            } catch (error) {
                Logger.error('Main', 'FileOperations', 'Error creating new Chat DB', error);
                emitResponse('create-new-chat-db-response', { success: false, error: error.message });
            }
        },

        async updateFileOrder(socket, { filePath, newOrder }) {
            const rootDirectory = getRootDirectory();
            if (!rootDirectory) return emitResponse('update-file-order-response', { success: false, error: 'No project loaded.' });
            try {
                const normalizedTargetFile = path.normalize(filePath);
                const config = await contentManager.loadFileConfig(rootDirectory);

                Logger.log('Main', 'FileOperations', `Updating order for: ${normalizedTargetFile} to ${newOrder}`);

                // Look for existing config with normalized path
                let foundKey = null;
                for (const key in config.files) {
                    if (path.normalize(key) === normalizedTargetFile) {
                        foundKey = key;
                        break;
                    }
                }

                const itemConfig = foundKey ? config.files[foundKey] : 'not-included';
                const affectsIntro = isIntroMode(itemConfig);
                const updatedKey = foundKey || normalizedTargetFile;

                if (typeof itemConfig === 'string') {
                    config.files[updatedKey] = { mode: itemConfig, order: newOrder };
                } else {
                    itemConfig.order = newOrder;
                    config.files[updatedKey] = itemConfig;
                }

                Logger.log('Main', 'FileOperations', 'Saving updated config for order change.');
                await contentManager.saveFileConfig(rootDirectory, config);
                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());
                emitResponse('update-file-order-response', {
                    success: true,
                    directory: {
                        ...directory,
                        pluginModes: pluginManager.getRegisteredFileModes()
                    }
                });
                if (affectsIntro) emitPrologueContentInvalidated('intro-order-updated', { filePath: updatedKey });
            } catch (error) {
                Logger.error('Main', 'FileOperations', 'Error updating file order', error);
                emitResponse('update-file-order-response', { success: false, error: error.message });
            }
        },

        async moveFileToFolder(socket, { sourcePath, targetFolder, newOrder }) {
            const rootDirectory = getRootDirectory();
            if (!rootDirectory) return emitResponse('move-file-to-folder-response', { success: false, error: 'No project loaded.' });
            try {
                const normSource = resolvePathInsideRoot(sourcePath, rootDirectory);
                const normTargetFolder = resolvePathInsideRoot(targetFolder, rootDirectory);
                if (!normSource || !normTargetFolder) {
                    Logger.error('Main', 'FileOperations', 'Unauthorized move path attempt.', { rootDirectory, sourcePath, targetFolder });
                    return emitResponse('move-file-to-folder-response', { success: false, error: 'Unauthorized file access.' });
                }

                const fileName = path.basename(normSource);
                const targetPath = resolvePathInsideRoot(path.join(normTargetFolder, fileName), rootDirectory);
                if (!targetPath) {
                    Logger.error('Main', 'FileOperations', 'Unauthorized move target outside project root.', { rootDirectory, sourcePath, targetFolder });
                    return emitResponse('move-file-to-folder-response', { success: false, error: 'Unauthorized file access.' });
                }

                Logger.log('Main', 'FileOperations', `Moving file: ${normSource} -> ${targetPath} (New Order: ${newOrder})`);

                if (normSource === targetPath) {
                    return emitResponse('move-file-to-folder-response', { success: false, error: 'Source and target are identical.' });
                }

                // Check if target already exists
                try {
                    await fs.access(targetPath);
                    return emitResponse('move-file-to-folder-response', { success: false, error: 'Target already exists.' });
                } catch {
                    // Safe to proceed
                }

                // Load existing config
                const config = await contentManager.loadFileConfig(rootDirectory);
                const newConfig = { ...config, files: {} };
                const affectsIntro = Object.entries(config.files).some(([oldKey, fileConfig]) => {
                    const normKey = path.normalize(oldKey);
                    return (normKey === normSource || normKey.startsWith(normSource + path.sep)) && isIntroMode(fileConfig);
                });

                // 1. Physically move on disk
                await fs.rename(normSource, targetPath);
                Logger.log('Main', 'FileOperations', 'Physically moved file on disk.');

                // 2. Update config keys with normalization awareness
                for (const oldKey in config.files) {
                    const normKey = path.normalize(oldKey);

                    if (normKey === normSource) {
                        // This is the item being moved
                        const sourceConfig = config.files[oldKey];
                        const mode = typeof sourceConfig === 'string' ? sourceConfig : (sourceConfig.mode || 'not-included');
                        newConfig.files[targetPath] = { mode, order: newOrder };
                        Logger.log('Main', 'FileOperations', `Updated config key for moved item: ${targetPath}`);
                    } else if (normKey.startsWith(normSource + path.sep)) {
                        // This is a child of the directory being moved
                        const relativePath = path.relative(normSource, normKey);
                        const newFullKey = path.join(targetPath, relativePath);
                        newConfig.files[newFullKey] = config.files[oldKey];
                        Logger.log('Main', 'FileOperations', `Updated config key for nested item: ${newFullKey}`);
                    } else {
                        // This item is unrelated, keep as is
                        newConfig.files[oldKey] = config.files[oldKey];
                    }
                }

                // If the source wasn't in config (it was 'not-included'), ensure it exists in newConfig now
                if (!newConfig.files[targetPath]) {
                    newConfig.files[targetPath] = { mode: 'not-included', order: newOrder };
                    Logger.log('Main', 'FileOperations', `Added default config for moved item (previously not in config): ${targetPath}`);
                }

                Logger.log('Main', 'FileOperations', `Saving updated config for move operation. Total entries: ${Object.keys(newConfig.files).length}`);
                await contentManager.saveFileConfig(rootDirectory, newConfig);
                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());
                emitResponse('move-file-to-folder-response', {
                    success: true,
                    directory: {
                        ...directory,
                        pluginModes: pluginManager.getRegisteredFileModes()
                    }
                });
                if (affectsIntro) emitPrologueContentInvalidated('intro-file-moved', { sourcePath: normSource, targetPath });
            } catch (error) {
                Logger.error('Main', 'FileOperations', 'Error moving file to folder', error);
                emitResponse('move-file-to-folder-response', { success: false, error: error.message });
            }
        },

        async renameFile(socket, { oldPath, newName }) {
            const rootDirectory = getRootDirectory();
            const normalizedOld = path.normalize(oldPath);
            if (!isPathInsideRoot(normalizedOld, rootDirectory)) {
                return emitResponse('rename-file-response', { success: false, error: 'Unauthorized.' });
            }

            const dir = path.dirname(normalizedOld);
            const ext = path.extname(normalizedOld);
            let finalNewName = newName;
            if (!finalNewName.toLowerCase().endsWith(ext.toLowerCase())) {
                finalNewName += ext;
            }
            const newPath = path.join(dir, finalNewName);
            if (!isPathInsideRoot(newPath, rootDirectory)) {
                Logger.error('Main', 'FileOperations', 'Unauthorized rename target outside project root.', { rootDirectory, oldPath: normalizedOld, newPath });
                return emitResponse('rename-file-response', { success: false, error: 'Unauthorized.' });
            }

            if (normalizedOld === newPath) {
                return emitResponse('rename-file-response', { success: true });
            }

            // Collision check
            try {
                await fs.access(newPath);
                return emitResponse('rename-file-response', { success: false, error: 'A file with that name already exists.' });
            } catch { }

            const isDb = normalizedOld.endsWith('.db');
            const isCurrentlyActive = normalizedOld === getActiveChatPathGlobal();
            let affectsIntro = false;

            const performRename = async () => {
                // Load config BEFORE renaming so the file existence check in loadFileConfig doesn't prune the old path
                const config = await contentManager.loadFileConfig(rootDirectory);
                affectsIntro = Object.entries(config.files).some(([key, fileConfig]) => {
                    const normKey = path.normalize(key);
                    return (normKey === normalizedOld || normKey.startsWith(normalizedOld + path.sep)) && isIntroMode(fileConfig);
                });
                await fs.rename(normalizedOld, newPath);
                const newConfig = { ...config, files: {} };
                for (const key in config.files) {
                    const normKey = path.normalize(key);
                    if (normKey === normalizedOld) {
                        newConfig.files[newPath] = config.files[key];
                    } else if (normKey.startsWith(normalizedOld + path.sep)) {
                        const relativePath = path.relative(normalizedOld, normKey);
                        newConfig.files[path.join(newPath, relativePath)] = config.files[key];
                    } else {
                        newConfig.files[key] = config.files[key];
                    }
                }
                await contentManager.saveFileConfig(rootDirectory, newConfig);

                // Also rename associated plugin storage if it's a .db file
                if (isDb) {
                    const oldDirName = path.basename(normalizedOld, '.db');
                    const newDirName = path.basename(newPath, '.db');
                    const oldPluginDir = path.join(rootDirectory, 'plugins', oldDirName);
                    const newPluginDir = path.join(rootDirectory, 'plugins', newDirName);
                    try {
                        await fs.access(oldPluginDir);
                        await fs.rename(oldPluginDir, newPluginDir);
                        Logger.log('Main', 'FileOperations', `Renamed plugin storage: ${oldPluginDir} -> ${newPluginDir}`);
                    } catch { /* ignore if dir doesn't exist */ }
                }

                if (isCurrentlyActive) setActiveChatPathGlobal(newPath);
            };

            try {
                if (isDb && isCurrentlyActive) {
                    Logger.log('Main', 'FileOperations', `Closing active DB for rename: ${normalizedOld}`);
                    await chaptermanagement.close();
                    await closeFactManager();
                }

                await performRename();
                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());
                emitResponse('rename-file-response', {
                    success: true,
                    directory: {
                        ...directory,
                        pluginModes: pluginManager.getRegisteredFileModes()
                    }
                });
                if (affectsIntro) emitPrologueContentInvalidated('intro-file-renamed', { oldPath: normalizedOld, newPath });
            } catch (error) {
                if (isDb && (error.code === 'EBUSY' || error.code === 'EPERM')) {
                    Logger.log('Main', 'FileOperations', `File locked, queuing deferred rename: ${normalizedOld} -> ${newPath}`);
                    const config = await contentManager.loadFileConfig(rootDirectory);
                    const updatedConfig = setPendingRename(config, normalizedOld, newPath);
                    await contentManager.saveFileConfig(rootDirectory, updatedConfig);
                    emitResponse('rename-file-response', { success: true, needsRestart: true });
                } else {
                    Logger.error('Main', 'FileOperations', 'Error renaming file', error);
                    emitResponse('rename-file-response', { success: false, error: error.message });
                }
            }
        },

        async deleteFile(socket, { filePath }) {
            const rootDirectory = getRootDirectory();
            if (!isPathInsideRoot(filePath, rootDirectory)) {
                Logger.error('Main', 'FileOperations', 'Unauthorized file access attempt.', { rootDirectory, filePath });
                return emitResponse('delete-file-response', { success: false, error: 'Unauthorized file access.' });
            }
            try {
                const affectsIntro = await isIntroFilePath(rootDirectory, filePath);
                // If the file is a .db file, close the database connections first
                if (filePath.endsWith('.db')) {
                    Logger.log('Main', 'FileOperations', `Attempting to close DB connections for ${filePath}`);
                    await chaptermanagement.close();
                    await closeFactManager();
                    const staticDataManager = getStaticDataManager();
                    if (staticDataManager) {
                        await staticDataManager.close();
                    }

                    Logger.log('Main', 'FileOperations', `DB connections for ${filePath} closed.`);

                    const dbFileName = path.basename(filePath, '.db');

                    // Delete the centralized chat plugin storage directory
                    const chatPluginDir = path.join(rootDirectory, 'plugins', dbFileName);
                    try {
                        await fs.access(chatPluginDir);
                        Logger.log('Main', 'FileOperations', `Deleting centralized plugin storage for ${dbFileName}: ${chatPluginDir}`);
                        await fs.rm(chatPluginDir, { recursive: true, force: true });
                        Logger.log('Main', 'FileOperations', 'Successfully deleted centralized plugin storage.');
                    } catch {
                        // Folder doesn't exist or other error, ignore
                    }
                }

                const fileStats = await fs.lstat(filePath);
                if (fileStats.isDirectory()) {
                    await fs.rm(filePath, { recursive: true, force: true });
                } else {
                    await fs.unlink(filePath);
                    
                    // If it was a .db, notify plugins that the chat is gone
                    if (filePath.endsWith('.db')) {
                        await pluginManager.executeHook('HOOK_CHAT_DELETED', { chatDbPath: filePath });
                    }
                }
                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());
                emitResponse('delete-file-response', {
                    success: true,
                    directory: {
                        ...directory,
                        pluginModes: pluginManager.getRegisteredFileModes()
                    }
                });
                if (affectsIntro) emitPrologueContentInvalidated('intro-file-deleted', { filePath });
            } catch (error) {
                Logger.error('Main', 'FileOperations', 'Error deleting file', error);
                emitResponse('delete-file-response', { success: false, error: error.message });
            }
        },

        async appendContentToFile(socket, { filePath, content }) {
            Logger.log('Main', 'FileOperations', 'Append to file requested', { filePath });
            const rootDirectory = getRootDirectory();
            const safeFilePath = resolvePathInsideRoot(filePath, rootDirectory);
            if (!safeFilePath) {
                Logger.error('Main', 'FileOperations', 'Unauthorized append path attempt.', { rootDirectory, filePath });
                return emitResponse('append-to-file-response', { success: false, error: 'Unauthorized file access.' });
            }
            try {
                const contentToAppend = `\n\n---\n\n${content}`;
                await contentManager.appendToFile(safeFilePath, contentToAppend);
                emitResponse('append-to-file-response', { success: true });
            } catch (error) {
                Logger.error('Main', 'FileOperations', 'Error appending to file', error);
                emitResponse('append-to-file-response', { success: false, error: error.message });
            }
        },

        async convertMdToChatDb(socket, { filePath }) {
            const rootDirectory = getRootDirectory();
            if (!isPathInsideRoot(filePath, rootDirectory) || !filePath.endsWith('.md')) {
                Logger.error('Main', 'DBConversion', 'Unauthorized or invalid file access attempt.', { rootDirectory, filePath });
                return emitResponse('convert-md-to-chat-db-response', { success: false, error: 'Unauthorized or invalid file path.' });
            }

            try {
                const projectName = path.basename(filePath, '.md');
                const chatDbFullPath = filePath.replace(/\.md$/, '.db');
                Logger.log('Main', 'DBConversion', `Converting ${filePath} to ${chatDbFullPath}`);

                // 1. Validate the source .md is accessible before creating the DB.
                await fs.access(filePath);

                // 2. Initialize chaptermanagement for the new DB
                await chaptermanagement.init(chatDbFullPath);

                const settings = getSettings();
                if (settings.narrative_agents?.facts?.enabled !== false) {
                    Logger.log('Main', 'ProjectOperations', `Initializing FactManager for project: ${projectName} with DB: ${chatDbFullPath}`);
                    await initFactManager(chatDbFullPath);
                    Logger.log('Main', 'ProjectOperations', `FactManager initialized for project: ${projectName}`);
                }

                await pluginManager.executeHook('HOOK_CHAT_DB_INITIALIZED', { chatDbPath: chatDbFullPath });

                if (!getStaticDataManager()) {
                    Logger.warn('Main', 'DBConversion', 'StaticDataManager not available, skipping KG seeding.');
                }

                // 4. Delete the original .md file
                await fs.unlink(filePath);
                Logger.log('Main', 'DBConversion', `Successfully deleted original file: ${filePath}`);

                // Update the file config to make this the active chat
                const currentConfig = await contentManager.loadFileConfig(rootDirectory);
                const updatedConfig = { ...currentConfig, files: { ...currentConfig.files } };

                // Deactivate any existing chat file
                for (const key in updatedConfig.files) {
                    const mode = typeof updatedConfig.files[key] === 'string' ? updatedConfig.files[key] : updatedConfig.files[key].mode;
                    if (mode === 'chat') {
                        if (typeof updatedConfig.files[key] === 'string') {
                            updatedConfig.files[key] = 'not-included';
                        } else {
                            updatedConfig.files[key].mode = 'not-included';
                        }
                    }
                }

                // Set the new DB file as the active chat
                updatedConfig.files[chatDbFullPath] = 'chat';
                await contentManager.saveFileConfig(rootDirectory, updatedConfig);
                Logger.log('Main', 'DBConversion', `Updated file config to set ${chatDbFullPath} as active chat.`);

                // 4. Re-process the directory and send the new structure back
                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());
                emitResponse('convert-md-to-chat-db-response', {
                    success: true,
                    directory: {
                        ...directory,
                        pluginModes: pluginManager.getRegisteredFileModes()
                    }
                });
            } catch (error) {
                Logger.error('Main', 'DBConversion', 'Error during DB conversion process', error);
                emitResponse('convert-md-to-chat-db-response', { success: false, error: error.message });
            }
        },

        async sendToLLM(socket, { files, prompt }) {
            Logger.log('Main', 'FileOperations', 'Send to LLM (Text-Gen Tab) requested', { files, prompt });
            try {
                const rootDirectory = getRootDirectory();
                setStartTime(Date.now());
                setCurrentStep(0);

                const projectName = getProjectName();
                const narrativeResult = await narrativeEngine.generateNextChapter(files, prompt, rootDirectory, projectName, true);

                Logger.log('Main', 'FileOperations', 'LLM result', narrativeResult.text);
                emitResponse('send-to-llm-response', { success: true, result: narrativeResult.text });
            } catch (error) {
                Logger.error('Main', 'FileOperations', 'Error sending to LLM', error);
                emitResponse('send-to-llm-response', { success: false, error: error.message });
            }
            io.emit('new-log-available', {
                projectName: getProjectName(),
                filename: path.basename(TurnLogger.getCurrentLogPath())
            });
        },

        async saveFileConfig(_socket, config) {
            Logger.log('Main', 'FileOperations', 'Save file config requested', config);
            const rootDirectory = getRootDirectory();
            if (rootDirectory) {
                // Safeguard: Ensure only one file is marked as 'chat'
                let activeChatPath = null;
                // Iterate in reverse or find the latest to decide which one "wins" if multiple were sent
                if (!config || typeof config !== 'object' || !config.files || typeof config.files !== 'object') {
                    throw new Error('File configuration must use the structured project config schema.');
                }
                const currentConfig = await contentManager.loadFileConfig(rootDirectory);
                const updatedConfig = {
                    ...currentConfig,
                    files: { ...config.files }
                };
                for (const filePath in updatedConfig.files) {
                    const mode = typeof updatedConfig.files[filePath] === 'string' ? updatedConfig.files[filePath] : updatedConfig.files[filePath].mode;
                    if (mode === 'chat') {
                        if (activeChatPath) {
                            Logger.warn('Main', 'FileOperations', `Multiple chat files detected. Unsetting ${activeChatPath} in favor of ${filePath}`);
                            if (typeof updatedConfig.files[activeChatPath] === 'string') {
                                updatedConfig.files[activeChatPath] = 'none';
                            } else {
                                updatedConfig.files[activeChatPath].mode = 'none';
                            }
                        }
                        activeChatPath = filePath;
                    }
                }

                await contentManager.saveFileConfig(rootDirectory, updatedConfig);
                emitPrologueContentInvalidated('file-config-saved');

                // Check for the active chat DB file and initialize chaptermanagement
                if (activeChatPath) {
                    if (getActiveChatPathGlobal() !== activeChatPath) {
                        setActiveChatPathGlobal(activeChatPath); // Update global tracking
                        Logger.log('Main', 'FileOperations', `Found NEW active chat DB: ${activeChatPath}. Initializing ChapterManagement.`);
                        await chaptermanagement.init(activeChatPath);

                        // Fetch last known viewer state
                        const viewerState = await chaptermanagement.getViewerState();
                        io.emit('chat-db-switched', { path: activeChatPath, viewerState });
                        timeline.refresh();

                        const settings = getSettings();
                        if (settings.narrative_agents?.facts?.enabled !== false) {
                            const projectName = getProjectName(); // Get project name for logging
                            Logger.log('Main', 'ProjectOperations', `Initializing FactManager for project: ${projectName} with DB: ${activeChatPath}`);
                            await initFactManager(activeChatPath);
                            Logger.log('Main', 'ProjectOperations', `FactManager initialized for project: ${projectName}`);
                        }

                        await pluginManager.executeHook('HOOK_CHAT_DB_INITIALIZED', { chatDbPath: activeChatPath });
                    } else {
                        Logger.log('Main', 'FileOperations', `Active chat DB already initialized: ${activeChatPath}. Skipping redundant switch broadcast.`);
                    }
                } else {
                    Logger.log('Main', 'FileOperations', 'No active chat DB selected. Resetting viewers.');
                    setActiveChatPathGlobal(null); // Clear global tracking
                    await chaptermanagement.close();
                    io.emit('chat-db-switched', { path: null, viewerState: null });
                }

                if (!getStaticDataManager()) {
                    Logger.warn('Main', 'FileOperations', 'StaticDataManager not available, skipping KG seeding.');
                }

                emitResponse('save-file-config-response', true);
            } else {
                emitResponse('save-file-config-response', false);
            }
        },

        async loadFileConfig(_socket) {
            Logger.log('Main', 'FileOperations', 'Load file config requested');
            const rootDirectory = getRootDirectory();
            const config = rootDirectory ? await contentManager.loadFileConfig(rootDirectory) : {};
            emitResponse('load-file-config-response', config);
        }
    };
}

module.exports = {
    createFileHandlers
};

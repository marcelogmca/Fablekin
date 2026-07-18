const {
    getAdvancedMode,
    setAdvancedMode,
    getAdvancedFiletypesShown,
    setAdvancedFiletypesShown,
    getProjectNotes,
    setProjectNotes,
    getProjectNotesVisible,
    setProjectNotesVisible
} = require('../../config/project_config_store.js');

function createPluginSocketHandlers({
    Logger,
    pluginManager,
    emitResponse,
    io,
    timeline,
    scriptSecurity,
    getProjectName,
    invalidateFrontendInjectionCache,
    contentManager,
    getRootDirectory,
    fs,
    resolvePathInsideRoot,
    isSafeExtension
}) {
    return {
        async requestPluginFileView(socket, { pluginId, modeId, filePath, isEdit }) {
            Logger.log('Main', 'Plugins', `Plugin file view requested for ${filePath} (${modeId}) from ${pluginId} (Edit: ${!!isEdit})`);
            try {
                const result = await pluginManager.provideFileView(pluginId, modeId, filePath);
                emitResponse('request-plugin-file-view-response', { ...result, filePath, modeId, isEdit });
            } catch (error) {
                Logger.error('Main', 'Plugins', 'Error providing plugin file view:', error);
                emitResponse('request-plugin-file-view-response', { success: false, error: error.message, filePath, modeId, isEdit });
            }
        },

        async requestFileConversion(socket, { filePath, targetExtension, targetMode }) {
            Logger.log('Main', 'Plugins', `File conversion requested: ${filePath} -> ${targetExtension} (Mode: ${targetMode})`);
            try {
                const rootDirectory = getRootDirectory();
                if (!rootDirectory) {
                    return emitResponse('request-file-conversion-response', { success: false, error: 'No project loaded.' });
                }

                if (!isSafeExtension(targetExtension)) {
                    Logger.error('Main', 'Plugins', 'Invalid conversion extension requested.', { targetExtension, targetMode });
                    return emitResponse('request-file-conversion-response', { success: false, error: 'Invalid target extension.' });
                }

                const oldPath = resolvePathInsideRoot(filePath, rootDirectory);
                if (!oldPath) {
                    Logger.error('Main', 'Plugins', 'Unauthorized conversion source path.', { rootDirectory, filePath });
                    return emitResponse('request-file-conversion-response', { success: false, error: 'Unauthorized file path.' });
                }

                const newPath = resolvePathInsideRoot(oldPath.replace(/\.[^/.]+$/, '') + targetExtension, rootDirectory);
                if (!newPath) {
                    Logger.error('Main', 'Plugins', 'Unauthorized conversion target path.', { rootDirectory, filePath, targetExtension });
                    return emitResponse('request-file-conversion-response', { success: false, error: 'Unauthorized conversion target.' });
                }

                const modeMetadata = pluginManager.registeredFileModes.get(targetMode) || null;
                const conversionType = modeMetadata?.conversion?.targetType || (modeMetadata?.package ? 'package' : 'file');

                // 1. Manage configuration (preserve metadata like #order)
                const currentConfig = await contentManager.loadFileConfig(rootDirectory);
                const fileMetadata = currentConfig[oldPath] || {};

                // Transfer metadata to new path, enforcing the new mode
                if (typeof fileMetadata === 'string') {
                    currentConfig[newPath] = { mode: targetMode, lockedMode: targetMode };
                } else {
                    currentConfig[newPath] = { ...fileMetadata, mode: targetMode, lockedMode: targetMode };
                }

                delete currentConfig[oldPath];

                // 2. Physical file operations
                if (conversionType === 'package') {
                    await fs.mkdir(newPath, { recursive: true });
                } else {
                    // Create an empty file first; plugins will initialize it via hook.
                    await fs.writeFile(newPath, '');
                }
                await fs.unlink(oldPath);
                await contentManager.saveFileConfig(rootDirectory, currentConfig);

                // 3. Plugin hook - allow plugins to initialize the new file (e.g. SQLite tables)
                const targetPluginId = modeMetadata ? modeMetadata.pluginId : 'unknown';

                await pluginManager.executeHook('HOOK_FILE_CONVERTED', null, {
                    oldPath,
                    newPath,
                    mode: targetMode,
                    pluginId: targetPluginId,
                    conversionType,
                    package: modeMetadata?.package || null
                });

                // 4. Refresh UI
                const directory = await contentManager.processDirectory(rootDirectory, rootDirectory, getProjectName(), pluginManager.getRegisteredFileModes());
                emitResponse('request-file-conversion-response', {
                    success: true,
                    directory: {
                        ...directory,
                        pluginModes: pluginManager.getRegisteredFileModes()
                    }
                });

                Logger.log('Main', 'Plugins', `Conversion complete: ${newPath}`);
            } catch (error) {
                Logger.error('Main', 'Plugins', 'Error during file conversion:', error);
                emitResponse('request-file-conversion-response', { success: false, error: error.message });
            }
        },

        async executeFrontendHook(socket, data) {
            const { hookName } = data;
            Logger.log('Main', 'Plugins', `Frontend requested hook execution: ${hookName}`);
            try {
                // PluginManager.executeHook uses the snapshotted currentTurnContext automatically
                await pluginManager.executeHook(hookName, null, data);

                // Broadcast the hook to all other frontend clients/plugins (passing along any metadata like turnNumber)
                io.emit('execute-frontend-hook', data);

                emitResponse('execute-frontend-hook-response', { success: true, hookName });

                // Refresh timeline after VN GUI is fully ready (latest turn is done)
                if (hookName === 'HOOK_VN_GUI_READY') {
                    timeline.refresh();
                }
            } catch (error) {
                Logger.error('Main', 'Plugins', `Error executing frontend hook ${hookName}:`, error);
                emitResponse('execute-frontend-hook-response', { success: false, error: error.message, hookName });
            }
        },

        async guiSecurityDecision(socket, { decision }) {
            Logger.log('Main', 'Plugins', 'Security decision received:', decision);
            pluginManager.resolveSecurityDecision(decision);
        },

        async approveScriptHash(socket, { hash, filePath }) {
            Logger.log('Main', 'Plugins', `Manual hash approval requested for: ${hash} (${filePath})`);
            try {
                await scriptSecurity.approveHash(hash, {
                    path: filePath,
                    project: getProjectName(),
                    manual: true
                });
                emitResponse('approve-script-hash-response', { success: true });
            } catch (error) {
                Logger.error('Main', 'Plugins', 'Error approving hash manually:', error);
                emitResponse('approve-script-hash-response', { success: false, error: error.message });
            }
        },

        async peekScriptContent(socket, { filePath }) {
            const rootDirectory = getRootDirectory();
            const safeFilePath = resolvePathInsideRoot(filePath, rootDirectory);
            if (!safeFilePath) {
                Logger.error('Main', 'Security', 'Unauthorized script peek path attempt.', { rootDirectory, filePath });
                return emitResponse('peek-script-content-response', { success: false, error: 'Unauthorized file access.' });
            }
            try {
                const content = await fs.readFile(safeFilePath, 'utf-8');
                emitResponse('peek-script-content-response', { success: true, content, filePath });
            } catch (error) {
                Logger.error('Main', 'Security', `Failed to peek script content: ${filePath}`, error);
                emitResponse('peek-script-content-response', { success: false, error: error.message });
            }
        },

        async requestGuiInterceptUi(socket, payload = {}) {
            const { interceptRunId, pluginId, interceptId } = payload;
            Logger.log('Main', 'Plugins', `GUI intercept UI requested (run=${interceptRunId || 'n/a'}, plugin=${pluginId || 'n/a'}, intercept=${interceptId || 'n/a'})`);

            try {
                const uiPayload = await pluginManager.getGuiInterceptPayload(payload);
                emitResponse('request-gui-intercept-ui-response', {
                    success: true,
                    interceptRunId,
                    pluginId,
                    interceptId,
                    ui: uiPayload
                });
            } catch (error) {
                Logger.error('Main', 'Plugins', `Failed to build GUI intercept UI for run=${interceptRunId || 'n/a'}:`, error);
                emitResponse('request-gui-intercept-ui-response', {
                    success: false,
                    interceptRunId,
                    pluginId,
                    interceptId,
                    error: error.message
                });
            }
        },

        getPluginViews(socket) {
            const views = pluginManager.getRegisteredViews();
            Logger.log('Main', 'SocketIO', `Sending ${views.length} plugin views to client.`);
            socket.emit('plugin-views', views);
        },

        async getPlugins(socket, data, callback) {
            await pluginManager.refreshPluginPreviews();
            const plugins = pluginManager.getAllPluginsMetadata();
            Logger.log('Main', 'SocketIO', `Sending ${plugins.length} plugins metadata to client.`);
            if (typeof callback === 'function') {
                callback(plugins);
            } else {
                socket.emit('get-plugins-response', plugins);
            }
        },

        async togglePluginStatus(socket, { pluginId }, callback) {
            const result = await pluginManager.togglePluginStatus(pluginId);
            if (typeof callback === 'function') {
                callback(result);
            }
            if (result.success) {
                // Invalidate injection cache - plugin roster changed, new connections
                // must re-run the hook to pick up the updated assets list.
                invalidateFrontendInjectionCache();
                // Inform ALL clients that plugin views might have changed
                io.emit('reload-plugin-tabs');
            }
        },

        getPluginSettings(socket, { pluginId }, callback) {
            const plugins = pluginManager.getAllPluginsMetadata();
            const plugin = plugins.find(p => p.id === pluginId);
            const settings = plugin ? plugin.settings : {};
            const response = { success: !!plugin, pluginId, settings };

            Logger.log('Main', 'SocketIO', `Served settings for plugin: ${pluginId}`);

            if (typeof callback === 'function') {
                callback(response);
            } else {
                socket.emit('get-plugin-settings-response', response);
            }
        },

        async savePluginSettings(socket, { pluginId, settings }, callback) {
            const result = await pluginManager.updatePluginSettings(pluginId, settings);
            if (result.success) {
                invalidateFrontendInjectionCache();
            }
            if (typeof callback === 'function') {
                callback(result);
            }
        },

        registerView(socket, { viewId, pluginId }) {
            Logger.log('Main', 'SocketIO', `View '${viewId}' (Plugin: ${pluginId || 'core'}) registered with socket ${socket.id}`);
            socket.join(`view:${viewId}`);
            if (pluginId) {
                socket.join(`plugin:${pluginId}`);
            }
        },

        async getProjectDirectives(socket, data, callback) {
            try {
                const metadata = await pluginManager.getProjectDirectivesMetadata();
                if (typeof callback === 'function') callback({ success: true, result: metadata });
                else socket.emit('get-project-directives-response', { success: true, result: metadata });
            } catch (error) {
                Logger.error('Main', 'Plugins', 'Error getting project directives:', error);
                if (typeof callback === 'function') callback({ success: false, error: error.message });
                else socket.emit('get-project-directives-response', { success: false, error: error.message });
            }
        },
        async updateProjectDirective(socket, { entityId, fieldKey, value }, callback) {
            try {
                const result = await pluginManager.updateProjectDirective(entityId, fieldKey, value);
                if (typeof callback === 'function') callback(result);
                else socket.emit('update-project-directive-response', result);
            } catch (error) {
                Logger.error('Main', 'Plugins', 'Error updating project directive:', error);
                if (typeof callback === 'function') callback({ success: false, error: error.message });
                else socket.emit('update-project-directive-response', { success: false, error: error.message });
            }
        },
        async getProjectAdvancedMode(socket, data, callback) {
            try {
                const rootDirectory = getRootDirectory();
                if (!rootDirectory) {
                    const errorResponse = { success: false, error: 'No project loaded.' };
                    if (typeof callback === 'function') callback(errorResponse);
                    else socket.emit('get-project-advanced-mode-response', errorResponse);
                    return;
                }

                const config = await contentManager.loadFileConfig(rootDirectory);
                const enabled = getAdvancedMode(config);

                if (typeof callback === 'function') callback({ success: true, enabled });
                else socket.emit('get-project-advanced-mode-response', { success: true, enabled });
            } catch (error) {
                Logger.error('Main', 'Project', 'Error getting advanced mode:', error);
                if (typeof callback === 'function') callback({ success: false, error: error.message });
                else socket.emit('get-project-advanced-mode-response', { success: false, error: error.message });
            }
        },
        async updateProjectAdvancedMode(socket, { enabled }, callback) {
            try {
                const rootDirectory = getRootDirectory();
                if (!rootDirectory) {
                    const errorResponse = { success: false, error: 'No project loaded.' };
                    if (typeof callback === 'function') callback(errorResponse);
                    else socket.emit('update-project-advanced-mode-response', errorResponse);
                    return;
                }

                const config = await contentManager.loadFileConfig(rootDirectory);
                const updatedConfig = setAdvancedMode(config, !!enabled);
                await contentManager.saveFileConfig(rootDirectory, updatedConfig);

                Logger.log('Main', 'Project', `Advanced mode updated to: ${enabled}`);
                if (typeof callback === 'function') callback({ success: true });
                else socket.emit('update-project-advanced-mode-response', { success: true });
            } catch (error) {
                Logger.error('Main', 'Project', 'Error updating advanced mode:', error);
                if (typeof callback === 'function') callback({ success: false, error: error.message });
                else socket.emit('update-project-advanced-mode-response', { success: false, error: error.message });
            }
        },
        async getProjectAdvancedFiletypesShown(socket, data, callback) {
            try {
                const rootDirectory = getRootDirectory();
                if (!rootDirectory) {
                    const errorResponse = { success: false, error: 'No project loaded.' };
                    if (typeof callback === 'function') callback(errorResponse);
                    else socket.emit('get-project-advanced-filetypes-shown-response', errorResponse);
                    return;
                }

                const config = await contentManager.loadFileConfig(rootDirectory);
                const enabled = getAdvancedFiletypesShown(config);

                if (typeof callback === 'function') callback({ success: true, enabled });
                else socket.emit('get-project-advanced-filetypes-shown-response', { success: true, enabled });
            } catch (error) {
                Logger.error('Main', 'Project', 'Error getting advanced filetypes visibility:', error);
                if (typeof callback === 'function') callback({ success: false, error: error.message });
                else socket.emit('get-project-advanced-filetypes-shown-response', { success: false, error: error.message });
            }
        },
        async updateProjectAdvancedFiletypesShown(socket, { enabled }, callback) {
            try {
                const rootDirectory = getRootDirectory();
                if (!rootDirectory) {
                    const errorResponse = { success: false, error: 'No project loaded.' };
                    if (typeof callback === 'function') callback(errorResponse);
                    else socket.emit('update-project-advanced-filetypes-shown-response', errorResponse);
                    return;
                }

                const config = await contentManager.loadFileConfig(rootDirectory);
                const updatedConfig = setAdvancedFiletypesShown(config, !!enabled);
                await contentManager.saveFileConfig(rootDirectory, updatedConfig);

                Logger.log('Main', 'Project', `Advanced filetypes visibility updated to: ${enabled}`);
                if (typeof callback === 'function') callback({ success: true });
                else socket.emit('update-project-advanced-filetypes-shown-response', { success: true });
            } catch (error) {
                Logger.error('Main', 'Project', 'Error updating advanced filetypes visibility:', error);
                if (typeof callback === 'function') callback({ success: false, error: error.message });
                else socket.emit('update-project-advanced-filetypes-shown-response', { success: false, error: error.message });
            }
        },
        async getProjectNotes(socket, data, callback) {
            try {
                const rootDirectory = getRootDirectory();
                if (!rootDirectory) {
                    const errorResponse = { success: false, error: 'No project loaded.' };
                    if (typeof callback === 'function') callback(errorResponse);
                    else socket.emit('get-project-notes-response', errorResponse);
                    return;
                }

                const config = await contentManager.loadFileConfig(rootDirectory);
                const notes = getProjectNotes(config);
                const visible = getProjectNotesVisible(config);
                const response = { success: true, notes, visible };

                if (typeof callback === 'function') callback(response);
                else socket.emit('get-project-notes-response', response);
            } catch (error) {
                Logger.error('Main', 'Project', 'Error getting project notes:', error);
                if (typeof callback === 'function') callback({ success: false, error: error.message });
                else socket.emit('get-project-notes-response', { success: false, error: error.message });
            }
        },
        async updateProjectNotes(socket, { notes, visible }, callback) {
            try {
                const rootDirectory = getRootDirectory();
                if (!rootDirectory) {
                    const errorResponse = { success: false, error: 'No project loaded.' };
                    if (typeof callback === 'function') callback(errorResponse);
                    else socket.emit('update-project-notes-response', errorResponse);
                    return;
                }

                const config = await contentManager.loadFileConfig(rootDirectory);
                let updatedConfig = config;

                if (notes !== undefined) {
                    updatedConfig = setProjectNotes(updatedConfig, typeof notes === 'string' ? notes : String(notes || ''));
                }
                if (visible !== undefined) {
                    updatedConfig = setProjectNotesVisible(updatedConfig, !!visible);
                }

                await contentManager.saveFileConfig(rootDirectory, updatedConfig);
                const response = {
                    success: true,
                    notes: getProjectNotes(updatedConfig),
                    visible: getProjectNotesVisible(updatedConfig)
                };

                if (typeof callback === 'function') callback(response);
                else socket.emit('update-project-notes-response', response);
            } catch (error) {
                Logger.error('Main', 'Project', 'Error updating project notes:', error);
                if (typeof callback === 'function') callback({ success: false, error: error.message });
                else socket.emit('update-project-notes-response', { success: false, error: error.message });
            }
        }
    };
}

module.exports = {
    createPluginSocketHandlers
};

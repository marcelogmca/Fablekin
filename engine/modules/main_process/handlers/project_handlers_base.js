const { getProjectMetadata, setProjectMetadata } = require('../../config/project_config_store.js');

function createProjectHandlersBase({
    fs,
    path,
    projectsRoot,
    coreFolders,
    contentManager,
    chaptermanagement,
    emitResponse,
    getProjectName,
    getStaticDataManager,
    slugifyProjectName,
    resolveChildInsideRoot,
    isSafePathSegment,
    Logger
}) {
    return {
        async getAllProjects(_socket) {
            try {
                const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
                const projects = [];
                
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const slug = entry.name;
                        const projectPath = path.join(projectsRoot, slug);
                        let name = slug;

                        try {
                            const config = await contentManager.loadFileConfig(projectPath);
                            const metadata = getProjectMetadata(config);
                            if (metadata.player && metadata.player.projectName) name = metadata.player.projectName;
                            const parsedLastOpened = Number(metadata.last_opened_at);
                            const lastOpenedAt = Number.isFinite(parsedLastOpened) ? parsedLastOpened : 0;
                            projects.push({ slug, name, lastOpenedAt });
                        } catch {
                            // Fallback to slug if config reading fails
                            projects.push({ slug, name, lastOpenedAt: 0 });
                        }
                    }
                }

                projects.sort((a, b) => {
                    if (b.lastOpenedAt !== a.lastOpenedAt) return b.lastOpenedAt - a.lastOpenedAt;
                    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                });

                emitResponse('get-all-projects-response', { success: true, projects });
            } catch (error) {
                Logger.error('Main', 'ProjectMgmt', 'Error getting all projects', error);
                emitResponse('get-all-projects-response', { success: false, error: error.message });
            }
        },

        async createNewProject(socket, { projectName }) {
            const safeName = slugifyProjectName(projectName);
            if (!safeName) {
                return emitResponse('create-new-project-response', { success: false, error: 'Invalid project name. Please use alphanumeric characters.' });
            }
            try {
                const projectPath = path.join(projectsRoot, safeName);
                try {
                    await fs.access(projectPath);
                    return emitResponse('create-new-project-response', { success: false, error: 'Project already exists.' });
                } catch {
                    // Directory does not exist, proceed
                }

                await fs.mkdir(projectPath);

                // Create core directories based on central config
                for (const folderName of Object.keys(coreFolders.CORE_FOLDER_MAP)) {
                    await fs.mkdir(path.join(projectPath, folderName));
                }

                // Create asset directories based on central config
                await fs.mkdir(path.join(projectPath, 'assets'));
                for (const assetFolder of coreFolders.ASSET_FOLDERS) {
                    await fs.mkdir(path.join(projectPath, assetFolder));
                }

                // Initialize config with the proper project name and first-time flag in metadata
                let initialConfig = setProjectMetadata({}, {
                    player: { 
                        projectName: projectName,
                        firstTimeLoad: true // Flag for initial tab switch
                    }
                });

                // Set initial file modes for placeholders
                // Note: These must use backslashes as keys to match the directory processor's behavior on Windows
                initialConfig["1_Directives\\directives.md"] = { mode: "full", order: 100 };
                initialConfig["2_Lore_Book\\Lore_Placeholder.md"] = { mode: "full", order: 200 };
                initialConfig["2_Lore_Book\\Intro_Placeholder.md"] = { mode: "intro", order: 300 };
                initialConfig["3_Chronicles\\Save 1.db"] = { mode: "chat", order: 100 };

                await contentManager.saveFileConfig(projectPath, initialConfig);

                // --- NEW PROJECT PLACEHOLDERS ---
                Logger.log('Main', 'ProjectMgmt', `Creating placeholder files for project: ${projectName}`);
                
                // 1. Copy Directives Template
                try {
                    const templateDir = path.join(__dirname, '..', '..', '..', 'prompts', 'templates');
                    const templatePath = path.join(templateDir, 'directives.md');
                    const targetDirectivesPath = path.join(projectPath, '1_Directives', 'directives.md');
                    
                    await fs.copyFile(templatePath, targetDirectivesPath);
                    Logger.log('Main', 'ProjectMgmt', '✓ Directives template copied.');
                } catch (err) {
                    Logger.warn('Main', 'ProjectMgmt', `Could not copy directives template: ${err.message}`);
                }

                // 2. Create Lore Book Placeholders
                try {
                    const lorePlaceholder = `# Lore Placeholder\nThis is a placeholder for your story's lore. Describe your world, its history, and its inhabitants here.`;
                    const introPlaceholder = `# Introduction\nSet the stage for your adventure. Who is the protagonist? What is their immediate goal?`;
                    
                    await fs.writeFile(path.join(projectPath, '2_Lore_Book', 'Lore_Placeholder.md'), lorePlaceholder);
                    await fs.writeFile(path.join(projectPath, '2_Lore_Book', 'Intro_Placeholder.md'), introPlaceholder);
                    Logger.log('Main', 'ProjectMgmt', '✓ Lore Book placeholders created.');
                } catch (err) {
                    Logger.warn('Main', 'ProjectMgmt', `Could not create lore placeholders: ${err.message}`);
                }

                // 3. Auto-create "Save 1.db"
                try {
                    const savePath = path.join(projectPath, '3_Chronicles', 'Save 1.db');
                    await chaptermanagement.init(savePath);
                    await chaptermanagement.close(); // Release lock
                    Logger.log('Main', 'ProjectMgmt', '✓ Save 1.db initialized.');
                } catch (err) {
                    Logger.warn('Main', 'ProjectMgmt', `Could not initialize Save 1.db: ${err.message}`);
                }
                // -------------------------------
                
                emitResponse('create-new-project-response', { success: true, projectName });
            } catch (error) {
                Logger.error('Main', 'ProjectMgmt', 'Error creating new project', error);
                emitResponse('create-new-project-response', { success: false, error: error.message });
            }
        },

        async getCoreFolders(_socket) {
            emitResponse('get-core-folders-response', { success: true, coreFolders: coreFolders.CORE_FOLDER_MAP });
        },

        async deleteProject(socket, { projectName }) {
            try {
                if (!isSafePathSegment(projectName)) {
                    Logger.error('Main', 'ProjectMgmt', 'Invalid project delete path segment.', { projectName });
                    return emitResponse('delete-project-response', { success: false, error: 'Invalid project name.' });
                }

                const projectPath = resolveChildInsideRoot(projectsRoot, projectName);
                if (!projectPath) {
                    Logger.error('Main', 'ProjectMgmt', 'Project delete target outside projects root.', { projectsRoot, projectName });
                    return emitResponse('delete-project-response', { success: false, error: 'Invalid project name.' });
                }

                // Check if project exists
                await fs.access(projectPath);

                // If the project is currently active, close the DB connection
                if (typeof getProjectName === 'function' && getProjectName() === projectName) {
                    if (typeof getStaticDataManager === 'function') {
                        const sdm = getStaticDataManager();
                        if (sdm) await sdm.close();
                    }
                }

                // Use fs.rm for recursive deletion of the directory (includes internal config)
                await fs.rm(projectPath, { recursive: true, force: true });

                emitResponse('delete-project-response', { success: true, projectName });
            } catch (error) {
                Logger.error('Main', 'ProjectMgmt', `Error deleting project: ${projectName}`, error);
                emitResponse('delete-project-response', { success: false, error: error.message });
            }
        },

        async renameProject(socket, { oldName, newName }) {
            const safeNewName = slugifyProjectName(newName);
            if (!safeNewName) {
                return emitResponse('rename-project-response', { success: false, error: 'Invalid new project name.' });
            }
            try {
                const oldPath = path.join(projectsRoot, oldName);
                const newPath = path.join(projectsRoot, safeNewName);

                // Check if old project exists
                await fs.access(oldPath);

                // Check if new project already exists
                try {
                    await fs.access(newPath);
                    return emitResponse('rename-project-response', { success: false, error: 'Target project name already exists.' });
                } catch {
                    // Proceed
                }

                // If the project is currently active, close the DB connection
                if (typeof getProjectName === 'function' && getProjectName() === oldName) {
                    if (typeof getStaticDataManager === 'function') {
                        const sdm = getStaticDataManager();
                        if (sdm) await sdm.close();
                    }
                }

                // Rename directory
                await fs.rename(oldPath, newPath);

                // Rename .db file and sidecars inside the project folder
                try {
                    const files = await fs.readdir(newPath);
                    const lowerOldName = oldName.toLowerCase();
                    const safeOldName = slugifyProjectName(oldName);
                    const safeNewName = slugifyProjectName(newName);
                    
                    for (const file of files) {
                        const lowerFile = file.toLowerCase();
                        // Match either the literal lowercase old name or the slugified old name
                        if (lowerFile.startsWith(lowerOldName + '.db') || (safeOldName !== lowerOldName && lowerFile.startsWith(safeOldName + '.db'))) {
                            // Determine where the extension starts
                            // We need to be careful with the split point
                            let splitIndex = -1;
                            if (lowerFile.startsWith(lowerOldName + '.db')) splitIndex = oldName.length;
                            else splitIndex = safeOldName.length;

                            const extension = file.slice(splitIndex);
                            const newFileName = safeNewName + extension;
                            await fs.rename(path.join(newPath, file), path.join(newPath, newFileName));
                            Logger.log('Main', 'ProjectMgmt', `Renamed internal project DB file: ${file} -> ${newFileName}`);
                        }
                    }
                } catch (dbErr) {
                    Logger.warn('Main', 'ProjectMgmt', `Internal .db migration skipped or failed: ${dbErr.message}`);
                }

                // Rename .config file if it exists inside the project folder
                try {
                    const internalOldConfigPath = path.join(newPath, `${oldName}.config`);
                    const internalNewConfigPath = path.join(newPath, `${safeNewName}.config`);

                    await fs.access(internalOldConfigPath);
                    await fs.rename(internalOldConfigPath, internalNewConfigPath);

                    // Update projectName inside the .config file
                    const config = await contentManager.loadFileConfig(newPath); // loadFileConfig takes the project path
                    const metadata = getProjectMetadata(config);
                    const player = (metadata.player && typeof metadata.player === 'object') ? metadata.player : {};
                    player.projectName = newName;
                    metadata.player = player;
                    const updatedConfig = setProjectMetadata(config, metadata);
                    await contentManager.saveFileConfig(newPath, updatedConfig);
                } catch {
                    // If .config doesn't exist, we should probably create one anyway during rename
                    // to ensure the proper name is tracked from now on.
                    try {
                        const config = setProjectMetadata({}, { player: { projectName: newName } });
                        await contentManager.saveFileConfig(newPath, config);
                    } catch (innerErr) {
                        Logger.warn('Main', 'ProjectMgmt', `Project .config update failed during rename: ${innerErr.message}`);
                    }
                }

                emitResponse('rename-project-response', { success: true, oldName, newName });
            } catch (error) {
                Logger.error('Main', 'ProjectMgmt', `Error renaming project: ${oldName} to ${newName}`, error);
                emitResponse('rename-project-response', { success: false, error: error.message });
            }
        }
    };
}

module.exports = {
    createProjectHandlersBase
};

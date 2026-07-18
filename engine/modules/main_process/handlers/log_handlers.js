function createLogHandlers({ fs, logsDir, getProjectName, settings, Logger, emitResponse, resolveChildInsideRoot, isSafePathSegment }) {
    return {
        async getAllLogs(socket, { projectName, offset = 0, limit = 24 }) {
            Logger.log('Main', 'LogInspector', `Get all logs requested for project: ${projectName}`);
            if (!projectName) {
                emitResponse('get-all-logs-response', { success: false, error: 'No project specified.' });
                return;
            }
            if (!isSafePathSegment(projectName)) {
                Logger.error('Main', 'LogInspector', 'Invalid log project path segment.', { projectName });
                emitResponse('get-all-logs-response', { success: false, error: 'Invalid project name.' });
                return;
            }
            try {
                const requestedOffset = Math.max(parseInt(offset, 10) || 0, 0);
                const requestedLimit = Math.min(Math.max(parseInt(limit, 10) || 24, 1), 100);
                const projectLogDir = resolveChildInsideRoot(logsDir, projectName);
                const systemLogDir = resolveChildInsideRoot(logsDir, 'system');
                if (!projectLogDir || !systemLogDir) {
                    emitResponse('get-all-logs-response', { success: false, error: 'Invalid log path.' });
                    return;
                }

                await fs.mkdir(projectLogDir, { recursive: true });
                await fs.mkdir(systemLogDir, { recursive: true });

                const projectFiles = await fs.readdir(projectLogDir);
                const systemFiles = await fs.readdir(systemLogDir);

                const filter = (file) =>
                    (file.startsWith('turn_') || file.startsWith('system_')) && file.endsWith('.json') ||
                    (file.startsWith('console_') && file.endsWith('.log'));

                const projectLogFiles = projectFiles
                    .filter(filter)
                    .map(f => ({ filename: f, projectName }));

                const systemLogFiles = systemFiles
                    .filter(filter)
                    .map(f => ({ filename: f, projectName: 'system' }));

                const getFileTime = (filename) => {
                    const match = filename.match(/^(?:console_session_|console_|turn_|system_)?(\d+)\.(?:json|log)$/);
                    return match ? parseInt(match[1], 10) || 0 : 0;
                };

                const sortByLogTime = (a, b) => {
                    const timeA = getFileTime(a.filename);
                    const timeB = getFileTime(b.filename);
                    if (timeB !== timeA) return timeB - timeA;
                    return a.filename.localeCompare(b.filename);
                };

                const allFilesRaw = [
                    ...projectLogFiles.sort(sortByLogTime),
                    ...systemLogFiles.sort(sortByLogTime)
                ];
                const filteredFiles = [];
                let nextOffset = allFilesRaw.length;
                let hasMore = false;

                for (let index = requestedOffset; index < allFilesRaw.length; index++) {
                    const fileObj = allFilesRaw[index];
                    const filePath = resolveChildInsideRoot(logsDir, fileObj.projectName, fileObj.filename);
                    if (!filePath) {
                        Logger.error('Main', 'LogInspector', 'Skipping invalid resolved log path.', fileObj);
                        continue;
                    }
                    try {
                        const stats = await fs.stat(filePath);
                        if (stats.size === 0) continue; // Skip empty files

                        const isSystemJson = fileObj.filename.startsWith('system_') && fileObj.filename.endsWith('.json');
                        if (isSystemJson) {
                            const content = await fs.readFile(filePath, 'utf-8');
                            const trimmed = content.trim();

                            if (isSystemJson && (trimmed === '{}' || trimmed === '')) continue;
                        }

                        const lastFile = filteredFiles[filteredFiles.length - 1];
                        const isSameTurnGroup = lastFile && getFileTime(lastFile.filename) === getFileTime(fileObj.filename);
                        if (filteredFiles.length >= requestedLimit && !isSameTurnGroup) {
                            hasMore = true;
                            nextOffset = index;
                            break;
                        }

                        filteredFiles.push(fileObj);
                    } catch (err) {
                        Logger.error('Main', 'LogInspector', `Error stat'ing log file ${filePath}`, err);
                    }
                }

                if (!hasMore && nextOffset === allFilesRaw.length) {
                    nextOffset = allFilesRaw.length;
                }

                emitResponse('get-all-logs-response', {
                    success: true,
                    files: filteredFiles,
                    projectName,
                    offset: requestedOffset,
                    nextOffset,
                    hasMore
                });
            } catch (error) {
                if (error.code === 'ENOENT') {
                    emitResponse('get-all-logs-response', { success: true, files: [], projectName, offset: 0, nextOffset: 0, hasMore: false });
                } else {
                    Logger.error('Main', 'LogInspector', 'Error getting log files', error);
                    emitResponse('get-all-logs-response', { success: false, error: error.message });
                }
            }
        },

        async getLogContent(socket, { projectName, filename }) {
            Logger.log('Main', 'LogInspector', 'Get log content requested for', { projectName, filename });
            if (!projectName || !filename) {
                emitResponse('get-log-content-response', { success: false, error: 'Invalid project or filename provided.' });
                return;
            }
            if (!isSafePathSegment(projectName) || !isSafePathSegment(filename)) {
                Logger.error('Main', 'LogInspector', 'Invalid log content path segment.', { projectName, filename });
                emitResponse('get-log-content-response', { success: false, error: 'Invalid project or filename provided.' });
                return;
            }
            try {
                const filePath = resolveChildInsideRoot(logsDir, projectName, filename);
                if (!filePath) {
                    emitResponse('get-log-content-response', { success: false, error: 'Invalid log path.', filename: filename });
                    return;
                }

                const content = await fs.readFile(filePath, 'utf-8');
                let data;
                if (filename.endsWith('.json')) {
                    data = JSON.parse(content);
                } else {
                    data = content;
                }
                emitResponse('get-log-content-response', { success: true, filename: filename, data: data, projectName: projectName });
            } catch (error) {
                Logger.error('Main', 'LogInspector', 'Error getting log content for ' + filename, error);
                emitResponse('get-log-content-response', { success: false, error: error.message, filename: filename });
            }
        },

        async getWaterfallData(socket, { projectName, filename }) {
            Logger.log('Main', 'LogInspector', 'Get waterfall data requested for', { projectName, filename });
            if (!projectName || !filename || !filename.startsWith('console_')) {
                emitResponse('get-waterfall-data-response', { success: false, error: 'Invalid project or console log filename provided.' });
                return;
            }
            if (!isSafePathSegment(projectName) || !isSafePathSegment(filename)) {
                Logger.error('Main', 'LogInspector', 'Invalid waterfall path segment.', { projectName, filename });
                emitResponse('get-waterfall-data-response', { success: false, error: 'Invalid project or console log filename provided.' });
                return;
            }
            try {
                const filePath = resolveChildInsideRoot(logsDir, projectName, filename);
                if (!filePath) {
                    emitResponse('get-waterfall-data-response', { success: false, error: 'Invalid log path.', filename });
                    return;
                }

                const content = await fs.readFile(filePath, 'utf-8');
                const turnLogMatch = filename.match(/^console_(\d+)\.log$/);
                let turnLog = null;

                if (turnLogMatch) {
                    const turnLogFilename = `turn_${turnLogMatch[1]}.json`;
                    const turnLogPath = resolveChildInsideRoot(logsDir, projectName, turnLogFilename);
                    if (turnLogPath) {
                        try {
                            const turnLogContent = await fs.readFile(turnLogPath, 'utf-8');
                            turnLog = {
                                filename: turnLogFilename,
                                data: JSON.parse(turnLogContent)
                            };
                        } catch (turnLogError) {
                            if (turnLogError.code !== 'ENOENT') {
                                Logger.warn('Main', 'LogInspector', 'Unable to load matching turn log for waterfall.', {
                                    projectName,
                                    filename,
                                    turnLogFilename,
                                    error: turnLogError.message
                                });
                            }
                        }
                    }
                }

                // Split content into turns
                // A turn starts with [TURN GEN START]
                const lines = content.split('\n');
                const turns = [];
                let currentTurn = null;

                for (const line of lines) {
                    if (line.includes('[TURN GEN START]')) {
                        if (currentTurn) turns.push(currentTurn);
                        currentTurn = {
                            lines: [line],
                            startTime: line.match(/\[(.*?)\]/)?.[1] || null
                        };
                    } else if (currentTurn) {
                        currentTurn.lines.push(line);
                    }
                }
                if (currentTurn) turns.push(currentTurn);

                emitResponse('get-waterfall-data-response', {
                    success: true,
                    filename,
                    turns,
                    projectName,
                    turnLog,
                    consoleLog: {
                        content,
                        lineCount: lines.length,
                        sizeBytes: Buffer.byteLength(content, 'utf8')
                    }
                });
            } catch (error) {
                Logger.error('Main', 'LogInspector', 'Error getting waterfall data for ' + filename, error);
                emitResponse('get-waterfall-data-response', { success: false, error: error.message, filename });
            }
        },

        async getLogProjects(_socket) {
            try {
                const logsRoot = logsDir;
                await fs.mkdir(logsRoot, { recursive: true });
                const entries = await fs.readdir(logsRoot, { withFileTypes: true });
                const directories = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
                emitResponse('get-log-projects-response', { success: true, projects: directories });
            } catch (error) {
                Logger.error('Main', 'LogInspector', 'Failed to list log directories', error);
                emitResponse('get-log-projects-response', { success: false, error: error.message });
            }
        },

        async getCurrentProjectName(_socket) {
            Logger.log('Main', 'ProjectOperations', `Get current project name requested: ${getProjectName()}`);
            emitResponse('get-current-project-name-response', { projectName: getProjectName() });
        },

        async getModelPricing(_socket) {
            try {
                emitResponse('get-model-pricing-response', { success: true, pricing: settings.infrastructure?.model_costs });
            } catch (error) {
                emitResponse('get-model-pricing-response', { success: false, error: error.message });
            }
        }
    };
}

module.exports = {
    createLogHandlers
};

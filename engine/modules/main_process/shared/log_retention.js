const path = require('path');

const DEFAULT_LOG_RETENTION_DAYS = 30;
const LOG_RETENTION_DISABLED_VALUES = new Set([false, 'false', 'off', 'disabled', 'never']);

function getLogRetentionConfig(settings = {}) {
    const loggingSettings = settings?.infrastructure?.logging || {};
    const enabledValue = loggingSettings.retention_enabled;
    const retentionEnabled = !LOG_RETENTION_DISABLED_VALUES.has(enabledValue);
    const configuredDays = Number(loggingSettings.retention_days);
    const retentionDays = Number.isFinite(configuredDays) && configuredDays > 0
        ? configuredDays
        : DEFAULT_LOG_RETENTION_DAYS;

    return {
        enabled: retentionEnabled,
        days: retentionDays
    };
}

function getTimestampFromLogFilename(filename) {
    const match = String(filename || '').match(/^(?:console_session_|console_|turn_|system_)?(\d+)\.(?:json|log)$/);
    if (!match) return null;

    const timestamp = Number(match[1]);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function isManagedLogFile(filename) {
    const text = String(filename || '');
    return (
        (text.startsWith('turn_') || text.startsWith('system_')) && text.endsWith('.json')
    ) || (
        (text.startsWith('console_') || text.startsWith('console_session_')) && text.endsWith('.log')
    );
}

function resolveInsideRoot(targetPath, rootPath) {
    const resolvedRoot = path.resolve(rootPath);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    const isInside = relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
    return isInside ? resolvedTarget : null;
}

async function removeEmptyLogDirectories({ fs, logsDir, dirPath }) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const childDir = resolveInsideRoot(path.join(dirPath, entry.name), logsDir);
        if (!childDir) continue;
        await removeEmptyLogDirectories({ fs, logsDir, dirPath: childDir });
    }

    if (path.resolve(dirPath) === path.resolve(logsDir)) return;

    const remainingEntries = await fs.readdir(dirPath);
    if (remainingEntries.length === 0) {
        await fs.rmdir(dirPath);
    }
}

async function cleanupOldLogs({
    fs,
    logsDir,
    settings,
    Logger,
    now = Date.now()
}) {
    const retention = getLogRetentionConfig(settings);
    if (!retention.enabled) {
        Logger?.log?.('Main', 'LogRetention', 'Log retention cleanup disabled by settings.');
        return { enabled: false, days: retention.days, deletedFiles: 0, errors: 0 };
    }

    const resolvedLogsDir = path.resolve(logsDir);
    const cutoffMs = now - (retention.days * 24 * 60 * 60 * 1000);
    let deletedFiles = 0;
    let errors = 0;

    async function visitDirectory(dirPath) {
        let entries = [];
        try {
            entries = await fs.readdir(dirPath, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') return;
            errors++;
            Logger?.warn?.('Main', 'LogRetention', `Failed to read log directory: ${dirPath}`, error);
            return;
        }

        for (const entry of entries) {
            const entryPath = resolveInsideRoot(path.join(dirPath, entry.name), resolvedLogsDir);
            if (!entryPath) {
                errors++;
                Logger?.warn?.('Main', 'LogRetention', `Skipping path outside logs root: ${path.join(dirPath, entry.name)}`);
                continue;
            }

            if (entry.isDirectory()) {
                await visitDirectory(entryPath);
                continue;
            }

            if (!entry.isFile() || !isManagedLogFile(entry.name)) continue;

            try {
                const stats = await fs.stat(entryPath);
                const logTimestamp = getTimestampFromLogFilename(entry.name) || stats.mtimeMs;
                if (logTimestamp >= cutoffMs) continue;

                await fs.unlink(entryPath);
                deletedFiles++;
            } catch (error) {
                errors++;
                Logger?.warn?.('Main', 'LogRetention', `Failed to delete old log: ${entryPath}`, error);
            }
        }
    }

    await visitDirectory(resolvedLogsDir);

    try {
        await removeEmptyLogDirectories({ fs, logsDir: resolvedLogsDir, dirPath: resolvedLogsDir });
    } catch (error) {
        errors++;
        Logger?.warn?.('Main', 'LogRetention', 'Failed to remove empty log directories.', error);
    }

    Logger?.log?.('Main', 'LogRetention', `Log retention cleanup complete. Days=${retention.days}, deleted=${deletedFiles}, errors=${errors}.`);
    return { enabled: true, days: retention.days, deletedFiles, errors };
}

module.exports = {
    DEFAULT_LOG_RETENTION_DAYS,
    getLogRetentionConfig,
    getTimestampFromLogFilename,
    isManagedLogFile,
    cleanupOldLogs
};

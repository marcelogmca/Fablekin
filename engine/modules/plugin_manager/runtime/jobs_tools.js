const ACTIVE_JOBS = new Map();

class PluginJobCancelledError extends Error {
    constructor(message, details = {}) {
        super(message || 'Plugin job cancelled.');
        this.name = 'PluginJobCancelledError';
        this.code = 'PLUGIN_JOB_CANCELLED';
        this.isCancelled = true;
        this.pluginId = details.pluginId || null;
        this.jobId = details.jobId || null;
        this.reason = details.reason || 'cancelled';
    }
}

function slugify(value, fallback = 'job') {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
    return slug || fallback;
}

function clampProgress(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(0, Math.min(100, Math.round(numeric)));
}

function nowId() {
    return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function createAbortController() {
    return typeof globalThis.AbortController === 'function'
        ? new globalThis.AbortController()
        : null;
}

function normalizeStartArgs(nameOrOptions, options = {}) {
    if (nameOrOptions && typeof nameOrOptions === 'object' && !Array.isArray(nameOrOptions)) {
        const merged = {
            ...nameOrOptions,
            ...((options && typeof options === 'object') ? options : {})
        };
        return {
            name: String(merged.name || merged.title || merged.label || merged.id || 'Plugin job'),
            options: merged
        };
    }

    const normalizedOptions = (options && typeof options === 'object') ? { ...options } : {};
    return {
        name: String(nameOrOptions || normalizedOptions.name || normalizedOptions.title || normalizedOptions.id || 'Plugin job'),
        options: normalizedOptions
    };
}

function isCancelError(error) {
    return !!(error && (error.isCancelled === true || error.code === 'PLUGIN_JOB_CANCELLED'));
}

function buildScopeKey(pluginId, snapshot, scope) {
    if (typeof scope === 'function') {
        const custom = scope(snapshot);
        return `custom:${String(custom || 'default')}`;
    }

    if (scope && typeof scope === 'object') {
        return `custom:${JSON.stringify(scope)}`;
    }

    const normalizedScope = String(scope || 'turn').trim().toLowerCase();
    if (normalizedScope === 'global') return 'global';
    if (normalizedScope === 'plugin') return `plugin:${pluginId}`;
    if (normalizedScope === 'project') return `project:${snapshot.projectKey || snapshot.projectName || 'default_project'}`;
    if (normalizedScope === 'turn' || normalizedScope === 'context') {
        const projectKey = snapshot.projectKey || snapshot.projectName || 'default_project';
        const turnKey = snapshot.turnKey || String(snapshot.turnNumber || 0);
        const sceneMode = snapshot.sceneMode || 'mainline';
        return `turn:${projectKey}:${turnKey}:${sceneMode}`;
    }

    return `custom:${normalizedScope}`;
}

function shouldTreatScopeAsStale(scope, startSnapshot, currentSnapshot) {
    const normalizedScope = String(scope || 'turn').trim().toLowerCase();
    if (!currentSnapshot) return false;
    if (normalizedScope === 'global' || normalizedScope === 'plugin') return false;

    const startProject = startSnapshot.projectKey || startSnapshot.projectName;
    const currentProject = currentSnapshot.projectKey || currentSnapshot.projectName;

    if (normalizedScope === 'project') {
        return !!startProject && !!currentProject && startProject !== currentProject;
    }

    if (normalizedScope === 'turn' || normalizedScope === 'context') {
        if (startProject && currentProject && startProject !== currentProject) return true;
        return String(startSnapshot.turnKey || startSnapshot.turnNumber || '') !== String(currentSnapshot.turnKey || currentSnapshot.turnNumber || '');
    }

    return false;
}

function buildJobsTools({
    pluginManager,
    pluginId,
    context,
    resolveContextSnapshot,
    sendUiNotification,
    logger
}) {
    const resolveSnapshot = (sourceContext = context) => {
        if (typeof resolveContextSnapshot === 'function') {
            return resolveContextSnapshot(sourceContext || context);
        }
        return {
            projectName: sourceContext?.projectName || 'default_project',
            projectKey: String(sourceContext?.projectName || 'default_project').toLowerCase(),
            turnNumber: sourceContext?.turnNumber || 0,
            turnKey: String(sourceContext?.turnNumber || 0),
            sceneMode: sourceContext?.sceneMode || 'mainline'
        };
    };

    const notify = (state, payload = {}) => {
        if (state.silent || typeof sendUiNotification !== 'function') return;
        sendUiNotification({
            id: state.notificationId,
            message: payload.message || state.message || state.name,
            progress: payload.progress !== undefined ? payload.progress : state.progress,
            blocking: state.blocking,
            priority: state.priority,
            color: payload.color || state.color,
            icon: state.icon,
            ...payload
        });
    };

    const clearNotification = (state) => {
        if (state.silent || typeof sendUiNotification !== 'function') return;
        sendUiNotification({ id: state.notificationId, type: 'clear' });
    };

    const unregister = (state) => {
        ACTIVE_JOBS.delete(state.registryKey);
    };

    const markCancelled = (state, reason = 'cancelled', options = {}) => {
        if (state.status === 'complete' || state.status === 'failed' || state.status === 'cancelled') return;
        state.status = 'cancelled';
        state.cancelled = true;
        state.cancelReason = reason;
        state.updatedAt = Date.now();
        if (state.controller && !state.controller.signal.aborted) {
            state.controller.abort(reason);
        }

        if (options.notify !== false) {
            const message = options.message || state.cancelMessage || `${state.name} cancelled`;
            notify(state, {
                message,
                progress: state.progress,
                color: options.color || state.cancelColor || state.color,
                timeout: options.timeout || state.timeout || 3000
            });
        }

        unregister(state);
        if (options.clear === true) clearNotification(state);
    };

    const start = (nameOrOptions, options = {}) => {
        const { name, options: startOptions } = normalizeStartArgs(nameOrOptions, options);
        const startSnapshot = resolveSnapshot(context);
        const scope = startOptions.scope || 'turn';
        const scopeKey = buildScopeKey(pluginId, startSnapshot, scope);
        const jobId = String(startOptions.id || slugify(name, 'job'));
        let registryKey = `${pluginId}:${scopeKey}:${jobId}`;
        const existing = ACTIVE_JOBS.get(registryKey);

        if (existing && (startOptions.replace === true || startOptions.cancelPrevious === true)) {
            markCancelled(existing, startOptions.cancelPreviousReason || 'replaced', { notify: false, clear: true });
        } else if (existing) {
            registryKey = `${registryKey}:${nowId()}`;
        }

        const controller = createAbortController();
        const state = {
            id: jobId,
            registryKey,
            notificationId: startOptions.notificationId || `${pluginId}_job_${slugify(jobId)}_${nowId()}`,
            pluginId,
            name,
            scope,
            scopeKey,
            startSnapshot,
            controller,
            status: 'running',
            cancelled: false,
            cancelReason: null,
            progress: clampProgress(startOptions.progress) ?? 0,
            message: startOptions.message || name,
            blocking: startOptions.blocking === true,
            priority: Number.isFinite(Number(startOptions.priority)) ? Number(startOptions.priority) : 45,
            color: startOptions.color || null,
            icon: startOptions.icon || null,
            silent: startOptions.silent === true || startOptions.notify === false,
            logEnabled: startOptions.log !== false,
            timeout: Number.isFinite(Number(startOptions.timeout)) ? Number(startOptions.timeout) : 3000,
            allowStale: startOptions.allowStale === true,
            cancelOnStale: startOptions.cancelOnStale !== false,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        ACTIVE_JOBS.set(registryKey, state);
        if (startOptions.notify !== false) notify(state);

        if (logger && typeof logger.log === 'function' && state.logEnabled) {
            logger.log(`Plugin:${pluginId}`, 'Jobs', `Started job '${name}' (${jobId}).`, 'start');
        }

        const job = {
            id: state.id,
            name: state.name,
            scope: state.scope,
            scopeKey: state.scopeKey,
            notificationId: state.notificationId,
            startedAt: state.createdAt,
            get status() {
                return state.status;
            },
            get progressValue() {
                return state.progress;
            },
            get signal() {
                return state.controller?.signal || null;
            },
            get cancelToken() {
                return {
                    signal: state.controller?.signal || null,
                    get cancelled() {
                        return job.isCancelled();
                    },
                    get reason() {
                        return job.isCancelled() ? state.cancelReason : null;
                    },
                    isCancelled: () => job.isCancelled(),
                    throwIfCancelled: () => job.throwIfCancelled()
                };
            },
            progress(progressOrMessage, messageOrOptions = null, maybeOptions = {}) {
                if (state.status !== 'running') return job;

                let nextProgress = state.progress;
                let nextMessage = state.message;
                let notifyOptions = {};

                if (typeof progressOrMessage === 'number') {
                    nextProgress = clampProgress(progressOrMessage) ?? state.progress;
                    if (typeof messageOrOptions === 'string') {
                        nextMessage = messageOrOptions;
                    } else if (messageOrOptions && typeof messageOrOptions === 'object') {
                        notifyOptions = messageOrOptions;
                    }
                    if (maybeOptions && typeof maybeOptions === 'object') {
                        notifyOptions = { ...notifyOptions, ...maybeOptions };
                    }
                } else if (typeof progressOrMessage === 'string') {
                    nextMessage = progressOrMessage;
                    if (messageOrOptions && typeof messageOrOptions === 'object') {
                        notifyOptions = messageOrOptions;
                    }
                } else if (progressOrMessage && typeof progressOrMessage === 'object') {
                    notifyOptions = progressOrMessage;
                    if (notifyOptions.progress !== undefined) {
                        nextProgress = clampProgress(notifyOptions.progress) ?? state.progress;
                    }
                    if (notifyOptions.message) nextMessage = notifyOptions.message;
                }

                state.progress = nextProgress;
                state.message = nextMessage;
                state.updatedAt = Date.now();
                notify(state, { ...notifyOptions, progress: nextProgress, message: nextMessage });
                return job;
            },
            isStale() {
                if (state.allowStale) return false;
                if (typeof startOptions.isStale === 'function') {
                    return startOptions.isStale({
                        startSnapshot: state.startSnapshot,
                        currentSnapshot: resolveSnapshot(pluginManager?.currentTurnContext || context),
                        context,
                        pluginManager
                    }) === true;
                }
                return shouldTreatScopeAsStale(state.scope, state.startSnapshot, resolveSnapshot(pluginManager?.currentTurnContext || context));
            },
            isCurrent() {
                return !job.isStale();
            },
            isCancelled() {
                if (state.cancelled || state.controller?.signal?.aborted) return true;
                if (state.cancelOnStale && job.isStale()) {
                    markCancelled(state, 'stale_context', { notify: false, clear: true });
                    return true;
                }
                return false;
            },
            throwIfCancelled() {
                if (!job.isCancelled()) return;
                throw new PluginJobCancelledError(`${state.name} cancelled: ${state.cancelReason || 'cancelled'}`, {
                    pluginId,
                    jobId: state.id,
                    reason: state.cancelReason || 'cancelled'
                });
            },
            cancel(reason = 'cancelled', cancelOptions = {}) {
                markCancelled(state, reason, cancelOptions);
                return true;
            },
            complete(message = null, completeOptions = {}) {
                if (state.status === 'complete' || state.status === 'failed' || state.status === 'cancelled') return job;
                state.status = 'complete';
                state.progress = 100;
                state.message = message || state.completeMessage || state.name;
                state.updatedAt = Date.now();

                if (completeOptions.notify === false || (!message && completeOptions.message === undefined && completeOptions.notify !== true)) {
                    clearNotification(state);
                } else {
                    notify(state, {
                        message: completeOptions.message || state.message,
                        progress: 100,
                        color: completeOptions.color || state.color,
                        timeout: completeOptions.timeout || state.timeout
                    });
                }

                unregister(state);
                if (logger && typeof logger.log === 'function' && state.logEnabled && completeOptions.log !== false) {
                    logger.log(`Plugin:${pluginId}`, 'Jobs', `Completed job '${state.name}' (${state.id}).`, 'end');
                }
                return job;
            },
            fail(error, failOptions = {}) {
                if (state.status === 'complete' || state.status === 'failed' || state.status === 'cancelled') return job;
                state.status = 'failed';
                state.updatedAt = Date.now();

                const message = failOptions.message || `${state.name} failed: ${error?.message || String(error || 'Unknown error')}`;
                if (logger && typeof logger.error === 'function' && state.logEnabled && failOptions.log !== false) {
                    logger.error(`Plugin:${pluginId}`, 'Jobs', message, error);
                }

                notify(state, {
                    message,
                    progress: state.progress,
                    color: failOptions.color || '#ff4444',
                    timeout: failOptions.timeout || 5000
                });
                unregister(state);
                return job;
            }
        };

        state.handle = job;
        return job;
    };

    const findMatchingJobs = (id = null, options = {}) => {
        const normalizedId = id ? String(id) : null;
        const snapshot = resolveSnapshot(context);
        const scope = options.scope || null;
        const scopeKey = scope ? buildScopeKey(pluginId, snapshot, scope) : null;

        return Array.from(ACTIVE_JOBS.values()).filter(job => {
            if (job.pluginId !== pluginId) return false;
            if (normalizedId && job.id !== normalizedId) return false;
            if (scopeKey && job.scopeKey !== scopeKey) return false;
            return true;
        });
    };

    const cancel = (id = null, reason = 'cancelled', options = {}) => {
        const jobs = findMatchingJobs(id, options);
        for (const state of jobs) markCancelled(state, reason, options);
        return jobs.length;
    };

    const get = (id, options = {}) => {
        return findMatchingJobs(id, options)[0]?.handle || null;
    };

    const list = (options = {}) => {
        return findMatchingJobs(null, options).map(job => ({
            id: job.id,
            name: job.name,
            scope: job.scope,
            scopeKey: job.scopeKey,
            status: job.status,
            progress: job.progress,
            message: job.message,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt
        }));
    };

    const withJob = async (nameOrOptions, optionsOrWork = {}, maybeWork = null) => {
        const work = typeof optionsOrWork === 'function' ? optionsOrWork : maybeWork;
        const options = typeof optionsOrWork === 'function'
            ? {}
            : ((optionsOrWork && typeof optionsOrWork === 'object') ? optionsOrWork : {});

        if (typeof work !== 'function') {
            throw new Error(`tools.jobs.withJob requires a task function for plugin '${pluginId}'.`);
        }

        const job = start(nameOrOptions, options);
        try {
            const result = await work(job, job.cancelToken);
            if (job.status === 'running') {
                job.complete(options.completeMessage || null, {
                    notify: options.notifyOnComplete === true,
                    timeout: options.completeTimeout
                });
            }
            return result;
        } catch (error) {
            if (isCancelError(error) || job.isCancelled()) {
                job.cancel(error.reason || 'cancelled', { notify: options.notifyOnCancel === true });
                if (options.rethrowCancelled === true) throw error;
                return options.cancelValue;
            }

            job.fail(error);
            if (options.rethrow === false || options.swallowErrors === true) {
                return options.errorValue;
            }
            throw error;
        }
    };

    return {
        start,
        withJob,
        cancel,
        cancelAll: (reason = 'cancelled', options = {}) => cancel(null, reason, options),
        get,
        list,
        isCancelError
    };
}

module.exports = {
    buildJobsTools,
    PluginJobCancelledError
};

import { pixiSpriteManager } from './pixi_sprite_manager.js';

const actorSessions = new Map();
const closedSessionRunIds = new Set();

function ensureSession(runId) {
    if (!runId) throw new Error('Actor session requires a runId.');
    if (closedSessionRunIds.has(runId)) return null;
    if (!actorSessions.has(runId)) {
        actorSessions.set(runId, {
            localToScoped: new Map(),
            scopedKeys: new Set()
        });
    }
    return actorSessions.get(runId);
}

function normalizeLocalActorId(rawActorId, fallback = null) {
    const raw = String(rawActorId || fallback || '').trim().toLowerCase();
    const cleaned = raw.replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    if (cleaned) return cleaned;
    return `actor_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function buildScopedRawId(runId, localActorId) {
    const safeRun = String(runId).replace(/[^a-z0-9_]/gi, '_');
    return `${safeRun}_${localActorId}`;
}

function resolveScopedKey(session, actorId) {
    if (!session) return null;
    if (!actorId) return null;
    if (session.localToScoped.has(actorId)) return session.localToScoped.get(actorId);
    if (session.scopedKeys.has(actorId)) return actorId;
    return null;
}

function removeSessionMappings(session, scopedKey) {
    if (!session || !scopedKey) return;
    for (const [localId, trackedScoped] of session.localToScoped.entries()) {
        if (trackedScoped === scopedKey) {
            session.localToScoped.delete(localId);
        }
    }
    session.scopedKeys.delete(scopedKey);
}

export async function spawnSessionActor(runId, options = {}) {
    const session = ensureSession(runId);
    if (!session) return null;
    const localActorId = normalizeLocalActorId(options.actorId || options.id || options.character, 'actor');
    const scopedRawId = buildScopedRawId(runId, localActorId);

    const existingScopedKey = resolveScopedKey(session, localActorId);
    if (existingScopedKey) {
        pixiSpriteManager.removePluginActor(existingScopedKey, 'session-respawn');
        removeSessionMappings(session, existingScopedKey);
    }

    const scopedKey = await pixiSpriteManager.spawnPluginActor({
        ...options,
        actorId: scopedRawId
    });

    // Teardown can happen while spawnPluginActor is in-flight.
    // If this run is already closed, immediately remove the spawned clone.
    if (closedSessionRunIds.has(runId)) {
        try {
            pixiSpriteManager.removePluginActor(scopedKey, 'session-closed-before-spawn-commit');
        } catch (_) { }
        return null;
    }

    session.localToScoped.set(localActorId, scopedKey);
    session.scopedKeys.add(scopedKey);

    return {
        localActorId,
        scopedActorKey: scopedKey
    };
}

export async function updateSessionActor(runId, actorId, patch = {}) {
    if (closedSessionRunIds.has(runId)) return null;
    const session = ensureSession(runId);
    if (!session) return null;
    const localActorId = normalizeLocalActorId(actorId, actorId);
    const scopedKey = resolveScopedKey(session, localActorId) || resolveScopedKey(session, actorId);
    if (!scopedKey) return null;
    return await pixiSpriteManager.updatePluginActor(scopedKey, patch);
}

export function removeSessionActor(runId, actorId, reason = 'session-remove') {
    if (closedSessionRunIds.has(runId)) return false;
    const session = actorSessions.get(runId);
    if (!session) return false;
    const localActorId = normalizeLocalActorId(actorId, actorId);
    const scopedKey = resolveScopedKey(session, localActorId) || resolveScopedKey(session, actorId);
    if (!scopedKey) return false;
    const removed = pixiSpriteManager.removePluginActor(scopedKey, reason);
    if (removed) removeSessionMappings(session, scopedKey);
    return removed;
}

export function clearSessionActors(runId, reason = 'session-clear') {
    const session = actorSessions.get(runId);
    if (!session) return;
    for (const scopedKey of Array.from(session.scopedKeys)) {
        pixiSpriteManager.removePluginActor(scopedKey, reason);
        removeSessionMappings(session, scopedKey);
    }
}

export function endSessionActors(runId, reason = 'session-end') {
    if (!runId) return;
    clearSessionActors(runId, reason);
    closedSessionRunIds.add(runId);
    actorSessions.delete(runId);
}

export function endAllActorSessions(reason = 'session-end-all') {
    const activeRunIds = Array.from(actorSessions.keys());
    for (const runId of activeRunIds) {
        endSessionActors(runId, reason);
    }
    // Keep the closed-session memory bounded.
    if (closedSessionRunIds.size > 5000) {
        closedSessionRunIds.clear();
    }
}

export function listSessionActorKeys(runId) {
    const session = actorSessions.get(runId);
    if (!session) return [];
    return Array.from(session.scopedKeys);
}

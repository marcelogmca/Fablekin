function normalizeDelayMs(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(0, Number(fallback) || 0);
  return Math.max(0, Math.round(parsed));
}

function sortReadyTaskKeys(keys, taskMap) {
  return [...keys].sort((leftKey, rightKey) => {
    const left = taskMap.get(leftKey);
    const right = taskMap.get(rightKey);
    return Number(right?.cacheLeader === true) - Number(left?.cacheLeader === true);
  });
}

function createCacheGroupScheduler(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const logger = options.logger;
  const groupStates = new Map();

  function reserve(task) {
    const group = String(task?.cacheGroup || '').trim();
    if (!group) return { group: null, role: null, state: null };

    const requestedDelayMs = normalizeDelayMs(task.cacheDelayMs);
    const existing = groupStates.get(group);
    if (!existing) {
      let resolveStarted;
      const startedPromise = new Promise(resolve => {
        resolveStarted = resolve;
      });
      const state = {
        leaderKey: task.key,
        startedAt: null,
        delayMs: requestedDelayMs,
        startedPromise,
        resolveStarted
      };
      groupStates.set(group, state);
      return { group, role: 'leader', leaderKey: task.key, state };
    }

    existing.delayMs = Math.max(existing.delayMs, requestedDelayMs);
    return { group, role: 'follower', leaderKey: existing.leaderKey, state: existing };
  }

  function markStarted(reservation) {
    if (reservation?.role !== 'leader' || !reservation.state || reservation.state.startedAt !== null) return;
    logger?.log?.(
      'VNManager',
      'PromptCache',
      `Task "${reservation.leaderKey}" is leading cache group "${reservation.group}"; followers release after ${reservation.state.delayMs}ms.`
    );
    reservation.state.startedAt = now();
    reservation.state.resolveStarted();
  }

  async function getWaitMs(reservation, taskKey = '') {
    if (reservation?.role !== 'follower' || !reservation.state) return 0;
    await reservation.state.startedPromise;
    const waitMs = Math.max(
      0,
      reservation.state.startedAt + reservation.state.delayMs - now()
    );
    if (waitMs > 0) {
      logger?.log?.(
        'VNManager',
        'PromptCache',
        `Delaying task "${taskKey}" by ${waitMs}ms behind cache leader "${reservation.leaderKey}".`
      );
    }
    return waitMs;
  }

  return { getWaitMs, groupStates, markStarted, reserve };
}

module.exports = {
  createCacheGroupScheduler,
  normalizeDelayMs,
  sortReadyTaskKeys
};

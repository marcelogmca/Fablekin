const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCacheGroupScheduler,
  sortReadyTaskKeys
} = require('./cache_group_scheduler.js');

test('explicit cache leader is ordered before ready followers', () => {
  const taskMap = new Map([
    ['background', { key: 'background', cacheGroup: 'medium' }],
    ['synopsis', { key: 'synopsis', cacheGroup: 'medium', cacheLeader: true }],
    ['unrelated', { key: 'unrelated' }]
  ]);

  const ordered = sortReadyTaskKeys(['background', 'unrelated', 'synopsis'], taskMap);
  assert.equal(ordered[0], 'synopsis');
  assert.deepEqual(new Set(ordered), new Set(['background', 'unrelated', 'synopsis']));
});

test('followers wait from leader start while unrelated tasks remain immediate', async () => {
  let currentTime = 1000;
  const scheduler = createCacheGroupScheduler({ now: () => currentTime });

  const leader = scheduler.reserve({
    key: 'synopsis',
    cacheGroup: 'medium',
    cacheDelayMs: 5000
  });
  const unrelated = scheduler.reserve({ key: 'dialogue-state' });
  scheduler.markStarted(leader);

  currentTime = 2500;
  const follower = scheduler.reserve({
    key: 'background',
    cacheGroup: 'medium',
    cacheDelayMs: 5000
  });

  assert.equal(leader.role, 'leader');
  assert.equal(await scheduler.getWaitMs(leader), 0);
  assert.equal(await scheduler.getWaitMs(unrelated), 0);
  assert.equal(follower.role, 'follower');
  assert.equal(await scheduler.getWaitMs(follower, 'background'), 3500);
  assert.equal(follower.leaderKey, 'synopsis');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const cancellation = require('../pipeline_cancellation.js');
const {
  buildVnBackgroundMessages,
  initializeVnBackgroundLlmContext,
  waitForVnBackgroundCacheSlot
} = require('./background_llm_cache.js');

function createTurnContext() {
  return {
    projectName: 'Test Story',
    turnNumber: 7,
    input: { playerCharacterName: 'Ari', userPrompt: 'Open the door.' },
    output: { party: ['Ari', 'Mira'] },
    processed: {
      director: { writerBrief: 'End on a discovery.' },
      narrativeEngine: { writerResponse: 'Ari opens the door.' },
      vnManager: { processedLines: [{ line: 'Mira: Careful.' }] }
    },
    promptComponents: {
      root: {
        canon: ['The door is ancient.'],
        dynamic_knowledge: ['Mira distrusts ruins.'],
        simulation: ['Location: Vault'],
        history: ['They found the vault last turn.']
      }
    },
    runtime: { vnManager: {} }
  };
}

test('background context freezes finalized content and shares an exact prefix', () => {
  const turnContext = createTurnContext();
  const shared = initializeVnBackgroundLlmContext(turnContext);
  turnContext.processed.vnManager.processedLines[0].line = 'Changed later.';

  const relationship = buildVnBackgroundMessages(turnContext, 'Extract relationships.');
  const personality = buildVnBackgroundMessages(turnContext, 'Extract personality changes.');

  assert.equal(initializeVnBackgroundLlmContext(turnContext), shared);
  assert.deepEqual(relationship.slice(0, 2), personality.slice(0, 2));
  assert.match(relationship[1].content, /Mira: Careful\./);
  assert.doesNotMatch(relationship[1].content, /Changed later/);
  assert.notEqual(relationship[2].content, personality[2].content);
});

test('followers release in two waves without waiting for leader completion', async () => {
  const turnContext = createTurnContext();
  const settings = { infrastructure: { prompt_caching: { vn_background: { enabled: true, follower_delay_ms: 20 } } } };
  const leader = await waitForVnBackgroundCacheSlot(turnContext, 'summary', { settings });
  const started = Date.now();
  const warmupPromise = waitForVnBackgroundCacheSlot(turnContext, 'plugin-a', { settings })
    .then(result => ({ result, elapsed: Date.now() - started }));
  const followerPromise = waitForVnBackgroundCacheSlot(turnContext, 'plugin-b', { settings })
    .then(result => ({ result, elapsed: Date.now() - started }));
  const [warmup, follower] = await Promise.all([warmupPromise, followerPromise]);

  assert.equal(leader.role, 'leader');
  assert.equal(warmup.result.role, 'warmup_follower');
  assert.equal(follower.result.role, 'follower');
  assert.equal(follower.result.leaderKey, 'summary');
  assert.equal(follower.result.warmupFollowerKey, 'plugin-a');
  assert.ok(warmup.elapsed >= 10);
  assert.ok(follower.elapsed >= 30);
});

test('disabled gates and independent turns do not share leaders', async () => {
  const disabledSettings = { infrastructure: { prompt_caching: { vn_background: { enabled: false } } } };
  const disabled = await waitForVnBackgroundCacheSlot(createTurnContext(), 'disabled', { settings: disabledSettings });
  const first = await waitForVnBackgroundCacheSlot(createTurnContext(), 'first', {
    settings: { infrastructure: { prompt_caching: { vn_background: { follower_delay_ms: 0 } } } }
  });
  const second = await waitForVnBackgroundCacheSlot(createTurnContext(), 'second', {
    settings: { infrastructure: { prompt_caching: { vn_background: { follower_delay_ms: 0 } } } }
  });

  assert.equal(disabled.role, 'disabled');
  assert.equal(first.role, 'leader');
  assert.equal(second.role, 'leader');
});

test('shared messages require a suffix', () => {
  assert.throws(() => buildVnBackgroundMessages(createTurnContext(), ''), /non-empty suffix/);
});

test('a cancelled follower rejects before reaching its LLM call', async () => {
  const run = cancellation.createRunContext('background-cache-cancel');
  const turnContext = createTurnContext();
  const settings = { infrastructure: { prompt_caching: { vn_background: { follower_delay_ms: 20 } } } };

  await cancellation.runWithContext(run, async () => {
    await waitForVnBackgroundCacheSlot(turnContext, 'leader', { settings });
    const follower = waitForVnBackgroundCacheSlot(turnContext, 'follower', { settings });
    setTimeout(() => {
      run.cancelled = true;
      run.reason = 'test cancellation';
    }, 5);
    await assert.rejects(follower, /Generation cancelled/);
  });
});

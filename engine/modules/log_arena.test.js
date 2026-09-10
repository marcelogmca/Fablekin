const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const EventEmitter = require('events');
const {
  LogArenaStore,
  createLogArenaService,
  getUsageMetrics,
  isContextLimitError,
  aggregateJudgements
} = require('./log_arena.js');

function waitFor(io, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeout);
    const handler = event => {
      if (event?.type !== type) return;
      clearTimeout(timer);
      io.off('log-arena-progress', handler);
      resolve(event);
    };
    io.on('log-arena-progress', handler);
  });
}

function makeSource() {
  return {
    requestTitle: 'Quest Giver Plugin - Request',
    projectName: 'test-project',
    filename: 'turn_123.json',
    request: {
      timestamp: new Date().toISOString(),
      payload: {
        provider: 'nano_gpt',
        model: 'original/model',
        diagnostics: { pluginId: 'quest_giver' },
        content: [{ role: 'system', content: 'Return a quest.' }, { role: 'user', content: 'A forest.' }]
      }
    },
    response: { payload: { provider: 'nano_gpt', model: 'original/model', content: 'Original quest.' } }
  };
}

async function withService(callLLMDirect, fn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fablekin-arena-'));
  const io = new EventEmitter();
  const service = createLogArenaService({
    databasePath: path.join(tempDir, 'arena.db'),
    callLLMDirect,
    listConfiguredProviders: () => ['nano_gpt', 'openrouter'],
    readSettings: () => ({ infrastructure: { model_costs: { nano_gpt: { 'fast/model': { input: 1, output: 2 } } } } }),
    io,
    Logger: { error() {} }
  });
  try { await fn(service, io); } finally {
    await service.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function run() {
  assert.strictEqual(isContextLimitError(new Error('maximum context length exceeded')), true);
  assert.strictEqual(isContextLimitError(new Error('network unavailable')), false);
  assert.strictEqual(aggregateJudgements([{ overall_score: 80, confidence: 70, scores: { correctness: 90 } }]).overallScore, 80);
  assert.strictEqual(getUsageMetrics({ usage: {}, content: 'x' }).totalCost, null);

  const recoveryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fablekin-arena-recovery-'));
  const recoveryPath = path.join(recoveryDir, 'arena.db');
  const firstStore = new LogArenaStore(recoveryPath);
  await firstStore.createExperiment({
    id: 'recover-me', presetKey: '::Recovery - Request', requestTitle: 'Recovery - Request',
    source: { unicode: 'Olá 世界' }, config: {}, status: 'running', createdAt: new Date().toISOString()
  });
  await firstStore.close();
  const recoveredStore = new LogArenaStore(recoveryPath);
  assert.strictEqual((await recoveredStore.getExperiment('recover-me')).status, 'interrupted');
  assert.strictEqual((await recoveredStore.getExperiment('recover-me')).source.unicode, 'Olá 世界');
  await recoveredStore.close();
  await fs.rm(recoveryDir, { recursive: true, force: true });

  let activeCalls = 0;
  let maxActiveCalls = 0;
  const observedFastEfforts = [];
  await withService(async ({ model, extra }) => {
    if (model === 'fast/model') observedFastEfforts.push(extra?.reasoning?.effort || null);
    activeCalls++;
    maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
    await new Promise(resolve => setTimeout(resolve, 25));
    activeCalls--;
    if (model === 'broken/model') throw new Error('provider failed');
    return { content: `output:${model}`, model, provider: 'nano_gpt', durationMs: 25, usage: { prompt_tokens: 10, completion_tokens: 5 } };
  }, async (service, io) => {
    const finished = waitFor(io, 'experiment-finished');
    const experiment = await service.startExperiment({
      source: makeSource(),
      config: {
        repetitions: 2,
        contestants: [
          { id: 'fast', label: 'Fast', provider: 'nano_gpt', model: 'fast/model', reasoningEffort: 'medium' },
          { id: 'broken', label: 'Broken', provider: 'nano_gpt', model: 'broken/model' }
        ],
        judge: { enabled: false }
      }
    });
    await finished;
    const stored = await service.getExperiment(experiment.id);
    assert.strictEqual(stored.runs.length, 4);
    assert.strictEqual(stored.runs.filter(item => item.status === 'completed').length, 2);
    assert.strictEqual(stored.runs.filter(item => item.status === 'failed').length, 2);
    assert.ok(maxActiveCalls >= 4, 'all repetitions should be launched concurrently');
    assert.deepStrictEqual(observedFastEfforts, ['medium', 'medium']);
    const savedPreset = await service.getPreset({ requestTitle: makeSource().requestTitle, pluginId: 'quest_giver' });
    assert.strictEqual(savedPreset.config.repetitions, 2);
    assert.strictEqual(savedPreset.config.contestants[0].reasoningEffort, 'medium');
    assert.strictEqual((await service.listExperiments({ requestTitle: makeSource().requestTitle, pluginId: 'quest_giver' })).length, 1);
    await service.pinExperiment(experiment.id, true);
    assert.strictEqual((await service.getExperiment(experiment.id)).pinned, true);
    assert.strictEqual(await service.deleteExperiment(experiment.id), true);
  });

  await withService(({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('arena cancelled')), { once: true });
  }), async (service, io) => {
    const runStarted = waitFor(io, 'run-started');
    const finished = waitFor(io, 'experiment-finished');
    const experiment = await service.startExperiment({
      source: makeSource(),
      config: { repetitions: 1, contestants: [{ id: 'slow', label: 'Slow', provider: 'nano_gpt', model: 'slow/model' }], judge: { enabled: false } }
    });
    await runStarted;
    assert.strictEqual(await service.cancelExperiment(experiment.id), true);
    await finished;
    const stored = await service.getExperiment(experiment.id);
    assert.strictEqual(stored.status, 'cancelled');
    assert.strictEqual(stored.runs[0].status, 'cancelled');
  });

  let refusalAttempts = 0;
  await withService(async () => {
    refusalAttempts += 1;
    if (refusalAttempts === 1) {
      return { content: "I'm sorry, but I can't help with that.", provider: 'nano_gpt', model: 'fast/model', durationMs: 1, usage: {} };
    }
    return { content: 'Recovered Arena output.', provider: 'nano_gpt', model: 'fast/model', durationMs: 1, usage: {} };
  }, async (service, io) => {
    const finished = waitFor(io, 'experiment-finished');
    const experiment = await service.startExperiment({
      source: makeSource(),
      config: {
        repetitions: 1,
        contestants: [{ id: 'retry-refusal', label: 'Retry refusal', provider: 'nano_gpt', model: 'fast/model' }],
        judge: { enabled: false }
      }
    });
    await finished;
    const stored = await service.getExperiment(experiment.id);
    assert.strictEqual(refusalAttempts, 2, 'Arena should retry a detected refusal once');
    assert.strictEqual(stored.runs[0].status, 'completed');
    assert.strictEqual(stored.runs[0].response, 'Recovered Arena output.');
    assert.strictEqual(stored.runs[0].metrics.refusalRetries, 1);
  });

  const privateScaffold = 'PRIVATE_ASSISTANT_SCAFFOLD_DO_NOT_SHOW_TO_JUDGE';
  let generationSawPrivateScaffold = false;
  let judgeSawPrivateScaffold = false;
  await withService(async ({ messages, model, signal }) => {
    const system = String(messages?.[0]?.content || '');
    const user = String(messages?.[1]?.content || '');
    const serializedMessages = JSON.stringify(messages);
    if (system.includes('audit LLM prompts')) {
      judgeSawPrivateScaffold ||= serializedMessages.includes(privateScaffold);
      return { content: JSON.stringify({ ambiguity: 5, summary: 'Clear.' }), provider: 'nano_gpt', model, durationMs: 1, usage: {} };
    }
    if (system.includes('rigorous blind LLM evaluator')) {
      judgeSawPrivateScaffold ||= serializedMessages.includes(privateScaffold);
      const responsePayload = user.split('RESPONSES:\n').pop();
      const ids = Array.from(responsePayload.matchAll(/"response_id":"([^"]+)"/g)).map(match => match[1]);
      return {
        content: JSON.stringify({ responses: ids.map(id => ({ response_id: id, scores: { correctness: 88 }, overall_score: 88, confidence: 75, rationale: 'Successful output.' })) }),
        provider: 'nano_gpt', model, durationMs: 1, usage: {}
      };
    }
    if (system.includes('Compare blind candidate')) {
      judgeSawPrivateScaffold ||= serializedMessages.includes(privateScaffold);
      return { content: JSON.stringify({ ranking: [], recommendation: 'Use a successful candidate.' }), provider: 'nano_gpt', model, durationMs: 1, usage: {} };
    }
    if (model === 'fast/model') {
      generationSawPrivateScaffold = messages?.[1]?.role === 'assistant' && messages[1].content === privateScaffold;
      return { content: 'fast success', provider: 'nano_gpt', model, durationMs: 1, usage: {} };
    }
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('stopped for judging')), { once: true });
    });
  }, async (service, io) => {
    const firstFinished = waitFor(io, 'run-finished');
    const judged = waitFor(io, 'judging-finished');
    const experiment = await service.startExperiment({
      source: makeSource(),
      config: {
        repetitions: 1,
        contestants: [
          {
            id: 'fast', label: 'Fast', provider: 'nano_gpt', model: 'fast/model',
            promptModifications: [{ type: 'insert_message_after_system', role: 'assistant', content: privateScaffold }]
          },
          { id: 'slow', label: 'Slow', provider: 'nano_gpt', model: 'slow/model' }
        ],
        judge: { enabled: true, provider: 'nano_gpt', model: 'judge/model' }
      }
    });
    assert.strictEqual((await firstFinished).run.status, 'completed');
    assert.strictEqual(await service.stopAndJudgeExperiment(experiment.id), true);
    await judged;
    const stored = await service.getExperiment(experiment.id);
    const fastRun = stored.runs.find(run => run.candidateId === 'fast');
    const slowRun = stored.runs.find(run => run.candidateId === 'slow');
    assert.strictEqual(stored.status, 'completed');
    assert.strictEqual(fastRun.status, 'completed');
    assert.strictEqual(fastRun.judge.overall_score, 88);
    assert.strictEqual(slowRun.status, 'cancelled');
    assert.strictEqual(slowRun.judge, null);
    assert.strictEqual(generationSawPrivateScaffold, true, 'contestant should receive the inserted assistant message after the system message');
    assert.strictEqual(judgeSawPrivateScaffold, false, 'prompt modifications must remain hidden from every judge call');
  });

  let splitTriggered = false;
  const observedJudgeEfforts = [];
  await withService(async ({ messages, model, extra }) => {
    const system = String(messages?.[0]?.content || '');
    const user = String(messages?.[1]?.content || '');
    if (model === 'judge/model') observedJudgeEfforts.push(extra?.reasoning?.effort || null);
    if (system.includes('audit LLM prompts')) {
      return { content: JSON.stringify({ ambiguity: 10, summary: 'Clear.' }), provider: 'nano_gpt', model, durationMs: 1, usage: {} };
    }
    if (system.includes('rigorous blind LLM evaluator')) {
      const responsePayload = user.split('RESPONSES:\n').pop();
      const ids = Array.from(responsePayload.matchAll(/"response_id":"([^"]+)"/g)).map(match => match[1]);
      if (ids.length > 1) {
        splitTriggered = true;
        throw new Error('maximum context length exceeded');
      }
      return {
        content: JSON.stringify({ responses: ids.map(id => ({ response_id: id, scores: { instruction_adherence: 90, correctness: 90, completeness: 90, format_compliance: 90, relevance: 90, hallucination_safety: 90 }, overall_score: 90, confidence: 80, rationale: 'Good.' })) }),
        provider: 'nano_gpt', model, durationMs: 1, usage: {}
      };
    }
    if (system.includes('Compare blind candidate')) {
      return { content: JSON.stringify({ ranking: [{ blind_label: 'Candidate A', rank: 1, reason: 'Best.' }], recommendation: 'Candidate A' }), provider: 'nano_gpt', model, durationMs: 1, usage: {} };
    }
    return { content: `fresh:${model}`, provider: 'nano_gpt', model, durationMs: 1, usage: { prompt_tokens: 4, completion_tokens: 2 } };
  }, async (service, io) => {
    let candidateProgressEvents = 0;
    io.on('log-arena-progress', event => { if (event?.type === 'candidate-judged') candidateProgressEvents++; });
    const judged = waitFor(io, 'judging-finished');
    const experiment = await service.startExperiment({
      source: makeSource(),
      config: {
        repetitions: 2,
        contestants: [{ id: 'candidate', label: 'Candidate', provider: 'nano_gpt', model: 'fast/model' }],
        judge: { enabled: true, provider: 'nano_gpt', model: 'judge/model', reasoningEffort: 'high' }
      }
    });
    await judged;
    const stored = await service.getExperiment(experiment.id);
    assert.strictEqual(splitTriggered, true);
    assert.strictEqual(stored.status, 'completed');
    assert.ok(stored.judge.promptQuality);
    assert.strictEqual(stored.runs.every(item => item.judge?.overall_score === 90), true, JSON.stringify(stored.runs.map(item => item.judge)));
    assert.ok(Array.isArray(stored.judge.comparison.ranking));
    assert.ok(observedJudgeEfforts.length >= 4);
    assert.strictEqual(observedJudgeEfforts.every(effort => effort === 'high'), true);
    assert.ok(candidateProgressEvents >= 2, 'judging should stream candidate-level progress including the original baseline');

    const rejudged = waitFor(io, 'judging-finished');
    const rerunResult = await service.rejudgeExperiment(experiment.id);
    await rejudged;
    assert.strictEqual(rerunResult.runs.length, 2, 're-running the judge must not launch contestant calls');
    assert.strictEqual(rerunResult.status, 'completed');
    assert.strictEqual(rerunResult.runs.every(item => item.judge?.overall_score === 90), true);
  });

  let retryPhase = false;
  let contestantCalls = 0;
  let promptQualityCalls = 0;
  const retryEvaluatorBatches = [];
  await withService(async ({ messages, model }) => {
    const system = String(messages?.[0]?.content || '');
    const user = String(messages?.[1]?.content || '');
    if (system.includes('audit LLM prompts')) {
      promptQualityCalls += 1;
      return { content: JSON.stringify({ ambiguity: 0, summary: 'Clear.' }), provider: 'nano_gpt', model, durationMs: 1, usage: {} };
    }
    if (system.includes('rigorous blind LLM evaluator')) {
      const responsePayload = user.split('RESPONSES:\n').pop();
      const ids = Array.from(responsePayload.matchAll(/"response_id":"([^"]+)"/g)).map(match => match[1]);
      if (retryPhase) retryEvaluatorBatches.push(ids);
      const judgedIds = !retryPhase && ids.length > 1 ? ids.slice(0, 1) : ids;
      return {
        content: JSON.stringify({ responses: judgedIds.map(id => ({
          response_id: id,
          scores: { correctness: retryPhase ? 77 : 81 },
          overall_score: retryPhase ? 77 : 81,
          confidence: 80,
          rationale: retryPhase ? 'Recovered.' : 'Initial success.'
        })) }),
        provider: 'nano_gpt', model, durationMs: 1, usage: {}
      };
    }
    if (system.includes('Compare blind candidate')) {
      return { content: JSON.stringify({ ranking: [], recommendation: 'Done.' }), provider: 'nano_gpt', model, durationMs: 1, usage: {} };
    }
    contestantCalls += 1;
    return { content: `contestant:${contestantCalls}`, provider: 'nano_gpt', model, durationMs: 1, usage: {} };
  }, async (service, io) => {
    const judged = waitFor(io, 'judging-finished');
    const experiment = await service.startExperiment({
      source: makeSource(),
      config: {
        repetitions: 2,
        contestants: [{ id: 'candidate', label: 'Candidate', provider: 'nano_gpt', model: 'fast/model' }],
        judge: { enabled: true, provider: 'nano_gpt', model: 'judge/model' }
      }
    });
    await judged;
    const beforeRetry = await service.getExperiment(experiment.id);
    const initiallyScored = beforeRetry.runs.find(run => run.judge?.overall_score === 81);
    const initiallyFailed = beforeRetry.runs.find(run => !Number.isFinite(Number(run.judge?.overall_score)));
    assert.ok(initiallyScored, 'one response should retain its successful initial judgement');
    assert.ok(initiallyFailed?.judge?.unjudgeable, 'one omitted response should be marked unjudgeable');

    retryPhase = true;
    const retried = await service.retryFailedJudgements(experiment.id);
    assert.strictEqual(contestantCalls, 2, 'retrying failed judges must not launch contestant calls');
    assert.strictEqual(promptQualityCalls, 1, 'successful prompt-quality analysis should be reused');
    assert.deepStrictEqual(retryEvaluatorBatches, [[initiallyFailed.id]], 'only the failed response should be sent back to the evaluator');
    assert.strictEqual(retried.runs.find(run => run.id === initiallyScored.id).judge.overall_score, 81, 'successful judge results must remain untouched');
    assert.strictEqual(retried.runs.find(run => run.id === initiallyFailed.id).judge.overall_score, 77, 'failed judge result should be replaced after retry');
    assert.strictEqual(retried.judge.candidates.length, 2, 'the regenerated comparison should still contain the contestant and original baseline');
    assert.strictEqual(retried.judge.candidates.find(candidate => candidate.candidateId === 'candidate').aggregate.judgedCount, 2);
  });

  console.log('ok - log arena');
}

run().catch(error => {
  console.error('not ok - log arena');
  console.error(error);
  process.exitCode = 1;
});

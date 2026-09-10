const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { repairJson, containsRefusalFuzzy } = require('./llm.js');
const {
  calculateCostBreakdown,
  extractCacheTokens,
  deriveReasoningTokenMetric,
  calculateReasoningBreakdown
} = require('../views/log_viewer/cost_metrics.js');

const MAX_CONTESTANTS = 8;
const MAX_REPETITIONS = 10;
const DEFAULT_TIMEOUT_MS = 600000;
const ARENA_REFUSAL_RETRIES = 1;
const ARENA_REFUSAL_RETRY_DELAY_MS = 1500;
const MAX_PROMPT_MODIFICATION_CHARS = 200000;
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const REASONING_EFFORT_PROVIDERS = new Set(['nano_gpt', 'openrouter', 'openai', 'deepseek']);

function jsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function jsonStringify(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function extractReplayMessages(request) {
  const content = request?.payload?.content;
  if (Array.isArray(content)) return content;
  if (Array.isArray(content?.messages)) return content.messages;
  return null;
}

function applyPromptModifications(messages, modifications = []) {
  const replayMessages = messages.map(message => ({ ...message }));
  for (const modification of modifications) {
    if (modification.type !== 'insert_message_after_system') continue;
    let insertionIndex = 0;
    while (insertionIndex < replayMessages.length && replayMessages[insertionIndex]?.role === 'system') insertionIndex += 1;
    replayMessages.splice(insertionIndex, 0, { role: modification.role || 'assistant', content: modification.content });
  }
  return replayMessages;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(number)) return number;
  }
  return 0;
}

function getUsageMetrics({ usage = {}, reasoning = null, content = null, durationMs = 0, pricing = null }) {
  const inputTokens = firstNumber(usage.promptTokens, usage.prompt_tokens, usage.inputTokens, usage.input_tokens);
  const outputTokens = firstNumber(usage.completionTokens, usage.completion_tokens, usage.outputTokens, usage.output_tokens);
  const generationTokens = firstNumber(usage.generationTokens, usage.generation_tokens, outputTokens);
  const cache = extractCacheTokens(usage);
  const reportedReasoning = firstNumber(
    usage.reasoning_tokens,
    usage.reasoningTokens,
    usage.native_tokens_reasoning,
    usage.completion_tokens_details?.reasoning_tokens,
    usage.output_token_details?.reasoning_tokens
  );
  const reasoningMetric = deriveReasoningTokenMetric({
    reportedReasoningTokens: reportedReasoning,
    generationTokens,
    reasoningText: typeof reasoning === 'string' ? reasoning : jsonStringify(reasoning),
    visibleText: typeof content === 'string' ? content : jsonStringify(content)
  });
  const costs = calculateCostBreakdown({
    inputTokens,
    outputTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWriteTokens: cache.cacheWriteTokens,
    pricing,
    reportedCost: firstNumber(usage.total_cost, usage.cost, usage.totalCost)
  });
  const reasoningBreakdown = calculateReasoningBreakdown({
    reasoningTokens: reasoningMetric.tokens,
    generationTokens,
    outputCost: costs.outputCost
  });
  const durationSeconds = Math.max(0, Number(durationMs) || 0) / 1000;
  const costKnown = costs.hasPricing || costs.reportedCost > 0 || usage.is_local_cache === true || usage.isLocalCache === true;

  return {
    ...costs,
    totalCost: costKnown ? costs.totalCost : null,
    costKnown,
    durationMs: Math.max(0, Number(durationMs) || 0),
    generationTokens,
    reasoningTokens: reasoningMetric.tokens,
    reasoningTokensEstimated: reasoningMetric.estimated,
    reasoningCost: reasoningBreakdown.cost,
    tokensPerSecond: durationSeconds > 0 ? generationTokens / durationSeconds : 0,
    isLocalCache: usage.is_local_cache === true || usage.isLocalCache === true
  };
}

function isContextLimitError(error) {
  const text = [error?.message, error?.code, error?.type, error?.response?.data?.error?.message]
    .filter(Boolean).join(' ').toLowerCase();
  return /context.{0,24}(length|window|limit)|maximum context|too many tokens|token limit|request too large/.test(text);
}

function normalizeScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function aggregateJudgements(items) {
  const scored = items.filter(item => normalizeScore(item?.overall_score) !== null);
  if (scored.length === 0) return { judgedCount: 0, overallScore: null, confidence: null, dimensions: {} };
  const dimensionKeys = ['instruction_adherence', 'correctness', 'completeness', 'format_compliance', 'relevance', 'hallucination_safety'];
  const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const dimensions = {};
  for (const key of dimensionKeys) {
    const values = scored.map(item => normalizeScore(item?.scores?.[key])).filter(value => value !== null);
    dimensions[key] = average(values);
  }
  return {
    judgedCount: scored.length,
    overallScore: average(scored.map(item => normalizeScore(item.overall_score))),
    confidence: average(scored.map(item => normalizeScore(item.confidence)).filter(value => value !== null)),
    dimensions
  };
}

class LogArenaStore {
  constructor(databasePath) {
    this.databasePath = databasePath;
    this.db = null;
    this.openPromise = null;
  }

  async init() {
    if (this.db) return this.db;
    if (this.openPromise) return this.openPromise;
    this.openPromise = (async () => {
      await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
      const db = await open({ filename: this.databasePath, driver: sqlite3.Database });
      await db.exec('PRAGMA foreign_keys = ON;');
      await db.exec(`
        CREATE TABLE IF NOT EXISTS arena_presets (
          preset_key TEXT PRIMARY KEY,
          request_title TEXT NOT NULL,
          plugin_id TEXT,
          config_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS arena_experiments (
          id TEXT PRIMARY KEY,
          preset_key TEXT NOT NULL,
          request_title TEXT NOT NULL,
          plugin_id TEXT,
          project_name TEXT,
          source_filename TEXT,
          source_json TEXT NOT NULL,
          config_json TEXT NOT NULL,
          status TEXT NOT NULL,
          pinned INTEGER NOT NULL DEFAULT 0,
          judge_json TEXT,
          summary_json TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS arena_runs (
          id TEXT PRIMARY KEY,
          experiment_id TEXT NOT NULL,
          candidate_id TEXT NOT NULL,
          candidate_label TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          repetition INTEGER NOT NULL,
          is_original INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          duration_ms INTEGER,
          response_json TEXT,
          reasoning_json TEXT,
          usage_json TEXT,
          metrics_json TEXT,
          error_json TEXT,
          judge_json TEXT,
          FOREIGN KEY(experiment_id) REFERENCES arena_experiments(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_arena_experiments_preset ON arena_experiments(preset_key, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_arena_runs_experiment ON arena_runs(experiment_id, candidate_id, repetition);
      `);
      await db.run("UPDATE arena_experiments SET status = 'interrupted', completed_at = COALESCE(completed_at, ?) WHERE status IN ('running', 'stopping-for-judge', 'judging')", new Date().toISOString());
      this.db = db;
      return db;
    })();
    try { return await this.openPromise; } finally { this.openPromise = null; }
  }

  async savePreset({ presetKey, requestTitle, pluginId = '', config }) {
    const db = await this.init();
    const updatedAt = new Date().toISOString();
    await db.run(`INSERT INTO arena_presets (preset_key, request_title, plugin_id, config_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(preset_key) DO UPDATE SET request_title=excluded.request_title, plugin_id=excluded.plugin_id,
      config_json=excluded.config_json, updated_at=excluded.updated_at`,
      presetKey, requestTitle, pluginId || null, jsonStringify(config), updatedAt);
    return { presetKey, requestTitle, pluginId, config, updatedAt };
  }

  async getPreset(presetKey) {
    const db = await this.init();
    const row = await db.get('SELECT * FROM arena_presets WHERE preset_key = ?', presetKey);
    return row ? { presetKey: row.preset_key, requestTitle: row.request_title, pluginId: row.plugin_id || '', config: jsonParse(row.config_json, {}), updatedAt: row.updated_at } : null;
  }

  async createExperiment(experiment) {
    const db = await this.init();
    await db.run(`INSERT INTO arena_experiments
      (id, preset_key, request_title, plugin_id, project_name, source_filename, source_json, config_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, experiment.id, experiment.presetKey, experiment.requestTitle,
      experiment.pluginId || null, experiment.projectName || null, experiment.sourceFilename || null,
      jsonStringify(experiment.source), jsonStringify(experiment.config), experiment.status, experiment.createdAt);
  }

  async saveRun(run) {
    const db = await this.init();
    await db.run(`INSERT INTO arena_runs
      (id, experiment_id, candidate_id, candidate_label, provider, model, repetition, is_original, status,
       started_at, completed_at, duration_ms, response_json, reasoning_json, usage_json, metrics_json, error_json, judge_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, started_at=excluded.started_at,
       completed_at=excluded.completed_at, duration_ms=excluded.duration_ms, response_json=excluded.response_json,
       reasoning_json=excluded.reasoning_json, usage_json=excluded.usage_json, metrics_json=excluded.metrics_json,
       error_json=excluded.error_json, judge_json=excluded.judge_json`,
      run.id, run.experimentId, run.candidateId, run.candidateLabel, run.provider, run.model, run.repetition,
      run.isOriginal ? 1 : 0, run.status, run.startedAt || null, run.completedAt || null, run.durationMs || null,
      jsonStringify(run.response), jsonStringify(run.reasoning), jsonStringify(run.usage), jsonStringify(run.metrics),
      jsonStringify(run.error), jsonStringify(run.judge));
  }

  async updateExperiment(id, fields) {
    const allowed = { status: 'status', completedAt: 'completed_at', judge: 'judge_json', summary: 'summary_json', pinned: 'pinned' };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      sets.push(`${column} = ?`);
      values.push(key === 'judge' || key === 'summary' ? jsonStringify(fields[key]) : (key === 'pinned' ? (fields[key] ? 1 : 0) : fields[key]));
    }
    if (!sets.length) return;
    const db = await this.init();
    await db.run(`UPDATE arena_experiments SET ${sets.join(', ')} WHERE id = ?`, ...values, id);
  }

  async updateRunJudge(id, judge) {
    const db = await this.init();
    await db.run('UPDATE arena_runs SET judge_json = ? WHERE id = ?', jsonStringify(judge), id);
  }

  async listExperiments(presetKey, limit = null) {
    const db = await this.init();
    const baseSql = `SELECT id, preset_key, request_title, plugin_id, project_name, source_filename, status,
      pinned, summary_json, created_at, completed_at FROM arena_experiments
      WHERE preset_key = ? ORDER BY pinned DESC, created_at DESC`;
    const numericLimit = Number(limit);
    const rows = Number.isFinite(numericLimit) && numericLimit > 0
      ? await db.all(`${baseSql} LIMIT ?`, presetKey, Math.floor(numericLimit))
      : await db.all(baseSql, presetKey);
    return rows.map(row => ({
      id: row.id, presetKey: row.preset_key, requestTitle: row.request_title, pluginId: row.plugin_id || '',
      projectName: row.project_name, sourceFilename: row.source_filename, status: row.status, pinned: row.pinned === 1,
      summary: jsonParse(row.summary_json, null), createdAt: row.created_at, completedAt: row.completed_at
    }));
  }

  async getExperiment(id) {
    const db = await this.init();
    const experiment = await db.get('SELECT * FROM arena_experiments WHERE id = ?', id);
    if (!experiment) return null;
    const runs = await db.all('SELECT * FROM arena_runs WHERE experiment_id = ? ORDER BY is_original DESC, candidate_id, repetition', id);
    return {
      id: experiment.id, presetKey: experiment.preset_key, requestTitle: experiment.request_title,
      pluginId: experiment.plugin_id || '', projectName: experiment.project_name, sourceFilename: experiment.source_filename,
      source: jsonParse(experiment.source_json, {}), config: jsonParse(experiment.config_json, {}), status: experiment.status,
      pinned: experiment.pinned === 1, judge: jsonParse(experiment.judge_json, null), summary: jsonParse(experiment.summary_json, null),
      createdAt: experiment.created_at, completedAt: experiment.completed_at,
      runs: runs.map(row => ({
        id: row.id, experimentId: row.experiment_id, candidateId: row.candidate_id, candidateLabel: row.candidate_label,
        provider: row.provider, model: row.model, repetition: row.repetition, isOriginal: row.is_original === 1,
        status: row.status, startedAt: row.started_at, completedAt: row.completed_at, durationMs: row.duration_ms,
        response: jsonParse(row.response_json, null), reasoning: jsonParse(row.reasoning_json, null), usage: jsonParse(row.usage_json, null),
        metrics: jsonParse(row.metrics_json, null), error: jsonParse(row.error_json, null), judge: jsonParse(row.judge_json, null)
      }))
    };
  }

  async deleteExperiment(id) {
    const db = await this.init();
    const result = await db.run('DELETE FROM arena_experiments WHERE id = ?', id);
    return result.changes > 0;
  }

  async close() {
    if (this.db) await this.db.close();
    this.db = null;
  }
}

function createLogArenaService({ databasePath, callLLMDirect, listConfiguredProviders, readSettings, io, Logger }) {
  const store = new LogArenaStore(databasePath);
  const active = new Map();

  const emitProgress = (event) => io.emit('log-arena-progress', event);
  const makePresetKey = (requestTitle, pluginId = '') => `${String(pluginId || '').trim()}::${String(requestTitle || '').trim()}`;
  const makeId = prefix => `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const pricingFor = (provider, model) => readSettings()?.infrastructure?.model_costs?.[provider]?.[model] || null;

  function waitForArenaRetry(signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ARENA_REFUSAL_RETRY_DELAY_MS);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason instanceof Error ? signal.reason : new Error('Arena request cancelled.'));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function callArenaLLM(request, { experimentId = null, run = null } = {}) {
    const totalAttempts = ARENA_REFUSAL_RETRIES + 1;
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      const result = await callLLMDirect(request);
      if (typeof result.content !== 'string' || !containsRefusalFuzzy(result.content)) {
        return { ...result, arenaAttempts: attempt };
      }

      const error = new Error(`AI refusal detected on Arena attempt ${attempt}/${totalAttempts}.`);
      error.code = 'arena_refusal';
      error.attemptNumber = attempt;
      if (attempt === totalAttempts) throw error;
      if (experimentId && run) {
        emitProgress({ experimentId, type: 'run-retrying', run, attempt, totalAttempts, reason: 'AI refusal detected' });
      }
      await waitForArenaRetry(request.signal);
    }
  }

  function validateConfig(config) {
    const repetitions = Math.max(1, Math.min(MAX_REPETITIONS, Math.floor(Number(config?.repetitions) || 1)));
    const contestants = Array.isArray(config?.contestants) ? config.contestants.slice(0, MAX_CONTESTANTS) : [];
    if (!contestants.length) throw new Error('Add at least one Arena contestant.');
    const providers = new Set(listConfiguredProviders());
    const normalizedContestants = contestants.map((contestant, index) => {
      const provider = String(contestant?.provider || '').trim().toLowerCase();
      const model = String(contestant?.model || '').trim();
      const reasoningEffort = String(contestant?.reasoningEffort || contestant?.reasoning_effort || '').trim().toLowerCase();
      if (!providers.has(provider)) throw new Error(`Contestant provider '${provider}' is not configured.`);
      if (!model) throw new Error(`Contestant ${index + 1} requires a raw model id.`);
      if (reasoningEffort && !REASONING_EFFORTS.has(reasoningEffort)) throw new Error(`Contestant ${index + 1} has an invalid reasoning effort.`);
      if (reasoningEffort && !REASONING_EFFORT_PROVIDERS.has(provider)) throw new Error(`Contestant provider '${provider}' does not support Arena reasoning effort levels.`);
      const promptModifications = Array.isArray(contestant?.promptModifications)
        ? contestant.promptModifications.slice(0, 1).map(modification => ({
          type: String(modification?.type || ''),
          role: String(modification?.role || 'assistant'),
          content: String(modification?.content || '')
        })).filter(modification => modification.type === 'insert_message_after_system' && modification.role === 'assistant' && modification.content.trim())
        : [];
      if (promptModifications.some(modification => modification.content.length > MAX_PROMPT_MODIFICATION_CHARS)) {
        throw new Error(`Contestant ${index + 1} prompt modification is too large.`);
      }
      return {
        id: String(contestant.id || `candidate_${index + 1}`),
        label: String(contestant.label || `Candidate ${index + 1}`),
        provider,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(promptModifications.length ? { promptModifications } : {})
      };
    });
    const judgeReasoningEffort = String(config?.judge?.reasoningEffort || config?.judge?.reasoning_effort || '').trim().toLowerCase();
    const judge = config?.judge?.enabled ? {
      enabled: true,
      provider: String(config.judge.provider || '').trim().toLowerCase(),
      model: String(config.judge.model || '').trim(),
      ...(judgeReasoningEffort ? { reasoningEffort: judgeReasoningEffort } : {})
    } : { enabled: false };
    if (judge.enabled && (!providers.has(judge.provider) || !judge.model)) throw new Error('The selected judge provider/model is incomplete.');
    if (judge.enabled && judgeReasoningEffort && !REASONING_EFFORTS.has(judgeReasoningEffort)) throw new Error('The judge has an invalid reasoning effort.');
    if (judge.enabled && judgeReasoningEffort && !REASONING_EFFORT_PROVIDERS.has(judge.provider)) throw new Error(`Judge provider '${judge.provider}' does not support Arena reasoning effort levels.`);
    return { repetitions, contestants: normalizedContestants, judge };
  }

  async function executeRun(experiment, candidate, repetition, controller) {
    const run = {
      id: makeId('run'), experimentId: experiment.id, candidateId: candidate.id, candidateLabel: candidate.label,
      provider: candidate.provider, model: candidate.model, repetition, isOriginal: false,
      status: 'running', startedAt: new Date().toISOString()
    };
    await store.saveRun(run);
    emitProgress({ experimentId: experiment.id, type: 'run-started', run });
    try {
      const result = await callArenaLLM({
        messages: applyPromptModifications(extractReplayMessages(experiment.source.request), candidate.promptModifications),
        provider: candidate.provider,
        model: candidate.model,
        extra: candidate.reasoningEffort ? { reasoning: { effort: candidate.reasoningEffort } } : {},
        timeout: DEFAULT_TIMEOUT_MS,
        signal: controller.signal
      }, { experimentId: experiment.id, run });
      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      run.durationMs = result.durationMs;
      run.response = result.content;
      run.reasoning = result.reasoning;
      run.usage = result.usage;
      run.metrics = {
        ...getUsageMetrics({
        usage: result.usage || {}, reasoning: result.reasoning, content: result.content,
        durationMs: result.durationMs, pricing: pricingFor(result.provider, result.model)
        }),
        refusalRetries: Math.max(0, (result.arenaAttempts || 1) - 1)
      };
    } catch (error) {
      run.status = controller.signal.aborted ? 'cancelled' : 'failed';
      run.completedAt = new Date().toISOString();
      run.durationMs = Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime());
      run.error = { message: error?.message || String(error), code: error?.code || null, type: error?.type || null };
    }
    await store.saveRun(run);
    emitProgress({ experimentId: experiment.id, type: 'run-finished', run });
    return run;
  }

  function promptQualityMessages(source) {
    return [{ role: 'system', content: 'You audit LLM prompts. Return strict JSON only.' }, { role: 'user', content: `Analyze this request for ambiguity, contradictions, missing constraints, output-contract clarity, and unnecessary context. Return {"ambiguity":0-100,"contradictions":0-100,"missing_constraints":0-100,"output_contract_clarity":0-100,"context_bloat":0-100,"summary":"...","recommendations":["..."]}.\n\nREQUEST:\n${jsonStringify(extractReplayMessages(source.request))}` }];
  }

  function candidateJudgeMessages(source, blindLabel, runs) {
    const outputs = runs.map(run => ({ response_id: run.id, output: run.response }));
    return [{ role: 'system', content: 'You are a rigorous blind LLM evaluator. Return strict JSON only. Do not infer or discuss model identity.' }, { role: 'user', content: `Evaluate every response against the original request. Score 0-100. Return {"responses":[{"response_id":"...","scores":{"instruction_adherence":0,"correctness":0,"completeness":0,"format_compliance":0,"relevance":0,"hallucination_safety":0},"overall_score":0,"confidence":0,"rationale":"..."}]}. Candidate identity: ${blindLabel}.\n\nREQUEST:\n${jsonStringify(extractReplayMessages(source.request))}\n\nRESPONSES:\n${jsonStringify(outputs)}` }];
  }

  async function callJudge(judge, messages, signal) {
    const result = await callArenaLLM({
      messages,
      provider: judge.provider,
      model: judge.model,
      extra: judge.reasoningEffort ? { reasoning: { effort: judge.reasoningEffort } } : {},
      timeout: DEFAULT_TIMEOUT_MS,
      signal
    });
    return { parsed: repairJson(result.content), usage: result.usage, durationMs: result.durationMs };
  }

  async function judgeRunBatch(experiment, judge, blindLabel, runs, controller) {
    try {
      const result = await callJudge(judge, candidateJudgeMessages(experiment.source, blindLabel, runs), controller.signal);
      const responseResults = Array.isArray(result.parsed?.responses) ? result.parsed.responses : [];
      return runs.map(run => ({ run, judgement: responseResults.find(item => item.response_id === run.id) || { unjudgeable: true, reason: 'Judge omitted this response.' } }));
    } catch (error) {
      if (controller.signal.aborted) throw error;
      if (isContextLimitError(error) && runs.length > 1) {
        const midpoint = Math.ceil(runs.length / 2);
        const [left, right] = await Promise.all([
          judgeRunBatch(experiment, judge, blindLabel, runs.slice(0, midpoint), controller),
          judgeRunBatch(experiment, judge, blindLabel, runs.slice(midpoint), controller)
        ]);
        return [...left, ...right];
      }
      if (isContextLimitError(error) && runs.length === 1) {
        return [{ run: runs[0], judgement: { unjudgeable: true, reason: 'Request plus response exceeds the selected judge context.' } }];
      }
      return runs.map(run => ({ run, judgement: { unjudgeable: true, reason: error?.message || String(error) } }));
    }
  }

  const hasJudgeScore = judgement => judgement?.overall_score !== null
    && judgement?.overall_score !== undefined
    && Number.isFinite(Number(judgement.overall_score));
  const hasAggregateScore = candidate => candidate?.aggregate?.overallScore !== null
    && candidate?.aggregate?.overallScore !== undefined
    && Number.isFinite(Number(candidate.aggregate.overallScore));

  async function judgeExperiment(experimentId, judgeOverride = null, options = {}) {
    const experiment = await store.getExperiment(experimentId);
    if (!experiment) throw new Error('Arena experiment not found.');
    const retryFailedOnly = options.retryFailedOnly === true;
    const judge = judgeOverride || experiment.config.judge;
    if (!judge?.enabled || !judge.provider || !judge.model) throw new Error('Judge is not configured.');
    const controller = active.get(experimentId)?.controller || new AbortController();
    await store.updateExperiment(experimentId, { status: 'judging' });
    emitProgress({ experimentId, type: 'judging-started', retryFailedOnly });

    let promptQuality = retryFailedOnly && experiment.judge?.promptQuality && !experiment.judge.promptQuality.error
      ? experiment.judge.promptQuality
      : null;
    if (!promptQuality) {
      try {
        promptQuality = (await callJudge(judge, promptQualityMessages(experiment.source), controller.signal)).parsed;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        promptQuality = { error: error?.message || String(error) };
      }
    }
    const partialJudgeResult = {
      judge: { provider: judge.provider, model: judge.model, reasoningEffort: judge.reasoningEffort || null },
      promptQuality,
      blindMap: retryFailedOnly ? { ...(experiment.judge?.blindMap || {}) } : {},
      candidates: retryFailedOnly ? [...(experiment.judge?.candidates || [])] : [],
      comparison: retryFailedOnly ? (experiment.judge?.comparison || null) : null,
      partial: true
    };
    let judgePersistence = Promise.resolve();
    const persistPartialJudge = () => {
      const snapshot = jsonParse(jsonStringify(partialJudgeResult), {});
      judgePersistence = judgePersistence.then(() => store.updateExperiment(experimentId, { judge: snapshot }));
      return judgePersistence;
    };
    await persistPartialJudge();
    emitProgress({ experimentId, type: 'prompt-quality-finished', promptQuality });

    const successfulRuns = experiment.runs.filter(run => run.status === 'completed');
    const original = experiment.source.response ? [{
      id: `original_${experiment.id}`, experimentId, candidateId: 'original', candidateLabel: 'Original baseline',
      provider: experiment.source.response.payload?.provider || experiment.source.request.payload?.provider || 'unknown',
      model: experiment.source.response.payload?.model || experiment.source.request.payload?.model || 'unknown',
      repetition: 0, isOriginal: true, status: 'completed', response: experiment.source.response.payload?.content
    }] : [];
    const groups = new Map();
    [...successfulRuns, ...original].forEach(run => {
      if (!groups.has(run.candidateId)) groups.set(run.candidateId, []);
      groups.get(run.candidateId).push(run);
    });
    const shuffledGroups = Array.from(groups.entries())
      .map(([candidateId, runs]) => ({ candidateId, runs, sort: crypto.randomBytes(4).readUInt32BE(0) }))
      .sort((a, b) => a.sort - b.sort);
    const blindMap = partialJudgeResult.blindMap;
    const usedBlindLabels = new Set(Object.values(blindMap));
    let nextBlindIndex = 0;
    shuffledGroups.forEach(group => {
      if (blindMap[group.candidateId]) return;
      while (usedBlindLabels.has(`Candidate ${String.fromCharCode(65 + nextBlindIndex)}`)) nextBlindIndex += 1;
      blindMap[group.candidateId] = `Candidate ${String.fromCharCode(65 + nextBlindIndex)}`;
      usedBlindLabels.add(blindMap[group.candidateId]);
      nextBlindIndex += 1;
    });
    partialJudgeResult.blindMap = blindMap;
    await persistPartialJudge();

    const priorCandidates = new Map((experiment.judge?.candidates || []).map(candidate => [candidate.candidateId, candidate]));
    const groupsToJudge = retryFailedOnly
      ? shuffledGroups.map(group => ({
        ...group,
        targetRuns: group.candidateId === 'original'
          ? (hasAggregateScore(priorCandidates.get('original')) ? [] : group.runs)
          : group.runs.filter(run => !hasJudgeScore(run.judge))
      })).filter(group => group.targetRuns.length > 0)
      : shuffledGroups.map(group => ({ ...group, targetRuns: group.runs }));
    if (retryFailedOnly && groupsToJudge.length === 0) throw new Error('There are no failed judge results to retry.');

    let judgedCandidateCount = 0;
    const retriedGroups = await Promise.all(groupsToJudge.map(async group => {
      const results = await judgeRunBatch(experiment, judge, blindMap[group.candidateId], group.targetRuns, controller);
      for (const item of results) {
        if (!item.run.isOriginal) await store.updateRunJudge(item.run.id, item.judgement);
      }
      const newJudgements = new Map(results.map(item => [item.run.id, item.judgement]));
      const allJudgements = group.candidateId === 'original'
        ? results.map(item => item.judgement)
        : group.runs.map(run => newJudgements.get(run.id) || run.judge).filter(Boolean);
      const judgedGroup = { candidateId: group.candidateId, blindLabel: blindMap[group.candidateId], results, aggregate: aggregateJudgements(allJudgements) };
      const partialCandidate = { candidateId: judgedGroup.candidateId, blindLabel: judgedGroup.blindLabel, aggregate: judgedGroup.aggregate };
      const partialIndex = partialJudgeResult.candidates.findIndex(item => item.candidateId === group.candidateId);
      if (partialIndex >= 0) partialJudgeResult.candidates[partialIndex] = partialCandidate;
      else partialJudgeResult.candidates.push(partialCandidate);
      await persistPartialJudge();
      judgedCandidateCount += 1;
      emitProgress({
        experimentId,
        type: 'candidate-judged',
        candidate: { candidateId: judgedGroup.candidateId, blindLabel: judgedGroup.blindLabel, aggregate: judgedGroup.aggregate },
        completed: judgedCandidateCount,
        total: groupsToJudge.length,
        retryFailedOnly
      });
      return judgedGroup;
    }));

    const retriedByCandidate = new Map(retriedGroups.map(group => [group.candidateId, group]));
    const refreshedExperiment = await store.getExperiment(experimentId);
    const refreshedRunsByCandidate = new Map();
    refreshedExperiment.runs.filter(run => run.status === 'completed').forEach(run => {
      if (!refreshedRunsByCandidate.has(run.candidateId)) refreshedRunsByCandidate.set(run.candidateId, []);
      refreshedRunsByCandidate.get(run.candidateId).push(run);
    });
    const judgedGroups = shuffledGroups.map(group => {
      const retried = retriedByCandidate.get(group.candidateId);
      if (group.candidateId === 'original') {
        return retried || {
          candidateId: group.candidateId,
          blindLabel: blindMap[group.candidateId],
          results: group.runs.map(run => ({ run, judgement: null })),
          aggregate: priorCandidates.get(group.candidateId)?.aggregate || aggregateJudgements([])
        };
      }
      const runs = refreshedRunsByCandidate.get(group.candidateId) || [];
      return {
        candidateId: group.candidateId,
        blindLabel: blindMap[group.candidateId],
        results: runs.map(run => ({ run, judgement: run.judge })),
        aggregate: aggregateJudgements(runs.map(run => run.judge).filter(Boolean))
      };
    });

    const compactCandidates = judgedGroups.map(group => ({ blind_label: group.blindLabel, aggregate: group.aggregate }));
    let comparison = null;
    try {
      comparison = (await callJudge(judge, [
        { role: 'system', content: 'Compare blind candidate score summaries. Return strict JSON only.' },
        { role: 'user', content: `Return {"ranking":[{"blind_label":"Candidate A","rank":1,"reason":"..."}],"recommendation":"...","tradeoffs":"..."}.\n${jsonStringify(compactCandidates)}` }
      ], controller.signal)).parsed;
    } catch (error) {
      if (controller.signal.aborted) throw error;
      comparison = { error: error?.message || String(error) };
    }

    if (Array.isArray(comparison?.ranking)) {
      const byBlindLabel = new Map(judgedGroups.map(group => {
        const firstRun = group.results[0]?.run;
        return [group.blindLabel, {
          candidateId: group.candidateId,
          candidateLabel: firstRun?.candidateLabel || group.candidateId,
          isOriginal: firstRun?.isOriginal === true
        }];
      }));
      comparison.ranking = comparison.ranking.map(item => ({ ...item, ...(byBlindLabel.get(item.blind_label) || {}) }));
    }

    const judgeResult = { judge: { provider: judge.provider, model: judge.model, reasoningEffort: judge.reasoningEffort || null }, promptQuality, blindMap, candidates: judgedGroups.map(group => ({ candidateId: group.candidateId, blindLabel: group.blindLabel, aggregate: group.aggregate })), comparison };
    const finalExperiment = await store.getExperiment(experimentId);
    const summary = buildSummary(finalExperiment.runs, judgeResult);
    await store.updateExperiment(experimentId, { status: 'completed', completedAt: new Date().toISOString(), judge: judgeResult, summary });
    emitProgress({ experimentId, type: 'judging-finished', judge: judgeResult, summary });
    return judgeResult;
  }

  function buildSummary(runs, judge = null) {
    const groups = new Map();
    runs.filter(run => !run.isOriginal).forEach(run => {
      if (!groups.has(run.candidateId)) groups.set(run.candidateId, []);
      groups.get(run.candidateId).push(run);
    });
    return Array.from(groups.entries()).map(([candidateId, candidateRuns]) => {
      const completed = candidateRuns.filter(run => run.status === 'completed');
      const durations = completed.map(run => Number(run.durationMs) || 0).sort((a, b) => a - b);
      const costs = completed.map(run => run.metrics?.totalCost).filter(Number.isFinite);
      const judgeGroup = judge?.candidates?.find(item => item.candidateId === candidateId);
      return {
        candidateId, label: candidateRuns[0]?.candidateLabel, provider: candidateRuns[0]?.provider, model: candidateRuns[0]?.model,
        completed: completed.length, failed: candidateRuns.length - completed.length,
        medianDurationMs: durations.length ? durations[Math.floor(durations.length / 2)] : null,
        averageCost: costs.length ? costs.reduce((sum, value) => sum + value, 0) / costs.length : null,
        judgeScore: judgeGroup?.aggregate?.overallScore ?? null
      };
    });
  }

  async function startExperiment(payload) {
    const source = payload?.source;
    const requestTitle = String(source?.requestTitle || '').trim();
    const messages = extractReplayMessages(source?.request);
    if (!requestTitle || !Array.isArray(messages) || messages.length === 0) throw new Error('The selected log entry does not contain a replayable message payload.');
    const pluginId = String(source?.request?.payload?.diagnostics?.pluginId || source?.pluginId || '').trim();
    const config = validateConfig(payload.config || {});
    const presetKey = makePresetKey(requestTitle, pluginId);
    await store.savePreset({ presetKey, requestTitle, pluginId, config });
    const experiment = {
      id: makeId('arena'), presetKey, requestTitle, pluginId, projectName: source.projectName,
      sourceFilename: source.filename, source, config, status: 'running', createdAt: new Date().toISOString()
    };
    await store.createExperiment(experiment);
    const controller = new AbortController();
    active.set(experiment.id, { controller, phase: 'running', stopMode: null });
    emitProgress({
      experimentId: experiment.id,
      type: 'experiment-started',
      experiment: { id: experiment.id, requestTitle, status: experiment.status, createdAt: experiment.createdAt }
    });

    const tasks = [];
    for (const candidate of config.contestants) {
      for (let repetition = 1; repetition <= config.repetitions; repetition++) tasks.push(executeRun(experiment, candidate, repetition, controller));
    }
    Promise.allSettled(tasks).then(async () => {
      const latest = await store.getExperiment(experiment.id);
      const context = active.get(experiment.id);
      const stopMode = context?.stopMode || (controller.signal.aborted ? 'cancel' : null);
      const summary = buildSummary(latest.runs);
      if (stopMode === 'cancel') {
        await store.updateExperiment(experiment.id, { status: 'cancelled', completedAt: new Date().toISOString(), summary });
        emitProgress({ experimentId: experiment.id, type: 'experiment-finished', status: 'cancelled', summary });
      } else if (config.judge.enabled) {
        const successfulRuns = latest.runs.filter(run => run.status === 'completed');
        if (stopMode === 'judge' && successfulRuns.length === 0) {
          await store.updateExperiment(experiment.id, { status: 'cancelled', completedAt: new Date().toISOString(), summary });
          emitProgress({ experimentId: experiment.id, type: 'experiment-finished', status: 'cancelled', summary, judgeError: 'No successful Arena calls were available to judge.' });
          active.delete(experiment.id);
          return;
        }
        if (context) {
          context.phase = 'judging';
          if (stopMode === 'judge') context.controller = new AbortController();
        }
        await judgeExperiment(experiment.id).catch(async error => {
          const judgeCancelled = context?.stopMode === 'cancel' || context?.controller?.signal?.aborted;
          const status = judgeCancelled ? 'cancelled' : 'completed';
          const judge = { error: error?.message || String(error), cancelled: judgeCancelled };
          await store.updateExperiment(experiment.id, { status, completedAt: new Date().toISOString(), summary, judge });
          emitProgress({ experimentId: experiment.id, type: 'experiment-finished', status, summary, judgeError: judge.error, judgeCancelled });
        });
      } else {
        await store.updateExperiment(experiment.id, { status: 'completed', completedAt: new Date().toISOString(), summary });
        emitProgress({ experimentId: experiment.id, type: 'experiment-finished', status: 'completed', summary });
      }
      active.delete(experiment.id);
    }).catch(error => Logger.error('LogArena', 'Execution', error));
    return experiment;
  }

  async function runManualJudging(id, judgeOverride = null, options = {}) {
    if (active.has(id)) throw new Error('This Arena experiment is already running or judging.');
    const experiment = await store.getExperiment(id);
    if (!experiment) throw new Error('Arena experiment not found.');
    if (!experiment.runs.some(run => run.status === 'completed')) throw new Error('This experiment has no successful calls to judge.');
    const judge = judgeOverride || experiment.config?.judge;
    if (!judge?.enabled || !judge.provider || !judge.model) throw new Error('Judge is not configured for this experiment.');

    const context = { controller: new AbortController(), phase: 'judging', stopMode: null };
    active.set(id, context);
    try {
      await judgeExperiment(id, judge, options);
      return store.getExperiment(id);
    } catch (error) {
      const cancelled = context.stopMode === 'cancel' || context.controller.signal.aborted;
      const status = cancelled ? 'judge-cancelled' : 'judge-failed';
      const storedJudge = { error: error?.message || String(error), cancelled };
      const failurePatch = { status, completedAt: new Date().toISOString() };
      if (!options.retryFailedOnly) failurePatch.judge = storedJudge;
      await store.updateExperiment(id, failurePatch);
      emitProgress({ experimentId: id, type: 'experiment-finished', status, judgeError: storedJudge.error, judgeCancelled: cancelled });
      throw error;
    } finally {
      active.delete(id);
    }
  }

  const rejudgeExperiment = (id, judgeOverride = null) => runManualJudging(id, judgeOverride);
  const retryFailedJudgements = (id, judgeOverride = null) => runManualJudging(id, judgeOverride, { retryFailedOnly: true });

  return {
    store,
    makePresetKey,
    listProviders: () => listConfiguredProviders(),
    savePreset: input => store.savePreset({ ...input, presetKey: input.presetKey || makePresetKey(input.requestTitle, input.pluginId) }),
    getPreset: ({ requestTitle, pluginId = '' }) => store.getPreset(makePresetKey(requestTitle, pluginId)),
    listExperiments: ({ requestTitle, pluginId = '', limit }) => store.listExperiments(makePresetKey(requestTitle, pluginId), limit),
    getExperiment: id => store.getExperiment(id),
    startExperiment,
    judgeExperiment,
    rejudgeExperiment,
    retryFailedJudgements,
    cancelExperiment: async id => {
      const context = active.get(id);
      if (!context) return false;
      context.stopMode = 'cancel';
      context.controller.abort('Arena experiment cancelled');
      return true;
    },
    stopAndJudgeExperiment: async id => {
      const context = active.get(id);
      if (!context) throw new Error('Arena experiment is not running.');
      if (context.phase !== 'running') throw new Error('Arena experiment is already stopping or judging.');
      const experiment = await store.getExperiment(id);
      if (!experiment?.config?.judge?.enabled) throw new Error('Enable and configure an LLM judge before starting the experiment.');
      if (!experiment.runs.some(run => run.status === 'completed')) throw new Error('Wait for at least one successful Arena call before stopping to judge.');
      context.phase = 'stopping-for-judge';
      context.stopMode = 'judge';
      await store.updateExperiment(id, { status: 'stopping-for-judge' });
      emitProgress({ experimentId: id, type: 'stopping-for-judge' });
      context.controller.abort('Arena contestant calls stopped for judging');
      return true;
    },
    pinExperiment: async (id, pinned) => { await store.updateExperiment(id, { pinned }); return true; },
    deleteExperiment: async id => { if (active.has(id)) throw new Error('Cancel the running experiment before deleting it.'); return store.deleteExperiment(id); },
    close: () => store.close(),
    constants: { MAX_CONTESTANTS, MAX_REPETITIONS }
  };
}

module.exports = {
  LogArenaStore,
  createLogArenaService,
  getUsageMetrics,
  isContextLimitError,
  aggregateJudgements,
  MAX_CONTESTANTS,
  MAX_REPETITIONS
};

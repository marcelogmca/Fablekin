(function exposeLogArenaUi(root) {
    function create({ socket }) {
        const state = {
            providers: [],
            limits: { MAX_CONTESTANTS: 8, MAX_REPETITIONS: 10 },
            bundle: null,
            source: null,
            config: null,
            experiment: null,
            activeExperimentId: null,
            history: [],
            saveTimer: null
        };

        const uid = () => (globalThis.crypto?.randomUUID?.() || `candidate_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        const escapeHtml = value => String(value ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        const pretty = value => {
            if (typeof value === 'string') return value;
            try { return JSON.stringify(value, null, 2); } catch { return String(value); }
        };
        const formatDuration = value => {
            const ms = Number(value);
            if (!Number.isFinite(ms)) return '-';
            return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
        };
        const formatCost = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? `$${Number(value).toFixed(6)}` : '-';
        const median = values => {
            const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
            return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
        };
        const reasoningEffortProviders = new Set(['nano_gpt', 'openrouter', 'openai', 'deepseek', 'generic']);
        const getPluginId = source => source?.request?.payload?.diagnostics?.pluginId || source?.pluginId || '';
        const isReplayable = source => Array.isArray(source?.request?.payload?.content) || Array.isArray(source?.request?.payload?.content?.messages);

        const overlay = document.createElement('div');
        overlay.className = 'log-arena-overlay';
        overlay.innerHTML = `
            <div class="log-arena-shell" role="dialog" aria-modal="true" aria-label="LLM Arena">
                <header class="log-arena-header">
                    <div class="log-arena-title"><h2>LLM Arena</h2><small class="arena-header-subtitle"></small></div>
                    <button type="button" class="log-arena-close" aria-label="Close Arena">Close</button>
                </header>
                <main class="log-arena-body">
                    <section class="arena-section arena-source-section"></section>
                    <section class="arena-section arena-config-section"></section>
                    <section class="arena-section arena-results-section"></section>
                    <section class="arena-section arena-judge-section"></section>
                    <section class="arena-section arena-history-section"></section>
                </main>
            </div>`;
        document.body.appendChild(overlay);

        const sourceSection = overlay.querySelector('.arena-source-section');
        const configSection = overlay.querySelector('.arena-config-section');
        const resultsSection = overlay.querySelector('.arena-results-section');
        const judgeSection = overlay.querySelector('.arena-judge-section');
        const historySection = overlay.querySelector('.arena-history-section');
        const subtitle = overlay.querySelector('.arena-header-subtitle');

        function defaultConfig(source) {
            const provider = source?.response?.payload?.provider || source?.request?.payload?.provider || state.providers[0] || '';
            const model = source?.response?.payload?.model || source?.request?.payload?.model || '';
            return {
                repetitions: 1,
                contestants: [{ id: uid(), label: 'Current', provider, model, reasoningEffort: '' }],
                judge: { enabled: false, provider: provider || state.providers[0] || '', model: model || '', reasoningEffort: '' }
            };
        }

        function providerOptions(selected) {
            const values = [...state.providers];
            if (selected && !values.includes(selected)) values.unshift(selected);
            return values.map(provider => `<option value="${escapeHtml(provider)}"${provider === selected ? ' selected' : ''}>${escapeHtml(provider)}</option>`).join('');
        }

        function reasoningEffortOptions(selected = '') {
            return [
                ['', 'Automatic (suffix/provider)'],
                ['none', 'None'],
                ['minimal', 'Minimal'],
                ['low', 'Low'],
                ['medium', 'Medium'],
                ['high', 'High'],
                ['xhigh', 'Extra high']
            ].map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
        }

        function effectiveEffort(configItem) {
            if (configItem?.reasoningEffort) return configItem.reasoningEffort;
            const suffix = String(configItem?.model || '').match(/:(thinking|no[_-]?thinking|nothinking)$/i)?.[1];
            if (!suffix) return 'automatic';
            return suffix.toLowerCase().replace(/[-_]/g, '') === 'thinking' ? 'high (suffix)' : 'none (suffix)';
        }

        function renderSource() {
            if (!state.source) return;
            const source = state.source;
            const invocationOptions = (state.bundle?.invocations || [source]).map((item, index) => {
                const time = item.request?.timestamp ? new Date(item.request.timestamp).toLocaleTimeString() : `#${index + 1}`;
                const selected = item === source ? ' selected' : '';
                return `<option value="${index}"${selected}>Invocation ${index + 1} - ${escapeHtml(time)}</option>`;
            }).join('');
            const requestPayload = source.request?.payload?.content;
            const responsePayload = source.response?.payload?.content;
            const metrics = source.metrics || {};
            const originalJudge = state.experiment?.judge?.candidates?.find(item => item.candidateId === 'original')?.aggregate?.overallScore;
            subtitle.textContent = `${source.requestTitle} - ${source.projectName || 'unknown project'} - ${source.filename || ''}`;
            sourceSection.innerHTML = `
                <h3>Attached production request</h3>
                <div class="arena-source-grid">
                    <div class="arena-source-meta">
                        ${(state.bundle?.invocations?.length || 0) > 1 ? `<div class="arena-field"><label>Source invocation</label><select data-arena-action="invocation">${invocationOptions}</select></div>` : ''}
                        <span><b>Title:</b> ${escapeHtml(source.requestTitle)}</span>
                        <span><b>Original route:</b> ${escapeHtml(source.response?.payload?.provider || source.request?.payload?.provider || 'unknown')} / ${escapeHtml(source.response?.payload?.model || source.request?.payload?.model || 'unknown')}</span>
                        <span><b>Original performance:</b> ${formatDuration(metrics.duration ? metrics.duration * 1000 : metrics.durationMs)} · ${formatCost(metrics.cost ?? metrics.totalCost)}</span>
                        <span><b>Original judge score:</b> ${originalJudge !== null && originalJudge !== undefined && Number.isFinite(Number(originalJudge)) ? Number(originalJudge).toFixed(1) : '-'}</span>
                        <span><b>Plugin:</b> ${escapeHtml(getPluginId(source) || 'core')}</span>
                        ${isReplayable(source) ? '' : '<span class="arena-status-error"><b>Not replayable:</b> this log entry does not contain an OpenAI-style message array.</span>'}
                        <details><summary>Original response baseline</summary><pre class="arena-output">${escapeHtml(pretty(responsePayload ?? 'No paired response.'))}</pre></details>
                    </div>
                    <pre class="arena-json">${escapeHtml(pretty(requestPayload))}</pre>
                </div>`;
        }

        function renderConfig() {
            if (!state.config) return;
            const contestants = state.config.contestants.map((contestant, index) => {
                const supportsEffort = reasoningEffortProviders.has(contestant.provider);
                const assistantInjection = contestant.promptModifications?.find(item => item.type === 'insert_message_after_system' && item.role === 'assistant');
                const modificationCount = assistantInjection?.content ? 1 : 0;
                return `
                <div class="arena-contestant-row" data-candidate-id="${escapeHtml(contestant.id)}">
                    <div class="arena-field"><label>Label</label><input data-field="label" value="${escapeHtml(contestant.label)}"></div>
                    <div class="arena-field"><label>Provider credentials</label><select data-field="provider">${providerOptions(contestant.provider)}</select></div>
                    <div class="arena-field"><label>Raw model ID</label><input data-field="model" value="${escapeHtml(contestant.model)}" placeholder="vendor/model-name"></div>
                    <div class="arena-field"><label>Thinking effort</label><select data-field="reasoning-effort"${supportsEffort ? '' : ' disabled title="Not supported by this provider adapter"'}>${reasoningEffortOptions(contestant.reasoningEffort || '')}</select></div>
                    <button type="button" class="arena-btn danger" data-arena-action="remove-candidate"${state.config.contestants.length <= 1 ? ' disabled' : ''}>Remove</button>
                    <details class="arena-prompt-modifications">
                        <summary>Prompt modifications${modificationCount ? ` (${modificationCount})` : ''}</summary>
                        <div class="arena-prompt-modification-body">
                            <label><input type="checkbox" data-field="assistant-injection-enabled"${assistantInjection ? ' checked' : ''}> Insert an assistant message after the initial system message(s)</label>
                            <div class="arena-field">
                                <label>Assistant message content</label>
                                <textarea data-field="assistant-injection-content" rows="9" placeholder="Paste the reasoning scaffold or CoT here…">${escapeHtml(assistantInjection?.content || '')}</textarea>
                            </div>
                            <small>This message is sent only to this contestant. The blind judge receives the untouched original request and anonymous outputs.</small>
                        </div>
                    </details>
                </div>`;
            }).join('');
            const running = !!state.activeExperimentId;
            const successfulRuns = (state.experiment?.runs || []).filter(run => run.status === 'completed').length;
            const stoppingForJudge = state.experiment?.status === 'stopping-for-judge';
            const judging = state.experiment?.status === 'judging';
            const canStopAndJudge = running && !stoppingForJudge && !judging && state.config.judge.enabled && successfulRuns > 0;
            const judgeProgress = state.experiment?.judgeProgress;
            const refusalRetry = state.experiment?.refusalRetry;
            const progressLabel = judging
                ? `Judge working…${judgeProgress ? ` ${judgeProgress.completed}/${judgeProgress.total} candidates evaluated` : ''}`
                : stoppingForJudge
                ? `Stopping unfinished calls… ${successfulRuns} successful call${successfulRuns === 1 ? '' : 's'} will be judged`
                : running
                    ? refusalRetry
                        ? `Retrying ${refusalRetry.run?.candidateLabel || 'Arena call'} after refusal… ${refusalRetry.attempt}/${refusalRetry.totalAttempts}`
                        : `Experiment running… ${successfulRuns} successful call${successfulRuns === 1 ? '' : 's'}`
                    : 'Ready · all calls launch concurrently';
            configSection.innerHTML = `
                <h3>Experiment setup</h3>
                <div class="arena-grid">
                    <div class="arena-field"><label>Repetitions per contestant</label><input type="number" data-config="repetitions" min="1" max="${state.limits.MAX_REPETITIONS || 10}" value="${state.config.repetitions}"></div>
                    <div class="arena-field"><label>Judge</label><label><input type="checkbox" data-config="judge-enabled"${state.config.judge.enabled ? ' checked' : ''}> Use an LLM judge after all runs</label></div>
                    <div class="arena-field"><label>Judge provider</label><select data-config="judge-provider"${state.config.judge.enabled ? '' : ' disabled'}>${providerOptions(state.config.judge.provider)}</select></div>
                    <div class="arena-field"><label>Judge raw model ID</label><input data-config="judge-model" value="${escapeHtml(state.config.judge.model)}"${state.config.judge.enabled ? '' : ' disabled'}></div>
                    <div class="arena-field"><label>Judge thinking effort</label><select data-config="judge-reasoning-effort"${state.config.judge.enabled && reasoningEffortProviders.has(state.config.judge.provider) ? '' : ' disabled'}>${reasoningEffortOptions(state.config.judge.reasoningEffort || '')}</select></div>
                </div>
                <div class="arena-contestants">${contestants}</div>
                <div class="arena-toolbar" style="margin-top:10px">
                    <button type="button" class="arena-btn" data-arena-action="add-candidate"${state.config.contestants.length >= (state.limits.MAX_CONTESTANTS || 8) ? ' disabled' : ''}>+ Add contestant</button>
                    <button type="button" class="arena-btn primary" data-arena-action="start"${running || !isReplayable(state.source) ? ' disabled' : ''}>Start all calls</button>
                    <button type="button" class="arena-btn primary" data-arena-action="stop-and-judge"${canStopAndJudge ? '' : ' disabled'}>Stop &amp; judge</button>
                    <button type="button" class="arena-btn danger" data-arena-action="cancel"${running ? '' : ' disabled'}>Cancel</button>
                    <span class="arena-progress">${progressLabel}</span>
                </div>`;
        }

        function groupRuns(runs) {
            const groups = new Map();
            (runs || []).filter(run => !run.isOriginal).forEach(run => {
                if (!groups.has(run.candidateId)) groups.set(run.candidateId, []);
                groups.get(run.candidateId).push(run);
            });
            return Array.from(groups.values());
        }

        function renderResults() {
            const experiment = state.experiment;
            if (!experiment) {
                resultsSection.innerHTML = '<h3>Results</h3><p>No experiment selected.</p>';
                return;
            }
            if (experiment.error) {
                resultsSection.innerHTML = `<h3>Results · ${escapeHtml(experiment.status || 'error')}</h3><pre class="arena-output arena-status-error">${escapeHtml(experiment.error)}</pre>`;
                return;
            }
            const groups = groupRuns(experiment.runs);
            const rows = groups.map(runs => {
                const completed = runs.filter(run => run.status === 'completed');
                const durations = completed.map(run => Number(run.durationMs));
                const metricValues = key => completed.map(run => run.metrics?.[key])
                    .filter(value => value !== null && value !== undefined && value !== '')
                    .map(Number).filter(Number.isFinite);
                const costs = metricValues('totalCost');
                const outputTokens = metricValues('outputTokens');
                const speeds = metricValues('tokensPerSecond');
                const storedScore = experiment.judge?.candidates?.find(item => item.candidateId === runs[0].candidateId)?.aggregate?.overallScore;
                const persistedRunScores = completed
                    .filter(run => run.judge?.overall_score !== null && run.judge?.overall_score !== undefined)
                    .map(run => Number(run.judge.overall_score)).filter(Number.isFinite);
                const score = storedScore ?? (persistedRunScores.length ? persistedRunScores.reduce((sum, value) => sum + value, 0) / persistedRunScores.length : null);
                const durationRange = durations.length ? `${formatDuration(Math.min(...durations))}–${formatDuration(Math.max(...durations))}` : '-';
                const contestantConfig = experiment.config?.contestants?.find(item => item.id === runs[0].candidateId);
                return `<tr><td>${escapeHtml(runs[0].candidateLabel)}</td><td>${escapeHtml(runs[0].provider)}</td><td>${escapeHtml(runs[0].model)}</td><td>${escapeHtml(effectiveEffort(contestantConfig || { model: runs[0].model }))}</td>
                    <td class="numeric">${completed.length}/${runs.length}</td><td class="numeric">${formatDuration(median(durations))}</td>
                    <td class="numeric">${durationRange}</td><td class="numeric">${costs.length ? formatCost(costs.reduce((sum, value) => sum + value, 0) / costs.length) : '-'}</td>
                    <td class="numeric">${outputTokens.length ? Math.round(outputTokens.reduce((sum, value) => sum + value, 0) / outputTokens.length).toLocaleString() : '-'}</td>
                    <td class="numeric">${speeds.length ? (speeds.reduce((sum, value) => sum + value, 0) / speeds.length).toFixed(1) : '-'}</td>
                    <td class="numeric">${score !== null && score !== undefined && Number.isFinite(Number(score)) ? Number(score).toFixed(1) : '-'}</td></tr>`;
            }).join('');
            const details = groups.flatMap(runs => runs).map(run => `
                <details class="arena-run-card">
                    <summary>${escapeHtml(run.candidateLabel)} · repetition ${run.repetition} · ${escapeHtml(run.status)} · ${formatDuration(run.durationMs)} · ${formatCost(run.metrics?.totalCost)}</summary>
                    ${run.error ? `<pre class="arena-output arena-status-error">${escapeHtml(pretty(run.error))}</pre>` : `<pre class="arena-output">${escapeHtml(pretty(run.response))}</pre>`}
                    ${run.judge ? `<pre class="arena-output">Judge: ${escapeHtml(pretty(run.judge))}</pre>` : ''}
                </details>`).join('');
            resultsSection.innerHTML = `
                <h3>Results · ${escapeHtml(experiment.status || 'running')}</h3>
                <div class="arena-results-scroll"><table class="arena-results-table"><thead><tr><th>Candidate</th><th>Provider</th><th>Model</th><th>Effort</th><th class="numeric">Success</th><th class="numeric">Median</th><th class="numeric">Range</th><th class="numeric">Avg cost</th><th class="numeric">Avg output</th><th class="numeric">Avg tok/s</th><th class="numeric">Judge</th></tr></thead><tbody>${rows || '<tr><td colspan="11">Waiting for calls…</td></tr>'}</tbody></table></div>
                <div class="arena-result-details">${details}</div>`;
        }

        function renderJudge() {
            const judge = state.experiment?.judge;
            const judging = state.experiment?.status === 'judging';
            const successfulRunCount = (state.experiment?.runs || []).filter(run => run.status === 'completed').length;
            const canRejudge = !!state.experiment?.id && !state.activeExperimentId && successfulRunCount > 0
                && state.config?.judge?.enabled && state.config.judge.provider && state.config.judge.model;
            const hasJudgeHistory = !!judge && (Array.isArray(judge.candidates) || !!judge.error)
                || (state.experiment?.runs || []).some(run => run.judge);
            const hasScore = value => value !== null && value !== undefined && Number.isFinite(Number(value));
            let failedJudgeCount = (state.experiment?.runs || []).filter(run => run.status === 'completed' && !hasScore(run.judge?.overall_score)).length;
            if (state.experiment?.source?.response && judge) {
                const originalJudge = judge.candidates?.find(candidate => candidate.candidateId === 'original');
                if (!hasScore(originalJudge?.aggregate?.overallScore)) failedJudgeCount += 1;
            }
            const retryFailedButton = canRejudge && hasJudgeHistory && failedJudgeCount > 0
                ? `<button type="button" class="arena-btn primary" data-arena-action="retry-failed-judges">Retry failed judges (${failedJudgeCount})</button>`
                : '';
            const rejudgeButton = canRejudge
                ? `<div class="arena-toolbar" style="margin-top:10px">${retryFailedButton}<button type="button" class="arena-btn" data-arena-action="rerun-judge">Re-run all judges</button><span>Uses stored successful outputs; contestant calls will not run again.</span></div>`
                : '';
            const persistedCandidates = groupRuns(state.experiment?.runs).map(runs => {
                const scores = runs
                    .filter(run => run.judge?.overall_score !== null && run.judge?.overall_score !== undefined)
                    .map(run => Number(run.judge.overall_score)).filter(Number.isFinite);
                return scores.length ? {
                    candidateId: runs[0].candidateId,
                    aggregate: { judgedCount: scores.length, overallScore: scores.reduce((sum, value) => sum + value, 0) / scores.length }
                } : null;
            }).filter(Boolean);
            if (judge?.error) {
                judgeSection.innerHTML = `<h3>Judge analysis · ${judge.cancelled ? 'cancelled' : 'failed'}</h3><pre class="arena-output arena-status-error">${escapeHtml(judge.error)}</pre>${rejudgeButton}`;
                return;
            }
            if (judge || judging || persistedCandidates.length > 0) {
                const progress = state.experiment?.judgeProgress;
                const candidates = judge?.candidates?.length ? judge.candidates : persistedCandidates;
                const candidateRows = candidates.map(candidate => `<tr>
                    <td>${escapeHtml(candidate.candidateId === 'original' ? 'Original baseline' : (state.config?.contestants?.find(item => item.id === candidate.candidateId)?.label || candidate.candidateId))}</td>
                    <td class="numeric">${candidate.aggregate?.judgedCount ?? 0}</td>
                    <td class="numeric">${candidate.aggregate?.overallScore !== null && candidate.aggregate?.overallScore !== undefined && Number.isFinite(Number(candidate.aggregate.overallScore)) ? Number(candidate.aggregate.overallScore).toFixed(1) : '-'}</td>
                </tr>`).join('');
                const interrupted = state.experiment?.status === 'interrupted';
                const judgeConfig = state.experiment?.config?.judge || state.config?.judge;
                judgeSection.innerHTML = `<h3>Judge analysis${judging ? ' · working' : interrupted ? ' · interrupted (partial results)' : ''}</h3>
                    <p>Judge route: ${escapeHtml(judgeConfig?.provider || '-')} / ${escapeHtml(judgeConfig?.model || '-')} · effort ${escapeHtml(effectiveEffort(judgeConfig))}</p>
                    ${judging ? `<p>Evaluating successful outputs${progress ? ` · ${progress.completed}/${progress.total} candidates complete` : '…'}</p>` : ''}
                    ${candidateRows ? `<table class="arena-results-table"><thead><tr><th>Candidate</th><th class="numeric">Responses judged</th><th class="numeric">Score</th></tr></thead><tbody>${candidateRows}</tbody></table>` : ''}
                    <div class="arena-judge-panel"><div><b>Prompt quality</b><pre class="arena-json">${escapeHtml(pretty(judge?.promptQuality || (interrupted ? 'Unavailable: judging was interrupted before the final analysis was saved.' : 'Still working…')))}</pre></div><div><b>Blind comparison</b><pre class="arena-json">${escapeHtml(pretty(judge?.comparison || (interrupted ? 'Unavailable: judging was interrupted before the final comparison.' : 'Still working…')))}</pre></div></div>
                    ${rejudgeButton}`;
                return;
            }
            judgeSection.innerHTML = `<h3>Judge analysis</h3><p>Enable a judge before starting, or open a judged experiment from history.</p>${rejudgeButton}`;
        }

        function renderHistory() {
            const items = state.history.map(item => `
                <div class="arena-history-item" data-experiment-id="${escapeHtml(item.id)}">
                    <div><b>${item.pinned ? '📌 ' : ''}${escapeHtml(new Date(item.createdAt).toLocaleString())}</b> · ${escapeHtml(item.status)}<br><small>${escapeHtml(item.projectName || '')}</small></div>
                    <div class="arena-history-actions">
                        <button class="arena-btn" data-arena-action="load-history">Open</button>
                        <button class="arena-btn" data-arena-action="pin-history">${item.pinned ? 'Unpin' : 'Pin'}</button>
                        <button class="arena-btn danger" data-arena-action="delete-history">Delete</button>
                    </div>
                </div>`).join('');
            historySection.innerHTML = `<h3>Experiment history</h3><div class="arena-history-list">${items || '<p>No saved experiments for this request title.</p>'}</div>`;
        }

        function renderAll() {
            renderSource();
            renderConfig();
            renderResults();
            renderJudge();
            renderHistory();
        }

        function readConfigFromDom() {
            const contestants = Array.from(configSection.querySelectorAll('.arena-contestant-row')).map((row, index) => {
                const injectionEnabled = row.querySelector('[data-field="assistant-injection-enabled"]')?.checked === true;
                const injectionContent = row.querySelector('[data-field="assistant-injection-content"]')?.value || '';
                return {
                    id: row.dataset.candidateId || uid(),
                    label: row.querySelector('[data-field="label"]')?.value.trim() || `Candidate ${index + 1}`,
                    provider: row.querySelector('[data-field="provider"]')?.value || '',
                    model: row.querySelector('[data-field="model"]')?.value.trim() || '',
                    reasoningEffort: row.querySelector('[data-field="reasoning-effort"]')?.value || '',
                    promptModifications: injectionEnabled && injectionContent.trim() ? [{
                        type: 'insert_message_after_system',
                        role: 'assistant',
                        content: injectionContent
                    }] : []
                };
            });
            state.config = {
                repetitions: Math.max(1, Math.min(state.limits.MAX_REPETITIONS || 10, Number(configSection.querySelector('[data-config="repetitions"]')?.value) || 1)),
                contestants,
                judge: {
                    enabled: configSection.querySelector('[data-config="judge-enabled"]')?.checked === true,
                    provider: configSection.querySelector('[data-config="judge-provider"]')?.value || '',
                    model: configSection.querySelector('[data-config="judge-model"]')?.value.trim() || '',
                    reasoningEffort: configSection.querySelector('[data-config="judge-reasoning-effort"]')?.value || ''
                }
            };
            return state.config;
        }

        function schedulePresetSave() {
            clearTimeout(state.saveTimer);
            state.saveTimer = setTimeout(() => {
                if (!state.source || !state.config) return;
                socket.emit('save-log-arena-preset', {
                    requestTitle: state.source.requestTitle,
                    pluginId: getPluginId(state.source),
                    config: state.config
                });
            }, 400);
        }

        function requestPresetAndHistory() {
            if (!state.source) return;
            const payload = { requestTitle: state.source.requestTitle, pluginId: getPluginId(state.source) };
            socket.emit('get-log-arena-preset', payload);
            socket.emit('list-log-arena-experiments', payload);
        }

        function selectInvocation(index) {
            const next = state.bundle?.invocations?.[Number(index)];
            if (!next) return;
            state.source = next;
            state.config = defaultConfig(next);
            state.experiment = null;
            state.history = [];
            renderAll();
            requestPresetAndHistory();
        }

        function startExperiment() {
            const config = readConfigFromDom();
            schedulePresetSave();
            state.experiment = { status: 'starting', runs: [], source: state.source, config };
            renderResults();
            socket.emit('start-log-arena-experiment', { source: state.source, config });
        }

        configSection.addEventListener('input', () => {
            readConfigFromDom();
            schedulePresetSave();
        });
        configSection.addEventListener('change', event => {
            readConfigFromDom();
            if (event.target.matches('[data-field="provider"], [data-config="judge-provider"]')) {
                state.config.contestants.forEach(contestant => {
                    if (!reasoningEffortProviders.has(contestant.provider)) contestant.reasoningEffort = '';
                });
                if (!reasoningEffortProviders.has(state.config.judge.provider)) state.config.judge.reasoningEffort = '';
                renderConfig();
            } else if (event.target.matches('[data-config="judge-enabled"]')) renderConfig();
            schedulePresetSave();
        });

        overlay.addEventListener('click', event => {
            const action = event.target.closest('[data-arena-action]')?.dataset.arenaAction;
            if (!action) return;
            if (action === 'invocation') return;
            if (action === 'add-candidate') {
                readConfigFromDom();
                if (state.config.contestants.length < (state.limits.MAX_CONTESTANTS || 8)) {
                    state.config.contestants.push({ id: uid(), label: `Candidate ${state.config.contestants.length + 1}`, provider: state.providers[0] || '', model: '', reasoningEffort: '', promptModifications: [] });
                    renderConfig(); schedulePresetSave();
                }
            } else if (action === 'remove-candidate') {
                readConfigFromDom();
                const id = event.target.closest('.arena-contestant-row')?.dataset.candidateId;
                state.config.contestants = state.config.contestants.filter(item => item.id !== id);
                renderConfig(); schedulePresetSave();
            } else if (action === 'start') startExperiment();
            else if (action === 'stop-and-judge' && state.activeExperimentId) socket.emit('stop-log-arena-and-judge', { id: state.activeExperimentId });
            else if (action === 'rerun-judge' && state.experiment?.id && !state.activeExperimentId) {
                state.activeExperimentId = state.experiment.id;
                state.experiment.status = 'judging';
                state.experiment.judge = { candidates: [] };
                state.experiment.judgeProgress = null;
                renderConfig(); renderResults(); renderJudge();
                socket.emit('judge-log-arena-experiment', { id: state.experiment.id });
            }
            else if (action === 'retry-failed-judges' && state.experiment?.id && !state.activeExperimentId) {
                state.activeExperimentId = state.experiment.id;
                state.experiment.status = 'judging';
                state.experiment.judgeProgress = null;
                renderConfig(); renderResults(); renderJudge();
                socket.emit('retry-failed-log-arena-judges', { id: state.experiment.id });
            }
            else if (action === 'cancel' && state.activeExperimentId) socket.emit('cancel-log-arena-experiment', { id: state.activeExperimentId });
            else if (['load-history', 'pin-history', 'delete-history'].includes(action)) {
                const id = event.target.closest('[data-experiment-id]')?.dataset.experimentId;
                const historyItem = state.history.find(item => item.id === id);
                if (action === 'load-history') socket.emit('get-log-arena-experiment', { id });
                if (action === 'pin-history') socket.emit('pin-log-arena-experiment', { id, pinned: !historyItem?.pinned });
                if (action === 'delete-history' && confirm('Delete this Arena experiment and all stored outputs?')) socket.emit('delete-log-arena-experiment', { id });
            }
        });

        sourceSection.addEventListener('change', event => {
            if (event.target.matches('[data-arena-action="invocation"]')) selectInvocation(event.target.value);
        });
        overlay.querySelector('.log-arena-close').addEventListener('click', () => overlay.classList.remove('open'));
        overlay.addEventListener('click', event => { if (event.target === overlay) overlay.classList.remove('open'); });
        window.addEventListener('keydown', event => { if (event.key === 'Escape' && overlay.classList.contains('open')) overlay.classList.remove('open'); });

        socket.on('get-log-arena-providers-response', response => {
            if (!response.success) return;
            state.providers = response.result?.providers || [];
            state.limits = response.result?.limits || state.limits;
            if (state.config) renderConfig();
        });
        socket.on('get-log-arena-preset-response', response => {
            if (!response.success || !state.source || response.requestTitle !== state.source.requestTitle || (response.pluginId || '') !== getPluginId(state.source)) return;
            if (response.result?.config) state.config = response.result.config;
            renderConfig();
        });
        socket.on('list-log-arena-experiments-response', response => {
            if (!response.success || !state.source || response.requestTitle !== state.source.requestTitle || (response.pluginId || '') !== getPluginId(state.source)) return;
            state.history = response.result || [];
            renderHistory();
            if (!state.experiment && state.history.length > 0) socket.emit('get-log-arena-experiment', { id: state.history[0].id });
        });
        socket.on('start-log-arena-experiment-response', response => {
            if (state.source && response.requestTitle && response.requestTitle !== state.source.requestTitle) return;
            if (!response.success) {
                state.activeExperimentId = null;
                state.experiment = { ...(state.experiment || {}), status: 'failed-to-start', error: response.error, runs: [] };
                renderConfig(); renderResults();
                return;
            }
            state.activeExperimentId = response.result.id;
            const existingRuns = state.experiment?.runs || [];
            state.experiment = { ...response.result, runs: existingRuns };
            renderConfig(); renderResults();
        });
        socket.on('log-arena-progress', event => {
            if (!event?.experimentId) return;
            if (state.activeExperimentId && event.experimentId !== state.activeExperimentId) return;
            if (!state.activeExperimentId && event.type === 'experiment-started' && overlay.classList.contains('open')) state.activeExperimentId = event.experimentId;
            if (event.experimentId !== state.activeExperimentId) return;
            state.experiment = state.experiment || { id: event.experimentId, runs: [] };
            if (event.type === 'run-started' || event.type === 'run-finished') {
                const index = state.experiment.runs.findIndex(run => run.id === event.run.id);
                if (index >= 0) state.experiment.runs[index] = event.run;
                else state.experiment.runs.push(event.run);
            }
            if (event.type === 'run-retrying') state.experiment.refusalRetry = event;
            if (event.type === 'run-finished') state.experiment.refusalRetry = null;
            if (event.type === 'stopping-for-judge') state.experiment.status = 'stopping-for-judge';
            if (event.type === 'judging-started') {
                state.experiment.status = 'judging';
                if (!event.retryFailedOnly) state.experiment.judge = { candidates: [] };
                state.experiment.judgeProgress = null;
            }
            if (event.type === 'prompt-quality-finished') {
                state.experiment.judge = state.experiment.judge || { candidates: [] };
                state.experiment.judge.promptQuality = event.promptQuality;
            }
            if (event.type === 'candidate-judged') {
                state.experiment.judge = state.experiment.judge || { candidates: [] };
                state.experiment.judge.candidates = state.experiment.judge.candidates || [];
                const candidateIndex = state.experiment.judge.candidates.findIndex(item => item.candidateId === event.candidate.candidateId);
                if (candidateIndex >= 0) state.experiment.judge.candidates[candidateIndex] = event.candidate;
                else state.experiment.judge.candidates.push(event.candidate);
                state.experiment.judgeProgress = { completed: event.completed, total: event.total };
            }
            if (event.type === 'judging-finished') { state.experiment.status = 'completed'; state.experiment.judge = event.judge; }
            if (event.type === 'experiment-finished') {
                state.experiment.status = event.status;
                if (event.judgeError) state.experiment.judge = { error: event.judgeError, cancelled: event.judgeCancelled === true };
            }
            if (event.type === 'experiment-finished' || event.type === 'judging-finished') {
                state.activeExperimentId = null;
                socket.emit('get-log-arena-experiment', { id: event.experimentId });
                requestPresetAndHistory();
            }
            renderConfig(); renderResults(); renderJudge();
        });
        socket.on('stop-log-arena-and-judge-response', response => {
            if (!response.success) alert(response.error || 'Could not stop the Arena calls for judging.');
        });
        socket.on('judge-log-arena-experiment-response', response => {
            if (response.success) return;
            if (state.activeExperimentId === response.id) state.activeExperimentId = null;
            alert(response.error || 'Could not re-run the judge.');
            if (response.id) socket.emit('get-log-arena-experiment', { id: response.id });
            renderConfig(); renderJudge();
        });
        socket.on('retry-failed-log-arena-judges-response', response => {
            if (response.success) return;
            if (state.activeExperimentId === response.id) state.activeExperimentId = null;
            alert(response.error || 'Could not retry the failed judge results.');
            if (response.id) socket.emit('get-log-arena-experiment', { id: response.id });
            renderConfig(); renderJudge();
        });
        socket.on('get-log-arena-experiment-response', response => {
            if (!response.success || !response.result) return;
            state.experiment = response.result;
            state.source = response.result.source || state.source;
            state.bundle = { invocations: [state.source], selectedIndex: 0 };
            state.config = response.result.config || state.config;
            if (['running', 'stopping-for-judge', 'judging'].includes(response.result.status)) state.activeExperimentId = response.result.id;
            else if (state.activeExperimentId === response.result.id) state.activeExperimentId = null;
            renderSource(); renderConfig(); renderResults(); renderJudge();
        });
        ['pin-log-arena-experiment-response', 'delete-log-arena-experiment-response'].forEach(eventName => {
            socket.on(eventName, response => { if (response.success) requestPresetAndHistory(); });
        });

        socket.emit('get-log-arena-providers');

        return {
            open(bundle) {
                state.bundle = bundle;
                state.source = bundle?.invocations?.[bundle.selectedIndex || 0] || null;
                if (!state.source) return;
                state.config = defaultConfig(state.source);
                state.experiment = null;
                state.activeExperimentId = null;
                state.history = [];
                overlay.classList.add('open');
                renderAll();
                requestPresetAndHistory();
            }
        };
    }

    root.LogArenaUi = { create };
})(typeof globalThis !== 'undefined' ? globalThis : window);

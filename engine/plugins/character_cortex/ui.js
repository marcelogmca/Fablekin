(() => {
    const $ = selector => document.querySelector(selector);
    const $$ = selector => Array.from(document.querySelectorAll(selector));
    const state = {
        models: [], profiles: [], dimensions: [], features: { curation: false }, detail: null, profileId: null,
        currentExample: null, rating: null, personaTimer: null, personaSave: Promise.resolve(),
        profileTimer: null, scenarioSource: 'manual', busy: false, bootstrapRetryTimer: null
    };

    const events = {
        bootstrap: 'character-cortex:bootstrap', getProfile: 'character-cortex:get-profile',
        createProfile: 'character-cortex:create-profile', updateProfile: 'character-cortex:update-profile',
        archiveProfile: 'character-cortex:archive-profile', deleteProfile: 'character-cortex:delete-profile',
        duplicateProfile: 'character-cortex:duplicate-profile', savePersona: 'character-cortex:save-persona',
        saveScenario: 'character-cortex:save-scenario', generateScenario: 'character-cortex:generate-scenario',
        generateActor: 'character-cortex:generate-actor', submitFeedback: 'character-cortex:submit-feedback',
        decideProposal: 'character-cortex:decide-proposal', updatePrinciple: 'character-cortex:update-principle',
        exportProfile: 'character-cortex:export-profile', importProfile: 'character-cortex:import-profile'
    };

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }

    function toast(message, error = false) {
        const item = document.createElement('div');
        item.className = `toast${error ? ' error' : ''}`;
        item.textContent = message;
        $('#toast-region').appendChild(item);
        setTimeout(() => item.remove(), 4200);
    }

    function setBusy(value, title = 'Thinking…', detail = '') {
        state.busy = value;
        $('#busy-title').textContent = title;
        $('#busy-detail').textContent = detail;
        $('#busy-overlay').hidden = !value;
    }

    async function request(event, payload = {}, timeout = 150000) {
        const response = await bridge.request(event, payload, timeout);
        if (!response?.success) throw new Error(response?.error || 'The request failed.');
        return response.result;
    }

    function initials(name) {
        return String(name || '?').split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    }

    function renderProfiles() {
        const query = $('#profile-search').value.trim().toLowerCase();
        const showArchived = $('#show-archived').checked;
        const profiles = state.profiles.filter(profile => (showArchived || !profile.archived) && (!query || `${profile.name} ${profile.description}`.toLowerCase().includes(query)));
        $('#profile-list').innerHTML = profiles.length ? profiles.map(profile => `
            <button class="profile-item ${profile.id === state.profileId ? 'active' : ''} ${profile.archived ? 'archived' : ''}" data-profile-id="${escapeHtml(profile.id)}">
                <span class="avatar">${escapeHtml(initials(profile.name))}</span>
                <span><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.description || `${profile.rated_count || 0} rated examples`)}</small></span>
                <span class="count">${Number(profile.principle_count || 0)}</span>
            </button>`).join('') : '<div class="empty-message">No matching profiles.</div>';
        $$('.profile-item').forEach(button => button.addEventListener('click', () => selectProfile(button.dataset.profileId)));
    }

    function modelOptions(selected) {
        const exists = state.models.some(model => model.alias === selected);
        const unavailable = selected && !exists ? `<option value="${escapeHtml(selected)}" selected disabled>${escapeHtml(selected)} — unavailable</option>` : '';
        return unavailable + state.models.map(model => `<option value="${escapeHtml(model.alias)}" ${model.alias === selected ? 'selected' : ''} ${model.disabled ? 'disabled' : ''}>${escapeHtml(model.label || model.alias)}${model.disabled ? ' — unavailable' : ''}</option>`).join('');
    }

    function renderProfile() {
        const detail = state.detail;
        $('#empty-state').hidden = Boolean(detail);
        $('#profile-workspace').hidden = !detail;
        if (!detail) return;
        const profile = detail.profile;
        $('#profile-name').value = profile.name;
        $('#profile-description').value = profile.description || '';
        $('#persona-text').value = profile.persona_text || '';
        updatePersonaCount();
        $('#situation-model').innerHTML = modelOptions(profile.situation_model);
        $('#actor-model').innerHTML = modelOptions(profile.actor_model);
        $('#analysis-model').innerHTML = modelOptions(profile.analysis_model);
        $('#analysis-model').disabled = !state.features.curation;
        $('#actor-model-chip').textContent = profile.actor_model;
        $('#archive-profile').textContent = profile.archived ? 'Unarchive' : 'Archive';
        $('#policy-count').textContent = detail.principles.filter(item => item.status === 'active').length;
        renderPrinciples(); renderEvidence(); renderCoverage(); renderProposals();
        if (!state.currentExample) {
            const draft = detail.examples.find(item => item.status === 'draft');
            if (draft) loadExample(draft, false); else clearScenario();
        }
    }

    async function selectProfile(profileId) {
        if (profileId === state.profileId && state.detail) return;
        try {
            await flushPersona();
            state.profileId = profileId;
            state.currentExample = null;
            state.rating = null;
            state.detail = await request(events.getProfile, { profile_id: profileId });
            renderProfiles(); renderProfile(); activateTab('train');
        } catch (error) { toast(error.message, true); }
    }

    function updatePersonaCount() {
        $('#persona-count').textContent = `${$('#persona-text').value.length.toLocaleString()} characters`;
    }

    function schedulePersonaSave() {
        updatePersonaCount();
        $('#persona-status').textContent = 'Unsaved';
        $('#persona-status').className = 'save-state saving';
        clearTimeout(state.personaTimer);
        state.personaTimer = setTimeout(() => queuePersonaSave(), 750);
    }

    function queuePersonaSave() {
        clearTimeout(state.personaTimer);
        state.personaTimer = null;
        if (!state.profileId || !state.detail) return state.personaSave;
        const profileId = state.profileId;
        const personaText = $('#persona-text').value;
        $('#persona-status').textContent = 'Saving…';
        $('#persona-status').className = 'save-state saving';
        state.personaSave = state.personaSave.catch(() => {}).then(async () => {
            try {
                await request(events.savePersona, { profile_id: profileId, persona_text: personaText }, 30000);
                if (state.profileId === profileId) {
                    state.detail.profile.persona_text = personaText;
                    $('#persona-status').textContent = 'Saved';
                    $('#persona-status').className = 'save-state';
                }
            } catch (error) {
                $('#persona-status').textContent = 'Save failed';
                $('#persona-status').className = 'save-state error';
                toast(error.message, true);
                throw error;
            }
        });
        return state.personaSave;
    }

    async function flushPersona() {
        if (state.personaTimer) queuePersonaSave();
        await state.personaSave;
    }

    function scheduleProfileSave() {
        clearTimeout(state.profileTimer);
        state.profileTimer = setTimeout(saveProfileFields, 500);
    }

    async function saveProfileFields(extra = {}) {
        clearTimeout(state.profileTimer);
        if (!state.profileId) return;
        try {
            const profile = await request(events.updateProfile, {
                profile_id: state.profileId, name: $('#profile-name').value,
                description: $('#profile-description').value, ...extra
            });
            Object.assign(state.detail.profile, profile);
            await refreshBootstrap(false);
        } catch (error) { toast(error.message, true); }
    }

    function clearScenario() {
        state.currentExample = null;
        state.scenarioSource = 'manual';
        state.rating = null;
        $('#scenario-title').value = '';
        $('#scenario-text').value = '';
        $('#scenario-source').textContent = 'Manual';
        $('#scenario-dimensions').textContent = 'No dimensions tagged';
        $('#probe-reason').hidden = true;
        $('#probe-reason').textContent = '';
        $('#actor-response').hidden = true;
        $('#actor-response').textContent = '';
        $('#response-empty').hidden = false;
        $('#feedback-rationale').value = '';
        $('#better-direction').value = '';
        $$('#rating-group button').forEach(button => button.classList.remove('selected'));
        renderProposals();
    }

    function loadExample(example, switchTab = true) {
        state.currentExample = example;
        state.scenarioSource = example.scenario_source || 'manual';
        state.rating = example.rating || null;
        $('#scenario-title').value = example.scenario_title || '';
        $('#scenario-text').value = example.scenario_text || '';
        $('#scenario-source').textContent = state.scenarioSource === 'generated' ? 'Generated · editable' : 'Manual';
        $('#scenario-dimensions').textContent = example.target_dimensions?.length ? example.target_dimensions.join(' · ') : 'No dimensions tagged';
        $('#probe-reason').textContent = example.probe_reason || '';
        $('#probe-reason').hidden = !example.probe_reason;
        $('#actor-response').textContent = example.actor_response || '';
        $('#actor-response').hidden = !example.actor_response;
        $('#response-empty').hidden = Boolean(example.actor_response);
        $('#feedback-rationale').value = example.rationale || '';
        $('#better-direction').value = example.better_direction || '';
        $$('#rating-group button').forEach(button => button.classList.toggle('selected', Number(button.dataset.rating) === Number(example.rating)));
        renderProposals();
        if (switchTab) activateTab('train');
    }

    async function saveScenario(showToast = true) {
        if (!state.profileId) return null;
        const text = $('#scenario-text').value.trim();
        if (!text) { if (showToast) toast('Enter a situation first.', true); return null; }
        const result = await request(events.saveScenario, {
            profile_id: state.profileId, id: state.currentExample?.id,
            scenario_source: state.scenarioSource, scenario_title: $('#scenario-title').value,
            scenario_text: text, target_dimensions: state.currentExample?.target_dimensions || [],
            pressure_points: state.currentExample?.pressure_points || [], probe_reason: state.currentExample?.probe_reason || ''
        });
        state.currentExample = result;
        upsertExample(result);
        if (showToast) toast('Situation draft saved.');
        return result;
    }

    function upsertExample(example) {
        if (!state.detail) return;
        const index = state.detail.examples.findIndex(item => item.id === example.id);
        if (index >= 0) state.detail.examples[index] = example; else state.detail.examples.unshift(example);
        renderEvidence();
    }

    async function generateScenario() {
        try {
            await flushPersona();
            setBusy(true, 'Designing a behavioral probe…', 'Looking for uncertainty and underexplored dimensions');
            const example = await request(events.generateScenario, {
                profile_id: state.profileId, target_dimension: $('#target-dimension').value,
                seed: $('#scenario-seed').value
            });
            upsertExample(example); loadExample(example);
        } catch (error) { toast(error.message, true); }
        finally { setBusy(false); }
    }

    async function generateActor() {
        try {
            await flushPersona();
            const scenarioText = $('#scenario-text').value.trim();
            if (!scenarioText) return toast('Write or generate a situation first.', true);
            setBusy(true, `Portraying ${state.detail.profile.name}…`, 'Generating a compact reaction vignette');
            const example = await request(events.generateActor, {
                profile_id: state.profileId, example_id: state.currentExample?.id,
                scenario_source: state.scenarioSource, scenario_title: $('#scenario-title').value,
                scenario_text: scenarioText, target_dimensions: state.currentExample?.target_dimensions || [],
                pressure_points: state.currentExample?.pressure_points || [], probe_reason: state.currentExample?.probe_reason || ''
            });
            upsertExample(example); loadExample(example);
            toast('Reaction generated. Now teach the Cortex what worked.');
        } catch (error) { toast(error.message, true); }
        finally { setBusy(false); }
    }

    async function submitFeedback() {
        if (!state.currentExample?.actor_response) return toast('Generate a reaction before rating it.', true);
        if ($('#scenario-text').value.trim() !== state.currentExample.scenario_text.trim()) return toast('The situation changed after this reaction was generated. Generate a new reaction before rating it.', true);
        if (!state.rating) return toast('Choose a rating from 1 to 5.', true);
        const rationale = $('#feedback-rationale').value.trim();
        if (!rationale) return toast('Explain why the response earned this rating.', true);
        setBusy(true, 'Saving your judgment…', 'Preserving the complete situation, reaction, rating, and feedback');
        try {
            state.detail = await request(events.submitFeedback, {
                profile_id: state.profileId, example_id: state.currentExample.id,
                rating: state.rating, rationale, better_direction: $('#better-direction').value
            });
            state.currentExample = state.detail.examples.find(item => item.id === state.currentExample.id);
            renderProfile(); loadExample(state.currentExample, false);
            if (state.features.curation && !$('#proposal-section').hidden) {
                $('#proposal-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
                toast('Feedback saved. Review the proposed policy changes.');
            } else {
                toast('Judgment saved to the evidence list.');
            }
        } catch (error) { toast(error.message, true); }
        finally { setBusy(false); }
    }

    function renderProposals() {
        if (!state.features.curation || !state.detail || !state.currentExample) { $('#proposal-section').hidden = true; return; }
        const proposals = state.detail.proposals.filter(item => item.example_id === state.currentExample.id && item.status === 'pending');
        $('#proposal-section').hidden = !proposals.length;
        $('#proposal-list').innerHTML = proposals.map(item => `
            <div class="proposal" data-proposal-id="${escapeHtml(item.id)}">
                <div class="proposal-fields">
                    <div class="proposal-meta"><span class="badge">${escapeHtml(item.action)}</span><select data-field="relation" aria-label="Evidence relation"><option value="support" ${item.relation === 'support' ? 'selected' : ''}>support</option><option value="contradict" ${item.relation === 'contradict' ? 'selected' : ''}>contradict</option><option value="neutral" ${item.relation === 'neutral' ? 'selected' : ''}>neutral</option></select></div>
                    <input data-field="title" value="${escapeHtml(item.title)}" aria-label="Principle title">
                    <textarea data-field="statement" aria-label="Principle statement">${escapeHtml(item.statement)}</textarea>
                    <input data-field="conditions" value="${escapeHtml(item.conditions_text || '')}" placeholder="Conditions / when this applies">
                    <input data-field="instead_guidance" value="${escapeHtml(item.instead_guidance || '')}" placeholder="Preferred direction">
                    <input data-field="tags" value="${escapeHtml((item.tags || []).join(', '))}" placeholder="tags, comma separated">
                    <small class="muted">${escapeHtml(item.rationale || '')}</small>
                </div>
                <div class="proposal-actions"><button class="primary" data-decision="approve">Approve</button><button class="ghost" data-decision="reject">Reject</button></div>
            </div>`).join('');
        $$('.proposal [data-decision]').forEach(button => button.addEventListener('click', () => decideProposal(button.closest('.proposal'), button.dataset.decision)));
    }

    async function decideProposal(element, decision) {
        const edits = {
            title: element.querySelector('[data-field="title"]').value,
            statement: element.querySelector('[data-field="statement"]').value,
            conditions: element.querySelector('[data-field="conditions"]').value,
            instead_guidance: element.querySelector('[data-field="instead_guidance"]').value,
            tags: element.querySelector('[data-field="tags"]').value.split(',').map(value => value.trim()).filter(Boolean),
            relation: element.querySelector('[data-field="relation"]').value
        };
        try {
            const result = await request(events.decideProposal, { profile_id: state.profileId, proposal_id: element.dataset.proposalId, decision, edits });
            state.detail = result.detail;
            state.currentExample = state.detail.examples.find(item => item.id === state.currentExample.id);
            renderPrinciples(); renderCoverage(); renderProposals();
            $('#policy-count').textContent = state.detail.principles.filter(item => item.status === 'active').length;
            toast(decision === 'approve' ? 'Principle added to the policy.' : 'Proposal rejected and retained in history.');
        } catch (error) { toast(error.message, true); }
    }

    function renderPrinciples() {
        if (!state.detail) return;
        const query = $('#policy-search').value.trim().toLowerCase();
        const items = state.detail.principles.filter(item => !query || `${item.title} ${item.statement} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query));
        $('#principle-list').innerHTML = items.length ? items.map(item => {
            const evidence = (state.detail.principle_evidence || []).filter(link => link.principle_id === item.id);
            const revisions = (state.detail.principle_revisions || []).filter(revision => revision.principle_id === item.id);
            return `
            <article class="principle ${item.status}" data-principle-id="${escapeHtml(item.id)}">
                <div class="principle-head"><div><h3>${escapeHtml(item.title)}</h3><small class="muted">${item.support_count} support · ${item.contradiction_count} contradiction${item.support_count + item.contradiction_count < 3 ? ' · low evidence' : ''}</small></div><span class="rating-pill">${Math.round(Number(item.confidence) * 100)}%</span></div>
                <p>${escapeHtml(item.statement)}</p>
                ${item.conditions_text ? `<p><b>When:</b> ${escapeHtml(item.conditions_text)}</p>` : ''}
                ${item.instead_guidance ? `<p><b>Preferred:</b> ${escapeHtml(item.instead_guidance)}</p>` : ''}
                <div class="tags">${(item.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
                ${(evidence.length || revisions.length) ? `<details><summary>Inspect lineage · ${evidence.length} evidence · ${revisions.length} revision${revisions.length === 1 ? '' : 's'}</summary>
                    <div class="lineage-list">
                        ${evidence.map(link => `<div><span class="badge">${escapeHtml(link.relation)}</span> <b>${escapeHtml(link.scenario_title || 'Untitled situation')}</b>${link.rationale ? `<p>${escapeHtml(link.rationale)}</p>` : ''}</div>`).join('')}
                        ${revisions.map(revision => `<div><span class="badge">revision</span> <b>${escapeHtml(revision.title)}</b><p>${escapeHtml(revision.statement)}</p><small>${escapeHtml(revision.change_reason || '')}</small></div>`).join('')}
                    </div></details>` : ''}
                <div class="button-row end"><button class="ghost" data-edit-principle>Edit</button><button class="ghost" data-retire-principle>${item.status === 'retired' ? 'Restore' : 'Retire'}</button></div>
            </article>`;
        }).join('') : '<div class="empty-message">No approved principles yet. Rate a reaction and approve a proposal to begin.</div>';
        $$('[data-edit-principle]').forEach(button => button.addEventListener('click', () => editPrinciple(button.closest('.principle').dataset.principleId)));
        $$('[data-retire-principle]').forEach(button => button.addEventListener('click', () => togglePrinciple(button.closest('.principle').dataset.principleId)));
    }

    async function editPrinciple(principleId) {
        const item = state.detail.principles.find(value => value.id === principleId);
        const statement = window.prompt('Edit the behavioral principle:', item.statement);
        if (statement === null || !statement.trim()) return;
        const guidance = window.prompt('Preferred behavior or direction:', item.instead_guidance || '');
        if (guidance === null) return;
        try {
            const result = await request(events.updatePrinciple, { profile_id: state.profileId, principle_id: principleId, statement, instead_guidance: guidance, change_reason: 'Manual policy edit' });
            state.detail = result.detail; renderPrinciples(); renderCoverage(); toast('Principle revised. Previous text remains in its history.');
        } catch (error) { toast(error.message, true); }
    }

    async function togglePrinciple(principleId) {
        const item = state.detail.principles.find(value => value.id === principleId);
        try {
            const result = await request(events.updatePrinciple, { profile_id: state.profileId, principle_id: principleId, status: item.status === 'retired' ? 'active' : 'retired', change_reason: 'Manual status change' });
            state.detail = result.detail; renderPrinciples(); renderCoverage();
        } catch (error) { toast(error.message, true); }
    }

    function renderEvidence() {
        if (!state.detail) return;
        const query = $('#evidence-search').value.trim().toLowerCase();
        const items = state.detail.examples.filter(item => !query || `${item.scenario_title} ${item.scenario_text} ${item.actor_response} ${item.rationale}`.toLowerCase().includes(query));
        $('#evidence-list').innerHTML = items.length ? items.map(item => {
            const attempts = (state.detail.attempts || []).filter(attempt => attempt.example_id === item.id);
            const decisions = (state.detail.proposals || []).filter(proposal => proposal.example_id === item.id);
            return `
            <article class="evidence" data-example-id="${escapeHtml(item.id)}">
                <div class="evidence-head"><div><h3>${escapeHtml(item.scenario_title || 'Untitled situation')}</h3><small class="muted">${escapeHtml(item.scenario_source)} · ${new Date(item.updated_at).toLocaleString()}</small></div>${item.rating ? `<span class="rating-pill">${item.rating}/5</span>` : '<span class="badge">Draft</span>'}</div>
                <p>${escapeHtml(item.scenario_text)}</p>
                ${item.actor_response ? `<blockquote>${escapeHtml(item.actor_response)}</blockquote>` : ''}
                ${item.rationale ? `<p><b>Your judgment:</b> ${escapeHtml(item.rationale)}</p>` : ''}
                ${(attempts.length || decisions.length) ? `<details><summary>${attempts.length} generation attempt${attempts.length === 1 ? '' : 's'} · ${decisions.length} policy proposal${decisions.length === 1 ? '' : 's'}</summary>
                    <div class="lineage-list">${attempts.map(attempt => `<div><span class="badge">${escapeHtml(attempt.kind)}</span> ${escapeHtml(attempt.model_alias)} · attempt ${attempt.sequence}${attempt.error_text ? `<p class="danger">${escapeHtml(attempt.error_text)}</p>` : ''}</div>`).join('')}${decisions.map(proposal => `<div><span class="badge">${escapeHtml(proposal.status)}</span> <b>${escapeHtml(proposal.title)}</b><p>${escapeHtml(proposal.statement)}</p></div>`).join('')}</div>
                </details>` : ''}
                <div class="button-row end"><button class="ghost" data-open-example>Open in lab</button></div>
            </article>`;
        }).join('') : '<div class="empty-message">No evidence yet. Write or generate a situation in the Training Lab.</div>';
        $$('[data-open-example]').forEach(button => button.addEventListener('click', () => {
            const example = state.detail.examples.find(item => item.id === button.closest('.evidence').dataset.exampleId);
            if (example) loadExample(example);
        }));
    }

    function renderCoverage() {
        if (!state.detail) return;
        const max = Math.max(5, ...state.detail.coverage.map(item => item.examples));
        $('#coverage-grid').innerHTML = state.detail.coverage.map(item => `
            <article class="coverage-item"><strong>${escapeHtml(item.dimension)}</strong><div class="meter"><span style="width:${Math.round(item.examples / max * 100)}%"></span></div><small class="muted">${item.examples} example${item.examples === 1 ? '' : 's'} · ${item.principles} principle${item.principles === 1 ? '' : 's'}${item.average_rating ? ` · avg ${item.average_rating}` : ''}</small></article>`).join('');
    }

    function activateTab(name) {
        $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
        $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === name));
    }

    async function refreshBootstrap(selectFirst = true) {
        const previousId = state.profileId;
        const result = await request(events.bootstrap, {}, 30000);
        state.models = result.models; state.profiles = result.profiles; state.dimensions = result.dimensions;
        state.features = { curation: result.features?.curation === true };
        $('#target-dimension').innerHTML = '<option value="">Auto: weakest area</option>' + state.dimensions.map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
        renderProfiles();
        if (selectFirst && !previousId && state.profiles.length) await selectProfile(state.profiles.find(item => !item.archived)?.id || state.profiles[0].id);
        if (!state.profiles.length) { state.detail = null; state.profileId = null; renderProfile(); }
    }

    function isProjectUnavailable(error) {
        return /no project (?:root directory available|loaded)/i.test(String(error?.message || error));
    }

    async function bootstrapWithRetry(attempt = 0) {
        clearTimeout(state.bootstrapRetryTimer);
        state.bootstrapRetryTimer = null;
        try {
            await refreshBootstrap(true);
        } catch (error) {
            if (isProjectUnavailable(error) && attempt < 8) {
                const delay = Math.min(250 * (2 ** attempt), 2000);
                state.bootstrapRetryTimer = setTimeout(() => bootstrapWithRetry(attempt + 1), delay);
                return;
            }
            toast(`Character Cortex could not start: ${error.message}`, true);
        }
    }

    function handleProjectChanged() {
        clearTimeout(state.bootstrapRetryTimer);
        state.profileId = null;
        state.detail = null;
        state.currentExample = null;
        state.rating = null;
        renderProfile();
        bootstrapWithRetry();
    }

    function openCreateDialog() {
        $('#profile-form').reset();
        $('#profile-dialog').showModal();
        setTimeout(() => $('#new-profile-name').focus(), 0);
    }

    function closeCreateDialog() {
        $('#profile-dialog').close();
    }

    async function createProfile(event) {
        event.preventDefault();
        const name = $('#new-profile-name').value.trim();
        if (!name) return;
        try {
            const profile = await request(events.createProfile, { name, description: $('#new-profile-description').value });
            $('#profile-dialog').close();
            await refreshBootstrap(false); await selectProfile(profile.id);
        } catch (error) { toast(error.message, true); }
    }

    async function exportProfile() {
        try {
            const payload = await request(events.exportProfile, { profile_id: state.profileId }, 30000);
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url; anchor.download = `${state.detail.profile.name.replace(/[^a-z0-9_-]+/gi, '_')}_cortex.json`; anchor.click();
            URL.revokeObjectURL(url);
        } catch (error) { toast(error.message, true); }
    }

    async function importProfile(file) {
        try {
            const payload = JSON.parse(await file.text());
            const profile = await request(events.importProfile, { payload }, 60000);
            await refreshBootstrap(false); await selectProfile(profile.id); toast('Character Cortex profile imported.');
        } catch (error) { toast(`Import failed: ${error.message}`, true); }
        $('#import-file').value = '';
    }

    function bindEvents() {
        bridge.on('project-changed', handleProjectChanged);
        $('#new-profile').addEventListener('click', openCreateDialog);
        $$('[data-create-profile]').forEach(button => button.addEventListener('click', openCreateDialog));
        $('#close-profile-dialog').addEventListener('click', closeCreateDialog);
        $('#cancel-profile-dialog').addEventListener('click', closeCreateDialog);
        $('#profile-form').addEventListener('submit', createProfile);
        $('#profile-search').addEventListener('input', renderProfiles);
        $('#show-archived').addEventListener('change', renderProfiles);
        $('#persona-text').addEventListener('input', schedulePersonaSave);
        $('#persona-text').addEventListener('blur', queuePersonaSave);
        $('#profile-name').addEventListener('input', scheduleProfileSave);
        $('#profile-description').addEventListener('input', scheduleProfileSave);
        $$('.tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
        $('#policy-search').addEventListener('input', renderPrinciples);
        $('#evidence-search').addEventListener('input', renderEvidence);
        $('#new-manual-scenario').addEventListener('click', clearScenario);
        $('#save-scenario').addEventListener('click', () => saveScenario().catch(error => toast(error.message, true)));
        $('#generate-scenario').addEventListener('click', generateScenario);
        $('#generate-actor').addEventListener('click', generateActor);
        $$('#rating-group button').forEach(button => button.addEventListener('click', () => {
            state.rating = Number(button.dataset.rating);
            $$('#rating-group button').forEach(item => item.classList.toggle('selected', item === button));
        }));
        $('#submit-feedback').addEventListener('click', submitFeedback);
        for (const [selector, field] of [['#situation-model','situation_model'],['#actor-model','actor_model'],['#analysis-model','analysis_model']]) {
            $(selector).addEventListener('change', async event => { await saveProfileFields({ [field]: event.target.value }); renderProfile(); });
        }
        $('#duplicate-profile').addEventListener('click', async () => {
            try { const profile = await request(events.duplicateProfile, { profile_id: state.profileId }, 60000); await refreshBootstrap(false); await selectProfile(profile.id); toast('Character profile duplicated.'); } catch (error) { toast(error.message, true); }
        });
        $('#archive-profile').addEventListener('click', async () => {
            try { await request(events.archiveProfile, { profile_id: state.profileId, archived: !state.detail.profile.archived }); await refreshBootstrap(false); state.detail = await request(events.getProfile, { profile_id: state.profileId }); renderProfile(); } catch (error) { toast(error.message, true); }
        });
        $('#delete-profile').addEventListener('click', async () => {
            if (!confirm(`Delete ${state.detail.profile.name} and all of its training data? This cannot be undone.`)) return;
            try { await request(events.deleteProfile, { profile_id: state.profileId, confirm: true }); state.profileId = null; state.detail = null; state.currentExample = null; await refreshBootstrap(true); toast('Character profile deleted.'); } catch (error) { toast(error.message, true); }
        });
        $('#export-profile').addEventListener('click', exportProfile);
        $('#import-profile').addEventListener('click', () => $('#import-file').click());
        $('#import-file').addEventListener('change', event => event.target.files[0] && importProfile(event.target.files[0]));
        window.addEventListener('beforeunload', () => { if (state.personaTimer) queuePersonaSave(); });
    }

    async function init() {
        bindEvents();
        await bootstrapWithRetry();
    }

    init();
})();

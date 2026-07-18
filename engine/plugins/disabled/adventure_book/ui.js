(() => {
    const uiId = __UI_ID_JSON__;
    const payload = __PAYLOAD_JSON__;
    const root = document.querySelector(`.adventure-book-shell[data-adventure-book-ui-id="${uiId}"]`);
    if (!root) return;

    const socketRequest = async (eventName, data, timeout = 120000) => {
        if (bridge?.socket?.request) return await bridge.socket.request(eventName, data, timeout);
        if (socket?.emitReceive) return await socket.emitReceive(eventName, data, timeout);
        return { success: false, error: 'socket_request_unavailable' };
    };

    const state = {
        sessionId: null,
        current: null,
        history: [],
        latestRoll: null,
        busy: false
    };

    const titleEl = root.querySelector('[data-role="title"]');
    const situationEl = root.querySelector('[data-role="situation"]');
    const stakesEl = root.querySelector('[data-role="stakes"]');
    const optionsEl = root.querySelector('[data-role="options"]');
    const historyEl = root.querySelector('[data-role="history"]');
    const statusEl = root.querySelector('[data-role="status"]');
    const progressEl = root.querySelector('[data-role="progress"]');
    const loadingEl = root.querySelector('[data-role="loading"]');
    const sketchEl = root.querySelector('[data-role="sketch"]');
    const continueBtn = root.querySelector('[data-action="continue"]');
    const rebuildBtn = root.querySelector('[data-action="rebuild"]');
    const skipBtn = root.querySelector('[data-action="skip"]');

    if (rebuildBtn) rebuildBtn.hidden = payload?.debugRebuildEnabled !== true;

    function setBusy(busy, message = '') {
        state.busy = !!busy;
        if (loadingEl) {
            loadingEl.textContent = message || 'Turning the page...';
            loadingEl.classList.toggle('visible', !!busy);
        }
        root.querySelectorAll('button').forEach(btn => {
            btn.disabled = !!busy;
        });
    }

    function setStatus(text, isError = false) {
        if (!statusEl) return;
        statusEl.textContent = text || '';
        statusEl.style.color = isError ? '#9f241b' : '';
    }

    function oddsLabel(option) {
        if (payload?.showExactOdds === false) {
            const chance = Number(option?.successChance) || 50;
            if (chance >= 75) return 'Likely';
            if (chance >= 55) return 'Favorable';
            if (chance >= 35) return 'Risky';
            return 'Long Shot';
        }
        return `${option?.successChance || 50}% / Roll ${option?.d20Target || 11}+`;
    }

    function render() {
        const current = state.current || {};
        titleEl.textContent = current.title || 'Adventure Book';
        situationEl.textContent = current.situation || 'The page waits for a decision.';
        stakesEl.textContent = current.stakes || '';
        sketchEl.textContent = current.illustrationPrompt || current.mode || 'An unfinished sketch gathers in sepia lines.';
        progressEl.textContent = `Step ${Math.min(current.stepIndex || 1, current.maxSteps || payload?.maxSteps || 3)} of ${current.maxSteps || payload?.maxSteps || 3}`;

        optionsEl.innerHTML = '';
        const options = Array.isArray(current.options) ? current.options : [];
        options.forEach(option => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'adventure-option';
            btn.dataset.optionKey = option.optionKey || '';
            btn.innerHTML = `
                <span class="adventure-option-title"></span>
                <span class="adventure-option-meta"></span>
            `;
            btn.querySelector('.adventure-option-title').textContent = option.label || 'Choose this approach';
            const meta = btn.querySelector('.adventure-option-meta');
            [
                oddsLabel(option),
                option.leadCharacter ? `Lead: ${option.leadCharacter}` : '',
                option.approach || '',
                option.riskTier ? `Risk: ${option.riskTier}` : '',
                option.rewardTier ? `Reward: ${option.rewardTier}` : ''
            ].filter(Boolean).forEach(text => {
                const pill = document.createElement('span');
                pill.className = 'adventure-pill';
                pill.textContent = text;
                meta.appendChild(pill);
            });
            btn.addEventListener('click', () => chooseOption(option.optionKey));
            optionsEl.appendChild(btn);
        });

        historyEl.innerHTML = '';
        state.history.slice(-4).forEach(item => {
            const p = document.createElement('p');
            p.className = 'adventure-history-item';
            const roll = item.roll ? `Roll ${item.roll.roll}: ${item.roll.outcome}. ` : '';
            p.textContent = `${roll}${item.resultText || ''}`;
            historyEl.appendChild(p);
        });

        const complete = current.isComplete === true;
        continueBtn.hidden = !complete;
        optionsEl.hidden = complete;
    }

    async function start() {
        setBusy(true, 'Opening the adventure book...');
        const response = await socketRequest(payload.startEventName, {
            parentTurnNumber: payload.parentTurnNumber,
            maxSteps: payload.maxSteps,
            showExactOdds: payload.showExactOdds
        }, 180000);
        setBusy(false);

        if (!response || response.success !== true) {
            setStatus(response?.error || 'Adventure Book could not start.', true);
            return;
        }

        state.sessionId = response.sessionId;
        state.current = response.state;
        state.history = [];
        state.latestRoll = null;
        setStatus('');
        render();
    }

    async function rebuild() {
        if (state.busy || payload?.debugRebuildEnabled !== true) return;
        setBusy(true, 'Rebuilding the adventure book...');
        const response = await socketRequest(payload.rebuildEventName, {
            sessionId: state.sessionId,
            parentTurnNumber: payload.parentTurnNumber
        }, 180000);
        setBusy(false);

        if (!response || response.success !== true) {
            setStatus(response?.error || 'Adventure Book could not be rebuilt.', true);
            return;
        }

        state.sessionId = response.sessionId;
        state.current = response.state;
        state.history = [];
        state.latestRoll = null;
        setStatus('');
        render();
    }

    async function chooseOption(optionKey) {
        if (!state.sessionId || state.busy || !optionKey) return;
        setBusy(true, 'The die is falling...');
        const response = await socketRequest(payload.advanceEventName, {
            sessionId: state.sessionId,
            optionKey
        }, 180000);
        setBusy(false);

        if (!response || response.success !== true) {
            setStatus(response?.error || 'The page refused to turn.', true);
            return;
        }

        state.current = response.state;
        state.latestRoll = response.roll || null;
        if (response.transcriptEntry) state.history.push(response.transcriptEntry);
        setStatus(response.roll ? `D20: ${response.roll.roll} (${response.roll.outcome})` : '');
        render();
    }

    async function finalize() {
        if (!state.sessionId || state.busy) return;
        setBusy(true, 'Canonizing the adventure...');
        const response = await socketRequest(payload.finalizeEventName, {
            sessionId: state.sessionId
        }, 180000);
        setBusy(false);

        if (!response || response.success !== true) {
            setStatus(response?.error || 'Adventure Book could not be canonized.', true);
            return;
        }

        const prompt = response.continuationPrompt || response.bridgePrompt || 'Continue from the Adventure Book outcome.';
        try { bridge?.intercept?.resolve?.({ adventureBookFinalized: true, sessionId: state.sessionId }); } catch (_) {}
        if (bridge?.input?.submitAndGenerate) {
            await bridge.input.submitAndGenerate({ textOverride: prompt });
        } else {
            bridge?.intercept?.resolve?.({ bridgePrompt: prompt, continuationPrompt: prompt });
        }
    }

    continueBtn.addEventListener('click', finalize);
    rebuildBtn?.addEventListener('click', rebuild);
    skipBtn.addEventListener('click', () => {
        bridge?.intercept?.resolve?.({ skipped: true, reason: 'adventure_book_skipped' });
    });

    start().catch(error => {
        setBusy(false);
        setStatus(error?.message || 'Adventure Book failed to start.', true);
    });
})();

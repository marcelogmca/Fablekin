(() => {
    const uiId = __UI_ID_JSON__;
    const mode = __MODE_JSON__;
    const payload = __PAYLOAD_JSON__;

    const root = document.querySelector('[data-tds-ui-id="' + uiId + '"]');
    if (!root) return;
    const overlayHost = root.closest('.plugin-intercept-nonblocking-host, .plugin-intercept-blocking-host');

    const bridgeLifecycle = bridge?.lifecycle || null;
    const bridgeLog = bridge?.log || null;
    const bridgeIntercept = bridge?.intercept || null;
    const bridgePlayer = bridge?.player || null;
    const bridgePlayerUi = bridge?.player?.ui || null;
    const bridgePixi = bridge?.pixi || null;
    const bridgeAssets = bridge?.assets || null;
    const bridgeSocket = bridge?.socket || null;
    const regenerateEncounterEvent = 'top_down_shooter_gameplay_interludes:regenerate-encounter';
    const regenerateRequestTimeoutMs = 420000;

    const shooterLayer = document.createElement('div');
    shooterLayer.className = 'tds-shooter-layer';
    shooterLayer.setAttribute('aria-hidden', 'true');
    root.insertBefore(shooterLayer, root.firstChild);

    const shooterRuntimeFactory = window.TopDownShooterGameplayRuntime;
    const shooterRuntime = (typeof shooterRuntimeFactory === 'function')
        ? shooterRuntimeFactory({ root, layerEl: shooterLayer, bridge, payload })
        : null;

    const sceneRuntimeFactory = window.TopDownShooterSceneRuntime;
    const sceneRuntime = (typeof sceneRuntimeFactory === 'function')
        ? sceneRuntimeFactory({ root, bridge, payload })
        : null;

    const anchorHostToVnArea = () => {
        if (!overlayHost) return;
        const vnArea = document.getElementById('game-container') || document.getElementById('vn-canvas')?.parentElement;
        if (!vnArea) return;
        const rect = vnArea.getBoundingClientRect();
        overlayHost.style.position = 'fixed';
        overlayHost.style.left = rect.left + 'px';
        overlayHost.style.top = rect.top + 'px';
        overlayHost.style.width = rect.width + 'px';
        overlayHost.style.height = rect.height + 'px';
        overlayHost.style.maxHeight = 'none';
        overlayHost.style.overflow = 'hidden';
        overlayHost.style.zIndex = '7';
        overlayHost.style.pointerEvents = 'none';
    };

    anchorHostToVnArea();
    window.addEventListener('resize', anchorHostToVnArea);

    let gameplayActive = false;
    let disposed = false;
    let resolutionCommitted = false;
    let regenerationActive = false;
    let controlsVisibleBeforeGameplay = null;
    let retryCount = 0;
    const battleOstChoices = Array.isArray(payload?.battleOstChoices) ? payload.battleOstChoices : [];
    const combatMusicState = {
        active: false,
        previous: null,
        currentChoice: null
    };
    const menuShell = root.querySelector('[data-role="menu-shell"]');
    const backToMenuBtn = root.querySelector('[data-role="back-to-menu"]');
    const gameplayControls = root.querySelector('[data-role="gameplay-controls"]');
    const startGameplayBtn = root.querySelector('[data-action="start-gameplay"]');
    const retryGameplayBtn = root.querySelector('[data-role="retry-gameplay"]');
    const regenerateGameplayBtn = root.querySelector('[data-role="regenerate-gameplay"]');

    const statusEl = root.querySelector('[data-role="status"]');
    const gameplayHud = document.createElement('div');
    gameplayHud.className = 'tds-combat-gui';
    gameplayHud.hidden = true;
    gameplayHud.innerHTML = `
        <div class="tds-combat-gui-top">
            <div class="tds-combat-gui-mission">
                <span class="tds-gui-caption">Objective</span>
                <strong data-role="hud-objective-main">-</strong>
                <span class="tds-gui-phase" data-role="hud-phase-main">opening</span>
            </div>
            <div class="tds-combat-gui-banner is-hidden" data-role="hud-banner">-</div>
            <div class="tds-combat-gui-boss" data-role="hud-boss-wrap">
                <div class="tds-combat-gui-boss-head">
                    <span>Boss</span>
                    <strong data-role="hud-boss-name">-</strong>
                    <em data-role="hud-boss-phase">P1</em>
                </div>
                <div class="tds-combat-gui-boss-subtitle" data-role="hud-boss-subtitle">-</div>
                <div class="tds-combat-gui-boss-bar">
                    <span data-role="hud-boss-fill"></span>
                </div>
                <div class="tds-combat-gui-boss-bar tds-combat-gui-boss-shield">
                    <span data-role="hud-boss-shield-fill"></span>
                </div>
                <div class="tds-combat-gui-boss-phases" data-role="hud-boss-phases"></div>
                <div class="tds-combat-gui-boss-attack" data-role="hud-boss-attack">-</div>
            </div>
        </div>
        <div class="tds-combat-gui-side tds-combat-gui-side-left">
            <p data-role="hud-objective-side">-</p>
            <div class="tds-combat-gui-divider"></div>
            <p>Enemies defeated</p>
            <strong data-role="hud-defeated">0</strong>
        </div>
        <div class="tds-combat-gui-side tds-combat-gui-side-right">
            <span class="tds-gui-caption">Hits</span>
            <strong class="tds-gui-hit-count" data-role="hud-hit-count">0</strong>
            <div class="tds-combat-gui-timer">
                <span class="tds-gui-caption">Elapsed</span>
                <strong class="tds-combat-gui-timer-value" data-role="hud-elapsed-seconds">0s</strong>
            </div>
        </div>
        <div class="tds-combat-gui-bottom-left">
            <div class="tds-combat-gui-portrait">◎</div>
            <div class="tds-combat-gui-vitals">
                <div class="tds-combat-gui-bar tds-hp">
                    <span data-role="hud-hp-fill"></span>
                </div>
                <div class="tds-combat-gui-bar tds-stamina">
                    <span data-role="hud-stamina-fill"></span>
                </div>
                <div class="tds-combat-gui-hp-text" data-role="hud-hp-text">0/0</div>
            </div>
        </div>
        <div class="tds-combat-gui-bottom-right">
            <button type="button" class="tds-ability" data-role="ability-dash">Shift</button>
            <button type="button" class="tds-ability" data-role="ability-q">Q</button>
            <button type="button" class="tds-ability" data-role="ability-e">E</button>
        </div>
    `;
    root.appendChild(gameplayHud);
    const hudPhaseMainEl = gameplayHud.querySelector('[data-role="hud-phase-main"]');
    const hudObjectiveMainEl = gameplayHud.querySelector('[data-role="hud-objective-main"]');
    const hudObjectiveSideEl = gameplayHud.querySelector('[data-role="hud-objective-side"]');
    const hudBannerEl = gameplayHud.querySelector('[data-role="hud-banner"]');
    const hudDefeatedEl = gameplayHud.querySelector('[data-role="hud-defeated"]');
    const hudHitCountEl = gameplayHud.querySelector('[data-role="hud-hit-count"]');
    const hudBossWrapEl = gameplayHud.querySelector('[data-role="hud-boss-wrap"]');
    const hudBossNameEl = gameplayHud.querySelector('[data-role="hud-boss-name"]');
    const hudBossPhaseEl = gameplayHud.querySelector('[data-role="hud-boss-phase"]');
    const hudBossSubtitleEl = gameplayHud.querySelector('[data-role="hud-boss-subtitle"]');
    const hudBossFillEl = gameplayHud.querySelector('[data-role="hud-boss-fill"]');
    const hudBossShieldFillEl = gameplayHud.querySelector('[data-role="hud-boss-shield-fill"]');
    const hudBossPhasesEl = gameplayHud.querySelector('[data-role="hud-boss-phases"]');
    const hudBossAttackEl = gameplayHud.querySelector('[data-role="hud-boss-attack"]');
    const hudHpFillEl = gameplayHud.querySelector('[data-role="hud-hp-fill"]');
    const hudStaminaFillEl = gameplayHud.querySelector('[data-role="hud-stamina-fill"]');
    const hudHpTextEl = gameplayHud.querySelector('[data-role="hud-hp-text"]');
    const hudElapsedSecondsEl = gameplayHud.querySelector('[data-role="hud-elapsed-seconds"]');
    const dashAbilityEl = gameplayHud.querySelector('[data-role="ability-dash"]');
    const qAbilityEl = gameplayHud.querySelector('[data-role="ability-q"]');
    const eAbilityEl = gameplayHud.querySelector('[data-role="ability-e"]');
    let immersiveWatchdogTimer = null;
    let pauseIntent = '';

    let runtimePollRaf = null;
    const setStartGameplayLabel = (runtimePhase) => {
        if (!startGameplayBtn) return;
        startGameplayBtn.textContent = String(runtimePhase || '').toLowerCase() === 'paused' ? 'Resume' : 'Play';
    };

    const setStatus = (text, isError = false, isWarning = false) => {
        if (!statusEl) return;
        statusEl.textContent = text || '';
        statusEl.classList.toggle('error', !!isError);
        statusEl.classList.toggle('warning', !isError && !!isWarning);
    };

    const getGeneratedEncounterWarning = () => {
        const generatedEncounter = (payload?.generatedEncounter && typeof payload.generatedEncounter === 'object')
            ? payload.generatedEncounter
            : null;
        const generatedEncounterErrors = Array.isArray(generatedEncounter?.errors) ? generatedEncounter.errors : [];
        const generatedEncounterSource = String(payload?.encounterSource || '');
        if (!generatedEncounter) return null;
        if (
            generatedEncounterSource !== 'generated_encounter_script_fallback'
            && generatedEncounterSource !== 'generated_encounter_facade_fallback'
            && generatedEncounterErrors.length === 0
        ) {
            return null;
        }
        const firstError = generatedEncounterErrors[0]?.message ? ' ' + String(generatedEncounterErrors[0].message) : '';
        return {
            generatedEncounter,
            generatedEncounterErrors,
            message: 'Generated combat encounter was invalid; using the default encounter.' + firstError
        };
    };

    const showGeneratedEncounterWarning = () => {
        const warning = getGeneratedEncounterWarning();
        if (!warning) return false;
        setStatus(warning.message, false, true);
        try {
            bridgeLog?.warn?.('Generated encounter fallback', {
                sourceHash: warning.generatedEncounter.sourceHash || null,
                scriptKind: warning.generatedEncounter.scriptKind || null,
                repaired: warning.generatedEncounter.repaired === true,
                errors: warning.generatedEncounterErrors
            });
        } catch (_) { }
        return true;
    };

    const getCoreUiElements = () => ({
        dialogue: document.getElementById('dialogue-container'),
        controls: document.getElementById('controls'),
        input: document.getElementById('user-input-container')
    });

    const isElementVisible = (el) => {
        if (!el) return false;
        if (el.classList.contains('hidden')) return false;
        return true;
    };

    const isCoreUiVisible = () => {
        const core = getCoreUiElements();
        return isElementVisible(core.dialogue) || isElementVisible(core.controls) || isElementVisible(core.input);
    };

    const toggleImmersiveLikeButton = () => {
        if (typeof bridgePlayerUi?.triggerImmersive === 'function') {
            try {
                bridgePlayerUi.triggerImmersive();
                return true;
            } catch (_) { }
        }
        if (typeof bridgePlayerUi?.setImmersive === 'function') {
            try {
                bridgePlayerUi.setImmersive(!isCoreUiVisible());
                return true;
            } catch (_) { }
        }
        return false;
    };

    const enforceImmersiveOn = () => {
        if (!isCoreUiVisible()) return;
        const toggled = toggleImmersiveLikeButton();
        if (!toggled) {
            try { bridgePlayerUi?.hideDialogue?.(); } catch (_) {}
            try { bridgePlayerUi?.hideControls?.(); } catch (_) {}
            try { bridgePlayerUi?.hideInput?.(); } catch (_) {}
        }
        if (isCoreUiVisible()) {
            try { bridgePlayerUi?.hideDialogue?.(); } catch (_) {}
            try { bridgePlayerUi?.hideControls?.(); } catch (_) {}
            try { bridgePlayerUi?.hideInput?.(); } catch (_) {}
        }
    };

    const stopImmersiveWatchdog = () => {
        if (!immersiveWatchdogTimer) return;
        clearInterval(immersiveWatchdogTimer);
        immersiveWatchdogTimer = null;
    };

    const startImmersiveWatchdog = () => {
        stopImmersiveWatchdog();
        immersiveWatchdogTimer = setInterval(() => {
            if (!gameplayActive || disposed) return;
            if (!isCoreUiVisible()) return;
            enforceImmersiveOn();
        }, 260);
    };

    const restoreImmersiveFromSnapshot = () => {
        if (controlsVisibleBeforeGameplay === null) return;
        const shouldShowCoreUi = !!controlsVisibleBeforeGameplay;
        const currentlyVisible = isCoreUiVisible();
        if (shouldShowCoreUi !== currentlyVisible) {
            const toggled = toggleImmersiveLikeButton();
            if (!toggled) {
                if (shouldShowCoreUi) {
                    try { bridgePlayerUi?.showDialogue?.(); } catch (_) {}
                    try { bridgePlayerUi?.showControls?.(); } catch (_) {}
                    try { bridgePlayerUi?.showInput?.(); } catch (_) {}
                } else {
                    try { bridgePlayerUi?.hideDialogue?.(); } catch (_) {}
                    try { bridgePlayerUi?.hideControls?.(); } catch (_) {}
                    try { bridgePlayerUi?.hideInput?.(); } catch (_) {}
                }
            }
        }
        controlsVisibleBeforeGameplay = null;
    };

    const pickRandomBattleTrack = () => {
        if (!battleOstChoices.length) return '';
        const idx = Math.floor(Math.random() * battleOstChoices.length);
        return String(battleOstChoices[idx] || '').trim();
    };

    const formatTrackName = (track) => {
        if (!track) return '';
        const base = String(track).split('/').pop() || String(track);
        return base.replace(/\.(mp3|wav|ogg|webm|m4a)$/i, '').replace(/[_-]+/g, ' ').trim();
    };

    const resolveTrackUrl = (track) => {
        const raw = String(track || '').trim();
        if (!raw) return '';
        if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
        if (raw.startsWith('/')) return raw;
        if ((raw.startsWith('project://') || raw.startsWith('plugin://')) && typeof bridgeAssets?.url === 'function') {
            try { return bridgeAssets.url(raw); } catch (_) { return raw; }
        }
        const normalized = raw.startsWith('ost/') ? raw : ('ost/' + raw.replace(/^ost\//, ''));
        if (typeof bridgeAssets?.getProjectAssetUrl === 'function') {
            try { return bridgeAssets.getProjectAssetUrl(normalized); } catch (_) { }
        }
        return normalized;
    };

    const playCombatMusic = () => {
        if (combatMusicState.active) return;
        if (!battleOstChoices.length) return;
        const audioEl = document.getElementById('audio-player');
        if (!audioEl) return;

        if (!combatMusicState.previous) {
            combatMusicState.previous = {
                src: audioEl.src || '',
                currentTime: Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0,
                wasPaused: !!audioEl.paused,
                loop: !!audioEl.loop,
                label: document.getElementById('music-song-name')?.textContent || ''
            };
        }

        const selected = pickRandomBattleTrack();
        if (!selected) return;

        const nextSrc = resolveTrackUrl(selected);
        if (!nextSrc) return;

        combatMusicState.currentChoice = selected;
        combatMusicState.active = true;
        try {
            audioEl.src = nextSrc;
            audioEl.loop = true;
            audioEl.currentTime = 0;
            audioEl.play().catch((error) => {
                bridgeLog?.warn?.('TopDownShooter combat OST play failed', error);
            });
        } catch (error) {
            bridgeLog?.warn?.('TopDownShooter combat OST switch failed', error);
        }

        const labelEl = document.getElementById('music-song-name');
        if (labelEl) labelEl.textContent = formatTrackName(selected) || labelEl.textContent;
    };

    const restoreMusicAfterCombat = () => {
        if (!combatMusicState.active && !combatMusicState.previous) return;
        const audioEl = document.getElementById('audio-player');
        const previous = combatMusicState.previous;
        combatMusicState.active = false;
        combatMusicState.currentChoice = null;
        combatMusicState.previous = null;
        if (!audioEl || !previous) return;

        try {
            if (previous.src) {
                audioEl.src = previous.src;
                audioEl.loop = !!previous.loop;
                if (Number.isFinite(previous.currentTime) && previous.currentTime > 0) {
                    try { audioEl.currentTime = previous.currentTime; } catch (_) { }
                }
                if (previous.wasPaused) {
                    audioEl.pause();
                } else {
                    audioEl.play().catch((error) => {
                        bridgeLog?.warn?.('TopDownShooter OST restore play failed', error);
                    });
                }
            } else {
                audioEl.pause();
                audioEl.src = '';
            }
        } catch (error) {
            bridgeLog?.warn?.('TopDownShooter OST restore failed', error);
        }

        const labelEl = document.getElementById('music-song-name');
        if (labelEl) {
            labelEl.textContent = previous.label || 'No OST Playing';
        }
    };

    const setGameplayActive = (active) => {
        gameplayActive = !!active;
        root.classList.toggle('tds-gameplay-active', gameplayActive);
        if (menuShell) {
            menuShell.hidden = gameplayActive;
        }
        if (backToMenuBtn) {
            backToMenuBtn.hidden = !gameplayActive;
        }
        if (gameplayControls) {
            gameplayControls.hidden = !gameplayActive;
        }
        gameplayHud.hidden = !gameplayActive;
        if (retryGameplayBtn) {
            retryGameplayBtn.hidden = true;
        }

        if (gameplayActive) {
            if (controlsVisibleBeforeGameplay === null) {
                controlsVisibleBeforeGameplay = !!bridgePlayer?.getSettings?.()?.interface?.show_controls;
            }
            playCombatMusic();
            enforceImmersiveOn();
            startImmersiveWatchdog();
            try { bridgePixi?.pauseVnRuntime?.(); } catch (_) {}
        } else {
            stopImmersiveWatchdog();
            restoreMusicAfterCombat();
            try { bridgePixi?.resumeVnRuntime?.(); } catch (_) {}
            restoreImmersiveFromSnapshot();
        }
    };

    const setRegenerationBusy = (busy) => {
        regenerationActive = !!busy;
        root.querySelectorAll('[data-action]').forEach((button) => {
            button.disabled = regenerationActive;
        });
        if (regenerateGameplayBtn) {
            regenerateGameplayBtn.textContent = regenerationActive ? 'Regenerating...' : 'Regenerate Combat';
        }
    };

    const stopGameplayForReload = () => {
        try { shooterRuntime?.stop?.(); } catch (_) {}
        try { sceneRuntime?.stop?.(); } catch (_) {}
        setGameplayActive(false);
        if (runtimePollRaf) {
            cancelAnimationFrame(runtimePollRaf);
            runtimePollRaf = null;
        }
        stopImmersiveWatchdog();
    };

    const cleanup = () => {
        if (disposed) return;
        disposed = true;
        setGameplayActive(false);

        try { sceneRuntime?.stop?.(); } catch (_) {}
        try { shooterRuntime?.stop?.(); } catch (_) {}
        restoreMusicAfterCombat();
        try { bridgePixi?.resumeVnRuntime?.(); } catch (_) {}
        restoreImmersiveFromSnapshot();
        window.removeEventListener('resize', anchorHostToVnArea);
        window.removeEventListener('keydown', onEscapeKeyDown, true);
        if (runtimePollRaf) {
            cancelAnimationFrame(runtimePollRaf);
            runtimePollRaf = null;
        }
    };

    const resolveInterceptOnce = (data) => {
        if (resolutionCommitted) return false;
        resolutionCommitted = true;
        if (bridgeIntercept?.resolve) bridgeIntercept.resolve(data || {});
        return true;
    };

    const updateHud = (runtimeState) => {
        if (!runtimeState) return;
        const objectiveLines = Array.isArray(runtimeState.objectiveLines) ? runtimeState.objectiveLines.filter(Boolean) : [];
        const objective = String(objectiveLines[0] || runtimeState.objectiveText || '-');
        const objectiveSecondary = objectiveLines.slice(1, 3).join(' | ');
        const defeated = Number(runtimeState.defeatedEnemies) || 0;
        const phaseText = String(runtimeState.encounterPhaseId || runtimeState.phase || '-');
        const bannerText = String(runtimeState.bannerText || '').trim();
        const player = runtimeState.player || {};
        const hp = Number(player.hp);
        const maxHp = Number(player.maxHp);
        const hpRatio = (Number.isFinite(hp) && Number.isFinite(maxHp) && maxHp > 0) ? (hp / maxHp) : 0;
        const dashCooldownRatio = Number(player.dashCooldownRatio);
        const elapsedMs = Math.max(0, Number(runtimeState.encounterElapsedMs) || 0);
        const elapsedSeconds = Math.floor(elapsedMs / 1000);

        if (hudPhaseMainEl) hudPhaseMainEl.textContent = phaseText;
        if (hudObjectiveMainEl) hudObjectiveMainEl.textContent = objective;
        if (hudObjectiveSideEl) hudObjectiveSideEl.textContent = objectiveSecondary || objective;
        if (hudBannerEl) {
            hudBannerEl.textContent = bannerText || '-';
            hudBannerEl.classList.toggle('is-hidden', !bannerText);
        }
        if (hudDefeatedEl) hudDefeatedEl.textContent = String(defeated);
        if (hudHitCountEl) hudHitCountEl.textContent = String(defeated);
        if (hudElapsedSecondsEl) hudElapsedSecondsEl.textContent = String(elapsedSeconds) + 's';
        if (hudHpFillEl) hudHpFillEl.style.width = (Math.max(0, Math.min(1, hpRatio)) * 100).toFixed(1) + '%';
        if (hudHpTextEl) hudHpTextEl.textContent = (Number.isFinite(hp) ? hp : 0) + '/' + (Number.isFinite(maxHp) ? maxHp : 0);

        const staminaRatio = Number.isFinite(dashCooldownRatio) ? (1 - Math.max(0, Math.min(1, dashCooldownRatio))) : 1;
        if (hudStaminaFillEl) hudStaminaFillEl.style.width = (staminaRatio * 100).toFixed(1) + '%';
        if (dashAbilityEl) dashAbilityEl.classList.toggle('cooldown', staminaRatio < 1);
        if (dashAbilityEl) {
            dashAbilityEl.textContent = String(player.dashVariant || 'Shift');
        }
        const abilities = Array.isArray(player.abilities) ? player.abilities : [];
        const qAbility = abilities.find((item) => String(item?.key || '').toLowerCase() === 'q');
        const eAbility = abilities.find((item) => String(item?.key || '').toLowerCase() === 'e');
        if (qAbilityEl) {
            qAbilityEl.textContent = qAbility ? ('Q ' + String(qAbility.id || '').replace(/_/g, ' ')) : 'Q';
            qAbilityEl.classList.toggle('cooldown', !!qAbility && Number(qAbility.cooldownRatio) > 0);
        }
        if (eAbilityEl) {
            eAbilityEl.textContent = eAbility ? ('E ' + String(eAbility.id || '').replace(/_/g, ' ')) : 'E';
            eAbilityEl.classList.toggle('cooldown', !!eAbility && Number(eAbility.cooldownRatio) > 0);
        }

        const bossState = runtimeState.bossState || null;
        if (!bossState || bossState.alive === false) {
            if (hudBossWrapEl) hudBossWrapEl.classList.add('is-hidden');
            if (hudBossFillEl) hudBossFillEl.style.width = '0%';
            if (hudBossShieldFillEl) hudBossShieldFillEl.style.width = '0%';
            if (hudBossAttackEl) hudBossAttackEl.textContent = '-';
            if (hudBossPhasesEl) hudBossPhasesEl.innerHTML = '';
        } else {
            const hpRatio = Number(bossState.hpRatio);
            const shieldRatio = Number(bossState.shieldRatio);
            const pct = Number.isFinite(hpRatio) ? Math.max(0, Math.min(1, hpRatio)) : 0;
            const shieldPct = Number.isFinite(shieldRatio) ? Math.max(0, Math.min(1, shieldRatio)) : 0;
            if (hudBossWrapEl) hudBossWrapEl.classList.remove('is-hidden');
            if (hudBossNameEl) hudBossNameEl.textContent = String(bossState.displayName || bossState.enemyTypeId || 'Boss');
            if (hudBossSubtitleEl) hudBossSubtitleEl.textContent = String(bossState.subtitle || '');
            if (hudBossPhaseEl) hudBossPhaseEl.textContent = 'P' + String((Number(bossState.phaseIndex) || 0) + 1);
            if (hudBossFillEl) hudBossFillEl.style.width = (pct * 100).toFixed(1) + '%';
            if (hudBossShieldFillEl) hudBossShieldFillEl.style.width = (shieldPct * 100).toFixed(1) + '%';
            if (hudBossAttackEl) hudBossAttackEl.textContent = String(bossState.currentAttackLabel || '-');
            if (hudBossPhasesEl) {
                const count = Math.max(1, Number(bossState.phaseCount) || 1);
                const activeIndex = Math.max(0, Number(bossState.phaseIndex) || 0);
                let html = '';
                for (let i = 0; i < count; i += 1) {
                    html += '<span class="' + (i === activeIndex ? 'is-active' : '') + '"></span>';
                }
                hudBossPhasesEl.innerHTML = html;
            }
        }
    };

    const startRuntimePolling = () => {
        if (runtimePollRaf) return;
        const step = () => {
            const state = shooterRuntime?.getState?.();
            if (gameplayActive) updateHud(state);
            runtimePollRaf = requestAnimationFrame(step);
        };
        runtimePollRaf = requestAnimationFrame(step);
    };

    const continueStory = () => {
        if (resolutionCommitted) return;
        setStatus('Continuing story...');
        try {
            const runtimeState = shooterRuntime?.getState?.() || { phase: 'menu' };
            const wasPlayed = ['playing', 'won', 'lost'].includes(String(runtimeState?.phase || ''));
            const resultBuilder = window.TDSCombatResultBuilder;
            const combatResult = (resultBuilder && typeof resultBuilder.buildCombatResult === 'function')
                ? resultBuilder.buildCombatResult(runtimeState, { played: wasPlayed, retries: retryCount })
                : { played: false, result: 'skipped' };
            resolveInterceptOnce({
                combatOverlayClosed: true,
                parentTurnNumber: Number.parseInt(payload?.parentTurnNumber, 10) || null,
                combatResult
            });
        } catch (error) {
            setStatus(error?.message || 'Failed to resolve intercept.', true);
            return;
        }
        cleanup();
    };

    const pauseGameplayToMenu = (source = 'manual') => {
        if (disposed || resolutionCommitted || regenerationActive) return false;
        const runtimePhase = String(shooterRuntime?.getState?.()?.phase || '');
        if (runtimePhase !== 'playing') return false;
        pauseIntent = String(source || 'manual');
        const paused = shooterRuntime?.pause?.() === true;
        if (paused) return true;
        const phaseNow = String(shooterRuntime?.getState?.()?.phase || '');
        if (phaseNow === 'paused') return true;
        pauseIntent = '';
        return false;
    };

    const startGameplay = async () => {
        if (gameplayActive) return;
        const runtimePhase = String(shooterRuntime?.getState?.()?.phase || '');
        if (runtimePhase === 'paused') {
            setStatus('Resuming gameplay...');
            try {
                await Promise.resolve(shooterRuntime?.resume?.());
                const resumedPhase = String(shooterRuntime?.getState?.()?.phase || '');
                if (resumedPhase !== 'playing') {
                    throw new Error('Gameplay failed to resume from pause.');
                }
                setGameplayActive(true);
                startRuntimePolling();
                updateHud(shooterRuntime?.getState?.());
                setStartGameplayLabel(resumedPhase);
                setStatus('Gameplay resumed. Press Escape to pause.');
            } catch (error) {
                bridgeLog?.warn?.('TopDownShooter gameplay resume failed', error);
                setGameplayActive(false);
                setStatus(error?.message || 'Failed to resume gameplay runtime.', true);
            }
            return;
        }

        setStatus('Starting gameplay...');
        try {
            await Promise.resolve(sceneRuntime?.start?.());
            await Promise.resolve(shooterRuntime?.start?.());
            const startedPhase = shooterRuntime?.getState?.()?.phase;
            if (startedPhase !== 'playing') {
                throw new Error('Gameplay failed to enter playing state.');
            }
            setGameplayActive(true);
            startRuntimePolling();
            setStartGameplayLabel(startedPhase);
            const runtimeState = shooterRuntime?.getState?.() || {};
            const loadWarning = String(runtimeState?.encounterLoadWarning || runtimeState?.loadWarning || '').trim();
            if (loadWarning) {
                setStatus(loadWarning, false, true);
            } else {
                setStatus('Gameplay active. Use WASD/Arrows. Press Escape to pause.');
            }
        } catch (error) {
            bridgeLog?.warn?.('TopDownShooter gameplay start failed', error);
            setGameplayActive(false);
            setStatus(error?.message || 'Failed to start gameplay runtime.', true);
        }
    };

    const retryGameplay = async () => {
        setStatus('Retrying encounter...');
        try {
            await Promise.resolve(sceneRuntime?.start?.());
            await Promise.resolve(shooterRuntime?.retry?.());
            retryCount += 1;
            const runtimePhase = shooterRuntime?.getState?.()?.phase;
            if (runtimePhase !== 'playing') {
                throw new Error('Gameplay failed to enter playing state on retry.');
            }
            setGameplayActive(true);
            startRuntimePolling();
            setStartGameplayLabel(runtimePhase);
            const runtimeState = shooterRuntime?.getState?.() || {};
            const loadWarning = String(runtimeState?.encounterLoadWarning || runtimeState?.loadWarning || '').trim();
            if (loadWarning) {
                setStatus(loadWarning, false, true);
            } else {
                setStatus('Retry started. Good luck.');
            }
        } catch (error) {
            bridgeLog?.warn?.('TopDownShooter gameplay retry failed', error);
            setGameplayActive(false);
            setStatus(error?.message || 'Failed to retry gameplay runtime.', true);
        }
    };

    const backToMenu = () => {
        try { shooterRuntime?.stop?.(); } catch (_) {}
        try { sceneRuntime?.stop?.(); } catch (_) {}
        setGameplayActive(false);
        setStartGameplayLabel('menu');
        setStatus('Menu restored. You can Play now or Continue chapter.');
    };

    const applyRegeneratedEncounter = (response) => {
        const nextEncounterDefinition = response?.encounterDefinition && typeof response.encounterDefinition === 'object'
            ? response.encounterDefinition
            : null;
        payload.encounterDefinition = nextEncounterDefinition;
        payload.encounterId = nextEncounterDefinition ? null : (response?.encounterId || 'tds_glass_ambush_v1');
        payload.encounterSource = response?.encounterSource || (nextEncounterDefinition
            ? 'generated_encounter_facade'
            : 'generated_encounter_facade_fallback');
        payload.generatedEncounter = response?.generatedEncounter || null;
        payload.debugEncounterPack = false;
    };

    const regenerateGameplay = async () => {
        if (disposed || regenerationActive || resolutionCommitted) return;
        if (!bridgeSocket || typeof bridgeSocket.request !== 'function') {
            setStatus('Combat regeneration bridge is unavailable in this intercept.', true);
            return;
        }

        const shouldAutoRestart = gameplayActive;
        setRegenerationBusy(true);
        stopGameplayForReload();
        setStatus('Calling the LLM to regenerate this combat encounter...');

        try {
            const response = await bridgeSocket.request(regenerateEncounterEvent, {
                parentTurnNumber: Number.parseInt(payload?.parentTurnNumber, 10) || null,
                previousEncounterId: payload?.encounterId || null,
                previousEncounterSource: payload?.encounterSource || null,
                previousGeneratedSourceHash: payload?.generatedEncounter?.sourceHash || null
            }, regenerateRequestTimeoutMs);

            if (disposed || resolutionCommitted) return;
            if (!response?.success) {
                throw new Error(response?.error || 'Combat regeneration request failed.');
            }

            applyRegeneratedEncounter(response);
            retryCount = 0;
            const warningShown = showGeneratedEncounterWarning();

            if (shouldAutoRestart) {
                setStatus('Regenerated combat encounter. Starting the new run...');
                await startGameplay();
                return;
            }

            if (!warningShown) {
                setStatus('Regenerated combat encounter. Press Play to test it.');
            }
        } catch (error) {
            bridgeLog?.warn?.('TopDownShooter combat regeneration failed', error);
            if (!disposed && !resolutionCommitted) {
                setStatus(error?.message || 'Failed to regenerate combat encounter.', true);
            }
        } finally {
            if (!disposed && !resolutionCommitted) {
                setRegenerationBusy(false);
            }
        }
    };

    const handleAction = (action) => {
        if (regenerationActive) return;
        if (action === 'start-gameplay') {
            startGameplay();
            return;
        }
        if (action === 'continue-story') {
            continueStory();
            return;
        }
        if (action === 'back-to-menu') {
            backToMenu();
            return;
        }
        if (action === 'retry-gameplay') {
            retryGameplay();
            return;
        }
        if (action === 'regenerate-gameplay') {
            regenerateGameplay();
        }
    };

    root.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            handleAction(action);
        });
    });

    const onEscapeKeyDown = (event) => {
        const key = String(event?.key || '').toLowerCase();
        if (key !== 'escape') return;
        if (!gameplayActive || disposed || resolutionCommitted || regenerationActive) return;
        event.preventDefault();
        event.stopPropagation();
        pauseGameplayToMenu('escape');
    };

    window.addEventListener('keydown', onEscapeKeyDown, true);

    if (bridgeLifecycle?.onDispose) {
        bridgeLifecycle.onDispose(() => cleanup());
    }

    shooterRuntime?.onStateChange?.((runtimeState) => {
        const phase = runtimeState?.phase;
        if (phase === 'playing') {
            setGameplayActive(true);
            startRuntimePolling();
            updateHud(runtimeState);
            setStartGameplayLabel('playing');
            if (runtimeState?.bannerText) {
                setStatus(runtimeState.bannerText);
                return;
            }
            if (runtimeState?.encounterLoadWarning || runtimeState?.loadWarning) {
                setStatus(
                    String(runtimeState?.encounterLoadWarning || runtimeState?.loadWarning || ''),
                    false,
                    true
                );
                return;
            }
            if (runtimeState?.objectiveText) {
                setStatus('Objective: ' + runtimeState.objectiveText);
            }
            return;
        }
        if (phase === 'paused') {
            setGameplayActive(false);
            if (retryGameplayBtn) retryGameplayBtn.hidden = false;
            setStartGameplayLabel('paused');
            const pauseMessage = pauseIntent === 'escape'
                ? 'Paused. Press Resume to continue, Retry to restart, or Continue to skip combat.'
                : 'Paused. Press Resume to continue.';
            pauseIntent = '';
            setStatus(pauseMessage);
            return;
        }
        if (phase === 'won') {
            setGameplayActive(false);
            setStartGameplayLabel('menu');
            const finalState = shooterRuntime?.getState?.() || {};
            const resultBuilder = window.TDSCombatResultBuilder;
            const result = (resultBuilder && typeof resultBuilder.buildCombatResult === 'function')
                ? resultBuilder.buildCombatResult(finalState, { played: true, retries: retryCount })
                : null;
            if (result?.grade) {
                setStatus('Encounter cleared (' + result.grade + '). Continue when ready.');
            } else {
                setStatus('Encounter cleared. Continue when ready.');
            }
            return;
        }
        if (phase === 'lost') {
            setGameplayActive(false);
            setStartGameplayLabel('menu');
            if (retryGameplayBtn) retryGameplayBtn.hidden = false;
            setStatus('You were defeated. Retry or continue the story.');
        }
    });

    setGameplayActive(false);
    setStartGameplayLabel('menu');
    setStatus('');
    showGeneratedEncounterWarning();

    if (mode !== 'combat') {
        setStatus('Unexpected mode: ' + String(mode), true);
    }
})();

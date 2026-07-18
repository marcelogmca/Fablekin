/**
 * CG Generator - Frontend Injection Script
 * Shows a lightweight pending overlay while an async CG is still generating.
 */

(function (context) {
    const DEBUG_PREFIX = '[CG Generator UI]';
    const OVERLAY_ID = 'cg-generator-pending-overlay';
    const STYLE_ID = 'cg-generator-pending-style';
    const PENDING_SESSION_GRACE_MS = 5000;
    const MAX_PENDING_MS = 20 * 60 * 1000;

    if (window.__cgGeneratorLazyLoaderInstalled) return;
    window.__cgGeneratorLazyLoaderInstalled = true;

    const getState = () => context?.state || window.state || null;
    const getSocket = () => context?.socket || window.socket || null;
    const getElements = () => context?.elements || {};
    const activePendingSpans = new Map();
    const failedPendingSpans = new Map();
    let pendingRefreshTimer = null;

    function getSessionStartMs() {
        return window.performance?.timeOrigin || Date.now();
    }

    function getTurnKey(turnNumber) {
        return String(turnNumber ?? '');
    }

    function normalizeSpan(payload) {
        const data = payload?.cgData || {};
        const startIdx = Number.parseInt(data.startIdx, 10);
        const endIdx = Number.parseInt(data.endIdx, 10);
        if (!Number.isInteger(startIdx) || !Number.isInteger(endIdx)) return null;
        return {
            turnKey: getTurnKey(payload.turnNumber),
            startIdx,
            endIdx,
            cgIndex: data.cgIndex,
            reason: data.reason || ''
        };
    }

    function pruneActivePendingSpans() {
        const now = Date.now();
        for (const [turnKey, spans] of activePendingSpans.entries()) {
            const liveSpans = spans.filter(span => now - span.startedAt <= MAX_PENDING_MS);
            if (liveSpans.length > 0) activePendingSpans.set(turnKey, liveSpans);
            else activePendingSpans.delete(turnKey);
        }
        for (const [turnKey, spans] of failedPendingSpans.entries()) {
            const liveSpans = spans.filter(span => now - span.failedAt <= MAX_PENDING_MS);
            if (liveSpans.length > 0) failedPendingSpans.set(turnKey, liveSpans);
            else failedPendingSpans.delete(turnKey);
        }
    }

    function registerPendingSpan(payload) {
        const span = normalizeSpan(payload);
        if (!span) return null;
        const spans = activePendingSpans.get(span.turnKey) || [];
        spans.push({ ...span, startedAt: Date.now() });
        activePendingSpans.set(span.turnKey, spans);
        return span;
    }

    function clearPendingSpan(payload) {
        const span = normalizeSpan(payload);
        if (!span) return null;
        const spans = activePendingSpans.get(span.turnKey) || [];
        const remaining = spans.filter(item => {
            const sameCgIndex = span.cgIndex === undefined || item.cgIndex === span.cgIndex;
            return !(item.startIdx === span.startIdx && item.endIdx === span.endIdx && sameCgIndex);
        });
        if (remaining.length > 0) activePendingSpans.set(span.turnKey, remaining);
        else activePendingSpans.delete(span.turnKey);

        const failedSpans = failedPendingSpans.get(span.turnKey) || [];
        const remainingFailed = failedSpans.filter(item => {
            const sameCgIndex = span.cgIndex === undefined || item.cgIndex === span.cgIndex;
            return !(item.startIdx === span.startIdx && item.endIdx === span.endIdx && sameCgIndex);
        });
        if (remainingFailed.length > 0) failedPendingSpans.set(span.turnKey, remainingFailed);
        else failedPendingSpans.delete(span.turnKey);

        return span;
    }

    function registerFailedSpan(payload) {
        const span = clearPendingSpan(payload);
        if (!span) return null;
        const spans = failedPendingSpans.get(span.turnKey) || [];
        spans.push({ ...span, failedAt: Date.now() });
        failedPendingSpans.set(span.turnKey, spans);
        return span;
    }

    function hasActivePendingSpan(turnNumber, index) {
        pruneActivePendingSpans();
        const spans = activePendingSpans.get(getTurnKey(turnNumber)) || [];
        return spans.some(span => index >= span.startIdx && index <= span.endIdx);
    }

    function getFailedPendingSpan(turnNumber, index) {
        pruneActivePendingSpans();
        const spans = failedPendingSpans.get(getTurnKey(turnNumber)) || [];
        return spans.find(span => index >= span.startIdx && index <= span.endIdx) || null;
    }

    function pendingStartedThisSession(scene) {
        const startedAt = Date.parse(scene?.cg_pending_at || '');
        if (!Number.isFinite(startedAt)) return false;
        const ageMs = Date.now() - startedAt;
        return startedAt >= getSessionStartMs() - PENDING_SESSION_GRACE_MS && ageMs <= MAX_PENDING_MS;
    }

    function retirePendingScene(scene, reason = 'CG generation is no longer running.') {
        if (!scene || typeof scene !== 'object') return;
        delete scene.cg_pending;
        delete scene.cg_pending_at;
        if (!scene.cg) {
            scene.cg_failed = true;
            scene.cg_error = reason;
            scene.cg_failed_at = new Date().toISOString();
        }
    }

    function isLivePendingScene(scene, index) {
        if (!scene?.cg_pending || scene.cg) return false;
        if (scene.cg_failed) {
            delete scene.cg_pending;
            delete scene.cg_pending_at;
            return false;
        }

        const state = getState();
        const failedSpan = getFailedPendingSpan(state?.currentVN?.turnNumber, index);
        if (failedSpan) {
            retirePendingScene(scene, failedSpan.reason || 'CG generation failed.');
            return false;
        }

        if (hasActivePendingSpan(state?.currentVN?.turnNumber, index) || pendingStartedThisSession(scene)) {
            return true;
        }

        retirePendingScene(scene);
        return false;
    }

    function schedulePendingRefresh() {
        if (pendingRefreshTimer) clearTimeout(pendingRefreshTimer);
        pendingRefreshTimer = setTimeout(() => {
            pendingRefreshTimer = null;
            const state = getState();
            if (Number.isInteger(state?.currentIndex)) {
                updatePendingOverlay(state.currentIndex);
            }
        }, 30000);
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${OVERLAY_ID} {
                position: absolute;
                inset: 0;
                z-index: 40;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(8, 11, 18, 0.72);
                backdrop-filter: blur(8px);
                color: #fff;
                opacity: 0;
                pointer-events: none;
                transition: opacity 180ms ease;
            }
            #${OVERLAY_ID}.is-visible {
                opacity: 1;
                pointer-events: auto;
            }
            .cg-generator-pending-card {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 16px;
                width: min(520px, calc(100% - 48px));
                padding: 24px;
                text-align: center;
                background: rgba(15, 19, 29, 0.84);
                border: 1px solid rgba(255, 204, 0, 0.45);
                border-radius: 8px;
                box-shadow: 0 18px 60px rgba(0, 0, 0, 0.42);
            }
            .cg-generator-pending-ring {
                width: 56px;
                height: 56px;
                border-radius: 50%;
                border: 3px solid rgba(255, 204, 0, 0.16);
                border-top-color: var(--accent, #ffcc00);
                animation: cg-generator-pending-spin 1.1s linear infinite;
            }
            .cg-generator-pending-title {
                font-family: var(--font-display, 'Noto Sans', sans-serif);
                color: var(--accent, #ffcc00);
                font-size: 1.2rem;
                font-weight: 800;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }
            .cg-generator-pending-copy {
                font-family: var(--font-main, 'Noto Sans', sans-serif);
                font-size: 0.95rem;
                line-height: 1.45;
                opacity: 0.9;
            }
            @keyframes cg-generator-pending-spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    function ensureOverlay() {
        let overlay = document.getElementById(OVERLAY_ID);
        if (overlay) return overlay;

        ensureStyle();
        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.innerHTML = `
            <div class="cg-generator-pending-card">
                <div class="cg-generator-pending-ring"></div>
                <div>
                    <div class="cg-generator-pending-title">Illustrating Moment...</div>
                    <div class="cg-generator-pending-copy">The custom CG is still generating. The scene will update as soon as the image is ready.</div>
                </div>
            </div>
        `;

        const host = document.getElementById('game-container') || document.body;
        host.appendChild(overlay);
        return overlay;
    }

    function setOverlayCopy(mode) {
        const overlay = ensureOverlay();
        const title = overlay.querySelector('.cg-generator-pending-title');
        const copy = overlay.querySelector('.cg-generator-pending-copy');
        if (mode === 'next') {
            if (title) title.textContent = 'Illustrating Next Moment...';
            if (copy) copy.textContent = 'A custom CG is being prepared for the next dialogue beat.';
        } else {
            if (title) title.textContent = 'Illustrating Moment...';
            if (copy) copy.textContent = 'The custom CG is still generating. The scene will update as soon as the image is ready.';
        }
    }

    function showOverlay(mode = 'current') {
        const overlay = ensureOverlay();
        setOverlayCopy(mode);
        overlay.classList.add('is-visible');
        schedulePendingRefresh();
    }

    function hideOverlay() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.classList.remove('is-visible');
        if (pendingRefreshTimer) {
            clearTimeout(pendingRefreshTimer);
            pendingRefreshTimer = null;
        }
    }

    function setAutoButton(active) {
        const elements = getElements();
        const autoBtn = elements.autoBtn || document.getElementById('auto-btn');
        if (autoBtn) autoBtn.innerHTML = active ? '&#9208;' : '&#9654;';
    }

    function pauseAutoPlayForCg() {
        const state = getState();
        if (!state?.autoPlay) return;

        state.autoPlay = false;
        const cancelAutoPlay = window.vnEngine?.cancelAutoPlaySchedule;
        if (typeof cancelAutoPlay === 'function') cancelAutoPlay();

        window.__cgGeneratorWasAutoPlaying = true;
        setAutoButton(false);
        console.log(`${DEBUG_PREFIX} Paused auto-play until pending CG is ready.`);
    }

    function resumeAutoPlayIfNeeded(startIdx, endIdx) {
        const state = getState();
        if (!state || !window.__cgGeneratorWasAutoPlaying) return;
        if (state.currentIndex < startIdx || state.currentIndex > endIdx) return;

        window.__cgGeneratorWasAutoPlaying = false;
        state.autoPlay = true;
        setAutoButton(true);

        const resumeAutoPlay = window.vnEngine?.resumeAutoPlayForCurrentMessage;
        if (typeof resumeAutoPlay === 'function') resumeAutoPlay();
    }

    function updatePendingOverlay(index) {
        const state = getState();
        const sequence = state?.currentVN?.sequence;
        if (!Array.isArray(sequence)) return;

        const currentScene = sequence[index];
        const nextScene = sequence[index + 1];
        if (!currentScene) {
            hideOverlay();
            return;
        }

        const currentWasPending = !!(currentScene.cg_pending && !currentScene.cg);
        if (isLivePendingScene(currentScene, index)) {
            showOverlay('current');
            pauseAutoPlayForCg();
            return;
        }
        if (currentWasPending && currentScene.cg_failed) {
            resumeAutoPlayIfNeeded(index, index);
        }

        if (state.currentIndex === index && isLivePendingScene(nextScene, index + 1)) {
            showOverlay('next');
            return;
        }

        hideOverlay();
    }

    window.addEventListener('vn:dialogue-enter', (event) => {
        const index = Number(event?.detail?.dialogueIndex);
        if (!Number.isInteger(index)) return;
        updatePendingOverlay(index);
    });

    const socket = getSocket();
    if (socket?.on) {
        socket.on('vn-cg-pending', (payload) => {
            const span = registerPendingSpan(payload);
            const state = getState();
            if (!span || !state?.currentVN || state.currentVN.turnNumber !== payload?.turnNumber) return;
            if (Number.isInteger(state.currentIndex) && state.currentIndex >= span.startIdx - 1 && state.currentIndex <= span.endIdx) {
                updatePendingOverlay(state.currentIndex);
            }
        });

        socket.on('vn-cg-ready', (payload) => {
            clearPendingSpan(payload);
            const state = getState();
            if (!state?.currentVN || state.currentVN.turnNumber !== payload?.turnNumber) return;
            const { image, startIdx, endIdx } = payload.cgData || {};
            if (!image || !Number.isInteger(startIdx) || !Number.isInteger(endIdx)) return;

            const sequence = state.currentVN.sequence || [];
            for (let i = startIdx; i <= endIdx && i < sequence.length; i++) {
                sequence[i].cg = image;
                delete sequence[i].cg_pending;
                delete sequence[i].cg_pending_at;
                delete sequence[i].cg_failed;
                delete sequence[i].cg_error;
                delete sequence[i].cg_failed_at;
            }

            if (state.currentIndex >= startIdx - 1 && state.currentIndex <= endIdx) {
                hideOverlay();
                resumeAutoPlayIfNeeded(startIdx, endIdx);
            }
        });

        socket.on('vn-cg-failed', (payload) => {
            const span = registerFailedSpan(payload);
            if (!span) return;
            const state = getState();
            if (!state?.currentVN || state.currentVN.turnNumber !== payload?.turnNumber) return;

            const sequence = state.currentVN.sequence || [];
            const reason = span.reason || 'CG generation failed.';
            for (let i = span.startIdx; i <= span.endIdx && i < sequence.length; i++) {
                retirePendingScene(sequence[i], reason);
            }

            if (state.currentIndex >= span.startIdx - 1 && state.currentIndex <= span.endIdx) {
                hideOverlay();
                resumeAutoPlayIfNeeded(span.startIdx, span.endIdx);
            }
        });
    } else {
        console.warn(`${DEBUG_PREFIX} Socket not available; pending overlay will still react to dialogue entry only.`);
    }

    const state = getState();
    if (Number.isInteger(state?.currentIndex)) {
        updatePendingOverlay(state.currentIndex);
    }
})(typeof context !== 'undefined' ? context : {});

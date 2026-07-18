// engine/views/vn_viewer/js/modules/ui_manager.js

import { state } from '../state.js';
import { elements } from '../elements.js';
import { debugLog } from '../utils.js';

export function setScenePresentation(presentation, reason = null) {
    const normalizedPresentation = presentation === 'fallback' ? 'fallback' : 'scene';
    const root = elements.gameContainer;
    if (!root) return;

    const previousPresentation = root.dataset.vnScenePresentation;
    const previousReason = root.dataset.vnSceneFallbackReason || null;
    root.dataset.vnScenePresentation = normalizedPresentation;

    if (normalizedPresentation === 'fallback' && reason) {
        root.dataset.vnSceneFallbackReason = String(reason);
    } else {
        delete root.dataset.vnSceneFallbackReason;
    }

    const normalizedReason = normalizedPresentation === 'fallback' && reason ? String(reason) : null;
    if (previousPresentation === normalizedPresentation && previousReason === normalizedReason) return;

    window.dispatchEvent(new CustomEvent('vn:scene-presentation-changed', {
        detail: { presentation: normalizedPresentation, reason: normalizedReason }
    }));
}

export function setDialogueHistoryVisible(visible) {
    const nextVisible = visible === true;
    const logContainer = elements.logContainer;
    if (!logContainer) return;

    const root = elements.gameContainer;
    const previousVisible = root?.dataset.vnDialogueHistoryVisible === 'true';
    logContainer.style.display = nextVisible ? 'flex' : 'none';
    logContainer.setAttribute('aria-hidden', String(!nextVisible));
    if (root) root.dataset.vnDialogueHistoryVisible = String(nextVisible);

    if (previousVisible === nextVisible) return;
    window.dispatchEvent(new CustomEvent('vn:dialogue-history-visibility-changed', {
        detail: { visible: nextVisible }
    }));
}

function setIntroModeVisible(visible) {
    const nextVisible = visible === true;
    const root = elements.gameContainer;
    const previousVisible = root?.dataset.vnIntroMode === 'true';
    if (root) root.dataset.vnIntroMode = String(nextVisible);

    if (previousVisible === nextVisible) return;
    window.dispatchEvent(new CustomEvent('vn:intro-visibility-changed', {
        detail: { visible: nextVisible }
    }));
}

function getLogClassName(source) {
    return String(source || 'Narrator')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'narrator';
}

function getDisplayName(character) {
    const char = String(character || 'Narrator');
    return (char === "MainCharacter") ? "You" : (char.endsWith('.png') ? char.slice(0, -4) : char);
}

function createLogMessageElement(scene) {
    if (!scene || scene.isVirtual) return null;
    const char = scene.character || 'Narrator';
    const text = scene.text || scene.line || '';
    const div = document.createElement('div');
    div.className = `log-message ${getLogClassName(char)}`;

    const characterEl = document.createElement('div');
    characterEl.className = 'log-character';
    characterEl.textContent = getDisplayName(char);

    const textEl = document.createElement('div');
    textEl.className = 'log-text';
    textEl.textContent = text;

    div.append(characterEl, textEl);
    return div;
}

function getCurrentLogKey() {
    const vn = state.currentVN || {};
    const sceneMode = String(vn.sceneMode || 'mainline').toLowerCase();
    const interludeId = vn.interlude?.id ?? '';
    return `${sceneMode}:${vn.storageTurnKey || vn.turnNumber || ''}:${interludeId}`;
}

function scrollLogToBottom(behavior = 'auto') {
    if (!elements.logMessages?.lastElementChild) return;
    elements.logMessages.lastElementChild.scrollIntoView({ behavior });
}

export function rebuildLog() {
    if (!elements.logMessages) return;
    const fragment = document.createDocumentFragment();

    state.turnHistory.forEach(turn => {
        if (!turn.sequence) return;
        turn.sequence.forEach(scene => {
            const div = createLogMessageElement(scene);
            if (div) fragment.appendChild(div);
        });
    });

    if (state.currentVN?.sequence) {
        for (let i = 0; i < state.currentIndex; i++) {
            const scene = state.currentVN.sequence[i];
            const div = createLogMessageElement(scene);
            if (div) fragment.appendChild(div);
        }
    }

    elements.logMessages.replaceChildren(fragment);
    elements.logMessages.dataset.vnLogKey = getCurrentLogKey();
    elements.logMessages.dataset.vnLogIndex = String(state.currentIndex || 0);
    scrollLogToBottom('auto');
}

export function syncDialogueLog(index, isSequentialAdvance) {
    if (!elements.logMessages) return;

    const logKey = getCurrentLogKey();
    const previousIndex = index - 1;
    const canAppend = isSequentialAdvance
        && previousIndex >= 0
        && elements.logMessages.dataset.vnLogKey === logKey
        && Number.parseInt(elements.logMessages.dataset.vnLogIndex || '0', 10) === previousIndex;

    if (!canAppend) {
        rebuildLog();
        return;
    }

    const previousScene = state.currentVN?.sequence?.[previousIndex];
    const div = createLogMessageElement(previousScene);
    if (div) {
        elements.logMessages.appendChild(div);
        scrollLogToBottom('auto');
    }
    elements.logMessages.dataset.vnLogIndex = String(index);
}

export function addToLog(source, displayName, text) {
    const div = document.createElement('div');
    div.className = `log-message ${getLogClassName(source)}`;

    const characterEl = document.createElement('div');
    characterEl.className = 'log-character';
    characterEl.textContent = displayName;

    const textEl = document.createElement('div');
    textEl.className = 'log-text';
    textEl.textContent = text || '';

    div.append(characterEl, textEl);
    elements.logMessages.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
}

export function setInputsEnabled(enabled) {
    if (state.isGameOver) return;
    const isInterludeTurn = state.currentVN?.sceneMode === 'interlude';
    const interludeModeActive = enabled && isInterludeTurn;

    const parentTurnNumber = Number.parseInt(
        state.currentVN?.interlude?.parentTurnNumber ?? state.currentVN?.turnNumber,
        10
    );
    const hasParentTurnNumber = Number.isInteger(parentTurnNumber) && parentTurnNumber > 0;

    if (elements.userMessage) elements.userMessage.disabled = !enabled || interludeModeActive;
    if (elements.directorMessage) elements.directorMessage.disabled = !enabled || interludeModeActive;
    if (elements.feedbackMessage) elements.feedbackMessage.disabled = !enabled || interludeModeActive;
    if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = !enabled || interludeModeActive;
    if (elements.undoBtn) {
        elements.undoBtn.disabled = !enabled;
        elements.undoBtn.textContent = interludeModeActive ? 'Undo Interlude' : 'Undo';
    }
    if (elements.directorLip) elements.directorLip.style.pointerEvents = enabled && !interludeModeActive ? 'all' : 'none';
    if (elements.feedbackLip) elements.feedbackLip.style.pointerEvents = enabled && !interludeModeActive ? 'all' : 'none';

    if (elements.interludeReturnPanel) {
        elements.interludeReturnPanel.classList.toggle('hidden', !interludeModeActive);
    }
    if (elements.interludeReturnTitle) {
        elements.interludeReturnTitle.textContent = 'Interlude Complete';
    }
    if (elements.interludeReturnText) {
        elements.interludeReturnText.textContent = 'This side scene does not accept direct input. Return to the main chapter to continue.';
    }
    if (elements.interludeReturnBtn) {
        elements.interludeReturnBtn.disabled = !interludeModeActive;
        elements.interludeReturnBtn.textContent = hasParentTurnNumber
            ? `Return to Chapter ${parentTurnNumber}`
            : 'Return to Main Chapter';
    }

    if (elements.userInputContainer) {
        elements.userInputContainer.style.display = enabled ? 'flex' : 'none';
        elements.userInputContainer.style.opacity = enabled ? '1' : '0.5';
        elements.userInputContainer.style.pointerEvents = enabled ? 'all' : 'none';
        elements.userInputContainer.classList.toggle('interlude-active', interludeModeActive);
    }
}

export function startProgressBar(dur) {
    let w = 0;
    clearInterval(state.progressInterval);
    state.progressInterval = setInterval(() => {
        if (w >= 100) clearInterval(state.progressInterval);
        else { w += 0.5; elements.progressBar.style.width = w + '%'; }
    }, dur / 200);
}

export function updateNavigationUI() {
    if (state.isGameOver) {
        if (elements.prevChapterNav) elements.prevChapterNav.classList.add('hidden');
        if (elements.nextChapterNav) elements.nextChapterNav.classList.add('hidden');
        return;
    }
    const index = state.currentIndex;
    const isFirst = index === 0;
    const isLast = index === state.currentVN.sequence.length - 1;
    if (isFirst && state.navigation.prev) {
        const nav = state.navigation.prev;
        elements.prevChapterNav.querySelector('.nav-title').textContent = nav.title;
        const thumb = elements.prevChapterNav.querySelector('.nav-thumbnail');
        thumb.style.backgroundImage = nav.thumbnail ? `url('data:image/jpeg;base64,${nav.thumbnail}')` : 'none';
        elements.prevChapterNav.classList.remove('hidden');
    } else elements.prevChapterNav.classList.add('hidden');

    if (isLast && state.navigation.next) {
        const nav = state.navigation.next;
        elements.nextChapterNav.querySelector('.nav-title').textContent = nav.title;
        const thumb = elements.nextChapterNav.querySelector('.nav-thumbnail');
        thumb.style.backgroundImage = nav.thumbnail ? `url('data:image/jpeg;base64,${nav.thumbnail}')` : 'none';
        elements.nextChapterNav.classList.remove('hidden');
        setInputsEnabled(false);
    } else {
        elements.nextChapterNav.classList.add('hidden');
        isLast && !state.navigation.next ? setInputsEnabled(true) : setInputsEnabled(false);
    }
}

export function hidePrologueOverlay() {
    if (!elements.prologueOverlay) return;
    setIntroModeVisible(false);
    elements.prologueOverlay.classList.add('hidden');
    elements.prologueOverlay.classList.remove('with-input');
    elements.dialogueContainer.classList.remove('hidden');
}

export function showPrologueOverlay(content, enableInputs = true) {
    if (!elements.prologueOverlay) return;
    setIntroModeVisible(true);
    setScenePresentation('fallback', 'prologue');
    elements.prologueContent.innerText = content;
    elements.prologueOverlay.classList.remove('hidden');
    elements.dialogueContainer.classList.add('hidden');
    if (enableInputs) {
        setInputsEnabled(true);
        elements.prologueOverlay.classList.add('with-input');
        if (elements.prologueFooter) elements.prologueFooter.classList.remove('hidden');
    } else {
        setInputsEnabled(false);
        elements.prologueOverlay.classList.remove('with-input');
        if (elements.prologueFooter) elements.prologueFooter.classList.add('hidden');
    }
}

export function showGameOverScreen(config = {}) {
    debugLog('[GameOver] Showing game over screen', config);
    state.autoPlay = false;
    if (state.autoPlayTimeout) { clearTimeout(state.autoPlayTimeout); state.autoPlayTimeout = null; }
    import('../pixi_game_over.js').then(m => m.pixiGameOver.show(config));
    if (elements.userInputContainer) {
        elements.userInputContainer.classList.add('game-over-active');
        elements.userInputContainer.style.display = 'flex';
        elements.userInputContainer.style.opacity = '1';
        elements.userInputContainer.style.pointerEvents = 'all';
    }
    if (elements.undoBtn) elements.undoBtn.disabled = false;
    if (elements.prevChapterNav) elements.prevChapterNav.classList.add('hidden');
    if (elements.nextChapterNav) elements.nextChapterNav.classList.add('hidden');
    if (elements.dialogueContainer) elements.dialogueContainer.classList.add('game-over-active');
    window.socket.emitReceive('execute-frontend-hook', { hookName: 'HOOK_GAME_OVER_SCREEN', config }).catch(e => console.error("Game Over Hook Error:", e));
}

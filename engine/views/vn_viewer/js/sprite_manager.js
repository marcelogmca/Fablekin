import { state } from './state.js';
import { elements } from './elements.js';
import { debugLog, debugError, getCharacterNameFromPath, getSpriteCharacterKey, getAssetUrl, normalizeCharacterKey } from './utils.js';
import { SpriteAnimator } from './sprite_animator.js';

export function stopAllTalking() {
    if (state.emulatedTalkingTimeout) {
        clearTimeout(state.emulatedTalkingTimeout);
        state.emulatedTalkingTimeout = null;
    }
    Object.values(state.activeAnimators).forEach(animator => {
        if (animator && typeof animator.stopTalking === 'function') {
            animator.stopTalking();
        }
    });
}

export function resetSpriteState() {
    Object.values(state.activeAnimators).forEach(animator => {
        if (animator && typeof animator.destroy === 'function') {
            animator.destroy();
        }
    });
    state.activeAnimators = {};
    state.lastSpriteNames = { left: null, center: null, right: null };
    if (elements.characterContainer) {
        elements.characterContainer.innerHTML = '';
    }
}

export function renderSpriteInContainer(container, charName, spritePath, config, isEntrance = false) {
    if (state.activeAnimators[charName]) {
        state.activeAnimators[charName].destroy();
        delete state.activeAnimators[charName];
    }

    const layerContainer = document.createElement('div');
    layerContainer.className = 'sprite-layer-container';

    const imagePromises = [];
    const createAndPreloadImg = (path, cls, suffix) => {
        const img = new Image();
        const promise = new Promise((resolve, reject) => {
            const dotIndex = spritePath.lastIndexOf('.');
            const base = spritePath.substring(0, dotIndex);
            const ext = spritePath.substring(dotIndex);
            
            // Extract directory to ensure neutral fallbacks stay in the same folder
            const lastSlash = base.lastIndexOf('/');
            const dir = lastSlash !== -1 ? base.substring(0, lastSlash + 1) : '';
            const assetCharName = getCharacterNameFromPath(spritePath);

            const attempts = [
                `${base}${suffix}${ext}`,
                `${base}_front${suffix}${ext}`,
                `${dir}${assetCharName}_neutral${suffix}${ext}`,
                `${dir}${assetCharName}_neutral_front${suffix}${ext}`
            ];
            const uniqueAttempts = Array.from(new Set(attempts)).filter(a => !a.includes('_front_front'));

            let attemptIdx = 0;
            const tryNext = () => {
                if (attemptIdx >= uniqueAttempts.length) {
                    reject(`Failed all fallbacks for ${assetCharName} ${suffix}`);
                    return;
                }
                const currentPath = getAssetUrl(uniqueAttempts[attemptIdx]);
                
                img.onload = () => resolve(img);
                img.onerror = () => {
                    debugLog(`[SpriteManager] Load failed for ${currentPath}, trying next fallback...`);
                    attemptIdx++;
                    tryNext();
                };
                img.src = currentPath;
            };

            tryNext();
        });
        imagePromises.push(promise);
        img.className = `sprite-layer ${cls}`;
        return img;
    };

    const getLayerPath = (suffix) => {
        if (suffix === '') return spritePath;
        const dotIndex = spritePath.lastIndexOf('.');
        const pathWithoutExt = spritePath.substring(0, dotIndex);
        const ext = spritePath.substring(dotIndex);
        return `${pathWithoutExt}${suffix}${ext}`;
    };

    const baseImg = createAndPreloadImg(getLayerPath(''), 'layer-base', '');
    const blinkImg = config.hasBlink ? createAndPreloadImg(getLayerPath('_blink'), 'layer-blink', '_blink') : null;
    const talkImg = config.hasTalk ? createAndPreloadImg(getLayerPath('_talk'), 'layer-talk', '_talk') : null;
    const talkBlinkImg = config.hasTalkBlink ? createAndPreloadImg(getLayerPath('_talk_blink'), 'layer-talk-blink', '_talk_blink') : null;

    Promise.all(imagePromises).then(() => {
        container.innerHTML = '';
        layerContainer.appendChild(baseImg);

        if (blinkImg) layerContainer.appendChild(blinkImg);
        if (talkImg) layerContainer.appendChild(talkImg);
        if (talkBlinkImg) layerContainer.appendChild(talkBlinkImg);
        container.appendChild(layerContainer);

        state.activeAnimators[charName] = new SpriteAnimator(layerContainer, config);
        container.style.opacity = '1';
        if (isEntrance) container.classList.add('sprite-enter-anim');

        const isCharacterTalking = !!state.activeTalkingCharacters?.[normalizeCharacterKey(charName)];
        if (isCharacterTalking && state.isAudioPlaying) {
            state.activeAnimators[charName].startTalking();
        }

        // Emit event so plugins can modify the sprite container
        window.dispatchEvent(new CustomEvent('vn:sprite-rendered', {
            detail: { container, charName, spritePath, config, isEntrance, layerContainer }
        }));

    }).catch(error => {
        debugError(`Preload failed for ${charName}`, error);
        container.innerHTML = '';
        layerContainer.appendChild(baseImg);

        container.appendChild(layerContainer);
        container.style.opacity = '1';
    });
}

export function updateSprites(sprites) {
    const activeSlots = ['left', 'center', 'right'].filter(pos => sprites && sprites[pos]);
    const activeCount = activeSlots.length;

    if (elements.characterContainer) {
        elements.characterContainer.classList.toggle('mode-a', state.spriteMode === 'A');
        elements.characterContainer.classList.toggle('mode-b', state.spriteMode === 'B');
    }

    let slotPositions = {};
    const isModeB = state.spriteMode === 'B';

    if (activeCount === 1) {
        slotPositions[activeSlots[0]] = '50%';
    } else if (activeCount === 2) {
        slotPositions[activeSlots[0]] = '33.33%';
        slotPositions[activeSlots[1]] = '66.66%';
    } else if (activeCount === 3) {
        slotPositions['left'] = isModeB ? '20%' : '5%';
        slotPositions['center'] = '50%';
        slotPositions['right'] = isModeB ? '80%' : '95%';
    }

    const currentTurnCharacters = new Set();

    activeSlots.forEach(pos => {
        const spriteData = sprites[pos];
        const isObject = typeof spriteData === 'object' && spriteData !== null;
        const spritePath = isObject ? spriteData.path : spriteData;
        const config = isObject ? spriteData : { hasBlink: false, hasTalk: false, hasTalkBlink: false };

        const charName = getSpriteCharacterKey(spriteData);
        if (!charName || !spritePath) return;
        currentTurnCharacters.add(charName);

        let spriteContainer = Array.from(elements.characterContainer.querySelectorAll('.sprite'))
            .find(el => el.getAttribute('data-character') === charName);

        if (spriteContainer) {
            spriteContainer.style.left = slotPositions[pos];
            const oldPath = spriteContainer.getAttribute('data-sprite-path');
            if (oldPath !== spritePath) {
                spriteContainer.setAttribute('data-sprite-path', spritePath);
                renderSpriteInContainer(spriteContainer, charName, spritePath, config);
            } else {
                window.dispatchEvent(new CustomEvent('vn:sprite-rendered', {
                    detail: {
                        container: spriteContainer,
                        charName,
                        spritePath,
                        config,
                        isEntrance: false,
                        layerContainer: spriteContainer.querySelector('.sprite-layer-container')
                    }
                }));
            }
        } else {
            spriteContainer = document.createElement('div');
            spriteContainer.className = 'sprite';
            spriteContainer.setAttribute('data-character', charName);
            spriteContainer.setAttribute('data-sprite-path', spritePath);
            spriteContainer.style.left = slotPositions[pos];
            spriteContainer.style.transform = 'translateX(-50%)';
            spriteContainer.style.opacity = '0';
            elements.characterContainer.appendChild(spriteContainer);
            renderSpriteInContainer(spriteContainer, charName, spritePath, config, true);
        }
    });

    elements.characterContainer.querySelectorAll('.sprite:not(.sprite-exit-anim)').forEach(el => {
        const charName = el.getAttribute('data-character');
        if (!currentTurnCharacters.has(charName)) {
            if (state.activeAnimators[charName]) {
                state.activeAnimators[charName].destroy();
                delete state.activeAnimators[charName];
            }
            el.classList.add('sprite-exit-anim');
            setTimeout(() => el.remove(), 300);
        }
    });
}

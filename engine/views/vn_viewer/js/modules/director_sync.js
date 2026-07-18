// engine/views/vn_viewer/js/modules/director_sync.js

import { state } from '../state.js';
import { pixiApp } from '../pixi_engine.js';
import { pixiRenderer } from '../pixi_renderer.js';
import { playAudio, stopAudio, setOstVolumeFade } from './audio_manager.js';
import { debugLog, getAssetUrl } from '../utils.js';
import { playTransition } from '../transition_manager.js';

/**
 * Reconciles the visual state of the VN with the requested directorState.
 */
export async function syncDirectorState(target, isSequential = false) {
    debugLog('[Engine] Syncing Director State:', target);
    const instant = !isSequential;

    if (target.background !== undefined && (target.background !== state.currentBackground || (!target.background && pixiRenderer.currentSrc))) {
        const nextBackground = target.background || null;
        const isVideo = nextBackground && (nextBackground.endsWith('.mp4') || nextBackground.endsWith('.webm'));
        state.currentBackground = nextBackground;
        if (nextBackground) {
            await pixiRenderer.updateBackground(nextBackground, isVideo, instant);
        } else {
            pixiRenderer.clearBackground(instant);
        }
    }

    if (target.cg !== undefined && target.cg !== state.currentCg) {
        if (target.cg) {
            // CG should always render with neutral framing regardless of scene cam directives.
            pixiApp.cam.reset(0, true);
        }
        state.currentCg = target.cg;
        pixiRenderer.updateCg(target.cg, instant);
    }

    if (target.cam && !state.currentCg) {
        const cam = target.cam;
        if (cam.mode === 'wide') {
            await pixiApp.cam.reset(cam.instant || instant ? 0 : 1.5);
        } else if (cam.mode === 'background_focus') {
            const zoomLevel = Number.isFinite(Number(cam.zoom)) && Number(cam.zoom) >= 1 ? Number(cam.zoom) : 1.08;
            await pixiApp.cam.zoom(zoomLevel, cam.instant || instant ? 0 : 1.2);
        } else {
            await pixiApp.cam.zoomToCharacter(cam.target, cam.region || 'top', cam.instant || instant ? 0 : 1.5);
        }
    }

    if (target.ost !== undefined) {
        const normalizedTarget = target.ost ? target.ost.replace(/^ost\//, '') : null;
        const normalizedCurrent = state.currentOst ? state.currentOst.replace(/^ost\//, '') : null;
        if (normalizedTarget !== normalizedCurrent) {
            if (target.ost) {
                const fileForUrl = target.ost.startsWith('ost/') ? target.ost : `ost/${target.ost}`;
                playAudio(getAssetUrl(fileForUrl, state.currentVN?.projectName), target.ost);
            } else stopAudio();
        }
    }
    
    if (target.ostSilence !== undefined && target.ostSilence !== state.ostSilenceActive) {
        state.ostSilenceActive = target.ostSilence;
        if (target.ostSilence) {
            setOstVolumeFade(0, 2000); // 2 second fade to silence
        } else {
            setOstVolumeFade(state.vnSettings.audio?.ost_volume ?? 0.5, 2000); // 2 second fade back to normal
        }
    }

    window.dispatchEvent(new CustomEvent('vfx:sync', { detail: { vfx: target.vfx, instant } }));
    window.dispatchEvent(new CustomEvent('sfx:sync', { detail: { sfx: target.sfx, instant } }));

    if (target.triggers && target.triggers.length > 0) {
        for (const trigger of target.triggers) {
            if (trigger.type === 'transition') {
                window.dispatchEvent(new CustomEvent('vn:background-override', { detail: { ...trigger, instant: trigger.instant || instant } }));
                continue;
            }

            if (trigger.type === 'vn:transition') {
                const descriptor = { ...(trigger.payload || {}), instant };
                if (descriptor.blocking !== false) {
                    await playTransition(descriptor);
                } else {
                    playTransition(descriptor).catch(() => { });
                }
                continue;
            }

            window.dispatchEvent(new CustomEvent(trigger.type, { detail: { ...(trigger.payload || trigger), instant } }));
        }
    }
}

import { state, runtime } from './state.js';
import { elements } from './elements.js';
import { deepMerge } from './utils.js';

function normalizeToolbarVerticalPosition(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(300, Math.max(0, parsed));
}

function normalizeDialogueBoxHeight(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 200;
    return Math.min(420, Math.max(140, parsed));
}

function applyDialogueBoxHeight(value) {
    const dialogueHeight = normalizeDialogueBoxHeight(value);
    const cssValue = `${dialogueHeight}px`;
    document.documentElement.style.setProperty('--vn-dialogue-box-height', cssValue);
    if (elements.gameContainer) {
        elements.gameContainer.style.setProperty('--vn-dialogue-box-height', cssValue);
    }
    if (elements.dialogueContainer) {
        elements.dialogueContainer.style.setProperty('--vn-dialogue-box-height', cssValue);
    }
    return dialogueHeight;
}

function applyToolbarVerticalPosition(value, dialogueHeightValue = state.vnSettings?.visuals?.dialogue_height ?? 200) {
    const position = normalizeToolbarVerticalPosition(value);
    const dialogueHeight = normalizeDialogueBoxHeight(dialogueHeightValue);
    const offsetFromBottom = Math.round(dialogueHeight * position) / 100;
    const top = `calc(100% - ${offsetFromBottom}px)`;
    const translate = `${Math.min(0, position - 100)}%`;

    if (elements.gameContainer) {
        elements.gameContainer.style.setProperty('--vn-toolbar-top', top);
        elements.gameContainer.style.setProperty('--vn-toolbar-translate-y', translate);
    }
    if (elements.dialogueContainer) {
        elements.dialogueContainer.style.setProperty('--vn-toolbar-top', top);
        elements.dialogueContainer.style.setProperty('--vn-toolbar-translate-y', translate);
    }

    return position;
}

export function updateControlsVisibility() {
    const show = state.vnSettings.interface?.show_controls;
    const showIndicator = state.vnSettings.interface?.show_dialogue_index_indicator;
    if (elements.controls) elements.controls.classList.toggle('hidden', !show);
    if (elements.dialogueContainer) elements.dialogueContainer.classList.toggle('hidden', !show);
    if (elements.userInputContainer) elements.userInputContainer.classList.toggle('hidden', !show);
    if (elements.dialogueIndexIndicator) {
        elements.dialogueIndexIndicator.classList.toggle('hidden', !showIndicator);
    }
    if (elements.toggleControlsBtn) elements.toggleControlsBtn.classList.toggle('collapsed', !show);
}

export function applyVNSettings() {
    const s = state.vnSettings || {};
    const audio = s.audio || {};
    const visuals = s.visuals || {};
    const inter = s.interface || {};
    const debug = s.debug || {};

    if (elements.audioPlayer) elements.audioPlayer.volume = audio.ost_volume ?? 0.5;
    if (elements.voicePlayer) elements.voicePlayer.volume = audio.tts_volume ?? 0.5;
    if (elements.characterContainer) {
        elements.characterContainer.style.setProperty('--sprite-vertical-offset', `${visuals.sprite_offset ?? 0}px`);
    }
    const dialogueHeight = applyDialogueBoxHeight(visuals.dialogue_height ?? 200);
    const toolbarVerticalPosition = applyToolbarVerticalPosition(visuals.toolbar_vertical_offset ?? 0, dialogueHeight);
    if (elements.dialogueContainer) {
        elements.dialogueContainer.style.setProperty('--vn-dialogue-box-width', `${visuals.dialogue_width ?? 100}%`);
        elements.dialogueContainer.style.setProperty('--vn-dialogue-panel-opacity', visuals.panel_transparency ?? 0.75);
        elements.dialogueContainer.style.setProperty('--vn-dialogue-panel-blur', `${visuals.panel_blur ?? 10}px`);
        elements.dialogueContainer.style.backdropFilter = 'none';
        elements.dialogueContainer.style.webkitBackdropFilter = 'none';
    }
    if (elements.dialogueText) {
        elements.dialogueText.style.textAlign = inter.text_alignment ?? 'left';
    }
    if (elements.dialogueContainer) {
        elements.dialogueContainer.style.setProperty('--vn-font-multiplier', visuals.font_size_multiplier ?? 1.0);
    }

    // Refresh sliders and labels if modal is open
    if (elements.ostVolumeSlider) elements.ostVolumeSlider.value = audio.ost_volume ?? 0.5;
    if (elements.ostVolumeValue) elements.ostVolumeValue.textContent = `${Math.round((audio.ost_volume ?? 0.5) * 100)}%`;

    if (elements.ttsVolumeSlider) elements.ttsVolumeSlider.value = audio.tts_volume ?? 0.5;
    if (elements.ttsVolumeValue) elements.ttsVolumeValue.textContent = `${Math.round((audio.tts_volume ?? 0.5) * 100)}%`;

    if (elements.bgmSfxVolumeSlider) elements.bgmSfxVolumeSlider.value = audio.bgm_sfx_volume ?? 0.3;
    if (elements.bgmSfxVolumeValue) elements.bgmSfxVolumeValue.textContent = `${Math.round((audio.bgm_sfx_volume ?? 0.3) * 100)}%`;

    if (elements.sfxVolumeSlider) elements.sfxVolumeSlider.value = audio.sfx_volume ?? 0.5;
    if (elements.sfxVolumeValue) elements.sfxVolumeValue.textContent = `${Math.round((audio.sfx_volume ?? 0.5) * 100)}%`;

    if (elements.spriteOffsetSlider) elements.spriteOffsetSlider.value = visuals.sprite_offset ?? 0;
    if (elements.spriteOffsetValue) elements.spriteOffsetValue.textContent = `${visuals.sprite_offset ?? 0}px`;

    if (elements.spriteSizeMultiplierSlider) elements.spriteSizeMultiplierSlider.value = visuals.sprite_size_multiplier ?? 1.0;
    if (elements.spriteSizeMultiplierValue) elements.spriteSizeMultiplierValue.textContent = `${(visuals.sprite_size_multiplier ?? 1.0).toFixed(2)}x`;

    if (elements.spriteHorizontalPaddingSlider) elements.spriteHorizontalPaddingSlider.value = visuals.sprite_horizontal_padding ?? 0;
    if (elements.spriteHorizontalPaddingValue) elements.spriteHorizontalPaddingValue.textContent = `${Math.round(visuals.sprite_horizontal_padding ?? 0)}%`;

    if (elements.foregroundBackgroundBlurSlider) elements.foregroundBackgroundBlurSlider.value = visuals.foreground_background_blur_strength ?? 0;
    if (elements.foregroundBackgroundBlurValue) elements.foregroundBackgroundBlurValue.textContent = `${Number(visuals.foreground_background_blur_strength ?? 0).toFixed(1)}px`;

    if (elements.dialogueWidthSlider) elements.dialogueWidthSlider.value = visuals.dialogue_width ?? 100;
    if (elements.dialogueWidthValue) elements.dialogueWidthValue.textContent = `${visuals.dialogue_width ?? 100}%`;

    if (elements.dialogueHeightSlider) elements.dialogueHeightSlider.value = dialogueHeight;
    if (elements.dialogueHeightValue) elements.dialogueHeightValue.textContent = `${dialogueHeight}px`;

    if (elements.toolbarVerticalOffsetSlider) elements.toolbarVerticalOffsetSlider.value = toolbarVerticalPosition;
    if (elements.toolbarVerticalOffsetValue) elements.toolbarVerticalOffsetValue.textContent = `${toolbarVerticalPosition}%`;

    if (elements.panelTransparencySlider) elements.panelTransparencySlider.value = visuals.panel_transparency ?? 0.75;
    if (elements.panelTransparencyValue) elements.panelTransparencyValue.textContent = `${Math.round((visuals.panel_transparency ?? 0.75) * 100)}%`;

    if (elements.panelBlurSlider) elements.panelBlurSlider.value = visuals.panel_blur ?? 10;
    if (elements.panelBlurValue) elements.panelBlurValue.textContent = `${visuals.panel_blur ?? 10}px`;

    if (elements.textAlignmentSelect) elements.textAlignmentSelect.value = inter.text_alignment ?? 'left';
    if (elements.spriteMorphMethodSelect) elements.spriteMorphMethodSelect.value = visuals.sprite_morph_method ?? 'motion_blend';

    if (elements.fontSizeSlider) elements.fontSizeSlider.value = visuals.font_size_multiplier ?? 1.0;
    if (elements.fontSizeValue) elements.fontSizeValue.textContent = `${(visuals.font_size_multiplier ?? 1.0).toFixed(2)}x`;

    if (elements.modalOverlayOpacitySlider) {
        elements.modalOverlayOpacitySlider.value = inter.modal_overlay_opacity ?? 0.4;
    }
    if (elements.modalOverlayOpacityValue) {
        elements.modalOverlayOpacityValue.textContent = `${Math.round((inter.modal_overlay_opacity ?? 0.4) * 100)}%`;
    }
    document.documentElement.style.setProperty('--modal-overlay-opacity', inter.modal_overlay_opacity ?? 0.4);

    if (elements.writeSpeedSlider) elements.writeSpeedSlider.value = visuals.write_speed ?? 30;
    if (elements.writeSpeedValue) elements.writeSpeedValue.textContent = `${visuals.write_speed ?? 30}ms`;

    if (elements.autoPlayDelaySlider) elements.autoPlayDelaySlider.value = inter.auto_play_delay ?? 500;
    if (elements.autoPlayDelayValue) elements.autoPlayDelayValue.textContent = `${inter.auto_play_delay ?? 500}ms`;
    
    if (elements.hideMainSpritesCheckbox) {
        elements.hideMainSpritesCheckbox.checked = !!visuals.hide_main_sprites;
        import('./pixi_sprite_manager.js').then(m => m.pixiSpriteManager.updateSpriteVisibility());
    }

    import('./pixi_sprite_manager.js').then(m => {
        m.pixiSpriteManager.updateSpriteMultiplier(visuals.sprite_size_multiplier ?? 1.0);
        m.pixiSpriteManager.updateHorizontalPadding(visuals.sprite_horizontal_padding ?? 0);
    });
    import('./pixi_renderer.js').then(m => m.pixiRenderer.applyForegroundBackgroundBlur());

    if (elements.debugViewportCheckbox) {
        elements.debugViewportCheckbox.checked = !!debug.debug_viewport;
    }

    if (elements.spatialStageModeSelect) {
        import('./pixi_spatial_stage.js').then(({ pixiSpatialStage }) => {
            const commandMode = pixiSpatialStage.getCommandMode?.();
            elements.spatialStageModeSelect.value = commandMode || 'default';
        });
    }

    if (elements.ostPopupCheckbox) {
        elements.ostPopupCheckbox.checked = !!inter.show_ost_popup;
    }

    if (elements.muteAudioDuringGenerationCheckbox) {
        elements.muteAudioDuringGenerationCheckbox.checked = !!audio.mute_audio_during_generation;
    }

    if (elements.playSoundOnReadyCheckbox) {
        elements.playSoundOnReadyCheckbox.checked = !!audio.play_sound_on_ready;
    }

    if (elements.blinkTaskbarOnReadyCheckbox) {
        elements.blinkTaskbarOnReadyCheckbox.checked = !!inter.blink_taskbar_on_ready;
    }
    
    if (elements.showDialogueIndexIndicatorCheckbox) {
        elements.showDialogueIndexIndicatorCheckbox.checked = !!inter.show_dialogue_index_indicator;
    }

    if (elements.showChapterIntroCheckbox) {
        elements.showChapterIntroCheckbox.checked = !!visuals.show_chapter_intro;
    }

    if (elements.miniMusicPlayer) {
        elements.miniMusicPlayer.classList.toggle('minimized', !inter.show_music_player);
    }

    if (elements.inputsFrame) {
        elements.inputsFrame.classList.toggle('director-active', !!debug.director_mode);
        elements.inputsFrame.classList.toggle('feedback-active', !!debug.feedback_mode);
    }

    if (elements.statusConsole && elements.statusConsoleToggle) {
        const expanded = !!debug.show_system_console;
        elements.statusConsoleToggle.classList.toggle('expanded', expanded);
        elements.statusConsoleToggle.querySelector('span').textContent = expanded ? 'Hide System Logs' : 'Show System Logs';

        // Visibility also depends on whether there are logs to show
        if (!expanded) {
            elements.statusConsole.classList.add('hidden');
        } else if (state.isGenerationPhase && state.logBuffer.length > 0) {
            elements.statusConsole.classList.remove('hidden');
        }
    }

    updateControlsVisibility();
}

export function debouncedSaveVNSettings(socket) {
    if (runtime.saveSettingsTimeout) clearTimeout(runtime.saveSettingsTimeout);
    runtime.saveSettingsTimeout = setTimeout(() => {
        socket.emit('save-vn-settings', { vnSettings: state.vnSettings });
    }, 1000);
}

export async function loadVNSettings(socket) {
    const response = await socket.emitReceive('get-vn-settings', {});
    if (response && response.success && response.vnSettings) {
        state.vnSettings = deepMerge(state.vnSettings, response.vnSettings);
    }
    applyVNSettings();
    window.dispatchEvent(new CustomEvent('vn:settings-updated', { detail: state.vnSettings }));
}

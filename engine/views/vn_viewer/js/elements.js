export const elements = {
    vnSettingsBtn: null,
    vnSettingsContent: null,
    ostVolumeSlider: null,
    ostVolumeValue: null,
    ttsVolumeSlider: null,
    ttsVolumeValue: null,
    rerequestMissingTtsBtn: null,
    missingTtsCount: null,
    bgmSfxVolumeSlider: null,
    bgmSfxVolumeValue: null,
    sfxVolumeSlider: null,
    sfxVolumeValue: null,
    spriteOffsetSlider: null,
    spriteOffsetValue: null,
    dialogueWidthSlider: null,
    dialogueWidthValue: null,
    dialogueHeightSlider: null,
    dialogueHeightValue: null,
    toolbarVerticalOffsetSlider: null,
    toolbarVerticalOffsetValue: null,
    spriteSizeMultiplierSlider: null,
    spriteSizeMultiplierValue: null,
    spriteHorizontalPaddingSlider: null,
    spriteHorizontalPaddingValue: null,
    foregroundBackgroundBlurSlider: null,
    foregroundBackgroundBlurValue: null,
    panelTransparencySlider: null,
    panelTransparencyValue: null,
    panelBlurSlider: null,
    panelBlurValue: null,
    textAlignmentSelect: null,
    spriteMorphMethodSelect: null,
    fontSizeSlider: null,
    fontSizeValue: null,
    modalOverlayOpacitySlider: null,
    modalOverlayOpacityValue: null,
    writeSpeedSlider: null,
    writeSpeedValue: null,
    autoPlayDelaySlider: null,
    autoPlayDelayValue: null,
    naturalConversationTimingCheckbox: null,
    toggleControlsBtn: null,
    controls: null,
    dialogueIndexIndicator: null,
    characterContainer: null,
    background: null,
    dialogueContainer: null,
    dialogueText: null,
    characterName: null,
    nameLine: null,
    audioPlayer: null,
    voicePlayer: null,
    voicePlayerSecondary: null,
    logMessages: null,
    prevChapterNav: null,
    nextChapterNav: null,
    userMessage: null,
    sendMessageBtn: null,
    retryMessageBtn: null,
    userInputContainer: null,
    progressBar: null,
    prologueOverlay: null,
    prologueContent: null,
    unifiedStatusPopup: null,
    unifiedStatusPopupTitle: null,
    unifiedStatusElapsedTime: null,
    unifiedStatusTaskList: null,
    statusNotificationGrouper: null,
    statusNotificationCount: null,
    gameContainer: null,
    logContainer: null,
    startBtn: null,
    prevBtn: null,
    autoBtn: null,
    nextBtn: null,
    skipBtn: null,
    logBtn: null,
    fullscreenBtn: null,
    closeLog: null,
    unifiedStatusPopupGif: null,
    hideMainSpritesCheckbox: null,
    showChapterIntroCheckbox: null,
    debugViewportCheckbox: null,
    spatialStageModeSelect: null,
    debugZoomSmoothBtn: null,
    debugZoomInstantBtn: null,
    debugCameraClearBtn: null,
    stageCalibratorBtn: null,
    musicPlayerBtn: null,
    miniMusicPlayer: null,
    musicSongName: null,
    musicProgressFill: null,
    musicTimeDisplay: null,
    musicPlayPauseBtn: null,
    ostPopupCheckbox: null,
    disableOstDuringLoadingCheckbox: null,
    playSoundOnReadyCheckbox: null,
    blinkTaskbarOnReadyCheckbox: null,
    inputHint: null,
    directorLip: null,
    directorMessage: null,
    inputsFrame: null,
    interludeReturnPanel: null,
    interludeReturnTitle: null,
    interludeReturnText: null,
    interludeReturnBtn: null,
    prologueFooter: null,
    showDialogueIndexIndicatorCheckbox: null,
    pipelineProgressBar: null,
    pipelinePhasesContainer: null,
    pipelineCursor: null,
    pipelineCursorIcon: null,
    pipelineLabel: null,
    pipelineLabelIcon: null,
    pipelineLabelName: null,
    statusConsoleToggle: null,
    statusConsole: null,
    cancelGenerationBtn: null,
    feedbackLip: null,
    feedbackMessage: null,
    pluginOverlay: null,
    llmRoad: null,
    llmRoadScroll: null,
    llmRoadLanes: null,
    llmRoadGrid: null,
    llmRoadNow: null,
    llmRoadEmpty: null,
    llmRoadFollow: null
};

export function initElements() {
    elements.vnSettingsBtn = document.getElementById('vn-settings-btn');
    elements.vnSettingsContent = document.getElementById('vn-settings-content');
    elements.ostVolumeSlider = document.getElementById('ost-volume-slider');
    elements.ostVolumeValue = document.getElementById('ost-volume-value');
    elements.ttsVolumeSlider = document.getElementById('tts-volume-slider');
    elements.ttsVolumeValue = document.getElementById('tts-volume-value');
    elements.rerequestMissingTtsBtn = document.getElementById('rerequest-missing-tts-btn');
    elements.missingTtsCount = document.getElementById('missing-tts-count');
    elements.bgmSfxVolumeSlider = document.getElementById('bgm-sfx-volume-slider');
    elements.bgmSfxVolumeValue = document.getElementById('bgm-sfx-volume-value');
    elements.sfxVolumeSlider = document.getElementById('sfx-volume-slider');
    elements.sfxVolumeValue = document.getElementById('sfx-volume-value');
    elements.spriteOffsetSlider = document.getElementById('sprite-offset-slider');
    elements.spriteOffsetValue = document.getElementById('sprite-offset-value');
    elements.dialogueWidthSlider = document.getElementById('dialogue-width-slider');
    elements.dialogueWidthValue = document.getElementById('dialogue-width-value');
    elements.dialogueHeightSlider = document.getElementById('dialogue-height-slider');
    elements.dialogueHeightValue = document.getElementById('dialogue-height-value');
    elements.toolbarVerticalOffsetSlider = document.getElementById('toolbar-vertical-offset-slider');
    elements.toolbarVerticalOffsetValue = document.getElementById('toolbar-vertical-offset-value');
    elements.spriteSizeMultiplierSlider = document.getElementById('sprite-size-multiplier-slider');
    elements.spriteSizeMultiplierValue = document.getElementById('sprite-size-multiplier-value');
    elements.spriteHorizontalPaddingSlider = document.getElementById('sprite-horizontal-padding-slider');
    elements.spriteHorizontalPaddingValue = document.getElementById('sprite-horizontal-padding-value');
    elements.foregroundBackgroundBlurSlider = document.getElementById('foreground-background-blur-slider');
    elements.foregroundBackgroundBlurValue = document.getElementById('foreground-background-blur-value');
    elements.panelTransparencySlider = document.getElementById('panel-transparency-slider');
    elements.panelTransparencyValue = document.getElementById('panel-transparency-value');
    elements.panelBlurSlider = document.getElementById('panel-blur-slider');
    elements.panelBlurValue = document.getElementById('panel-blur-value');
    elements.textAlignmentSelect = document.getElementById('text-alignment-select');
    elements.spriteMorphMethodSelect = document.getElementById('sprite-morph-method-select');
    elements.fontSizeSlider = document.getElementById('font-size-slider');
    elements.fontSizeValue = document.getElementById('font-size-value');
    elements.modalOverlayOpacitySlider = document.getElementById('modal-overlay-opacity-slider');
    elements.modalOverlayOpacityValue = document.getElementById('modal-overlay-opacity-value');
    elements.writeSpeedSlider = document.getElementById('write-speed-slider');
    elements.writeSpeedValue = document.getElementById('write-speed-value');
    elements.autoPlayDelaySlider = document.getElementById('auto-play-delay-slider');
    elements.autoPlayDelayValue = document.getElementById('auto-play-delay-value');
    elements.naturalConversationTimingCheckbox = document.getElementById('natural-conversation-timing-checkbox');
    elements.toggleControlsBtn = document.getElementById('toggle-controls-btn');
    elements.controls = document.getElementById('controls');
    elements.dialogueIndexIndicator = document.getElementById('dialogue-index-indicator');
    elements.characterContainer = document.getElementById('character-container');
    elements.background = document.getElementById('background');
    elements.dialogueContainer = document.getElementById('dialogue-container');
    elements.dialogueText = document.getElementById('dialogue-text');
    elements.characterName = document.getElementById('character-name');
    elements.nameLine = document.getElementById('name-line');
    elements.audioPlayer = document.getElementById('audio-player');
    elements.voicePlayer = document.getElementById('voice-player');
    elements.voicePlayerSecondary = document.getElementById('voice-player-secondary');
    elements.logMessages = document.getElementById('log-messages');
    elements.prevChapterNav = document.getElementById('prev-chapter-nav');
    elements.nextChapterNav = document.getElementById('next-chapter-nav');
    elements.userMessage = document.getElementById('user-message');
    elements.sendMessageBtn = document.getElementById('send-message');
    elements.undoBtn = document.getElementById('undo-message');
    elements.userInputContainer = document.getElementById('user-input-container');
    elements.progressBar = document.getElementById('progress-bar');
    elements.prologueOverlay = document.getElementById('prologue-overlay');
    elements.prologueContent = document.getElementById('prologue-content');
    elements.unifiedStatusPopup = document.getElementById('unified-status-popup');
    elements.unifiedStatusPopupTitle = document.getElementById('unified-status-popup-title');
    elements.unifiedStatusElapsedTime = document.getElementById('unified-status-elapsed-time');
    elements.unifiedStatusTaskList = document.getElementById('unified-status-task-list');
    elements.statusNotificationGrouper = document.getElementById('status-notification-grouper');
    elements.statusNotificationCount = document.getElementById('notification-count');
    elements.gameContainer = document.getElementById('game-container');
    elements.logContainer = document.getElementById('log-container');
    elements.startBtn = document.getElementById('start-btn');
    elements.prevBtn = document.getElementById('prev-btn');
    elements.autoBtn = document.getElementById('auto-btn');
    elements.nextBtn = document.getElementById('next-btn');
    elements.skipBtn = document.getElementById('skip-btn');
    elements.logBtn = document.getElementById('log-btn');
    elements.fullscreenBtn = document.getElementById('fullscreen-btn');
    elements.closeLog = document.getElementById('close-log');
    elements.unifiedStatusPopupGif = document.getElementById('unified-status-popup-gif');
    elements.hideMainSpritesCheckbox = document.getElementById('hide-main-sprites-checkbox');
    elements.showChapterIntroCheckbox = document.getElementById('show-chapter-intro-checkbox');
    elements.debugViewportCheckbox = document.getElementById('debug-viewport-checkbox');
    elements.spatialStageModeSelect = document.getElementById('spatial-stage-mode-select');
    elements.debugZoomSmoothBtn = document.getElementById('debug-zoom-smooth-btn');
    elements.debugZoomInstantBtn = document.getElementById('debug-zoom-instant-btn');
    elements.debugCameraClearBtn = document.getElementById('debug-camera-clear-btn');
    elements.stageCalibratorBtn = document.getElementById('stage-calibrator-btn');
    elements.musicPlayerBtn = document.getElementById('music-player-btn');
    elements.miniMusicPlayer = document.getElementById('mini-music-player');
    elements.musicSongName = document.getElementById('music-song-name');
    elements.musicProgressFill = document.getElementById('music-progress-fill');
    elements.musicTimeDisplay = document.getElementById('music-time-display');
    elements.musicPlayPauseBtn = document.getElementById('music-play-pause-btn');
    elements.ostPopupCheckbox = document.getElementById('ost-popup-checkbox');
    elements.muteAudioDuringGenerationCheckbox = document.getElementById('mute-audio-during-generation-checkbox');
    elements.playSoundOnReadyCheckbox = document.getElementById('play-sound-on-ready-checkbox');
    elements.blinkTaskbarOnReadyCheckbox = document.getElementById('blink-taskbar-on-ready-checkbox');
    elements.inputHint = document.getElementById('input-hint');
    elements.directorLip = document.getElementById('director-toggle-lip');
    elements.directorMessage = document.getElementById('director-message');
    elements.inputsFrame = document.getElementById('inputs-frame');
    elements.interludeReturnPanel = document.getElementById('interlude-return-panel');
    elements.interludeReturnTitle = document.getElementById('interlude-return-title');
    elements.interludeReturnText = document.getElementById('interlude-return-text');
    elements.interludeReturnBtn = document.getElementById('interlude-return-btn');
    elements.prologueFooter = document.querySelector('.prologue-footer');
    elements.showDialogueIndexIndicatorCheckbox = document.getElementById('show-dialogue-index-indicator-checkbox');
    elements.pipelineProgressBar = document.getElementById('pipeline-progress-bar');
    elements.pipelinePhasesContainer = document.getElementById('pipeline-phases-container');
    elements.pipelineCursor = document.getElementById('pipeline-cursor');
    elements.pipelineCursorIcon = document.getElementById('pipeline-cursor-icon');
    elements.pipelineLabel = document.getElementById('pipeline-label');
    elements.pipelineLabelIcon = document.getElementById('pipeline-label-icon');
    elements.pipelineLabelName = document.getElementById('pipeline-label-name');
    elements.statusConsoleToggle = document.getElementById('unified-status-console-toggle');
    elements.statusConsole = document.getElementById('unified-status-console');
    elements.cancelGenerationBtn = document.getElementById('cancel-generation-btn');
    elements.feedbackLip = document.getElementById('feedback-toggle-lip');
    elements.feedbackMessage = document.getElementById('feedback-message');
    elements.pluginOverlay = document.getElementById('plugin-overlay');
    elements.llmRoad = document.getElementById('llm-road');
    elements.llmRoadScroll = document.getElementById('llm-road-scroll');
    elements.llmRoadLanes = document.getElementById('llm-road-lanes');
    elements.llmRoadGrid = document.getElementById('llm-road-grid');
    elements.llmRoadNow = document.getElementById('llm-road-now');
    elements.llmRoadEmpty = document.getElementById('llm-road-empty');
    elements.llmRoadFollow = document.getElementById('llm-road-follow');

    if (elements.gameContainer && elements.controls && elements.controls.parentElement !== elements.gameContainer) {
        elements.gameContainer.appendChild(elements.controls);
    }
}

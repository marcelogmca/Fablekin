// engine/views/content_manager/modules/player_metadata.js

import { state, socket, SERVER_URL, debugLog } from './state.js';

/**
 * Updates the player character's icon in the UI.
 */
export function updatePlayerIcon(name, projectName) {
  const playerIcon = document.getElementById('playerIcon');
  if (!playerIcon) return;

  playerIcon.textContent = '👤';
  playerIcon.style.backgroundImage = 'none';
  if (!name || name.trim() === '') {
    return;
  }

  const rawName = name.toLowerCase().trim();
  const normalizedName = rawName
    .replace(/\s+/g, '_')
    .replace(/[^\w-]/g, '')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '');
  const candidateNames = [...new Set([rawName, normalizedName].filter(Boolean))];
  const effectiveProjectName = projectName || state.currentProjectName || 'default_project';

  if (effectiveProjectName === 'default_project') return;

  const extensions = ['webp', 'png', 'jpg', 'jpeg'];
  const candidates = candidateNames.flatMap(candidateName =>
    extensions.map(ext => `${encodeURIComponent(candidateName)}_icon.${ext}`)
  );
  let attempts = 0;

  const tryLoad = () => {
    if (attempts >= candidates.length) {
      playerIcon.textContent = '👤';
      playerIcon.style.backgroundImage = 'none';
      return;
    }

    const testSrc = `${SERVER_URL}/projects/${encodeURIComponent(effectiveProjectName)}/assets/sprites/${candidates[attempts]}`;
    const img = new Image();
    img.onload = () => {
      playerIcon.textContent = '';
      playerIcon.style.backgroundImage = `url('${testSrc}')`;
      playerIcon.style.backgroundSize = 'cover';
      playerIcon.style.backgroundPosition = 'center';
    };
    img.onerror = () => {
      attempts++;
      tryLoad();
    };
    img.src = testSrc;
  };

  tryLoad();
}

/**
 * Saves the player metadata to the backend.
 */
export function savePlayerMetadata() {
    if (state.isSavingPlayerMetadata) return;

    const nameInput = document.getElementById('playerCharacterNameInput');
    const bioTextarea = document.getElementById('playerBioTextarea');

    if (!nameInput) return;

    const newName = nameInput.value.trim();
    const newBio = bioTextarea ? bioTextarea.value.trim() : '';

    if (newName === state.currentPlayerMetadata.name && newBio === state.currentPlayerMetadata.bio) return;

    state.currentPlayerMetadata.name = newName;
    state.currentPlayerMetadata.bio = newBio;
    state.isSavingPlayerMetadata = true;

    debugLog(`Saving player metadata: ${newName}`);
    socket.emit('save-player-metadata', { playerMetadata: state.currentPlayerMetadata });

    setTimeout(() => { state.isSavingPlayerMetadata = false; }, 1000);
}

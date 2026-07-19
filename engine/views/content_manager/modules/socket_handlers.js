// engine/views/content_manager/modules/socket_handlers.js

import { state, debugLog, debugError } from './state.js';
import { applyDirectoryStructure } from './file_actions.js';
import { renderTree } from './ui_renderer.js';
import { updatePlayerIcon } from './player_metadata.js';
import { renderProjectDirectives, _renderDirectivesUi } from './directives.js';
import { getSelectedFiles } from './utils.js';

export function initializeSocketHandlers(socket) {
  socket.on('project-ready', async (result) => {
    debugLog('Received "project-ready"');
    state.currentProjectName = result.projectName;
    applyDirectoryStructure(result);
    renderProjectDirectives();
    socket.emit('get-player-metadata');
    socket.emit('execute-frontend-hook', { hookName: 'HOOK_CONTENT_MANAGER_GUI_READY' });
  });

  socket.on('project-changed', ({ projectName }) => {
    debugLog(`Project changed to: ${projectName}`);
    state.currentProjectName = projectName;
  });

  socket.on('player-character-updated', (playerMetadata) => {
    debugLog(`Player character metadata updated: ${JSON.stringify(playerMetadata)}`);
    const nameChanged = playerMetadata.name !== (state.currentPlayerMetadata.name || '');
    const bioChanged = playerMetadata.bio !== (state.currentPlayerMetadata.bio || '');

    state.currentPlayerMetadata = playerMetadata;

    const nameInput = document.getElementById('playerCharacterNameInput');
    const bioTextarea = document.getElementById('playerBioTextarea');

    if (nameInput && nameChanged) nameInput.value = playerMetadata.name || '';
    if (bioTextarea && bioChanged) bioTextarea.value = playerMetadata.bio || '';
    if (playerMetadata.projectName) state.currentProjectName = playerMetadata.projectName;
    updatePlayerIcon(playerMetadata.name, playerMetadata.projectName);
    state.isSavingPlayerMetadata = false;
  });

  socket.on('save-player-metadata-response', (response) => {
    state.isSavingPlayerMetadata = false;
    if (!response.success) debugError('Failed to save player metadata', response.error);
  });

  socket.on('get-player-metadata-response', (response) => {
    if (response.success && response.playerMetadata) {
      state.currentPlayerMetadata = response.playerMetadata;
      const nameInput = document.getElementById('playerCharacterNameInput');
      const bioTextarea = document.getElementById('playerBioTextarea');
      if (nameInput && response.playerMetadata.name) nameInput.value = response.playerMetadata.name;
      if (bioTextarea && response.playerMetadata.bio !== undefined) bioTextarea.value = response.playerMetadata.bio;
      if (response.playerMetadata.projectName) state.currentProjectName = response.playerMetadata.projectName;
      updatePlayerIcon(response.playerMetadata.name, response.playerMetadata.projectName);
    }
  });

  socket.on('request-plugin-file-view-response', ({ success, content, type, error, filePath, isEdit }) => {
    if (success) {
      const container = document.getElementById('pluginViewContainer');
      const innerContent = document.getElementById('plugin-view-content');
      const title = isEdit ? `Editing: ${filePath.split(/[\\\/]/).pop()}` : `View Processed: ${filePath.split(/[\\\/]/).pop()}`;

      if (type === 'html') renderPluginViewHtml(container, content);
      else {
        const pre = document.createElement('pre');
        pre.textContent = content;
        cleanupPluginViewContainer();
        container.appendChild(pre);
      }

      state.currentModalInstance = Modals.show({
        title,
        content: innerContent,
        className: 'modal-xl',
        buttons: [],
        onClose: () => cleanupPluginViewContainer()
      });
    } else {
      Modals.alert('View Error', error || 'Data not ready or available.');
    }
  });

  socket.on('get-file-content-response', ({ success, content, error, filePath }) => {
    if (success) {
      const textarea = document.getElementById('fileEditorTextarea');
      const formContainer = document.getElementById('schemaFormContainer');
      const saveBtn = document.getElementById('saveFileBtn');

      const rawMode = state.selectedFiles.get(filePath) || 'none';
      const mode = (typeof rawMode === 'object' && rawMode !== null) ? (rawMode.mode || 'none') : rawMode;
      const lockedMode = (typeof rawMode === 'object' && rawMode !== null) ? rawMode.lockedMode : null;
      const effectiveMode = lockedMode || mode;
      const modeMetadata = state.pluginModes[effectiveMode];
      const schema = (modeMetadata && modeMetadata.schema) ? modeMetadata.schema : null;

      if (schema) {
        textarea.classList.add('hidden');
        formContainer.classList.remove('hidden');
        try { renderSchemaForm(schema, JSON.parse(content)); } catch (e) { debugError('Failed to parse JSON', e); }
      } else {
        textarea.classList.remove('hidden');
        formContainer.classList.add('hidden');
        textarea.value = content;
      }

      const scriptExtras = document.getElementById('script-editor-extras');
      const saveTrustReloadBtn = document.getElementById('saveTrustReloadBtn');
      if (mode === 'story-script') {
        if (scriptExtras) scriptExtras.classList.remove('hidden');
        if (saveTrustReloadBtn) {
          saveTrustReloadBtn.classList.remove('hidden');
          saveTrustReloadBtn.dataset.path = filePath;
          saveTrustReloadBtn.dataset.mode = effectiveMode;
        }
      } else {
        if (scriptExtras) scriptExtras.classList.add('hidden');
        if (saveTrustReloadBtn) saveTrustReloadBtn.classList.add('hidden');
      }

      const displayPath = filePath.split(/[\\\/]/).slice(-2).join('/');
      state.currentModalInstance = Modals.show({
        title: `Editing: ${displayPath}`,
        content: document.getElementById('file-editor-content'),
        className: 'modal-large',
        buttons: []
      });

      saveBtn.dataset.path = filePath;
      saveBtn.dataset.mode = effectiveMode;
      if (!schema) textarea.focus();
    } else {
      debugError(`Error getting file content: ${error}`);
    }
  });

  socket.on('save-file-content-response', ({ success, error, directory }) => {
    if (success) {
      closeFileEditor();
      applyDirectoryStructure(directory);
    } else debugError(`Error saving file: ${error}`);
  });

  socket.on('create-new-file-response', ({ success, directory }) => { if (success) applyDirectoryStructure(directory); });
  socket.on('create-new-chat-db-response', ({ success, directory }) => { if (success) applyDirectoryStructure(directory); });
  socket.on('delete-file-response', ({ success, directory, error, locked }) => {
    if (success) {
      applyDirectoryStructure(directory);
      return;
    }

    const message = locked
      ? 'The file is still open by another process. Close any external database tools and try again; if it remains locked, restart Fablekin and delete it before reopening the file.'
      : (error || 'The file could not be deleted.');
    Modals.alert(locked ? 'File Is In Use' : 'Delete Failed', message, { variant: locked ? 'warning' : 'danger' });
  });
  socket.on('rename-file-response', async ({ success, directory, needsRestart }) => {
    if (success) {
      if (needsRestart) {
        const confirmed = await Modals.confirm('Rename Queued', 'Restart required to apply rename. Reload now?', { confirmText: 'Reload Now', cancelText: 'Later' });
        if (confirmed) socket.emit('restart-app');
      } else applyDirectoryStructure(directory);
    }
  });

  socket.on('update-file-order-response', ({ success, directory }) => { if (success) applyDirectoryStructure(directory); });
  socket.on('move-file-to-folder-response', ({ success, directory }) => { if (success) applyDirectoryStructure(directory); });
  socket.on('convert-md-to-chat-db-response', ({ success, directory }) => { if (success) applyDirectoryStructure(directory); });
  socket.on('request-file-conversion-response', ({ success, directory }) => { if (success) applyDirectoryStructure(directory); });

  socket.on('branch-narrative-broadcast', ({ directory }) => {
    if (directory) applyDirectoryStructure(directory);
  });

  socket.on('content-directory-updated', (directory) => {
    if (directory) applyDirectoryStructure(directory);
  });

  socket.on('plugin-modes-updated', (modes) => {
    state.pluginModes = modes;
    renderTree(state.currentStructure);
  });

  socket.on('get-chat-file-path-request', () => {
    let chatFilePath = null;
    for (const [path, stateObj] of state.selectedFiles.entries()) {
      if (((typeof stateObj === 'object') ? stateObj.mode : stateObj) === 'chat') {
        chatFilePath = path;
        break;
      }
    }
    socket.emit('get-chat-file-path-request-response', chatFilePath);
  });

  socket.on('get-selected-files', () => {
    socket.emit('get-selected-files-response', { success: true, selectedFiles: getSelectedFiles() });
  });

  socket.on('project-directives-updated', (metadata) => {
    _renderDirectivesUi(metadata);
  });
}

function renderPluginViewHtml(container, html) {
  cleanupPluginViewContainer();
  container.innerHTML = html;
  executePluginViewScripts(container);
}

function cleanupPluginViewContainer() {
  const container = document.getElementById('pluginViewContainer');
  if (!container) return;
  if (typeof container.__pluginCleanup === 'function') container.__pluginCleanup();
  container.__pluginCleanup = null;
  container.innerHTML = '';
}

function executePluginViewScripts(container) {
  const scripts = Array.from(container.querySelectorAll('script'));
  scripts.forEach((oldScript) => {
    const parent = oldScript.parentNode;
    if (!parent) return;
    const code = oldScript.textContent || '';
    if (!code.trim()) return;
    try { (new Function(code)).call(window); } catch (e) { debugError('Script execution failed', e); }
  });
}

function renderSchemaForm(schema, data) {
  const container = document.getElementById('schemaFormContainer');
  container.innerHTML = '';
  Object.entries(schema).forEach(([key, field]) => {
    const currentVal = (data && data[key] !== undefined) ? data[key] : (field.default || '');
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.textContent = field.label || key;
    group.appendChild(label);
    const input = document.createElement('input');
    input.type = field.type === 'number' ? 'number' : 'text';
    input.value = currentVal;
    input.dataset.key = key;
    group.appendChild(input);
    container.appendChild(group);
  });
}

function closeFileEditor() {
  if (state.currentModalInstance) state.currentModalInstance.close();
  state.currentModalInstance = null;
}

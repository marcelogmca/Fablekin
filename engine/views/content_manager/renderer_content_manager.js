// engine/views/content_manager/renderer_content_manager.js

import { state, socket, debugLog, debugError } from './modules/state.js';
import { initializeSocketHandlers } from './modules/socket_handlers.js';
import { renderTree } from './modules/ui_renderer.js';
import { toggleFile } from './modules/file_actions.js';
import { savePlayerMetadata } from './modules/player_metadata.js';
import { renderProjectDirectives } from './modules/directives.js';
import { setupDragAndDrop } from './modules/drag_drop.js';

// Initialization
async function initializeApp() {
  try {
    debugLog('Initializing Project Content Manager view...');
    initializeEventListeners();
    setupAdvancedMode();
    setupProjectNotes();
    initializeSocketHandlers(socket);
    socket.on('project-ready', () => { void loadProjectNotes(); });

    const response = await socket.emitReceive('get-core-folders', {});
    if (response && response.success) {
      state.coreFolderMap = response.coreFolders;
      renderProjectDirectives();
      if (state.currentStructure.length > 0) renderTree(state.currentStructure);
    }

    void loadProjectNotes(true);
  } catch (error) {
    debugError('Failed to initialize view', error);
  }
}

function initializeEventListeners() {
  const tree = document.getElementById('tree');
  setupDragAndDrop(tree);

  tree.addEventListener('click', async (e) => {
    const target = e.target;
    const trigger = target.closest('.custom-select-trigger');
    if (trigger) {
      const container = trigger.closest('.custom-select-container');
      if (container.classList.contains('disabled')) return;
      document.querySelectorAll('.custom-select-container.open').forEach(c => c !== container && c.classList.remove('open', 'drop-up'));
      const rect = trigger.getBoundingClientRect();
      if (window.innerHeight - rect.bottom < 300 && rect.top > 300) container.classList.add('drop-up');
      container.classList.toggle('open');
      e.stopPropagation();
      return;
    }

    const option = target.closest('.custom-option');
    if (option) {
      const container = option.closest('.custom-select-container');
      const { path, value } = option.dataset;
      const rawState = state.selectedFiles.get(path) || 'none';
      const prev = (typeof rawState === 'object') ? rawState.mode : rawState;

      if (value !== prev) {
        toggleFile(path, value, prev);
      }
      container.classList.remove('open');
      e.stopPropagation();
      return;
    }

    if (target.classList.contains('edit-file-btn')) {
      const path = target.dataset.path;
      const raw = state.selectedFiles.get(path) || 'none';
      const mode = (typeof raw === 'object') ? raw.mode : raw;
      const locked = (typeof raw === 'object') ? raw.lockedMode : null;
      const effective = locked || mode;
      const metadata = state.pluginModes[effective];

      if (metadata && metadata.customEditor) {
        socket.emit('request-plugin-file-view', { filePath: path, modeId: effective, pluginId: metadata.pluginId, isEdit: true });
      } else {
        socket.emit('get-file-content', { filePath: path });
      }
    } else if (target.classList.contains('delete-file-btn')) {
      const path = target.dataset.path;
      const isDb = path.toLowerCase().endsWith('.db') && path.includes('3_Chronicles');
      const confirmed = await Modals.confirm(isDb ? '⚠ DANGER: Delete Chat History' : 'Delete File', `Are you sure?`, { variant: isDb ? 'danger' : 'default' });
      if (confirmed) socket.emit('delete-file', { filePath: path });
    } else if (target.classList.contains('new-file-btn')) {
      openNewFileModal(target.dataset.path);
    } else if (target.classList.contains('rename-file-btn')) {
      openRenameModal(target.dataset.path);
    }
  });

  document.addEventListener('click', () => document.querySelectorAll('.custom-select-container.open').forEach(c => c.classList.remove('open', 'drop-up')));

  document.getElementById('saveFileBtn').addEventListener('click', () => {
    const { path, mode } = document.getElementById('saveFileBtn').dataset;
    const schema = state.pluginModes[mode]?.schema;
    const content = schema ? JSON.stringify(getSchemaFormData(), null, 2) : document.getElementById('fileEditorTextarea').value;
    socket.emit('save-file-content', { filePath: path, content });
  });

  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    closeCurrentModal();
  });

  document.getElementById('createFileBtn').addEventListener('click', () => {
    const dir = document.getElementById('createFileBtn').dataset.path;
    let name = document.getElementById('newFileNameInput').value.trim();
    if (!name) return;
    if (dir.includes('3_Chronicles')) {
      if (!name.endsWith('.db')) name += '.db';
      socket.emit('create-new-chat-db', { directoryPath: dir, fileName: name });
    } else {
      if (!name.endsWith('.md')) name += '.md';
      socket.emit('create-new-file', { directoryPath: dir, fileName: name });
    }
    if (state.currentModalInstance) state.currentModalInstance.close();
  });

  document.getElementById('renameFileBtn').addEventListener('click', () => {
    const oldPath = document.getElementById('renameFileBtn').dataset.path;
    const newName = document.getElementById('renameFileNameInput').value.trim();
    if (newName) socket.emit('rename-file', { oldPath, newName });
    closeCurrentModal();
  });

  document.getElementById('cancelCreateFileBtn')?.addEventListener('click', closeCurrentModal);
  document.getElementById('cancelRenameFileBtn')?.addEventListener('click', closeCurrentModal);

  document.getElementById('savePlayerNameBtn')?.addEventListener('click', savePlayerMetadata);
  document.getElementById('editPlayerBioBtn')?.addEventListener('click', openPlayerBioModal);
  document.getElementById('savePlayerBioBtn')?.addEventListener('click', () => { savePlayerMetadata(); if (state.currentModalInstance) state.currentModalInstance.close(); });
  document.getElementById('cancelPlayerBioBtn')?.addEventListener('click', closeCurrentModal);
  document.getElementById('openProjectFolderBtn')?.addEventListener('click', () => { void openProjectFolder('open-project-folder'); });
  document.getElementById('openProjectAssetsFolderBtn')?.addEventListener('click', () => { void openProjectFolder('open-project-assets-folder'); });

  document.getElementById('saveProjectNotesBtn')?.addEventListener('click', () => { void saveProjectNotes(); });
  document.getElementById('projectNotesTextarea')?.addEventListener('input', () => setProjectNotesStatus('Unsaved changes...'));
  document.getElementById('projectNotesTextarea')?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void saveProjectNotes();
    }
  });
  document.getElementById('projectNotesTextarea')?.addEventListener('blur', () => {
    const statusNode = document.getElementById('projectNotesStatus');
    if (statusNode && statusNode.textContent === 'Unsaved changes...') {
      void saveProjectNotes(true);
    }
  });
}

function setupAdvancedMode() {
  const toggle = document.getElementById('advancedModeToggle');
  if (!toggle) return;
  socket.emitReceive('get-project-advanced-mode', {}).then(res => {
    const enabled = !!(res && res.enabled);
    toggle.checked = enabled;
    applyAdvancedMode(enabled);
  });
  toggle.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    applyAdvancedMode(enabled);
    socket.emit('update-project-advanced-mode', { enabled });
  });
}

function applyAdvancedMode(enabled) {
  document.body.classList.toggle('advanced-mode', enabled);
  if (state.currentStructure.length > 0) renderTree(state.currentStructure);
}

function setupProjectNotes() {
  const toggle = document.getElementById('projectNotesToggle');
  if (!toggle) return;

  toggle.addEventListener('change', async (e) => {
    const visible = !!e.target.checked;
    applyProjectNotesVisibility(visible);
    const response = await socket.emitReceive('update-project-notes', { visible });
    if (!(response && response.success)) {
      debugError('Failed to persist project notes visibility', response?.error);
      setProjectNotesStatus('Could not save notes visibility.', true);
      return;
    }
    applyProjectNotesVisibility(response.visible);
  });
}

async function loadProjectNotes(silentError = false) {
  const panel = document.getElementById('project-notes-panel');
  const textarea = document.getElementById('projectNotesTextarea');
  const toggle = document.getElementById('projectNotesToggle');
  if (!panel || !textarea || !toggle) return;

  const response = await socket.emitReceive('get-project-notes', {});
  if (!(response && response.success)) {
    debugError('Failed to load project notes', response?.error);
    if (!silentError) setProjectNotesStatus('Could not load notes.', true);
    return;
  }

  textarea.value = typeof response.notes === 'string' ? response.notes : '';
  applyProjectNotesVisibility(response.visible !== false);
  setProjectNotesStatus('');
}

function applyProjectNotesVisibility(visible) {
  const panel = document.getElementById('project-notes-panel');
  const toggle = document.getElementById('projectNotesToggle');
  if (!panel || !toggle) return;

  toggle.checked = !!visible;
  panel.classList.toggle('hidden-notes', !visible);
}

async function saveProjectNotes(silent = false) {
  const textarea = document.getElementById('projectNotesTextarea');
  if (!textarea) return;

  const response = await socket.emitReceive('update-project-notes', { notes: textarea.value || '' });
  if (!(response && response.success)) {
    debugError('Failed to save project notes', response?.error);
    setProjectNotesStatus('Could not save notes.', true);
    return;
  }

  if (!silent) setProjectNotesStatus('Notes saved.', false, true);
}

function setProjectNotesStatus(message, isError = false, isSuccess = false) {
  const statusNode = document.getElementById('projectNotesStatus');
  if (!statusNode) return;

  statusNode.textContent = message || '';
  statusNode.classList.remove('error', 'success');
  if (isError) statusNode.classList.add('error');
  else if (isSuccess) statusNode.classList.add('success');
}

function openNewFileModal(dir) {
  document.getElementById('createFileBtn').dataset.path = dir;
  const input = document.getElementById('newFileNameInput');
  if (input) input.value = '';
  state.currentModalInstance = Modals.show({ title: 'New File', content: document.getElementById('new-file-content'), buttons: [] });
  input?.focus();
}

function openRenameModal(path) {
  document.getElementById('renameFileBtn').dataset.path = path;
  const input = document.getElementById('renameFileNameInput');
  if (input) {
    const fileName = path.split(/[\\/]/).pop() || '';
    input.value = fileName.toLowerCase().endsWith('.md') ? fileName.slice(0, -3) : fileName;
  }
  state.currentModalInstance = Modals.show({ title: 'Rename File', content: document.getElementById('rename-file-content'), buttons: [] });
  input?.focus();
  input?.select();
}

function openPlayerBioModal() {
  socket.emit('get-player-metadata');
  state.currentModalInstance = Modals.show({
    title: 'Character Bio',
    content: document.getElementById('player-bio-content'),
    className: 'modal-large player-bio-modal',
    buttons: []
  });
  document.getElementById('playerBioTextarea')?.focus();
}

async function openProjectFolder(eventName) {
  const response = await socket.emitReceive(eventName, {});
  if (!(response && response.success)) {
    debugError(`Failed to open folder via ${eventName}`, response?.error);
    Modals.alert('Open Folder', response?.error || 'Could not open the folder.');
  }
}

function getSchemaFormData() {
  const data = {};
  document.querySelectorAll('#schemaFormContainer input').forEach(i => data[i.dataset.key] = i.value);
  return data;
}

function closeCurrentModal() {
  if (state.currentModalInstance) state.currentModalInstance.close();
  state.currentModalInstance = null;
}

document.addEventListener('DOMContentLoaded', initializeApp);

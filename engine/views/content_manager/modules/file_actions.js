// engine/views/content_manager/modules/file_actions.js

import { state, socket, debugLog, debugError } from './state.js';
import { findFileInStructure, getFilesRecursive } from './utils.js';
import { renderTree } from './ui_renderer.js';

/**
 * Saves the current file selection configuration to the backend.
 */
export async function saveConfig() {
  try {
    const config = { files: Object.fromEntries(state.selectedFiles) };
    const success = await socket.emitReceive('save-file-config', config);
    if (!success) debugError('Failed to save config');
    else debugLog('Config saved successfully');
  } catch (error) {
    debugError('Error saving config', error);
  }
}

/**
 * Handles the change event for file selection dropdowns.
 */
export async function toggleFile(path, newState, previousState) {
  debugLog(`Toggling file: ${path} to state: ${newState}`);

  const item = findFileInStructure(state.currentStructure, path);
  if (!item) {
    debugError(`File not found in structure: ${path}`);
    return;
  }

  // Handle conversion triggers
  if (newState === 'chat' && path.endsWith('.md')) {
    socket.emit('convert-md-to-chat-db', { filePath: path });
    return;
  }

  const targetModeMetadata = state.pluginModes[newState];
  if (targetModeMetadata && targetModeMetadata.conversion && path.endsWith('.md')) {
    const { targetExtension, title, message } = targetModeMetadata.conversion;
    const confirmed = await Modals.confirm(
      title || 'Convert File',
      message || `Selecting this mode will convert this file to ${targetExtension}. All existing text content will be replaced. Are you sure?`,
      { variant: 'warning' }
    );
    if (confirmed) {
      socket.emit('request-file-conversion', {
        filePath: path,
        targetExtension: targetExtension || '.db',
        targetMode: newState
      });
    } else {
      renderTree(state.currentStructure);
    }
    return;
  }

  // Schema warnings
  const rawState = state.selectedFiles.get(path);
  const lockedMode = (typeof rawState === 'object' && rawState !== null) ? rawState.lockedMode : null;
  const isTargetSchemaMode = targetModeMetadata && targetModeMetadata.schema;
  
  if (isTargetSchemaMode && (previousState === 'none' && lockedMode !== newState) && previousState !== newState) {
      const confirmation = await Modals.confirm(
        'Switching Mode',
        `This mode uses a custom structured format. If you edit and save this file, its current contents will be replaced with JSON data.\n\nAre you sure you want to switch to ${targetModeMetadata.label}?`
      );
      if (!confirmation) {
        renderTree(state.currentStructure);
        return;
      }
  }

  // Enforce one active chat file
  if (newState === 'chat' && path.endsWith('.db')) {
    for (const [otherPath, stateObj] of state.selectedFiles.entries()) {
      if (otherPath !== path) {
        const mode = (typeof stateObj === 'object') ? stateObj.mode : stateObj;
        if (mode === 'chat') {
          if (typeof stateObj === 'object') state.selectedFiles.set(otherPath, { ...stateObj, mode: 'none' });
          else state.selectedFiles.set(otherPath, 'none');
        }
      }
    }
  }

  // Update state
  const currentVal = state.selectedFiles.get(path);
  if (typeof currentVal === 'object' && currentVal !== null) {
    if (isTargetSchemaMode && !currentVal.lockedMode) {
      state.selectedFiles.set(path, { ...currentVal, mode: newState, lockedMode: newState });
    } else {
      state.selectedFiles.set(path, { ...currentVal, mode: newState });
    }
  } else {
    if (isTargetSchemaMode) state.selectedFiles.set(path, { mode: newState, order: 100, lockedMode: newState });
    else state.selectedFiles.set(path, newState);
  }

  renderTree(state.currentStructure);
  saveConfig();
}

/**
 * Applies the received directory structure and configuration.
 */
export function applyDirectoryStructure(result) {
  if (!result || !result.structure) return;
  debugLog('Applying new directory structure.', result);
  state.currentProjectName = result.projectName;
  if (result.pluginModes) state.pluginModes = result.pluginModes;
  state.currentStructure = result.structure;

  // Project configs use a structured schema. Keep compatibility with older
  // flat directory payloads, but never treat config sections as file paths.
  const rawConfig = (result.config?.files && typeof result.config.files === 'object')
    ? result.config.files
    : (result.config || {});
  const migratedFiles = new Map();
  const allItemsOnDisk = getFilesRecursive(state.currentStructure);

  allItemsOnDisk.forEach(item => {
    const configEntry = rawConfig[item.path];
    let mode = 'none';
    let order = item.order || 100;
    let lockedMode = null;

    if (configEntry) {
      if (typeof configEntry === 'string') mode = configEntry;
      else {
        mode = configEntry.mode || 'none';
        order = configEntry.order !== undefined ? configEntry.order : order;
        lockedMode = configEntry.lockedMode;
      }
    } else {
      mode = (item.isLocked || item.mode === 'auto-included') ? 'auto-included' : (item.mode || 'none');
    }
    migratedFiles.set(item.path, { mode, order, lockedMode });
  });

  // Preserve missing files
  for (const [path, val] of Object.entries(rawConfig)) {
    if (path === '__pending_renames__') continue;
    if (!migratedFiles.has(path)) {
      if (typeof val === 'string') migratedFiles.set(path, { mode: val, order: 9999, lockedMode: null });
      else migratedFiles.set(path, val);
    }
  }

  state.selectedFiles = migratedFiles;
  renderTree(state.currentStructure);
}

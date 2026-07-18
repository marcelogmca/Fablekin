// engine/views/content_manager/modules/utils.js

import { state, debugLog } from './state.js';

/**
 * Recursively finds a file within a given directory structure.
 */
export function findFileInStructure(structure, path) {
  for (const item of structure) {
    if (item.type === 'file' && item.path === path) {
      return item;
    }
    if (item.children) {
      const found = findFileInStructure(item.children, path);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Recursively extracts all file objects from a given directory structure.
 */
export function getFilesRecursive(structure) {
  let files = [];
  for (const item of structure) {
    if (item.type === 'file') {
      files.push(item);
    } else if (item.children) {
      files = files.concat(getFilesRecursive(item.children));
    }
  }
  return files;
}

/**
 * Returns a display name for a file or folder, removing numbered prefixes.
 */
export function getDisplayName(name, isTopLevel = false) {
  if (isTopLevel && state.coreFolderMap[name]) {
    return state.coreFolderMap[name].name || state.coreFolderMap[name].label || name;
  }
  return name.replace(/^[0-9]+_/, '');
}

/**
 * Retrieves an array of currently selected files and their processing modes.
 */
export function getSelectedFiles() {
  const files = Array.from(state.selectedFiles.entries()).map(([path, stateObj]) => ({
    path,
    mode: (typeof stateObj === 'object' && stateObj !== null) ? stateObj.mode : stateObj
  }));
  debugLog('getSelectedFiles returning:', files);
  return files;
}

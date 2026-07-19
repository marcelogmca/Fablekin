// engine/views/content_manager/modules/state.js

export const DEBUG = true;

export const SERVER_URL = typeof window.getAppServerUrl === 'function'
  ? window.getAppServerUrl()
  : 'http://localhost:14541';

export const socket = io(SERVER_URL);
window.socket = socket;

/**
 * Emits an event to the main process and waits for a corresponding response.
 */
socket.emitReceive = function (eventName, data) {
  return new Promise((resolve) => {
    this.emit(eventName, data);
    this.once(`${eventName}-response`, (result) => {
      resolve(result);
    });
  });
};


export const NATIVE_MODES = {
  'none': { label: 'Not included', description: 'File will not be sent to the AI context.' },
  'full': { label: 'Full content', description: 'Sends the entire verbatim text of the file to the AI. Sent every single turn.', backgroundColor: '#2d5a27', color: '#ffffff' },
  'summary': { label: 'Summarized', description: 'Sends a condensed AI-generated summary of the file to save context. Sent every single turn.', backgroundColor: '#8a6d1a', color: '#ffffff' },
  'auto': { label: 'Auto (RAG)', description: 'Breaks down the file and uses RAG to pull only the most relevant snippets. It\'s like an automated lore book.', backgroundColor: '#1a4a8a', color: '#ffffff' },
  'intro': { label: 'Intro / Prologue', description: 'Sets the stage for the adventure. This file is only sent during Turn 1 to initialize the story. It will be permanently recorded as part of the first turn\'s interaction.', backgroundColor: '#d4af37', color: '#ffffff' },
  'chat': { label: 'Chat history', description: 'Designates this file as the active narrative history. Only one chat file allowed.', backgroundColor: '#6a1a8a', color: '#ffffff', isAdvanced: true },
  'auto-included': { label: 'Auto Included', description: 'This file is automatically managed by a plugin and its position in the tree does not matter.', backgroundColor: '#444444', color: '#bbbbbb' },
  'story-script': { label: 'Story Script', description: 'Executes project-level scripting. More info available while editing. Triggers security review on load.', backgroundColor: '#b83b5e', color: '#ffffff', isAdvanced: true }
};

export const state = {
    selectedFiles: new Map(),
    currentStructure: [],
    currentProjectName: null,
    pluginModes: {},
    coreFolderMap: {},
    dropdownToReopen: null,
    currentPlayerMetadata: { name: '', bio: '' },
    isSavingPlayerMetadata: false,
    currentModalInstance: null
};

export function debugLog(message, data = null) {
  if (DEBUG) {
    console.log(`[CONTENT_MANAGER-DEBUG] ${message}`, data || '');
  }
}

export function debugError(message, error = null) {
  if (DEBUG) {
    console.error(`[CONTENT_MANAGER-ERROR] ${message}`, error || '');
  }
}

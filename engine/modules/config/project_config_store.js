function ensureObject(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
}

const PROJECT_CONFIG_SECTIONS = Object.freeze(['files', 'metadata', 'directives', 'ui', 'runtime']);

function isStructuredProjectConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return false;
  return PROJECT_CONFIG_SECTIONS.some((section) => Object.prototype.hasOwnProperty.call(rawConfig, section));
}

function toStructuredProjectConfig(rawConfig = {}) {
  const raw = ensureObject(rawConfig);
  if (Object.keys(raw).length > 0 && !isStructuredProjectConfig(raw)) {
    throw new Error('Unsupported project config format. Delete and recreate the project config for this pre-release build.');
  }

  return {
    files: ensureObject(raw.files),
    metadata: ensureObject(raw.metadata),
    directives: ensureObject(raw.directives),
    ui: ensureObject(raw.ui),
    runtime: ensureObject(raw.runtime)
  };
}

function getProjectMetadata(config) {
  return toStructuredProjectConfig(config).metadata;
}

function setProjectMetadata(config, metadata) {
  const structured = toStructuredProjectConfig(config);
  structured.metadata = ensureObject(metadata);
  return structured;
}

function getProjectDirectives(config) {
  return toStructuredProjectConfig(config).directives;
}

function setProjectDirective(config, entityId, fieldKey, value) {
  const structured = toStructuredProjectConfig(config);
  if (!structured.directives[entityId] || typeof structured.directives[entityId] !== 'object') {
    structured.directives[entityId] = {};
  }
  structured.directives[entityId][fieldKey] = value;
  return structured;
}

function getPendingRenames(config) {
  return ensureObject(toStructuredProjectConfig(config).runtime.pending_renames);
}

function setPendingRename(config, oldPath, newPath) {
  const structured = toStructuredProjectConfig(config);
  structured.runtime.pending_renames = ensureObject(structured.runtime.pending_renames);
  structured.runtime.pending_renames[oldPath] = newPath;
  return structured;
}

function clearPendingRenames(config) {
  const structured = toStructuredProjectConfig(config);
  delete structured.runtime.pending_renames;
  return structured;
}

function getAdvancedMode(config) {
  return !!toStructuredProjectConfig(config).ui.advanced_mode;
}

function setAdvancedMode(config, enabled) {
  const structured = toStructuredProjectConfig(config);
  structured.ui.advanced_mode = !!enabled;
  return structured;
}

function getAdvancedFiletypesShown(config) {
  return !!toStructuredProjectConfig(config).ui.advanced_filetypes_shown;
}

function setAdvancedFiletypesShown(config, enabled) {
  const structured = toStructuredProjectConfig(config);
  structured.ui.advanced_filetypes_shown = !!enabled;
  return structured;
}

function getProjectNotes(config) {
  const notes = toStructuredProjectConfig(config).metadata.project_notes;
  return typeof notes === 'string' ? notes : '';
}

function setProjectNotes(config, notes) {
  const structured = toStructuredProjectConfig(config);
  structured.metadata.project_notes = typeof notes === 'string' ? notes : '';
  return structured;
}

function getProjectNotesVisible(config) {
  const visible = toStructuredProjectConfig(config).ui.project_notes_visible;
  return visible === undefined ? true : !!visible;
}

function setProjectNotesVisible(config, enabled) {
  const structured = toStructuredProjectConfig(config);
  structured.ui.project_notes_visible = !!enabled;
  return structured;
}

module.exports = {
  isStructuredProjectConfig,
  toStructuredProjectConfig,
  getProjectMetadata,
  setProjectMetadata,
  getProjectDirectives,
  setProjectDirective,
  getPendingRenames,
  setPendingRename,
  clearPendingRenames,
  getAdvancedMode,
  setAdvancedMode,
  getAdvancedFiletypesShown,
  setAdvancedFiletypesShown,
  getProjectNotes,
  setProjectNotes,
  getProjectNotesVisible,
  setProjectNotesVisible
};

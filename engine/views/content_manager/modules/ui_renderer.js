// engine/views/content_manager/modules/ui_renderer.js

import { state, NATIVE_MODES, debugError } from './state.js';
import { getDisplayName } from './utils.js';

/**
 * Generates the HTML string for a custom themed dropdown.
 */
export function createCustomDropdownHTML(path, options, currentValue, isDisabled) {
  if (!options || options.length === 0) return '<div class="custom-select-container disabled"><div class="custom-select-trigger"><span>None Available</span></div></div>';

  const currentOption = options.find(o => o.value === currentValue) || options[0];
  const style = currentOption && currentOption.backgroundColor ? `style="background-color: ${currentOption.backgroundColor}; color: ${currentOption.color || 'inherit'};"` : '';

  let optionsListHTML = '';
  options.forEach(opt => {
    if (opt.isFirstPlugin) {
      optionsListHTML += `<div class="dropdown-separator"><span>Plugin Modes</span></div>`;
    }

    const bgWithAlpha = opt.backgroundColor ? `${opt.backgroundColor}33` : ''; 
    const optStyle = opt.backgroundColor
      ? `style="--opt-border: ${opt.backgroundColor}; --opt-bg: ${bgWithAlpha};"`
      : '';

    optionsListHTML += `
      <div class="custom-option ${opt.value === currentValue ? 'selected' : ''}" 
           data-value="${opt.value}" 
           data-path="${path}"
           ${optStyle}>
        <div class="option-label">${opt.label}</div>
        ${opt.description ? `<div class="option-desc">${opt.description}</div>` : ''}
      </div>`;
  });

  return `
    <div class="custom-select-container ${isDisabled ? 'disabled' : ''}" data-path="${path}">
      <div class="custom-select-trigger" ${style}>
        <span>${currentOption.label}</span>
        <span class="arrow">▼</span>
      </div>
      <div class="custom-options-list">
        ${optionsListHTML}
      </div>
    </div>`;
}

/**
 * Generates the HTML string for a single file item in the directory tree.
 */
export function createFileItemHTML(item) {
  const isMdFile = item.path.endsWith('.md');
  const isDbFile = item.dbType === 'chat';
  const isKgDbFile = item.dbType === 'kg';
  const isPackageItem = !!item.isPackage;

  const cached = item.isCached ? '<span class="cached">(cached)</span>' : '';

  const rawState = state.selectedFiles.get(item.path) || item.mode || 'none';
  let currentState = (typeof rawState === 'object' && rawState !== null) ? (rawState.mode || 'not-included') : rawState;
  const lockedMode = (typeof rawState === 'object' && rawState !== null) ? rawState.lockedMode : null;
  const packageModeId = item.packageModeId || lockedMode || ((state.pluginModes[currentState] && state.pluginModes[currentState].package) ? currentState : null);
  const packageModeMetadata = packageModeId ? state.pluginModes[packageModeId] : null;

  let icon = '📄';
  if (isDbFile) icon = '🗃️';
  if (isKgDbFile) icon = '📚';
  if (item.isLocked) icon = '🔒';
  if (lockedMode || (state.pluginModes[currentState] && state.pluginModes[currentState].schema) || isPackageItem) {
    icon = '⚙️';
  }

  const MAX_EDITABLE_TOKENS = 100000;
  const isTooLargeToEdit = !isMdFile || item.tokenCount > MAX_EDITABLE_TOKENS;

  let options = [];
  let dropdownDisabled = item.isLocked;
  let tokenText = `${item.tokenCount} tokens`;

  const pathParts = item.path.split(/[\\\/]/);
  const isChroniclesFolder = pathParts.some(part => {
    for (const key in state.coreFolderMap) {
        if (key === part && state.coreFolderMap[key].id === 'chronicles') return true;
    }
    return false;
  });
  const isSystemBuildingImportant = pathParts.some(part => {
    for (const key in state.coreFolderMap) {
        if (key === part && (state.coreFolderMap[key].id === 'directives' || state.coreFolderMap[key].id === 'lore_book' || state.coreFolderMap[key].id === 'overrides')) return true;
    }
    return false;
  });
  const isDirectivesOrOverrides = pathParts.some(part => {
    for (const key in state.coreFolderMap) {
        if (key === part && (state.coreFolderMap[key].id === 'directives' || state.coreFolderMap[key].id === 'overrides')) return true;
    }
    return false;
  });

  if (item.isLocked) {
    options = [{ value: 'auto-included', ...NATIVE_MODES['auto-included'] }];
    tokenText = '<span class="auto-included-label" title="The position of this file in the tree does not matter; specialized plugins manage how and where this content is injected into the AI prompt.">(Auto Included) - Plugin Managed <span class="tooltip-icon-small">?</span></span>';
    currentState = 'auto-included';
  } else if (isPackageItem) {
    options = [{ value: 'none', ...NATIVE_MODES['none'] }];
    if (packageModeMetadata) {
      options.push({ value: packageModeId, ...packageModeMetadata, isPlugin: true, isFirstPlugin: true });
    }
    tokenText = '(Plugin Package)';
  } else if (isKgDbFile) {
    options = [{ value: 'none', label: 'External KG', description: 'This Knowledge Graph database is automatically integrated.' }];
    dropdownDisabled = true;
    tokenText = '(External KG)';
  } else if (isDbFile) {
    options = [{ value: 'none', ...NATIVE_MODES['none'] }];
    if (isChroniclesFolder) options.push({ value: 'chat', ...NATIVE_MODES['chat'] });
    tokenText = '(Chat DB)';
  } else if (lockedMode || (state.pluginModes[currentState] && state.pluginModes[currentState].schema)) {
    const targetModeId = lockedMode || currentState;
    const metadata = state.pluginModes[targetModeId];
    if (metadata) {
      options = [
        { value: 'none', ...NATIVE_MODES['none'] },
        { value: targetModeId, ...metadata, isPlugin: true, isFirstPlugin: true }
      ];
    } else {
      options = [{ value: 'none', label: 'Not Included (Plugin Missing)', description: `This file was managed by a plugin (${targetModeId}) that is missing or disabled.` }];
    }
    tokenText = '(Plugin File)';
  } else if (isChroniclesFolder) {
    options = [
      { value: 'none', ...NATIVE_MODES['none'] },
      { value: 'chat', ...NATIVE_MODES['chat'], label: 'Chat (Convert to DB)' }
    ];
  } else if (isDirectivesOrOverrides) {
    options = [
      { value: 'none', ...NATIVE_MODES['none'] },
      { value: 'full', ...NATIVE_MODES['full'] }
    ];
  } else {
    // Collect all potential modes for this file
    const allAvailable = [
      { value: 'none', ...NATIVE_MODES['none'] },
      { value: 'full', ...NATIVE_MODES['full'] },
      { value: 'summary', ...NATIVE_MODES['summary'] },
      { value: 'auto', ...NATIVE_MODES['auto'] },
      { value: 'intro', ...NATIVE_MODES['intro'] },
      { value: 'story-script', ...NATIVE_MODES['story-script'] }
    ];

    if (!isSystemBuildingImportant) {
      allAvailable.push({ value: 'chat', ...NATIVE_MODES['chat'], label: 'Chat (Convert to DB)' });
    }

    // Add plugin modes
    for (const [modeId, metadata] of Object.entries(state.pluginModes)) {
      allAvailable.push({ value: modeId, ...metadata, isPlugin: true });
    }

    // Filter based on Global Advanced Mode
    const isAdvancedMode = document.body.classList.contains('advanced-mode');
    
    // Sort out which ones to actually show
    options = allAvailable.filter(opt => {
      // Always show currently selected mode even if it's advanced
      if (opt.value === currentState) return true;
      // Filter based on flag
      return isAdvancedMode || !opt.isAdvanced;
    });

    // Re-apply "First Plugin" separator logic to the filtered list
    let foundFirstPlugin = false;
    options.forEach(opt => {
      if (opt.isPlugin && !foundFirstPlugin) {
        opt.isFirstPlugin = true;
        foundFirstPlugin = true;
      } else {
        opt.isFirstPlugin = false;
      }
    });
  }

  const dropdownHTML = createCustomDropdownHTML(item.path, options, currentState, dropdownDisabled);
  const effectiveMode = lockedMode || currentState;
  const currentModeMetadata = state.pluginModes[effectiveMode] || packageModeMetadata;
  const hasCustomEditor = currentModeMetadata && currentModeMetadata.customEditor;

  const editButtonDisabled = item.isLocked || (!hasCustomEditor && (!isMdFile || isTooLargeToEdit));
  const editButtonTitle = item.isLocked ? 'This file is auto-included and cannot be edited.' : !hasCustomEditor && !isMdFile ? 'Only .md files can be edited.' : !hasCustomEditor && isTooLargeToEdit ? `File exceeds ${MAX_EDITABLE_TOKENS} tokens and cannot be edited directly.` : 'Edit File';

  const renameButton = item.isLocked ? '' : `
    <span class="rename-file-btn rename-icon-btn" data-path="${item.path}" title="Rename File">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
    </span>`;
  const editButton = `<button class="action-btn edit-file-btn" data-path="${item.path}" ${editButtonDisabled ? 'disabled' : ''} title="${editButtonTitle}">Edit</button>`;
  const deleteButton = `<button class="action-btn delete-file-btn" data-path="${item.path}" ${item.isLocked ? 'disabled' : ''} title="${item.isLocked ? 'Auto-included files cannot be deleted.' : 'Delete File'}">Delete</button>`;

  let viewButton = '';
  if (currentModeMetadata && currentModeMetadata.viewer) {
    viewButton = `<button class="action-btn view-processed-btn" data-path="${item.path}" data-mode="${currentState}" data-plugin="${currentModeMetadata.pluginId}" title="View Processed Content">View</button>`;
  }

  const isOrderManaged = !['full', 'summary', 'none', 'not-included'].includes(currentState) && !(typeof currentState === 'string' && currentState.startsWith('none:'));
  let managedLabel = isOrderManaged ? `<span class="order-managed-label" title="Order managed by specialized logic.">Order Managed <span class="tooltip-icon-small">?</span></span>` : '';

  let finalTokenDisplay = '';
  if (currentState === 'full') finalTokenDisplay = `<span class="token-count">~${item.tokenCount} tokens</span>`;
  else if (currentState === 'summary') finalTokenDisplay = `<span class="token-count">~${item.tokenCount} -> up to ~300 tokens</span>`;
  else if (tokenText && tokenText !== `${item.tokenCount} tokens`) finalTokenDisplay = `<span class="token-count">${tokenText}</span>`;

  return `
    <div class="tree-item-content ${item.isLocked ? 'auto-included-item' : ''}" draggable="true" data-path="${item.path}" data-type="file">
        <div class="tree-item-name">
            <span class="tree-connector">└─</span>${icon} ${getDisplayName(item.name)} ${renameButton} <span class="order-number-tag">#${Math.round(item.order)}</span> ${managedLabel} ${finalTokenDisplay} ${cached}
        </div>
        <div class="file-controls-and-actions">
            ${viewButton}
            ${dropdownHTML}
            ${editButton}
            ${deleteButton}
        </div>
    </div>`;
}

/**
 * Renders the directory tree structure recursively.
 */
export function renderTree(items, parent = document.getElementById('tree'), level = 0) {
  parent.innerHTML = '';
  const isAdvanced = document.body.classList.contains('advanced-mode');

  const filteredItems = items.filter(item => {
    if (level === 0 && item.type === 'directory') {
      const coreFolderData = state.coreFolderMap[item.name];
      if (coreFolderData && coreFolderData.id === 'overrides' && !isAdvanced) return false;
    }
    return true;
  });

  filteredItems.forEach((item, index) => {
    try {
      const div = document.createElement('div');
      if (item.type === 'directory') {
        const coreFolderData = (level === 0) ? state.coreFolderMap[item.name] : null;
        const isCoreFolder = !!coreFolderData;
        const displayName = isCoreFolder ? coreFolderData.name : item.name;

        if (isCoreFolder) {
          if (index > 0 && level === 0) {
            const separator = document.createElement('div');
            separator.className = 'section-separator';
            parent.appendChild(separator);
          }
          div.className = `directory main-directory core-area-${coreFolderData.id}`;
          div.innerHTML = `
              <div class="main-directory-header" data-path="${item.path}" data-type="directory">
                  <span>📁 ${displayName} <span class="order-number-tag">#${Math.round(item.order)}</span> <span class="tooltip-icon-small header-tooltip" title="${coreFolderData.tooltip}">?</span></span>
                  <div class="file-actions">
                      <button class="action-btn new-file-btn" data-path="${item.path}">New File</button>
                  </div>
              </div>`;
        } else {
          div.className = `directory sub-directory ${!isCoreFolder ? 'auto-included-item' : ''}`;
          div.innerHTML = `
              <div class="tree-item-content" draggable="true" data-path="${item.path}" data-type="directory">
                  <div class="tree-item-name">
                      <span class="tree-connector">└─</span>📁 ${getDisplayName(item.name)} <span class="order-number-tag">#${Math.round(item.order)}</span> <span class="order-managed-label" title="Order managed by specialized logic.">Order Managed <span class="tooltip-icon-small">?</span></span>
                  </div>
                  <div class="file-actions"></div>
              </div>`;
        }
        const children = document.createElement('div');
        children.className = 'directory-children';
        renderTree(item.children, children, level + 1);
        div.appendChild(children);
      } else {
        div.className = `file-item ${item.isLocked ? 'auto-included-item' : ''}`;
        div.setAttribute('draggable', 'true');
        div.dataset.path = item.path;
        div.dataset.type = 'file';
        div.innerHTML = createFileItemHTML(item);
      }
      parent.appendChild(div);
    } catch (e) {
      debugError(`Error rendering tree item: ${item.name}`, e);
    }
  });

  if (level === 0 && state.dropdownToReopen) {
    setTimeout(() => {
      const containers = document.querySelectorAll('.custom-select-container');
      for (const container of containers) {
        if (container.dataset.path === state.dropdownToReopen) {
          container.classList.add('open');
          const trigger = container.querySelector('.custom-select-trigger');
          if (trigger) {
            const rect = trigger.getBoundingClientRect();
            if (window.innerHeight - rect.bottom < 300 && rect.top > 300) container.classList.add('drop-up');
          }
          break;
        }
      }
      state.dropdownToReopen = null;
    }, 10);
  }
}

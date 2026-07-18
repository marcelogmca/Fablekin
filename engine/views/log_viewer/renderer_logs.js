// renderer_logs.js

// #region INITIALIZATION
const socket = io('http://localhost:14541');
let elements = {}; // To cache DOM elements
let currentProject = null;
let modelPricing = {}; // Will hold pricing info
const {
    calculateCostBreakdown,
    extractCacheTokens,
    deriveReasoningTokenMetric,
    calculateReasoningBreakdown
} = window.LogCostMetrics;
const LOG_PAGE_SIZE = 24;
const LOG_CONTENT_REFRESH_DEBOUNCE_MS = 600;
const RAW_CONSOLE_MAX_RENDERED_LINES = 10000;
let loadedLogFiles = [];
let nextLogOffset = 0;
let hasMoreLogs = false;
let isLoadingLogs = false;
const pendingOpenLogRefreshTimers = new Map();
const splitViewModes = new Map();
const SPLIT_VIEW_STATES = ['turn', 'split', 'console'];
// #endregion

// #region CORE FUNCTIONS & UTILITIES
/**
 * Fetches the logs for the currently active project.
 */
function loadLogsForCurrentProject() {
    console.log('[loadLogsForCurrentProject] Called. Current project:', currentProject);
    if (!currentProject) {
        loadedLogFiles = [];
        nextLogOffset = 0;
        hasMoreLogs = false;
        isLoadingLogs = false;
        elements.loadingIndicator.classList.add('hidden');
        elements.projectTitle.textContent = 'No Project Loaded';
        renderLogList([], 'No project is currently loaded. Please load a project from the main tab.');
        return;
    }
    elements.projectTitle.textContent = `Project: ${currentProject}`;
    requestLogPage({ reset: true });
}

/**
 * Requests one page of log files. The backend validates only enough files to fill
 * this page, which keeps large log directories responsive.
 */
function requestLogPage({ reset = false } = {}) {
    if (!currentProject || (isLoadingLogs && !reset)) return;

    if (reset) {
        loadedLogFiles = [];
        nextLogOffset = 0;
        hasMoreLogs = false;
    }

    isLoadingLogs = true;
    if (reset) renderLogList([]);
    elements.loadingIndicator.classList.toggle('hidden', loadedLogFiles.length > 0);
    renderLoadMoreControl();
    socket.emit('get-all-logs', {
        projectName: currentProject,
        offset: nextLogOffset,
        limit: LOG_PAGE_SIZE
    });
}

function getLogTimestamp(filename) {
    const match = filename.match(/^(?:console_session_|console_|turn_|system_)?(\d+)\.(?:json|log)$/);
    return match ? parseInt(match[1], 10) || null : null;
}

function formatLogDate(timestamp) {
    if (!timestamp) return 'Unknown time';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Unknown time';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getLogKind(filename) {
    if (filename.startsWith('console_session_')) return 'system-console';
    if (filename.startsWith('console_')) return 'console';
    if (filename.startsWith('system_')) return 'system-data';
    if (filename.startsWith('turn_')) return 'turn';
    return 'data';
}

function getLogKindMeta(kind) {
    const meta = {
        console: { label: 'Console', short: 'C' },
        turn: { label: 'Turn Data', short: 'T' },
        'system-console': { label: 'System Console', short: 'SC' },
        'system-data': { label: 'System Data', short: 'SD' },
        data: { label: 'Data', short: 'D' }
    };
    return meta[kind] || meta.data;
}

function getLogFileKey(fileObj) {
    return `${fileObj.projectName || currentProject}:${fileObj.filename}`;
}

function mergeLogFiles(existingFiles, incomingFiles) {
    const seen = new Set(existingFiles.map(getLogFileKey));
    const merged = existingFiles.slice();

    incomingFiles.forEach(fileObj => {
        const normalized = { ...fileObj, projectName: fileObj.projectName || currentProject };
        const key = getLogFileKey(normalized);
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(normalized);
        }
    });

    return merged;
}

function sortLogFilesForGroup(files) {
    const order = {
        turn: 0,
        console: 1,
        'system-console': 2,
        'system-data': 3,
        data: 4
    };
    return files.slice().sort((a, b) => {
        const kindA = getLogKind(a.filename);
        const kindB = getLogKind(b.filename);
        if (order[kindA] !== order[kindB]) return order[kindA] - order[kindB];
        return a.filename.localeCompare(b.filename);
    });
}

function groupLogFiles(files) {
    const groupsByKey = new Map();

    files.forEach(fileObj => {
        const timestamp = getLogTimestamp(fileObj.filename);
        const projectName = fileObj.projectName || currentProject;
        const key = timestamp ? `${projectName}:${timestamp}` : `${projectName}:${fileObj.filename}`;
        if (!groupsByKey.has(key)) {
            groupsByKey.set(key, {
                key,
                timestamp,
                projectName,
                files: []
            });
        }
        groupsByKey.get(key).files.push({ ...fileObj, projectName });
    });

    return Array.from(groupsByKey.values())
        .map(group => ({ ...group, files: sortLogFilesForGroup(group.files) }))
        .sort((a, b) => {
            const timeA = a.timestamp || 0;
            const timeB = b.timestamp || 0;
            if (timeB !== timeA) return timeB - timeA;
            return a.key.localeCompare(b.key);
        });
}

function formatFilename(filename) {
    const timestamp = getLogTimestamp(filename);
    if (timestamp) {
        try {
            const kind = getLogKind(filename);
            const meta = getLogKindMeta(kind);
            return `${meta.label}: ${filename} (${formatLogDate(timestamp)})`;
        } catch (error) {
            console.error(`Error parsing timestamp from filename: ${filename}`, error);
        }
    }
    return filename;
}

function formatByteSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB'];
    let size = value / 1024;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function createTypeBadge(kind) {
    const meta = getLogKindMeta(kind);
    const badge = document.createElement('span');
    badge.className = `log-type-badge log-type-${kind}`;
    badge.textContent = meta.label;
    return badge;
}

function createLogFileItem(fileObj) {
    const filename = fileObj.filename;
    const projectName = fileObj.projectName || currentProject;
    const kind = getLogKind(filename);
    const meta = getLogKindMeta(kind);

    const fileItem = document.createElement('div');
    fileItem.className = `log-file-item log-kind-${kind}`;
    fileItem.dataset.filename = filename;
    fileItem.dataset.projectName = projectName;

    const fileHeader = document.createElement('button');
    fileHeader.type = 'button';
    fileHeader.className = 'log-file-header';
    fileHeader.title = formatFilename(filename);

    const kindIcon = document.createElement('span');
    kindIcon.className = 'log-kind-icon';
    kindIcon.textContent = meta.short;

    const titleWrap = document.createElement('span');
    titleWrap.className = 'log-file-title';

    const primary = document.createElement('span');
    primary.className = 'log-file-primary';
    primary.textContent = meta.label;

    const secondary = document.createElement('span');
    secondary.className = 'log-file-secondary';
    secondary.textContent = filename;

    const toggle = document.createElement('span');
    toggle.className = 'log-file-toggle';
    toggle.textContent = '+';

    titleWrap.appendChild(primary);
    titleWrap.appendChild(secondary);
    fileHeader.appendChild(kindIcon);
    fileHeader.appendChild(titleWrap);
    fileHeader.appendChild(toggle);

    const topicsContainer = document.createElement('div');
    topicsContainer.className = 'log-topics-container';
    topicsContainer.innerHTML = '<p>Loading...</p>';

    fileItem.appendChild(fileHeader);
    fileItem.appendChild(topicsContainer);
    return fileItem;
}

function applySplitViewState(groupElement, mode) {
    const normalizedMode = SPLIT_VIEW_STATES.includes(mode) ? mode : 'split';
    const groupKey = groupElement.dataset.groupKey;
    const rail = groupElement.querySelector('.log-split-view-rail');
    if (!rail) return;

    groupElement.dataset.splitView = normalizedMode;
    splitViewModes.set(groupKey, normalizedMode);

    const stateIndex = SPLIT_VIEW_STATES.indexOf(normalizedMode);
    const leftButton = rail.querySelector('[data-split-direction="left"]');
    const rightButton = rail.querySelector('[data-split-direction="right"]');
    const stateLabel = rail.querySelector('.log-split-view-state');
    const indicators = rail.querySelectorAll('.log-split-view-dot');

    leftButton.disabled = stateIndex === 0;
    rightButton.disabled = stateIndex === SPLIT_VIEW_STATES.length - 1;
    leftButton.title = normalizedMode === 'console' ? 'Return to split view' : 'Expand Turn Data';
    rightButton.title = normalizedMode === 'turn' ? 'Return to split view' : 'Expand Console';
    leftButton.setAttribute('aria-label', leftButton.title);
    rightButton.setAttribute('aria-label', rightButton.title);

    const labels = {
        turn: 'Turn Data expanded',
        split: 'Turn Data and Console balanced',
        console: 'Console expanded'
    };
    stateLabel.textContent = labels[normalizedMode];
    indicators.forEach((indicator, index) => {
        indicator.classList.toggle('active', index === stateIndex);
    });
}

function createSplitViewRail(groupElement) {
    const rail = document.createElement('div');
    rail.className = 'log-split-view-rail';
    rail.setAttribute('role', 'group');
    rail.setAttribute('aria-label', 'Turn Data and Console layout');

    const controls = document.createElement('div');
    controls.className = 'log-split-view-controls';

    const leftButton = document.createElement('button');
    leftButton.type = 'button';
    leftButton.className = 'log-split-view-button';
    leftButton.dataset.splitDirection = 'left';
    leftButton.textContent = '\u203a';

    const indicators = document.createElement('div');
    indicators.className = 'log-split-view-indicators';
    indicators.setAttribute('aria-hidden', 'true');
    SPLIT_VIEW_STATES.forEach(() => {
        const dot = document.createElement('span');
        dot.className = 'log-split-view-dot';
        indicators.appendChild(dot);
    });

    const rightButton = document.createElement('button');
    rightButton.type = 'button';
    rightButton.className = 'log-split-view-button';
    rightButton.dataset.splitDirection = 'right';
    rightButton.textContent = '\u2039';

    const stateLabel = document.createElement('span');
    stateLabel.className = 'log-split-view-state';
    stateLabel.setAttribute('aria-live', 'polite');

    const move = (offset) => {
        const currentMode = groupElement.dataset.splitView || 'split';
        const nextIndex = Math.max(0, Math.min(
            SPLIT_VIEW_STATES.length - 1,
            SPLIT_VIEW_STATES.indexOf(currentMode) + offset
        ));
        applySplitViewState(groupElement, SPLIT_VIEW_STATES[nextIndex]);
    };

    leftButton.addEventListener('click', () => move(-1));
    rightButton.addEventListener('click', () => move(1));

    controls.appendChild(leftButton);
    controls.appendChild(indicators);
    controls.appendChild(rightButton);
    controls.appendChild(stateLabel);
    rail.appendChild(controls);
    return rail;
}

function createLogGroup(group) {
    const groupElement = document.createElement('section');
    groupElement.className = 'log-turn-group';
    groupElement.dataset.groupKey = group.key;

    const summary = document.createElement('div');
    summary.className = 'log-turn-summary';

    const titleBlock = document.createElement('div');
    titleBlock.className = 'log-turn-title-block';

    const title = document.createElement('div');
    title.className = 'log-turn-title';
    const groupKinds = new Set(group.files.map(fileObj => getLogKind(fileObj.filename)));
    let groupLabel = 'Data log';
    if (group.projectName === 'system') {
        groupLabel = 'System log';
    } else if (groupKinds.has('turn')) {
        groupLabel = 'Turn log';
    } else if (groupKinds.has('console') || groupKinds.has('system-console')) {
        groupLabel = 'Console log';
    }
    title.textContent = group.timestamp ? `${groupLabel} - ${formatLogDate(group.timestamp)}` : 'Unmatched log file';

    const subtitle = document.createElement('div');
    subtitle.className = 'log-turn-subtitle';
    subtitle.textContent = `${group.projectName} - ${group.files.length} ${group.files.length === 1 ? 'file' : 'files'}`;

    const badges = document.createElement('div');
    badges.className = 'log-turn-badges';
    const seenKinds = new Set();
    group.files.forEach(fileObj => {
        const kind = getLogKind(fileObj.filename);
        if (!seenKinds.has(kind)) {
            seenKinds.add(kind);
            badges.appendChild(createTypeBadge(kind));
        }
    });

    titleBlock.appendChild(title);
    titleBlock.appendChild(subtitle);
    summary.appendChild(titleBlock);
    summary.appendChild(badges);

    const fileGrid = document.createElement('div');
    fileGrid.className = 'log-file-grid';
    const fileItems = group.files.map(fileObj => ({
        fileObj,
        kind: getLogKind(fileObj.filename),
        element: createLogFileItem(fileObj)
    }));
    const turnFile = fileItems.find(item => item.kind === 'turn' || item.kind === 'system-data');
    const consoleFile = fileItems.find(item => item.kind === 'console' || item.kind === 'system-console');

    if (turnFile && consoleFile && fileItems.length === 2) {
        fileGrid.classList.add('has-split-view');
        turnFile.element.classList.add('log-split-turn-pane');
        consoleFile.element.classList.add('log-split-console-pane');
        fileGrid.appendChild(turnFile.element);
        fileGrid.appendChild(createSplitViewRail(groupElement));
        fileGrid.appendChild(consoleFile.element);
    } else {
        fileItems.forEach(item => fileGrid.appendChild(item.element));
    }

    groupElement.appendChild(summary);
    groupElement.appendChild(fileGrid);
    if (turnFile && consoleFile && fileItems.length === 2) {
        applySplitViewState(groupElement, splitViewModes.get(group.key) || 'split');
    }
    return groupElement;
}

function renderLoadMoreControl() {
    if (!elements.loadMoreContainer) return;
    elements.loadMoreContainer.innerHTML = '';

    if (loadedLogFiles.length === 0) {
        if (!hasMoreLogs || isLoadingLogs) return;
    }

    const status = document.createElement('span');
    status.className = 'log-list-count';
    status.textContent = `${loadedLogFiles.length} log ${loadedLogFiles.length === 1 ? 'file' : 'files'} loaded`;
    elements.loadMoreContainer.appendChild(status);

    if (hasMoreLogs || isLoadingLogs) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'load-more-logs-btn';
        button.disabled = isLoadingLogs;
        button.textContent = isLoadingLogs ? 'Loading...' : 'Show more';
        elements.loadMoreContainer.appendChild(button);
    }
}

function renderLogList(files, emptyMessage = 'No log files found for this project.') {
    if (!elements.logGroupsContainer) return;
    elements.logGroupsContainer.innerHTML = '';

    if (!files || files.length === 0) {
        if (!isLoadingLogs) {
            const noLogs = document.createElement('p');
            noLogs.className = 'no-logs-msg';
            noLogs.textContent = emptyMessage;
            elements.logGroupsContainer.appendChild(noLogs);
        }
        renderLoadMoreControl();
        return;
    }

    groupLogFiles(files).forEach(group => {
        elements.logGroupsContainer.appendChild(createLogGroup(group));
    });
    renderLoadMoreControl();
}

function findLogFileItem(projectName, filename) {
    return Array.from(document.querySelectorAll('.log-file-item')).find(fileItem =>
        fileItem.dataset.filename === filename &&
        fileItem.dataset.projectName === (projectName || currentProject)
    );
}

function scheduleOpenLogContentRefresh(projectName, filename) {
    if (!projectName || !filename || projectName !== currentProject) return;

    const isConsoleLog = filename.startsWith('console_') || filename.startsWith('console_session_');
    const isJsonLog = filename.endsWith('.json');
    if (!isJsonLog || isConsoleLog) return;

    const fileItem = findLogFileItem(projectName, filename);
    if (!fileItem || !fileItem.classList.contains('open')) return;

    const refreshKey = `${projectName}:${filename}`;
    const existingTimer = pendingOpenLogRefreshTimers.get(refreshKey);
    if (existingTimer) clearTimeout(existingTimer);

    const timerId = setTimeout(() => {
        pendingOpenLogRefreshTimers.delete(refreshKey);

        const activeFileItem = findLogFileItem(projectName, filename);
        if (!activeFileItem || !activeFileItem.classList.contains('open')) return;

        socket.emit('get-log-content', { projectName, filename });
    }, LOG_CONTENT_REFRESH_DEBOUNCE_MS);

    pendingOpenLogRefreshTimers.set(refreshKey, timerId);
}



/**
 * Estimates the number of tokens in a given text.
 * @param {string} text - The text to estimate tokens for.
 * @returns {number} The estimated number of tokens.
 */
function estimateTokens(text) {
    if (!text) return 0;
    return text.split(/\s+/).length;
}

const colorPalette = ['#ffcc00', '#3fb950', '#1e90ff', '#e06c75', '#c678dd', '#56b6c2', '#98c379', '#d19a66', '#abb2bf'];

/**
 * Generates a color from a string by hashing it and picking from a palette.
 * @param {string} str - The string to hash.
 * @param {Array<string>} palette - The color palette to choose from.
 * @returns {string} The hashed color.
 */
function getHashedColor(str, palette) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return palette[Math.abs(hash) % palette.length];
}

/**
 * Parses a long prompt string into a hierarchical tree based on headers and XML tags.
 */
function parsePromptIntoTree(text) {
    const markers = [];
    const headerRegex = /^#+\s+(.*)$/gm;
    const tagRegex = /<(\/?[a-zA-Z0-9_-]+)([^>]*)>/g;

    let match;
    while ((match = headerRegex.exec(text)) !== null) {
        markers.push({ type: 'header', label: match[1], level: match[0].trim().split(' ')[0].length, index: match.index, length: match[0].length });
    }
    while ((match = tagRegex.exec(text)) !== null) {
        const isClose = match[1].startsWith('/');
        const tagName = isClose ? match[1].substring(1) : match[1];
        markers.push({ type: isClose ? 'tag-close' : 'tag-open', label: tagName, fullTag: match[0], index: match.index, length: match[0].length });
    }

    markers.sort((a, b) => a.index - b.index);

    const root = { label: 'Full Prompt', children: [], start: 0, end: text.length, type: 'root' };
    const stack = [root];
    let lastIndex = 0;

    const closeToHeaderParent = (headerLevel, keepTagContext) => {
        const boundaryIndex = keepTagContext
            ? stack.findLastIndex(node => node.type === 'tag')
            : 0;
        const minIndex = Math.max(0, boundaryIndex);

        while (stack.length - 1 > minIndex) {
            const top = stack[stack.length - 1];
            if (top.type === 'header' && top.level < headerLevel) {
                break;
            }
            stack.pop();
        }
    };

    for (const marker of markers) {
        const precedingText = text.substring(lastIndex, marker.index);
        if (precedingText.trim()) {
            stack[stack.length - 1].children.push({ type: 'text', text: precedingText, tokens: estimateTokens(precedingText) });
        }

        if (marker.type === 'header') {
            if (isStructuralPartHeader(marker.label)) {
                stack.length = 1;
            } else {
                closeToHeaderParent(marker.level, stack.some(node => node.type === 'tag'));
            }
            const newNode = { type: 'header', label: marker.label, level: marker.level, children: [], start: marker.index };
            stack[stack.length - 1].children.push(newNode);
            stack.push(newNode);
        } else if (marker.type === 'tag-open') {
            const newNode = { type: 'tag', label: marker.label, fullTag: marker.fullTag, children: [], start: marker.index };
            stack[stack.length - 1].children.push(newNode);
            stack.push(newNode);
        } else if (marker.type === 'tag-close') {
            // Robust tag closing: find the matching tag in the stack and pop everything above it.
            const tagIndex = stack.findLastIndex(node => node.type === 'tag' && node.label === marker.label);
            if (tagIndex !== -1) {
                while (stack.length > tagIndex + 1) {
                    stack.pop();
                }
                stack.pop(); // Pop the tag itself
            }
        }
        lastIndex = marker.index + marker.length;
    }

    const remainingText = text.substring(lastIndex);
    if (remainingText.trim()) {
        stack[stack.length - 1].children.push({ type: 'text', text: remainingText, tokens: estimateTokens(remainingText) });
    }

    pruneEmptyPromptMessageTags(root);
    normalizeNarrativeHistoryChapters(root);
    normalizePart3FullTextMessages(root);
    return root;
}

function isStructuralPartHeader(label) {
    return /^PART\s+\d+\b/i.test(String(label || '').trim());
}

function isNarrativeHistoryTag(node) {
    return node?.type === 'tag' && node.label === 'narrative_history';
}

function isRelevantMemoriesTag(node) {
    return node?.type === 'tag' && node.label === 'relevant_memories';
}

function isPartHeader(node, partNumber) {
    const number = Number.parseInt(partNumber, 10);
    return node?.type === 'header' && new RegExp(`^PART\\s+${number}\\b`, 'i').test(String(node.label || '').trim());
}

function isPromptMessageTag(node) {
    return node?.type === 'tag' && node.label === 'prompt_message';
}

function getPromptMessageRole(node) {
    const match = String(node?.fullTag || '').match(/\srole="([^"]+)"/i);
    return match ? match[1].toLowerCase() : '';
}

function collectTraceText(node) {
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    return Array.isArray(node.children)
        ? node.children.map(collectTraceText).join('\n')
        : '';
}

function getLeadingChapterLabel(text) {
    const match = String(text || '').match(/^\s*(Chapter\s+\d+(?:\s+to\s+\d+)?)\s*:/i);
    return match ? match[1].trim() : null;
}

function stripLeadingChapterLabel(node) {
    if (!node?.children) return;
    for (const child of node.children) {
        if (child.type === 'text') {
            child.text = String(child.text || '').replace(/^\s*Chapter\s+\d+(?:\s+to\s+\d+)?\s*:\s*/i, '');
            child.tokens = estimateTokens(child.text);
            return;
        }

        stripLeadingChapterLabel(child);
        if (collectTraceText(child).trim()) return;
    }
}

function pruneEmptyPromptMessageTags(node) {
    if (!node?.children) return;
    node.children = node.children.filter(child => {
        pruneEmptyPromptMessageTags(child);
        return !(isPromptMessageTag(child) && !collectTraceText(child).trim() && (!child.children || child.children.length === 0));
    });
}

function splitNarrativeChapterText(text) {
    const content = String(text || '');
    const chapterRegex = /^Chapter\s+\d+(?:\s+to\s+\d+)?\s*:/gmi;
    const matches = Array.from(content.matchAll(chapterRegex));

    if (matches.length === 0) {
        const trimmed = content.trim();
        return trimmed ? [{ type: 'text', text: trimmed, tokens: estimateTokens(trimmed) }] : [];
    }

    const nodes = [];
    const preface = content.slice(0, matches[0].index).trim();
    if (preface) {
        nodes.push({ type: 'text', text: preface, tokens: estimateTokens(preface) });
    }

    matches.forEach((match, index) => {
        const title = match[0].replace(/:\s*$/, '').trim();
        const bodyStart = match.index + match[0].length;
        const bodyEnd = matches[index + 1]?.index ?? content.length;
        const body = content.slice(bodyStart, bodyEnd).trim();
        const chapterNode = {
            type: 'chapter',
            label: title,
            children: [],
            titleTokens: estimateTokens(title)
        };

        if (body) {
            chapterNode.children.push({ type: 'text', text: body, tokens: estimateTokens(body) });
        }

        nodes.push(chapterNode);
    });

    return nodes;
}

function normalizeNarrativeHistoryChapters(root) {
    const walk = (node) => {
        if (!node?.children) return;

        if (isNarrativeHistoryTag(node)) {
            const normalizedChildren = [];
            let currentChapter = null;

            const appendNode = (child) => {
                if (child.type === 'chapter') {
                    normalizedChildren.push(child);
                    currentChapter = child;
                    return;
                }

                if (currentChapter && isRelevantMemoriesTag(child)) {
                    currentChapter.children.push(child);
                    return;
                }

                if (currentChapter && child.type === 'text') {
                    currentChapter.children.push(child);
                    return;
                }

                normalizedChildren.push(child);
            };

            for (const child of node.children) {
                if (child.type === 'text') {
                    splitNarrativeChapterText(child.text).forEach(appendNode);
                } else {
                    appendNode(child);
                }
            }

            node.children = normalizedChildren;
        }

        node.children.forEach(walk);
    };

    walk(root);
}

function createPromptMessageNode(promptMessageTag, fallbackLabel) {
    const role = getPromptMessageRole(promptMessageTag);
    const label = role === 'user'
        ? 'Player input'
        : role === 'assistant'
            ? 'Narrative output'
            : fallbackLabel || 'Prompt message';

    return {
        type: 'message',
        label,
        role,
        children: promptMessageTag.children || []
    };
}

function normalizePart3FullTextMessages(root) {
    const walk = (node) => {
        if (!node?.children) return;

        if (isPartHeader(node, 3)) {
            const normalizedChildren = [];
            let pendingUserMessage = null;

            const flushPendingUser = () => {
                if (!pendingUserMessage) return;
                normalizedChildren.push(createPromptMessageNode(pendingUserMessage, 'Player input'));
                pendingUserMessage = null;
            };

            for (const child of node.children) {
                if (!isPromptMessageTag(child)) {
                    flushPendingUser();
                    normalizedChildren.push(child);
                    continue;
                }

                const role = getPromptMessageRole(child);
                if (role === 'user') {
                    flushPendingUser();
                    pendingUserMessage = child;
                    continue;
                }

                if (role === 'assistant') {
                    const chapterLabel = getLeadingChapterLabel(collectTraceText(child)) || 'Assistant full text';
                    stripLeadingChapterLabel(child);

                    const chapterNode = {
                        type: 'chapter',
                        label: chapterLabel,
                        children: [],
                        titleTokens: estimateTokens(chapterLabel)
                    };

                    if (pendingUserMessage) {
                        chapterNode.children.push(createPromptMessageNode(pendingUserMessage, 'Player input'));
                        pendingUserMessage = null;
                    }

                    chapterNode.children.push(createPromptMessageNode(child, 'Narrative output'));
                    normalizedChildren.push(chapterNode);
                    continue;
                }

                flushPendingUser();
                normalizedChildren.push(createPromptMessageNode(child, 'Prompt message'));
            }

            flushPendingUser();
            node.children = normalizedChildren;
        }

        node.children.forEach(walk);
    };

    walk(root);
}

function escapeTraceLabel(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getTraceTextPreview(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    const maxLength = 140;
    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength - 3)}...`
        : normalized;
}

/**
 * Calculates the total tokens for a subtree.
 */
function calculateSubtreeTokens(node) {
    if (node.type === 'text') return node.tokens;
    let total = node.type === 'chapter' ? (node.titleTokens || estimateTokens(node.label)) : 0;
    if (node.children) {
        node.children.forEach(c => total += calculateSubtreeTokens(c));
    }
    node.tokens = total;
    return total;
}

/**
 * Renders the prompt analysis tree into the container.
 */
function renderPromptAnalysis(container, req, res, agentName = 'Writer') {
    const text = extractTextFromPayload(req.payload.content);
    const tree = parsePromptIntoTree(text);
    const metrics = getPairMetrics(req, res);
    
    calculateSubtreeTokens(tree);

    const totalEstimated = tree.tokens || 1;
    const totalTokens = metrics.inputTokens || totalEstimated;
    const scalingFactor = totalTokens / totalEstimated;

    // Proportional scaling to match reality
    const scaleNode = (node) => {
        node.tokens = Math.round(node.tokens * scalingFactor);
        if (node.children) node.children.forEach(scaleNode);
    };
    scaleNode(tree);

    const totalInputCost = metrics.inputCost + metrics.cacheReadCost + metrics.cacheWriteCost;

    function createNodeElement(node, depth = 0) {
        if (node.type === 'text' && node.text.trim().length < 5) return null;
        
        if (node.type === 'root') {
            // Flatten root: render children at depth 0
            const rootFragment = document.createDocumentFragment();
            node.children.forEach(child => {
                const childEl = createNodeElement(child, 0);
                if (childEl) rootFragment.appendChild(childEl);
            });
            return rootFragment;
        }

        const nodeTokens = node.tokens || 0;
        const percentNum = (nodeTokens / totalTokens) * 100;
        const percent = percentNum.toFixed(1);
        const nodeCost = (nodeTokens / totalTokens) * totalInputCost;
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;

        // Excel-like color coding (0% green -> 30%+ red)
        const getHeatmapColor = (p) => {
            const hue = Math.max(0, 120 - (p * 4)); // 0% = 120 (green), 30% = 0 (red)
            return `hsl(${hue}, 80%, 60%)`;
        };

        const nodeEl = document.createElement('div');
        nodeEl.className = `trace-node trace-node-${node.type}`;
        if (hasChildren) {
            nodeEl.classList.add('has-children', 'collapsed');
        }
        nodeEl.style.marginLeft = `${depth * 12}px`;

        let labelHtml = '';
        if (node.type === 'text') {
            const escapedPreview = escapeTraceLabel(getTraceTextPreview(node.text));
            labelHtml = `<span class="trace-label-text"><b>(text)</b> ${escapedPreview}</span>`;
        } else if (node.type === 'header') {
            const escapedHeader = escapeTraceLabel(node.label);
            labelHtml = `<span class="trace-label-header"><b>${'#'.repeat(node.level)} ${escapedHeader}</b></span>`;
        } else if (node.type === 'tag') {
            const escapedTag = escapeTraceLabel(node.fullTag);
            labelHtml = `<span class="trace-label-tag"><b>${escapedTag}</b></span>`;
        } else if (node.type === 'chapter') {
            const escapedChapter = escapeTraceLabel(node.label);
            labelHtml = `<span class="trace-label-chapter"><b>${escapedChapter}</b></span>`;
        } else if (node.type === 'message') {
            const escapedMessage = escapeTraceLabel(node.label);
            labelHtml = `<span class="trace-label-message"><b>${escapedMessage}</b></span>`;
        }

        nodeEl.innerHTML = `
            <div class="trace-row">
                ${hasChildren ? '<button type="button" class="trace-node-toggle" aria-label="Expand node">+</button>' : '<span class="trace-node-spacer"></span>'}
                <span class="trace-label">${labelHtml}</span>
                <span class="trace-metrics">${nodeTokens} tokens | $${nodeCost.toFixed(5)} <span style="color: ${getHeatmapColor(percentNum)}; font-weight: bold;">(${percent}%)</span></span>
            </div>
        `;

        if (hasChildren) {
            const toggle = nodeEl.querySelector('.trace-node-toggle');
            const syncToggle = () => {
                const collapsed = nodeEl.classList.contains('collapsed');
                toggle.textContent = collapsed ? '+' : '-';
                toggle.setAttribute('aria-label', collapsed ? 'Expand node' : 'Collapse node');
            };

            nodeEl.querySelector('.trace-row').addEventListener('click', (event) => {
                event.stopPropagation();
                nodeEl.classList.toggle('collapsed');
                syncToggle();
            });

            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'trace-children';
            node.children.forEach(child => {
                const childEl = createNodeElement(child, depth + 1);
                if (childEl) childrenContainer.appendChild(childEl);
            });
            if (childrenContainer.childNodes.length > 0) {
                nodeEl.appendChild(childrenContainer);
            }
        }

        return nodeEl;
    }

    const panel = document.createElement('div');
    panel.className = 'prompt-analysis-panel';
    panel.innerHTML = `
        <div class="prompt-analysis-header">
            <h3>${agentName} Prompt Cost breakdown</h3>
            <span class="prompt-cache-summary">${metrics.cacheReadTokens || 0} cached (${(metrics.cacheHitRatio * 100).toFixed(1)}%)</span>
            <div class="prompt-analysis-actions">
                <button type="button" class="trace-tree-action" data-action="expand">Expand all</button>
                <button type="button" class="trace-tree-action" data-action="collapse">Collapse all</button>
                <span class="toggle-icon">v</span>
            </div>
        </div>
        <div class="prompt-analysis-content"></div>
    `;

    panel.querySelector('.prompt-analysis-header').onclick = (event) => {
        if (event.target.closest('.trace-tree-action')) return;
        panel.classList.toggle('collapsed');
    };

    const content = panel.querySelector('.prompt-analysis-content');
    const rootEl = createNodeElement(tree);
    if (rootEl) content.appendChild(rootEl);

    const syncAllTraceToggles = () => {
        content.querySelectorAll('.trace-node.has-children').forEach(nodeEl => {
            const toggle = nodeEl.querySelector(':scope > .trace-row .trace-node-toggle');
            if (!toggle) return;
            const collapsed = nodeEl.classList.contains('collapsed');
            toggle.textContent = collapsed ? '+' : '-';
            toggle.setAttribute('aria-label', collapsed ? 'Expand node' : 'Collapse node');
        });
    };

    panel.querySelectorAll('.trace-tree-action').forEach(button => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const collapse = button.dataset.action === 'collapse';
            content.querySelectorAll('.trace-node.has-children').forEach(nodeEl => {
                nodeEl.classList.toggle('collapsed', collapse);
            });
            syncAllTraceToggles();
        });
    });

    container.appendChild(panel);
}


/**
 * Gets a consistent color for a given model.
 * @param {string} model - The model name.
 * @returns {string} The color associated with the model.
 */
function getModelColor(model) {
    return getHashedColor(model, colorPalette);
}

/**
 * Gets a consistent color for a given topic title.
 * @param {string} topicTitle - The title of the topic.
 * @returns {string} The color associated with the topic.
 */
function getTopicColor(topicTitle) {
    const baseTopic = topicTitle.replace(/\s*\[.*?\]/g, '').replace(/ - (Request|Response|Error)$/, '').trim();
    return getHashedColor(baseTopic, colorPalette);
}

/**
 * Recursively extracts text content from various payload structures.
 * @param {any} data - The data payload.
 * @returns {string} The extracted text.
 */
function extractTextFromPayload(data) {
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) return data.map(extractTextFromPayload).filter(Boolean).join('\n\n');
    if (typeof data === 'object' && data !== null) {
        if (
            Object.prototype.hasOwnProperty.call(data, 'role') &&
            Object.prototype.hasOwnProperty.call(data, 'content')
        ) {
            const role = String(data.role || 'message').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'message';
            return `<prompt_message role="${role}">\n${extractTextFromPayload(data.content)}\n</prompt_message>`;
        }

        if (Object.prototype.hasOwnProperty.call(data, 'content')) {
            return extractTextFromPayload(data.content);
        }
        return Object.values(data).map(extractTextFromPayload).filter(Boolean).join('\n\n');
    }
    return '';
}

/**
 * HTML-escapes a string, converting special characters into their HTML entities.
 * @param {string} str - The string to escape.
 * @returns {string} The HTML-escaped string.
 */
function htmlEscape(str) {
    if (typeof str !== 'string') {
        return str;
    }
    // Create a temporary div element to leverage the browser's DOM parsing for escaping.
    // This is a safe way to escape HTML entities.
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

/**
 * Recursively HTML-escapes all string values within an object or array.
 * This is used to ensure that content passed to jsonTree does not get interpreted as HTML.
 * @param {any} obj - The object or array to traverse.
 * @returns {any} A new object/array with string values HTML-escaped.
 */
function recursivelyHtmlEscapeStrings(obj) {
    if (typeof obj === 'string') {
        return htmlEscape(obj);
    }
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(item => recursivelyHtmlEscapeStrings(item));
    }

    const newObj = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            newObj[key] = recursivelyHtmlEscapeStrings(obj[key]);
        }
    }
    return newObj;
}

function asMetricNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function firstMetricNumber(...values) {
    for (const value of values) {
        const number = asMetricNumber(value);
        if (number !== null) return number;
    }
    return null;
}

function getNestedMetricValue(source, path) {
    if (!source || typeof source !== 'object') return undefined;
    return path.reduce((current, key) => current?.[key], source);
}

function extractReasoningTokens(usage) {
    return firstMetricNumber(
        usage?.reasoning_tokens,
        usage?.reasoningTokens,
        usage?.native_tokens_reasoning,
        usage?.nativeTokensReasoning,
        usage?.completion_tokens_details?.reasoning_tokens,
        usage?.completionTokensDetails?.reasoningTokens,
        usage?.completionTokensDetails?.reasoning_tokens,
        usage?.output_token_details?.reasoning,
        usage?.outputTokenDetails?.reasoning,
        getNestedMetricValue(usage, ['output_token_details', 'reasoning_tokens']),
        getNestedMetricValue(usage, ['outputTokenDetails', 'reasoning_tokens'])
    ) || 0;
}

function extractVisibleOutputTokens(usage) {
    return firstMetricNumber(
        usage?.visible_completion_tokens,
        usage?.visibleCompletionTokens,
        usage?.visible_output_tokens,
        usage?.visibleOutputTokens,
        usage?.output_token_details?.visible,
        usage?.outputTokenDetails?.visible
    );
}

function finalizePairDerivedMetrics(metrics) {
    metrics.reasoningTokens = Math.max(0, Number(metrics.reasoningTokens || 0));
    metrics.inputTokens = Math.max(0, Number(metrics.inputTokens || 0));
    metrics.outputTokens = Math.max(0, Number(metrics.outputTokens || 0));
    metrics.cacheReadTokens = Math.min(metrics.inputTokens, Math.max(0, Number(metrics.cacheReadTokens || 0)));
    metrics.cacheWriteTokens = Math.min(
        Math.max(0, metrics.inputTokens - metrics.cacheReadTokens),
        Math.max(0, Number(metrics.cacheWriteTokens || 0))
    );
    metrics.uncachedInputTokens = Math.max(0, metrics.inputTokens - metrics.cacheReadTokens - metrics.cacheWriteTokens);
    metrics.cacheHitRatio = metrics.inputTokens > 0 ? metrics.cacheReadTokens / metrics.inputTokens : 0;

    const explicitGenerationTokens = asMetricNumber(metrics.generationTokens);
    metrics.generationTokens = Math.max(
        metrics.outputTokens,
        explicitGenerationTokens !== null ? explicitGenerationTokens : 0
    );

    const explicitVisibleOutputTokens = asMetricNumber(metrics.visibleOutputTokens);
    metrics.visibleOutputTokens = explicitVisibleOutputTokens !== null
        ? Math.max(0, explicitVisibleOutputTokens)
        : Math.max(0, metrics.generationTokens - metrics.reasoningTokens);

    metrics.totalTokens = metrics.inputTokens + metrics.generationTokens;
    metrics.tokensPerSecond = metrics.duration > 0 ? metrics.generationTokens / metrics.duration : 0;
    metrics.totalTokensPerSecond = metrics.duration > 0 ? metrics.totalTokens / metrics.duration : 0;
    const reasoningBreakdown = calculateReasoningBreakdown({
        reasoningTokens: metrics.reasoningTokens,
        generationTokens: metrics.generationTokens,
        outputCost: metrics.outputCost
    });
    metrics.reasoningShare = reasoningBreakdown.share;
    metrics.reasoningCost = reasoningBreakdown.cost;
    metrics.estimatedReasoningDuration = metrics.duration * metrics.reasoningShare;
    return metrics;
}

function applyPairPricing(metrics, usage, model, provider) {
    const pricing = modelPricing[provider]?.[model] || null;
    const reportedCost = firstMetricNumber(usage?.total_cost, usage?.cost) || 0;
    const breakdown = calculateCostBreakdown({
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        cacheReadTokens: metrics.cacheReadTokens,
        cacheWriteTokens: metrics.cacheWriteTokens,
        pricing,
        reportedCost
    });

    metrics.cost = breakdown.totalCost;
    metrics.reportedCost = breakdown.reportedCost;
    metrics.estimatedCost = breakdown.estimatedCost;
    metrics.inputCost = breakdown.inputCost;
    metrics.cacheReadCost = breakdown.cacheReadCost;
    metrics.cacheWriteCost = breakdown.cacheWriteCost;
    metrics.outputCost = breakdown.outputCost;
    metrics.cacheSavings = breakdown.cacheSavings;
    metrics.hasPricing = breakdown.hasPricing;
    metrics.hasCacheReadPricing = breakdown.hasCacheReadPricing;
    return metrics;
}

function formatOptionalNumber(value, digits = 1) {
    const number = asMetricNumber(value);
    if (number === null || number <= 0) return '-';
    return number.toFixed(digits);
}

function formatOptionalSeconds(value) {
    const number = asMetricNumber(value);
    if (number === null || number <= 0) return '-';
    return `${number.toFixed(2)}s`;
}

function formatReasoningTokenCount(value, estimated = false) {
    const number = asMetricNumber(value);
    if (number === null || number <= 0) return '-';
    return `${estimated ? '~' : ''}${Math.round(number).toLocaleString()}`;
}

function formatReasoningPercent(value, estimated = false) {
    const number = asMetricNumber(value);
    if (number === null || number <= 0) return '-';
    return `${estimated ? '~' : ''}${(number * 100).toFixed(1)}%`;
}

function formatReasoningCost(value, estimated = false) {
    const number = asMetricNumber(value);
    if (number === null || number <= 0) return '-';
    return `${estimated ? '~' : ''}$${number.toFixed(6)}`;
}

/**
 * Calculates metrics for a request/response pair.
 * @param {object} req - The request entry.
 * @param {object} res - The response entry.
 * @returns {object} { cost, duration, inputTokens, outputTokens, provider, model }
 */
function getPairMetrics(req, res) {
    const responsePayload = res?.payload || {};
    const requestPayload = req?.payload || {};
    const model = firstPresent(responsePayload.model, requestPayload.model);
    const provider = firstPresent(responsePayload.provider, requestPayload.provider);
    const usage = responsePayload.usage;
    const metrics = {
        cost: 0,
        duration: 0,
        inputTokens: 0,
        outputTokens: 0,
        provider: provider || 'unknown',
        model: model || 'unknown',
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        uncachedInputTokens: 0,
        cacheHitRatio: 0,
        isLocalCache: false,
        reportedCost: 0,
        estimatedCost: 0,
        inputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        outputCost: 0,
        cacheSavings: 0,
        hasPricing: false,
        hasCacheReadPricing: false,
        reasoningTokens: 0,
        reasoningTokensEstimated: false,
        reasoningCost: 0,
        visibleOutputTokens: 0,
        generationTokens: 0,
        tokensPerSecond: 0,
        totalTokensPerSecond: 0,
        reasoningShare: 0,
        estimatedReasoningDuration: 0
    };

    const hasStructuredUsage =
        usage &&
        typeof usage === 'object' &&
        (
            usage.promptTokens !== undefined ||
            usage.prompt_tokens !== undefined ||
            usage.inputTokens !== undefined ||
            usage.input_tokens !== undefined ||
            usage.completionTokens !== undefined ||
            usage.completion_tokens !== undefined ||
            usage.outputTokens !== undefined ||
            usage.output_tokens !== undefined ||
            usage.total_cost !== undefined ||
            usage.cost !== undefined ||
            usage.prompt_tokens_details !== undefined ||
            usage.input_token_details !== undefined ||
            usage.completion_tokens_details !== undefined ||
            usage.output_token_details !== undefined ||
            usage.reasoning_tokens !== undefined ||
            usage.reasoningTokens !== undefined ||
            usage.native_tokens_reasoning !== undefined ||
            usage.generation_tokens !== undefined ||
            usage.generationTokens !== undefined ||
            usage.visible_completion_tokens !== undefined ||
            usage.visibleCompletionTokens !== undefined ||
            usage.cachedTokens !== undefined ||
            usage.cachedInputTokens !== undefined ||
            usage.cached_input_tokens !== undefined ||
            usage.cacheReadTokens !== undefined ||
            usage.cache_read_tokens !== undefined ||
            usage.is_local_cache !== undefined ||
            usage.isLocalCache !== undefined
        );

    if (hasStructuredUsage) {
        // Support both raw API snake_case and Langchain camelCase
        metrics.inputTokens = firstMetricNumber(
            usage.promptTokens,
            usage.prompt_tokens,
            usage.inputTokens,
            usage.input_tokens
        ) || 0;
        metrics.outputTokens = firstMetricNumber(
            usage.completionTokens,
            usage.completion_tokens,
            usage.outputTokens,
            usage.output_tokens
        ) || 0;
        const cacheTokens = extractCacheTokens(usage);
        metrics.cacheReadTokens = cacheTokens.cacheReadTokens;
        metrics.cacheWriteTokens = cacheTokens.cacheWriteTokens;
        metrics.isLocalCache = usage.is_local_cache || usage.isLocalCache || false;
        const reportedReasoningTokens = extractReasoningTokens(usage);
        metrics.visibleOutputTokens = extractVisibleOutputTokens(usage);
        metrics.generationTokens = firstMetricNumber(
            usage.generationTokens,
            usage.generation_tokens,
            usage.completionTokens,
            usage.completion_tokens,
            usage.outputTokens,
            usage.output_tokens
        ) || metrics.outputTokens;
        const reasoningMetric = deriveReasoningTokenMetric({
            reportedReasoningTokens,
            generationTokens: metrics.generationTokens,
            reasoningText: extractTextFromPayload(res.payload.reasoning),
            visibleText: extractTextFromPayload(res.payload.content)
        });
        metrics.reasoningTokens = reasoningMetric.tokens;
        metrics.reasoningTokensEstimated = reasoningMetric.estimated;
        if (reasoningMetric.estimated) {
            metrics.visibleOutputTokens = Math.max(0, metrics.generationTokens - metrics.reasoningTokens);
        }

        const reqTime = new Date(req.timestamp);
        const resTime = new Date(res.timestamp);
        if (!isNaN(reqTime.getTime()) && !isNaN(resTime.getTime())) {
            metrics.duration = (resTime.getTime() - reqTime.getTime()) / 1000;
        }

        applyPairPricing(metrics, usage, model, provider);
        return finalizePairDerivedMetrics(metrics);
    }

    if (!model || !provider || !modelPricing[provider] || !modelPricing[provider][model]) {
        return finalizePairDerivedMetrics(metrics);
    }

    metrics.inputTokens = estimateTokens(extractTextFromPayload(req.payload.content));
    metrics.outputTokens = estimateTokens(extractTextFromPayload(res.payload.content));
    applyPairPricing(metrics, usage, model, provider);

    const reqTime = new Date(req.timestamp);
    const resTime = new Date(res.timestamp);
    if (!isNaN(reqTime.getTime()) && !isNaN(resTime.getTime())) {
        metrics.duration = (resTime.getTime() - reqTime.getTime()) / 1000;
    }

    return finalizePairDerivedMetrics(metrics);
}

/**
 * Calculates cost and performance metrics.
 * @param {object} data The log data.
 * @returns {{modelBreakdown: object, topicBreakdown: object, totalCost: number}}
 */
function calculateLogCost(data) {
    const modelBreakdown = {};
    const topicBreakdown = {};
    let totalCost = 0;
    const costTotals = {
        totalCost: 0,
        reportedCost: 0,
        inputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        outputCost: 0,
        cacheSavings: 0,
        inputTokens: 0,
        uncachedInputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0
    };

    const filteredData = {};
    for (const [title, entries] of Object.entries(data)) {
        filteredData[title] = entries.filter(entry => !entry.other);
    }

    const pairedTopics = new Map();
    for (const [fullTitle, entries] of Object.entries(filteredData)) {
        let baseTopic = fullTitle.replace(/\s*\[.*?\]/g, '').replace(/ - (Request|Response|Error)$/, '').trim();
        let type = fullTitle.endsWith(' - Request')
            ? 'requests'
            : (fullTitle.endsWith(' - Response') ? 'responses' : (fullTitle.endsWith(' - Error') ? 'errors' : null));

        if (!type) {
            if (!pairedTopics.has(baseTopic)) pairedTopics.set(baseTopic, { requests: [], responses: [], errors: [] });
            for (let i = 0; i < entries.length; i++) {
                if (i % 2 === 0) pairedTopics.get(baseTopic).requests.push(entries[i]);
                else pairedTopics.get(baseTopic).responses.push(entries[i]);
            }
            continue;
        }
        if (!pairedTopics.has(baseTopic)) pairedTopics.set(baseTopic, { requests: [], responses: [], errors: [] });
        pairedTopics.get(baseTopic)[type].push(...entries);
    }

    for (const [baseTopic, { requests, responses, errors }] of pairedTopics.entries()) {
        const terminals = [
            ...responses.map(entry => ({ entry, status: 'success' })),
            ...errors.map(entry => ({ entry, status: 'error' }))
        ].sort((a, b) => {
            const timeA = new Date(a.entry.timestamp).getTime();
            const timeB = new Date(b.entry.timestamp).getTime();
            return (Number.isFinite(timeA) ? timeA : 0) - (Number.isFinite(timeB) ? timeB : 0);
        });
        const usedTerminals = new Set();

        for (const request of requests) {
            const requestTime = new Date(request.timestamp).getTime();
            if (!Number.isFinite(requestTime)) continue;

            const terminalIndex = terminals.findIndex((item, index) => {
                if (usedTerminals.has(index)) return false;
                const terminalTime = new Date(item.entry.timestamp).getTime();
                return Number.isFinite(terminalTime) && terminalTime >= requestTime;
            });
            if (terminalIndex < 0) continue;

            usedTerminals.add(terminalIndex);
            const terminal = terminals[terminalIndex];
            const metrics = terminal.status === 'success'
                ? getPairMetrics(request, terminal.entry)
                : getPairMetrics(request, terminal.entry);
            const { provider, model } = metrics;
            const failedDuration = terminal.status === 'error'
                ? Math.max(0, (new Date(terminal.entry.timestamp).getTime() - requestTime) / 1000)
                : 0;

            totalCost += metrics.cost;
            costTotals.totalCost += metrics.cost;
            costTotals.reportedCost += metrics.reportedCost;
            costTotals.inputCost += metrics.inputCost;
            costTotals.cacheReadCost += metrics.cacheReadCost;
            costTotals.cacheWriteCost += metrics.cacheWriteCost;
            costTotals.outputCost += metrics.outputCost;
            costTotals.cacheSavings += metrics.cacheSavings;
            costTotals.inputTokens += metrics.inputTokens;
            costTotals.uncachedInputTokens += metrics.uncachedInputTokens;
            costTotals.cacheReadTokens += metrics.cacheReadTokens;
            costTotals.cacheWriteTokens += metrics.cacheWriteTokens;
            costTotals.outputTokens += metrics.outputTokens;

            if (!modelBreakdown[provider]) modelBreakdown[provider] = {};
            if (!modelBreakdown[provider][model]) {
                modelBreakdown[provider][model] = { totalCost: 0, reportedCost: 0, inputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, outputCost: 0, cacheSavings: 0, inputTokens: 0, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, reasoningTokensEstimated: false, reasoningCost: 0, generationTokens: 0, duration: 0, estimatedReasoningDuration: 0, failureCount: 0, failedTime: 0, topics: {} };
            }
            modelBreakdown[provider][model].totalCost += metrics.cost;
            modelBreakdown[provider][model].reportedCost += metrics.reportedCost;
            modelBreakdown[provider][model].inputCost += metrics.inputCost;
            modelBreakdown[provider][model].cacheReadCost += metrics.cacheReadCost;
            modelBreakdown[provider][model].cacheWriteCost += metrics.cacheWriteCost;
            modelBreakdown[provider][model].outputCost += metrics.outputCost;
            modelBreakdown[provider][model].cacheSavings += metrics.cacheSavings;
            modelBreakdown[provider][model].inputTokens += metrics.inputTokens;
            modelBreakdown[provider][model].uncachedInputTokens += metrics.uncachedInputTokens;
            modelBreakdown[provider][model].cacheReadTokens += metrics.cacheReadTokens;
            modelBreakdown[provider][model].cacheWriteTokens += metrics.cacheWriteTokens;
            modelBreakdown[provider][model].outputTokens += metrics.outputTokens;
            modelBreakdown[provider][model].reasoningTokens += metrics.reasoningTokens;
            modelBreakdown[provider][model].reasoningTokensEstimated ||= metrics.reasoningTokensEstimated;
            modelBreakdown[provider][model].reasoningCost += metrics.reasoningCost;
            modelBreakdown[provider][model].generationTokens += metrics.generationTokens;
            modelBreakdown[provider][model].duration += metrics.duration;
            modelBreakdown[provider][model].estimatedReasoningDuration += metrics.estimatedReasoningDuration;
            if (terminal.status === 'error') {
                modelBreakdown[provider][model].failureCount += 1;
                modelBreakdown[provider][model].failedTime += failedDuration;
            }
            if (!modelBreakdown[provider][model].topics[baseTopic]) {
                modelBreakdown[provider][model].topics[baseTopic] = 0;
            }
            modelBreakdown[provider][model].topics[baseTopic] += metrics.cost;

            if (!topicBreakdown[baseTopic]) {
                topicBreakdown[baseTopic] = { totalCost: 0, reportedCost: 0, inputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, outputCost: 0, cacheSavings: 0, totalTokens: 0, inputTokens: 0, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, reasoningTokensEstimated: false, reasoningCost: 0, visibleOutputTokens: 0, generationTokens: 0, duration: 0, estimatedReasoningDuration: 0, failureCount: 0, failedTime: 0, model, provider };
            }
            topicBreakdown[baseTopic].totalCost += metrics.cost;
            topicBreakdown[baseTopic].reportedCost += metrics.reportedCost;
            topicBreakdown[baseTopic].inputCost += metrics.inputCost;
            topicBreakdown[baseTopic].cacheReadCost += metrics.cacheReadCost;
            topicBreakdown[baseTopic].cacheWriteCost += metrics.cacheWriteCost;
            topicBreakdown[baseTopic].outputCost += metrics.outputCost;
            topicBreakdown[baseTopic].cacheSavings += metrics.cacheSavings;
            topicBreakdown[baseTopic].inputTokens += metrics.inputTokens;
            topicBreakdown[baseTopic].uncachedInputTokens += metrics.uncachedInputTokens;
            topicBreakdown[baseTopic].cacheReadTokens += metrics.cacheReadTokens;
            topicBreakdown[baseTopic].cacheWriteTokens += metrics.cacheWriteTokens;
            topicBreakdown[baseTopic].outputTokens += metrics.outputTokens;
            topicBreakdown[baseTopic].reasoningTokens += metrics.reasoningTokens;
            topicBreakdown[baseTopic].reasoningTokensEstimated ||= metrics.reasoningTokensEstimated;
            topicBreakdown[baseTopic].reasoningCost += metrics.reasoningCost;
            topicBreakdown[baseTopic].visibleOutputTokens += metrics.visibleOutputTokens;
            topicBreakdown[baseTopic].generationTokens += metrics.generationTokens;
            topicBreakdown[baseTopic].totalTokens += metrics.totalTokens;
            topicBreakdown[baseTopic].duration += metrics.duration;
            topicBreakdown[baseTopic].estimatedReasoningDuration += metrics.estimatedReasoningDuration;
            if (terminal.status === 'error') {
                topicBreakdown[baseTopic].failureCount += 1;
                topicBreakdown[baseTopic].failedTime += failedDuration;
            }
        }
    }

    costTotals.cacheHitRatio = costTotals.inputTokens > 0
        ? costTotals.cacheReadTokens / costTotals.inputTokens
        : 0;
    return { modelBreakdown, topicBreakdown, totalCost, costTotals };
}



/**
 * Renders a visual cost bar based on model breakdown.
 * @param {object} modelBreakdown - Breakdown of costs by model.
 * @param {number} totalCost - The total estimated cost.
 * @returns {HTMLElement} The cost bar element.
 */
function renderCostBar(modelBreakdown, totalCost) {
    const bar = document.createElement('div');
    bar.className = 'cost-bar';
    for (const [provider, models] of Object.entries(modelBreakdown)) {
        for (const [model, modelInfo] of Object.entries(models)) {
            const modelGroup = document.createElement('div');
            modelGroup.className = 'model-group';
            const modelPercentage = totalCost ? (modelInfo.totalCost / totalCost) * 100 : 0;
            modelGroup.style.width = `${modelPercentage}%`;
            modelGroup.style.backgroundColor = getModelColor(model);
            modelGroup.title = `Provider: ${provider}\nModel: ${model}\nTotal Cost: ${modelInfo.totalCost.toFixed(6)}`;
            for (const [topic, topicCost] of Object.entries(modelInfo.topics)) {
                const topicSegment = document.createElement('div');
                topicSegment.className = 'topic-segment';
                const topicPercentage = modelInfo.totalCost ? (topicCost / modelInfo.totalCost) * 100 : 0;
                topicSegment.style.width = `${topicPercentage}%`;
                topicSegment.style.backgroundColor = getTopicColor(topic);
                topicSegment.title = `Topic: ${topic}\nProvider: ${provider}\nModel: ${model}\nCost: ${topicCost.toFixed(6)}`;
                modelGroup.appendChild(topicSegment);
            }
            bar.appendChild(modelGroup);
        }
    }
    return bar;
}

/**
 * Renders the cost summary, including total cost, model breakdown, and topic breakdown.
 * @param {HTMLElement} container - The container element to render the summary into.
 * @param {object} modelBreakdown - Breakdown of costs by model.
 * @param {object} topicBreakdown - Breakdown of costs by topic.
 * @param {number} totalCost - The total estimated cost.
 * @param {object} costTotals - Aggregated token and component-cost totals.
 */
function renderCostSummary(container, modelBreakdown, topicBreakdown, totalCost, costTotals) {
    const oldSummary = container.querySelector('.log-cost-summary');
    if (oldSummary) oldSummary.remove();

    const summary = document.createElement('div');
    summary.className = 'log-cost-summary';

    const cachePercent = Number(costTotals?.cacheHitRatio || 0) * 100;
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'cost-summary-grid';
    summaryGrid.innerHTML = `
        <div class="cost-summary-card cost-summary-card-total">
            <span class="cost-summary-label">Estimated total</span>
            <strong>$${totalCost.toFixed(6)}</strong>
            <small>${Number(costTotals?.inputTokens || 0).toLocaleString()} input + ${Number(costTotals?.outputTokens || 0).toLocaleString()} output tokens</small>
        </div>
        <div class="cost-summary-card">
            <span class="cost-summary-label">Standard input</span>
            <strong>$${Number(costTotals?.inputCost || 0).toFixed(6)}</strong>
            <small>${Number(costTotals?.uncachedInputTokens || 0).toLocaleString()} uncached tokens</small>
        </div>
        <div class="cost-summary-card cost-summary-card-cache">
            <span class="cost-summary-label">Cache reads</span>
            <strong>$${Number(costTotals?.cacheReadCost || 0).toFixed(6)}</strong>
            <small>${Number(costTotals?.cacheReadTokens || 0).toLocaleString()} tokens (${cachePercent.toFixed(1)}%)</small>
        </div>
        ${Number(costTotals?.cacheWriteTokens || 0) > 0 ? `
        <div class="cost-summary-card cost-summary-card-cache-write">
            <span class="cost-summary-label">Cache writes</span>
            <strong>$${Number(costTotals?.cacheWriteCost || 0).toFixed(6)}</strong>
            <small>${Number(costTotals?.cacheWriteTokens || 0).toLocaleString()} tokens</small>
        </div>` : ''}
        <div class="cost-summary-card">
            <span class="cost-summary-label">Output</span>
            <strong>$${Number(costTotals?.outputCost || 0).toFixed(6)}</strong>
            <small>${Number(costTotals?.outputTokens || 0).toLocaleString()} generated tokens</small>
        </div>
        <div class="cost-summary-card cost-summary-card-savings">
            <span class="cost-summary-label">Saved by cache</span>
            <strong>$${Number(costTotals?.cacheSavings || 0).toFixed(6)}</strong>
            <small>versus standard input pricing</small>
        </div>
    `;
    summary.appendChild(summaryGrid);
    summary.appendChild(renderCostBar(modelBreakdown, totalCost));

    // Model Breakdown Table
    const modelTable = document.createElement('table');
    modelTable.innerHTML = `
        <thead><tr>
            <th colspan="2">Model Breakdown</th>
            <th class="numeric-cell">Input</th>
            <th class="numeric-cell">Cache Read</th>
            <th class="numeric-cell">Cache %</th>
            <th class="numeric-cell">Output</th>
            <th class="numeric-cell">Input $</th>
            <th class="numeric-cell">Cache $</th>
            <th class="numeric-cell">Output $</th>
            <th class="numeric-cell">Saved</th>
            <th class="numeric-cell" title="Reasoning tokens reported by the provider, or estimated from captured reasoning text when provider metadata incorrectly reports zero.">Reasoning</th>
            <th class="numeric-cell" title="Reasoning tokens divided by all generated tokens. A ~ indicates estimated reasoning tokens.">Reasoning %</th>
            <th class="numeric-cell" title="Portion of output cost attributable to reasoning. This is included in Output $ and is not an additional charge.">Reasoning $</th>
            <th class="numeric-cell" title="Generated tokens per second, including hidden reasoning tokens when reported.">Gen tok/s</th>
            <th class="numeric-cell">Total Cost</th>
            <th class="numeric-cell">% of Total</th>
        </tr></thead>
    `;
    const modelTbody = document.createElement('tbody');
    for (const [provider, models] of Object.entries(modelBreakdown)) {
        for (const [model, info] of Object.entries(models)) {
            const percentOfTotal = totalCost ? ((info.totalCost / totalCost) * 100) : 0;
            const generationTokens = Number(info.generationTokens || info.outputTokens || 0);
            const reasoningShare = generationTokens > 0 ? Number(info.reasoningTokens || 0) / generationTokens : 0;
            const genTokensPerSecond = info.duration > 0 ? generationTokens / info.duration : 0;
            const cacheHitRatio = info.inputTokens > 0 ? info.cacheReadTokens / info.inputTokens : 0;
            modelTbody.innerHTML += `
                <tr>
                    <td style="width: 25px;"><span class="topic-color-accent" style="background-color: ${getModelColor(model)};"></span></td>
                    <td style="color:${getModelColor(model)}; font-weight: bold;">${provider} / ${model}</td>
                    <td class="numeric-cell">${info.inputTokens}</td>
                    <td class="numeric-cell cache-token-cell">${info.cacheReadTokens || '-'}</td>
                    <td class="numeric-cell cache-token-cell">${(cacheHitRatio * 100).toFixed(1)}%</td>
                    <td class="numeric-cell">${info.outputTokens}</td>
                    <td class="numeric-cell">${info.inputCost.toFixed(6)}</td>
                    <td class="numeric-cell cache-cost-cell">${(info.cacheReadCost + info.cacheWriteCost).toFixed(6)}</td>
                    <td class="numeric-cell">${info.outputCost.toFixed(6)}</td>
                    <td class="numeric-cell savings-cell">${info.cacheSavings.toFixed(6)}</td>
                    <td class="numeric-cell">${formatReasoningTokenCount(info.reasoningTokens, info.reasoningTokensEstimated)}</td>
                    <td class="numeric-cell">${formatReasoningPercent(reasoningShare, info.reasoningTokensEstimated)}</td>
                    <td class="numeric-cell">${formatReasoningCost(info.reasoningCost, info.reasoningTokensEstimated)}</td>
                    <td class="numeric-cell">${formatOptionalNumber(genTokensPerSecond, 1)}</td>
                    <td class="numeric-cell">${info.totalCost.toFixed(6)}</td>
                    <td class="numeric-cell">${percentOfTotal.toFixed(2)}%</td>
                </tr>
            `;
        }
    }
    modelTable.appendChild(modelTbody);
    modelTable.className = 'model-breakdown-table';
    const modelTableScroller = document.createElement('div');
    modelTableScroller.className = 'model-breakdown-scroll';
    modelTableScroller.appendChild(modelTable);
    summary.appendChild(modelTableScroller);

    // Topic Breakdown Table (MERGED VIEW, SORTABLE)
    const topicRows = Object.entries(topicBreakdown).map(([topic, info]) => {
        const duration = Number(info.duration || 0);
        const generationTokens = Number(info.generationTokens || info.outputTokens || 0);
        const reasoningTokens = Number(info.reasoningTokens || 0);
        const failureCount = Number(info.failureCount || 0);
        const failedTime = Number(info.failedTime || 0);
        return {
            topic,
            provider: info.provider || 'unknown',
            model: info.model || 'unknown',
            inputTokens: Number(info.inputTokens || 0),
            uncachedInputTokens: Number(info.uncachedInputTokens || 0),
            cacheReadTokens: Number(info.cacheReadTokens || 0),
            cacheWriteTokens: Number(info.cacheWriteTokens || 0),
            cacheHitRatio: Number(info.inputTokens || 0) > 0 ? Number(info.cacheReadTokens || 0) / Number(info.inputTokens || 0) : 0,
            outputTokens: Number(info.outputTokens || 0),
            inputCost: Number(info.inputCost || 0),
            cacheReadCost: Number(info.cacheReadCost || 0),
            cacheWriteCost: Number(info.cacheWriteCost || 0),
            outputCost: Number(info.outputCost || 0),
            cacheSavings: Number(info.cacheSavings || 0),
            reasoningTokens,
            reasoningTokensEstimated: info.reasoningTokensEstimated === true,
            reasoningCost: Number(info.reasoningCost || 0),
            visibleOutputTokens: Number(info.visibleOutputTokens || 0),
            generationTokens,
            totalTokens: Number(info.totalTokens || (Number(info.inputTokens || 0) + generationTokens)),
            totalCost: Number(info.totalCost || 0),
            percentOfTotal: totalCost ? ((Number(info.totalCost || 0) / totalCost) * 100) : 0,
            duration,
            tokensPerSecond: duration > 0 ? generationTokens / duration : 0,
            estimatedReasoningDuration: Number(info.estimatedReasoningDuration || 0),
            reasoningShare: generationTokens > 0 ? reasoningTokens / generationTokens : 0,
            failureCount,
            failedTime
        };
    });

    const sortDefaults = {
        topic: 'asc',
        provider: 'asc',
        model: 'asc',
        inputTokens: 'desc',
        cacheReadTokens: 'desc',
        cacheHitRatio: 'desc',
        outputTokens: 'desc',
        inputCost: 'desc',
        cacheReadCost: 'desc',
        outputCost: 'desc',
        cacheSavings: 'desc',
        reasoningTokens: 'desc',
        reasoningShare: 'desc',
        reasoningCost: 'desc',
        generationTokens: 'desc',
        totalTokens: 'desc',
        tokensPerSecond: 'desc',
        failureCount: 'desc',
        failedTime: 'desc',
        estimatedReasoningDuration: 'desc',
        totalCost: 'desc',
        percentOfTotal: 'desc',
        duration: 'desc'
    };
    const sortState = { key: 'topic', direction: 'asc' };

    const topicHeaders = [
        { key: null, label: '', numeric: false, width: '25px' },
        { key: 'topic', label: 'Topic Breakdown', numeric: false },
        { key: 'provider', label: 'Provider', numeric: false },
        { key: 'model', label: 'Model', numeric: false },
        { key: 'inputTokens', label: 'Input', numeric: true },
        { key: 'cacheReadTokens', label: 'Cache Read', numeric: true, title: 'Input tokens served from the provider prompt cache.' },
        { key: 'cacheHitRatio', label: 'Cache %', numeric: true, title: 'Cached input tokens divided by total input tokens.' },
        { key: 'outputTokens', label: 'Output', numeric: true },
        { key: 'inputCost', label: 'Input $', numeric: true },
        { key: 'cacheReadCost', label: 'Cache $', numeric: true },
        { key: 'outputCost', label: 'Output $', numeric: true },
        { key: 'cacheSavings', label: 'Saved', numeric: true, title: 'Estimated savings versus charging cached tokens at the standard input rate.' },
        { key: 'tokensPerSecond', label: 'Gen tok/s', numeric: true, title: 'Generated tokens per second, including hidden reasoning tokens when reported.' },
        { key: 'duration', label: 'Duration', numeric: true },
        { key: 'totalCost', label: 'Total Cost', numeric: true },
        { key: 'percentOfTotal', label: '% of Total', numeric: true },
        { key: 'reasoningTokens', label: 'Reasoning', numeric: true, title: 'Reasoning tokens reported by the provider; ~ indicates an estimate derived from captured reasoning text.' },
        { key: 'reasoningShare', label: 'Reasoning %', numeric: true, title: 'Reasoning tokens divided by all generated tokens. A ~ indicates estimated reasoning tokens.' },
        { key: 'reasoningCost', label: 'Reasoning $', numeric: true, title: 'Portion of output cost attributable to reasoning. Included in Output $; not an additional charge.' },
        { key: 'totalTokens', label: 'Total Tokens', numeric: true },
        { key: 'failureCount', label: 'Failure Count', numeric: true, title: 'Number of failed LLM attempts for this topic.' },
        { key: 'failedTime', label: 'Failed Time', numeric: true, title: 'Cumulative wall-clock time spent on failed LLM attempts.' },
        { key: 'estimatedReasoningDuration', label: 'Reason Est', numeric: true, title: 'Estimated as duration * reasoning tokens / generated tokens. This is an approximation, not provider timing.' }
    ];

    const sortTopicRows = () => {
        const sorted = [...topicRows];
        const { key, direction } = sortState;
        sorted.sort((a, b) => {
            let comparison = 0;
            if (key === 'topic' || key === 'provider' || key === 'model') {
                comparison = String(a[key]).localeCompare(String(b[key]));
            } else {
                comparison = (a[key] || 0) - (b[key] || 0);
            }

            if (comparison === 0 && key !== 'topic') {
                comparison = String(a.topic).localeCompare(String(b.topic));
            }
            return direction === 'asc' ? comparison : -comparison;
        });
        return sorted;
    };

    const topicTable = document.createElement('table');
    topicTable.className = 'topic-breakdown-table';
    const topicThead = document.createElement('thead');
    const topicHeaderRow = document.createElement('tr');
    topicHeaders.forEach((header, index) => {
        const th = document.createElement('th');
        if (header.width) th.style.width = header.width;
        if (header.title) th.title = header.title;
        if (header.numeric) th.classList.add('numeric-cell');
        if (index === 0) th.classList.add('sticky-accent-cell');
        if (header.key === 'topic') th.classList.add('sticky-topic-cell');
        if (header.key) {
            th.dataset.sortKey = header.key;
            th.classList.add('sortable-header');
        }
        th.textContent = header.label;
        topicHeaderRow.appendChild(th);
    });
    topicThead.appendChild(topicHeaderRow);
    topicTable.appendChild(topicThead);

    const topicTbody = document.createElement('tbody');

    const updateHeaderIndicators = () => {
        topicHeaderRow.querySelectorAll('th[data-sort-key]').forEach((th) => {
            const key = th.dataset.sortKey;
            const header = topicHeaders.find(h => h.key === key);
            const arrow = (sortState.key === key) ? (sortState.direction === 'asc' ? ' ▲' : ' ▼') : '';
            th.textContent = `${header.label}${arrow}`;
        });
    };

    const renderTopicRows = () => {
        topicTbody.innerHTML = '';
        const sortedRows = sortTopicRows();
        for (const row of sortedRows) {
            const failureClass = row.failureCount > 0 ? ' failure-metric' : '';
            const failureCount = row.failureCount > 0 ? row.failureCount : '-';
            const failedTime = row.failedTime > 0 ? formatOptionalSeconds(row.failedTime) : '-';
            topicTbody.innerHTML += `
                <tr>
                    <td class="sticky-accent-cell" style="width: 25px;"><span class="topic-color-accent" style="background-color: ${getTopicColor(row.topic)};"></span></td>
                    <td class="sticky-topic-cell">${row.topic}</td>
                    <td>${row.provider}</td>
                    <td style="color:${getModelColor(row.model)};">${row.model}</td>
                    <td class="numeric-cell">${row.inputTokens}</td>
                    <td class="numeric-cell cache-token-cell">${row.cacheReadTokens || '-'}</td>
                    <td class="numeric-cell cache-token-cell">${(row.cacheHitRatio * 100).toFixed(1)}%</td>
                    <td class="numeric-cell">${row.outputTokens}</td>
                    <td class="numeric-cell">${row.inputCost.toFixed(6)}</td>
                    <td class="numeric-cell cache-cost-cell">${(row.cacheReadCost + Number(row.cacheWriteCost || 0)).toFixed(6)}</td>
                    <td class="numeric-cell">${row.outputCost.toFixed(6)}</td>
                    <td class="numeric-cell savings-cell">${row.cacheSavings.toFixed(6)}</td>
                    <td class="numeric-cell">${formatOptionalNumber(row.tokensPerSecond, 1)}</td>
                    <td class="numeric-cell">${row.duration.toFixed(2)}s</td>
                    <td class="numeric-cell">${row.totalCost.toFixed(6)}</td>
                    <td class="numeric-cell">${row.percentOfTotal.toFixed(2)}%</td>
                    <td class="numeric-cell">${formatReasoningTokenCount(row.reasoningTokens, row.reasoningTokensEstimated)}</td>
                    <td class="numeric-cell">${formatReasoningPercent(row.reasoningShare, row.reasoningTokensEstimated)}</td>
                    <td class="numeric-cell">${formatReasoningCost(row.reasoningCost, row.reasoningTokensEstimated)}</td>
                    <td class="numeric-cell">${row.totalTokens}</td>
                    <td class="numeric-cell${failureClass}">${failureCount}</td>
                    <td class="numeric-cell${failureClass}">${failedTime}</td>
                    <td class="numeric-cell">${formatOptionalSeconds(row.estimatedReasoningDuration)}</td>
                </tr>
            `;
        }
        updateHeaderIndicators();
    };

    topicHeaderRow.addEventListener('click', (event) => {
        const headerCell = event.target.closest('th[data-sort-key]');
        if (!headerCell) return;

        const key = headerCell.dataset.sortKey;
        if (sortState.key === key) {
            sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.key = key;
            sortState.direction = sortDefaults[key] || 'asc';
        }
        renderTopicRows();
    });

    renderTopicRows();
    topicTable.appendChild(topicTbody);
    const topicTableScroller = document.createElement('div');
    topicTableScroller.className = 'topic-breakdown-scroll';
    topicTableScroller.appendChild(topicTable);
    summary.appendChild(topicTableScroller);

    container.prepend(summary);
}

/**
 * Recursively formats nested JSON strings within an object.
 * @param {any} obj - The object to format.
 * @returns {any} The formatted object.
 */
function formatNestedJson(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(formatNestedJson);
    }

    const newObj = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            let value = obj[key];
            if (typeof value === 'string') {
                try {
                    const parsed = JSON.parse(value);
                    if (typeof parsed === 'object' && parsed !== null) {
                        value = formatNestedJson(parsed);
                    }
                } catch {
                    // Not a JSON string, or invalid JSON, keep as is
                }
            }
            newObj[key] = value;
        }
    }
    return newObj;
}

// #region WATERFALL ENGINE

function getConsoleLineTime(line) {
    const match = String(line || '').match(/^\[(.*?)\]/);
    if (!match) return null;
    const timestamp = new Date(match[1]).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

function extractWaterfallMilestones(consoleLog) {
    const lines = String(consoleLog?.content || '').split(/\r?\n/);
    const milestones = [];
    const seen = new Set();

    const addMilestone = (key, name, line, color) => {
        if (seen.has(key)) return;
        const time = getConsoleLineTime(line);
        if (time === null) return;
        seen.add(key);
        milestones.push({ key, name, time, color });
    };

    lines.forEach(line => {
        if (line.includes('[TURN GEN START]')) addMilestone('start', 'Start', line, '#3fb950');
        if (line.includes('[TURN GEN ENDS] (Blocking)')) addMilestone('playable', 'VN Playable', line, '#1e90ff');
        if (line.includes('[TURN GEN ENDS] (Absolute)')) addMilestone('background', 'Background Done', line, '#f85149');
    });

    return milestones.sort((a, b) => a.time - b.time);
}

function formatWaterfallDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return 'unknown';
    if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
    const seconds = durationMs / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
}

function getWaterfallTimingSummary(milestones, bars) {
    const startTime = milestones.find(m => m.key === 'start')?.time;
    const playableTime = milestones.find(m => m.key === 'playable')?.time;
    const backgroundTime = milestones.find(m => m.key === 'background')?.time;

    if (!Number.isFinite(startTime)) {
        const fallbackStart = Math.min(...bars.map(bar => bar.start).filter(Number.isFinite));
        const fallbackEnd = Math.max(...bars.map(bar => bar.end).filter(Number.isFinite));
        if (!Number.isFinite(fallbackStart) || !Number.isFinite(fallbackEnd)) {
            return 'Turn ready: unknown';
        }
        return `LLM span: ${formatWaterfallDuration(fallbackEnd - fallbackStart)}`;
    }

    const parts = [];
    if (Number.isFinite(playableTime)) {
        parts.push(`Ready: ${formatWaterfallDuration(playableTime - startTime)}`);
    } else {
        parts.push('Ready: unknown');
    }

    if (Number.isFinite(backgroundTime)) {
        parts.push(`All done: ${formatWaterfallDuration(backgroundTime - startTime)}`);
    }

    return parts.join(' | ');
}

function firstPresent(...values) {
    return values.find(value => value !== null && value !== undefined && value !== '');
}

function getEntryTime(entry) {
    const timestamp = new Date(entry?.timestamp || '').getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

function hasLlmMetadata(req, terminal) {
    return !!firstPresent(
        req?.payload?.model,
        req?.payload?.provider,
        terminal?.payload?.model,
        terminal?.payload?.provider
    );
}

function getEntryDiagnostics(req, terminal) {
    const diagnostics = {
        ...(req?.payload?.diagnostics && typeof req.payload.diagnostics === 'object' ? req.payload.diagnostics : {}),
        ...(terminal?.payload?.diagnostics && typeof terminal.payload.diagnostics === 'object' ? terminal.payload.diagnostics : {})
    };
    return Object.keys(diagnostics).length > 0 ? diagnostics : null;
}

function getDiagnosticGroupLabel(diagnostics) {
    if (!diagnostics) return 'Ungrouped';
    const base = diagnostics.hookName || diagnostics.phase || diagnostics.executionLane || 'Ungrouped';
    const lane = diagnostics.blocking === true
        ? 'blocking'
        : diagnostics.blocking === false
            ? 'async'
            : '';
    return lane ? `${base} - ${lane}` : base;
}

function buildLlmWaterfallBars(turnLogData) {
    if (!turnLogData || typeof turnLogData !== 'object') return [];

    const bars = [];
    const entriesByTitle = Object.entries(turnLogData);

    entriesByTitle.forEach(([fullTitle, requestEntries]) => {
        if (!fullTitle.endsWith(' - Request')) return;

        const title = fullTitle.replace(/ - Request$/, '').trim();
        const responseEntries = turnLogData[`${title} - Response`];
        const errorEntries = turnLogData[`${title} - Error`];
        if (!Array.isArray(requestEntries)) return;

        const requests = requestEntries
            .filter(entry => entry && !entry.other)
            .sort((a, b) => (getEntryTime(a) || 0) - (getEntryTime(b) || 0));
        const responses = Array.isArray(responseEntries) ? responseEntries
            .filter(entry => entry && !entry.other)
            .map(entry => ({ entry, status: 'success' }))
            : [];
        const errors = Array.isArray(errorEntries) ? errorEntries
            .filter(entry => entry && !entry.other)
            .map(entry => ({ entry, status: 'error' }))
            : [];
        const terminals = [...responses, ...errors]
            .filter(item => getEntryTime(item.entry) !== null)
            .sort((a, b) => (getEntryTime(a.entry) || 0) - (getEntryTime(b.entry) || 0));
        const usedTerminals = new Set();

        requests.forEach((request, index) => {
            if (!request?.payload) return;

            const start = getEntryTime(request);
            if (start === null) return;

            const terminalIndex = terminals.findIndex((item, itemIndex) => {
                if (usedTerminals.has(itemIndex)) return false;
                const terminalTime = getEntryTime(item.entry);
                return terminalTime !== null && terminalTime >= start;
            });
            if (terminalIndex < 0) return;

            usedTerminals.add(terminalIndex);
            const terminal = terminals[terminalIndex];
            const response = terminal.entry;
            if (!response?.payload) return;
            if (!hasLlmMetadata(request, response)) return;

            const end = getEntryTime(response);
            if (end === null) return;

            const metrics = getPairMetrics(request, response);
            const model = firstPresent(response.payload?.model, request.payload?.model, metrics.model, 'unknown');
            const provider = firstPresent(response.payload?.provider, request.payload?.provider, metrics.provider, 'unknown');
            const duration = Math.max(0, end - start);
            const diagnostics = getEntryDiagnostics(request, response);

            bars.push({
                title,
                laneKey: title,
                groupLabel: getDiagnosticGroupLabel(diagnostics),
                diagnostics,
                start,
                end,
                duration,
                status: terminal.status,
                request,
                response: terminal.status === 'success' ? response : null,
                error: terminal.status === 'error' ? response : null,
                pairIndex: index,
                metrics: {
                    ...metrics,
                    model,
                    provider
                }
            });
        });
    });

    return bars.sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
}

function renderRawConsoleLogView({ consoleLog }) {
    const content = String(consoleLog?.content || '');
    const lines = content ? content.split(/\r?\n/) : [];
    const declaredLineCount = Number(consoleLog?.lineCount);
    const lineCount = Number.isFinite(declaredLineCount) ? declaredLineCount : lines.length;

    const body = document.createElement('section');
    body.className = 'raw-console-view';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'raw-console-search';
    search.placeholder = 'Filter console lines, e.g. plugin_test';
    search.autocomplete = 'off';

    const status = document.createElement('div');
    status.className = 'raw-console-status';

    const output = document.createElement('pre');
    output.className = 'raw-console-output';

    body.appendChild(search);
    body.appendChild(status);
    body.appendChild(output);

    let hasRenderedOutput = false;
    const renderOutput = () => {
        const query = search.value.trim().toLowerCase();

        if (!query) {
            output.textContent = content || 'Console log is empty.';
            status.textContent = content
                ? `Showing full console log (${lineCount.toLocaleString()} lines).`
                : 'Console log is empty.';
            hasRenderedOutput = true;
            return;
        }

        const matches = lines.filter(line => line.toLowerCase().includes(query));
        const visibleMatches = matches.slice(0, RAW_CONSOLE_MAX_RENDERED_LINES);
        output.textContent = visibleMatches.length > 0
            ? visibleMatches.join('\n')
            : 'No matching console lines.';

        const truncated = matches.length > visibleMatches.length
            ? ` Showing first ${visibleMatches.length.toLocaleString()}.`
            : '';
        status.textContent = `${matches.length.toLocaleString()} matching lines for "${search.value}".${truncated}`;
        hasRenderedOutput = true;
    };

    search.addEventListener('input', renderOutput);
    body.renderConsoleOutput = () => {
        if (!hasRenderedOutput) renderOutput();
    };

    return body;
}

function renderWaterfallIntoContainer(container, data) {
    container.innerHTML = '';
    container.className = 'log-topics-container waterfall-embedded';

    const bars = buildLlmWaterfallBars(data.turnLog?.data);
    const milestones = extractWaterfallMilestones(data.consoleLog);
    const consoleLog = data.consoleLog || null;
    const consoleSize = Number(consoleLog?.sizeBytes) || String(consoleLog?.content || '').length;

    const tabs = document.createElement('div');
    tabs.className = 'console-log-tabs';

    const waterfallTab = document.createElement('button');
    waterfallTab.type = 'button';
    waterfallTab.className = 'console-log-tab active';
    waterfallTab.textContent = 'Waterfall';

    const fullLogTab = document.createElement('button');
    fullLogTab.type = 'button';
    fullLogTab.className = 'console-log-tab';
    fullLogTab.textContent = consoleLog
        ? `Full Logs (${Number(consoleLog.lineCount || 0).toLocaleString()} lines - ${formatByteSize(consoleSize)})`
        : 'Full Logs';

    tabs.appendChild(waterfallTab);
    tabs.appendChild(fullLogTab);
    container.appendChild(tabs);

    const paneWrap = document.createElement('div');
    paneWrap.className = 'console-log-pane-wrap';

    const controls = document.createElement('div');
    controls.className = 'waterfall-controls';

    const statusLabel = document.createElement('span');
    statusLabel.className = 'waterfall-empty-label';
    statusLabel.textContent = data.turnLog?.filename
        ? `LLM timeline from ${data.turnLog.filename}`
        : 'No matching structured turn log found.';

    const timingLabel = document.createElement('span');
    timingLabel.className = 'waterfall-timing-summary';
    timingLabel.textContent = getWaterfallTimingSummary(milestones, bars);
    timingLabel.title = 'Elapsed time from turn start to VN playable, and to background completion when available.';

    const viz = document.createElement('div');
    viz.className = 'waterfall-viz';

    const details = document.createElement('div');
    details.className = 'waterfall-details';

    const waterfallStage = document.createElement('div');
    waterfallStage.className = 'waterfall-stage console-log-pane active';

    controls.appendChild(statusLabel);
    controls.appendChild(timingLabel);
    waterfallStage.appendChild(controls);
    waterfallStage.appendChild(viz);

    waterfallStage.appendChild(details);
    paneWrap.appendChild(waterfallStage);

    const rawConsoleView = consoleLog
        ? renderRawConsoleLogView({ consoleLog })
        : document.createElement('section');
    rawConsoleView.classList.add('console-log-pane');
    if (!consoleLog) rawConsoleView.textContent = 'No raw console log payload was returned for this file.';
    paneWrap.appendChild(rawConsoleView);
    container.appendChild(paneWrap);

    if (bars.length > 0) {
        renderWaterfallTurn(viz, details, { bars, milestones });
    } else {
        viz.innerHTML = '<p class="waterfall-empty-message">No LLM request/response pairs found for this console log.</p>';
        details.textContent = data.turnLog?.filename
            ? 'The matching turn log exists, but it has no model-backed request/response pairs to draw.'
            : 'This console log has no matching turn JSON file, but the full raw console log is available in the Full Logs tab.';
        details.classList.add('has-selection');
    }

    const setActiveTab = (mode) => {
        const showWaterfall = mode === 'waterfall';
        waterfallTab.classList.toggle('active', showWaterfall);
        fullLogTab.classList.toggle('active', !showWaterfall);
        waterfallStage.classList.toggle('active', showWaterfall);
        rawConsoleView.classList.toggle('active', !showWaterfall);
        if (!showWaterfall && typeof rawConsoleView.renderConsoleOutput === 'function') {
            rawConsoleView.renderConsoleOutput();
        }
    };

    waterfallTab.addEventListener('click', () => setActiveTab('waterfall'));
    fullLogTab.addEventListener('click', () => setActiveTab('full'));
}

function renderWaterfallTurn(vizContainer, detailsContainer, timeline) {
    const bars = Array.isArray(timeline?.bars) ? timeline.bars : [];
    const milestones = Array.isArray(timeline?.milestones) ? timeline.milestones : [];
    vizContainer.innerHTML = '';

    if (bars.length === 0) {
        vizContainer.innerHTML = '<p class="waterfall-empty-message">No LLM request/response pairs found.</p>';
        return;
    }

    const filteredBars = bars.slice().sort((a, b) => a.start - b.start);
    const milestoneTimes = milestones.map(m => m.time).filter(time => Number.isFinite(time));
    const barStart = Math.min(...filteredBars.map(b => b.start));
    const barEnd = Math.max(...filteredBars.map(b => b.end));
    const startTime = Math.min(milestones.find(m => m.key === 'start')?.time || barStart, barStart);
    const endTime = Math.max(milestones.find(m => m.key === 'background')?.time || barEnd, barEnd, ...milestoneTimes);
    const totalDuration = Math.max(1, endTime - startTime);

    const hasDiagnosticGroups = filteredBars.some(bar => bar.diagnostics);
    const rows = [];

    if (hasDiagnosticGroups) {
        const groups = new Map();
        filteredBars.forEach(bar => {
            const groupLabel = bar.groupLabel || 'Ungrouped';
            if (!groups.has(groupLabel)) {
                groups.set(groupLabel, { label: groupLabel, firstStart: bar.start, laneMap: new Map() });
            }
            const group = groups.get(groupLabel);
            group.firstStart = Math.min(group.firstStart, bar.start);

            const laneKey = bar.laneKey || bar.title;
            if (!group.laneMap.has(laneKey)) group.laneMap.set(laneKey, []);
            group.laneMap.get(laneKey).push(bar);
        });

        Array.from(groups.values())
            .sort((a, b) => a.firstStart - b.firstStart || a.label.localeCompare(b.label))
            .forEach(group => {
                rows.push({ type: 'group', label: group.label });
                Array.from(group.laneMap.entries()).forEach(([laneKey, laneBars]) => {
                    const row = { type: 'lane', key: laneKey, label: laneKey, bars: laneBars, index: rows.length };
                    rows.push(row);
                    laneBars.forEach(bar => { bar.row = row; });
                });
            });
    } else {
        const laneMap = new Map();
        filteredBars.forEach(bar => {
            const key = bar.laneKey || bar.title;
            if (!laneMap.has(key)) {
                const row = { type: 'lane', key, label: key, bars: [], index: rows.length };
                laneMap.set(key, row);
                rows.push(row);
            }
            const row = laneMap.get(key);
            row.bars.push(bar);
            bar.row = row;
        });
    }

    const laneHeight = 30;
    const svgWidth = Math.max(vizContainer.clientWidth - 40, 800);
    const svgHeight = (rows.length * laneHeight) + 60;
    const labelWidth = 280;
    const chartWidth = svgWidth - labelWidth - 40;

    // Create custom tooltip element if it doesn't exist
    let tooltip = document.getElementById('wf-custom-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'wf-custom-tooltip';
        tooltip.className = 'wf-tooltip';
        document.body.appendChild(tooltip);
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
    svg.setAttribute("class", "waterfall-svg");

    // Grid lines and time labels
    const numTicks = 10;
    for (let i = 0; i <= numTicks; i++) {
        const x = labelWidth + (i * (chartWidth / numTicks));
        const timeOffset = (i * (totalDuration / numTicks)) / 1000;

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x);
        line.setAttribute("y1", 0);
        line.setAttribute("x2", x);
        line.setAttribute("y2", svgHeight - 40);
        line.setAttribute("class", "waterfall-grid-line");
        svg.appendChild(line);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x);
        text.setAttribute("y", svgHeight - 25);
        text.setAttribute("fill", "#666");
        text.setAttribute("font-size", "10");
        text.setAttribute("text-anchor", "middle");
        text.textContent = timeOffset.toFixed(1) + "s";
        svg.appendChild(text);
    }

    rows.filter(row => row.type === 'group').forEach(row => {
        const groupIndex = rows.indexOf(row);
        const y = (groupIndex * laneHeight) + 20;
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", 12);
        text.setAttribute("y", y);
        text.setAttribute("class", "waterfall-group-label");
        text.textContent = row.label;
        svg.appendChild(text);

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", labelWidth);
        line.setAttribute("y1", y - 8);
        line.setAttribute("x2", svgWidth - 20);
        line.setAttribute("y2", y - 8);
        line.setAttribute("class", "waterfall-group-line");
        svg.appendChild(line);
    });

    // Render Bars
    filteredBars.forEach(bar => {
        const x = labelWidth + ((bar.start - startTime) / totalDuration) * chartWidth;
        const width = Math.max(((bar.end - bar.start) / totalDuration) * chartWidth, 2);
        const y = ((bar.row?.index || 0) * laneHeight) + 10;

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", width);
        rect.setAttribute("height", laneHeight - 10);
        rect.setAttribute("rx", 4);
        rect.setAttribute("fill", bar.status === 'error' ? '#f85149' : getTopicColor(bar.title));
        rect.setAttribute("class", `waterfall-bar${bar.status === 'error' ? ' waterfall-bar-error' : ''}`);

        // Tooltip Interaction
        rect.addEventListener('mouseenter', () => {
            const metrics = bar.metrics || {};
            const costLine = metrics.cost > 0 ? `<br>Cost: $${metrics.cost.toFixed(6)}` : '';
            const statusLine = bar.status === 'error' ? '<br>Status: failed' : '';
            const errorMessage = bar.error?.payload?.content?.message
                ? `<br>Error: ${htmlEscape(bar.error.payload.content.message)}`
                : '';
            tooltip.innerHTML = `<strong>${htmlEscape(bar.title)}</strong><br>` +
                `Duration: ${(bar.duration / 1000).toFixed(3)}s (${bar.duration}ms)<br>` +
                `Start: ${new Date(bar.start).toLocaleTimeString()}<br>` +
                `End: ${new Date(bar.end).toLocaleTimeString()}<br>` +
                `Model: ${htmlEscape(metrics.model || 'unknown')}<br>` +
                `Provider: ${htmlEscape(metrics.provider || 'unknown')}` +
                statusLine +
                errorMessage +
                costLine;
            tooltip.style.display = 'block';
        });

        rect.addEventListener('mousemove', (e) => {
            const padding = 15;
            let left = e.clientX + padding;
            let top = e.clientY + padding;

            // Prevent going off-screen (right)
            if (left + tooltip.offsetWidth > window.innerWidth) {
                left = e.clientX - tooltip.offsetWidth - padding;
            }
            // Prevent going off-screen (bottom)
            if (top + tooltip.offsetHeight > window.innerHeight) {
                top = e.clientY - tooltip.offsetHeight - padding;
            }

            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
        });

        rect.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });

        rect.addEventListener('click', () => {
            // Remove selection from others
            svg.querySelectorAll('.waterfall-bar').forEach(r => r.classList.remove('selected'));
            rect.classList.add('selected');
            showWaterfallDetails(detailsContainer, bar);
        });

        svg.appendChild(rect);

        // Lane Labels (Right Aligned, positioned immediately to the left of the FIRST bar in this lane)
        if (bar.row?.bars?.[0] === bar) {
            const firstBarX = labelWidth + ((bar.start - startTime) / totalDuration) * chartWidth;
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", firstBarX - 10);
            text.setAttribute("y", y + (laneHeight / 2) - 5);
            text.setAttribute("text-anchor", "end");
            text.setAttribute("class", "waterfall-lane-label");
            text.style.fontSize = "11px";
            text.style.fontWeight = "bold";
            text.style.fill = "#abb2bf";
            text.textContent = bar.title;
            svg.appendChild(text);
        }
    });

    // Render Milestones (Vertical Lines)
    milestones.forEach(m => {
        const x = labelWidth + ((m.time - startTime) / totalDuration) * chartWidth;
        if (x < labelWidth || x > labelWidth + chartWidth) return;

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x);
        line.setAttribute("y1", 0);
        line.setAttribute("x2", x);
        line.setAttribute("y2", svgHeight - 40);
        line.setAttribute("stroke", m.color || '#1e90ff');
        line.setAttribute("class", "waterfall-milestone");
        svg.appendChild(line);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x);
        text.setAttribute("y", 10);
        text.setAttribute("class", "waterfall-milestone-label");
        text.textContent = m.name;
        svg.appendChild(text);
    });

    vizContainer.appendChild(svg);
}

function showWaterfallDetails(container, bar) {
    const metrics = bar.metrics || {};
    const diagnostics = bar.diagnostics || {};
    const usage = bar.response?.payload?.usage || bar.error?.payload?.usage || bar.request?.payload?.usage || null;
    const errorContent = bar.error?.payload?.content || null;
    const usageLines = [
        `Input Tokens: ${metrics.inputTokens || 0}`,
        `Uncached Input: ${metrics.uncachedInputTokens || 0}`,
        `Cache Read: ${metrics.cacheReadTokens || 0} (${(Number(metrics.cacheHitRatio || 0) * 100).toFixed(1)}%)`,
        ...(metrics.cacheWriteTokens > 0 ? [`Cache Write: ${metrics.cacheWriteTokens}`] : []),
        `Output Tokens: ${metrics.outputTokens || 0}`,
        `Reasoning Tokens: ${metrics.reasoningTokens || 0}`,
        `Total Tokens: ${metrics.totalTokens || 0}`,
        `Cost: $${Number(metrics.cost || 0).toFixed(6)}`,
        `Cost Breakdown: input $${Number(metrics.inputCost || 0).toFixed(6)} + cache $${Number((metrics.cacheReadCost || 0) + (metrics.cacheWriteCost || 0)).toFixed(6)} + output $${Number(metrics.outputCost || 0).toFixed(6)}`,
        `Cache Savings: $${Number(metrics.cacheSavings || 0).toFixed(6)}`,
        `Tokens/sec: ${formatOptionalNumber(metrics.tokensPerSecond, 2)}`
    ];

    if (usage?.is_local_cache || usage?.isLocalCache) {
        usageLines.push('Source: local cache');
    }

    const diagnosticLines = [
        diagnostics.hookName ? `Hook: ${diagnostics.hookName}` : null,
        diagnostics.phase ? `Phase: ${diagnostics.phase}` : null,
        diagnostics.pluginId ? `Plugin: ${diagnostics.pluginId}` : null,
        diagnostics.taskKey ? `Task: ${diagnostics.taskKey}` : null,
        diagnostics.executionLane ? `Lane: ${diagnostics.executionLane}` : null,
        diagnostics.listenerMode ? `Listener Mode: ${diagnostics.listenerMode}` : null,
        diagnostics.hookPriority !== undefined ? `Hook Priority: ${diagnostics.hookPriority}` : null,
        diagnostics.blocking !== undefined ? `Blocking: ${diagnostics.blocking ? 'yes' : 'no'}` : null,
        Array.isArray(diagnostics.after) && diagnostics.after.length > 0 ? `After: ${diagnostics.after.join(', ')}` : null
    ].filter(Boolean);

    container.classList.add('has-selection');
    container.innerHTML = `
        <div class="wf-detail-header">${htmlEscape(bar.title)}</div>
        <div class="wf-detail-meta">
            Status: ${bar.status === 'error' ? 'failed' : 'completed'}<br>
            Total Time: ${(bar.duration / 1000).toFixed(3)}s (${bar.duration}ms)<br>
            Start: ${new Date(bar.start).toLocaleTimeString()} (${bar.request?.timestamp || bar.start})<br>
            End: ${new Date(bar.end).toLocaleTimeString()} (${bar.response?.timestamp || bar.error?.timestamp || bar.end})<br>
            Model: ${htmlEscape(metrics.model || 'unknown')}<br>
            Provider: ${htmlEscape(metrics.provider || 'unknown')}
        </div>
        ${errorContent ? `
            <div class="wf-log-lines wf-error-lines">
                ${[
                    errorContent.message ? `Error: ${errorContent.message}` : null,
                    errorContent.status ? `Status Code: ${errorContent.status}` : null,
                    errorContent.code ? `Code: ${errorContent.code}` : null,
                    errorContent.type ? `Type: ${errorContent.type}` : null,
                    errorContent.attemptNumber ? `Attempt: ${errorContent.attemptNumber}` : null,
                    errorContent.retriesLeft !== null && errorContent.retriesLeft !== undefined ? `Retries Left: ${errorContent.retriesLeft}` : null
                ].filter(Boolean).map(line => `<div class="wf-log-line">${htmlEscape(line)}</div>`).join('')}
            </div>
        ` : ''}
        <div class="wf-log-lines">
            ${usageLines.map(line => `<div class="wf-log-line">${htmlEscape(line)}</div>`).join('')}
        </div>
        ${diagnosticLines.length > 0 ? `
            <div class="wf-log-lines">
                ${diagnosticLines.map(line => `<div class="wf-log-line">${htmlEscape(line)}</div>`).join('')}
            </div>
        ` : ''}
    `;
}

// #endregion

function reasoningDisplayText(reasoning) {
    if (typeof reasoning === 'string') return reasoning.trim();
    if (reasoning === null || reasoning === undefined) return '';
    try {
        return JSON.stringify(reasoning, null, 2);
    } catch {
        return String(reasoning);
    }
}

function appendReasoningPanel(container, reasoning, reasoningTokens, reasoningTokensEstimated = false) {
    const displayText = reasoningDisplayText(reasoning);
    if (!displayText) return false;

    const panel = document.createElement('details');
    panel.className = 'log-reasoning-panel';

    const summary = document.createElement('summary');
    const tokenCount = Number(reasoningTokens || 0);
    summary.textContent = tokenCount > 0
        ? `Reasoning (${reasoningTokensEstimated ? '~' : ''}${tokenCount.toLocaleString()} tokens)`
        : `Reasoning (${displayText.length.toLocaleString()} characters)`;

    const content = document.createElement('pre');
    content.textContent = displayText;
    panel.appendChild(summary);
    panel.appendChild(content);
    container.appendChild(panel);
    return true;
}

function omitReasoningTextForDisplay(value) {
    if (Array.isArray(value)) {
        return value.map(omitReasoningTextForDisplay);
    }
    if (!value || typeof value !== 'object') return value;

    const reasoningTextKeys = new Set(['reasoning', 'reasoning_content', 'reasoningContent']);
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !reasoningTextKeys.has(key))
            .map(([key, childValue]) => [key, omitReasoningTextForDisplay(childValue)])
    );
}

/**
 * Renders an individual log topic item.
 */
function renderTopicItem(container, entry, topicBreakdown) {
    const title = entry.originalTitle;
    const baseTopic = title.replace(/ - (Request|Response|Error)$/, '').trim();
    const topicItem = document.createElement('div');
    topicItem.className = 'log-topic-item';

    let metaInfo = '';
    // Only show cost/duration on the Response item of a pair to avoid clutter
    if (title.endsWith(' - Response') && topicBreakdown[baseTopic]) {
        const info = topicBreakdown[baseTopic];
        metaInfo = `<span class="log-stack-cost" style="font-size: 11px; margin-left: 10px; opacity: 0.8;">$${info.totalCost.toFixed(6)} | ${info.duration.toFixed(2)}s</span>`;
    }

    const topicHeader = document.createElement('div');
    topicHeader.className = 'log-topic-header';
    const accentHTML = `<span class="topic-color-accent" style="background-color: ${getTopicColor(title)};" title="${baseTopic}"></span>`;
    topicHeader.innerHTML = `${accentHTML} <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
        <span>${title} (${new Date(entry.timestamp).toLocaleTimeString()})</span>
        ${metaInfo}
    </div>`;

    const payloadContent = document.createElement('div');
    payloadContent.className = 'log-payload-content';

    const reasoning = entry.payload?.reasoning;
    const usage = entry.payload?.usage;
    const reasoningMetric = deriveReasoningTokenMetric({
        reportedReasoningTokens: extractReasoningTokens(usage),
        generationTokens: firstMetricNumber(
            usage?.generationTokens,
            usage?.generation_tokens,
            usage?.completionTokens,
            usage?.completion_tokens,
            usage?.outputTokens,
            usage?.output_tokens
        ),
        reasoningText: extractTextFromPayload(reasoning),
        visibleText: extractTextFromPayload(entry.payload?.content)
    });
    appendReasoningPanel(
        payloadContent,
        reasoning,
        reasoningMetric.tokens,
        reasoningMetric.estimated
    );

    let formattedPayload = formatNestedJson(omitReasoningTextForDisplay(entry.payload));
    formattedPayload = recursivelyHtmlEscapeStrings(formattedPayload);
    const cleanJson = JSON.stringify(formattedPayload, null, 2);

    const jsonTreeDiv = document.createElement('div');
    jsonTreeDiv.className = 'json-tree-container';
    payloadContent.appendChild(jsonTreeDiv);

    if (typeof jsonTree !== 'undefined' && jsonTree.create) {
        jsonTree.create(JSON.parse(cleanJson), jsonTreeDiv);
    } else {
        console.error('jsonTree library (jsonTree) not found or create method is missing.');
    }

    topicItem.appendChild(topicHeader);
    topicItem.appendChild(payloadContent);
    container.appendChild(topicItem);
}

/**
 * Renders a cluster of topics as a stack.
 */
function renderTopicStack(container, cluster, topicBreakdown) {
    const stack = document.createElement('div');
    stack.className = 'log-topic-stack';

    const startTime = new Date(cluster.entries[0].timestamp).getTime();
    const endTime = new Date(cluster.entries[cluster.entries.length - 1].timestamp).getTime();
    const wallDuration = (endTime - startTime) / 1000;

    const firstTs = new Date(cluster.entries[0].timestamp).toLocaleTimeString();
    const lastTs = new Date(cluster.entries[cluster.entries.length - 1].timestamp).toLocaleTimeString();

    // Calculate total cost and total internal processing time
    let stackCost = 0;

    const requests = cluster.entries.filter(e => e.originalTitle.endsWith(' - Request'));
    const responses = cluster.entries.filter(e => e.originalTitle.endsWith(' - Response'));

    const numPairs = Math.min(requests.length, responses.length);
    for (let i = 0; i < numPairs; i++) {
        const metrics = getPairMetrics(requests[i], responses[i]);
        stackCost += metrics.cost;
    }

    stack.innerHTML = `
        <div class="log-stack-header">
            <span class="log-stack-badge">x${Math.ceil(cluster.entries.length / 2)}</span>
            <div class="log-stack-info">
                <span class="log-stack-title">${cluster.identity}</span>
                <span class="log-stack-meta">
                    <span>${firstTs} - ${lastTs} (${wallDuration.toFixed(2)}s duration)</span>
                    <span class="log-stack-cost">$${stackCost.toFixed(6)}</span>
                </span>
            </div>
            <span class="log-stack-icon">▼</span>
        </div>
        <div class="log-stack-content"></div>
    `;

    const stackContent = stack.querySelector('.log-stack-content');
    cluster.entries.forEach(entry => {
        renderTopicItem(stackContent, entry, topicBreakdown);
    });

    container.appendChild(stack);
}

/**
 * Renders the topics for a given log file.
 * @param {HTMLElement} topicsContainer - The container element to render topics into.
 * @param {object} data - The log data.
 */
function renderTopics(topicsContainer, data) {
    topicsContainer.innerHTML = '';
    const { modelBreakdown, topicBreakdown, totalCost, costTotals } = calculateLogCost(data);
    renderCostSummary(topicsContainer, modelBreakdown, topicBreakdown, totalCost, costTotals);



    const getIdentity = (title) => title.replace(/\s*\[.*?\]/g, '').replace(/ - (Request|Response|Error)$/, '').trim();

    // --- START: NEW REORDERING LOGIC ---
    const requests = [];
    const others = [];
    const responseMap = new Map();

    for (const [title, entries] of Object.entries(data)) {
        entries.forEach(entry => {
            const entryWithTitle = { ...entry, originalTitle: title };
            if (title.endsWith(' - Request')) {
                requests.push(entryWithTitle);
            } else if (title.endsWith(' - Response')) {
                const baseTitle = title.replace(/ - Response$/, '').trim();
                if (!responseMap.has(baseTitle)) responseMap.set(baseTitle, []);
                responseMap.get(baseTitle).push(entryWithTitle);
            } else {
                others.push(entryWithTitle);
            }
        });
    }

    for (const resQueue of responseMap.values()) resQueue.sort((a, b) => a.timestamp - b.timestamp);
    requests.sort((a, b) => a.timestamp - b.timestamp);

    // Prompt Traceability for key agents
    ['Writer', 'Director (Analysis)'].forEach(agentName => {
        const req = requests.find(r => getIdentity(r.originalTitle) === agentName);
        if (req) {
            const baseTitle = req.originalTitle.replace(/ - Request$/, '').trim();
            const responses = responseMap.get(baseTitle);
            if (responses && responses.length > 0) {
                renderPromptAnalysis(topicsContainer, req, responses[0], agentName);
            }
        }
    });

    const pairedAndSortedEntries = [];
    for (const req of requests) {
        pairedAndSortedEntries.push(req);
        const baseTitle = req.originalTitle.replace(/ - Request$/, '').trim();
        if (responseMap.has(baseTitle)) {
            const matchingResponses = responseMap.get(baseTitle);
            if (matchingResponses.length > 0) {
                pairedAndSortedEntries.push(matchingResponses.shift());
            }
        }
    }
    for (const resQueue of responseMap.values()) others.push(...resQueue);
    others.sort((a, b) => a.timestamp - b.timestamp);
    pairedAndSortedEntries.push(...others);
    // --- END: NEW REORDERING LOGIC ---

    // --- START: CLUSTERING LOGIC ---
    const clustersByIdentity = new Map();
    const clusterOrder = [];

    pairedAndSortedEntries.forEach(entry => {
        const identity = getIdentity(entry.originalTitle);
        if (!clustersByIdentity.has(identity)) {
            const newCluster = { identity, entries: [] };
            clustersByIdentity.set(identity, newCluster);
            clusterOrder.push(newCluster);
        }
        clustersByIdentity.get(identity).entries.push(entry);
    });

    const CLUSTER_THRESHOLD = 2; // Stack if 2 or more calls (4 or more entries)

    clusterOrder.forEach(cluster => {
        if (cluster.entries.length >= CLUSTER_THRESHOLD * 2) {
            renderTopicStack(topicsContainer, cluster, topicBreakdown);
        } else {
            cluster.entries.forEach(entry => {
                renderTopicItem(topicsContainer, entry, topicBreakdown);
            });
        }
    });
}
// #endregion

function loadLogFileItemIfNeeded(fileItem) {
    if (!fileItem || fileItem.dataset.loaded === 'true') return;

    const filename = fileItem.dataset.filename;
    const projectName = fileItem.dataset.projectName;
    if (!filename || !projectName) return;

    if (filename.startsWith('console_')) {
        socket.emit('get-waterfall-data', { projectName, filename });
    } else {
        socket.emit('get-log-content', { projectName, filename });
    }
}

function setLogFileItemOpen(fileItem, isOpen) {
    if (!fileItem) return;
    fileItem.classList.toggle('open', isOpen);

    const toggle = fileItem.querySelector('.log-file-toggle');
    if (toggle) toggle.textContent = isOpen ? '-' : '+';

    if (isOpen) loadLogFileItemIfNeeded(fileItem);

    const groupElement = fileItem.closest('.log-turn-group');
    if (groupElement?.querySelector('.log-split-view-rail')) {
        const splitPanes = Array.from(groupElement.querySelectorAll('.log-split-turn-pane, .log-split-console-pane'));
        groupElement.classList.toggle(
            'split-view-content-open',
            splitPanes.some(pane => pane.classList.contains('open'))
        );
    }
}

// #region EVENT HANDLERS & SOCKET.IO
/**
 * Handles click events on the log list container, managing file and topic expansion.
 * @param {Event} event - The click event.
 */
function handleContainerClick(event) {
    const target = event.target && typeof event.target.closest === 'function'
        ? event.target
        : event.target?.parentElement;
    if (!target) return;

    const loadMoreButton = target.closest('.load-more-logs-btn');
    if (loadMoreButton) {
        requestLogPage();
        return;
    }

    const fileHeader = target.closest('.log-file-header');
    if (fileHeader) {
        const fileItem = fileHeader.closest('.log-file-item');
        const groupElement = fileItem.closest('.log-turn-group');
        const groupFileItems = groupElement
            ? Array.from(groupElement.querySelectorAll('.log-file-item'))
            : [fileItem];
        const nextOpen = !fileItem.classList.contains('open');
        groupFileItems.forEach(item => setLogFileItemOpen(item, nextOpen));
        return;
    }

    const stackHeader = target.closest('.log-stack-header');
    if (stackHeader) {
        stackHeader.parentElement.classList.toggle('open');
        return;
    }

    const topicHeader = target.closest('.log-topic-header');
    if (topicHeader) {
        topicHeader.parentElement.classList.toggle('open');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    elements = {
        logListContainer: document.getElementById('log-list-container'),
        connectionStatus: document.getElementById('connection-status'),
        projectTitle: document.getElementById('project-title'),
        loadingIndicator: document.getElementById('loading-indicator')
    };
    elements.logGroupsContainer = document.createElement('div');
    elements.logGroupsContainer.id = 'log-groups-container';
    elements.loadMoreContainer = document.createElement('div');
    elements.loadMoreContainer.className = 'log-list-footer';
    elements.logListContainer.appendChild(elements.logGroupsContainer);
    elements.logListContainer.appendChild(elements.loadMoreContainer);
    elements.logListContainer.addEventListener('click', handleContainerClick);

    socket.on('connect', () => {
        elements.connectionStatus.textContent = 'Connected';
        elements.connectionStatus.style.color = '#3fb950';
        socket.emit('get-current-project-name');
        socket.emit('get-model-pricing');
    });

    socket.on('disconnect', () => {
        elements.connectionStatus.textContent = 'Disconnected';
        elements.connectionStatus.style.color = '#f85149';
    });

    socket.on('get-current-project-name-response', (response) => {
        currentProject = response.projectName || null;
        loadLogsForCurrentProject();
    });

    socket.on('project-changed', (data) => {
        const newProjectName = data.projectName || null;
        if (newProjectName !== currentProject) {
            currentProject = newProjectName;
            loadLogsForCurrentProject();
        }
    });

    socket.on('get-all-logs-response', (response) => {
        if (response.success && response.projectName && response.projectName !== currentProject) return;

        isLoadingLogs = false;
        elements.loadingIndicator.classList.add('hidden');

        if (response.success) {
            const responseOffset = response.offset || 0;
            loadedLogFiles = responseOffset === 0
                ? mergeLogFiles([], response.files || [])
                : mergeLogFiles(loadedLogFiles, response.files || []);
            nextLogOffset = response.nextOffset === undefined ? loadedLogFiles.length : response.nextOffset;
            hasMoreLogs = !!response.hasMore;
            renderLogList(loadedLogFiles);
        } else {
            renderLoadMoreControl();
            console.error('Failed to get log files:', response.error);
        }
    });

    socket.on('get-log-content-response', (response) => {
        if (response.success) {
            const fileItem = findLogFileItem(response.projectName, response.filename);
            if (fileItem) {
                const topicsContainer = fileItem.querySelector('.log-topics-container');
                renderTopics(topicsContainer, response.data);
                fileItem.dataset.loaded = 'true';
            }
        } else {
            console.error(`Failed to get content for ${response.filename}:`, response.error);
        }
    });

    socket.on('get-waterfall-data-response', (response) => {
        if (response.success) {
            const fileItem = findLogFileItem(response.projectName, response.filename);
            if (fileItem) {
                const container = fileItem.querySelector('.log-topics-container');
                renderWaterfallIntoContainer(container, response);
                fileItem.dataset.loaded = 'true';
            }
        } else {
            console.error('Failed to get waterfall data:', response.error);
        }
    });

    socket.on('new-log-available', (data) => {
        if (data.projectName === currentProject) {
            loadLogsForCurrentProject();
        }
    });

    socket.on('turn-log-updated', (data = {}) => {
        const projectName = data.projectName || null;
        const filename = data.filename || '';

        if (!projectName || projectName !== currentProject || !filename) return;
        if (data.isLlmPair === false) return;

        scheduleOpenLogContentRefresh(projectName, filename);
    });

    socket.on('get-model-pricing-response', (response) => {
        if (response.success) {
            modelPricing = response.pricing;
            console.log('Model pricing updated:', modelPricing);
        } else {
            console.error('Failed to get model pricing:', response.error);
        }
    });
});
// #endregion

import { state } from './state.js';

const DEBUG = true;
export const SERVER_URL =
    typeof window !== 'undefined' && typeof window.getAppServerUrl === 'function'
        ? window.getAppServerUrl()
        : 'http://localhost:14541';

/**
 * Build an absolute plugin route URL on the active app server.
 * @param {string} pluginId
 * @param {string} routePath
 * @returns {string}
 */
export function getPluginRouteUrl(pluginId, routePath = '') {
    const normalizedPluginId = String(pluginId || '').trim();
    const normalizedRoutePath = String(routePath || '').trim().replace(/^\/+/, '');
    if (!normalizedPluginId) return SERVER_URL;
    if (!normalizedRoutePath) return `${SERVER_URL}/plugins/${normalizedPluginId}`;
    return `${SERVER_URL}/plugins/${normalizedPluginId}/${normalizedRoutePath}`;
}

/**
 * Construct an absolute URL for an asset based on the current project.
 * @param {string} path - The relative path to the asset (e.g., 'sprites/char.webp').
 * @param {string} [projectName] - The project name. Defaults to state's current project if not provided.
 * @returns {string} The absolute URL.
 */
export function getAssetUrl(path, projectName) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') || path.startsWith('blob:')) return path;
    const normalizedPath = String(path).replace(/\\/g, '/');
    
    // 1. Handle paths that are already absolute-ish from the server root (e.g. /projects/... or projects/...)
    if (normalizedPath.startsWith('projects/') || normalizedPath.startsWith('/projects/')) {
        const cleanAbsPath = normalizedPath.startsWith('/') ? normalizedPath.slice(1) : normalizedPath;
        return `${SERVER_URL}/${cleanAbsPath}`;
    }

    // 2. Handle relativized paths from plugins (e.g. ../../../workspace/projects/NAME/plugins/...)
    // These paths often contain the literal string "projects/" which we can use as a delimiter.
    if (normalizedPath.includes('projects/')) {
        const parts = normalizedPath.split('projects/');
        // We take the last part, which contains "projectName/folder/file.ext"
        const relPath = parts[parts.length - 1];
        
        // This resolves to http://localhost:14541/projects/[projectName]/[folder]/[file]
        return `${SERVER_URL}/projects/${relPath}`;
    }

    const pluginMatch = normalizedPath.match(/(?:^|\/)plugins\/([^/]+)\/(.+)$/);
    if (pluginMatch) {
        return getPluginRouteUrl(pluginMatch[1], pluginMatch[2]);
    }

    const effectiveProjectName = projectName || state.currentVN?.projectName || 'default_project';

    // Default: Assume path is internal to the project's assets/ folder.
    return `${SERVER_URL}/projects/${effectiveProjectName}/assets/${normalizedPath}`;
}

/**
 * Log a debug message to the console if DEBUG is enabled.
 * @param {string} message 
 * @param {any} data 
 */
export function debugLog(message, data = null) {
    if (DEBUG) console.log(`[VN DEBUG] ${message}`, data || '');
}

/**
 * Log an error message to the console if DEBUG is enabled.
 * @param {string} message 
 * @param {any} error 
 */
export function debugError(message, error = null) {
    if (DEBUG) console.error(`[VN DEBUG ERROR] ${message}`, error || '');
}

/**
 * Check if the user is allowed to navigate away from the current state.
 * @returns {boolean}
 */
export function canNavigate() {
    return true;
}

/**
 * Get the character name from a sprite file path.
 * @param {string} fullPath 
 * @returns {string|null}
 */
export function getCharacterNameFromPath(fullPath) {
    if (!fullPath) return null;
    let filename = fullPath.split('/').pop();

    // Strip extension
    const dotIdx = filename.lastIndexOf('.');
    if (dotIdx !== -1) filename = filename.substring(0, dotIdx);

    return filename.split('_')[0].toLowerCase();
}

export function normalizeCharacterKey(character) {
    if (typeof character !== 'string') return null;
    const key = character.trim().toLowerCase();
    return key || null;
}

export function getSpriteCharacterKey(spriteData) {
    if (!spriteData) return null;
    if (typeof spriteData === 'object') {
        return normalizeCharacterKey(spriteData.character) || getCharacterNameFromPath(spriteData.path);
    }
    return getCharacterNameFromPath(spriteData);
}

/**
 * Format milliseconds to human-readable time (e.g., "1m 30s", "45s").
 * @param {number} ms - Milliseconds to format.
 * @returns {string} Formatted time string.
 */
export function formatElapsedTime(ms) {
    if (!ms || ms < 0) return '0s';
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
}

/**
 * Sanitize a string for CRC calculation.
 * @param {string} str 
 * @returns {string}
 */
export function sanitizeForCrc(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\u2026/g, '...').replace(/\*/g, '').trim();
}

/**
 * Calculate CRC32 of a string.
 * @param {string} str 
 * @returns {number}
 */
export function crc32_str(str) {
    let table = window.CrcTable || (window.CrcTable = (function () {
        let c, t = [];
        for (let n = 0; n < 256; n++) {
            c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c;
        }
        return t;
    })());
    let crc = -1;
    for (let i = 0; i < str.length; i++) crc = (crc >>> 8) ^ table[(crc ^ str.charCodeAt(i)) & 0xFF];
    return (crc ^ -1) >>> 0;
}

/**
 * Initialize socket extensions.
 * @param {any} socket 
 */
export function initSocketExtensions(socket) {
    socket.emitReceive = function (eventName, data, timeout = 10000) {
        return new Promise((resolve) => {
            let responded = false;
            const responseEvent = `${eventName}-response`;
            const onResponse = (result) => {
                if (!responded) {
                    responded = true;
                    if (timer) clearTimeout(timer);
                    resolve(result);
                }
            };
            const timer = timeout > 0
                ? setTimeout(() => {
                    if (!responded) {
                        responded = true;
                        this.off(responseEvent, onResponse);
                        resolve({ success: false, error: 'timeout' });
                    }
                }, timeout)
                : null;

            this.once(responseEvent, onResponse);
            this.emit(eventName, data);
        });
    };
}
/**
 * Show a custom confirmation modal.
 * @param {string} title
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export function showConfirmation(title, message) {
    return new Promise((resolve) => {
        Modals.confirm(title, message, () => resolve(true), () => resolve(false));
    });
}

/**
 * Perform a deep merge of two objects.
 * @param {object} target - The target object to merge into.
 * @param {object} source - The source object to merge from.
 * @returns {object} The merged object.
 */
export function deepMerge(target, source) {
    if (!source || typeof source !== 'object') return target;
    if (!target || typeof target !== 'object') return source;

    const output = { ...target };
    Object.keys(source).forEach(key => {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            output[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            output[key] = source[key];
        }
    });
    return output;
}

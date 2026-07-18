const path = require('path');
const fs = require('fs');

function resolvePhysicalPath(candidatePath) {
    const resolvedPath = path.resolve(candidatePath);
    const missingSegments = [];
    let existingPath = resolvedPath;

    while (!fs.existsSync(existingPath)) {
        const parent = path.dirname(existingPath);
        if (parent === existingPath) break;
        missingSegments.unshift(path.basename(existingPath));
        existingPath = parent;
    }

    try {
        const physicalExistingPath = fs.realpathSync.native(existingPath);
        return path.join(physicalExistingPath, ...missingSegments);
    } catch {
        return resolvedPath;
    }
}

/**
 * Checks whether a target path is inside a root directory.
 * Uses path.relative to avoid sibling-prefix bypasses (e.g. C:\proj2 vs C:\proj).
 * @param {string} targetPath
 * @param {string} rootPath
 * @returns {boolean}
 */
function isPathInsideRoot(targetPath, rootPath) {
    if (!targetPath || !rootPath) return false;
    const resolvedRoot = resolvePhysicalPath(rootPath);
    const resolvedTarget = resolvePhysicalPath(targetPath);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/**
 * Resolves a path and returns it only when it stays inside the root directory.
 * This validates existing path intent instead of sanitizing unsafe input.
 * @param {string} targetPath
 * @param {string} rootPath
 * @returns {string|null}
 */
function resolvePathInsideRoot(targetPath, rootPath) {
    if (!targetPath || !rootPath) return null;

    const resolvedRoot = path.resolve(rootPath);
    const resolvedTarget = path.resolve(targetPath);
    return isPathInsideRoot(resolvedTarget, resolvedRoot) ? resolvedTarget : null;
}

/**
 * Joins child path segments under a root and validates the final path.
 * @param {string} rootPath
 * @param {...string} segments
 * @returns {string|null}
 */
function resolveChildInsideRoot(rootPath, ...segments) {
    if (!rootPath || segments.some(segment => typeof segment !== 'string')) return null;
    return resolvePathInsideRoot(path.join(rootPath, ...segments), rootPath);
}

/**
 * Checks whether a value is a single filesystem segment, not a path.
 * @param {string} value
 * @returns {boolean}
 */
function isSafePathSegment(value) {
    if (typeof value !== 'string' || value === '' || value === '.' || value === '..') return false;
    if (value.includes('\0') || value.includes('/') || value.includes('\\') || value.includes(':')) return false;
    return path.basename(value) === value;
}

/**
 * Checks whether a plugin-provided extension is an extension, not a path.
 * @param {string} value
 * @returns {boolean}
 */
function isSafeExtension(value) {
    if (typeof value !== 'string' || value.length < 2 || !value.startsWith('.')) return false;
    if (value.includes('\0') || value.includes('/') || value.includes('\\') || value.includes(':')) return false;
    return path.basename(value) === value;
}

module.exports = {
    isPathInsideRoot,
    resolvePathInsideRoot,
    resolveChildInsideRoot,
    isSafePathSegment,
    isSafeExtension
};

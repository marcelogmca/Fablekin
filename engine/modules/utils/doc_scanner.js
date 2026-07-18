const fs = require('fs').promises;
const path = require('path');

function reportScanIssue(level, message, error) {
    try {
        // Standalone documentation scripts should not initialize application settings.
        const { Logger } = require('../utils.js');
        Logger[level]('DocScanner', message, error);
    } catch {
        console[level === 'warn' ? 'warn' : 'error'](`[DocScanner] ${message}`, error);
    }
}

/**
 * Scans a directory for documentation files (.md, .html) and extracts metadata.
 * @param {string} docsDir - The root directory to scan (e.g., engine/views/docs/documents/core).
 * @param {string} baseDocsPath - The base path for the viewer (e.g., documents/core).
 * @returns {Promise<Array<Object>>}
 */
async function scanDocs(docsDir, baseDocsPath) {
    const results = [];
    
    try {
        const entries = await fs.readdir(docsDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(docsDir, entry.name);
            const relativePath = path.join(baseDocsPath, entry.name).replace(/\\/g, '/');
            
            if (entry.isDirectory()) {
                // Recursively scan subdirectories
                const subDocs = await scanDocs(fullPath, relativePath);
                results.push(...subDocs);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (ext === '.md' || ext === '.html') {
                    const metadata = await extractMetadata(fullPath, entry.name, relativePath);
                    if (metadata) {
                        results.push(metadata);
                    }
                }
            }
        }
    } catch (error) {
        reportScanIssue('error', `Failed to scan directory: ${docsDir}`, error);
    }
    
    return results;
}

/**
 * Extracts title and description from a file.
 * @param {string} filePath 
 * @param {string} fileName 
 * @param {string} relativePath 
 */
async function extractMetadata(filePath, fileName, relativePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const ext = path.extname(fileName).toLowerCase();
        
        let title = fileName;
        let description = 'Technical documentation.';
        const id = buildDocId(fileName, ext, relativePath);
        
        // Extract category from path hierarchy
        const pathParts = relativePath.split('/');
        pathParts.pop(); // Remove filename
        const category = pathParts.length > 0 
            ? pathParts[pathParts.length - 1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            : 'Core';

        if (ext === '.md') {
            // Extract title: first # Header found anywhere in the file
            const titleMatch = content.match(/^\s*#\s+(.*)$/m);
            if (titleMatch) title = titleMatch[1].trim();
            
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line && !line.startsWith('#') && !line.startsWith('---') && !line.startsWith('![') && !line.startsWith('>')) {
                    description = line;
                    description = description.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1').replace(/[*_`]/g, '');
                    if (description.length > 150) description = description.substring(0, 147) + '...';
                    break;
                }
            }
        } else if (ext === '.html') {
            const titleMatch = content.match(/<title>(.*)<\/title>/i);
            if (titleMatch) title = titleMatch[1].trim();
            
            const descMatch = content.match(/<p>(.*)<\/p>/i);
            if (descMatch) description = descMatch[1].replace(/<[^>]*>/g, '').substring(0, 150);
        }

        return {
            id,
            title,
            description,
            category,
            path: relativePath,
            extension: ext
        };
    } catch (error) {
        reportScanIssue('warn', `Failed to extract metadata from ${fileName}`, error);
        return null;
    }
}

function buildDocId(fileName, ext, relativePath) {
    const basename = path.basename(fileName, ext).toLowerCase();
    if (basename !== 'index') return basename;

    // For folder index docs, use the parent folder name so ids are stable
    // and unique across pages like core/plugin_dev/index.* and core/vn_api/index.*.
    const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length >= 2) {
        const parent = parts[parts.length - 2];
        if (parent && parent.toLowerCase() !== 'core' && parent.toLowerCase() !== 'documents') {
            return parent.toLowerCase();
        }
    }

    return basename;
}

module.exports = {
    scanDocs
};

/**
 * docs_indexer.js
 * Validates documentation formatting and generates an offline Markdown index.
 * Run via: npm run docs:index
 */
const fs = require('fs').promises;
const path = require('path');
const { scanDocs } = require('../modules/utils/doc_scanner.js');

const CORE_DOCS_DIR = path.resolve(__dirname, '..', 'views', 'docs', 'documents', 'core');

async function validateDocumentation() {
    console.log('--- DOCUMENTATION DYNAMIC VALIDATOR & INDEXER ---');
    console.log(`Scanning: ${CORE_DOCS_DIR}`);

    const docs = await scanDocs(CORE_DOCS_DIR, 'documents/core');
    
    let issues = 0;
    const categories = {};
    
    for (const doc of docs) {
        // Validation
        if (doc.title === doc.id || doc.title.endsWith('.md')) {
            console.warn(`[MISSING TITLE] ${doc.path} - No # Header found.`);
            issues++;
        }
        if (doc.description === 'Technical documentation.') {
            console.warn(`[GENERIC DESC] ${doc.path} - No descriptive paragraph found.`);
            issues++;
        }

        // HTML to Markdown Companion Scraping
        if (doc.path.endsWith('.html')) {
            const fullHtmlPath = path.resolve(CORE_DOCS_DIR, '..', '..', doc.path);
            const mdCompanionPath = fullHtmlPath.replace(/\.html$/, '.md');
            
            try {
                const htmlContent = await fs.readFile(fullHtmlPath, 'utf8');
                const mdContent = convertHtmlToMarkdown(htmlContent, doc.path);
                await fs.writeFile(mdCompanionPath, mdContent);
                
                // Update the doc object for the README index to point to the .md version
                doc.offlinePath = doc.path.replace(/\.html$/, '.md');
            } catch (err) {
                console.error(`[SCRAPER ERROR] Failed to convert ${doc.path}: ${err.message}`);
            }
        }

        // Grouping for Index
        if (!categories[doc.category]) categories[doc.category] = [];
        categories[doc.category].push(doc);
    }

    // Generate README.md for offline viewing
    let readmeContent = '# Technical Documentation Archive\n\n';
    readmeContent += 'This index is automatically generated for repository browsing. For the full interactive experience, launch the engine and open the **Docs** tab.\n\n';
    
    const sortedCategories = Object.keys(categories).sort();
    for (const cat of sortedCategories) {
        readmeContent += `## ${cat}\n\n`;
        const sortedDocs = categories[cat].sort((a, b) => a.title.localeCompare(b.title));
        const seenPaths = new Set();
        for (const doc of sortedDocs) {
            // Path relative to documents/README.md
            // Use the offline .md path if it exists
            const displayPath = doc.offlinePath || doc.path;
            const relativePath = displayPath.replace('documents/', '');
            if (seenPaths.has(relativePath)) continue;
            seenPaths.add(relativePath);
            const description = String(doc.description || '').trim();
            readmeContent += `- **[${doc.title}](${relativePath})**\n`;
            readmeContent += `  > ${description}\n\n`;
        }
    }

    const readmePath = path.resolve(CORE_DOCS_DIR, '..', 'README.md');
    await fs.writeFile(readmePath, readmeContent);
    console.log(`[INDEX] Generated offline index at: ${readmePath}`);

    console.log('---------------------------------------');
    console.log(`Total Docs Found: ${docs.length}`);
    console.log(`Potential Issues: ${issues}`);
    console.log('Documentation system is now fully DYNAMIC.');
}

/**
 * A simple regex-based HTML to Markdown converter tailored for the engine's docs.
 */
function convertHtmlToMarkdown(html, sourcePath) {
    let md = `> [!NOTE]\n> This is an automatically generated companion file for [${path.basename(sourcePath)}](${path.basename(sourcePath)}). The original doc might contain interactive elements for better understanding.\n\n`;
    
    // Extract body content
    const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i);
    let content = bodyMatch ? bodyMatch[1] : html;

    // Remove scripts and styles
    content = content.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');

    // Code blocks need to be preserved before stripping generic tags.
    const codeBlocks = [];
    content = content.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/gi, (match, attrs, rawCode) => {
        const langMatch =
            attrs.match(/data-lang=["']([^"']+)["']/i) ||
            rawCode.match(/<code[^>]*class=["'][^"']*language-([^"'\s]+)[^"']*["']/i);
        const lang = langMatch ? langMatch[1].trim() : '';
        const code = decodeHtmlEntities(rawCode.replace(/<[^>]*>/g, '')).trim();
        const token = `@@DOCS_CODE_BLOCK_${codeBlocks.length}@@`;
        codeBlocks.push(`\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`);
        return token;
    });

    // Links should survive in offline markdown.
    content = content.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, href, label) => {
        return `[${label.replace(/<[^>]*>/g, '').trim()}](${href})`;
    });

    // Headers
    content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
    content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
    content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');

    // Tables (Simple conversion)
    content = content.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableBody) => {
        let tableMd = '\n';
        const rows = tableBody.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
        
        rows.forEach((row, i) => {
            const cells = row.match(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi) || [];
            const cellText = cells.map(c => c.replace(/<[^>]*>/g, '').trim().replace(/\n/g, ' '));
            tableMd += `| ${cellText.join(' | ')} |\n`;
            
            if (i === 0) { // Add separator after header
                tableMd += `| ${cellText.map(() => '---').join(' | ')} |\n`;
            }
        });
        return tableMd + '\n';
    });

    // Formatting
    content = content.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
    content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    content = content.replace(/<br\s*\/?>/gi, '\n');
    content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
    
    // Lists
    content = content.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '$1\n\n');
    content = content.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '$1\n\n');
    content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

    // Tags/Spans (Clean up)
    content = content.replace(/<span[^>]*class="tag[^>]*"[^>]*>([\s\S]*?)<\/span>/gi, '`$1`');
    content = content.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1');

    // Final clean up of remaining tags and entities
    content = content.replace(/<[^>]*>/g, '');
    content = decodeHtmlEntities(content);
    content = normalizeMarkdownWhitespace(content);
    content = content.replace(/@@DOCS_CODE_BLOCK_(\d+)@@/g, (match, index) => {
        return codeBlocks[Number(index)] || '';
    });

    return md + content.trim();
}

function decodeHtmlEntities(text) {
    return String(text || '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function normalizeMarkdownWhitespace(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n');
}

validateDocumentation();

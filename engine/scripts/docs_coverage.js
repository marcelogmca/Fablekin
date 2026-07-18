/**
 * docs_coverage.js
 * Checks documentation coverage by comparing codebase files against YAML metadata.
 * Run via: npm run docs:coverage
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { globSync } = require('glob');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DOCS_ROOT = path.join(REPO_ROOT, 'engine', 'views', 'docs', 'documents', 'core');
const REPORT_FILE = path.join(__dirname, 'doc_health_report.txt');

const EXCLUSIONS = [
    '**/node_modules/**',
    '**/vendor/**',
    '**/plugins/**'
];

const FILE_EXTENSIONS = ['js', 'html', 'css'];

function getFileHash(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex').toUpperCase();
}

function main() {
    console.log('Starting Documentation Health Check...');
    
    // 1. Get all source files
    const sourceFiles = globSync(`engine/**/*.{${FILE_EXTENSIONS.join(',')}}`, {
        cwd: REPO_ROOT,
        ignore: [...EXCLUSIONS, 'engine/scripts/**'],
        nodir: true,
        posix: true
    }).map(f => f.replace(/\\/g, '/'));

    const sourceFileHashes = {};
    sourceFiles.forEach(file => {
        const fullPath = path.join(REPO_ROOT, file);
        sourceFileHashes[file] = getFileHash(fullPath);
    });

    // 2. Get all documentation metadata
    const docMetaFiles = globSync('**/*.yaml', {
        cwd: DOCS_ROOT,
        nodir: true,
        posix: true
    }).map(f => f.replace(/\\/g, '/'));

    const documentedFiles = new Set();
    const reports = [];
    const outdated = [];
    const broken = [];

    docMetaFiles.forEach(metaFile => {
        const fullPath = path.join(DOCS_ROOT, metaFile);
        const mdFile = metaFile.replace(/\.yaml$/, '.md');
        const mdFullPath = path.join(DOCS_ROOT, mdFile);

        if (!fs.existsSync(mdFullPath)) {
            return;
        }

        try {
            const config = yaml.load(fs.readFileSync(fullPath, 'utf8'));
            if (config && config.documented_files) {
                config.documented_files.forEach(entry => {
                    const relPath = entry.path.replace(/\\/g, '/');
                    documentedFiles.add(relPath);

                    const currentHash = sourceFileHashes[relPath];
                    if (currentHash === undefined) {
                        broken.push(`${mdFile} is outdated, ${relPath} no longer exists or has been moved.`);
                    } else if (currentHash !== entry.hash) {
                        outdated.push(`${mdFile} is outdated, ${relPath} changed.`);
                    }
                });
            }
        } catch (e) {
            reports.push(`Error parsing ${metaFile}: ${e.message}`);
        }
    });

    // 3. Find undocumented files
    const undocumented = sourceFiles.filter(file => !documentedFiles.has(file));

    // 4. Generate Report
    let output = `DOCUMENTATION HEALTH REPORT - ${new Date().toLocaleString()}\n`;
    output += `==========================================================\n\n`;

    if (outdated.length > 0) {
        output += `OUTDATED DOCUMENTATION:\n`;
        outdated.forEach(msg => output += `- ${msg}\n`);
        output += `\n`;
    } else {
        output += `All documented files are up to date.\n\n`;
    }

    if (broken.length > 0) {
        output += `BROKEN LINKS:\n`;
        broken.forEach(msg => output += `- ${msg}\n`);
        output += `\n`;
    }

    if (undocumented.length > 0) {
        output += `UNDOCUMENTED FILES (${undocumented.length}):\n`;
        undocumented.forEach(file => output += `- ${file} has not been documented.\n`);
        output += `\n`;
    } else {
        output += `Great job! Everything is documented.\n\n`;
    }

    if (reports.length > 0) {
        output += `ERRORS:\n`;
        reports.forEach(msg => output += `- ${msg}\n`);
        output += `\n`;
    }

    fs.writeFileSync(REPORT_FILE, output);
    console.log(`Report generated at: ${REPORT_FILE}`);
    
    // Output summary to console
    console.log(`\nSummary:`);
    console.log(`- Outdated: ${outdated.length}`);
    console.log(`- Broken: ${broken.length}`);
    console.log(`- Undocumented: ${undocumented.length}`);
}

main();

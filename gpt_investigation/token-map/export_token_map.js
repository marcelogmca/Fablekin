#!/usr/bin/env node
/* Export a fully-expanded, AI-readable Token Map report for one turn log.
 *
 * Thin CLI wrapper: the report itself is built by
 * engine/views/log_viewer/prompt_trace_export.js (shared with the Log
 * Inspector export button).
 *
 * Usage:
 *   node gpt_investigation/token-map/export_token_map.js
 *   node gpt_investigation/token-map/export_token_map.js --file <turn_*.json>
 *   node gpt_investigation/token-map/export_token_map.js --project dehyacandace --turn 1790633980257
 *   node gpt_investigation/token-map/export_token_map.js --out <path.md>
 *
 * Defaults to the newest turn_*.json under workspace/logs and writes the
 * Markdown report under exports/ next to this script.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const Matrix = require(path.join(ROOT, 'engine', 'views', 'log_viewer', 'prompt_trace_matrix.js'));
const { buildTokenMapReport } = require(path.join(ROOT, 'engine', 'views', 'log_viewer', 'prompt_trace_export.js'));

function parseArgs(argv) {
    const args = { file: null, project: null, turn: null, out: null };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--file') args.file = argv[++i];
        else if (token === '--project') args.project = argv[++i];
        else if (token === '--turn') args.turn = argv[++i];
        else if (token === '--out') args.out = argv[++i];
    }
    return args;
}

function walkTurnLogs(dir, out = []) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkTurnLogs(full, out);
        else if (/^turn_.*\.json$/i.test(entry.name)) out.push(full);
    }
    return out;
}

function resolveTurnLog(args) {
    if (args.file) return path.resolve(ROOT, args.file);
    const logsRoot = path.join(ROOT, 'workspace', 'logs');
    let files = walkTurnLogs(logsRoot);
    if (args.project) files = files.filter((file) => file.includes(path.sep + args.project + path.sep));
    if (args.turn) files = files.filter((file) => file.includes(`turn_${args.turn}`));
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return files[0] || null;
}

function loadPricing() {
    try {
        const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'workspace', 'settings.json'), 'utf8'));
        return (settings.infrastructure && settings.infrastructure.model_costs) || {};
    } catch {
        return {};
    }
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const logPath = resolveTurnLog(args);
    if (!logPath) {
        console.error('No turn log found.');
        process.exit(1);
    }
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const calls = Matrix.extractCalls(log);
    const matrix = Matrix.buildMatrix(calls);
    const project = path.basename(path.dirname(logPath));
    const turnId = path.basename(logPath, '.json');
    const sourceLabel = path.relative(ROOT, logPath).replace(/\\/g, '/');
    const report = buildTokenMapReport({ project, turnId, sourceLabel, log, calls, matrix, pricing: loadPricing() });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = args.out
        ? path.resolve(ROOT, args.out)
        : path.join(__dirname, 'exports', `${project}-${turnId}-${stamp}.md`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, report, 'utf8');
    console.log(`Token Map export written: ${outPath}`);
    console.log(`  calls=${matrix.columns.length} rows=${matrix.rows.length} chars=${report.length}`);
}

main();

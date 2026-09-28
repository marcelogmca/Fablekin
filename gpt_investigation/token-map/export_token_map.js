#!/usr/bin/env node
/* Export a fully-expanded, AI-readable Token Map report for one turn log.
 *
 * Usage:
 *   node gpt_investigation/token-map/export_token_map.js
 *   node gpt_investigation/token-map/export_token_map.js --file <turn_*.json>
 *   node gpt_investigation/token-map/export_token_map.js --project dehyacandace --turn 1790633980257
 *   node gpt_investigation/token-map/export_token_map.js --out <path.md>
 *
 * Defaults to the newest turn_*.json under workspace/logs and writes a
 * Markdown report next to this script under exports/.
 *
 * Honesty rules (mirrors engine/views/log_viewer/prompt_trace_matrix.js):
 *   - Provider bills per CALL, never per piece. `~tokens` are span-proportional
 *     ATTRIBUTIONS; `input/output/reasoning` are provider-reported totals.
 *   - No fabricated numbers: untraced calls carry no pieces, no-usage calls
 *     carry no attributed tokens.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const Matrix = require(path.join(ROOT, 'engine', 'views', 'log_viewer', 'prompt_trace_matrix.js'));
const { calculateCostBreakdown } = require(path.join(ROOT, 'engine', 'views', 'log_viewer', 'cost_metrics.js'));

// ---- args -----------------------------------------------------------------
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

// ---- formatting -----------------------------------------------------------
const fmtInt = (value) => (value == null || !Number.isFinite(Number(value)) ? '—' : Math.round(Number(value)).toLocaleString('en-US'));
const fmtTok = (value) => (value == null || !Number.isFinite(Number(value)) ? '—' : `~${Math.round(Number(value)).toLocaleString('en-US')}`);
const fmtMoney = (value) => {
    const number = Number(value) || 0;
    if (number <= 0) return '$0';
    if (number >= 0.01) return `$${number.toFixed(4)}`;
    if (number >= 0.0001) return `$${number.toFixed(6)}`;
    return `$${number.toFixed(8)}`;
};
const esc = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—');
const indent = (depth) => (depth > 0 ? `${'· '.repeat(depth)}` : '');

function priceFor(column, pricing) {
    if (!column) return null;
    return calculateCostBreakdown({
        inputTokens: column.providerInputTokens || 0,
        outputTokens: column.outputTokens || 0,
        cacheReadTokens: column.cachedInputTokens || 0,
        cacheWriteTokens: 0,
        pricing: (pricing[column.provider] || {})[column.model] || null,
        reportedCost: column.reportedCost || 0
    });
}

// ---- report ---------------------------------------------------------------
function buildReport({ project, chapter, turnId, sourceLabel, log, calls, matrix, pricing }) {
    const lines = [];
    const push = (text = '') => lines.push(text);

    const totals = matrix.columns.reduce((acc, col) => {
        acc.input += col.providerInputTokens || 0;
        acc.output += col.outputTokens || 0;
        acc.reasoning += col.reasoningTokens || 0;
        acc.cached += col.cachedInputTokens || 0;
        const price = priceFor(col, pricing);
        if (price && price.hasPricing) acc.cost += price.totalCost;
        return acc;
    }, { input: 0, output: 0, reasoning: 0, cached: 0, cost: 0 });
    const statusCounts = matrix.columns.reduce((acc, col) => {
        acc[col.status] = (acc[col.status] || 0) + 1;
        return acc;
    }, {});
    const leaves = matrix.rows.filter((row) => !row.hasChildren);

    push(`# Fablekin Token Map Export`);
    push();
    push(`- Project: **${project}**`);
    push(`- Turn: **${turnId}**${chapter ? ` (Writer chapter ${chapter}, inferred)` : ''}`);
    push(`- Source log: \`${sourceLabel}\``);
    push(`- Generated: ${new Date().toISOString()}`);
    push(`- Calls: **${matrix.columns.length}** (${Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(', ')})`);
    push(`- Provider-reported input tokens across calls: **${fmtInt(totals.input)}** (cached ${fmtInt(totals.cached)})`);
    push(`- Provider-reported output tokens: **${fmtInt(totals.output)}** (reasoning ${fmtInt(totals.reasoning)})`);
    push(`- Estimated cost (local pricing, where known): **${fmtMoney(totals.cost)}**`);
    push(`- Payload rows: **${matrix.rows.length}** nodes, **${leaves.length}** leaves.`);
    push();
    push(`> Reading guide: columns are LLM calls, rows are prompt components.`);
    push(`> \`~tokens\` in payload rows are span-proportional attributions of the call's`);
    push(`> provider input total (each byte owned exactly once); \`input/output/reasoning\``);
    push(`> figures are exact provider-reported whole-call totals. \`·\` = no bytes.`);
    push();

    // ---- 1. Call index ----
    push(`## 1. Call index (columns in matrix order = heaviest input first)`);
    push();
    push(`| # | Call | requestId | model | provider | status | input | output | reasoning | cached | price in | price out | cache disc. | chars |`);
    push(`|---|------|-----------|-------|----------|--------|-------|--------|-----------|--------|----------|-----------|-------------|-------|`);
    matrix.columns.forEach((col, i) => {
        const price = priceFor(col, pricing);
        const hasPrice = price && price.hasPricing;
        push(`| ${i + 1} | ${esc(col.title)} | ${esc(col.promptId || '—')} | ${esc(col.model || '—')} | ${esc(col.provider || '—')} | ${col.status} | ${fmtInt(col.providerInputTokens)} | ${fmtInt(col.outputTokens)} | ${fmtInt(col.reasoningTokens)} | ${fmtInt(col.cachedInputTokens)} | ${hasPrice ? fmtMoney(price.inputCost) : 'n/a'} | ${hasPrice ? fmtMoney(price.outputCost) : 'n/a'} | ${hasPrice ? fmtMoney(price.cacheSavings) : 'n/a'} | ${fmtInt(col.totalChars)} |`);
    });
    push();

    // ---- 2. Matrix: attributed input tokens ----
    push(`## 2. Full matrix — attributed input tokens (fully expanded)`);
    push();
    const header = ['Payload (depth = semantic nesting)', ...matrix.columns.map((c, i) => `C${i + 1} ${esc(shorten(c.title, 22))}`)];
    push(`| ${header.join(' | ')} |`);
    push(`|${header.map(() => '---').join('|')}|`);
    for (const row of matrix.rows) {
        const cells = matrix.columns.map((col) => {
            const cell = col.cells.get(row.id);
            if (!cell || !cell.chars) return '·';
            return cell.hasTokens ? fmtTok(cell.tokens) : '~—';
        });
        push(`| ${indent(row.depth)}${esc(row.label)}${row.hasChildren ? ' ▸' : ''} | ${cells.join(' | ')} |`);
    }
    push();

    // ---- 3. Matrix: characters (stable, provider-independent) ----
    push(`## 3. Full matrix — characters (provider-independent; same bytes across calls for shared pieces)`);
    push();
    push(`| ${header.join(' | ')} |`);
    push(`|${header.map(() => '---').join('|')}|`);
    for (const row of matrix.rows) {
        const cells = matrix.columns.map((col) => {
            const cell = col.cells.get(row.id);
            return cell && cell.chars ? fmtInt(cell.chars) : '·';
        });
        push(`| ${indent(row.depth)}${esc(row.label)}${row.hasChildren ? ' ▸' : ''} | ${cells.join(' | ')} |`);
    }
    push();

    // ---- 4. Per-call detail ----
    push(`## 4. Per-call detail (fully expanded trees with leaf spans)`);
    push();
    matrix.columns.forEach((col, i) => {
        push(`### Call ${i + 1}: ${col.title}`);
        push();
        push(`- requestId: \`${col.promptId || '—'}\` · callId: \`${col.callId || '—'}\` · status: **${col.status}**`);
        push(`- model: \`${col.model || '—'}\` · provider: \`${col.provider || '—'}\``);
        push(`- provider input: ${fmtInt(col.providerInputTokens)} (cached ${fmtInt(col.cachedInputTokens)}) · output: ${fmtInt(col.outputTokens)} · reasoning: ${fmtInt(col.reasoningTokens)}`);
        const price = priceFor(col, pricing);
        if (price && price.hasPricing) {
            push(`- price: total ${fmtMoney(price.totalCost)} = input ${fmtMoney(price.inputCost)} + output ${fmtMoney(price.outputCost)}${Number(price.cacheSavings) > 0 ? ` (cache savings ${fmtMoney(price.cacheSavings)})` : ''}`);
        } else {
            push(`- price: n/a (no local pricing for this route)`);
        }
        if (col.hash) push(`- prompt hash: \`${col.hash}\``);
        push();
        if (!col.cells || col.cells.size === 0) {
            push(`_No trace (unattributed or no usage)._`);
            push();
            return;
        }
        const spansByOccurrence = collectSpans(col);
        const total = col.providerInputTokens || 0;
        for (const row of matrix.rows) {
            const cell = col.cells.get(row.id);
            if (!cell || !cell.chars) continue;
            const tokenText = cell.hasTokens ? fmtTok(cell.tokens) : '~—';
            const shareText = cell.hasTokens && total > 0 ? ` (${pct(cell.tokens, total)} of input)` : '';
            push(`${'  '.repeat(row.depth)}- **${row.label}** \`${row.id}\` — ${fmtInt(cell.chars)} chars · ${tokenText}${shareText}`);
            if (!row.hasChildren) {
                for (const piece of cell.pieces) {
                    const spanText = formatSpans(spansByOccurrence.get(piece.occurrenceId));
                    const srcText = piece.source && piece.source.sourceId ? ` · src=${String(piece.source.sourceId).slice(0, 18)}` : '';
                    const hvText = piece.historyView ? ` · history=${esc(piece.historyView.preset || JSON.stringify(piece.historyView))}` : '';
                    const ownerText = piece.owner ? ` · owner=${esc(piece.owner)}` : '';
                    const instText = piece.instanceKey ? ` · key=${esc(piece.instanceKey)}` : '';
                    push(`${'  '.repeat(row.depth + 1)}- piece \`${esc(piece.componentId)}\`${ownerText}${instText}${srcText}${hvText} — ${fmtInt(piece.chars)} chars · ${piece.tokens != null ? fmtTok(piece.tokens) : '~—'}${spanText}`);
                }
            }
        }
        push();
    });

    // ---- 5. Shared pieces ----
    push(`## 5. Shared pieces (same componentId present in multiple calls)`);
    push();
    if (!matrix.shared.length) {
        push(`_No shared pieces._`);
    } else {
        push(`| piece | calls |`);
        push(`|-------|-------|`);
        for (const entry of matrix.shared) {
            push(`| ${esc(entry.componentId)} | ${entry.columns.map((ci) => `C${ci + 1}`).join(', ')} |`);
        }
    }
    push();

    // ---- 6. Coverage notes ----
    push(`## 6. Coverage & caveats`);
    push();
    const untraced = matrix.columns.filter((c) => c.status === 'untraced');
    const noUsage = matrix.columns.filter((c) => c.status === 'no-usage');
    const localCache = matrix.columns.filter((c) => c.status === 'local-cache');
    if (untraced.length) push(`- Untraced (no promptTrace; no payload attribution): ${untraced.map((c, i) => c.title).join(', ')}`);
    if (noUsage.length) push(`- No provider total (pieces listed without attributed tokens): ${noUsage.map((c) => c.title).join(', ')}`);
    if (localCache.length) push(`- Local dev cache (spans shown, zero provider tokens): ${localCache.map((c) => c.title).join(', ')}`);
    push(`- "Message formatting" is message-owned separators (no component owner), shown as its own row.`);
    push(`- Payload token cells are attributions, not provider measurements. Only provider input/output/reasoning/cached are measured.`);
    push();
    return lines.join('\n');
}

function shorten(text, max) {
    const value = String(text || '');
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function collectSpans(column) {
    const map = new Map();
    const manifest = column.sourceCall && column.sourceCall.trace && column.sourceCall.trace.manifest;
    const spans = manifest && Array.isArray(manifest.spans) ? manifest.spans : [];
    for (const span of spans) {
        if (!span || span.occurrenceId == null) continue;
        if (!map.has(span.occurrenceId)) map.set(span.occurrenceId, []);
        map.get(span.occurrenceId).push(span);
    }
    return map;
}

function formatSpans(spans) {
    if (!spans || !spans.length) return '';
    const text = spans
        .map((span) => `msg${span.messageIndex}:${span.start}-${span.end}`)
        .join(' ');
    return ` · spans=[${text}]`;
}

// ---- main -----------------------------------------------------------------
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
    const pricing = loadPricing();
    const project = path.basename(path.dirname(logPath));
    const chapter = detectChapter(log);
    const turnId = path.basename(logPath, '.json');
    const sourceLabel = path.relative(ROOT, logPath).replace(/\\/g, '/');
    const report = buildReport({ project, chapter, turnId, sourceLabel, log, calls, matrix, pricing });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = args.out
        ? path.resolve(ROOT, args.out)
        : path.join(__dirname, 'exports', `${project}-${turnId}-${stamp}.md`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, report, 'utf8');
    console.log(`Token Map export written: ${outPath}`);
    console.log(`  calls=${matrix.columns.length} rows=${matrix.rows.length} chars=${report.length}`);
}

// Best-effort only: the turn log doesn't carry the canonical chapter number.
// Use an explicit Writer response header if present, else the highest chapter
// referenced in history + 1. Marked "inferred" in the report.
function detectChapter(log) {
    const writer = log['Writer - Response'];
    const content = Array.isArray(writer) && writer[0] && writer[0].payload ? String(writer[0].payload.content || '') : '';
    const direct = content.match(/#\s*Chapter\s+(\d+)/i);
    if (direct) return direct[1];
    const request = log['Writer - Request'];
    const messages = Array.isArray(request) && request[0] && request[0].payload && Array.isArray(request[0].payload.content)
        ? request[0].payload.content
        : [];
    let max = 0;
    for (const message of messages) {
        const text = typeof message.content === 'string' ? message.content : '';
        const matches = text.match(/Chapter\s+(\d+)/gi) || [];
        for (const hit of matches) {
            const value = Number(hit.replace(/\D+/g, ''));
            if (value > max) max = value;
        }
    }
    return max > 0 ? String(max + 1) : null;
}

main();

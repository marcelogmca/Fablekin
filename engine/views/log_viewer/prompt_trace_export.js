/* Fablekin Token Map — AI-readable report builder.
 *
 * Pure formatting: takes an already-built matrix (see prompt_trace_matrix.js)
 * and returns a fully-expanded Markdown report. No DOM, no filesystem, no
 * network. Shared by the Log Inspector export button and the standalone
 * gpt_investigation/token-map/export_token_map.js CLI.
 *
 * Honesty rules (same as the matrix):
 *   - `~tokens` in payload rows are span-proportional ATTRIBUTIONS.
 *   - input/output/reasoning/cached are provider-reported whole-call totals.
 *   - No fabricated numbers: untraced/no-usage calls are labelled, not faked.
 */
(function exposePromptTraceExport(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.PromptTraceExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPromptTraceExport() {
    'use strict';

    const CostMetrics = (typeof module !== 'undefined' && module.exports)
        ? require('./cost_metrics.js')
        : (typeof globalThis !== 'undefined' ? globalThis.LogCostMetrics : null);
    const calculateCostBreakdown = CostMetrics ? CostMetrics.calculateCostBreakdown : () => null;

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
    const indent = (depth) => (depth > 0 ? '· '.repeat(depth) : '');

    function shorten(text, max) {
        const value = String(text || '');
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function priceFor(column, pricing) {
        if (!column) return null;
        const providerPricing = pricing && pricing[column.provider] ? pricing[column.provider] : {};
        return calculateCostBreakdown({
            inputTokens: column.providerInputTokens || 0,
            outputTokens: column.outputTokens || 0,
            cacheReadTokens: column.cachedInputTokens || 0,
            cacheWriteTokens: 0,
            pricing: providerPricing[column.model] || null,
            reportedCost: column.reportedCost || 0
        });
    }

    // Best-effort only: turn logs don't carry the canonical chapter number.
    function detectChapter(log) {
        if (!log) return null;
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

    function collectSpans(column) {
        const map = new Map();
        const manifest = column && column.sourceCall && column.sourceCall.trace && column.sourceCall.trace.manifest;
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
        return ` · spans=[${spans.map((span) => `msg${span.messageIndex}:${span.start}-${span.end}`).join(' ')}]`;
    }

    function buildTokenMapReport({ project, turnId, sourceLabel, log, calls, matrix, pricing }) {
        const lines = [];
        const push = (text = '') => lines.push(text);
        const chapter = detectChapter(log);

        const totals = matrix.columns.reduce((acc, col) => {
            acc.input += col.providerInputTokens || 0;
            acc.output += col.outputTokens || 0;
            acc.reasoning += col.reasoningTokens || 0;
            acc.cached += col.cachedInputTokens || 0;
            const price = priceFor(col, pricing);
            if (price && (price.hasPricing || price.hasReportedCost)) {
                acc.cost += price.totalCost;
                if (price.hasReportedCost) acc.reported += 1;
                else acc.estimated += 1;
            }
            return acc;
        }, { input: 0, output: 0, reasoning: 0, cached: 0, cost: 0, reported: 0, estimated: 0 });
        const statusCounts = matrix.columns.reduce((acc, col) => {
            acc[col.status] = (acc[col.status] || 0) + 1;
            return acc;
        }, {});
        const leaves = matrix.rows.filter((row) => !row.hasChildren);

        push(`# Fablekin Token Map Export`);
        push();
        push(`- Project: **${project}**`);
        push(`- Turn: **${turnId}**${chapter ? ` (Writer chapter ${chapter}, inferred)` : ''}`);
        if (sourceLabel) push(`- Source log: \`${sourceLabel}\``);
        push(`- Generated: ${new Date().toISOString()}`);
        push(`- Calls: **${matrix.columns.length}** (${Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(', ')})`);
        push(`- Provider-reported input tokens across calls: **${fmtInt(totals.input)}** (cached ${fmtInt(totals.cached)})`);
        push(`- Provider-reported output tokens: **${fmtInt(totals.output)}** (reasoning ${fmtInt(totals.reasoning)}; "n/r" in the matrix = provider carried no reasoning field)`);
        push(`- Cost: **${fmtMoney(totals.cost)}** (${totals.reported} call(s) provider-reported, ${totals.estimated} call(s) locally estimated; failed calls with no usage are cost unknown, never $0)`);
        push(`- Payload rows: **${matrix.rows.length}** nodes, **${leaves.length}** leaves.`);
        push();
        push(`> Reading guide: columns are LLM calls, rows are prompt components.`);
        push(`> \`~tokens\` in payload rows are span-proportional attributions of the call's`);
        push(`> provider input total (each byte owned exactly once); \`input/output/cached\``);
        push(`> figures are exact provider-reported whole-call totals. Reasoning \`n/r\` = the`);
        push(`> provider carried no reasoning field (not zero, not estimated). \`·\` = no bytes.`);
        push();

        // 1. Call index
        push(`## 1. Call index (columns in matrix order = heaviest input first)`);
        push();
        push(`| # | Call | requestId | model | provider | status | input | output | reasoning | cached | billed | in + cache + out | chars |`);
        push(`|---|------|-----------|-------|----------|--------|-------|--------|-----------|--------|--------|---------------|-------|`);
        matrix.columns.forEach((col, i) => {
            const price = priceFor(col, pricing);
            const priceCell = col.costUnknown
                ? 'unknown'
                : (price && (price.hasPricing || price.hasReportedCost))
                    ? `${fmtMoney(price.totalCost)}${price.hasReportedCost ? ' (reported)' : ' (est.)'}`
                    : 'n/a';
            const equationCell = col.costUnknown
                ? `${col.failedAttempts} failed attempt(s), no usage`
                : (price && (price.hasPricing || price.hasReportedCost))
                    ? `${fmtMoney(price.inputCost)} + ${fmtMoney(price.cacheReadCost)} + ${fmtMoney(price.outputCost)}`
                    : '—';
            const reasoningCell = (col.reasoningProvenance === 'absent' && !col.reasoningTokens) ? 'n/r' : fmtInt(col.reasoningTokens);
            push(`| ${i + 1} | ${esc(col.title)} | ${esc(col.promptId || '—')} | ${esc(col.model || '—')} | ${esc(col.provider || '—')} | ${col.status} | ${fmtInt(col.providerInputTokens)} | ${fmtInt(col.outputTokens)} | ${reasoningCell} | ${fmtInt(col.cachedInputTokens)} | ${priceCell} | ${equationCell} | ${fmtInt(col.totalChars)} |`);
        });
        push();

        // 2. Matrix: attributed input tokens
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

        // 3. Matrix: characters
        push(`## 3. Full matrix — characters (provider-independent; shared pieces carry the same bytes per call)`);
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

        // 4. Per-call detail
        push(`## 4. Per-call detail (fully expanded trees with leaf spans)`);
        push();
        matrix.columns.forEach((col, i) => {
            push(`### Call ${i + 1}: ${col.title}`);
            push();
            push(`- requestId: \`${col.promptId || '—'}\` · callId: \`${col.callId || '—'}\` · status: **${col.status}**`);
            push(`- model: \`${col.model || '—'}\` · provider: \`${col.provider || '—'}\``);
            push(`- provider input: ${fmtInt(col.providerInputTokens)} (cached ${fmtInt(col.cachedInputTokens)}) · output: ${fmtInt(col.outputTokens)} · reasoning: ${fmtInt(col.reasoningTokens)}`);
            const price = priceFor(col, pricing);
            if (col.costUnknown) {
                push(`- price: unknown (${col.failedAttempts} failed attempt(s), no provider usage returned; a later retry's success does not make these free)`);
            } else if (price && (price.hasPricing || price.hasReportedCost)) {
                push(`- price: billed ${fmtMoney(price.totalCost)}${price.hasReportedCost ? ' (provider-reported)' : ' (locally estimated)'} = uncached input ${fmtMoney(price.inputCost)} + cache read ${fmtMoney(price.cacheReadCost)} + output ${fmtMoney(price.outputCost)}${Number(price.cacheSavings) > 0 ? ` (vs full-price input, saves ${fmtMoney(price.cacheSavings)})` : ''}`);
            } else {
                push(`- price: n/a (no local pricing for this route and no provider-reported cost)`);
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

        // 5. Shared pieces
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

        // 6. Coverage
        push(`## 6. Coverage & caveats`);
        push();
        const untraced = matrix.columns.filter((c) => c.status === 'untraced');
        const noUsage = matrix.columns.filter((c) => c.status === 'no-usage');
        const localCache = matrix.columns.filter((c) => c.status === 'local-cache');
        if (untraced.length) push(`- Untraced (no promptTrace; no payload attribution): ${untraced.map((c) => c.title).join(', ')}`);
        if (noUsage.length) push(`- No provider total (pieces listed without attributed tokens): ${noUsage.map((c) => c.title).join(', ')}`);
        if (localCache.length) push(`- Local dev cache (spans shown, zero provider tokens): ${localCache.map((c) => c.title).join(', ')}`);
        push(`- "Message formatting" is message-owned separators (no component owner), shown as its own row.`);
        push(`- Payload token cells are attributions, not provider measurements. Only provider input/output/reasoning/cached are measured.`);
        push();
        return lines.join('\n');
    }

    return { buildTokenMapReport, priceFor, detectChapter };
});

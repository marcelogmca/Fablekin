/* Fablekin Token Map — measured prompt-trace parser.
 *
 * Pure module: parses one turn's log entries into a measured token matrix.
 * No DOM, no network. Reads only logged facts:
 *   - request.payload.promptTrace { promptId, hash, characterCount, manifest, callId }
 *   - request.payload.content (logged message array, lengths only — never re-sliced)
 *   - response.payload.usage (provider totals; absent = no measurement)
 *
 * Honesty rules (load-bearing):
 *   - Provider bills per CALL, never per piece. Per-piece cells are
 *     span-proportional ATTRIBUTIONS (~estimates), flagged as such.
 *   - Separator spans (occurrenceId null) are message-owned formatting:
 *     they land in a visible "message formatting" row, never inside a piece.
 *   - Rollups follow SEMANTIC ancestry (manifest.components[id].parent),
 *     never physical containerOccurrenceId. Each byte counts once.
 *   - Missing usage -> "no provider total" (estimated from chars, flagged).
 *   - Missing promptTrace -> unattributed call (never fake cells).
 *   - Dev-cache hits (usage.is_local_cache) -> spans shown, zero provider
 *     tokens, badged locally-served.
 */
(function exposePromptTraceMatrix(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.PromptTraceMatrix = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPromptTraceMatrix() {
    'use strict';

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function asNonEmptyString(value) {
        return typeof value === 'string' && value.length > 0 ? value : null;
    }

    function messageTextLength(message) {
        if (!message || typeof message !== 'object') return 0;
        if (typeof message.content === 'string') return message.content.length;
        if (typeof message.text === 'string') return message.text.length;
        return 0;
    }

    // ---- call extraction -------------------------------------------------
    // Joins "X - Request" with "X - Response"/"X - Error" by shared callId.
    // Returns calls in first-request order with per-call provenance badges.
    function extractCalls(turnLogData) {
        if (!turnLogData || typeof turnLogData !== 'object') return [];
        const calls = [];
        for (const [fullTitle, requestEntries] of Object.entries(turnLogData)) {
            if (!fullTitle.endsWith(' - Request')) continue;
            if (!Array.isArray(requestEntries)) continue;
            const title = fullTitle.replace(/ - Request$/, '').trim();
            const responseEntries = Array.isArray(turnLogData[`${title} - Response`])
                ? turnLogData[`${title} - Response`] : [];
            const errorEntries = Array.isArray(turnLogData[`${title} - Error`])
                ? turnLogData[`${title} - Error`] : [];
            for (const request of requestEntries) {
                if (!request || !request.payload || request.other) continue;
                const requestCallId = request.payload.promptTrace && request.payload.promptTrace.callId;
                const match = (entries) => (entries || []).find((entry) => {
                    if (!entry || !entry.payload || entry.other) return false;
                    const entryCallId = entry.payload.callId
                        || (entry.payload.promptTrace && entry.payload.promptTrace.callId);
                    if (requestCallId && entryCallId) return entryCallId === requestCallId;
                    return false;
                });
                const response = match(responseEntries) || null;
                const error = response ? null : (match(errorEntries) || null);
                calls.push({
                    title,
                    timestamp: request.timestamp || null,
                    request,
                    response,
                    error,
                    trace: isObject(request.payload.promptTrace) ? request.payload.promptTrace : null
                });
            }
        }
        calls.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
        return calls;
    }

    function usageInputTokens(usage) {
        if (!isObject(usage)) return null;
        const candidates = [
            usage.prompt_tokens, usage.promptTokens,
            usage.input_tokens, usage.inputTokens
        ];
        for (const value of candidates) {
            const number = Number(value);
            if (Number.isFinite(number) && number > 0) return Math.round(number);
        }
        return null;
    }

    function isLocalCacheHit(usage) {
        if (!isObject(usage)) return false;
        return usage.is_local_cache === true || usage.isLocalCache === true;
    }

    // ---- per-call attribution --------------------------------------------
    // occurrenceId -> owned character count (exclusive spans only).
    function occurrenceCharCounts(trace) {
        const counts = new Map();
        const manifest = trace && trace.manifest;
        if (!manifest || !Array.isArray(manifest.spans)) return counts;
        for (const span of manifest.spans) {
            if (!span || typeof span !== 'object') continue;
            if (span.occurrenceId == null) continue; // separator: overhead row
            const length = Number(span.end) - Number(span.start);
            if (!Number.isFinite(length) || length <= 0) continue;
            counts.set(span.occurrenceId, (counts.get(span.occurrenceId) || 0) + length);
        }
        return counts;
    }

    function separatorCharCount(trace) {
        let total = 0;
        const manifest = trace && trace.manifest;
        if (!manifest || !Array.isArray(manifest.spans)) return 0;
        for (const span of manifest.spans) {
            if (!span || typeof span !== 'object') continue;
            if (span.occurrenceId != null) continue;
            const length = Number(span.end) - Number(span.start);
            if (Number.isFinite(length) && length > 0) total += length;
        }
        return total;
    }

    function totalSpanChars(trace) {
        let total = 0;
        const manifest = trace && trace.manifest;
        if (!manifest || !Array.isArray(manifest.spans)) return 0;
        for (const span of manifest.spans) {
            if (!span || typeof span !== 'object') continue;
            const length = Number(span.end) - Number(span.start);
            if (Number.isFinite(length) && length > 0) total += length;
        }
        return total;
    }

    function attributeCall(call) {
        const trace = call.trace;
        if (!trace || !trace.manifest) {
            return { status: 'untraced', pieces: [], overheadChars: 0, overheadTokens: 0, totalChars: 0 };
        }
        const usage = call.response && call.response.payload ? call.response.payload.usage : null;
        const localCache = isLocalCacheHit(usage);
        const providerInputTokens = localCache ? 0 : usageInputTokens(usage);
        const manifest = trace.manifest;
        const occurrences = Array.isArray(manifest.occurrences) ? manifest.occurrences : [];
        const components = isObject(manifest.components) ? manifest.components : {};
        const charCounts = occurrenceCharCounts(trace);
        const totalChars = totalSpanChars(trace);
        const overheadChars = separatorCharCount(trace);

        const pieces = [];
        for (const occurrence of occurrences) {
            if (!occurrence || typeof occurrence !== 'object') continue;
            const chars = charCounts.get(occurrence.occurrenceId) || 0;
            if (chars <= 0) continue;
            const component = components[occurrence.componentId] || {};
            pieces.push({
                occurrenceId: occurrence.occurrenceId,
                componentId: occurrence.componentId,
                instanceKey: occurrence.instanceKey ?? null,
                label: component.label || occurrence.componentId,
                parent: component.parent ?? null,
                owner: component.owner ?? null,
                source: occurrence.source ? { ...occurrence.source } : null,
                historyView: occurrence.historyView ? { ...occurrence.historyView } : null,
                chars,
                // Attributed share of THIS call's provider input tokens.
                // Null when there is no provider total (failed/error calls)
                // or the call was served from the local dev cache.
                tokens: providerInputTokens != null && totalChars > 0 && !localCache
                    ? (chars / totalChars) * providerInputTokens
                    : null
            });
        }

        const status = localCache
            ? 'local-cache'
            : providerInputTokens != null ? 'measured' : 'no-usage';
        return {
            status,
            pieces,
            overheadChars,
            overheadTokens: providerInputTokens != null && totalChars > 0 && !localCache
                ? (overheadChars / totalChars) * providerInputTokens
                : null,
            totalChars,
            providerInputTokens,
            localCache
        };
    }

    // ---- matrix assembly ---------------------------------------------------
    // Rows keyed by semantic top-level family: the component's own id when its
    // parent chain reaches a pillar root quickly, else its slot ancestor.
    // Simpler rule: row = highest ancestor below the pillar root.
    function pillarRootOf(componentId, components) {
        let current = componentId;
        const seen = new Set();
        let topmost = componentId;
        while (current && !seen.has(current)) {
            seen.add(current);
            topmost = current;
            const parent = components[current] ? components[current].parent : null;
            if (parent == null) break;
            // Stop at pillar roots (root/writer/director) — the row is the
            // child just beneath the pillar.
            if (parent === 'root' || parent === 'writer' || parent === 'director') break;
            current = parent;
        }
        return topmost;
    }

    function buildMatrix(calls) {
        const columns = [];
        const rowIndex = new Map(); // rowId -> row
        const rows = [];
        const sharedIndex = new Map(); // componentId -> Set(columnIndex)

        calls.forEach((call, columnIndex) => {
            const attribution = attributeCall(call);
            const manifest = call.trace && call.trace.manifest;
            const components = manifest && isObject(manifest.components) ? manifest.components : {};
            const cells = new Map(); // rowId -> { chars, tokens, pieces[] }
            const addCell = (rowId, piece) => {
                if (!rowIndex.has(rowId)) {
                    const component = components[rowId] || {};
                    rowIndex.set(rowId, rows.length);
                    rows.push({
                        id: rowId,
                        label: component.label || rowId,
                        owner: component.owner || null,
                        parent: component.parent || null
                    });
                }
                if (!cells.has(rowId)) cells.set(rowId, { chars: 0, tokens: 0, pieces: [] });
                const cell = cells.get(rowId);
                cell.chars += piece.chars;
                if (piece.tokens != null) cell.tokens = (cell.tokens || 0) + piece.tokens;
                cell.pieces.push(piece);
            };

            for (const piece of attribution.pieces) {
                const rowId = pillarRootOf(piece.componentId, components);
                addCell(rowId, piece);
                if (!sharedIndex.has(piece.componentId)) sharedIndex.set(piece.componentId, new Set());
                sharedIndex.get(piece.componentId).add(columnIndex);
            }
            if (attribution.overheadChars > 0) {
                const rowId = '__formatting__';
                if (!rowIndex.has(rowId)) {
                    rowIndex.set(rowId, rows.length);
                    rows.push({ id: rowId, label: 'Message formatting', owner: null, parent: null });
                }
                if (!cells.has(rowId)) cells.set(rowId, { chars: 0, tokens: 0, pieces: [] });
                const cell = cells.get(rowId);
                cell.chars += attribution.overheadChars;
                if (attribution.overheadTokens != null) {
                    cell.tokens = (cell.tokens || 0) + attribution.overheadTokens;
                }
            }

            columns.push({
                title: call.title,
                callId: (call.trace && call.trace.callId) || null,
                promptId: (call.trace && call.trace.promptId) || null,
                hash: (call.trace && call.trace.hash) || null,
                status: attribution.status,
                providerInputTokens: attribution.providerInputTokens ?? null,
                totalChars: attribution.totalChars,
                cells
            });
        });

        const shared = [];
        for (const [componentId, columnSet] of sharedIndex) {
            if (columnSet.size > 1) {
                shared.push({ componentId, columns: [...columnSet].sort((a, b) => a - b) });
            }
        }
        shared.sort((a, b) => b.columns.length - a.columns.length);

        return { columns, rows, shared };
    }

    return {
        extractCalls,
        attributeCall,
        buildMatrix,
        occurrenceCharCounts,
        usageInputTokens,
        isLocalCacheHit
    };
});

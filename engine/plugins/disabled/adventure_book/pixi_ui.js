(() => {
    const PIXI = context?.PIXI || window.PIXI;
    const app = context?.pixiApp?.app || context?.pixiApp;
    const payload = context?.payload || {};
    const stage = app?.stage;

    if (!PIXI || !stage) {
        bridge?.log?.warn?.('[AdventureBook] Pixi runtime unavailable.');
        return;
    }

    function cssVar(name, fallback = '') {
        try {
            const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            return value && !value.startsWith('var(') ? value : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function cssHex(name, fallback) {
        const value = cssVar(name, fallback).trim();
        if (/^#[0-9a-f]{3}$/i.test(value)) {
            return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
        }
        return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    }

    function pixiColor(hex) {
        return Number.parseInt(String(hex || '#000000').replace('#', ''), 16);
    }

    const THEME = {
        primary: cssHex('--color-primary', '#f1c40f'),
        primaryHover: cssHex('--color-primary-hover', '#f39c12'),
        accentDark: cssHex('--accent-dark', '#c0a060'),
        secondary: cssHex('--color-secondary', '#3498db'),
        warning: cssHex('--status-warning', '#e67e22'),
        danger: cssHex('--status-danger', '#b83b5e'),
        bgBase: cssHex('--bg-base', '#121212'),
        surface1: cssHex('--bg-surface-1', '#1e1e24'),
        surface2: cssHex('--bg-surface-2', '#2a2a35'),
        surfaceHover: cssHex('--bg-surface-hover', '#3a3a45'),
        textMain: cssHex('--text-main', '#f5f6fa'),
        textMuted: cssHex('--text-muted', '#a4b0be'),
        textInverse: cssHex('--text-inverse', '#121212'),
        fontMain: cssVar('--font-main', "'Inter', 'NotoSans', 'Segoe UI', sans-serif"),
        fontTitle: cssVar('--font-title', "'Cinzel', serif"),
        fontNarrative: cssVar('--font-narrative', "'CormorantGaramond', serif")
    };

    const PALETTE = {
        veil: pixiColor(THEME.bgBase),
        ink: pixiColor(THEME.textMain),
        inkSoft: pixiColor(THEME.textMuted),
        paper: pixiColor(THEME.surface1),
        parchment: pixiColor(THEME.surface1),
        parchmentLight: pixiColor(THEME.surface2),
        parchmentDark: pixiColor(THEME.surfaceHover),
        paperDeep: pixiColor(THEME.surface2),
        cream: pixiColor(THEME.textMain),
        copper: pixiColor(THEME.primary),
        rust: pixiColor(THEME.primaryHover),
        leather: pixiColor(THEME.surface1),
        leatherDark: pixiColor(THEME.bgBase),
        metal: pixiColor(THEME.surfaceHover),
        metalDark: pixiColor(THEME.surface1),
        brass: pixiColor(THEME.accentDark),
        moss: pixiColor(THEME.surface2),
        blue: pixiColor(THEME.secondary),
        line: pixiColor(THEME.primaryHover),
        danger: pixiColor(THEME.danger)
    };

    function normalizeCgVisualStyle(value) {
        const style = String(value || 'original').trim().toLowerCase();
        return ['original', 'sepia', 'black_white', 'pixel_art', 'theme_colors'].includes(style)
            ? style
            : 'original';
    }

    function extractCgVisualStyleFromSettings(settings) {
        return settings?.plugins?.adventure_book?.cg_visual_style
            ?? settings?.adventure_book?.cg_visual_style
            ?? settings?.cg_visual_style
            ?? null;
    }

    function extractDebugModeFromSettings(settings) {
        const value = settings?.plugins?.adventure_book?.debug_mode
            ?? settings?.adventure_book?.debug_mode
            ?? settings?.debug_mode
            ?? null;
        return value === null ? null : value === true;
    }

    function getCgStatus(current = null) {
        if (current?.cgImagePath) return 'ready';
        const status = String(current?.cgStatus || '').trim().toLowerCase();
        return ['missing', 'pending', 'ready', 'failed'].includes(status) ? status : 'missing';
    }

    const state = {
        current: null,
        chapters: [],
        selectedChapterIndex: 1,
        interactionMode: String(payload.interactionMode || 'active'),
        bookStatus: String(payload.bookStatus || 'active'),
        history: [],
        busy: false,
        cgBusy: false,
        cgStatus: '',
        visible: true,
        startInvoked: false,
        autoCgRequestedChapterIndex: null,
        hiddenFromDialogueIndex: null,
        hiddenLeftOriginalDialogue: false,
        status: '',
        statusIsError: false,
        chapterTransitionActive: false,
        chapterTransitionMessage: '',
        optionHoverText: '',
        optionTooltipX: 0,
        optionTooltipY: 0,
        rollAnimationActive: false,
        lastRoll: null,
        currentPageIndex: 0,
        cgTexturePath: '',
        cgTextureStatus: '',
        cgVisualStyle: normalizeCgVisualStyle(payload.cgVisualStyle),
        debugMode: payload.debugMode === true || payload.debugRebuildEnabled === true,
        characterAccents: {},
        pageLayoutKey: '',
        pageStartOffsets: [0],
        pageCacheKey: '',
        pageCachePages: null,
        pageCacheOffsets: null
    };

    function normalizeUiChapter(raw, fallbackIndex = 1) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const chapterState = source.state && typeof source.state === 'object' ? source.state : source;
        if (!chapterState || typeof chapterState !== 'object') return null;
        const chapterIndex = Number(source.chapterIndex || chapterState.stepIndex || chapterState.chapterIndex || fallbackIndex) || fallbackIndex;
        return {
            chapterIndex,
            state: chapterState,
            selectedOption: source.selectedOption || source.option || null,
            roll: source.roll || null,
            resultText: source.resultText || ''
        };
    }

    function normalizeUiChapters(chapters, current) {
        const normalized = [];
        const push = (chapter, fallbackIndex) => {
            const next = normalizeUiChapter(chapter, fallbackIndex);
            if (!next?.state) return;
            const existing = normalized.findIndex(candidate => candidate.chapterIndex === next.chapterIndex);
            if (existing >= 0) normalized[existing] = { ...normalized[existing], ...next };
            else normalized.push(next);
        };
        if (Array.isArray(chapters)) chapters.forEach((chapter, index) => push(chapter, index + 1));
        if (current) push({ state: current, chapterIndex: current.stepIndex || current.chapterIndex || normalized.length + 1 }, normalized.length + 1);
        return normalized.sort((a, b) => a.chapterIndex - b.chapterIndex);
    }

    function latestChapterIndex() {
        const latest = state.chapters[state.chapters.length - 1];
        return Number(state.current?.stepIndex)
            || Number(state.current?.chapterIndex)
            || Number(payload.currentChapterIndex)
            || Number(latest?.chapterIndex)
            || 1;
    }

    function currentChapterIndex() {
        return latestChapterIndex();
    }

    function displayedChapter() {
        const selected = Number(state.selectedChapterIndex) || latestChapterIndex();
        return state.chapters.find(chapter => chapter.chapterIndex === selected)
            || state.chapters[state.chapters.length - 1]
            || normalizeUiChapter({ state: state.current, chapterIndex: latestChapterIndex() }, latestChapterIndex());
    }

    function displayedState() {
        return displayedChapter()?.state || state.current || {};
    }

    function isReadOnlyMode() {
        return state.interactionMode !== 'active' || state.bookStatus === 'finalized';
    }

    function isViewingLatestChapter() {
        return Number(displayedChapter()?.chapterIndex || state.selectedChapterIndex) === Number(latestChapterIndex());
    }

    function canMutateCurrentChapter() {
        return !isReadOnlyMode() && isViewingLatestChapter();
    }

    function syncChaptersFromResponse(response = {}) {
        if (Array.isArray(response.chapters)) {
            state.chapters = normalizeUiChapters(response.chapters, response.state || response.currentState || state.current);
        } else if (response.state || response.currentState) {
            state.chapters = normalizeUiChapters(state.chapters, response.state || response.currentState);
        }
        if (response.interactionMode) state.interactionMode = String(response.interactionMode);
        if (response.bookStatus) state.bookStatus = String(response.bookStatus);
        if (!Number.isFinite(Number(state.selectedChapterIndex)) || state.selectedChapterIndex < 1) {
            state.selectedChapterIndex = latestChapterIndex();
        }
    }

    function selectChapter(chapterIndex) {
        const index = Number(chapterIndex) || latestChapterIndex();
        if (!state.chapters.some(chapter => chapter.chapterIndex === index)) return;
        state.selectedChapterIndex = index;
        state.currentPageIndex = 0;
        state.pageLayoutKey = '';
        state.pageCacheKey = '';
        state.pageCachePages = null;
        state.pageCacheOffsets = null;
        hideOptionTooltip();
        render();
    }

    function screenSize() {
        const screen = app?.screen || {};
        return {
            width: Number(screen.width) || Number(context?.pixiApp?.LOGICAL_WIDTH) || 1280,
            height: Number(screen.height) || Number(context?.pixiApp?.LOGICAL_HEIGHT) || 720
        };
    }

    function textStyle(style = {}) {
        return {
            fontFamily: style.fontFamily || THEME.fontMain,
            fontSize: style.fontSize || 18,
            fill: style.fill ?? PALETTE.ink,
            align: style.align || 'left',
            lineHeight: style.lineHeight,
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
            letterSpacing: style.letterSpacing || 0,
            stroke: style.stroke,
            wordWrap: false
        };
    }

    function makeText(text, style = {}) {
        const value = String(text || '');
        const styleValue = textStyle(style);
        try {
            return new PIXI.Text({ text: value, style: styleValue });
        } catch (_) {
            return new PIXI.Text(value, styleValue);
        }
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeRegExp(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function hexToRgb(hex, fallback = { r: 180, g: 140, b: 96 }) {
        const clean = String(hex || '').replace('#', '').trim();
        if (!/^[0-9a-f]{6}$/i.test(clean)) return fallback;
        return {
            r: Number.parseInt(clean.slice(0, 2), 16),
            g: Number.parseInt(clean.slice(2, 4), 16),
            b: Number.parseInt(clean.slice(4, 6), 16)
        };
    }

    function rgbToHex({ r, g, b }) {
        return `#${[r, g, b]
            .map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
            .join('')}`;
    }

    function colorIntToCss(color, alpha = 1) {
        const { r, g, b } = colorIntToRgb(color);
        const a = Math.max(0, Math.min(1, Number(alpha)));
        return `rgba(${r}, ${g}, ${b}, ${Number.isFinite(a) ? a : 1})`;
    }

    function colorIntToRgb(color) {
        const value = Math.max(0, Math.min(0xffffff, Number(color) || 0));
        return {
            r: (value >> 16) & 255,
            g: (value >> 8) & 255,
            b: value & 255
        };
    }

    function rgbToInt({ r, g, b }) {
        const rr = Math.max(0, Math.min(255, Math.round(r)));
        const gg = Math.max(0, Math.min(255, Math.round(g)));
        const bb = Math.max(0, Math.min(255, Math.round(b)));
        return (rr << 16) + (gg << 8) + bb;
    }

    function mixColor(a, b, amount = 0.5) {
        const mix = Math.max(0, Math.min(1, Number(amount) || 0));
        const left = colorIntToRgb(a);
        const right = colorIntToRgb(b);
        return rgbToInt({
            r: left.r + (right.r - left.r) * mix,
            g: left.g + (right.g - left.g) * mix,
            b: left.b + (right.b - left.b) * mix
        });
    }

    function shadeColor(color, amount = 0) {
        const target = amount >= 0 ? 0xffffff : 0x000000;
        return mixColor(color, target, Math.abs(Math.max(-1, Math.min(1, Number(amount) || 0))));
    }

    function normalizeNameAccent(rgb) {
        const base = hexToRgb(THEME.primaryHover, { r: 210, g: 150, b: 86 });
        const mixed = {
            r: rgb.r * 0.62 + base.r * 0.38,
            g: rgb.g * 0.62 + base.g * 0.38,
            b: rgb.b * 0.62 + base.b * 0.38
        };
        const average = (mixed.r + mixed.g + mixed.b) / 3;
        const softened = {
            r: average + (mixed.r - average) * 0.58,
            g: average + (mixed.g - average) * 0.58,
            b: average + (mixed.b - average) * 0.58
        };
        const luma = softened.r * 0.299 + softened.g * 0.587 + softened.b * 0.114;
        const adjustment = luma < 120 ? 120 - luma : (luma > 198 ? 198 - luma : 0);
        return rgbToHex({
            r: softened.r + adjustment,
            g: softened.g + adjustment,
            b: softened.b + adjustment
        });
    }

    function hashNameColor(name) {
        const palette = ['#b98264', '#b8915b', '#9e9d63', '#6f9b86', '#6f93a6', '#817fa9', '#a67791', '#a87968'];
        let hash = 0;
        for (const char of String(name || '')) {
            hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
        }
        return normalizeNameAccent(hexToRgb(palette[Math.abs(hash) % palette.length]));
    }

    function splitHtmlTags(html) {
        return String(html || '').split(/(<[^>]+>)/g);
    }

    function highlightCharacterNames(escapedHtml, accents = []) {
        const entries = (Array.isArray(accents) ? accents : [])
            .map(entry => ({
                name: String(entry?.name || '').trim(),
                color: String(entry?.color || '').trim()
            }))
            .filter(entry => entry.name.length >= 2 && /^#[0-9a-f]{6}$/i.test(entry.color))
            .sort((a, b) => b.name.length - a.name.length);
        if (entries.length === 0) return escapedHtml;

        let result = String(escapedHtml || '');
        for (const entry of entries) {
            const escapedName = escapeHtml(entry.name);
            const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapeRegExp(escapedName)})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
            result = splitHtmlTags(result).map(part => {
                if (part.startsWith('<') && part.endsWith('>')) return part;
                return part.replace(pattern, `$1<span style="color:${entry.color}; font-weight:600;">$2</span>`);
            }).join('');
        }
        return result;
    }

    function boldQuotedHtml(escapedText) {
        return String(escapedText || '').replace(/(&quot;[^&]*(?:&(?!quot;)[^&]*)*&quot;|“[^”]*”)/g, '<b>$1</b>');
    }

    function truncateCleanText(value, maxChars = 0) {
        const text = cleanText(value);
        if (!maxChars || text.length <= maxChars) return text;
        const clipped = text.slice(0, Math.max(1, maxChars - 1));
        return `${clipped.replace(/\s+\S*$/, '') || clipped}.`;
    }

    function truncateStoryText(value, maxChars = 0) {
        const text = String(value || '')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        if (!maxChars || text.length <= maxChars) return text;
        const clipped = text.slice(0, Math.max(1, maxChars - 1));
        return `${clipped.replace(/\s+\S*$/, '') || clipped}.`;
    }

    function htmlBlock(value, options = {}) {
        if (options.preserveParagraphs) {
            const text = truncateStoryText(value, options.maxChars);
            if (!text) return '';
            return text
                .split(/\n{2,}/)
                .map(paragraph => paragraph.replace(/\n/g, ' ').trim())
                .filter(Boolean)
                .map(paragraph => highlightCharacterNames(boldQuotedHtml(escapeHtml(paragraph)), options.characterAccents))
                .join('<br><br>');
        }
        const text = escapeHtml(truncateCleanText(value, options.maxChars));
        if (!text) return '';
        const highlighted = highlightCharacterNames(text, options.characterAccents);
        if (options.emphasis) return `<i>${highlighted}</i>`;
        return highlighted;
    }

    function htmlCssOverrides(extra = [], maxHeight = 0) {
        return [
            'box-sizing: border-box',
            'overflow: hidden',
            'overflow-wrap: break-word',
            'text-rendering: optimizeLegibility',
            maxHeight ? `max-height: ${Math.max(1, Math.floor(maxHeight))}px` : '',
            ...(Array.isArray(extra) ? extra : [])
        ].filter(Boolean);
    }

    function htmlTextStyle(style = {}) {
        return {
            ...textStyle(style),
            fontFamily: style.fontFamily || THEME.fontNarrative,
            wordWrap: true,
            wordWrapWidth: style.wordWrapWidth || 420,
            breakWords: false,
            whiteSpace: 'normal',
            cssOverrides: htmlCssOverrides(style.cssOverrides, style.maxHeight),
            tagStyles: style.tagStyles || {}
        };
    }

    function makeHtmlText(text, style = {}) {
        const value = htmlBlock(text, style);
        if (typeof PIXI.HTMLText === 'function') {
            try {
                const richText = new PIXI.HTMLText({
                    text: value,
                    style: htmlTextStyle(style)
                });
                richText._adventureHtmlText = true;
                richText._adventureHtmlOptions = {
                    emphasis: !!style.emphasis,
                    maxChars: style.maxChars || 0,
                    preserveParagraphs: !!style.preserveParagraphs,
                    characterAccents: Array.isArray(style.characterAccents) ? style.characterAccents : []
                };
                richText._adventureHtmlCssOverrides = Array.isArray(style.cssOverrides) ? style.cssOverrides : [];
                return richText;
            } catch (error) {
                bridge?.log?.warn?.(`[AdventureBook] HTMLText unavailable, falling back to Pixi.Text: ${error?.message || error}`);
            }
        }

        const fallback = makeText(truncateCleanText(text, style.maxChars), {
            ...style,
            wordWrapWidth: style.wordWrapWidth
        });
        fallback._adventureHtmlText = false;
        fallback._adventureHtmlOptions = {
            emphasis: !!style.emphasis,
            maxChars: style.maxChars || 0,
            preserveParagraphs: !!style.preserveParagraphs,
            characterAccents: Array.isArray(style.characterAccents) ? style.characterAccents : []
        };
        return fallback;
    }

    function setHtmlText(displayObject, value, options = {}) {
        const merged = {
            ...(displayObject?._adventureHtmlOptions || {}),
            ...options
        };
        const width = Number(options.width) || Number(displayObject?.style?.wordWrapWidth) || 420;
        const maxChars = Number(merged.maxChars) || 0;
        if (displayObject?._adventureHtmlText) {
            displayObject.text = htmlBlock(value, { ...merged, maxChars });
            displayObject.style.wordWrapWidth = width;
            displayObject.style.cssOverrides = htmlCssOverrides(
                displayObject._adventureHtmlCssOverrides || [],
                Number(options.maxHeight) || 0
            );
            displayObject.style.update?.();
            return;
        }
        const fallbackText = merged.preserveParagraphs
            ? truncateStoryText(value, maxChars).replace(/\n{2,}/g, '\n\n')
            : truncateCleanText(value, maxChars);
        displayObject.text = wrapLines(fallbackText, Math.max(18, Math.floor(width / 9)), options.maxLines || 4);
        if (displayObject?.style) displayObject.style.wordWrapWidth = width;
    }

    function drawRound(graphics, x, y, w, h, radius, fill, alpha = 1, stroke = null) {
        graphics.clear();
        graphics.roundRect(x, y, w, h, radius);
        graphics.fill({ color: fill, alpha });
        if (stroke) graphics.stroke(stroke);
    }

    function drawFill(graphics, x, y, w, h, fill, alpha = 1, stroke = null) {
        graphics.rect(x, y, w, h);
        graphics.fill({ color: fill, alpha });
        if (stroke) graphics.stroke(stroke);
    }

    function drawBookPage(graphics, x, y, w, h, side = 'left') {
        graphics.roundRect(x, y, w, h, 16);
        graphics.fill({ color: PALETTE.parchment, alpha: 0.9 });
        graphics.stroke({ color: PALETTE.line, width: 1, alpha: 0.22 });

        graphics.roundRect(x + 12, y + 12, w - 24, h - 24, 12);
        graphics.fill({ color: PALETTE.parchmentLight, alpha: 0.32 });
        graphics.stroke({ color: PALETTE.brass, width: 1, alpha: 0.12 });

        const edgeX = side === 'left' ? x + w - 26 : x + 12;
        graphics.rect(edgeX, y + 18, 14, h - 36);
        graphics.fill({ color: PALETTE.line, alpha: side === 'left' ? 0.09 : 0.05 });

        for (let i = 0; i < 7; i += 1) {
            const yy = y + 26 + i * ((h - 52) / 6);
            graphics.moveTo(x + 22, yy);
            graphics.lineTo(x + w - 22, yy + (side === 'left' ? -1 : 1));
            graphics.stroke({ color: 0xffffff, width: 1, alpha: 0.025 });
        }
    }

    function drawMetalCorner(graphics, x, y, flipX = false, flipY = false) {
        const sx = flipX ? -1 : 1;
        const sy = flipY ? -1 : 1;
        graphics.roundRect(x - (flipX ? 42 : 0), y - (flipY ? 42 : 0), 42, 42, 6);
        graphics.fill({ color: PALETTE.metalDark, alpha: 0.72 });
        graphics.stroke({ color: PALETTE.line, width: 1, alpha: 0.24 });
        graphics.moveTo(x, y + sy * 20);
        graphics.lineTo(x + sx * 20, y);
        graphics.lineTo(x + sx * 38, y + sy * 4);
        graphics.lineTo(x + sx * 4, y + sy * 38);
        graphics.lineTo(x, y + sy * 20);
        graphics.fill({ color: PALETTE.metal, alpha: 0.42 });
    }

    function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function hashText(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function wrapLines(value, maxChars, maxLines = 3) {
        const words = cleanText(value).split(/\s+/).filter(Boolean);
        if (words.length === 0) return '';

        const lines = [];
        let line = '';
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (next.length <= maxChars) {
                line = next;
                continue;
            }
            if (line) lines.push(line);
            line = word.length > maxChars ? `${word.slice(0, Math.max(1, maxChars - 1))}.` : word;
            if (lines.length >= maxLines) break;
        }
        if (line && lines.length < maxLines) lines.push(line);

        const usedWords = lines.join(' ').split(/\s+/).filter(Boolean).length;
        if (usedWords < words.length && lines.length > 0) {
            const last = lines[lines.length - 1];
            lines[lines.length - 1] = last.length >= maxChars - 1
                ? `${last.slice(0, Math.max(1, maxChars - 1))}.`
                : `${last}.`;
        }
        return lines.join('\n');
    }

    function lineCharBudget(width, fontSize, lines) {
        const averageGlyphWidth = Math.max(6, fontSize * 0.48);
        return Math.max(30, Math.floor((Number(width) || 0) / averageGlyphWidth) * lines);
    }

    function fitSingleLineText(displayObject, maxWidth, minFontSize = 15) {
        if (!displayObject?.style || !Number.isFinite(maxWidth) || maxWidth <= 0) return;
        const original = cleanText(displayObject.text);
        let fontSize = Number(displayObject.style.fontSize) || 18;
        while (displayObject.width > maxWidth && fontSize > minFontSize) {
            fontSize -= 1;
            displayObject.style.fontSize = fontSize;
            displayObject.style.update?.();
        }
        if (displayObject.width <= maxWidth) return;

        const words = original.split(/\s+/).filter(Boolean);
        let candidate = original;
        while (words.length > 1) {
            words.pop();
            candidate = `${words.join(' ')}...`;
            displayObject.text = candidate;
            if (displayObject.width <= maxWidth) return;
        }
        while (candidate.length > 4 && displayObject.width > maxWidth) {
            candidate = `${candidate.slice(0, -4)}...`;
            displayObject.text = candidate;
        }
    }

    function oddsLabel(option) {
        if (option?.resolutionType === 'automatic') return 'Certain';
        const target = Math.max(2, Math.min(20, Math.round(Number(option?.d20Target) || 11)));
        const checkType = cleanText(option?.checkType || 'Check');
        if (payload?.showExactOdds === false) {
            if (target <= 6) return 'Easy Check';
            if (target <= 10) return 'Favorable Check';
            if (target <= 14) return 'Risky Check';
            return 'Hard Check';
        }
        return checkType && checkType !== 'Check' ? `${checkType} ${target}+` : `Check ${target}+`;
    }

    function optionDetailLabel(option) {
        if (!option) return '';
        if (option.resolutionType === 'automatic') {
            return 'Certain / no roll. Safe, low-pressure action with a modest payoff.';
        }
        const reason = cleanDifficultyHint(option.difficultyReason);
        return reason ? `${oddsLabel(option)}. ${reason}` : oddsLabel(option);
    }

    function cleanDifficultyHint(value) {
        const text = cleanText(value);
        if (!text) return '';
        const withoutOutcome = text
            .replace(/\b(critical success|success|failure|fail|outcome|result)\b[:\-].*$/i, '')
            .replace(/\b(you learn|you discover|you hear|reveals?|uncovers?)\b.*$/i, '')
            .trim();
        const firstSentence = withoutOutcome.split(/(?<=[.!?])\s+|;\s+/)[0] || withoutOutcome;
        return truncateCleanText(firstSentence, 150);
    }

    const pendingSpriteAccentKeys = new Set();
    const textureSampleKeys = new WeakMap();
    let nextTextureSampleKey = 1;

    function normalizeCharacterKey(name) {
        return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function addCharacterName(target, name) {
        const clean = String(name || '').replace(/\s+/g, ' ').trim();
        const key = normalizeCharacterKey(clean);
        if (!key || clean.length < 2 || key === 'party' || key === 'the party') return;
        if (!target.has(key)) target.set(key, clean);
    }

    function collectCharacterNames(current = state.current || {}) {
        const names = new Map();
        if (Array.isArray(current.party)) current.party.forEach(name => addCharacterName(names, name));
        if (Array.isArray(current.options)) {
            for (const option of current.options) {
                addCharacterName(names, option?.leadCharacter);
                if (Array.isArray(option?.helperCharacters)) {
                    option.helperCharacters.forEach(name => addCharacterName(names, name));
                }
            }
        }
        return [...names.entries()].map(([key, name]) => ({ key, name }));
    }

    function getActiveSpriteMap() {
        return context?.pixiSpriteManager?.activeSprites
            || context?.runtime?.pixiSpriteManager?.activeSprites
            || window?.VN?.pixiSpriteManager?.activeSprites
            || {};
    }

    function findActiveCharacterSprite(name) {
        const wanted = normalizeCharacterKey(name);
        const activeSprites = getActiveSpriteMap();
        for (const [charName, charObj] of Object.entries(activeSprites || {})) {
            if (normalizeCharacterKey(charName) === wanted) return charObj;
        }
        return null;
    }

    function getCharacterTexture(charObj) {
        return charObj?.layers?.base?.texture
            || charObj?.body?.texture
            || charObj?.texture
            || null;
    }

    function getTextureSampleKey(charObj, texture) {
        const explicitKey = String(
            texture?.uid
            || texture?._uid
            || texture?.label
            || texture?.textureCacheIds?.[0]
            || charObj?.spritePath
            || ''
        );
        if (explicitKey) return explicitKey;
        if (!texture || (typeof texture !== 'object' && typeof texture !== 'function')) return '';
        if (!textureSampleKeys.has(texture)) {
            textureSampleKeys.set(texture, `texture_${nextTextureSampleKey++}`);
        }
        return textureSampleKeys.get(texture);
    }

    async function averageTextureColor(texture) {
        if (!texture || texture.destroyed || !app?.renderer?.extract?.pixels) return null;
        const sampleSprite = new PIXI.Sprite(texture);
        try {
            let extracted = null;
            try {
                extracted = await Promise.resolve(app.renderer.extract.pixels({ target: sampleSprite }));
            } catch (_) {
                extracted = await Promise.resolve(app.renderer.extract.pixels(sampleSprite));
            }
            const pixels = extracted?.pixels || extracted;
            const width = Math.floor(Number(extracted?.width || texture.width || texture.orig?.width || 0));
            const height = Math.floor(Number(extracted?.height || texture.height || texture.orig?.height || 0));
            if (!pixels || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

            const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 1800)));
            let r = 0;
            let g = 0;
            let b = 0;
            let count = 0;
            let fallbackR = 0;
            let fallbackG = 0;
            let fallbackB = 0;
            let fallbackCount = 0;
            for (let y = 0; y < height; y += step) {
                for (let x = 0; x < width; x += step) {
                    const index = (Math.floor(y) * width + Math.floor(x)) * 4;
                    const alpha = pixels[index + 3] || 0;
                    if (alpha < 24) continue;
                    const pr = pixels[index] || 0;
                    const pg = pixels[index + 1] || 0;
                    const pb = pixels[index + 2] || 0;
                    const luma = pr * 0.299 + pg * 0.587 + pb * 0.114;
                    fallbackR += pr;
                    fallbackG += pg;
                    fallbackB += pb;
                    fallbackCount += 1;
                    if (luma < 32 || luma > 238) continue;
                    r += pr;
                    g += pg;
                    b += pb;
                    count += 1;
                }
            }
            const divisor = count || fallbackCount;
            if (!divisor) return null;
            return {
                r: (count ? r : fallbackR) / divisor,
                g: (count ? g : fallbackG) / divisor,
                b: (count ? b : fallbackB) / divisor
            };
        } finally {
            try { sampleSprite.destroy(); } catch (_) {}
        }
    }

    function queueSpriteAccentResolve(character) {
        if (!character?.key || pendingSpriteAccentKeys.has(character.key)) return;
        const charObj = findActiveCharacterSprite(character.name);
        const texture = getCharacterTexture(charObj);
        if (!texture) return;
        const spriteKey = getTextureSampleKey(charObj, texture);
        if (state.characterAccents[character.key]?.source === 'sprite' && state.characterAccents[character.key]?.spriteKey === spriteKey) return;
        pendingSpriteAccentKeys.add(character.key);
        averageTextureColor(texture).then(rgb => {
            pendingSpriteAccentKeys.delete(character.key);
            if (!rgb) return;
            const color = normalizeNameAccent(rgb);
            const currentAccent = state.characterAccents[character.key];
            if (currentAccent?.source === 'sprite' && currentAccent.color === color) return;
            state.characterAccents[character.key] = {
                name: character.name,
                color,
                source: 'sprite',
                spriteKey
            };
            render();
        }).catch(error => {
            pendingSpriteAccentKeys.delete(character.key);
            bridge?.log?.warn?.(`[AdventureBook] Failed to sample sprite color for ${character.name}: ${error?.message || error}`);
        });
    }

    function resolveCharacterAccents(current = state.current || {}) {
        const characters = collectCharacterNames(current);
        for (const character of characters) {
            if (!state.characterAccents[character.key]) {
                state.characterAccents[character.key] = {
                    name: character.name,
                    color: hashNameColor(character.name),
                    source: 'fallback'
                };
            }
            queueSpriteAccentResolve(character);
        }
        return characters
            .map(character => state.characterAccents[character.key])
            .filter(Boolean);
    }

    function getCanonicalStoryText(current = state.current || {}) {
        const storyText = truncateStoryText(current.storyText || '', 0);
        if (storyText) return storyText;
        if (Array.isArray(current.pages)) {
            return current.pages
                .map(page => typeof page === 'string' ? page : page?.body || page?.text || page?.content || '')
                .filter(Boolean)
                .join('\n\n');
        }
        return current.situation || 'The page waits for a decision.';
    }

    function splitStoryBlocks(storyText) {
        const text = truncateStoryText(storyText, 0);
        const blocks = [];
        let cursor = 0;
        for (const rawBlock of text.split(/\n{2,}/)) {
            const foundIndex = text.indexOf(rawBlock, cursor);
            const rawIndex = foundIndex >= 0 ? foundIndex : cursor;
            const trimmed = rawBlock.trim();
            if (trimmed) {
                const leading = rawBlock.indexOf(trimmed);
                blocks.push({
                    text: trimmed,
                    start: Math.max(0, rawIndex + Math.max(0, leading))
                });
            }
            cursor = Math.max(cursor, rawIndex + rawBlock.length);
        }
        return blocks;
    }

    function estimateStoryHeight(text, width) {
        const fontSize = 21;
        const lineHeight = 31;
        const averageGlyphWidth = fontSize * 0.52;
        const charsPerLine = Math.max(24, Math.floor((Number(width) || 360) / averageGlyphWidth));
        return truncateStoryText(text, 0)
            .split(/\n{2,}/)
            .map(block => Math.max(1, Math.ceil(cleanText(block).length / charsPerLine)) * lineHeight)
            .reduce((total, height, index) => total + height + (index > 0 ? lineHeight * 0.55 : 0), 0);
    }

    function measureStoryHeight(text, layout = {}) {
        if (!text) return 0;
        const width = Number(layout.textWidth) || 420;
        if (typeof PIXI.HTMLText === 'function') {
            let richText = null;
            try {
                richText = new PIXI.HTMLText({
                    text: htmlBlock(text, { preserveParagraphs: true }),
                    style: htmlTextStyle({
                        fontFamily: THEME.fontNarrative,
                        fontSize: 21,
                        fill: PALETTE.ink,
                        lineHeight: 31,
                        wordWrapWidth: width,
                        preserveParagraphs: true,
                        cssOverrides: ['letter-spacing: 0.01em']
                    })
                });
                const bounds = typeof richText.getLocalBounds === 'function' ? richText.getLocalBounds() : null;
                const measured = Math.max(Number(richText.height) || 0, Number(bounds?.height) || 0);
                if (Number.isFinite(measured) && measured > 0) return measured;
            } catch (_) {
            } finally {
                try { richText?.destroy?.(); } catch (_) {}
            }
        }
        return estimateStoryHeight(text, width);
    }

    function storyFitsLayout(text, layout = {}) {
        const maxHeight = Math.max(80, (Number(layout.storyHeight) || 420) - 22);
        return measureStoryHeight(text, layout) <= maxHeight;
    }

    function splitBlockByWords(block, startOffset, layout, targetChars) {
        const source = String(block || '');
        const words = [...source.matchAll(/\S+/g)];
        if (words.length === 0) return [];
        const chunks = [];
        let index = 0;
        while (index < words.length) {
            const chunkStart = words[index].index;
            let low = 1;
            let high = words.length - index;
            let best = 1;
            while (low <= high) {
                const count = Math.floor((low + high) / 2);
                const lastWord = words[index + count - 1];
                const end = lastWord.index + lastWord[0].length;
                const candidate = source.slice(chunkStart, end).trim();
                if (candidate.length <= targetChars * 1.2 && storyFitsLayout(candidate, layout)) {
                    best = count;
                    low = count + 1;
                } else {
                    high = count - 1;
                }
            }
            const selected = words.slice(index, index + best);
            const lastSelected = selected[selected.length - 1];
            const end = lastSelected.index + lastSelected[0].length;
            chunks.push({
                body: source.slice(selected[0].index, end).trim(),
                start: startOffset + selected[0].index
            });
            index += best;
        }
        return chunks;
    }

    function splitBoundaryCandidates(text) {
        const source = String(text || '');
        const indexes = new Set();
        for (const match of source.matchAll(/\n{2,}/g)) indexes.add(match.index + match[0].length);
        for (const match of source.matchAll(/[.!?]["')\]]?\s+/g)) indexes.add(match.index + match[0].length);
        for (const match of source.matchAll(/[,;:]["')\]]?\s+/g)) indexes.add(match.index + match[0].length);
        for (const match of source.matchAll(/\s+/g)) indexes.add(match.index + match[0].length);
        return [...indexes]
            .filter(index => index > 0 && index < source.length)
            .sort((a, b) => a - b);
    }

    function boundaryPenalty(source, index) {
        const before = String(source || '').slice(Math.max(0, index - 6), index);
        if (/\n{2,}\s*$/.test(before)) return 0;
        if (/[.!?]["')\]]?\s*$/.test(before)) return 0.18;
        if (/[,;:]["')\]]?\s*$/.test(before)) return 0.46;
        return 0.82;
    }

    function pageSlice(source, start, end) {
        const raw = String(source || '').slice(start, end);
        const leading = raw.length - raw.trimStart().length;
        return {
            body: raw.trim(),
            start: Math.max(0, start + leading)
        };
    }

    function nextReadableOffset(source, offset) {
        const suffix = String(source || '').slice(offset);
        return offset + (suffix.length - suffix.trimStart().length);
    }

    function findFallbackWordBreak(source, start, maxEnd, layout) {
        const limit = Math.max(start + 1, Math.min(String(source || '').length, Math.floor(maxEnd)));
        const segment = String(source || '').slice(start, limit);
        const words = [...segment.matchAll(/\S+/g)];
        let best = 0;
        for (const word of words) {
            const end = start + word.index + word[0].length;
            const candidate = pageSlice(source, start, end).body;
            if (!candidate) continue;
            if (storyFitsLayout(candidate, layout)) best = end;
            else break;
        }
        return best || limit;
    }

    function findBalancedBreak(source, start, idealEnd, minEnd, maxEnd, layout, candidates) {
        const storyLength = String(source || '').length;
        const lower = Math.max(start + 1, Math.min(storyLength - 1, Math.floor(minEnd)));
        const upper = Math.max(lower, Math.min(storyLength - 1, Math.floor(maxEnd)));
        const ideal = Math.max(lower, Math.min(upper, Math.floor(idealEnd)));
        const range = Math.max(1, upper - lower);
        let best = null;

        for (const candidate of candidates) {
            if (candidate <= start || candidate < lower || candidate > upper) continue;
            const body = pageSlice(source, start, candidate).body;
            if (!body || !storyFitsLayout(body, layout)) continue;
            const distanceScore = Math.abs(candidate - ideal) / range;
            const score = distanceScore + boundaryPenalty(source, candidate);
            if (!best || score < best.score) best = { index: candidate, score };
        }
        if (best) return best.index;

        for (let i = candidates.length - 1; i >= 0; i -= 1) {
            const candidate = candidates[i];
            if (candidate <= start || candidate > upper) continue;
            const body = pageSlice(source, start, candidate).body;
            if (body && storyFitsLayout(body, layout)) return candidate;
        }

        return findFallbackWordBreak(source, start, upper, layout);
    }

    function buildBalancedPages(source, pageCount, fullLayout, finalLayout, reserveFinalChoices, fullBudget, finalBudget) {
        const candidates = splitBoundaryCandidates(source);
        const pages = [];
        const offsets = [];
        const storyLength = String(source || '').length;
        let start = nextReadableOffset(source, 0);
        const finalWeight = reserveFinalChoices
            ? Math.max(0.24, Math.min(0.48, finalBudget / Math.max(1, fullBudget)))
            : 1;

        for (let pageIndex = 0; pageIndex < pageCount - 1; pageIndex += 1) {
            const remainingChars = Math.max(0, storyLength - start);
            const normalPagesAfter = Math.max(0, pageCount - pageIndex - 2);
            const remainingWeight = 1 + normalPagesAfter + finalWeight;
            const idealLen = remainingChars / remainingWeight;
            const minLen = Math.max(80, Math.min(fullBudget * 0.46, idealLen * 0.64));
            const maxLen = Math.max(minLen + 12, Math.min(fullBudget * 1.08, idealLen * 1.42));
            const minRemaining = normalPagesAfter * Math.max(90, fullBudget * 0.34)
                + Math.max(70, finalBudget * 0.32);
            let minEnd = start + minLen;
            let maxEnd = Math.min(start + maxLen, storyLength - minRemaining);
            if (maxEnd <= minEnd) {
                maxEnd = Math.min(storyLength - 1, start + maxLen);
                minEnd = Math.max(start + 1, Math.min(minEnd, maxEnd - 1));
            }
            const idealEnd = start + idealLen;
            const breakIndex = findBalancedBreak(source, start, idealEnd, minEnd, maxEnd, fullLayout, candidates);
            const page = pageSlice(source, start, breakIndex);
            if (page.body) {
                pages.push({ body: page.body });
                offsets.push(page.start);
            }
            start = nextReadableOffset(source, breakIndex);
        }

        const finalPage = pageSlice(source, start, storyLength);
        pages.push({ body: finalPage.body || source || 'The page waits for a decision.' });
        offsets.push(finalPage.start || 0);
        return { pages, offsets };
    }

    function paginateBalancedStory(storyText, layout = {}) {
        const source = String(storyText || '').trim();
        if (!source) return null;
        const reserveFinalChoices = layout?.reserveFinalChoices === true && Number(layout?.finalStoryHeight) > 0;
        const decisionStoryHeight = reserveFinalChoices
            ? Math.max(96, Number(layout.finalStoryHeight) - 72)
            : Number(layout?.storyHeight) || 420;
        const fullLayout = { ...layout, storyHeight: Number(layout?.storyHeight) || 420 };
        const finalLayout = reserveFinalChoices
            ? { ...layout, storyHeight: decisionStoryHeight }
            : fullLayout;
        const fullBudget = estimatePageCharBudget(fullLayout.textWidth || 420, fullLayout.storyHeight || 420, false);
        const measuredFinalBudget = estimatePageCharBudget(finalLayout.textWidth || 420, finalLayout.storyHeight || 420, reserveFinalChoices);
        const finalBudget = reserveFinalChoices
            ? Math.max(120, Math.min(measuredFinalBudget, Math.floor(fullBudget * 0.48)))
            : fullBudget;
        const pageCount = reserveFinalChoices
            ? Math.max(1, Math.ceil(Math.max(0, source.length - finalBudget) / Math.max(1, fullBudget)) + 1)
            : Math.max(1, Math.ceil(source.length / Math.max(1, fullBudget)));
        const pageCountAttempts = [pageCount];
        if (pageCount > 1) pageCountAttempts.push(pageCount - 1);
        for (let extra = 1; extra <= 7; extra += 1) pageCountAttempts.push(pageCount + extra);
        let bestFit = null;

        for (const attemptedPageCount of pageCountAttempts) {
            const result = buildBalancedPages(source, attemptedPageCount, fullLayout, finalLayout, reserveFinalChoices, fullBudget, finalBudget);
            const finalPage = result.pages[result.pages.length - 1]?.body || '';
            const pagesFit = result.pages.every((page, index) => storyFitsLayout(page.body, index === result.pages.length - 1 ? finalLayout : fullLayout));
            const finalFits = !reserveFinalChoices || storyFitsLayout(finalPage, finalLayout);
            const penultimate = result.pages.length > 2 ? cleanText(result.pages[result.pages.length - 2]?.body || '') : '';
            const orphanPenultimate = reserveFinalChoices && result.pages.length > 2 && penultimate.length < Math.min(180, fullBudget * 0.28);
            if (pagesFit && finalFits && !orphanPenultimate) return result;
            if (pagesFit && finalFits && !bestFit) bestFit = result;
        }

        if (bestFit) return bestFit;
        return buildBalancedPages(source, pageCount, fullLayout, finalLayout, reserveFinalChoices, fullBudget, finalBudget);
    }

    function splitForFinalChoices(text, startOffset, fullLayout, finalLayout) {
        const source = String(text || '').trim();
        if (!source) return [];
        if (storyFitsLayout(source, finalLayout)) return [{ body: source, start: startOffset }];

        for (const splitIndex of splitBoundaryCandidates(source)) {
            const rawSuffix = source.slice(splitIndex);
            const suffixLeading = rawSuffix.length - rawSuffix.trimStart().length;
            const prefix = source.slice(0, splitIndex).trimEnd();
            const suffix = rawSuffix.trimStart();
            if (!prefix || !suffix) continue;
            if (!storyFitsLayout(suffix, finalLayout)) continue;

            const fullTargetChars = estimatePageCharBudget(fullLayout?.textWidth || 420, fullLayout?.storyHeight || 420, false);
            const prefixChunks = storyFitsLayout(prefix, fullLayout)
                ? [{ body: prefix, start: startOffset }]
                : splitBlockByWords(prefix, startOffset, fullLayout, fullTargetChars);
            return [
                ...prefixChunks,
                { body: suffix, start: startOffset + splitIndex + suffixLeading }
            ];
        }

        const finalTargetChars = estimatePageCharBudget(finalLayout?.textWidth || 420, finalLayout?.storyHeight || 420, true);
        return splitBlockByWords(source, startOffset, finalLayout, finalTargetChars);
    }

    function estimatePageCharBudget(width, height, hasChoices = false) {
        const fontSize = 21;
        const lineHeight = 31;
        const averageGlyphWidth = fontSize * 0.52;
        const charsPerLine = Math.max(24, Math.floor((Number(width) || 360) / averageGlyphWidth));
        const lines = Math.max(5, Math.floor((Number(height) || 320) / lineHeight));
        const paragraphPenalty = hasChoices ? 0.82 : 0.9;
        return Math.max(260, Math.floor(charsPerLine * lines * paragraphPenalty));
    }

    function paginationCacheKey(storyText, layout = {}) {
        return [
            hashText(storyText),
            Math.round(Number(layout?.textWidth) || 0),
            Math.round(Number(layout?.storyHeight) || 0),
            Math.round(Number(layout?.finalStoryHeight) || 0),
            layout?.reserveFinalChoices === true ? 1 : 0,
            layout?.reserveChoices === true ? 1 : 0
        ].join(':');
    }

    function cachePaginationResult(cacheKey, pages, offsets) {
        state.pageCacheKey = cacheKey;
        state.pageCachePages = Array.isArray(pages) ? pages : [];
        state.pageCacheOffsets = Array.isArray(offsets) ? offsets : [];
        state.pageStartOffsets = state.pageCacheOffsets;
        return state.pageCachePages;
    }

    function paginateForLayout(current, layout = null) {
        const storyText = getCanonicalStoryText(current);
        const cacheKey = paginationCacheKey(storyText, layout || {});
        if (
            cacheKey === state.pageCacheKey
            && Array.isArray(state.pageCachePages)
            && Array.isArray(state.pageCacheOffsets)
        ) {
            state.pageStartOffsets = state.pageCacheOffsets;
            return state.pageCachePages;
        }
        const balanced = paginateBalancedStory(storyText, layout || {});
        if (balanced?.pages?.length) {
            return cachePaginationResult(cacheKey, balanced.pages, balanced.offsets);
        }
        const reservesChoiceSpace = layout?.reserveChoices === true;
        const targetChars = estimatePageCharBudget(layout?.textWidth || 420, layout?.storyHeight || 420, reservesChoiceSpace);
        const blocks = splitStoryBlocks(storyText);
        const pages = [];
        const offsets = [];
        let currentPage = '';
        let currentStart = 0;

        for (const block of blocks) {
            const prefix = currentPage ? '\n\n' : '';
            const next = `${currentPage}${prefix}${block.text}`;
            if ((next.length <= targetChars * 1.15 && storyFitsLayout(next, layout)) || !currentPage) {
                if (!currentPage) currentStart = block.start;
                currentPage = next;
                if (storyFitsLayout(currentPage, layout)) {
                    continue;
                }
                const chunks = splitBlockByWords(block.text, block.start, layout, targetChars);
                if (chunks.length <= 1) continue;
                currentPage = chunks[0].body;
                currentStart = chunks[0].start;
                offsets.push(currentStart);
                pages.push({ body: currentPage });
                for (const chunk of chunks.slice(1, -1)) {
                    offsets.push(chunk.start);
                    pages.push({ body: chunk.body });
                }
                const lastChunk = chunks[chunks.length - 1];
                currentPage = lastChunk.body;
                currentStart = lastChunk.start;
                continue;
            }
            offsets.push(currentStart);
            pages.push({ body: currentPage });
            if (storyFitsLayout(block.text, layout)) {
                currentStart = block.start;
                currentPage = block.text;
                continue;
            }
            const chunks = splitBlockByWords(block.text, block.start, layout, targetChars);
            for (const chunk of chunks.slice(0, -1)) {
                offsets.push(chunk.start);
                pages.push({ body: chunk.body });
            }
            const lastChunk = chunks[chunks.length - 1] || { body: block.text, start: block.start };
            currentStart = lastChunk.start;
            currentPage = lastChunk.body;
        }
        if (currentPage || pages.length === 0) {
            offsets.push(currentStart);
            pages.push({ body: currentPage || storyText || current?.situation || 'The page waits for a decision.' });
        }

        const finalStoryHeight = Number(layout?.finalStoryHeight) || 0;
        if (layout?.reserveFinalChoices === true && finalStoryHeight > 0 && pages.length > 0) {
            // Leave real breathing room above the choices; otherwise CSS texture clipping can hide the final line.
            const decisionStoryHeight = Math.max(96, finalStoryHeight - 72);
            const finalLayout = { ...layout, storyHeight: decisionStoryHeight };
            const lastIndex = pages.length - 1;
            const lastPage = pages[lastIndex];
            if (!storyFitsLayout(lastPage.body, finalLayout)) {
                const chunks = splitForFinalChoices(lastPage.body, offsets[lastIndex] || 0, layout, finalLayout);
                if (chunks.length > 1) {
                    pages.splice(lastIndex, 1, ...chunks.map(chunk => ({ body: chunk.body })));
                    offsets.splice(lastIndex, 1, ...chunks.map(chunk => chunk.start));
                } else if (cleanText(lastPage.body)) {
                    pages.push({ body: '', decisionPage: true });
                    offsets.push((offsets[lastIndex] || 0) + lastPage.body.length);
                }
            }
        }

        return cachePaginationResult(cacheKey, pages, offsets);
    }

    function getReadOffset() {
        const offsets = Array.isArray(state.pageStartOffsets) ? state.pageStartOffsets : [0];
        return offsets[Math.max(0, Math.min(state.currentPageIndex || 0, offsets.length - 1))] || 0;
    }

    function restorePageFromOffset(offset) {
        const offsets = Array.isArray(state.pageStartOffsets) ? state.pageStartOffsets : [0];
        let index = 0;
        for (let i = 0; i < offsets.length; i += 1) {
            if (offset >= offsets[i]) index = i;
            else break;
        }
        state.currentPageIndex = Math.max(0, Math.min(index, Math.max(0, offsets.length - 1)));
    }

    function getPages(current = state.current || {}, layout = null) {
        if (layout) return paginateForLayout(current, layout);
        const pages = Array.isArray(current.pages)
            ? current.pages
                .map(page => typeof page === 'string' ? { body: page } : { body: page?.body || page?.text || page?.content || '' })
                .filter(page => page.body)
            : [];
        if (pages.length > 0) return pages;
        return [{
            title: current.title || 'Adventure Book',
            body: current.situation || 'The page waits for a decision.'
        }];
    }

    function clampPageIndex(spreadCount = null) {
        const count = Number.isFinite(spreadCount) ? spreadCount : getSpreadCount();
        state.currentPageIndex = Math.max(0, Math.min(state.currentPageIndex || 0, Math.max(0, count - 1)));
        return state.currentPageIndex;
    }

    function getSpreadCount(current = state.current || {}, layout = null) {
        if (!layout && Array.isArray(state.pageStartOffsets) && state.pageStartOffsets.length > 0) {
            return state.pageStartOffsets.length;
        }
        return Math.max(1, getPages(current, layout).length);
    }

    function getCurrentSpreadPages(current = state.current || {}, layout = null) {
        const pages = getPages(current, layout);
        const spreadIndex = clampPageIndex(pages.length);
        return {
            left: pages[spreadIndex] || null,
            right: null,
            pages,
            spreadIndex,
            spreadCount: Math.max(1, pages.length)
        };
    }

    function isLastPage() {
        return clampPageIndex() >= getSpreadCount(displayedState()) - 1;
    }

    function turnSpread(delta) {
        if (state.busy) return;
        const spreadCount = getSpreadCount(displayedState());
        const nextIndex = Math.max(0, Math.min(spreadCount - 1, (state.currentPageIndex || 0) + delta));
        if (nextIndex === state.currentPageIndex) return;
        hideOptionTooltip();
        state.currentPageIndex = nextIndex;
        render();
    }

    function delay(ms) {
        return new Promise(resolve => window.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    }

    function waitForSocketReady(timeout = 6000) {
        if (!socket || typeof socket.once !== 'function') return Promise.resolve(true);
        if (socket.connected === true) return Promise.resolve(true);
        if (!Object.prototype.hasOwnProperty.call(socket, 'connected')) return Promise.resolve(true);

        return new Promise(resolve => {
            let settled = false;
            const finish = (ready) => {
                if (settled) return;
                settled = true;
                try { socket.off?.('connect', onConnect); } catch (_) {}
                window.clearTimeout(timer);
                resolve(ready);
            };
            const onConnect = () => finish(true);
            const timer = window.setTimeout(() => finish(socket.connected === true), Math.max(250, timeout));
            socket.once('connect', onConnect);
        });
    }

    async function socketRequest(eventName, data, timeout = 120000) {
        await waitForSocketReady(Math.min(8000, Math.max(1000, timeout)));
        if (bridge?.socket?.request) return await bridge.socket.request(eventName, data, timeout);
        if (socket?.emitReceive) return await socket.emitReceive(eventName, data, timeout);
        return { success: false, error: 'socket_request_unavailable' };
    }

    function createRequestId(prefix = 'ab') {
        const random = Math.random().toString(36).slice(2, 10);
        return `${prefix}_${Date.now().toString(36)}_${random}`;
    }

    async function cgSocketRequest(eventName, data, timeout = 300000) {
        await waitForSocketReady(Math.min(8000, Math.max(1000, timeout)));
        if (!socket || typeof socket.emit !== 'function' || typeof socket.on !== 'function') {
            bridge?.log?.warn?.(`[AdventureBook] CG socket unavailable for ${eventName}. socket=${!!socket} emit=${typeof socket?.emit} on=${typeof socket?.on}`);
            return { success: false, error: 'socket_request_unavailable' };
        }

        const requestId = createRequestId('ab_cg');
        const responseEvent = `${eventName}-response`;
        bridge?.log?.info?.(`[AdventureBook] CG socket request ${requestId}: listening for ${responseEvent}, then emitting ${eventName}.`);
        return await new Promise(resolve => {
            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                try { socket.off?.(responseEvent, handler); } catch (_) {}
                window.clearTimeout(timer);
                bridge?.log?.info?.(`[AdventureBook] CG socket request ${requestId}: finished success=${result?.success === true} error=${result?.error || result?.cg?.error || ''}.`);
                resolve(result || { success: false, error: 'empty_response', requestId });
            };
            const handler = (result) => {
                if (result?.requestId && result.requestId !== requestId) {
                    bridge?.log?.info?.(`[AdventureBook] CG socket request ${requestId}: ignored response for ${result.requestId}.`);
                    return;
                }
                bridge?.log?.info?.(`[AdventureBook] CG socket request ${requestId}: received response.`);
                finish(result);
            };
            const timer = window.setTimeout(() => {
                bridge?.log?.warn?.(`[AdventureBook] CG socket request ${requestId}: timed out after ${timeout}ms.`);
                finish({ success: false, error: 'timeout', requestId });
            }, Math.max(1000, Number(timeout) || 300000));

            socket.on(responseEvent, handler);
            socket.emit(eventName, { ...(data || {}), requestId });
        });
    }

    function clientRandomInt(min, max) {
        const lower = Math.ceil(Number(min) || 0);
        const upper = Math.floor(Number(max) || lower);
        return Math.floor(Math.random() * (upper - lower + 1)) + lower;
    }

    function outcomeLabel(outcome) {
        return {
            critical_failure: 'Critical Failure',
            failure: 'Failure',
            success: 'Success',
            critical_success: 'Critical Success',
            automatic: 'Certain'
        }[String(outcome || '').toLowerCase()] || 'Result';
    }

    function outcomePalette(outcome) {
        const key = String(outcome || '').toLowerCase();
        if (key === 'critical_success') return { main: PALETTE.copper, glow: 0xffef9c, deep: 0x3b2a05, text: 0xfff3bd, shake: 0 };
        if (key === 'success') return { main: PALETTE.blue, glow: 0x8cd3ff, deep: 0x102637, text: 0xd6f2ff, shake: 0 };
        if (key === 'critical_failure') return { main: PALETTE.danger, glow: 0xff4f6d, deep: 0x3a0610, text: 0xffc4ce, shake: 9 };
        if (key === 'failure') return { main: PALETTE.rust, glow: 0xff9d55, deep: 0x351b09, text: 0xffd7b5, shake: 4 };
        return { main: PALETTE.copper, glow: 0xffef9c, deep: 0x2b240d, text: 0xfff0b6, shake: 0 };
    }

    function drawPolygon(graphics, points, fill, alpha = 1, stroke = null) {
        if (!Array.isArray(points) || points.length < 3) return;
        const flatPoints = [];
        for (const point of points) flatPoints.push(point.x, point.y);
        graphics.poly(flatPoints, true);
        graphics.fill({ color: fill, alpha });
        if (stroke) graphics.stroke(stroke);
    }

    function clearDiceOverlay() {
        state.rollAnimationActive = false;
        diceOverlayLayer.visible = false;
        try {
            if (typeof gsap !== 'undefined') gsap.killTweensOf?.(diceOverlayLayer);
        } catch (_) {}
        for (const child of diceOverlayLayer.removeChildren()) {
            try { child.destroy?.({ children: true }); } catch (_) {}
        }
    }

    function configureFixedTextBox(text, width, height, options = {}) {
        if (!text?.style) return;
        text.anchor?.set?.(0, 0);
        text.style.wordWrap = true;
        text.style.wordWrapWidth = Math.max(1, Math.floor(width));
        text.style.align = options.align || 'center';
        if (options.lineHeight) text.style.lineHeight = options.lineHeight;
        if (options.fontSize) text.style.fontSize = options.fontSize;
        if (options.fill !== undefined) text.style.fill = options.fill;
        if (options.fontWeight) text.style.fontWeight = options.fontWeight;
        if (options.stroke !== undefined) text.style.stroke = options.stroke;
        text.style.update?.();
        text.x = Math.round(options.x ?? 0);
        text.y = Math.round(options.y ?? Math.max(0, (height - (options.lineHeight || options.fontSize || 14)) / 2));
    }

    function drawD20(graphics, radius, palette, phase = 0, settled = false) {
        const r = Math.max(60, Number(radius) || 120);
        const lean = settled ? 0 : Math.sin(phase * 1.3) * r * 0.035;
        const squash = settled ? 1 : 0.98 + Math.cos(phase * 1.7) * 0.025;
        const p = (x, y) => ({ x: x + lean * (1 - Math.abs(y / r) * 0.35), y: y * squash });
        const top = p(0, -r * 0.96);
        const upperLeft = p(-r * 0.62, -r * 0.5);
        const upperRight = p(r * 0.62, -r * 0.5);
        const left = p(-r * 0.84, -r * 0.03);
        const right = p(r * 0.84, -r * 0.03);
        const lowerLeft = p(-r * 0.5, r * 0.58);
        const lowerRight = p(r * 0.5, r * 0.58);
        const bottom = p(0, r * 0.92);
        const faceTopLeft = p(-r * 0.5, -r * 0.52);
        const faceTopRight = p(r * 0.5, -r * 0.52);
        const faceBottomRight = p(r * 0.48, r * 0.42);
        const faceBottomLeft = p(-r * 0.48, r * 0.42);
        const dice = {
            edge: shadeColor(PALETTE.line, 0.22),
            hot: shadeColor(PALETTE.rust, 0.16),
            bright: shadeColor(PALETTE.copper, 0.12),
            mid: mixColor(PALETTE.copper, PALETTE.rust, 0.55),
            side: mixColor(PALETTE.rust, PALETTE.brass, 0.36),
            dark: shadeColor(PALETTE.rust, -0.34),
            shadow: shadeColor(PALETTE.leatherDark, -0.12),
            shine: shadeColor(PALETTE.copper, 0.5)
        };
        graphics.clear();
        drawPolygon(graphics, [top, upperRight, right, lowerRight, bottom, lowerLeft, left, upperLeft], dice.shadow, 0.98, {
            color: dice.edge,
            width: 2.8,
            alpha: 0.8
        });

        drawPolygon(graphics, [top, upperLeft, upperRight], dice.hot, 0.98);
        drawPolygon(graphics, [upperLeft, left, lowerLeft, faceBottomLeft, faceTopLeft], dice.bright, 0.95);
        drawPolygon(graphics, [upperRight, faceTopRight, faceBottomRight, lowerRight, right], dice.mid, 0.95);
        drawPolygon(graphics, [lowerLeft, bottom, lowerRight, faceBottomRight, faceBottomLeft], dice.dark, 0.96);
        drawPolygon(graphics, [faceTopLeft, faceTopRight, faceBottomRight, faceBottomLeft], mixColor(dice.bright, dice.side, 0.34), settled ? 1 : 0.94, {
            color: dice.shine,
            width: 1.6,
            alpha: settled ? 0.2 : 0.12
        });

        drawPolygon(graphics, [faceBottomLeft, faceBottomRight, lowerRight, lowerLeft], dice.shadow, 0.055);

        graphics.moveTo(top.x, top.y);
        graphics.lineTo(faceTopLeft.x, faceTopLeft.y);
        graphics.moveTo(bottom.x, bottom.y);
        graphics.lineTo(lowerRight.x, lowerRight.y);
        graphics.moveTo(faceTopLeft.x, faceTopLeft.y);
        graphics.lineTo(faceTopRight.x, faceTopRight.y);
        graphics.lineTo(faceBottomRight.x, faceBottomRight.y);
        graphics.lineTo(faceBottomLeft.x, faceBottomLeft.y);
        graphics.lineTo(faceTopLeft.x, faceTopLeft.y);
        graphics.stroke({ color: dice.shadow, width: 1.55, alpha: 0.34 });

        graphics.moveTo(upperLeft.x + r * 0.06, upperLeft.y + r * 0.07);
        graphics.lineTo(top.x + r * 0.05, top.y + r * 0.18);
        graphics.lineTo(upperRight.x - r * 0.12, upperRight.y + r * 0.08);
        graphics.stroke({ color: dice.shine, width: 2.2, alpha: 0.14 });
    }

    function makeCanvasTextSprite() {
        const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
        sprite.anchor.set(0.5);
        sprite._adventureCanvasTextTexture = null;
        return sprite;
    }

    function setCanvasTextSprite(sprite, value, options = {}) {
        if (!sprite) return;
        const text = String(value || '');
        const dpr = 4;
        const fontSize = Math.max(24, Number(options.fontSize) || 96);
        const fontFamily = options.fontFamily || THEME.fontTitle;
        const fontWeight = options.fontWeight || '900';
        const fill = colorIntToCss(options.fill ?? PALETTE.ink, options.fillAlpha ?? 1);
        const stroke = colorIntToCss(options.stroke ?? shadeColor(PALETTE.leatherDark, -0.18), options.strokeAlpha ?? 0.65);
        const strokeWidth = Math.max(0, Number(options.strokeWidth) || 0);
        const padding = Math.ceil((strokeWidth + fontSize * 0.22) * dpr);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let drawFontSize = fontSize;
        ctx.font = `${fontWeight} ${drawFontSize * dpr}px ${fontFamily}`;
        const maxWidth = Math.max(0, Number(options.maxWidth) || 0);
        if (maxWidth > 0) {
            const measured = ctx.measureText(text).width / dpr;
            if (measured > maxWidth) {
                drawFontSize = Math.max(24, drawFontSize * (maxWidth / measured));
                ctx.font = `${fontWeight} ${drawFontSize * dpr}px ${fontFamily}`;
            }
        }

        const metrics = ctx.measureText(text || ' ');
        const textW = Math.ceil(metrics.width);
        const textH = Math.ceil(drawFontSize * dpr * 1.18);
        canvas.width = Math.max(8, textW + padding * 2);
        canvas.height = Math.max(8, textH + padding * 2);

        ctx.font = `${fontWeight} ${drawFontSize * dpr}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        const x = canvas.width / 2;
        const y = canvas.height / 2 + (Number(options.yOffset) || 0) * dpr;
        if (strokeWidth > 0) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth * dpr;
            ctx.strokeText(text, x, y);
        }
        ctx.fillStyle = fill;
        ctx.fillText(text, x, y);

        try {
            if (sprite._adventureCanvasTextTexture && sprite._adventureCanvasTextTexture !== PIXI.Texture.EMPTY) {
                sprite._adventureCanvasTextTexture.destroy(true);
            }
        } catch (_) {}
        const texture = PIXI.Texture.from(canvas);
        sprite.texture = texture;
        sprite._adventureCanvasTextTexture = texture;
        sprite.scale.set(1 / dpr);
    }

    function makeDiceParticle(layer, centerX, centerY, palette, intense = false) {
        const particle = new PIXI.Graphics();
        const size = intense ? clientRandomInt(3, 8) : clientRandomInt(2, 5);
        particle.circle(0, 0, size);
        particle.fill({ color: Math.random() > 0.45 ? palette.glow : palette.main, alpha: 0.82 });
        particle.x = centerX;
        particle.y = centerY;
        particle.alpha = 0.9;
        layer.addChild(particle);
        const angle = Math.random() * Math.PI * 2;
        const distance = intense ? clientRandomInt(160, 300) : clientRandomInt(80, 180);
        const duration = intense ? 0.9 + Math.random() * 0.55 : 0.65 + Math.random() * 0.4;
        if (typeof gsap !== 'undefined') {
            gsap.to(particle, {
                x: centerX + Math.cos(angle) * distance,
                y: centerY + Math.sin(angle) * distance + (intense ? clientRandomInt(-40, 80) : clientRandomInt(-20, 60)),
                alpha: 0,
                duration,
                ease: 'power2.out',
                onComplete: () => {
                    try { particle.destroy(); } catch (_) {}
                }
            });
        }
    }

    function animateRollOverlay(rollResult) {
        const roll = Math.max(1, Math.min(20, Math.round(Number(rollResult?.roll) || 1)));
        const palette = outcomePalette(rollResult?.outcome);
        clearDiceOverlay();
        state.rollAnimationActive = true;
        diceOverlayLayer.visible = true;
        render();

        const { width, height } = screenSize();
        const centerX = width / 2;
        const centerY = height * 0.45;
        const stage = new PIXI.Container();
        stage.x = centerX;
        stage.y = centerY;
        diceOverlayLayer.addChild(stage);

        const aura = new PIXI.Graphics();
        aura.circle(0, 0, 158);
        aura.fill({ color: shadeColor(PALETTE.copper, 0.16), alpha: 0.09 });
        stage.addChild(aura);

        const shadow = new PIXI.Graphics();
        shadow.ellipse(0, 112, 112, 28);
        shadow.fill({ color: 0x000000, alpha: 0.36 });
        stage.addChild(shadow);

        const die = new PIXI.Container();
        stage.addChild(die);
        const dieGraphics = new PIXI.Graphics();
        die.addChild(dieGraphics);
        const numberSprite = makeCanvasTextSprite();
        numberSprite.y = 6;
        numberSprite.alpha = 0;
        die.addChild(numberSprite);

        const bannerSprite = makeCanvasTextSprite();
        bannerSprite.y = 210;
        bannerSprite.alpha = 0;
        stage.addChild(bannerSprite);

        const throwAngle = Math.random() * Math.PI * 2;
        const throwDistance = Math.max(220, Math.min(width, height) * 0.42);
        const spawnX = Math.cos(throwAngle) * throwDistance;
        const spawnY = Math.sin(throwAngle) * throwDistance;
        const throwEase = value => 1 - Math.pow(1 - Math.max(0, Math.min(1, value)), 2.65);
        const proxy = { progress: 0 };
        const update = () => {
            const p = proxy.progress;
            const travel = throwEase(p);
            const remaining = 1 - travel;
            const landing = travel;
            const motion = 1 - landing;
            const spin = p * Math.PI * 9.5;
            const jumpCycle = Math.max(0, Math.cos(p * Math.PI * 8));
            const jumpScale = 1 + 0.3 * jumpCycle * motion * (0.35 + remaining * 0.65);
            const tumble = Math.sin(p * Math.PI * 8) * motion;
            numberSprite.alpha = 0;
            drawD20(dieGraphics, 118, palette, spin, p >= 0.995);
            die.rotation = motion * (spin * 0.22 + Math.sin(spin * 0.3) * 0.18);
            die.scale.x = jumpScale * (1 + motion * Math.sin(spin) * 0.055);
            die.scale.y = jumpScale * (1 + motion * Math.cos(spin * 0.85) * 0.045);
            die.x = spawnX * remaining + Math.sin(spin * 0.7) * 26 * (1 - p);
            die.y = spawnY * remaining - Math.abs(Math.sin(p * Math.PI * 5.5)) * 72 * (1 - p) + tumble * 10;
            aura.alpha = 0.07 + Math.sin(spin) * 0.02;
            aura.scale.set(0.86 + p * 0.28);
            shadow.x = die.x;
            shadow.y = die.y * 0.22;
            shadow.scale.x = 1.2 - Math.abs(die.y) / 220;
            shadow.alpha = 0.28 + p * 0.12;
        };

        return new Promise(resolve => {
            const settle = () => {
                proxy.progress = 1;
                update();
                setCanvasTextSprite(numberSprite, String(roll), {
                    fontFamily: THEME.fontTitle,
                    fontSize: String(roll).length > 1 ? 122 : 144,
                    fontWeight: '900',
                    fill: PALETTE.ink,
                    stroke: shadeColor(PALETTE.leatherDark, -0.18),
                    strokeWidth: 7,
                    strokeAlpha: 0.58,
                    maxWidth: 146,
                    yOffset: -2
                });
                numberSprite.alpha = 0;
                setCanvasTextSprite(bannerSprite, outcomeLabel(rollResult?.outcome), {
                    fontFamily: THEME.fontTitle,
                    fontSize: 92,
                    fontWeight: '900',
                    fill: palette.text,
                    stroke: shadeColor(PALETTE.leatherDark, -0.18),
                    strokeWidth: 7,
                    strokeAlpha: 0.72,
                    maxWidth: 760,
                    yOffset: -2
                });
                bannerSprite.alpha = 0;
                drawD20(dieGraphics, 118, palette, 0, true);
                die.rotation = 0;
                die.scale.set(1);
                die.x = 0;
                die.y = 0;
                const intense = rollResult?.outcome === 'critical_success' || rollResult?.outcome === 'critical_failure';
                for (let i = 0; i < (intense ? 34 : 18); i += 1) {
                    makeDiceParticle(diceOverlayLayer, centerX, centerY, palette, intense);
                }
                if (typeof gsap !== 'undefined') {
                    gsap.fromTo(die.scale, { x: 1.24, y: 0.78 }, { x: 1, y: 1, duration: 0.42, ease: 'elastic.out(1, 0.45)' });
                    const numberScaleX = numberSprite.scale.x;
                    const numberScaleY = numberSprite.scale.y;
                    const bannerScaleX = bannerSprite.scale.x;
                    const bannerScaleY = bannerSprite.scale.y;
                    gsap.fromTo(numberSprite.scale, {
                        x: numberScaleX * 0.72,
                        y: numberScaleY * 0.72
                    }, {
                        x: numberScaleX,
                        y: numberScaleY,
                        duration: 0.28,
                        delay: 0.08,
                        ease: 'back.out(2.2)'
                    });
                    gsap.fromTo(bannerSprite.scale, {
                        x: bannerScaleX * 0.82,
                        y: bannerScaleY * 0.82
                    }, {
                        x: bannerScaleX,
                        y: bannerScaleY,
                        duration: 0.32,
                        delay: 0.1,
                        ease: 'back.out(1.9)'
                    });
                    gsap.to(numberSprite, { alpha: 1, duration: 0.22, delay: 0.08, ease: 'power2.out' });
                    gsap.to(bannerSprite, { alpha: 1, y: 226, duration: 0.32, ease: 'power2.out' });
                    if (palette.shake > 0) {
                        gsap.to(stage, {
                            x: centerX + palette.shake,
                            duration: 0.05,
                            yoyo: true,
                            repeat: 7,
                            ease: 'power1.inOut'
                        });
                    }
                    gsap.to(diceOverlayLayer, {
                        alpha: 0,
                        delay: 3.2,
                        duration: 0.6,
                        ease: 'power2.in',
                        onComplete: () => {
                            diceOverlayLayer.alpha = 1;
                            clearDiceOverlay();
                            resolve();
                        }
                    });
                } else {
                    numberSprite.alpha = 1;
                    bannerSprite.alpha = 1;
                    window.setTimeout(() => {
                        clearDiceOverlay();
                        resolve();
                    }, 3600);
                }
            };

            if (typeof gsap !== 'undefined') {
                gsap.to(proxy, {
                    progress: 1,
                    duration: 2.325,
                    ease: 'power3.out',
                    onUpdate: update,
                    onComplete: settle
                });
            } else {
                const started = Date.now();
                const timer = window.setInterval(() => {
                    proxy.progress = Math.min(1, (Date.now() - started) / 2325);
                    update();
                    if (proxy.progress >= 1) {
                        window.clearInterval(timer);
                        settle();
                    }
                }, 33);
            }
        });
    }

    function animateCertainOverlay() {
        clearDiceOverlay();
        state.rollAnimationActive = true;
        diceOverlayLayer.visible = true;
        const { width, height } = screenSize();
        const palette = outcomePalette('automatic');
        const text = makeText('Certain', {
            fontFamily: THEME.fontTitle,
            fontSize: 42,
            fill: palette.text,
            align: 'center',
            fontWeight: '900'
        });
        text.anchor.set(0.5);
        text.x = width / 2;
        text.y = height * 0.45;
        text.alpha = 0;
        diceOverlayLayer.addChild(text);
        return new Promise(resolve => {
            if (typeof gsap !== 'undefined') {
                gsap.timeline({
                    onComplete: () => {
                        clearDiceOverlay();
                        resolve();
                    }
                })
                    .to(text, { alpha: 1, y: text.y - 14, duration: 0.22, ease: 'power2.out' })
                    .to(text, { alpha: 0, y: text.y - 36, delay: 0.42, duration: 0.28, ease: 'power2.in' });
            } else {
                text.alpha = 1;
                window.setTimeout(() => {
                    clearDiceOverlay();
                    resolve();
                }, 800);
            }
        });
    }

    async function debugRollAnimation(outcome, roll) {
        if (state.busy || state.cgBusy || state.rollAnimationActive) return;
        state.rollAnimationActive = true;
        state.status = `Debug roll: ${outcomeLabel(outcome)}`;
        state.statusIsError = false;
        render();
        await animateRollOverlay({ outcome, roll });
        state.status = `Debug roll complete: ${outcomeLabel(outcome)} (${roll})`;
        state.statusIsError = false;
        render();
    }

    function makeButton(label, width, height, onPress, variant = 'plain') {
        const button = new PIXI.Container();
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button._label = label;
        button._width = width;
        button._height = height;
        button._variant = variant;
        button._disabled = false;

        const bg = new PIXI.Graphics();
        button.addChild(bg);

        const text = makeText(label, {
            fontSize: 15,
            fill: variant === 'primary' ? pixiColor(THEME.textInverse) : PALETTE.ink,
            align: 'center',
            fontWeight: '700',
            lineHeight: 17
        });
        button.addChild(text);
        configureFixedTextBox(text, width - 12, height, {
            x: 6,
            fontSize: 15,
            lineHeight: 17,
            fill: variant === 'primary' ? pixiColor(THEME.textInverse) : PALETTE.ink,
            fontWeight: '700'
        });

        button.redraw = () => {
            text.text = button._label;
            configureFixedTextBox(text, width - 12, height, {
                x: 6,
                fontSize: 15,
                lineHeight: 17,
                fill: variant === 'primary' ? pixiColor(THEME.textInverse) : PALETTE.ink,
                fontWeight: '700'
            });
            const fill = variant === 'primary'
                ? pixiColor(THEME.primary)
                : variant === 'quiet'
                    ? PALETTE.parchmentLight
                    : PALETTE.parchmentDark;
            const stroke = variant === 'primary' ? PALETTE.line : PALETTE.brass;
            drawRound(bg, 0, 0, width, height, 8, fill, button._disabled ? 0.45 : 0.94, {
                color: stroke,
                width: 1,
                alpha: variant === 'primary' ? 0.72 : 0.28
            });
            bg.moveTo(9, height - 7);
            bg.lineTo(width - 9, height - 7);
            bg.stroke({ color: 0xffffff, width: 1, alpha: variant === 'primary' ? 0.26 : 0.08 });
            text.alpha = button._disabled ? 0.52 : 1;
        };
        button.setDisabled = (disabled) => {
            button._disabled = !!disabled;
            button.eventMode = button._disabled ? 'none' : 'static';
            button.cursor = button._disabled ? 'default' : 'pointer';
            button.redraw();
        };
        button.on('pointerdown', () => {
            if (!button._disabled && typeof onPress === 'function') onPress();
        });
        button.redraw();
        return button;
    }

    function makeBookToggle(onPress) {
        const control = new PIXI.Container();
        control.eventMode = 'static';
        control.cursor = 'pointer';
        control._width = 72;
        control._height = 42;
        control._open = true;

        const bg = new PIXI.Graphics();
        const text = makeHtmlText('BOOK', {
            fontFamily: THEME.fontMain,
            fontSize: 11,
            fill: PALETTE.ink,
            fontWeight: '800',
            letterSpacing: 1,
            align: 'center',
            lineHeight: 13,
            maxChars: 32,
            cssOverrides: ['overflow: visible', 'white-space: normal']
        });
        control.addChild(bg, text);

        control.redraw = () => {
            const label = control._open ? 'Hide' : 'Show Adventure Book';
            control._width = control._open ? 72 : 190;
            text.style.fontSize = control._open ? 11 : 12;
            text.style.lineHeight = control._open ? 13 : 14;
            text.style.fill = PALETTE.ink;
            text.style.fontWeight = '800';
            text.style.align = 'center';
            setHtmlText(text, label, {
                width: control._width - 14,
                maxHeight: control._height,
                maxLines: 2,
                maxChars: 32
            });
            text.style.update?.();
            text.x = 7;
            text.y = Math.round((control._height - (control._open ? 13 : 28)) / 2);
            bg.clear();
            bg.roundRect(0, 0, control._width, control._height, 10);
            bg.fill({ color: PALETTE.parchmentLight, alpha: control._open ? 0.58 : 0.78 });
            bg.stroke({ color: PALETTE.line, width: 1, alpha: control._open ? 0.28 : 0.48 });
            bg.rect(control._width - 4, 7, 2, control._height - 14);
            bg.fill({ color: PALETTE.copper, alpha: control._open ? 0.36 : 0.64 });
            text.alpha = control._open ? 0.72 : 0.95;
        };

        control.on('pointerdown', () => {
            if (typeof onPress === 'function') onPress();
        });
        control.redraw();
        return control;
    }

    function makePageTurnControl(label, onPress) {
        const control = new PIXI.Container();
        control._disabled = false;
        control._width = 180;
        control._height = 28;

        const hit = new PIXI.Graphics();
        hit.roundRect(0, 0, control._width, control._height, 14);
        hit.fill({ color: PALETTE.parchmentLight, alpha: 0.001 });
        control.addChild(hit);

        const glyph = makeText(label, {
            fontFamily: THEME.fontTitle,
            fontSize: 18,
            fill: PALETTE.rust,
            fontWeight: '600',
            align: 'center'
        });
        glyph.anchor.set(0.5);
        glyph.x = control._width / 2;
        glyph.y = control._height / 2 - 1;
        control.addChild(glyph);

        const flourish = new PIXI.Graphics();
        control.addChild(flourish);

        control.setDisabled = (disabled) => {
            control._disabled = !!disabled;
            control.eventMode = control._disabled ? 'none' : 'static';
            control.cursor = control._disabled ? 'default' : 'pointer';
            control.alpha = control._disabled ? 0.18 : 0.78;
            flourish.clear();
            if (!control._disabled) {
                const midY = Math.round(control._height / 2);
                const centerGap = 18;
                flourish.moveTo(2, midY);
                flourish.lineTo(control._width / 2 - centerGap, midY);
                flourish.moveTo(control._width / 2 + centerGap, midY);
                flourish.lineTo(control._width - 2, midY);
                flourish.stroke({ color: PALETTE.line, width: 2, alpha: 0.36 });
                flourish.moveTo(control._width / 2 - 34, midY + 6);
                flourish.lineTo(control._width / 2 + 34, midY + 6);
                flourish.stroke({ color: PALETTE.rust, width: 1, alpha: 0.16 });
            }
        };
        control.on('pointerdown', () => {
            if (!control._disabled && typeof onPress === 'function') onPress();
        });
        control.setDisabled(false);
        return control;
    }

    const root = new PIXI.Container();
    root.sortableChildren = true;
    root.zIndex = 999998;
    stage.sortableChildren = true;
    stage.addChild(root);

    const backdropFocus = {
        filter: null,
        snapshots: []
    };
    const immersiveMode = {
        controlsVisibleBeforeBook: null,
        fallbackLocks: [],
        hiddenUiLocks: [],
        hiddenNavigationTimer: null,
        watchdogTimer: null,
        engaged: false,
        styleInjected: false
    };

    function ensureImmersiveHudStyle() {
        if (immersiveMode.styleInjected || typeof document === 'undefined') return;
        immersiveMode.styleInjected = true;
        if (document.getElementById('adventure-book-immersive-style')) return;
        const style = document.createElement('style');
        style.id = 'adventure-book-immersive-style';
        style.textContent = `
body.adventure-book-immersive-active #vn-hud-container,
body.adventure-book-immersive-active #vn-hud-slot,
body.adventure-book-immersive-active #dialogue-container,
body.adventure-book-immersive-active #controls,
body.adventure-book-immersive-active #prev-chapter-nav,
body.adventure-book-immersive-active #next-chapter-nav,
body.adventure-book-immersive-active #user-input-container,
body.adventure-book-immersive-active #input-hint,
body.adventure-book-immersive-active #mini-music-player,
body.adventure-book-immersive-active #vn-settings-btn,
body.adventure-book-immersive-active #dialogue-index-indicator,
body.adventure-book-immersive-active #status-notification-container,
body.adventure-book-immersive-active #toggle-controls-btn,
body.adventure-book-immersive-active #world-location-container,
body.adventure-book-immersive-active #fullscreen-btn,
body.adventure-book-immersive-active .inputs-wrapper {
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
}
`;
        document.head?.appendChild(style);
    }

    function setAdventureBookHudSuppressed(suppressed, restoreVisible = true) {
        try {
            ensureImmersiveHudStyle();
            document?.body?.classList?.toggle('adventure-book-immersive-active', !!suppressed);
        } catch (_) { }
        try {
            window?.dispatchEvent?.(new CustomEvent('vn:ui-visibility-toggled', {
                detail: { show: suppressed ? false : restoreVisible !== false }
            }));
        } catch (_) { }
    }

    function getControlsVisibleSnapshot() {
        try {
            const settings = bridge?.player?.getSettings?.();
            const value = settings?.interface?.show_controls;
            return typeof value === 'boolean' ? value : null;
        } catch (_) {
            return null;
        }
    }

    function acquireImmersiveLocks() {
        if (immersiveMode.fallbackLocks.length) return;
        for (const hide of [
            () => bridge?.player?.ui?.hideDialogue?.(),
            () => bridge?.player?.ui?.hideControls?.(),
            () => bridge?.player?.ui?.hideInput?.()
        ]) {
            try {
                const lock = hide();
                if (lock && typeof lock.release === 'function') immersiveMode.fallbackLocks.push(lock);
            } catch (_) { }
        }
    }

    function applyImmersiveMode() {
        setAdventureBookHudSuppressed(true);
        try {
            bridge?.player?.ui?.setImmersive?.(true);
        } catch (_) {
        }
        acquireImmersiveLocks();
    }

    function startImmersiveWatchdog() {
        if (immersiveMode.watchdogTimer) clearInterval(immersiveMode.watchdogTimer);
        immersiveMode.watchdogTimer = setInterval(() => {
            if (!state.visible || !immersiveMode.engaged) return;
            applyImmersiveMode();
        }, 300);
    }

    function engageImmersiveMode() {
        if (immersiveMode.engaged) return;
        immersiveMode.controlsVisibleBeforeBook = getControlsVisibleSnapshot();
        applyImmersiveMode();
        startImmersiveWatchdog();
        immersiveMode.engaged = true;
    }

    function restoreImmersiveMode() {
        if (!immersiveMode.engaged) return;
        if (immersiveMode.watchdogTimer) {
            clearInterval(immersiveMode.watchdogTimer);
            immersiveMode.watchdogTimer = null;
        }
        for (const lock of immersiveMode.fallbackLocks.splice(0)) {
            try { lock.release?.(); } catch (_) { }
        }
        if (immersiveMode.controlsVisibleBeforeBook !== null) {
            try {
                bridge?.player?.ui?.setImmersive?.(!immersiveMode.controlsVisibleBeforeBook);
            } catch (_) { }
            setAdventureBookHudSuppressed(false, immersiveMode.controlsVisibleBeforeBook);
        } else {
            try {
                bridge?.player?.ui?.setImmersive?.(false);
            } catch (_) { }
            setAdventureBookHudSuppressed(false, true);
        }
        immersiveMode.controlsVisibleBeforeBook = null;
        immersiveMode.engaged = false;
    }

    function restoreVnHudAfterFinalHandoff() {
        stopHiddenNavigationWatch();
        releaseHiddenUiLocks();
        if (immersiveMode.watchdogTimer) {
            clearInterval(immersiveMode.watchdogTimer);
            immersiveMode.watchdogTimer = null;
        }
        for (const lock of immersiveMode.fallbackLocks.splice(0)) {
            try { lock.release?.(); } catch (_) { }
        }
        try { bridge?.takeover?.setInputPassthrough?.(false); } catch (_) { }
        try { bridge?.player?.ui?.setImmersive?.(false); } catch (_) { }
        setAdventureBookHudSuppressed(false, true);
        immersiveMode.controlsVisibleBeforeBook = null;
        immersiveMode.engaged = false;
        state.hiddenFromDialogueIndex = null;
        state.hiddenLeftOriginalDialogue = false;
        restoreBackdropFocus();
    }

    function forceVnInputVisibleForHiddenBook() {
        try { bridge?.takeover?.setInputPassthrough?.(true); } catch (_) { }
        restoreImmersiveMode();
        setAdventureBookHudSuppressed(false, true);
        if (immersiveMode.hiddenUiLocks.length > 0) return;
        for (const show of [
            () => bridge?.player?.ui?.showDialogue?.(),
            () => bridge?.player?.ui?.showControls?.(),
            () => bridge?.player?.ui?.showInput?.()
        ]) {
            try {
                const lock = show();
                if (lock && typeof lock.release === 'function') immersiveMode.hiddenUiLocks.push(lock);
            } catch (_) { }
        }
    }

    function releaseHiddenUiLocks() {
        for (const lock of immersiveMode.hiddenUiLocks.splice(0)) {
            try { lock.release?.(); } catch (_) { }
        }
    }

    function getCurrentDialogueIndex() {
        try {
            const value = bridge?.player?.getState?.()?.currentIndex;
            return Number.isInteger(value) ? value : null;
        } catch (_) {
            return null;
        }
    }

    function stopHiddenNavigationWatch() {
        if (!immersiveMode.hiddenNavigationTimer) return;
        clearInterval(immersiveMode.hiddenNavigationTimer);
        immersiveMode.hiddenNavigationTimer = null;
    }

    function startHiddenNavigationWatch() {
        stopHiddenNavigationWatch();
        immersiveMode.hiddenNavigationTimer = setInterval(() => {
            if (state.visible || !Number.isInteger(state.hiddenFromDialogueIndex)) return;
            const currentIndex = getCurrentDialogueIndex();
            if (!Number.isInteger(currentIndex)) return;
            if (currentIndex !== state.hiddenFromDialogueIndex) {
                state.hiddenLeftOriginalDialogue = true;
                return;
            }
            if (state.hiddenLeftOriginalDialogue) {
                setBookVisible(true);
            }
        }, 300);
    }

    function applyBackdropFocus() {
        if (backdropFocus.filter || !PIXI.BlurFilter) return;
        const pixiApp = context?.pixiApp || {};
        const target = pixiApp.world || pixiApp.viewport;
        if (!target) return;

        const blur = new PIXI.BlurFilter();
        blur.blur = 4;
        blur.quality = 3;
        backdropFocus.filter = blur;
        backdropFocus.snapshots.push({
            target,
            filters: Array.isArray(target.filters) ? [...target.filters] : target.filters || null,
            alpha: Number.isFinite(target.alpha) ? target.alpha : 1
        });
        target.filters = [...(Array.isArray(target.filters) ? target.filters : []), blur];
        target.alpha = Math.min(Number.isFinite(target.alpha) ? target.alpha : 1, 0.58);
    }

    function restoreBackdropFocus() {
        for (const snapshot of backdropFocus.snapshots) {
            if (!snapshot?.target || snapshot.target.destroyed) continue;
            snapshot.target.filters = snapshot.filters;
            snapshot.target.alpha = snapshot.alpha;
        }
        backdropFocus.snapshots = [];
        try { backdropFocus.filter?.destroy?.(); } catch (_) {}
        backdropFocus.filter = null;
    }

    function setBookVisible(visible) {
        const nextVisible = !!visible;
        if (state.visible === nextVisible) {
            render();
            return;
        }

        state.visible = nextVisible;
        hideOptionTooltip();
        if (nextVisible) {
            try { bridge?.takeover?.setInputPassthrough?.(false); } catch (_) { }
            stopHiddenNavigationWatch();
            releaseHiddenUiLocks();
            state.hiddenFromDialogueIndex = null;
            state.hiddenLeftOriginalDialogue = false;
            if (state.status === 'Book hidden. VN controls are available.') {
                state.status = '';
            }
        } else {
            state.hiddenFromDialogueIndex = getCurrentDialogueIndex();
            state.hiddenLeftOriginalDialogue = false;
            state.status = 'Book hidden. VN controls are available.';
            forceVnInputVisibleForHiddenBook();
            startHiddenNavigationWatch();
        }
        render();
    }

    applyBackdropFocus();
    engageImmersiveMode();
    bridge?.lifecycle?.onDispose?.(() => {
        stopHiddenNavigationWatch();
        try { bridge?.takeover?.setInputPassthrough?.(false); } catch (_) { }
        releaseHiddenUiLocks();
        restoreImmersiveMode();
        restoreBackdropFocus();
        try { root.destroy({ children: true }); } catch (_) {}
    });

    const veil = new PIXI.Graphics();
    veil.eventMode = 'static';
    root.addChild(veil);

    const panel = new PIXI.Container();
    root.addChild(panel);

    const diceOverlayLayer = new PIXI.Container();
    diceOverlayLayer.visible = false;
    diceOverlayLayer.eventMode = 'none';
    diceOverlayLayer.zIndex = 1000;
    root.addChild(diceOverlayLayer);

    const toggleButton = makeBookToggle(() => {
        setBookVisible(!state.visible);
    });
    root.addChild(toggleButton);
    const hiddenHintText = makeHtmlText('You can continue without the adventure book', {
        fontFamily: THEME.fontMain,
        fontSize: 16,
        fill: PALETTE.inkSoft,
        align: 'center',
        lineHeight: 21,
        fontWeight: '700',
        stroke: { color: PALETTE.veil, width: 4, alpha: 0.82 },
        maxChars: 80,
        cssOverrides: ['overflow: visible']
    });
    root.addChild(hiddenHintText);

    const panelShadow = new PIXI.Graphics();
    const panelBg = new PIXI.Graphics();
    const headerBand = new PIXI.Graphics();
    const storyBox = new PIXI.Graphics();
    const optionBox = new PIXI.Graphics();
    const actionBox = new PIXI.Graphics();
    const historyBox = new PIXI.Graphics();
    const diceCircle = new PIXI.Graphics();
    const bookFurniture = new PIXI.Graphics();
    const pageWash = new PIXI.Graphics();
    const pageDots = new PIXI.Graphics();
    const leftPageEdge = new PIXI.Graphics();
    const rightPageEdge = new PIXI.Graphics();
    panel.addChild(panelShadow, panelBg, bookFurniture, pageWash, headerBand, storyBox, optionBox, actionBox, historyBox, diceCircle);

    const cgSprite = new PIXI.Sprite();
    cgSprite.visible = false;
    panel.addChild(cgSprite);
    const cgMask = new PIXI.Graphics();
    panel.addChild(cgMask);
    cgSprite.mask = cgMask;
    const cgThemeTint = new PIXI.Graphics();
    cgThemeTint.visible = false;
    cgThemeTint.mask = cgMask;
    panel.addChild(cgThemeTint);

    const kicker = makeHtmlText('ADVENTURE BOOK', {
        fontFamily: THEME.fontMain,
        fontSize: 14,
        fill: PALETTE.copper,
        fontWeight: '700',
        letterSpacing: 1,
        lineHeight: 18,
        maxChars: 30,
        cssOverrides: ['overflow: visible', 'white-space: nowrap']
    });
    const titleText = makeHtmlText('', { fontFamily: THEME.fontTitle, fontSize: 27, fill: PALETTE.ink, fontWeight: '700', lineHeight: 30, maxChars: 64 });
    const situationText = makeHtmlText('', {
        fontFamily: THEME.fontNarrative,
        fontSize: 21,
        fill: PALETTE.ink,
        lineHeight: 31,
        maxChars: 1600,
        preserveParagraphs: true,
        cssOverrides: ['letter-spacing: 0.01em']
    });
    const rightStoryText = makeHtmlText('', { fontFamily: THEME.fontMain, fontSize: 18, fill: PALETTE.inkSoft, lineHeight: 25, maxChars: 520 });
    const stakesText = makeHtmlText('', { fontFamily: THEME.fontMain, fontSize: 15, fill: PALETTE.rust, fontStyle: 'italic', lineHeight: 21, emphasis: true, maxChars: 150 });
    const actionLabel = makeText('Choose an approach', { fontFamily: THEME.fontMain, fontSize: 16, fill: PALETTE.rust, fontWeight: '700' });
    const illustrationText = makeHtmlText('', { fontFamily: THEME.fontMain, fontSize: 16, fill: PALETTE.inkSoft, align: 'center', lineHeight: 24, maxChars: 260 });
    illustrationText.anchor.set(0.5);
    const rollText = makeText('D20', { fontFamily: THEME.fontTitle, fontSize: 32, fill: PALETTE.rust, align: 'center', fontWeight: '700' });
    rollText.anchor.set(0.5);
    const historyTitle = makeText('Recent result', { fontFamily: THEME.fontMain, fontSize: 15, fill: PALETTE.copper, fontWeight: '700' });
    const historyText = makeHtmlText('', { fontFamily: THEME.fontMain, fontSize: 14, fill: PALETTE.inkSoft, lineHeight: 20, maxChars: 280 });
    const statusText = makeHtmlText('', { fontFamily: THEME.fontMain, fontSize: 14, fill: PALETTE.copper, lineHeight: 19, maxChars: 140 });
    const tooltipLayer = new PIXI.Container();
    tooltipLayer.visible = false;
    tooltipLayer.zIndex = 50;
    tooltipLayer.eventMode = 'none';
    const tooltipBg = new PIXI.Graphics();
    const tooltipText = makeHtmlText('', { fontFamily: THEME.fontMain, fontSize: 16, fill: PALETTE.cream, lineHeight: 22, maxChars: 260 });
    tooltipBg.eventMode = 'none';
    tooltipText.eventMode = 'none';
    tooltipLayer.addChild(tooltipBg, tooltipText);
    let tooltipLayout = {
        panelX: 0,
        panelY: 0,
        panelWidth: 0,
        panelHeight: 0,
        textW: 420,
        hasChoices: false
    };
    const progressText = makeHtmlText('', {
        fontFamily: THEME.fontNarrative,
        fontSize: 21,
        fill: PALETTE.inkSoft,
        lineHeight: 31,
        cssOverrides: ['overflow: visible', 'padding: 0 18px']
    });
    const loadingText = makeHtmlText('', { fontFamily: THEME.fontTitle, fontSize: 22, fill: PALETTE.cream, align: 'center', fontWeight: '700', lineHeight: 28, maxChars: 90 });
    loadingText.anchor.set(0.5);
    const transitionIndicator = new PIXI.Graphics();
    let transitionAnimationFrame = 0;

    panel.addChild(
        kicker,
        titleText,
        situationText,
        rightStoryText,
        stakesText,
        actionLabel,
        illustrationText,
        rollText,
        historyTitle,
        historyText,
        statusText,
        progressText,
        pageDots,
        loadingText,
        transitionIndicator
    );

    const optionLayer = new PIXI.Container();
    const buttonLayer = new PIXI.Container();
    const debugRollLayer = new PIXI.Container();
    const chapterRailLayer = new PIXI.Container();
    const pageEdgeLayer = new PIXI.Container();
    const pageNavLayer = new PIXI.Container();
    panel.addChild(chapterRailLayer, optionLayer, buttonLayer, debugRollLayer, pageNavLayer, pageEdgeLayer);
    panel.addChild(tooltipLayer);
    pageEdgeLayer.addChild(leftPageEdge, rightPageEdge);

    const prevPageButton = makePageTurnControl('‹', () => turnSpread(-1));
    const nextPageButton = makePageTurnControl('›', () => turnSpread(1));
    pageNavLayer.addChild(prevPageButton, nextPageButton);

    const rebuildButton = makeButton('Rebuild', 92, 36, () => rebuild(false), 'quiet');
    const rebuildCgButton = makeButton('Rebuild + CG', 124, 36, () => rebuild(true), 'quiet');
    const generateCgButton = makeButton('Generate CG', 132, 36, () => generateCgForCurrentSession({ manual: true }), 'primary');
    const debugRollButtons = [
        makeButton('Crit Fail', 78, 30, () => debugRollAnimation('critical_failure', 1), 'quiet'),
        makeButton('Fail', 56, 30, () => debugRollAnimation('failure', 7), 'quiet'),
        makeButton('Success', 76, 30, () => debugRollAnimation('success', 14), 'quiet'),
        makeButton('Crit Success', 108, 30, () => debugRollAnimation('critical_success', 20), 'quiet')
    ];
    const hideButton = makeButton('Hide', 80, 36, () => {
        setBookVisible(false);
    }, 'quiet');
    const continueButton = makeButton('Continue', 118, 36, finalize, 'primary');
    panel.addChild(generateCgButton);
    buttonLayer.addChild(rebuildButton, rebuildCgButton, hideButton, continueButton);
    debugRollLayer.addChild(...debugRollButtons);
    rebuildButton.visible = state.debugMode === true;
    rebuildCgButton.visible = state.debugMode === true;
    debugRollLayer.visible = state.debugMode === true;
    leftPageEdge.eventMode = 'static';
    leftPageEdge.cursor = 'w-resize';
    leftPageEdge.on('pointerdown', () => turnSpread(-1));
    rightPageEdge.eventMode = 'static';
    rightPageEdge.cursor = 'e-resize';
    rightPageEdge.on('pointerdown', () => turnSpread(1));

    function setBusy(busy, message = '') {
        state.busy = !!busy;
        state.status = message || state.status || '';
        state.statusIsError = false;
        render();
    }

    function setStatus(text, isError = false) {
        state.status = text || '';
        state.statusIsError = !!isError;
        render();
    }

    function setChapterTransition(active, message = '') {
        state.chapterTransitionActive = !!active;
        state.chapterTransitionMessage = active
            ? (message || 'Writing the next scene...')
            : '';
        if (active) {
            state.status = '';
            state.statusIsError = false;
            hideOptionTooltip();
            if (!transitionAnimationFrame) {
                const animate = () => {
                    if (!state.chapterTransitionActive) {
                        transitionAnimationFrame = 0;
                        transitionIndicator.clear();
                        return;
                    }
                    render();
                    transitionAnimationFrame = requestAnimationFrame(animate);
                };
                transitionAnimationFrame = requestAnimationFrame(animate);
            }
        } else if (transitionAnimationFrame) {
            cancelAnimationFrame(transitionAnimationFrame);
            transitionAnimationFrame = 0;
            transitionIndicator.clear();
        }
    }

    function hideOptionTooltip() {
        state.optionHoverText = '';
        tooltipLayer.visible = false;
        tooltipBg.clear();
    }

    function positionOptionTooltip(localX, localY) {
        if (!tooltipLayer.visible) return;
        if (Number.isFinite(localX)) state.optionTooltipX = localX;
        if (Number.isFinite(localY)) state.optionTooltipY = localY;

        const tooltipW = Number(tooltipLayer._tooltipW) || Math.min(500, Math.max(280, tooltipLayout.textW * 0.5));
        const tooltipH = Number(tooltipLayer._tooltipH) || 72;
        const desiredX = (Number(state.optionTooltipX) || tooltipLayout.panelX + 80) + 18;
        const desiredY = (Number(state.optionTooltipY) || tooltipLayout.panelY + 80) + 18;
        const minX = tooltipLayout.panelX + 18;
        const maxX = tooltipLayout.panelX + tooltipLayout.panelWidth - tooltipW - 18;
        const minY = tooltipLayout.panelY + 18;
        const maxY = tooltipLayout.panelY + tooltipLayout.panelHeight - tooltipH - 18;
        tooltipLayer.x = Math.max(minX, Math.min(maxX, desiredX));
        tooltipLayer.y = Math.max(minY, Math.min(maxY, desiredY));
    }

    function drawOptionTooltip(text) {
        const tooltipW = Math.min(500, Math.max(280, tooltipLayout.textW * 0.46));
        setHtmlText(tooltipText, text, {
            width: tooltipW - 28,
            maxChars: lineCharBudget(tooltipW - 28, 16, 3),
            maxHeight: 88,
            maxLines: 3
        });
        const tooltipH = Math.max(52, Math.min(108, tooltipText.height + 22));
        tooltipLayer._tooltipW = tooltipW;
        tooltipLayer._tooltipH = tooltipH;
        tooltipBg.clear();
        tooltipBg.roundRect(0, 0, tooltipW, tooltipH, 10);
        tooltipBg.fill({ color: PALETTE.leatherDark, alpha: 0.94 });
        tooltipBg.stroke({ color: PALETTE.line, width: 1, alpha: 0.42 });
        tooltipBg.moveTo(14, 8);
        tooltipBg.lineTo(tooltipW - 14, 8);
        tooltipBg.stroke({ color: PALETTE.rust, width: 1, alpha: 0.34 });
        tooltipText.x = 14;
        tooltipText.y = 16;
    }

    function showOptionTooltip(text, localX, localY) {
        const nextText = String(text || '').trim();
        if (!nextText || !tooltipLayout.hasChoices) {
            hideOptionTooltip();
            return;
        }
        const shouldRedraw = state.optionHoverText !== nextText || !tooltipLayer.visible;
        state.optionHoverText = nextText;
        if (shouldRedraw) drawOptionTooltip(nextText);
        tooltipLayer.visible = true;
        positionOptionTooltip(localX, localY);
    }

    function renderChapterRail(panelX, pageY, pageH, leftX) {
        chapterRailLayer.removeChildren();
        const chapters = Array.isArray(state.chapters) ? state.chapters : [];
        if (chapters.length <= 1) return;

        const buttonSize = 34;
        const gap = 10;
        const railX = Math.max(panelX + 12, leftX - buttonSize - 18);
        const totalH = chapters.length * buttonSize + Math.max(0, chapters.length - 1) * gap;
        const railY = Math.round(pageY + Math.max(34, (pageH - totalH) * 0.12));
        const selected = Number(displayedChapter()?.chapterIndex || state.selectedChapterIndex);
        const latest = Number(latestChapterIndex());

        chapters.forEach((chapter, index) => {
            const chapterIndex = Number(chapter.chapterIndex || index + 1);
            const isSelected = chapterIndex === selected;
            const isLatest = chapterIndex === latest;
            const button = new PIXI.Container();
            button.x = railX;
            button.y = railY + index * (buttonSize + gap);
            button.eventMode = state.busy ? 'none' : 'static';
            button.cursor = state.busy ? 'default' : 'pointer';

            const bg = new PIXI.Graphics();
            bg.roundRect(0, 0, buttonSize, buttonSize, 9);
            bg.fill({
                color: isSelected ? PALETTE.parchmentDark : PALETTE.leatherDark,
                alpha: isSelected ? 0.86 : 0.52
            });
            bg.stroke({
                color: isSelected ? PALETTE.copper : PALETTE.line,
                width: isSelected ? 2 : 1,
                alpha: isSelected ? 0.8 : 0.32
            });
            if (isLatest && !isReadOnlyMode()) {
                bg.circle(buttonSize - 7, 7, 3);
                bg.fill({ color: PALETTE.copper, alpha: 0.86 });
            }
            button.addChild(bg);

            const label = makeHtmlText(String(chapterIndex), {
                fontFamily: THEME.fontMain,
                fontSize: 15,
                fill: isSelected ? PALETTE.ink : PALETTE.inkSoft,
                fontWeight: '700',
                align: 'center',
                lineHeight: 20,
                cssOverrides: ['overflow: visible']
            });
            setHtmlText(label, String(chapterIndex), {
                width: buttonSize,
                maxHeight: 24,
                maxLines: 1
            });
            label.x = 0;
            label.y = Math.round((buttonSize - 20) / 2);
            button.addChild(label);

            button.on('pointerdown', () => selectChapter(chapterIndex));
            chapterRailLayer.addChild(button);
        });
    }

    function renderOptionCards(layout) {
        optionLayer.removeChildren();
        const current = displayedState();
        if (!canMutateCurrentChapter()) return;
        if (current.isComplete === true) return;
        if (!isLastPage()) return;

        const options = Array.isArray(current.options) ? current.options.slice(0, 4) : [];
        const rowGap = options.length <= 3 ? 10 : 8;
        const rowHeight = Math.max(64, Math.floor((layout.height - rowGap * Math.max(0, options.length - 1)) / Math.max(1, options.length)));
        const numberColumnW = 52;
        const labelX = numberColumnW + 34;
        const oddsColumnW = Math.max(150, Math.min(220, Math.round(layout.width * 0.2)));
        const oddsPadding = 48;
        const labelWidth = Math.max(260, layout.width - labelX - oddsColumnW - 18);
        const labelRenderWidth = Math.max(labelWidth, layout.width - labelX - oddsColumnW + 26);
        const labelFontSize = 21;
        const labelLineHeight = 31;
        const numberFontSize = 21;
        const oddsFontSize = 21;

        options.forEach((option, index) => {
            const labelText = cleanText(option.label || 'Choose this approach');
            const row = new PIXI.Container();
            row.x = layout.x;
            row.y = layout.y + index * (rowHeight + rowGap);
            row.eventMode = state.busy ? 'none' : 'static';
            row.cursor = state.busy ? 'default' : 'pointer';

            const hitArea = new PIXI.Graphics();
            hitArea.roundRect(0, 0, layout.width, rowHeight, 4);
            hitArea.fill({ color: PALETTE.parchmentLight, alpha: 0.001 });
            row.addChild(hitArea);

            const rule = new PIXI.Graphics();
            if (index > 0) {
                rule.moveTo(0, 0);
                rule.lineTo(layout.width, 0);
                rule.stroke({ color: PALETTE.line, width: 1, alpha: 0.08 });
            }
            row.addChild(rule);

            const number = makeHtmlText(`${index + 1}.`, {
                fontFamily: THEME.fontNarrative,
                fontSize: numberFontSize,
                fill: PALETTE.rust,
                fontWeight: '600',
                lineHeight: labelLineHeight,
                cssOverrides: ['overflow: visible']
            });
            number.x = 0;
            setHtmlText(number, `${index + 1}.`, {
                width: numberColumnW,
                maxHeight: labelLineHeight + 6,
                maxLines: 1
            });
            number.y = Math.max(0, Math.round((rowHeight - numberFontSize * 1.25) / 2));
            row.addChild(number);

            const label = makeHtmlText('', {
                fontFamily: THEME.fontNarrative,
                fontSize: labelFontSize,
                fill: PALETTE.ink,
                lineHeight: labelLineHeight,
                wordWrapWidth: labelRenderWidth,
                cssOverrides: ['overflow: visible', 'padding-right: 32px']
            });
            label.x = labelX;
            setHtmlText(label, `${labelText}\u00a0\u00a0`, {
                width: labelRenderWidth,
                maxChars: 0,
                maxHeight: Math.max(labelLineHeight + 6, rowHeight - 10),
                maxLines: 2
            });
            label.y = Math.max(0, Math.round((rowHeight - label.height) / 2) - 1);
            row.addChild(label);

            const odds = makeHtmlText('', {
                fontFamily: THEME.fontNarrative,
                fontSize: oddsFontSize,
                fill: PALETTE.rust,
                fontWeight: '600',
                align: 'right',
                lineHeight: labelLineHeight,
                wordWrapWidth: oddsColumnW + oddsPadding,
                cssOverrides: ['overflow: visible', `padding-right: ${oddsPadding}px`]
            });
            odds.x = layout.width - oddsColumnW - oddsPadding;
            setHtmlText(odds, `${oddsLabel(option)}\u00a0\u00a0`, {
                width: oddsColumnW + oddsPadding,
                maxHeight: labelLineHeight + 6,
                maxLines: 1
            });
            odds.y = Math.max(0, Math.round((rowHeight - oddsFontSize * 1.22) / 2));
            row.addChild(odds);

            row.on('pointerdown', () => chooseOption(option.optionKey));
            row.on('pointerover', (event) => {
                const local = event?.global ? panel.toLocal(event.global) : { x: row.x + 80, y: row.y + rowHeight / 2 };
                showOptionTooltip(optionDetailLabel(option), local.x, local.y);
            });
            row.on('pointermove', (event) => {
                const local = panel.toLocal(event.global);
                showOptionTooltip(optionDetailLabel(option), local.x, local.y);
            });
            row.on('pointerout', hideOptionTooltip);
            row.on('pointerleave', hideOptionTooltip);
            row.on('pointerupoutside', hideOptionTooltip);
            row.on('pointercancel', hideOptionTooltip);
            optionLayer.addChild(row);
        });
    }

    function renderButtons(x, y) {
        buttonLayer.x = x;
        buttonLayer.y = y;
        let cursor = 0;
        const canMutate = canMutateCurrentChapter();
        const current = displayedState();
        rebuildButton.visible = canMutate && state.debugMode === true;
        rebuildCgButton.visible = canMutate && state.debugMode === true;
        if (rebuildButton.visible) {
            rebuildButton.x = cursor;
            cursor += 102;
            rebuildCgButton.x = cursor;
            cursor += 134;
        }
        hideButton.x = cursor;
        hideButton.visible = state.debugMode === true;
        if (hideButton.visible) cursor += 90;
        continueButton.x = cursor;
        rebuildButton.setDisabled(state.busy || state.cgBusy);
        rebuildCgButton.setDisabled(state.busy || state.cgBusy);
        hideButton.setDisabled(false);
        continueButton.visible = canMutate && current?.isComplete === true && isLastPage();
        continueButton.setDisabled(state.busy || current?.isComplete !== true);
    }

    function renderDebugRollButtons(panelX, panelY) {
        debugRollLayer.visible = state.debugMode === true && canMutateCurrentChapter();
        if (!debugRollLayer.visible) return;
        debugRollLayer.x = panelX + 24;
        debugRollLayer.y = Math.max(10, panelY - 40);
        let cursor = 0;
        for (const button of debugRollButtons) {
            button.x = cursor;
            button.y = 0;
            button.setDisabled(state.busy || state.cgBusy || state.rollAnimationActive);
            cursor += (button._width || 72) + 8;
        }
    }

    let cgFilterStyle = '';
    let cgFilterCache = [];

    function destroyCgFilterCache() {
        for (const filter of cgFilterCache) {
            try { filter?.destroy?.(); } catch (_) {}
        }
        cgFilterCache = [];
        cgFilterStyle = '';
    }

    function makeColorMatrixFilter(style) {
        if (!PIXI.ColorMatrixFilter) return null;
        const filter = new PIXI.ColorMatrixFilter();
        if (style === 'sepia') {
            if (typeof filter.sepia === 'function') filter.sepia(false);
            else if (typeof filter.brightness === 'function') filter.brightness(0.95, false);
        } else if (style === 'black_white') {
            if (typeof filter.blackAndWhite === 'function') filter.blackAndWhite(false);
            else if (typeof filter.greyscale === 'function') filter.greyscale(0.34, false);
        } else if (style === 'theme_colors') {
            if (typeof filter.greyscale === 'function') filter.greyscale(0.45, false);
            if (typeof filter.contrast === 'function') filter.contrast(1.08, true);
        }
        return filter;
    }

    function makePixelateFilter() {
        const PixelateFilter = PIXI.PixelateFilter || PIXI.filters?.PixelateFilter;
        if (!PixelateFilter) return null;
        try {
            return new PixelateFilter(5);
        } catch (_) {
            try {
                return new PixelateFilter([5, 5]);
            } catch (__) {
                return null;
            }
        }
    }

    function applyCgVisualStyle() {
        const style = normalizeCgVisualStyle(state.cgVisualStyle || payload.cgVisualStyle);
        if (cgFilterStyle === style) return;
        destroyCgFilterCache();
        cgFilterStyle = style;

        const filters = [];
        if (style === 'sepia' || style === 'black_white' || style === 'theme_colors') {
            const colorFilter = makeColorMatrixFilter(style);
            if (colorFilter) filters.push(colorFilter);
        }
        if (style === 'pixel_art') {
            const pixelFilter = makePixelateFilter();
            if (pixelFilter) filters.push(pixelFilter);
            cgSprite.roundPixels = true;
            try {
                const source = cgSprite.texture?.source || cgSprite.texture?.baseTexture;
                if (source && 'scaleMode' in source) source.scaleMode = 'nearest';
            } catch (_) {}
        } else {
            cgSprite.roundPixels = false;
        }

        cgFilterCache = filters;
        cgSprite.filters = filters.length > 0 ? filters : null;
    }

    function renderCgThemeTint(x, y, w, h) {
        const style = normalizeCgVisualStyle(state.cgVisualStyle || payload.cgVisualStyle);
        cgThemeTint.clear();
        cgThemeTint.visible = style === 'theme_colors' && cgSprite.visible && state.cgTextureStatus === 'ready';
        if (!cgThemeTint.visible) return;

        cgThemeTint.rect(x, y, w, h);
        cgThemeTint.fill({ color: pixiColor(THEME.primary), alpha: 0.18 });
        cgThemeTint.rect(x, y, w, h);
        cgThemeTint.fill({ color: pixiColor(THEME.secondary), alpha: 0.13 });
        cgThemeTint.rect(x, y, w, Math.max(1, h * 0.42));
        cgThemeTint.fill({ color: pixiColor(THEME.primaryHover), alpha: 0.12 });
        cgThemeTint.blendMode = PIXI.BLEND_MODES?.SOFT_LIGHT || PIXI.BLEND_MODES?.OVERLAY || 'soft-light';
    }

    async function loadCgTexture(path) {
        const cleanPath = String(path || '').trim();
        if (!cleanPath || cleanPath === state.cgTexturePath) return;
        state.cgTexturePath = cleanPath;
        state.cgTextureStatus = 'loading';
        try {
            const texture = bridge?.assets?.loadTexture
                ? await bridge.assets.loadTexture(cleanPath)
                : await PIXI.Assets.load(cleanPath);
            if (state.cgTexturePath !== cleanPath) return;
            cgSprite.texture = texture;
            cgSprite.visible = true;
            cgFilterStyle = '';
            state.cgTextureStatus = 'ready';
            render();
        } catch (error) {
            if (state.cgTexturePath !== cleanPath) return;
            cgSprite.visible = false;
            state.cgTextureStatus = 'failed';
            bridge?.log?.warn?.(`[AdventureBook] Failed to load CG texture: ${error?.message || error}`);
            render();
        }
    }

    function clearCgTexture() {
        state.cgTexturePath = '';
        state.cgTextureStatus = '';
        cgSprite.visible = false;
        cgThemeTint.clear();
        cgThemeTint.visible = false;
    }

    function fitSprite(sprite, x, y, w, h) {
        if (!sprite?.texture || !Number.isFinite(sprite.texture.width) || !Number.isFinite(sprite.texture.height)) return;
        const scale = Math.max(w / Math.max(1, sprite.texture.width), h / Math.max(1, sprite.texture.height));
        sprite.scale.set(scale);
        sprite.x = x + (w - sprite.texture.width * scale) / 2;
        sprite.y = y + (h - sprite.texture.height * scale) / 2;
    }

    function render() {
        optionLayer.removeChildren();
        chapterRailLayer.removeChildren();
        const { width, height } = screenSize();
        const viewportMargin = width >= 1400 && height >= 820 ? 18 : 10;
        const maxBookWidth = Math.max(420, width - viewportMargin * 2);
        const maxBookHeight = Math.max(300, height - viewportMargin * 2);
        let panelWidth = maxBookWidth;
        let panelHeight = Math.round(panelWidth * 0.58);
        if (panelHeight > maxBookHeight) {
            panelHeight = maxBookHeight;
            panelWidth = Math.round(panelHeight / 0.58);
        }
        const panelX = Math.round((width - panelWidth) / 2);
        const panelY = Math.round((height - panelHeight) / 2);
        const coverPadX = Math.max(22, Math.round(panelWidth * 0.032));
        const coverPadY = Math.max(22, Math.round(panelHeight * 0.048));
        const spineW = Math.max(24, Math.round(panelWidth * 0.032));
        const pageY = panelY + coverPadY;
        const pageH = panelHeight - coverPadY * 2;
        const pageW = Math.round((panelWidth - coverPadX * 2 - spineW) / 2);
        const leftX = panelX + coverPadX;
        const rightX = leftX + pageW + spineW;
        const innerPad = Math.max(28, Math.round(pageW * 0.075));
        const textW = pageW - innerPad * 2;
        const leftContentX = leftX + innerPad;
        const rightContentX = rightX + innerPad;
        const footerY = panelY + panelHeight - coverPadY - 42;

        toggleButton._open = state.visible;
        toggleButton.redraw();
        if (state.visible) {
            toggleButton.x = Math.round(panelX + panelWidth - coverPadX - toggleButton._width - 12);
            toggleButton.y = Math.round(panelY + coverPadY + 12);
        } else {
            toggleButton.x = Math.round(width / 2 - toggleButton._width / 2);
            toggleButton.y = Math.round(height * (2 / 3) - toggleButton._height / 2);
        }
        hiddenHintText.visible = !state.visible;
        if (hiddenHintText.visible) {
            const hintWidth = Math.min(520, Math.max(280, width - 80));
            hiddenHintText.style.fontSize = 16;
            hiddenHintText.style.lineHeight = 21;
            hiddenHintText.style.fill = PALETTE.inkSoft;
            hiddenHintText.style.fontWeight = '700';
            hiddenHintText.style.align = 'center';
            hiddenHintText.style.stroke = { color: PALETTE.veil, width: 4, alpha: 0.82 };
            setHtmlText(hiddenHintText, 'You can continue without the adventure book', {
                width: hintWidth,
                maxHeight: 54,
                maxLines: 2,
                maxChars: 80
            });
            hiddenHintText.style.update?.();
            hiddenHintText.x = Math.round(width / 2 - hintWidth / 2);
            hiddenHintText.y = Math.round(toggleButton.y + toggleButton._height + 28);
        }

        panel.visible = state.visible;
        veil.visible = state.visible;
        panel.eventMode = state.visible ? 'auto' : 'none';
        veil.eventMode = state.visible ? 'static' : 'none';
        veil.clear();
        if (state.visible) {
            engageImmersiveMode();
            applyBackdropFocus();
            veil.rect(0, 0, width, height);
            veil.fill({ color: PALETTE.veil, alpha: 0.55 });
        }
        if (!state.visible) {
            forceVnInputVisibleForHiddenBook();
            restoreBackdropFocus();
            return;
        }

        panelShadow.clear();
        panelShadow.roundRect(panelX + 12, panelY + 16, panelWidth, panelHeight, 20);
        panelShadow.fill({ color: 0x000000, alpha: 0.5 });

        panelBg.clear();
        panelBg.roundRect(panelX, panelY, panelWidth, panelHeight, 18);
        panelBg.fill({ color: PALETTE.leatherDark, alpha: 0.94 });
        panelBg.roundRect(panelX + 12, panelY + 10, panelWidth - 24, panelHeight - 20, 14);
        panelBg.fill({ color: PALETTE.leather, alpha: 0.76 });
        panelBg.stroke({ color: PALETTE.line, width: 1, alpha: 0.26 });

        headerBand.clear();
        drawBookPage(headerBand, leftX, pageY, pageW, pageH, 'left');
        drawBookPage(headerBand, rightX, pageY, pageW, pageH, 'right');

        bookFurniture.clear();
        bookFurniture.roundRect(leftX + pageW - 8, pageY + 10, spineW + 16, pageH - 20, 10);
        bookFurniture.fill({ color: PALETTE.leatherDark, alpha: 0.58 });
        bookFurniture.rect(leftX + pageW + Math.round(spineW / 2) - 3, pageY + 24, 6, pageH - 48);
        bookFurniture.fill({ color: PALETTE.line, alpha: 0.18 });
        bookFurniture.roundRect(panelX + panelWidth - 20, panelY + Math.round(panelHeight * 0.28), 34, 84, 8);
        bookFurniture.fill({ color: PALETTE.parchmentDark, alpha: 0.88 });
        bookFurniture.stroke({ color: PALETTE.line, width: 1, alpha: 0.34 });
        bookFurniture.roundRect(panelX - 14, panelY + Math.round(panelHeight * 0.31), 42, 62, 8);
        bookFurniture.fill({ color: PALETTE.parchmentDark, alpha: 0.82 });
        bookFurniture.stroke({ color: PALETTE.line, width: 1, alpha: 0.3 });
        bookFurniture.roundRect(panelX + Math.round(panelWidth * 0.47), panelY + panelHeight - 18, 58, 44, 7);
        bookFurniture.fill({ color: PALETTE.parchmentDark, alpha: 0.84 });
        bookFurniture.stroke({ color: PALETTE.line, width: 1, alpha: 0.3 });
        drawMetalCorner(bookFurniture, panelX + 16, panelY + 16, false, false);
        drawMetalCorner(bookFurniture, panelX + panelWidth - 16, panelY + 16, true, false);
        drawMetalCorner(bookFurniture, panelX + 16, panelY + panelHeight - 16, false, true);
        drawMetalCorner(bookFurniture, panelX + panelWidth - 16, panelY + panelHeight - 16, true, true);
        renderChapterRail(panelX, pageY, pageH, leftX);

        pageWash.clear();
        pageWash.circle(leftX + 42, pageY + pageH - 52, 86);
        pageWash.fill({ color: PALETTE.line, alpha: 0.035 });
        pageWash.circle(rightX + pageW - 74, pageY + 70, 74);
        pageWash.fill({ color: 0xffffff, alpha: 0.035 });

        const current = displayedState();
        const characterAccents = resolveCharacterAccents(current);
        const transitionActive = state.chapterTransitionActive === true;
        const transitionMessage = state.chapterTransitionMessage || 'Writing the next scene...';
        const canShowInteractiveChapter = canMutateCurrentChapter();
        const hasChoicesCandidate = canShowInteractiveChapter && !transitionActive && current.isComplete !== true && Array.isArray(current.options) && current.options.length > 0;
        const hasFinalCloseCandidate = canShowInteractiveChapter && !transitionActive && current.isComplete === true;
        const finalCloseText = current.finalResolution || current.stakes || '';
        const storyY = pageY + 92;
        const fullStoryH = Math.max(180, footerY - storyY - 18);
        const leftStoryW = textW - 12;
        const rightStoryW = textW - 12;
        const choiceCount = hasChoicesCandidate ? Math.min(4, current.options.length) : 0;
        const candidateChoiceRowH = hasChoicesCandidate ? Math.max(78, Math.min(96, Math.round(pageH * 0.07))) : 0;
        const candidateChoiceTrayH = hasChoicesCandidate
            ? Math.min(360, Math.max(238, 42 + candidateChoiceRowH * choiceCount + 10 * Math.max(0, choiceCount - 1)))
            : 0;
        const closeCharsPerLine = Math.max(30, Math.floor((textW - 36) / 12));
        const closeLineEstimate = Math.max(1, Math.ceil(cleanText(finalCloseText).length / closeCharsPerLine));
        const candidateFinalCloseTrayH = hasFinalCloseCandidate
            ? Math.min(280, Math.max(142, 60 + closeLineEstimate * 32))
            : 0;
        const reservesFinalActionCandidate = hasChoicesCandidate || hasFinalCloseCandidate;
        const candidateReservedTrayH = hasChoicesCandidate ? candidateChoiceTrayH : candidateFinalCloseTrayH;
        const candidateReservedTrayY = footerY - candidateReservedTrayH - 14;
        const finalStoryH = reservesFinalActionCandidate ? Math.max(180, candidateReservedTrayY - storyY - 32) : fullStoryH;
        const layoutKey = `${Math.round(leftStoryW)}x${Math.round(fullStoryH)}x${Math.round(finalStoryH)}:${displayedChapter()?.chapterIndex || 1}:${hasChoicesCandidate ? 1 : 0}:${hasFinalCloseCandidate ? 1 : 0}:${transitionActive ? 'transition' : current.storyText?.length || 0}:${hasFinalCloseCandidate ? hashText(finalCloseText) : ''}`;
        const readOffset = state.pageLayoutKey && state.pageLayoutKey !== layoutKey ? getReadOffset() : null;
        const spread = transitionActive
            ? {
                left: { body: transitionMessage },
                right: null,
                pages: [{ body: transitionMessage }],
                spreadIndex: 0,
                spreadCount: 1
            }
            : getCurrentSpreadPages(current, {
                textWidth: leftStoryW,
                storyHeight: fullStoryH,
                finalStoryHeight: finalStoryH,
                reserveFinalChoices: reservesFinalActionCandidate
            });
        state.pageLayoutKey = layoutKey;
        if (!transitionActive && readOffset !== null) {
            restorePageFromOffset(readOffset);
            spread.spreadIndex = clampPageIndex();
            spread.left = spread.pages[spread.spreadIndex] || spread.pages[0] || null;
        }
        const revealChoices = spread.spreadIndex >= spread.spreadCount - 1;
        const hasChoices = revealChoices && hasChoicesCandidate;
        const hasFinalClose = revealChoices && hasFinalCloseCandidate;
        const choiceTrayH = hasChoices ? candidateChoiceTrayH : hasFinalClose ? candidateFinalCloseTrayH : 0;
        const choiceTrayY = (hasChoices || hasFinalClose) ? footerY - choiceTrayH - 14 : footerY - 14;
        const storyH = (hasChoices || hasFinalClose) ? finalStoryH : fullStoryH;
        const optionsY = choiceTrayY + 26;
        const optionsH = Math.max(160, choiceTrayH - 34);
        const artX = rightContentX;
        const artY = pageY + 74;
        const artW = textW;
        const artH = Math.max(180, footerY - artY - 18);
        const historyY = storyY;
        const historyH = storyH;
        tooltipLayout = { panelX, panelY, panelWidth, panelHeight, textW, hasChoices };

        storyBox.clear();
        drawFill(storyBox, leftContentX, storyY, textW, storyH, PALETTE.parchmentLight, 0.42, {
            color: PALETTE.line,
            width: 1,
            alpha: 0.1
        });
        drawFill(storyBox, rightContentX, storyY, textW, storyH, PALETTE.parchmentLight, 0.34, {
            color: PALETTE.line,
            width: 1,
            alpha: 0.08
        });
        optionBox.clear();
        if (hasChoices || hasFinalClose) {
            optionBox.moveTo(leftContentX + 10, choiceTrayY + 8);
            optionBox.lineTo(leftContentX + textW - 10, choiceTrayY + 8);
            optionBox.stroke({ color: PALETTE.line, width: 1, alpha: 0.24 });
            optionBox.moveTo(leftContentX + Math.round(textW * 0.42), choiceTrayY + 8);
            optionBox.lineTo(leftContentX + Math.round(textW * 0.58), choiceTrayY + 8);
            optionBox.stroke({ color: PALETTE.rust, width: 2, alpha: 0.38 });
        }

        actionBox.clear();
        actionBox.roundRect(artX, artY, artW, artH, 12);
        actionBox.fill({ color: PALETTE.parchmentLight, alpha: 0.42 });
        actionBox.stroke({ color: PALETTE.line, width: 1, alpha: 0.2 });
        actionBox.roundRect(artX + 14, artY + 14, artW - 28, artH - 28, 8);
        actionBox.stroke({ color: PALETTE.brass, width: 1, alpha: 0.18 });
        historyBox.clear();
        diceCircle.clear();

        const chapterIndex = current.chapterIndex || current.stepIndex || 1;
        const maxChapters = current.maxChapters || current.maxSteps || payload?.maxSteps || 3;
        const pages = spread.pages;
        const pageIndex = spread.spreadIndex;
        const page = spread.left || pages[0] || {};
        kicker.style.fontSize = 14;
        kicker.style.lineHeight = 18;
        kicker.style.fill = PALETTE.copper;
        kicker.style.fontWeight = '700';
        kicker.style.align = 'left';
        setHtmlText(kicker, 'ADVENTURE BOOK', {
            width: Math.min(180, textW),
            maxHeight: 24,
            maxLines: 1,
            maxChars: 30
        });
        kicker.style.update?.();
        kicker.x = leftContentX;
        kicker.y = pageY + 30;
        setHtmlText(titleText, current.title || 'Adventure Book', { width: Math.min(textW * 1.45, pageW + spineW), maxChars: 90, maxLines: 2 });
        titleText.x = leftContentX;
        titleText.y = pageY + 48;

        const visiblePageBody = page.body ?? current.situation ?? 'The page waits for a decision.';
        setHtmlText(situationText, visiblePageBody, {
            width: textW - 12,
            maxChars: lineCharBudget(textW - 12, 18, 10),
            maxHeight: Math.max(120, storyH - 18),
            maxLines: 10
        });
        situationText.x = leftContentX + 6;
        situationText.y = storyY + 10;
        setHtmlText(situationText, visiblePageBody, {
            width: leftStoryW,
            maxChars: 0,
            maxHeight: Math.max(120, storyH - 20),
            maxLines: Math.max(7, Math.floor(storyH / 31)),
            preserveParagraphs: true,
            characterAccents
        });
        if (transitionActive) {
            situationText.style.fontFamily = THEME.fontTitle;
            situationText.style.fontSize = 34;
            situationText.style.lineHeight = 44;
            situationText.style.fill = PALETTE.ink;
            situationText.style.fontWeight = '700';
            situationText.style.align = 'center';
            situationText.style.update?.();
            situationText.x = leftContentX + textW / 2;
            situationText.y = storyY + Math.max(28, storyH * 0.32);
            if (situationText.anchor?.set) situationText.anchor.set(0.5, 0);
            transitionIndicator.clear();
            const pulseTime = Date.now() / 420;
            const indicatorY = situationText.y + 86;
            const indicatorX = leftContentX + textW / 2;
            for (let i = 0; i < 3; i += 1) {
                const pulse = 0.5 + 0.5 * Math.sin(pulseTime + i * 1.35);
                const radius = 5 + pulse * 3;
                transitionIndicator.circle(indicatorX + (i - 1) * 26, indicatorY, radius);
                transitionIndicator.fill({
                    color: PALETTE.copper,
                    alpha: 0.36 + pulse * 0.48
                });
            }
            transitionIndicator.moveTo(indicatorX - 56, indicatorY + 22);
            transitionIndicator.lineTo(indicatorX + 56, indicatorY + 22);
            transitionIndicator.stroke({ color: PALETTE.line, width: 1, alpha: 0.22 });
        } else {
            transitionIndicator.clear();
            situationText.style.fontFamily = THEME.fontNarrative;
            situationText.style.fontSize = 21;
            situationText.style.lineHeight = 31;
            situationText.style.fill = PALETTE.ink;
            situationText.style.fontWeight = undefined;
            situationText.style.align = 'left';
            situationText.style.update?.();
            if (situationText.anchor?.set) situationText.anchor.set(0, 0);
        }
        setHtmlText(rightStoryText, '', { width: rightStoryW, maxChars: 0 });
        rightStoryText.x = rightContentX + 6;
        rightStoryText.y = storyY + 10;
        rightStoryText.visible = false;
        stakesText.visible = hasFinalClose;
        setHtmlText(stakesText, hasFinalClose ? finalCloseText : '', {
            width: textW - 36,
            maxChars: 0,
            maxHeight: Math.max(52, choiceTrayH - 70),
            maxLines: Math.max(2, Math.floor(Math.max(52, choiceTrayH - 70) / 27))
        });
        stakesText.x = leftContentX + 18;
        stakesText.y = choiceTrayY + 56;
        actionLabel.visible = hasFinalClose;
        actionLabel.text = 'The book is ready to close';
        actionLabel.x = leftContentX + 18;
        actionLabel.y = choiceTrayY + 24;
        if (hasChoices) {
            renderOptionCards({
                x: leftContentX + 14,
                y: optionsY,
                width: textW - 28,
                height: optionsH
            });
        }

        diceCircle.clear();
        rollText.visible = false;

        const cgStatus = getCgStatus(current);
        const canRequestCgManually = canShowInteractiveChapter
            && payload.autoGenerateCg === true
            && !current.cgImagePath
            && !state.cgBusy
            && (cgStatus === 'pending' || cgStatus === 'failed');
        const imageSeed = state.cgBusy
            ? (state.cgStatus || 'Painting CG...')
            : current.cgImagePath
                ? (state.cgTextureStatus === 'loading'
                ? 'Illustration developing...'
                : state.cgTextureStatus === 'failed'
                    ? 'Illustration unavailable.'
                    : '')
                : cgStatus === 'failed'
                    ? 'Illustration failed to develop.'
                    : cgStatus === 'pending'
                        ? 'Illustration was interrupted before it finished.'
                        : (current.illustrationPrompt || current.mode || 'A tense choice waits on the page.');
        if (current.cgImagePath && current.cgImagePath !== state.cgTexturePath) {
            loadCgTexture(current.cgImagePath);
        } else if (!current.cgImagePath && state.cgTexturePath) {
            clearCgTexture();
        }
        if (cgSprite.visible && state.cgTextureStatus === 'ready') {
            applyCgVisualStyle();
            fitSprite(cgSprite, rightContentX + 13, artY + 13, textW - 26, artH - 26);
            illustrationText.visible = false;
        } else {
            illustrationText.visible = true;
        }
        setHtmlText(illustrationText, imageSeed, {
            width: Math.max(180, textW - 160),
            maxChars: lineCharBudget(Math.max(180, textW - 160), 17, 5),
            maxHeight: Math.max(72, artH - 112),
            maxLines: 5
        });
        illustrationText.x = rightContentX + textW / 2;
        illustrationText.y = artY + artH / 2 - (canRequestCgManually ? 26 : 0);
        generateCgButton.visible = canRequestCgManually;
        generateCgButton.x = Math.round(rightContentX + textW / 2 - generateCgButton._width / 2);
        generateCgButton.y = Math.round(illustrationText.y + 46);
        generateCgButton.setDisabled(state.busy || state.cgBusy);
        if (cgSprite.visible && state.cgTextureStatus === 'ready') {
            applyCgVisualStyle();
            fitSprite(cgSprite, artX + 14, artY + 14, artW - 28, artH - 28);
            cgSprite.alpha = 1;
            illustrationText.visible = false;
            generateCgButton.visible = false;
        } else {
            illustrationText.visible = true;
            cgThemeTint.clear();
            cgThemeTint.visible = false;
        }
        cgMask.clear();
        cgMask.roundRect(artX + 14, artY + 14, artW - 28, artH - 28, 8);
        cgMask.fill({ color: 0xffffff, alpha: 1 });
        renderCgThemeTint(artX + 14, artY + 14, artW - 28, artH - 28);

        historyTitle.x = rightContentX + 16;
        historyTitle.y = historyY + 14;
        const latest = state.history[state.history.length - 1];
        const latestText = latest
            ? `${latest.roll?.resolutionType === 'automatic' ? 'Certain. ' : latest.roll?.roll ? `Roll ${latest.roll.roll}: ${latest.roll.outcome}. ` : ''}${latest.resultText || ''}`
            : 'No result yet.';
        setHtmlText(historyText, latestText, {
            width: textW - 32,
            maxChars: lineCharBudget(textW - 32, 15, 5),
            maxHeight: Math.max(42, historyH - 56),
            maxLines: 5
        });
        historyText.x = rightContentX + 16;
        historyText.y = historyY + 38;
        historyTitle.visible = false;
        historyText.visible = false;

        const visibleStatus = state.debugMode ? (state.status || '') : '';
        setHtmlText(statusText, visibleStatus, {
            width: Math.min(panelWidth - 44, 780),
            maxChars: lineCharBudget(Math.min(panelWidth - 44, 780), 14, 2),
            maxHeight: 38,
            maxLines: 2
        });
        statusText.style.fill = state.statusIsError ? PALETTE.danger : PALETTE.copper;
        statusText.style.update?.();
        statusText.x = 18;
        statusText.y = 18;
        statusText.visible = visibleStatus.length > 0;

        if (hasChoices && state.optionHoverText) {
            showOptionTooltip(state.optionHoverText, state.optionTooltipX, state.optionTooltipY);
        } else {
            hideOptionTooltip();
        }

        pageDots.clear();
        const dotGap = 14;
        const dotsW = Math.max(0, (spread.spreadCount - 1) * dotGap);
        const dotsX = panelX + panelWidth / 2 - dotsW / 2;
        for (let i = 0; i < spread.spreadCount; i += 1) {
            pageDots.circle(dotsX + i * dotGap, footerY + 16, i === spread.spreadIndex ? 4 : 2.5);
            pageDots.fill({ color: i === spread.spreadIndex ? PALETTE.copper : PALETTE.inkSoft, alpha: i === spread.spreadIndex ? 0.9 : 0.4 });
        }
        pageDots.visible = false;

        const navY = footerY - 20;
        const centerX = leftContentX + textW / 2;
        pageNavLayer.x = 0;
        pageNavLayer.y = navY;
        prevPageButton.x = 0;
        prevPageButton.y = 0;
        nextPageButton.x = 0;
        nextPageButton.y = 0;
        const pageLineGap = 62;
        const lineWidth = prevPageButton._width || 180;
        prevPageButton.x = Math.round(centerX - pageLineGap - lineWidth);
        nextPageButton.x = Math.round(centerX + pageLineGap);
        prevPageButton.setDisabled(state.busy || spread.spreadIndex <= 0);
        nextPageButton.setDisabled(state.busy || spread.spreadIndex >= spread.spreadCount - 1);
        const progressBoxW = 140;
        setHtmlText(progressText, `${spread.spreadIndex + 1} / ${spread.spreadCount}\u00a0\u00a0`, {
            width: progressBoxW,
            maxHeight: 36,
            maxLines: 1
        });
        progressText.style.fontFamily = THEME.fontNarrative;
        progressText.style.fontSize = 21;
        progressText.style.fill = PALETTE.inkSoft;
        progressText.style.fontWeight = '600';
        progressText.style.update?.();
        progressText.x = Math.round(centerX - progressBoxW / 2);
        progressText.y = navY + 1;

        leftPageEdge.clear();
        leftPageEdge.rect(leftX, pageY, Math.max(44, pageW * 0.16), pageH);
        leftPageEdge.fill({ color: PALETTE.copper, alpha: spread.spreadIndex > 0 ? 0.015 : 0 });
        leftPageEdge.eventMode = spread.spreadIndex > 0 && !state.busy ? 'static' : 'none';
        rightPageEdge.clear();
        rightPageEdge.rect(rightX + pageW - Math.max(44, pageW * 0.16), pageY, Math.max(44, pageW * 0.16), pageH);
        rightPageEdge.fill({ color: PALETTE.copper, alpha: spread.spreadIndex < spread.spreadCount - 1 ? 0.018 : 0 });
        rightPageEdge.eventMode = spread.spreadIndex < spread.spreadCount - 1 && !state.busy ? 'static' : 'none';
        leftPageEdge.eventMode = 'none';
        rightPageEdge.eventMode = 'none';

        continueButton.visible = canShowInteractiveChapter && current.isComplete === true && revealChoices;
        const buttonWidth = (rebuildButton.visible ? 92 + 10 + 124 + 10 : 0)
            + (state.debugMode ? 80 + 10 : 0)
            + (continueButton.visible ? 118 : 0);
        renderButtons(rightX + pageW - innerPad - Math.max(190, buttonWidth), footerY);
        renderDebugRollButtons(panelX, panelY);

        loadingText.visible = state.busy && !transitionActive;
        setHtmlText(loadingText, state.status || 'Turning the page...', {
            width: Math.min(520, panelWidth - 120),
            maxChars: lineCharBudget(Math.min(520, panelWidth - 120), 22, 2),
            maxHeight: 58,
            maxLines: 2
        });
        loadingText.x = panelX + panelWidth / 2;
        loadingText.y = state.rollAnimationActive
            ? Math.max(panelY + 72, height * 0.45 - 205)
            : panelY + panelHeight / 2;
    }

    function scheduleSettledRender() {
        const rerender = () => {
            try { render(); } catch (_) {}
        };
        try {
            requestAnimationFrame(() => requestAnimationFrame(rerender));
        } catch (_) {
            setTimeout(rerender, 32);
        }
        setTimeout(rerender, 120);
        setTimeout(rerender, 360);
        try {
            document.fonts?.ready?.then?.(rerender).catch?.(() => {});
        } catch (_) {}
    }

    async function start() {
        if (state.startInvoked) return;
        state.startInvoked = true;

        if (!payload?.initialState) {
            state.current = null;
            state.history = [];
            state.lastRoll = null;
            state.busy = false;
            setStatus('Adventure Book was not pre-generated for this turn. Enable Debug Mode to rebuild one.', true);
            return;
        }

        state.current = payload.initialState;
        state.interactionMode = String(payload.interactionMode || 'active');
        state.bookStatus = String(payload.bookStatus || 'active');
        state.chapters = normalizeUiChapters(payload.chapters, state.current);
        state.selectedChapterIndex = latestChapterIndex();
        state.history = [];
        state.lastRoll = null;
        state.currentPageIndex = 0;
        setChapterTransition(false);
        state.status = '';
        state.statusIsError = false;
        render();
        scheduleSettledRender();
        maybeAutoGenerateCgForCurrentChapter();
    }

    async function rebuild(generateCg = false) {
        if (state.busy || state.cgBusy || state.debugMode !== true || !canMutateCurrentChapter()) return;
        setBusy(true, 'Rebuilding the adventure book...');
        const response = await socketRequest(payload.rebuildEventName, {
            generateCg: false
        }, 300000);
        state.busy = false;

        if (!response || response.success !== true) {
            setStatus(response?.error || 'Adventure Book could not be rebuilt.', true);
            return;
        }

        state.current = response.state;
        syncChaptersFromResponse(response);
        state.selectedChapterIndex = latestChapterIndex();
        state.history = [];
        state.lastRoll = null;
        state.currentPageIndex = 0;
        setChapterTransition(false);
        state.status = generateCg ? '' : 'Book rebuilt.';
        state.statusIsError = false;
        render();

        if (generateCg === true) {
            await generateCgForCurrentSession();
        }
    }

    async function generateCgForCurrentSession(options = {}) {
        if (!payload?.cgEventName || !state.current || state.cgBusy || !canMutateCurrentChapter()) {
            bridge?.log?.warn?.(`[AdventureBook] CG request skipped: event=${payload?.cgEventName || '(missing)'} current=${!!state.current} busy=${state.cgBusy}.`);
            return;
        }
        const manual = options?.manual === true;
        state.cgBusy = true;
        state.cgStatus = 'Painting CG...';
        if (state.current) {
            state.current.cgStatus = 'pending';
            state.current.cgError = '';
        }
        render();
        bridge?.log?.info?.(`[AdventureBook] Requesting CG for current Adventure Book${manual ? ' (manual)' : ''}.`);
        let response = null;
        const requestPayload = {
            chapterIndex: currentChapterIndex()
        };
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            bridge?.log?.info?.(`[AdventureBook] CG request attempt ${attempt}/2 for current Adventure Book.`);
            response = await cgSocketRequest(payload.cgEventName, requestPayload, 300000);
            const errorText = String(response?.error || '').toLowerCase();
            if (response?.success === true || !['timeout', 'socket_request_unavailable'].includes(errorText)) break;
            bridge?.log?.warn?.(`[AdventureBook] CG request attempt ${attempt} failed: ${response?.error || 'unknown error'}`);
            if (attempt < 2) await delay(1200);
        }
        state.cgBusy = false;
        state.cgStatus = '';
        if (response?.state) state.current = response.state;
        if (response) syncChaptersFromResponse(response);

        if (!response || response.success !== true) {
            const cgError = String(response?.error || response?.cg?.error || 'unknown error').replace(/\s+/g, ' ').slice(0, 120);
            if (state.current && !state.current.cgImagePath) {
                state.current.cgStatus = 'failed';
                state.current.cgError = cgError;
            }
            setStatus(`CG failed: ${cgError}`, true);
            render();
            return;
        }

        state.autoCgRequestedChapterIndex = currentChapterIndex();
        bridge?.log?.info?.(`[AdventureBook] CG request completed: ${response?.cg?.cgImagePath || response?.state?.cgImagePath || '(no image path)'}.`);
        setChapterTransition(false);
        state.status = '';
        state.statusIsError = false;
        render();
    }

    function maybeAutoGenerateCgForCurrentChapter() {
        const chapterIndex = currentChapterIndex();
        if (isReadOnlyMode()
            || payload.autoGenerateCg !== true
            || !state.current
            || state.current.cgImagePath
            || getCgStatus(state.current) !== 'missing'
            || state.autoCgRequestedChapterIndex === chapterIndex) {
            return;
        }

        state.autoCgRequestedChapterIndex = chapterIndex;
        generateCgForCurrentSession().catch(error => {
            bridge?.log?.warn?.(`[AdventureBook] Auto CG failed for chapter ${chapterIndex}: ${error?.message || error}`);
        });
    }

    async function chooseOption(optionKey) {
        if (!state.current || state.busy || !optionKey || !canMutateCurrentChapter()) return;
        if (!isLastPage()) return;
        hideOptionTooltip();
        const option = (Array.isArray(state.current?.options) ? state.current.options : [])
            .find(candidate => candidate.optionKey === optionKey);
        const isAutomatic = option?.resolutionType === 'automatic';
        setBusy(true, isAutomatic ? 'The choice is certain...' : 'The die is falling...');

        try {
            let response = null;
            if (!isAutomatic && payload?.rollEventName) {
                const rollResponse = await socketRequest(payload.rollEventName, {
                    optionKey,
                    chapterIndex: currentChapterIndex()
                }, 60000);
                if (!rollResponse || rollResponse.success !== true) {
                    state.busy = false;
                    setStatus(rollResponse?.error || 'The die slipped off the table.', true);
                    return;
                }

                const advancePromise = socketRequest(payload.advanceEventName, {
                    optionKey,
                    chapterIndex: currentChapterIndex(),
                    pendingRollId: rollResponse.pendingRollId
                }, 180000);
                await animateRollOverlay(rollResponse.roll);
                if (state.busy) {
                    setChapterTransition(true, 'Writing the next scene...');
                }
                if (state.busy) render();
                response = await advancePromise;
            } else {
                const advancePromise = socketRequest(payload.advanceEventName, {
                    optionKey,
                    chapterIndex: currentChapterIndex()
                }, 180000);
                if (isAutomatic) {
                    await animateCertainOverlay();
                    if (state.busy) {
                        setChapterTransition(true, 'Writing the next scene...');
                    }
                    if (state.busy) render();
                } else if (state.busy) {
                    setChapterTransition(true, 'Writing the next scene...');
                    render();
                }
                response = await advancePromise;
            }

            state.busy = false;

            if (!response || response.success !== true) {
                setChapterTransition(false);
                setStatus(response?.error || 'The page refused to turn.', true);
                return;
            }

            setChapterTransition(false);
            state.current = response.state;
            syncChaptersFromResponse(response);
            state.selectedChapterIndex = latestChapterIndex();
            state.lastRoll = response.roll || null;
            state.currentPageIndex = 0;
            if (response.transcriptEntry) state.history.push(response.transcriptEntry);
            setStatus(response.roll?.resolutionType === 'automatic'
                ? 'Certain: no roll'
                : response.roll
                    ? `D20: ${response.roll.roll} vs ${response.roll.d20Target}+ (${response.roll.outcome})`
                    : '');
            maybeAutoGenerateCgForCurrentChapter();
        } catch (error) {
            state.busy = false;
            setChapterTransition(false);
            clearDiceOverlay();
            setStatus(error?.message || 'The die vanished before it landed.', true);
        }
    }

    async function finalize() {
        if (!state.current || state.busy || !canMutateCurrentChapter()) return;
        setBusy(true, 'Canonizing the adventure...');
        const response = await socketRequest(payload.finalizeEventName, {}, 180000);
        state.busy = false;

        if (!response || response.success !== true) {
            setStatus(response?.error || 'Adventure Book could not be canonized.', true);
            return;
        }

        const prompt = response.continuationPrompt || response.bridgePrompt || 'Continue from the Adventure Book outcome.';
        restoreVnHudAfterFinalHandoff();
        try { bridge?.intercept?.resolve?.({ adventureBookFinalized: true }); } catch (_) {}
        if (bridge?.input?.submitAndGenerate) {
            await bridge.input.submitAndGenerate({ textOverride: prompt });
        }
    }

    const resizeHandler = () => render();
    const spriteAccentHandler = () => {
        if (state.visible && state.current) render();
    };
    const applyCgStyleSetting = (settingsOrStyle) => {
        const rawStyle = typeof settingsOrStyle === 'string'
            ? settingsOrStyle
            : extractCgVisualStyleFromSettings(settingsOrStyle);
        if (!rawStyle) return;
        const nextStyle = normalizeCgVisualStyle(rawStyle);
        if (nextStyle === state.cgVisualStyle) return;
        state.cgVisualStyle = nextStyle;
        cgFilterStyle = '';
        render();
    };
    const applyDebugModeSetting = (settingsOrValue) => {
        const nextValue = typeof settingsOrValue === 'boolean'
            ? settingsOrValue
            : extractDebugModeFromSettings(settingsOrValue);
        if (nextValue === null || nextValue === state.debugMode) return;
        state.debugMode = nextValue;
        render();
    };
    const settingsUpdatedHandler = (event) => {
        const settings = event?.detail || event;
        applyCgStyleSetting(settings);
        applyDebugModeSetting(settings);
    };
    const keydownHandler = (event) => {
        if (!state.visible) return;
        if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            event.preventDefault();
            turnSpread(-1);
        } else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
            event.preventDefault();
            turnSpread(1);
        }
    };
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('keydown', keydownHandler);
    window.addEventListener('blur', hideOptionTooltip);
    document.addEventListener('mouseleave', hideOptionTooltip);
    window.addEventListener('vn:pixi-sprite-ready', spriteAccentHandler);
    window.addEventListener('vn:pixi-sprite-updated', spriteAccentHandler);
    window.addEventListener('vn:settings-updated', settingsUpdatedHandler);
    window.addEventListener('adventure-book:cg-style', settingsUpdatedHandler);
    try { socket?.on?.('vn-settings-updated', settingsUpdatedHandler); } catch (_) {}
    try { socket?.on?.('plugin:settings-updated:adventure_book', settingsUpdatedHandler); } catch (_) {}
    bridge?.lifecycle?.onDispose?.(() => window.removeEventListener('resize', resizeHandler));
    bridge?.lifecycle?.onDispose?.(() => window.removeEventListener('keydown', keydownHandler));
    bridge?.lifecycle?.onDispose?.(() => window.removeEventListener('blur', hideOptionTooltip));
    bridge?.lifecycle?.onDispose?.(() => document.removeEventListener('mouseleave', hideOptionTooltip));
    bridge?.lifecycle?.onDispose?.(() => window.removeEventListener('vn:pixi-sprite-ready', spriteAccentHandler));
    bridge?.lifecycle?.onDispose?.(() => window.removeEventListener('vn:pixi-sprite-updated', spriteAccentHandler));
    bridge?.lifecycle?.onDispose?.(() => window.removeEventListener('vn:settings-updated', settingsUpdatedHandler));
    bridge?.lifecycle?.onDispose?.(() => window.removeEventListener('adventure-book:cg-style', settingsUpdatedHandler));
    bridge?.lifecycle?.onDispose?.(() => {
        if (transitionAnimationFrame) {
            cancelAnimationFrame(transitionAnimationFrame);
            transitionAnimationFrame = 0;
        }
    });
    bridge?.lifecycle?.onDispose?.(() => {
        try { socket?.off?.('vn-settings-updated', settingsUpdatedHandler); } catch (_) {}
        try { socket?.off?.('plugin:settings-updated:adventure_book', settingsUpdatedHandler); } catch (_) {}
    });

    render();
    scheduleSettledRender();
    start().catch(error => {
        state.busy = false;
        setStatus(error?.message || 'Adventure Book failed to start.', true);
    });
})();

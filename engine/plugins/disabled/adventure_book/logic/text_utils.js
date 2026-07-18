function toStringSafe(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

function toInt(value, fallback = null) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function slugify(value, fallback = 'option') {
    const slug = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 54);
    return slug || fallback;
}

function sanitizeText(value, fallback = '', max = 2000) {
    return toStringSafe(value, fallback).replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeLongText(value, fallback = '', max = 4000) {
    return toStringSafe(value, fallback)
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim()
        .slice(0, max);
}

function limitAtNaturalBoundary(value, max = 1000) {
    const text = sanitizeLongText(value, '', Math.max(1, max * 2));
    if (text.length <= max) return text;
    const clipped = text.slice(0, Math.max(1, max - 1));
    const boundary = Math.max(
        clipped.lastIndexOf('\n\n'),
        clipped.lastIndexOf('. '),
        clipped.lastIndexOf('! '),
        clipped.lastIndexOf('? ')
    );
    if (boundary > Math.floor(max * 0.55)) {
        return `${clipped.slice(0, boundary + 1).trim()}...`;
    }
    return `${clipped.replace(/\s+\S*$/, '').trim() || clipped.trim()}...`;
}

function splitSentences(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [];
}

function splitLongParagraph(paragraph, targetChars) {
    const sentences = splitSentences(paragraph);
    if (sentences.length <= 1 && paragraph.length > targetChars) {
        const chunks = [];
        let remaining = paragraph;
        while (remaining.length > targetChars) {
            let cut = remaining.lastIndexOf(' ', targetChars);
            if (cut < Math.floor(targetChars * 0.55)) cut = targetChars;
            chunks.push(remaining.slice(0, cut).trim());
            remaining = remaining.slice(cut).trim();
        }
        if (remaining) chunks.push(remaining);
        return chunks;
    }

    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        const clean = sentence.trim();
        if (!clean) continue;
        const next = current ? `${current} ${clean}` : clean;
        if (next.length <= targetChars || !current) {
            current = next;
            continue;
        }
        chunks.push(current);
        current = clean;
    }
    if (current) chunks.push(current);
    return chunks;
}

function paginateStoryText(storyText, options = {}) {
    const targetChars = clampNumber(options.targetChars, 700, 1600, 1150);
    const maxPages = clampNumber(options.maxPages, 1, 12, 10);
    const text = sanitizeLongText(storyText, options.fallback || '', 12000);
    if (!text) return [];

    const blocks = text
        .split(/\n{2,}/)
        .map(block => sanitizeLongText(block, '', 3000))
        .filter(Boolean)
        .flatMap(block => splitLongParagraph(block, targetChars));

    const pages = [];
    let current = '';

    for (const block of blocks) {
        const next = current ? `${current}\n\n${block}` : block;
        if (next.length <= targetChars || !current) {
            current = next;
            continue;
        }
        pages.push(current);
        current = block;
        if (pages.length >= maxPages - 1) break;
    }
    if (current && pages.length < maxPages) pages.push(current);

    if (pages.length === 0) pages.push(text.slice(0, targetChars));
    return pages.map(page => sanitizeLongText(page, '', targetChars + 300)).filter(Boolean);
}

function normalizeSimilarityWords(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9'\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function makeWordShingles(value, size = 5) {
    const words = normalizeSimilarityWords(value);
    if (words.length < size) return new Set(words);
    const shingles = new Set();
    for (let index = 0; index <= words.length - size; index += 1) {
        shingles.add(words.slice(index, index + size).join(' '));
    }
    return shingles;
}

function storySimilarity(candidate, source) {
    const candidateSet = makeWordShingles(candidate);
    const sourceSet = makeWordShingles(source);
    if (candidateSet.size === 0 || sourceSet.size === 0) return 0;
    let overlap = 0;
    for (const item of candidateSet) {
        if (sourceSet.has(item)) overlap += 1;
    }
    return overlap / Math.min(candidateSet.size, sourceSet.size);
}

function isStoryTooCloseToSource(candidate, source) {
    const cleanCandidate = sanitizeLongText(candidate, '', 12000).toLowerCase();
    const cleanSource = sanitizeLongText(source, '', 12000).toLowerCase();
    if (!cleanCandidate || normalizeSimilarityWords(cleanSource).length < 24) return false;
    const sourceLead = cleanSource.slice(0, 420).trim();
    if (sourceLead.length > 180 && cleanCandidate.includes(sourceLead)) return true;
    return storySimilarity(cleanCandidate, cleanSource) >= 0.64;
}

module.exports = {
    toStringSafe,
    toInt,
    clampNumber,
    slugify,
    sanitizeText,
    sanitizeLongText,
    limitAtNaturalBoundary,
    paginateStoryText,
    storySimilarity,
    isStoryTooCloseToSource
};

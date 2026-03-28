const MarkdownIt = require('markdown-it');
const { STOP_WORDS, extract_capital_sequences } = require('./tokenization2keywords/patternMatch');
const { wordsFromText, buildNGrams } = require('./tokenization2keywords');

const md = new MarkdownIt({ html: false, linkify: false });

// Maximum n-gram size to extract per heading level (h1 → 4-grams, h2 → 3-grams, …)
const HEADING_MAX_NGRAM = { 1: 4, 2: 3, 3: 2, 4: 2, 5: 1, 6: 1 };

/**
 * Tokenize text and add 1–maxN grams to the keyword set.
 */
function addNGramsFromText(text, keywords, maxN) {
    const words = wordsFromText(text);
    buildNGrams(words, 1, Math.min(maxN, words.length || 1)).forEach(ng => keywords.add(ng));
}

/**
 * Extract code-style identifiers from text:
 *   - camelCase / PascalCase  → split parts + 1-3 gram combos
 *   - snake_case              → underscore-split parts + joined
 *   - ALL_CAPS identifiers    → lowercased token
 *   - Capital multi-word sequences (e.g. "Trade Manager") → 2-4 gram phrases
 */
function addCodeIdentifiers(text, keywords) {
    const str = String(text || '');
    let m;

    // Compound tokens joined by - _ . + /  (e.g. FX-2024-00789, TRADE-TYPE-001, v1.2.3-beta)
    // Emit whole compound as 1-gram, then n-grams of the clean parts.
    const compoundRe = /[A-Za-z0-9]+(?:[-_.+/][A-Za-z0-9]+)+/g;
    while ((m = compoundRe.exec(str)) !== null) {
        keywords.add(m[0].toLowerCase());
        const parts = [];
        for (const seg of m[0].split(/[-_.+/]/)) {
            if (!seg) continue;
            if (/^\d+$/.test(seg)) {
                if (seg.length >= 2) parts.push(seg);
            } else {
                for (const w of wordsFromText(seg)) {
                    if (!parts.includes(w)) parts.push(w);
                }
            }
        }
        if (parts.length) {
            buildNGrams(parts, 1, Math.min(4, parts.length)).forEach(ng => keywords.add(ng));
        }
    }

    // camelCase and PascalCase (at least two humps)
    const camelRe = /[A-Za-z][a-z]+(?:[A-Z][a-z]+)+/g;
    while ((m = camelRe.exec(str)) !== null) {
        const words = wordsFromText(m[0]);
        buildNGrams(words, 1, Math.min(3, words.length)).forEach(ng => keywords.add(ng));
    }

    // ALLCAPS with optional underscores (e.g. "BUY_LIMIT", "HTTP", "UUID")
    const allCapsRe = /\b[A-Z][A-Z0-9]{1,}(?:_[A-Z0-9]+)*\b/g;
    while ((m = allCapsRe.exec(str)) !== null) {
        keywords.add(m[0].toLowerCase());
        if (m[0].includes('_')) {
            const parts = m[0].toLowerCase().split('_').filter(p => p.length >= 2 && !STOP_WORDS.has(p));
            buildNGrams(parts, 1, Math.min(3, parts.length)).forEach(ng => keywords.add(ng));
        }
    }

    // snake_case (at least two segments, no all-caps — those are handled above)
    const snakeRe = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/g;
    while ((m = snakeRe.exec(str)) !== null) {
        const parts = m[0].split('_').filter(p => p.length >= 2 && !STOP_WORDS.has(p));
        buildNGrams(parts, 1, Math.min(3, parts.length)).forEach(ng => keywords.add(ng));
    }

    // Capital multi-word sequences (e.g. "Risk Manager", "Order Book")
    for (const seq of extract_capital_sequences(str)) {
        const words = wordsFromText(seq);
        if (words.length >= 2) {
            buildNGrams(words, 2, Math.min(4, words.length)).forEach(ng => keywords.add(ng));
        } else if (words.length === 1 && !STOP_WORDS.has(words[0])) {
            keywords.add(words[0]);
        }
    }
}

/**
 * Extract keywords from a markdown document using structure signals:
 *   - Headings   (h1→4-grams, h2→3-grams, h3/h4→2-grams, h5/h6→1-grams)
 *   - Bold text  (1-3 grams)
 *   - Inline code spans and fenced code blocks (identifier extraction)
 *   - camelCase, PascalCase, snake_case, ALL_CAPS, and capital sequences
 *     throughout the entire document
 *
 * No external library is needed beyond markdown-it (already a dependency).
 *
 * @param {string} text  Markdown source text.
 * @returns {string[]}   Deduplicated keyword strings (1–4 grams).
 */
function extractMdKeywords(text) {
    const rawText = String(text || '');
    if (!rawText.trim()) return [];

    const keywords = new Set();

    let tokens;
    try {
        tokens = md.parse(rawText, {});
    } catch {
        tokens = [];
    }

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // ── Headings ──────────────────────────────────────────────────────
        if (token.type === 'heading_open') {
            const level = parseInt(token.tag.slice(1), 10);
            const maxN = HEADING_MAX_NGRAM[level] || 2;
            const inline = tokens[i + 1];
            if (inline && inline.type === 'inline' && inline.children) {
                const headingText = inline.children.map(c => c.content || '').join(' ');
                addNGramsFromText(headingText, keywords, maxN);
                addCodeIdentifiers(headingText, keywords);
            }
            continue;
        }

        // ── Inline tokens (bold, italic, inline code) ─────────────────────
        if (token.type === 'inline' && token.children) {
            const children = token.children;
            for (let j = 0; j < children.length; j++) {
                const child = children[j];

                // Bold / strong text → 1-3 grams
                if (child.type === 'strong_open') {
                    const parts = [];
                    let k = j + 1;
                    while (k < children.length && children[k].type !== 'strong_close') {
                        if (children[k].content) parts.push(children[k].content);
                        k++;
                    }
                    const boldText = parts.join(' ');
                    addNGramsFromText(boldText, keywords, 3);
                    addCodeIdentifiers(boldText, keywords);
                }

                // Inline code spans → identifier extraction only
                if (child.type === 'code_inline') {
                    addCodeIdentifiers(child.content || '', keywords);
                    // Also add the raw span as a 1-gram if it looks like a word
                    const raw = (child.content || '').trim();
                    if (/^[a-zA-Z][a-zA-Z0-9_.-]{1,63}$/.test(raw)) {
                        keywords.add(raw.toLowerCase());
                    }
                }
            }
        }

        // ── Code blocks ────────────────────────────────────────────────────
        if (token.type === 'fence' || token.type === 'code_block') {
            addCodeIdentifiers(token.content || '', keywords);
        }
    }

    // Scan the full raw text for code patterns not caught by the token walk
    addCodeIdentifiers(rawText, keywords);

    return [...keywords].filter(kw => kw.length >= 2);
}

module.exports = {
    extractMdKeywords
};

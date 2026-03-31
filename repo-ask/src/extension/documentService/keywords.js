/**
 * keywords.js — Categorized keyword management for RepoAsk documents.
 *
 * Keywords are stored in six named categories:
 *   title      — sliding-window n-grams of the document title
 *   structural — n-grams extracted from document title and markdown structure
 *                (headings, bold text, code identifiers, capital sequences)
 *   semantic   — keywords produced by LLM annotation (preserved across refreshes)
 *   bm25       — high-scoring n-gram tokens from BM25 corpus analysis
 *   kg         — entity tokens extracted from the mermaid knowledge graph
 *   synonyms   — morphological / pattern expansions of the other keywords
 *
 * All keywords are strings of 1–4 space-separated words (n-grams).
 * Longer n-grams carry higher search weight (see searchWeights.keywords).
 */
module.exports = function(context) {
    const { tokenize, vscode } = context;
    const { extractMdKeywords } = require('./md2keywords');
    const { SKIP_WORDS } = require('./tokenization2keywords/patternMatch');

    // ── Keyword limits (fallback values when VSCode settings are unavailable) ──
    const DEFAULT_KEYWORD_LIMIT = 100;

    function getKeywordConfig() {
        const settings = (vscode && vscode.workspace.getConfiguration('repoAsk').get('keywords')) || {};
        return {
            DEFAULT_KEYWORD_LIMIT: Number(settings.KEYWORD_LIMIT ?? DEFAULT_KEYWORD_LIMIT),
            KEYWORD_LIMIT_DOC_LOGARITHMIC_GROWTH_FACTOR: Number(settings.KEYWORD_LIMIT_DOC_LOGARITHMIC_GROWTH_FACTOR ?? 10)
        };
    }

    function getBm25Config() {
        const settings = (vscode && vscode.workspace.getConfiguration('repoAsk').get('bm25')) || {};
        return {
            k1:   Number(settings.k1  ?? 1.2),
            b:    Number(settings.b   ?? 0.75),
            topN: Number(settings.BM25_KEYWORD_LIMIT ?? 30),
            docLogFactor: Number(settings.BM25_KEYWORD_LIMIT_DOC_LOGARITHMIC_GROWTH_FACTOR ?? 10),
            docNumLogFactor: Number(settings.BM25_KEYWORD_LIMIT_DOC_NUM_LOGARITHMIC_GROWTH_FACTOR ?? 10)
        };
    }

    // ── Per-gram sub-list helpers ────────────────────────────────────────────

    function emptyGramSlots() {
        return { '1gram': {}, '2gram': {}, '3gram': {}, '4gram': {} };
    }

    function emptyCategories() {
        return {
            title:      emptyGramSlots(),
            structural: emptyGramSlots(),
            semantic:   emptyGramSlots(),
            bm25:       emptyGramSlots(),
            kg:         emptyGramSlots(),
            synonyms:   emptyGramSlots()
        };
    }

    /**
     * Count the effective gram size of a keyword string.
     * Space-separated words are counted first; if the result is 1, compound
     * tokens joined by - _ . + / are counted by their segment count instead,
     * so "fx-2024-00789" (3 segments) → 3gram, not 1gram.
     * Keywords with 4+ units all land in '4gram'.
     */
    function countGrams(kw) {
        const spaceCount = kw.trim().split(/\s+/).length;
        if (spaceCount > 1) return spaceCount;
        // Single space-word: check for compound separators
        const segCount = kw.split(/[-_.+/]/).filter(Boolean).length;
        return segCount > 1 ? segCount : 1;
    }

    /**
     * Build a per-gram-size count-map object from a raw keyword array.
     * Each occurrence of a keyword is counted, so repeated tokens (e.g. from
     * a title "fx fx fx trade") produce { '1gram': { 'fx': 3, 'trade': 1 } }.
     * Keywords shorter than 2 characters are discarded.
     */
    function categorizeByNGram(keywords) {
        const result = emptyGramSlots();
        const rawList = Array.isArray(keywords) ? keywords : normalizeKeywordsInput(keywords);
        for (const kw of rawList) {
            const cleaned = String(kw || '').trim().toLowerCase();
            if (cleaned.length < 2) continue;
            const n = countGrams(cleaned);
            const key = n >= 4 ? '4gram' : `${n}gram`;
            // Filter single-word stop words from 1-gram entries
            if (n === 1 && SKIP_WORDS.has(cleaned)) continue;
            result[key][cleaned] = (result[key][cleaned] || 0) + 1;
        }
        return result;
    }

    /**
     * Normalize a single gram-slot value to the count-map format.
     * Handles three legacy shapes plus the current format:
     *   - flat array ("[kw,kw,...]")          → categorizeByNGram (counts duplicates)
     *   - gram-slot w/ arrays ({ '1gram':[] }) → each distinct entry gets count=1
     *   - gram-slot w/ count maps (new)        → normalize keys to lowercase
     */
    function normalizeGramSlot(value) {
        if (!value) return emptyGramSlots();
        if (Array.isArray(value)) return categorizeByNGram(value);
        if (typeof value === 'object') {
            const result = emptyGramSlots();
            for (const gram of ['1gram', '2gram', '3gram', '4gram']) {
                const slot = value[gram];
                if (!slot) continue;
                if (Array.isArray(slot)) {
                    for (const kw of cleanKeywords(slot)) {
                        result[gram][kw.toLowerCase()] = 1;
                    }
                } else if (typeof slot === 'object') {
                    for (const [k, v] of Object.entries(slot)) {
                        const key = String(k).toLowerCase().trim();
                        if (key.length >= 2) result[gram][key] = Number(v) || 1;
                    }
                }
            }
            return result;
        }
        return emptyGramSlots();
    }

    // ── Normalization helpers ────────────────────────────────────────────────

    /**
     * Accept keywords as a string ("a, b, c"), array, or null/undefined.
     * Returns a clean string array.
     */
    function normalizeKeywordsInput(keywords) {
        if (typeof keywords === 'string') {
            return keywords.split(/[,;|\n]+/).map(k => k.trim()).filter(Boolean);
        }
        if (Array.isArray(keywords)) {
            return keywords.map(k => String(k || '').trim()).filter(Boolean);
        }
        return [];
    }

    /**
     * Deduplicate and length-filter keywords; optionally cap the resulting list.
     * Case-insensitive deduplification; original casing is preserved.
     */
    function cleanKeywords(keywords, limit) {
        const list = normalizeKeywordsInput(keywords);
        const seen = new Set();
        const result = [];
        for (const kw of list) {
            const lower = kw.toLowerCase();
            if (lower.length >= 2 && !seen.has(lower)) {
                seen.add(lower);
                result.push(kw);
            }
        }
        return typeof limit === 'number' ? result.slice(0, limit) : result;
    }

    /**
     * Ensure keywords is a fully-normalised category object where every slot
     * is a { '1gram': [], '2gram': [], '3gram': [], '4gram': [] } object.
     * Handles legacy flat-array keywords and the old {structural,semantic,bm25,kg} format.
     */
    function normalizeCategorizedKeywords(keywords) {
        if (Array.isArray(keywords)) {
            return { ...emptyCategories(), structural: categorizeByNGram(keywords) };
        }
        if (!keywords || typeof keywords !== 'object') {
            return emptyCategories();
        }
        return {
            title:      normalizeGramSlot(keywords.title),
            structural: normalizeGramSlot(keywords.structural),
            semantic:   normalizeGramSlot(keywords.semantic),
            bm25:       normalizeGramSlot(keywords.bm25),
            kg:         normalizeGramSlot(keywords.kg),
            synonyms:   normalizeGramSlot(keywords.synonyms)
        };
    }

    /**
     * Return all keywords as a deduplicated flat array (title → structural → semantic → bm25 → kg).
     * Works with both the new nested gram-slot format and legacy flat arrays/objects.
     */
    function flattenCategorizedKeywords(keywords) {
        if (Array.isArray(keywords)) return cleanKeywords(keywords);
        if (!keywords || typeof keywords !== 'object') return [];
        const seen = new Set();
        const result = [];
        for (const cat of ['title', 'structural', 'semantic', 'bm25', 'kg', 'synonyms']) {
            const slot = keywords[cat];
            if (!slot) continue;
            const items = Array.isArray(slot)
                ? cleanKeywords(slot)
                : ['1gram', '2gram', '3gram', '4gram'].flatMap(g => {
                    const gs = slot[g];
                    if (!gs) return [];
                    if (Array.isArray(gs)) return cleanKeywords(gs);
                    return typeof gs === 'object' ? Object.keys(gs) : [];
                });
            for (const kw of items) {
                const lower = kw.toLowerCase();
                if (!seen.has(lower)) { seen.add(lower); result.push(kw); }
            }
        }
        return result;
    }

    // ── Keyword building ─────────────────────────────────────────────────────

    /**
     * Build the full categorized keyword object for a document.
     *
     * title      — sliding-window n-grams of the document title
     * structural — md-structure n-grams (headings, bold, code identifiers)
     * bm25       — supplied BM25-scored n-grams (filled in the second pass)
     * kg         — entity tokens from the mermaid knowledgeGraph string
     * semantic   — LLM-produced keywords; pass existingSemantic to preserve them
     * synonyms   — morphological expansions; pass synonymNGrams (already n-gram object)
     *
     * @param {string}   title
     * @param {string}   summary
     * @param {string}   content        Markdown document body
     * @param {{
     *   bm25Keywords?:     string[],
     *   kgMermaid?:        string,
     *   existingSemantic?: string[],
     *   synonymNGrams?:    { '1gram': string[], '2gram': string[], '3gram': string[], '4gram': string[] }
     * }} options
     */
    /**
     * Extract entity n-gram tokens from a Mermaid diagram string.
     * Parses quoted labels, unquoted bracket labels, and CamelCase node IDs
     * to produce a richer, cleaner token list than raw tokenization of the
     * full diagram source.
     */
    function extractMermaidEntityTokens(mermaidText) {
        const raw = String(mermaidText || '');
        if (!raw.trim()) return [];
        const tokens = [];
        let m;
        const quotedLabelRe   = /[\[({]"([^"]+)"/g;
        const unquotedLabelRe = /[\[({]([A-Za-z][A-Za-z0-9 _-]{1,40})[\])}]/g;
        const nodeIdRe        = /\b([A-Z][A-Za-z0-9_]{2,})\b/g;
        while ((m = quotedLabelRe.exec(raw))   !== null) tokens.push(...tokenize(m[1], { includeNGrams: true }));
        while ((m = unquotedLabelRe.exec(raw)) !== null) tokens.push(...tokenize(m[1], { includeNGrams: true }));
        while ((m = nodeIdRe.exec(raw))        !== null) tokens.push(...tokenize(m[1], { includeNGrams: true }));
        return tokens;
    }

    function buildCategorizedKeywords(title, summary, content, options = {}) {
        const { bm25Keywords = [], kgMermaid = '', existingSemantic = [], synonymNGrams = null, totalDocumentCount = 0 } = options;

        const contentLength = String(content || '').length;
        const kwConfig = getKeywordConfig();
        const bm25Cfg = getBm25Config();

        // Effective keyword limit grows logarithmically with document length
        const effectiveKeywordLimit = Math.round(
            kwConfig.DEFAULT_KEYWORD_LIMIT +
            Math.log(contentLength + 1) * kwConfig.KEYWORD_LIMIT_DOC_LOGARITHMIC_GROWTH_FACTOR
        );

        // Effective BM25 limit grows with document length AND total document count
        const effectiveBm25Limit = Math.round(
            bm25Cfg.topN +
            Math.log(contentLength + 1) * bm25Cfg.docLogFactor +
            Math.log(totalDocumentCount + 1) * bm25Cfg.docNumLogFactor
        );

        // title: raw 1–4 grams — duplicates preserved so repeated words score higher
        const titleNGrams = tokenize(String(title || ''), { includeNGrams: true });

        // structural: n-grams from markdown structure (Set-deduplicated by md2keywords, count=1 each)
        const structuralNGrams = extractMdKeywords(String(content || ''));

        // bm25: pre-scored top-N distinct tokens (count=1 each is intentional)
        const bm25NGrams = cleanKeywords(bm25Keywords, effectiveBm25Limit);

        // kg: entity tokens extracted from Mermaid diagram labels/node IDs (with counts)
        const kgNGrams = kgMermaid ? extractMermaidEntityTokens(kgMermaid) : [];

        // semantic: LLM-annotated keywords + summary-extracted n-grams.
        // Use cleanKeywords to deduplicate before counting (LLM output is already signal-dense).
        const summaryNGrams = summary
            ? tokenize(String(summary), { includeNGrams: true })
            : [];
        const semanticNGrams = cleanKeywords(
            [...existingSemantic, ...summaryNGrams], effectiveKeywordLimit);

        return {
            title:      categorizeByNGram(titleNGrams),
            structural: categorizeByNGram(structuralNGrams),
            semantic:   categorizeByNGram(semanticNGrams),
            bm25:       categorizeByNGram(bm25NGrams),
            kg:         categorizeByNGram(kgNGrams),
            synonyms:   synonymNGrams ? normalizeGramSlot(synonymNGrams) : emptyGramSlots()
        };
    }

    // ── Merge helpers ────────────────────────────────────────────────────────

    /**
     * Replace (only) the semantic slot with new LLM keywords.
     * All other categories are preserved.
     */
    function mergeSemanticKeywords(keywords, semanticKeywords, limit = DEFAULT_KEYWORD_LIMIT) {
        const normalized = normalizeCategorizedKeywords(keywords);
        return {
            ...normalized,
            semantic: categorizeByNGram(cleanKeywords(semanticKeywords, limit))
        };
    }

    /**
     * Merge structural + lexical keyword arrays while preserving signal order.
     * Returns a categorized object with merged keywords in the structural slot.
     */
    function mergeKeywordsPreservingSignals({ structuralKeywords = [], lexicalKeywords = [], limit = DEFAULT_KEYWORD_LIMIT } = {}) {
        const merged = cleanKeywords([...structuralKeywords, ...lexicalKeywords], limit);
        return { ...emptyCategories(), structural: categorizeByNGram(merged) };
    }

    /**
     * Append new keywords to an existing flat keyword list (no duplicates).
     */
    function appendKeywordsToExisting(existing, newKws, limit = DEFAULT_KEYWORD_LIMIT) {
        return cleanKeywords([...cleanKeywords(existing), ...cleanKeywords(newKws)], limit);
    }

    // ── Metadata normalization ────────────────────────────────────────────────

    /**
     * Ensure the `keywords` field on a metadata object is always a categorized
     * object.  Legacy flat-array keywords are migrated into the structural slot.
     * Legacy top-level `synonyms` array/object is migrated into `keywords.synonyms`
     * and the top-level field is removed.
     */
    function normalizeMetadataKeywordFields(metadata) {
        if (!metadata) return metadata;
        const kws = normalizeCategorizedKeywords(metadata.keywords);
        // Migrate legacy top-level synonyms into keywords.synonyms when the slot is empty
        if (metadata.synonyms !== undefined) {
            const hasExisting = Object.values(kws.synonyms).some(obj => typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0);
            if (!hasExisting) {
                kws.synonyms = normalizeGramSlot(metadata.synonyms);
            }
        }
        const result = { ...metadata, keywords: kws };
        delete result.synonyms;   // remove legacy top-level field
        return result;
    }

    /**
     * Produce a plain-text string of all keywords + tags for building a
     * search index entry.  Used to construct keyword-only index lines.
     */
    function buildKeywordOnlyIndexText(metadata) {
        const all = flattenCategorizedKeywords(metadata?.keywords);
        const tags = Array.isArray(metadata?.tags) ? metadata.tags : [];
        return [...all, ...tags].join(' ');
    }

    return {
        getKeywordConfig,
        getBm25Config,
        buildCategorizedKeywords,
        normalizeCategorizedKeywords,
        flattenCategorizedKeywords,
        cleanKeywords,
        normalizeMetadataKeywordFields,
        buildKeywordOnlyIndexText,
        mergeKeywordsPreservingSignals,
        appendKeywordsToExisting,
        mergeSemanticKeywords,
        normalizeKeywordsInput
    };
};

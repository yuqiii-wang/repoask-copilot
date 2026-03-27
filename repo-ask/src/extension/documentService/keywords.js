module.exports = function(context) {
  const { vscode, tokenize: bm25Tokenize } = context;
  const { generateSynonyms, tokenize: kwTokenize } = require('./tokenization2keywords');
  const { extractMermaidKeywords } = require('../tools/llm');
  const { extractMdKeywords } = require('./md2keywords');
  // Alias so internal helpers that still need a 1-gram-only tokenizer keep working
  const tokenize = bm25Tokenize;

function getKeywordConfig() {
  const initKeywordNum = vscode.workspace.getConfiguration('repoAsk').get('initKeywordNum') || 40;
  return {
    DEFAULT_KEYWORD_LIMIT: initKeywordNum,
    TOKENIZATION_KEYWORD_LIMIT: Math.floor(initKeywordNum / 2),
    BM25_KEYWORD_LIMIT: initKeywordNum - Math.floor(initKeywordNum / 2)
  };
}

function buildKeywordOnlyIndexText(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return '';
  }
  const { DEFAULT_KEYWORD_LIMIT } = getKeywordConfig();
  const flat = flattenCategorizedKeywords(metadata.keywords);
  const keywords = cleanKeywords(flat, DEFAULT_KEYWORD_LIMIT * 4);
  const tags = cleanKeywords(metadata.tags, DEFAULT_KEYWORD_LIMIT * 4);
  const extended = cleanKeywords(metadata.synonyms, 200);
  return [...keywords, ...tags, ...extended].join(' ');
}

function normalizeKeywordsInput(values) {
  if (Array.isArray(values)) {
    return values;
  }
  if (typeof values === 'string') {
    return values.split(',');
  }
  return [];
}

function cleanKeywords(values, limit = getKeywordConfig().DEFAULT_KEYWORD_LIMIT) {
  const keywordValues = normalizeKeywordsInput(values);
  if (keywordValues.length === 0) {
    return [];
  }
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : getKeywordConfig().DEFAULT_KEYWORD_LIMIT;
  return [...new Set(
    keywordValues
      .map(value => String(value || '').trim())
      .filter(value => {
        if (value.length < 2) return false;
        // Remove single words longer than 30 characters (e.g. auto-generated hashes or garbage tokens)
        if (!value.includes(' ') && value.length > 30) return false;
        // Remove n-grams with more than 10 words
        if (value.includes(' ') && value.split(/\s+/).length > 10) return false;
        return true;
      })
  )].slice(0, safeLimit);
}

function normalizeMetadataKeywordFields(metadata = {}) {
  const base = metadata && typeof metadata === 'object' ? metadata : {};

  const keywords = normalizeCategorizedKeywords(base.keywords);
  const allFlat = flattenCategorizedKeywords(keywords);

  const tags = cleanKeywords(base.tags, getKeywordConfig().DEFAULT_KEYWORD_LIMIT);
  const referencedQueries = Array.isArray(base.referencedQueries)
    ? [...new Set(base.referencedQueries.map(value => String(value || '').trim()).filter(Boolean))]
    : typeof base.referencedQueries === 'string'
      ? [...new Set(base.referencedQueries.split(',').map(value => value.trim()).filter(Boolean))]
      : [];

  // Synonyms regenerated from all flattened keyword tokens
  const synonyms = cleanKeywords(generateSynonyms(allFlat), Infinity);

  return {
    ...base,
    keywords,
    tags,
    referencedQueries,
    synonyms
  };
}

function mergeKeywordsPreservingSignals({
  structuralKeywords = [],
  modelKeywords = [],
  lexicalKeywords = [],
  limit = getKeywordConfig().DEFAULT_KEYWORD_LIMIT
} = {}) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : getKeywordConfig().DEFAULT_KEYWORD_LIMIT;
  const structural = cleanKeywords(structuralKeywords, safeLimit * 2);
  const model = cleanKeywords(modelKeywords, safeLimit * 2);
  const lexical = cleanKeywords(lexicalKeywords, safeLimit * 2);
  const merged = [];
  let index = 0;

  // Interleave BM25 (model) and markdown (structural) keywords so both sources remain visible.
  // BM25 keywords come first as requested
  while (merged.length < safeLimit && (index < model.length || index < structural.length)) {
    if (index < model.length && !merged.includes(model[index])) {
      merged.push(model[index]);
    }
    if (merged.length >= safeLimit) {
      break;
    }
    if (index < structural.length && !merged.includes(structural[index])) {
      merged.push(structural[index]);
    }
    index += 1;
  }
  for (const keyword of lexical) {
    if (merged.length >= safeLimit) {
      break;
    }
    if (!merged.includes(keyword)) {
      merged.push(keyword);
    }
  }

  // Post-merge: expand compound keywords so each gram also appears as an individual keyword.
  // This ensures grams are in the stored keywords, not only at search-time normalization.
  const expanded = [...merged];
  for (const kw of merged) {
    if (kw.includes(' ')) {
      for (const g of kw.split(/\s+/)) {
        const trimmed = g.replace(/[\s`.,;:!?\-_()\[\]{}<>\/\\@#$%^&*+=~|]/g, '').trim();
        if (trimmed.length >= 2 && !expanded.includes(trimmed)) expanded.push(trimmed);
      }
    }
    if (/[-_+=$\/]/.test(kw)) {
      for (const p of kw.split(/[-_+=$\/]+/)) {
        const trimmed = p.replace(/[\s`.,;:!?\-_()\[\]{}<>\/\\@#$%^&*+=~|]/g, '').trim();
        const lp = trimmed.toLowerCase();
        if (lp.length >= 2 && !expanded.includes(lp)) expanded.push(lp);
      }
    }
  }
  return expanded;
}

function appendKeywordsToExisting(existingKeywords = [], addedKeywords = [], limit = getKeywordConfig().DEFAULT_KEYWORD_LIMIT) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : getKeywordConfig().DEFAULT_KEYWORD_LIMIT;
  const existing = cleanKeywords(existingKeywords, safeLimit * 2);
  const additions = cleanKeywords(addedKeywords, safeLimit * 2);
  const merged = [...existing];
  for (const keyword of additions) {
    if (merged.length >= safeLimit) {
      break;
    }
    if (!merged.includes(keyword)) {
      merged.push(keyword);
    }
  }
  return merged.slice(0, safeLimit);
}

// ---------------------------------------------------------------------------
// Categorized keyword helpers
// ---------------------------------------------------------------------------

/**
 * Groups a flat token array by ngram length.
 * Returns an object keyed by "1gram", "2gram", etc. up to maxNgram.
 */
function groupByNgramSize(tokens, maxNgram = 4) {
  const result = {};
  for (let n = 1; n <= maxNgram; n++) result[`${n}gram`] = [];
  for (const token of tokens) {
    const n = Math.min(String(token || '').split(/\s+/).filter(Boolean).length, maxNgram);
    if (n >= 1) result[`${n}gram`].push(String(token).toLowerCase());
  }
  return result;
}

/**
 * Builds a categorized keyword object from document fields.
 * Categories map directly to ranking weight keys:
 *   title   → NGRAM_WEIGHTS.title (multiplicative for 2gram+, additive for 1gram)
 *   summary → NGRAM_WEIGHTS.summary
 *   content → NGRAM_WEIGHTS.content  (filled in by finalizeBm25Keywords; initial pass
 *             uses structural MD keywords in 1gram)
 *   knowledge_graph → TERM_WEIGHTS.keywords (additive, exact match)
 *
 * @param {string}   title
 * @param {string}   summaryText     - existing summary (may be empty)
 * @param {string}   markdownContent - full document markdown
 * @param {Object}   [opts]
 * @param {string[]} [opts.bm25Keywords=[]]  - pre-scored BM25 tokens (1–4 gram)
 * @param {string}   [opts.kgMermaid='']     - mermaid knowledge-graph text
 */
function buildCategorizedKeywords(title, summaryText, markdownContent, opts = {}) {
  const { bm25Keywords = [], kgMermaid = '' } = opts;
  const N = getKeywordConfig().DEFAULT_KEYWORD_LIMIT;

  // Title ngrams — use keyword tokenizer which honours nGramMin/nGramMax options
  const titleTokens = kwTokenize(String(title || ''), { includeNGrams: true, nGramMin: 1, nGramMax: 3 });
  const titleBySize = groupByNgramSize(titleTokens, 3);

  // Summary ngrams
  const summaryTokens = kwTokenize(String(summaryText || ''), { includeNGrams: true, nGramMin: 1, nGramMax: 2 });
  const summaryBySize = groupByNgramSize(summaryTokens, 2);

  // Content: ensure two parts — structural MD keywords + BM25 ngrams over ALL tokens
  const mdKeywords = extractMdKeywords(String(markdownContent || ''));
  const mdBySize = groupByNgramSize(mdKeywords, 4);

  // If BM25 tokens weren't provided by caller, generate them from full content using BM25 tokenizer
  let effectiveBm25 = Array.isArray(bm25Keywords) ? bm25Keywords.slice() : [];
  if (effectiveBm25.length === 0 && typeof tokenize === 'function') {
    try {
      // `tokenize` here refers to BM25 tokenizer injected via context in keywords module
      effectiveBm25 = tokenize(String(markdownContent || ''));
    } catch (e) {
      effectiveBm25 = [];
    }
  }

  const bm25BySize = groupByNgramSize(effectiveBm25, 4);

  // Knowledge graph entities
  const kgKeywords = kgMermaid ? extractMermaidKeywords(String(kgMermaid)) : [];

  return {
    title: {
      '1gram': cleanKeywords([...new Set(titleBySize['1gram'])], N),
      '2gram': cleanKeywords([...new Set(titleBySize['2gram'])], N),
      '3gram': cleanKeywords([...new Set(titleBySize['3gram'])], N)
    },
    summary: {
      '1gram': cleanKeywords([...new Set(summaryBySize['1gram'])], N),
      '2gram': cleanKeywords([...new Set(summaryBySize['2gram'])], N)
    },
    content: {
      // Content 1gram should always include structural MD tokens (from emphasis/headers/etc.)
      '1gram': cleanKeywords([...new Set([...(mdBySize['1gram'] || []).map(k => k.toLowerCase()), ...bm25BySize['1gram']])], N),
      '2gram': cleanKeywords([...new Set([...(mdBySize['2gram'] || []).map(k => k.toLowerCase()), ...bm25BySize['2gram']])], N),
      '3gram': cleanKeywords([...new Set([...(mdBySize['3gram'] || []).map(k => k.toLowerCase()), ...bm25BySize['3gram']])], N),
      '4gram': cleanKeywords([...new Set([...(mdBySize['4gram'] || []).map(k => k.toLowerCase()), ...bm25BySize['4gram']])], N)
    },
    knowledge_graph: cleanKeywords(kgKeywords.map(k => String(k).toLowerCase()), N)
  };
}

/**
 * Normalizes a raw keywords value to a valid categorized object.
 * - New object format: validates each sub-key, initializes missing buckets.
 * - Legacy flat array: placed in the `semantic` category for graceful degradation.
 * - null/undefined: returns an empty structure.
 */
function normalizeCategorizedKeywords(kw) {
  const empty = {
    title:   { '1gram': [], '2gram': [], '3gram': [] },
    summary: { '1gram': [], '2gram': [] },
    content: { '1gram': [], '2gram': [], '3gram': [], '4gram': [] },
    knowledge_graph: [],
    semantic: []
  };

  if (Array.isArray(kw)) {
    // Legacy flat array: preserve as semantic keywords
    return { ...empty, semantic: cleanKeywords(kw, Infinity) };
  }

  if (!kw || typeof kw !== 'object') {
    return empty;
  }

  const NGRAM_SIZES = {
    title:   ['1gram', '2gram', '3gram'],
    summary: ['1gram', '2gram'],
    content: ['1gram', '2gram', '3gram', '4gram']
  };

  const result = { ...empty };
  for (const [cat, sizes] of Object.entries(NGRAM_SIZES)) {
    const catVal = kw[cat];
    result[cat] = {};
    for (const size of sizes) {
      result[cat][size] = (catVal && !Array.isArray(catVal) && Array.isArray(catVal[size]))
        ? catVal[size]
        : [];
    }
  }
  result.knowledge_graph = Array.isArray(kw.knowledge_graph) ? kw.knowledge_graph : [];
  result.semantic = Array.isArray(kw.semantic) ? kw.semantic : [];
  return result;
}

/**
 * Returns a deduplicated flat array of all keyword tokens across every category.
 * Handles both new object format and legacy arrays.
 */
function flattenCategorizedKeywords(keywords) {
  if (Array.isArray(keywords)) {
    return [...new Set(keywords.map(k => String(k).toLowerCase()))];
  }
  if (!keywords || typeof keywords !== 'object') return [];
  const result = [];
  for (const val of Object.values(keywords)) {
    if (Array.isArray(val)) {
      val.forEach(k => result.push(String(k).toLowerCase()));
    } else if (val && typeof val === 'object') {
      for (const subList of Object.values(val)) {
        if (Array.isArray(subList)) subList.forEach(k => result.push(String(k).toLowerCase()));
      }
    }
  }
  return [...new Set(result)];
}

/**
 * Merges LLM/annotation-generated keywords into the `semantic` bucket of an
 * existing categorized keyword object, preserving all other categories.
 */
function mergeSemanticKeywords(existingKw, semanticList) {
  const normalized = normalizeCategorizedKeywords(existingKw);
  const added = cleanKeywords(semanticList, getKeywordConfig().DEFAULT_KEYWORD_LIMIT);
  normalized.semantic = cleanKeywords(
    [...new Set([...normalized.semantic, ...added])],
    getKeywordConfig().DEFAULT_KEYWORD_LIMIT
  );
  return normalized;
}

  return {
    getKeywordConfig,
    buildKeywordOnlyIndexText,
    normalizeKeywordsInput,
    cleanKeywords,
    normalizeMetadataKeywordFields,
    mergeKeywordsPreservingSignals,
    appendKeywordsToExisting,
    extractMermaidKeywords,
    // Categorized keyword API
    groupByNgramSize,
    buildCategorizedKeywords,
    normalizeCategorizedKeywords,
    flattenCategorizedKeywords,
    mergeSemanticKeywords
  };
};

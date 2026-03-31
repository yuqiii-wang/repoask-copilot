/**
 * bm25Keywords.js — Corpus-level BM25 scoring for keyword extraction.
 *
 * Provides two composable steps:
 *   1. buildCorpus        — scan all documents and compute per-token IDF values
 *   2. scoreDocumentBm25  — rank tokens for a single document using BM25 TF-IDF
 *
 * Pure utility functions; VSCode / storage dependencies are kept in the caller
 * (sync.js) so this module remains easily testable.
 */

/**
 * Build corpus-level data needed for BM25 scoring.
 *
 * @param {string[]} docIds       All document IDs in the corpus.
 * @param {function} readContent  (docId) => string  — returns raw document text.
 * @param {function} tokenize     (text)  => string[] — tokenises text into n-grams.
 * @returns {{ docTokensMap: Map, docLengthMap: Map, idfMap: Map, avgDocLength: number, N: number }}
 */
function buildCorpus(docIds, readContent, tokenize) {
    const N = docIds.length;
    if (N === 0) {
        return { docTokensMap: new Map(), docLengthMap: new Map(), idfMap: new Map(), avgDocLength: 1, N: 0 };
    }

    const dfMap = new Map();
    const docTokensMap = new Map();
    const docLengthMap = new Map();
    let totalDocLength = 0;

    for (const docId of docIds) {
        const docText = readContent(docId) || '';
        const tokens = tokenize(docText);
        const tokenSet = new Set(tokens);

        docTokensMap.set(docId, tokens);
        docLengthMap.set(docId, tokens.length);
        totalDocLength += tokens.length;

        for (const token of tokenSet) {
            dfMap.set(token, (dfMap.get(token) || 0) + 1);
        }
    }

    const avgDocLength = totalDocLength / N || 1;

    const idfMap = new Map();
    for (const [token, df] of dfMap.entries()) {
        idfMap.set(token, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }

    return { docTokensMap, docLengthMap, idfMap, avgDocLength, N };
}

/**
 * Score and return the top-N BM25 keyword tokens for a single document.
 *
 * @param {string} docId
 * @param {{ docTokensMap: Map, docLengthMap: Map, idfMap: Map, avgDocLength: number }} corpus
 * @param {{ k1?: number, b?: number, topN?: number }} params  BM25 tuning parameters.
 * @returns {string[]}
 */
function scoreDocumentBm25(docId, corpus, { k1 = 1.2, b = 0.75, topN = 20 } = {}) {
    const { docTokensMap, docLengthMap, idfMap, avgDocLength } = corpus;
    const tokens = docTokensMap.get(docId);
    if (!tokens || tokens.length === 0) return [];

    const docLen = docLengthMap.get(docId);
    const tfMap = new Map();
    for (const t of tokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
    }

    const scores = [];
    for (const [token, tf] of tfMap.entries()) {
        const idf = idfMap.get(token) || 0;
        const tfScored = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLength)));
        scores.push({ token, score: idf * tfScored });
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topN).map(x => x.token);
}

module.exports = { buildCorpus, scoreDocumentBm25 };

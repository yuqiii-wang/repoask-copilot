const { wordsFromText, buildNGrams } = require('./tokenization2keywords');

/**
 * Generate 1–4 gram tokens from document text for BM25 corpus-level scoring.
 *
 * Longer n-grams receive a higher BM25 weight multiplier during ranking
 * (configured in searchWeights.BM25_NGRAM_WEIGHTS).  Returning all gram
 * sizes together allows the BM25 scorer to weigh them independently.
 *
 * @param {string} text  Raw document text (markdown or plain text).
 * @returns {string[]}   Flat array of 1-, 2-, 3-, and 4-gram token strings.
 */
function tokenization2bm25(text) {
    const words = wordsFromText(String(text || ''));
    return buildNGrams(words, 1, 4);
}

module.exports = { tokenization2bm25 };

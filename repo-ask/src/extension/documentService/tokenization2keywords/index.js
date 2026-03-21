const { tokenize, generate_ngrams } = require('./core');
const {
    patternTokenizer,
    extract_capital_sequences,
    generate_structural_regex,
    PATTERNS,
    STRUCTURAL_SEPARATORS
} = require('./patternMatch');
const { generateSynonyms } = require('./synonyms');

/**
 * Centralized API for tokenization functionality
 */
function tokenizeText(text, options = {}) {
    const {
        includeNGrams = true,
        includePatterns = true,
        nGramMin = 1,
        nGramMax = 4,
    } = options;

let primaryTokens = [];
    let secondaryTokens = [];

    // Base tokenization
    const baseTokens = tokenize(text);
    secondaryTokens = secondaryTokens.concat(baseTokens);

    // Add n-grams if enabled
    if (includeNGrams) {
        const nGrams = generate_ngrams(baseTokens, nGramMin, nGramMax);
        secondaryTokens = secondaryTokens.concat(nGrams);

        // Always extract sequences with capital letters and add as n-grams     
        const capitalSequences = extract_capital_sequences(text);
        if (capitalSequences && capitalSequences.length > 0) {
            primaryTokens = primaryTokens.concat(capitalSequences);
        }
    }

    // Add pattern-based tokens if enabled
    if (includePatterns) {
        const patternTokens = patternTokenizer(text);
        secondaryTokens = secondaryTokens.concat(patternTokens);
    }

    // Deduplicate tokens while preserving order
    const uniqueTokens = [];
    const seen = new Set();
    const allTokens = [...primaryTokens, ...secondaryTokens];

    for (const token of allTokens) {
        if (!seen.has(token)) {
            seen.add(token);
            uniqueTokens.push(token);
        }
    }

    return uniqueTokens;
}

module.exports = {
    tokenize: tokenizeText,
    generateSynonyms
};

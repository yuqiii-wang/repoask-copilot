const { PATTERNS } = require('./patterns');
const { generate_structural_regex } = require('./structural');
const { generate_ngrams } = require('./ngrams');
const { extract_capital_sequences } = require('./extractors');
const { generateExtendedKeywords } = require('./extendedKeywords');
const { tokenize } = require('./tokenize');

function identify_pattern(token) {
    const clean_token = token.replace(/^[.,;:()\[\]{}'"\s]+|[.,;:()\[\]{}'"\s]+$/g, '');

    for (const [, regex] of PATTERNS) {
        if (regex.test(clean_token)) {
            return generate_structural_regex(clean_token);
        }
    }
    return null;
}

module.exports = {
    tokenize,
    generate_structural_regex,
    generate_ngrams,
    identify_pattern,
    extract_capital_sequences,
    generateExtendedKeywords
};

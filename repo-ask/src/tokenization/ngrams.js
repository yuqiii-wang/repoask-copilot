function generate_ngrams(tokens, n_min = 1, n_max = 5) {
    const ngrams = new Set();

    if (n_min <= 1) {
        tokens.forEach(token => ngrams.add(token));
    }

    const start_n = Math.max(2, n_min);

    for (let n = start_n; n <= n_max; n++) {
        if (tokens.length < n) {
            continue;
        }
        for (let i = 0; i <= tokens.length - n; i++) {
            const phrase = tokens.slice(i, i + n).join(' ');
            ngrams.add(phrase);
        }
    }

    return Array.from(ngrams);
}

module.exports = {
    generate_ngrams
};
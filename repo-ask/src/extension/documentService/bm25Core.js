const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

function bm25Idf(term, stats) {
    const df = Number(stats.docFreq[term] || 0);
    const numerator = (stats.totalDocs - df + 0.5);
    const denominator = (df + 0.5);
    if (denominator <= 0) {
        return 0;
    }
    return Math.log(1 + (numerator / denominator));
}

function bm25TermScore(term, doc, stats, options = {}) {
    const tf = Number(doc?.tf?.[term] || 0);
    if (tf <= 0) {
        return 0;
    }

    const k1 = Number.isFinite(options.k1) ? options.k1 : DEFAULT_K1;
    const b = Number.isFinite(options.b) ? options.b : DEFAULT_B;
    const avgLength = stats.avgDocLength > 0 ? stats.avgDocLength : 1;
    const dl = Number(doc.length || 0);
    const idf = bm25Idf(term, stats);
    const denominator = tf + k1 * (1 - b + (b * dl / avgLength));
    if (denominator <= 0) {
        return 0;
    }

    return idf * ((tf * (k1 + 1)) / denominator);
}

module.exports = {
    bm25Idf,
    bm25TermScore,
    DEFAULT_K1,
    DEFAULT_B
};

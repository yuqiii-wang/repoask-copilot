const TurndownService = require('turndown');
const {
    
    generateSynonyms
} = require('./tokenization2keywords');

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**'
});

function truncate(value, maxLen) {
    if (!value || value.length <= maxLen) {
        return value;
    }
    return `${value.slice(0, maxLen)}...`;
}

function jiraTextToMarkdown(jiraText) {
    let processedText = String(jiraText || '').trim();

    // Handle Jira headings: h1., h2., h3., h4.
    processedText = processedText
        .replace(/^h1\.\s+/gm, '# ')
        .replace(/^h2\.\s+/gm, '## ')
        .replace(/^h3\.\s+/gm, '### ')
        .replace(/^h4\.\s+/gm, '#### ');

    // Ensure proper line breaks
    processedText = processedText.replace(/\r?\n/g, '\n');

    return processedText;
}

function htmlToMarkdown(html) {
    return turndownService.turndown(String(html || '')).trim();
}

function generateSummary(text, maxLength = 220) {
    const sentences = String(text || '').split(/[.!?]+/).filter(s => s.trim().length > 0);
    let summary = '';
    let length = 0;

    for (const sentence of sentences) {
        const sentenceTrimmed = sentence.trim();
        if (length + sentenceTrimmed.length + 1 <= maxLength) {
            summary += sentenceTrimmed + '. ';
            length += sentenceTrimmed.length + 1;
        } else {
            break;
        }
    }

    return summary.trim() || truncate(String(text || '').trim(), maxLength) || 'No summary available';
}

module.exports = {
    truncate,
    htmlToMarkdown,
    jiraTextToMarkdown,
    generateSummary,
    generateSynonyms
};

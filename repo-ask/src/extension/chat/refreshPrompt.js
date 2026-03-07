function isRefreshPrompt(prompt) {
    const lowered = String(prompt || '').toLowerCase();
    return lowered.includes('refresh')
        || lowered.includes('sync')
        || lowered.includes('download')
        || lowered.includes('fetch')
        || lowered.includes('pull')
        || lowered.includes('import')
        || lowered.includes('update')
        || lowered.includes('confluence')
        || lowered.includes('jira')
        || /https?:\/\//i.test(prompt)
        || /(?:pageid=|\b)\d{1,8}(?:\b|$)/i.test(prompt)
        || /[A-Z][A-Z0-9_]+-\d+/i.test(prompt);
}

module.exports = {
    isRefreshPrompt
};

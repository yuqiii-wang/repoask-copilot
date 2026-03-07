function registerRefreshAndParseCommands(deps) {
    const {
        vscode,
        sidebar,
        documentService,
        parseRefreshArg
    } = deps;

    const refreshDisposable = vscode.commands.registerCommand('repo-ask.refresh', async function (directArg) {
        const arg = typeof directArg === 'string' ? directArg : await vscode.window.showInputBox({
            prompt: 'Enter Confluence page id/title/link or Jira issue key, or leave empty to refresh all Confluence docs',
            placeHolder: 'e.g., 1, Technical Documentation Guide, Confluence URL, or PROJECT-1003'
        });

        try {
            sidebar.setSidebarSyncStatus('');
            const formatRefreshStatus = (sourceLabel, progress = {}) => {
                const index = Number(progress?.index);
                const total = Number(progress?.total);
                const hasFraction = Number.isFinite(index) && Number.isFinite(total) && total > 0;
                const progressSuffix = hasFraction ? ` (${index}/${total})` : '';
                return `downloading from ${sourceLabel} ...${progressSuffix}`;
            };

            const createRefreshOptions = (sourceLabel) => ({
                onDocumentProcessed: ({ metadata, index, total }) => {
                    sidebar.upsertSidebarDocument(metadata);
                    sidebar.setSidebarSyncStatus(formatRefreshStatus(sourceLabel, { index, total }));
                }
            });

            if (arg && arg.trim().length > 0) {
                const parsed = await parseRefreshArg(vscode, arg.trim());
                sidebar.setSidebarSyncStatus('downloading from confluence/jira cloud ...');
                if (parsed.found && parsed.source === 'regex-jira') {
                    await documentService.refreshJiraIssue(parsed.arg, createRefreshOptions('jira'));
                    vscode.window.showInformationMessage(`Refreshed Jira issue for: ${parsed.arg}`);
                } else {
                    const resolvedArg = parsed.found && parsed.arg ? parsed.arg : arg.trim();
                    await documentService.refreshDocument(resolvedArg, createRefreshOptions('confluence cloud'));
                    vscode.window.showInformationMessage(`Refreshed document for: ${resolvedArg}`);
                }
            } else {
                const downloadingMessage = 'downloading from confluence/jira cloud ...';
                vscode.window.showInformationMessage(downloadingMessage);
                sidebar.setSidebarSyncStatus(downloadingMessage);
                await documentService.refreshAllDocuments(createRefreshOptions('confluence cloud'));
                vscode.window.showInformationMessage('Refreshed all documents');
            }

            sidebar.refreshSidebarView();
        } catch (error) {
            vscode.window.showErrorMessage(`Error refreshing documents: ${error.message}`);
        } finally {
            sidebar.setSidebarSyncStatus('');
            sidebar.refreshSidebarView();
        }
    });

    const parseArgDisposable = vscode.commands.registerCommand('repo-ask.parseArg', async function (sourceInput) {
        return await parseRefreshArg(vscode, sourceInput);
    });

    return [refreshDisposable, parseArgDisposable];
}

module.exports = {
    registerRefreshAndParseCommands
};

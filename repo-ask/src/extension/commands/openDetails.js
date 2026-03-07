function registerOpenDetailsCommand(deps) {
    const {
        vscode,
        storagePath,
        sidebar,
        readAllMetadata,
        readDocumentContent,
        formatDocumentDetails
    } = deps;

    const openDocumentDetailsDisposable = vscode.commands.registerCommand('repo-ask.openDocumentDetails', async function (docArg) {
        const doc = typeof docArg === 'string'
            ? readAllMetadata(storagePath).find(metadata => String(metadata.id) === docArg)
            : docArg;

        if (!doc || !doc.id) {
            vscode.window.showWarningMessage('Document metadata not found. Run refresh and try again.');
            return;
        }

        const content = readDocumentContent(storagePath, doc.id) || 'No local markdown content found.';

        const document = await vscode.workspace.openTextDocument({
            language: 'plaintext',
            content: formatDocumentDetails(doc, content)
        });
        await vscode.window.showTextDocument(document, { preview: false });
    });

    const revealDocumentInSidebarDisposable = vscode.commands.registerCommand('repo-ask.revealDocumentInSidebar', async function (docArg) {
        const docId = String(typeof docArg === 'object' ? docArg?.id : docArg || '').trim();
        if (!docId) {
            vscode.window.showWarningMessage('Document id is required to reveal in sidebar.');
            return;
        }

        if (!sidebar || typeof sidebar.revealDocumentInSidebar !== 'function') {
            vscode.window.showWarningMessage('RepoAsk sidebar is not ready yet. Open the sidebar and try again.');
            return;
        }

        const revealed = sidebar.revealDocumentInSidebar(docId);
        if (!revealed) {
            vscode.window.showWarningMessage(`Document ${docId} was not found in local store.`);
        }
    });

    return [openDocumentDetailsDisposable, revealDocumentInSidebarDisposable];
}

module.exports = {
    registerOpenDetailsCommand
};

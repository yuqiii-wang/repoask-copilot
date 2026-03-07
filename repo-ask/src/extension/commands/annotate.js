function registerAnnotateCommand(deps) {
    const {
        vscode,
        sidebar,
        documentService
    } = deps;

    const annotateDisposable = vscode.commands.registerCommand('repo-ask.annotate', async function (directArg) {
        const arg = typeof directArg === 'string' ? directArg : await vscode.window.showInputBox({
            prompt: 'Enter page id/title/link to annotate one doc, or leave empty to annotate all local docs',
            placeHolder: 'e.g., 1, Technical Documentation Guide, or a Confluence URL'
        });

        try {
            const result = arg && arg.trim().length > 0
                ? await documentService.annotateDocumentByArg(arg.trim())
                : await documentService.annotateAllDocuments();

            vscode.window.showInformationMessage(result.message);
            sidebar.refreshSidebarView();
        } catch (error) {
            vscode.window.showErrorMessage(`Error annotating documents: ${error.message}`);
        }
    });

    return [annotateDisposable];
}

module.exports = {
    registerAnnotateCommand
};

/**
 * Command to show the log action button and store logged prompts
 */

module.exports = function createShowLogActionButtonCommand(deps) {
    const { vscode, context, sidebar } = deps;

    return vscode.commands.registerCommand('repo-ask.showLogActionButton', async (firstUserQuery, firstRankedDocUrl, fullAiResponse) => {
        // Store the logged prompt in globalState to archive the chat
        if (firstUserQuery && context) {
            const loggedPrompts = context.globalState.get('repoAsk.loggedPrompts', []);
            if (!loggedPrompts.includes(firstUserQuery)) {
                loggedPrompts.push(firstUserQuery);
                await context.globalState.update('repoAsk.loggedPrompts', loggedPrompts);
            }
        }
        
        // Show the feedback form with the first user query, first ranked doc URL, and full AI response.
        if (sidebar) {
            sidebar.showLogActionButton(firstUserQuery, firstRankedDocUrl, fullAiResponse);
        }
    });
};
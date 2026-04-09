/**
 * Command triggered by the "Continue — Run Production Support Main" button.
 * Opens a new @repoask /production-support chat turn prefixed with [MAIN] so
 * the participant routes directly to the main-skill handler, picking up the
 * pending-plan.json that the plan skill previously saved.
 */
export default function createProductionSupportMainCommand(deps: any) {
    const { vscode } = deps;

    return vscode.commands.registerCommand('repo-ask.runProductionSupportMain', async (originalPrompt: any) => {
        const query = String(originalPrompt || '').trim();

        await vscode.commands.executeCommand('workbench.action.chat.open', {
            query: `@repoask /production-support [MAIN] ${query}`,
            isPartialQuery: false
        });
    });
}

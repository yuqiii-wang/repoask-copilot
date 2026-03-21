const registerDocRankTool = require('./docRankTool');
const registerDocCheckTool = require('./docCheckTool');

function createLanguageModelTools(deps) {
    const { vscode } = deps;

    function registerRepoAskLanguageModelTools() {
        if (!vscode.lm || typeof vscode.lm.registerTool !== 'function') {
            return [];
        }

        const docRankTool = registerDocRankTool(deps);
        const docCheckTool = registerDocCheckTool(deps);

        return [docRankTool, docCheckTool];
    }

    return {
        registerRepoAskLanguageModelTools
    };
}

module.exports = {
    createLanguageModelTools
};

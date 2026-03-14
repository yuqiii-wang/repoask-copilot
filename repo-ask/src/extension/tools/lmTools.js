const registerRankTool = require('./rankTool');
const registerCheckTool = require('./checkTool');
const registerCodeCheckTool = require('./codeCheckTool');
const registerReadRepoPromptsTool = require('./readRepoPromptsTool');
const registerCodeSplitterTool = require('./codeSplitterTool');

function createLanguageModelTools(deps) {
    const { vscode } = deps;

    function registerRepoAskLanguageModelTools() {
        if (!vscode.lm || typeof vscode.lm.registerTool !== 'function') {       
            return [];
        }

        const rankTool = registerRankTool(deps);
        const checkTool = registerCheckTool(deps);
        const codeCheckTool = registerCodeCheckTool(deps);
        const readRepoPromptsTool = registerReadRepoPromptsTool(deps);
        const codeSplitterTool = registerCodeSplitterTool(deps);

        return [rankTool, checkTool, codeCheckTool, readRepoPromptsTool, codeSplitterTool];
    }

    return {
        registerRepoAskLanguageModelTools
    };
}

module.exports = {
    createLanguageModelTools
};

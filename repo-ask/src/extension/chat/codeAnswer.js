const fs = require('fs');
const path = require('path');
const {
    looksLikeNotFoundAnswer,
    selectDefaultChatModel,
    runModelWithTools
} = require('./shared');



async function answerCodePromptQuestion(vscodeApi, prompt, workspacePromptContext, response, deps, options = {}) {
    const {
        tokenize,
        rankDocumentsByIdf
    } = deps;

    if (!vscodeApi.lm || !vscodeApi.LanguageModelChatMessage) {
        response.markdown('No language model is available in this VS Code session.');
        return;
    }

    const model = await selectDefaultChatModel(vscodeApi, options);
    if (!model) {
        response.markdown('No language model is available in this VS Code session.');
        return;
    }

    const isOnCode = options.scenario === 'code';
    let contextText = String(workspacePromptContext || '').trim();

    try {
        const workspaceFolders = vscodeApi.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const rootPath = workspaceFolders[0].uri.fsPath;
            const promptsPath = path.join(rootPath, '.github', 'prompts');
            if (fs.existsSync(promptsPath)) {
                if (typeof response.progress === 'function') {
                    response.progress('Checking workspace prompts...');
                }
                const files = fs.readdirSync(promptsPath);
                for (const file of files) {
                    if (file.endsWith('.md')) {
                        const content = fs.readFileSync(path.join(promptsPath, file), 'utf8');
                        const checkMsg = vscodeApi.LanguageModelChatMessage.User(`Given the user query: "${prompt}", is the following guideline relevant? Reply with ONLY "YES" or "NO".\n\nGuideline (${file}):\n${content}`);
                        const checkRes = await model.sendRequest([checkMsg], {}, options.token);
                        let isRelevantText = '';
                        for await (const chunk of checkRes.text) {
                            isRelevantText += chunk;
                        }
                        if (isRelevantText.toUpperCase().includes('YES')) {
                            contextText += `\n\n--- Content from .github/prompts/${file} ---\n${content}\n`;
                            if (typeof response.reference === 'function') {
                                response.reference(vscodeApi.Uri.file(path.join(promptsPath, file)));
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error reading prompts:', e);
    }

    let instruction = [
        'You are RepoAsk Code Agent. Your goal is to help the user with local code review and changes.',
        '- You MUST NOT hallucinate any code or information that is not explicitly present in the retrieved documents or code.',
        '- If no relevant documents or code are found, you MUST explicitly state that you cannot answer the question based on the available information.',
        '- You MUST cite the specific documents or code sources you used to form your answer.',
        '- If asked to update or rewrite code, output the code changes in your message as a unified diff. Always ask the user if they want to apply the changes directly in code or create a new file.',
        '- If there is no need to change code based on the question, answer the question with the provided code and prompt context.',
        '',
        contextText ? `Workspace guidelines:\n${contextText}` : 'Workspace guidelines: (none)',
        `User question: ${prompt}`
    ].join('\n\n');

    // No tools needed, just use the model directly with prompt context
    const finalText = await runModelWithTools({
        vscodeApi,
        model,
        response,
        instruction,
        tools: [],
        options
    });

    // Check if we have any documents
    let hasDocuments = options.metadataList && options.metadataList.length > 0;

    // Check if the answer indicates no relevant docs were found
    const isNotFoundAnswer = !finalText || looksLikeNotFoundAnswer(finalText);

    // Ensure we always send a response, even if empty
    if (isNotFoundAnswer) {
        response.markdown('No relevant docs found, you can search from doc store and find the doc id/title or more keywords to help locate the search');
    } else {
        response.markdown(finalText);
    }

}

module.exports = {
    answerCodePromptQuestion
};
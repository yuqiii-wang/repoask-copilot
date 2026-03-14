const fs = require('fs');
const path = require('path');
const { LLM_RESPONSE_TIMEOUT_MS, toSentenceCase, emitThinking, looksLikeNotFoundAnswer, withTimeout } = require('./shared');

async function answerGeneralPromptQuestion(vscodeApi, prompt, workspacePromptContext, response, deps, options = {}) {
    const {
        truncate,
        tokenize,
        rankDocumentsByIdf
    } = deps;

    if (!vscodeApi.lm || !vscodeApi.LanguageModelChatMessage) {
        response.markdown('No language model is available in this VS Code session.');
        return;
    }

    const models = await withTimeout(vscodeApi.lm.selectChatModels({}), LLM_RESPONSE_TIMEOUT_MS, []);
    const model = models?.[0];
    if (!model) {
        response.markdown('No language model is available in this VS Code session.');
        return;
    }

    const contextText = String(workspacePromptContext || '').trim();

    let instruction = [
        'You are RepoAsk Doc Agent. Your goal is to help the user answer general questions from the document store.',
        'Wait for tool results before explaining the final answer.',
        '- You MUST rely on the `local-store` via tools to find the answer.',
        '- Use `repoask_rank` tool with limit 10 to select the top 10 docs.',
        '- Read content with `repoask_read_content` and base your answer solely on the retrieved text.',
        '- You MUST NOT hallucinate any information that is not explicitly present in the retrieved documents.',
        '- If no relevant documents are found or if the documents do not contain enough information to answer the question, you MUST explicitly state that you cannot answer the question based on the available documents.',
        '- You MUST cite the specific documents you used to form your answer, including document IDs and titles.',
        '- You MUST output a summary of the checked documents in relation to the question, even if ALL docs are irrelevant.',
        '',
        'Workspace guidelines: (none)',
        `User question: ${prompt}`
    ].join('\n\n');

    const messages = [
        vscodeApi.LanguageModelChatMessage.User(instruction)
    ];

    const MAX_ITERATIONS = 7;
    let iterations = 0;
    
    let toolsToUse = (vscodeApi.lm.tools || []).filter(t => t.name.startsWith('repoask_'));
    toolsToUse = toolsToUse.filter(t => t.name !== 'repoask_new_code_check' && t.name !== 'repoask_read_repo_prompts');

    const requestOptions = {
        tools: toolsToUse
    };

    let finalText = '';

    while (iterations < MAX_ITERATIONS) {
        iterations++;
        
        let modelResponse;
        try {
            modelResponse = await withTimeout(model.sendRequest(messages, requestOptions), LLM_RESPONSE_TIMEOUT_MS, null);
        } catch (e) {
            finalText = finalText || `Error calling language model: ${e.message}`;
            break;
        }

        if (!modelResponse) {
            finalText = finalText || 'No answer returned by the language model.';
            break;
        }

        const toolCalls = [];
        let chunkText = '';

        if (modelResponse.stream) {
            for await (const chunk of modelResponse.stream) {
                if (chunk instanceof vscodeApi.LanguageModelTextPart) {
                    chunkText += chunk.value;
                    response.markdown(chunk.value);
                } else if (chunk instanceof vscodeApi.LanguageModelToolCallPart) {
                    toolCalls.push(chunk);
                }
            }
        }

        if (chunkText) {
            finalText += chunkText;
        }

        if (toolCalls.length === 0) {
            break;
        }

        messages.push(vscodeApi.LanguageModelChatMessage.Assistant([
            ...(chunkText ? [new vscodeApi.LanguageModelTextPart(chunkText)] : []),
            ...toolCalls
        ]));

        for (const toolCall of toolCalls) {
            try {
                emitThinking(response, `Invoking tool ${toolCall.name}...`);
                const result = await vscodeApi.lm.invokeTool(
                    toolCall.name, 
                    { input: toolCall.input, toolInvocationToken: options.request?.toolInvocationToken }
                );
                
                messages.push(vscodeApi.LanguageModelChatMessage.User([
                    new vscodeApi.LanguageModelToolResultPart(toolCall.callId, result.content)
                ]));
            } catch (err) {
                emitThinking(response, `Error invoking tool ${toolCall.name}: ${err.message}`);
                messages.push(vscodeApi.LanguageModelChatMessage.User([
                    new vscodeApi.LanguageModelToolResultPart(toolCall.callId, [new vscodeApi.LanguageModelTextPart(`Error: ${err.message}`)])
                ]));
            }
        }
    }

    // Get first ranked doc URL if available
    let firstRankedDocUrl = '';
    let hasRankedDocs = false;
    if (options.metadataList && options.metadataList.length > 0) {
        // Check if we have any documents at all
        hasRankedDocs = true;
        
        // Rank documents by relevance to the prompt
        const rankedDocs = rankDocumentsByIdf(
            prompt,
            options.metadataList.map((doc) => ({ ...doc, content: '' })),
            tokenize,
            { limit: 1, minScore: 0 }
        );
        if (rankedDocs && rankedDocs.length > 0) {
            const firstDoc = rankedDocs[0];
            // Assuming the doc has a URL property, adjust as needed
            firstRankedDocUrl = firstDoc.url || firstDoc.link || '';
        }
    }

    // Check if the answer indicates no relevant docs were found
    const isNotFoundAnswer = !finalText || looksLikeNotFoundAnswer(finalText);

    // Ensure we always send a response, even if empty
    if (isNotFoundAnswer) {
        response.markdown('No relevant docs found, you can search from doc store and find the doc id/title or more keywords to help locate the search');
    } else {
        response.button({
            command: 'repo-ask.showLogActionButton',
            title: 'Log Action',
            arguments: [prompt, firstRankedDocUrl, finalText]
        });
    }

}

module.exports = {
    answerGeneralPromptQuestion
};

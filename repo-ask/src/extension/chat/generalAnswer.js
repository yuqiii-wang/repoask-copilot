const fs = require('fs');
const path = require('path');

const LLM_RESPONSE_TIMEOUT_MS = 30000;
const CHAT_METADATA_RANK_LIMIT = 5;
const CHAT_THINKING_DOC_LIST_LIMIT = 25;
const CHAT_REFERENCE_BUTTON_LIMIT = 5;
const CHAT_TEXT_CHUNK_SIZE = 3500;

function toSentenceCase(text) {
    const value = String(text || '').trim();
    if (!value) {
        return '';
    }

    const normalized = value.endsWith('.') ? value : `${value}.`;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function emitThinking(response, message) {
    response.progress(toSentenceCase(message));
}

function splitIntoChunks(text, maxChars = CHAT_TEXT_CHUNK_SIZE) {
    const value = String(text || '');
    if (!value) {
        return [];
    }

    const safeSize = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : CHAT_TEXT_CHUNK_SIZE;
    const chunks = [];
    let index = 0;

    while (index < value.length) {
        const remaining = value.length - index;
        if (remaining <= safeSize) {
            chunks.push(value.slice(index));
            break;
        }

        const target = index + safeSize;
        const splitAt = Math.max(
            value.lastIndexOf('\n\n', target),
            value.lastIndexOf('\n', target),
            value.lastIndexOf(' ', target)
        );

        if (splitAt <= index) {
            chunks.push(value.slice(index, target));
            index = target;
            continue;
        }

        chunks.push(value.slice(index, splitAt));
        index = splitAt;
    }

    return chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
}

function emitFullTextResponse(response, text) {
    const chunks = splitIntoChunks(text, CHAT_TEXT_CHUNK_SIZE);
    if (chunks.length === 0) {
        return;
    }

    for (const chunk of chunks) {
        response.markdown(chunk);
    }
}

function looksLikeNotFoundAnswer(text) {
    const value = String(text || '').toLowerCase();
    if (!value) {
        return false;
    }

    return value.includes('not found in the provided context')
        || value.includes('not present in the provided context')
        || value.includes('not enough information in the provided context')
        || value.includes('cannot find this in the provided context')
        || value.includes('unable to find this in the provided context')
        || value.includes('i do not have enough context')
        || value.includes('insufficient context');
}

function isDiffLikeResponse(text) {
    const value = String(text || '');
    if (!value.trim()) {
        return false;
    }

    if (/```diff[\s\S]*?```/i.test(value)) {
        return true;
    }

    const hasUnifiedMarkers = /(^|\n)(@@\s.*?@@|---\s+\S+|\+\+\+\s+\S+)/m.test(value);
    const hasHunkLines = /(^|\n)(\+(?!\+\+\+)|-(?!---)).+/m.test(value);
    return hasUnifiedMarkers && hasHunkLines;
}

function buildDiffParagraph(text) {
    const value = String(text || '');
    const addedLines = (value.match(/(^|\n)\+(?!\+\+\+).+/g) || []).length;
    const removedLines = (value.match(/(^|\n)-(?!---).+/g) || []).length;
    const files = Array.from(new Set(
        (value.match(/^\+\+\+\s+[^\n]+/gm) || [])
            .map((line) => line.replace(/^\+\+\+\s+/, '').trim())
            .filter((line) => line.length > 0)
    ));

    const fileText = files.length > 0
        ? ` It touches ${files.length} file${files.length === 1 ? '' : 's'}: ${files.join(', ')}.`
        : '';

    return [
        '## Diff paragraph',
        `This response includes a patch-style diff with ${addedLines} added line${addedLines === 1 ? '' : 's'} and ${removedLines} removed line${removedLines === 1 ? '' : 's'}.${fileText} Review each hunk before applying.`
    ].join('\n\n');
}

function ensureDiffParagraph(text) {
    const value = String(text || '').trim();
    if (!value) {
        return value;
    }

    if (!isDiffLikeResponse(value)) {
        return value;
    }

    if (/^##\s+Diff paragraph\b/im.test(value) || /\bDiff paragraph\b/i.test(value)) {
        return value;
    }

    return `${value}\n\n${buildDiffParagraph(value)}`;
}

function buildReferencesMarkdown(references) {
    const docs = Array.isArray(references) ? references : [];
    if (docs.length === 0) {
        return '';
    }

    const lines = docs.map((doc, index) => `- ${index + 1}. ${doc.title || 'Untitled'} [${doc.id ?? '-'}]`);
    return ['## References', ...lines].join('\n');
}

async function withTimeout(promise, timeoutMs, timeoutValue = null) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(timeoutValue), timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
}

function formatMetadataForPrompt(doc, truncate) {
    return [
        `id: ${doc.id ?? ''}`,
        `title: ${doc.title || 'Untitled'}`,
        `author: ${doc.author || 'Unknown'}`,
        `last_updated: ${doc.last_updated || ''}`,
        `parent_confluence_topic: ${doc.parent_confluence_topic || ''}`,
        `keywords: ${(Array.isArray(doc.keywords) ? doc.keywords : []).join(', ')}`,
        `summary: ${truncate(doc.summary || '', 240)}`
    ].join('\n');
}

function buildMetadataContextForPrompt(metadataList, truncate) {
    if (!Array.isArray(metadataList) || metadataList.length === 0) {
        return '';
    }

    return metadataList
        .map((doc, index) => `## Doc ${index + 1}\n${formatMetadataForPrompt(doc, truncate)}`)
        .join('\n\n');
}

function summarizeDocTitlesForThinking(docs) {
    if (!Array.isArray(docs) || docs.length === 0) {
        return 'none';
    }

    const visible = docs.slice(0, CHAT_THINKING_DOC_LIST_LIMIT)
        .map(doc => `${doc.title || 'Untitled'} [${doc.id ?? '-'}]`);
    const hiddenCount = docs.length - visible.length;
    const suffix = hiddenCount > 0 ? `, and ${hiddenCount} more` : '';
    return `${visible.join('; ')}${suffix}`;
}

function selectMetadataForQuestion(question, metadataList, rankDocumentsByIdf, tokenize) {
    const normalizedList = Array.isArray(metadataList) ? metadataList : [];
    if (normalizedList.length === 0) {
        return {
            selectedMetadata: [],
            useAllMetadataFallback: false,
            rankedMetadata: []
        };
    }

    const rankedMetadata = rankDocumentsByIdf(
        question,
        normalizedList.map((doc) => ({ ...doc, content: '' })),
        tokenize,
        { limit: Math.min(CHAT_METADATA_RANK_LIMIT, normalizedList.length), minScore: 0 }
    );

    const selectedMetadata = rankedMetadata
        .filter((doc) => Number(doc.score) > 0)
        .slice(0, CHAT_METADATA_RANK_LIMIT);

    if (selectedMetadata.length > 0) {
        return {
            selectedMetadata,
            useAllMetadataFallback: false,
            rankedMetadata
        };
    }

    return {
        selectedMetadata: normalizedList,
        useAllMetadataFallback: true,
        rankedMetadata
    };
}

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

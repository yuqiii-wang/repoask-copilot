/**
 * Shared utilities for chat functionality
 */

/**
 * Timeout duration for LLM responses in milliseconds
 * @constant {number}
 */
exports.LLM_RESPONSE_TIMEOUT_MS = 30000;

/**
 * Converts text to sentence case
 * @param {string} text - The text to convert
 * @returns {string} The text in sentence case
 */
exports.toSentenceCase = function toSentenceCase(text) {
    const value = String(text || '').trim();
    if (!value) {
        return '';
    }

    const normalized = value.endsWith('.') ? value : `${value}.`;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

/**
 * Emits a thinking progress message
 * @param {Object} response - The response object with a progress method
 * @param {string} message - The message to emit
 */
exports.emitThinking = function emitThinking(response, message) {
    if (typeof response.progress === 'function') {
        response.progress(message);
    }
};

/**
 * Checks if an answer indicates no relevant documents were found
 * @param {string} text - The answer text to check
 * @returns {boolean} True if the answer indicates no relevant docs were found
 */
exports.looksLikeNotFoundAnswer = function looksLikeNotFoundAnswer(text) {
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
};

/**
 * Adds timeout functionality to a promise
 * @param {Promise} promise - The promise to add timeout to
 * @param {number} timeoutMs - The timeout duration in milliseconds
 * @param {*} timeoutValue - The value to return if timeout occurs
 * @returns {Promise} A promise that resolves with the original promise result or timeout value
 */
exports.withTimeout = async function withTimeout(promise, timeoutMs, timeoutValue = null) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(timeoutValue), timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
};

/**
 * Selects the default chat model for this VS Code session.
 * @param {Object} vscodeApi - VS Code API object
 * @param {Object} [options] - Options containing the chat request object
 * @returns {Promise<Object|null>} Selected chat model or null if unavailable
 */
exports.selectDefaultChatModel = async function selectDefaultChatModel(vscodeApi, options = {}) {
    if (!vscodeApi?.lm || !vscodeApi?.LanguageModelChatMessage) {
        return null;
    }

    if (options.request && options.request.model) {
        console.log(`[RepoAsk] Selected chat model from request: ${options.request.model.name || options.request.model.id || 'unknown'}`);
        return options.request.model;
    }

    const models = await exports.withTimeout(
        vscodeApi.lm.selectChatModels({}),
        exports.LLM_RESPONSE_TIMEOUT_MS,
        []
    );

    const fallbackModel = models?.[0] || null;
    if (fallbackModel) {
        console.log(`[RepoAsk] Selected fallback chat model: ${fallbackModel.name || fallbackModel.id || 'unknown'}`);
    } else {
        console.log(`[RepoAsk] No chat model available.`);
    }

    return fallbackModel;
};

/**
 * Truncates text for concise thinking/progress updates.
 * @param {string} text - Source text
 * @param {number} maxLen - Maximum preview length
 * @returns {string} Preview text
 */
exports.previewForThinking = function previewForThinking(text, maxLen = 180) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) {
        return '';
    }
    if (value.length <= maxLen) {
        return value;
    }
    return `${value.slice(0, maxLen - 3)}...`;
};

/**
 * Runs a chat request loop with tool invocation and returns the aggregated model text.
 * Intermediate reasoning and tool output are emitted via response.progress.
 * @param {Object} params - Loop parameters
 * @param {Object} params.vscodeApi - VS Code API object
 * @param {Object} params.model - Selected model
 * @param {Object} params.response - Chat response stream wrapper
 * @param {string} params.instruction - Initial user instruction
 * @param {Array<Object>} params.tools - Tools available to the model
 * @param {Object} [params.options] - Optional request options
 * @param {Object} [params.options.request] - Chat request object for tool invocation token
 * @param {number} [params.maxIterations=7] - Safety cap for tool-call loop
 * @returns {Promise<string>} Aggregated final model text
 */
exports.runModelWithTools = async function runModelWithTools({
    vscodeApi,
    model,
    response,
    instruction,
    tools,
    options = {},
    maxIterations = 7
}) {
    const messages = [
        vscodeApi.LanguageModelChatMessage.User(instruction)
    ];

    const requestOptions = { tools };
    let finalText = '';
    let iterations = 0;

    while (iterations < maxIterations) {
        iterations++;

        let modelResponse;
        try {
            modelResponse = await exports.withTimeout(
                model.sendRequest(messages, requestOptions),
                exports.LLM_RESPONSE_TIMEOUT_MS,
                null
            );
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
                } else if (chunk instanceof vscodeApi.LanguageModelToolCallPart) {
                    toolCalls.push(chunk);
                }
            }
        }

        if (chunkText) {
            finalText += chunkText;
            // Optionally, we could show internal thinking here, but since Copilot
            // already streams text progressively, repetitive 'Thinking: ...' for text chunks
            // often causes UI flicker. So we typically suppress text chunk progress 
            // unless it's explicitly wrapped in a reasoning block (which we might not want to show as progress anymore).
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
                // Determine a friendly tool name for progress display
                let friendlyName = toolCall.name.replace('repoask_', '').replace(/_/g, ' ');
                
                // Show document titles when using doc check tools
                if (toolCall.name === 'repoask_doc_check') {
                    if (toolCall.input && Array.isArray(toolCall.input.ids)) {
                        const docCount = toolCall.input.ids.length;
                        exports.emitThinking(response, `Reading content from ${docCount} document${docCount !== 1 ? 's' : ''}...`);
                    } else {
                        exports.emitThinking(response, `Reading content from local doc store...`);
                    }
                } else {
                    exports.emitThinking(response, `Using ${friendlyName}...`);
                }
                
                const result = await vscodeApi.lm.invokeTool(
                    toolCall.name,
                    { input: toolCall.input, toolInvocationToken: options.request?.toolInvocationToken }
                );

                const toolTextOutput = (result.content || [])
                    .filter((part) => part instanceof vscodeApi.LanguageModelTextPart)
                    .map((part) => part.value)
                    .join('\n')
                    .trim();

                // Often we do NOT want to preview raw tool result text as it clutters the UI
                if (toolTextOutput) {
                    // Try to extract document IDs/references if it's a rank or check tool
                    if (toolCall.name === 'repoask_doc_check') {
                        // If possible, emit a reference for the docs being checked to look like Copilot
                        if (toolCall.input && Array.isArray(toolCall.input.ids) && typeof response.reference === 'function') {
                            const vscode = vscodeApi; 
                            // If options.storagePath is passed, we can map to the actual files
                            if (options.storagePath) {
                                const path = require('path');
                                for (const id of toolCall.input.ids) {
                                    const docPath = path.join(options.storagePath, id, 'content.md');
                                    response.reference(vscode.Uri.file(docPath));
                                }
                            }
                        }
                    } else {
                        exports.emitThinking(response, `Analyzed ${friendlyName} results`);
                    }
                }

                // Add references if the tool provides any
                // The tool might not provide explicit references, but Copilot style handles progress updates well.
                // Outputting progress instead of reasoning looks much closer to Copilot.

                messages.push(vscodeApi.LanguageModelChatMessage.User([
                    new vscodeApi.LanguageModelToolResultPart(toolCall.callId, result.content)
                ]));
            } catch (err) {
                exports.emitThinking(response, `Error invoking tool ${toolCall.name}: ${err.message}`);
                messages.push(vscodeApi.LanguageModelChatMessage.User([
                    new vscodeApi.LanguageModelToolResultPart(
                        toolCall.callId,
                        [new vscodeApi.LanguageModelTextPart(`Error: ${err.message}`)]
                    )
                ]));
            }
        }
    }

    return finalText;
};
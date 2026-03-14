const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { updateConfluencePage } = require('../mcp/confluenceApi');
const { createOpenDocCommand, createMetadataCommands, createSearchCommand, createPromptsCommand, createDeleteCommand, createResetCommand } = require('./commands');


function createSidebarController(deps) {
    const {
        vscode,
        context,
        storagePath,
        documentService,
        readAllMetadata,
        readDocumentContent,
        deleteDocumentFiles
    } = deps;

    // Create command instances
    const openDoc = createOpenDocCommand(deps);
    const { generateMetadata, saveMetadata } = createMetadataCommands(deps);
    const searchDocs = createSearchCommand(deps);
    const addToPrompts = createPromptsCommand(deps);
    const deleteDoc = createDeleteCommand(deps);
    const resetToDefaultDocs = createResetCommand(deps);

    let docsWebviewView;
    let sidebarSyncStatus = '';
    let sidebarSyncError = '';
    let sidebarSyncSuccess = '';


    const sidebarProvider = {
        resolveWebviewView: async (webviewView) => {
            try {
                docsWebviewView = webviewView;
                docsWebviewView.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(context.extensionUri, 'src', 'sidebar'),
                        vscode.Uri.file(storagePath)
                    ]
                };

                docsWebviewView.webview.onDidReceiveMessage(async (message) => {
                    if (message?.command === 'clearSyncError') {
                        sidebarSyncError = '';
                    }

                    if (message?.command === 'clearSyncSuccess') {
                        sidebarSyncSuccess = '';
                    }

                    if (message?.command === 'refreshDocs') {
                        const { isAll, arg } = message;
                        if (isAll) {
                            if (arg) {
                                vscode.commands.executeCommand('repo-ask.refresh', { type: 'recursive', arg: String(arg).trim() });
                            } else {
                                vscode.commands.executeCommand('repo-ask.refresh', '');
                            }
                        } else if (arg) {
                            vscode.commands.executeCommand('repo-ask.refresh', String(arg).trim());
                        }
                    }

                    if (message?.command === 'openDoc' && message.docId) {
                        await openDoc(message, docsWebviewView);
                    }

                    if (message?.command === 'generateMetadata' && message.docId) {
                        await generateMetadata(message, docsWebviewView, upsertSidebarDocument);
                    }

                    if (message?.command === 'saveMetadata' && message.docId) {
                        await saveMetadata(message, upsertSidebarDocument);
                    }

                    if (message?.command === 'searchDocs') {
                        await searchDocs(message, docsWebviewView);
                    }

                    if (message?.command === 'addToPrompts') {
                        await addToPrompts(message, docsWebviewView);
                    }

                    if (message?.command === 'deleteDoc') {
                        await deleteDoc(message, docsWebviewView, refreshSidebarView);
                    }

                    if (message?.command === 'resetToDefaultDocs') {
                        await resetToDefaultDocs(message, docsWebviewView, refreshSidebarView, context);
                    }

                    if (message?.command === 'submitFeedback' && message.feedbackEntry) {
                        await handleSubmitFeedback(message.feedbackEntry);
                    }

                    if (message?.command === 'generateSummary' && message.conversationSummary) {
                        await handleGenerateSummary(message.conversationSummary);
                    }
                });

                docsWebviewView.onDidChangeVisibility(async () => {
                    if (!docsWebviewView.visible) {
                        return;
                    }

                    refreshSidebarView();
                });

                refreshSidebarView();
            } catch (error) {
                const reason = error && error.message ? error.message : 'unknown sidebar initialization error';
                if (webviewView && webviewView.webview) {
                    webviewView.webview.html = getSidebarErrorHtml(`RepoAsk sidebar failed to load: ${reason}`);
                }
            }
        }
    };

    function setSidebarSyncStatus(message) {
        sidebarSyncStatus = String(message || '');
        if (!docsWebviewView) {
            return;
        }

        docsWebviewView.webview.postMessage({
            command: 'syncStatus',
            payload: sidebarSyncStatus
        });
    }

    function setSidebarSyncError(message) {
        sidebarSyncError = String(message || '');
        if (!docsWebviewView) {
            return;
        }

        docsWebviewView.webview.postMessage({
            command: 'syncError',
            payload: sidebarSyncError
        });
    }



    function refreshSidebarView() {
        if (!docsWebviewView) {
            return;
        }

        try {
            docsWebviewView.webview.html = getSidebarHtml(docsWebviewView.webview);
        } catch (error) {
            const reason = error && error.message ? error.message : 'unknown render error';
            docsWebviewView.webview.html = getSidebarErrorHtml(`RepoAsk sidebar failed to render: ${reason}`);
        }
    }

    function upsertSidebarDocument(metadata) {
        if (!docsWebviewView || !metadata || !metadata.id) {
            return;
        }

        docsWebviewView.webview.postMessage({
            command: 'docUpserted',
            payload: {
                id: metadata.id,
                title: metadata.title || 'Untitled',
                last_updated: metadata.last_updated || ''
            }
        });
    }

    function revealDocumentInSidebar(docId) {
        const id = String(docId || '').trim();
        if (!id || !docsWebviewView) {
            return false;
        }

        const metadata = readAllMetadata(storagePath).find(doc => String(doc.id) === id);
        if (!metadata) {
            return false;
        }

        const rawContent = readDocumentContent(storagePath, metadata.id) || 'No local markdown content found.';
        const content = rewriteMarkdownImageLinksForWebview(rawContent, metadata.id, docsWebviewView.webview);
        const contentHtml = renderMarkdownForWebview(content);

        if (typeof docsWebviewView.show === 'function') {
            docsWebviewView.show(true);
        }

        docsWebviewView.webview.postMessage({
            command: 'selectDoc',
            payload: {
                id,
                content,
                contentHtml,
                metadata
            }
        });

        return true;
    }

    function getSidebarHtml(webview) {
        const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'sidebar', 'index.html');
        const cssPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'sidebar', 'styles.css');
        const popupPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'sidebar', 'refreshPopup.html');
        const metadataHtmlPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'sidebar', 'metadata.html');
        const docStoreHtmlPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'sidebar', 'docStore.html');
        const feedbackHtmlPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'sidebar', 'feedback.html');
        const metadataJsPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'sidebar', 'metadata.js');
        const docStoreJsPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'sidebar', 'docStore.js');
        const feedbackJsPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'sidebar', 'feedback.js');

        const htmlTemplate = fs.readFileSync(htmlPath.fsPath, 'utf8');
        const popupHtml = fs.existsSync(popupPath.fsPath) ? fs.readFileSync(popupPath.fsPath, 'utf8') : '';
        const metadataHtml = fs.existsSync(metadataHtmlPath.fsPath) ? fs.readFileSync(metadataHtmlPath.fsPath, 'utf8') : '';
        const docStoreHtml = fs.existsSync(docStoreHtmlPath.fsPath) ? fs.readFileSync(docStoreHtmlPath.fsPath, 'utf8') : '';
        const feedbackHtml = fs.existsSync(feedbackHtmlPath.fsPath) ? fs.readFileSync(feedbackHtmlPath.fsPath, 'utf8') : '';

        const cssUri = webview.asWebviewUri(cssPath).toString();
        const metadataJsUri = webview.asWebviewUri(metadataJsPath).toString();
        const docStoreJsUri = webview.asWebviewUri(docStoreJsPath).toString();
        const feedbackJsUri = webview.asWebviewUri(feedbackJsPath).toString();

        const docs = readAllMetadata(storagePath).sort((a, b) => String(b.last_updated).localeCompare(String(a.last_updated)));

        return htmlTemplate
            .replace('__CSS_URI__', cssUri)
            .replace('__METADATA_JS_URI__', metadataJsUri)
            .replace('__DOC_STORE_JS_URI__', docStoreJsUri)
            .replace('__FEEDBACK_JS_URI__', feedbackJsUri)
            .replace('__DOCS_DATA__', JSON.stringify(docs))
            .replace('__SYNC_STATUS__', JSON.stringify(sidebarSyncStatus))
            .replace('__SYNC_ERROR__', JSON.stringify(sidebarSyncError))
            .replace('__SYNC_SUCCESS__', JSON.stringify(sidebarSyncSuccess))
            .replace('__METADATA_HTML__', metadataHtml)
            .replace('__DOC_STORE_HTML__', docStoreHtml)
            .replace('__FEEDBACK_HTML__', feedbackHtml)
            .replace('__REFRESH_POPUP__', popupHtml);
    }



    function getSidebarErrorHtml(message) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RepoAsk Sidebar Error</title>
</head>
<body>
    <main style="padding: 12px; font-family: sans-serif;">
        <h2 style="margin: 0 0 8px 0;">RepoAsk Sidebar</h2>
        <p style="margin: 0;">${String(message || 'Unknown error')}</p>
    </main>
</body>
</html>`;
    }

    async function handleSubmitFeedback(feedbackEntry) {
        try {
            const configuration = vscode.workspace.getConfiguration('repoAsk');
            const confluenceUrl = configuration.get('logActionConfluenceUrl');
            
            if (!confluenceUrl) {
                vscode.window.showErrorMessage('Please set the logActionConfluenceUrl setting in RepoAsk configuration.');
                
                // Send error message to webview
                if (docsWebviewView) {
                    docsWebviewView.webview.postMessage({ 
                        command: 'feedbackSubmitted', 
                        success: false 
                    });
                }
                return;
            }
            
            await updateConfluencePage(confluenceUrl, feedbackEntry);
            vscode.window.showInformationMessage('Feedback submitted successfully!');
            
            // Send success message to webview
            if (docsWebviewView) {
                docsWebviewView.webview.postMessage({ 
                    command: 'feedbackSubmitted', 
                    success: true 
                });
            }
        } catch (error) {
            console.error('Error submitting feedback:', error);
            
            // Provide more specific error messages
            let errorMessage = 'Failed to submit feedback. Please try again.';
            if (error.message.includes('not configured')) {
                errorMessage = 'Confluence base URL not configured. Please set the repoAsk.confluence.url setting.';
            } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                errorMessage = 'Failed to connect to Confluence server: Connection timed out. Please check your network connection and server URL.';
            } else if (error.response && error.response.status === 404) {
                errorMessage = 'Failed to connect to Confluence server: Page not found (404). Please check the URL and ensure the server is running.';
            } else if (error.response && error.response.status >= 500) {
                errorMessage = 'Failed to connect to Confluence server: Server error. Please check if the server is running and accessible.';
            } else if (error.message.includes('getaddrinfo')) {
                errorMessage = 'Failed to connect to Confluence server: Host not found. Please check the server URL.';
            }
            
            vscode.window.showErrorMessage(errorMessage);
            
            // Send error message to webview
            if (docsWebviewView) {
                docsWebviewView.webview.postMessage({ 
                    command: 'feedbackSubmitted', 
                    success: false,
                    error: errorMessage
                });
            }
        }
    }

    async function handleGenerateSummary(conversationSummary) {
        try {
            let summary = '';
            const inputText = String(conversationSummary || '').trim();
            if (!inputText) {
                if (docsWebviewView) {
                    docsWebviewView.webview.postMessage({
                        command: 'populateSummary',
                        summary: ''
                    });
                }
                return;
            }
            
            // Try to use VS Code's built-in LLM to rewrite the provided conversation summary.
            if (vscode.lm && vscode.LanguageModelChatMessage) {
                try {
                    const models = await vscode.lm.selectChatModels({});
                    const model = models?.[0];
                    if (model) {
                        const instruction = [
                            'You are a helpful assistant that rewrites conversation summaries.',
                            'Rewrite the following conversation summary into a clear, polished, and complete summary.',
                            'Keep all key details, decisions, and action items. Do not truncate important points.',
                            'Return only the rewritten summary text.',
                            '',
                            'Conversation Summary:',
                            inputText
                        ].join('\n');

                        const response = await model.sendRequest([
                            vscode.LanguageModelChatMessage.User(instruction)
                        ]);

                        if (response && response.text) {
                            let responseText = '';
                            for await (const fragment of response.text) {
                                responseText += fragment;
                            }
                            summary = responseText.trim();
                        }
                    }
                } catch (llmError) {
                    console.error('LLM error:', llmError);
                    // Fallback to original content if LLM fails
                    summary = inputText;
                }
            } else {
                // Fallback to original content if LLM not available
                summary = inputText;
            }

            if (!String(summary || '').trim()) {
                summary = inputText;
            }
            
            if (docsWebviewView) {
                docsWebviewView.webview.postMessage({ 
                    command: 'populateSummary', 
                    summary 
                });
            }
        } catch (error) {
            console.error('Error generating summary:', error);
            vscode.window.showErrorMessage('Failed to generate summary. Please try again.');
            
            // Ensure buttons are re-enabled even on error
            if (docsWebviewView) {
                docsWebviewView.webview.postMessage({ 
                    command: 'populateSummary', 
                    summary: String(conversationSummary || '')
                });
            }
        }
    }

    function showLogActionButton(firstUserQuery, firstRankedDocUrl, fullAiResponse) {
        if (docsWebviewView) {
            docsWebviewView.webview.postMessage({ 
                command: 'showFeedbackForm',
                firstUserQuery: firstUserQuery,
                firstRankedDocUrl: firstRankedDocUrl,
                fullAiResponse: fullAiResponse
            });
        }
    }

    return {
        sidebarProvider,
        refreshSidebarView,
        setSidebarSyncStatus,
        setSidebarSyncError,
        upsertSidebarDocument,
        revealDocumentInSidebar,
        showLogActionButton
    };
}

module.exports = {
    createSidebarController
};

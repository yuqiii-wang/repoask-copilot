const vscode = require('vscode');

const { fetchConfluencePage, fetchAllConfluencePages } = require('./confluenceApi');
const { fetchJiraIssue } = require('./jiraApi');
const {
    truncate,
    tokenize,
    htmlToMarkdown,
    generateKeywords,
    generateSummary,
    generateExtendedKeywords
} = require('./textProcessing');
const {
    ensureStoragePath,
    ensureBm25StoragePath,
    readAllMetadata,
    readDocumentContent,
    deleteDocumentFiles,
    formatDocumentDetails,
    writeDocumentFiles
} = require('./storage');
const { findRelevantDocuments, rankDocumentsByIdf } = require('./relevance');
const { parseRefreshArg } = require('./extension/llm');
const { createDocumentService } = require('./extension/documentService');
const { createSidebarController } = require('./extension/sidebarController');
const { createLanguageModelTools } = require('./extension/lmTools');
const { loadWorkspacePromptContext } = require('./extension/promptContext');
const { answerGeneralPromptQuestion } = require('./extension/chat/generalAnswer');
const { isRefreshPrompt } = require('./extension/chat/refreshPrompt');
const { registerCoreCommands } = require('./extension/commands');

const EMPTY_STORE_HINT = 'No local documents found. Run `@repoask refresh` to sync to Confluence Cloud.';
const TOOL_NAMES = {
    refresh: 'repoask_refresh',
    annotate: 'repoask_annotate',
    rank: 'repoask_rank',
    check: 'repoask_check'
};

function setupExtension(context) {
    const storagePath = ensureStoragePath(context);
    const bm25StoragePath = ensureBm25StoragePath(context);

    const documentService = createDocumentService({
        vscode,
        storagePath,
        bm25StoragePath,
        fetchConfluencePage,
        fetchAllConfluencePages,
        fetchJiraIssue,
        truncate,
        tokenize,
        htmlToMarkdown,
        generateKeywords,
        generateExtendedKeywords,
        generateSummary,
        readAllMetadata,
        writeDocumentFiles,
        readDocumentContent,
        rankDocumentsByIdf
    });

    const sidebar = createSidebarController({
        vscode,
        context,
        storagePath,
        documentService,
        readAllMetadata,
        readDocumentContent,
        deleteDocumentFiles
    });

    const lmTools = createLanguageModelTools({
        vscode,
        context,
        documentService,
        parseRefreshArg,
        fetchConfluencePage,
        setSidebarSyncStatus: sidebar.setSidebarSyncStatus,
        refreshSidebarView: sidebar.refreshSidebarView,
        upsertSidebarDocument: sidebar.upsertSidebarDocument,
        readAllMetadata: () => readAllMetadata(storagePath),
        readDocumentContent: (id) => readDocumentContent(storagePath, id),
        truncate,
        emptyStoreHint: EMPTY_STORE_HINT,
        toolNames: TOOL_NAMES
    });

    const commandDisposables = registerCoreCommands({
        vscode,
        storagePath,
        sidebar,
        documentService,
        parseRefreshArg,
        readAllMetadata,
        readDocumentContent,
        formatDocumentDetails,
        findRelevantDocuments,
        rankDocumentsByIdf,
        tokenize,
        truncate
    });

    const webviewProviderDisposable = vscode.window.registerWebviewViewProvider('repo-ask-documents', sidebar.sidebarProvider);
    const lmToolDisposables = lmTools.registerRepoAskLanguageModelTools();

    let repoAskParticipant;
    if (vscode.chat && typeof vscode.chat.createChatParticipant === 'function') {
        repoAskParticipant = vscode.chat.createChatParticipant('repoask', async (request, chatContext, response) => {
            const prompt = request.prompt?.trim() || '';
            const workspacePromptContext = loadWorkspacePromptContext(vscode);
            const llmOptions = {
                workspacePromptContext: workspacePromptContext.text
            };

            if (!prompt) {
                response.markdown('Ask a question, or use `refresh` to sync content.');
                return;
            }

            if (isRefreshPrompt(prompt)) {
                await lmTools.handleRefreshFromSource(prompt, response, llmOptions);
                return;
            }

            if (prompt.toLowerCase().startsWith('annotate')) {
                const annotateArg = prompt.replace(/^annotate\s*/i, '').trim();
                response.markdown(`Annotating documents${annotateArg ? ` for ${annotateArg}` : ' (all local docs)'}...`);
                await vscode.commands.executeCommand('repo-ask.annotate', annotateArg);
                response.markdown('Annotation completed.');
                return;
            }

            try {
                const forceCheckAllDocsButton = /^check\b/i.test(prompt);
                await answerGeneralPromptQuestion(vscode, prompt, workspacePromptContext.text, response, {
                    truncate,
                    tokenize,
                    rankDocumentsByIdf
                }, {
                    metadataList: readAllMetadata(storagePath),
                    forceCheckAllDocsButton,
                    request // Pass the request to access toolInvocationToken
                });
            } catch (error) {
                response.markdown(`Unable to answer with prompt context: ${error.message}`);
            }
        });

        repoAskParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    }

    const baseSubscriptions = [
        ...commandDisposables,
        webviewProviderDisposable,
        ...lmToolDisposables
    ];

    if (repoAskParticipant) {
        baseSubscriptions.push(repoAskParticipant);
    }

    context.subscriptions.push(...baseSubscriptions);
}

function deactivate() {}

module.exports = {
    setupExtension,
    deactivate
};

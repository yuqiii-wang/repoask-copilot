function createLanguageModelTools(deps) {
    const {
        vscode,
        context,
        documentService,
        parseRefreshArg,
        fetchConfluencePage,
        setSidebarSyncStatus,
        refreshSidebarView,
        upsertSidebarDocument,
        readAllMetadata,
        readDocumentContent,
        truncate,
        emptyStoreHint,
        toolNames
    } = deps;

    function toToolResult(text, data) {
        const parts = [new vscode.LanguageModelTextPart(String(text || ''))];
        if (vscode.LanguageModelDataPart && typeof vscode.LanguageModelDataPart.json === 'function' && data !== undefined) {
            parts.push(vscode.LanguageModelDataPart.json(data));
        }
        return new vscode.LanguageModelToolResult(parts);
    }

    function buildCheckAllDocsCommandLink(query) {
        const question = String(query || '').trim();
        if (!question) {
            return 'Run `repo-ask.checkAllDocs` to scan all docs.';
        }

        const encodedArgs = encodeURIComponent(JSON.stringify([question]));
        return `[Check ALL docs](command:repo-ask.checkAllDocs?${encodedArgs})`;
    }

    function formatRefreshStatus(sourceLabel, progress = {}) {
        const index = Number(progress?.index);
        const total = Number(progress?.total);
        const hasFraction = Number.isFinite(index) && Number.isFinite(total) && total > 0;
        const progressSuffix = hasFraction ? ` (${index}/${total})` : '';
        return `downloading from ${sourceLabel} ...${progressSuffix}`;
    }

    function registerRepoAskLanguageModelTools() {
        if (!vscode.lm || typeof vscode.lm.registerTool !== 'function') {
            return [];
        }

        const refreshTool = vscode.lm.registerTool(toolNames.refresh, {
            prepareInvocation(options) {
                const arg = String(options?.input?.arg || '').trim();
                return {
                    invocationMessage: arg.length > 0
                        ? `Refreshing RepoAsk document source for: ${arg}`
                        : 'Refreshing all RepoAsk Confluence documents',
                    confirmationMessages: {
                        title: arg.length > 0 ? 'Refresh RepoAsk document source?' : 'Refresh all RepoAsk Confluence docs?',
                        message: arg.length > 0
                            ? `This will sync local-store from: ${arg}`
                            : 'This will sync all Confluence pages into local-store.'
                    }
                };
            },
            async invoke(options) {
                const arg = String(options?.input?.arg || '').trim();
                const createRefreshOptions = (sourceLabel) => ({
                    onDocumentProcessed: ({ metadata, index, total }) => {
                        if (typeof upsertSidebarDocument === 'function') {
                            upsertSidebarDocument(metadata);
                        }
                        setSidebarSyncStatus(formatRefreshStatus(sourceLabel, { index, total }));
                    }
                });

                try {
                    if (!arg) {
                        setSidebarSyncStatus('downloading from confluence cloud ...');
                        await documentService.refreshAllDocuments(createRefreshOptions('confluence cloud'));
                        setSidebarSyncStatus('');
                        refreshSidebarView();
                        return toToolResult('Refreshed all Confluence documents into local-store.', { refreshed: 'all' });
                    }

                    const parsed = await parseRefreshArg(vscode, arg);
                    if (parsed.found && parsed.source === 'regex-jira') {
                        setSidebarSyncStatus('downloading from jira ...');
                        await documentService.refreshJiraIssue(parsed.arg, createRefreshOptions('jira'));
                        setSidebarSyncStatus('');
                        refreshSidebarView();
                        return toToolResult(`Refreshed Jira issue for: ${parsed.arg}`, { refreshed: parsed.arg, source: 'jira' });
                    }

                    if (parsed.found && parsed.arg) {
                        await fetchConfluencePage(parsed.arg);
                        setSidebarSyncStatus('downloading from confluence cloud ...');
                        await documentService.refreshDocument(parsed.arg, createRefreshOptions('confluence cloud'));
                        setSidebarSyncStatus('');
                        refreshSidebarView();
                        return toToolResult(`Refreshed Confluence page for: ${parsed.arg}`, { refreshed: parsed.arg, source: 'confluence' });
                    }

                    return toToolResult(
                        'Could not resolve a Confluence page id/title/link or Jira issue key/id/link. Provide an explicit arg, or call this tool with empty arg to refresh all Confluence docs.',
                        { refreshed: false, reason: 'unresolved-arg' }
                    );
                } catch (error) {
                    setSidebarSyncStatus('');
                    return toToolResult(`Refresh failed: ${error.message}`, { refreshed: false, error: error.message });
                }
            }
        });

        const annotateTool = vscode.lm.registerTool(toolNames.annotate, {
            prepareInvocation(options) {
                const arg = String(options?.input?.arg || '').trim();
                return {
                    invocationMessage: arg.length > 0
                        ? `Annotating RepoAsk document: ${arg}`
                        : 'Annotating all RepoAsk local documents',
                    confirmationMessages: {
                        title: arg.length > 0 ? 'Annotate selected RepoAsk document?' : 'Annotate all RepoAsk local documents?',
                        message: arg.length > 0
                            ? `This will recompute summary and keywords for: ${arg}`
                            : 'This will recompute summary and keywords for all local documents.'
                    }
                };
            },
            async invoke(options) {
                const arg = String(options?.input?.arg || '').trim();
                try {
                    const result = arg.length > 0
                        ? await documentService.annotateDocumentByArg(arg)
                        : await documentService.annotateAllDocuments();
                    refreshSidebarView();
                    return toToolResult(result.message, { annotated: true, arg: arg || '' });
                } catch (error) {
                    return toToolResult(`Annotate failed: ${error.message}`, { annotated: false, error: error.message });
                }
            }
        });

        const rankTool = vscode.lm.registerTool(toolNames.rank, {
            async invoke(options) {
                const query = String(options?.input?.query || '').trim();
                const rawLimit = Number(options?.input?.limit);
                const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 5;

                if (!query) {
                    return toToolResult('Missing required `query` input for rank tool.', { results: [] });
                }

                const ranked = documentService.rankLocalDocuments(query, limit);
                if (!ranked || ranked.length === 0) {
                    return toToolResult('No matching local documents found for the query.', { results: [] });
                }

                const results = ranked.map(item => ({
                    id: item.id,
                    title: item.title || 'Untitled',
                    score: Number(item.score?.toFixed ? item.score.toFixed(4) : item.score),
                    summary: item.summary || ''
                }));
                const lines = results.map((item, index) => `${index + 1}. ${item.title} (score ${item.score})`);
                return toToolResult(`Top ranked RepoAsk documents:\n${lines.join('\n')}`, { results });
            }
        });

        const checkTool = vscode.lm.registerTool(toolNames.check, {
            async invoke(options) {
                const query = String(options?.input?.query || '').trim();
                const repAskConfig = vscode.workspace.getConfiguration('repoAsk');
                const initKeywordNum = repAskConfig.get('initKeywordNum') || 50;
                const rawLimit = Number(options?.input?.limit);
                const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), initKeywordNum) : 5;

                if (!query) {
                    return toToolResult('Missing required `query` input for check tool.', { references: [] });
                }

                const metadataList = readAllMetadata();
                if (metadataList.length === 0) {
                    return toToolResult(emptyStoreHint, { references: [] });
                }

                const agenticResult = documentService.checkLocalDocumentsAgentic(query, {
                    limit,
                    metadataCandidateLimit: Math.max(40, limit * 4)
                });

                if (!agenticResult.references || agenticResult.references.length === 0) {
                    return toToolResult(`No relevant documents found in local store. ${buildCheckAllDocsCommandLink(query)}`, { references: [] });
                }

                const confidentRefs = agenticResult.references.filter(r => r.score > 0);
                if (confidentRefs.length === 0) {
                    return toToolResult(`No confident local documents found for your query. Please ${buildCheckAllDocsCommandLink(query)}`, { references: [] });
                }

                const references = confidentRefs.map((ref) => ({
                    ...ref,
                    summary: ref.summary || 'No summary available',
                    reference: ref.reference || ''
                }));
                const lines = references.map((ref, index) => `${index + 1}. ${ref.title} (updated ${ref.last_updated || '-'})`);
                const summaryLines = [
                    `Top relevant RepoAsk references (agentic check):`,
                    `- Metadata scanned: ${agenticResult.metadataScanned}`,
                    `- Metadata candidates loaded for content: ${agenticResult.metadataCandidates}`,
                    `- Docs with content loaded: ${agenticResult.contentLoaded}`,
                    `- Metadata fallback used: ${agenticResult.usedMetadataFallback ? 'yes' : 'no'}`,
                    '',
                    ...lines,
                    '',
                    `Need broader confirmation? ${buildCheckAllDocsCommandLink(query)}`
                ];

                return toToolResult(summaryLines.join('\n'), {
                    references,
                    diagnostics: {
                        metadataScanned: agenticResult.metadataScanned,
                        metadataCandidates: agenticResult.metadataCandidates,
                        contentLoaded: agenticResult.contentLoaded,
                        usedMetadataFallback: agenticResult.usedMetadataFallback
                    }
                });
            }
        });

        const readMetadataTool = vscode.lm.registerTool('repoask_read_metadata', {
            prepareInvocation(options) {
                const ids = options?.input?.ids || [];
                return {
                    invocationMessage: ids.length > 0 ? `Reading metadata for ${ids.length} docs...` : 'Reading all metadata...'
                };
            },
            async invoke(options) {
                const ids = options?.input?.ids || [];
                const allMetadata = readAllMetadata();
                let filtered = allMetadata;
                if (ids.length > 0) {
                    filtered = allMetadata.filter(m => ids.includes(String(m.id)) || ids.includes(m.id));
                }
                
                const repAskConfig = vscode.workspace.getConfiguration('repoAsk');
                const confProfile = repAskConfig.get('confluence');
                const confUrl = String((confProfile && typeof confProfile === 'object' ? confProfile.url : '') || repAskConfig.get('confluenceBaseUrl') || 'http://127.0.0.1:8001').replace(/\/$/, '');
                
                const jiraProfile = repAskConfig.get('jira');
                const jiraUrl = String((jiraProfile && typeof jiraProfile === 'object' ? jiraProfile.url : '') || repAskConfig.get('jiraBaseUrl') || 'http://127.0.0.1:8002').replace(/\/$/, '');

                const summaryLines = filtered.map(m => {
                    let fullUrl = m.url || '';
                    if (fullUrl && !fullUrl.startsWith('http')) {
                        const isJira = m.parent_confluence_topic && String(m.parent_confluence_topic).startsWith('Jira');
                        const baseUrl = isJira ? jiraUrl : confUrl;
                        fullUrl = `${baseUrl}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`;
                    }

                    const lines = [
                        `- [${m.id}] ${m.title || 'Untitled'}`,
                        `  URL: ${fullUrl || 'None'}`,
                        `  Jira ID / Confluence Title: ${m.title || 'Untitled'}`,
                        `  Author: ${m.author || 'Unknown'}`,
                        `  Last Updated: ${m.last_updated || 'Unknown'}`,
                        `  Parent Topic: ${m.parent_confluence_topic || 'None'}`,
                        `  Keywords: ${Array.isArray(m.keywords) ? m.keywords.join(', ') : 'None'}`,
                        `  Summary: ${m.summary || 'None'}`
                    ];
                    return lines.join('\n');
                });
                return toToolResult(`Found metadata for ${filtered.length} docs:\n${summaryLines.join('\n\n')}`, { metadata: filtered });
            }
        });

        const readContentTool = vscode.lm.registerTool('repoask_read_content', {
            prepareInvocation(options) {
                const ids = options?.input?.ids || [];
                return {
                    invocationMessage: ids.length > 0 ? `Reading content for ${ids.length} docs...` : 'Reading all content...'
                };
            },
            async invoke(options) {
                const ids = options?.input?.ids || [];
                const allMetadata = readAllMetadata();
                let filtered = allMetadata;
                if (ids.length > 0) {
                    filtered = allMetadata.filter(m => ids.includes(String(m.id)) || ids.includes(m.id));
                }
                const results = [];
                for (const m of filtered) {
                    const content = readDocumentContent(m.id);
                    if (content) {
                        results.push({ id: m.id, title: m.title, content: content });
                    }
                }
                const summaryLines = results.map(r => `Doc [${r.id}] ${r.title}:\n${r.content}`);
                return toToolResult(`Found content for ${results.length} docs:\n\n${summaryLines.join('\n\n')}`, { contents: results });
            }
        });

        return [refreshTool, annotateTool, rankTool, checkTool, readMetadataTool, readContentTool];
    }

    async function handleRefreshFromSource(sourceInput, response, options = {}) {
        const parsed = await parseRefreshArg(vscode, sourceInput, options);
        const createRefreshOptions = (sourceLabel) => ({
            onDocumentProcessed: ({ metadata, index, total }) => {
                if (typeof upsertSidebarDocument === 'function') {
                    upsertSidebarDocument(metadata);
                }
                setSidebarSyncStatus(formatRefreshStatus(sourceLabel, { index, total }));
            }
        });

        if (parsed.found && parsed.source === 'regex-jira') {
            response.markdown(`Refreshing Jira issue for: ${parsed.arg}...`);
            try {
                setSidebarSyncStatus('downloading from jira ...');
                await documentService.refreshJiraIssue(parsed.arg, createRefreshOptions('jira'));
                response.markdown('Refresh completed for the Jira issue.');
                setSidebarSyncStatus('');
                refreshSidebarView();
            } catch (error) {
                setSidebarSyncStatus('');
                const status = error?.response?.status;
                const detail = status ? `backend returned ${status}` : (error?.message || 'backend request failed');
                response.markdown(`Refresh failed for Jira issue ${parsed.arg} (${detail}).`);
            }
            return;
        }

        if (parsed.found && parsed.arg) {
            try {
                await fetchConfluencePage(parsed.arg);
            } catch (error) {
                const status = error?.response?.status;
                const detail = status ? `backend returned ${status}` : 'backend request failed';
                response.markdown(`Could not resolve the requested document (${detail}). Do you want to download all docs instead?`);
                appendRefreshAllDocsButton(response);
                return;
            }

            response.markdown(`Refreshing document for: ${parsed.arg}...`);
            try {
                setSidebarSyncStatus('downloading from confluence cloud ...');
                await documentService.refreshDocument(parsed.arg, createRefreshOptions('confluence cloud'));
                response.markdown('Refresh completed for the resolved page.');
                setSidebarSyncStatus('');
                refreshSidebarView();
            } catch (error) {
                setSidebarSyncStatus('');
                const status = error?.response?.status;
                const detail = status ? `backend returned ${status}` : (error?.message || 'backend request failed');
                response.markdown(`Refresh failed for the requested page (${detail}). Do you want to download all docs instead?`);
                appendRefreshAllDocsButton(response);
            }
            return;
        }

        response.markdown(`I couldn't find a Confluence link, page id, or exact page title in your request. Do you want to download all docs instead?`);
        appendRefreshAllDocsButton(response);
    }

    function appendRefreshAllDocsButton(response) {
        response.button({
            command: 'repo-ask.refresh',
            title: 'Refresh All Docs',
            arguments: ['']
        });
    }

    return {
        registerRepoAskLanguageModelTools,
        handleRefreshFromSource
    };
}

module.exports = {
    createLanguageModelTools
};

const { toToolResult, buildCheckAllDocsCommandLink } = require('./utils');

module.exports = function registerDocCheckTool(deps) {
    const { vscode, toolNames, documentService, readAllMetadata, readDocumentContent, emptyStoreHint } = deps;
    return vscode.lm.registerTool(toolNames.docCheck, {
            async invoke(options) {
                const query = String(options?.input?.query || '').trim();
                const mode = options?.input?.mode || 'search'; // search, metadata, content, all
                const ids = options?.input?.ids || [];
                const repAskConfig = vscode.workspace.getConfiguration('repoAsk');
                const initKeywordNum = repAskConfig.get('initKeywordNum') || 50;
                const rawLimit = Number(options?.input?.limit);
                const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), initKeywordNum) : 5;

                const metadataList = readAllMetadata();
                if (metadataList.length === 0) {
                    return toToolResult(emptyStoreHint, { references: [] });
                }

                if (mode === 'metadata' || mode === 'content' || mode === 'all') {
                    // Dynamic reading mode
                    let filtered = metadataList;
                    if (ids.length > 0) {
                        filtered = metadataList.filter(m => 
                            ids.includes(String(m.id)) || 
                            ids.includes(m.id) ||
                            ids.includes(m.title) ||
                            ids.some(id => String(m.title).includes(String(id)))
                        );
                    }

                    const confProfile = repAskConfig.get('confluence');
                    const confUrl = String((confProfile && typeof confProfile === 'object' ? confProfile.url : '') || '').replace(/\/$/, '');
                    
                    const jiraProfile = repAskConfig.get('jira');
                    const jiraUrl = String((jiraProfile && typeof jiraProfile === 'object' ? jiraProfile.url : '') || '').replace(/\/$/, '');

                    const results = [];
                    for (const m of filtered) {
                        const result = { id: m.id, title: m.title };
                        
                        if (mode === 'metadata' || mode === 'all') {
                            let fullUrl = m.url || '';
                            if (fullUrl && !fullUrl.startsWith('http')) {
                                const isJira = m.parent_confluence_topic && String(m.parent_confluence_topic).startsWith('Jira');
                                const baseUrl = isJira ? jiraUrl : confUrl;
                                fullUrl = `${baseUrl}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`;
                            }
                            result.metadata = {
                                url: fullUrl,
                                author: m.author,
                                last_updated: m.last_updated,
                                parent_confluence_topic: m.parent_confluence_topic,
                                keywords: m.keywords,
                                summary: m.summary
                            };
                        }

                        if (mode === 'content' || mode === 'all') {
                            const content = readDocumentContent(m.id);
                            if (content) {
                                result.content = content;
                            }
                        }

                        results.push(result);
                    }

                    // Generate summary
                    const summaryLines = [];
                    if (mode === 'metadata' || mode === 'all') {
                        summaryLines.push(`Metadata for ${results.length} docs:`);
                        results.forEach(r => {
                            if (r.metadata) {
                                summaryLines.push(`- [${r.id}] ${r.title}`);
                                if (r.metadata.url) summaryLines.push(`  URL: ${r.metadata.url}`);
                                if (r.metadata.author) summaryLines.push(`  Author: ${r.metadata.author}`);
                                if (r.metadata.last_updated) summaryLines.push(`  Last Updated: ${r.metadata.last_updated}`);
                                if (r.metadata.parent_confluence_topic) summaryLines.push(`  Parent Topic: ${r.metadata.parent_confluence_topic}`);
                                if (r.metadata.keywords) summaryLines.push(`  Keywords: ${Array.isArray(r.metadata.keywords) ? r.metadata.keywords.join(', ') : r.metadata.keywords}`);
                                if (r.metadata.summary) summaryLines.push(`  Summary: ${r.metadata.summary}`);
                                summaryLines.push('');
                            }
                        });
                    }

                    if (mode === 'content' || mode === 'all') {
                        const contentResults = results.filter(r => r.content);
                        summaryLines.push(`Content for ${contentResults.length} docs:`);
                        contentResults.forEach(r => {
                            summaryLines.push(`Doc [${r.id}] ${r.title}:`);
                            summaryLines.push(r.content);
                            summaryLines.push('');
                        });
                    }

                    return toToolResult(summaryLines.join('\n'), { results });
                } else {
                    // Default search mode
                    if (!query) {
                        return toToolResult('Missing required `query` input for check tool.', { references: [] });
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
            }
        });
};

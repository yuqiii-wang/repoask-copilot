import { getJiraExtractionRegexes } from '../../mcp/jiraApi';
import { buildConfluenceIdExtractorPrompt } from '../chat/prompts';
import { selectDefaultChatModel, withTimeout, collectResponseText } from '../chat/shared';
import axios from 'axios';
import * as cheerio from 'cheerio';

const LLM_TIMEOUT_MS = 12000;

function extractJsonObject(rawText: any) {
    if (!rawText) return null;
    const text = String(rawText).trim();
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try { return JSON.parse(match[0]); } catch { return null; }
    }
}

async function extractConfluenceIdentifierWithLlm(vsCodeApi: any, rawInput: any, options: any = {}) {
    if (!vsCodeApi.lm || !vsCodeApi.LanguageModelChatMessage) return null;
    const workspacePromptContext = String(options.workspacePromptContext || '').trim().slice(0, 12000);
    try {
        
        const model = await selectDefaultChatModel(vsCodeApi, options);
        if (!model) return null;
        const instruction = buildConfluenceIdExtractorPrompt({ promptContext: workspacePromptContext, rawInput });
        const response = await withTimeout(
            model.sendRequest([vsCodeApi.LanguageModelChatMessage.User(instruction)], {}),
            LLM_TIMEOUT_MS, null
        );
        const responseText = await collectResponseText(vsCodeApi, response);
        const parsed = extractJsonObject(responseText);
        const arg = String(parsed?.arg || '').trim();
        return arg.length > 0 ? arg : null;
    } catch {
        return null;
    }
}

async function parseRefreshArg(vsApi: any, sourceInput: any, options: any = {}) {
    const vsCodeApi = vsApi;
    const raw = String(sourceInput || '').trim();
    if (!raw) return { found: false, arg: '', source: 'empty' };

    const jiraRegexes = getJiraExtractionRegexes(vsCodeApi);

    const urlMatch = raw.match(/https?:\/\/[^\s)]+/i);
    if (urlMatch && urlMatch[0]) {
        const urlStr = urlMatch[0];
        if (urlStr.match(/\/browse\/[A-Za-z0-9\-]+/i)) return { found: true, arg: urlStr, source: 'regex-jira' };
        for (const regex of jiraRegexes) {
            if (urlStr.match(regex)) return { found: true, arg: urlStr, source: 'regex-jira' };
        }
        return { found: true, arg: urlStr, source: 'regex-url' };
    }

    const pureNumMatch = raw.match(/^\d{7,}$/);
    if (pureNumMatch) return { found: true, arg: raw, source: 'regex-id' };

    for (const regex of jiraRegexes) {
        const jiraMatch = raw.match(regex);
        if (jiraMatch && jiraMatch[0]) return { found: true, arg: jiraMatch[0], source: 'regex-jira' };
    }

    const pageIdMatch = raw.match(/(?:pageid=)(\d+)/i) || raw.match(/\b(\d{1,8})\b/i);
    if (pageIdMatch && pageIdMatch[1]) return { found: true, arg: pageIdMatch[1], source: 'regex-id' };

    const candidateByLlm = await extractConfluenceIdentifierWithLlm(vsCodeApi, raw, options);
    if (candidateByLlm) return { found: true, arg: candidateByLlm, source: 'llm' };

    return { found: false, arg: '', source: 'none' };
}

export default function createRefreshCommand(deps: any) {
    const {
        vscode,
        documentService,
        sidebar,
        storagePath,
        readAllMetadata,
        readDocumentContent,
        writeDocumentFiles,
        refreshCancelEmitter,
        setRefreshCanceled,
        httpManager
    } = deps;

    function normalizeReferencedQueries(value: any): Record<string, string[]> {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const result: Record<string, string[]> = {};
            for (const [q, v] of Object.entries(value)) {
                const key = String(q).trim();
                if (key) {
                    result[key] = Array.isArray(v) ? (v as any[]).map(String).filter(Boolean) : [];
                }
            }
            return result;
        }
        if (Array.isArray(value)) {
            return Object.fromEntries(
                [...new Set(value.map((item: any) => String(item || '').trim()).filter(Boolean))]
                    .map(q => [q, []])
            );
        }
        if (typeof value === 'string') {
            return Object.fromEntries(
                value.split(',').map(item => item.trim()).filter(Boolean).map(q => [q, []])
            );
        }
        return {};
    }

    function extractConfluenceIdFromLink(link: any) {
        const raw = String(link || '').trim();
        if (!raw) {
            return '';
        }

        const pageIdMatch = raw.match(/[?&]pageId=(\d+)/i);
        if (pageIdMatch && pageIdMatch[1]) {
            return pageIdMatch[1];
        }

        const pathIdMatch = raw.match(/\/pages\/(\d+)/i);
        if (pathIdMatch && pathIdMatch[1]) {
            return pathIdMatch[1];
        }

        return '';
    }

    function mergeReferencedQueriesIntoMetadata(target: any, sourceQueries: Map<string, string>, metadataList: any) {
        if (!target || !sourceQueries || sourceQueries.size === 0) {
            return false;
        }

        const targetText = String(target).trim();
        if (!targetText) {
            return false;
        }

        const allMetadata = Array.isArray(metadataList) ? metadataList : [];
        const normalizedTarget = targetText.replace(/\/$/, '');
        const confluenceIdFromLink = extractConfluenceIdFromLink(targetText);

        let docMetadata = allMetadata.find(doc => String(doc?.id || '').trim() === targetText) || null;
        if (!docMetadata && confluenceIdFromLink) {
            docMetadata = allMetadata.find(doc => String(doc?.id || '').trim() === confluenceIdFromLink) || null;
        }
        if (!docMetadata && /^https?:\/\//i.test(targetText)) {
            docMetadata = allMetadata.find(doc => {
                const docUrl = String(doc?.url || '').trim().replace(/\/$/, '');
                return docUrl && docUrl === normalizedTarget;
            }) || null;
        }

        if (!docMetadata || !docMetadata.id || typeof readDocumentContent !== 'function' || typeof writeDocumentFiles !== 'function') {
            return false;
        }

        const content = readDocumentContent(storagePath, docMetadata.id);
        if (!content) {
            return false;
        }

        const existingReferencedQueries = normalizeReferencedQueries(docMetadata.referencedQueries);
        const mergedReferencedQueries: Record<string, string[]> = { ...existingReferencedQueries };
        let added = false;

        for (const [query, datetime] of sourceQueries) {
            const normalizedQuery = String(query || '').trim();
            if (!normalizedQuery) {
                continue;
            }
            const ts = datetime || new Date().toISOString();
            if (!mergedReferencedQueries[normalizedQuery]) {
                mergedReferencedQueries[normalizedQuery] = [ts];
                added = true;
            } else if (ts && !mergedReferencedQueries[normalizedQuery].includes(ts)) {
                mergedReferencedQueries[normalizedQuery] = [...mergedReferencedQueries[normalizedQuery], ts];
                added = true;
            }
        }

        if (!added) {
            return false;
        }

        writeDocumentFiles(storagePath, docMetadata.id, content, {
            ...docMetadata,
            referencedQueries: mergedReferencedQueries
        });

        return true;
    }

    return vscode.commands.registerCommand('repo-ask.refresh', async (arg: any) => {
        // Extract fullIndexRefresh flag if provided
        let fullIndexRefresh = false;
        let refreshArg = arg;
        
        if (typeof arg === 'object' && arg !== null) {
            fullIndexRefresh = arg.fullIndexRefresh || false;
            // Preserve structured command payloads for special refresh modes.
            if (arg.type === 'single') {
                refreshArg = arg.arg;
            } else if (arg.type === 'all') {
                refreshArg = undefined;
            } else {
                refreshArg = arg;
            }
        }

        // Reset cancel state
        if (setRefreshCanceled) {
            setRefreshCanceled(false);
        }
        if (httpManager) {
            httpManager.resetCancel();
        }

        sidebar.setSidebarSyncStatus('Downloading from source...');
        
        // Set up cancel promise
        const cancelPromise = new Promise<never>((_, reject) => {
            if (refreshCancelEmitter) {
                refreshCancelEmitter.once('cancel', () => {
                    reject(new Error('Refresh canceled by user'));
                });
            }
        });
        
        try {
            if (typeof refreshArg === 'object' && refreshArg.type === 'feedback') {
                // Handle feedback sync: load reference queries by ID first, then by links
                sidebar.setSidebarSyncStatus('Loading reference queries from feedback...');
                
                // Get all metadata to check for existing documents
                const allMetadata = readAllMetadata(storagePath);
                const existingIds = new Set(allMetadata.map((doc: any) => String(doc.id)));
                
                // Track feedback targets and source-query mapping for metadata updates.
                const referenceQueries = new Set<string>();
                const sourceQueriesByTarget = new Map<string, Map<string, string>>();
                // Secondary URLs: only union referenced queries, never fully refresh (no KG/summary overwrite).
                const secondarySourceQueriesByTarget = new Map<string, Map<string, string>>();
                
                try {
                    // Get the feedback Confluence page URL from configuration
                    const configuration = vscode.workspace.getConfiguration('repoAsk');
                    const feedbackUrl = configuration.get('logActionConfluenceUrl');
                    
                    if (feedbackUrl) {
                        // Fetch the feedback page content
                        
                        
                        
                        const response = await Promise.race([
                            axios.get(feedbackUrl, {
                                timeout: 10000,
                                maxContentLength: Infinity,
                                maxBodyLength: Infinity
                            }),
                            cancelPromise
                        ]);
                        
                        const $ = cheerio.load((response as any).data);
                        
                        // Extract feedback data from the table
                        $('table tbody tr').each((_, row) => {
                            let sourceQuery = '';
                            let confluencePageId = '';
                            let jiraId = '';
                            let confluenceLink = '';
                            let rowDatetime = '';
                            const rowSecondaryUrls: string[] = [];
                            
                            // Extract data from each row
                            $(row).find('li').each((_, li) => {
                                const text = $(li).text().trim();
                                if (text.startsWith('Date:')) {
                                    rowDatetime = text.replace('Date:', '').trim();
                                } else if (text.includes('Source Query:')) {
                                    sourceQuery = text.replace('Source Query:', '').trim();
                                } else if (text.includes('Confluence Page ID:')) {
                                    confluencePageId = text.replace('Confluence Page ID:', '').trim();
                                } else if (text.includes('Jira ID:')) {
                                    jiraId = text.replace('Jira ID:', '').trim();
                                } else if (text.includes('Confluence/Jira Link:')) {
                                    confluenceLink = text.replace('Confluence/Jira Link:', '').trim();
                                } else if (text.includes('Secondary URLs/IDs:')) {
                                    $(li).contents().each((_, node) => {
                                        if (node.type === 'tag' && node.tagName === 'a') {
                                            const href = ($(node).attr('href') || $(node).text()).trim();
                                            if (href) rowSecondaryUrls.push(href);
                                        } else if (node.type === 'text') {
                                            const val = (node.data || '').trim();
                                            if (val) rowSecondaryUrls.push(val);
                                        }
                                    });
                                }
                            });

                            const feedbackDatetime = rowDatetime || new Date().toISOString();
                            
                            const refreshTarget = String(confluencePageId || jiraId || confluenceLink || '').trim();
                            if (refreshTarget) {
                                referenceQueries.add(refreshTarget);

                                if (sourceQuery) {
                                    const currentQueries = sourceQueriesByTarget.get(refreshTarget) || new Map<string, string>();
                                    currentQueries.set(sourceQuery, feedbackDatetime);
                                    sourceQueriesByTarget.set(refreshTarget, currentQueries);
                                }
                            }

                            // Register secondary docs: only union referenced queries, do not fully refresh.
                            for (const secondaryTarget of rowSecondaryUrls) {
                                const target = secondaryTarget.trim();
                                if (!target) continue;
                                if (sourceQuery) {
                                    const currentQueries = secondarySourceQueriesByTarget.get(target) || new Map<string, string>();
                                    currentQueries.set(sourceQuery, feedbackDatetime);
                                    secondarySourceQueriesByTarget.set(target, currentQueries);
                                }
                            }
                        });
                    }
                } catch (error) {
                    if (error.message === 'Refresh canceled by user') throw error;
                    console.error('Error fetching feedback from Confluence:', error);
                    // Fallback to existing reference queries
                    allMetadata.forEach((doc: any) => {
                        if (doc.referencedQueries && typeof doc.referencedQueries === 'object' && !Array.isArray(doc.referencedQueries)) {
                            Object.keys(doc.referencedQueries).forEach((query: string) => referenceQueries.add(query));
                        } else if (Array.isArray(doc.referencedQueries)) {
                            doc.referencedQueries.forEach((query: any) => referenceQueries.add(String(query)));
                        }
                    });
                }
                
                const queriesArray = Array.from(referenceQueries);
                const total = queriesArray.length;
                let referencedQueryUpdates = 0;
                
                if (total > 0) {
                    for (let i = 0; i < total; i++) {
                        const query = queriesArray[i];
                        sidebar.setSidebarSyncStatus(`Loading reference queries... (${i + 1}/${total})`);
                        const refreshedDocIds = new Set();
                        const collectProcessedDocId = (payload: any) => {
                            const processedId = String(payload?.metadata?.id || '').trim();
                            if (processedId) {
                                refreshedDocIds.add(processedId);
                                existingIds.add(processedId);
                                sidebar.upsertSidebarDocument(payload.metadata);
                            }
                        };
                        
                        try {
                            // First, try to load by ID (if query is an ID)
                            if (/^\d+$/.test(String(query)) || /^[A-Z]+-\d+$/.test(String(query))) {
                                if (!existingIds.has(query)) {
                                    // Try to refresh by ID
                                    try {
                                        await Promise.race([
                                            documentService.refreshDocument(String(query), {
                                                onDocumentProcessed: collectProcessedDocId
                                            }),
                                            cancelPromise
                                        ]);
                                        existingIds.add(query);
                                    } catch (e) {
                                        if (e.message === 'Refresh canceled by user') throw e;
                                        console.error(`Failed to refresh by ID ${query}:`, e);
                                        // If ID refresh fails, try as link
                                        try {
                                            await Promise.race([
                                                documentService.refreshDocument(query, {
                                                    onDocumentProcessed: collectProcessedDocId
                                                }),
                                                cancelPromise
                                            ]);
                                        } catch (e2) {
                                            if (e2.message === 'Refresh canceled by user') throw e2;
                                            console.error(`Failed to refresh by link ${query}:`, e2);
                                        }
                                    }
                                }
                            } else {
                                // Try as link
                                try {
                                    await Promise.race([
                                        documentService.refreshDocument(query, {
                                            onDocumentProcessed: collectProcessedDocId
                                        }),
                                        cancelPromise
                                    ]);
                                } catch (e) {
                                    if (e.message === 'Refresh canceled by user') throw e;
                                    console.error(`Failed to refresh by link ${query}:`, e);
                                }
                            }

                            const sourceQueries = sourceQueriesByTarget.get(query);
                            if (sourceQueries && sourceQueries.size > 0) {
                                const latestMetadata = readAllMetadata(storagePath);
                                let didUpdate = false;

                                // Prefer IDs returned by refresh so URL-based feedback always maps to local metadata.
                                for (const refreshedId of refreshedDocIds) {
                                    if (mergeReferencedQueriesIntoMetadata(refreshedId, sourceQueries, latestMetadata)) {
                                        didUpdate = true;
                                    }
                                }

                                if (!didUpdate && mergeReferencedQueriesIntoMetadata(query, sourceQueries, latestMetadata)) {
                                    didUpdate = true;
                                }

                                if (didUpdate) {
                                    referencedQueryUpdates += 1;
                                }
                            }
                        } catch (e) {
                            if (e.message === 'Refresh canceled by user') throw e;
                            console.error(`Error processing reference query ${query}:`, e);
                        }
                    }
                }
                
                // For secondary URLs: only merge referenced queries without overwriting KG/summary/etc.
                if (secondarySourceQueriesByTarget.size > 0) {
                    const latestMetadataForSecondary = readAllMetadata(storagePath);
                    for (const [target, queries] of secondarySourceQueriesByTarget) {
                        mergeReferencedQueriesIntoMetadata(target, queries, latestMetadataForSecondary);
                    }
                }

                if (referencedQueryUpdates > 0) {
                    sidebar.setSidebarSyncStatus(`Reference queries loaded successfully (${referencedQueryUpdates} metadata updates)`);
                } else {
                    sidebar.setSidebarSyncStatus('Reference queries loaded successfully');
                }
                await Promise.race([new Promise(resolve => setTimeout(resolve, 1000)), cancelPromise]); // Brief delay to show status
            } else if (typeof refreshArg === 'object' && refreshArg.type === 'recursive' && refreshArg.arg) {
                await Promise.race([
                    documentService.refreshConfluenceHierarchy(refreshArg.arg, {
                        onDocumentProcessed: (data: any) => {
                            sidebar.setSidebarSyncStatus(`Downloading from source... (${data.index}/${data.total})`);
                            if (data.metadata) {
                                sidebar.upsertSidebarDocument(data.metadata);
                            }
                        }
                    }),
                    cancelPromise
                ]);
            } else if (refreshArg) {
                const parsedArg = await Promise.race([parseRefreshArg(vscode, refreshArg), cancelPromise]) as any;
                if (parsedArg.source === 'regex-jira') {
                    await Promise.race([
                        documentService.refreshJiraIssue(refreshArg, {
                            onDocumentProcessed: (data: any) => {
                                sidebar.setSidebarSyncStatus(`Downloading from source... (${data.index}/${data.total})`);
                            if (data.metadata) {
                                sidebar.upsertSidebarDocument(data.metadata);
                            }
                            }
                        }),
                        cancelPromise
                    ]);
                } else {
                    await Promise.race([
                        documentService.refreshDocument(refreshArg, {
                            onDocumentProcessed: (data: any) => {
                                sidebar.setSidebarSyncStatus(`Downloading from source... (${data.index}/${data.total})`);
                            if (data.metadata) {
                                sidebar.upsertSidebarDocument(data.metadata);
                            }
                            }
                        }),
                        cancelPromise
                    ]);
                }
            } else {
                await Promise.race([
                    documentService.refreshAllDocuments({
                        onDocumentProcessed: (data: any) => {
                            sidebar.setSidebarSyncStatus(`Downloading from source... (${data.index}/${data.total})`);
                            if (data.metadata) {
                                sidebar.upsertSidebarDocument(data.metadata);
                            }
                        }
                    }),
                    cancelPromise
                ]);
            }
            
            // Trigger full index refresh if requested
            if (fullIndexRefresh) {
                sidebar.setSidebarSyncStatus('Refreshing document index (BM25)...');
                console.log('Starting full BM25 index refresh');
                // Rebuild indexes
                const metadataList = readAllMetadata(storagePath);
                if (metadataList.length > 0) {
                    // This will rebuild the BM25 keywords for all documents
                    await documentService.finalizeBm25KeywordsForDocuments(metadataList.map((m: any) => m.id));
                    console.log('Full BM25 index refresh completed successfully');
                }
                sidebar.setSidebarSyncStatus('Document index refreshed successfully');
                await Promise.race([new Promise(resolve => setTimeout(resolve, 1000)), cancelPromise]); // Brief delay to show status
            }
            
            sidebar.setSidebarSyncStatus('');
            sidebar.setSidebarSyncError('');
            sidebar.refreshSidebarView();
        } catch (error) {
            if (error.message === 'Refresh canceled by user') {
                sidebar.setSidebarSyncStatus('');
                sidebar.setSidebarSyncError('');
            } else {
                sidebar.setSidebarSyncStatus('');
                sidebar.setSidebarSyncError(error.message);
                vscode.window.showErrorMessage(`Refresh failed: ${error.message}`);
            }
        }
    });
};

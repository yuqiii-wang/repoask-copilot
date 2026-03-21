const { toToolResult } = require('./utils');

module.exports = function registerDocRankTool(deps) {
    const { vscode, toolNames, documentService } = deps;
    return vscode.lm.registerTool(toolNames.docRank, {
            async invoke(options) {
                const query = String(options?.input?.query || '').trim();
                const rawLimit = Number(options?.input?.limit);
                const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 5;
                const type = options?.input?.type;
                const tags = options?.input?.tags;

                if (!query) {
                    return toToolResult('Missing required `query` input for rank tool.', { results: [] });
                }

                // Extract and format keywords for ranking
                const keywords = documentService.extractKeywords(query);
                const formattedKeywords = documentService.formatKeywordsForRanking(keywords);
                const formattedQuery = formattedKeywords.join(' ');

                const ranked = documentService.rankLocalDocuments(formattedQuery || query, limit);
                if (!ranked || ranked.length === 0) {
                    return toToolResult('No matching local documents found for the query. Please search the document store in the sidebar to find the document ID, then use that ID in your query to retrieve the specific document.', { results: [] });
                }
                
                // Apply strict AND logic filtering for type and tags
                let filteredResults = ranked;
                
                if (type) {
                    const targetType = String(type).toLowerCase();
                    filteredResults = filteredResults.filter(item => {
                        const itemType = String(item.type || '').toLowerCase();
                        return itemType === targetType;
                    });
                }
                
                if (tags) {
                    const targetTags = Array.isArray(tags) ? tags : [tags];
                    const lowerTargetTags = targetTags.map(tag => String(tag).toLowerCase());
                    
                    filteredResults = filteredResults.filter(item => {
                        const itemTags = Array.isArray(item.tags) ? item.tags.map(tag => String(tag).toLowerCase()) : [];
                        // Ensure all target tags are present in the item's tags
                        return lowerTargetTags.every(targetTag => itemTags.includes(targetTag));
                    });
                }
                
                if (filteredResults.length === 0) {
                    return toToolResult('No matching local documents found after applying type and tag filters.', { results: [] });
                }

                const repAskConfig = vscode.workspace.getConfiguration('repoAsk');
                const confProfile = repAskConfig.get('confluence');
                const confUrl = String((confProfile && typeof confProfile === 'object' ? confProfile.url : '') || '').replace(/\/$/, '');
                
                const jiraProfile = repAskConfig.get('jira');
                const jiraUrl = String((jiraProfile && typeof jiraProfile === 'object' ? jiraProfile.url : '') || '').replace(/\/$/, '');
                
                if (!confUrl) {
                    vscode.window.showErrorMessage('RepoAsk: Confluence URL not configured. Please set repoAsk.confluence.url in settings.');
                    return toToolResult('Confluence URL not configured. Please set repoAsk.confluence.url in settings.', { results: [] });
                }
                
                if (!jiraUrl) {
                    vscode.window.showErrorMessage('RepoAsk: Jira URL not configured. Please set repoAsk.jira.url in settings.');
                    return toToolResult('Jira URL not configured. Please set repoAsk.jira.url in settings.', { results: [] });
                }

                const results = filteredResults.map(item => {
                    let fullUrl = item.url || '';
                    if (fullUrl && !fullUrl.startsWith('http')) {
                        const isJira = item.parent_confluence_topic && String(item.parent_confluence_topic).startsWith('Jira');
                        const baseUrl = isJira ? jiraUrl : confUrl;
                        fullUrl = `${baseUrl}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`;
                    }
                    return {
                        ...item,
                        id: item.id,
                        title: item.title || 'Untitled',
                        url: fullUrl || 'None',
                        score: Number(item.score?.toFixed ? item.score.toFixed(4) : item.score),
                        summary: item.summary || '',
                        author: item.author || 'Unknown',
                        last_updated: item.last_updated || 'Unknown',
                        parent_confluence_topic: item.parent_confluence_topic || 'None',
                        keywords: item.keywords || []
                    };
                });
                const lines = results.map(item => `- [${item.title}](${item.url || 'None'})`);
                const internalThinking = `\n\n<details>\n<summary>Used ${results.length} references</summary>\n\n${lines.join('\n')}\n</details>`;
                return toToolResult(`Top ranked RepoAsk documents:${internalThinking}`, { results });
            }
        });
};

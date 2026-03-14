module.exports = function createRefreshCommand(deps) {
    const { vscode, documentService, sidebar, storagePath, readAllMetadata } = deps;
    const { parseRefreshArg } = require('../tools/llm');

    return vscode.commands.registerCommand('repo-ask.refresh', async (arg) => {
        // Extract fullIndexRefresh flag if provided
        let fullIndexRefresh = false;
        let refreshArg = arg;
        
        if (typeof arg === 'object' && arg !== null) {
            fullIndexRefresh = arg.fullIndexRefresh || false;
            // For recursive refresh, keep the original arg structure
            if (!arg.type || arg.type !== 'recursive') {
                refreshArg = arg.arg;
            }
        }
        
        sidebar.setSidebarSyncStatus('Downloading from source...');
        
        // Set up timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Refresh operation timed out after 10 seconds'));
            }, 10000); // 10-second timeout
        });
        
        try {
            let result;
            if (typeof refreshArg === 'object' && refreshArg.type === 'recursive' && refreshArg.arg) {
                result = await Promise.race([
                    documentService.refreshConfluenceHierarchy(refreshArg.arg, {
                        onDocumentProcessed: (data) => {
                            sidebar.setSidebarSyncStatus(`Downloading from source... (${data.index}/${data.total})`);
                        }
                    }),
                    timeoutPromise
                ]);
            } else if (refreshArg) {
                const parsedArg = await parseRefreshArg(vscode, refreshArg);
                if (parsedArg.source === 'regex-jira') {
                    result = await Promise.race([
                        documentService.refreshJiraIssue(refreshArg, {
                            onDocumentProcessed: (data) => {
                                sidebar.setSidebarSyncStatus(`Downloading from source... (${data.index}/${data.total})`);
                            }
                        }),
                        timeoutPromise
                    ]);
                } else {
                    result = await Promise.race([
                        documentService.refreshDocument(refreshArg, {
                            onDocumentProcessed: (data) => {
                                sidebar.setSidebarSyncStatus(`Downloading from source... (${data.index}/${data.total})`);
                            }
                        }),
                        timeoutPromise
                    ]);
                }
            } else {
                result = await Promise.race([
                    documentService.refreshAllDocuments({
                        onDocumentProcessed: (data) => {
                            sidebar.setSidebarSyncStatus(`Downloading from source... (${data.index}/${data.total})`);
                        }
                    }),
                    timeoutPromise
                ]);
            }
            
            // Trigger full index refresh if requested
            if (fullIndexRefresh) {
                sidebar.setSidebarSyncStatus('Refreshing document index...');
                // Rebuild indexes
                const metadataList = readAllMetadata(storagePath);
                if (metadataList.length > 0) {
                    // This will rebuild the keywords index from metadata
                    documentService.rankLocalDocuments('');
                }
                sidebar.setSidebarSyncStatus('Document index refreshed successfully');
                await new Promise(resolve => setTimeout(resolve, 1000)); // Brief delay to show status
            }
            
            sidebar.setSidebarSyncStatus('');
            sidebar.setSidebarSyncError('');
            sidebar.refreshSidebarView();
        } catch (error) {
            sidebar.setSidebarSyncStatus('');
            sidebar.setSidebarSyncError(error.message);
            vscode.window.showErrorMessage(`Refresh failed: ${error.message}`);
        }
    });
};

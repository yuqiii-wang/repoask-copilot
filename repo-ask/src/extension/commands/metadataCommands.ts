export default function createMetadataCommands(deps: any) {
    const { vscode, documentService } = deps;

    // ── helpers ────────────────────────────────────────────────────────────────

    /** Normalise every field of an incoming message to a non-null value. */
    function normalise(msg: any) {
        return {
            docId:                 String(msg.docId                 || '').trim(),
            conversationSummary:   String(msg.conversationSummary   || '').trim(),
            confluencePageId:      String(msg.confluencePageId      || '').trim(),
            jiraId:                String(msg.jiraId                || '').trim(),
            confluenceLink:        String(msg.confluenceLink        || '').trim(),
            sourceQuery:           String(msg.sourceQuery           || '').trim(),
            existingKnowledgeGraph: String(msg.existingKnowledgeGraph || '').trim(),
            secondaryUrls: Array.isArray(msg.secondaryUrls)
                ? msg.secondaryUrls.map((u: any) => String(u || '').trim()).filter(Boolean)
                : []
        };
    }

    // ── unified generateSummary ────────────────────────────────────────────────

    /**
     * Unified summary generation handler for the feedback form.
     *
     * Feedback form  (no docId):
     *   → resolves input text from conversationSummary or stored doc content,
     *     calls documentService.buildSummary, fires populateSummary.
     *
     * Metadata pane  (message.docId present):
     *   → loads stored doc summary as input, calls documentService.buildSummary,
     *     saves result, fires summaryGenerationState + metadataUpdated.
     */
    async function generateSummary(message: any, docsWebviewView: any, upsertSidebarDocument: any) {
        const { docId, conversationSummary, confluencePageId, jiraId, confluenceLink,
                sourceQuery, existingKnowledgeGraph, secondaryUrls } = normalise(message);

        if (docId) {
            // ── Metadata pane path ──────────────────────────────────────────────
            docsWebviewView.webview.postMessage({ command: 'summaryGenerationState', payload: { docId, isGenerating: true } });
            try {
                const docMeta = documentService.getStoredMetadataById(docId);
                if (!docMeta) throw new Error(`Document ${docId} not found.`);

                const newSummary = await documentService.buildSummary({
                    docId,
                    conversationSummary: String(docMeta.summary || '').trim()
                });
                if (newSummary) {
                    await documentService.saveSummary(docId, newSummary);
                    const updatedMetadata = { ...docMeta, summary: newSummary };
                    upsertSidebarDocument(updatedMetadata);
                    docsWebviewView.webview.postMessage({ command: 'metadataUpdated', payload: { id: updatedMetadata.id, metadata: updatedMetadata } });
                    vscode.window.showInformationMessage(`Generated summary for: ${docMeta.title || docId}`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to generate summary: ${error.message}`);
            } finally {
                docsWebviewView.webview.postMessage({ command: 'summaryGenerationState', payload: { docId, isGenerating: false } });
            }
        } else {
            // ── Feedback form path ──────────────────────────────────────────────
            try {
                const newSummary = await documentService.buildSummary({
                    conversationSummary,
                    confluencePageId,
                    jiraId,
                    confluenceLink
                });

                docsWebviewView.webview.postMessage({ command: 'populateSummary', summary: newSummary || conversationSummary });

                // Opportunistically also build KG when any doc identifiers are available
                if (confluencePageId || jiraId || confluenceLink) {
                    try {
                        const mermaid = await documentService.buildKnowledgeGraph({
                            primaryDocId: confluencePageId || jiraId || '',
                            confluenceLink,
                            secondaryUrls,
                            referenceQueries: sourceQuery ? [sourceQuery] : [],
                            existingKnowledgeGraph,
                            conversationSummary: newSummary || conversationSummary
                        });
                        docsWebviewView.webview.postMessage({ command: 'populateKnowledgeGraph', mermaid: mermaid || '' });
                    } catch (kgErr) {
                        console.error('[generateSummary] KG error:', kgErr);
                        docsWebviewView.webview.postMessage({ command: 'populateKnowledgeGraph', mermaid: '' });
                    }
                }
            } catch (error) {
                console.error('[generateSummary] error:', error);
                vscode.window.showErrorMessage('Failed to generate summary. Please try again.');
                docsWebviewView.webview.postMessage({ command: 'populateSummary', summary: conversationSummary });
            }
        }
    }

    // ── unified generateKnowledgeGraph ────────────────────────────────────────

    /**
     * Unified KG generation handler for both the metadata pane and the
     * feedback form.
     *
     * Metadata pane  (message.docId present):
     *   → loads the stored doc, merges its relatedPages with any supplied
     *     secondaryUrls, calls buildKnowledgeGraph, saves result, fires
     *     kgGenerationState + metadataUpdated.
     *
     * Feedback form  (no docId):
     *   → calls buildKnowledgeGraph with the form IDs / URLs, fires
     *     populateKnowledgeGraph (does NOT write to store).
     */
    async function generateKnowledgeGraph(message: any, docsWebviewView: any, upsertSidebarDocument: any) {
        const { docId, conversationSummary, confluencePageId, jiraId, confluenceLink,
                sourceQuery, existingKnowledgeGraph, secondaryUrls } = normalise(message);

        if (docId) {
            // ── Metadata pane path ──────────────────────────────────────────────
            docsWebviewView.webview.postMessage({ command: 'kgGenerationState', payload: { docId, isGenerating: true } });
            try {
                const docMeta = documentService.getStoredMetadataById(docId);
                if (!docMeta) throw new Error(`Document ${docId} not found.`);

                const mergedSecondary = [
                    ...Array.isArray(docMeta.relatedPages) ? docMeta.relatedPages.filter(Boolean) : [],
                    ...secondaryUrls
                ];
                const mermaid = await documentService.buildKnowledgeGraph({
                    primaryDocId: docMeta.confluencePageId || docMeta.jiraId || docId,
                    confluenceLink: docMeta.url || '',
                    secondaryUrls: mergedSecondary,
                    referenceQueries: Array.isArray(docMeta.referencedQueries) ? docMeta.referencedQueries : [],
                    existingKnowledgeGraph: String(docMeta.knowledgeGraph || '').trim() || existingKnowledgeGraph,
                    conversationSummary: String(docMeta.summary || '').trim() || conversationSummary
                });
                if (mermaid) {
                    await documentService.saveKnowledgeGraph(docId, mermaid);
                    const updatedMetadata = { ...docMeta, knowledgeGraph: mermaid };
                    upsertSidebarDocument(updatedMetadata);
                    docsWebviewView.webview.postMessage({ command: 'metadataUpdated', payload: { id: updatedMetadata.id, metadata: updatedMetadata } });
                    vscode.window.showInformationMessage(`Generated knowledge graph for: ${docMeta.title || docId}`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to generate knowledge graph: ${error.message}`);
            } finally {
                docsWebviewView.webview.postMessage({ command: 'kgGenerationState', payload: { docId, isGenerating: false } });
            }
        } else {
            // ── Feedback form path ──────────────────────────────────────────────
            try {
                const mermaid = await documentService.buildKnowledgeGraph({
                    primaryDocId: confluencePageId || jiraId || '',
                    confluenceLink,
                    secondaryUrls,
                    referenceQueries: sourceQuery ? [sourceQuery] : [],
                    existingKnowledgeGraph,
                    conversationSummary
                });
                docsWebviewView.webview.postMessage({ command: 'populateKnowledgeGraph', mermaid: mermaid || '' });
            } catch (error) {
                console.error('[generateKnowledgeGraph] error:', error);
                docsWebviewView.webview.postMessage({ command: 'populateKnowledgeGraph', mermaid: '' });
            }
        }
    }

    async function saveMetadata(message: any, upsertSidebarDocument: any) {
        if (!message?.docId) {
            return;
        }

        try {
            const updatedMetadata = documentService.updateStoredMetadataById(String(message.docId), {
                type: message.type,
                summary: message.summary,
                keywords: message.keywords,
                tags: message.tags
            });
            upsertSidebarDocument(updatedMetadata);
            vscode.window.showInformationMessage(`Saved metadata for: ${updatedMetadata.title || updatedMetadata.id}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save metadata: ${error.message}`);
        }
    }

    return {
        generateSummary,
        generateKnowledgeGraph,
        saveMetadata
    };
};

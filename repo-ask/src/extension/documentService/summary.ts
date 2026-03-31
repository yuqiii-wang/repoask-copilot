import { buildSummaryRewritePrompt } from '../chat/prompts';
import { withTimeout, collectResponseText, selectDefaultChatModel } from '../chat/shared';

/**
 * summary.js — Unified summary generation for RepoAsk documents.
 *
 * Mirrors the structure of knowledgeGraph.js but for AI-driven summary
 * rewriting.  The central export `buildSummary` accepts a primary document ID
 * (or raw conversation text) and resolves the best available input text before
 * calling the LLM.  `saveSummary` persists the result back to the document's
 * stored metadata and triggers a BM25 keyword refresh.
 */




const LLM_TIMEOUT_MS = 12000;

async function generateSummaryText(vscodeApi: any, inputText: any) {
    if (!vscodeApi.lm || !vscodeApi.LanguageModelChatMessage) return inputText;
    try {
        
        const model = await selectDefaultChatModel(vscodeApi);
        if (!model) return inputText;

        const instruction = buildSummaryRewritePrompt({ inputText });
        const response = await withTimeout(
            model.sendRequest([vscodeApi.LanguageModelChatMessage.User(instruction)], {}),
            LLM_TIMEOUT_MS * 2, null
        );
        if (!response) return inputText;

        const text = await collectResponseText(vscodeApi, response);
        return text.trim() || inputText;
    } catch (error) {
        console.error('[generateSummaryText] LLM error:', error);
        return inputText;
    }
}

export default function (context: any) {
    const {
        vscode,
        storagePath,
        readAllMetadata,
        readDocumentContent,
        writeDocumentFiles,
        getStoredMetadataById,
        finalizeBm25KeywordsForDocuments
    } = context;

    // ── Internal helpers ───────────────────────────────────────────────────────

    /**
     * Resolve a single primary doc from one or more identifiers.
     * Accepts a numeric/string Confluence page ID, a Jira issue key, or a full
     * Confluence/Jira URL (pageId= query-param extraction).
     *
     * @param {string|null} docId          - Direct document ID
     * @param {string|null} confluencePageId
     * @param {string|null} jiraId
     * @param {string|null} confluenceLink - Full URL (optional fallback)
     * @returns {object|null} metadata record or null
     */
    function resolvePrimaryDoc(docId: any, confluencePageId: any, jiraId: any, confluenceLink: any) {
        const allMetadata = readAllMetadata(storagePath);
        if (docId) {
            const found = allMetadata.find((d: any) => String(d.id) === String(docId));
            if (found) return found;
        }
        if (confluencePageId) {
            const found = allMetadata.find((d: any) => String(d.id) === String(confluencePageId));
            if (found) return found;
        }
        if (jiraId) {
            const found = allMetadata.find((d: any) =>
                String(d.issueKey || '').toUpperCase() === jiraId.toUpperCase() ||
                String(d.id) === jiraId
            );
            if (found) return found;
        }
        if (confluenceLink) {
            try {
                const urlObj = new URL(confluenceLink);
                const m = urlObj.search.match(/pageId=(\d+)/);
                if (m && m[1]) return allMetadata.find((d: any) => String(d.id) === String(m[1])) || null;
            } catch (_) {}
        }
        return null;
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Build (or rewrite) a summary for a document or conversation text.
     *
     * Workflow:
     *   1. Use `conversationSummary` as the input text if provided.
     *   2. Otherwise resolve the primary doc and use its stored content/summary.
     *   3. Call the LLM with `buildSummaryRewritePrompt` and return the result.
     *
     * @param {object} params
     * @param {string|null}  [params.docId]               - Document ID (metadata pane)
     * @param {string}       [params.conversationSummary] - Raw text to rewrite
     * @param {string|null}  [params.confluencePageId]    - Confluence page ID (feedback form)
     * @param {string|null}  [params.jiraId]              - Jira issue key (feedback form)
     * @param {string|null}  [params.confluenceLink]      - Full URL fallback resolver
     * @returns {Promise<string>} Rewritten summary string
     */
    async function buildSummary({
        docId = null,
        conversationSummary = '',
        confluencePageId = null,
        jiraId = null,
        confluenceLink = null
    } = {}) {
        let inputText = String(conversationSummary || '').trim();

        if (!inputText) {
            const doc = resolvePrimaryDoc(docId, confluencePageId, jiraId, confluenceLink);
            if (doc) {
                inputText = String(readDocumentContent(storagePath, doc.id) || doc.summary || '').trim();
            }
        }

        if (!inputText) return '';
        return await generateSummaryText(vscode, inputText);
    }

    /**
     * Persist a summary string to a document's stored metadata and trigger a
     * BM25 keyword refresh so the updated summary is indexed.
     *
     * @param {string} docId   - Document ID
     * @param {string} summary - Rewritten summary text
     */
    async function saveSummary(docId: any, summary: any) {
        const metadata = getStoredMetadataById(docId);
        if (!metadata) {
            console.warn('[saveSummary] Document not found:', docId);
            return;
        }
        const content = readDocumentContent(storagePath, docId);
        if (!content) {
            console.warn('[saveSummary] No content for document:', docId);
            return;
        }
        writeDocumentFiles(storagePath, docId, content, { ...metadata, summary: String(summary || '') });
        if (typeof finalizeBm25KeywordsForDocuments === 'function') {
            await finalizeBm25KeywordsForDocuments([docId]);
        }
    }

    return { buildSummary, saveSummary };
};

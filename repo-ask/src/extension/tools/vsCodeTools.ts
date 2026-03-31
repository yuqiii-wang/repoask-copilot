import vscode from 'vscode';
import _pkg from '../../../package.json';
import { runDocCheck } from './docCheckCore';

/**
 * vsCodeTools.js — VS Code extension tool utilities for RepoAsk.
 *
 * Contains:
 *   - Utility helpers (toToolResult, buildCheckAllDocsCommandLink, formatRefreshStatus)
 *   - VS Code LM tool registration (repoask_doc_check)
 *   - createLanguageModelTools factory
 *
 * Core document-check logic lives in docCheckCore.js and is shared with agentTools.js.
 */




const _toolEntry = _pkg?.contributes?.languageModelTools?.[0];
const ALLOWED_MODES = _toolEntry?.inputSchema?.properties?.mode?.enum
    ?? ['id_2_content', 'id_2_metadata', 'id_2_content_partial', 'id_2_metadata_4_summary', 'id_2_metadata_4_summary_kg'];
const DOC_CHECK_TOOL_DESCRIPTION = [
    _toolEntry?.modelDescription,
    _toolEntry?.inputSchema?.properties?.mode?.description,
    'If searchTerms are provided, ranks and returns matching doc IDs and scores.',
    'If no ids and no searchTerms, returns all stored metadata.',
    'If the query contains an explicit Confluence page ID, Jira ticket key, or URL, put it in ids and call mode "id_2_content" directly.'
].filter(Boolean).join(' ');

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers (previously utils.js)
// ─────────────────────────────────────────────────────────────────────────────

function toToolResult(text: any, data?: any) {
    const parts = [new vscode.LanguageModelTextPart(String(text || ''))];
    if (vscode.LanguageModelDataPart && typeof vscode.LanguageModelDataPart.json === 'function' && data !== undefined) {
        parts.push(vscode.LanguageModelDataPart.json(data) as any);
    }
    return new vscode.LanguageModelToolResult(parts);
}

function buildCheckAllDocsCommandLink(query: any) {
    const question = String(query || '').trim();
    if (!question) {
        return 'Run `repo-ask.checkAllDocs` to scan all docs.';
    }
    const encodedArgs = encodeURIComponent(JSON.stringify([question]));
    return `[Check ALL docs](command:repo-ask.checkAllDocs?${encodedArgs})`;
}

function formatRefreshStatus(sourceLabel: any, progress: any = {}) {
    const index = Number(progress?.index);
    const total = Number(progress?.total);
    const hasFraction = Number.isFinite(index) && Number.isFinite(total) && total > 0;
    const progressSuffix = hasFraction ? ` (${index}/${total})` : '';
    return `downloading from ${sourceLabel} ...${progressSuffix}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// VS Code LM tool registration (previously docCheckTool.js + lmTools.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register the repoask_doc_check VS Code LM tool.
 * Delegates core logic to runDocCheck from docCheckCore.js.
 *
 * @param {object} deps
 * @returns {vscode.Disposable}
 */
function registerDocCheckTool(deps: any) {
    
    const { toolNames, documentService, readAllMetadata, readDocumentMetadata, readDocumentContent, emptyStoreHint } = deps;

    return vscode.lm.registerTool(toolNames.docCheck, {
        async invoke(options, _token) {
            try {
                const text = await runDocCheck(options.input || {}, {
                    documentService,
                    readAllMetadata,
                    readDocumentMetadata,
                    readDocumentContent,
                    emptyStoreHint
                });

                // For searchTerms mode, also attach structured data with ranked doc IDs
                const input: any = (options as any).input || {};
                if (Array.isArray(input.searchTerms) && input.searchTerms.length > 0) {
                    const maxLimit = Math.max(1, Number(input.limit) || 3);
                    const ranked = documentService.rankLocalDocuments(input.searchTerms.join(' '), maxLimit * 3);
                    const topDocs = (ranked || []).slice(0, maxLimit);
                    return toToolResult(text, { docIds: topDocs.map((d: any) => String(d.id)), ranked: topDocs });
                }

                return toToolResult(text);
            } catch (err) {
                console.error('[docCheckTool] Error:', err);
                return toToolResult(`Tool error: ${err.message}`);
            }
        }
    });
}

/**
 * Create and register all RepoAsk VS Code LM tools.
 *
 * @param {object} deps
 * @returns {{ registerRepoAskLanguageModelTools: function }}
 */
function createLanguageModelTools(deps: any) {
    function registerRepoAskLanguageModelTools() {
        if (!vscode.lm || typeof vscode.lm.registerTool !== 'function') {
            return [];
        }
        return [registerDocCheckTool(deps)];
    }

    return { registerRepoAskLanguageModelTools };
}

export { // Utilities
    toToolResult,
    buildCheckAllDocsCommandLink,
    formatRefreshStatus,
    // Registration
    createLanguageModelTools,
    // Schema
    ALLOWED_MODES,
    DOC_CHECK_TOOL_DESCRIPTION
};

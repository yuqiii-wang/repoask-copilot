import { useState, useEffect, CSSProperties } from 'react';
import { Metadata } from '../../types';
import { vscode } from '../../vscode';
import FieldGroup from '../shared/FieldGroup';

const PAGE_SIZE = 5;

function escapeHtml(v: unknown) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface MetadataPaneProps {
    selectedDocId: string | null;
    metadata: Metadata | null;
    isSummaryGenerating: boolean;
    isKgGenerating: boolean;
    onMetadataChange: (meta: Metadata | null) => void;
    style?: CSSProperties;
}

export default function MetadataPane({
    selectedDocId, metadata, isSummaryGenerating, isKgGenerating, style
}: MetadataPaneProps) {
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [allCollapsed, setAllCollapsed] = useState(false);

    // Editable draft state for fields
    const [editingField, setEditingField] = useState<string | null>(null);
    const [draftSummary, setDraftSummary] = useState('');
    const [draftTags, setDraftTags] = useState('');
    const [draftType, setDraftType] = useState('custom');

    // Pagination state
    const [rqPage, setRqPage] = useState(0);
    const [rpPage, setRpPage] = useState(0);

    // Active (expanded) row state
    const [activeRqKey, setActiveRqKey] = useState<string | null>(null);
    const [activeRpVal, setActiveRpVal] = useState<string | null>(null);

    // Add-query inline state
    const [addingQuery, setAddingQuery] = useState(false);
    const [draftNewQuery, setDraftNewQuery] = useState('');

    const hasDoc = Boolean(selectedDocId);
    const anyGenerating = isSummaryGenerating || isKgGenerating;

    // Reset draft/editing state whenever the selected doc changes
    useEffect(() => {
        setEditingField(null);
        setDraftSummary('');
        setDraftTags('');
        setDraftType('custom');
        setRqPage(0);
        setRpPage(0);
        setActiveRqKey(null);
        setActiveRpVal(null);
        setAddingQuery(false);
        setDraftNewQuery('');
    }, [selectedDocId]);

    function toggleField(id: string) {
        setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
    }

    function toggleAll() {
        const next = !allCollapsed;
        setAllCollapsed(next);
        setCollapsed({ type: next, summary: next, tags: next, refqueries: next, relatedpages: next, kg: next, details: next });
    }

    function startEdit(field: string) {
        if (!hasDoc || anyGenerating) { return; }
        setEditingField(field);
        if (field === 'summary') { setDraftSummary(String(metadata?.summary || '')); }
        if (field === 'tags') { setDraftTags(Array.isArray(metadata?.tags) ? metadata!.tags.join(', ') : ''); }
        if (field === 'type') { setDraftType(String(metadata?.type || 'custom')); }
    }

    function cancelEdit() {
        setEditingField(null);
    }

    function saveEdit() {
        if (!selectedDocId) { return; }
        const type = editingField === 'type' ? draftType : String(metadata?.type || 'custom');
        const summary = editingField === 'summary' ? draftSummary : String(metadata?.summary || '');
        const tags = editingField === 'tags'
            ? draftTags.split(',').map(t => t.trim()).filter(Boolean).join(', ')
            : (Array.isArray(metadata?.tags) ? metadata!.tags.join(', ') : '');
        vscode.postMessage({ command: 'saveMetadata', docId: selectedDocId, type, summary, tags });
        setEditingField(null);
    }

    // Detail items: everything except well-known fields
    const detailItems = metadata && typeof metadata === 'object'
        ? Object.entries(metadata).filter(([k]) =>
            !['summary', 'keywords', 'tags', 'referencedQueries', 'type', 'knowledgeGraph', 'relatedPages', 'version'].includes(k)
        ).map(([key, value]) => {
            if (Array.isArray(value)) { return { key, value: value.join(', ') }; }
            if (value && typeof value === 'object') { return { key, value: JSON.stringify(value) }; }
            return { key, value: String(value ?? '') };
        })
        : [];

    function removeRefQuery(query: string) {
        if (!selectedDocId || !metadata) { return; }
        const current = metadata.referencedQueries
            ? { ...metadata.referencedQueries }
            : {};
        delete current[query];
        setActiveRqKey(null);
        vscode.postMessage({ command: 'saveMetadata', docId: selectedDocId, referencedQueries: current });
    }

    function confirmAddQuery() {
        const q = draftNewQuery.trim();
        setAddingQuery(false);
        setDraftNewQuery('');
        if (!q || !selectedDocId || !metadata) { return; }
        const current = metadata.referencedQueries
            ? { ...metadata.referencedQueries }
            : {};
        if (!current[q]) { current[q] = []; }
        vscode.postMessage({ command: 'saveMetadata', docId: selectedDocId, referencedQueries: current });
    }

    function removeRelatedPage(val: string) {
        if (!selectedDocId || !metadata) { return; }
        const current = metadata.relatedPages
            ? metadata.relatedPages.filter(p => p !== val)
            : [];
        setActiveRpVal(null);
        vscode.postMessage({ command: 'saveMetadata', docId: selectedDocId, relatedPages: current });
    }

    return (
        <section className={`metadata-pane${anyGenerating ? ' is-busy' : ''}`} style={style}>
            <div className="viewer-header">
                <h2 className="viewer-title">Metadata</h2>
                <div className="metadata-actions">
                    <button className="metadata-section-btn" type="button" title="Toggle all" onClick={toggleAll}>
                        {allCollapsed ? '▶' : '▼'}
                    </button>
                </div>
            </div>

            {/* Type */}
            <FieldGroup id="type" label="Type" collapsed={!!collapsed.type} onToggle={() => toggleField('type')}
                actions={editingField === 'type' ? <>
                    <button className="field-cancel-btn action-btn action-btn-sm" type="button" onClick={cancelEdit}>Cancel</button>
                    <button className="field-save-btn action-btn action-btn-sm" type="button" onClick={saveEdit}>Save</button>
                </> : null}
            >
                <select
                    id="type-input"
                    className="metadata-select"
                    disabled={!hasDoc || anyGenerating}
                    value={editingField === 'type' ? draftType : String(metadata?.type || 'custom')}
                    onMouseDown={() => startEdit('type')}
                    onChange={e => setDraftType(e.target.value)}
                >
                    <option value="confluence">Confluence</option>
                    <option value="jira">Jira</option>
                    <option value="skill">Skill</option>
                    <option value="custom">Custom</option>
                </select>
            </FieldGroup>

            {/* Summary */}
            <FieldGroup id="summary" label="Summary" collapsed={!!collapsed.summary} onToggle={() => toggleField('summary')}
                actions={<>
                    <button
                        id="generate-summary-btn"
                        className={`action-btn action-btn-sm${isSummaryGenerating ? ' is-loading' : ''}`}
                        type="button"
                        disabled={!hasDoc || isSummaryGenerating}
                        onClick={() => { if (selectedDocId && !isSummaryGenerating) { vscode.postMessage({ command: 'generateSummaryForDoc', docId: selectedDocId }); } }}
                    >
                        AI Gen
                    </button>
                    {editingField === 'summary' ? <>
                        <button className="field-cancel-btn action-btn action-btn-sm" type="button" onClick={cancelEdit}>Cancel</button>
                        <button className="field-save-btn action-btn action-btn-sm" type="button" onClick={saveEdit}>Save</button>
                    </> : null}
                </>}
            >
                <textarea
                    id="summary-input"
                    className="metadata-textarea"
                    rows={3}
                    placeholder="Summary is empty. Generate or edit it."
                    readOnly={editingField !== 'summary'}
                    value={editingField === 'summary' ? draftSummary : String(metadata?.summary || '')}
                    onFocus={() => startEdit('summary')}
                    onChange={e => setDraftSummary(e.target.value)}
                />
            </FieldGroup>

            {/* Tags */}
            <FieldGroup id="tags" label="Tags (comma separated)" collapsed={!!collapsed.tags} onToggle={() => toggleField('tags')}
                actions={editingField === 'tags' ? <>
                    <button className="field-cancel-btn action-btn action-btn-sm" type="button" onClick={cancelEdit}>Cancel</button>
                    <button className="field-save-btn action-btn action-btn-sm" type="button" onClick={saveEdit}>Save</button>
                </> : null}
            >
                <textarea
                    id="tags-input"
                    className="metadata-textarea metadata-textarea-keywords"
                    rows={2}
                    placeholder="tag-a, tag-b"
                    readOnly={editingField !== 'tags'}
                    value={editingField === 'tags' ? draftTags : (Array.isArray(metadata?.tags) ? metadata!.tags.join(', ') : '')}
                    onFocus={() => startEdit('tags')}
                    onChange={e => setDraftTags(e.target.value)}
                />
            </FieldGroup>

            {/* Referenced Queries */}
            {(() => {
                const rq = metadata?.referencedQueries
                    ? Object.entries(metadata.referencedQueries)
                    : [];
                const rqTotalPages = Math.max(1, Math.ceil(rq.length / PAGE_SIZE));
                const safeRqPage = Math.min(rqPage, rqTotalPages - 1);
                const rqSlice = rq.slice(safeRqPage * PAGE_SIZE, (safeRqPage + 1) * PAGE_SIZE);
                return (
                    <FieldGroup id="refqueries" label="Referenced Queries" collapsed={!!collapsed.refqueries} onToggle={() => toggleField('refqueries')}
                        actions={
                            <button className="action-btn action-btn-sm" type="button" title="Add query"
                                disabled={!hasDoc}
                                onClick={() => { setAddingQuery(v => !v); setDraftNewQuery(''); }}>+</button>
                        }
                    >
                        {rq.length === 0 && !addingQuery
                            ? <p className="referenced-queries-empty">No referenced queries yet. Queries will appear here after syncing via <em>Feedback Referenced Docs</em>.</p>
                            : rq.length > 0
                                ? <>
                                    <table className="referenced-queries-table">
                                        <thead>
                                            <tr>
                                                <th className="rq-col-query">Query</th>
                                                <th className="rq-col-count">Feedback #</th>
                                                <th className="rq-col-last">Last Time</th>
                                                <th className="rq-col-action"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rqSlice.map(([query, timestamps]) => {
                                                const dates = Array.isArray(timestamps) ? timestamps.filter(Boolean) : [];
                                                const lastDate = dates.length > 0
                                                    ? new Date(dates.reduce((a, b) => a > b ? a : b)).toLocaleDateString()
                                                    : '—';
                                                const isActive = activeRqKey === query;
                                                return (
                                                    <tr key={query}
                                                        className={`rq-row${isActive ? ' rq-row--active' : ''}`}
                                                        onClick={() => setActiveRqKey(prev => prev === query ? null : query)}
                                                    >
                                                        <td className="rq-col-query">
                                                            <span className={isActive ? 'rq-text--expanded' : 'rq-text--collapsed'}>{query}</span>
                                                        </td>
                                                        <td className="rq-col-count">{dates.length > 0 ? dates.length : '—'}</td>
                                                        <td className="rq-col-last">
                                                            <span className={isActive ? 'rq-text--expanded' : 'rq-text--collapsed'}>{lastDate}</span>
                                                        </td>
                                                        <td className="rq-col-action">
                                                            {isActive && (
                                                                <button className="rq-remove-btn" type="button" title="Remove entry"
                                                                    onClick={e => { e.stopPropagation(); removeRefQuery(query); }}>×</button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    {rq.length > PAGE_SIZE && (
                                        <div className="pagination-controls">
                                            <button className="action-btn action-btn-sm" type="button" disabled={safeRqPage === 0} onClick={() => setRqPage(safeRqPage - 1)}>‹</button>
                                            <span className="pagination-info">{safeRqPage + 1} / {rqTotalPages}</span>
                                            <button className="action-btn action-btn-sm" type="button" disabled={safeRqPage >= rqTotalPages - 1} onClick={() => setRqPage(safeRqPage + 1)}>›</button>
                                        </div>
                                    )}
                                </>
                                : null
                        }
                        {addingQuery && (
                            <div className="rq-add-row">
                                <input
                                    className="search-input rq-add-input"
                                    type="text"
                                    placeholder="Type a query and press Enter"
                                    autoFocus
                                    value={draftNewQuery}
                                    onChange={e => setDraftNewQuery(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') { confirmAddQuery(); }
                                        else if (e.key === 'Escape') { setAddingQuery(false); setDraftNewQuery(''); }
                                    }}
                                />
                                <button className="action-btn action-btn-sm" type="button" onClick={confirmAddQuery}>✓</button>
                                <button className="action-btn action-btn-sm" type="button" onClick={() => { setAddingQuery(false); setDraftNewQuery(''); }}>✗</button>
                            </div>
                        )}
                    </FieldGroup>
                );
            })()}

            {/* Related Pages */}
            {(() => {
                const rp = metadata?.relatedPages?.filter(Boolean) ?? [];
                const rpTotalPages = Math.max(1, Math.ceil(rp.length / PAGE_SIZE));
                const safeRpPage = Math.min(rpPage, rpTotalPages - 1);
                const rpSlice = rp.slice(safeRpPage * PAGE_SIZE, (safeRpPage + 1) * PAGE_SIZE);
                return (
                    <FieldGroup id="relatedpages" label="Related Pages" collapsed={!!collapsed.relatedpages} onToggle={() => toggleField('relatedpages')}>
                        {rp.length === 0
                            ? <p className="referenced-queries-empty">No related pages</p>
                            : <>
                                <ul id="related-pages-list" className="referenced-queries-list">
                                    {rpSlice.map((p, i) => {
                                        const isActive = activeRpVal === p;
                                        return (
                                            <li key={i}
                                                className={`referenced-query-item rp-item${isActive ? ' rp-item--active' : ''}`}
                                                onClick={() => setActiveRpVal(prev => prev === p ? null : p)}
                                            >
                                                <span className={isActive ? 'rq-text--expanded' : 'rq-text--collapsed'}>{String(p)}</span>
                                                {isActive && (
                                                    <button className="rq-remove-btn rp-remove-btn" type="button" title="Remove page"
                                                        onClick={e => { e.stopPropagation(); removeRelatedPage(p); }}>×</button>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                                {rp.length > PAGE_SIZE && (
                                    <div className="pagination-controls">
                                        <button className="action-btn action-btn-sm" type="button" disabled={safeRpPage === 0} onClick={() => setRpPage(safeRpPage - 1)}>‹</button>
                                        <span className="pagination-info">{safeRpPage + 1} / {rpTotalPages}</span>
                                        <button className="action-btn action-btn-sm" type="button" disabled={safeRpPage >= rpTotalPages - 1} onClick={() => setRpPage(safeRpPage + 1)}>›</button>
                                    </div>
                                )}
                            </>
                        }
                    </FieldGroup>
                );
            })()}

            {/* Knowledge Graph */}
            <FieldGroup id="kg" label="Knowledge Graph (Mermaid)" collapsed={!!collapsed.kg} onToggle={() => toggleField('kg')}
                actions={
                    <button
                        id="generate-kg-btn"
                        className={`action-btn action-btn-sm${isKgGenerating ? ' is-loading' : ''}`}
                        type="button"
                        disabled={!hasDoc || isKgGenerating}
                        onClick={() => { if (selectedDocId && !isKgGenerating) { vscode.postMessage({ command: 'generateKgForDoc', docId: selectedDocId }); } }}
                    >
                        AI Gen
                    </button>
                }
            >
                <textarea
                    id="knowledge-graph-input"
                    className="metadata-textarea"
                    rows={6}
                    placeholder="No knowledge graph generated yet."
                    disabled
                    value={String(metadata?.knowledgeGraph || '')}
                    readOnly
                />
            </FieldGroup>

            {/* Details */}
            <FieldGroup id="details" label="Details" collapsed={!!collapsed.details} onToggle={() => toggleField('details')}>
                <ul id="metadata-list" className="metadata-list">
                    {metadata?.version !== undefined && (
                        <li key="version" className="metadata-item metadata-item-immutable">
                            <span className="metadata-detail-key">version:</span>
                            <span className="metadata-detail-value">{String(metadata.version)}</span>
                        </li>
                    )}
                    {detailItems.length === 0 && metadata?.version === undefined
                        ? <li className="metadata-item">title: -</li>
                        : detailItems.map(item => (
                            <li key={item.key} className="metadata-item">{escapeHtml(item.key)}: {escapeHtml(item.value as string)}</li>
                        ))
                    }
                </ul>
            </FieldGroup>
        </section>
    );
}

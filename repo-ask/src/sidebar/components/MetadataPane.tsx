import { useState, CSSProperties } from 'react';
import { Metadata } from '../types';
import { vscode } from '../vscode';

function escapeHtml(v: unknown) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface FieldGroupProps {
    id: string;
    label: string;
    children: React.ReactNode;
    actions?: React.ReactNode;
    collapsed: boolean;
    onToggle: () => void;
}

function FieldGroup({ id, label, children, actions, collapsed, onToggle }: FieldGroupProps) {
    return (
        <div className="metadata-field-group" id={`field-group-${id}`}>
            <div className="metadata-field-header">
                <label className="metadata-label">{label}</label>
                <div className="metadata-field-actions">
                    {actions}
                    <button className="metadata-section-btn" type="button" title={collapsed ? 'Expand' : 'Collapse'} onClick={onToggle}>
                        {collapsed ? '▶' : '▼'}
                    </button>
                </div>
            </div>
            {!collapsed && children}
        </div>
    );
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

    const hasDoc = Boolean(selectedDocId);
    const anyGenerating = isSummaryGenerating || isKgGenerating;

    function toggleField(id: string) {
        setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
    }

    function toggleAll() {
        const next = !allCollapsed;
        setAllCollapsed(next);
        setCollapsed({ type: next, summary: next, tags: next, refqueries: next, relatedpages: next, kg: next, details: next });
    }

    function startEdit(field: string) {
        if (!hasDoc || anyGenerating) return;
        setEditingField(field);
        if (field === 'summary') setDraftSummary(String(metadata?.summary || ''));
        if (field === 'tags') setDraftTags(Array.isArray(metadata?.tags) ? metadata!.tags.join(', ') : '');
        if (field === 'type') setDraftType(String(metadata?.type || 'custom'));
    }

    function cancelEdit() {
        setEditingField(null);
    }

    function saveEdit() {
        if (!selectedDocId) return;
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
            !['summary', 'keywords', 'tags', 'referencedQueries', 'type', 'knowledgeGraph', 'relatedPages'].includes(k)
        ).map(([key, value]) => {
            if (Array.isArray(value)) return { key, value: value.join(', ') };
            if (value && typeof value === 'object') return { key, value: JSON.stringify(value) };
            return { key, value: String(value ?? '') };
        })
        : [];

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
                        onClick={() => { if (selectedDocId && !isSummaryGenerating) vscode.postMessage({ command: 'generateSummaryForDoc', docId: selectedDocId }); }}
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
            <FieldGroup id="refqueries" label="Referenced Queries" collapsed={!!collapsed.refqueries} onToggle={() => toggleField('refqueries')}>
                <ul id="referenced-queries-list" className="referenced-queries-list">
                    {metadata?.referencedQueries && (Array.isArray(metadata.referencedQueries) ? metadata.referencedQueries : String(metadata.referencedQueries).split(',').map(q => q.trim()).filter(Boolean)).length > 0
                        ? (Array.isArray(metadata.referencedQueries) ? metadata.referencedQueries : String(metadata.referencedQueries).split(',').map(q => q.trim()).filter(Boolean)).map((q, i) => (
                            <li key={i} className="referenced-query-item"><span className="query-text">{String(q)}</span></li>
                        ))
                        : <li className="referenced-query-empty">No referenced queries</li>
                    }
                </ul>
            </FieldGroup>

            {/* Related Pages */}
            <FieldGroup id="relatedpages" label="Related Pages" collapsed={!!collapsed.relatedpages} onToggle={() => toggleField('relatedpages')}>
                <ul id="related-pages-list" className="referenced-queries-list">
                    {metadata?.relatedPages && Array.isArray(metadata.relatedPages) && metadata.relatedPages.filter(Boolean).length > 0
                        ? metadata.relatedPages.filter(Boolean).map((p, i) => (
                            <li key={i} className="referenced-query-item">{String(p)}</li>
                        ))
                        : <li className="referenced-query-empty">No related pages</li>
                    }
                </ul>
            </FieldGroup>

            {/* Knowledge Graph */}
            <FieldGroup id="kg" label="Knowledge Graph (Mermaid)" collapsed={!!collapsed.kg} onToggle={() => toggleField('kg')}
                actions={
                    <button
                        id="generate-kg-btn"
                        className={`action-btn action-btn-sm${isKgGenerating ? ' is-loading' : ''}`}
                        type="button"
                        disabled={!hasDoc || isKgGenerating}
                        onClick={() => { if (selectedDocId && !isKgGenerating) vscode.postMessage({ command: 'generateKgForDoc', docId: selectedDocId }); }}
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
                    {detailItems.length === 0
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

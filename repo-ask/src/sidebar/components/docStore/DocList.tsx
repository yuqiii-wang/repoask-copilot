import { DocSummary } from '../../types';
interface DocListProps {
    docs: DocSummary[];
    selectedDocId: string | null;
    onSelect: (docId: string) => void;
    onDelete: (docId: string, title: string) => void;
}

export default function DocList({ docs, selectedDocId, onSelect, onDelete }: DocListProps) {
    if (!docs || docs.length === 0) {
        return (
            <p className="empty">
                No local documents yet. Use the sync button to download from Confluence Cloud.
            </p>
        );
    }

    return (
        <>
            {docs.map(doc => {
                const title = doc.title || 'Untitled';
                const isActive = String(doc.id) === String(selectedDocId);
                return (
                    <div key={doc.id} className={`doc-item${isActive ? ' active' : ''}`} data-doc-id={doc.id}>
                        <button
                            className="doc-open-btn"
                            title={`Open ${title}`}
                            onClick={() => onSelect(String(doc.id))}
                        >
                            <span className="doc-title">{title}</span>
                        </button>
                        <button
                            className="doc-delete-btn"
                            title={`Delete ${title}`}
                            aria-label={`Delete ${title}`}
                            onClick={() => onDelete(String(doc.id), title)}
                        >
                            ×
                        </button>
                    </div>
                );
            })}
        </>
    );
}

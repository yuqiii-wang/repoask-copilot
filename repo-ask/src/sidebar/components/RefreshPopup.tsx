import { useState } from 'react';
import { SyncType } from '../types';
import { vscode } from '../vscode';

interface RefreshPopupProps {
    onClose: () => void;
    onSyncStatusChange: (msg: string) => void;
}

export default function RefreshPopup({ onClose, onSyncStatusChange }: RefreshPopupProps) {
    const [syncType, setSyncType] = useState<SyncType>('single');
    const [singleInput, setSingleInput] = useState('');
    const [allInput, setAllInput] = useState('');
    const [fullIndex, setFullIndex] = useState(false);
    const [syncing, setSyncing] = useState(false);

    function handleSubmit() {
        setSyncing(true);
        const fullIndexRefresh = fullIndex;

        if (syncType === 'reset') {
            onSyncStatusChange('resetting to default documents...');
            vscode.postMessage({ command: 'resetToDefaultDocs', fullIndexRefresh });
        } else if (syncType === 'feedback') {
            onSyncStatusChange('syncing documents from feedback submissions...');
            vscode.postMessage({ command: 'refreshDocs', isFeedback: true, fullIndexRefresh });
        } else if (syncType === 'all') {
            onSyncStatusChange('downloading from confluence/jira cloud ...');
            vscode.postMessage({ command: 'refreshDocs', isAll: true, arg: allInput.trim(), fullIndexRefresh });
        } else {
            const arg = singleInput.trim();
            if (!arg) {
                setSyncing(false);
                vscode.postMessage({ command: 'clearSyncError' });
                // signal error upward via syncStatus channel using a known pattern
                onSyncStatusChange('');
                vscode.postMessage({ command: 'displayError', error: 'Please provide a valid URL or ID' });
                return;
            }
            onSyncStatusChange('downloading from source ...');
            vscode.postMessage({ command: 'refreshDocs', isAll: false, arg, fullIndexRefresh });
        }
        onClose();
    }

    return (
        <div className="refresh-popup" style={{ display: 'block' }}>
            <div className="refresh-popup-header">
                <h3 style={{ margin: 0, fontSize: 13 }}>Refresh Documents</h3>
                <button className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>&times;</button>
            </div>
            <div className="refresh-popup-body" style={{ padding: '10px 0' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {(['single', 'all', 'feedback', 'reset'] as SyncType[]).map(t => (
                        <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="radio" name="syncType" value={t} checked={syncType === t}
                                onChange={() => setSyncType(t)} />
                            {t === 'single' ? 'Single URL/ID' : t === 'all' ? 'All Documents' : t === 'feedback' ? 'Feedback Referenced Docs' : 'Reset to Default'}
                        </label>
                    ))}
                </div>

                {syncType === 'single' && (
                    <input type="text" className="search-input" placeholder="Confluence URL or Jira ID"
                        style={{ width: '100%' }} value={singleInput}
                        onChange={e => setSingleInput(e.target.value)}
                        autoFocus />
                )}
                {syncType === 'all' && (
                    <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 12 }}>
                        <p style={{ margin: 0 }}>Sync all documents from a parent Confluence page?</p>
                        <input type="text" className="search-input" placeholder="Enter a Confluence parent URL"
                            style={{ width: '100%', marginTop: 8 }} value={allInput}
                            onChange={e => setAllInput(e.target.value)} />
                        <p style={{ marginTop: 8, fontWeight: 'bold' }}>All doc sync could take a long time...</p>
                    </div>
                )}
                {syncType === 'reset' && (
                    <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 12 }}>
                        <p style={{ margin: 0 }}>Remove all current documents and reload default docs only.</p>
                        <p style={{ marginTop: 8, fontWeight: 'bold', color: 'var(--vscode-editorError-foreground)' }}>
                            This will delete all existing local documents!
                        </p>
                    </div>
                )}
                {syncType === 'feedback' && (
                    <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 12 }}>
                        <p style={{ margin: 0 }}>Sync documents from Confluence URLs referenced in feedback submissions.</p>
                        <p style={{ marginTop: 8, fontWeight: 'bold' }}>This will download and index all documents referenced in feedback.</p>
                    </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                    <input type="checkbox" id="full-index-refresh" checked={fullIndex}
                        onChange={e => setFullIndex(e.target.checked)} />
                    <label htmlFor="full-index-refresh" style={{ cursor: 'pointer', fontSize: 10 }}>
                        Full document index refresh after sync
                    </label>
                </div>
            </div>
            <div className="refresh-popup-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button className="action-btn" onClick={() => vscode.postMessage({ command: 'openDocStore' })}>
                    Open Doc Store
                </button>
                <button className="action-btn" onClick={handleSubmit} disabled={syncing}>
                    {syncing ? <span className="spinner" /> : 'Sync'}
                </button>
            </div>
        </div>
    );
}

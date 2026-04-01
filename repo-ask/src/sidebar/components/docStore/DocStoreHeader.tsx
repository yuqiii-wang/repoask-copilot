import { useState } from 'react';
import { vscode } from '../../vscode';
import RefreshPopup from './RefreshPopup';

interface DocStoreHeaderProps {
    syncStatus: string;
    onSyncStatusChange: (msg: string) => void;
    onSearch: (query: string, type: string) => void;
}

export default function DocStoreHeader({ syncStatus, onSyncStatusChange, onSearch }: DocStoreHeaderProps) {
    const [showPopup, setShowPopup] = useState(false);
    const isLoading = syncStatus.toLowerCase().includes('downloading from');

    function handleCancelRefresh() {
        vscode.postMessage({ command: 'cancelRefresh' });
    }

    return (
        <header className="header" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 className="title">Doc Store</h1>
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                    {!isLoading ? (
                        <button
                            className="icon-btn"
                            aria-label="Refresh Documents"
                            title="Refresh Documents"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 4, display: 'flex', alignItems: 'center' }}
                            onClick={() => setShowPopup(v => !v)}
                        >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                <path fillRule="evenodd" clipRule="evenodd" d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53 8.36l.334.943A6 6 0 1 1 4.681 3z" />
                            </svg>
                        </button>
                    ) : (
                        <button
                            className="icon-btn is-spinning"
                            aria-label="Cancel Refresh"
                            title="Cancel Refresh"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-button-background)', padding: 4, display: 'flex', alignItems: 'center' }}
                            onClick={handleCancelRefresh}
                        >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                <path fillRule="evenodd" clipRule="evenodd" d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53 8.36l.334.943A6 6 0 1 1 4.681 3z" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {showPopup && (
                <RefreshPopup
                    onClose={() => setShowPopup(false)}
                    onSyncStatusChange={onSyncStatusChange}
                />
            )}

            <p className="subtitle">Local Confluence documents</p>
            {syncStatus && (
                <p
                    className={`sync-status visible${isLoading ? ' loading' : ''}`}
                    aria-live="polite"
                >
                    {syncStatus}
                </p>
            )}

            <div style={{ display: 'flex', gap: 4, marginTop: 8, alignItems: 'stretch' }}>
                <select
                    className="search-type-filter"
                    aria-label="Filter by type"
                    style={{ background: 'var(--vscode-dropdown-background)', color: 'var(--vscode-dropdown-foreground)', border: '1px solid var(--vscode-dropdown-border)', borderRadius: 2 }}
                    onChange={e => onSearch('', e.target.value)}
                    defaultValue=""
                >
                    <option value="">All Types</option>
                    <option value="confluence">Confluence</option>
                    <option value="jira">Jira</option>
                    <option value="skill">Skill</option>
                    <option value="custom">Custom</option>
                </select>
                <input
                    className="search-input"
                    type="text"
                    placeholder="Search local-store"
                    style={{ flex: 1, minWidth: 0 }}
                    onChange={e => onSearch(e.target.value, '')}
                />
            </div>
        </header>
    );
}

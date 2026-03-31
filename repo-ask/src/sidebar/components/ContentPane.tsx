import { useState, useRef, useEffect } from 'react';
import { vscode } from '../vscode';

interface ContentPaneProps {
    contentHtml: string;
    selectedDocId: string | null;
}

export default function ContentPane({ contentHtml, selectedDocId }: ContentPaneProps) {
    const hasDoc = Boolean(selectedDocId);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!dropdownOpen) return;
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [dropdownOpen]);

    return (
        <section className="content-pane">
            <div className="viewer-header">
                <h2 className="viewer-title">Content</h2>
                <div className="header-actions">
                    <button
                        id="add-to-prompts-btn"
                        className="action-btn"
                        type="button"
                        disabled={!hasDoc}
                        onClick={() => { if (selectedDocId) vscode.postMessage({ command: 'addToPrompts', docId: selectedDocId }); }}
                    >
                        Add to Prompts
                    </button>
                    <div className="split-btn-group" ref={dropdownRef}>
                        <button
                            id="add-to-skills-btn"
                            className="action-btn split-btn-main"
                            type="button"
                            disabled={!hasDoc}
                            onClick={() => { if (selectedDocId) vscode.postMessage({ command: 'addToSkills', docId: selectedDocId }); }}
                        >
                            Add to Skills
                        </button>
                        <button
                            className="action-btn split-btn-arrow"
                            type="button"
                            disabled={!hasDoc}
                            title="More options"
                            onClick={() => setDropdownOpen(prev => !prev)}
                        >
                            ▾
                        </button>
                        {dropdownOpen && (
                            <div className="split-btn-dropdown">
                                <button
                                    className="dropdown-item"
                                    type="button"
                                    onClick={() => {
                                        setDropdownOpen(false);
                                        if (selectedDocId) vscode.postMessage({ command: 'addToolToSkills', docId: selectedDocId });
                                    }}
                                >
                                    Add a Tool/Script
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div
                id="doc-content"
                className="doc-content"
                dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
        </section>
    );
}

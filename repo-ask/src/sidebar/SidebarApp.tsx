import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DocSummary, Metadata } from './types';
import DocStoreHeader from './components/docStore/DocStoreHeader';
import DocList from './components/docStore/DocList';
import ContentPane from './components/docViewer/ContentPane';
import MetadataPane from './components/docViewer/MetadataPane';
import FeedbackSection from './components/feedback/FeedbackSection';
import { vscode } from './vscode';

declare global {
    interface Window {
        __SIDEBAR_DATA__: {
            docs: DocSummary[];
            syncStatus: string;
            syncError: string;
            syncSuccess: string;
        };
    }
}

export default function SidebarApp() {
    const initial = window.__SIDEBAR_DATA__ || { docs: [], syncStatus: '', syncError: '', syncSuccess: '' };

    const [docs, setDocs] = useState<DocSummary[]>(Array.isArray(initial.docs) ? initial.docs : []);
    const [syncStatus, setSyncStatus] = useState<string>(String(initial.syncStatus || ''));
    const [syncError, setSyncError] = useState<string>(String(initial.syncError || ''));
    const [syncSuccess, setSyncSuccess] = useState<string>(String(initial.syncSuccess || ''));
    const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
    const [docContentHtml, setDocContentHtml] = useState<string>('Select a document to view local content.');
    const [metadata, setMetadata] = useState<Metadata | null>(null);
    const [isSummaryGenerating, setIsSummaryGenerating] = useState(false);
    const [isKgGenerating, setIsKgGenerating] = useState(false);
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedbackInitData, setFeedbackInitData] = useState<{
        firstUserQuery?: string;
        firstRankedDocUrl?: string;
        fullAiResponse?: string;
        queryStartTime?: number;
        username?: string;
        selectedDocument?: Record<string, any> | null;
    } | null>(null);

    // Resizable pane heights
    const containerRef = useRef<HTMLElement>(null);
    const viewerRef = useRef<HTMLElement>(null);
    const [listHeight, setListHeight] = useState(200);
    const [metadataHeight, setMetadataHeight] = useState(200);
    const isMainResizing = useRef(false);
    const isViewerResizing = useRef(false);

    // Handle messages from the extension host
    useEffect(() => {
        function handleMessage(event: MessageEvent) {
            const msg = event.data;
            if (!msg?.command) return;

            switch (msg.command) {
                case 'syncStatus':
                    setSyncStatus(String(msg.payload || ''));
                    break;
                case 'syncError':
                    setSyncError(String(msg.payload || ''));
                    break;
                case 'displayError':
                    setSyncError(String(msg.error || ''));
                    break;
                case 'searchResults':
                    setDocs(Array.isArray(msg.payload) ? msg.payload : []);
                    break;
                case 'docUpserted': {
                    const incoming = msg.payload || {};
                    const docId = String(incoming.id || '').trim();
                    if (docId) {
                        setDocs(prev => {
                            const idx = prev.findIndex(d => String(d.id) === docId);
                            const next: DocSummary = { id: incoming.id, title: incoming.title || 'Untitled', last_updated: incoming.last_updated || '' };
                            const arr = idx >= 0
                                ? prev.map((d, i) => i === idx ? { ...d, ...next } : d)
                                : [...prev, next];
                            return arr.sort((a, b) => String(b.last_updated || '').localeCompare(String(a.last_updated || '')));
                        });
                    }
                    break;
                }
                case 'docDeleted': {
                    const deletedId = String(msg.payload?.id || '').trim();
                    if (deletedId) {
                        setDocs(prev => prev.filter(d => String(d.id) !== deletedId));
                        if (selectedDocId === deletedId) {
                            setSelectedDocId(null);
                            setDocContentHtml('Select a document to view local content.');
                            setMetadata(null);
                        }
                    }
                    break;
                }
                case 'docDetails':
                case 'selectDoc': {
                    const { id, contentHtml, metadata: meta } = msg.payload || {};
                    setSelectedDocId(String(id || ''));
                    setDocContentHtml(contentHtml || 'No content available.');
                    setMetadata(meta || null);
                    break;
                }
                case 'metadataUpdated': {
                    const { id, metadata: meta } = msg.payload || {};
                    if (String(id) === String(selectedDocId)) {
                        setMetadata(meta || null);
                    }
                    break;
                }
                case 'summaryGenerationState':
                    if (String(msg.payload?.docId) === String(selectedDocId)) {
                        setIsSummaryGenerating(Boolean(msg.payload?.isGenerating));
                        if (!msg.payload?.isGenerating) {
                            // summary may have been set via populateSummary already
                        }
                    }
                    break;
                case 'kgGenerationState':
                    if (String(msg.payload?.docId) === String(selectedDocId)) {
                        setIsKgGenerating(Boolean(msg.payload?.isGenerating));
                    }
                    break;
                case 'populateSummary':
                    setMetadata(prev => prev ? { ...prev, summary: String(msg.summary || '') } : null);
                    setIsSummaryGenerating(false);
                    break;
                case 'populateKnowledgeGraph':
                    setMetadata(prev => prev ? { ...prev, knowledgeGraph: String(msg.mermaid || '') } : null);
                    setIsKgGenerating(false);
                    break;
                case 'addToPromptsSuccess':
                    setSyncSuccess(`Added to prompts: ${msg.payload}`);
                    break;
                case 'addToPromptsError':
                    setSyncError(String(msg.payload || 'Failed to add to prompts'));
                    break;
                case 'addToSkillsSuccess':
                    setSyncSuccess(`Added to skills: ${msg.payload}`);
                    break;
                case 'addToSkillsError':
                    setSyncError(String(msg.payload || 'Failed to add to skills'));
                    break;
                case 'addToolToSkillsSuccess':
                    setSyncSuccess(`Tool/script added: ${msg.payload}`);
                    break;
                case 'addToolToSkillsError':
                    setSyncError(String(msg.payload || 'Failed to add tool/script'));
                    break;
                case 'showFeedbackForm':
                    setFeedbackInitData({
                        firstUserQuery: msg.firstUserQuery,
                        firstRankedDocUrl: msg.firstRankedDocUrl,
                        fullAiResponse: msg.fullAiResponse,
                        queryStartTime: msg.queryStartTime,
                        username: msg.username,
                        selectedDocument: msg.selectedDocument || null,
                    });
                    setShowFeedback(true);
                    break;
                case 'feedbackSubmitted':
                    if (msg.success) {
                        setShowFeedback(false);
                        setSyncSuccess('Feedback submitted successfully.');
                    } else {
                        setSyncError(String(msg.error || 'Feedback submission failed.'));
                    }
                    break;
            }
        }

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [selectedDocId]);

    const handleSearch = useCallback((query: string, type: string) => {
        vscode.postMessage({ command: 'searchDocs', query, type });
    }, []);

    const handleSelectDoc = useCallback((docId: string) => {
        setSelectedDocId(docId);
        vscode.postMessage({ command: 'openDoc', docId });
    }, []);

    const handleDeleteDoc = useCallback((docId: string, title: string) => {
        vscode.postMessage({ command: 'deleteDoc', docId, title });
    }, []);

    // Main splitter drag (list height)
    const onMainSplitterDown = useCallback((e: React.PointerEvent) => {
        if (!containerRef.current) return;
        isMainResizing.current = true;
        document.body.classList.add('is-resizing');
        (e.target as Element).setPointerCapture(e.pointerId);
        const containerTop = containerRef.current.getBoundingClientRect().top;
        const onMove = (ev: PointerEvent) => {
            if (!isMainResizing.current) return;
            const newH = Math.max(80, Math.min(ev.clientY - containerTop - 10, window.innerHeight - 300));
            setListHeight(newH);
        };
        const onUp = () => {
            isMainResizing.current = false;
            document.body.classList.remove('is-resizing');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, []);

    // Viewer splitter drag (metadata height from bottom)
    const onViewerSplitterDown = useCallback((e: React.PointerEvent) => {
        if (!viewerRef.current) return;
        isViewerResizing.current = true;
        document.body.classList.add('is-resizing');
        (e.target as Element).setPointerCapture(e.pointerId);
        const viewerRect = viewerRef.current.getBoundingClientRect();
        const onMove = (ev: PointerEvent) => {
            if (!isViewerResizing.current) return;
            const fromTop = ev.clientY - viewerRect.top;
            const remaining = Math.max(60, viewerRect.height - fromTop - 6);
            setMetadataHeight(Math.max(60, Math.min(remaining, viewerRect.height - 80)));
        };
        const onUp = () => {
            isViewerResizing.current = false;
            document.body.classList.remove('is-resizing');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, []);

    return (
        <main className="container" ref={containerRef as React.RefObject<HTMLElement>} style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            {/* Error banner */}
            {syncError && (
                <div className="banner error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 10px', flexShrink: 0 }}>
                    <span className="banner-message">Error: {syncError}</span>
                    <button className="banner-close" aria-label="Dismiss" onClick={() => { setSyncError(''); vscode.postMessage({ command: 'clearSyncError' }); }}>&times;</button>
                </div>
            )}
            {/* Success banner */}
            {syncSuccess && (
                <div className="banner success" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 10px', flexShrink: 0 }}>
                    <span className="banner-message">{syncSuccess}</span>
                    <button className="banner-close" aria-label="Dismiss" onClick={() => { setSyncSuccess(''); vscode.postMessage({ command: 'clearSyncSuccess' }); }}>&times;</button>
                </div>
            )}

            {/* Header with search & refresh popup */}
            <div id="top-area" style={{ flexShrink: 0 }}>
                <DocStoreHeader
                    syncStatus={syncStatus}
                    onSyncStatusChange={setSyncStatus}
                    onSearch={handleSearch}
                />
            </div>

            {/* Document list — resizable */}
            <section
                id="doc-list"
                className="doc-list"
                style={{ height: listHeight, overflowY: 'auto', flexShrink: 0 }}
            >
                <DocList
                    docs={docs}
                    selectedDocId={selectedDocId}
                    onSelect={handleSelectDoc}
                    onDelete={handleDeleteDoc}
                />
            </section>

            {/* Main splitter */}
            <div
                className="main-splitter"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize list and detail"
                onPointerDown={onMainSplitterDown}
                style={{ flexShrink: 0 }}
            />

            {/* Viewer — content + metadata, each resizable */}
            <section
                className="viewer"
                ref={viewerRef as React.RefObject<HTMLElement>}
                style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}
            >
                {/* Content pane takes the remaining space */}
                <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                    <ContentPane
                        contentHtml={docContentHtml}
                        selectedDocId={selectedDocId}
                    />
                </div>

                {/* Viewer splitter */}
                <div
                    id="viewer-splitter"
                    className="viewer-splitter"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize content and metadata"
                    onPointerDown={onViewerSplitterDown}
                    style={{ flexShrink: 0 }}
                />

                {/* Metadata + Feedback pane — shared scrollable container */}
                <div style={{ height: metadataHeight, overflowY: 'auto', flexShrink: 0, position: 'relative' }}>
                    <MetadataPane
                        selectedDocId={selectedDocId}
                        metadata={metadata}
                        isSummaryGenerating={isSummaryGenerating}
                        isKgGenerating={isKgGenerating}
                        onMetadataChange={setMetadata}
                    />
                    <FeedbackSection
                        visible={showFeedback}
                        selectedDocId={selectedDocId}
                        initialData={feedbackInitData}
                        onClose={() => setShowFeedback(false)}
                    />
                </div>
            </section>
        </main>
    );
}

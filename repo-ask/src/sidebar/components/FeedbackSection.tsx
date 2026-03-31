import { useState, useCallback, useEffect } from 'react';
import { vscode } from '../vscode';

interface FeedbackSectionProps {
    visible: boolean;
    selectedDocId: string | null;
    initialData?: {
        firstUserQuery?: string;
        firstRankedDocUrl?: string;
        fullAiResponse?: string;
        queryStartTime?: number;
        username?: string;
        selectedDocument?: Record<string, any> | null;
    } | null;
    onClose?: () => void;
}

interface SecondaryUrl {
    id: number;
    value: string;
}

let _nextId = 0;

export default function FeedbackSection({ visible, selectedDocId, initialData, onClose }: FeedbackSectionProps) {
    const [sourceQuery, setSourceQuery] = useState('');
    const [conversationSummary, setConversationSummary] = useState('');
    const [confluenceLink, setConfluenceLink] = useState('');
    const [confluencePageId, setConfluencePageId] = useState('');
    const [jiraId, setJiraId] = useState('');
    const [username, setUsername] = useState('Anonymous');
    const [elapsedTime, setElapsedTime] = useState('');
    const [datetime, setDatetime] = useState(() => new Date().toISOString().slice(0, 16));
    const [tags, setTags] = useState('');
    const [knowledgeGraphRaw, setKnowledgeGraphRaw] = useState('');
    const [secondaryUrls, setSecondaryUrls] = useState<SecondaryUrl[]>([{ id: _nextId++, value: '' }]);
    const [isSummaryGenerating, setIsSummaryGenerating] = useState(false);
    const [isKgGenerating, setIsKgGenerating] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const anyGenerating = isSummaryGenerating || isKgGenerating;

    // Populate form when initialData changes (triggered by showFeedbackForm message)
    useEffect(() => {
        if (!visible || !initialData) return;
        const doc = initialData.selectedDocument as Record<string, any> | null | undefined;
        const fallbackUrl = typeof initialData.firstRankedDocUrl === 'string' ? initialData.firstRankedDocUrl : '';
        setSourceQuery(String(initialData.firstUserQuery || ''));
        setConversationSummary(typeof initialData.fullAiResponse === 'string' ? initialData.fullAiResponse : '');
        setConfluenceLink(String(doc?.url || fallbackUrl || ''));
        setConfluencePageId(String(doc?.confluencePageId || ''));
        setJiraId(String(doc?.jiraId || ''));
        setUsername(String(initialData.username || 'Anonymous'));
        setKnowledgeGraphRaw(String(doc?.knowledgeGraph || ''));
        if (initialData.queryStartTime) {
            const elapsedMs = Date.now() - initialData.queryStartTime;
            setElapsedTime(String(Math.round(elapsedMs / 1000)));
        }
        setDatetime(new Date().toISOString().slice(0, 16));
        setIsSubmitting(false);
    }, [visible, initialData]);

    // Listen for AI-generated summary and knowledge graph
    useEffect(() => {
        if (!visible) return () => {};
        function handleMsg(event: MessageEvent) {
            const msg = event.data;
            if (!msg?.command) return;
            if (msg.command === 'populateSummary') {
                setConversationSummary(String(msg.summary || ''));
                setIsSummaryGenerating(false);
            } else if (msg.command === 'populateKnowledgeGraph') {
                setKnowledgeGraphRaw(String(msg.mermaid || ''));
                setIsKgGenerating(false);
            } else if (msg.command === 'summaryGenerationState') {
                setIsSummaryGenerating(Boolean(msg.payload?.isGenerating));
            } else if (msg.command === 'kgGenerationState') {
                setIsKgGenerating(Boolean(msg.payload?.isGenerating));
            }
        }
        window.addEventListener('message', handleMsg);
        return () => window.removeEventListener('message', handleMsg);
    }, [visible]);

    const syncIdAndLink = useCallback((link: string, confId: string, jira: string) => {
        if (confId) {
            setJiraId('');
            vscode.postMessage({ command: 'getDocumentByID', id: confId });
        } else if (jira) {
            setConfluencePageId('');
            vscode.postMessage({ command: 'getDocumentByID', id: jira });
        } else if (link) {
            const confMatch = link.match(/(?:[?&]pageId=|\/pages\/|\/viewpage\/|\.action\/|\?pageId=)(\d+)/i);
            if (confMatch?.[1]) {
                setConfluencePageId(confMatch[1]);
                setJiraId('');
                vscode.postMessage({ command: 'getDocumentByID', id: confMatch[1] });
                return;
            }
            const jiraMatch = link.match(/[A-Z]+-\d+/i);
            if (jiraMatch) {
                setJiraId(jiraMatch[0].toUpperCase());
                setConfluencePageId('');
                vscode.postMessage({ command: 'getDocumentByID', id: jiraMatch[0].toUpperCase() });
            }
        }
    }, []);

    function addSecondaryUrl() {
        setSecondaryUrls(prev => [...prev, { id: _nextId++, value: '' }]);
    }

    function removeSecondaryUrl(id: number) {
        setSecondaryUrls(prev => prev.filter(u => u.id !== id));
    }

    function updateSecondaryUrl(id: number, value: string) {
        setSecondaryUrls(prev => prev.map(u => u.id === id ? { ...u, value } : u));
    }

    function handleSubmit() {
        if (!conversationSummary.trim()) {
            vscode.postMessage({ command: 'displayError', error: 'Conversation Summary is required.' });
            return;
        }
        if (!sourceQuery.trim() || !datetime.trim()) {
            vscode.postMessage({ command: 'displayError', error: 'Please fill in Source Query and Datetime.' });
            return;
        }
        if (!confluencePageId.trim() && !jiraId.trim()) {
            vscode.postMessage({ command: 'displayError', error: 'Please provide either Confluence Page ID or Jira ID.' });
            return;
        }
        if (confluencePageId.trim() && !/^\d+$/.test(confluencePageId.trim())) {
            vscode.postMessage({ command: 'displayError', error: 'Confluence Page ID must be numeric.' });
            return;
        }

        setIsSubmitting(true);
        vscode.postMessage({
            command: 'submitFeedback',
            feedbackPayload: {
                sourceQuery: sourceQuery.trim(),
                conversationSummary: conversationSummary.trim(),
                confluenceLink: confluenceLink.trim(),
                confluencePageId: confluencePageId.trim(),
                jiraId: jiraId.trim(),
                username: username.trim() || 'Anonymous',
                elapsedTime: elapsedTime.trim(),
                datetime: datetime.trim(),
                tags: tags.trim(),
                knowledgeGraph: knowledgeGraphRaw.trim(),
                secondaryUrls: secondaryUrls.map(u => u.value.trim()).filter(Boolean),
            }
        });
    }

    if (!visible) return null;

    return (
        <section id="feedback-section" className="feedback-section" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'auto', zIndex: 10 }}>
            <div className="feedback-header">
                <h2 className="feedback-title">Submit Feedback</h2>
            </div>
            <div className="feedback-form">
                <div className="form-group">
                    <label htmlFor="source-query">Source Query</label>
                    <input type="text" id="source-query" className="form-input" placeholder="Enter the source query"
                        value={sourceQuery} onChange={e => setSourceQuery(e.target.value)} />
                </div>
                <div className="form-group">
                    <div className="metadata-field-header">
                        <label htmlFor="conversation-summary" className="metadata-label">Conversation Content/Summary</label>
                        <div className="metadata-field-actions">
                            <button
                                className={`action-btn action-btn-sm${isSummaryGenerating ? ' is-loading' : ''}`}
                                disabled={isSummaryGenerating || anyGenerating}
                                onClick={() => { setIsSummaryGenerating(true); vscode.postMessage({ command: 'generateSummaryForDoc', docId: selectedDocId }); }}
                            >
                                AI Gen
                            </button>
                        </div>
                    </div>
                    <textarea id="conversation-summary" className="form-textarea"
                        placeholder="Enter a summary of the conversation"
                        value={conversationSummary} onChange={e => setConversationSummary(e.target.value)} />
                </div>
                <div className="form-group">
                    <label htmlFor="confluence-link">Confluence Page/Jira Link</label>
                    <input type="text" id="confluence-link" className="form-input" placeholder="Enter the relevant link"
                        value={confluenceLink}
                        onChange={e => { setConfluenceLink(e.target.value); syncIdAndLink(e.target.value, confluencePageId, jiraId); }} />
                </div>
                {!jiraId && (
                    <div className="form-group">
                        <label htmlFor="confluence-page-id">Confluence Page ID</label>
                        <input type="text" id="confluence-page-id" className="form-input" placeholder="Enter Confluence page ID"
                            value={confluencePageId}
                            onChange={e => { setConfluencePageId(e.target.value); syncIdAndLink(confluenceLink, e.target.value, jiraId); }} />
                    </div>
                )}
                {!confluencePageId && (
                    <div className="form-group">
                        <label htmlFor="jira-id">Jira ID</label>
                        <input type="text" id="jira-id" className="form-input" placeholder="Enter Jira issue ID"
                            value={jiraId}
                            onChange={e => { setJiraId(e.target.value); syncIdAndLink(confluenceLink, confluencePageId, e.target.value); }} />
                    </div>
                )}
                <div className="form-group">
                    <label htmlFor="username">Username</label>
                    <input type="text" id="username" className="form-input" placeholder="Enter username"
                        value={username} onChange={e => setUsername(e.target.value)} />
                </div>
                <div className="form-group">
                    <label htmlFor="elapsed-time">Elapsed Time (s)</label>
                    <input type="number" id="elapsed-time" className="form-input" placeholder="Elapsed Time"
                        value={elapsedTime} onChange={e => setElapsedTime(e.target.value)} />
                </div>
                <div className="form-group">
                    <label htmlFor="datetime">Datetime</label>
                    <input type="datetime-local" id="datetime" className="form-input"
                        value={datetime} onChange={e => setDatetime(e.target.value)} />
                </div>
                <div className="form-group">
                    <label htmlFor="fb-tags">Tags</label>
                    <input type="text" id="fb-tags" className="form-input" placeholder="Enter comma-separated tags"
                        value={tags} onChange={e => setTags(e.target.value)} />
                </div>
                <div className="form-group">
                    <div className="metadata-field-header">
                        <label className="metadata-label">Secondary URLs/IDs</label>
                        <div className="metadata-field-actions">
                            <button type="button" className="action-btn action-btn-sm" title="Add secondary URL" onClick={addSecondaryUrl}>+</button>
                        </div>
                    </div>
                    <div id="secondary-urls-container">
                        {secondaryUrls.map(u => (
                            <div key={u.id} className="secondary-url-item">
                                <input type="text" className="form-input secondary-url-input" placeholder="Enter secondary URL or ID"
                                    value={u.value} onChange={e => updateSecondaryUrl(u.id, e.target.value)} />
                                <button type="button" className="action-btn action-btn-sm" title="Remove"
                                    onClick={() => removeSecondaryUrl(u.id)}>×</button>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="form-group">
                    <div className="metadata-field-header">
                        <label htmlFor="knowledge-graph-raw" className="metadata-label">Knowledge Graph (Mermaid)</label>
                        <div className="metadata-field-actions">
                            <button
                                className={`action-btn action-btn-sm${isKgGenerating ? ' is-loading' : ''}`}
                                type="button"
                                disabled={isKgGenerating || anyGenerating}
                                onClick={() => { setIsKgGenerating(true); vscode.postMessage({ command: 'generateKgForDoc', docId: selectedDocId }); }}
                            >
                                AI Gen
                            </button>
                        </div>
                    </div>
                    <textarea id="knowledge-graph-raw" className="form-textarea" rows={6}
                        placeholder="No knowledge graph yet. Click 'AI Gen' to build."
                        value={knowledgeGraphRaw} onChange={e => setKnowledgeGraphRaw(e.target.value)} />
                </div>
                <div className="form-actions">
                    <button id="submit-feedback-btn" className="action-btn primary"
                        disabled={isSubmitting || anyGenerating}
                        onClick={handleSubmit}>
                        Submit
                    </button>
                    <button id="cancel-feedback-btn" className="action-btn"
                        onClick={() => onClose?.()}>
                        Cancel
                    </button>
                </div>
            </div>
        </section>
    );
}

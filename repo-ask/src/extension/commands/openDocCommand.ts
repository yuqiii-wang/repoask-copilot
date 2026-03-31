import MarkdownIt from 'markdown-it';

export default function createOpenDocCommand(deps: any) {
    const { readAllMetadata, readDocumentContent } = deps;

    return async function openDoc(message: any, docsWebviewView: any) {
        if (!message?.docId) {
            return;
        }

        const metadata = readAllMetadata(deps.storagePath).find((doc: any) => String(doc.id) === String(message.docId));
        const rawContent = metadata
            ? (readDocumentContent(deps.storagePath, metadata.id) || 'No local markdown content found.')
            : 'No local markdown content found.';
        const content = metadata
            ? rewriteMarkdownImageLinksForWebview(rawContent, metadata.id, docsWebviewView.webview, deps)
            : rawContent;
        const contentHtml = renderMarkdownForWebview(content);

        docsWebviewView.webview.postMessage({
            command: 'docDetails',
            payload: {
                id: message.docId,
                content,
                contentHtml,
                metadata: metadata || null
            }
        });
    };
};

function rewriteMarkdownImageLinksForWebview(markdownContent: any, docId: any, webview: any, deps: any) {
    const { fs, path, vscode, storagePath } = deps;
    const markdown = String(markdownContent || '');
    const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;

    return markdown.replace(imagePattern, (fullMatch, alt, srcRaw) => {
        const source = normalizeMarkdownLinkTarget(srcRaw);
        if (!source || /^https?:\/\//i.test(source) || /^data:image\//i.test(source)) {
            return fullMatch;
        }

        const filePath = path.isAbsolute(source)
            ? source
            : path.join(storagePath, String(docId), source.replace(/\//g, path.sep));

        if (!fs.existsSync(filePath)) {
            return fullMatch;
        }

        const webviewUri = webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
        return `![${String(alt || '').trim()}](${webviewUri})`;
    });
}

function normalizeMarkdownLinkTarget(rawValue: any) {
    const value = String(rawValue || '').trim();
    if (!value) {
        return '';
    }

    if (value.startsWith('<') && value.endsWith('>')) {
        return value.slice(1, -1).trim();
    }

    return value;
}

function renderMarkdownForWebview(markdownContent: any) {
    
    const markdownRenderer = new MarkdownIt({
        html: false,
        linkify: true,
        breaks: true
    });
    return markdownRenderer.render(String(markdownContent || ''));
}

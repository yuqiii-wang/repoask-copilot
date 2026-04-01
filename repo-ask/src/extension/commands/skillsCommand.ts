import fs from 'fs';
import path from 'path';

export default function createSkillsCommand(deps: any) {
    const { vscode, documentService, readAllMetadata, readDocumentContent, storagePath } = deps;

    async function addToSkills(message: any, docsWebviewView: any) {
        const docId = String(message.docId || '').trim();
        if (!docId) {
            vscode.window.showWarningMessage('Select a document first to add it to skills.');
            return;
        }

        const metadata = readAllMetadata(storagePath).find((doc: any) => String(doc.id) === docId);
        if (!metadata) {
            vscode.window.showWarningMessage('Document metadata not found. Run refresh and try again.');
            return;
        }

        if (!metadata.summary || String(metadata.summary).trim().length === 0) {
            docsWebviewView.webview.postMessage({ command: 'addToSkillsError', payload: 'Please populate metadata summary either manually or via AI generation before adding to skill.' });
            return;
        }

        const content = readDocumentContent(storagePath, metadata.id);
        if (!content || String(content).trim().length === 0) {
            vscode.window.showWarningMessage('Local document content is empty. Refresh this doc and try again.');
            return;
        }

        try {
            const createdPath = documentService.writeDocumentSkillFile(metadata, content);
            docsWebviewView.webview.postMessage({ command: 'addToSkillsSuccess', payload: createdPath });
        } catch (error) {
            docsWebviewView.webview.postMessage({ command: 'addToSkillsError', payload: error.message });
        }
    }

    async function addToolToSkills(message: any, docsWebviewView: any) {
        const docId = String(message.docId || '').trim();
        if (!docId) {
            vscode.window.showWarningMessage('Select a document first.');
            return;
        }

        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Add as Tool/Script',
            title: 'Select a tool/script file'
        });
        if (!uris || uris.length === 0) return;

        const srcFilePath = uris[0].fsPath;
        const scriptsDir = path.join(storagePath, docId, 'scripts');
        fs.mkdirSync(scriptsDir, { recursive: true });
        const fileName = path.basename(srcFilePath);
        const destPath = path.join(scriptsDir, fileName);
        fs.copyFileSync(srcFilePath, destPath);

        docsWebviewView.webview.postMessage({ command: 'addToolToSkillsSuccess', payload: destPath });
    }

    async function showSkillScripts(message: any) {
        const docId = String(message.docId || '').trim();
        if (!docId) {
            vscode.window.showWarningMessage('Select a document first.');
            return;
        }

        const scriptsDir = path.join(storagePath, docId, 'scripts');
        if (!fs.existsSync(scriptsDir)) {
            fs.mkdirSync(scriptsDir, { recursive: true });
        }

        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(scriptsDir));
    }

    return { addToSkills, addToolToSkills, showSkillScripts };};

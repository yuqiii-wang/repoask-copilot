import fs from 'fs';
import path from 'path';
import type { Metadata, Keywords, ReferencedQueries } from './sidebar/types';

/** Minimal shape of the VS Code extension context used by storage helpers. */
interface VsCodeExtensionContext {
    globalStorageUri: { fsPath: string };
}

const CONTENT_FILE_NAME = 'content.md';
const METADATA_FILE_NAME = 'metadata.json';
const IMAGES_DIR_NAME = 'images';

function getLocalStorePath(context: VsCodeExtensionContext): string {
    return path.join(context.globalStorageUri.fsPath, 'local-store');
}

function getLocalIndexStorePath(context: VsCodeExtensionContext): string {
    return path.join(context.globalStorageUri.fsPath, 'local-store-index');
}

function ensureStoragePath(context: VsCodeExtensionContext): string {
    const storagePath = getLocalStorePath(context);
    fs.mkdirSync(storagePath, { recursive: true });
    return storagePath;
}

function ensureIndexStoragePath(context: VsCodeExtensionContext): string {
    const indexPath = getLocalIndexStorePath(context);
    fs.mkdirSync(indexPath, { recursive: true });
    return indexPath;
}

function rewriteMetadataFile(metadataPath: string, fallbackId: string): boolean {
    if (!fs.existsSync(metadataPath)) {
        return false;
    }

    try {
        const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        const normalized = normalizeStoredMetadataSchema(fallbackId, raw);
        const rawText = JSON.stringify(raw, null, 2);
        const normalizedText = JSON.stringify(normalized, null, 2);
        if (rawText !== normalizedText) {
            fs.writeFileSync(metadataPath, normalizedText, 'utf8');
            return true;
        }
    } catch {
        // Ignore malformed metadata files during backfill.
    }

    return false;
}

function getDocumentDirectory(storagePath: string, docId: string): string {
    return path.join(storagePath, String(docId));
}

function getDocumentContentPath(storagePath: string, docId: string): string {
    return path.join(getDocumentDirectory(storagePath, docId), CONTENT_FILE_NAME);
}

function getDocumentMetadataPath(storagePath: string, docId: string): string {
    return path.join(getDocumentDirectory(storagePath, docId), METADATA_FILE_NAME);
}

function getDocumentImagesDirectory(storagePath: string, docId: string): string {
    return path.join(getDocumentDirectory(storagePath, docId), IMAGES_DIR_NAME);
}

function readAllMetadata(storagePath: string): Metadata[] {
    const entries = fs.existsSync(storagePath)
        ? fs.readdirSync(storagePath, { withFileTypes: true })
        : [];

    const byId = new Map<string, Metadata>();
    const metadataList: Metadata[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const metadataPath = path.join(storagePath, entry.name, METADATA_FILE_NAME);
        if (!fs.existsSync(metadataPath)) {
            continue;
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            if (parsed && parsed.id !== undefined && parsed.id !== null) {
                byId.set(String(parsed.id), parsed);
            }
        } catch {
            // Ignore malformed metadata files
        }
    }

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }

        const metadataPath = path.join(storagePath, entry.name);
        try {
            const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            const parsedId = parsed && parsed.id !== undefined && parsed.id !== null
                ? String(parsed.id)
                : path.parse(entry.name).name;

            if (!byId.has(parsedId)) {
                byId.set(parsedId, parsed);
            }
        } catch {
            // Ignore malformed metadata files
        }
    }

    metadataList.push(...byId.values());
    return metadataList;
}

function backfillStoredMetadataSchema(storagePath: string): void {
    const entries = fs.existsSync(storagePath)
        ? fs.readdirSync(storagePath, { withFileTypes: true })
        : [];

    for (const entry of entries) {
        if (entry.isDirectory()) {
            rewriteMetadataFile(path.join(storagePath, entry.name, METADATA_FILE_NAME), entry.name);
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.json')) {
            rewriteMetadataFile(path.join(storagePath, entry.name), path.parse(entry.name).name);
        }
    }
}

function normalizeStoredMetadataSchema(docId: string, metadata: unknown): Metadata {
    const base: Record<string, unknown> = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};
    // Normalize referencedQueries to Record<string, string[]> (query → ISO datetime list)
    let normalizedReferencedQueries: ReferencedQueries;
    if (base.referencedQueries && typeof base.referencedQueries === 'object' && !Array.isArray(base.referencedQueries)) {
        // Already in new format — ensure all values are string[]
        normalizedReferencedQueries = {};
        for (const [q, v] of Object.entries(base.referencedQueries)) {
            const key = String(q).trim();
            if (key) {
                normalizedReferencedQueries[key] = Array.isArray(v)
                    ? (v as any[]).map((s: any) => String(s)).filter(Boolean)
                    : [];
            }
        }
    } else if (Array.isArray(base.referencedQueries)) {
        // Legacy: string[] → each query maps to empty datetime list
        normalizedReferencedQueries = Object.fromEntries(
            [...new Set((base.referencedQueries as unknown[]).map((value) => String(value || '').trim()).filter(Boolean))]
                .map(q => [q, []])
        );
    } else if (typeof base.referencedQueries === 'string') {
        normalizedReferencedQueries = Object.fromEntries(
            [...new Set((base.referencedQueries as string).split(',').map((value) => value.trim()).filter(Boolean))]
                .map(q => [q, []])
        );
    } else {
        normalizedReferencedQueries = {};
    }

    const result: Metadata = {
        ...base,
        id: base.id !== undefined && base.id !== null ? String(base.id) : pageIdToId(docId),
        keywords: (base.keywords && typeof base.keywords === 'object' && !Array.isArray(base.keywords))
            ? base.keywords as unknown as Keywords
            : undefined,
        tags: Array.isArray(base.tags) ? (base.tags as string[]) : [],
        referencedQueries: normalizedReferencedQueries,
        summary: typeof base.summary === 'string' ? base.summary : '',
        feedback: typeof base.feedback === 'string' ? base.feedback : '',
        knowledgeGraph: typeof base.knowledgeGraph === 'string' ? base.knowledgeGraph : '',
        relatedPages: Array.isArray(base.relatedPages) ? (base.relatedPages as string[]) : []
    };
    delete (result as Record<string, unknown>).synonyms;  // legacy field — synonyms now live in keywords.synonyms
    return result;
}

function pageIdToId(docId: string): string {
    return String(docId);
}

function writeDocumentFiles(storagePath: string, pageId: string, markdownContent: string, metadata: Metadata): void {
    const docDir = getDocumentDirectory(storagePath, pageId);
    const imagesDir = getDocumentImagesDirectory(storagePath, pageId);
    const contentPath = getDocumentContentPath(storagePath, pageId);
    const metadataPath = getDocumentMetadataPath(storagePath, pageId);
    const normalizedMetadata = normalizeStoredMetadataSchema(pageId, metadata);

    fs.mkdirSync(docDir, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });

    fs.writeFileSync(contentPath, markdownContent, 'utf8');
    fs.writeFileSync(metadataPath, JSON.stringify(normalizedMetadata, null, 2), 'utf8');
}

function readDocumentMetadata(storagePath: string, docId: string): unknown {
    const metadataPath = getDocumentMetadataPath(storagePath, docId);
    if (!fs.existsSync(metadataPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(metadataPath, 'utf8')) || null;
    } catch {
        return null;
    }
}

function readDocumentContent(storagePath: string, docId: string): string | null {
    const markdownPath = getDocumentContentPath(storagePath, docId);
    if (fs.existsSync(markdownPath)) {
        return fs.readFileSync(markdownPath, 'utf8');
    }

    const legacyMarkdownPath = path.join(storagePath, `${docId}.md`);
    if (fs.existsSync(legacyMarkdownPath)) {
        return fs.readFileSync(legacyMarkdownPath, 'utf8');
    }

    const legacyTextPath = path.join(storagePath, `${docId}.txt`);
    if (fs.existsSync(legacyTextPath)) {
        return fs.readFileSync(legacyTextPath, 'utf8');
    }

    return null;
}

function deleteDocumentFiles(storagePath: string, docId: string): { deletedMd: boolean; deletedJson: boolean; deletedCount: number } {
    const docDir = getDocumentDirectory(storagePath, docId);
    const markdownPath = getDocumentContentPath(storagePath, docId);
    const metadataPath = getDocumentMetadataPath(storagePath, docId);

    const legacyMarkdownPath = path.join(storagePath, `${docId}.md`);
    const legacyMetadataPath = path.join(storagePath, `${docId}.json`);
    const legacyTextPath = path.join(storagePath, `${docId}.txt`);

    let deletedMd = false;
    let deletedJson = false;

    for (const [kind, filePath] of [
        ['md', markdownPath],
        ['json', metadataPath],
        ['md', legacyMarkdownPath],
        ['json', legacyMetadataPath],
        ['txt', legacyTextPath]
    ] as Array<[string, string]>) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                if (kind === 'md') {
                    deletedMd = true;
                }
                if (kind === 'json') {
                    deletedJson = true;
                }
            }
        } catch {
        }
    }

    try {
        if (fs.existsSync(docDir)) {
            fs.rmSync(docDir, { recursive: true, force: true });
        }
    } catch {
    }

    return {
        deletedMd,
        deletedJson,
        deletedCount: Number(deletedMd) + Number(deletedJson)
    };
}

export { ensureStoragePath,
    ensureIndexStoragePath,
    backfillStoredMetadataSchema,
    getDocumentDirectory,
    getDocumentImagesDirectory,
    readAllMetadata,
    readDocumentMetadata,
    writeDocumentFiles,
    readDocumentContent,
    deleteDocumentFiles
};

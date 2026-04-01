import { buildCorpus, scoreDocumentBm25 } from './tokenization2keywords/bm25Keywords';
import { getJiraExtractionRegexes } from '../../mcp/jiraApi';
import type { Metadata, Keywords, ReferencedQueries } from '../../sidebar/types';

/** Options for sync operations that process one or more documents. */
export interface SyncOptions {
  onDocumentProcessed?: (event: DocumentProcessedEvent) => void;
}

/** Payload emitted after each document is synced. */
export interface DocumentProcessedEvent {
  metadata: Metadata;
  index: number;
  total: number;
}

/** Raw data from the Confluence page API. */
interface ConfluencePage {
  id: string;
  title?: string;
  author?: string;
  last_updated?: string;
  parent_confluence_topic?: string;
  space?: string;
  version?: { number?: number };
  content?: string;
  body?: { storage?: { value?: string } };
  url?: string;
  _links?: { webui?: string; self?: string };
  [key: string]: unknown;
}

/** Raw data from the Jira issue API. */
interface JiraIssue {
  id?: string;
  key?: string;
  fields?: {
    summary?: string;
    description?: string;
    reporter?: { displayName?: string };
    project?: { key?: string };
    issuetype?: { name?: string };
    status?: { name?: string };
    priority?: { name?: string };
    assignee?: { displayName?: string };
    updated?: string;
  };
  summary?: string;
  description?: string;
  url?: string;
  self?: string;
  _links?: { webui?: string; self?: string };
  [key: string]: unknown;
}

/** VS Code API shape consumed by the sync module. */
interface VsCodeApi {
  workspace: {
    getConfiguration(section: string): { get<T>(key: string): T | undefined };
  };
}

/** Keywords helper signatures used by sync. */
interface CategorizedKeywords extends Keywords {}

/** Context injected into the sync module. */
interface SyncContext {
  fs: typeof import('fs');
  path: typeof import('path');
  vscode: VsCodeApi;
  storagePath: string;
  fetchConfluencePage(arg: string): Promise<ConfluencePage>;
  fetchConfluencePageMeta(arg: string): Promise<{ id: string; version?: { number?: number } } | null>;
  fetchAllConfluencePagesMetaOnly(): Promise<Array<{ id: string; version?: { number?: number } }>>;
  fetchConfluencePageChildren(id: string): Promise<{ results?: Array<{ id?: string; version?: unknown }> } | null>;
  fetchJiraIssue?(arg: string): Promise<JiraIssue>;
  htmlToMarkdown(html: string): string;
  jiraTextToMarkdown(text: string): string;
  generateSynonyms(tokens: string[]): Keywords['synonyms'] & { sourceMap?: Record<string, string[]> };
  readAllMetadata(storagePath: string): Metadata[];
  writeDocumentFiles(storagePath: string, pageId: string, content: string, metadata: Metadata): void;
  readDocumentContent(storagePath: string, docId: string): string | null;
  localizeMarkdownImageLinks(md: string, pageId: string, sourceUrl: string): Promise<string>;
  getBm25Config(): { k1: number; b: number; topN: number; docLogFactor: number; docNumLogFactor: number };
  cleanKeywords(input: unknown, limit?: number): string[];
  getStoredMetadataById(docId: string): Metadata | null;
  getPageHtml(page: ConfluencePage): string;
  isLikelyHtml(value: unknown): boolean;
  extractHtmlTagData(html: string): { title: string; keywords: string[] };
  resolveSourceUrl(source: ConfluencePage | JiraIssue): string;
  tokenizationMain(text: string): string[];
  buildCategorizedKeywords(title: string, summary: string, content: string, opts?: { kgMermaid?: string; synonymNGrams?: unknown }): CategorizedKeywords;
  normalizeCategorizedKeywords(kws: unknown): Keywords;
  flattenCategorizedKeywords(kws: Keywords): string[];
  finalizeBm25KeywordsForDocuments?(docIds: string[]): Promise<void>;
}

export default function(context: SyncContext) {
  const { fs, path, vscode, storagePath, fetchConfluencePage, fetchConfluencePageMeta,
    fetchAllConfluencePagesMetaOnly, fetchConfluencePageChildren,
    fetchJiraIssue, htmlToMarkdown, jiraTextToMarkdown, generateSynonyms, readAllMetadata, writeDocumentFiles,
    readDocumentContent, localizeMarkdownImageLinks, getBm25Config, cleanKeywords, getStoredMetadataById,
    getPageHtml, isLikelyHtml, extractHtmlTagData, resolveSourceUrl, tokenizationMain,
    buildCategorizedKeywords, normalizeCategorizedKeywords, flattenCategorizedKeywords } = context;
  
  


  // Extracts all Jira issue keys explicitly referenced in text, using the configured jira.regex settings.
  function extractJiraReferences(text: unknown): string[] {
    const found = new Set<string>();
    const textStr = String(text || '');
    for (const regex of getJiraExtractionRegexes(vscode)) {
      const gr = new RegExp(regex.source, regex.flags.includes('i') ? 'gi' : 'g');
      for (const match of textStr.matchAll(gr)) {
        found.add(match[0].toUpperCase());
      }
    }
    return [...found];
  }

async function refreshDocument(pageArg: string, options: SyncOptions = {}): Promise<Metadata> {
  const pageMeta = await fetchConfluencePageMeta(pageArg);
  const remoteVersion: number | undefined = pageMeta?.version?.number;
  const pageId: string | undefined = pageMeta?.id;
  const storedMeta: Metadata = pageId ? (getStoredMetadataById(pageId) ?? {} as Metadata) : {} as Metadata;
  const localVersion: number | undefined = typeof storedMeta.version === 'number' ? storedMeta.version : undefined;

  if (localVersion !== undefined && remoteVersion !== undefined && localVersion >= remoteVersion) {
    notifyDocumentProcessed(options, storedMeta, 1, 1);
    return storedMeta;
  }

  const page = await fetchConfluencePage(pageArg);
  const metadata = await processDocument(page, { clearSummaryAndKg: localVersion !== undefined });
  notifyDocumentProcessed(options, metadata, 1, 1);
  return metadata;
}

async function refreshConfluenceHierarchy(pageArg: string, options: SyncOptions = {}): Promise<void> {
  // Start with a lightweight version check for the root page.
  const rootMeta = await fetchConfluencePageMeta(pageArg);
  const rootId: string = rootMeta?.id ?? '';
  // Queue contains page IDs to traverse; the root meta is already fetched.
  const pageIdsToProcess: string[] = [rootId];
  // Cached lightweight metas so we don't re-fetch the root.
  const metaCache: Record<string, { id: string; version?: { number?: number } }> = rootId ? { [rootId]: rootMeta as { id: string; version?: { number?: number } } } : {};
  const processedIds = new Set<string>();
  let currentIndex = 0;
  const delay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

  while (pageIdsToProcess.length > 0) {
    const pageId = pageIdsToProcess.shift();
    if (!pageId || processedIds.has(pageId)) { continue; }
    processedIds.add(pageId);

    // Get (or fetch) lightweight version metadata.
    const pageMeta = metaCache[pageId] ?? await fetchConfluencePageMeta(pageId);
    const remoteVersion: number | undefined = pageMeta?.version?.number;
    const storedMeta: Metadata = getStoredMetadataById(pageId) ?? {} as Metadata;
    const localVersion: number | undefined = typeof storedMeta.version === 'number' ? storedMeta.version : undefined;

    currentIndex++;
    let metadata: Metadata;
    if (localVersion !== undefined && remoteVersion !== undefined && localVersion >= remoteVersion) {
      metadata = storedMeta;
    } else {
      const page = await fetchConfluencePage(pageId);
      metadata = await processDocument(page, { clearSummaryAndKg: localVersion !== undefined });
    }
    notifyDocumentProcessed(options, metadata, currentIndex, currentIndex + pageIdsToProcess.length);

    try {
      const childrenData = await fetchConfluencePageChildren(pageId);
      if (childrenData?.results) {
        for (const child of childrenData.results) {
          const childId = child?.id;
          if (childId && !processedIds.has(childId)) {
            pageIdsToProcess.push(childId);
            // Cache the version info returned by the children endpoint to avoid an extra request.
            if (child.version) { metaCache[childId] = child as { id: string; version?: { number?: number } }; }
          }
        }
      }
    } catch (e) {
      console.error(`Failed to fetch children for page ${pageId}`, e);
    }
    if (pageIdsToProcess.length > 0) { await delay(10000); }
  }
}

async function refreshAllDocuments(options: SyncOptions = {}): Promise<void> {
  // Lightweight fetch: metadata + version only, no body content.
  const pageMetas = await fetchAllConfluencePagesMetaOnly();
  const total = pageMetas.length;
  for (let index = 0; index < total; index += 1) {
    const pageMeta = pageMetas[index];
    const remoteVersion: number | undefined = pageMeta?.version?.number;
    const storedMeta: Metadata = pageMeta?.id ? (getStoredMetadataById(pageMeta.id) ?? {} as Metadata) : {} as Metadata;
    const localVersion: number | undefined = typeof storedMeta.version === 'number' ? storedMeta.version : undefined;

    if (localVersion !== undefined && remoteVersion !== undefined && localVersion >= remoteVersion) {
      notifyDocumentProcessed(options, storedMeta, index + 1, total);
      continue;
    }

    // Version changed (or first sync): download full content.
    const page = await fetchConfluencePage(pageMeta.id);
    const metadata = await processDocument(page, { clearSummaryAndKg: localVersion !== undefined });
    notifyDocumentProcessed(options, metadata, index + 1, total);
  }
}

async function refreshJiraIssue(issueArg: string, options: SyncOptions = {}): Promise<void> {
  if (typeof fetchJiraIssue !== 'function') {
    throw new Error('Jira integration is not configured.');
  }
  const issue = await fetchJiraIssue(issueArg);
  const metadata = await processJiraIssue(issue);
  notifyDocumentProcessed(options, metadata, 1, 1);
}

function notifyDocumentProcessed(options: SyncOptions, metadata: Metadata, index: number, total: number): void {
  if (!options || typeof options.onDocumentProcessed !== 'function') {
    return;
  }
  options.onDocumentProcessed({
    metadata,
    index,
    total
  });
}

async function processDocument(page: ConfluencePage, { clearSummaryAndKg = false }: { clearSummaryAndKg?: boolean } = {}): Promise<Metadata> {
  const existingMetadata: Metadata = getStoredMetadataById(page.id) ?? {} as Metadata;
  const rawContent = getPageHtml(page);
  const isHtmlContent = isLikelyHtml(rawContent);
  const htmlTagData = isHtmlContent ? extractHtmlTagData(rawContent) : {
    title: '',
    keywords: []
  };
  const sourceUrl = resolveSourceUrl(page);
  const markdownBaseContent = isHtmlContent ? htmlToMarkdown(rawContent) : String(rawContent || '').trim();
  const markdownContent = await localizeMarkdownImageLinks(markdownBaseContent, page.id, sourceUrl);

  const title = htmlTagData.title || page.title;
  // When version bumped: clear AI-generated fields so they are regenerated for new content.
  const existingSummary = clearSummaryAndKg ? '' : String(existingMetadata.summary || '').trim();
  const kgMermaid = clearSummaryAndKg ? '' : (typeof existingMetadata.knowledgeGraph === 'string' ? existingMetadata.knowledgeGraph : '');

  const baseKeywords = buildCategorizedKeywords(title, existingSummary, markdownContent, { kgMermaid });
  const categorizedKeywords = buildCategorizedKeywords(title, existingSummary, markdownContent, {
    kgMermaid,
    synonymNGrams: generateSynonyms(flattenCategorizedKeywords(baseKeywords))
  });

  const referencedJiraIds = extractJiraReferences(markdownContent);
  // Persist the remote version number so future syncs can skip unchanged pages.
  const version: number | undefined = typeof page?.version?.number === 'number' ? page.version.number : undefined;

  const baseMetadata = {
    id: page.id,
    title,
    version,
    author: page.author || 'Unknown',
    /* eslint-disable @typescript-eslint/naming-convention */
    last_updated: page.last_updated || new Date().toISOString().slice(0, 10),
    parent_confluence_topic: page.parent_confluence_topic || page.space || 'General',
    /* eslint-enable @typescript-eslint/naming-convention */
    url: sourceUrl,
    type: 'confluence',
    keywords: categorizedKeywords,
    summary: '',
    tags: Array.isArray(existingMetadata.tags) ? existingMetadata.tags : [],
    feedback: String(existingMetadata.feedback || '').trim(),
    referencedQueries: (existingMetadata.referencedQueries && typeof existingMetadata.referencedQueries === 'object' && !Array.isArray(existingMetadata.referencedQueries))
        ? (existingMetadata.referencedQueries as ReferencedQueries)
        : ({} as ReferencedQueries),
    referencedJiraIds,
    knowledgeGraph: kgMermaid,
    relatedPages: Array.isArray(existingMetadata.relatedPages) ? (existingMetadata.relatedPages as string[]) : []
  };
  const metadata: Metadata = {
    ...existingMetadata,
    ...baseMetadata,
    summary: existingSummary
  };
  writeDocumentFiles(storagePath, page.id, markdownContent, metadata);
  return metadata;
}

async function processJiraIssue(issue: JiraIssue): Promise<Metadata> {
  const existingMetadata: Metadata = getStoredMetadataById(String(issue?.id || '')) ?? {} as Metadata;
  const fields = issue?.fields || {};
  const reporter = fields?.reporter?.displayName || 'Unknown';
  const projectKey = fields?.project?.key || 'Jira';
  const rawSummary = String(fields?.summary || issue?.summary || '').trim();
  const rawDescription = String(fields?.description || issue?.description || '').trim();
  const summaryIsHtml = isLikelyHtml(rawSummary);
  const descriptionIsHtml = isLikelyHtml(rawDescription);
  const summaryTagData = summaryIsHtml ? extractHtmlTagData(rawSummary) : {
    title: '',
    keywords: []
  };
  const descriptionTagData = descriptionIsHtml ? extractHtmlTagData(rawDescription) : {
    title: '',
    keywords: []
  };
  const summary = summaryIsHtml ? htmlToMarkdown(rawSummary).replace(/\s+/g, ' ').trim() : rawSummary;
  const description = descriptionIsHtml ? htmlToMarkdown(rawDescription) : jiraTextToMarkdown(rawDescription);
  const issueKey = String(issue?.key || '').trim();
  const htmlTitle = summaryTagData.title || descriptionTagData.title;
  const title = htmlTitle || (issueKey && summary ? `${issueKey}: ${summary}` : issueKey || summary || `Issue ${issue?.id || ''}`.trim());
  const contentSections = [`# ${title}`, '', `Issue Key: ${issueKey || '-'}`, `Issue ID: ${issue?.id || '-'}`, `Project: ${projectKey}`, `Type: ${fields?.issuetype?.name || '-'}`, `Status: ${fields?.status?.name || '-'}`, `Priority: ${fields?.priority?.name || '-'}`, `Reporter: ${reporter}`, `Assignee: ${fields?.assignee?.displayName || '-'}`, `Updated: ${fields?.updated || '-'}`, '', '## Description', description || 'No description provided.'];
  const markdownContent = await localizeMarkdownImageLinks(contentSections.join('\n'), issue?.id, resolveSourceUrl(issue));

  const existingSummary = String(existingMetadata.summary || '').trim();
  const kgMermaid = typeof existingMetadata.knowledgeGraph === 'string' ? existingMetadata.knowledgeGraph : '';

  const baseKeywords = buildCategorizedKeywords(title, existingSummary, markdownContent, { kgMermaid });
  const categorizedKeywords = buildCategorizedKeywords(title, existingSummary, markdownContent, {
    kgMermaid,
    synonymNGrams: generateSynonyms(flattenCategorizedKeywords(baseKeywords))
  });

  const baseMetadata = {
    id: issue?.id,
    issueKey,
    title,
    author: reporter,
    /* eslint-disable @typescript-eslint/naming-convention */
    last_updated: String(fields?.updated || new Date().toISOString().slice(0, 10)).slice(0, 10),
    parent_confluence_topic: `Jira ${projectKey}`,
    /* eslint-enable @typescript-eslint/naming-convention */
    url: resolveSourceUrl(issue),
    type: 'jira',
    keywords: categorizedKeywords,
    summary: '',
    tags: Array.isArray(existingMetadata.tags) ? existingMetadata.tags : [],
    feedback: String(existingMetadata.feedback || '').trim(),
    referencedQueries: (existingMetadata.referencedQueries && typeof existingMetadata.referencedQueries === 'object' && !Array.isArray(existingMetadata.referencedQueries))
        ? (existingMetadata.referencedQueries as ReferencedQueries)
        : ({} as ReferencedQueries),
    knowledgeGraph: kgMermaid,
    relatedPages: Array.isArray(existingMetadata.relatedPages) ? (existingMetadata.relatedPages as string[]) : []
  };
  const metadata: Metadata = {
    ...existingMetadata,
    ...baseMetadata,
    summary: existingSummary
  };
  writeDocumentFiles(storagePath, issue?.id, markdownContent, metadata);
  return metadata;
}

async function finalizeBm25KeywordsForDocuments(docIds: string[] = []): Promise<void> {
  const metadataList = readAllMetadata(storagePath);
  if (!Array.isArray(metadataList) || metadataList.length === 0) {
    return;
  }

  const targetIdSet = new Set((Array.isArray(docIds) ? docIds : []).map(value => String(value || '').trim()).filter(value => value.length > 0));
  if (targetIdSet.size === 0) {
    return;
  }

  // 1. Build corpus IDF map from all documents
  const bm25Config = getBm25Config();
  const corpus = buildCorpus(
    metadataList.map(m => m.id),
    (id: string) => readDocumentContent(storagePath, id) || '',
    tokenizationMain
  );

  const totalDocumentCount = metadataList.length;

  // 2. Score and update metadata for each target document
  for (const docId of targetIdSet) {
    const metaIndex = metadataList.findIndex(m => m.id === docId);
    if (metaIndex < 0) { continue; }

    const bm25Keywords = scoreDocumentBm25(docId, corpus, bm25Config);
    const meta = metadataList[metaIndex];
    const docText = readDocumentContent(storagePath, meta.id) || '';
    const kgMermaid = typeof meta.knowledgeGraph === 'string' ? meta.knowledgeGraph : '';
    const existingSummary = String(meta.summary || '').trim();

    // 3. Rebuild categorized keywords with BM25 tokens filling the bm25 category,
    //    preserving LLM-annotated semantic keywords across BM25 refresh
    const oldNorm = normalizeCategorizedKeywords(meta.keywords);
    const existingSemantic = ['1gram', '2gram', '3gram', '4gram']
      .flatMap(g => {
        const slot = oldNorm.semantic[g];
        if (!slot) { return []; }
        return Array.isArray(slot) ? cleanKeywords(slot) : Object.keys(slot);
      });

    const bm25Base = buildCategorizedKeywords(
      meta.title,
      existingSummary,
      docText,
      { bm25Keywords, kgMermaid, existingSemantic, totalDocumentCount }
    );
    meta.keywords = buildCategorizedKeywords(
      meta.title,
      existingSummary,
      docText,
      { bm25Keywords, kgMermaid, existingSemantic, totalDocumentCount,
        synonymNGrams: generateSynonyms(flattenCategorizedKeywords(bm25Base)) }
    );
    writeDocumentFiles(storagePath, meta.id, docText, meta);
  }
}

  function syncDefaultDocs(extensionPath: string): void {
    const outDefaultDocs = path.join(extensionPath, 'out', 'default_docs');
    const srcDefaultDocs = path.join(extensionPath, 'src', 'default_docs');
    const defaultDocsSrcDir = fs.existsSync(outDefaultDocs) ? outDefaultDocs : srcDefaultDocs;
    if (!fs.existsSync(defaultDocsSrcDir)) {
      return;
    }

    const defaultDocFolders = fs.readdirSync(defaultDocsSrcDir).filter((f: string) => fs.statSync(path.join(defaultDocsSrcDir, f)).isDirectory());
    for (const folder of defaultDocFolders) {
      const destContentPath = path.join(storagePath, folder, 'content.md');
      const destMetadataPath = path.join(storagePath, folder, 'metadata.json');
      const srcFolder = path.join(defaultDocsSrcDir, folder);
      const mdPath = path.join(srcFolder, 'content.md');
      const jsonPath = path.join(srcFolder, 'metadata.json');

      if (!fs.existsSync(destContentPath) || !fs.existsSync(destMetadataPath)) {
        if (fs.existsSync(mdPath) && fs.existsSync(jsonPath)) {
          try {
            const mdContent = fs.readFileSync(mdPath, 'utf8');
            const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

            // Regenerate keywords from actual content (produces position-percentage format)
            const title = String(metadata.title || folder);
            const summary = String(metadata.summary || '').trim();
            const kgMermaid = typeof metadata.knowledgeGraph === 'string' ? metadata.knowledgeGraph : '';
            const baseKeywords = buildCategorizedKeywords(title, summary, mdContent, { kgMermaid });
            metadata.keywords = buildCategorizedKeywords(title, summary, mdContent, {
              kgMermaid,
              synonymNGrams: generateSynonyms(flattenCategorizedKeywords(baseKeywords))
            });

            // Normalize referencedQueries: string[] → Record<string, string[]>
            if (Array.isArray(metadata.referencedQueries)) {
              const rq: Record<string, string[]> = {};
              for (const q of metadata.referencedQueries) {
                if (typeof q === 'string' && q.trim()) { rq[q.trim()] = []; }
              }
              metadata.referencedQueries = rq;
            }

            writeDocumentFiles(storagePath, folder, mdContent, metadata);
          } catch (e) {
            console.error(`Failed to sync default doc ${folder}:`, e);
          }
        }
      }

      // Copy scripts/ subdir to storage so addToSkills can include it
      const srcScriptsDir = path.join(srcFolder, 'scripts');
      if (fs.existsSync(srcScriptsDir)) {
        const destScriptsDir = path.join(storagePath, folder, 'scripts');
        copyDirRecursive(srcScriptsDir, destScriptsDir);
      }
    }
  }

  function copyDirRecursive(src: string, dest: string) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  return {
    syncDefaultDocs,
    refreshDocument,
    refreshConfluenceHierarchy,
    refreshAllDocuments,
    refreshJiraIssue,
    notifyDocumentProcessed,
    processDocument,
    processJiraIssue,
    finalizeBm25KeywordsForDocuments
  };
};

import fs from 'fs';
import path from 'path';
import type { Metadata, Keywords, ReferencedQueries } from '../../sidebar/types';

/** Partial update patch for updateStoredMetadataById. */
export interface MetadataPatch {
  type?: string;
  summary?: string;
  keywords?: unknown;
  tags?: unknown;
  feedback?: string;
  referencedQueries?: ReferencedQueries;
  relatedPages?: string[];
}

/** Minimal VS Code API shape consumed by utils. */
interface WorkspaceConfig {
  get<T>(key: string): T | undefined;
}
interface VsCodeWorkspace {
  getConfiguration(section: string): WorkspaceConfig;
  workspaceFolders?: Array<{ uri: { fsPath: string } }>;
}
interface VsCodeApi {
  workspace: VsCodeWorkspace;
}

/** External-document shape for HTML extraction helpers. */
interface ExternalDocSource {
  url?: string;
  key?: string;
  self?: string;
  fields?: { project?: unknown };
  _links?: { webui?: string; self?: string };
  content?: string;
  body?: { storage?: { value?: string } };
  [key: string]: unknown;
}

/** Context injected into the utils module by the document service. */
interface UtilsContext {
  vscode: VsCodeApi;
  storagePath: string;
  generateSynonyms(tokens: string[]): Keywords['synonyms'] & { sourceMap?: Record<string, string[]> };
  readAllMetadata(storagePath: string): Metadata[];
  writeDocumentFiles(storagePath: string, pageId: string, content: string, metadata: Metadata): void;
  readDocumentContent(storagePath: string, docId: string): string | null;
  getKeywordConfig(): { DEFAULT_KEYWORD_LIMIT: number };
  cleanKeywords(input: unknown, limit?: number): string[];
  normalizeMetadataKeywordFields(metadata: Metadata): Metadata;
  mergeSemanticKeywords(existing: Keywords, manual: string[]): Keywords;
  normalizeCategorizedKeywords(kws: unknown): Keywords;
  flattenCategorizedKeywords(kws: Keywords): string[];
  cheerio: { load(html: string): CheerioApi };
}

/** Minimal cheerio API shape used in extractHtmlTagData. */
type CheerioSelector = (selector: string) => {
  first(): { text(): string };
  each(fn: (_i: number, el: unknown) => void): void;
  text(): string;
  attr(name: string): string | undefined;
};
type CheerioApi = CheerioSelector & {
  load?: never;
};

export default function(context: UtilsContext) {
  const { vscode, storagePath,
    generateSynonyms,
    readAllMetadata, writeDocumentFiles, readDocumentContent,
    getKeywordConfig, cleanKeywords, normalizeMetadataKeywordFields,
    mergeSemanticKeywords, normalizeCategorizedKeywords, flattenCategorizedKeywords, cheerio} = context;

function writeDocumentPromptFile(metadata: Metadata, content: string): string {
  const workspaceRoot = getWorkspaceRootPath();
  const promptsDir = path.join(workspaceRoot, '.github', 'prompts');

  if (!fs.existsSync(promptsDir)) {
    fs.mkdirSync(promptsDir, { recursive: true });
  }

  const safeTitle = sanitizeFileSegment(metadata.title || 'document');
  const safeId = sanitizeFileSegment(metadata.id || 'unknown');
  const fileName = `${safeTitle}-${safeId}.prompt.md`;
  const filePath = path.join(promptsDir, fileName);
  const promptText = [`# ${metadata.title || 'Untitled'}`, '', `Source ID: ${metadata.id || ''}`, `Author: ${metadata.author || 'Unknown'}`, `Last Updated: ${(metadata as Record<string, unknown>).last_updated || ''}`, `Parent Topic: ${(metadata as Record<string, unknown>).parent_confluence_topic || ''}`, '', '## Instructions', 'Use the following document content as authoritative context when answering questions about this topic.', '', '## Content', content].join('\n');
  fs.writeFileSync(filePath, promptText, 'utf8');
  return filePath;
}

function writeDocumentSkillFile(metadata: Metadata, content: string): string {
  const workspaceRoot = getWorkspaceRootPath();
  const skillsDir = path.join(workspaceRoot, '.github', 'skills');

  const safeTitle = sanitizeFileSegment(metadata.title || 'document');
  const skillDirPath = path.join(skillsDir, safeTitle);

  if (!fs.existsSync(skillDirPath)) {
    fs.mkdirSync(skillDirPath, { recursive: true });
  }

  const filePath = path.join(skillDirPath, 'SKILL.md');
  const skillDescription = String(metadata.summary || '').replace(/[\r\n]+/g, ' ').trim();
  const skillText = ['---', `name: ${safeTitle}`, `description: ${skillDescription}`, '---', '', `# ${metadata.title || 'Untitled'}`, '', `Source ID: ${metadata.id || ''}`, `Author: ${metadata.author || 'Unknown'}`, `Last Updated: ${(metadata as Record<string, unknown>).last_updated || ''}`, `Parent Topic: ${(metadata as Record<string, unknown>).parent_confluence_topic || ''}`, '', '## Skill Instructions', 'Use the following document content as a reference skill or knowledge base for completing tasks.', '', '## Content', content].join('\n');
  fs.writeFileSync(filePath, skillText, 'utf8');

  const docDir = path.join(storagePath, String(metadata.id || ''));
  if (fs.existsSync(docDir)) {
    const SKIP_DIRS = new Set(['images']);
    for (const entry of fs.readdirSync(docDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        copyDirRecursive(path.join(docDir, entry.name), path.join(skillDirPath, entry.name));
      }
    }
  }

  return filePath;
}

function copyDirRecursive(src: string, dest: string): void {
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

function getPageHtml(page: ExternalDocSource): string {
  if (typeof page?.content === 'string') {
    return page.content;
  }
  if (typeof page?.body?.storage?.value === 'string') {
    return page.body.storage.value as string;
  }
  return '';
}

function isLikelyHtml(value: unknown): boolean {
  const text = String(value || '').trim();
  return /<[a-z][\s\S]*>/i.test(text);
}

function extractHtmlTagData(html: string): { title: string; keywords: string[] } {
  const $ = cheerio.load(String(html || ''));
  const extractedTitle = ($('title').first().text() || $('h1').first().text() || '').trim();
  const keywordCandidates: string[] = [];
  $('meta[name="keywords"], meta[name="news_keywords"], meta[property="article:tag"]').each((_: number, element: unknown) => {
    const content = ($ as unknown as (selector: unknown) => { attr(name: string): string | undefined })(element).attr('content');
    if (content) {
      keywordCandidates.push(...String(content).split(','));
    }
  });
  $('h1, h2, h3').each((_: number, element: unknown) => {
    const heading = ($ as unknown as (selector: unknown) => { text(): string })(element).text().trim();
    if (heading) {
      keywordCandidates.push(heading);
    }
  });
  return {
    title: extractedTitle,
    keywords: cleanKeywords(keywordCandidates)
  };
}

function resolveSourceUrl(source: ExternalDocSource): string {
  const isJira = source?.key || (source?.fields && source?.fields?.project);
  let candidate = source?.url || source?._links?.webui || source?._links?.self || source?.self || '';
  candidate = String(candidate || '').trim();

  if (candidate && !candidate.startsWith('http://') && !candidate.startsWith('https://')) {
    const configuration = vscode.workspace.getConfiguration('repoAsk');
    const profile = configuration.get<{ url?: string }>(isJira ? 'jira' : 'confluence');
    let base = String((profile?.url) || '').replace(/\/$/, '');
    
    if (!candidate.startsWith('/')) candidate = '/' + candidate;
    
    if (!isJira && !base.toLowerCase().includes('/confluence') && !candidate.toLowerCase().startsWith('/confluence/')) {
      candidate = '/confluence' + candidate;
    }
    
    candidate = base + candidate;
  }
  
  return candidate;
}

function getStoredMetadataById(docId: string): Metadata | null {
  const safeId = String(docId || '').trim();
  if (!safeId) {
    return null;
  }
  const allMetadata = readAllMetadata(storagePath);
  const found = allMetadata.find((item) => String(item.id) === safeId) || null;
  return found ? normalizeMetadataKeywordFields(found) : null;
}

function updateStoredMetadataById(docId: string, patch: MetadataPatch = {}): Metadata {
  const metadata = getStoredMetadataById(docId);
  if (!metadata) {
    throw new Error(`Document ${docId} not found in local store.`);
  }
  const content = readDocumentContent(storagePath, String(metadata.id));
  if (!content) {
    throw new Error(`No local content found for document ${docId}.`);
  }
  // Preserve all existing keyword categories; only update semantic slot if explicitly provided in patch
  const existingKws = normalizeCategorizedKeywords(metadata.keywords);
  let updatedKws = existingKws;
  if (patch.keywords !== undefined && patch.keywords !== null) {
    const manualKeywords = cleanKeywords(patch.keywords, getKeywordConfig().DEFAULT_KEYWORD_LIMIT);
    updatedKws = mergeSemanticKeywords(existingKws, manualKeywords);
    updatedKws.synonyms = generateSynonyms(flattenCategorizedKeywords(updatedKws));
  }

  const nextSummary = String(patch.summary || '').trim();
  const nextType = patch.type !== undefined ? String(patch.type || '').trim() : metadata.type;
  const nextTags = cleanKeywords(patch.tags, getKeywordConfig().DEFAULT_KEYWORD_LIMIT);
  const nextFeedback = String(patch.feedback || '').trim();
  const nextReferencedQueries = patch.referencedQueries !== undefined ? patch.referencedQueries : metadata.referencedQueries;
  const nextRelatedPages = patch.relatedPages !== undefined ? patch.relatedPages : metadata.relatedPages;
  const updatedMetadata = normalizeMetadataKeywordFields({
    ...metadata,
    type: nextType,
    keywords: updatedKws,
    tags: nextTags,
    feedback: nextFeedback,
    summary: nextSummary,
    referencedQueries: nextReferencedQueries,
    relatedPages: nextRelatedPages
  });
  writeDocumentFiles(storagePath, String(metadata.id), content, updatedMetadata);
  return updatedMetadata;
}

function removeDocumentFromIndicesById(_docId: string): void {
}

function sanitizeFileSegment(value: unknown): string {
  return String(value || 'item').toLowerCase().replace(/[^a-z0-9-_ ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 64) || 'item';
}

function getWorkspaceRootPath(): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('Open a workspace folder to add prompt files.');
  }
  return workspaceFolder.uri.fsPath;
}

  return {
    writeDocumentPromptFile,
    writeDocumentSkillFile,
    getStoredMetadataById,
    updateStoredMetadataById,
    removeDocumentFromIndicesById,
    sanitizeFileSegment,
    getWorkspaceRootPath,
    getPageHtml,
    isLikelyHtml,
    extractHtmlTagData,
    resolveSourceUrl
  };
};

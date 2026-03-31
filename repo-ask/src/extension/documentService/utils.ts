import fs from 'fs';
import path from 'path';

export default function(context: any) {
  const { vscode, storagePath,
    generateSynonyms,
    readAllMetadata, writeDocumentFiles, readDocumentContent,
    getKeywordConfig, cleanKeywords, normalizeMetadataKeywordFields,
    mergeSemanticKeywords, normalizeCategorizedKeywords, flattenCategorizedKeywords, cheerio} = context;

function writeDocumentPromptFile(metadata: any, content: any) {
  const workspaceRoot = getWorkspaceRootPath();
  const promptsDir = path.join(workspaceRoot, '.github', 'prompts');

  if (!fs.existsSync(promptsDir)) {
    fs.mkdirSync(promptsDir, { recursive: true });
  }

  const safeTitle = sanitizeFileSegment(metadata.title || 'document');
  const safeId = sanitizeFileSegment(metadata.id || 'unknown');
  const fileName = `${safeTitle}-${safeId}.prompt.md`;
  const filePath = path.join(promptsDir, fileName);
  const promptText = [`# ${metadata.title || 'Untitled'}`, '', `Source ID: ${metadata.id || ''}`, `Author: ${metadata.author || 'Unknown'}`, `Last Updated: ${metadata.last_updated || ''}`, `Parent Topic: ${metadata.parent_confluence_topic || ''}`, '', '## Instructions', 'Use the following document content as authoritative context when answering questions about this topic.', '', '## Content', content].join('\n');
  fs.writeFileSync(filePath, promptText, 'utf8');
  return filePath;
}

function writeDocumentSkillFile(metadata: any, content: any) {
  const workspaceRoot = getWorkspaceRootPath();
  const skillsDir = path.join(workspaceRoot, '.github', 'skills');

  const safeTitle = sanitizeFileSegment(metadata.title || 'document');
  const skillDirPath = path.join(skillsDir, safeTitle);

  if (!fs.existsSync(skillDirPath)) {
    fs.mkdirSync(skillDirPath, { recursive: true });
  }

  const filePath = path.join(skillDirPath, 'SKILL.md');
  const skillText = ['---', `name: ${safeTitle}`, `description: ${metadata.summary || ''}`, '---', '', `# ${metadata.title || 'Untitled'}`, '', `Source ID: ${metadata.id || ''}`, `Author: ${metadata.author || 'Unknown'}`, `Last Updated: ${metadata.last_updated || ''}`, `Parent Topic: ${metadata.parent_confluence_topic || ''}`, '', '## Skill Instructions', 'Use the following document content as a reference skill or knowledge base for completing tasks.', '', '## Content', content].join('\n');
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



function getPageHtml(page: any) {
  if (typeof page?.content === 'string') {
    return page.content;
  }
  if (typeof page?.body?.storage?.value === 'string') {
    return page.body.storage.value;
  }
  return '';
}

function isLikelyHtml(value: any) {
  const text = String(value || '').trim();
  return /<[a-z][\s\S]*>/i.test(text);
}

function extractHtmlTagData(html: any) {
  const $ = cheerio.load(String(html || ''));
  const extractedTitle = ($('title').first().text() || $('h1').first().text() || '').trim();
  const keywordCandidates: string[] = [];
  $('meta[name="keywords"], meta[name="news_keywords"], meta[property="article:tag"]').each((_: any, element: any) => {
    const content = $(element).attr('content');
    if (content) {
      keywordCandidates.push(...String(content).split(','));
    }
  });
  $('h1, h2, h3').each((_: any, element: any) => {
    const heading = $(element).text().trim();
    if (heading) {
      keywordCandidates.push(heading);
    }
  });
  return {
    title: extractedTitle,
    keywords: cleanKeywords(keywordCandidates)
  };
}

function resolveSourceUrl(source: any) {
  const isJira = source?.key || (source?.fields && source?.fields?.project);
  let candidate = source?.url || source?._links?.webui || source?._links?.self || source?.self || '';
  candidate = String(candidate || '').trim();

  if (candidate && !candidate.startsWith('http://') && !candidate.startsWith('https://')) {
    const configuration = vscode.workspace.getConfiguration('repoAsk');
    const profile = configuration.get(isJira ? 'jira' : 'confluence');
    let base = String((profile?.url) || '').replace(/\/$/, '');
    
    if (!candidate.startsWith('/')) candidate = '/' + candidate;
    
    if (!isJira && !base.toLowerCase().includes('/confluence') && !candidate.toLowerCase().startsWith('/confluence/')) {
      candidate = '/confluence' + candidate;
    }
    
    candidate = base + candidate;
  }
  
  return candidate;
}

function getStoredMetadataById(docId: any) {
  const safeId = String(docId || '').trim();
  if (!safeId) {
    return null;
  }
  const allMetadata = readAllMetadata(storagePath);
  const found = allMetadata.find((item: any) => String(item.id) === safeId) || null;
  return found ? normalizeMetadataKeywordFields(found) : null;
}

function updateStoredMetadataById(docId: any, patch: any = {}) {
  const metadata = getStoredMetadataById(docId);
  if (!metadata) {
    throw new Error(`Document ${docId} not found in local store.`);
  }
  const content = readDocumentContent(storagePath, metadata.id);
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
  const updatedMetadata = normalizeMetadataKeywordFields({
    ...metadata,
    type: nextType,
    keywords: updatedKws,
    tags: nextTags,
    feedback: nextFeedback,
    summary: nextSummary
  });
  writeDocumentFiles(storagePath, metadata.id, content, updatedMetadata);
  return updatedMetadata;
}

function removeDocumentFromIndicesById(_docId: any) {
}

function sanitizeFileSegment(value: any) {
  return String(value || 'item').toLowerCase().replace(/[^a-z0-9-_ ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 64) || 'item';
}

function getWorkspaceRootPath() {
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

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const axios = require('axios');
const { extractJsonObject } = require('./llm');
const { createBm25Index } = require('../bm25');

function createDocumentService(deps) {
    const {
        vscode,
        storagePath,
        bm25StoragePath,
        fetchConfluencePage,
        fetchAllConfluencePages,
        fetchJiraIssue,
        truncate,
        tokenize,
        htmlToMarkdown,
        generateKeywords,
        generateExtendedKeywords,
        generateSummary,
        readAllMetadata,
        writeDocumentFiles,
        readDocumentContent,
        rankDocumentsByIdf
    } = deps;
    const bm25Index = createBm25Index({
        storePath: bm25StoragePath,
        tokenize
    });
    bm25Index.ensureStorePath();

    function getKeywordConfig() {
        const initKeywordNum = vscode.workspace.getConfiguration('repoAsk').get('initKeywordNum') || 40;
        return {
            DEFAULT_KEYWORD_LIMIT: initKeywordNum,
            TOKENIZATION_KEYWORD_LIMIT: Math.floor(initKeywordNum / 2),
            BM25_KEYWORD_LIMIT: initKeywordNum - Math.floor(initKeywordNum / 2)
        };
    }

    function buildKeywordOnlyIndexText(metadata) {
        if (!metadata || typeof metadata !== 'object') {
            return '';
        }
        const { DEFAULT_KEYWORD_LIMIT } = getKeywordConfig();

        const keywords = cleanKeywords(metadata.keywords, getKeywordConfig().DEFAULT_KEYWORD_LIMIT * 4);
        return keywords.join(' ');
    }

    function rebuildBm25IndexFromMetadataKeywords(metadataList = []) {
        const documents = (Array.isArray(metadataList) ? metadataList : [])
            .map((item) => ({
                id: item?.id,
                text: buildKeywordOnlyIndexText(item)
            }))
            .filter((item) => String(item.id || '').trim().length > 0);

        bm25Index.rebuildDocuments(documents);
    }

    function rankLocalDocuments(query, limit = 20) {
        const metadataList = readAllMetadata(storagePath).map(normalizeMetadataKeywordFields);
        if (metadataList.length === 0) {
            return [];
        }

        // Rank/search should use the latest metadata keywords as the BM25 index corpus.
        rebuildBm25IndexFromMetadataKeywords(metadataList);

        const metadataById = Object.fromEntries(metadataList.map(item => [String(item.id), item]));

        let rankedByBm25 = bm25Index.rankDocuments(query, metadataById, { limit });
        if (rankedByBm25.length > 0) {
            return rankedByBm25;
        }

        const fallbackCorpus = metadataList.map(metadata => ({
            ...metadata,
            content: readDocumentContent(storagePath, metadata.id) || ''
        }));
        return rankDocumentsByIdf(query, fallbackCorpus, tokenize, { limit, minScore: 0.01 });
    }

    function checkLocalDocumentsAgentic(query, options = {}) {
        const normalizedQuery = String(query || '').trim();
        const rawLimit = Number(options?.limit);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(Math.floor(rawLimit), 50)
            : 5;
        const rawMetadataCandidateLimit = Number(options?.metadataCandidateLimit);
        const metadataCandidateLimit = Number.isFinite(rawMetadataCandidateLimit) && rawMetadataCandidateLimit > 0
            ? Math.min(Math.floor(rawMetadataCandidateLimit), 1000)
            : Math.max(40, limit * 4);

        if (!normalizedQuery) {
            return {
                query: normalizedQuery,
                metadataScanned: 0,
                metadataCandidates: 0,
                contentLoaded: 0,
                usedMetadataFallback: false,
                references: []
            };
        }

        const metadataList = readAllMetadata(storagePath).map(normalizeMetadataKeywordFields);
        if (metadataList.length === 0) {
            return {
                query: normalizedQuery,
                metadataScanned: 0,
                metadataCandidates: 0,
                contentLoaded: 0,
                usedMetadataFallback: false,
                references: []
            };
        }

        const metadataCorpus = metadataList.map((doc) => ({ ...doc, content: '' }));
        const rankedMetadata = rankDocumentsByIdf(
            normalizedQuery,
            metadataCorpus,
            tokenize,
            { limit: metadataList.length, minScore: 0 }
        );

        const positiveMetadata = rankedMetadata.filter((doc) => Number(doc.score) > 0);
        const metadataCandidates = (positiveMetadata.length > 0 ? positiveMetadata : metadataList)
            .slice(0, Math.min(metadataCandidateLimit, metadataList.length));

        const contentById = new Map();
        const contentCorpus = metadataCandidates.map((doc) => {
            const content = readDocumentContent(storagePath, doc.id) || '';
            contentById.set(String(doc.id || ''), content);
            return {
                ...doc,
                content
            };
        });

        const rankedByContent = rankDocumentsByIdf(
            normalizedQuery,
            contentCorpus,
            tokenize,
            { limit, minScore: 0 }
        );

        const finalResults = rankedByContent.length > 0
            ? rankedByContent
            : metadataCandidates.slice(0, limit).map((doc) => ({ ...doc, score: Number(doc.score || 0) }));

        const references = finalResults.map((doc) => {
            const docId = String(doc.id || '');
            return {
                id: doc.id,
                title: doc.title || 'Untitled',
                author: doc.author || 'Unknown',
                last_updated: doc.last_updated || '',
                parent_confluence_topic: doc.parent_confluence_topic || '',
                summary: truncate(doc.summary || 'No summary available', 220),
                score: Number.isFinite(Number(doc.score)) ? Number(doc.score) : 0,
                reference: truncate(contentById.get(docId) || '', 500)
            };
        });

        const contentLoaded = contentCorpus.filter((doc) => String(doc.content || '').trim().length > 0).length;
        return {
            query: normalizedQuery,
            metadataScanned: metadataList.length,
            metadataCandidates: metadataCandidates.length,
            contentLoaded,
            usedMetadataFallback: positiveMetadata.length === 0,
            references
        };
    }

    async function refreshDocument(pageArg, options = {}) {
        const page = await fetchConfluencePage(pageArg);
        const metadata = await processDocument(page);
        await finalizeBm25KeywordsForDocuments([metadata.id]);
        notifyDocumentProcessed(options, metadata, 1, 1);
    }

    async function refreshAllDocuments(options = {}) {
        const pages = await fetchAllConfluencePages();
        const total = pages.length;
        const refreshedIds = [];

        for (let index = 0; index < total; index += 1) {
            const page = pages[index];
            const metadata = await processDocument(page);
            refreshedIds.push(metadata.id);
            notifyDocumentProcessed(options, metadata, index + 1, total);
        }

        await finalizeBm25KeywordsForDocuments(refreshedIds);
    }

    async function refreshJiraIssue(issueArg, options = {}) {
        if (typeof fetchJiraIssue !== 'function') {
            throw new Error('Jira integration is not configured.');
        }

        const issue = await fetchJiraIssue(issueArg);
        const metadata = await processJiraIssue(issue);
        await finalizeBm25KeywordsForDocuments([metadata.id]);
        notifyDocumentProcessed(options, metadata, 1, 1);
    }

    function notifyDocumentProcessed(options, metadata, index, total) {
        if (!options || typeof options.onDocumentProcessed !== 'function') {
            return;
        }

        options.onDocumentProcessed({
            metadata,
            index,
            total
        });
    }

    async function annotateDocumentByArg(pageArg) {
        const allMetadata = readAllMetadata(storagePath);
        let metadata = allMetadata.find(item => String(item.id) === pageArg || String(item.title) === pageArg);

        if (!metadata) {
            const page = await fetchConfluencePage(pageArg);
            metadata = allMetadata.find(item => String(item.id) === String(page?.id));
        }

        if (!metadata) {
            return {
                message: `Document ${pageArg} is not in local store. Run refresh first.`
            };
        }

        const updated = await annotateStoredDocument(metadata);
        if (!updated) {
            return {
                message: `No local plain text content for ${metadata.title}. Run refresh first.`
            };
        }

        return {
            message: `Annotated document: ${metadata.title}`
        };
    }

    async function annotateAllDocuments() {
        const allMetadata = readAllMetadata(storagePath);
        let updatedCount = 0;

        for (const metadata of allMetadata) {
            const updated = await annotateStoredDocument(metadata);
            if (updated) {
                updatedCount += 1;
            }
        }

        return {
            message: updatedCount > 0
                ? `Annotated ${updatedCount} document(s)`
                : 'No local documents available to annotate. Run refresh first.'
        };
    }

    function writeDocumentPromptFile(metadata, content) {
        const workspaceRoot = getWorkspaceRootPath();
        const promptsDir = path.join(workspaceRoot, '.github', 'prompts');
        fs.mkdirSync(promptsDir, { recursive: true });

        const safeTitle = sanitizeFileSegment(metadata.title || 'document');
        const safeId = sanitizeFileSegment(metadata.id || 'unknown');
        const fileName = `${safeTitle}-${safeId}.prompt.md`;
        const filePath = path.join(promptsDir, fileName);

        const promptText = [
            `# ${metadata.title || 'Untitled'}`,
            '',
            `Source ID: ${metadata.id || ''}`,
            `Author: ${metadata.author || 'Unknown'}`,
            `Last Updated: ${metadata.last_updated || ''}`,
            `Parent Topic: ${metadata.parent_confluence_topic || ''}`,
            '',
            '## Instructions',
            'Use the following document content as authoritative context when answering questions about this topic.',
            '',
            '## Content',
            content
        ].join('\n');

        fs.writeFileSync(filePath, promptText, 'utf8');
        return filePath;
    }

    function formatMetadataEntries(metadata) {
        if (!metadata || typeof metadata !== 'object') {
            return [{ key: 'title', value: 'Unknown' }];
        }

        return Object.entries(metadata).map(([key, value]) => {
            if (Array.isArray(value)) {
                return { key, value: value.join(', ') };
            }
            if (value && typeof value === 'object') {
                return { key, value: JSON.stringify(value) };
            }
            return { key, value: String(value ?? '') };
        });
    }

    async function processDocument(page) {
        const rawContent = getPageHtml(page);
        const isHtmlContent = isLikelyHtml(rawContent);
        const htmlTagData = isHtmlContent ? extractHtmlTagData(rawContent) : { title: '', keywords: [] };
        const sourceUrl = resolveSourceUrl(page);
        const markdownBaseContent = isHtmlContent ? htmlToMarkdown(rawContent) : String(rawContent || '').trim();
        const markdownContent = await localizeMarkdownImageLinks(markdownBaseContent, page.id, sourceUrl);
        const baseMetadata = {
            id: page.id,
            title: htmlTagData.title || page.title,
            author: page.author || 'Unknown',
            last_updated: page.last_updated || new Date().toISOString().slice(0, 10),
            parent_confluence_topic: page.parent_confluence_topic || page.space || 'General',
            url: sourceUrl,
            keywords: [],
            extended_keywords: [],
            summary: ''
        };

        const tokenizationKeywords = cleanKeywords(generateKeywords(markdownContent), getKeywordConfig().TOKENIZATION_KEYWORD_LIMIT);
        bm25Index.upsertDocument(page.id, markdownContent);
        const bm25Keywords = cleanKeywords(
            bm25Index.extractKeywordsForDocument(page.id, { limit: getKeywordConfig().BM25_KEYWORD_LIMIT }),
            getKeywordConfig().BM25_KEYWORD_LIMIT
        );
        const mergedKeywords = mergeKeywordsPreservingSignals({
            structuralKeywords: tokenizationKeywords,
            modelKeywords: bm25Keywords,
            limit: getKeywordConfig().DEFAULT_KEYWORD_LIMIT
        });
        const metadata = {
            ...baseMetadata,
            keywords: mergedKeywords,
            extended_keywords: cleanKeywords(generateExtendedKeywords(mergedKeywords), 80),
            summary: ''
        };

        writeDocumentFiles(storagePath, page.id, markdownContent, metadata);
        return metadata;
    }

    async function processJiraIssue(issue) {
        const fields = issue?.fields || {};
        const reporter = fields?.reporter?.displayName || 'Unknown';
        const projectKey = fields?.project?.key || 'Jira';
        const rawSummary = String(fields?.summary || issue?.summary || '').trim();
        const rawDescription = String(fields?.description || issue?.description || '').trim();
        const summaryIsHtml = isLikelyHtml(rawSummary);
        const descriptionIsHtml = isLikelyHtml(rawDescription);
        const summaryTagData = summaryIsHtml ? extractHtmlTagData(rawSummary) : { title: '', keywords: [] };
        const descriptionTagData = descriptionIsHtml ? extractHtmlTagData(rawDescription) : { title: '', keywords: [] };
        const summary = summaryIsHtml
            ? htmlToMarkdown(rawSummary).replace(/\s+/g, ' ').trim()
            : rawSummary;
        const description = descriptionIsHtml
            ? htmlToMarkdown(rawDescription)
            : rawDescription;
        const issueKey = String(issue?.key || '').trim();
        const htmlTitle = summaryTagData.title || descriptionTagData.title;
        const title = htmlTitle
            || (issueKey && summary ? `${issueKey}: ${summary}` : (issueKey || summary || `Issue ${issue?.id || ''}`.trim()));
        const contentSections = [
            `# ${title}`,
            '',
            `Issue Key: ${issueKey || '-'}`,
            `Issue ID: ${issue?.id || '-'}`,
            `Project: ${projectKey}`,
            `Type: ${fields?.issuetype?.name || '-'}`,
            `Status: ${fields?.status?.name || '-'}`,
            `Priority: ${fields?.priority?.name || '-'}`,
            `Reporter: ${reporter}`,
            `Assignee: ${fields?.assignee?.displayName || '-'}`,
            `Updated: ${fields?.updated || '-'}`,
            '',
            '## Description',
            description || 'No description provided.'
        ];

        const markdownContent = await localizeMarkdownImageLinks(
            contentSections.join('\n'),
            issue?.id,
            resolveSourceUrl(issue)
        );
        const baseMetadata = {
            id: issue?.id,
            title,
            author: reporter,
            last_updated: String(fields?.updated || new Date().toISOString().slice(0, 10)).slice(0, 10),
            parent_confluence_topic: `Jira ${projectKey}`,
            url: resolveSourceUrl(issue),
            keywords: [],
            extended_keywords: [],
            summary: ''
        };

        const tokenizationKeywords = cleanKeywords(generateKeywords(markdownContent), getKeywordConfig().TOKENIZATION_KEYWORD_LIMIT);
        bm25Index.upsertDocument(issue?.id, markdownContent);
        const bm25Keywords = cleanKeywords(
            bm25Index.extractKeywordsForDocument(issue?.id, { limit: getKeywordConfig().BM25_KEYWORD_LIMIT }),
            getKeywordConfig().BM25_KEYWORD_LIMIT
        );
        const mergedKeywords = mergeKeywordsPreservingSignals({
            structuralKeywords: tokenizationKeywords,
            modelKeywords: bm25Keywords,
            limit: getKeywordConfig().DEFAULT_KEYWORD_LIMIT
        });
        const metadata = {
            ...baseMetadata,
            keywords: mergedKeywords,
            extended_keywords: cleanKeywords(generateExtendedKeywords(mergedKeywords), 80),
            summary: ''
        };

        writeDocumentFiles(storagePath, issue?.id, markdownContent, metadata);
        return metadata;
    }

    function getPageHtml(page) {
        if (typeof page?.content === 'string') {
            return page.content;
        }
        if (typeof page?.body?.storage?.value === 'string') {
            return page.body.storage.value;
        }
        return '';
    }

    function isLikelyHtml(value) {
        const text = String(value || '').trim();
        return /<[a-z][\s\S]*>/i.test(text);
    }

    function extractHtmlTagData(html) {
        const $ = cheerio.load(String(html || ''));
        const extractedTitle = ($('title').first().text() || $('h1').first().text() || '').trim();
        const keywordCandidates = [];

        $('meta[name="keywords"], meta[name="news_keywords"], meta[property="article:tag"]').each((_, element) => {
            const content = $(element).attr('content');
            if (content) {
                keywordCandidates.push(...String(content).split(','));
            }
        });

        $('h1, h2, h3').each((_, element) => {
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

    function resolveSourceUrl(source) {
        const candidate = source?.url
            || source?._links?.webui
            || source?._links?.self
            || source?.self
            || '';
        return String(candidate || '').trim();
    }

    async function localizeMarkdownImageLinks(markdownContent, docId, sourceUrl) {
        const markdown = String(markdownContent || '');
        const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const matches = [...markdown.matchAll(imagePattern)];

        if (!docId || matches.length === 0) {
            return markdown;
        }

        const imagesDir = path.join(storagePath, String(docId), 'images');
        fs.mkdirSync(imagesDir, { recursive: true });

        const localizedBySource = new Map();
        let imageIndex = 0;

        for (const match of matches) {
            const originalSrcRaw = String(match[2] || '').trim();
            const originalSrc = normalizeMarkdownLinkTarget(originalSrcRaw);

            if (!originalSrc || localizedBySource.has(originalSrc)) {
                continue;
            }

            try {
                imageIndex += 1;
                const downloadResult = await downloadImageAsset({
                    source: originalSrc,
                    sourceUrl,
                    outputDir: imagesDir,
                    imageIndex
                });

                if (downloadResult?.relativePath) {
                    localizedBySource.set(originalSrc, downloadResult.relativePath);
                }
            } catch {
                // Keep original image URL if download fails.
            }
        }

        if (localizedBySource.size === 0) {
            return markdown;
        }

        return markdown.replace(imagePattern, (fullMatch, alt, src) => {
            const normalizedSource = normalizeMarkdownLinkTarget(src);
            const localizedPath = localizedBySource.get(normalizedSource);
            if (!localizedPath) {
                return fullMatch;
            }

            return `![${String(alt || '').trim()}](${localizedPath})`;
        });
    }

    function normalizeMarkdownLinkTarget(rawValue) {
        const value = String(rawValue || '').trim();
        if (!value) {
            return '';
        }

        if (value.startsWith('<') && value.endsWith('>')) {
            return value.slice(1, -1).trim();
        }

        return value;
    }

    async function downloadImageAsset({ source, sourceUrl, outputDir, imageIndex }) {
        if (isDataUri(source)) {
            return downloadDataUriAsset(source, outputDir, imageIndex);
        }

        const resolvedUrl = resolveAbsoluteImageUrl(source, sourceUrl);
        if (!resolvedUrl) {
            return null;
        }

        const response = await axios.get(resolvedUrl, {
            responseType: 'arraybuffer',
            timeout: 15000
        });

        const extension = determineImageExtension(source, response?.headers?.['content-type']);
        const fileName = `image-${String(imageIndex).padStart(3, '0')}${extension}`;
        const filePath = path.join(outputDir, fileName);

        fs.writeFileSync(filePath, Buffer.from(response.data));
        return {
            relativePath: `images/${fileName}`
        };
    }

    function downloadDataUriAsset(dataUri, outputDir, imageIndex) {
        const parsed = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(String(dataUri || ''));
        if (!parsed) {
            return null;
        }

        const mimeType = String(parsed[1] || '').toLowerCase();
        const isBase64 = Boolean(parsed[2]);
        const payload = parsed[3] || '';
        const extension = determineImageExtension('', mimeType || 'image/png');
        const fileName = `image-${String(imageIndex).padStart(3, '0')}${extension}`;
        const filePath = path.join(outputDir, fileName);
        const bytes = isBase64
            ? Buffer.from(payload, 'base64')
            : Buffer.from(decodeURIComponent(payload), 'utf8');

        fs.writeFileSync(filePath, bytes);
        return {
            relativePath: `images/${fileName}`
        };
    }

    function resolveAbsoluteImageUrl(source, sourceUrl) {
        const src = String(source || '').trim();
        if (!src) {
            return null;
        }

        if (/^https?:\/\//i.test(src)) {
            return src;
        }

        if (/^\/\//.test(src)) {
            try {
                const protocol = new URL(String(sourceUrl || '')).protocol || 'https:';
                return `${protocol}${src}`;
            } catch {
                return `https:${src}`;
            }
        }

        try {
            const baseUrl = new URL(String(sourceUrl || ''));
            return new URL(src, baseUrl).toString();
        } catch {
            return null;
        }
    }

    function isDataUri(value) {
        return /^data:image\//i.test(String(value || '').trim());
    }

    function determineImageExtension(source, contentType) {
        const fromContentType = mimeTypeToExtension(contentType);
        if (fromContentType) {
            return fromContentType;
        }

        const cleanSource = String(source || '').split('?')[0].split('#')[0];
        const ext = path.extname(cleanSource).toLowerCase();
        if (ext && ext.length <= 6) {
            return ext;
        }

        return '.png';
    }

    function mimeTypeToExtension(contentType) {
        const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
        if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
            return '.jpg';
        }
        if (normalized === 'image/png') {
            return '.png';
        }
        if (normalized === 'image/gif') {
            return '.gif';
        }
        if (normalized === 'image/webp') {
            return '.webp';
        }
        if (normalized === 'image/svg+xml') {
            return '.svg';
        }
        if (normalized === 'image/bmp') {
            return '.bmp';
        }
        if (normalized === 'image/x-icon' || normalized === 'image/vnd.microsoft.icon') {
            return '.ico';
        }
        return '';
    }

    function normalizeKeywordsInput(values) {
        if (Array.isArray(values)) {
            return values;
        }

        if (typeof values === 'string') {
            return values.split(',');
        }

        return [];
    }

    function cleanKeywords(values, limit = getKeywordConfig().DEFAULT_KEYWORD_LIMIT) {
        const keywordValues = normalizeKeywordsInput(values);
        if (keywordValues.length === 0) {
            return [];
        }

        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : getKeywordConfig().DEFAULT_KEYWORD_LIMIT;
        return [...new Set(keywordValues
            .map(value => String(value || '').trim())
            .filter(value => value.length > 2))]
            .slice(0, safeLimit);
    }

    function normalizeMetadataKeywordFields(metadata = {}) {
        const base = metadata && typeof metadata === 'object' ? metadata : {};
        const keywords = cleanKeywords(base.keywords, getKeywordConfig().DEFAULT_KEYWORD_LIMIT);
        return {
            ...base,
            keywords,
            extended_keywords: cleanKeywords(generateExtendedKeywords(keywords), 80)
        };
    }

    function mergeKeywordsPreservingSignals({
        structuralKeywords = [],
        modelKeywords = [],
        lexicalKeywords = [],
        limit = getKeywordConfig().DEFAULT_KEYWORD_LIMIT
    } = {}) {
        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : getKeywordConfig().DEFAULT_KEYWORD_LIMIT;
        const structural = cleanKeywords(structuralKeywords, safeLimit * 2);
        const model = cleanKeywords(modelKeywords, safeLimit * 2);
        const lexical = cleanKeywords(lexicalKeywords, safeLimit * 2);

        const merged = [];
        let index = 0;

        // Interleave structural and BM25 keywords so both sources remain visible.
        while (merged.length < safeLimit && (index < structural.length || index < model.length)) {
            if (index < structural.length && !merged.includes(structural[index])) {
                merged.push(structural[index]);
            }

            if (merged.length >= safeLimit) {
                break;
            }

            if (index < model.length && !merged.includes(model[index])) {
                merged.push(model[index]);
            }

            index += 1;
        }

        for (const keyword of lexical) {
            if (merged.length >= safeLimit) {
                break;
            }

            if (!merged.includes(keyword)) {
                merged.push(keyword);
            }
        }

        return merged;
    }

    function appendKeywordsToExisting(existingKeywords = [], addedKeywords = [], limit = getKeywordConfig().DEFAULT_KEYWORD_LIMIT) {
        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : getKeywordConfig().DEFAULT_KEYWORD_LIMIT;
        const existing = cleanKeywords(existingKeywords, safeLimit * 2);
        const additions = cleanKeywords(addedKeywords, safeLimit * 2);
        const merged = [...existing];

        for (const keyword of additions) {
            if (merged.length >= safeLimit) {
                break;
            }
            if (!merged.includes(keyword)) {
                merged.push(keyword);
            }
        }

        return merged.slice(0, safeLimit);
    }

    async function generateAnnotationWithLlm(metadata, content) {
        const originalKeywords = cleanKeywords(metadata?.keywords);
        const fallbackKeywords = generateKeywords(content);
        const fallbackSummary = generateSummary(content);

        function appendSynonymKeywords(baseKeywords, maxSynonyms = 6) {
            const orderedBase = cleanKeywords(baseKeywords);
            if (orderedBase.length === 0) {
                return [];
            }

            const synonymCandidates = cleanKeywords(generateExtendedKeywords(orderedBase), 80)
                .filter(keyword => !orderedBase.includes(keyword))
                .slice(0, maxSynonyms);

            return cleanKeywords([...orderedBase, ...synonymCandidates]);
        }

        if (!vscode.lm || !vscode.LanguageModelChatMessage) {
            return {
                keywords: appendSynonymKeywords([...originalKeywords, ...fallbackKeywords]),
                summary: fallbackSummary
            };
        }

        try {
            const models = await vscode.lm.selectChatModels({});
            const model = models?.[0];

            if (!model) {
                return {
                    keywords: appendSynonymKeywords([...originalKeywords, ...fallbackKeywords]),
                    summary: fallbackSummary
                };
            }

            const prompt = [
                'You are annotating a local Confluence document metadata record.',
                'Return valid JSON only with shape: {"summary":"...","keywords":"keyword-a, keyword-b"}.',
                'Summary must be one concise paragraph under 220 characters.',
                'Keywords must be specific technical terms in one comma-separated string.',
                'Include a few close synonyms or related alternate terms that help retrieval.',
                `Title: ${metadata.title || ''}`,
                `Topic: ${metadata.parent_confluence_topic || ''}`,
                `Author: ${metadata.author || ''}`,
                'Document markdown content:',
                truncate(content, 4000)
            ].join('\n');

            const response = await model.sendRequest([
                vscode.LanguageModelChatMessage.User(prompt)
            ]);

            let responseText = '';
            for await (const fragment of response.text) {
                responseText += fragment;
            }

            const parsed = extractJsonObject(responseText) || {};
            const llmKeywords = cleanKeywords(parsed.keywords);
            const llmSummary = String(parsed.summary || '').trim();
            const appendedWithLlm = appendKeywordsToExisting(
                originalKeywords,
                [...llmKeywords, ...fallbackKeywords],
                getKeywordConfig().DEFAULT_KEYWORD_LIMIT
            );
            const fallbackMergedKeywords = appendKeywordsToExisting(
                originalKeywords,
                fallbackKeywords,
                getKeywordConfig().DEFAULT_KEYWORD_LIMIT
            );

            return {
                keywords: appendedWithLlm.length > 0
                    ? appendSynonymKeywords(appendedWithLlm)
                    : appendSynonymKeywords(fallbackMergedKeywords),
                summary: llmSummary || fallbackSummary
            };
        } catch {
            return {
                keywords: appendSynonymKeywords([...originalKeywords, ...fallbackKeywords]),
                summary: fallbackSummary
            };
        }
    }

    async function annotateStoredDocument(metadata) {
        const content = readDocumentContent(storagePath, metadata.id);
        if (!content) {
            return false;
        }

        const annotation = await generateAnnotationWithLlm(metadata, content);
        const updatedMetadata = normalizeMetadataKeywordFields({
            ...metadata,
            keywords: cleanKeywords(annotation.keywords, getKeywordConfig().DEFAULT_KEYWORD_LIMIT),
            summary: annotation.summary
        });

        writeDocumentFiles(storagePath, metadata.id, content, updatedMetadata);
        bm25Index.upsertDocument(updatedMetadata.id, buildKeywordOnlyIndexText(updatedMetadata));
        return true;
    }

    function getStoredMetadataById(docId) {
        const safeId = String(docId || '').trim();
        if (!safeId) {
            return null;
        }

        const allMetadata = readAllMetadata(storagePath);
        const found = allMetadata.find(item => String(item.id) === safeId) || null;
        return found ? normalizeMetadataKeywordFields(found) : null;
    }

    async function generateStoredMetadataById(docId) {
        const metadata = getStoredMetadataById(docId);
        if (!metadata) {
            throw new Error(`Document ${docId} not found in local store.`);
        }

        const content = readDocumentContent(storagePath, metadata.id);
        if (!content) {
            throw new Error(`No local content found for document ${docId}.`);
        }

        const annotation = await generateAnnotationWithLlm(metadata, content);
        const updatedMetadata = normalizeMetadataKeywordFields({
            ...metadata,
            keywords: cleanKeywords(annotation.keywords, getKeywordConfig().DEFAULT_KEYWORD_LIMIT),
            summary: String(annotation.summary || '').trim()
        });

        writeDocumentFiles(storagePath, metadata.id, content, updatedMetadata);
        bm25Index.upsertDocument(updatedMetadata.id, buildKeywordOnlyIndexText(updatedMetadata));
        return updatedMetadata;
    }

    function updateStoredMetadataById(docId, patch = {}) {
        const metadata = getStoredMetadataById(docId);
        if (!metadata) {
            throw new Error(`Document ${docId} not found in local store.`);
        }

        const content = readDocumentContent(storagePath, metadata.id);
        if (!content) {
            throw new Error(`No local content found for document ${docId}.`);
        }

        const tokenizationKeywords = cleanKeywords(generateKeywords(content), getKeywordConfig().TOKENIZATION_KEYWORD_LIMIT);
        const manualKeywords = cleanKeywords(patch.keywords, getKeywordConfig().DEFAULT_KEYWORD_LIMIT);
        const nextKeywords = mergeKeywordsPreservingSignals({
            structuralKeywords: tokenizationKeywords,
            lexicalKeywords: manualKeywords,
            limit: getKeywordConfig().DEFAULT_KEYWORD_LIMIT
        });
        const nextSummary = String(patch.summary || '').trim();
        const updatedMetadata = normalizeMetadataKeywordFields({
            ...metadata,
            keywords: nextKeywords,
            summary: nextSummary
        });

        writeDocumentFiles(storagePath, metadata.id, content, updatedMetadata);
        bm25Index.upsertDocument(updatedMetadata.id, buildKeywordOnlyIndexText(updatedMetadata));
        return updatedMetadata;
    }

    async function finalizeBm25KeywordsForDocuments(docIds = []) {
        const metadataList = readAllMetadata(storagePath);
        if (!Array.isArray(metadataList) || metadataList.length === 0) {
            return;
        }

        const corpus = metadataList.map(item => ({
            id: item.id,
            text: readDocumentContent(storagePath, item.id) || ''
        }));
        bm25Index.rebuildDocuments(corpus);

        const targetIdSet = new Set((Array.isArray(docIds) ? docIds : [])
            .map(value => String(value || '').trim())
            .filter(value => value.length > 0));

        if (targetIdSet.size === 0) {
            return;
        }

        for (const metadataEntry of metadataList) {
            const metadata = normalizeMetadataKeywordFields(metadataEntry);
            const id = String(metadata?.id || '').trim();
            if (!id || !targetIdSet.has(id)) {
                continue;
            }

            const content = readDocumentContent(storagePath, id);
            if (!content) {
                continue;
            }

            const bm25Keywords = cleanKeywords(
                bm25Index.extractKeywordsForDocument(id, { limit: getKeywordConfig().BM25_KEYWORD_LIMIT }),
                getKeywordConfig().BM25_KEYWORD_LIMIT
            );
            const tokenizationKeywords = cleanKeywords(generateKeywords(content), getKeywordConfig().TOKENIZATION_KEYWORD_LIMIT);
            const mergedKeywords = mergeKeywordsPreservingSignals({
                structuralKeywords: tokenizationKeywords,
                modelKeywords: bm25Keywords,
                limit: getKeywordConfig().DEFAULT_KEYWORD_LIMIT
            });

            if (mergedKeywords.length === 0) {
                continue;
            }

            const updatedMetadata = normalizeMetadataKeywordFields({
                ...metadata,
                keywords: mergedKeywords
            });

            writeDocumentFiles(storagePath, id, content, updatedMetadata);
        }

        const refreshedMetadata = readAllMetadata(storagePath).map(normalizeMetadataKeywordFields);
        rebuildBm25IndexFromMetadataKeywords(refreshedMetadata);
    }

    function removeBm25DocumentById(docId) {
        bm25Index.removeDocument(docId);
    }

    function sanitizeFileSegment(value) {
        return String(value || 'item')
            .toLowerCase()
            .replace(/[^a-z0-9-_ ]+/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 64) || 'item';
    }

    function getWorkspaceRootPath() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('Open a workspace folder to add prompt files.');
        }

        return workspaceFolder.uri.fsPath;
    }

    return {
        rankLocalDocuments,
        checkLocalDocumentsAgentic,
        refreshDocument,
        refreshAllDocuments,
        refreshJiraIssue,
        annotateDocumentByArg,
        annotateAllDocuments,
        getStoredMetadataById,
        generateStoredMetadataById,
        updateStoredMetadataById,
        removeBm25DocumentById,
        writeDocumentPromptFile,
        formatMetadataEntries
    };
}

module.exports = {
    createDocumentService
};
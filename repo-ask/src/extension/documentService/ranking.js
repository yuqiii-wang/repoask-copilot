module.exports = function(context) {
  const { vscode, storagePath, truncate, tokenize, readAllMetadata, readDocumentContent, bm25Index, keywordsIndex, rebuildKeywordsIndexFromMetadata, normalizeMetadataKeywordFields,  } = context;

const TOP_SCORE_THRESHOLD_RATIO = 0.5;

function rankLocalDocuments(query, limit = 20) {
  const metadataList = readAllMetadata(storagePath).map(normalizeMetadataKeywordFields);
  if (metadataList.length === 0) {
    return [];
  }

  // Rank/search should use the latest metadata keywords as the keyword index corpus.
  rebuildKeywordsIndexFromMetadata(metadataList);
  const metadataById = Object.fromEntries(metadataList.map(item => [String(item.id), item]));
  const rankedByKeywords = keywordsIndex.rankDocuments ? keywordsIndex.rankDocuments(query, metadataById, {
    limit: 1000
  }) : [];

  // Re-implementing BM25 ranking based on ngrams up to 4
  const lowerQuery = (query || '').toLowerCase().trim();
  const queryTokens = typeof tokenize === 'function' ? tokenize(lowerQuery) : lowerQuery.split(/\s+/).filter(t => t.length > 0);
  const queryTerms = [];
  for (let i = 0; i < queryTokens.length; i++) {
      queryTerms.push(queryTokens[i]); // 1-gram
      if (i < queryTokens.length - 1) queryTerms.push(queryTokens[i] + ' ' + queryTokens[i+1]); // 2-gram
      if (i < queryTokens.length - 2) queryTerms.push(queryTokens[i] + ' ' + queryTokens[i+1] + ' ' + queryTokens[i+2]); // 3-gram
      if (i < queryTokens.length - 3) queryTerms.push(queryTokens[i] + ' ' + queryTokens[i+1] + ' ' + queryTokens[i+2] + ' ' + queryTokens[i+3]); // 4-gram
  }
  const uniqueQueryTerms = [...new Set(queryTerms)];

  let rankedByContent = [];
  try {
      const { bm25TermScore } = require('./bm25Core');
      const index = bm25Index.loadIndex();
      const stats = bm25Index.buildStats(index);
      
      if (stats.totalDocs > 0 && uniqueQueryTerms.length > 0) {
          rankedByContent = Object.values(stats.docs)
              .map((doc) => {
                  let score = 0;
                  for (const term of uniqueQueryTerms) {
                      score += bm25TermScore(term, doc, stats, { limit: 1000 });
                  }

                  const metadata = metadataById[String(doc.id)] || {};
                  return {
                      ...metadata,
                      id: metadata.id || doc.id,
                      score
                  };
              })
              .filter((item) => Number(item.score) > 0)
              .sort((a, b) => b.score - a.score)
              .slice(0, 1000);
      }
  } catch (e) {
      console.error('Error during fallback ranking:', e);
  }

  const combinedScores = new Map();

  const configuredWeights = vscode.workspace.getConfiguration('repoAsk').get('searchWeights') || {};
  
  const WHOLE_QUERY_WEIGHTS = configuredWeights.WHOLE_QUERY_WEIGHTS || {};
  const TERM_WEIGHTS = configuredWeights.TERM_WEIGHTS || {};
  const NGRAM_WEIGHTS = configuredWeights.NGRAM_WEIGHTS || {};
  const BM25_WEIGHT = typeof configuredWeights.BM25_WEIGHT === 'number' ? configuredWeights.BM25_WEIGHT : 1.0;

  // Add explicit hits for keywords, id, title, tags, and type
  const lowerQueryStr = (query || '').toLowerCase().trim();
  const queryTermsArray = typeof tokenize === 'function' ? tokenize(lowerQueryStr) : lowerQueryStr.split(/\s+/).filter(t => t.length > 0);
  let queryNGrams = [];
  if (typeof tokenize === 'function') {
      const allTokens = tokenize(query, { includeNGrams: true, nGramMax: 3 });
      queryNGrams = allTokens.filter(t => typeof t === 'string' && t.includes(' '));
  }

  for (const metadata of metadataList) {
    let exactHitScore = 1;
    let hasMatch = false;
    const mId = String(metadata.id || '').toLowerCase();
    const mTitle = String(metadata.title || '').toLowerCase();
    const mSummary = String(metadata.summary || '').toLowerCase();
    const mContent = String(readDocumentContent(storagePath, metadata.id) || '').toLowerCase();
    const mKeywords = [...(Array.isArray(metadata.keywords) ? metadata.keywords : []), ...(Array.isArray(metadata.synonyms) ? metadata.synonyms : [])].map(k => String(k).toLowerCase());
    const mTags = Array.isArray(metadata.tags) ? metadata.tags.map(t => String(t).toLowerCase()) : [];
    const mType = String(metadata.type || '').toLowerCase();
    const mReferencedQueries = Array.isArray(metadata.referencedQueries) ? metadata.referencedQueries.map(q => String(q).toLowerCase()) : [];

    if (lowerQueryStr) {
      if (mId.includes(lowerQueryStr)) { exactHitScore *= WHOLE_QUERY_WEIGHTS.id; hasMatch = true; }
      if (mTitle.includes(lowerQueryStr)) { exactHitScore *= WHOLE_QUERY_WEIGHTS.title; hasMatch = true; }
      if (mKeywords.some(k => k.includes(lowerQueryStr))) { exactHitScore *= WHOLE_QUERY_WEIGHTS.keywords; hasMatch = true; }
      if (mTags.some(t => t.includes(lowerQueryStr))) { exactHitScore *= WHOLE_QUERY_WEIGHTS.tags; hasMatch = true; }
      if (mType.includes(lowerQueryStr)) { exactHitScore *= WHOLE_QUERY_WEIGHTS.type; hasMatch = true; }

      const hasExactReferencedQueryMatch = mReferencedQueries.some(q => q === lowerQueryStr);
      const hasPartialReferencedQueryMatch = !hasExactReferencedQueryMatch && mReferencedQueries.some(q => q.includes(lowerQueryStr));
      if (hasExactReferencedQueryMatch) {
        exactHitScore *= WHOLE_QUERY_WEIGHTS.referencedExact; hasMatch = true;
      } else if (hasPartialReferencedQueryMatch) {
        exactHitScore *= WHOLE_QUERY_WEIGHTS.referencedPartial; hasMatch = true;
      }
    }

    if (queryTermsArray.length > 0) {
      for (const term of queryTermsArray) {
        if (mId.includes(term)) { exactHitScore *= TERM_WEIGHTS.id; hasMatch = true; }
        if (mTitle.includes(term)) { exactHitScore *= TERM_WEIGHTS.title; hasMatch = true; }
        if (mSummary.includes(term)) { exactHitScore *= (TERM_WEIGHTS.title * 0.5 + 0.5); hasMatch = true; }
        if (mKeywords.some(k => k.includes(term))) { exactHitScore *= TERM_WEIGHTS.keywords; hasMatch = true; }
        if (mTags.some(t => t.includes(term))) { exactHitScore *= TERM_WEIGHTS.tags; hasMatch = true; }
        if (mType.includes(term)) { exactHitScore *= TERM_WEIGHTS.type; hasMatch = true; }
        if (mReferencedQueries.some(q => q.includes(term))) { exactHitScore *= TERM_WEIGHTS.referenced; hasMatch = true; }
      }
    }
    
    if (queryNGrams.length > 0) {
      for (const ngram of queryNGrams) {
        const nGramLength = ngram.split(/\s+/).length || 1;
        if (mTitle.includes(ngram)) { exactHitScore *= (NGRAM_WEIGHTS.title * nGramLength); hasMatch = true; }
        if (mSummary.includes(ngram)) { exactHitScore *= (NGRAM_WEIGHTS.summary * nGramLength); hasMatch = true; }
        if (mContent.includes(ngram)) { exactHitScore *= (NGRAM_WEIGHTS.content * nGramLength); hasMatch = true; }
      }
    }

    if (hasMatch) {
        combinedScores.set(String(metadata.id), {
            ...metadata,
            score: exactHitScore
        });
    }
  }

  for (const doc of rankedByKeywords) {
    // Give keywords a slightly higher weight since they are explicit signals
    const id = String(doc.id);
    if (combinedScores.has(id)) {
      combinedScores.get(id).score += doc.score * 1.5;
    } else {
      combinedScores.set(id, {
        ...doc,
        score: doc.score * 1.5
      });
    }
  }
  for (const doc of rankedByContent) {
    const id = String(doc.id);
    if (combinedScores.has(id)) {
      combinedScores.get(id).score += doc.score * BM25_WEIGHT;
    } else {
      combinedScores.set(id, {
        ...doc,
        score: doc.score * BM25_WEIGHT
      });
    }
  }
  let combinedRanked = Array.from(combinedScores.values()).sort((a, b) => b.score - a.score).slice(0, limit * 2);
  
  // Group related documents and ensure logical flow
  combinedRanked = groupRelatedDocuments(combinedRanked).slice(0, limit);
  combinedRanked = applyTopScoreCutoff(combinedRanked, TOP_SCORE_THRESHOLD_RATIO);
  
  return combinedRanked;
}

function applyTopScoreCutoff(documents, ratio = TOP_SCORE_THRESHOLD_RATIO) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return [];
  }

  const normalizedRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : TOP_SCORE_THRESHOLD_RATIO;
  const topScore = Number(documents[0]?.score || 0);
  if (!Number.isFinite(topScore) || topScore <= 0) {
    return [];
  }

  const minScore = topScore * normalizedRatio;
  return documents.filter(doc => Number(doc?.score || 0) >= minScore);
}

function groupRelatedDocuments(documents) {
  if (!Array.isArray(documents) || documents.length <= 1) {
    return documents;
  }
  
  const grouped = [];
  const used = new Set();
  
  // Start with the highest ranked document
  const topDoc = documents[0];
  grouped.push(topDoc);
  used.add(String(topDoc.id));
  
  // Find related documents based on shared keywords, tags, or parent topics
  for (let i = 1; i < documents.length; i++) {
    const currentDoc = documents[i];
    const currentId = String(currentDoc.id);
    
    if (used.has(currentId)) {
      continue;
    }
    
    // Check if current document is related to any already grouped document
    const isRelated = grouped.some(groupedDoc => {
      // Check shared keywords
      const sharedKeywords = (Array.isArray(currentDoc.keywords) ? currentDoc.keywords : [])
        .filter(k => (Array.isArray(groupedDoc.keywords) ? groupedDoc.keywords : []).includes(k));
      
      // Check shared tags
      const sharedTags = (Array.isArray(currentDoc.tags) ? currentDoc.tags : [])
        .filter(t => (Array.isArray(groupedDoc.tags) ? groupedDoc.tags : []).includes(t));
      
      // Check same parent topic
      const sameParent = currentDoc.parent_confluence_topic && 
                        groupedDoc.parent_confluence_topic &&
                        currentDoc.parent_confluence_topic === groupedDoc.parent_confluence_topic;
      
      // Check if documents are part of the same logical flow (e.g., same project or process)
      const sameContext = currentDoc.title && groupedDoc.title &&
                         (currentDoc.title.includes(groupedDoc.title) || 
                          groupedDoc.title.includes(currentDoc.title));
      
      return sharedKeywords.length > 0 || sharedTags.length > 0 || sameParent || sameContext;
    });
    
    if (isRelated) {
      grouped.push(currentDoc);
      used.add(currentId);
    }
  }
  
  // If we only have one document, add the next highest ranked documents that might be related
  if (grouped.length === 1 && documents.length > 1) {
    for (let i = 1; i < documents.length; i++) {
      const currentDoc = documents[i];
      const currentId = String(currentDoc.id);
      
      if (!used.has(currentId)) {
        grouped.push(currentDoc);
        used.add(currentId);
        if (grouped.length >= 5) break; // Limit to 5 related documents
      }
    }
  }
  
  return grouped;
}

  return {
    rankLocalDocuments,
    tokenize
  };
};

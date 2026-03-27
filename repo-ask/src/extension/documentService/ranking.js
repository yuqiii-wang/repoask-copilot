module.exports = function(context) {
  const { vscode, storagePath, truncate, tokenize, readAllMetadata, readDocumentContent, normalizeMetadataKeywordFields, normalizeCategorizedKeywords, flattenCategorizedKeywords } = context;
  // Use keyword tokenizer for n-gram query expansion (supports includeNGrams options)
  const { tokenize: kwTokenize } = require('./tokenization2keywords');

// Default cutoff ratio — docs scoring below this fraction of the top score are removed.
const DEFAULT_TOP_SCORE_THRESHOLD_RATIO = 0.3;

// ---------------------------------------------------------------------------
// Knowledge-graph helpers
// ---------------------------------------------------------------------------

/**
 * Parses a Mermaid flowchart string and returns a flat Set of lowercased
 * entity tokens.  Extracts:
 *   - Quoted node labels:  A["Foo Bar"]  A("Foo")  A{Foo}
 *   - Unquoted labels:     A[FooBar]
 *   - Bare node identifiers (PascalCase/ALLCAPS words used as IDs)
 */
function extractMermaidEntities(mermaidText) {
  const raw = String(mermaidText || '');
  if (!raw.trim()) return new Set();

  const entities = new Set();

  // Quoted labels inside brackets/parens/braces
  const quotedLabelRe = /[\[({]"([^"]+)"/g;
  let m;
  while ((m = quotedLabelRe.exec(raw)) !== null) {
    tokenize(m[1]).forEach(t => entities.add(t));
  }

  // Unquoted labels: word chars immediately inside brackets
  const unquotedLabelRe = /[\[({]([A-Za-z][A-Za-z0-9 _-]{1,40})[\])}]/g;
  while ((m = unquotedLabelRe.exec(raw)) !== null) {
    tokenize(m[1]).forEach(t => entities.add(t));
  }

  // Bare node IDs: PascalCase identifiers that appear before arrows or at
  // line start (e.g.  TradeProcessor -->)
  const nodeIdRe = /\b([A-Z][A-Za-z0-9_]{2,})\b/g;
  while ((m = nodeIdRe.exec(raw)) !== null) {
    tokenize(m[1]).forEach(t => entities.add(t));
  }

  return entities;
}

/**
 * Builds two adjacency indexes from the full metadata list:
 *   entityToDocIds : Map<entityToken, Set<docId>>
 *   docIdToEntities: Map<docId, Set<entityToken>>
 */
function buildKnowledgeGraphIndex(metadataList) {
  const entityToDocIds = new Map();
  const docIdToEntities = new Map();

  for (const metadata of metadataList) {
    const docId = String(metadata.id);
    const entities = extractMermaidEntities(metadata.knowledgeGraph || '');

    // Index title tokens as virtual KG entities
    tokenize(String(metadata.title || '')).forEach(t => entities.add(t));

    // Flatten categorized keywords and index all tokens as virtual KG entities
    const flatKws = flattenCategorizedKeywords(metadata.keywords);
    flatKws.forEach(kw => tokenize(String(kw)).forEach(t => entities.add(t)));

    docIdToEntities.set(docId, entities);
    for (const entity of entities) {
      if (!entityToDocIds.has(entity)) entityToDocIds.set(entity, new Set());
      entityToDocIds.get(entity).add(docId);
    }
  }

  return { entityToDocIds, docIdToEntities };
}

/**
 * Traverses the knowledge graph one hop from every already-scored doc.
 * Neighbor docs receive a boost proportional to the referring doc's score
 * multiplied by `entityTraversalBoost`.  Docs with a matching
 * `parent_confluence_topic` also receive a `sharedTopicBoost`.
 *
 * Returns a new array (scored docs may have their scores adjusted, and new
 * neighbor docs may be appended).
 */
function applyKnowledgeGraphTraversal(scoredDocs, metadataList, docIdToEntities, entityToDocIds, kgWeights) {
  const entityTraversalBoost = Number(kgWeights.entityTraversalBoost) || 0.25;
  const sharedTopicBoost = Number(kgWeights.sharedTopicBoost) || 0.15;
  const maxHops = Math.min(Math.max(Number(kgWeights.maxHops) || 1, 1), 2);

  const metadataById = new Map(metadataList.map(m => [String(m.id), m]));
  // Working score map so we can accumulate boosts efficiently
  const scoreMap = new Map(scoredDocs.map(d => [String(d.id), d]));

  let frontier = [...scoredDocs]; // docs to expand in this hop

  for (let hop = 0; hop < maxHops; hop++) {
    const nextFrontier = [];

    for (const doc of frontier) {
      const docId = String(doc.id);
      const entities = docIdToEntities.get(docId) || new Set();
      const docTopic = String(doc.parent_confluence_topic || '').toLowerCase();

      for (const entity of entities) {
        const neighborIds = entityToDocIds.get(entity) || new Set();
        for (const neighborId of neighborIds) {
          if (neighborId === docId) continue;

          const boost = doc.score * entityTraversalBoost;
          if (scoreMap.has(neighborId)) {
            // Accumulate boost on an already-scored doc
            const existing = scoreMap.get(neighborId);
            existing.score += boost;
          } else {
            // Surface a previously unranked neighbor
            const neighborMeta = metadataById.get(neighborId);
            if (!neighborMeta) continue;
            const newEntry = { ...neighborMeta, score: boost };
            scoreMap.set(neighborId, newEntry);
            nextFrontier.push(newEntry);
          }
        }
      }

      // Shared parent topic boost: give a smaller bonus to all scored docs that
      // share the same parent_confluence_topic as this one.
      if (docTopic) {
        for (const [otherId, otherDoc] of scoreMap) {
          if (otherId === docId) continue;
          const otherTopic = String(otherDoc.parent_confluence_topic || '').toLowerCase();
          if (otherTopic && otherTopic === docTopic) {
            otherDoc.score += doc.score * sharedTopicBoost;
          }
        }
      }
    }

    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }

  return Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Referenced-query cross-doc boost
// ---------------------------------------------------------------------------

/**
 * When doc A has an exact/partial referencedQueries match for the query,
 * find other docs that share strong keyword overlap with doc A and give them
 * a proportional boost.  This propagates intent signals through the corpus.
 */
function applyReferencedQueryNeighborBoost(scoredDocs, allMetadata, lowerQueryStr, queryTermsArray) {
  if (!lowerQueryStr && queryTermsArray.length === 0) return scoredDocs;

  // Find docs that directly matched via referencedQueries
  const referenceAnchors = scoredDocs.filter(d => {
    const rq = Array.isArray(d.referencedQueries) ? d.referencedQueries.map(q => String(q).toLowerCase()) : [];
    return rq.some(q => q === lowerQueryStr || (lowerQueryStr && q.includes(lowerQueryStr)));
  });
  if (referenceAnchors.length === 0) return scoredDocs;

  const scoreMap = new Map(scoredDocs.map(d => [String(d.id), d]));
  const NEIGHBOR_BOOST_RATIO = 0.12; // fraction of anchor score granted to keyword neighbor

  for (const anchor of referenceAnchors) {
    const anchorKws = new Set(flattenCategorizedKeywords(anchor.keywords));
    const anchorTags = new Set((Array.isArray(anchor.tags) ? anchor.tags : []).map(t => String(t).toLowerCase()));
    const anchorTopic = String(anchor.parent_confluence_topic || '').toLowerCase();

    for (const meta of allMetadata) {
      const mId = String(meta.id);
      if (mId === String(anchor.id)) continue;

      const metaKws = flattenCategorizedKeywords(meta.keywords);
      const metaTags = (Array.isArray(meta.tags) ? meta.tags : []).map(t => String(t).toLowerCase());
      const metaTopic = String(meta.parent_confluence_topic || '').toLowerCase();

      const sharedKws = metaKws.filter(k => anchorKws.has(k)).length;
      const sharedTags = metaTags.filter(t => anchorTags.has(t)).length;
      const sameTopic = anchorTopic && metaTopic && anchorTopic === metaTopic;

      if (sharedKws > 0 || sharedTags > 0 || sameTopic) {
        const boost = anchor.score * NEIGHBOR_BOOST_RATIO * (sharedKws + sharedTags + (sameTopic ? 1 : 0));
        if (scoreMap.has(mId)) {
          scoreMap.get(mId).score += boost;
        } else {
          const newEntry = { ...meta, score: boost };
          scoreMap.set(mId, newEntry);
        }
      }
    }
  }

  return Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Main ranking function
// ---------------------------------------------------------------------------

function rankLocalDocuments(query, limit = 20) {
  const repoAskConfig = vscode.workspace.getConfiguration('repoAsk');
  const maxResults = Math.max(Number(repoAskConfig.get('maxSearchResults')) || 5, 1);
  const topScoreThresholdRatio = (() => {
    const v = Number(repoAskConfig.get('topScoreThresholdRatio'));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_TOP_SCORE_THRESHOLD_RATIO;
  })();

  const metadataList = readAllMetadata(storagePath).map(normalizeMetadataKeywordFields);
  if (metadataList.length === 0) {
    return [];
  }

  const combinedScores = new Map();
  const explicitMatchIds = new Set();

  const configuredWeights = repoAskConfig.get('searchWeights') || {};
  
  const WHOLE_QUERY_WEIGHTS = configuredWeights.WHOLE_QUERY_WEIGHTS || {};
  const TERM_WEIGHTS = configuredWeights.TERM_WEIGHTS || {};
  const NGRAM_WEIGHTS = configuredWeights.NGRAM_WEIGHTS || {};
  const BM25_NGRAM_WEIGHTS = configuredWeights.BM25_NGRAM_WEIGHTS || {
    "1gram": 1.0,
    "2gram": 1.5,
    "3gram": 2.0,
    "4gram": 2.5
  };
  const KG_WEIGHTS = configuredWeights.KNOWLEDGE_GRAPH_WEIGHTS || {
    entityTraversalBoost: 0.25,
    sharedTopicBoost: 0.15,
    maxHops: 1
  };

  const lowerQueryStr = (query || '').toLowerCase().trim();
  const queryTermsArray = typeof tokenize === 'function' ? tokenize(lowerQueryStr) : lowerQueryStr.split(/\s+/).filter(t => t.length > 0);
  let queryNGrams = [];
  if (typeof kwTokenize === 'function') {
      // kwTokenize honours includeNGrams so multi-word phrases are actually generated
      const allTokens = kwTokenize(lowerQueryStr, { includeNGrams: true, nGramMin: 2, nGramMax: 3 });
      queryNGrams = allTokens.filter(t => typeof t === 'string' && t.includes(' '));
  }

  // Load Jira regex patterns from settings
  const jiraProfile = repoAskConfig.get('jira');
  const jiraRegexPatterns = (jiraProfile && typeof jiraProfile === 'object' && Array.isArray(jiraProfile.regex)) ? jiraProfile.regex : [];
  
  // Extract Jira IDs from query
  let jiraIds = [];
  for (const pattern of jiraRegexPatterns) {
    try {
      const regex = new RegExp(pattern, 'g');
      const matches = (query || '').match(regex);
      if (matches) {
        jiraIds = [...jiraIds, ...matches];
      }
    } catch (e) {
      console.warn('Invalid Jira regex pattern:', pattern, e);
    }
  }
  
  // Fallback to default Jira pattern if no custom patterns are configured
  if (jiraIds.length === 0) {
    const defaultJiraPattern = /[A-Z]+-\d+/g;
    const defaultMatches = (query || '').match(defaultJiraPattern);
    if (defaultMatches) {
      jiraIds = defaultMatches;
    }
  }
  
  jiraIds = [...new Set(jiraIds)];
  
  // Extract Confluence IDs from query (handles both space and comma separated)
  const confluenceIds = [...new Set((query || '').split(/[\s,]+/).filter(part => /^\d+$/.test(part)))];
  // Extract Confluence titles from comma-separated non-numeric values
  const confluenceParts = (query || '').split(',').map(part => part.trim()).filter(part => part.length > 0);
  const confluenceTitles = confluenceParts.filter(part => isNaN(part) && part.length > 0);

  // -------------------------------------------------------------------------
  // Phase 1: per-document field scoring
  // Uses an additive-within-category + multiplicative-across-category approach:
  //   score starts at 0, each signal category contributes an additive amount,
  //   then strong "anchor" matches (exact ID / Jira) apply a final multiplier.
  // This prevents a single referencedExact weight from dwarfing multi-signal
  // docs when the cutoff is applied.
  // -------------------------------------------------------------------------
  for (const metadata of metadataList) {
    let score = 0;
    let anchorMultiplier = 1;
    let hasMatch = false;
    const mId = String(metadata.id || '').toLowerCase();
    const mTitle = String(metadata.title || '').toLowerCase();
    const mTags = Array.isArray(metadata.tags) ? metadata.tags.map(t => String(t).toLowerCase()) : [];
    const mType = String(metadata.type || '').toLowerCase();
    const mReferencedQueries = Array.isArray(metadata.referencedQueries) ? metadata.referencedQueries.map(q => String(q).toLowerCase()) : [];
    const mUrl = String(metadata.url || '').toLowerCase();

    // Normalize categorized keyword structure (handles legacy flat arrays gracefully)
    const mKw = normalizeCategorizedKeywords(metadata.keywords);
    const mSynonyms = Array.isArray(metadata.synonyms) ? metadata.synonyms.map(s => String(s).toLowerCase()) : [];

    // -- Exact ID / Jira / Confluence anchors (additive + anchor multiplier) --
    for (const jiraId of jiraIds) {
      const jiraIdLower = jiraId.toLowerCase();
      if (mId.includes(jiraIdLower) || mTitle.includes(jiraIdLower) || mUrl.includes(jiraIdLower) ||
          mKw.content['1gram'].includes(jiraIdLower) || mKw.summary['1gram'].includes(jiraIdLower)) {
        anchorMultiplier = Math.max(anchorMultiplier, 2.0);
        hasMatch = true;
        explicitMatchIds.add(String(metadata.id));
      }
    }

    for (const confluenceId of confluenceIds) {
      if (String(metadata.id) === confluenceId) {
        anchorMultiplier = Math.max(anchorMultiplier, 3.0);
        hasMatch = true;
        explicitMatchIds.add(String(metadata.id));
      }
    }

    for (const confluenceTitle of confluenceTitles) {
      const confluenceTitleLower = confluenceTitle.toLowerCase();
      if (mTitle === confluenceTitleLower) {
        anchorMultiplier = Math.max(anchorMultiplier, 2.5);
        hasMatch = true;
        explicitMatchIds.add(String(metadata.id));
      }
    }

    // -- Whole-query field matches (additive, exact match per category) --
    if (lowerQueryStr) {
      if (mId.includes(lowerQueryStr)) { score += (WHOLE_QUERY_WEIGHTS.id || 50); hasMatch = true; }

      // Title: exact membership in any ngram bucket
      if (mKw.title['1gram'].includes(lowerQueryStr) ||
          mKw.title['2gram'].includes(lowerQueryStr) ||
          mKw.title['3gram'].includes(lowerQueryStr)) {
        score += (WHOLE_QUERY_WEIGHTS.title || 35); hasMatch = true;
      }

      // Content: check all ngram buckets (whole query may be multi-word)
      const queryWordCount = lowerQueryStr.split(/\s+/).filter(Boolean).length;
      const queryNgramKey = `${Math.min(queryWordCount, 4)}gram`;
      if (mKw.content['1gram'].includes(lowerQueryStr) ||
          (queryWordCount > 1 && mKw.content[queryNgramKey] && mKw.content[queryNgramKey].includes(lowerQueryStr)) ||
          mKw.knowledge_graph.includes(lowerQueryStr) ||
          mKw.semantic.includes(lowerQueryStr) ||
          mSynonyms.includes(lowerQueryStr)) {
        score += (WHOLE_QUERY_WEIGHTS.keywords || 8); hasMatch = true;
      }

      if (mTags.includes(lowerQueryStr)) { score += (WHOLE_QUERY_WEIGHTS.tags || 6); hasMatch = true; }
      if (mType === lowerQueryStr) { score += (WHOLE_QUERY_WEIGHTS.type || 4); hasMatch = true; }

      const hasExactReferencedQueryMatch = mReferencedQueries.some(q => q === lowerQueryStr);
      const hasPartialReferencedQueryMatch = !hasExactReferencedQueryMatch && mReferencedQueries.some(q => q.includes(lowerQueryStr));
      if (hasExactReferencedQueryMatch) {
        score += (WHOLE_QUERY_WEIGHTS.referencedExact || 40); hasMatch = true;
      } else if (hasPartialReferencedQueryMatch) {
        score += (WHOLE_QUERY_WEIGHTS.referencedPartial || 20); hasMatch = true;
      }
    }

    // -- Per-term field matches (additive, exact match per category) --
    if (queryTermsArray.length > 0) {
      for (const term of queryTermsArray) {
        if (mId.includes(term)) { score += (TERM_WEIGHTS.id || 3); hasMatch = true; }
        if (mKw.title['1gram'].includes(term)) { score += (TERM_WEIGHTS.title || 5); hasMatch = true; }
        if (mKw.summary['1gram'].includes(term)) { score += ((TERM_WEIGHTS.title || 5) * 0.5 + 0.5); hasMatch = true; }
        if (mKw.content['1gram'].includes(term) ||
            mKw.knowledge_graph.includes(term) ||
            mKw.semantic.includes(term) ||
            mSynonyms.includes(term)) {
          score += (TERM_WEIGHTS.keywords || 1.5); hasMatch = true;
        }
        if (mTags.includes(term)) { score += (TERM_WEIGHTS.tags || 1.2); hasMatch = true; }
        if (mType === term) { score += (TERM_WEIGHTS.type || 1); hasMatch = true; }
        if (mReferencedQueries.some(q => q.includes(term))) { score += (TERM_WEIGHTS.referenced || 4); hasMatch = true; }
      }
    }

    // -- N-gram matches (multiplicative per NGRAM_WEIGHTS) --
    if (queryNGrams.length > 0) {
      let ngramMultiplier = 1.0;
      for (const ngram of queryNGrams) {
        const nGramLength = ngram.split(/\s+/).length || 1;
        const nGramKey = `${nGramLength}gram`;

        if (mKw.title[nGramKey] && mKw.title[nGramKey].includes(ngram)) {
          ngramMultiplier *= (1 + (NGRAM_WEIGHTS.title || 12) * nGramLength * 0.1); hasMatch = true;
        }
        if (mKw.summary[nGramKey] && mKw.summary[nGramKey].includes(ngram)) {
          ngramMultiplier *= (1 + (NGRAM_WEIGHTS.summary || 2) * nGramLength * 0.1); hasMatch = true;
        }
        if (mKw.content[nGramKey] && mKw.content[nGramKey].includes(ngram)) {
          ngramMultiplier *= (1 + (NGRAM_WEIGHTS.content || 4) * nGramLength * 0.1); hasMatch = true;
        }
      }
      if (ngramMultiplier > 1.0) {
        score = (score > 0 ? score : 1) * ngramMultiplier;
      }
    }

    if (hasMatch) {
      // Apply anchor multiplier last so it scales the aggregated additive score
      combinedScores.set(String(metadata.id), {
        ...metadata,
        score: score * anchorMultiplier
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: Collect initial ranked list (generous buffer for KG expansion)
  // -------------------------------------------------------------------------
  // Use a buffer of max(limit * 3, maxResults * 6) so Phase 3 KG traversal has
  // enough surface to work with.
  const bufferSize = Math.max(limit * 3, maxResults * 6, 30);
  let combinedRanked = Array.from(combinedScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, bufferSize);

  // -------------------------------------------------------------------------
  // Phase 3: Knowledge-graph traversal boost
  // -------------------------------------------------------------------------
  if (combinedRanked.length > 0) {
    const { entityToDocIds, docIdToEntities } = buildKnowledgeGraphIndex(metadataList);
    combinedRanked = applyKnowledgeGraphTraversal(
      combinedRanked, metadataList, docIdToEntities, entityToDocIds, KG_WEIGHTS
    );
  }

  // -------------------------------------------------------------------------
  // Phase 4: Referenced-query neighbor boost
  // -------------------------------------------------------------------------
  combinedRanked = applyReferencedQueryNeighborBoost(
    combinedRanked, metadataList, lowerQueryStr, queryTermsArray
  );

  // -------------------------------------------------------------------------
  // Phase 5: Final ranking, cutoff, and hard cap
  // -------------------------------------------------------------------------
  combinedRanked = combinedRanked.sort((a, b) => b.score - a.score);

  // Group related documents (for logical ordering, not hard filtering)
  combinedRanked = groupRelatedDocuments(combinedRanked, bufferSize);

  // Adaptive cutoff: remove docs below the threshold ratio, keeping at least 1.
  // The hard cap below enforces the maxResults upper bound separately.
  combinedRanked = applyTopScoreCutoff(combinedRanked, topScoreThresholdRatio, 1);

  // Hard cap at maxResults
  combinedRanked = combinedRanked.slice(0, maxResults);

  // Always include explicit Confluence ID / Jira ID matches even if cut
  if (explicitMatchIds.size > 0) {
    const presentIds = new Set(combinedRanked.map(d => String(d.id)));
    for (const eid of explicitMatchIds) {
      if (!presentIds.has(eid) && combinedScores.has(eid)) {
        combinedRanked.push(combinedScores.get(eid));
      }
    }
    // Re-apply hard cap after forced inclusions
    combinedRanked = combinedRanked.slice(0, maxResults);
  }

  return combinedRanked;
}

// ---------------------------------------------------------------------------
// Cutoff helper — now with a minResults floor
// ---------------------------------------------------------------------------

/**
 * Filters documents to those scoring at or above `topScore * ratio`.
 * Always keeps at least `minResults` documents (the top ones by score) so
 * that a single high-scoring outlier does not eliminate all other results.
 */
function applyTopScoreCutoff(documents, ratio = DEFAULT_TOP_SCORE_THRESHOLD_RATIO, minResults = 1) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return [];
  }

  const normalizedRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_TOP_SCORE_THRESHOLD_RATIO;
  const safeMin = Math.max(1, Math.floor(minResults));
  const topScore = Number(documents[0]?.score || 0);
  if (!Number.isFinite(topScore) || topScore <= 0) {
    return documents.slice(0, safeMin);
  }

  const minScore = topScore * normalizedRatio;
  const filtered = documents.filter(doc => Number(doc?.score || 0) >= minScore);

  // Ensure floor: if ratio cut left fewer than minResults, pad with next best
  if (filtered.length < safeMin) {
    return documents.slice(0, safeMin);
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Grouping helper — orders related docs together without hard-filtering
// ---------------------------------------------------------------------------

/**
 * Re-orders `documents` so that semantically related docs appear adjacent to
 * each other (BFS from the top doc).  Unlike the previous implementation,
 * ALL input docs are returned — those with no explicit relation are appended
 * after the grouped cluster.
 */
function groupRelatedDocuments(documents, maxToOrder) {
  if (!Array.isArray(documents) || documents.length <= 1) {
    return documents;
  }
  
  const limit = maxToOrder || documents.length;
  const grouped = [];
  const used = new Set();
  
  const topDoc = documents[0];
  grouped.push(topDoc);
  used.add(String(topDoc.id));
  
  // BFS: keep expanding as long as we find related docs
  let frontier = [topDoc];
  while (frontier.length > 0 && grouped.length < limit) {
    const nextFrontier = [];

    for (const anchorDoc of frontier) {
      for (let i = 1; i < documents.length; i++) {
        const currentDoc = documents[i];
        const currentId = String(currentDoc.id);
        if (used.has(currentId)) continue;

        const sharedKeywords = flattenCategorizedKeywords(currentDoc.keywords)
          .filter(k => flattenCategorizedKeywords(anchorDoc.keywords).includes(k));
        const sharedTags = (Array.isArray(currentDoc.tags) ? currentDoc.tags : [])
          .filter(t => (Array.isArray(anchorDoc.tags) ? anchorDoc.tags : []).includes(t));
        const sameParent = currentDoc.parent_confluence_topic &&
                          anchorDoc.parent_confluence_topic &&
                          currentDoc.parent_confluence_topic === anchorDoc.parent_confluence_topic;
        const sameContext = currentDoc.title && anchorDoc.title &&
                           (currentDoc.title.includes(anchorDoc.title) ||
                            anchorDoc.title.includes(currentDoc.title));

        if (sharedKeywords.length > 0 || sharedTags.length > 0 || sameParent || sameContext) {
          grouped.push(currentDoc);
          used.add(currentId);
          nextFrontier.push(currentDoc);
        }
      }
    }

    frontier = nextFrontier;
  }
  
  // Append any remaining docs that weren't reached by BFS (preserves score order)
  for (const doc of documents) {
    if (!used.has(String(doc.id))) {
      grouped.push(doc);
    }
  }
  
  return grouped;
}

  return {
    rankLocalDocuments,
    tokenize
  };
};

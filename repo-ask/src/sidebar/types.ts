export interface DocSummary {
    id: string;
    title: string;
    lastUpdated?: string;
}

/** 0-based positions of a token within the owning section's full token array. */
export type TokenPositions = number[];

/** Map from n-gram string → token positions in the section. */
export type NgramTokenMap = Record<string, TokenPositions>;

/** The four n-gram size buckets for a single keyword category. */
export interface NgramBuckets {
    '1gram': NgramTokenMap;
    '2gram': NgramTokenMap;
    '3gram': NgramTokenMap;
    '4gram': NgramTokenMap;
}

/** All categorized keyword sections stored per document. */
export interface Keywords {
    /** Sliding-window n-grams of the document title. */
    title: NgramBuckets;
    /** N-grams from headings, bold text, code identifiers and capital sequences. */
    structural: NgramBuckets;
    /** Keywords produced by LLM annotation — preserved across refreshes. */
    semantic: NgramBuckets;
    /** High-scoring n-gram tokens from BM25 corpus analysis. */
    bm25: NgramBuckets;
    /** Entity tokens extracted from the mermaid knowledge graph. */
    kg: NgramBuckets;
    /** Morphological / pattern expansions of the other keywords. */
    synonyms: NgramBuckets;
}

/** Map from query text → ordered list of ISO-8601 datetime strings when the query was issued. */
export type ReferencedQueries = Record<string, string[]>;

export interface Metadata {
    id?: string;
    title?: string;
    version?: number;
    type?: string;
    author?: string;
    summary?: string;
    tags?: string[];
    keywords?: Keywords;
    referencedQueries?: ReferencedQueries;
    relatedPages?: string[];
    knowledgeGraph?: string;
    lastUpdated?: string;
    feedback?: string;
    [key: string]: unknown;
}

export type SyncType = 'single' | 'all' | 'feedback' | 'reset';

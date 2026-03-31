export interface DocSummary {
    id: string;
    title: string;
    last_updated?: string;
}

export interface Metadata {
    id?: string;
    title?: string;
    type?: string;
    summary?: string;
    tags?: string[];
    referencedQueries?: string[];
    relatedPages?: string[];
    knowledgeGraph?: string;
    [key: string]: unknown;
}

export type SyncType = 'single' | 'all' | 'feedback' | 'reset';

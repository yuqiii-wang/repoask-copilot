// mcp/apiMap.js

/**
 * apiMap provides localized path mappings for the underlying dummy APIs.
 * Instead of hardcoding the URL paths in the api modules, they use these maps.
 */

const confluenceApiMap = {
    contentResolve: (base: any, candidate: any) => `${base}/confluence/rest/api/content/${encodeURIComponent(candidate)}`,
    contentStorage: (base: any, candidate: any) => `${base}/confluence/rest/api/content/${encodeURIComponent(candidate)}?expand=body.storage,version`,
    contentMeta: (base: any, pageId: any) => `${base}/confluence/rest/api/content/${encodeURIComponent(pageId)}?expand=version`,
    contentAll: (base: any) => `${base}/confluence/rest/api/content?expand=body.storage`,
    contentAllMeta: (base: any) => `${base}/confluence/rest/api/content?expand=version`,
    contentChildren: (base: any, pageId: any) => `${base}/confluence/rest/api/content/${encodeURIComponent(pageId)}/child/page?expand=body.storage`,
    contentUpdate: (base: any, pageId: any) => `${base}/confluence/rest/api/content/${encodeURIComponent(pageId)}`,
    contentCreate: (base: any) => `${base}/confluence/rest/api/content`
};

const jiraApiMap = {
    issueResolve: (base: any, queryArg: any) => `${base}/rest/api/2/issue/resolve?arg=${encodeURIComponent(queryArg)}`,
    issue: (base: any, queryArg: any) => `${base}/rest/api/2/issue/${encodeURIComponent(queryArg)}`,
    search: (base: any, query: any) => `${base}/rest/api/2/search${query}`
};

export { confluenceApiMap,
    jiraApiMap
};

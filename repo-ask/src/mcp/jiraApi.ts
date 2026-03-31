import vscode from 'vscode';
import { jiraApiMap } from './apiMap';
import { httpManager, getAuthHeaders } from './httpManager';

const REQUEST_TIMEOUT_MS = 15000;

function getJiraConfig() {
    const configuration = vscode.workspace.getConfiguration('repoAsk');
    const profile = configuration.get('jira');

    let url = '';
    let securityToken = '';

    if (profile && typeof profile === 'object') {
        url = (profile as any).url || '';
        securityToken = (profile as any).securityToken || '';
    }

    return {
        url: String(url).replace(/\/$/, ''),
        securityToken
    };
}

async function fetchJiraIssue(issueArg: any) {
    let { url: base, securityToken } = getJiraConfig();
    let queryArg = issueArg;

    if (String(issueArg).startsWith('http')) {
        const parsed = new URL(issueArg);
        base = parsed.origin;
        const match = parsed.pathname.match(/\/browse\/([A-Za-z0-9\-]+)/i);
        if (match) {
            queryArg = match[1];
        }
    }

    const resolveUrl = jiraApiMap.issueResolve(base, queryArg);
    const headers = getAuthHeaders(securityToken);

    try {
        const responseData = await httpManager.request({
            method: 'GET',
            url: resolveUrl,
            timeout: REQUEST_TIMEOUT_MS,
            headers
        });
        return responseData;
    } catch {
        const responseData = await httpManager.request({
            method: 'GET',
            url: jiraApiMap.issue(base, queryArg),
            timeout: REQUEST_TIMEOUT_MS,
            headers
        });
        return responseData;
    }
}

async function fetchAllJiraIssues(project: any) {
    const { url: base, securityToken } = getJiraConfig();
    const headers = getAuthHeaders(securityToken);
    const query = project ? `?project=${encodeURIComponent(project)}` : '';
    
    const responseData = await httpManager.request({
        method: 'GET',
        url: jiraApiMap.search(base, query),
        timeout: REQUEST_TIMEOUT_MS,
        headers
    });
    
    const issues = Array.isArray((responseData as any)?.issues) ? (responseData as any).issues : [];
    return issues;
}

function getJiraExtractionRegexes(vsApi: any) {
    const configuration = (vsApi || vscode).workspace.getConfiguration('repoAsk');
    const jiraProfile = configuration.get('jira');
    const patternList = Array.isArray(jiraProfile?.regex) ? jiraProfile.regex : [];
    const compiled: RegExp[] = [];
    for (const pattern of patternList) {
        if (typeof pattern !== 'string' || pattern.trim().length === 0) continue;
        try { compiled.push(new RegExp(pattern, 'i')); } catch { }
    }
    return compiled;
}

export { fetchJiraIssue,
    fetchAllJiraIssues,
    getJiraExtractionRegexes
};

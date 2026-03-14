const axios = require('axios');
const vscode = require('vscode');
const { confluenceApiMap } = require('./apiMap');

const REQUEST_TIMEOUT_MS = 5000;

function getConfluenceConfig() {
    const configuration = vscode.workspace.getConfiguration('repoAsk');
    const profile = configuration.get('confluence');
    
    let url = '';
    let securityToken = '';
    
    if (profile && typeof profile === 'object') {
        url = profile.url || '';
        securityToken = profile.securityToken || '';
    }
    
    return {
        url: String(url).replace(/\/$/, ''),
        securityToken
    };
}

function getHeaders(securityToken) {
    const headers = {};
    if (securityToken) {
        if (securityToken.startsWith('Bearer ') || securityToken.startsWith('Basic ')) {
            headers['Authorization'] = securityToken;
        } else if (securityToken.includes(':')) {
            headers['Authorization'] = `Basic ${Buffer.from(securityToken).toString('base64')}`;
        } else {
            headers['Authorization'] = `Bearer ${securityToken}`;
        }
    }
    return headers;
}

function extractConfluencePageIdFromArg(pageArg) {
    const raw = String(pageArg || '').trim();
    if (!raw) {
        return null;
    }
    const directMatch = raw.match(/(?:[?&]pageId=|\/pages\/|\/viewpage\/|\.action\/|\?pageId=)(\d+)/i);
    if (directMatch && directMatch[1]) {
        return directMatch[1];
    }
    return '';
}

function buildResolveCandidates(pageArg) {
    const raw = String(pageArg || '').trim();
    if (!raw) {
        return [];
    }
    const id = extractConfluencePageIdFromArg(raw);
    if (id) {
        return [id, raw];
    }
    return [raw];
}

async function fetchConfluencePage(pageArg) {
    let { url: base, securityToken } = getConfluenceConfig();
    
    // If pageArg is a URL, use its origin
    if (String(pageArg).startsWith('http')) {
        base = new URL(pageArg).origin;
    } else if (!base) {
        throw new Error('Confluence base URL not configured. Please set the repoAsk.confluence.url setting.');
    }
    
    const headers = getHeaders(securityToken);
    
    // Try the direct page ID first if available
    const pageId = extractConfluencePageIdFromArg(pageArg);
    if (pageId) {
        try {
            const storageUrl = confluenceApiMap.contentStorage(base, pageId);
            const response = await axios.get(storageUrl, {
                timeout: REQUEST_TIMEOUT_MS,
                headers,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
            return response.data;
        } catch (error) {
            // Continue to try other methods
        }
    }
    
    // Try with the original pageArg
    try {
        const storageUrl = confluenceApiMap.contentStorage(base, pageArg);
        const response = await axios.get(storageUrl, {
            timeout: REQUEST_TIMEOUT_MS,
            headers,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        return response.data;
    } catch (error) {
        throw error || new Error('Failed to fetch Confluence page with provided argument.');
    }
}

async function fetchAllConfluencePages() {
    const { url: base, securityToken } = getConfluenceConfig();
    
    if (!base) {
        throw new Error('Confluence base URL not configured. Please set the repoAsk.confluence.url setting.');
    }
    
    const headers = getHeaders(securityToken);
    
    const response = await axios.get(confluenceApiMap.contentAll(base), {
        timeout: REQUEST_TIMEOUT_MS,
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });
    return response.data;
}

async function fetchConfluencePageChildren(pageId) {
    let { url: base, securityToken } = getConfluenceConfig();
    
    // If pageId is a URL, use its origin
    if (String(pageId).startsWith('http')) {
        base = new URL(pageId).origin;
    } else if (!base) {
        throw new Error('Confluence base URL not configured. Please set the repoAsk.confluence.url setting.');
    }
    
    const headers = getHeaders(securityToken);
    
    const response = await axios.get(confluenceApiMap.contentChildren(base, pageId), {
        timeout: REQUEST_TIMEOUT_MS,
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });
    return response.data;
}

async function updateConfluencePage(pageId, feedbackEntry) {
    let { url: base, securityToken } = getConfluenceConfig();
    let pageIdForApi = pageId;
    
    // If pageId is a URL, use its origin
    if (String(pageId).startsWith('http')) {
        const url = new URL(pageId);
        base = url.origin;
        // Extract just the page ID from the URL for the API endpoint
        pageIdForApi = extractConfluencePageIdFromArg(pageId) || pageId;
    } else if (!base) {
        throw new Error('Confluence base URL not configured. Please set the repoAsk.confluence.url setting.');
    }
    
    const headers = getHeaders(securityToken);
    headers['Content-Type'] = 'application/json';
    
    // First, get the current page content
    const currentPage = await fetchConfluencePage(pageId);
    
    // Extract current content and append the new feedback entry
    let currentContent = currentPage.body?.storage?.value || '';
    
    // Ensure the content ends with a newline before appending
    if (currentContent && !currentContent.endsWith('\n')) {
        currentContent += '\n';
    }
    
    // Append the new feedback entry
    const updatedContent = currentContent + feedbackEntry;
    
    // Prepare the update request payload
    const payload = {
        id: extractConfluencePageIdFromArg(pageId) || pageId,
        type: 'page',
        title: currentPage.title,
        body: {
            storage: {
                value: updatedContent,
                representation: 'storage'
            }
        },
        version: {
            number: (currentPage.version?.number || 1) + 1
        }
    };
    
    // Send the update request
    const response = await axios.put(confluenceApiMap.contentUpdate(base, pageIdForApi), payload, {
        timeout: REQUEST_TIMEOUT_MS,
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });
    
    return response.data;
}

async function createConfluencePage(title, content) {
    let { url: base, securityToken } = getConfluenceConfig();
    
    if (!base) {
        throw new Error('Confluence base URL not configured. Please set the repoAsk.confluence.url setting.');
    }
    
    const headers = getHeaders(securityToken);
    headers['Content-Type'] = 'application/json';
    
    // Prepare the create request payload
    const payload = {
        type: 'page',
        title: title,
        body: {
            storage: {
                value: content,
                representation: 'storage'
            }
        },
        space: {
            key: 'PROJ'
        }
    };
    
    // Send the create request
    const response = await axios.post(confluenceApiMap.contentCreate(base), payload, {
        timeout: REQUEST_TIMEOUT_MS,
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });
    
    return response.data;
}

module.exports = {
    fetchConfluencePage,
    fetchAllConfluencePages,
    fetchConfluencePageChildren,
    updateConfluencePage,
    createConfluencePage
};

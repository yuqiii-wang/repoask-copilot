const fs = require('fs');
const path = require('path');
const { bm25Idf, bm25TermScore, DEFAULT_K1, DEFAULT_B } = require('../extension/documentService/bm25Core');

function createBm25Index(deps) {
    const {
        storePath,
        tokenize,
        indexFileName = 'bm25-index.json'
    } = deps;

    function ensureStorePath() {
        fs.mkdirSync(storePath, { recursive: true });
    }

    function getIndexPath() {
        ensureStorePath();
        return path.join(storePath, indexFileName);
    }

    function loadIndex() {
        const indexPath = getIndexPath();
        if (!fs.existsSync(indexPath)) {
            return { docs: {} };
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            if (parsed && typeof parsed === 'object' && parsed.docs && typeof parsed.docs === 'object') {
                return parsed;
            }
        } catch {
            // Fall through to empty index.
        }

        return { docs: {} };
    }

    function saveIndex(index) {
        const indexPath = getIndexPath();
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
    }

    function normalizeTokenList(tokens) {
        return (Array.isArray(tokens) ? tokens : [])
            .map(token => String(token || '').trim().toLowerCase())
            .filter(token => token.length > 2 && /^[a-z0-9\s\-_]+$/.test(token));
    }

    function buildTermFrequency(tokens) {
        const frequency = {};
        for (let i = 0; i < tokens.length; i++) {
            // 1-gram
            const g1 = tokens[i];
            frequency[g1] = (frequency[g1] || 0) + 1;
            
            // 2-gram
            if (i < tokens.length - 1) {
                const g2 = tokens[i] + ' ' + tokens[i+1];
                frequency[g2] = (frequency[g2] || 0) + 1;
            }
            
            // 3-gram
            if (i < tokens.length - 2) {
                const g3 = tokens[i] + ' ' + tokens[i+1] + ' ' + tokens[i+2];
                frequency[g3] = (frequency[g3] || 0) + 1;
            }
            
            // 4-gram
            if (i < tokens.length - 3) {
                const g4 = tokens[i] + ' ' + tokens[i+1] + ' ' + tokens[i+2] + ' ' + tokens[i+3];
                frequency[g4] = (frequency[g4] || 0) + 1;
            }
        }
        return frequency;
    }

    function upsertDocument(docId, text) {
        const id = String(docId || '').trim();
        if (!id) {
            return;
        }

        const tokens = normalizeTokenList(tokenize(String(text || '')));
        const index = loadIndex();
        index.docs[id] = {
            id,
            length: tokens.length,
            tf: buildTermFrequency(tokens)
        };
        saveIndex(index);
    }

    function removeDocument(docId) {
        const id = String(docId || '').trim();
        if (!id) {
            return;
        }

        const index = loadIndex();
        if (index.docs[id]) {
            delete index.docs[id];
            saveIndex(index);
        }
    }

    function rebuildDocuments(documents) {
        const nextDocs = {};
        for (const entry of (Array.isArray(documents) ? documents : [])) {
            const id = String(entry?.id || '').trim();
            if (!id) {
                continue;
            }

            const tokens = normalizeTokenList(tokenize(String(entry?.text || '')));
            nextDocs[id] = {
                id,
                length: tokens.length,
                tf: buildTermFrequency(tokens)
            };
        }

        saveIndex({ docs: nextDocs });
    }

    function buildStats(index) {
        const docs = index?.docs || {};
        const docEntries = Object.values(docs);
        const totalDocs = docEntries.length;
        const totalLength = docEntries.reduce((sum, doc) => sum + Number(doc.length || 0), 0);
        const avgDocLength = totalDocs > 0 ? (totalLength / totalDocs) : 0;

        const docFreq = {};
        for (const doc of docEntries) {
            const terms = Object.keys(doc.tf || {});
            for (const term of terms) {
                docFreq[term] = (docFreq[term] || 0) + 1;
            }
        }

        return {
            docs,
            totalDocs,
            avgDocLength,
            docFreq
        };
    }

    function listDocumentIds() {
        const index = loadIndex();
        return Object.keys(index?.docs || {});
    }

    return {
        ensureStorePath,
        upsertDocument,
        removeDocument,
        rebuildDocuments,
        listDocumentIds,
        buildStats,
        loadIndex
    };
}

module.exports = {
    createBm25Index
};

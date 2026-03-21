const fs = require('fs');
const path = require('path');

const DICTIONARY_FILE = path.join(__dirname, 'google_20k_eng_words.txt');
const COMMON_SUFFIXES = [
    's',
    'ment',
    'tion',
    'sion',
    'ion',
    'ant',
    'ent',
    'ness',
    'ity',
    'ism',
    'ist',
    'ship',
    'age',
    'ery',
    'ory',
    'able',
    'ible',
    'ing',
    'ed',
    'er',
    'or',
    'ly',
    'al',
    'ive',
    'ous'
];

let cachedDictionary = null;

function loadDictionary() {
    if (cachedDictionary) {
        return cachedDictionary;
    }

    try {
        const raw = fs.readFileSync(DICTIONARY_FILE, 'utf8');
        const words = raw
            .split(/\r?\n/)
            .map(value => String(value || '').trim().toLowerCase())
            .filter(value => /^[a-z]+$/.test(value) && value.length > 2);
        cachedDictionary = new Set(words);
    } catch {
        cachedDictionary = new Set();
    }

    return cachedDictionary;
}

function toSingleWordKeyword(value) {
    const keyword = String(value || '').trim().toLowerCase();
    return /^[a-z]+$/.test(keyword) ? keyword : '';
}

function getAppendCandidates(word, suffix) {
    if (suffix === 'age') {
        return /[kt]$/.test(word) ? [`${word}${suffix}`] : [];
    }

    if (suffix === 'ion') {
        return /t$/.test(word) ? [`${word}${suffix}`] : [];
    }

    if (suffix === 'tion') {
        const asIs = /[ct]$/.test(word) ? `${word}${suffix}` : '';
        const yToI = /y$/.test(word) && word.length > 3
            ? `${word.slice(0, -1)}i${suffix}`
            : '';
        return [...new Set([asIs, yToI].filter(Boolean))];
    }

    if (suffix === 's') {
        return word.endsWith('s') ? [] : [`${word}${suffix}`];
    }

    if (suffix === 'ing') {
        const withE = `${word}${suffix}`;
        const withoutE = word.endsWith('e') && word.length > 3
            ? `${word.slice(0, -1)}${suffix}`
            : '';
        return [...new Set([withE, withoutE].filter(Boolean))];
    }

    if (suffix === 'ed') {
        const withEd = `${word}${suffix}`;
        const withD = word.endsWith('e') ? `${word}d` : '';
        return [...new Set([withEd, withD].filter(Boolean))];
    }

    if (suffix === 'er') {
        const withEr = `${word}${suffix}`;
        const withR = word.endsWith('e') ? `${word}r` : '';
        return [...new Set([withEr, withR].filter(Boolean))];
    }

    if (suffix === 'ly') {
        const regular = `${word}${suffix}`;
        const yToI = /y$/.test(word) && word.length > 3
            ? `${word.slice(0, -1)}ily`
            : '';
        return [...new Set([regular, yToI].filter(Boolean))];
    }

    if (suffix === 'ness') {
        const regular = `${word}${suffix}`;
        const yToI = /y$/.test(word) && word.length > 3
            ? `${word.slice(0, -1)}iness`
            : '';
        return [...new Set([regular, yToI].filter(Boolean))];
    }

    if (suffix === 'able' || suffix === 'ible') {
        const regular = `${word}${suffix}`;
        const dropE = word.endsWith('e') && word.length > 3
            ? `${word.slice(0, -1)}${suffix}`
            : '';
        return [...new Set([regular, dropE].filter(Boolean))];
    }

    return [`${word}${suffix}`];
}

function getTrimCandidates(word, suffix) {
    if (!word.endsWith(suffix) || word.length - suffix.length <= 2) {
        return [];
    }

    const trimmed = word.slice(0, word.length - suffix.length);

    if (suffix === 'ing') {
        const withE = `${trimmed}e`;
        return [...new Set([trimmed, withE])];
    }

    if (suffix === 'ed') {
        const fromEd = trimmed;
        const fromD = word.endsWith('d') && !word.endsWith('ed')
            ? `${word.slice(0, -1)}e`
            : '';
        return [...new Set([fromEd, fromD].filter(Boolean))];
    }

    if (suffix === 'er') {
        const fromEr = trimmed;
        const fromR = word.endsWith('r') && !word.endsWith('er')
            ? `${word.slice(0, -1)}e`
            : '';
        return [...new Set([fromEr, fromR].filter(Boolean))];
    }

    if (suffix === 'ly' && word.endsWith('ily')) {
        const fromIly = `${word.slice(0, -3)}y`;
        return [...new Set([trimmed, fromIly])];
    }

    if (suffix === 'ness' && word.endsWith('iness')) {
        const fromIness = `${word.slice(0, -5)}y`;
        return [...new Set([trimmed, fromIness])];
    }

    if ((suffix === 'able' || suffix === 'ible') && /[a-z]+(able|ible)$/.test(word)) {
        const withE = `${trimmed}e`;
        return [...new Set([trimmed, withE])];
    }

    if (suffix === 'tion' && word.endsWith('ition') && word.length > 6) {
        const toY = `${word.slice(0, -5)}y`;
        return [...new Set([trimmed, toY])];
    }

    return [trimmed];
}

const { PATTERNS, generate_structural_regex, STRUCTURAL_SEPARATORS } = require('./patternMatch');

function camelCaseToDashed(camelCase) {
    return camelCase
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase();
}

function generateSynonyms(keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) {
        return [];
    }

    const dictionary = loadDictionary();
    const expanded = new Set();
    
    for (const kw of keywords) {
        const textKw = String(kw || '').trim();
        if (!textKw) continue;
        
        if (textKw.includes(' ')) {
            expanded.add(textKw);
            continue;
        }

        const digitCount = (textKw.match(/\d/g) || []).length;
        const hasSeparator = STRUCTURAL_SEPARATORS.some(sep => textKw.includes(sep));
        if (digitCount >= 3 || hasSeparator) {
            const structRegex = generate_structural_regex(textKw);
            if (structRegex) {
                expanded.add(structRegex);
            }
        }
        
        for (const [name, pattern] of PATTERNS) {
            const regex = new RegExp(pattern.source, 'i');
            if (regex.test(textKw)) {
                expanded.add(name.toLowerCase());
                
                if (name.includes('DATE')) {
                    expanded.add(textKw.replace(/[\/]/g, '-'));
                }
            }
        }
        
        if (/[A-Z][a-z]+(?:[A-Z][a-z]+)+/.test(textKw)) {
            expanded.add(camelCaseToDashed(textKw));
        }
        
        if (/[a-z0-9]+(?:_[a-z0-9]+)+/.test(textKw)) {
            expanded.add(textKw.replace(/_/g, '-'));
        }
        
        if (/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(textKw)) {
            expanded.add(textKw.replace(/[-.]/g, '-'));
        }
    }

    if (dictionary.size > 0) {
        const baseWords = [...new Set(keywords
            .map(toSingleWordKeyword)
            .filter(word => word.length > 2))];

        for (const word of baseWords) {
            for (const suffix of COMMON_SUFFIXES) {
                const appendedCandidates = getAppendCandidates(word, suffix);
                for (const appended of appendedCandidates) {
                    if (appended !== word && dictionary.has(appended)) {
                        expanded.add(appended);
                    }
                }

                const trimmedCandidates = getTrimCandidates(word, suffix);
                for (const trimmed of trimmedCandidates) {
                    if (trimmed !== word && dictionary.has(trimmed)) {
                        expanded.add(trimmed);
                    }
                }
            }
        }
    }

    return [...expanded]
        .filter(word => !keywords.includes(word))
        .slice(0, 80);
}

module.exports = {
    generateSynonyms
};

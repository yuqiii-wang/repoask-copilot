import fs from 'fs';
import path from 'path';
import { PATTERNS, generate_structural_regex, STRUCTURAL_SEPARATORS } from './patternMatch';

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

let cachedDictionary: Set<string> | null = null;

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

function toSingleWordKeyword(value: any) {
    const keyword = String(value || '').trim().toLowerCase();
    return /^[a-z]+$/.test(keyword) ? keyword : '';
}

function getAppendCandidates(word: any, suffix: any) {
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

function getTrimCandidates(word: any, suffix: any) {
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



function camelCaseToDashed(camelCase: any) {
    return camelCase
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase();
}

/**
 * Return true if the string contains regex metacharacters that suggest it is
 * a regex pattern rather than a plain compound token.
 * Detects: character classes [...], escape sequences \d \w \s etc., non-capturing
 * groups (?:, and counted quantifiers {n}.
 */
function looksLikeRegex(kw: any) {
    return /\[.*\]|\\\w|\(\?|\{\d/.test(kw);
}

/**
 * Count occurrences of delimiter characters in kw that sit OUTSIDE a regex
 * character class [...] and are not preceded by a backslash escape.
 * This prevents hyphens/slashes that are part of regex syntax (e.g. [A-Z], \/)
 * from being treated as gram word-boundary delimiters.
 * @param {string} kw
 * @param {string[]} delimiters
 * @returns {number}
 */
function countDelimitersOutsideCharClass(kw: any, delimiters: any) {
    const delimSet = new Set(delimiters);
    let inCharClass = false;
    let count = 0;
    for (let i = 0; i < kw.length; i++) {
        const ch = kw[i];
        if (ch === '\\') {
            i++; // skip escaped character — not a delimiter
            continue;
        }
        if (ch === '[') { inCharClass = true; continue; }
        if (ch === ']' && inCharClass) { inCharClass = false; continue; }
        if (!inCharClass && delimSet.has(ch)) {
            count++;
        }
    }
    return count;
}

/**
 * Count the effective gram size of a synonym string.
 * Space-separated words first; for single-word tokens check compound separators.
 * For regex-like strings (e.g. "[A-Z]-\d+"), delimiters inside character classes
 * or preceded by an escape are NOT counted as gram boundaries.
 * e.g. "fx-2024-00789" → 3, "risk manager" → 2, "[A-Z]-\d+" → 2.
 */
function countGrams(kw: any) {
    const str = String(kw || '').trim();
    const spaceCount = str.split(/\s+/).length;
    if (spaceCount > 1) return spaceCount;

    if (looksLikeRegex(str)) {
        // For regex patterns, only '-' and '/' can be structural gram separators.
        // '+', '.', '_' are regex metacharacters (quantifier, wildcard) and must not split grams.
        const delimCount = countDelimitersOutsideCharClass(str, ['-', '/']);
        return delimCount > 0 ? delimCount + 1 : 1;
    }

    // Pure decimal number (e.g. 123.456788): single dot between digit groups → 1 gram.
    // Multiple dots (e.g. 1.2.3) fall through and split normally.
    if (/^\d+\.\d+$/.test(str)) return 1;

    const segCount = str.split(/[-_.+/]/).filter(Boolean).length;
    return segCount > 1 ? segCount : 1;
}

function generateSynonyms(keywords: any) {
    if (!Array.isArray(keywords) || keywords.length === 0) {
        return [];
    }

    const dictionary = loadDictionary();
    // Maps each generated synonym to the set of source keywords that produced it,
    // so token positions can be inherited from the original content.
    const expandedMap = new Map<string, Set<string>>();

    function addSynonym(syn: string, source: string) {
        if (!expandedMap.has(syn)) {
            expandedMap.set(syn, new Set<string>());
        }
        expandedMap.get(syn)!.add(source);
    }

    for (const kw of keywords) {
        const textKw = String(kw || '').trim();
        if (!textKw) continue;

        if (textKw.includes(' ')) {
            addSynonym(textKw, textKw);
            continue;
        }

        // Multi-decimal number (e.g. 123.456788): add rounded variants at 1–3 dp and integer part.
        const decimalMatch = textKw.match(/^(\d+)\.(\d{2,})$/);
        if (decimalMatch) {
            const num = parseFloat(textKw);
            addSynonym(decimalMatch[1], textKw);               // integer part (1gram)
            const fracLen = decimalMatch[2].length;
            if (fracLen >= 1) addSynonym(num.toFixed(1), textKw);
            if (fracLen >= 2) addSynonym(num.toFixed(2), textKw);
            if (fracLen >= 3) addSynonym(num.toFixed(3), textKw);
        }

        const digitCount = (textKw.match(/\d/g) || []).length;
        const hasSeparator = STRUCTURAL_SEPARATORS.some(sep => textKw.includes(sep));
        if (digitCount >= 3 || hasSeparator) {
            const structRegex = generate_structural_regex(textKw);
            if (structRegex) {
                addSynonym(structRegex, textKw);
            }
        }

        for (const [name, pattern] of PATTERNS) {
            const regex = new RegExp((pattern as RegExp).source, 'i');
            const tkStr = String(textKw);
            if (regex.test(tkStr)) {
                addSynonym((name as string).toLowerCase(), textKw);

                if ((name as string).includes('DATE')) {
                    addSynonym(tkStr.replace(/[\/]/g, '-'), textKw);
                }
            }
        }

        if (/[A-Z][a-z]+(?:[A-Z][a-z]+)+/.test(textKw)) {
            addSynonym(camelCaseToDashed(textKw), textKw);
        }

        if (/[a-z0-9]+(?:_[a-z0-9]+)+/.test(textKw)) {
            addSynonym(textKw.replace(/_/g, '-'), textKw);
        }

        if (/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(textKw)) {
            addSynonym(textKw.replace(/[-.]/g, '-'), textKw);
        }
    }

    if (dictionary && dictionary.size > 0) {
        const baseWords = [...new Set(keywords
            .map(toSingleWordKeyword)
            .filter(word => word.length > 2))];

        for (const word of baseWords) {
            for (const suffix of COMMON_SUFFIXES) {
                const appendedCandidates = getAppendCandidates(word, suffix);
                for (const appended of appendedCandidates) {
                    if (appended !== word && dictionary.has(appended)) {
                        addSynonym(appended, word);
                    }
                }

                const trimmedCandidates = getTrimCandidates(word, suffix);
                for (const trimmed of trimmedCandidates) {
                    if (trimmed !== word && dictionary.has(trimmed)) {
                        addSynonym(trimmed, word);
                    }
                }
            }
        }
    }

    const result: Record<string, any> = { '1gram': [], '2gram': [], '3gram': [], '4gram': [] };
    const sourceMap: Record<string, string[]> = {};

    for (const [syn, sources] of expandedMap) {
        if (keywords.includes(syn)) continue;
        const n = countGrams(syn);
        const key = n >= 4 ? '4gram' : `${n}gram`;
        result[key].push(syn);
        sourceMap[syn.toLowerCase()] = [...sources];
    }
    // cap each bucket
    for (const key of ['1gram', '2gram', '3gram', '4gram']) {
        result[key] = (result[key] as string[]).slice(0, 25);
    }
    // Attach sourceMap so callers can resolve token positions from original content
    result.sourceMap = sourceMap;
    return result;
}

export {  generateSynonyms };

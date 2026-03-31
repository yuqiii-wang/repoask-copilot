const PATTERN_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PATTERN_ISIN = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/;
const PATTERN_CUSIP = /^[A-Z0-9]{9}$/;
const PATTERN_TICKER = /^[A-Z]{3,5}$/;
const PATTERN_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PATTERN_SEDOL = /^[B-DF-HJ-NP-TV-Z0-9]{6}[0-9]$/;
const PATTERN_LEI = /^[A-Z0-9]{20}$/;
const PATTERN_FIGI = /^[B-DF-HJ-NP-TV-Z0-9]{12}$/;
const PATTERN_OPTION_OSI = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;
const PATTERN_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const PATTERN_DATE_COMMON = /^\d{2}\/\d{2}\/\d{4}$/;
const PATTERN_PRICE = /^\d+\.\d{2}$/;
const PATTERN_NUM = /^\d+$/;
const PATTERN_QUANTITY = /^[$]?[0-9]{1,3}(?:,?[0-9]{3})*(?:\.[0-9]+)?[kKmMbB]?$/;
const PATTERN_ALL_CAPS = /^[A-Z][A-Z0-9_]+$/;
const PATTERN_DATE_COMPACT = /^\d{8}$/;
const PATTERN_DIGIT_CAPS = /^\d+[.,\-/%]*[A-Z]+$/;
const PATTERN_URL_STRICT = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/i;
const PATTERN_NUM_STRICT = /^-?\d+(\.\d+)?$/;
const PATTERN_URL = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;
const PATTERN_PHONE = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
const PATTERN_CAPITAL_SEQUENCES = /(?:^|[\s\[({>'"\-])([A-Z][\w]*(?:[\s\-]+[A-Z][\w]*)+)/g;
const PATTERN_ALL_CAPS_SINGLE = /(?:^|[\s\[({>'"\-])([A-Z0-9_]{2,})(?=$|[\s\])}<'".,?!\-])/g;

const STRUCTURAL_SEPARATORS = ['-', '_', '+', '=', '$', '/'];

const DEFAULT_SKIP_WORDS = new Set([
    'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by', 'for', 'with', 'without',
    'on', 'in', 'to', 'from', 'of', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'can',
    'get', 'set', 'let', 'make', 'go', 'come', 'see', 'look', 'know', 'think', 'say', 'tell',
    'ask', 'answer', 'help', 'use', 'used', 'using', 'need', 'want',
    'require', 'include', 'check', 'checking', 'investigate', 'investigating',
    'try', 'trying', 'run', 'running', 'investigation', 'review', 'reviewing', 'discuss', 'discussing', 'discussion',
    'could', 'may', 'might', 'must', 'a', 'an', 'the', 'it', 'this', 'that', 'these', 'those',
    'i', 'you', 'he', 'she', 'they', 'we', 'me', 'him', 'her', 'them', 'us', 'my', 'your', 'his',
    'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs', 'what', 'which', 'who', 'whom', 'whose',
    'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't',
    'just', 'don', 'now',
]);

// Mutable set so all importers see the same live instance after refreshSkipWords() runs.
const SKIP_WORDS = new Set(DEFAULT_SKIP_WORDS);

/**
 * Rebuild SKIP_WORDS in-place from the built-in defaults plus any extra words
 * configured under repoAsk.skipWords.  Call this on extension activation and
 * whenever the configuration changes.
 * @param {import('vscode')} vscode
 */
function refreshSkipWords(vscode: any) {
    const extra = (vscode && vscode.workspace.getConfiguration('repoAsk').get('skipWords')) || [];
    SKIP_WORDS.clear();
    for (const w of DEFAULT_SKIP_WORDS) SKIP_WORDS.add(w);
    if (Array.isArray(extra)) {
        for (const w of extra) {
            const word = String(w || '').toLowerCase().trim();
            if (word) SKIP_WORDS.add(word);
        }
    }
}

const PATTERNS = [
    ['EMAIL', PATTERN_EMAIL],
    ['OPTION_OSI', PATTERN_OPTION_OSI],
    ['UUID', PATTERN_UUID],
    ['ISIN', PATTERN_ISIN],
    ['LEI', PATTERN_LEI],
    ['FIGI', PATTERN_FIGI],
    ['CUSIP', PATTERN_CUSIP],
    ['SEDOL', PATTERN_SEDOL],
    ['DATE_ISO', PATTERN_DATE_ISO],
    ['DATE_COMMON', PATTERN_DATE_COMMON],
    ['DATE_COMPACT', PATTERN_DATE_COMPACT],
    ['PRICE', PATTERN_PRICE],
    ['NUM', PATTERN_NUM],
    ['QUANTITY', PATTERN_QUANTITY],
    ['TICKER', PATTERN_TICKER],
    ['ALL_CAPS', PATTERN_ALL_CAPS],
    ['DIGIT_CAPS', PATTERN_DIGIT_CAPS],
    ['URL_STRICT', PATTERN_URL_STRICT],
    ['NUM_STRICT', PATTERN_NUM_STRICT]
];

function patternTokenizer(text: any) {
    const rawText = String(text || '');
    if (!rawText.trim()) return [];

    // Note: camelCase and snake_case identifiers are handled with proper part-splitting
    // in tokenizeText (index.js). patternTokenizer covers all other structured patterns.
    const tokens: string[] = [];
    let match;

    for (const [, pattern] of PATTERNS) {
        const regex = new RegExp((pattern as RegExp).source, 'g');
        while ((match = regex.exec(rawText)) !== null) {
            let token = match[0];
            tokens.push(token);
        }
    }

    while ((match = PATTERN_URL.exec(rawText)) !== null) {
        tokens.push(match[0]);
    }

    while ((match = PATTERN_PHONE.exec(rawText)) !== null) {
        tokens.push(match[0]);
    }

    return tokens;
}

function extract_capital_sequences(text: any) {
    const sequences: string[] = [];
    
    let match;
    while ((match = PATTERN_CAPITAL_SEQUENCES.exec(text)) !== null) {
        sequences.push(match[1].trim());
    }
    
    while ((match = PATTERN_ALL_CAPS_SINGLE.exec(text)) !== null) {
        sequences.push(match[1].trim());
    }
    
    return [...new Set(sequences)];
}

function generate_structural_regex(text: any) {
    function get_char_type(char: any) {
        if (char.match(/\d/)) return 'digit';
        if (char.match(/[A-Z]/)) return 'upper';
        if (char.match(/[a-z]/)) return 'lower';
        return 'symbol';
    }

    const regex_parts: string[] = [];
    let current_type: string | null = null;
    let current_count = 0;
    let current_symbol_char = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const char_type = get_char_type(char);

        if (char_type === current_type) {
            current_count++;
        } else {
            if (current_type) {
                if (current_type === 'digit') {
                    regex_parts.push(`\\d${current_count > 1 ? `{${current_count}}` : ''}`);
                } else if (current_type === 'upper' || current_type === 'lower') {
                    regex_parts.push(`[A-Za-z]${current_count > 1 ? `{${current_count}}` : ''}`);
                } else {
                    const escaped_char = current_symbol_char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    regex_parts.push(`${escaped_char}${current_count > 1 ? `{${current_count}}` : ''}`);
                }
            }
            current_type = char_type;
            current_count = 1;
            current_symbol_char = char_type === 'symbol' ? char : '';
        }
    }

    if (current_type) {
        if (current_type === 'digit') {
            regex_parts.push(`\\d${current_count > 1 ? `{${current_count}}` : ''}`);
        } else if (current_type === 'upper' || current_type === 'lower') {
            regex_parts.push(`[A-Za-z]${current_count > 1 ? `{${current_count}}` : ''}`);
        } else {
            const escaped_char = current_symbol_char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            regex_parts.push(`${escaped_char}${current_count > 1 ? `{${current_count}}` : ''}`);
        }
    }

    return regex_parts.join('');
}

export { PATTERNS,
    PATTERN_URL_STRICT,
    PATTERN_NUM_STRICT,
    patternTokenizer,
    extract_capital_sequences,
    generate_structural_regex,
    STRUCTURAL_SEPARATORS,
    DEFAULT_SKIP_WORDS,
    SKIP_WORDS,
    refreshSkipWords
};

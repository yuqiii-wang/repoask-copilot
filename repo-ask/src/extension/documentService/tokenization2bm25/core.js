const { STOP_WORDS } = require('../tokenization2keywords/patternMatch');

function tokenize(text) {
    const rawText = String(text || '');
    if (!rawText.trim()) return [];

    let tokens = [];

    const sentences = rawText.split(/(?:[.!?\n]+)/).filter(s => s.trim().length > 0);
    for (const sentence of sentences) {
        const words = sentence.trim().split(/\s+/);
        for (let i = 0; i < words.length; i++) {
            let word = words[i];

            // Split camelCase / PascalCase BEFORE lowercasing — once lowercased the
            // boundary information is lost (e.g. getUserById → getuserbyid).
            const stripped = word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
            if (stripped.length > 2 && (/[a-z][A-Z]/.test(stripped) || /[A-Z]{2,}[a-z]/.test(stripped))) {
                const rawParts = stripped
                    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
                    .toLowerCase()
                    .split(/\s+/)
                    .filter(p => p.length > 0);
                if (rawParts.length >= 2) {
                    // Push the compound phrase so n-gram generation treats it as a unit
                    tokens.push(rawParts.join(' '));
                    rawParts.filter(p => p.length > 2 && !STOP_WORDS.has(p)).forEach(p => tokens.push(p));
                }
            }

            const cleanWord = word.toLowerCase()
                .replace(/^-+|-+$/g, '');
            if (cleanWord.length <= 2 || STOP_WORDS.has(cleanWord)) continue;

            tokens.push(cleanWord);

            // snake_case / SCREAMING_SNAKE: split on underscores
            if (cleanWord.includes('_')) {
                cleanWord.split(/_+/).filter(t => t.length > 2 && !STOP_WORDS.has(t))
                    .forEach(p => tokens.push(p));
            }

            // Split at , ; " and hyphens to create additional tokens
            const splitTokens = cleanWord.split(/[,;"\s-]+/).filter(t => t.length > 2 && !STOP_WORDS.has(t));
            splitTokens.forEach(token => tokens.push(token));
        }
    }

    return [...new Set(tokens)];
}


module.exports = { tokenize };

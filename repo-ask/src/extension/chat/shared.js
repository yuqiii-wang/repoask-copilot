/**
 * Shared utilities for chat functionality
 */

/**
 * Timeout duration for LLM responses in milliseconds
 * @constant {number}
 */
exports.LLM_RESPONSE_TIMEOUT_MS = 30000;

/**
 * Converts text to sentence case
 * @param {string} text - The text to convert
 * @returns {string} The text in sentence case
 */
exports.toSentenceCase = function toSentenceCase(text) {
    const value = String(text || '').trim();
    if (!value) {
        return '';
    }

    const normalized = value.endsWith('.') ? value : `${value}.`;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

/**
 * Emits a thinking progress message
 * @param {Object} response - The response object with a progress method
 * @param {string} message - The message to emit
 */
exports.emitThinking = function emitThinking(response, message) {
    response.progress(exports.toSentenceCase(message));
};

/**
 * Checks if an answer indicates no relevant documents were found
 * @param {string} text - The answer text to check
 * @returns {boolean} True if the answer indicates no relevant docs were found
 */
exports.looksLikeNotFoundAnswer = function looksLikeNotFoundAnswer(text) {
    const value = String(text || '').toLowerCase();
    if (!value) {
        return false;
    }

    return value.includes('not found in the provided context')
        || value.includes('not present in the provided context')
        || value.includes('not enough information in the provided context')
        || value.includes('cannot find this in the provided context')
        || value.includes('unable to find this in the provided context')
        || value.includes('i do not have enough context')
        || value.includes('insufficient context');
};

/**
 * Adds timeout functionality to a promise
 * @param {Promise} promise - The promise to add timeout to
 * @param {number} timeoutMs - The timeout duration in milliseconds
 * @param {*} timeoutValue - The value to return if timeout occurs
 * @returns {Promise} A promise that resolves with the original promise result or timeout value
 */
exports.withTimeout = async function withTimeout(promise, timeoutMs, timeoutValue = null) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(timeoutValue), timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
};
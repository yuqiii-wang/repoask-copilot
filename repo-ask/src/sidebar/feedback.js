// feedback.js

// Helper functions for banner notifications
function showBanner(bannerId, message) {
    const banner = document.getElementById(bannerId);
    const bannerMessage = banner.querySelector('.banner-message');
    if (banner && bannerMessage) {
        bannerMessage.textContent = message;
        banner.style.display = 'block';
    }
}

function hideBanner(bannerId) {
    const banner = document.getElementById(bannerId);
    if (banner) {
        banner.style.display = 'none';
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setButtonLoadingState(button, isLoading, label) {
    if (!button) {
        return;
    }

    if (isLoading) {
        if (!button.dataset.defaultLabel) {
            button.dataset.defaultLabel = label || button.textContent || '';
        }
        button.dataset.loadingLabel = label || button.dataset.defaultLabel || 'Working...';
        button.disabled = true;
        button.classList.add('is-loading');
        button.textContent = button.dataset.loadingLabel;
        button.setAttribute('aria-busy', 'true');
        return;
    }

    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    button.disabled = false;
    button.textContent = label || button.dataset.defaultLabel || button.textContent || '';
}

async function settleSubmitState(submitBtn, success, label) {
    if (!submitBtn) {
        return;
    }

    const startedAt = Number(submitBtn.dataset.loadingStartedAt || 0);
    const elapsed = startedAt > 0 ? (Date.now() - startedAt) : 0;
    const minVisibleMs = 350;
    const waitMs = Math.max(0, minVisibleMs - elapsed);
    if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    setButtonLoadingState(submitBtn, false, label);
    if (success) {
        submitBtn.disabled = true;
    }
}

function initFeedbackForm() {
    const feedbackSection = document.getElementById('feedback-section');
    const submitBtn = document.getElementById('submit-feedback-btn');
    const cancelBtn = document.getElementById('cancel-feedback-btn');
    const generateSummaryBtn = document.getElementById('generate-summary-btn');
    const datetimeInput = document.getElementById('datetime');
    
    // Set default datetime to current time
    const now = new Date();
    const formattedDate = now.toISOString().slice(0, 16);
    if (datetimeInput) {
        datetimeInput.value = formattedDate;
    }
    
    // Submit button handler
    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            hideBanner('success-banner');
            hideBanner('error-banner');

            const sourceQueryRaw = document.getElementById('source-query')?.value || '';
            const conversationSummaryRaw = document.getElementById('conversation-summary')?.value || '';
            const confluenceLinkRaw = document.getElementById('confluence-link')?.value || '';
            const datetimeRaw = document.getElementById('datetime')?.value || '';
            const tagsRaw = document.getElementById('tags')?.value || '';

            const sourceQuery = sourceQueryRaw.trim();
            const conversationSummary = conversationSummaryRaw.trim();
            const confluenceLink = confluenceLinkRaw.trim();
            const datetime = datetimeRaw.trim();
            const tags = tagsRaw.trim();
            
            // Validate input
            if (!conversationSummary) {
                showBanner('error-banner', 'Conversation Summary is required. Please paste or generate the full AI response before submitting.');
                return;
            }

            if (!sourceQuery || !datetime) {
                showBanner('error-banner', 'Please fill in all required fields: Source Query and Datetime');
                return;
            }
            
            // Disable submit button and show loading state
            setButtonLoadingState(submitBtn, true, 'Submit');
            submitBtn.dataset.loadingStartedAt = String(Date.now());
            
            // Yield one frame so the loading style paints before posting to the extension host.
            await new Promise((resolve) => requestAnimationFrame(resolve));
            
            // Create HTML-formatted feedback entry
            const feedbackEntry = `<div style="margin-top: 20px; padding: 10px; border-top: 1px solid #ddd;">
                <h3>Feedback Entry</h3>
                <p><strong>Source Query:</strong> ${escapeHtml(sourceQueryRaw)}</p>
                <p><strong>Conversation Summary:</strong></p>
                <pre style="white-space: pre-wrap; word-break: break-word; margin: 4px 0 10px;">${escapeHtml(conversationSummaryRaw)}</pre>
                <p><strong>Confluence Link:</strong> <a href="${escapeHtml(confluenceLink)}">${escapeHtml(confluenceLink)}</a></p>
                <p><strong>Datetime:</strong> ${escapeHtml(datetimeRaw)}</p>
                <p><strong>Tags:</strong> ${escapeHtml(tagsRaw)}</p>
            </div>`;
            
            try {
                // Send feedback to extension
                vscode.postMessage({ 
                    command: 'submitFeedback', 
                    feedbackEntry 
                });
            } catch (error) {
                console.error('Error submitting feedback:', error);
                showBanner('error-banner', 'Failed to submit feedback. Please try again.');
                // Re-enable submit button
                settleSubmitState(submitBtn, false, 'Submit');
            }
        });
    }
    
    // Cancel button handler
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (feedbackSection) {
                feedbackSection.style.display = 'none';
            }
            
            const viewerSection = document.querySelector('.viewer');
            if (viewerSection) {
                viewerSection.style.display = 'grid';
            }
        });
    }
    
    // Generate AI summary button handler
    if (generateSummaryBtn) {
        generateSummaryBtn.addEventListener('click', () => {
            hideBanner('success-banner');
            hideBanner('error-banner');

            const conversationSummary = document.getElementById('conversation-summary')?.value || '';
            if (!conversationSummary.trim()) {
                showBanner('error-banner', 'Please enter a conversation summary first');
                return;
            }
            
            // Show spinner and disable buttons
            setButtonLoadingState(generateSummaryBtn, true, 'Generate AI Summary');
            
            // Disable submit button
            const submitBtn = document.getElementById('submit-feedback-btn');
            if (submitBtn) {
                submitBtn.disabled = true;
            }
            
            // Send request to generate summary
            vscode.postMessage({ 
                command: 'generateSummary', 
                conversationSummary 
            });
        });
    }
}

// Function to show the feedback form
function showFeedbackForm(firstUserQuery, firstRankedDocUrl, fullAiResponse) {
    const feedbackSection = document.getElementById('feedback-section');
    const viewerSection = document.querySelector('.viewer');
    
    if (feedbackSection) {
        feedbackSection.style.display = 'block';
    }
    
    if (viewerSection) {
        viewerSection.style.display = 'none';
    }
    
    // Copy the first user query to the source query field
    if (firstUserQuery) {
        const sourceQueryField = document.getElementById('source-query');
        if (sourceQueryField) {
            sourceQueryField.value = firstUserQuery;
        }
    }
    
    // Copy the first ranked doc URL to the confluence link field
    if (firstRankedDocUrl) {
        const confluenceLinkField = document.getElementById('confluence-link');
        if (confluenceLinkField) {
            confluenceLinkField.value = firstRankedDocUrl;
        }
    }

    // Copy the full AI response into conversation summary when available.
    if (typeof fullAiResponse === 'string') {
        const summaryField = document.getElementById('conversation-summary');
        if (summaryField) {
            summaryField.value = fullAiResponse;
        }
    }
}

// Function to populate the summary field
function populateSummary(summary) {
    const summaryField = document.getElementById('conversation-summary');
    if (summaryField) {
        summaryField.value = summary;
    }
    
    // Reset the generate summary button
    const generateSummaryBtn = document.getElementById('generate-summary-btn');
    if (generateSummaryBtn) {
        setButtonLoadingState(generateSummaryBtn, false, 'Generate AI Summary');
    }
    
    // Re-enable submit button
    const submitBtn = document.getElementById('submit-feedback-btn');
    if (submitBtn) {
        submitBtn.disabled = false;
    }
}

// Expose functions to global scope
window.initFeedbackForm = initFeedbackForm;
window.showFeedbackForm = showFeedbackForm;
window.populateSummary = populateSummary;

// Handle messages from extension
window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.command === 'showFeedbackForm') {
        showFeedbackForm(message.firstUserQuery, message.firstRankedDocUrl, message.fullAiResponse);
    }
    if (message?.command === 'populateSummary') {
        populateSummary(String(message.summary || ''));
    }
    if (message?.command === 'feedbackSubmitted') {
                const success = message.success;
                const errorMessage = message.error;
                const submitBtn = document.getElementById('submit-feedback-btn');
                
                if (success) {
                    // Show success message
                    showBanner('success-banner', 'Feedback submitted successfully!');
                    
                    // Clear form
                    document.getElementById('source-query').value = '';
                    document.getElementById('conversation-summary').value = '';
                    document.getElementById('confluence-link').value = '';
                    document.getElementById('datetime').value = new Date().toISOString().slice(0, 16);
                    document.getElementById('tags').value = '';
                    
                    settleSubmitState(submitBtn, true, 'Submit');
                    
                    // Hide feedback section and restore original content after a short delay
                    setTimeout(() => {
                        const feedbackSection = document.getElementById('feedback-section');
                        if (feedbackSection) {
                            feedbackSection.style.display = 'none';
                        }
                        
                        const viewerSection = document.querySelector('.viewer');
                        if (viewerSection) {
                            viewerSection.style.display = 'grid';
                        }
                    }, 2000);
                } else {
                    // Show error message
                    showBanner('error-banner', errorMessage || 'Failed to submit feedback. Please try again.');
                    
                    // Re-enable submit button
                    settleSubmitState(submitBtn, false, 'Submit');
                }
            }
});
const RECENT_SCREENSHOT_MAX_AGE_MS = 15000;

function createRecentScreenshotStore(now = Date.now) {
    let latest = null;
    return {
        capture(data) {
            latest = { data, capturedAt: now() };
        },
        recent(maxAgeMs = RECENT_SCREENSHOT_MAX_AGE_MS) {
            return latest && now() - latest.capturedAt <= maxAgeMs ? latest.data : null;
        },
        clear() {
            latest = null;
        },
    };
}

function createOllamaUserMessage(text, screenshot) {
    return screenshot ? { role: 'user', content: text, images: [screenshot] } : { role: 'user', content: text };
}

function createOpenAiUserMessage(text, screenshot) {
    if (!screenshot) return { role: 'user', content: text };
    return {
        role: 'user',
        content: [
            { type: 'text', text },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } },
        ],
    };
}

function createGeminiParts(text, screenshot) {
    return screenshot ? [{ text }, { inlineData: { mimeType: 'image/jpeg', data: screenshot } }] : [{ text }];
}

module.exports = {
    RECENT_SCREENSHOT_MAX_AGE_MS,
    createRecentScreenshotStore,
    createOllamaUserMessage,
    createOpenAiUserMessage,
    createGeminiParts,
};

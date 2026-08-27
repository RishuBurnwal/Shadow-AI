const { PROVIDERS } = require('./providers.config');

const PROVIDER_DEFINITIONS = [...PROVIDERS];

const providerHealth = new Map();
const providerModelCache = new Map();
const activeProviderKeys = new Map();
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const PER_KEY_FAILURES = new Set(['credits_exhausted', 'rate_limited', 'auth_error']);

function isValidModelId(value) {
    const model = String(value || '').trim();
    return model.length > 0 && model.length <= 200 && /^[A-Za-z0-9._:/-]+$/.test(model);
}

function normalizeModelIds(values) {
    return [
        ...new Set(
            values
                .map(value =>
                    String(value || '')
                        .replace(/^models\//, '')
                        .trim()
                )
                .filter(isValidModelId)
        ),
    ].sort((a, b) => a.localeCompare(b));
}

async function fetchProviderModels(provider, fetchImpl = fetch) {
    if (provider.id === 'gemini') {
        const models = [];
        let pageToken = '';
        do {
            const query = new URLSearchParams({ pageSize: '1000' });
            if (pageToken) query.set('pageToken', pageToken);
            const modelsUrl = provider.modelsUrl || 'https://generativelanguage.googleapis.com/v1beta/models';
            const response = await fetchImpl(`${modelsUrl}?${query}`, {
                headers: { 'x-goog-api-key': provider.apiKey },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            for (const model of payload.models || []) {
                if ((model.supportedGenerationMethods || []).includes('generateContent')) models.push(model.name);
            }
            pageToken = payload.nextPageToken || '';
        } while (pageToken);
        return normalizeModelIds(models);
    }

    const response = await fetchImpl(provider.modelsUrl || `${provider.baseUrl}/models`, {
        headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            ...(provider.id === 'openrouter' ? { 'HTTP-Referer': 'https://shadow-ai.local', 'X-Title': 'Shadow AI' } : {}),
        },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return normalizeModelIds((payload.data || payload.models || []).map(model => model.id || model.name));
}

async function discoverProviderModels(providers, { fetchImpl = fetch, force = false } = {}) {
    const catalog = {};
    await Promise.all(
        providers.map(async provider => {
            const cached = providerModelCache.get(provider.id);
            if (!force && cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
                catalog[provider.id] = cached.models;
                return;
            }
            try {
                const models = await fetchProviderModels(provider, fetchImpl);
                if (!models.length) throw new Error('No compatible models returned');
                providerModelCache.set(provider.id, { models, fetchedAt: Date.now() });
                catalog[provider.id] = models;
            } catch {
                catalog[provider.id] = cached?.models?.length ? cached.models : provider.models;
            }
        })
    );
    return catalog;
}

function getCachedProviderModels(provider) {
    return providerModelCache.get(provider)?.models || null;
}

function classifyProviderFailure(error, status = 0) {
    const detail = `${String(error?.message || error || '')} ${String(error?.providerDetail || '')}`.toLowerCase();
    if (detail.includes('credit') || detail.includes('quota') || detail.includes('billing'))
        return { state: 'credits_exhausted', message: 'Credits exhausted' };
    if (status === 429 || detail.includes('429') || detail.includes('rate limit')) return { state: 'rate_limited', message: 'Rate limit hit' };
    if (status === 401 || status === 403 || detail.includes('401') || detail.includes('403') || detail.includes('api key')) {
        return { state: 'auth_error', message: 'Authentication failed' };
    }
    if (status >= 500 || /http 5\d\d/.test(detail)) return { state: 'server_error', message: 'Provider server error' };
    if (detail.includes('fetch') || detail.includes('network') || detail.includes('timeout') || detail.includes('econn')) {
        return { state: 'network_error', message: 'Network error' };
    }
    if (detail.includes('empty response')) return { state: 'empty_response', message: 'Empty response' };
    return { state: 'error', message: 'Unavailable' };
}

function markProviderSuccess(provider) {
    providerHealth.set(provider, { state: 'active', message: 'Active', updatedAt: Date.now() });
}

function markProviderFailure(provider, error, status = 0) {
    providerHealth.set(provider, { ...classifyProviderFailure(error, status), updatedAt: Date.now() });
}

function getProviderRuntimeStatus(configured = {}) {
    return Object.fromEntries(
        PROVIDER_DEFINITIONS.map(({ id }) => {
            if (!configured[id]) return [id, { configured: false, state: 'disabled', message: 'API key missing', updatedAt: null }];
            return [id, { configured: true, ...(providerHealth.get(id) || { state: 'enabled', message: 'Enabled', updatedAt: null }) }];
        })
    );
}

function getConfiguredProviders(env = process.env) {
    const configured = PROVIDER_DEFINITIONS.map(definition => {
        const apiKeys = Object.entries(env)
            .filter(([key, value]) => {
                const suffix = key.slice(definition.envKey.length);
                return (
                    String(value || '').trim() && (key === definition.envKey || (key.startsWith(`${definition.envKey}_`) && /^_\d+$/.test(suffix)))
                );
            })
            .sort(([a], [b]) => {
                const index = key => (key === definition.envKey ? 0 : Number(key.slice(definition.envKey.length + 1)));
                return index(a) - index(b);
            })
            .map(([, value]) => String(value).trim());
        if (!apiKeys.length) return null;
        const activeKeyIndex = Math.min(activeProviderKeys.get(definition.id) || 0, apiKeys.length - 1);
        return {
            ...definition,
            apiKeys,
            activeKeyIndex,
            apiKey: apiKeys[activeKeyIndex],
            model: env[definition.modelEnv] || definition.model,
            transport: definition.transport || 'openai',
        };
    }).filter(Boolean);

    const requested = String(env.SHADOW_AI_PROVIDER || 'auto').toLowerCase();
    if (requested === 'auto') return configured;
    const selected = configured.find(provider => provider.id === requested);
    if (!selected) return configured;
    return [selected, ...configured.filter(provider => provider.id !== requested)];
}

async function readSseText(response, onToken) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
                const payload = JSON.parse(data);
                const token = payload.choices?.[0]?.delta?.content || '';
                if (token) {
                    fullText += token;
                    onToken(token, fullText);
                }
            } catch {
                // Ignore provider keep-alives and malformed partial events.
            }
        }
        if (done) break;
    }
    return fullText;
}

// Timeout for hosted provider fetch calls (avoids hanging on stalled connections)
const PROVIDER_REQUEST_TIMEOUT_MS = 10000; // 10 seconds

async function streamWithFallback({
    providers,
    messages,
    onToken = () => {},
    onProviderFailure = () => {},
    onProviderSelected = () => {},
    fetchImpl = fetch,
    signal: externalSignal = null, // Optional external AbortSignal for barge-in cancellation
}) {
    const failures = [];
    const compatibleProviders = providers.filter(item => (item.transport || 'openai') === 'openai');
    for (let index = 0; index < compatibleProviders.length; index++) {
        const provider = compatibleProviders[index];
        const apiKeys = provider.apiKeys?.length ? provider.apiKeys : [provider.apiKey].filter(Boolean);
        const startKeyIndex = Math.min(provider.activeKeyIndex || 0, Math.max(0, apiKeys.length - 1));
        let lastError;
        for (let keyIndex = startKeyIndex; keyIndex < apiKeys.length; keyIndex++) {
            let response;
            let receivedText = '';
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS);
                // Merge with external signal (barge-in) — if either aborts, the request stops
                if (externalSignal) {
                    const onExternalAbort = () => controller.abort();
                    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
                    // Clean up listener if the internal controller fires first
                    controller.signal.addEventListener(
                        'abort',
                        () => {
                            externalSignal.removeEventListener('abort', onExternalAbort);
                        },
                        { once: true }
                    );
                }

                try {
                    response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
                        signal: controller.signal,
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${apiKeys[keyIndex]}`,
                            'Content-Type': 'application/json',
                            ...(provider.id === 'openrouter' ? { 'HTTP-Referer': 'https://shadow-ai.local', 'X-Title': 'Shadow AI' } : {}),
                        },
                        body: JSON.stringify({ model: provider.model, messages, stream: true, temperature: 0.7, max_tokens: 1024 }),
                    });
                    clearTimeout(timeoutId);
                } catch (fetchError) {
                    clearTimeout(timeoutId);
                    // Wrap AbortError into a user-friendly timeout message
                    if (fetchError.name === 'AbortError') {
                        const timeoutError = new Error('Request timed out after ' + PROVIDER_REQUEST_TIMEOUT_MS / 1000 + 's');
                        timeoutError.status = 408;
                        throw timeoutError;
                    }
                    throw fetchError;
                }
                if (!response.ok) {
                    const detail = (await response.text().catch(() => '')).slice(0, 500);
                    const providerError = new Error(`HTTP ${response.status}`);
                    providerError.status = response.status;
                    providerError.providerDetail = detail;
                    throw providerError;
                }
                const text = await readSseText(response, (token, fullText) => {
                    receivedText = fullText;
                    onToken(token, fullText);
                });
                if (!text.trim()) throw new Error('Empty response');
                activeProviderKeys.set(provider.id, keyIndex);
                markProviderSuccess(provider.id);
                onProviderSelected({ provider: provider.id, model: provider.model });
                return { provider: provider.id, model: provider.model, text };
            } catch (error) {
                if (receivedText.trim()) {
                    activeProviderKeys.set(provider.id, keyIndex);
                    markProviderSuccess(provider.id);
                    onProviderSelected({ provider: provider.id, model: provider.model });
                    return { provider: provider.id, model: provider.model, text: receivedText };
                }
                lastError = error;
                const classification = classifyProviderFailure(error, error.status || 0);
                markProviderFailure(provider.id, error, error.status || 0);
                failures.push({ provider: provider.id, error: error.message, state: classification.state });
                if (PER_KEY_FAILURES.has(classification.state) && keyIndex + 1 < apiKeys.length) {
                    activeProviderKeys.set(provider.id, keyIndex + 1);
                    continue;
                }
                break;
            }
        }
        if (lastError) {
            onProviderFailure({
                provider: provider.id,
                nextProvider: compatibleProviders[index + 1]?.id || null,
                reason: lastError.message,
            });
        }
    }
    const allKeysUnavailable = failures.length > 0 && failures.every(failure => PER_KEY_FAILURES.has(failure.state));
    const error = new Error(allKeysUnavailable ? 'All configured answer provider keys are unavailable' : 'All configured answer providers failed');
    error.failures = failures.map(({ provider, error: message }) => ({ provider, error: message }));
    throw error;
}

module.exports = {
    PROVIDER_DEFINITIONS,
    getConfiguredProviders,
    streamWithFallback,
    classifyProviderFailure,
    markProviderSuccess,
    markProviderFailure,
    getProviderRuntimeStatus,
    discoverProviderModels,
    getCachedProviderModels,
    isValidModelId,
};

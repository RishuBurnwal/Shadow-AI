const PROVIDER_DEFINITIONS = [
    {
        id: 'groq',
        envKey: 'GROQ_API_KEY',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelEnv: 'GROQ_MODEL',
        model: 'qwen/qwen3-32b',
        models: ['qwen/qwen3-32b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    },
    {
        id: 'openrouter',
        envKey: 'OPENROUTER_API_KEY',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelEnv: 'OPENROUTER_MODEL',
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],
    },
    {
        id: 'openai',
        envKey: 'OPENAI_API_KEY',
        baseUrl: 'https://api.openai.com/v1',
        modelEnv: 'OPENAI_MODEL',
        model: 'gpt-4o-mini',
        models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    },
    {
        id: 'perplexity',
        envKey: 'PERPLEXITY_API_KEY',
        baseUrl: 'https://api.perplexity.ai',
        modelEnv: 'PERPLEXITY_MODEL',
        model: 'sonar-pro',
        models: ['sonar-pro', 'sonar', 'sonar-deep-research'],
    },
    {
        id: 'nvidia',
        envKey: 'NVIDIA_API_KEY',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        modelEnv: 'NVIDIA_MODEL',
        model: 'meta/llama-3.1-70b-instruct',
        models: ['meta/llama-3.1-70b-instruct', 'meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct'],
    },
    {
        id: 'gemini',
        envKey: 'GEMINI_API_KEY',
        modelEnv: 'GEMINI_MODEL',
        model: 'gemini-2.5-flash',
        models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
        transport: 'google',
    },
];

const providerHealth = new Map();
const providerModelCache = new Map();
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeModelIds(values) {
    return [
        ...new Set(
            values
                .map(value =>
                    String(value || '')
                        .replace(/^models\//, '')
                        .trim()
                )
                .filter(value => value && value.length <= 200 && /^[A-Za-z0-9._:/-]+$/.test(value))
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
            const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models?${query}`, {
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

    const response = await fetchImpl(`${provider.baseUrl}/models`, {
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
    const configured = PROVIDER_DEFINITIONS.filter(definition => String(env[definition.envKey] || '').trim()).map(definition => ({
        ...definition,
        apiKey: String(env[definition.envKey]).trim(),
        model: env[definition.modelEnv] || definition.model,
        transport: definition.transport || 'openai',
    }));

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

async function streamWithFallback({
    providers,
    messages,
    onToken = () => {},
    onProviderFailure = () => {},
    onProviderSelected = () => {},
    fetchImpl = fetch,
}) {
    const failures = [];
    const compatibleProviders = providers.filter(item => (item.transport || 'openai') === 'openai');
    for (let index = 0; index < compatibleProviders.length; index++) {
        const provider = compatibleProviders[index];
        try {
            const response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${provider.apiKey}`,
                    'Content-Type': 'application/json',
                    ...(provider.id === 'openrouter' ? { 'HTTP-Referer': 'https://shadow-ai.local', 'X-Title': 'Shadow AI' } : {}),
                },
                body: JSON.stringify({ model: provider.model, messages, stream: true, temperature: 0.7, max_tokens: 1024 }),
            });
            if (!response.ok) {
                const detail = (await response.text().catch(() => '')).slice(0, 500);
                const providerError = new Error(`HTTP ${response.status}`);
                providerError.status = response.status;
                providerError.providerDetail = detail;
                throw providerError;
            }
            const text = await readSseText(response, onToken);
            if (!text.trim()) throw new Error('Empty response');
            markProviderSuccess(provider.id);
            onProviderSelected({ provider: provider.id, model: provider.model });
            return { provider: provider.id, model: provider.model, text };
        } catch (error) {
            markProviderFailure(provider.id, error, error.status || 0);
            const failure = { provider: provider.id, error: error.message };
            failures.push(failure);
            onProviderFailure({
                provider: provider.id,
                nextProvider: compatibleProviders[index + 1]?.id || null,
                reason: error.message,
            });
        }
    }
    const error = new Error('All configured answer providers failed');
    error.failures = failures;
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
};

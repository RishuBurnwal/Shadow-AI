const { PROVIDERS } = require('./providers.config');

const PROVIDER_DEFINITIONS = [...PROVIDERS];

const providerHealth = new Map();
const providerModelCache = new Map();
const activeProviderKeys = new Map();
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const PER_KEY_FAILURES = new Set(['credits_exhausted', 'no_credits', 'rate_limited', 'auth_invalid', 'auth_forbidden']);
const { randomUUID, createHash } = require('node:crypto');
const modelDiscoveryPending = new Map();
const { setTimeout: delay } = require('node:timers/promises');

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
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
            const payload = await response.json();
            for (const model of payload.models || []) {
                if ((model.supportedGenerationMethods || []).includes('generateContent')) models.push(model.name);
            }
            pageToken = payload.nextPageToken || '';
        } while (pageToken);
        return normalizeModelIds(models);
    }

    const response = await fetchImpl(provider.modelsUrl || `${provider.baseUrl}/models`, {
        signal: AbortSignal.timeout(8000),
        headers: {
            Authorization: `Bearer ${provider.apiKey}`,
        },
    });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    const payload = await response.json();
    return normalizeModelIds((payload.data || payload.models || []).map(model => model.id || model.name));
}

async function discoverProviderModels(providers, { fetchImpl = fetch, force = false } = {}) {
    const catalog = {};
    await Promise.all(
        providers.map(async provider => {
            const keyHash = createHash('sha256')
                .update((provider.apiKeys || [provider.apiKey || '']).join(','))
                .digest('hex');
            const cached = providerModelCache.get(provider.id);
            if (!force && cached?.keyHash === keyHash && Date.now() - cached.fetchedAt < (cached.failed ? 60000 : MODEL_CACHE_TTL_MS)) {
                catalog[provider.id] = cached.models;
                return;
            }
            const requestKey = `${provider.id}:${keyHash}`;
            if (!modelDiscoveryPending.has(requestKey)) {
                const request = (async () => {
                    let models,
                        failed = false;
                    try {
                        for (const apiKey of provider.apiKeys || [provider.apiKey]) {
                            try {
                                models = await fetchProviderModels({ ...provider, apiKey }, fetchImpl);
                                break;
                            } catch (error) {
                                if (![401, 402, 403, 429].includes(error.status)) throw error;
                            }
                        }
                        if (!models?.length) throw new Error('No compatible models returned');
                    } catch {
                        models = cached?.keyHash === keyHash && cached.models?.length ? cached.models : provider.models;
                        failed = true;
                    }
                    providerModelCache.set(provider.id, { models, fetchedAt: Date.now(), keyHash, failed });
                    return models;
                })().finally(() => modelDiscoveryPending.delete(requestKey));
                modelDiscoveryPending.set(requestKey, request);
            }
            catalog[provider.id] = await modelDiscoveryPending.get(requestKey);
        })
    );
    return catalog;
}

function getCachedProviderModels(provider) {
    return providerModelCache.get(provider)?.models || null;
}

function classifyProviderFailure(error, status = 0) {
    status = Number(status || error?.status || error?.statusCode || error?.response?.status || 0);
    const detail = `${error?.message || error || ''} ${error?.providerDetail || ''}`.toLowerCase();
    const result = (state, message, retryable = false) => ({ state, message, retryable });
    if (status === 401) return result('auth_invalid', 'Invalid API key');
    if (status === 402) return result('no_credits', 'Account has no credits');
    if (status === 403)
        return /region|geograph|country/.test(detail)
            ? result('geo_blocked', 'Model unavailable in your region')
            : result('auth_forbidden', 'Access forbidden');
    if (status === 404) return result('model_not_found', 'Model or endpoint not found');
    if (status === 408 || error?.name === 'TimeoutError' || error?.name === 'AbortError') return result('timeout', 'Request timed out', true);
    if (status === 429)
        return /insufficient_quota|exceeded.*quota|billing|credits/.test(detail)
            ? result('credits_exhausted', 'Provider quota exhausted')
            : result('rate_limited', 'Rate limit hit', true);
    if (status >= 500) return result('server_error', 'Provider server error', true);
    if (status >= 400) return result('invalid_request', 'Provider rejected the request');
    if (/fetch|network|timeout|econn|enotfound|eai_again/.test(detail)) return result('network_error', 'Network error', true);
    if (/credit|quota|billing/.test(detail)) return result('credits_exhausted', 'Provider quota exhausted');
    if (detail.includes('empty response')) return result('empty_response', 'Empty response', true);
    return result('error', 'Provider unavailable');
}

function safeProviderDetail(error, keys = []) {
    let detail = String(error?.providerDetail || error?.message || '').slice(0, 1000);
    try {
        const parsed = JSON.parse(detail);
        detail = parsed.error?.message || parsed.message || detail;
    } catch {}
    for (const key of keys) if (key) detail = detail.split(key).join('[redacted]');
    return detail.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
}

function markProviderSuccess(provider) {
    providerHealth.set(provider, { state: 'active', message: 'Active', failures: 0, updatedAt: Date.now() });
}

function markProviderFailure(provider, error, status = 0) {
    const failures = (providerHealth.get(provider)?.failures || 0) + 1;
    providerHealth.set(provider, {
        ...classifyProviderFailure(error, status),
        failures,
        cooldownUntil: failures >= 3 ? Date.now() + 60000 : 0,
        updatedAt: Date.now(),
    });
}

function getProviderRuntimeStatus(configured = {}) {
    return Object.fromEntries(
        PROVIDER_DEFINITIONS.map(({ id }) => {
            if (!configured[id]) return [id, { configured: false, state: 'disabled', message: 'API key missing', updatedAt: null }];
            return [id, { configured: true, ...(providerHealth.get(id) || { state: 'enabled', message: 'Enabled', updatedAt: null }) }];
        })
    );
}

function getConfiguredProviders(env = process.env, preferences = null) {
    const configured = PROVIDER_DEFINITIONS.map(definition => {
        const apiKeys = require('./apiKeys').providerApiKeys(env, definition.envKey);
        if (!apiKeys.length) return null;
        const enabled = preferences?.enabledProviderModels?.[definition.id];
        if (Array.isArray(enabled) && enabled.length === 0) return null;
        const selectedModel = env[definition.modelEnv] || definition.model;
        const resolvedModel = Array.isArray(enabled) && !enabled.includes(selectedModel) ? enabled[0] : selectedModel;
        const hasVision = model => /gemini|gpt-4o|gpt-4\.1|gpt-5|llama-4|vision|pixtral|qwen.*vl|qwen3\.[68]|gemma-3/i.test(model);
        const visionCandidate = env[definition.modelEnv.replace(/_MODEL$/, '_VISION_MODEL')] || definition.visionModel;
        // Respect removals for screenshots as well as text answers.
        const visionModel = hasVision(resolvedModel) ? resolvedModel : Array.isArray(enabled) ? enabled.find(hasVision) : visionCandidate;
        const activeKeyIndex = Math.min(activeProviderKeys.get(definition.id) || 0, apiKeys.length - 1);
        return {
            ...definition,
            apiKeys,
            activeKeyIndex,
            apiKey: apiKeys[activeKeyIndex],
            model: resolvedModel,
            vision: hasVision(resolvedModel),
            visionModel,
            transport: definition.transport || 'openai',
        };
    }).filter(Boolean);

    const requested = String(env.SHADOW_AI_PROVIDER || 'auto').toLowerCase();
    if (requested === 'auto') return configured;
    const selected = configured.find(provider => provider.id === requested);
    if (!selected) return configured;
    return [selected, ...configured.filter(provider => provider.id !== requested)];
}

async function readSseText(response, onToken, signal, onUsage) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '',
        fullText = '';
    const consume = line => {
        if (!line.trim().startsWith('data:')) return;
        const data = line.trim().slice(5).trim();
        if (!data || data === '[DONE]') return;
        let payload;
        try {
            payload = JSON.parse(data);
        } catch {
            return;
        }
        if (payload.error) throw new Error(payload.error.message || 'Provider stream failed');
        if (payload.usage) onUsage(payload.usage);
        if (payload.usageMetadata)
            onUsage({
                prompt_tokens: payload.usageMetadata.promptTokenCount,
                completion_tokens: (payload.usageMetadata.candidatesTokenCount || 0) + (payload.usageMetadata.thoughtsTokenCount || 0),
            });
        const token =
            payload.choices?.[0]?.delta?.content ||
            (payload.candidates?.[0]?.content?.parts || [])
                .filter(p => !p.thought)
                .map(p => p.text || '')
                .join('');
        if (token) {
            fullText += token;
            onToken(token, fullText);
        }
    };
    try {
        while (true) {
            signal?.throwIfAborted();
            const { done, value } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) consume(line);
            if (done) {
                if (buffer) consume(buffer);
                break;
            }
        }
    } finally {
        reader.releaseLock?.();
    }
    return fullText;
}

// The deadline includes reading the body, not just waiting for HTTP headers.
async function streamWithFallback({
    providers,
    messages,
    onToken = () => {},
    onProviderFailure = () => {},
    onProviderSelected = () => {},
    fetchImpl = fetch,
    signal: externalSignal = null,
    requestType = 'text',
    timeoutMs = 30000,
    totalTimeoutMs = 60000,
    maxTokens = 512,
    retryDelayMs = 300,
    googleSearch = false,
}) {
    const failures = [];
    const requestId = randomUUID();
    const deadline = AbortSignal.timeout(totalTimeoutMs);
    const outerSignal = externalSignal ? AbortSignal.any([externalSignal, deadline]) : deadline;
    const compatibleProviders = providers.filter(p => requestType !== 'vision' || p.vision || p.visionModel);
    for (let index = 0; index < compatibleProviders.length; index++) {
        const provider = compatibleProviders[index];
        externalSignal?.throwIfAborted();
        if (deadline.aborted) break;
        const health = providerHealth.get(provider.id);
        if (health?.cooldownUntil > Date.now()) {
            failures.push({ provider: provider.id, state: 'cooldown', detail: health.message });
            continue;
        }
        const apiKeys = provider.apiKeys?.length ? provider.apiKeys : [provider.apiKey].filter(Boolean);
        const start = (provider.activeKeyIndex || 0) % (apiKeys.length || 1);
        const model = requestType === 'vision' ? provider.visionModel || provider.model : provider.model;
        let lastError;
        for (let offset = 0; offset < apiKeys.length; offset++) {
            const keyIndex = (start + offset) % apiKeys.length;
            let rotateKey = false;
            for (let attempt = 0; attempt < (requestType === 'vision' ? 2 : 1); attempt++) {
                let receivedText = '',
                    usage = null;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
                const signal = AbortSignal.any([outerSignal, controller.signal]);
                try {
                    signal.throwIfAborted();
                    console.log(`[${requestId}] trying ${provider.id} (${model})`);
                    // Google's documented OpenAI compatibility endpoint shares this text/vision contract.
                    // Native Google transport is still used separately for Live audio.
                    const baseUrl = provider.transport === 'google' ? 'https://generativelanguage.googleapis.com/v1beta/openai' : provider.baseUrl;
                    const grounded = provider.transport === 'google' && googleSearch;
                    const nativeBody = grounded
                        ? {
                              systemInstruction: {
                                  parts: [
                                      {
                                          text: messages
                                              .filter(m => m.role === 'system')
                                              .map(m => m.content)
                                              .join('\n'),
                                      },
                                  ],
                              },
                              contents: messages
                                  .filter(m => m.role !== 'system')
                                  .map(m => ({
                                      role: m.role === 'assistant' ? 'model' : 'user',
                                      parts:
                                          typeof m.content === 'string'
                                              ? [{ text: m.content }]
                                              : m.content.map(part =>
                                                    part.type === 'text'
                                                        ? { text: part.text }
                                                        : { inlineData: { mimeType: 'image/jpeg', data: part.image_url.url.split(',')[1] } }
                                                ),
                                  })),
                              tools: [{ googleSearch: {} }],
                              generationConfig: { maxOutputTokens: maxTokens },
                          }
                        : null;
                    const endpoint = grounded
                        ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
                        : `${baseUrl}/chat/completions`;
                    const response = await fetchImpl(endpoint, {
                        signal,
                        method: 'POST',
                        headers: {
                            ...(grounded ? { 'x-goog-api-key': apiKeys[keyIndex] } : { Authorization: `Bearer ${apiKeys[keyIndex]}` }),
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(
                            nativeBody || {
                                model,
                                messages,
                                stream: provider.stream !== false,
                                temperature: 0.7,
                                max_tokens: maxTokens,
                                ...(provider.id === 'nvidia' && /nemotron-3\.5-lightning/.test(model)
                                    ? { chat_template_kwargs: { enable_thinking: false } }
                                    : {}),
                                ...(provider.id === 'groq' && /^qwen\/qwen3/.test(model) ? { reasoning_effort: 'none' } : {}),
                                ...(provider.id === 'groq' && /^openai\/gpt-oss/.test(model)
                                    ? { reasoning_effort: 'low', include_reasoning: false }
                                    : {}),
                                ...(provider.stream !== false ? { stream_options: { include_usage: true } } : {}),
                            }
                        ),
                    });
                    if (!response.ok) {
                        const error = new Error(`HTTP ${response.status}`);
                        error.status = response.status;
                        error.providerDetail = (await response.text()).slice(0, 1000);
                        throw error;
                    }
                    let text;
                    if (provider.stream === false) {
                        const payload = await response.json();
                        usage = payload.usage;
                        text = String(payload.choices?.[0]?.message?.content || '');
                        if (text) {
                            receivedText = text;
                            onToken(text, text);
                        }
                    } else
                        text = await readSseText(
                            response,
                            (token, full) => {
                                receivedText = full;
                                onToken(token, full);
                            },
                            signal,
                            value => {
                                usage = value;
                            }
                        );
                    signal.throwIfAborted();
                    if (!text.trim()) throw new Error('Empty response');
                    activeProviderKeys.set(provider.id, keyIndex);
                    markProviderSuccess(provider.id);
                    onProviderSelected({ provider: provider.id, model });
                    return { provider: provider.id, model, text, usage, requestId };
                } catch (error) {
                    externalSignal?.throwIfAborted();
                    lastError = error;
                    const classification = classifyProviderFailure(error);
                    const detail = safeProviderDetail(error, apiKeys);
                    // Never restart a partially displayed answer on another provider.
                    if (receivedText.trim()) {
                        markProviderFailure(provider.id, error);
                        return { provider: provider.id, model, text: receivedText, usage, partial: true, warning: detail, requestId };
                    }
                    if (classification.retryable && attempt === 0 && requestType === 'vision' && !outerSignal.aborted) {
                        try {
                            await delay(retryDelayMs + Math.floor(Math.random() * retryDelayMs), undefined, { signal: outerSignal });
                            continue;
                        } catch {
                            externalSignal?.throwIfAborted();
                        }
                    }
                    failures.push({ provider: provider.id, state: classification.state, detail: `${classification.message}: ${detail}` });
                    rotateKey = PER_KEY_FAILURES.has(classification.state);
                    break;
                } finally {
                    clearTimeout(timeout);
                }
            }
            if (!rotateKey || outerSignal.aborted) break;
        }
        if (lastError) {
            markProviderFailure(provider.id, lastError);
            onProviderFailure({
                provider: provider.id,
                nextProvider: compatibleProviders[index + 1]?.id || null,
                reason: failures.at(-1)?.detail || 'Request failed',
            });
        }
    }
    externalSignal?.throwIfAborted();
    const error = new Error(
        failures.length
            ? failures.map(f => `${f.provider}: ${f.detail}`).join('; ')
            : deadline.aborted
              ? 'Answer request timed out'
              : requestType === 'vision'
                ? 'No vision-capable provider configured. Configure a vision model in Settings.'
                : 'No answer provider configured. Add an API key in Settings.'
    );
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
    isValidModelId,
};

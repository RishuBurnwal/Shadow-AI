const PROVIDER_DEFINITIONS = [
    { id: 'groq', envKey: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', modelEnv: 'GROQ_MODEL', model: 'qwen/qwen3-32b' },
    {
        id: 'openrouter',
        envKey: 'OPENROUTER_API_KEY',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelEnv: 'OPENROUTER_MODEL',
        model: 'openai/gpt-4o-mini',
    },
    { id: 'openai', envKey: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1', modelEnv: 'OPENAI_MODEL', model: 'gpt-4o-mini' },
    {
        id: 'perplexity',
        envKey: 'PERPLEXITY_API_KEY',
        baseUrl: 'https://api.perplexity.ai',
        modelEnv: 'PERPLEXITY_MODEL',
        model: 'sonar-pro',
    },
    {
        id: 'nvidia',
        envKey: 'NVIDIA_API_KEY',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        modelEnv: 'NVIDIA_MODEL',
        model: 'meta/llama-3.1-70b-instruct',
    },
    { id: 'gemma', envKey: 'GEMINI_API_KEY', modelEnv: 'GEMMA_MODEL', model: 'gemma-3-27b-it', transport: 'google' },
];

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
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await readSseText(response, onToken);
            if (!text.trim()) throw new Error('Empty response');
            onProviderSelected({ provider: provider.id, model: provider.model });
            return { provider: provider.id, model: provider.model, text };
        } catch (error) {
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

module.exports = { PROVIDER_DEFINITIONS, getConfiguredProviders, streamWithFallback };

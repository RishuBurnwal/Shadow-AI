const test = require('node:test');
const assert = require('node:assert/strict');

const { getConfiguredProviders, isValidModelId, streamWithFallback } = require('../src/utils/providerRouter');

test('keeps a live-discovered model selection for a configured provider', () => {
    const providers = getConfiguredProviders({
        GEMINI_API_KEY: 'test-key',
        GEMINI_MODEL: 'gemini-3.6-flash',
    });

    assert.equal(providers[0].model, 'gemini-3.6-flash');
});

test('accepts only safe provider model identifiers', () => {
    assert.equal(isValidModelId('openai/gpt-4.1-mini'), true);
    assert.equal(isValidModelId('model\nvalue'), false);
});

test('uses only the selected provider outside auto mode', () => {
    const providers = getConfiguredProviders({
        SHADOW_AI_PROVIDER: 'nvidia',
        NVIDIA_API_KEY: 'nvidia-key',
        GROQ_API_KEY: 'groq-key',
    });

    assert.deepEqual(
        providers.map(provider => provider.id),
        ['nvidia']
    );
});

test('keeps a provider response instead of falling back after it starts streaming', async () => {
    let calls = 0;
    const result = await streamWithFallback({
        providers: [
            { id: 'first', baseUrl: 'https://first.test', apiKey: 'key', model: 'one', transport: 'openai' },
            { id: 'second', baseUrl: 'https://second.test', apiKey: 'key', model: 'two', transport: 'openai' },
        ],
        fetchImpl: async () => ({
            ok: true,
            body: {
                getReader: () => ({
                    read: async () => {
                        calls += 1;
                        if (calls === 1)
                            return { done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n') };
                        throw new Error('connection closed');
                    },
                }),
            },
        }),
    });

    assert.equal(result.provider, 'first');
    assert.equal(result.text, 'answer');
});

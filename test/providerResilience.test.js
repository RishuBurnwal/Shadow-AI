const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
    streamWithFallback,
    classifyProviderFailure,
    getConfiguredProviders,
    markProviderFailure,
    markProviderSuccess,
} = require('../src/utils/providerRouter');
const provider = (id, extra = {}) => ({ id, apiKey: 'secret', model: 'test', baseUrl: 'https://example.test', ...extra });
const success = () =>
    new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":1}}', {
        status: 200,
    });
for (const [status, detail, expected] of [
    [401, 'quota documentation', 'auth_invalid'],
    [403, 'billing settings', 'auth_forbidden'],
    [404, 'check quota', 'model_not_found'],
    [402, 'no funds', 'no_credits'],
    [403, 'unsupported region', 'geo_blocked'],
    [429, 'slow down', 'rate_limited'],
    [429, 'insufficient_quota', 'credits_exhausted'],
    [503, 'quota service down', 'server_error'],
]) {
    test(`classifies HTTP ${status} ${expected} before incidental text`, () =>
        assert.equal(classifyProviderFailure({ status, providerDetail: detail }).state, expected));
}
test('preserves mixed errors and redacts credentials', async () => {
    let n = 0;
    await assert.rejects(
        streamWithFallback({
            providers: [provider('bad-model'), provider('bad-auth')],
            messages: [],
            fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'secret denied' } }), { status: ++n === 1 ? 404 : 401 }),
        }),
        error =>
            error.message.includes('Model or endpoint not found') &&
            error.message.includes('Invalid API key') &&
            !error.message.includes('secret') &&
            error.failures.length === 2
    );
});
test('vision skips text-only providers, retries transient failures and falls back', async () => {
    const calls = [];
    const result = await streamWithFallback({
        providers: [provider('text-only'), provider('vision-broken', { vision: true }), provider('vision-ok', { vision: true })],
        messages: [],
        requestType: 'vision',
        retryDelayMs: 0,
        fetchImpl: async (url, request) => {
            calls.push(request.headers.Authorization);
            return calls.length <= 2 ? new Response('down', { status: 503 }) : success();
        },
    });
    assert.equal(result.provider, 'vision-ok');
    assert.equal(calls.length, 3);
});
test('reads fragmented SSE and a final event without a newline, including usage', async () => {
    const encoded = new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"héllo"}}]}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":2}}'
    );
    let i = 0;
    const result = await streamWithFallback({
        providers: [provider('chunks')],
        messages: [],
        fetchImpl: async () =>
            new Response(
                new ReadableStream({
                    pull(controller) {
                        if (i === encoded.length) controller.close();
                        else controller.enqueue(encoded.slice(i, (i += 1)));
                    },
                })
            ),
    });
    assert.equal(result.text, 'héllo');
    assert.equal(result.usage.prompt_tokens, 12);
});
test('pre-aborted calls make zero network requests', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await assert.rejects(
        streamWithFallback({
            providers: [provider('aborted')],
            messages: [],
            signal: controller.signal,
            fetchImpl: async () => {
                calls++;
                return success();
            },
        }),
        { name: 'AbortError' }
    );
    assert.equal(calls, 0);
});
test('abort during streaming never retries or returns partial success', async () => {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(
        streamWithFallback({
            providers: [provider('abort-stream'), provider('unused')],
            messages: [],
            signal: controller.signal,
            onToken: () => controller.abort(),
            fetchImpl: async () => {
                calls++;
                return success();
            },
        }),
        { name: 'AbortError' }
    );
    assert.equal(calls, 1);
});
test('rotates all numbered keys including wrapping to earlier keys', async () => {
    const keys = [];
    const result = await streamWithFallback({
        providers: [provider('rotation', { apiKeys: ['first', 'second'], activeKeyIndex: 1 })],
        messages: [],
        fetchImpl: async (url, request) => {
            keys.push(request.headers.Authorization);
            return keys.length === 1 ? new Response('invalid', { status: 401 }) : success();
        },
    });
    assert.deepEqual(keys, ['Bearer second', 'Bearer first']);
    assert.equal(result.text, 'OK');
});
test('Gemini participates using its documented compatibility endpoint', async () => {
    let endpoint;
    const result = await streamWithFallback({
        providers: [provider('gemini', { transport: 'google' })],
        messages: [],
        fetchImpl: async url => {
            endpoint = url;
            return success();
        },
    });
    assert.equal(endpoint, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(result.provider, 'gemini');
});
test('three failures open a circuit and success resets it', async () => {
    for (let i = 0; i < 3; i++) markProviderFailure('cooling', { status: 503 });
    let calls = 0;
    await assert.rejects(
        streamWithFallback({
            providers: [provider('cooling')],
            messages: [],
            fetchImpl: async () => {
                calls++;
                return success();
            },
        }),
        /cooling/
    );
    assert.equal(calls, 0);
    markProviderSuccess('cooling');
    await streamWithFallback({
        providers: [provider('cooling')],
        messages: [],
        fetchImpl: async () => {
            calls++;
            return success();
        },
    });
    assert.equal(calls, 1);
});
test('real HTTP connection with headers but stalled body times out', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.flushHeaders();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        await assert.rejects(
            streamWithFallback({
                providers: [provider('stall', { baseUrl: `http://127.0.0.1:${server.address().port}` })],
                messages: [],
                timeoutMs: 80,
                totalTimeoutMs: 500,
            }),
            /timed out|abort/i
        );
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
test('disabled numbered keys are excluded', () => {
    const providers = getConfiguredProviders({ GROQ_API_KEY_1: '#disabled', GROQ_API_KEY_2: 'active' });
    assert.deepEqual(providers[0].apiKeys, ['active']);
});
test('Gemini search setting sends native grounding tools and converts usage', async () => {
    let body;
    let url;
    const result = await streamWithFallback({
        providers: [provider('google-search', { transport: 'google' })],
        messages: [
            { role: 'system', content: 'Be concise' },
            { role: 'user', content: 'Search the web' },
        ],
        googleSearch: true,
        fetchImpl: async (endpoint, request) => {
            url = endpoint;
            body = JSON.parse(request.body);
            assert.equal(request.headers['x-goog-api-key'], 'secret');
            return new Response(
                'data: {"candidates":[{"content":{"parts":[{"text":"Found it"}]}}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":3}}\n\n'
            );
        },
    });
    assert.match(url, /streamGenerateContent/);
    assert.deepEqual(body.tools, [{ googleSearch: {} }]);
    assert.equal(result.text, 'Found it');
    assert.equal(result.usage.prompt_tokens, 12);
});
test('Groq Qwen disables paid reasoning for concise answers', async () => {
    await streamWithFallback({
        providers: [provider('groq', { model: 'qwen/qwen3.6-27b' })],
        messages: [],
        fetchImpl: async (_, request) => {
            const body = JSON.parse(request.body);
            assert.equal(body.reasoning_effort, 'none');
            assert.equal(body.max_tokens, 512);
            return success();
        },
    });
});
test('model discovery coalesces concurrent polls and caches failed probes', async () => {
    const { discoverProviderModels } = require('../src/utils/providerRouter');
    let calls = 0;
    const providers = [provider('catalog-audit', { models: ['fallback'] })];
    const fetchImpl = async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return new Response('unavailable', { status: 503 });
    };
    const [a, b] = await Promise.all([discoverProviderModels(providers, { fetchImpl }), discoverProviderModels(providers, { fetchImpl })]);
    assert.deepEqual(a, b);
    await discoverProviderModels(providers, { fetchImpl });
    assert.equal(calls, 1);
    await discoverProviderModels([{ ...providers[0], apiKey: 'changed' }], { fetchImpl });
    assert.equal(calls, 2);
});

test('NVIDIA Lightning answers without spending its output budget on hidden thinking', async () => {
    await streamWithFallback({
        providers: [provider('nvidia', { model: 'nvidia/nemotron-3.5-lightning-30b-a3b' })],
        messages: [],
        fetchImpl: async (_, request) => {
            assert.deepEqual(JSON.parse(request.body).chat_template_kwargs, { enable_thinking: false });
            return success();
        },
    });
});

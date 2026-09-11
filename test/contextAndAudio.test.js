const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve, userContext, MODES } = require('../src/utils/contextPolicy');
const { providerApiKeys } = require('../src/utils/apiKeys');
const { getConfiguredProviders, streamWithFallback } = require('../src/utils/providerRouter');
const { pcmToWav, transcribeAudio, createAudioSession } = require('../src/utils/audioProviders');

test('mode defaults separate interview background from quiz and unrelated modes', () => {
    const prefs = { jobDescription: 'SECRET JD', additionalContext: 'SECRET CONTEXT' };
    assert.equal(resolve(prefs, 'interview').screen, 'manual');
    assert.match(userContext(prefs, resolve(prefs, 'interview')), /SECRET JD/);
    for (const mode of MODES.filter(mode => mode !== 'interview')) {
        assert.equal(resolve(prefs, mode).resume, false);
        assert.equal(resolve(prefs, mode).jd, false);
        assert.doesNotMatch(userContext(prefs, resolve(prefs, mode)), /SECRET JD/);
    }
    assert.equal(resolve(prefs, 'quiz').audio, false);
    assert.equal(userContext(prefs, resolve(prefs, 'quiz')), '');
});
test('saved profiles override only their own mode and survive serialization', () => {
    const prefs = JSON.parse(
        JSON.stringify({
            activeContextProfiles: { quiz: 'one', interview: 'one' },
            contextProfiles: [{ id: 'one', name: 'Practice', mode: 'quiz', rules: { screen: 'manual', skills: false } }],
        })
    );
    assert.equal(resolve(prefs, 'quiz').screen, 'manual');
    assert.equal(resolve(prefs, 'quiz').skills, false);
    assert.equal(resolve(prefs, 'interview').skills, true);
});
test('every provider supports comma lists plus numbered keys, trimmed and deduplicated', () => {
    for (const envKey of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'NVIDIA_API_KEY', 'PERPLEXITY_API_KEY']) {
        const env = { [envKey]: 'bad, good,good, , #disabled', [`${envKey}_2`]: 'good,third' };
        assert.deepEqual(providerApiKeys(env, envKey), ['bad', 'good', 'third']);
        assert.deepEqual(getConfiguredProviders(env)[0].apiKeys, ['bad', 'good', 'third']);
    }
});
test('text request rotates a comma-separated rejected key before provider fallback', async () => {
    const seen = [];
    const result = await streamWithFallback({
        providers: getConfiguredProviders({ GROQ_API_KEY: 'bad,good' }),
        messages: [],
        fetchImpl: async (_, request) => {
            seen.push(request.headers.Authorization);
            return request.headers.Authorization === 'Bearer bad'
                ? new Response('invalid key', { status: 401 })
                : new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n');
        },
    });
    assert.equal(result.text, 'OK');
    assert.deepEqual(seen, ['Bearer bad', 'Bearer good']);
});
test('speech retries keys and sends WAV only to the audio endpoint', async () => {
    const seen = [];
    const result = await transcribeAudio(Buffer.alloc(4800), {
        providers: getConfiguredProviders({ OPENAI_API_KEY: 'bad,good' }),
        fetchImpl: async (url, request) => {
            assert.match(url, /audio\/transcriptions$/);
            assert.equal(request.body.get('model'), 'gpt-4o-mini-transcribe');
            assert.equal((await request.body.get('file').arrayBuffer()).byteLength, 4844);
            seen.push(request.headers.Authorization);
            return request.headers.Authorization === 'Bearer bad' ? new Response('', { status: 401 }) : Response.json({ text: 'hello' });
        },
    });
    assert.equal(result.text, 'hello');
    assert.equal(seen.length, 2);
    assert.equal(pcmToWav(Buffer.alloc(2)).toString('ascii', 0, 4), 'RIFF');
});
test('audio buffers skip silence, preserve source labels and suppress results after close', async () => {
    const results = [];
    let calls = 0;
    const session = createAudioSession({
        onTranscript: (text, source) => results.push([text, source]),
        onError: error => {
            throw error;
        },
        transcribe: async () => {
            calls++;
            return { text: 'question', provider: 'test' };
        },
    });
    for (let i = 0; i < 20; i++) session.push(Buffer.alloc(4800), 'mic');
    await session.drain();
    assert.equal(calls, 0);
    const speech = Buffer.alloc(4800);
    for (let i = 0; i < speech.length; i += 2) speech.writeInt16LE(1200, i);
    for (let i = 0; i < 5; i++) session.push(speech, 'mic');
    for (let i = 0; i < 8; i++) session.push(Buffer.alloc(4800), 'mic');
    await session.drain();
    assert.deepEqual(results, [['question', 'mic']]);
    session.close();
    session.push(speech);
    await session.drain();
    assert.equal(calls, 1);
});

test('catalog discovery rotates rejected keys instead of hiding accessible models', async () => {
    const { discoverProviderModels } = require('../src/utils/providerRouter');
    let attempts = 0;
    const catalog = await discoverProviderModels(getConfiguredProviders({ GROQ_API_KEY: 'expired,working' }), {
        force: true,
        fetchImpl: async (_, options) => {
            attempts++;
            return options.headers.Authorization === 'Bearer expired'
                ? new Response('', { status: 401 })
                : Response.json({ data: [{ id: 'verified-chat' }] });
        },
    });
    assert.equal(attempts, 2);
    assert.deepEqual(catalog.groq, ['verified-chat']);
});

test('closing during in-flight transcription prevents late text from reaching a new session', async () => {
    let finish;
    let started;
    const ready = new Promise(resolve => (started = resolve));
    const output = [];
    const session = createAudioSession({
        onTranscript: text => output.push(text),
        onError() {},
        transcribe: () => {
            started();
            return new Promise(resolve => (finish = resolve));
        },
    });
    const pcm = Buffer.alloc(24000);
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(1000, i);
    session.push(pcm);
    session.push(Buffer.alloc(48000));
    await ready;
    session.close();
    finish({ text: 'stale', provider: 'test' });
    await session.drain();
    assert.deepEqual(output, []);
});

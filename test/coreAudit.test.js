const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-audit-'));
process.env.SHADOW_AI_CONFIG_DIR = config;
process.env.SHADOW_AI_ENV_PATH = path.join(config, '.env');
fs.writeFileSync(process.env.SHADOW_AI_ENV_PATH, '');
const storage = require('../src/storage');
const { routeAudioChunk } = require('../src/utils/audioRouting');
const { createSttEngineManager } = require('../src/utils/sttEngineManager');
const { createTurnDebouncer } = require('../src/utils/turnDebouncer');
const { createRecentScreenshotStore } = require('../src/utils/multimodal');
test.after(() => fs.rmSync(config, { recursive: true, force: true }));
test('obsolete provider preferences are removed without losing supported selections', () => {
    storage.updatePreference('providerModels', { obsolete: 'old', nvidia: 'current' });
    storage.updatePreference('enabledProviderModels', { obsolete: ['old'], groq: [] });
    storage.updatePreference('answerProvider', 'obsolete');
    const preferences = storage.getPreferences();
    assert.deepEqual(preferences.providerModels, { nvidia: 'current' });
    assert.deepEqual(preferences.enabledProviderModels, { groq: [] });
    assert.equal(preferences.answerProvider, 'default');
});
for (const [mode, expected] of [
    ['mic_only', ['mic']],
    ['speaker_only', ['speaker']],
    ['both', ['speaker', 'mic']],
])
    test('audio mode ' + mode + ' routes only selected sources', () => {
        const delivered = [];
        for (const source of ['speaker', 'mic', 'invalid']) routeAudioChunk(mode, source, Buffer.alloc(2), v => delivered.push(v.source));
        assert.deepEqual(delivered, expected);
    });
test('recent screenshot expires and clear removes it', () => {
    let now = 0;
    const store = createRecentScreenshotStore(() => now);
    store.capture('image');
    assert.equal(store.recent(), 'image');
    now = 15001;
    assert.equal(store.recent(), null);
    store.capture('new');
    store.clear();
    assert.equal(store.recent(), null);
});
test('STT retries once and switches engines after inference failure', async () => {
    let attempts = 0;
    const manager = createSttEngineManager(
        [
            {
                name: 'broken',
                load: async () => ({
                    name: 'broken',
                    transcribe: async () => {
                        attempts++;
                        throw Error('failed');
                    },
                }),
            },
            { name: 'backup', load: async () => ({ name: 'backup', transcribe: async () => 'spoken words' }) },
        ],
        { logger: { log() {}, warn() {} } }
    );
    assert.equal(await manager.transcribe(new Float32Array(8)), 'spoken words');
    assert.equal(attempts, 2);
    assert.equal(manager.activeName(), 'backup');
});
test('STT load timeout advances to next engine', async () => {
    const manager = createSttEngineManager(
        [
            { name: 'stalled', timeoutMs: 10, load: () => new Promise(() => {}) },
            { name: 'backup', load: async () => ({ transcribe: async () => 'ok' }) },
        ],
        { logger: { log() {}, warn() {} } }
    );
    assert.equal(await manager.transcribe([]), 'ok');
});
test('debouncer combines fragments once and clear cancels pending work', async () => {
    const d = createTurnDebouncer(10);
    const calls = [];
    d.schedule('hello', s => calls.push(s));
    d.schedule('world', s => calls.push(s));
    await new Promise(r => setTimeout(r, 30));
    assert.deepEqual(calls, ['hello world']);
    d.schedule('cancelled', s => calls.push(s));
    d.clear();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(calls.length, 1);
});
test('storage records provider-reported tokens separately from character estimates', () => {
    storage.initializeStorage();
    storage.incrementCharUsage('openai', 'model', 12);
    storage.recordTokenUsage('openai', 'model', { prompt_tokens: 100, completion_tokens: 10 });
    const data = storage.getTodayLimits();
    assert.equal(data.openai.model.chars, 12);
    assert.deepEqual(data.tokenUsage['openai/model'], { input: 100, output: 10, requests: 1 });
});
test('session paths reject directory traversal', () => {
    assert.throws(() => storage.getSession('../outside'));
});
test('no secure keychain means profile and memory writes fail without plaintext files', () => {
    assert.throws(() => require('../src/soul').setProfile({ name: 'Private' }), /Secure profile/);
    assert.throws(() => require('../src/memory').saveMemory([{ fact: 'Private' }]), /Secure memory/);
    assert.equal(fs.existsSync(path.join(config, 'profile.json')), false);
    assert.equal(fs.existsSync(path.join(config, 'memory.json')), false);
});
test('large resume prompt remains bounded and omits canned fabricated experience examples', () => {
    fs.writeFileSync(path.join(config, 'profile.json'), JSON.stringify({ name: 'Synthetic', resumeText: 'x'.repeat(50000) }));
    const prompt = require('../src/utils/prompts').getSystemPrompt('interview', 'y'.repeat(20000), false);
    assert.ok(prompt.length <= 22000);
    assert.ok(!prompt.includes('5 years of experience building scalable'));
    assert.ok(prompt.includes('OUTPUT INSTRUCTIONS'));
});
test('local send failures are not reported as success without a session', async () => {
    const local = require('../src/utils/localai');
    assert.equal((await local.sendLocalText('hello')).success, false);
    assert.equal((await local.sendLocalImage('image', 'describe')).success, false);
});
test('PDF input rejects oversized or non-PDF content', async () => {
    const { extractResumePdf } = require('../src/skills/resumePdf');
    await assert.rejects(extractResumePdf(Buffer.from('not a PDF')), /valid PDF/);
    await assert.rejects(extractResumePdf(Buffer.alloc(11 * 1024 * 1024)), /10 MB/);
});

test('legacy font size is normalized to pixels and bounded', () => {
    storage.updatePreference('fontSize', 'medium');
    assert.equal(storage.getPreferences().fontSize, 20);
    storage.updatePreference('fontSize', 999);
    assert.equal(storage.getPreferences().fontSize, 32);
});

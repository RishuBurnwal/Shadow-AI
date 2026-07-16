const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-persistence-'));
process.env.SHADOW_AI_CONFIG_DIR = dir;
const storage = require('../src/storage');
const soul = require('../src/soul');
const memory = require('../src/memory');

test.beforeEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    storage.initializeStorage();
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('preferences, config and keybinds support complete round trips', () => {
    assert.equal(storage.updateConfig('layout', 'wide'), true);
    assert.equal(storage.getConfig().layout, 'wide');
    assert.equal(storage.setPreferences({ selectedLanguage: 'hi-IN', fontSize: 'large' }), true);
    assert.equal(storage.getPreferences().selectedLanguage, 'hi-IN');
    assert.equal(storage.updatePreference('selectedLanguage', 'invalid'), true);
    assert.equal(storage.getPreferences().selectedLanguage, 'en-US');
    assert.equal(storage.setKeybinds({ toggle: 'Ctrl+Shift+X' }), true);
    assert.deepEqual(storage.getKeybinds(), { toggle: 'Ctrl+Shift+X' });
});

test('session history sanitizes metadata, preserves creation and supports deletion', () => {
    const first = '1700000000000';
    const second = '1700000001000';
    assert.equal(storage.saveSession(first, { sessionName: ' First\n', sessionNote: 'Note\u0000', conversationHistory: [{ text: 'a' }] }), true);
    const createdAt = storage.getSession(first).createdAt;
    storage.saveSession(first, { sessionName: 'Renamed' });
    storage.saveSession(second, { sessionName: 'Second', screenAnalysisHistory: [{ text: 'screen' }] });
    assert.equal(storage.getSession(first).createdAt, createdAt);
    assert.equal(storage.getSession(first).sessionName, 'Renamed');
    assert.deepEqual(
        storage.getAllSessions().map(item => item.sessionId),
        [second, first]
    );
    assert.equal(storage.getAllSessions()[1].messageCount, 1);
    assert.throws(() => storage.getSession('../bad'), /Invalid session ID/);
    assert.equal(storage.deleteSession(first), true);
    assert.equal(storage.deleteSession(first), false);
    assert.equal(storage.deleteAllSessions(), true);
    assert.deepEqual(storage.getAllSessions(), []);
});

test('daily provider limits increment and route through fallback models', () => {
    assert.equal(storage.getAvailableModel(), 'gemini-2.5-flash');
    storage.incrementLimitCount('gemini-2.5-flash');
    assert.equal(storage.getTodayLimits().flash.count, 1);
    storage.incrementCharUsage('groq', 'qwen3-32b', 42);
    assert.equal(storage.getTodayLimits().groq['qwen3-32b'].chars, 42);
    assert.equal(storage.getModelForToday(), 'qwen/qwen3-32b');
});

test('profile and memory CRUD feed relevant facts into system prompts', () => {
    soul.setProfile({ name: 'Rishu', targetRole: 'Engineer', keySkills: ['Node.js'], pastProjects: ['Shadow AI'] });
    assert.equal(soul.getProfile().name, 'Rishu');

    const facts = memory.mergeFacts([{ fact: 'Uses Node.js daily', category: 'skill' }], []);
    assert.equal(memory.saveMemory(facts), true);
    assert.equal(memory.getRelevantFacts('node interview', 1)[0].fact, 'Uses Node.js daily');
    assert.equal(memory.updateMemoryEntry(facts[0].id, { fact: 'Uses Node.js professionally' }), true);

    storage.updatePreference('promptSkills', [{ id: 'tone', name: 'Calm voice', prompt: 'Use a calm tone.', enabled: true }]);
    delete require.cache[require.resolve('../src/utils/prompts')];
    const { getSystemPrompt } = require('../src/utils/prompts');
    const prompt = getSystemPrompt('interview', 'Node.js role', false);
    assert.match(prompt, /Rishu/);
    assert.match(prompt, /Uses Node\.js professionally/);
    assert.match(prompt, /CALM VOICE SKILL/);
    assert.match(prompt, /Use a calm tone\./);

    assert.equal(memory.deleteMemoryEntry(facts[0].id), true);
    assert.equal(memory.deleteMemoryEntry(facts[0].id), false);
    assert.equal(memory.clearMemory(), true);
    assert.equal(soul.deleteProfile(), true);
    assert.equal(soul.getProfile().name, '');
});

test('memory merge deduplicates facts and empty extraction is safe', async () => {
    const existing = memory.mergeFacts([{ fact: 'Prefers remote work', category: 'preference' }], []);
    const merged = memory.mergeFacts([{ fact: '  prefers remote work ', category: 'preference' }], existing);
    assert.equal(merged.length, 1);
    assert.deepEqual(await memory.extractFactsFromSession([]), []);
});

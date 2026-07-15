const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Create a temp directory and point storage there
const TEST_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-ai-test-'));
process.env.SHADOW_AI_CONFIG_DIR = TEST_CONFIG_DIR;

const storage = require('../src/storage');

test.beforeEach(() => {
    // Clean and recreate the temp directory before each test
    if (fs.existsSync(TEST_CONFIG_DIR)) {
        fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
});

test.after(() => {
    // Clean up temp directory and env var
    if (fs.existsSync(TEST_CONFIG_DIR)) {
        fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
    delete process.env.SHADOW_AI_CONFIG_DIR;
});

/**
 * Helper: write a config file directly to the test temp dir.
 */
function writeRawConfig(version, extra = {}) {
    const configPath = path.join(TEST_CONFIG_DIR, 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ configVersion: version, ...extra }, null, 2));
}

function writeRawPreferences(extra = {}) {
    const prefsPath = path.join(TEST_CONFIG_DIR, 'preferences.json');
    fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
    fs.writeFileSync(prefsPath, JSON.stringify(extra, null, 2));
}

function writeRawCredentials(extra = {}) {
    const credsPath = path.join(TEST_CONFIG_DIR, 'credentials.json');
    fs.mkdirSync(path.dirname(credsPath), { recursive: true });
    fs.writeFileSync(credsPath, JSON.stringify(extra, null, 2));
}

test('config migration — fresh install writes defaults', () => {
    storage.initializeStorage();

    const config = storage.getConfig();
    assert.equal(config.configVersion, 2);
    assert.equal(config.onboarded, false);
    assert.equal(config.layout, 'normal');
});

test('config migration — old v0 data is preserved and upgraded to v2', () => {
    writeRawConfig(0, { onboarded: true, layout: 'compact', customField: 'should-survive' });
    writeRawPreferences({ customPrompt: 'my prompt', fontSize: 'large' });

    storage.initializeStorage();

    const config = storage.getConfig();
    assert.equal(config.configVersion, 2);
    assert.equal(config.onboarded, true);           // preserved from v0
    assert.equal(config.layout, 'compact');          // preserved from v0
    assert.equal(config.customField, 'should-survive'); // extra field preserved
});

test('config migration — v1 data is preserved and upgraded to v2', () => {
    writeRawConfig(1, { onboarded: true, layout: 'wide', extraField: 'keep-me' });
    writeRawPreferences({ sessionName: 'test session', selectedProfile: 'sales' });

    storage.initializeStorage();

    const config = storage.getConfig();
    assert.equal(config.configVersion, 2);
    assert.equal(config.onboarded, true);       // preserved
    assert.equal(config.layout, 'wide');        // preserved
    assert.equal(config.extraField, 'keep-me'); // extra field preserved

    // Preferences should also be preserved
    const prefs = storage.getPreferences();
    assert.equal(prefs.sessionName, 'test session');
    assert.equal(prefs.selectedProfile, 'sales');
});

test('config migration — corrupt config falls back to defaults without crashing', () => {
    const configPath = path.join(TEST_CONFIG_DIR, 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'this is not valid json {{{');

    storage.initializeStorage();

    const config = storage.getConfig();
    assert.equal(config.configVersion, 2);
    assert.equal(config.onboarded, false);
    assert.equal(config.layout, 'normal');
});

test('config migration — corrupt preferences are replaced with defaults', () => {
    writeRawConfig(1, { onboarded: true });
    const prefsPath = path.join(TEST_CONFIG_DIR, 'preferences.json');
    fs.writeFileSync(prefsPath, 'corrupted data {{{');

    storage.initializeStorage();

    const prefs = storage.getPreferences();
    assert.equal(typeof prefs.customPrompt, 'string');
    assert.equal(typeof prefs.selectedProfile, 'string');
    assert.equal(prefs.selectedProfile, 'interview');
});

test('config migration — current v2 config remains unchanged', () => {
    writeRawConfig(2, { onboarded: true, layout: 'compact', userField: 'my-value' });

    storage.initializeStorage();

    const config = storage.getConfig();
    assert.equal(config.configVersion, 2);
    assert.equal(config.userField, 'my-value');  // fully preserved
});

test('config migration — preferences migration adds missing defaults', () => {
    writeRawConfig(2);
    writeRawPreferences({ customPrompt: 'hello', selectedLanguage: 'fr-FR' });

    storage.initializeStorage();

    const prefs = storage.getPreferences();
    assert.equal(prefs.customPrompt, 'hello');        // preserved
    assert.equal(prefs.selectedLanguage, 'fr-FR');     // preserved
    assert.equal(typeof prefs.fontSize, 'string');     // default filled
    assert.equal(typeof prefs.sessionName, 'string');  // default filled
    assert.equal(typeof prefs.backgroundTransparency, 'number'); // default filled
});

test('config migration — clearAllData wipes everything and reinitializes', () => {
    writeRawConfig(2, { onboarded: true, layout: 'wide' });
    writeRawPreferences({ sessionName: 'old session' });
    writeRawCredentials({ groqApiKey: 'old-key' });

    storage.clearAllData();

    const config = storage.getConfig();
    assert.equal(config.configVersion, 2);
    assert.equal(config.onboarded, false);  // reset to default

    const creds = storage.getCredentials();
    assert.equal(creds.groqApiKey, '');  // wiped
});

test('config migration — credentials survive across migration', () => {
    writeRawConfig(1, { onboarded: true });
    const credsPath = path.join(TEST_CONFIG_DIR, 'credentials.json');
    fs.writeFileSync(credsPath, JSON.stringify({ apiKey: 'test-key', groqApiKey: 'groq-key' }, null, 2));

    storage.initializeStorage();

    // Config should be migrated
    const config = storage.getConfig();
    assert.equal(config.configVersion, 2);

    // Credentials should still be readable
    const creds = storage.getCredentials();
    assert.equal(creds.apiKey, 'test-key');
    assert.equal(creds.groqApiKey, 'groq-key');
});

test('config migration — extra unknown fields in preferences survive', () => {
    writeRawConfig(2);
    writeRawPreferences({ unknownField: 'should-survive' });

    storage.initializeStorage();

    // Unknown field should survive the migration
    const prefs = storage.getPreferences();
    // getPreferences() does a spread { ...DEFAULT_PREFERENCES, ...saved },
    // so unknown fields from saved DO come through
    assert.equal(prefs.unknownField, 'should-survive');
});

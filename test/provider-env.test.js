const test = require('node:test');
const assert = require('node:assert/strict');

const { getEnvPath, parseEnv, replaceEnvValue } = require('../src/utils/providerEnv');

test('development provider env resolves to the project .env', () => {
    assert.equal(getEnvPath(), require('path').resolve(__dirname, '..', '.env'));
});

test('provider env parser reads quoted values and ignores comments', () => {
    assert.deepEqual(
        parseEnv(
            "# keys\nOPENAI_API_KEY='secret'\nGROQ_API_KEY=value # note\nGROQ_API_KEY_1=backup-1\n#GROQ_API_KEY_2=off\nGROQ_API_KEY_3=backup-3\n"
        ),
        {
            OPENAI_API_KEY: 'secret',
            GROQ_API_KEY: 'value',
            GROQ_API_KEY_1: 'backup-1',
            GROQ_API_KEY_3: 'backup-3',
        }
    );
});

test('provider env writer updates only the selected key and rejects line injection', () => {
    const original = '# Shadow AI\nOPENAI_API_KEY=old\nGROQ_API_KEY=keep\n';
    const updated = replaceEnvValue(original, 'OPENAI_API_KEY', 'new-value');
    assert.match(updated, /OPENAI_API_KEY=new-value/);
    assert.match(updated, /GROQ_API_KEY=keep/);
    assert.throws(() => replaceEnvValue(original, 'OPENAI_API_KEY', 'bad\nINJECTED=yes'), /Invalid API key/);
});

test('provider env integration is wired to runtime, IPC and UI refresh', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.resolve(__dirname, '..');
    const index = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    const gemini = fs.readFileSync(path.join(root, 'src/utils/gemini.js'), 'utf8');
    const view = fs.readFileSync(path.join(root, 'src/components/views/MainView.js'), 'utf8');
    assert.match(index, /set-provider-api-key/);
    assert.match(gemini, /syncProviderEnvironment\(\)/);
    assert.match(view, /_refreshProviderConfiguration/);
    assert.match(view, /setProviderApiKey/);
});

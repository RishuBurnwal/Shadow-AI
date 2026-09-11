const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { PROVIDER_KEYS, syncProviderEnvironment } = require('../src/utils/providerEnv');

test('uses the current .env provider keys without writing credential storage', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-ai-provider-env-'));
    const envPath = path.join(temporaryDirectory, '.env');
    const originalEnvPath = process.env.SHADOW_AI_ENV_PATH;
    const originalValues = Object.fromEntries(
        Object.values(PROVIDER_KEYS)
            .flatMap(({ envKey, modelEnv }) => [envKey, modelEnv])
            .map(key => [key, process.env[key]])
    );

    try {
        fs.writeFileSync(envPath, 'GEMINI_API_KEY=live-gemini-key\nGEMINI_MODEL=gemini-live\n', 'utf8');
        process.env.SHADOW_AI_ENV_PATH = envPath;

        const credentials = syncProviderEnvironment();

        assert.equal(credentials.apiKey, 'live-gemini-key');
        assert.equal(process.env.GEMINI_MODEL, 'gemini-live');
        assert.equal(credentials.groqApiKey, '');
    } finally {
        if (originalEnvPath === undefined) delete process.env.SHADOW_AI_ENV_PATH;
        else process.env.SHADOW_AI_ENV_PATH = originalEnvPath;
        for (const [key, value] of Object.entries(originalValues)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

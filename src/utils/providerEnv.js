const fs = require('fs');
const path = require('path');

function getEnvPath() {
    if (process.env.SHADOW_AI_ENV_PATH) return path.resolve(process.env.SHADOW_AI_ENV_PATH);
    if (__dirname.includes('app.asar')) return path.join(require('../storage').getConfigDir(), '.env');
    return path.resolve(__dirname, '..', '..', '.env');
}
const { providerKeyMapping } = require('./providers.config');

const PROVIDER_KEYS = Object.freeze(providerKeyMapping());

function parseEnv(content) {
    const values = {};
    for (const rawLine of String(content || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        } else {
            value = value.replace(/\s+#.*$/, '').trim();
        }
        values[match[1]] = value;
    }
    return values;
}

function validateApiKey(value) {
    if (typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value)) {
        throw new Error('Invalid API key value');
    }
    return value.trim();
}

function replaceEnvValue(content, key, value) {
    const safeValue = validateApiKey(value);
    const lines = String(content || '').split(/\r?\n/);
    const matcher = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const replacement = `${key}=${safeValue}`;
    const index = lines.findIndex(line => matcher.test(line));
    if (index >= 0) lines[index] = replacement;
    else {
        if (lines.length && lines.at(-1) !== '') lines.push('');
        lines.push(replacement);
    }
    return lines.join('\n');
}

function readProviderEnv() {
    const ENV_PATH = getEnvPath();
    if (!fs.existsSync(ENV_PATH)) return null;
    return parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
}

/* node:coverage disable */
function syncProviderEnvironment() {
    const storage = require('../storage');
    const env = readProviderEnv();
    if (!env) return storage.getCredentials();

    const previousCredentials = storage.getCredentials();
    const credentials = { ...previousCredentials };
    for (const { envKey, credential } of Object.values(PROVIDER_KEYS)) {
        const value = env[envKey] || '';
        credentials[credential] = value;
        if (value) process.env[envKey] = value;
        else delete process.env[envKey];
        for (const key of Object.keys(process.env))
            if (key.startsWith(`${envKey}_`) && /^\d+$/.test(key.slice(envKey.length + 1))) delete process.env[key];
        for (const [key, numberedValue] of Object.entries(env)) {
            if (key.startsWith(`${envKey}_`) && /^\d+$/.test(key.slice(envKey.length + 1)) && numberedValue) process.env[key] = numberedValue;
        }
    }
    const changed = Object.values(PROVIDER_KEYS).some(({ credential }) => previousCredentials[credential] !== credentials[credential]);
    if (changed) storage.setCredentials(credentials);
    return credentials;
}

function setProviderKey(provider, value) {
    const definition = PROVIDER_KEYS[String(provider || '').toLowerCase()];
    if (!definition) throw new Error('Unsupported provider');
    const safeValue = validateApiKey(value);
    const ENV_PATH = getEnvPath();
    fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true });
    const current = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    const updated = replaceEnvValue(current, definition.envKey, safeValue);
    const temporaryPath = `${ENV_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, updated, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, ENV_PATH);
    return syncProviderEnvironment();
}

function getProviderStatus() {
    const credentials = syncProviderEnvironment();
    return Object.fromEntries(Object.entries(PROVIDER_KEYS).map(([provider, { credential }]) => [provider, Boolean(credentials[credential])]));
}
/* node:coverage enable */

module.exports = {
    PROVIDER_KEYS,
    getEnvPath,
    parseEnv,
    replaceEnvValue,
    readProviderEnv,
    syncProviderEnvironment,
    setProviderKey,
    getProviderStatus,
};

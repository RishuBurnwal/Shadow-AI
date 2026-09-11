// Opt-in live connectivity checks: sends only a synthetic greeting, never session data.
const fs = require('node:fs');
const path = require('node:path');
const { syncProviderEnvironment, readProviderEnv } = require('../src/utils/providerEnv');
const { getConfiguredProviders, streamWithFallback } = require('../src/utils/providerRouter');
(async () => {
    syncProviderEnvironment();
    const results = await Promise.all(
        getConfiguredProviders().map(async provider => {
            const started = Date.now();
            try {
                const result = await streamWithFallback({
                    providers: [provider],
                    messages: [{ role: 'user', content: 'Reply with only OK.' }],
                    maxTokens: 128,
                    timeoutMs: 15000,
                    totalTimeoutMs: 16000,
                });
                return {
                    provider: provider.id,
                    model: provider.model,
                    status: result.partial ? 'PARTIAL' : 'PASS',
                    text: result.text.slice(0, 120),
                    usage: result.usage,
                    ms: Date.now() - started,
                };
            } catch (error) {
                return { provider: provider.id, model: provider.model, status: 'FAIL', error: error.message, ms: Date.now() - started };
            }
        })
    );
    for (const [provider, url] of [
        ['ollama', 'http://127.0.0.1:11434/api/tags'],
        ['nemotron', 'http://127.0.0.1:8080/health'],
    ]) {
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
            results.push({ provider, status: r.ok ? 'PASS' : 'FAIL', http: r.status });
        } catch (e) {
            results.push({ provider, status: 'UNAVAILABLE', error: e.message });
        }
    }
    fs.mkdirSync(path.resolve('logs'), { recursive: true });
    fs.writeFileSync(path.resolve('logs/live-provider-audit.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
})().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});

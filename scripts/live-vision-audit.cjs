const fs = require('node:fs');
const sharp = require('sharp');
const { syncProviderEnvironment } = require('../src/utils/providerEnv');
const { getConfiguredProviders, streamWithFallback } = require('../src/utils/providerRouter');
const { createOpenAiUserMessage } = require('../src/utils/multimodal');
(async () => {
    syncProviderEnvironment();
    const data = (
        await sharp({ create: { width: 256, height: 256, channels: 3, background: '#ff0000' } })
            .jpeg()
            .toBuffer()
    ).toString('base64');
    const results = [];
    for (const provider of getConfiguredProviders().filter(p => ['groq', 'gemini'].includes(p.id))) {
        try {
            const r = await streamWithFallback({
                providers: [provider],
                messages: [createOpenAiUserMessage('What single color fills this image? Reply with one word.', data)],
                requestType: 'vision',
                maxTokens: 32,
                timeoutMs: 8000,
                totalTimeoutMs: 18000,
            });
            results.push({ provider: r.provider, status: /red/i.test(r.text) ? 'PASS' : 'FAIL', text: r.text, usage: r.usage });
        } catch (e) {
            results.push({ provider: provider.id, status: 'FAIL', error: e.message });
        }
    }
    fs.writeFileSync('logs/live-vision-audit.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
})().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
});

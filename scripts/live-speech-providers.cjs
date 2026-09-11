const fs = require('node:fs');
const { transcribeAudio } = require('../src/utils/audioProviders');
const { syncProviderEnvironment } = require('../src/utils/providerEnv');
const { getConfiguredProviders } = require('../src/utils/providerRouter');
(async () => {
    const wav = fs.readFileSync('logs/audit-speech.wav');
    let offset = 12,
        pcm;
    while (offset + 8 < wav.length) {
        const size = wav.readUInt32LE(offset + 4);
        if (wav.toString('ascii', offset, offset + 4) === 'data') {
            pcm = wav.subarray(offset + 8, offset + 8 + size);
            break;
        }
        offset += 8 + size + (size % 2);
    }
    if (!pcm) throw Error('Synthetic WAV has no data chunk');
    syncProviderEnvironment();
    const configured = new Set(getConfiguredProviders().map(p => p.id));
    const results = [];
    for (const provider of ['groq', 'openai', 'gemini', 'nvidia']) {
        if (process.argv[2] && provider !== process.argv[2]) continue;
        if (!configured.has(provider)) {
            results.push({ provider, status: 'NO_KEY' });
            continue;
        }
        try {
            const result = await transcribeAudio(pcm, { provider });
            results.push({ ...result, status: /two|2/i.test(result.text) ? 'PASS' : 'FAIL' });
        } catch (error) {
            results.push({ provider, status: 'FAIL', error: error.message });
        }
    }
    fs.writeFileSync('logs/live-speech-providers.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
})().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});

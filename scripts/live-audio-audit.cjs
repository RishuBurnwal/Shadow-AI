const { GoogleGenAI } = require('@google/genai');
const { readProviderEnv } = require('../src/utils/providerEnv');
const fs = require('node:fs');
(async () => {
    const env = readProviderEnv();
    const results = [];
    const model = env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-09-2025';
    let session;
    let timer;
    try {
        const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
        await Promise.race([
            new Promise(async (resolve, reject) => {
                try {
                    session = await ai.live.connect({
                        model,
                        config: {
                            responseModalities: ['AUDIO'],
                            inputAudioTranscription: {},
                            systemInstruction: 'Only transcribe incoming speech. Do not reply.',
                        },
                        callbacks: {
                            onmessage: m => {
                                if (m.setupComplete) resolve();
                            },
                            onerror: e => reject(new Error(e.message || 'Live connection failed')),
                            onclose: e => reject(new Error(`Live closed: ${e.code} ${e.reason}`)),
                        },
                    });
                } catch (e) {
                    reject(e);
                }
            }),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Live setup timed out after 12 seconds')), 12000);
            }),
        ]);
        results.push({ provider: 'gemini-live', model, status: 'PASS', scope: 'Setup acknowledged; no microphone audio sent' });
    } catch (e) {
        results.push({ provider: 'gemini-live', model, status: 'FAIL', error: e.message });
    } finally {
        clearTimeout(timer);
        session?.close();
    }
    fs.writeFileSync('logs/live-audio-audit.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
})().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
});

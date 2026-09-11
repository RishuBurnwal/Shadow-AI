const { GoogleGenAI } = require('@google/genai');
const { readProviderEnv } = require('../src/utils/providerEnv');
const fs = require('node:fs');
(async () => {
    const env = readProviderEnv();
    const model = env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-09-2025';
    let session, timer;
    let transcript = '';
    const wav = fs.readFileSync('logs/audit-speech.wav');
    let offset = 12,
        audio;
    while (offset + 8 < wav.length) {
        const size = wav.readUInt32LE(offset + 4);
        if (wav.toString('ascii', offset, offset + 4) === 'data') {
            audio = wav.subarray(offset + 8, offset + 8 + size);
            break;
        }
        offset += 8 + size + (size % 2);
    }
    try {
        let setup;
        const ready = new Promise(r => {
            setup = r;
        });
        let complete;
        const heard = new Promise(r => {
            complete = r;
        });
        const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
        session = await ai.live.connect({
            model,
            config: {
                responseModalities: ['AUDIO'],
                inputAudioTranscription: {},
                systemInstruction: 'Only transcribe incoming speech. Do not reply.',
            },
            callbacks: {
                onmessage: m => {
                    if (m.setupComplete) setup();
                    const t = m.serverContent?.inputTranscription?.text;
                    if (t) {
                        transcript += t;
                        if (/(two|2).*(plus|\+).*(two|2)/i.test(transcript)) complete();
                    }
                },
                onerror: () => {},
                onclose: () => {},
            },
        });
        await Promise.race([
            ready,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Setup timeout')), 10000);
            }),
        ]);
        clearTimeout(timer);
        for (let i = 0; i < audio.length; i += 4800) {
            session.sendRealtimeInput({ audio: { data: audio.subarray(i, i + 4800).toString('base64'), mimeType: 'audio/pcm;rate=24000' } });
            await new Promise(r => setTimeout(r, 100));
        }
        session.sendRealtimeInput({ audioStreamEnd: true });
        await Promise.race([
            heard,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Transcription timeout')), 12000);
            }),
        ]);
        const result = { provider: 'gemini-live', model, status: 'PASS', scope: 'Synthetic spoken question sent as 24kHz PCM', transcript };
        fs.writeFileSync('logs/live-audio-audit.json', JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result));
    } catch (e) {
        const result = { provider: 'gemini-live', status: 'FAIL', error: e.message, transcript };
        fs.writeFileSync('logs/live-audio-audit.json', JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result));
    } finally {
        clearTimeout(timer);
        session?.close();
    }
})().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
});

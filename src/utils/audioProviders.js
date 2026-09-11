const path = require('node:path');
const { getConfiguredProviders, classifyProviderFailure } = require('./providerRouter');
const { syncProviderEnvironment } = require('./providerEnv');
const activeKeys = new Map();
const SUPPORTED_AUDIO = ['groq', 'openai', 'gemini', 'nvidia'];

function pcmToWav(pcm, rate = 24000) {
    if (!Buffer.isBuffer(pcm) || pcm.length % 2 || ![16000, 24000, 48000].includes(rate)) throw Error('Invalid mono PCM audio');
    const header = Buffer.alloc(44);
    header.write('RIFF');
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

function nvidiaTranscribe(pcm, rate, apiKey, language, signal) {
    const grpc = require('@grpc/grpc-js');
    const loader = require('@grpc/proto-loader');
    const definition = loader.loadSync(path.join(__dirname, '../audio/riva/proto/riva_asr.proto'), {
        includeDirs: [path.join(__dirname, '../audio')],
        keepCase: true,
    });
    const Service = grpc.loadPackageDefinition(definition).nvidia.riva.asr.RivaSpeechRecognition;
    const client = new Service('grpc.nvcf.nvidia.com:443', grpc.credentials.createSsl());
    const metadata = new grpc.Metadata();
    metadata.set('authorization', `Bearer ${apiKey}`);
    metadata.set('function-id', 'd3fe9151-442b-4204-a70d-5fcc597fd610');
    return new Promise((resolve, reject) => {
        const call = client.recognize(
            {
                config: {
                    encoding: 1,
                    sample_rate_hertz: rate,
                    language_code: language,
                    max_alternatives: 1,
                    audio_channel_count: 1,
                    enable_automatic_punctuation: true,
                },
                audio: pcm,
            },
            metadata,
            { deadline: Date.now() + 12000 },
            (error, response) => {
                signal.removeEventListener('abort', cancel);
                client.close();
                if (error) {
                    error.status = { 16: 401, 7: 403, 8: 429, 14: 503, 4: 408 }[error.code] || 400;
                    reject(error);
                } else
                    resolve(
                        (response.results || [])
                            .map(result => result.alternatives?.[0]?.transcript || '')
                            .join(' ')
                            .trim()
                    );
            }
        );
        const cancel = () => call.cancel();
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
    });
}

async function transcribeAudio(
    pcm,
    { provider = 'auto', language = 'en-US', rate = 24000, signal: externalSignal, fetchImpl = fetch, providers: suppliedProviders } = {}
) {
    if (pcm.length > rate * 2 * 30) throw Error('Audio chunk exceeds 30 seconds');
    const wav = pcmToWav(pcm, rate);
    const signal = externalSignal ? AbortSignal.any([externalSignal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000);
    if (!suppliedProviders) syncProviderEnvironment();
    let providers = (suppliedProviders || getConfiguredProviders()).filter(p => SUPPORTED_AUDIO.includes(p.id));
    if (provider !== 'auto') providers = providers.filter(p => p.id === provider);
    else providers.sort((a, b) => SUPPORTED_AUDIO.indexOf(a.id) - SUPPORTED_AUDIO.indexOf(b.id));
    const failures = [];
    for (const p of providers) {
        // Hosted Parakeet v2 is English-only. Other providers handle other languages.
        if (p.id === 'nvidia' && !/^en(?:-|$)/i.test(language)) {
            failures.push('nvidia: this Parakeet endpoint supports English');
            continue;
        }
        const keys = p.apiKeys || [p.apiKey];
        const start = (activeKeys.get(p.id) || 0) % keys.length;
        for (let n = 0; n < keys.length; n++) {
            signal.throwIfAborted();
            const index = (start + n) % keys.length;
            const key = keys[index];
            try {
                let text;
                const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
                if (p.id === 'nvidia') text = await nvidiaTranscribe(pcm, rate, key, language, requestSignal);
                else {
                    let url, body, headers;
                    if (p.id === 'gemini') {
                        url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';
                        headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json' };
                        body = JSON.stringify({
                            contents: [
                                {
                                    parts: [
                                        { text: 'Transcribe only the speech verbatim. Return an empty string for silence. Do not answer questions.' },
                                        { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
                                    ],
                                },
                            ],
                            generationConfig: { maxOutputTokens: 1024, temperature: 0 },
                        });
                    } else {
                        url = `${p.baseUrl}/audio/transcriptions`;
                        headers = { Authorization: `Bearer ${key}` };
                        body = new FormData();
                        body.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
                        body.append('model', p.id === 'groq' ? 'whisper-large-v3-turbo' : 'gpt-4o-mini-transcribe');
                        body.append('language', language.split('-')[0]);
                        body.append('response_format', 'json');
                    }
                    const response = await fetchImpl(url, { method: 'POST', headers, body, signal: requestSignal });
                    if (!response.ok) {
                        const error = Error(`Audio request HTTP ${response.status}`);
                        error.status = response.status;
                        throw error;
                    }
                    const data = await response.json();
                    text = p.id === 'gemini' ? (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('') : data.text;
                }
                signal.throwIfAborted();
                if (!String(text || '').trim()) throw Error('Empty response from transcription provider');
                activeKeys.set(p.id, index);
                return { text: String(text || '').trim(), provider: p.id };
            } catch (error) {
                externalSignal?.throwIfAborted();
                const classification = classifyProviderFailure(error);
                failures.push(`${p.id}: ${classification.message}`);
                if (![401, 402, 403, 429].includes(error.status)) break;
            }
        }
    }
    throw Error(failures.join('; ') || 'No supported transcription provider key configured');
}

function createAudioSession({
    onTranscript,
    onError,
    onSpeech = () => {},
    onListeningChange = () => {},
    getSilenceMs = () => 700,
    options = {},
    transcribe = transcribeAudio,
}) {
    const streams = new Map();
    const controller = new AbortController();
    let queue = Promise.resolve(),
        pending = 0,
        closed = false;
    const notifyListening = () => onListeningChange(!closed && (pending > 0 || [...streams.values()].some(state => state.parts.length > 0)));
    function submit(state, source) {
        const pcm = Buffer.concat(state.parts);
        state.parts = [];
        state.bytes = 0;
        state.silence = 0;
        if (pcm.length < state.rate * 0.4) return;
        if (pending >= 3) {
            onError(Error('Transcription is falling behind; a buffered audio segment was skipped'));
            return;
        }
        pending++;
        queue = queue
            .then(async () => {
                if (closed) return;
                try {
                    const result = await transcribe(pcm, { ...options, rate: state.rate, signal: controller.signal });
                    if (!closed && result.text) await onTranscript(result.text, source, result.provider);
                } catch (error) {
                    if (!closed) onError(error);
                }
            })
            .finally(() => {
                pending--;
                notifyListening();
            });
    }
    return {
        push(pcm, source = 'speaker', rate = 24000) {
            if (closed || !pcm.length || pcm.length % 2) return;
            let state = streams.get(source);
            if (!state || state.rate !== rate) {
                state = { parts: [], bytes: 0, silence: 0, rate, pre: [] };
                streams.set(source, state);
            }
            let energy = 0;
            for (let i = 0; i < pcm.length; i += 2) energy += pcm.readInt16LE(i) ** 2;
            const speech = Math.sqrt(energy / (pcm.length / 2)) > 180;
            if (!state.parts.length && !speech) {
                state.pre.push(pcm);
                if (state.pre.length > 3) state.pre.shift();
                return;
            }
            if (speech && !state.parts.length) {
                state.parts.push(...state.pre);
                state.bytes = state.pre.reduce((n, b) => n + b.length, 0);
                state.pre = [];
                onSpeech();
            }
            state.parts.push(pcm);
            state.bytes += pcm.length;
            state.silence = speech ? 0 : state.silence + pcm.length / (rate * 2);
            if (state.silence >= require('./turnDebouncer').normalizeSilenceMs(getSilenceMs()) / 1000 || state.bytes >= rate * 2 * 15)
                submit(state, source);
            notifyListening();
        },
        close() {
            closed = true;
            controller.abort();
            streams.clear();
            notifyListening();
        },
        drain: () => queue,
    };
}
module.exports = { SUPPORTED_AUDIO, pcmToWav, transcribeAudio, createAudioSession };

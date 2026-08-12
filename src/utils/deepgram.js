const WebSocket = require('ws');

let socket = null;
let keepAlive = null;

function buildListenUrl(language = 'en-US', sampleRate = 24000) {
    const url = new URL('wss://api.deepgram.com/v1/listen');
    for (const [key, value] of Object.entries({
        model: 'nova-3',
        language,
        encoding: 'linear16',
        sample_rate: sampleRate,
        channels: 1,
        smart_format: true,
        interim_results: true,
        endpointing: 300,
        utterance_end_ms: 1000,
        vad_events: true,
    }))
        url.searchParams.set(key, String(value));
    return url.toString();
}

function createTranscriptAssembler({ onInterim = () => {}, onFinal = () => {} } = {}) {
    let finalized = [];
    const finish = () => {
        const text = finalized.join(' ').replace(/\s+/g, ' ').trim();
        finalized = [];
        if (text) onFinal(text);
    };

    return message => {
        if (message?.type === 'UtteranceEnd') return finish();
        if (message?.type !== 'Results') return;
        const text = String(message.channel?.alternatives?.[0]?.transcript || '').trim();
        if (text && message.is_final) finalized.push(text);
        const visible = [...finalized, message.is_final ? '' : text].join(' ').replace(/\s+/g, ' ').trim();
        if (visible) onInterim(visible);
        if (message.speech_final) finish();
    };
}

function connectDeepgram(apiKey, language, callbacks = {}) {
    closeDeepgram();
    if (!apiKey || /[\r\n\0]/.test(apiKey)) return Promise.reject(new Error('Deepgram API key is not configured'));

    return new Promise((resolve, reject) => {
        const accept = createTranscriptAssembler(callbacks);
        let opened = false;
        socket = new WebSocket(buildListenUrl(language), { headers: { Authorization: `Token ${apiKey}` } });
        const timeout = setTimeout(() => {
            if (!opened) {
                socket?.terminate();
                reject(new Error('Deepgram connection timeout'));
            }
        }, 10000);

        socket.once('open', () => {
            opened = true;
            clearTimeout(timeout);
            keepAlive = setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'KeepAlive' }));
            }, 8000);
            callbacks.onOpen?.();
            resolve(true);
        });
        socket.on('message', data => {
            try {
                accept(JSON.parse(data.toString()));
            } catch (error) {
                callbacks.onError?.(error);
            }
        });
        socket.on('error', error => {
            clearTimeout(timeout);
            callbacks.onError?.(error);
            if (!opened) reject(error);
        });
        socket.on('close', () => {
            clearInterval(keepAlive);
            keepAlive = null;
            socket = null;
            callbacks.onClose?.();
        });
    });
}

function sendDeepgramAudio(buffer) {
    if (socket?.readyState !== WebSocket.OPEN || !buffer?.length) return false;
    socket.send(buffer);
    return true;
}

function closeDeepgram() {
    clearInterval(keepAlive);
    keepAlive = null;
    if (socket) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'CloseStream' }));
        socket.close();
        socket = null;
    }
}

function isDeepgramActive() {
    return socket?.readyState === WebSocket.OPEN;
}

module.exports = { buildListenUrl, createTranscriptAssembler, connectDeepgram, sendDeepgramAudio, closeDeepgram, isDeepgramActive };

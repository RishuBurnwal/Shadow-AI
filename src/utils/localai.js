const { Ollama } = require('ollama');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getSystemPrompt } = require('./prompts');
const { createTurnDebouncer } = require('./turnDebouncer');
const { initializeSileroVAD, VadProcessor, isAvailable, FRAME_SIZE } = require('./sileroVad');

// Lazy load gemini to avoid requiring 'electron' at module load time.
// This allows unit tests that import localai.js for resample24kTo16k to
// work without an Electron runtime.
let _gemini = null;
function getGemini() {
    if (!_gemini) _gemini = require('./gemini');
    return _gemini;
}
function sendToRenderer(ch, data) {
    return getGemini().sendToRenderer(ch, data);
}
function initializeNewSession(p, c) {
    return getGemini().initializeNewSession(p, c);
}
function saveConversationTurn(t, a) {
    return getGemini().saveConversationTurn(t, a);
}

// ── State ──

let ollamaClient = null;
let ollamaModel = null;
let whisperPipeline = null;
let isWhisperLoading = false;
let localConversationHistory = [];
let currentSystemPrompt = null;
let isLocalActive = false;

// VAD state
let isSpeaking = false;
let speechBuffers = [];
let silenceFrameCount = 0;
let speechFrameCount = 0;

// Silero VAD processor (initialized lazily when local mode starts)
let sileroVad = null;

// Rolling-window transcription state
let rollingTranscriptionInterval = null;
const ROLLING_WINDOW_MS = 2000; // Transcribe partial audio every 2s during speech
const MAX_ROLLING_AUDIO_MS = 5000;
const MAX_ROLLING_AUDIO_BYTES = (16000 * 2 * MAX_ROLLING_AUDIO_MS) / 1000;
let lastRollingTranscriptionTime = 0;
let _isTranscribing = false; // In-flight guard to prevent concurrent transcribeAudio() calls
const answerDebouncer = createTurnDebouncer();
let answerRequestedAt = 0;

// Cached language preference for Whisper transcription (set in initializeLocalSession)
let currentWhisperLanguage = 'en';
const WHISPER_REVISIONS = Object.freeze({
    'Xenova/whisper-tiny': '5332fcc35e32a33b86612b9a57a89be7906102b1',
    'Xenova/whisper-base': '64da57285918e20ea79ea5c88eed7197933abaa8',
    'Xenova/whisper-small': '2d67713f236afa48a18992566e7647f6ca848e13',
    'Xenova/whisper-medium': '8c5b90880ab9f79487ab33613413431bf661d595',
});
const WHISPER_ONNX_HASHES = Object.freeze({
    'Xenova/whisper-tiny': {
        'onnx/decoder_model_merged_quantized.onnx': '6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0',
        'onnx/encoder_model_quantized.onnx': 'fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e',
    },
    'Xenova/whisper-base': {
        'onnx/decoder_model_merged_quantized.onnx': 'a6beb6baabb66f00b6a686d828c95ffca6146d51900cbad0266cad38f64cf861',
        'onnx/encoder_model_quantized.onnx': '3e345e977b55620a37c0c2b2af0644e019afdfad562dcf71eb929bb7274285f9',
    },
    'Xenova/whisper-small': {
        'onnx/decoder_model_merged_quantized.onnx': 'fcfc6100dc7339e7507e10f8b274350be7c4f8d8b575f0293f94cc0e156d6d24',
        'onnx/encoder_model_quantized.onnx': '969f5ac12974340386bf7a02ea6626003e5e2dee396ffc6ab0eec282bf55ba06',
    },
    'Xenova/whisper-medium': {
        'onnx/decoder_model_merged_quantized.onnx': '2cdd6d06ebdf9d993d21117bfeeb7e9b399521b7766d3df77c54a85d6dcf3c08',
        'onnx/encoder_model_quantized.onnx': '7d6b4a00e441271646327f8a71b6e1bd1a305013cd914b51ddd76919c59ee3af',
    },
});

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function verifyWhisperCache(cacheDir, modelName, revision) {
    for (const [file, expected] of Object.entries(WHISPER_ONNX_HASHES[modelName] || {})) {
        const cached = path.join(cacheDir, modelName, revision, ...file.split('/'));
        if (fs.existsSync(cached) && sha256(fs.readFileSync(cached)) !== expected) fs.unlinkSync(cached);
    }
}

function findWhisperAsset(url) {
    const pathname = decodeURIComponent(new URL(url).pathname);
    for (const [model, files] of Object.entries(WHISPER_ONNX_HASHES)) {
        if (!pathname.includes(`/${model}/`)) continue;
        for (const [file, expected] of Object.entries(files)) if (pathname.endsWith(`/${file}`)) return { expected, file };
    }
    return null;
}

// VAD configuration
// Silence frames reduced from 15→5 (500ms vs 1500ms) now that Silero VAD provides robust detection
const VAD_MODES = {
    NORMAL: { energyThreshold: 0.01, speechFramesRequired: 3, silenceFramesRequired: 10 },
    LOW_BITRATE: { energyThreshold: 0.008, speechFramesRequired: 4, silenceFramesRequired: 12 },
    AGGRESSIVE: { energyThreshold: 0.015, speechFramesRequired: 2, silenceFramesRequired: 7 },
    VERY_AGGRESSIVE: { energyThreshold: 0.02, speechFramesRequired: 2, silenceFramesRequired: 5 },
};
let vadConfig = VAD_MODES.VERY_AGGRESSIVE;

function setVadSilenceMs(value) {
    const milliseconds = Math.min(1200, Math.max(300, Number(value) || 500));
    vadConfig = { ...VAD_MODES.VERY_AGGRESSIVE, silenceFramesRequired: Math.round(milliseconds / 100) };
    return milliseconds;
}

function getRollingAudio(audio) {
    return audio.subarray(Math.max(0, audio.length - MAX_ROLLING_AUDIO_BYTES));
}

// Audio resampling buffer
let resampleRemainder = Buffer.alloc(0);

// ── Audio Resampling (24kHz → 16kHz) ──

function resample24kTo16k(inputBuffer) {
    // Combine with any leftover samples from previous call
    const combined = Buffer.concat([resampleRemainder, inputBuffer]);
    const inputSamples = Math.floor(combined.length / 2); // 16-bit = 2 bytes per sample
    // Ratio: 16000/24000 = 2/3, so for every 3 input samples we produce 2 output samples
    const outputSamples = Math.floor((inputSamples * 2) / 3);
    const outputBuffer = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
        // Map output sample index to input position
        const srcPos = (i * 3) / 2;
        const srcIndex = Math.floor(srcPos);
        const frac = srcPos - srcIndex;

        const s0 = combined.readInt16LE(srcIndex * 2);
        const s1 = srcIndex + 1 < inputSamples ? combined.readInt16LE((srcIndex + 1) * 2) : s0;
        const interpolated = Math.round(s0 + frac * (s1 - s0));
        outputBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
    }

    // Store remainder for next call
    const consumedInputSamples = Math.ceil((outputSamples * 3) / 2);
    const remainderStart = consumedInputSamples * 2;
    resampleRemainder = remainderStart < combined.length ? combined.slice(remainderStart) : Buffer.alloc(0);

    return outputBuffer;
}

// ── VAD (Voice Activity Detection) — Two-stage: RMS pre-filter + Silero VAD ──

function calculateRMS(pcm16Buffer) {
    const samples = pcm16Buffer.length / 2;
    if (samples === 0) return 0;
    let sumSquares = 0;
    for (let i = 0; i < samples; i++) {
        const sample = pcm16Buffer.readInt16LE(i * 2) / 32768;
        sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / samples);
}

async function processVAD(pcm16kBuffer) {
    const rms = calculateRMS(pcm16kBuffer);

    // Stage 1 gates the Silero classifier below; tune both thresholds together.
    const isLoud = rms > vadConfig.energyThreshold;

    // Stage 2: If Silero VAD is available, use it for robust classification
    let isVoice = isLoud;
    if (sileroVad && isLoud) {
        // Process audio through Silero VAD in 512-sample frames (32ms at 16kHz)
        const float32Audio = pcm16ToFloat32(pcm16kBuffer);
        const numFrames = Math.floor(float32Audio.length / FRAME_SIZE);
        let speechFrameCountSilero = 0;
        const totalFrames = Math.max(1, numFrames);

        for (let f = 0; f < numFrames; f++) {
            const start = f * FRAME_SIZE;
            const frame = float32Audio.slice(start, start + FRAME_SIZE);
            const prob = await sileroVad.processFrame(frame);
            if (prob > 0.5) speechFrameCountSilero++;
        }

        // Consider speech detected if majority of frames are speech
        isVoice = speechFrameCountSilero / totalFrames > 0.3;
    }

    if (isVoice) {
        answerDebouncer.interrupt();
        speechFrameCount++;
        silenceFrameCount = 0;

        if (!isSpeaking && speechFrameCount >= vadConfig.speechFramesRequired) {
            isSpeaking = true;
            speechBuffers = [];
            lastRollingTranscriptionTime = Date.now();
            console.log('[LocalAI] Speech started (RMS:', rms.toFixed(4), sileroVad ? ', Silero prob: ' + sileroVad.getProbability().toFixed(4) : '');
            sendToRenderer('update-status', 'Listening... (speech detected)');

            // Start rolling-window transcription timer during speech
            startRollingTranscription();
        }
    } else {
        silenceFrameCount++;
        speechFrameCount = 0;

        if (isSpeaking && silenceFrameCount >= vadConfig.silenceFramesRequired) {
            isSpeaking = false;
            stopRollingTranscription();
            console.log('[LocalAI] Speech ended, accumulated', speechBuffers.length, 'chunks');
            sendToRenderer('update-status', 'Transcribing...');

            // Trigger final transcription with accumulated audio
            const audioData = Buffer.concat(speechBuffers);
            speechBuffers = [];
            await handleSpeechEnd(audioData);
            return;
        }
    }

    // Accumulate audio during speech
    if (isSpeaking) {
        speechBuffers.push(Buffer.from(pcm16kBuffer));
    }
}

// ── Rolling-Window Transcription ──

function startRollingTranscription() {
    // Clear any existing interval
    stopRollingTranscription();

    // Check audio every ROLLING_WINDOW_MS during active speech
    rollingTranscriptionInterval = setInterval(async () => {
        if (!isSpeaking || speechBuffers.length === 0) return;
        // Skip if another transcription is already in-flight (P1-02 guard)
        if (_isTranscribing) return;

        const now = Date.now();
        if (now - lastRollingTranscriptionTime < ROLLING_WINDOW_MS) return;
        lastRollingTranscriptionTime = now;

        const audioSoFar = getRollingAudio(Buffer.concat(speechBuffers));
        if (audioSoFar.length < 32000) return; // Need at least ~1s of audio

        _isTranscribing = true;
        try {
            const partialText = await transcribeAudio(audioSoFar);
            if (partialText && partialText.trim().length > 2) {
                // Send interim partial transcript to renderer
                // The renderer can display this as muted/greyed text
                sendToRenderer('interim-transcription', {
                    text: partialText,
                    isFinal: false,
                });
            }
        } catch (err) {
            // Rolling transcription is best-effort; ignore errors silently
        } finally {
            _isTranscribing = false;
        }
    }, ROLLING_WINDOW_MS);
}

function stopRollingTranscription() {
    if (rollingTranscriptionInterval) {
        clearInterval(rollingTranscriptionInterval);
        rollingTranscriptionInterval = null;
    }
}

// ── Whisper Transcription ──

async function loadWhisperPipeline(modelName) {
    if (whisperPipeline) return whisperPipeline;
    if (isWhisperLoading) return null;

    isWhisperLoading = true;
    console.log('[LocalAI] Loading Whisper model:', modelName);
    sendToRenderer('whisper-downloading', true);
    sendToRenderer('update-status', 'Loading Whisper model (first time may take a while)...');

    try {
        const revision = WHISPER_REVISIONS[modelName] || process.env.WHISPER_MODEL_REVISION;
        if (!revision) throw new Error(`Whisper model ${modelName} has no pinned revision`);
        // Dynamic import for ESM module
        const { pipeline, env } = await import('@huggingface/transformers');
        // Cache models outside the asar archive so ONNX runtime can load them
        const { app } = require('electron');
        const path = require('path');
        env.cacheDir = path.join(app.getPath('userData'), 'whisper-models');
        verifyWhisperCache(env.cacheDir, modelName, revision);
        const defaultFetch = env.fetch;
        env.fetch = async (...args) => {
            const response = await defaultFetch(...args);
            const asset = findWhisperAsset(response.url || String(args[0]));
            if (!asset || !response.ok) return response;
            const bytes = await response.arrayBuffer();
            if (sha256(Buffer.from(bytes)) !== asset.expected) throw new Error(`Whisper model checksum failed: ${asset.file}`);
            return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
        };

        // Attempt WebGPU backend first; fall back to CPU if unavailable
        // This is explicitly tried and logged so the user knows which backend is in use
        let device = 'auto';
        try {
            console.log('[LocalAI] Attempting WebGPU backend for Whisper...');
            whisperPipeline = await pipeline('automatic-speech-recognition', modelName, {
                dtype: 'q8',
                device: 'webgpu',
                revision,
            });
            device = 'webgpu';
            console.log('[LocalAI] Whisper loaded with WebGPU backend');
        } catch (webgpuError) {
            console.warn('[LocalAI] WebGPU backend unavailable, falling back to CPU:', webgpuError.message);
            whisperPipeline = await pipeline('automatic-speech-recognition', modelName, {
                dtype: 'q8',
                device: 'cpu',
                revision,
            });
            device = 'cpu';
            console.log('[LocalAI] Whisper loaded with CPU backend');
        }

        console.log('[LocalAI] Whisper model loaded successfully (backend:', device, ')');
        sendToRenderer('whisper-downloading', false);
        isWhisperLoading = false;
        return whisperPipeline;
    } catch (error) {
        console.error('[LocalAI] Failed to load Whisper model:', error);
        sendToRenderer('whisper-downloading', false);
        sendToRenderer('update-status', 'Failed to load Whisper model: ' + error.message);
        isWhisperLoading = false;
        return null;
    }
}

function pcm16ToFloat32(pcm16Buffer) {
    const samples = pcm16Buffer.length / 2;
    const float32 = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
        float32[i] = pcm16Buffer.readInt16LE(i * 2) / 32768;
    }
    return float32;
}

async function transcribeAudio(pcm16kBuffer) {
    if (!whisperPipeline) {
        console.error('[LocalAI] Whisper pipeline not loaded');
        return null;
    }

    try {
        const float32Audio = pcm16ToFloat32(pcm16kBuffer);

        // Use the cached language preference (set in initializeLocalSession)
        // This avoids reading the preferences file from disk on every call.
        const result = await whisperPipeline(float32Audio, {
            sampling_rate: 16000,
            language: currentWhisperLanguage,
            task: 'transcribe',
        });

        const text = result.text?.trim();
        console.log('[LocalAI] Transcription:', text);
        return text;
    } catch (error) {
        console.error('[LocalAI] Transcription error:', error);
        return null;
    }
}

// ── Speech End Handler ──

async function handleSpeechEnd(audioData) {
    if (!isLocalActive) return;
    const speechEndedAt = Date.now();

    // Minimum audio length check (~0.5 seconds at 16kHz, 16-bit)
    if (audioData.length < 16000) {
        console.log('[LocalAI] Audio too short, skipping');
        sendToRenderer('update-status', 'Listening...');
        return;
    }

    // Final transcription is allowed to overlap a best-effort rolling pass so
    // speech-end never waits behind an interim caption.
    const transcription = await transcribeAudio(audioData);

    // Send final transcription to renderer (replacing any interim partial text)
    if (transcription && transcription.trim().length > 0) {
        console.log(
            '[SHADOW_LATENCY]',
            JSON.stringify({ path: 'local', stage: 'speech_end_to_transcription_ready', milliseconds: Date.now() - speechEndedAt })
        );
        sendToRenderer('interim-transcription', {
            text: transcription.trim(),
            isFinal: true,
        });
    }

    if (!transcription || transcription.trim() === '' || transcription.trim().length < 2) {
        console.log('[LocalAI] Empty transcription, skipping');
        sendToRenderer('update-status', 'Listening...');
        return;
    }

    const { getPreferences } = require('../storage');
    answerDebouncer.setDelay(getPreferences().responseDelayMs);
    sendToRenderer('update-status', 'Waiting for complete question...');
    answerDebouncer.schedule(transcription, async completeTranscription => {
        if (!isLocalActive) return;
        sendToRenderer('update-status', 'Generating response...');
        answerRequestedAt = Date.now();
        await sendToOllama(completeTranscription);
    });
}

// ── Ollama Chat ──

async function sendToOllama(transcription) {
    if (!ollamaClient || !ollamaModel) {
        console.error('[LocalAI] Ollama not configured');
        return;
    }

    console.log('[LocalAI] Sending to Ollama:', transcription.substring(0, 100) + '...');

    localConversationHistory.push({
        role: 'user',
        content: transcription.trim(),
    });

    // Keep history manageable
    if (localConversationHistory.length > 20) {
        localConversationHistory = localConversationHistory.slice(-20);
    }

    try {
        const messages = [{ role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' }, ...localConversationHistory];

        const response = await ollamaClient.chat({
            model: ollamaModel,
            messages,
            stream: true,
        });

        let fullText = '';
        let isFirst = true;

        for await (const part of response) {
            const token = part.message?.content || '';
            if (token) {
                if (isFirst && answerRequestedAt) {
                    console.log(
                        '[SHADOW_LATENCY]',
                        JSON.stringify({
                            path: 'local',
                            stage: 'transcription_ready_to_answer_first_token',
                            milliseconds: Date.now() - answerRequestedAt,
                        })
                    );
                    answerRequestedAt = 0;
                }
                fullText += token;
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        if (fullText.trim()) {
            localConversationHistory.push({
                role: 'assistant',
                content: fullText.trim(),
            });

            saveConversationTurn(transcription, fullText);
        }

        console.log('[LocalAI] Ollama response completed');
        sendToRenderer('update-status', 'Listening...');
    } catch (error) {
        console.error('[LocalAI] Ollama error:', error);
        sendToRenderer('update-status', 'Ollama error: ' + error.message);
    }
}

// ── Public API ──

async function initializeLocalSession(ollamaHost, model, whisperModel, profile, customPrompt) {
    console.log('[LocalAI] Initializing local session:', { ollamaHost, model, whisperModel, profile });

    sendToRenderer('session-initializing', true);

    try {
        // Setup system prompt
        currentSystemPrompt = getSystemPrompt(profile, customPrompt, false);

        // Cache language preference for Whisper (read once, avoid disk I/O on every call)
        try {
            const { normalizeLanguageCode, getPreferences } = require('./storage');
            const prefs = getPreferences();
            const normalized = normalizeLanguageCode(prefs.selectedLanguage || 'en-US');
            // Whisper uses 2-letter ISO 639-1 codes; extract from BCP-47 tag
            currentWhisperLanguage = normalized.split('-')[0] || 'en';
            setVadSilenceMs(prefs.vadSilenceMs);
        } catch {
            currentWhisperLanguage = 'en';
        }

        // Initialize Ollama client
        ollamaClient = new Ollama({ host: ollamaHost });
        ollamaModel = model;

        // Test Ollama connection
        try {
            await ollamaClient.list();
            console.log('[LocalAI] Ollama connection verified');
        } catch (error) {
            console.error('[LocalAI] Cannot connect to Ollama at', ollamaHost, ':', error.message);
            sendToRenderer('session-initializing', false);
            sendToRenderer('update-status', 'Cannot connect to Ollama at ' + ollamaHost);
            return false;
        }

        // Load Whisper model
        const pipeline = await loadWhisperPipeline(whisperModel);
        if (!pipeline) {
            sendToRenderer('session-initializing', false);
            return false;
        }

        // Initialize Silero VAD (non-blocking — will fall through if unavailable)
        try {
            await initializeSileroVAD(() => {
                sendToRenderer('update-status', 'Downloading voice detection model (first time only)...');
            });
            if (isAvailable()) {
                sileroVad = new VadProcessor();
                console.log('[LocalAI] Silero VAD initialized successfully');
            } else {
                console.warn('[LocalAI] Silero VAD unavailable; falling back to RMS-only VAD');
                sendToRenderer('update-status', 'Voice detection unavailable - using basic mode');
                sileroVad = null;
            }
        } catch (vadError) {
            console.warn('[LocalAI] Silero VAD init failed:', vadError.message, '— using RMS-only VAD');
            sendToRenderer('update-status', 'Voice detection unavailable - using basic mode');
            sileroVad = null;
        }

        // Reset VAD state
        isSpeaking = false;
        speechBuffers = [];
        silenceFrameCount = 0;
        speechFrameCount = 0;
        resampleRemainder = Buffer.alloc(0);
        localConversationHistory = [];
        lastRollingTranscriptionTime = 0;
        stopRollingTranscription();

        // Reset Silero VAD processor state
        if (sileroVad) {
            sileroVad.reset();
        }

        // Initialize conversation session
        initializeNewSession(profile, customPrompt);

        isLocalActive = true;
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'Local AI ready - Listening...');

        console.log('[LocalAI] Session initialized successfully');
        return true;
    } catch (error) {
        console.error('[LocalAI] Initialization error:', error);
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'Local AI error: ' + error.message);
        return false;
    }
}

function processLocalAudio(audioChunk, mimeType = 'audio/pcm;rate=24000') {
    if (!isLocalActive) return;

    const pcm16k = mimeType.includes('rate=16000') ? audioChunk : resample24kTo16k(audioChunk);
    if (pcm16k.length > 0) {
        // processVAD is now async (due to Silero VAD inference)
        processVAD(pcm16k).catch(err => {
            console.error('[LocalAI] VAD processing error:', err.message);
        });
    }
}

function closeLocalSession() {
    answerDebouncer.clear();
    console.log('[LocalAI] Closing local session');
    isLocalActive = false;
    isSpeaking = false;
    speechBuffers = [];
    silenceFrameCount = 0;
    speechFrameCount = 0;
    resampleRemainder = Buffer.alloc(0);
    localConversationHistory = [];
    ollamaClient = null;
    ollamaModel = null;
    currentSystemPrompt = null;
    sileroVad = null;
    lastRollingTranscriptionTime = 0;
    _isTranscribing = false;
    currentWhisperLanguage = 'en';
    stopRollingTranscription();
    // Note: whisperPipeline is kept loaded to avoid reloading on next session
}

function isLocalSessionActive() {
    return isLocalActive;
}

// ── Send text directly to Ollama (for manual text input) ──

async function sendLocalText(text) {
    if (!isLocalActive || !ollamaClient) {
        return { success: false, error: 'No active local session' };
    }

    try {
        await sendToOllama(text);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function sendLocalImage(base64Data, prompt) {
    if (!isLocalActive || !ollamaClient) {
        return { success: false, error: 'No active local session' };
    }

    try {
        console.log('[LocalAI] Sending image to Ollama');
        sendToRenderer('update-status', 'Analyzing image...');

        const userMessage = {
            role: 'user',
            content: prompt,
            images: [base64Data],
        };

        // Store text-only version in history
        localConversationHistory.push({ role: 'user', content: prompt });

        if (localConversationHistory.length > 20) {
            localConversationHistory = localConversationHistory.slice(-20);
        }

        const messages = [
            { role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' },
            ...localConversationHistory.slice(0, -1),
            userMessage,
        ];

        const response = await ollamaClient.chat({
            model: ollamaModel,
            messages,
            stream: true,
        });

        let fullText = '';
        let isFirst = true;

        for await (const part of response) {
            const token = part.message?.content || '';
            if (token) {
                fullText += token;
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        if (fullText.trim()) {
            localConversationHistory.push({ role: 'assistant', content: fullText.trim() });
            saveConversationTurn(prompt, fullText);
        }

        console.log('[LocalAI] Image response completed');
        sendToRenderer('update-status', 'Listening...');
        return { success: true, text: fullText, model: ollamaModel };
    } catch (error) {
        console.error('[LocalAI] Image error:', error);
        sendToRenderer('update-status', 'Ollama error: ' + error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    initializeLocalSession,
    processLocalAudio,
    closeLocalSession,
    isLocalSessionActive,
    sendLocalText,
    sendLocalImage,
    // Exported for unit testing
    resample24kTo16k,
    getRollingAudio,
    MAX_ROLLING_AUDIO_MS,
    setVadSilenceMs,
    verifyWhisperCache,
};

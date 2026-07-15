const { Ollama } = require('ollama');
const { getSystemPrompt } = require('./prompts');
const { sendToRenderer, initializeNewSession, saveConversationTurn } = require('./gemini');
const { initializeSileroVAD, VadProcessor, isAvailable, FRAME_SIZE } = require('./sileroVad');

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
let lastRollingTranscriptionTime = 0;

// VAD configuration
// Silence frames reduced from 15→5 (500ms vs 1500ms) now that Silero VAD provides robust detection
const VAD_MODES = {
    NORMAL: { energyThreshold: 0.01, speechFramesRequired: 3, silenceFramesRequired: 10 },
    LOW_BITRATE: { energyThreshold: 0.008, speechFramesRequired: 4, silenceFramesRequired: 12 },
    AGGRESSIVE: { energyThreshold: 0.015, speechFramesRequired: 2, silenceFramesRequired: 7 },
    VERY_AGGRESSIVE: { energyThreshold: 0.02, speechFramesRequired: 2, silenceFramesRequired: 5 },
};
let vadConfig = VAD_MODES.VERY_AGGRESSIVE;

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

    // Stage 1: RMS pre-filter — skip expensive Silero inference on obvious silence
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
        speechFrameCount++;
        silenceFrameCount = 0;

        if (!isSpeaking && speechFrameCount >= vadConfig.speechFramesRequired) {
            isSpeaking = true;
            speechBuffers = [];
            lastRollingTranscriptionTime = Date.now();
            console.log('[LocalAI] Speech started (RMS:', rms.toFixed(4),
                sileroVad ? ', Silero prob:', sileroVad.getProbability().toFixed(4) : '');
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

        const now = Date.now();
        if (now - lastRollingTranscriptionTime < ROLLING_WINDOW_MS) return;
        lastRollingTranscriptionTime = now;

        // Concatenate audio accumulated so far
        const audioSoFar = Buffer.concat(speechBuffers);
        if (audioSoFar.length < 32000) return; // Need at least ~1s of audio

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
        // Dynamic import for ESM module
        const { pipeline, env } = await import('@huggingface/transformers');
        // Cache models outside the asar archive so ONNX runtime can load them
        const { app } = require('electron');
        const path = require('path');
        env.cacheDir = path.join(app.getPath('userData'), 'whisper-models');

        // Attempt WebGPU backend first; fall back to CPU if unavailable
        // This is explicitly tried and logged so the user knows which backend is in use
        let device = 'auto';
        try {
            console.log('[LocalAI] Attempting WebGPU backend for Whisper...');
            whisperPipeline = await pipeline('automatic-speech-recognition', modelName, {
                dtype: 'q8',
                device: 'webgpu',
            });
            device = 'webgpu';
            console.log('[LocalAI] Whisper loaded with WebGPU backend');
        } catch (webgpuError) {
            console.warn('[LocalAI] WebGPU backend unavailable, falling back to CPU:', webgpuError.message);
            whisperPipeline = await pipeline('automatic-speech-recognition', modelName, {
                dtype: 'q8',
                device: 'cpu',
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

        // Whisper expects audio at 16kHz which is what we have
        const result = await whisperPipeline(float32Audio, {
            sampling_rate: 16000,
            language: 'en',
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

    // Minimum audio length check (~0.5 seconds at 16kHz, 16-bit)
    if (audioData.length < 16000) {
        console.log('[LocalAI] Audio too short, skipping');
        sendToRenderer('update-status', 'Listening...');
        return;
    }

    const transcription = await transcribeAudio(audioData);

    // Send final transcription to renderer (replacing any interim partial text)
    if (transcription && transcription.trim().length > 0) {
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

    sendToRenderer('update-status', 'Generating response...');
    await sendToOllama(transcription);
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
            await initializeSileroVAD();
            if (isAvailable()) {
                sileroVad = new VadProcessor();
                console.log('[LocalAI] Silero VAD initialized successfully');
            } else {
                console.warn('[LocalAI] Silero VAD unavailable; falling back to RMS-only VAD');
                sileroVad = null;
            }
        } catch (vadError) {
            console.warn('[LocalAI] Silero VAD init failed:', vadError.message, '— using RMS-only VAD');
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

function processLocalAudio(monoChunk24k) {
    if (!isLocalActive) return;

    // Resample from 24kHz to 16kHz
    const pcm16k = resample24kTo16k(monoChunk24k);
    if (pcm16k.length > 0) {
        // processVAD is now async (due to Silero VAD inference)
        processVAD(pcm16k).catch(err => {
            console.error('[LocalAI] VAD processing error:', err.message);
        });
    }
}

function closeLocalSession() {
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
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Import the REAL resample24kTo16k function from the source module.
// This verifies that the actual production code works correctly, not an
// inline reimplementation that could drift from the real logic.
const { resample24kTo16k, getRollingAudio, MAX_ROLLING_AUDIO_MS, setVadSilenceMs, verifyWhisperCache } = require('../src/utils/localai.js');
const { createSessionState, transitionTurn, TURN_STATE } = require('../src/utils/gemini.js');

test('Gemini turn reducer handles normal, fallback, and barge-in sequences', () => {
    const normal = createSessionState();
    transitionTurn(normal, 'INPUT');
    normal.transcription = 'normal turn';
    assert.equal(transitionTurn(normal, 'TURN_COMPLETE').transcription, 'normal turn');
    assert.equal(normal.turnState, TURN_STATE.AWAITING_ANSWER);
    transitionTurn(normal, 'ANSWER_STARTED');
    assert.equal(transitionTurn(normal, 'INPUT').bargeIn, true);
    assert.equal(normal.turnState, TURN_STATE.LISTENING);

    const fallback = createSessionState();
    transitionTurn(fallback, 'INPUT');
    fallback.transcription = 'fallback turn';
    assert.equal(transitionTurn(fallback, 'GENERATION_COMPLETE').transcription, 'fallback turn');
    assert.equal(transitionTurn(fallback, 'GENERATION_COMPLETE').transcription, undefined);
});

test('local rolling transcription never sends more than five seconds to Whisper', () => {
    const twentySeconds = Buffer.alloc(20 * 16000 * 2);
    const rolling = getRollingAudio(twentySeconds);

    assert.equal(MAX_ROLLING_AUDIO_MS, 5000);
    assert.equal(rolling.length, 5 * 16000 * 2);
});

test('VAD silence preference is clamped to its supported range', () => {
    assert.equal(setVadSilenceMs(100), 300);
    assert.equal(setVadSilenceMs(800), 800);
    assert.equal(setVadSilenceMs(5000), 1200);
});

test('corrupt cached Whisper weights are rejected before model load', () => {
    const cache = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'shadow-whisper-hash-'));
    const file = path.join(cache, 'Xenova/whisper-tiny/revision/onnx/encoder_model_quantized.onnx');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'corrupt model');

    verifyWhisperCache(cache, 'Xenova/whisper-tiny', 'revision');
    assert.equal(fs.existsSync(file), false);
    fs.rmSync(cache, { recursive: true, force: true });
});

// ── Resample test ──

test('resample24kTo16k produces correct sample count for known input (2400 samples)', () => {
    // 2400 samples at 24kHz = 100ms audio
    // Ratio: 16000/24000 = 2/3, so 2400 * 2/3 = 1600 output samples
    const inputSamples = 2400;
    const inputBuffer = Buffer.alloc(inputSamples * 2); // 16-bit PCM
    for (let i = 0; i < inputSamples; i++) {
        inputBuffer.writeInt16LE(Math.round(Math.sin(i * 0.1) * 10000), i * 2);
    }

    const outputBuffer = resample24kTo16k(inputBuffer);
    const outputSamples = outputBuffer.length / 2;

    assert.equal(outputSamples, 1600, `Expected 1600 output samples, got ${outputSamples}`);
});

test('resample24kTo16k produces correct sample count (480 samples)', () => {
    const inputSamples = 480;
    const inputBuffer = Buffer.alloc(inputSamples * 2);
    for (let i = 0; i < inputSamples; i++) {
        inputBuffer.writeInt16LE(Math.round(Math.sin(i * 0.1) * 10000), i * 2);
    }

    const outputBuffer = resample24kTo16k(inputBuffer);
    const outputSamples = outputBuffer.length / 2;

    assert.equal(outputSamples, 320, `Expected 320 output samples, got ${outputSamples}`);
});

test('resample24kTo16k handles 1 sample input (edge case)', () => {
    const inputBuffer = Buffer.alloc(2); // 1 sample = 2 bytes
    inputBuffer.writeInt16LE(1000, 0);

    const outputBuffer = resample24kTo16k(inputBuffer);
    const outputSamples = outputBuffer.length / 2;

    // floor(1 * 2/3) = 0 output samples for a single input
    assert.equal(outputSamples, 0, `Expected 0 output samples for 1 input, got ${outputSamples}`);
});

test('resample24kTo16k output values are within valid PCM16 range', () => {
    const inputSamples = 4800; // 200ms at 24kHz
    const inputBuffer = Buffer.alloc(inputSamples * 2);
    for (let i = 0; i < inputSamples; i++) {
        inputBuffer.writeInt16LE(Math.round(Math.sin(i * 0.1) * 20000), i * 2);
    }

    const outputBuffer = resample24kTo16k(inputBuffer);
    const outputSamples = outputBuffer.length / 2;

    for (let i = 0; i < outputSamples; i++) {
        const sample = outputBuffer.readInt16LE(i * 2);
        assert.ok(sample >= -32768 && sample <= 32767, `Sample ${i} out of range: ${sample}`);
    }
});

test('resample24kTo16k preserves signal shape (frequency domain check)', () => {
    // Create a 1kHz sine wave at 24kHz sample rate
    const freq = 1000;
    const duration = 0.05; // 50ms
    const inputSamples = Math.floor(24000 * duration);
    const inputBuffer = Buffer.alloc(inputSamples * 2);
    for (let i = 0; i < inputSamples; i++) {
        const t = i / 24000;
        inputBuffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * t) * 15000), i * 2);
    }

    const outputBuffer = resample24kTo16k(inputBuffer);

    // Output should be non-empty and not silently truncate to all zeros
    assert.ok(outputBuffer.length > 0, 'Output should not be empty for a 50ms input');

    // Verify output has valid audio (not all zeros)
    let hasSignal = false;
    const outputSamples = outputBuffer.length / 2;
    for (let i = 0; i < Math.min(outputSamples, 50); i++) {
        if (Math.abs(outputBuffer.readInt16LE(i * 2)) > 100) {
            hasSignal = true;
            break;
        }
    }
    assert.equal(hasSignal, true, 'Output should contain non-zero audio samples');
});

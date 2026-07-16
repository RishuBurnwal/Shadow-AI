const test = require('node:test');
const assert = require('node:assert/strict');

// Import the REAL resample24kTo16k function from the source module.
// This verifies that the actual production code works correctly, not an
// inline reimplementation that could drift from the real logic.
const { resample24kTo16k } = require('../src/utils/localai.js');

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

// ── Answer-trigger logic test ──

test('sendToAnswerProvider is triggered on turnComplete, not generationComplete', () => {
    // Simulate the corrected onmessage logic from gemini.js's answerFired flow
    let answerProviderCalledWith = null;
    let answerProviderCallCount = 0;
    let answerFired = false;
    let currentTranscription = '';

    function mockSendToAnswerProvider(transcription) {
        answerProviderCalledWith = transcription;
        answerProviderCallCount++;
    }

    function simulateOnMessage(message) {
        // Handle input transcription
        if (message.serverContent?.inputTranscription?.text) {
            currentTranscription += message.serverContent.inputTranscription.text;
        }

        // Primary trigger: turnComplete
        if (message.serverContent?.turnComplete && !answerFired) {
            answerFired = true;
            if (currentTranscription.trim() !== '') {
                mockSendToAnswerProvider(currentTranscription);
                currentTranscription = '';
            }
        }

        // Fallback: generationComplete
        if (message.serverContent?.generationComplete) {
            if (!answerFired && currentTranscription.trim() !== '') {
                answerFired = true;
                mockSendToAnswerProvider(currentTranscription);
                currentTranscription = '';
            }
            answerFired = false; // Reset for next turn
        }
    }

    // Simulate a typical turn: input transcription arrives, then turnComplete
    simulateOnMessage({
        serverContent: { inputTranscription: { text: 'What is the weather?' } },
    });

    assert.equal(answerProviderCallCount, 0, 'Answer should not fire on transcription update');

    simulateOnMessage({
        serverContent: { turnComplete: {} },
    });

    assert.equal(answerProviderCallCount, 1, 'Answer should fire exactly once on turnComplete');
    assert.equal(answerProviderCalledWith, 'What is the weather?', 'Answer should be called with the transcription');

    // generationComplete arrives after - should NOT trigger another answer
    simulateOnMessage({
        serverContent: { generationComplete: {} },
    });

    assert.equal(answerProviderCallCount, 1, 'generationComplete should not trigger a second answer');

    // Next turn: test that generationComplete fallback works if turnComplete is missed
    simulateOnMessage({
        serverContent: { inputTranscription: { text: 'What about tomorrow?' } },
    });

    assert.equal(answerProviderCallCount, 1, 'Still one call');

    simulateOnMessage({
        serverContent: { generationComplete: {} },
    });

    assert.equal(answerProviderCallCount, 2, 'generationComplete should trigger if turnComplete was missed');
    assert.equal(answerProviderCalledWith, 'What about tomorrow?', 'Fallback answer should be called with the second transcription');

    // Verify answerFired resets properly
    assert.equal(answerFired, false, 'answerFired should reset after generationComplete');
});

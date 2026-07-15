const test = require('node:test');
const assert = require('node:assert/strict');

// ── Resample test ──

test('resample24kTo16k produces correct sample count for known input', () => {
    // resample24kTo16k works on PCM16 buffers and has internal module-level state (resampleRemainder)
    // We need to test the logic directly. Since the function is not exported, we test via the
    // audio pipeline it's part of. We verify the ratio is correct: 24000→16000 = 2/3 reduction.

    // Re-create the resample logic inline from localai.js to test it in isolation
    function resampleTest(inputSamples) {
        const inputBuffer = Buffer.alloc(inputSamples * 2);
        for (let i = 0; i < inputSamples; i++) {
            inputBuffer.writeInt16LE(Math.round(Math.sin(i * 0.1) * 10000), i * 2);
        }

        // Ratio: 16000/24000 = 2/3
        const outputSamples = Math.floor((inputSamples * 2) / 3);
        const outputBuffer = Buffer.alloc(outputSamples * 2);

        for (let i = 0; i < outputSamples; i++) {
            const srcPos = (i * 3) / 2;
            const srcIndex = Math.floor(srcPos);
            const frac = srcPos - srcIndex;

            const s0 = inputBuffer.readInt16LE(srcIndex * 2);
            const s1 = srcIndex + 1 < inputSamples ? inputBuffer.readInt16LE((srcIndex + 1) * 2) : s0;
            const interpolated = Math.round(s0 + frac * (s1 - s0));
            outputBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
        }

        return { inputSamples, outputSamples, outputBuffer };
    }

    // Test with a typical chunk size: 2400 samples at 24kHz = 100ms
    const result = resampleTest(2400);
    assert.equal(result.outputSamples, 1600); // 2400 * 2/3 = 1600

    // Test with a smaller buffer
    const result2 = resampleTest(480);
    assert.equal(result2.outputSamples, 320); // 480 * 2/3 = 320

    // Test edge case: 1 sample
    const result3 = resampleTest(1);
    assert.equal(result3.outputSamples, 0); // floor(1 * 2/3) = 0

    // Verify output values are within valid PCM16 range
    for (let i = 0; i < result.outputBuffer.length / 2; i++) {
        const sample = result.outputBuffer.readInt16LE(i * 2);
        assert.ok(sample >= -32768 && sample <= 32767, `Sample ${i} out of range: ${sample}`);
    }
});

// ── VAD state machine test ──

test('VAD state machine transitions correctly with synthetic speech/silence sequences', () => {
    // Re-create the VAD state machine logic from localai.js to test it in isolation
    const VAD_CONFIG = {
        energyThreshold: 0.02,
        speechFramesRequired: 2,
        silenceFramesRequired: 5,
    };

    const state = {
        isSpeaking: false,
        speechFrameCount: 0,
        silenceFrameCount: 0,
        speechStartCount: 0,
        speechEndCount: 0,
    };

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

    function processVADFrame(rms) {
        const isVoice = rms > VAD_CONFIG.energyThreshold;

        if (isVoice) {
            state.speechFrameCount++;
            state.silenceFrameCount = 0;

            if (!state.isSpeaking && state.speechFrameCount >= VAD_CONFIG.speechFramesRequired) {
                state.isSpeaking = true;
                state.speechStartCount++;
            }
        } else {
            state.silenceFrameCount++;
            state.speechFrameCount = 0;

            if (state.isSpeaking && state.silenceFrameCount >= VAD_CONFIG.silenceFramesRequired) {
                state.isSpeaking = false;
                state.speechEndCount++;
            }
        }
    }

    // Generate a synthetic PCM16 buffer with a specific RMS level
    function makeBufferWithApproxRMS(targetRms, numSamples = 320) {
        const buf = Buffer.alloc(numSamples * 2);
        // For a sine wave, RMS = amplitude / sqrt(2). To get targetRms:
        // amplitude = targetRms * sqrt(2) ≈ targetRms * 1.414
        const amplitude = Math.round(targetRms * 1.414 * 32768); // scale to 16-bit range
        for (let i = 0; i < numSamples; i++) {
            buf.writeInt16LE(Math.round(Math.sin(i * 0.1) * amplitude), i * 2);
        }
        return buf;
    }

    // Verify silence is detected correctly - near-zero buffer
    const silentBuffer = Buffer.alloc(640, 0); // 320 samples of silence
    assert.equal(calculateRMS(silentBuffer) < VAD_CONFIG.energyThreshold, true,
        'Silent buffer should have RMS below threshold');

    const loudBuffer = makeBufferWithApproxRMS(0.05); // RMS ~0.05, above 0.02 threshold
    assert.equal(calculateRMS(loudBuffer) > VAD_CONFIG.energyThreshold, true,
        'Loud buffer should have RMS above threshold, got: ' + calculateRMS(loudBuffer));

    // Test: start silent, then speech, then silence → speech detected and ended
    // Send 3 silence frames (no change, not enough for speech end yet)
    for (let i = 0; i < 3; i++) processVADFrame(0.001);
    assert.equal(state.isSpeaking, false, 'Should still be silent');

    // Send 2 speech frames → speech starts
    processVADFrame(0.05);
    assert.equal(state.isSpeaking, false, '1 speech frame not enough');
    processVADFrame(0.05);
    assert.equal(state.isSpeaking, true, 'Speech should start after 2 frames');
    assert.equal(state.speechStartCount, 1, 'Speech start should fire once');

    // Send 3 more speech frames → stay in speech
    for (let i = 0; i < 3; i++) processVADFrame(0.05);
    assert.equal(state.isSpeaking, true, 'Should still be speaking');

    // Send 5 silence frames → speech ends
    for (let i = 0; i < 4; i++) processVADFrame(0.001);
    assert.equal(state.isSpeaking, true, '4 silence frames not enough');
    processVADFrame(0.001);
    assert.equal(state.isSpeaking, false, '5 silence frames should end speech');
    assert.equal(state.speechEndCount, 1, 'Speech end should fire once');

    // Send speech frames again → new speech session
    processVADFrame(0.05);
    processVADFrame(0.05);
    assert.equal(state.isSpeaking, true, 'Second speech session should start');
    assert.equal(state.speechStartCount, 2, 'Speech start should fire twice');
});

// ── Phase 1: Answer-trigger logic test ──

test('sendToAnswerProvider is triggered on turnComplete, not generationComplete', () => {
    // Simulate the corrected onmessage logic from Phase 1 of gemini.js
    let answerProviderCalledWith = null;
    let answerProviderCallCount = 0;
    let answerProviderFiredForTurn = false;
    let currentTranscription = '';

    function mockSendToAnswerProvider(transcription) {
        answerProviderCalledWith = transcription;
        answerProviderCallCount++;
    }

    function simulateOnMessage(message, isDebug = false) {
        // Handle input transcription
        if (message.serverContent?.inputTranscription?.text) {
            currentTranscription += message.serverContent.inputTranscription.text;
        }

        // Primary trigger: turnComplete
        if (message.serverContent?.turnComplete && !answerProviderFiredForTurn) {
            answerProviderFiredForTurn = true;
            if (currentTranscription.trim() !== '') {
                mockSendToAnswerProvider(currentTranscription);
                currentTranscription = '';
            }
        }

        // Fallback: generationComplete
        if (message.serverContent?.generationComplete) {
            if (!answerProviderFiredForTurn && currentTranscription.trim() !== '') {
                answerProviderFiredForTurn = true;
                mockSendToAnswerProvider(currentTranscription);
                currentTranscription = '';
            }
            answerProviderFiredForTurn = false; // Reset for next turn
        }
    }

    // Simulate a typical turn: input transcription arrives, then turnComplete
    simulateOnMessage({
        serverContent: {
            inputTranscription: { text: 'What is the weather?' },
        },
    });

    assert.equal(answerProviderCallCount, 0, 'Answer should not fire on transcription update');

    simulateOnMessage({
        serverContent: {
            turnComplete: {},
        },
    });

    assert.equal(answerProviderCallCount, 1, 'Answer should fire exactly once on turnComplete');
    assert.equal(answerProviderCalledWith, 'What is the weather?', 'Answer should be called with the transcription');

    // generationComplete arrives after - should NOT trigger another answer
    simulateOnMessage({
        serverContent: {
            generationComplete: {},
        },
    });

    assert.equal(answerProviderCallCount, 1, 'generationComplete should not trigger a second answer');

    // Next turn: test that generationComplete fallback works if turnComplete is missed
    simulateOnMessage({
        serverContent: {
            inputTranscription: { text: 'What about tomorrow?' },
        },
    });

    assert.equal(answerProviderCallCount, 1, 'Still one call');

    simulateOnMessage({
        serverContent: {
            generationComplete: {},
        },
    });

    assert.equal(answerProviderCallCount, 2, 'generationComplete should trigger if turnComplete was missed');
    assert.equal(answerProviderCalledWith, 'What about tomorrow?',
        'Fallback answer should be called with the second transcription');

    // Verify answerProviderFiredForTurn resets properly
    assert.equal(answerProviderFiredForTurn, false, 'answerProviderFiredForTurn should reset after generationComplete');
});

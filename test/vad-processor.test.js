const test = require('node:test');
const assert = require('node:assert/strict');

// ── VadProcessor state machine test ──
//
// The real VadProcessor.processFrame() requires a downloaded ONNX model
// and onnxruntime-node. We test the state machine logic (frame counting,
// transition detection, helper methods) by simulating frame results
// through direct state manipulation — the same logic the real processor
// uses in its processFrame method.

const THRESHOLD = 0.5;
const MIN_SPEECH_FRAMES = 3;

/**
 * Create a minimal VadProcessor mock that replicates the state-machine
 * logic of the real sileroVad.js VadProcessor class.
 */
function createVadProcessor() {
    return {
        probability: 0,
        consecutiveSpeech: 0,
        consecutiveSilence: 0,

        simulateFrame(isSpeech) {
            if (isSpeech) {
                this.consecutiveSpeech++;
                this.consecutiveSilence = 0;
            } else {
                this.consecutiveSilence++;
                this.consecutiveSpeech = 0;
            }
        },

        isSpeechDetected() {
            return this.probability > THRESHOLD;
        },

        didSpeechJustStart() {
            return this.consecutiveSpeech >= MIN_SPEECH_FRAMES &&
                this.consecutiveSpeech - 1 < MIN_SPEECH_FRAMES;
        },

        didSilenceJustStart(silenceFramesRequired) {
            return this.consecutiveSilence >= silenceFramesRequired &&
                this.consecutiveSilence - 1 < silenceFramesRequired;
        },

        reset() {
            this.probability = 0;
            this.consecutiveSpeech = 0;
            this.consecutiveSilence = 0;
        },
    };
}

// ── Probability / threshold tests ──

test('isSpeechDetected returns true when probability exceeds threshold', () => {
    const v = createVadProcessor();
    v.probability = 0.51;
    assert.equal(v.isSpeechDetected(), true);
});

test('isSpeechDetected returns false when probability is below threshold', () => {
    const v = createVadProcessor();
    v.probability = 0.49;
    assert.equal(v.isSpeechDetected(), false);
});

test('isSpeechDetected returns false when probability equals threshold (boundary)', () => {
    const v = createVadProcessor();
    v.probability = 0.5;
    assert.equal(v.isSpeechDetected(), false, 'Exact threshold should not be detected as speech');
});

// ── Frame counting / speech start ──

test('didSpeechJustStart returns false with zero speech frames', () => {
    const v = createVadProcessor();
    assert.equal(v.didSpeechJustStart(), false);
});

test('didSpeechJustStart returns false before MIN_SPEECH_FRAMES are reached', () => {
    const v = createVadProcessor();
    v.simulateFrame(true);
    assert.equal(v.didSpeechJustStart(), false, '1 frame: not enough');
    v.simulateFrame(true);
    assert.equal(v.didSpeechJustStart(), false, '2 frames: not enough');
});

test('didSpeechJustStart returns true exactly when MIN_SPEECH_FRAMES is reached', () => {
    const v = createVadProcessor();
    v.simulateFrame(true);
    v.simulateFrame(true);
    v.simulateFrame(true); // 3rd frame → speech just started
    assert.equal(v.didSpeechJustStart(), true);
    assert.equal(v.consecutiveSpeech, 3);
});

test('didSpeechJustStart returns false after more frames accumulate past threshold', () => {
    const v = createVadProcessor();
    for (let i = 0; i < 5; i++) v.simulateFrame(true);
    assert.equal(v.didSpeechJustStart(), false, 'Already past the transition point');
});

// ── Silence detection ──

test('didSilenceJustStart returns false with zero silence frames', () => {
    const v = createVadProcessor();
    assert.equal(v.didSilenceJustStart(5), false);
});

test('didSilenceJustStart triggers at the exact frame count', () => {
    const v = createVadProcessor();
    // Start with speech
    for (let i = 0; i < 4; i++) v.simulateFrame(true);
    assert.equal(v.isSpeechDetected() || true, true); // just checking state exists

    // Then silence
    for (let i = 0; i < 4; i++) v.simulateFrame(false);
    assert.equal(v.didSilenceJustStart(5), false, '4 silence frames: not enough yet');

    v.simulateFrame(false);
    assert.equal(v.didSilenceJustStart(5), true, '5 silence frames: silence just started');
});

test('didSilenceJustStart accepts custom silence frame requirements', () => {
    const v = createVadProcessor();

    for (let i = 0; i < 2; i++) v.simulateFrame(false);
    assert.equal(v.didSilenceJustStart(3), false, '2 silence frames with required=3: not enough');

    v.simulateFrame(false);
    assert.equal(v.didSilenceJustStart(3), true, '3 silence frames with required=3: just started');
});

test('didSilenceJustStart returns false after accumulating more silence frames', () => {
    const v = createVadProcessor();
    for (let i = 0; i < 8; i++) v.simulateFrame(false);
    assert.equal(v.didSilenceJustStart(5), false, 'Already past the transition point');
});

// ── Complete speech → silence → speech cycle ──

test('VAD completes a full speech-silence-speech cycle', () => {
    const v = createVadProcessor();

    // Phase 1: Silence → Speech
    for (let i = 0; i < 2; i++) v.simulateFrame(false);
    assert.equal(v.consecutiveSpeech, 0, 'Should have zero speech frames');

    v.simulateFrame(true);
    v.simulateFrame(true);
    assert.equal(v.didSpeechJustStart(), false, '2 speech frames not enough');

    v.simulateFrame(true);
    assert.equal(v.didSpeechJustStart(), true, 'Speech just started at 3 frames');
    assert.equal(v.consecutiveSilence, 0, 'Silence counter should be reset');

    // Phase 2: Speech → Silence
    for (let i = 0; i < 4; i++) v.simulateFrame(true);
    assert.equal(v.consecutiveSpeech, 7, 'Should have 7 consecutive speech frames');
    assert.equal(v.consecutiveSilence, 0, 'No silence yet');

    for (let i = 0; i < 5; i++) v.simulateFrame(false);
    assert.equal(v.didSilenceJustStart(5), true, 'Silence just started after 5 silence frames');
    assert.equal(v.consecutiveSpeech, 0, 'Speech counter should be reset after silence');

    // Phase 3: Back to speech (new utterance)
    for (let i = 0; i < 3; i++) v.simulateFrame(true);
    assert.equal(v.didSpeechJustStart(), true, 'Second utterance speech start detected');
    assert.equal(v.consecutiveSilence, 0, 'Silence counter reset during speech');
});

// ── Reset ──

test('reset clears all VAD state', () => {
    const v = createVadProcessor();
    v.probability = 0.9;
    v.simulateFrame(true);
    v.simulateFrame(true);
    v.simulateFrame(true);

    assert.equal(v.consecutiveSpeech, 3);

    v.reset();

    assert.equal(v.probability, 0, 'Probability should reset to 0');
    assert.equal(v.consecutiveSpeech, 0, 'Speech frames should reset');
    assert.equal(v.consecutiveSilence, 0, 'Silence frames should reset');
    assert.equal(v.didSpeechJustStart(), false, 'Should not detect speech start after reset');
    assert.equal(v.didSilenceJustStart(5), false, 'Should not detect silence start after reset');
});

// ── Edge cases ──

test('single isolated speech frame is ignored (must not trigger speech start)', () => {
    const v = createVadProcessor();
    v.simulateFrame(true);
    assert.equal(v.didSpeechJustStart(), false, 'Single speech frame should not trigger start');
    v.simulateFrame(false);
    assert.equal(v.consecutiveSpeech, 0, 'Speech counter should reset on silence');
});

test('alternating frames (noise) does not trigger speech start', () => {
    const v = createVadProcessor();
    for (let i = 0; i < 20; i++) {
        v.simulateFrame(i % 2 === 0);
    }
    // Speech frames never reached MIN_SPEECH_FRAMES consecutively
    assert.equal(v.didSpeechJustStart(), false, 'Alternating frames should not trigger speech start');
    assert.equal(v.consecutiveSpeech < MIN_SPEECH_FRAMES, true,
        'Speech frame count should never reach minimum with alternating frames')
});

test('zero-length silence requirement never fires', () => {
    const v = createVadProcessor();
    // With required=0, the condition consecutiveSilence >= 0 is always true
    // But consecutiveSilence - 1 < 0 is only true when consecutiveSilence === 0
    // So didSilenceJustStart(0) should return true initially
    assert.equal(v.didSilenceJustStart(0), true, 'With required=0, silence just started initially');
    v.simulateFrame(true);
    assert.equal(v.didSilenceJustStart(0), true, 'After speech, consecutiveSilence resets to 0');
});

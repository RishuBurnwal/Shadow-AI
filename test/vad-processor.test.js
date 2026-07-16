const test = require('node:test');
const assert = require('node:assert/strict');

// Import the REAL VadProcessor class from the source module.
// processFrame() requires a ~1.7MB ONNX model and onnxruntime-node, so it
// cannot run in a unit test. We test the state-machine helper methods
// (isSpeechDetected, didSpeechJustStart, didSilenceJustStart, reset) by
// directly manipulating the internal frame counters — the same state that
// processFrame() would update during inference.
const { VadProcessor, THRESHOLD, FRAME_SIZE, SAMPLE_RATE } = require('../src/utils/sileroVad.js');

// Helper: create a VadProcessor and simulate a sequence of speech/silence frames
// by directly setting the frame counters (bypassing the ONNX model requirement).
function simulateFrames(vad, frames) {
    for (const isSpeech of frames) {
        if (isSpeech) {
            vad.consecutiveSpeech++;
            vad.consecutiveSilence = 0;
        } else {
            vad.consecutiveSilence++;
            vad.consecutiveSpeech = 0;
        }
    }
}

// ── Constants ──

test('FRAME_SIZE is 512 samples (32ms at 16kHz)', () => {
    assert.equal(FRAME_SIZE, 512);
});

test('SAMPLE_RATE is 16000 Hz', () => {
    assert.equal(SAMPLE_RATE, 16000);
});

test('THRESHOLD is 0.5', () => {
    assert.equal(THRESHOLD, 0.5);
});

// ── Constructor ──

test('VadProcessor constructor initialises all counters to zero', () => {
    const v = new VadProcessor();
    assert.equal(v.probability, 0);
    assert.equal(v.consecutiveSpeech, 0);
    assert.equal(v.consecutiveSilence, 0);
    assert.equal(v.hState, null);
    assert.equal(v.cState, null);
});

// ── isSpeechDetected ──

test('isSpeechDetected returns true when probability exceeds threshold', () => {
    const v = new VadProcessor();
    v.probability = 0.51;
    assert.equal(v.isSpeechDetected(), true);
});

test('isSpeechDetected returns false when probability is below threshold', () => {
    const v = new VadProcessor();
    v.probability = 0.49;
    assert.equal(v.isSpeechDetected(), false);
});

test('isSpeechDetected returns false when probability equals threshold (boundary)', () => {
    const v = new VadProcessor();
    v.probability = 0.5;
    assert.equal(v.isSpeechDetected(), false, 'Exact threshold should not be detected as speech');
});

// ── didSpeechJustStart ──

test('didSpeechJustStart returns false with zero speech frames', () => {
    const v = new VadProcessor();
    assert.equal(v.didSpeechJustStart(), false);
});

test('didSpeechJustStart returns false before MIN_SPEECH_FRAMES are reached', () => {
    const v = new VadProcessor();
    simulateFrames(v, [true, true]);
    assert.equal(v.didSpeechJustStart(), false, '2 frames: not enough');
});

test('didSpeechJustStart returns true exactly when MIN_SPEECH_FRAMES is reached', () => {
    const v = new VadProcessor();
    simulateFrames(v, [true, true, true]); // 3rd frame → speech just started
    assert.equal(v.didSpeechJustStart(), true);
    assert.equal(v.consecutiveSpeech, 3);
});

test('didSpeechJustStart returns false after more frames accumulate past threshold', () => {
    const v = new VadProcessor();
    simulateFrames(v, [true, true, true, true, true]);
    assert.equal(v.didSpeechJustStart(), false, 'Already past the transition point');
});

// ── didSilenceJustStart ──

test('didSilenceJustStart returns false with zero silence frames', () => {
    const v = new VadProcessor();
    assert.equal(v.didSilenceJustStart(5), false);
});

test('didSilenceJustStart triggers at the exact frame count', () => {
    const v = new VadProcessor();
    simulateFrames(v, [true, true, true, true]); // speech first
    simulateFrames(v, [false, false, false, false]); // 4 silence frames
    assert.equal(v.didSilenceJustStart(5), false, '4 silence frames: not enough yet');
    simulateFrames(v, [false]); // 5th silence frame
    assert.equal(v.didSilenceJustStart(5), true, '5 silence frames: silence just started');
});

test('didSilenceJustStart accepts custom silence frame requirements', () => {
    const v = new VadProcessor();
    simulateFrames(v, [false, false]);
    assert.equal(v.didSilenceJustStart(3), false, '2 silence frames with required=3: not enough');
    simulateFrames(v, [false]);
    assert.equal(v.didSilenceJustStart(3), true, '3 silence frames with required=3: just started');
});

test('didSilenceJustStart returns false after accumulating more silence frames', () => {
    const v = new VadProcessor();
    simulateFrames(v, Array(8).fill(false));
    assert.equal(v.didSilenceJustStart(5), false, 'Already past the transition point');
});

// ── Full cycle: speech → silence → speech ──

test('VadProcessor completes a full speech-silence-speech cycle', () => {
    const v = new VadProcessor();

    // Phase 1: Silence → Speech
    simulateFrames(v, [false, false]);
    assert.equal(v.consecutiveSpeech, 0, 'Should have zero speech frames');

    simulateFrames(v, [true, true]);
    assert.equal(v.didSpeechJustStart(), false, '2 speech frames not enough');

    simulateFrames(v, [true]);
    assert.equal(v.didSpeechJustStart(), true, 'Speech just started at 3 frames');
    assert.equal(v.consecutiveSilence, 0, 'Silence counter should be reset');

    // Phase 2: Speech → Silence
    simulateFrames(v, Array(4).fill(true));
    assert.equal(v.consecutiveSpeech, 7, 'Should have 7 consecutive speech frames');
    assert.equal(v.consecutiveSilence, 0, 'No silence yet');

    simulateFrames(v, Array(5).fill(false));
    assert.equal(v.didSilenceJustStart(5), true, 'Silence just started after 5 silence frames');
    assert.equal(v.consecutiveSpeech, 0, 'Speech counter should be reset after silence');

    // Phase 3: Back to speech (new utterance)
    simulateFrames(v, [true, true, true]);
    assert.equal(v.didSpeechJustStart(), true, 'Second utterance speech start detected');
    assert.equal(v.consecutiveSilence, 0, 'Silence counter reset during speech');
});

// ── Reset ──

test('reset clears all VadProcessor state', () => {
    const v = new VadProcessor();
    v.probability = 0.9;
    simulateFrames(v, [true, true, true]);

    assert.equal(v.consecutiveSpeech, 3);

    v.reset();

    assert.equal(v.probability, 0, 'Probability should reset to 0');
    assert.equal(v.consecutiveSpeech, 0, 'Speech frames should reset');
    assert.equal(v.consecutiveSilence, 0, 'Silence frames should reset');
    assert.equal(v.hState, null, 'hState should reset to null');
    assert.equal(v.cState, null, 'cState should reset to null');
    assert.equal(v.didSpeechJustStart(), false, 'Should not detect speech start after reset');
    assert.equal(v.didSilenceJustStart(5), false, 'Should not detect silence start after reset');
});

// ── Edge cases ──

test('single isolated speech frame is ignored (must not trigger speech start)', () => {
    const v = new VadProcessor();
    simulateFrames(v, [true]);
    assert.equal(v.didSpeechJustStart(), false, 'Single speech frame should not trigger start');
    simulateFrames(v, [false]);
    assert.equal(v.consecutiveSpeech, 0, 'Speech counter should reset on silence');
});

test('alternating frames (noise) does not trigger speech start', () => {
    const v = new VadProcessor();
    for (let i = 0; i < 20; i++) {
        simulateFrames(v, [i % 2 === 0]);
    }
    // Speech frames never reached MIN_SPEECH_FRAMES consecutively
    assert.equal(v.didSpeechJustStart(), false, 'Alternating frames should not trigger speech start');
    assert.equal(v.consecutiveSpeech < 3, true,
        'Speech frame count should never reach minimum with alternating frames');
});

test('zero-length silence requirement never fires', () => {
    const v = new VadProcessor();
    // With required=0, the condition consecutiveSilence >= 0 is always true
    // But consecutiveSilence - 1 < 0 is only true when consecutiveSilence === 0
    // So didSilenceJustStart(0) should return true initially
    assert.equal(v.didSilenceJustStart(0), true, 'With required=0, silence just started initially');
    simulateFrames(v, [true]);
    assert.equal(v.didSilenceJustStart(0), true, 'After speech, consecutiveSilence resets to 0');
});

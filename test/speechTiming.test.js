const test = require('node:test');
const assert = require('node:assert/strict');
const { createTurnDebouncer, normalizeSilenceMs } = require('../src/utils/turnDebouncer');
const { createAudioSession } = require('../src/utils/audioProviders');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const speech = () => {
    const pcm = Buffer.alloc(4800);
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(1000, i);
    return pcm;
};

test('brief pauses remain one question until configured silence is complete', async () => {
    let calls = 0;
    const session = createAudioSession({
        getSilenceMs: () => 1800,
        onTranscript() {},
        onError(error) {
            throw error;
        },
        transcribe: async () => {
            calls++;
            return { text: 'whole question' };
        },
    });
    for (let i = 0; i < 8; i++) session.push(speech());
    for (let i = 0; i < 10; i++) session.push(Buffer.alloc(4800));
    await session.drain();
    assert.equal(calls, 0, 'one-second thinking pause must not finalize');
    for (let i = 0; i < 8; i++) session.push(speech());
    for (let i = 0; i < 19; i++) session.push(Buffer.alloc(4800));
    await session.drain();
    assert.equal(calls, 1);
    session.close();
});

test('late transcript cannot start answer while resumed speech is still active', async () => {
    const answers = [],
        pending = [];
    const debouncer = createTurnDebouncer(15);
    const session = createAudioSession({
        getSilenceMs: () => 700,
        onListeningChange: active => debouncer.hold(active),
        onSpeech: () => debouncer.interrupt(),
        onTranscript: text => debouncer.schedule(text, value => answers.push(value)),
        onError(error) {
            throw error;
        },
        transcribe: () => new Promise(resolve => pending.push(resolve)),
    });
    for (let i = 0; i < 5; i++) session.push(speech());
    for (let i = 0; i < 8; i++) session.push(Buffer.alloc(4800));
    await wait(0);
    for (let i = 0; i < 5; i++) session.push(speech());
    pending.shift()({ text: 'first part' });
    await wait(40);
    assert.deepEqual(answers, [], 'old transcript must be held during resumed speech');
    for (let i = 0; i < 8; i++) session.push(Buffer.alloc(4800));
    await wait(0);
    pending.shift()({ text: 'second part' });
    await session.drain();
    await wait(40);
    assert.deepEqual(answers, ['first part second part']);
    session.close();
    debouncer.clear();
});

test('new speech restarts the entire extra response delay; clear cancels it', async () => {
    const answers = [];
    const d = createTurnDebouncer(40);
    d.schedule('first', text => answers.push(text));
    await wait(15);
    d.hold(true);
    await wait(50);
    assert.deepEqual(answers, []);
    d.schedule('second', text => answers.push(text));
    d.hold(false);
    await wait(15);
    assert.deepEqual(answers, []);
    await wait(45);
    assert.deepEqual(answers, ['first second']);
    d.schedule('discard', text => answers.push(text));
    d.clear();
    await wait(55);
    assert.equal(answers.length, 1);
    assert.equal(normalizeSilenceMs(100000), 10000);
    assert.equal(normalizeSilenceMs(-1), 1200);
});

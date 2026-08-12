const test = require('node:test');
const assert = require('node:assert/strict');

const { buildListenUrl, createTranscriptAssembler } = require('../src/utils/deepgram');

test('Deepgram listen URL matches captured mono PCM and Nova-3', () => {
    const url = new URL(buildListenUrl('en-US', 24000));
    assert.equal(url.origin, 'wss://api.deepgram.com');
    assert.equal(url.pathname, '/v1/listen');
    assert.equal(url.searchParams.get('model'), 'nova-3');
    assert.equal(url.searchParams.get('encoding'), 'linear16');
    assert.equal(url.searchParams.get('sample_rate'), '24000');
    assert.equal(url.searchParams.get('interim_results'), 'true');
    assert.equal(url.searchParams.get('language'), 'en-US');
});

test('Deepgram results assemble one final utterance without duplicating finalized segments', () => {
    const interim = [];
    const final = [];
    const accept = createTranscriptAssembler({ onInterim: text => interim.push(text), onFinal: text => final.push(text) });

    accept({ type: 'Results', is_final: true, speech_final: false, channel: { alternatives: [{ transcript: 'What is' }] } });
    accept({ type: 'Results', is_final: false, speech_final: false, channel: { alternatives: [{ transcript: 'your name' }] } });
    accept({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: 'your name?' }] } });
    accept({ type: 'UtteranceEnd' });

    assert.deepEqual(interim, ['What is', 'What is your name', 'What is your name?']);
    assert.deepEqual(final, ['What is your name?']);
});

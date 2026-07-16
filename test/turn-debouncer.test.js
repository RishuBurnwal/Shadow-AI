const test = require('node:test');
const assert = require('node:assert/strict');
const { createTurnDebouncer, normalizeResponseDelayMs } = require('../src/utils/turnDebouncer');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('response delay defaults to 1500 ms and is bounded', () => {
    assert.equal(normalizeResponseDelayMs(undefined), 1500);
    assert.equal(normalizeResponseDelayMs(1750), 1750);
    assert.equal(normalizeResponseDelayMs(-10), 0);
    assert.equal(normalizeResponseDelayMs(20000), 10000);
});

test('new speech resets wait and combines transcript parts', async () => {
    const debouncer = createTurnDebouncer(30);
    const results = [];
    debouncer.schedule('What is', text => results.push(text));
    await wait(15);
    debouncer.interrupt();
    debouncer.schedule('Node.js?', text => results.push(text));
    await wait(20);
    assert.deepEqual(results, []);
    await wait(20);
    assert.deepEqual(results, ['What is Node.js?']);
});

test('clear removes pending question and timer', async () => {
    const debouncer = createTurnDebouncer(10);
    const results = [];
    debouncer.schedule('discard me', text => results.push(text));
    debouncer.clear();
    await wait(20);
    assert.deepEqual(results, []);
});

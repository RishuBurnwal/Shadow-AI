const test = require('node:test');
const assert = require('node:assert/strict');

const { getNewUsageChars, getRecentConversationHistory, trimConversationHistoryForGemini } = require('../src/utils/gemini');

test('counts only new input and output across a multi-turn conversation', () => {
    const turns = Array.from({ length: 10 }, () => ({ input: 'question', output: 'answer' }));
    const counted = turns.reduce((total, turn) => total + getNewUsageChars(turn.input, turn.output), 0);

    assert.equal(counted, 10 * ('question'.length + 'answer'.length));
});

test('counts screen prompt and generated answer', () => {
    assert.equal(getNewUsageChars('analyze this screen', 'visible answer'), 'analyze this screen'.length + 'visible answer'.length);
});

test('sends only the latest exchange as context', () => {
    const history = Array.from({ length: 10 }, (_, index) => ({ role: 'user', content: `turn-${index}` }));

    assert.deepEqual(
        getRecentConversationHistory(history).map(turn => turn.content),
        ['turn-8', 'turn-9']
    );
    assert.equal(trimConversationHistoryForGemini(history).length, 2);
});

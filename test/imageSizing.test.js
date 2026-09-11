const test = require('node:test');
const assert = require('node:assert/strict');

const { fitImageDimensions } = require('../src/utils/imageSizing');

test('caps a high-resolution screenshot without distorting its aspect ratio', () => {
    assert.deepEqual(fitImageDimensions(3840, 2160), { width: 1280, height: 720 });
});

test('does not upscale a small screenshot', () => {
    assert.deepEqual(fitImageDimensions(1024, 768), { width: 1024, height: 768 });
});

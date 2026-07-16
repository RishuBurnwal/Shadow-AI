const test = require('node:test');
const assert = require('node:assert/strict');
const { extractResumePdf } = require('../src/skills/resumePdf');

test('resume PDF import rejects empty, oversized, and non-PDF input', async () => {
    await assert.rejects(extractResumePdf(Buffer.alloc(0)), /Choose a PDF/);
    await assert.rejects(extractResumePdf(Buffer.alloc(10 * 1024 * 1024 + 1)), /10 MB or smaller/);
    await assert.rejects(extractResumePdf(Buffer.from('not a pdf')), /not a valid PDF/);
});

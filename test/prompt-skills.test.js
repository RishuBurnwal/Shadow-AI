const test = require('node:test');
const assert = require('node:assert/strict');

const { createSkill, deleteSkill, getStarterSkills, normalizeSkills, updateSkill } = require('../src/skills/promptSkills');

test('starter catalog provides distinct disabled prompt-based skills', () => {
    const starters = getStarterSkills();
    assert.equal(starters.length, 6);
    assert.equal(
        starters.every(skill => skill.enabled === false && skill.prompt.length > 30),
        true
    );
    assert.deepEqual(
        starters.map(skill => skill.name),
        [
            'Instructor & Guide',
            'Professional Answer',
            'Screen Analyst',
            'Interview Answer Coach',
            'Step-by-Step Problem Solver',
            'Summary & Action Items',
        ]
    );
});

test('prompt skill CRUD preserves identity while allowing rename and prompt edits', () => {
    const created = createSkill([], { name: 'Concise', description: 'Short answers', prompt: 'Reply in two sentences.' });
    assert.equal(created.skill.enabled, true);
    assert.match(created.skill.id, /^prompt-/);

    const updated = updateSkill(created.skills, created.skill.id, { name: 'Executive concise', prompt: 'Reply in one sentence.' });
    assert.equal(updated.skill.id, created.skill.id);
    assert.equal(updated.skill.name, 'Executive concise');
    assert.equal(updated.skill.prompt, 'Reply in one sentence.');
    assert.deepEqual(deleteSkill(updated.skills, created.skill.id), []);
});

test('prompt skills validate required fields and missing ids', () => {
    assert.throws(() => createSkill([], { name: '', prompt: 'Valid' }), /name is required/i);
    assert.throws(() => createSkill([], { name: 'Valid', prompt: '' }), /prompt is required/i);
    assert.throws(() => updateSkill([], 'missing', { name: 'X' }), /not found/i);
    assert.throws(() => deleteSkill([], 'missing'), /not found/i);
});

test('normalization sanitizes control characters, duplicates and invalid records', () => {
    const result = normalizeSkills([
        { id: 'one', name: ' First\n', description: 'ok', prompt: 'Do\u0000 this', enabled: false },
        { id: 'one', name: 'Duplicate', prompt: 'Ignore' },
        { id: 'bad', name: '', prompt: '' },
    ]);
    assert.deepEqual(result, [{ id: 'one', name: 'First', description: 'ok', prompt: 'Do  this', enabled: false }]);
});

test('prompt skill collection is bounded', () => {
    const full = Array.from({ length: 50 }, (_, index) => ({ id: `s-${index}`, name: `Skill ${index}`, prompt: 'Do it.' }));
    assert.throws(() => createSkill(full, { name: 'One too many', prompt: 'No.' }), /maximum of 50/i);
});

const MAX_SKILLS = 50;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_PROMPT_LENGTH = 12000;

function cleanText(value, maxLength) {
    return String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function normalizeSkill(input, existingId = '') {
    const name = cleanText(input?.name, MAX_NAME_LENGTH);
    const description = cleanText(input?.description, MAX_DESCRIPTION_LENGTH);
    const prompt = cleanText(input?.prompt, MAX_PROMPT_LENGTH);
    if (!name) throw new Error('Skill name is required.');
    if (!prompt) throw new Error('Skill prompt is required.');

    return {
        id: existingId || `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        description,
        prompt,
        enabled: input?.enabled !== false,
    };
}

function normalizeSkills(value) {
    if (!Array.isArray(value)) return [];
    const ids = new Set();
    const result = [];
    for (const item of value.slice(0, MAX_SKILLS)) {
        try {
            const id = cleanText(item?.id, 120);
            if (!id || ids.has(id)) continue;
            ids.add(id);
            result.push(normalizeSkill(item, id));
        } catch {
            // Invalid persisted records are ignored instead of breaking prompt creation.
        }
    }
    return result;
}

function createSkill(skills, input) {
    const current = normalizeSkills(skills);
    if (current.length >= MAX_SKILLS) throw new Error(`A maximum of ${MAX_SKILLS} skills is supported.`);
    const skill = normalizeSkill(input);
    return { skills: [...current, skill], skill };
}

function updateSkill(skills, id, updates) {
    const current = normalizeSkills(skills);
    const index = current.findIndex(skill => skill.id === id);
    if (index < 0) throw new Error('Skill not found.');
    const skill = normalizeSkill({ ...current[index], ...updates }, id);
    current[index] = skill;
    return { skills: current, skill };
}

function deleteSkill(skills, id) {
    const current = normalizeSkills(skills);
    if (!current.some(skill => skill.id === id)) throw new Error('Skill not found.');
    return current.filter(skill => skill.id !== id);
}

module.exports = { createSkill, deleteSkill, normalizeSkills, updateSkill };

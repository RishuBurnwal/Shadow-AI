const MAX_SKILLS = 50;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_PROMPT_LENGTH = 12000;
const STARTER_SKILLS_VERSION = 1;

const STARTER_SKILLS = [
    {
        id: 'starter-instructor',
        name: 'Instructor & Guide',
        description: 'Teaches concepts clearly, checks assumptions, and guides you step by step.',
        prompt: 'Act as a patient expert instructor. Explain the concept from fundamentals, break difficult work into numbered steps, include a practical example, point out common mistakes, and end with the next action the user should take. Adapt the depth to the apparent experience level of the user.',
        enabled: false,
    },
    {
        id: 'starter-professional-answer',
        name: 'Professional Answer',
        description: 'Answers the exact question directly in polished professional language.',
        prompt: 'Answer the exact question being asked as a knowledgeable professional. Lead with the answer, stay factual and relevant, use clear business-ready language, and avoid filler, repetition, coaching commentary, or unrelated background.',
        enabled: false,
    },
    {
        id: 'starter-screen-analyst',
        name: 'Screen Analyst',
        description: 'Examines visible screen content and explains what it means and what to do next.',
        prompt: 'Act as a meticulous screen analyst. Inspect all visible text, controls, errors, data, and layout before answering. Explain what is currently happening, identify important details or problems, connect related screen elements, and give precise next steps. Never claim to see an element that is not visible.',
        enabled: false,
    },
    {
        id: 'starter-interview-coach',
        name: 'Interview Answer Coach',
        description: 'Creates concise, ready-to-speak interview answers using the user profile.',
        prompt: 'For interview questions, provide a confident answer the user can speak immediately. Use their stored experience and projects, prefer specific evidence over generic claims, use STAR structure for behavioral questions, and keep the answer natural and concise.',
        enabled: false,
    },
    {
        id: 'starter-problem-solver',
        name: 'Step-by-Step Problem Solver',
        description: 'Diagnoses a problem carefully and provides an actionable solution.',
        prompt: 'Solve the presented problem systematically. State the likely cause, show the smallest reliable solution in ordered steps, include checks that confirm success, and mention important risks or assumptions. Do not invent missing evidence.',
        enabled: false,
    },
    {
        id: 'starter-action-summary',
        name: 'Summary & Action Items',
        description: 'Turns conversations or screen content into decisions and next actions.',
        prompt: 'Summarize the supplied conversation or screen content into: key points, decisions, unresolved questions, and concrete action items with owners or priorities when available. Keep the summary compact and do not add facts that were not provided.',
        enabled: false,
    },
];

function getStarterSkills() {
    return STARTER_SKILLS.map(skill => ({ ...skill }));
}

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

module.exports = { STARTER_SKILLS_VERSION, createSkill, deleteSkill, getStarterSkills, normalizeSkills, updateSkill };

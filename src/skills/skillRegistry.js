// skillRegistry.js — Minimal skill system
//
// Each skill is a module exporting:
//   id          — unique string key
//   label       — human-readable name
//   description — short explanation for the UI
//   isEnabledForProfile(profile) — whether the skill should activate for this profile
//   getPromptFragment({ profile, memory }) — optional; returns prompt text or null
//   action({ profile, memory, storage }) — optional; UI-callable action, returns result

const starAnswer = require('./starAnswer');
const resumeSync = require('./resumeSync');

const ALL_SKILLS = [starAnswer, resumeSync];

function getAllSkills() {
    return ALL_SKILLS;
}

function getSkillsForProfile(profile, enabledSkills = null) {
    return ALL_SKILLS.filter(s => {
        if (!s.isEnabledForProfile(profile)) return false;
        // If enabledSkills list is provided, check it; otherwise default to enabled
        if (Array.isArray(enabledSkills)) return enabledSkills.includes(s.id);
        return true;
    });
}

function getSkillPromptFragments(profile, enabledSkills = null) {
    const fragments = [];
    for (const skill of getSkillsForProfile(profile, enabledSkills)) {
        if (typeof skill.getPromptFragment === 'function') {
            const text = skill.getPromptFragment({ profile });
            if (text) fragments.push(text);
        }
    }
    return fragments;
}

function getSkillById(id) {
    return ALL_SKILLS.find(s => s.id === id) || null;
}

module.exports = {
    getAllSkills,
    getSkillsForProfile,
    getSkillPromptFragments,
    getSkillById,
};

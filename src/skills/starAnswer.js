// starAnswer.js — STAR Method skill
//
// Adds a prompt fragment instructing the assistant to structure
// behavioral-question answers using the STAR framework and to use
// the user's actual past projects as concrete examples.

const skill = {
    id: 'star-answer',
    label: 'STAR Method Answers',
    description:
        'Structures behavioral interview answers using Situation, Task, Action, Result. Uses your stored projects as real examples.',

    isEnabledForProfile(profile) {
        return profile === 'interview';
    },

    getPromptFragment({ profile }) {
        return `\n\n**STAR METHOD INSTRUCTION:**\nWhen asked behavioral questions (\"Tell me about a time when...\"), structure your response using the STAR format:\n- **Situation** — Set the context briefly\n- **Task** — What needed to be done\n- **Action** — What YOU specifically did (use "I", not "we")\n- **Result** — The outcome with measurable impact\n\nUse the candidate's actual past projects and experience from the profile above as concrete examples. Never make up generic examples — always reference real projects the candidate has listed.`;
    },
};

module.exports = skill;

// resumeSync.js — Resume-sync skill
//
// Lets the user paste a resume and auto-populate their static profile
// (name, targetRole, keySkills, etc.) via an LLM extraction pass.
// The extracted data is never saved silently — the user reviews it first.

const skill = {
    id: 'resume-sync',
    label: 'Resume Sync',
    description:
        'Paste a resume and auto-fill your profile (name, skills, experience) using AI. Review before saving.',

    // Available for all profiles
    isEnabledForProfile() {
        return true;
    },

    // No prompt fragment — this is an action-based skill
    getPromptFragment() {
        return null;
    },

    // Action: extract profile data from resume text via LLM
    async action({ resumeText }) {
        if (!resumeText || !resumeText.trim()) {
            return { success: false, error: 'No resume text provided.' };
        }

        const prompt = `Extract structured profile information from the following resume. Return ONLY a JSON object with these fields:
- name: full name (string)
- targetRole: most likely target job title (string)
- experienceSummary: 2-3 sentence career summary (string)
- keySkills: array of skill strings
- preferredTone: "professional" (string)

Resume:
-----
${resumeText.slice(0, 8000)}
-----

Return ONLY the JSON object, no other text.`;

        try {
            const { streamWithFallback } = require('../utils/providerRouter');
            const { syncProviderEnvironment } = require('../utils/providerEnv');
            const { getGroqApiKey, getApiKey } = require('../storage');

            const credentials = syncProviderEnvironment();
            const env = {
                ...process.env,
                GROQ_API_KEY: getGroqApiKey() || process.env.GROQ_API_KEY,
                GEMINI_API_KEY: getApiKey() || process.env.GEMINI_API_KEY,
                OPENROUTER_API_KEY: credentials.openrouterApiKey || process.env.OPENROUTER_API_KEY,
                OPENAI_API_KEY: credentials.openaiApiKey || process.env.OPENAI_API_KEY,
                PERPLEXITY_API_KEY: credentials.perplexityApiKey || process.env.PERPLEXITY_API_KEY,
                NVIDIA_API_KEY: credentials.nvidiaApiKey || process.env.NVIDIA_API_KEY,
            };
            const { getConfiguredProviders } = require('../utils/providerRouter');
            const providers = getConfiguredProviders(env);
            const openaiProviders = providers.filter(p => (p.transport || 'openai') === 'openai');

            if (openaiProviders.length === 0) {
                return { success: false, error: 'No AI provider configured. Add an API key in Settings.' };
            }

            const result = await streamWithFallback({
                providers: openaiProviders,
                messages: [{ role: 'user', content: prompt }],
                onToken: () => {},
            });

            const text = result.text.trim();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { success: false, error: 'Could not parse AI response. Try again.' };
            }

            const parsed = JSON.parse(jsonMatch[0]);
            const profile = {
                name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
                targetRole: typeof parsed.targetRole === 'string' ? parsed.targetRole.trim() : '',
                experienceSummary: typeof parsed.experienceSummary === 'string' ? parsed.experienceSummary.trim() : '',
                keySkills: Array.isArray(parsed.keySkills) ? parsed.keySkills.filter(s => typeof s === 'string').map(s => s.trim()).filter(Boolean) : [],
                preferredTone: 'professional',
            };

            return { success: true, profile };
        } catch (error) {
            return { success: false, error: error.message || 'Extraction failed.' };
        }
    },
};

module.exports = skill;

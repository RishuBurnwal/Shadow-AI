// Shared by Node and the isolated browser renderer. No private content lives here.
(function (root) {
    const MODES = ['interview', 'quiz', 'sales', 'meeting', 'presentation', 'negotiation', 'exam'];
    function defaults(mode) {
        const career = mode === 'interview';
        const visual = ['quiz', 'exam'].includes(mode);
        return {
            skills: true,
            resume: career,
            jd: career,
            additional: !visual,
            memory: career,
            history: !visual,
            audio: !visual,
            screen: visual ? 'automatic' : 'manual',
            attachScreen: false,
            skillIds: null,
        };
    }
    function resolve(preferences = {}, mode = preferences.selectedProfile || 'interview') {
        const selected = (Array.isArray(preferences.contextProfiles) ? preferences.contextProfiles : []).find(
            p => p && p.id === preferences.activeContextProfiles?.[mode] && p.mode === mode
        );
        const base = defaults(mode);
        const saved = selected?.rules || preferences.contextRules?.[mode] || {};
        for (const key of ['skills', 'resume', 'jd', 'additional', 'memory', 'history', 'audio', 'attachScreen'])
            if (typeof saved[key] === 'boolean') base[key] = saved[key];
        if (['off', 'manual', 'automatic'].includes(saved.screen)) base.screen = saved.screen;
        if (Array.isArray(saved.skillIds)) base.skillIds = saved.skillIds.filter(id => typeof id === 'string');
        return { ...base, mode, profileName: selected?.name || `${mode} defaults` };
    }
    function userContext(preferences, policy = resolve(preferences)) {
        return [
            ...(policy.jd
                ? [
                      ['Target role', preferences.targetRoleContext],
                      ['Job description', preferences.jobDescription],
                      ['Company / industry', preferences.companyContext],
                  ]
                : []),
            ...(policy.additional ? [['Additional instructions', preferences.additionalContext || preferences.customPrompt]] : []),
        ]
            .filter(([, value]) => String(value || '').trim())
            .map(([label, value]) => `${label}\n-----\n${String(value).trim().slice(0, 6000)}\n-----`)
            .join('\n\n')
            .slice(0, 8000);
    }
    const api = { MODES, defaults, resolve, userContext };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ShadowContextPolicy = api;
})(globalThis);

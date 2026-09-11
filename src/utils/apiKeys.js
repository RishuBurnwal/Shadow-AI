function splitApiKeys(value) {
    return [
        ...new Set(
            String(value || '')
                .split(',')
                .map(key => key.trim())
                .filter(key => key && !key.startsWith('#'))
        ),
    ];
}
function providerApiKeys(env, envKey) {
    return [
        ...new Set(
            Object.entries(env)
                .filter(([key]) => key === envKey || (key.startsWith(`${envKey}_`) && /^\d+$/.test(key.slice(envKey.length + 1))))
                .sort(([a], [b]) => (a === envKey ? 0 : Number(a.slice(envKey.length + 1))) - (b === envKey ? 0 : Number(b.slice(envKey.length + 1))))
                .flatMap(([, value]) => splitApiKeys(value))
        ),
    ];
}
module.exports = { splitApiKeys, providerApiKeys };

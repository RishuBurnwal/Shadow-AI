/**
 * providers.config.js — Single source of truth for all LLM providers.
 *
 * Adding a new provider:
 *   1. Add an entry to the PROVIDERS array below.
 *   2. The credential key, env vars, model config, and UI labels all derive
 *      from this array.
 *   3. No other file needs editing to add a provider (assuming standard
 *      OpenAI-compatible transport).
 *
 * Each entry:
 *   id            — Internal identifier (lowercase, no spaces)
 *   label         — Display label shown in the UI
 *   credentialKey — Key used in the credentials JSON store
 *   envKey         — Environment-variable name for the API key
 *   baseUrl        — Base URL for OpenAI-compatible chat completions
 *   modelsUrl     — URL for model discovery (live list)
 *   modelEnv      — Environment-variable name for the selected model
 *   model          — Default model name
 *   models         — Fallback model list (used when live discovery fails)
 *   transport     — 'openai' (standard chat completions) or 'google' (Gemini SDK)
 */

const PROVIDERS = [
    {
        id: 'groq',
        label: 'Groq',
        credentialKey: 'groqApiKey',
        envKey: 'GROQ_API_KEY',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelsUrl: 'https://api.groq.com/openai/v1/models',
        modelEnv: 'GROQ_MODEL',
        model: 'qwen/qwen3-32b',
        models: ['qwen/qwen3-32b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
        transport: 'openai',
    },
    {
        id: 'openrouter',
        label: 'OpenRouter',
        credentialKey: 'openrouterApiKey',
        envKey: 'OPENROUTER_API_KEY',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelsUrl: 'https://openrouter.ai/api/v1/models',
        modelEnv: 'OPENROUTER_MODEL',
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],
        transport: 'openai',
    },
    {
        id: 'openai',
        label: 'OpenAI',
        credentialKey: 'openaiApiKey',
        envKey: 'OPENAI_API_KEY',
        baseUrl: 'https://api.openai.com/v1',
        modelsUrl: 'https://api.openai.com/v1/models',
        modelEnv: 'OPENAI_MODEL',
        model: 'gpt-4o-mini',
        models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
        transport: 'openai',
    },
    {
        id: 'perplexity',
        label: 'Perplexity',
        credentialKey: 'perplexityApiKey',
        envKey: 'PERPLEXITY_API_KEY',
        baseUrl: 'https://api.perplexity.ai',
        modelsUrl: 'https://api.perplexity.ai/models',
        modelEnv: 'PERPLEXITY_MODEL',
        model: 'sonar-pro',
        models: ['sonar-pro', 'sonar', 'sonar-deep-research'],
        transport: 'openai',
    },
    {
        id: 'nvidia',
        label: 'NVIDIA',
        credentialKey: 'nvidiaApiKey',
        envKey: 'NVIDIA_API_KEY',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        modelsUrl: 'https://integrate.api.nvidia.com/v1/models',
        modelEnv: 'NVIDIA_MODEL',
        model: 'deepseek-ai/deepseek-v4-pro-0813',
        models: ['deepseek-ai/deepseek-v4-pro-0813'],
        transport: 'openai',
        stream: false,
    },
    {
        id: 'tokenrouter',
        label: 'TokenRouter',
        credentialKey: 'tokenrouterApiKey',
        envKey: 'TOKENROUTER_API_KEY',
        baseUrl: 'https://api.tokenrouter.com/v1',
        modelsUrl: 'https://api.tokenrouter.com/v1/models',
        modelEnv: 'TOKENROUTER_MODEL',
        model: 'qwen/qwen3.8-max-free',
        models: ['qwen/qwen3.8-max-free'],
        transport: 'openai',
    },
    {
        id: 'gemini',
        label: 'Gemini',
        credentialKey: 'apiKey', // Historical: storage uses 'apiKey' for Gemini key
        envKey: 'GEMINI_API_KEY',
        baseUrl: '', // Gemini uses @google/genai SDK, not OpenAI-compatible
        modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
        modelEnv: 'GEMINI_MODEL',
        model: 'gemini-3.6-flash',
        models: ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
        transport: 'google',
    },
];

/** Derive default credentials object from the PROVIDERS array */
function defaultCredentials() {
    return Object.fromEntries(PROVIDERS.map(p => [p.credentialKey, '']));
}

/** Derive provider-key mapping for env-file sync */
function providerKeyMapping() {
    return Object.fromEntries(PROVIDERS.map(p => [p.id, { envKey: p.envKey, credential: p.credentialKey, modelEnv: p.modelEnv }]));
}

/** Build a lookup map { id → label } for the UI */
function providerLabelMap() {
    return Object.fromEntries(PROVIDERS.map(p => [p.id, p.label]));
}

module.exports = {
    PROVIDERS,
    defaultCredentials,
    providerKeyMapping,
    providerLabelMap,
};

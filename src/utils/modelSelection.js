const { isValidModelId } = require('./providerRouter');

function isChatModel(model) {
    return (
        isValidModelId(model) &&
        !/(embed|rerank|reward|moderation|safety|guard|whisper|tts|transcrib|dall-e|imagen|veo|audio|parse|sora)/i.test(model)
    );
}

function enabledModels(provider, catalog, preferences, selectedModel) {
    const saved = preferences.enabledProviderModels?.[provider.id];
    const candidates = Array.isArray(saved) ? saved : [selectedModel || provider.model];
    // Previously tested selections must remain removable during catalog outages.
    return [...new Set(candidates.filter(isChatModel))].filter(model => Array.isArray(saved) || !catalog?.length || catalog.includes(model));
}

module.exports = { isChatModel, enabledModels };

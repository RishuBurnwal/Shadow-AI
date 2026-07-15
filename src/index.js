if (require('electron-squirrel-startup')) {
    process.exit(0);
}

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const storage = require('./storage');
const soul = require('./soul');
const memory = require('./memory');
const providerEnv = require('./utils/providerEnv');
const { PROVIDER_DEFINITIONS, getProviderRuntimeStatus, getConfiguredProviders, discoverProviderModels } = require('./utils/providerRouter');
const { providerLabelMap } = require('./utils/providers.config');

const geminiSessionRef = { current: null };
let mainWindow = null;
const launchProvider = String(process.env.SHADOW_AI_PROVIDER || 'auto').toLowerCase();
const providerIds = new Set(PROVIDER_DEFINITIONS.map(provider => provider.id));
const providersById = new Map(PROVIDER_DEFINITIONS.map(provider => [provider.id, provider]));

function applyProviderSelection(selection) {
    const requested = String(selection || 'default').toLowerCase();
    const normalized = requested === 'gemma' ? 'gemini' : requested;
    if (normalized === 'default') process.env.SHADOW_AI_PROVIDER = providerIds.has(launchProvider) ? launchProvider : 'auto';
    else if (normalized === 'auto' || providerIds.has(normalized)) process.env.SHADOW_AI_PROVIDER = normalized;
    else throw new Error('Unsupported provider selection');
    return normalized;
}

function applyProviderModels(models = {}) {
    for (const definition of PROVIDER_DEFINITIONS) {
        const selected = models[definition.id];
        if (selected && definition.models.includes(selected)) process.env[definition.modelEnv] = selected;
    }
}

function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, geminiSessionRef);
    return mainWindow;
}

app.whenReady().then(async () => {
    // Initialize storage (checks version, resets if needed)
    storage.initializeStorage();

    // Trigger screen recording permission prompt on macOS if not already granted
    if (process.platform === 'darwin') {
        const { desktopCapturer } = require('electron');
        desktopCapturer.getSources({ types: ['screen'] }).catch(() => {});
    }

    createMainWindow();
    setupGeminiIpcHandlers(geminiSessionRef);
    setupStorageIpcHandlers();
    setupGeneralIpcHandlers();
});

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopMacOSAudioCapture();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

function setupStorageIpcHandlers() {
    // ============ CONFIG ============
    ipcMain.handle('storage:get-config', async () => {
        try {
            return { success: true, data: storage.getConfig() };
        } catch (error) {
            console.error('Error getting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-config', async (event, config) => {
        try {
            storage.setConfig(config);
            return { success: true };
        } catch (error) {
            console.error('Error setting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-config', async (event, key, value) => {
        try {
            storage.updateConfig(key, value);
            return { success: true };
        } catch (error) {
            console.error('Error updating config:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ CREDENTIALS ============
    ipcMain.handle('storage:get-credentials', async () => {
        try {
            return { success: true, data: storage.getCredentials() };
        } catch (error) {
            console.error('Error getting credentials:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-credentials', async (event, credentials) => {
        try {
            storage.setCredentials(credentials);
            return { success: true };
        } catch (error) {
            console.error('Error setting credentials:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-api-key', async () => {
        try {
            return { success: true, data: storage.getApiKey() };
        } catch (error) {
            console.error('Error getting API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-api-key', async (event, apiKey) => {
        try {
            storage.setApiKey(apiKey);
            return { success: true };
        } catch (error) {
            console.error('Error setting API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-groq-api-key', async () => {
        try {
            return { success: true, data: storage.getGroqApiKey() };
        } catch (error) {
            console.error('Error getting Groq API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-groq-api-key', async (event, groqApiKey) => {
        try {
            storage.setGroqApiKey(groqApiKey);
            return { success: true };
        } catch (error) {
            console.error('Error setting Groq API key:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ PREFERENCES ============
    ipcMain.handle('storage:get-preferences', async () => {
        try {
            return { success: true, data: storage.getPreferences() };
        } catch (error) {
            console.error('Error getting preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-preferences', async (event, preferences) => {
        try {
            storage.setPreferences(preferences);
            return { success: true };
        } catch (error) {
            console.error('Error setting preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-preference', async (event, key, value) => {
        try {
            storage.updatePreference(key, value);
            return { success: true };
        } catch (error) {
            console.error('Error updating preference:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ KEYBINDS ============
    ipcMain.handle('storage:get-keybinds', async () => {
        try {
            return { success: true, data: storage.getKeybinds() };
        } catch (error) {
            console.error('Error getting keybinds:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-keybinds', async (event, keybinds) => {
        try {
            storage.setKeybinds(keybinds);
            return { success: true };
        } catch (error) {
            console.error('Error setting keybinds:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ HISTORY ============
    ipcMain.handle('storage:get-all-sessions', async () => {
        try {
            return { success: true, data: storage.getAllSessions() };
        } catch (error) {
            console.error('Error getting sessions:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:get-session', async (event, sessionId) => {
        try {
            return { success: true, data: storage.getSession(sessionId) };
        } catch (error) {
            console.error('Error getting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:save-session', async (event, sessionId, data) => {
        try {
            storage.saveSession(sessionId, data);
            return { success: true };
        } catch (error) {
            console.error('Error saving session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-session', async (event, sessionId) => {
        try {
            if (!storage.deleteSession(sessionId)) return { success: false, error: 'Session was not found.' };
            return { success: true };
        } catch (error) {
            console.error('Error deleting session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-all-sessions', async () => {
        try {
            if (!storage.deleteAllSessions()) return { success: false, error: 'Unable to clear session history.' };
            return { success: true };
        } catch (error) {
            console.error('Error deleting all sessions:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ LIMITS ============
    ipcMain.handle('storage:get-today-limits', async () => {
        try {
            return { success: true, data: storage.getTodayLimits() };
        } catch (error) {
            console.error('Error getting today limits:', error);
            return { success: false, error: error.message };
        }
    });

    // ============ PROFILE (Soul) ============
    ipcMain.handle('storage:get-profile', async () => {
        try {
            return { success: true, data: soul.getProfile() };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:set-profile', async (event, profile) => {
        try {
            soul.setProfile(profile);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-profile', async () => {
        try {
            soul.deleteProfile();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // ============ MEMORY ============
    ipcMain.handle('storage:get-memory', async () => {
        try {
            const facts = memory.getMemory();
            const profile = memory.getProfileForDisplay();
            return { success: true, data: { facts, profile } };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:update-memory-entry', async (event, id, updates) => {
        try {
            if (!memory.updateMemoryEntry(id, updates)) return { success: false, error: 'Memory entry not found.' };
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:delete-memory-entry', async (event, id) => {
        try {
            if (!memory.deleteMemoryEntry(id)) return { success: false, error: 'Memory entry not found.' };
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('storage:clear-memory', async () => {
        try {
            memory.clearMemory();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // ============ CLEAR ALL ============
    ipcMain.handle('storage:clear-all', async () => {
        try {
            storage.clearAllData();
            return { success: true };
        } catch (error) {
            console.error('Error clearing all data:', error);
            return { success: false, error: error.message };
        }
    });
}

function setupGeneralIpcHandlers() {
    const preferences = storage.getPreferences();
    const initialSelection = applyProviderSelection(preferences.answerProvider || 'default');
    if (preferences.answerProvider === 'gemma') storage.updatePreference('answerProvider', 'gemini');
    const providerModels = { ...(preferences.providerModels || {}) };
    if (Object.hasOwn(providerModels, 'gemma')) {
        delete providerModels.gemma;
        storage.updatePreference('providerModels', providerModels);
    }
    applyProviderModels(providerModels);

    ipcMain.handle('get-provider-status', async (event, forceModels = false) => {
        const configured = providerEnv.getProviderStatus();
        const discoveredModels = await discoverProviderModels(getConfiguredProviders(), { force: forceModels === true });
        const currentPreferences = storage.getPreferences();
        const selectedModels = { ...(currentPreferences.providerModels || {}) };
        let selectionChanged = false;
        for (const definition of PROVIDER_DEFINITIONS) {
            const models = discoveredModels[definition.id] || definition.models;
            const selectedModel = process.env[definition.modelEnv] || selectedModels[definition.id] || definition.model;
            if (configured[definition.id] && models.length && !models.includes(selectedModel)) {
                process.env[definition.modelEnv] = models[0];
                selectedModels[definition.id] = models[0];
                selectionChanged = true;
            }
        }
        if (selectionChanged) storage.updatePreference('providerModels', selectedModels);
        return {
            ...configured,
            selected: storage.getPreferences().answerProvider || initialSelection,
            effective: process.env.SHADOW_AI_PROVIDER || 'auto',
            providerLabels: providerLabelMap(),
            providerIds: PROVIDER_DEFINITIONS.map(p => p.id),
            providers: Object.fromEntries(
                Object.entries(getProviderRuntimeStatus(configured)).map(([provider, status]) => {
                    const definition = providersById.get(provider);
                    return [
                        provider,
                        {
                            ...status,
                            models: discoveredModels[provider] || definition.models,
                            selectedModel: process.env[definition.modelEnv] || definition.model,
                        },
                    ];
                })
            ),
        };
    });

    ipcMain.handle('set-provider-selection', async (event, selection) => {
        try {
            const normalized = String(selection || '').toLowerCase();
            const configured = providerEnv.getProviderStatus();
            if (providerIds.has(normalized) && !configured[normalized]) return { success: false, error: 'API key is not configured.' };
            applyProviderSelection(normalized);
            storage.updatePreference('answerProvider', normalized);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-provider-model', async (event, provider, model) => {
        try {
            const definition = providersById.get(String(provider || '').toLowerCase());
            if (!definition) return { success: false, error: 'Unsupported provider.' };
            providerEnv.getProviderStatus();
            const configuredProvider = getConfiguredProviders().find(item => item.id === definition.id);
            if (!configuredProvider) return { success: false, error: 'API key is not configured.' };
            const catalog = await discoverProviderModels([configuredProvider], { force: true });
            if (!catalog[definition.id]?.includes(model)) return { success: false, error: 'Model is no longer available for this API.' };
            const preferences = storage.getPreferences();
            const providerModels = { ...(preferences.providerModels || {}) };
            delete providerModels.gemma;
            providerModels[definition.id] = model;
            storage.updatePreference('providerModels', providerModels);
            process.env[definition.modelEnv] = model;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-provider-api-key', async (event, provider, apiKey) => {
        try {
            providerEnv.setProviderKey(provider, apiKey);
            return { success: true, status: providerEnv.getProviderStatus() };
        } catch (error) {
            console.error('Unable to update provider key:', error.message);
            return { success: false, error: 'Unable to update provider key' };
        }
    });

    ipcMain.handle('get-app-version', async () => {
        return app.getVersion();
    });

    ipcMain.handle('quit-application', async event => {
        try {
            stopMacOSAudioCapture();
            app.quit();
            return { success: true };
        } catch (error) {
            console.error('Error quitting application:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-external', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        if (mainWindow) {
            // Also save to storage
            storage.setKeybinds(newKeybinds);
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }
    });

    // Debug logging from renderer
    ipcMain.on('log-message', (event, msg) => {
        console.log(msg);
    });
}

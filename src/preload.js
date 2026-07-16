const { contextBridge, ipcRenderer } = require('electron');

const invokeChannels = new Set([
    'close-session',
    'get-app-version',
    'get-audio-worklet-source',
    'get-provider-status',
    'initialize-cloud',
    'initialize-gemini',
    'initialize-local',
    'open-external',
    'quit-application',
    'send-image-content',
    'send-text-message',
    'set-passthrough',
    'set-provider-api-key',
    'set-provider-model',
    'set-provider-selection',
    'skills:resume-sync',
    'start-macos-audio',
    'stop-macos-audio',
    'storage:clear-all',
    'storage:clear-memory',
    'storage:delete-all-sessions',
    'storage:delete-memory-entry',
    'storage:delete-profile',
    'storage:delete-session',
    'storage:get-all-sessions',
    'storage:get-api-key',
    'storage:get-config',
    'storage:get-credentials',
    'storage:get-groq-api-key',
    'storage:get-keybinds',
    'storage:get-memory',
    'storage:get-preferences',
    'storage:get-profile',
    'storage:get-session',
    'storage:get-today-limits',
    'storage:save-session',
    'storage:set-api-key',
    'storage:set-config',
    'storage:set-credentials',
    'storage:set-groq-api-key',
    'storage:set-keybinds',
    'storage:set-preferences',
    'storage:set-profile',
    'storage:update-config',
    'storage:update-memory-entry',
    'storage:update-preference',
    'toggle-window-visibility',
    'update-google-search-setting',
    'window-minimize',
]);
const sendChannels = new Set(['send-audio-content', 'send-mic-audio-content', 'set-passthrough-header-region', 'update-keybinds', 'view-changed']);
const receiveChannels = new Set([
    'clear-current-response',
    'clear-sensitive-data',
    'click-through-toggled',
    'handle-shortcut',
    'interim-transcription',
    'navigate-next-response',
    'navigate-previous-response',
    'new-response',
    'provider-notification',
    'reconnect-failed',
    'save-conversation-turn',
    'save-screen-analysis',
    'save-session-context',
    'save-session-summary',
    'scroll-response-down',
    'scroll-response-up',
    'update-response',
    'update-status',
    'whisper-downloading',
]);
const listeners = new Map();

function allowed(channels, channel) {
    if (!channels.has(channel)) throw new Error(`IPC channel not allowed: ${channel}`);
}

const ipc = {
    invoke(channel, ...args) {
        allowed(invokeChannels, channel);
        return ipcRenderer.invoke(channel, ...args);
    },
    send(channel, ...args) {
        allowed(sendChannels, channel);
        ipcRenderer.send(channel, ...args);
    },
    on(channel, callback) {
        allowed(receiveChannels, channel);
        const wrapped = (_event, ...args) => callback({}, ...args);
        listeners.set(callback, wrapped);
        ipcRenderer.on(channel, wrapped);
    },
    removeListener(channel, callback) {
        allowed(receiveChannels, channel);
        const wrapped = listeners.get(callback);
        if (wrapped) ipcRenderer.removeListener(channel, wrapped);
        listeners.delete(callback);
    },
    removeAllListeners(channel) {
        allowed(receiveChannels, channel);
        ipcRenderer.removeAllListeners(channel);
    },
};

contextBridge.exposeInMainWorld('electronAPI', {
    ipcRenderer: ipc,
    platform: process.platform,
    getAudioWorkletSource: () => ipc.invoke('get-audio-worklet-source'),
});

import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { MainView } from '../views/MainView.js';
import { CustomizeView } from '../views/CustomizeView.js';
import { HelpView } from '../views/HelpView.js';
import { HistoryView } from '../views/HistoryView.js';
import { AssistantView } from '../views/AssistantView.js';
import { OnboardingView } from '../views/OnboardingView.js';
import { AICustomizeView } from '../views/AICustomizeView.js';
import { MemoryView } from '../views/MemoryView.js';

export class ShadowAIApp extends LitElement {
    static styles = css`
        * {
            box-sizing: border-box;
            font-family: var(--font);
            margin: 0;
            padding: 0;
            cursor: default;
            user-select: none;
        }

        :host {
            display: block;
            width: 100%;
            height: 100vh;
            background: var(--bg-app);
            color: var(--text-primary);
        }

        /* ── Full app shell: top bar + sidebar/content ── */

        .app-shell {
            display: flex;
            height: 100vh;
            overflow: hidden;
        }

        .top-drag-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            height: 48px;
            gap: var(--space-sm);
            padding-right: var(--space-md);
            background: var(--header-solid-background, #101010);
            opacity: 1;
            isolation: isolate;
            pointer-events: auto;
            border-bottom: 1px solid var(--border);
            box-shadow: 0 1px 8px rgba(0, 0, 0, 0.28);
        }

        .drag-region {
            flex: 1;
            height: 100%;
            -webkit-app-region: drag;
        }

        .header-control {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-shrink: 0;
            color: var(--text-secondary);
            font-size: 11px;
            -webkit-app-region: no-drag;
        }

        .header-opacity {
            width: 92px;
            cursor: pointer;
        }

        .header-color-picker {
            position: relative;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 28px;
            padding: 0 8px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--bg-elevated);
            color: var(--text-primary);
            font-size: 11px;
            cursor: pointer;
            flex-shrink: 0;
            -webkit-app-region: no-drag;
        }

        .header-color-picker:hover {
            border-color: var(--accent);
        }

        .header-color-swatch {
            width: 18px;
            height: 18px;
            border: 1px solid rgba(255, 255, 255, 0.45);
            border-radius: 4px;
            background: var(--selected-ai-color);
            box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
            pointer-events: none;
        }

        .header-color {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            cursor: pointer;
        }

        .passthrough-button {
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 5px 9px;
            background: var(--bg-elevated);
            color: var(--text-primary);
            cursor: pointer;
            -webkit-app-region: no-drag;
        }

        .passthrough-button.active {
            border-color: var(--accent);
            background: var(--accent);
            color: var(--btn-primary-text);
        }

        .provider-select-wrap {
            display: flex;
            align-items: center;
            gap: 5px;
            flex-shrink: 0;
            -webkit-app-region: no-drag;
        }

        .provider-select {
            width: 164px;
            height: 28px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--bg-elevated);
            color: var(--text-primary);
            padding: 0 6px;
            font-size: 11px;
            cursor: pointer;
        }

        .provider-model-select {
            width: 190px;
        }

        .provider-select option:disabled {
            color: #777777;
        }

        .provider-status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--warning);
            flex-shrink: 0;
        }

        .provider-status-dot.ok {
            background: var(--success);
        }

        .provider-status-dot.disabled {
            background: #666666;
        }

        .provider-status-dot.error {
            background: var(--danger, #ef4444);
        }

        .provider-notification {
            position: fixed;
            top: 58px;
            right: 14px;
            z-index: 10000;
            max-width: 420px;
            padding: 9px 12px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--header-solid-background, #101010);
            color: var(--text-primary);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
            font-size: var(--font-size-xs);
            pointer-events: none;
        }

        .provider-notification.warning {
            border-color: var(--warning);
        }

        .provider-notification.success {
            border-color: var(--success);
        }

        .traffic-lights {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 var(--space-md);
            height: 100%;
            -webkit-app-region: no-drag;
        }

        .traffic-light {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: none;
            cursor: pointer;
            padding: 0;
            transition: opacity 0.15s ease;
        }

        .traffic-light:hover {
            opacity: 0.8;
        }

        .traffic-light.close {
            background: #ff5f57;
        }

        .traffic-light.minimize {
            background: #febc2e;
        }

        .traffic-light.maximize {
            background: #28c840;
        }

        .sidebar {
            width: var(--sidebar-width);
            min-width: var(--sidebar-width);
            background: var(--bg-surface);
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            padding: 52px 0 var(--space-md) 0;
            transition:
                width var(--transition),
                min-width var(--transition),
                opacity var(--transition);
        }

        .sidebar.hidden {
            width: 0;
            min-width: 0;
            padding: 0;
            overflow: hidden;
            border-right: none;
            opacity: 0;
        }

        .sidebar-brand {
            padding: var(--space-sm) var(--space-lg);
            padding-top: var(--space-md);
            margin-bottom: var(--space-lg);
        }

        .sidebar-brand h1 {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            letter-spacing: -0.01em;
        }

        .sidebar-nav {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
            padding: 0 var(--space-sm);
            -webkit-app-region: no-drag;
        }

        .nav-item {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-sm) var(--space-md);
            border-radius: var(--radius-md);
            color: var(--text-secondary);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            transition:
                color var(--transition),
                background var(--transition);
            border: none;
            background: none;
            width: 100%;
            text-align: left;
        }

        .nav-item:hover {
            color: var(--text-primary);
            background: var(--bg-hover);
        }

        .nav-item.active {
            color: var(--text-primary);
            background: var(--bg-elevated);
        }

        .nav-item svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .sidebar-footer {
            padding: var(--space-sm);
            margin-top: var(--space-sm);
            -webkit-app-region: no-drag;
        }

        .update-btn {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            width: 100%;
            padding: var(--space-sm) var(--space-md);
            border-radius: var(--radius-md);
            border: 1px solid rgba(239, 68, 68, 0.2);
            background: rgba(239, 68, 68, 0.08);
            color: var(--danger);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            text-align: left;
            transition:
                background var(--transition),
                border-color var(--transition);
            animation: update-wobble 5s ease-in-out infinite;
        }

        .update-btn:hover {
            background: rgba(239, 68, 68, 0.14);
            border-color: rgba(239, 68, 68, 0.35);
        }

        @keyframes update-wobble {
            0%,
            90%,
            100% {
                transform: rotate(0deg);
            }
            92% {
                transform: rotate(-2deg);
            }
            94% {
                transform: rotate(2deg);
            }
            96% {
                transform: rotate(-1.5deg);
            }
            98% {
                transform: rotate(1.5deg);
            }
        }

        .update-btn svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .version-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            padding: var(--space-xs) var(--space-md);
        }

        /* ── Main content area ── */

        .content {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            background: var(--bg-app);
            padding-top: 48px;
        }

        /* Live mode top bar */
        .live-bar {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 var(--space-md);
            background: var(--bg-surface);
            border-bottom: 1px solid var(--border);
            height: 36px;
            -webkit-app-region: drag;
        }

        .live-bar-left {
            display: flex;
            align-items: center;
            -webkit-app-region: no-drag;
            z-index: 1;
        }

        .live-bar-back {
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            cursor: pointer;
            background: none;
            border: none;
            padding: var(--space-xs);
            border-radius: var(--radius-sm);
            transition: color var(--transition);
        }

        .live-bar-back:hover {
            color: var(--text-primary);
        }

        .live-bar-back svg {
            width: 14px;
            height: 14px;
        }

        .live-bar-center {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-weight: var(--font-weight-medium);
            white-space: nowrap;
            pointer-events: none;
        }

        .live-bar-right {
            display: flex;
            align-items: center;
            gap: var(--space-md);
            -webkit-app-region: no-drag;
            z-index: 1;
        }

        .live-bar-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-family: var(--font-mono);
            white-space: nowrap;
        }

        .live-bar-text.clickable {
            cursor: pointer;
            transition: color var(--transition);
        }

        .live-bar-text.clickable:hover {
            color: var(--text-primary);
        }

        /* Content inner */
        .content-inner {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
        }

        .content-inner.live {
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        /* Onboarding fills everything */
        .fullscreen {
            position: fixed;
            inset: 0;
            z-index: 100;
            background: var(--bg-app);
        }

        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--border-strong);
            border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: #444444;
        }
    `;

    static properties = {
        currentView: { type: String },
        statusText: { type: String },
        startTime: { type: Number },
        isRecording: { type: Boolean },
        sessionActive: { type: Boolean },
        selectedProfile: { type: String },
        selectedLanguage: { type: String },
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedScreenshotInterval: { type: String },
        selectedImageQuality: { type: String },
        layoutMode: { type: String },
        _viewInstances: { type: Object, state: true },
        _isClickThrough: { state: true },
        _awaitingNewResponse: { state: true },
        shouldAnimateResponse: { type: Boolean },
        _storageLoaded: { state: true },
        _updateAvailable: { state: true },
        _whisperDownloading: { state: true },
        backgroundTransparency: { type: Number },
        responseTextOpacity: { type: Number },
        responseTextColor: { type: String },
        interimTranscription: { type: Object },
        _providerNotification: { state: true },
        _providerStatus: { state: true },
    };

    constructor() {
        super();
        this.currentView = 'onboarding';
        this.statusText = '';
        this.startTime = null;
        this.isRecording = false;
        this.sessionActive = false;
        this.selectedProfile = 'interview';
        this.selectedLanguage = 'en-US';
        this.selectedScreenshotInterval = '5';
        this.selectedImageQuality = 'medium';
        this.layoutMode = 'normal';
        this.responses = [];
        this.currentResponseIndex = -1;
        this._viewInstances = new Map();
        this._isClickThrough = false;
        this._awaitingNewResponse = false;
        this._currentResponseIsComplete = true;
        this.shouldAnimateResponse = false;
        this._storageLoaded = false;
        this._timerInterval = null;
        this._updateAvailable = false;
        this._whisperDownloading = false;
        this._localVersion = '';
        this.backgroundTransparency = 0.8;
        this.responseTextOpacity = 1;
        this.responseTextColor = '#f5f5f5';
        this.interimTranscription = null;
        this._privacyMode = false;
        this._providerNotification = null;
        this._providerNotificationTimer = null;
        this._providerStatus = { selected: 'default', effective: 'auto', providers: {} };
        this._providerStatusTimer = null;

        this._loadFromStorage();
        this._checkForUpdates();
    }

    async _checkForUpdates() {
        try {
            this._localVersion = await shadowAI.getVersion();
            this.requestUpdate();

            const res = await fetch('https://raw.githubusercontent.com/sohzm/shadow-ai/refs/heads/master/package.json');
            if (!res.ok) return;
            const remote = await res.json();
            const remoteVersion = remote.version;

            const toNum = v => v.split('.').map(Number);
            const [rMaj, rMin, rPatch] = toNum(remoteVersion);
            const [lMaj, lMin, lPatch] = toNum(this._localVersion);

            if (rMaj > lMaj || (rMaj === lMaj && rMin > lMin) || (rMaj === lMaj && rMin === lMin && rPatch > lPatch)) {
                this._updateAvailable = true;
                this.requestUpdate();
            }
        } catch (e) {
            // silently ignore
        }
    }

    async _loadFromStorage() {
        try {
            const [config, prefs] = await Promise.all([shadowAI.storage.getConfig(), shadowAI.storage.getPreferences()]);

            // Context is intentionally requested on every launch so each session
            // starts with the correct resume, job description, or meeting notes.
            this.currentView = 'onboarding';
            this.selectedProfile = prefs.selectedProfile || 'interview';
            this.selectedLanguage = prefs.selectedLanguage || 'en-US';
            this.selectedScreenshotInterval = prefs.selectedScreenshotInterval || '5';
            this.selectedImageQuality = prefs.selectedImageQuality || 'medium';
            this.layoutMode = config.layout || 'normal';
            this.backgroundTransparency = prefs.backgroundTransparency ?? 0.8;
            this.responseTextOpacity = prefs.responseTextOpacity ?? 1;
            this.responseTextColor = /^#[0-9a-f]{6}$/i.test(prefs.responseTextColor) ? prefs.responseTextColor : '#f5f5f5';

            const prefs2 = await shadowAI.storage.getPreferences();
            this._privacyMode = prefs2.privacyMode ?? false;

            this._storageLoaded = true;
            this.requestUpdate();
        } catch (error) {
            console.error('Error loading from storage:', error);
            this._privacyMode = false;
            this._storageLoaded = true;
            this.requestUpdate();
        }
    }

    connectedCallback() {
        super.connectedCallback();

        if (window.electronAPI) {
            const { ipcRenderer } = window.electronAPI;
            ipcRenderer.on('new-response', (_, response) => this.addNewResponse(response));
            ipcRenderer.on('update-response', (_, response) => this.updateCurrentResponse(response));
            ipcRenderer.on('update-status', (_, status) => this.setStatus(status));
            ipcRenderer.on('click-through-toggled', (_, isEnabled) => {
                this._isClickThrough = isEnabled;
            });
            ipcRenderer.on('reconnect-failed', (_, data) => this.addNewResponse(data.message));
            ipcRenderer.on('whisper-downloading', (_, downloading) => {
                this._whisperDownloading = downloading;
            });
            this._interimTranscriptionHandler = (_, data) => {
                this.interimTranscription = data;
                if (data?.isFinal && data.text?.trim()) this._pendingInterviewerQuestion = data.text.trim();
                this.requestUpdate();
            };
            ipcRenderer.on('interim-transcription', this._interimTranscriptionHandler);
            this._providerNotificationHandler = (_, notification) => {
                this.showProviderNotification(notification);
                this.loadProviderStatus();
            };
            ipcRenderer.on('provider-notification', this._providerNotificationHandler);
            ipcRenderer.on('clear-current-response', () => this.clearCurrentResponse());
        }
        this.loadProviderStatus();
        this._providerStatusTimer = setInterval(() => this.loadProviderStatus(), 5000);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopTimer();
        if (window.electronAPI) {
            const { ipcRenderer } = window.electronAPI;
            ipcRenderer.removeAllListeners('new-response');
            ipcRenderer.removeAllListeners('update-response');
            ipcRenderer.removeAllListeners('update-status');
            ipcRenderer.removeAllListeners('click-through-toggled');
            ipcRenderer.removeAllListeners('reconnect-failed');
            ipcRenderer.removeAllListeners('whisper-downloading');
            ipcRenderer.removeAllListeners('clear-current-response');
            if (this._interimTranscriptionHandler) {
                ipcRenderer.removeListener('interim-transcription', this._interimTranscriptionHandler);
            }
            if (this._providerNotificationHandler) {
                ipcRenderer.removeListener('provider-notification', this._providerNotificationHandler);
            }
        }
        clearTimeout(this._providerNotificationTimer);
        clearInterval(this._providerStatusTimer);
    }

    // ── Timer ──

    _startTimer() {
        this._stopTimer();
        if (this.startTime) {
            this._timerInterval = setInterval(() => this.requestUpdate(), 1000);
        }
    }

    _stopTimer() {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
    }

    getElapsedTime() {
        if (!this.startTime) return '0:00';
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        const pad = n => String(n).padStart(2, '0');
        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${m}:${pad(s)}`;
    }

    // ── Status & Responses ──

    setStatus(text) {
        this.statusText = text;
        if (text.includes('Ready') || text.includes('Listening') || text.includes('Error')) {
            this._currentResponseIsComplete = true;
        }
    }

    async loadProviderStatus(forceModels = false) {
        try {
            this._providerStatus = await shadowAI.getProviderStatus(forceModels);
        } catch {
            // Keep the last known safe snapshot while IPC is unavailable.
        }
    }

    async handleProviderSelection(selection) {
        const result = await shadowAI.setProviderSelection(selection);
        if (!result?.success) {
            this.showProviderNotification({ type: 'warning', message: result?.error || 'Unable to select provider.' });
        }
        await this.loadProviderStatus(true);
    }

    async handleProviderModelSelection(provider, model) {
        const result = await shadowAI.setProviderModel(provider, model);
        if (!result?.success) {
            this.showProviderNotification({ type: 'warning', message: result?.error || 'Unable to select model.' });
        } else {
            this.showProviderNotification({ type: 'success', message: `Model selected: ${model}` });
        }
        await this.loadProviderStatus();
    }

    modelProvider() {
        const selected = this._providerStatus.selected || 'default';
        const effective = selected === 'default' ? this._providerStatus.effective : selected;
        return effective && effective !== 'auto' ? effective : null;
    }

    providerOptionLabel(provider) {
        const labels = this._providerStatus.providerLabels || {};
        const status = this._providerStatus.providers?.[provider];
        const label = labels[provider] || provider;
        return `${label} — ${status?.message || 'Checking'}`;
    }

    selectedProviderStatus() {
        const selected = this._providerStatus.selected || 'default';
        const effective = selected === 'default' ? this._providerStatus.effective : selected;
        if (selected === 'auto' || effective === 'auto') return { state: 'enabled', message: 'Automatic fallback enabled' };
        return this._providerStatus.providers?.[effective] || { state: 'disabled', message: 'Checking provider status' };
    }

    addNewResponse(response) {
        this._currentInterviewerQuestion = this._pendingInterviewerQuestion || '';
        this._pendingInterviewerQuestion = '';
        const wasOnLatest = this.currentResponseIndex === this.responses.length - 1;
        this.responses = [...this.responses, this.formatInterviewExchange(response)];
        if (wasOnLatest || this.currentResponseIndex === -1) {
            this.currentResponseIndex = this.responses.length - 1;
        }
        this._awaitingNewResponse = false;
        this.requestUpdate();
    }

    clearCurrentResponse() {
        // Remove the last (partial) response when barge-in cancels the answer stream
        if (this.responses.length > 0) {
            this.responses = this.responses.slice(0, -1);
            this.currentResponseIndex = Math.min(this.currentResponseIndex, this.responses.length - 1);
            this.requestUpdate();
        }
    }

    updateCurrentResponse(response) {
        response = this.formatInterviewExchange(response);
        if (this.responses.length > 0) {
            this.responses = [...this.responses.slice(0, -1), response];
        } else {
            this.addNewResponse(response);
        }
        this.requestUpdate();
    }

    formatInterviewExchange(response) {
        const answer = String(response || '');
        return this._currentInterviewerQuestion ? `**Interviewer:** ${this._currentInterviewerQuestion}\n\n**Candidate:** ${answer}` : answer;
    }

    // ── Navigation ──

    navigate(view) {
        this.currentView = view;
        this.requestUpdate();
    }

    async handleClose() {
        if (this.currentView === 'assistant') {
            shadowAI.stopCapture();
            if (window.electronAPI) {
                const { ipcRenderer } = window.electronAPI;
                await ipcRenderer.invoke('close-session');
            }
            this.sessionActive = false;
            this._stopTimer();
            this.currentView = 'main';
        } else {
            if (window.electronAPI) {
                const { ipcRenderer } = window.electronAPI;
                await ipcRenderer.invoke('quit-application');
            }
        }
    }

    async _handleMinimize() {
        if (window.electronAPI) {
            const { ipcRenderer } = window.electronAPI;
            await ipcRenderer.invoke('window-minimize');
        }
    }

    async _handleMaximize() {
        if (window.electronAPI) {
            const { ipcRenderer } = window.electronAPI;
            await ipcRenderer.invoke('window-maximize');
        }
    }

    async handleHideToggle() {
        if (window.electronAPI) {
            const { ipcRenderer } = window.electronAPI;
            await ipcRenderer.invoke('toggle-window-visibility');
        }
    }

    async handleBackgroundTransparencyChange(value) {
        const nextValue = Math.min(1, Math.max(0, Number(value)));
        this.backgroundTransparency = Number.isFinite(nextValue) ? nextValue : 0.8;
        await shadowAI.storage.updatePreference('backgroundTransparency', this.backgroundTransparency);
        const colors = shadowAI.theme.get(shadowAI.theme.current);
        shadowAI.theme.applyBackgrounds(colors.background, this.backgroundTransparency);
        this.requestUpdate();
    }

    async handleResponseTextOpacityChange(value) {
        const nextValue = Math.min(1, Math.max(0, Number(value)));
        this.responseTextOpacity = Number.isFinite(nextValue) ? nextValue : 1;
        await shadowAI.storage.updatePreference('responseTextOpacity', this.responseTextOpacity);
        this.requestUpdate();
    }

    async handleResponseTextColorChange(value) {
        const nextValue = String(value || '').trim();
        this.responseTextColor = /^#[0-9a-f]{6}$/i.test(nextValue) ? nextValue.toLowerCase() : '#f5f5f5';
        await shadowAI.storage.updatePreference('responseTextColor', this.responseTextColor);
        this.requestUpdate();
    }

    async togglePassthrough() {
        if (!window.electronAPI) return;
        const { ipcRenderer } = window.electronAPI;
        const result = await ipcRenderer.invoke('set-passthrough', !this._isClickThrough);
        if (result?.success) this._isClickThrough = result.enabled;
    }

    showProviderNotification(notification) {
        if (!notification?.message) return;
        clearTimeout(this._providerNotificationTimer);
        this._providerNotification = {
            type: notification.type === 'warning' ? 'warning' : 'success',
            message: String(notification.message).slice(0, 240),
        };
        this._providerNotificationTimer = setTimeout(() => {
            this._providerNotification = null;
        }, 5000);
    }

    // ── Session start ──

    async handleStart() {
        const prefs = await shadowAI.storage.getPreferences();
        const providerMode = prefs.providerMode === 'cloud' ? 'byok' : prefs.providerMode || 'byok';

        if (providerMode === 'cloud') {
            const creds = await shadowAI.storage.getCredentials();
            if (!creds.cloudToken || creds.cloudToken.trim() === '') {
                const mainView = this.shadowRoot.querySelector('main-view');
                if (mainView && mainView.triggerApiKeyError) {
                    mainView.triggerApiKeyError();
                }
                return;
            }

            const success = await shadowAI.initializeCloud(this.selectedProfile);
            if (!success) {
                const mainView = this.shadowRoot.querySelector('main-view');
                if (mainView && mainView.triggerApiKeyError) {
                    mainView.triggerApiKeyError();
                }
                return;
            }
        } else if (providerMode === 'local') {
            const success = await shadowAI.initializeLocal(this.selectedProfile);
            if (!success) {
                const mainView = this.shadowRoot.querySelector('main-view');
                if (mainView && mainView.triggerApiKeyError) {
                    mainView.triggerApiKeyError();
                }
                return;
            }
        } else {
            const apiKey = await shadowAI.storage.getApiKey();
            const providerStatus = await shadowAI.getProviderStatus().catch(() => ({}));
            if ((!apiKey || apiKey === '') && !providerStatus.gemini) {
                const mainView = this.shadowRoot.querySelector('main-view');
                if (mainView && mainView.triggerApiKeyError) {
                    mainView.triggerApiKeyError();
                }
                return;
            }

            await shadowAI.initializeGemini(this.selectedProfile, this.selectedLanguage);
        }

        shadowAI.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality);
        this.responses = [];
        this.currentResponseIndex = -1;
        this.interimTranscription = null;
        this.startTime = Date.now();
        this.sessionActive = true;
        this.currentView = 'assistant';
        this._startTimer();
    }

    async handleAPIKeyHelp() {
        if (window.electronAPI) {
            const { ipcRenderer } = window.electronAPI;
            await ipcRenderer.invoke('open-external', 'https://shadow-ai.com/help/api-key');
        }
    }

    async handleGroqAPIKeyHelp() {
        if (window.electronAPI) {
            const { ipcRenderer } = window.electronAPI;
            await ipcRenderer.invoke('open-external', 'https://console.groq.com/keys');
        }
    }

    // ── Settings handlers ──

    async handleProfileChange(profile) {
        this.selectedProfile = profile;
        await shadowAI.storage.updatePreference('selectedProfile', profile);
    }

    async handleLanguageChange(language) {
        this.selectedLanguage = language;
        await shadowAI.storage.updatePreference('selectedLanguage', language);
    }

    async handleScreenshotIntervalChange(interval) {
        this.selectedScreenshotInterval = interval;
        await shadowAI.storage.updatePreference('selectedScreenshotInterval', interval);
    }

    async handleImageQualityChange(quality) {
        this.selectedImageQuality = quality;
        await shadowAI.storage.updatePreference('selectedImageQuality', quality);
    }

    async handleLayoutModeChange(layoutMode) {
        this.layoutMode = layoutMode;
        await shadowAI.storage.updateConfig('layout', layoutMode);
        this.requestUpdate();
    }

    async handleExternalLinkClick(url) {
        if (window.electronAPI) {
            const { ipcRenderer } = window.electronAPI;
            await ipcRenderer.invoke('open-external', url);
        }
    }

    async handleSendText(message) {
        const result = await window.shadowAI.sendTextMessage(message);
        if (!result.success) {
            this.setStatus('Error sending message: ' + result.error);
        } else {
            this.setStatus('Message sent...');
            this._awaitingNewResponse = true;
        }
    }

    handleResponseIndexChanged(e) {
        this.currentResponseIndex = e.detail.index;
        this.shouldAnimateResponse = false;
        this.requestUpdate();
    }

    handleOnboardingComplete() {
        this.currentView = 'main';
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        if (changedProperties.has('currentView') && window.electronAPI) {
            const { ipcRenderer } = window.electronAPI;
            ipcRenderer.send('view-changed', this.currentView);
        }
    }

    // ── Helpers ──

    _isLiveMode() {
        return this.currentView === 'assistant';
    }

    // ── Render ──

    renderCurrentView() {
        switch (this.currentView) {
            case 'onboarding':
                return html`
                    <onboarding-view .onComplete=${() => this.handleOnboardingComplete()} .onClose=${() => this.handleClose()}></onboarding-view>
                `;

            case 'main':
                return html`
                    <main-view
                        .selectedProfile=${this.selectedProfile}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                        .onStart=${() => this.handleStart()}
                        .onExternalLink=${url => this.handleExternalLinkClick(url)}
                        .whisperDownloading=${this._whisperDownloading}
                    ></main-view>
                `;

            case 'ai-customize':
                return html`
                    <ai-customize-view
                        .selectedProfile=${this.selectedProfile}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                    ></ai-customize-view>
                `;

            case 'customize':
                return html`
                    <customize-view
                        .selectedProfile=${this.selectedProfile}
                        .selectedLanguage=${this.selectedLanguage}
                        .selectedScreenshotInterval=${this.selectedScreenshotInterval}
                        .selectedImageQuality=${this.selectedImageQuality}
                        .layoutMode=${this.layoutMode}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                        .onLanguageChange=${l => this.handleLanguageChange(l)}
                        .onScreenshotIntervalChange=${i => this.handleScreenshotIntervalChange(i)}
                        .onImageQualityChange=${q => this.handleImageQualityChange(q)}
                        .onLayoutModeChange=${lm => this.handleLayoutModeChange(lm)}
                        .backgroundTransparency=${this.backgroundTransparency}
                        .onBackgroundTransparencyChange=${value => this.handleBackgroundTransparencyChange(value)}
                    ></customize-view>
                `;

            case 'help':
                return html`<help-view .onExternalLinkClick=${url => this.handleExternalLinkClick(url)}></help-view>`;

            case 'history':
                return html`<history-view></history-view>`;

            case 'memory':
                return html`<memory-view></memory-view>`;

            case 'assistant':
                return html`
                    <assistant-view
                        .responses=${this.responses}
                        .currentResponseIndex=${this.currentResponseIndex}
                        .selectedProfile=${this.selectedProfile}
                        .responseTextOpacity=${this.responseTextOpacity}
                        .responseTextColor=${this.responseTextColor}
                        .interimTranscription=${this.interimTranscription}
                        .onSendText=${msg => this.handleSendText(msg)}
                        .shouldAnimateResponse=${this.shouldAnimateResponse}
                        @response-index-changed=${this.handleResponseIndexChanged}
                        @response-animation-complete=${() => {
                            this.shouldAnimateResponse = false;
                            this._currentResponseIsComplete = true;
                            this.requestUpdate();
                        }}
                    ></assistant-view>
                `;

            default:
                return html`<div>Unknown view: ${this.currentView}</div>`;
        }
    }

    renderSidebar() {
        const items = [
            {
                id: 'main',
                label: 'Home',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="m19 8.71l-5.333-4.148a2.666 2.666 0 0 0-3.274 0L5.059 8.71a2.67 2.67 0 0 0-1.029 2.105v7.2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.2c0-.823-.38-1.6-1.03-2.105"
                        />
                        <path d="M16 15c-2.21 1.333-5.792 1.333-8 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'ai-customize',
                label: 'AI & Skills',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <path
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 3v7h6l-8 11v-7H5z"
                    />
                </svg>`,
            },
            {
                id: 'history',
                label: 'History',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="M10 20.777a9 9 0 0 1-2.48-.969M14 3.223a9.003 9.003 0 0 1 0 17.554m-9.421-3.684a9 9 0 0 1-1.227-2.592M3.124 10.5c.16-.95.468-1.85.9-2.675l.169-.305m2.714-2.941A9 9 0 0 1 10 3.223"
                        />
                        <path d="M12 8v4l3 3" />
                    </g>
                </svg>`,
            },
            {
                id: 'memory',
                label: 'Memory',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                        <rect x="9" y="3" width="6" height="4" rx="1" />
                        <path d="M9 12l2 2l4-4" />
                    </g>
                </svg>`,
            },
            {
                id: 'customize',
                label: 'Settings',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="M19.875 6.27A2.23 2.23 0 0 1 21 8.218v7.284c0 .809-.443 1.555-1.158 1.948l-6.75 4.27a2.27 2.27 0 0 1-2.184 0l-6.75-4.27A2.23 2.23 0 0 1 3 15.502V8.217c0-.809.443-1.554 1.158-1.947l6.75-3.98a2.33 2.33 0 0 1 2.25 0l6.75 3.98z"
                        />
                        <path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'help',
                label: 'Help',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9s-9-1.8-9-9s1.8-9 9-9m0 13v.01" />
                        <path d="M12 13a2 2 0 0 0 .914-3.782a1.98 1.98 0 0 0-2.414.483" />
                    </g>
                </svg>`,
            },
        ];

        return html`
            <div class="sidebar ${this._isLiveMode() ? 'hidden' : ''}">
                <div class="sidebar-brand">
                    <h1>Shadow AI</h1>
                </div>
                <nav class="sidebar-nav">
                    ${items.map(
                        item => html`
                            <button
                                class="nav-item ${this.currentView === item.id ? 'active' : ''}"
                                @click=${() => this.navigate(item.id)}
                                title=${item.label}
                            >
                                ${item.icon} ${item.label}
                            </button>
                        `
                    )}
                </nav>
                <div class="sidebar-footer">
                    ${
                        this._updateAvailable
                            ? html`
                                  <button class="update-btn" @click=${() => this.handleExternalLinkClick('https://shadow-ai.com/download')}>
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                          <path
                                              fill="none"
                                              stroke="currentColor"
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                              stroke-width="2"
                                              d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5l5-5m-5-7v12"
                                          />
                                      </svg>
                                      Update available
                                  </button>
                              `
                            : html` <div class="version-text">v${this._localVersion}</div> `
                    }
                </div>
            </div>
        `;
    }

    renderLiveBar() {
        if (!this._isLiveMode()) return '';

        const profileLabels = {
            interview: 'Interview',
            sales: 'Sales Call',
            meeting: 'Meeting',
            presentation: 'Presentation',
            negotiation: 'Negotiation',
            exam: 'Exam',
        };

        return html`
            <div class="live-bar">
                <div class="live-bar-left">
                    <button class="live-bar-back" @click=${() => this.handleClose()} title="End session">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path
                                fill-rule="evenodd"
                                d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
                                clip-rule="evenodd"
                            />
                        </svg>
                    </button>
                </div>
                <div class="live-bar-center">${profileLabels[this.selectedProfile] || 'Session'}</div>
                <div class="live-bar-right">
                    ${this.statusText ? html`<span class="live-bar-text">${this.statusText}</span>` : ''}
                    <span class="live-bar-text">${this.getElapsedTime()}</span>
                    ${this._isClickThrough ? html`<span class="live-bar-text">[click through]</span>` : ''}
                    ${this._storageLoaded && this._privacyMode ? html`<span class="live-bar-text" style="color:var(--warning);">[privacy]</span>` : ''}
                    <span class="live-bar-text clickable" @click=${() => this.handleHideToggle()}>[hide]</span>
                </div>
            </div>
        `;
    }

    render() {
        // Onboarding is fullscreen, no sidebar
        if (this.currentView === 'onboarding') {
            return html` <div class="fullscreen">${this.renderCurrentView()}</div> `;
        }

        const isLive = this._isLiveMode();
        const providerIds = this._providerStatus.providerIds || [];
        const selectedProviderStatus = this.selectedProviderStatus();
        const providerStatusClass =
            selectedProviderStatus.state === 'disabled' ? 'disabled' : ['enabled', 'active'].includes(selectedProviderStatus.state) ? 'ok' : 'error';
        const modelProvider = this.modelProvider();
        const modelStatus = modelProvider ? this._providerStatus.providers?.[modelProvider] : null;

        return html`
            <div class="app-shell">
                ${
                    this._providerNotification
                        ? html`<div class="provider-notification ${this._providerNotification.type}" role="status" aria-live="polite">
                              ${this._providerNotification.message}
                          </div>`
                        : ''
                }
                <div class="top-drag-bar">
                    <div class="traffic-lights">
                        <button class="traffic-light close" @click=${() => this.handleClose()} title="Close"></button>
                        <button class="traffic-light minimize" @click=${() => this._handleMinimize()} title="Minimize / restore"></button>
                        <button class="traffic-light maximize" @click=${() => this._handleMaximize()} title="Maximize / restore"></button>
                    </div>
                    <div class="drag-region"></div>
                    <label class="provider-select-wrap" title=${selectedProviderStatus.message}>
                        <span class="provider-status-dot ${providerStatusClass}"></span>
                        <select
                            class="provider-select"
                            aria-label="AI provider selection"
                            .value=${this._providerStatus.selected || 'default'}
                            @change=${event => this.handleProviderSelection(event.target.value)}
                        >
                            <option value="default">Default (${this._providerStatus.effective || 'auto'})</option>
                            <option value="auto">Auto — fallback enabled</option>
                            ${providerIds.map(provider => {
                                const status = this._providerStatus.providers?.[provider];
                                return html`<option value=${provider} ?disabled=${!status?.configured}>
                                    ${this.providerOptionLabel(provider)}
                                </option>`;
                            })}
                        </select>
                    </label>
                    <select
                        class="provider-select provider-model-select"
                        aria-label="AI model selection"
                        title=${modelProvider ? `Model for ${modelProvider}` : 'Select an individual provider to choose a model'}
                        ?disabled=${!modelProvider || !modelStatus?.configured}
                        .value=${modelStatus?.selectedModel || ''}
                        @focus=${() => this.loadProviderStatus(true)}
                        @change=${event => this.handleProviderModelSelection(modelProvider, event.target.value)}
                    >
                        ${
                            modelProvider
                                ? (modelStatus?.models || []).map(model => html`<option value=${model}>${model}</option>`)
                                : html`<option value="">Model: automatic</option>`
                        }
                    </select>
                    <label
                        class="header-color-picker"
                        title="Choose the AI response text color"
                        style="--selected-ai-color: ${this.responseTextColor}"
                    >
                        <span>AI Color</span>
                        <span class="header-color-swatch" aria-hidden="true"></span>
                        <input
                            class="header-color"
                            type="color"
                            aria-label="Choose AI response text color"
                            .value=${this.responseTextColor}
                            @input=${event => this.handleResponseTextColorChange(event.target.value)}
                        />
                    </label>
                    <label class="header-control" title="Uses the Background Transparency setting">
                        <span>Background ${Math.round(this.backgroundTransparency * 100)}%</span>
                        <input
                            class="header-opacity"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            .value=${this.backgroundTransparency}
                            @input=${event => this.handleBackgroundTransparencyChange(event.target.value)}
                        />
                    </label>
                    <label class="header-control" title="Controls only AI response text opacity">
                        <span>AI Text ${Math.round(this.responseTextOpacity * 100)}%</span>
                        <input
                            class="header-opacity"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            .value=${this.responseTextOpacity}
                            @input=${event => this.handleResponseTextOpacityChange(event.target.value)}
                        />
                    </label>
                    <button
                        class="passthrough-button ${this._isClickThrough ? 'active' : ''}"
                        aria-pressed=${this._isClickThrough}
                        @click=${() => this.togglePassthrough()}
                    >
                        Passthrough
                    </button>
                </div>
                ${this.renderSidebar()}
                <div class="content">
                    ${isLive ? this.renderLiveBar() : ''}
                    <div class="content-inner ${isLive ? 'live' : ''}">${this.renderCurrentView()}</div>
                </div>
            </div>
        `;
    }
}

customElements.define('shadow-ai-app', ShadowAIApp);

import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

export class HistoryView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .unified-page {
                overflow-y: hidden;
            }

            .unified-wrap {
                height: 100%;
            }

            .search-wrap {
                position: relative;
                max-width: 280px;
            }

            .search-icon {
                position: absolute;
                left: 10px;
                top: 50%;
                transform: translateY(-50%);
                width: 14px;
                height: 14px;
                color: var(--text-muted);
                pointer-events: none;
            }

            .search-wrap .control {
                padding-left: 30px;
            }

            .history-heading {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--space-md);
            }

            .clear-history-button {
                border: 1px solid var(--danger, #ef4444);
                border-radius: var(--radius-sm);
                background: transparent;
                color: var(--danger, #ef4444);
                padding: 6px 10px;
                font-size: var(--font-size-xs);
                cursor: pointer;
            }

            .clear-history-button:hover:not(:disabled) {
                background: rgba(239, 68, 68, 0.12);
            }

            .clear-history-button:disabled {
                cursor: not-allowed;
                opacity: 0.45;
            }

            .history-error {
                color: var(--danger, #ef4444);
                font-size: var(--font-size-xs);
            }

            .list-shell {
                border: 1px solid var(--border);
                border-radius: var(--radius-md);
                background: var(--bg-surface);
                overflow: hidden;
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 0;
            }

            .sessions-list {
                overflow-y: auto;
                flex: 1;
            }

            .session-card {
                width: 100%;
                border: none;
                border-bottom: 1px solid var(--border);
                background: transparent;
                text-align: left;
                padding: var(--space-sm) var(--space-md);
                transition: background var(--transition);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--space-sm);
            }

            .session-open {
                min-width: 0;
                flex: 1;
                border: none;
                background: transparent;
                text-align: left;
                cursor: pointer;
            }

            .session-actions {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .session-delete,
            .detail-action {
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: transparent;
                color: var(--text-secondary);
                padding: 5px 8px;
                font-size: var(--font-size-xs);
                cursor: pointer;
            }

            .session-delete,
            .detail-action.danger {
                color: var(--danger, #ef4444);
                border-color: var(--danger, #ef4444);
            }

            .session-name {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
                font-weight: 600;
            }

            .session-note-preview {
                color: var(--text-muted);
                font-size: var(--font-size-xs);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 440px;
            }

            .session-card:hover {
                background: var(--bg-hover);
            }

            .session-left {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .session-profile {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
            }

            .session-date {
                color: var(--text-muted);
                font-size: var(--font-size-xs);
            }

            .session-badge {
                color: var(--text-secondary);
                font-size: var(--font-size-xs);
                background: var(--bg-elevated);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                padding: 2px 8px;
                white-space: nowrap;
            }

            .detail-top {
                display: flex;
                align-items: center;
                gap: var(--space-sm);
            }

            .back-btn {
                border: none;
                background: none;
                color: var(--text-muted);
                padding: 0;
                font-size: var(--font-size-sm);
                cursor: pointer;
                display: flex;
                align-items: center;
            }

            .back-btn svg {
                cursor: pointer;
            }

            .back-btn:hover {
                color: var(--text-primary);
            }

            .detail-info {
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
            }

            .detail-actions {
                display: flex;
                gap: 6px;
                margin-left: auto;
            }

            .metadata-editor {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: var(--space-sm);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-surface);
            }

            .metadata-editor textarea {
                min-height: 80px;
                resize: vertical;
            }

            .tab-row {
                display: flex;
                gap: 6px;
            }

            .tab-btn {
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: transparent;
                color: var(--text-muted);
                padding: 6px 10px;
                cursor: pointer;
                font-size: var(--font-size-xs);
            }

            .tab-btn:hover {
                color: var(--text-secondary);
            }

            .tab-btn.active {
                color: var(--text-primary);
                border-color: var(--text-secondary);
            }

            .details-scroll {
                overflow-y: auto;
                flex: 1;
                min-height: 0;
                display: flex;
                flex-direction: column;
                gap: var(--space-sm);
                padding: var(--space-sm) 0;
            }

            .message-row {
                display: flex;
            }

            .message-row.user {
                justify-content: flex-end;
            }

            .message-row.ai,
            .message-row.screen {
                justify-content: flex-start;
            }

            .message {
                max-width: 75%;
                border-radius: 16px;
                padding: 8px 12px;
                word-break: break-word;
                user-select: text;
                cursor: text;
                font-size: var(--font-size-sm);
                line-height: 1.45;
            }

            .message-body {
                white-space: pre-wrap;
            }

            .message-meta {
                font-size: 10px;
                margin-top: 4px;
                opacity: 0.5;
            }

            .message-row.user .message {
                background: var(--accent);
                color: var(--bg-app);
                border-bottom-right-radius: 4px;
            }

            .message-row.user .message-meta {
                text-align: right;
            }

            .message-row.ai .message {
                background: var(--bg-elevated);
                color: var(--text-primary);
                border: 1px solid var(--border);
                border-bottom-left-radius: 4px;
            }

            .message-row.screen .message {
                background: var(--bg-elevated);
                color: var(--text-primary);
                border: 1px solid var(--border);
                border-bottom-left-radius: 4px;
            }

            .context-row {
                display: flex;
                align-items: flex-start;
                gap: var(--space-sm);
                padding: var(--space-sm);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
            }

            .context-key {
                width: 84px;
                color: var(--text-muted);
                font-size: var(--font-size-xs);
                text-transform: uppercase;
                letter-spacing: 0.4px;
                flex-shrink: 0;
            }

            .context-value {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
                line-height: 1.45;
                white-space: pre-wrap;
                word-break: break-word;
                user-select: text;
                cursor: text;
            }

            .empty {
                color: var(--text-muted);
                font-size: var(--font-size-sm);
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 120px;
                border: 1px dashed var(--border);
                border-radius: var(--radius-sm);
            }
        `,
    ];

    static properties = {
        sessions: { type: Array },
        selectedSession: { type: Object },
        selectedSessionId: { type: String },
        loading: { type: Boolean },
        activeTab: { type: String },
        searchQuery: { type: String },
        clearingHistory: { type: Boolean },
        historyError: { type: String },
        editingMetadata: { type: Boolean },
        draftSessionName: { type: String },
        draftSessionNote: { type: String },
    };

    constructor() {
        super();
        this.sessions = [];
        this.selectedSession = null;
        this.selectedSessionId = null;
        this.loading = true;
        this.activeTab = 'conversation';
        this.searchQuery = '';
        this.clearingHistory = false;
        this.historyError = '';
        this.editingMetadata = false;
        this.draftSessionName = '';
        this.draftSessionNote = '';
        this.loadSessions();
    }

    async loadSessions() {
        try {
            this.loading = true;
            this.sessions = await shadowAI.storage.getAllSessions();
        } catch (error) {
            console.error('Error loading sessions:', error);
            this.sessions = [];
        } finally {
            this.loading = false;
            this.requestUpdate();
        }
    }

    async openSession(sessionId) {
        try {
            const session = await shadowAI.storage.getSession(sessionId);
            if (session) {
                this.selectedSession = session;
                this.selectedSessionId = sessionId;
                this.activeTab = 'conversation';
                this.editingMetadata = false;
                this.requestUpdate();
            }
        } catch (error) {
            console.error('Error loading session:', error);
        }
    }

    closeSession() {
        this.selectedSession = null;
        this.selectedSessionId = null;
        this.activeTab = 'conversation';
        this.editingMetadata = false;
    }

    handleSearchInput(e) {
        this.searchQuery = e.target.value;
    }

    async clearHistory() {
        if (this.clearingHistory || this.sessions.length === 0) return;
        if (!window.confirm(`Clear all ${this.sessions.length} saved session${this.sessions.length === 1 ? '' : 's'}? This cannot be undone.`))
            return;

        this.clearingHistory = true;
        this.historyError = '';
        try {
            const result = await shadowAI.storage.deleteAllSessions();
            if (!result?.success) throw new Error(result?.error || 'Unable to clear history.');
            this.sessions = [];
            this.selectedSession = null;
            this.selectedSessionId = null;
            this.searchQuery = '';
        } catch (error) {
            console.error('Error clearing history:', error);
            this.historyError = error.message || 'Unable to clear history.';
        } finally {
            this.clearingHistory = false;
        }
    }

    startEditingMetadata() {
        this.draftSessionName = this.selectedSession?.sessionName || '';
        this.draftSessionNote = this.selectedSession?.sessionNote || '';
        this.editingMetadata = true;
    }

    async saveMetadata() {
        if (!this.selectedSessionId) return;
        this.historyError = '';
        const result = await shadowAI.storage.saveSession(this.selectedSessionId, {
            sessionName: this.draftSessionName,
            sessionNote: this.draftSessionNote,
        });
        if (!result?.success) {
            this.historyError = result?.error || 'Unable to update session details.';
            return;
        }
        this.selectedSession = await shadowAI.storage.getSession(this.selectedSessionId);
        this.editingMetadata = false;
        await this.loadSessions();
    }

    async deleteSession(sessionId) {
        const session = this.sessions.find(item => item.sessionId === sessionId) || this.selectedSession;
        const label = session?.sessionName || this._getProfileLabel(session || {});
        if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
        const result = await shadowAI.storage.deleteSession(sessionId);
        if (!result?.success) {
            this.historyError = result?.error || 'Unable to delete session.';
            return;
        }
        if (this.selectedSessionId === sessionId) this.closeSession();
        await this.loadSessions();
    }

    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    getProfileNames() {
        return {
            interview: 'Job Interview',
            sales: 'Sales Call',
            meeting: 'Business Meeting',
            presentation: 'Presentation',
            negotiation: 'Negotiation',
            exam: 'Exam Assistant',
        };
    }

    _getProfileLabel(session) {
        if (session.sessionName) return session.sessionName;
        if (session.profile) {
            const names = this.getProfileNames();
            return names[session.profile] || session.profile;
        }
        return 'Session';
    }

    getSessionPreview(session) {
        const parts = [];
        if (session.messageCount > 0) parts.push(`${session.messageCount} messages`);
        if (session.screenAnalysisCount > 0) parts.push(`${session.screenAnalysisCount} screen`);
        if (session.profile) {
            const profileNames = this.getProfileNames();
            parts.push(profileNames[session.profile] || session.profile);
        }
        return parts.length > 0 ? parts.join(' · ') : 'Empty session';
    }

    getFilteredSessions() {
        if (!this.searchQuery.trim()) return this.sessions;
        const q = this.searchQuery.toLowerCase();
        return this.sessions.filter(session => {
            const preview = this.getSessionPreview(session).toLowerCase();
            const date = this.formatDate(session.createdAt).toLowerCase();
            const metadata = `${session.sessionName || ''} ${session.sessionNote || ''}`.toLowerCase();
            return preview.includes(q) || date.includes(q) || metadata.includes(q);
        });
    }

    collectConversation(session) {
        const messages = [];
        const history = session.conversationHistory || [];
        history.forEach(turn => {
            if (turn.transcription) messages.push({ type: 'user', content: turn.transcription, timestamp: turn.timestamp });
            if (turn.ai_response) messages.push({ type: 'ai', content: turn.ai_response, timestamp: turn.timestamp });
        });
        return messages;
    }

    renderTabContent() {
        if (!this.selectedSession) return html`<div class="empty">Select a session.</div>`;

        if (this.activeTab === 'conversation') {
            const messages = this.collectConversation(this.selectedSession);
            if (!messages.length) return html`<div class="empty">No conversation data.</div>`;
            return messages.map(
                msg => html`
                    <div class="message-row ${msg.type}">
                        <div class="message">
                            <div class="message-body">${msg.content}</div>
                            <div class="message-meta">${this.formatTime(msg.timestamp)}</div>
                        </div>
                    </div>
                `
            );
        }

        if (this.activeTab === 'screen') {
            const screen = this.selectedSession.screenAnalysisHistory || [];
            if (!screen.length) return html`<div class="empty">No screen analysis data.</div>`;
            return screen.map(
                entry => html`
                    <div class="message-row screen">
                        <div class="message">
                            <div class="message-body">${entry.response || ''}</div>
                            <div class="message-meta">${this.formatTime(entry.timestamp)}</div>
                        </div>
                    </div>
                `
            );
        }

        const profile = this.selectedSession.profile;
        const prompt = this.selectedSession.customPrompt;
        const sessionName = this.selectedSession.sessionName;
        const sessionNote = this.selectedSession.sessionNote;
        if (!profile && !prompt && !sessionName && !sessionNote) return html`<div class="empty">No context saved for this session.</div>`;

        return html`
            ${
                sessionName
                    ? html`<div class="context-row"><span class="context-key">Name</span><span class="context-value">${sessionName}</span></div>`
                    : ''
            }
            ${
                sessionNote
                    ? html`<div class="context-row"><span class="context-key">Note</span><span class="context-value">${sessionNote}</span></div>`
                    : ''
            }
            ${
                profile
                    ? html`
                          <div class="context-row">
                              <span class="context-key">Profile</span>
                              <span class="context-value">${this.getProfileNames()[profile] || profile}</span>
                          </div>
                      `
                    : ''
            }
            ${
                prompt
                    ? html`
                          <div class="context-row">
                              <span class="context-key">Prompt</span>
                              <span class="context-value">${prompt}</span>
                          </div>
                      `
                    : ''
            }
        `;
    }

    renderListView() {
        const filteredSessions = this.getFilteredSessions();
        return html`
            <div class="history-heading">
                <div class="page-title">History</div>
                <button
                    class="clear-history-button"
                    ?disabled=${this.loading || this.clearingHistory || this.sessions.length === 0}
                    @click=${this.clearHistory}
                >
                    ${this.clearingHistory ? 'Clearing...' : 'Clear History'}
                </button>
            </div>

            ${this.historyError ? html`<div class="history-error" role="alert">${this.historyError}</div>` : ''}

            <div class="search-wrap">
                <svg
                    class="search-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input class="control" type="text" placeholder="Search sessions..." .value=${this.searchQuery} @input=${this.handleSearchInput} />
            </div>

            <section class="list-shell">
                <div class="sessions-list">
                    ${this.loading ? html`<div class="empty" style="margin:var(--space-md);">Loading sessions...</div>` : ''}
                    ${!this.loading && filteredSessions.length === 0 ? html`<div class="empty" style="margin:var(--space-md);">No matching sessions.</div>` : ''}
                    ${
                        !this.loading
                            ? filteredSessions.map(
                                  session => html`
                                      <div class="session-card">
                                          <button class="session-open" @click=${() => this.openSession(session.sessionId)}>
                                              <div class="session-left">
                                                  <span class="session-name">${this._getProfileLabel(session)}</span>
                                                  <span class="session-date"
                                                      >${this.formatDate(session.createdAt)} · ${this.formatTime(session.createdAt)}</span
                                                  >
                                                  ${session.sessionNote ? html`<span class="session-note-preview">${session.sessionNote}</span>` : ''}
                                              </div>
                                          </button>
                                          <div class="session-actions">
                                              ${session.messageCount > 0 ? html`<span class="session-badge">${session.messageCount}</span>` : ''}
                                              <button class="session-delete" @click=${() => this.deleteSession(session.sessionId)}>Delete</button>
                                          </div>
                                      </div>
                                  `
                              )
                            : ''
                    }
                </div>
            </section>
        `;
    }

    renderDetailView() {
        const conversationCount = this.collectConversation(this.selectedSession).length;
        const screenCount = this.selectedSession?.screenAnalysisHistory?.length || 0;

        return html`
            <div class="page-title">Session Detail</div>
            <div class="detail-top">
                <button class="back-btn" @click=${this.closeSession}>
                    <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>
                <span class="detail-info"
                    >${this._getProfileLabel(this.selectedSession)} · ${this.formatDate(this.selectedSession.createdAt)} ·
                    ${this.formatTime(this.selectedSession.createdAt)}</span
                >
                <div class="detail-actions">
                    <button class="detail-action" @click=${this.startEditingMetadata}>Edit details</button>
                    <button class="detail-action danger" @click=${() => this.deleteSession(this.selectedSessionId)}>Delete session</button>
                </div>
            </div>
            ${
                this.editingMetadata
                    ? html`
                          <div class="metadata-editor">
                              <input
                                  class="control"
                                  maxlength="120"
                                  placeholder="Session name"
                                  .value=${this.draftSessionName}
                                  @input=${event => (this.draftSessionName = event.target.value)}
                              />
                              <textarea
                                  class="control"
                                  maxlength="2000"
                                  placeholder="Session note"
                                  .value=${this.draftSessionNote}
                                  @input=${event => (this.draftSessionNote = event.target.value)}
                              ></textarea>
                              <div class="detail-actions">
                                  <button class="detail-action" @click=${this.saveMetadata}>Save changes</button>
                                  <button class="detail-action" @click=${() => (this.editingMetadata = false)}>Cancel</button>
                              </div>
                          </div>
                      `
                    : ''
            }
            <div class="tab-row">
                <button
                    class="tab-btn ${this.activeTab === 'conversation' ? 'active' : ''}"
                    @click=${() => {
                        this.activeTab = 'conversation';
                    }}
                >
                    Conversation (${conversationCount})
                </button>
                <button
                    class="tab-btn ${this.activeTab === 'screen' ? 'active' : ''}"
                    @click=${() => {
                        this.activeTab = 'screen';
                    }}
                >
                    Screen (${screenCount})
                </button>
                <button
                    class="tab-btn ${this.activeTab === 'context' ? 'active' : ''}"
                    @click=${() => {
                        this.activeTab = 'context';
                    }}
                >
                    Context
                </button>
            </div>
            <section class="details-scroll">${this.renderTabContent()}</section>
        `;
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">${this.selectedSession ? this.renderDetailView() : this.renderListView()}</div>
            </div>
        `;
    }
}

customElements.define('history-view', HistoryView);

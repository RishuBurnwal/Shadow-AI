import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

export class MemoryView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .memory-layout {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: var(--space-md);
                align-items: start;
            }

            @media (max-width: 900px) {
                .memory-layout {
                    grid-template-columns: 1fr;
                }
            }

            .memory-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--space-md);
                grid-column: 1 / -1;
            }

            .memory-actions {
                display: flex;
                gap: 6px;
            }

            .clear-btn {
                border: 1px solid var(--danger, #ef4444);
                border-radius: var(--radius-sm);
                background: transparent;
                color: var(--danger, #ef4444);
                padding: 6px 10px;
                font-size: var(--font-size-xs);
                cursor: pointer;
            }

            .clear-btn:hover:not(:disabled) {
                background: rgba(239, 68, 68, 0.12);
            }

            .clear-btn:disabled {
                cursor: not-allowed;
                opacity: 0.45;
            }

            .memory-count {
                font-size: var(--font-size-sm);
                color: var(--text-muted);
            }

            .fact-card {
                border: 1px solid var(--border);
                border-radius: var(--radius-md);
                background: var(--bg-surface);
                overflow: hidden;
            }

            .fact-card-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--space-sm);
                padding: var(--space-sm) var(--space-md);
                border-bottom: 1px solid var(--border);
                background: var(--bg-elevated);
            }

            .fact-card-body {
                padding: var(--space-sm) var(--space-md);
                display: flex;
                flex-direction: column;
                gap: var(--space-sm);
            }

            .fact-text {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
                line-height: 1.45;
                user-select: text;
                cursor: text;
            }

            .fact-meta {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: var(--font-size-xs);
                color: var(--text-muted);
            }

            .fact-category {
                text-transform: uppercase;
                letter-spacing: 0.4px;
                font-size: 10px;
                color: var(--text-secondary);
                font-weight: 600;
            }

            .fact-date {
                color: var(--text-muted);
            }

            .fact-source {
                color: var(--text-muted);
            }

            .fact-actions {
                display: flex;
                gap: 6px;
            }

            .fact-btn {
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: transparent;
                color: var(--text-secondary);
                padding: 4px 8px;
                font-size: var(--font-size-xs);
                cursor: pointer;
            }

            .fact-btn:hover {
                border-color: var(--text-muted);
                color: var(--text-primary);
            }

            .fact-btn.danger {
                color: var(--danger, #ef4444);
                border-color: var(--danger, #ef4444);
            }

            .fact-btn.danger:hover {
                background: rgba(239, 68, 68, 0.12);
            }

            .fact-edit-area {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .fact-edit-area textarea {
                min-height: 60px;
                resize: vertical;
            }

            .fact-edit-actions {
                display: flex;
                gap: 6px;
            }

            .empty-state {
                color: var(--text-muted);
                font-size: var(--font-size-sm);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: var(--space-sm);
                min-height: 160px;
                border: 1px dashed var(--border);
                border-radius: var(--radius-sm);
                padding: var(--space-md);
                text-align: center;
            }

            .error-msg {
                color: var(--danger, #ef4444);
                font-size: var(--font-size-xs);
            }

            .profile-card {
                border: 1px solid var(--border);
                border-radius: var(--radius-md);
                background: var(--bg-surface);
                overflow: hidden;
            }

            .profile-card-body {
                padding: var(--space-sm) var(--space-md);
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .profile-row {
                display: flex;
                gap: var(--space-sm);
                font-size: var(--font-size-sm);
            }

            .profile-key {
                color: var(--text-muted);
                flex-shrink: 0;
                min-width: 100px;
            }

            .profile-value {
                color: var(--text-primary);
                user-select: text;
                cursor: text;
            }

            .profile-value.empty {
                color: var(--text-muted);
                font-style: italic;
            }
        `,
    ];

    static properties = {
        facts: { type: Array },
        profile: { type: Object },
        loading: { type: Boolean },
        editingId: { type: String },
        editText: { type: String },
        editCategory: { type: String },
        errorMsg: { type: String },
        clearing: { type: Boolean },
        privacyMode: { type: Boolean },
    };

    constructor() {
        super();
        this.facts = [];
        this.profile = {};
        this.loading = true;
        this.editingId = null;
        this.editText = '';
        this.editCategory = '';
        this.errorMsg = '';
        this.clearing = false;
        this.privacyMode = false;
        this.loadPrivacyPref();
        this.loadMemory();
    }

    async loadPrivacyPref() {
        try {
            const prefs = await shadowAI.storage.getPreferences();
            this.privacyMode = prefs.privacyMode ?? false;
        } catch {
            this.privacyMode = false;
        }
    }

    async loadMemory() {
        try {
            this.loading = true;
            this.errorMsg = '';
            const data = await shadowAI.storage.getMemory();
            this.facts = data.facts || [];
            this.profile = data.profile || {};
        } catch (error) {
            console.error('Error loading memory:', error);
            this.errorMsg = error.message || 'Unable to load memory.';
            this.facts = [];
        } finally {
            this.loading = false;
            this.requestUpdate();
        }
    }

    startEdit(fact) {
        this.editingId = fact.id;
        this.editText = fact.fact;
        this.editCategory = fact.category;
        this.requestUpdate();
    }

    cancelEdit() {
        this.editingId = null;
        this.editText = '';
        this.editCategory = '';
        this.requestUpdate();
    }

    async saveEdit() {
        if (!this.editingId || !this.editText.trim()) return;
        this.errorMsg = '';
        const result = await shadowAI.storage.updateMemoryEntry(this.editingId, {
            fact: this.editText.trim(),
            category: this.editCategory || 'other',
        });
        if (!result?.success) {
            this.errorMsg = result?.error || 'Unable to update memory entry.';
            return;
        }
        this.editingId = null;
        this.editText = '';
        this.editCategory = '';
        await this.loadMemory();
    }

    async deleteEntry(id) {
        if (!window.confirm('Delete this memory fact?')) return;
        this.errorMsg = '';
        const result = await shadowAI.storage.deleteMemoryEntry(id);
        if (!result?.success) {
            this.errorMsg = result?.error || 'Unable to delete memory entry.';
            return;
        }
        await this.loadMemory();
    }

    async clearAll() {
        if (this.clearing || this.facts.length === 0) return;
        if (!window.confirm(`Clear all ${this.facts.length} memory facts? This cannot be undone.`)) return;
        this.clearing = true;
        this.errorMsg = '';
        const result = await shadowAI.storage.clearMemory();
        if (!result?.success) {
            this.errorMsg = result?.error || 'Unable to clear memory.';
        }
        this.clearing = false;
        await this.loadMemory();
    }

    formatDate(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    renderFactCard(fact) {
        const isEditing = this.editingId === fact.id;
        return html`
            <div class="fact-card">
                <div class="fact-card-header">
                    <span class="fact-category">${fact.category}</span>
                    <div class="fact-meta">
                        <span class="fact-date">${this.formatDate(fact.createdAt)}</span>
                        <span class="fact-source">${fact.source || 'auto'}</span>
                    </div>
                </div>
                <div class="fact-card-body">
                    ${
                        isEditing
                            ? html`
                                  <div class="fact-edit-area">
                                      <textarea class="control" .value=${this.editText} @input=${e => (this.editText = e.target.value)}></textarea>
                                      <select class="control" .value=${this.editCategory} @change=${e => (this.editCategory = e.target.value)}>
                                          <option value="skill">Skill</option>
                                          <option value="preference">Preference</option>
                                          <option value="background">Background</option>
                                          <option value="project">Project</option>
                                          <option value="goal">Goal</option>
                                          <option value="other">Other</option>
                                      </select>
                                      <div class="fact-edit-actions">
                                          <button class="fact-btn" @click=${this.saveEdit}>Save</button>
                                          <button class="fact-btn" @click=${this.cancelEdit}>Cancel</button>
                                      </div>
                                  </div>
                              `
                            : html`
                                  <div class="fact-text">${fact.fact}</div>
                                  <div class="fact-actions">
                                      <button class="fact-btn" @click=${() => this.startEdit(fact)}>Edit</button>
                                      <button class="fact-btn danger" @click=${() => this.deleteEntry(fact.id)}>Delete</button>
                                  </div>
                              `
                    }
                </div>
            </div>
        `;
    }

    renderMemoryPanel() {
        if (this.loading) {
            return html`<div class="empty-state">Loading memory data...</div>`;
        }

        const sorted = [...this.facts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        return html`
            <div class="memory-header">
                <div>
                    <div class="page-title">Memory</div>
                    <div class="memory-count">${this.facts.length} fact${this.facts.length === 1 ? '' : 's'} learned</div>
                </div>
                <div class="memory-actions">
                    <button class="clear-btn" ?disabled=${this.clearing || this.facts.length === 0} @click=${this.clearAll}>
                        ${this.clearing ? 'Clearing...' : 'Clear All Memory'}
                    </button>
                </div>
            </div>

            ${this.errorMsg ? html`<div class="error-msg" role="alert">${this.errorMsg}</div>` : ''}
            ${
                this.privacyMode
                    ? html`
                          <div class="surface" style="grid-column:1/-1;border-color:var(--warning);border-style:dashed;">
                              <div class="surface-title" style="color:var(--warning);">Privacy Mode Active</div>
                              <div class="surface-subtitle">
                                  Memory learning is paused. No new facts will be remembered from your conversations until you turn off Privacy Mode
                                  in Settings.
                              </div>
                          </div>
                      `
                    : ''
            }

            <div class="memory-layout">
                <div class="surface" style="grid-column:1/-1;">
                    <div class="surface-title">Learned Facts</div>
                    <div class="surface-subtitle">The assistant learns these from your conversations over time.</div>
                    ${
                        sorted.length === 0
                            ? html`
                                  <div class="empty-state">
                                      No memory facts yet.
                                      <br />
                                      <span class="muted">Facts are automatically extracted from your sessions when you close them.</span>
                                  </div>
                              `
                            : sorted.map(f => this.renderFactCard(f))
                    }
                </div>

                <div class="profile-card" style="grid-column:1/-1;">
                    <div class="fact-card-header">
                        <span class="fact-category">Static Profile</span>
                        <span class="muted">Set in AI Customization</span>
                    </div>
                    <div class="profile-card-body">
                        ${
                            this.profile?.name
                                ? html`<div class="profile-row">
                                      <span class="profile-key">Name</span><span class="profile-value">${this.profile.name}</span>
                                  </div>`
                                : ''
                        }
                        ${
                            this.profile?.targetRole
                                ? html`<div class="profile-row">
                                      <span class="profile-key">Target Role</span><span class="profile-value">${this.profile.targetRole}</span>
                                  </div>`
                                : ''
                        }
                        ${
                            this.profile?.experienceSummary
                                ? html`<div class="profile-row">
                                      <span class="profile-key">Background</span><span class="profile-value">${this.profile.experienceSummary}</span>
                                  </div>`
                                : ''
                        }
                        ${
                            this.profile?.keySkills?.length > 0
                                ? html`<div class="profile-row">
                                      <span class="profile-key">Key Skills</span
                                      ><span class="profile-value">${this.profile.keySkills.join(', ')}</span>
                                  </div>`
                                : ''
                        }
                        ${
                            this.profile?.preferredTone
                                ? html`<div class="profile-row">
                                      <span class="profile-key">Preferred Tone</span><span class="profile-value">${this.profile.preferredTone}</span>
                                  </div>`
                                : ''
                        }
                        ${
                            !this.profile?.name && !this.profile?.targetRole && !this.profile?.experienceSummary && !this.profile?.keySkills?.length
                                ? html`<div class="profile-row">
                                      <span class="profile-value empty">No profile data. Set up in AI Customization > About Me.</span>
                                  </div>`
                                : ''
                        }
                    </div>
                </div>
            </div>
        `;
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">${this.renderMemoryPanel()}</div>
            </div>
        `;
    }
}

customElements.define('memory-view', MemoryView);

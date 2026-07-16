import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

export class AICustomizeView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .unified-page {
                height: 100%;
            }
            .unified-wrap {
                height: 100%;
            }
            section.surface {
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            .form-grid {
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            .form-row {
                display: flex;
                gap: var(--space-md);
            }
            .form-row .form-group {
                flex: 1;
            }
            .form-group.vertical {
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            textarea.control {
                flex: 1;
                resize: none;
                overflow-y: auto;
                min-height: 0;
            }

            /* ── Tabs ── */
            .tabs {
                display: flex;
                gap: 0;
                border-bottom: 1px solid var(--border);
                margin-bottom: var(--space-md);
            }
            .tab {
                padding: var(--space-sm) var(--space-md);
                border: none;
                background: none;
                color: var(--text-muted);
                font-size: var(--font-size-sm);
                cursor: pointer;
                border-bottom: 2px solid transparent;
                transition:
                    color var(--transition),
                    border-color var(--transition);
            }
            .tab:hover {
                color: var(--text-primary);
            }
            .tab.active {
                color: var(--text-primary);
                border-bottom-color: var(--accent);
            }

            /* ── Profile fields ── */
            .tag-list {
                display: flex;
                flex-wrap: wrap;
                gap: var(--space-xs);
                margin-top: var(--space-xs);
            }
            .tag {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
                border: 1px solid var(--border);
                font-size: var(--font-size-xs);
                color: var(--text-secondary);
            }
            .tag-remove {
                cursor: pointer;
                color: var(--text-muted);
                font-size: 10px;
                line-height: 1;
                padding: 0 2px;
            }
            .tag-remove:hover {
                color: var(--danger, #ef4444);
            }
            .tag-input-row {
                display: flex;
                gap: var(--space-xs);
            }
            .tag-input-row .control {
                flex: 1;
            }
            .tag-add-btn {
                padding: var(--space-xs) var(--space-sm);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
                color: var(--text-primary);
                cursor: pointer;
                font-size: var(--font-size-xs);
            }
            .tag-add-btn:hover {
                border-color: var(--accent);
            }
            .inline-input {
                display: flex;
                align-items: center;
                gap: var(--space-xs);
            }
            .inline-input input[type='text'] {
                flex: 1;
            }
            .profile-actions {
                display: flex;
                gap: var(--space-sm);
                margin-top: var(--space-md);
            }
            .btn-secondary {
                padding: var(--space-xs) var(--space-md);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
                color: var(--text-primary);
                cursor: pointer;
                font-size: var(--font-size-xs);
            }
            .btn-secondary:hover {
                border-color: var(--accent);
            }
            .btn-danger {
                padding: var(--space-xs) var(--space-md);
                border: 1px solid rgba(239, 68, 68, 0.3);
                border-radius: var(--radius-sm);
                background: rgba(239, 68, 68, 0.08);
                color: var(--danger, #ef4444);
                cursor: pointer;
                font-size: var(--font-size-xs);
            }
            .btn-danger:hover {
                background: rgba(239, 68, 68, 0.15);
            }
        `,
    ];

    static properties = {
        selectedProfile: { type: String },
        onProfileChange: { type: Function },
        _context: { state: true },
        _activeTab: { state: true },
        // Profile fields
        _profileName: { state: true },
        _targetRole: { state: true },
        _experienceSummary: { state: true },
        _keySkills: { state: true },
        _pastProjects: { state: true },
        _preferredTone: { state: true },
        _resumeText: { state: true },
        _newSkill: { state: true },
        _newProject: { state: true },
        _profileLoaded: { state: true },
        _skills: { state: true },
        _syncing: { state: true },
        _syncResult: { state: true },
        _promptSkills: { state: true },
        _editingSkill: { state: true },
        _skillError: { state: true },
    };

    constructor() {
        super();
        this.selectedProfile = 'interview';
        this.onProfileChange = () => {};
        this._context = '';
        this._activeTab = 'context';
        this._skills = [];
        this._syncing = false;
        this._syncResult = null;
        this._profileLoaded = false;
        this._promptSkills = [];
        this._editingSkill = null;
        this._skillError = '';
        this._saveTimer = null;
        this._loadFromStorage();
    }

    _debounceSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._saveProfile(), 300);
    }

    async _loadFromStorage() {
        try {
            const prefs = await shadowAI.storage.getPreferences();
            this._context = prefs.customPrompt || '';
            this._promptSkills = await shadowAI.storage.getPromptSkills();

            // Load skills
            if (shadowAI.storage.getPreferences) {
                const prefs2 = await shadowAI.storage.getPreferences();
                this._skills = Array.isArray(prefs2.enabledSkills) ? prefs2.enabledSkills : [];
            }

            // Load profile
            const profile = await shadowAI.storage.getProfile();
            if (profile && typeof profile === 'object') {
                this._profileName = profile.name || '';
                this._targetRole = profile.targetRole || '';
                this._experienceSummary = profile.experienceSummary || '';
                this._keySkills = Array.isArray(profile.keySkills) ? profile.keySkills : [];
                this._pastProjects = Array.isArray(profile.pastProjects) ? profile.pastProjects : [];
                this._preferredTone = profile.preferredTone || 'professional';
                this._resumeText = profile.resumeText || '';
            }
            this._profileLoaded = true;
            this.requestUpdate();
        } catch (error) {
            console.error('Error loading AI customize storage:', error);
            this._profileLoaded = true;
        }
    }

    _handleProfileChange(e) {
        this.onProfileChange(e.target.value);
    }

    async _saveContext(val) {
        this._context = val;
        await shadowAI.storage.updatePreference('customPrompt', val);
    }

    async _saveProfile() {
        if (!shadowAI.storage.setProfile) return;
        await shadowAI.storage.setProfile({
            name: this._profileName || '',
            targetRole: this._targetRole || '',
            experienceSummary: this._experienceSummary || '',
            keySkills: this._keySkills || [],
            pastProjects: this._pastProjects || [],
            preferredTone: this._preferredTone || 'professional',
            resumeText: this._resumeText || '',
        });
    }

    async _deleteProfile() {
        if (!shadowAI.storage.deleteProfile) return;
        await shadowAI.storage.deleteProfile();
        this._profileName = '';
        this._targetRole = '';
        this._experienceSummary = '';
        this._keySkills = [];
        this._pastProjects = [];
        this._preferredTone = 'professional';
        this._resumeText = '';
        this.requestUpdate();
    }

    _addSkill() {
        const skill = (this._newSkill || '').trim();
        if (skill && !this._keySkills.includes(skill)) {
            this._keySkills = [...this._keySkills, skill];
            this._newSkill = '';
            this._saveProfile();
        }
    }

    _removeSkill(idx) {
        this._keySkills = this._keySkills.filter((_, i) => i !== idx);
        this._saveProfile();
    }

    _addProject() {
        const proj = (this._newProject || '').trim();
        if (proj && !this._pastProjects.includes(proj)) {
            this._pastProjects = [...this._pastProjects, proj];
            this._newProject = '';
            this._saveProfile();
        }
    }

    _removeProject(idx) {
        this._pastProjects = this._pastProjects.filter((_, i) => i !== idx);
        this._saveProfile();
    }

    async _toggleSkill(skillId, enabled) {
        if (enabled) {
            if (!this._skills.includes(skillId)) this._skills = [...this._skills, skillId];
        } else {
            this._skills = this._skills.filter(id => id !== skillId);
        }
        await shadowAI.storage.updatePreference('enabledSkills', this._skills);
    }

    _isSkillEnabled(skillId) {
        return this._skills.includes(skillId);
    }

    _newPromptSkill() {
        this._editingSkill = { id: '', name: '', description: '', prompt: '', enabled: true };
        this._skillError = '';
    }

    _editPromptSkill(skill) {
        this._editingSkill = { ...skill };
        this._skillError = '';
    }

    async _savePromptSkill() {
        const draft = this._editingSkill;
        if (!draft) return;
        const result = draft.id ? await shadowAI.storage.updatePromptSkill(draft.id, draft) : await shadowAI.storage.createPromptSkill(draft);
        if (!result.success) {
            this._skillError = result.error || 'Could not save skill.';
            return;
        }
        this._promptSkills = await shadowAI.storage.getPromptSkills();
        this._editingSkill = null;
        this._skillError = '';
    }

    async _togglePromptSkill(skill) {
        await shadowAI.storage.updatePromptSkill(skill.id, { enabled: !skill.enabled });
        this._promptSkills = await shadowAI.storage.getPromptSkills();
    }

    async _deletePromptSkill(skill) {
        if (!window.confirm(`Delete skill "${skill.name}"?`)) return;
        await shadowAI.storage.deletePromptSkill(skill.id);
        this._promptSkills = await shadowAI.storage.getPromptSkills();
        if (this._editingSkill?.id === skill.id) this._editingSkill = null;
    }

    async _handleResumeSync() {
        if (this._syncing || !this._resumeText?.trim()) return;
        this._syncing = true;
        this._syncResult = null;
        this.requestUpdate();
        try {
            const result = await shadowAI.storage.resumeSync(this._resumeText);
            if (result.success && result.profile) {
                this._syncResult = { type: 'success', profile: result.profile };
                this._profileName = result.profile.name || this._profileName;
                this._targetRole = result.profile.targetRole || this._targetRole;
                this._experienceSummary = result.profile.experienceSummary || this._experienceSummary;
                if (result.profile.keySkills?.length > 0) this._keySkills = result.profile.keySkills;
                this._saveProfile();
            } else {
                this._syncResult = { type: 'error', message: result.error || 'Extraction failed.' };
            }
        } catch (error) {
            this._syncResult = { type: 'error', message: error.message || 'Extraction failed.' };
        }
        this._syncing = false;
        this.requestUpdate();
    }

    renderSkillsTab() {
        // Get all available skills
        const allSkills = [
            {
                id: 'star-answer',
                label: 'STAR Method Answers',
                desc: 'Formats behavioral interview answers using Situation, Task, Action, Result. Uses your stored projects as concrete examples.',
            },
            { id: 'resume-sync', label: 'Resume Sync', desc: 'Lets you paste a resume and auto-fill your profile fields via AI extraction.' },
        ];

        return html`
            <div class="form-grid">
                <div class="form-help" style="margin-bottom:var(--space-sm);">
                    Skills add capabilities and instructions tailored to your current profile. Skills are auto-enabled based on your selected profile
                    and can be toggled individually.
                </div>
                ${allSkills.map(s => {
                    const autoEnabled = s.id === 'star-answer' ? this.selectedProfile === 'interview' : true;
                    const enabled = this._isSkillEnabled(s.id);
                    return html`
                        <div
                            class="skill-row"
                            style="display:flex;align-items:center;gap:var(--space-md);padding:var(--space-sm) 0;border-bottom:1px solid var(--border);"
                        >
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex-shrink:0;">
                                <input
                                    type="checkbox"
                                    ?checked=${enabled}
                                    @change=${e => this._toggleSkill(s.id, e.target.checked)}
                                    style="cursor:pointer;"
                                />
                                <span style="font-size:var(--font-size-sm);color:var(--text-primary);font-weight:500;">${s.label}</span>
                            </label>
                            <span style="font-size:var(--font-size-xs);color:var(--text-muted);flex:1;">${s.desc}</span>
                            ${autoEnabled ? html`<span class="chip">auto</span>` : ''}
                        </div>
                    `;
                })}
                <div class="form-help" style="margin-top:var(--space-sm);">
                    Skills marked "auto" activate automatically for your current profile. Uncheck to disable.
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:var(--space-lg);">
                    <div>
                        <div class="form-label">Prompt skills</div>
                        <div class="form-help">Create reusable instructions that are injected into every AI request while enabled.</div>
                    </div>
                    <button class="btn-secondary" @click=${this._newPromptSkill}>Add skill</button>
                </div>
                ${this._promptSkills.map(
                    skill => html`
                        <div
                            class="skill-row"
                            style="display:flex;gap:var(--space-sm);align-items:center;padding:var(--space-sm) 0;border-bottom:1px solid var(--border);"
                        >
                            <input
                                type="checkbox"
                                ?checked=${skill.enabled}
                                @change=${() => this._togglePromptSkill(skill)}
                                aria-label="Enable ${skill.name}"
                            />
                            <div style="flex:1;min-width:0;">
                                <div style="font-weight:500;color:var(--text-primary);">${skill.name}</div>
                                <div class="form-help">${skill.description || skill.prompt.slice(0, 100)}</div>
                            </div>
                            <button class="btn-secondary" @click=${() => this._editPromptSkill(skill)}>Edit / rename</button>
                            <button class="btn-danger" @click=${() => this._deletePromptSkill(skill)}>Delete</button>
                        </div>
                    `
                )}
                ${this._promptSkills.length === 0 ? html`<div class="form-help" style="margin-top:var(--space-sm);">No custom prompt skills yet.</div>` : ''}
                ${
                    this._editingSkill
                        ? html`
                              <div class="surface" style="margin-top:var(--space-md);padding:var(--space-md);">
                                  <label class="form-group">
                                      <span class="form-label">Skill name</span>
                                      <input
                                          class="control"
                                          maxlength="80"
                                          .value=${this._editingSkill.name}
                                          @input=${e => (this._editingSkill = { ...this._editingSkill, name: e.target.value })}
                                      />
                                  </label>
                                  <label class="form-group">
                                      <span class="form-label">Description</span>
                                      <input
                                          class="control"
                                          maxlength="240"
                                          .value=${this._editingSkill.description}
                                          @input=${e => (this._editingSkill = { ...this._editingSkill, description: e.target.value })}
                                      />
                                  </label>
                                  <label class="form-group vertical" style="min-height:180px;">
                                      <span class="form-label">Prompt instructions</span>
                                      <textarea
                                          class="control"
                                          maxlength="12000"
                                          placeholder="Tell the assistant exactly how to behave..."
                                          .value=${this._editingSkill.prompt}
                                          @input=${e => (this._editingSkill = { ...this._editingSkill, prompt: e.target.value })}
                                      ></textarea>
                                  </label>
                                  ${this._skillError ? html`<div style="color:var(--danger,#ef4444);">${this._skillError}</div>` : ''}
                                  <div class="profile-actions">
                                      <button class="btn-secondary" @click=${this._savePromptSkill}>Save skill</button>
                                      <button class="btn-secondary" @click=${() => (this._editingSkill = null)}>Cancel</button>
                                  </div>
                              </div>
                          `
                        : ''
                }
            </div>
        `;
    }

    _switchTab(tab) {
        this._activeTab = tab;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._saveTimer) clearTimeout(this._saveTimer);
    }

    _getProfileName(profile) {
        const names = {
            interview: 'Job Interview',
            sales: 'Sales Call',
            meeting: 'Business Meeting',
            presentation: 'Presentation',
            negotiation: 'Negotiation',
            exam: 'Exam Assistant',
        };
        return names[profile] || profile;
    }

    renderContextTab() {
        const profiles = [
            { value: 'interview', label: 'Job Interview' },
            { value: 'sales', label: 'Sales Call' },
            { value: 'meeting', label: 'Business Meeting' },
            { value: 'presentation', label: 'Presentation' },
            { value: 'negotiation', label: 'Negotiation' },
            { value: 'exam', label: 'Exam Assistant' },
        ];

        return html`
            <div class="form-grid">
                <div class="form-group">
                    <label class="form-label">Profile</label>
                    <select class="control" .value=${this.selectedProfile} @change=${this._handleProfileChange}>
                        ${profiles.map(profile => html`<option value=${profile.value}>${profile.label}</option>`)}
                    </select>
                </div>
                <div class="form-group vertical">
                    <label class="form-label">Custom Instructions</label>
                    <textarea
                        class="control"
                        placeholder="Resume details, role requirements, constraints..."
                        .value=${this._context}
                        @input=${e => this._saveContext(e.target.value)}
                    ></textarea>
                    <div class="form-help">Sent as context at session start. Keep it short.</div>
                </div>
            </div>
        `;
    }

    renderProfileTab() {
        if (!this._profileLoaded) return html`<div class="form-help">Loading...</div>`;

        const tones = [
            { value: 'professional', label: 'Professional' },
            { value: 'casual', label: 'Casual' },
            { value: 'formal', label: 'Formal' },
        ];

        return html`
            <div class="form-grid">
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Your Name</label>
                        <input
                            class="control"
                            type="text"
                            placeholder="e.g. John Doe"
                            .value=${this._profileName}
                            @input=${e => {
                                this._profileName = e.target.value;
                                this._debounceSave();
                            }}
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Target Role</label>
                        <input
                            class="control"
                            type="text"
                            placeholder="e.g. Senior Software Engineer"
                            .value=${this._targetRole}
                            @input=${e => {
                                this._targetRole = e.target.value;
                                this._debounceSave();
                            }}
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Preferred Tone</label>
                        <select
                            class="control"
                            .value=${this._preferredTone}
                            @change=${e => {
                                this._preferredTone = e.target.value;
                                this._saveProfile();
                            }}
                        >
                            ${tones.map(t => html`<option value=${t.value}>${t.label}</option>`)}
                        </select>
                    </div>
                </div>

                <div class="form-group vertical">
                    <label class="form-label">Experience Summary</label>
                    <textarea
                        class="control"
                        style="min-height: 60px;"
                        placeholder="Brief career summary (2-3 sentences)..."
                        .value=${this._experienceSummary}
                        @input=${e => {
                            this._experienceSummary = e.target.value;
                            this._debounceSave();
                        }}
                    ></textarea>
                </div>

                <div class="form-group">
                    <label class="form-label">Key Skills</label>
                    <div class="tag-input-row">
                        <input
                            class="control"
                            type="text"
                            placeholder="Add a skill..."
                            .value=${this._newSkill || ''}
                            @input=${e => {
                                this._newSkill = e.target.value;
                            }}
                            @keydown=${e => e.key === 'Enter' && this._addSkill()}
                        />
                        <button class="tag-add-btn" @click=${this._addSkill}>+</button>
                    </div>
                    <div class="tag-list">
                        ${(this._keySkills || []).map(
                            (skill, i) => html`
                                <span class="tag">
                                    ${skill}
                                    <span class="tag-remove" @click=${() => this._removeSkill(i)}>&times;</span>
                                </span>
                            `
                        )}
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">Past Projects</label>
                    <div class="tag-input-row">
                        <input
                            class="control"
                            type="text"
                            placeholder="Add a project..."
                            .value=${this._newProject || ''}
                            @input=${e => {
                                this._newProject = e.target.value;
                            }}
                            @keydown=${e => e.key === 'Enter' && this._addProject()}
                        />
                        <button class="tag-add-btn" @click=${this._addProject}>+</button>
                    </div>
                    <div class="tag-list">
                        ${(this._pastProjects || []).map(
                            (proj, i) => html`
                                <span class="tag">
                                    ${proj}
                                    <span class="tag-remove" @click=${() => this._removeProject(i)}>&times;</span>
                                </span>
                            `
                        )}
                    </div>
                </div>

                <div class="form-group vertical">
                    <label class="form-label">Resume Text (optional)</label>
                    <textarea
                        class="control"
                        style="min-height: 80px;"
                        placeholder="Paste your full resume here for the AI to reference..."
                        .value=${this._resumeText}
                        @input=${e => {
                            this._resumeText = e.target.value;
                            this._debounceSave();
                        }}
                    ></textarea>
                    ${
                        this._isSkillEnabled('resume-sync')
                            ? html`
                                  <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                                      <button
                                          class="tag-add-btn"
                                          ?disabled=${this._syncing || !this._resumeText?.trim()}
                                          @click=${this._handleResumeSync}
                                      >
                                          ${this._syncing ? 'Extracting...' : 'Sync from Resume'}
                                      </button>
                                      ${
                                          this._syncResult?.type === 'success'
                                              ? html`<span style="font-size:var(--font-size-xs);color:var(--success, #4caf50);"
                                                    >Profile fields updated. Review above.</span
                                                >`
                                              : ''
                                      }
                                      ${
                                          this._syncResult?.type === 'error'
                                              ? html`<span style="font-size:var(--font-size-xs);color:var(--danger, #ef4444);"
                                                    >${this._syncResult.message}</span
                                                >`
                                              : ''
                                      }
                                  </div>
                              `
                            : ''
                    }
                </div>

                <div class="profile-actions">
                    <button class="btn-danger" @click=${this._deleteProfile}>Clear Profile</button>
                </div>
                <div class="form-help">Saved automatically as you type. Encrypted at rest.</div>
            </div>
        `;
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">
                    <div>
                        <div class="page-title">AI Customization</div>
                    </div>

                    <div class="tabs">
                        <button class="tab ${this._activeTab === 'context' ? 'active' : ''}" @click=${() => this._switchTab('context')}>
                            Context
                        </button>
                        <button class="tab ${this._activeTab === 'profile' ? 'active' : ''}" @click=${() => this._switchTab('profile')}>
                            About Me
                        </button>
                        <button class="tab ${this._activeTab === 'skills' ? 'active' : ''}" @click=${() => this._switchTab('skills')}>Skills</button>
                    </div>

                    <section class="surface">
                        ${this._activeTab === 'context' ? this.renderContextTab() : this._activeTab === 'profile' ? this.renderProfileTab() : this.renderSkillsTab()}
                    </section>
                </div>
            </div>
        `;
    }
}

customElements.define('ai-customize-view', AICustomizeView);

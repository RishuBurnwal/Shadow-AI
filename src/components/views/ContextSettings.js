import { LitElement, html, css } from '../../assets/lit-core-2.7.4.min.js';

class ContextSettings extends LitElement {
    static properties = { prefs: { state: true }, mode: { state: true }, name: { state: true }, message: { state: true } };
    static styles = css`
        :host {
            display: block;
            padding: 18px;
            border: 1px solid var(--border);
            border-radius: 12px;
            margin: 16px 0;
            color: var(--text-primary);
        }
        .row {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin: 12px 0;
            align-items: center;
        }
        label {
            display: flex;
            gap: 8px;
            align-items: center;
            font-size: 13px;
        }
        select,
        input:not([type='checkbox']),
        button {
            padding: 8px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-elevated);
            color: var(--text-primary);
            max-width: 100%;
        }
        p {
            font-size: 12px;
            line-height: 1.6;
            color: var(--text-secondary);
        }
        h3 {
            margin-top: 0;
        }
    `;
    constructor() {
        super();
        this.prefs = {};
        this.mode = 'interview';
        this.name = '';
        this.message = '';
    }
    async firstUpdated() {
        this.prefs = await window.shadowAI.storage.getPreferences();
        this.mode = this.prefs.selectedProfile || 'interview';
    }
    rules() {
        return window.ShadowContextPolicy.resolve(this.prefs, this.mode);
    }
    async save(key, value) {
        await window.shadowAI.storage.updatePreference(key, value);
        this.prefs = await window.shadowAI.storage.getPreferences();
        window.dispatchEvent(new CustomEvent('context-settings-changed'));
    }
    async rule(key, value) {
        const id = this.prefs.activeContextProfiles?.[this.mode];
        if (id)
            await this.save(
                'contextProfiles',
                this.prefs.contextProfiles.map(p => (p.id === id ? { ...p, rules: { ...p.rules, [key]: value } } : p))
            );
        else await this.save('contextRules', { ...this.prefs.contextRules, [this.mode]: { ...this.rules(), [key]: value } });
        this.message = 'Saved. Sending rules apply to the next request. Restart capture to change audio sources.';
    }
    async createProfile() {
        if (!this.name.trim()) return;
        const id = crypto.randomUUID();
        await this.save('contextProfiles', [
            ...(this.prefs.contextProfiles || []),
            { id, name: this.name.trim().slice(0, 80), mode: this.mode, rules: this.rules() },
        ]);
        await this.save('activeContextProfiles', { ...this.prefs.activeContextProfiles, [this.mode]: id });
        this.name = '';
        this.message = 'Context profile saved and selected.';
    }
    render() {
        const policy = this.rules();
        const active = this.prefs.activeContextProfiles?.[this.mode] || '';
        return html`<h3>What to send · Context profiles</h3>
            <p>
                Each mode remembers its own rules and selected profile. Resume includes candidate background. Audio goes to the transcription
                provider; only its transcript goes to the answer provider. Screens are sent only while sharing is active.
            </p>
            <div class="row">
                <label
                    >Mode
                    <select
                        aria-label="Context mode"
                        .value=${this.mode}
                        @change=${async e => {
                            this.mode = e.target.value;
                            await this.save('selectedProfile', this.mode);
                        }}
                    >
                        ${window.ShadowContextPolicy.MODES.map(mode => html`<option value=${mode}>${mode}</option>`)}
                    </select></label
                >
                <label
                    >Saved profile
                    <select
                        aria-label="Saved context profile"
                        .value=${active}
                        @change=${e => this.save('activeContextProfiles', { ...this.prefs.activeContextProfiles, [this.mode]: e.target.value })}
                    >
                        <option value="">Mode settings</option>
                        ${(this.prefs.contextProfiles || []).filter(p => p.mode === this.mode).map(p => html`<option value=${p.id}>${p.name}</option>`)}
                    </select></label
                >
                ${
                    active
                        ? html`<button
                              @click=${async () => {
                                  await this.save(
                                      'contextProfiles',
                                      this.prefs.contextProfiles.filter(p => p.id !== active)
                                  );
                                  await this.save('activeContextProfiles', { ...this.prefs.activeContextProfiles, [this.mode]: '' });
                              }}
                          >
                              Delete profile
                          </button>`
                        : ''
                }
            </div>
            <div class="row">
                ${[
                    ['skills', 'Skills'],
                    ['resume', 'Resume / background'],
                    ['jd', 'JD / role / company'],
                    ['additional', 'Additional context'],
                    ['memory', 'Saved memory'],
                    ['history', 'Recent conversation'],
                    ['audio', 'Audio transcription'],
                ].map(
                    ([key, label]) =>
                        html`<label
                            ><input
                                type="checkbox"
                                aria-label=${label}
                                .checked=${policy[key]}
                                @change=${e => this.rule(key, e.target.checked)}
                            />${label}</label
                        >`
                )}
            </div>
            <div class="row">
                <label
                    >Screen sending
                    <select aria-label="Profile screen sending" .value=${policy.screen} @change=${e => this.rule('screen', e.target.value)}>
                        <option value="off">Off</option>
                        <option value="manual">Manual only</option>
                        <option value="automatic">Automatic while sharing</option>
                    </select></label
                >
                <label
                    ><input type="checkbox" .checked=${policy.attachScreen} @change=${e => this.rule('attachScreen', e.target.checked)} />Attach
                    recent screen to voice/text answers</label
                >
            </div>
            <details>
                <summary>Skills for this profile</summary>
                <p>Unchecked “choose specific skills” uses globally enabled skills. Mode instructions always apply.</p>
                <label
                    ><input
                        type="checkbox"
                        .checked=${Array.isArray(policy.skillIds)}
                        @change=${e => this.rule('skillIds', e.target.checked ? [] : null)}
                    />Choose specific skills</label
                >
                ${Array.isArray(policy.skillIds) ? [{ id: 'star-answer', name: 'STAR answer' }, ...(this.prefs.promptSkills || [])].map(skill => html`<label><input type="checkbox" .checked=${policy.skillIds.includes(skill.id)} @change=${e => this.rule('skillIds', e.target.checked ? [...policy.skillIds, skill.id] : policy.skillIds.filter(id => id !== skill.id))} />${skill.name}</label>`) : ''}
            </details>
            <div class="row">
                <input
                    aria-label="New context profile name"
                    placeholder="Profile name, e.g. Frontend interview"
                    .value=${this.name}
                    @input=${e => (this.name = e.target.value)}
                /><button @click=${() => this.createProfile()}>Save as profile</button>
                <button
                    @click=${async () => {
                        await this.save('activeContextProfiles', { ...this.prefs.activeContextProfiles, [this.mode]: '' });
                        await this.save('contextRules', { ...this.prefs.contextRules, [this.mode]: window.ShadowContextPolicy.defaults(this.mode) });
                    }}
                >
                    Restore mode defaults
                </button>
            </div>
            <h3>Voice transcription</h3>
            <label
                >Provider
                <select
                    aria-label="Transcription provider"
                    .value=${this.prefs.transcriptionProvider || 'auto'}
                    @change=${e => this.save('transcriptionProvider', e.target.value)}
                >
                    <option value="auto">Auto · supported providers with key fallback</option>
                    <option value="gemini-live">Gemini Live</option>
                    <option value="groq">Groq Whisper</option>
                    <option value="openai">OpenAI Transcribe</option>
                    <option value="gemini">Gemini audio</option>
                    <option value="nvidia">NVIDIA Parakeet · English</option>
                </select></label
            >
            <p>
                Restart the session after changing transcription provider. Perplexity answers transcribed text; its configured chat API has no native
                transcription endpoint.
            </p>
            <p role="status">${this.message}</p>`;
    }
}
customElements.define('context-settings', ContextSettings);

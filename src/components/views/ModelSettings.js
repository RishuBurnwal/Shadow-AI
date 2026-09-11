import { LitElement, html, css } from '../../assets/lit-core-2.7.4.min.js';

export class ModelSettings extends LitElement {
    static properties = {
        status: { state: true },
        provider: { state: true },
        candidate: { state: true },
        query: { state: true },
        busy: { state: true },
        message: { state: true },
    };
    static styles = css`
        :host {
            display: block;
            margin: 16px 0;
            padding: 18px;
            border: 1px solid var(--border);
            border-radius: 12px;
            color: var(--text-primary);
        }
        h3 {
            margin: 0 0 8px;
        }
        p {
            color: var(--text-secondary);
            font-size: 12px;
            line-height: 1.6;
        }
        .row {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            align-items: center;
            margin: 10px 0;
        }
        select,
        input {
            flex: 1;
            min-width: 150px;
            max-width: 100%;
            padding: 9px;
            color: var(--text-primary);
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 6px;
        }
        button {
            padding: 8px 12px;
            cursor: pointer;
            color: var(--text-primary);
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 6px;
        }
        button:disabled {
            opacity: 0.5;
            cursor: default;
        }
        .model {
            flex: 1;
            overflow-wrap: anywhere;
            min-width: 120px;
        }
        [role='status'] {
            overflow-wrap: anywhere;
            font-size: 12px;
        }
    `;
    constructor() {
        super();
        this.status = { providers: {} };
        this.provider = '';
        this.candidate = '';
        this.query = '';
        this.busy = false;
        this.message = '';
    }
    async firstUpdated() {
        await this.refresh();
    }
    async refresh(force = false) {
        try {
            this.status = await window.shadowAI.getProviderStatus(force);
            if (!this.provider)
                this.provider = this.status.providerIds?.find(id => this.status.providers[id]?.configured) || this.status.providerIds?.[0] || '';
        } catch (error) {
            this.message = error.message;
        }
    }
    async changeModel(model, action) {
        if (this.busy) return;
        this.busy = true;
        this.message = action === 'add' ? 'Testing model access...' : 'Removing model...';
        try {
            const result = await window.electronAPI.ipcRenderer.invoke('update-enabled-model', this.provider, model, action);
            if (!result.success) throw new Error(result.error);
            this.message = action === 'add' ? 'Model tested and added.' : 'Model removed from the answer picker.';
            await this.refresh();
            window.dispatchEvent(new CustomEvent('provider-models-changed'));
        } catch (error) {
            this.message = error.message;
        } finally {
            this.busy = false;
        }
    }
    render() {
        const state = this.status.providers?.[this.provider] || {};
        const models = state.models || [];
        const catalog = (state.catalog || []).filter(model => model.toLowerCase().includes(this.query.toLowerCase()));
        const unsupported = state.unsupportedModels || [];
        return html`<h3>Answer models</h3>
            <p>
                The header shows your added models. Browse the provider catalog below to add more. Adding a model makes one small test request to
                verify your account can use it.
            </p>
            <div class="row">
                <select
                    aria-label="Model provider"
                    .value=${this.provider}
                    @change=${event => {
                        this.provider = event.target.value;
                        this.candidate = '';
                        this.message = '';
                    }}
                >
                    ${(this.status.providerIds || []).map(id => html`<option value=${id}>${this.status.providerLabels?.[id] || id}</option>`)}</select
                ><button @click=${() => this.refresh(true)} ?disabled=${this.busy}>Refresh catalog</button>
            </div>
            ${!state.configured ? html`<p>Add this provider's API key on the main page first.</p>` : ''}
            <h4>Added models</h4>
            ${models.map(model => html`<div class="row"><span class="model">${model}${state.selectedModel === model ? ' (selected)' : ''}</span><button aria-label=${`Remove ${model}`} ?disabled=${this.busy} @click=${() => this.changeModel(model, 'remove')}>Remove</button></div>`)}
            ${models.length ? '' : html`<p>No models added. This provider is excluded from answers until you add one.</p>`}
            <h4>Provider catalog</h4>
            <div class="row">
                <input
                    aria-label="Search model catalog"
                    placeholder="Search models..."
                    .value=${this.query}
                    @input=${event => {
                        this.query = event.target.value;
                    }}
                />
            </div>
            <div class="row">
                <select
                    aria-label="Available model catalog"
                    .value=${this.candidate}
                    @change=${event => {
                        this.candidate = event.target.value;
                    }}
                >
                    <option value="">Choose a model to add</option>
                    ${catalog.map(model => html`<option value=${model} ?disabled=${unsupported.includes(model) || models.includes(model)}>${model}${unsupported.includes(model) ? ' — not a chat model' : models.includes(model) ? ' — added' : ''}</option>`)}</select
                ><button
                    ?disabled=${this.busy || !state.configured || !this.candidate || unsupported.includes(this.candidate) || models.includes(this.candidate)}
                    @click=${() => this.changeModel(this.candidate, 'add')}
                >
                    Test & add
                </button>
            </div>
            <p role="status">${this.message}</p>`;
    }
}
customElements.define('model-settings', ModelSettings);

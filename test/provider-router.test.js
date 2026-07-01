const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('auto provider priority matches the launcher contract', () => {
    const { getConfiguredProviders } = require('../src/utils/providerRouter');
    const providers = getConfiguredProviders({
        GROQ_API_KEY: 'groq-secret',
        OPENROUTER_API_KEY: 'router-secret',
        OPENAI_API_KEY: 'openai-secret',
        PERPLEXITY_API_KEY: 'perplexity-secret',
        NVIDIA_API_KEY: 'nvidia-secret',
        GEMINI_API_KEY: 'gemini-secret',
    });

    assert.deepEqual(
        providers.map(provider => provider.id),
        ['groq', 'openrouter', 'openai', 'perplexity', 'nvidia', 'gemma']
    );
});

test('provider fallback continues after a failed upstream without leaking keys', async () => {
    const { streamWithFallback } = require('../src/utils/providerRouter');
    const seen = [];
    const events = [];
    const fetchImpl = async (url, options) => {
        seen.push({ url, authorization: options.headers.Authorization });
        if (url.includes('openrouter')) return new Response('denied', { status: 401 });
        return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
        });
    };

    const result = await streamWithFallback({
        providers: [
            { id: 'openrouter', apiKey: 'first-secret', baseUrl: 'https://openrouter.test', model: 'test' },
            { id: 'openai', apiKey: 'second-secret', baseUrl: 'https://openai.test', model: 'test' },
        ],
        messages: [{ role: 'user', content: 'hello' }],
        fetchImpl,
        onToken: token => events.push(token),
    });

    assert.equal(result.provider, 'openai');
    assert.equal(result.text, 'hello');
    assert.deepEqual(events, ['hello']);
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal(seen.length, 2);
});

test('explicit unavailable providers are excluded and total failure is reported safely', async () => {
    const { getConfiguredProviders, streamWithFallback } = require('../src/utils/providerRouter');
    const providers = getConfiguredProviders({ SHADOW_AI_PROVIDER: 'nvidia', OPENAI_API_KEY: 'not-selected' });
    assert.deepEqual(
        providers.map(provider => provider.id),
        ['openai']
    );

    await assert.rejects(
        streamWithFallback({ providers: [], messages: [{ role: 'user', content: 'hello' }] }),
        error => error.message === 'All configured answer providers failed' && Array.isArray(error.failures)
    );
});

test('explicit provider is attempted first while every configured provider remains a fallback', () => {
    const { getConfiguredProviders } = require('../src/utils/providerRouter');
    const providers = getConfiguredProviders({
        SHADOW_AI_PROVIDER: 'nvidia',
        NVIDIA_API_KEY: 'nvidia-secret',
        GROQ_API_KEY: 'groq-secret',
        OPENAI_API_KEY: 'openai-secret',
    });

    assert.deepEqual(
        providers.map(provider => provider.id),
        ['nvidia', 'groq', 'openai']
    );
});

test('fallback emits provider-safe failure and selection notifications', async () => {
    const { streamWithFallback } = require('../src/utils/providerRouter');
    const notifications = [];
    const providers = [
        { id: 'groq', apiKey: 'secret-one', baseUrl: 'https://groq.test', model: 'test' },
        { id: 'openai', apiKey: 'secret-two', baseUrl: 'https://openai.test', model: 'test' },
    ];
    const fetchImpl = async url => {
        if (url.includes('groq')) return new Response('', { status: 429 });
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    };

    await streamWithFallback({
        providers,
        messages: [{ role: 'user', content: 'hello' }],
        fetchImpl,
        onProviderFailure: event => notifications.push(event),
        onProviderSelected: event => notifications.push(event),
    });

    assert.deepEqual(notifications, [
        { provider: 'groq', nextProvider: 'openai', reason: 'HTTP 429' },
        { provider: 'openai', model: 'test' },
    ]);
    assert.equal(JSON.stringify(notifications).includes('secret'), false);
});

test('launcher and environment templates exist without committing .env', () => {
    assert.equal(fs.existsSync(path.join(root, 'main.py')), true);
    assert.equal(fs.existsSync(path.join(root, '.env.example')), true);
    assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\.env$/m);
    assert.match(fs.readFileSync(path.join(root, 'main.py'), 'utf8'), /--provider/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'main.py'), 'utf8'), /add_argument\(["']provider["']/);
    assert.match(fs.readFileSync(path.join(root, 'src/components/app/ShadowAIApp.js'), 'utf8'), /provider-notification/);
});

test('main launcher exposes a numbered menu and complete idempotent setup workflow', () => {
    const launcher = fs.readFileSync(path.join(root, 'main.py'), 'utf8');
    assert.match(launcher, /def interactive_menu\(\)/);
    assert.match(launcher, /Complete installation and setup/);
    assert.match(launcher, /3\. Run project/);
    assert.doesNotMatch(launcher, /Run project tests/);
    assert.match(launcher, /5\. Update project from GitHub/);
    assert.match(launcher, /Select API provider and launch/);
    assert.match(launcher, /Show API provider status/);
    assert.match(launcher, /if len\(sys\.argv\) == 1/);
    assert.match(launcher, /ensure_env_file/);
    assert.match(launcher, /subprocess\.run\(\[npm, ["']install["']\]/);
    assert.match(launcher, /subprocess\.run\(\[npm, ["']test["']\]/);
    assert.match(launcher, /subprocess\.run\(\[npm, ["']run["'], ["']package["']\]/);
    assert.match(launcher, /if env_path\.exists\(\):\s+return ["']preserved["']/);
    assert.match(launcher, /git_output\(\[["']rev-parse["'], ["']HEAD["']\]\)/);
    assert.match(launcher, /subprocess\.run\(\[git, ["']merge["'], ["']--ff-only["']/);
    assert.match(launcher, /UPDATE_REPOSITORY = ["']https:\/\/github\.com\/RishuBurnwal\/Shadow-AI\.git["']/);
});

test('BYOK UI exposes Add API controls for every fallback provider', () => {
    const mainView = fs.readFileSync(path.join(root, 'src/components/views/MainView.js'), 'utf8');
    const gemini = fs.readFileSync(path.join(root, 'src/utils/gemini.js'), 'utf8');

    assert.match(mainView, /'\+ Add API'/);
    for (const provider of ['OpenRouter', 'OpenAI', 'Perplexity', 'NVIDIA']) {
        assert.match(mainView, new RegExp(`name: '${provider}'`));
    }
    assert.match(mainView, /provider\.name} API Key/);
    for (const credential of ['openrouterApiKey', 'openaiApiKey', 'perplexityApiKey', 'nvidiaApiKey']) {
        assert.match(gemini, new RegExp(credential));
    }
});

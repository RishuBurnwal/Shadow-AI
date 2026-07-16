const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('passthrough remains enabled while temporarily restoring header interaction', () => {
    const { createPassthroughController } = require('../src/utils/passthrough');
    const calls = [];
    const window = {
        isDestroyed: () => false,
        setIgnoreMouseEvents: (...args) => calls.push(args),
        webContents: { send: () => {} },
    };
    const controller = createPassthroughController(window);

    controller.setEnabled(true);
    controller.setHeaderInteractive(true);
    controller.setHeaderInteractive(false);

    assert.equal(controller.isEnabled(), true);
    assert.deepEqual(calls, [[true, { forward: true }], [false], [true, { forward: true }]]);
});

test('persistent header owns the shared background transparency and passthrough controls', () => {
    const appSource = fs.readFileSync(path.join(root, 'src/components/app/ShadowAIApp.js'), 'utf8');
    const indexSource = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(root, 'src/utils/renderer.js'), 'utf8');
    const storageSource = fs.readFileSync(path.join(root, 'src/storage.js'), 'utf8');

    assert.match(appSource, /class="top-drag-bar"/);
    assert.match(appSource, /--header-solid-background/);
    assert.match(appSource, /backgroundTransparency/);
    assert.match(appSource, />\s*Passthrough\s*</);
    assert.doesNotMatch(appSource, /top-drag-bar[^\n]*hidden/);
    assert.match(appSource, /aria-label="AI provider selection"/);
    assert.match(appSource, /Auto — fallback enabled/);
    assert.match(appSource, /Default \(\$\{this\._providerStatus\.effective/);
    assert.match(appSource, /\?disabled=\$\{!status\?\.configured\}/);
    assert.match(indexSource, /set-provider-selection/);
    assert.match(rendererSource, /setProviderSelection/);
    assert.match(storageSource, /answerProvider: 'default'/);
    assert.match(storageSource, /providerModels: \{\}/);
    assert.match(appSource, /aria-label="AI model selection"/);
    assert.match(indexSource, /set-provider-model/);
    assert.match(rendererSource, /setProviderModel/);
    assert.match(appSource, /@focus=\$\{\(\) => this\.loadProviderStatus\(true\)\}/);
});

test('header AI text opacity controls only the rendered response content', () => {
    const appSource = fs.readFileSync(path.join(root, 'src/components/app/ShadowAIApp.js'), 'utf8');
    const assistantSource = fs.readFileSync(path.join(root, 'src/components/views/AssistantView.js'), 'utf8');
    const storageSource = fs.readFileSync(path.join(root, 'src/storage.js'), 'utf8');

    assert.match(appSource, /AI Text \$\{Math\.round\(this\.responseTextOpacity \* 100\)\}%/);
    assert.match(appSource, /handleResponseTextOpacityChange/);
    assert.match(appSource, /\.responseTextOpacity=\$\{this\.responseTextOpacity\}/);
    assert.equal((appSource.match(/type="range"/g) || []).length, 2);
    assert.match(assistantSource, /class="response-text-content"/);
    assert.match(assistantSource, /--ai-response-text-opacity/);
    assert.match(storageSource, /responseTextOpacity: 1/);
});

test('header AI color picker controls only rendered response text and persists', () => {
    const appSource = fs.readFileSync(path.join(root, 'src/components/app/ShadowAIApp.js'), 'utf8');
    const assistantSource = fs.readFileSync(path.join(root, 'src/components/views/AssistantView.js'), 'utf8');
    const storageSource = fs.readFileSync(path.join(root, 'src/storage.js'), 'utf8');

    assert.match(appSource, /type="color"/);
    assert.match(appSource, /class="header-color-picker"/);
    assert.match(appSource, /class="header-color-swatch"/);
    assert.match(appSource, /aria-label="Choose AI response text color"/);
    assert.ok(appSource.indexOf('class="header-color-picker"') < appSource.indexOf('Controls only AI response text opacity'));
    assert.match(appSource, /handleResponseTextColorChange/);
    assert.match(appSource, /\.responseTextColor=\$\{this\.responseTextColor\}/);
    assert.match(assistantSource, /--ai-response-text-color/);
    assert.match(assistantSource, /\.response-text-content \*/);
    assert.match(storageSource, /responseTextColor: '#f5f5f5'/);
});

test('AI markdown is sanitized before it reaches innerHTML', () => {
    const assistantSource = fs.readFileSync(path.join(root, 'src/components/views/AssistantView.js'), 'utf8');

    assert.match(assistantSource, /this\.sanitizeHtml\(window\.marked\.parse\(content\)\)/);
    assert.match(assistantSource, /script, iframe, object, embed/);
    assert.match(assistantSource, /name\.startsWith\('on'\)/);
    assert.match(assistantSource, /name === 'href' \|\| name === 'src'/);
    assert.doesNotMatch(assistantSource, /sanitize:\s*false/);
});

test('renderer uses an isolated allow-listed preload bridge', () => {
    const windowSource = fs.readFileSync(path.join(root, 'src/utils/window.js'), 'utf8');
    const preloadSource = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');
    const rendererFiles = [
        path.join(root, 'src/utils/renderer.js'),
        ...fs.readdirSync(path.join(root, 'src/components/app')).map(file => path.join(root, 'src/components/app', file)),
        ...fs.readdirSync(path.join(root, 'src/components/views')).map(file => path.join(root, 'src/components/views', file)),
    ];

    assert.match(windowSource, /nodeIntegration:\s*false/);
    assert.match(windowSource, /contextIsolation:\s*true/);
    assert.match(windowSource, /sandbox:\s*true/);
    assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('electronAPI'/);
    assert.match(preloadSource, /IPC channel not allowed/);
    assert.doesNotMatch(windowSource, /executeJavaScript/);
    for (const file of rendererFiles) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /(?:window\.)?require\(['"]electron['"]\)/, path.relative(root, file));
    }
});

test('renderer CSP and external links reject executable URL schemes', () => {
    const htmlSource = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
    const indexSource = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');

    assert.match(htmlSource, /default-src 'self'/);
    assert.doesNotMatch(htmlSource, /script-src[^;]*'unsafe-inline'/);
    assert.match(indexSource, /parsed\.protocol !== 'https:'/);
});

test('Gemini Live remains transcription-only and streams each incoming audio chunk', () => {
    const source = fs.readFileSync(path.join(root, 'src/utils/gemini.js'), 'utf8');

    assert.doesNotMatch(source, /responseModalities\s*:\s*\[[^\]]*AUDIO/);
    assert.match(source, /inputAudioTranscription\s*:/);
    assert.match(source, /sendRealtimeInput\(\{\s*audio:/);
    assert.doesNotMatch(source, /pendingAudioChunks|audioBatch/);
});

test('production credential storage never falls back to plaintext', () => {
    const source = fs.readFileSync(path.join(root, 'src/storage.js'), 'utf8');

    assert.match(source, /if \(process\.versions\.electron\)/);
    assert.match(source, /Secure credential storage is unavailable/);
});

test('Whisper downloads are pinned to immutable model revisions', () => {
    const source = fs.readFileSync(path.join(root, 'src/utils/localai.js'), 'utf8');

    assert.match(source, /WHISPER_REVISIONS/);
    assert.match(source, /revision,/);
    assert.match(source, /has no pinned revision/);
});

test('speech-end transcription never waits for a rolling Whisper pass', () => {
    const source = fs.readFileSync(path.join(root, 'src/utils/localai.js'), 'utf8');
    const handler = source.slice(source.indexOf('async function handleSpeechEnd'), source.indexOf('// â”€â”€ Ollama Chat'));

    assert.doesNotMatch(handler, /Waiting for in-flight|setInterval/);
    assert.match(handler, /const transcription = await transcribeAudio\(audioData\)/);
});

test('history exposes confirmed bulk deletion and feedback feature is absent', () => {
    const appSource = fs.readFileSync(path.join(root, 'src/components/app/ShadowAIApp.js'), 'utf8');
    const historySource = fs.readFileSync(path.join(root, 'src/components/views/HistoryView.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(root, 'src/utils/renderer.js'), 'utf8');

    assert.match(historySource, /'Clear History'/);
    assert.match(historySource, /window\.confirm/);
    assert.match(historySource, /shadowAI\.storage\.deleteAllSessions\(\)/);
    assert.match(rendererSource, /storage:delete-all-sessions/);
    assert.doesNotMatch(appSource, /feedback/i);
    assert.equal(fs.existsSync(path.join(root, 'src/components/views/FeedbackView.js')), false);
});

test('every launch opens directly on the job context onboarding page', () => {
    const appSource = fs.readFileSync(path.join(root, 'src/components/app/ShadowAIApp.js'), 'utf8');
    const onboardingSource = fs.readFileSync(path.join(root, 'src/components/views/OnboardingView.js'), 'utf8');

    assert.match(appSource, /this\.currentView = 'onboarding'/);
    assert.doesNotMatch(appSource, /config\.onboarded \? 'main' : 'onboarding'/);
    assert.match(onboardingSource, /this\.currentSlide = 1/);
    assert.match(onboardingSource, /placeholder="Resume, job description, notes\.\.\."/);
    assert.match(onboardingSource, /placeholder="Session name/);
    assert.match(onboardingSource, /placeholder="Session note/);
    assert.match(onboardingSource, /updatePreference\('sessionName'/);
    assert.match(onboardingSource, /updatePreference\('sessionNote'/);
});

test('session metadata is persisted and history supports edit and individual delete', () => {
    const storageSource = fs.readFileSync(path.join(root, 'src/storage.js'), 'utf8');
    const geminiSource = fs.readFileSync(path.join(root, 'src/utils/gemini.js'), 'utf8');
    const historySource = fs.readFileSync(path.join(root, 'src/components/views/HistoryView.js'), 'utf8');

    assert.match(storageSource, /sessionName/);
    assert.match(storageSource, /sessionNote/);
    assert.match(storageSource, /Invalid session ID/);
    assert.match(geminiSource, /sessionName: preferences\.sessionName/);
    assert.match(geminiSource, /sessionNote: preferences\.sessionNote/);
    assert.match(historySource, /Edit details/);
    assert.match(historySource, /Save changes/);
    assert.match(historySource, /Delete session/);
    assert.match(historySource, /shadowAI\.storage\.deleteSession\(sessionId\)/);
});

test('maintained project files contain no legacy product references', () => {
    const legacy = new RegExp(['cheating', 'daddy'].join('[-_\\s]?'), 'i');
    const ignored = new Set([
        '.git',
        'node_modules',
        'graphify-out',
        'test',
        '01_AUDIT_REPORT.md',
        '02_FIXING_PLAN_AND_PROMPT.md',
        '03_ENHANCEMENTS_AND_ROADMAP.md',
    ]);
    const matches = [];

    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (ignored.has(entry.name)) continue;
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
                continue;
            }
            if (!/\.(?:js|json|md|html|py|yml|yaml|txt)$/.test(entry.name)) continue;
            const content = fs.readFileSync(fullPath, 'utf8');
            if (legacy.test(content) || legacy.test(entry.name)) {
                matches.push(path.relative(root, fullPath));
            }
        }
    }

    visit(root);
    assert.deepEqual(matches, []);
});

test('speech language preferences reject auto and invalid values', () => {
    const { normalizeLanguageCode } = require('../src/storage');

    assert.equal(normalizeLanguageCode('auto'), 'en-US');
    assert.equal(normalizeLanguageCode('   '), 'en-US');
    assert.equal(normalizeLanguageCode('hi-IN'), 'hi-IN');
    assert.equal(normalizeLanguageCode('zzzzz'), 'en-US');
});

test('local VAD silence timeout is persisted and exposed in Settings', () => {
    const storageSource = fs.readFileSync(path.join(root, 'src/storage.js'), 'utf8');
    const settingsSource = fs.readFileSync(path.join(root, 'src/components/views/CustomizeView.js'), 'utf8');
    const indexSource = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');

    assert.match(storageSource, /vadSilenceMs:\s*500/);
    assert.match(settingsSource, /min="300"/);
    assert.match(settingsSource, /max="1200"/);
    assert.match(settingsSource, /updatePreference\('vadSilenceMs'/);
    assert.match(indexSource, /setVadSilenceMs\(value\)/);
});

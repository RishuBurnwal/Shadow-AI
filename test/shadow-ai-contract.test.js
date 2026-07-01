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

    assert.match(appSource, /class="top-drag-bar"/);
    assert.match(appSource, /--header-solid-background/);
    assert.match(appSource, /backgroundTransparency/);
    assert.match(appSource, />\s*Passthrough\s*</);
    assert.doesNotMatch(appSource, /top-drag-bar[^\n]*hidden/);
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
    const ignored = new Set(['.git', 'node_modules', 'graphify-out', 'test']);
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

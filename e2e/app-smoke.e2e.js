/**
 * Shadow AI — E2E tests using Playwright + Electron.
 * Single beforeAll launch for all tests. State reset between tests is
 * done via IPC (navigate back, reset storage) rather than relaunching.
 *
 * Run with: npx playwright test
 * or:        npm run test:e2e
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const CONFIG_DIR = path.join(__dirname, '..', '.test-config');

test.describe('Shadow AI', () => {
    let app;
    let win;

    test.beforeAll(async () => {
        if (fs.existsSync(CONFIG_DIR)) fs.rmSync(CONFIG_DIR, { recursive: true, force: true });

        app = await electron.launch({
            args: ['.'],
            ...(process.env.ELECTRON_EXECUTABLE_PATH ? { executablePath: process.env.ELECTRON_EXECUTABLE_PATH } : {}),
            env: {
                ...process.env,
                NODE_ENV: 'test',
                SHADOW_AI_SILENT: 'true',
                SHADOW_AI_CONFIG_DIR: CONFIG_DIR,
                GEMINI_API_KEY: '',
                GROQ_API_KEY: '',
                OPENROUTER_API_KEY: '',
                OPENAI_API_KEY: '',
                PERPLEXITY_API_KEY: '',
                NVIDIA_API_KEY: '',
            },
        });

        win = await app.firstWindow();
        await app.evaluate(async ({ session }) => {
            session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
        });
        await win.waitForLoadState('domcontentloaded');
        // Wait for the custom element to be defined and upgraded
        await win.evaluate(() => customElements.whenDefined('shadow-ai-app'));
    });

    test.afterAll(async () => {
        if (fs.existsSync(CONFIG_DIR)) fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
        if (app) await app.close();
    });

    async function goHome() {
        await win.evaluate(() => document.querySelector('shadow-ai-app')?.navigate?.('main'));
        await win.waitForTimeout(200);
    }

    // ── App smoke tests ──

    test('window title is correct', async () => {
        expect(await win.title()).toBe('Screen and Audio Capture');
    });

    test('shadow-ai-app element exists in DOM', async () => {
        await expect(win.locator('shadow-ai-app')).toHaveCount(1, { timeout: 10000 });
    });

    test('shadowAI global API is exposed', async () => {
        expect(await win.evaluate(() => typeof window.shadowAI)).toBe('object');
        expect(await win.evaluate(() => typeof window.shadowAI.storage)).toBe('object');
        expect(await win.evaluate(() => typeof window.shadowAI.getProviderStatus)).toBe('function');
    });

    test('app starts on onboarding view', async () => {
        expect(await win.evaluate(() => document.querySelector('shadow-ai-app')?.currentView)).toBe('onboarding');
    });

    test('onboarding view renders in shadow DOM', async () => {
        await win.waitForFunction(() => !!document.querySelector('shadow-ai-app')?.shadowRoot?.querySelector('onboarding-view'));
        const has = await win.evaluate(() => !!document.querySelector('shadow-ai-app')?.shadowRoot?.querySelector('onboarding-view'));
        expect(has).toBe(true);
    });

    test('top drag bar with traffic lights exist', async () => {
        await win.evaluate(() => document.querySelector('shadow-ai-app')?.handleOnboardingComplete?.());
        await win.waitForTimeout(200);
        const hasBar = await win.evaluate(() => !!document.querySelector('shadow-ai-app')?.shadowRoot?.querySelector('.top-drag-bar'));
        expect(hasBar).toBe(true);

        const hasLights = await win.evaluate(
            () => document.querySelector('shadow-ai-app')?.shadowRoot?.querySelectorAll('.traffic-light').length === 3
        );
        expect(hasLights).toBe(true);
    });

    test('sidebar appears with nav items after onboarding', async () => {
        await win.evaluate(() => document.querySelector('shadow-ai-app')?.handleOnboardingComplete?.());
        await win.waitForTimeout(500);

        const items = await win.evaluate(() => {
            const el = document.querySelector('shadow-ai-app');
            if (!el?.shadowRoot) return [];
            return Array.from(el.shadowRoot.querySelectorAll('.nav-item')).map(x => x.textContent.trim());
        });
        expect(items.length).toBeGreaterThanOrEqual(5);
        expect(items).toContain('Home');
        expect(items).toContain('History');
        expect(items).toContain('Memory');
    });

    // ── Navigation tests ──

    test('navigates to all sidebar views', async () => {
        const views = ['main', 'ai-customize', 'history', 'memory', 'customize', 'help'];
        for (const id of views) {
            await win.evaluate(v => document.querySelector('shadow-ai-app')?.navigate?.(v), id);
            await win.waitForTimeout(300);
            expect(await win.evaluate(() => document.querySelector('shadow-ai-app')?.currentView)).toBe(id);
        }
        await goHome();
    });

    test('settings view shows Privacy section', async () => {
        await win.evaluate(() => document.querySelector('shadow-ai-app')?.navigate?.('customize'));
        await win.waitForTimeout(500);

        const text = await win.evaluate(() => {
            const el = document.querySelector('shadow-ai-app');
            return el?.shadowRoot?.querySelector('customize-view')?.shadowRoot?.textContent || '';
        });
        expect(text).toMatch(/[Pp]rivacy/);
        await goHome();
    });

    test('complete-question delay defaults to 1.5 seconds and persists in milliseconds', async () => {
        await win.evaluate(() => document.querySelector('shadow-ai-app')?.navigate?.('customize'));
        await win.waitForTimeout(500);
        const initial = await win.evaluate(() => {
            const view = document.querySelector('shadow-ai-app')?.shadowRoot?.querySelector('customize-view');
            return { text: view?.shadowRoot?.textContent || '', value: view?.responseDelayMs };
        });
        expect(initial.text).toContain('Wait before generating answer');
        expect(initial.value).toBe(1500);
        await win.evaluate(async () => window.shadowAI.storage.updatePreference('responseDelayMs', 2300));
        expect((await win.evaluate(async () => window.shadowAI.storage.getPreferences())).responseDelayMs).toBe(2300);
        await goHome();
    });

    test('memory view renders', async () => {
        await win.evaluate(() => document.querySelector('shadow-ai-app')?.navigate?.('memory'));
        await win.waitForTimeout(700);

        const text = await win.evaluate(() => {
            const el = document.querySelector('shadow-ai-app');
            return el?.shadowRoot?.querySelector('memory-view')?.shadowRoot?.textContent || '';
        });
        expect(text.length).toBeGreaterThan(0);
        await goHome();
    });

    // ── IPC / Storage tests ──

    test('getPreferences returns defaults', async () => {
        const prefs = await win.evaluate(async () => await window.shadowAI.storage.getPreferences());
        expect(prefs).toHaveProperty('selectedProfile', 'interview');
        expect(prefs).toHaveProperty('selectedLanguage', 'en-US');
        expect(prefs).toHaveProperty('providerMode', 'byok');
        expect(prefs).toHaveProperty('privacyMode', false);
    });

    test('updatePreference round-trips', async () => {
        await win.evaluate(async () => await window.shadowAI.storage.updatePreference('selectedLanguage', 'fr-FR'));
        const prefs = await win.evaluate(async () => await window.shadowAI.storage.getPreferences());
        expect(prefs.selectedLanguage).toBe('fr-FR');
    });

    test('getConfig returns defaults', async () => {
        const c = await win.evaluate(async () => await window.shadowAI.storage.getConfig());
        expect(c).toHaveProperty('onboarded', false);
        expect(c).toHaveProperty('layout', 'normal');
    });

    test('setConfig round-trips', async () => {
        await win.evaluate(async () => await window.shadowAI.storage.setConfig({ layout: 'compact' }));
        const c = await win.evaluate(async () => await window.shadowAI.storage.getConfig());
        expect(c.layout).toBe('compact');
    });

    test('profile set/get round-trips', async () => {
        const p = { name: 'Test', targetRole: 'Engineer', preferredTone: 'professional' };
        await win.evaluate(async profile => await window.shadowAI.storage.setProfile(profile), p);
        const r = await win.evaluate(async () => await window.shadowAI.storage.getProfile());
        expect(r.name).toBe('Test');
        expect(r.targetRole).toBe('Engineer');
    });

    test('getMemory returns empty store', async () => {
        const m = await win.evaluate(async () => await window.shadowAI.storage.getMemory());
        expect(Array.isArray(m.facts)).toBe(true);
        expect(m.facts.length).toBe(0);
    });

    test('getProviderStatus returns provider ids', async () => {
        const s = await win.evaluate(async () => await window.shadowAI.getProviderStatus(false));
        expect(Array.isArray(s.providerIds)).toBe(true);
        expect(s.providerIds.length).toBeGreaterThanOrEqual(6);
        expect(s.providerIds).toContain('groq');
        expect(s.providerIds).toContain('gemini');
    });

    test('getVersion returns semver', async () => {
        const v = await win.evaluate(async () => await window.shadowAI.getVersion());
        expect(v).toMatch(/^\d+\.\d+\.\d+/);
    });

    test('theme load returns dark by default', async () => {
        const name = await win.evaluate(async () => await window.shadowAI.theme.load());
        expect(name).toBe('dark');
    });

    test('prompt skills can be added, renamed, toggled and deleted through IPC', async () => {
        const created = await win.evaluate(async () =>
            window.shadowAI.storage.createPromptSkill({ name: 'Brief', description: 'Short replies', prompt: 'Answer in one sentence.' })
        );
        expect(created.success).toBe(true);

        let skills = await win.evaluate(async () => window.shadowAI.storage.getPromptSkills());
        expect(skills).toHaveLength(1);
        const id = skills[0].id;

        const updated = await win.evaluate(
            async skillId => window.shadowAI.storage.updatePromptSkill(skillId, { name: 'Very brief', enabled: false }),
            id
        );
        expect(updated.success).toBe(true);
        skills = await win.evaluate(async () => window.shadowAI.storage.getPromptSkills());
        expect(skills[0]).toMatchObject({ id, name: 'Very brief', enabled: false });

        const removed = await win.evaluate(async skillId => window.shadowAI.storage.deletePromptSkill(skillId), id);
        expect(removed.success).toBe(true);
        expect(await win.evaluate(async () => window.shadowAI.storage.getPromptSkills())).toEqual([]);
    });

    test('navigate changes currentView', async () => {
        await win.evaluate(() => document.querySelector('shadow-ai-app')?.navigate?.('help'));
        await win.waitForTimeout(300);
        expect(await win.evaluate(() => document.querySelector('shadow-ai-app')?.currentView)).toBe('help');

        await win.evaluate(() => document.querySelector('shadow-ai-app')?.navigate?.('main'));
        await win.waitForTimeout(300);
        expect(await win.evaluate(() => document.querySelector('shadow-ai-app')?.currentView)).toBe('main');
    });
});

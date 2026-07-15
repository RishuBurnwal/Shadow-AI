/**
 * Shadow AI — E2E smoke tests using Playwright + Electron.
 *
 * Run with: npx playwright test
 * or:        npm run test:e2e
 */

const { test, expect, _electron: electron } = require('@playwright/test');

/**
 * Launch the Electron app and return the main window handle.
 * Auto-grants screen/audio permissions so the app UI loads promptly.
 */
async function launchApp() {
    const electronApp = await electron.launch({
        args: ['.'],
        env: {
            ...process.env,
            NODE_ENV: 'test',
            SHADOW_AI_SILENT: 'true',
        },
    });

    // Auto-grant screen/audio permissions before the app requests them
    await electronApp.evaluate(async ({ session }) => {
        session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
            callback(true);
        });
    });

    // The first window is the app window. Dismiss any permission dialog.
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    const title = await window.title();
    if (title === 'Screen and Audio Capture') {
        await window.keyboard.press('Enter');
        await window.waitForTimeout(3000);
        await window.waitForLoadState('domcontentloaded');
    }

    return { app: electronApp, window };
}

test.describe('Shadow AI — App smoke tests', () => {
    let electronApp;
    let window;

    test.beforeEach(async () => {
        const launched = await launchApp();
        electronApp = launched.app;
        window = launched.window;
    });

    test.afterEach(async () => {
        if (electronApp) await electronApp.close();
    });

    test('should launch and show the app shell', async () => {
        // App shell component should be rendered in the DOM
        const appShell = window.locator('shadow-ai-app');
        await expect(appShell).toHaveCount(1, { timeout: 10000 });

        // Window should have a non-empty title
        const title = await window.title();
        expect(title.length).toBeGreaterThan(0);
    });

    test('should render either onboarding or main view', async () => {
        // Check via shadow DOM access — Playwright can pierce open shadow roots
        const hasUi = await window.evaluate(() => {
            const shell = document.querySelector('shadow-ai-app');
            if (!shell) return false;
            // Check if either onboarding or main view exists in the shadow root
            const root = shell.shadowRoot;
            if (!root) return false;
            return (
                root.querySelector('onboarding-view') !== null ||
                root.querySelector('main-view') !== null ||
                root.textContent.trim().length > 20
            );
        });

        expect(hasUi).toBe(true);
    });

    test('should evaluate code in the main process', async () => {
        const appVersion = await electronApp.evaluate(async ({ app }) => {
            return app.getVersion();
        });
        expect(appVersion).toMatch(/^\d+\.\d+\.\d+$/);

        const isPackaged = await electronApp.evaluate(async ({ app }) => {
            return app.isPackaged;
        });
        expect(isPackaged).toBe(false);
    });

    test('should expose shadowAI preload bridge', async () => {
        const hasBridge = await window.evaluate(() => {
            return typeof window.shadowAI !== 'undefined' && window.shadowAI !== null;
        });
        expect(hasBridge).toBe(true);

        const hasStorage = await window.evaluate(() => {
            return typeof window.shadowAI?.storage !== 'undefined';
        });
        expect(hasStorage).toBe(true);

        const hasGetProviderStatus = await window.evaluate(() => {
            return typeof window.shadowAI?.getProviderStatus === 'function';
        });
        expect(hasGetProviderStatus).toBe(true);
    });

    test('should have non-zero window dimensions', async () => {
        const bounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
            const wins = BrowserWindow.getAllWindows();
            const win = wins.find(w => !w.isDestroyed());
            if (!win) return null;
            const [width, height] = win.getSize();
            return { width, height };
        });

        expect(bounds).not.toBeNull();
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);
    });
});

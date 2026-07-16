// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * Playwright configuration for Shadow AI Electron app E2E tests.
 *
 * Uses Playwright's experimental Electron support (_electron.launch)
 * to launch and interact with the desktop app. Tests run against the
 * development (unpackaged) Electron app, launched from the project root.
 */
module.exports = defineConfig({
    testDir: './e2e',
    testMatch: '**/*.e2e.js',
    timeout: 30000,
    expect: {
        timeout: 10000,
    },
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? 'github' : 'list',

    use: {
        actionTimeout: 10000,
        trace: 'on-first-retry',
    },

    projects: [
        {
            name: 'electron',
            use: {
                launchOptions: {
                    args: ['.'],
                    env: {
                        ...process.env,
                        NODE_ENV: 'test',
                        SHADOW_AI_SILENT: 'true',
                    },
                },
            },
        },
    ],
});

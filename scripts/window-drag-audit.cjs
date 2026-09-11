const { app, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
process.env.SHADOW_AI_CONFIG_DIR = path.join(root, '.test-drag-config');
process.env.SHADOW_AI_ENV_PATH = path.join(process.env.SHADOW_AI_CONFIG_DIR, '.env');
fs.mkdirSync(process.env.SHADOW_AI_CONFIG_DIR, { recursive: true });
fs.writeFileSync(process.env.SHADOW_AI_ENV_PATH, '');
app.setPath('userData', path.join(process.env.SHADOW_AI_CONFIG_DIR, 'electron'));
const timer = setTimeout(() => app.exit(1), 30000);
app.on('browser-window-created', (_, win) =>
    win.webContents.once('did-finish-load', async () => {
        try {
            await new Promise(r => setTimeout(r, 800));
            const cases = [];
            for (const [width, height, passthrough] of [
                [901, 601, false],
                [800, 500, true],
                [960, 640, false],
            ]) {
                win.setBounds({ x: 80, y: 80, width, height });
                await win.webContents.executeJavaScript(`window.electronAPI.ipcRenderer.invoke('set-passthrough',${passthrough})`);
                const before = win.getBounds();
                const sizes = [];
                for (let i = 0; i < 300; i++) {
                    await win.webContents.executeJavaScript(
                        `window.electronAPI.ipcRenderer.invoke('window-set-position',{x:${80 + (i % 20)},y:${80 + (i % 20)}})`
                    );
                    sizes.push(win.getBounds());
                }
                const after = win.getBounds();
                // Fractional DIP conversion can round edges by up to 2 DIP; it must
                // never accumulate over hundreds of moves or subsequent drag gestures.
                assert.ok(sizes.every(b => Math.abs(b.width - before.width) <= 2 && Math.abs(b.height - before.height) <= 2));
                assert.notEqual(after.x, before.x);
                cases.push({ before, after, passthrough, moves: sizes.length });
            }
            const result = { status: 'PASS', cases, displays: screen.getAllDisplays().map(d => ({ bounds: d.bounds, scale: d.scaleFactor })) };
            fs.writeFileSync('logs/drag-bounds.json', JSON.stringify(result, null, 2));
            console.log(JSON.stringify(result));
            clearTimeout(timer);
            app.exit(0);
        } catch (e) {
            console.error(e);
            app.exit(1);
        }
    })
);
require('../src/index');

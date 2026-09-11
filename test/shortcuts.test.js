const test = require('node:test');
const assert = require('node:assert/strict');

const { getDefaultKeybinds, registerCaptureShortcuts } = require('../src/utils/window');

test('includes screen request and pause shortcuts', () => {
    const shortcuts = getDefaultKeybinds();

    assert.equal(shortcuts.captureScreen, process.platform === 'darwin' ? 'Cmd+Shift+F' : 'Ctrl+Shift+F');
    assert.equal(shortcuts.togglePause, process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P');
});

test('forwards configured screen and pause shortcuts to the renderer', () => {
    const registered = new Map();
    const sent = [];
    const keybinds = { ...getDefaultKeybinds(), captureScreen: 'Ctrl+Alt+F', togglePause: 'Ctrl+Alt+P' };

    registerCaptureShortcuts(
        keybinds,
        { webContents: { send: (...args) => sent.push(args) } },
        { register: (accelerator, handler) => registered.set(accelerator, handler) }
    );

    registered.get('Ctrl+Alt+F')();
    registered.get('Ctrl+Alt+P')();

    assert.deepEqual(sent, [
        ['handle-shortcut', 'capture-screen'],
        ['handle-shortcut', 'toggle-capture-pause'],
    ]);
});

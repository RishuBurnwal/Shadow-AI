function createPassthroughController(mainWindow) {
    let enabled = false;

    const apply = headerInteractive => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (enabled && !headerInteractive) {
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
        } else {
            mainWindow.setIgnoreMouseEvents(false);
        }
    };

    return {
        isEnabled: () => enabled,
        setEnabled(nextEnabled) {
            enabled = Boolean(nextEnabled);
            apply(false);
            mainWindow.webContents.send('click-through-toggled', enabled);
            return enabled;
        },
        toggle() {
            return this.setEnabled(!enabled);
        },
        setHeaderInteractive(headerInteractive) {
            apply(Boolean(headerInteractive));
        },
    };
}

module.exports = { createPassthroughController };

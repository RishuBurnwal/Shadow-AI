function createPassthroughController(
    mainWindow,
    { cursor = () => require('electron').screen.getCursorScreenPoint(), interval = setInterval, clear = clearInterval } = {}
) {
    let enabled = false;
    let dragging = false;
    let timer = null;
    let ignored = null;
    let extraRegions = [];
    const apply = interactive => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const next = enabled && !dragging && !interactive;
        if (next === ignored) return;
        ignored = next;
        mainWindow.setIgnoreMouseEvents(next, next ? { forward: true } : undefined);
    };
    const checkCursor = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const point = cursor();
        const bounds = mainWindow.getBounds();
        const x = point.x - bounds.x,
            y = point.y - bounds.y;
        const inHeader = x >= 0 && x < bounds.width && y >= 0 && y <= 48;
        const inMenu = extraRegions.some(rect => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height);
        apply(inHeader || inMenu);
    };
    mainWindow.once?.('closed', () => {
        if (timer) clear(timer);
        timer = null;
    });
    return {
        isEnabled: () => enabled,
        setEnabled(value) {
            enabled = Boolean(value);
            if (timer) clear(timer);
            timer = enabled ? interval(checkCursor, 50) : null;
            timer?.unref?.();
            if (enabled) checkCursor();
            else apply(true);
            mainWindow.webContents.send('click-through-toggled', enabled);
            return enabled;
        },
        toggle() {
            return this.setEnabled(!enabled);
        },
        setDragging(value) {
            dragging = Boolean(value);
            checkCursor();
        },
        setHeaderInteractive(value) {
            if (value && typeof value === 'object') {
                extraRegions = (Array.isArray(value.regions) ? value.regions : []).filter(rect =>
                    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
                );
                apply(Boolean(value.interactive));
            } else apply(Boolean(value));
        },
    };
}
module.exports = { createPassthroughController };

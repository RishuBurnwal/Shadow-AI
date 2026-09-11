(function exposeFrameAnalysis(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.shadowFrameAnalysis = api;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
    function isCapturedFrameBlank(width, height, readPixel) {
        if (width < 1 || height < 1 || typeof readPixel !== 'function') return true;

        for (let row = 0; row < 4; row += 1) {
            for (let column = 0; column < 4; column += 1) {
                const x = Math.min(width - 1, Math.floor(((column + 0.5) * width) / 4));
                const y = Math.min(height - 1, Math.floor(((row + 0.5) * height) / 4));
                const [red = 0, green = 0, blue = 0, alpha = 255] = readPixel(x, y);
                if (alpha > 0 && Math.max(red, green, blue) > 8) return false;
            }
        }
        return true;
    }

    return { isCapturedFrameBlank };
});

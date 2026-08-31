(function (root) {
    function fitImageDimensions(width, height, maxWidth = 1280) {
        const sourceWidth = Math.max(1, Number(width) || 1);
        const sourceHeight = Math.max(1, Number(height) || 1);
        if (sourceWidth <= maxWidth) return { width: sourceWidth, height: sourceHeight };
        return { width: maxWidth, height: Math.round(sourceHeight * (maxWidth / sourceWidth)) };
    }

    const api = { fitImageDimensions };
    if (typeof module !== 'undefined') module.exports = api;
    if (root) root.ShadowAIImageSizing = api;
})(typeof window === 'undefined' ? null : window);

function normalizeResponseDelayMs(value) {
    const milliseconds = value === undefined || value === null || value === '' ? 1500 : Number(value);
    return Math.min(10000, Math.max(0, Math.round(Number.isFinite(milliseconds) ? milliseconds : 1500)));
}

function createTurnDebouncer(delayMs = 1500) {
    let delay = normalizeResponseDelayMs(delayMs);
    let timer = null;
    let parts = [];

    function cancelTimer() {
        if (timer) clearTimeout(timer);
        timer = null;
    }

    return {
        setDelay(value) {
            delay = normalizeResponseDelayMs(value);
            return delay;
        },
        interrupt() {
            cancelTimer();
        },
        clear() {
            cancelTimer();
            parts = [];
        },
        schedule(text, callback) {
            const clean = String(text || '').trim();
            if (clean) parts.push(clean);
            cancelTimer();
            if (parts.length === 0) return;
            timer = setTimeout(async () => {
                timer = null;
                const combined = parts.join(' ').trim();
                parts = [];
                await callback(combined);
            }, delay);
        },
    };
}

module.exports = { createTurnDebouncer, normalizeResponseDelayMs };

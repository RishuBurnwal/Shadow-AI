function normalizeResponseDelayMs(value) {
    const milliseconds = value === undefined || value === null || value === '' ? 250 : Number(value);
    return Math.min(10000, Math.max(0, Math.round(Number.isFinite(milliseconds) ? milliseconds : 250)));
}

function createTurnDebouncer(delayMs = 250) {
    let delay = normalizeResponseDelayMs(delayMs);
    let timer = null;
    let parts = [];
    let held = false;
    let callback = null;

    function cancelTimer() {
        if (timer) clearTimeout(timer);
        timer = null;
    }

    function arm() {
        cancelTimer();
        if (held || !parts.length || !callback) return;
        timer = setTimeout(async () => {
            timer = null;
            const combined = parts.join(' ').trim();
            parts = [];
            await callback(combined);
        }, delay);
    }
    return {
        setDelay(value) {
            delay = normalizeResponseDelayMs(value);
            return delay;
        },
        interrupt() {
            cancelTimer();
        },
        hold(value = true) {
            const wasHeld = held;
            held = Boolean(value);
            if (held) cancelTimer();
            else if (wasHeld) arm();
        },
        clear() {
            cancelTimer();
            parts = [];
            held = false;
            callback = null;
        },
        schedule(text, onReady) {
            const clean = String(text || '').trim();
            if (clean) parts.push(clean);
            callback = onReady;
            arm();
        },
    };
}

function normalizeSilenceMs(value) {
    const number = Number(value);
    return Math.min(10000, Math.max(300, Number.isFinite(number) && number > 0 ? Math.round(number) : 1200));
}
module.exports = { createTurnDebouncer, normalizeResponseDelayMs, normalizeSilenceMs };

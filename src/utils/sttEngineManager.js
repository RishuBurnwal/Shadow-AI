function withTimeout(promise, milliseconds, name) {
    if (!milliseconds) return promise;
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${name} load timed out after ${milliseconds}ms`)), milliseconds);
        }),
    ]).finally(() => clearTimeout(timer));
}

function createSttEngineManager(loaders, { onActive = () => {}, logger = console } = {}) {
    let active = null;
    let activeIndex = -1;

    async function loadFrom(start = 0) {
        for (let index = start; index < loaders.length; index += 1) {
            const candidate = loaders[index];
            try {
                active = await withTimeout(Promise.resolve().then(candidate.load), candidate.timeoutMs, candidate.name);
                activeIndex = index;
                logger.log(`[SHADOW_STT_ENGINE] Active local STT engine: ${active.name || candidate.name}`);
                onActive(active.name || candidate.name);
                return active;
            } catch (error) {
                logger.warn(`[SHADOW_STT_ENGINE] ${candidate.name} unavailable: ${error.message}`);
            }
        }
        active = null;
        activeIndex = -1;
        throw new Error('No local STT engine could be loaded');
    }

    async function transcribe(audio, options) {
        if (!active) await loadFrom(0);
        try {
            return await active.transcribe(audio, options);
        } catch (firstError) {
            logger.warn(`[SHADOW_STT_ENGINE] ${active.name} inference failed; retrying once: ${firstError.message}`);
            try {
                return await active.transcribe(audio, options);
            } catch (secondError) {
                logger.warn(`[SHADOW_STT_ENGINE] ${active.name} retry failed; switching engine: ${secondError.message}`);
                await loadFrom(activeIndex + 1);
                return active.transcribe(audio, options);
            }
        }
    }

    return { load: () => loadFrom(0), transcribe, activeName: () => active?.name || null };
}

module.exports = { createSttEngineManager, withTimeout };

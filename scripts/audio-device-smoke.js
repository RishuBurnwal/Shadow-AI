const { _electron: electron } = require('@playwright/test');

async function measureStream(stream, durationMs = 1500) {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let peak = 0;
    const end = performance.now() + durationMs;
    while (performance.now() < end) {
        analyser.getByteTimeDomainData(samples);
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await context.close();
    return peak;
}

(async () => {
    const env = { ...process.env, NODE_ENV: 'test', SHADOW_AI_SILENT: 'true' };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({ args: ['.'], env });
    try {
        await app.evaluate(({ session }) => session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true)));
        const win = await app.firstWindow();
        await win.waitForLoadState('domcontentloaded');

        const result = await win.evaluate(async measure => {
            const measureStream = new Function(`return (${measure})`)();
            const microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const devices = await navigator.mediaDevices.enumerateDevices();
            const microphonePeak = await measureStream(microphone);
            const microphoneTrack = microphone.getAudioTracks()[0];
            const microphoneResult = { label: microphoneTrack?.label, live: microphoneTrack?.readyState === 'live', peak: microphonePeak };
            microphone.getTracks().forEach(track => track.stop());

            const loopback = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const outputContext = new AudioContext();
            const oscillator = outputContext.createOscillator();
            const gain = outputContext.createGain();
            gain.gain.value = 0.025;
            oscillator.frequency.value = 440;
            oscillator.connect(gain).connect(outputContext.destination);
            oscillator.start();
            const loopbackPeak = await measureStream(loopback);
            oscillator.stop();
            await outputContext.close();
            const loopbackTrack = loopback.getAudioTracks()[0];
            const loopbackResult = { label: loopbackTrack?.label, live: loopbackTrack?.readyState === 'live', peak: loopbackPeak };
            loopback.getTracks().forEach(track => track.stop());

            return {
                inputs: devices.filter(device => device.kind === 'audioinput').map(device => device.label),
                outputs: devices.filter(device => device.kind === 'audiooutput').map(device => device.label),
                microphone: microphoneResult,
                loopback: loopbackResult,
            };
        }, measureStream.toString());

        console.log(JSON.stringify(result, null, 2));
        if (!result.microphone.live || result.microphone.peak === 0) throw new Error('Microphone stream produced no PCM signal.');
        if (!result.loopback.live || result.loopback.peak === 0) throw new Error('System loopback stream produced no PCM signal.');
        console.log('Physical microphone and system loopback checks passed.');
    } finally {
        await app.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.env.SHADOW_AI_CONFIG_DIR = path.join(root, '.test-live-config');
process.env.SHADOW_AI_ENV_PATH = path.join(root, '.env');
app.setPath('userData', path.join(process.env.SHADOW_AI_CONFIG_DIR, 'electron'));
let timer = setTimeout(() => {
    console.error('LIVE_E2E_TIMEOUT');
    app.exit(1);
}, 85000);
app.on('browser-window-created', (_, win) =>
    win.webContents.once('did-finish-load', async () => {
        try {
            const run = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`);
            await run(
                `await customElements.whenDefined('shadow-ai-app');await new Promise(r=>setTimeout(r,750));await window.shadowAI.storage.updatePreference('privacyMode',true);await window.shadowAI.storage.updatePreference('includeRecentScreenshotWithVoice',false);await window.shadowAI.storage.updatePreference('automaticResponse',true);`
            );
            const initialized = await run(
                `return await window.electronAPI.ipcRenderer.invoke('initialize-gemini',await window.shadowAI.storage.getApiKey(),'Answer the exact question in one short sentence.','meeting','en-US');`
            );
            if (!initialized) throw Error('Live session initialization failed');
            await run(
                `window.liveAuditText='';window.electronAPI.ipcRenderer.on('new-response',(_,text)=>window.liveAuditText=text);window.electronAPI.ipcRenderer.on('update-response',(_,text)=>window.liveAuditText=text);`
            );
            await new Promise(r => setTimeout(r, 800));
            const wav = fs.readFileSync(path.join(root, 'logs/audit-speech.wav'));
            let offset = 12,
                audio;
            while (offset + 8 < wav.length) {
                const size = wav.readUInt32LE(offset + 4);
                if (wav.toString('ascii', offset, offset + 4) === 'data') {
                    audio = wav.subarray(offset + 8, offset + 8 + size);
                    break;
                }
                offset += 8 + size + (size % 2);
            }
            for (let i = 0; i < audio.length; i += 4800) {
                await run(
                    `window.electronAPI.ipcRenderer.send('send-audio-content',{data:${JSON.stringify(audio.subarray(i, i + 4800).toString('base64'))},mimeType:'audio/pcm;rate=24000'});`
                );
                await new Promise(r => setTimeout(r, 100));
            }
            // Continue silence through the same capture IPC so server VAD finalizes the question.
            for (let i = 0; i < 15; i++) {
                await run(
                    `window.electronAPI.ipcRenderer.send('send-audio-content',{data:${JSON.stringify(Buffer.alloc(4800).toString('base64'))},mimeType:'audio/pcm;rate=24000'});`
                );
                await new Promise(r => setTimeout(r, 100));
            }
            let text = '';
            const deadline = Date.now() + 65000;
            while (Date.now() < deadline) {
                text = await run(`return window.liveAuditText;`);
                if (/four|4/i.test(text)) break;
                await new Promise(r => setTimeout(r, 300));
            }
            const result = {
                status: /four|4/i.test(text) ? 'PASS' : 'FAIL',
                scope: 'Synthetic speech -> real renderer audio IPC -> selected transcription provider -> hosted answer router -> renderer answer',
                text,
            };
            fs.writeFileSync(path.join(root, 'logs/electron-live-audio.json'), JSON.stringify(result, null, 2));
            console.log('LIVE_E2E ' + JSON.stringify(result));
            await run(`return await window.electronAPI.ipcRenderer.invoke('close-session');`);
            clearTimeout(timer);
            app.exit(result.status === 'PASS' ? 0 : 1);
        } catch (e) {
            console.error('LIVE_E2E_FAIL', e.message);
            clearTimeout(timer);
            app.exit(1);
        }
    })
);
require('../src/index.js');

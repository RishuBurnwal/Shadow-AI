const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
process.env.SHADOW_AI_CONFIG_DIR = path.join(root, '.test-audit-config');
process.env.SHADOW_AI_ENV_PATH = path.join(process.env.SHADOW_AI_CONFIG_DIR, '.env');
fs.mkdirSync(process.env.SHADOW_AI_CONFIG_DIR, { recursive: true });
fs.writeFileSync(process.env.SHADOW_AI_ENV_PATH, '');
app.setPath('userData', path.join(process.env.SHADOW_AI_CONFIG_DIR, 'electron'));
const results = [],
    errors = [];
let networkCalls = 0;
let lastRequestBody;
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
    if (options?.headers?.Authorization === 'Bearer audit-fake-key') {
        if (String(url).endsWith('/models'))
            return Response.json({ data: [{ id: 'qwen/qwen3.6-27b' }, { id: 'openai/gpt-oss-20b' }, { id: 'whisper-large-v3' }] });
        networkCalls++;
        lastRequestBody = JSON.parse(options.body);
        return new Response('data: {"choices":[{"delta":{"content":"Synthetic answer"}}]}\n\n');
    }
    return originalFetch(url, options);
};
const timer = setTimeout(() => {
    console.error('ELECTRON_SMOKE_TIMEOUT');
    app.exit(1);
}, 45000);
app.on('browser-window-created', (_event, win) => {
    win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 3) errors.push(message);
    });
    win.webContents.once('did-finish-load', async () => {
        try {
            const run = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`);
            await run(
                `await customElements.whenDefined('shadow-ai-app'); await document.querySelector('shadow-ai-app').updateComplete; await new Promise(resolve=>setTimeout(resolve,750));`
            );
            for (const view of ['onboarding', 'main', 'customize', 'ai-customize', 'history', 'memory', 'help', 'assistant']) {
                const visible = await run(
                    `const app=document.querySelector('shadow-ai-app');app.currentView=${JSON.stringify(view)};await app.updateComplete;const view=app.shadowRoot.querySelector(${JSON.stringify(view === 'ai-customize' ? 'ai-customize-view' : view + '-view')});if(view)await view.updateComplete;return Boolean(view?.shadowRoot?.textContent.trim());`
                );
                assert.equal(visible, true, view + ' renders');
                results.push({ check: view + ' render', status: 'PASS' });
            }
            for (const mode of ['manual', 'automatic']) {
                const ok = await run(
                    `const view=document.querySelector('shadow-ai-app').shadowRoot.querySelector('assistant-view');view.screenAnalysisMode=${JSON.stringify(mode)};await view.updateComplete;return Boolean(view.shadowRoot.querySelector('.analyze-btn'));`
                );
                assert.equal(ok, true);
                results.push({ check: 'Analyze Screen visible in ' + mode, status: 'PASS' });
            }
            for (const width of [720, 900, 1100, 1440]) {
                win.setSize(width, 800);
                await new Promise(resolve => setTimeout(resolve, 100));
                const layout = await run(
                    `const root=document.querySelector('shadow-ai-app').shadowRoot;const bar=root.querySelector('.top-drag-bar');const controls=[...bar.querySelectorAll(':scope > button,:scope > select,:scope > .provider-select-wrap,:scope > .header-more,:scope > .traffic-lights,:scope > .drag-region')].filter(el=>getComputedStyle(el).display!=='none');return {width:innerWidth,overflow:controls.filter(el=>{const r=el.getBoundingClientRect();return r.left<0||r.right>innerWidth;}).map(el=>el.className)};`
                );
                assert.deepEqual(layout.overflow, [], 'header at ' + width);
                const sliders = await run(
                    `const root=document.querySelector('shadow-ai-app').shadowRoot;return [...root.querySelectorAll('.persistent-opacity')].map(el=>{const r=el.getBoundingClientRect();return getComputedStyle(el).display!=='none'&&r.width>0&&r.left>=0&&r.right<=innerWidth;});`
                );
                assert.deepEqual(sliders, [true, true], 'both sliders visible at ' + width);
            }
            const opacity = await run(
                `const app=document.querySelector('shadow-ai-app');const controls=app.shadowRoot.querySelectorAll('.persistent-opacity input');for(const input of controls){input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}));}await new Promise(r=>setTimeout(r,150));const style=getComputedStyle(app.shadowRoot.querySelector('.top-drag-bar'));const prefs=await window.shadowAI.storage.getPreferences();return {opacity:style.opacity,background:style.backgroundColor,screen:prefs.backgroundTransparency,text:prefs.responseTextOpacity};`
            );
            assert.equal(opacity.opacity, '1');
            assert.ok(!opacity.background.startsWith('rgba'), 'header retains opaque background');
            assert.equal(opacity.screen, 0);
            assert.equal(opacity.text, 0);
            await run(
                `const app=document.querySelector('shadow-ai-app');await app.handleBackgroundTransparencyChange(0.8);await app.handleResponseTextOpacityChange(1);`
            );
            results.push({
                check: 'both header sliders stay visible at all widths; input persists; zero content opacity leaves header opaque',
                status: 'PASS',
            });
            win.setSize(720, 800);
            win.setPosition(40, 40);
            win.show();
            win.focus();
            await run(`document.querySelector('shadow-ai-app').shadowRoot.querySelector('.header-more').open=true;`);
            const menuVisible = await run(
                `const root=document.querySelector('shadow-ai-app').shadowRoot;const menu=root.querySelector('.header-more-panel');const r=menu.getBoundingClientRect();return r.bottom>48&&root.elementFromPoint(r.left+10,r.top+10)!==null;`
            );
            assert.equal(menuVisible, true);
            await run(
                `document.querySelector('shadow-ai-app').shadowRoot.querySelector('.header-more').open=false;await window.electronAPI.ipcRenderer.invoke('set-passthrough',true);`
            );
            const beforeDrag = win.getPosition();
            const drag = await run(
                `const r=document.querySelector('shadow-ai-app').shadowRoot.querySelector('.drag-region').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:24};`
            );
            const { screen } = require('electron');
            const savedCursor = screen.dipToScreenPoint(screen.getCursorScreenPoint());
            const point = screen.dipToScreenPoint({ x: beforeDrag[0] + drag.x, y: beforeDrag[1] + drag.y });
            win.show();
            win.focus();
            // Move the actual OS cursor: synthetic webContents input cannot test
            // native click-through hit testing, which uses the real cursor.
            await new Promise((resolve, reject) => {
                require('node:child_process').execFile(
                    'powershell.exe',
                    [
                        '-NoProfile',
                        '-Command',
                        `
                    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class AuditMouse { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); }';
                    [AuditMouse]::SetProcessDPIAware() | Out-Null
                    try {
                        [AuditMouse]::SetCursorPos(${point.x},${point.y}) | Out-Null
                        Start-Sleep -Milliseconds 250
                        [AuditMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
                        Start-Sleep -Milliseconds 150
                        [AuditMouse]::SetCursorPos(${point.x + 60},${point.y + 20}) | Out-Null
                        Start-Sleep -Milliseconds 250
                    } finally {
                        [AuditMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
                        [AuditMouse]::SetCursorPos(${savedCursor.x},${savedCursor.y}) | Out-Null
                    }
                `,
                    ],
                    { windowsHide: true },
                    error => (error ? reject(error) : resolve())
                );
            });
            const afterDrag = win.getPosition();
            assert.ok(afterDrag[0] !== beforeDrag[0] || afterDrag[1] !== beforeDrag[1], 'passthrough drag moves native window');
            await run(`await window.electronAPI.ipcRenderer.invoke('set-passthrough',false);`);
            results.push({
                check: 'responsive header at 720/900/1100/1440; dropdown visible; real Electron input drags native window in passthrough',
                status: 'PASS',
            });
            const capture = await run(
                `const result=await window.captureManualScreenshot();return {result,busy:document.querySelector('shadow-ai-app').shadowRoot.querySelector('assistant-view').isAnalyzing};`
            );
            assert.equal(capture.result.success, false);
            assert.equal(capture.busy, false);
            results.push({ check: 'capture without share returns error and clears spinner', status: 'PASS' });
            const text = await run(`return await window.electronAPI.ipcRenderer.invoke('send-text-message','Synthetic smoke test');`);
            assert.equal(text.success, false);
            assert.match(text.error, /No answer provider/);
            results.push({ check: 'real IPC text error reaches UI contract', status: 'PASS' });
            const profile = await run(
                `const ipc=window.electronAPI.ipcRenderer;await ipc.invoke('storage:set-profile',{name:'Synthetic Candidate',resumeText:'Private synthetic resume'});return await ipc.invoke('storage:get-profile');`
            );
            assert.equal(profile.data.name, 'Synthetic Candidate');
            assert.equal(
                fs.readFileSync(path.join(process.env.SHADOW_AI_CONFIG_DIR, 'profile.json'), 'utf8').includes('Private synthetic resume'),
                false
            );
            results.push({ check: 'OS-encrypted profile round trip; no plaintext on disk', status: 'PASS' });
            const memory = require('../src/memory');
            memory.saveMemory([{ id: 'synthetic', fact: 'Synthetic secret fact' }]);
            assert.equal(memory.getMemory()[0].fact, 'Synthetic secret fact');
            assert.equal(
                fs.readFileSync(path.join(process.env.SHADOW_AI_CONFIG_DIR, 'memory.json'), 'utf8').includes('Synthetic secret fact'),
                false
            );
            results.push({ check: 'OS-encrypted memory round trip', status: 'PASS' });
            fs.writeFileSync(
                process.env.SHADOW_AI_ENV_PATH,
                'GROQ_API_KEY=audit-fake-key, audit-second-key, audit-fake-key\nGROQ_MODEL=qwen/qwen3.6-27b'
            );
            await run(`await window.shadowAI.storage.updatePreference('contextRules',{interview:{screen:'automatic'}});`);
            const count = await run(`return (await window.shadowAI.getProviderStatus(true)).providers.groq.keyCount;`);
            assert.equal(count, 2);
            await run(
                `await window.shadowAI.storage.updatePreference('selectedProfile','interview');await window.shadowAI.storage.updatePreference('jobDescription','SYNTHETIC_JD_MARKER');await window.electronAPI.ipcRenderer.invoke('send-text-message','Introduce yourself');`
            );
            assert.ok(JSON.stringify(lastRequestBody).includes('SYNTHETIC_JD_MARKER'));
            assert.ok(JSON.stringify(lastRequestBody).includes('Private synthetic resume'));
            const contextUI = await run(`
                const app=document.querySelector('shadow-ai-app');app.currentView='customize';await app.updateComplete;
                const view=app.shadowRoot.querySelector('customize-view');await view.updateComplete;
                const settings=view.shadowRoot.querySelector('context-settings');await settings.firstUpdated();await settings.updateComplete;
                settings.mode='quiz';await settings.save('selectedProfile','quiz');await settings.updateComplete;
                const defaults={resume:settings.shadowRoot.querySelector('input[aria-label="Resume / background"]').checked,jd:settings.shadowRoot.querySelector('input[aria-label="JD / role / company"]').checked};
                await settings.rule('screen','off');settings.name='Synthetic quiz profile';await settings.createProfile();
                const saved=await window.shadowAI.storage.getPreferences();
                const blocked=await window.electronAPI.ipcRenderer.invoke('send-image-content',{data:'synthetic',prompt:'test'});
                await window.electronAPI.ipcRenderer.invoke('send-text-message','What is two plus two?');
                return {defaults,blocked,selected:saved.activeContextProfiles.quiz,profiles:saved.contextProfiles};
            `);
            assert.deepEqual(contextUI.defaults, { resume: false, jd: false });
            assert.equal(contextUI.blocked.success, false);
            assert.equal(contextUI.profiles.find(p => p.id === contextUI.selected).rules.screen, 'off');
            assert.ok(!JSON.stringify(lastRequestBody).includes('SYNTHETIC_JD_MARKER'));
            assert.ok(!JSON.stringify(lastRequestBody).includes('Private synthetic resume'));
            await run(
                `await window.shadowAI.storage.updatePreference('selectedProfile','interview');window.dispatchEvent(new CustomEvent('context-settings-changed'));`
            );
            results.push({
                check: 'comma key count; interview payload includes resume/JD; quiz payload excludes them; saved context profile and backend screen-off enforcement',
                status: 'PASS',
            });
            const modelSettings = await run(`
                const app=document.querySelector('shadow-ai-app');app.currentView='customize';await app.updateComplete;
                const view=app.shadowRoot.querySelector('customize-view');await view.updateComplete;
                const settings=view.shadowRoot.querySelector('model-settings');await settings.refresh(true);await settings.updateComplete;
                const initial=[...settings.status.providers.groq.models];
                const audioDisabled=settings.shadowRoot.querySelector('option[value="whisper-large-v3"]').disabled;
                settings.candidate='openai/gpt-oss-20b';await settings.updateComplete;
                [...settings.shadowRoot.querySelectorAll('button')].find(b=>b.textContent.includes('Test & add')).click();
                while(settings.busy)await new Promise(r=>setTimeout(r,30));await settings.updateComplete;
                const added=[...settings.status.providers.groq.models];
                settings.shadowRoot.querySelector('button[aria-label="Remove openai/gpt-oss-20b"]').click();
                while(settings.busy)await new Promise(r=>setTimeout(r,30));await settings.updateComplete;
                const removed=[...settings.status.providers.groq.models];
                const forbidden=await window.electronAPI.ipcRenderer.invoke('set-provider-model','groq','openai/gpt-oss-20b');
                app.currentView='assistant';await app.updateComplete;
                return {initial,audioDisabled,added,removed,forbidden};
            `);
            assert.deepEqual(modelSettings.initial, ['qwen/qwen3.6-27b']);
            assert.equal(modelSettings.audioDisabled, true);
            assert.deepEqual(modelSettings.added, ['qwen/qwen3.6-27b', 'openai/gpt-oss-20b']);
            assert.deepEqual(modelSettings.removed, ['qwen/qwen3.6-27b']);
            assert.equal(modelSettings.forbidden.success, false);
            results.push({
                check: 'Settings catalog filters audio; Test & add probes model; Remove persists; removed selection rejected through real IPC',
                status: 'PASS',
            });
            await run(
                `const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,640,480);window.auditCanvas=canvas;mediaStream=canvas.captureStream(10);`
            );
            const first = await run(`return await window.captureManualScreenshot();`);
            assert.equal(first.success, true);
            const before = networkCalls;
            const duplicate = await run(`return await window.captureManualScreenshot(null,true);`);
            assert.equal(duplicate.skipped, true);
            assert.equal(networkCalls, before);
            await run(`await window.captureManualScreenshot();`);
            assert.equal(networkCalls, before + 1);
            await run(`lastSentAt=Date.now()-31000;await window.captureManualScreenshot(null,true);`);
            assert.equal(networkCalls, before + 2);
            results.push({ check: 'real canvas capture + IPC; automatic duplicate skipped, manual and expired frame sent', status: 'PASS' });
            await run(
                `window.manualAudit=[];window.electronAPI.ipcRenderer.on('interim-transcription',(_,v)=>window.manualAudit.push(v));await window.shadowAI.storage.updatePreference('automaticResponse',false);`
            );
            require('../src/utils/gemini').publishFinalQuestion('First part');
            require('../src/utils/gemini').publishFinalQuestion('second part');
            await new Promise(resolve => setTimeout(resolve, 100));
            assert.equal(await run(`return window.manualAudit.at(-1).text;`), 'First part second part');
            await run(`await window.shadowAI.storage.updatePreference('automaticResponse',true);`);
            results.push({ check: 'Manual voice mode preserves multiple finalized transcript segments before confirmation', status: 'PASS' });
            const reset = await run(`
                const app=document.querySelector('shadow-ai-app');app.currentView='customize';await app.updateComplete;
                const view=app.shadowRoot.querySelector('customize-view');await view.updateComplete;
                await view.handleVadSilenceChange({target:{value:'2300'}});
                await view.handleResponseDelayChange({target:{value:'1.4'}});
                await view.handleFontSizeChange({target:{value:'24'}});
                const edited=await window.shadowAI.storage.getPreferences();
                await app.handleResponseTextOpacityChange(0.3);
                await window.electronAPI.ipcRenderer.invoke('set-focus-lock',true);
                await view.restoreAllSettings();
                const saved=await window.shadowAI.storage.getPreferences();
                const state={edited,saved,font:document.documentElement.style.getPropertyValue('--response-font-size'),opacity:app.responseTextOpacity,focus:app.focusLock,status:view.clearStatusType};
                app.currentView='assistant';await app.updateComplete;return state;
            `);
            assert.equal(reset.edited.vadSilenceMs, 2300);
            assert.equal(reset.edited.responseDelayMs, 1400);
            assert.equal(reset.edited.fontSize, 24);
            assert.equal(reset.saved.vadSilenceMs, 1200);
            assert.equal(reset.saved.responseDelayMs, 750);
            assert.equal(reset.font, '20px');
            assert.equal(reset.opacity, 1);
            assert.equal(reset.focus, false);
            assert.equal(reset.saved.jobDescription, 'SYNTHETIC_JD_MARKER');
            assert.equal(reset.status, 'success');
            results.push({ check: 'Audio timing and font controls persist; general reset applies header state and preserves JD', status: 'PASS' });
            const focusEnabled = await run(`return await window.electronAPI.ipcRenderer.invoke('set-focus-lock',true);`);
            assert.equal(focusEnabled.success, true);
            assert.equal(win.isFocusable(), false);
            await run(`await window.electronAPI.ipcRenderer.invoke('set-focus-lock',false);`);
            assert.equal(win.isFocusable(), true);
            results.push({ check: 'Focus lock IPC disables and restores native focusability', status: 'PASS' });
            const sources = await require('electron').desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 32, height: 32 } });
            assert.ok(sources.length > 0);
            results.push({ check: 'native desktop capture sources available (no desktop content uploaded)', status: 'PASS' });
            require('electron').ipcMain.removeHandler('send-image-content');
            require('electron').ipcMain.handle('send-image-content', () => new Promise(() => {}));
            win.webContents.send('handle-shortcut', 'capture-screen');
            await new Promise(resolve => setTimeout(resolve, 300));
            assert.equal(await run(`return document.querySelector('shadow-ai-app').shadowRoot.querySelector('assistant-view').isAnalyzing;`), true);
            await new Promise(resolve => setTimeout(resolve, 18000));
            assert.equal(await run(`return document.querySelector('shadow-ai-app').shadowRoot.querySelector('assistant-view').isAnalyzing;`), false);
            results.push({ check: 'actual shortcut enters spinner; 18-second watchdog clears hung IPC', status: 'PASS' });
            await run(`window.shadowAI.stopCapture();`);
            const pref = await run(
                `await window.shadowAI.storage.updatePreference('automaticResponse',false);return (await window.shadowAI.storage.getPreferences()).automaticResponse;`
            );
            assert.equal(pref, false);
            results.push({ check: 'preferences IPC persistence', status: 'PASS' });
            await run(
                `const app=document.querySelector('shadow-ai-app');app.currentView='main';await app.updateComplete;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`
            );
            fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
            fs.writeFileSync(path.join(root, 'logs/electron-smoke.png'), (await win.webContents.capturePage()).toPNG());
            assert.deepEqual(errors, [], 'renderer errors');
            results.push({ check: 'renderer console', status: 'PASS' });
            console.log('ELECTRON_SMOKE ' + JSON.stringify(results));
            fs.writeFileSync(path.join(root, 'logs/electron-smoke.json'), JSON.stringify({ results, errors }, null, 2));
            clearTimeout(timer);
            app.exit(0);
        } catch (error) {
            console.error('ELECTRON_SMOKE_FAIL', error.message, JSON.stringify(errors));
            clearTimeout(timer);
            app.exit(1);
        }
    });
});
require('../src/index.js');

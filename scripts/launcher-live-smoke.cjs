// Launch the real Python -> npm -> Electron path with isolated saved data.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const config = path.join(root, '.test-launcher-config');
fs.mkdirSync(config, { recursive: true });
fs.writeFileSync(path.join(config, '.env'), '');
const marker = path.join(config, `ready-${Date.now()}`);
const env = { ...process.env, SHADOW_AI_CONFIG_DIR: config, SHADOW_AI_ENV_PATH: path.join(config, '.env'), SHADOW_AI_READY_MARKER: marker };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn('python', ['main.py', '--skip-update', '--skip-install', '--wait'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
let ended = false;
child.on('exit', () => {
    ended = true;
});
child.on('error', error => {
    console.error(error.message);
    ended = true;
});
(async () => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && !ended && !fs.existsSync(marker)) await new Promise(resolve => setTimeout(resolve, 300));
    const success = fs.existsSync(marker) && !ended;
    const result = { status: success ? 'PASS' : 'FAIL', scope: 'Actual main.py --wait -> npm start -> Electron renderer readiness' };
    fs.writeFileSync(path.join(root, 'logs/launcher-live-smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (!ended && child.pid) {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else child.kill();
    }
    process.exitCode = success ? 0 : 1;
})();

// Check the shipped archive and launch the actual Windows executable with isolated data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const packaged = path.join(root, 'out/Shadow AI-win32-x64');
const archive = path.join(packaged, 'resources/app.asar');
const files = asar.listPackage(archive);
const forbidden = files.filter(file => /^\/(?:\.env$|logs\/|\.test|\.agents\/|\.codex\/|local-documents\/|graphify-out\/)/.test(file));
assert.deepEqual(forbidden, [], 'private configuration and development artifacts excluded');
for (const file of files.filter(file => /^\/src\/.+\.(js|html|proto)$/.test(file) && !file.startsWith('/src/assets/'))) {
    const sourcePath = path.join(root, file.slice(1));
    assert.deepEqual(asar.extractFile(archive, file.slice(1)), fs.readFileSync(sourcePath), 'packaged source matches ' + file);
}
const isolated = path.join(root, '.test-packaged-config');
fs.mkdirSync(isolated, { recursive: true });
fs.writeFileSync(path.join(isolated, '.env'), '');
const env = { ...process.env, SHADOW_AI_CONFIG_DIR: isolated, SHADOW_AI_ENV_PATH: path.join(isolated, '.env') };
delete env.ELECTRON_RUN_AS_NODE;
let child;
try {
    child = spawn(path.join(packaged, 'Shadow AI.exe'), [], { env, windowsHide: true, stdio: 'ignore' });
} catch (error) {
    fs.writeFileSync(
        path.join(root, 'logs/packaged-smoke.json'),
        JSON.stringify({ status: 'FAIL', archiveSourceMatches: true, privateFilesExcluded: true, error: error.message }, null, 2)
    );
    console.error(error.message);
    process.exit(1);
}
let exited = false;
child.on('exit', () => {
    exited = true;
});
child.on('error', error => {
    fs.writeFileSync(path.join(root, 'logs/packaged-smoke.json'), JSON.stringify({ status: 'FAIL', error: error.message }, null, 2));
    console.error(error.message);
    process.exitCode = 1;
});
setTimeout(() => {
    execFile(
        'powershell.exe',
        ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid} -ErrorAction Stop).MainWindowTitle`],
        { windowsHide: true },
        (error, stdout) => {
            try {
                assert.equal(exited, false, 'packaged process remains alive');
                if (error) throw error;
                assert.equal(stdout.trim(), 'Shadow AI', 'packaged renderer window opens');
                const result = { status: 'PASS', archiveSourceMatches: true, privateFilesExcluded: true, windowTitle: stdout.trim() };
                fs.writeFileSync(path.join(root, 'logs/packaged-smoke.json'), JSON.stringify(result, null, 2));
                console.log(JSON.stringify(result));
            } catch (error) {
                console.error(error.message);
                process.exitCode = 1;
            } finally {
                child.kill();
            }
        }
    );
}, 10000);

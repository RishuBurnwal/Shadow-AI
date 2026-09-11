const { app, BrowserWindow, screen } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
app.whenReady().then(async () => {
    const previous = screen.dipToScreenPoint(screen.getCursorScreenPoint());
    const background = new BrowserWindow({ width: 500, height: 300, x: 30, y: 380 });
    const overlay = new BrowserWindow({ width: 300, height: 130, x: 300, y: 180, frame: false, alwaysOnTop: true, show: false });
    try {
        await background.loadURL('data:text/html,<title>Focus test background</title>Focus test');
        await overlay.loadURL(
            'data:text/html,<button style="width:100%;height:90px" onclick="document.body.dataset.clicked=1">Synthetic control</button>'
        );
        overlay.setContentProtection(true);
        overlay.setFocusable(false);
        overlay.showInactive();
        background.focus();
        const bounds = overlay.getBounds();
        const point = screen.dipToScreenPoint({ x: bounds.x + 100, y: bounds.y + 45 });
        const bg = background.getBounds();
        const bgPoint = screen.dipToScreenPoint({ x: bg.x + 60, y: bg.y + 80 });
        const result = await new Promise((resolve, reject) =>
            execFile(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-Command',
                    `
            Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class FocusEvidence { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra); }';
            [FocusEvidence]::SetProcessDPIAware() | Out-Null
            try {
                [FocusEvidence]::SetCursorPos(${bgPoint.x},${bgPoint.y}) | Out-Null
                [FocusEvidence]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
                [FocusEvidence]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
                Start-Sleep -Milliseconds 200
                $before = [FocusEvidence]::GetForegroundWindow().ToInt64()
                [FocusEvidence]::SetCursorPos(${point.x},${point.y}) | Out-Null
                Start-Sleep -Milliseconds 150
                [FocusEvidence]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
                [FocusEvidence]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
                Start-Sleep -Milliseconds 200
                [PSCustomObject]@{before=$before;after=[FocusEvidence]::GetForegroundWindow().ToInt64()} | ConvertTo-Json -Compress
            } finally { [FocusEvidence]::SetCursorPos(${previous.x},${previous.y}) | Out-Null }
        `,
                ],
                { windowsHide: true },
                (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout)))
            )
        );
        const clicked = await overlay.webContents.executeJavaScript('document.body.dataset.clicked');
        const overlayHandle = Number(overlay.getNativeWindowHandle().readBigUInt64LE());
        // Other always-on-top windows may cover the synthetic background. Verify
        // the actual foreground window, whichever app owned it, stays unchanged.
        const evidence = {
            clicked: clicked === '1',
            retainedForeground: result.before !== 0 && result.before !== overlayHandle && result.after === result.before,
            alwaysOnTop: overlay.isAlwaysOnTop(),
        };
        fs.writeFileSync('logs/focus-evidence.json', JSON.stringify(evidence, null, 2));
        console.log(JSON.stringify(evidence));
        app.exit(Object.values(evidence).every(Boolean) ? 0 : 1);
    } catch (error) {
        console.error(error.message);
        app.exit(1);
    }
});

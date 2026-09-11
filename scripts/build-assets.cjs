const path = require('node:path');
const fs = require('node:fs');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
(async () => {
    await build({
        entryPoints: [path.join(root, 'node_modules/lit/index.js')],
        bundle: true,
        format: 'esm',
        outfile: path.join(root, 'src/assets/lit-core-2.7.4.min.js'),
        minify: true,
    });
    await build({
        entryPoints: [path.join(root, 'node_modules/highlight.js/lib/index.js')],
        bundle: true,
        format: 'iife',
        globalName: 'hljs',
        outfile: path.join(root, 'src/assets/highlight-11.9.0.min.js'),
        minify: true,
    });
    fs.copyFileSync(path.join(root, 'node_modules/marked/lib/marked.umd.js'), path.join(root, 'src/assets/marked-4.3.0.min.js'));
    fs.copyFileSync(path.join(root, 'node_modules/highlight.js/styles/vs2015.min.css'), path.join(root, 'src/assets/highlight-vscode-dark.min.css'));
})().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});

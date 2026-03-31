const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

// Copy a file, creating destination directory if needed
function copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

// Recursively copy a directory
function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Copy static assets
function copyAssets() {
    copyFile('src/sidebar/styles.css', 'out/sidebar/styles.css');
    copyDir('src/default_docs', 'out/default_docs');
}

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'out/index.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node16',
    sourcemap: true,
    logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const sidebarConfig = {
    entryPoints: ['src/sidebar/index.tsx'],
    bundle: true,
    outfile: 'out/sidebar/sidebarApp.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    sourcemap: true,
    logLevel: 'info',
};

async function build() {
    copyAssets();

    if (isWatch) {
        const extensionCtx = await esbuild.context(extensionConfig);
        const sidebarCtx = await esbuild.context(sidebarConfig);
        await Promise.all([extensionCtx.watch(), sidebarCtx.watch()]);
        console.log('Watching for changes...');
    } else {
        await Promise.all([
            esbuild.build(extensionConfig),
            esbuild.build(sidebarConfig),
        ]);
        console.log('Build complete.');
    }
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});

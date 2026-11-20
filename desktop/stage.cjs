// Dependency-free desktop build staging. Does not mutate web/PWA source files.
// Usage: node desktop/stage.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'dist');
fs.mkdirSync(out, {recursive: true});
let html = fs.readFileSync(path.join(root, 'editor.html'), 'utf8').replace(/\r\n/g, '\n');
if (!html.includes('</body>') || !html.includes('async function saveFile()')) {
  throw new Error('Upstream editor layout changed; review the desktop integration.');
}
html = html.replace(/<link rel="manifest"[^>]*>\s*/i, '');
// Desktop must NEVER mirror private on-disk document content to WebView localStorage.
// Browser/PWA retain their original storage behavior because editor.html is untouched.
const webInit = "if (!restoreWorkspace()) {\n  const backups = availableWorkspaceRecoveries();\n  if (!backups.length || !restoreWorkspace(backups[0].raw)) restoreAutosave();\n}\npersistWorkspace();";
if (!html.includes(webInit)) throw new Error('Browser workspace initialization changed; re-audit native isolation.');
html = html.replace(webInit, "if (!window.__TAURI__) {\n" + webInit + "\n}");
html = html.replace(
  "window.addEventListener('pagehide', persistWorkspace);",
  "if (!window.__TAURI__) window.addEventListener('pagehide', persistWorkspace);"
);
html = html.replace(
  "if (document.visibilityState === 'hidden') persistWorkspace();",
  "if (!window.__TAURI__ && document.visibilityState === 'hidden') persistWorkspace();"
);
html = html.replace(
  "window.addEventListener('storage', event => {",
  "window.addEventListener('storage', event => {\n  if (window.__TAURI__) return;"
);
html = html.replace(
  "window.addEventListener('beforeunload', e => {",
  "window.addEventListener('beforeunload', e => {\n  if (window.__TAURI__) return; // native close handler persists session and prompts"
);

html = html.replace('</body>', '<script src="./desktop-bridge.js"></script>\n</body>');
html = html.replace('href="https://github.com/lgg/leaf/releases"', 'id="btn-desktop-releases" href="https://github.com/lgg/leaf/releases"');
html = html.replace(
  '<p class="about-version">',
  '<p id="desktop-update-status" role="status" style="font-size:11px;"></p><button id="btn-desktop-check-updates" type="button" title="Check published GitHub releases">check updates</button><p class="about-version">'
);
if (!html.includes('btn-desktop-check-updates')) throw new Error('Desktop updater UI injection point not found.');
html = html.replace(
  '<button id="btn-save" title="Save file (Ctrl+S)">',
  '<button id="btn-desktop-save-as" title="Save as a new file (Ctrl+Shift+S)">save as</button>\n    <button id="btn-save" title="Save file (Ctrl+S)">'
);
if (!html.includes('btn-desktop-save-as')) throw new Error('Desktop Save As injection point not found.');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(__dirname, 'desktop-bridge.js'), path.join(out, 'desktop-bridge.js'));
for (const name of ['leaf-icon-192.png', 'leaf-icon-512.png']) {
  fs.copyFileSync(path.join(root, name), path.join(out, name));
}
// Windows ICO container with a PNG image; produced only for desktop builds.
const iconDir = path.join(root, 'src-tauri', 'icons');
fs.mkdirSync(iconDir, {recursive: true});
const png = fs.readFileSync(path.join(root, 'leaf-icon-192.png'));
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 192;
header[7] = 192;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(iconDir, 'icon.ico'), Buffer.concat([header, png]));
console.log('Desktop frontend staged (isolated from web/PWA).');

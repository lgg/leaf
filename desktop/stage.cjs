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

// The title bar exists only in the packaged desktop HTML, so web/PWA stays unmodified.
if (!html.includes('<div id="header">') || !html.includes('</head>')) {
  throw new Error('Native titlebar injection anchors are unavailable.');
}
html = html.replace('<div id="header">', "<div id=\"desktop-titlebar\" role=\"toolbar\" aria-label=\"Leaf window controls\">\n  <div id=\"desktop-titlebar-drag\" data-tauri-drag-region aria-label=\"Drag Leaf window\">\n    <img data-tauri-drag-region class=\"desktop-titlebar-icon\" src=\"./leaf-icon-192.png\" alt=\"\" draggable=\"false\">\n    <span data-tauri-drag-region class=\"desktop-titlebar-name\">Leaf</span>\n  </div>\n  <div class=\"desktop-window-actions\" aria-label=\"Window actions\">\n    <button id=\"desktop-window-minimize\" class=\"desktop-window-button\" type=\"button\" title=\"Minimize\" aria-label=\"Minimize\">\n      <svg aria-hidden=\"true\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\"><path d=\"M3 12.5h10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.25\" stroke-linecap=\"round\"/></svg>\n    </button>\n    <button id=\"desktop-window-maximize\" class=\"desktop-window-button\" type=\"button\" title=\"Maximize\" aria-label=\"Maximize\">\n      <svg aria-hidden=\"true\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\"><rect x=\"3.25\" y=\"3.25\" width=\"9.5\" height=\"9.5\" rx=\"0.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.25\"/></svg>\n    </button>\n    <button id=\"desktop-window-close\" class=\"desktop-window-button desktop-window-close\" type=\"button\" title=\"Close\" aria-label=\"Close\">\n      <svg aria-hidden=\"true\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\"><path d=\"M4 4l8 8M12 4l-8 8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"/></svg>\n    </button>\n  </div>\n</div>" + '\n<div id="header">');
html = html.replace('</head>', '<link rel="stylesheet" href="./desktop-titlebar.css">\n</head>');
html = html.replace('</body>', '<script src="./desktop-bridge.js"></script>\n<script src="./desktop-titlebar.js"></script>\n</body>');
html = html.replace('href="https://github.com/lgg/leaf/releases"', 'id="btn-desktop-releases" href="https://github.com/lgg/leaf/releases"');
const aboutUpdateSlot = '<div id="about-desktop-update-slot"></div>';
if (!html.includes(aboutUpdateSlot)) throw new Error('Desktop About settings slot not found.');
html = html.replace(aboutUpdateSlot,
  '<div id="about-desktop-update-slot"><h4 class="settings-mini-heading settings-mini-divider">Windows updates</h4>' +
  '<p id="desktop-update-status" role="status" style="font-size:11px;"></p>' +
  '<button id="btn-desktop-check-updates" type="button" title="Check official GitHub releases">check updates</button>' +
  '<div id="desktop-update-panel" hidden><div id="desktop-update-notes"></div>' +
  '<div class="desktop-update-buttons"><button id="btn-desktop-update-download" type="button">download update</button>' +
  '<button id="btn-desktop-update-install" type="button" hidden>apply update</button></div></div></div>'
);
if (!html.includes('btn-desktop-check-updates')) throw new Error('Desktop updater UI injection point not found.');

html = html.replace(
  '<div id="header">',
  '<aside id="desktop-update-notice" role="status" hidden><span id="desktop-update-notice-text"></span>' +
  '<button id="desktop-update-open" type="button">review update</button>' +
  '<button id="desktop-update-dismiss" type="button" aria-label="Dismiss update notice">×</button></aside><div id="header">'
);
html = html.replace('</head>', '<link rel="stylesheet" href="./desktop-updater.css">\n</head>');
html = html.replace(
  '<button id="btn-save" title="Save file (Ctrl+S)">',
  '<button id="btn-desktop-save-as" title="Save as a new file (Ctrl+Shift+S)">save as</button>\n    <button id="btn-save" title="Save file (Ctrl+S)">'
);
if (!html.includes('btn-desktop-save-as')) throw new Error('Desktop Save As injection point not found.');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(__dirname, 'desktop-bridge.js'), path.join(out, 'desktop-bridge.js'));
for (const name of ['desktop-titlebar.css', 'desktop-titlebar.js', 'desktop-updater.css']) {
  fs.copyFileSync(path.join(__dirname, name), path.join(out, name));
}
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

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('web/PWA editor is self contained; desktop-only files stay separate', () => {
  const html = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(!html.includes('desktop-bridge.js'));
  assert.ok(!sw.includes('desktop-bridge.js'));
  assert.ok(!html.includes('src-tauri'));
  assert.ok(!sw.includes('src-tauri'));
});

test('desktop source bridge parses and implements OS file entry points', () => {
  const source = fs.readFileSync(path.join(root, 'desktop', 'desktop-bridge.js'), 'utf8');
  assert.doesNotThrow(() => new Function(source));
  for (const token of ['desktop_open_dialog','desktop_save','desktop_restore',
    'desktop_save_session', 'nativePath', 'expectedRevision', 'onCloseRequested']) {
    assert.ok(source.includes(token), token);
  }
});

test('Tauri capabilities do not enable unrestricted file system APIs', () => {
  const capability = require('../src-tauri/capabilities/default.json');
  assert.deepEqual(capability.permissions, ['core:default']);
  assert.deepEqual(capability.windows, ['main']);
});

test('Tauri and web release identifiers are coherent', () => {
  const config = require('../src-tauri/tauri.conf.json');
  const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  assert.equal(config.version, '1.10.0');
  assert.match(cargo, /version = "1\.10\.0"/);
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /1\.10\.0-lgg\.1/);
});

test('desktop stage creates offline assets without adding web-only service worker', () => {
  const {execFileSync} = require('node:child_process');
  execFileSync(process.execPath, [path.join(root, 'desktop', 'stage.cjs')]);
  const dist = fs.readFileSync(path.join(root, 'desktop', 'dist', 'index.html'), 'utf8');
  assert.ok(dist.includes('desktop-bridge.js'));
  assert.ok(dist.includes('btn-desktop-save-as'));
  assert.ok(!dist.includes('<link rel="manifest"'));
  assert.ok(!fs.existsSync(path.join(root, 'desktop', 'dist', 'sw.js')));
  const icon = fs.readFileSync(path.join(root, 'src-tauri', 'icons', 'icon.ico'));
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt32LE(18), 22);
});

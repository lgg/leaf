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
  // Documentation may mention Rust paths: only executable desktop imports are excluded.
  assert.ok(!/<script[^>]+src=["'][^"']*(?:desktop-bridge|src-tauri)/i.test(html));
  assert.ok(html.includes("if (!window.__TAURI__ && 'serviceWorker' in navigator"));
  assert.ok(!sw.includes('src-tauri'));
});

test('desktop source bridge parses and implements OS file entry points', () => {
  const source = fs.readFileSync(path.join(root, 'desktop', 'desktop-bridge.js'), 'utf8');
  assert.doesNotThrow(() => new Function(source));
  for (const token of ['desktop_open_dialog','desktop_save','desktop_restore',
    'desktop_save_session', 'desktop_open_path', 'desktop_export_zip', 'desktop_open_external', 'nativePath', 'expectedRevision', 'onCloseRequested']) {
    assert.ok(source.includes(token), token);
  }
});

test('Tauri capabilities do not enable unrestricted file system APIs', () => {
  const capability = require('../src-tauri/capabilities/default.json');
  assert.deepEqual(capability.permissions, ['core:default', 'core:window:allow-destroy']);
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
  assert.ok(dist.includes('btn-desktop-check-updates'));
  assert.ok(!fs.readFileSync(path.join(root, 'editor.html'), 'utf8').includes('btn-desktop-check-updates'));
  assert.ok(dist.includes('id="btn-desktop-releases"'));
  assert.ok(!fs.readFileSync(path.join(root, 'editor.html'), 'utf8').includes('id="btn-desktop-releases"'));

  assert.ok(dist.includes("if (!window.__TAURI__) {\nif (!restoreWorkspace())") ||
    dist.includes("if (!window.__TAURI__) {\n  if (!restoreWorkspace())"));
  assert.ok(dist.includes("if (!window.__TAURI__) window.addEventListener('pagehide', persistWorkspace)"));
  assert.ok(dist.includes("if (!window.__TAURI__ && document.visibilityState === 'hidden')"));
  assert.ok(dist.includes("if (window.__TAURI__) return; // native close handler"));
  // The website keeps the browser persistence path; desktop has separate restoration.
  const web = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
  assert.ok(web.includes("window.addEventListener('pagehide', persistWorkspace);"));
  assert.ok(web.includes("if (!restoreWorkspace()) {"));
  assert.ok(!dist.includes('<link rel="manifest"'));
  assert.ok(!fs.existsSync(path.join(root, 'desktop', 'dist', 'sw.js')));
  const icon = fs.readFileSync(path.join(root, 'src-tauri', 'icons', 'icon.ico'));
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt32LE(18), 22);
});

test('native drop reading requires a prior OS drag/drop authorization', () => {
  const source = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
  assert.ok(source.includes('dropped: Mutex<HashSet<String>>'));
  assert.ok(source.includes('on_webview_event('));
  assert.ok(source.includes('tauri::DragDropEvent::Drop'));
  assert.ok(source.includes('.remove(&key)'));
  assert.ok(source.includes('authorized != expected'));
  assert.ok(source.includes('write_checked('));
});

test('desktop restart preserves a discarded dirty draft as a separate recovery tab', () => {
  const source = fs.readFileSync(path.join(root, 'desktop', 'desktop-bridge.js'), 'utf8');
  const start = source.indexOf('  function restoredTab(');
  const end = source.indexOf('\n  async function restore()', start);
  assert.ok(start >= 0 && end > start);
  const create = result => new Function('confirm', 'workspaceNotice', source.slice(start, end) + ';return restoredTab;')(() => result, () => {});
  const item = {
    saved: {name:'report.md',path:'example-path.md',dirty:true,draft:'my unsaved edit',
      revision:'before',label:'Journal',browserTitle:'Work'},
    disk: {name:'report.md',path:'example-path.md',content:'external change',revision:'after'}
  };
  const recoveries = [];
  const disk = create(false)(item, 1, recoveries);
  assert.equal(disk.content, 'external change');
  assert.equal(disk.dirty, false);
  assert.equal(disk.nativePath, 'example-path.md');
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].content, 'my unsaved edit');
  assert.equal(recoveries[0].dirty, true);
  assert.equal(recoveries[0].nativePath, null);
  assert.match(recoveries[0].name, /recovery/);

  const recovered = [];
  const draft = create(true)(item, 1, recovered);
  assert.equal(draft.content, 'my unsaved edit');
  assert.equal(draft.dirty, true);
  assert.equal(draft.nativePath, null); // external change requires Save As
  assert.equal(recovered.length, 0);

  const sameDisk = structuredClone(item);
  sameDisk.saved.revision = 'after';
  const ordinary = create(true)(sameDisk, 2, []);
  assert.equal(ordinary.nativePath, 'example-path.md');
  assert.equal(ordinary.dirty, true);

  const unknownRevision = structuredClone(item);
  unknownRevision.saved.revision = null;
  const unverified = create(true)(unknownRevision, 3, []);
  assert.equal(unverified.nativePath, null);
});

test('desktop restart never rebinds a removed file to an unsaved draft', () => {
  const source = fs.readFileSync(path.join(root, 'desktop', 'desktop-bridge.js'), 'utf8');
  const start = source.indexOf('  function restoredTab(');
  const end = source.indexOf('\n  async function restore()', start);
  const restoredTab = new Function('confirm', source.slice(start, end) +
    ';return restoredTab;')(() => { throw new Error('Missing files cannot be read from disk'); });
  const missing = restoredTab({
    saved: {name:'lost.md',path:'no-longer-present.md',dirty:true,draft:'important'},
    disk:null, error:'File was moved'
  }, 5, []);
  assert.equal(missing.content, 'important');
  assert.equal(missing.nativePath, null);
  assert.equal(missing.dirty, true);
  assert.equal(missing.name, 'lost.md');
});

test('desktop routes safe external links through OS while rejecting unsupported schemes', () => {
  const bridge = fs.readFileSync(path.join(root, 'desktop', 'desktop-bridge.js'), 'utf8');
  const native = fs.readFileSync(path.join(root, 'src-tauri','src','main.rs'), 'utf8');
  assert.ok(bridge.includes("invoke('desktop_open_external', {url:target})"));
  assert.ok(bridge.includes("link.id === 'btn-desktop-releases'"));
  assert.ok(bridge.includes("event.stopImmediatePropagation()"));
  assert.ok(native.includes('fn permitted_external_url('));
  assert.ok(native.includes('parsed.username().is_empty()'));
  assert.ok(native.includes('"mailto"'));
});

test('native file saves preserve original CRLF style', () => {
  const bridge = fs.readFileSync(path.join(root, 'desktop','desktop-bridge.js'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'src-tauri','src','main.rs'), 'utf8');
  assert.ok(bridge.includes("lineEnding: tab.nativeEol || 'lf'"));
  assert.ok(bridge.includes("tab.nativeEol = doc.lineEnding || 'lf'"));
  assert.ok(backend.includes('fn apply_line_ending('));
  assert.ok(backend.includes('fn source_line_endings_are_preserved_through_normalized_textarea_edits()'));
});

test('About distinguishes embedded README help from the actual changelog', () => {
  const html = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
  assert.ok(html.includes('>README</a>'));
  assert.ok(html.includes('https://github.com/lgg/leaf/blob/main/CHANGELOG.md'));
  assert.ok(html.includes('https://github.com/lgg/leaf/releases'));
});

test('Windows release binaries are gated against real/embedded host paths', () => {
  const {countLeaks} = require('../desktop/check-binary.cjs');
  const synthetic = 'C:\\Users\\Example\\.cargo\\registry\\src\\crate.rs';
  assert.ok(countLeaks(Buffer.from(synthetic, 'utf8'), {}) > 0);
  assert.ok(countLeaks(Buffer.from(synthetic, 'utf16le'), {}) > 0);
  assert.ok(countLeaks(Buffer.from('D:\\build\\.cargo\\registry\\src\\file.rs'), {}) > 0);
  assert.ok(countLeaks(Buffer.concat([Buffer.from('a'),Buffer.from(synthetic, 'utf16le')]), {}) > 0);
  assert.ok(countLeaks(Buffer.from('D:\\build\\repo\\src\\main.rs'), {GITHUB_WORKSPACE:'D:\\build\\repo'}) > 0);
  assert.equal(countLeaks(Buffer.from('Windows build. Source maps: /leaf-source/lib.rs'), {}), 0);
});

test('desktop session persists through native commands only and migrates older previews safely', () => {
  const bridge = fs.readFileSync(path.join(root,'desktop','desktop-bridge.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(bridge.includes("invoke('desktop_save_session', {session: snapshot})"));
  assert.ok(bridge.includes("scheduleWorkspaceSave = function () {\n    scheduleSession();"));
  assert.ok(!bridge.includes('browserSchedule()'));
  assert.ok(bridge.includes('typeof restoreWorkspace === \'function\' && restoreWorkspace()'));
  assert.ok(bridge.includes('tab.nativePath = null;'));
  assert.ok(bridge.includes('if (!tab.readonly) tab.dirty = true;'));
});

test('desktop dirty tabs offer Save, Discard and Cancel without affecting web behavior', () => {
  const html = fs.readFileSync(path.join(root, 'editor.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(html.includes("if (!answer && window.leafDesktop &&"));
  assert.ok(html.includes("!confirm('Discard unsaved changes in"));
  assert.ok(html.includes("if (answer) {\n      // Switch to it and save"));
});

test('Windows CI blocks public binaries until private-path scanning passes', () => {
  const yaml = fs.readFileSync(path.join(root, '.github/workflows/desktop-windows.yml'), 'utf8');
  const scan = yaml.indexOf('Verify compiled EXE contains no private workstation paths');
  const binaryUpload = yaml.indexOf('Retain Windows binary for smoke testing');
  const portableUpload = yaml.indexOf('Retain portable ZIP for smoke testing');
  assert.ok(scan > 0 && binaryUpload > scan && portableUpload > scan);
  assert.ok(yaml.includes('CARGO_ENCODED_RUSTFLAGS'));
  assert.ok(yaml.includes('node desktop/check-binary.cjs src-tauri/target/release/leaf-desktop.exe'));
  assert.ok(yaml.includes('retention-days: 1'));
  assert.ok(!yaml.includes('pull_request:'));
  assert.ok(yaml.includes('leaf-runner-ci'));
});

test('binary privacy diagnostic labels reveal no raw host folders', () => {
  const {privatePathCategories} = require('../desktop/check-binary.cjs');
  const fake = Buffer.from('D:\\Users\\SampleUser\\.cargo\\registry\\src\\x.rs');
  const categories = privatePathCategories(fake, {USERPROFILE:'D:\\Users\\SampleUser', CARGO_HOME:'D:\\Users\\SampleUser\\.cargo'});
  assert.ok(categories.includes('profile-directory'));
  assert.ok(categories.includes('cargo-cache'));
  assert.ok(categories.includes('environment:USERPROFILE'));
  assert.ok(categories.includes('environment:CARGO_HOME'));
  assert.ok(!categories.join(',').includes('SampleUser'));
  assert.ok(!categories.join(',').includes('D:'));
});

test('desktop intercepts legacy browser recovery UI without persisting native files to localStorage', () => {
  const bridge = fs.readFileSync(path.join(root,'desktop','desktop-bridge.js'), 'utf8').replace(/\r\n/g,'\n');
  assert.ok(bridge.includes('persistWorkspace = function () {};'));
  assert.ok(bridge.includes('refreshRecoveryControl = function () {'));
  assert.ok(bridge.includes("event.stopImmediatePropagation();"));
  assert.ok(bridge.includes("const backupCopies = typeof availableWorkspaceRecoveries"));
  assert.ok(bridge.includes("nativePath: null, nativeRev: null, nativeEol: 'lf'"));
  assert.ok(!bridge.includes('browserSchedule()'));
});

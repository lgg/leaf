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
  assert.ok(html.includes("if (!isLeafNativeDesktop() && 'serviceWorker' in navigator"));
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
  assert.deepEqual(capability.permissions, ['core:default', 'core:window:allow-destroy',
    'core:window:allow-close', 'core:window:allow-minimize',
    'core:window:allow-toggle-maximize', 'core:window:allow-is-maximized',
    'core:window:allow-start-dragging']);
  assert.deepEqual(capability.windows, ['main']);
});

test('Tauri and web release identifiers are coherent', () => {
  const config = require('../src-tauri/tauri.conf.json');
  const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  assert.equal(config.version, '1.11.2');
  assert.match(cargo, /version = "1\.11\.2"/);
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /1\.11\.2-lgg\.1/);
});

test('desktop stage creates offline assets without adding web-only service worker', () => {
  const {execFileSync} = require('node:child_process');
  execFileSync(process.execPath, [path.join(root, 'desktop', 'stage.cjs')]);
  const dist = fs.readFileSync(path.join(root, 'desktop', 'dist', 'index.html'), 'utf8');
  assert.ok(dist.includes('desktop-bridge.js'));
  assert.ok(dist.includes('id="desktop-titlebar"'));
  // The portable ZIP and installed Setup share this exact staged UI: the PWA
  // installer must remain hidden even if WebView2 fires beforeinstallprompt.
  assert.ok(dist.includes('data-leaf-desktop="true"'));
  assert.ok(dist.includes('id="leaf-native-install-guard"'));
  assert.match(dist, /#install-group, body\[data-leaf-desktop="true"\] #btn-install \{ display:none !important; \}/);
  assert.ok(dist.includes('function isLeafNativeDesktop()'));
  assert.ok(dist.includes("if (isLeafNativeDesktop()) {"));
  const webEditor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
  assert.ok(!webEditor.includes('data-leaf-desktop="true"'));
  assert.ok(!webEditor.includes('id="leaf-native-install-guard"'));
  assert.ok(dist.includes('data-tauri-drag-region'));
  assert.ok(dist.includes('desktop-titlebar.css'));
  assert.ok(dist.includes('desktop-titlebar.js'));
  assert.ok(!fs.readFileSync(path.join(root, 'editor.html'), 'utf8').includes('desktop-titlebar.js'));
  assert.ok(dist.includes('btn-desktop-save-as'));
  assert.ok(dist.includes('btn-desktop-check-updates'));
  assert.ok(dist.includes('id="settings-panel-about"'));
  const aboutSection = dist.slice(dist.indexOf('id="settings-panel-about"'), dist.indexOf('<!-- About Modal -->'));
  assert.ok(aboutSection.includes('id="btn-desktop-check-updates"'), 'updater controls live in Settings About');
  assert.ok(aboutSection.includes('id="desktop-update-panel"'));
  assert.ok(dist.includes('id="about-install-type"'));
  assert.ok(dist.includes('id="about-dialog-install-type"'));
  assert.ok(dist.includes('id="chk-about-show-startup"'));
  assert.ok(dist.includes('id="about-dialog-version"'));
  assert.ok(dist.includes('const SETTINGS_TAB_NAMES = Array.from('), 'all six settings tabs must be interactive');
  assert.ok(dist.includes('id="about-dialog-version">v1.11.2-lgg.1'), 'welcome popup must have actual new version');
  assert.ok(dist.includes('id="about-current-version">v1.11.2-lgg.1'), 'Settings About must have current version');
  const popup = dist.slice(dist.indexOf('<!-- About Modal -->'),dist.indexOf('<script>',dist.indexOf('<!-- About Modal -->')));
  assert.ok(popup.includes('original repository') && popup.includes('fork repository'), 'welcome popup credits must not regress');
  assert.ok(!popup.includes('Version, repositories and updates are in Settings'));
  assert.ok(!popup.includes('buy me a coffee') && !popup.includes('buy Dan a coffee'));
  const original = aboutSection.indexOf('Original Leaf by Dan');
  const coffee = aboutSection.indexOf('>buy Dan a coffee</a>');
  assert.ok(original >= 0 && coffee > original && coffee-original < 500, 'support link stays beside original repository');

  assert.ok(dist.includes('id="settings-panel-about"'));
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
  assert.ok(html.includes('<button type="button" id="btn-about-readme">README</button>'));
  assert.ok(html.includes("document.getElementById('btn-about-readme').addEventListener('click'"));
  assert.ok(html.includes('<button id="btn-about-dialog-readme" type="button">README</button>'));
  assert.ok(html.includes('id="about-dialog-version"'));
  assert.ok(html.includes('id="about-dialog-install-type"'));
  const popup=html.split('<!-- About Modal -->')[1].split('<script>')[0];
  assert.ok(!popup.includes('buy me a coffee'));
  assert.ok(!popup.includes('buy Dan a coffee'));
  assert.ok(html.includes('>buy Dan a coffee</a>'));

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
  assert.ok(html.includes("if (!answer && !confirm('Discard unsaved changes in"));
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

test('merged main and trusted desktop branches use the privacy-gated self-hosted Windows runner', () => {
  const yaml = fs.readFileSync(path.join(root, '.github/workflows/desktop-windows.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(yaml.includes("branches: ['main', 'desktop/**', 'release/**']"));
  assert.ok(yaml.includes('workflow_dispatch:'));
  assert.ok(yaml.includes('runs-on: [self-hosted, leaf-runner-ci]'));
  assert.ok(yaml.includes('permissions:' + String.fromCharCode(10) + '  contents: read'));
  assert.ok(!yaml.includes('actions: write'));
  assert.ok(!yaml.includes('cleanup-known-unsafe-artifacts'));
  assert.ok(!yaml.includes('needs: cleanup-known-unsafe-artifacts'));
  assert.ok(!yaml.includes('pull_request:'));
  const scan = yaml.indexOf('Verify compiled EXE contains no private workstation paths');
  const upload = yaml.indexOf('Retain Windows binary for smoke testing');
  assert.ok(scan > 0 && upload > scan);
});

test('closing a tab does not discard edits typed while an asynchronous save is in progress', async () => {
  const html = fs.readFileSync(path.join(root,'editor.html'),'utf8');
  const start = html.indexOf('async function closeTab(');
  const end = html.indexOf("\ndocument.getElementById('btn-new-tab')", start);
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start,end);
  assert.ok(source.indexOf('const afterSave = tabs.find') > source.indexOf('await saveFile()'));
  const openTabs = [{id:1,name:'draft.md',content:'latest edit',dirty:true}];
  const harness = new Function('tabs','window','confirm','switchTab','saveFile','workspaceNotice',
    'let activeTabId = 1; let isDirty = true; ' + source +
    '; return {closeTab, getTabs: () => tabs};')(
      openTabs, {leafDesktop:true}, () => true, () => {},
      async () => true, () => {}
    );
  await harness.closeTab(1);
  assert.equal(harness.getTabs().length,1);
  assert.equal(harness.getTabs()[0].content,'latest edit');
});

test('native save calls are serialized so concurrent file writes cannot use stale revisions', async () => {
  const source = fs.readFileSync(path.join(root,'desktop','desktop-bridge.js'),'utf8');
  const start = source.indexOf('  function queuedSave(');
  const end = source.indexOf('\n  function restoredTab(', start);
  assert.ok(start >= 0 && end > start);
  const code = source.slice(start,end);
  assert.ok(source.includes('save: () => queuedSave(false)'));
  assert.ok(source.includes('saveAs: () => queuedSave(true)'));
  let active = 0;
  const observed = [];
  const call = new Function('save', 'let saveQueue = Promise.resolve(); ' + code +
    '; return queuedSave;')(async saveAs => {
      active++;
      assert.equal(active, 1, 'overlapping native writes are forbidden');
      observed.push(saveAs ? 'save-as-start' : 'save-start');
      await new Promise(resolve => setImmediate(resolve));
      observed.push(saveAs ? 'save-as-end' : 'save-end');
      active--;
      return true;
    });
  assert.deepEqual(await Promise.all([call(false),call(true)]),[true,true]);
  assert.deepEqual(observed,['save-start','save-end','save-as-start','save-as-end']);
});

test('privacy-gated smoke-test artifacts remain available for a seven-day manual acceptance window', () => {
  const yaml = fs.readFileSync(path.join(root,'.github/workflows/desktop-windows.yml'),'utf8');
  const scan = yaml.indexOf('Verify compiled EXE contains no private workstation paths');
  const binary = yaml.indexOf('Retain Windows binary for smoke testing');
  const portable = yaml.indexOf('Retain portable ZIP for smoke testing');
  assert.ok(scan > 0 && binary > scan && portable > scan);
  assert.match(yaml.slice(binary, portable), /retention-days: 7/);
  assert.match(yaml.slice(portable), /retention-days: 7/);
});

test('privacy diagnostics report only numeric counts, never workstation paths', () => {
  const {sanitizedLeakCounts} = require('../desktop/check-binary.cjs');
  const synthetic = 'D:' + String.fromCharCode(92) + 'Users' + String.fromCharCode(92) +
    'SyntheticPerson' + String.fromCharCode(92) + '.cargo' +
    String.fromCharCode(92) + 'registry' + String.fromCharCode(92) + 'src';
  const stats = sanitizedLeakCounts(Buffer.concat([
    Buffer.from(synthetic,'utf8'), Buffer.from(synthetic,'utf16le'),
    Buffer.from('/leaf-source/source.rs /cargo-cache/crate.rs', 'utf8')
  ]));
  assert.ok(stats.singleByte.profile > 0);
  assert.ok(stats.singleByte.cargo > 0);
  assert.ok(stats.utf16.profile > 0 || stats.utf16Offset.profile > 0);
  assert.ok(stats.singleByte.remappedSource > 0);
  assert.ok(stats.singleByte.remappedCargo > 0);
  assert.ok(!JSON.stringify(stats).includes('SyntheticPerson'));
  assert.ok(!JSON.stringify(stats).includes('Users'));
});

test('Windows CI verifies Rust path remapping before expensive native compilation', () => {
  const yaml = fs.readFileSync(path.join(root, '.github/workflows/desktop-windows.yml'), 'utf8');
  assert.ok(yaml.includes("$profileIndex = 0"));
  assert.ok(yaml.includes('Get-ChildItem -LiteralPath $root -Directory -Force'));
  assert.ok(yaml.includes('Sort-Object { $_.Source.Length }'));
  assert.ok(yaml.includes("Join-Path $directory.FullName '.cargo'"));
  assert.ok(!yaml.includes("Target='/sanitized-profiles-c'"));
  assert.ok(yaml.includes('leaf-privacy-canary.rs'));
  assert.ok(yaml.includes('leaf-privacy-canary.exe'));
  assert.ok(yaml.includes('fn main() { println!("{}", file!()); }'));
  const probe = yaml.indexOf('Rust path remapping canary passed');
  const build = yaml.indexOf("@('build','--release','--manifest-path'");
  assert.ok(probe > 0 && build > probe, 'fail early before the full Windows release build');
  assert.ok(yaml.includes('node desktop/check-binary.cjs $probeExe'));
  assert.ok(yaml.includes('node desktop/check-binary.cjs src-tauri/target/release/leaf-desktop.exe'));
  assert.ok(!yaml.includes('pull_request:'));
});

test('Rust path remap selection never leaves a bare Windows profile username behind', () => {
  const yaml = fs.readFileSync(path.join(root,'.github/workflows/desktop-windows.yml'), 'utf8');
  assert.ok(yaml.includes('Source=$directory.FullName'));
  assert.ok(yaml.includes('Target="/private-profile-$profileIndex"'));
  assert.ok(yaml.includes('Target="/private-cargo-$profileIndex"'));
  assert.ok(yaml.includes('Target="/private-rustup-$profileIndex"'));
  // File paths are supplied as runtime variables, not hardcoded workstation paths.
  assert.ok(!yaml.includes('Source=\'C:\\Users\''));
  assert.ok(yaml.indexOf('Sort-Object { $_.Source.Length }') <
    yaml.indexOf('foreach ($pair in $prefixes)'));
});

test('profile-path diagnostics distinguish a PDB linker record without exposing identities', () => {
  const {sanitizedProfilePathKinds} = require('../desktop/check-binary.cjs');
  const prefix = 'C:' + String.fromCharCode(92) + 'Users' + String.fromCharCode(92) +
    'ExamplePerson' + String.fromCharCode(92);
  const codeView = Buffer.concat([
    Buffer.from('RSDS'), Buffer.alloc(20),
    Buffer.from(prefix + 'leaf-desktop.pdb'), Buffer.from([0])
  ]);
  const rustSource = Buffer.from(prefix + 'src' + String.fromCharCode(92) + 'lib.rs');
  const summary = sanitizedProfilePathKinds(Buffer.concat([codeView,rustSource]));
  assert.equal(summary.codeViewPdb, 1);
  assert.ok(summary.rustSource >= 1);
  assert.ok(!JSON.stringify(summary).includes('ExamplePerson'));
  assert.ok(!JSON.stringify(summary).includes('leaf-desktop'));
});

test('Windows linker is configured to avoid embedding absolute PDB paths', () => {
  const yaml = fs.readFileSync(path.join(root,'.github/workflows/desktop-windows.yml'),'utf8');
  assert.ok(yaml.includes("Select-String '^host:'"));
  assert.ok(yaml.includes("Contains('windows-msvc')"));
  assert.ok(yaml.includes('link-arg=/PDBALTPATH:%_PDB%'));
  const flags = yaml.indexOf('link-arg=/PDBALTPATH:%_PDB%');
  const build = yaml.indexOf("@('build','--release','--manifest-path'");
  assert.ok(flags > 0 && build > flags);
});

test('unsigned PE source metadata cleanup only rewrites one read-only Rust path', () => {
  const {sanitizeRustPathMetadata} = require('../desktop/sanitize-binary.cjs');
  const {countLeaks} = require('../desktop/check-binary.cjs');
  function syntheticPe() {
    const bytes = Buffer.alloc(2048);
    bytes.write('MZ', 0, 'ascii');
    bytes.writeUInt32LE(0x80, 0x3c);
    bytes.write('PE\0\0', 0x80, 'ascii');
    bytes.writeUInt16LE(1, 0x86); // COFF number of sections
    bytes.writeUInt16LE(0xe0, 0x94); // PE optional header size
    bytes.writeUInt16LE(0x20b, 0x98); // x64 PE+
    const section = 0x80 + 24 + 0xe0;
    bytes.write('.rdata', section, 'ascii');
    bytes.writeUInt32LE(0x400, section + 16);
    bytes.writeUInt32LE(0x200, section + 20);
    bytes.writeUInt32LE(0x40000040, section + 36);
    return bytes;
  }
  const input = syntheticPe();
  const path = 'C:' + String.fromCharCode(92) + 'Users' +
    String.fromCharCode(92) + 'SyntheticUser' + String.fromCharCode(92) +
    'repository' + String.fromCharCode(92) + 'src' +
    String.fromCharCode(92) + 'main.rs';
  input.write(path, 0x280, 'ascii');
  const fixed = sanitizeRustPathMetadata(input);
  assert.equal(fixed.replacements, 1);
  assert.equal(fixed.bytes.length, input.length);
  assert.equal(countLeaks(fixed.bytes, {}), 0);
  assert.equal(countLeaks(input, {}), 1);
  assert.ok(!fixed.bytes.toString('latin1').includes('SyntheticUser'));
  assert.equal(input.toString('latin1', 0x280, 0x280 + path.length), path);
  assert.deepEqual(sanitizeRustPathMetadata(fixed.bytes).bytes, fixed.bytes);
  const executableSection = Buffer.from(input);
  const section = 0x80 + 24 + 0xe0;
  executableSection.writeUInt32LE(0x60000020, section + 36);
  assert.throws(() => sanitizeRustPathMetadata(executableSection), /read-only/);
  const signed = Buffer.from(input);
  signed.writeUInt32LE(128, 0x98 + 112 + 4 * 8 + 4);
  assert.throws(() => sanitizeRustPathMetadata(signed), /signed/);
  const ambiguous = Buffer.from(input);
  ambiguous.write(path, 0x400, 'ascii');
  assert.throws(() => sanitizeRustPathMetadata(ambiguous), /Ambiguous/);
});

test('privacy-gated PE cleanup must precede the unchanged independent binary scan', () => {
  const yaml = fs.readFileSync(path.join(root,'.github/workflows/desktop-windows.yml'),'utf8');
  const sanitizer = yaml.indexOf('node desktop/sanitize-binary.cjs src-tauri/target/release/leaf-desktop.exe');
  const scanner = yaml.indexOf('node desktop/check-binary.cjs src-tauri/target/release/leaf-desktop.exe');
  const upload = yaml.indexOf('Retain Windows binary for smoke testing');
  assert.ok(sanitizer > 0 && scanner > sanitizer && upload > scanner);
  assert.ok(yaml.includes('if ($LASTEXITCODE -ne 0) { throw "Private path scan failed'));
});

test('opening an already-open file refreshes clean tabs but preserves dirty edits', () => {
  const bridge = fs.readFileSync(path.join(root,'desktop','desktop-bridge.js'),'utf8');
  const start = bridge.indexOf('  function refreshCleanTabFromDisk(');
  const end = bridge.indexOf('\n  function showDocument(', start);
  assert.ok(start >= 0 && end > start);
  const refresh = new Function(bridge.slice(start,end) +
    ';return refreshCleanTabFromDisk;')();
  const disk = {path:'synthetic.md',name:'synthetic.md',content:'new disk text',revision:'next-revision',lineEnding:'crlf'};
  const clean = {content:'old text',name:'synthetic.md',nativeRev:'old-revision',nativeEol:'lf',dirty:false};
  assert.equal(refresh(clean,disk),true);
  assert.equal(clean.content,'new disk text');
  assert.equal(clean.nativeRev,'next-revision');
  assert.equal(clean.nativeEol,'crlf');
  assert.equal(refresh(clean,disk),false);
  const dirty = {content:'valuable unsaved edits',nativeRev:'old-revision',dirty:true};
  assert.equal(refresh(dirty,disk),false);
  assert.equal(dirty.content,'valuable unsaved edits');
  assert.equal(dirty.nativeRev,'old-revision');
  const open = bridge.slice(end,bridge.indexOf('\n  async function open(',end));
  assert.ok(open.indexOf('switchTab(existing.id)') < open.indexOf('refreshCleanTabFromDisk(existing, doc)'));
});

test('native close blocks duplicate requests until recovery is flushed and permits retry on failure', async () => {
  const bridge = fs.readFileSync(path.join(root,'desktop','desktop-bridge.js'),'utf8');
  const start = bridge.indexOf('win.onCloseRequested(async event => {');
  const end = bridge.indexOf('}).catch(() => {});',start);
  assert.ok(start >= 0 && end > start);
  const source = bridge.slice(start, end + 2);
  const create = new Function('win','tabs','confirm','saveActiveTabState','flushSession','alert','safeError',
    'let closing=false,updateApproved=false; ' + source + '; return () => closing;');
  let callback;
  let discarded = 0;
  let prevented = 0;
  let destroyed = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const win = {
    onCloseRequested(handler) { callback = handler; return {catch() {}}; },
    async destroy() { destroyed++; }
  };
  const closing = create(win,[{dirty:true}],() => {discarded++; return true;},
    () => {},() => pending,() => {},String);
  const evt = () => ({preventDefault() {prevented++;}});
  const first = callback(evt());
  const duplicate = callback(evt());
  assert.equal(prevented, 2, 'both OS close events must be intercepted');
  assert.equal(discarded, 1, 'prompt once while a close is pending');
  assert.equal(destroyed, 0);
  assert.equal(closing(), true);
  release();
  await Promise.all([first,duplicate]);
  assert.equal(destroyed, 1);

  let secondHandler;
  let errors = 0;
  let attempts = 0;
  const failed = create({
    onCloseRequested(handler) {secondHandler=handler;return {catch() {}};},
    async destroy() {throw Error('should not destroy');}
  },[{dirty:false}],() => true,()=>{},async () => {
    attempts++;
    if (attempts === 1) throw Error('session write failed');
  },()=>{errors++;},String);
  await secondHandler(evt());
  assert.equal(errors,1);
  assert.equal(failed(),false);
  // The user can attempt to close again after the session error.
  await secondHandler(evt());
  assert.equal(attempts,2);
});

test('a failed desktop restore blocks native session writes and prevents closing with unsaved drafts', async () => {
  const bridge = fs.readFileSync(path.join(root,'desktop','desktop-bridge.js'),'utf8');
  assert.ok(bridge.includes('sessionRecoveryBlocked = true'));
  assert.ok(bridge.includes('if (restoring || sessionRecoveryBlocked) return pendingSession'));
  assert.ok(bridge.includes('if (restoring || sessionRecoveryBlocked) return;'));
  const start = bridge.indexOf('  async function flushSession() {');
  const end = bridge.indexOf('\n  // Reuse editor change notifications', start);
  assert.ok(start >= 0 && end > start);
  const code = bridge.slice(start,end);
  const factory = new Function('tabs','saveActiveTabState','clearTimeout','storeSession',
    'let sessionTimer=null;let sessionRecoveryBlocked=true;' + code + ';return flushSession;');
  let attempts=0;
  const dirty = factory([{readonly:false,dirty:true,nativePath:null,content:'draft'}],
    ()=>{},()=>{},()=>{attempts++;return Promise.resolve();});
  await assert.rejects(dirty(),/Use Save As/);
  assert.equal(attempts,0);
  const clean = factory([{readonly:false,dirty:false,nativePath:'synthetic.md',content:'saved'}],
    ()=>{},()=>{},()=>{attempts++;return Promise.resolve();});
  await clean();
  assert.equal(attempts,0,'unreadable original recovery file must not be overwritten');
});

test('Windows GUI acceptance fixture commands never overwrite edited or non-fixture documents', () => {
  const os = require('node:os');
  const fixtures = require('../desktop/acceptance-fixtures.cjs');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-qa-'));
  const dir = path.join(parent, 'synthetic');
  try {
    fixtures.createFixtures(dir);
    assert.throws(() => fixtures.createFixtures(dir), /EEXIST/);
    assert.ok(fs.readFileSync(path.join(dir, '02-crlf.md'), 'utf8').includes('\r\n'));
    assert.equal(fixtures.verifyState(dir).originalSaveAsUnchanged, true);
    assert.equal(fixtures.verifyState(dir).conflictSimulated, false);
    fixtures.simulateExternalEdit(dir);
    assert.equal(fixtures.verifyState(dir).conflictSimulated, true);
    assert.throws(() => fixtures.simulateExternalEdit(dir), /Refusing to overwrite/);
    fixtures.simulateReopenRefresh(dir);
    fixtures.simulateMissingFile(dir);
    assert.deepEqual(fixtures.verifyState(dir), {
      originalSaveAsUnchanged: true, crlfPreserved: true,
      conflictSimulated: true, cleanReopenSimulated: true, missingFileSimulated: true
    });
    const nonFixture = path.join(parent, 'personal');
    fs.mkdirSync(nonFixture);
    fs.writeFileSync(path.join(nonFixture,'04-external-conflict.md'), 'DO NOT TOUCH');
    assert.throws(() => fixtures.simulateExternalEdit(nonFixture));
    assert.equal(fs.readFileSync(path.join(nonFixture,'04-external-conflict.md'),'utf8'), 'DO NOT TOUCH');
  } finally { fs.rmSync(parent, {recursive: true, force: true}); }
});



test('custom Leaf titlebar is desktop-only, safe, theme-aware and frameless', () => {
  const config = require('../src-tauri/tauri.conf.json');
  const capabilities = require('../src-tauri/capabilities/default.json');
  const stage = fs.readFileSync(path.join(root,'desktop','stage.cjs'),'utf8');
  const html = fs.readFileSync(path.join(root,'editor.html'),'utf8');
  const styles = fs.readFileSync(path.join(root,'desktop','desktop-titlebar.css'),'utf8');
  const logic = fs.readFileSync(path.join(root,'desktop','desktop-titlebar.js'),'utf8');
  assert.equal(config.app.windows[0].decorations, false);
  assert.ok(stage.includes('desktop-titlebar.css'));
  assert.ok(stage.includes('desktop-titlebar.js'));
  assert.ok(!html.includes('desktop-titlebar'));
  for (const p of ['core:window:allow-close','core:window:allow-minimize','core:window:allow-toggle-maximize']) {
    assert.ok(capabilities.permissions.includes(p),p);
  }
  for (const id of ['desktop-window-minimize','desktop-window-maximize','desktop-window-close']) {
    assert.ok(stage.includes('desktop-titlebar'),id);
    assert.ok(logic.includes(id),id);
  }
  assert.ok(styles.includes('background: var(--surface)'));
  assert.ok(styles.includes('color: var(--text)'));
  assert.ok(styles.includes('body.focus-mode #desktop-titlebar { display: none; }'));
  assert.ok(logic.includes('appWindow.close()'));
  assert.ok(!logic.includes('appWindow.destroy()'));
  assert.ok(logic.includes('appWindow.toggleMaximize()'));
  assert.ok(logic.includes('appWindow.minimize()'));
  assert.doesNotThrow(() => new Function(logic));
});


test('native Windows updater checks prereleases and requires separate download and install approval', () => {
  const rust = fs.readFileSync(path.join(root,'src-tauri','src','desktop_updater.rs'),'utf8');
  const helper = fs.readFileSync(path.join(root,'desktop','windows-update-agent.ps1'),'utf8');
  const bridge = fs.readFileSync(path.join(root,'desktop','desktop-bridge.js'),'utf8');
  const stage = fs.readFileSync(path.join(root,'desktop','stage.cjs'),'utf8');
  const main = fs.readFileSync(path.join(root,'src-tauri','src','main.rs'),'utf8');
  const updateCss = fs.readFileSync(path.join(root,'desktop','desktop-updater.css'),'utf8');
  const release = fs.readFileSync(path.join(root,'.github','workflows','windows-preview-release.yml'),'utf8');
  assert.match(rust, /CURRENT_TAG: &str = "v1\.11\.2-lgg\.1-windows-rc\.1"/);
  for (const action of ['desktop_check_update','desktop_download_update','desktop_apply_update']) {
    assert.ok(main.includes('desktop_updater::'+action));
    assert.ok(bridge.includes("'"+action+"'"));
  }
  assert.ok(helper.includes('/releases?per_page=40'));
  assert.ok(!helper.includes('/releases/latest'));
  assert.ok(helper.includes('Leaf-Windows-10-11-x64-Setup.exe'));
  assert.ok(helper.includes('Leaf-Windows-10-11-x64-Portable.zip'));
  assert.ok(helper.includes('[IO.File]::Replace'));
  assert.ok(helper.includes('Wait-Process -Id $WaitPid'));
  assert.ok(helper.includes('Start-Process -FilePath $Package'));
  // CREATE_NO_WINDOW applies to all three native PowerShell interactions:
  // check, download and the detached final apply helper. WindowStyle Hidden
  // alone previously still flashed a full-sized blue console.
  assert.ok(rust.includes('use std::os::windows::process::CommandExt;'));
  assert.ok(rust.includes('const CREATE_NO_WINDOW: u32 = 0x0800_0000;'));
  assert.equal(rust.split('.creation_flags(CREATE_NO_WINDOW)').length-1, 2,
    'both synchronous checks/downloads and asynchronous apply must hide the console');
  assert.ok(helper.includes("if ($Mode -eq 'Apply')"));
  assert.ok(bridge.includes('setTimeout(() => { checkUpdates(false)'));
  assert.ok(bridge.includes('await flushSession()'));
  assert.ok(bridge.includes('await tauri.window.getCurrentWindow().close()'));
  assert.ok(bridge.includes('updateApproved = true'));
  assert.ok(bridge.includes('if (!updateApproved && tabs.some'));
  assert.ok(main.includes('desktop_updater::desktop_installation_mode'));
  assert.ok(rust.includes('fn desktop_installation_mode() -> Result<String,String>'));
  assert.ok(bridge.includes("'desktop_installation_mode'"));
  assert.ok(bridge.includes("openAboutSettings()"));
  assert.ok(stage.includes('desktop-update-notice'));
  assert.ok(stage.includes('desktop-update-panel'));
  assert.ok(stage.includes('desktop-updater.css'));
  assert.ok(updateCss.includes('#desktop-update-panel'));
  assert.ok(!fs.readFileSync(path.join(root,'editor.html'),'utf8').includes('id="desktop-update-panel"'));
  assert.ok(release.includes('TAG_NAME: v1.11.2-lgg.1-windows-rc.1'));
  assert.ok(release.includes('Clear release staging directories before downloading'));
  assert.ok(release.includes("Remove-Item -LiteralPath $folder -Recurse -Force"));
  assert.equal(release.split('merge-multiple: true').length-1,2);
  assert.ok(release.includes('Nested artifact folders would hide the actual producer packages'));
  assert.ok(release.includes('byte-identical to a previously published release'));
  assert.ok(release.includes('Published release hash is inconsistent with the successful current Windows build.'));
  assert.doesNotThrow(() => new Function(bridge));
});

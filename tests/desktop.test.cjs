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

test('only trusted self-hosted workflow runs purge known unsafe historical previews', () => {
  const yaml = fs.readFileSync(path.join(root, '.github/workflows/desktop-windows.yml'), 'utf8');
  assert.ok(yaml.includes('cleanup-known-unsafe-artifacts:'));
  assert.ok(yaml.includes('needs: cleanup-known-unsafe-artifacts'));
  assert.ok(yaml.includes('runs-on: [self-hosted, leaf-runner-ci]'));
  assert.ok(yaml.includes('actions: write'));
  assert.ok(yaml.includes('44502496572, 44508372448'));
  assert.ok(yaml.includes("artifact.name -notin @('leaf-windows-smoke-test', 'leaf-windows-portable-smoke-test')"));
  assert.ok(yaml.includes('Method DELETE'));
  assert.ok(yaml.includes('Select-Object -Unique'));
  assert.ok(!yaml.includes('pull_request:'));
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

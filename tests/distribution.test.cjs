'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('platform packaging configuration preserves the same product and version', () => {
  const base = JSON.parse(read('src-tauri/tauri.conf.json'));
  const linux = JSON.parse(read('src-tauri/tauri.linux.conf.json'));
  const mac = JSON.parse(read('src-tauri/tauri.macos.conf.json'));
  assert.equal(base.productName, 'Leaf');
  assert.equal(base.version, '1.11.1');
  assert.ok(base.bundle.targets.includes('nsis'));
  assert.deepEqual(linux.bundle.targets, ['deb','appimage']);
  assert.deepEqual(mac.bundle.targets, ['app','dmg']);
  assert.equal(mac.bundle.macOS.signingIdentity, '-');
});

test('builds stay self-hosted and never automatically distribute unverified binaries', () => {
  const win = read('.github/workflows/desktop-windows.yml');
  const linux = read('.github/workflows/desktop-linux.yml');
  const mac = read('.github/workflows/desktop-macos.yml');
  assert.match(win, /leaf-runner-ci/);
  assert.match(linux, /leaf-linux-ci/);
  assert.match(mac, /leaf-runner-macos-ci/);
  for (const workflow of [linux, mac]) {
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /refs\/heads\/main/);
    assert.doesNotMatch(workflow, /ubuntu-latest|macos-latest|windows-latest/);
  }
  assert.match(win, /Verify compiled EXE contains no private workstation paths/);
  assert.match(win, /inputs\.build_installer/);
  assert.doesNotMatch(win, /ubuntu-latest|macos-latest|windows-latest/);
});

test('Windows 10/11 preview installer requires no new runner installations and is integrity-gated', () => {
  const win = read('.github/workflows/desktop-windows.yml');
  const release = read('.github/workflows/windows-preview-release.yml');
  const installer = read('desktop/windows-installer.cs');
  const builder = read('desktop/build-windows-installer.ps1');
  assert.match(installer, /ExpectedSha256/);
  assert.match(installer, /VerifyPayload/);
  assert.match(installer, /Registry.CurrentUser.CreateSubKey/);
  assert.match(installer, /Environment.SpecialFolder.LocalApplicationData/);
  assert.match(builder, /CSharpCodeProvider/);
  assert.match(builder, /IncludeDebugInformation = \$false/);
  assert.match(win, /Retain unsigned Windows user installer for Release/);
  assert.ok(win.indexOf('Verify compiled EXE contains no private workstation paths') < win.indexOf('Build unsigned Windows 10\/11 user installer'));
  assert.match(release, /workflow_run:/);
  assert.match(release, /head_branch == 'main'/);
  assert.match(release, /leaf-runner-ci/);
  assert.match(release, /leaf-windows-user-setup/);
  // GitHub Actions retry attempts keep older upload-artifact assets on the
  // same workflow run. Verify producer's latest successful attempt and download
  // each immutable artifact ID, never ambiguous duplicate names.
  assert.match(release, /run\.run_started_at/);
  assert.match(release, /DateTimeOffset\]::Parse\(\$_\.created_at\)/);
  assert.match(release, /candidates\.Count -ne 1/);
  assert.match(release, /steps\.verify-producer\.outputs\.portable_artifact_id/);
  assert.match(release, /steps\.verify-producer\.outputs\.setup_artifact_id/);
  assert.match(release, /artifact-ids:/);
  assert.match(release, /AppendAllText/);
  // Regression: publisher on persistent self-hosted workspace previously
  // read leftover release-input/portable/*.zip instead of the actual new
  // artifact nested one level deeper by download-artifact.
  assert.match(release, /Clear release staging directories before downloading/);
  assert.match(release, /Remove-Item -LiteralPath \$folder -Recurse -Force/);
  assert.equal((release.match(/merge-multiple: true/g) || []).length, 2);
  assert.match(release, /Nested artifact folders would hide the actual producer packages/);
  assert.match(release, /byte-identical to a previously published release/);
  assert.match(release, /Published release hash is inconsistent with the successful current Windows build/);
  assert.doesNotMatch(release, /name: leaf-windows-portable-smoke-test\s*\n\s*run-id:/);
  assert.match(release, /Leaf-Windows-10-11-x64-Portable.zip/);
  assert.match(release, /Leaf-Windows-10-11-x64-Setup.exe/);
  assert.match(release, /prerelease=\$true/);
  assert.doesNotMatch(release, /ubuntu-latest|macos-latest|windows-latest/);
});

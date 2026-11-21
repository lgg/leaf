/* Synthetic, opt-in Windows acceptance workspace. No real user files are read. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_WORKSPACE = path.join(__dirname, 'acceptance-workspace');
const MARKER = 'leaf-synthetic-acceptance-v1';
const CONTENTS = Object.freeze({
  '01-save-in-place.md': '# Leaf synthetic save test\n\nReplace this paragraph and save.\n',
  '02-crlf.md': '# Leaf CRLF test\r\n\r\nEdit this line; preserve CRLF.\r\n',
  '03-save-as-original.md': '# Original for Save As\n\nThis original must remain untouched.\n',
  '04-external-conflict.md': '# External conflict\n\nOriginal disk revision.\n',
  '05-reopen-clean.md': '# Reopen clean tab\n\nOld disk revision.\n',
  '06-missing-on-restart.md': '# Missing file recovery\n\nKeep unsaved draft in Leaf.\n',
  '07-plain-text.txt': 'Leaf synthetic plain-text test.\n',
  '08-links.md': '# Link test\n\n[Safe](https://example.org)\n\n[Blocked](javascript:alert(1))\n'
});
const MUTATED = Object.freeze({
  '04-external-conflict.md': '# External conflict\n\nEXTERNALLY CHANGED — do not overwrite.\n',
  '05-reopen-clean.md': '# Reopen clean tab\n\nNEW DISK CONTENT — reopening a clean tab must refresh this.\n'
});
const MOVED = '06-moved-external.md';
const MARKER_NAME = 'LEAF-SYNTHETIC-FIXTURES.json';

function file(dir, name) { return path.join(dir, name); }
function requireWorkspace(dir) {
  const entry = fs.lstatSync(dir);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Fixture workspace must be a real directory.');
  const marker = JSON.parse(fs.readFileSync(file(dir, MARKER_NAME), 'utf8'));
  if (marker?.id !== MARKER) throw new Error('Not a Leaf synthetic acceptance workspace.');
}
function createFixtures(dir = DEFAULT_WORKSPACE) {
  // Refuse existing directories, including symlinks: never overwrite drafts.
  fs.mkdirSync(dir, {recursive: false});
  fs.writeFileSync(file(dir, MARKER_NAME), JSON.stringify({id: MARKER, note: 'Synthetic test files only'}, null, 2) + '\n', {flag: 'wx'});
  for (const [name, contents] of Object.entries(CONTENTS)) {
    fs.writeFileSync(file(dir, name), contents, {flag: 'wx'});
  }
}
function ensureOriginal(dir, name) {
  requireWorkspace(dir);
  const target = file(dir, name);
  const info = fs.lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Not a regular synthetic fixture.');
  if (!fs.readFileSync(target).equals(Buffer.from(CONTENTS[name], 'utf8'))) {
    throw new Error('Synthetic fixture was edited. Refusing to overwrite it.');
  }
  return target;
}
function simulateExternalEdit(dir = DEFAULT_WORKSPACE) {
  const target = ensureOriginal(dir, '04-external-conflict.md');
  fs.writeFileSync(target, MUTATED['04-external-conflict.md']);
}
function simulateReopenRefresh(dir = DEFAULT_WORKSPACE) {
  const target = ensureOriginal(dir, '05-reopen-clean.md');
  fs.writeFileSync(target, MUTATED['05-reopen-clean.md']);
}
function simulateMissingFile(dir = DEFAULT_WORKSPACE) {
  const source = ensureOriginal(dir, '06-missing-on-restart.md');
  const destination = file(dir, MOVED);
  if (fs.existsSync(destination)) throw new Error('Moved fixture already exists; no overwrite attempted.');
  fs.renameSync(source, destination);
}
function verifyState(dir = DEFAULT_WORKSPACE) {
  requireWorkspace(dir);
  const read = name => { try { return fs.readFileSync(file(dir, name)); } catch { return null; } };
  const same = (name, expected) => read(name)?.equals(Buffer.from(expected,'utf8')) === true;
  const crlf = read('02-crlf.md');
  return {
    originalSaveAsUnchanged: same('03-save-as-original.md', CONTENTS['03-save-as-original.md']),
    crlfPreserved: !!crlf && crlf.includes(Buffer.from('\r\n')) &&
      !crlf.toString('utf8').replace(/\r\n/g, '').includes('\n'),
    conflictSimulated: same('04-external-conflict.md', MUTATED['04-external-conflict.md']),
    cleanReopenSimulated: same('05-reopen-clean.md', MUTATED['05-reopen-clean.md']),
    missingFileSimulated: !read('06-missing-on-restart.md') &&
      same(MOVED, CONTENTS['06-missing-on-restart.md'])
  };
}
function main(argv) {
  const cmd = argv[0];
  if (!['init', 'conflict', 'refresh', 'move', 'verify'].includes(cmd) || argv.length !== 1) {
    process.stderr.write('Usage: node desktop/acceptance-fixtures.cjs init|conflict|refresh|move|verify\n');
    return 2;
  }
  try {
    if (cmd === 'init') createFixtures();
    else if (cmd === 'conflict') simulateExternalEdit();
    else if (cmd === 'refresh') simulateReopenRefresh();
    else if (cmd === 'move') simulateMissingFile();
    else {
      const report = verifyState();
      for (const [name, ok] of Object.entries(report)) {
        process.stdout.write((ok ? 'PASS: ' : 'NOT YET VERIFIED: ') + name + '\n');
      }
      return Object.values(report).every(Boolean) ? 0 : 1;
    }
    process.stdout.write('Synthetic fixture action completed. Personal files were not accessed.\n');
    return 0;
  } catch (e) {
    // Do not echo OS exception messages: they can contain account identifiers.
    const message = e.code === 'EEXIST' ? 'workspace already exists.' :
      e.code === 'ENOENT' ? 'required synthetic fixture is missing.' :
      e.message === 'Synthetic fixture was edited. Refusing to overwrite it.' ? e.message :
      'fixture validation or filesystem operation failed.';
    process.stderr.write('Fixture action stopped safely: ' + message + '\n');
    return 1;
  }
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = {DEFAULT_WORKSPACE, CONTENTS, MUTATED, MOVED, createFixtures,
  simulateExternalEdit, simulateReopenRefresh, simulateMissingFile, verifyState, main};

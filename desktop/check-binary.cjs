'use strict';
// Release gate: reject user/runner-specific Windows paths in shipped executables.
// Deliberately never print matching bytes or actual machine paths.
const fs = require('node:fs');

const dangerous = [
  /[a-z]:[\\/](?:users|documents and settings)[\\/]/i,
  /[a-z]:[\\/]_work[\\/]/i,
  /[\\/]\.cargo[\\/](?:registry|git)[\\/]/i,
  /[\\/]\.rustup[\\/]toolchains[\\/]/i
];
const environmentKeys = [
  'GITHUB_WORKSPACE','RUNNER_WORKSPACE','RUNNER_TEMP','USERPROFILE',
  'LOCALAPPDATA','APPDATA','CARGO_HOME','RUSTUP_HOME'
];

function privatePathCategories(bytes, env = process.env) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const contents = [
    raw.toString('latin1'),
    raw.toString('utf16le'),
    raw.subarray(1).toString('utf16le')
  ];
  const labels = ['profile-directory', 'runner-workspace', 'cargo-cache', 'rust-toolchain'];
  const found = new Set();
  for (const text of contents) {
    for (let i = 0; i < dangerous.length; i++) {
      if (dangerous[i].test(text)) found.add(labels[i]);
    }
    const lower = text.toLowerCase();
    for (const key of environmentKeys) {
      const path = env[key];
      if (typeof path !== 'string' || path.length < 6) continue;
      const normalized = path.replace(/[\\/]+/g, '\\').replace(/[\\/]$/, '').toLowerCase();
      if (lower.includes(normalized) || lower.includes(normalized.replace(/\\/g, '/'))) {
        found.add('environment:' + key);
      }
    }
    if (env.HOMEDRIVE && env.HOMEPATH) {
      const home = String(env.HOMEDRIVE + env.HOMEPATH).replace(/[\\/]+/g, '\\').toLowerCase();
      if (lower.includes(home) || lower.includes(home.replace(/\\/g, '/'))) found.add('environment:HOME');
    }
  }
  return [...found].sort();
}

// Emit numeric diagnostics only. Never include matched bytes, source paths,
// usernames, directory names or file offsets in public workflow logs.
function sanitizedLeakCounts(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const views = {
    singleByte: raw.toString('latin1'),
    utf16: raw.toString('utf16le'),
    utf16Offset: raw.subarray(1).toString('utf16le')
  };
  const labels = ['profile', 'runner', 'cargo', 'rustup'];
  const result = {};
  for (const [encoding, source] of Object.entries(views)) {
    const totals = {};
    for (let i = 0; i < dangerous.length; i++) {
      const pattern = new RegExp(dangerous[i].source, 'gi');
      totals[labels[i]] = [...source.matchAll(pattern)].length;
    }
    // Remapped compiler paths are safe to disclose as numerical totals only.
    totals.remappedSource = source.split('/leaf-source').length - 1;
    totals.remappedCargo = source.split('/cargo-cache').length - 1;
    result[encoding] = totals;
  }
  return result;
}

// Classify a residual profile path without emitting its content, name,
// source offset, or filename. One leftover CodeView PDB can otherwise disclose
// the Windows account even after every crate source path is remapped.
function sanitizedProfilePathKinds(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const ascii = raw.toString('latin1');
  const counts = {codeViewPdb: 0, otherPdb: 0, rustSource: 0, buildMetadata: 0, other: 0};
  for (const match of ascii.matchAll(/[a-z]:[\\/](?:users|documents and settings)[\\/]/gi)) {
    const offset = match.index;
    const text = ascii.slice(offset, offset + 512).split(/[\\x00-\\x1f]/, 1)[0];
    const codeView = offset >= 24 && raw.toString('ascii', offset - 24, offset - 20) === 'RSDS';
    if (codeView) counts.codeViewPdb++;
    else if (/\\.pdb(?:$|[^a-z0-9])/i.test(text)) counts.otherPdb++;
    else if (/\\.rs(?:$|[^a-z0-9])/i.test(text)) counts.rustSource++;
    else if (/\\.(?:toml|json|exe|dll)(?:$|[^a-z0-9])/i.test(text)) counts.buildMetadata++;
    else counts.other++;
  }
  return counts;
}

function countLeaks(bytes, env = process.env) {
  return privatePathCategories(bytes, env).length;
}

if (require.main === module) {
  if (!process.argv[2]) {
    console.error('Usage: node desktop/check-binary.cjs <relative-executable>');
    process.exitCode = 2;
  } else {
    try {
      const binary = fs.readFileSync(process.argv[2]);
      if (binary.length < 1024 || binary.subarray(0, 2).toString('ascii') !== 'MZ') {
        console.error('Refusing artifact: invalid or unexpectedly small Windows executable.');
        process.exitCode = 1;
      } else {
        const leaks = countLeaks(binary);
        if (leaks) {
          // Print coarse *category names only*, never paths, excerpts or usernames.
          console.error('Release gate failed: Windows binary contains local path markers. Artifacts will NOT be uploaded.');
          console.error('Sanitized detection categories: ' + privatePathCategories(binary).join(', '));
          console.error('Redacted byte-format counts: ' + JSON.stringify(sanitizedLeakCounts(binary)));
          console.error('Redacted profile source kinds: ' + JSON.stringify(sanitizedProfilePathKinds(binary)));
          process.exitCode = 1;
        } else {
          console.log('Windows binary privacy scan passed: no user/runner absolute-path markers.');
        }
      }
    } catch {
      console.error('Could not inspect the Windows binary; artifact upload is blocked.');
      process.exitCode = 1;
    }
  }
}
module.exports = {countLeaks, privatePathCategories, sanitizedLeakCounts, sanitizedProfilePathKinds};

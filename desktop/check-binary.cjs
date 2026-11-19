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
module.exports = {countLeaks, privatePathCategories};

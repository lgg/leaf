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

function countLeaks(bytes, env = process.env) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const contents = [
    raw.toString('latin1'),
    raw.toString('utf16le'),
    raw.subarray(1).toString('utf16le')
  ];
  const specific = environmentKeys.map(key => env[key]).filter(v => typeof v === 'string' && v.length > 5);
  if (env.HOMEDRIVE && env.HOMEPATH) specific.push(env.HOMEDRIVE + env.HOMEPATH);
  let detected = 0;
  for (const text of contents) {
    // Only signal categories and counts, not matched usernames or paths.
    for (const regex of dangerous) if (regex.test(text)) detected++;
    const lower = text.toLowerCase();
    for (const path of specific) {
      const normalized = path.replace(/[\\/]+/g, '\\').replace(/[\\/]$/, '').toLowerCase();
      if (lower.includes(normalized) || lower.includes(normalized.replace(/\\/g, '/'))) detected++;
    }
  }
  return detected;
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
          console.error('Release gate failed: Windows binary contains local user/runner path markers. Artifacts will NOT be uploaded.');
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
module.exports = {countLeaks};

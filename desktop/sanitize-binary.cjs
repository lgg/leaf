'use strict';
// Post-link privacy cleanup for a single Rust file!() source metadata string.
// Only unsigned PE read-only data is eligible. Never log path bytes.
// A failed/ambiguous cleanup never bypasses the independent release scanner.
const fs = require('node:fs');

function sourceMatches(binary) {
  const bytes = Buffer.isBuffer(binary) ? binary : Buffer.from(binary);
  const ascii = bytes.toString('latin1');
  const expression = /[a-z]:[\\/](?:users|documents and settings)[\\/](?:[a-z0-9_.() -]+[\\/])+[a-z0-9_.() -]+\.rs(?=$|[^a-z0-9_.])/gi;
  return [...ascii.matchAll(expression)].map(match => ({
    offset: match.index, length: match[0].length
  }));
}

function readOnlyPeSections(binary) {
  const bytes = Buffer.isBuffer(binary) ? binary : Buffer.from(binary);
  const size = bytes.length;
  function valid(offset, count) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + count > size) {
      throw new Error('Invalid PE section or header boundary.');
    }
  }
  valid(0, 64);
  if (bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Not a Windows executable.');
  const pe = bytes.readUInt32LE(0x3c);
  valid(pe, 24);
  if (bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0') {
    throw new Error('Invalid PE signature.');
  }
  const sectionCount = bytes.readUInt16LE(pe + 6);
  const optionalSize = bytes.readUInt16LE(pe + 20);
  const optional = pe + 24;
  valid(optional, optionalSize);
  if (sectionCount < 1 || sectionCount > 96) throw new Error('Invalid PE section count.');
  const magic = bytes.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error('Unsupported PE architecture.');
  const dataDir = optional + (magic === 0x20b ? 112 : 96);
  if (dataDir + 8 * 5 <= optional + optionalSize) {
    // Never alter Authenticode-signed executables.
    const certificateSize = bytes.readUInt32LE(dataDir + 4 * 8 + 4);
    if (certificateSize) throw new Error('Refusing to edit an already signed executable.');
  }
  const table = optional + optionalSize;
  valid(table, sectionCount * 40);
  const sections = [];
  for (let i = 0; i < sectionCount; i++) {
    const entry = table + i * 40;
    const name = bytes.toString('ascii', entry, entry + 8).replace(/\0.*$/, '');
    const rawSize = bytes.readUInt32LE(entry + 16);
    const rawStart = bytes.readUInt32LE(entry + 20);
    const flags = bytes.readUInt32LE(entry + 36);
    if (rawSize === 0) continue;
    valid(rawStart, rawSize);
    const readable = !!(flags & 0x40000000);
    const executable = !!(flags & 0x20000000);
    const writable = !!(flags & 0x80000000);
    if (name === '.rdata' && readable && !executable && !writable) {
      sections.push({start:rawStart,end:rawStart + rawSize});
    }
  }
  if (!sections.length) throw new Error('Expected PE read-only data section is unavailable.');
  return sections;
}

function sanitizeRustPathMetadata(binary) {
  const bytes = Buffer.isBuffer(binary) ? binary : Buffer.from(binary);
  const matches = sourceMatches(bytes);
  if (!matches.length) return {bytes:Buffer.from(bytes), replacements:0};
  if (matches.length !== 1) {
    throw new Error('Ambiguous source metadata; the privacy gate must remain closed.');
  }
  const regions = readOnlyPeSections(bytes);
  const match = matches[0];
  if (!regions.some(region =>
    match.offset >= region.start && match.offset + match.length <= region.end
  )) {
    throw new Error('Private Rust source metadata is outside PE read-only data.');
  }
  const prefix = 'leaf-redacted-source-';
  const ending = '.rs';
  if (match.length < prefix.length + ending.length) {
    throw new Error('Private Rust source metadata cannot be safely replaced.');
  }
  const safeName = prefix + '_'.repeat(match.length - prefix.length - ending.length) + ending;
  const result = Buffer.from(bytes);
  result.write(safeName, match.offset, match.length, 'ascii');
  if (sourceMatches(result).length) {
    throw new Error('Private source metadata still remains after sanitizing.');
  }
  return {bytes:result,replacements:1};
}

if (require.main === module) {
  try {
    const filename = process.argv[2];
    if (!filename) throw new Error('Missing candidate executable.');
    const original = fs.readFileSync(filename);
    const fixed = sanitizeRustPathMetadata(original);
    if (fixed.replacements) {
      // Same-length metadata rewrite; all binary offsets remain unchanged.
      fs.writeFileSync(filename, fixed.bytes);
    }
    console.log('Read-only Rust source metadata cleanup completed (count: ' + fixed.replacements + ').');
  } catch {
    console.error('Unable to clean residual Rust source metadata; EXE upload remains blocked.');
    process.exitCode = 1;
  }
}
module.exports = {sourceMatches, readOnlyPeSections, sanitizeRustPathMetadata};

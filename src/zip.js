// Minimal zero-dependency ZIP writer (STORE / no compression). Used as the
// export fallback for browsers without showDirectoryPicker (Firefox, Safari):
// instead of dumping N loose files into Downloads, we emit one .zip that
// unzips into the proper <prefix>_export_<datetime>/ folder.
// DOM-free + pure, so it can be unit-tested headlessly.
'use strict';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// entries: [ [name, Uint8Array], ... ] — names may include "/" for subfolders.
// Returns a Uint8Array of the complete ZIP archive.
export function makeZip(entries) {
  const enc = new TextEncoder();
  const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  const fileChunks = [];   // local headers + names + data, in order
  const central = [];      // central-directory records
  let offset = 0;          // running offset = local header position of next entry

  for (const [name, data] of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const size = data.length;
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),                     // mod time, mod date (fixed 0)
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0),
    ]);
    fileChunks.push(local, nameBytes, data);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),                     // mod time, mod date
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),          // disk #, internal/external attrs
      ...u32(offset),
      ...nameBytes,
    ]));
    offset += local.length + nameBytes.length + size;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const rec of central) cdSize += rec.length;

  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(cdStart), ...u16(0),
  ]);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of fileChunks) { out.set(c, pos); pos += c.length; }
  for (const c of central) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}

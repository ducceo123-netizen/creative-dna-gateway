/** Reviewed adaptation of Studio's bounded, store-only ZIP writer.
 * Unlike Studio's export, canonical Onepage roots contain spaces/Unicode.
 * No filesystem extraction, compression, ZIP64, encryption, or arbitrary archive input.
 */
export type ZipEntry = { name: string; bytes: Buffer };
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY = 32 * 1024 * 1024;
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}
export function crc32(bytes: Buffer) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function safeName(name: string) {
  if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 500 ||
      name.startsWith('/') || /[\\\x00-\x1f\x7f:]/.test(name) ||
      name.split('/').some(p => !p || p === '.' || p === '..')) throw Error('UNSAFE_ZIP_ENTRY');
}
export function writeStoredZip(entries: ZipEntry[]): Buffer {
  if (!Array.isArray(entries) || !entries.length || entries.length > 24) throw Error('ZIP_ENTRY_COUNT');
  const names = new Set<string>(), local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0, total = 0;
  for (const entry of entries) {
    safeName(entry.name);
    if (names.has(entry.name)) throw Error('DUPLICATE_ZIP_ENTRY');
    names.add(entry.name);
    const body = entry.bytes;
    if (!Buffer.isBuffer(body) || !body.length || body.length > MAX_ENTRY || (total += body.length) > MAX_BYTES) throw Error('ZIP_BYTE_LIMIT');
    const name = Buffer.from(entry.name), checksum = crc32(body), header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt32LE(checksum, 16); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(body.length, 24);
    dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name); offset += header.length + name.length + body.length;
  }
  const centralLength = central.reduce((sum, b) => sum + b.length, 0), footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0); footer.writeUInt16LE(entries.length, 8); footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(centralLength, 12); footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, footer]);
}
/** Reopens actual bytes, checking both directories, names, sizes and every CRC. */
export function readStoredZip(bytes: Buffer): ZipEntry[] {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_BYTES + 64 * 1024) throw Error('ZIP_BYTE_LIMIT');
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 20)) throw Error('ZIP_FOOTER');
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralStart = bytes.readUInt32LE(end + 16);
  if (!count || count > 24 || bytes.readUInt16LE(end + 8) !== count || centralStart + centralSize !== end) throw Error('ZIP_DIRECTORY');
  const entries: ZipEntry[] = [], names = new Set<string>();
  let cursor = centralStart, localCursor = 0, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw Error('ZIP_CENTRAL_HEADER');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16), size = bytes.readUInt32LE(cursor + 20), rawSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), offset = bytes.readUInt32LE(cursor + 42);
    if (flags !== 0x0800 || method || extra || comment || bytes.readUInt16LE(cursor + 34) || size !== rawSize || !size || size > MAX_ENTRY || (total += size) > MAX_BYTES || offset !== localCursor || !nameLength || cursor + 46 + nameLength > end) throw Error('ZIP_UNSUPPORTED_OR_INVALID_ENTRY');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    safeName(name);
    if (names.has(name)) throw Error('DUPLICATE_ZIP_ENTRY');
    names.add(name);
    if (offset + 30 + nameLength + size > centralStart || bytes.readUInt32LE(offset) !== 0x04034b50 ||
        bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method ||
        bytes.readUInt32LE(offset + 14) !== checksum || bytes.readUInt32LE(offset + 18) !== size || bytes.readUInt32LE(offset + 22) !== rawSize ||
        bytes.readUInt16LE(offset + 26) !== nameLength || bytes.readUInt16LE(offset + 28) || !bytes.subarray(offset + 30, offset + 30 + nameLength).equals(nameBytes)) throw Error('ZIP_LOCAL_CENTRAL_MISMATCH');
    const body = bytes.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    if (crc32(body) !== checksum) throw Error('ZIP_CRC_MISMATCH');
    entries.push({ name, bytes: Buffer.from(body) });
    localCursor = offset + 30 + nameLength + size; cursor += 46 + nameLength;
  }
  if (cursor !== end || localCursor !== centralStart) throw Error('ZIP_UNEXPECTED_BYTES');
  return entries;
}

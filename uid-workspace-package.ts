import { createHash } from 'node:crypto';
import { z } from 'zod';
import { preflightAsset, ASSET_LIMITS } from './uid-asset-preflight.ts';
import { ONEPAGE_DELIVERY_ROLES, onepagePackagePaths, validateOnepagePackagePaths } from './supabase/functions/_shared/onepage-packaging.ts';

/** Offline worker-only packaging. NOT an authorization boundary, storage adapter, or
 * EO/visual approval. Before invoking, a production adapter must authenticate task
 * ownership and independently verify current source, content, pixel, and artistic
 * approval evidence. Load expectations from trusted immutable records, never HTTP
 * input. Revision strings and hashes bind bytes; they do not prove those approvals.
 * This module performs no network, filesystem, provider, upload, or live mutation.
 */
export const WORKSPACE_PACKAGE_LIMITS = Object.freeze({
  archive_bytes: 256 * 1024 * 1024,
  file_bytes: ASSET_LIMITS.bytes,
  pixels: ASSET_LIMITS.pixels,
  files: 19,
  path_bytes: 1024,
});
const id = z.string().min(1).max(200).refine(s => s === s.trim() && !/[\x00-\x1f\x7f]/.test(s));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const dimension = z.number().int().min(1).max(ASSET_LIMITS.pixels);
const scopeSchema = z.object({
  task_id: id, snapshot_id: id, content_revision: id, canonical_version: id,
  template_version: id, render_hash: hash,
}).strict();
const expectedImageSchema = z.object({
  revision_id: id, sha256: hash, width: dimension, height: dimension,
}).strict();
const expectedAssetSchema = expectedImageSchema.extend({ canonical_slot: id, mime_type: z.literal('image/webp') }).strict();
const expectedMappingSchema = expectedImageSchema.extend({ mime_type: z.literal('image/png') }).strict();
const expectationSchema = z.object({
  scope: scopeSchema,
  product_line_name: z.string().min(1).max(160),
  product_slug: z.string().min(1).max(160),
  section: z.enum(['gtk', 'faq']),
  assets: z.array(expectedAssetSchema).min(1).max(WORKSPACE_PACKAGE_LIMITS.files - 1),
  mapping: expectedMappingSchema,
}).strict();
const bytesSchema = z.custom<Buffer>(value => Buffer.isBuffer(value) && value.length > 0 && value.length <= WORKSPACE_PACKAGE_LIMITS.file_bytes, 'INVALID_ASSET_BYTES');
const workerAssetSchema = z.object({
  canonical_slot: id, revision_id: id, content_revision: id,
  mime_type: z.literal('image/webp'), bytes: bytesSchema,
}).strict();
const workerMappingSchema = z.object({
  revision_id: id, scope: scopeSchema, mime_type: z.literal('image/png'), bytes: bytesSchema,
}).strict();
const inputSchema = z.object({
  expected: expectationSchema,
  assets: z.array(workerAssetSchema).min(1).max(WORKSPACE_PACKAGE_LIMITS.files - 1),
  mapping: workerMappingSchema,
}).strict();
export type WorkspacePackageScope = z.infer<typeof scopeSchema>;
export type WorkspacePackageExpectation = z.infer<typeof expectationSchema>;
export type WorkspacePackageInput = z.infer<typeof inputSchema>;
export type WorkspacePackageInventoryEntry = {
  path: string; canonical_slot: string; revision_id: string; sha256: string;
  mime_type: 'image/webp' | 'image/png'; byte_length: number; crc32: string;
  width: number; height: number;
};
type ZipEntry = { path: string; bytes: Buffer };
type ExpectedEntry = Omit<WorkspacePackageInventoryEntry, 'byte_length' | 'crc32'>;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const failure = (code: string): never => { throw new Error(code); };
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let n = index;
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function safePath(path: string): void {
  if (!path || Buffer.byteLength(path) > WORKSPACE_PACKAGE_LIMITS.path_bytes || path.startsWith('/') || /[\\:\x00-\x1f\x7f]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' '))) failure('UNSAFE_PACKAGE_PATH');
  // Reject ill-formed Unicode, which UTF-8 encoding would otherwise silently replace.
  if (Buffer.from(path, 'utf8').toString('utf8') !== path) failure('INVALID_PACKAGE_PATH_ENCODING');
}
function expectedEntries(expected: WorkspacePackageExpectation): ExpectedEntry[] {
  const paths = onepagePackagePaths(expected.product_line_name, expected.product_slug, expected.section);
  paths.forEach(safePath);
  const slots = Object.keys(ONEPAGE_DELIVERY_ROLES).filter(slot => expected.section === 'gtk' || !slot.startsWith('gtk_'));
  const bySlot = new Map(expected.assets.map(asset => [asset.canonical_slot, asset]));
  if (bySlot.size !== expected.assets.length) failure('DUPLICATE_EXPECTED_SLOT');
  if (expected.assets.some(asset => !slots.includes(asset.canonical_slot))) failure('UNEXPECTED_EXPECTED_SLOT');
  if (slots.some(slot => !bySlot.has(slot))) failure('MISSING_EXPECTED_SLOT');
  const entries: ExpectedEntry[] = slots.map((slot, index) => ({ ...bySlot.get(slot)!, path: paths[index] }));
  entries.push({ ...expected.mapping, canonical_slot: 'mapping', path: paths.at(-1)! });
  if (entries.some(entry => entry.width * entry.height > WORKSPACE_PACKAGE_LIMITS.pixels)) failure('PACKAGE_PIXEL_LIMIT');
  return entries;
}
function sameScope(a: WorkspacePackageScope, b: WorkspacePackageScope): boolean {
  return Object.keys(a).every(key => a[key as keyof WorkspacePackageScope] === b[key as keyof WorkspacePackageScope]);
}

/** ZIP32, STORE only, fixed DOS epoch, UTF-8 names, no extras/comments/permissions.
 * Avoids clocks, compression versions, input ordering, filesystem metadata and paths.
 * The strict reader below intentionally supports this bounded package format only,
 * not arbitrary third-party ZIPs or ZIP64/encrypted/deflated archives.
 */
function writeZip(entries: ZipEntry[]): Buffer {
  if (!entries.length || entries.length > WORKSPACE_PACKAGE_LIMITS.files) failure('ZIP_ENTRY_LIMIT');
  const local: Buffer[] = [], central: Buffer[] = [];
  const seen = new Set<string>();
  let offset = 0, centralSize = 0;
  for (const entry of entries) {
    safePath(entry.path);
    if (seen.has(entry.path)) failure('DUPLICATE_ZIP_PATH');
    seen.add(entry.path);
    if (!entry.bytes.length || entry.bytes.length > WORKSPACE_PACKAGE_LIMITS.file_bytes) failure('ZIP_FILE_BYTE_LIMIT');
    const name = Buffer.from(entry.path, 'utf8'), crc = crc32(entry.bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(0x0021, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(entry.bytes.length, 18); header.writeUInt32LE(entry.bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8); directory.writeUInt16LE(0x0021, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(entry.bytes.length, 20); directory.writeUInt32LE(entry.bytes.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    offset += header.length + name.length + entry.bytes.length;
    centralSize += directory.length + name.length;
    if (offset + centralSize + 22 > WORKSPACE_PACKAGE_LIMITS.archive_bytes) failure('ZIP_ARCHIVE_BYTE_LIMIT');
    local.push(header, name, entry.bytes); central.push(directory, name);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end], offset + centralSize + 22);
}
function readZip(archive: Buffer): ZipEntry[] {
  if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.length > WORKSPACE_PACKAGE_LIMITS.archive_bytes) failure('ZIP_ARCHIVE_BYTE_LIMIT');
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== 0x06054b50 || archive.readUInt16LE(end + 20) !== 0) failure('INVALID_ZIP_END');
  const count = archive.readUInt16LE(end + 10), size = archive.readUInt32LE(end + 12), start = archive.readUInt32LE(end + 16);
  if (archive.readUInt16LE(end + 4) || archive.readUInt16LE(end + 6) || archive.readUInt16LE(end + 8) !== count) failure('UNSUPPORTED_MULTIDISK_ZIP');
  if (!count || count > WORKSPACE_PACKAGE_LIMITS.files) failure('ZIP_ENTRY_LIMIT');
  if (start + size !== end) failure('INVALID_ZIP_DIRECTORY_BOUNDS');
  const entries: ZipEntry[] = [], seen = new Set<string>();
  let cursor = start, localCursor = 0, totalBytes = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50) failure('INVALID_ZIP_DIRECTORY');
    const nameLength = archive.readUInt16LE(cursor + 28);
    const compressed = archive.readUInt32LE(cursor + 20), length = archive.readUInt32LE(cursor + 24);
    const crc = archive.readUInt32LE(cursor + 16), offset = archive.readUInt32LE(cursor + 42);
    if (!nameLength || nameLength > WORKSPACE_PACKAGE_LIMITS.path_bytes || cursor + 46 + nameLength > end) failure('ZIP_PATH_BOUNDS');
    if (archive.readUInt16LE(cursor + 4) !== 20 || archive.readUInt16LE(cursor + 6) !== 20 || archive.readUInt16LE(cursor + 8) !== 0x0800 || archive.readUInt16LE(cursor + 10) !== 0 || archive.readUInt16LE(cursor + 12) !== 0 || archive.readUInt16LE(cursor + 14) !== 0x0021 || archive.readUInt16LE(cursor + 30) || archive.readUInt16LE(cursor + 32) || archive.readUInt16LE(cursor + 34) || archive.readUInt16LE(cursor + 36) || archive.readUInt32LE(cursor + 38)) failure('UNSUPPORTED_ZIP_FEATURE');
    if (!length || length > WORKSPACE_PACKAGE_LIMITS.file_bytes || compressed !== length) failure('ZIP_FILE_BYTE_LIMIT');
    totalBytes += length;
    if (totalBytes > WORKSPACE_PACKAGE_LIMITS.archive_bytes) failure('ZIP_ARCHIVE_BYTE_LIMIT');
    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const path = nameBytes.toString('utf8');
    if (!Buffer.from(path, 'utf8').equals(nameBytes)) failure('INVALID_PACKAGE_PATH_ENCODING');
    safePath(path);
    if (seen.has(path)) failure('DUPLICATE_ZIP_PATH');
    seen.add(path);
    // Enforce contiguous, nonoverlapping local entries, no preamble or hidden data.
    if (offset !== localCursor || offset + 30 + nameLength + length > start) failure('INVALID_ZIP_LOCAL_BOUNDS');
    if (archive.readUInt32LE(offset) !== 0x04034b50 || archive.readUInt16LE(offset + 4) !== 20 || archive.readUInt16LE(offset + 6) !== 0x0800 || archive.readUInt16LE(offset + 8) !== 0 || archive.readUInt16LE(offset + 10) !== 0 || archive.readUInt16LE(offset + 12) !== 0x0021 || archive.readUInt32LE(offset + 14) !== crc || archive.readUInt32LE(offset + 18) !== length || archive.readUInt32LE(offset + 22) !== length || archive.readUInt16LE(offset + 26) !== nameLength || archive.readUInt16LE(offset + 28) !== 0 || !archive.subarray(offset + 30, offset + 30 + nameLength).equals(nameBytes)) failure('ZIP_LOCAL_DIRECTORY_MISMATCH');
    const bytes = archive.subarray(offset + 30 + nameLength, offset + 30 + nameLength + length);
    if (crc32(bytes) !== crc) failure('ZIP_CRC_MISMATCH');
    entries.push({ path, bytes });
    localCursor = offset + 30 + nameLength + length;
    cursor += 46 + nameLength;
  }
  if (cursor !== end || localCursor !== start) failure('INVALID_ZIP_TRAILING_DATA');
  return entries;
}
async function verifyImage(entry: ZipEntry, expected: ExpectedEntry): Promise<WorkspacePackageInventoryEntry> {
  if (sha256(entry.bytes) !== expected.sha256) failure('PACKAGE_HASH_MISMATCH');
  const result = await preflightAsset(entry.bytes, { expected_sha256: expected.sha256 });
  if (`image/${result.format}` !== expected.mime_type) failure('PACKAGE_IMAGE_FORMAT_MISMATCH');
  if (result.width !== expected.width || result.height !== expected.height) failure('PACKAGE_IMAGE_DIMENSION_MISMATCH');
  return { ...expected, byte_length: entry.bytes.length, crc32: crc32(entry.bytes).toString(16).padStart(8, '0') };
}

/** Reopen actual ZIP bytes and fully decode every image against the current trusted
 * expectation. Standalone validation remains technical only: no EO/visual claim.
 * This is also the storage adapter's read-back check before enabling downloads.
 */
export async function validateWorkspaceOnepagePackage(bytes: Buffer, expectation: WorkspacePackageExpectation) {
  const expected = expectationSchema.parse(expectation), canonical = expectedEntries(expected);
  // Copy synchronously before awaiting decodes so callers cannot mutate verified bytes.
  if (!Buffer.isBuffer(bytes) || bytes.length > WORKSPACE_PACKAGE_LIMITS.archive_bytes) failure('ZIP_ARCHIVE_BYTE_LIMIT');
  const archive = Buffer.from(bytes), entries = readZip(archive);
  const names = validateOnepagePackagePaths(entries.map(entry => entry.path), expected.product_line_name, expected.product_slug, expected.section);
  if (names.status !== 'VALID_NAMES_ONLY' || entries.length !== canonical.length) failure(`INVALID_PACKAGE_INVENTORY:${names.issues.join(',')}`);
  if (entries.some((entry, index) => entry.path !== canonical[index].path)) failure('NONCANONICAL_PACKAGE_ORDER');
  const inventory: WorkspacePackageInventoryEntry[] = [];
  // Bound decode concurrency to one, with the existing per-image pixel/byte limits.
  for (let i = 0; i < entries.length; i++) inventory.push(await verifyImage(entries[i], canonical[i]));
  const digest = sha256(archive);
  return {
    schema_version: 'uid.workspace-onepage-package.v1' as const,
    status: 'TECHNICAL_PACKAGE_VERIFIED_NOT_EO_APPROVAL' as const,
    artifact_id: `sha256:${digest}`, sha256: digest, byte_length: archive.length,
    mime_type: 'application/zip' as const, scope: expected.scope,
    inventory,
    technical_validation: {
      actual_zip_reopened: true, exact_inventory: true, crc32: 'PASSED',
      sha256: 'PASSED', full_pixel_decode: 'PASSED', format_and_dimensions: 'PASSED',
      revision_binding: 'MATCHES_TRUSTED_EXPECTATION',
    } as const,
    source_content_artistic_approval_verified_here: false as const,
    visual_qc_performed: false as const, eo_approved: false as const,
  };
}

export async function buildWorkspaceOnepagePackage(input: WorkspacePackageInput) {
  const parsed = inputSchema.parse(input), expected = parsed.expected, canonical = expectedEntries(expected);
  const bySlot = new Map(parsed.assets.map(asset => [asset.canonical_slot, asset]));
  if (bySlot.size !== parsed.assets.length) failure('DUPLICATE_WORKER_SLOT');
  const expectedSlots = new Set(expected.assets.map(asset => asset.canonical_slot));
  if (parsed.assets.some(asset => !expectedSlots.has(asset.canonical_slot))) failure('UNEXPECTED_WORKER_SLOT');
  if (expected.assets.some(asset => !bySlot.has(asset.canonical_slot))) failure('MISSING_WORKER_SLOT');
  if (!sameScope(parsed.mapping.scope, expected.scope) || parsed.mapping.revision_id !== expected.mapping.revision_id) failure('STALE_MAPPING_REVISION');
  // Check aggregate size before making private byte copies or allocating the ZIP.
  const estimatedSize = 22 + canonical.reduce((total, entry) => {
    const asset = entry.canonical_slot === 'mapping' ? parsed.mapping : bySlot.get(entry.canonical_slot)!;
    return total + asset.bytes.length + 76 + Buffer.byteLength(entry.path) * 2;
  }, 0);
  if (estimatedSize > WORKSPACE_PACKAGE_LIMITS.archive_bytes) failure('ZIP_ARCHIVE_BYTE_LIMIT');
  const entries: ZipEntry[] = canonical.map(entry => {
    const asset = entry.canonical_slot === 'mapping' ? parsed.mapping : bySlot.get(entry.canonical_slot)!;
    if (asset.revision_id !== entry.revision_id || ('content_revision' in asset && asset.content_revision !== expected.scope.content_revision)) failure('STALE_ASSET_REVISION');
    if (asset.mime_type !== entry.mime_type) failure('PACKAGE_IMAGE_MIME_MISMATCH');
    return { path: entry.path, bytes: Buffer.from(asset.bytes) };
  });
  const bytes = writeZip(entries);
  const result = await validateWorkspaceOnepagePackage(bytes, expected);
  return { ...result, filename: `onepage-${expected.product_slug}.zip`, bytes };
}

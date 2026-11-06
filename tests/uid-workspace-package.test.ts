import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import sharp from '../tools/creative-quality/sharp.ts';
import { ONEPAGE_DELIVERY_ROLES, onepagePackagePaths } from '../supabase/functions/_shared/onepage-packaging.ts';
import {
  buildWorkspaceOnepagePackage, validateWorkspaceOnepagePackage, WORKSPACE_PACKAGE_LIMITS,
  type WorkspacePackageInput,
} from '../uid-workspace-package.ts';

// Deliberately synthetic pixels, not product evidence or artistic approval.
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const images = Promise.all([
  sharp({ create: { width: 16, height: 12, channels: 3, background: '#123456' } }).webp().toBuffer(),
  sharp({ create: { width: 32, height: 24, channels: 4, background: '#abcdef' } }).png().toBuffer(),
]);
async function fixture(section: 'gtk' | 'faq' = 'faq'): Promise<WorkspacePackageInput> {
  const [webp, png] = await images;
  const scope = { task_id: 'task-test', snapshot_id: 'snapshot-2', content_revision: 'content-1', canonical_version: 'canonical-4', template_version: 'template-5', render_hash: 'a'.repeat(64) };
  const slots = Object.keys(ONEPAGE_DELIVERY_ROLES).filter(slot => section === 'gtk' || !slot.startsWith('gtk_'));
  return {
    expected: {
      scope, product_line_name: 'Test Product', product_slug: 'test_product', section,
      assets: slots.map(canonical_slot => ({ canonical_slot, revision_id: `${canonical_slot}-2`, sha256: digest(webp), width: 16, height: 12, mime_type: 'image/webp' })),
      mapping: { revision_id: 'mapping-2', sha256: digest(png), width: 32, height: 24, mime_type: 'image/png' },
    },
    assets: slots.map(canonical_slot => ({ canonical_slot, revision_id: `${canonical_slot}-2`, content_revision: scope.content_revision, mime_type: 'image/webp', bytes: Buffer.from(webp) })),
    mapping: { scope: { ...scope }, revision_id: 'mapping-2', mime_type: 'image/png', bytes: Buffer.from(png) },
  };
}
type Entry = { path: string; bytes: Buffer };
function crc(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
// Independent fixture codec can deliberately write invalid inventories and paths.
function rawZip(entries: Entry[]): Buffer {
  const records: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const { path, bytes } of entries) {
    const name = Buffer.from(path), header = Buffer.alloc(30), dir = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(2048, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc(bytes), 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(2048, 8); dir.writeUInt16LE(33, 14);
    dir.writeUInt32LE(crc(bytes), 16); dir.writeUInt32LE(bytes.length, 20); dir.writeUInt32LE(bytes.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    records.push(header, name, bytes); central.push(dir, name); offset += 30 + name.length + bytes.length;
  }
  const directories = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directories.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, directories, end]);
}
function entries(input: WorkspacePackageInput): Entry[] {
  const paths = onepagePackagePaths(input.expected.product_line_name, input.expected.product_slug, input.expected.section);
  return [...input.assets.map((asset, i) => ({ path: paths[i], bytes: asset.bytes })), { path: paths.at(-1)!, bytes: input.mapping.bytes }];
}
function centralStart(bytes: Buffer) { return bytes.readUInt32LE(bytes.length - 6); }

test('GTK and FAQ produce actual canonical ZIPs, real full decode and no EO claim', async () => {
  for (const section of ['gtk', 'faq'] as const) {
    const input = await fixture(section), out = await buildWorkspaceOnepagePackage(input);
    assert.equal(out.inventory.length, section === 'gtk' ? 19 : 16);
    assert.deepEqual(out.inventory.map(e => e.path), onepagePackagePaths('Test Product', 'test_product', section));
    assert.equal(out.inventory.filter(e => e.canonical_slot.startsWith('gtk_')).length, section === 'gtk' ? 3 : 0);
    assert.ok(!out.inventory.some(e => e.path.includes('occasion_story')));
    assert.equal(out.inventory.at(-1)!.path, 'Onepage - Test Product/onepage_test_product-overall.png');
    assert.equal(out.bytes.readUInt32LE(0), 0x04034b50);
    assert.equal(out.sha256, digest(out.bytes)); assert.equal(out.artifact_id, `sha256:${digest(out.bytes)}`);
    assert.equal(out.byte_length, out.bytes.length); assert.equal(out.mime_type, 'application/zip');
    assert.equal(out.technical_validation.actual_zip_reopened, true);
    assert.equal(out.technical_validation.crc32, 'PASSED'); assert.equal(out.technical_validation.full_pixel_decode, 'PASSED');
    assert.equal(out.eo_approved, false); assert.equal(out.visual_qc_performed, false);
    assert.equal(out.source_content_artistic_approval_verified_here, false);
    assert.equal(out.status, 'TECHNICAL_PACKAGE_VERIFIED_NOT_EO_APPROVAL');
    assert.deepEqual(await validateWorkspaceOnepagePackage(out.bytes, input.expected), (({ bytes, filename, ...rest }) => rest)(out));
    const python = spawnSync('python3', ['-c', 'import io,sys,zipfile,json\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nassert z.testzip() is None\nprint(json.dumps(z.namelist()))'], { input: out.bytes, encoding: 'utf8' });
    assert.equal(python.status, 0, python.stderr); assert.deepEqual(JSON.parse(python.stdout), out.inventory.map(e => e.path));
  }
});

test('canonical ordering, fixed timestamps, stable SHA and preservation of source bytes', async () => {
  const input = await fixture(), first = await buildWorkspaceOnepagePackage(input);
  input.assets.reverse(); input.expected.assets.reverse();
  const second = await buildWorkspaceOnepagePackage(input);
  assert.ok(first.bytes.equals(second.bytes)); assert.equal(first.sha256, second.sha256);
  assert.ok(first.bytes.equals(rawZip(entries(await fixture()))));
  input.expected.product_line_name = 'Sản phẩm';
  const unicode = await buildWorkspaceOnepagePackage(input);
  assert.ok(unicode.inventory.every(e => e.path.startsWith('Onepage - Sản phẩm/')));
  assert.notEqual(first.sha256, unicode.sha256);
});

test('missing, duplicate, extra, and responsive-alias worker slots fail closed', async () => {
  for (const [mode, error] of [['missing', /MISSING_WORKER_SLOT/], ['duplicate', /DUPLICATE_WORKER_SLOT/], ['extra', /UNEXPECTED_WORKER_SLOT/], ['alias', /UNEXPECTED_WORKER_SLOT/]] as const) {
    const input = await fixture();
    if (mode === 'missing') input.assets.pop();
    if (mode === 'duplicate') input.assets.push({ ...input.assets[0] });
    if (mode === 'extra') input.assets.push({ ...input.assets[0], canonical_slot: 'gtk_01' });
    if (mode === 'alias') input.assets[0].canonical_slot = 'occasion_story_01_mobile';
    await assert.rejects(buildWorkspaceOnepagePackage(input), error);
  }
});

test('expected inventories cannot omit, duplicate or invent slots', async () => {
  for (const mode of ['missing', 'duplicate', 'unexpected']) {
    const input = await fixture();
    if (mode === 'missing') input.expected.assets.pop();
    if (mode === 'duplicate') input.expected.assets.push({ ...input.expected.assets[0] });
    if (mode === 'unexpected') input.expected.assets[0].canonical_slot = 'invented';
    await assert.rejects(buildWorkspaceOnepagePackage(input), /EXPECTED_SLOT/);
  }
});

test('stale content and asset revisions are rejected', async () => {
  for (const field of ['revision_id', 'content_revision'] as const) {
    const input = await fixture(); input.assets[0][field] = 'stale';
    await assert.rejects(buildWorkspaceOnepagePackage(input), /STALE_ASSET_REVISION/);
  }
});

test('mapping must belong to every current scope identity and current mapping revision', async () => {
  const input = await fixture(); input.mapping.revision_id = 'old-mapping';
  await assert.rejects(buildWorkspaceOnepagePackage(input), /STALE_MAPPING_REVISION/);
  for (const key of ['task_id', 'snapshot_id', 'content_revision', 'canonical_version', 'template_version', 'render_hash'] as const) {
    const value = await fixture(); value.mapping.scope[key] = key === 'render_hash' ? 'b'.repeat(64) : 'stale';
    await assert.rejects(buildWorkspaceOnepagePackage(value), /STALE_MAPPING_REVISION/);
  }
});

test('wrong asset or mapping hash, MIME, format, dimension and nonimages reject', async () => {
  for (const mode of ['asset-hash', 'mapping-hash', 'asset-mime', 'mapping-mime', 'asset-format', 'mapping-format', 'dimensions', 'nonimage']) {
    const input = await fixture();
    if (mode === 'asset-hash') input.expected.assets[0].sha256 = '0'.repeat(64);
    if (mode === 'mapping-hash') input.expected.mapping.sha256 = '0'.repeat(64);
    if (mode === 'asset-mime') (input.assets[0] as any).mime_type = 'image/png';
    if (mode === 'mapping-mime') (input.mapping as any).mime_type = 'image/webp';
    if (mode === 'asset-format') { input.assets[0].bytes = input.mapping.bytes; input.expected.assets[0].sha256 = digest(input.assets[0].bytes); }
    if (mode === 'mapping-format') { input.mapping.bytes = input.assets[0].bytes; input.expected.mapping.sha256 = digest(input.mapping.bytes); }
    if (mode === 'dimensions') input.expected.assets[0].width++;
    if (mode === 'nonimage') { input.assets[0].bytes = Buffer.from('not an image'); input.expected.assets[0].sha256 = digest(input.assets[0].bytes); }
    await assert.rejects(buildWorkspaceOnepagePackage(input), { name: /Error/ }, mode);
  }
});

test('CRC damage, truncation, appended bytes and inconsistent local headers reject', async () => {
  const input = await fixture(), output = await buildWorkspaceOnepagePackage(input);
  const damaged = Buffer.from(output.bytes); damaged[30 + damaged.readUInt16LE(26)] ^= 1;
  await assert.rejects(validateWorkspaceOnepagePackage(damaged, input.expected), /ZIP_CRC_MISMATCH/);
  for (const bytes of [output.bytes.subarray(0, 10), output.bytes.subarray(0, -1), Buffer.concat([output.bytes, Buffer.from([0])])]) await assert.rejects(validateWorkspaceOnepagePackage(bytes, input.expected));
  const local = Buffer.from(output.bytes); local[30] ^= 1;
  await assert.rejects(validateWorkspaceOnepagePackage(local, input.expected), /ZIP_LOCAL_DIRECTORY_MISMATCH/);
});

test('actual reopened ZIP inventory rejects missing, duplicate, extra and reordered files', async () => {
  const input = await fixture(), files = entries(input);
  for (const [invalid, error] of [
    [files.slice(0, -1), /INVALID_PACKAGE_INVENTORY/],
    [[...files, files[0]], /DUPLICATE_ZIP_PATH/],
    [[...files, { path: 'Onepage - Test Product/extra.webp', bytes: files[0].bytes }], /INVALID_PACKAGE_INVENTORY/],
    [[...files].reverse(), /NONCANONICAL_PACKAGE_ORDER/],
  ] as const) await assert.rejects(validateWorkspaceOnepagePackage(rawZip([...invalid]), input.expected), error);
});

test('unsafe paths, duplicate roots and invalid product names never reach delivery', async () => {
  const input = await fixture(), files = entries(input);
  for (const path of ['../escape.webp', '/absolute.webp', 'C:/escape.webp', 'Onepage - Test Product/../escape.webp', 'Onepage - Test Product\\escape.webp', 'Onepage - Test Product//empty.webp', 'Onepage - Test Product/escape\0.webp']) {
    await assert.rejects(validateWorkspaceOnepagePackage(rawZip([{ ...files[0], path }, ...files.slice(1)]), input.expected), /UNSAFE_PACKAGE_PATH/);
  }
  await assert.rejects(validateWorkspaceOnepagePackage(rawZip([{ ...files[0], path: 'Other root/banner.webp' }, ...files.slice(1)]), input.expected), /INVALID_PACKAGE_INVENTORY/);
  for (const name of ['../escape', 'Test/Bad', 'Test\\Bad', 'C:Drive', 'Bad\u0000Name', 'Ends.', ' Ends']) {
    const value = await fixture(); value.expected.product_line_name = name;
    await assert.rejects(buildWorkspaceOnepagePackage(value));
  }
});

test('ZIP parser bounds entry count, offsets, path lengths, lengths and unsupported features before reading', async () => {
  const input = await fixture(), good = (await buildWorkspaceOnepagePackage(input)).bytes;
  const mutations: Array<(bytes: Buffer) => void> = [
    b => { b.writeUInt16LE(65535, b.length - 14); b.writeUInt16LE(65535, b.length - 12); },
    b => b.writeUInt32LE(0xffffffff, b.length - 6),
    b => b.writeUInt32LE(0xffffffff, b.length - 10),
    b => b.writeUInt32LE(0xffffffff, centralStart(b) + 42),
    b => b.writeUInt16LE(65535, centralStart(b) + 28),
    b => b.writeUInt32LE(WORKSPACE_PACKAGE_LIMITS.file_bytes + 1, centralStart(b) + 24),
    b => b.writeUInt16LE(8, centralStart(b) + 10), // compression is unsupported
    b => b.writeUInt16LE(2049, centralStart(b) + 8), // encrypted
    b => b.writeUInt16LE(1, centralStart(b) + 30), // extra fields / ZIP64
    b => b.writeUInt16LE(1, b.length - 18), // multidisk
    b => b.writeUInt32LE(0xa1ff0000, centralStart(b) + 38), // symlink/mode attributes
  ];
  for (const mutate of mutations) { const bytes = Buffer.from(good); mutate(bytes); await assert.rejects(validateWorkspaceOnepagePackage(bytes, input.expected)); }
});

test('worker bytes, pixel dimensions and expectation schemas have strict bounds', async () => {
  const input = await fixture(); input.assets[0].bytes = Buffer.alloc(WORKSPACE_PACKAGE_LIMITS.file_bytes + 1);
  await assert.rejects(buildWorkspaceOnepagePackage(input), /INVALID_ASSET_BYTES/);
  const aggregate = await fixture();
  const sharedLargeBuffer = Buffer.alloc(WORKSPACE_PACKAGE_LIMITS.file_bytes);
  aggregate.assets.forEach(asset => { asset.bytes = sharedLargeBuffer; });
  await assert.rejects(buildWorkspaceOnepagePackage(aggregate), /ZIP_ARCHIVE_BYTE_LIMIT/);
  const pixels = await fixture(); pixels.expected.assets[0].width = WORKSPACE_PACKAGE_LIMITS.pixels;
  await assert.rejects(buildWorkspaceOnepagePackage(pixels), /PACKAGE_PIXEL_LIMIT/);
  const empty = await fixture(); empty.assets[0].bytes = Buffer.alloc(0);
  await assert.rejects(buildWorkspaceOnepagePackage(empty), /INVALID_ASSET_BYTES/);
  const injected = await fixture(); (injected.expected as any).approved = true;
  await assert.rejects(buildWorkspaceOnepagePackage(injected));
});

test('read-back hash and real full image decoding reject altered bytes even with fresh valid CRC', async () => {
  const input = await fixture(), files = entries(input);
  files[0] = { ...files[0], bytes: Buffer.from('invalid but CRC-consistent image') };
  const bytes = rawZip(files);
  await assert.rejects(validateWorkspaceOnepagePackage(bytes, input.expected), /PACKAGE_HASH_MISMATCH/);
  input.expected.assets[0].sha256 = digest(files[0].bytes);
  await assert.rejects(validateWorkspaceOnepagePackage(bytes, input.expected), /unsupported image/i);
});

test('snapshot copy prevents mutation during asynchronous decode from changing returned ZIP', async () => {
  const input = await fixture(), original = Buffer.from(input.assets[0].bytes);
  const promise = buildWorkspaceOnepagePackage(input);
  input.assets[0].bytes.fill(0); input.mapping.bytes.fill(0);
  input.expected.assets[0].sha256 = '0'.repeat(64);
  const result = await promise;
  assert.equal(result.inventory[0].sha256, digest(original));
  assert.equal(result.sha256, digest(result.bytes));
});

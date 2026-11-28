import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from '../tools/creative-quality/sharp.ts';
import { ASSET_LIMITS, preflightAsset } from '../uid-asset-preflight.ts';
import { createImagePreflightCache, IMAGE_DECODE_POLICY } from './image-preflight-cache.ts';
import { validateAssetBytes } from './delivery.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const image = (color = '#8844aa') => sharp({ create: { width: 732, height: 480, channels: 3, background: color } }).webp({ lossless: true }).toBuffer();

test('identical actual bytes decode once; every request rehashes bytes and receipts cannot poison the cache', async () => {
  const bytes = await image(); let decodes = 0;
  const cache = createImagePreflightCache({ decode: async (...args) => { decodes++; return preflightAsset(...args); } });
  const first = await cache.validate(bytes, hash(bytes)), second = await cache.validate(Buffer.from(bytes), hash(bytes));
  assert.deepEqual(first, second); assert.equal(decodes, 1);
  first.width = 1; first.blockers.push('caller mutation');
  const third = await cache.validate(bytes);
  assert.equal(third.width, 732); assert.deepEqual(third.blockers, []);
  assert.equal(cache.stats().bytesHashed, bytes.length * 3); assert.equal(cache.stats().cacheHits, 2);
  assert.equal(third.visual_qc_performed, false); assert.equal(third.print_ready, false);
  assert.equal(IMAGE_DECODE_POLICY.byteLimit, ASSET_LIMITS.bytes); assert.equal(IMAGE_DECODE_POLICY.pixelLimit, ASSET_LIMITS.pixels);
  await assert.rejects(cache.validate(bytes, '0'.repeat(64)), /ASSET_HASH_MISMATCH/);
  await assert.rejects(cache.validate(bytes, 'not-a-sha'), /ASSET_HASH_MISMATCH/);
  const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  await assert.rejects(cache.validate(changed, hash(bytes)), /ASSET_HASH_MISMATCH/);
  assert.equal(decodes, 1);
});

test('concurrent equal bytes share only trusted decoding and snapshot mutable input before awaiting', async () => {
  const bytes = await image('#235678'), original = Buffer.from(bytes), expected = hash(bytes);
  let release!: () => void, decodes = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const cache = createImagePreflightCache({ decode: async (...args) => { decodes++; await gate; return preflightAsset(...args); } });
  const first = cache.validate(bytes, expected), second = cache.validate(Buffer.from(bytes), expected);
  bytes.fill(0); release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.sha256, expected); assert.deepEqual(a, b); assert.equal(decodes, 1); assert.equal(cache.stats().pendingHits, 1);
  a.blockers.push('changed after await'); assert.deepEqual(b.blockers, []);
  assert.deepEqual(await cache.validate(original), b);
  await assert.rejects(cache.validate(bytes, expected), /ASSET_HASH_MISMATCH/);
});

test('invalid bytes and decoder failures are never cached, including concurrent failures', async () => {
  let decodes = 0;
  const cache = createImagePreflightCache({ decode: async (...args) => { decodes++; return preflightAsset(...args); } });
  const broken = Buffer.from('not an image');
  const results = await Promise.allSettled([cache.validate(broken), cache.validate(broken)]);
  assert.ok(results.every(result => result.status === 'rejected')); assert.equal(decodes, 1);
  assert.equal(cache.stats().entries, 0); assert.equal(cache.stats().pending, 0);
  await assert.rejects(cache.validate(broken)); assert.equal(decodes, 2);
  await assert.rejects(cache.validate(Buffer.alloc(0)), /ASSET_BYTE_LIMIT/);
  await assert.rejects(cache.validate(Buffer.alloc(ASSET_LIMITS.bytes + 1)), /ASSET_BYTE_LIMIT/);
  assert.equal(decodes, 2);
});

test('full cache evicts least recently used receipts and expiry forces a fresh real decode', async () => {
  let time = 0, decodes = 0;
  const cache = createImagePreflightCache({ maxEntries: 2, ttlMs: 50, now: () => time,
    decode: async (...args) => { decodes++; return preflightAsset(...args); } });
  const a = await image('#112233'), b = await image('#223344'), c = await image('#334455');
  await cache.validate(a); await cache.validate(b); await cache.validate(a); await cache.validate(c);
  assert.equal(decodes, 3); assert.equal(cache.stats().entries, 2); assert.equal(cache.stats().evictions, 1);
  await cache.validate(b); assert.equal(decodes, 4);
  time = 50; await cache.validate(b); assert.equal(decodes, 5); assert.equal(cache.stats().expirations, 2);
  assert.throws(() => createImagePreflightCache({ maxEntries: 129 }), /INVALID_IMAGE_CACHE_LIMIT/);
  assert.throws(() => createImagePreflightCache({ ttlMs: 300_001 }), /INVALID_IMAGE_CACHE_LIMIT/);
});

test('in-flight cache saturation stays bounded and still validates uncached inputs', async () => {
  let release!: () => void, decodes = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const cache = createImagePreflightCache({ maxEntries: 1, decode: async (...args) => { decodes++; await gate; return preflightAsset(...args); } });
  const a = await image('#556677'), b = await image('#667788');
  const first = cache.validate(a), second = cache.validate(b);
  assert.equal(cache.stats().pending, 1); assert.equal(cache.stats().entries, 0);
  release(); await Promise.all([first, second]);
  assert.equal(decodes, 2); assert.equal(cache.stats().entries, 1); assert.equal(cache.stats().pending, 0);
  await cache.validate(b); assert.equal(decodes, 3);
});

test('each delivery call reapplies format, dimensions and slot policy even after bytes were decoded', async () => {
  const bytes = await image('#778899'), sha = hash(bytes);
  await validateAssetBytes(bytes, { slot: 'wyl_01', size: '732x480' }, sha);
  await assert.rejects(validateAssetBytes(bytes, { slot: 'wyl_01', size: '950x950' }, sha), /CANONICAL_ASSET_DIMENSIONS/);
  await assert.rejects(validateAssetBytes(bytes, { slot: 'ui_mapping_preview', size: 'full_page' }, sha), /CANONICAL_ASSET_FORMAT/);
  await assert.rejects(validateAssetBytes(bytes, { slot: 'wyl_01', size: 'unknown' }, sha), /UNKNOWN_CANONICAL_ASSET_SIZE/);
  const spec = { slot: 'wyl_01', size: '950x950' }, result = validateAssetBytes(bytes, spec, sha);
  spec.size = '732x480'; await assert.rejects(result, /CANONICAL_ASSET_DIMENSIONS/);
  const png = await sharp(bytes).png().toBuffer();
  await validateAssetBytes(png, { slot: 'ui_mapping_preview', size: 'full_page' });
  await assert.rejects(validateAssetBytes(png, { slot: 'wyl_01', size: '732x480' }), /CANONICAL_ASSET_FORMAT/);
});

test('non-successful or mismatched decoder receipts cannot enter the cache', async () => {
  const bytes = await image('#998877'); let decodes = 0;
  const cache = createImagePreflightCache({ decode: async (...args) => {
    decodes++; const receipt = await preflightAsset(...args); return { ...receipt, sha256: '0'.repeat(64) };
  } });
  await assert.rejects(cache.validate(bytes), /ASSET_PREFLIGHT_RECEIPT_MISMATCH/);
  await assert.rejects(cache.validate(bytes), /ASSET_PREFLIGHT_RECEIPT_MISMATCH/);
  assert.equal(decodes, 2); assert.equal(cache.stats().entries, 0); assert.equal(cache.stats().pending, 0);
});

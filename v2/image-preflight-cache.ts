import { createHash } from 'node:crypto';
import { ASSET_LIMITS, preflightAsset } from '../uid-asset-preflight.ts';

type Receipt = Awaited<ReturnType<typeof preflightAsset>>;
type Decode = (bytes: Buffer, options: { expected_sha256: string }) => Promise<Receipt>;

/** Process-local policy namespace. Change this identifier whenever the decoder,
 * its limits or validation semantics change. A process restart drops all entries.
 * Placement, supplier evidence, canonical slot policy and visual QC are excluded.
 */
export const IMAGE_DECODE_POLICY = Object.freeze({
  id: 'uid-v2.full-image-decode/1',
  byteLimit: ASSET_LIMITS.bytes,
  pixelLimit: ASSET_LIMITS.pixels,
  formats: 'png,jpeg,webp,avif',
  maximumPages: 1,
  failOn: 'warning',
  orientation: 'rotate-before-raw-full-pixel-decode',
});
const policyKey = JSON.stringify(IMAGE_DECODE_POLICY);

/** Factory injection is for offline verification/benchmarking only. Production
 * uses the private default instance below; no host can insert or retrieve a
 * receipt by claimed hash. Every request must supply actual authorized bytes.
 */
export function createImagePreflightCache(options: {
  decode?: Decode; now?: () => number; maxEntries?: number; ttlMs?: number;
} = {}) {
  const decode = options.decode ?? preflightAsset, now = options.now ?? (() => performance.now());
  const maxEntries = options.maxEntries ?? 128, ttlMs = options.ttlMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 128 ||
      !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 5 * 60_000) throw Error('INVALID_IMAGE_CACHE_LIMIT');
  const entries = new Map<string, { receipt: Receipt; expires: number }>();
  const pending = new Map<string, Promise<Receipt>>();
  const counts = { requests: 0, bytesHashed: 0, cacheHits: 0, pendingHits: 0, decodeStarts: 0, evictions: 0, expirations: 0 };
  const copy = (receipt: Receipt): Receipt => structuredClone(receipt);
  const expire = () => {
    const time = now();
    for (const [key, entry] of entries) if (entry.expires <= time) { entries.delete(key); counts.expirations++; }
  };
  return {
    async validate(bytes: Buffer, expectedHash?: string): Promise<Receipt> {
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > IMAGE_DECODE_POLICY.byteLimit) throw Error('ASSET_BYTE_LIMIT');
      // Snapshot and hash before any await. A mutable Buffer is never a cache key.
      const snapshot = Buffer.from(bytes), actual = createHash('sha256').update(snapshot).digest('hex');
      counts.requests++; counts.bytesHashed += snapshot.length;
      if (expectedHash !== undefined && (!/^[a-f0-9]{64}$/.test(expectedHash) || expectedHash !== actual)) throw Error('ASSET_HASH_MISMATCH');
      const key = policyKey + ':' + actual;
      expire();
      const found = entries.get(key);
      if (found) {
        entries.delete(key); entries.set(key, found); counts.cacheHits++;
        return copy(found.receipt);
      }
      const inflight = pending.get(key);
      if (inflight) { counts.pendingHits++; return copy(await inflight); }
      // Completed receipts and tracked in-flight entries share the same bound.
      // Saturation never skips validation; it only disables caching for that call.
      while (entries.size && entries.size + pending.size >= maxEntries) {
        entries.delete(entries.keys().next().value!); counts.evictions++;
      }
      const admitted = entries.size + pending.size < maxEntries;
      counts.decodeStarts++;
      const task = Promise.resolve().then(() => decode(snapshot, { expected_sha256: actual })).then(receipt => {
        if (receipt.sha256 !== actual || receipt.byte_length !== snapshot.length ||
            receipt.decode !== 'FULL_PIXEL_DECODE_PASSED' || receipt.status !== 'TECHNICAL_CHECKS_PASSED_NOT_VISUAL_QC' ||
            receipt.blockers.length || receipt.visual_qc_performed !== false || receipt.effective_ppi !== null || receipt.supplier_spec !== null) {
          throw Error('ASSET_PREFLIGHT_RECEIPT_MISMATCH');
        }
        const trusted = copy(receipt);
        if (admitted) {
          if (pending.get(key) === task) pending.delete(key);
          entries.set(key, { receipt: trusted, expires: now() + ttlMs });
        }
        return trusted;
      }).finally(() => { if (admitted && pending.get(key) === task) pending.delete(key); });
      if (admitted) pending.set(key, task);
      return copy(await task);
    },
    // Counts expose no asset hashes, receipts or bytes. Not wired into MCP.
    stats() { return { ...counts, entries: entries.size, pending: pending.size, maxEntries, ttlMs }; },
  };
}

const imageCache = createImagePreflightCache();
export const cachedImagePreflight = (bytes: Buffer, expectedHash?: string) => imageCache.validate(bytes, expectedHash);

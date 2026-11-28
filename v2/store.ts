import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { boundedId, hash, safeJson, V2Error } from './core.ts';
import { MAX_ZIP_ARCHIVE_BYTES } from './delivery-zip.ts';

export type StoredJob = Record<string, any> & { jobId: string; owner: string; storageRevision: number; createdAt: string; updatedAt: string; expiresAt: string };
export type OperationKey = { key: string; requestHash: string };
export type ArtifactReceipt = { sha256: string; byteLength: number; mime: string };
export type StoredArtifact = ArtifactReceipt & { bytes: Buffer };
/** Bounded input; duplicates are returned once in their first occurrence order. */
export function artifactBatchHashes(hashes: string[]): string[] {
  if (!Array.isArray(hashes) || hashes.length > 24) throw new V2Error('ASSET_BATCH_LIMIT', 'Request at most 24 artifact hashes.', 413);
  if (hashes.some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) throw new V2Error('ASSET_HASH', 'Invalid artifact hash.');
  return [...new Set(hashes)];
}
/** Isolated durable local storage. SQLite transactions port V1 CAS/immutable receipt semantics.
 * No production DB driver, URL, token or network method exists here. Use a persistent local volume.
 */
export class SqliteStore {
  private db: DatabaseSync;
  private ttlMs: number;
  private maxBytes: number;
  constructor(filename: string, options: { ttlMs?: number; maxBytes?: number } = {}) {
    this.ttlMs = options.ttlMs ?? 7 * 86400_000;
    this.maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1000 || this.ttlMs > 30 * 86400_000) throw new V2Error('TTL_LIMIT', 'TTL must be 1 second to 30 days.');
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1) throw new V2Error('STORAGE_LIMIT', 'Storage capacity must be a positive integer byte count.');
    if (filename !== ':memory:') {
      filename = resolve(filename);
      if (/\/(?:\.git|supabase)\//.test(filename)) throw new V2Error('UNSAFE_STORE', 'Choose a separate V2 state directory.');
      mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
      if (realpathSync(dirname(filename)) !== dirname(filename)) throw new V2Error('UNSAFE_STORE', 'State directory must not contain symlinks.');
      try { if (lstatSync(filename).isSymbolicLink()) throw new V2Error('UNSAFE_STORE', 'Database must not be a symlink.'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    }
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,idem TEXT NOT NULL,input_hash TEXT NOT NULL,revision INTEGER NOT NULL,expires INTEGER NOT NULL,document TEXT NOT NULL,UNIQUE(owner,idem));
      CREATE TABLE IF NOT EXISTS history(job TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(job,revision),FOREIGN KEY(job) REFERENCES jobs(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS receipts(job TEXT NOT NULL,operation TEXT NOT NULL,request_hash TEXT NOT NULL,document TEXT NOT NULL,PRIMARY KEY(job,operation),FOREIGN KEY(job) REFERENCES jobs(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS artifacts(job TEXT NOT NULL,hash TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(job,hash),FOREIGN KEY(job) REFERENCES jobs(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS leases(job TEXT PRIMARY KEY,holder TEXT NOT NULL,expires INTEGER NOT NULL,fence INTEGER NOT NULL,FOREIGN KEY(job) REFERENCES jobs(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS telemetry(id INTEGER PRIMARY KEY,job TEXT NOT NULL,event TEXT NOT NULL,created INTEGER NOT NULL,FOREIGN KEY(job) REFERENCES jobs(id) ON DELETE CASCADE);`);
  }
  private transaction<T>(run: () => T, write = true): T {
    this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  private checkCapacity(extra: number) {
    const row = this.db.prepare(`SELECT (SELECT coalesce(sum(length(CAST(document AS BLOB))),0) FROM jobs)+(SELECT coalesce(sum(length(CAST(document AS BLOB))),0) FROM history)+(SELECT coalesce(sum(length(CAST(document AS BLOB))),0) FROM receipts)+(SELECT coalesce(sum(length(bytes)),0) FROM artifacts)+(SELECT coalesce(sum(length(CAST(event AS BLOB))),0) FROM telemetry) AS bytes`).get()!;
    if (Number(row.bytes) + extra > this.maxBytes) throw new V2Error('STORAGE_LIMIT', 'Isolated store is full; expire test jobs before continuing.', 507);
  }
  findByKey(owner: string, key: string, inputHash?: string): StoredJob | undefined {
    boundedId(owner, 'principal'); boundedId(key, 'idempotency key');
    const row = this.db.prepare('SELECT id,input_hash FROM jobs WHERE owner=? AND idem=?').get(owner, key);
    if (!row) return undefined;
    if (inputHash !== undefined && row.input_hash !== inputHash) throw new V2Error('IDEMPOTENCY_CONFLICT', 'Idempotency key belongs to a different request.', 409);
    return this.read(owner, String(row.id));
  }
  create(owner: string, idempotencyKey: string, inputHash: string, initial: Record<string, any>): StoredJob {
    return this.transaction(() => {
      const previous = this.findByKey(owner, idempotencyKey, inputHash); if (previous) return previous;
      const now = Date.now();
      const record: StoredJob = { ...safeJson(initial), jobId: randomUUID(), owner, storageRevision: 0, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + this.ttlMs).toISOString() };
      const doc = JSON.stringify(record); this.checkCapacity(Buffer.byteLength(doc) * 2);
      this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?)').run(record.jobId, owner, idempotencyKey, inputHash, 0, now + this.ttlMs, doc);
      this.db.prepare('INSERT INTO history VALUES(?,?,?)').run(record.jobId, 0, doc);
      return safeJson(record);
    });
  }
  read(owner: string, id: string): StoredJob {
    boundedId(owner, 'principal'); boundedId(id, 'job');
    const row = this.db.prepare('SELECT document,expires FROM jobs WHERE id=? AND owner=?').get(id, owner);
    if (!row || Number(row.expires) <= Date.now()) throw new V2Error('NOT_FOUND', 'Job not found or expired.', 404);
    return JSON.parse(String(row.document));
  }
  private assertJob(owner: string, id: string) {
    boundedId(owner, 'principal'); boundedId(id, 'job');
    const row = this.db.prepare('SELECT expires FROM jobs WHERE id=? AND owner=?').get(id, owner);
    if (!row || Number(row.expires) <= Date.now()) throw new V2Error('NOT_FOUND', 'Job not found or expired.', 404);
  }
  update(owner: string, id: string, expectedRevision: number, mutation: (job: StoredJob) => Record<string, any>, operation?: OperationKey): StoredJob {
    return this.transaction(() => {
      const current = this.read(owner, id);
      if (operation) {
        boundedId(operation.key);
        const old = this.db.prepare('SELECT request_hash,document FROM receipts WHERE job=? AND operation=?').get(id, operation.key);
        if (old) {
          if (old.request_hash !== operation.requestHash) throw new V2Error('IDEMPOTENCY_CONFLICT', 'Operation key belongs to a different request.', 409);
          return JSON.parse(String(old.document));
        }
      }
      if (!Number.isInteger(expectedRevision) || expectedRevision !== current.storageRevision) throw new V2Error('STALE_REVISION', 'Job changed; reload state before retrying.', 409);
      const next = safeJson(mutation(safeJson(current)));
      const record = { ...next, jobId: id, owner, storageRevision: current.storageRevision + 1, createdAt: current.createdAt, expiresAt: current.expiresAt, updatedAt: new Date().toISOString() } as StoredJob;
      const doc = JSON.stringify(record); this.checkCapacity(Buffer.byteLength(doc) * (operation ? 3 : 2));
      const changed = this.db.prepare('UPDATE jobs SET revision=?,document=? WHERE id=? AND owner=? AND revision=?').run(record.storageRevision, doc, id, owner, expectedRevision);
      if (Number(changed.changes) !== 1) throw new V2Error('STALE_REVISION', 'Concurrent job update.', 409);
      this.db.prepare('INSERT INTO history VALUES(?,?,?)').run(id, record.storageRevision, doc);
      if (operation) this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(id, operation.key, operation.requestHash, doc);
      return record;
    });
  }
  acquireLease(owner: string, id: string, holder: string, ttlMs = 30_000): { holder: string; fence: number; expires: number } {
    boundedId(holder);
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 100 || ttlMs > 120_000) throw new V2Error('LEASE_LIMIT', 'Lease duration exceeds limit.');
    return this.transaction(() => {
      this.assertJob(owner, id);
      const row = this.db.prepare('SELECT holder,expires,fence FROM leases WHERE job=?').get(id);
      if (row && Number(row.expires) > Date.now()) throw new V2Error('LEASE_BUSY', 'A task operation is already running.', 409);
      const lease = { holder, fence: Number(row?.fence ?? 0) + 1, expires: Date.now() + ttlMs };
      this.db.prepare('INSERT INTO leases VALUES(?,?,?,?) ON CONFLICT(job) DO UPDATE SET holder=excluded.holder,expires=excluded.expires,fence=excluded.fence').run(id, holder, lease.expires, lease.fence);
      return lease;
    });
  }
  assertLease(owner: string, id: string, lease: { holder: string; fence: number }) {
    this.assertJob(owner, id);
    const row = this.db.prepare('SELECT * FROM leases WHERE job=? AND holder=? AND fence=?').get(id, lease.holder, lease.fence);
    if (!row || Number(row.expires) <= Date.now()) throw new V2Error('LEASE_EXPIRED', 'Task lease expired; discard this result.', 409);
  }
  releaseLease(owner: string, id: string, lease: { holder: string; fence: number }) {
    this.assertJob(owner, id);
    this.db.prepare('UPDATE leases SET expires=0 WHERE job=? AND holder=? AND fence=?').run(id, lease.holder, lease.fence);
  }
  putArtifact(owner: string, id: string, bytes: Buffer, mime: string): ArtifactReceipt {
    const limit = mime === 'application/zip' ? MAX_ZIP_ARCHIVE_BYTES : 32 * 1024 * 1024;
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > limit) throw new V2Error('ASSET_SIZE_LIMIT', 'Artifact exceeds its format-specific byte limit.', 413);
    if (!['image/png', 'image/webp', 'image/jpeg', 'text/html', 'text/css', 'application/zip', 'application/json'].includes(mime)) throw new V2Error('ASSET_TYPE', 'Unsupported artifact type.');
    return this.transaction(() => {
      this.assertJob(owner, id); const sha256 = hash(bytes);
      const old = this.db.prepare('SELECT mime FROM artifacts WHERE job=? AND hash=?').get(id, sha256);
      if (old && old.mime !== mime) throw new V2Error('ASSET_TYPE', 'Existing bytes have a different type.');
      if (!old) { this.checkCapacity(bytes.length); this.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').run(id, sha256, mime, bytes); }
      return { sha256, byteLength: bytes.length, mime };
    });
  }
  readArtifacts(owner: string, id: string, hashes: string[]): StoredArtifact[] {
    return this.transaction(() => {
      this.assertJob(owner, id);
      const requested = artifactBatchHashes(hashes);
      if (!requested.length) return [];
      const placeholders = requested.map(() => '?').join(',');
      const rows = this.db.prepare(`SELECT a.hash,a.bytes,a.mime FROM artifacts a JOIN jobs j ON j.id=a.job WHERE a.job=? AND a.hash IN (${placeholders}) AND j.owner=? AND j.expires>?`).all(id, ...requested, owner, Date.now());
      const found = new Map(rows.map(row => [String(row.hash), row]));
      if (requested.some(sha256 => !found.has(sha256))) throw new V2Error('NOT_FOUND', 'Artifact not found.', 404);
      return requested.map(sha256 => {
        const row = found.get(sha256)!, bytes = Buffer.from(row.bytes as Uint8Array);
        if (hash(bytes) !== sha256) throw new V2Error('ASSET_CORRUPT', 'Artifact bytes failed integrity validation.', 409);
        return { sha256, byteLength: bytes.length, mime: String(row.mime), bytes };
      });
    }, false);
  }
  readArtifact(owner: string, id: string, sha256: string): StoredArtifact { return this.readArtifacts(owner, id, [sha256])[0]; }
  getArtifact(owner: string, id: string, sha256: string): Buffer { return this.readArtifact(owner, id, sha256).bytes; }
  artifactInfo(owner: string, id: string, sha256: string): ArtifactReceipt {
    const { bytes: _bytes, ...receipt } = this.readArtifact(owner, id, sha256);
    return receipt;
  }
  recordTelemetry(owner: string, id: string, event: Record<string, unknown>) {
    this.transaction(() => {
      this.assertJob(owner, id);
      const allow = ['operation', 'durationMs', 'requestBytes', 'responseBytes', 'inputTokens', 'outputTokens', 'reasoningTokens', 'cachedTokens', 'model', 'effort', 'provider', 'measurementSource', 'cost', 'fallback', 'imageCalls', 'completion', 'eoVerdict'];
      const cleaned = Object.fromEntries(Object.entries(event).filter(([key]) => allow.includes(key)));
      const text = JSON.stringify(safeJson(cleaned, 4096)); this.checkCapacity(Buffer.byteLength(text));
      this.db.prepare('INSERT INTO telemetry(job,event,created) VALUES(?,?,?)').run(id, text, Date.now());
    });
  }
  telemetry(owner: string, id: string): unknown[] { this.assertJob(owner, id); return this.db.prepare('SELECT event FROM telemetry WHERE job=? ORDER BY id').all(id).map(row => JSON.parse(String(row.event))); }
  pruneExpired(): number { return this.transaction(() => Number(this.db.prepare('DELETE FROM jobs WHERE expires<=?').run(Date.now()).changes)); }
  close() { this.db.close(); }
}

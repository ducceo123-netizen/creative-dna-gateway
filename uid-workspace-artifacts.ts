import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, type ReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, lstat, link, rm, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { WorkspaceStore, WorkspaceRecord, WorkspaceArtifact } from './uid-workspace-store.ts';

/** Private byte custody only. A successful upload/full decode is NOT source pixel
 * inspection, permission to use a reference with a provider, visual QC or EO. */
export const WORKSPACE_ARTIFACT_LIMITS = Object.freeze({ upload_bytes: 8 * 1024 * 1024, download_bytes: 256 * 1024 * 1024,
  upload_pixels: 16_000_000, references_per_task: 32, upload_intents_per_task: 128, reference_bytes_per_task: 128 * 1024 * 1024 });
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9:_@.-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const filename = z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).refine(value => !value.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value));
const rasterMime = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export const workspaceUploadSchema = z.object({
  idempotency_key: z.string().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/),
  expected_state_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), content_revision: id,
  filename, media_type: rasterMime, size_bytes: z.number().int().min(1).max(WORKSPACE_ARTIFACT_LIMITS.upload_bytes), sha256: hash,
  purpose: z.enum(['brief', 'feedback']).default('brief'), review_index_id: hash.optional(),
  role: z.enum(['product', 'style', 'brand', 'other']), note: z.string().trim().max(2000).optional(),
}).strict();
export type WorkspaceUploadInput = z.infer<typeof workspaceUploadSchema>;
export type WorkspaceUploadIntent = WorkspaceUploadInput & {
  upload_id: string; fingerprint: string; storage_key: string; reference_id: string; revision_id: string;
  status: 'reserved' | 'receiving' | 'stored' | 'linked' | 'rejected' | 'unknown' | 'orphaned' | 'cleaned';
  created_at: string; updated_at: string; error_code?: string;
};
export type WorkspaceReference = {
  reference_id: string; revision_id: string; upload_id: string; filename: string; media_type: z.infer<typeof rasterMime>;
  size_bytes: number; sha256: string; storage_key: string; content_revision: string; role: WorkspaceUploadInput['role']; note?: string;
  purpose: 'brief' | 'feedback'; review_index_id?: string; removed_at?: string;
  width: number; height: number; created_at: string; technical_validation: 'full_decode_passed'; visual_inspection: 'not_performed';
};
export type WorkspaceObjectContext = { /** Server-authenticated JWT only; never persist or return. */ accessToken?: string };
export type WorkspaceObjectIdentity = { owner_id: string; task_id: string; storage_key: string; size_bytes: number; sha256: string; media_type: string };
export type WorkspaceObjectRead = { stream: AsyncIterable<Uint8Array>; dispose(): Promise<void> };
/** Configured by a trusted server composition root. No request chooses storage URL,
 * bucket, credential, object key or public access. Writes MUST be create-only. */
export interface WorkspacePrivateObjectStore {
  readonly kind: string; readonly productionReady: boolean; readonly loopbackOnly: boolean;
  put(object: WorkspaceObjectIdentity, bytes: AsyncIterable<Uint8Array>, context?: WorkspaceObjectContext): Promise<void>;
  open(object: WorkspaceObjectIdentity, context?: WorkspaceObjectContext): Promise<WorkspaceObjectRead | null>;
  remove(object: WorkspaceObjectIdentity, context?: WorkspaceObjectContext): Promise<void>;
}
export class WorkspaceArtifactError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
function fail(code: string, status = 409): never { throw new WorkspaceArtifactError(code, status); }
function checkObject(object: WorkspaceObjectIdentity) {
  id.parse(object.owner_id); id.parse(object.task_id); hash.parse(object.sha256);
  if (!Number.isSafeInteger(object.size_bytes) || object.size_bytes < 1 || object.size_bytes > WORKSPACE_ARTIFACT_LIMITS.download_bytes
    || !/^[A-Za-z0-9_-]{1,100}$/.test(object.media_type.replace('/', '_').replace('+', '_'))) fail('INVALID_OBJECT_METADATA');
  // Opaque immutable keys are generated server-side; owner/task prefixes stop
  // cross-task object aliasing even if a stored record is corrupt.
  const prefix = `${digest(object.owner_id)}/${digest(object.task_id)}/`;
  if (!object.storage_key.startsWith(prefix) || !/^[a-f0-9]{64}\/[a-f0-9]{64}\/[a-z0-9-]{1,100}$/.test(object.storage_key)) fail('OBJECT_SCOPE_MISMATCH');
}
export function workspaceObjectKey(ownerId: string, taskId: string, immutableVersion: string = randomUUID()) {
  id.parse(ownerId); id.parse(taskId);
  if (!/^[a-z0-9-]{1,100}$/.test(immutableVersion)) fail('INVALID_OBJECT_VERSION');
  return `${digest(ownerId)}/${digest(taskId)}/${immutableVersion}`;
}
function asObject(ownerId: string, taskId: string, item: { storage_key: string; size_bytes: number; sha256: string; media_type: string }): WorkspaceObjectIdentity {
  const object = { owner_id: ownerId, task_id: taskId, storage_key: item.storage_key, size_bytes: item.size_bytes, sha256: item.sha256, media_type: item.media_type };
  checkObject(object); return object;
}
function byteGuard(expected: Pick<WorkspaceObjectIdentity, 'size_bytes' | 'sha256'>) {
  let count = 0; const hasher = createHash('sha256');
  return new Transform({ transform(chunk, _encoding, done) {
    if (!(chunk instanceof Uint8Array)) return done(new WorkspaceArtifactError('INVALID_BYTE_STREAM', 400));
    count += chunk.length;
    if (count > expected.size_bytes) return done(new WorkspaceArtifactError('ARTIFACT_SIZE_MISMATCH', 413));
    hasher.update(chunk); done(null, chunk);
  }, flush(done) {
    done(count !== expected.size_bytes || hasher.digest('hex') !== expected.sha256 ? new WorkspaceArtifactError('ARTIFACT_INTEGRITY_FAILED') : undefined);
  } });
}
function fileSink(handle: FileHandle) {
  return new Writable({ write(chunk: Buffer, _encoding, done) {
    (async () => { let offset = 0; while (offset < chunk.length) {
      const result = await handle.write(chunk, offset, chunk.length - offset);
      if (!result.bytesWritten) fail('ARTIFACT_WRITE_FAILED', 503); offset += result.bytesWritten;
    } })().then(() => done(), done);
  } });
}
export type WorkspaceVerifiedDownload = {
  stream: ReadStream; size_bytes: number; sha256: string; media_type: string; filename: string; dispose(): Promise<void>;
};
/** Bound concurrent spool disk usage (default 512MiB maximum) without holding
 * whole 256MiB packages in RAM. Hash validation finishes before returning bytes. */
export class WorkspacePrivateSpool {
  private active = 0;
  constructor(private readonly options: { directory?: string; maxConcurrent?: number; timeoutMs?: number } = {}) {
    if (options.directory && !path.isAbsolute(options.directory)) fail('INVALID_SPOOL_DIRECTORY');
    if (options.maxConcurrent !== undefined && (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1 || options.maxConcurrent > 4)) fail('INVALID_SPOOL_CONCURRENCY');
  }
  async prepare(bytes: AsyncIterable<Uint8Array>, expected: Pick<WorkspaceObjectIdentity, 'size_bytes' | 'sha256'>) {
    if (!Number.isSafeInteger(expected.size_bytes) || expected.size_bytes < 1 || expected.size_bytes > WORKSPACE_ARTIFACT_LIMITS.download_bytes || !hash.safeParse(expected.sha256).success) fail('INVALID_OBJECT_METADATA');
    if (this.active >= (this.options.maxConcurrent ?? 2)) fail('ARTIFACT_TRANSFER_BUSY', 503);
    this.active++;
    let directory: string | undefined; let disposed = false;
    const dispose = async () => { if (!disposed) { disposed = true; try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { this.active--; } } };
    try {
      // mkdtemp creates a new mode-0700 directory, never a caller-selected filename.
      directory = await mkdtemp(path.join(this.options.directory ?? tmpdir(), 'uid-private-spool-'));
      const file = path.join(directory, 'bytes');
      const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await pipeline(Readable.from(bytes), byteGuard(expected), fileSink(handle), { signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
        await handle.sync();
      } finally { await handle.close(); }
      return { file, dispose, open: () => createReadStream(file, { flags: 'r', highWaterMark: 64 * 1024 }) };
    } catch (error) { await dispose(); throw error instanceof WorkspaceArtifactError ? error : new WorkspaceArtifactError('ARTIFACT_TRANSFER_FAILED', 503); }
  }
}

/** Development/test filesystem ONLY. Router must also enforce direct loopback
 * request peers and reject forwarded requests. Never mount this directory publicly. */
export class FileWorkspaceObjectStore implements WorkspacePrivateObjectStore {
  readonly kind = 'filesystem-private-development'; readonly productionReady = false; readonly loopbackOnly = true;
  constructor(private readonly directory: string, options: { environment: 'development' | 'test'; publicOrigin: string }) {
    let origin: URL; try { origin = new URL(options.publicOrigin); } catch { fail('LOCAL_ARTIFACT_STORE_NOT_ALLOWED'); }
    if (!['development', 'test'].includes(options.environment) || !path.isAbsolute(directory) || !['localhost', '127.0.0.1', '[::1]'].includes(origin!.hostname)
      || !['http:', 'https:'].includes(origin!.protocol) || origin!.username || origin!.password) fail('LOCAL_ARTIFACT_STORE_NOT_ALLOWED');
  }
  private async location(object: WorkspaceObjectIdentity) {
    checkObject(object); await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) fail('ARTIFACT_DIRECTORY_NOT_PRIVATE');
    return path.join(this.directory, digest(object.storage_key));
  }
  async put(object: WorkspaceObjectIdentity, bytes: AsyncIterable<Uint8Array>) {
    const target = await this.location(object), temporary = path.join(this.directory, '.' + randomUUID() + '.pending');
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await pipeline(Readable.from(bytes), byteGuard(object), fileSink(handle), { signal: AbortSignal.timeout(60_000) });
      await handle.sync(); await handle.close();
      try { await link(temporary, target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('IMMUTABLE_OBJECT_EXISTS'); throw error; }
      const dir = await open(this.directory, constants.O_RDONLY); try { await dir.sync(); } finally { await dir.close(); }
    } finally { await handle.close().catch(() => undefined); await rm(temporary, { force: true }); }
  }
  async open(object: WorkspaceObjectIdentity): Promise<WorkspaceObjectRead | null> {
    const target = await this.location(object);
    let handle; try { handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; fail('PRIVATE_OBJECT_UNAVAILABLE', 503); }
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size !== object.size_bytes) { await handle.close(); fail('ARTIFACT_INTEGRITY_FAILED'); }
    const stream = handle.createReadStream();
    return { stream, async dispose() { stream.destroy(); await handle.close().catch(() => undefined); } };
  }
  async remove(object: WorkspaceObjectIdentity) { await rm(await this.location(object), { force: true }); }
}

export type SupabasePrivateObjectConfig = {
  url: string; bucket: string; /** No bucket creation or policy changes are performed. */
  reviewedPrivateBucket: true; reviewedObjectPolicies: true;
  authorization: { mode: 'user'; publicKey: string } | { mode: 'server'; dedicatedRoleApproved: true; getHeaders: () => Promise<{ apikey: string; authorization: string }> };
  fetcher?: typeof fetch;
};
/** Real fixed-origin Supabase Storage HTTP. Inject only after bucket/RLS/access
 * review. Never automatically selects the existing checkpoint bucket, enables it,
 * configures a credential, signs a public URL, follows redirects or overwrites. */
export class SupabaseWorkspaceObjectStore implements WorkspacePrivateObjectStore {
  readonly kind = 'supabase-private-http'; readonly productionReady = true; readonly loopbackOnly = false;
  private readonly base: string;
  constructor(private readonly config: SupabasePrivateObjectConfig) {
    let url: URL; try { url = new URL(config.url); } catch { fail('INVALID_STORAGE_CONFIG'); }
    if (url!.protocol !== 'https:' || !/^[a-z0-9-]{8,100}\.supabase\.co$/.test(url!.hostname) || url!.port || url!.username || url!.password || url!.pathname !== '/' || url!.search || url!.hash
      || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.bucket) || config.reviewedPrivateBucket !== true || config.reviewedObjectPolicies !== true) fail('PRIVATE_STORAGE_REVIEW_REQUIRED');
    if (config.authorization.mode === 'user') {
      const key = config.authorization.publicKey;
      let valid = key.startsWith('sb_publishable_');
      if (!valid) { try { valid = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {} }
      if (!valid || /[\r\n]/.test(key)) fail('STORAGE_PUBLIC_KEY_REQUIRED');
    } else if (config.authorization.mode !== 'server' || config.authorization.dedicatedRoleApproved !== true || typeof config.authorization.getHeaders !== 'function') fail('DEDICATED_STORAGE_ROLE_REQUIRED');
    this.base = `${url!.origin}/storage/v1/object/${config.bucket}/`;
  }
  private async headers(context?: WorkspaceObjectContext): Promise<Record<string, string>> {
    const auth = this.config.authorization;
    if (auth.mode === 'user') {
      if (!context?.accessToken || context.accessToken.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(context.accessToken)) fail('STORAGE_USER_AUTH_REQUIRED', 401);
      return { apikey: auth.publicKey, Authorization: 'Bearer ' + context.accessToken };
    }
    const credentials = await auth.getHeaders();
    if (!credentials.apikey || !/^Bearer [A-Za-z0-9._-]+$/.test(credentials.authorization) || /[\r\n]/.test(credentials.apikey)) fail('STORAGE_CREDENTIAL_UNAVAILABLE', 503);
    return { apikey: credentials.apikey, Authorization: credentials.authorization };
  }
  private async request(object: WorkspaceObjectIdentity, method: string, context?: WorkspaceObjectContext, bytes?: AsyncIterable<Uint8Array>) {
    checkObject(object);
    const headers = await this.headers(context);
    if (bytes) Object.assign(headers, { 'Content-Type': object.media_type, 'Content-Length': String(object.size_bytes), 'x-upsert': 'false' });
    try {
      // Hash guard still validates injected callers. Service already verified the
      // entire spool before starting this non-transactional network write.
      const body = bytes ? Readable.from((async function* () {
        let size = 0; const hasher = createHash('sha256');
        for await (const chunk of bytes) {
          if (!(chunk instanceof Uint8Array) || (size += chunk.length) > object.size_bytes) fail('ARTIFACT_SIZE_MISMATCH');
          hasher.update(chunk); yield chunk;
        }
        if (size !== object.size_bytes || hasher.digest('hex') !== object.sha256) fail('ARTIFACT_INTEGRITY_FAILED');
      })()) : undefined;
      return await (this.config.fetcher ?? fetch)(this.base + object.storage_key, { method, headers, body,
        ...(body ? { duplex: 'half' } : {}), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60_000) } as RequestInit);
    } catch { fail(method === 'POST' || method === 'DELETE' ? 'OBJECT_OUTCOME_UNKNOWN' : 'PRIVATE_OBJECT_UNAVAILABLE', 503); }
  }
  async put(object: WorkspaceObjectIdentity, bytes: AsyncIterable<Uint8Array>, context?: WorkspaceObjectContext) {
    const response = await this.request(object, 'POST', context, bytes);
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) fail(response.status === 409 ? 'IMMUTABLE_OBJECT_EXISTS' : 'OBJECT_OUTCOME_UNKNOWN', 503);
  }
  async open(object: WorkspaceObjectIdentity, context?: WorkspaceObjectContext): Promise<WorkspaceObjectRead | null> {
    const response = await this.request(object, 'GET', context);
    if (response.status === 404) { await response.body?.cancel().catch(() => undefined); return null; }
    if (!response.ok || !response.body || response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') {
      await response.body?.cancel().catch(() => undefined); fail('PRIVATE_OBJECT_UNAVAILABLE', 503);
    }
    const length = response.headers.get('content-length');
    if (length !== null && length !== String(object.size_bytes)) { await response.body.cancel(); fail('ARTIFACT_INTEGRITY_FAILED'); }
    const reader = response.body.getReader();
    return { stream: { async *[Symbol.asyncIterator]() { try { while (true) { const part = await reader.read(); if (part.done) return; yield part.value; } } finally { await reader.cancel().catch(() => undefined); } } },
      async dispose() { await reader.cancel().catch(() => undefined); reader.releaseLock(); } };
  }
  async remove(object: WorkspaceObjectIdentity, context?: WorkspaceObjectContext) {
    const response = await this.request(object, 'DELETE', context); await response.body?.cancel().catch(() => undefined);
    if (!response.ok && response.status !== 404) fail('OBJECT_OUTCOME_UNKNOWN', 503);
  }
}

const workerObjectSpool = new WorkspacePrivateSpool();

/** Trusted worker byte-custody helper. Caller records the immutable object key in
 * its durable run intent BEFORE calling. This creates no task/QC/EO receipt, and
 * is not an HTTP API for browser-authored artifact metadata. On unknown outcome,
 * reconcile that exact key rather than create a new version or retry generation. */
export async function writeVerifiedWorkspaceObject(objects: WorkspacePrivateObjectStore, object: WorkspaceObjectIdentity,
  bytes: AsyncIterable<Uint8Array>, context?: WorkspaceObjectContext, spool = workerObjectSpool) {
  checkObject(object);
  const staged = await spool.prepare(bytes, object);
  try {
    try { await objects.put(object, staged.open(), context); }
    catch (error) {
      // An already-existing immutable version is only accepted after full readback.
      if (!(error instanceof WorkspaceArtifactError) || error.code !== 'IMMUTABLE_OBJECT_EXISTS') fail('OBJECT_OUTCOME_UNKNOWN', 503);
    }
    await staged.dispose();
    const read = await objects.open(object, context); if (!read) fail('OBJECT_OUTCOME_UNKNOWN', 503);
    try {
      const verified = await spool.prepare(read.stream, object); await verified.dispose();
      return { storage_key: object.storage_key, sha256: object.sha256, size_bytes: object.size_bytes };
    } finally { await read.dispose(); }
  } finally { await staged.dispose(); }
}

type ReferenceRecord = WorkspaceRecord & { reference_uploads?: WorkspaceUploadIntent[]; references?: WorkspaceReference[] };
function recordFor(tasks: readonly WorkspaceRecord[], ownerId: string, taskId: string): ReferenceRecord {
  const record = tasks.find(row => row.owner_id === ownerId && row.task.task_id === taskId);
  if (!record) fail('TASK_NOT_FOUND', 404); return record;
}
function assertUploadScope(record: ReferenceRecord, input: Pick<WorkspaceUploadInput, 'expected_state_version' | 'content_revision' | 'purpose' | 'review_index_id'>) {
  if (record.task.state_version !== input.expected_state_version || record.task.snapshot.content_revision !== input.content_revision) fail('UPLOAD_SCOPE_STALE');
  if (record.actions.some(action => ['queued', 'running', 'unknown'].includes(action.status)) || record.revision_plan && record.revision_plan.phase !== 'review_ready') fail('REFERENCE_UPLOAD_BUSY');
  if (input.purpose === 'brief') {
    if (record.task.stage !== 'draft' || input.review_index_id) fail('REFERENCE_UPLOAD_DRAFT_ONLY');
  } else {
    if (!['content_review', 'review', 'completed'].includes(record.task.stage)) fail('REFERENCE_UPLOAD_REVIEW_ONLY');
    if (record.review_manifest ? input.review_index_id !== record.review_manifest.index_id : input.review_index_id !== undefined || record.task.stage !== 'content_review') fail('UPLOAD_REVIEW_STALE');
  }
}
export function publicWorkspaceUpload(upload: WorkspaceUploadIntent) {
  const { storage_key, fingerprint, ...safe } = upload; return safe;
}
export function publicWorkspaceReference(reference: WorkspaceReference) { const { storage_key, ...safe } = reference; return safe; }
async function decodeRaster(file: string, mime: string) {
  // Optional private-custody decoder must not change gateway/MCP startup when the
  // workspace is disabled. Its isolated native runtime is loaded only on upload.
  const { default: sharp } = await import('./tools/creative-quality/sharp.ts');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); const head = Buffer.alloc(16);
  try { await handle.read(head, 0, 16, 0); } finally { await handle.close(); }
  const sniffed = head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : head[0] === 255 && head[1] === 216 && head[2] === 255 ? 'image/jpeg'
    : head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  if (sniffed !== mime) fail('UPLOAD_MIME_MISMATCH', 415);
  try {
    const image = sharp(file, { limitInputPixels: WORKSPACE_ARTIFACT_LIMITS.upload_pixels, failOn: 'warning', sequentialRead: true });
    const metadata = await image.metadata();
    if (metadata.format !== ({ 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' } as Record<string,string>)[mime]
      || !metadata.width || !metadata.height || metadata.width * metadata.height > WORKSPACE_ARTIFACT_LIMITS.upload_pixels || (metadata.pages ?? 1) !== 1) fail('UPLOAD_UNSUPPORTED_IMAGE', 415);
    // stats computes over all decoded pixels without a full raw output buffer.
    await image.stats();
    const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    return { width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height };
  } catch (error) { if (error instanceof WorkspaceArtifactError) throw error; fail('UPLOAD_DECODE_FAILED', 415); }
}

export class WorkspaceArtifactService {
  readonly productionReady: boolean; readonly loopbackOnly: boolean;
  private readonly spool: WorkspacePrivateSpool;
  constructor(private readonly store: WorkspaceStore, private readonly objects: WorkspacePrivateObjectStore, options: { spool?: WorkspacePrivateSpool } = {}) {
    this.productionReady = store.productionReady && objects.productionReady; this.loopbackOnly = objects.loopbackOnly; this.spool = options.spool ?? new WorkspacePrivateSpool();
  }
  async reserveUpload(ownerId: string, taskId: string, raw: unknown) {
    id.parse(ownerId); id.parse(taskId); const parsed = workspaceUploadSchema.safeParse(raw); if (!parsed.success) fail('INVALID_UPLOAD_INPUT', 400);
    const input = parsed.data;
    const fingerprint = digest(JSON.stringify(input));
    return this.store.transaction(ownerId, state => {
      const record = recordFor(state.tasks, ownerId, taskId); const uploads = record.reference_uploads ??= [];
      const existing = uploads.find(item => item.idempotency_key === input.idempotency_key);
      if (existing) { if (existing.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT'); return { upload: publicWorkspaceUpload(existing), duplicate: true }; }
      assertUploadScope(record, input);
      if (uploads.length >= WORKSPACE_ARTIFACT_LIMITS.upload_intents_per_task) fail('UPLOAD_INTENT_LIMIT');
      const active = uploads.filter(item => !['rejected', 'cleaned', 'orphaned'].includes(item.status));
      if (active.length >= WORKSPACE_ARTIFACT_LIMITS.references_per_task || active.reduce((sum,item) => sum + item.size_bytes, 0) + input.size_bytes > WORKSPACE_ARTIFACT_LIMITS.reference_bytes_per_task) fail('REFERENCE_QUOTA_EXCEEDED');
      const uploadId = randomUUID(), now = new Date().toISOString();
      const intent: WorkspaceUploadIntent = { ...input, fingerprint, upload_id: uploadId, reference_id: randomUUID(), revision_id: randomUUID(),
        storage_key: workspaceObjectKey(ownerId, taskId, uploadId), status: 'reserved', created_at: now, updated_at: now };
      uploads.push(intent); return { upload: publicWorkspaceUpload(intent), duplicate: false };
    });
  }
  /** Read-only recovery after a reservation response was lost. Does not inspect,
   * submit or delete any object, and does not allocate another upload identity. */
  async resolveUpload(ownerId: string, taskId: string, idempotencyKey: string) {
    id.parse(ownerId); id.parse(taskId);
    if (!workspaceUploadSchema.shape.idempotency_key.safeParse(idempotencyKey).success) fail('INVALID_UPLOAD_KEY', 400);
    return this.store.read(ownerId, state => {
      const record = recordFor(state.tasks, ownerId, taskId), upload = record.reference_uploads?.find(item => item.idempotency_key === idempotencyKey);
      if (!upload) fail('UPLOAD_NOT_FOUND', 404);
      return { upload: publicWorkspaceUpload(upload), duplicate: true };
    });
  }
  private async load(ownerId: string, taskId: string, uploadId: string) {
    id.parse(ownerId); id.parse(taskId); id.parse(uploadId);
    return this.store.read(ownerId, state => {
      const record = recordFor(state.tasks, ownerId, taskId), upload = record.reference_uploads?.find(item => item.upload_id === uploadId);
      if (!upload) fail('UPLOAD_NOT_FOUND', 404); return upload;
    });
  }
  private async mark(ownerId: string, taskId: string, uploadId: string, status: WorkspaceUploadIntent['status'], errorCode?: string) {
    return this.store.transaction(ownerId, state => {
      const record = recordFor(state.tasks, ownerId, taskId), upload = record.reference_uploads?.find(item => item.upload_id === uploadId);
      if (!upload) fail('UPLOAD_NOT_FOUND', 404);
      // A concurrent reconciliation may already have linked it. Never undo a link.
      if (!['linked', 'cleaned'].includes(upload.status) && !(upload.status === 'orphaned' && status === 'unknown')) { upload.status = status; upload.updated_at = new Date().toISOString(); if (errorCode) upload.error_code = errorCode; }
      return upload;
    });
  }
  async putUpload(ownerId: string, taskId: string, uploadId: string, bytes: AsyncIterable<Uint8Array>, context?: WorkspaceObjectContext) {
    const claimed = await this.store.transaction(ownerId, state => {
      const record = recordFor(state.tasks, ownerId, taskId), upload = record.reference_uploads?.find(item => item.upload_id === uploadId);
      if (!upload) fail('UPLOAD_NOT_FOUND', 404);
      if (upload.status === 'linked') return { upload, duplicate: true };
      if (upload.status !== 'reserved') fail(upload.status === 'unknown' ? 'UPLOAD_OUTCOME_UNKNOWN' : 'UPLOAD_NOT_WRITABLE');
      assertUploadScope(record, upload); upload.status = 'receiving'; upload.updated_at = new Date().toISOString(); return { upload, duplicate: false };
    });
    if (claimed.duplicate) return { upload: publicWorkspaceUpload(claimed.upload), duplicate: true };
    const upload = claimed.upload, object = asObject(ownerId, taskId, upload);
    let staged: Awaited<ReturnType<WorkspacePrivateSpool['prepare']>> | undefined; let writeStarted = false;
    try {
      staged = await this.spool.prepare(bytes, object); await decodeRaster(staged.file, upload.media_type);
      writeStarted = true; await this.objects.put(object, staged.open(), context);
      await staged.dispose();
      await this.mark(ownerId, taskId, uploadId, 'stored');
      return await this.reconcileUpload(ownerId, taskId, uploadId, context);
    } catch (error) {
      const code = error instanceof WorkspaceArtifactError ? error.code : 'UPLOAD_OPERATION_FAILED';
      // Any interrupted object write is ambiguous, including an immutable conflict.
      await this.mark(ownerId, taskId, uploadId, writeStarted ? 'unknown' : 'rejected', code).catch(() => undefined);
      throw error instanceof WorkspaceArtifactError ? error : new WorkspaceArtifactError('UPLOAD_OUTCOME_UNKNOWN', 503);
    } finally { await staged?.dispose(); }
  }
  async getUpload(ownerId: string, taskId: string, uploadId: string) {
    return { upload: publicWorkspaceUpload(await this.load(ownerId, taskId, uploadId)) };
  }
  /** Explicit owner-scoped recovery. No second upload, provider call or overwrite.
   * Absent object after an ambiguous write stays unknown: absence right now does
   * not prove that the remote write cannot finish later. */
  async reconcileUpload(ownerId: string, taskId: string, uploadId: string, context?: WorkspaceObjectContext) {
    const upload = await this.load(ownerId, taskId, uploadId);
    if (['reserved', 'rejected', 'linked', 'cleaned'].includes(upload.status)) return { upload: publicWorkspaceUpload(upload), duplicate: upload.status === 'linked' };
    if (upload.status === 'orphaned') return this.cleanupUpload(ownerId, taskId, uploadId, context);
    const object = asObject(ownerId, taskId, upload);
    let read: WorkspaceObjectRead | null = null;
    let staged: Awaited<ReturnType<WorkspacePrivateSpool['prepare']>> | undefined;
    try {
      read = await this.objects.open(object, context);
      if (!read) return { upload: publicWorkspaceUpload(await this.mark(ownerId, taskId, uploadId, 'unknown', 'OBJECT_NOT_YET_CONFIRMED')), duplicate: false };
      staged = await this.spool.prepare(read.stream, object); const dimensions = await decodeRaster(staged.file, upload.media_type);
      const linked = await this.store.transaction(ownerId, state => {
        const record = recordFor(state.tasks, ownerId, taskId), current = record.reference_uploads?.find(item => item.upload_id === uploadId);
        if (!current) fail('UPLOAD_NOT_FOUND', 404);
        if (current.status === 'linked') return current;
        assertUploadScope(record, current);
        if ((record.references?.length ?? 0) >= WORKSPACE_ARTIFACT_LIMITS.references_per_task) fail('REFERENCE_QUOTA_EXCEEDED');
        const now = new Date().toISOString();
        (record.references ??= []).push({ reference_id: current.reference_id, revision_id: current.revision_id, upload_id: uploadId,
          filename: current.filename, media_type: current.media_type, size_bytes: current.size_bytes, sha256: current.sha256, storage_key: current.storage_key,
          content_revision: current.content_revision, purpose: current.purpose, ...(current.review_index_id ? { review_index_id: current.review_index_id } : {}), role: current.role, ...(current.note ? { note: current.note } : {}), ...dimensions, created_at: now,
          technical_validation: 'full_decode_passed', visual_inspection: 'not_performed' });
        record.task = { ...record.task, state_version: record.task.state_version + 1 }; record.updated_at = now;
        record.events.push({ sequence: (record.events.at(-1)?.sequence ?? 0) + 1, type: 'reference_uploaded', created_at: now,
          data: { reference_id: current.reference_id, state_version: record.task.state_version, visual_inspection: 'not_performed' } });
        current.status = 'linked'; current.updated_at = now; delete current.error_code; return current;
      });
      return { upload: publicWorkspaceUpload(linked), duplicate: false };
    } catch (error) {
      if (error instanceof WorkspaceArtifactError && ['UPLOAD_SCOPE_STALE', 'REFERENCE_UPLOAD_DRAFT_ONLY', 'REFERENCE_UPLOAD_REVIEW_ONLY', 'REFERENCE_UPLOAD_BUSY', 'UPLOAD_REVIEW_STALE', 'REFERENCE_QUOTA_EXCEEDED', 'ARTIFACT_INTEGRITY_FAILED', 'ARTIFACT_SIZE_MISMATCH', 'UPLOAD_MIME_MISMATCH', 'UPLOAD_DECODE_FAILED', 'UPLOAD_UNSUPPORTED_IMAGE'].includes(error.code)) {
        await this.mark(ownerId, taskId, uploadId, 'orphaned', error.code);
        await this.cleanupUpload(ownerId, taskId, uploadId, context).catch(() => undefined);
      }
      throw error;
    } finally { await staged?.dispose(); await read?.dispose(); }
  }
  /** Only unlinked upload-owned objects are eligible, never published artifacts.
   * Failed deletes remain orphaned for a later explicit reconciliation. */
  async cleanupUpload(ownerId: string, taskId: string, uploadId: string, context?: WorkspaceObjectContext) {
    const upload = await this.load(ownerId, taskId, uploadId);
    if (upload.status !== 'orphaned') fail('UPLOAD_NOT_ORPHANED');
    await this.objects.remove(asObject(ownerId, taskId, upload), context);
    return { upload: publicWorkspaceUpload(await this.mark(ownerId, taskId, uploadId, 'cleaned')), duplicate: false };
  }
  /** Recoverable metadata unlink; bytes and immutable reference identity retained.
   * Already-used feedback evidence cannot be removed from its action history. */
  async removeReference(ownerId: string, taskId: string, referenceId: string, raw: unknown) {
    const scope = z.object({ expected_state_version: z.number().int().min(0), content_revision: id }).strict().safeParse(raw);
    if (!scope.success) fail('INVALID_REFERENCE_SCOPE', 400);
    return this.store.transaction(ownerId, state => {
      const record = recordFor(state.tasks, ownerId, taskId), reference = record.references?.find(item => item.reference_id === referenceId);
      if (!reference) fail('REFERENCE_NOT_FOUND', 404);
      if (reference.removed_at) return { removed: true, duplicate: true };
      assertUploadScope(record, { ...scope.data, purpose: reference.purpose, review_index_id: reference.review_index_id });
      if (record.actions.some(action => JSON.stringify(action.payload).includes('"' + referenceId + '"'))) fail('REFERENCE_ALREADY_USED');
      const now = new Date().toISOString(); reference.removed_at = now;
      record.task = { ...record.task, state_version: record.task.state_version + 1 }; record.updated_at = now;
      record.events.push({ sequence: (record.events.at(-1)?.sequence ?? 0) + 1, type: 'reference_removed', created_at: now,
        data: { reference_id: referenceId, state_version: record.task.state_version } });
      return { removed: true, duplicate: false };
    });
  }
  private async download(ownerId: string, taskId: string, item: WorkspaceArtifact | WorkspaceReference, context?: WorkspaceObjectContext): Promise<WorkspaceVerifiedDownload> {
    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/zip', 'text/html', 'text/plain', 'application/json']);
    if (!allowed.has(item.media_type) || !filename.safeParse(item.filename).success) fail('ARTIFACT_METADATA_INVALID');
    const object = asObject(ownerId, taskId, item), read = await this.objects.open(object, context);
    if (!read) fail('ARTIFACT_UNAVAILABLE', 404);
    try {
      const staged = await this.spool.prepare(read.stream, object), stream = staged.open();
      return { stream, filename: item.filename, media_type: item.media_type, size_bytes: item.size_bytes, sha256: item.sha256,
        async dispose() { stream.destroy(); await staged.dispose(); } };
    } finally { await read.dispose(); }
  }
  async openArtifact(ownerId: string, taskId: string, artifactId: string, context?: WorkspaceObjectContext) {
    const artifact = await this.store.read(ownerId, state => recordFor(state.tasks, ownerId, taskId).artifacts.find(item => item.artifact_id === artifactId));
    if (!artifact) fail('ARTIFACT_NOT_FOUND', 404);
    if (artifact.verification !== 'verified') fail('ARTIFACT_UNAVAILABLE');
    return this.download(ownerId, taskId, artifact, context);
  }
  async openReference(ownerId: string, taskId: string, referenceId: string, context?: WorkspaceObjectContext) {
    const reference = await this.store.read(ownerId, state => recordFor(state.tasks, ownerId, taskId).references?.find(item => item.reference_id === referenceId && !item.removed_at));
    if (!reference) fail('REFERENCE_NOT_FOUND', 404);
    return this.download(ownerId, taskId, reference, context);
  }
}

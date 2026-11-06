import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from '../tools/creative-quality/sharp.ts';
import { MemoryWorkspaceStore, type WorkspaceRecord } from '../uid-workspace-store.ts';
import { createWorkspaceTask } from '../uid-workspace-task.ts';
import { WorkspaceArtifactService, FileWorkspaceObjectStore, SupabaseWorkspaceObjectStore, WorkspacePrivateSpool, WORKSPACE_ARTIFACT_LIMITS,
  type WorkspacePrivateObjectStore, type WorkspaceObjectIdentity, publicWorkspaceReference } from '../uid-workspace-artifacts.ts';
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#556677' } }).png().toBuffer();
const request = (bytes: Buffer = png, extra: Record<string, unknown> = {}) => ({ idempotency_key: 'upload-key-1', expected_state_version: 0, content_revision: 'content-1', filename: 'reference.png', media_type: 'image/png', size_bytes: bytes.length, sha256: sha(bytes), role: 'product', ...extra });
async function* pieces(bytes: Uint8Array, size = 13) { for (let index = 0; index < bytes.length; index += size) yield bytes.subarray(index, index + size); }
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'uid-artifacts-test-')); const store = new MemoryWorkspaceStore();
  const objects = new FileWorkspaceObjectStore(directory, { environment: 'test', publicOrigin: 'http://127.0.0.1' });
  const record: WorkspaceRecord = { owner_id: 'alice', task: createWorkspaceTask('task-1', { snapshot_id: 'snapshot-1', content_revision: 'content-1', canonical_version: 'canonical-1', content_digest: 'digest-1', assets: [] }),
    brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://example.com/product' }, created_at: '', updated_at: '', actions: [], events: [], artifacts: [], review_manifest: null, preview: null, content: null, quality: [] };
  await store.transaction('alice', state => state.tasks.push(record));
  return { directory, store, objects, service: new WorkspaceArtifactService(store, objects), cleanup: () => rm(directory, { recursive: true, force: true }) };
}
async function upload(context: Awaited<ReturnType<typeof setup>>, extra: Record<string,unknown> = {}, bytes = png) {
  const prepared = await context.service.reserveUpload('alice', 'task-1', request(bytes, extra));
  return context.service.putUpload('alice', 'task-1', prepared.upload.upload_id, pieces(bytes));
}

test('private actual upload survives service restart, full decode is separate from pixel inspection', async () => {
  const c = await setup(); try {
    const result = await upload(c);
    assert.equal(result.upload.status, 'linked'); assert.equal('storage_key' in result.upload, false);
    const record = await c.store.read('alice', s => s.tasks[0]);
    assert.equal(record.task.state_version, 1); assert.equal(record.artifacts.length, 0); assert.equal(record.references?.length, 1);
    const reference = record.references![0]; assert.equal(reference.visual_inspection, 'not_performed'); assert.equal(reference.technical_validation, 'full_decode_passed');
    assert.equal(reference.width, 12); assert.equal(reference.height, 8); assert.equal(reference.purpose, 'brief');
    const fresh = new WorkspaceArtifactService(c.store, c.objects); const download = await fresh.openReference('alice', 'task-1', reference.reference_id);
    try { const chunks = []; for await (const chunk of download.stream) chunks.push(chunk); assert.deepEqual(Buffer.concat(chunks), png); } finally { await download.dispose(); }
    assert.equal(publicWorkspaceReference(reference).sha256, sha(png)); assert.equal('storage_key' in publicWorkspaceReference(reference), false);
  } finally { await c.cleanup(); }
});

test('owner/task binding rejects cross-owner and cross-task access without creating an object', async () => {
  const c = await setup(); try {
    const prepared = await c.service.reserveUpload('alice', 'task-1', request());
    await assert.rejects(() => c.service.putUpload('bob', 'task-1', prepared.upload.upload_id, pieces(png)), /TASK_NOT_FOUND/);
    await assert.rejects(() => c.service.putUpload('alice', 'another-task', prepared.upload.upload_id, pieces(png)), /TASK_NOT_FOUND/);
    await assert.rejects(() => c.service.getUpload('bob', 'task-1', prepared.upload.upload_id), /TASK_NOT_FOUND/);
    assert.deepEqual(await readdir(c.directory), []);
  } finally { await c.cleanup(); }
});

test('idempotent reservation and completed PUT never duplicate reference/state transition', async () => {
  const c = await setup(); try {
    const a = await c.service.reserveUpload('alice', 'task-1', request()), b = await c.service.reserveUpload('alice', 'task-1', request());
    assert.equal(a.upload.upload_id, b.upload.upload_id); assert.equal(b.duplicate, true);
    await assert.rejects(() => c.service.reserveUpload('alice', 'task-1', request(png, { note: 'different' })), /IDEMPOTENCY_CONFLICT/);
    await c.service.putUpload('alice', 'task-1', a.upload.upload_id, pieces(png));
    let consumed = false;
    const result = await c.service.putUpload('alice', 'task-1', a.upload.upload_id, { async *[Symbol.asyncIterator]() { consumed = true; yield png; } });
    assert.equal(result.duplicate, true); assert.equal(consumed, false);
    assert.equal(await c.store.read('alice', s => s.tasks[0].references?.length), 1);
    assert.equal(await c.store.read('alice', s => s.tasks[0].task.state_version), 1);
  } finally { await c.cleanup(); }
});

test('strict upload metadata rejects URLs, HTML/PDF/SVG, unsafe filenames and excessive bytes before storage', async () => {
  const c = await setup(); try {
    for (const extra of [{ url: 'https://evil.test/a' }, { media_type: 'image/svg+xml' }, { media_type: 'application/pdf' }, { filename: '../x.png' }, { filename: 'x\r\n.html' }, { filename: 'CON.png' }, { size_bytes: WORKSPACE_ARTIFACT_LIMITS.upload_bytes + 1 }, { sha256: 'bad' }]) {
      await assert.rejects(() => c.service.reserveUpload('alice', 'task-1', request(png, extra)), /INVALID_UPLOAD_INPUT/);
    }
    assert.deepEqual(await readdir(c.directory), []);
  } finally { await c.cleanup(); }
});

for (const [label, data, extra, code] of [
  ['mime spoof', png, { media_type: 'image/jpeg' }, 'UPLOAD_MIME_MISMATCH'],
  ['truncated header', png.subarray(0, 35), {}, 'UPLOAD_DECODE_FAILED'],
  ['excess actual bytes', png, { size_bytes: png.length - 1 }, 'ARTIFACT_SIZE_MISMATCH'],
  ['short actual bytes', png, { size_bytes: png.length + 1 }, 'ARTIFACT_INTEGRITY_FAILED'],
  ['wrong digest', png, { sha256: 'a'.repeat(64) }, 'ARTIFACT_INTEGRITY_FAILED'],
] as const) test(label + ' fails before object write and has a known rejection', async () => {
  const c = await setup(); try {
    const prepared = await c.service.reserveUpload('alice', 'task-1', request(Buffer.from(data), extra));
    await assert.rejects(() => c.service.putUpload('alice', 'task-1', prepared.upload.upload_id, pieces(data)), new RegExp(code));
    assert.equal((await c.service.getUpload('alice', 'task-1', prepared.upload.upload_id)).upload.status, 'rejected');
    assert.deepEqual(await readdir(c.directory), []);
  } finally { await c.cleanup(); }
});

test('decompression bomb dimensions fail full decoder and animated input is rejected', async () => {
  const c = await setup(); try {
    // Small compressed PNG with dimensions above configured pixel budget.
    const large = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await assert.rejects(() => upload(c, {}, large), /UPLOAD_DECODE_FAILED/);
    const animated = await sharp({ create: { width: 8, height: 16, channels: 3, background: '#777777' } }).raw().toBuffer();
    animated.fill(0x22, animated.length / 2);
    const webp = await sharp(animated, { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    await assert.rejects(() => upload(c, { idempotency_key: 'animated-1', media_type: 'image/webp', filename: 'animated.webp' }, webp), /UPLOAD_UNSUPPORTED_IMAGE/);
  } finally { await c.cleanup(); }
});

test('concurrent claims consume raw bytes only once', async () => {
  const c = await setup(); try {
    const prepared = await c.service.reserveUpload('alice', 'task-1', request());
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const first = c.service.putUpload('alice', 'task-1', prepared.upload.upload_id, { async *[Symbol.asyncIterator]() { await gate; yield png; } });
    await new Promise(resolve => setTimeout(resolve, 30));
    await assert.rejects(() => c.service.putUpload('alice', 'task-1', prepared.upload.upload_id, pieces(png)), /UPLOAD_NOT_WRITABLE/);
    release(); await first;
  } finally { await c.cleanup(); }
});

test('state race after object write never links stale evidence; orphan is cleaned', async () => {
  const c = await setup(); try {
    const wrapped: WorkspacePrivateObjectStore = { ...c.objects, kind: c.objects.kind, productionReady: false, loopbackOnly: true,
      async put(object, bytes) { await c.objects.put(object, bytes); await c.store.transaction('alice', s => { const r = s.tasks[0]; r.task = { ...r.task, state_version: 1, stage: 'research' }; }); },
      open: c.objects.open.bind(c.objects), remove: c.objects.remove.bind(c.objects) };
    c.service = new WorkspaceArtifactService(c.store, wrapped);
    const prepared = await c.service.reserveUpload('alice', 'task-1', request());
    await assert.rejects(() => c.service.putUpload('alice', 'task-1', prepared.upload.upload_id, pieces(png)), /UPLOAD_SCOPE_STALE/);
    assert.equal((await c.service.getUpload('alice', 'task-1', prepared.upload.upload_id)).upload.status, 'cleaned');
    assert.equal(await c.store.read('alice', s => s.tasks[0].references?.length ?? 0), 0); assert.deepEqual(await readdir(c.directory), []);
  } finally { await c.cleanup(); }
});

test('ambiguous successful storage write reconciles by exact immutable bytes without another write', async () => {
  const c = await setup(); let writes = 0; try {
    const wrapped: WorkspacePrivateObjectStore = { kind: 'ambiguous-test', productionReady: false, loopbackOnly: true,
      async put(object, bytes) { writes++; await c.objects.put(object, bytes); throw new Error('remote secret must not escape'); },
      open: c.objects.open.bind(c.objects), remove: c.objects.remove.bind(c.objects) };
    c.service = new WorkspaceArtifactService(c.store, wrapped); const prepared = await c.service.reserveUpload('alice', 'task-1', request());
    await assert.rejects(() => c.service.putUpload('alice', 'task-1', prepared.upload.upload_id, pieces(png)), /UPLOAD_OUTCOME_UNKNOWN/);
    assert.equal((await c.service.getUpload('alice', 'task-1', prepared.upload.upload_id)).upload.status, 'unknown');
    await assert.rejects(() => c.service.putUpload('alice', 'task-1', prepared.upload.upload_id, pieces(png)), /UPLOAD_OUTCOME_UNKNOWN/);
    assert.equal((await c.service.reconcileUpload('alice', 'task-1', prepared.upload.upload_id)).upload.status, 'linked'); assert.equal(writes, 1);
    assert.equal(JSON.stringify(await c.store.read('alice', s => s)).includes('remote secret'), false);
  } finally { await c.cleanup(); }
});

test('uncertain absent storage outcome stays unknown and is never automatically resubmitted', async () => {
  const c = await setup(); try {
    const wrapped: WorkspacePrivateObjectStore = { kind: 'missing-test', productionReady: false, loopbackOnly: true,
      async put() { throw new Error('timeout'); }, open: c.objects.open.bind(c.objects), remove: c.objects.remove.bind(c.objects) };
    c.service = new WorkspaceArtifactService(c.store, wrapped); const prepared = await c.service.reserveUpload('alice', 'task-1', request());
    await assert.rejects(() => c.service.putUpload('alice', 'task-1', prepared.upload.upload_id, pieces(png)), /UPLOAD_OUTCOME_UNKNOWN/);
    assert.equal((await c.service.reconcileUpload('alice', 'task-1', prepared.upload.upload_id)).upload.status, 'unknown');
  } finally { await c.cleanup(); }
});

test('corrupt private object cannot be delivered even when metadata claims verified', async () => {
  const c = await setup(); try {
    const result = await upload(c), ref = await c.store.read('alice', s => s.tasks[0].references![0]);
    const diskPath = path.join(c.directory, sha(ref.storage_key));
    const corrupt = Buffer.from(png); corrupt[40] ^= 1; await writeFile(diskPath, corrupt);
    await assert.rejects(() => c.service.openReference('alice', 'task-1', result.upload.reference_id), /ARTIFACT_INTEGRITY_FAILED/);
    await assert.rejects(() => c.service.openReference('bob', 'task-1', result.upload.reference_id), /TASK_NOT_FOUND/);
  } finally { await c.cleanup(); }
});

test('feedback reference cannot mutate original brief and soft removal retains immutable bytes', async () => {
  const c = await setup(); try {
    await c.store.transaction('alice', s => { s.tasks[0].task = { ...s.tasks[0].task, stage: 'content_review' }; });
    await assert.rejects(() => c.service.reserveUpload('alice', 'task-1', request()), /REFERENCE_UPLOAD_DRAFT_ONLY/);
    const result = await upload(c, { purpose: 'feedback' });
    const reference = await c.store.read('alice', s => s.tasks[0].references![0]); assert.equal(reference.purpose, 'feedback');
    await c.service.removeReference('alice', 'task-1', result.upload.reference_id, { expected_state_version: 1, content_revision: 'content-1' });
    assert.equal(await c.store.read('alice', s => s.tasks[0].task.state_version), 2);
    await assert.rejects(() => c.service.openReference('alice', 'task-1', result.upload.reference_id), /REFERENCE_NOT_FOUND/);
    assert.equal((await readdir(c.directory)).length, 1);
  } finally { await c.cleanup(); }
});

test('filesystem object adapter rejects public/non-private/production configuration and refuses overwrite', async () => {
  assert.throws(() => new FileWorkspaceObjectStore('/tmp/x', { environment: 'production' as any, publicOrigin: 'https://example.com' }), /LOCAL_ARTIFACT_STORE_NOT_ALLOWED/);
  const c = await setup(); try {
    await upload(c); const ref = await c.store.read('alice', s => s.tasks[0].references![0]); const object = { owner_id: 'alice', task_id: 'task-1', ...ref };
    await assert.rejects(() => c.objects.put(object, pieces(png)), /IMMUTABLE_OBJECT_EXISTS/);
    await assert.rejects(() => c.objects.open({ ...object, owner_id: 'bob' }), /OBJECT_SCOPE_MISMATCH/);
    await chmod(c.directory, 0o755); await assert.rejects(() => c.objects.open(object), /ARTIFACT_DIRECTORY_NOT_PRIVATE/);
  } finally { await c.cleanup(); }
});

test('Supabase storage pins origin/private bucket, create-only request, JWT and no public/signed URL', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []; let stored = Buffer.alloc(0);
  const objects = new SupabaseWorkspaceObjectStore({ url: 'https://abcdefghijkl.supabase.co', bucket: 'reviewed-private', reviewedPrivateBucket: true, reviewedObjectPolicies: true,
    authorization: { mode: 'user', publicKey: 'sb_publishable_test' }, fetcher: (async (url, init) => {
      calls.push({ url: String(url), init: init! });
      if (init!.method === 'POST') { const parts = []; for await (const chunk of init!.body as any) parts.push(chunk); stored = Buffer.concat(parts); return new Response('{}', { status: 200 }); }
      if (init!.method === 'GET') return new Response(stored, { headers: { 'Content-Length': String(stored.length) } });
      return new Response('{}');
    }) as typeof fetch });
  const object = { owner_id: 'alice', task_id: 'task-1', storage_key: `${sha('alice')}/${sha('task-1')}/version-1`, media_type: 'image/png', size_bytes: png.length, sha256: sha(png) };
  await assert.rejects(() => objects.put(object, pieces(png)), /STORAGE_USER_AUTH_REQUIRED/);
  await objects.put(object, pieces(png), { accessToken: 'header.body.signature' });
  const read = await objects.open(object, { accessToken: 'header.body.signature' }); assert.ok(read); try { for await (const _ of read.stream) {} } finally { await read.dispose(); }
  assert.equal(calls.length, 2);
  for (const call of calls) { assert.equal(new URL(call.url).origin, 'https://abcdefghijkl.supabase.co'); assert.equal(call.init.redirect, 'error'); assert.ok(!/public|sign\//.test(call.url)); assert.equal((call.init.headers as any).Authorization, 'Bearer header.body.signature'); }
  assert.equal((calls[0].init.headers as any)['x-upsert'], 'false');
  assert.throws(() => new SupabaseWorkspaceObjectStore({ url: 'http://127.0.0.1', bucket: 'public', reviewedPrivateBucket: true, reviewedObjectPolicies: true, authorization: { mode: 'user', publicKey: 'sb_publishable_test' } }), /PRIVATE_STORAGE_REVIEW_REQUIRED/);
  assert.throws(() => new SupabaseWorkspaceObjectStore({ url: 'https://abcdefghijkl.supabase.co', bucket: 'private', reviewedPrivateBucket: false as any, reviewedObjectPolicies: true, authorization: { mode: 'user', publicKey: 'sb_publishable_test' } }), /PRIVATE_STORAGE_REVIEW_REQUIRED/);
});

test('spool enforces concurrency and validates all bytes before returning a response stream', async () => {
  const spool = new WorkspacePrivateSpool({ maxConcurrent: 1 }); const first = await spool.prepare(pieces(png), { size_bytes: png.length, sha256: sha(png) });
  try { await assert.rejects(() => spool.prepare(pieces(png), { size_bytes: png.length, sha256: sha(png) }), /ARTIFACT_TRANSFER_BUSY/); }
  finally { await first.dispose(); }
  const next = await spool.prepare(pieces(png), { size_bytes: png.length, sha256: sha(png) }); await next.dispose();
  await assert.rejects(() => spool.prepare(pieces(png), { size_bytes: png.length, sha256: 'a'.repeat(64) }), /ARTIFACT_INTEGRITY_FAILED/);
});

function largeStoredZip() {
  // Two valid STORE-mode files of 17MiB each, streamed in 64KiB chunks.
  // The ZIP fixture is deliberately >32MiB without constructing a giant Buffer.
  const size = 17 * 1024 * 1024, chunk = Buffer.alloc(64 * 1024, 0x61);
  const table = Array.from({ length: 256 }, (_, i) => { for (let bit = 0; bit < 8; bit++) i = (i >>> 1) ^ ((i & 1) ? 0xedb88320 : 0); return i >>> 0; });
  let crc = 0xffffffff; for (let n = 0; n < size; n++) crc = (crc >>> 8) ^ table[(crc ^ 0x61) & 255]; crc = (crc ^ 0xffffffff) >>> 0;
  const names = [Buffer.from('first.txt'), Buffer.from('second.txt')], headers: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const name of names) {
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(size, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26); headers.push(Buffer.concat([header, name]));
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(size, 20); entry.writeUInt32LE(size, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42); central.push(Buffer.concat([entry, name]));
    offset += header.length + name.length + size;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10); end.writeUInt32LE(central.reduce((sum,c) => sum + c.length, 0), 12); end.writeUInt32LE(offset, 16);
  const length = offset + central.reduce((sum,c) => sum + c.length, 0) + end.length;
  const stream = () => ({ async *[Symbol.asyncIterator]() { for (const header of headers) { yield header; for (let i = 0; i < size; i += chunk.length) yield chunk; } for (const part of central) yield part; yield end; } });
  return { length, stream };
}

test('verified private delivery streams an actual 34MiB ZIP with complete digest before exposing headers', async () => {
  const c = await setup(); try {
    const zip = largeStoredZip(); const hasher = createHash('sha256'); for await (const chunk of zip.stream()) hasher.update(chunk);
    const object: WorkspaceObjectIdentity = { owner_id: 'alice', task_id: 'task-1', storage_key: `${sha('alice')}/${sha('task-1')}/zip-v1`, size_bytes: zip.length, sha256: hasher.digest('hex'), media_type: 'application/zip' };
    assert.ok(zip.length > 32 * 1024 * 1024);
    await c.objects.put(object, zip.stream());
    await c.store.transaction('alice', s => s.tasks[0].artifacts.push({ artifact_id: 'package-1', revision_id: 'revision-1', filename: 'Verified-Package.zip', media_type: object.media_type, size_bytes: object.size_bytes, sha256: object.sha256, content_revision: 'content-1', kind: 'package', verification: 'verified', storage_key: object.storage_key }));
    const download = await c.service.openArtifact('alice', 'task-1', 'package-1');
    try {
      assert.equal(download.size_bytes, zip.length); assert.equal(download.media_type, 'application/zip');
      // Independent ZIP implementation checks central directory, actual file CRCs
      // and decompression by streaming. Python is not required by production.
      const { spawnSync } = await import('node:child_process');
      const check = spawnSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.namelist()==["first.txt","second.txt"]; assert z.testzip() is None', String(download.stream.path)], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
      let bytes = 0; const checkHash = createHash('sha256');
      for await (const chunk of download.stream) { assert.ok(chunk.length <= 64 * 1024); bytes += chunk.length; checkHash.update(chunk); }
      assert.equal(bytes, zip.length); assert.equal(checkHash.digest('hex'), object.sha256);
    } finally { await download.dispose(); }
    await c.store.transaction('alice', s => { s.tasks[0].artifacts[0].sha256 = '0'.repeat(64); });
    await assert.rejects(() => c.service.openArtifact('alice', 'task-1', 'package-1'), /ARTIFACT_INTEGRITY_FAILED/);
  } finally { await c.cleanup(); }
});

test('feedback intake enforces latest review index, active job guard, and used-evidence removal guard', async () => {
  const c = await setup(); try {
    await c.store.transaction('alice', s => { const r = s.tasks[0]; r.task = { ...r.task, stage: 'review' }; r.review_manifest = { index_id: 'a'.repeat(64) } as any; });
    await assert.rejects(() => c.service.reserveUpload('alice', 'task-1', request(png, { purpose: 'feedback', review_index_id: 'b'.repeat(64) })), /UPLOAD_REVIEW_STALE/);
    const result = await upload(c, { purpose: 'feedback', review_index_id: 'a'.repeat(64) });
    await c.store.transaction('alice', s => s.tasks[0].actions.push({ action_id: 'action-1', idempotency_key: 'action-key', fingerprint: 'fingerprint', type: 'feedback', status: 'succeeded', expected_state_version: 1, content_revision: 'content-1', created_at: '', actor_id: 'alice', payload: { reference_ids: [result.upload.reference_id] } }));
    await assert.rejects(() => c.service.removeReference('alice', 'task-1', result.upload.reference_id, { expected_state_version: 1, content_revision: 'content-1' }), /REFERENCE_ALREADY_USED/);
    await c.store.transaction('alice', s => { s.tasks[0].actions[0].status = 'unknown'; });
    await assert.rejects(() => c.service.reserveUpload('alice', 'task-1', request(png, { idempotency_key: 'new-upload', expected_state_version: 1, purpose: 'feedback', review_index_id: 'a'.repeat(64) })), /REFERENCE_UPLOAD_BUSY/);
  } finally { await c.cleanup(); }
});

test('storage errors never expose HTTP response or server credentials', async () => {
  const c = await setup(); try {
    const objects = new SupabaseWorkspaceObjectStore({ url: 'https://abcdefghijkl.supabase.co', bucket: 'reviewed-private', reviewedPrivateBucket: true, reviewedObjectPolicies: true,
      authorization: { mode: 'server', dedicatedRoleApproved: true, getHeaders: async () => ({ apikey: 'secret-server-key', authorization: 'Bearer secret-server-key' }) },
      fetcher: (async () => new Response('secret-server-key internal stack trace', { status: 500 })) as typeof fetch });
    c.service = new WorkspaceArtifactService(c.store, objects); const prepared = await c.service.reserveUpload('alice', 'task-1', request());
    await assert.rejects(() => c.service.putUpload('alice', 'task-1', prepared.upload.upload_id, pieces(png)), /OBJECT_OUTCOME_UNKNOWN/);
    assert.equal(JSON.stringify(await c.store.read('alice', s => s)).includes('secret-server-key'), false);
    assert.equal(JSON.stringify(await c.service.getUpload('alice', 'task-1', prepared.upload.upload_id)).includes('secret-server-key'), false);
  } finally { await c.cleanup(); }
});

test('lost reservation response resolves by exact owner/task/idempotency key without object access', async () => {
  const c = await setup(); try {
    const first = await c.service.reserveUpload('alice', 'task-1', request());
    const resolved = await c.service.resolveUpload('alice', 'task-1', 'upload-key-1'); assert.equal(resolved.upload.upload_id, first.upload.upload_id); assert.equal(resolved.duplicate, true);
    await assert.rejects(() => c.service.resolveUpload('bob', 'task-1', 'upload-key-1'), /TASK_NOT_FOUND/);
    await assert.rejects(() => c.service.resolveUpload('alice', 'task-1', 'other-key'), /UPLOAD_NOT_FOUND/);
    assert.deepEqual(await readdir(c.directory), []);
  } finally { await c.cleanup(); }
});

test('trusted generated object helper verifies input plus stored readback without creating fake task artifacts', async () => {
  const { workspaceObjectKey, writeVerifiedWorkspaceObject } = await import('../uid-workspace-artifacts.ts');
  const c = await setup(); try {
    const object = { owner_id: 'alice', task_id: 'task-1', storage_key: workspaceObjectKey('alice', 'task-1', sha(png)), size_bytes: png.length, sha256: sha(png), media_type: 'image/png' };
    const result = await writeVerifiedWorkspaceObject(c.objects, object, pieces(png)); assert.equal(result.sha256, sha(png));
    const again = await writeVerifiedWorkspaceObject(c.objects, object, pieces(png)); assert.deepEqual(again, result);
    assert.equal(await c.store.read('alice', s => s.tasks[0].artifacts.length), 0);
    assert.equal((await readdir(c.directory)).length, 1);
  } finally { await c.cleanup(); }
});

test('lost link COMMIT response recovers prior linked result without duplicating immutable reference', async () => {
  const c = await setup(); try {
    let lost = false;
    const uncertain = { kind: c.store.kind, productionReady: false, read: c.store.read.bind(c.store), async transaction<T>(owner: string, mutate: (state: any) => T) {
      const result = await c.store.transaction(owner, mutate);
      const linked = await c.store.read(owner, s => s.tasks[0]?.reference_uploads?.[0]?.status === 'linked');
      if (linked && !lost) { lost = true; throw new Error('STORE_OUTCOME_UNKNOWN'); }
      return result;
    } };
    c.service = new WorkspaceArtifactService(uncertain, c.objects); const prepared = await c.service.reserveUpload('alice', 'task-1', request());
    await assert.rejects(() => c.service.putUpload('alice', 'task-1', prepared.upload.upload_id, pieces(png)), /UPLOAD_OUTCOME_UNKNOWN/);
    assert.equal((await c.service.reconcileUpload('alice', 'task-1', prepared.upload.upload_id)).upload.status, 'linked');
    assert.equal(await c.store.read('alice', s => s.tasks[0].references!.length), 1);
    assert.equal(await c.store.read('alice', s => s.tasks[0].task.state_version), 1);
  } finally { await c.cleanup(); }
});

test('failed orphan delete is durable and later reconciliation cleans exact unlinked object', async () => {
  const c = await setup(); let denyDelete = true; try {
    const wrapped: WorkspacePrivateObjectStore = { kind: 'delete-fault-test', productionReady: false, loopbackOnly: true,
      async put(object, bytes) { await c.objects.put(object, bytes); await c.store.transaction('alice', s => { s.tasks[0].task = { ...s.tasks[0].task, state_version: 1 }; }); },
      open: c.objects.open.bind(c.objects), async remove(object) { if (denyDelete) throw new Error('delete outcome unknown'); await c.objects.remove(object); } };
    c.service = new WorkspaceArtifactService(c.store, wrapped); const prepared = await c.service.reserveUpload('alice', 'task-1', request());
    await assert.rejects(() => c.service.putUpload('alice', 'task-1', prepared.upload.upload_id, pieces(png)), /UPLOAD_SCOPE_STALE/);
    assert.equal((await c.service.getUpload('alice', 'task-1', prepared.upload.upload_id)).upload.status, 'orphaned');
    denyDelete = false;
    assert.equal((await c.service.reconcileUpload('alice', 'task-1', prepared.upload.upload_id)).upload.status, 'cleaned'); assert.deepEqual(await readdir(c.directory), []);
  } finally { await c.cleanup(); }
});

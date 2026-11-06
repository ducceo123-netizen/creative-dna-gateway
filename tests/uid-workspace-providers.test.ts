import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { WorkspacePublicSourceProvider, WorkspaceSourceError, WORKSPACE_SOURCE_LIMITS, isWorkspacePublicAddress,
  workspaceSourceScope, type WorkspaceSourceNetwork, type WorkspaceSourceHttpResponse, type WorkspacePublicSourceAuthorization } from '../uid-workspace-providers.ts';
import { workspaceObjectKey, type WorkspacePrivateObjectStore } from '../uid-workspace-artifacts.ts';
import { createWorkspaceTask } from '../uid-workspace-task.ts';
import type { WorkspaceStageContext } from '../uid-workspace-runner.ts';
import sharp from '../tools/creative-quality/sharp.ts';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const source = 'https://shop.example.com/products/case';
const cdn = 'https://cdn.example.com';
const now = Date.parse('2026-11-06T10:00:00.000Z');
function context(): WorkspaceStageContext {
  const task = createWorkspaceTask('task-a', { snapshot_id: 'snapshot-a', canonical_version: 'canonical-a', content_revision: 'content-a', content_digest: sha('brief'), assets: [] });
  const action = { action_id: 'action-a', idempotency_key: 'key-a', fingerprint: sha('action'), type: 'start' as const, payload: {}, status: 'running' as const, expected_state_version: task.state_version, content_revision: 'content-a', created_at: new Date(now).toISOString(), actor_id: 'owner-a' };
  return { owner_id: 'owner-a', action, signal: new AbortController().signal,
    record: { owner_id: 'owner-a', task, brief: { brand: 'PawfectHouse', material: 'onepage', source_url: source },
      actions: [action], events: [], artifacts: [], review_manifest: null, preview: null, content: null, quality: [], created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() },
    run: { run_id: 'run-a', action_id: 'action-a', stage: 'research', operation_id: 'operation-a', expected_state_version: task.state_version,
      snapshot_id: 'snapshot-a', content_revision: 'content-a', fence: 1, status: 'in_flight', lease_owner: 'fixture', lease_expires_at: new Date(now + 60000).toISOString(), created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() } };
}
function response(bytes: string | Uint8Array = '<html><p>Real bounded fixture</p></html>', overrides: Partial<WorkspaceSourceHttpResponse> = {}): WorkspaceSourceHttpResponse {
  const data = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': String(data.length) },
    peer_address: '93.184.216.34', body: (async function* () { yield data; })(), dispose() {}, ...overrides };
}
function fixture() {
  const values = new Map<string, Uint8Array>();
  const requests: Array<{ url: string; address: string }> = [], dns: string[] = [];
  let authorizations = 0, opens = 0, puts = 0, dispose = 0;
  let handler = (url: string): WorkspaceSourceHttpResponse => response();
  let resolver: WorkspaceSourceNetwork['resolve'] = async () => [{ address: '93.184.216.34', family: 4 }];
  let grant: WorkspacePublicSourceAuthorization | null = { authorization_id: 'grant-a', owner_id: 'owner-a', task_id: 'task-a', canonical_version: 'canonical-a', source_url: source,
    expires_at: new Date(now + 60000).toISOString(), allowed_origins: ['https://shop.example.com', cdn] };
  let onGrant: (() => void) | undefined;
  let putError: 'before' | 'after' | undefined, corrupt = false;
  const objects: WorkspacePrivateObjectStore = { kind: 'test-memory', productionReady: false, loopbackOnly: true,
    async put(object, stream) {
      puts++; if (putError === 'before') throw new Error('credential must never leak');
      const chunks: Uint8Array[] = []; for await (const chunk of stream) chunks.push(new Uint8Array(chunk));
      const bytes = Buffer.concat(chunks); assert.equal(sha(bytes), object.sha256); assert.equal(bytes.length, object.size_bytes);
      const old = values.get(object.storage_key); if (old) assert.deepEqual(old, bytes);
      else values.set(object.storage_key, bytes);
      if (putError === 'after') throw new Error('uncertain store write');
    },
    async open(object) { opens++; const bytes = values.get(object.storage_key); if (!bytes) return null;
      return { stream: (async function* () { yield corrupt ? new Uint8Array([1]) : new Uint8Array(bytes); })(), async dispose() { dispose++; } }; },
    async remove() { throw new Error('never removes source evidence'); },
  };
  const network: WorkspaceSourceNetwork = { async resolve(host, signal) { dns.push(host); return resolver(host, signal); },
    async get(url, address) { requests.push({ url: url.href, address: address.address }); const value = handler(url.href), old = value.dispose; value.dispose = () => { dispose++; old(); }; return value; } };
  const provider = new WorkspacePublicSourceProvider({ objects, network, now: () => now, async authorize() { authorizations++; onGrant?.(); return structuredClone(grant); } });
  return { provider, values, requests, dns, objects, network,
    stats: () => ({ authorizations, opens, puts, dispose }),
    setResponse(fn: typeof handler) { handler = fn; }, setResolver(fn: typeof resolver) { resolver = fn; },
    getGrant: () => grant!, setGrant(value: WorkspacePublicSourceAuthorization | null) { grant = value; },
    onGrant(fn: () => void) { onGrant = fn; }, setPutError(value: typeof putError) { putError = value; }, setCorrupt() { corrupt = true; } };
}
const capture = (f: ReturnType<typeof fixture>, c = context(), url = source) => f.provider.capture(c, { url, kind: 'document' });
async function rejectsCode(call: Promise<unknown>, code: string) { await assert.rejects(call, error => error instanceof WorkspaceSourceError && error.code === code); }

test('construction is inert, requires explicit authorization, and test seams are never production ready', async () => {
  const f = fixture(); assert.deepEqual(f.stats(), { authorizations: 0, opens: 0, puts: 0, dispose: 0 }); assert.equal(f.provider.productionReady, false);
  const native = new WorkspacePublicSourceProvider({ objects: { ...f.objects, productionReady: true, loopbackOnly: false }, authorize: async () => null });
  assert.equal(native.productionReady, true); assert.deepEqual(f.dns, []); assert.deepEqual(f.requests, []);
  f.setGrant(null); await rejectsCode(capture(f), 'SOURCE_AUTHORIZATION_REQUIRED'); assert.equal(f.requests.length, 0);
});
test('captures actual source bytes, retains immutable owner/task evidence, and reopens without fetching', async () => {
  const f = fixture(), c = context(), acquired = await capture(f, c);
  assert.match(acquired.evidence_ref, /^source:[a-f0-9]{64}:\d+$/); assert.equal(acquired.semantic_inspection, 'not_performed');
  assert.equal(acquired.sha256, sha('<html><p>Real bounded fixture</p></html>')); assert.deepEqual(acquired.scope, workspaceSourceScope(c));
  assert.equal(f.values.size, 2); assert.equal(f.stats().authorizations, 2); assert.equal(f.requests.length, 1);
  const reopened = await f.provider.reopen(c, acquired.evidence_ref, acquired.scope);
  assert.equal(reopened.text, '<html><p>Real bounded fixture</p></html>'); assert.equal(sha(reopened.bytes), acquired.sha256); assert.equal(f.requests.length, 1);
  const key = workspaceObjectKey(c.owner_id, c.record.task.task_id, acquired.sha256); assert.ok(f.values.has(key));
});
test('read-only retry is content addressed, and uncertain object puts require exact readback', async () => {
  const f = fixture(); const a = await capture(f); const b = await capture(f); assert.equal(a.evidence_ref, b.evidence_ref); assert.equal(f.values.size, 2);
  f.setPutError('after'); assert.equal((await capture(f)).sha256, a.sha256);
  const failing = fixture(); failing.setPutError('before'); await rejectsCode(capture(failing), 'SOURCE_EVIDENCE_UNAVAILABLE');
});
test('strict context rejects cross-owner, stale snapshot, stale revision and state before DNS', async () => {
  for (const mutate of [(c: WorkspaceStageContext) => { c.record.owner_id = 'other'; }, (c: WorkspaceStageContext) => { c.run.snapshot_id = 'other'; },
    (c: WorkspaceStageContext) => { c.run.content_revision = 'other'; }, (c: WorkspaceStageContext) => { c.run.expected_state_version++; }]) {
    const f = fixture(), c = context(); mutate(c); await rejectsCode(capture(f,c), 'SOURCE_CONTEXT_SCOPE_MISMATCH'); assert.deepEqual(f.dns, []);
  }
});
test('owner, task, canonical, source and expiry grants are checked before network', async () => {
  for (const patch of [{ owner_id: 'other' }, { task_id: 'other' }, { canonical_version: 'other' }, { source_url: source + 'other' }, { expires_at: new Date(now).toISOString() }]) {
    const f = fixture(); f.setGrant({ ...f.getGrant(), ...patch }); await rejectsCode(capture(f), 'SOURCE_AUTHORIZATION_SCOPE_MISMATCH'); assert.deepEqual(f.dns, []);
  }
});
test('origin policy must contain only exact canonical HTTPS origins and the brief origin', async () => {
  for (const origins of [['https://shop.example.com/'], ['https://*.example.com'], [cdn], ['https://shop.example.com', 'https://shop.example.com']]) {
    const f = fixture(); f.setGrant({ ...f.getGrant(), allowed_origins: origins }); await assert.rejects(capture(f)); assert.deepEqual(f.dns, []);
  }
});
test('blocks IP literal, localhost, non-HTTPS, auth, signed URL, backslash and fragment destinations', async () => {
  for (const url of ['http://shop.example.com/product', 'https://127.1/a', 'https://2130706433/a', 'https://0x7f000001/a',
    'https://[::1]/', 'https://user:pw@shop.example.com/', 'https://shop.example.com:8443/', 'https://shop.example.com/a#fragment',
    'https://shop.example.com/a?access_token=secret', 'https://shop.example.com/a?X-Amz-Signature=secret', 'https://shop.example.com/a?code=otp',
    'https://shop.example.com/a?apiKey=secret', 'https://shop.example.com/a?accessToken=secret', 'https://shop.example.com/a?authToken=secret',
    'https://localhost/', 'https://x.local/a', 'https://a.internal/a', 'https://shop.example.com\\@evil.com/']) {
    const f = fixture(); await assert.rejects(capture(f, context(), url), WorkspaceSourceError); assert.deepEqual(f.dns, []);
  }
});
test('origin membership is exact, never a suffix check', async () => {
  for (const url of ['https://evilshop.example.com/p', 'https://shop.example.com.attacker.com/p', 'https://other.example.com/p']) {
    const f = fixture(); await rejectsCode(capture(f, context(), url), 'SOURCE_DESTINATION_NOT_AUTHORIZED'); assert.deepEqual(f.dns, []);
  }
});
test('blocks all private/special address forms and accepts public IPv4/IPv6', () => {
  for (const address of ['0.0.0.0','10.0.0.1','127.0.0.1','100.64.0.1','100.127.255.255','169.254.169.254','172.16.0.1','172.31.255.255','192.168.1.2',
    '192.0.0.9','192.0.2.3','192.88.99.1','198.18.0.1','198.19.255.255','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255',
    '::','::1','::ffff:127.0.0.1','::ffff:93.184.216.34','fe80::1','fc00::1','fd00::1','2001:db8::1','2002:0808:0808::1','2001::1','64:ff9b::808:808','3fff::1','3ffe::1','fe80::1%eth0','127.1'])
    assert.equal(isWorkspacePublicAddress(address), false, address);
  for (const address of ['93.184.216.34','8.8.8.8','1.1.1.1','2001:4860:4860::8888','2606:4700:4700::1111']) assert.equal(isWorkspacePublicAddress(address), true, address);
});
test('rejects mixed DNS answers and family mismatch before HTTP; pins a single validated result', async () => {
  for (const answers of [[{ address: '127.0.0.1', family: 4 }], [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }],
    [{ address: '93.184.216.34', family: 6 }], []]) {
    const f = fixture(); f.setResolver(async () => answers); await rejectsCode(capture(f), 'SOURCE_DNS_NOT_PUBLIC'); assert.equal(f.requests.length, 0);
  }
  const f = fixture(); await capture(f); assert.equal(f.requests[0].address, '93.184.216.34');
});
test('socket peer must match the pinned DNS address even if both are public', async () => {
  const f = fixture(); f.setResponse(() => response('test', { peer_address: '1.1.1.1' })); await rejectsCode(capture(f), 'SOURCE_PEER_MISMATCH'); assert.equal(f.values.size, 0); assert.equal(f.stats().dispose, 1);
});
test('redirects recheck origin and DNS, dispose the first body, and retain the complete chain', async () => {
  const f = fixture(); let readRedirectBody = false;
  f.setResponse(url => url === source ? response('', { status: 302, headers: { location: cdn + '/product' }, body: (async function* () { readRedirectBody = true; yield Buffer.alloc(999999); })() }) : response('redirected source'));
  const acquired = await capture(f); assert.equal(acquired.final_url, cdn + '/product'); assert.equal(readRedirectBody, false);
  assert.deepEqual(f.dns, ['shop.example.com','cdn.example.com']);
  const manifest = JSON.parse(Buffer.from(f.values.get(workspaceObjectKey('owner-a','task-a', acquired.evidence_ref.split(':')[1]))!).toString());
  assert.deepEqual(manifest.chain.map((v: any) => v.status), [302,200]);
});
test('redirect does not bypass allowed origins or private-DNS denial', async () => {
  const f = fixture(); f.setResponse(() => response('', { status: 302, headers: { location: 'https://attacker.example.com/a' } }));
  await rejectsCode(capture(f), 'SOURCE_DESTINATION_NOT_AUTHORIZED'); assert.equal(f.requests.length, 1); assert.equal(f.values.size, 0);
  const privateDns = fixture(); privateDns.setResponse(() => response('', { status: 302, headers: { location: cdn + '/a' } }));
  privateDns.setResolver(async host => [{ address: host === 'cdn.example.com' ? '169.254.169.254' : '93.184.216.34', family: 4 }]);
  await rejectsCode(capture(privateDns), 'SOURCE_DNS_NOT_PUBLIC'); assert.equal(privateDns.requests.length, 1);
});
test('redirect loops, excess hops, credentials, non-HTTPS and malformed locations hard fail', async () => {
  for (const location of [source,'http://shop.example.com/x','https://user:pass@shop.example.com/x','https://shop.example.com/x?token=s', '\\attacker.example.com/x']) {
    const f = fixture(); f.setResponse(() => response('', { status: 302, headers: { location } })); await assert.rejects(capture(f)); assert.equal(f.values.size, 0);
  }
  const f = fixture(); let counter = 0; f.setResponse(() => response('', { status: 302, headers: { location: '/redirect/' + ++counter } }));
  await rejectsCode(capture(f), 'SOURCE_REDIRECT_LIMIT'); assert.equal(f.requests.length, 4);
});
test('HTTP errors, unexpected MIME/charset/compression and duplicate headers cannot become evidence', async () => {
  for (const overrides of [{ status: 403 }, { status: 404 }, { status: 204 }, { headers: { 'content-type': 'application/pdf' } },
    { headers: { 'content-type': 'text/html; charset=iso-8859-1' } }, { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } },
    { headers: { 'content-type': ['text/plain','text/html'] } }, { headers: { 'content-type': 'text/plain', 'content-length': '3, 3' } }]) {
    const f = fixture(); f.setResponse(() => response('abc', overrides)); await assert.rejects(capture(f)); assert.equal(f.values.size, 0);
  }
});
test('stream byte limit applies without Content-Length and abort disposes the response', async () => {
  const f = fixture(); let closed = false;
  f.setResponse(() => response('', { headers: { 'content-type': 'text/html' }, body: (async function* () {
    try { yield Buffer.alloc(WORKSPACE_SOURCE_LIMITS.document_bytes); yield Buffer.alloc(1); } finally { closed = true; }
  })() }));
  await rejectsCode(capture(f), 'SOURCE_RESPONSE_TOO_LARGE'); assert.equal(closed, true); assert.equal(f.values.size, 0); assert.equal(f.stats().dispose, 1);
});
test('rejects declared length overflow, zero bytes, truncation and invalid UTF-8', async () => {
  for (const [data, headers] of [['abc', { 'content-type': 'text/plain', 'content-length': String(WORKSPACE_SOURCE_LIMITS.document_bytes+1) }],
    ['abc', { 'content-type': 'text/plain', 'content-length': '4' }], ['', { 'content-type': 'text/plain' }],
    [new Uint8Array([0xc3,0x28]), { 'content-type': 'text/plain' }]] as const) {
    const f = fixture(); f.setResponse(() => response(data, { headers })); await assert.rejects(capture(f)); assert.equal(f.values.size, 0);
  }
});
test('authorization revoked after acquisition prevents all retained writes', async () => {
  const f = fixture(); f.onGrant(() => { if (f.stats().authorizations === 2) f.setGrant(null); });
  await rejectsCode(capture(f), 'SOURCE_AUTHORIZATION_REQUIRED'); assert.equal(f.requests.length, 1); assert.equal(f.stats().puts, 0);
});
test('in-flight cancellation terminates stalled stream and performs no retained writes', async () => {
  const f = fixture(), abort = new AbortController(), c = { ...context(), signal: abort.signal };
  f.setResponse(() => response('', { headers: { 'content-type': 'text/plain' }, body: { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}) }; } } }));
  const pending = capture(f,c); setTimeout(() => abort.abort(), 15);
  await rejectsCode(pending, 'SOURCE_CANCELLED_OR_TIMED_OUT'); assert.equal(f.values.size, 0); assert.equal(f.stats().dispose, 1);
});
test('cancelled context never starts DNS or HTTP', async () => {
  const f = fixture(), abort = new AbortController(); abort.abort();
  await rejectsCode(capture(f, { ...context(), signal: abort.signal }), 'SOURCE_CANCELLED_OR_TIMED_OUT'); assert.equal(f.requests.length, 0); assert.equal(f.dns.length, 0);
});
test('limits concurrent network acquisitions and releases slots after cancellation', async () => {
  const f = fixture(), abort = new AbortController(), c = { ...context(), signal: abort.signal };
  f.setResolver(async () => new Promise(() => {}));
  const one = capture(f,c), two = capture(f,c);
  await rejectsCode(capture(f,c), 'SOURCE_ACQUISITION_BUSY'); abort.abort();
  await Promise.all([rejectsCode(one,'SOURCE_CANCELLED_OR_TIMED_OUT'), rejectsCode(two,'SOURCE_CANCELLED_OR_TIMED_OUT')]);
  f.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]); assert.ok(await capture(f));
});
test('reopen verifies retained bytes and cannot trust a forged reference/hash or corrupt store', async () => {
  const f = fixture(), c = context(), acquired = await capture(f,c);
  await rejectsCode(f.provider.reopen(c, 'source:' + 'f'.repeat(64) + ':100', acquired.scope), 'SOURCE_EVIDENCE_UNAVAILABLE');
  await rejectsCode(f.provider.reopen(c, acquired.evidence_ref.replace(/:\d+$/, ':99999'), acquired.scope), 'SOURCE_EVIDENCE_REF_INVALID');
  f.setCorrupt(); await rejectsCode(f.provider.reopen(c, acquired.evidence_ref, acquired.scope), 'SOURCE_EVIDENCE_INTEGRITY');
});
test('reopen enforces owner/task/source/canonical and exact retained operation/snapshot/state', async () => {
  const f = fixture(), c = context(), acquired = await capture(f,c);
  for (const patch of [{ owner_id: 'other' }, { task_id: 'other' }, { canonical_version: 'other' }, { source_url: source + 'other' },
    { snapshot_id: 'other' }, { operation_id: 'other' }, { state_version: acquired.scope.state_version + 1 }, { content_revision: 'other' }]) {
    await rejectsCode(f.provider.reopen(c, acquired.evidence_ref, { ...acquired.scope, ...patch }), 'SOURCE_EVIDENCE_SCOPE_MISMATCH');
  }
});
test('later QC can reopen an explicitly pinned prior capture scope but not a changed source/canonical', async () => {
  const f = fixture(), c = context(), acquired = await capture(f,c);
  c.run.stage = 'review'; c.run.operation_id = 'review-op'; c.run.snapshot_id = 'review-snapshot';
  c.record.task = { ...c.record.task, state_version: c.record.task.state_version + 1, snapshot: { ...c.record.task.snapshot, snapshot_id: 'review-snapshot' } };
  c.run.expected_state_version = c.record.task.state_version;
  assert.equal((await f.provider.reopen(c, acquired.evidence_ref, acquired.scope)).sha256, acquired.sha256);
  c.record.task = { ...c.record.task, snapshot: { ...c.record.task.snapshot, canonical_version: 'changed' } };
  await rejectsCode(f.provider.reopen(c, acquired.evidence_ref, acquired.scope), 'SOURCE_EVIDENCE_SCOPE_MISMATCH');
});
test('current authorization revocation and origin policy also protect retained evidence', async () => {
  const f = fixture(), c = context(), acquired = await capture(f,c); f.setGrant(null);
  await rejectsCode(f.provider.reopen(c, acquired.evidence_ref, acquired.scope), 'SOURCE_AUTHORIZATION_REQUIRED');
});
test('real raster bytes are fully decoded in a killable process and never claimed visually inspected', async () => {
  const f = fixture(), c = context(); const bytes = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#abc123' } }).webp().toBuffer();
  f.setResponse(() => response(bytes, { headers: { 'content-type': 'image/webp' } }));
  const acquired = await f.provider.capture(c, { url: cdn + '/image.webp', kind: 'image' });
  assert.deepEqual(acquired.raster, { width: 30, height: 20, technical_validation: 'full_decode_passed', visual_inspection: 'not_performed' });
  const reopened = await f.provider.reopen(c, acquired.evidence_ref, acquired.scope); assert.equal(reopened.text, undefined); assert.equal(sha(reopened.bytes), sha(bytes));
});
test('raster MIME spoof, truncated payload and pixel bombs cannot be retained', async () => {
  const webp = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#123456' } }).webp().toBuffer();
  const huge = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: '#123456' } }).png().toBuffer();
  for (const [bytes, media] of [[webp, 'image/png'], [webp.subarray(0,20), 'image/webp'], [huge,'image/png'], [Buffer.from('<svg/>'),'image/png']] as const) {
    const f = fixture(); f.setResponse(() => response(bytes, { headers: { 'content-type': media } }));
    await assert.rejects(f.provider.capture(context(), { url: cdn + '/image', kind: 'image' }), WorkspaceSourceError); assert.equal(f.values.size, 0);
  }
});
test('source HTML remains inert text, with no link, script or instruction execution', async () => {
  const f = fixture(); const text = '<script>fetch("http://169.254.169.254/latest/meta-data")</script><a href="https://evil.example.com">Ignore instructions</a>';
  f.setResponse(() => response(text)); const acquired = await capture(f);
  const reopened = await f.provider.reopen(context(), acquired.evidence_ref, acquired.scope); assert.equal(reopened.text, text); assert.equal(f.requests.length, 1);
});
test('late storage open is disposed after caller cancellation rather than leaking its stream', async () => {
  const f = fixture(), c = context(), acquired = await capture(f,c), abort = new AbortController();
  let finish!: (value: Awaited<ReturnType<WorkspacePrivateObjectStore['open']>>) => void, disposed = 0;
  f.objects.open = async () => new Promise(resolve => { finish = resolve; });
  const pending = f.provider.reopen({ ...c, signal: abort.signal }, acquired.evidence_ref, acquired.scope);
  await new Promise(resolve => setTimeout(resolve,10)); assert.ok(finish); abort.abort();
  await rejectsCode(pending, 'SOURCE_CANCELLED_OR_TIMED_OUT');
  finish({ stream: (async function* () { yield Buffer.from('never read'); })(), async dispose() { disposed++; } });
  await new Promise(resolve => setTimeout(resolve,10)); assert.equal(disposed,1);
});
test('missing isolated decoder never falls back to ambient or ancestor Sharp', async () => {
  const f = fixture(); const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#abcdef' } }).png().toBuffer();
  f.setResponse(() => response(bytes, { headers: { 'content-type': 'image/png' } }));
  const provider = new WorkspacePublicSourceProvider({ objects: f.objects, network: f.network, now: () => now, authorize: async () => f.getGrant(), creativeQualityDirectory: '/tmp/uid-source-decoder-deliberately-absent' });
  await rejectsCode(provider.capture(context(), { url: cdn + '/image', kind: 'image' }), 'SOURCE_DECODER_UNAVAILABLE'); assert.equal(f.values.size,0);
});
test('supported CommonJS server bundle can capture/reopen raster with isolated runtime', async () => {
  const directory = await mkdtemp(path.join(process.cwd(), '.uid-source-provider-test-'));
  try {
    const result = await build({ entryPoints: [path.resolve('uid-workspace-providers.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' });
    const output = path.join(directory, 'providers.cjs'); await writeFile(output, result.outputFiles[0].text);
    const { WorkspacePublicSourceProvider: BundledProvider } = createRequire(import.meta.url)(output) as typeof import('../uid-workspace-providers.ts');
    const f = fixture(); const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#abcdef' } }).png().toBuffer();
    f.setResponse(() => response(bytes, { headers: { 'content-type': 'image/png' } }));
    const provider = new BundledProvider({ objects: f.objects, network: f.network, now: () => now, authorize: async () => f.getGrant() });
    const acquired = await provider.capture(context(), { url: cdn + '/image', kind: 'image' });
    assert.equal(acquired.raster?.width,12); assert.equal(acquired.raster?.visual_inspection,'not_performed');
    assert.equal(sha((await provider.reopen(context(), acquired.evidence_ref, acquired.scope)).bytes),sha(bytes));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('production composition journals capture bytes and manifest before storage and does not hide an uncertain writer', async () => {
  const f = fixture(), c = context(); let writes = 0;
  const provider = new WorkspacePublicSourceProvider({ objects: f.objects, network: f.network, now: () => now,
    authorize: async () => f.getGrant(), async writeRunArtifact(context, identity, stream) {
      assert.equal(context.owner_id, c.owner_id); assert.equal(identity.task_id, c.record.task.task_id); writes++;
      await f.objects.put(identity, stream); return identity;
    } });
  const acquired = await provider.capture(c, { url: source, kind: 'document' }); assert.equal(writes, 2);
  assert.equal((await provider.reopen(c, acquired.evidence_ref, acquired.scope)).sha256, acquired.sha256);
  const stopped = new WorkspacePublicSourceProvider({ objects: f.objects, network: f.network, now: () => now,
    authorize: async () => f.getGrant(), async writeRunArtifact() { throw new Error('FIXTURE_WRITE_UNCERTAIN'); } });
  await rejectsCode(stopped.capture(c, { url: source, kind: 'document' }), 'SOURCE_ACQUISITION_FAILED');
});

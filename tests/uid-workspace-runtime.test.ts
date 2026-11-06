import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorkspaceRuntime, PostgresWorkspaceLoginLimiter, createWorkspaceClientResolver, PostgresWorkspaceWorkerDirectory, createWorkspaceArtifactAccess, runWorkspaceWorker, type WorkspaceLoginLimiterConfig } from '../uid-workspace-runtime.ts';
import { journalPool } from './helpers/workspace-journal-pool.ts';
import type { Request } from 'express';
import type { WorkspaceRecord, WorkspaceArtifact } from '../uid-workspace-store.ts';
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const TABLE = 'private.workspace_login';
function loginSetup(overrides: Partial<WorkspaceLoginLimiterConfig> = {}) {
  const fake = journalPool(); let now = Date.parse('2026-11-06T10:00:00Z');
  const config: WorkspaceLoginLimiterConfig = { schemaReviewed: true, schemaVersion: 'uid-workspace-login-v1', qualifiedTable: TABLE, namespace: 'uid-production', clientLimit: 3, accountLimit: 2, windowMs: 10_000, reservationMs: 1000, now: () => now, ...overrides };
  return { ...fake, config, limiter: new PostgresWorkspaceLoginLimiter(fake.pool, config), advance: (ms: number) => { now += ms; } };
}
const attempt = (attempt_id: string, client = 'client-a', account = 'alice') => ({ attempt_id, client_key: hash(client), account_key: hash(account) });
function req(peer: string, headers: Record<string, string | string[]> = {}, rawHeaders?: string[]) { return { socket: { remoteAddress: peer }, headers, rawHeaders: rawHeaders ?? Object.entries(headers).flatMap(([k, v]) => [k, String(v)]) } as Request; }

test('runtime defaults stay disabled without touching network, SQL, credentials or timers', async () => {
  const runtime = createWorkspaceRuntime();
  assert.equal(runtime.readiness().ready, false); assert.equal(runtime.runner, undefined); assert.equal(runtime.apiOptions.environment, 'production');
  assert.ok(runtime.readiness().blockers.some(v => v.code === 'SHARED_BUDGET_REQUIRED'));
  assert.equal((await runtime.tick()).status, 'disabled');
});
test('two limiter instances serialize independent account and client caps atomically', async () => {
  const s = loginSetup(); const second = new PostgresWorkspaceLoginLimiter(s.pool, s.config);
  const results = await Promise.all([s.limiter.begin(attempt('one')), second.begin(attempt('two', 'client-b')), s.limiter.begin(attempt('three', 'client-c'))]);
  assert.equal(results.filter(v => v.allowed).length, 2);
  assert.equal((await second.begin(attempt('different-account', 'client-c', 'bob'))).allowed, true);
  const c = loginSetup({ clientLimit: 2, accountLimit: 10 });
  assert.equal((await c.limiter.begin(attempt('one'))).allowed, true);
  assert.equal((await c.limiter.begin(attempt('two', 'client-a', 'bob'))).allowed, true);
  assert.equal((await c.limiter.begin(attempt('three', 'client-a', 'charlie'))).allowed, false);
});
test('successful logins never consume failures or clear unrelated account failures', async () => {
  const s = loginSetup({ maxRecords: 100 });
  for (let index = 0; index < 20; index++) { const id = 'success-' + index; assert.equal((await s.limiter.begin(attempt(id))).allowed, true); await s.limiter.finish(id, 'success'); }
  await s.limiter.begin(attempt('bad-one')); await s.limiter.finish('bad-one', 'rejected');
  await s.limiter.begin(attempt('bob-success', 'client-a', 'bob')); await s.limiter.finish('bob-success', 'success');
  await s.limiter.begin(attempt('bad-two')); await s.limiter.finish('bad-two', 'unavailable');
  assert.equal((await s.limiter.begin(attempt('alice-blocked'))).allowed, false);
  assert.equal((await s.limiter.begin(attempt('bob-allowed', 'client-b', 'bob'))).allowed, true);
});
test('crashed reservations count as failures, expire boundedly and late success cannot issue cookie', async () => {
  const s = loginSetup(); await s.limiter.begin(attempt('one')); await s.limiter.begin(attempt('two'));
  s.advance(1001); await assert.rejects(() => s.limiter.finish('one', 'success'), /LOGIN_RESERVATION_EXPIRED/);
  assert.equal((await s.limiter.begin(attempt('blocked'))).allowed, false);
  s.advance(10_001); assert.equal((await s.limiter.begin(attempt('after-expiry'))).allowed, true);
});
test('login begin replay denies, finish is idempotent only for the same outcome', async () => {
  const s = loginSetup(); assert.equal((await s.limiter.begin(attempt('one'))).allowed, true);
  assert.equal((await s.limiter.begin(attempt('one'))).allowed, false);
  await s.limiter.finish('one', 'success'); await s.limiter.finish('one', 'success');
  await assert.rejects(() => s.limiter.finish('one', 'rejected'), /LOGIN_OUTCOME_CONFLICT/);
});
test('lost login commit is ambiguous and restart cannot grant duplicate attempt', async () => {
  const s = loginSetup(); s.loseNextCommit();
  await assert.rejects(() => s.limiter.begin(attempt('one')), /LOGIN_LIMITER_OUTCOME_UNKNOWN/);
  assert.equal((await new PostgresWorkspaceLoginLimiter(s.pool, s.config).begin(attempt('one'))).allowed, false);
  assert.ok(s.statements.some(q => q.sql.includes('workspace_login_namespace') && q.values[0] === 'uid-production'));
});
test('durable limiter rejects raw email/IP and unreviewed schema', async () => {
  const s = loginSetup(); await assert.rejects(() => s.limiter.begin({ attempt_id: 'one', account_key: 'alice@example.test', client_key: '192.0.2.1' }), /INVALID_LOGIN_ATTEMPT/);
  assert.throws(() => new PostgresWorkspaceLoginLimiter(s.pool, { ...s.config, schemaReviewed: false as true }), /LOGIN_SCHEMA_NOT_REVIEWED/);
});
test('reviewed single-header resolver rejects unknown peers, duplicates, chains, spoofed forwarded headers', async () => {
  const resolve = createWorkspaceClientResolver({ reviewedIngress: true, review_ref: 'ingress-review', pseudonymKey: Buffer.alloc(32, 7), mode: 'sanitized_single_header', trustedPeerAddresses: ['10.0.0.5'], header: 'x-uid-client-ip', ingressOverwritesHeader: true, originRejectsUntrustedPeers: true });
  const first = await resolve(req('10.0.0.5', { 'x-uid-client-ip': '192.0.2.1', 'x-forwarded-for': 'evil' }));
  assert.match(first!, /^[a-f0-9]{64}$/); assert.equal(first, await resolve(req('10.0.0.5', { 'x-uid-client-ip': '192.0.2.1', 'x-forwarded-for': 'different' })));
  assert.notEqual(first, await resolve(req('10.0.0.5', { 'x-uid-client-ip': '192.0.2.2' })));
  assert.equal(await resolve(req('10.0.0.6', { 'x-uid-client-ip': '192.0.2.1' })), null);
  assert.equal(await resolve(req('10.0.0.5', { 'x-uid-client-ip': '192.0.2.1,192.0.2.2' })), null);
  assert.equal(await resolve(req('10.0.0.5', { 'x-uid-client-ip': '192.0.2.1' }, ['x-uid-client-ip', '192.0.2.1', 'X-UID-CLIENT-IP', '192.0.2.2'])), null);
  assert.equal(await resolve(req('10.0.0.5', { 'x-forwarded-for': '192.0.2.1' })), null);
});
test('direct-socket resolver is explicit, canonicalizes IPs and ignores all forwarded authority', async () => {
  const resolve = createWorkspaceClientResolver({ reviewedIngress: true, review_ref: 'direct-origin', pseudonymKey: Buffer.alloc(32, 7), mode: 'direct_socket', directOriginReviewed: true });
  assert.equal(await resolve(req('::ffff:192.0.2.1')), await resolve(req('192.0.2.1', { 'x-forwarded-for': '192.0.2.99' })));
  assert.equal(await resolve(req('2001:db8:0:0:0:0:0:1')), await resolve(req('2001:db8::1')));
  assert.equal(await resolve(req('localhost')), null);
});
test('private worker RPC discovery is paged and membership checked through separate narrow function', async () => {
  const s = journalPool(); s.members.set('alice', true); s.members.set('bob', true); s.members.set('charlie', false);
  for (const owner of s.members.keys()) s.ownerJobs.add(owner);
  const directory = new PostgresWorkspaceWorkerDirectory(s.pool, { schemaReviewed: true, schemaVersion: 'uid-workspace-worker-directory-v1', discoverFunction: 'private.discover_jobs', authorizeFunction: 'private.authorize_worker_owner' });
  assert.deepEqual(await directory.discover(null, 1), ['alice']); assert.deepEqual(await directory.discover('alice', 10), ['bob']);
  assert.equal(await directory.authorizeOwner('charlie'), false); assert.equal(await directory.authorizeOwner('alice'), true);
  s.members.set('alice', false); assert.equal(await directory.authorizeOwner('alice'), false);
  assert.ok(!s.statements.some(q => q.sql.includes('workspace_owner_state')));
});
test('artifact adapter binds exact owner/task/hash, verifies write and read bytes, rejects swapped scope', async () => {
  const objects = new Map<string, Uint8Array>();
  const access = createWorkspaceArtifactAccess({ kind: 'fake-test', productionReady: false, loopbackOnly: false, async open(object) { const bytes = objects.get(object.storage_key); return bytes ? { stream: (async function*() { yield bytes; })(), async dispose() {} } : null; }, async put(object, stream) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); if (!objects.has(object.storage_key)) objects.set(object.storage_key, Buffer.concat(chunks)); }, async remove() {} });
  const bytes = Buffer.from('private task artifact'); const stored = await access.putArtifact('alice', 'task-one', bytes, 'text/plain');
  const artifact: WorkspaceArtifact = { ...stored, artifact_id: 'artifact-one', revision_id: 'revision-one', content_revision: 'content-one', filename: 'evidence.txt', kind: 'document', verification: 'verified', media_type: 'text/plain' };
  const record = { owner_id: 'alice', task: { task_id: 'task-one' }, artifacts: [artifact] } as WorkspaceRecord;
  assert.deepEqual(Buffer.from(await access.readArtifact(record, artifact)), bytes);
  await assert.rejects(() => access.readArtifact({ ...record, owner_id: 'bob' }, artifact), /ARTIFACT_SCOPE_INVALID/);
  objects.set(stored.storage_key, Buffer.from('tampered'));
  await assert.rejects(() => access.readArtifact(record, artifact), /ARTIFACT_INTEGRITY_FAILED/);
});
test('private artifact write never claims success without immutable readback', async () => {
  const access = createWorkspaceArtifactAccess({ kind: 'fake-test', productionReady: false, loopbackOnly: false, async open() { return { stream: (async function*() { yield Buffer.from('wrong'); })(), async dispose() {} }; }, async put() {}, async remove() {} });
  await assert.rejects(() => access.putArtifact('alice', 'task-one', Buffer.from('right'), 'text/plain'), /ARTIFACT_INTEGRITY_FAILED/);
});
test('supervised worker loop is explicit, handles errors without details and aborts promptly', async () => {
  const controller = new AbortController(); const errors: string[] = []; let ticks = 0;
  const runtime = { async tick(): Promise<any> { ticks++; if (ticks === 1) throw new Error('do-not-leak'); controller.abort(); return {}; } };
  await runWorkspaceWorker(runtime, { signal: controller.signal, pollMs: 100, onError: code => errors.push(code) });
  assert.equal(ticks, 2); assert.deepEqual(errors, ['WORKSPACE_WORKER_TICK_FAILED']);
});

test('runtime binds a real transport reservation before mocked fetch, settles shared quota and fences restart replay', async () => {
  // All auth/provider/storage/SQL responses in this test are synthetic fixtures.
  // This is composition coverage, not provider, database or QC certification.
  const { WORKSPACE_OPENAI_MODEL } = await import('../uid-workspace-openai.ts');
  const fake = journalPool(); fake.members.set('alice', true);
  const now = Date.parse('2026-11-06T12:00:00Z'), before = new Date(now - 3600_000).toISOString(), after = new Date(now + 3600_000).toISOString();
  const grant = (authorization_ref: string) => ({ active: true, authorization_ref, cap_microusd: 50_000, valid_from: before, expires_at: after });
  fake.seed('private.budget', 'project-test', { version: 1, project_id: 'project-test', frozen: false, global: grant('global'), owners: [{ ...grant('owner'), owner_id: 'alice' }], tasks: [{ ...grant('task'), owner_id: 'alice', task_id: 'task-one', authorization_id: 'auth-one', data_authorization_ref: 'data-approved-fixture', capability_verification_ref: 'cap-fixture', maximum_request_cost_microusd: 5000 }], operations: [] });
  let services: import('../uid-workspace-runtime.ts').WorkspaceRuntimeServices | undefined;
  const events: string[] = []; let calls = 0;
  const adapter = { async execute(): Promise<any> { return { outcome: 'blocked', code: 'TEST_ONLY_NO_QC' }; }, async verifyEvidence() { return null; } };
  const config: import('../uid-workspace-runtime.ts').WorkspaceRuntimeConfig = {
    publicOrigin: 'https://workspace.example.test', auth: { url: 'https://auth.example.test', publicKey: 'sb_publishable_fixture', fetcher: async () => { throw new Error('No auth network expected'); } }, executionEnabled: true,
    worker: { enabled: true }, runner: { now: () => now }, database: { pool: fake.pool, ownerStore: { schemaReviewed: true, schemaVersion: 'uid-workspace-owner-state-v1', qualifiedTable: 'private.owner_state' },
      budget: { schemaReviewed: true, schemaVersion: 'uid-workspace-budget-v1', qualifiedTable: 'private.budget', now: () => now, pricing: { model: WORKSPACE_OPENAI_MODEL, evidence_ref: 'pricing-fixture', verified_at: before, expires_at: after,
        max_input_tokens_per_utf8_byte: 1, protocol_input_token_overhead: 100, max_input_tokens: 10_000, max_output_tokens: 1000, tiers: [{ through_input_tokens: 10_000, input_microusd_per_million: 1_000_000, output_microusd_per_million: 1_000_000 }] } },
      workerDirectory: { schemaReviewed: true, schemaVersion: 'uid-workspace-worker-directory-v1', discoverFunction: 'private.discover', authorizeFunction: 'private.authorize' } },
    objectStore: { kind: 'test-fixture-only', productionReady: true, loopbackOnly: false, async put() { throw new Error('No storage expected'); }, async open() { return null; }, async remove() {} },
    renderPreview: async () => { throw new Error('No preview expected'); },
    createAdapters(value) { services = value; return { draft: adapter, research: adapter, content_authoring: adapter, assets: adapter, review: adapter, packaging: adapter }; },
    openai: { serverCredential: { api_key: 'fixture-credential-test-only-not-a-real-key', project_id: 'project-test' }, now: () => now,
      capability: { verified: true, verification_ref: 'cap-fixture', project_id: 'project-test', model: WORKSPACE_OPENAI_MODEL, api: 'responses', accepted_response_models: [WORKSPACE_OPENAI_MODEL], checked_at: before, expires_at: after },
      fetch: async (_url, init) => { events.push('fetch'); calls++; assert.equal(events.at(-2), 'bind'); assert.match(String(init?.headers && (init.headers as any)['Authorization']), /^Bearer fixture-credential-test/);
        return new Response(JSON.stringify({ id: 'resp-one', object: 'response', model: WORKSPACE_OPENAI_MODEL, status: 'completed', error: null, incomplete_details: null,
          output: [{ id: 'msg-one', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Untrusted generated copy', annotations: [] }] }], usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } }), { headers: { 'content-type': 'application/json', 'x-request-id': 'request-one' } }); },
    },
  };
  const runtime = createWorkspaceRuntime(config); assert.equal(runtime.readiness().ready, true);
  const savedRecord = { owner_id: 'alice', task: { task_id: 'task-one', state_version: 2, snapshot: { snapshot_id: 'snapshot-one', content_revision: 'content-one' } },
    actions: [{ action_id: 'action-one', actor_id: 'alice', status: 'running', type: 'start' }], artifacts: [], events: [],
    runs: [{ run_id: 'run-one', action_id: 'action-one', operation_id: 'run-one', status: 'in_flight', stage: 'content_authoring', fence: 1, lease_owner: 'worker-one', lease_expires_at: after }] };
  fake.seed('private.owner_state', 'alice', { owner_id: 'alice', tasks: [savedRecord], creations: [] });
  const context = { owner_id: 'alice', record: structuredClone(savedRecord), action: structuredClone(savedRecord.actions[0]), run: structuredClone(savedRecord.runs[0]), signal: new AbortController().signal,
    async bindProviderOperation(binding: any) { assert.match(binding.request_sha256, /^[a-f0-9]{64}$/); assert.ok(binding.reservation_id); events.push('bind');
      await services!.store.transaction('alice', state => { state.tasks[0].runs![0].provider_binding = binding; }); } } as any;
  const input = { operation_id: 'run-one', instructions: 'Use only the supplied evidence.', input: 'Synthetic unit-test facts.', max_output_tokens: 100, budget_cap_microusd: 5000, reasoning_effort: 'high' as const };
  const result = await services!.submitText(context, input);
  assert.equal(result.outcome, 'completed'); assert.equal(result.accounting, 'settled'); assert.equal(result.output?.qc_verified, false); assert.equal(calls, 1);
  assert.equal((fake.read<any>('private.budget', 'project-test')).operations[0].charged_microusd, 25);
  createWorkspaceRuntime(config); // Recreate transport and runtime; SQL journal survives.
  const duplicate = await services!.submitText(context, input);
  assert.equal(duplicate.submission, 'not_submitted'); assert.equal(calls, 1);
  context.run.operation_id = 'cancel-during-budget';
  await services!.store.transaction('alice', state => { state.tasks[0].runs![0].operation_id = context.run.operation_id; delete state.tasks[0].runs![0].provider_binding; });
  const bind = context.bindProviderOperation;
  context.bindProviderOperation = async (binding: any) => { await bind(binding); await services!.store.transaction('alice', state => { state.tasks[0].actions.push({ type: 'cancel', status: 'queued' } as any); }); };
  const cancelled = await services!.submitText(context, { ...input, operation_id: context.run.operation_id });
  assert.equal(cancelled.outcome, 'unknown'); assert.equal(cancelled.reconciliation_required, true); assert.equal(calls, 1);
  fake.members.set('alice', false);
  await assert.rejects(() => services!.submitText(context, { ...input, operation_id: 'second' }), /MODEL_OWNER_NOT_AUTHORIZED/);
  assert.equal(calls, 1);
});

test('runtime creates streaming custody service and refuses model invocation while any execution prerequisite is missing', async () => {
  const fake = journalPool(); let services: import('../uid-workspace-runtime.ts').WorkspaceRuntimeServices | undefined;
  const runtime = createWorkspaceRuntime({ database: { pool: fake.pool, ownerStore: { schemaReviewed: true, schemaVersion: 'uid-workspace-owner-state-v1', qualifiedTable: 'private.owner_state' } },
    createAdapters(value) { services = value; return {}; }, objectStore: { kind: 'test-only', productionReady: true, loopbackOnly: false, async put() {}, async open() { return null; }, async remove() {} } });
  assert.equal(runtime.apiOptions.artifactService, runtime.artifactService); assert.equal(runtime.artifactService?.productionReady, true);
  await assert.rejects(() => services!.submitText({} as any, {} as any), /MODEL_EXECUTION_DISABLED/);
  assert.equal(fake.statements.length, 0);
});

test('pipeline prerequisite blockers are composed and its renderer is mounted without invented readiness', () => {
  const fake = journalPool(); const renderPreview = async () => { throw new Error('unused'); };
  const runtime = createWorkspaceRuntime({ database: { pool: fake.pool, ownerStore: { schemaReviewed: true, schemaVersion: 'uid-workspace-owner-state-v1', qualifiedTable: 'private.owner_state' } },
    createPipeline() { return { adapters: {}, renderPreview, readiness: () => ({ ready: false, blockers: [{ code: 'IMAGE_GENERATOR_MISSING', message: 'A real image adapter is missing.' }] }) }; } });
  assert.equal(runtime.apiOptions.renderPreview, renderPreview);
  assert.equal(runtime.readiness().ready, false); assert.ok(runtime.readiness().blockers.some(v => v.code === 'IMAGE_GENERATOR_MISSING'));
  assert.equal(fake.statements.length, 0);
});

test('runtime admission reads saved brief, requires current member authority and never trusts supplied grant data', async () => {
  const { WORKSPACE_OPENAI_MODEL, WORKSPACE_OPENAI_ENDPOINT } = await import('../uid-workspace-openai.ts');
  const fake = journalPool(); fake.members.set('alice', true); fake.members.set('bob', true);
  const now = Date.parse('2026-11-06T12:00:00Z'), before = new Date(now - 3600_000).toISOString(), after = new Date(now + 3600_000).toISOString();
  const grant = (authorization_ref: string) => ({ active: true, authorization_ref, cap_microusd: 10_000, valid_from: before, expires_at: after });
  const record = { owner_id: 'alice', task: { task_id: 'saved-task' }, brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://pawfecthouse.com/products/example' }, actions: [], events: [], artifacts: [] };
  fake.seed('private.owner_state', 'alice', { owner_id: 'alice', tasks: [record], creations: [] });
  fake.seed('private.budget', 'project-test', { version: 1, project_id: 'project-test', frozen: false, global: grant('global'), owners: [{ ...grant('owner'), owner_id: 'alice', task_policy: {
    ...grant('standing-task-policy'), policy_id: 'policy-one', data_authorization_ref: 'approved-data', data_destination: WORKSPACE_OPENAI_ENDPOINT, model: WORKSPACE_OPENAI_MODEL, capability_verification_ref: 'cap-fixture', maximum_task_cap_microusd: 5000, maximum_request_cost_microusd: 3000, task_grant_ttl_ms: 1_800_000, maximum_admitted_tasks: 10, allowed_brands: ['PawfectHouse'], allowed_materials: ['onepage'], allowed_source_origins: ['https://pawfecthouse.com'],
  } }], tasks: [], operations: [] });
  const runtime = createWorkspaceRuntime({ executionEnabled: true, database: { pool: fake.pool, ownerStore: { schemaReviewed: true, schemaVersion: 'uid-workspace-owner-state-v1', qualifiedTable: 'private.owner_state' },
    budget: { schemaReviewed: true, schemaVersion: 'uid-workspace-budget-v1', qualifiedTable: 'private.budget', now: () => now, pricing: { model: WORKSPACE_OPENAI_MODEL, evidence_ref: 'price-fixture', verified_at: before, expires_at: after, max_input_tokens_per_utf8_byte: 1, protocol_input_token_overhead: 100, max_input_tokens: 10_000, max_output_tokens: 1000, tiers: [{ through_input_tokens: 10_000, input_microusd_per_million: 1_000_000, output_microusd_per_million: 1_000_000 }] } },
    workerDirectory: { schemaReviewed: true, schemaVersion: 'uid-workspace-worker-directory-v1', discoverFunction: 'private.discover', authorizeFunction: 'private.authorize' } },
    openai: { serverCredential: { api_key: 'sk-test-only-not-real', project_id: 'project-test' }, capability: { verified: true, verification_ref: 'cap-fixture', project_id: 'project-test', model: WORKSPACE_OPENAI_MODEL, api: 'responses', accepted_response_models: [WORKSPACE_OPENAI_MODEL], checked_at: before, expires_at: after }, now: () => now, fetch: async () => { throw new Error('NO_PROVIDER_CALL'); } } });
  assert.equal((await runtime.apiOptions.admitTask!('alice', 'saved-task')).status, 'admitted');
  assert.equal((await runtime.admitTask('alice', 'saved-task')).status, 'already_admitted');
  assert.equal((await runtime.admitTask('bob', 'saved-task')).code, 'TASK_NOT_FOUND');
  fake.members.set('alice', false);
  assert.equal((await runtime.admitTask('alice', 'saved-task')).code, 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED');
  assert.ok((await runtime.taskExecutionReadiness('alice', 'saved-task')).blockers.some(value => value.code === 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED'));
  assert.equal(fake.read<any>('private.budget', 'project-test').operations.length, 0);
});

async function artifactIntentHarness() {
  const { MemoryWorkspaceStore } = await import('../uid-workspace-store.ts');
  const { createWorkspaceRunArtifactWriter } = await import('../uid-workspace-runtime.ts');
  const { workspaceObjectKey } = await import('../uid-workspace-artifacts.ts');
  const store = new MemoryWorkspaceStore(); const now = Date.parse('2026-11-06T12:00:00Z'); let allowed = true;
  const bytes = Buffer.from('retained generated fixture'); const identity = { owner_id: 'alice', task_id: 'task-one', storage_key: workspaceObjectKey('alice', 'task-one', hash(bytes)), sha256: hash(bytes), size_bytes: bytes.length, media_type: 'text/plain' };
  const record: any = { owner_id: 'alice', task: { task_id: 'task-one', state_version: 2, stage: 'assets', snapshot: { snapshot_id: 'snapshot-one', content_revision: 'content-one' } },
    actions: [{ action_id: 'action-one', actor_id: 'alice', type: 'start', status: 'running' }], artifacts: [], events: [],
    runs: [{ run_id: 'run-one', action_id: 'action-one', operation_id: 'operation-one', status: 'in_flight', fence: 1, lease_owner: 'worker-one', lease_expires_at: new Date(now + 60_000).toISOString() }] };
  await store.transaction('alice', state => { state.tasks.push(structuredClone(record)); });
  const context: any = { owner_id: 'alice', record: structuredClone(record), action: structuredClone(record.actions[0]), run: structuredClone(record.runs[0]), signal: new AbortController().signal };
  const objects = new Map<string, Uint8Array>(); let puts = 0; let uncertain = false; let afterWrite: (() => Promise<void>) | undefined;
  const backend: import('../uid-workspace-artifacts.ts').WorkspacePrivateObjectStore = { kind: 'fixture-only', productionReady: false, loopbackOnly: false,
    async put(object, source) {
      puts++; const journal = await store.read('alice', state => state.tasks[0].runs![0].artifact_intents); assert.equal(journal?.[0]?.status, 'reserved'); assert.equal(journal?.[0]?.sha256, object.sha256);
      if (uncertain) throw new Error('uncertain_storage_outcome');
      const chunks = []; for await (const part of source) chunks.push(part); objects.set(object.storage_key, Buffer.concat(chunks)); await afterWrite?.();
    },
    async open(object) { const found = objects.get(object.storage_key); return found ? { stream: (async function*() { yield found; })(), async dispose() {} } : null; }, async remove() {},
  };
  const writer = createWorkspaceRunArtifactWriter(store, backend, async () => allowed, () => now);
  return { store, objects, context, identity, bytes, writer, backend, now, puts: () => puts,
    stream: () => (async function*() { yield bytes; })(), setAllowed(value: boolean) { allowed = value; }, setUncertain(value: boolean) { uncertain = value; }, onWrite(fn: () => Promise<void>) { afterWrite = fn; } };
}
test('generated bytes have a durable exact run intent before write; known duplicate reopens without PUT', async () => {
  const s = await artifactIntentHarness(); await s.writer(s.context, s.identity, s.stream());
  assert.equal((await s.store.read('alice', state => state.tasks[0].runs![0].artifact_intents![0])).status, 'verified');
  const { createWorkspaceRunArtifactWriter } = await import('../uid-workspace-runtime.ts');
  await createWorkspaceRunArtifactWriter(s.store, s.backend, async () => true, () => s.now)(s.context, s.identity, s.stream());
  assert.equal(s.puts(), 1);
});
test('unknown generated write retains recoverable identity and retries never issue another PUT', async () => {
  const s = await artifactIntentHarness(); s.setUncertain(true);
  await assert.rejects(() => s.writer(s.context, s.identity, s.stream()));
  assert.equal((await s.store.read('alice', state => state.tasks[0].runs![0].artifact_intents![0])).status, 'unknown');
  s.setUncertain(false); await assert.rejects(() => s.writer(s.context, s.identity, s.stream()), /ARTIFACT_WRITE_RECONCILIATION_REQUIRED/); assert.equal(s.puts(), 1);
  s.objects.set(s.identity.storage_key, s.bytes); await s.writer(s.context, s.identity, s.stream()); assert.equal(s.puts(), 1);
  assert.equal((await s.store.read('alice', state => state.tasks[0].runs![0].artifact_intents![0])).status, 'verified');
});
test('stale run, lease, snapshot, cancellation and revoked role cannot write generated bytes', async () => {
  for (const mode of ['fence', 'lease', 'snapshot', 'cancel', 'role'] as const) {
    const s = await artifactIntentHarness();
    if (mode === 'role') s.setAllowed(false); else await s.store.transaction('alice', state => {
      const record = state.tasks[0];
      if (mode === 'fence') record.runs![0].fence++;
      if (mode === 'lease') record.runs![0].lease_expires_at = new Date(s.now - 1).toISOString();
      if (mode === 'snapshot') record.task = { ...record.task, snapshot: { ...record.task.snapshot, snapshot_id: 'changed' } };
      if (mode === 'cancel') record.actions.push({ type: 'cancel', status: 'queued' } as any);
    });
    await assert.rejects(() => s.writer(s.context, s.identity, s.stream()), /ARTIFACT_WRITE_FENCED|CURRENT_MEMBER_AUTHORIZATION_REQUIRED/); assert.equal(s.puts(), 0, mode);
  }
});
test('revocation or cancellation during object write prevents verified receipt and preserves unknown intent', async () => {
  for (const mode of ['cancel', 'role'] as const) {
    const s = await artifactIntentHarness(); s.onWrite(async () => { if (mode === 'role') s.setAllowed(false); else await s.store.transaction('alice', state => { state.tasks[0].actions.push({ type: 'cancel', status: 'queued' } as any); }); });
    await assert.rejects(() => s.writer(s.context, s.identity, s.stream()), /ARTIFACT_WRITE_FENCED|CURRENT_MEMBER_AUTHORIZATION_REQUIRED/);
    assert.equal(s.puts(), 1); assert.equal((await s.store.read('alice', state => state.tasks[0].runs![0].artifact_intents![0])).status, 'unknown');
    assert.ok(s.objects.has(s.identity.storage_key));
  }
});

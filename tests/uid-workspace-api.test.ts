import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { createWorkspaceRouter, createSupabaseWorkspaceVerifier, createSupabaseWorkspaceMembershipVerifier, createSupabaseWorkspaceLogin, workspaceOptionsFromEnv, type WorkspaceApiOptions, type WorkspaceLoginAttempt, type WorkspaceLoginLimiter } from '../uid-workspace-api.ts';
import { MemoryWorkspaceStore } from '../uid-workspace-store.ts';
import { buildWorkspaceReviewManifest } from '../uid-workspace-review.ts';

const origin = 'http://localhost:3000';
const verifyToken = async (token: string) => token === 'alice.test.sig' ? { id: 'alice' } : token === 'bob.test.sig' ? { id: 'bob' } : null;
const ready = () => ({ ready: true, blockers: [] });
const brief = { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://pawfecthouse.com/products/example', requirements: 'Use verified evidence.' };
async function setup(overrides: WorkspaceApiOptions = {}) {
  const store = overrides.store ?? new MemoryWorkspaceStore();
  const app = express();
  app.use('/api/workspace', createWorkspaceRouter({ store, verifyToken, verifyMembership: async () => ({ active: true, role: 'contributor' }), environment: 'test', publicOrigin: origin, ...overrides }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workspace`;
  const request = async (pathname: string, options: { method?: string; body?: unknown; user?: string | null; headers?: Record<string, string> } = {}) => {
    const response = await fetch(base + pathname, { method: options.method ?? 'GET', headers: {
      ...(options.user === null ? {} : { Authorization: 'Bearer ' + (options.user ?? 'alice') + '.test.sig' }),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const data = (response.headers.get('content-type') ?? '').includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { response, data };
  };
  return { store, request, base, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
const create = (request: Awaited<ReturnType<typeof setup>>['request'], key = 'create-0001') => request('/tasks', { method: 'POST', body: { idempotency_key: key, brief } });
const command = (task: any, key = 'start-0001', type = 'start') => ({ type, idempotency_key: key, expected_state_version: task.state_version, content_revision: task.snapshot.content_revision });

test('production defaults fail closed and never enable development persistence', async () => {
  const options = workspaceOptionsFromEnv({ NODE_ENV: 'production', UID_WORKSPACE_ENABLED: 'true', UID_WORKSPACE_STORE: 'filesystem', UID_WORKSPACE_STATE_DIR: '/tmp/not-created-by-workspace' });
  assert.equal(options.store, undefined);
  assert.equal(options.verifyToken, undefined);
  const app = await setup({ environment: 'production' });
  try {
    const config = (await app.request('/config', { user: null })).data;
    assert.equal(config.storage.configured, false);
    assert.equal(config.execution.ready, false);
    assert.equal((await create(app.request)).response.status, 503);
  } finally { await app.close(); }
});

test('auth required on every private route, cross-owner task and artifact access concealed', async () => {
  const app = await setup();
  try {
    const { data } = await create(app.request);
    const id = data.task.task_id;
    for (const route of ['/tasks', `/tasks/${id}`, `/tasks/${id}/events`, `/tasks/${id}/preview`, `/tasks/${id}/artifacts/a`]) {
      assert.equal((await app.request(route, { user: null })).response.status, 401, route);
    }
    for (const route of [`/tasks/${id}`, `/tasks/${id}/events`, `/tasks/${id}/preview`, `/tasks/${id}/artifacts/a`]) {
      assert.equal((await app.request(route, { user: 'bob' })).response.status, 404, route);
    }
    assert.equal((await app.request(`/tasks/${id}/actions`, { user: 'bob', method: 'POST', body: command(data.task) })).response.status, 404);
    assert.deepEqual((await app.request('/tasks', { user: 'bob' })).data.tasks, []);
    assert.equal(data.task.owner_id, 'alice');
  } finally { await app.close(); }
});

test('draft survives unavailable execution without fake outputs, action or state transition', async () => {
  const app = await setup();
  try {
    const result = await create(app.request); assert.equal(result.response.status, 201);
    const task = result.data.task; assert.equal(task.stage, 'draft');
    assert.deepEqual(task.artifacts, []); assert.equal(task.content, null); assert.equal(task.review_manifest, null);
    const start = await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: command(task) });
    assert.equal(start.response.status, 503); assert.equal(start.data.error.code, 'EXECUTION_UNAVAILABLE');
    const saved = (await app.request(`/tasks/${task.task_id}`)).data.task;
    assert.equal(saved.state_version, 0); assert.deepEqual(saved.actions, []);
    assert.equal((await app.request(`/tasks/${task.task_id}/preview`)).response.status, 404);
  } finally { await app.close(); }
});

test('creation and action idempotency are atomic; reuse with altered payload is conflict', async () => {
  const app = await setup({ executionReadiness: ready });
  try {
    const creations = await Promise.all(Array.from({ length: 6 }, () => create(app.request)));
    assert.equal(creations.filter(result => result.response.status === 201).length, 1);
    assert.equal(new Set(creations.map(result => result.data.task.task_id)).size, 1);
    const conflict = await app.request('/tasks', { method: 'POST', body: { idempotency_key: 'create-0001', brief: { ...brief, title: 'Changed' } } });
    assert.equal(conflict.response.status, 409);
    const task = creations[0].data.task;
    const results = await Promise.all(Array.from({ length: 6 }, () => app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: command(task) })));
    assert.equal(results.filter(result => result.response.status === 202).length, 1);
    assert.equal(results.filter(result => result.data.duplicate).length, 5);
    const accepted = results[0].data.task;
    assert.equal(accepted.state_version, 1); assert.equal(accepted.stage, 'draft');
    assert.equal(accepted.actions.length, 1); assert.equal(accepted.actions[0].status, 'queued');
    const changed = await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: command(task, 'start-0001', 'cancel') });
    assert.equal(changed.data.error.code, 'IDEMPOTENCY_CONFLICT');
    const events = await app.request(`/tasks/${task.task_id}/events?after=1`);
    assert.equal(events.data.events.length, 1); assert.equal(events.data.cursor, 2);
    assert.equal(events.data.events[0].type, 'action_queued');
  } finally { await app.close(); }
});

test('concurrent different actions use CAS, stale actions and unknown outcomes cannot retry', async () => {
  const app = await setup({ executionReadiness: ready });
  try {
    const task = (await create(app.request)).data.task;
    const results = await Promise.all(['first-0001', 'second-0001'].map(key => app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: command(task, key) })));
    assert.deepEqual(results.map(result => result.response.status).sort(), [202, 409]);
    assert.equal(results.find(result => result.response.status === 409)!.data.error.code, 'STALE_ACTION');
    await app.store.transaction('alice', state => { state.tasks[0].actions[0].status = 'unknown'; });
    const unknown = await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: { ...command(task, 'cancel-unknown', 'cancel'), expected_state_version: 1 } });
    assert.equal(unknown.data.error.code, 'RECONCILIATION_REQUIRED');
    const original = results.find(result => result.response.status === 202)!;
    const duplicate = await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: command(task, original.data.action.idempotency_key) });
    assert.equal(duplicate.data.duplicate, true); assert.equal(duplicate.data.action.status, 'unknown');
    assert.equal((await app.store.read('alice', state => state.tasks[0].actions.length)), 1);
  } finally { await app.close(); }
});

test('cookie sessions require same-origin mutation, fresh remote verification, and HttpOnly exchange', async () => {
  let allowed = true; let verifications = 0;
  const app = await setup({ verifyToken: async token => { verifications++; return allowed ? verifyToken(token) : null; } });
  try {
    const exchange = await app.request('/session', { method: 'POST', headers: { Origin: origin } });
    assert.equal(exchange.response.status, 200);
    const setCookie = exchange.response.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    assert.equal((await app.request('/session', { user: null, headers: { Cookie: cookie } })).response.status, 200);
    for (const headers of [{ Cookie: cookie }, { Cookie: cookie, Origin: 'https://evil.example' }] as Array<Record<string, string>>) {
      const result = await app.request('/tasks', { user: null, method: 'POST', headers, body: { idempotency_key: 'create-cookie', brief } });
      assert.equal(result.response.status, 403);
    }
    assert.equal((await app.request('/tasks', { user: null, method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: { idempotency_key: 'create-cookie', brief } })).response.status, 201);
    allowed = false;
    assert.equal((await app.request('/tasks', { user: null, headers: { Cookie: cookie } })).response.status, 401);
    assert.ok(verifications >= 4);
    assert.equal((await app.request('/session', { user: null, method: 'DELETE', headers: { Cookie: cookie, Origin: origin } })).response.status, 200);
  } finally { await app.close(); }
});

test('untrusted fields, source URLs, oversized requests and invalid replay cursors rejected', async () => {
  const app = await setup();
  try {
    for (const body of [{ idempotency_key: 'create-bad1', brief, owner_id: 'bob' }, { idempotency_key: 'create-bad2', brief: { ...brief, source_url: 'http://127.0.0.1/admin' } }, { idempotency_key: 'create-bad3', brief: { ...brief, source_url: 'https://user:pass@example.com/a' } }]) {
      assert.equal((await app.request('/tasks', { method: 'POST', body })).response.status, 400);
    }
    assert.equal((await app.request('/tasks', { method: 'POST', body: { idempotency_key: 'create-long', brief: { ...brief, requirements: 'x'.repeat(70000) } } })).response.status, 413);
    const task = (await create(app.request)).data.task;
    assert.equal((await app.request(`/tasks/${task.task_id}/events?after=-1`)).response.status, 400);
    assert.equal((await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: { ...command(task), receipt_id: 'invented' } })).response.status, 400);
  } finally { await app.close(); }
});

test('feedback resolves against server manifest and stale renders never queue edits', async () => {
  const app = await setup({ executionReadiness: ready });
  try {
    const task = (await create(app.request)).data.task;
    const manifest = buildWorkspaceReviewManifest({ task_id: task.task_id, content_revision: task.snapshot.content_revision, template_version: 'v1', canonical_hash: 'a'.repeat(64), render_hash: 'b'.repeat(64), elements: [{ id: 'title', kind: 'text', slot: 'hero_title', text_hash: 'c'.repeat(64) }] });
    await app.store.transaction('alice', state => { state.tasks[0].task = { ...state.tasks[0].task, stage: 'review' }; state.tasks[0].review_manifest = manifest; });
    const feedback = { task_id: task.task_id, content_revision: task.snapshot.content_revision, index_id: manifest.index_id, render_hash: manifest.render_hash, groups: [{ instruction: 'Shorten this title.', element_ids: ['title'], viewport_width: 1280 }] };
    const stale = await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: { ...command(task, 'feedback-stale', 'feedback'), feedback: { ...feedback, render_hash: 'd'.repeat(64) } } });
    assert.equal(stale.data.error.code, 'STALE_PREVIEW');
    const result = await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: { ...command(task, 'feedback-valid', 'feedback'), feedback } });
    assert.equal(result.response.status, 202); assert.equal(result.data.task.stage, 'review');
    const action = await app.store.read('alice', state => state.tasks[0].actions[0]);
    assert.equal((action.payload as any).status, 'RESOLVED_INTENT_NOT_EXECUTED');
  } finally { await app.close(); }
});

test('artifact bytes are owner-authorized, hash-checked and forced download', async () => {
  const bytes = Buffer.from('Actual test bytes'); let reads = 0;
  const app = await setup({ readArtifact: async () => { reads++; return bytes; } });
  try {
    const task = (await create(app.request)).data.task;
    await app.store.transaction('alice', state => { state.tasks[0].artifacts.push({ artifact_id: 'asset-1', revision_id: 'r1', filename: 'proof.txt', media_type: 'text/plain', size_bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), content_revision: task.snapshot.content_revision, kind: 'document', verification: 'verified', storage_key: 'private/key' }); });
    const route = `/tasks/${task.task_id}/artifacts/asset-1`;
    assert.equal((await app.request(route, { user: 'bob' })).response.status, 404); assert.equal(reads, 0);
    const result = await app.request(route); assert.equal(result.response.status, 200);
    assert.equal(result.data.toString(), bytes.toString()); assert.match(result.response.headers.get('content-disposition')!, /^attachment/);
    assert.match(result.response.headers.get('content-security-policy')!, /sandbox/);
    assert.equal((await app.request(`/tasks/${task.task_id}`)).data.task.artifacts[0].storage_key, undefined);
    await app.store.transaction('alice', state => { state.tasks[0].artifacts[0].sha256 = '0'.repeat(64); });
    assert.equal((await app.request(route)).data.error.code, 'ARTIFACT_INTEGRITY_FAILED');
  } finally { await app.close(); }
});

test('Supabase verifier performs live user check and membership authorization, rejects service keys', async () => {
  let calls = 0;
  const verifier = createSupabaseWorkspaceVerifier({ url: 'https://project.supabase.co', publicKey: 'sb_publishable_test', allowedUserIds: ['alice'], fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://project.supabase.co/auth/v1/user'); assert.equal((options!.headers as any).Authorization, 'Bearer not-locally-decoded');
    return new Response(JSON.stringify({ id: calls === 1 ? 'alice' : 'bob', role: 'authenticated', email_confirmed_at: '2026-01-01' }), { status: 200 });
  } });
  assert.deepEqual(await verifier('not-locally-decoded'), { id: 'alice' }); assert.equal(await verifier('not-locally-decoded'), null);
  assert.throws(() => createSupabaseWorkspaceVerifier({ url: 'https://project.supabase.co', publicKey: 'sb_secret_do_not_use', allowedUserIds: ['alice'] }), /PUBLIC_KEY_REQUIRED/);
  const down = createSupabaseWorkspaceVerifier({ url: 'https://project.supabase.co', publicKey: 'sb_publishable_test', allowedUserIds: ['alice'], fetcher: async () => new Response('', { status: 503 }) });
  await assert.rejects(() => down('a.b.c'), /AUTH_VERIFICATION_UNAVAILABLE/);
});

test('content feedback works before images and binds exact current slot hashes', async () => {
  const app = await setup({ executionReadiness: ready });
  try {
    const task = (await create(app.request)).data.task;
    await app.store.transaction('alice', state => {
      state.tasks[0].task = { ...state.tasks[0].task, stage: 'content_review' };
      state.tasks[0].content = { revision: task.snapshot.content_revision, slots: { hero_title: 'Original title', untouched: 'Keep this.' } };
    });
    const body = { ...command(task, 'content-feedback', 'content_feedback'), content_feedback: { groups: [{ instruction: 'Shorten this title.', text_slots: [{ slot: 'hero_title', text_hash: createHash('sha256').update('Original title').digest('hex') }] }] } };
    const staleBody = structuredClone(body); staleBody.content_feedback.groups[0].text_slots[0].text_hash = '0'.repeat(64);
    assert.equal((await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: staleBody })).data.error.code, 'STALE_CONTENT');
    const result = await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body });
    assert.equal(result.response.status, 202); assert.equal(result.data.task.review_manifest, null);
    assert.equal(result.data.task.content.slots.untouched, 'Keep this.');
    assert.equal(result.data.task.content.slots.hero_title, 'Original title');
    assert.equal(result.data.action.status, 'queued');
  } finally { await app.close(); }
});

test('production preview requires trusted renderer and exact stored current manifest', async () => {
  const memory = new MemoryWorkspaceStore();
  const store = { kind: 'production-test-injection', productionReady: true, read: memory.read.bind(memory), transaction: memory.transaction.bind(memory) };
  let current: any;
  const app = await setup({ store, environment: 'production', publicOrigin: 'https://workspace.example', renderPreview: async () => current });
  try {
    const task = (await create(app.request)).data.task;
    const manifest = buildWorkspaceReviewManifest({ task_id: task.task_id, content_revision: task.snapshot.content_revision, template_version: 'v1', canonical_hash: 'a'.repeat(64), render_hash: 'b'.repeat(64), elements: [{ id: 'title', kind: 'text', slot: 'hero_title', text_hash: 'c'.repeat(64) }] });
    current = { html: '<p>Test preview only</p>', manifest, channel_nonce: 'test', canonical: { html: '', css: '' }, status: 'PREVIEW_REQUIRES_VISUAL_QA' };
    await store.transaction('alice', state => { state.tasks[0].review_manifest = manifest; });
    assert.equal((await app.request(`/tasks/${task.task_id}/preview`, { user: 'bob' })).response.status, 404);
    assert.equal((await app.request(`/tasks/${task.task_id}/preview`)).response.status, 200);
    current = { ...current, manifest: { ...manifest, task_id: 'other-task' } };
    assert.equal((await app.request(`/tasks/${task.task_id}/preview`)).data.error.code, 'PREVIEW_SCOPE_MISMATCH');
  } finally { await app.close(); }
  const inline = await setup({ store, environment: 'production' });
  try {
    const task = (await inline.request('/tasks')).data.tasks[0];
    await store.transaction('alice', state => { state.tasks[0].preview = current; });
    assert.equal((await inline.request(`/tasks/${task.task_id}/preview`)).data.error.code, 'PREVIEW_UNAVAILABLE');
  } finally { await inline.close(); }
});

test('artwork acceptance binds authenticated user to actual current render and asset revisions only', async () => {
  const app = await setup({ executionReadiness: ready });
  try {
    const task = (await create(app.request)).data.task;
    const manifest = buildWorkspaceReviewManifest({ task_id: task.task_id, content_revision: task.snapshot.content_revision, template_version: 'v1', canonical_hash: 'a'.repeat(64), render_hash: 'b'.repeat(64), elements: [{ id: 'image:banner', kind: 'image', slot: 'banner_desktop', canonical_slot: 'banner_desktop', artifact_revision: 'asset-r1', sha256: 'c'.repeat(64) }] });
    const body = { ...command(task, 'approve-artwork', 'approve_artwork'), review_index_id: manifest.index_id, render_hash: manifest.render_hash };
    assert.equal((await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body })).data.error.code, 'ARTWORK_NOT_READY');
    await app.store.transaction('alice', state => {
      const record = state.tasks[0];
      record.task = { ...record.task, stage: 'review', snapshot: { ...record.task.snapshot, assets: [{ asset_id: 'banner', canonical_slot: 'banner_desktop', revision_id: 'asset-r1', content_revision: task.snapshot.content_revision, label: 'Banner' }] } };
      record.review_manifest = manifest;
      record.artifacts.push({ artifact_id: 'bytes1', revision_id: 'asset-r1', filename: 'banner.webp', media_type: 'image/webp', size_bytes: 100, sha256: 'c'.repeat(64), content_revision: task.snapshot.content_revision, kind: 'image', verification: 'verified', storage_key: 'private/bytes1' });
    });
    const stale = await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: { ...body, render_hash: 'd'.repeat(64) } });
    assert.equal(stale.data.error.code, 'STALE_PREVIEW');
    const result = await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body });
    assert.equal(result.response.status, 202); assert.equal(result.data.task.stage, 'review');
    const saved = await app.store.read('alice', state => state.tasks[0].actions[0]);
    assert.equal(saved.actor_id, 'alice'); assert.equal((saved.payload as any).approval_source, 'authenticated_user');
    assert.equal((saved.payload as any).assets[0].sha256, 'c'.repeat(64));
    assert.deepEqual(result.data.task.quality, []);
  } finally { await app.close(); }
});

test('current UID membership is required and revocation closes an existing session immediately', async () => {
  let active = true; let checks = 0;
  const app = await setup({ verifyMembership: async (identity, token) => { checks++; assert.equal(identity.id, 'alice'); assert.equal(token, 'alice.test.sig'); return active ? { active: true, role: 'contributor' } : null; } });
  try {
    assert.equal((await create(app.request)).response.status, 201);
    active = false;
    assert.equal((await app.request('/tasks')).response.status, 403);
    assert.equal((await app.request('/session')).response.status, 403);
    assert.equal(checks, 3);
  } finally { await app.close(); }
  const disabled = await setup({ verifyMembership: undefined });
  try {
    assert.equal((await disabled.request('/config')).data.authentication_configured, false);
    assert.equal((await create(disabled.request)).response.status, 503);
  } finally { await disabled.close(); }
});

test('password login is opt-in, same-origin, member-verified and returns only an HttpOnly cookie', async () => {
  let calls = 0; let member = true;
  const app = await setup({ login: async (email, password) => { calls++; assert.equal(email, 'member@example.com'); return password === 'test-only-password' ? { access_token: 'alice.test.sig' } : null; },
    verifyMembership: async () => member ? { active: true, role: 'contributor' } : null });
  try {
    assert.equal((await app.request('/config')).data.login_supported, true);
    const body = { email: 'member@example.com', password: 'test-only-password' };
    assert.equal((await app.request('/session/login', { user: null, method: 'POST', body, headers: { Origin: 'https://untrusted.example' } })).response.status, 403);
    assert.equal(calls, 0);
    const login = await app.request('/session/login', { user: null, method: 'POST', body, headers: { Origin: origin } });
    assert.equal(login.response.status, 200); assert.equal(login.data.authenticated, true);
    assert.match(login.response.headers.get('set-cookie')!, /HttpOnly/);
    assert.doesNotMatch(JSON.stringify(login.data), /test-only-password|alice\.test\.sig|access_token|refresh_token/);
    const cookie = login.response.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await app.request('/tasks', { user: null, headers: { Cookie: cookie } })).response.status, 200);
    member = false;
    const denied = await app.request('/session/login', { user: null, method: 'POST', body, headers: { Origin: origin } });
    assert.equal(denied.response.status, 401); assert.equal(denied.data.error.code, 'LOGIN_FAILED');
    const wrong = await app.request('/session/login', { user: null, method: 'POST', body: { ...body, password: 'wrong' }, headers: { Origin: origin } });
    assert.equal(wrong.data.error.message, denied.data.error.message);
    for (let index = 0; index < 8; index++) await app.request('/session/login', { user: null, method: 'POST', body: { ...body, password: 'wrong' }, headers: { Origin: origin } });
    const limited = await app.request('/session/login', { user: null, method: 'POST', body, headers: { Origin: origin, 'X-Forwarded-For': '8.8.8.8' } });
    assert.equal(limited.response.status, 429); assert.equal(calls, 11);
  } finally { await app.close(); }
  const disabled = await setup();
  try { assert.equal((await disabled.request('/session/login', { method: 'POST', user: null, body: {}, headers: { Origin: origin } })).data.error.code, 'LOGIN_NOT_CONFIGURED'); }
  finally { await disabled.close(); }
});

test('Supabase member resolver uses existing self-read RLS, handles revocation, and never uses service auth', async () => {
  let active = true;
  const resolver = createSupabaseWorkspaceMembershipVerifier({ url: 'https://project.supabase.co', publicKey: 'sb_publishable_test', fetcher: async (url, init) => {
    assert.equal(url, 'https://project.supabase.co/rest/v1/creative_dna_team_members?select=user_id,role,is_active&user_id=eq.alice&limit=2');
    assert.equal((init!.headers as any).Authorization, 'Bearer alice.test.sig');
    return new Response(JSON.stringify([{ user_id: 'alice', role: 'contributor', is_active: active }]));
  } });
  assert.deepEqual(await resolver({ id: 'alice' }, 'alice.test.sig'), { active: true, role: 'contributor' });
  active = false; assert.equal(await resolver({ id: 'alice' }, 'alice.test.sig'), null);
});

test('Supabase sign-in provider confines credentials to configured Auth and discards refresh tokens', async () => {
  const login = createSupabaseWorkspaceLogin({ url: 'https://project.supabase.co', publicKey: 'sb_publishable_test', fetcher: async (url, init) => {
    assert.equal(url, 'https://project.supabase.co/auth/v1/token?grant_type=password');
    assert.equal(init!.redirect, 'error');
    assert.deepEqual(JSON.parse(init!.body as string), { email: 'member@example.com', password: 'not-a-real-password' });
    return new Response(JSON.stringify({ access_token: 'alice.test.sig', refresh_token: 'must-never-be-retained' }));
  } });
  assert.deepEqual(await login('member@example.com', 'not-a-real-password'), { access_token: 'alice.test.sig' });
});

test('execution readiness fails closed for contradictory, missing, malformed and thrown state', async () => {
  for (const value of [{ ready: true, blockers: [{ code: 'BUDGET_UNAPPROVED', message: 'Budget approval is missing.' }] }, { ready: true }, { ready: 'true', blockers: [] }, { ready: true, blockers: [{}] }, null, undefined]) {
    const app = await setup({ executionReadiness: () => value as any });
    try {
      const result = await app.request('/config'); assert.equal(result.response.status, 200);
      assert.equal(result.data.execution.ready, false); assert.equal(result.data.materials[0].executable, false);
      assert.ok(result.data.execution.blockers.length > 0);
      const task = (await create(app.request)).data.task;
      assert.equal((await app.request(`/tasks/${task.task_id}/actions`, { method: 'POST', body: command(task) })).data.error.code, 'EXECUTION_UNAVAILABLE');
      assert.equal((await app.request(`/tasks/${task.task_id}`)).data.task.actions.length, 0);
    } finally { await app.close(); }
  }
  const app = await setup({ executionReadiness: () => { throw new Error('provider down'); } });
  try { assert.equal((await app.request('/config')).data.execution.blockers[0].code, 'EXECUTION_READINESS_UNKNOWN'); }
  finally { await app.close(); }
});

test('production login needs reviewed client resolution and a durable account/client limiter', async () => {
  let calls = 0;
  const login = async () => { calls++; return { access_token: 'alice.test.sig' }; };
  const cases: Array<WorkspaceApiOptions['loginProtection']> = [undefined,
    { reviewedIngress: true, resolveClientKey: () => 'fixed', limiter: { durable: false, begin: async () => ({ allowed: true, reservation_id: 'x' }), finish: async () => {} } },
    { reviewedIngress: false, resolveClientKey: () => 'fixed', limiter: { durable: true, begin: async () => ({ allowed: true, reservation_id: 'x' }), finish: async () => {} } } as any];
  for (const loginProtection of cases) {
    const app = await setup({ environment: 'production', publicOrigin: 'https://workspace.example', login, loginProtection });
    try {
      const config = (await app.request('/config')).data;
      assert.equal(config.login_supported, false); assert.equal(config.auth.login_blocker, 'LOGIN_RATE_LIMIT_NOT_CONFIGURED');
      const result = await app.request('/session/login', { user: null, method: 'POST', headers: { Origin: 'https://workspace.example', 'X-Forwarded-For': '8.8.8.8' }, body: { email: 'member@example.com', password: 'test-password' } });
      assert.equal(result.response.status, 503); assert.equal(result.data.error.code, 'LOGIN_RATE_LIMIT_NOT_CONFIGURED');
    } finally { await app.close(); }
  }
  assert.equal(calls, 0);
});

test('development login caps normalized account failures and successes never exhaust a shared ingress bucket', async () => {
  let calls = 0;
  const app = await setup({ login: async (_email, password) => { calls++; return password === 'good' ? { access_token: 'alice.test.sig' } : null; } });
  const login = (email: string, password: string, forwarded = '1.1.1.1') => app.request('/session/login', { user: null, method: 'POST', headers: { Origin: origin, 'X-Forwarded-For': forwarded }, body: { email, password } });
  try {
    for (let i = 0; i < 40; i++) assert.equal((await login(`member${i}@example.com`, 'good')).response.status, 200);
    for (let i = 0; i < 10; i++) assert.equal((await login(i % 2 ? 'MEMBER@example.com' : 'member@example.com', 'bad', `${i}.1.1.1`)).response.status, 401);
    assert.equal((await login('Member@Example.com', 'bad', '9.9.9.9')).response.status, 429);
    assert.equal((await login('other-member@example.com', 'good')).response.status, 200);
    assert.equal(calls, 51);
  } finally { await app.close(); }
});

test('production limiter receives separate trusted client and normalized account keys, not spoofed XFF', async () => {
  const attempts: WorkspaceLoginAttempt[] = []; const outcomes: string[] = [];
  const reserved = new Map<string, WorkspaceLoginAttempt>(); const failures = new Map<string, number>();
  // Test double only: production must inject an actually durable, independently
  // reviewed implementation. The fixture selector below is NOT an ingress policy.
  const limiter: WorkspaceLoginLimiter = { durable: true,
    async begin(attempt) {
      attempts.push(attempt);
      if ((failures.get(attempt.client_key) ?? 0) >= 2 || (failures.get(attempt.account_key) ?? 0) >= 2) return { allowed: false, retry_after_seconds: 60 };
      reserved.set(attempt.attempt_id, attempt); return { allowed: true, reservation_id: attempt.attempt_id };
    },
    async finish(id, outcome) {
      outcomes.push(outcome); const attempt = reserved.get(id)!; reserved.delete(id);
      if (outcome !== 'success') for (const key of [attempt.client_key, attempt.account_key]) failures.set(key, (failures.get(key) ?? 0) + 1);
    },
  };
  const app = await setup({ environment: 'production', publicOrigin: 'https://workspace.example',
    login: async (_email, password) => password === 'good' ? { access_token: 'alice.test.sig' } : null,
    loginProtection: { reviewedIngress: true, limiter, resolveClientKey: req => req.header('x-test-client-fixture') === 'second' ? 'trusted-client-two' : 'trusted-client-one' } });
  const login = (client: string, email: string, password: string, forwarded = '1.1.1.1') => app.request('/session/login', { user: null, method: 'POST', headers: { Origin: 'https://workspace.example', 'X-Test-Client-Fixture': client, 'X-Forwarded-For': forwarded }, body: { email, password } });
  try {
    assert.equal((await app.request('/config')).data.login_supported, true);
    for (let i = 0; i < 12; i++) assert.equal((await login('first', `legitimate${i}@example.com`, 'good')).response.status, 200);
    assert.equal((await login('first', 'target@example.com', 'bad')).response.status, 401);
    assert.equal((await login('first', 'TARGET@example.com', 'bad', '9.9.9.9')).response.status, 401);
    const previous = attempts.at(-2)!, current = attempts.at(-1)!;
    assert.equal(current.client_key, previous.client_key); assert.equal(current.account_key, previous.account_key);
    assert.equal((await login('first', 'unrelated@example.com', 'good', '8.8.8.8')).response.status, 429);
    assert.equal((await login('second', 'target@example.com', 'bad')).response.status, 429);
    const accepted = await login('second', 'unrelated@example.com', 'good');
    assert.equal(accepted.response.status, 200); assert.match(accepted.response.headers.get('set-cookie')!, /Secure/);
    assert.notEqual(attempts.at(-1)!.client_key, previous.client_key);
    assert.equal(reserved.size, 0); assert.equal(outcomes.filter(item => item === 'success').length, 13);
    for (const attempt of attempts) {
      // UUIDs and SHA-256 digests may coincidentally contain a short password
      // substring such as "bad". Assert the exact safe payload contract instead.
      assert.deepEqual(Object.keys(attempt).sort(), ['account_key', 'attempt_id', 'client_key']);
      assert.match(attempt.attempt_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.match(attempt.client_key, /^[0-9a-f]{64}$/);
      assert.match(attempt.account_key, /^[0-9a-f]{64}$/);
    }
  } finally { await app.close(); }
});

test('client resolution or limiter failure fails closed without provider call or session cookie', async () => {
  let providerCalls = 0;
  for (const resolveClientKey of [() => null, () => { throw new Error('ingress unknown'); }]) {
    const app = await setup({ environment: 'production', publicOrigin: 'https://workspace.example', login: async () => { providerCalls++; return { access_token: 'alice.test.sig' }; },
      loginProtection: { reviewedIngress: true, resolveClientKey, limiter: { durable: true, begin: async () => ({ allowed: true, reservation_id: 'x' }), finish: async () => {} } } });
    try {
      const result = await app.request('/session/login', { user: null, method: 'POST', headers: { Origin: 'https://workspace.example' }, body: { email: 'member@example.com', password: 'test-password' } });
      assert.equal(result.data.error.code, 'LOGIN_RATE_LIMIT_UNAVAILABLE'); assert.equal(result.response.headers.get('set-cookie'), null);
    } finally { await app.close(); }
  }
  assert.equal(providerCalls, 0);
});

test('viewer may read and sign in but cannot create, edit, upload or reconcile tasks',async()=>{
 const app=await setup({verifyMembership:async()=>({active:true,role:'viewer'}),executionReadiness:ready});
 try {
  assert.equal((await app.request('/tasks')).response.status,200);
  assert.equal((await app.request('/session',{method:'POST',headers:{Origin:origin}})).response.status,200);
  assert.equal((await create(app.request)).response.status,403);
  for(const path of ['/tasks/a/actions','/tasks/a/uploads','/tasks/a/recovery'])assert.equal((await app.request(path,{method:'POST',body:{}})).data.error.code,'WRITE_MEMBERSHIP_REQUIRED');
  assert.equal((await app.request('/tasks/a/uploads/u/reconcile',{method:'POST'})).data.error.code,'WRITE_MEMBERSHIP_REQUIRED');
 }finally{await app.close();}
});

test('cursor pagination is deterministic and owner-bound; malformed cursor never reads another owner',async()=>{
 const app=await setup();try{
  const first=(await create(app.request)).data.task;
  await app.store.transaction('alice',state=>{const seed=state.tasks[0];state.tasks=Array.from({length:103},(_,i)=>({...structuredClone(seed),task:{...structuredClone(seed.task),task_id:'task-'+String(i).padStart(3,'0')},updated_at:'2026-11-01T00:00:00Z'}));});
  const page=(await app.request('/tasks')).data;assert.equal(page.tasks.length,100);assert.equal(page.has_more,true);assert.equal(page.owner_id,'alice');
  const rest=(await app.request('/tasks?cursor='+page.next_cursor)).data;assert.equal(rest.tasks.length,3);assert.equal(rest.has_more,false);assert.equal(new Set([...page.tasks,...rest.tasks].map(t=>t.task_id)).size,103);
  assert.equal((await app.request('/tasks?cursor='+page.next_cursor,{user:'bob'})).response.status,400);
  assert.equal((await app.request('/tasks?cursor=invalid')).response.status,400);
  assert.equal((await app.request('/tasks?cursor='+page.next_cursor+'&offset=1')).response.status,400);
 }finally{await app.close();}
});

test('history returns immutable owner-scoped revisions, without storage keys or mutation authority',async()=>{
 const app=await setup();try{
  const task=(await create(app.request)).data.task;
  const manifest=buildWorkspaceReviewManifest({task_id:task.task_id,content_revision:task.snapshot.content_revision,template_version:'t1',canonical_hash:'a'.repeat(64),render_hash:'b'.repeat(64),elements:[{id:'text:title',kind:'text',slot:'title',text_hash:'c'.repeat(64)}]});
  await app.store.transaction('alice',state=>{const r=state.tasks[0];r.review_manifest=manifest;r.preview={html:'<p>Historical test fixture only</p>',manifest,channel_nonce:'nonce',canonical:{html:'',css:''},status:'PREVIEW_REQUIRES_VISUAL_QA'};
   r.revision_history=[{revision_id:'before',captured_at:'2026-11-01T00:00:00Z',action_id:'a',snapshot:{...r.task.snapshot,snapshot_id:'before'},content:r.content,preview:r.preview,review_manifest:r.review_manifest,artifact_ids:[]}];});
  const history=await app.request(`/tasks/${task.task_id}/revisions`);assert.equal(history.data.revisions.length,2);assert.equal(history.data.owner_id,'alice');
  const preview=await app.request(`/tasks/${task.task_id}/revisions/before/preview`);assert.equal(preview.response.status,200);assert.equal(preview.data.historical,true);assert.equal(preview.data.revision_id,'before');
  for(const suffix of ['/revisions','/revisions/before/preview'])assert.equal((await app.request(`/tasks/${task.task_id}`+suffix,{user:'bob'})).response.status,404);
  assert.equal((await app.request(`/tasks/${task.task_id}/revisions/missing/preview`)).response.status,404);
 }finally{await app.close();}
});

test('recovery capability is stage-verified and HTTP cannot submit provider outcome proofs',async()=>{
 let calls=0; const app=await setup({reconcile:async(owner,task,run,request)=>{calls++;assert.equal(owner,'alice');assert.equal(run,'run-1');assert.deepEqual(Object.keys(request).sort(),['expected_state_version','idempotency_key']);return{status:'unknown'};},recoveryReadiness:stage=>stage==='research'});
 try{
  const task=(await create(app.request)).data.task;await app.store.transaction('alice',state=>{state.tasks[0].runs=[{run_id:'run-1',stage:'research',status:'unknown'} as any];});
  assert.equal((await app.request(`/tasks/${task.task_id}/recovery`)).data.can_reconcile,true);
  const body={run_id:'run-1',expected_state_version:0,idempotency_key:'recover-0001'};
  assert.equal((await app.request(`/tasks/${task.task_id}/recovery`,{method:'POST',body:{...body,proof:{no_side_effect:true}}})).response.status,400);assert.equal(calls,0);
  assert.equal((await app.request(`/tasks/${task.task_id}/recovery`,{method:'POST',body,user:'bob'})).response.status,404);assert.equal(calls,0);
  assert.equal((await app.request(`/tasks/${task.task_id}/recovery`,{method:'POST',body})).response.status,200);assert.equal(calls,1);
 }finally{await app.close();}
});

test('real upload routes authorize first, resolve lost reservation, verify bytes and hide storage keys',async()=>{
 const {WorkspaceArtifactService,FileWorkspaceObjectStore}=await import('../uid-workspace-artifacts.ts');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const {default:sharp}=await import('../tools/creative-quality/sharp.ts');
 const root=await mkdtemp(path.join(tmpdir(),'uid-api-upload-'));const store=new MemoryWorkspaceStore();
 const service=new WorkspaceArtifactService(store,new FileWorkspaceObjectStore(root,{environment:"test",publicOrigin:origin}));const app=await setup({store,artifactService:service});
 try{
  assert.equal((await app.request('/config')).data.uploads.configured,true);
  const task=(await create(app.request)).data.task;const bytes=await sharp({create:{width:12,height:9,channels:3,background:'#337766'}}).png().toBuffer();
  const body={idempotency_key:'upload-0001',expected_state_version:0,content_revision:task.snapshot.content_revision,filename:'test.png',media_type:'image/png',size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),role:'product'};
  const route=`/tasks/${task.task_id}/uploads`;
  assert.equal((await app.request(route,{method:'POST',body,user:'bob'})).response.status,404);
  const reserved=await app.request(route,{method:'POST',body});assert.equal(reserved.response.status,201);assert.equal(reserved.data.upload.storage_key,undefined);
  const uploadId=reserved.data.upload.upload_id;assert.equal((await app.request(route+'?idempotency_key=upload-0001')).data.upload.upload_id,uploadId);
  const unauth=await fetch(app.base+route+'/'+uploadId,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});assert.equal(unauth.status,401);
  const uploaded=await fetch(app.base+route+'/'+uploadId,{method:'PUT',headers:{Authorization:'Bearer alice.test.sig','Content-Type':'application/octet-stream'},body:bytes});const linked=await uploaded.json();assert.equal(uploaded.status,200);assert.equal(linked.upload.status,'linked');
  const saved=(await app.request(`/tasks/${task.task_id}`)).data.task;assert.equal(saved.references.length,1);assert.equal(saved.references[0].storage_key,undefined);assert.equal(saved.references[0].visual_inspection,'not_performed');
  const referencePath=`/tasks/${task.task_id}/references/${saved.references[0].reference_id}`;
  assert.equal((await app.request(referencePath,{user:'bob'})).response.status,404);
  const download=await app.request(referencePath);assert.deepEqual(download.data,bytes);assert.equal(download.response.headers.get('x-content-sha256'),body.sha256);
  assert.equal((await app.request(referencePath,{method:'DELETE',body:{expected_state_version:saved.state_version,content_revision:saved.snapshot.content_revision}})).response.status,200);
  assert.equal((await app.request(`/tasks/${task.task_id}`)).data.task.references.length,0);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});

test('task admission is server-only, idempotent after persistence and task-scoped readiness blocks start',async()=>{
 let admitted=false;let count=0;let stored=false;const store=new MemoryWorkspaceStore();
 const app=await setup({store,executionReadiness:ready,admitTask:async(owner,id)=>{count++;stored=await store.read(owner,state=>state.tasks.some(r=>r.task.task_id===id));return{status:admitted?'already_admitted':'not_admitted',code:admitted?'OK':'TASK_POLICY_REQUIRED'};},taskExecutionReadiness:async()=>({ready:admitted,blockers:admitted?[]:[{code:'TASK_POLICY_REQUIRED',message:'Task spending policy is not authorized.'}]})});
 try{
  const createResponse=await create(app.request);const task=createResponse.data.task;
  assert.equal(stored,true);assert.equal(createResponse.response.status,201);assert.equal(createResponse.data.admission.status,'not_admitted');assert.equal(createResponse.data.readiness.execution.ready,false);
  assert.equal((await app.request(`/tasks/${task.task_id}/actions`,{method:'POST',body:command(task)})).response.status,503);
  assert.equal((await app.request(`/tasks/${task.task_id}`)).data.task.actions.length,0);
  admitted=true;
  assert.equal((await app.request(`/tasks/${task.task_id}/actions`,{method:'POST',body:command(task)})).response.status,202);
  assert.equal(count,3);
  assert.equal((await app.request(`/tasks/${task.task_id}/actions`,{method:'POST',body:{...command(task),grant:{limit:99999}}})).response.status,400);
 }finally{await app.close();}
});

test('feedback references must belong to current owner/task/content and exact review index',async()=>{
 const app=await setup({executionReadiness:ready});try{
  const task=(await create(app.request)).data.task;const h=createHash('sha256').update('Copy').digest('hex');
  const manifest=buildWorkspaceReviewManifest({task_id:task.task_id,content_revision:task.snapshot.content_revision,template_version:'t1',canonical_hash:'a'.repeat(64),render_hash:'b'.repeat(64),elements:[{id:'text:title',kind:'text',slot:'title',text_hash:h}]});
  await app.store.transaction('alice',state=>{const r=state.tasks[0];r.task={...r.task,stage:'content_review'};r.content={revision:r.task.snapshot.content_revision,slots:{title:'Copy'}};r.review_manifest=manifest;r.references=[{reference_id:'ref-valid',purpose:'feedback',content_revision:r.task.snapshot.content_revision,review_index_id:manifest.index_id,technical_validation:'full_decode_passed'} as any,{reference_id:'ref-brief',purpose:'brief',content_revision:r.task.snapshot.content_revision,technical_validation:'full_decode_passed'} as any];});
  const base={...command(task,'feedback-ref-1','content_feedback'),content_feedback:{groups:[{instruction:'Use reference style only',text_slots:[{slot:'title',text_hash:h}]}],reference_ids:['ref-missing']}};
  assert.equal((await app.request(`/tasks/${task.task_id}/actions`,{method:'POST',body:base})).data.error.code,'STALE_FEEDBACK_REFERENCE');
  base.content_feedback.reference_ids=['ref-brief'];assert.equal((await app.request(`/tasks/${task.task_id}/actions`,{method:'POST',body:base})).data.error.code,'STALE_FEEDBACK_REFERENCE');
  base.content_feedback.reference_ids=['ref-valid'];assert.equal((await app.request(`/tasks/${task.task_id}/actions`,{method:'POST',body:base})).response.status,202);
  const saved=await app.store.read('alice',state=>state.tasks[0].actions[0]);assert.deepEqual((saved.payload as any).reference_ids,['ref-valid']);
 }finally{await app.close();}
});

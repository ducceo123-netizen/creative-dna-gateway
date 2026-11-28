import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createV2App, BASELINE_COMMIT } from './server.ts';
import { SqliteStore } from './store.ts';
import { verifierFromEnv, PUBLIC_TEST_OWNER, PUBLIC_TEST_SUBJECT, PUBLIC_TEST_ORIGIN } from './auth.ts';
import { hash } from './core.ts';
import { OnepageOrchestrator } from './orchestrator.ts';
import { OBSERVED_EXECUTION } from './rules.ts';
import sharp from '../tools/creative-quality/sharp.ts';

// Transport fixtures are deliberately synthetic; no production compiler or cloud is called.
function fixture(input: any) {
  return {
    resolved: { brand: input.brand, branch: 'onepage-system' },
    dynamic_job: { source_url: input.source_url, source_type: input.source_type },
    execution: [...OBSERVED_EXECUTION], assets: [{ slot: 'banner_desktop', size: '2560x960' }],
    hard_gates: { product_physical_truth: 'HARD' },
    creative_quality_contract: { status: 'COMPILED', errors: [], rules: [{ id: 'synthetic:public-transport', instruction: 'Synthetic transport fixture, never creative evidence.', sources: [], scope: { brands: [input.brand] } }] },
    research_validation: { status: 'AWAITING_RESEARCH' },
    synthetic_lookup_fixture: { access: { meaning: 'Canonical fixture data, not runtime access metadata.' }, instruction: 'Preserve this exact object.' },
  };
}
const privateOwner = 'synthetic:private-owner';
const startArgs = (key: string) => ({ brand: 'pawfecthouse', brief: 'Synthetic public transport test only', sourceUrl: 'https://pawfecthouse.com/products/synthetic-test', idempotencyKey: key, capabilities: { artifactTransfer: true, imageInspection: true } });
async function setup() {
  const store = new SqliteStore(':memory:');
  let compilerCalls = 0;
  const orchestrator = new OnepageOrchestrator({ store, artifacts: { get: (o, j, h) => store.getArtifact(o, j, h), put: (o, j, b, m) => store.putArtifact(o, j, b, m) }, compile: async input => { compilerCalls++; return fixture(input); }, baselineCommit: BASELINE_COMMIT });
  const privateToken = 'uidv2_' + randomBytes(32).toString('base64url');
  const verify = verifierFromEnv({
    V2_AUTH_MODE: 'public-test', V2_MODE: 'isolated-test', V2_PUBLIC_ORIGIN: PUBLIC_TEST_ORIGIN,
    V2_TEST_PRINCIPALS_JSON: JSON.stringify([{ tokenSha256: hash(privateToken), owner: privateOwner, subject: 'synthetic:private-reviewer', role: 'reviewer' }]),
  });
  const deps = { orchestrator, store, verify, origin: 'http://127.0.0.1', publicTest: true };
  const app = createV2App(deps).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => app.once('listening', resolve));
  const origin = `http://127.0.0.1:${(app.address() as any).port}`;
  deps.origin = origin;
  let counter = 0;
  async function rpc(method: string, params: unknown = {}, authorization?: string) {
    const response = await fetch(origin + '/api/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', ...(authorization === undefined ? {} : { Authorization: authorization }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++counter, method, params }),
    });
    const text = await response.text();
    const raw = text.startsWith('{') ? text : text.split('\n').filter(line => line.startsWith('data: ')).at(-1)?.slice(6);
    return { response, packet: raw ? JSON.parse(raw) : undefined, text };
  }
  const call = (name: string, args: unknown, authorization?: string) => rpc('tools/call', { name, arguments: args }, authorization);
  const close = async () => { await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve())); store.close(); };
  return { store, origin, rpc, call, close, privateAuthorization: 'Bearer ' + privateToken, calls: () => compilerCalls };
}
function payload(result: any) { return JSON.parse(result.packet.result.content[0].text); }
function denied(result: any, code = 'NOT_FOUND') { assert.equal(result.packet.result.isError, true); assert.equal(payload(result).error.code, code); }
const pixels = () => sharp({ create: { width: 16, height: 16, channels: 3, background: '#5a8c71' } }).png().toBuffer();

test('anonymous SDK HTTP discovery, job context and actual artifact bytes work in the explicit shared sandbox', async () => {
  const f = await setup();
  try {
    const health = await (await fetch(f.origin + '/healthz')).json();
    assert.equal(health.authRequired, false); assert.equal(health.publicSandbox, true); assert.equal(health.authMode, 'public-test');
    const init = await f.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic-public-client', version: '1' } });
    assert.equal(init.response.status, 200); assert.match(init.packet.result.instructions, /shared test data/); assert.match(init.packet.result.instructions, /not a verified person/);
    const discovery = await f.rpc('tools/list');
    const names = discovery.packet.result.tools.map((tool: any) => tool.name);
    assert.equal(names.length, 17); assert.equal(new Set(names).size, 17);
    assert.ok(names.every((name: string) => name.startsWith('onepage_')));
    assert.ok(!names.some((name: string) => /publish|train|admin/.test(name)));
    const started = payload(await f.call('onepage_start', startArgs('public-shared-idempotency')));
    const resumed = payload(await f.call('onepage_start', startArgs('public-shared-idempotency')));
    assert.equal(started.jobId, resumed.jobId); assert.equal(f.calls(), 1);
    assert.equal(f.store.read(PUBLIC_TEST_OWNER, started.jobId).owner, PUBLIC_TEST_OWNER);
    const context = payload(await f.call('onepage_get_stage_context', { jobId: started.jobId }));
    assert.ok(context.receipt.bundleHash); assert.equal(context.receipt.snapshotHash, started.canonicalHash);
    const current = payload(await f.call('onepage_get_state', { jobId: started.jobId, detail: 'full' }));
    assert.equal(current.storageRevision, context.storageRevision);
    assert.deepEqual(current.canonicalSteps, OBSERVED_EXECUTION);
    const bytes = await pixels();
    const uploaded = payload(await f.call('onepage_upload_artifact', { jobId: started.jobId, mime: 'image/png', base64: bytes.toString('base64') }));
    assert.equal(uploaded.sha256, hash(bytes)); assert.equal(uploaded.byteLength, bytes.length);
    const image = await f.call('onepage_read_artifact', { jobId: started.jobId, sha256: uploaded.sha256 });
    assert.equal(image.packet.result.content[0].type, 'image');
    assert.deepEqual(Buffer.from(image.packet.result.content[0].data, 'base64'), bytes);
    const path = f.origin + '/v2/jobs/' + started.jobId + '/artifacts';
    const rawUpload = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
    assert.equal(rawUpload.status, 201); assert.equal((await rawUpload.json()).sha256, hash(bytes));
    const download = await fetch(path + '/' + uploaded.sha256);
    assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'image/png');
    assert.match(download.headers.get('cache-control') || '', /no-store/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    const html = Buffer.from('<!doctype html><p>Synthetic public artifact</p>');
    const artifact = f.store.putArtifact(PUBLIC_TEST_OWNER, started.jobId, html, 'text/html');
    const link = await f.call('onepage_read_artifact', { jobId: started.jobId, sha256: artifact.sha256 });
    assert.match(JSON.parse(link.packet.result.content[1].text).authentication, /No authentication required/);
    const resource = await f.rpc('resources/read', { uri: link.packet.result.content[0].uri });
    assert.deepEqual(Buffer.from(resource.packet.result.contents[0].blob, 'base64'), html);
  } finally { await f.close(); }
});

test('public rule and evidence lookups preserve exact arrays, null, scalars and canonical access fields', async () => {
  const f = await setup();
  try {
    const started = payload(await f.call('onepage_start', startArgs('public-evidence-shapes')));
    assert.deepEqual(started.access, { mode: 'public-test', sharedSandbox: true, actor: PUBLIC_TEST_SUBJECT, identityVerified: false });
    const canonicalObject = { access: { meaning: 'Canonical fixture data, not runtime access metadata.' }, instruction: 'Preserve this exact object.' };
    for (const [path, expected] of [
      ['job:references', []], ['job:inspections', []], ['job:plan', null],
      ['/resolved/brand', 'pawfecthouse'], ['/synthetic_lookup_fixture', canonicalObject],
    ] as const) {
      const result = await f.call('onepage_get_rule_or_evidence', { jobId: started.jobId, path });
      assert.equal(result.response.status, 200); assert.equal(result.packet.result.isError, false);
      assert.deepEqual(payload(result), expected);
      assert.equal(result.packet.result.content[0].text, JSON.stringify(expected));
    }
    const state = payload(await f.call('onepage_get_state', { jobId: started.jobId }));
    assert.deepEqual(state.access, started.access);
  } finally { await f.close(); }
});

test('public namespace cannot read or mutate private jobs through tools, REST or MCP resources', async () => {
  const f = await setup();
  try {
    const args = startArgs('same-public-private-key');
    const privateJob = payload(await f.call('onepage_start', args, f.privateAuthorization));
    const publicJob = payload(await f.call('onepage_start', args));
    assert.notEqual(privateJob.jobId, publicJob.jobId); assert.equal(f.calls(), 2);
    const bytes = await pixels();
    const artifact = f.store.putArtifact(privateOwner, privateJob.jobId, bytes, 'image/png');
    const before = f.store.read(privateOwner, privateJob.jobId);
    const telemetryBefore = f.store.telemetry(privateOwner, privateJob.jobId);
    for (const [name, extra] of [
      ['onepage_get_state', {}], ['onepage_get_full_context', {}], ['onepage_get_stage_context', {}],
      ['onepage_get_rule_or_evidence', { path: 'job:research' }], ['onepage_get_telemetry', {}],
      ['onepage_advance', { revision: 0 }], ['onepage_revision', { revision: 0, scope: 'cancel', reason: 'Synthetic unauthorized mutation attempt.' }],
      ['onepage_upload_artifact', { mime: 'image/png', base64: bytes.toString('base64') }],
      ['onepage_read_artifact', { sha256: artifact.sha256 }],
    ] as const) denied(await f.call(name, { jobId: privateJob.jobId, ...extra }));
    const path = f.origin + '/v2/jobs/' + privateJob.jobId + '/artifacts';
    for (const response of [
      await fetch(path + '/' + artifact.sha256),
      await fetch(path, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes }),
    ]) { assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: 'NOT_FOUND' }); }
    const uri = `uid-v2://artifacts/${privateJob.jobId}/${artifact.sha256}`;
    const blocked = await f.rpc('resources/read', { uri });
    assert.ok(blocked.packet.error); assert.equal(blocked.packet.result, undefined);
    assert.ok(!blocked.text.includes(bytes.toString('base64')));
    assert.deepEqual(f.store.read(privateOwner, privateJob.jobId), before);
    assert.deepEqual(f.store.telemetry(privateOwner, privateJob.jobId), telemetryBefore);
    assert.deepEqual(f.store.getArtifact(privateOwner, privateJob.jobId, artifact.sha256), bytes);
    const privateState = payload(await f.call('onepage_get_state', { jobId: privateJob.jobId }, f.privateAuthorization));
    assert.equal(privateState.jobId, privateJob.jobId);
    const privateResource = await f.rpc('resources/read', { uri }, f.privateAuthorization);
    assert.deepEqual(Buffer.from(privateResource.packet.result.contents[0].blob, 'base64'), bytes);
    const privateDownload = await fetch(path + '/' + artifact.sha256, { headers: { Authorization: f.privateAuthorization } });
    assert.equal(privateDownload.status, 200); assert.deepEqual(Buffer.from(await privateDownload.arrayBuffer()), bytes);
    denied(await f.call('onepage_get_state', { jobId: publicJob.jobId }, f.privateAuthorization));
  } finally { await f.close(); }
});

test('supplied invalid credentials never fall back to public access', async () => {
  const f = await setup();
  try {
    for (const authorization of ['', 'Basic synthetic', 'Bearer uidv2_' + 'x'.repeat(43)]) {
      const result = await f.rpc('tools/list', {}, authorization);
      assert.equal(result.response.status, 401); assert.deepEqual(result.packet, { error: 'UNAUTHORIZED' });
      assert.match(result.response.headers.get('www-authenticate') || '', /^Bearer /);
    }
    assert.equal((await f.rpc('tools/list')).response.status, 200);
    assert.equal((await f.rpc('tools/list', {}, f.privateAuthorization)).response.status, 200);
  } finally { await f.close(); }
});

test('public approvals require exact current hashes and QC, and record an anonymous test actor truthfully', async () => {
  const f = await setup();
  try {
    const job = payload(await f.call('onepage_start', startArgs('public-approval-gates')));
    denied(await f.call('onepage_approve', { jobId: job.jobId, revision: 0, kind: 'final', expectedHash: 'a'.repeat(64) }), 'STALE_APPROVAL');
    const blocked = payload(await f.call('onepage_advance', { jobId: job.jobId, revision: 0 }));
    assert.equal(blocked.state, 'BLOCKED'); assert.ok(blocked.blockers.length); assert.equal(blocked.progress.canonicalCompleted, 0); assert.equal(blocked.progress.additionalCompleted, 0);
    // Seed a synthetic plan boundary to isolate approval transport from full creative workflow tests.
    const plan = { mode: 'gtk', copy: { title_01: 'Synthetic copy' }, allocation: {} };
    const planHash = hash(plan), researchHash = hash('synthetic research');
    let record = f.store.update(PUBLIC_TEST_OWNER, job.jobId, blocked.storageRevision, current => ({ ...current, plan, planHash, researchHash }));
    denied(await f.call('onepage_approve', { jobId: job.jobId, revision: record.storageRevision, kind: 'content', expectedHash: planHash }), 'CONTENT_QC_REQUIRED');
    const requirements = payload(await f.call('onepage_get_rule_or_evidence', { jobId: job.jobId, path: 'qc-requirements:content' }));
    const receipt = { scope: 'content', inputHashes: requirements.inputHashes, method: 'host_visual', observations: 'Synthetic approval transport exercise, not real creative review.', reviewedAt: new Date().toISOString(), findings: requirements.criteria.map((criterion: string) => ({ criterion, outcome: 'PASS', observation: 'Synthetic gate fixture only.' })) };
    denied(await f.call('onepage_submit_qc', { jobId: job.jobId, revision: record.storageRevision, ...receipt, inputHashes: ['a'.repeat(64)] }), 'QC_INPUT_MISMATCH');
    const reviewed = payload(await f.call('onepage_submit_qc', { jobId: job.jobId, revision: record.storageRevision, ...receipt }));
    denied(await f.call('onepage_approve', { jobId: job.jobId, revision: reviewed.storageRevision, kind: 'content', expectedHash: 'b'.repeat(64) }), 'STALE_APPROVAL');
    const approved = payload(await f.call('onepage_approve', { jobId: job.jobId, revision: reviewed.storageRevision, kind: 'content', expectedHash: planHash }));
    assert.equal(approved.approvals.length, 1); assert.equal(approved.approvals[0].reviewer, PUBLIC_TEST_SUBJECT);
    assert.equal(approved.approvals[0].inputHash, planHash);
    record = f.store.read(PUBLIC_TEST_OWNER, job.jobId);
    assert.equal(record.qc.content.reviewer, PUBLIC_TEST_SUBJECT);
    assert.equal(record.qc.content.attestation, 'HOST_OR_HUMAN_REPORTED_NOT_SERVER_VISION');
    assert.deepEqual(record.input.lockedCopy, plan.copy);
    denied(await f.call('onepage_approve', { jobId: job.jobId, revision: record.storageRevision, kind: 'package', expectedHash: planHash }), 'STALE_APPROVAL');
    assert.equal(f.store.read(PUBLIC_TEST_OWNER, job.jobId).delivery, undefined);
  } finally { await f.close(); }
});

test('anonymous requests share a bounded rate budget without consuming the private principal budget', async () => {
  const f = await setup();
  try {
    for (let i = 0; i < 120; i++) {
      const response = await fetch(f.origin + '/missing', { headers: { 'X-Forwarded-For': `192.0.2.${i % 250 + 1}` } });
      assert.equal(response.status, 404); await response.body?.cancel();
    }
    const limited = await f.rpc('tools/list');
    assert.equal(limited.response.status, 429); assert.deepEqual(limited.packet, { error: 'RATE_LIMIT' });
    assert.equal((await f.rpc('tools/list', {}, f.privateAuthorization)).response.status, 200);
    assert.equal((await fetch(f.origin + '/healthz')).status, 200);
  } finally { await f.close(); }
});

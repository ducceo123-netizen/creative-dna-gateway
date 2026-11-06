import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkspaceRunner, workspaceContentDigest, type TrustedWorkspaceStageAdapter, type WorkspaceRunnerStage, type WorkspaceStageContext, type WorkspaceStageOutput, type WorkspaceRunRecord } from '../uid-workspace-runner.ts';
import { createWorkspaceTask, type ReceiptKind } from '../uid-workspace-task.ts';
import { MemoryWorkspaceStore, FileWorkspaceStore, type WorkspaceStore, type WorkspaceRecord, type WorkspaceActionRecord, type WorkspaceArtifact } from '../uid-workspace-store.ts';
import { buildWorkspaceReviewManifest } from '../uid-workspace-review.ts';
import { ONEPAGE_DELIVERY_ROLES } from '../supabase/functions/_shared/onepage-packaging.ts';

// Explicit test-only evidence fixture. This is NOT a real provider or EO acceptance.
const checks = ['canonical_compiled', 'source_evidence', 'source_coverage', 'content_schema', 'supported_claims', 'semantic_content', 'approved_content', 'actual_asset_bytes', 'product_fidelity_pixels', 'technical_images', 'source_claims', 'canonical_bindings', 'desktop_mobile_render', 'human_artistic_review', 'canonical_inventory', 'opened_zip', 'artifact_checksums', 'mapping_render', 'selected_scope_preserved', 'preview_render', 'content_asset_compatibility', 'unchanged_asset_bytes'];
const kinds: Record<WorkspaceRunnerStage, ReceiptKind> = { draft: 'brief_accepted', research: 'research_complete', content_authoring: 'content_ready', assets: 'assets_complete', review: 'review_passed', packaging: 'package_verified', content_feedback: 'content_revised', asset_feedback: 'assets_revised', assets_reuse: 'assets_complete' };
const slots = Object.keys(ONEPAGE_DELIVERY_ROLES).slice(0, 2);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const time = '2026-11-06T10:00:00.000Z';
let sequence = 0;
function newAction(record: WorkspaceRecord, type: WorkspaceActionRecord['type'], payload: unknown = {}): WorkspaceActionRecord {
  const action: WorkspaceActionRecord = { action_id: 'a' + ++sequence, idempotency_key: 'key-' + sequence, fingerprint: 'test:' + sequence, type, status: 'queued', expected_state_version: record.task.state_version,
    content_revision: record.task.snapshot.content_revision, created_at: time, actor_id: record.owner_id, payload };
  record.actions.push(action); record.task = { ...record.task, state_version: record.task.state_version + 1 }; return action;
}
function draft(ownerId = 'owner-1', taskId = 'task-1'): WorkspaceRecord {
  const record: WorkspaceRecord = { owner_id: ownerId, task: createWorkspaceTask(taskId, { snapshot_id: 'brief-s1', canonical_version: 'unresolved', content_revision: 'brief-v1', content_digest: sha('brief'), assets: [] }),
    brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://example.com/product' }, created_at: time, updated_at: time,
    actions: [], events: [], artifacts: [], review_manifest: null, preview: null, content: null, quality: [] };
  newAction(record, 'start'); return record;
}
async function seed(store: WorkspaceStore, record = draft()) { await store.transaction(record.owner_id, state => { state.tasks.push(record); }); }
async function read(store: WorkspaceStore, owner = 'owner-1') { return store.read(owner, state => state.tasks[0]); }
const config = (store: WorkspaceStore, overrides: Record<string, unknown> = {}) => ({ store, environment: 'test' as const, adapters: fixtureAdapters(), executionReadiness: () => ({ ready: true, blockers: [] }), authorizeOwner: async () => true, ...overrides });
function artifact(revision: string, contentRevision: string, kind: WorkspaceArtifact['kind'] = 'image'): WorkspaceArtifact {
  return { artifact_id: 'file:' + revision, revision_id: revision, filename: revision.replace(/[^A-Za-z0-9._-]/g, '_') + (kind === 'package' ? '.zip' : '.png'), media_type: kind === 'package' ? 'application/zip' : 'image/png',
    size_bytes: 12, sha256: sha(revision), content_revision: contentRevision, kind, verification: 'verified', storage_key: 'private/test/' + revision, width: 500, height: 500 };
}
function fixtureOutput(context: WorkspaceStageContext): WorkspaceStageOutput {
  const { record, run } = context; const task = record.task;
  const receipt = { receipt_id: 'receipt:' + run.run_id, task_id: task.task_id, state_version: task.state_version, snapshot_id: task.snapshot.snapshot_id, content_revision: task.snapshot.content_revision,
    kind: kinds[run.stage], evidence_ref: 'test-evidence:' + run.run_id, ...(task.pending_feedback ? { feedback_action_id: task.pending_feedback.action_id } : {}) };
  const output: WorkspaceStageOutput = { receipt, evidence_refs: [receipt.evidence_ref] };
  if (run.stage === 'draft') output.receipt = { ...output.receipt, snapshot: { ...task.snapshot, snapshot_id: 'canonical:' + run.run_id, canonical_version: 'canonical:real-fixture-hash' } };
  if (run.stage === 'content_authoring' || run.stage === 'content_feedback') {
    const content: NonNullable<WorkspaceRecord['content']> = { revision: 'content:' + run.run_id, slots: record.content ? { ...record.content.slots } : { hero_title: 'Inspected product title', support: 'Supported detail' } };
    if (run.stage === 'content_feedback') for (const group of context.feedback!.groups) for (const selected of group.text_slots) content.slots[selected.slot] += ' revised';
    output.content = content;
    output.receipt = { ...output.receipt, snapshot: { ...task.snapshot, snapshot_id: 'content-s:' + run.run_id, content_revision: content.revision, content_digest: workspaceContentDigest(content.slots), assets: [] } };
  }
  if (run.stage === 'assets' || run.stage === 'asset_feedback') {
    const selected = new Set(context.feedback?.groups.flatMap(group => group.assets?.map(asset => asset.canonical_slot) ?? []) ?? slots);
    const assets = run.stage === 'assets' ? slots.map((slot, i) => ({ asset_id: 'asset:' + i, canonical_slot: slot, revision_id: 'image:' + run.run_id + ':' + i, content_revision: task.snapshot.content_revision, label: 'Image ' + i }))
      : task.snapshot.assets.map(asset => selected.has(asset.canonical_slot) ? { ...asset, revision_id: 'revised:' + run.run_id + ':' + asset.asset_id } : asset);
    output.receipt = { ...output.receipt, snapshot: { ...task.snapshot, snapshot_id: 'assets-s:' + run.run_id, assets } };
    output.artifacts = assets.filter(asset => selected.has(asset.canonical_slot)).map(asset => artifact(asset.revision_id, asset.content_revision));
  }
  if (run.stage === 'assets_reuse') {
    const assets = context.revision_plan!.source_snapshot.assets.map(asset => ({ ...asset, content_revision: task.snapshot.content_revision }));
    output.receipt = { ...output.receipt, snapshot: { ...task.snapshot, snapshot_id: 'reuse-s:' + run.run_id, assets } };
    output.artifacts = context.revision_plan!.source_assets.map(source => {
      const before = record.artifacts.find(file => file.artifact_id === source.artifact_id)!;
      return { ...before, artifact_id: 'rebound:' + run.run_id + ':' + before.artifact_id, content_revision: task.snapshot.content_revision };
    });
  }
  if (run.stage === 'packaging') output.artifacts = [artifact('package:' + run.run_id, task.snapshot.content_revision, 'package')];
  if (['content_authoring', 'content_feedback', 'assets', 'asset_feedback', 'assets_reuse'].includes(run.stage)) {
    const snapshot = output.receipt.snapshot!; const content = output.content ?? record.content;
    const inventory = [...record.artifacts, ...(output.artifacts ?? [])];
    const manifest = buildWorkspaceReviewManifest({ task_id: task.task_id, content_revision: snapshot.content_revision, template_version: 'template-v1', canonical_hash: sha('canonical'), render_hash: sha(run.run_id),
      elements: [...Object.entries(content!.slots).map(([slot, value]) => ({ id: 'text:' + slot, kind: 'text', slot, text_hash: sha(value) })),
        ...snapshot.assets.map(asset => ({ id: asset.asset_id, kind: 'image', slot: asset.canonical_slot, canonical_slot: asset.canonical_slot, artifact_revision: asset.revision_id, sha256: inventory.find(item => item.revision_id === asset.revision_id)!.sha256 }))] });
    output.preview = { html: '<html>Actual fixture document</html>', manifest, channel_nonce: 'nonce:' + run.run_id, canonical: { html: '<html>Canonical fixture</html>', css: '' }, status: 'PREVIEW_REQUIRES_VISUAL_QA' };
  }
  return output;
}
function fixtureAdapter(onExecute?: (context: WorkspaceStageContext) => void): TrustedWorkspaceStageAdapter {
  return { async execute(context) { onExecute?.(context); return { outcome: 'completed', output: fixtureOutput(context) }; },
    async verifyEvidence(context, output) { return { verified: true, task_id: context.record.task.task_id, snapshot_id: context.record.task.snapshot.snapshot_id, state_version: context.record.task.state_version, receipt_id: output.receipt.receipt_id, evidence_refs: output.evidence_refs, checks }; } };
}
function fixtureAdapters(onExecute?: (context: WorkspaceStageContext) => void) { return Object.fromEntries(Object.keys(kinds).map(stage => [stage, fixtureAdapter(onExecute)])) as Record<WorkspaceRunnerStage, TrustedWorkspaceStageAdapter>; }
async function approve(store: WorkspaceStore) { await store.transaction('owner-1', state => { const record = state.tasks[0]; newAction(record, 'approve_content', { approval_source: 'authenticated_user', content_digest: record.task.snapshot.content_digest, snapshot_id: record.task.snapshot.snapshot_id }); }); }
async function toContentReview(store: WorkspaceStore) { await seed(store); await createWorkspaceRunner(config(store)).drainOwner('owner-1'); assert.equal((await read(store)).task.stage, 'content_review'); }
async function approveArtwork(store: WorkspaceStore) { await store.transaction('owner-1', state => { const record = state.tasks[0]; newAction(record, 'approve_artwork', { approval_source: 'authenticated_user', snapshot_id: record.task.snapshot.snapshot_id, content_digest: record.task.snapshot.content_digest, review_index_id: record.review_manifest!.index_id, render_hash: record.review_manifest!.render_hash, assets: record.task.snapshot.assets.map(asset => ({ asset_id: asset.asset_id, canonical_slot: asset.canonical_slot, revision_id: asset.revision_id, sha256: record.artifacts.find(file => file.revision_id === asset.revision_id)!.sha256 })) }); }); }
async function toCompleted(store: WorkspaceStore) { await toContentReview(store); await approve(store); const runner = createWorkspaceRunner(config(store)); await runner.drainOwner('owner-1'); assert.equal((await read(store)).task.stage, 'review'); await approveArtwork(store); await runner.drainOwner('owner-1'); assert.equal((await read(store)).task.stage, 'completed'); }

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('one start chains to content approval, then artwork approval and verified package', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); const called: string[] = [];
  const runner = createWorkspaceRunner(config(store, { adapters: fixtureAdapters(context => { called.push(context.run.stage); }) }));
  await runner.drainOwner('owner-1');
  let record = await read(store);
  assert.deepEqual(called, ['draft', 'research', 'content_authoring']);
  assert.equal(record.task.stage, 'content_review'); assert.equal(record.actions[0].status, 'succeeded'); assert.equal(record.task.approval, undefined);
  assert.equal(record.task.snapshot.canonical_version, 'canonical:real-fixture-hash'); assert.ok(record.preview);
  await runner.drainOwner('owner-1'); assert.equal(called.length, 3, 'poll/repeated drain cannot self approve');
  await approve(store); await runner.drainOwner('owner-1'); record = await read(store);
  assert.equal(record.task.stage, 'review'); assert.deepEqual(called, ['draft', 'research', 'content_authoring', 'assets']);
  await runner.drainOwner('owner-1'); assert.equal(called.length, 4, 'cannot self approve artwork');
  await approveArtwork(store); await runner.drainOwner('owner-1'); record = await read(store);
  assert.deepEqual(called, ['draft', 'research', 'content_authoring', 'assets', 'review', 'packaging']);
  assert.equal(record.task.stage, 'completed'); assert.ok(record.task.approval); assert.equal(record.receipts?.length, 7);
  assert.equal(record.artifacts.filter(item => item.kind === 'package').length, 1);
  assert.ok(record.events.some(event => event.type === 'approval_required')); assert.ok(record.events.some(event => event.type === 'task_completed'));
  assert.deepEqual(record.events.map(event => event.sequence), record.events.map((_, i) => i + 1));
});

test('no adapters/default authorization never fabricate success; production rejects development persistence', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store);
  const disabled = createWorkspaceRunner({ store, environment: 'test' });
  assert.equal(disabled.readiness().ready, false); assert.equal((await disabled.runNext('owner-1')).status, 'blocked');
  const record = await read(store); assert.equal(record.task.stage, 'blocked'); assert.equal(record.content, null); assert.equal(record.artifacts.length, 0);
  assert.equal(createWorkspaceRunner({ ...config(store), environment: 'production' }).readiness().ready, false);
});

test('two workers cannot submit the same claimed stage concurrently', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); const entered = deferred<void>(); const release = deferred<void>(); let calls = 0;
  const adapters = fixtureAdapters(); const original = adapters.draft;
  adapters.draft = { ...original, async execute(context) { calls++; entered.resolve(); await release.promise; return original.execute(context); } };
  const first = createWorkspaceRunner(config(store, { adapters, workerId: 'first' })).runNext('owner-1'); await entered.promise;
  const second = await createWorkspaceRunner(config(store, { adapters, workerId: 'second' })).runNext('owner-1');
  assert.equal(second.status, 'busy'); assert.equal(calls, 1); release.resolve(); assert.equal((await first).status, 'advanced');
  assert.equal((await read(store)).runs?.filter(run => run.stage === 'draft').length, 1);
});

test('filesystem restart resumes queued automatic stages without repeating committed provider work', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'uid-runner-'));
  try {
    const firstStore = new FileWorkspaceStore(directory, { environment: 'test' }); await seed(firstStore); const calls: string[] = [];
    await createWorkspaceRunner(config(firstStore, { adapters: fixtureAdapters(context => { calls.push(context.run.stage); }) })).runNext('owner-1');
    const restarted = new FileWorkspaceStore(directory, { environment: 'test' });
    await createWorkspaceRunner(config(restarted, { adapters: fixtureAdapters(context => { calls.push(context.run.stage); }) })).drainOwner('owner-1');
    assert.deepEqual(calls, ['draft', 'research', 'content_authoring']); assert.equal((await read(restarted)).task.stage, 'content_review');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('expired pre-submit claim can be fenced and reclaimed; old fence cannot commit', async () => {
  const store = new MemoryWorkspaceStore(); const record = draft(); record.actions[0].status = 'running';
  const run: WorkspaceRunRecord = { run_id: 'old-run', action_id: record.actions[0].action_id, stage: 'draft', operation_id: 'stable-provider-key', expected_state_version: record.task.state_version,
    snapshot_id: record.task.snapshot.snapshot_id, content_revision: record.task.snapshot.content_revision, fence: 4, status: 'claimed', lease_owner: 'dead-worker', lease_expires_at: time, created_at: time, updated_at: time };
  record.runs = [run]; await seed(store, record);
  let operation = ''; let fence = 0;
  await createWorkspaceRunner(config(store, { now: () => Date.parse(time) + 1000, adapters: fixtureAdapters(context => { operation = context.run.operation_id; fence = context.run.fence; }) })).runNext('owner-1');
  assert.equal(operation, 'stable-provider-key'); assert.equal(fence, 5); assert.equal((await read(store)).runs?.length, 1);
});

test('expired in-flight lease becomes unknown, never resubmits even after restart', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); let now = Date.parse(time); const entered = deferred<void>(); const release = deferred<void>(); let calls = 0;
  const adapters = fixtureAdapters(); const original = adapters.draft;
  adapters.draft = { ...original, async execute(context) { calls++; entered.resolve(); await release.promise; return original.execute(context); } };
  const first = createWorkspaceRunner(config(store, { adapters, now: () => now, leaseMs: 1000, timeoutMs: 900 })).runNext('owner-1'); await entered.promise;
  now += 1001;
  const restarted = createWorkspaceRunner(config(store, { adapters, now: () => now, leaseMs: 1000, timeoutMs: 900 }));
  assert.equal((await restarted.runNext('owner-1')).status, 'unknown');
  release.resolve(); assert.equal((await first).status, 'discarded'); await restarted.drainOwner('owner-1');
  const record = await read(store); assert.equal(calls, 1); assert.equal(record.task.stage, 'unknown'); assert.equal(record.runs?.[0].status, 'unknown'); assert.equal(record.receipts?.length ?? 0, 0);
});

test('timeout or thrown provider error remains unknown and is never automatically retried', async () => {
  for (const throws of [false, true]) {
    const store = new MemoryWorkspaceStore(); await seed(store); let calls = 0; const adapters = fixtureAdapters();
    adapters.draft.execute = async () => { calls++; if (throws) throw new Error('Provider connection reset, secret must not leak'); return new Promise(() => undefined); };
    const runner = createWorkspaceRunner(config(store, { adapters, timeoutMs: 10, leaseMs: 1000 }));
    assert.equal((await runner.runNext('owner-1')).status, 'unknown'); await runner.drainOwner('owner-1');
    const record = await read(store); assert.equal(calls, 1); assert.equal(record.task.stage, 'unknown'); assert.ok(!JSON.stringify(record.events).includes('secret'));
  }
});

test('late success after timeout cannot attach artifacts, receipts or advance task', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); const release = deferred<void>(); const adapters = fixtureAdapters();
  const original = adapters.draft; adapters.draft = { ...original, async execute(context) { await release.promise; return original.execute(context); } };
  const runner = createWorkspaceRunner(config(store, { adapters, timeoutMs: 10, leaseMs: 1000 }));
  assert.equal((await runner.runNext('owner-1')).status, 'unknown'); release.resolve(); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal((await read(store)).task.stage, 'unknown'); assert.equal((await read(store)).receipts?.length ?? 0, 0);
});

test('known failed-before-submit stops truthfully without retries', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); let calls = 0; const adapters = fixtureAdapters();
  adapters.draft.execute = async () => { calls++; return { outcome: 'failed_before_submit', code: 'BUDGET_UNAVAILABLE' }; };
  const runner = createWorkspaceRunner(config(store, { adapters })); await runner.drainOwner('owner-1'); await runner.drainOwner('owner-1');
  assert.equal(calls, 1); const record = await read(store); assert.equal(record.task.stage, 'failed'); assert.equal(record.actions[0].status, 'failed_before_submit');
});

test('cancel before execution submits no provider operation', async () => {
  const store = new MemoryWorkspaceStore(); const record = draft(); newAction(record, 'cancel'); await seed(store, record); let calls = 0;
  const runner = createWorkspaceRunner(config(store, { adapters: fixtureAdapters(() => { calls++; }) }));
  assert.equal((await runner.runNext('owner-1')).status, 'cancelled'); assert.equal(calls, 0); assert.equal((await read(store)).task.stage, 'cancelled');
});

test('cancel during in-flight waits for known result then discards it without next-stage invocation', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); const entered = deferred<void>(); const release = deferred<void>(); let calls = 0;
  const adapters = fixtureAdapters(); const original = adapters.draft;
  adapters.draft = { ...original, async execute(context) { calls++; entered.resolve(); await release.promise; return original.execute(context); } };
  const runner = createWorkspaceRunner(config(store, { adapters })); const running = runner.runNext('owner-1'); await entered.promise;
  await store.transaction('owner-1', state => { newAction(state.tasks[0], 'cancel'); });
  assert.equal((await runner.runNext('owner-1')).status, 'busy'); release.resolve(); assert.equal((await running).status, 'cancelled'); await runner.drainOwner('owner-1');
  const record = await read(store); assert.equal(calls, 1); assert.equal(record.task.stage, 'cancelled'); assert.equal(record.receipts?.length ?? 0, 0); assert.equal(record.runs?.[0].status, 'discarded');
});

test('cancel cannot conceal unknown provider outcome', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); const entered = deferred<void>(); const adapters = fixtureAdapters();
  adapters.draft.execute = async () => { entered.resolve(); return new Promise(() => undefined); };
  const runner = createWorkspaceRunner(config(store, { adapters, timeoutMs: 20, leaseMs: 1000 })); const running = runner.runNext('owner-1'); await entered.promise;
  await store.transaction('owner-1', state => { newAction(state.tasks[0], 'cancel'); });
  assert.equal((await running).status, 'unknown'); const record = await read(store); assert.equal(record.task.stage, 'unknown'); assert.equal(record.actions.at(-1)?.status, 'unknown');
});

test('current state CAS rejects stale result with no attached receipt', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); const entered = deferred<void>(); const release = deferred<void>(); const adapters = fixtureAdapters(); const original = adapters.draft;
  adapters.draft = { ...original, async execute(context) { entered.resolve(); await release.promise; return original.execute(context); } };
  const running = createWorkspaceRunner(config(store, { adapters })).runNext('owner-1'); await entered.promise;
  await store.transaction('owner-1', state => { const record = state.tasks[0]; record.task = { ...record.task, state_version: record.task.state_version + 1 }; });
  release.resolve(); assert.equal((await running).status, 'discarded'); const record = await read(store); assert.equal(record.receipts?.length ?? 0, 0); assert.equal(record.task.stage, 'blocked');
});

test('naked model pass, missing independent visual gate and wrong receipt are rejected', async () => {
  for (const mode of ['naked', 'missing-check', 'wrong-scope'] as const) {
    const store = new MemoryWorkspaceStore(); await seed(store); const adapters = fixtureAdapters();
    if (mode === 'naked') adapters.draft.execute = async () => ({ outcome: 'completed', output: { passed: true } } as never);
    if (mode === 'missing-check') adapters.draft.verifyEvidence = async (context, output) => ({ verified: true, task_id: context.record.task.task_id, snapshot_id: context.record.task.snapshot.snapshot_id, state_version: context.record.task.state_version, receipt_id: output.receipt.receipt_id, evidence_refs: output.evidence_refs, checks: [] });
    if (mode === 'wrong-scope') adapters.draft.execute = async context => { const output = fixtureOutput(context); output.receipt = { ...output.receipt, task_id: 'wrong-task' }; return { outcome: 'completed', output }; };
    await createWorkspaceRunner(config(store, { adapters })).runNext('owner-1'); const record = await read(store); assert.equal(record.task.stage, 'blocked'); assert.equal(record.receipts?.length ?? 0, 0);
  }
});

test('approval cannot be inferred from model output or changed action snapshot', async () => {
  const store = new MemoryWorkspaceStore(); await toContentReview(store);
  await store.transaction('owner-1', state => { newAction(state.tasks[0], 'approve_content', { approval_source: 'model', snapshot_id: state.tasks[0].task.snapshot.snapshot_id, content_digest: state.tasks[0].task.snapshot.content_digest }); });
  await createWorkspaceRunner(config(store)).drainOwner('owner-1'); const record = await read(store); assert.equal(record.task.stage, 'blocked'); assert.equal(record.task.approval, undefined);
});

test('owner isolation and authenticated intent actor are enforced', async () => {
  const store = new MemoryWorkspaceStore(); const record = draft(); record.actions[0].actor_id = 'another-owner'; await seed(store, record);
  const runner = createWorkspaceRunner(config(store)); assert.equal((await runner.runNext('another-owner')).status, 'idle');
  assert.equal((await runner.runNext('owner-1')).status, 'blocked'); assert.equal((await read(store)).runs?.length ?? 0, 0);
});

async function queueTextFeedback(store: WorkspaceStore) {
  await store.transaction('owner-1', state => { const record = state.tasks[0]; newAction(record, 'content_feedback', { task_id: record.task.task_id, content_revision: record.task.snapshot.content_revision,
    groups: [{ instruction: 'Improve title only', text_slots: [{ slot: 'hero_title', text_hash: sha(record.content!.slots.hero_title) }] }] }); });
}
async function queueAssetFeedback(store: WorkspaceStore, mixed = false) {
  await store.transaction('owner-1', state => { const record = state.tasks[0]; const selected = record.task.snapshot.assets[0]; const file = record.artifacts.find(item => item.revision_id === selected.revision_id)!;
    newAction(record, 'feedback', { task_id: record.task.task_id, content_revision: record.task.snapshot.content_revision, index_id: record.review_manifest!.index_id, render_hash: record.review_manifest!.render_hash,
      groups: [{ instruction: 'Improve selected composition only', text_slots: mixed ? [{ slot: 'hero_title', text_hash: sha(record.content!.slots.hero_title) }] : [], assets: [{ canonical_slot: selected.canonical_slot, artifact_revision: selected.revision_id, sha256: file.sha256 }] }] }); });
}

test('text feedback changes exact selected slots and pauses for fresh content approval', async () => {
  const store = new MemoryWorkspaceStore(); await toCompleted(store); const before = await read(store); await queueTextFeedback(store);
  await createWorkspaceRunner(config(store)).drainOwner('owner-1'); const after = await read(store);
  assert.equal(after.task.stage, 'content_review'); assert.equal(after.task.approval, undefined);
  assert.notEqual(after.content!.slots.hero_title, before.content!.slots.hero_title); assert.equal(after.content!.slots.support, before.content!.slots.support);
  assert.deepEqual(after.artifacts, before.artifacts, 'old immutable bytes retained'); assert.equal(after.task.snapshot.assets.length, 0, 'old content approvals/asset bindings not reused as current');
});

test('text feedback cannot silently alter unselected slots', async () => {
  const store = new MemoryWorkspaceStore(); await toContentReview(store); const before = await read(store); await queueTextFeedback(store); const adapters = fixtureAdapters();
  adapters.content_feedback.execute = async context => { const output = fixtureOutput(context); output.content!.slots.support = 'Unexpected change'; output.receipt = { ...output.receipt, snapshot: { ...output.receipt.snapshot!, content_digest: workspaceContentDigest(output.content!.slots) } }; return { outcome: 'completed', output }; };
  await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1'); const after = await read(store); assert.equal(after.task.stage, 'blocked'); assert.deepEqual(after.content, before.content);
});

test('asset feedback reopens completed task, preserves all unselected bytes, then reruns review/package', async () => {
  const store = new MemoryWorkspaceStore(); await toCompleted(store); const before = await read(store); await queueAssetFeedback(store); const called: string[] = [];
  const runner = createWorkspaceRunner(config(store, { adapters: fixtureAdapters(context => { called.push(context.run.stage); }) }));
  await runner.drainOwner('owner-1'); assert.deepEqual(called, ['asset_feedback']); assert.equal((await read(store)).task.stage, 'review');
  await approveArtwork(store); await runner.drainOwner('owner-1'); const after = await read(store);
  assert.deepEqual(called, ['asset_feedback', 'review', 'packaging']); assert.equal(after.task.stage, 'completed');
  assert.notEqual(after.task.snapshot.assets[0].revision_id, before.task.snapshot.assets[0].revision_id); assert.deepEqual(after.task.snapshot.assets[1], before.task.snapshot.assets[1]);
  for (const old of before.artifacts) assert.deepEqual(after.artifacts.find(item => item.artifact_id === old.artifact_id), old);
  assert.equal(after.artifacts.filter(item => item.kind === 'package').length, 2); assert.deepEqual(after.content, before.content);
});

test('missing revision adapter blocks, never fabricates an edit', async () => {
  for (const mixed of [false]) {
    const store = new MemoryWorkspaceStore(); await toCompleted(store); const before = await read(store); await queueAssetFeedback(store, mixed);
    const adapters = fixtureAdapters(); if (!mixed) Reflect.deleteProperty(adapters, 'asset_feedback');
    await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1'); const after = await read(store);
    assert.equal(after.actions.at(-1)?.status, 'blocked'); assert.deepEqual(after.task.snapshot, before.task.snapshot); assert.deepEqual(after.artifacts, before.artifacts);
  }
});

test('external adapters execute outside every synchronous owner transaction', async () => {
  const base = new MemoryWorkspaceStore(); let transactionActive = false;
  const store: WorkspaceStore = { kind: 'test-wrapper', productionReady: false, read: base.read.bind(base), transaction(owner, mutate) { return base.transaction(owner, state => { transactionActive = true; try { return mutate(state); } finally { transactionActive = false; } }); } };
  await seed(store); const adapters = fixtureAdapters(() => { assert.equal(transactionActive, false); });
  await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1'); assert.equal((await read(store)).task.stage, 'content_review');
});


test('initial content does not need a fake asset preview; structured text review remains possible', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); const adapters = fixtureAdapters();
  adapters.content_authoring.execute = async context => { const output = fixtureOutput(context); delete output.preview; return { outcome: 'completed', output }; };
  await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1');
  const record = await read(store); assert.equal(record.task.stage, 'content_review'); assert.ok(record.content); assert.equal(record.preview, null); assert.equal(record.review_manifest, null);
  await queueTextFeedback(store); await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1'); assert.equal((await read(store)).task.stage, 'content_review');
});

test('asset adapter can retain only trusted manifest for on-demand private rendering', async () => {
  const store = new MemoryWorkspaceStore(); await toContentReview(store); await approve(store); const adapters = fixtureAdapters();
  adapters.assets.execute = async context => { const output = fixtureOutput(context); output.review_manifest = output.preview!.manifest; delete output.preview; return { outcome: 'completed', output }; };
  await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1');
  const record = await read(store); assert.equal(record.task.stage, 'review'); assert.equal(record.preview, null); assert.ok(record.review_manifest);
});

test('artwork approval must match every current pixel hash and the reviewed render', async () => {
  for (const tamper of ['render', 'asset'] as const) {
    const store = new MemoryWorkspaceStore(); await toContentReview(store); await approve(store); await createWorkspaceRunner(config(store)).drainOwner('owner-1'); await approveArtwork(store);
    await store.transaction('owner-1', state => { const payload = state.tasks[0].actions.at(-1)!.payload as { render_hash: string; assets: Array<{ sha256: string }> }; if (tamper === 'render') payload.render_hash = sha('stale'); else payload.assets[0].sha256 = sha('wrong-pixels'); });
    let calls = 0; await createWorkspaceRunner(config(store, { adapters: fixtureAdapters(() => { calls++; }) })).drainOwner('owner-1');
    assert.equal(calls, 0); assert.equal((await read(store)).task.stage, 'blocked'); assert.equal((await read(store)).artifacts.some(item => item.kind === 'package'), false);
  }
});

test('user artwork acceptance does not substitute independent semantic/pixel/technical QA', async () => {
  const store = new MemoryWorkspaceStore(); await toContentReview(store); await approve(store); await createWorkspaceRunner(config(store)).drainOwner('owner-1'); await approveArtwork(store);
  const adapters = fixtureAdapters(); adapters.review.verifyEvidence = async (context, output) => ({ verified: true, task_id: context.record.task.task_id, snapshot_id: context.record.task.snapshot.snapshot_id, state_version: context.record.task.state_version, receipt_id: output.receipt.receipt_id, evidence_refs: output.evidence_refs, checks: ['human_artistic_review'] });
  await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1'); const record = await read(store);
  assert.equal(record.task.stage, 'blocked'); assert.equal(record.artifacts.some(item => item.kind === 'package'), false);
});

test('artwork output cannot mark human review passed before authenticated acceptance', async () => {
  const store = new MemoryWorkspaceStore(); await toContentReview(store); await approve(store); const adapters = fixtureAdapters();
  adapters.assets.execute = async context => { const output = fixtureOutput(context); output.quality = [{ name: 'human_artistic_review', status: 'passed', detail: 'Model claims it passed' }]; return { outcome: 'completed', output }; };
  await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1'); assert.equal((await read(store)).task.stage, 'blocked');
});

test('revisions clear stale quality labels from older immutable snapshots', async () => {
  const store = new MemoryWorkspaceStore(); await toCompleted(store);
  await store.transaction('owner-1', state => { state.tasks[0].quality = [{ name: 'human_artistic_review', status: 'passed', detail: 'Prior snapshot only' }]; });
  await queueAssetFeedback(store); await createWorkspaceRunner(config(store)).drainOwner('owner-1'); const record = await read(store);
  assert.equal(record.task.stage, 'review'); assert.deepEqual(record.quality, []);
});

test('asset revision cannot change any unselected revision or immutable artifact', async () => {
  for (const tamper of ['unselected', 'immutable'] as const) {
    const store = new MemoryWorkspaceStore(); await toCompleted(store); const before = await read(store); await queueAssetFeedback(store); const adapters = fixtureAdapters();
    adapters.asset_feedback.execute = async context => {
      const output = fixtureOutput(context);
      if (tamper === 'unselected') output.receipt = { ...output.receipt, snapshot: { ...output.receipt.snapshot!, assets: output.receipt.snapshot!.assets.map((asset, i) => i === 1 ? { ...asset, label: 'Changed outside scope' } : asset) } };
      else output.artifacts!.push({ ...context.record.artifacts[0], sha256: sha('altered old bytes') });
      return { outcome: 'completed', output };
    };
    await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1'); const after = await read(store);
    assert.equal(after.task.stage, 'blocked'); assert.deepEqual(after.task.snapshot, before.task.snapshot); assert.deepEqual(after.artifacts, before.artifacts);
  }
});

test('expired stale pre-submit claim cannot execute a later unapproved state', async () => {
  const store = new MemoryWorkspaceStore(); const record = draft(); record.actions[0].status = 'running';
  record.runs = [{ run_id: 'old', action_id: record.actions[0].action_id, stage: 'draft', operation_id: 'old-op', expected_state_version: record.task.state_version - 1, snapshot_id: record.task.snapshot.snapshot_id, content_revision: record.task.snapshot.content_revision, fence: 1, status: 'claimed', lease_owner: 'dead', lease_expires_at: time, created_at: time, updated_at: time }];
  await seed(store, record); let calls = 0;
  const response = await createWorkspaceRunner(config(store, { now: () => Date.parse(time) + 1000, adapters: fixtureAdapters(() => { calls++; }) })).runNext('owner-1');
  assert.equal(response.status, 'discarded'); assert.equal(calls, 0); assert.equal((await read(store)).task.stage, 'blocked');
});


test('membership revocation between stages stops future shared-provider work', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); let active = true; let calls = 0;
  const runner = createWorkspaceRunner(config(store, { authorizeOwner: async () => active, adapters: fixtureAdapters(() => { calls++; }) }));
  assert.equal((await runner.runNext('owner-1')).status, 'advanced'); active = false;
  assert.equal((await runner.runNext('owner-1')).status, 'blocked'); assert.equal(calls, 1); assert.equal((await read(store)).task.stage, 'blocked');
});

test('membership check never runs within the owner transaction and errors fail closed', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); let calls = 0;
  const runner = createWorkspaceRunner(config(store, { authorizeOwner: async () => { throw new Error('membership unavailable'); }, adapters: fixtureAdapters(() => { calls++; }) }));
  assert.equal((await runner.runNext('owner-1')).status, 'blocked'); assert.equal(calls, 0);
});


test('revocation after durable claim but before external submit blocks provider call', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); let authorizations = 0; let submissions = 0;
  const runner = createWorkspaceRunner(config(store, { authorizeOwner: async () => ++authorizations === 1, adapters: fixtureAdapters(() => { submissions++; }) }));
  await runner.runNext('owner-1'); const record = await read(store);
  assert.equal(submissions, 0); assert.equal(record.task.stage, 'blocked'); assert.equal(record.runs?.[0].status, 'blocked');
});

async function toApprovedArtwork(store: WorkspaceStore) {
  await toContentReview(store); await approve(store);
  await createWorkspaceRunner(config(store)).drainOwner('owner-1');
  assert.equal((await read(store)).task.stage, 'review'); await approveArtwork(store);
}
function changedApprovedOutput(context: WorkspaceStageContext, mode: string): WorkspaceStageOutput {
  const output = fixtureOutput(context);
  if (mode.startsWith('preview-')) {
    if (mode === 'preview-null') output.preview = null;
    else {
      output.preview = structuredClone(context.record.preview!);
      if (mode === 'preview-html') output.preview.html += '<div>Unapproved layout</div>';
      if (mode === 'preview-css') output.preview.canonical.css += '.changed{display:none}';
      if (mode === 'preview-canonical') output.preview.canonical.html += '<div>Unapproved template</div>';
      if (mode === 'preview-nonce') output.preview.channel_nonce += ':new';
    }
    return output;
  }
  if (mode === 'manifest-null') { output.review_manifest = null; return output; }
  const { index_id: _index, ...manifest } = structuredClone(context.record.review_manifest!);
  if (mode === 'render') manifest.render_hash = sha('unapproved-render');
  if (mode === 'template') manifest.template_version = 'unapproved-template';
  if (mode === 'canonical') manifest.canonical_hash = sha('unapproved-canonical');
  if (mode === 'omit-text') manifest.elements = manifest.elements.filter(element => element.id !== 'text:hero_title');
  if (mode === 'omit-image') manifest.elements = manifest.elements.filter(element => element.id !== 'asset:0');
  if (mode === 'swap-text') {
    const texts = manifest.elements.filter(element => element.kind === 'text');
    const firstId = texts[0].id; texts[0].id = texts[1].id; texts[1].id = firstId;
  }
  if (mode === 'swap-image') {
    const images = manifest.elements.filter(element => element.kind === 'image');
    const firstId = images[0].id; images[0].id = images[1].id; images[1].id = firstId;
  }
  output.review_manifest = buildWorkspaceReviewManifest(manifest);
  return output;
}

test('review and packaging reject any replacement of authenticated render/template/canonical/slots/preview', async () => {
  const modes = ['render', 'template', 'canonical', 'omit-text', 'omit-image', 'swap-text', 'swap-image', 'manifest-null', 'preview-html', 'preview-css', 'preview-canonical', 'preview-nonce', 'preview-null'];
  for (const stage of ['review', 'packaging'] as const) for (const mode of modes) {
    const store = new MemoryWorkspaceStore(); await toApprovedArtwork(store);
    if (stage === 'packaging') assert.equal((await createWorkspaceRunner(config(store)).runNext('owner-1')).status, 'advanced');
    const before = await read(store); const adapters = fixtureAdapters();
    adapters[stage].execute = async context => ({ outcome: 'completed', output: changedApprovedOutput(context, mode) });
    const result = await createWorkspaceRunner(config(store, { adapters })).runNext('owner-1'); const after = await read(store);
    assert.equal(result.status, 'blocked', `${stage}/${mode}`); assert.equal(after.task.stage, 'blocked');
    assert.deepEqual(after.review_manifest, before.review_manifest, `${stage}/${mode}: manifest preserved`);
    assert.deepEqual(after.preview, before.preview, `${stage}/${mode}: preview preserved`);
    assert.deepEqual(after.content, before.content); assert.deepEqual(after.artifacts, before.artifacts);
    assert.equal(after.artifacts.some(item => item.kind === 'package'), false);
  }
});

test('identical review/package content and manifest cannot implicitly clear approved preview', async () => {
  const store = new MemoryWorkspaceStore(); await toApprovedArtwork(store); const before = await read(store); const adapters = fixtureAdapters();
  adapters.review.execute = async context => ({ outcome: 'completed', output: { ...fixtureOutput(context), content: structuredClone(context.record.content), review_manifest: structuredClone(context.record.review_manifest) } });
  adapters.packaging.execute = async context => ({ outcome: 'completed', output: { ...fixtureOutput(context), content: structuredClone(context.record.content), review_manifest: structuredClone(context.record.review_manifest), preview: structuredClone(context.record.preview) } });
  await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1'); const after = await read(store);
  assert.equal(after.task.stage, 'completed'); assert.deepEqual(after.preview, before.preview); assert.deepEqual(after.review_manifest, before.review_manifest); assert.deepEqual(after.content, before.content);
  const reviewed = after.runs!.find(run => run.stage === 'review')!; const packaged = after.runs!.find(run => run.stage === 'packaging')!;
  assert.match(reviewed.approved_artwork_identity!, /^[a-f0-9]{64}$/); assert.equal(packaged.approved_artwork_identity, reviewed.approved_artwork_identity);
});

test('restart rechecks persisted artwork identity before packaging, even when CAS version was not changed', async () => {
  for (const mode of ['render', 'preview-html'] as const) {
    const directory = await mkdtemp(path.join(tmpdir(), 'uid-approved-artwork-'));
    try {
      const store = new FileWorkspaceStore(directory, { environment: 'test' }); await toApprovedArtwork(store);
      assert.equal((await createWorkspaceRunner(config(store)).runNext('owner-1')).status, 'advanced');
      assert.equal((await read(store)).task.stage, 'packaging');
      await store.transaction('owner-1', state => {
        const record = state.tasks[0];
        if (mode === 'preview-html') record.preview!.html += '<div>Changed after review</div>';
        else { const { index_id: _index, ...body } = record.review_manifest!; record.review_manifest = buildWorkspaceReviewManifest({ ...body, render_hash: sha('changed-after-review') }); }
      });
      const restartedStore = new FileWorkspaceStore(directory, { environment: 'test' }); let calls = 0;
      const result = await createWorkspaceRunner(config(restartedStore, { adapters: fixtureAdapters(() => { calls++; }) })).runNext('owner-1');
      assert.equal(result.status, 'blocked'); assert.equal(calls, 0); assert.equal((await read(restartedStore)).artifacts.some(item => item.kind === 'package'), false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('approved render is rechecked immediately before submission, after claim authorization awaits', async () => {
  for (const stage of ['review', 'packaging'] as const) {
    const store = new MemoryWorkspaceStore(); await toApprovedArtwork(store);
    if (stage === 'packaging') await createWorkspaceRunner(config(store)).runNext('owner-1');
    let checks = 0; let calls = 0;
    const runner = createWorkspaceRunner(config(store, { authorizeOwner: async () => {
      if (++checks === 2) await store.transaction('owner-1', state => { state.tasks[0].preview!.canonical.css += '.unapproved{color:red}'; });
      return true;
    }, adapters: fixtureAdapters(() => { calls++; }) }));
    await runner.runNext('owner-1'); const after = await read(store);
    assert.equal(calls, 0); assert.equal(after.task.stage, 'blocked'); assert.equal(after.runs!.at(-1)!.reason, 'APPROVED_ARTWORK_CHANGED');
  }
});

test('review/package commit rechecks prospective output against the CURRENT approved render', async () => {
  for (const stage of ['review', 'packaging'] as const) {
    const store = new MemoryWorkspaceStore(); await toApprovedArtwork(store);
    if (stage === 'packaging') await createWorkspaceRunner(config(store)).runNext('owner-1');
    const entered = deferred<void>(); const release = deferred<void>(); const adapters = fixtureAdapters(); const original = adapters[stage];
    adapters[stage] = { ...original, async execute(context) { entered.resolve(); await release.promise; return original.execute(context); } };
    const running = createWorkspaceRunner(config(store, { adapters })).runNext('owner-1'); await entered.promise;
    await store.transaction('owner-1', state => { state.tasks[0].preview!.html += '<div>Concurrent change without CAS</div>'; });
    release.resolve(); const result = await running; const after = await read(store);
    assert.equal(result.status, 'blocked'); assert.equal(after.task.stage, 'blocked'); assert.equal(after.runs!.at(-1)!.reason, 'APPROVED_ARTWORK_CHANGED');
    assert.equal(after.artifacts.some(item => item.kind === 'package'), false);
  }
});

// Coordinated revisions use only test adapters. No regeneration provider is used
// for unchanged assets and none of these fixtures is production quality evidence.
test('mixed text and image groups survive content approval, reuse exact bytes, then edit only selected images', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'uid-mixed-'));
  try {
    const store = new FileWorkspaceStore(directory, { environment: 'test' }); await toCompleted(store); const before = await read(store);
    await queueAssetFeedback(store, true);
    await store.transaction('owner-1', state => {
      const payload = state.tasks[0].actions.at(-1)!.payload as { groups: Array<{ instruction: string; text_slots: Array<{ slot: string; text_hash: string }>; assets?: unknown[] }> };
      // Separate instruction groups must not get merged or silently retargeted.
      payload.groups.push({ instruction: 'Revise support detail, independently', text_slots: [{ slot: 'support', text_hash: sha(before.content!.slots.support) }], assets: [] });
    });
    const originalIntent = (await read(store)).actions.at(-1)!.payload;
    const called: string[] = []; const seen: WorkspaceStageContext[] = [];
    const adapters = fixtureAdapters(context => { called.push(context.run.stage); seen.push(structuredClone({ ...context, signal: undefined, bindProviderOperation: undefined }) as unknown as WorkspaceStageContext); });
    await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1');
    let revised = await read(store); assert.equal(revised.task.stage, 'content_review'); assert.equal(revised.revision_plan?.phase, 'awaiting_content_approval');
    assert.deepEqual(called, ['content_feedback']); assert.equal(revised.task.approval, undefined);
    assert.deepEqual(revised.revision_history![0].snapshot, before.task.snapshot); assert.deepEqual(revised.revision_history![0].content, before.content);
    assert.deepEqual(revised.revision_history![0].preview, before.preview);
    // Restart while awaiting an actual approval retains the entire plan.
    const restarted = new FileWorkspaceStore(directory, { environment: 'test' }); await createWorkspaceRunner(config(restarted, { adapters })).drainOwner('owner-1');
    assert.deepEqual(called, ['content_feedback']); await approve(restarted);
    await createWorkspaceRunner(config(restarted, { adapters })).drainOwner('owner-1'); revised = await read(restarted);
    assert.deepEqual(called, ['content_feedback', 'assets_reuse', 'asset_feedback']); assert.equal(revised.task.stage, 'review'); assert.equal(revised.revision_plan?.phase, 'review_ready');
    assert.deepEqual(seen.at(-1)!.feedback, originalIntent); assert.deepEqual(revised.revision_plan?.intent, originalIntent);
    assert.equal(revised.task.snapshot.assets[1].revision_id, before.task.snapshot.assets[1].revision_id);
    const unchanged = revised.artifacts.find(file => file.content_revision === revised.task.snapshot.content_revision && file.revision_id === before.task.snapshot.assets[1].revision_id)!;
    const old = before.artifacts.find(file => file.revision_id === unchanged.revision_id)!;
    assert.equal(unchanged.sha256, old.sha256); assert.equal(unchanged.storage_key, old.storage_key);
    assert.notEqual(revised.task.snapshot.assets[0].revision_id, before.task.snapshot.assets[0].revision_id);
    assert.notEqual(revised.review_manifest!.index_id, before.review_manifest!.index_id); assert.deepEqual(revised.quality, []);
    await approveArtwork(restarted); await createWorkspaceRunner(config(restarted, { adapters })).drainOwner('owner-1');
    assert.equal((await read(restarted)).task.stage, 'completed'); assert.deepEqual(called, ['content_feedback', 'assets_reuse', 'asset_feedback', 'review', 'packaging']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('text-only artwork feedback reuses all prior images without executing image generation', async () => {
  const store = new MemoryWorkspaceStore(); await toCompleted(store); const before = await read(store); await queueTextFeedback(store);
  const called: string[] = []; const adapters = fixtureAdapters(context => { called.push(context.run.stage); }); const runner = createWorkspaceRunner(config(store, { adapters }));
  await runner.drainOwner('owner-1'); await approve(store); await runner.drainOwner('owner-1'); const after = await read(store);
  assert.deepEqual(called, ['content_feedback', 'assets_reuse']); assert.equal(after.task.stage, 'review');
  assert.deepEqual(after.task.snapshot.assets.map(item => item.revision_id), before.task.snapshot.assets.map(item => item.revision_id));
});

test('reuse refuses changed bytes, scope expansion, old content bindings or missing compatibility evidence', async () => {
  for (const mode of ['bytes', 'storage', 'revision', 'binding', 'evidence', 'missing-adapter'] as const) {
    const store = new MemoryWorkspaceStore(); await toCompleted(store); await queueAssetFeedback(store, true); await createWorkspaceRunner(config(store)).drainOwner('owner-1'); await approve(store);
    const adapters = fixtureAdapters(); const before = await read(store);
    if (mode === 'missing-adapter') Reflect.deleteProperty(adapters, 'assets_reuse');
    else {
      adapters.assets_reuse.execute = async context => {
        const output = fixtureOutput(context);
        if (mode === 'bytes') output.artifacts![0].sha256 = sha('changed');
        if (mode === 'storage') output.artifacts![0].storage_key = 'different-object';
        if (mode === 'revision') output.receipt = { ...output.receipt, snapshot: { ...output.receipt.snapshot!, assets: output.receipt.snapshot!.assets.slice(1) } };
        if (mode === 'binding') output.artifacts![0].content_revision = 'old-scope';
        return { outcome: 'completed', output };
      };
      if (mode === 'evidence') adapters.assets_reuse.verifyEvidence = async (context, output) => ({ verified: true, task_id: context.record.task.task_id, snapshot_id: context.record.task.snapshot.snapshot_id, state_version: context.record.task.state_version, receipt_id: output.receipt.receipt_id, evidence_refs: output.evidence_refs, checks: checks.filter(check => check !== 'content_asset_compatibility') });
    }
    await createWorkspaceRunner(config(store, { adapters })).drainOwner('owner-1'); const after = await read(store);
    assert.equal(after.task.stage, 'blocked', mode); assert.deepEqual(after.artifacts, before.artifacts); assert.equal(after.revision_plan?.phase, 'reusing_assets');
  }
});

test('another feedback request during a coordinated content approval reports conflict without replacing plan', async () => {
  const store = new MemoryWorkspaceStore(); await toCompleted(store); await queueAssetFeedback(store, true); await createWorkspaceRunner(config(store)).drainOwner('owner-1'); const before = await read(store);
  await queueTextFeedback(store); await createWorkspaceRunner(config(store)).drainOwner('owner-1'); const after = await read(store);
  assert.equal(after.task.stage, 'blocked'); assert.equal(after.task.interruption?.reason, 'REVISION_PLAN_IN_PROGRESS'); assert.deepEqual(after.revision_plan, before.revision_plan); assert.deepEqual(after.content, before.content);
});

import type { TrustedWorkspaceReconciler, WorkspaceRecoveryContext, WorkspaceRecoveryOutcome, WorkspaceRecoveryProof } from '../uid-workspace-recovery.ts';
const binding = { reservation_id: 'reservation-fixture', request_sha256: sha('provider-request-fixture'), provider: 'test-only' };
function recoveryProof(context: WorkspaceRecoveryContext, accounting: WorkspaceRecoveryProof['accounting'] = 'settled'): WorkspaceRecoveryProof {
  return { owner_id: context.original.owner_id, task_id: context.original.record.task.task_id, run_id: context.original.run.run_id, operation_id: context.original.run.operation_id,
    operation_fenced: true, input_identity: context.input_identity, provider_binding: context.provider_binding, evidence_refs: ['test-ledger-proof'], accounting_evidence_ref: 'test-ledger-proof', accounting };
}
function fixtureReconciler(kind: 'completed' | 'no_side_effect' = 'completed', onCall?: (context: WorkspaceRecoveryContext) => void): TrustedWorkspaceReconciler {
  return { async reconcile(context) { onCall?.(context); return kind === 'completed' ? { outcome: 'completed', proof: recoveryProof(context), output: fixtureOutput(context.original) }
    : { outcome: 'no_side_effect', proof: recoveryProof(context, context.provider_binding ? 'released' : 'not_reserved') }; }, async verifyEvidence() { return true; } };
}
async function toUnknown(store: WorkspaceStore, stage: WorkspaceRunnerStage = 'draft') {
  if (stage === 'draft') await seed(store);
  const adapters = fixtureAdapters(); adapters[stage].execute = async context => { await context.bindProviderOperation!(binding); return { outcome: 'unknown', code: 'TEST_PROVIDER_TIMEOUT' }; };
  await createWorkspaceRunner(config(store, { adapters })).runNext('owner-1'); const record = await read(store); assert.equal(record.task.stage, 'unknown');
  return { record, run: record.runs!.at(-1)!, request: { expected_state_version: record.task.state_version, idempotency_key: 'recovery:' + ++sequence } };
}

test('trusted completion reconciles original output and accounting once, never repeats paid execution', async () => {
  const store = new MemoryWorkspaceStore(); const { run, request } = await toUnknown(store); let executeCalls = 0; let reconciliationCalls = 0;
  const runner = createWorkspaceRunner(config(store, { adapters: fixtureAdapters(() => { executeCalls++; }), reconcilers: { draft: fixtureReconciler('completed', () => { reconciliationCalls++; }) } }));
  const result = await runner.reconcile('owner-1', 'task-1', run.run_id, request); assert.equal(result.status, 'advanced');
  let record = await read(store); assert.equal(record.task.stage, 'research'); assert.equal(record.runs![0].status, 'succeeded'); assert.equal(executeCalls, 0); assert.equal(reconciliationCalls, 1);
  assert.equal(record.receipts!.filter(receipt => receipt.kind === 'reconciled').length, 1); assert.equal(record.receipts!.filter(receipt => receipt.kind === 'brief_accepted').length, 1);
  assert.equal((await runner.reconcile('owner-1', 'task-1', run.run_id, request)).duplicate, true); assert.equal(reconciliationCalls, 1);
  assert.equal((await runner.reconcile('owner-1', 'task-1', run.run_id, { ...request, expected_state_version: request.expected_state_version + 1 })).code, 'IDEMPOTENCY_CONFLICT');
  record = await read(store); assert.equal(record.runs![0].recovery_requests?.length, 1);
});

test('trusted no-side-effect proof permits only a new operation and new budget binding', async () => {
  const store = new MemoryWorkspaceStore(); const { run, request } = await toUnknown(store); let executedOperation = '';
  const runner = createWorkspaceRunner(config(store, { adapters: fixtureAdapters(context => { executedOperation = context.run.operation_id; }), reconcilers: { draft: fixtureReconciler('no_side_effect') } }));
  assert.equal((await runner.reconcile('owner-1', 'task-1', run.run_id, request)).code, 'SAFE_NEW_ATTEMPT_READY'); assert.equal(executedOperation, '');
  await runner.runNext('owner-1'); assert.ok(executedOperation); assert.notEqual(executedOperation, run.operation_id); const record = await read(store);
  assert.equal(record.runs![0].status, 'failed_before_submit'); assert.equal(record.runs![1].status, 'succeeded'); assert.equal(record.runs![1].provider_binding, undefined);
});

test('unknown proof, wrong operation/reservation/input/accounting, or false verifier never unlocks retry', async () => {
  for (const mode of ['unknown', 'operation', 'reservation', 'input', 'owner', 'accounting', 'missing-ref', 'false-verifier', 'stage-evidence', 'stage-scope'] as const) {
    const store = new MemoryWorkspaceStore(); const { run, request } = await toUnknown(store); let executions = 0;
    const reconciler = fixtureReconciler(); const original = reconciler.reconcile;
    reconciler.reconcile = async context => {
      if (mode === 'unknown') return { outcome: 'unknown', code: 'PROVIDER_STILL_PENDING' };
      const value = await original(context); if (value.outcome === 'unknown') return value;
      if (mode === 'operation') value.proof.operation_id = 'different-operation';
      if (mode === 'reservation') value.proof.provider_binding = { ...binding, reservation_id: 'wrong' };
      if (mode === 'input') value.proof.input_identity = sha('wrong');
      if (mode === 'owner') value.proof.owner_id = 'another-owner';
      if (mode === 'accounting') value.proof.accounting = 'released';
      if (mode === 'missing-ref') value.proof.evidence_refs = [];
      if (mode === 'stage-scope' && value.outcome === 'completed') value.output.receipt = { ...value.output.receipt, state_version: 1000 };
      return value;
    };
    if (mode === 'false-verifier') reconciler.verifyEvidence = async () => false;
    const adapters = fixtureAdapters(() => { executions++; }); if (mode === 'stage-evidence') adapters.draft.verifyEvidence = async () => null;
    const runner = createWorkspaceRunner(config(store, { adapters, reconcilers: { draft: reconciler } }));
    assert.equal((await runner.reconcile('owner-1', 'task-1', run.run_id, request)).status, 'unknown', mode); await runner.drainOwner('owner-1');
    assert.equal(executions, 0); assert.equal((await read(store)).task.stage, 'unknown'); assert.equal((await read(store)).receipts?.length ?? 0, 0);
  }
});

test('reconciliation is owner and state bound, absent configuration cannot be replaced by browser proof', async () => {
  const store = new MemoryWorkspaceStore(); const { run, request } = await toUnknown(store); let calls = 0;
  const runner = createWorkspaceRunner(config(store, { reconcilers: { draft: fixtureReconciler('completed', () => { calls++; }) } }));
  assert.equal((await runner.reconcile('owner-2', 'task-1', run.run_id, request)).code, 'RECOVERY_RUN_NOT_FOUND');
  assert.equal((await runner.reconcile('owner-1', 'task-1', run.run_id, { ...request, expected_state_version: 999 })).code, 'STALE_RECOVERY_REQUEST');
  assert.equal((await createWorkspaceRunner(config(store)).reconcile('owner-1', 'task-1', run.run_id, { ...request, no_side_effect: true } as typeof request)).code, 'RECONCILER_NOT_CONFIGURED');
  assert.equal(calls, 0); assert.equal((await read(store)).task.stage, 'unknown');
});

test('two reconciliation workers have one durable claim and exactly one output commit', async () => {
  const store = new MemoryWorkspaceStore(); const { run, request } = await toUnknown(store); const entered = deferred<void>(); const release = deferred<void>(); let calls = 0;
  const reconciler = fixtureReconciler(); const original = reconciler.reconcile;
  reconciler.reconcile = async context => { calls++; entered.resolve(); await release.promise; return original(context); };
  const first = createWorkspaceRunner(config(store, { reconcilers: { draft: reconciler }, workerId: 'first' })).reconcile('owner-1', 'task-1', run.run_id, request); await entered.promise;
  const second = await createWorkspaceRunner(config(store, { reconcilers: { draft: reconciler }, workerId: 'second' })).reconcile('owner-1', 'task-1', run.run_id, { ...request, idempotency_key: 'different-request' });
  assert.equal(second.status, 'busy'); assert.equal(calls, 1); release.resolve(); assert.equal((await first).status, 'advanced'); assert.equal((await read(store)).receipts!.length, 2);
});

test('reconciliation timeout and late callback remain unknown without attaching output', async () => {
  const store = new MemoryWorkspaceStore(); const { run, request } = await toUnknown(store); const release = deferred<void>(); const reconciler = fixtureReconciler(); const original = reconciler.reconcile;
  reconciler.reconcile = async context => { await release.promise; return original(context); };
  const runner = createWorkspaceRunner(config(store, { reconcilers: { draft: reconciler }, timeoutMs: 10, leaseMs: 1000 }));
  assert.equal((await runner.reconcile('owner-1', 'task-1', run.run_id, request)).status, 'unknown'); release.resolve(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await read(store)).task.stage, 'unknown'); assert.equal((await read(store)).receipts?.length ?? 0, 0);
});

test('expired reconciliation claim can be reclaimed after crash but old callback is fenced', async () => {
  const store = new MemoryWorkspaceStore(); const { run, request } = await toUnknown(store); let now = Date.parse(time); const entered = deferred<void>(); const release = deferred<void>();
  const reconciler = fixtureReconciler(); const original = reconciler.reconcile; reconciler.reconcile = async context => { entered.resolve(); await release.promise; return original(context); };
  const first = createWorkspaceRunner(config(store, { reconcilers: { draft: reconciler }, workerId: 'crashed', now: () => now, timeoutMs: 900, leaseMs: 1000 })).reconcile('owner-1', 'task-1', run.run_id, request); await entered.promise;
  now += 1001;
  assert.equal((await createWorkspaceRunner(config(store, { reconcilers: { draft: fixtureReconciler() }, workerId: 'restart', now: () => now })).reconcile('owner-1', 'task-1', run.run_id, request)).status, 'advanced');
  release.resolve(); assert.equal((await first).status, 'discarded'); assert.equal((await read(store)).receipts!.length, 2);
});

test('restart persists completed recovery idempotency and never repeats provider query', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'uid-reconcile-'));
  try {
    const store = new FileWorkspaceStore(directory, { environment: 'test' }); const { run, request } = await toUnknown(store);
    await createWorkspaceRunner(config(store, { reconcilers: { draft: fixtureReconciler() } })).reconcile('owner-1', 'task-1', run.run_id, request);
    const restarted = new FileWorkspaceStore(directory, { environment: 'test' }); let calls = 0;
    const result = await createWorkspaceRunner(config(restarted, { reconcilers: { draft: fixtureReconciler('completed', () => { calls++; }) } })).reconcile('owner-1', 'task-1', run.run_id, request);
    assert.equal(result.duplicate, true); assert.equal(calls, 0); assert.equal((await read(restarted)).task.stage, 'research');
    assert.equal((await read(restarted)).runs![0].input, undefined, 'settled recovery retains proof/hash without duplicating private history');
    assert.equal('runs' in run.input!, false); assert.equal('actions' in run.input!, false); assert.equal('revision_history' in run.input!, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recovery rechecks revocation and stale input after the provider response', async () => {
  for (const mode of ['revoked', 'state', 'content'] as const) {
    const store = new MemoryWorkspaceStore(); const { run, request } = await toUnknown(store); let active = true;
    const reconciler = fixtureReconciler(); const original = reconciler.reconcile;
    reconciler.reconcile = async context => { const value = await original(context); if (mode === 'revoked') active = false;
      else await store.transaction('owner-1', state => { if (mode === 'state') state.tasks[0].task = { ...state.tasks[0].task, state_version: state.tasks[0].task.state_version + 1 }; else state.tasks[0].content = { revision: 'altered', slots: {} }; }); return value; };
    const result = await createWorkspaceRunner(config(store, { authorizeOwner: async () => active, reconcilers: { draft: reconciler } })).reconcile('owner-1', 'task-1', run.run_id, request);
    assert.equal(result.status, 'blocked', mode); assert.equal((await read(store)).task.stage, 'unknown'); assert.equal((await read(store)).receipts?.length ?? 0, 0);
  }
});

test('reconciled completion after cancellation discards output instead of reviving task', async () => {
  const store = new MemoryWorkspaceStore(); const { run } = await toUnknown(store);
  await store.transaction('owner-1', state => { const action = newAction(state.tasks[0], 'cancel'); action.status = 'unknown'; });
  const record = await read(store); const result = await createWorkspaceRunner(config(store, { reconcilers: { draft: fixtureReconciler() } })).reconcile('owner-1', 'task-1', run.run_id, { expected_state_version: record.task.state_version, idempotency_key: 'recover-and-cancel' });
  assert.equal(result.status, 'cancelled'); const after = await read(store); assert.equal(after.task.stage, 'cancelled'); assert.equal(after.task.snapshot.canonical_version, 'unresolved'); assert.equal(after.receipts!.filter(item => item.kind === 'brief_accepted').length, 0);
});

test('recovered review cannot alter the exact artwork previously approved', async () => {
  const store = new MemoryWorkspaceStore(); await toApprovedArtwork(store); const { run, request } = await toUnknown(store, 'review');
  const reconciler = fixtureReconciler(); const original = reconciler.reconcile;
  reconciler.reconcile = async context => { const value = await original(context); if (value.outcome === 'completed') value.output.preview = { ...context.original.record.preview!, html: 'Unapproved replacement' }; return value; };
  assert.equal((await createWorkspaceRunner(config(store, { reconcilers: { review: reconciler } })).reconcile('owner-1', 'task-1', run.run_id, request)).status, 'unknown'); assert.equal((await read(store)).task.stage, 'unknown');
});

function reference(record: WorkspaceRecord, referenceId: string, purpose: 'brief' | 'feedback' = 'feedback'): NonNullable<WorkspaceRecord['references']>[number] {
  return { reference_id: referenceId, revision_id: referenceId + ':v1', upload_id: 'upload:' + referenceId, filename: referenceId + '.png', media_type: 'image/png',
    size_bytes: 12, sha256: sha(referenceId), storage_key: 'test-private/' + referenceId, content_revision: record.task.snapshot.content_revision, role: 'style', note: 'Context only, not product evidence',
    purpose, review_index_id: record.review_manifest?.index_id, width: 20, height: 20, created_at: time, technical_validation: 'full_decode_passed', visual_inspection: 'not_performed' };
}

test('selected reference bytes and original group references survive mixed revision without adding unselected references', async () => {
  const store = new MemoryWorkspaceStore(); await toCompleted(store);
  await store.transaction('owner-1', state => { const record = state.tasks[0]; record.references = [reference(record, 'brief', 'brief'), reference(record, 'selected'), reference(record, 'not-selected')]; });
  await queueAssetFeedback(store, true);
  await store.transaction('owner-1', state => { const payload = state.tasks[0].actions.at(-1)!.payload as { groups: Array<{ reference_ids?: string[] }> }; payload.groups[0].reference_ids = ['selected']; });
  const seen: Array<{ stage: string; refs: string[]; groups?: unknown }> = [];
  const adapters = fixtureAdapters(context => {
    seen.push({ stage: context.run.stage, refs: (context.references ?? []).map(item => item.reference_id), groups: context.feedback?.groups });
    assert.deepEqual(context.record.references, context.references); assert.equal(context.references?.some(item => item.reference_id === 'not-selected'), false);
  });
  const runner = createWorkspaceRunner(config(store, { adapters })); await runner.drainOwner('owner-1'); await approve(store); await runner.drainOwner('owner-1');
  assert.deepEqual(seen.map(item => item.stage), ['content_feedback', 'assets_reuse', 'asset_feedback']);
  for (const context of seen) assert.deepEqual(context.refs, ['brief', 'selected']);
  assert.deepEqual((seen.at(-1)!.groups as Array<{ reference_ids: string[] }>)[0].reference_ids, ['selected']);
  assert.equal((await read(store)).revision_plan?.source_references?.[0].content_revision, seen.length ? (await read(store)).revision_plan?.source_snapshot.content_revision : '');
});

test('stale or removed feedback reference blocks before any revision or later reuse', async () => {
  for (const mode of ['stale-at-submit', 'removed-after-content'] as const) {
    const store = new MemoryWorkspaceStore(); await toCompleted(store);
    await store.transaction('owner-1', state => { const record = state.tasks[0]; record.references = [reference(record, 'selected')]; if (mode === 'stale-at-submit') record.references[0].review_index_id = sha('stale'); });
    await queueAssetFeedback(store, true);
    await store.transaction('owner-1', state => { const payload = state.tasks[0].actions.at(-1)!.payload as { groups: Array<{ reference_ids?: string[] }> }; payload.groups[0].reference_ids = ['selected']; });
    let calls = 0; const runner = createWorkspaceRunner(config(store, { adapters: fixtureAdapters(() => { calls++; }) })); await runner.drainOwner('owner-1');
    if (mode === 'removed-after-content') {
      assert.equal(calls, 1); await store.transaction('owner-1', state => { state.tasks[0].references![0].removed_at = time; }); await approve(store); await runner.drainOwner('owner-1');
    }
    const record = await read(store); assert.equal(record.task.stage, mode === 'removed-after-content' ? 'blocked' : 'completed', mode); assert.equal(calls, mode === 'removed-after-content' ? 1 : 0);
    assert.equal(record.actions.at(-1)!.status, 'blocked');
    assert.equal(record.events.at(-1)!.data.code, mode === 'removed-after-content' ? 'REVISION_REFERENCE_CHANGED' : 'STALE_FEEDBACK_REFERENCE');
  }
});

test('unknown mixed image operation recovers exact staged scope and does not regenerate unchanged images', async () => {
  const store = new MemoryWorkspaceStore(); await toCompleted(store); await queueAssetFeedback(store, true); await createWorkspaceRunner(config(store)).drainOwner('owner-1'); await approve(store);
  await createWorkspaceRunner(config(store)).runNext('owner-1'); assert.equal((await read(store)).task.pending_feedback?.kind, 'assets');
  const { run, request } = await toUnknown(store, 'asset_feedback'); const before = await read(store); let executes = 0;
  const runner = createWorkspaceRunner(config(store, { adapters: fixtureAdapters(() => { executes++; }), reconcilers: { asset_feedback: fixtureReconciler() } }));
  assert.equal((await runner.reconcile('owner-1', 'task-1', run.run_id, request)).status, 'advanced'); const after = await read(store);
  assert.equal(executes, 0); assert.equal(after.task.stage, 'review'); assert.equal(after.revision_plan?.phase, 'review_ready');
  assert.deepEqual(after.task.snapshot.assets[1], before.task.snapshot.assets[1]); assert.deepEqual(after.revision_plan?.intent, before.revision_plan?.intent); assert.equal(after.task.pending_feedback, undefined);
});

test('a crash before any provider reservation still needs proof and closes the old operation before a retry', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); const adapters = fixtureAdapters(); adapters.draft.execute = async () => { throw new Error('process lost before provider'); };
  await createWorkspaceRunner(config(store, { adapters })).runNext('owner-1'); let record = await read(store); const run = record.runs![0]; assert.equal(run.provider_binding, undefined);
  const request = { expected_state_version: record.task.state_version, idempotency_key: 'before-reserve-crash' };
  const reconciler = fixtureReconciler('no_side_effect'); const original = reconciler.reconcile;
  reconciler.reconcile = async context => { const outcome = await original(context); if (outcome.outcome !== 'unknown') Reflect.deleteProperty(outcome.proof, 'operation_fenced'); return outcome; };
  assert.equal((await createWorkspaceRunner(config(store, { reconcilers: { draft: reconciler } })).reconcile('owner-1', 'task-1', run.run_id, request)).status, 'unknown');
  const result = await createWorkspaceRunner(config(store, { reconcilers: { draft: fixtureReconciler('no_side_effect') } })).reconcile('owner-1', 'task-1', run.run_id, { ...request, idempotency_key: 'verified-closed-attempt' });
  assert.equal(result.code, 'SAFE_NEW_ATTEMPT_READY'); record = await read(store); assert.equal(record.task.stage, 'draft'); assert.equal(record.runs![0].recovery_requests!.at(-1)!.proof!.accounting, 'not_reserved');
});

test('provider binding is durable before submit and cannot be replaced by another reservation', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); const adapters = fixtureAdapters(); let bound = false;
  adapters.draft.execute = async context => {
    await context.bindProviderOperation!(binding); bound = (await read(store)).runs![0].provider_binding?.reservation_id === binding.reservation_id;
    await assert.rejects(context.bindProviderOperation!({ ...binding, reservation_id: 'different' }), /PROVIDER_BINDING_CONFLICT/);
    return { outcome: 'unknown', code: 'TEST_OUTCOME_UNKNOWN' };
  };
  await createWorkspaceRunner(config(store, { adapters })).runNext('owner-1'); assert.equal(bound, true); assert.deepEqual((await read(store)).runs![0].provider_binding, binding);
});

test('stage-specific bounded deadline and lease permit multi-call work beyond generic timeout', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store);
  const adapters = fixtureAdapters(); const draftAdapter = adapters.draft;
  adapters.draft = { ...draftAdapter, async execute(c) { await new Promise(done => setTimeout(done, 40)); return draftAdapter.execute(c); } };
  const runner = createWorkspaceRunner(config(store, { adapters, now: () => Date.parse(time), timeoutMs: 10, leaseMs: 20, stageTiming: { draft: { timeoutMs: 1000, leaseMs: 2000 } } }));
  assert.equal((await runner.runNext('owner-1')).status, 'advanced');
  const run = (await read(store)).runs![0]; assert.equal(Date.parse(run.lease_expires_at) - Date.parse(run.created_at), 2000);
});
test('stage timing rejects unbounded values, unknown stages and lease shorter than timeout', () => {
  const store = new MemoryWorkspaceStore();
  for (const stageTiming of [{ draft: { timeoutMs: 100, leaseMs: 100 } }, { draft: { timeoutMs: 3600001, leaseMs: 4000000 } }, { unexpected: { timeoutMs: 10, leaseMs: 20 } }]) assert.throws(() => createWorkspaceRunner(config(store, { stageTiming })), /INVALID_STAGE_TIMING/);
});
test('a completed adapter cannot advance while an immutable artifact write remains unknown', async () => {
  const store = new MemoryWorkspaceStore(); await seed(store); const adapters = fixtureAdapters(); const draftAdapter = adapters.draft;
  adapters.draft = { ...draftAdapter, async execute(c) {
    await store.transaction(c.owner_id, state => { state.tasks[0].runs![0].artifact_intents = [{ owner_id: c.owner_id, task_id: c.record.task.task_id, storage_key: 'test-object', sha256: sha('test'), size_bytes: 4, media_type: 'text/plain', status: 'unknown', created_at: time, updated_at: time }]; });
    return draftAdapter.execute(c);
  } };
  const result = await createWorkspaceRunner(config(store, { adapters })).runNext('owner-1');
  assert.equal(result.status, 'unknown'); assert.equal(result.code, 'ARTIFACT_WRITES_REQUIRE_RECONCILIATION');
});

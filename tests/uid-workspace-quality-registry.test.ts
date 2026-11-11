import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MemoryWorkspaceStore, type WorkspaceRecord } from '../uid-workspace-store.ts';
import { createWorkspaceTask } from '../uid-workspace-task.ts';
import { workspaceObjectKey } from '../uid-workspace-artifacts.ts';
import { createWorkspaceOperationJournal, type WorkspaceChildIntent } from '../uid-workspace-operations.ts';
import { createWorkspaceQualityRegistry } from '../uid-workspace-quality-registry.ts';
import { buildWorkspaceReviewManifest } from '../uid-workspace-review.ts';
import { stableJson } from '../supabase/functions/_shared/creative-quality.ts';
import type { WorkspaceStageContext } from '../uid-workspace-runner.ts';
import type { WorkspaceQualityAttestation } from '../uid-workspace-quality.ts';
import type { WorkspaceOnepageReviewRequest } from '../uid-workspace-onepage.ts';

// Local synthetic authority/provider evidence only. The real child journal is
// exercised here; fixtures never establish real artistic approval or EO parity.
const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const digest = (v: unknown) => sha(stableJson(v));
const NOW = Date.parse('2026-11-06T10:00:00Z'), before = new Date(NOW - 1000).toISOString(), later = new Date(NOW + 60000).toISOString();
async function fixture(role: WorkspaceChildIntent['role'] = 'independent_reviewer') {
  const store = new MemoryWorkspaceStore(), controller = new AbortController();
  const imageHash = sha('synthetic verified raster'), contentHash = sha('copy');
  const assets = [{ asset_id: 'hero', canonical_slot: 'banner_desktop', revision_id: 'hero-revision', content_revision: 'copy-one', label: 'Hero' }];
  const task = createWorkspaceTask('task-one', { snapshot_id: 'snapshot-one', canonical_version: 'canonical-one', content_revision: 'copy-one', content_digest: contentHash, assets });
  const manifest = buildWorkspaceReviewManifest({ task_id: task.task_id, content_revision: 'copy-one', template_version: 'template-one', canonical_hash: sha('canonical'), render_hash: sha('render'), elements: [{ id: 'hero-image', kind: 'image', slot: 'hero', canonical_slot: 'banner_desktop', artifact_revision: 'hero-revision', sha256: imageHash }] });
  const action: WorkspaceRecord['actions'][number] = { action_id: 'action-one', idempotency_key: 'action-one', fingerprint: sha('action'), type: 'approve_artwork', status: 'running', expected_state_version: task.state_version, content_revision: 'copy-one', created_at: before, actor_id: 'alice', payload: {
    approval_source: 'authenticated_user', snapshot_id: task.snapshot.snapshot_id, content_digest: contentHash, review_index_id: manifest.index_id, render_hash: manifest.render_hash,
    assets: assets.map(a => ({ asset_id: a.asset_id, canonical_slot: a.canonical_slot, revision_id: a.revision_id, sha256: imageHash })),
  } };
  const run: NonNullable<WorkspaceRecord['runs']>[number] = { run_id: 'run-one', action_id: action.action_id, operation_id: 'root-operation', stage: 'review', expected_state_version: task.state_version, snapshot_id: 'snapshot-one', content_revision: 'copy-one', fence: 1, status: 'in_flight', lease_owner: 'worker-one', lease_expires_at: later, created_at: before, updated_at: before };
  const record: WorkspaceRecord = { owner_id: 'alice', task, brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://example.test/product' }, created_at: before, updated_at: before, actions: [action], runs: [run], events: [], artifacts: [{ artifact_id: 'hero-file', revision_id: 'hero-revision', filename: 'hero.png', media_type: 'image/png', size_bytes: 30, sha256: imageHash, content_revision: 'copy-one', kind: 'image', verification: 'verified', storage_key: workspaceObjectKey('alice', task.task_id, imageHash) }], content: null, preview: null, review_manifest: manifest, quality: [] };
  await store.transaction('alice', state => { state.tasks.push(record); });
  const context: WorkspaceStageContext = { owner_id: 'alice', record: structuredClone(record), action: structuredClone(action), run: structuredClone(run), signal: controller.signal };
  const operations = createWorkspaceOperationJournal({ store, authorizeOwner: async owner => owner === 'alice', now: () => NOW });
  const request_sha256 = sha('provider request'), output_sha256 = sha('provider decision');
  const result = await operations.execute(context, { key: 'qc-one', role, provider: 'openai-responses-vision', model: 'fixture-sol', input_sha256: sha('subject-input') }, async c => {
    await c.bindProviderOperation!({ provider: 'openai-responses-vision', reservation_id: 'reservation-one', request_sha256 }); await operations.guardDispatch(c);
    return { value: 'synthetic decision', report: { outcome: 'completed', accounting: 'settled', reservation_id: 'reservation-one', request_sha256, budget_receipt_id: 'budget-one', provider_operation_id: 'response-one', response_model: 'fixture-sol', output_sha256, evidence_refs: ['fixture:budget'] } };
  });
  assert.equal(result.status, 'completed');
  const report = Buffer.from('{"fixture":"retained report, not real QC"}');
  const binding: WorkspaceQualityAttestation = { owner_id: 'alice', task_id: task.task_id, subject_sha256: sha('subject'), report_sha256: sha(report), reviewer_id: 'independent-reviewer', authority_ref: 'reviewer-authority', operation_id: result.operation_id!, response_id: 'response-one', response_model: 'fixture-sol', output_sha256, request_sha256, budget_receipt_id: 'budget-one' };
  await store.transaction('alice', state => { state.tasks[0].runs![0].artifact_intents = [{ owner_id: 'alice', task_id: task.task_id, storage_key: workspaceObjectKey('alice', task.task_id, binding.report_sha256), sha256: binding.report_sha256, size_bytes: report.length, media_type: 'application/json', status: 'verified', created_at: before, updated_at: before }]; });
  const subject = { owner_id: 'alice', task_id: task.task_id, input_snapshot: task.snapshot, value: { snapshot: task.snapshot, manifest } };
  const request: WorkspaceOnepageReviewRequest = { kind: 'review', subject, subject_sha256: digest({ kind: 'review', value: subject }) };
  return { store, context, controller, binding, request, registry: createWorkspaceQualityRegistry(store, { now: () => NOW }),
    mutate: (fn: (r: WorkspaceRecord) => void) => store.transaction('alice', state => fn(state.tasks[0])), read: () => store.read('alice', state => state.tasks[0]) };
}

test('attestation pins exact completed independent child and survives registry restart without duplicate entries', async () => {
  const f = await fixture(); assert.equal(await f.registry.verifyAttestation(f.context, f.binding), false);
  await f.registry.retainAttestation(f.context, f.binding); await f.registry.retainAttestation(f.context, structuredClone(f.binding));
  const restarted = createWorkspaceQualityRegistry(f.store, { now: () => NOW });
  assert.equal(await restarted.verifyAttestation(f.context, f.binding), true); assert.equal((await f.read()).runs![0].quality_attestations!.length, 1);
  f.binding.subject_sha256 = sha('mutated external object'); assert.equal(await restarted.verifyAttestation(f.context, f.binding), false);
});
test('concurrent identical retention is idempotent and conflicting report authority cannot overwrite a child', async () => {
  const f = await fixture(); await Promise.all([f.registry.retainAttestation(f.context, f.binding), f.registry.retainAttestation(f.context, structuredClone(f.binding))]);
  await assert.rejects(f.registry.retainAttestation(f.context, { ...f.binding, subject_sha256: sha('other subject') }), /QUALITY_REGISTRY_CONFLICT/);
  await assert.rejects(f.registry.retainAttestation(f.context, { ...f.binding, reviewer_id: 'different-reviewer' }), /QUALITY_REGISTRY_CONFLICT/);
  assert.equal((await f.read()).runs![0].quality_attestations!.length, 1); assert.equal(await f.registry.verifyAttestation(f.context, f.binding), true);
});
for (const role of ['author', 'image_generator', 'research'] as const) test(`${role} child cannot self-attest as independent quality review`, async () => {
  const f = await fixture(role); await assert.rejects(f.registry.retainAttestation(f.context, f.binding), /QUALITY_REGISTRY_OPERATION_UNVERIFIED/);
  assert.equal(await f.registry.verifyAttestation(f.context, f.binding), false);
});
for (const changed of ['unknown', 'held', 'response', 'model', 'output', 'request', 'receipt', 'reservation', 'provider', 'duplicate'] as const) test(`registry reopens child evidence and rejects ${changed} after retention`, async () => {
  const f = await fixture(); await f.registry.retainAttestation(f.context, f.binding);
  await f.mutate(r => { const op = r.runs![0].child_operations![0];
    if (changed === 'unknown') op.status = 'unknown'; if (changed === 'held') op.report!.accounting = 'held'; if (changed === 'response') op.report!.provider_operation_id = 'different-response';
    if (changed === 'model') op.report!.response_model = 'different-model'; if (changed === 'output') op.report!.output_sha256 = sha('changed'); if (changed === 'request') op.provider_binding!.request_sha256 = sha('changed');
    if (changed === 'receipt') op.report!.budget_receipt_id = 'different-receipt'; if (changed === 'reservation') op.provider_binding!.reservation_id = 'different-reservation'; if (changed === 'provider') op.intent.provider = 'openai-responses';
    if (changed === 'duplicate') r.runs!.push({ ...structuredClone(r.runs![0]), run_id: 'duplicate-run' });
  });
  assert.equal(await f.registry.verifyAttestation(f.context, f.binding), false);
});
for (const changed of ['missing', 'pending', 'owner', 'task', 'hash', 'media', 'key'] as const) test(`registry requires exact verified private report artifact: ${changed}`, async () => {
  const f = await fixture(); await f.registry.retainAttestation(f.context, f.binding);
  await f.mutate(r => { const intent = r.runs![0].artifact_intents![0];
    if (changed === 'missing') r.runs![0].artifact_intents = []; if (changed === 'pending') intent.status = 'reserved'; if (changed === 'owner') intent.owner_id = 'bob'; if (changed === 'task') intent.task_id = 'different-task';
    if (changed === 'hash') intent.sha256 = sha('different report'); if (changed === 'media') intent.media_type = 'text/html'; if (changed === 'key') intent.storage_key = workspaceObjectKey('bob', intent.task_id, intent.sha256);
  });
  assert.equal(await f.registry.verifyAttestation(f.context, f.binding), false); await assert.rejects(f.registry.retainAttestation(f.context, f.binding), /QUALITY_REGISTRY_OPERATION_UNVERIFIED/);
});
for (const fence of ['cancel', 'lease', 'fence', 'action', 'actor', 'snapshot', 'version', 'abort'] as const) test(`new QC retention rejects current ${fence} fence`, async () => {
  const f = await fixture(); if (fence === 'abort') f.controller.abort(); else await f.mutate(r => {
    if (fence === 'cancel') r.actions.push({ ...r.actions[0], action_id: 'cancel', type: 'cancel', status: 'queued' }); if (fence === 'lease') r.runs![0].lease_expires_at = before;
    if (fence === 'fence') r.runs![0].fence++; if (fence === 'action') r.actions[0].status = 'cancelled'; if (fence === 'actor') r.actions[0].actor_id = 'bob';
    if (fence === 'snapshot') r.task = { ...r.task, snapshot: { ...r.task.snapshot, snapshot_id: 'different' } }; if (fence === 'version') r.task = { ...r.task, state_version: r.task.state_version + 1 };
  });
  await assert.rejects(f.registry.retainAttestation(f.context, f.binding), /QUALITY_REGISTRY_(OPERATION_UNVERIFIED|SCOPE_MISMATCH)/); assert.equal((await f.read()).runs![0].quality_attestations, undefined);
});
test('unknown attestation, malformed fields and cross-owner/task scope never verify', async () => {
  const f = await fixture(); await f.registry.retainAttestation(f.context, f.binding);
  for (const patch of [{ owner_id: 'bob' }, { task_id: 'other' }, { operation_id: 'child:invented' }, { report_sha256: 'not-a-hash' }, { model_approved: true }]) assert.equal(await f.registry.verifyAttestation(f.context, { ...f.binding, ...patch }), false);
  assert.equal(await f.registry.verifyAttestation({ ...f.context, owner_id: 'bob' }, f.binding), false);
  await assert.rejects(f.registry.retainAttestation(f.context, { ...f.binding, owner_id: 'bob' }), /QUALITY_REGISTRY_SCOPE_MISMATCH/);
});
test('authenticated artistic evidence reopens exact current snapshot, manifest and artifact hashes', async () => {
  const f = await fixture(), evidence = await f.registry.reopenHumanReview(f.context, f.request); assert.ok(evidence);
  assert.equal(evidence.source, 'authenticated_artwork_approval'); assert.equal(evidence.actor_id, 'alice'); assert.equal(evidence.evidence_ref, 'approval:action-one');
  assert.equal(evidence.snapshot_id, 'snapshot-one'); assert.equal(evidence.content_digest, f.context.record.task.snapshot.content_digest); assert.equal(evidence.index_id, f.context.record.review_manifest!.index_id);
  assert.deepEqual(evidence.assets, (f.context.action.payload as any).assets); assert.equal(evidence.approved_at, before);
  evidence.assets[0].sha256 = sha('external mutation'); assert.notEqual((await f.registry.reopenHumanReview(f.context, f.request))!.assets[0].sha256, evidence.assets[0].sha256);
  await f.mutate(r => { r.actions[0].status = 'succeeded'; }); assert.ok(await f.registry.reopenHumanReview(f.context, f.request));
});
for (const changed of ['model', 'actor', 'type', 'queued', 'failed', 'snapshot', 'digest', 'index', 'render', 'asset', 'revision', 'artifact', 'verification', 'manifest', 'abort'] as const) test(`human gate refuses ${changed} mismatch instead of trusting model approval`, async () => {
  const f = await fixture(); if (changed === 'abort') f.controller.abort(); else await f.mutate(r => {
    const payload = r.actions[0].payload as any;
    if (changed === 'model') { payload.approval_source = 'model_approved'; f.context.action.payload = structuredClone(payload); }
    if (changed === 'actor') r.actions[0].actor_id = 'model'; if (changed === 'type') r.actions[0].type = 'approve_content'; if (changed === 'queued') r.actions[0].status = 'queued'; if (changed === 'failed') r.actions[0].status = 'failed_before_submit';
    if (changed === 'snapshot') r.task = { ...r.task, snapshot: { ...r.task.snapshot, snapshot_id: 'new' } }; if (changed === 'digest') r.task = { ...r.task, snapshot: { ...r.task.snapshot, content_digest: sha('new') } };
    if (changed === 'index') r.review_manifest!.index_id = sha('new'); if (changed === 'render') r.review_manifest!.render_hash = sha('new');
    if (changed === 'asset') { payload.assets[0].sha256 = sha('new'); f.context.action.payload = structuredClone(payload); }
    if (changed === 'revision') r.task = { ...r.task, snapshot: { ...r.task.snapshot, assets: r.task.snapshot.assets.map(a => ({ ...a, revision_id: 'new' })) } }; if (changed === 'artifact') r.artifacts[0].sha256 = sha('new'); if (changed === 'verification') r.artifacts[0].verification = 'pending'; if (changed === 'manifest') r.review_manifest = null;
  });
  assert.equal(await f.registry.reopenHumanReview(f.context, f.request), null);
});
test('human gate reads durable action instead of a forged context-only approval', async () => {
  const f = await fixture(); await f.mutate(r => { r.actions[0].payload = { approval_source: 'model_approved' }; });
  assert.equal(await f.registry.reopenHumanReview(f.context, f.request), null); assert.equal(await f.registry.reopenHumanReview({ ...f.context, owner_id: 'bob' }, f.request), null);
});

for (const changed of ['stale-index', 'missing-image-element', 'non-image-artifact', 'empty-assets', 'pending-feedback'] as const) test(`human artistic evidence requires an intact current review, not ${changed}`, async () => {
  const f = await fixture(); await f.mutate(r => {
    if (changed === 'stale-index') r.review_manifest!.elements[0] = { ...r.review_manifest!.elements[0], id: 'changed-without-rehash' };
    if (changed === 'missing-image-element') {
      const { index_id: _, ...body } = r.review_manifest!;
      r.review_manifest = buildWorkspaceReviewManifest({ ...body, elements: [{ id: 'text-only', kind: 'text', slot: 'title', text_hash: sha('title') }] });
      (r.actions[0].payload as any).review_index_id = r.review_manifest.index_id; f.context.action.payload = structuredClone(r.actions[0].payload);
    }
    if (changed === 'non-image-artifact') r.artifacts[0].kind = 'document';
    if (changed === 'empty-assets') { r.task = { ...r.task, snapshot: { ...r.task.snapshot, assets: [] } }; (r.actions[0].payload as any).assets = []; f.context.action.payload = structuredClone(r.actions[0].payload); }
    if (changed === 'pending-feedback') r.task = { ...r.task, pending_feedback: { action_id: 'feedback-one', kind: 'assets', snapshot_id: r.task.snapshot.snapshot_id, canonical_slots: ['banner_desktop'] } };
  });
  assert.equal(await f.registry.reopenHumanReview(f.context, f.request), null);
});

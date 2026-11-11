import { createHash } from 'node:crypto';
import { z } from 'zod';
import { stableJson } from './supabase/functions/_shared/creative-quality.ts';
import type { WorkspaceStore, WorkspaceRecord } from './uid-workspace-store.ts';
import type { WorkspaceStageContext } from './uid-workspace-runner.ts';
import type { WorkspaceQualityAttestation, WorkspaceQualityHumanEvidence } from './uid-workspace-quality.ts';
import type { WorkspaceOnepageReviewRequest } from './uid-workspace-onepage.ts';
import { workspaceObjectKey } from './uid-workspace-artifacts.ts';
import { buildWorkspaceReviewManifest } from './uid-workspace-review.ts';

/** Private durable registry, not a model-provided approval or a new authority.
 * The independent quality provider has already verified the candidate, evidence,
 * actual response and role before retaining. This pins that report to the exact
 * settled child operation; verify reopens the owner journal on every check. */
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({ owner_id: id, task_id: id, subject_sha256: hash, report_sha256: hash, reviewer_id: id, authority_ref: id,
  operation_id: id, response_id: id, response_model: id, output_sha256: hash, request_sha256: hash, budget_receipt_id: id }).strict();
const digest = (v: unknown) => createHash('sha256').update(stableJson(v)).digest('hex');
function fail(code: string): never { throw new Error(code); }
function matchesOperation(record: WorkspaceRecord, binding: WorkspaceQualityAttestation) {
  const matches = record.runs?.flatMap(run => (run.child_operations ?? []).map(child => ({ run, child }))).filter(value => value.child.operation_id === binding.operation_id) ?? [];
  if (matches.length !== 1) return false;
  const { run, child } = matches[0], report = child.report;
  return child.status === 'completed' && child.intent.role === 'independent_reviewer' && child.intent.provider === 'openai-responses-vision'
    && report?.outcome === 'completed' && report.accounting === 'settled' && report.request_sha256 === binding.request_sha256
    && report.provider_operation_id === binding.response_id && report.response_model === binding.response_model && report.output_sha256 === binding.output_sha256
    && report.budget_receipt_id === binding.budget_receipt_id && child.provider_binding?.request_sha256 === binding.request_sha256
    && child.provider_binding.reservation_id === report.reservation_id
    && run.artifact_intents?.some(value => value.status === 'verified' && value.owner_id === binding.owner_id && value.task_id === binding.task_id
      && value.sha256 === binding.report_sha256 && value.storage_key === workspaceObjectKey(binding.owner_id, binding.task_id, binding.report_sha256) && value.media_type === 'application/json') === true;
}
export function createWorkspaceQualityRegistry(store: WorkspaceStore, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  async function retainAttestation(c: WorkspaceStageContext, raw: WorkspaceQualityAttestation) {
    const binding = schema.parse(raw);
    if (c.signal.aborted || c.owner_id !== c.record.owner_id || binding.owner_id !== c.owner_id || binding.task_id !== c.record.task.task_id) fail('QUALITY_REGISTRY_SCOPE_MISMATCH');
    await store.transaction(c.owner_id, state => {
      const record = state.tasks.find(value => value.owner_id === c.owner_id && value.task.task_id === binding.task_id);
      const run = record?.runs?.find(value => value.run_id === c.run.run_id), action = record?.actions.find(value => value.action_id === c.action.action_id);
      if (!record || !run || !action || run.status !== 'in_flight' || run.fence !== c.run.fence || run.lease_owner !== c.run.lease_owner || run.operation_id !== c.run.operation_id
        || Date.parse(run.lease_expires_at) <= now() || action.status !== 'running' || action.actor_id !== c.owner_id || run.action_id !== action.action_id
        || record.task.snapshot.snapshot_id !== c.record.task.snapshot.snapshot_id || record.task.state_version !== c.record.task.state_version
        || record.actions.some(value => value.type === 'cancel' && ['queued', 'running'].includes(value.status))
        || !run.child_operations?.some(value => value.operation_id === binding.operation_id) || !matchesOperation(record, binding)) fail('QUALITY_REGISTRY_OPERATION_UNVERIFIED');
      const entries = run.quality_attestations ??= [], existing = entries.find(value => value.operation_id === binding.operation_id);
      if (existing) { if (digest(existing) !== digest(binding)) fail('QUALITY_REGISTRY_CONFLICT'); return; }
      if (entries.length >= 128) fail('QUALITY_REGISTRY_LIMIT');
      entries.push(structuredClone(binding));
    });
  }
  async function verifyAttestation(c: WorkspaceStageContext, raw: WorkspaceQualityAttestation) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success || c.signal.aborted || c.owner_id !== c.record.owner_id || raw.owner_id !== c.owner_id || raw.task_id !== c.record.task.task_id) return false;
    return store.read(c.owner_id, state => {
      const record = state.tasks.find(value => value.owner_id === c.owner_id && value.task.task_id === raw.task_id);
      return !!record && record.runs?.some(run => run.quality_attestations?.some(value => digest(value) === digest(raw))) === true && matchesOperation(record, raw);
    });
  }
  async function reopenHumanReview(c: WorkspaceStageContext, _request: WorkspaceOnepageReviewRequest): Promise<WorkspaceQualityHumanEvidence | null> {
    if (c.signal.aborted || c.owner_id !== c.record.owner_id || c.action.type !== 'approve_artwork' || c.action.actor_id !== c.owner_id) return null;
    return store.read(c.owner_id, state => {
      const record = state.tasks.find(value => value.owner_id === c.owner_id && value.task.task_id === c.record.task.task_id);
      const action = record?.actions.find(value => value.action_id === c.action.action_id);
      if (!record || !action || action.type !== 'approve_artwork' || action.actor_id !== c.owner_id || !['running','succeeded'].includes(action.status) || !record.review_manifest
        || record.task.pending_feedback || !record.task.snapshot.assets.length || digest(record.task.snapshot) !== digest(c.record.task.snapshot)
        || digest(action.payload) !== digest(c.action.payload)) return null;
      try { const { index_id, ...body } = record.review_manifest; if (buildWorkspaceReviewManifest(body).index_id !== index_id) return null; }
      catch { return null; }
      const p = action.payload as any, snapshot = record.task.snapshot;
      const expected = snapshot.assets.map(asset => ({ asset_id: asset.asset_id, canonical_slot: asset.canonical_slot, revision_id: asset.revision_id,
        sha256: record.artifacts.find(a => a.kind === 'image' && a.media_type.startsWith('image/') && a.revision_id === asset.revision_id && a.content_revision === snapshot.content_revision && a.verification === 'verified')?.sha256 }));
      if (!p || p.approval_source !== 'authenticated_user' || p.snapshot_id !== snapshot.snapshot_id || p.content_digest !== snapshot.content_digest
        || p.review_index_id !== record.review_manifest.index_id || p.render_hash !== record.review_manifest.render_hash || !Array.isArray(p.assets)
        || expected.some(value => !hash.safeParse(value.sha256).success) || digest(p.assets) !== digest(expected)) return null;
      const images = record.review_manifest.elements.filter(value => value.kind === 'image');
      const match = (element: typeof images[number], asset: typeof expected[number]) => element.canonical_slot === asset.canonical_slot && element.artifact_revision === asset.revision_id && element.sha256 === asset.sha256;
      if (expected.some(asset => !images.some(element => match(element, asset))) || images.some(element => !expected.some(asset => match(element, asset)))) return null;
      return { evidence_ref: 'approval:' + action.action_id, owner_id: c.owner_id, task_id: record.task.task_id, actor_id: action.actor_id, action_id: action.action_id,
        source: 'authenticated_artwork_approval', decision: 'approved', content_revision: snapshot.content_revision, snapshot_id: snapshot.snapshot_id, content_digest: snapshot.content_digest,
        render_hash: p.render_hash, index_id: p.review_index_id, assets: structuredClone(p.assets), approved_at: action.created_at };
    });
  }
  return { retainAttestation, verifyAttestation, reopenHumanReview };
}

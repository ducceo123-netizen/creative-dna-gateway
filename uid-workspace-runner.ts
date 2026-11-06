import type { TrustedWorkspaceReconciler, WorkspaceRecoveryRequest, WorkspaceRecoveryContext, WorkspaceRecoveryOutcome, WorkspaceProviderBinding } from './uid-workspace-recovery.ts';
import { randomUUID, createHash } from 'node:crypto';
import { applyWorkspaceAction, workspaceFeedbackIndex, type Receipt, type ReceiptKind, type Task, type TaskAction } from './uid-workspace-task.ts';
import { captureWorkspaceRevision, createWorkspaceRevisionPlan, type WorkspaceRevisionPlan } from './uid-workspace-revision.ts';
import { buildWorkspaceReviewManifest } from './uid-workspace-review.ts';
import type { WorkspaceActionRecord, WorkspaceArtifact, WorkspaceRecord, WorkspaceStore } from './uid-workspace-store.ts';
import { workspaceChildrenUnsettled, workspaceValidateChildRecovery, type WorkspaceChildOperation, type WorkspaceChildContext } from './uid-workspace-operations.ts';
import type { WorkspaceQualityAttestation } from './uid-workspace-quality.ts';

/** Durable orchestration only. There is intentionally NO default provider, synthetic
 * evidence, process-global queue, credential lookup or production-store fallback.
 * A worker deployment must enumerate authorized owners from its private durable
 * queue and call drainOwner. HTTP reads/polling never dispatch work. */
export type WorkspaceRunnerStage = 'draft' | 'research' | 'content_authoring' | 'assets' | 'review' | 'packaging' | 'content_feedback' | 'asset_feedback' | 'assets_reuse';
export type WorkspaceRunRecord = {
  run_id: string; action_id: string; stage: WorkspaceRunnerStage; operation_id: string;
  expected_state_version: number; snapshot_id: string; content_revision: string;
  fence: number; status: 'claimed' | 'in_flight' | 'succeeded' | 'blocked' | 'failed_before_submit' | 'unknown' | 'cancelled' | 'discarded';
  lease_owner: string; lease_expires_at: string; created_at: string; updated_at: string;
  provider_operation_id?: string; reason?: string;
  provider_binding?: WorkspaceProviderBinding;
  child_operations?: WorkspaceChildOperation[];
  quality_attestations?: WorkspaceQualityAttestation[];
  /** Immutable generated-byte intent committed before private object writes. */
  artifact_intents?: Array<{ storage_key: string; owner_id: string; task_id: string; sha256: string; size_bytes: number; media_type: string;
    status: 'reserved' | 'verified' | 'unknown'; created_at: string; updated_at: string }> ;
  input_identity?: string;
  input_action?: WorkspaceActionRecord;
  input?: Pick<WorkspaceRecord, 'task' | 'content' | 'review_manifest' | 'preview' | 'artifacts' | 'revision_plan' | 'references'>;
  recovery_requests?: WorkspaceRecoveryRequest[];
  /** Immutable digest pinned when authenticated artwork approval starts review.
   * Carried across review/package claims so restarts cannot approve a new render. */
  approved_artwork_identity?: string;
};
export type WorkspaceFeedbackIntent = {
  reference_ids?: string[];
  groups: Array<{ instruction: string; reference_ids?: string[]; text_slots: Array<{ slot: string; text_hash: string }>;
    assets?: Array<{ canonical_slot: string; artifact_revision: string; sha256: string }> }>;
};
export type WorkspaceStageContext = Readonly<{
  owner_id: string; record: WorkspaceRecord; action: WorkspaceActionRecord; run: WorkspaceRunRecord;
  /** Exact server-resolved user instructions, never a new scope chosen by a model. */
  feedback?: WorkspaceFeedbackIntent;
  revision_plan?: WorkspaceRevisionPlan;
  references?: WorkspaceRecord['references'];
  /** Persist budget/provider identity before any external generation submission. */
  bindProviderOperation?: (binding: WorkspaceProviderBinding) => Promise<void>;
  /** Server-created child operation, keeping the parent run/snapshot unchanged. */
  provider_operation?: WorkspaceChildContext;
  signal: AbortSignal;
}>;
export type WorkspaceStageOutput = {
  receipt: Receipt;
  /** Retained immutable evidence references, not an LLM's prose assertion. */
  evidence_refs: string[];
  content?: WorkspaceRecord['content'];
  artifacts?: WorkspaceArtifact[];
  preview?: WorkspaceRecord['preview'];
  /** Production persists the manifest; its private renderer serves real bytes on demand. */
  review_manifest?: WorkspaceRecord['review_manifest'];
  quality?: WorkspaceRecord['quality'];
};
export type WorkspaceStageOutcome =
  | { outcome: 'completed'; output: WorkspaceStageOutput; provider_operation_id?: string }
  | { outcome: 'blocked' | 'failed_before_submit' | 'unknown'; code: string; provider_operation_id?: string };
export type WorkspaceEvidenceVerification = {
  verified: true; task_id: string; snapshot_id: string; state_version: number;
  receipt_id: string; evidence_refs: string[]; checks: string[];
};
/** Inject only reviewed trusted SERVER code, never a client object or model tool.
 * execute must enforce authorized tools/data destinations and reserve/reconcile the
 * per-task budget before provider submission. Persist operation_id with providers
 * where supported. Returning failed_before_submit promises no external operation
 * was submitted. Thrown errors/timeouts are conservatively UNKNOWN.
 * verifyEvidence must read actual retained receipts/bytes and use independent
 * semantic/visual/human evidence as required. Do not implement it as LLM says pass.
 * Incomplete evidence must return null. The runner's checks cannot prove EO alone. */
export interface TrustedWorkspaceStageAdapter {
  execute(context: WorkspaceStageContext): Promise<WorkspaceStageOutcome>;
  verifyEvidence(context: WorkspaceStageContext, output: WorkspaceStageOutput): Promise<WorkspaceEvidenceVerification | null>;
}
export type WorkspaceRunnerOptions = {
  store: WorkspaceStore;
  adapters?: Partial<Record<WorkspaceRunnerStage, TrustedWorkspaceStageAdapter>>;
  reconcilers?: Partial<Record<WorkspaceRunnerStage, TrustedWorkspaceReconciler>>;
  environment?: 'production' | 'development' | 'test';
  /** Explicit external authorization/readiness check, including budget and actual
   * provider entitlement. Merely injecting adapters never enables paid execution. */
  executionReadiness?: () => { ready: boolean; blockers: Array<{ code: string; message: string }> };
  /** Current membership, rechecked outside the transaction before EACH stage.
   * Must use the authorized member source, never model input or decoded JWT claims. */
  authorizeOwner?: (ownerId: string) => Promise<boolean>;
  workerId?: string; leaseMs?: number; timeoutMs?: number; now?: () => number; id?: () => string;
  stageTiming?: Partial<Record<WorkspaceRunnerStage, { timeoutMs: number; leaseMs: number }>>;
};
export type WorkspaceRunnerResult = { status: 'idle' | 'busy' | 'advanced' | 'blocked' | 'unknown' | 'cancelled' | 'discarded'; task_id?: string; action_id?: string; code?: string; duplicate?: boolean };
const REQUIRED_CHECKS: Record<WorkspaceRunnerStage, readonly string[]> = {
  draft: ['canonical_compiled'], research: ['source_evidence', 'source_coverage'],
  content_authoring: ['content_schema', 'supported_claims', 'semantic_content'],
  assets: ['approved_content', 'actual_asset_bytes', 'product_fidelity_pixels', 'technical_images', 'canonical_bindings', 'preview_render'],
  review: ['source_claims', 'semantic_content', 'product_fidelity_pixels', 'technical_images', 'canonical_bindings', 'desktop_mobile_render', 'human_artistic_review'],
  packaging: ['canonical_inventory', 'opened_zip', 'artifact_checksums', 'mapping_render'],
  content_feedback: ['content_schema', 'supported_claims', 'semantic_content', 'selected_scope_preserved'],
  assets_reuse: ['approved_content', 'actual_asset_bytes', 'content_asset_compatibility', 'unchanged_asset_bytes', 'canonical_bindings', 'preview_render'],
  asset_feedback: ['actual_asset_bytes', 'product_fidelity_pixels', 'technical_images', 'selected_scope_preserved', 'canonical_bindings', 'preview_render'],
};
const RECEIPT_KINDS: Record<WorkspaceRunnerStage, ReceiptKind> = { draft: 'brief_accepted', research: 'research_complete', content_authoring: 'content_ready',
  assets: 'assets_complete', review: 'review_passed', packaging: 'package_verified', content_feedback: 'content_revised', asset_feedback: 'assets_revised', assets_reuse: 'assets_complete' };
const TERMINAL = new Set(['completed', 'cancelled']);
const INTERRUPTED = new Set(['blocked', 'failed', 'unknown']);
const str = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value === value.trim();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown): string => Array.isArray(value) ? '[' + value.map(json).join(',') + ']' : value && typeof value === 'object'
  ? '{' + Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + json(item)).join(',') + '}' : JSON.stringify(value);
/** Content adapters use this exact digest, enabling byte-independent CAS checks. */
export const workspaceContentDigest = (slots: Record<string, string>) => hash(json(slots));
const clone = <T>(value: T): T => structuredClone(value);
const selectedReferences = (record: WorkspaceRecord) => clone([...(record.references ?? []).filter(item => item.purpose === 'brief' && !item.removed_at), ...(record.revision_plan?.source_references ?? [])]);
const executionInput = (record: WorkspaceRecord) => clone({ references: selectedReferences(record), task: record.task, content: record.content, review_manifest: record.review_manifest, preview: record.preview, artifacts: record.artifacts, revision_plan: record.revision_plan });
const scope = (task: Task, id: string) => ({ action_id: id, task_id: task.task_id, expected_state_version: task.state_version, content_revision: task.snapshot.content_revision });
function append(record: WorkspaceRecord, now: string, type: string, data: Record<string, unknown>) {
  record.events.push({ sequence: (record.events.at(-1)?.sequence ?? 0) + 1, type, created_at: now, data });
  record.updated_at = now;
}
function apply(record: WorkspaceRecord, action: TaskAction, receipts: Receipt[] = [], source: 'user' | 'worker' = 'worker') {
  const result = applyWorkspaceAction(record.task, action, receipts, source);
  if (!result.ok) throw new Error('code' in result ? result.code : 'DOMAIN_REJECTED');
  record.task = result.task;
}
function interrupt(record: WorkspaceRecord, run: WorkspaceRunRecord | undefined, action: WorkspaceActionRecord, outcome: 'blocked' | 'failed_before_submit' | 'unknown', reason: string, now: string) {
  const operation = run?.operation_id ?? 'intent:' + action.action_id;
  action.status = outcome;
  if (run) { run.status = outcome; run.reason = reason; run.updated_at = now; }
  if (!TERMINAL.has(record.task.stage) && !INTERRUPTED.has(record.task.stage)) {
    apply(record, { ...scope(record.task, `${operation}:interrupt:${record.task.state_version}`), type: 'interrupt', outcome: outcome === 'failed_before_submit' ? 'failed' : outcome, operation_id: operation, reason });
  }
  append(record, now, outcome === 'unknown' ? 'reconciliation_required' : 'execution_blocked', { action_id: action.action_id, run_id: run?.run_id ?? null, code: reason, state_version: record.task.state_version });
}
function finishAction(record: WorkspaceRecord, action: WorkspaceActionRecord, now: string) {
  action.status = 'succeeded';
  append(record, now, record.task.stage === 'completed' ? 'task_completed' : 'approval_required', { action_id: action.action_id, stage: record.task.stage, state_version: record.task.state_version });
}

function feedbackIntent(record: WorkspaceRecord, action: WorkspaceActionRecord): WorkspaceFeedbackIntent {
  const payload = action.payload as WorkspaceFeedbackIntent & { task_id?: string; content_revision?: string; index_id?: string; render_hash?: string };
  if (!payload || payload.task_id !== record.task.task_id || payload.content_revision !== record.task.snapshot.content_revision || !Array.isArray(payload.groups) || payload.groups.length < 1 || payload.groups.length > 10) throw new Error('INVALID_FEEDBACK_INTENT');
  if (action.type === 'feedback') {
    const manifest = record.review_manifest;
    if (!manifest || payload.task_id !== record.task.task_id || payload.content_revision !== record.task.snapshot.content_revision || payload.index_id !== manifest.index_id || payload.render_hash !== manifest.render_hash) throw new Error('STALE_FEEDBACK_INTENT');
    const { index_id, ...body } = manifest;
    if (buildWorkspaceReviewManifest(body).index_id !== index_id) throw new Error('INVALID_FEEDBACK_MANIFEST');
  }
  const used = new Set<string>();
  for (const group of payload.groups) {
    if (!str(group.instruction) || group.instruction.length > 4000 || !Array.isArray(group.text_slots) || !Array.isArray(group.assets ?? []) || group.text_slots.length + (group.assets?.length ?? 0) < 1) throw new Error('INVALID_FEEDBACK_INTENT');
    for (const entry of group.text_slots) {
      if (!record.content || !Object.hasOwn(record.content.slots, entry.slot) || hash(record.content.slots[entry.slot]) !== entry.text_hash || used.has('text:' + entry.slot)) throw new Error('STALE_FEEDBACK_INTENT');
      used.add('text:' + entry.slot);
    }
    for (const entry of group.assets ?? []) {
      const asset = record.task.snapshot.assets.find(asset => asset.canonical_slot === entry.canonical_slot && asset.revision_id === entry.artifact_revision);
      if (!asset || !record.artifacts.some(item => item.revision_id === entry.artifact_revision && item.sha256 === entry.sha256 && item.content_revision === record.task.snapshot.content_revision && item.kind === 'image' && item.verification === 'verified') || used.has('asset:' + entry.canonical_slot)) throw new Error('STALE_FEEDBACK_INTENT');
      used.add('asset:' + entry.canonical_slot);
    }
  }
  const referenceIds: string[] = [];
  for (const ids of [payload.reference_ids, ...payload.groups.map(group => group.reference_ids)]) {
    if (ids === undefined) continue;
    if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => !str(id) || id.length > 200) || new Set(ids).size !== ids.length) throw new Error('INVALID_FEEDBACK_REFERENCE');
    referenceIds.push(...ids);
  }
  for (const referenceId of new Set(referenceIds)) {
    const reference = record.references?.find(item => item.reference_id === referenceId);
    if (!reference || reference.removed_at || reference.purpose !== 'feedback' || reference.content_revision !== record.task.snapshot.content_revision
        || reference.technical_validation !== 'full_decode_passed' || (record.review_manifest && reference.review_index_id !== record.review_manifest.index_id)) throw new Error('STALE_FEEDBACK_REFERENCE');
  }
  if (used.size > 500) throw new Error('INVALID_FEEDBACK_INTENT');
  return clone(payload);
}
function prepareFeedback(record: WorkspaceRecord, action: WorkspaceActionRecord, now: string) {
  if (record.revision_plan && record.revision_plan.phase !== 'review_ready') throw new Error('REVISION_PLAN_IN_PROGRESS');
  const intent = feedbackIntent(record, action);
  const plan = createWorkspaceRevisionPlan(record, action.action_id, intent);
  const before = captureWorkspaceRevision(record, action.action_id, now);
  if (intent.groups.some(group => group.text_slots.length)) {
    const text = intent.groups.map(group => group.instruction).join('\n\n');
    if (text.length > 40000) throw new Error('FEEDBACK_BATCH_TOO_LARGE');
    apply(record, { ...scope(record.task, action.action_id), type: 'content_feedback', text }, [], 'user');
  } else {
    const index = workspaceFeedbackIndex(record.task);
    if (!index.ok) throw new Error('ASSET_INVENTORY_REQUIRED');
    apply(record, { ...scope(record.task, action.action_id), type: 'feedback', request: { index_id: index.index.index_id,
      blocks: intent.groups.map(group => ({ text: group.instruction, canonical_slots: group.assets!.map(asset => asset.canonical_slot) })) } }, [], 'user');
  }
  record.revision_plan = plan;
  if (!(record.revision_history ??= []).some(item => item.revision_id === before.revision_id)) record.revision_history.push(before);
}
function validateOutput(context: WorkspaceStageContext, output: WorkspaceStageOutput, verification: WorkspaceEvidenceVerification | null) {
  const { record, run } = context; const task = record.task; const receipt = output?.receipt;
  if (!receipt || receipt.kind !== RECEIPT_KINDS[run.stage] || receipt.task_id !== task.task_id || receipt.state_version !== task.state_version || receipt.snapshot_id !== task.snapshot.snapshot_id || receipt.content_revision !== task.snapshot.content_revision || !str(receipt.receipt_id) || !str(receipt.evidence_ref)
      || !Array.isArray(output.evidence_refs) || output.evidence_refs.length > 64 || !output.evidence_refs.includes(receipt.evidence_ref) || output.evidence_refs.some(ref => !str(ref))) throw new Error('INVALID_STAGE_RECEIPT');
  if (!verification || verification.verified !== true || verification.task_id !== task.task_id || verification.snapshot_id !== task.snapshot.snapshot_id || verification.state_version !== task.state_version || verification.receipt_id !== receipt.receipt_id
      || !Array.isArray(verification.evidence_refs) || !Array.isArray(verification.checks) || verification.checks.length > 128 || verification.evidence_refs.length > 128 || !output.evidence_refs.every(ref => verification.evidence_refs.includes(ref)) || !REQUIRED_CHECKS[run.stage].every(check => verification.checks.includes(check))) throw new Error('EVIDENCE_NOT_VERIFIED');
  if (run.stage === 'draft' && (receipt.snapshot?.canonical_version ?? task.snapshot.canonical_version) === 'unresolved') throw new Error('CANONICAL_NOT_PINNED');
  const nextSnapshot = receipt.snapshot ?? task.snapshot;
  const writesContent = run.stage === 'content_authoring' || run.stage === 'content_feedback';
  if (writesContent) {
    const content = output.content;
    if (!content || content.revision !== nextSnapshot.content_revision || !content.slots || !Object.keys(content.slots).length || Object.keys(content.slots).length > 500 || Object.values(content.slots).some(value => typeof value !== 'string' || value.length > 16000) || workspaceContentDigest(content.slots) !== nextSnapshot.content_digest || Buffer.byteLength(JSON.stringify(content)) > 1024 * 1024) throw new Error('INVALID_CONTENT_OUTPUT');
    if (run.stage === 'content_feedback') {
      const selected = new Set(context.feedback!.groups.flatMap(group => group.text_slots.map(entry => entry.slot)));
      const before = record.content!.slots;
      if (json(Object.keys(before).sort()) !== json(Object.keys(content.slots).sort()) || Object.keys(before).some(slot => !selected.has(slot) && before[slot] !== content.slots[slot]) || [...selected].some(slot => before[slot] === content.slots[slot])) throw new Error('FEEDBACK_SCOPE_CHANGED');
    }
  } else if (output.content !== undefined && json(output.content) !== json(record.content)) throw new Error('CONTENT_SCOPE_CHANGED');
  const artifacts = output.artifacts ?? [];
  if (!Array.isArray(artifacts) || artifacts.length > 200) throw new Error('INVALID_ARTIFACT_OUTPUT');
  const ids = new Set<string>();
  for (const artifact of artifacts) {
    if (!str(artifact.artifact_id) || ids.has(artifact.artifact_id) || !str(artifact.revision_id) || !str(artifact.storage_key) || !/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.content_revision !== nextSnapshot.content_revision || artifact.verification !== 'verified' || !Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 1 || artifact.size_bytes > 32 * 1024 * 1024) throw new Error('INVALID_ARTIFACT_OUTPUT');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(artifact.filename) || !['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/zip', 'text/html', 'text/plain', 'application/json'].includes(artifact.media_type)) throw new Error('INVALID_ARTIFACT_OUTPUT');
    if (artifact.kind === 'image' && (!Number.isSafeInteger(artifact.width) || !Number.isSafeInteger(artifact.height) || artifact.width! < 1 || artifact.height! < 1)) throw new Error('INVALID_IMAGE_DIMENSIONS');
    if ([...record.artifacts, ...artifacts].some(item => item.revision_id === artifact.revision_id && (item.sha256 !== artifact.sha256 || item.kind !== artifact.kind))) throw new Error('IMMUTABLE_ARTIFACT_REVISION_CHANGED');
    ids.add(artifact.artifact_id);
    // Immutable artifact IDs cannot be replaced, even by a newer provider output.
    const previous = record.artifacts.find(item => item.artifact_id === artifact.artifact_id);
    if (previous && json(previous) !== json(artifact)) throw new Error('IMMUTABLE_ARTIFACT_CHANGED');
  }
  const inventory = [...record.artifacts, ...artifacts];
  if (run.stage === 'assets' || run.stage === 'asset_feedback' || run.stage === 'assets_reuse') {
    if (!nextSnapshot.assets.length || nextSnapshot.assets.some(asset => !inventory.some(item => item.revision_id === asset.revision_id && item.content_revision === asset.content_revision && item.kind === 'image' && item.verification === 'verified'))) throw new Error('ACTUAL_ASSET_INVENTORY_REQUIRED');
    if (run.stage === 'asset_feedback') {
      const selected = new Set(context.feedback!.groups.flatMap(group => (group.assets ?? []).map(entry => entry.canonical_slot)));
      if (artifacts.some(item => item.kind === 'image' && !nextSnapshot.assets.some(asset => selected.has(asset.canonical_slot) && asset.revision_id === item.revision_id))) throw new Error('FEEDBACK_SCOPE_CHANGED');
    }
  }
  if (writesContent && artifacts.some(item => item.kind === 'image')) throw new Error('FEEDBACK_SCOPE_CHANGED');
  if (run.stage === 'assets_reuse') {
    const plan = context.revision_plan;
    if (!plan || plan.phase !== 'reusing_assets' || plan.revised_content_revision !== task.snapshot.content_revision
        || nextSnapshot.assets.length !== plan.source_snapshot.assets.length) throw new Error('REVISION_PLAN_SCOPE_CONFLICT');
    const expected = plan.source_snapshot.assets.map(asset => ({ ...asset, content_revision: task.snapshot.content_revision }));
    if (json(nextSnapshot.assets) !== json(expected)) throw new Error('REUSE_ASSET_SCOPE_CHANGED');
    for (const source of plan.source_assets) {
      const rebound = artifacts.find(file => file.kind === 'image' && file.revision_id === source.revision_id);
      if (!rebound || rebound.artifact_id === source.artifact_id || rebound.sha256 !== source.sha256 || rebound.storage_key !== source.storage_key
          || rebound.filename !== source.filename || rebound.media_type !== source.media_type || rebound.size_bytes !== source.size_bytes
          || rebound.width !== source.width || rebound.height !== source.height) throw new Error('REUSE_IMAGE_BYTES_CHANGED');
    }
    if (artifacts.some(file => file.kind === 'image' && !plan.source_assets.some(source => source.revision_id === file.revision_id))) throw new Error('REUSE_IMAGE_BYTES_CHANGED');
  }
  if (run.stage === 'packaging' && !artifacts.some(item => item.kind === 'package' && item.media_type === 'application/zip')) throw new Error('VERIFIED_PACKAGE_REQUIRED');
  const renderedManifest = output.review_manifest ?? output.preview?.manifest;
  if (output.preview && output.review_manifest && json(output.preview.manifest) !== json(output.review_manifest)) throw new Error('PREVIEW_MANIFEST_MISMATCH');
  if (output.preview && (!str(output.preview.html) || !str(output.preview.channel_nonce) || output.preview.status !== 'PREVIEW_REQUIRES_VISUAL_QA')) throw new Error('INVALID_PREVIEW_OUTPUT');
  if (renderedManifest) {
    const { index_id, ...body } = renderedManifest;
    const manifest = buildWorkspaceReviewManifest(body);
    if (manifest.index_id !== index_id || manifest.task_id !== task.task_id || manifest.content_revision !== nextSnapshot.content_revision) throw new Error('INVALID_PREVIEW_OUTPUT');
    if (['assets', 'asset_feedback', 'assets_reuse'].includes(run.stage) && nextSnapshot.assets.some(asset => !manifest.elements.some(element => element.kind === 'image' && element.canonical_slot === asset.canonical_slot && element.artifact_revision === asset.revision_id))) throw new Error('PREVIEW_ASSET_INVENTORY_MISMATCH');
    for (const element of manifest.elements) {
      if (element.kind === 'text' && hash((output.content ?? record.content)?.slots[element.slot] ?? '') !== element.text_hash) throw new Error('PREVIEW_CONTENT_MISMATCH');
      if (element.kind === 'image' && !nextSnapshot.assets.some(asset => asset.canonical_slot === element.canonical_slot && asset.revision_id === element.artifact_revision && inventory.some(item => item.revision_id === element.artifact_revision && item.sha256 === element.sha256 && item.content_revision === nextSnapshot.content_revision))) throw new Error('PREVIEW_ASSET_MISMATCH');
    }
  }
  if (['assets', 'asset_feedback', 'assets_reuse'].includes(run.stage) && !renderedManifest) throw new Error('ACTUAL_PREVIEW_REQUIRED');
  if (output.quality && (!Array.isArray(output.quality) || output.quality.length > 100 || output.quality.some(item => !str(item.name) || !['pending', 'passed', 'failed', 'blocked'].includes(item.status) || typeof item.detail !== 'string'))) throw new Error('INVALID_QUALITY_OUTPUT');
  if (output.quality?.some(item => item.status === 'passed' && (!verification.checks.includes(item.name) || item.name === 'human_artistic_review' && !validArtworkApproval(record, context.action)))) throw new Error('UNVERIFIED_QUALITY_LABEL');
  if (run.stage === 'review' && output.quality?.some(item => item.status !== 'passed')) throw new Error('QUALITY_GATE_NOT_PASSED');
  if (isApprovedArtworkStage(run.stage) && !approvedArtworkMatches(record, context.action, run.approved_artwork_identity, output)) throw new Error('APPROVED_ARTWORK_CHANGED');
}

/** User acceptance is evidence for the human gate only, never a semantic or
 * technical pass. Bind all current pixels and the reviewed rendered document. */
function validArtworkApproval(record: WorkspaceRecord, action: WorkspaceActionRecord) {
  const payload = action.payload as Record<string, unknown>;
  const manifest = record.review_manifest;
  if (action.type !== 'approve_artwork' || action.actor_id !== record.owner_id || !manifest || !record.task.snapshot.assets.length || record.task.pending_feedback || payload?.approval_source !== 'authenticated_user'
      || payload.snapshot_id !== record.task.snapshot.snapshot_id || payload.content_digest !== record.task.snapshot.content_digest || payload.review_index_id !== manifest.index_id || payload.render_hash !== manifest.render_hash || !Array.isArray(payload.assets)) return false;
  const { index_id, ...body } = manifest;
  if (buildWorkspaceReviewManifest(body).index_id !== index_id || manifest.task_id !== record.task.task_id || manifest.content_revision !== record.task.snapshot.content_revision) return false;
  const approved = payload.assets as Array<{ asset_id: string; canonical_slot: string; revision_id: string; sha256: string }>;
  if (approved.length !== record.task.snapshot.assets.length || new Set(approved.map(asset => asset.canonical_slot)).size !== approved.length) return false;
  return record.task.snapshot.assets.every(asset => {
    const item = approved.find(item => item.asset_id === asset.asset_id && item.canonical_slot === asset.canonical_slot && item.revision_id === asset.revision_id);
    return item && record.artifacts.some(file => file.revision_id === item.revision_id && file.content_revision === record.task.snapshot.content_revision && file.kind === 'image' && file.verification === 'verified' && file.sha256 === item.sha256)
      && manifest.elements.some(element => element.kind === 'image' && element.canonical_slot === asset.canonical_slot && element.artifact_revision === item.revision_id && element.sha256 === item.sha256);
  });
}


const isApprovedArtworkStage = (stage: WorkspaceRunnerStage) => stage === 'review' || stage === 'packaging';
/** The manifest hash covers exact slots, aliases, template and canonical identity.
 * Also pin cached preview HTML/CSS/nonce and current content/snapshot, rather than
 * trusting a provider to keep a claimed render_hash synchronized with new bytes. */
function artworkIdentity(record: WorkspaceRecord) {
  return hash(json({ snapshot: record.task.snapshot, content: record.content,
    review_manifest: record.review_manifest, preview: record.preview }));
}
function approvedArtworkMatches(record: WorkspaceRecord, action: WorkspaceActionRecord, identity: string | undefined, output?: WorkspaceStageOutput): boolean {
  try {
    if (!identity || !validArtworkApproval(record, action) || artworkIdentity(record) !== identity) return false;
    if (!output) return true;
    // QA and packaging can attest to the approved artwork, never replace it.
    // Even rehashed manifests with valid old pixels/words are a new render scope.
    if (output.review_manifest !== undefined && json(output.review_manifest) !== json(record.review_manifest)) return false;
    if (output.preview !== undefined && json(output.preview) !== json(record.preview)) return false;
    const prospective: WorkspaceRecord = { ...record,
      task: { ...record.task, snapshot: output.receipt.snapshot ?? record.task.snapshot },
      content: output.content === undefined ? record.content : output.content,
      review_manifest: output.review_manifest === undefined ? output.preview?.manifest ?? record.review_manifest : output.review_manifest,
      preview: output.preview === undefined ? record.preview : output.preview };
    return validArtworkApproval(prospective, action) && artworkIdentity(prospective) === identity;
  } catch { return false; }
}

export function createWorkspaceRunner(options: WorkspaceRunnerOptions) {
  const now = options.now ?? Date.now; const id = options.id ?? randomUUID;
  const workerId = options.workerId ?? 'worker:' + id();
  const leaseMs = options.leaseMs ?? 90_000; const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 10 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs >= leaseMs || !str(workerId)) throw new Error('INVALID_RUNNER_CONFIG');
  const stageTiming = clone(options.stageTiming ?? {});
  for (const [stage, timing] of Object.entries(stageTiming)) if (!Object.hasOwn(REQUIRED_CHECKS, stage) || !timing || !Number.isSafeInteger(timing.timeoutMs) || timing.timeoutMs < 1
    || timing.timeoutMs > 3_600_000 || !Number.isSafeInteger(timing.leaseMs) || timing.leaseMs <= timing.timeoutMs || timing.leaseMs > 5_400_000) throw new Error('INVALID_STAGE_TIMING');
  const timingFor = (stage: WorkspaceRunnerStage) => stageTiming[stage] ?? { timeoutMs, leaseMs };
  const adapters = options.adapters ?? {};
  const timestamp = () => new Date(now()).toISOString();
  function readiness() {
    const supplied = options.executionReadiness?.();
    const blockers = [...(supplied?.blockers ?? [])];
    if (!options.authorizeOwner) blockers.push({ code: 'MEMBERSHIP_VERIFIER_NOT_CONFIGURED', message: 'Current UID member authorization must be checked before each stage.' });
    if (!supplied?.ready) blockers.push({ code: 'EXECUTION_AUTHORIZATION_NOT_CONFIGURED', message: 'Provider access, approved data destinations and per-task budget enforcement must be configured.' });
    if ((options.environment ?? 'production') === 'production' && !options.store.productionReady) blockers.push({ code: 'DURABLE_PRODUCTION_STORE_REQUIRED', message: 'A reviewed shared durable production store is required.' });
    for (const stage of ['draft', 'research', 'content_authoring', 'assets', 'review', 'packaging'] as const) {
      if (!adapters[stage]?.execute || !adapters[stage]?.verifyEvidence) blockers.push({ code: 'ADAPTER_NOT_CONFIGURED', message: `Trusted ${stage} execution and evidence verification are not configured.` });
    }
    return { ready: blockers.length === 0, blockers };
  }
  type Claim = { kind: 'claim'; owner_id: string; record: WorkspaceRecord; action: WorkspaceActionRecord; run: WorkspaceRunRecord } | { kind: 'result'; result: WorkspaceRunnerResult };
  const result = (status: WorkspaceRunnerResult['status'], record?: WorkspaceRecord, action?: WorkspaceActionRecord, code?: string): Claim => ({ kind: 'result', result: { status, ...(record ? { task_id: record.task.task_id } : {}), ...(action ? { action_id: action.action_id } : {}), ...(code ? { code } : {}) } });
  async function currentAuthorization(ownerId: string) {
    let authorized = false; let authorizationTimer: ReturnType<typeof setTimeout> | undefined;
    try { authorized = await Promise.race([options.authorizeOwner?.(ownerId) ?? Promise.resolve(false), new Promise<boolean>(resolve => { authorizationTimer = setTimeout(() => resolve(false), Math.min(timeoutMs, 8000)); })]); }
    catch { /* Fail closed, retain no auth response or secrets. */ }
    finally { if (authorizationTimer) clearTimeout(authorizationTimer); }
    return authorized;
  }
  async function claim(ownerId: string): Promise<Claim> {
    const ready = readiness();
    const authorized = await currentAuthorization(ownerId);
    return options.store.transaction(ownerId, state => {
      const time = timestamp();
      for (const record of state.tasks) {
        const runs = record.runs ??= [];
        // An expired submitted attempt is never re-claimed. Even if a provider
        // honors idempotency keys, a trusted reconciliation must settle its result.
        for (const run of runs.filter(run => run.status === 'in_flight' && Date.parse(run.lease_expires_at) <= now())) {
          const action = record.actions.find(action => action.action_id === run.action_id)!;
          interrupt(record, run, action, 'unknown', 'EXPIRED_IN_FLIGHT_REQUIRES_RECONCILIATION', time);
          for (const pending of record.actions.filter(item => item.type === 'cancel' && item.status === 'queued')) pending.status = 'unknown';
          return result('unknown', record, action, run.reason);
        }
        const cancellation = record.actions.find(action => action.type === 'cancel' && action.status === 'queued');
        if (cancellation) {
          if (record.task.stage === 'unknown' || runs.some(run => run.status === 'unknown')) {
            cancellation.status = 'unknown'; return result('unknown', record, cancellation, 'RECONCILIATION_REQUIRED');
          }
          if (runs.some(run => run.status === 'in_flight')) continue; // Settle the real operation first.
          if (cancellation.actor_id !== ownerId) { interrupt(record, undefined, cancellation, 'blocked', 'INVALID_ACTION_ACTOR', time); return result('blocked', record, cancellation); }
          for (const run of runs.filter(run => run.status === 'claimed')) { run.status = 'cancelled'; run.updated_at = time; }
          for (const other of record.actions.filter(action => action.action_id !== cancellation.action_id && ['queued', 'running'].includes(action.status))) other.status = 'cancelled';
          if (!TERMINAL.has(record.task.stage)) apply(record, { ...scope(record.task, cancellation.action_id), type: 'cancel' }, [], 'user');
          cancellation.status = 'succeeded';
          append(record, time, 'task_cancelled', { action_id: cancellation.action_id, state_version: record.task.state_version });
          return result('cancelled', record, cancellation);
        }
        const action = record.actions.find(action => action.type !== 'cancel' && ['queued', 'running'].includes(action.status));
        if (!action) continue;
        if (runs.some(run => ['claimed', 'in_flight'].includes(run.status) && Date.parse(run.lease_expires_at) > now())) continue;
        if (TERMINAL.has(record.task.stage) || INTERRUPTED.has(record.task.stage)) {
          if (record.task.stage === 'completed' && action.type === 'feedback' && action.status === 'queued') { /* User explicitly reopens delivered work. */ }
          else if (record.task.stage === 'completed' && action.type === 'content_feedback' && action.status === 'queued') { /* Same. */ }
          else { action.status = record.task.stage === 'unknown' ? 'unknown' : record.task.stage === 'cancelled' ? 'cancelled' : 'blocked'; return result(action.status === 'unknown' ? 'unknown' : 'blocked', record, action, 'TASK_NOT_RUNNABLE'); }
        }
        if (!authorized) { interrupt(record, undefined, action, 'blocked', 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED', time); return result('blocked', record, action, 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED'); }
        if (!ready.ready) { interrupt(record, undefined, action, 'blocked', ready.blockers[0]?.code ?? 'EXECUTION_DISABLED', time); return result('blocked', record, action, 'EXECUTION_DISABLED'); }
        let approvedArtworkIdentity: string | undefined;
        if (action.status === 'queued') {
          if (action.actor_id !== ownerId || action.expected_state_version + 1 !== record.task.state_version || action.content_revision !== record.task.snapshot.content_revision) {
            interrupt(record, undefined, action, 'blocked', 'STALE_OR_UNAUTHORIZED_INTENT', time); return result('blocked', record, action, 'STALE_OR_UNAUTHORIZED_INTENT');
          }
          if (action.type === 'approve_content') {
            const payload = action.payload as Record<string, unknown>;
            if (record.task.stage !== 'content_review' || record.task.pending_feedback || payload?.approval_source !== 'authenticated_user' || payload.content_digest !== record.task.snapshot.content_digest || payload.snapshot_id !== record.task.snapshot.snapshot_id || record.content?.revision !== record.task.snapshot.content_revision || workspaceContentDigest(record.content.slots) !== record.task.snapshot.content_digest) {
              interrupt(record, undefined, action, 'blocked', 'APPROVAL_SCOPE_MISMATCH', time); return result('blocked', record, action, 'APPROVAL_SCOPE_MISMATCH');
            }
            const receipt: Receipt = { receipt_id: 'approval:' + action.action_id, task_id: record.task.task_id, state_version: record.task.state_version, snapshot_id: record.task.snapshot.snapshot_id,
              content_revision: record.task.snapshot.content_revision, kind: 'content_approved', evidence_ref: 'authenticated-action:' + action.action_id };
            apply(record, { ...scope(record.task, 'approval:' + action.action_id), type: 'advance', receipt_id: receipt.receipt_id }, [receipt]);
            (record.receipts ??= []).push(receipt);
            if (record.revision_plan?.phase === 'awaiting_content_approval') {
              if (record.revision_plan.revised_content_revision !== record.task.snapshot.content_revision) throw new Error('REVISION_PLAN_SCOPE_CONFLICT');
              record.revision_plan.phase = record.revision_plan.source_assets.length ? 'reusing_assets' : 'review_ready';
            }
            append(record, time, 'content_approved', { action_id: action.action_id, content_revision: record.task.snapshot.content_revision, state_version: record.task.state_version });
          } else if (action.type === 'approve_artwork') {
            if (record.task.stage !== 'review' || !validArtworkApproval(record, action)) {
              interrupt(record, undefined, action, 'blocked', 'ARTWORK_APPROVAL_SCOPE_MISMATCH', time); return result('blocked', record, action, 'ARTWORK_APPROVAL_SCOPE_MISMATCH');
            }
            approvedArtworkIdentity = artworkIdentity(record);
            append(record, time, 'artwork_approved', { action_id: action.action_id, snapshot_id: record.task.snapshot.snapshot_id, review_index_id: record.review_manifest!.index_id, state_version: record.task.state_version });
          } else if (action.type === 'feedback' || action.type === 'content_feedback') {
            try { prepareFeedback(record, action, time); }
            catch (error) { interrupt(record, undefined, action, 'blocked', error instanceof Error ? error.message : 'INVALID_FEEDBACK_INTENT', time); return result('blocked', record, action, 'FEEDBACK_NOT_EXECUTED'); }
          } else if (action.type !== 'start' || record.task.stage !== 'draft') {
            interrupt(record, undefined, action, 'blocked', 'START_REQUIRES_DRAFT', time); return result('blocked', record, action);
          }
          action.status = 'running';
        }
        if ((record.task.stage === 'content_review' || (record.task.stage === 'review' && action.type !== 'approve_artwork')) && !record.task.pending_feedback) { finishAction(record, action, time); return result('advanced', record, action); }
        const stage = record.task.stage === 'assets' && record.revision_plan?.phase === 'reusing_assets' ? 'assets_reuse' : record.task.pending_feedback?.kind === 'content' ? 'content_feedback' : record.task.pending_feedback?.kind === 'assets' ? 'asset_feedback' : record.task.stage as WorkspaceRunnerStage;
        if (isApprovedArtworkStage(stage)) {
          const reviewRun = runs.find(run => run.action_id === action.action_id && run.stage === 'review' && (stage === 'packaging' ? run.status === 'succeeded' : ['claimed', 'failed_before_submit'].includes(run.status)));
          approvedArtworkIdentity ??= reviewRun?.approved_artwork_identity;
          if (!approvedArtworkMatches(record, action, approvedArtworkIdentity)) {
            interrupt(record, undefined, action, 'blocked', 'APPROVED_ARTWORK_CHANGED', time); return result('blocked', record, action, 'APPROVED_ARTWORK_CHANGED');
          }
        }
        if (record.revision_plan?.source_references?.some(source => !record.references?.some(current => current.reference_id === source.reference_id && !current.removed_at && json(current) === json(source)))) {
          interrupt(record, undefined, action, 'blocked', 'REVISION_REFERENCE_CHANGED', time); return result('blocked', record, action, 'REVISION_REFERENCE_CHANGED');
        }
        if (!adapters[stage]) { interrupt(record, undefined, action, 'blocked', 'STAGE_ADAPTER_NOT_CONFIGURED', time); return result('blocked', record, action, 'STAGE_ADAPTER_NOT_CONFIGURED'); }
        const staleClaim = runs.find(run => run.action_id === action.action_id && run.status === 'claimed' && (run.expected_state_version !== record.task.state_version || run.snapshot_id !== record.task.snapshot.snapshot_id || run.content_revision !== record.task.snapshot.content_revision));
        if (staleClaim) { staleClaim.status = 'discarded'; staleClaim.reason = 'STALE_CLAIM'; interrupt(record, undefined, action, 'blocked', 'STALE_CLAIM', time); return result('discarded', record, action, 'STALE_CLAIM'); }
        let run = runs.find(run => run.action_id === action.action_id && run.status === 'claimed' && run.expected_state_version === record.task.state_version);
        const fence = Math.max(0, ...runs.map(run => run.fence)) + 1;
        if (run) { run.fence = fence; run.lease_owner = workerId; run.lease_expires_at = new Date(now() + timingFor(stage).leaseMs).toISOString(); run.updated_at = time; }
        else { run = { run_id: id(), operation_id: id(), action_id: action.action_id, stage, expected_state_version: record.task.state_version, snapshot_id: record.task.snapshot.snapshot_id,
          content_revision: record.task.snapshot.content_revision, ...(approvedArtworkIdentity ? { approved_artwork_identity: approvedArtworkIdentity } : {}), fence, status: 'claimed', lease_owner: workerId, lease_expires_at: new Date(now() + timingFor(stage).leaseMs).toISOString(), created_at: time, updated_at: time }; runs.push(run); }
        append(record, time, 'stage_claimed', { action_id: action.action_id, run_id: run.run_id, stage, fence: run.fence, state_version: record.task.state_version });
        return { kind: 'claim', owner_id: ownerId, record: clone(record), action: clone(action), run: clone(run) };
      }
      return result(state.tasks.some(record => record.actions.some(action => ['queued', 'running'].includes(action.status))) ? 'busy' : 'idle');
    });
  }
  function locate(state: { tasks: WorkspaceRecord[] }, claimed: Extract<Claim, { kind: 'claim' }>) {
    const record = state.tasks.find(record => record.task.task_id === claimed.record.task.task_id);
    const run = record?.runs?.find(run => run.run_id === claimed.run.run_id);
    const action = record?.actions.find(action => action.action_id === claimed.action.action_id);
    return record && run && action ? { record, run, action } : null;
  }
  const fenced = (run: WorkspaceRunRecord, claimed: Extract<Claim, { kind: 'claim' }>) => run.fence === claimed.run.fence && run.approved_artwork_identity === claimed.run.approved_artwork_identity && run.lease_owner === workerId && Date.parse(run.lease_expires_at) > now();
  function commitCompleted(record: WorkspaceRecord, run: WorkspaceRunRecord, action: WorkspaceActionRecord, output: WorkspaceStageOutput, time: string): WorkspaceRunnerResult {
      if (isApprovedArtworkStage(run.stage) && !approvedArtworkMatches(record, action, run.approved_artwork_identity, output)) {
        interrupt(record, run, action, 'blocked', 'APPROVED_ARTWORK_CHANGED', time); return { status: 'blocked', task_id: record.task.task_id, action_id: action.action_id, code: 'APPROVED_ARTWORK_CHANGED' };
      }
      if ((record.receipts ?? []).some(receipt => receipt.receipt_id === output.receipt.receipt_id)) {
        interrupt(record, run, action, 'blocked', 'DUPLICATE_RECEIPT', time); return { status: 'blocked', task_id: record.task.task_id, action_id: action.action_id, code: 'DUPLICATE_RECEIPT' };
      }
      const beforeRevision = record.revision_plan && ['content_feedback', 'assets_reuse', 'asset_feedback'].includes(run.stage) ? captureWorkspaceRevision(record, record.revision_plan.action_id, time) : null;
      try {
        apply(record, { ...scope(record.task, 'run:' + run.run_id), type: run.stage === 'content_feedback' ? 'revise_content' : run.stage === 'asset_feedback' ? 'revise_assets' : 'advance', receipt_id: output.receipt.receipt_id }, [output.receipt]);
      } catch {
        interrupt(record, run, action, 'blocked', 'DOMAIN_RECEIPT_REJECTED', time); return { status: 'blocked', task_id: record.task.task_id, action_id: action.action_id, code: 'DOMAIN_RECEIPT_REJECTED' };
      }
      if (beforeRevision && !(record.revision_history ??= []).some(item => item.revision_id === beforeRevision.revision_id)) record.revision_history.push(beforeRevision);
      (record.receipts ??= []).push(clone(output.receipt));
      if (output.content !== undefined && (run.stage === 'content_authoring' || run.stage === 'content_feedback')) {
        record.content = clone(output.content);
        // Older preview bindings cannot survive a newly authored content revision.
        record.preview = null; record.review_manifest = null;
      }
      for (const artifact of output.artifacts ?? []) if (!record.artifacts.some(item => item.artifact_id === artifact.artifact_id)) record.artifacts.push(clone(artifact));
      if (!isApprovedArtworkStage(run.stage)) {
        if (output.preview) { record.preview = clone(output.preview); record.review_manifest = clone(output.preview.manifest); }
        if (output.review_manifest) { record.review_manifest = clone(output.review_manifest); if (!output.preview) record.preview = null; }
      }
      if (['content_authoring', 'content_feedback', 'assets', 'asset_feedback', 'assets_reuse'].includes(run.stage)) record.quality = [];
      if (output.quality) record.quality = clone(output.quality);
      const plan = record.revision_plan;
      if (plan && run.stage === 'content_feedback') {
        plan.phase = 'awaiting_content_approval'; plan.revised_content_revision = record.task.snapshot.content_revision;
      }
      if (plan && run.stage === 'assets_reuse') {
        plan.reuse_evidence_refs = clone(output.evidence_refs);
        const groups = plan.intent.groups.filter(group => (group.assets?.length ?? 0) > 0);
        if (groups.length) {
          const index = workspaceFeedbackIndex(record.task);
          if (!index.ok) throw new Error('REVISION_PLAN_SCOPE_CONFLICT');
          apply(record, { ...scope(record.task, plan.action_id + ':retained-assets'), type: 'feedback', request: {
            index_id: index.index.index_id, blocks: groups.map(group => ({ text: group.instruction, canonical_slots: group.assets!.map(asset => asset.canonical_slot) }))
          } }, [], 'user');
          plan.phase = 'assets_pending';
          append(record, time, 'revision_assets_retained', { plan_id: plan.plan_id, source_snapshot_id: plan.source_snapshot.snapshot_id, content_revision: record.task.snapshot.content_revision });
        } else { plan.phase = 'review_ready'; plan.completed_snapshot_id = record.task.snapshot.snapshot_id; }
      }
      if (plan && (run.stage === 'asset_feedback' || run.stage === 'assets')) {
        plan.phase = 'review_ready'; plan.completed_snapshot_id = record.task.snapshot.snapshot_id;
      }
      run.status = 'succeeded'; run.updated_at = time;
      // Only unresolved operations retain a recovery input. Settled evidence,
      // original actions and immutable revision history keep the audit trail.
      delete run.input; delete run.input_action;
      append(record, time, 'stage_completed', { action_id: action.action_id, run_id: run.run_id, stage: run.stage, next_stage: record.task.stage, state_version: record.task.state_version });
      if (record.task.stage === 'content_review' || record.task.stage === 'review' && !record.task.pending_feedback && run.stage !== 'review' || record.task.stage === 'completed') finishAction(record, action, time);
      return { status: 'advanced', task_id: record.task.task_id, action_id: action.action_id };
  }
  async function runNext(ownerId: string): Promise<WorkspaceRunnerResult> {
    const claimed = await claim(ownerId);
    if (claimed.kind === 'result') return claimed.result;
    // Recheck revocation immediately before submission. A narrowly scoped worker
    // membership reader is required; never persist a browser JWT to keep work alive.
    const authorized = await currentAuthorization(ownerId);
    // Commit intent BEFORE invocation. A crash after this transaction and before
    // the call is still unknown: safety is preferable to duplicate paid effects.
    const submitted = await options.store.transaction(ownerId, state => {
      const located = locate(state, claimed);
      if (!located || !fenced(located.run, claimed) || located.run.status !== 'claimed' || located.action.status !== 'running' || located.record.task.state_version !== claimed.run.expected_state_version || located.record.actions.some(action => action.type === 'cancel' && action.status === 'queued')) return false;
      if (!authorized) { interrupt(located.record, located.run, located.action, 'blocked', 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED', timestamp()); return false; }
      if (isApprovedArtworkStage(located.run.stage) && !approvedArtworkMatches(located.record, located.action, located.run.approved_artwork_identity)) {
        interrupt(located.record, located.run, located.action, 'blocked', 'APPROVED_ARTWORK_CHANGED', timestamp()); return false;
      }
      if (json(executionInput(located.record)) !== json(executionInput(claimed.record))) {
        interrupt(located.record, located.run, located.action, 'blocked', 'EXECUTION_INPUT_CHANGED', timestamp()); return false;
      }
      const input = executionInput(located.record);
      if (Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024) {
        interrupt(located.record, located.run, located.action, 'blocked', 'EXECUTION_INPUT_TOO_LARGE', timestamp()); return false;
      }
      located.run.input = input;
      located.run.input_action = clone(located.action);
      located.run.input_identity = hash(json({ record: located.run.input, action: located.run.input_action }));
      located.run.status = 'in_flight'; located.run.updated_at = timestamp();
      append(located.record, timestamp(), 'stage_started', { action_id: located.action.action_id, run_id: located.run.run_id, stage: located.run.stage, state_version: located.record.task.state_version });
      return true;
    });
    if (!submitted) return { status: authorized ? 'discarded' : 'blocked', task_id: claimed.record.task.task_id, action_id: claimed.action.action_id, code: authorized ? 'CLAIM_FENCED' : 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED' };
    const controller = new AbortController();
    const context: WorkspaceStageContext = { owner_id: ownerId, record: { ...clone(claimed.record), references: selectedReferences(claimed.record) }, action: clone(claimed.action), run: { ...clone(claimed.run), status: 'in_flight' }, signal: controller.signal,
      ...(['content_feedback', 'asset_feedback'].includes(claimed.run.stage) ? { feedback: clone(claimed.record.revision_plan?.intent ?? claimed.action.payload as WorkspaceFeedbackIntent) } : {}),
      ...(claimed.record.revision_plan ? { revision_plan: clone(claimed.record.revision_plan) } : {}), references: selectedReferences(claimed.record),
      bindProviderOperation: async binding => {
        if (!str(binding?.reservation_id) || binding.reservation_id.length > 256 || !str(binding.provider) || binding.provider.length > 128 || !/^[a-f0-9]{64}$/.test(binding.request_sha256)) throw new Error('INVALID_PROVIDER_BINDING');
        await options.store.transaction(ownerId, state => {
          const located = locate(state, claimed);
          if (!located || !fenced(located.run, claimed) || located.run.status !== 'in_flight') throw new Error('PROVIDER_BINDING_FENCED');
          if (located.run.provider_binding && json(located.run.provider_binding) !== json(binding)) throw new Error('PROVIDER_BINDING_CONFLICT');
          located.run.provider_binding = clone(binding);
        });
      } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: WorkspaceStageOutcome;
    try {
      outcome = await Promise.race([
        (async (): Promise<WorkspaceStageOutcome> => {
          // The trusted adapter gets a separate copy, so mutations cannot alter
          // the runner's pinned scope or its before/after preservation checks.
          const adapterContext = { ...context, record: clone(context.record), action: clone(context.action), run: clone(context.run), feedback: context.feedback ? clone(context.feedback) : undefined, revision_plan: context.revision_plan ? clone(context.revision_plan) : undefined, references: clone(context.references) };
          const value = await adapters[claimed.run.stage]!.execute(adapterContext);
          if (!value || !['completed', 'blocked', 'failed_before_submit', 'unknown'].includes(value.outcome)) return { outcome: 'unknown', code: 'INVALID_ADAPTER_OUTCOME' };
          if (value.outcome !== 'completed') return clone(value);
          // Clone retained outputs before verification/commit. Mutable provider
          // objects cannot change a checked receipt after validation.
          const output = clone(value.output);
          try {
            const verification = await adapters[claimed.run.stage]!.verifyEvidence({ ...context, record: clone(context.record), action: clone(context.action), run: clone(context.run), feedback: context.feedback ? clone(context.feedback) : undefined, revision_plan: context.revision_plan ? clone(context.revision_plan) : undefined, references: clone(context.references) }, clone(output));
            validateOutput(context, output, verification);
          } catch { return { outcome: 'blocked', code: 'STAGE_EVIDENCE_REJECTED', provider_operation_id: value.provider_operation_id }; }
          return { ...value, output };
        })(),
        new Promise<WorkspaceStageOutcome>(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ outcome: 'unknown', code: 'STAGE_TIMEOUT_REQUIRES_RECONCILIATION' }); }, timingFor(claimed.run.stage).timeoutMs); }),
      ]);
    } catch { outcome = { outcome: 'unknown', code: 'STAGE_EXCEPTION_REQUIRES_RECONCILIATION' }; }
    finally { if (timer) clearTimeout(timer); }
    return options.store.transaction(ownerId, state => {
      const located = locate(state, claimed);
      if (!located || !fenced(located.run, claimed) || located.run.status !== 'in_flight') return { status: 'discarded', task_id: claimed.record.task.task_id, action_id: claimed.action.action_id, code: 'RESULT_FENCED' };
      const { record, run, action } = located; const time = timestamp();
      if (outcome.provider_operation_id && str(outcome.provider_operation_id)) run.provider_operation_id = outcome.provider_operation_id;
      if (workspaceChildrenUnsettled(run)) outcome = { outcome: 'unknown', code: 'CHILD_OPERATIONS_REQUIRE_RECONCILIATION' };
      if (run.artifact_intents?.some(value => value.status !== 'verified')) outcome = { outcome: 'unknown', code: 'ARTIFACT_WRITES_REQUIRE_RECONCILIATION' };
      if (outcome.outcome === 'unknown') {
        interrupt(record, run, action, 'unknown', /^[A-Z0-9_]{1,100}$/.test(outcome.code) ? outcome.code : 'PROVIDER_OUTCOME_UNKNOWN', time);
        for (const pending of record.actions.filter(item => item.type === 'cancel' && item.status === 'queued')) pending.status = 'unknown';
        return { status: 'unknown', task_id: record.task.task_id, action_id: action.action_id, code: run.reason };
      }
      const cancellation = record.actions.find(item => item.type === 'cancel' && item.status === 'queued');
      if (cancellation && cancellation.actor_id !== ownerId) {
        cancellation.status = 'blocked';
        append(record, time, 'invalid_cancellation_rejected', { action_id: cancellation.action_id, code: 'INVALID_ACTION_ACTOR' });
      }
      if (cancellation?.actor_id === ownerId) {
        run.status = 'discarded'; run.reason = 'CANCELLED_OUTPUT_DISCARDED'; run.updated_at = time; action.status = 'cancelled';
        apply(record, { ...scope(record.task, cancellation.action_id), type: 'cancel' }, [], 'user'); cancellation.status = 'succeeded';
        append(record, time, 'task_cancelled', { action_id: cancellation.action_id, run_id: run.run_id, state_version: record.task.state_version });
        return { status: 'cancelled', task_id: record.task.task_id, action_id: action.action_id };
      }
      if (record.task.state_version !== run.expected_state_version || record.task.snapshot.snapshot_id !== run.snapshot_id || record.task.snapshot.content_revision !== run.content_revision || action.status !== 'running') {
        run.status = 'discarded'; run.reason = 'STALE_OUTPUT_DISCARDED'; run.updated_at = time;
        interrupt(record, undefined, action, 'blocked', 'STALE_OUTPUT_DISCARDED', time);
        return { status: 'discarded', task_id: record.task.task_id, action_id: action.action_id, code: 'STALE_OUTPUT_DISCARDED' };
      }
      if (outcome.outcome !== 'completed') {
        interrupt(record, run, action, outcome.outcome, /^[A-Z0-9_]{1,100}$/.test(outcome.code) ? outcome.code : 'ADAPTER_BLOCKED', time);
        return { status: 'blocked', task_id: record.task.task_id, action_id: action.action_id, code: run.reason };
      }
      if (isApprovedArtworkStage(run.stage) && !approvedArtworkMatches(record, action, run.approved_artwork_identity, outcome.output)) {
        interrupt(record, run, action, 'blocked', 'APPROVED_ARTWORK_CHANGED', time); return { status: 'blocked', task_id: record.task.task_id, action_id: action.action_id, code: 'APPROVED_ARTWORK_CHANGED' };
      }
      if (json(executionInput(record)) !== json(run.input)) {
        interrupt(record, run, action, 'blocked', 'EXECUTION_INPUT_CHANGED', time); return { status: 'blocked', task_id: record.task.task_id, action_id: action.action_id, code: 'EXECUTION_INPUT_CHANGED' };
      }
      return commitCompleted(record, run, action, outcome.output, time);
    });
  }
  /** User may REQUEST a reconciliation, never attest to provider/accounting facts.
   * This method performs read/reconcile only; a new execute occurs on the normal
   * worker drain only after verified no-side-effect evidence has been committed. */
  function recoveryReadiness(stage: WorkspaceRunnerStage) {
    return !!options.authorizeOwner && !!options.reconcilers?.[stage]?.reconcile && !!options.reconcilers?.[stage]?.verifyEvidence && !!adapters[stage]?.verifyEvidence
      && ((options.environment ?? 'production') !== 'production' || options.store.productionReady);
  }
  async function reconcile(ownerId: string, taskId: string, runId: string, request: { expected_state_version: number; idempotency_key: string }): Promise<WorkspaceRunnerResult> {
    const response = (status: WorkspaceRunnerResult['status'], code: string): WorkspaceRunnerResult => ({ status, task_id: taskId, code });
    if (!str(ownerId) || !str(taskId) || !str(runId) || !Number.isSafeInteger(request?.expected_state_version) || !str(request?.idempotency_key) || request.idempotency_key.length > 200) return response('blocked', 'INVALID_RECOVERY_REQUEST');
    if ((options.environment ?? 'production') === 'production' && !options.store.productionReady) return response('blocked', 'DURABLE_PRODUCTION_STORE_REQUIRED');
    if (!await currentAuthorization(ownerId)) return response('blocked', 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED');
    const fingerprint = hash(json({ task_id: taskId, run_id: runId, expected_state_version: request.expected_state_version }));
    function scopeMatches(record: WorkspaceRecord, run: WorkspaceRunRecord, action: WorkspaceActionRecord) {
      if (!run.input || !run.input_action || !run.input_identity || hash(json({ record: run.input, action: run.input_action })) !== run.input_identity) return false;
      const before = run.input;
      if (record.revision_plan?.source_references?.some(source => !record.references?.some(current => current.reference_id === source.reference_id && !current.removed_at && json(current) === json(source)))) return false;
      return json({ snapshot: record.task.snapshot, pending: record.task.pending_feedback, approval: record.task.approval, content: record.content, manifest: record.review_manifest, preview: record.preview, artifacts: record.artifacts, plan: record.revision_plan, references: selectedReferences(record) })
        === json({ snapshot: before.task.snapshot, pending: before.task.pending_feedback, approval: before.task.approval, content: before.content, manifest: before.review_manifest, preview: before.preview, artifacts: before.artifacts, plan: before.revision_plan, references: before.references })
        && action.actor_id === run.input_action.actor_id && action.type === run.input_action.type && json(action.payload) === json(run.input_action.payload);
    }
    const claim = await options.store.transaction(ownerId, state => {
      const record = state.tasks.find(item => item.task.task_id === taskId);
      const run = record?.runs?.find(item => item.run_id === runId);
      const action = record?.actions.find(item => item.action_id === run?.action_id);
      if (!record || !run || !action) return { result: response('blocked', 'RECOVERY_RUN_NOT_FOUND') };
      const requests = run.recovery_requests ??= [];
      const previous = requests.find(item => item.idempotency_key === request.idempotency_key);
      if (previous && previous.fingerprint !== fingerprint) return { result: response('blocked', 'IDEMPOTENCY_CONFLICT') };
      if (previous && previous.status !== 'checking') return { result: { ...(previous.result ?? response('unknown', 'RECONCILIATION_REQUIRED')), duplicate: true } };
      if (requests.some(item => item.status === 'checking' && Date.parse(item.lease_expires_at) > now())) return { result: response('busy', 'RECONCILIATION_IN_PROGRESS') };
      if (record.task.state_version !== request.expected_state_version) return { result: response('blocked', 'STALE_RECOVERY_REQUEST') };
      if (!INTERRUPTED.has(record.task.stage) || record.task.interruption?.operation_id !== run.operation_id || !['unknown', 'blocked', 'failed_before_submit'].includes(run.status)) return { result: response('blocked', 'RECOVERY_NOT_REQUIRED') };
      if (!scopeMatches(record, run, action)) return { result: response('blocked', 'RECOVERY_SCOPE_CONFLICT') };
      if (!options.reconcilers?.[run.stage] || !adapters[run.stage]) return { result: response('blocked', 'RECONCILER_NOT_CONFIGURED') };
      if (!previous && requests.length >= 64) return { result: response('blocked', 'RECOVERY_REQUEST_LIMIT') };
      const time = timestamp();
      const journal: WorkspaceRecoveryRequest = previous ?? { request_id: id(), idempotency_key: request.idempotency_key, fingerprint, expected_state_version: request.expected_state_version,
        status: 'checking', fence: 0, lease_owner: workerId, lease_expires_at: time, created_at: time, updated_at: time };
      journal.status = 'checking'; journal.fence = Math.max(0, ...requests.map(item => item.fence)) + 1;
      journal.lease_owner = workerId; journal.lease_expires_at = new Date(now() + leaseMs).toISOString(); journal.updated_at = time;
      if (!previous) requests.push(journal);
      append(record, time, 'reconciliation_started', { run_id: runId, request_id: journal.request_id, operation_id: run.operation_id });
      return { record: clone(record), run: clone(run), action: clone(action), journal: clone(journal) };
    });
    if ('result' in claim) return claim.result!;
    const controller = new AbortController();
    const original: WorkspaceStageContext = { owner_id: ownerId, record: { ...clone(claim.record), ...clone(claim.run.input!) },
      action: clone(claim.run.input_action!), run: { ...clone(claim.run), status: 'in_flight' }, signal: controller.signal,
      ...(['content_feedback', 'asset_feedback'].includes(claim.run.stage) ? { feedback: clone(claim.run.input!.revision_plan?.intent ?? claim.run.input_action!.payload as WorkspaceFeedbackIntent) } : {}),
      ...(claim.run.input!.revision_plan ? { revision_plan: clone(claim.run.input!.revision_plan) } : {}), references: clone(claim.run.input!.references) };
    const context: WorkspaceRecoveryContext = { original, request_id: claim.journal.request_id, request_fence: claim.journal.fence, provider_binding: clone(claim.run.provider_binding), input_identity: claim.run.input_identity!, signal: controller.signal };
    const copyContext = (): WorkspaceRecoveryContext => ({ ...context, original: { ...original, record: clone(original.record), action: clone(original.action), run: clone(original.run), feedback: clone(original.feedback), revision_plan: clone(original.revision_plan), references: clone(original.references) }, provider_binding: clone(context.provider_binding) });
    let outcome: WorkspaceRecoveryOutcome; let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      outcome = await Promise.race([
        (async (): Promise<WorkspaceRecoveryOutcome> => {
          if (!await currentAuthorization(ownerId)) return { outcome: 'unknown', code: 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED' };
          const reconciler = options.reconcilers![claim.run.stage]!;
          const value = clone(await reconciler.reconcile(copyContext()));
          if (!value || !['completed', 'no_side_effect', 'unknown'].includes(value.outcome)) return { outcome: 'unknown', code: 'INVALID_RECONCILIATION_OUTCOME' };
          if (value.outcome === 'unknown') return value;
          const proof = value.proof;
          if (!proof || proof.operation_fenced !== true || proof.owner_id !== ownerId || proof.task_id !== taskId || proof.run_id !== runId || proof.operation_id !== claim.run.operation_id || proof.input_identity !== claim.run.input_identity
              || json(proof.provider_binding) !== json(claim.run.provider_binding) || !Array.isArray(proof.evidence_refs) || !proof.evidence_refs.length || proof.evidence_refs.length > 64 || proof.evidence_refs.some(ref => !str(ref) || ref.length > 1000)
              || !str(proof.accounting_evidence_ref) || !proof.evidence_refs.includes(proof.accounting_evidence_ref)
              || !['settled', 'released', 'not_reserved'].includes(proof.accounting)
              || (claim.run.provider_binding && proof.accounting === 'not_reserved')
              || (value.outcome === 'completed' && claim.run.provider_binding && proof.accounting !== 'settled')
              || (value.outcome === 'no_side_effect' && claim.run.provider_binding && proof.accounting !== 'released')
              || !workspaceValidateChildRecovery(claim.run, proof.child_operations, value.outcome)
              || await reconciler.verifyEvidence(copyContext(), clone(value)) !== true) return { outcome: 'unknown', code: 'RECONCILIATION_EVIDENCE_REJECTED' };
          if (value.outcome === 'completed') {
            const adapter = adapters[claim.run.stage]!;
            const verification = await adapter.verifyEvidence(copyContext().original, clone(value.output));
            validateOutput(original, value.output, verification);
            if (isApprovedArtworkStage(claim.run.stage) && !approvedArtworkMatches(original.record, original.action, claim.run.approved_artwork_identity, value.output)) return { outcome: 'unknown', code: 'APPROVED_ARTWORK_CHANGED' };
          }
          return value;
        })(),
        new Promise<WorkspaceRecoveryOutcome>(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ outcome: 'unknown', code: 'RECONCILIATION_TIMEOUT' }); }, timeoutMs); }),
      ]);
    } catch { outcome = { outcome: 'unknown', code: 'RECONCILIATION_EVIDENCE_REJECTED' }; }
    finally { if (timer) clearTimeout(timer); }
    const authorized = await currentAuthorization(ownerId);
    return options.store.transaction(ownerId, state => {
      const record = state.tasks.find(item => item.task.task_id === taskId);
      const run = record?.runs?.find(item => item.run_id === runId);
      const action = record?.actions.find(item => item.action_id === run?.action_id);
      const journal = run?.recovery_requests?.find(item => item.request_id === claim.journal.request_id);
      if (!record || !run || !action || !journal || journal.status !== 'checking' || journal.fence !== claim.journal.fence || journal.lease_owner !== workerId || Date.parse(journal.lease_expires_at) <= now()) return response('discarded', 'RECONCILIATION_FENCED');
      const time = timestamp();
      const stop = (code: string, status: 'unknown' | 'blocked' = 'unknown') => {
        journal.status = status; journal.updated_at = time; journal.result = response(status, code);
        append(record, time, 'reconciliation_unresolved', { run_id: runId, request_id: journal.request_id, code }); return journal.result;
      };
      if (!authorized) return stop('CURRENT_MEMBER_AUTHORIZATION_REQUIRED', 'blocked');
      if (record.task.state_version !== request.expected_state_version || record.task.interruption?.operation_id !== run.operation_id || !scopeMatches(record, run, action)) return stop('RECOVERY_SCOPE_CONFLICT', 'blocked');
      if (outcome.outcome === 'unknown') return stop(/^[A-Z0-9_]{1,100}$/.test(outcome.code) ? outcome.code : 'RECONCILIATION_REQUIRED');
      if (run.artifact_intents?.some(intent => intent.status !== 'verified')) return stop('ARTIFACT_WRITES_REQUIRE_RECONCILIATION');
      if (!workspaceValidateChildRecovery(run, outcome.proof.child_operations, outcome.outcome)) return stop('CHILD_RECOVERY_EVIDENCE_CHANGED');
      const next = clone(record); const nextRun = next.runs!.find(item => item.run_id === runId)!; const nextAction = next.actions.find(item => item.action_id === action.action_id)!;
      for (const child of nextRun.child_operations ?? []) {
        const proof = outcome.proof.child_operations!.find(value => value.operation_id === child.operation_id)!;
        child.report = clone(proof.report); child.status = proof.report.outcome === 'completed' ? 'completed' : 'failed'; child.updated_at = time;
      }
      const recovery: Receipt = { receipt_id: 'recovery:' + journal.request_id, task_id: taskId, state_version: next.task.state_version, content_revision: next.task.snapshot.content_revision,
        snapshot_id: next.task.snapshot.snapshot_id, kind: next.task.stage === 'unknown' ? 'reconciled' : 'recovery_verified', evidence_ref: outcome.proof.evidence_refs[0], operation_id: run.operation_id };
      apply(next, { ...scope(next.task, recovery.receipt_id), type: 'recover', receipt_id: recovery.receipt_id }, [recovery]);
      (next.receipts ??= []).push(recovery); nextAction.status = 'running';
      let result: WorkspaceRunnerResult;
      const cancellation = next.actions.find(item => item.type === 'cancel' && ['unknown', 'queued'].includes(item.status) && item.actor_id === ownerId);
      if (cancellation) {
        apply(next, { ...scope(next.task, cancellation.action_id), type: 'cancel' }, [], 'user');
        cancellation.status = 'succeeded'; nextAction.status = 'cancelled'; nextRun.status = 'discarded'; nextRun.reason = 'CANCELLED_OUTPUT_DISCARDED';
        result = { status: 'cancelled', task_id: taskId, action_id: action.action_id };
      } else if (outcome.outcome === 'completed') {
        const output = clone(outcome.output);
        // Retain original provider receipt identity/evidence. Only its envelope is
        // rebased after verified recovery, never its snapshot/content or output.
        output.receipt = { ...output.receipt, state_version: next.task.state_version };
        result = commitCompleted(next, nextRun, nextAction, output, time);
        if (result.status !== 'advanced') return stop(result.code ?? 'RECOVERED_OUTPUT_REJECTED');
        if (outcome.provider_operation_id) nextRun.provider_operation_id = outcome.provider_operation_id;
      } else {
        nextRun.status = 'failed_before_submit'; nextRun.reason = 'RECONCILED_NO_SIDE_EFFECT'; nextRun.updated_at = time;
        // The old operation remains permanently fenced. The next worker claim
        // creates a NEW operation, budget reservation and authorization check.
        result = { status: 'advanced', task_id: taskId, action_id: action.action_id, code: 'SAFE_NEW_ATTEMPT_READY' };
      }
      for (const cancellation of next.actions.filter(item => item.type === 'cancel' && item.status === 'unknown')) cancellation.status = 'queued';
      delete nextRun.input; delete nextRun.input_action;
      const committedJournal = nextRun.recovery_requests!.find(item => item.request_id === journal.request_id)!;
      committedJournal.status = 'recovered'; committedJournal.proof = clone(outcome.proof); committedJournal.result = result; committedJournal.updated_at = time;
      append(next, time, 'reconciliation_completed', { run_id: runId, request_id: journal.request_id, outcome: outcome.outcome, evidence_refs: outcome.proof.evidence_refs, state_version: next.task.state_version });
      Object.assign(record, next); return result;
    });
  }
  async function drainOwner(ownerId: string, maxSteps = 32) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 1000) throw new Error('INVALID_DRAIN_LIMIT');
    const results: WorkspaceRunnerResult[] = [];
    for (let count = 0; count < maxSteps; count++) {
      const value = await runNext(ownerId); results.push(value);
      if (value.status === 'idle' || value.status === 'busy') break;
    }
    return results;
  }
  return { runNext, drainOwner, readiness, reconcile, recoveryReadiness };
}

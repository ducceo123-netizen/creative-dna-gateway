import { buildFeedbackIndex, resolveFeedbackBlocks, type ResolvedFeedbackBlock } from './uid-brands-feedback-index.ts';

/** Offline domain contract, NOT an authorization boundary or an API handler.
 * The server must authenticate ownership, validate all untrusted input, load task and
 * receipts itself, verify evidence with its provider/QA/approval adapters, then commit
 * state + idempotency record + outbox atomically using expected_state_version CAS.
 * Never deserialize a client-supplied Task/Receipt into authoritative state. Receipt
 * references and content digests are correlation identifiers, not proof or EO checks.
 */
export type WorkStage = 'draft' | 'research' | 'content_authoring' | 'content_review' | 'assets' | 'review' | 'packaging' | 'completed';
export type TaskStage = WorkStage | 'blocked' | 'failed' | 'unknown' | 'cancelled';
export type AssetRevision = Readonly<{
  asset_id: string;
  canonical_slot: string;
  revision_id: string;
  content_revision: string;
  label: string;
}>;
export type TaskSnapshot = Readonly<{
  snapshot_id: string;
  canonical_version: string;
  content_revision: string;
  content_digest: string;
  assets: readonly AssetRevision[];
}>;
export type Task = Readonly<{
  task_id: string;
  branch: 'onepage-system';
  stage: TaskStage;
  state_version: number;
  snapshot: TaskSnapshot;
  pending_feedback?: Readonly<{ action_id: string; kind: 'content' | 'assets'; snapshot_id: string; canonical_slots: readonly string[]; text?: string }>;
  approval?: Readonly<{ receipt_id: string; content_revision: string; content_digest: string }>;
  interruption?: Readonly<{ resume_stage: WorkStage; operation_id: string; reason: string }>;
  feedback: readonly Readonly<{ action_id: string; content_revision: string; blocks: readonly ResolvedFeedbackBlock[] }>[];
  applied: readonly Readonly<{ action_id: string; fingerprint: string }>[];
  consumed_receipts: readonly string[];
}>;
export type ReceiptKind = 'brief_accepted' | 'research_complete' | 'content_ready' | 'assets_revised' | 'content_approved' | 'assets_complete' | 'review_passed' | 'package_verified' | 'content_revised' | 'reconciled' | 'recovery_verified';
/** Only trusted adapters may produce these records after actual evidence verification.
 * evidence_ref identifies retained evidence, including the applicable EO rubric for QA.
 * A string being present does not verify that evidence; this module cannot do so.
 */
export type Receipt = Readonly<{
  receipt_id: string;
  task_id: string;
  state_version: number;
  content_revision: string;
  snapshot_id: string;
  kind: ReceiptKind;
  evidence_ref: string;
  snapshot?: TaskSnapshot;
  operation_id?: string;
  feedback_action_id?: string;
}>;
type Scope = { action_id: string; task_id: string; content_revision: string; expected_state_version: number };
/** Domain commands, not a public client action allowlist. Worker commands advance
 * autonomously; content_approved must originate from an authenticated user approval
 * persisted by the adapter, never from model self-approval. */
export type TaskAction = Scope & (
  | { type: 'advance'; receipt_id: string }
  | { type: 'revise_content'; receipt_id: string }
  | { type: 'revise_assets'; receipt_id: string }
  | { type: 'content_feedback'; text: string }
  | { type: 'feedback'; request: unknown }
  | { type: 'interrupt'; outcome: 'blocked' | 'failed' | 'unknown'; operation_id: string; reason: string }
  | { type: 'recover'; receipt_id: string }
  | { type: 'cancel' }
);
export type TaskResult = { ok: true; task: Task; duplicate: boolean } | { ok: false; code: string };
const nonempty = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s === s.trim();
const fail = (code: string): TaskResult => ({ ok: false, code });
const terminal = (stage: TaskStage) => stage === 'completed' || stage === 'cancelled';
const interrupted = (stage: TaskStage) => stage === 'blocked' || stage === 'failed' || stage === 'unknown';
const transitions: Partial<Record<WorkStage, { kind: ReceiptKind; next: WorkStage }>> = {
  draft: { kind: 'brief_accepted', next: 'research' },
  research: { kind: 'research_complete', next: 'content_authoring' },
  content_authoring: { kind: 'content_ready', next: 'content_review' },
  content_review: { kind: 'content_approved', next: 'assets' },
  assets: { kind: 'assets_complete', next: 'review' },
  review: { kind: 'review_passed', next: 'packaging' },
  packaging: { kind: 'package_verified', next: 'completed' },
};

function validSnapshot(task_id: string, snapshot: TaskSnapshot): boolean {
  if (![snapshot.snapshot_id, snapshot.canonical_version, snapshot.content_revision, snapshot.content_digest].every(nonempty)) return false;
  if (!Array.isArray(snapshot.assets) || snapshot.assets.length > 100) return false;
  if (snapshot.assets.some(a => ![a.asset_id, a.canonical_slot, a.revision_id, a.label].every(nonempty) || a.content_revision !== snapshot.content_revision)) return false;
  if (!snapshot.assets.length) return true;
  return buildFeedbackIndex({ task_id, stage: 'review', branch: 'onepage-system', content_version: snapshot.content_revision, assets: snapshot.assets }).ok;
}

export function createWorkspaceTask(task_id: string, snapshot: TaskSnapshot): Task {
  if (!nonempty(task_id) || !validSnapshot(task_id, snapshot)) throw new Error('invalid_task_snapshot');
  return structuredClone({ task_id, branch: 'onepage-system' as const, stage: 'draft' as const, state_version: 0, snapshot, feedback: [], applied: [], consumed_receipts: [] });
}

/** The index includes immutable artifact revision IDs so replacing a rendition invalidates selectors. */
export function workspaceFeedbackIndex(task: Task) {
  return buildFeedbackIndex({ task_id: task.task_id, stage: task.stage, branch: task.branch,
    content_version: task.snapshot.content_revision, retry_id: task.snapshot.snapshot_id,
    assets: task.snapshot.assets.map(a => ({ ...a, asset_id: `${encodeURIComponent(a.asset_id)}@${encodeURIComponent(a.revision_id)}` })),
  });
}

// Stable JSON comparison for idempotency, not a cryptographic signature. Reject non-JSON input.
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  throw new Error('invalid_json');
}

/** Resolve receipts from a server-loaded ledger, never from action JSON. No side effects.
 * Returned success records intent/state only; it does not dispatch generation or publish.
 * Retry an exact accepted action returns current state without a second transition.
 */
export function applyWorkspaceAction(task: Task, action: TaskAction, receipts: readonly Receipt[], source: 'user' | 'worker'): TaskResult {
  // Source is supplied by the authenticated server route/worker, NEVER action JSON.
  const requiredSource = ['feedback', 'content_feedback', 'cancel'].includes(action.type) ? 'user' : 'worker';
  if (source !== requiredSource) return fail('wrong_command_source');
  if (![action.action_id, action.task_id, action.content_revision].every(nonempty) || !Number.isSafeInteger(action.expected_state_version)) return fail('invalid_action');
  if (action.task_id !== task.task_id) return fail('wrong_task');
  let fingerprint: string;
  try { fingerprint = canonical(action); } catch { return fail('invalid_action'); }
  const previous = task.applied.find(a => a.action_id === action.action_id);
  if (previous) return previous.fingerprint === fingerprint ? { ok: true, task, duplicate: true } : fail('idempotency_conflict');
  if (action.content_revision !== task.snapshot.content_revision || action.expected_state_version !== task.state_version) return fail('stale_action');
  // Explicit feedback after delivery reopens review, preserving the delivered snapshot
  // in immutable storage. Cancellation remains terminal; no silent auto-reopen.
  if (terminal(task.stage) && !(task.stage === 'completed' && ['feedback', 'content_feedback'].includes(action.type))) return fail('terminal_task');
  let next: Task = task;
  let receipt: Receipt | undefined;
  if ('receipt_id' in action) {
    const matches = receipts.filter(r => r.receipt_id === action.receipt_id);
    if (matches.length !== 1) return fail('missing_or_ambiguous_receipt');
    receipt = matches[0];
    if (task.consumed_receipts.includes(receipt.receipt_id)) return fail('receipt_consumed');
    if (receipt.task_id !== task.task_id || receipt.state_version !== task.state_version || receipt.content_revision !== task.snapshot.content_revision || receipt.snapshot_id !== task.snapshot.snapshot_id || !nonempty(receipt.evidence_ref)) return fail('receipt_scope_mismatch');
  }
  switch (action.type) {
    case 'advance': {
      if (interrupted(task.stage)) return fail('recovery_required');
      if (task.pending_feedback) return fail('feedback_unresolved');
      const step = transitions[task.stage as WorkStage];
      if (!step || receipt!.kind !== step.kind) return fail('wrong_stage_receipt');
      if (['assets', 'review', 'packaging'].includes(task.stage) && (!task.approval || task.approval.content_revision !== task.snapshot.content_revision || task.approval.content_digest !== task.snapshot.content_digest)) return fail('content_approval_required');
      if (task.stage === 'draft' && task.snapshot.canonical_version === 'unresolved') {
        const s = receipt!.snapshot;
        // Resolve the exact canonical contract before research; it may not rewrite
        // the user's brief or pretend generated content/assets already exist.
        if (!s || !validSnapshot(task.task_id, s) || s.canonical_version === 'unresolved' || s.snapshot_id === task.snapshot.snapshot_id || s.content_revision !== task.snapshot.content_revision || s.content_digest !== task.snapshot.content_digest || s.assets.length) return fail('canonical_pin_required');
        next = { ...next, snapshot: s };
      } else if (task.stage === 'content_authoring') {
        const s = receipt!.snapshot;
        if (!s || !validSnapshot(task.task_id, s) || s.assets.length || s.snapshot_id === task.snapshot.snapshot_id || s.content_revision === task.snapshot.content_revision || s.content_digest === task.snapshot.content_digest || s.canonical_version !== task.snapshot.canonical_version) return fail('invalid_initial_content');
        next = { ...next, snapshot: s, approval: undefined };
      } else if (receipt!.snapshot) {
        const s = receipt!.snapshot;
        if (task.stage !== 'assets' || !validSnapshot(task.task_id, s) || s.snapshot_id === task.snapshot.snapshot_id || s.content_revision !== task.snapshot.content_revision || s.content_digest !== task.snapshot.content_digest || s.canonical_version !== task.snapshot.canonical_version) return fail('invalid_asset_snapshot');
        next = { ...next, snapshot: s };
      }
      if (['assets', 'review', 'packaging'].includes(task.stage) && !next.snapshot.assets.length) return fail('asset_inventory_required');
      next = { ...next, stage: step.next };
      if (task.stage === 'content_review') next = { ...next, approval: { receipt_id: receipt!.receipt_id, content_revision: task.snapshot.content_revision, content_digest: task.snapshot.content_digest } };
      break;
    }
    case 'revise_content': {
      if (interrupted(task.stage)) return fail('recovery_required');
      const s = receipt!.snapshot;
      if (receipt!.kind !== 'content_revised' || !s || !validSnapshot(task.task_id, s) || s.snapshot_id === task.snapshot.snapshot_id || s.content_revision === task.snapshot.content_revision || s.content_digest === task.snapshot.content_digest || s.canonical_version !== task.snapshot.canonical_version) return fail('invalid_content_revision');
      if (['draft', 'research', 'content_authoring'].includes(task.stage)) return fail('research_required');
      if (s.assets.length) return fail('content_revision_requires_fresh_assets');
      if (task.pending_feedback && (task.pending_feedback.kind !== 'content' || receipt!.feedback_action_id !== task.pending_feedback.action_id)) return fail('feedback_receipt_mismatch');
      next = { ...task, stage: 'content_review', snapshot: s, approval: undefined, pending_feedback: undefined };
      break;
    }
    case 'content_feedback': {
      if (!['content_review', 'review', 'packaging', 'completed'].includes(task.stage)) return fail('feedback_stage_required');
      if (task.pending_feedback) return fail('feedback_unresolved');
      if (!nonempty(action.text) || action.text.length > 40000) return fail('invalid_feedback');
      next = { ...task, stage: 'content_review', approval: undefined, pending_feedback: { action_id: action.action_id, kind: 'content', snapshot_id: task.snapshot.snapshot_id, canonical_slots: [], text: action.text },
        feedback: [...task.feedback, { action_id: action.action_id, content_revision: action.content_revision, blocks: [{ text: action.text, asset_ids: [], ordinals: [] }] }] };
      break;
    }
    case 'revise_assets': {
      if (task.stage !== 'review' || task.pending_feedback?.kind !== 'assets') return fail('asset_feedback_required');
      const s = receipt!.snapshot;
      if (receipt!.kind !== 'assets_revised' || receipt!.feedback_action_id !== task.pending_feedback.action_id) return fail('feedback_receipt_mismatch');
      if (!s || !validSnapshot(task.task_id, s) || s.snapshot_id === task.snapshot.snapshot_id || s.content_revision !== task.snapshot.content_revision || s.content_digest !== task.snapshot.content_digest || s.canonical_version !== task.snapshot.canonical_version || s.assets.length !== task.snapshot.assets.length) return fail('invalid_asset_snapshot');
      for (const before of task.snapshot.assets) {
        const after = s.assets.find(a => a.canonical_slot === before.canonical_slot);
        if (!after || after.asset_id !== before.asset_id) return fail('asset_scope_changed');
        if (task.pending_feedback.canonical_slots.includes(before.canonical_slot)) {
          if (after.revision_id === before.revision_id) return fail('selected_asset_not_revised');
        } else if (canonical(before) !== canonical(after)) return fail('unselected_asset_changed');
      }
      // QA for the old snapshot cannot satisfy this new review/state version.
      next = { ...task, snapshot: s, pending_feedback: undefined };
      break;
    }
    case 'feedback': {
      if (!['review', 'packaging', 'completed'].includes(task.stage)) return fail('feedback_stage_required');
      if (task.pending_feedback) return fail('feedback_unresolved');
      const index = workspaceFeedbackIndex(task);
      if (!index.ok) return fail(index.code);
      const result = resolveFeedbackBlocks(index.index, action.request);
      if (!result.ok) return fail(result.code);
      const ids = new Set(result.blocks.flatMap(b => b.asset_ids));
      const selected = task.snapshot.assets.filter(a => ids.has(`${encodeURIComponent(a.asset_id)}@${encodeURIComponent(a.revision_id)}`)).map(a => a.canonical_slot);
      next = { ...task, stage: 'review', pending_feedback: { action_id: action.action_id, kind: 'assets', snapshot_id: task.snapshot.snapshot_id, canonical_slots: selected }, feedback: [...task.feedback, { action_id: action.action_id, content_revision: action.content_revision, blocks: result.blocks }] };
      break;
    }
    case 'interrupt':
      if (interrupted(task.stage)) return fail('recovery_required');
      if (!['blocked', 'failed', 'unknown'].includes(action.outcome) || !nonempty(action.operation_id) || !nonempty(action.reason)) return fail('invalid_interruption');
      next = { ...task, stage: action.outcome, interruption: { resume_stage: task.stage as WorkStage, operation_id: action.operation_id, reason: action.reason } };
      break;
    case 'recover':
      if (!interrupted(task.stage) || !task.interruption) return fail('not_interrupted');
      if (receipt!.kind !== (task.stage === 'unknown' ? 'reconciled' : 'recovery_verified') || receipt!.operation_id !== task.interruption.operation_id) return fail('reconciliation_required');
      // Resume the interrupted stage only. A successful provider result still needs its
      // normal stage receipt. Reconciliation must establish a safe, non-duplicating next step.
      next = { ...task, stage: task.interruption.resume_stage, interruption: undefined };
      break;
    case 'cancel':
      // Cancelling UI intent cannot cancel or conceal a provider operation of unknown outcome.
      if (task.stage === 'unknown') return fail('reconciliation_required');
      next = { ...task, stage: 'cancelled' };
      break;
    default: return fail('invalid_action');
  }
  return { ok: true, duplicate: false, task: structuredClone({ ...next, state_version: task.state_version + 1,
    applied: [...task.applied, { action_id: action.action_id, fingerprint }],
    consumed_receipts: receipt ? [...task.consumed_receipts, receipt.receipt_id] : task.consumed_receipts,
  }) };
}

import { createHash } from 'node:crypto';
import type { WorkspaceStore, WorkspaceOwnerState } from './uid-workspace-store.ts';
import type { WorkspaceStageContext, WorkspaceRunRecord } from './uid-workspace-runner.ts';
import type { WorkspaceProviderBinding } from './uid-workspace-recovery.ts';

/** A stage can have separate author, image and independent reviewer operations.
 * This journal provides durable identity/fencing, NOT spending authorization or
 * exactly-once provider semantics. Every transport still reserves the SAME shared
 * project/member/task budget and rechecks guardDispatch at the actual I/O boundary.
 * Only reviewed server adapters receive this capability. No HTTP route exposes it.
 */
export type WorkspaceChildIntent = {
  key: string; role: 'research' | 'author' | 'image_generator' | 'independent_reviewer';
  provider: string; model: string; input_sha256: string;
};
export type WorkspaceChildReport = {
  outcome: 'completed' | 'failed_before_submit' | 'known_failure' | 'unknown';
  accounting: 'not_reserved' | 'released' | 'held' | 'settled' | 'pending_reconciliation';
  request_sha256?: string; reservation_id?: string; budget_receipt_id?: string;
  provider_operation_id?: string; response_model?: string; output_sha256?: string; evidence_refs: string[];
};
export type WorkspaceChildOperation = {
  operation_id: string; intent_sha256: string; intent: WorkspaceChildIntent;
  status: 'in_flight' | 'completed' | 'failed' | 'unknown';
  created_at: string; updated_at: string; provider_binding?: WorkspaceProviderBinding;
  report?: WorkspaceChildReport;
};
export type WorkspaceChildContext = { operation_id: string; intent_sha256: string };
export type WorkspaceChildExecution<T> = { value: T; report: WorkspaceChildReport };
export type WorkspaceChildRecoveryProof = {
  operation_id: string; intent_sha256: string; provider_binding?: WorkspaceProviderBinding;
  operation_fenced: true; report: WorkspaceChildReport;
};
export type WorkspaceChildOutcome<T> =
  | { status: 'completed'; operation_id: string; value: T; report: WorkspaceChildReport }
  | { status: 'blocked' | 'unknown'; operation_id?: string; code: string; report?: WorkspaceChildReport };
const json = (value: unknown): string => Array.isArray(value) ? '[' + value.map(json).join(',') + ']' : value && typeof value === 'object'
  ? '{' + Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + json(item)).join(',') + '}' : JSON.stringify(value);
const sha = (value: unknown) => createHash('sha256').update(json(value)).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clone = <T>(value: T): T => structuredClone(value);
function fail(code: string): never { throw new Error(code); }
export function workspaceChildOperationIdentity(context: WorkspaceStageContext, intent: WorkspaceChildIntent): WorkspaceChildContext {
  if (!intent || !id(intent.key) || !id(intent.provider) || !id(intent.model) || !hash(intent.input_sha256)
    || !['research', 'author', 'image_generator', 'independent_reviewer'].includes(intent.role)
    || Object.keys(intent).some(key => !['key', 'role', 'provider', 'model', 'input_sha256'].includes(key))) fail('INVALID_CHILD_INTENT');
  return { operation_id: 'child:' + sha({ owner: context.owner_id, task: context.record.task.task_id, run: context.run.run_id, key: intent.key }),
    intent_sha256: sha(intent) };
}
export function workspaceChildBinding(run: WorkspaceRunRecord, child: WorkspaceChildContext | undefined) {
  if (!child) return run.provider_binding;
  const found = run.child_operations?.find(value => value.operation_id === child.operation_id);
  if (!found || found.status !== 'in_flight' || found.intent_sha256 !== child.intent_sha256) fail('CHILD_OPERATION_FENCED');
  return found.provider_binding;
}
export const workspaceChildrenUnsettled = (run: WorkspaceRunRecord) => (run.child_operations ?? []).some(child =>
  !['completed', 'failed'].includes(child.status) || !child.report || !['settled', 'released', 'not_reserved'].includes(child.report.accounting));

function located(state: WorkspaceOwnerState, context: WorkspaceStageContext, now: number, live = true) {
  const record = state.tasks.find(value => value.owner_id === context.owner_id && value.task.task_id === context.record.task.task_id);
  const run = record?.runs?.find(value => value.run_id === context.run.run_id);
  const action = record?.actions.find(value => value.action_id === context.action.action_id);
  if (!record || !run || !action || context.record.owner_id !== context.owner_id || context.action.actor_id !== context.owner_id
    || run.operation_id !== context.run.operation_id || run.stage !== context.run.stage || run.fence !== context.run.fence || run.lease_owner !== context.run.lease_owner
    || run.action_id !== action.action_id || action.actor_id !== context.owner_id) fail('CHILD_RUN_SCOPE_MISMATCH');
  if (live && (context.signal.aborted || run.status !== 'in_flight' || action.status !== 'running' || Date.parse(run.lease_expires_at) <= now
    || record.task.state_version !== context.record.task.state_version || record.task.snapshot.snapshot_id !== context.record.task.snapshot.snapshot_id
    || record.task.snapshot.content_revision !== context.record.task.snapshot.content_revision
    || record.actions.some(value => value.type === 'cancel' && ['queued', 'running'].includes(value.status)))) fail('CHILD_RUN_FENCED');
  return { record, run, action };
}
function validReport(report: WorkspaceChildReport, binding: WorkspaceProviderBinding | undefined) {
  if (!report || !['completed', 'failed_before_submit', 'known_failure', 'unknown'].includes(report.outcome)
    || !['not_reserved', 'released', 'held', 'settled', 'pending_reconciliation'].includes(report.accounting)
    || !Array.isArray(report.evidence_refs) || report.evidence_refs.length > 64 || report.evidence_refs.some(ref => !id(ref))
    || ['request_sha256', 'output_sha256'].some(key => report[key as 'request_sha256'] !== undefined && !hash(report[key as 'request_sha256']))
    || ['reservation_id', 'budget_receipt_id', 'provider_operation_id', 'response_model'].some(key => report[key as 'reservation_id'] !== undefined && !id(report[key as 'reservation_id']))
    || Object.keys(report).some(key => !['outcome', 'accounting', 'request_sha256', 'reservation_id', 'budget_receipt_id', 'provider_operation_id', 'response_model', 'output_sha256', 'evidence_refs'].includes(key))) return false;
  if (binding && (report.reservation_id !== binding.reservation_id || report.request_sha256 !== binding.request_sha256 || report.accounting === 'not_reserved')) return false;
  if (!binding && (report.outcome === 'completed' || report.outcome === 'known_failure' || report.accounting === 'settled')) return false;
  if (report.outcome === 'completed' && (report.accounting !== 'settled' || !report.budget_receipt_id || !report.output_sha256)) return false;
  if (report.outcome === 'known_failure' && (report.accounting !== 'settled' || !report.budget_receipt_id)) return false;
  if (report.outcome === 'failed_before_submit' && !['not_reserved', 'released', 'pending_reconciliation', 'held'].includes(report.accounting)) return false;
  return true;
}
/** Called only after the stage's trusted reconciler independently verifies actual
 * accounting/provider receipts. Missing children or aggregate-only proofs cannot
 * release a stage with one uncertain image/reviewer call. */
export function workspaceValidateChildRecovery(run: WorkspaceRunRecord, proofs: WorkspaceChildRecoveryProof[] | undefined, outcome: 'completed' | 'no_side_effect') {
  const children = run.child_operations ?? [];
  if (!children.length) return proofs === undefined || Array.isArray(proofs) && proofs.length === 0;
  if (!Array.isArray(proofs) || proofs.length !== children.length || new Set(proofs.map(p => p.operation_id)).size !== children.length) return false;
  return children.every(child => {
    const proof = proofs.find(p => p.operation_id === child.operation_id);
    if (!proof || proof.intent_sha256 !== child.intent_sha256 || proof.operation_fenced !== true || json(proof.provider_binding) !== json(child.provider_binding)
      || !validReport(proof.report, child.provider_binding) || ['held', 'pending_reconciliation'].includes(proof.report.accounting) || proof.report.outcome === 'unknown') return false;
    // Settled earlier children cannot be rewritten as free/no-side-effect later.
    if (child.report && ['completed', 'failed'].includes(child.status) && json(child.report) !== json(proof.report)) return false;
    return outcome !== 'no_side_effect' || proof.report.outcome === 'failed_before_submit' && ['released', 'not_reserved'].includes(proof.report.accounting);
  });
}

export function createWorkspaceOperationJournal(options: { store: WorkspaceStore; authorizeOwner: (ownerId: string) => Promise<boolean>; now?: () => number; maxPerRun?: number; maxInFlight?: number }) {
  const now = options.now ?? Date.now, maximum = options.maxPerRun ?? 256, parallel = options.maxInFlight ?? 4;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 512 || !Number.isSafeInteger(parallel) || parallel < 1 || parallel > 16) fail('INVALID_CHILD_LIMITS');
  const timestamp = () => new Date(now()).toISOString();
  function event(record: import('./uid-workspace-store.ts').WorkspaceRecord, operation: WorkspaceChildOperation, type: string) {
    const messages = { research: 'Đọc và đối chiếu nguồn sản phẩm', author: 'Soạn nội dung theo bằng chứng', image_generator: 'Tạo hoặc sửa hình ảnh đã chọn', independent_reviewer: 'Kiểm tra chất lượng độc lập' };
    record.events.push({ sequence: (record.events.at(-1)?.sequence ?? 0) + 1, type, created_at: timestamp(), data: {
      operation_id: operation.operation_id, role: operation.intent.role, model: operation.intent.model, status: operation.status,
      message: messages[operation.intent.role] + (type === 'operation_started' ? ': đang chạy' : operation.status === 'completed' ? ': đã trả kết quả, chưa thay thế bước duyệt' : operation.status === 'unknown' ? ': cần đối soát kết quả/chi phí' : ': chưa hoàn tất'),
    } }); record.updated_at = timestamp();
  }
  async function guardDispatch(context: WorkspaceStageContext) {
    if (!context.provider_operation || !await options.authorizeOwner(context.owner_id)) fail('CHILD_DISPATCH_NOT_AUTHORIZED');
    await options.store.read(context.owner_id, state => {
      const { run } = located(state as WorkspaceOwnerState, context, now());
      if (workspaceChildrenUnsettled({ ...run, child_operations: run.child_operations?.filter(value => value.operation_id !== context.provider_operation!.operation_id && value.status === 'unknown') })) fail('CHILD_PREVIOUS_OUTCOME_UNKNOWN');
      const binding = workspaceChildBinding(run, context.provider_operation);
      if (!binding) fail('CHILD_PROVIDER_BINDING_REQUIRED');
    });
    if (context.signal.aborted) fail('CHILD_DISPATCH_CANCELLED');
  }
  async function execute<T>(context: WorkspaceStageContext, rawIntent: WorkspaceChildIntent, perform: (context: WorkspaceStageContext) => Promise<WorkspaceChildExecution<T>>): Promise<WorkspaceChildOutcome<T>> {
    if (context.provider_operation) return { status: 'blocked', code: 'NESTED_CHILD_OPERATION_NOT_ALLOWED' };
    const intent = clone(rawIntent), identity = workspaceChildOperationIdentity(context, intent);
    if (!await options.authorizeOwner(context.owner_id)) return { status: 'blocked', ...identity, code: 'CHILD_OWNER_NOT_AUTHORIZED' };
    const admitted = await options.store.transaction(context.owner_id, state => {
      const { record, run } = located(state, context, now()); const children = run.child_operations ??= [];
      const existing = children.find(value => value.operation_id === identity.operation_id);
      if (existing) return { code: existing.intent_sha256 !== identity.intent_sha256 ? 'CHILD_INTENT_CONFLICT' : 'CHILD_ALREADY_ATTEMPTED', unknown: ['unknown', 'in_flight'].includes(existing.status) };
      if (children.some(value => value.status === 'unknown')) return { code: 'CHILD_PREVIOUS_OUTCOME_UNKNOWN', unknown: true };
      if (children.length >= maximum || children.filter(value => value.status === 'in_flight').length >= parallel) return { code: 'CHILD_CAPACITY_EXCEEDED', unknown: false };
      const child: WorkspaceChildOperation = { ...identity, intent, status: 'in_flight', created_at: timestamp(), updated_at: timestamp() };
      children.push(child); event(record, child, 'operation_started');
      return null;
    });
    if (admitted) return { status: admitted.unknown ? 'unknown' : 'blocked', operation_id: identity.operation_id, code: admitted.code };
    const childContext: WorkspaceStageContext = { ...context, record: clone(context.record), run: clone(context.run), action: clone(context.action),
      feedback: clone(context.feedback), revision_plan: clone(context.revision_plan), references: clone(context.references), provider_operation: clone(identity),
      bindProviderOperation: async binding => {
        if (!binding || !id(binding.provider) || !id(binding.reservation_id) || !hash(binding.request_sha256) || binding.provider !== intent.provider) fail('INVALID_CHILD_PROVIDER_BINDING');
        if (!await options.authorizeOwner(context.owner_id)) fail('CHILD_OWNER_NOT_AUTHORIZED');
        await options.store.transaction(context.owner_id, state => {
          const { run } = located(state, context, now());
          const child = run.child_operations!.find(value => value.operation_id === identity.operation_id);
          if (!child || child.status !== 'in_flight' || child.intent_sha256 !== identity.intent_sha256) fail('CHILD_OPERATION_FENCED');
          if (child.provider_binding && json(child.provider_binding) !== json(binding)) fail('CHILD_BINDING_CONFLICT');
          child.provider_binding = clone(binding); child.updated_at = timestamp();
        });
      } };
    let result: WorkspaceChildExecution<T> | undefined;
    try { result = clone(await perform(childContext)); } catch { /* A thrown adapter may already have submitted. Preserve unknown. */ }
    // Persist accounting even if a cancellation/lease expiry happened after dispatch.
    // This never grants output acceptance or re-opens the parent run.
    try {
      const accepted = await options.store.transaction(context.owner_id, state => {
        const { record, run } = located(state, context, now(), false);
        const child = run.child_operations!.find(value => value.operation_id === identity.operation_id);
        if (!child || child.status !== 'in_flight' || child.intent_sha256 !== identity.intent_sha256) fail('CHILD_OPERATION_FENCED');
        const report = result && validReport(result.report, child.provider_binding) ? clone(result.report) : undefined;
        const unknown = !report || report.outcome === 'unknown' || ['held', 'pending_reconciliation'].includes(report.accounting);
        child.status = unknown ? 'unknown' : report.outcome === 'completed' ? 'completed' : 'failed';
        child.updated_at = timestamp(); if (report) child.report = report;
        event(record, child, 'operation_' + child.status);
        return { status: child.status, report };
      });
      if (accepted.status === 'unknown') return { status: 'unknown', operation_id: identity.operation_id, code: 'CHILD_RECONCILIATION_REQUIRED', report: accepted.report };
      if (accepted.status !== 'completed') return { status: 'blocked', operation_id: identity.operation_id, code: 'CHILD_PROVIDER_FAILED', report: accepted.report };
      // Check the parent again without the child in-flight requirement, before
      // exposing output. The runner also checks at the atomic stage commit.
      await options.store.read(context.owner_id, state => located(state as WorkspaceOwnerState, context, now()));
      return { status: 'completed', operation_id: identity.operation_id, value: result!.value, report: accepted.report! };
    } catch { return { status: 'unknown', operation_id: identity.operation_id, code: 'CHILD_COMMIT_RECONCILIATION_REQUIRED' }; }
  }
  return { execute, guardDispatch };
}

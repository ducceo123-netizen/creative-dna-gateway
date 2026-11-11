import type { WorkspaceStageContext, WorkspaceStageOutput, WorkspaceRunnerResult } from './uid-workspace-runner.ts';
import type { WorkspaceChildRecoveryProof } from './uid-workspace-operations.ts';

/** Server-only provider/accounting correlation persisted BEFORE provider dispatch.
 * Identifier presence is not proof. Trusted reconcilers verify the retained ledger. */
export type WorkspaceProviderBinding = {
  reservation_id: string; request_sha256: string; provider: string;
};
export type WorkspaceRecoveryProof = {
  owner_id: string; task_id: string; run_id: string; operation_id: string;
  /** Durable operation fence forbids late submission of this old operation. */
  operation_fenced: true;
  input_identity: string; evidence_refs: string[];
  provider_binding?: WorkspaceProviderBinding;
  child_operations?: WorkspaceChildRecoveryProof[];
  accounting: 'settled' | 'released' | 'not_reserved';
  accounting_evidence_ref: string;
};
export type WorkspaceRecoveryOutcome =
  | { outcome: 'unknown'; code: string }
  | { outcome: 'completed'; proof: WorkspaceRecoveryProof; output: WorkspaceStageOutput; provider_operation_id?: string }
  | { outcome: 'no_side_effect'; proof: WorkspaceRecoveryProof };
export type WorkspaceRecoveryContext = Readonly<{
  original: WorkspaceStageContext;
  request_id: string;
  /** Current recovery claim fence for read-only custody reconciliation. */
  request_fence?: number;
  provider_binding?: WorkspaceProviderBinding;
  input_identity: string;
  signal: AbortSignal;
}>;
/** Inject reviewed SERVER code, never request JSON. reconcile may query the
 * provider's operation ledger, retrieve prior output and settle accounting. It
 * MUST close/fence the old budget submission intent before proving no side
 * effect, so a late callback cannot submit after release. It MUST NOT submit generation, assume absence from a timeout/404, or release an
 * ambiguous reservation. verifyEvidence independently verifies retained evidence
 * and exact operation/reservation binding. Completion must also pass the original
 * stage adapter's verifyEvidence and all normal scope/QA gates. */
export interface TrustedWorkspaceReconciler {
  reconcile(context: WorkspaceRecoveryContext): Promise<WorkspaceRecoveryOutcome>;
  verifyEvidence(context: WorkspaceRecoveryContext, outcome: Exclude<WorkspaceRecoveryOutcome, { outcome: 'unknown' }>): Promise<boolean>;
}
export type WorkspaceRecoveryRequest = {
  request_id: string; idempotency_key: string; fingerprint: string;
  expected_state_version: number; status: 'checking' | 'unknown' | 'recovered' | 'blocked';
  fence: number; lease_owner: string; lease_expires_at: string;
  created_at: string; updated_at: string;
  proof?: WorkspaceRecoveryProof; result?: WorkspaceRunnerResult;
};

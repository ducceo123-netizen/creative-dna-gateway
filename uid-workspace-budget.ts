import { createHash, randomUUID } from 'node:crypto';
import type { WorkspaceSqlPool } from './uid-workspace-store.ts';
import { WORKSPACE_OPENAI_MODEL, WORKSPACE_OPENAI_ENDPOINT, type WorkspaceOpenAIAuthorization, type WorkspaceOpenAIBudgetAdapter, type WorkspaceOpenAIBudgetRequest, type WorkspaceOpenAIBudgetReport, type WorkspaceOpenAIBudgetReservation, type WorkspaceOpenAIUsage } from './uid-workspace-openai.ts';

/** Server-only accounting. No credentials, DDL, grant provisioning or network calls.
 * One project row is the atomic unit: all member/task ceilings AND operation fences
 * are serialized together, including the first insert race. Rows must be provisioned
 * through the separately reviewed operator workflow, never from HTTP/model input. */
export type WorkspacePricing = {
  evidence_ref: string; model: typeof WORKSPACE_OPENAI_MODEL;
  verified_at: string; expires_at: string;
  /** Reviewed upper bound for all non-content framing tokens. UTF-8 bytes bound
   * text BPE tokens; this factor must cover the verified provider tokenizer. */
  max_input_tokens_per_utf8_byte: number; protocol_input_token_overhead: number;
  max_input_tokens: number; max_output_tokens: number;
  tiers: Array<{ through_input_tokens: number; input_microusd_per_million: number; output_microusd_per_million: number }>;
};
export type WorkspaceBudgetGrant = { active: boolean; authorization_ref: string; cap_microusd: number; valid_from: string; expires_at: string };
export type WorkspaceTaskAdmissionPolicy = WorkspaceBudgetGrant & {
  policy_id: string; data_authorization_ref: string; data_destination: typeof WORKSPACE_OPENAI_ENDPOINT;
  model: typeof WORKSPACE_OPENAI_MODEL; capability_verification_ref: string;
  maximum_task_cap_microusd: number; maximum_request_cost_microusd: number;
  task_grant_ttl_ms: number; maximum_admitted_tasks: number;
  allowed_brands: string[]; allowed_materials: ['onepage']; allowed_source_origins: string[];
};
export type WorkspaceAdmissionScope = { brand: string; material: 'onepage'; source_url: string };
export type WorkspaceTaskAdmission = { status: 'admitted' | 'already_admitted' | 'not_admitted'; code: string };
export type WorkspaceTaskBudgetGrant = WorkspaceBudgetGrant & {
  owner_id: string; task_id: string; authorization_id: string; data_authorization_ref: string;
  capability_verification_ref: string; maximum_request_cost_microusd: number;
  admission_policy_sha256?: string; task_scope_sha256?: string;
};
export type WorkspaceBudgetOperation = {
  reservation_id: string; request: WorkspaceOpenAIBudgetRequest; pricing: WorkspacePricing;
  state: 'reserved' | 'submission_intent' | 'held' | 'settled' | 'released';
  created_at: string; updated_at: string; report?: WorkspaceOpenAIBudgetReport;
  charged_microusd?: number; receipt_id?: string; reports?: WorkspaceOpenAIBudgetReport[];
};
export type WorkspaceProjectBudgetState = {
  version: 1; project_id: string; frozen: boolean; global: WorkspaceBudgetGrant;
  owners: Array<WorkspaceBudgetGrant & { owner_id: string; task_policy?: WorkspaceTaskAdmissionPolicy }>;
  tasks: WorkspaceTaskBudgetGrant[]; operations: WorkspaceBudgetOperation[];
};
export type WorkspaceBudgetConfig = {
  schemaReviewed: true; schemaVersion: 'uid-workspace-budget-v1'; qualifiedTable: string;
  pricing: WorkspacePricing; maxStateBytes?: number; maxOperations?: number; now?: () => number;
};
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const amount = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
function canonical(value: unknown): string { return Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}' : JSON.stringify(value); }
function fail(code: string): never { throw new Error(code); }
function tableName(name: string) { if (!/^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$/.test(name)) fail('BUDGET_SCHEMA_NOT_REVIEWED'); return name.split('.').map(value => '"' + value + '"').join('.'); }
function validPricing(p: WorkspacePricing) {
  if (!p || !id(p.evidence_ref) || p.model !== WORKSPACE_OPENAI_MODEL || !Number.isFinite(Date.parse(p.verified_at)) || !Number.isFinite(Date.parse(p.expires_at))
    || !amount(p.max_input_tokens_per_utf8_byte, 1) || p.max_input_tokens_per_utf8_byte > 16 || !amount(p.protocol_input_token_overhead, 1)
    || !amount(p.max_input_tokens, 1) || !amount(p.max_output_tokens, 1) || !Array.isArray(p.tiers) || !p.tiers.length || p.tiers.length > 20) fail('INVALID_VERIFIED_PRICING');
  let previous = 0;
  for (const tier of p.tiers) {
    if (!amount(tier.through_input_tokens, previous + 1) || !amount(tier.input_microusd_per_million, 1) || !amount(tier.output_microusd_per_million, 1)) fail('INVALID_VERIFIED_PRICING');
    previous = tier.through_input_tokens;
  }
  if (previous < p.max_input_tokens) fail('INCOMPLETE_VERIFIED_PRICING');
}
function price(input: number, output: number, p: WorkspacePricing, conservative: boolean) {
  validPricing(p);
  if (!amount(input) || !amount(output) || input > p.max_input_tokens || output > p.max_output_tokens) fail('PRICING_BOUNDS_EXCEEDED');
  const selected = p.tiers.findIndex(tier => tier.through_input_tokens >= input);
  const tiers = conservative ? p.tiers.slice(0, selected + 1) : [p.tiers[selected]];
  const result = (BigInt(input) * BigInt(Math.max(...tiers.map(t => t.input_microusd_per_million))) + BigInt(output) * BigInt(Math.max(...tiers.map(t => t.output_microusd_per_million))) + 999_999n) / 1_000_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('PRICING_BOUNDS_EXCEEDED');
  return Number(result);
}
export function workspaceMaximumTextCost(request: Pick<WorkspaceOpenAIBudgetRequest, 'input_utf8_bytes' | 'request_bytes' | 'max_output_tokens'>, pricing: WorkspacePricing) {
  validPricing(pricing);
  if (!amount(request.input_utf8_bytes, 1) || !amount(request.request_bytes, request.input_utf8_bytes) || !amount(request.max_output_tokens, 1)) fail('INVALID_BOUNDED_REQUEST');
  // Full encoded request bytes deliberately overcount text and JSON framing.
  return price(request.request_bytes * pricing.max_input_tokens_per_utf8_byte + pricing.protocol_input_token_overhead, request.max_output_tokens, pricing, true);
}
function usageCost(usage: WorkspaceOpenAIUsage, pricing: WorkspacePricing) {
  if (!usage || !amount(usage.input_tokens) || !amount(usage.output_tokens) || !amount(usage.total_tokens) || usage.input_tokens + usage.output_tokens !== usage.total_tokens) fail('INVALID_REPORTED_USAGE');
  // Charge ordinary input rates even for cached tokens. This is conservative;
  // invoice-level corrections require the reviewed operator reconciliation path.
  return price(usage.input_tokens, usage.output_tokens, pricing, false);
}
function checkState(state: WorkspaceProjectBudgetState, project: string) {
  if (!state || state.version !== 1 || state.project_id !== project || typeof state.frozen !== 'boolean' || !Array.isArray(state.owners) || !Array.isArray(state.tasks) || !Array.isArray(state.operations)) fail('BUDGET_JOURNAL_CORRUPT');
  const grants = [state.global, ...state.owners, ...state.tasks];
  if (grants.some(g => !g || typeof g.active !== 'boolean' || !id(g.authorization_ref) || !amount(g.cap_microusd, 1) || !Number.isFinite(Date.parse(g.valid_from)) || !Number.isFinite(Date.parse(g.expires_at)))) fail('BUDGET_JOURNAL_CORRUPT');
  if (new Set(state.owners.map(g => g.owner_id)).size !== state.owners.length || new Set(state.tasks.map(g => g.owner_id + '/' + g.task_id)).size !== state.tasks.length) fail('BUDGET_JOURNAL_CORRUPT');
  if (new Set(state.operations.map(o => o.reservation_id)).size !== state.operations.length || new Set(state.operations.map(o => [o.request.owner_id, o.request.task_id, o.request.operation_id].join('/'))).size !== state.operations.length) fail('BUDGET_JOURNAL_CORRUPT');
  for (const op of state.operations) if (!op.request || op.request.project_id !== project || !amount(op.request.maximum_cost_microusd, 1) || !['reserved', 'submission_intent', 'held', 'settled', 'released'].includes(op.state) || (op.charged_microusd !== undefined && !amount(op.charged_microusd)) || (op.state === 'settled' && op.charged_microusd === undefined)) fail('BUDGET_JOURNAL_CORRUPT');
}
function validateRequest(r: WorkspaceOpenAIBudgetRequest) {
  if (!r || !(['authorization_id', 'owner_id', 'task_id', 'project_id', 'operation_id', 'client_request_id', 'budget_authorization_ref', 'global_budget_authorization_ref', 'user_quota_authorization_ref', 'capability_verification_ref'] as const).every(k => id(r[k]))
    || r.project_id.length > 117 || !/^[a-f0-9]{64}$/.test(r.request_sha256) || r.model !== WORKSPACE_OPENAI_MODEL || !amount(r.maximum_cost_microusd, 1) || !['low', 'medium', 'high', 'xhigh', 'max'].includes(r.reasoning_effort)) fail('INVALID_BUDGET_REQUEST');
}
function active(g: WorkspaceBudgetGrant | undefined, now: number) { return Boolean(g?.active && Date.parse(g.valid_from) <= now && Date.parse(g.expires_at) > now); }
function validAdmissionPolicy(p: WorkspaceTaskAdmissionPolicy | undefined, now: number): p is WorkspaceTaskAdmissionPolicy {
  if (!p || !active(p, now) || !id(p.policy_id) || !id(p.authorization_ref) || !id(p.data_authorization_ref) || p.data_destination !== WORKSPACE_OPENAI_ENDPOINT || p.model !== WORKSPACE_OPENAI_MODEL || !id(p.capability_verification_ref)
    || !amount(p.maximum_task_cap_microusd, 1) || !amount(p.maximum_request_cost_microusd, 1) || p.maximum_request_cost_microusd > p.maximum_task_cap_microusd
    || !amount(p.task_grant_ttl_ms, 1000) || p.task_grant_ttl_ms > 30 * 86_400_000 || !amount(p.maximum_admitted_tasks, 1) || p.maximum_admitted_tasks > 10_000
    || !Array.isArray(p.allowed_brands) || !p.allowed_brands.length || p.allowed_brands.some(brand => !['PawfectHouse', 'GiftSoul', 'SoulPrise'].includes(brand))
    || !Array.isArray(p.allowed_materials) || p.allowed_materials.length !== 1 || p.allowed_materials[0] !== 'onepage' || !Array.isArray(p.allowed_source_origins) || !p.allowed_source_origins.length || p.allowed_source_origins.length > 100) return false;
  try { return p.allowed_source_origins.every(origin => { const url = new URL(origin); return url.protocol === 'https:' && url.origin === origin && !url.username && !url.password; }); } catch { return false; }
}
function policyStillAuthorizes(owner: WorkspaceProjectBudgetState['owners'][number] | undefined, task: WorkspaceTaskBudgetGrant | undefined, now: number) {
  return !task?.admission_policy_sha256 || validAdmissionPolicy(owner?.task_policy, now) && digest(owner.task_policy) === task.admission_policy_sha256;
}
function grants(state: WorkspaceProjectBudgetState, r: WorkspaceOpenAIBudgetRequest, now: number) {
  const owner = state.owners.find(g => g.owner_id === r.owner_id); const task = state.tasks.find(g => g.owner_id === r.owner_id && g.task_id === r.task_id);
  return !state.frozen && active(state.global, now) && active(owner, now) && active(task, now)
    && state.global.authorization_ref === r.global_budget_authorization_ref && owner!.authorization_ref === r.user_quota_authorization_ref
    && task!.authorization_ref === r.budget_authorization_ref && task!.authorization_id === r.authorization_id && id(task!.data_authorization_ref)
    && policyStillAuthorizes(owner, task, now) && task!.capability_verification_ref === r.capability_verification_ref && amount(task!.maximum_request_cost_microusd, r.maximum_cost_microusd)
    ? { owner: owner!, task: task! } : null;
}
function cost(op: WorkspaceBudgetOperation) { return op.state === 'released' ? 0 : op.state === 'settled' ? op.charged_microusd! : Math.max(op.request.maximum_cost_microusd, op.charged_microusd ?? 0); }
function fits(state: WorkspaceProjectBudgetState, r: WorkspaceOpenAIBudgetRequest, g: NonNullable<ReturnType<typeof grants>>) {
  const total = (predicate: (op: WorkspaceBudgetOperation) => boolean) => state.operations.filter(predicate).reduce((sum, op) => sum + BigInt(cost(op)), BigInt(r.maximum_cost_microusd));
  return total(() => true) <= BigInt(state.global.cap_microusd) && total(op => op.request.owner_id === r.owner_id) <= BigInt(g.owner.cap_microusd)
    && total(op => op.request.owner_id === r.owner_id && op.request.task_id === r.task_id) <= BigInt(g.task.cap_microusd);
}
function projectFromReservation(reservation: string) {
  if (typeof reservation !== 'string' || !/^b1\.[A-Za-z0-9_-]{1,267}\.[a-f0-9-]{36}$/.test(reservation)) fail('INVALID_BUDGET_RESERVATION');
  const project = Buffer.from(reservation.split('.')[1], 'base64url').toString('utf8'); if (!id(project)) fail('INVALID_BUDGET_RESERVATION'); return project;
}

export class PostgresWorkspaceBudget implements WorkspaceOpenAIBudgetAdapter {
  readonly durable = true;
  private readonly table: string; private readonly config: WorkspaceBudgetConfig;
  constructor(private readonly pool: WorkspaceSqlPool, config: WorkspaceBudgetConfig) {
    if (config.schemaReviewed !== true || config.schemaVersion !== 'uid-workspace-budget-v1') fail('BUDGET_SCHEMA_NOT_REVIEWED');
    this.table = tableName(config.qualifiedTable); validPricing(config.pricing);
    this.config = { ...config, pricing: structuredClone(config.pricing) };
    if (!amount(config.maxOperations ?? 10_000, 1) || !amount(config.maxStateBytes ?? 16 * 1024 * 1024, 1024)) fail('INVALID_BUDGET_CONFIG');
  }
  private now() { return (this.config.now ?? Date.now)(); }
  readiness() { const now = this.now(); return Date.parse(this.config.pricing.verified_at) <= now && Date.parse(this.config.pricing.expires_at) > now; }
  private async transaction<T>(project: string, mutate: (state: WorkspaceProjectBudgetState | null) => T): Promise<T> {
    if (!id(project)) fail('INVALID_BUDGET_PROJECT');
    const connection = await this.pool.connect(); let committing = false;
    try {
      await connection.query('BEGIN');
      await connection.query("SET LOCAL lock_timeout = '5s'"); await connection.query("SET LOCAL statement_timeout = '15s'");
      await connection.query("SELECT set_config('uid.workspace_budget_project', $1, true)", [project]);
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['uid-workspace-budget:' + project]);
      const result = await connection.query(`SELECT state, revision FROM ${this.table} WHERE project_id = $1 FOR UPDATE`, [project]);
      if (result.rows.length > 1) fail('BUDGET_JOURNAL_CORRUPT');
      const row = result.rows[0]; const state = row ? (typeof row.state === 'string' ? JSON.parse(row.state) : structuredClone(row.state)) as WorkspaceProjectBudgetState : null;
      if (state) checkState(state, project);
      const original = state ? JSON.stringify(state) : null;
      const output = mutate(state);
      if (state) {
        checkState(state, project); const json = JSON.stringify(state);
        if (Buffer.byteLength(json) > (this.config.maxStateBytes ?? 16 * 1024 * 1024)) fail('BUDGET_JOURNAL_FULL');
        if (json !== original) {
          const changed = await connection.query(`UPDATE ${this.table} SET state = $2::jsonb, revision = revision + 1, updated_at = now() WHERE project_id = $1 AND revision = $3 RETURNING revision`, [project, json, row.revision]);
          if (changed.rows.length !== 1) fail('BUDGET_JOURNAL_CONFLICT');
        }
      }
      committing = true; await connection.query('COMMIT'); return structuredClone(output);
    } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); if (committing) fail('BUDGET_OUTCOME_UNKNOWN'); throw error; }
    finally { connection.release(); }
  }
  /** Trusted server admission only. The caller supplies persisted task identity and
   * scope, never a budget/grant from HTTP. Current member checks belong to runtime.
   * Authority and all spending caps come from this existing durable owner policy. */
  async admitTask(project: string, ownerId: string, taskId: string, scope: WorkspaceAdmissionScope, capabilityRef: string): Promise<WorkspaceTaskAdmission> {
    if (!id(project) || project.length > 117 || !id(ownerId) || !id(taskId) || !id(capabilityRef)) fail('INVALID_ADMISSION_SCOPE');
    const savedScope = structuredClone(scope); let source: URL;
    try { source = new URL(savedScope.source_url); } catch { return { status: 'not_admitted', code: 'TASK_SOURCE_NOT_AUTHORIZED' }; }
    if (source.protocol !== 'https:' || source.username || source.password || source.hash) return { status: 'not_admitted', code: 'TASK_SOURCE_NOT_AUTHORIZED' };
    return this.transaction(project, state => {
      const owner = state?.owners.find(value => value.owner_id === ownerId); const policy = owner?.task_policy;
      const denied = (code: string): WorkspaceTaskAdmission => ({ status: 'not_admitted', code });
      if (!state || state.frozen || !active(state.global, this.now()) || !active(owner, this.now()) || !this.readiness()) return denied('SHARED_BUDGET_NOT_AUTHORIZED');
      if (!validAdmissionPolicy(policy, this.now())) return denied('TASK_ADMISSION_POLICY_REQUIRED');
      if (policy.capability_verification_ref !== capabilityRef || !policy.allowed_brands.includes(savedScope.brand) || !policy.allowed_materials.includes(savedScope.material) || !policy.allowed_source_origins.includes(source.origin)) return denied('TASK_OUTSIDE_ADMISSION_POLICY');
      const prior = state.tasks.find(value => value.owner_id === ownerId && value.task_id === taskId);
      if (prior) {
        if (prior.admission_policy_sha256 !== digest(policy) || prior.task_scope_sha256 !== digest(savedScope) || !active(prior, this.now())) return denied('TASK_ADMISSION_CHANGED_OR_EXPIRED');
        return { status: 'already_admitted', code: 'TASK_BUDGET_ADMITTED' };
      }
      if (state.tasks.length >= 10_000 || state.tasks.filter(value => value.owner_id === ownerId && active(value, this.now())).length >= policy.maximum_admitted_tasks) return denied('TASK_ADMISSION_LIMIT_REACHED');
      const cap = Math.min(policy.maximum_task_cap_microusd, owner!.cap_microusd, state.global.cap_microusd, policy.cap_microusd);
      if (cap < policy.maximum_request_cost_microusd) return denied('TASK_ADMISSION_CAP_TOO_SMALL');
      state.tasks.push({ active: true, owner_id: ownerId, task_id: taskId, authorization_id: 'grant:' + digest([project, ownerId, taskId, policy.policy_id]), authorization_ref: policy.authorization_ref,
        data_authorization_ref: policy.data_authorization_ref, capability_verification_ref: policy.capability_verification_ref, cap_microusd: cap,
        maximum_request_cost_microusd: policy.maximum_request_cost_microusd, valid_from: new Date(this.now()).toISOString(),
        expires_at: new Date(Math.min(this.now() + policy.task_grant_ttl_ms, Date.parse(policy.expires_at), Date.parse(owner!.expires_at), Date.parse(state.global.expires_at))).toISOString(),
        admission_policy_sha256: digest(policy), task_scope_sha256: digest(savedScope) });
      return { status: 'admitted', code: 'TASK_BUDGET_ADMITTED' };
    });
  }
  async authorizationFor(project: string, ownerId: string, taskId: string, scope?: WorkspaceAdmissionScope): Promise<WorkspaceOpenAIAuthorization | null> {
    if (!id(ownerId) || !id(taskId)) fail('INVALID_BUDGET_SCOPE');
    return this.transaction(project, state => {
      const owner = state?.owners.find(g => g.owner_id === ownerId); const task = state?.tasks.find(g => g.owner_id === ownerId && g.task_id === taskId);
      if (!state || state.frozen || !active(state.global, this.now()) || !active(owner, this.now()) || !active(task, this.now()) || !this.readiness() || !policyStillAuthorizes(owner, task, this.now()) || !id(task!.authorization_id) || !id(task!.data_authorization_ref) || !amount(task!.maximum_request_cost_microusd, 1)) return null;
      if (scope && task!.task_scope_sha256 && task!.task_scope_sha256 !== digest(scope)) return null;
      return { authorization_id: task!.authorization_id, owner_id: ownerId, task_id: taskId, project_id: project,
        data_destination: WORKSPACE_OPENAI_ENDPOINT, data_authorization_ref: task!.data_authorization_ref,
        budget_authorization_ref: task!.authorization_ref, global_budget_authorization_ref: state.global.authorization_ref, user_quota_authorization_ref: owner!.authorization_ref,
        maximum_request_cost_microusd: task!.maximum_request_cost_microusd,
        expires_at: new Date(Math.min(Date.parse(state.global.expires_at), Date.parse(owner!.expires_at), Date.parse(task!.expires_at))).toISOString() };
    });
  }
  async reserve(input: WorkspaceOpenAIBudgetRequest): Promise<WorkspaceOpenAIBudgetReservation> {
    const request = structuredClone(input); validateRequest(request);
    return this.transaction(request.project_id, state => {
      if (!state) return { status: 'denied' };
      const prior = state.operations.find(op => op.request.owner_id === request.owner_id && op.request.task_id === request.task_id && op.request.operation_id === request.operation_id);
      if (prior) return { status: digest(prior.request) === digest(request) ? 'duplicate' : 'conflict' };
      const grant = grants(state, request, this.now());
      if (!grant || !this.readiness() || state.operations.length >= (this.config.maxOperations ?? 10_000)) return { status: 'denied' };
      try { if (workspaceMaximumTextCost(request, this.config.pricing) > request.maximum_cost_microusd) return { status: 'denied' }; } catch { return { status: 'denied' }; }
      if (!fits(state, request, grant)) return { status: 'denied' };
      const reservation = 'b1.' + Buffer.from(request.project_id).toString('base64url') + '.' + randomUUID();
      state.operations.push({ reservation_id: reservation, request, pricing: structuredClone(this.config.pricing), state: 'reserved', created_at: new Date(this.now()).toISOString(), updated_at: new Date(this.now()).toISOString() });
      return { status: 'reserved', reservation_id: reservation, reserved_microusd: request.maximum_cost_microusd, request_sha256: request.request_sha256, cost_ceiling_verified: true, pricing_evidence_ref: this.config.pricing.evidence_ref };
    });
  }
  async markSubmissionIntent(input: WorkspaceOpenAIBudgetRequest & { reservation_id: string }) {
    const { reservation_id, ...request } = structuredClone(input); validateRequest(request);
    if (projectFromReservation(reservation_id) !== request.project_id) return { ok: false };
    return this.transaction(request.project_id, state => {
      const op = state?.operations.find(op => op.reservation_id === reservation_id);
      if (!state || !op || op.state !== 'reserved' || digest(op.request) !== digest(request) || !grants(state, request, this.now()) || !this.readiness() || Date.parse(op.pricing.expires_at) <= this.now()) return { ok: false };
      const grant = grants(state, request, this.now());
      if (!grant || !fits({ ...state, operations: state.operations.filter(value => value !== op) }, request, grant)) return { ok: false };
      op.state = 'submission_intent'; op.updated_at = new Date(this.now()).toISOString(); return { ok: true };
    });
  }
  async releaseBeforeSubmit(input: { reservation_id: string; operation_id: string; request_sha256: string }) {
    const request = structuredClone(input);
    return this.transaction(projectFromReservation(request.reservation_id), state => {
      const op = state?.operations.find(op => op.reservation_id === request.reservation_id);
      if (!op || op.request.operation_id !== request.operation_id || op.request.request_sha256 !== request.request_sha256 || !['reserved', 'released'].includes(op.state)) return { released: false };
      // Submission intent is deliberately NOT releasable, even when fetch did not
      // happen. A crash on this boundary cannot prove that it did not happen.
      op.state = 'released'; op.updated_at = new Date(this.now()).toISOString(); return { released: true };
    });
  }
  async reconcile(input: WorkspaceOpenAIBudgetReport): Promise<{ status: 'settled' | 'held'; receipt_id: string }> {
    const report = structuredClone(input);
    return this.transaction(projectFromReservation(report.reservation_id), state => {
      const op = state?.operations.find(op => op.reservation_id === report.reservation_id);
      if (op && 'modality' in op.request) fail('BUDGET_MODALITY_ADAPTER_REQUIRED');
      if (!state || !op || !['submission_intent', 'held', 'settled'].includes(op.state) || op.request.operation_id !== report.operation_id || op.request.request_sha256 !== report.request_sha256 || op.request.client_request_id !== report.client_request_id || !['completed', 'known_failure', 'unknown'].includes(report.outcome)) fail('BUDGET_REPORT_SCOPE_MISMATCH');
      if (op.state === 'settled') { if (digest(op.report) !== digest(report)) fail('BUDGET_REPORT_CONFLICT'); return { status: 'settled', receipt_id: op.receipt_id! }; }
      for (const key of ['provider_request_id', 'response_id', 'response_model'] as const) if (op.report?.[key] && report[key] && op.report[key] !== report[key]) fail('BUDGET_REPORT_CONFLICT');
      for (const key of ['provider_request_id', 'response_id', 'response_model'] as const) if (!report[key] && op.report?.[key]) report[key] = op.report[key];
      const history = op.reports ??= op.report ? [structuredClone(op.report)] : [];
      if (!history.some(prior => digest(prior) === digest(report))) {
        if (history.length >= 32) fail('BUDGET_RECONCILIATION_LIMIT');
        history.push(structuredClone(report));
      }
      op.report = report; op.receipt_id ??= 'usage:' + randomUUID(); op.updated_at = new Date(this.now()).toISOString(); op.state = 'held';
      if (report.outcome !== 'unknown' && report.usage) {
        try {
          if (report.response_model && !/^gpt-6\.1-sol(?:-\d{4}-\d{2}-\d{2})?$/.test(report.response_model)) fail('PRICING_MODEL_MISMATCH');
          const charged = usageCost(report.usage, op.pricing); op.charged_microusd = charged;
          if (charged > op.request.maximum_cost_microusd) state.frozen = true; else op.state = 'settled';
        } catch { state.frozen = true; }
      }
      return { status: op.state === 'settled' ? 'settled' : 'held', receipt_id: op.receipt_id };
    });
  }
}

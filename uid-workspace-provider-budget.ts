import { createHash, randomUUID } from 'node:crypto';
import type { WorkspaceSqlPool } from './uid-workspace-store.ts';
import type { WorkspaceBudgetGrant, WorkspaceProjectBudgetState, WorkspaceTaskBudgetGrant } from './uid-workspace-budget.ts';
import type { WorkspaceOpenAIBudgetReservation } from './uid-workspace-openai.ts';

/** SERVER ONLY. All provider modalities use the existing v1 project row and lock.
 * No second quota pool, credentials, provisioning, live SQL or default pricing. */
export type WorkspaceProviderModality = 'images' | 'responses_vision';
export type WorkspaceProviderEndpoint = 'https://api.openai.com/v1/images/generations' | 'https://api.openai.com/v1/images/edits' | 'https://api.openai.com/v1/responses';
export type WorkspaceProviderUsage = {
  input_tokens: number; output_tokens: number; total_tokens: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number; cached_tokens?: number; [key: string]: unknown };
  output_tokens_details?: { text_tokens?: number; image_tokens?: number; reasoning_tokens?: number; [key: string]: unknown };
  [key: string]: unknown;
};
export type WorkspaceProviderAuthorization = {
  authorization_id: string; owner_id: string; task_id: string; project_id: string;
  data_destination: WorkspaceProviderEndpoint; data_authorization_ref: string;
  budget_authorization_ref: string; global_budget_authorization_ref: string; user_quota_authorization_ref: string;
  maximum_request_cost_microusd: number; expires_at: string;
};
export type WorkspaceProviderBudgetRequest = {
  authorization_id: string; owner_id: string; task_id: string; project_id: string;
  operation_id: string; request_sha256: string; client_request_id: string;
  modality: WorkspaceProviderModality; endpoint: WorkspaceProviderEndpoint; model: string;
  maximum_cost_microusd: number; request_bytes: number; input_utf8_bytes: number;
  input_images: Array<{ sha256: string; bytes: number; mime_type: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number }>;
  /** Responses token limit. NOT supported or inferred for Images API. */
  max_output_tokens?: number;
  image_options?: { operation: 'generate' | 'edit'; n: 1; quality: 'low' | 'medium' | 'high'; size: string; output_format: 'png' | 'jpeg' | 'webp' };
  budget_authorization_ref: string; global_budget_authorization_ref: string; user_quota_authorization_ref: string;
  data_authorization_ref: string; capability_verification_ref: string;
};
export type WorkspaceProviderBudgetReport = {
  reservation_id: string; operation_id: string; request_sha256: string; client_request_id: string;
  outcome: 'completed' | 'known_failure' | 'unknown'; provider_request_id?: string; response_id?: string;
  response_model?: string; http_status?: number; usage?: WorkspaceProviderUsage;
};
export interface WorkspaceProviderBudgetAdapter {
  reserve(request: WorkspaceProviderBudgetRequest): Promise<WorkspaceOpenAIBudgetReservation>;
  markSubmissionIntent(request: WorkspaceProviderBudgetRequest & { reservation_id: string }): Promise<{ ok: boolean }>;
  reconcile(report: WorkspaceProviderBudgetReport): Promise<{ status: 'settled' | 'held'; receipt_id: string }>;
  releaseBeforeSubmit(request: { reservation_id: string; operation_id: string; request_sha256: string }): Promise<{ released: boolean }>;
}
export type WorkspaceProviderTokenBuckets = { input_text_tokens: number; input_image_tokens: number; output_text_tokens: number; output_image_tokens: number };
export type WorkspaceProviderPricing = {
  evidence_ref: string; model: string; modality: WorkspaceProviderModality; verified_at: string; expires_at: string;
  /** Explicit accepted provider response identities, verified for this rate sheet. */
  accepted_response_models: string[];
  tiers: Array<{ through_input_tokens: number; microusd_per_million: WorkspaceProviderTokenBuckets }>;
};
/** Operator-reviewed evidence, NEVER accepted from HTTP/model/caller cost caps.
 * Must bound ALL charged tokens, framing, reasoning, image input and output for
 * this exact request. An estimate, per-image advertised typical price, byte cap,
 * spend dashboard, or local timeout is not evidence of a provider cost ceiling.
 * There are deliberately no default bounds for Images API. */
export type WorkspaceProviderVerifiedBound = {
  evidence_ref: string; independent_evidence_ref: string; reviewed_by: string;
  basis: 'provider_enforced_limit' | 'reviewed_exhaustive_upper_bound';
  project_id: string; modality: WorkspaceProviderModality; model: string; endpoint: WorkspaceProviderEndpoint;
  request_sha256: string; verified_at: string; expires_at: string;
  tokens: WorkspaceProviderTokenBuckets;
};
/** Extends the existing task grant, never grants a new independent pool. */
export type WorkspaceProviderPermission = {
  active: boolean; modality: WorkspaceProviderModality; endpoint: WorkspaceProviderEndpoint; model: string;
  data_authorization_ref: string; capability_verification_ref: string; maximum_request_cost_microusd: number;
  valid_from: string; expires_at: string;
};
export type WorkspaceProviderTaskGrant = WorkspaceTaskBudgetGrant & { provider_authorizations?: WorkspaceProviderPermission[] };
export type WorkspaceProviderOperation = {
  reservation_id: string; request: WorkspaceProviderBudgetRequest; pricing: WorkspaceProviderPricing; bound: WorkspaceProviderVerifiedBound; bound_resolver_review_ref?: string;
  state: 'reserved' | 'submission_intent' | 'held' | 'settled' | 'released'; created_at: string; updated_at: string;
  report?: WorkspaceProviderBudgetReport; reports?: WorkspaceProviderBudgetReport[]; charged_microusd?: number; receipt_id?: string;
};
export type WorkspaceProviderProjectState = Omit<WorkspaceProjectBudgetState, 'tasks' | 'operations'> & {
  tasks: WorkspaceProviderTaskGrant[]; operations: Array<WorkspaceProjectBudgetState['operations'][number] | WorkspaceProviderOperation>;
};
export type WorkspaceProviderBoundResolver = {
  review_ref: string; independent_evidence_ref: string; reviewed_by: string;
  verified_at: string; expires_at: string;
  /** Trusted reviewed non-spending algorithm, not an LLM/estimate. Must establish
   * an independently defensible bound for every exact request it accepts. Return
   * null when that cannot be established. Runs OUTSIDE the SQL transaction. */
  resolveVerifiedBound(request: WorkspaceProviderBudgetRequest): Promise<WorkspaceProviderVerifiedBound | null>;
};
export type WorkspaceProviderBudgetConfig = {
  schemaReviewed: true; schemaVersion: 'uid-workspace-budget-v1'; qualifiedTable: string;
  pricing: WorkspaceProviderPricing[];
  /** Trusted immutable operator evidence collection, exact-request keyed. */
  verifiedBounds: WorkspaceProviderVerifiedBound[];
  boundResolver?: WorkspaceProviderBoundResolver;
  maxStateBytes?: number; maxOperations?: number; now?: () => number;
};

const buckets = ['input_text_tokens', 'input_image_tokens', 'output_text_tokens', 'output_image_tokens'] as const;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v);
const amount = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function fail(code: string): never { throw new Error(code); }
const canonical = (v: unknown): string => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.entries(v).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => JSON.stringify(k) + ':' + canonical(item)).join(',') + '}' : JSON.stringify(v);
const digest = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const current = (v: { verified_at: string; expires_at: string }, now: number) => Number.isFinite(Date.parse(v.verified_at)) && Date.parse(v.verified_at) <= now && Date.parse(v.expires_at) > now;
const active = (v: { active: boolean; valid_from: string; expires_at: string } | undefined, now: number) => !!v && v.active === true && Date.parse(v.valid_from) <= now && Date.parse(v.expires_at) > now;
const providerOp = (op: WorkspaceProviderProjectState['operations'][number]): op is WorkspaceProviderOperation => 'modality' in op.request;
function validatePricing(p: WorkspaceProviderPricing) {
  if (!p || !id(p.evidence_ref) || !id(p.model) || !['images', 'responses_vision'].includes(p.modality) || !Number.isFinite(Date.parse(p.verified_at)) || !Number.isFinite(Date.parse(p.expires_at))
    || !Array.isArray(p.accepted_response_models) || !p.accepted_response_models.includes(p.model) || p.accepted_response_models.length > 8 || !p.accepted_response_models.every(id)
    || !Array.isArray(p.tiers) || !p.tiers.length || p.tiers.length > 20) fail('INVALID_PROVIDER_PRICING');
  let previous = 0;
  for (const tier of p.tiers) {
    if (!amount(tier.through_input_tokens, previous + 1) || !record(tier.microusd_per_million) || Object.keys(tier.microusd_per_million).length !== 4 || !buckets.every(key => amount(tier.microusd_per_million[key]))) fail('INVALID_PROVIDER_PRICING');
    previous = tier.through_input_tokens;
  }
}
function validateBound(b: WorkspaceProviderVerifiedBound) {
  if (!b || ![b.evidence_ref, b.independent_evidence_ref, b.reviewed_by, b.project_id, b.model].every(id) || !hash(b.request_sha256)
    || !['provider_enforced_limit', 'reviewed_exhaustive_upper_bound'].includes(b.basis) || !['images', 'responses_vision'].includes(b.modality)
    || !Number.isFinite(Date.parse(b.verified_at)) || !Number.isFinite(Date.parse(b.expires_at)) || !record(b.tokens) || Object.keys(b.tokens).length !== 4 || !buckets.every(k => amount(b.tokens[k]))
    || !validEndpoint(b.modality, b.endpoint)) fail('INVALID_PROVIDER_COST_BOUND');
}
function validEndpoint(modality: WorkspaceProviderModality, endpoint: WorkspaceProviderEndpoint) {
  return modality === 'responses_vision' ? endpoint === 'https://api.openai.com/v1/responses' : modality === 'images' && ['https://api.openai.com/v1/images/generations', 'https://api.openai.com/v1/images/edits'].includes(endpoint);
}
function validateRequest(r: WorkspaceProviderBudgetRequest) {
  if (!r || !(['authorization_id', 'owner_id', 'task_id', 'project_id', 'operation_id', 'client_request_id', 'budget_authorization_ref', 'global_budget_authorization_ref', 'user_quota_authorization_ref', 'data_authorization_ref', 'capability_verification_ref', 'model'] as const).every(k => id(r[k]))
    || r.project_id.length > 117 || !hash(r.request_sha256) || !validEndpoint(r.modality, r.endpoint) || !amount(r.maximum_cost_microusd, 1)
    || !amount(r.request_bytes, 1) || !amount(r.input_utf8_bytes, 1) || r.input_utf8_bytes > r.request_bytes || !Array.isArray(r.input_images) || r.input_images.length > (r.modality === 'responses_vision' ? 96 : 16)
    || r.input_images.some(img => !hash(img.sha256) || !amount(img.bytes, 1) || !amount(img.width, 1) || !amount(img.height, 1) || !['image/png', 'image/jpeg', 'image/webp'].includes(img.mime_type))) fail('INVALID_PROVIDER_BUDGET_REQUEST');
  if (r.modality === 'responses_vision') {
    if (!amount(r.max_output_tokens, 1) || !r.input_images.length || r.image_options !== undefined) fail('INVALID_PROVIDER_BUDGET_REQUEST');
  } else {
    const o = r.image_options;
    if (r.max_output_tokens !== undefined || !o || o.n !== 1 || !['low', 'medium', 'high'].includes(o.quality) || !/^\d{2,4}x\d{2,4}$/.test(o.size) || !['png', 'jpeg', 'webp'].includes(o.output_format)
      || (o.operation === 'generate' ? r.endpoint !== 'https://api.openai.com/v1/images/generations' || r.input_images.length !== 0 : o.operation !== 'edit' || r.endpoint !== 'https://api.openai.com/v1/images/edits' || !r.input_images.length)) fail('INVALID_PROVIDER_BUDGET_REQUEST');
  }
}
function costTokens(tokens: WorkspaceProviderTokenBuckets, pricing: WorkspaceProviderPricing, conservative: boolean) {
  validatePricing(pricing);
  if (!buckets.every(k => amount(tokens[k]))) fail('INVALID_PROVIDER_TOKEN_BUCKETS');
  const input = BigInt(tokens.input_text_tokens) + BigInt(tokens.input_image_tokens);
  const index = pricing.tiers.findIndex(t => BigInt(t.through_input_tokens) >= input);
  if (index < 0) fail('PROVIDER_PRICING_BOUNDS_EXCEEDED');
  const tiers = conservative ? pricing.tiers.slice(0, index + 1) : [pricing.tiers[index]];
  const charge = buckets.reduce((sum, k) => sum + BigInt(tokens[k]) * BigInt(Math.max(...tiers.map(t => t.microusd_per_million[k]))), 0n);
  const result = (charge + 999_999n) / 1_000_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('PROVIDER_PRICING_BOUNDS_EXCEEDED');
  return Number(result);
}
export function workspaceMaximumProviderCost(request: WorkspaceProviderBudgetRequest, pricing: WorkspaceProviderPricing, bound: WorkspaceProviderVerifiedBound, now = Date.now()) {
  validateRequest(request); validatePricing(pricing); validateBound(bound);
  if (!current(pricing, now) || !current(bound, now) || pricing.model !== request.model || pricing.modality !== request.modality || bound.project_id !== request.project_id
    || bound.modality !== request.modality || bound.model !== request.model || bound.endpoint !== request.endpoint || bound.request_sha256 !== request.request_sha256) fail('VERIFIED_EXACT_COST_BOUND_REQUIRED');
  if (request.modality === 'responses_vision' && (bound.tokens.output_image_tokens !== 0 || bound.tokens.output_text_tokens < request.max_output_tokens!)) fail('INVALID_RESPONSES_OUTPUT_BOUND');
  return costTokens(bound.tokens, pricing, true);
}
/** Numeric-only usage is retained whole, including cached/reasoning details.
 * Cached tokens are charged at ordinary rates, never assumed free. */
export function workspaceProviderUsage(value: unknown): WorkspaceProviderUsage | undefined {
  const numeric = (v: unknown, depth = 0): boolean => v === null || amount(v) || depth < 5 && record(v) && Object.keys(v).length <= 32 && Object.entries(v).every(([k, child]) => /^[a-z][a-z0-9_]{0,79}$/.test(k) && numeric(child, depth + 1));
  if (!record(value) || !numeric(value) || !amount(value.input_tokens) || !amount(value.output_tokens) || !amount(value.total_tokens)
    || BigInt(value.input_tokens) + BigInt(value.output_tokens) !== BigInt(value.total_tokens)) return;
  for (const [name, total] of [['input_tokens_details', value.input_tokens], ['output_tokens_details', value.output_tokens]] as const) {
    const d = value[name]; if (d === undefined) continue;
    if (!record(d)) return;
    for (const key of ['text_tokens', 'image_tokens', 'cached_tokens', 'reasoning_tokens']) if (d[key] !== undefined && (!amount(d[key]) || d[key] > total)) return;
    if ((d.text_tokens !== undefined || d.image_tokens !== undefined) && (!amount(d.text_tokens) || !amount(d.image_tokens) || BigInt(d.text_tokens) + BigInt(d.image_tokens) !== BigInt(total))) return;
  }
  return structuredClone(value) as WorkspaceProviderUsage;
}
export function workspaceProviderUsageCost(usage: WorkspaceProviderUsage, pricing: WorkspaceProviderPricing) {
  if (!workspaceProviderUsage(usage)) fail('INVALID_PROVIDER_USAGE'); validatePricing(pricing);
  const tier = pricing.tiers.find(t => t.through_input_tokens >= usage.input_tokens); if (!tier) fail('PROVIDER_PRICING_BOUNDS_EXCEEDED');
  // Some Responses usage lacks an image/text split. Charge every unsplit token at
  // the greater applicable modality rate rather than undercounting image input.
  const input = usage.input_tokens_details, output = usage.output_tokens_details;
  const inputToImage = tier.microusd_per_million.input_image_tokens > tier.microusd_per_million.input_text_tokens;
  const outputToImage = tier.microusd_per_million.output_image_tokens > tier.microusd_per_million.output_text_tokens;
  return costTokens({ input_text_tokens: input?.text_tokens ?? (inputToImage ? 0 : usage.input_tokens), input_image_tokens: input?.image_tokens ?? (inputToImage ? usage.input_tokens : 0),
    output_text_tokens: output?.text_tokens ?? (outputToImage ? 0 : usage.output_tokens), output_image_tokens: output?.image_tokens ?? (outputToImage ? usage.output_tokens : 0) }, pricing, false);
}
function checkState(s: WorkspaceProviderProjectState, project: string) {
  if (!s || s.version !== 1 || s.project_id !== project || typeof s.frozen !== 'boolean' || !Array.isArray(s.owners) || !Array.isArray(s.tasks) || !Array.isArray(s.operations)) fail('BUDGET_JOURNAL_CORRUPT');
  for (const grant of [s.global, ...s.owners, ...s.tasks]) if (!grant || typeof grant.active !== 'boolean' || !id(grant.authorization_ref) || !amount(grant.cap_microusd, 1) || !Number.isFinite(Date.parse(grant.valid_from)) || !Number.isFinite(Date.parse(grant.expires_at))) fail('BUDGET_JOURNAL_CORRUPT');
  if (new Set(s.owners.map(g => g.owner_id)).size !== s.owners.length || new Set(s.tasks.map(g => [g.owner_id, g.task_id].join('/'))).size !== s.tasks.length
    || new Set(s.operations.map(o => o.reservation_id)).size !== s.operations.length || new Set(s.operations.map(o => [o.request?.owner_id, o.request?.task_id, o.request?.operation_id].join('/'))).size !== s.operations.length) fail('BUDGET_JOURNAL_CORRUPT');
  for (const op of s.operations) {
    if (!op.request || op.request.project_id !== project || !amount(op.request.maximum_cost_microusd, 1) || !['reserved', 'submission_intent', 'held', 'settled', 'released'].includes(op.state)
      || (op.charged_microusd !== undefined && !amount(op.charged_microusd)) || (op.state === 'settled' && op.charged_microusd === undefined)) fail('BUDGET_JOURNAL_CORRUPT');
  }
}
function grants(s: WorkspaceProviderProjectState, r: WorkspaceProviderBudgetRequest, now: number) {
  const owner = s.owners.find(g => g.owner_id === r.owner_id), task = s.tasks.find(g => g.owner_id === r.owner_id && g.task_id === r.task_id);
  const permission = task?.provider_authorizations?.find(p => p.modality === r.modality && p.endpoint === r.endpoint && p.model === r.model && p.capability_verification_ref === r.capability_verification_ref && p.data_authorization_ref === r.data_authorization_ref && active(p, now));
  if (s.frozen || !active(s.global, now) || !active(owner, now) || !active(task, now) || !permission || !amount(permission.maximum_request_cost_microusd, r.maximum_cost_microusd)
    || s.global.authorization_ref !== r.global_budget_authorization_ref || owner!.authorization_ref !== r.user_quota_authorization_ref || task!.authorization_ref !== r.budget_authorization_ref
    || task!.authorization_id !== r.authorization_id || !amount(task!.maximum_request_cost_microusd, r.maximum_cost_microusd)
    || task!.admission_policy_sha256 && (!active(owner?.task_policy, now) || digest(owner!.task_policy) !== task!.admission_policy_sha256)) return null;
  return { owner: owner!, task: task!, permission };
}
const operationCost = (op: WorkspaceProviderProjectState['operations'][number]) => op.state === 'released' ? 0 : op.state === 'settled' ? op.charged_microusd! : Math.max(op.request.maximum_cost_microusd, op.charged_microusd ?? 0);
function fits(s: WorkspaceProviderProjectState, r: WorkspaceProviderBudgetRequest, g: NonNullable<ReturnType<typeof grants>>, exclude?: string) {
  const total = (predicate: (op: WorkspaceProviderProjectState['operations'][number]) => boolean) => s.operations.filter(op => op.reservation_id !== exclude && predicate(op)).reduce((sum, op) => sum + BigInt(operationCost(op)), BigInt(r.maximum_cost_microusd));
  return total(() => true) <= BigInt(s.global.cap_microusd) && total(op => op.request.owner_id === r.owner_id) <= BigInt(g.owner.cap_microusd)
    && total(op => op.request.owner_id === r.owner_id && op.request.task_id === r.task_id) <= BigInt(g.task.cap_microusd);
}
function projectFromReservation(value: string) {
  if (typeof value !== 'string' || !/^b1\.[A-Za-z0-9_-]{1,267}\.[a-f0-9-]{36}$/.test(value)) fail('INVALID_BUDGET_RESERVATION');
  const project = Buffer.from(value.split('.')[1], 'base64url').toString('utf8'); if (!id(project)) fail('INVALID_BUDGET_RESERVATION'); return project;
}
export class PostgresWorkspaceProviderBudget implements WorkspaceProviderBudgetAdapter {
  readonly durable = true;
  private readonly table: string; private readonly config: WorkspaceProviderBudgetConfig;
  constructor(private readonly pool: WorkspaceSqlPool, config: WorkspaceProviderBudgetConfig) {
    if (config.schemaReviewed !== true || config.schemaVersion !== 'uid-workspace-budget-v1' || !/^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$/.test(config.qualifiedTable)) fail('BUDGET_SCHEMA_NOT_REVIEWED');
    if (!Array.isArray(config.pricing) || config.pricing.length > 32 || !Array.isArray(config.verifiedBounds) || config.verifiedBounds.length > 100_000 || !amount(config.maxOperations ?? 10_000, 1) || !amount(config.maxStateBytes ?? 16 * 1024 * 1024, 1024)) fail('INVALID_PROVIDER_BUDGET_CONFIG');
    config.pricing.forEach(validatePricing); config.verifiedBounds.forEach(validateBound);
    if (new Set(config.pricing.map(p => [p.modality, p.model].join('/'))).size !== config.pricing.length
      || new Set(config.verifiedBounds.map(b => [b.project_id, b.modality, b.endpoint, b.model, b.request_sha256].join('/'))).size !== config.verifiedBounds.length) fail('AMBIGUOUS_PROVIDER_COST_EVIDENCE');
    this.table = config.qualifiedTable.split('.').map(s => '"' + s + '"').join('.');
    if (config.boundResolver && (![config.boundResolver.review_ref, config.boundResolver.independent_evidence_ref, config.boundResolver.reviewed_by].every(id)
      || !Number.isFinite(Date.parse(config.boundResolver.verified_at)) || !Number.isFinite(Date.parse(config.boundResolver.expires_at)) || typeof config.boundResolver.resolveVerifiedBound !== 'function')) fail('INVALID_VERIFIED_BOUND_RESOLVER');
    this.config = { ...config, pricing: structuredClone(config.pricing), verifiedBounds: structuredClone(config.verifiedBounds),
      ...(config.boundResolver ? { boundResolver: { ...config.boundResolver, resolveVerifiedBound: config.boundResolver.resolveVerifiedBound.bind(config.boundResolver) } } : {}) };
  }
  private now() { return (this.config.now ?? Date.now)(); }
  readiness() {
    const now = this.now(); const pricingReady = this.config.pricing.some(p => current(p, now));
    const boundsReady = this.config.verifiedBounds.some(b => current(b, now)) || !!this.config.boundResolver && current(this.config.boundResolver, now);
    return { ready: pricingReady && boundsReady, pricing_ready: pricingReady, bounds_ready: boundsReady,
      task_authorization_verified: false as const, exact_request_bound_verified: false as const,
      blockers: [...(!pricingReady ? ['CURRENT_PROVIDER_PRICING_REQUIRED'] : []), ...(!boundsReady ? ['INDEPENDENT_PROVIDER_COST_BOUND_REQUIRED'] : [])] };
  }
  private async transaction<T>(project: string, mutate: (state: WorkspaceProviderProjectState | null) => T): Promise<T> {
    if (!id(project)) fail('INVALID_BUDGET_PROJECT'); const connection = await this.pool.connect(); let committing = false;
    try {
      await connection.query('BEGIN'); await connection.query("SET LOCAL lock_timeout = '5s'"); await connection.query("SET LOCAL statement_timeout = '15s'");
      await connection.query("SELECT set_config('uid.workspace_budget_project', $1, true)", [project]);
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['uid-workspace-budget:' + project]);
      const result = await connection.query(`SELECT state, revision FROM ${this.table} WHERE project_id = $1 FOR UPDATE`, [project]);
      if (result.rows.length > 1) fail('BUDGET_JOURNAL_CORRUPT'); const row = result.rows[0];
      const state = row ? (typeof row.state === 'string' ? JSON.parse(row.state) : structuredClone(row.state)) as WorkspaceProviderProjectState : null;
      if (state) checkState(state, project); const original = state ? JSON.stringify(state) : null; const output = mutate(state);
      if (state) {
        checkState(state, project); const json = JSON.stringify(state); if (Buffer.byteLength(json) > (this.config.maxStateBytes ?? 16 * 1024 * 1024)) fail('BUDGET_JOURNAL_FULL');
        if (json !== original) {
          const changed = await connection.query(`UPDATE ${this.table} SET state = $2::jsonb, revision = revision + 1, updated_at = now() WHERE project_id = $1 AND revision = $3 RETURNING revision`, [project, json, row.revision]);
          if (changed.rows.length !== 1) fail('BUDGET_JOURNAL_CONFLICT');
        }
      }
      committing = true; await connection.query('COMMIT'); return structuredClone(output);
    } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); if (committing) fail('BUDGET_OUTCOME_UNKNOWN'); throw error; }
    finally { connection.release(); }
  }
  /** Read only. Provisioning provider permission remains a separate operator step. */
  async authorizationFor(project: string, ownerId: string, taskId: string, selection: Pick<WorkspaceProviderBudgetRequest, 'modality' | 'endpoint' | 'model' | 'capability_verification_ref'>): Promise<WorkspaceProviderAuthorization | null> {
    if (!id(ownerId) || !id(taskId) || !id(selection.model) || !id(selection.capability_verification_ref) || !validEndpoint(selection.modality, selection.endpoint)) fail('INVALID_BUDGET_SCOPE');
    return this.transaction(project, state => {
      const owner = state?.owners.find(g => g.owner_id === ownerId), task = state?.tasks.find(g => g.owner_id === ownerId && g.task_id === taskId);
      const permission = task?.provider_authorizations?.find(p => p.modality === selection.modality && p.endpoint === selection.endpoint && p.model === selection.model && p.capability_verification_ref === selection.capability_verification_ref && active(p, this.now()));
      if (!state || state.frozen || !active(state.global, this.now()) || !active(owner, this.now()) || !active(task, this.now()) || !permission || !id(permission.data_authorization_ref)
        || !id(task!.authorization_id) || !amount(permission.maximum_request_cost_microusd, 1) || !amount(task!.maximum_request_cost_microusd, 1)
        || task!.admission_policy_sha256 && (!active(owner?.task_policy, this.now()) || digest(owner!.task_policy) !== task!.admission_policy_sha256)) return null;
      return { authorization_id: task!.authorization_id, owner_id: ownerId, task_id: taskId, project_id: project, data_destination: selection.endpoint, data_authorization_ref: permission.data_authorization_ref,
        budget_authorization_ref: task!.authorization_ref, global_budget_authorization_ref: state.global.authorization_ref, user_quota_authorization_ref: owner!.authorization_ref,
        maximum_request_cost_microusd: Math.min(task!.maximum_request_cost_microusd, permission.maximum_request_cost_microusd),
        expires_at: new Date(Math.min(...[state.global, owner!, task!, permission].map(g => Date.parse(g.expires_at)))).toISOString() };
    });
  }
  async reserve(input: WorkspaceProviderBudgetRequest): Promise<WorkspaceOpenAIBudgetReservation> {
    const request = structuredClone(input); validateRequest(request);
    let resolved: WorkspaceProviderVerifiedBound | null = null;
    const resolver = this.config.boundResolver;
    const configured = this.config.verifiedBounds.find(b => b.project_id === request.project_id && b.modality === request.modality && b.model === request.model && b.endpoint === request.endpoint && b.request_sha256 === request.request_sha256);
    if (!configured && resolver && current(resolver, this.now())) {
      try {
        const candidate = await resolver.resolveVerifiedBound(structuredClone(request));
        if (candidate) {
          validateBound(candidate);
          if (candidate.independent_evidence_ref === resolver.independent_evidence_ref && candidate.reviewed_by === resolver.reviewed_by && Date.parse(candidate.expires_at) <= Date.parse(resolver.expires_at)) resolved = structuredClone(candidate);
        }
      } catch { /* No bound means deny, never substitute a cost estimate. */ }
    }
    return this.transaction(request.project_id, state => {
      if (!state) return { status: 'denied' };
      const prior = state.operations.find(op => op.request.owner_id === request.owner_id && op.request.task_id === request.task_id && op.request.operation_id === request.operation_id);
      if (prior) return { status: digest(prior.request) === digest(request) ? 'duplicate' : 'conflict' };
      const g = grants(state, request, this.now()); if (!g || state.operations.length >= (this.config.maxOperations ?? 10_000) || !fits(state, request, g)) return { status: 'denied' };
      const pricing = this.config.pricing.find(p => p.model === request.model && p.modality === request.modality);
      const bound = configured ?? (resolver && current(resolver, this.now()) ? resolved : null);
      if (!pricing || !bound) return { status: 'denied' };
      try { if (workspaceMaximumProviderCost(request, pricing, bound, this.now()) > request.maximum_cost_microusd) return { status: 'denied' }; } catch { return { status: 'denied' }; }
      const reservation_id = 'b1.' + Buffer.from(request.project_id).toString('base64url') + '.' + randomUUID(); const at = new Date(this.now()).toISOString();
      state.operations.push({ reservation_id, request, pricing: structuredClone(pricing), bound: structuredClone(bound), ...(!configured && resolver ? { bound_resolver_review_ref: resolver.review_ref } : {}), state: 'reserved', created_at: at, updated_at: at });
      return { status: 'reserved', reservation_id, reserved_microusd: request.maximum_cost_microusd, request_sha256: request.request_sha256, cost_ceiling_verified: true, pricing_evidence_ref: pricing.evidence_ref };
    });
  }
  async markSubmissionIntent(input: WorkspaceProviderBudgetRequest & { reservation_id: string }) {
    const { reservation_id, ...request } = structuredClone(input); validateRequest(request);
    if (projectFromReservation(reservation_id) !== request.project_id) return { ok: false };
    return this.transaction(request.project_id, state => {
      const op = state?.operations.find(o => o.reservation_id === reservation_id); const g = state && grants(state, request, this.now());
      if (!state || !op || !providerOp(op) || op.state !== 'reserved' || digest(op.request) !== digest(request) || !g || !fits(state, request, g, reservation_id)) return { ok: false };
      try { if (workspaceMaximumProviderCost(request, op.pricing, op.bound, this.now()) > request.maximum_cost_microusd) return { ok: false }; } catch { return { ok: false }; }
      op.state = 'submission_intent'; op.updated_at = new Date(this.now()).toISOString(); return { ok: true };
    });
  }
  async releaseBeforeSubmit(input: { reservation_id: string; operation_id: string; request_sha256: string }) {
    const request = structuredClone(input);
    return this.transaction(projectFromReservation(request.reservation_id), state => {
      const op = state?.operations.find(o => o.reservation_id === request.reservation_id);
      if (!op || !providerOp(op) || op.request.operation_id !== request.operation_id || op.request.request_sha256 !== request.request_sha256 || !['reserved', 'released'].includes(op.state)) return { released: false };
      op.state = 'released'; op.updated_at = new Date(this.now()).toISOString(); return { released: true };
    });
  }
  async reconcile(input: WorkspaceProviderBudgetReport): Promise<{ status: 'settled' | 'held'; receipt_id: string }> {
    const report = structuredClone(input);
    return this.transaction(projectFromReservation(report.reservation_id), state => {
      const op = state?.operations.find(o => o.reservation_id === report.reservation_id);
      if (!state || !op || !providerOp(op) || !['submission_intent', 'held', 'settled'].includes(op.state) || op.request.operation_id !== report.operation_id || op.request.request_sha256 !== report.request_sha256 || op.request.client_request_id !== report.client_request_id
        || !['completed', 'known_failure', 'unknown'].includes(report.outcome) || (['provider_request_id', 'response_id', 'response_model'] as const).some(key => report[key] !== undefined && !id(report[key])) || report.http_status !== undefined && (!amount(report.http_status, 100) || report.http_status > 599)) fail('BUDGET_REPORT_SCOPE_MISMATCH');
      if (op.state === 'settled') { if (digest(op.report) !== digest(report)) fail('BUDGET_REPORT_CONFLICT'); return { status: 'settled', receipt_id: op.receipt_id! }; }
      for (const key of ['provider_request_id', 'response_id', 'response_model'] as const) {
        if (op.report?.[key] && report[key] && op.report[key] !== report[key]) fail('BUDGET_REPORT_CONFLICT');
        if (!report[key] && op.report?.[key]) report[key] = op.report[key];
      }
      const history = op.reports ??= op.report ? [structuredClone(op.report)] : [];
      if (!history.some(r => digest(r) === digest(report))) { if (history.length >= 32) fail('BUDGET_RECONCILIATION_LIMIT'); history.push(structuredClone(report)); }
      op.report = report; op.receipt_id ??= 'usage:' + randomUUID(); op.updated_at = new Date(this.now()).toISOString(); op.state = 'held';
      if (report.usage) {
        try {
          if (report.response_model && !op.pricing.accepted_response_models.includes(report.response_model)) fail('PRICING_MODEL_MISMATCH');
          const charged = workspaceProviderUsageCost(report.usage, op.pricing); op.charged_microusd = charged;
          // An exceeded bound is an incident even if a generous user cap covers it.
          const d = report.usage.input_tokens_details, o = report.usage.output_tokens_details, b = op.bound.tokens;
          if (report.usage.input_tokens > b.input_text_tokens + b.input_image_tokens || report.usage.output_tokens > b.output_text_tokens + b.output_image_tokens
            || d?.text_tokens !== undefined && d.text_tokens > b.input_text_tokens || d?.image_tokens !== undefined && d.image_tokens > b.input_image_tokens
            || o?.text_tokens !== undefined && o.text_tokens > b.output_text_tokens || o?.image_tokens !== undefined && o.image_tokens > b.output_image_tokens || charged > op.request.maximum_cost_microusd) state.frozen = true;
          else if (report.outcome !== 'unknown') op.state = 'settled';
        } catch { state.frozen = true; }
      }
      return { status: op.state === 'settled' ? 'settled' : 'held', receipt_id: op.receipt_id };
    });
  }
}

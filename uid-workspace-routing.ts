import { createHash } from 'node:crypto';
import { z } from 'zod';

/** SERVER ONLY, OFFLINE POLICY. No dispatch, environment lookup, credentials,
 * pricing constants, spend, runtime configuration or production promotion.
 * A route is a plan, never authority to call a provider or an EO/QC receipt.
 */
export const WORKSPACE_ROUTING_VERSION = 'uid-stage-routing-v1' as const;
export const WORKSPACE_ROUTE_STAGES = [
  'canonical_binding', 'fixed_mapping', 'template_validation', 'artifact_packaging',
  'source_extraction', 'product_photo_matching', 'creative_copy',
  'image_generation', 'independent_qc', 'hard_ambiguity',
] as const;
export type WorkspaceRouteStage = typeof WORKSPACE_ROUTE_STAGES[number];
const deterministic = new Set<WorkspaceRouteStage>(WORKSPACE_ROUTE_STAGES.slice(0, 4));
const inherentlyVisual = new Set<WorkspaceRouteStage>(['source_extraction', 'product_photo_matching', 'independent_qc', 'image_generation']);
const routingRequest = z.object({
  stage: z.enum(WORKSPACE_ROUTE_STAGES),
  mode: z.enum(['current_implementation', 'benchmark_candidate']).default('current_implementation'),
  // Can widen evidence requirements but cannot downgrade an inherently visual stage.
  visual_evidence_required: z.boolean().default(false),
}).strict();

export function planWorkspaceStageRouting(input: unknown) {
  const request = routingRequest.parse(input);
  const code = deterministic.has(request.stage);
  const visual = !code && (inherentlyVisual.has(request.stage) || request.visual_evidence_required);
  const image = request.stage === 'image_generation';
  const candidateTerra = request.mode === 'benchmark_candidate'
    && ['source_extraction', 'product_photo_matching', 'independent_qc'].includes(request.stage);
  const model = code || image ? null : candidateTerra ? 'gpt-6.1-terra' as const : 'gpt-6.1-sol' as const;
  const blockers: string[] = [];
  if (!code) {
    if (image) blockers.push('MISSING_PAID_IMAGE_TRANSPORT', 'MISSING_IMAGE_AWARE_BUDGET');
    else {
      if (visual) blockers.push('MISSING_IMAGE_INPUT_TRANSPORT', 'MISSING_IMAGE_INPUT_COST_BOUND');
      if (candidateTerra) blockers.push('UNSUPPORTED_MODEL_IN_CURRENT_TRANSPORT', 'UNSUPPORTED_MODEL_IN_CURRENT_BUDGET');
    }
    if (request.stage === 'independent_qc') blockers.push('MISSING_INDEPENDENT_REVIEW_PROVIDER', 'MISSING_CHILD_PAID_OPERATION_JOURNAL');
    if (request.mode === 'benchmark_candidate') blockers.push('BENCHMARK_NOT_RUN_OR_PROMOTED');
  }
  return {
    policy_version: WORKSPACE_ROUTING_VERSION,
    stage: request.stage, mode: request.mode,
    executor: code ? 'deterministic_code' as const : image ? 'separate_image_provider' as const : 'responses_text_output' as const,
    model,
    reasoning_effort: model ? request.stage === 'hard_ambiguity' ? 'high' as const : 'medium' as const : null,
    input_modality: code ? 'structured_data' as const : visual ? 'text_and_actual_images' as const : 'text' as const,
    status: blockers.length ? 'BLOCKED' as const : code ? 'OFFLINE_CODE_PATH' as const : 'TEXT_TRANSPORT_IMPLEMENTED_NOT_AUTHORIZED' as const,
    blockers,
    // Current implementation facts, not assertions about model API capability.
    current_transport: { model: 'gpt-6.1-sol' as const, input: 'text_only' as const, budget: 'sol_text_only' as const },
    independent_review_required: !code,
    exact_payload_and_artifact_binding_required: true as const,
    authorization_granted: false as const,
    auto_fallback: false as const,
    claims_quality_improvement: false as const,
  };
}

const id = z.string().min(1).max(200).refine(value => value === value.trim(), 'Exact identifier required.');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveCount = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true });
export const WORKSPACE_EO_GATES = [
  'product_fidelity', 'supported_claims', 'current_canonical', 'template_contract',
  'mobile_title_only', 'scoped_revision_integrity',
] as const;
export const WORKSPACE_QUALITY_DIMENSIONS = [
  'research_usefulness', 'product_presentation', 'visual_composition', 'typography',
] as const;
const scores = z.object({
  research_usefulness: z.number().min(0).max(5), product_presentation: z.number().min(0).max(5),
  visual_composition: z.number().min(0).max(5), typography: z.number().min(0).max(5),
}).strict();
const gateResults = z.object({
  product_fidelity: z.enum(['pass', 'fail']), supported_claims: z.enum(['pass', 'fail']),
  current_canonical: z.enum(['pass', 'fail']), template_contract: z.enum(['pass', 'fail']),
  mobile_title_only: z.enum(['pass', 'fail']), scoped_revision_integrity: z.enum(['pass', 'fail', 'not_applicable']),
}).strict();
const sharedSchema = z.object({
  canonical: z.object({ version: id, sha256: hash, current_verification_ref: id, mobile_title_rule: z.literal('title_only') }).strict(),
  template: z.object({ version: id, sha256: hash }).strict(),
  // Prompts/rubrics are fixed; route/model/effort are separate recorded variables.
  stage_prompts_sha256: hash, research_protocol_sha256: hash, quality_rubric_sha256: hash,
  image_generation: z.object({
    provider: id, model: id, configuration_sha256: hash,
    seed_scope: id,
    seed_policy: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('fixed'), seed: id }).strict(),
      z.object({ mode: z.literal('provider_has_no_seed'), nondeterminism_evidence_ref: id }).strict(),
    ]),
  }).strict(),
}).strict();
const caseSchema = z.object({
  case_id: id,
  kind: z.enum(['single_pdp', 'collection', 'gtk', 'faq', 'conflicting_sources', 'product_detail', 'mobile_title_only', 'scoped_revision']),
  source_text_sha256: hash,
  actual_source_images: z.array(z.object({
    image_id: id, sha256: hash, byte_size: positiveCount,
    media_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    width: positiveCount, height: positiveCount, pixel_inspection_ref: id,
  }).strict()).min(1).max(100),
  historical_references: z.array(z.object({
    reference_id: id, sha256: hash, use: z.literal('art_direction_only'),
    conflicts_with_current_canonical: z.boolean(),
  }).strict()).max(20),
}).strict();
const armSchema = z.object({
  arm_id: id,
  role: z.enum(['current_workflow_baseline', 'sol_vision_control', 'terra_stage_candidate', 'sol_text_diagnostic']),
  route_configuration_sha256: hash,
  // Audited full workflow provenance, NOT just a transport/model-name label.
  workflow_evidence_ref: id,
}).strict();
const operationSchema = z.object({
  operation_id: id, category: z.enum(['source_research', 'creative_copy', 'image_generation', 'quality_review', 'other']),
  provider: id, model: id, attempt: positiveCount, retry_of: id.optional(),
  request_sha256: hash,
  outcome: z.enum(['completed', 'known_failure', 'unknown']),
  accounting: z.enum(['settled', 'held']),
  settled_cost_microusd: count.nullable(), reserved_microusd: count,
  pricing_evidence_ref: id, usage_evidence_ref: id, receipt_ref: id,
}).strict();
const reviewSchema = z.object({
  reviewer_id: id, invocation_id: id, paid_operation_id: id, independence_evidence_ref: id,
  target_payload_sha256: hash, target_artifact_manifest_sha256: hash,
  source_input_sha256: hash, findings_sha256: hash,
  desktop_capture_sha256: hash, mobile_capture_sha256: hash, breakpoint_captures_sha256: hash,
  gates: gateResults,
  human: z.object({
    reviewer_id: id, review_ref: id, protocol_ref: id, presented_blind_id: id,
    arm_identity_hidden: z.literal(true),
    target_payload_sha256: hash, target_artifact_manifest_sha256: hash,
    accepted: z.boolean(), scores,
  }).strict(),
}).strict();
const runSchema = z.object({
  run_id: id, arm_id: id, case_id: id, replicate: positiveCount,
  comparison_input_sha256: hash, route_configuration_sha256: hash,
  submitted_at: timestamp, completed_at: timestamp, timing_evidence_ref: id,
  status: z.enum(['completed', 'failed']),
  generator_actor_ids: z.array(id).min(1).max(20),
  // Must come from the trusted journal, including failed and retried submissions.
  operation_journal_ref: id, operation_journal_sha256: hash,
  accounting_scope: z.literal('all_attempts_including_retries_generation_and_qc'),
  journal_complete: z.literal(true),
  operations: z.array(operationSchema).min(1).max(1000),
  rework_rounds: count,
  output: z.object({ payload_sha256: hash, artifact_manifest_sha256: hash }).strict().optional(),
  review: reviewSchema.optional(),
}).strict();

/** Strict versioned intake schema. Metadata is not proof of observed pixels,
 * payment, provenance or independence: the caller must verify referenced evidence.
 */
export const WorkspaceRoutingBenchmarkSchema = z.object({
  version: z.literal('uid-routing-benchmark-v1'), benchmark_id: id,
  protocol: z.object({
    preregistration_ref: id, preregistered_at: timestamp,
    minimum_cases: z.number().int().min(2).max(100), replicates_per_case: z.number().int().min(1).max(100),
    improvement_dimension: z.enum(WORKSPACE_QUALITY_DIMENSIONS),
    minimum_mean_quality_gain: z.number().gt(0).max(5),
    maximum_cost_ratio: z.number().gt(0).max(100), maximum_p95_latency_ratio: z.number().gt(0).max(100),
    human_blind_protocol_ref: id,
  }).strict(),
  shared: sharedSchema,
  cases: z.array(caseSchema).min(1).max(100),
  arms: z.array(armSchema).min(3).max(4),
  runs: z.array(runSchema).max(40_000),
}).strict();
export type WorkspaceRoutingBenchmark = z.infer<typeof WorkspaceRoutingBenchmarkSchema>;
type BenchmarkRun = WorkspaceRoutingBenchmark['runs'][number];
type ArmMetrics = {
  arm_id: string; role: WorkspaceRoutingBenchmark['arms'][number]['role']; runs: number;
  total_cost_microusd: number | null; known_cost_microusd: number; held_reservation_microusd: number;
  cost_by_category_microusd: Record<string, number>; cost_per_accepted_microusd: number | null;
  e2e_latency_ms: number[]; p50_latency_ms: number | null; p95_latency_ms: number | null;
  human_acceptance_rate: number; failure_rate: number; rework_rate: number;
  rework_rounds: number; retry_attempts: number; critical_failures: number;
  mean_quality: Record<typeof WORKSPACE_QUALITY_DIMENSIONS[number], number>;
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Hash validated canonical order, including exact image bytes/IDs, current pins,
 * image provider configuration and seed scope. Never fetches URLs or trusts names.
 */
export function workspaceBenchmarkInputHash(shared: unknown, inputCase: unknown): string {
  return digest({ shared: sharedSchema.parse(shared), case: caseSchema.parse(inputCase) });
}

function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]; // nearest rank, documented
}
function hardFailure(run: BenchmarkRun): boolean {
  return !!run.review && Object.values(run.review.gates).includes('fail');
}
function accepted(run: BenchmarkRun): boolean {
  return run.status === 'completed' && !!run.review?.human.accepted && !hardFailure(run);
}
function metrics(arm: WorkspaceRoutingBenchmark['arms'][number], runs: BenchmarkRun[]): ArmMetrics {
  const operations = runs.flatMap(run => run.operations);
  const knownCost = operations.reduce((sum, op) => sum + (op.settled_cost_microusd ?? 0), 0);
  const held = operations.filter(op => op.accounting === 'held').reduce((sum, op) => sum + op.reserved_microusd, 0);
  const settled = operations.every(op => op.accounting === 'settled' && op.settled_cost_microusd !== null && op.outcome !== 'unknown');
  const costs: Record<string, number> = {};
  for (const op of operations) costs[op.category] = (costs[op.category] ?? 0) + (op.settled_cost_microusd ?? 0);
  const latency = runs.map(run => Date.parse(run.completed_at) - Date.parse(run.submitted_at));
  const acceptedCount = runs.filter(accepted).length;
  const quality = Object.fromEntries(WORKSPACE_QUALITY_DIMENSIONS.map(dimension => [dimension,
    runs.length ? runs.reduce((sum, run) => sum + (run.status === 'completed' ? run.review?.human.scores[dimension] ?? 0 : 0), 0) / runs.length : 0,
  ])) as ArmMetrics['mean_quality'];
  return {
    arm_id: arm.arm_id, role: arm.role, runs: runs.length,
    total_cost_microusd: settled ? knownCost : null, known_cost_microusd: knownCost, held_reservation_microusd: held,
    cost_by_category_microusd: costs, cost_per_accepted_microusd: settled && acceptedCount ? knownCost / acceptedCount : null,
    e2e_latency_ms: latency, p50_latency_ms: percentile(latency, .5), p95_latency_ms: percentile(latency, .95),
    human_acceptance_rate: runs.length ? acceptedCount / runs.length : 0,
    failure_rate: runs.length ? runs.filter(run => run.status === 'failed' || hardFailure(run)).length / runs.length : 0,
    rework_rate: runs.length ? runs.filter(run => run.rework_rounds > 0).length / runs.length : 0,
    rework_rounds: runs.reduce((sum, run) => sum + run.rework_rounds, 0),
    retry_attempts: operations.filter(op => op.retry_of).length,
    critical_failures: runs.filter(hardFailure).length, mean_quality: quality,
  };
}

/** Offline evaluation only. Never auto-promotes, grants a budget, or equates a
 * score/metadata with verified EO. The actual current workflow is the baseline;
 * Sol vision control separates image-input effects from changing the model.
 */
export function evaluateWorkspaceRoutingBenchmark(input: unknown) {
  const parsed = WorkspaceRoutingBenchmarkSchema.safeParse(input);
  const base = { policy_version: WORKSPACE_ROUTING_VERSION, promotion_authorized: false as const,
    evidence_requires_independent_verification: true as const };
  if (!parsed.success) return { ...base, status: 'INVALID_EVIDENCE' as const, reasons: ['INVALID_BENCHMARK_SCHEMA'], metrics: [] as ArmMetrics[] };
  const manifest = parsed.data;
  const invalid = new Set<string>(), incomplete = new Set<string>();
  const unique = (values: string[], reason: string) => { if (new Set(values).size !== values.length) invalid.add(reason); };
  unique(manifest.cases.map(item => item.case_id), 'DUPLICATE_CASE');
  unique(manifest.arms.map(arm => arm.arm_id), 'DUPLICATE_ARM');
  unique(manifest.arms.map(arm => arm.role), 'DUPLICATE_ARM_ROLE');
  unique(manifest.runs.map(run => run.run_id), 'DUPLICATE_RUN');
  unique(manifest.runs.map(run => JSON.stringify([run.arm_id, run.case_id, run.replicate])), 'DUPLICATE_PAIRED_RUN');
  unique(manifest.runs.flatMap(run => run.operations.map(op => op.operation_id)), 'REUSED_PAID_OPERATION');
  unique(manifest.runs.flatMap(run => run.review ? [run.review.invocation_id] : []), 'REUSED_REVIEW_INVOCATION');
  unique(manifest.runs.flatMap(run => run.review ? [run.review.human.presented_blind_id] : []), 'REUSED_BLIND_LABEL');
  for (const role of ['current_workflow_baseline', 'sol_vision_control', 'terra_stage_candidate']) {
    if (!manifest.arms.some(arm => arm.role === role)) incomplete.add('MISSING_' + role.toUpperCase());
  }
  if (manifest.cases.length < manifest.protocol.minimum_cases) incomplete.add('INSUFFICIENT_CASES');
  const caseById = new Map(manifest.cases.map(item => [item.case_id, item]));
  const armById = new Map(manifest.arms.map(arm => [arm.arm_id, arm]));
  const pairKey = (arm: string, caseId: string, replicate: number) => JSON.stringify([arm, caseId, replicate]);
  const pairedRuns = new Map(manifest.runs.map(run => [pairKey(run.arm_id, run.case_id, run.replicate), run]));
  for (const item of manifest.cases) unique(item.actual_source_images.map(source => source.image_id), 'DUPLICATE_SOURCE_IMAGE');
  for (const arm of manifest.arms) for (const item of manifest.cases) {
    for (let replicate = 1; replicate <= manifest.protocol.replicates_per_case; replicate++) {
      if (!pairedRuns.has(pairKey(arm.arm_id, item.case_id, replicate))) incomplete.add('INCOMPLETE_PAIRED_MATRIX');
    }
  }
  for (const run of manifest.runs) {
    const item = caseById.get(run.case_id), arm = armById.get(run.arm_id);
    if (!item || !arm || run.replicate > manifest.protocol.replicates_per_case) { invalid.add('UNREGISTERED_RUN'); continue; }
    if (run.comparison_input_sha256 !== workspaceBenchmarkInputHash(manifest.shared, item)) invalid.add('COMPARISON_INPUT_MISMATCH');
    if (run.route_configuration_sha256 !== arm.route_configuration_sha256) invalid.add('ROUTE_CONFIGURATION_MISMATCH');
    if (Date.parse(run.completed_at) <= Date.parse(run.submitted_at)) invalid.add('INVALID_END_TO_END_TIMING');
    if (Date.parse(manifest.protocol.preregistered_at) >= Date.parse(run.submitted_at)) invalid.add('PROTOCOL_NOT_PREREGISTERED');
    if (run.status === 'completed' && (!run.output || !run.review)) incomplete.add('MISSING_COMPLETED_OUTPUT_OR_REVIEW');
    const operationById = new Map(run.operations.map(op => [op.operation_id, op]));
    const operationOrder = new Map(run.operations.map((op, index) => [op.operation_id, index]));
    unique(run.operations.flatMap(op => op.retry_of ? [op.retry_of] : []), 'BRANCHED_RETRY_CHAIN');
    for (const op of run.operations) {
      if (op.accounting === 'held' || op.outcome === 'unknown' || op.settled_cost_microusd === null) incomplete.add('UNRECONCILED_PAID_OPERATION');
      if (op.accounting === 'held' && op.reserved_microusd === 0) invalid.add('MISSING_HELD_RESERVATION');
      if (op.settled_cost_microusd !== null && op.settled_cost_microusd > op.reserved_microusd) invalid.add('COST_EXCEEDS_RESERVED_ENVELOPE');
      const previous = op.retry_of ? operationById.get(op.retry_of) : undefined;
      if (op.attempt > 1 && (!previous || previous.attempt !== op.attempt - 1 || previous.category !== op.category
        || previous.provider !== op.provider || previous.model !== op.model || previous.request_sha256 !== op.request_sha256
        || operationOrder.get(previous.operation_id)! >= operationOrder.get(op.operation_id)!
        || previous.outcome !== 'known_failure' || previous.accounting !== 'settled')) invalid.add('UNSAFE_OR_UNLINKED_RETRY');
      if (op.attempt === 1 && op.retry_of) invalid.add('INVALID_RETRY_SEQUENCE');
    }
    const review = run.review;
    if (review) {
      if (!run.output || review.target_payload_sha256 !== run.output.payload_sha256
        || review.target_artifact_manifest_sha256 !== run.output.artifact_manifest_sha256
        || review.source_input_sha256 !== run.comparison_input_sha256
        || review.human.target_payload_sha256 !== run.output.payload_sha256
        || review.human.target_artifact_manifest_sha256 !== run.output.artifact_manifest_sha256) invalid.add('REVIEW_SUBJECT_MISMATCH');
      const qualityOperation = operationById.get(review.paid_operation_id);
      if (!qualityOperation || qualityOperation.category !== 'quality_review' || qualityOperation.outcome !== 'completed') incomplete.add('MISSING_ACCOUNTED_INDEPENDENT_QC');
      if (run.generator_actor_ids.includes(review.reviewer_id) || run.generator_actor_ids.includes(review.human.reviewer_id)
        || review.reviewer_id === review.human.reviewer_id) invalid.add('REVIEWER_NOT_INDEPENDENT');
      if (review.human.protocol_ref !== manifest.protocol.human_blind_protocol_ref) invalid.add('BLIND_PROTOCOL_MISMATCH');
      const blindLabel = review.human.presented_blind_id.toLowerCase();
      const exposesArm = manifest.arms.some(entry => [entry.arm_id, entry.role].some(label => {
        const escaped = label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(blindLabel);
      }));
      if (exposesArm) invalid.add('UNBLINDED_REVIEW_LABEL');
      if (item.kind === 'scoped_revision' && review.gates.scoped_revision_integrity === 'not_applicable') invalid.add('MISSING_SCOPED_REVISION_GATE');
    }
  }
  const results = manifest.arms.map(arm => metrics(arm, manifest.runs.filter(run => run.arm_id === arm.arm_id)));
  for (const result of results) if (![result.known_cost_microusd, result.held_reservation_microusd, result.rework_rounds,
    ...Object.values(result.cost_by_category_microusd)].every(Number.isSafeInteger)) invalid.add('ACCOUNTING_TOTAL_OVERFLOW');
  if (invalid.size) return { ...base, status: 'INVALID_EVIDENCE' as const, reasons: [...invalid], metrics: results };
  if (incomplete.size) return { ...base, status: 'INSUFFICIENT_EVIDENCE' as const, reasons: [...incomplete], metrics: results };

  const baseline = results.find(result => result.role === 'current_workflow_baseline')!;
  const control = results.find(result => result.role === 'sol_vision_control')!;
  const candidate = results.find(result => result.role === 'terra_stage_candidate')!;
  const regressions = new Set<string>();
  if (candidate.critical_failures) regressions.add('CANDIDATE_EO_HARD_FAIL');
  // No attractive average, lower bill, or faster latency can offset a hard fail.
  for (const reference of [baseline, control]) {
    if (candidate.human_acceptance_rate < reference.human_acceptance_rate) regressions.add('HUMAN_ACCEPTANCE_REGRESSION');
    if (candidate.failure_rate > reference.failure_rate) regressions.add('FAILURE_RATE_REGRESSION');
    if (candidate.rework_rate > reference.rework_rate || candidate.rework_rounds > reference.rework_rounds) regressions.add('REWORK_REGRESSION');
    for (const candidateRun of manifest.runs.filter(run => run.arm_id === candidate.arm_id)) {
      const paired = pairedRuns.get(pairKey(reference.arm_id, candidateRun.case_id, candidateRun.replicate))!;
      if (accepted(paired) && !accepted(candidateRun)) regressions.add('PAIRED_ACCEPTANCE_REGRESSION');
      for (const dimension of WORKSPACE_QUALITY_DIMENSIONS) {
        const left = candidateRun.status === 'completed' ? candidateRun.review!.human.scores[dimension] : 0;
        const right = paired.status === 'completed' ? paired.review!.human.scores[dimension] : 0;
        if (left < right) regressions.add('PAIRED_QUALITY_REGRESSION');
      }
    }
  }
  if (regressions.size) return { ...base, status: 'REGRESSION' as const, reasons: [...regressions], metrics: results };
  const dimension = manifest.protocol.improvement_dimension;
  const qualityGain = candidate.mean_quality[dimension] - baseline.mean_quality[dimension];
  if (!candidate.human_acceptance_rate || qualityGain + Number.EPSILON < manifest.protocol.minimum_mean_quality_gain) {
    return { ...base, status: 'NO_MEASURED_QUALITY_IMPROVEMENT' as const, reasons: ['QUALITY_GAIN_REQUIRED_NOT_COST_ONLY'], metrics: results };
  }
  const efficiencyFailures: string[] = [];
  if (candidate.total_cost_microusd! > baseline.total_cost_microusd! * manifest.protocol.maximum_cost_ratio) efficiencyFailures.push('COST_GUARDRAIL_EXCEEDED');
  if (candidate.p95_latency_ms! > baseline.p95_latency_ms! * manifest.protocol.maximum_p95_latency_ratio) efficiencyFailures.push('LATENCY_GUARDRAIL_EXCEEDED');
  if (efficiencyFailures.length) return { ...base, status: 'EFFICIENCY_GUARDRAIL_FAILED' as const, reasons: efficiencyFailures, metrics: results };
  return { ...base, status: 'BENCHMARK_CRITERIA_MET_REQUIRES_REVIEW' as const,
    reasons: ['VERIFY_REFERENCED_EVIDENCE_AND_USER_ACCEPTANCE', 'NO_AUTOMATIC_MODEL_SWITCH'], metrics: results };
}

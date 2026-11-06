import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateWorkspaceRoutingBenchmark, planWorkspaceStageRouting, workspaceBenchmarkInputHash,
  WorkspaceRoutingBenchmarkSchema, type WorkspaceRoutingBenchmark, WORKSPACE_QUALITY_DIMENSIONS,
} from '../uid-workspace-routing.ts';

const h = 'a'.repeat(64), h2 = 'b'.repeat(64), h3 = 'c'.repeat(64);
function fixture(): WorkspaceRoutingBenchmark {
  const manifest: WorkspaceRoutingBenchmark = {
    version: 'uid-routing-benchmark-v1', benchmark_id: 'offline-synthetic-fixture',
    protocol: {
      preregistration_ref: 'protocol-v1', preregistered_at: '2026-11-01T00:00:00Z',
      minimum_cases: 2, replicates_per_case: 1, improvement_dimension: 'research_usefulness',
      minimum_mean_quality_gain: .25, maximum_cost_ratio: 1, maximum_p95_latency_ratio: 1,
      human_blind_protocol_ref: 'blind-v1',
    },
    shared: {
      canonical: { version: 'canonical-current', sha256: h, current_verification_ref: 'verified-current', mobile_title_rule: 'title_only' },
      template: { version: 'template-v1', sha256: h },
      stage_prompts_sha256: h, research_protocol_sha256: h, quality_rubric_sha256: h,
      image_generation: { provider: 'same-provider', model: 'pinned-image-model', configuration_sha256: h, seed_scope: 'paired-seed-scope', seed_policy: { mode: 'fixed', seed: 'fixture-seed' } },
    },
    cases: ['single_pdp', 'scoped_revision'].map((kind, index) => ({
      case_id: 'case-' + index, kind: kind as 'single_pdp' | 'scoped_revision', source_text_sha256: h,
      actual_source_images: [{ image_id: 'source-product', sha256: h, byte_size: 100, media_type: 'image/webp', width: 512, height: 512, pixel_inspection_ref: 'actual-pixel-report' }],
      historical_references: [{ reference_id: 'old-gtk', sha256: h2, use: 'art_direction_only', conflicts_with_current_canonical: true }],
    })),
    arms: [
      { arm_id: 'baseline', role: 'current_workflow_baseline', route_configuration_sha256: h, workflow_evidence_ref: 'audited-current-workflow' },
      { arm_id: 'control', role: 'sol_vision_control', route_configuration_sha256: h2, workflow_evidence_ref: 'audited-sol-vision' },
      { arm_id: 'candidate', role: 'terra_stage_candidate', route_configuration_sha256: h3, workflow_evidence_ref: 'audited-terra-stages' },
    ],
    runs: [],
  };
  for (const arm of manifest.arms) for (const [index, inputCase] of manifest.cases.entries()) {
    const runId = arm.arm_id + '-' + inputCase.case_id;
    const candidate = arm.arm_id === 'candidate';
    const inputHash = workspaceBenchmarkInputHash(manifest.shared, inputCase);
    const amount = candidate ? 100 : 150;
    manifest.runs.push({
      run_id: runId, arm_id: arm.arm_id, case_id: inputCase.case_id, replicate: 1,
      comparison_input_sha256: inputHash, route_configuration_sha256: arm.route_configuration_sha256,
      submitted_at: '2026-11-02T00:00:00.000Z', completed_at: `2026-11-02T00:00:0${candidate ? index + 1 : index + 2}.000Z`, timing_evidence_ref: 'measured-e2e-' + runId,
      status: 'completed', generator_actor_ids: ['generation-worker'],
      operation_journal_ref: 'journal-' + runId, operation_journal_sha256: h,
      accounting_scope: 'all_attempts_including_retries_generation_and_qc', journal_complete: true,
      operations: (['source_research', 'creative_copy', 'image_generation', 'quality_review'] as const).map(category => ({
        operation_id: runId + ':' + category, category, provider: 'test-provider', model: 'test-recorded-model', attempt: 1,
        request_sha256: h, outcome: 'completed', accounting: 'settled', settled_cost_microusd: amount, reserved_microusd: 500,
        pricing_evidence_ref: 'pricing-receipt', usage_evidence_ref: 'usage-' + runId + '-' + category, receipt_ref: 'settlement-' + runId + '-' + category,
      })),
      rework_rounds: 0, output: { payload_sha256: h, artifact_manifest_sha256: h2 },
      review: {
        reviewer_id: 'independent-qc-worker', invocation_id: 'qc-' + runId, paid_operation_id: runId + ':quality_review', independence_evidence_ref: 'independence-' + runId,
        target_payload_sha256: h, target_artifact_manifest_sha256: h2, source_input_sha256: inputHash, findings_sha256: h,
        desktop_capture_sha256: h, mobile_capture_sha256: h2, breakpoint_captures_sha256: h3,
        gates: { product_fidelity: 'pass', supported_claims: 'pass', current_canonical: 'pass', template_contract: 'pass', mobile_title_only: 'pass', scoped_revision_integrity: inputCase.kind === 'scoped_revision' ? 'pass' : 'not_applicable' },
        human: { reviewer_id: 'human-reviewer', review_ref: 'human-' + runId, protocol_ref: 'blind-v1', presented_blind_id: 'blind-' + manifest.runs.length, arm_identity_hidden: true,
          target_payload_sha256: h, target_artifact_manifest_sha256: h2, accepted: true,
          scores: { research_usefulness: candidate ? 4 : 3, product_presentation: 3, visual_composition: 3, typography: 3 } },
      },
    });
  }
  return manifest;
}
const candidateRuns = (manifest: WorkspaceRoutingBenchmark) => manifest.runs.filter(run => run.arm_id === 'candidate');

test('fixed mapping, template validation, binding and packaging use code, not an LLM', () => {
  for (const stage of ['canonical_binding', 'fixed_mapping', 'template_validation', 'artifact_packaging']) {
    const plan = planWorkspaceStageRouting({ stage });
    assert.equal(plan.executor, 'deterministic_code');
    assert.equal(plan.model, null);
    assert.equal(plan.status, 'OFFLINE_CODE_PATH');
    assert.equal(plan.authorization_granted, false);
  }
});
test('conservative default stays Sol text; hard ambiguity uses high without claiming permission', () => {
  const plan = planWorkspaceStageRouting({ stage: 'creative_copy' });
  assert.equal(plan.model, 'gpt-6.1-sol');
  assert.equal(plan.reasoning_effort, 'medium');
  assert.equal(plan.status, 'TEXT_TRANSPORT_IMPLEMENTED_NOT_AUTHORIZED');
  assert.equal(plan.authorization_granted, false);
  assert.equal(plan.auto_fallback, false);
  assert.equal(planWorkspaceStageRouting({ stage: 'hard_ambiguity' }).reasoning_effort, 'high');
});
test('current visual tasks cannot silently downgrade actual images to text', () => {
  for (const stage of ['source_extraction', 'product_photo_matching', 'independent_qc']) {
    const plan = planWorkspaceStageRouting({ stage, visual_evidence_required: false });
    assert.equal(plan.model, 'gpt-6.1-sol');
    assert.equal(plan.status, 'BLOCKED');
    assert.equal(plan.input_modality, 'text_and_actual_images');
    assert.ok(plan.blockers.includes('MISSING_IMAGE_INPUT_TRANSPORT'));
  }
  assert.equal(planWorkspaceStageRouting({ stage: 'hard_ambiguity', visual_evidence_required: true }).status, 'BLOCKED');
});
test('candidate Terra routes report missing model, budget, image and QC code explicitly', () => {
  const plan = planWorkspaceStageRouting({ stage: 'independent_qc', mode: 'benchmark_candidate' });
  assert.equal(plan.model, 'gpt-6.1-terra');
  assert.equal(plan.status, 'BLOCKED');
  for (const blocker of ['UNSUPPORTED_MODEL_IN_CURRENT_TRANSPORT', 'UNSUPPORTED_MODEL_IN_CURRENT_BUDGET',
    'MISSING_IMAGE_INPUT_TRANSPORT', 'MISSING_INDEPENDENT_REVIEW_PROVIDER', 'MISSING_CHILD_PAID_OPERATION_JOURNAL', 'BENCHMARK_NOT_RUN_OR_PROMOTED']) assert.ok(plan.blockers.includes(blocker));
  assert.equal(planWorkspaceStageRouting({ stage: 'creative_copy', mode: 'benchmark_candidate' }).model, 'gpt-6.1-sol');
});
test('image generation is separate and model/client overrides are rejected', () => {
  const plan = planWorkspaceStageRouting({ stage: 'image_generation' });
  assert.equal(plan.executor, 'separate_image_provider');
  assert.equal(plan.model, null);
  assert.ok(plan.blockers.includes('MISSING_IMAGE_AWARE_BUDGET'));
  for (const override of [{ model: 'gpt-6.1-terra' }, { enabled: true }, { budget_cap: 500 }, { capability: { image_input: true } }]) {
    assert.throws(() => planWorkspaceStageRouting({ stage: 'creative_copy', ...override }));
  }
  assert.throws(() => planWorkspaceStageRouting({ stage: 'invented' }));
});
test('valid synthetic evidence meets offline criteria without promotion or mutation', () => {
  const manifest = fixture(), before = structuredClone(manifest);
  const result = evaluateWorkspaceRoutingBenchmark(manifest);
  assert.equal(result.status, 'BENCHMARK_CRITERIA_MET_REQUIRES_REVIEW');
  assert.equal(result.promotion_authorized, false);
  assert.equal(result.evidence_requires_independent_verification, true);
  assert.deepEqual(manifest, before);
  const candidate = result.metrics.find(metric => metric.arm_id === 'candidate')!;
  assert.equal(candidate.total_cost_microusd, 800);
  assert.equal(candidate.cost_per_accepted_microusd, 400);
  assert.equal(candidate.cost_by_category_microusd.image_generation, 200);
  assert.equal(candidate.cost_by_category_microusd.quality_review, 200);
  assert.equal(candidate.p50_latency_ms, 1000);
  assert.equal(candidate.p95_latency_ms, 2000);
  assert.deepEqual(candidate.e2e_latency_ms, [1000, 2000]);
});
test('no paid benchmark evidence means insufficient evidence, not quality improvement', () => {
  const manifest = fixture(); manifest.runs = [];
  const result = evaluateWorkspaceRoutingBenchmark(manifest);
  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.reasons.includes('INCOMPLETE_PAIRED_MATRIX'));
  assert.equal(result.metrics[0].p95_latency_ms, null);
  assert.equal(result.metrics[0].cost_per_accepted_microusd, null);
});
test('benchmark requires actual source-image metadata and disallows unconditional historical goldens', () => {
  const noImage = fixture(); noImage.cases[0].actual_source_images = [];
  assert.equal(evaluateWorkspaceRoutingBenchmark(noImage).status, 'INVALID_EVIDENCE');
  const history = fixture(); (history.cases[0].historical_references[0] as any).use = 'approved_golden';
  assert.equal(evaluateWorkspaceRoutingBenchmark(history).status, 'INVALID_EVIDENCE');
  const oldCanonical = fixture(); (oldCanonical.shared.canonical as any).mobile_title_rule = 'tagline_allowed';
  assert.equal(evaluateWorkspaceRoutingBenchmark(oldCanonical).status, 'INVALID_EVIDENCE');
});
test('exact source bytes, current pins, prompts, image provider, seed and case scope are paired', () => {
  const changes: ((manifest: WorkspaceRoutingBenchmark) => void)[] = [
    m => { m.cases[0].actual_source_images[0].sha256 = h2; },
    m => { m.shared.canonical.sha256 = h2; }, m => { m.shared.template.sha256 = h2; },
    m => { m.shared.stage_prompts_sha256 = h2; }, m => { m.shared.image_generation.provider = 'other'; },
    m => { m.shared.image_generation.seed_scope = 'different-scope'; },
    m => { m.shared.image_generation.seed_policy = { mode: 'fixed', seed: 'different' }; },
  ];
  for (const change of changes) {
    const manifest = fixture(); change(manifest);
    assert.ok(evaluateWorkspaceRoutingBenchmark(manifest).reasons.includes('COMPARISON_INPUT_MISMATCH'));
  }
});
test('provider without seed must disclose nondeterminism instead of inventing reproducibility', () => {
  const manifest = fixture();
  manifest.shared.image_generation.seed_policy = { mode: 'provider_has_no_seed', nondeterminism_evidence_ref: 'provider-no-seed-proof' };
  for (const run of manifest.runs) {
    run.comparison_input_sha256 = workspaceBenchmarkInputHash(manifest.shared, manifest.cases.find(item => item.case_id === run.case_id)!);
    run.review!.source_input_sha256 = run.comparison_input_sha256;
  }
  assert.equal(evaluateWorkspaceRoutingBenchmark(manifest).status, 'BENCHMARK_CRITERIA_MET_REQUIRES_REVIEW');
});
test('current workflow baseline and Sol vision control cannot be replaced with Sol-text', () => {
  for (const role of ['current_workflow_baseline', 'sol_vision_control'] as const) {
    const manifest = fixture(); manifest.arms.find(arm => arm.role === role)!.role = 'sol_text_diagnostic';
    assert.ok(evaluateWorkspaceRoutingBenchmark(manifest).reasons.includes('MISSING_' + role.toUpperCase()));
  }
});
test('missing pairs, duplicate runs and changed route configuration fail closed', () => {
  const missing = fixture(); missing.runs.pop();
  assert.equal(evaluateWorkspaceRoutingBenchmark(missing).status, 'INSUFFICIENT_EVIDENCE');
  const duplicate = fixture(); duplicate.runs.push(structuredClone(duplicate.runs[0]));
  assert.ok(evaluateWorkspaceRoutingBenchmark(duplicate).reasons.includes('DUPLICATE_PAIRED_RUN'));
  const changed = fixture(); changed.runs[0].route_configuration_sha256 = h3;
  assert.ok(evaluateWorkspaceRoutingBenchmark(changed).reasons.includes('ROUTE_CONFIGURATION_MISMATCH'));
});
test('exact payload, artifact and source identity is mandatory for machine and human review', () => {
  for (const target of ['target_payload_sha256', 'target_artifact_manifest_sha256', 'source_input_sha256'] as const) {
    const manifest = fixture(); manifest.runs[0].review![target] = h3;
    assert.ok(evaluateWorkspaceRoutingBenchmark(manifest).reasons.includes('REVIEW_SUBJECT_MISMATCH'));
  }
  const manifest = fixture(); manifest.runs[0].review!.human.target_payload_sha256 = h3;
  assert.ok(evaluateWorkspaceRoutingBenchmark(manifest).reasons.includes('REVIEW_SUBJECT_MISMATCH'));
});
test('generator self-approval and reused reviewer calls are rejected', () => {
  for (const human of [false, true]) {
    const manifest = fixture();
    if (human) manifest.runs[0].review!.human.reviewer_id = 'generation-worker';
    else manifest.runs[0].review!.reviewer_id = 'generation-worker';
    assert.ok(evaluateWorkspaceRoutingBenchmark(manifest).reasons.includes('REVIEWER_NOT_INDEPENDENT'));
  }
  const manifest = fixture(); manifest.runs[1].review!.invocation_id = manifest.runs[0].review!.invocation_id;
  assert.ok(evaluateWorkspaceRoutingBenchmark(manifest).reasons.includes('REUSED_REVIEW_INVOCATION'));
});
test('human blinding and preregistered protocol are mandatory', () => {
  const unblinded = fixture(); (unblinded.runs[0].review!.human as any).arm_identity_hidden = false;
  assert.equal(evaluateWorkspaceRoutingBenchmark(unblinded).status, 'INVALID_EVIDENCE');
  const label = fixture(); label.runs[0].review!.human.presented_blind_id = label.runs[0].arm_id;
  assert.ok(evaluateWorkspaceRoutingBenchmark(label).reasons.includes('UNBLINDED_REVIEW_LABEL'));
  const posthoc = fixture(); posthoc.protocol.preregistered_at = '2026-11-03T00:00:00Z';
  assert.ok(evaluateWorkspaceRoutingBenchmark(posthoc).reasons.includes('PROTOCOL_NOT_PREREGISTERED'));
});
test('a critical EO failure vetoes higher average scores and cheaper faster outputs', () => {
  for (const gate of ['product_fidelity', 'supported_claims', 'current_canonical', 'mobile_title_only'] as const) {
    const manifest = fixture(); const run = candidateRuns(manifest)[0];
    for (const dimension of WORKSPACE_QUALITY_DIMENSIONS) run.review!.human.scores[dimension] = 5;
    run.review!.gates[gate] = 'fail';
    const result = evaluateWorkspaceRoutingBenchmark(manifest);
    assert.equal(result.status, 'REGRESSION');
    assert.ok(result.reasons.includes('CANDIDATE_EO_HARD_FAIL'));
  }
});
test('scoped revision cannot waive preservation and missing QC cannot become a pass', () => {
  const scope = fixture(); candidateRuns(scope)[1].review!.gates.scoped_revision_integrity = 'not_applicable';
  assert.ok(evaluateWorkspaceRoutingBenchmark(scope).reasons.includes('MISSING_SCOPED_REVISION_GATE'));
  const missing = fixture(); delete candidateRuns(missing)[0].review;
  assert.ok(evaluateWorkspaceRoutingBenchmark(missing).reasons.includes('MISSING_COMPLETED_OUTPUT_OR_REVIEW'));
  const unpaid = fixture(); candidateRuns(unpaid)[0].review!.paid_operation_id = 'omitted-child-call';
  assert.ok(evaluateWorkspaceRoutingBenchmark(unpaid).reasons.includes('MISSING_ACCOUNTED_INDEPENDENT_QC'));
});
test('cost savings and parity alone cannot satisfy the requested better-quality outcome', () => {
  const manifest = fixture(); for (const run of candidateRuns(manifest)) run.review!.human.scores.research_usefulness = 3;
  const result = evaluateWorkspaceRoutingBenchmark(manifest);
  assert.equal(result.status, 'NO_MEASURED_QUALITY_IMPROVEMENT');
  assert.ok(result.reasons.includes('QUALITY_GAIN_REQUIRED_NOT_COST_ONLY'));
});
test('better averages cannot conceal one paired quality regression or lower acceptance', () => {
  const quality = fixture(); const [first, second] = candidateRuns(quality);
  first.review!.human.scores.visual_composition = 2; second.review!.human.scores.visual_composition = 5;
  assert.ok(evaluateWorkspaceRoutingBenchmark(quality).reasons.includes('PAIRED_QUALITY_REGRESSION'));
  const acceptance = fixture(); candidateRuns(acceptance)[0].review!.human.accepted = false;
  assert.ok(evaluateWorkspaceRoutingBenchmark(acceptance).reasons.includes('PAIRED_ACCEPTANCE_REGRESSION'));
});
test('failed tasks and rework remain in denominators and cannot be dropped to improve metrics', () => {
  const failure = fixture(); const run = candidateRuns(failure)[0]; run.status = 'failed'; delete run.review; delete run.output;
  const failed = evaluateWorkspaceRoutingBenchmark(failure);
  assert.equal(failed.status, 'REGRESSION');
  assert.equal(failed.metrics.find(metric => metric.arm_id === 'candidate')!.failure_rate, .5);
  const rework = fixture(); candidateRuns(rework)[0].rework_rounds = 1;
  assert.ok(evaluateWorkspaceRoutingBenchmark(rework).reasons.includes('REWORK_REGRESSION'));
});
test('retries, failed attempts, generation and QC costs are all included', () => {
  const manifest = fixture(); const run = candidateRuns(manifest)[0]; const first = run.operations[0];
  first.outcome = 'known_failure';
  run.operations.push({ ...first, operation_id: 'retry-op', retry_of: first.operation_id, attempt: 2, outcome: 'completed', settled_cost_microusd: 70 });
  const result = evaluateWorkspaceRoutingBenchmark(manifest);
  const metric = result.metrics.find(item => item.arm_id === 'candidate')!;
  assert.equal(result.status, 'BENCHMARK_CRITERIA_MET_REQUIRES_REVIEW');
  assert.equal(metric.total_cost_microusd, 870);
  assert.equal(metric.retry_attempts, 1);
  assert.equal(metric.cost_by_category_microusd.source_research, 270);
});
test('unknown and held costs are not zero-cost savings or safe retries', () => {
  const manifest = fixture(); const operation = candidateRuns(manifest)[0].operations[0];
  operation.outcome = 'unknown'; operation.accounting = 'held'; operation.settled_cost_microusd = null;
  const result = evaluateWorkspaceRoutingBenchmark(manifest);
  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
  const metric = result.metrics.find(item => item.arm_id === 'candidate')!;
  assert.equal(metric.total_cost_microusd, null);
  assert.equal(metric.cost_per_accepted_microusd, null);
  assert.equal(metric.known_cost_microusd, 700);
  assert.equal(metric.held_reservation_microusd, 500);
  candidateRuns(manifest)[0].operations.push({ ...operation, operation_id: 'retry-unknown', attempt: 2, retry_of: operation.operation_id });
  assert.ok(evaluateWorkspaceRoutingBenchmark(manifest).reasons.includes('UNSAFE_OR_UNLINKED_RETRY'));
});
test('operation reuse, cost overruns, fractional amounts and missing journal coverage are rejected', () => {
  const reuse = fixture(); reuse.runs[1].operations[0].operation_id = reuse.runs[0].operations[0].operation_id;
  assert.ok(evaluateWorkspaceRoutingBenchmark(reuse).reasons.includes('REUSED_PAID_OPERATION'));
  const overrun = fixture(); overrun.runs[0].operations[0].settled_cost_microusd = 501;
  assert.ok(evaluateWorkspaceRoutingBenchmark(overrun).reasons.includes('COST_EXCEEDS_RESERVED_ENVELOPE'));
  const fraction = fixture(); fraction.runs[0].operations[0].settled_cost_microusd = .5;
  assert.equal(evaluateWorkspaceRoutingBenchmark(fraction).status, 'INVALID_EVIDENCE');
  const incomplete = fixture(); (incomplete.runs[0] as any).journal_complete = false;
  assert.equal(evaluateWorkspaceRoutingBenchmark(incomplete).status, 'INVALID_EVIDENCE');
});
test('quality gain still needs the preregistered cost and p95 latency guardrails', () => {
  const cost = fixture(); cost.protocol.maximum_cost_ratio = .5;
  assert.ok(evaluateWorkspaceRoutingBenchmark(cost).reasons.includes('COST_GUARDRAIL_EXCEEDED'));
  const latency = fixture(); candidateRuns(latency)[0].completed_at = '2026-11-02T00:01:00.000Z';
  assert.ok(evaluateWorkspaceRoutingBenchmark(latency).reasons.includes('LATENCY_GUARDRAIL_EXCEEDED'));
});
test('invalid timestamp ranges, sample sizes and permissive unknown fields fail closed', () => {
  const timing = fixture(); timing.runs[0].completed_at = timing.runs[0].submitted_at;
  assert.ok(evaluateWorkspaceRoutingBenchmark(timing).reasons.includes('INVALID_END_TO_END_TIMING'));
  const size = fixture(); size.protocol.minimum_cases = 3;
  assert.ok(evaluateWorkspaceRoutingBenchmark(size).reasons.includes('INSUFFICIENT_CASES'));
  const override = { ...fixture(), auto_promote: true };
  assert.equal(evaluateWorkspaceRoutingBenchmark(override).status, 'INVALID_EVIDENCE');
  assert.equal(WorkspaceRoutingBenchmarkSchema.safeParse({ ...fixture(), version: 'unknown' }).success, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as reviewModule from '../supabase/functions/_shared/feedback-review.ts';
import { buildOwnerRulePlan } from '../supabase/functions/_shared/owner-rule-plan.ts';

const { prepareAutomaticReview, assessMechanicalCandidates, REVIEW_EVALUATOR_VERSION } = reviewModule;
const reviewIntentHash = 'intent-v1:guided-owner-proposal-scope';
const baseline = {
  id: 'baseline-guided-1', brand_id: 'brand-guided-1', branch_slug: 'uncompiled-product-guide',
  case_key: 'Product identity', approved_at: '2026-10-01T00:00:00Z',
  source_brief: { product: 'Comfort T-Shirt' },
  approved_output: { title: 'Comfort T-Shirt', material: 'cotton' },
  expected_assertions: {
    required_text: ['T-Shirt'], required_keys: ['title'], forbidden_text: ['cure'],
    immutable_fields: ['material'],
  },
};
const target = {
  id: 'node-guided-1', brand_id: baseline.brand_id, brand_name: 'Synthetic guided brand',
  slug: baseline.branch_slug, title: 'Onepage', node_hash: 'node-v2:current',
  content_md: 'Current canonical product rules.',
};
const context = {
  proposal: {
    id: 'proposal-guided-1', status: 'pending',
    raw_feedback: 'Preserve product identity in the candidate.',
    proposed_content_md: 'Preserve product identity in the candidate.',
    context_images: [{ role: 'product_source', image_url: 'https://example.test/stored-reference.png', reference_id: 'stored-reference-1', caption: 'Stored product reference' }],
  },
  candidate_hash: 'scope-v2:guided-current', targets: [target], baselines: [baseline],
  evaluations: [], covered_candidates: [],
};
const run = {
  baseline_id: baseline.id, source_run_id: 'stored-guided-run-1',
  artifact_url: 'https://example.test/stored-guided-artifact.png',
  output: { title: 'Comfort T-Shirt', material: 'cotton' },
};
const storedResult = {
  baseline_id: baseline.id, case_key: baseline.case_key, status: 'passed', issues: [],
  source_run_id: run.source_run_id, artifact_url: run.artifact_url, candidate_output: run.output,
};
const trustedEvaluation = {
  id: 'stored-guided-evaluation-1', proposal_id: context.proposal.id,
  candidate_hash: context.candidate_hash, evaluation_status: 'passed',
  completed_at: '2026-10-12T00:00:00Z', critical_failures: 0,
  evaluator_version: REVIEW_EVALUATOR_VERSION, baseline_ids: [baseline.id],
  test_results: [storedResult],
  conflict_results: [{
    actor_user_id: 'stored-admin-reviewer', manually_reviewed: true,
    product_truth_verified: true, visual_reviewed: true, issues: [],
    note: 'Stored product-truth, artifact and conflict review completed by an administrator.',
  }],
};
const candidateOnlyEvaluation = {
  ...trustedEvaluation, id: 'stored-candidate-only-1', evaluation_status: 'blocked',
  conflict_results: [],
};
const withEvaluation = (evaluation: any = trustedEvaluation) => ({ ...context, evaluations: [evaluation] });

function assertBlocked(result: any, expectedStatus?: string) {
  if (expectedStatus) assert.equal(result.status, expectedStatus);
  assert.notEqual(result.status, 'ready_to_merge');
  assert.equal(result.evaluation_id, null);
  assert.equal(result.candidate_hash, context.candidate_hash);
  assert.ok(Array.isArray(result.blockers) && result.blockers.length > 0);
  for (const blocker of result.blockers) {
    for (const key of ['code', 'message', 'next_action']) {
      assert.equal(typeof blocker[key], 'string', `blocker must explain ${key}`);
      assert.ok(blocker[key].trim().length > 0, `blocker ${key} must be useful`);
    }
  }
}

test('mechanical assessment runs without human review declarations and preserves legacy review requirements', () => {
  const mechanical = assessMechanicalCandidates(context, [run]);
  assert.equal(mechanical.status, 'passed');
  assert.equal(mechanical.critical_failures, 0);
  assert.equal(mechanical.results.length, 1);
  assert.equal(mechanical.results[0].status, 'passed');
  assert.deepEqual(mechanical.issues, []);
  assert.equal(reviewModule.assessReviewCandidates(context, [run], {}).status, 'blocked');
});

test('guided preparation blocks missing, unapproved and reference-only baseline coverage', () => {
  const cases = [
    [],
    [{ ...baseline, approved_at: null }],
    [{ ...baseline, approved_output: { schema_version: 'onepage.bounded-reference-output.v1' } }],
    [{ ...baseline, source_brief: { reference_scope: 'USER_APPROVED_CORPUS_LIMITED_EVIDENCE_SCHEMA_AND_STRUCTURE' } }],
  ];
  for (const baselines of cases) {
    const prepared = prepareAutomaticReview({ ...withEvaluation(), baselines });
    assertBlocked(prepared, 'needs_baseline');
    assert.notEqual(prepared.checks.mechanical, 'passed');
  }
  assertBlocked(prepareAutomaticReview({
    ...withEvaluation(), targets: [target, { ...target, id: 'node-other', brand_id: 'brand-other', brand_name: 'Uncovered brand' }],
  }), 'needs_baseline');
});

test('guided preparation blocks absent candidates and never reuses stale-snapshot candidate runs', () => {
  assertBlocked(prepareAutomaticReview(context), 'needs_candidate');
  const stale = prepareAutomaticReview(withEvaluation({ ...trustedEvaluation, candidate_hash: 'scope-v2:stale' }));
  assertBlocked(stale, 'needs_candidate');
  assert.equal(stale.candidate_runs.length, 0);
  assertBlocked(prepareAutomaticReview(withEvaluation({ ...candidateOnlyEvaluation, test_results: [] })), 'needs_candidate');
});

test('stored candidate outputs pass mechanical checks but do not fabricate actual media review', () => {
  const prepared = prepareAutomaticReview(withEvaluation(candidateOnlyEvaluation));
  assertBlocked(prepared, 'needs_actual_review');
  assert.equal(prepared.checks.mechanical, 'passed');
  assert.equal(prepared.checks.actual_review, 'required');
  assert.equal(prepared.candidate_runs.length, 1);
  assert.equal(prepared.candidate_runs[0].source_run_id, run.source_run_id);
  assert.equal(prepared.candidate_runs[0].artifact_url, run.artifact_url);
  assert.ok(prepared.evidence);
});

test('guided preparation reuses only a complete exact-current trusted evaluation', () => {
  const prepared = prepareAutomaticReview(withEvaluation());
  assert.equal(prepared.status, 'ready_to_merge');
  assert.equal(prepared.evaluation_id, trustedEvaluation.id);
  assert.equal(prepared.candidate_hash, context.candidate_hash);
  assert.equal(prepared.checks.mechanical, 'passed');
  assert.equal(prepared.checks.actual_review, 'verified');
  assert.deepEqual(prepared.blockers, []);
});

test('guided preparation uses a reviewed evaluation as one set rather than mixing in newer unreviewed output', () => {
  const newerUnreviewed = {
    ...candidateOnlyEvaluation,
    test_results: [{ ...storedResult, source_run_id: 'new-unreviewed-run', candidate_output: { title: 'T-Shirt cure', material: 'cotton' } }],
  };
  const prepared = prepareAutomaticReview({ ...context, evaluations: [newerUnreviewed, trustedEvaluation] });
  assert.equal(prepared.status, 'ready_to_merge');
  assert.equal(prepared.evaluation_id, trustedEvaluation.id);
  assert.equal(prepared.candidate_runs[0].source_run_id, run.source_run_id);
  assert.deepEqual(prepared.candidate_runs[0].output, run.output);
});

test('separate incomplete evaluations cannot be combined into a fabricated passed review', () => {
  const secondBaseline = { ...baseline, id: 'baseline-guided-2', case_key: 'Alternate layout' };
  const secondPartialEvaluation = {
    ...trustedEvaluation, id: 'partial-review-2', baseline_ids: [secondBaseline.id],
    test_results: [{ ...storedResult, baseline_id: secondBaseline.id, case_key: secondBaseline.case_key, source_run_id: 'stored-guided-run-2' }],
  };
  const prepared = prepareAutomaticReview({
    ...context, baselines: [baseline, secondBaseline], evaluations: [trustedEvaluation, secondPartialEvaluation],
  });
  assertBlocked(prepared, 'needs_actual_review');
  assert.equal(prepared.checks.mechanical, 'passed');
  assert.equal(prepared.checks.actual_review, 'required');
  assert.equal(prepared.candidate_runs.length, 2);
});

test('guided preparation rejects incomplete legacy reviews despite candidate pass labels', () => {
  for (const change of [
    { evaluator_version: 'untrusted-evaluator' },
    { completed_at: null },
    { critical_failures: 1 },
    { evaluation_status: 'failed' },
    { baseline_ids: [] },
    { conflict_results: [] },
    { conflict_results: [{ ...trustedEvaluation.conflict_results[0], actor_user_id: '' }] },
    { conflict_results: [{ ...trustedEvaluation.conflict_results[0], manually_reviewed: false }] },
    { conflict_results: [{ ...trustedEvaluation.conflict_results[0], visual_reviewed: false }] },
    { conflict_results: [{ ...trustedEvaluation.conflict_results[0], product_truth_verified: false }] },
    { conflict_results: [{ ...trustedEvaluation.conflict_results[0], issues: ['Unresolved product truth'] }] },
    { conflict_results: [{ ...trustedEvaluation.conflict_results[0], note: 'done' }] },
  ]) {
    const prepared = prepareAutomaticReview(withEvaluation({ ...trustedEvaluation, ...change }));
    assertBlocked(prepared);
    assert.equal(prepared.checks.actual_review, 'required');
  }
});

test('guided preparation reruns assertions instead of trusting a stored passed result', () => {
  for (const output of [
    { title: 'Generic item', material: 'cotton' },
    { title: 'T-Shirt cure', material: 'cotton' },
    { title: 'T-Shirt', material: 'polyester' },
    { label: 'T-Shirt', material: 'cotton' },
  ]) {
    const prepared = prepareAutomaticReview(withEvaluation({
      ...trustedEvaluation, test_results: [{ ...storedResult, candidate_output: output }],
    }));
    assertBlocked(prepared, 'checks_failed');
    assert.equal(prepared.checks.mechanical, 'failed');
  }
});

test('guided preparation blocks malformed assertions and incomplete or duplicate artifacts', () => {
  const invalidAssertions = prepareAutomaticReview({
    ...withEvaluation(), baselines: [{ ...baseline, expected_assertions: { required_text: 'not-an-array' } }],
  });
  assertBlocked(invalidAssertions, 'checks_failed');
  for (const test_results of [
    [storedResult, storedResult],
    [{ ...storedResult, candidate_output: {} }],
    [{ ...storedResult, candidate_output: [] }],
    [{ ...storedResult, source_run_id: '' }],
    [{ ...storedResult, artifact_url: 'javascript:alert(1)' }],
    [{ ...storedResult, baseline_id: 'unknown-baseline' }],
  ]) {
    assertBlocked(prepareAutomaticReview(withEvaluation({ ...trustedEvaluation, test_results })));
  }
});

test('guided preparation requires candidate coverage for every eligible baseline', () => {
  const prepared = prepareAutomaticReview({
    ...withEvaluation(), baselines: [baseline, { ...baseline, id: 'baseline-guided-2', case_key: 'Alternate layout' }],
  });
  assertBlocked(prepared);
});

test('guided preparation cannot ready an unavailable scope or a proposal that is no longer pending', () => {
  assertBlocked(prepareAutomaticReview({ ...withEvaluation(), targets: [] }), 'blocked');
  for (const status of ['merged', 'rejected', 'resolved']) {
    assertBlocked(prepareAutomaticReview({ ...withEvaluation(), proposal: { ...context.proposal, status } }), 'blocked');
  }
});

test('host handoff remains informational and does not itself dispatch a reviewer', () => {
  const prepared = prepareAutomaticReview(withEvaluation(candidateOnlyEvaluation));
  assert.equal(prepared.host_review.available, false);
  assert.equal(typeof prepared.host_review.packet_version, 'string');
  assert.ok(prepared.host_review.packet_version.length > 0);
  assert.equal(typeof prepared.host_review.instruction, 'string');
  assert.match(prepared.host_review.instruction, /not (?:running|connected|available)|no .*reviewer|does not dispatch a reviewer|chưa|không/i);
  assert.ok(Array.isArray(prepared.host_review.required_capabilities));
  assert.ok(prepared.host_review.required_capabilities.length > 0);
  assert.match(prepared.host_review.instruction, /untrusted data/i);
  assert.equal(prepared.host_review.packet.candidate_hash, context.candidate_hash);
  assert.deepEqual(prepared.host_review.packet.proposal, context.proposal);
  assert.deepEqual(prepared.host_review.packet.candidate_runs, prepared.candidate_runs);
  assert.ok(prepared.evidence.some((e: any) => e.reference_id === 'stored-reference-1' && e.url === context.proposal.context_images[0].image_url));
  for (const key of ['authorization', 'access_token', 'service_role_key', 'api_key']) {
    assert.equal(Object.hasOwn(prepared.host_review, key), false);
  }
});

test('automatic preparation is deterministic and leaves the stored context untouched', () => {
  const input = structuredClone(withEvaluation(candidateOnlyEvaluation));
  const before = structuredClone(input);
  const first = prepareAutomaticReview(input);
  assert.deepEqual(input, before);
  assert.deepEqual(prepareAutomaticReview(input), first);
});

// Execute the real Edge handler with synthetic Supabase and network boundaries.
// No request can reach an external service, and all unexpected DB writes fail the test.
const edgeCode = transformSync(
  readFileSync('supabase/functions/creative-dna-admin-feedback/index.ts', 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default', 'const handler =')
    + '\nglobalThis.handler = handler;',
  { loader: 'ts' },
).code;

type EdgeOptions = {
  context?: any; user?: { id: string } | null; role?: string; active?: boolean;
  contextError?: string; hash?: string; hashError?: string; mergeError?: string;
};
async function invoke(payload: any, options: EdgeOptions = {}) {
  const rpcCalls: { name: string; args: any }[] = [];
  const tableCalls: string[] = [];
  const storedContext = Object.hasOwn(options, 'context') ? options.context : context;
  const member = {
    select: () => member, eq: () => member,
    maybeSingle: async () => ({ data: { role: options.role ?? 'admin', is_active: options.active ?? true } }),
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: Object.hasOwn(options, 'user') ? options.user : { id: 'verified-admin-user' } } }) },
    from: (table: string) => {
      tableCalls.push(table);
      assert.equal(table, 'creative_dna_team_members', 'guided review must not insert client evaluations or mutate canonical tables directly');
      return member;
    },
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      if (name === 'uid_review_preflight') {
        return options.contextError ? { error: { message: options.contextError } } : {
          data: storedContext ? { ...storedContext, review_intent_hash: reviewIntentHash, review_request: null } : null,
        };

      }
      if (name === 'uid_governance_candidate_hash') {
        return options.hashError ? { error: { message: options.hashError } } : { data: options.hash ?? storedContext?.candidate_hash };
      }
      if (name === 'uid_review_enqueue') return { data: { id: 'synthetic-guided-queue-request', proposal_id: context.proposal.id, status: 'queued' } };
      assert.equal(name, 'uid_governance_accept_merge', 'only the existing protected merge RPC may write');
      return options.mergeError ? { error: { message: options.mergeError } } : {
        data: { proposal_id: context.proposal.id, status: 'merged', merged_at: '2026-10-13T00:00:00Z', merged_nodes: [target.id], cross_brand_sync: false },
      };
    },
  };
  const sandbox: any = {
    ...reviewModule, buildOwnerRulePlan, Response, Request, URL,
    Deno: { env: { get: () => 'synthetic-test-value' } }, createClient: () => client,
    fetch: async () => { assert.fail('the backend must not fetch candidate media or a host reviewer'); },
  };
  vm.runInNewContext(edgeCode, sandbox);
  const response = await sandbox.handler.fetch(new Request('https://example.test/admin', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic-admin-session', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  return { response, body: await response.json(), rpcCalls, tableCalls };
}
const processPayload = {
  mode: 'process_review', proposal_id: context.proposal.id,
  review_intent_hash: reviewIntentHash, approve: true,
};
const mergeCalls = (result: Awaited<ReturnType<typeof invoke>>) => result.rpcCalls.filter(call => call.name === 'uid_governance_accept_merge');

test('process_review rejects unauthenticated, non-admin and inactive users before any review RPC', async () => {
  for (const [options, status] of [
    [{ user: null }, 401], [{ role: 'editor' }, 403], [{ active: false }, 403],
  ] as [EdgeOptions, number][]) {
    const result = await invoke(processPayload, options);
    assert.equal(result.response.status, status);
    assert.equal(result.rpcCalls.length, 0);
  }
});

test('process_review requires an explicit boolean approval', async () => {
  for (const approve of [undefined, false, 'true', 1]) {
    const result = await invoke({ ...processPayload, approve }, { context: withEvaluation() });
    assert.ok([400, 422].includes(result.response.status));
    assert.equal(mergeCalls(result).length, 0);
  }
});

test('process_review rejects missing and stale owner-bound intent hashes before merging', async () => {
  for (const review_intent_hash of [undefined, '', 'intent-v1:stale']) {
    const result = await invoke({ ...processPayload, review_intent_hash }, { context: withEvaluation() });
    assert.ok(review_intent_hash ? result.response.status === 409 : [400, 409, 422].includes(result.response.status));
    assert.equal(mergeCalls(result).length, 0);
  }
});

test('process_review ignores client candidate outputs, evaluation IDs and attestations', async () => {
  const result = await invoke({
    ...processPayload, actor_user_id: 'forged-admin', evaluation_id: trustedEvaluation.id,
    candidate_runs: [run], evaluations: [trustedEvaluation], review: {
      product_truth_verified: true, visual_reviewed: true, conflicts_reviewed: true,
      critical_regressions: 0, review_note: 'Client supplied review must never be accepted by this automatic route.',
    },
    automatic_review: { status: 'ready_to_merge', evaluation_id: trustedEvaluation.id },
    host_review: { available: true, status: 'passed', authorized: true },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'queued');
  assert.equal(result.body.automatic_review.status, 'needs_candidate');
  assert.equal(result.body.canonical_changed, false);
  assert.equal(result.body.automatic_review.evaluation_id, null);
  assert.equal(mergeCalls(result).length, 0);
  assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight', 'uid_review_enqueue']);

});

test('process_review queues bounded approval with actionable blockers and makes no canonical changes', async () => {
  const cases = [
    [{ ...context, baselines: [] }, 'needs_baseline'],
    [context, 'needs_candidate'],
    [withEvaluation(candidateOnlyEvaluation), 'needs_actual_review'],
    [withEvaluation({ ...trustedEvaluation, test_results: [{ ...storedResult, candidate_output: { title: 'T-Shirt cure', material: 'cotton' } }] }), 'checks_failed'],
  ] as const;
  for (const [storedContext, expectedStatus] of cases) {
    const result = await invoke(processPayload, { context: storedContext });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, 'queued');
    assert.equal(result.body.canonical_changed, false);
    assert.equal(result.body.approval_recorded, true);
    assert.equal(result.body.background_task_started, false);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
    assertBlocked(result.body.automatic_review, expectedStatus);
    assert.equal(mergeCalls(result).length, 0);
  }
});

test('process_review merges through guarded SQL using only the stored evaluation and authenticated actor', async () => {
  const result = await invoke({
    ...processPayload, actor_user_id: 'forged-admin', evaluation_id: 'forged-evaluation',
    review_note: 'CLIENT TEXT MUST NOT ENTER THE AUDIT LOG',
  }, { context: withEvaluation() });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'merged');
  assert.equal(result.body.proposal.id, context.proposal.id);
  assert.equal(result.body.proposal.status, 'merged');
  assert.equal(result.body.canonical_changed, true);
  assert.equal(mergeCalls(result).length, 1);
  const args = mergeCalls(result)[0].args;
  assert.equal(args.p_proposal_id, context.proposal.id);
  assert.equal(args.p_actor_user_id, 'verified-admin-user');
  assert.equal(args.p_evaluation_id, trustedEvaluation.id);
  assert.equal(typeof args.p_review_note, 'string');
  assert.ok(args.p_review_note.trim().length > 0);
  assert.doesNotMatch(args.p_review_note, /CLIENT TEXT|I (?:reviewed|verified)|AI (?:reviewed|verified)/i);
  assert.match(args.p_review_note, /stored|existing|evaluation/i);
});

test('process_review preserves protected SQL stale-state rejection without pretending to merge', async () => {
  const result = await invoke(processPayload, {
    context: withEvaluation(), mergeError: 'Proposal, scope, canonical nodes or baselines changed after evaluation',
  });
  assert.equal(result.response.status, 409);
  assert.match(result.body.error, /changed/);
  assert.notEqual(result.body.status, 'merged');
  assert.equal(mergeCalls(result).length, 1);
});

test('process_review rejects missing or nonpending proposals and unavailable context', async () => {
  for (const options of [
    { context: null },
    { context: { ...withEvaluation(), proposal: { ...context.proposal, status: 'merged' } } },
    { contextError: 'Cannot read review context' },
  ]) {
    const result = await invoke(processPayload, options);
    assert.ok([404, 409, 500].includes(result.response.status));
    assert.equal(mergeCalls(result).length, 0);
  }
});

test('review_preflight adds automatic review without writing, fetching artifacts or caching the snapshot', async () => {
  const result = await invoke({ mode: 'review_preflight', proposal_id: context.proposal.id }, { context: withEvaluation(candidateOnlyEvaluation) });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.body.proposal.id, context.proposal.id);
  assert.equal(result.body.candidate_hash, context.candidate_hash);
  assert.equal(result.body.automatic_evaluation_id, null);
  assert.equal(result.body.automatic_review.status, 'needs_actual_review');
  assert.equal(result.body.automatic_review.host_review.available, false);
  assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight']);
  assert.equal(result.body.review_request, null);
  assert.equal(result.body.review_intent_hash, reviewIntentHash);
  assert.equal(result.rpcCalls[0].args.p_actor_user_id, 'verified-admin-user');
  assert.equal(result.body.queue_available, true);

  assert.equal(mergeCalls(result).length, 0);
});


test('compiled outcome routes retain honest review attribution but cannot use legacy append merge', async()=>{
  for(const change of [
    {targets:[{...target,slug:'onepage-system'}]},
    {targets:[{...target,slug:'brand-dna'}]},
    {targets:[{...target,metadata:{creative_quality_contract:{schema_version:'uid-creative-quality/1'}}}]},
    {compiler_context:{dependent_nodes:[{id:'dependent-child'}]}},
  ]) {
    const result=await invoke(processPayload,{context:{...withEvaluation(),...change}});
    assert.equal(result.response.status,200);
    assert.equal(result.body.status,'queued');
    assert.equal(result.body.automatic_review.status,'blocked');
    assert.ok(result.rpcCalls.some((r:any)=>r.name==='uid_review_enqueue'));
    assert.equal(result.body.canonical_changed,false);
    assert.ok(result.body.automatic_review.blockers.some((b:any)=>b.code==='compiler_integration_required'));
    assert.ok(!result.rpcCalls.some((r:any)=>r.name==='uid_governance_accept_merge'));
  }
});

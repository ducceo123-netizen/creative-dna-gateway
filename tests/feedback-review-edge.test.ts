import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { once } from 'node:events';
import { createApp } from '../server.ts';
import { reviewReadiness, assessReviewCandidates, isReferenceOnlyBaseline, REVIEW_EVALUATOR_VERSION } from '../supabase/functions/_shared/feedback-review.ts';

const baseline = { id: 'base-1', brand_id: 'brand-1', branch_slug: 'onepage-system', case_key: 'Product identity', approved_at: '2026-10-01', approved_output: { title: 'Comfort T-Shirt' }, expected_assertions: { required_text: ['T-Shirt'], required_keys: ['title'], forbidden_text: ['cure'] } };
const target = { id: 'node-1', brand_id: 'brand-1', brand_name: 'Synthetic brand', slug: 'onepage-system', title: 'Onepage', node_hash: 'node-v1', content_md: 'Canonical rules' };
const context = { proposal: { id: 'proposal-1', status: 'pending' }, candidate_hash: 'scope-v2:current', targets: [target], baselines: [baseline], evaluations: [], covered_candidates: [] };
const review = { product_truth_verified: true, visual_reviewed: true, conflicts_reviewed: true, critical_regressions: 0, review_note: 'Synthetic human review, product identity and visual result verified.' };
const run = { baseline_id: baseline.id, source_run_id: 'actual-test-fixture-run', artifact_url: 'https://example.test/synthetic-artifact', output: { title: 'Comfort T-Shirt' } };
const evaluation = { id: 'evaluation-1', candidate_hash: context.candidate_hash, evaluation_status: 'passed', completed_at: '2026-10-12', critical_failures: 0, evaluator_version: REVIEW_EVALUATOR_VERSION, baseline_ids: [baseline.id], test_results: [{ baseline_id: baseline.id, status: 'passed', case_key: baseline.case_key, source_run_id: run.source_run_id, artifact_url: run.artifact_url, candidate_output: run.output, issues: [] }], conflict_results: [{ actor_user_id: 'verified-user', manually_reviewed: true, product_truth_verified: true, visual_reviewed: true, note: review.review_note, issues: [] }] };

test('fresh passed evaluation binds automatically; stale/legacy/incomplete/duplicate evaluations fail closed', () => {
  assert.equal(reviewReadiness({ ...context, evaluations: [evaluation] }).automatic_evaluation_id, evaluation.id);
  for (const change of [{ candidate_hash: 'old' }, { evaluator_version: 'mechanical-v1-plus-human-review' }, { completed_at: null }, { critical_failures: 1 }, { baseline_ids: [] }, { test_results: [] }, { conflict_results: [] }, { conflict_results: [{ ...evaluation.conflict_results[0], issues: ['missing'] }] }, { test_results: [{ ...evaluation.test_results[0], candidate_output: {} }] }, { test_results: [{ baseline_id: baseline.id, status: 'failed' }] }]) {
    assert.equal(reviewReadiness({ ...context, evaluations: [{ ...evaluation, ...change }] }).automatic_evaluation_id, null);
  }
  assert.equal(reviewReadiness({ ...context, baselines: [baseline, { ...baseline, id: 'base-2' }], evaluations: [{ ...evaluation, baseline_ids: ['base-1', 'base-2'], test_results: [evaluation.test_results[0], evaluation.test_results[0]] }] }).automatic_evaluation_id, null);
});
test('reference corpus never satisfies candidate quality baseline coverage', () => {
  const reference = { ...baseline, approved_output: { schema_version: 'onepage.bounded-reference-output.v1' } };
  assert.equal(isReferenceOnlyBaseline(reference), true);
  assert.equal(isReferenceOnlyBaseline({ approved_output: { reference_scope: 'USER_APPROVED_CORPUS_LIMITED_EVIDENCE_SCHEMA_AND_STRUCTURE' } }), true);
  const result = reviewReadiness({ ...context, baselines: [reference], targets: [target, { ...target, id: 'node-2', brand_id: 'brand-2', brand_name: 'SoulPrise' }], evaluations: [evaluation] });
  assert.match(result.issues.join(' '), /Synthetic brand: saved reference corpus is reference-only/);
  assert.match(result.issues.join(' '), /SoulPrise: missing/);
  assert.equal(result.automatic_evaluation_id, null);
  assert.equal(assessReviewCandidates({ ...context, baselines: [reference] }, [run], review).status, 'blocked');
});
test('evaluation requires one actual candidate per named baseline and explicit human review', () => {
  assert.equal(assessReviewCandidates(context, [run], review).status, 'passed');
  assert.equal(assessReviewCandidates(context, [], review).status, 'failed');
  assert.equal(assessReviewCandidates({ ...context, baselines: [{ ...baseline, expected_assertions: { forbidden_text: ['bad'] } }] }, [{ ...run, output: {} }], review).status, 'failed');
  assert.equal(assessReviewCandidates(context, [run, run], review).status, 'failed');
  assert.equal(assessReviewCandidates(context, [{ ...run, artifact_url: 'javascript:alert(1)' }], review).status, 'failed');
  assert.equal(assessReviewCandidates(context, [run], { ...review, visual_reviewed: false }).status, 'blocked');
  assert.equal(assessReviewCandidates(context, [{ ...run, output: { title: 'Generic promise cure' } }], review).status, 'failed');
  const invalid = assessReviewCandidates({ ...context, baselines: [{ ...baseline, expected_assertions: { required_text: 'not an array' } }] }, [run], review);
  assert.equal(invalid.status, 'failed'); assert.match(invalid.results[0].issues.join(' '), /format is invalid/);
  for (const expected_assertions of [{ immutable_fields: ['missing'] }, { required_text: [''] }, { required_keys: ['  '] }]) {
    assert.equal(assessReviewCandidates({ ...context, baselines: [{ ...baseline, expected_assertions }] }, [run], review).status, 'failed');
  }
  assert.equal(assessReviewCandidates(context, [run, { ...run, baseline_id: 'unexpected' }], review).status, 'blocked');
  assert.equal(assessReviewCandidates({ ...context, targets: [target, { ...target, id: 'node-2', brand_id: 'brand-2', brand_name: 'Missing brand' }] }, [run], review).status, 'blocked');
});

const edgeCode = transformSync(readFileSync('supabase/functions/creative-dna-admin-feedback/index.ts', 'utf8').replace(/^import .*;\n/gm, '').replace('export default', 'const handler =') + '\nglobalThis.handler = handler;', { loader: 'ts' }).code;
async function invoke(payload: any, options: { hash?: string; rpcError?: string; missing?: boolean } = {}) {
  const rpcCalls: any[] = [], inserts: any[] = [];
  const member = { select: () => member, eq: () => member, maybeSingle: async () => ({ data: { role: 'admin', is_active: true } }) };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'verified-user' } } }) },
    rpc: async (name: string, args: any) => { rpcCalls.push({ name, args }); return options.rpcError ? { error: { message: options.rpcError } } : { data: name === 'uid_governance_review_context' ? options.missing ? null : context : name === 'uid_governance_candidate_hash' ? options.hash || context.candidate_hash : { status: 'resolved', proposal_id: 'proposal-1', resolution: { type: 'already_covered' } } }; },
    from: (name: string) => { if (name === 'creative_dna_team_members') return member; assert.equal(name, 'uid_governance_evaluations'); return { insert: (value: any) => { inserts.push(value); return { select: () => ({ single: async () => ({ data: { id: 'stored', ...value } }) }) }; } }; },
  };
  const sandbox: any = { Response, URL, Deno: { env: { get: () => 'synthetic' } }, createClient: () => client, reviewReadiness, assessReviewCandidates, REVIEW_EVALUATOR_VERSION };
  vm.runInNewContext(edgeCode, sandbox);
  const response = await sandbox.handler.fetch(new Request('https://example.test/admin', { method: 'POST', body: JSON.stringify(payload) }));
  return { response, body: await response.json(), rpcCalls, inserts };
}
test('covered resolution only calls guarded SQL with verified actor and keeps canonical unchanged', async () => {
  const result = await invoke({ mode: 'resolve_covered', proposal_id: 'proposal-1', covered_proposal_id: 'original-1', candidate_hash: 'scope-v2:current', covered_hash: 'covered-v1', review_note: review.review_note, actor_user_id: 'attacker' });
  assert.equal(result.response.status, 200); assert.equal(result.body.canonical_changed, false);
  assert.deepEqual(result.rpcCalls.map(x => x.name), ['uid_governance_resolve_covered']);
  assert.equal(result.rpcCalls[0].args.p_actor_user_id, 'verified-user'); assert.equal(result.inserts.length, 0);
  const invalid = await invoke({ mode: 'resolve_covered', proposal_id: 'proposal-1' }); assert.equal(invalid.response.status, 422); assert.equal(invalid.rpcCalls.length, 0);
  const stale = await invoke({ mode: 'resolve_covered', proposal_id: 'proposal-1', covered_proposal_id: 'original-1', candidate_hash: 'old', covered_hash: 'old', review_note: review.review_note }, { rpcError: 'Reviewed canonical state changed' });
  assert.equal(stale.response.status, 409); assert.match(stale.body.retry_guidance, /Refresh/);
});
test('Edge evaluation stores only snapshot-bound results and rejects changes during assessment', async () => {
  const result = await invoke({ mode: 'governance_evaluate', proposal_id: 'proposal-1', candidate_hash: context.candidate_hash, candidate_runs: [run], review });
  assert.equal(result.response.status, 200); assert.equal(result.body.evaluation.evaluation_status, 'passed');
  assert.equal(result.inserts[0].candidate_hash, context.candidate_hash); assert.equal(result.inserts[0].evaluator_version, REVIEW_EVALUATOR_VERSION);
  assert.deepEqual(result.rpcCalls.map(x => x.name), ['uid_governance_review_context', 'uid_governance_candidate_hash']);
  const oldReview = await invoke({ mode: 'governance_evaluate', proposal_id: 'proposal-1', candidate_hash: 'old', candidate_runs: [run], review });
  assert.equal(oldReview.response.status, 409); assert.equal(oldReview.inserts.length, 0);
  assert.deepEqual(result.inserts[0].test_results[0].candidate_output, run.output);
  assert.equal(result.inserts[0].conflict_results[0].actor_user_id, 'verified-user');
  const stale = await invoke({ mode: 'governance_evaluate', proposal_id: 'proposal-1', candidate_hash: context.candidate_hash, candidate_runs: [run], review }, { hash: 'scope-v2:new' });
  assert.equal(stale.response.status, 409); assert.equal(stale.inserts.length, 0);
});
test('merge rejects stale reviewed hash before protected merge RPC', async () => {
  const stale = await invoke({ mode: 'review', decision: 'accept', proposal_id: 'proposal-1', candidate_hash: 'old', evaluation_id: 'evaluation-1' });
  assert.equal(stale.response.status, 409);
  assert.deepEqual(stale.rpcCalls.map(x => x.name), ['uid_governance_candidate_hash']);
});

test('preflight is read-only and never returns a fabricated evaluation', async () => {
  const result = await invoke({ mode: 'review_preflight', proposal_id: 'proposal-1' });
  assert.equal(result.response.status, 200); assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.body.automatic_evaluation_id, null); assert.equal(result.inserts.length, 0);
  const removed = await invoke({ mode: 'review_preflight', proposal_id: 'proposal-1' }, { missing: true });
  assert.equal(removed.response.status, 404); assert.match(removed.body.error, /not found/);
});
test('gateway pins route mode and proposal; forwards session and stale guidance without credentials', async () => {
  const oldUrl = process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;
  process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL = 'https://synthetic-admin.example.test/feedback';
  const realFetch = globalThis.fetch, calls: any[] = [];
  const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as any).port;
  globalThis.fetch = async (url, init) => { assert.equal(String(url), 'https://synthetic-admin.example.test/feedback'); assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic.admin'); calls.push(JSON.parse(String(init?.body))); return Response.json({ error: 'stale', retry_guidance: 'Refresh' }, { status: 409 }); };
  try {
    assert.equal((await realFetch(base + '/api/admin/feedback/target/preflight')).status, 401);
    assert.equal((await realFetch(base + '/api/admin/feedback/target/resolve-covered', { method: 'POST' })).status, 401);
    assert.equal(calls.length, 0);
    const headers = { Authorization: 'Bearer synthetic.admin', 'Content-Type': 'application/json' };
    await realFetch(base + '/api/admin/feedback/target/preflight', { headers });
    const response = await realFetch(base + '/api/admin/feedback/target/resolve-covered', { method: 'POST', headers, body: JSON.stringify({ mode: 'delete_all', proposal_id: 'attacker', candidate_hash: 'current' }) });
    assert.equal(response.status, 409); assert.equal((await response.json()).retry_guidance, 'Refresh');
    await realFetch(base + '/api/admin/governance/governance_list', { method: 'POST', headers, body: JSON.stringify({ mode: 'delete_all' }) });
    await realFetch(base + '/api/admin/branch-guides/upsert', { method: 'POST', headers, body: JSON.stringify({ mode: 'delete_all' }) });
    assert.deepEqual(calls.map(x => x.mode), ['review_preflight', 'resolve_covered', 'governance_list', 'branch_guide_upsert']);
    assert.equal(calls[1].proposal_id, 'target');
  } finally { globalThis.fetch = realFetch; if (oldUrl === undefined) delete process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL; else process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL = oldUrl; await new Promise<void>(r => server.close(() => r())); }
});

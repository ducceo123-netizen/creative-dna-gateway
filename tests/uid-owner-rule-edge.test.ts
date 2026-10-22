import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createApp } from '../server.ts';
import * as reviewModule from '../supabase/functions/_shared/feedback-review.ts';
import * as ownerRuleModule from '../supabase/functions/_shared/owner-rule-plan.ts';
import { buildCompatibleOwnerRulePlan } from '../supabase/functions/_shared/owner-rule-compatible-plan.ts';
import { compileCompatibleQuality, RULE_QUALITY_SCHEMA, RULE_SUPPLEMENT_SCHEMA } from '../supabase/functions/_shared/agent-rule-quality.ts';
import { RULE_COMPILER, RULE_REVIEW_EVALUATOR, RULE_REVIEW_SCOPE } from '../supabase/functions/_shared/agent-rule-policy.ts';
import { sourceHashes, QUALITY_SCHEMA, type QualityRule } from '../supabase/functions/_shared/creative-quality.ts';

const proposalId = '00000000-0000-4000-8000-000000000101';
const ownerId = '00000000-0000-4000-8000-000000000103';
const reviewIntentHash = 'intent-v1:owner-direct-rule-and-queue';
const canonicalScope = 'STRUCTURAL content for the product guide.';
const canonicalRule = `## Generalized Rule\nContent titles must identify the current product.\n\n## Expected Behavior\nUse the correct product noun in a concise title.\n\n## Reject Conditions\n- A generic title without the product noun.\n\n## Scope\n${canonicalScope}\n\n## Rule Class\nSTRUCTURAL\n\n## Confidence\nHIGH`;

// This fixture exercises the real deterministic compiler, including pre-existing
// source-bound quality contracts. Only external database/network effects are mocked.
async function makeSnapshot() {
  const brand = { id: 'owner-rule-brand', slug: 'synthetic-brand', name: 'Synthetic Brand' };
  const dna = { id: 'owner-rule-dna', brand_id: brand.id, slug: 'brand-dna', version: '1.0', content_md: 'Use the established brand voice.', metadata: {}, input_schema: {}, status: 'active', confidence: 'HIGH' };
  const target: any = {
    id: 'owner-rule-node', brand_id: brand.id, brand_slug: brand.slug, brand_name: brand.name,
    slug: 'ldp-system', title: 'Product guide', version: '1.0', node_hash: 'node-v2:owner-current',
    content_md: 'Keep approved product evidence intact.', metadata: { preserved_setting: true },
    input_schema: {}, status: 'active', confidence: 'HIGH',
  };
  const rules: QualityRule[] = [{
    id: 'existing-brand-expression', key: 'brand.active_expression', value: { retained: true },
    instruction: 'Use the established brand voice.', category: 'brand_style',
    scope: { brands: [brand.slug], branches: [target.slug] },
    sources: [{ node: 'brand_dna', locator: 'approved brand voice' }],
  }];
  target.metadata.creative_quality_contract = { schema_version: 'uid-creative-quality-catalog/1', contracts: { [brand.slug]: {
    schema_version: QUALITY_SCHEMA, revision: 'existing-contract', rules, references: [],
    source_hashes: await sourceHashes({ brand, branch: target, brand_dna: dna }),
  } } };
  const block = '\n\n## ACCEPTED ADMIN FEEDBACK — 2026-10-13\n' + canonicalRule + '\n';
  return {
    proposal: { id: proposalId, status: 'pending', merged_at: null, knowledge_node_id: target.id, proposed_content_md: canonicalRule, proposed_scope: canonicalScope },
    candidate_hash: 'scope-v2:owner-current', targets: [target], baselines: [], evaluations: [], covered_candidates: [],
    scope: { branch_slug: target.slug, structural: true, cross_brand: false, proposed_scope: canonicalScope, source_node_id: target.id, target_node_ids: [target.id] },
    direct_rule: {
      schema_version: 'uid.owner-rule-eligibility.v1', eligible: true, owner_authorized: true,
      rule_hash: 'owner-rule-v1:current', rule_class: 'STRUCTURAL', blockers: [],
      check_scope: 'STRUCTURE_SCOPE_AND_DETECTABLE_CONFLICTS_ONLY', visual_qc_performed: false,
      semantic_consistency: 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS',
    },
    direct_rule_receipt: null,
    compiler_context: {
      policy_version: ownerRuleModule.OWNER_RULE_PLAN_SCHEMA, owner_user_id: ownerId, brands: [brand], brand_dna_nodes: [dna],
      merge_block_text: block, projected_targets: [{ ...structuredClone(target), content_md: target.content_md + block }],
    },
  };
}
const snapshotPromise = makeSnapshot();
const snapshot = async () => structuredClone(await snapshotPromise);
async function approval(context?: any) {
  context ??= await snapshot();
  const result = await buildCompatibleOwnerRulePlan(context);
  assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  assert.ok(result.plan_hash);
  return {
    mode: 'accept_rule', proposal_id: proposalId, approve_rule: true,
    candidate_hash: context.candidate_hash, rule_hash: context.direct_rule.rule_hash, plan_hash: result.plan_hash,
  };
}
const sqlReceipt = {
  proposal_id: proposalId, status: 'merged', merged_at: '2026-10-13T04:00:00Z',
  decision_kind: 'owner_direct_rule', visual_qc_performed: false,
  rule_decision_id: '00000000-0000-4000-8000-000000000102',
  candidate_hash: 'scope-v2:owner-current', rule_hash: 'owner-rule-v1:current',
  check_scope: 'STRUCTURE_SCOPE_AND_DETECTABLE_CONFLICTS_ONLY', merged_nodes: 1, cross_brand_sync: false,
};
type Options = {
  snapshot?: any; preflightError?: string; acceptError?: string; acceptResult?: any;
  queueSnapshot?: any; queueError?: { message: string; code?: string };
  user?: { id: string } | null; role?: string; active?: boolean;
};
const edgeCode = transformSync(
  readFileSync('supabase/functions/creative-dna-admin-feedback/index.ts', 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default', 'const handler =') + '\nglobalThis.handler = handler;',
  { loader: 'ts' },
).code;
async function invoke(payload: any, options: Options = {}) {
  const context = Object.hasOwn(options, 'snapshot') ? options.snapshot : await snapshot();
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const compilerCalls: any[] = [];
  const member = { select: () => member, eq: () => member, maybeSingle: async () => ({ data: { role: options.role ?? 'admin', is_active: options.active ?? true } }) };
  const client = {
    auth: { getUser: async () => ({ data: { user: Object.hasOwn(options, 'user') ? options.user : { id: ownerId } } }) },
    from: (name: string) => {
      assert.equal(name, 'creative_dna_team_members', 'direct acceptance must never create a fake evaluation or perform direct table writes');
      return member;
    },
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      if (name === 'uid_review_preflight') return options.queueError ? { error: options.queueError, data: options.queueSnapshot } : {
        data: Object.hasOwn(options, 'queueSnapshot') ? options.queueSnapshot : context ? { ...context, review_intent_hash: reviewIntentHash, review_request: null } : null,
      };
      if (name === 'uid_rule_preflight') return options.preflightError ? { error: { message: options.preflightError } } : { data: context };
      if (name === 'uid_review_enqueue') return { data: { id: 'synthetic-owner-queue-request', proposal_id: proposalId, status: 'queued' } };
      assert.equal(name, 'uid_rule_accept', 'only owner-authorized protected SQL may apply a direct rule');
      return options.acceptError ? { error: { message: options.acceptError } } : { data: Object.hasOwn(options, 'acceptResult') ? options.acceptResult : { ...sqlReceipt, plan_hash: payload.plan_hash } };
    },
  };
  const sandbox: any = {
    ...reviewModule, ...ownerRuleModule, Response, Request, URL,
    Deno: { env: { get: () => 'synthetic-test-value' } }, createClient: () => client,
    buildOwnerRulePlan: async (value: any) => { compilerCalls.push(structuredClone(value)); return buildCompatibleOwnerRulePlan(value); },
    fetch: async () => assert.fail('owner acceptance must not perform media QC or launch a reviewer'),
  };
  vm.runInNewContext(edgeCode, sandbox);
  const response = await sandbox.handler.fetch(new Request('https://example.test/admin', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic-owner-session', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }));
  return { response, body: await response.json(), rpcCalls, compilerCalls };
}
const accepts = (result: Awaited<ReturnType<typeof invoke>>) => result.rpcCalls.filter(call => call.name === 'uid_rule_accept');

test('owner-rule preflight recomputes a source-bound plan from one authenticated read without any QC pass', async () => {
  const context = await snapshot();
  const plan = await ownerRuleModule.buildOwnerRulePlan(context);
  const result = await invoke({ mode: 'review_preflight', proposal_id: proposalId, actor_user_id: 'forged-owner' }, { snapshot: context });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.rpcCalls, [{ name: 'uid_review_preflight', args: { p_proposal_id: proposalId, p_actor_user_id: ownerId } }]);
  assert.equal(result.body.queue_available, true);
  assert.equal(result.body.review_intent_hash, reviewIntentHash);
  assert.equal(result.compilerCalls.length, 1);
  assert.equal(result.body.direct_rule.eligible, true);
  assert.equal(result.body.direct_rule_plan.plan_hash, plan.plan_hash);
  assert.equal(Object.hasOwn(result.body.direct_rule_plan, 'plan'), false);
  assert.equal(Object.hasOwn(result.body, 'compiler_context'), false);
  assert.doesNotMatch(JSON.stringify(result.body), new RegExp(ownerId), 'private owner identity must not enter public rule metadata or handoff evidence');
  assert.equal(result.body.direct_rule.visual_qc_performed, false);
  assert.equal(result.body.automatic_review.status, 'blocked');
  assert.ok(result.body.automatic_review.blockers.some((b:any)=>b.code==='compiler_integration_required'));
  assert.equal(result.body.automatic_review.evaluation_id, null);
  assert.equal(result.body.automatic_evaluation_id, null);
});

test('explicit queue-owner denial preserves normal admin preflight without granting queue authority', async () => {
  const fallback: any = await snapshot();
  fallback.candidate_hash = 'scope-v2:fallback-only';
  fallback.direct_rule = { ...fallback.direct_rule, eligible: false, owner_authorized: false,
    blockers: [{ code: 'not_owner', message: 'Configured owner required', next_action: 'Ask the owner to approve.' }] };
  fallback.review_intent_hash = 'must-not-grant-fallback-intent';
  fallback.review_request = { id: 'must-not-leak-fallback-request' };
  const result = await invoke({ mode: 'review_preflight', proposal_id: proposalId }, {
    snapshot: fallback, queueError: { code: '42501', message: 'Enabled verified configured owner required' },
    queueSnapshot: { candidate_hash: 'failed-partial-snapshot', review_intent_hash: 'failed-partial-intent' },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.queue_available, false);
  assert.equal(result.body.review_intent_hash, null);
  assert.equal(result.body.review_request, null);
  assert.equal(result.body.candidate_hash, fallback.candidate_hash);
  assert.equal(result.body.direct_rule.eligible, false);
  assert.equal(result.body.direct_rule.owner_authorized, false);
  assert.deepEqual(result.rpcCalls, ['uid_review_preflight', 'uid_rule_preflight'].map(name => ({
    name, args: { p_proposal_id: proposalId, p_actor_user_id: ownerId },
  })));
  assert.equal(result.compilerCalls.length, 1);
  assert.equal(result.compilerCalls[0].candidate_hash, fallback.candidate_hash);
  assert.doesNotMatch(JSON.stringify(result.body), /failed-partial|must-not-grant|must-not-leak/);
});

test('general preflight never falls back on arbitrary errors or a successful partial owner snapshot', async () => {
  for (const options of [
    { queueError: { code: 'XX000', message: 'Snapshot unavailable' } },
    { queueError: { code: '42501', message: 'Another database permission boundary denied this read' } },
    { queueError: { message: 'Enabled verified configured owner required' } },
    { queueSnapshot: { ...await snapshot(), review_intent_hash: null, review_request: null } },
  ]) {
    const result = await invoke({ mode: 'review_preflight', proposal_id: proposalId }, options);
    assert.ok(result.response.status >= 400);
    assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight']);
    assert.equal(result.compilerCalls.length, 0);
  }
});

test('normal-admin fallback read failures do not expose the rejected owner snapshot', async () => {
  const result = await invoke({ mode: 'review_preflight', proposal_id: proposalId }, {
    queueError: { code: '42501', message: 'Enabled verified configured owner required' }, preflightError: 'Admin rule context unavailable',
    queueSnapshot: { ...await snapshot(), review_intent_hash: 'do-not-use-rejected-intent' },
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, 'Admin rule context unavailable');
  assert.equal(result.compilerCalls.length, 0);
  assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight', 'uid_rule_preflight']);
  assert.doesNotMatch(JSON.stringify(result.body), /do-not-use/);
});

test('one atomic owner preview supports queued outcome review and separately approved direct-rule application', async () => {
  const context = await snapshot();
  const preview = await invoke({ mode: 'review_preflight', proposal_id: proposalId }, { snapshot: context });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.direct_rule.eligible, true);
  assert.equal(preview.body.automatic_review.status, 'blocked');
  const queued = await invoke({ mode: 'process_review', proposal_id: proposalId, approve: true,
    review_intent_hash: preview.body.review_intent_hash, plan: { forged: true }, candidate_runs: [{ forged: true }],
  }, { snapshot: context });
  assert.equal(queued.response.status, 200);
  assert.equal(queued.body.status, 'queued');
  assert.equal(queued.body.canonical_changed, false);
  assert.equal(accepts(queued).length, 0);
  assert.deepEqual(queued.rpcCalls.map(call => call.name), ['uid_review_preflight', 'uid_review_enqueue']);
  const accepted = await invoke({ mode: 'accept_rule', proposal_id: proposalId, approve_rule: true,
    candidate_hash: preview.body.candidate_hash, rule_hash: preview.body.direct_rule.rule_hash,
    plan_hash: preview.body.direct_rule_plan.plan_hash,
  }, { snapshot: context });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.decision_kind, 'owner_direct_rule');
  assert.equal(accepted.body.visual_qc_performed, false);
  assert.deepEqual(accepted.rpcCalls.map(call => call.name), ['uid_rule_preflight', 'uid_rule_accept']);
});

test('direct rule routes reject unauthenticated, inactive and non-admin actors before protected reads', async () => {
  for (const mode of ['review_preflight', 'owner_rule_preflight', 'accept_rule']) {
    for (const [options, status] of [[{ user: null }, 401], [{ role: 'member' }, 403], [{ active: false }, 403]] as [Options, number][]) {
      const result = await invoke({ ...await approval(), mode }, options);
      assert.equal(result.response.status, status);
      assert.deepEqual(result.rpcCalls, []);
      assert.deepEqual(result.compilerCalls, []);
    }
  }
});

test('direct rule approval requires explicit intent and every displayed hash', async () => {
  const payload = await approval();
  for (const change of [
    { approve_rule: undefined }, { approve_rule: false }, { approve_rule: 'true' },
    { candidate_hash: undefined }, { candidate_hash: '' }, { candidate_hash: 1 },
    { rule_hash: undefined }, { rule_hash: '' }, { rule_hash: 1 },
    { plan_hash: undefined }, { plan_hash: '' }, { plan_hash: 1 }, { proposal_id: undefined },
  ]) {
    const result = await invoke({ ...payload, ...change });
    assert.equal(result.response.status, 422);
    assert.deepEqual(result.rpcCalls, []);
  }
});

test('direct approval ignores forged client actor/plan/QC and passes the freshly recomputed server plan to SQL', async () => {
  const context = await snapshot();
  const expected = await ownerRuleModule.buildOwnerRulePlan(context);
  const result = await invoke({
    ...await approval(context), actor_user_id: 'forged-owner', owner_user_id: 'forged-owner',
    plan: { targets: [{ node_id: 'out-of-scope-node', content_md: 'Replace everything' }] },
    p_plan: { malicious: true }, evaluation_id: 'forged-evaluation', visual_qc_performed: true,
    review: { visual_reviewed: true, product_truth_verified: true, critical_regressions: 0 },
  }, { snapshot: context });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_rule_preflight', 'uid_rule_accept']);
  assert.equal(result.compilerCalls.length, 1);
  assert.deepEqual(accepts(result)[0].args, {
    p_proposal_id: proposalId, p_actor_user_id: ownerId,
    p_expected_candidate_hash: context.candidate_hash, p_expected_rule_hash: context.direct_rule.rule_hash,
    p_plan: expected.plan, p_expected_plan_hash: expected.plan_hash,
  });
  assert.equal(result.body.visual_qc_performed, false);
  assert.equal(result.body.decision_kind, 'owner_direct_rule');
  assert.equal(result.body.canonical_changed, true);
  assert.equal(Object.hasOwn(result.body, 'evaluation_id'), false);
  assert.doesNotMatch(JSON.stringify(accepts(result)[0].args.p_plan), new RegExp(ownerId), 'canonical metadata must not contain the private owner identity');
});

test('the real SQL top-level receipt is normalized into the merged proposal expected by the UI', async () => {
  const payload = await approval();
  const result = await invoke(payload, { acceptResult: { ...sqlReceipt, plan_hash: payload.plan_hash } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'merged');
  assert.deepEqual(result.body.proposal, { id: proposalId, status: 'merged', merged_at: sqlReceipt.merged_at });
  assert.equal(result.body.rule_decision_id, sqlReceipt.rule_decision_id);
  assert.equal(result.body.decision_kind, 'owner_direct_rule');
  assert.equal(result.body.visual_qc_performed, false);
  assert.equal(result.body.canonical_changed, true);
});

test('owner/config eligibility denial cannot be overridden by client claims', async () => {
  for (const denial of [
    { eligible: false, owner_authorized: false, blockers: [{ code: 'owner_required', message: 'Verified owner required', next_action: 'Ask the configured owner.' }] },
    { eligible: false, owner_authorized: true, blockers: [{ code: 'configuration_disabled', message: 'Direct approval disabled', next_action: 'Review owner configuration.' }] },
  ]) {
    const context = await snapshot();
    const payload = await approval(context);
    context.direct_rule = { ...context.direct_rule, ...denial } as any;
    const result = await invoke({ ...payload, direct_rule: { eligible: true, owner_authorized: true } }, { snapshot: context });
    assert.equal(result.response.status, 409);
    assert.equal(accepts(result).length, 0);
    assert.notEqual(result.body.canonical_changed, true);
  }
});

test('changed candidate, rule and compiled-plan hashes reject before any merge attempt', async () => {
  for (const field of ['candidate_hash', 'rule_hash', 'plan_hash']) {
    const result = await invoke({ ...await approval(), [field]: 'stale-displayed-hash' });
    assert.equal(result.response.status, 409);
    assert.equal(accepts(result).length, 0);
    assert.notEqual(result.body.canonical_changed, true);
  }
});

test('changed compiler projection is independently rejected despite matching candidate and rule tokens', async () => {
  const context = await snapshot();
  const payload = await approval(context);
  context.compiler_context.projected_targets[0].content_md += '\nUnauthorized additional mutation.';
  const result = await invoke(payload, { snapshot: context });
  assert.equal(result.response.status, 409);
  assert.equal(result.compilerCalls.length, 1);
  assert.equal(accepts(result).length, 0);
});

test('preflight reports compiler blockers instead of offering an uncompiled direct approval', async () => {
  const context = await snapshot();
  context.compiler_context.projected_targets[0].content_md += '\nInvalid projection';
  const result = await invoke({ mode: 'review_preflight', proposal_id: proposalId }, { snapshot: context });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.direct_rule.eligible, false);
  assert.equal(result.body.direct_rule_plan.plan_hash, null);
  assert.ok(result.body.direct_rule.blockers.length > 0);
  assert.equal(result.body.direct_rule.visual_qc_performed, false);
  assert.equal(accepts(result).length, 0);
});

test('SQL owner/config and concurrent-state denials are preserved without a successful merge receipt', async () => {
  for (const message of ['Active verified owner Admin required', 'Rule or owner configuration changed; refresh review', 'Proposal, scope, canonical nodes or baselines changed; refresh review']) {
    const result = await invoke(await approval(), { acceptError: message });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error, message);
    assert.notEqual(result.body.canonical_changed, true);
    assert.notEqual(result.body.status, 'merged');
    assert.equal(accepts(result).length, 1);
  }
});

test('malformed or wrong-proposal SQL receipts cannot be surfaced as successful direct approval', async () => {
  const payload = await approval();
  const receipt = { ...sqlReceipt, plan_hash: payload.plan_hash };
  for (const acceptResult of [
    null, {}, { status: 'merged' },
    { ...receipt, proposal_id: 'another-proposal' },
    { ...receipt, status: 'pending' },
    { ...receipt, decision_kind: 'owner_rule_accept' },
    { ...receipt, visual_qc_performed: true },
    { ...receipt, rule_decision_id: undefined },
    { ...receipt, merged_at: undefined },
    { ...receipt, merged_at: 'not-a-date' },
    { ...receipt, candidate_hash: 'another-candidate' },
    { ...receipt, rule_hash: 'another-rule' },
    { ...receipt, plan_hash: 'another-plan' },
  ]) {
    const result = await invoke(payload, { acceptResult });
    assert.ok(result.response.status >= 400, JSON.stringify(acceptResult));
    assert.notEqual(result.body.canonical_changed, true);
    assert.notEqual(result.body.status, 'merged');
  }
});

test('exact merged receipt retries may use null plan only after matching receipt identity and approval hashes', async () => {
  const context: any = await snapshot();
  const payload = await approval(context);
  context.proposal.status = 'merged'; context.proposal.merged_at = sqlReceipt.merged_at;
  context.candidate_hash = 'scope-v2:after-merge';
  context.direct_rule = { ...context.direct_rule, eligible: false, rule_hash: 'owner-rule-v1:after-merge' };
  context.direct_rule_receipt = { ...sqlReceipt, plan_hash: payload.plan_hash };
  const result = await invoke(payload, { snapshot: context });
  assert.equal(result.response.status, 200);
  assert.equal(accepts(result).length, 1);
  assert.equal(accepts(result)[0].args.p_plan, null);
  assert.equal(accepts(result)[0].args.p_expected_candidate_hash, sqlReceipt.candidate_hash);
  assert.equal(accepts(result)[0].args.p_expected_rule_hash, sqlReceipt.rule_hash);
  assert.equal(result.body.rule_decision_id, sqlReceipt.rule_decision_id);
});

test('mismatched or malformed stored receipts cannot bypass fresh approval or compilation', async () => {
  const payload = await approval();
  const storedReceipt = { ...sqlReceipt, plan_hash: payload.plan_hash };
  for (const receipt of [
    { ...storedReceipt, candidate_hash: 'wrong' }, { ...storedReceipt, rule_hash: 'wrong' },
    { ...storedReceipt, proposal_id: 'wrong' }, { ...storedReceipt, status: 'pending' },
    { ...storedReceipt, visual_qc_performed: true }, { ...storedReceipt, decision_kind: 'owner_rule_accept' },
    { ...storedReceipt, plan_hash: 'wrong' },
    { ...storedReceipt, rule_decision_id: undefined }, { ...storedReceipt, merged_at: undefined },
  ]) {
    const context: any = await snapshot();
    const payload = await approval(context);
    context.proposal.status = 'merged'; context.proposal.merged_at = sqlReceipt.merged_at;
    context.direct_rule_receipt = receipt;
    const result = await invoke(payload, { snapshot: context });
    assert.equal(result.response.status, 409, JSON.stringify(receipt));
    assert.equal(accepts(result).length, 0);
  }
});

test('missing or failed atomic rule preflight never falls back to a client plan', async () => {
  for (const options of [{ snapshot: null }, { preflightError: 'Owner preflight unavailable' }]) {
    const result = await invoke({ ...await approval(), plan: { targets: [] } }, options);
    assert.ok([404, 409].includes(result.response.status));
    assert.equal(accepts(result).length, 0);
  }
});

test('direct-rule gateway requires a session and all displayed hashes, pins routing and strips forged plans', async () => {
  const originalUrl = process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;
  process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL = 'https://example.test/direct-rule-edge';
  const realFetch = globalThis.fetch;
  const calls: any[] = [];
  const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://example.test/direct-rule-edge');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic.owner');
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ error: 'Rule changed; refresh review' }, { status: 409 });
  };
  try {
    const url = `${base}/api/admin/feedback/${proposalId}/accept-rule`;
    assert.equal((await realFetch(url, { method: 'POST' })).status, 401);
    const headers = { Authorization: 'Bearer synthetic.owner', 'Content-Type': 'application/json' };
    const payload = await approval();
    const missingPlan = await realFetch(url, { method: 'POST', headers, body: JSON.stringify({ ...payload, plan_hash: undefined }) });
    assert.equal(missingPlan.status, 422);
    assert.equal(calls.length, 0);
    const response = await realFetch(url, { method: 'POST', headers, body: JSON.stringify({
      ...payload, mode: 'delete_all', proposal_id: 'wrong-proposal', actor_user_id: 'forged-owner', plan: { targets: [] }, visual_qc_performed: true,
    }) });
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'Rule changed; refresh review' });
    assert.deepEqual(calls, [payload]);
  } finally {
    globalThis.fetch = realFetch;
    if (originalUrl === undefined) delete process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;
    else process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL = originalUrl;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

async function leafSnapshot() {
 const context=await snapshot();
 delete context.targets[0].metadata.creative_quality_contract;
 delete context.compiler_context.projected_targets[0].metadata.creative_quality_contract;
 (context.compiler_context as any).dependent_nodes=[];
 return context;
}

test('genuinely uncompiled leaf preflight returns a canonical append preview, not compiled quality or QC',async()=>{
 const context=await leafSnapshot();
 const result=await invoke({mode:'review_preflight',proposal_id:proposalId},{snapshot:context});
 assert.equal(result.response.status,200);
 assert.equal(result.body.direct_rule.eligible,true,JSON.stringify(result.body.direct_rule.blockers));
 assert.equal(result.body.direct_rule_plan.plan_kind,'canonical_append');
 assert.equal(result.body.direct_rule_plan.compiler_version,null);
 assert.deepEqual(result.body.direct_rule_plan.compiled,[]);
 assert.equal(result.body.direct_rule_plan.additions[0].schema_version,'uid.owner-canonical-append.v1');
 assert.equal(Object.hasOwn(result.body.direct_rule_plan.additions[0],'accepted_source_hashes'),false);
 assert.equal(Object.hasOwn(result.body.direct_rule_plan,'plan'),false);
 assert.equal(Object.hasOwn(result.body,'compiler_context'),false);
 assert.equal(result.body.direct_rule.visual_qc_performed,false);
 assert.equal(accepts(result).length,0);
});

test('uncompiled leaf approval passes only the fresh exact projected plan to guarded SQL',async()=>{
 const context=await leafSnapshot();const payload=await approval(context);
 const result=await invoke({...payload,actor_user_id:'forged-owner',plan:{untrusted:true}},{snapshot:context});
 assert.equal(result.response.status,200);assert.equal(result.body.decision_kind,'owner_direct_rule');
 const calls=accepts(result);assert.equal(calls.length,1);
 assert.equal(calls[0].args.p_actor_user_id,ownerId);
 const plan=calls[0].args.p_plan;
 assert.deepEqual(Object.keys(plan).sort(),['candidate_hash','rule_hash','schema_version','targets']);
 assert.equal(plan.targets[0].content_md,context.compiler_context.projected_targets[0].content_md);
 assert.deepEqual(plan.targets[0].metadata,context.targets[0].metadata);
 assert.equal(Object.hasOwn(plan.targets[0].metadata,'creative_quality_contract'),false);
 assert.equal(result.body.visual_qc_performed,false);
});

test('present invalid catalogs never fall back to canonical append or call the accept RPC',async()=>{
 for(const catalog of [null,{},'malformed']){
  const context=await leafSnapshot();context.targets[0].metadata.creative_quality_contract=catalog;
  context.compiler_context.projected_targets[0].metadata.creative_quality_contract=catalog;
  const result=await invoke({mode:'review_preflight',proposal_id:proposalId},{snapshot:context});
  assert.equal(result.body.direct_rule.eligible,false);assert.equal(result.body.direct_rule_plan.plan_hash,null);
  assert.equal(accepts(result).length,0);
 }
});

/** Synthetic prior delegated rule; no real review receipt or source is reused. */
async function v4Snapshot() {
 const context:any=await snapshot(),prior=structuredClone(context);
 prior.proposal.id='00000000-0000-4000-8000-000000000104';
 prior.proposal.proposed_content_md=canonicalRule.replace('Content titles must identify the current product.','Content sections must retain specific product context.');
 prior.compiler_context.merge_block_text='\n\n## ACCEPTED ADMIN FEEDBACK — 2026-10-13\n'+prior.proposal.proposed_content_md+'\n';
 prior.compiler_context.projected_targets=prior.targets.map((t:any)=>({...structuredClone(t),content_md:t.content_md+prior.compiler_context.merge_block_text}));
 const previous=await ownerRuleModule.buildOwnerRulePlan(prior);assert(previous.eligible,JSON.stringify(previous.blockers));assert(previous.plan);
 context.targets=context.targets.map((t:any)=>({...t,...previous.plan!.targets.find(n=>n.node_id===t.id)}));
 const bundle=context.targets[0].metadata.creative_quality_contract.contracts['synthetic-brand'];
 const {semantic_consistency,...supplement}=bundle.owner_supplemental_rules[0];
 const request='00000000-0000-4000-8000-000000000105',attempt=request+':1';
 bundle.schema_version=RULE_QUALITY_SCHEMA;
 delete bundle.owner_supplemental_rules;
 bundle.agent_rule_reviewed_supplemental_rules=[{...supplement,schema_version:RULE_SUPPLEMENT_SCHEMA,
  id:'agent-rule:'+attempt,request_id:request,attempt_id:attempt,decision_kind:'agent_rule_review',
  evaluator_version:RULE_REVIEW_EVALUATOR,snapshot_hash:'sha256:'+'a'.repeat(64),review_hash:'b'.repeat(64),review_scope:RULE_REVIEW_SCOPE,
  source:{...supplement.source,locator:`agent-rule:${supplement.proposal_id}:${attempt}`}}];
 context.compiler_context.projected_targets=context.targets.map((t:any)=>({...structuredClone(t),content_md:t.content_md+context.compiler_context.merge_block_text}));
 return context;
}

test('schema4 owner Edge preflight and approval use the real compatible planner and preserve delegated provenance',async()=>{
 assert.match(readFileSync('supabase/functions/creative-dna-admin-feedback/index.ts','utf8'),
  /import \{ buildCompatibleOwnerRulePlan as buildOwnerRulePlan \} from ["']\.\.\/_shared\/owner-rule-compatible-plan\.ts["']/);
 const context=await v4Snapshot(),before=structuredClone(context),expected=await buildCompatibleOwnerRulePlan(context);
 assert(expected.eligible,JSON.stringify(expected.blockers));assert(expected.plan);
 const preview=await invoke({mode:'review_preflight',proposal_id:proposalId},{snapshot:context});
 assert.equal(preview.response.status,200);assert.equal(preview.body.direct_rule.eligible,true);
 assert.equal(preview.body.direct_rule_plan.plan_kind,'compiled_supplement');
 assert.equal(preview.body.direct_rule_plan.compiler_version,RULE_COMPILER);
 assert.equal(preview.body.direct_rule_plan.plan_hash,expected.plan_hash);
 assert.equal(preview.body.direct_rule_plan.visual_qc_performed,false);
 assert.equal(Object.hasOwn(preview.body.direct_rule_plan,'plan'),false);
 assert.equal(Object.hasOwn(preview.body,'compiler_context'),false);
 assert.equal(accepts(preview).length,0);
 const accepted=await invoke({...await approval(context),plan:{targets:[]},actor_user_id:'forged-owner',visual_qc_performed:true},{snapshot:context});
 assert.equal(accepted.response.status,200);assert.equal(accepted.body.canonical_changed,true);
 assert.equal(accepted.body.decision_kind,'owner_direct_rule');assert.equal(accepted.body.visual_qc_performed,false);
 assert.deepEqual(accepted.rpcCalls.map(c=>c.name),['uid_rule_preflight','uid_rule_accept']);
 assert.equal(accepts(accepted).length,1);assert.deepEqual(accepts(accepted)[0].args.p_plan,expected.plan);
 assert.equal(accepts(accepted)[0].args.p_expected_plan_hash,preview.body.direct_rule_plan.plan_hash);
 assert.equal(accepts(accepted)[0].args.p_actor_user_id,ownerId);
 const prior=context.targets[0].metadata.creative_quality_contract.contracts['synthetic-brand'];
 const after=accepts(accepted)[0].args.p_plan.targets[0].metadata.creative_quality_contract.contracts['synthetic-brand'];
 assert.equal(after.schema_version,RULE_QUALITY_SCHEMA);
 assert.deepEqual(after.agent_rule_reviewed_supplemental_rules,prior.agent_rule_reviewed_supplemental_rules);
 assert.equal(after.owner_supplemental_rules.length,1);assert.equal(after.owner_supplemental_rules[0].proposal_id,proposalId);
 const runtime=await compileCompatibleQuality({brand:context.compiler_context.brands[0],
  branch:{...context.targets[0],...expected.plan.targets[0]},brand_dna:context.compiler_context.brand_dna_nodes[0]});
 assert.equal(runtime.status,'COMPILED');assert.equal(runtime.contract_hash,expected.compiled[0].contract_hash);
 assert.equal(runtime.agent_rule_reviewed_supplemental_rules?.length,1);assert.equal(runtime.owner_supplemental_rules.length,1);
 assert.deepEqual(context,before,'both Edge routes keep their source snapshot immutable');
});

test('schema4 Edge rejects malformed or divergent history before any owner accept RPC',async()=>{
 const valid=await v4Snapshot(),payload=await approval(valid);
 const changes=[
  (c:any)=>{c.targets[0].metadata.creative_quality_contract.contracts['synthetic-brand'].agent_rule_reviewed_supplemental_rules[0].visual_qc_performed=true;},
  (c:any)=>{c.targets[0].metadata.creative_quality_contract.contracts['synthetic-brand'].agent_rule_reviewed_supplemental_rules[0].source.canonical_text_hash='0'.repeat(64);},
  (c:any)=>{c.targets[0].metadata.creative_quality_contract.contracts['synthetic-brand'].agent_rule_reviewed_supplemental_rules=null;},
  (c:any)=>{c.targets[0].metadata.creative_quality_contract.contracts['synthetic-brand'].schema_version='uid-creative-quality/1';},
 ];
 for(const change of changes){
  const context=structuredClone(valid);change(context);
  context.compiler_context.projected_targets[0].metadata=structuredClone(context.targets[0].metadata);
  const preview=await invoke({mode:'review_preflight',proposal_id:proposalId},{snapshot:context});
  assert.equal(preview.response.status,200);assert.equal(preview.body.direct_rule.eligible,false);
  assert.equal(preview.body.direct_rule_plan.plan_hash,null);assert.equal(accepts(preview).length,0);
  const rejected=await invoke(payload,{snapshot:context});
  assert.equal(rejected.response.status,409);assert.equal(accepts(rejected).length,0);
  assert.notEqual(rejected.body.canonical_changed,true);
 }
 const drift=structuredClone(valid);
 drift.compiler_context.projected_targets[0].metadata.creative_quality_contract.contracts['synthetic-brand'].agent_rule_reviewed_supplemental_rules[0].review_hash='c'.repeat(64);
 const rejected=await invoke(payload,{snapshot:drift});
 assert.equal(rejected.response.status,409);assert.equal(accepts(rejected).length,0);
});


test('dedicated owner preview uses only the session-bound rule snapshot and returns no queue or output-QC capability', async () => {
  const context: any = await snapshot();
  context.review_intent_hash = 'must-not-expose-queue-intent';
  context.review_request = { id: 'must-not-expose-queue-request' };
  context.automatic_review = { status: 'ready_to_merge', evaluation_id: 'must-not-expose-qc' };
  const expected = await buildCompatibleOwnerRulePlan(context);
  const result = await invoke({ mode: 'owner_rule_preflight', proposal_id: proposalId,
    actor_user_id: 'forged-owner', owner_user_id: 'forged-owner',
    plan: { targets: [] }, visual_qc_performed: true,
  }, { snapshot: context, queueError: { code: 'XX000', message: 'Legacy queue unavailable' } });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.rpcCalls, [{ name: 'uid_rule_preflight', args: { p_proposal_id: proposalId, p_actor_user_id: ownerId } }]);
  assert.equal(result.compilerCalls.length, 1);
  assert.deepEqual(result.compilerCalls[0], context);
  assert.equal(result.body.preview_kind, 'owner_rule');
  assert.equal(result.body.proposal.id, proposalId);
  assert.equal(result.body.candidate_hash, context.candidate_hash);
  assert.equal(result.body.queue_available, false);
  assert.equal(result.body.review_intent_hash, null);
  assert.equal(result.body.review_request, null);
  assert.equal(Object.hasOwn(result.body, 'automatic_review'), false);
  assert.equal(result.body.direct_rule.eligible, true);
  assert.equal(result.body.direct_rule.owner_authorized, true);
  assert.equal(result.body.direct_rule.visual_qc_performed, false);
  assert.equal(result.body.direct_rule_plan.plan_hash, expected.plan_hash);
  assert.equal(Object.hasOwn(result.body.direct_rule_plan, 'plan'), false);
  assert.equal(Object.hasOwn(result.body, 'compiler_context'), false);
  assert.doesNotMatch(JSON.stringify(result.body), /must-not-expose|forged-owner/);
  assert.doesNotMatch(JSON.stringify(result.body), new RegExp(ownerId));
});

test('dedicated owner preview requires explicit server owner authorization without client overrides', async () => {
  for (const owner_authorized of [false, undefined, null, 'true', 1]) {
    const context: any = await snapshot();
    context.direct_rule.owner_authorized = owner_authorized;
    const result = await invoke({ mode: 'owner_rule_preflight', proposal_id: proposalId,
      direct_rule: { owner_authorized: true, eligible: true }, actor_user_id: ownerId,
    }, { snapshot: context });
    assert.equal(result.response.status, 403, `owner_authorized=${String(owner_authorized)}`);
    assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_rule_preflight']);
    assert.equal(result.compilerCalls.length, 0);
    assert.equal(Object.hasOwn(result.body, 'direct_rule_plan'), false);
  }
});

test('dedicated owner preview rejects malformed, wrong-proposal and failed snapshots without any fallback', async () => {
  const valid: any = await snapshot();
  const malformed = [null, {}, { ...valid, proposal: { ...valid.proposal, id: 'wrong-proposal' } },
    { ...valid, candidate_hash: '' }, { ...valid, targets: null },
    { ...valid, targets: [{ id: 'malformed-target' }] }, { ...valid, baselines: {} },
    { ...valid, evaluations: null }, { ...valid, covered_candidates: null },
    { ...valid, direct_rule: { ...valid.direct_rule, blockers: null } }];
  for (const options of [...malformed.map(snapshot => ({ snapshot })), { preflightError: 'Owner rule snapshot unavailable' }]) {
    const result = await invoke({ mode: 'owner_rule_preflight', proposal_id: proposalId, plan: { targets: [] } }, options);
    assert.ok(result.response.status >= 400, JSON.stringify(options));
    assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_rule_preflight']);
    assert.equal(result.compilerCalls.length, 0);
    assert.equal(Object.hasOwn(result.body, 'direct_rule_plan'), false);
  }
});

test('dedicated owner preview reports incompatible projections as blockers without mutation or queue fallback', async () => {
  const context = await snapshot();
  context.compiler_context.projected_targets[0].content_md += '\nUnapproved projection change.';
  const result = await invoke({ mode: 'owner_rule_preflight', proposal_id: proposalId }, { snapshot: context });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.preview_kind, 'owner_rule');
  assert.equal(result.body.direct_rule.eligible, false);
  assert.equal(result.body.direct_rule_plan.plan_hash, null);
  assert.ok(result.body.direct_rule.blockers.length > 0);
  assert.equal(result.body.queue_available, false);
  assert.equal(Object.hasOwn(result.body, 'automatic_review'), false);
  assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_rule_preflight']);
});

test('dedicated owner preview gateway authenticates and pins GET routing to the owner mode and path proposal', async () => {
  const originalUrl = process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;
  process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL = 'https://example.test/owner-preview-edge';
  const realFetch = globalThis.fetch;
  const calls: any[] = [];
  let upstreamStatus = 200;
  let upstreamBody: any = { preview_kind: 'owner_rule', queue_available: false, review_intent_hash: null, review_request: null };
  const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://example.test/owner-preview-edge');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic.owner');
    calls.push(JSON.parse(String(init?.body)));
    return Response.json(upstreamBody, { status: upstreamStatus });
  };
  try {
    const url = `${base}/api/admin/feedback/${proposalId}/owner-preflight?mode=process_review&proposal_id=forged&actor_user_id=forged`;
    assert.equal((await realFetch(url)).status, 401);
    assert.equal((await realFetch(url, { headers: { Authorization: 'Basic forged' } })).status, 401);
    assert.equal(calls.length, 0);
    const headers = { Authorization: 'Bearer synthetic.owner' };
    const response = await realFetch(url, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), upstreamBody);
    assert.deepEqual(calls, [{ mode: 'owner_rule_preflight', proposal_id: proposalId }]);
    upstreamStatus = 403; upstreamBody = { error: 'Configured owner required' };
    const denied = await realFetch(url, { headers });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await denied.json(), upstreamBody);
    assert.deepEqual(calls[1], { mode: 'owner_rule_preflight', proposal_id: proposalId });
  } finally {
    globalThis.fetch = realFetch;
    if (originalUrl === undefined) delete process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;
    else process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL = originalUrl;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test('dedicated owner preview validates proposal identity before protected reads', async () => {
  for (const proposal_id of [undefined, null, '', 123, {}]) {
    const result = await invoke({ mode: 'owner_rule_preflight', proposal_id });
    assert.equal(result.response.status, 422);
    assert.deepEqual(result.rpcCalls, []);
    assert.deepEqual(result.compilerCalls, []);
  }
});

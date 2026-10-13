import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createApp } from '../server.ts';
import * as reviewModule from '../supabase/functions/_shared/feedback-review.ts';
import { buildOwnerRulePlan } from '../supabase/functions/_shared/owner-rule-plan.ts';

const ownerId = 'synthetic-queue-owner';
const reviewIntentHash = 'intent-v1:queue-owner-proposal-scope';
const baseline = {
  id: 'synthetic-queue-baseline', brand_id: 'synthetic-queue-brand',
  branch_slug: 'uncompiled-product-guide', case_key: 'Product truth', approved_at: '2026-10-12T00:00:00Z',
  approved_output: { title: 'Comfort T-Shirt' },
  expected_assertions: { required_text: ['T-Shirt'], forbidden_text: ['cure'], required_keys: ['title'] },
};
const target = {
  id: 'synthetic-queue-node', brand_id: baseline.brand_id, brand_name: 'Synthetic queue brand',
  slug: baseline.branch_slug, title: 'Onepage', content_md: 'Keep product identity.', node_hash: 'node-v2:queue-current',
};
const storedContext = {
  proposal: { id: 'synthetic-queue-proposal', status: 'pending', raw_feedback: 'Preserve product truth.' },
  candidate_hash: 'scope-v2:queue-current', targets: [target], baselines: [baseline],
  evaluations: [], covered_candidates: [],
};
const storedEvaluation = {
  id: 'synthetic-stored-evaluation', proposal_id: storedContext.proposal.id,
  candidate_hash: storedContext.candidate_hash, evaluation_status: 'passed', critical_failures: 0,
  completed_at: '2026-10-13T00:00:00Z', evaluator_version: reviewModule.REVIEW_EVALUATOR_VERSION,
  baseline_ids: [baseline.id],
  test_results: [{
    baseline_id: baseline.id, case_key: baseline.case_key, status: 'passed', issues: [],
    source_run_id: 'synthetic-stored-run', artifact_url: 'https://example.test/stored-artifact.png',
    candidate_output: { title: 'Comfort T-Shirt' },
  }],
  conflict_results: [{
    actor_user_id: ownerId, manually_reviewed: true, product_truth_verified: true, visual_reviewed: true,
    note: 'Stored administrator review of product truth, visual results and conflicts.', issues: [],
  }],
};
const processPayload = {
  mode: 'process_review', proposal_id: storedContext.proposal.id,
  approve: true, review_intent_hash: reviewIntentHash,
};
const reviewRequest = {
  id: 'synthetic-owner-review-request', proposal_id: storedContext.proposal.id, status: 'queued',
  created_at: '2026-10-13T01:00:00Z', updated_at: '2026-10-13T01:00:00Z',
  expires_at: '2026-10-20T01:00:00Z', blockers: [], outcome: null,
};
const atomicContext = (context: any = storedContext, overrides: any = {}) => ({
  ...context, review_intent_hash: reviewIntentHash, review_request: reviewRequest, ...overrides,
});
type RpcCall = { name: string; args: any };
type RpcResult = { data?: any; error?: { message: string; code?: string } | null };
type InvokeOptions = {
  user?: { id: string } | null;
  role?: string;
  active?: boolean;
  rpc: (name: string, args: any) => RpcResult | Promise<RpcResult>;
};
function queueRpc(overrides: Record<string, RpcResult> = {}): InvokeOptions['rpc'] {
  return (name: string) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === 'uid_review_preflight') return { data: atomicContext() };
    if (name === 'uid_review_enqueue' || name === 'uid_review_get') return { data: reviewRequest };
    if (name === 'uid_review_cancel') return { data: { ...reviewRequest, status: 'cancelled' } };
    if (name === 'uid_governance_accept_merge') return { data: {
      proposal_id: storedContext.proposal.id, status: 'merged',
      merged_at: '2026-10-13T01:00:00Z', merged_nodes: [target.id], cross_brand_sync: false,
    } };
    assert.fail(`Unexpected protected RPC: ${name}`);
  };
}

// Real Edge source, with all database and network boundaries replaced by test doubles.
// Unexpected direct writes or media/agent calls fail instead of reaching a service.
const edgeCode = transformSync(
  readFileSync('supabase/functions/creative-dna-admin-feedback/index.ts', 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default', 'const handler =')
    + '\nglobalThis.handler = handler;',
  { loader: 'ts' },
).code;
async function invoke(payload: any, options: InvokeOptions) {
  const rpcCalls: RpcCall[] = [];
  const clientConfigs: any[] = [];
  const member = {
    select: () => member, eq: () => member,
    maybeSingle: async () => ({ data: { role: options.role ?? 'admin', is_active: options.active ?? true } }),
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: Object.hasOwn(options, 'user') ? options.user : { id: ownerId } } }) },
    from: (name: string) => {
      assert.equal(name, 'creative_dna_team_members', 'queue Edge routes must use protected RPCs, never direct data writes');
      return member;
    },
    rpc: async (name: string, args: any) => {
      const captured = { name, args: JSON.parse(JSON.stringify(args)) };
      rpcCalls.push(captured);
      return options.rpc(name, captured.args);
    },
  };
  const sandbox: any = {
    ...reviewModule, buildOwnerRulePlan, Response, Request, URL,
    Deno: { env: { get: (key: string) => `synthetic-${key}` } },
    createClient: (...args: any[]) => { clientConfigs.push(args); return client; },
    fetch: async () => { assert.fail('queueing/status/cancel must not launch a reviewer or fetch candidate media'); },
  };
  vm.runInNewContext(edgeCode, sandbox);
  const response = await sandbox.handler.fetch(new Request('https://example.test/admin', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic-owner-session', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  return { response, body: await response.json(), rpcCalls, clientConfigs };
}

async function withGateway(
  handler: (payload: any, init?: RequestInit) => Response | Promise<Response>,
  check: (base: string, realFetch: typeof fetch, calls: any[]) => Promise<void>,
) {
  const originalUrl = process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;
  const upstreamUrl = 'https://synthetic-admin.example.test/queue';
  process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL = upstreamUrl;
  const realFetch = globalThis.fetch;
  const calls: any[] = [];
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), upstreamUrl);
    const payload = JSON.parse(String(init?.body));
    calls.push(payload);
    return handler(payload, init);
  };
  try {
    await check(base, realFetch, calls);
  } finally {
    globalThis.fetch = realFetch;
    if (originalUrl === undefined) delete process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;
    else process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL = originalUrl;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('queue Edge routes require an authenticated active administrator before protected RPC access', async () => {
  for (const mode of ['process_review', 'review_preflight', 'review_request_status', 'cancel_review']) {
    for (const [auth, expectedStatus] of [
      [{ user: null }, 401], [{ role: 'member' }, 403], [{ active: false }, 403],
    ] as [Partial<InvokeOptions>, number][]) {
      const result = await invoke({ ...processPayload, mode, request_id: reviewRequest.id }, {
        ...auth, rpc: () => assert.fail('unauthorized users must not access review queue RPCs'),
      });
      assert.equal(result.response.status, expectedStatus);
      assert.deepEqual(result.rpcCalls, []);
    }
  }
});

test('process_review enqueues only server-derived actor, proposal and current intent through protected SQL', async () => {
  const result = await invoke({
    ...processPayload, actor_user_id: 'forged-owner', owner_user_id: 'forged-owner',
    request_id: 'forged-request', claim_token: 'forged-lease', capabilities: ['merge_without_review'],
    evaluation_id: storedEvaluation.id, candidate_runs: storedEvaluation.test_results,
    candidate_hash: 'forged-candidate-hash',
    approval_snapshot: { candidate_hash: 'forged-hash', unlimited: true },
    review: { visual_reviewed: true, product_truth_verified: true, conflicts_reviewed: true },
    automatic_review: { status: 'ready_to_merge', evaluation_id: storedEvaluation.id },
  }, { rpc: queueRpc() });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.rpcCalls, [
    { name: 'uid_review_preflight', args: { p_proposal_id: storedContext.proposal.id, p_actor_user_id: ownerId } },
    { name: 'uid_review_enqueue', args: {
      p_proposal_id: storedContext.proposal.id, p_actor_user_id: ownerId,
      p_expected_intent_hash: reviewIntentHash,
    } },
  ]);
  assert.equal(result.body.status, 'queued');
  assert.deepEqual(result.body.review_request, reviewRequest);
  assert.equal(result.body.automatic_review.status, 'needs_candidate');
  assert.equal(result.body.automatic_review.evaluation_id, null);
  assert.equal(result.body.approval_recorded, true);
  assert.equal(result.body.background_task_started, false);
  assert.equal(result.body.canonical_changed, false);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.clientConfigs[0][2].global.headers.Authorization, 'Bearer synthetic-owner-session');
  assert.doesNotMatch(JSON.stringify(result.body), /synthetic-SUPABASE_SERVICE_ROLE_KEY|forged-lease|forged-owner/);
});

test('queue approval requires an exact boolean and a current owner-bound intent hash before enqueue', async () => {
  for (const approve of [undefined, false, null, 'true', 1]) {
    const result = await invoke({ ...processPayload, approve }, { rpc: queueRpc() });
    assert.equal(result.response.status, 422);
    assert.deepEqual(result.rpcCalls, []);
  }
  for (const review_intent_hash of [undefined, null, 42, '', 'intent-v1:stale', 'intent-v1:another-owner']) {
    const result = await invoke({ ...processPayload, review_intent_hash }, { rpc: queueRpc() });
    assert.equal(result.response.status, typeof review_intent_hash === 'string' && review_intent_hash ? 409 : 422);
    assert.ok(result.rpcCalls.every(call => call.name === 'uid_review_preflight'));
  }
  const missingProposal = await invoke({ ...processPayload, proposal_id: undefined }, { rpc: queueRpc() });
  assert.equal(missingProposal.response.status, 422);
  assert.deepEqual(missingProposal.rpcCalls, []);
});

test('canonical and evidence drift preserves approved idea intent but requires fresh snapshot-bound QC', async () => {
  for (const changedContext of [
    { ...storedContext, candidate_hash: 'scope-v2:canonical-updated', targets: [{ ...target, node_hash: 'node-v2:new-rules', content_md: 'Updated canonical product rules.' }] },
    { ...storedContext, candidate_hash: 'scope-v2:baseline-updated', baselines: [{ ...baseline, approved_at: '2026-10-13T02:00:00Z', expected_assertions: { required_text: ['T-Shirt', 'cotton'] } }] },
  ]) {
    const result = await invoke({ ...processPayload, candidate_hash: storedContext.candidate_hash }, {
      rpc: queueRpc({ uid_review_preflight: { data: atomicContext({ ...changedContext, evaluations: [storedEvaluation] }) } }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, 'queued');
    assert.equal(result.body.automatic_review.candidate_hash, changedContext.candidate_hash);
    assert.equal(result.body.automatic_review.status, 'needs_candidate');
    assert.equal(result.body.automatic_review.evaluation_id, null);
    assert.equal(result.body.approval_recorded, true);
    assert.equal(result.body.canonical_changed, false);
    assert.deepEqual(result.rpcCalls.at(-1), { name: 'uid_review_enqueue', args: {
      p_proposal_id: storedContext.proposal.id, p_actor_user_id: ownerId, p_expected_intent_hash: reviewIntentHash,
    } });
    assert.ok(result.rpcCalls.every(call => call.name !== 'uid_governance_accept_merge'));
  }
});

test('missing or mismatched atomic intent cannot enqueue or merge, including otherwise ready evidence', async () => {
  for (const evaluations of [[], [storedEvaluation]]) {
    for (const review_intent_hash of [undefined, null, '', 42, 'intent-v1:changed-proposal-or-scope']) {
      const result = await invoke(processPayload, { rpc: queueRpc({
        uid_review_preflight: { data: atomicContext({ ...storedContext, evaluations }, { review_intent_hash }) },
      }) });
      assert.equal(result.response.status, 409);
      assert.notEqual(result.body.approval_recorded, true);
      assert.notEqual(result.body.canonical_changed, true);
      assert.deepEqual(result.rpcCalls, [{ name: 'uid_review_preflight', args: {
        p_proposal_id: storedContext.proposal.id, p_actor_user_id: ownerId,
      } }]);
    }
  }
});

test('atomic approval never composes independently read intent and review context from different snapshots', async () => {
  const result = await invoke(processPayload, { rpc: (name) => {
    if (name === 'uid_review_preflight') return { data: atomicContext(
      { ...storedContext, evaluations: [storedEvaluation] }, { review_intent_hash: 'intent-v1:changed-scope' },
    ) };
    // These individually plausible reads model the old cross-snapshot race.
    if (name === 'uid_governance_review_context') return { data: { ...storedContext, evaluations: [storedEvaluation] } };
    if (name === 'uid_review_intent_hash') return { data: reviewIntentHash };
    assert.fail(`A mismatched atomic snapshot must not reach ${name}`);
  } });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight']);
});

test('missing or nonpending proposals cannot create new queue approval', async () => {
  for (const data of [null, { ...storedContext, proposal: { ...storedContext.proposal, status: 'merged' } }]) {
    const result = await invoke(processPayload, { rpc: queueRpc({ uid_review_preflight: { data: data ? atomicContext(data) : null } }) });
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight']);
  }
});

test('enqueue preserves SQL stale-snapshot or owner denial and never claims approval succeeded', async () => {
  for (const message of ['Approval snapshot changed before enqueue', 'Owner administrator required']) {
    const result = await invoke(processPayload, { rpc: queueRpc({ uid_review_enqueue: { error: { message } } }) });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error, message);
    assert.notEqual(result.body.approval_recorded, true);
    assert.notEqual(result.body.canonical_changed, true);
    assert.equal(result.rpcCalls.filter(call => call.name === 'uid_review_enqueue').length, 1);
    assert.ok(result.rpcCalls.every(call => call.name !== 'uid_governance_accept_merge'));
  }
});

test('queued, blocked and already leased requests remain honest about no immediate reviewer launch', async () => {
  for (const status of ['queued', 'blocked', 'leased']) {
    const request = { ...reviewRequest, status, blockers: status === 'blocked' ? [{ code: 'needs_source', message: 'Source unavailable' }] : [] };
    const result = await invoke(processPayload, { rpc: queueRpc({ uid_review_enqueue: { data: request } }) });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, status);
    assert.deepEqual(result.body.review_request, request);
    assert.equal(result.body.approval_recorded, true);
    assert.equal(result.body.background_task_started, false);
    assert.equal(result.body.canonical_changed, false);
  }
});

test('missing evidence and mechanical failures queue bounded work without synthesizing a passed evaluation', async () => {
  for (const [context, expected] of [
    [{ ...storedContext, baselines: [] }, 'needs_baseline'],
    [storedContext, 'needs_candidate'],
    [{ ...storedContext, evaluations: [{ ...storedEvaluation, evaluation_status: 'blocked', conflict_results: [] }] }, 'needs_actual_review'],
    [{ ...storedContext, evaluations: [{ ...storedEvaluation, test_results: [{ ...storedEvaluation.test_results[0], candidate_output: { title: 'T-Shirt cure' } }] }] }, 'checks_failed'],
  ] as const) {
    const result = await invoke(processPayload, { rpc: queueRpc({ uid_review_preflight: { data: atomicContext(context) } }) });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, 'queued');
    assert.equal(result.body.automatic_review.status, expected);
    assert.equal(result.body.automatic_review.evaluation_id, null);
    assert.ok(result.body.automatic_review.blockers.length > 0);
    assert.equal(result.body.canonical_changed, false);
    assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight', 'uid_review_enqueue']);
  }
});

test('existing trusted stored-review fastpath still merges without creating a queue request', async () => {
  const result = await invoke({ ...processPayload, actor_user_id: 'forged-owner', evaluation_id: 'forged-evaluation' }, {
    rpc: queueRpc({ uid_review_preflight: { data: atomicContext({ ...storedContext, evaluations: [storedEvaluation] }) } }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'merged');
  assert.equal(result.body.canonical_changed, true);
  assert.equal(result.body.proposal.id, storedContext.proposal.id);
  assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight', 'uid_governance_accept_merge']);
  assert.equal(result.rpcCalls[1].args.p_actor_user_id, ownerId);
  assert.equal(result.rpcCalls[1].args.p_evaluation_id, storedEvaluation.id);
});

test('compiled routes queue genuine stored reviews instead of using the legacy append-only merger', async () => {
  for (const change of [
    { targets: [{ ...target, slug: 'onepage-system' }], baselines: [{ ...baseline, branch_slug: 'onepage-system' }] },
    { targets: [{ ...target, slug: 'brand-dna' }], baselines: [{ ...baseline, branch_slug: 'brand-dna' }] },
    { targets: [{ ...target, metadata: { creative_quality_contract: { schema_version: 'uid-creative-quality-catalog/1' } } }] },
    { compiler_context: { dependent_nodes: [{ id: 'dependent-brand-node' }] } },
  ]) {
    const context = { ...storedContext, evaluations: [storedEvaluation], ...change };
    assert.equal(reviewModule.prepareAutomaticReview(context).status, 'ready_to_merge');
    const result = await invoke(processPayload, { rpc: queueRpc({ uid_review_preflight: { data: atomicContext(context) } }) });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, 'queued');
    assert.equal(result.body.canonical_changed, false);
    assert.equal(result.body.automatic_review.status, 'blocked');
    assert.equal(result.body.automatic_review.checks.actual_review, 'verified');
    assert.equal(result.body.automatic_review.evaluation_id, null);
    assert.ok(result.body.automatic_review.blockers.some((b: any) => b.code === 'compiler_integration_required'));
    assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight', 'uid_review_enqueue']);
  }
});

test('enqueue must return a matching live request before recording approval success', async () => {
  for (const request of [
    null, {}, { ...reviewRequest, id: '' }, { ...reviewRequest, proposal_id: 'another-proposal' },
    ...['merged', 'cancelled', 'expired', 'superseded', 'unknown'].map(status => ({ ...reviewRequest, status })),
  ]) {
    const result = await invoke(processPayload, { rpc: queueRpc({ uid_review_enqueue: { data: request } }) });
    assert.equal(result.response.status, 502, JSON.stringify(request));
    assert.notEqual(result.body.approval_recorded, true);
    assert.notEqual(result.body.canonical_changed, true);
    assert.ok(result.rpcCalls.every(call => call.name !== 'uid_governance_accept_merge'));
  }
});

test('process_review never falls back from an owner denial or composes independent authority snapshots', async () => {
  const result = await invoke(processPayload, { rpc: (name) => {
    assert.equal(name, 'uid_review_preflight', 'processing must never fall back to a general admin read');
    return { error: { message: 'Enabled verified configured owner required', code: '42501' } };
  } });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.rpcCalls, [{ name: 'uid_review_preflight', args: { p_proposal_id: storedContext.proposal.id, p_actor_user_id: ownerId } }]);
  assert.notEqual(result.body.approval_recorded, true);
});

test('processing rejects a wrong-proposal atomic snapshot before queue or merge writes', async () => {
  for (const evaluations of [[], [storedEvaluation]]) {
    const result = await invoke(processPayload, { rpc: queueRpc({ uid_review_preflight: { data: atomicContext({
      ...storedContext, proposal: { ...storedContext.proposal, id: 'another-proposal' }, evaluations,
    }) } }) });
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight']);
    assert.notEqual(result.body.canonical_changed, true);
  }
});

test('malformed partial owner snapshots fail closed without fake queue approval or uncaught errors', async t => {
  for (const [label, change] of [
    ['null candidate hash', { candidate_hash: null }], ['empty candidate hash', { candidate_hash: '' }],
    ['null targets', { targets: null }], ['null target entry', { targets: [null] }],
    ['missing baselines', { baselines: undefined }], ['null baseline entry', { baselines: [null] }],
    ['missing evaluations', { evaluations: undefined }], ['null evaluation entry', { evaluations: [null] }],
    ['null covered candidates', { covered_candidates: null }],
  ] as const) {
    for (const mode of ['review_preflight', 'process_review']) {
      await t.test(`${mode}: ${label}`, async () => {
        const result = await invoke({ ...processPayload, mode }, { rpc: queueRpc({
          uid_review_preflight: { data: atomicContext({ ...storedContext, ...change }) },
        }) });
        assert.ok(result.response.status >= 400, `${mode} accepted ${label}`);
        assert.notEqual(result.body.approval_recorded, true);
        assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight']);
      });
    }
  }
});

test('review_request_status reads only the authenticated owner and selected proposal', async () => {
  const result = await invoke({
    mode: 'review_request_status', proposal_id: storedContext.proposal.id,
    actor_user_id: 'forged-owner', owner_user_id: 'forged-owner', request_id: 'forged-request',
  }, { rpc: queueRpc() });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { review_request: reviewRequest });
  assert.deepEqual(result.rpcCalls, [{
    name: 'uid_review_get', args: { p_proposal_id: storedContext.proposal.id, p_actor_user_id: ownerId },
  }]);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
});

test('review_request_status cannot substitute a supplied owner to discover a foreign request', async () => {
  const result = await invoke({ mode: 'review_request_status', proposal_id: storedContext.proposal.id, actor_user_id: 'another-owner' }, {
    rpc: (name, args) => {
      assert.equal(name, 'uid_review_get');
      return { data: args.p_actor_user_id === ownerId ? null : { ...reviewRequest, id: 'PRIVATE-FOREIGN-REQUEST' } };
    },
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { review_request: null });
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE-FOREIGN/);
});

test('review_request_status rejects missing proposal and preserves queue read errors', async () => {
  const invalid = await invoke({ mode: 'review_request_status' }, { rpc: queueRpc() });
  assert.equal(invalid.response.status, 400);
  assert.deepEqual(invalid.rpcCalls, []);
  const denied = await invoke({ mode: 'review_request_status', proposal_id: storedContext.proposal.id }, {
    rpc: queueRpc({ uid_review_get: { error: { message: 'Owner queue access denied' } } }),
  });
  assert.equal(denied.response.status, 409);
  assert.deepEqual(denied.body, { error: 'Owner queue access denied' });
});

test('cancel_review binds the request, proposal and verified owner and does not change canonical content', async () => {
  const result = await invoke({
    mode: 'cancel_review', proposal_id: storedContext.proposal.id, request_id: reviewRequest.id,
    actor_user_id: 'forged-owner', owner_user_id: 'forged-owner', status: 'merged',
  }, { rpc: queueRpc() });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.review_request.status, 'cancelled');
  assert.equal(result.body.canonical_changed, false);
  assert.deepEqual(result.rpcCalls, [{ name: 'uid_review_cancel', args: {
    p_request_id: reviewRequest.id, p_proposal_id: storedContext.proposal.id, p_actor_user_id: ownerId,
  } }]);
});

test('cancel_review cannot cancel another owner request or a same-owner request on another proposal route', async () => {
  for (const [request_id, proposal_id] of [
    ['foreign-owner-request', storedContext.proposal.id],
    [reviewRequest.id, 'another-proposal'],
  ]) {
    const result = await invoke({ mode: 'cancel_review', proposal_id, request_id, actor_user_id: 'forged-owner' }, {
      rpc: (name, args) => {
        assert.equal(name, 'uid_review_cancel');
        assert.equal(args.p_actor_user_id, ownerId);
        assert.equal(args.p_request_id, request_id);
        assert.equal(args.p_proposal_id, proposal_id);
        return { error: { message: 'Owner review request not found' } };
      },
    });
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.body, { error: 'Owner review request not found' });
    assert.equal(result.rpcCalls.length, 1);
  }
});

test('cancel_review rejects missing request or proposal before calling SQL', async () => {
  for (const payload of [
    { mode: 'cancel_review', proposal_id: storedContext.proposal.id },
    { mode: 'cancel_review', request_id: reviewRequest.id },
  ]) {
    const result = await invoke(payload, { rpc: queueRpc() });
    assert.equal(result.response.status, 400);
    assert.deepEqual(result.rpcCalls, []);
  }
});

test('preflight adds an owner-only review request and remains a read-only uncached snapshot', async () => {
  for (const request of [reviewRequest, null]) {
    const result = await invoke({ mode: 'review_preflight', proposal_id: storedContext.proposal.id, actor_user_id: 'forged-owner' }, {
      rpc: queueRpc({ uid_review_preflight: { data: atomicContext(storedContext, { review_request: request }) } }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(result.body.review_request, request);
    assert.equal(result.body.review_intent_hash, reviewIntentHash);
    assert.equal(result.body.automatic_review.status, 'needs_candidate');
    assert.deepEqual(result.rpcCalls, [
      { name: 'uid_review_preflight', args: { p_proposal_id: storedContext.proposal.id, p_actor_user_id: ownerId } },
    ]);
  }
});

test('preflight preserves atomic snapshot rejection instead of pretending the owner has no request', async () => {
  const result = await invoke({ mode: 'review_preflight', proposal_id: storedContext.proposal.id }, {
    rpc: queueRpc({ uid_review_preflight: { error: { message: 'Owner atomic snapshot unavailable' } } }),
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, 'Owner atomic snapshot unavailable');
  assert.equal(Object.hasOwn(result.body, 'review_request'), false);
  assert.deepEqual(result.rpcCalls.map(call => call.name), ['uid_review_preflight']);
});

test('preflight fails closed when an owner-bound approval intent cannot be prepared', async () => {
  for (const review_intent_hash of [undefined, null, '', 42]) {
    const result = await invoke({ mode: 'review_preflight', proposal_id: storedContext.proposal.id }, {
      rpc: queueRpc({ uid_review_preflight: { data: atomicContext(storedContext, { review_intent_hash }) } }),
    });
    assert.equal(result.response.status, 503);
    assert.equal(Object.hasOwn(result.body, 'review_intent_hash'), false);
    assert.match(result.body.error, /queue unavailable/i);
  }
});

test('public Edge review modes do not accept client lease or completion commands', async () => {
  for (const mode of ['uid_review_claim_next', 'uid_review_complete', 'review_claim', 'review_complete']) {
    const result = await invoke({ mode, request_id: reviewRequest.id, owner_user_id: ownerId, status: 'passed' }, { rpc: queueRpc() });
    assert.equal(result.response.status, 400);
    assert.deepEqual(result.rpcCalls, []);
  }
});

test('queue gateway routes reject missing sessions and malformed cancellation before upstream access', async () => {
  await withGateway(() => assert.fail('invalid requests must not reach upstream'), async (base, realFetch, calls) => {
    for (const [path, method] of [
      ['review-request', 'GET'], ['cancel-review', 'POST'], ['process', 'POST'],
    ]) {
      const response = await realFetch(`${base}/api/admin/feedback/route-proposal/${path}`, { method });
      assert.equal(response.status, 401);
    }
    for (const request_id of [undefined, '', null, 7]) {
      const response = await realFetch(`${base}/api/admin/feedback/route-proposal/cancel-review`, {
        method: 'POST', headers: { Authorization: 'Bearer synthetic.owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id }),
      });
      assert.equal(response.status, 422);
    }
    assert.deepEqual(calls, []);
  });
});

test('queue gateway pins route proposal and operation, forwards the session and strips client authority claims', async () => {
  await withGateway((_payload, init) => {
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic.owner');
    return Response.json({ review_request: reviewRequest, canonical_changed: false });
  }, async (base, realFetch, calls) => {
    const headers = { Authorization: 'Bearer synthetic.owner', 'Content-Type': 'application/json' };
    const forged = { mode: 'uid_review_complete', proposal_id: 'wrong-proposal', actor_user_id: 'wrong-owner', owner_user_id: 'wrong-owner', claim_token: 'wrong-lease' };
    const status = await realFetch(`${base}/api/admin/feedback/route-proposal/review-request?owner_user_id=wrong-owner&proposal_id=wrong-proposal`, { headers });
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    const cancel = await realFetch(`${base}/api/admin/feedback/route-proposal/cancel-review`, {
      method: 'POST', headers, body: JSON.stringify({ ...forged, request_id: reviewRequest.id }),
    });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.headers.get('cache-control'), 'no-store');
    const process = await realFetch(`${base}/api/admin/feedback/route-proposal/process`, {
      method: 'POST', headers, body: JSON.stringify({ ...forged, approve: true, review_intent_hash: reviewIntentHash, candidate_hash: 'ignored-client-evidence-hash' }),
    });
    assert.equal(process.status, 200);
    assert.deepEqual(calls, [
      { mode: 'review_request_status', proposal_id: 'route-proposal' },
      { mode: 'cancel_review', proposal_id: 'route-proposal', request_id: reviewRequest.id },
      { mode: 'process_review', proposal_id: 'route-proposal', approve: true, review_intent_hash: reviewIntentHash },
    ]);
  });
});

test('queue gateway preserves upstream owner denial and stale conflict status without claiming success', async () => {
  await withGateway(payload => Response.json({ error: 'Owner review request not found' }, {
    status: payload.mode === 'review_request_status' ? 403 : 409,
  }), async (base, realFetch) => {
    const headers = { Authorization: 'Bearer synthetic.owner', 'Content-Type': 'application/json' };
    const status = await realFetch(`${base}/api/admin/feedback/route-proposal/review-request`, { headers });
    assert.equal(status.status, 403);
    assert.deepEqual(await status.json(), { error: 'Owner review request not found' });
    const cancel = await realFetch(`${base}/api/admin/feedback/route-proposal/cancel-review`, {
      method: 'POST', headers, body: JSON.stringify({ request_id: reviewRequest.id }),
    });
    assert.equal(cancel.status, 409);
    assert.deepEqual(await cancel.json(), { error: 'Owner review request not found' });
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresWorkspaceProviderBudget, workspaceMaximumProviderCost, workspaceProviderUsage, workspaceProviderUsageCost, type WorkspaceProviderBudgetReport, type WorkspaceProviderBudgetRequest, type WorkspaceProviderOperation } from '../uid-workspace-provider-budget.ts';
import { PostgresWorkspaceBudget, type WorkspacePricing } from '../uid-workspace-budget.ts';
import { WORKSPACE_OPENAI_MODEL, type WorkspaceOpenAIBudgetRequest, type WorkspaceOpenAIBudgetReservation } from '../uid-workspace-openai.ts';
import { TABLE, NOW, before, later, pricing, fixtureState, budgetRequest, boundFor, fixtureBudget } from './helpers/workspace-provider-fixture.ts';
function reserved(r: WorkspaceOpenAIBudgetReservation) { assert.equal(r.status, 'reserved'); return r as Extract<WorkspaceOpenAIBudgetReservation, { status: 'reserved' }>; }
function report(reservation_id: string, r: WorkspaceProviderBudgetRequest, overrides: Partial<WorkspaceProviderBudgetReport> = {}): WorkspaceProviderBudgetReport { return { reservation_id, operation_id: r.operation_id, request_sha256: r.request_sha256, client_request_id: r.client_request_id, outcome: 'completed', usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { text_tokens: 60, image_tokens: 40 }, output_tokens_details: { image_tokens: 20, text_tokens: 0 } }, ...overrides }; }
const textPricing: WorkspacePricing = { evidence_ref: 'fixture-text-pricing', model: WORKSPACE_OPENAI_MODEL, verified_at: before, expires_at: later, max_input_tokens_per_utf8_byte: 1, protocol_input_token_overhead: 100, max_input_tokens: 10000, max_output_tokens: 1000,
  tiers: [{ through_input_tokens: 10000, input_microusd_per_million: 2_000_000, output_microusd_per_million: 8_000_000 }] };
function textRequest(overrides: Partial<WorkspaceOpenAIBudgetRequest> = {}): WorkspaceOpenAIBudgetRequest { return { authorization_id: 'alice-task-one-auth', owner_id: 'alice', task_id: 'task-one', project_id: 'project-one', operation_id: 'text-one', request_sha256: 'f'.repeat(64), client_request_id: 'text-request', model: WORKSPACE_OPENAI_MODEL, maximum_cost_microusd: 3000, request_bytes: 400, input_utf8_bytes: 200, max_output_tokens: 100, reasoning_effort: 'high', budget_authorization_ref: 'task-one-budget', global_budget_authorization_ref: 'global-approved', user_quota_authorization_ref: 'alice-quota', capability_verification_ref: 'text-capability', ...overrides }; }
function textAdapter(s: ReturnType<typeof fixtureBudget>) { return new PostgresWorkspaceBudget(s.pool, { schemaReviewed: true, schemaVersion: 'uid-workspace-budget-v1', qualifiedTable: TABLE, pricing: textPricing, now: () => NOW }); }

test('provider prices each modality with exact reviewed bound, not caller cap or text token estimator', () => {
  const r = budgetRequest(); assert.equal(workspaceMaximumProviderCost(r, pricing, boundFor(r), NOW), 2800);
  assert.equal(workspaceProviderUsageCost(report('x', r).usage!, pricing), 440);
  assert.equal(workspaceProviderUsageCost({ input_tokens: 100, output_tokens: 20, total_tokens: 120 }, pricing), 560);
  assert.throws(() => workspaceMaximumProviderCost(r, pricing, { ...boundFor(r), request_sha256: 'b'.repeat(64) }, NOW), /VERIFIED_EXACT_COST_BOUND_REQUIRED/);
  assert.throws(() => workspaceMaximumProviderCost(r, pricing, { ...boundFor(r), expires_at: before }, NOW), /VERIFIED_EXACT_COST_BOUND_REQUIRED/);
});
test('missing bound denies even enormous caller cap; no synthetic max_output_tokens on images', async () => {
  const s = fixtureBudget(); const budget = new PostgresWorkspaceProviderBudget(s.pool, { ...s.config, verifiedBounds: [] });
  assert.equal((await budget.reserve(budgetRequest({ maximum_cost_microusd: 10000 }))).status, 'denied');
  await assert.rejects(() => budget.reserve(budgetRequest({ max_output_tokens: 1 })), /INVALID_PROVIDER_BUDGET_REQUEST/);
  assert.equal(s.state().operations.length, 0);
});
test('upper bound uses worst reachable context tier, rounds integer microdollars', () => {
  const r = budgetRequest(); const p = { ...pricing, tiers: [{ through_input_tokens: 200, microusd_per_million: { input_text_tokens: 4_000_000, input_image_tokens: 8_000_000, output_text_tokens: 0, output_image_tokens: 16_000_000 } }, ...pricing.tiers] };
  assert.equal(workspaceMaximumProviderCost(r, p, boundFor(r), NOW), 5600);
  assert.equal(workspaceProviderUsageCost({ input_tokens: 1, output_tokens: 0, total_tokens: 1 }, { ...pricing, tiers: [{ through_input_tokens: 1000, microusd_per_million: { input_text_tokens: 1, input_image_tokens: 1, output_text_tokens: 0, output_image_tokens: 1 } }] }), 1);
});
test('old text grants cannot authorize images; exact provider data, endpoint and capability grants required', async () => {
  for (const change of ['remove', 'endpoint', 'model', 'data', 'capability', 'expire', 'revoke'] as const) {
    const state = fixtureState(); const p = state.tasks[0].provider_authorizations![0];
    if (change === 'remove') delete state.tasks[0].provider_authorizations;
    if (change === 'endpoint') p.endpoint = 'https://api.openai.com/v1/responses';
    if (change === 'model') p.model = 'unapproved-model';
    if (change === 'data') p.data_authorization_ref = 'not-approved';
    if (change === 'capability') p.capability_verification_ref = 'not-current';
    if (change === 'expire') p.expires_at = before;
    if (change === 'revoke') p.active = false;
    assert.equal((await fixtureBudget([budgetRequest()], state).budget.reserve(budgetRequest())).status, 'denied', change);
  }
});
test('actual legacy and provider adapter instances share one project cap in both reservation orders', async () => {
  for (const imageFirst of [true, false]) {
    const s = fixtureBudget([budgetRequest()], fixtureState(5000)); const legacy = textAdapter(s);
    const results = imageFirst ? [await s.budget.reserve(budgetRequest()), await legacy.reserve(textRequest())] : [await legacy.reserve(textRequest()), await s.budget.reserve(budgetRequest())];
    assert.deepEqual(results.map(r => r.status), ['reserved', 'denied']); assert.equal(s.state().operations.length, 1);
    assert.ok(s.statements.filter(q => q.sql.startsWith('SELECT pg_advisory')).every(q => q.values[0] === 'uid-workspace-budget:project-one'));
  }
});
test('parallel legacy/provider calls serialize one shared global cap across owners', async () => {
  const s = fixtureBudget([budgetRequest()], fixtureState(5000)); const legacy = textAdapter(s);
  const results = await Promise.all([s.budget.reserve(budgetRequest()), legacy.reserve(textRequest({ owner_id: 'bob', authorization_id: 'bob-task-one-auth', user_quota_authorization_ref: 'bob-quota' }))]);
  assert.deepEqual(results.map(r => r.status).sort(), ['denied', 'reserved']);
});
test('mixed modalities share per-owner and per-task caps and operation identity fences', async () => {
  for (const at of ['owner', 'task'] as const) {
    const state = fixtureState(); if (at === 'owner') state.owners[0].cap_microusd = 5000; else state.tasks[0].cap_microusd = 5000;
    const s = fixtureBudget([budgetRequest()], state); reserved(await textAdapter(s).reserve(textRequest()));
    assert.equal((await s.budget.reserve(budgetRequest())).status, 'denied');
  }
  const s = fixtureBudget(); reserved(await textAdapter(s).reserve(textRequest({ operation_id: 'image-one' })));
  assert.equal((await s.budget.reserve(budgetRequest())).status, 'conflict');
});
test('legacy reconciliation cannot mutate an image row; provider reconciliation cannot mutate text rows', async () => {
  const s = fixtureBudget(); const r = budgetRequest(), legacy = textAdapter(s); const hold = reserved(await s.budget.reserve(r)); await s.budget.markSubmissionIntent({ ...r, reservation_id: hold.reservation_id });
  await assert.rejects(() => legacy.reconcile(report(hold.reservation_id, r)), /BUDGET_MODALITY_ADAPTER_REQUIRED/);
  assert.equal(s.state().frozen, false); assert.equal(s.state().operations[0].state, 'submission_intent');
  const t = textRequest(), textHold = reserved(await legacy.reserve(t)); await legacy.markSubmissionIntent({ ...t, reservation_id: textHold.reservation_id });
  await assert.rejects(() => s.budget.reconcile({ ...report(textHold.reservation_id, r), operation_id: t.operation_id, request_sha256: t.request_sha256, client_request_id: t.client_request_id }), /BUDGET_REPORT_SCOPE_MISMATCH/);
});
test('durable duplicate, conflict and released fences survive new provider instance', async () => {
  const s = fixtureBudget(), r = budgetRequest(), hold = reserved(await s.budget.reserve(r)), restarted = new PostgresWorkspaceProviderBudget(s.pool, s.config);
  assert.equal((await restarted.reserve(r)).status, 'duplicate'); assert.equal((await restarted.reserve({ ...r, request_sha256: 'b'.repeat(64) })).status, 'conflict');
  assert.equal((await restarted.releaseBeforeSubmit({ ...r, reservation_id: hold.reservation_id })).released, true); assert.equal((await restarted.reserve(r)).status, 'duplicate');
});
test('single-use intent rechecks grants, cap and bound expiration and cannot release after intent', async () => {
  const s = fixtureBudget(), r = budgetRequest(), hold = reserved(await s.budget.reserve(r));
  const results = await Promise.all([s.budget.markSubmissionIntent({ ...r, reservation_id: hold.reservation_id }), s.budget.markSubmissionIntent({ ...r, reservation_id: hold.reservation_id })]); assert.equal(results.filter(v => v.ok).length, 1);
  assert.equal((await s.budget.releaseBeforeSubmit({ ...r, reservation_id: hold.reservation_id })).released, false);
  for (const change of ['revoke', 'reduce', 'expire'] as const) {
    const ss = fixtureBudget(), held = reserved(await ss.budget.reserve(r));
    if (change === 'expire') ss.setNow(NOW + 7200_000); else { const state = ss.state(); if (change === 'revoke') state.tasks[0].provider_authorizations![0].active = false; else state.global.cap_microusd = 2000; ss.seed(TABLE, 'project-one', state); }
    assert.equal((await ss.budget.markSubmissionIntent({ ...r, reservation_id: held.reservation_id })).ok, false);
  }
});
test('missing/unknown usage holds full cap; late settlement retains all usage and is idempotent', async () => {
  const s = fixtureBudget(), r = budgetRequest(), h = reserved(await s.budget.reserve(r)); await s.budget.markSubmissionIntent({ ...r, reservation_id: h.reservation_id });
  assert.equal((await s.budget.reconcile(report(h.reservation_id, r, { usage: undefined }))).status, 'held');
  assert.equal((await s.budget.reconcile(report(h.reservation_id, r, { outcome: 'unknown' }))).status, 'held');
  const settled = await s.budget.reconcile(report(h.reservation_id, r)); assert.equal(settled.status, 'settled'); assert.deepEqual(await s.budget.reconcile(report(h.reservation_id, r)), settled);
  const op = s.state().operations[0] as WorkspaceProviderOperation; assert.equal(op.charged_microusd, 440); assert.equal(op.reports!.length, 3); assert.deepEqual(op.report!.usage, report(h.reservation_id, r).usage);
  await assert.rejects(() => s.budget.reconcile(report(h.reservation_id, r, { response_id: 'other' })), /BUDGET_REPORT_CONFLICT/);
});
test('over-bound usage freezes shared project even if user cap remains; legacy cannot continue', async () => {
  const r = budgetRequest({ maximum_cost_microusd: 10000 }), s = fixtureBudget([r]), h = reserved(await s.budget.reserve(r)); await s.budget.markSubmissionIntent({ ...r, reservation_id: h.reservation_id });
  assert.equal((await s.budget.reconcile(report(h.reservation_id, r, { usage: { input_tokens: 100, output_tokens: 201, total_tokens: 301 } }))).status, 'held');
  assert.equal(s.state().frozen, true); assert.equal((await textAdapter(s).reserve(textRequest())).status, 'denied');
});
test('reported token split validation rejects malformed/mixed usage and retains raw details', () => {
  assert.equal(workspaceProviderUsage({ input_tokens: 10, output_tokens: 10, total_tokens: 21 }), undefined);
  assert.equal(workspaceProviderUsage({ input_tokens: 10, output_tokens: 10, total_tokens: 20, input_tokens_details: { text_tokens: 8, image_tokens: 3 } }), undefined);
  assert.equal(workspaceProviderUsage({ input_tokens: 10, output_tokens: 10, total_tokens: 20, input_tokens_details: { text_tokens: 10 } }), undefined);
  const usage = { input_tokens: 10, output_tokens: 10, total_tokens: 20, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 2 } };
  assert.deepEqual(workspaceProviderUsage(usage), usage);
});
test('Responses vision uses same journal and conservative input pricing without claiming image output', async () => {
  const r = budgetRequest({ modality: 'responses_vision', endpoint: 'https://api.openai.com/v1/responses', model: WORKSPACE_OPENAI_MODEL, input_images: [{ sha256: 'b'.repeat(64), bytes: 100, mime_type: 'image/png', width: 256, height: 256 }], image_options: undefined, max_output_tokens: 100 });
  const state = fixtureState(); state.tasks[0].provider_authorizations!.push({ ...state.tasks[0].provider_authorizations![0], modality: 'responses_vision', endpoint: r.endpoint, model: r.model });
  const s = fixtureBudget([], state), p = { ...pricing, modality: 'responses_vision' as const, model: r.model, accepted_response_models: [r.model], tiers: [{ through_input_tokens: 10000, microusd_per_million: { input_text_tokens: 2_000_000, input_image_tokens: 4_000_000, output_text_tokens: 8_000_000, output_image_tokens: 0 } }] };
  const bound = { ...boundFor(r), tokens: { input_text_tokens: 200, input_image_tokens: 200, output_text_tokens: 100, output_image_tokens: 0 } };
  const budget = new PostgresWorkspaceProviderBudget(s.pool, { ...s.config, pricing: [p], verifiedBounds: [bound] });
  const h = reserved(await budget.reserve(r)); await budget.markSubmissionIntent({ ...r, reservation_id: h.reservation_id });
  assert.equal((await budget.reconcile(report(h.reservation_id, r, { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }))).status, 'settled');
  assert.equal(s.state().operations[0].charged_microusd, 560);
});
test('lost commit acknowledgment fences restart; no journal provisioning or SQL injection', async () => {
  const s = fixtureBudget(); s.loseNextCommit(); await assert.rejects(() => s.budget.reserve(budgetRequest()), /BUDGET_OUTCOME_UNKNOWN/);
  assert.equal((await new PostgresWorkspaceProviderBudget(s.pool, s.config).reserve(budgetRequest())).status, 'duplicate');
  assert.equal((await s.budget.reserve(budgetRequest({ project_id: 'unprovisioned' }))).status, 'denied');
  assert.ok(!s.statements.some(q => q.sql.startsWith('INSERT INTO')));
  assert.throws(() => new PostgresWorkspaceProviderBudget(s.pool, { ...s.config, qualifiedTable: 'private.x;DROP' }), /BUDGET_SCHEMA_NOT_REVIEWED/);
});

test('readiness distinguishes missing pricing/bounds from per-task authorization', () => {
  const s = fixtureBudget(); assert.deepEqual(s.budget.readiness(), { ready: true, pricing_ready: true, bounds_ready: true, task_authorization_verified: false, exact_request_bound_verified: false, blockers: [] });
  const absent = new PostgresWorkspaceProviderBudget(s.pool, { ...s.config, verifiedBounds: [] }); assert.equal(absent.readiness().ready, false); assert.deepEqual(absent.readiness().blockers, ['INDEPENDENT_PROVIDER_COST_BOUND_REQUIRED']);
  s.setNow(NOW + 7200_000); assert.equal(s.budget.readiness().ready, false);
});
test('trusted reviewed resolver supports future exact requests outside SQL transactions', async () => {
  const s = fixtureBudget(); let called = 0;
  const b = new PostgresWorkspaceProviderBudget(s.pool, { ...s.config, verifiedBounds: [], boundResolver: {
    review_ref: 'fixture-resolver-review', independent_evidence_ref: 'fixture-independent-only', reviewed_by: 'fixture-operator', verified_at: before, expires_at: later,
    async resolveVerifiedBound(r) { called++; assert.equal(s.statements.length, 0, 'No SQL lock while resolving independent evidence'); return boundFor(r); },
  } });
  assert.equal(b.readiness().ready, true); reserved(await b.reserve(budgetRequest())); assert.equal(called, 1);
});
test('resolver estimates, mismatched requests, unreviewed provenance and expiry fail closed', async () => {
  for (const change of ['hash', 'model', 'provenance', 'reviewer', 'expiry', 'estimate', 'failure'] as const) {
    const s = fixtureBudget(); const b = new PostgresWorkspaceProviderBudget(s.pool, { ...s.config, verifiedBounds: [], boundResolver: {
      review_ref: 'fixture-review', independent_evidence_ref: 'fixture-independent-only', reviewed_by: 'fixture-operator', verified_at: before, expires_at: later,
      async resolveVerifiedBound(r) { if (change === 'failure') throw new Error('unavailable'); const result = boundFor(r);
        if (change === 'hash') result.request_sha256 = '0'.repeat(64); if (change === 'model') result.model = 'different'; if (change === 'provenance') result.independent_evidence_ref = 'unreviewed'; if (change === 'reviewer') result.reviewed_by = 'different'; if (change === 'expiry') result.expires_at = before; if (change === 'estimate') (result as any).basis = 'estimate'; return result; },
    } });
    assert.equal((await b.reserve(budgetRequest())).status, 'denied', change); assert.equal(s.state().operations.length, 0);
  }
});
test('unknown outcome with excessive reported usage keeps hold and freezes shared caps', async () => {
  const s = fixtureBudget(), r = budgetRequest(), h = reserved(await s.budget.reserve(r)); await s.budget.markSubmissionIntent({ ...r, reservation_id: h.reservation_id });
  const result = await s.budget.reconcile(report(h.reservation_id, r, { outcome: 'unknown', usage: { input_tokens: 100, output_tokens: 1000, total_tokens: 1100 } }));
  assert.equal(result.status, 'held'); assert.equal(s.state().frozen, true); assert.equal(s.state().operations[0].charged_microusd, 8400);
});

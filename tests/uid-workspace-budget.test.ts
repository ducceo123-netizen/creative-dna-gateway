import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresWorkspaceBudget, workspaceMaximumTextCost, type WorkspaceBudgetConfig, type WorkspacePricing, type WorkspaceProjectBudgetState } from '../uid-workspace-budget.ts';
import { WORKSPACE_OPENAI_MODEL, type WorkspaceOpenAIBudgetRequest, type WorkspaceOpenAIBudgetReport, type WorkspaceOpenAIBudgetReservation } from '../uid-workspace-openai.ts';
import { journalPool } from './helpers/workspace-journal-pool.ts';
const TABLE = 'private.workspace_budget';
const NOW = Date.parse('2026-11-06T10:00:00Z');
const before = new Date(NOW - 3600_000).toISOString(), later = new Date(NOW + 3600_000).toISOString();
const pricing: WorkspacePricing = { evidence_ref: 'pricing:reviewed-test-fixture', model: WORKSPACE_OPENAI_MODEL, verified_at: before, expires_at: later,
  max_input_tokens_per_utf8_byte: 1, protocol_input_token_overhead: 100, max_input_tokens: 10_000, max_output_tokens: 1000,
  tiers: [{ through_input_tokens: 1000, input_microusd_per_million: 2_000_000, output_microusd_per_million: 10_000_000 }, { through_input_tokens: 10_000, input_microusd_per_million: 4_000_000, output_microusd_per_million: 20_000_000 }] };
const grant = (ref: string, cap = 6000) => ({ active: true, authorization_ref: ref, cap_microusd: cap, valid_from: before, expires_at: later });
function state(cap = 10_000): WorkspaceProjectBudgetState { return { version: 1, project_id: 'project-one', frozen: false, global: grant('global-approved', cap),
  owners: ['alice', 'bob'].map(owner_id => ({ ...grant(owner_id + '-quota'), owner_id })),
  tasks: ['alice', 'bob'].flatMap(owner_id => ['task-one', 'task-two'].map(task_id => ({ ...grant(task_id + '-budget'), owner_id, task_id, authorization_id: owner_id + '-' + task_id + '-auth', data_authorization_ref: 'approved-data', capability_verification_ref: 'capability-verified', maximum_request_cost_microusd: 5000 }))), operations: [] }; }
function request(overrides: Partial<WorkspaceOpenAIBudgetRequest> = {}): WorkspaceOpenAIBudgetRequest { return { authorization_id: 'alice-task-one-auth', owner_id: 'alice', task_id: 'task-one', project_id: 'project-one', operation_id: 'operation-one', request_sha256: 'a'.repeat(64), client_request_id: 'request-one', model: WORKSPACE_OPENAI_MODEL, maximum_cost_microusd: 3000, request_bytes: 400, input_utf8_bytes: 200, max_output_tokens: 100, reasoning_effort: 'high', budget_authorization_ref: 'task-one-budget', global_budget_authorization_ref: 'global-approved', user_quota_authorization_ref: 'alice-quota', capability_verification_ref: 'capability-verified', ...overrides }; }
function setup(initial = state()) {
  const fake = journalPool(); fake.seed(TABLE, 'project-one', initial); let now = NOW;
  const config: WorkspaceBudgetConfig = { schemaReviewed: true, schemaVersion: 'uid-workspace-budget-v1', qualifiedTable: TABLE, pricing, now: () => now };
  const budget = new PostgresWorkspaceBudget(fake.pool, config);
  return { ...fake, budget, config, readState: () => fake.read<WorkspaceProjectBudgetState>(TABLE, 'project-one')!, setNow(value: number) { now = value; } };
}
function reserved(result: WorkspaceOpenAIBudgetReservation) { assert.equal(result.status, 'reserved'); return result as Extract<WorkspaceOpenAIBudgetReservation, { status: 'reserved' }>; }
function report(reservation_id: string, r: WorkspaceOpenAIBudgetRequest, overrides: Partial<WorkspaceOpenAIBudgetReport> = {}): WorkspaceOpenAIBudgetReport { return { reservation_id, operation_id: r.operation_id, client_request_id: r.client_request_id, request_sha256: r.request_sha256, outcome: 'completed', provider_request_id: 'provider-one', response_id: 'response-one', response_model: WORKSPACE_OPENAI_MODEL, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, ...overrides }; }

test('verified bounded pricing uses the worst applicable context tier and rounds safely', () => {
  assert.equal(workspaceMaximumTextCost(request(), pricing), 2000);
  assert.equal(workspaceMaximumTextCost(request({ request_bytes: 1000 }), pricing), 6400);
  assert.throws(() => workspaceMaximumTextCost(request({ request_bytes: 10_000 }), pricing), /PRICING_BOUNDS_EXCEEDED/);
  assert.throws(() => workspaceMaximumTextCost(request(), { ...pricing, protocol_input_token_overhead: 0 }), /INVALID_VERIFIED_PRICING/);
});
test('separate adapter instances atomically share global spend with per-owner attribution', async () => {
  const s = setup(state(5000)); const other = new PostgresWorkspaceBudget(s.pool, s.config);
  const a = request(); const b = request({ owner_id: 'bob', authorization_id: 'bob-task-one-auth', user_quota_authorization_ref: 'bob-quota' });
  const results = await Promise.all([s.budget.reserve(a), other.reserve(b)]);
  assert.deepEqual(results.map(r => r.status).sort(), ['denied', 'reserved']); assert.equal(s.readState().operations.length, 1);
});
test('owner cap spans tasks, task cap is independent, wrong authorization is denied', async () => {
  const initial = state(20_000); initial.owners[0].cap_microusd = 5000; const s = setup(initial);
  reserved(await s.budget.reserve(request()));
  assert.equal((await s.budget.reserve(request({ operation_id: 'two', task_id: 'task-two', authorization_id: 'alice-task-two-auth', budget_authorization_ref: 'task-two-budget' }))).status, 'denied');
  assert.equal((await s.budget.reserve(request({ operation_id: 'three', user_quota_authorization_ref: 'forged' }))).status, 'denied');
  assert.equal((await s.budget.reserve(request({ operation_id: 'four', maximum_cost_microusd: 1000 }))).status, 'denied');
});
test('idempotency survives process recreation and released operations retain a permanent fence', async () => {
  const s = setup(); const r = request(); const reservation = reserved(await s.budget.reserve(r));
  const restarted = new PostgresWorkspaceBudget(s.pool, s.config);
  assert.equal((await restarted.reserve(r)).status, 'duplicate');
  assert.equal((await restarted.reserve({ ...r, request_sha256: 'b'.repeat(64) })).status, 'conflict');
  assert.deepEqual(await restarted.releaseBeforeSubmit({ ...r, reservation_id: reservation.reservation_id }), { released: true });
  assert.equal((await restarted.reserve(r)).status, 'duplicate');
  assert.equal(s.readState().operations[0].state, 'released');
});
test('submission intent is single-use under concurrency and cannot release even before fetch', async () => {
  const s = setup(); const r = request(); const held = reserved(await s.budget.reserve(r));
  const attempts = await Promise.all([s.budget.markSubmissionIntent({ ...r, reservation_id: held.reservation_id }), s.budget.markSubmissionIntent({ ...r, reservation_id: held.reservation_id })]);
  assert.equal(attempts.filter(v => v.ok).length, 1);
  assert.deepEqual(await s.budget.releaseBeforeSubmit({ ...r, reservation_id: held.reservation_id }), { released: false });
});
test('authorization revocation, expiry and reduced shared caps fence already-reserved submission', async () => {
  for (const change of ['revoke', 'expire', 'reduce'] as const) {
    const s = setup(); const r = request(); const held = reserved(await s.budget.reserve(r));
    if (change === 'expire') s.setNow(NOW + 7200_000);
    else { const saved = s.readState(); if (change === 'revoke') saved.owners[0].active = false; else saved.global.cap_microusd = 2000; s.seed(TABLE, 'project-one', saved); }
    assert.equal((await s.budget.markSubmissionIntent({ ...r, reservation_id: held.reservation_id })).ok, false);
  }
});
test('missing or unknown usage retains full reservation, later verified usage settles once', async () => {
  const s = setup(state(5000)); const r = request(); const held = reserved(await s.budget.reserve(r));
  await s.budget.markSubmissionIntent({ ...r, reservation_id: held.reservation_id });
  assert.equal((await s.budget.reconcile(report(held.reservation_id, r, { usage: undefined }))).status, 'held');
  assert.equal((await s.budget.reserve(request({ operation_id: 'blocked' }))).status, 'denied');
  assert.equal((await s.budget.reconcile(report(held.reservation_id, r, { outcome: 'unknown' }))).status, 'held');
  const settlement = await s.budget.reconcile(report(held.reservation_id, r));
  assert.equal(settlement.status, 'settled'); assert.equal(s.readState().operations[0].charged_microusd, 400);
  assert.deepEqual(await s.budget.reconcile(report(held.reservation_id, r)), settlement);
  await assert.rejects(() => s.budget.reconcile(report(held.reservation_id, r, { response_id: 'changed' })), /BUDGET_REPORT_CONFLICT/);
  reserved(await s.budget.reserve(request({ operation_id: 'now-fits' })));
});
test('unknown outcomes never free spend at grant expiry and accounting overruns freeze project', async () => {
  const s = setup(); const r = request(); const held = reserved(await s.budget.reserve(r));
  await s.budget.markSubmissionIntent({ ...r, reservation_id: held.reservation_id });
  const over = report(held.reservation_id, r, { usage: { input_tokens: 2000, output_tokens: 100, total_tokens: 2100 } });
  assert.equal((await s.budget.reconcile(over)).status, 'held'); assert.equal(s.readState().frozen, true);
  assert.equal(s.readState().operations[0].charged_microusd, 10_000);
  assert.equal((await s.budget.reserve(request({ operation_id: 'never' }))).status, 'denied');
  s.setNow(NOW + 999_999_999); assert.equal((await s.budget.releaseBeforeSubmit({ ...r, reservation_id: held.reservation_id })).released, false);
});
test('lost reservation commit response is ambiguous; next process sees the durable fence', async () => {
  const s = setup(); s.loseNextCommit();
  await assert.rejects(() => s.budget.reserve(request()), /BUDGET_OUTCOME_UNKNOWN/);
  assert.equal((await new PostgresWorkspaceBudget(s.pool, s.config).reserve(request())).status, 'duplicate');
});
test('no unprovisioned budget is created, and SQL scope/table inputs are parameterized', async () => {
  const s = setup(); assert.equal((await s.budget.reserve(request({ project_id: 'another' }))).status, 'denied');
  assert.equal(s.read<WorkspaceProjectBudgetState>(TABLE, 'another'), undefined);
  assert.ok(s.statements.some(q => q.sql.includes('workspace_budget_project') && q.values[0] === 'another'));
  assert.ok(!s.statements.some(q => q.sql.startsWith('INSERT INTO')));
  assert.throws(() => new PostgresWorkspaceBudget(s.pool, { ...s.config, qualifiedTable: 'private.x;DROP TABLE x' }), /BUDGET_SCHEMA_NOT_REVIEWED/);
});
test('task transport authorization comes only from current durable grant scopes', async () => {
  const s = setup(); const auth = await s.budget.authorizationFor('project-one', 'alice', 'task-one');
  assert.equal(auth?.owner_id, 'alice'); assert.equal(auth?.budget_authorization_ref, 'task-one-budget');
  assert.equal(await s.budget.authorizationFor('project-one', 'mallory', 'task-one'), null);
  const saved = s.readState(); saved.owners[0].active = false; s.seed(TABLE, 'project-one', saved);
  assert.equal(await s.budget.authorizationFor('project-one', 'alice', 'task-one'), null);
});

const admissionScope = { brand: 'PawfectHouse', material: 'onepage' as const, source_url: 'https://pawfecthouse.com/products/example' };
function policyState() {
  const initial = state(20_000); initial.tasks = [];
  initial.owners[0].task_policy = { ...grant('standing-task-budget'), policy_id: 'approved-owner-policy', data_authorization_ref: 'approved-task-data', data_destination: 'https://api.openai.com/v1/responses', model: WORKSPACE_OPENAI_MODEL,
    capability_verification_ref: 'capability-verified', maximum_task_cap_microusd: 5000, maximum_request_cost_microusd: 3000, task_grant_ttl_ms: 1_800_000, maximum_admitted_tasks: 2,
    allowed_brands: ['PawfectHouse'], allowed_materials: ['onepage'], allowed_source_origins: ['https://pawfecthouse.com'] };
  return initial;
}
test('server admission provisions only fixed policy caps, is atomic/idempotent and charges nothing', async () => {
  const s = setup(policyState()); const second = new PostgresWorkspaceBudget(s.pool, s.config);
  const results = await Promise.all([s.budget.admitTask('project-one', 'alice', 'new-task', admissionScope, 'capability-verified'), second.admitTask('project-one', 'alice', 'new-task', admissionScope, 'capability-verified')]);
  assert.deepEqual(results.map(v => v.status).sort(), ['admitted', 'already_admitted']);
  const saved = s.readState(); assert.equal(saved.tasks.length, 1); assert.equal(saved.tasks[0].cap_microusd, 5000); assert.equal(saved.tasks[0].maximum_request_cost_microusd, 3000); assert.equal(saved.operations.length, 0);
  assert.equal(saved.tasks[0].expires_at, new Date(NOW + 1_800_000).toISOString());
  assert.ok(await s.budget.authorizationFor('project-one', 'alice', 'new-task', admissionScope));
  assert.equal(await s.budget.authorizationFor('project-one', 'alice', 'new-task', { ...admissionScope, source_url: 'https://pawfecthouse.com/products/changed' }), null);
});
test('admission without explicit policy, outside origin/brand scope, or beyond task limit stays denied', async () => {
  const s = setup(policyState());
  assert.equal((await s.budget.admitTask('project-one', 'bob', 'new-task', admissionScope, 'capability-verified')).code, 'TASK_ADMISSION_POLICY_REQUIRED');
  assert.equal((await s.budget.admitTask('project-one', 'alice', 'bad-brand', { ...admissionScope, brand: 'GiftSoul' }, 'capability-verified')).status, 'not_admitted');
  assert.equal((await s.budget.admitTask('project-one', 'alice', 'bad-origin', { ...admissionScope, source_url: 'https://other.example/product' }, 'capability-verified')).status, 'not_admitted');
  assert.equal((await s.budget.admitTask('project-one', 'alice', 'task-one', admissionScope, 'capability-verified')).status, 'admitted');
  assert.equal((await s.budget.admitTask('project-one', 'alice', 'task-two', admissionScope, 'capability-verified')).status, 'admitted');
  assert.equal((await s.budget.admitTask('project-one', 'alice', 'task-three', admissionScope, 'capability-verified')).code, 'TASK_ADMISSION_LIMIT_REACHED');
});
test('changed or revoked standing policy stops new calls for already admitted tasks', async () => {
  const s = setup(policyState()); await s.budget.admitTask('project-one', 'alice', 'new-task', admissionScope, 'capability-verified');
  const auth = await s.budget.authorizationFor('project-one', 'alice', 'new-task', admissionScope); assert.ok(auth);
  const r = request({ task_id: 'new-task', authorization_id: auth.authorization_id, budget_authorization_ref: auth.budget_authorization_ref });
  const reservation = reserved(await s.budget.reserve(r));
  const changed = s.readState(); changed.owners[0].task_policy!.active = false; s.seed(TABLE, 'project-one', changed);
  assert.equal(await s.budget.authorizationFor('project-one', 'alice', 'new-task', admissionScope), null);
  assert.equal((await s.budget.markSubmissionIntent({ ...r, reservation_id: reservation.reservation_id })).ok, false);
  assert.equal((await s.budget.admitTask('project-one', 'alice', 'new-task', admissionScope, 'capability-verified')).status, 'not_admitted');
});
test('lost admission acknowledgement is read safely by task identity without duplicated grants', async () => {
  const s = setup(policyState()); s.loseNextCommit();
  await assert.rejects(() => s.budget.admitTask('project-one', 'alice', 'new-task', admissionScope, 'capability-verified'), /BUDGET_OUTCOME_UNKNOWN/);
  assert.equal((await s.budget.admitTask('project-one', 'alice', 'new-task', admissionScope, 'capability-verified')).status, 'already_admitted');
  assert.equal(s.readState().tasks.length, 1);
});

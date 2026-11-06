import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MemoryWorkspaceStore, type WorkspaceRecord } from '../uid-workspace-store.ts';
import { createWorkspaceTask } from '../uid-workspace-task.ts';
import { createWorkspaceOperationJournal, workspaceChildOperationIdentity, workspaceValidateChildRecovery, workspaceChildrenUnsettled, type WorkspaceChildIntent, type WorkspaceChildReport } from '../uid-workspace-operations.ts';
import type { WorkspaceStageContext } from '../uid-workspace-runner.ts';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const now = Date.parse('2026-11-06T12:00:00Z');
const intent = (key: string, role: WorkspaceChildIntent['role'] = 'author'): WorkspaceChildIntent => ({ key, role, provider: 'openai-responses', model: 'gpt-6.1-sol', input_sha256: sha(key) });
async function fixture() {
  const store = new MemoryWorkspaceStore(); let allowed = true;
  const task = createWorkspaceTask('task-one', { snapshot_id: 'snapshot-one', canonical_version: 'canonical-one', content_revision: 'content-one', content_digest: sha('copy'), assets: [] });
  const action: WorkspaceRecord['actions'][number] = { action_id: 'action-one', idempotency_key: 'action-one', fingerprint: sha('action'), type: 'start', status: 'running', expected_state_version: task.state_version, content_revision: 'content-one', created_at: new Date(now).toISOString(), actor_id: 'alice', payload: {} };
  const run: NonNullable<WorkspaceRecord['runs']>[number] = { run_id: 'run-one', action_id: action.action_id, operation_id: 'root-operation', stage: 'content_authoring', expected_state_version: task.state_version, snapshot_id: 'snapshot-one', content_revision: 'content-one', fence: 1, status: 'in_flight', lease_owner: 'worker-one', lease_expires_at: new Date(now + 60000).toISOString(), created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() };
  const record: WorkspaceRecord = { owner_id: 'alice', task, brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://example.test/product' }, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), actions: [action], runs: [run], events: [], artifacts: [], content: null, preview: null, review_manifest: null, quality: [] };
  await store.transaction('alice', state => { state.tasks.push(record); });
  const controller = new AbortController();
  const context: WorkspaceStageContext = { owner_id: 'alice', record: structuredClone(record), run: structuredClone(run), action: structuredClone(action), signal: controller.signal };
  const options = { store, authorizeOwner: async () => allowed, now: () => now };
  const journal = createWorkspaceOperationJournal(options);
  const read = () => store.read('alice', state => state.tasks[0].runs![0]);
  const mutate = (fn: (r: WorkspaceRecord) => void) => store.transaction('alice', state => fn(state.tasks[0]));
  const complete = async (c: WorkspaceStageContext) => {
    const reservation_id = 'reserve:' + c.provider_operation!.operation_id, request_sha256 = sha(c.provider_operation!.operation_id);
    await c.bindProviderOperation!({ provider: 'openai-responses', reservation_id, request_sha256 });
    await journal.guardDispatch(c);
    const report: WorkspaceChildReport = { outcome: 'completed', accounting: 'settled', reservation_id, request_sha256, budget_receipt_id: 'budget:' + c.provider_operation!.operation_id, provider_operation_id: 'response:' + c.provider_operation!.operation_id, output_sha256: sha('output'), evidence_refs: ['test-only:receipt'] };
    return { value: 'untrusted output', report };
  };
  return { store, options, journal, context, controller, read, mutate, complete, revoke: () => { allowed = false; } };
}
test('author and independent reviewer keep distinct durable IDs and bindings in one stage', async () => {
  const f = await fixture();
  const author = await f.journal.execute(f.context, intent('author'), f.complete);
  const review = await f.journal.execute(f.context, intent('quality', 'independent_reviewer'), f.complete);
  assert.equal(author.status, 'completed'); assert.equal(review.status, 'completed'); assert.notEqual(author.operation_id, review.operation_id);
  const run = await f.read(); assert.equal(run.provider_binding, undefined); assert.equal(run.child_operations!.length, 2);
  assert.equal(workspaceChildrenUnsettled(run), false); assert.notEqual(run.child_operations![0].provider_binding!.reservation_id, run.child_operations![1].provider_binding!.reservation_id);
});
test('same key replay across a new journal instance cannot submit again or overwrite role/input', async () => {
  const f = await fixture(); let calls = 0;
  const perform = async (c: WorkspaceStageContext) => { calls++; return f.complete(c); };
  await f.journal.execute(f.context, intent('author'), perform);
  const second = createWorkspaceOperationJournal(f.options);
  assert.equal((await second.execute(f.context, intent('author'), perform)).status, 'blocked');
  assert.equal((await second.execute(f.context, intent('author', 'independent_reviewer'), perform) as any).code, 'CHILD_INTENT_CONFLICT'); assert.equal(calls, 1);
});
test('same key concurrent claim executes once, independent children have bounded parallelism', async () => {
  const f = await fixture(); let release!: () => void; const wait = new Promise<void>(done => { release = done; }); let calls = 0;
  const first = f.journal.execute(f.context, intent('same'), async c => { calls++; await wait; return f.complete(c); });
  await new Promise(done => setImmediate(done));
  assert.equal((await f.journal.execute(f.context, intent('same'), f.complete)).status, 'unknown');
  release(); assert.equal((await first).status, 'completed'); assert.equal(calls, 1);
});
test('unknown accounting prevents later reviewer/generator dispatch and survives restart', async () => {
  const f = await fixture();
  assert.equal((await f.journal.execute(f.context, intent('first'), async () => { throw new Error('connection lost'); })).status, 'unknown');
  let submitted = false;
  assert.equal((await createWorkspaceOperationJournal(f.options).execute(f.context, intent('next'), async c => { submitted = true; return f.complete(c); })).status, 'unknown');
  assert.equal(submitted, false); assert.equal(workspaceChildrenUnsettled(await f.read()), true);
});
test('cannot mark paid result settled without exact reserved binding and accounting receipt', async () => {
  const f = await fixture();
  const outcome = await f.journal.execute(f.context, intent('forged'), async () => ({ value: 'x', report: { outcome: 'completed', accounting: 'settled', output_sha256: sha('x'), budget_receipt_id: 'budget', evidence_refs: [] } }));
  assert.equal(outcome.status, 'unknown'); assert.equal((await f.read()).child_operations![0].report, undefined);
});
test('wrong reservation or output lacking independent evidence cannot be silently accepted', async () => {
  const f = await fixture();
  const result = await f.journal.execute(f.context, intent('wrong'), async c => { const result = await f.complete(c); result.report.reservation_id = 'other'; return result; });
  assert.equal(result.status, 'unknown');
});
test('actual dispatch guard catches queued cancellation after binding', async () => {
  const f = await fixture(); let called = false;
  const result = await f.journal.execute(f.context, intent('cancel'), async c => {
    await c.bindProviderOperation!({ provider: 'openai-responses', reservation_id: 'r', request_sha256: sha('r') });
    await f.mutate(r => { r.actions.push({ ...r.actions[0], action_id: 'cancel', type: 'cancel', status: 'queued' }); });
    await f.journal.guardDispatch(c); called = true; return f.complete(c);
  });
  assert.equal(result.status, 'unknown'); assert.equal(called, false);
});
test('actual dispatch guard catches member revocation, abort and expired lease', async () => {
  for (const change of ['revoke', 'abort', 'expire']) {
    const f = await fixture(); let called = false;
    const result = await f.journal.execute(f.context, intent(change), async c => {
      await c.bindProviderOperation!({ provider: 'openai-responses', reservation_id: 'r', request_sha256: sha('r') });
      if (change === 'revoke') f.revoke(); else if (change === 'abort') f.controller.abort(); else await f.mutate(r => { r.runs![0].lease_expires_at = new Date(now - 1).toISOString(); });
      await f.journal.guardDispatch(c); called = true; return f.complete(c);
    });
    assert.equal(result.status, 'unknown'); assert.equal(called, false);
  }
});
test('cancellation after settled call retains accounting but never accepts candidate output', async () => {
  const f = await fixture();
  const result = await f.journal.execute(f.context, intent('late'), async c => { const result = await f.complete(c); f.controller.abort(); return result; });
  assert.equal(result.status, 'unknown'); const child = (await f.read()).child_operations![0]; assert.equal(child.status, 'completed'); assert.equal(child.report!.accounting, 'settled');
});
test('unreserved known local failure is terminal, not free completion or provider success', async () => {
  const f = await fixture();
  assert.equal((await f.journal.execute(f.context, intent('invalid'), async () => ({ value: null, report: { outcome: 'failed_before_submit', accounting: 'not_reserved', evidence_refs: [] } }))).status, 'blocked');
  assert.equal(workspaceChildrenUnsettled(await f.read()), false);
});
test('child keys are scoped to owner/task/run; no nested context or model-chosen arbitrary identity', async () => {
  const f = await fixture(), first = workspaceChildOperationIdentity(f.context, intent('x'));
  assert.notDeepEqual(first, workspaceChildOperationIdentity({ ...f.context, owner_id: 'bob' }, intent('x')));
  assert.equal((await f.journal.execute({ ...f.context, provider_operation: first }, intent('nested'), f.complete)).status, 'blocked');
  assert.throws(() => workspaceChildOperationIdentity(f.context, { ...intent('x'), input_sha256: 'invalid' }), /INVALID_CHILD_INTENT/);
  await assert.rejects(() => f.journal.execute({ ...f.context, owner_id: 'bob' }, intent('x'), f.complete), /CHILD_RUN_SCOPE_MISMATCH/);
});
test('recovery requires every child exact binding and cannot erase settled earlier spend', async () => {
  const f = await fixture(); await f.journal.execute(f.context, intent('author'), f.complete);
  await f.journal.execute(f.context, intent('review'), async () => { throw new Error('unknown'); });
  const run = await f.read(), children = run.child_operations!;
  assert.equal(workspaceValidateChildRecovery(run, undefined, 'completed'), false);
  const proofs = children.map(child => ({ operation_id: child.operation_id, intent_sha256: child.intent_sha256, provider_binding: child.provider_binding, operation_fenced: true as const,
    report: child.report ?? { outcome: 'failed_before_submit' as const, accounting: 'not_reserved' as const, evidence_refs: ['checked:no-dispatch'] } }));
  assert.equal(workspaceValidateChildRecovery(run, proofs, 'completed'), true);
  assert.equal(workspaceValidateChildRecovery(run, proofs, 'no_side_effect'), false);
  assert.equal(workspaceValidateChildRecovery(run, proofs.slice(0, 1), 'completed'), false);
  proofs[0].report = { outcome: 'failed_before_submit', accounting: 'released', evidence_refs: ['invented:free'] };
  assert.equal(workspaceValidateChildRecovery(run, proofs, 'completed'), false);
});

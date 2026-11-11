import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MemoryWorkspaceStore } from '../uid-workspace-store.ts';
import { workspaceObjectKey, type WorkspacePrivateObjectStore } from '../uid-workspace-artifacts.ts';
import { createWorkspaceArtifactReconciler } from '../uid-workspace-artifact-recovery.ts';
import type { WorkspaceRecoveryContext } from '../uid-workspace-recovery.ts';
const now = Date.parse('2026-11-06T12:00:00Z'), data = Buffer.from('actual private recovered bytes'), sha = createHash('sha256').update(data).digest('hex');
async function fixture() {
  const store = new MemoryWorkspaceStore(); let allowed = true, missing = false, corrupt = false, put = 0, removed = 0, opens = 0;
  const object = { owner_id: 'alice', task_id: 'task', storage_key: workspaceObjectKey('alice','task',sha), sha256: sha, size_bytes: data.length, media_type: 'text/plain' };
  const request = { request_id: 'recovery-one', idempotency_key: 'one', fingerprint: sha, expected_state_version: 2, status: 'checking', fence: 4, lease_owner: 'new-worker', lease_expires_at: new Date(now + 10000).toISOString(), created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() };
  const run = { run_id: 'run', operation_id: 'operation', status: 'unknown', input_identity: sha, artifact_intents: [{ ...object, status: 'unknown', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }], recovery_requests: [request] };
  const record: any = { owner_id: 'alice', task: { task_id: 'task', interruption: { operation_id: 'operation' } }, actions: [], artifacts: [], events: [], runs: [run] };
  await store.transaction('alice', state => { state.tasks.push(record); });
  const objects: WorkspacePrivateObjectStore = { kind: 'fixture-only', productionReady: false, loopbackOnly: true,
    async put() { put++; throw new Error('MUST_NOT_PUT'); }, async remove() { removed++; throw new Error('MUST_NOT_DELETE'); },
    async open() { opens++; return missing ? null : { stream: (async function* () { yield corrupt ? Buffer.from('corrupt') : data; })(), async dispose() {} }; } };
  const controller = new AbortController(), context = { original: { owner_id: 'alice', record, run }, request_id: 'recovery-one', request_fence: 4, input_identity: sha, signal: controller.signal } as WorkspaceRecoveryContext;
  const reconciler = createWorkspaceArtifactReconciler({ store, objects, authorizeOwner: async () => allowed, now: () => now });
  return { store, context, controller, reconciler, object, objects, count: () => ({ put, removed, opens }), setMissing: () => { missing = true; }, setCorrupt: () => { corrupt = true; }, revoke: () => { allowed = false; } };
}
test('reopens actual private bytes and verifies custody without PUT, deletion, model call or stage completion', async () => {
  const f = await fixture(); const result = await f.reconciler.reconcileArtifactWrites(f.context);
  assert.equal(result.status, 'verified'); assert.deepEqual(result.evidence_refs, ['reopened:' + sha + ':' + data.length]); assert.deepEqual(f.count(), { put: 0, removed: 0, opens: 1 });
  const run = await f.store.read('alice', state => state.tasks[0].runs![0]); assert.equal(run.status, 'unknown'); assert.equal(run.artifact_intents![0].status, 'verified');
});
test('missing or corrupt object stays unknown and does not establish no-side-effect', async () => {
  for (const failure of ['missing','corrupt']) { const f = await fixture(); if (failure === 'missing') f.setMissing(); else f.setCorrupt();
    const result = await f.reconciler.reconcileArtifactWrites(f.context); assert.equal(result.status, 'unknown'); assert.deepEqual(result.evidence_refs, []);
    assert.equal((await f.store.read('alice', state => state.tasks[0].runs![0])).artifact_intents![0].status, 'unknown'); assert.equal(f.count().put, 0);
  }
});
test('current recovery fence, original operation, owner and current membership are required', async () => {
  for (const mutation of ['fence','operation','owner','lease','member','abort']) {
    const f = await fixture();
    if (mutation === 'fence') (f.context as any).request_fence = 3;
    if (mutation === 'operation') (f.context.original.run as any).operation_id = 'different';
    if (mutation === 'owner') (f.context.original as any).owner_id = 'bob';
    if (mutation === 'lease') await f.store.transaction('alice', s => { s.tasks[0].runs![0].recovery_requests![0].lease_expires_at = new Date(now - 1).toISOString(); });
    if (mutation === 'member') f.revoke(); if (mutation === 'abort') f.controller.abort();
    assert.notEqual((await f.reconciler.reconcileArtifactWrites(f.context)).status, 'verified'); assert.equal(f.count().opens, 0);
  }
});
test('changed identity or revocation during reopen cannot mark the journal verified', async () => {
  const f = await fixture(), originalOpen = f.objects.open;
  f.objects.open = async identity => { const opened = await originalOpen(identity); f.revoke(); return opened; };
  assert.equal((await f.reconciler.reconcileArtifactWrites(f.context)).status, 'blocked');
  assert.equal((await f.store.read('alice', s => s.tasks[0].runs![0])).artifact_intents![0].status, 'unknown');
});
test('recovery checks all immutable identity fields and never accepts another task object', async () => {
  const f = await fixture(); await f.store.transaction('alice', state => { state.tasks[0].runs![0].artifact_intents![0].task_id = 'other-task'; });
  assert.equal((await f.reconciler.reconcileArtifactWrites(f.context)).status, 'unknown'); assert.equal(f.count().opens, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { createWorkspaceRouter } from '../uid-workspace-api.ts';
import { WorkspaceArtifactService, workspaceObjectKey, type WorkspacePrivateObjectStore } from '../uid-workspace-artifacts.ts';
import { createWorkspaceRunArtifactWriter } from '../uid-workspace-runtime.ts';
import type { WorkspaceStageContext } from '../uid-workspace-runner.ts';
import { MemoryWorkspaceStore, type WorkspaceRecord } from '../uid-workspace-store.ts';
import { createWorkspaceTask } from '../uid-workspace-task.ts';

test('adversarial: upload status GET is read-only even with a same-site foreign-origin cookie request', async () => {
  const store = new MemoryWorkspaceStore();
  const record: WorkspaceRecord = {
    owner_id: 'alice', task: createWorkspaceTask('task-1', { snapshot_id: 'snapshot-1', content_revision: 'content-1', canonical_version: 'canonical-1', content_digest: 'digest-1', assets: [] }),
    brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://example.com/product' },
    created_at: '', updated_at: '', actions: [], events: [], artifacts: [], review_manifest: null, preview: null, content: null, quality: [],
  };
  await store.transaction('alice', state => state.tasks.push(record));
  let deletes = 0;
  const objects: WorkspacePrivateObjectStore = {
    kind: 'private-test', productionReady: false, loopbackOnly: false,
    async put() { throw new Error('not needed'); }, async open() { return null; },
    async remove() { deletes++; },
  };
  const service = new WorkspaceArtifactService(store, objects);
  const upload = await service.reserveUpload('alice', 'task-1', {
    idempotency_key: 'upload-adversarial-1', expected_state_version: 0, content_revision: 'content-1',
    filename: 'reference.png', media_type: 'image/png', size_bytes: 1, sha256: 'a'.repeat(64), role: 'product',
  });
  await store.transaction('alice', state => { state.tasks[0].reference_uploads![0].status = 'orphaned'; });
  const app = express();
  app.use('/api/workspace', createWorkspaceRouter({ store, artifactService: service, environment: 'test', publicOrigin: 'https://workspace.example.com',
    verifyToken: async token => token === 'alice.test.sig' ? { id: 'alice' } : null,
    verifyMembership: async () => ({ active: true, role: 'contributor' }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workspace/tasks/task-1/uploads/${upload.upload.upload_id}`, {
      headers: { Cookie: 'uid_workspace_session=alice.test.sig', Origin: 'https://untrusted.example.com', 'Sec-Fetch-Site': 'same-site' },
    });
    await response.arrayBuffer();
    assert.equal(deletes, 0, `GET unexpectedly deleted an object (HTTP ${response.status}); Strict cookies do not protect same-site cross-origin requests`);
    assert.equal((await service.getUpload('alice', 'task-1', upload.upload.upload_id)).upload.status, 'orphaned');
    const reconcile = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workspace/tasks/task-1/uploads/${upload.upload.upload_id}/reconcile`;
    const rejectedHeaders: Record<string, string>[] = [
      { Cookie: 'uid_workspace_session=alice.test.sig', Origin: 'https://untrusted.example.com', 'Sec-Fetch-Site': 'same-site' },
      { Cookie: 'uid_workspace_session=alice.test.sig' },
      { Authorization: 'Bearer alice.test.sig', Origin: 'https://untrusted.example.com' },
    ];
    for (const headers of rejectedHeaders) {
      const denied = await fetch(reconcile, { method: 'POST', headers });
      await denied.arrayBuffer();
      assert.equal(denied.status, 403);
      assert.equal(deletes, 0);
    }
    const allowed = await fetch(reconcile, { method: 'POST', headers: {
      Cookie: 'uid_workspace_session=alice.test.sig', Origin: 'https://workspace.example.com', 'Sec-Fetch-Site': 'same-origin',
    } });
    const linked = await allowed.json();
    assert.equal(allowed.status, 200);
    assert.equal(linked.upload.status, 'cleaned');
    assert.equal(deletes, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

for (const lateChange of ['cancel', 'expire', 'abort', 'revoke'] as const) test(`adversarial: ${lateChange} during artifact staging fences the later private PUT`, async () => {
  const store = new MemoryWorkspaceStore();
  const now = Date.parse('2026-11-06T12:00:00Z');
  let currentNow = now, memberAllowed = true;
  const timestamp = new Date(now).toISOString();
  const action: WorkspaceRecord['actions'][number] = { action_id: 'action-1', idempotency_key: 'action-key-1', fingerprint: 'fingerprint', type: 'start', status: 'running', expected_state_version: 0, content_revision: 'content-1', created_at: timestamp, actor_id: 'alice', payload: {} };
  const run: NonNullable<WorkspaceRecord['runs']>[number] = { run_id: 'run-1', action_id: action.action_id, operation_id: 'operation-1', stage: 'draft', expected_state_version: 0, snapshot_id: 'snapshot-1', content_revision: 'content-1', fence: 1, status: 'in_flight', lease_owner: 'worker-1', lease_expires_at: new Date(now + 60_000).toISOString(), created_at: timestamp, updated_at: timestamp };
  const record: WorkspaceRecord = { owner_id: 'alice', task: createWorkspaceTask('task-1', { snapshot_id: 'snapshot-1', content_revision: 'content-1', canonical_version: 'canonical-1', content_digest: 'digest-1', assets: [] }), brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://example.com/product' }, created_at: timestamp, updated_at: timestamp, actions: [action], runs: [run], events: [], artifacts: [], review_manifest: null, preview: null, content: null, quality: [] };
  await store.transaction('alice', state => state.tasks.push(record));
  const controller = new AbortController();
  const context: WorkspaceStageContext = { owner_id: 'alice', record: structuredClone(record), action: structuredClone(action), run: structuredClone(run), signal: controller.signal };
  const content = Buffer.from('private output bytes');
  const sha256 = createHash('sha256').update(content).digest('hex');
  const identity = { owner_id: 'alice', task_id: 'task-1', storage_key: workspaceObjectKey('alice', 'task-1', sha256), sha256, size_bytes: content.length, media_type: 'text/plain' };
  let puts = 0;
  let saved: Buffer | undefined;
  const objects: WorkspacePrivateObjectStore = { kind: 'fake-private', productionReady: false, loopbackOnly: false,
    async put(_identity, bytes) { puts++; const parts: Uint8Array[] = []; for await (const chunk of bytes) parts.push(chunk); saved = Buffer.concat(parts); },
    async open() { return saved ? { stream: (async function* () { yield saved!; })(), async dispose() {} } : null; }, async remove() {},
  };
  let started!: () => void, release!: () => void;
  const staging = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bytes = { async *[Symbol.asyncIterator]() { started(); await gate; yield content; } };
  const pending = createWorkspaceRunArtifactWriter(store, objects, async () => memberAllowed, () => currentNow)(context, identity, bytes);
  const settled = pending.then(() => null, error => error);
  await staging;
  if (lateChange === 'cancel') await store.transaction('alice', state => { state.tasks[0].task = { ...state.tasks[0].task, stage: 'cancelled', state_version: 1 }; });
  if (lateChange === 'expire') currentNow += 60_001;
  if (lateChange === 'abort') controller.abort();
  if (lateChange === 'revoke') memberAllowed = false;
  release();
  assert.ok(await settled, 'the fenced write should be rejected');
  assert.equal(puts, 0, `the old worker issued a private object PUT after ${lateChange} during its staging await`);
});

import { createHash } from 'node:crypto';
import { stableJson } from './supabase/functions/_shared/creative-quality.ts';
import { workspaceObjectKey, type WorkspacePrivateObjectStore } from './uid-workspace-artifacts.ts';
import type { WorkspaceStore, WorkspaceOwnerState } from './uid-workspace-store.ts';
import type { WorkspaceRecoveryContext } from './uid-workspace-recovery.ts';
/** Reopen-only reconciliation of previously journaled immutable writes. Never PUT,
 * delete, regenerate, release model budget or claim stage/EO completion. Missing
 * bytes remain unknown: an earlier in-flight storage request may still arrive. */
export function createWorkspaceArtifactReconciler(options: { store: WorkspaceStore; objects: WorkspacePrivateObjectStore; authorizeOwner(owner: string): Promise<boolean>; now?: () => number; timeoutMs?: number }) {
  const now = options.now ?? Date.now, timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300_000) throw new Error('INVALID_ARTIFACT_RECOVERY_TIMEOUT');
  async function reconcileArtifactWrites(context: WorkspaceRecoveryContext): Promise<{ status: 'verified' | 'unknown' | 'blocked'; code: string; evidence_refs: string[] }> {
    const owner = context.original.owner_id, task = context.original.record.task.task_id;
    const expected = { run: context.original.run.run_id, operation: context.original.run.operation_id, input: context.input_identity,
      request: context.request_id, fence: context.request_fence, ownerMatches: owner === context.original.record.owner_id };
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(timeout)]);
    const unknown = (code: string) => ({ status: 'unknown' as const, code, evidence_refs: [] });
    const current = (state: Readonly<WorkspaceOwnerState>) => {
      const record = state.tasks.find(value => value.owner_id === owner && value.task.task_id === task), run = record?.runs?.find(value => value.run_id === expected.run);
      const request = run?.recovery_requests?.find(value => value.request_id === expected.request);
      if (signal.aborted || !expected.ownerMatches || !record || !run || !['unknown','blocked','failed_before_submit'].includes(run.status)
        || run.operation_id !== expected.operation || run.input_identity !== expected.input || record.task.interruption?.operation_id !== run.operation_id
        || !request || request.status !== 'checking' || request.fence !== expected.fence || Date.parse(request.lease_expires_at) <= now()) throw new Error('ARTIFACT_RECOVERY_FENCED');
      return { record, run };
    };
    async function bounded<T>(work: Promise<T>): Promise<T> {
      let cancel!: () => void;
      try { return await Promise.race([work, new Promise<never>((_, reject) => { cancel = () => reject(new Error('ARTIFACT_RECOVERY_TIMEOUT')); signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel(); })]); }
      finally { signal.removeEventListener('abort', cancel); }
    }
    try {
      if (!await bounded(options.authorizeOwner(owner))) return { status: 'blocked', code: 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED', evidence_refs: [] };
      const intents = await options.store.read(owner, state => structuredClone(current(state).run.artifact_intents ?? []));
      if (intents.length > 256 || intents.reduce((total, item) => total + item.size_bytes, 0) > 512 * 1024 * 1024) return unknown('ARTIFACT_RECOVERY_LIMIT');
      const evidence: string[] = [];
      for (const intent of intents) {
        if (intent.owner_id !== owner || intent.task_id !== task || intent.storage_key !== workspaceObjectKey(owner, task, intent.sha256)
          || !/^[a-f0-9]{64}$/.test(intent.sha256) || !Number.isSafeInteger(intent.size_bytes) || intent.size_bytes < 1 || intent.size_bytes > 256 * 1024 * 1024) return unknown('ARTIFACT_RECOVERY_SCOPE_INVALID');
        const { status: _, created_at: __, updated_at: ___, ...identity } = intent;
        const pending = options.objects.open(identity); let opened: Awaited<typeof pending>;
        try { opened = await bounded(pending); } catch (error) { void pending.then(value => value?.dispose()).catch(() => undefined); throw error; }
        if (!opened) return unknown('ARTIFACT_RECOVERY_BYTES_UNAVAILABLE');
        const checksum = createHash('sha256'); let size = 0;
        const iterator = opened.stream[Symbol.asyncIterator]();
        try {
          while (true) {
            const part = await bounded(iterator.next()); if (part.done) break;
            if (!(part.value instanceof Uint8Array) || (size += part.value.length) > intent.size_bytes) throw new Error('ARTIFACT_RECOVERY_INTEGRITY');
            checksum.update(part.value);
          }
        } finally { void iterator.return?.().catch(() => undefined); await bounded(opened.dispose()); }
        if (size !== intent.size_bytes || checksum.digest('hex') !== intent.sha256) return unknown('ARTIFACT_RECOVERY_INTEGRITY');
        evidence.push('reopened:' + intent.sha256 + ':' + intent.size_bytes);
      }
      if (!await bounded(options.authorizeOwner(owner))) return { status: 'blocked', code: 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED', evidence_refs: [] };
      await options.store.transaction(owner, state => {
        const { record, run } = current(state);
        if (stableJson(run.artifact_intents ?? []) !== stableJson(intents)) throw new Error('ARTIFACT_RECOVERY_INTENTS_CHANGED');
        for (const intent of run.artifact_intents ?? []) { intent.status = 'verified'; intent.updated_at = new Date(now()).toISOString(); }
        if (intents.length) { record.updated_at = new Date(now()).toISOString(); record.events.push({ sequence: (record.events.at(-1)?.sequence ?? 0) + 1, type: 'artifact_writes_reconciled', created_at: record.updated_at, data: { run_id: run.run_id, objects: intents.length } }); }
      });
      return { status: 'verified', code: 'ARTIFACT_WRITES_REOPENED_NOT_STAGE_APPROVAL', evidence_refs: evidence };
    } catch { return unknown('ARTIFACT_RECOVERY_REQUIRES_RECONCILIATION'); }
  }
  return { reconcileArtifactWrites };
}

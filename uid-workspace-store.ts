import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Task, Receipt } from './uid-workspace-task.ts';
import type { WorkspaceRunRecord } from './uid-workspace-runner.ts';
import type { WorkspaceRevisionPlan, WorkspaceRevisionHistory } from './uid-workspace-revision.ts';
import type { WorkspaceUploadIntent, WorkspaceReference } from './uid-workspace-artifacts.ts';
import type { WorkspaceReviewManifest } from './uid-workspace-review.ts';

/** Workspace records are server-owned. No API accepts these records from a client.
 * A production adapter must atomically commit the entire owner transaction (CAS,
 * action deduplication, event append and job intent), with equivalent isolation.
 * This does not activate or alter the existing disabled Supabase checkpoint store.
 */
export type WorkspaceBrief = { brand: string; material: 'onepage'; source_url: string; title?: string; requirements?: string };
export type WorkspaceActionRecord = {
  action_id: string; idempotency_key: string; fingerprint: string; type: 'start' | 'approve_content' | 'approve_artwork' | 'feedback' | 'content_feedback' | 'cancel';
  status: 'queued' | 'running' | 'succeeded' | 'blocked' | 'failed_before_submit' | 'unknown' | 'cancelled';
  expected_state_version: number; content_revision: string; created_at: string;
  actor_id: string; payload: unknown;
};
export type WorkspaceEvent = { sequence: number; type: string; created_at: string; data: Record<string, unknown> };
export type WorkspaceArtifact = {
  artifact_id: string; revision_id: string; filename: string; media_type: string; size_bytes: number;
  sha256: string; content_revision: string; kind: 'image' | 'preview' | 'package' | 'document';
  verification: 'pending' | 'verified' | 'failed'; storage_key: string; width?: number; height?: number;
};
export type WorkspaceRecord = {
  owner_id: string; task: Task; brief: WorkspaceBrief; created_at: string; updated_at: string;
  runs?: WorkspaceRunRecord[]; receipts?: Receipt[];
  reference_uploads?: WorkspaceUploadIntent[]; references?: WorkspaceReference[];
  revision_plan?: WorkspaceRevisionPlan; revision_history?: WorkspaceRevisionHistory[];
  actions: WorkspaceActionRecord[]; events: WorkspaceEvent[]; artifacts: WorkspaceArtifact[];
  review_manifest: WorkspaceReviewManifest | null;
  /** Development/test preview cache only. Production uses the private render adapter. */
  preview: null | { html: string; manifest: WorkspaceReviewManifest; channel_nonce: string;
    canonical: { html: string; css: string }; status: 'PREVIEW_REQUIRES_VISUAL_QA' };
  content: null | { revision: string; slots: Record<string, string> };
  quality: Array<{ name: string; status: 'pending' | 'passed' | 'failed' | 'blocked'; detail: string }>;
};
export type WorkspaceOwnerState = {
  owner_id: string;
  tasks: WorkspaceRecord[];
  creations: Array<{ idempotency_key: string; fingerprint: string; task_id: string }>;
};
export interface WorkspaceStore {
  readonly kind: string;
  /** True only for a reviewed shared durable production implementation. */
  readonly productionReady: boolean;
  read<T>(ownerId: string, read: (state: Readonly<WorkspaceOwnerState>) => T): Promise<T>;
  /** Callback is synchronous: external operations must never occur within a commit. */
  transaction<T>(ownerId: string, mutate: (state: WorkspaceOwnerState) => T): Promise<T>;
}
export class WorkspaceStoreError extends Error {
  constructor(public readonly code: string) { super(code); }
}
const fresh = (ownerId: string): WorkspaceOwnerState => ({ owner_id: ownerId, tasks: [], creations: [] });
const clone = <T>(value: T): T => structuredClone(value);
const ownerKey = (ownerId: string) => {
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 200) throw new WorkspaceStoreError('INVALID_OWNER');
  return createHash('sha256').update(ownerId).digest('hex');
};
function assertState(state: WorkspaceOwnerState, ownerId: string) {
  if (!state || state.owner_id !== ownerId || !Array.isArray(state.tasks) || !Array.isArray(state.creations)
      || state.tasks.some(record => record.owner_id !== ownerId || !record.task?.task_id || !Array.isArray(record.events) || !Array.isArray(record.actions) || !Array.isArray(record.artifacts))) {
    throw new WorkspaceStoreError('STORE_CORRUPT');
  }
  if (new Set(state.tasks.map(record => record.task.task_id)).size !== state.tasks.length) throw new WorkspaceStoreError('STORE_CORRUPT');
}

/** Test-only: not a production persistence fallback. */
export class MemoryWorkspaceStore implements WorkspaceStore {
  readonly kind = 'memory-test';
  readonly productionReady = false;
  private readonly states = new Map<string, WorkspaceOwnerState>();
  private tail: Promise<unknown> = Promise.resolve();
  async read<T>(ownerId: string, read: (state: Readonly<WorkspaceOwnerState>) => T) {
    ownerKey(ownerId);
    await this.tail;
    return clone(read(clone(this.states.get(ownerId) ?? fresh(ownerId))));
  }
  async transaction<T>(ownerId: string, mutate: (state: WorkspaceOwnerState) => T) {
    ownerKey(ownerId);
    const operation = this.tail.then(() => {
      const next = clone(this.states.get(ownerId) ?? fresh(ownerId));
      const result = mutate(next);
      if (result instanceof Promise) throw new WorkspaceStoreError('ASYNC_TRANSACTION_FORBIDDEN');
      assertState(next, ownerId);
      this.states.set(ownerId, clone(next));
      return clone(result);
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}

/** Explicit single-host DEVELOPMENT adapter. Private directory, per-owner locking,
 * fsynced temp file + atomic rename. Independent instances serialize on mkdir.
 * Never automatically reclaim a lock after a crash: an operator must establish that
 * no writer is alive first. Never use on ephemeral Render disks or across hosts.
 * The owner file is the atomic unit: intent, CAS, idempotency and events persist
 * together. Files survive process restarts, NOT disk replacement or host failure.
 */
export class FileWorkspaceStore implements WorkspaceStore {
  readonly kind = 'filesystem-development';
  readonly productionReady = false;
  private readonly directory: string;
  constructor(directory: string, private readonly options: { environment: 'development' | 'test'; lockTimeoutMs?: number; maxBytes?: number }) {
    if (!['development', 'test'].includes(options.environment) || !path.isAbsolute(directory)) throw new WorkspaceStoreError('LOCAL_STORE_NOT_ALLOWED');
    this.directory = path.resolve(directory);
  }
  private async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new WorkspaceStoreError('STORE_DIRECTORY_NOT_PRIVATE');
  }
  private async load(ownerId: string): Promise<WorkspaceOwnerState> {
    const filename = path.join(this.directory, ownerKey(ownerId) + '.json');
    let handle;
    try {
      handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      if ((await handle.stat()).size > (this.options.maxBytes ?? 16 * 1024 * 1024)) throw new WorkspaceStoreError('STORE_LIMIT_REACHED');
      const envelope = JSON.parse(await handle.readFile('utf8'));
      if (envelope.version !== 1) throw new WorkspaceStoreError('STORE_VERSION_UNSUPPORTED');
      assertState(envelope.state, ownerId);
      return envelope.state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fresh(ownerId);
      if (error instanceof WorkspaceStoreError) throw error;
      throw new WorkspaceStoreError('STORE_CORRUPT');
    } finally { await handle?.close(); }
  }
  async read<T>(ownerId: string, read: (state: Readonly<WorkspaceOwnerState>) => T) {
    ownerKey(ownerId);
    await this.prepare();
    return clone(read(await this.load(ownerId)));
  }
  async transaction<T>(ownerId: string, mutate: (state: WorkspaceOwnerState) => T) {
    const key = ownerKey(ownerId);
    await this.prepare();
    const lock = path.join(this.directory, key + '.lock');
    const until = Date.now() + (this.options.lockTimeoutMs ?? 2000);
    while (true) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new WorkspaceStoreError('STORE_UNAVAILABLE');
        if (Date.now() >= until) throw new WorkspaceStoreError('STORE_BUSY');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const temp = path.join(this.directory, key + '.' + randomUUID() + '.tmp');
    let renamed = false;
    try {
      const state = await this.load(ownerId);
      const result = mutate(state);
      if (result instanceof Promise) throw new WorkspaceStoreError('ASYNC_TRANSACTION_FORBIDDEN');
      assertState(state, ownerId);
      const bytes = JSON.stringify({ version: 1, state });
      if (Buffer.byteLength(bytes) > (this.options.maxBytes ?? 16 * 1024 * 1024)) throw new WorkspaceStoreError('STORE_LIMIT_REACHED');
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, path.join(this.directory, key + '.json'));
      renamed = true;
      const directory = await open(this.directory, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
      return clone(result);
    } catch (error) {
      // Rename may have committed even if directory fsync failed. Caller must read
      // the idempotency key before retrying, never infer a failed-before-submit.
      if (renamed) throw new WorkspaceStoreError('STORE_OUTCOME_UNKNOWN');
      throw error;
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
      await rm(lock, { recursive: true }).catch(() => undefined);
    }
  }
}

/** Minimal injected pg-compatible surface. This module never opens a connection,
 * installs dependencies, applies SQL, configures credentials or activates Supabase.
 * Use a dedicated server role for the reviewed table, not a browser/service key.
 */
export interface WorkspaceSqlConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
  release(): void;
}
export interface WorkspaceSqlPool { connect(): Promise<WorkspaceSqlConnection> }
export class PostgresWorkspaceStore implements WorkspaceStore {
  readonly kind = 'postgres-owner-state-v1';
  readonly productionReady = true;
  private readonly table: string;
  constructor(private readonly pool: WorkspaceSqlPool, config: {
    /** Must be approved and applied outside this adapter before injection. */
    schemaReviewed: true; schemaVersion: 'uid-workspace-owner-state-v1';
    qualifiedTable: string; maxBytes?: number;
  }) {
    if (config.schemaReviewed !== true || config.schemaVersion !== 'uid-workspace-owner-state-v1'
      || !/^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$/.test(config.qualifiedTable)) throw new WorkspaceStoreError('POSTGRES_SCHEMA_NOT_APPROVED');
    this.table = config.qualifiedTable.split('.').map(part => '"' + part + '"').join('.');
    this.maxBytes = config.maxBytes ?? 16 * 1024 * 1024;
  }
  private readonly maxBytes: number;
  private async perform<T>(ownerId: string, write: boolean, callback: (state: WorkspaceOwnerState) => T): Promise<T> {
    ownerKey(ownerId);
    const connection = await this.pool.connect();
    let commitSubmitted = false;
    try {
      await connection.query('BEGIN');
      await connection.query("SELECT set_config('uid.workspace_owner_id', $1, true)", [ownerId]);
      // Prevent unbounded waits and preserve a distinct transaction per owner.
      await connection.query("SET LOCAL lock_timeout = '5s'");
      await connection.query("SET LOCAL statement_timeout = '15s'");
      if (write) await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [ownerId]);
      const result = await connection.query(`SELECT state, revision FROM ${this.table} WHERE owner_id = $1${write ? ' FOR UPDATE' : ''}`, [ownerId]);
      if (result.rows.length > 1) throw new WorkspaceStoreError('STORE_CORRUPT');
      const row = result.rows[0];
      const state = row ? (typeof row.state === 'string' ? JSON.parse(row.state) : clone(row.state)) as WorkspaceOwnerState : fresh(ownerId);
      assertState(state, ownerId);
      const output = callback(state);
      if (output instanceof Promise) throw new WorkspaceStoreError('ASYNC_TRANSACTION_FORBIDDEN');
      if (write) {
        assertState(state, ownerId);
        const json = JSON.stringify(state);
        if (Buffer.byteLength(json) > this.maxBytes) throw new WorkspaceStoreError('STORE_LIMIT_REACHED');
        const changed = row
          ? await connection.query(`UPDATE ${this.table} SET state = $2::jsonb, revision = revision + 1, updated_at = now() WHERE owner_id = $1 AND revision = $3 RETURNING revision`, [ownerId, json, row.revision])
          : await connection.query(`INSERT INTO ${this.table} (owner_id, state, revision) VALUES ($1, $2::jsonb, 1) RETURNING revision`, [ownerId, json]);
        if (changed.rows.length !== 1) throw new WorkspaceStoreError('STORE_CONFLICT');
      }
      commitSubmitted = true;
      await connection.query('COMMIT');
      return clone(output);
    } catch (error) {
      // An interrupted COMMIT is ambiguous even if rollback subsequently responds.
      // Caller reads the durable action/key before any next attempt.
      await connection.query('ROLLBACK').catch(() => undefined);
      if (commitSubmitted && write) throw new WorkspaceStoreError('STORE_OUTCOME_UNKNOWN');
      throw error;
    } finally { connection.release(); }
  }
  read<T>(ownerId: string, read: (state: Readonly<WorkspaceOwnerState>) => T) { return this.perform(ownerId, false, read); }
  transaction<T>(ownerId: string, mutate: (state: WorkspaceOwnerState) => T) { return this.perform(ownerId, true, mutate); }
}

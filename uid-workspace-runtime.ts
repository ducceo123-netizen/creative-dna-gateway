import { WorkspaceArtifactService, WorkspacePrivateSpool, workspaceObjectKey, writeVerifiedWorkspaceObject, type WorkspacePrivateObjectStore, type WorkspaceObjectIdentity } from './uid-workspace-artifacts.ts';
import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';
import { createWorkspaceRouter, createSupabaseWorkspaceLogin, createSupabaseWorkspaceMembershipVerifier, createSupabaseWorkspaceVerifier, type WorkspaceApiOptions, type ExecutionReadiness, type WorkspaceLoginAttempt, type WorkspaceLoginLimiter, type WorkspaceLoginProtection } from './uid-workspace-api.ts';
import { PostgresWorkspaceStore, type WorkspaceSqlPool, type WorkspaceArtifact, type WorkspaceRecord, type WorkspaceStore } from './uid-workspace-store.ts';
import { PostgresWorkspaceBudget, type WorkspaceBudgetConfig, type WorkspaceTaskAdmission, type WorkspaceAdmissionScope } from './uid-workspace-budget.ts';
import { createWorkspaceRunner, type TrustedWorkspaceStageAdapter, type WorkspaceRunnerOptions, type WorkspaceRunnerStage, type WorkspaceRunnerResult, type WorkspaceStageContext } from './uid-workspace-runner.ts';
import { createWorkspaceOpenAITransport, WORKSPACE_OPENAI_MODEL, type WorkspaceOpenAIOptions, type WorkspaceOpenAIRequest, type WorkspaceOpenAIResult } from './uid-workspace-openai.ts';
import { createWorkspaceOperationJournal, workspaceChildBinding } from './uid-workspace-operations.ts';
import { PostgresWorkspaceProviderBudget, type WorkspaceProviderBudgetConfig } from './uid-workspace-provider-budget.ts';
import { createWorkspaceArtifactReconciler } from './uid-workspace-artifact-recovery.ts';

/** Composition only: importing or constructing with no config opens no socket,
 * reads no environment/credential, runs no migration and starts no paid worker. */
function fail(code: string): never { throw new Error(code); }
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(value);
function qualified(value: string) { if (!/^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$/.test(value)) fail('RUNTIME_SQL_IDENTIFIER_INVALID'); return value.split('.').map(part => '"' + part + '"').join('.'); }
const integer = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;

type LoginReservation = { attempt_id: string; client_key: string; account_key: string; started_at: number; expires_at: number; outcome: 'pending' | 'success' | 'rejected' | 'unavailable'; finished_at?: number };
type LoginState = { version: 1; namespace: string; reservations: LoginReservation[] };
export type WorkspaceLoginLimiterConfig = {
  schemaReviewed: true; schemaVersion: 'uid-workspace-login-v1'; qualifiedTable: string; namespace: string;
  clientLimit?: number; accountLimit?: number; windowMs?: number; reservationMs?: number; maxRecords?: number; now?: () => number;
};
/** A shared journal makes BOTH dimensions atomic across replicas. Success only
 * releases this attempt. Crash/timeout reservations become failures until the
 * failure window expires. Expiry never creates an unbounded permanent lockout. */
export class PostgresWorkspaceLoginLimiter implements WorkspaceLoginLimiter {
  readonly durable = true;
  private readonly table: string; private readonly config: Required<Omit<WorkspaceLoginLimiterConfig, 'now'>> & { now: () => number };
  constructor(private readonly pool: WorkspaceSqlPool, config: WorkspaceLoginLimiterConfig) {
    if (config.schemaReviewed !== true || config.schemaVersion !== 'uid-workspace-login-v1' || !validId(config.namespace)) fail('LOGIN_SCHEMA_NOT_REVIEWED');
    this.table = qualified(config.qualifiedTable);
    this.config = { clientLimit: 30, accountLimit: 10, windowMs: 600_000, reservationMs: 60_000, maxRecords: 100_000, ...config, now: config.now ?? Date.now };
    const c = this.config;
    if (!integer(c.clientLimit, 1, 100_000) || !integer(c.accountLimit, 1, 100_000) || !integer(c.windowMs, 1000, 86_400_000) || !integer(c.reservationMs, 1000, c.windowMs) || !integer(c.maxRecords, Math.max(c.clientLimit, c.accountLimit), 100_000)) fail('INVALID_LOGIN_LIMITS');
  }
  private async transaction<T>(mutate: (state: LoginState, now: number) => T): Promise<T> {
    const connection = await this.pool.connect(); let committing = false;
    try {
      await connection.query('BEGIN'); await connection.query("SET LOCAL lock_timeout = '5s'"); await connection.query("SET LOCAL statement_timeout = '15s'");
      await connection.query("SELECT set_config('uid.workspace_login_namespace', $1, true)", [this.config.namespace]);
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['uid-workspace-login:' + this.config.namespace]);
      const result = await connection.query(`SELECT state, revision FROM ${this.table} WHERE namespace = $1 FOR UPDATE`, [this.config.namespace]);
      if (result.rows.length > 1) fail('LOGIN_JOURNAL_CORRUPT');
      const row = result.rows[0]; const state: LoginState = row ? (typeof row.state === 'string' ? JSON.parse(row.state) : structuredClone(row.state)) : { version: 1, namespace: this.config.namespace, reservations: [] };
      if (state.version !== 1 || state.namespace !== this.config.namespace || !Array.isArray(state.reservations) || state.reservations.length > this.config.maxRecords || new Set(state.reservations.map(r => r.attempt_id)).size !== state.reservations.length
        || state.reservations.some(r => !validId(r.attempt_id) || !/^[a-f0-9]{64}$/.test(r.account_key) || !/^[a-f0-9]{64}$/.test(r.client_key) || !Number.isSafeInteger(r.started_at) || !Number.isSafeInteger(r.expires_at) || !['pending', 'success', 'rejected', 'unavailable'].includes(r.outcome) || (r.outcome !== 'pending' && !Number.isSafeInteger(r.finished_at)))) fail('LOGIN_JOURNAL_CORRUPT');
      const now = this.config.now();
      state.reservations = state.reservations.filter(r => (r.finished_at ?? r.expires_at) + this.config.windowMs > now);
      const output = mutate(state, now);
      const changed = row
        ? await connection.query(`UPDATE ${this.table} SET state = $2::jsonb, revision = revision + 1, updated_at = now() WHERE namespace = $1 AND revision = $3 RETURNING revision`, [this.config.namespace, JSON.stringify(state), row.revision])
        : await connection.query(`INSERT INTO ${this.table} (namespace, state, revision) VALUES ($1, $2::jsonb, 1) RETURNING revision`, [this.config.namespace, JSON.stringify(state)]);
      if (changed.rows.length !== 1) fail('LOGIN_JOURNAL_CONFLICT');
      committing = true; await connection.query('COMMIT'); return structuredClone(output);
    } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); if (committing) fail('LOGIN_LIMITER_OUTCOME_UNKNOWN'); throw error; }
    finally { connection.release(); }
  }
  async begin(input: WorkspaceLoginAttempt): ReturnType<WorkspaceLoginLimiter['begin']> {
    const attempt = structuredClone(input);
    if (!validId(attempt.attempt_id) || !/^[a-f0-9]{64}$/.test(attempt.client_key) || !/^[a-f0-9]{64}$/.test(attempt.account_key)) fail('INVALID_LOGIN_ATTEMPT');
    return this.transaction((state, now) => {
      const counts = state.reservations.filter(r => r.outcome !== 'success' && (r.finished_at ?? r.expires_at) + this.config.windowMs > now);
      if (state.reservations.some(r => r.attempt_id === attempt.attempt_id) || state.reservations.length >= this.config.maxRecords
        || counts.filter(r => r.client_key === attempt.client_key).length >= this.config.clientLimit || counts.filter(r => r.account_key === attempt.account_key).length >= this.config.accountLimit) return { allowed: false, retry_after_seconds: Math.ceil((this.config.windowMs + this.config.reservationMs) / 1000) };
      state.reservations.push({ ...attempt, started_at: now, expires_at: now + this.config.reservationMs, outcome: 'pending' });
      return { allowed: true, reservation_id: attempt.attempt_id };
    });
  }
  async finish(reservationId: string, outcome: 'success' | 'rejected' | 'unavailable'): Promise<void> {
    if (!validId(reservationId) || !['success', 'rejected', 'unavailable'].includes(outcome)) fail('INVALID_LOGIN_OUTCOME');
    const late = await this.transaction((state, now) => {
      const reservation = state.reservations.find(r => r.attempt_id === reservationId);
      if (!reservation) fail('LOGIN_RESERVATION_EXPIRED');
      if (reservation.outcome !== 'pending') { if (reservation.outcome !== outcome) fail('LOGIN_OUTCOME_CONFLICT'); return false; }
      if (reservation.expires_at <= now) {
        // A late successful upstream call cannot bypass the expired reservation.
        reservation.outcome = 'unavailable'; reservation.finished_at = reservation.expires_at;
        // Commit expiry normally, then reject the late response after commit.
        return true;
      }
      reservation.outcome = outcome; reservation.finished_at = now; return false;
    });
    if (late) fail('LOGIN_RESERVATION_EXPIRED');
  }
}

function normalizedIp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || value.includes('%')) return null;
  let address = value.toLowerCase(); if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) address = address.slice(7);
  if (isIP(address) === 4) return address;
  if (isIP(address) === 6) { try { return new URL('http://[' + address + ']/').hostname.slice(1, -1); } catch { return null; } }
  return null;
}
export type WorkspaceIngressConfig = {
  reviewedIngress: true; review_ref: string; pseudonymKey: Uint8Array;
} & ({ mode: 'direct_socket'; directOriginReviewed: true } | {
  mode: 'sanitized_single_header'; trustedPeerAddresses: readonly string[]; header: string;
  /** Exact deployment contract, not inferred from Render/Express defaults. */
  ingressOverwritesHeader: true; originRejectsUntrustedPeers: true;
});
export function createWorkspaceClientResolver(config: WorkspaceIngressConfig): WorkspaceLoginProtection['resolveClientKey'] {
  if (config.reviewedIngress !== true || !validId(config.review_ref) || !(config.pseudonymKey instanceof Uint8Array) || config.pseudonymKey.byteLength < 32 || config.pseudonymKey.byteLength > 128) fail('INGRESS_NOT_REVIEWED');
  const key = Buffer.from(config.pseudonymKey);
  let peers: Set<string> | undefined; let header: string | undefined;
  if (config.mode === 'direct_socket') { if (config.directOriginReviewed !== true) fail('INGRESS_NOT_REVIEWED'); }
  else if (config.mode === 'sanitized_single_header') {
    if (config.ingressOverwritesHeader !== true || config.originRejectsUntrustedPeers !== true || !/^x-[a-z0-9-]{1,60}$/.test(config.header) || !config.trustedPeerAddresses?.length || config.trustedPeerAddresses.length > 100) fail('INGRESS_NOT_REVIEWED');
    peers = new Set(config.trustedPeerAddresses.map(value => normalizedIp(value) ?? fail('INVALID_INGRESS_PEER'))); header = config.header;
  } else fail('INGRESS_NOT_REVIEWED');
  return request => {
    const socket = normalizedIp(request.socket.remoteAddress); if (!socket) return null;
    let client = socket;
    if (peers) {
      if (!peers.has(socket)) return null;
      // Reject duplicate/collapsed headers and address chains; the reviewed
      // ingress must provide exactly one sanitized address, not a trusted count.
      const occurrences = request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === header).length;
      if (occurrences !== 1) return null;
      const address = normalizedIp(request.headers[header!]); if (!address) return null; client = address;
    }
    return createHmac('sha256', key).update('uid-workspace-client-v1:' + client).digest('hex');
  };
}

export type WorkspaceWorkerDirectoryConfig = { schemaReviewed: true; schemaVersion: 'uid-workspace-worker-directory-v1'; discoverFunction: string; authorizeFunction: string };
/** Only two narrow reviewed database RPCs. This class has no generic owner-table
 * scan and needs no service role/BYPASSRLS or saved user access/refresh token. The
 * function privilege and body review are deployment prerequisites. */
export class PostgresWorkspaceWorkerDirectory {
  readonly durable = true;
  private readonly discoverFunction: string; private readonly authorizeFunction: string;
  constructor(private readonly pool: WorkspaceSqlPool, config: WorkspaceWorkerDirectoryConfig) {
    if (config.schemaReviewed !== true || config.schemaVersion !== 'uid-workspace-worker-directory-v1') fail('WORKER_DIRECTORY_NOT_REVIEWED');
    this.discoverFunction = qualified(config.discoverFunction); this.authorizeFunction = qualified(config.authorizeFunction);
  }
  private async query(sql: string, values: unknown[]) {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN READ ONLY'); await connection.query("SET LOCAL statement_timeout = '8s'"); await connection.query("SET LOCAL lock_timeout = '3s'");
      const result = await connection.query(sql, values); await connection.query('COMMIT'); return result;
    } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { connection.release(); }
  }
  async discover(afterOwner: string | null, limit = 25): Promise<string[]> {
    if (afterOwner !== null && !validId(afterOwner) || !integer(limit, 1, 100)) fail('INVALID_WORKER_CURSOR');
    {
      const result = await this.query(`SELECT owner_id FROM ${this.discoverFunction}($1::text, $2::integer)`, [afterOwner, limit]);
      const ids = result.rows.map(row => row.owner_id);
      if (ids.length > limit || ids.some(value => !validId(value))) fail('WORKER_DIRECTORY_INVALID');
      const owners = ids as string[];
      if (owners.some((value, index) => afterOwner !== null && value <= afterOwner || index > 0 && value <= owners[index - 1])) fail('WORKER_DIRECTORY_INVALID');
      return owners;
    }
  }
  async authorizeOwner(ownerId: string): Promise<boolean> {
    if (!validId(ownerId)) return false;
    const result = await this.query(`SELECT allowed FROM ${this.authorizeFunction}($1::text)`, [ownerId]); return result.rows.length === 1 && result.rows[0].allowed === true;
  }
}

/** Worker byte helpers use the SAME reviewed custody protocol and key namespace
 * as the streaming API. Buffer helper limit is 32MiB; API spools up to 256MiB. */
export function createWorkspaceArtifactAccess(objects: WorkspacePrivateObjectStore) {
  const media = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/zip', 'text/html', 'text/plain', 'application/json']);
  async function load(object: WorkspaceObjectIdentity) {
    const opened = await objects.open(object); if (!opened) fail('ARTIFACT_UNAVAILABLE');
    const chunks: Uint8Array[] = []; let count = 0;
    try {
      for await (const chunk of opened.stream) {
        if (!(chunk instanceof Uint8Array)) fail('ARTIFACT_INTEGRITY_FAILED');
        count += chunk.length; if (count > object.size_bytes) fail('ARTIFACT_INTEGRITY_FAILED'); chunks.push(new Uint8Array(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.byteLength !== object.size_bytes || sha(bytes) !== object.sha256) fail('ARTIFACT_INTEGRITY_FAILED');
      return new Uint8Array(bytes);
    } finally { await opened.dispose(); }
  }
  async function readArtifact(record: WorkspaceRecord, artifact: WorkspaceArtifact) {
    if (!validId(record.owner_id) || !validId(record.task.task_id) || !record.artifacts.some(value => value.artifact_id === artifact.artifact_id && value.revision_id === artifact.revision_id && value.sha256 === artifact.sha256 && value.storage_key === artifact.storage_key)
      || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !artifact.storage_key.startsWith(sha(record.owner_id) + '/' + sha(record.task.task_id) + '/')
      || !media.has(artifact.media_type) || !integer(artifact.size_bytes, 1, 32 * 1024 * 1024)) fail('ARTIFACT_SCOPE_INVALID');
    return load({ owner_id: record.owner_id, task_id: record.task.task_id, ...artifact });
  }
  async function putArtifact(ownerId: string, taskId: string, bytes: Uint8Array, mediaType: string) {
    if (!validId(ownerId) || !validId(taskId) || !(bytes instanceof Uint8Array) || !integer(bytes.byteLength, 1, 32 * 1024 * 1024) || !media.has(mediaType)) fail('ARTIFACT_INPUT_INVALID');
    const retained = new Uint8Array(bytes); const digest = sha(retained);
    async function* stream() { yield retained; }
    const { storage_key, sha256, size_bytes } = await putArtifactStream({ owner_id: ownerId, task_id: taskId, storage_key: workspaceObjectKey(ownerId, taskId, digest), sha256: digest, size_bytes: retained.byteLength, media_type: mediaType }, stream());
    return { storage_key, sha256, size_bytes };
  }
  /** Caller must retain this exact identity in durable run intent before writing.
   * The custody helper verifies streams before + after immutable storage, to256MiB. */
  async function putArtifactStream(identity: WorkspaceObjectIdentity, bytes: AsyncIterable<Uint8Array>) {
    if (!media.has(identity.media_type) || identity.storage_key !== workspaceObjectKey(identity.owner_id, identity.task_id, identity.sha256)) fail('ARTIFACT_SCOPE_INVALID');
    const retained = { ...identity };
    return { ...retained, ...await writeVerifiedWorkspaceObject(objects, retained, bytes) };
  }

  return { readArtifact, putArtifact, putArtifactStream };
}

/** Persist exact output-byte identity before storage side effects. Repeated intents
 * only reopen/hash retained bytes; they never issue a second ambiguous PUT. */
export function createWorkspaceRunArtifactWriter(store: WorkspaceStore, objects: WorkspacePrivateObjectStore, authorizeOwner: (ownerId: string) => Promise<boolean>, now: () => number = Date.now) {
  const spool = new WorkspacePrivateSpool();
  return async function writeRunArtifact(context: WorkspaceStageContext, raw: WorkspaceObjectIdentity, bytes: AsyncIterable<Uint8Array>): Promise<WorkspaceObjectIdentity> {
    const identity = { ...raw };
    if (!validId(identity.owner_id) || !validId(identity.task_id) || identity.owner_id !== context.owner_id || identity.task_id !== context.record.task.task_id
      || !/^[a-f0-9]{64}$/.test(identity.sha256) || identity.storage_key !== workspaceObjectKey(identity.owner_id, identity.task_id, identity.sha256)
      || !integer(identity.size_bytes, 1, 256 * 1024 * 1024) || !['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/zip', 'text/html', 'text/plain', 'application/json'].includes(identity.media_type)) fail('ARTIFACT_INTENT_SCOPE_INVALID');
    const sameIdentity = (value: WorkspaceObjectIdentity) => (['owner_id', 'task_id', 'storage_key', 'sha256', 'size_bytes', 'media_type'] as const).every(key => value[key] === identity[key]);
    const ownedRun = (state: Parameters<Parameters<WorkspaceStore['transaction']>[1]>[0]) => {
      if (context.signal.aborted) fail('ARTIFACT_WRITE_CANCELLED');
      const record = state.tasks.find(value => value.owner_id === context.owner_id && value.task.task_id === identity.task_id);
      const run = record?.runs?.find(value => value.run_id === context.run.run_id);
      const action = record?.actions.find(value => value.action_id === context.action.action_id);
      if (!record || !run || !action || record.task.state_version !== context.record.task.state_version || record.task.snapshot.snapshot_id !== context.record.task.snapshot.snapshot_id
        || record.task.snapshot.content_revision !== context.record.task.snapshot.content_revision || run.fence !== context.run.fence || run.lease_owner !== context.run.lease_owner || run.action_id !== action.action_id
        || run.operation_id !== context.run.operation_id || run.status !== 'in_flight' || Date.parse(run.lease_expires_at) <= now() || action.status !== 'running' || action.actor_id !== context.owner_id
        || record.actions.some(value => value.type === 'cancel' && ['queued', 'running'].includes(value.status)) || record.task.stage === 'cancelled') fail('ARTIFACT_WRITE_FENCED');
      return run;
    };
    if (!await authorizeOwner(context.owner_id)) fail('CURRENT_MEMBER_AUTHORIZATION_REQUIRED');
    const fresh = await store.transaction(context.owner_id, state => {
      const run = ownedRun(state); const intents = run.artifact_intents ??= [];
      const prior = intents.find(value => value.storage_key === identity.storage_key);
      if (prior) { if (!sameIdentity(prior)) fail('ARTIFACT_INTENT_CONFLICT'); return false; }
      if (intents.length >= 256 || intents.reduce((sum, value) => sum + value.size_bytes, 0) + identity.size_bytes > 512 * 1024 * 1024) fail('ARTIFACT_INTENT_LIMIT');
      const timestamp = new Date(now()).toISOString(); intents.push({ ...identity, status: 'reserved', created_at: timestamp, updated_at: timestamp }); return true;
    });
    try {
      // Recheck after intent commit, before the first storage write. The live run
      // check also fences cancellation, changed snapshots and competing leases.
      if (!await authorizeOwner(context.owner_id)) fail('CURRENT_MEMBER_AUTHORIZATION_REQUIRED');
      await store.transaction(context.owner_id, state => { ownedRun(state); });
      if (fresh) {
        // The custody helper stages/validates the entire stream before put().
        // Recheck at the actual side-effect boundary, not before slow staging.
        const guarded: WorkspacePrivateObjectStore = { kind: objects.kind, productionReady: objects.productionReady, loopbackOnly: objects.loopbackOnly,
          async put(object, source, objectContext) {
            if (context.signal.aborted) fail('ARTIFACT_WRITE_CANCELLED');
            if (!await authorizeOwner(context.owner_id)) fail('CURRENT_MEMBER_AUTHORIZATION_REQUIRED');
            await store.transaction(context.owner_id, state => { ownedRun(state); });
            if (context.signal.aborted) fail('ARTIFACT_WRITE_CANCELLED');
            return objects.put(object, source, objectContext);
          },
          open: (object, objectContext) => objects.open(object, objectContext), remove: (object, objectContext) => objects.remove(object, objectContext),
        };
        await writeVerifiedWorkspaceObject(guarded, identity, bytes, undefined, spool);
      }
      else {
        const opened = await objects.open(identity); if (!opened) fail('ARTIFACT_WRITE_RECONCILIATION_REQUIRED');
        try { const retained = await spool.prepare(opened.stream, identity); await retained.dispose(); }
        finally { await opened.dispose(); }
      }
      if (!await authorizeOwner(context.owner_id)) fail('CURRENT_MEMBER_AUTHORIZATION_REQUIRED');
      await store.transaction(context.owner_id, state => {
        const run = ownedRun(state); const intent = run.artifact_intents?.find(value => value.storage_key === identity.storage_key);
        if (!intent || !sameIdentity(intent)) fail('ARTIFACT_INTENT_CONFLICT');
        intent.status = 'verified'; intent.updated_at = new Date(now()).toISOString();
      });
      return identity;
    } catch (error) {
      // No overwrite, deletion, paid retry, or inferred not-submitted outcome.
      // Retain the exact identity even when the owner/revision/lease changed.
      await store.transaction(context.owner_id, state => {
        const run = state.tasks.find(value => value.owner_id === context.owner_id && value.task.task_id === identity.task_id)?.runs?.find(value => value.run_id === context.run.run_id);
        const intent = run?.artifact_intents?.find(value => value.storage_key === identity.storage_key);
        if (intent && sameIdentity(intent)) { intent.status = 'unknown'; intent.updated_at = new Date(now()).toISOString(); }
      }).catch(() => undefined);
      throw error;
    }
  };
}

export type WorkspaceRuntimeServices = {
  store: WorkspaceStore; budget?: PostgresWorkspaceBudget;
  providerBudget?: PostgresWorkspaceProviderBudget;
  artifacts?: ReturnType<typeof createWorkspaceArtifactAccess>; artifactService?: WorkspaceArtifactService;
  /** Text output remains untrusted; this never creates a stage/QC receipt. */
  writeRunArtifact: ReturnType<typeof createWorkspaceRunArtifactWriter>;
  submitText: (context: WorkspaceStageContext, request: WorkspaceOpenAIRequest) => Promise<WorkspaceOpenAIResult>;
  operations: ReturnType<typeof createWorkspaceOperationJournal>;
  reconcileArtifactWrites?: ReturnType<typeof createWorkspaceArtifactReconciler>['reconcileArtifactWrites'];
};
export type WorkspaceRuntimePipeline = {
  adapters: Partial<Record<WorkspaceRunnerStage, TrustedWorkspaceStageAdapter>>;
  readiness(): ExecutionReadiness; renderPreview?: WorkspaceApiOptions['renderPreview'];
  reconcilers?: WorkspaceRunnerOptions['reconcilers'];
  stageTiming?: WorkspaceRunnerOptions['stageTiming'];
};
export type WorkspaceRuntimeConfig = {
  publicOrigin?: string;
  auth?: { url: string; publicKey: string; fetcher?: typeof fetch; allowedUserIds?: readonly string[]; passwordLogin?: boolean };
  database?: { pool: WorkspaceSqlPool; budgetPool?: WorkspaceSqlPool; loginPool?: WorkspaceSqlPool; workerPool?: WorkspaceSqlPool; ownerStore: ConstructorParameters<typeof PostgresWorkspaceStore>[1]; budget?: WorkspaceBudgetConfig; providerBudget?: WorkspaceProviderBudgetConfig; login?: WorkspaceLoginLimiterConfig; workerDirectory?: WorkspaceWorkerDirectoryConfig };
  ingress?: WorkspaceIngressConfig;
  openai?: Pick<WorkspaceOpenAIOptions, 'serverCredential' | 'capability' | 'fetch' | 'limits' | 'now'>;
  objectStore?: WorkspacePrivateObjectStore;
  /** Optional separate scoped worker identity for the same private custody backend. */
  workerObjectStore?: WorkspacePrivateObjectStore;
  artifactSpool?: WorkspacePrivateSpool;
  renderPreview?: WorkspaceApiOptions['renderPreview'];
  createPipeline?: (services: WorkspaceRuntimeServices) => WorkspaceRuntimePipeline;
  createAdapters?: (services: WorkspaceRuntimeServices) => Partial<Record<WorkspaceRunnerStage, TrustedWorkspaceStageAdapter>>;
  createReconcilers?: (services: WorkspaceRuntimeServices) => WorkspaceRunnerOptions['reconcilers'];
  /** Reviewed release switch. Constructor assertions do not prove reviews/tests.
   * Keep false until actual DB/ingress/provider/quality release gates have passed. */
  executionEnabled?: boolean;
  worker?: { enabled: boolean; ownerPageSize?: number; stepsPerOwner?: number; workerId?: string };
  runner?: Pick<WorkspaceRunnerOptions, 'leaseMs' | 'timeoutMs' | 'stageTiming' | 'now' | 'id'>;
};
export function createWorkspaceRuntime(config: WorkspaceRuntimeConfig = {}) {
  config = { ...config, worker: config.worker ? { ...config.worker } : undefined, runner: config.runner ? { ...config.runner } : undefined };
  if (config.createPipeline && config.createAdapters) fail('AMBIGUOUS_STAGE_CONFIGURATION');
  const db = config.database;
  const store = db ? new PostgresWorkspaceStore(db.pool, db.ownerStore) : undefined;
  const budget = db?.budget ? new PostgresWorkspaceBudget(db.budgetPool ?? db.pool, db.budget) : undefined;
  if (db?.providerBudget && (!db.budget || db.providerBudget.qualifiedTable !== db.budget.qualifiedTable)) fail('PROVIDER_SHARED_BUDGET_SCOPE_REQUIRED');
  const providerBudget = db?.providerBudget ? new PostgresWorkspaceProviderBudget(db.budgetPool ?? db.pool, db.providerBudget) : undefined;
  const directory = db?.workerDirectory ? new PostgresWorkspaceWorkerDirectory(db.workerPool ?? db.pool, db.workerDirectory) : undefined;
  const limiter = db?.login ? new PostgresWorkspaceLoginLimiter(db.loginPool ?? db.pool, db.login) : undefined;
  const workerObjects = config.workerObjectStore ?? config.objectStore;
  const artifacts = workerObjects?.productionReady && !workerObjects.loopbackOnly ? createWorkspaceArtifactAccess(workerObjects) : undefined;
  const artifactService = store && config.objectStore ? new WorkspaceArtifactService(store, config.objectStore, { spool: config.artifactSpool }) : undefined;
  const auth = config.auth;
  const apiOptions: WorkspaceApiOptions = { environment: 'production', publicOrigin: config.publicOrigin, store,
    ...(auth ? { verifyToken: createSupabaseWorkspaceVerifier(auth), verifyMembership: createSupabaseWorkspaceMembershipVerifier(auth), ...(auth.passwordLogin ? { login: createSupabaseWorkspaceLogin(auth) } : {}) } : {}),
    ...(limiter && config.ingress ? { loginProtection: { reviewedIngress: true as const, limiter, resolveClientKey: createWorkspaceClientResolver(config.ingress) } } : {}),
    artifactService, renderPreview: config.renderPreview };
  const modelOptions = config.openai ? { ...config.openai, serverCredential: { ...config.openai.serverCredential }, capability: structuredClone(config.openai.capability) } : undefined;
  let runtimeAssembled = false;
  async function submitText(context: WorkspaceStageContext, request: WorkspaceOpenAIRequest): Promise<WorkspaceOpenAIResult> {
    if (!runtimeAssembled || !readiness().ready || !config.executionEnabled || !config.worker?.enabled || !directory || !budget || !modelOptions) fail('MODEL_EXECUTION_DISABLED');
    if (context.owner_id !== context.record.owner_id || context.action.actor_id !== context.owner_id || !(await directory.authorizeOwner(context.owner_id))) fail('MODEL_OWNER_NOT_AUTHORIZED');
    if (request.operation_id !== (context.provider_operation?.operation_id ?? context.run.operation_id) || typeof context.bindProviderOperation !== 'function') fail('MODEL_OPERATION_SCOPE_MISMATCH');
    const authorization = await budget.authorizationFor(modelOptions.serverCredential.project_id, context.owner_id, context.record.task.task_id, context.record.brief ? { brand: context.record.brief.brand, material: context.record.brief.material, source_url: context.record.brief.source_url } : undefined);
    if (!authorization) fail('TASK_BUDGET_AUTHORIZATION_REQUIRED');
    let binding: { reservation_id: string; request_sha256: string } | undefined;
    const transport = createWorkspaceOpenAITransport({ ...modelOptions, authorization,
      fetch: async (url, init) => {
        // The SQL accounting fence may wait. Revalidate the actual dispatch
        // boundary after it, rather than relying on a stale earlier run binding.
        if (context.signal.aborted || init?.signal?.aborted) fail('MODEL_DISPATCH_CANCELLED');
        if (!await directory.authorizeOwner(context.owner_id)) fail('MODEL_OWNER_NOT_AUTHORIZED');
        await store!.transaction(context.owner_id, state => {
          const record = state.tasks.find(value => value.owner_id === context.owner_id && value.task.task_id === context.record.task.task_id);
          const run = record?.runs?.find(value => value.run_id === context.run.run_id);
          const action = record?.actions.find(value => value.action_id === context.action.action_id);
          const actualBinding = run ? workspaceChildBinding(run, context.provider_operation) : undefined;
          if (!record || !run || !action || record.task.state_version !== context.record.task.state_version || record.task.snapshot.snapshot_id !== context.record.task.snapshot.snapshot_id
            || record.task.snapshot.content_revision !== context.record.task.snapshot.content_revision || run.status !== 'in_flight' || run.fence !== context.run.fence || run.lease_owner !== context.run.lease_owner
            || run.operation_id !== context.run.operation_id || run.stage !== context.run.stage || run.action_id !== action.action_id || action.status !== 'running' || action.actor_id !== context.owner_id
            || Date.parse(run.lease_expires_at) <= (config.runner?.now ?? Date.now)() || record.actions.some(value => value.type === 'cancel' && ['queued', 'running'].includes(value.status))
            || !binding || actualBinding?.reservation_id !== binding.reservation_id || actualBinding?.request_sha256 !== binding.request_sha256) fail('MODEL_DISPATCH_FENCED');
        });
        if (context.signal.aborted || init?.signal?.aborted) fail('MODEL_DISPATCH_CANCELLED');
        return modelOptions.fetch(url, init);
      }, budget: {
      reserve: request => budget.reserve(request),
      async markSubmissionIntent(request) {
        binding = { reservation_id: request.reservation_id, request_sha256: request.request_sha256 };
        await context.bindProviderOperation!({ provider: 'openai-responses', ...binding });
        return budget.markSubmissionIntent(request);
      },
      reconcile: report => budget.reconcile(report), releaseBeforeSubmit: request => budget.releaseBeforeSubmit(request),
    } });
    return transport.submit({ ...request, signal: context.signal });
  }
  const runArtifactWriter = store && workerObjects && directory ? createWorkspaceRunArtifactWriter(store, workerObjects, owner => directory.authorizeOwner(owner), config.runner?.now) : undefined;
  const writeRunArtifact: ReturnType<typeof createWorkspaceRunArtifactWriter> = async (context, identity, bytes) => {
    if (!runtimeAssembled || !readiness().ready || !runArtifactWriter) fail('ARTIFACT_WRITE_NOT_CONFIGURED');
    return runArtifactWriter(context, identity, bytes);
  };
  const operations = store ? createWorkspaceOperationJournal({ store, authorizeOwner: owner => directory ? directory.authorizeOwner(owner) : Promise.resolve(false), now: config.runner?.now }) : undefined;
  const custodyRecovery = store && workerObjects && directory ? createWorkspaceArtifactReconciler({ store, objects: workerObjects, authorizeOwner: owner => directory.authorizeOwner(owner), now: config.runner?.now }) : undefined;
  const services = store ? { store, budget, providerBudget, artifacts, artifactService, submitText, writeRunArtifact, operations: operations!, reconcileArtifactWrites: custodyRecovery?.reconcileArtifactWrites } : undefined;
  const pipeline = services && config.createPipeline ? config.createPipeline(services) : undefined;
  const adapters = pipeline?.adapters ?? (services && config.createAdapters ? config.createAdapters(services) : {});
  const reconcilers = pipeline?.reconcilers ?? (services && config.createReconcilers ? config.createReconcilers(services) : undefined);
  const renderPreview = config.renderPreview ?? pipeline?.renderPreview;
  apiOptions.renderPreview = renderPreview;
  function baseReadiness() {
    const blockers: Array<{ code: string; message: string }> = [];
    const add = (condition: unknown, code: string, message: string) => { if (!condition) blockers.push({ code, message }); };
    add(config.executionEnabled === true, 'EXECUTION_DISABLED', 'Workspace execution has not been enabled after deployment verification.');
    add(auth, 'AUTH_NOT_CONFIGURED', 'Existing Supabase authentication and current member verification are required.');
    add(store, 'DURABLE_PRODUCTION_STORE_REQUIRED', 'The reviewed Postgres owner-state store is not configured.');
    add(directory, 'WORKER_DIRECTORY_REQUIRED', 'Reviewed owner discovery and current-member database functions are not configured.');
    add(config.worker?.enabled === true, 'DURABLE_WORKER_REQUIRED', 'An independently supervised durable worker has not been enabled.');
    add(budget?.readiness(), 'SHARED_BUDGET_REQUIRED', 'A transactional shared/member/task journal with current verified pricing is required.');
    const current = modelOptions?.now?.() ?? Date.now();
    const cap = modelOptions?.capability, credential = modelOptions?.serverCredential;
    const modelReady = cap?.verified === true && cap.api === 'responses' && cap.model === WORKSPACE_OPENAI_MODEL
      && validId(cap.verification_ref) && validId(cap.project_id) && credential?.project_id === cap.project_id
      && typeof credential?.api_key === 'string' && /^[\x21-\x7e]{16,512}$/.test(credential.api_key) && typeof modelOptions?.fetch === 'function'
      && Array.isArray(cap.accepted_response_models) && cap.accepted_response_models.includes(WORKSPACE_OPENAI_MODEL) && cap.accepted_response_models.length <= 8
      && cap.accepted_response_models.every(model => /^gpt-6\.1-sol(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
      && Date.parse(cap.checked_at) <= current && Date.parse(cap.expires_at) > current;
    add(modelReady, 'MODEL_CAPABILITY_REQUIRED', 'A server credential and verified current OpenAI project/model capability are required.');
    let publicOriginReady = false;
    try { const url = new URL(config.publicOrigin!); publicOriginReady = url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash; } catch { /* fail closed */ }
    add(publicOriginReady, 'PUBLIC_ORIGIN_REQUIRED', 'The exact production HTTPS browser origin is required.');
    add(artifacts && artifactService?.productionReady && !artifactService.loopbackOnly, 'PRIVATE_ARTIFACT_STORE_REQUIRED', 'Reviewed private immutable artifact storage is not configured.');
    add(renderPreview, 'PRIVATE_PREVIEW_REQUIRED', 'Trusted private canonical preview rendering is not configured.');
    if (pipeline) {
      try {
        const result = pipeline.readiness();
        if (typeof result?.ready !== 'boolean' || !Array.isArray(result.blockers) || result.blockers.length > 30
          || result.blockers.some(blocker => typeof blocker?.code !== 'string' || !blocker.code || blocker.code.length > 100 || typeof blocker.message !== 'string' || !blocker.message || blocker.message.length > 1000)) throw new Error('invalid_stage_readiness');
        blockers.push(...result.blockers);
        if (!result.ready && !result.blockers.length) blockers.push({ code: 'STAGE_PIPELINE_NOT_READY', message: 'The configured execution pipeline is not ready.' });
      } catch { blockers.push({ code: 'STAGE_READINESS_UNAVAILABLE', message: 'Execution pipeline readiness could not be verified.' }); }
    }
    return { ready: blockers.length === 0, blockers };
  }
  const runner = store ? createWorkspaceRunner({ ...config.runner, stageTiming: { ...pipeline?.stageTiming, ...config.runner?.stageTiming }, store, adapters, reconcilers, environment: 'production', executionReadiness: baseReadiness,
    authorizeOwner: directory ? owner => directory.authorizeOwner(owner) : undefined, workerId: config.worker?.workerId }) : undefined;
  function readiness() {
    if (runner) return runner.readiness();
    const result = baseReadiness();
    for (const stage of ['draft', 'research', 'content_authoring', 'assets', 'review', 'packaging']) result.blockers.push({ code: 'ADAPTER_NOT_CONFIGURED', message: `Trusted ${stage} execution and evidence verification are not configured.` });
    return { ready: false, blockers: result.blockers };
  }
  async function taskScope(ownerId: string, taskId: string): Promise<WorkspaceAdmissionScope | null> {
    if (!validId(ownerId) || !validId(taskId) || !store) return null;
    return store.read(ownerId, state => {
      const record = state.tasks.find(value => value.owner_id === ownerId && value.task.task_id === taskId);
      return record ? { brand: record.brief.brand, material: record.brief.material, source_url: record.brief.source_url } : null;
    });
  }
  async function admitTask(ownerId: string, taskId: string): Promise<WorkspaceTaskAdmission> {
    if (!config.executionEnabled || !directory || !budget || !modelOptions) return { status: 'not_admitted', code: 'TASK_ADMISSION_NOT_CONFIGURED' };
    if (!await directory.authorizeOwner(ownerId)) return { status: 'not_admitted', code: 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED' };
    const scope = await taskScope(ownerId, taskId);
    if (!scope) return { status: 'not_admitted', code: 'TASK_NOT_FOUND' };
    return budget.admitTask(modelOptions.serverCredential.project_id, ownerId, taskId, scope, modelOptions.capability.verification_ref);
  }
  async function taskExecutionReadiness(ownerId: string, taskId: string): Promise<ExecutionReadiness> {
    const base = readiness(); const blockers = [...base.blockers];
    try {
      if (!directory || !await directory.authorizeOwner(ownerId)) blockers.push({ code: 'CURRENT_MEMBER_AUTHORIZATION_REQUIRED', message: 'Current contributor or admin membership is required to run this task.' });
      const scope = await taskScope(ownerId, taskId);
      const authorization = scope && budget && modelOptions ? await budget.authorizationFor(modelOptions.serverCredential.project_id, ownerId, taskId, scope) : null;
      if (!authorization) blockers.push({ code: 'TASK_BUDGET_AUTHORIZATION_REQUIRED', message: 'This task has no current approved data-sharing and budget grant under the member and shared limits.' });
    } catch { blockers.push({ code: 'TASK_AUTHORIZATION_UNAVAILABLE', message: 'Current task budget authorization could not be verified.' }); }
    return { ready: blockers.length === 0, blockers };
  }
  apiOptions.admitTask = admitTask; apiOptions.taskExecutionReadiness = taskExecutionReadiness;
  apiOptions.executionReadiness = readiness;
  if (runner && reconcilers && Object.keys(reconcilers).length) {
    apiOptions.reconcile = runner.reconcile;
    apiOptions.recoveryReadiness = stage => ['draft', 'research', 'content_authoring', 'assets', 'review', 'packaging', 'content_feedback', 'asset_feedback', 'assets_reuse'].includes(stage)
      && Object.hasOwn(reconcilers, stage) && runner.recoveryReadiness(stage as WorkspaceRunnerStage);
  }
  let cursor: string | null = null; let working = false;
  /** Called ONLY by a separately supervised process/loop, never HTTP polling.
   * Overlapping ticks in this process are coalesced; runner leases serialize hosts.
   * Failed owners do not starve the rest of a page. No automatic unknown retry. */
  async function tick(): Promise<{ status: 'disabled' | 'busy' | 'processed'; owners: number; results: WorkspaceRunnerResult[]; failures: number }> {
    if (!config.executionEnabled || !config.worker?.enabled || !runner || !directory) return { status: 'disabled', owners: 0, results: [], failures: 0 };
    if (working) return { status: 'busy', owners: 0, results: [], failures: 0 };
    const pageSize = config.worker.ownerPageSize ?? 25; const steps = config.worker.stepsPerOwner ?? 8;
    if (!integer(pageSize, 1, 100) || !integer(steps, 1, 100)) fail('INVALID_WORKER_LIMITS');
    working = true;
    try {
      const owners = await directory.discover(cursor, pageSize); const results: WorkspaceRunnerResult[] = []; let failures = 0;
      for (const owner of owners) { try { results.push(...await runner.drainOwner(owner, steps)); } catch { failures++; } }
      cursor = owners.length === pageSize ? owners.at(-1)! : null;
      return { status: 'processed', owners: owners.length, results, failures };
    } finally { working = false; }
  }
  runtimeAssembled = true;
  return { apiOptions, router: createWorkspaceRouter(apiOptions), runner, readiness, taskExecutionReadiness, admitTask, tick, budget, directory, artifacts, artifactService };
}

/** No hidden timer during server creation. Explicit startup is cancellable and
 * backpressure is sequential. Errors become a static callback code, never secrets. */
export async function runWorkspaceWorker(runtime: Pick<ReturnType<typeof createWorkspaceRuntime>, 'tick'>, options: { signal: AbortSignal; pollMs?: number; onError?: (code: string) => void }) {
  const delay = options.pollMs ?? 1000; if (!integer(delay, 100, 60_000)) fail('INVALID_WORKER_INTERVAL');
  while (!options.signal.aborted) {
    try { await runtime.tick(); } catch { options.onError?.('WORKSPACE_WORKER_TICK_FAILED'); }
    if (options.signal.aborted) break;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); options.signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, delay); options.signal.addEventListener('abort', finish, { once: true });
      if (options.signal.aborted) finish();
    });
  }
}

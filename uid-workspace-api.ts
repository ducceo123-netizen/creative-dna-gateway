import express, { type Express, type Request, type Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { createWorkspaceTask } from './uid-workspace-task.ts';
import type { WorkspacePreview } from './uid-workspace-preview.ts';
import { buildWorkspaceReviewManifest, resolveWorkspaceElementFeedback } from './uid-workspace-review.ts';
import { FileWorkspaceStore, WorkspaceStoreError, type WorkspaceActionRecord, type WorkspaceArtifact, type WorkspaceRecord, type WorkspaceStore } from './uid-workspace-store.ts';
import { WorkspaceArtifactError, WORKSPACE_ARTIFACT_LIMITS, publicWorkspaceReference, type WorkspaceArtifactService, type WorkspaceVerifiedDownload } from './uid-workspace-artifacts.ts';

export type WorkspaceIdentity = { id: string };
export type WorkspaceTokenVerifier = (token: string) => Promise<WorkspaceIdentity | null>;
export type WorkspaceMembershipVerifier = (identity: WorkspaceIdentity, token: string) => Promise<{ active: true; role: 'viewer' | 'contributor' | 'admin' } | null>;
export type WorkspaceLoginProvider = (email: string, password: string) => Promise<{ access_token: string } | null>;
export type WorkspaceLoginAttempt = { client_key: string; account_key: string; attempt_id: string };
/** Must atomically reserve BOTH independent client and normalized-account limits.
 * Successful login releases its reservation without charging a failure bucket or
 * clearing failures for other accounts. Rejected/unavailable outcomes and orphan
 * reservations need bounded expiry. No passwords, emails or tokens enter this API. */
export interface WorkspaceLoginLimiter {
  readonly durable: boolean;
  begin(attempt: WorkspaceLoginAttempt): Promise<{ allowed: true; reservation_id: string } | { allowed: false; retry_after_seconds?: number }>;
  finish(reservationId: string, outcome: 'success' | 'rejected' | 'unavailable'): Promise<void>;
}
export type WorkspaceLoginProtection = {
  /** Deployment review must verify exact ingress peers and sanitized header chain.
   * Never implement this as req.ip or blindly trusting X-Forwarded-For. */
  reviewedIngress: true;
  resolveClientKey: (request: Request) => string | null | Promise<string | null>;
  limiter: WorkspaceLoginLimiter;
};
export type ExecutionReadiness = { ready: boolean; blockers: Array<{ code: string; message: string }> };
export type WorkspaceApiOptions = {
  store?: WorkspaceStore;
  verifyToken?: WorkspaceTokenVerifier;
  verifyMembership?: WorkspaceMembershipVerifier;
  login?: WorkspaceLoginProvider;
  loginProtection?: WorkspaceLoginProtection;
  publicOrigin?: string;
  environment?: 'production' | 'development' | 'test';
  executionReadiness?: () => ExecutionReadiness;
  readArtifact?: (record: WorkspaceRecord, artifact: WorkspaceArtifact) => Promise<Uint8Array>;
  artifactService?: WorkspaceArtifactService;
  admitTask?: (ownerId:string,taskId:string) => Promise<{status:'admitted'|'already_admitted'|'not_admitted';code:string}>;
  taskExecutionReadiness?: (ownerId:string,taskId:string) => Promise<ExecutionReadiness>;
  /** Build from trusted private immutable references; never from request HTML. */
  renderPreview?: (record: WorkspaceRecord) => Promise<WorkspacePreview>;
  /** Trusted durable reconciliation only; never accept provider outcome assertions from HTTP. */
  reconcile?: (ownerId:string, taskId:string, runId:string, request:{expected_state_version:number;idempotency_key:string}) => Promise<unknown>;
  recoveryReadiness?: (stage: string) => boolean;
};
const EXECUTION_DISABLED: ExecutionReadiness = { ready: false, blockers: [
  { code: 'EXECUTION_NOT_CONFIGURED', message: 'An authorized model provider, durable worker, budget and verified execution adapters are not configured.' },
] };
const ID = z.string().min(1).max(200).regex(/^[A-Za-z0-9:_@.-]+$/);
const KEY = z.string().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/);
const sourceUrl = z.string().max(2048).url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.hostname.includes('.')
    && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)
    && !url.hostname.endsWith('.localhost') && !url.hostname.endsWith('.local') && !url.hostname.startsWith('[');
}, 'Use a public HTTPS product or collection URL.');
const briefSchema = z.object({
  brand: z.enum(['PawfectHouse', 'GiftSoul', 'SoulPrise']), material: z.literal('onepage'), source_url: sourceUrl,
  title: z.string().trim().min(1).max(160).optional(), requirements: z.string().trim().max(8000).optional(),
}).strict();
const createSchema = z.object({ idempotency_key: KEY, brief: briefSchema }).strict();
const scope = { idempotency_key: KEY, expected_state_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), content_revision: ID };
const actionSchema = z.discriminatedUnion('type', [
  z.object({ ...scope, type: z.literal('start') }).strict(),
  z.object({ ...scope, type: z.literal('approve_content') }).strict(),
  z.object({ ...scope, type: z.literal('approve_artwork'), review_index_id: z.string().regex(/^[a-f0-9]{64}$/), render_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ ...scope, type: z.literal('cancel') }).strict(),
  z.object({ ...scope, type: z.literal('feedback'), feedback: z.unknown() }).strict(),
  z.object({ ...scope, type: z.literal('content_feedback'), content_feedback: z.object({ groups: z.array(z.object({
    instruction: z.string().trim().min(1).max(4000),
    text_slots: z.array(z.object({ slot: ID, text_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(100),
    reference_ids: z.array(ID).max(16).refine(ids => new Set(ids).size === ids.length).optional(),
  }).strict()).min(1).max(10), reference_ids: z.array(ID).max(16).refine(ids => new Set(ids).size === ids.length).optional() }).strict() }).strict(),
]);
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => JSON.stringify(key) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message = code) { super(message); }
}
const publicAction = ({ action_id, idempotency_key, type, status, expected_state_version, content_revision, created_at }: WorkspaceActionRecord) =>
  ({ action_id, idempotency_key, type, status, expected_state_version, content_revision, created_at });
function taskView(record: WorkspaceRecord) {
  const { applied, consumed_receipts, ...task } = record.task;
  return { ...task, owner_id: record.owner_id, brief: record.brief, created_at: record.created_at, updated_at: record.updated_at,
    artifacts: record.artifacts.map(({ storage_key, ...artifact }) => ({ ...artifact, download_url: `/api/workspace/tasks/${encodeURIComponent(task.task_id)}/artifacts/${encodeURIComponent(artifact.artifact_id)}` })),
    references: (record.references ?? []).filter(reference => !reference.removed_at).map(reference => ({ ...publicWorkspaceReference(reference), download_url: `/api/workspace/tasks/${encodeURIComponent(task.task_id)}/references/${encodeURIComponent(reference.reference_id)}` })),
    review_manifest: record.review_manifest, content: record.content, quality: record.quality, actions: record.actions.map(publicAction) };
}
function findRecord(records: readonly WorkspaceRecord[], taskId: string, ownerId: string) {
  const record = records.find(record => record.task.task_id === taskId && record.owner_id === ownerId);
  if (!record) throw new ApiError(404, 'TASK_NOT_FOUND');
  return record;
}
function validateFeedbackReferences(record: WorkspaceRecord, payload: unknown) {
  const body = payload as {groups?: Array<{reference_ids?: string[]}>;reference_ids?:string[]};
  const groups = [...(body?.groups ?? []), ...(body?.reference_ids ? [{reference_ids:body.reference_ids}] : [])];
  for (const group of groups) for (const id of group.reference_ids ?? []) {
    const reference = record.references?.find(reference => reference.reference_id === id);
    if (!reference || reference.removed_at || reference.purpose !== 'feedback' || reference.content_revision !== record.task.snapshot.content_revision
      || reference.review_index_id !== record.review_manifest?.index_id || reference.technical_validation !== 'full_decode_passed') throw new ApiError(409, 'STALE_FEEDBACK_REFERENCE');
  }
}
const cookieName = 'uid_workspace_session';
function requestToken(req: Request) {
  const authorization = req.header('authorization');
  if (authorization) {
    if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization) || authorization.length > 16400) throw new ApiError(401, 'AUTHENTICATION_REQUIRED');
    return { token: authorization.slice(7), cookie: false };
  }
  const cookie = req.header('cookie') ?? '';
  if (cookie.length > 18000) throw new ApiError(401, 'AUTHENTICATION_REQUIRED');
  const values = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(cookieName + '='));
  if (values.length !== 1) throw new ApiError(401, 'AUTHENTICATION_REQUIRED');
  const token = values[0].slice(cookieName.length + 1);
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 16384) throw new ApiError(401, 'AUTHENTICATION_REQUIRED');
  return { token, cookie: true };
}

type SupabaseWorkspaceConfig = { url: string; publicKey: string; fetcher?: typeof fetch };
function supabaseOrigin(config: SupabaseWorkspaceConfig) {
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('INVALID_WORKSPACE_AUTH_CONFIG');
  let publicKey = config.publicKey.startsWith('sb_publishable_');
  if (!publicKey) {
    try { publicKey = JSON.parse(Buffer.from(config.publicKey.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { /* no public key */ }
  }
  if (!publicKey) throw new Error('WORKSPACE_PUBLIC_KEY_REQUIRED');
  return url.origin;
}
async function boundedAuthJson(response: globalThis.Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('INVALID_AUTH_RESPONSE');
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length; if (bytes > 65536) throw new Error('INVALID_AUTH_RESPONSE');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Remote Supabase verification, NEVER decoded JWT authority. Optional ID allowlist
 * is only an additional deployment restriction; it does not replace active membership. */
export function createSupabaseWorkspaceVerifier(config: SupabaseWorkspaceConfig & { allowedUserIds?: readonly string[] }): WorkspaceTokenVerifier {
  const origin = supabaseOrigin(config);
  const allowlist = config.allowedUserIds ? new Set(config.allowedUserIds) : null;
  return async token => {
    const response = await (config.fetcher ?? fetch)(origin + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: config.publicKey },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error('AUTH_VERIFICATION_UNAVAILABLE');
    const user = await boundedAuthJson(response);
    return typeof user.id === 'string' && (!allowlist || allowlist.has(user.id)) && user.role === 'authenticated'
      && user.is_anonymous !== true && Boolean(user.email_confirmed_at || user.phone_confirmed_at)
      && !user.deleted_at && !(user.banned_until && Date.parse(user.banned_until) > Date.now()) ? { id: user.id } : null;
  };
}
/** Reuse the existing UID member self-read RLS boundary. No service role, new
 * permissions or cross-user membership listing. Checked freshly on EVERY request. */
export function createSupabaseWorkspaceMembershipVerifier(config: SupabaseWorkspaceConfig): WorkspaceMembershipVerifier {
  const origin = supabaseOrigin(config);
  return async (identity, token) => {
    const response = await (config.fetcher ?? fetch)(origin + '/rest/v1/creative_dna_team_members?select=user_id,role,is_active&user_id=eq.' + encodeURIComponent(identity.id) + '&limit=2', {
      headers: { Authorization: 'Bearer ' + token, apikey: config.publicKey },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error('MEMBERSHIP_VERIFICATION_UNAVAILABLE');
    const rows = await boundedAuthJson(response);
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    return row?.user_id === identity.id && row.is_active === true && ['viewer', 'contributor', 'admin'].includes(row.role) ? { active: true, role: row.role } : null;
  };
}
/** Optional sign-in only. No signup, refresh-token persistence or browser tokens.
 * The caller MUST remotely verify the returned access token and current membership
 * before setting a cookie. Never log credentials, response bodies or auth headers. */
export function createSupabaseWorkspaceLogin(config: SupabaseWorkspaceConfig): WorkspaceLoginProvider {
  const origin = supabaseOrigin(config);
  return async (email, password) => {
    const response = await (config.fetcher ?? fetch)(origin + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: config.publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if ([400, 401, 403, 422].includes(response.status)) return null;
    if (!response.ok) throw new Error('LOGIN_UNAVAILABLE');
    const data = await boundedAuthJson(response);
    return typeof data.access_token === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.access_token) && data.access_token.length <= 16384 ? { access_token: data.access_token } : null;
  };
}

/** Deliberately no automatic cloud storage, provider, paid writes or existing
 * checkpoint activation. Production needs an explicitly injected reviewed store.
 * Auth config alone cannot turn on execution or development persistence. */
export function workspaceOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): WorkspaceApiOptions {
  const environment = env.NODE_ENV === 'development' ? 'development' : env.NODE_ENV === 'test' ? 'test' : 'production';
  const options: WorkspaceApiOptions = { environment, publicOrigin: env.UID_WORKSPACE_PUBLIC_ORIGIN };
  if (env.UID_WORKSPACE_ENABLED !== 'true') return options;
  try {
    if (env.UID_WORKSPACE_AUTH_URL && env.UID_WORKSPACE_AUTH_PUBLIC_KEY) {
      const config = { url: env.UID_WORKSPACE_AUTH_URL, publicKey: env.UID_WORKSPACE_AUTH_PUBLIC_KEY };
      options.verifyToken = createSupabaseWorkspaceVerifier({ ...config,
        ...(env.UID_WORKSPACE_ALLOWED_USER_IDS ? { allowedUserIds: env.UID_WORKSPACE_ALLOWED_USER_IDS.split(',').map(id => id.trim()).filter(Boolean) } : {}) });
      options.verifyMembership = createSupabaseWorkspaceMembershipVerifier(config);
      if (env.UID_WORKSPACE_LOGIN_ENABLED === 'true') options.login = createSupabaseWorkspaceLogin(config);
    }
  } catch { /* Malformed or privileged auth settings fail closed. */ }
  if (environment === 'development' && env.UID_WORKSPACE_STORE === 'filesystem' && env.UID_WORKSPACE_STATE_DIR) {
    try { options.store = new FileWorkspaceStore(env.UID_WORKSPACE_STATE_DIR, { environment }); } catch { /* Fail closed. */ }
  }
  return options;
}

/** Development/test only; intentionally not marked durable and never selected in
 * production. Reservations bound concurrent attempts; successes do not consume
 * the shared client failure allowance. No caller-supplied IP header is read. */
function developmentLoginLimiter(): WorkspaceLoginLimiter {
  const buckets = new Map<string, { failures: number; inFlight: number; until: number }>();
  const reservations = new Map<string, { keys: string[]; until: number }>();
  const windowMs = 10 * 60_000;
  const prune = (now: number) => {
    for (const [id, reservation] of reservations) if (reservation.until <= now) {
      for (const key of reservation.keys) { const bucket = buckets.get(key); if (bucket) { bucket.inFlight = Math.max(0, bucket.inFlight - 1); bucket.failures++; } }
      reservations.delete(id);
    }
    for (const [key, bucket] of buckets) if (bucket.until <= now && !bucket.inFlight) buckets.delete(key);
  };
  return {
    durable: false,
    async begin(attempt) {
      const now = Date.now(); prune(now);
      const keys = ['client:' + attempt.client_key, 'account:' + attempt.account_key];
      if (keys.some((key, index) => { const value = buckets.get(key); return value && value.failures + value.inFlight >= (index === 0 ? 30 : 10); })
        || reservations.size >= 1000 || buckets.size + keys.filter(key => !buckets.has(key)).length > 2000) return { allowed: false, retry_after_seconds: 600 };
      for (const key of keys) { const bucket = buckets.get(key) ?? { failures: 0, inFlight: 0, until: now + windowMs }; bucket.inFlight++; buckets.set(key, bucket); }
      reservations.set(attempt.attempt_id, { keys, until: now + 60_000 });
      return { allowed: true, reservation_id: attempt.attempt_id };
    },
    async finish(id, outcome) {
      const reservation = reservations.get(id);
      if (!reservation) throw new Error('LOGIN_RESERVATION_UNKNOWN');
      for (const key of reservation.keys) {
        const bucket = buckets.get(key);
        if (bucket) { bucket.inFlight = Math.max(0, bucket.inFlight - 1); if (outcome !== 'success') bucket.failures++; }
      }
      reservations.delete(id);
    },
  };
}
const readinessSchema = z.object({ ready: z.boolean(), blockers: z.array(z.object({ code: z.string().min(1).max(100), message: z.string().min(1).max(1000) }).strict()).max(50) }).strict();

export function createWorkspaceRouter(options: WorkspaceApiOptions = workspaceOptionsFromEnv()) {
  const router = express.Router();
  const production = (options.environment ?? 'production') === 'production';
  let store = options.store && (!production || options.store.productionReady) ? options.store : undefined;
  let origin: string | undefined;
  try {
    const url = new URL(options.publicOrigin!);
    if (url.protocol === 'https:' || (!production && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) origin = url.origin;
  } catch { /* Cookie writes require an explicit valid same-origin boundary. */ }
  // A development filesystem is not a public hosting adapter, even when an
  // operator accidentally starts the dev server on 0.0.0.0 or behind a proxy.
  if (store?.kind === 'filesystem-development' && (!origin || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname))) store = undefined;
  const artifactService = options.artifactService && (!production || options.artifactService.productionReady) && (!options.artifactService.loopbackOnly || origin && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) ? options.artifactService : undefined;
  const configuredProtection = options.loginProtection;
  const protectionShapeValid = configuredProtection?.reviewedIngress === true && typeof configuredProtection.resolveClientKey === 'function'
    && typeof configuredProtection.limiter?.begin === 'function' && typeof configuredProtection.limiter?.finish === 'function';
  const loginProtection = protectionShapeValid && (!production || configuredProtection.limiter.durable === true) ? configuredProtection
    : !production && !configuredProtection ? { reviewedIngress: true as const, resolveClientKey: (req: Request) => req.socket.remoteAddress ?? null, limiter: developmentLoginLimiter() } : undefined;
  const loginSupported = Boolean(options.login && options.verifyToken && options.verifyMembership && origin && loginProtection);
  const readiness = () => {
    let runtime: ExecutionReadiness = EXECUTION_DISABLED;
    try {
      const result = readinessSchema.safeParse(options.executionReadiness ? options.executionReadiness() : EXECUTION_DISABLED);
      if (!result.success) throw new Error('invalid_readiness');
      runtime = result.data;
    } catch { runtime = { ready: false, blockers: [{ code: 'EXECUTION_READINESS_UNKNOWN', message: 'Execution readiness could not be verified.' }] }; }
    const blockers = [...runtime.blockers];
    if (!options.verifyMembership) blockers.unshift({ code: 'MEMBERSHIP_NOT_CONFIGURED', message: 'Current UID member access is not configured.' });
    if (!options.verifyToken) blockers.unshift({ code: 'AUTH_NOT_CONFIGURED', message: 'Workspace authentication is not configured.' });
    if (!store) blockers.unshift({ code: 'STORAGE_NOT_CONFIGURED', message: 'A permitted durable workspace store is not configured.' });
    return { authentication_configured: Boolean(options.verifyToken && options.verifyMembership), storage: { configured: Boolean(store), kind: store?.kind ?? 'unconfigured', production_ready: Boolean(store?.productionReady) },
      execution: { ready: Boolean(runtime.ready && blockers.length === 0 && options.verifyToken && options.verifyMembership && store), blockers },
      login_supported: loginSupported, auth: { login_supported: loginSupported, login_blocker: options.login && !loginProtection ? 'LOGIN_RATE_LIMIT_NOT_CONFIGURED' : null },
      creation_supported: Boolean(options.verifyToken && options.verifyMembership && store), session_endpoint: '/api/workspace/session',
      uploads: { configured: Boolean(artifactService && store && options.verifyToken && options.verifyMembership), max_bytes: WORKSPACE_ARTIFACT_LIMITS.upload_bytes, allowed_media_types: ['image/png','image/jpeg','image/webp'], blockers: artifactService ? [] : [{ code:'PRIVATE_UPLOAD_NOT_CONFIGURED', message:'Verified private upload storage is not configured.' }] },
      brands: ['PawfectHouse', 'GiftSoul', 'SoulPrise'].map(id => ({ id, label: id })),
      materials: [{ id: 'onepage', label: 'Onepage', creation_supported: Boolean(options.verifyToken && options.verifyMembership && store), executable: Boolean(runtime.ready && blockers.length === 0 && options.verifyToken && options.verifyMembership && store) }] };
  };
  async function readinessForTask(ownerId:string, id:string) {
    const ready=readiness(); if(!options.taskExecutionReadiness)return ready;
    let task:ExecutionReadiness;
    try {task=readinessSchema.parse(await options.taskExecutionReadiness(ownerId,id));}
    catch {task={ready:false,blockers:[{code:'TASK_EXECUTION_READINESS_UNKNOWN',message:'This task’s execution authorization could not be verified.'}]};}
    return {...ready,execution:{ready:ready.execution.ready&&task.ready,blockers:[...ready.execution.blockers,...task.blockers]}};
  }
  async function admitTask(ownerId:string,id:string) {
    if(!options.admitTask)return undefined;
    try {return await options.admitTask(ownerId,id);}catch{return {status:'not_admitted' as const,code:'TASK_ADMISSION_UNCONFIRMED'};}
  }
  // Do not inherit gateway-wide public CORS for private owner data. Requests with
  // no Origin (nonbrowser API clients) still require server-verified bearer auth.
  router.use((req, res, next) => {
    res.removeHeader('Access-Control-Allow-Origin'); res.removeHeader('Access-Control-Allow-Credentials');
    res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie, Origin', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if ((store?.kind === 'filesystem-development' || artifactService?.loopbackOnly) && (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || req.header('x-forwarded-for') || req.header('forwarded'))) return res.status(403).json({ error: { code: 'LOCAL_STORE_LOOPBACK_ONLY', message: 'Development persistence is available only to direct loopback requests.' } });
    if (req.method === 'OPTIONS') return res.status(403).json({ error: { code: 'CROSS_ORIGIN_NOT_ALLOWED', message: 'Workspace requests must use the same origin.' } });
    next();
  });
  router.use(express.json({ limit: '64kb', strict: true }));
  const route = (handler: (req: Request, res: Response) => Promise<unknown> | unknown) => async (req: Request, res: Response) => {
    try { await handler(req, res); }
    catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      const known = error instanceof ApiError || error instanceof WorkspaceArtifactError;
      const code = known ? error.code : error instanceof WorkspaceStoreError ? error.code : 'WORKSPACE_UNAVAILABLE';
      res.status(known ? error.status : 503).json({ error: { code, message: known ? error.message : 'Workspace state could not be confirmed. Refresh and inspect the saved action before trying again.', retryable: false }, readiness: readiness() });
    }
  };
  async function identity(req: Request, mutation = false, requireContributor = mutation) {
    if (!options.verifyToken) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Workspace authentication is not configured.');
    const { token, cookie } = requestToken(req);
    if (mutation && ((req.header('origin') && req.header('origin') !== origin) || (cookie && (!origin || req.header('origin') !== origin)) || req.header('sec-fetch-site') === 'cross-site')) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED');
    return authenticateToken(token, requireContributor);
  }
  async function authenticateToken(token: string, requireContributor = false) {
    if (!options.verifyToken || !options.verifyMembership) throw new ApiError(503, 'AUTH_NOT_CONFIGURED');
    let user: WorkspaceIdentity | null;
    try { user = await options.verifyToken(token); } catch { throw new ApiError(503, 'AUTH_VERIFICATION_UNAVAILABLE'); }
    if (!user || !ID.safeParse(user.id).success) throw new ApiError(401, 'AUTHENTICATION_REQUIRED');
    let membership;
    try { membership = await options.verifyMembership(user, token); } catch { throw new ApiError(503, 'MEMBERSHIP_VERIFICATION_UNAVAILABLE'); }
    if (!membership || membership.active !== true || !['viewer', 'contributor', 'admin'].includes(membership.role)) throw new ApiError(403, 'MEMBERSHIP_REQUIRED');
    if (requireContributor && membership.role === 'viewer') throw new ApiError(403, 'WRITE_MEMBERSHIP_REQUIRED');
    return user;
  }
  function setSession(res: Response, token: string) {
    res.cookie(cookieName, token, { httpOnly: true, secure: production, sameSite: 'strict', path: '/api/workspace', maxAge: 3600000 });
  }
  const requireStore = () => { if (!store) throw new ApiError(503, 'STORAGE_NOT_CONFIGURED'); return store; };
  const taskId = (req: Request) => { const parsed = ID.safeParse(req.params.taskId); if (!parsed.success) throw new ApiError(404, 'TASK_NOT_FOUND'); return parsed.data; };
  router.get('/config', route((_req, res) => res.json(readiness())));
  router.get('/session', route(async (req, res) => res.json({ authenticated: true, user: await identity(req), readiness: readiness() })));
  router.post('/session', route(async (req, res) => {
    // Existing trusted login flow may exchange its real JWT. No token entry UI,
    // password logging, browser token storage or browser-exposed service key.
    if (!req.header('authorization')) throw new ApiError(401, 'AUTHENTICATION_REQUIRED');
    const user = await identity(req, true, false);
    if (!origin || req.header('origin') !== origin) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED');
    setSession(res, requestToken(req).token);
    res.json({ authenticated: true, user, readiness: readiness() });
  }));
  router.post('/session/login', route(async (req, res) => {
    if (!options.login || !options.verifyToken || !options.verifyMembership || !origin) throw new ApiError(503, 'LOGIN_NOT_CONFIGURED', 'Workspace sign-in is not configured.');
    if (!loginProtection) throw new ApiError(503, 'LOGIN_RATE_LIMIT_NOT_CONFIGURED', 'Reviewed client identification and durable account/client login limits are required.');
    if (req.header('origin') !== origin || req.header('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'ORIGIN_NOT_ALLOWED');
    const parsed = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(1024) }).strict().safeParse(req.body);
    if (!parsed.success) throw new ApiError(401, 'LOGIN_FAILED', 'Unable to sign in with these credentials or workspace access.');
    let client: string | null;
    try { client = await loginProtection.resolveClientKey(req); }
    catch { throw new ApiError(503, 'LOGIN_RATE_LIMIT_UNAVAILABLE'); }
    if (typeof client !== 'string' || !client.trim() || client.length > 512 || /[\r\n\0]/.test(client)) throw new ApiError(503, 'LOGIN_RATE_LIMIT_UNAVAILABLE');
    // Hash bounded normalized keys so limiter/audit adapters receive no raw email,
    // password, bearer token or client address. Production resolver may return HMAC.
    const attempt: WorkspaceLoginAttempt = { attempt_id: randomUUID(), client_key: hash('workspace-client:' + client), account_key: hash('workspace-account:' + parsed.data.email.toLowerCase()) };
    let allowance;
    try { allowance = await loginProtection.limiter.begin(attempt); }
    catch { throw new ApiError(503, 'LOGIN_RATE_LIMIT_UNAVAILABLE'); }
    if (!allowance || allowance.allowed !== true) {
      if (allowance?.allowed !== false) throw new ApiError(503, 'LOGIN_RATE_LIMIT_UNAVAILABLE');
      if (typeof allowance.retry_after_seconds === 'number' && Number.isSafeInteger(allowance.retry_after_seconds) && allowance.retry_after_seconds > 0 && allowance.retry_after_seconds <= 3600) res.set('Retry-After', String(allowance.retry_after_seconds));
      throw new ApiError(429, 'LOGIN_RATE_LIMITED', 'Too many sign-in attempts. Try again later.');
    }
    if (typeof allowance.reservation_id !== 'string' || !allowance.reservation_id || allowance.reservation_id.length > 256) throw new ApiError(503, 'LOGIN_RATE_LIMIT_UNAVAILABLE');
    const finish = async (outcome: 'success' | 'rejected' | 'unavailable') => {
      try { await loginProtection.limiter.finish(allowance.reservation_id, outcome); }
      catch { throw new ApiError(503, 'LOGIN_RATE_LIMIT_UNAVAILABLE'); }
    };
    let user: WorkspaceIdentity;
    let token: string;
    try {
      const session = await options.login(parsed.data.email, parsed.data.password);
      if (!session || typeof session.access_token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session.access_token) || session.access_token.length > 16384) throw new ApiError(401, 'LOGIN_FAILED');
      token = session.access_token;
      user = await authenticateToken(token);
    } catch (error) {
      const rejected = error instanceof ApiError && error.status < 500;
      await finish(rejected ? 'rejected' : 'unavailable');
      throw new ApiError(rejected ? 401 : 503, rejected ? 'LOGIN_FAILED' : 'LOGIN_UNAVAILABLE', rejected ? 'Unable to sign in with these credentials or workspace access.' : 'Sign-in is temporarily unavailable.');
    }
    await finish('success');
    setSession(res, token);
    res.json({ authenticated: true, user, readiness: readiness() });
  }));
  router.delete('/session', route(async (req, res) => {
    if (!origin || req.header('origin') !== origin) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED');
    res.clearCookie(cookieName, { httpOnly: true, secure: production, sameSite: 'strict', path: '/api/workspace' });
    res.json({ authenticated: false });
  }));
  router.get('/tasks', route(async (req, res) => {
    const user = await identity(req); const storage = requireStore();
    const query = z.object({ offset: z.string().regex(/^\d{1,6}$/).optional(), cursor: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict().safeParse(req.query);
    if (!query.success || query.data.offset && query.data.cursor) throw new ApiError(400, 'INVALID_QUERY');
    const offset = Number(query.data.offset ?? 0);
    let cursor: { owner_id:string; updated_at:string; task_id:string } | undefined;
    if (query.data.cursor) {
      try { cursor = z.object({ owner_id:ID, updated_at:z.string().datetime(), task_id:ID }).strict().parse(JSON.parse(Buffer.from(query.data.cursor,'base64url').toString('utf8'))); }
      catch { throw new ApiError(400,'INVALID_CURSOR'); }
      if (cursor.owner_id !== user.id) throw new ApiError(400,'INVALID_CURSOR');
    }
    const result = await storage.read(user.id, state => {
      const ordered = state.tasks.filter(record => record.owner_id === user.id).sort((a,b) => b.updated_at.localeCompare(a.updated_at) || b.task.task_id.localeCompare(a.task.task_id));
      const sorted = cursor ? ordered.filter(record => record.updated_at < cursor!.updated_at || record.updated_at === cursor!.updated_at && record.task.task_id.localeCompare(cursor!.task_id) < 0) : ordered;
      const page = sorted.slice(offset,offset+100), last = page.at(-1), has_more = sorted.length > offset+100;
      const next_cursor = has_more && last ? Buffer.from(JSON.stringify({owner_id:user.id,updated_at:last.updated_at,task_id:last.task.task_id})).toString('base64url') : null;
      return { tasks:page.map(taskView), has_more, next_cursor };
    });
    res.json({ ...result, owner_id:user.id, readiness: readiness() });
  }));
  router.post('/tasks', route(async (req, res) => {
    const user = await identity(req, true); const storage = requireStore();
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'INVALID_BRIEF', 'Use a supported brand, Onepage material and a public HTTPS source URL.');
    const { brief, idempotency_key } = parsed.data; const fingerprint = hash(canonical(brief));
    const result = await storage.transaction(user.id, state => {
      const prior = state.creations.find(item => item.idempotency_key === idempotency_key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
        return { task: taskView(findRecord(state.tasks, prior.task_id, user.id)), duplicate: true };
      }
      if (state.tasks.length >= 1000) throw new ApiError(409, 'TASK_LIMIT_REACHED');
      const now = new Date().toISOString(); const id = randomUUID();
      const record: WorkspaceRecord = { owner_id: user.id, task: createWorkspaceTask(id, { snapshot_id: randomUUID(), canonical_version: 'unresolved', content_revision: 'brief:' + randomUUID(), content_digest: fingerprint, assets: [] }),
        brief, created_at: now, updated_at: now, actions: [], events: [{ sequence: 1, type: 'draft_saved', created_at: now, data: { state_version: 0 } }], artifacts: [], review_manifest: null, preview: null, content: null, quality: [] };
      state.tasks.push(record); state.creations.push({ idempotency_key, fingerprint, task_id: id });
      return { task: taskView(record), duplicate: false };
    });
    const admission=await admitTask(user.id,result.task.task_id);
    res.status(result.duplicate ? 200 : 201).json({ ...result, owner_id:user.id, ...(admission?{admission}:{}), readiness: await readinessForTask(user.id,result.task.task_id) });
  }));
  router.get('/tasks/:taskId', route(async (req, res) => {
    const user = await identity(req); const id = taskId(req);
    const task = await requireStore().read(user.id, state => taskView(findRecord(state.tasks, id, user.id)));
    res.json({ task, owner_id:user.id, readiness: await readinessForTask(user.id,id) });
  }));
  router.get('/tasks/:taskId/events', route(async (req, res) => {
    const user = await identity(req); const id = taskId(req);
    const query = z.object({ after: z.string().regex(/^\d{1,12}$/).optional() }).strict().safeParse(req.query);
    if (!query.success) throw new ApiError(400, 'INVALID_EVENT_CURSOR');
    const after = Number(query.data.after ?? 0);
    const result = await requireStore().read(user.id, state => {
      const events = findRecord(state.tasks, id, user.id).events.filter(event => event.sequence > after);
      const page = events.slice(0, 200);
      return { events: page, cursor: page.at(-1)?.sequence ?? after, has_more: events.length > page.length };
    });
    res.json(result);
  }));
  router.post('/tasks/:taskId/actions', route(async (req, res) => {
    const user = await identity(req, true); const id = taskId(req); const storage = requireStore();
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'INVALID_ACTION');
    const input = parsed.data; const fingerprint = hash(canonical(input));
    await storage.read(user.id,state=>findRecord(state.tasks,id,user.id));
    if(input.type==='start')await admitTask(user.id,id);
    const ready = await readinessForTask(user.id,id);
    const result = await storage.transaction(user.id, state => {
      const record = findRecord(state.tasks, id, user.id);
      const prior = record.actions.find(action => action.idempotency_key === input.idempotency_key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
        return { task: taskView(record), action: publicAction(prior), duplicate: true };
      }
      if (record.task.state_version !== input.expected_state_version || record.task.snapshot.content_revision !== input.content_revision) throw new ApiError(409, 'STALE_ACTION', 'This task changed. Refresh before applying a new action.');
      if (record.task.stage === 'unknown' || record.actions.some(action => action.status === 'unknown')) throw new ApiError(409, 'RECONCILIATION_REQUIRED', 'The previous operation outcome is unknown. Reconcile it before any new action.');
      if (record.task.stage === 'cancelled') throw new ApiError(409, 'TERMINAL_TASK');
      if (['feedback','content_feedback'].includes(input.type) && record.revision_plan && record.revision_plan.phase !== 'review_ready') throw new ApiError(409,'REVISION_PLAN_IN_PROGRESS');
      if (input.type !== 'cancel' && record.task.pending_feedback) throw new ApiError(409, 'FEEDBACK_UNRESOLVED');
      if (input.type !== 'cancel' && record.actions.some(action => ['queued', 'running'].includes(action.status))) throw new ApiError(409, 'ACTION_IN_PROGRESS');
      if (input.type === 'cancel' && record.actions.some(action => action.type === 'cancel' && ['queued', 'running'].includes(action.status))) throw new ApiError(409, 'ACTION_IN_PROGRESS');
      if (input.type === 'start' && record.task.stage !== 'draft') throw new ApiError(409, 'START_REQUIRES_DRAFT');
      if (input.type === 'approve_content' && (record.task.stage !== 'content_review' || !record.content || record.content.revision !== input.content_revision)) throw new ApiError(409, 'CONTENT_NOT_READY');
      if (input.type !== 'cancel' && !ready.execution.ready) throw new ApiError(503, 'EXECUTION_UNAVAILABLE', 'The brief is saved. Execution is unavailable until the listed prerequisites are verified.');
      if (input.type === 'cancel' && record.task.stage === 'completed') throw new ApiError(409, 'TERMINAL_TASK');
      let payload: unknown = {};
      if (input.type === 'feedback') {
        if (!['content_review', 'review', 'packaging', 'completed'].includes(record.task.stage) || !record.review_manifest) throw new ApiError(409, 'PREVIEW_UNAVAILABLE');
        try { payload = resolveWorkspaceElementFeedback(record.review_manifest, input.feedback); }
        catch (error) { throw new ApiError(409, error instanceof Error && ['STALE_PREVIEW', 'OVERLAPPING_FEEDBACK_GROUPS', 'UNKNOWN_ELEMENT'].includes(error.message) ? error.message : 'INVALID_FEEDBACK'); }
      }
      if (input.type === 'content_feedback') {
        if (!['content_review', 'review', 'packaging', 'completed'].includes(record.task.stage) || !record.content || record.content.revision !== input.content_revision) throw new ApiError(409, 'CONTENT_NOT_READY');
        const selected = new Set<string>();
        for (const group of input.content_feedback.groups) for (const target of group.text_slots) {
          if (selected.has(target.slot)) throw new ApiError(409, 'OVERLAPPING_FEEDBACK_GROUPS');
          selected.add(target.slot);
          if (!Object.hasOwn(record.content.slots, target.slot) || hash(record.content.slots[target.slot]) !== target.text_hash) throw new ApiError(409, 'STALE_CONTENT', 'The selected copy changed. Refresh and select the current slot.');
        }
        payload = { task_id: id, content_revision: input.content_revision, ...input.content_feedback, status: 'RESOLVED_INTENT_NOT_EXECUTED' };
      }
      if (input.type === 'feedback' || input.type === 'content_feedback') validateFeedbackReferences(record, payload);
      if (input.type === 'approve_artwork') {
        const manifest = record.review_manifest;
        if (record.task.stage !== 'review' || !manifest || !record.task.snapshot.assets.length) throw new ApiError(409, 'ARTWORK_NOT_READY');
        const { index_id, ...manifestBody } = manifest;
        if (buildWorkspaceReviewManifest(manifestBody).index_id !== index_id || manifest.task_id !== id || manifest.content_revision !== input.content_revision
          || input.review_index_id !== index_id || input.render_hash !== manifest.render_hash) throw new ApiError(409, 'STALE_PREVIEW');
        const assets = record.task.snapshot.assets.map(asset => {
          const artifact = record.artifacts.find(item => item.revision_id === asset.revision_id && item.content_revision === input.content_revision && item.kind === 'image' && item.verification === 'verified');
          const displayed = manifest.elements.filter(element => element.kind === 'image' && element.canonical_slot === asset.canonical_slot);
          if (!artifact || !displayed.length || displayed.some(element => element.kind !== 'image' || element.artifact_revision !== asset.revision_id || element.sha256 !== artifact.sha256)) throw new ApiError(409, 'ARTWORK_NOT_READY');
          return { asset_id: asset.asset_id, canonical_slot: asset.canonical_slot, revision_id: asset.revision_id, sha256: artifact.sha256 };
        });
        payload = { approval_source: 'authenticated_user', snapshot_id: record.task.snapshot.snapshot_id,
          content_digest: record.task.snapshot.content_digest, review_index_id: index_id, render_hash: manifest.render_hash, assets };
      }
      if (input.type === 'approve_content') payload = { content_digest: record.task.snapshot.content_digest, snapshot_id: record.task.snapshot.snapshot_id, approval_source: 'authenticated_user' };
      if (record.actions.length >= 2000 || record.events.length >= 10000) throw new ApiError(409, 'TASK_HISTORY_LIMIT_REACHED');
      const now = new Date().toISOString();
      const action: WorkspaceActionRecord = { action_id: randomUUID(), idempotency_key: input.idempotency_key, fingerprint, type: input.type, status: 'queued',
        expected_state_version: input.expected_state_version, content_revision: input.content_revision, created_at: now, actor_id: user.id, payload };
      record.actions.push(action);
      record.task = { ...record.task, state_version: record.task.state_version + 1 };
      record.updated_at = now;
      record.events.push({ sequence: (record.events.at(-1)?.sequence ?? 0) + 1, type: 'action_queued', created_at: now,
        data: { action_id: action.action_id, action_type: action.type, status: 'queued', state_version: record.task.state_version } });
      return { task: taskView(record), action: publicAction(action), duplicate: false };
    });
    res.status(result.duplicate ? 200 : 202).json({ ...result, owner_id:user.id, readiness: ready });
  }));
  router.get('/tasks/:taskId/revisions', route(async(req,res)=>{
    const user=await identity(req), id=taskId(req);
    const result=await requireStore().read(user.id,state=>{
      const record=findRecord(state.tasks,id,user.id);
      const prior=record.revision_history??[];
      const current={revision_id:record.task.snapshot.snapshot_id,captured_at:record.updated_at,snapshot:record.task.snapshot,review_manifest:record.review_manifest,artifact_ids:record.artifacts.filter(a=>a.content_revision===record.task.snapshot.content_revision).map(a=>a.artifact_id)};
      const byId=new Map([...prior,current].map(entry=>[entry.revision_id,entry]));
      return {current_revision_id:current.revision_id,revisions:[...byId.values()].sort((a,b)=>b.captured_at.localeCompare(a.captured_at)).map(entry=>({revision_id:entry.revision_id,captured_at:entry.captured_at,content_revision:entry.snapshot.content_revision,render_hash:entry.review_manifest?.render_hash,artifact_ids:entry.artifact_ids,current:entry.revision_id===current.revision_id,has_preview:Boolean(entry.review_manifest)}))};
    });
    res.json({...result,owner_id:user.id});
  }));
  router.get('/tasks/:taskId/revisions/:revisionId/preview', route(async(req,res)=>{
    const user=await identity(req), id=taskId(req);
    if(!ID.safeParse(req.params.revisionId).success)throw new ApiError(404,'REVISION_NOT_FOUND');
    const record=await requireStore().read(user.id,state=>findRecord(state.tasks,id,user.id));
    const revision=record.revision_history?.find(entry=>entry.revision_id===req.params.revisionId);
    if(!revision && req.params.revisionId!==record.task.snapshot.snapshot_id)throw new ApiError(404,'REVISION_NOT_FOUND');
    const historical:WorkspaceRecord=revision?{...record,task:{...record.task,snapshot:revision.snapshot},content:revision.content,review_manifest:revision.review_manifest,preview:revision.preview,artifacts:record.artifacts.filter(a=>revision.artifact_ids.includes(a.artifact_id)),actions:[],runs:[],revision_plan:undefined}:record;
    if(!historical.review_manifest)throw new ApiError(404,'PREVIEW_UNAVAILABLE');
    const preview=options.renderPreview?await options.renderPreview(historical):!production?historical.preview:null;
    if(!preview)throw new ApiError(404,'PREVIEW_UNAVAILABLE');
    try{
      const {index_id,...body}=preview.manifest;
      const {index_id:stored,...storedBody}=historical.review_manifest;
      if(buildWorkspaceReviewManifest(body).index_id!==index_id || buildWorkspaceReviewManifest(storedBody).index_id!==stored || index_id!==stored || preview.manifest.task_id!==id || preview.manifest.content_revision!==historical.task.snapshot.content_revision)throw new Error();
    }catch{throw new ApiError(409,'PREVIEW_INTEGRITY_FAILED');}
    res.json({...preview,owner_id:user.id,revision_id:historical.task.snapshot.snapshot_id,historical:historical.task.snapshot.snapshot_id!==record.task.snapshot.snapshot_id});
  }));
  router.get('/tasks/:taskId/recovery',route(async(req,res)=>{
    const user=await identity(req),id=taskId(req);
    const record=await requireStore().read(user.id,state=>findRecord(state.tasks,id,user.id));
    const run=[...(record.runs??[])].reverse().find(run=>run.status==='unknown');
    let canReconcile=false;
    try {canReconcile=Boolean(run&&options.reconcile&&options.recoveryReadiness?.(run.stage));}catch{/* Fail closed. */}
    res.json({owner_id:user.id,status:run?'unknown':'not_required',message:run?(canReconcile?'Đối soát kết quả đã gửi trước khi tiếp tục. Không tự chạy lại.':'Chưa cấu hình bộ đối soát tin cậy; tác vụ được giữ nguyên để tránh chạy trùng.'):'Không có thao tác chưa xác định cần đối soát.',can_reconcile:canReconcile,...(run?{run_id:run.run_id}:{})});
  }));
  router.post('/tasks/:taskId/recovery',route(async(req,res)=>{
    const user=await identity(req,true),id=taskId(req);
    if(!options.reconcile)throw new ApiError(503,'RECONCILIATION_NOT_CONFIGURED');
    const parsed=z.object({run_id:ID,expected_state_version:z.number().int().min(0),idempotency_key:KEY}).strict().safeParse(req.body);
    if(!parsed.success)throw new ApiError(400,'INVALID_RECOVERY_REQUEST');
    const record=await requireStore().read(user.id,state=>findRecord(state.tasks,id,user.id));
    if(!record.runs?.some(run=>run.run_id===parsed.data.run_id))throw new ApiError(404,'RUN_NOT_FOUND');
    // The injected runner journals/deduplicates and validates state before any
    // provider reconciliation. No HTTP caller can assert that a retry is safe.
    const result=await options.reconcile(user.id,id,parsed.data.run_id,{expected_state_version:parsed.data.expected_state_version,idempotency_key:parsed.data.idempotency_key});
    const current=await requireStore().read(user.id,state=>taskView(findRecord(state.tasks,id,user.id)));
    res.json({owner_id:user.id,task:current,result,readiness:readiness()});
  }));
  router.get('/tasks/:taskId/preview', route(async (req, res) => {
    const user = await identity(req); const id = taskId(req);
    const record = await requireStore().read(user.id, state => findRecord(state.tasks, id, user.id));
    if (!record.review_manifest) throw new ApiError(404, 'PREVIEW_UNAVAILABLE');
    // Inline preview persistence is development/test only. Production renders
    // authorized immutable artifact references through an explicitly injected adapter.
    const preview = options.renderPreview ? await options.renderPreview(record) : !production ? record.preview : null;
    if (!preview) throw new ApiError(404, 'PREVIEW_UNAVAILABLE');
    try {
      const { index_id: storedIndex, ...storedBody } = record.review_manifest;
      const { index_id: returnedIndex, ...returnedBody } = preview.manifest;
      if (buildWorkspaceReviewManifest(storedBody).index_id !== storedIndex || buildWorkspaceReviewManifest(returnedBody).index_id !== returnedIndex
        || returnedIndex !== storedIndex || preview.manifest.task_id !== id || preview.manifest.content_revision !== record.task.snapshot.content_revision) throw new Error('mismatch');
    } catch { throw new ApiError(409, 'PREVIEW_SCOPE_MISMATCH'); }
    res.json({...preview,owner_id:user.id});
  }));
  router.get('/tasks/:taskId/artifacts/:artifactId', route(async (req, res) => {
    const user = await identity(req); const id = taskId(req);
    if (!ID.safeParse(req.params.artifactId).success) throw new ApiError(404, 'ARTIFACT_NOT_FOUND');
    if (artifactService) { await streamDownload(res, await artifactService.openArtifact(user.id, id, String(req.params.artifactId), {accessToken:requestToken(req).token})); return; }
    const record = await requireStore().read(user.id, state => findRecord(state.tasks, id, user.id));
    const artifact = record.artifacts.find(item => item.artifact_id === req.params.artifactId);
    if (!artifact) throw new ApiError(404, 'ARTIFACT_NOT_FOUND');
    if (!options.readArtifact || artifact.verification !== 'verified') throw new ApiError(409, 'ARTIFACT_UNAVAILABLE');
    const media = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/zip', 'text/html', 'text/plain', 'application/json']);
    if (!media.has(artifact.media_type) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(artifact.filename) || !Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 1 || artifact.size_bytes > 32 * 1024 * 1024) throw new ApiError(409, 'ARTIFACT_METADATA_INVALID');
    const bytes = await options.readArtifact(record, artifact);
    if (bytes.byteLength !== artifact.size_bytes || hash(bytes) !== artifact.sha256) throw new ApiError(409, 'ARTIFACT_INTEGRITY_FAILED');
    res.set({ 'Content-Type': artifact.media_type, 'Content-Length': String(bytes.byteLength), 'Content-Disposition': `attachment; filename="${artifact.filename}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-SHA256': artifact.sha256 });
    res.send(Buffer.from(bytes));
  }));
  async function streamDownload(res: Response, download: WorkspaceVerifiedDownload) {
    try {
      res.set({ 'Content-Type':download.media_type, 'Content-Length':String(download.size_bytes), 'Content-Disposition':`attachment; filename="${download.filename}"`, 'Content-Security-Policy':"default-src 'none'; sandbox", 'X-Content-SHA256':download.sha256 });
      await pipeline(Readable.from(download.stream), res);
    } finally { await download.dispose(); }
  }
  function requireArtifacts() { if (!artifactService) throw new ApiError(503,'PRIVATE_UPLOAD_NOT_CONFIGURED'); return artifactService; }
  router.post('/tasks/:taskId/uploads', route(async(req,res)=>{
    const user=await identity(req,true), id=taskId(req);
    const result=await requireArtifacts().reserveUpload(user.id,id,req.body);
    res.status(result.duplicate?200:201).json({...result,owner_id:user.id});
  }));
  router.get('/tasks/:taskId/uploads',route(async(req,res)=>{
    const user=await identity(req),id=taskId(req);
    const parsed=KEY.safeParse(req.query.idempotency_key);
    if(!parsed.success||Object.keys(req.query).length!==1)throw new ApiError(400,'INVALID_UPLOAD_LOOKUP');
    res.json({...await requireArtifacts().resolveUpload(user.id,id,parsed.data),owner_id:user.id});
  }));
  router.put('/tasks/:taskId/uploads/:uploadId',route(async(req,res)=>{
    const user=await identity(req,true),id=taskId(req);
    if(!ID.safeParse(req.params.uploadId).success)throw new ApiError(404,'UPLOAD_NOT_FOUND');
    if(req.headers['content-type']!=='application/octet-stream'||req.headers['content-encoding'])throw new ApiError(415,'UPLOAD_BINARY_REQUIRED');
    if(req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>WORKSPACE_ARTIFACT_LIMITS.upload_bytes))throw new ApiError(413,'UPLOAD_TOO_LARGE');
    const result=await requireArtifacts().putUpload(user.id,id,String(req.params.uploadId),req,{accessToken:requestToken(req).token});
    res.json({...result,owner_id:user.id});
  }));
  router.get('/tasks/:taskId/uploads/:uploadId',route(async(req,res)=>{
    const user=await identity(req),id=taskId(req);
    if(!ID.safeParse(req.params.uploadId).success)throw new ApiError(404,'UPLOAD_NOT_FOUND');
    res.json({...await requireArtifacts().getUpload(user.id,id,String(req.params.uploadId)),owner_id:user.id});
  }));
  router.post('/tasks/:taskId/uploads/:uploadId/reconcile',route(async(req,res)=>{
    const user=await identity(req,true),id=taskId(req);
    if(!ID.safeParse(req.params.uploadId).success)throw new ApiError(404,'UPLOAD_NOT_FOUND');
    const result=await requireArtifacts().reconcileUpload(user.id,id,String(req.params.uploadId),{accessToken:requestToken(req).token});
    res.json({...result,owner_id:user.id});
  }));
  router.get('/tasks/:taskId/references/:referenceId',route(async(req,res)=>{
    const user=await identity(req),id=taskId(req);
    if(!ID.safeParse(req.params.referenceId).success)throw new ApiError(404,'REFERENCE_NOT_FOUND');
    await streamDownload(res,await requireArtifacts().openReference(user.id,id,String(req.params.referenceId),{accessToken:requestToken(req).token}));
  }));
  router.delete('/tasks/:taskId/references/:referenceId',route(async(req,res)=>{
    const user=await identity(req,true),id=taskId(req);
    if(!ID.safeParse(req.params.referenceId).success)throw new ApiError(404,'REFERENCE_NOT_FOUND');
    const result=await requireArtifacts().removeReference(user.id,id,String(req.params.referenceId),req.body);
    res.json({...result,owner_id:user.id});
  }));
  router.use((_req, res) => res.status(404).json({ error: { code: 'WORKSPACE_ROUTE_NOT_FOUND', message: 'Workspace route not found.' } }));
  router.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const oversized = (error as { type?: string })?.type === 'entity.too.large';
    res.status(oversized ? 413 : 400).json({ error: { code: oversized ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON', message: 'The request could not be accepted.' } });
  });
  return router;
}
export function registerWorkspaceRoutes(app: Express, options: WorkspaceApiOptions = workspaceOptionsFromEnv()) {
  app.use('/api/workspace', createWorkspaceRouter(options));
}

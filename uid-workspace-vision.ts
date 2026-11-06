import { createHash } from 'node:crypto';
import { workspaceObjectKey, type WorkspacePrivateObjectStore, type WorkspaceObjectIdentity } from './uid-workspace-artifacts.ts';
import { preflightAsset } from './uid-asset-preflight.ts';
import type { WorkspaceOpenAIBudgetReservation, WorkspaceOpenAIReasoning } from './uid-workspace-openai.ts';
import type { WorkspaceProviderBudgetAdapter, WorkspaceProviderBudgetRequest, WorkspaceProviderBudgetReport, WorkspaceProviderAuthorization, WorkspaceProviderUsage } from './uid-workspace-provider-budget.ts';

/** SERVER ONLY. Separate from the existing TEXT ONLY transport. No SDK, global
 * fetch, credential discovery, URL-image fetch, live probe or model fallback.
 * Family is an operator label, not a claim of a public API model ID/entitlement.
 * The exact model, accepted response IDs, current project image capability and
 * processor/data grants MUST be independently verified before injection.
 */
export const WORKSPACE_VISION_ENDPOINT = 'https://api.openai.com/v1/responses' as const;
export type WorkspaceVisionReasoning = WorkspaceOpenAIReasoning;
export type WorkspaceVisionCapability = { verified: true; verification_ref: string; project_id: string; family: 'sol' | 'terra'; model: string;
  api: 'responses'; image_input: true; text_output: true; structured_outputs?: true; accepted_response_models: string[]; checked_at: string; expires_at: string };
export type WorkspaceVisionProviderOutcome = 'completed' | 'known_failure' | 'unknown';
export type WorkspaceVisionRequest = { operation_id: string; instructions: string; input: string;
  response_schema?: { name: string; schema: Record<string, unknown> };
  images: Array<{ ref: string; object: WorkspaceObjectIdentity; detail: 'high' }>;
  reasoning_effort: WorkspaceVisionReasoning; max_output_tokens: number; budget_cap_microusd: number; signal?: AbortSignal };
export type WorkspaceVisionResult = { outcome: 'failed_before_submit' | WorkspaceVisionProviderOutcome; submission: 'not_submitted' | 'submitted'; code: string;
  accounting: 'not_reserved' | 'released' | 'held' | 'settled' | 'pending_reconciliation'; client_request_id?: string; request_sha256?: string; reservation_id?: string;
  provider_request_id?: string; response_id?: string; response_model?: string; http_status?: number; usage?: WorkspaceProviderUsage; budget_receipt_id?: string;
  output?: { text: string; trust: 'untrusted_model_output'; qc_verified: false }; reconciliation_required: boolean };
export type WorkspaceVisionOptions = { serverCredential: { api_key: string; project_id: string }; capability: WorkspaceVisionCapability;
  authorization: WorkspaceProviderAuthorization; budget: WorkspaceProviderBudgetAdapter; fetch: typeof globalThis.fetch; objects: WorkspacePrivateObjectStore;
  /** Current exact-object authorization; authenticated shared server key is never user identity. */
  bindReservation(binding: { reservation_id: string; request_sha256: string }): Promise<void>;
  guardDispatch(): Promise<void>;
  authorizeRaster(authorization: WorkspaceProviderAuthorization, object: WorkspaceObjectIdentity): Promise<boolean>;
  limits?: { request_bytes?: number; response_bytes?: number; max_output_tokens?: number; request_timeout_ms?: number; budget_timeout_ms?: number; max_in_flight?: number; max_operations_per_instance?: number };
  now?: () => number };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const keysOnly = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
/** Small safe schema subset, no remote refs, descriptions or executable code. */
function validSchema(value: unknown, depth = 0): value is Record<string, unknown> {
  if (depth > 12 || !record(value) || !keysOnly(value, ['type','properties','required','additionalProperties','items','enum','minItems','maxItems','minimum','maximum','minLength','maxLength','pattern'])
    || !['object','array','string','integer','number','boolean','null'].includes(value.type as string)) return false;
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length < 1 || value.enum.length > 100 || value.enum.some(v => typeof v !== 'string' && typeof v !== 'boolean' && !Number.isFinite(v)))) return false;
  for (const field of ['minItems','maxItems','minimum','maximum','minLength','maxLength']) if (value[field] !== undefined && !integer(value[field],0,Number.MAX_SAFE_INTEGER)) return false;
  if (value.pattern !== undefined && (typeof value.pattern !== 'string' || value.pattern.length > 500)) return false;
  if (value.type === 'object') return value.additionalProperties === false && record(value.properties) && Object.keys(value.properties).length <= 100
    && Object.entries(value.properties).every(([key,item]) => /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key) && validSchema(item,depth+1))
    && Array.isArray(value.required) && value.required.length === Object.keys(value.properties).length && new Set(value.required).size === value.required.length && value.required.every(key => typeof key === 'string' && Object.hasOwn(value.properties as object,key));
  if (value.type === 'array') return validSchema(value.items,depth+1);
  return value.properties === undefined && value.required === undefined && value.additionalProperties === undefined && value.items === undefined;
}
const efforts = new Set<WorkspaceVisionReasoning>(['low', 'medium', 'high', 'xhigh', 'max']);
const rejectedStatuses = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);
const fault = (code: string) => new Error(code); // Only static codes ever escape this module.
async function bounded<T>(work: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(fault('BUDGET_DEADLINE')), timeout); })]); }
  finally { clearTimeout(timer!); }
}
function numericUsage(value: unknown, secret: string, depth = 0): boolean {
  if (value === null || integer(value, 0, Number.MAX_SAFE_INTEGER)) return true;
  return depth < 5 && record(value) && Object.keys(value).length <= 32 && Object.entries(value).every(([key, item]) =>
    /^[a-z][a-z0-9_]{0,79}$/.test(key) && !key.includes(secret) && numericUsage(item, secret, depth + 1));
}
function usageFrom(value: unknown, secret: string): WorkspaceProviderUsage | undefined {
  if (!record(value) || !numericUsage(value, secret) || !integer(value.input_tokens, 0, Number.MAX_SAFE_INTEGER)
    || !integer(value.output_tokens, 0, Number.MAX_SAFE_INTEGER) || !integer(value.total_tokens, 0, Number.MAX_SAFE_INTEGER)
    || value.input_tokens + value.output_tokens !== value.total_tokens) return;
  for (const [field, subfield, ceiling] of [['input_tokens_details', 'cached_tokens', value.input_tokens], ['output_tokens_details', 'reasoning_tokens', value.output_tokens]] as const) {
    const details = value[field];
    if (details !== undefined && (!record(details) || (details[subfield] !== undefined && !integer(details[subfield], 0, ceiling)))) return;
  }
  for (const field of ['input_tokens_details','output_tokens_details'] as const) {
    const details = value[field]; const ceiling = field === 'input_tokens_details' ? value.input_tokens : value.output_tokens;
    if (record(details) && ([details.text_tokens,details.image_tokens].some(n => n !== undefined && !integer(n,0,ceiling))
      || Number(details.text_tokens ?? 0) + Number(details.image_tokens ?? 0) > ceiling)) return;
  }
  return structuredClone(value) as WorkspaceProviderUsage;
}

export function createWorkspaceVisionTransport(options: WorkspaceVisionOptions) {
  // node:crypto also makes accidental browser bundling fail rather than supplying a
  // browser credential path. No VITE/public credential variable is ever consulted.
  if (typeof window !== 'undefined' || typeof process === 'undefined' || !process.versions?.node) throw fault('SERVER_ONLY_TRANSPORT');
  const secret = options?.serverCredential?.api_key;
  if (typeof secret !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(secret)) throw fault('INVALID_SERVER_CREDENTIAL');
  let capability: WorkspaceVisionCapability; let authorization: WorkspaceProviderAuthorization;
  try { capability = structuredClone(options.capability); authorization = structuredClone(options.authorization); }
  catch { throw fault('INVALID_EXECUTION_ATTESTATION'); }
  const now = options.now ?? Date.now;
  const safeId = (value: unknown): value is string => identifier(value) && !value.includes(secret);
  const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (!record(capability) || capability.verified !== true || !safeId(capability.model) || !['sol','terra'].includes(capability.family) || capability.api !== 'responses' || capability.image_input !== true || capability.text_output !== true
    || !safeId(capability.verification_ref) || !safeId(capability.project_id) || !time(capability.checked_at) || !time(capability.expires_at)
    || Date.parse(capability.checked_at) > now() || Date.parse(capability.expires_at) <= now()
    || !Array.isArray(capability.accepted_response_models) || !capability.accepted_response_models.includes(capability.model)
    || capability.accepted_response_models.length > 8 || capability.accepted_response_models.some(model => typeof model !== 'string' || !safeId(model))
    || !record(authorization) || !(['authorization_id', 'owner_id', 'task_id', 'project_id', 'data_authorization_ref', 'budget_authorization_ref', 'global_budget_authorization_ref', 'user_quota_authorization_ref'] as const).every(key => safeId(authorization[key]))
    || authorization.data_destination !== WORKSPACE_VISION_ENDPOINT || authorization.project_id !== capability.project_id
    || options.serverCredential.project_id !== capability.project_id || !integer(authorization.maximum_request_cost_microusd, 1, Number.MAX_SAFE_INTEGER)
    || !time(authorization.expires_at) || Date.parse(authorization.expires_at) <= now()) throw fault('INVALID_EXECUTION_ATTESTATION');
  if (typeof options.fetch !== 'function' || typeof options.bindReservation !== 'function' || typeof options.guardDispatch !== 'function' || typeof options.authorizeRaster !== 'function' || typeof options.objects?.open !== 'function' || !options.budget || (['reserve', 'markSubmissionIntent', 'reconcile', 'releaseBeforeSubmit'] as const).some(key => typeof options.budget[key] !== 'function')) throw fault('MISSING_TRUSTED_ADAPTER');
  const transport = options.fetch;
  const budget = {
    reserve: options.budget.reserve.bind(options.budget), markSubmissionIntent: options.budget.markSubmissionIntent.bind(options.budget),
    reconcile: options.budget.reconcile.bind(options.budget), releaseBeforeSubmit: options.budget.releaseBeforeSubmit.bind(options.budget),
  };
  const limits = { request_bytes: 96 * 1024 * 1024, response_bytes: 2 * 1024 * 1024, max_output_tokens: 16_384,
    request_timeout_ms: 45_000, budget_timeout_ms: 5_000, max_in_flight: 4, max_operations_per_instance: 10_000, ...options.limits };
  const maximum = { request_bytes: 128 * 1024 * 1024, response_bytes: 8 * 1024 * 1024, max_output_tokens: 32_768,
    request_timeout_ms: 120_000, budget_timeout_ms: 30_000, max_in_flight: 16, max_operations_per_instance: 100_000 };
  if (!keysOnly(limits, Object.keys(maximum)) || Object.entries(limits).some(([key, value]) => !integer(value, 1, maximum[key as keyof typeof maximum]))) throw fault('INVALID_TRANSPORT_LIMITS');
  const attempts = new Map<string, string>(); let inFlight = 0; let preparing = 0;
  const pre = (code: string): WorkspaceVisionResult => ({ outcome: 'failed_before_submit', submission: 'not_submitted', code, accounting: 'not_reserved', reconciliation_required: false });

  async function submit(request: WorkspaceVisionRequest): Promise<WorkspaceVisionResult> {
    if (!record(request) || !keysOnly(request, ['operation_id', 'instructions', 'input', 'reasoning_effort', 'max_output_tokens', 'budget_cap_microusd', 'images', 'response_schema', 'signal'])
      || !safeId(request.operation_id) || typeof request.instructions !== 'string' || !request.instructions.trim() || typeof request.input !== 'string' || !request.input.trim()
      || bytes(request.instructions) + bytes(request.input) > limits.request_bytes || request.input.includes(secret) || request.instructions.includes(secret)
      || !efforts.has(request.reasoning_effort) || !integer(request.max_output_tokens, 1, limits.max_output_tokens)
      || !integer(request.budget_cap_microusd, 1, authorization.maximum_request_cost_microusd)
      || !Array.isArray(request.images) || request.images.length < 1 || request.images.length > 96 || bytes(request.input) + bytes(request.instructions) > 1024 * 1024
      || (request.signal !== undefined && !(request.signal instanceof AbortSignal))) return pre('INVALID_REQUEST');
    if (request.response_schema !== undefined && (!record(request.response_schema) || !keysOnly(request.response_schema,['name','schema']) || !safeId(request.response_schema.name)
      || capability.structured_outputs !== true || !validSchema(request.response_schema.schema) || bytes(JSON.stringify(request.response_schema)) > 32 * 1024)) return pre('STRICT_SCHEMA_NOT_AUTHORIZED');
    // Snapshot all caller data before the first await. Mutation cannot change the
    // payload, authorization, budget amount, operation ID or parsing contract.
    const signal = request.signal;
    try { request = { ...structuredClone({ ...request, signal: undefined }), signal }; } catch { return pre('INVALID_REQUEST'); }
    const operationId = request.operation_id; const expectJSON = true;
    if (signal?.aborted) return pre('CANCELLED_BEFORE_SUBMIT');
    if (Date.parse(authorization.expires_at) <= now() || Date.parse(capability.expires_at) <= now()) return pre('AUTHORIZATION_EXPIRED');
    if (preparing + inFlight >= limits.max_in_flight || attempts.size >= limits.max_operations_per_instance) return pre('LOCAL_CAPACITY_EXCEEDED');
    preparing++;
    const inputImages: WorkspaceProviderBudgetRequest['input_images'] = [];
    const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: request.input }];
    let totalImageBytes = 0;
    try {
      const refs = new Set<string>();
      for (const image of request.images) {
        if (!record(image) || !keysOnly(image, ['ref', 'object', 'detail']) || !safeId(image.ref) || refs.has(image.ref) || image.detail !== 'high' || !record(image.object)) throw fault('INVALID_PRIVATE_RASTER');
        refs.add(image.ref);
        const object = image.object;
        if (!keysOnly(object, ['owner_id','task_id','storage_key','sha256','size_bytes','media_type']) || object.owner_id !== authorization.owner_id || object.task_id !== authorization.task_id
          || !/^[a-f0-9]{64}$/.test(object.sha256) || !integer(object.size_bytes, 1, 32 * 1024 * 1024) || !['image/png','image/jpeg','image/webp'].includes(object.media_type)
          || object.storage_key !== workspaceObjectKey(authorization.owner_id, authorization.task_id, object.sha256)) throw fault('INVALID_PRIVATE_RASTER');
        totalImageBytes += object.size_bytes; if (totalImageBytes > 64 * 1024 * 1024) throw fault('RASTER_INPUT_TOO_LARGE');
        if (signal?.aborted || !await bounded(options.authorizeRaster(structuredClone(authorization), structuredClone(object)), limits.budget_timeout_ms)) throw fault('RASTER_DATA_NOT_AUTHORIZED');
        const opened = await bounded(options.objects.open(object), limits.request_timeout_ms); if (!opened) throw fault('PRIVATE_RASTER_MISSING');
        let value: Buffer;
        try {
          value = await bounded((async () => { const chunks: Buffer[] = []; let size = 0;
            for await (const chunk of opened.stream) { if (signal?.aborted || !(chunk instanceof Uint8Array)) throw fault('RASTER_READ_CANCELLED'); size += chunk.length; if (size > object.size_bytes) throw fault('RASTER_INTEGRITY'); chunks.push(Buffer.from(chunk)); }
            const data = Buffer.concat(chunks); if (data.length !== object.size_bytes || createHash('sha256').update(data).digest('hex') !== object.sha256) throw fault('RASTER_INTEGRITY'); return data;
          })(), limits.request_timeout_ms);
        } finally { await bounded(opened.dispose(), limits.budget_timeout_ms); }
        const decoded = await bounded(preflightAsset(value, { expected_sha256: object.sha256 }), limits.request_timeout_ms);
        if ('image/' + decoded.format !== object.media_type) throw fault('RASTER_FULL_DECODE_FAILED');
        inputImages.push({ sha256: object.sha256, bytes: value.length, mime_type: object.media_type as 'image/png'|'image/jpeg'|'image/webp', width: decoded.width, height: decoded.height });
        content.push({ type: 'input_text', text: 'Evidence reference: ' + image.ref }, { type: 'input_image', image_url: `data:${object.media_type};base64,${value.toString('base64')}`, detail: 'high' });
      }
    } catch { return pre('PRIVATE_RASTER_UNVERIFIED'); } finally { preparing--; }
    if (signal?.aborted) return pre('CANCELLED_BEFORE_SUBMIT');
    const body = JSON.stringify({ model: capability.model, instructions: request.instructions, input: [{ role: 'user', content }],
      reasoning: { effort: request.reasoning_effort }, max_output_tokens: request.max_output_tokens,
      text: { format: request.response_schema ? { type: 'json_schema', name: request.response_schema.name, schema: request.response_schema.schema, strict: true } : { type: 'json_object' } }, store: false, stream: false });
    if (bytes(body) > limits.request_bytes) return pre('REQUEST_TOO_LARGE');
    const fingerprint = sha(body);
    // Correlation is stable across process restarts and is not a promise that the
    // Responses endpoint deduplicates paid submissions. The durable budget fence
    // and runner reconciliation are mandatory even with Idempotency-Key present.
    const clientId = 'uid-' + sha(JSON.stringify([capability.project_id, authorization.owner_id, authorization.task_id, operationId]));
    const common = { client_request_id: clientId, request_sha256: fingerprint };
    if (attempts.has(operationId)) return { ...pre(attempts.get(operationId) === fingerprint ? 'OPERATION_ALREADY_ATTEMPTED' : 'OPERATION_ID_CONFLICT'), ...common, reconciliation_required: true };
    if (attempts.size >= limits.max_operations_per_instance || inFlight >= limits.max_in_flight) return { ...pre('LOCAL_CAPACITY_EXCEEDED'), ...common };
    attempts.set(operationId, fingerprint); inFlight++;
    const budgetRequest: WorkspaceProviderBudgetRequest = {
      authorization_id: authorization.authorization_id, owner_id: authorization.owner_id, task_id: authorization.task_id, project_id: capability.project_id,
      operation_id: operationId, request_sha256: fingerprint, client_request_id: clientId, model: capability.model,
      modality: 'responses_vision', endpoint: WORKSPACE_VISION_ENDPOINT, input_images: inputImages, data_authorization_ref: authorization.data_authorization_ref,
      maximum_cost_microusd: request.budget_cap_microusd, request_bytes: bytes(body), input_utf8_bytes: bytes(request.input) + bytes(request.instructions),
      max_output_tokens: request.max_output_tokens,
      budget_authorization_ref: authorization.budget_authorization_ref, global_budget_authorization_ref: authorization.global_budget_authorization_ref,
      user_quota_authorization_ref: authorization.user_quota_authorization_ref, capability_verification_ref: capability.verification_ref,
    };
    let reservationId: string | undefined;
    try {
      let reservation: WorkspaceOpenAIBudgetReservation;
      try { reservation = await bounded(budget.reserve(structuredClone(budgetRequest)), limits.budget_timeout_ms); }
      catch { return { ...pre('BUDGET_RESERVATION_UNCONFIRMED'), ...common, accounting: 'pending_reconciliation', reconciliation_required: true }; }
      if (!record(reservation)) return { ...pre('INVALID_BUDGET_RESERVATION'), ...common, accounting: 'pending_reconciliation', reconciliation_required: true };
      if (reservation.status !== 'reserved') {
        const uncertain = reservation.status !== 'denied';
        return { ...pre(reservation.status === 'denied' ? 'BUDGET_DENIED' : 'BUDGET_OPERATION_NOT_NEW'), ...common,
          accounting: uncertain ? 'pending_reconciliation' : 'not_reserved', reconciliation_required: uncertain };
      }
      if (!safeId(reservation.reservation_id) || reservation.reserved_microusd !== budgetRequest.maximum_cost_microusd
        || reservation.request_sha256 !== fingerprint || reservation.cost_ceiling_verified !== true || !safeId(reservation.pricing_evidence_ref)) {
        return { ...pre('INVALID_BUDGET_RESERVATION'), ...common, accounting: 'pending_reconciliation', reconciliation_required: true };
      }
      reservationId = reservation.reservation_id;
      const reserved = { ...common, reservation_id: reservationId };
      async function stopBeforeSubmit(code: string): Promise<WorkspaceVisionResult> {
        let released = false;
        try { released = (await bounded(budget.releaseBeforeSubmit({ reservation_id: reservationId!, operation_id: operationId, request_sha256: fingerprint }), limits.budget_timeout_ms))?.released === true; } catch { /* Keep reservation; never fabricate zero spend. */ }
        return { ...pre(code), ...reserved, accounting: released ? 'released' : 'pending_reconciliation', reconciliation_required: !released };
      }
      try { await bounded(options.bindReservation({ reservation_id: reservationId, request_sha256: fingerprint }), limits.budget_timeout_ms); } catch { return await stopBeforeSubmit('RUN_RESERVATION_BINDING_FAILED'); }
      if (signal?.aborted) return await stopBeforeSubmit('CANCELLED_BEFORE_SUBMIT');
      if (Date.parse(authorization.expires_at) <= now() || Date.parse(capability.expires_at) <= now()) return await stopBeforeSubmit('AUTHORIZATION_EXPIRED');
      let intent: { ok: boolean };
      try { intent = await bounded(budget.markSubmissionIntent({ ...structuredClone(budgetRequest), reservation_id: reservationId }), limits.budget_timeout_ms); }
      catch { return { ...pre('SUBMISSION_INTENT_UNCONFIRMED'), ...reserved, accounting: 'pending_reconciliation', reconciliation_required: true }; }
      if (intent?.ok !== true) return { ...pre('SUBMISSION_INTENT_REJECTED'), ...reserved, accounting: 'held', reconciliation_required: true };
      if (signal?.aborted) return await stopBeforeSubmit('CANCELLED_BEFORE_SUBMIT');
      if (Date.parse(authorization.expires_at) <= now() || Date.parse(capability.expires_at) <= now()) return await stopBeforeSubmit('AUTHORIZATION_EXPIRED');

      try { await bounded(options.guardDispatch(), limits.budget_timeout_ms); } catch { return await stopBeforeSubmit('RUN_DISPATCH_NOT_AUTHORIZED'); }
      if (signal?.aborted || Date.parse(authorization.expires_at) <= now() || Date.parse(capability.expires_at) <= now()) return await stopBeforeSubmit('AUTHORIZATION_EXPIRED_OR_CANCELLED');

      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let bodyStream: ReadableStream<Uint8Array> | null | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;
      let failureCode = 'PROVIDER_TRANSPORT_UNKNOWN';
      let providerRequestId: string | undefined; let httpStatus: number | undefined;
      const received: WorkspaceVisionResult = { ...reserved, outcome: 'unknown', submission: 'submitted', code: failureCode, accounting: 'held', reconciliation_required: true };
      try {
        const data = await Promise.race([
          (async () => {
            const response = await transport(WORKSPACE_VISION_ENDPOINT, {
              method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
              headers: { Authorization: `Bearer ${secret}`, 'OpenAI-Project': capability.project_id, 'Content-Type': 'application/json', Accept: 'application/json',
                'X-Client-Request-Id': clientId, 'Idempotency-Key': clientId }, body,
            });
            if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw fault('PROVIDER_DEADLINE'); }
            bodyStream = response.body;
            if (response.redirected || (response.url && response.url !== WORKSPACE_VISION_ENDPOINT)) throw fault('INVALID_RESPONSE_ORIGIN');
            if (!integer(response.status, 100, 599)) throw fault('INVALID_RESPONSE_STATUS');
            httpStatus = response.status;
            const requestId = response.headers.get('x-request-id');
            if (safeId(requestId)) providerRequestId = requestId;
            const declared = response.headers.get('content-length');
            if (declared && (!/^\d+$/.test(declared) || !integer(Number(declared), 0, limits.response_bytes))) throw fault('RESPONSE_TOO_LARGE');
            const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
            if (mime !== 'application/json' || !response.body) throw fault('INVALID_RESPONSE_BODY');
            reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
            let size = 0; let text = '';
            for (;;) {
              if (controller.signal.aborted) throw fault('PROVIDER_DEADLINE');
              const part = await reader.read(); if (part.done) break;
              if (!(part.value instanceof Uint8Array)) throw fault('INVALID_RESPONSE_BODY');
              size += part.value.byteLength; if (size > limits.response_bytes) throw fault('RESPONSE_TOO_LARGE');
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
            return JSON.parse(text) as unknown;
          })(),
          new Promise<never>((_, reject) => {
            const stop = (code: string) => { failureCode = code; controller.abort(); void reader?.cancel().catch(() => {}); reject(fault(code)); };
            timer = setTimeout(() => stop('PROVIDER_TIMEOUT_UNKNOWN'), limits.request_timeout_ms);
            abortListener = () => stop('PROVIDER_CANCELLED_UNKNOWN');
            signal?.addEventListener('abort', abortListener, { once: true });
            if (signal?.aborted) abortListener();
          }),
        ]);
        if (record(data) && data.object === 'response' && safeId(data.id) && typeof data.model === 'string' && capability.accepted_response_models.includes(data.model)) {
          received.response_id = data.id; received.response_model = data.model;
          const usage = usageFrom(data.usage, secret); if (usage) received.usage = usage;
          if (data.status === 'failed' || data.status === 'incomplete' || data.status === 'cancelled') {
            received.outcome = 'known_failure'; received.code = 'PROVIDER_OUTPUT_NOT_COMPLETE';
          } else if (data.status === 'completed' && data.error == null && data.incomplete_details == null && httpStatus === 200 && usage) {
            const text = completeText(data.output, secret);
            let valid = text !== undefined;
            if (valid && expectJSON) { try { valid = record(JSON.parse(text!)); } catch { valid = false; } }
            if (valid) {
              received.outcome = 'completed'; received.code = 'COMPLETED_UNTRUSTED';
              received.output = { text: text!, trust: 'untrusted_model_output', qc_verified: false };
            } else { received.outcome = 'known_failure'; received.code = 'INVALID_MODEL_OUTPUT'; }
          } else received.code = 'PROVIDER_RESPONSE_REQUIRES_RECONCILIATION';
        } else received.code = 'INVALID_PROVIDER_RESPONSE';
      } catch { received.code = failureCode; /* Never reflect exceptions, error bodies, URLs or secrets. */ }
      finally {
        clearTimeout(timer); if (abortListener) signal?.removeEventListener('abort', abortListener);
        controller.abort();
        if (reader) void reader.cancel().catch(() => {});
        else void bodyStream?.cancel().catch(() => {});
      }
      if (providerRequestId) received.provider_request_id = providerRequestId;
      if (httpStatus !== undefined) received.http_status = httpStatus;
      if (httpStatus !== undefined && rejectedStatuses.has(httpStatus)) {
        received.outcome = 'known_failure'; received.code = 'PROVIDER_REQUEST_REJECTED'; delete received.output;
      }
      const report: WorkspaceProviderBudgetReport = { reservation_id: reservationId, operation_id: operationId, request_sha256: fingerprint, client_request_id: clientId,
        outcome: received.outcome as WorkspaceVisionProviderOutcome,
        ...(received.provider_request_id ? { provider_request_id: received.provider_request_id } : {}), ...(received.response_id ? { response_id: received.response_id } : {}),
        ...(received.response_model ? { response_model: received.response_model } : {}), ...(httpStatus !== undefined ? { http_status: httpStatus } : {}),
        ...(received.usage ? { usage: structuredClone(received.usage) } : {}) };
      try {
        const receipt = await bounded(budget.reconcile(report), limits.budget_timeout_ms);
        if (receipt && safeId(receipt.receipt_id) && (receipt.status === 'held' || (receipt.status === 'settled' && received.usage))) {
          received.accounting = receipt.status; received.budget_receipt_id = receipt.receipt_id;
        } else received.accounting = 'pending_reconciliation';
      } catch { received.accounting = 'pending_reconciliation'; }
      received.reconciliation_required = received.outcome === 'unknown' || received.accounting !== 'settled';
      return received;
    } finally { inFlight--; }
  }
  return Object.freeze({ submit });
}

function completeText(output: unknown, secret: string): string | undefined {
  if (!Array.isArray(output) || output.length < 1 || output.length > 64) return;
  const texts: string[] = []; let messages = 0;
  for (const item of output) {
    if (!record(item)) return;
    if (item.type === 'reasoning') {
      if (!identifier(item.id) || !Array.isArray(item.summary) || (item.status != null && item.status !== 'completed')) return;
      continue; // Do not expose reasoning or treat it as evidence.
    }
    if (item.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed' || !identifier(item.id)
      || !Array.isArray(item.content) || item.content.length < 1 || item.content.length > 64) return;
    messages++;
    for (const part of item.content) {
      if (!record(part) || part.type !== 'output_text' || typeof part.text !== 'string' || !part.text.trim() || part.text.includes(secret)) return;
      texts.push(part.text);
    }
  }
  // Multiple assistant messages could represent a partial/tool-mediated workflow.
  // This deliberately small transport supports one final text answer only.
  return messages === 1 ? texts.join('') : undefined;
}

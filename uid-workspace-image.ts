import { createHash } from 'node:crypto';
import { workspaceProviderUsage, type WorkspaceProviderAuthorization, type WorkspaceProviderBudgetAdapter, type WorkspaceProviderBudgetReport, type WorkspaceProviderBudgetRequest, type WorkspaceProviderUsage } from './uid-workspace-provider-budget.ts';

/** Server only. No credential discovery, environment mutation, live probes,
 * provider fallback, blind retry, or implicit authority to spend. */
export const WORKSPACE_IMAGE_MODEL = 'gpt-image-2.5-flare' as const;
export const WORKSPACE_IMAGE_GENERATE_ENDPOINT = 'https://api.openai.com/v1/images/generations' as const;
export const WORKSPACE_IMAGE_EDIT_ENDPOINT = 'https://api.openai.com/v1/images/edits' as const;
export type WorkspaceImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type WorkspaceImageDecode = (bytes: Uint8Array, mime: WorkspaceImageMime) => Promise<{ width: number; height: number; frames: 1; fully_decoded: true }>;
export type WorkspaceImageCapability = {
  verified: true; verification_ref: string; project_id: string; model: typeof WORKSPACE_IMAGE_MODEL; api: 'images';
  checked_at: string; expires_at: string; operations: Array<'generate' | 'edit'>;
  accepted_response_models: string[];
  sizes: string[]; qualities: Array<'low' | 'medium' | 'high'>; output_formats: Array<'png' | 'jpeg' | 'webp'>;
};
export type WorkspaceImageSource = { bytes: Uint8Array; sha256: string; mime_type: WorkspaceImageMime; width: number; height: number };
export type WorkspaceImageRequest = {
  operation_id: string; operation: 'generate' | 'edit'; model: typeof WORKSPACE_IMAGE_MODEL;
  prompt: string; n: 1; quality: 'low' | 'medium' | 'high'; size: string; output_format: 'png' | 'jpeg' | 'webp';
  /** Exact actual private source bytes, in order. Never a remote URL or model description. */
  source_images: WorkspaceImageSource[]; budget_cap_microusd: number; signal?: AbortSignal;
};
export type WorkspaceImageResult = {
  outcome: 'failed_before_submit' | 'completed' | 'known_failure' | 'unknown'; submission: 'not_submitted' | 'submitted'; code: string;
  accounting: 'not_reserved' | 'released' | 'held' | 'settled' | 'pending_reconciliation'; reconciliation_required: boolean;
  client_request_id?: string; request_sha256?: string; reservation_id?: string; provider_request_id?: string;
  response_model?: string; http_status?: number; usage?: WorkspaceProviderUsage; budget_receipt_id?: string;
  output?: { bytes: Uint8Array; sha256: string; mime_type: WorkspaceImageMime; width: number; height: number; trust: 'untrusted_model_output'; qc_verified: false };
};
export type WorkspaceImageOptions = {
  serverCredential: { api_key: string; project_id: string }; capability: WorkspaceImageCapability;
  authorization: WorkspaceProviderAuthorization; budget: WorkspaceProviderBudgetAdapter; fetch: typeof globalThis.fetch;
  /** Trusted full raster decode, never metadata-only sniffing. */
  decodeImage: WorkspaceImageDecode;
  /** Bind this reservation to the durable parent child-operation before intent. */
  bindReservation: (binding: { reservation_id: string; request_sha256: string }) => Promise<void>;
  /** Recheck current member, action, lease, cancellation and operation after intent. */
  guardDispatch: () => Promise<void>;
  limits?: { prompt_bytes?: number; request_bytes?: number; source_bytes?: number; response_bytes?: number; output_bytes?: number;
    image_pixels?: number; source_images?: number; request_timeout_ms?: number; adapter_timeout_ms?: number; max_in_flight?: number; max_operations_per_instance?: number };
  now?: () => number;
};
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const int = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(k => allowed.includes(k));
const error = (code: string) => new Error(code);
const validSize = (size: unknown): size is string => {
  if (typeof size !== 'string' || !/^\d{2,4}x\d{2,4}$/.test(size)) return false;
  const [w, h] = size.split('x').map(Number);
  // Deliberately conservative subset of documented GPT Image 2.5 resolutions.
  return w >= 256 && h >= 256 && w <= 2560 && h <= 2560 && w * h <= 2560 * 1440 && w % 16 === 0 && h % 16 === 0 && w / h >= 1 / 3 && w / h <= 3;
};
async function bounded<T>(work: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(error('ADAPTER_TIMEOUT')), timeout); })]); }
  finally { clearTimeout(timer!); }
}
function sniff(bytes: Uint8Array): WorkspaceImageMime | undefined {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg'
    : b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : undefined;
}
/** Optional real decoder loaded only by an explicitly enabled server composition.
 * Stats traverses decoded pixels. No resampling, metadata-only acceptance or writes. */
export async function decodeWorkspaceImage(bytes: Uint8Array, mime: WorkspaceImageMime): ReturnType<WorkspaceImageDecode> {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.byteLength > 16 * 1024 * 1024 || sniff(bytes) !== mime) throw error('INVALID_RASTER_BYTES');
  const { default: sharp } = await import('./tools/creative-quality/sharp.ts');
  const image = sharp(Buffer.from(bytes), { limitInputPixels: 16_000_000, failOn: 'warning', sequentialRead: true });
  const metadata = await image.metadata();
  if (metadata.format !== mime.split('/')[1] || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 || metadata.width * metadata.height > 16_000_000) throw error('INVALID_RASTER_DECODE');
  await image.stats();
  const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  return { width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height, frames: 1, fully_decoded: true };
}
export function createWorkspaceImageTransport(options: WorkspaceImageOptions) {
  if (typeof window !== 'undefined' || typeof process === 'undefined' || !process.versions?.node) throw error('SERVER_ONLY_TRANSPORT');
  const secret = options?.serverCredential?.api_key;
  if (typeof secret !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(secret)) throw error('INVALID_SERVER_CREDENTIAL');
  let capability: WorkspaceImageCapability, authorization: WorkspaceProviderAuthorization;
  try { capability = structuredClone(options.capability); authorization = structuredClone(options.authorization); } catch { throw error('INVALID_EXECUTION_ATTESTATION'); }
  const now = options.now ?? Date.now, safeId = (value: unknown): value is string => id(value) && !value.includes(secret);
  const current = () => Date.parse(capability.checked_at) <= now() && Date.parse(capability.expires_at) > now() && Date.parse(authorization.expires_at) > now();
  if (!record(capability) || capability.verified !== true || capability.model !== WORKSPACE_IMAGE_MODEL || capability.api !== 'images' || !safeId(capability.verification_ref) || !safeId(capability.project_id)
    || !Array.isArray(capability.operations) || !capability.operations.length || capability.operations.length > 2 || capability.operations.some(v => !['generate', 'edit'].includes(v))
    || !Array.isArray(capability.accepted_response_models) || !capability.accepted_response_models.includes(WORKSPACE_IMAGE_MODEL) || capability.accepted_response_models.length > 8 || capability.accepted_response_models.some(v => !/^gpt-image-2\.5-flare(?:-\d{4}-\d{2}-\d{2})?$/.test(v))
    || !Array.isArray(capability.sizes) || !capability.sizes.length || capability.sizes.length > 32 || !capability.sizes.every(validSize)
    || !Array.isArray(capability.qualities) || !capability.qualities.length || capability.qualities.length > 3 || capability.qualities.some(v => !['low', 'medium', 'high'].includes(v))
    || !Array.isArray(capability.output_formats) || !capability.output_formats.length || capability.output_formats.length > 3 || capability.output_formats.some(v => !['png', 'jpeg', 'webp'].includes(v))
    || !record(authorization) || !(['authorization_id', 'owner_id', 'task_id', 'project_id', 'data_authorization_ref', 'budget_authorization_ref', 'global_budget_authorization_ref', 'user_quota_authorization_ref'] as const).every(k => safeId(authorization[k]))
    || ![WORKSPACE_IMAGE_GENERATE_ENDPOINT, WORKSPACE_IMAGE_EDIT_ENDPOINT].includes(authorization.data_destination as typeof WORKSPACE_IMAGE_GENERATE_ENDPOINT)
    || authorization.project_id !== capability.project_id || options.serverCredential.project_id !== capability.project_id || !int(authorization.maximum_request_cost_microusd, 1) || !current()) throw error('INVALID_EXECUTION_ATTESTATION');
  if (!options.budget || (['reserve', 'markSubmissionIntent', 'reconcile', 'releaseBeforeSubmit'] as const).some(k => typeof options.budget[k] !== 'function')
    || (['fetch', 'decodeImage', 'bindReservation', 'guardDispatch'] as const).some(k => typeof options[k] !== 'function')) throw error('MISSING_TRUSTED_ADAPTER');
  const budget = { reserve: options.budget.reserve.bind(options.budget), markSubmissionIntent: options.budget.markSubmissionIntent.bind(options.budget), reconcile: options.budget.reconcile.bind(options.budget), releaseBeforeSubmit: options.budget.releaseBeforeSubmit.bind(options.budget) };
  const transport = options.fetch, decode = options.decodeImage, bind = options.bindReservation, guard = options.guardDispatch;
  const limits = { prompt_bytes: 32_000, request_bytes: 24 * 1024 * 1024, source_bytes: 8 * 1024 * 1024, response_bytes: 24 * 1024 * 1024, output_bytes: 16 * 1024 * 1024,
    image_pixels: 16_000_000, source_images: 4, request_timeout_ms: 120_000, adapter_timeout_ms: 10_000, max_in_flight: 2, max_operations_per_instance: 10_000, ...options.limits };
  const maximum = { prompt_bytes: 32_000, request_bytes: 48 * 1024 * 1024, source_bytes: 16 * 1024 * 1024, response_bytes: 32 * 1024 * 1024, output_bytes: 16 * 1024 * 1024,
    image_pixels: 16_000_000, source_images: 16, request_timeout_ms: 300_000, adapter_timeout_ms: 30_000, max_in_flight: 4, max_operations_per_instance: 100_000 };
  if (!keys(limits, Object.keys(maximum)) || Object.entries(limits).some(([k, v]) => !int(v, 1, maximum[k as keyof typeof maximum]))) throw error('INVALID_TRANSPORT_LIMITS');
  const attempts = new Map<string, string>(); let inFlight = 0;
  const pre = (code: string): WorkspaceImageResult => ({ outcome: 'failed_before_submit', submission: 'not_submitted', code, accounting: 'not_reserved', reconciliation_required: false });
  async function submit(input: WorkspaceImageRequest): Promise<WorkspaceImageResult> {
    if (!record(input) || !keys(input, ['operation_id', 'operation', 'model', 'prompt', 'n', 'quality', 'size', 'output_format', 'source_images', 'budget_cap_microusd', 'signal'])
      || !safeId(input.operation_id) || !capability.operations.includes(input.operation) || input.model !== capability.model || input.n !== 1 || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.includes(secret) || Buffer.byteLength(input.prompt) > limits.prompt_bytes
      || !capability.qualities.includes(input.quality) || !capability.sizes.includes(input.size) || !capability.output_formats.includes(input.output_format) || !int(input.budget_cap_microusd, 1, authorization.maximum_request_cost_microusd)
      || !Array.isArray(input.source_images) || input.source_images.length > limits.source_images || (input.operation === 'generate' ? input.source_images.length !== 0 : !input.source_images.length)
      || (input.signal !== undefined && !(input.signal instanceof AbortSignal))) return pre('INVALID_IMAGE_REQUEST');
    const endpoint = input.operation === 'generate' ? WORKSPACE_IMAGE_GENERATE_ENDPOINT : WORKSPACE_IMAGE_EDIT_ENDPOINT;
    if (authorization.data_destination !== endpoint) return pre('IMAGE_DESTINATION_NOT_AUTHORIZED');
    if (input.signal?.aborted) return pre('CANCELLED_BEFORE_SUBMIT');
    if (!current()) return pre('AUTHORIZATION_EXPIRED');
    // Snapshot bytes and every caller field before the first await.
    let sources: WorkspaceImageSource[];
    try {
      let total = 0;
      sources = input.source_images.map(s => {
        if (!record(s) || !keys(s, ['bytes', 'sha256', 'mime_type', 'width', 'height']) || !(s.bytes instanceof Uint8Array) || !int(s.bytes.byteLength, 1, limits.source_bytes)
          || !validHash(s.sha256) || !int(s.width, 1) || !int(s.height, 1) || s.width * s.height > limits.image_pixels || sniff(s.bytes) !== s.mime_type) throw error('INVALID_SOURCE_IMAGE');
        total += s.bytes.byteLength; if (total > limits.source_bytes) throw error('SOURCE_IMAGES_TOO_LARGE');
        const bytes = Uint8Array.from(s.bytes); if (hash(bytes) !== s.sha256 || Buffer.from(bytes).includes(Buffer.from(secret))) throw error('SOURCE_IMAGE_INTEGRITY_FAILED');
        return { bytes, sha256: s.sha256, mime_type: s.mime_type, width: s.width, height: s.height };
      });
    } catch { return pre('INVALID_SOURCE_IMAGES'); }
    const request = { operation_id: input.operation_id, operation: input.operation, model: input.model, prompt: input.prompt, n: input.n, quality: input.quality, size: input.size, output_format: input.output_format, budget_cap_microusd: input.budget_cap_microusd };
    const signal = input.signal;
    const body = JSON.stringify({ model: request.model, prompt: request.prompt, n: 1, quality: request.quality, size: request.size, output_format: request.output_format, stream: false,
      ...(request.operation === 'edit' ? { images: sources.map(s => ({ image_url: `data:${s.mime_type};base64,${Buffer.from(s.bytes).toString('base64')}` })) } : {}) });
    if (Buffer.byteLength(body) > limits.request_bytes) return pre('REQUEST_TOO_LARGE');
    const fingerprint = hash(body), clientId = 'uid-' + hash(JSON.stringify([capability.project_id, authorization.owner_id, authorization.task_id, request.operation_id]));
    const common = { request_sha256: fingerprint, client_request_id: clientId };
    if (attempts.has(request.operation_id)) return { ...pre(attempts.get(request.operation_id) === fingerprint ? 'OPERATION_ALREADY_ATTEMPTED' : 'OPERATION_ID_CONFLICT'), ...common, reconciliation_required: true };
    if (inFlight >= limits.max_in_flight || attempts.size >= limits.max_operations_per_instance) return { ...pre('LOCAL_CAPACITY_EXCEEDED'), ...common };
    attempts.set(request.operation_id, fingerprint); inFlight++;
    try {
      try {
        for (const source of sources) {
          const decoded = await bounded(decode(Uint8Array.from(source.bytes), source.mime_type), limits.adapter_timeout_ms);
          if (!decoded || decoded.fully_decoded !== true || decoded.frames !== 1 || decoded.width !== source.width || decoded.height !== source.height) return { ...pre('SOURCE_DECODE_MISMATCH'), ...common };
        }
      } catch { return { ...pre('SOURCE_DECODE_FAILED'), ...common }; }
      if (signal?.aborted || !current()) return { ...pre(signal?.aborted ? 'CANCELLED_BEFORE_SUBMIT' : 'AUTHORIZATION_EXPIRED'), ...common };
      const budgetRequest: WorkspaceProviderBudgetRequest = { authorization_id: authorization.authorization_id, owner_id: authorization.owner_id, task_id: authorization.task_id, project_id: capability.project_id,
        operation_id: request.operation_id, ...common, modality: 'images', endpoint, model: request.model, maximum_cost_microusd: request.budget_cap_microusd, request_bytes: Buffer.byteLength(body), input_utf8_bytes: Buffer.byteLength(request.prompt),
        input_images: sources.map(({ bytes, ...s }) => ({ ...s, bytes: bytes.byteLength })), image_options: { operation: request.operation, n: 1, quality: request.quality, size: request.size, output_format: request.output_format },
        budget_authorization_ref: authorization.budget_authorization_ref, global_budget_authorization_ref: authorization.global_budget_authorization_ref, user_quota_authorization_ref: authorization.user_quota_authorization_ref,
        data_authorization_ref: authorization.data_authorization_ref, capability_verification_ref: capability.verification_ref };
      let reservation;
      try { reservation = await bounded(budget.reserve(structuredClone(budgetRequest)), limits.adapter_timeout_ms); }
      catch { return { ...pre('BUDGET_RESERVATION_UNCONFIRMED'), ...common, accounting: 'pending_reconciliation', reconciliation_required: true }; }
      if (!record(reservation)) return { ...pre('INVALID_BUDGET_RESERVATION'), ...common, accounting: 'pending_reconciliation', reconciliation_required: true };
      if (reservation.status !== 'reserved') return { ...pre(reservation.status === 'denied' ? 'BUDGET_DENIED' : 'BUDGET_OPERATION_NOT_NEW'), ...common, accounting: reservation.status === 'denied' ? 'not_reserved' : 'pending_reconciliation', reconciliation_required: reservation.status !== 'denied' };
      if (!safeId(reservation.reservation_id) || reservation.reserved_microusd !== budgetRequest.maximum_cost_microusd || reservation.request_sha256 !== fingerprint || reservation.cost_ceiling_verified !== true || !safeId(reservation.pricing_evidence_ref)) return { ...pre('INVALID_BUDGET_RESERVATION'), ...common, accounting: 'pending_reconciliation', reconciliation_required: true };
      const reserved = { ...common, reservation_id: reservation.reservation_id as string };
      async function stop(code: string): Promise<WorkspaceImageResult> {
        let released = false;
        try { released = (await bounded(budget.releaseBeforeSubmit({ ...reserved, operation_id: request.operation_id }), limits.adapter_timeout_ms))?.released === true; } catch {}
        return { ...pre(code), ...reserved, accounting: released ? 'released' : 'pending_reconciliation', reconciliation_required: !released };
      }
      try { await bounded(bind({ reservation_id: reserved.reservation_id, request_sha256: fingerprint }), limits.adapter_timeout_ms); }
      catch { return await stop('CHILD_BINDING_UNCONFIRMED'); }
      if (signal?.aborted || !current()) return await stop(signal?.aborted ? 'CANCELLED_BEFORE_SUBMIT' : 'AUTHORIZATION_EXPIRED');
      let intent;
      try { intent = await bounded(budget.markSubmissionIntent({ ...structuredClone(budgetRequest), reservation_id: reserved.reservation_id }), limits.adapter_timeout_ms); }
      catch { return { ...pre('SUBMISSION_INTENT_UNCONFIRMED'), ...reserved, accounting: 'pending_reconciliation', reconciliation_required: true }; }
      if (intent?.ok !== true) return { ...pre('SUBMISSION_INTENT_REJECTED'), ...reserved, accounting: 'held', reconciliation_required: true };
      try { await bounded(guard(), limits.adapter_timeout_ms); }
      catch { return await stop('CHILD_DISPATCH_REJECTED'); }
      if (signal?.aborted || !current()) return await stop(signal?.aborted ? 'CANCELLED_BEFORE_SUBMIT' : 'AUTHORIZATION_EXPIRED');
      const controller = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, bodyStream: ReadableStream<Uint8Array> | null | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined, abortListener: (() => void) | undefined;
      let failureCode = 'PROVIDER_TRANSPORT_UNKNOWN';
      const received: WorkspaceImageResult = { ...reserved, outcome: 'unknown', submission: 'submitted', code: failureCode, accounting: 'held', reconciliation_required: true };
      try {
        const data = await Promise.race([
          (async () => {
            const response = await transport(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
              headers: { Authorization: `Bearer ${secret}`, 'OpenAI-Project': capability.project_id, 'Content-Type': 'application/json', Accept: 'application/json', 'X-Client-Request-Id': clientId, 'Idempotency-Key': clientId }, body });
            if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw error('PROVIDER_DEADLINE'); }
            bodyStream = response.body;
            if (response.redirected || response.url && response.url !== endpoint || !int(response.status, 100, 599)) throw error('INVALID_PROVIDER_ORIGIN');
            received.http_status = response.status; const rid = response.headers.get('x-request-id'); if (safeId(rid)) received.provider_request_id = rid;
            const declared = response.headers.get('content-length');
            if (declared && (!/^\d+$/.test(declared) || !int(Number(declared), 0, limits.response_bytes))) throw error('RESPONSE_TOO_LARGE');
            if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) throw error('INVALID_RESPONSE_BODY');
            reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0, text = '';
            for (;;) {
              if (controller.signal.aborted) throw error('PROVIDER_DEADLINE'); const part = await reader.read(); if (part.done) break;
              if (!(part.value instanceof Uint8Array)) throw error('INVALID_RESPONSE_BODY'); size += part.value.byteLength; if (size > limits.response_bytes) throw error('RESPONSE_TOO_LARGE');
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode(); return JSON.parse(text) as unknown;
          })(),
          new Promise<never>((_, reject) => {
            const stop = (code: string) => { failureCode = code; controller.abort(); void reader?.cancel().catch(() => {}); reject(error(code)); };
            timer = setTimeout(() => stop('PROVIDER_TIMEOUT_UNKNOWN'), limits.request_timeout_ms);
            abortListener = () => stop('PROVIDER_CANCELLED_UNKNOWN'); signal?.addEventListener('abort', abortListener, { once: true }); if (signal?.aborted) abortListener();
          }),
        ]);
        if (!record(data)) { received.code = 'INVALID_PROVIDER_RESPONSE'; }
        else {
          // Preserve valid numeric usage even when output decoding fails. Provider
          // error bodies, revised prompt and URLs are never reflected or fetched.
          const usage = workspaceProviderUsage(data.usage); if (usage && !JSON.stringify(usage).includes(secret)) received.usage = usage;
          const modelMatches = data.model === undefined || typeof data.model === 'string' && capability.accepted_response_models.includes(data.model);
          if (typeof data.model === 'string' && modelMatches) received.response_model = data.model;
          if (received.http_status === 200 && data.error == null && modelMatches && int(data.created, 0) && Array.isArray(data.data) && data.data.length === 1 && record(data.data[0]) && received.usage) {
            received.outcome = 'known_failure'; received.code = 'INVALID_IMAGE_OUTPUT';
            const item = data.data[0], encoded = item.b64_json;
            if (typeof encoded === 'string' && encoded.length <= Math.ceil(limits.output_bytes / 3) * 4 && encoded.length > 0 && encoded.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
              && item.url === undefined && (data.output_format === undefined || data.output_format === request.output_format) && (data.size === undefined || data.size === request.size) && (data.quality === undefined || data.quality === request.quality)) {
              const bytes = Buffer.from(encoded, 'base64'), mime = ('image/' + request.output_format) as WorkspaceImageMime;
              if (bytes.byteLength <= limits.output_bytes && bytes.toString('base64') === encoded && sniff(bytes) === mime && !bytes.includes(Buffer.from(secret))) {
                try {
                  const decoded = await bounded(decode(Uint8Array.from(bytes), mime), limits.adapter_timeout_ms); const [w, h] = request.size.split('x').map(Number);
                  if (!controller.signal.aborted && decoded?.fully_decoded === true && decoded.frames === 1 && decoded.width === w && decoded.height === h && w * h <= limits.image_pixels) {
                    received.outcome = 'completed'; received.code = 'COMPLETED_UNTRUSTED'; received.output = { bytes: Uint8Array.from(bytes), sha256: hash(bytes), mime_type: mime, width: w, height: h, trust: 'untrusted_model_output', qc_verified: false };
                  }
                } catch { received.code = 'OUTPUT_DECODE_FAILED'; }
              }
            }
          } else received.code = modelMatches ? 'PROVIDER_RESPONSE_REQUIRES_RECONCILIATION' : 'PROVIDER_MODEL_MISMATCH';
        }
      } catch { received.code = failureCode; }
      finally {
        clearTimeout(timer); if (abortListener) signal?.removeEventListener('abort', abortListener); controller.abort();
        if (reader) void reader.cancel().catch(() => {}); else void bodyStream?.cancel().catch(() => {});
      }
      if (received.http_status && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(received.http_status)) { received.outcome = 'known_failure'; received.code = 'PROVIDER_REQUEST_REJECTED'; delete received.output; }
      const report: WorkspaceProviderBudgetReport = { ...reserved, operation_id: request.operation_id, outcome: received.outcome as WorkspaceProviderBudgetReport['outcome'],
        ...(received.provider_request_id ? { provider_request_id: received.provider_request_id } : {}), ...(received.response_model ? { response_model: received.response_model } : {}),
        ...(received.http_status !== undefined ? { http_status: received.http_status } : {}), ...(received.usage ? { usage: structuredClone(received.usage) } : {}) };
      try {
        const receipt = await bounded(budget.reconcile(report), limits.adapter_timeout_ms);
        if (receipt && safeId(receipt.receipt_id) && (receipt.status === 'held' || receipt.status === 'settled' && received.usage)) { received.accounting = receipt.status; received.budget_receipt_id = receipt.receipt_id; }
        else received.accounting = 'pending_reconciliation';
      } catch { received.accounting = 'pending_reconciliation'; }
      received.reconciliation_required = received.outcome === 'unknown' || received.accounting !== 'settled';
      return received;
    } finally { inFlight--; }
  }
  return Object.freeze({ submit, scope: Object.freeze({ owner_id: authorization.owner_id, task_id: authorization.task_id, project_id: capability.project_id, endpoint: authorization.data_destination, model: capability.model }) });
}

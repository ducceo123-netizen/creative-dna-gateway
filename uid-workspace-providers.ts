import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { workspaceObjectKey, type WorkspacePrivateObjectStore, type WorkspaceObjectIdentity } from './uid-workspace-artifacts.ts';
import type { WorkspaceStageContext } from './uid-workspace-runner.ts';
import type { WorkspaceRuntimeServices } from './uid-workspace-runtime.ts';

/** SERVER ONLY. Concrete public HTTPS acquisition, not a research/EO verdict.
 * Imports/constructors do not discover credentials, access DNS, or open sockets.
 * Source prose is hostile data. This module never executes it or follows its links.
 * No paid provider is invoked, and an API key never establishes owner/task identity.
 */
export const WORKSPACE_SOURCE_LIMITS = Object.freeze({
  document_bytes: 2 * 1024 * 1024, image_bytes: 8 * 1024 * 1024,
  capture_bytes: 10 * 1024 * 1024, manifest_bytes: 32 * 1024,
  pixels: 16_000_000, dimension: 16_384, redirects: 3,
  timeout_ms: 20_000, dns_timeout_ms: 3_000, idle_timeout_ms: 5_000,
  decode_timeout_ms: 5_000, concurrent_captures: 2, response_header_bytes: 8_192,
});
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export class WorkspaceSourceError extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new WorkspaceSourceError(code); }
function requireSource(value: unknown, code: string): asserts value { if (!value) fail(code); }
function checkAbort(signal: AbortSignal) { if (signal.aborted) fail('SOURCE_CANCELLED_OR_TIMED_OUT'); }
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => undefined); fail('SOURCE_CANCELLED_OR_TIMED_OUT'); }
  let listener: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    listener = () => reject(new WorkspaceSourceError('SOURCE_CANCELLED_OR_TIMED_OUT'));
    signal.addEventListener('abort', listener, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener('abort', listener!); }
}

const scopeSchema = z.object({
  owner_id: id, task_id: id, canonical_version: id, source_url: z.string().max(4096),
  snapshot_id: id, state_version: z.number().int().nonnegative(), content_revision: id,
  operation_id: id, stage: id,
}).strict();
export type WorkspaceSourceScope = z.infer<typeof scopeSchema>;
/** Derived only from the authenticated runner context, never request/model fields. */
export function workspaceSourceScope(context: WorkspaceStageContext): WorkspaceSourceScope {
  requireSource(context.owner_id === context.record.owner_id
    && context.run.snapshot_id === context.record.task.snapshot.snapshot_id
    && context.run.content_revision === context.record.task.snapshot.content_revision
    && context.run.expected_state_version === context.record.task.state_version, 'SOURCE_CONTEXT_SCOPE_MISMATCH');
  const scope = scopeSchema.safeParse({ owner_id: context.owner_id, task_id: context.record.task.task_id,
    canonical_version: context.record.task.snapshot.canonical_version, source_url: context.record.brief.source_url,
    snapshot_id: context.record.task.snapshot.snapshot_id, state_version: context.record.task.state_version,
    content_revision: context.record.task.snapshot.content_revision, operation_id: context.run.operation_id, stage: context.run.stage });
  requireSource(scope.success, 'SOURCE_CONTEXT_SCOPE_MISMATCH');
  publicUrl(scope.data.source_url); return scope.data;
}

export type WorkspacePublicSourceAuthorization = {
  authorization_id: string; owner_id: string; task_id: string; canonical_version: string;
  source_url: string; expires_at: string;
  /** Exact reviewed public origins, including redirects/CDNs. No wildcard/suffix. */
  allowed_origins: string[];
};
const grantSchema = z.object({ authorization_id: id, owner_id: id, task_id: id,
  canonical_version: id, source_url: z.string().max(4096), expires_at: z.string().datetime(),
  allowed_origins: z.array(z.string().max(300)).min(1).max(30) }).strict();
export type WorkspaceSourceHttpResponse = {
  status: number; headers: Record<string, string | string[] | undefined>;
  peer_address: string; body: AsyncIterable<Uint8Array>; dispose(): void;
};
/** Test/verified integration seam, not available to HTTP/model input. The built-in
 * production client pins the DNS result at TLS connection time and checks its peer.
 * Overriding it explicitly makes productionReady false. */
export interface WorkspaceSourceNetwork {
  resolve(host: string, signal: AbortSignal): Promise<Array<{ address: string; family: number }>>;
  get(url: URL, address: { address: string; family: number }, signal: AbortSignal): Promise<WorkspaceSourceHttpResponse>;
}
export type WorkspacePublicSourceConfig = {
  objects: WorkspacePrivateObjectStore;
  /** Production composition journals each immutable capture before object I/O. */
  writeRunArtifact?: WorkspaceRuntimeServices['writeRunArtifact'];
  /** Must read current server-authorized owner/task policy. No default grant. */
  authorize(scope: WorkspaceSourceScope): Promise<WorkspacePublicSourceAuthorization | null>;
  network?: WorkspaceSourceNetwork;
  now?: () => number;
  /** Trusted installation directory, never a source/model/request path. Defaults
   * to the supported tools/creative-quality package under the deployment cwd. */
  creativeQualityDirectory?: string;
};

/** Conservative public-unicast allowlist; reject special-use IPv4 and IPv6,
 * IPv4-in-IPv6, NAT64, 6to4, Teredo, zones, documentation and local ranges. */
export function isWorkspacePublicAddress(address: string): boolean {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127
      || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99)
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (family !== 6) return false;
  const normalized = new URL('https://[' + address + ']/').hostname.slice(1, -1);
  const halves = normalized.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  const words = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(word => parseInt(word, 16));
  const [a, b] = words;
  return a >= 0x2000 && a <= 0x3fff && !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8)
    || a === 0x2002 || a === 0x3ffe || a === 0x3fff && b <= 0x0fff);
}

function publicUrl(input: string): URL {
  requireSource(typeof input === 'string' && input.length <= 4096 && !/[\u0000-\u0020\u007f\\]/.test(input), 'SOURCE_URL_NOT_ALLOWED');
  let url: URL; try { url = new URL(input); } catch { fail('SOURCE_URL_NOT_ALLOWED'); }
  requireSource(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
    && !isIP(url.hostname.replace(/^\[|\]$/g, '')) && url.hostname.length <= 253
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(url.hostname) && url.hostname.includes('.')
    && !url.hostname.split('.').some(part => !part || part.length > 63 || part.startsWith('-') || part.endsWith('-'))
    && !/(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(url.hostname), 'SOURCE_URL_NOT_ALLOWED');
  // Public captures never accept bearer/signed URLs or ordinary login codes.
  for (const key of url.searchParams.keys()) requireSource(!/(?:^|[-_])(token|key|secret|password|signature|credential|authorization|auth|code)(?:$|[-_])/i.test(key)
    && !/^(?:apikey|accesstoken|authtoken|refreshtoken|idtoken|clientsecret|sessionid|sessiontoken|signedsignature)$/i.test(key.replace(/[^a-z0-9]/gi, '')), 'SOURCE_CREDENTIAL_URL_NOT_ALLOWED');
  return url;
}
function header(response: WorkspaceSourceHttpResponse, key: string): string | undefined {
  const value = response.headers[key];
  requireSource(value === undefined || typeof value === 'string' && value.length <= WORKSPACE_SOURCE_LIMITS.response_header_bytes, 'SOURCE_INVALID_HEADERS');
  return value as string | undefined;
}
function contentType(response: WorkspaceSourceHttpResponse, kind: 'document' | 'image') {
  const value = header(response, 'content-type') ?? '';
  const parts = value.toLowerCase().split(';').map(part => part.trim()), media = parts.shift()!;
  requireSource((kind === 'document' ? ['text/html', 'text/plain', 'application/json'] : ['image/png', 'image/jpeg', 'image/webp']).includes(media), 'SOURCE_UNSUPPORTED_MEDIA');
  for (const part of parts) requireSource(kind === 'document' && /^charset=(?:"?utf-8"?|"?us-ascii"?)$/.test(part), 'SOURCE_UNSUPPORTED_CHARSET');
  requireSource(!header(response, 'content-encoding') || header(response, 'content-encoding')!.trim().toLowerCase() === 'identity', 'SOURCE_COMPRESSED_RESPONSE_NOT_ALLOWED');
  return media;
}
function normalizedAddress(value: string) { return isIP(value) === 6 ? new URL('https://[' + value + ']/').hostname.slice(1, -1) : value; }
const productionNetwork: WorkspaceSourceNetwork = {
  async resolve(host, signal) { return bounded(lookup(host, { all: true, verbatim: true }), signal); },
  get(url, address, signal) {
    return new Promise((resolve, reject) => {
      // No proxy/env agent, cookies, Authorization, Referer, or cross-origin state.
      // Hostname/SNI/certificate verification remain the requested DNS hostname.
      const request = httpsRequest(url, { method: 'GET', agent: false, signal,
        maxHeaderSize: WORKSPACE_SOURCE_LIMITS.response_header_bytes, rejectUnauthorized: true, servername: url.hostname,
        lookup: ((_host: string, options: any, callback: any) => {
          if (options?.all) callback(null, [address]); else callback(null, address.address, address.family);
        }) as any,
        headers: { Accept: 'text/html, text/plain, application/json, image/png, image/jpeg, image/webp',
          'Accept-Encoding': 'identity', 'User-Agent': 'UID-Workspace-Public-Source/1.0', Connection: 'close' },
      }, response => {
        const peer = response.socket.remoteAddress ?? '';
        if (normalizedAddress(peer) !== normalizedAddress(address.address) || !isWorkspacePublicAddress(peer)) {
          response.destroy(); request.destroy(); reject(new WorkspaceSourceError('SOURCE_PEER_MISMATCH')); return;
        }
        resolve({ status: response.statusCode ?? 0, headers: response.headers, peer_address: peer,
          body: response, dispose() { response.destroy(); request.destroy(); } });
      });
      request.setTimeout(WORKSPACE_SOURCE_LIMITS.idle_timeout_ms, () => request.destroy(new WorkspaceSourceError('SOURCE_IDLE_TIMEOUT')));
      request.once('error', () => reject(new WorkspaceSourceError(signal.aborted ? 'SOURCE_CANCELLED_OR_TIMED_OUT' : 'SOURCE_NETWORK_FAILED')));
      request.end();
    });
  },
};

const rasterSchema = z.object({ width: z.number().int().positive().max(WORKSPACE_SOURCE_LIMITS.dimension),
  height: z.number().int().positive().max(WORKSPACE_SOURCE_LIMITS.dimension),
  technical_validation: z.literal('full_decode_passed'), visual_inspection: z.literal('not_performed') }).strict();
/** Separate killable process: native decoder receives only bounded bytes, no URL,
 * credentials/environment, or task state. It cannot turn a decode into pixel QC. */
async function decodeRaster(bytes: Uint8Array, media: string, parent: AbortSignal, directory: string): Promise<z.infer<typeof rasterSchema>> {
  const buffer = Buffer.from(bytes);
  const sniffed = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? 'image/jpeg'
    : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  requireSource(sniffed === media, 'SOURCE_IMAGE_MIME_MISMATCH');
  // Resolve ONLY the declared isolated runtime, never ancestor/global NODE_PATH.
  // Absolute require base works in both TypeScript ESM and the server CJS bundle.
  let sharpPath: string; try { sharpPath = createRequire(path.join(directory, 'package.json')).resolve('./node_modules/sharp'); } catch { fail('SOURCE_DECODER_UNAVAILABLE'); }
  const expected = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[media];
  const script = `const sharp=require(${JSON.stringify(sharpPath)});sharp.cache(false);sharp.concurrency(1);
    let bytes=0;const chunks=[];process.stdin.on('data',c=>{bytes+=c.length;if(bytes>${WORKSPACE_SOURCE_LIMITS.image_bytes})process.exit(2);chunks.push(c)});
    process.stdin.on('end',async()=>{try{const image=sharp(Buffer.concat(chunks),{limitInputPixels:${WORKSPACE_SOURCE_LIMITS.pixels},failOn:'warning',sequentialRead:true});
    const m=await image.metadata();if(m.format!==${JSON.stringify(expected)}||!m.width||!m.height||m.width>${WORKSPACE_SOURCE_LIMITS.dimension}||m.height>${WORKSPACE_SOURCE_LIMITS.dimension}||m.width*m.height>${WORKSPACE_SOURCE_LIMITS.pixels}||(m.pages??1)!==1)process.exit(2);
    await image.stats();const rotated=[5,6,7,8].includes(m.orientation);process.stdout.write(JSON.stringify({width:rotated?m.height:m.width,height:rotated?m.width:m.height,technical_validation:'full_decode_passed',visual_inspection:'not_performed'}));}catch{process.exit(2)}});`;
  const signal = AbortSignal.any([parent, AbortSignal.timeout(WORKSPACE_SOURCE_LIMITS.decode_timeout_ms)]);
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=64', '--input-type=commonjs', '--eval', script],
      { env: {}, stdio: ['pipe', 'pipe', 'ignore'], signal, killSignal: 'SIGKILL', windowsHide: true });
    let output = '', settled = false;
    const done = (error?: WorkspaceSourceError, value?: z.infer<typeof rasterSchema>) => {
      if (settled) return; settled = true; child.kill('SIGKILL'); error ? reject(error) : resolve(value!);
    };
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (output.length > 1024) done(new WorkspaceSourceError('SOURCE_IMAGE_DECODE_FAILED')); });
    child.stdin.on('error', () => done(new WorkspaceSourceError('SOURCE_IMAGE_DECODE_FAILED')));
    child.once('error', () => done(new WorkspaceSourceError(signal.aborted ? 'SOURCE_CANCELLED_OR_TIMED_OUT' : 'SOURCE_DECODER_UNAVAILABLE')));
    child.once('close', code => {
      if (code !== 0) return done(new WorkspaceSourceError('SOURCE_IMAGE_DECODE_FAILED'));
      try { const parsed = rasterSchema.parse(JSON.parse(output)); requireSource(parsed.width * parsed.height <= WORKSPACE_SOURCE_LIMITS.pixels, 'SOURCE_IMAGE_DECODE_FAILED'); done(undefined, parsed); }
      catch { done(new WorkspaceSourceError('SOURCE_IMAGE_DECODE_FAILED')); }
    });
    child.stdin.end(buffer);
  });
}

const objectSchema = z.object({ owner_id: id, task_id: id, storage_key: z.string().regex(/^[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}$/),
  sha256: hash, size_bytes: z.number().int().positive().max(WORKSPACE_SOURCE_LIMITS.image_bytes),
  media_type: z.enum(['text/html', 'text/plain', 'application/json', 'image/png', 'image/jpeg', 'image/webp']) }).strict();
const manifestSchema = z.object({ version: z.literal(1), scope: scopeSchema, authorization_id: id, captured_at: z.string().datetime(),
  kind: z.enum(['document', 'image']), requested_url: z.string().max(4096), final_url: z.string().max(4096),
  chain: z.array(z.object({ url: z.string().max(4096), status: z.number().int(), peer_address: z.string().max(64) }).strict()).min(1).max(WORKSPACE_SOURCE_LIMITS.redirects + 1),
  object: objectSchema, raster: rasterSchema.optional(), semantic_inspection: z.literal('not_performed'),
}).strict();
export type WorkspaceCapturedSource = {
  evidence_ref: string; sha256: string; size_bytes: number; media_type: string;
  scope: WorkspaceSourceScope; requested_url: string; final_url: string; captured_at: string;
  raster?: z.infer<typeof rasterSchema>; semantic_inspection: 'not_performed';
};
export type WorkspaceReopenedSource = WorkspaceCapturedSource & { bytes: Uint8Array; text?: string };

/** Real safe source acquisition is usable independently of the Onepage semantic
 * researcher. A capture does NOT satisfy inspected PDP/gallery/research/EO gates. */
export class WorkspacePublicSourceProvider {
  readonly kind = 'public-https-source-v1';
  readonly productionReady: boolean;
  private active = 0;
  private readonly network: WorkspaceSourceNetwork;
  private readonly now: () => number;
  private readonly objects: WorkspacePrivateObjectStore;
  private readonly authorize: WorkspacePublicSourceConfig['authorize'];
  private readonly decoderDirectory: string;
  private readonly writeRunArtifact?: WorkspaceRuntimeServices['writeRunArtifact'];
  constructor(config: WorkspacePublicSourceConfig) {
    requireSource(config?.objects && typeof config.authorize === 'function', 'SOURCE_CONFIGURATION_REQUIRED');
    this.objects = config.objects; this.authorize = config.authorize;
    this.writeRunArtifact = config.writeRunArtifact;
    this.network = config.network ?? productionNetwork; this.now = config.now ?? Date.now;
    this.decoderDirectory = config.creativeQualityDirectory ?? path.resolve('tools/creative-quality');
    requireSource(path.isAbsolute(this.decoderDirectory), 'SOURCE_DECODER_CONFIGURATION_INVALID');
    this.productionReady = config.objects.productionReady && !config.objects.loopbackOnly && !config.network && !config.now;
  }
  private async grant(scope: WorkspaceSourceScope, signal: AbortSignal) {
    checkAbort(signal);
    const raw = await bounded(this.authorize(structuredClone(scope)), signal), parsed = grantSchema.safeParse(raw);
    requireSource(parsed.success, 'SOURCE_AUTHORIZATION_REQUIRED');
    const grant = parsed.data;
    requireSource(grant.owner_id === scope.owner_id && grant.task_id === scope.task_id
      && grant.canonical_version === scope.canonical_version && grant.source_url === scope.source_url
      && Date.parse(grant.expires_at) > this.now(), 'SOURCE_AUTHORIZATION_SCOPE_MISMATCH');
    for (const origin of grant.allowed_origins) requireSource(publicUrl(origin).origin === origin, 'SOURCE_ORIGIN_POLICY_INVALID');
    requireSource(new Set(grant.allowed_origins).size === grant.allowed_origins.length
      && grant.allowed_origins.includes(publicUrl(scope.source_url).origin), 'SOURCE_ORIGIN_POLICY_INVALID');
    return grant;
  }
  private object(scope: WorkspaceSourceScope, bytes: Uint8Array, media_type: string): WorkspaceObjectIdentity {
    const sha256 = sha(bytes); return { owner_id: scope.owner_id, task_id: scope.task_id,
      storage_key: workspaceObjectKey(scope.owner_id, scope.task_id, sha256), sha256, size_bytes: bytes.byteLength, media_type };
  }
  private async readObject(object: WorkspaceObjectIdentity, limit: number, signal: AbortSignal) {
    requireSource(object.size_bytes > 0 && object.size_bytes <= limit, 'SOURCE_EVIDENCE_SIZE_INVALID');
    const opening = this.objects.open(object);
    let opened: Awaited<typeof opening>;
    try { opened = await bounded(opening, signal); }
    catch (error) {
      // The storage API has no signal. Dispose even when open resolves AFTER the
      // caller's deadline; never leave an unconsumed late socket/file stream.
      void opening.then(value => value?.dispose()).catch(() => undefined); throw error;
    }
    requireSource(opened, 'SOURCE_EVIDENCE_UNAVAILABLE');
    try {
      const chunks: Uint8Array[] = []; let count = 0;
      for await (const chunk of abortable(opened.stream, signal)) {
        requireSource(chunk instanceof Uint8Array && (count += chunk.byteLength) <= object.size_bytes, 'SOURCE_EVIDENCE_INTEGRITY'); chunks.push(new Uint8Array(chunk));
      }
      const bytes = Buffer.concat(chunks); requireSource(count === object.size_bytes && sha(bytes) === object.sha256, 'SOURCE_EVIDENCE_INTEGRITY'); return bytes;
    } finally { await bounded(opened.dispose(), signal); }
  }
  private async retain(context: WorkspaceStageContext, object: WorkspaceObjectIdentity, bytes: Uint8Array, signal: AbortSignal) {
    checkAbort(signal);
    if (this.writeRunArtifact) {
      const stored = await bounded(this.writeRunArtifact(context, object, (async function* () { yield bytes; })()), signal);
      requireSource(stored.owner_id === object.owner_id && stored.task_id === object.task_id && stored.storage_key === object.storage_key
        && stored.sha256 === object.sha256 && stored.size_bytes === object.size_bytes && stored.media_type === object.media_type, 'SOURCE_CAPTURE_CUSTODY_MISMATCH');
      await this.readObject(object, Math.max(WORKSPACE_SOURCE_LIMITS.manifest_bytes, object.size_bytes), signal);
      return;
    }
    // Content-addressed immutable storage makes retries of READ-only capture safe.
    // A failed/uncertain put is accepted only after an exact readback, never by key.
    try { await bounded(this.objects.put(object, (async function* () { yield bytes; })()), signal); }
    catch { checkAbort(signal); }
    await this.readObject(object, Math.max(WORKSPACE_SOURCE_LIMITS.manifest_bytes, object.size_bytes), signal);
  }
  async capture(context: WorkspaceStageContext, input: { url: string; kind: 'document' | 'image' }): Promise<WorkspaceCapturedSource> {
    requireSource(this.active < WORKSPACE_SOURCE_LIMITS.concurrent_captures, 'SOURCE_ACQUISITION_BUSY');
    const scope = workspaceSourceScope(context), kind = input.kind;
    requireSource(kind === 'document' || kind === 'image', 'SOURCE_KIND_INVALID');
    const requested = publicUrl(input.url), signal = AbortSignal.any([context.signal, AbortSignal.timeout(WORKSPACE_SOURCE_LIMITS.timeout_ms)]);
    this.active++;
    try {
      const grant = await this.grant(scope, signal); let url = requested, total = 0;
      const seen = new Set<string>(), chain: z.infer<typeof manifestSchema>['chain'] = [];
      while (true) {
        checkAbort(signal);
        requireSource(grant.allowed_origins.includes(url.origin) && Date.parse(grant.expires_at) > this.now(), 'SOURCE_DESTINATION_NOT_AUTHORIZED');
        requireSource(!seen.has(url.href), 'SOURCE_REDIRECT_LOOP'); seen.add(url.href);
        const dnsSignal = AbortSignal.any([signal, AbortSignal.timeout(WORKSPACE_SOURCE_LIMITS.dns_timeout_ms)]);
        let addresses: Array<{ address: string; family: number }>;
        try { addresses = await bounded(this.network.resolve(url.hostname, dnsSignal), dnsSignal); }
        catch { checkAbort(signal); fail('SOURCE_DNS_FAILED'); }
        requireSource(addresses.length > 0 && addresses.length <= 32 && addresses.every(a => a && a.family === isIP(a.address) && isWorkspacePublicAddress(a.address)), 'SOURCE_DNS_NOT_PUBLIC');
        const pinned = { ...addresses[0] };
        const response = await bounded(this.network.get(new URL(url.href), pinned, signal), signal);
        try {
          requireSource(isWorkspacePublicAddress(response.peer_address) && normalizedAddress(response.peer_address) === normalizedAddress(pinned.address), 'SOURCE_PEER_MISMATCH');
          chain.push({ url: url.href, status: response.status, peer_address: response.peer_address });
          if ([301,302,303,307,308].includes(response.status)) {
            requireSource(chain.length <= WORKSPACE_SOURCE_LIMITS.redirects, 'SOURCE_REDIRECT_LIMIT');
            const location = header(response, 'location'); requireSource(location && !/[\u0000-\u0020\u007f\\]/.test(location), 'SOURCE_REDIRECT_INVALID');
            url = publicUrl(new URL(location, url).href); continue;
          }
          requireSource(response.status === 200, 'SOURCE_HTTP_NOT_OK');
          const media = contentType(response, kind), maxBytes = kind === 'document' ? WORKSPACE_SOURCE_LIMITS.document_bytes : WORKSPACE_SOURCE_LIMITS.image_bytes;
          const length = header(response, 'content-length');
          requireSource(length === undefined || /^\d+$/.test(length) && Number.isSafeInteger(Number(length)) && Number(length) > 0 && Number(length) <= maxBytes, 'SOURCE_RESPONSE_TOO_LARGE');
          let count = 0; const chunks: Uint8Array[] = [];
          for await (const chunk of abortable(response.body, signal)) {
            requireSource(chunk instanceof Uint8Array && (count += chunk.byteLength) <= maxBytes
              && (total += chunk.byteLength) <= WORKSPACE_SOURCE_LIMITS.capture_bytes, 'SOURCE_RESPONSE_TOO_LARGE'); chunks.push(new Uint8Array(chunk));
          }
          requireSource(count > 0 && (length === undefined || count === Number(length)), 'SOURCE_RESPONSE_TRUNCATED');
          const bytes = Buffer.concat(chunks), raster = kind === 'image' ? await decodeRaster(bytes, media, signal, this.decoderDirectory) : undefined;
          if (kind === 'document') { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('SOURCE_INVALID_UTF8'); } }
          // Authorization is rechecked after potentially slow acquisition/decode.
          const current = await this.grant(scope, signal);
          requireSource(current.authorization_id === grant.authorization_id && chain.every(item => current.allowed_origins.includes(publicUrl(item.url).origin)), 'SOURCE_AUTHORIZATION_CHANGED');
          const object = this.object(scope, bytes, media); await this.retain(context, object, bytes, signal);
          const manifest = manifestSchema.parse({ version: 1, scope, authorization_id: grant.authorization_id, captured_at: new Date(this.now()).toISOString(),
            kind, requested_url: requested.href, final_url: url.href, chain, object, ...(raster ? { raster } : {}), semantic_inspection: 'not_performed' });
          const manifestBytes = Buffer.from(JSON.stringify(manifest)); requireSource(manifestBytes.length <= WORKSPACE_SOURCE_LIMITS.manifest_bytes, 'SOURCE_EVIDENCE_TOO_LARGE');
          const descriptor = this.object(scope, manifestBytes, 'application/json'); await this.retain(context, descriptor, manifestBytes, signal);
          return captureResult(manifest, `source:${descriptor.sha256}:${descriptor.size_bytes}`);
        } finally { response.dispose(); }
      }
    } catch (error) { if (error instanceof WorkspaceSourceError) throw error; checkAbort(signal); fail('SOURCE_ACQUISITION_FAILED'); }
    finally { this.active--; }
  }
  /** expectedScope is the captured scope retained by the researcher. Later QC may
   * reopen the old snapshot, but only for the SAME authenticated owner/task/source/
   * canonical pin and under the current origin policy. Reopens bytes, never URL. */
  async reopen(context: WorkspaceStageContext, evidenceRef: string, expectedScope: WorkspaceSourceScope): Promise<WorkspaceReopenedSource> {
    requireSource(this.active < WORKSPACE_SOURCE_LIMITS.concurrent_captures, 'SOURCE_ACQUISITION_BUSY');
    const current = workspaceSourceScope(context), parsed = scopeSchema.safeParse(expectedScope);
    requireSource(parsed.success && (['owner_id','task_id','source_url','canonical_version'] as const).every(key => current[key] === parsed.data[key]), 'SOURCE_EVIDENCE_SCOPE_MISMATCH');
    const expected = parsed.data, signal = AbortSignal.any([context.signal, AbortSignal.timeout(WORKSPACE_SOURCE_LIMITS.timeout_ms)]);
    this.active++;
    try {
    const match = typeof evidenceRef === 'string' && /^source:([a-f0-9]{64}):([1-9][0-9]{0,4})$/.exec(evidenceRef);
    requireSource(match && Number(match[2]) <= WORKSPACE_SOURCE_LIMITS.manifest_bytes, 'SOURCE_EVIDENCE_REF_INVALID');
    const grant = await this.grant(current, signal);
    const descriptor = { owner_id: current.owner_id, task_id: current.task_id, storage_key: workspaceObjectKey(current.owner_id, current.task_id, match[1]), sha256: match[1], size_bytes: Number(match[2]), media_type: 'application/json' };
    let manifest: z.infer<typeof manifestSchema>;
    try { manifest = manifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.readObject(descriptor, WORKSPACE_SOURCE_LIMITS.manifest_bytes, signal)))); }
    catch (error) { if (error instanceof WorkspaceSourceError) throw error; fail('SOURCE_EVIDENCE_INVALID'); }
    requireSource(same(manifest.scope, expected) && manifest.object.owner_id === current.owner_id && manifest.object.task_id === current.task_id
      && manifest.object.storage_key === workspaceObjectKey(current.owner_id, current.task_id, manifest.object.sha256), 'SOURCE_EVIDENCE_SCOPE_MISMATCH');
    requireSource(manifest.chain[0].url === manifest.requested_url && manifest.chain.at(-1)!.url === manifest.final_url
      && manifest.chain.at(-1)!.status === 200 && new Set(manifest.chain.map(step => step.url)).size === manifest.chain.length
      && manifest.chain.slice(0,-1).every(step => [301,302,303,307,308].includes(step.status))
      && manifest.chain.every(step => grant.allowed_origins.includes(publicUrl(step.url).origin) && isWorkspacePublicAddress(step.peer_address)), 'SOURCE_EVIDENCE_DESTINATION_MISMATCH');
    requireSource((manifest.kind === 'image') === !!manifest.raster && (manifest.kind === 'image' ? manifest.object.media_type.startsWith('image/') : !manifest.object.media_type.startsWith('image/')), 'SOURCE_EVIDENCE_MEDIA_MISMATCH');
    const bytes = await this.readObject(manifest.object, manifest.kind === 'document' ? WORKSPACE_SOURCE_LIMITS.document_bytes : WORKSPACE_SOURCE_LIMITS.image_bytes, signal);
    let text: string | undefined;
    if (manifest.kind === 'image') requireSource(same(await decodeRaster(bytes, manifest.object.media_type, signal, this.decoderDirectory), manifest.raster), 'SOURCE_EVIDENCE_DECODE_MISMATCH');
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('SOURCE_INVALID_UTF8'); } }
    return { ...captureResult(manifest, evidenceRef), bytes: new Uint8Array(bytes), ...(text !== undefined ? { text } : {}) };
    } catch (error) { if (error instanceof WorkspaceSourceError) throw error; checkAbort(signal); fail('SOURCE_EVIDENCE_UNAVAILABLE'); }
    finally { this.active--; }
  }
}
function captureResult(manifest: z.infer<typeof manifestSchema>, evidence_ref: string): WorkspaceCapturedSource {
  return { evidence_ref, sha256: manifest.object.sha256, size_bytes: manifest.object.size_bytes, media_type: manifest.object.media_type,
    scope: structuredClone(manifest.scope), requested_url: manifest.requested_url, final_url: manifest.final_url,
    captured_at: manifest.captured_at, ...(manifest.raster ? { raster: structuredClone(manifest.raster) } : {}), semantic_inspection: 'not_performed' };
}
async function* abortable(stream: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator](); let finished = false;
  try { while (true) { const value = await bounded(iterator.next(), signal); if (value.done) { finished = true; return; } yield value.value; } }
  finally { if (!finished) void iterator.return?.().catch(() => undefined); }
}

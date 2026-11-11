import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { stableJson } from './supabase/functions/_shared/creative-quality.ts';
import { workspaceSourceScope, type WorkspacePublicSourceAuthorization, type WorkspacePublicSourceProvider, type WorkspaceSourceScope, type WorkspaceReopenedSource } from './uid-workspace-providers.ts';
import { workspaceObjectKey, type WorkspaceObjectIdentity, type WorkspacePrivateObjectStore } from './uid-workspace-artifacts.ts';
import type { WorkspaceResearchExtraction, WorkspaceResearchInventory } from './uid-workspace-research.ts';
import type { WorkspaceStageContext } from './uid-workspace-runner.ts';
import type { WorkspaceRuntimeServices } from './uid-workspace-runtime.ts';

/** SERVER ONLY. Reviewed retained-static-document enumeration, NOT a live-theme
 * crawler. Scripts, direct browser egress, credentials and arbitrary actions are
 * absent. The composition root supplies the sandboxed Chromium implementation. */
export const WORKSPACE_INVENTORY_LIMITS = Object.freeze({ states: 8, images: 48, details: 100, dom_bytes: 1024 * 1024,
  manifest_bytes: 512 * 1024, image_bytes: 8 * 1024 * 1024, total_bytes: 48 * 1024 * 1024,
  pixels: 16_000_000, timeout_ms: 120_000, max_timeout_ms: 300_000, requests: 200 });
const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const digest = (v: unknown) => sha(stableJson(v));
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(4000);
// Deliberately small CSS grammar: descendant compounds only, no pseudo classes,
// sibling/comma lists, escapes, URL values, or executable selector strings.
const atom = '(?:[a-z][a-z0-9-]*|[#.][A-Za-z_][A-Za-z0-9_-]*|\\[(?:data-[a-z0-9-]+|id|class|name|type|value)(?:="[A-Za-z0-9_. -]+")?\\])';
const selector = z.string().min(1).max(300).regex(new RegExp(`^${atom}+(?: ${atom}+)*$`));
const attr = z.enum(['value', 'data-variant-id']);
const interaction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open_details'), selector }).strict(),
  z.object({ kind: z.literal('select_native'), selector, value: id }).strict(),
  z.object({ kind: z.literal('scroll_into_view'), selector }).strict(),
]);
export const workspaceInventoryPlanSchema = z.object({
  schema_version: z.literal('workspace-static-inventory-plan/1'), policy_id: id, review_ref: id,
  source_url: z.string().url().max(2000), final_url: z.string().url().max(2000), document_sha256: hash,
  platform: text, mode: z.enum(['reviewed_static_closure', 'partial']),
  /** These are a pinned reviewed theme/document contract, not AI assertions. */
  root: selector, signature: z.object({ selector, attribute: z.string().regex(/^data-[a-z0-9-]{1,60}$/), value: text }).strict(),
  identity: z.object({ selector, text }).strict(),
  variant_registry: z.object({ selector, attribute: attr }).strict(),
  closure_marker: z.object({ selector, text }).strict(),
  /** Exact, reviewed image URLs; source markup cannot introduce network targets. */
  image_urls: z.array(z.string().url().max(2000)).max(WORKSPACE_INVENTORY_LIMITS.images),
  states: z.array(z.object({ id, variant: text, root: selector,
    interactions: z.array(interaction).max(12),
    gallery: z.array(z.object({ selector, attribute: z.enum(['src', 'data-src', 'href']), kind: z.enum(['image', 'video']), count: z.number().int().min(1).max(48) }).strict()).max(20),
    details: z.array(z.object({ id, selector }).strict()).max(WORKSPACE_INVENTORY_LIMITS.details),
  }).strict()).min(1).max(WORKSPACE_INVENTORY_LIMITS.states),
}).strict();
export type WorkspaceInventoryPlan = z.infer<typeof workspaceInventoryPlanSchema>;
export interface WorkspaceInventoryPage {
  setDefaultTimeout(ms: number): void;
  setContent(html: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<void>;
  evaluate<T, A>(fn: (argument: A) => T | Promise<T>, argument: A): Promise<T>;
  screenshot(options: { type: 'png'; fullPage: true; animations: 'disabled'; caret: 'hide'; timeout: number }): Promise<Uint8Array>;
}
export interface WorkspaceInventoryBrowser {
  newContext(options: { viewport: { width: 1280; height: 800 }; deviceScaleFactor: 1; javaScriptEnabled: false;
    serviceWorkers: 'block'; acceptDownloads: false; ignoreHTTPSErrors: false; bypassCSP: false; permissions: []; reducedMotion: 'reduce' }): Promise<{
      route(pattern: '**/*', handler: (route: { abort(): Promise<void> }) => Promise<void>): Promise<void>;
      newPage(): Promise<WorkspaceInventoryPage>; close(): Promise<void>;
    }>;
  close(): Promise<void>;
}
export type WorkspaceInventoryOptions = {
  objects: WorkspacePrivateObjectStore; writeRunArtifact: WorkspaceRuntimeServices['writeRunArtifact'];
  sources: Pick<WorkspacePublicSourceProvider, 'capture' | 'reopen'>;
  /** All configuration is trusted deployment code, never brief/model input. */
  browser?: { review_ref: string; sandboxed: true; launch(options: { headless: true; chromiumSandbox: true; args: [] }): Promise<WorkspaceInventoryBrowser> };
  authorize(scope: WorkspaceSourceScope): Promise<WorkspacePublicSourceAuthorization | null>;
  resolvePlan(context: WorkspaceStageContext, source: Pick<WorkspaceReopenedSource, 'requested_url' | 'final_url' | 'sha256'>): Promise<WorkspaceInventoryPlan | null>;
  timeoutMs?: number;
};
export class WorkspaceInventoryError extends Error { constructor(readonly code: string) { super(code); } }
function gate(value: unknown, code: string): asserts value { if (!value) throw new WorkspaceInventoryError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T { const p = schema.safeParse(value); gate(p.success, code); return p.data; }
function unique<T>(values: T[]) { return new Set(values).size === values.length; }
function publicUrl(value: string) {
  let u: URL; try { u = new URL(value); } catch { throw new WorkspaceInventoryError('INVENTORY_URL_NOT_ALLOWED'); }
  gate(value.length <= 2000 && !/[\u0000-\u0020\u007f\\]/.test(value) && u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash
    && !isIP(u.hostname.replace(/^\[|\]$/g, '')) && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(u.hostname) && u.hostname.includes('.')
    && !u.hostname.split('.').some(p => !p || p.length > 63 || p.startsWith('-') || p.endsWith('-'))
    && !/(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(u.hostname), 'INVENTORY_URL_NOT_ALLOWED');
  for (const key of u.searchParams.keys()) gate(!/(token|secret|password|signature|credential|authorization|session|apikey|auth|code)/i.test(key.replace(/[^a-z]/gi, '')), 'INVENTORY_CREDENTIAL_URL_NOT_ALLOWED');
  return u;
}
async function bounded<T>(signal: AbortSignal, promise: Promise<T>): Promise<T> {
  if (signal.aborted) { void promise.catch(() => undefined); throw new WorkspaceInventoryError('INVENTORY_CANCELLED_OR_TIMED_OUT'); }
  let listener: () => void;
  const cancellation = new Promise<never>((_, reject) => { listener = () => reject(new WorkspaceInventoryError('INVENTORY_CANCELLED_OR_TIMED_OUT')); signal.addEventListener('abort', listener, { once: true }); });
  try { return await Promise.race([promise, cancellation]); } finally { signal.removeEventListener('abort', listener!); }
}
async function close(closeFn: () => Promise<void>) { let timer: ReturnType<typeof setTimeout>; try { await Promise.race([Promise.resolve().then(closeFn).catch(() => undefined), new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]); } finally { clearTimeout(timer!); } }
const sourceMeta = ({ bytes: _, text: __, ...meta }: WorkspaceReopenedSource) => meta;
const objectSchema = z.object({ owner_id: id, task_id: id, storage_key: z.string().max(200), sha256: hash,
  size_bytes: z.number().int().positive().max(WORKSPACE_INVENTORY_LIMITS.image_bytes), media_type: z.enum(['application/json', 'image/png']) }).strict();
const observationSchema = z.object({ state_id: id, variant: text, root_count: z.number().int().nonnegative(),
  signature: z.array(z.string().max(4000)).max(50), identity: z.array(z.string().max(4000)).max(50),
  registry: z.array(z.string().max(4000)).max(100), closure: z.array(z.string().max(4000)).max(50),
  gallery: z.array(z.object({ url: z.string().max(2000), kind: z.enum(['image', 'video']), rule: z.number().int(), node_index: z.number().int().min(-1), tag: z.string().max(30), visible: z.boolean(), loaded: z.boolean() }).strict()).max(100),
  counts: z.array(z.number().int().nonnegative()).max(20),
  details: z.array(z.object({ id, count: z.number().int().nonnegative(), text: z.string().max(16000), visible: z.boolean() }).strict()).max(100),
  media_count: z.number().int().nonnegative(), root_media_count: z.number().int().nonnegative(), embedded_frames: z.number().int().nonnegative(),
  html: z.string().max(WORKSPACE_INVENTORY_LIMITS.dom_bytes), width: z.number().int().positive(), height: z.number().int().positive(),
  interactions: z.array(z.object({ kind: z.string().max(40), selector: z.string().max(300), applied: z.boolean() }).strict()).max(12),
}).strict();
type Observation = z.infer<typeof observationSchema>;

/** Browser-side fixed code. The only argument is validated deployment plan data.
 * No eval, dynamic function, click, submission, event dispatch or source scripts. */
async function observe(argument: { plan: WorkspaceInventoryPlan; state: WorkspaceInventoryPlan['states'][number]; images: Record<string, string>; base_url: string; apply: boolean }): Promise<Observation> {
  const { plan, state } = argument;
  const nodes = [(root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).slice(0, 301)][0];
  // Full-page captures may include nodes outside the current viewport. Test
  // actual rendered state and ancestor clipping, never viewport intersection.
  // Unimplemented masks/filters/clip paths fail closed instead of implying that
  // a nonzero bounding box proves pixels or text were present in the screenshot.
  const visible = [(node: Element) => {
    if (typeof node.checkVisibility === 'function' && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
    const box = node.getBoundingClientRect();
    if (![box.left, box.top, box.right, box.bottom, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return false;
    let left = box.left, top = box.top, right = box.right, bottom = box.bottom, opacity = 1, ancestor: Element | null = node, depth = 0;
    while (ancestor && depth++ < 128) {
      const style = getComputedStyle(ancestor), alpha = style.opacity === '' || style.opacity === undefined ? 1 : Number(style.opacity);
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1 || (opacity *= alpha) <= 0.01 + Number.EPSILON || style.display === 'none'
        || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden' || ancestor.getAttribute('hidden') !== null) return false;
      if ([style.clipPath, style.maskImage, style.filter].some(value => value && value !== 'none') || style.clip && style.clip !== 'auto') return false;
      // Root/body overflow is the document viewport, which a full-page screenshot
      // expands. Nested scroll/overflow containers still clip their descendants.
      if (ancestor !== node && ancestor !== document.documentElement && ancestor !== document.body) {
        const clipX = /^(hidden|clip|scroll|auto)$/.test(style.overflowX || style.overflow), clipY = /^(hidden|clip|scroll|auto)$/.test(style.overflowY || style.overflow);
        if (clipX || clipY) {
          const clip = ancestor.getBoundingClientRect(), element = ancestor as HTMLElement;
          const scaleX = element.offsetWidth > 0 ? clip.width / element.offsetWidth : 1, scaleY = element.offsetHeight > 0 ? clip.height / element.offsetHeight : 1;
          const x = clip.left + ancestor.clientLeft * scaleX, y = clip.top + ancestor.clientTop * scaleY;
          const width = ancestor.clientWidth * scaleX, height = ancestor.clientHeight * scaleY;
          if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return false;
          if (clipX) { left = Math.max(left, x); right = Math.min(right, x + width); }
          if (clipY) { top = Math.max(top, y); bottom = Math.min(bottom, y + height); }
          if (right <= left || bottom <= top) return false;
        }
      }
      ancestor = ancestor.parentElement;
    }
    return ancestor === null;
  }][0];
  const roots = nodes(document, plan.root), root = roots.length === 1 ? roots[0] : document;
  const states = nodes(root, state.root), panel = states.length === 1 ? states[0] : root;
  const logs: Observation['interactions'] = [];
  if (argument.apply) for (const action of state.interactions) {
    const found = nodes(panel, action.selector); let applied = false;
    if (found.length === 1) {
      const node = found[0];
      if (action.kind === 'open_details' && node instanceof HTMLDetailsElement) { node.open = true; applied = node.open; }
      if (action.kind === 'select_native' && node instanceof HTMLSelectElement && Array.from(node.options).some(o => o.value === action.value && !o.disabled)) { node.value = action.value; applied = node.value === action.value; }
      if (action.kind === 'scroll_into_view') { node.scrollIntoView({ block: 'center', behavior: 'instant' }); applied = true; }
    }
    logs.push({ kind: action.kind, selector: action.selector, applied });
  }
  const gallery: Observation['gallery'] = [], counts: number[] = [], decodes: Promise<void>[] = [];
  const rootMedia = [...nodes(root, 'img'), ...nodes(root, 'video')];
  state.gallery.forEach((rule, index) => {
    const found = nodes(panel, rule.selector); counts.push(found.length);
    for (const node of found) {
      const raw = node.getAttribute('data-uid-inventory-original-url') ?? node.getAttribute(rule.attribute) ?? '';
      let url = raw; try { url = new URL(raw, argument.base_url).href; } catch { /* Host rejects invalid URLs. */ }
      if (argument.apply && node instanceof HTMLImageElement && argument.images[url]) {
        node.setAttribute('data-uid-inventory-original-url', raw); node.removeAttribute('srcset');
        const picture = node.parentElement; if (picture?.tagName === 'PICTURE') for (const source of nodes(picture, 'source')) { source.removeAttribute('srcset'); source.removeAttribute('src'); }
        node.loading = 'eager'; node.src = argument.images[url]; decodes.push(node.decode().catch(() => undefined));
      }
      gallery.push({ url, kind: rule.kind, rule: index, node_index: rootMedia.indexOf(node), tag: node.tagName.toLowerCase(), visible: visible(node), loaded: node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0 });
    }
  });
  await Promise.all(decodes);
  // Refresh only loading/visibility after decode; raw original URL is kept above.
  let offset = 0; for (const rule of state.gallery) for (const node of nodes(panel, rule.selector)) {
    gallery[offset].visible = visible(node); gallery[offset++].loaded = node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0;
  }
  const content = [(selector: string) => nodes(root, selector).map(n => (n.textContent ?? '').trim())][0];
  // Strip duplicate inline raster bytes before crossing the browser IPC boundary.
  const html = (root instanceof Element ? root.outerHTML : document.documentElement.outerHTML).replace(/data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/g, '[retained-gallery-raster]').slice(0, 1024 * 1024 + 1);
  return { state_id: state.id, variant: state.variant, root_count: roots.length === 1 ? states.length : 0,
    signature: nodes(root, plan.signature.selector).map(n => n.getAttribute(plan.signature.attribute) ?? ''), identity: content(plan.identity.selector),
    registry: nodes(root, plan.variant_registry.selector).map(n => n.getAttribute(plan.variant_registry.attribute) ?? ''), closure: content(plan.closure_marker.selector),
    gallery, counts, details: state.details.map(d => { const found = nodes(panel, d.selector); return { id: d.id, count: found.length, text: found.map(n => n.textContent ?? '').join('\n').trim(), visible: found.length === 1 && visible(found[0]) }; }),
    media_count: nodes(panel, 'img').length + nodes(panel, 'video').length, root_media_count: rootMedia.length, embedded_frames: nodes(root, 'iframe').length,
    html, width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), interactions: logs };
}

export function createWorkspaceInventoryAdapter(options: WorkspaceInventoryOptions) {
  const timeout = options.timeoutMs ?? WORKSPACE_INVENTORY_LIMITS.timeout_ms;
  gate(Number.isSafeInteger(timeout) && timeout >= 1 && timeout <= WORKSPACE_INVENTORY_LIMITS.max_timeout_ms, 'INVENTORY_TIMEOUT_INVALID');
  // Snapshot callable capabilities; later mutations of caller configuration cannot
  // switch launchers, writers, authorizers or policy resolvers during a capture.
  const config = { ...options, browser: options.browser ? { ...options.browser } : undefined };
  let active = false;
  function readiness() { const ready = !!(config.browser?.sandboxed === true && config.browser.review_ref?.trim() && typeof config.browser.launch === 'function'
    && config.objects && typeof config.writeRunArtifact === 'function' && typeof config.authorize === 'function' && typeof config.resolvePlan === 'function' && typeof config.sources?.capture === 'function' && typeof config.sources?.reopen === 'function');
    return { ready, mode: 'retained_static_document' as const, live_dynamic_supported: false, blockers: ready ? [] : [{ code: 'REVIEWED_STATIC_INVENTORY_NOT_CONFIGURED', message: 'Reviewed sandboxed Chromium, source grants, exact document policy and private custody are required.' }] }; }
  function object(context: WorkspaceStageContext, hash: string, size: number, media_type: string): WorkspaceObjectIdentity {
    return { owner_id: context.owner_id, task_id: context.record.task.task_id, sha256: hash, size_bytes: size, media_type, storage_key: workspaceObjectKey(context.owner_id, context.record.task.task_id, hash) };
  }
  async function read(context: WorkspaceStageContext, identity: WorkspaceObjectIdentity) {
    gate(identity.owner_id === context.owner_id && identity.task_id === context.record.task.task_id && identity.storage_key === workspaceObjectKey(context.owner_id, context.record.task.task_id, identity.sha256)
      && identity.size_bytes > 0 && identity.size_bytes <= WORKSPACE_INVENTORY_LIMITS.image_bytes, 'INVENTORY_OBJECT_SCOPE');
    const opening = config.objects.open(identity); let opened: Awaited<typeof opening>;
    try { opened = await bounded(context.signal, opening); } catch (e) { void opening.then(o => o?.dispose()).catch(() => undefined); throw e; }
    gate(opened, 'INVENTORY_EVIDENCE_MISSING'); const chunks: Uint8Array[] = []; let size = 0; const iterator = opened.stream[Symbol.asyncIterator]();
    try { while (true) { const next = await bounded(context.signal, iterator.next()); if (next.done) break;
      gate(next.value instanceof Uint8Array && (size += next.value.length) <= identity.size_bytes, 'INVENTORY_EVIDENCE_INTEGRITY'); chunks.push(new Uint8Array(next.value)); }
      const bytes = Buffer.concat(chunks); gate(bytes.length === identity.size_bytes && sha(bytes) === identity.sha256, 'INVENTORY_EVIDENCE_INTEGRITY'); return bytes;
    } finally { void iterator.return?.().catch(() => undefined); await close(() => opened!.dispose()); }
  }
  async function write(context: WorkspaceStageContext, bytes: Uint8Array, media: string) {
    gate(!context.signal.aborted, 'INVENTORY_CANCELLED_OR_TIMED_OUT'); const identity = object(context, sha(bytes), bytes.length, media);
    const stored = await bounded(context.signal, config.writeRunArtifact(context, identity, (async function* () { yield bytes; })()));
    gate(digest(identity) === digest(stored), 'INVENTORY_CUSTODY_MISMATCH'); await read(context, identity); return identity;
  }
  async function decode(context: WorkspaceStageContext, png: Uint8Array, width?: number, height?: number) {
    gate(png.length <= WORKSPACE_INVENTORY_LIMITS.image_bytes && Buffer.from(png).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'INVENTORY_PNG_INVALID');
    const { preflightAsset } = await import('./uid-asset-preflight.ts');
    const result = await bounded(context.signal, preflightAsset(Buffer.from(png)));
    gate(result.format === 'png' && result.width * result.height <= WORKSPACE_INVENTORY_LIMITS.pixels
      && (width === undefined || result.width === width) && (height === undefined || result.height === height), 'INVENTORY_SCREENSHOT_MISMATCH');
  }
  async function grant(context: WorkspaceStageContext, scope: WorkspaceSourceScope) {
    const g = await bounded(context.signal, config.authorize(structuredClone(scope)));
    gate(g && id.safeParse(g.authorization_id).success && g.owner_id === scope.owner_id && g.task_id === scope.task_id && g.canonical_version === scope.canonical_version
      && g.source_url === scope.source_url && Date.parse(g.expires_at) > Date.now() && Array.isArray(g.allowed_origins) && g.allowed_origins.length <= 30
      && g.allowed_origins.every(o => publicUrl(o).origin === o) && unique(g.allowed_origins) && g.allowed_origins.includes(publicUrl(scope.source_url).origin), 'INVENTORY_AUTHORIZATION_REQUIRED');
    return g;
  }
  async function inspectInventory(original: WorkspaceStageContext, input: { source: WorkspaceReopenedSource; source_id: string; extraction: WorkspaceResearchExtraction }): Promise<WorkspaceResearchInventory> {
    gate(readiness().ready, 'REVIEWED_STATIC_INVENTORY_NOT_CONFIGURED'); gate(!active, 'INVENTORY_BUSY');
    const context = { ...original, signal: AbortSignal.any([original.signal, AbortSignal.timeout(timeout)]) };
    gate(!context.signal.aborted, 'INVENTORY_CANCELLED_OR_TIMED_OUT'); active = true;
    let browser: WorkspaceInventoryBrowser | undefined; let session: Awaited<ReturnType<WorkspaceInventoryBrowser['newContext']>> | undefined;
    const stop = () => { if (browser) void close(() => browser!.close()); }; context.signal.addEventListener('abort', stop, { once: true });
    try {
      const scope = workspaceSourceScope(context), supplied = input.source, extraction = input.extraction;
      // The original brief may be a collection. A member PDP keeps that exact
      // acquisition scope; its requested/final URL is bound by the reopened
      // capture and reviewed policy below, never by rewriting the source scope.
      gate(context.run.stage === 'research' && digest(supplied.scope) === digest(scope)
        && input.source_id === extraction.source_id && extraction.document_sha256 === supplied.sha256 && extraction.canonical_version === scope.canonical_version, 'INVENTORY_SOURCE_SCOPE');
      const source = await bounded(context.signal, config.sources.reopen(context, supplied.evidence_ref, supplied.scope));
      gate(digest(sourceMeta(source)) === digest(sourceMeta(supplied)) && source.media_type === 'text/html' && source.bytes instanceof Uint8Array && sha(source.bytes) === source.sha256
        && source.bytes.length === source.size_bytes && typeof source.text === 'string' && sha(Buffer.from(source.text)) === source.sha256, 'INVENTORY_SOURCE_INTEGRITY');
      const authorization = await grant(context, scope);
      gate(authorization.allowed_origins.includes(publicUrl(source.requested_url).origin)
        && authorization.allowed_origins.includes(publicUrl(source.final_url).origin), 'INVENTORY_SOURCE_ORIGIN_NOT_AUTHORIZED');
      const plan = parse(workspaceInventoryPlanSchema, await bounded(context.signal, config.resolvePlan(context, { requested_url: source.requested_url, final_url: source.final_url, sha256: source.sha256 })), 'INVENTORY_REVIEWED_PLAN_REQUIRED');
      gate(plan.source_url === source.requested_url && plan.final_url === source.final_url && plan.document_sha256 === source.sha256
        && unique(plan.states.map(s => s.id)) && unique(plan.states.map(s => s.variant)) && unique(plan.image_urls)
        && plan.image_urls.every(u => authorization.allowed_origins.includes(publicUrl(u).origin)) && unique(plan.states.flatMap(s => s.details.map(d => d.id)))
        && plan.states.reduce((n, s) => n + s.gallery.reduce((n, g) => n + g.count, 0), 0) <= WORKSPACE_INVENTORY_LIMITS.images
        && plan.states.flatMap(s => s.details).length <= WORKSPACE_INVENTORY_LIMITS.details, 'INVENTORY_PLAN_BINDING');
      // No goto. A document response becomes inert retained data. Browser networking
      // is aborted at CONTEXT scope (including frames/popups), never continued.
      const launching = config.browser!.launch({ headless: true, chromiumSandbox: true, args: [] });
      try { browser = await bounded(context.signal, launching); } catch (e) { void launching.then(b => close(() => b.close())).catch(() => undefined); throw e; }
      const creating = browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false,
        ignoreHTTPSErrors: false, bypassCSP: false, permissions: [], reducedMotion: 'reduce' });
      try { session = await bounded(context.signal, creating); } catch (e) { void creating.then(s => close(() => s.close())).catch(() => undefined); throw e; }
      let blockedRequests = 0;
      await bounded(context.signal, session.route('**/*', async route => { blockedRequests++; await route.abort(); }));
      const page = await bounded(context.signal, session.newPage()); page.setDefaultTimeout(Math.min(timeout, 15000));
      const csp = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
      const inert = `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">` + source.text;
      await bounded(context.signal, page.setContent(inert, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 15000) }));
      const raw: Observation[] = [];
      for (const state of plan.states) raw.push(parse(observationSchema, await bounded(context.signal, page.evaluate(observe, { plan, state, images: {}, base_url: source.final_url, apply: false })), 'INVENTORY_DOM_INVALID'));
      const actualGallery = raw.flatMap(o => o.gallery.map(g => ({ url: g.url, variant: o.variant, kind: g.kind })));
      const actualDetails = raw.flatMap(o => o.details.map(d => ({ ...d, variant: o.variant })));
      gate(digest(actualGallery) === digest(extraction.gallery.map(g => ({ url: g.url, variant: g.variant, kind: g.kind }))) && unique(extraction.details.map(d => d.id))
        && digest(actualDetails.map(d => d.id).sort()) === digest(extraction.details.map(d => d.id).sort())
        && extraction.details.every(d => actualDetails.some(actual => actual.id === d.id && actual.variant === d.variant && actual.count === 1 && actual.text.includes(d.quote))), 'INVENTORY_EXTRACTION_MISMATCH');
      const discoveredImages = [...new Set(actualGallery.filter(g => g.kind === 'image').map(g => g.url))];
      gate(digest([...discoveredImages].sort()) === digest([...plan.image_urls].sort()), 'INVENTORY_IMAGE_ALLOWLIST_MISMATCH');
      const images: Record<string, string> = Object.create(null), imageEvidence: ReturnType<typeof sourceMeta>[] = []; let totalBytes = source.bytes.length;
      for (const url of discoveredImages) {
        gate(!context.signal.aborted && blockedRequests <= WORKSPACE_INVENTORY_LIMITS.requests, 'INVENTORY_CANCELLED_OR_LIMIT');
        const capture = await bounded(context.signal, config.sources.capture(context, { url, kind: 'image' }));
        const image = await bounded(context.signal, config.sources.reopen(context, capture.evidence_ref, scope));
        gate(digest(capture) === digest(sourceMeta(image)) && digest(image.scope) === digest(scope) && image.requested_url === url
          && authorization.allowed_origins.includes(publicUrl(image.final_url).origin) && /^image\/(png|jpeg|webp)$/.test(image.media_type)
          && image.raster?.technical_validation === 'full_decode_passed' && image.bytes instanceof Uint8Array && sha(image.bytes) === image.sha256 && image.bytes.length === image.size_bytes
          && image.size_bytes <= WORKSPACE_INVENTORY_LIMITS.image_bytes, 'INVENTORY_IMAGE_CUSTODY');
        gate((totalBytes += image.bytes.length) <= WORKSPACE_INVENTORY_LIMITS.total_bytes, 'INVENTORY_TOTAL_BYTE_LIMIT');
        images[url] = `data:${image.media_type};base64,${Buffer.from(image.bytes).toString('base64')}`; imageEvidence.push(sourceMeta(image));
      }
      const members: WorkspaceObjectIdentity[] = [], observed: Omit<Observation, 'html'>[] = [], limitations: string[] = [];
      if (plan.mode === 'partial') limitations.push('The reviewed policy does not establish full static variant/gallery closure. Dynamic/live theme behavior remains uninspected.');
      for (const [index, state] of plan.states.entries()) {
        const result = parse(observationSchema, await bounded(context.signal, page.evaluate(observe, { plan, state, images, base_url: source.final_url, apply: true })), 'INVENTORY_DOM_INVALID');
        gate(result.state_id === state.id && result.variant === state.variant && digest(result.gallery.map(g => ({ url: g.url, kind: g.kind, rule: g.rule, node_index: g.node_index, tag: g.tag }))) === digest(raw[index].gallery.map(g => ({ url: g.url, kind: g.kind, rule: g.rule, node_index: g.node_index, tag: g.tag })))
          && digest(result.details.map(({ visible: _, ...d }) => d)) === digest(raw[index].details.map(({ visible: _, ...d }) => d)), 'INVENTORY_DOM_CHANGED');
        gate(result.width === 1280 && result.height >= 800 && result.width * result.height <= WORKSPACE_INVENTORY_LIMITS.pixels && Buffer.byteLength(result.html) <= WORKSPACE_INVENTORY_LIMITS.dom_bytes
          && blockedRequests <= WORKSPACE_INVENTORY_LIMITS.requests, 'INVENTORY_LAYOUT_LIMIT');
        const allNodeIndexes = raw.flatMap(o => o.gallery.map(g => g.node_index));
        const complete = actualGallery.length > 0 && unique(allNodeIndexes) && allNodeIndexes.every(n => n >= 0) && result.root_media_count === actualGallery.length && result.root_count === 1 && digest(result.signature) === digest([plan.signature.value]) && digest(result.identity) === digest([plan.identity.text])
          && digest(result.closure) === digest([plan.closure_marker.text]) && unique(result.registry) && digest([...result.registry].sort()) === digest(plan.states.map(s => s.id).sort())
          && result.counts.length === state.gallery.length && result.counts.every((count, i) => count === state.gallery[i].count) && result.media_count === result.gallery.length && result.embedded_frames === 0
          && result.gallery.every(g => g.kind === 'image' && g.tag === 'img' && g.loaded && g.visible) && result.details.every(d => d.count === 1 && d.visible)
          && result.interactions.length === state.interactions.length && result.interactions.every(a => a.applied);
        if (!complete) limitations.push(`State ${state.id}: static identity, signature, closure, variant registry, media counts, visibility, loading or supported interactions did not prove complete coverage. Videos are never played by this adapter.`);
        const { html, ...summary } = result; observed.push(summary);
        // DOM evidence retains source DOM, not duplicate base64 raster payloads.
        const dom = Buffer.from(stableJson({ schema_version: 'workspace-inventory-dom/1', scope, run_id: context.run.run_id, document_sha256: source.sha256, policy_sha256: digest(plan),
          observation: summary, html: html.replace(/data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/g, '[retained-gallery-raster]') }));
        gate(dom.length <= WORKSPACE_INVENTORY_LIMITS.dom_bytes && (totalBytes += dom.length) <= WORKSPACE_INVENTORY_LIMITS.total_bytes, 'INVENTORY_TOTAL_BYTE_LIMIT');
        const png = await bounded(context.signal, page.screenshot({ type: 'png', fullPage: true, animations: 'disabled', caret: 'hide', timeout: Math.min(timeout, 15000) }));
        await decode(context, png, result.width, result.height); gate((totalBytes += png.length) <= WORKSPACE_INVENTORY_LIMITS.total_bytes, 'INVENTORY_TOTAL_BYTE_LIMIT');
        members.push(await write(context, dom, 'application/json'), await write(context, png, 'image/png'));
      }
      const manifest = Buffer.from(stableJson({ schema_version: 'workspace-inventory-evidence/1', scope, run_id: context.run.run_id, document_sha256: source.sha256,
        source: sourceMeta(source), source_id: input.source_id, authorization_id: authorization.authorization_id, policy: plan, policy_sha256: digest(plan), browser_review_ref: config.browser!.review_ref,
        members, images: imageEvidence, observed, limitations, inventory_complete: limitations.length === 0, blocked_browser_requests: blockedRequests,
        mode: 'retained_static_document', semantic_inspection: 'not_performed', visual_qc: false, eo_parity: false }));
      gate(manifest.length <= WORKSPACE_INVENTORY_LIMITS.manifest_bytes && (totalBytes += manifest.length) <= WORKSPACE_INVENTORY_LIMITS.total_bytes, 'INVENTORY_MANIFEST_LIMIT');
      const retained = await write(context, manifest, 'application/json');
      return { source_id: input.source_id, document_sha256: source.sha256, scope_sha256: digest(scope), gallery: actualGallery,
        detail_ids: actualDetails.map(d => d.id), images: imageEvidence, inventory_complete: limitations.length === 0, limitations,
        evidence_refs: Array.from({ length: members.length + 1 }, (_, index) => `inventory:${retained.sha256}:${retained.size_bytes}:${index}`),
        method: `Reviewed retained-static-document policy ${plan.policy_id}; exact source SHA-256, native DOM interactions, retained DOM and decoded PNG for each variant. No live scripts, video playback, semantic QC or EO parity.` };
    } finally { context.signal.removeEventListener('abort', stop); if (session) await close(() => session!.close()); if (browser) await close(() => browser!.close()); active = false; }
  }
  async function reopenInventoryEvidence(original: WorkspaceStageContext, evidenceRef: string, documentSha256: string) {
    const context = { ...original, signal: AbortSignal.any([original.signal, AbortSignal.timeout(timeout)]) };
    gate(context.owner_id === context.record.owner_id && hash.safeParse(documentSha256).success, 'INVENTORY_REOPEN_SCOPE');
    const ref = /^inventory:([a-f0-9]{64}):([1-9][0-9]{0,6}):([0-9]{1,2})$/.exec(evidenceRef);
    gate(ref && Number(ref[2]) <= WORKSPACE_INVENTORY_LIMITS.manifest_bytes, 'INVENTORY_EVIDENCE_REF');
    const manifestObject = object(context, ref[1], Number(ref[2]), 'application/json');
    let value: any; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read(context, manifestObject))); } catch (e) { if (e instanceof WorkspaceInventoryError) throw e; throw new WorkspaceInventoryError('INVENTORY_MANIFEST_INVALID'); }
    gate(value && typeof value === 'object' && !Array.isArray(value), 'INVENTORY_MANIFEST_INVALID');
    const scope = value.scope;
    gate(value.schema_version === 'workspace-inventory-evidence/1' && scope?.owner_id === context.owner_id && scope.task_id === context.record.task.task_id
      && scope.canonical_version === context.record.task.snapshot.canonical_version && scope.source_url === context.record.brief.source_url && scope.stage === 'research'
      && value.document_sha256 === documentSha256 && value.source?.sha256 === documentSha256 && digest(value.source.scope) === digest(scope)
      && Array.isArray(value.members) && value.members.length > 0 && value.members.length <= 16 && Number(ref[3]) <= value.members.length, 'INVENTORY_REOPEN_SCOPE');
    const run = [context.run, ...(context.record.runs ?? [])].find(r => r.run_id === value.run_id);
    gate(run && run.stage === 'research' && run.operation_id === scope.operation_id && run.snapshot_id === scope.snapshot_id && run.content_revision === scope.content_revision
      && run.expected_state_version === scope.state_version && ['in_flight', 'succeeded'].includes(run.status), 'INVENTORY_RUN_BINDING');
    const plan = parse(workspaceInventoryPlanSchema, value.policy, 'INVENTORY_MANIFEST_INVALID');
    gate(plan.document_sha256 === documentSha256 && plan.source_url === value.source.requested_url && plan.final_url === value.source.final_url
      && digest(plan) === value.policy_sha256, 'INVENTORY_REOPEN_SCOPE');
    // Reopen the original source, rather than treating a manifest hash as proof of
    // the source-document content or accepting cross-task/canonical reuse.
    const source = await bounded(context.signal, config.sources.reopen(context, value.source.evidence_ref, scope));
    gate(digest(sourceMeta(source)) === digest(value.source) && sha(source.bytes) === documentSha256, 'INVENTORY_SOURCE_INTEGRITY');
    gate(Array.isArray(value.images) && value.images.length <= WORKSPACE_INVENTORY_LIMITS.images && Array.isArray(value.observed) && value.observed.length === plan.states.length
      && value.members.length === 2 * plan.states.length, 'INVENTORY_MANIFEST_INVALID');
    if (Number(ref[3]) === 0) for (const capture of value.images) {
      gate(capture && typeof capture.evidence_ref === 'string' && digest(capture.scope) === digest(scope) && plan.image_urls.includes(capture.requested_url), 'INVENTORY_IMAGE_CUSTODY');
      const raster = await bounded(context.signal, config.sources.reopen(context, capture.evidence_ref, scope));
      gate(digest(sourceMeta(raster)) === digest(capture) && raster.bytes instanceof Uint8Array && raster.bytes.length === capture.size_bytes && sha(raster.bytes) === capture.sha256, 'INVENTORY_IMAGE_CUSTODY');
    }
    const identity = Number(ref[3]) === 0 ? manifestObject : parse(objectSchema, value.members[Number(ref[3]) - 1], 'INVENTORY_MANIFEST_INVALID');
    const bytes = await read(context, identity);
    if (identity.media_type === 'image/png') {
      const stateIndex = Math.floor((Number(ref[3]) - 1) / 2), observation = parse(observationSchema.omit({ html: true }), value.observed[stateIndex], 'INVENTORY_MANIFEST_INVALID');
      await decode(context, bytes, observation.width, observation.height);
    }
    else if (Number(ref[3]) > 0) {
      let dom: any; try { dom = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new WorkspaceInventoryError('INVENTORY_DOM_INVALID'); }
      gate(dom.schema_version === 'workspace-inventory-dom/1' && digest(dom.scope) === digest(scope) && dom.run_id === value.run_id && dom.document_sha256 === documentSha256 && dom.policy_sha256 === value.policy_sha256, 'INVENTORY_REOPEN_SCOPE');
    }
    return { evidence_ref: evidenceRef, document_sha256: documentSha256, object: identity };
  }
  return { readiness, inspectInventory, reopenInventoryEvidence };
}

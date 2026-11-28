import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { bindOnepageUiTemplate, getOnepageUiTemplate } from '../onepage-ui-template.ts';
import { cachedImagePreflight } from './image-preflight-cache.ts';
import { ONEPAGE_DELIVERY_ROLES, onepagePackagePaths, validateOnepagePackagePaths } from '../supabase/functions/_shared/onepage-packaging.ts';
import { readStoredZip, writeStoredZip } from './delivery-zip.ts';
import { previewReviewHtml } from './preview-review.ts';

export type DeliveryAsset = { bytes: Buffer; sha256: string; revision?: number };
export type DeliverySlot = { slot: string; size: string; condition?: string; [key: string]: unknown };
export type DeliveryInput = {
  packet: Record<string, any>; mode: 'gtk' | 'faq'; text: Record<string, string>;
  assets: Record<string, DeliveryAsset>; contentRevision: number; faqCount?: number;
};
export type RenderImage = { bytes: Buffer; sha256: string; width: number; height: number };
export type ViewportCheck = {
  width: number; height: number; documentWidth: number; documentHeight: number;
  brokenImages: string[]; emptyTextSlots: string[]; faqRows: number; faqExpanded: boolean;
  iconDisplays: { slot: string; width: number; height: number }[];
};
export type RenderedOnepage = {
  schemaVersion: 'uid.v2.render/1'; inputHash: string; contentRevision: number;
  html: string; css: string; boundHtmlHash: string; templateVersion: string;
  templateHashes: { html: string; css: string }; desktop: RenderImage; mobile: RenderImage;
  checks: ViewportCheck[]; renderedAt: string; visualQcPerformed: false;
};
export type DeliveryApproval = { inputHash: string; contentRevision: number; reviewer: string; approvedAt: string };
export type DeliveryVisualReview = {
  inputHash: string; desktopHash: string; mobileHash: string; reviewer: string;
  method: 'host_visual' | 'human_visual'; observations: string; reviewedAt: string;
};
export const deliveryHash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable((value as any)[k])).join(',') + '}';
  return JSON.stringify(value);
};
const revisionValid = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0;
const hashValid = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);

/** Derive the exact current branch inventory from the pinned compiler packet. */
export function deliverySlots(packet: Record<string, any>, mode: 'gtk' | 'faq'): DeliverySlot[] {
  if (!['gtk', 'faq'].includes(mode) || !Array.isArray(packet.assets) || !packet.assets.length || packet.assets.length > 24) throw Error('CANONICAL_ASSET_MANIFEST_REQUIRED');
  const seen = new Set<string>();
  for (const asset of packet.assets) {
    if (!asset || typeof asset.slot !== 'string' || typeof asset.size !== 'string' || seen.has(asset.slot) ||
        ![undefined, 'ONLY_WHEN_GTK_SELECTED'].includes(asset.condition)) throw Error('INVALID_CANONICAL_ASSET_MANIFEST');
    if (asset.slot !== 'ui_mapping_preview' && !Object.hasOwn(ONEPAGE_DELIVERY_ROLES, asset.slot)) throw Error('UNSUPPORTED_CANONICAL_SLOT:' + asset.slot);
    if (asset.condition === 'ONLY_WHEN_GTK_SELECTED' && !asset.slot.startsWith('gtk_')) throw Error('UNSUPPORTED_CANONICAL_CONDITION');
    seen.add(asset.slot);
  }
  const slots = packet.assets.filter((a: DeliverySlot) => a.slot !== 'ui_mapping_preview' && (mode === 'gtk' || a.condition !== 'ONLY_WHEN_GTK_SELECTED'));
  const expected = Object.keys(ONEPAGE_DELIVERY_ROLES).filter(s => mode === 'gtk' || !s.startsWith('gtk_'));
  if (!seen.has('ui_mapping_preview') || slots.length !== expected.length || expected.some(s => !slots.some((a: DeliverySlot) => a.slot === s))) throw Error('CANONICAL_SLOT_COVERAGE_MISMATCH');
  return slots;
}

/** Server byte inspection. No caller-provided dimensions/format/inspection flags are trusted. */
export async function validateAssetBytes(bytes: Buffer, spec: Pick<DeliverySlot, 'slot' | 'size'>, expectedHash?: string) {
  const { slot, size } = spec;
  const receipt = await cachedImagePreflight(bytes, expectedHash);
  const isOverall = slot === 'ui_mapping_preview';
  if (receipt.format !== (isOverall ? 'png' : 'webp')) throw Error('CANONICAL_ASSET_FORMAT:' + slot);
  const dimensions = /^(\d+)x(\d+)$/.exec(size);
  if (dimensions) {
    if (receipt.width !== Number(dimensions[1]) || receipt.height !== Number(dimensions[2])) throw Error('CANONICAL_ASSET_DIMENSIONS:' + slot);
  } else if (!(size === '3x_UI_DISPLAY_SIZE' && /^occasion_icon_0[1-4]$/.test(slot)) && !(size === 'full_page' && isOverall)) {
    throw Error('UNKNOWN_CANONICAL_ASSET_SIZE:' + slot);
  }
  return receipt;
}

async function prepare(incoming: DeliveryInput) {
  if (!revisionValid(incoming.contentRevision) || !incoming.packet || !incoming.assets || typeof incoming.assets !== 'object' || Array.isArray(incoming.assets)) throw Error('INVALID_DELIVERY_INPUT');
  // Capture the entire input before the first await, including mutable byte buffers.
  const input: DeliveryInput = { ...incoming, packet: structuredClone(incoming.packet), text: structuredClone(incoming.text),
    assets: Object.fromEntries(Object.entries(incoming.assets).map(([slot, asset]) => {
      if (!asset || !Buffer.isBuffer(asset.bytes)) throw Error('INVALID_DELIVERY_ASSET:' + slot);
      return [slot, { ...asset, bytes: Buffer.from(asset.bytes) }];
    })) };
  const slots = deliverySlots(input.packet, input.mode);
  if (Object.keys(input.assets).length !== slots.length || Object.keys(input.assets).some(s => !slots.some(a => a.slot === s))) throw Error('EXACT_ASSET_SET_REQUIRED');
  const pinned = input.packet.ui_mapping_templates?.[input.mode];
  if (!pinned || typeof pinned.version !== 'string' || !hashValid(pinned.sha256?.html) || !hashValid(pinned.sha256?.css)) throw Error('PINNED_TEMPLATE_REQUIRED');
  if (input.packet.template_policy_compatibility?.status !== 'COMPATIBLE') throw Error('TEMPLATE_POLICY_NOT_COMPATIBLE');
  const local = getOnepageUiTemplate(pinned.version, 'source') as ReturnType<typeof getOnepageUiTemplate> & { html: string; css: string };
  if (local.post_story_section !== input.mode || local.sha256.html !== pinned.sha256.html || local.sha256.css !== pinned.sha256.css ||
      deliveryHash(local.html) !== pinned.sha256.html || deliveryHash(local.css) !== pinned.sha256.css ||
      stable(local.asset_slots) !== stable(pinned.asset_slots) || stable(local.text_slots) !== stable(pinned.text_slots)) throw Error('PINNED_TEMPLATE_MISMATCH');
  const receipts: Record<string, Awaited<ReturnType<typeof validateAssetBytes>>> = Object.create(null);
  const files = new Map<string, Buffer>(), assetPaths: Record<string, string> = Object.create(null);
  for (const spec of slots) {
    const asset = input.assets[spec.slot];
    if (!asset || !hashValid(asset.sha256) || !Buffer.isBuffer(asset.bytes) || (asset.revision !== undefined && (!revisionValid(asset.revision) || asset.revision > input.contentRevision))) throw Error('INVALID_DELIVERY_ASSET:' + spec.slot);
    const bytes = asset.bytes;
    receipts[spec.slot] = await validateAssetBytes(bytes, spec, asset.sha256);
    const path = 'assets/' + asset.sha256 + '.webp';
    files.set('/' + path, bytes); assetPaths[spec.slot] = path;
  }
  const aliases = input.packet.template_asset_bindings;
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) throw Error('CANONICAL_TEMPLATE_BINDINGS_REQUIRED');
  const assets: Record<string, string> = Object.create(null);
  for (const templateSlot of local.asset_slots) {
    const sourceSlot = Object.hasOwn(aliases, templateSlot) ? aliases[templateSlot] : templateSlot;
    if (typeof sourceSlot !== 'string' || !Object.hasOwn(assetPaths, sourceSlot)) throw Error('UNBOUND_CANONICAL_SLOT:' + templateSlot);
    assets[templateSlot] = assetPaths[sourceSlot];
  }
  const bindings = { text: structuredClone(input.text), assets, ...(input.mode === 'faq' ? { faq_count: input.faqCount } : {}) };
  if (input.mode === 'gtk' && input.faqCount !== undefined) throw Error('FAQ_COUNT_FORBIDDEN_IN_GTK');
  const bound = bindOnepageUiTemplate(pinned.version, bindings);
  const inputHash = deliveryHash(stable({ revision: input.contentRevision, mode: input.mode, templateVersion: pinned.version,
    templateHashes: pinned.sha256, text: bindings.text, faqCount: input.faqCount ?? null,
    assets: Object.fromEntries(slots.map(s => [s.slot, input.assets[s.slot].sha256])), aliases, slots }));
  return { input, slots, receipts, files, bound, inputHash, pinned };
}

/** Actual Chromium renderer. All resources come from already-verified local bytes.
 * JS/service workers are disabled and every request is intercepted; no remote URL is fetched.
 * Technical checks never become semantic/visual QA approval.
 */
export async function renderOnepage(input: DeliveryInput): Promise<RenderedOnepage> {
  const p = await prepare(input);
  input = p.input;
  const browser = await chromium.launch({ headless: true, timeout: 30_000 });
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', deviceScaleFactor: 1 });
  try {
    const resources = new Map<string, { contentType: string; body: Buffer | string }>([
      ['/index.html', { contentType: 'text/html; charset=utf-8', body: p.bound.html }],
      ['/styles.css', { contentType: 'text/css; charset=utf-8', body: p.bound.css }],
      ...[...p.files].map(([path, body]) => [path, { contentType: 'image/webp', body }] as [string, { contentType: string; body: Buffer }]),
    ]);
    const rejected: string[] = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const resource = url.origin === 'https://uid-v2-render.invalid' && !url.search ? resources.get(url.pathname) : undefined;
      if (resource) await route.fulfill({ status: 200, ...resource });
      else { rejected.push(url.protocol + '//' + url.hostname + url.pathname); await route.abort(); }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const checks: ViewportCheck[] = [];
    const screenshots: Record<string, RenderImage> = {};
    for (const viewport of [{ name: 'desktop', width: 1440 }, { name: 'mobile', width: 390 }, { name: 'breakpoint798', width: 798 }, { name: 'breakpoint799', width: 799 }]) {
      await page.setViewportSize({ width: viewport.width, height: 900 });
      await page.goto('https://uid-v2-render.invalid/index.html', { waitUntil: 'load', timeout: 20_000 });
      await page.evaluate(async () => { await document.fonts.ready; });
      const check = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
        brokenImages: [...document.images].filter(img => !img.complete || !img.naturalWidth).map(img => img.dataset.assetSlot || 'fixed_ui'),
        emptyTextSlots: [...document.querySelectorAll('[data-text-slot]')].filter(el => !el.textContent?.trim()).map(el => el.getAttribute('data-text-slot') || ''),
        faqRows: document.querySelectorAll('[data-faq-item]').length,
        faqExpanded: [...document.querySelectorAll('details.uid-faq-entry')].every(el => el.hasAttribute('open')) && !document.querySelector('.uid-product-content-faqs input[type=checkbox]'),
        iconDisplays: [...document.querySelectorAll<HTMLImageElement>('img[data-asset-slot^="occasion_icon_"]')].map(el => ({ slot: el.dataset.assetSlot!, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
      }));
      if (check.documentWidth > viewport.width + 1 || check.documentHeight <= 900 || check.documentHeight > 20_000 || viewport.width * check.documentHeight > 32_000_000 ||
          check.brokenImages.length || check.emptyTextSlots.length || !check.faqExpanded ||
          check.faqRows !== (input.mode === 'faq' ? input.faqCount : 0) || check.iconDisplays.length !== 4) throw Error('RENDER_TECHNICAL_CHECK_FAILED:' + JSON.stringify(check));
      for (const icon of check.iconDisplays) {
        const source = p.receipts[icon.slot];
        if (!source || icon.width <= 0 || icon.height <= 0 || source.width < Math.ceil(icon.width * 3) || source.height < Math.ceil(icon.height * 3)) throw Error('ICON_3X_DISPLAY_SIZE:' + icon.slot + ':' + viewport.width);
      }
      checks.push(check);
      if (viewport.name === 'desktop' || viewport.name === 'mobile') {
        const bytes = await page.screenshot({ type: 'png', fullPage: true, timeout: 20_000 });
        const receipt = await validateAssetBytes(bytes, { slot: 'ui_mapping_preview', size: 'full_page' });
        screenshots[viewport.name] = { bytes, sha256: receipt.sha256, width: receipt.width, height: receipt.height };
      }
    }
    if (rejected.length) throw Error('RENDER_EXTERNAL_RESOURCE_BLOCKED');
    return { schemaVersion: 'uid.v2.render/1', inputHash: p.inputHash, contentRevision: input.contentRevision,
      html: p.bound.html, css: p.bound.css, boundHtmlHash: p.bound.sha256.html, templateVersion: p.pinned.version,
      templateHashes: { html: p.pinned.sha256.html, css: p.pinned.sha256.css }, desktop: screenshots.desktop, mobile: screenshots.mobile,
      checks, renderedAt: new Date().toISOString(), visualQcPerformed: false };
  } finally { await context.close(); await browser.close(); }
}

const validTimestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 60_000;

function assertCurrentRender(p: Awaited<ReturnType<typeof prepare>>, render: RenderedOnepage) {
  if (!render || render.schemaVersion !== 'uid.v2.render/1' || render.inputHash !== p.inputHash || render.contentRevision !== p.input.contentRevision ||
      render.html !== p.bound.html || render.css !== p.bound.css || render.boundHtmlHash !== deliveryHash(render.html) ||
      render.templateVersion !== p.pinned.version || render.templateHashes?.html !== p.pinned.sha256.html || render.templateHashes?.css !== p.pinned.sha256.css) throw Error('STALE_OR_CHANGED_RENDER');
}

async function validateScreenshots(render: RenderedOnepage) {
  for (const [name, width] of [['desktop', 1440], ['mobile', 390]] as const) {
    const image = render[name];
    const decoded = await validateAssetBytes(image.bytes, { slot: 'ui_mapping_preview', size: 'full_page' }, image.sha256);
    const check = render.checks?.find(c => c.width === width);
    if (!check || decoded.width !== width || decoded.width !== image.width || decoded.height !== image.height || decoded.height !== check.documentHeight) throw Error('RENDER_IMAGE_DIMENSIONS_CHANGED');
  }
}

/** Separate, offline review deliverable. Never changes the canonical image-only
 * production ZIP and never constitutes final approval or visual review.
 */
export async function createPreviewBundle(input: DeliveryInput, render: RenderedOnepage, context: { jobId: string; contentRevision: number }) {
  if (!context || !/^[a-zA-Z0-9_-]{1,128}$/.test(context.jobId) || context.contentRevision !== input.contentRevision) throw Error('INVALID_PREVIEW_IDENTITY');
  const p = await prepare(input);
  assertCurrentRender(p, render);
  await validateScreenshots(render);
  const identity = { jobId: context.jobId, contentRevision: p.input.contentRevision, inputHash: p.inputHash,
    boundHtmlHash: render.boundHtmlHash, templateVersion: render.templateVersion,
    assetHashes: Object.fromEntries(p.slots.map(s => [s.slot, p.receipts[s.slot].sha256])), text: p.input.text };
  const entries = [
    { name: 'index.html', bytes: Buffer.from(p.bound.html) }, { name: 'styles.css', bytes: Buffer.from(p.bound.css) },
    ...[...p.files].map(([path, bytes]) => ({ name: path.slice(1), bytes })),
    { name: 'review.html', bytes: Buffer.from(previewReviewHtml(identity)) },
    { name: 'desktop.png', bytes: Buffer.from(render.desktop.bytes) }, { name: 'mobile.png', bytes: Buffer.from(render.mobile.bytes) },
  ];
  const coreManifest = { schemaVersion: 'uid.v2.preview-bundle/1', status: 'TECHNICAL_PREVIEW_ONLY', ...identity,
    templateHashes: render.templateHashes, desktopHash: render.desktop.sha256, mobileHash: render.mobile.sha256,
    assetMappings: Object.fromEntries(p.slots.map(s => [s.slot, 'assets/' + p.receipts[s.slot].sha256 + '.webp'])),
    templateAssetBindings: structuredClone(p.input.packet.template_asset_bindings),
    files: entries.map(e => ({ path: e.name, sha256: deliveryHash(e.bytes), byteLength: e.bytes.length })),
    feedback: { mode: 'COPY_PROMPT_ONLY', schemaVersion: 'uid.v2.grouped-feedback/1', automaticSubmission: false, approval: false, training: false, publishing: false },
    freshness: 'Offline snapshot. Receiving host must verify every identity and asset hash against current authenticated job state before applying feedback.',
    visualQcPerformedByServer: false };
  entries.push({ name: 'preview-manifest.json', bytes: Buffer.from(JSON.stringify(coreManifest, null, 2)) });
  const zip = writeStoredZip(entries), reopened = readStoredZip(zip);
  if (reopened.length !== entries.length || reopened.some((entry, i) => entry.name !== entries[i].name || !entry.bytes.equals(entries[i].bytes))) throw Error('PREVIEW_ARCHIVE_VERIFICATION_FAILED');
  const sha256 = deliveryHash(zip);
  return { zip, sha256, manifest: { ...coreManifest, archiveSha256: sha256, archiveBytes: zip.length, archiveReopened: true, crc: 'PASSED',
    manifestSha256: deliveryHash(entries.at(-1)!.bytes) } };
}

/** Called with owner-authorized records loaded by the orchestrator, not arbitrary host
 * supplied render/approval objects. Revalidates bytes immediately before and after ZIP.
 */
export async function packageOnepage(args: {
  input: DeliveryInput; render: RenderedOnepage; productLineName: string; productSlug: string;
  approval: DeliveryApproval; visualReview: DeliveryVisualReview;
}) {
  const { render, approval, visualReview } = args, p = await prepare(args.input), input = p.input;
  assertCurrentRender(p, render);
  if (!approval || approval.inputHash !== p.inputHash || approval.contentRevision !== input.contentRevision || !approval.reviewer?.trim() || !validTimestamp(approval.approvedAt)) throw Error('CURRENT_REVIEW_APPROVAL_REQUIRED');
  if (!visualReview || visualReview.inputHash !== p.inputHash || visualReview.desktopHash !== render.desktop.sha256 || visualReview.mobileHash !== render.mobile.sha256 ||
      !visualReview.reviewer?.trim() || !['host_visual', 'human_visual'].includes(visualReview.method) || visualReview.observations?.trim().length < 20 || !validTimestamp(visualReview.reviewedAt)) throw Error('CURRENT_DESKTOP_MOBILE_VISUAL_REVIEW_REQUIRED');
  if (!validTimestamp(render.renderedAt) || Date.parse(approval.approvedAt) < Date.parse(render.renderedAt) || Date.parse(visualReview.reviewedAt) < Date.parse(render.renderedAt) || Date.parse(approval.approvedAt) < Date.parse(visualReview.reviewedAt)) throw Error('REVIEW_PRECEDES_CURRENT_RENDER');
  await validateScreenshots(render);
  if (input.packet.packaging_contract?.status !== 'READY_AFTER_QA_AND_FINAL_OUTCOME_REVIEW') throw Error('CANONICAL_PACKAGING_BLOCKED');
  const expected = onepagePackagePaths(args.productLineName, args.productSlug, input.mode);
  const root = `Onepage - ${args.productLineName}`;
  const entries = p.slots.map(spec => ({ name: `${root}/onepage-${args.productSlug}-${ONEPAGE_DELIVERY_ROLES[spec.slot]}.webp`, bytes: p.files.get('/assets/' + p.receipts[spec.slot].sha256 + '.webp')!, slot: spec.slot, spec }));
  entries.push({ name: `${root}/onepage_${args.productSlug}-overall.png`, bytes: Buffer.from(render.desktop.bytes), slot: 'ui_mapping_preview', spec: { slot: 'ui_mapping_preview', size: 'full_page' } });
  const zip = writeStoredZip(entries), reopened = readStoredZip(zip);
  const pathCheck = validateOnepagePackagePaths(reopened.map(e => e.name), args.productLineName, args.productSlug, input.mode);
  if (pathCheck.status !== 'VALID_NAMES_ONLY' || reopened.length !== expected.length) throw Error('ARCHIVE_PATH_VALIDATION_FAILED');
  const files = [];
  for (const entry of reopened) {
    const source = entries.find(e => e.name === entry.name)!;
    const receipt = await validateAssetBytes(entry.bytes, source.spec, deliveryHash(source.bytes));
    files.push({ path: entry.name, slot: source.slot, sha256: receipt.sha256, format: receipt.format, width: receipt.width, height: receipt.height, byteLength: receipt.byte_length });
  }
  const manifest = { schemaVersion: 'uid.v2.delivery/1', status: 'TECHNICAL_PACKAGE_VERIFIED', inputHash: p.inputHash, contentRevision: input.contentRevision,
    templateVersion: render.templateVersion, templateHashes: render.templateHashes, boundHtmlHash: render.boundHtmlHash,
    files, archiveSha256: deliveryHash(zip), archiveBytes: zip.length, archiveReopened: true, crc: 'PASSED', imageDecode: 'FULL_PIXEL_DECODE_PASSED',
    approval: structuredClone(approval), visualReview: structuredClone(visualReview), desktopHash: render.desktop.sha256, mobileHash: render.mobile.sha256,
    visualQcPerformedByServer: false, limitations: 'Semantic and visual review is the linked host/human attestation; the delivery engine proves bytes, binding, dimensions, rendering and archive integrity only.' };
  return { zip, sha256: manifest.archiveSha256, manifest };
}

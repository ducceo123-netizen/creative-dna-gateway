import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from '../tools/creative-quality/sharp.ts';
import { buildOnepagePacket } from '../supabase/functions/_shared/onepage-packet.ts';
import { getOnepageUiTemplate } from '../onepage-ui-template.ts';
import { onepagePackagePaths } from '../supabase/functions/_shared/onepage-packaging.ts';
import { deliveryHash, deliverySlots, validateAssetBytes, renderOnepage, packageOnepage, createPreviewBundle, type DeliveryInput, type RenderedOnepage } from './delivery.ts';
import { readStoredZip, writeStoredZip } from './delivery-zip.ts';
import { previewReviewHtml } from './preview-review.ts';

/** Deliberately synthetic mechanical fixture; no product evidence, creative approval or EO claim. */
async function fixture(mode: 'gtk' | 'faq'): Promise<DeliveryInput> {
  const packet: Record<string, any> = await buildOnepagePacket({
    brand: { slug: 'pawfecthouse' }, branch: { slug: 'onepage-system', version: 'synthetic', content_md: 'Synthetic mechanics fixture only.' },
  });
  const gtk = getOnepageUiTemplate(), faq = getOnepageUiTemplate(gtk.variants.faq);
  packet.ui_mapping_templates = { gtk, faq };
  packet.template_policy_compatibility = { status: 'COMPATIBLE' };
  packet.packaging_contract.status = 'READY_AFTER_QA_AND_FINAL_OUTCOME_REVIEW';
  const t = packet.ui_mapping_templates[mode];
  const textSlots = mode === 'faq' ? [...t.text_slots.filter((s: string) => !/^faq_(question|answer)_/.test(s)), ...['01', '02', '03'].flatMap(n => ['faq_question_' + n, 'faq_answer_' + n])] : t.text_slots;
  const assets: DeliveryInput['assets'] = Object.create(null);
  for (const [i, spec] of deliverySlots(packet, mode).entries()) {
    const dimensions = /^(\d+)x(\d+)$/.exec(spec.size);
    const width = dimensions ? Number(dimensions[1]) : 600, height = dimensions ? Number(dimensions[2]) : 600;
    const bytes = await sharp({ create: { width, height, channels: 4, background: { r: 50 + i * 7, g: 115, b: 170, alpha: 1 } } }).webp({ lossless: true }).toBuffer();
    assets[spec.slot] = { bytes, sha256: deliveryHash(bytes), revision: 1 };
  }
  return { packet, mode, text: Object.fromEntries(textSlots.map((s: string) => [s, s.startsWith('title_') ? 'Synthetic Test' : 'Synthetic layout validation only.'])),
    assets, contentRevision: 1, ...(mode === 'faq' ? { faqCount: 3 } : {}) };
}
function review(render: RenderedOnepage) {
  const now = new Date().toISOString();
  return {
    approval: { inputHash: render.inputHash, contentRevision: render.contentRevision, reviewer: 'synthetic-test-reviewer', approvedAt: now },
    visualReview: { inputHash: render.inputHash, desktopHash: render.desktop.sha256, mobileHash: render.mobile.sha256,
      reviewer: 'synthetic-test-reviewer', method: 'human_visual' as const, observations: 'Synthetic attestation used only to exercise the release gate; no creative EO approval.', reviewedAt: now },
  };
}

test('store-only ZIP reopens canonical Unicode/space roots and rejects byte/path/directory corruption', () => {
  const entries = [{ name: 'Onepage - Café Ornament/onepage-cafe_ornament-banner.webp', bytes: Buffer.from('test image bytes') }];
  const zip = writeStoredZip(entries);
  assert.deepEqual(readStoredZip(zip), entries);
  const corrupt = Buffer.from(zip); corrupt[30 + Buffer.byteLength(entries[0].name)] ^= 1;
  assert.throws(() => readStoredZip(corrupt), /ZIP_CRC_MISMATCH/);
  const offset = Buffer.from(zip); offset.writeUInt32LE(1, offset.length - 6);
  assert.throws(() => readStoredZip(offset), /ZIP_DIRECTORY/);
  assert.throws(() => readStoredZip(Buffer.concat([zip, Buffer.from('trailing')])), /ZIP_FOOTER/);
  assert.throws(() => writeStoredZip([...entries, ...entries]), /DUPLICATE/);
  for (const name of ['../escape', '/absolute', 'a/../x', 'a\\x', 'a//x', 'C:/x', 'a/./x', 'a\u0000x']) assert.throws(() => writeStoredZip([{ name, bytes: Buffer.from('x') }]), /UNSAFE/);
});

test('asset validation decodes bytes, detects claimed format/hash/size mismatches and fails unknown scope', async () => {
  const bytes = await sharp({ create: { width: 732, height: 480, channels: 3, background: '#aa8844' } }).webp().toBuffer();
  const good = await validateAssetBytes(bytes, { slot: 'wyl_01', size: '732x480' }, deliveryHash(bytes));
  assert.equal(good.decode, 'FULL_PIXEL_DECODE_PASSED'); assert.equal(good.visual_qc_performed, false);
  await assert.rejects(validateAssetBytes(bytes, { slot: 'wyl_01', size: '950x950' }), /DIMENSIONS/);
  await assert.rejects(validateAssetBytes(bytes, { slot: 'wyl_01', size: '732x480' }, '0'.repeat(64)), /HASH_MISMATCH/);
  await assert.rejects(validateAssetBytes(bytes, { slot: 'wyl_01', size: 'unknown' }), /UNKNOWN_CANONICAL/);
  const png = await sharp(bytes).png().toBuffer();
  await assert.rejects(validateAssetBytes(png, { slot: 'wyl_01', size: '732x480' }), /FORMAT/);
  await assert.rejects(validateAssetBytes(bytes.subarray(0, 30), { slot: 'wyl_01', size: '732x480' }));
  const f = await fixture('faq');
  assert.equal(deliverySlots(f.packet, 'faq').length, 15);
  f.packet.assets.push({ slot: 'unknown_required_slot', size: '100x100' });
  assert.throws(() => deliverySlots(f.packet, 'faq'), /UNSUPPORTED_CANONICAL_SLOT/);
});

for (const mode of ['gtk', 'faq'] as const) test(`actual ${mode.toUpperCase()} template renders four viewports and reopened package preserves exact bytes`, { timeout: 120_000 }, async () => {
  const input = await fixture(mode), rendered = await renderOnepage(input);
  assert.equal(rendered.visualQcPerformed, false);
  assert.deepEqual(rendered.checks.map(c => c.width), [1440, 390, 798, 799]);
  assert.equal(rendered.css, (getOnepageUiTemplate(rendered.templateVersion, 'source') as any).css);
  assert.equal(rendered.desktop.width, 1440); assert.equal(rendered.mobile.width, 390);
  assert.ok(rendered.desktop.bytes.length > 10_000);
  assert.equal(rendered.html.includes('{{'), false);
  assert.ok(rendered.html.includes('assets/' + input.assets.detail_main.sha256 + '.webp'));
  assert.ok(rendered.checks.every(c => !c.brokenImages.length && !c.emptyTextSlots.length && c.faqExpanded));
  assert.ok(rendered.checks.every(c => c.faqRows === (mode === 'faq' ? 3 : 0)));
  if (mode === 'faq') { assert.doesNotMatch(rendered.html, /data-asset-slot="gtk_/); assert.match(rendered.html, /<details class="uid-faq-entry" open>/); }
  const args = { input, render: rendered, productLineName: 'Synthetic Ornament', productSlug: 'synthetic_ornament', ...review(rendered) };
  const result = await packageOnepage(args), reopened = readStoredZip(result.zip);
  assert.deepEqual(reopened.map(e => e.name).sort(), onepagePackagePaths(args.productLineName, args.productSlug, mode).sort());
  assert.equal(result.manifest.archiveReopened, true); assert.equal(result.manifest.crc, 'PASSED');
  assert.equal(result.manifest.visualQcPerformedByServer, false);
  assert.equal(result.manifest.files.length, mode === 'gtk' ? 19 : 16);
  assert.equal(deliveryHash(reopened.find(e => e.name.endsWith('-banner.webp'))!.bytes), input.assets.banner_desktop.sha256);
  assert.ok(reopened.find(e => e.name.endsWith('-overall.png'))!.bytes.equals(rendered.desktop.bytes));
  await assert.rejects(packageOnepage({ ...args, approval: undefined as any }), /APPROVAL_REQUIRED/);
  await assert.rejects(packageOnepage({ ...args, visualReview: { ...args.visualReview, mobileHash: '0'.repeat(64) } }), /VISUAL_REVIEW_REQUIRED/);
  await assert.rejects(packageOnepage({ ...args, approval: { ...args.approval, contentRevision: 2 } }), /APPROVAL_REQUIRED/);
  await assert.rejects(packageOnepage({ ...args, input: { ...input, text: { ...input.text, title_01: 'Changed copy' } } }), /STALE_OR_CHANGED_RENDER/);
  await assert.rejects(packageOnepage({ ...args, input: { ...input, contentRevision: 2 } }), /STALE_OR_CHANGED_RENDER/);
  const screenshot = Buffer.from(rendered.mobile.bytes); screenshot[screenshot.length - 20] ^= 1;
  await assert.rejects(packageOnepage({ ...args, render: { ...rendered, mobile: { ...rendered.mobile, bytes: screenshot } } }), /HASH_MISMATCH/);
  const context = { jobId: 'synthetic-job-1', contentRevision: input.contentRevision };
  const preview = await createPreviewBundle(input, rendered, context), previewEntries = readStoredZip(preview.zip);
  assert.ok(previewEntries.length <= 24); assert.equal(preview.manifest.archiveReopened, true); assert.equal(preview.manifest.crc, 'PASSED');
  assert.equal(previewEntries.find(e => e.name === 'index.html')!.bytes.toString(), rendered.html);
  assert.equal(previewEntries.find(e => e.name === 'styles.css')!.bytes.toString(), rendered.css);
  assert.equal(preview.manifest.boundHtmlHash, rendered.boundHtmlHash); assert.equal(preview.manifest.contentRevision, input.contentRevision);
  assert.deepEqual(preview.manifest.templateHashes, rendered.templateHashes);
  for (const [slot, asset] of Object.entries(input.assets)) {
    assert.equal(preview.manifest.assetHashes[slot], asset.sha256);
    const file = previewEntries.find(e => e.name === preview.manifest.assetMappings[slot]);
    assert.ok(file!.bytes.equals(asset.bytes));
  }
  const embeddedManifest = JSON.parse(previewEntries.find(e => e.name === 'preview-manifest.json')!.bytes.toString());
  assert.equal(embeddedManifest.inputHash, rendered.inputHash); assert.equal(embeddedManifest.feedback.automaticSubmission, false);
  assert.equal(preview.manifest.manifestSha256, deliveryHash(previewEntries.find(e => e.name === 'preview-manifest.json')!.bytes));
  const corruptPreview = Buffer.from(preview.zip); corruptPreview[40] ^= 1;
  assert.throws(() => readStoredZip(corruptPreview), /ZIP_CRC_MISMATCH/);
  await assert.rejects(createPreviewBundle(input, rendered, { ...context, contentRevision: 2 }), /INVALID_PREVIEW_IDENTITY/);
  await assert.rejects(createPreviewBundle({ ...input, contentRevision: 2 }, rendered, { ...context, contentRevision: 2 }), /STALE_OR_CHANGED_RENDER/);
  const changedMapping = structuredClone(input.packet); changedMapping.template_asset_bindings.occasion_story_01 = 'occasion_02';
  await assert.rejects(createPreviewBundle({ ...input, packet: changedMapping }, rendered, context), /STALE_OR_CHANGED_RENDER/);
  await assert.rejects(createPreviewBundle(input, { ...rendered, templateVersion: 'changed' }, context), /STALE_OR_CHANGED_RENDER/);
  if (mode === 'gtk') {
    const dir = await mkdtemp(join(tmpdir(), 'uid-v2-review-test-')), browser = await chromium.launch({ headless: true });
    try {
      for (const entry of previewEntries) { if (entry.name.startsWith('assets/')) await mkdir(join(dir, 'assets'), { recursive: true }); await writeFile(join(dir, entry.name), entry.bytes); }
      const page = await browser.newPage(); const external: string[] = [];
      await page.route('**/*', route => { if (/^(file:|data:)/.test(route.request().url())) return route.continue(); external.push(route.request().url()); return route.abort(); });
      await page.goto(pathToFileURL(join(dir, 'review.html')).href);
      await page.locator('#target').selectOption('asset:banner_desktop'); await page.locator('#note').fill('Make the banner crop clearer.'); await page.locator('#add').click();
      const prompt = await page.locator('#prompt').inputValue(); const feedback = JSON.parse(prompt.slice(prompt.indexOf('{')));
      assert.equal(feedback.jobId, context.jobId); assert.equal(feedback.inputHash, rendered.inputHash);
      assert.equal(feedback.feedback[0].currentSha256, input.assets.banner_desktop.sha256);
      assert.equal(await page.frameLocator('#preview').locator('img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), true);
      await page.locator('#width-390').click(); assert.equal(await page.locator('#preview').evaluate(el => el.getBoundingClientRect().width), 390);
      assert.deepEqual(external, []);
    } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
  }
  if (process.env.V2_DELIVERY_ARTIFACT_DIR) {
    const dir = join(process.env.V2_DELIVERY_ARTIFACT_DIR, mode); await mkdir(dir, { recursive: true });
    await Promise.all([writeFile(join(dir, 'desktop.png'), rendered.desktop.bytes), writeFile(join(dir, 'mobile.png'), rendered.mobile.bytes),
      writeFile(join(dir, 'technical-manifest.json'), JSON.stringify(result.manifest, null, 2)), writeFile(join(dir, 'synthetic-package.zip'), result.zip),
      writeFile(join(dir, 'synthetic-preview.zip'), preview.zip), writeFile(join(dir, 'preview-manifest.json'), JSON.stringify(preview.manifest, null, 2))]);
  }
});

test('offline feedback wrapper treats hostile copy and feedback as text and cannot send', async () => {
  const hostile = '</script><script>window.PWNED=true</script><img src="https://untrusted.invalid/x" onerror="window.PWNED=true">\u2028&';
  const identity = { jobId: 'synthetic-job-escape', contentRevision: 7, inputHash: '1'.repeat(64), boundHtmlHash: '2'.repeat(64), templateVersion: 'synthetic',
    assetHashes: { banner_desktop: '3'.repeat(64) }, text: { title_01: hostile } };
  const html = previewReviewHtml(identity);
  assert.equal((html.match(/<script/g) || []).length, 2); assert.equal(html.includes(hostile), false);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), requested: string[] = [];
    await page.route('**/*', async route => { requested.push(route.request().url()); await route.fulfill({ contentType: 'text/html', body: route.request().url().endsWith('/review.html') ? html : '<!doctype html><p>Fixture</p>' }); });
    await page.goto('https://uid-v2-review.invalid/review.html');
    await page.locator('#target').selectOption('text:title_01'); assert.match(await page.locator('#current').innerText(), /<script>window.PWNED/);
    await page.locator('#note').fill(hostile); await page.locator('#add').click();
    assert.equal(await page.evaluate(() => (window as any).PWNED), undefined);
    assert.equal(await page.locator('img').count(), 0); assert.equal(await page.locator('#notes').locator('script').count(), 0);
    const prompt = await page.locator('#prompt').inputValue(), feedback = JSON.parse(prompt.slice(prompt.indexOf('{')));
    assert.equal(feedback.feedback[0].note, hostile); assert.equal(feedback.feedback[0].currentText, hostile);
    assert.deepEqual(requested.sort(), ['https://uid-v2-review.invalid/index.html', 'https://uid-v2-review.invalid/review.html']);
    assert.match(html, /connect-src 'none'; form-action 'none'/);
  } finally { await browser.close(); }
});

test('template drift, incomplete assets, corrupt buffers and insufficient icon pixels cannot render', { timeout: 120_000 }, async () => {
  const input = await fixture('gtk');
  const drift = structuredClone(input.packet); drift.ui_mapping_templates.gtk.sha256.css = '0'.repeat(64);
  await assert.rejects(renderOnepage({ ...input, packet: drift }), /PINNED_TEMPLATE_MISMATCH/);
  const { wyl_01: omitted, ...missing } = input.assets;
  await assert.rejects(renderOnepage({ ...input, assets: missing }), /EXACT_ASSET_SET_REQUIRED/);
  const tiny = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#223344' } }).webp().toBuffer();
  const small = { ...input.assets, occasion_icon_01: { bytes: tiny, sha256: deliveryHash(tiny), revision: 1 } };
  await assert.rejects(renderOnepage({ ...input, assets: small }), /ICON_3X_DISPLAY_SIZE/);
  const snapshotRender = renderOnepage(input);
  input.assets.wyl_01.bytes[20] ^= 1;
  input.text.title_01 = 'MUTATED AFTER RENDER START'; input.contentRevision = 99;
  const snapshot = await snapshotRender;
  assert.equal(snapshot.contentRevision, 1); assert.doesNotMatch(snapshot.html, /MUTATED AFTER RENDER START/);
  await assert.rejects(renderOnepage(input), /HASH_MISMATCH/);
});

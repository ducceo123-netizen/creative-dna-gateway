import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getOnepageUiTemplate } from '../onepage-ui-template.ts';
import { buildOnepagePacket } from '../supabase/functions/_shared/onepage-packet.ts';
import { sourceHashes, QUALITY_SCHEMA, stableJson, type QualityRule } from '../supabase/functions/_shared/creative-quality.ts';
import { deriveWorkspaceImageCanvas, planWorkspaceCanonicalImageSizing, type WorkspaceImageSizingInput } from '../uid-workspace-image-sizing.ts';
import { WORKSPACE_IMAGE_MODEL } from '../uid-workspace-image.ts';

const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const digest = (v: unknown) => sha(stableJson(v));
const sizes = ['2560x960', '1152x1120', '976x640', '960x960', '256x256', '1280x720', '304x304'];
// Synthetic rules and capability only. The packet compiler, asset inventory and
// current GTK/FAQ HTML/CSS are real; these tests do not establish live EO or API access.
async function fixture(section: 'gtk' | 'faq' = 'gtk') {
  const resolved = { brand: { slug: 'pawfecthouse' }, branch: { slug: 'onepage-system', version: 'test', content_md: 'Synthetic sizing test rule source.', metadata: {} as Record<string, unknown> }, brand_dna: { slug: 'brand-dna', version: 'test', content_md: 'Synthetic factual style.', metadata: {} } };
  const categories: QualityRule['category'][] = ['content', 'typography', 'banner', 'proof', 'brand_style', 'delivery', 'workflow'];
  const rules: QualityRule[] = categories.map(category => ({ id: 'rule-' + category, key: category === 'brand_style' ? 'brand.active_expression' : category, value: category, instruction: 'Synthetic ' + category, category, scope: { brands: ['pawfecthouse'], branches: ['onepage-system'] }, sources: [{ node: category === 'brand_style' ? 'brand_dna' : 'branch', locator: 'test' }] }));
  const delivery = rules.find(r => r.category === 'delivery')!; delivery.key = 'delivery.mapping_format'; delivery.value = 'PNG';
  rules.push({ ...delivery, id: 'final-package', key: 'delivery.final_package', value: 'WEBP_ASSETS_PLUS_ONE_PNG_MAPPING' });
  resolved.branch.metadata.creative_quality_contract = { schema_version: QUALITY_SCHEMA, revision: 'test-1', source_hashes: await sourceHashes(resolved), rules, references: [] };
  const packet = await buildOnepagePacket(resolved, { source_url: 'https://store.example/products/sizing' });
  assert.equal(packet.creative_quality_contract.status, 'COMPILED');
  const template = getOnepageUiTemplate(getOnepageUiTemplate().variants[section], 'source');
  assert.ok('html' in template && 'css' in template);
  const input: WorkspaceImageSizingInput = { packet, section, pin: { packet_sha256: digest(packet), canonical_contract_sha256: packet.creative_quality_contract.contract_hash,
    template_version: template.version, template_html_sha256: template.sha256.html, template_css_sha256: template.sha256.css }, evaluated_at: '2026-11-06T12:00:00Z',
    capability: { verified: true, verification_ref: 'synthetic-size-attestation', project_id: 'synthetic-project', model: WORKSPACE_IMAGE_MODEL, api: 'images',
      checked_at: '2026-11-06T11:00:00Z', expires_at: '2026-11-06T13:00:00Z', operations: ['edit'], accepted_response_models: [WORKSPACE_IMAGE_MODEL], sizes: [...sizes], qualities: ['high'], output_formats: ['webp'] } };
  return { input, packet, template };
}

test('derives exact canonical canvases without floating point ratio rounding', () => {
  for (const [target, provider] of [['2560x960', '2560x960'], ['720x700', '1152x1120'], ['732x480', '976x640'], ['950x950', '960x960'], ['240x240', '256x256'], ['1280x720', '1280x720'], ['300x300', '304x304']]) {
    const p = deriveWorkspaceImageCanvas(target); assert.deepEqual(p.blockers, []); assert.equal(p.provider_size, provider); assert.equal(p.minimum_provider_size, provider);
    assert.equal(p.mode, target === provider ? 'exact' : 'same_aspect_downscale');
    const [tw, th] = target.split('x').map(Number), [pw, ph] = provider.split('x').map(Number);
    assert.equal(tw * ph, th * pw); assert.ok(pw >= tw && ph >= th);
  }
});
test('integer solver matches exhaustive provider canvases, including transposed and small targets', () => {
  for (const target of ['240x240', '700x720', '480x732', '111x222', '256x768', '768x256', '1x1', '950x1900', '1920x1080', '999x998', '1936x1936']) {
    const [tw, th] = target.split('x').map(Number); let smallest: { size: string; pixels: number } | undefined;
    for (let w = 256; w <= 2560; w += 16) for (let h = 256; h <= 2560; h += 16) {
      if (w * h <= 3686400 && w <= 3 * h && h <= 3 * w && w >= tw && h >= th && w * th === h * tw && (!smallest || w * h < smallest.pixels)) smallest = { size: `${w}x${h}`, pixels: w * h };
    }
    assert.equal(deriveWorkspaceImageCanvas(target).provider_size, smallest?.size, target);
  }
});
test('rejects malformed, extreme-aspect and unrepresentable targets without approximate fallback', () => {
  for (const target of ['0x240', '-1x240', '0240x240', '240.5x240', '240X240', ' 240x240', '10000x10000', 'auto']) assert.equal(deriveWorkspaceImageCanvas(target).blockers[0].code, 'CANONICAL_SIZE_INVALID');
  for (const target of ['100x301', '301x100', '2560x256']) assert.equal(deriveWorkspaceImageCanvas(target).blockers[0].code, 'ASPECT_RATIO_UNSUPPORTED');
  for (const target of ['999x998', '720x701', '2560x2560', '9999x9999']) assert.equal(deriveWorkspaceImageCanvas(target).blockers[0].code, 'EXACT_CANVAS_EXCEEDS_PROVIDER_LIMITS');
  assert.equal(deriveWorkspaceImageCanvas('2560x1440').provider_size, '2560x1440');
  assert.equal(deriveWorkspaceImageCanvas('2560x1456').blockers[0].code, 'EXACT_CANVAS_EXCEEDS_PROVIDER_LIMITS');
});
test('reviewed source inspection is tied to exact current GTK/FAQ HTML and shared CSS bytes', () => {
  const current = getOnepageUiTemplate();
  assert.equal(getOnepageUiTemplate(current.variants.gtk).sha256.html, 'fdab769e0b48f1b49abf1b558b4230eb36cc12b0e2b2e4264bf5a03478bbb4ad');
  assert.equal(getOnepageUiTemplate(current.variants.faq).sha256.html, '4c6ad6fe7864fe7807bbcc1eb8da281a97bcbadb1c4675b9a0a3d5afc514bf6b');
  for (const version of Object.values(current.variants)) assert.equal(getOnepageUiTemplate(version).sha256.css, '4671a41229fe5b3704d2825661f5ef1f7087500e513ddd2eb21eea3877291154');
});
test('capability allowlist selects its smallest exact-ratio fit, never a convenient crop or upscale', () => {
  const p = deriveWorkspaceImageCanvas('950x950', ['1536x1024', '2048x1024', '1024x1024', '512x512', '960x960', '960x960']);
  assert.equal(p.provider_size, '960x960');
  assert.equal(deriveWorkspaceImageCanvas('950x950', ['1024x1024']).provider_size, '1024x1024');
  assert.equal(deriveWorkspaceImageCanvas('950x950', ['1536x1024', '512x512']).blockers[0].code, 'EXACT_CANVAS_NOT_ATTESTED');
  assert.equal(deriveWorkspaceImageCanvas('950x950', []).blockers[0].code, 'EXACT_CANVAS_NOT_ATTESTED');
  for (const allowed of [['950x950'], ['2560x2560'], ['256x1024'], Array(33).fill('256x256')]) assert.equal(deriveWorkspaceImageCanvas('950x950', allowed).blockers[0].code, 'PROVIDER_SIZE_ALLOWLIST_INVALID');
});
for (const section of ['gtk', 'faq'] as const) test(`actual canonical ${section} packet yields exact slot proposals and honest responsive icon blockers`, async () => {
  const { input, template } = await fixture(section), before = stableJson(input), p = planWorkspaceCanonicalImageSizing(input);
  assert.equal(stableJson(input), before); assert.deepEqual(planWorkspaceCanonicalImageSizing(input), p);
  assert.equal(p.proposals.length, section === 'gtk' ? 18 : 15); assert.equal(p.status, 'blocked');
  assert.equal(p.proposals.filter(v => v.proposed_strategy).length, section === 'gtk' ? 14 : 11);
  assert.equal(p.proposals.some(v => v.canonical_slot.startsWith('gtk_')), section === 'gtk');
  assert.ok(!p.proposals.some(v => ['ui_mapping_preview', 'occasion_story_01_mobile'].includes(v.canonical_slot)));
  assert.equal(p.pins!.packet_sha256, input.pin.packet_sha256); assert.equal(p.pins!.contract_document_sha256, digest((input.packet as any).creative_quality_contract));
  assert.equal(p.capability!.sha256, digest(input.capability));
  assert.equal(p.blockers.length, 4); assert.ok(p.blockers.every(b => b.code === 'ICON_DISPLAY_GEOMETRY_UNPROVEN'));
  for (const icon of p.proposals.filter(v => v.canonical_slot.startsWith('occasion_icon'))) {
    assert.equal(icon.status, 'blocked'); assert.equal(icon.proposed_strategy, undefined); assert.ok(icon.template_evidence.length >= 4);
    const excerpts = icon.template_evidence.map(e => e.excerpt).join('\n');
    assert.match(excerpts, /width: 25%/); assert.match(excerpts, /width: 40%/); assert.match(excerpts, /max-width: 798px/); assert.match(excerpts, /width="" height=""/);
    for (const e of icon.template_evidence) {
      const source = Buffer.from(e.source === 'html' ? template.html! : template.css!);
      assert.equal(source.subarray(e.byte_offset, e.byte_offset + e.byte_length).toString(), e.excerpt); assert.equal(sha(e.excerpt), e.sha256);
    }
  }
  for (const proposal of p.proposals.filter(v => v.proposed_strategy)) {
    assert.equal(proposal.status, 'review_required'); assert.equal(proposal.proposed_strategy!.canonical_contract_sha256, input.pin.canonical_contract_sha256);
    assert.equal('evidence_ref' in proposal.proposed_strategy!, false); assert.equal('ui_display_size' in proposal.proposed_strategy!, false);
  }
  assert.equal(p.authorization_granted, false); assert.equal(p.independent_review_required, true); assert.equal(p.quality_verified, false); assert.equal(p.provider_calls_performed, 0);
});
test('pins current template bytes and prevents silent drift of template, packet, contract and aliases', async () => {
  const f = await fixture();
  const failures: Array<[string, (input: WorkspaceImageSizingInput) => void]> = [
    ['PACKET_PIN_MISMATCH', i => { (i.packet as any).assets[0].size = '1024x1024'; }],
    ['CONTRACT_BYTES_MISMATCH', i => { (i.packet as any).creative_quality_contract.rules[0].instruction += ' drift'; i.pin.packet_sha256 = digest(i.packet); }],
    ['CANONICAL_CONTRACT_REQUIRED', i => { i.pin.canonical_contract_sha256 = 'a'.repeat(64); }],
    ['CANONICAL_TEMPLATE_VERSION_MISMATCH', i => { i.pin.template_version = '2026-10-03.v2'; }],
    ['CANONICAL_TEMPLATE_VERSION_MISMATCH', i => { i.section = 'faq'; }],
    ['TEMPLATE_BYTES_MISMATCH', i => { i.pin.template_html_sha256 = 'b'.repeat(64); }],
    ['TEMPLATE_BYTES_MISMATCH', i => { i.pin.template_css_sha256 = 'b'.repeat(64); }],
    ['TEMPLATE_ASSET_BINDING_MISMATCH', i => { delete (i.packet as any).template_asset_bindings.occasion_story_01; i.pin.packet_sha256 = digest(i.packet); }],
  ];
  for (const [code, mutate] of failures) { const input = structuredClone(f.input); mutate(input); const plan = planWorkspaceCanonicalImageSizing(input); assert.equal(plan.blockers[0].code, code); assert.deepEqual(plan.proposals, []); }
});
test('rejects duplicate, missing and extra assets rather than partially preparing the batch', async () => {
  const f = await fixture();
  for (const mutate of [(a: any[]) => a.push(a[0]), (a: any[]) => a.shift(), (a: any[]) => a.push({ slot: 'unknown', size: '256x256' })]) {
    const input = structuredClone(f.input); mutate((input.packet as any).assets); input.pin.packet_sha256 = digest(input.packet);
    const p = planWorkspaceCanonicalImageSizing(input); assert.equal(p.blockers[0].code, 'CANONICAL_ASSET_INVENTORY_INVALID'); assert.equal(p.proposals.length, 0);
  }
});
test('missing capability leaves clearly non-authorized geometry candidates; unlisted sizes stay blocked', async () => {
  const { input } = await fixture(); delete input.capability; delete input.evaluated_at;
  const p = planWorkspaceCanonicalImageSizing(input); assert.equal(p.blockers[0].code, 'IMAGE_CAPABILITY_REQUIRED'); assert.equal(p.authorization_granted, false);
  assert.equal(p.proposals.find(v => v.canonical_slot === 'banner_mobile')?.proposed_strategy?.provider_size, '1152x1120');
  const f = await fixture(); f.input.capability!.sizes = ['1024x1024']; const limited = planWorkspaceCanonicalImageSizing(f.input);
  assert.equal(limited.proposals.find(v => v.canonical_slot === 'banner_mobile')?.blockers[0].code, 'EXACT_CANVAS_NOT_ATTESTED');
  assert.equal(limited.proposals.find(v => v.canonical_slot === 'detail_main')?.proposed_strategy?.provider_size, '1024x1024');
});
test('rejects expired, future, invalid and unsuitable capability assertions without producing strategies', async () => {
  const f = await fixture();
  for (const mutate of [(i: WorkspaceImageSizingInput) => { i.evaluated_at = undefined; },
    (i: WorkspaceImageSizingInput) => { i.evaluated_at = i.capability!.expires_at; },
    (i: WorkspaceImageSizingInput) => { i.evaluated_at = '2026-11-06T10:00:00Z'; },
    (i: WorkspaceImageSizingInput) => { i.capability!.sizes = ['950x950']; },
    (i: WorkspaceImageSizingInput) => { i.capability!.operations = ['generate']; },
    (i: WorkspaceImageSizingInput) => { i.capability!.output_formats = ['png']; },
    (i: WorkspaceImageSizingInput) => { i.capability!.qualities = ['low']; },
    (i: WorkspaceImageSizingInput) => { (i.capability as any).model = 'unknown'; },
    (i: WorkspaceImageSizingInput) => { (i.capability as any).verified = false; }]) {
    const input = structuredClone(f.input); mutate(input); const p = planWorkspaceCanonicalImageSizing(input);
    assert.equal(p.blockers[0].code, 'IMAGE_CAPABILITY_INVALID_OR_EXPIRED'); assert.equal(p.proposals.length, 0); assert.equal(p.authorization_granted, false);
  }
});
test('evidence hashes change if even non-geometric packet metadata changes', async () => {
  const { input } = await fixture(), first = planWorkspaceCanonicalImageSizing(input);
  (input.packet as any).dynamic_job.theme = 'Changed'; input.pin.packet_sha256 = digest(input.packet); const next = planWorkspaceCanonicalImageSizing(input);
  assert.notEqual(first.pins!.packet_sha256, next.pins!.packet_sha256); assert.equal(first.pins!.assets_sha256, next.pins!.assets_sha256);
  assert.deepEqual(first.proposals.map(p => p.geometry), next.proposals.map(p => p.geometry));
});

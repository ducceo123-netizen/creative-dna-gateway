import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCreativeQuality, sourceHashes, QUALITY_SCHEMA, stableJson, type QualityRule, type QualityBundle, type ResolvedDna } from '../supabase/functions/_shared/creative-quality.ts';
import { buildOnepagePacket } from '../supabase/functions/_shared/onepage-packet.ts';
import { readFileSync } from 'node:fs';

const scope = { brands: ['pawfecthouse'], branches: ['onepage-system'] };
const categories: QualityRule['category'][] = ['content','typography','banner','proof','brand_style','delivery','workflow'];
async function fixture(brand = 'pawfecthouse') {
  const dna = { brand: { slug: brand }, branch: { slug: 'onepage-system', version: '0.1', content_md: 'Verified current content. Brand rules are separate. Latest PNG mapping supersedes old WebP mapping.', metadata: {} as Record<string,unknown> }, brand_dna: { slug: 'brand-dna', version: '0.1', content_md: `${brand} warm and truthful`, metadata: {} }, visual_references: [] as unknown[] };
  const rules: QualityRule[] = categories.map(category => ({ id: `${brand}.${category}`, key: category === 'brand_style' ? 'brand.active_expression' : category, value: category, instruction: `${category}: verified active instruction`, category, scope: {...scope,brands:[brand]}, sources: [{node: category === 'brand_style' ? 'brand_dna' : 'branch',locator:'canonical baseline'}] }));
  const bundle: QualityBundle = {schema_version:QUALITY_SCHEMA,revision:'approved-1',source_hashes:await sourceHashes(dna),rules,references:[]};
  dna.branch.metadata.creative_quality_contract = bundle;
  return {dna,bundle};
}
test('identical resolved source yields same compact rules and hash across accounts and resolver timestamps', async () => {
  const {dna} = await fixture();
  const a = await compileCreativeQuality({...dna, account:'a',resolved_at:'yesterday'} as ResolvedDna);
  const b = await compileCreativeQuality({...dna, account:'b',resolved_at:'today'} as ResolvedDna);
  assert.deepEqual(a,b); assert.equal(a.status,'COMPILED'); assert.equal(a.rules.length,7);
  assert.equal(a.gates.identical_pixels_guaranteed,false); assert.equal(a.gates.human_artistic_review,'REQUIRED');
  assert.ok(JSON.stringify(a).length < 10000);
});
test('compiler actually includes current content, typography, proof and brand style rules', async () => {
  const {dna,bundle} = await fixture();
  bundle.rules[0].instruction='Buyer question -> verified fact -> meaningful benefit -> visible proof.';
  bundle.rules[1].instruction='Campaign hierarchy, semantic line wraps, optical mobile balance; no forced serif.';
  const delivery=bundle.rules.find(r=>r.category==='delivery')!;delivery.key='delivery.mapping_format';delivery.value='PNG';
  const packet = await buildOnepagePacket(dna);
  assert.equal(packet.creative_quality_contract.rules.find(r=>r.id===packet.content_contract[0])?.instruction,bundle.rules[0].instruction);
  assert.equal(packet.creative_quality_contract.rules.find(r=>r.id===packet.typography_contract[0])?.instruction,bundle.rules[1].instruction);
  assert.equal(packet.brand_expression.rule_ids.length,1);
  assert.equal(packet.resolved.quality_contract_hash,packet.creative_quality_contract.contract_hash);
  assert.equal(packet.assets.find(a=>a.slot==='ui_mapping_preview')?.format,'PNG');
  assert.equal(packet.assets.filter(a=>a.role==='occasion_symbol').length,4);
  assert.match(packet.post_story_section.faq_template_status,/NOT_YET_DEPLOYED/);
});
test('approved rule update changes contract hash, even when obsolete node version was not bumped', async () => {
  const {dna,bundle} = await fixture();
  const before = await compileCreativeQuality(dna);
  bundle.rules[0].instruction='New approved source-led, non-redundant content rule'; bundle.revision='approved-2';
  const after = await compileCreativeQuality(dna);
  assert.equal(after.status,'COMPILED'); assert.notEqual(before.contract_hash,after.contract_hash);
});
test('uncompiled, stale, malformed and missing category contracts fail visibly with no legacy rule fallback', async () => {
  const {dna,bundle} = await fixture();
  dna.branch.content_md += ' New accepted feedback';
  let q = await compileCreativeQuality(dna); assert.ok(q.errors.includes('QUALITY_CONTRACT_STALE'));assert.deepEqual(q.rules,[]);assert.equal(q.gates.asset_generation,'BLOCKED');
  bundle.source_hashes = await sourceHashes(dna); bundle.rules = bundle.rules.filter(r=>r.category!=='typography');
  q = await compileCreativeQuality(dna);assert.ok(q.errors.includes('QUALITY_CATEGORY_MISSING:typography'));
  dna.branch.metadata.creative_quality_contract = {schema_version:QUALITY_SCHEMA,rules:'not an array'};
  q = await compileCreativeQuality(dna); assert.ok(q.errors.includes('QUALITY_CONTRACT_INVALID'));
  delete dna.branch.metadata.creative_quality_contract;
  q = await compileCreativeQuality(dna); assert.ok(q.errors.includes('QUALITY_CONTRACT_MISSING'));
});
test('brand DNA and operational metadata changes invalidate stale compact contract', async () => {
  const {dna,bundle} = await fixture(); dna.brand_dna.content_md += ' new expression';
  assert.ok((await compileCreativeQuality(dna)).errors.includes('QUALITY_CONTRACT_STALE'));
  bundle.source_hashes = await sourceHashes(dna); dna.branch.metadata.main_banner_cta='changed';
  assert.ok((await compileCreativeQuality(dna)).errors.includes('QUALITY_CONTRACT_STALE'));
});
test('scoped approved supersession resolves old PNG/WebP conflict and product-specific style stays local', async () => {
  const {dna,bundle} = await fixture(); const old=bundle.rules.find(r=>r.category==='delivery')!;
  old.value='webp'; old.instruction='Historical WebP overall';
  bundle.rules.push({...old,id:'mapping-png',value:'png',instruction:'onepage_{product_slug}-overall.png',supersedes:[old.id]});
  const generic=bundle.rules.find(r=>r.category==='typography')!;
  bundle.rules.push({...generic,id:'wooden-only',instruction:'Warm wooden-specific category direction',scope:{...scope,product_urls:['https://pawfecthouse.com/products/wooden']},supersedes:[generic.id]});
  const a=await compileCreativeQuality(dna,{source_url:'https://pawfecthouse.com/products/wooden?variant=1'});
  assert.equal(a.status,'COMPILED'); assert.ok(a.rules.some(r=>r.id==='wooden-only'));assert.ok(!a.rules.some(r=>r.id===generic.id));
  assert.ok(!a.rules.some(r=>r.id===old.id));assert.ok(a.superseded_rule_ids.includes(old.id));
  const b=await compileCreativeQuality(dna,{source_url:'https://pawfecthouse.com/products/pajamas'});
  assert.ok(!b.rules.some(r=>r.id==='wooden-only'));assert.ok(b.rules.some(r=>r.id===generic.id));
});
test('unresolved conflicts, invalid supersession and cycles block instead of last-write-wins', async () => {
  const {dna,bundle}=await fixture();const base=bundle.rules[0];
  bundle.rules.push({...base,id:'conflict',value:'different'});
  assert.ok((await compileCreativeQuality(dna)).errors.includes('UNRESOLVED_RULE_CONFLICT:content'));
  bundle.rules.at(-1)!.supersedes=['missing'];
  assert.ok((await compileCreativeQuality(dna)).errors.some(e=>e.startsWith('INVALID_SUPERSESSION')));
  bundle.rules.at(-1)!.supersedes=[base.id];base.supersedes=['conflict'];
  assert.ok((await compileCreativeQuality(dna)).errors.includes('SUPERSESSION_CYCLE'));
});
test('cross-brand widening cannot supersede a local rule, and other brand style never leaks', async () => {
  const {dna,bundle}=await fixture();const base=bundle.rules.find(r=>r.category==='brand_style')!;
  bundle.rules.push({...base,id:'wrong-wide',scope:{brands:['*'],branches:['*']},supersedes:[base.id]});
  assert.ok((await compileCreativeQuality(dna)).errors.some(e=>e.startsWith('INVALID_SUPERSESSION')));
  bundle.rules.pop(); bundle.rules.push({...base,id:'giftsoul-only',scope:{brands:['giftsoul'],branches:['onepage-system']}});
  assert.ok(!(await compileCreativeQuality(dna)).rules.some(r=>r.id==='giftsoul-only'));
  const {dna:gs}=await fixture('giftsoul');const q=await compileCreativeQuality(gs);
  assert.equal(q.route.brand,'giftsoul');assert.ok(q.rules.every(r=>r.scope.brands.includes('giftsoul')));
});
test('Library IDs and private/signed URLs never count as required evidence visibility', async () => {
  const {dna,bundle}=await fixture();
  bundle.references=[{id:'banner-seed',role:'typography_reference',scope,usage:'required_evidence',required_for:['banner_desktop','banner_mobile'],reference_id:'libfile_private',asset_url:'https://chatgpt.com/backend-api/files/download?id=private',source:{node:'branch',locator:'approved reference family'}}];
  const q=await compileCreativeQuality(dna);
  assert.equal(q.status,'COMPILED');assert.equal(q.reference_gate.status,'BLOCKED_MISSING_REFERENCES');assert.equal(q.references[0].pixel_inspection,'NOT_INSPECTED');
  assert.equal(q.gates.content_authoring,'READY_WITH_SOURCE_RESEARCH');assert.equal(q.gates.asset_generation,'BLOCKED');assert.deepEqual(q.reference_gate.blocked_asset_slots,['banner_desktop','banner_mobile']);
  bundle.references[0].asset_url='https://cdn.example.com/a.png?signature=secret';
  assert.equal((await compileCreativeQuality(dna)).references[0].availability,'UNAVAILABLE');
});
test('approved canonical reference catalog propagates pointers but still requires actual pixel inspection', async () => {
  const {dna,bundle}=await fixture();
  bundle.references=[{id:'banner-seed',role:'banner',scope,usage:'required_evidence',required_for:['banner_desktop'],source:{node:'branch',locator:'reference'}}];
  dna.visual_references=[{id:'banner-seed',status:'approved',asset_url:'https://cdn.example.com/approved.png',metadata:{}}];
  const q=await compileCreativeQuality(dna);
  assert.equal(q.references[0].availability,'FETCH_REQUIRED');assert.equal(q.references[0].pixel_inspection,'NOT_INSPECTED');
  assert.equal(q.reference_gate.status,'PIXEL_INSPECTION_REQUIRED');assert.equal(q.canonical_visual_reference_catalog.length,1);
  assert.notEqual(q.gates.asset_generation,'READY');
});
test('rule evidence excerpts must occur in canonical source; large bundles are never silently truncated', async () => {
  const {dna,bundle}=await fixture();bundle.rules[0].sources[0].excerpt='nonexistent approval';
  assert.ok((await compileCreativeQuality(dna)).errors.includes('QUALITY_CONTRACT_INVALID'));
  delete bundle.rules[0].sources[0].excerpt;
  bundle.rules=Array.from({length:81},(_,i)=>({...bundle.rules[0],id:String(i)}));
  assert.ok((await compileCreativeQuality(dna)).errors.includes('QUALITY_CONTRACT_INVALID'));
});
test('both deployed entrypoints share the same pure compiler and disable stale public cache', () => {
  for (const slug of ['creative-dna-public','creative-dna-compile-onepage']) {
    const code=readFileSync(`supabase/functions/${slug}/index.ts`,'utf8');assert.match(code,/_shared\//);assert.match(code,/no-store/);assert.ok(!code.includes('public, max-age=60'));
  }
  assert.equal(stableJson({z:1,a:2}),stableJson({a:2,z:1}));
});
test('an unrelated catalog record cannot satisfy a missing reference, and revoked records cannot fall back', async () => {
  const {dna,bundle}=await fixture();
  bundle.references=[{id:'required',role:'banner',scope,required_for:['banner_desktop'],source:{node:'branch',locator:'reference'}}];
  dna.visual_references=[{id:'unrelated',status:'approved',asset_url:'https://cdn.example.com/wrong.png'}];
  assert.equal((await compileCreativeQuality(dna)).references[0].availability,'UNAVAILABLE');
  bundle.references[0].asset_url='https://cdn.example.com/old.png';
  dna.visual_references=[{id:'required',status:'rejected',asset_url:'https://cdn.example.com/revoked.png'}];
  assert.equal((await compileCreativeQuality(dna)).references[0].availability,'UNAVAILABLE');
});
test('changing approved keyed creative policy cannot leave a stale duplicate literal in the packet', async () => {
  const {dna,bundle}=await fixture();
  const banner=bundle.rules.find(r=>r.category==='banner')!;banner.key='banner.story';banner.instruction='Current reviewed banner direction';
  const delivery=bundle.rules.find(r=>r.category==='delivery')!;delivery.key='delivery.mapping_format';delivery.value='PNG';
  let packet=await buildOnepagePacket(dna);
  assert.deepEqual(packet.main_banner_contract.rule_ids,[banner.id]);
  assert.equal(packet.assets.find(a=>a.slot==='ui_mapping_preview')?.format,'PNG');
  delivery.value='REVISED_REVIEWED_FORMAT';bundle.revision='next';
  packet=await buildOnepagePacket(dna);
  assert.equal(packet.assets.find(a=>a.slot==='ui_mapping_preview')?.format,'REVISED_REVIEWED_FORMAT');
  assert.ok(!Object.hasOwn(packet.main_banner_contract,'story_mode'));
});
test('shared brand-scope guidance cannot substitute for the resolved local brand expression', async () => {
  const {dna,bundle}=await fixture();
  const local=bundle.rules.find(r=>r.category==='brand_style')!;
  bundle.rules.push({...local,id:'generic-inheritance',key:'brand.inheritance',scope:{brands:['*'],branches:['onepage-system']},sources:[{node:'branch',locator:'shared mechanics'}]});
  dna.brand.slug='giftsoul';
  assert.ok((await compileCreativeQuality(dna)).errors.includes('BRAND_STYLE_NOT_COMPILED'));
});
test('existing master-mirrored catalog chooses the exact brand bundle without local-style fallback', async () => {
  const ph=await fixture('pawfecthouse'),gs=await fixture('giftsoul'),sp=await fixture('soulprise');
  const catalog={schema_version:'uid-creative-quality-catalog/1',contracts:{pawfecthouse:ph.bundle,giftsoul:gs.bundle,soulprise:sp.bundle}};
  for(const {dna} of [ph,gs,sp]) {
    dna.branch.metadata.creative_quality_contract=catalog;
    const result=await compileCreativeQuality(dna);assert.equal(result.status,'COMPILED');
    assert.equal(result.rules.find(r=>r.key==='brand.active_expression')?.scope.brands[0],dna.brand.slug);
  }
  delete (catalog.contracts as any).giftsoul;
  const missing=await compileCreativeQuality(gs.dna);assert.ok(missing.errors.includes('BRAND_CONTRACT_MISSING'));assert.equal(missing.gates.content_authoring,'BLOCKED');
  (catalog as any).contracts=null;
  assert.ok((await compileCreativeQuality(ph.dna)).errors.includes('BRAND_CONTRACT_MISSING'));
});

test('an empty Reference Library keeps product evidence and active quality rules mandatory', async () => {
  const {dna,bundle}=await fixture();
  const q=await compileCreativeQuality(dna);
  assert.equal(q.status,'COMPILED');
  assert.equal(q.reference_gate.status,'NO_REQUIRED_STYLE_REFERENCES');
  assert.equal(q.gates.asset_generation,'REQUIRES_PRODUCT_PIXEL_INSPECTION');
  assert.equal(q.reference_library_policy.empty_library_blocks_generation,false);
  assert.equal(q.reference_library_policy.fixed_seed_set_required,false);
  assert.equal(q.reference_library_policy.overrides_active_brand_or_product_rules,false);
  assert.deepEqual(q.rules.map(r=>r.id).sort(),bundle.rules.map(r=>r.id).sort());
  const packet=await buildOnepagePacket(dna);
  assert.equal(packet.acquisition_contract.verified_product_pool_required,true);
  assert.equal(packet.hard_gates.product_physical_truth,'HARD_MULTI_SOURCE');
  assert.ok(packet.execution.includes('INSPECT_PRODUCT_AND_EXPLICITLY_REQUIRED_EVIDENCE_PIXELS'));
  assert.ok(!packet.execution.includes('FETCH_AND_INSPECT_REQUIRED_REFERENCE_PIXELS'));
  assert.match(packet.instruction,/missing examples never block creation/);
});

test('legacy seven style seeds and their rule links are optional across all active brands', async () => {
  const ids=['synthetic.case-a.desktop','synthetic.case-a.mobile','synthetic.case-b.desktop','synthetic.case-b.mobile','synthetic.case-c.desktop','synthetic.case-c.mobile','synthetic.icon-family.example'];
  for(const brand of ['pawfecthouse','giftsoul','soulprise']) {
    const {dna,bundle}=await fixture(brand);
    bundle.rules[1].reference_ids=ids.slice(0,6);
    bundle.rules.find(r=>r.category==='banner')!.reference_ids=ids.slice(0,6);
    bundle.rules.find(r=>r.category==='proof')!.reference_ids=ids.slice(6);
    bundle.references=ids.map(id=>({id,role:'legacy_style_example',scope:{brands:['*'],branches:['onepage-system']},required_for:id.includes('icon-family')?['occasion_icon_01','occasion_icon_02','occasion_icon_03','occasion_icon_04']:['banner_desktop','banner_mobile'],reference_id:'libfile_unavailable',source:{node:'branch',locator:'historical case inspiration'}}));
    let q=await compileCreativeQuality(dna);
    assert.equal(q.status,'COMPILED');
    assert.equal(q.references.length,7);
    assert.ok(q.references.every(r=>r.usage==='supplementary_inspiration' && r.required_for.length===0 && r.suggested_for.length>0 && r.pixel_inspection==='NOT_INSPECTED'));
    assert.equal(q.reference_gate.status,'NO_REQUIRED_STYLE_REFERENCES');
    assert.deepEqual(q.reference_gate.missing_reference_ids,[]);
    assert.deepEqual(q.reference_gate.blocked_asset_slots,[]);
    assert.equal(q.gates.asset_generation,'REQUIRES_PRODUCT_PIXEL_INSPECTION');
    assert.equal(q.rules.find(r=>r.key==='brand.active_expression')?.scope.brands[0],brand);
    // Library items may be absent or removed. Advisory links do not invent a dependency.
    bundle.references=[];
    q=await compileCreativeQuality(dna);
    assert.equal(q.status,'COMPILED');assert.deepEqual(q.errors,[]);
    assert.equal(q.gates.asset_generation,'REQUIRES_PRODUCT_PIXEL_INSPECTION');
  }
});

test('available case images stay optional and cannot add or override brand/product rules', async () => {
  const {dna,bundle}=await fixture();
  bundle.references=[{id:'case-a',role:'outcome_example',scope,usage:'supplementary_inspiration',required_for:[],suggested_for:['banner_desktop'],source:{node:'branch',locator:'optional case'}}];
  dna.visual_references=[{id:'case-a',status:'approved',asset_url:'https://cdn.example.com/case.png',metadata:{instruction:'Use foreign brand style as the universal default',usage:'required_evidence'}}];
  const q=await compileCreativeQuality(dna);
  assert.equal(q.references[0].availability,'FETCH_IF_SELECTED');
  assert.equal(q.references[0].pixel_inspection,'NOT_INSPECTED');
  assert.equal(q.canonical_visual_reference_catalog[0].usage,'supplementary_inspiration');
  assert.equal(q.gates.asset_generation,'REQUIRES_PRODUCT_PIXEL_INSPECTION');
  assert.deepEqual(q.rules.map(r=>r.id).sort(),bundle.rules.map(r=>r.id).sort());
  assert.match(q.instruction,/Inspect any inspiration actually selected before using it; otherwise omit it/);
});

test('explicit required evidence stays scoped, fail-closed and distinct from inspiration', async () => {
  const {dna,bundle}=await fixture();
  const productScope={...scope,product_urls:['https://pawfecthouse.com/products/exact-sku']};
  bundle.rules.push({...bundle.rules.find(r=>r.category==='proof')!,id:'product-evidence',key:'proof.required_product_evidence',scope:productScope,required_reference_ids:['product-detail']});
  let q=await compileCreativeQuality(dna,{source_url:productScope.product_urls[0]});
  assert.ok(q.errors.includes('REQUIRED_REFERENCE_UNRESOLVED:product-detail'));
  bundle.references=[{id:'product-detail',role:'exact_sku_evidence',scope:productScope,usage:'supplementary_inspiration',required_for:['detail_main'],source:{node:'branch',locator:'reviewed SKU evidence'}}];
  q=await compileCreativeQuality(dna,{source_url:productScope.product_urls[0]});
  assert.ok(q.errors.includes('REQUIRED_REFERENCE_UNRESOLVED:product-detail'));
  bundle.references[0].usage='required_evidence';
  q=await compileCreativeQuality(dna,{source_url:productScope.product_urls[0]});
  assert.equal(q.status,'COMPILED');assert.equal(q.gates.asset_generation,'BLOCKED');
  assert.deepEqual(q.reference_gate.blocked_asset_slots,['detail_main']);
  assert.deepEqual(q.reference_gate.missing_reference_ids,['product-detail']);
  bundle.references[0].asset_url='https://cdn.example.com/verified-sku.png';
  q=await compileCreativeQuality(dna,{source_url:productScope.product_urls[0]});
  assert.equal(q.reference_gate.status,'PIXEL_INSPECTION_REQUIRED');
  assert.equal(q.gates.asset_generation,'REQUIRES_PRODUCT_AND_REFERENCE_PIXEL_INSPECTION');
  const unrelated=await compileCreativeQuality(dna,{source_url:'https://pawfecthouse.com/products/other'});
  assert.equal(unrelated.status,'COMPILED');assert.equal(unrelated.gates.asset_generation,'REQUIRES_PRODUCT_PIXEL_INSPECTION');
  bundle.references[0].required_for=[];
  assert.ok((await compileCreativeQuality(dna)).errors.includes('QUALITY_CONTRACT_INVALID'));
});

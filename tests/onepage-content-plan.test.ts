import test from 'node:test';
import assert from 'node:assert/strict';
import { attachResearch, evaluateResearch, RESEARCH_VERSION, type ResearchContext, type NamedOnepageProductScope } from '../supabase/functions/_shared/product-research.ts';
import { ONEPAGE_CONTENT_PLAN_VERSION, ONEPAGE_CONTENT_CONTINUATION, evaluateOnepageContentPlan } from '../supabase/functions/_shared/onepage-content-plan.ts';

// Synthetic structural fixtures only, never production inspection/approval receipts.
function fixture(collection = false): any {
  const products = (collection ? ['a', 'b'] : ['a']).map(id => ({ id, url: `https://store.example/products/${id}`, variant: 'selected' }));
  const source_url = collection ? 'https://store.example/collections/items' : products[0].url;
  const sources = products.map(p => ({ id: p.id, url: p.url, kind: 'target_pdp', status: 'inspected', observed_at: '2026-10-29T00:00:00Z', product_ids: [p.id], match: 'exact', product_versions: { [p.id]: p.variant }, excerpts: ['Synthetic fixture observation.'], sections: ['description', 'specifications', 'options', 'care_use'].map(name => ({ name, status: 'inspected', note: 'Synthetic observed section.' })), pdp_coverage: { schema_version: 'uid-pdp-coverage/1', inventory_complete: true, enumeration_note: 'Synthetic full enumeration for a unit test, not live inspection.', gallery: { discovered_count: 0, items: [] }, details: { discovered_count: 1, items: [{ id: 'detail', label: 'Specs', variant: 'selected', status: 'inspected', method: 'source_text', observation: 'Synthetic specs.' }] } } }));
  const claims = ['material', 'fit', 'care'].map(id => ({ id, text: `Synthetic ${id} fact.`, kind: 'product_fact', scope: collection ? 'collection' : 'sku', product_ids: products.map(p => p.id), source_ids: sources.map(s => s.id), evidence_items: sources.map(s => ({ source_id: s.id, item_id: 'detail' })), qualified: false }));
  return { schema_version: RESEARCH_VERSION, scope: { source_url, source_type: collection ? 'collection' : 'product', products, inventory_complete: true, coverage_note: 'Synthetic selected scope.' }, sources, claims,
    coverage: ['target_pdp', 'target_reviews', 'marketplace', 'competitor', 'supplier'].map(category => ({ category, status: category === 'target_pdp' ? 'inspected' : 'not_found', source_ids: category === 'target_pdp' ? sources.map(s => s.id) : [], notes: 'Synthetic coverage; no live source assertion.' })),
    analysis: { unknowns: [], conflicts: [], insights: claims.map(c => ({ concern: `How does ${c.id} affect my choice?`, implication: `Consider the verified ${c.id} before choosing.`, claim_ids: [c.id], section: 'gtk' })), content_plan: {
      schema_version: ONEPAGE_CONTENT_PLAN_VERSION,
      banner: { product_keyword: 'Travel Case', keyword_source_ids: ['a'], desktop_title: 'Travel Case', mobile_title: 'Travel Case', desktop_support: 'A separate supported sentence.', mobile_support: '', subtitle: '' },
      post_story: { mode: 'gtk', rationale: 'Three practical facts benefit from short visual explanations grounded in the inspected sources.', alternative_rejected_reason: 'FAQ would repeat the same practical notes without resolving additional operational uncertainty.', source_ids: sources.map(s => s.id), insight_indexes: [0, 1, 2] },
      details: { anchor_product_id: 'a', items: claims.map((c, i) => ({ slot: `detail_0${i + 1}`, claim_ids: [c.id], visible_proof: `Closeup that visibly proves the verified ${c.id} at the circular crop.` })) },
      ...(collection ? { collection: { discovered_product_count: 2, enumeration_note: 'Enumerated the two synthetic collection products and inspected both exact variants.', shared_claim_ids: claims.map(c => c.id), exceptions: 'No exceptions in this synthetic fixture.' } } : {}),
    } },
  };
}
const context = (r: any) => ({ research: r, source_url: r.scope.source_url, require_pdp_coverage: true });
const check = (r: any) => evaluateOnepageContentPlan(r, evaluateResearch(context(r)));

function namedFixture(catalogCount=2){
  const r=fixture(true),origin='https://pawfecthouse.com';
  r.scope.source_url=origin+'/products.json';r.scope.product_type='  TRAVEL   CASE ';
  for(const p of r.scope.products)p.url=origin+'/products/'+p.id;
  for(const s of r.sources)s.url=origin+'/products/'+s.id;
  const named:NamedOnepageProductScope={status:'RESOLVED',source_url:r.scope.source_url,requested_product_type:'Travel Case',catalog_complete:true,
    products:Array.from({length:catalogCount},(_,index)=>{const id=String.fromCharCode(97+index);return {id,url:origin+'/products/'+id,product_type:'Travel Case'};})};
  const ctx:ResearchContext={research:r,source_url:r.scope.source_url,source_type:'collection',resolved_brand:'pawfecthouse',require_pdp_coverage:true,named_product_scope:named};
  const data={resolved:{brand:'pawfecthouse'},hard_gates:{content_approval:'AUTO_CONTINUE_NO_INTERMEDIATE_CONTENT_SIGNOFF'},acquisition_contract:{min_verified_designs:4}};
  return {r,named,ctx,data};
}
function addNamedVariant(r:any,suffix:string){
  const product={...structuredClone(r.scope.products[0]),id:'a-'+suffix,catalog_product_id:'a',variant:suffix,url:r.scope.products[0].url+'?variant='+suffix};
  r.scope.products.push(product);
  const source=structuredClone(r.sources[0]);source.id=product.id;source.url=product.url;source.product_ids=[product.id];source.product_versions={[product.id]:suffix};
  for(const detail of source.pdp_coverage.details.items)detail.variant=suffix;
  r.sources.push(source);
  for(const claim of r.claims){claim.product_ids.push(product.id);claim.source_ids.push(source.id);claim.evidence_items.push({source_id:source.id,item_id:'detail'});}
  r.analysis.content_plan.post_story.source_ids.push(source.id);
}

function storefrontFixture(brand='pawfecthouse',host='pawfecthouse.com'){
  const f=namedFixture(),origin='https://'+host;
  f.named.source_url=origin+'/api/2026-10/graphql.json';
  Object.assign(f.named,{scan_complete:true,has_more_pages:false,whole_store_scan_complete:false,
    visibility_scope:'PUBLIC_TOKENLESS_STOREFRONT_QUERY',
    publication_note:'Synthetic complete public query only; no unfiltered, private or cross-channel catalog parity claim.',
    evidence:{authority:'TOKENLESS_STOREFRONT_EXACT_TYPE_QUERY'}});
  f.ctx.source_url=f.r.scope.source_url=f.named.source_url;f.ctx.resolved_brand=f.data.resolved.brand=brand;
  for(const p of [...f.r.scope.products,...f.named.products])p.url=origin+'/products/'+p.id;
  for(const s of f.r.sources)s.url=origin+'/products/'+s.id;
  return f;
}

test('fixed Storefront sources bind exact products and variant evidence for all three brands without whole-store claims',()=>{
  for(const [brand,host] of [['pawfecthouse','pawfecthouse.com'],['giftsoul','giftsoul.co'],['soulprise','soulprise.co']]){
    const f=storefrontFixture(brand,host);addNamedVariant(f.r,'red');
    const before=structuredClone(f);
    assert.deepEqual(evaluateResearch(f.ctx).issues,[]);
    assert.equal(evaluateResearch(f.ctx).status,'READY_WITH_LIMITATIONS');
    assert.equal(attachResearch(f.data,f.ctx).content_plan_assessment?.status,'READY_FOR_HOST_REVIEW');
    assert.equal(f.named.whole_store_scan_complete,false);
    assert.equal(f.r.scope.products[2].catalog_product_id,'a');
    assert.deepEqual(f,before,'structural assessment must preserve source limits and caller evidence');
  }
});

test('Storefront scope rejects wrong brand, unpinned API version and arbitrary endpoint variants',()=>{
  for(const source of [
    'https://giftsoul.co/api/2026-10/graphql.json',
    'https://pawfecthouse.com/api/2026-07/graphql.json',
    'https://pawfecthouse.com/api/latest/graphql.json',
    'https://pawfecthouse.com/admin/api/2026-10/graphql.json',
    'https://pawfecthouse.com/api/2026-10/graphql.json?query=anything',
    'https://pawfecthouse.com/api/2026-10/graphql.json#scope',
    'https://pawfecthouse.com:443/api/2026-10/graphql.json',
    'https://user:password@pawfecthouse.com/api/2026-10/graphql.json',
    'https://pawfecthouse.com.evil.example/api/2026-10/graphql.json',
    'https://www.pawfecthouse.com/api/2026-10/graphql.json',
    'http://pawfecthouse.com/api/2026-10/graphql.json',
    'https://pawfecthouse.com/products.json',
  ]){
    const f=storefrontFixture();f.ctx.source_url=f.r.scope.source_url=f.named.source_url=source;
    assert.ok(evaluateResearch(f.ctx).issues.includes('INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'),source);
  }
});

test('Storefront authority, complete-query flags and exact product membership fail closed',()=>{
  const mutations:Array<[string,(f:ReturnType<typeof storefrontFixture>)=>void,string]>=[
    ['missing authority',f=>{delete f.named.evidence;},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['wrong authority',f=>{f.named.evidence!.authority='TITLE_SEARCH';},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['incomplete query',f=>{f.named.scan_complete=false;},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['more pages',f=>{f.named.has_more_pages=true;},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['whole-store overclaim',f=>{f.named.whole_store_scan_complete=true;},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['missing visibility',f=>{delete f.named.visibility_scope;},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['missing limit note',f=>{delete f.named.publication_note;},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['missing product field',f=>{delete f.named.products[0].product_type;},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['fuzzy product field',f=>{f.named.products[0].product_type='Travel Cases';},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['foreign catalog ID',f=>{f.r.scope.products[0].catalog_product_id='not-returned';},'PRODUCT_OUTSIDE_VERIFIED_NAMED_SCOPE'],
    ['wrong matched PDP',f=>{f.r.scope.products[0].url=f.r.scope.products[1].url;},'PRODUCT_OUTSIDE_VERIFIED_NAMED_SCOPE'],
    ['missing matched product',f=>{f.named.products.push({id:'c',url:'https://pawfecthouse.com/products/c',product_type:'Travel Case'});},'NAMED_PRODUCT_TYPE_INVENTORY_INCOMPLETE'],
  ];
  for(const [name,mutate,issue] of mutations){const f=storefrontFixture();mutate(f);const result=evaluateResearch(f.ctx);
    assert.equal(result.status,'NEEDS_EVIDENCE',name);assert.ok(result.issues.includes(issue),name+': '+result.issues.join(','));}
});

test('trusted named-family source binds exact catalog identities and URLs while retaining variant evidence IDs',()=>{
  const f=namedFixture();addNamedVariant(f.r,'red');
  assert.equal(evaluateResearch(f.ctx).status,'READY_WITH_LIMITATIONS');assert.deepEqual(evaluateResearch(f.ctx).issues,[]);
  const result=attachResearch(f.data,f.ctx);
  assert.equal(result.content_plan_assessment?.status,'READY_FOR_HOST_REVIEW');
  assert.equal(f.r.scope.products.length,3);assert.equal(f.named.products.length,2);
  assert.equal(f.r.scope.products[2].id,'a-red');assert.equal(f.r.scope.products[2].catalog_product_id,'a');
  delete f.r.scope.product_type;assert.equal(evaluateResearch(f.ctx).status,'READY_WITH_LIMITATIONS');assert.deepEqual(evaluateResearch(f.ctx).issues,[]);
});

test('named-family scope rejects mismatched type, catalog ID/URL, false completeness and untrusted source envelopes',()=>{
  const mutations:Array<[string,(f:ReturnType<typeof namedFixture>)=>void,string]>=[
    ['type',f=>{f.r.scope.product_type='Travel Cases';},'NAMED_PRODUCT_TYPE_MISMATCH'],
    ['ID',f=>{f.r.scope.products[0].catalog_product_id='outside';},'PRODUCT_OUTSIDE_VERIFIED_NAMED_SCOPE'],
    ['different verified product URL',f=>{f.r.scope.products[0].url=f.r.scope.products[1].url;},'PRODUCT_OUTSIDE_VERIFIED_NAMED_SCOPE'],
    ['brand URL',f=>{f.r.scope.products[0].url='https://giftsoul.co/products/a';},'PRODUCT_OUTSIDE_VERIFIED_NAMED_SCOPE'],
    ['missing family member',f=>{f.named.products.push({id:'c',url:'https://pawfecthouse.com/products/c'});},'NAMED_PRODUCT_TYPE_INVENTORY_INCOMPLETE'],
    ['unverified catalog',f=>{(f.named as any).catalog_complete=false;},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['fake collection',f=>{f.named.source_url='https://pawfecthouse.com/collections/travel-case';},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['wrong brand catalog',f=>{f.ctx.resolved_brand='giftsoul';},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
    ['duplicate catalog identity',f=>{f.named.products.push(structuredClone(f.named.products[0]));},'INVALID_VERIFIED_NAMED_PRODUCT_SCOPE'],
  ];
  for(const [name,mutate,issue] of mutations){const f=namedFixture();mutate(f);const result=evaluateResearch(f.ctx);assert.equal(result.status,'NEEDS_EVIDENCE',name);assert.ok(result.issues.includes(issue),name+': '+result.issues.join(','));}
  const missingId=namedFixture();addNamedVariant(missingId.r,'red');delete missingId.r.scope.products[2].catalog_product_id;
  assert.ok(evaluateResearch(missingId.ctx).issues.includes('PRODUCT_OUTSIDE_VERIFIED_NAMED_SCOPE'));
  const blocked=attachResearch(missingId.data,missingId.ctx);
  assert.equal(blocked.research_validation.status,'NEEDS_EVIDENCE');assert.deepEqual(blocked.research_validation.structurally_supported_claim_ids,[]);
  assert.equal(blocked.content_plan_assessment?.status,'AWAITING_VALID_RESEARCH');assert.equal(blocked.readiness.content_authoring,'REQUIRES_RESEARCH');
  const raw=fixture(true),before=evaluateResearch(context(raw));raw.named_product_scope={status:'RESOLVED',catalog_complete:true,products:[{id:'invented',url:'https://elsewhere.example/products/fake'}]};
  assert.deepEqual(evaluateResearch(context(raw)),before); // Raw research cannot install a trusted catalog.
});

test('multiple variants cannot inflate the named-family canonical collection minimum or discovered count',()=>{
  const f=namedFixture(5);addNamedVariant(f.r,'red');addNamedVariant(f.r,'blue');
  f.r.scope.inventory_complete=false;
  for(const claim of f.r.claims){claim.scope='shared_subset';claim.qualified=true;claim.qualification='Only the two inspected catalog products and declared variants.';}
  f.r.analysis.content_plan.collection.discovered_product_count=5;
  assert.equal(evaluateResearch(f.ctx).status,'READY_WITH_LIMITATIONS');
  const result=attachResearch(f.data,f.ctx);
  assert.equal(f.r.scope.products.length,4);assert.ok(result.content_plan_assessment?.issues.includes('CANONICAL_COLLECTION_POOL_INSUFFICIENT'));
  f.r.analysis.content_plan.collection.discovered_product_count=2;
  assert.ok(attachResearch(f.data,f.ctx).content_plan_assessment?.issues.includes('NAMED_PRODUCT_TYPE_DISCOVERED_COUNT_MISMATCH'));
});

test('valid GTK and FAQ plans use canonical automatic continuation without dropping evidence or final review', () => {
  for (const collection of [false, true]) for (const mode of ['gtk', 'faq']) {
    const r = fixture(collection); r.analysis.content_plan.post_story.mode = mode;
    if (mode === 'faq') r.analysis.content_plan.post_story.insight_indexes = [0];
    const before = structuredClone(r);
    assert.equal(check(r).status, 'READY_FOR_HOST_REVIEW');
    assert.equal(check(r).selected_mode, mode);
    const attached = attachResearch({ readiness: { asset_generation: 'EXISTING_PIXEL_GATE' },hard_gates:{content_approval:'AUTO_CONTINUE_NO_INTERMEDIATE_CONTENT_SIGNOFF'},content_to_materials_contract:{require_intermediate_content_approval:false} }, context(r));
    assert.equal(attached.readiness.content_authoring, 'REQUIRES_HOST_EVIDENCE_REVIEW');
    assert.equal(attached.readiness.asset_generation, 'EXISTING_PIXEL_GATE');
    assert.equal(attached.content_plan_assessment?.content_approval, 'AUTO_CONTINUE_WITHIN_AUTHORIZED_SCOPE');
    assert.match(attached.content_plan_assessment!.next_action,/internal evidence and semantic review/);
    assert.match(attached.content_plan_assessment!.next_action,/Research-only\/content-only/);
    assert.equal(attached.content_plan_contract!.continuation.final_outcome_review_required,true);
    assert.equal(attached.content_plan_contract!.continuation.packaging_requires_explicit_authorization,true);
    assert.deepEqual(r, before);
  }
});

test('active review gates and unknown policy are preserved without inventing a default member signoff',()=>{
  const r=fixture(),ctx=context(r);
  for(const data of [
    {hard_gates:{content_approval:'HARD'}},
    {content_to_materials_contract:{require_intermediate_content_approval:true}},
    {execution:['BUILD_CONTENT_MAP','CONTENT_APPROVAL_GATE']},
    {hard_gates:{content_approval:'HARD'},content_to_materials_contract:{require_intermediate_content_approval:false}},
  ]){
    const before=structuredClone(data),out=attachResearch(data,ctx);
    assert.equal(out.content_plan_assessment?.content_approval,'REQUIRED_BY_ACTIVE_POLICY');
    assert.match(out.content_plan_assessment!.next_action,/preserve the active content-review gate/);
    assert.equal(out.readiness.asset_generation,'REQUIRES_CONTENT_APPROVAL_AND_PRODUCT_PIXELS');assert.deepEqual(data,before);
  }
  const unspecified=attachResearch({},ctx);
  assert.equal(unspecified.content_plan_assessment?.content_approval,'FOLLOW_ACTIVE_POLICY_AND_EXPLICIT_USER_SCOPE');
  assert.equal(unspecified.readiness.asset_generation,'REQUIRES_ACTIVE_POLICY_AND_PRODUCT_PIXEL_INSPECTION');
  const future=attachResearch({hard_gates:{content_approval:'FUTURE_UNREVIEWED_POLICY'},content_to_materials_contract:{require_intermediate_content_approval:false}},ctx);
  assert.equal(future.content_plan_assessment?.content_approval,'FOLLOW_ACTIVE_POLICY_AND_EXPLICIT_USER_SCOPE');
  const automatic=attachResearch({content_to_materials_contract:{require_intermediate_content_approval:false}},ctx);
  assert.equal(automatic.readiness.asset_generation,'REQUIRES_INTERNAL_CONTENT_REVIEW_AND_PRODUCT_PIXELS');
  assert.equal(ONEPAGE_CONTENT_CONTINUATION.backend_execution_started,false);
  assert.match(ONEPAGE_CONTENT_CONTINUATION.explicit_user_scope.research_only,/do not start copy or materials/);
  assert.match(ONEPAGE_CONTENT_CONTINUATION.explicit_user_scope.content_only,/do not start materials/);
  assert.match(ONEPAGE_CONTENT_CONTINUATION.explicit_user_scope.review_first,/explicit user review/);
});

test('automatic continuation never makes missing research, invalid content or blocked canonical policy ready',()=>{
  const data={hard_gates:{content_approval:'AUTO_CONTINUE_NO_INTERMEDIATE_CONTENT_SIGNOFF'}};
  const missing=attachResearch(data,{source_url:'https://store.example/products/a',require_pdp_coverage:true});
  assert.equal(missing.content_plan_assessment?.status,'AWAITING_VALID_RESEARCH');assert.equal(missing.readiness.content_authoring,'REQUIRES_RESEARCH');
  const invalid=fixture();invalid.analysis.content_plan.details.items=[];
  const result=attachResearch(data,context(invalid));assert.equal(result.content_plan_assessment?.status,'NEEDS_REVISION');assert.equal(result.readiness.content_authoring,'REQUIRES_VALID_CONTENT_PLAN');
  const blocked=attachResearch({...data,creative_quality_contract:{status:'BLOCKED'}},context(fixture()));
  assert.equal(blocked.content_plan_assessment?.status,'BLOCKED_BY_EXISTING_POLICY');assert.equal(blocked.readiness.asset_generation,'BLOCKED');
  const nonOnepage=attachResearch(data,{...context(fixture()),require_pdp_coverage:false});
  assert.equal(nonOnepage.content_plan_assessment,undefined);assert.equal(nonOnepage.readiness.asset_generation,'REQUIRES_CONTENT_APPROVAL_AND_PRODUCT_PIXELS');
});

test('missing plan is initialization, never permission to default to FAQ', () => {
  const r = fixture(); delete r.analysis.content_plan;
  assert.equal(check(r).status, 'REQUIRES_CONTENT_PLAN');
  assert.equal(attachResearch({}, context(r)).readiness.content_authoring, 'REQUIRES_VALID_CONTENT_PLAN');
  assert.equal('content_plan_assessment' in attachResearch({}, { ...context(r), require_pdp_coverage: false }), false);
  assert.equal(evaluateOnepageContentPlan(undefined, { status: 'AWAITING_RESEARCH', structurally_supported_claim_ids: [] }).status, 'AWAITING_VALID_RESEARCH');
});

const mutations: [string, (r: any) => void, string][] = [
  ['appended emotional title', r => { r.analysis.content_plan.banner.desktop_title += ' — Carry Your Memories'; }, 'BANNER_TITLE_MUST_EQUAL_PRODUCT_KEYWORD'],
  ['mobile title drift', r => { r.analysis.content_plan.banner.mobile_title = 'Carry Your Memories'; }, 'BANNER_TITLE_MUST_EQUAL_PRODUCT_KEYWORD'],
  ['mobile support', r => { r.analysis.content_plan.banner.mobile_support = 'Extra phrase'; }, 'BANNER_SUPPORT_DESKTOP_ONLY_NO_SUBTITLE'],
  ['subtitle', r => { r.analysis.content_plan.banner.subtitle = 'Extra phrase'; }, 'BANNER_SUPPORT_DESKTOP_ONLY_NO_SUBTITLE'],
  ['unknown keyword source', r => { r.analysis.content_plan.banner.keyword_source_ids = ['missing']; }, 'VERIFIED_PRODUCT_KEYWORD_REQUIRED'],
  ['missing mode rationale', r => { r.analysis.content_plan.post_story.rationale = 'Default FAQs'; }, 'RESEARCH_BASED_MODE_COMPARISON_REQUIRED'],
  ['unsupported mode source', r => { r.analysis.content_plan.post_story.source_ids = ['missing']; }, 'RESEARCH_BASED_MODE_COMPARISON_REQUIRED'],
  ['both modes', r => { r.analysis.content_plan.post_story.mode = 'gtk+faq'; }, 'RESEARCH_BASED_MODE_COMPARISON_REQUIRED'],
  ['GTK filler count', r => { r.analysis.content_plan.post_story.insight_indexes = [0, 1]; }, 'INVALID_POST_STORY_ITEMS'],
  ['duplicate insight', r => { r.analysis.content_plan.post_story.insight_indexes = [0, 0, 0]; }, 'INVALID_POST_STORY_ITEMS'],
  ['missing answer evidence', r => { r.analysis.insights[0].claim_ids = []; }, 'POST_STORY_SUPPORTED_ANSWER_REQUIRED'],
  ['unsupported detail', r => { r.analysis.content_plan.details.items[0].claim_ids = ['hooks-not-verified']; }, 'THREE_EVIDENCED_ANCHOR_DETAILS_REQUIRED'],
  ['wrong anchor', r => { r.analysis.content_plan.details.anchor_product_id = 'missing'; }, 'THREE_EVIDENCED_ANCHOR_DETAILS_REQUIRED'],
  ['duplicate proofs', r => { r.analysis.content_plan.details.items[1].visible_proof = r.analysis.content_plan.details.items[0].visible_proof; }, 'DISTINCT_DETAIL_PROOFS_REQUIRED'],
];
for (const [name, mutate, issue] of mutations) test(`rejects ${name}`, () => {
  const r = fixture(); mutate(r);
  const result = check(r); assert.equal(result.status, 'NEEDS_REVISION'); assert.ok(result.issues.includes(issue)); assert.equal(result.selected_mode, null);
});

test('collection cannot substitute a demo SKU or claim complete enumeration with missing products', () => {
  const r = fixture(true); r.analysis.content_plan.collection.discovered_product_count = 158;
  assert.ok(check(r).issues.includes('COLLECTION_COMPLETENESS_CONTRADICTION'));
  const single = fixture(); single.scope.source_type = 'collection'; single.scope.source_url = 'https://store.example/collections/items'; single.scope.inventory_complete = false;
  for (const c of single.claims) { c.scope = 'shared_subset'; c.qualified = true; c.qualification = 'Only the inspected subset.'; }
  single.analysis.content_plan.collection = r.analysis.content_plan.collection;
  assert.ok(check(single).issues.includes('COLLECTION_SINGLE_DEMO_COVERAGE'));
});

test('SKU facts cannot masquerade as collection-wide post-story guidance', () => {
  const r = fixture(true); const c = r.claims[0]; c.scope = 'sku'; c.product_ids = ['a'];
  assert.ok(check(r).issues.includes('COLLECTION_POST_STORY_REQUIRES_SHARED_EVIDENCE'));
  assert.ok(check(r).issues.includes('COLLECTION_COVERAGE_AND_SHARED_FACTS_REQUIRED'));
});

test('research failures and canonical blocks dominate a plausible content plan', () => {
  const r = fixture(); r.sources[0].status = 'unavailable';
  assert.equal(check(r).status, 'AWAITING_VALID_RESEARCH');
  assert.equal(evaluateOnepageContentPlan(fixture(), { status: 'READY', structurally_supported_claim_ids: [] }, true).status, 'BLOCKED_BY_EXISTING_POLICY');
  assert.equal(attachResearch({ creative_quality_contract: { status: 'BLOCKED' } }, context(fixture())).readiness.content_authoring, 'BLOCKED');
});

test('canonical collection pool minimum is preserved without inventing extra designs', () => {
  const r = fixture(true); r.scope.inventory_complete = false;
  for (const c of r.claims) { c.scope = 'shared_subset'; c.qualified = true; c.qualification = 'Only the inspected subset.'; }
  r.analysis.content_plan.collection.discovered_product_count = 158;
  const result = attachResearch({ acquisition_contract: { min_verified_designs: 4 } }, context(r));
  assert.ok(result.content_plan_assessment?.issues.includes('CANONICAL_COLLECTION_POOL_INSUFFICIENT'));
  r.analysis.content_plan.collection.discovered_product_count = 2;
  assert.equal(attachResearch({ acquisition_contract: { min_verified_designs: 4 } }, context(r)).content_plan_assessment?.status, 'READY_FOR_HOST_REVIEW');
});

test('AI illustrations cannot become answer or detail evidence', () => {
  for (const item of [false, true]) {
    const r = fixture();
    (item ? r.sources[0].pdp_coverage.details.items[0] : r.sources[0]).evidence_origin = 'ai_generated_illustration';
    assert.ok(check(r).issues.includes('POST_STORY_SUPPORTED_ANSWER_REQUIRED'));
    assert.ok(check(r).issues.includes('THREE_EVIDENCED_ANCHOR_DETAILS_REQUIRED'));
  }
});

test('selection evidence must link answers, and covered content cannot be recycled', () => {
  const r = fixture(true); r.analysis.content_plan.post_story.source_ids = ['a'];
  assert.ok(check(r).issues.includes('MODE_EVIDENCE_NOT_LINKED_TO_ANSWERS'));
  const covered = fixture(); covered.analysis.insight_value = { existing_content: [{ ...covered.analysis.insights[0], id: 'already-in-details' }] };
  assert.ok(check(covered).issues.includes('POST_STORY_ALREADY_COVERED'));
});

test('malformed content-plan envelopes fail closed without crashing', () => {
  for (const value of [null, [], {}, 'faq', { schema_version: ONEPAGE_CONTENT_PLAN_VERSION }, { schema_version: ONEPAGE_CONTENT_PLAN_VERSION, banner: [], post_story: { mode: 'gtk', insight_indexes: [null, -1, 1000] }, details: null }]) {
    const r = fixture(); r.analysis.content_plan = value;
    assert.notEqual(check(r).status, 'READY_FOR_HOST_REVIEW');
    assert.equal(check(r).selected_mode, null);
  }
});

test('subtitle cannot hide in multiline copy or unvalidated title aliases', () => {
  for (const separator of ['\n', '\r\n', '\u2028', '\u2029']) {
    const r = fixture();
    for (const key of ['product_keyword', 'desktop_title', 'mobile_title']) r.analysis.content_plan.banner[key] += separator + 'Carry Your Memories';
    assert.ok(check(r).issues.includes('MULTILINE_BANNER_COPY_FORBIDDEN'));
  }
  for (const alias of ['title', 'headline', 'mobile_subtitle', 'desktop_subtitle', 'support_text', 'tagline']) {
    const r = fixture(); r.analysis.content_plan.banner[alias] = 'Carry Your Memories';
    assert.ok(check(r).issues.includes('UNKNOWN_BANNER_COPY_FIELD'));
  }
});

test('subset fact cannot be promoted to the whole collection and PDP cannot drift to another SKU', () => {
  const r = fixture(true); r.claims[0].product_ids = ['a'];
  assert.equal(check(r).status, 'AWAITING_VALID_RESEARCH');
  assert.ok(evaluateResearch(context(r)).issues.includes('UNSUPPORTED_COLLECTION_GENERALIZATION:material'));
  const single = fixture(); single.scope.products.push({ id: 'b', url: 'https://store.example/products/b', variant: 'selected' });
  assert.equal(check(single).status, 'AWAITING_VALID_RESEARCH');
  assert.ok(evaluateResearch(context(single)).issues.includes('PDP_SCOPE_DRIFT'));
});

test('rejects invented Occasion UI blocks even when copy was approved outside the template', () => {
  for (const key of ['occasion', 'occasion_heading', 'occasion_support', 'sections', 'layout', 'ui']) {
    const r = fixture(); r.analysis.content_plan[key] = { title: 'A Gift For Their Moments', support: 'Invented support from an approved draft.' };
    const result = attachResearch({}, context(r));
    assert.ok(result.content_plan_assessment!.issues.includes('UNKNOWN_CONTENT_PLAN_FIELD'), key);
    assert.equal(result.readiness.content_authoring, 'REQUIRES_VALID_CONTENT_PLAN');
  }
  for (const block of ['post_story', 'details', 'collection']) {
    const r = fixture(true); r.analysis.content_plan[block].heading = 'Invented UI heading';
    assert.ok(check(r).issues.includes('UNKNOWN_CONTENT_PLAN_FIELD'));
  }
});

test('full UI draft permits product copy only in existing slots, not fixed UI headings or image pair', () => {
  const r = fixture();
  const copy = Object.fromEntries(Array.from({ length: 13 }, (_, i) => String(i + 1).padStart(2, '0')).flatMap(n => [[`title_${n}`, `Product-specific title ${n}`], [`description_${n}`, `Evidence-backed product copy ${n}`]]));
  r.analysis.content_plan.ui_copy = copy;
  assert.equal(check(r).status, 'READY_FOR_HOST_REVIEW');
  for (const key of ['occasion_heading', 'occasion_support', 'product_details_heading', 'title_14', 'banner_title']) {
    r.analysis.content_plan.ui_copy = { ...copy, [key]: 'A Gift For Their Moments' };
    assert.ok(check(r).issues.includes('UI_COPY_OUTSIDE_TEMPLATE_SLOTS'), key);
  }
  r.analysis.content_plan.ui_copy = { ...copy }; delete r.analysis.content_plan.ui_copy.title_07;
  assert.ok(check(r).issues.includes('UI_COPY_MISSING_TEMPLATE_SLOTS'));
  r.analysis.content_plan.ui_copy = { ...copy, title_07: { html: '<h2>Extra block</h2>' } };
  assert.ok(check(r).issues.includes('UI_COPY_REQUIRES_NONEMPTY_TEXT'));
});

test('FAQ copy allows exactly selected answer rows without GTK slots or arbitrary UI additions', () => {
  const r = fixture(); r.analysis.content_plan.post_story.mode = 'faq'; r.analysis.content_plan.post_story.insight_indexes = [0, 1];
  const copy = Object.fromEntries(Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0')).flatMap(n => [[`title_${n}`, `Product title ${n}`], [`description_${n}`, `Product copy ${n}`]]));
  const faq = { ...copy, faq_heading: 'Questions about this product', faq_question_01: 'Question one?', faq_answer_01: 'Supported answer one.', faq_question_02: 'Question two?', faq_answer_02: 'Supported answer two.' };
  r.analysis.content_plan.ui_copy = faq;
  assert.equal(check(r).status, 'READY_FOR_HOST_REVIEW');
  for (const key of ['title_11', 'faq_question_03', 'occasion_support']) {
    r.analysis.content_plan.ui_copy = { ...faq, [key]: 'Unmapped copy' };
    assert.ok(check(r).issues.includes('UI_COPY_OUTSIDE_TEMPLATE_SLOTS'));
  }
});

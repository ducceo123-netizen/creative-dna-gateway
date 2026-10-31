import test from 'node:test';
import assert from 'node:assert/strict';
import { attachResearch, evaluateResearch, RESEARCH_VERSION } from '../supabase/functions/_shared/product-research.ts';
import { ONEPAGE_CONTENT_PLAN_VERSION, evaluateOnepageContentPlan } from '../supabase/functions/_shared/onepage-content-plan.ts';

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

test('valid GTK and FAQ decisions retain research, approval and canonical gates', () => {
  for (const collection of [false, true]) for (const mode of ['gtk', 'faq']) {
    const r = fixture(collection); r.analysis.content_plan.post_story.mode = mode;
    if (mode === 'faq') r.analysis.content_plan.post_story.insight_indexes = [0];
    const before = structuredClone(r);
    assert.equal(check(r).status, 'READY_FOR_HOST_REVIEW');
    assert.equal(check(r).selected_mode, mode);
    const attached = attachResearch({ readiness: { asset_generation: 'EXISTING_PIXEL_GATE' } }, context(r));
    assert.equal(attached.readiness.content_authoring, 'REQUIRES_HOST_EVIDENCE_REVIEW');
    assert.equal(attached.readiness.asset_generation, 'EXISTING_PIXEL_GATE');
    assert.equal(attached.content_plan_assessment?.content_approval, 'STILL_REQUIRED');
    assert.deepEqual(r, before);
  }
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

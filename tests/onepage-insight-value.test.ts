import test from 'node:test';
import assert from 'node:assert/strict';
import { attachResearch, evaluateResearch, RESEARCH_VERSION } from '../supabase/functions/_shared/product-research.ts';
import { evaluateInsightValue, INSIGHT_VALUE_CONTRACT, INSIGHT_VALUE_VERSION } from '../supabase/functions/_shared/onepage-insight-value.ts';

// Offline contract fixture based on the public blanket case inspected on 2026-10-23.
// It is not a production research packet, source receipt or assertion of complete PDP inspection.
// The family-level review suggests a question only. The official option identities supply facts.
const PDP = 'https://pawfecthouse.com/products/think-of-this-blanket-as-a-hug-family-personalized-custom-blanket-gift-for-grandma';
const SKU = 'Blanket-50x60';
const VARIANT = 'Fleece / As Preview / 50x60 IN; variant 51653473599777';
const REVIEW = 'https://www.trustpilot.com/reviews/6ada5c651dbe9c8e13269064';
function fixture(): any {
  return {
    schema_version: RESEARCH_VERSION,
    scope: { source_url: PDP, source_type: 'product', products: [{ id: SKU, url: PDP, variant: VARIANT }], inventory_complete: true, coverage_note: 'Offline structural fixture for the selected Fleece option; not an inspection attestation.' },
    sources: [{
      id: 'pdp', url: PDP, kind: 'target_pdp', status: 'inspected', match: 'exact', product_ids: [SKU], product_versions: { [SKU]: VARIANT },
      observed_at: '2026-10-23T07:53:00Z', evidence_origin: 'retrieved_source', excerpts: ['The option is Fleece / As Preview / 50x60 IN.'],
      sections: ['description', 'specifications', 'options', 'care_use'].map(name => ({ name, status: 'inspected', note: 'Offline fixture observation for the selected option, not a live inspection receipt.' })),
      pdp_coverage: {
        schema_version: 'uid-pdp-coverage/1', inventory_complete: true, enumeration_note: 'Minimal synthetic inventory for structural testing only, not the full live PDP.',
        gallery: { discovered_count: 1, items: [{ id: 'material-picture', url: 'https://cdn.shopify.com/s/files/1/0936/0008/8353/files/Blanket-material_4bc81978-a4b5-44e2-aa6e-132be474dd70.jpg?v=1756882994', position: 1, kind: 'image', variant: VARIANT, status: 'inspected', method: 'image_view', observation: 'Fixture records the official material comparison, not an AI-rendered blanket.' }] },
        details: { discovered_count: 1, items: [{ id: 'options', label: 'Material and size options', variant: VARIANT, status: 'inspected', method: 'source_text', observation: 'Product option records distinguish Fleece from Sherpa; selected SKU is Fleece 50x60.' }] },
      },
    }, {
      id: 'family-review', url: REVIEW, kind: 'target_reviews', status: 'partial', match: 'unverified', product_ids: [],
      observed_at: '2026-10-23T07:14:06Z', excerpts: ['A blanket reviewer wished they had chosen Sherpa instead of Fleece. Exact purchased SKU is not established.'],
      reviews: { inspected_count: 1, selection: 'A single family-level example, not a representative sample or exact SKU review.', complete: false },
    }],
    coverage: ['target_pdp', 'target_reviews', 'marketplace', 'competitor', 'supplier'].map(category => ({ category, status: category === 'target_pdp' ? 'inspected' : category === 'target_reviews' ? 'partial' : 'not_found', source_ids: category === 'target_pdp' ? ['pdp'] : category === 'target_reviews' ? ['family-review'] : [], notes: 'Offline contract fixture records limited evidence, not a new research execution.' })),
    claims: [{ id: 'material-choice', text: 'The selected 50x60 option is Fleece.', kind: 'product_fact', scope: 'sku', product_ids: [SKU], source_ids: ['pdp'], evidence_items: [{ source_id: 'pdp', item_id: 'options' }], qualified: false }],
    analysis: {
      insights: [{ concern: 'How can I avoid choosing the wrong blanket material?', claim_ids: ['material-choice'], implication: 'Show the selected Fleece option beside the material comparison; ask the buyer to check material rather than infer it from the personalized front.', section: 'Product Details' }],
      unknowns: ['The review does not establish the purchased SKU, cause, failure rate or relative warmth.'], conflicts: [],
      insight_value: {
        schema_version: INSIGHT_VALUE_VERSION,
        baseline_note: 'Current fixture content names Fleece in Product Details but does not guide the material-choice decision. No locked copy is changed by this assessment.',
        existing_content: [{ id: 'material-row', concern: 'What material is selected?', implication: 'The option label names Fleece.', claim_ids: ['material-choice'], section: 'Product Details' }],
        candidates: [{ insight_index: 0, novelty: 'clearer_decision', customer_job: 'choose_variant', customer_action: 'Check the selected material against the official options before adding to cart.', applicability: 'current_scope_verified', evidence: 'supported', reason: 'The same verified option becomes a concrete material-selection check. The family review motivates the question but is not a specification, testimonial or proven cause.' }],
      },
    },
  };
}
const context = (r: any) => ({ source_url: PDP, research: r, require_pdp_coverage: true });
const evaluate = (r: any) => evaluateInsightValue(r, evaluateResearch(context(r)));

test('blanket concern improves an existing decision using the same official claim, not the unmatched review', () => {
  const r = fixture(), before = structuredClone(r);
  assert.equal(evaluateResearch(context(r)).status, 'READY_WITH_LIMITATIONS');
  const result = evaluate(r);
  assert.equal(result.status, 'READY_FOR_HOST_REVIEW');
  assert.deepEqual(result.eligible_insight_indexes, [0]);
  assert.equal(result.semantics, 'REQUIRES_HOST_REVIEW');
  assert.deepEqual(r, before);
});

test('same facts are not new information, but a clearer customer decision can be useful', () => {
  const r = fixture(); r.analysis.insight_value.candidates[0].novelty = 'new_information';
  assert.equal(evaluate(r).status, 'NO_INCREMENTAL_VALUE');
  assert.ok(evaluate(r).decisions[0].reasons.includes('NO_INCREMENTAL_INFORMATION'));
  r.analysis.insight_value.candidates[0].novelty = 'clearer_decision';
  assert.deepEqual(evaluate(r).eligible_insight_indexes, [0]);
});

test('exact normalized answers already covered are skipped, even in another section', () => {
  const r = fixture(), i = r.analysis.insights[0];
  r.analysis.insight_value.existing_content = [{ ...i, id: 'already-shown', concern: ` ${i.concern.toUpperCase()} `, section: 'Why You Will Love It' }];
  assert.equal(evaluate(r).status, 'NO_INCREMENTAL_VALUE');
});

test('repeated candidate content is deduplicated without repeating research', () => {
  const r = fixture();
  r.analysis.insights.push({ ...r.analysis.insights[0], section: 'Good to Know' });
  r.analysis.insight_value.candidates.push({ ...r.analysis.insight_value.candidates[0], insight_index: 1 });
  assert.deepEqual(evaluate(r).eligible_insight_indexes, [0]);
  assert.deepEqual(evaluate(r).decisions[1].reasons, ['DUPLICATE_CANDIDATE']);
});

test('generic reassurance with no customer job/action is skipped, not padded into FAQ or GTK', () => {
  const r = fixture(); Object.assign(r.analysis.insight_value.candidates[0], { customer_job: 'none', customer_action: '' });
  assert.equal(evaluate(r).status, 'NO_INCREMENTAL_VALUE');
  assert.deepEqual(evaluate(r).eligible_insight_indexes, []);
  assert.match(INSIGHT_VALUE_CONTRACT.instruction, /Do not force extra FAQ/);
});

for (const [key, value] of [['applicability', 'family_only'], ['applicability', 'stale'], ['applicability', 'unknown'], ['evidence', 'insufficient'], ['evidence', 'conflicting']] as const) test(`${key}=${value} cannot become eligible`, () => {
  const r = fixture(); r.analysis.insight_value.candidates[0][key] = value;
  assert.equal(evaluate(r).status, 'NEEDS_REVISION');
  assert.deepEqual(evaluate(r).eligible_insight_indexes, []);
});

test('unsupported facts and family reviews disguised as exact-SKU experience remain blocked by research', () => {
  for (const kind of ['product_fact', 'customer_experience']) {
    const r = fixture(); Object.assign(r.claims[0], { kind, source_ids: ['family-review'], qualified: true, qualification: 'One reported experience only; not general product performance.' });
    assert.equal(evaluate(r).status, 'AWAITING_VALID_RESEARCH');
    assert.deepEqual(evaluate(r).eligible_insight_indexes, []);
  }
});

test('old variant identity cannot pass against the current selected variant', () => {
  const r = fixture(); r.sources[0].product_versions[SKU] = 'variant 45584702734568';
  assert.equal(evaluate(r).status, 'AWAITING_VALID_RESEARCH');
  assert.deepEqual(evaluate(r).eligible_insight_indexes, []);
});

test('unresolved or qualified contradictions are not automatically promoted by the selector', () => {
  for (const resolution of ['unresolved', 'qualify']) {
    const r = fixture(); r.analysis.conflicts = [{ description: 'Fixture supplier contradicts the selected material.', claim_ids: ['material-choice'], resolution }];
    Object.assign(r.claims[0], { qualified: true, qualification: 'Material evidence conflicts; do not decide this automatically.' });
    assert.deepEqual(evaluate(r).eligible_insight_indexes, []);
  }
});

test('AI-generated source or linked item cannot prove a product fact; unrelated illustrations do not block', () => {
  for (const location of ['source', 'item']) {
    const r = fixture();
    if (location === 'source') r.sources[0].evidence_origin = 'ai_generated_illustration';
    else r.sources[0].pdp_coverage.details.items[0].evidence_origin = 'ai_generated_illustration';
    assert.deepEqual(evaluate(r).eligible_insight_indexes, []);
    assert.ok(evaluate(r).decisions[0].reasons.includes('AI_ILLUSTRATION_NOT_EVIDENCE'));
  }
  const r = fixture(); r.sources[0].pdp_coverage.gallery.items[0].evidence_origin = 'ai_generated_illustration';
  assert.deepEqual(evaluate(r).eligible_insight_indexes, [0]); // Claim cites official options, not that image.
});

test('no-claim unknown is not converted to an answer; analogy-only support is not a product answer', () => {
  const r = fixture(); r.analysis.insights[0].claim_ids = [];
  assert.deepEqual(evaluate(r).eligible_insight_indexes, []);
  assert.ok(evaluate(r).decisions[0].reasons.includes('SUPPORTED_CLAIMS_REQUIRED'));
  r.analysis.insights[0].claim_ids = ['material-choice'];
  r.claims[0].kind = 'analogue_insight'; // Direct evaluator defensive test; normal research also rejects its source kind.
  const result = evaluateInsightValue(r, { status: 'READY', structurally_supported_claim_ids: ['material-choice'] });
  assert.deepEqual(result.eligible_insight_indexes, []);
});

test('malformed optional assessment never selects partial successes', () => {
  const mutations = [
    (r: any) => { r.analysis.insight_value.candidates.push({ ...r.analysis.insight_value.candidates[0] }); },
    (r: any) => { r.analysis.insight_value.candidates[0].insight_index = 7; },
    (r: any) => { r.analysis.insight_value.candidates[0].insight_index = 0.5; },
    (r: any) => { r.analysis.insight_value.existing_content[0].claim_ids = ['not-a-claim']; },
    (r: any) => { r.analysis.insight_value.existing_content.push({ ...r.analysis.insight_value.existing_content[0] }); },
    (r: any) => { r.analysis.insight_value.candidates[0].reason = 'good'; },
    (r: any) => { delete r.analysis.insight_value.baseline_note; },
  ];
  for (const mutate of mutations) { const r = fixture(); mutate(r); assert.equal(evaluate(r).status, 'NEEDS_REVISION'); assert.deepEqual(evaluate(r).eligible_insight_indexes, []); }
});

test('omitted or empty assessment does not invent content or impose extra research', () => {
  const r = fixture(); delete r.analysis.insight_value;
  assert.equal(evaluate(r).status, 'NOT_ASSESSED');
  assert.equal(evaluateResearch(context(r)).status, 'READY_WITH_LIMITATIONS');
  const empty = fixture(); empty.analysis.insight_value.candidates = [];
  assert.equal(evaluate(empty).status, 'NO_INCREMENTAL_VALUE');
});

test('Onepage attachment preserves all gates and does not leak an assessment into other routes', () => {
  const r = fixture(), data = { content: { locked: 'Keep exact approved copy' }, readiness: { asset_generation: 'REQUIRES_CONTENT_APPROVAL_AND_PRODUCT_PIXELS' } };
  const result = attachResearch(data, context(r));
  assert.deepEqual(result.insight_value_assessment?.eligible_insight_indexes, [0]);
  assert.equal(result.readiness.content_authoring, 'REQUIRES_HOST_EVIDENCE_REVIEW');
  assert.equal(result.readiness.asset_generation, data.readiness.asset_generation);
  assert.deepEqual(result.content, data.content);
  const blocked = attachResearch({ ...data, creative_quality_contract: { status: 'BLOCKED' } }, context(r));
  assert.equal(blocked.readiness.content_authoring, 'BLOCKED');
  assert.deepEqual(blocked.insight_value_assessment?.eligible_insight_indexes, []);
  const other = attachResearch(data, { ...context(r), require_pdp_coverage: false });
  assert.equal('insight_value_assessment' in other, false);
});


test('extra malformed evidence refs on a research-valid experience never crash the public attachment path', () => {
  for (const malformed of [{}, [null], 'broken', [{ source_id: 'family-review', item_id: 'missing' }]]) {
    const r = fixture();
    Object.assign(r.sources[1], { match: 'exact', product_ids: [SKU], product_versions: { [SKU]: VARIANT } });
    Object.assign(r.claims[0], { kind: 'customer_experience', source_ids: ['family-review'], qualified: true, qualification: 'Synthetic exact-review binding for defensive shape tests, not a real SKU attribution.', evidence_items: malformed });
    assert.equal(evaluateResearch(context(r)).status, 'READY_WITH_LIMITATIONS');
    const result = attachResearch({}, context(r));
    assert.deepEqual(result.insight_value_assessment?.eligible_insight_indexes, []);
    assert.ok(result.insight_value_assessment?.decisions[0].reasons.includes('INVALID_EVIDENCE_REFS'));
  }
});

test('malformed nested inventories carried by otherwise valid non-product evidence fail safely', () => {
  for (const malformed of [{ gallery: { items: {} }, details: { items: [] } }, { gallery: { items: [null] }, details: { items: [] } }, { gallery: { items: 'wrong' }, details: {} }]) {
    const r = fixture();
    Object.assign(r.sources[1], { match: 'exact', product_ids: [SKU], product_versions: { [SKU]: VARIANT }, pdp_coverage: malformed });
    Object.assign(r.claims[0], { kind: 'customer_experience', source_ids: ['family-review'], qualified: true, qualification: 'Synthetic exact-review binding for defensive shape tests, not a real SKU attribution.', evidence_items: [{ source_id: 'family-review', item_id: 'fake' }] });
    assert.equal(evaluateResearch(context(r)).status, 'READY_WITH_LIMITATIONS');
    const result = attachResearch({}, context(r));
    assert.deepEqual(result.insight_value_assessment?.eligible_insight_indexes, []);
    assert.ok(result.insight_value_assessment?.decisions[0].reasons.includes('INVALID_EVIDENCE_REFS'));
  }
});


test('moving a covered fact to another section or combining covered facts is not new information', () => {
  const r = fixture();
  r.analysis.insights[0].section = 'Good to Know';
  r.analysis.insight_value.candidates[0].novelty = 'new_information';
  assert.deepEqual(evaluate(r).eligible_insight_indexes, []);
  r.claims.push({ ...r.claims[0], id: 'selected-size', text: 'The selected option is 50x60 IN.' });
  r.analysis.insights[0].claim_ids.push('selected-size');
  r.analysis.insight_value.existing_content.push({ id: 'size-row', concern: 'What size is selected?', implication: 'The selected option is 50x60 IN.', claim_ids: ['selected-size'], section: 'Specifications' });
  assert.deepEqual(evaluate(r).eligible_insight_indexes, []);
  assert.ok(evaluate(r).decisions[0].reasons.includes('NO_INCREMENTAL_INFORMATION'));
  r.analysis.insight_value.candidates[0].novelty = 'clearer_decision';
  assert.deepEqual(evaluate(r).eligible_insight_indexes, [0]);
});

test('later candidates cannot re-label earlier selected claims as new information', () => {
  const r = fixture(); r.analysis.insight_value.existing_content = [];
  r.analysis.insight_value.candidates[0].novelty = 'new_information';
  r.analysis.insights.push({ ...r.analysis.insights[0], concern: 'Another wording of the same selected material fact', section: 'Good to Know' });
  r.analysis.insight_value.candidates.push({ ...r.analysis.insight_value.candidates[0], insight_index: 1 });
  assert.deepEqual(evaluate(r).eligible_insight_indexes, [0]);
  assert.ok(evaluate(r).decisions[1].reasons.includes('NO_INCREMENTAL_INFORMATION'));
});

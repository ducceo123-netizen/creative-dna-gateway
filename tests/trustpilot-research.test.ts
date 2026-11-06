import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrustpilotResearch, TRUSTPILOT_CONTRACT, TRUSTPILOT_GUIDANCE, TRUSTPILOT_PROFILES, TRUSTPILOT_STEP, withTrustpilotStep } from '../supabase/functions/_shared/trustpilot-research.ts';
import { attachResearch, ONEPAGE_RESEARCH_GUIDANCE } from '../supabase/functions/_shared/product-research.ts';
import { compileOnepageJob, resolveCreativeDna, createApp } from '../server.ts';
import { blockedTrustpilotFixture } from './fixtures/trustpilot.fixture.ts';

const source_url = 'https://pawfecthouse.com/products/synthetic-mug';
const products = [{ id: 'mug-blue', url: source_url, variant: 'blue / 11oz' }];
const context = { required: true, source_url, resolved_brand: 'pawfecthouse', products, now: Date.parse('2026-11-06T00:00:00Z') };
// All data below is synthetic. Tests exercise structure, not actual Trustpilot findings.
function fixture(): any {
  const r: any = blockedTrustpilotFixture(source_url, ['mug-blue']);
  Object.assign(r.attempts[0], { status: 'completed', reviews_inspected: 1 });
  r.observations = [{ id: 'o1', attempt_id: 'test-attempt', url: 'https://www.trustpilot.com/reviews/1234567890abcdef12345678', profile_url: r.scope.profile_url, published_at: '2026-10-18T00:00:00Z', observed_at: '2026-10-19T00:00:00Z', method: 'review_text_and_context', finding: 'Synthetic reviewer liked the personalization.', signal: 'positive', scope: 'product', product_ids: ['mug-blue'], product_versions: { 'mug-blue': 'blue / 11oz' }, match_basis: 'Synthetic explicit exact product and selected variant match.', limitations: ['Synthetic anecdote only.'] }];
  r.insights = [{ id: 'i1', evidence_ids: ['o1'], counterevidence_ids: [], counterevidence_note: 'Synthetic search found no contrary observation in this bounded sample.', scope: 'product', product_ids: ['mug-blue'], interpretation: 'Some buyers may care about personalization clarity.', application: 'Test a name-entry explanation using current official product facts.', limitations: ['One synthetic anecdote, not specifications or a representative sample.'] }];
  return r;
}
const check = (r?: unknown) => evaluateTrustpilotResearch(r, context);
test('hard-coded brand profiles and no-network execution are explicit', () => {
  assert.equal(TRUSTPILOT_PROFILES.pawfecthouse, 'https://www.trustpilot.com/review/pawfecthouse.com');
  assert.equal(TRUSTPILOT_PROFILES.giftsoul, 'https://www.trustpilot.com/review/giftsoul.co');
  assert.equal(TRUSTPILOT_CONTRACT.server_crawls, false);
  assert.ok(ONEPAGE_RESEARCH_GUIDANCE.includes(TRUSTPILOT_GUIDANCE));
  assert.equal(check().status, 'AWAITING_RESEARCH');
  assert.equal(evaluateTrustpilotResearch(undefined, { ...context, resolved_brand: 'SoulPrise' }).status, 'NOT_REQUIRED');
  assert.equal(evaluateTrustpilotResearch(undefined, { ...context, required: false }).status, 'NOT_REQUIRED');
  assert.equal(evaluateTrustpilotResearch(undefined, { ...context, resolved_brand: undefined }).status, 'NEEDS_EVIDENCE');
});
test('product-matched findings remain anecdotes and structural only', () => {
  const r = check(fixture());
  assert.equal(r.status, 'STRUCTURALLY_COMPLETE');
  assert.deepEqual(r.usable_customer_insight_ids, ['i1']);
  assert.equal(r.source_authenticity, 'NOT_SERVER_VERIFIED');
  assert.equal(r.product_truth, 'NOT_SUPPORTED');
  assert.equal(r.market_proof, 'NOT_SUPPORTED');
});
for (const status of ['blocked', 'no_product_matches', 'partial']) test(`honest ${status} with no reviews permits limited continuation`, () => {
  const r = blockedTrustpilotFixture(source_url, ['mug-blue']); r.attempts[0].status = status;
  const out = check(r); assert.equal(out.status, 'ATTEMPTED_WITH_LIMITATIONS'); assert.deepEqual(out.usable_customer_insight_ids, []);
});
test('store-only reviews cannot become SKU experience or specs', () => {
  const r = fixture(); Object.assign(r.observations[0], { scope: 'store', product_ids: [], product_versions: {}, match_basis: 'Shipping comment does not identify a SKU.' });
  assert.equal(check(r).status, 'NEEDS_EVIDENCE');
  Object.assign(r.insights[0], { scope: 'store', product_ids: [] });
  r.attempts[0].status = 'no_product_matches';
  assert.equal(check(r).status, 'ATTEMPTED_WITH_LIMITATIONS');
});
const mutations: [string, (r: any) => void][] = [
  ['missing query', r => r.attempts[0].queries = []],
  ['missing limitations', r => r.attempts[0].limitations = []],
  ['no searches', r => r.attempts = []],
  ['wrong brand profile', r => r.scope.profile_url = TRUSTPILOT_PROFILES.giftsoul],
  ['wrong source', r => r.scope.source_url += '?variant=other'],
  ['wrong product scope', r => r.scope.product_ids = ['different']],
  ['wrong observation profile', r => r.observations[0].profile_url = TRUSTPILOT_PROFILES.giftsoul],
  ['wrong variant', r => r.observations[0].product_versions['mug-blue'] = 'other'],
  ['unknown product', r => r.observations[0].product_ids = ['other']],
  ['missing match basis', r => delete r.observations[0].match_basis],
  ['snippets only', r => r.observations[0].method = 'search_snippet'],
  ['profile URL as review', r => r.observations[0].url = r.scope.profile_url],
  ['spoofed URL', r => r.observations[0].url = 'https://trustpilot.com.evil.test/reviews/1234567890abcdef12345678'],
  ['credentials URL', r => r.observations[0].url = 'https://user:secret@trustpilot.com/reviews/1234567890abcdef12345678'],
  ['wrong scheme', r => r.observations[0].url = r.observations[0].url.replace('https:', 'http:')],
  ['duplicate review', r => { r.observations.push({ ...r.observations[0], id: 'o2', url: r.observations[0].url.replace('www.', '') }); r.attempts[0].reviews_inspected = 2; }],
  ['future date', r => r.observations[0].published_at = '2099-01-01T00:00:00Z'],
  ['invalid calendar date', r => r.observations[0].published_at = '2026-02-30T00:00:00Z'],
  ['missing timezone', r => r.observations[0].published_at = '2026-10-18T00:00:00'],
  ['observation after attempt', r => r.observations[0].observed_at = '2026-10-21T00:00:00Z'],
  ['inflated counts', r => r.attempts[0].reviews_inspected = 99],
  ['blocked contradiction', r => r.attempts[0].status = 'blocked'],
  ['no matches contradiction', r => r.attempts[0].status = 'no_product_matches'],
  ['unknown evidence', r => r.insights[0].evidence_ids = ['unknown']],
  ['missing counterevidence disclosure', r => delete r.insights[0].counterevidence_note],
  ['store insight with product IDs', r => r.insights[0].scope = 'store'],
  ['oversize', r => r.attempts = Array(31).fill(r.attempts[0])],
];
for (const [name, mutate] of mutations) test(`rejects ${name}`, () => { const r = fixture(); mutate(r); const out = check(r); assert.equal(out.status, 'NEEDS_EVIDENCE'); assert.deepEqual(out.usable_customer_insight_ids, []); });
test('malformed nested arrays and objects fail without crashes', () => {
  for (const r of [null, 1, '', [], {}, { ...fixture(), observations: [null] }, { ...fixture(), attempts: [null] }, { ...fixture(), scope: { product_ids: null } }]) assert.doesNotThrow(() => check(r));
});
test('collection must attempt every selected product, no line-wide extrapolation', () => {
  const r = fixture(), all = [...products, { id: 'mug-red', url: source_url + '?red', variant: 'red / 11oz' }];
  r.scope.product_ids.push('mug-red');
  assert.ok(evaluateTrustpilotResearch(r, { ...context, products: all }).issues.includes('TRUSTPILOT_SELECTED_PRODUCTS_NOT_SEARCHED'));
  r.attempts[0].product_ids.push('mug-red');
  assert.equal(evaluateTrustpilotResearch(r, { ...context, products: all }).status, 'STRUCTURALLY_COMPLETE');
  r.insights[0].product_ids.push('mug-red');
  assert.equal(evaluateTrustpilotResearch(r, { ...context, products: all }).status, 'NEEDS_EVIDENCE');
});
test('execution insertion is ordered, idempotent and fills missing legacy execution', () => {
  const steps = ['ACQUIRE_SOURCE', 'ANALYZE_BUYER_CONCERNS_AND_SCOPED_CLAIMS', 'BUILD_CONTENT_MAP'];
  const actual = withTrustpilotStep(steps);
  assert.deepEqual(actual, ['ACQUIRE_SOURCE', TRUSTPILOT_STEP, ...steps.slice(1)]);
  assert.deepEqual(withTrustpilotStep(actual), actual);
  assert.deepEqual(withTrustpilotStep(undefined), [TRUSTPILOT_STEP]);
});
test('missing attempt gates insight/content and preserves existing approval/pixel/policy gates', () => {
  const base = { resolved: { brand: 'pawfecthouse' }, hard_gates: { content_approval: 'HARD' }, readiness: { asset_generation: 'PIXELS_AND_APPROVAL', human_artistic_review: 'REQUIRED' }, execution: ['BUILD_CONTENT_MAP'] };
  const r = attachResearch(base, { source_url, require_pdp_coverage: true });
  assert.equal(r.readiness.customer_value_selection, 'REQUIRES_TRUSTPILOT_RESEARCH_ATTEMPT');
  assert.equal(r.readiness.content_authoring, 'REQUIRES_TRUSTPILOT_RESEARCH_ATTEMPT');
  assert.equal(r.readiness.asset_generation, 'PIXELS_AND_APPROVAL');
  assert.equal(r.hard_gates.content_approval, 'HARD');
  const blocked = attachResearch({ ...base, creative_quality_contract: { status: 'BLOCKED' } }, { source_url, require_pdp_coverage: true });
  assert.equal(blocked.readiness.content_authoring, 'BLOCKED');
  assert.equal(blocked.readiness.trustpilot_customer_research, 'BLOCKED');
});
test('compiler and resolver apply current brand gate over old upstream, canonical data unchanged', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ branch: { slug: 'onepage-system', content_md: 'Unchanged canonical rules' }, execution: ['BUILD_CONTENT_MAP'] });
    for (const brand of ['PawfectHouse', 'GiftSoul']) for (const r of [await compileOnepageJob(brand, source_url), await resolveCreativeDna(brand, 'Onepage', { source_url, require_pdp_coverage: false } as any)]) {
      assert.equal(r.data.trustpilot_contract.required, true);
      assert.equal(r.data.trustpilot_validation.profile_url, brand === 'PawfectHouse' ? TRUSTPILOT_PROFILES.pawfecthouse : TRUSTPILOT_PROFILES.giftsoul);
      assert.equal(r.data.readiness.content_authoring, 'BLOCKED'); // Missing upstream quality contract remains a stronger gate.
      assert.equal(r.data.trustpilot_validation.status, 'AWAITING_RESEARCH');
      assert.ok(r.data.execution.includes(TRUSTPILOT_STEP));
      assert.equal(r.data.branch.content_md, 'Unchanged canonical rules');
    }
    const other = await compileOnepageJob('SoulPrise', source_url); assert.equal(other.data.trustpilot_validation.status, 'NOT_REQUIRED');
    globalThis.fetch = async () => Response.json({ branch: { slug: 'home-hero' } });
    assert.equal('trustpilot_contract' in (await resolveCreativeDna('PawfectHouse', 'Home Hero', { source_url })).data, false);
  } finally { globalThis.fetch = original; }
});
test('HTTP and MCP compile pass the research sidecar and return its gate; tools expose instructions', async () => {
  const app = createApp().listen(0, '127.0.0.1'); await new Promise<void>(r => app.once('listening', r));
  const origin = `http://127.0.0.1:${(app.address() as any).port}`, original = globalThis.fetch;
  try {
    globalThis.fetch = async (url: any, init: any) => String(url).startsWith(origin) ? original(url, init) : Response.json({ resolved: { brand: 'pawfecthouse', branch: 'onepage-system' } });
    const research = { scope: { products }, trustpilot_research: blockedTrustpilotFixture(source_url, ['mug-blue']) };
    const post = (path: string, body: any) => original(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'X-Forwarded-For': '203.0.113.125' }, body: JSON.stringify(body) });
    const http = await (await post('/api/tools/compile_onepage_job', { brand: 'PawfectHouse', source_url, research })).json();
    assert.equal(http.trustpilot_validation.status, 'ATTEMPTED_WITH_LIMITATIONS');
    assert.equal(http.readiness.content_authoring, 'BLOCKED'); // Missing upstream quality contract remains blocked.
    assert.equal(http.research_validation.status, 'NEEDS_EVIDENCE');
    const mcp = await post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compile_onepage_job', arguments: { brand: 'PawfectHouse', source_url } } });
    assert.match(await mcp.text(), /AWAITING_RESEARCH/);
    const listed = await post('/api/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.match(await listed.text(), /ONEPAGE TRUSTPILOT GATE/);
  } finally { globalThis.fetch = original; await new Promise<void>((r, j) => app.close(e => e ? j(e) : r())); }
});

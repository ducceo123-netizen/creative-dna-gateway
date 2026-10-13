import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { attachResearch } from '../supabase/functions/_shared/product-research.ts';
import { compileCreativeQuality as compilePreviousQuality } from './fixtures/creative-quality-v2.fixture.ts';
import assert from 'node:assert/strict';
import { buildOwnerRulePlan, parseCanonicalOwnerRule, OWNER_RULE_PLAN_SCHEMA } from '../supabase/functions/_shared/owner-rule-plan.ts';
import { compileCreativeQuality, sourceHashes, sha256, stableJson, QUALITY_CATALOG_SCHEMA, QUALITY_SCHEMA, type QualityRule } from '../supabase/functions/_shared/creative-quality.ts';
import { attachOnepageUiTemplate } from '../onepage-ui-template.ts';
import { buildOnepagePacket } from '../supabase/functions/_shared/onepage-packet.ts';

const proposalId = '00000000-0000-4000-8000-000000000001';
const scope = 'STRUCTURAL content shared by PawfectHouse, GiftSoul and SoulPrise.';
const canonical = (generalized = 'Content titles must identify the current product or category.', expected = 'Write concise titles of two to four words using the correct product noun.', rejects = '- A generic title with no product noun.\n- The wrong product category.') => `## Generalized Rule\n${generalized}\n\n## Expected Behavior\n${expected}\n\n## Reject Conditions\n${rejects}\n\n## Scope\n${scope}\n\n## Rule Class\nSTRUCTURAL\n\n## Confidence\nHIGH`;
const categories: QualityRule['category'][] = ['content', 'typography', 'banner', 'proof', 'brand_style', 'delivery', 'workflow'];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const mirror = (metadata: any, brand: string) => ({ ...clone(metadata), active_brand: brand, onepage_master_brand: 'PawfectHouse', onepage_sync_mode: 'PAWFECTHOUSE_MASTER_100_PERCENT', cross_brand_onepage_structure: 'IDENTICAL_HARD', brand_difference_scope: 'BRAND_DNA_EXPRESSION_ONLY' });
async function fixture(body = canonical()) {
  const brands = ['PawfectHouse', 'GiftSoul', 'SoulPrise'].map((name, i) => ({ id: `brand-${i}`, name, slug: name.toLowerCase() }));
  const dnas = brands.map((brand, i) => ({ id: `dna-${i}`, brand_id: brand.id, slug: 'brand-dna', version: `0.${i + 1}`, content_md: `${brand.name} independent expression`, metadata: { preserve_dna: brand.slug }, input_schema: {}, confidence: 'HIGH', status: 'active' }));
  const metadata = { preserve: { nested: ['do', 'not', 'touch'] }, product_truth_required: true, unrelated_reference_policy: 'keep' };
  const targets = brands.map((brand, i) => ({ id: `node-${i}`, brand_id: brand.id, brand_slug: brand.slug, brand_name: brand.name, node_hash: `before-${i}`, slug: 'onepage-system', version: '0.1', content_md: 'Canonical existing branch. Protected verified product evidence is required.', metadata: i ? mirror(metadata, brand.name) : clone(metadata), input_schema: { unrelated: { input: true } }, status: 'active', confidence: 'HIGH' }));
  const contracts: Record<string, any> = {};
  for (const [i, brand] of brands.entries()) {
    const rules: QualityRule[] = categories.map(category => ({ id: `${brand.slug}.${category}`, key: category === 'brand_style' ? 'brand.active_expression' : `baseline.${category}`, value: { preserve: category }, instruction: `${brand.name} retained ${category} instruction`, category, scope: { brands: [brand.slug], branches: ['onepage-system'] }, sources: [{ node: category === 'brand_style' ? 'brand_dna' : 'branch', locator: 'approved baseline' }], ...(category === 'proof' ? { reference_ids: ['optional-example'] } : {}) }));
    contracts[brand.slug] = { schema_version: QUALITY_SCHEMA, revision: 'prior-revision', source_hashes: await sourceHashes({ brand: { slug: brand.slug }, branch: targets[i], brand_dna: dnas[i] }), rules, references: [{ id: 'optional-example', role: 'example', scope: { brands: [brand.slug], branches: ['onepage-system'] }, required_for: [], usage: 'supplementary_inspiration', source: { node: 'branch', locator: 'retained optional evidence' } }], preserve_bundle_extension: { keep: true } };
  }
  const catalog = { schema_version: QUALITY_CATALOG_SCHEMA, contracts, preserve_catalog_extension: { extra: 'unchanged' } };
  targets.forEach(t => { (t.metadata as any).creative_quality_contract = clone(catalog); });
  const block = '\n\n## ACCEPTED ADMIN FEEDBACK — 2026-10-13\n' + body.trim() + '\n';
  return {
    proposal: { id: proposalId, status: 'pending', merged_at: null, knowledge_node_id: 'node-1', proposed_content_md: body, proposed_scope: scope },
    candidate_hash: 'scope-v2:current', direct_rule: { rule_hash: 'owner-rule-v1:current', eligible: true },
    scope: { branch_slug: 'onepage-system', cross_brand: true, structural: true, proposed_scope: scope, source_node_id: 'node-1', target_node_ids: targets.map(t => t.id) },
    targets,
    compiler_context: { policy_version: OWNER_RULE_PLAN_SCHEMA, owner_user_id: '00000000-0000-4000-8000-000000000099', master_node_id: 'node-0', master_count: 1, brands, brand_dna_nodes: dnas, merge_block_text: block, projected_targets: targets.map(t => ({ ...clone(t), content_md: t.content_md + block })) },
  };
}
const mustBlock = async (s: any, code: string) => {
  const r = await buildOwnerRulePlan(s);
  assert.equal(r.eligible, false); assert.equal(r.plan, null); assert.equal(r.plan_hash, null);
  assert.ok(r.blockers.some(b => b.code === code), JSON.stringify(r.blockers));
};

test('adds effective scoped verbatim supplements to every brand and retains catalog, brand styles, references and unrelated metadata', async () => {
  const s = await fixture(); const before = clone(s);
  const r = await buildOwnerRulePlan(s);
  assert.equal(r.eligible, true, JSON.stringify(r.blockers)); assert.ok(r.plan);
  assert.deepEqual(s, before, 'the pure compiler must never mutate its SQL snapshot');
  assert.equal(r.additions.length, 3); assert.equal(r.compiled.length, 3);
  assert.equal(r.plan_hash, await sha256(stableJson(r.plan)));
  for (const [i, target] of r.plan.targets.entries()) {
    const old = before.targets[i];
    assert.equal(target.version, old.version, 'legacy merger has no version bump');
    assert.equal(target.content_md, old.content_md + s.compiler_context.merge_block_text);
    const { creative_quality_contract: beforeCatalog, ...beforeMetadata } = old.metadata as any;
    const { creative_quality_contract: afterCatalog, ...afterMetadata } = target.metadata;
    assert.deepEqual(afterMetadata, beforeMetadata);
    assert.deepEqual(afterCatalog.preserve_catalog_extension, beforeCatalog.preserve_catalog_extension);
    for (const brand of s.compiler_context.brands) {
      const a = afterCatalog.contracts[brand.slug], b = beforeCatalog.contracts[brand.slug];
      assert.deepEqual(a.rules, b.rules);
      assert.deepEqual(a.references, b.references);
      assert.deepEqual(a.preserve_bundle_extension, b.preserve_bundle_extension);
      assert.equal(a.revision, `owner-rule:${proposalId}`);
      assert.equal(a.rules.length, b.rules.length);
      assert.equal(a.owner_supplemental_rules.length, 1);
    }
    const brand = s.compiler_context.brands[i];
    const dna = { brand, branch: { ...old, ...target }, brand_dna: s.compiler_context.brand_dna_nodes[i], visual_references: [] };
    const compiled = await compileCreativeQuality(dna);
    assert.equal(compiled.status, 'COMPILED');
    assert.deepEqual(afterCatalog.contracts[brand.slug].source_hashes, await sourceHashes(dna));
    assert.deepEqual(compiled.source_hashes, r.compiled[i].source_hashes);
    assert.equal(compiled.rules.find(q => q.key === 'brand.active_expression')?.scope.brands[0], brand.slug);
    const packet = await buildOnepagePacket(dna);
    const addition = r.additions.find(a => a.target_node_ids.includes(target.node_id))!;
    assert.ok(compiled.owner_supplemental_rules.some(q => q.id === addition.id && q.canonical_text === s.proposal.proposed_content_md));
    assert.ok(packet.owner_supplemental_contract.rules.some(q => q.id === addition.id && q.canonical_text === addition.canonical_text), 'new verbatim guidance must enter the effective Onepage packet');
    assert.deepEqual(packet.content_contract, beforeCatalog.contracts[brand.slug].rules.filter((q: any) => q.category === 'content').map((q: any) => q.id));
    assert.deepEqual(addition.scope, { brands: ['giftsoul', 'pawfecthouse', 'soulprise'], branches: ['onepage-system'] });
    assert.equal(addition.precedence, 'SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH');
    assert.equal(Object.hasOwn(addition, 'owner_user_id'), false);
    assert.ok(!JSON.stringify(compiled).includes(s.compiler_context.owner_user_id));
    assert.ok(!JSON.stringify(packet).includes(s.compiler_context.owner_user_id));
    assert.deepEqual(addition.accepted_source_hashes, compiled.source_hashes);
    assert.equal(compiled.gates.human_artistic_review, 'REQUIRED');
    assert.equal(compiled.gates.asset_generation, 'REQUIRES_PRODUCT_PIXEL_INSPECTION');
  }
});

test('never interprets owner acceptance or self-attested review flags as image QC', async () => {
  const s: any = await fixture();
  s.proposal.visual_qc_performed = true; s.proposal.visual_reviewed = true;
  s.direct_rule.visual_qc_performed = true; s.direct_rule.semantic_consistency = 'VERIFIED';
  const r = await buildOwnerRulePlan(s);
  assert.equal(r.eligible, true); assert.equal(r.visual_qc_performed, false);
  assert.equal(r.semantic_consistency, 'NOT_PROVEN_BY_DETERMINISTIC_CHECKS');
  assert.ok(!Object.hasOwn(r.plan!, 'visual_reviewed'));
});

test('deterministic hashes ignore object insertion order and target enumeration order', async () => {
  const s = await fixture(); const shuffled: any = JSON.parse(stableJson(s));
  shuffled.targets.reverse(); shuffled.scope.target_node_ids.reverse(); shuffled.compiler_context.projected_targets.reverse();
  shuffled.compiler_context.brands.reverse(); shuffled.compiler_context.brand_dna_nodes.reverse();
  const a = await buildOwnerRulePlan(s), b = await buildOwnerRulePlan(shuffled);
  assert.equal(a.eligible, true); assert.deepEqual(a, b);
});

test('local Onepage scope blocks rather than leaking through master triggers', async () => {
  const s: any = await fixture(); s.scope.cross_brand = false; s.scope.structural = false;
  await mustBlock(s, 'onepage_mirror_scope');
});

test('missing, stale and missing-category preexisting quality block before any hash refresh', async () => {
  for (const kind of ['missing', 'stale', 'missing-category']) {
    const s: any = await fixture();
    for (const t of s.targets) {
      if (kind === 'missing') delete t.metadata.creative_quality_contract;
      if (kind === 'stale') t.metadata.creative_quality_contract.contracts.giftsoul.source_hashes.brand_dna = 'stale';
      if (kind === 'missing-category') t.metadata.creative_quality_contract.contracts.giftsoul.rules = t.metadata.creative_quality_contract.contracts.giftsoul.rules.filter((r: any) => r.category !== 'typography');
    }
    s.compiler_context.projected_targets = s.targets.map((t: any) => ({ ...clone(t), content_md: t.content_md + s.compiler_context.merge_block_text }));
    await mustBlock(s, 'preexisting_quality_blocked');
  }
});

test('strict headings, bounded sections and unsupported classes fail closed while taxonomy stays unchanged', async () => {
  const malformed = await fixture(canonical().replace('## Confidence', '## Scope'));
  await mustBlock(malformed, 'invalid_canonical_headings');
  await mustBlock(await fixture(canonical('Content ' + 'x'.repeat(4001))), 'rule_text_too_long');
  const verbatim = await buildOwnerRulePlan(await fixture(canonical('Typography and font layout must change.')));
  assert.equal(verbatim.eligible, true, 'no invented category mapping for supplemental canonical prose');
  assert.ok(verbatim.additions.every(a => !Object.hasOwn(a, 'category') && !Object.hasOwn(a, 'key')));
  await mustBlock(await fixture(canonical().replace('STRUCTURAL\n\n## Confidence', 'PRODUCT_TRUTH\n\n## Confidence')), 'unsupported_rule_class');
  const s: any = await fixture();
  for (const t of s.targets) for (const b of Object.values(t.metadata.creative_quality_contract.contracts) as any[]) {
    while (b.rules.length < 80) b.rules.push({ ...clone(b.rules[0]), id: `extra-${b.rules.length}`, key: `extra-${b.rules.length}` });
  }
  s.compiler_context.projected_targets = s.targets.map((t: any) => ({ ...clone(t), content_md: t.content_md + s.compiler_context.merge_block_text }));
  assert.equal((await buildOwnerRulePlan(s)).eligible, true, 'an 80-rule baseline stays intact when appending a distinct supplemental layer');
});

test('fails closed for incorrect merge text/version, missing source, mirror divergence or target membership', async () => {
  for (const field of ['content_md', 'version']) {
    const s: any = await fixture(); s.compiler_context.projected_targets[1][field] = 'wrong';
    await mustBlock(s, 'merge_projection_mismatch');
  }
  const missing: any = await fixture(); missing.compiler_context.brand_dna_nodes.pop(); await mustBlock(missing, 'brand_dna_ambiguous');
  const changed: any = await fixture(); changed.targets[1].metadata.unrelated_new_value = true; await mustBlock(changed, 'mirror_preservation_blocked');
  const prose: any = await fixture(); prose.targets[1].content_md += ' unrelated local guidance'; await mustBlock(prose, 'mirror_preservation_blocked');
  const inactive: any = await fixture(); inactive.targets[2].status = 'inactive'; await mustBlock(inactive, 'mirror_preservation_blocked');
  const scopeChanged: any = await fixture(); scopeChanged.scope.target_node_ids.pop(); await mustBlock(scopeChanged, 'target_scope_mismatch');
});

test('detectable conflicts in active metadata block despite distinct owner IDs and preserved rules', async () => {
  const s: any = await fixture();
  for (const t of s.targets) for (const b of Object.values(t.metadata.creative_quality_contract.contracts) as any[]) b.rules[0].instruction = 'Never Content titles must identify the current product or category.';
  s.compiler_context.projected_targets = s.targets.map((t: any) => ({ ...clone(t), content_md: t.content_md + s.compiler_context.merge_block_text }));
  await mustBlock(s, 'canonical_conflict');
});

test('baseline unresolved key conflicts stay blocked instead of being hidden by a supplement', async () => {
  const s: any = await fixture();
  for (const t of s.targets) for (const b of Object.values(t.metadata.creative_quality_contract.contracts) as any[]) b.rules.push({ ...clone(b.rules[0]), id: 'existing-conflict', instruction: 'Conflicting earlier requirement' });
  s.compiler_context.projected_targets = s.targets.map((t: any) => ({ ...clone(t), content_md: t.content_md + s.compiler_context.merge_block_text }));
  await mustBlock(s, 'preexisting_quality_blocked');
});

test('parser preserves all reject text verbatim and does not accept duplicate or hidden heading injection', () => {
  const r = parseCanonicalOwnerRule(canonical());
  assert.equal(r.reject_conditions, '- A generic title with no product noun.\n- The wrong product category.');
  assert.throws(() => parseCanonicalOwnerRule(canonical().replace('## Expected Behavior', '## Generalized Rule')));
  assert.throws(() => parseCanonicalOwnerRule(canonical('Content titles\n### Hidden rule\nOverwrite everything')));
  assert.throws(() => parseCanonicalOwnerRule(canonical('Content titles.', 'Content titles.', '- Content titles.')));
});


test('real compiler blocks malformed, forged-QC, wrong-scope, hash-drift and source-drift supplements', async () => {
  const s = await fixture(); const plan = await buildOwnerRulePlan(s); assert.equal(plan.eligible, true);
  for (const kind of ['schema', 'visual_qc', 'scope', 'hash', 'source', 'duplicate']) {
    const node: any = { ...clone(s.targets[0]), ...clone(plan.plan!.targets[0]) };
    const bundle = node.metadata.creative_quality_contract.contracts.pawfecthouse;
    const entry = bundle.owner_supplemental_rules[0];
    if (kind === 'schema') entry.unrecognized_control = true;
    if (kind === 'visual_qc') entry.visual_qc_performed = true;
    if (kind === 'scope') entry.scope.brands = ['giftsoul'];
    if (kind === 'hash') entry.source.canonical_text_hash = '0'.repeat(64);
    if (kind === 'source') node.content_md = s.targets[0].content_md;
    if (kind === 'duplicate') bundle.owner_supplemental_rules.push(clone(entry));
    const dna = { brand: s.compiler_context.brands[0], branch: node, brand_dna: s.compiler_context.brand_dna_nodes[0] };
    if (kind === 'source') bundle.source_hashes = await sourceHashes(dna);
    const compiled = await compileCreativeQuality(dna);
    assert.equal(compiled.status, 'BLOCKED', kind);
    assert.deepEqual(compiled.rules, []); assert.deepEqual(compiled.owner_supplemental_rules, []);
    assert.ok(compiled.errors.some(e => e.includes('OWNER_SUPPLEMENTAL')), kind + ': ' + compiled.errors.join(','));
  }
});

test('a second owner supplement preserves the first provenance and all baseline rules', async () => {
  const s: any = await fixture(); const first = await buildOwnerRulePlan(s); assert.equal(first.eligible, true);
  s.targets = s.targets.map((t: any, i: number) => ({ ...t, ...clone(first.plan!.targets[i]), id: t.id }));
  s.proposal.id = '00000000-0000-4000-8000-000000000002';
  s.proposal.proposed_content_md = canonical('Content must answer a verified buyer question clearly.');
  s.compiler_context.merge_block_text = '\n\n## ACCEPTED ADMIN FEEDBACK — 2026-10-14\n' + s.proposal.proposed_content_md + '\n';
  s.compiler_context.projected_targets = s.targets.map((t: any) => ({ ...clone(t), content_md: t.content_md + s.compiler_context.merge_block_text }));
  const second = await buildOwnerRulePlan(s); assert.equal(second.eligible, true, JSON.stringify(second.blockers));
  for (const target of second.plan!.targets) {
    const before = first.plan!.targets.find(t => t.node_id === target.node_id)!;
    for (const brand of s.compiler_context.brands) {
      const a = target.metadata.creative_quality_contract.contracts[brand.slug];
      const b = before.metadata.creative_quality_contract.contracts[brand.slug];
      assert.deepEqual(a.rules, b.rules); assert.deepEqual(a.references, b.references);
      assert.deepEqual(a.owner_supplemental_rules[0], b.owner_supplemental_rules[0]);
      assert.equal(a.owner_supplemental_rules.length, 2);
    }
  }
  assert.notEqual(first.plan_hash, second.plan_hash);
  assert.notEqual(first.compiled[0].contract_hash, second.compiled[0].contract_hash);
});

test('supplement limit and invalid schema fail closed instead of silently removing prior guidance', async () => {
  const s: any = await fixture(); const first = await buildOwnerRulePlan(s); assert.equal(first.eligible, true);
  s.targets = s.targets.map((t: any, i: number) => ({ ...t, ...clone(first.plan!.targets[i]), id: t.id }));
  for (const t of s.targets) for (const b of Object.values(t.metadata.creative_quality_contract.contracts) as any[]) {
    const entry = b.owner_supplemental_rules[0];
    b.owner_supplemental_rules = Array.from({ length: 16 }, (_, i) => {
      const proposal = `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`;
      return { ...clone(entry), id: `owner:${proposal}`, proposal_id: proposal, source: { ...clone(entry.source), locator: `owner-rule:${proposal}` } };
    });
  }
  s.proposal.id = '00000000-0000-4000-8000-000000000002';
  s.proposal.proposed_content_md = canonical('Content must answer another verified buyer question.');
  s.compiler_context.merge_block_text = '\n\n## ACCEPTED ADMIN FEEDBACK — 2026-10-14\n' + s.proposal.proposed_content_md + '\n';
  s.compiler_context.projected_targets = s.targets.map((t: any) => ({ ...clone(t), content_md: t.content_md + s.compiler_context.merge_block_text }));
  await mustBlock(s, 'supplement_capacity_exceeded');
  const bad: any = await fixture(); bad.compiler_context.policy_version = 'unknown'; await mustBlock(bad, 'compiler_snapshot_invalid');
});


test('gateway accepts verified new supplement capability and rejects old-version, altered or self-attested guidance', async () => {
  const s = await fixture(); const plan = await buildOwnerRulePlan(s); assert.equal(plan.eligible, true);
  const node: any = { ...s.targets[0], ...plan.plan!.targets[0] };
  const packet = await buildOnepagePacket({ brand: s.compiler_context.brands[0], branch: node, brand_dna: s.compiler_context.brand_dna_nodes[0] });
  assert.equal(attachOnepageUiTemplate(packet, 'PawfectHouse', 'Onepage').quality_execution_guard.status, 'COMPILED');
  for (const mutation of ['old-version', 'text', 'policy', 'packet-copy', 'identity']) {
    const bad: any = clone(packet);
    if (mutation === 'old-version') bad.creative_quality_contract.compiler_version = '2026-10-11-v2';
    if (mutation === 'text') bad.creative_quality_contract.owner_supplemental_rules[0].canonical_text += ' not reviewed';
    if (mutation === 'policy') bad.creative_quality_contract.owner_supplemental_policy.visual_qc_performed = true;
    if (mutation === 'packet-copy') bad.owner_supplemental_contract.rules = [];
    if (mutation === 'identity') bad.creative_quality_contract.owner_supplemental_rules[0].owner_user_id = s.compiler_context.owner_user_id;
    assert.equal(attachOnepageUiTemplate(bad, 'PawfectHouse', 'Onepage').quality_execution_guard.status, 'BLOCKED', mutation);
  }
});


test('unaffected catalog entries remain byte-equivalent and catalog size limit is enforced', async () => {
  const s: any = await fixture();
  const retained = { schema_version: 'future-unrelated-schema', opaque: { retained: true } };
  for (const t of s.targets) t.metadata.creative_quality_contract.contracts.unaffected = clone(retained);
  s.compiler_context.projected_targets = s.targets.map((t: any) => ({ ...clone(t), content_md: t.content_md + s.compiler_context.merge_block_text }));
  const result = await buildOwnerRulePlan(s); assert.equal(result.eligible, true);
  for (const t of result.plan!.targets) assert.deepEqual(t.metadata.creative_quality_contract.contracts.unaffected, retained);
  for (const t of s.targets) for (let i = 0; i < 17; i++) t.metadata.creative_quality_contract.contracts[`extra-${i}`] = clone(retained);
  s.compiler_context.projected_targets = s.targets.map((t: any) => ({ ...clone(t), content_md: t.content_md + s.compiler_context.merge_block_text }));
  await mustBlock(s, 'preexisting_quality_blocked');
});


test('previous deployed compiler rejects supplemented stored schema instead of silently omitting guidance', async () => {
  const s = await fixture(); const plan = await buildOwnerRulePlan(s); assert.equal(plan.eligible, true);
  for (const [i, target] of plan.plan!.targets.entries()) {
    const dna = { brand: s.compiler_context.brands[i], branch: { ...s.targets[i], ...target }, brand_dna: s.compiler_context.brand_dna_nodes[i] };
    assert.equal((await compileCreativeQuality(dna)).status, 'COMPILED');
    const legacy = await compilePreviousQuality(dna);
    assert.equal(legacy.compiler_version, '2026-10-11-v2');
    assert.equal(legacy.status, 'BLOCKED');
    assert.ok(legacy.errors.includes('QUALITY_CONTRACT_INVALID'));
    assert.deepEqual(legacy.rules, []);
    const downgraded: any = clone(dna);
    downgraded.branch.metadata.creative_quality_contract.contracts[s.compiler_context.brands[i].slug].schema_version = QUALITY_SCHEMA;
    const current = await compileCreativeQuality(downgraded);
    assert.equal(current.status, 'BLOCKED');
    assert.ok(current.errors.includes('OWNER_SUPPLEMENTAL_SCHEMA_INVALID'));
  }
});


test('actual public resolver, Onepage Edge handler and gateway expose exact supplements with no private owner identity', async () => {
  const s = await fixture(); const plan = await buildOwnerRulePlan(s); assert.equal(plan.eligible, true);
  async function invoke(slug: string, dna: any, payload: any) {
    const source = readFileSync(`supabase/functions/${slug}/index.ts`, 'utf8').replace(/^import .*;\n/gm, '');
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
    let handler: (request: Request) => Promise<Response>;
    const Deno = { env: { get: (key: string) => key === 'SUPABASE_URL' ? 'https://example.test' : key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'synthetic-test-only' : undefined }, serve: (fn: any) => { handler = fn; } };
    const createClient = () => ({ rpc: async () => ({ data: clone(dna), error: null }) });
    new Function('Deno', 'createClient', 'compileCreativeQuality', 'buildOnepagePacket', 'attachResearch', code)(Deno, createClient, compileCreativeQuality, buildOnepagePacket, attachResearch);
    const response = await handler!(new Request('https://example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }));
    assert.equal(response.status, 200); return response.json();
  }
  for (const [i, target] of plan.plan!.targets.entries()) {
    const brand = s.compiler_context.brands[i];
    const dna = { brand, branch: { ...s.targets[i], ...target }, brand_dna: s.compiler_context.brand_dna_nodes[i], visual_references: [] };
    const resolved: any = await invoke('creative-dna-public', dna, { brand: brand.slug, branch: 'Onepage' });
    const packet: any = await invoke('creative-dna-compile-onepage', dna, { brand: brand.slug });
    assert.equal(resolved.creative_quality_contract.contract_hash, packet.creative_quality_contract.contract_hash);
    assert.equal(resolved.creative_quality_contract.owner_supplemental_rules[0].canonical_text, s.proposal.proposed_content_md);
    assert.equal(packet.owner_supplemental_contract.rules[0].declared_scope, scope);
    assert.equal(packet.hard_gates.product_physical_truth, 'HARD_MULTI_SOURCE');
    assert.match(resolved.instruction, /supplemental_rules canonical text verbatim/);
    for (const body of [resolved, packet]) {
      assert.ok(!JSON.stringify(body).includes(s.compiler_context.owner_user_id));
      assert.ok(!JSON.stringify(body).includes('owner_user_id'));
      assert.equal(attachOnepageUiTemplate(body, brand.name, 'Onepage').quality_execution_guard.status, 'COMPILED');
    }
  }
});

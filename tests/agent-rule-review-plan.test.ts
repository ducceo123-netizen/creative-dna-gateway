import {buildOnepagePacket} from '../supabase/functions/_shared/onepage-packet.ts';
import {attachOnepageUiTemplate} from '../onepage-ui-template.ts';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAgentRuleReviewPlan,ruleReviewSourceRecords} from '../supabase/functions/_shared/agent-rule-review-plan.ts';
import {compileRuleQuality} from '../supabase/functions/_shared/agent-rule-quality.ts';
import {PILOT_SCOPE,PILOT_RULES,PILOT_BRANDS,RULE_COMPILER,RULE_REVIEW_MODE,RULE_REVIEW_SCOPE,RULE_REVIEW_EVALUATOR} from '../supabase/functions/_shared/agent-rule-policy.ts';
import {OWNER_RULE_PLAN_SCHEMA} from '../supabase/functions/_shared/owner-rule-plan.ts';
import {compileCreativeQuality,sourceHashes,sha256,stableJson,QUALITY_CATALOG_SCHEMA,QUALITY_SCHEMA,type QualityRule} from '../supabase/functions/_shared/creative-quality.ts';
const proposalId = '00000000-0000-4000-8000-000000000001';
const scope = PILOT_SCOPE;
const canonical = (generalized = 'Content titles must identify the current product or category.', expected = 'Write concise titles of two to four words using the correct product noun.', rejects = '- A generic title with no product noun.\n- The wrong product category.') => `## Generalized Rule\n${generalized}\n\n## Expected Behavior\n${expected}\n\n## Reject Conditions\n${rejects}\n\n## Scope\n${scope}\n\n## Rule Class\nSTRUCTURAL\n\n## Confidence\nHIGH`;
const categories: QualityRule['category'][] = ['content', 'typography', 'banner', 'proof', 'brand_style', 'delivery', 'workflow'];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const mirror = (metadata: any, brand: string) => ({ ...clone(metadata), active_brand: brand, onepage_master_brand: 'PawfectHouse', onepage_sync_mode: 'PAWFECTHOUSE_MASTER_100_PERCENT', cross_brand_onepage_structure: 'IDENTICAL_HARD', brand_difference_scope: 'BRAND_DNA_EXPRESSION_ONLY' });
async function ruleFixture(body = PILOT_RULES['onepage.distinct-product-design.v1']) {
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
    compiler_context: { policy_version: OWNER_RULE_PLAN_SCHEMA, owner_user_id: '00000000-0000-4000-8000-000000000099', master_node_id: 'node-0', master_count: 1, dependent_nodes: [], brands, brand_dna_nodes: dnas, merge_block_text: block, projected_targets: targets.map(t => ({ ...clone(t), content_md: t.content_md + block })) },
  };
}
async function fixture(context = undefined as any, operation = 'onepage.distinct-product-design.v1') {
 const c=context||await ruleFixture((PILOT_RULES as any)[operation]);
 const request='00000000-0000-4000-8000-000000000055',owner='00000000-0000-4000-8000-000000000099',now=Date.now();
 const claim:any={request_id:request,proposal_id:c.proposal.id,owner_user_id:owner,attempt_id:request+':1',lease_version:1,
  evaluator_version:RULE_REVIEW_EVALUATOR,candidate_hash:c.candidate_hash,snapshot_hash:'sha256:'+'a'.repeat(64),
  leased_at:new Date(now-10000).toISOString(),lease_expires_at:new Date(now+890000).toISOString(),expires_at:new Date(now+86400000).toISOString(),
  intent:{schema_version:'uid.review-intent.v3',review_mode:RULE_REVIEW_MODE,owner_user_id:owner,proposal_id:c.proposal.id,operation,
   source_node_id:c.proposal.knowledge_node_id,proposed_content_md:c.proposal.proposed_content_md,proposed_scope:c.proposal.proposed_scope,
   targets:c.targets.map((t:any)=>({id:t.id,brand_id:t.brand_id,slug:t.slug})).sort((a:any,b:any)=>a.id.localeCompare(b.id))},
  snapshot:{candidate_hash:c.candidate_hash,rule_context:c,compiler_capability:{review_mode:RULE_REVIEW_MODE,compiler_version:RULE_COMPILER,compiler_bundle_hash:'b'.repeat(64)},
   rule_policy:{enabled:true,operation,canonical_sha256:await sha256(c.proposal.proposed_content_md),brand_slugs:PILOT_BRANDS,target_node_ids:c.targets.map((t:any)=>t.id).sort()}}};
 const records=ruleReviewSourceRecords(c);
 const review:any={schema_version:'uid.agent-rule-review.v1',decision:'passed',review_note:'Synthetic test review only; this test does not assert any real source or media inspection.',visual_qc_performed:false,review_scope:RULE_REVIEW_SCOPE,
  source_receipts:await Promise.all(records.map(async r=>({node_id:r.id,record_sha256:await sha256(stableJson(r)),read_at:new Date(now-8000).toISOString(),revalidated_at:new Date(now-5000).toISOString(),note:'Synthetic test source receipt; no production record has been reviewed.'}))),
  findings:c.targets.flatMap((t:any)=>['rule_semantics','scope_fidelity','canonical_conflicts'].map(criterion=>({node_id:t.id,criterion,result:'passed',note:'Synthetic test semantic finding; no production rule review is asserted.',source_node_ids:records.map(r=>r.id)})))};
 return {claim,review,c};
}
test('both exact pilot operations compile with separate rule-only provenance and no fabricated media QC',async()=>{
 for(const operation of Object.keys(PILOT_RULES)) {
  const {claim,review,c}=await fixture(undefined,operation),before=clone({claim,review});
  const r=await buildAgentRuleReviewPlan(claim,review);assert.equal(r.status,'COMPILED',JSON.stringify(r.blockers));assert.deepEqual({claim,review},before);
  assert.equal(r.compiler_receipt!.proof_scope,'DETERMINISTIC_COMPILATION_ONLY');
  for(const [i,t] of r.compiler_plan!.targets.entries()) {
   const b=t.metadata.creative_quality_contract.contracts[c.compiler_context.brands[i].slug],s=b.agent_rule_reviewed_supplemental_rules[0];
   assert.equal(s.decision_kind,'agent_rule_review');assert.equal(s.visual_qc_performed,false);assert.equal(s.review_scope,RULE_REVIEW_SCOPE);
   assert.deepEqual(b.rules,c.targets[i].metadata.creative_quality_contract.contracts[c.compiler_context.brands[i].slug].rules);
   assert.deepEqual(b.references,c.targets[i].metadata.creative_quality_contract.contracts[c.compiler_context.brands[i].slug].references);
   const dna={brand:c.compiler_context.brands[i],branch:{...c.targets[i],...t},brand_dna:c.compiler_context.brand_dna_nodes[i]};
   assert.equal((await compileRuleQuality(dna)).status,'COMPILED');
   assert.equal((await compileCreativeQuality(dna)).status,'BLOCKED','old compiler must not silently omit rule-only provenance');
  }
 }
});
const attacks:Record<string,(x:any)=>void>={
 'v2 cannot be reinterpreted':x=>x.claim.intent.schema_version='uid.review-intent.v2',
 'outcome delegation cannot be downgraded':x=>x.claim.intent.review_mode='outcome_qc',
 'arbitrary product claim outside exact policy':x=>{x.c.proposal.proposed_content_md+='\nThis product cures disease.';x.claim.intent.proposed_content_md=x.c.proposal.proposed_content_md;},
 'policy disabled':x=>x.claim.snapshot.rule_policy.enabled=false,
 'operation spoof':x=>x.claim.snapshot.rule_policy.operation='anything',
 'owner mismatch':x=>x.claim.intent.owner_user_id='00000000-0000-4000-8000-000000000098',
 'target closure drift':x=>x.claim.intent.targets.pop(),
 'compiler wrong':x=>x.claim.snapshot.compiler_capability.compiler_version='old',
 'visual QC fake':x=>x.review.visual_qc_performed=true,
 'owner decision fake':x=>x.review.decision_kind='owner_direct_rule',
 'missing source':x=>x.review.source_receipts.pop(),
 'receipt hash fake':x=>x.review.source_receipts[0].record_sha256='0'.repeat(64),
 'receipt from previous lease':x=>x.review.source_receipts[0].read_at='2020-01-01T00:00:00Z',
 'receipt future':x=>x.review.source_receipts[0].revalidated_at='2099-01-01T00:00:00Z',
 'unknown semantic finding':x=>x.review.findings[0].result='unknown',
 'foreign finding source':x=>x.review.findings[0].source_node_ids=['foreign'],
 'lease expired':x=>x.claim.lease_expires_at='2020-01-01T00:00:00Z',
 'lease extension':x=>x.claim.lease_expires_at=x.claim.expires_at,
 'attempt version mismatch':x=>x.claim.lease_version=2,
 'brand expansion':x=>x.claim.snapshot.rule_policy.brand_slugs.push('other'),
};
for(const [name,mutate] of Object.entries(attacks))test(name,async()=>{const x=await fixture();x.claim.snapshot.rule_policy.brand_slugs=[...PILOT_BRANDS];mutate(x);const r=await buildAgentRuleReviewPlan(x.claim,x.review);assert.equal(r.status,'BLOCKED',name);assert.equal(r.compiler_plan,null);assert.equal(r.compiler_receipt,null);});
test('second distinct pilot addition preserves the first v4 rule-only history',async()=>{
 const first=await fixture(),r=await buildAgentRuleReviewPlan(first.claim,first.review);assert.equal(r.status,'COMPILED',JSON.stringify(r.blockers));
 const c=clone(first.c);c.proposal.id='00000000-0000-4000-8000-000000000002';c.proposal.proposed_content_md=PILOT_RULES['onepage.banner-product-keyword.v1'];
 c.targets=c.targets.map((t:any)=>({...t,...r.compiler_plan!.targets.find(n=>n.node_id===t.id)}));
 c.compiler_context.merge_block_text='\n\n## ACCEPTED ADMIN FEEDBACK — 2026-10-15\n'+c.proposal.proposed_content_md+'\n';
 c.compiler_context.projected_targets=c.targets.map((t:any)=>({...clone(t),content_md:t.content_md+c.compiler_context.merge_block_text}));
 const next=await fixture(c,'onepage.banner-product-keyword.v1');next.claim.request_id='00000000-0000-4000-8000-000000000056';next.claim.attempt_id=next.claim.request_id+':1';
 const result=await buildAgentRuleReviewPlan(next.claim,next.review);assert.equal(result.status,'COMPILED',JSON.stringify(result.blockers));
 assert.equal(result.compiler_plan!.targets[0].metadata.creative_quality_contract.contracts.pawfecthouse.agent_rule_reviewed_supplemental_rules.length,2);
});
test('Node24 CLI verifies separate source manifest and emits the real plan',async()=>{
 const manifestRun=spawnSync(process.execPath,['scripts/compile-agent-rule-review-plan.mjs','--print-manifest'],{encoding:'utf8'});assert.equal(manifestRun.status,0,manifestRun.stdout);
 const capability=JSON.parse(manifestRun.stdout);assert.equal(capability.source_manifest.length,9);
 const x=await fixture();Object.assign(x.claim.snapshot.compiler_capability,capability);
 const run=spawnSync(process.execPath,['scripts/compile-agent-rule-review-plan.mjs'],{input:JSON.stringify({claim:x.claim,review:x.review}),encoding:'utf8'});
 assert.equal(run.status,0,run.stdout);const result=JSON.parse(run.stdout);assert.equal(result.status,'COMPILED');assert.equal(result.compiler_receipt.compiler_bundle_hash,capability.compiler_bundle_hash);
});
test('tampered bundle rejected before any dynamic import',async()=>{
 const manifest=JSON.parse(spawnSync(process.execPath,['scripts/compile-agent-rule-review-plan.mjs','--print-manifest'],{encoding:'utf8'}).stdout);
 const dir=mkdtempSync(join(tmpdir(),'uid-rule-cli-'));
 try {
  for(const entry of manifest.source_manifest){const path=join(dir,entry.path);mkdirSync(dirname(path),{recursive:true});copyFileSync(entry.path,path);}
  writeFileSync(join(dir,'scripts/agent-rule-review-compiler.bundle.mjs'),'throw new Error("MUST_NOT_EXECUTE");');
  const x=await fixture();Object.assign(x.claim.snapshot.compiler_capability,manifest);
  const run=spawnSync(process.execPath,[join(dir,'scripts/compile-agent-rule-review-plan.mjs')],{input:JSON.stringify({claim:x.claim,review:x.review}),encoding:'utf8'});
  assert.equal(run.status,2);assert.equal(JSON.parse(run.stdout).blockers[0].code,'compiler_source_mismatch');assert.equal(run.stderr.includes('MUST_NOT_EXECUTE'),false);
 } finally{rmSync(dir,{recursive:true,force:true});}
});
test('release fixture texts and hashes match deterministic pilot vocabulary',async()=>{
 const fixture=JSON.parse(readFileSync('tests/fixtures/agent-rule-pilot-policy.json','utf8'));
 assert.equal(fixture.production_enabled,false);assert.equal(fixture.review_required,true);
 for(const row of fixture.operations){assert.equal(row.canonical_text,(PILOT_RULES as any)[row.operation]);assert.equal(row.canonical_sha256,await sha256(row.canonical_text));}
});
test('v4 packet and gateway retain exact delegated text; altered or downgraded envelopes fail closed',async()=>{
 const x=await fixture(),r=await buildAgentRuleReviewPlan(x.claim,x.review);assert.equal(r.status,'COMPILED',JSON.stringify(r.blockers));
 const dna={brand:x.c.compiler_context.brands[0],branch:{...x.c.targets[0],...r.compiler_plan!.targets[0]},brand_dna:x.c.compiler_context.brand_dna_nodes[0]};
 const packet=await buildOnepagePacket(dna);
 assert.equal(packet.compiler_version,RULE_COMPILER);assert.equal(packet.agent_rule_reviewed_supplemental_contract!.rules[0].canonical_text,x.c.proposal.proposed_content_md);
 assert.equal(attachOnepageUiTemplate(packet,'PawfectHouse','Onepage').quality_execution_guard.status,'COMPILED');
 for(const attack of [(p:any)=>p.creative_quality_contract.compiler_version='2026-10-13-agent-supplement-v1',(p:any)=>p.agent_rule_reviewed_supplemental_contract.rules[0].visual_qc_performed=true,(p:any)=>p.creative_quality_contract.agent_rule_reviewed_supplemental_rules[0].canonical_text+=' forged']) {
  const bad=clone(packet);attack(bad);assert.equal(attachOnepageUiTemplate(bad,'PawfectHouse','Onepage').quality_execution_guard.status,'BLOCKED');
 }
 const tampered=clone(dna);tampered.branch.metadata.creative_quality_contract.contracts.pawfecthouse.agent_rule_reviewed_supplemental_rules[0].visual_qc_performed=true;
 const bad=await compileRuleQuality(tampered);assert.equal(bad.status,'BLOCKED');assert.equal(bad.gates.asset_generation,'BLOCKED');assert.equal(bad.rules.length,0);
});

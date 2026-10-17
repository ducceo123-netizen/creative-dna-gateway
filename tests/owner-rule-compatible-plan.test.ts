import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildOwnerRulePlan, OWNER_RULE_PLAN_SCHEMA} from '../supabase/functions/_shared/owner-rule-plan.ts';
import {buildCompatibleOwnerRulePlan} from '../supabase/functions/_shared/owner-rule-compatible-plan.ts';
import {compileCompatibleQuality, RULE_QUALITY_SCHEMA, RULE_SUPPLEMENT_SCHEMA} from '../supabase/functions/_shared/agent-rule-quality.ts';
import {RULE_REVIEW_SCOPE,RULE_REVIEW_EVALUATOR} from '../supabase/functions/_shared/agent-rule-policy.ts';
import {sourceHashes,sha256,stableJson,QUALITY_CATALOG_SCHEMA,QUALITY_SCHEMA,type QualityRule} from '../supabase/functions/_shared/creative-quality.ts';
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
async function v4Fixture() {
  const s:any=await fixture();
  const owner=await buildOwnerRulePlan(s); assert(owner.plan);
  s.targets=s.targets.map((n:any)=>({...n,...owner.plan!.targets.find(t=>t.node_id===n.id)}));
  const catalog=s.targets[0].metadata.creative_quality_contract;
  for(const b of Object.values(catalog.contracts) as any[]) {
    const {semantic_consistency,...prior}=b.owner_supplemental_rules[0];
    const request='00000000-0000-4000-8000-000000000055', attempt=request+':1';
    b.agent_rule_reviewed_supplemental_rules=[{...prior,schema_version:RULE_SUPPLEMENT_SCHEMA,id:'agent-rule:'+attempt,request_id:request,attempt_id:attempt,decision_kind:'agent_rule_review',evaluator_version:RULE_REVIEW_EVALUATOR,snapshot_hash:'sha256:'+'a'.repeat(64),review_hash:'b'.repeat(64),review_scope:RULE_REVIEW_SCOPE,source:{...prior.source,locator:`agent-rule:${prior.proposal_id}:${attempt}`}}];
    delete b.owner_supplemental_rules;b.schema_version=RULE_QUALITY_SCHEMA;
  }
  for(const n of s.targets)n.metadata.creative_quality_contract=clone(catalog);
  s.proposal.id='00000000-0000-4000-8000-000000000002';
  s.proposal.proposed_content_md=canonical('Mobile banner type needs visible top breathing room.','Keep the highest glyph clear of the actual mobile crop edge.','- Type touches the top image boundary.');
  s.compiler_context.merge_block_text='\n\n## ACCEPTED ADMIN FEEDBACK — 2026-10-17\n'+s.proposal.proposed_content_md+'\n';
  s.compiler_context.projected_targets=s.targets.map((n:any)=>({...clone(n),content_md:n.content_md+s.compiler_context.merge_block_text}));
  return s;
}
test('older planner remains exact for /1 and /2 and adapter never mutates inputs',async()=>{
 const s:any=await fixture(), before=clone(s);
 assert.deepEqual(await buildCompatibleOwnerRulePlan(s),await buildOwnerRulePlan(s));assert.deepEqual(s,before);
 const first=await buildOwnerRulePlan(s);s.targets=s.targets.map((n:any)=>({...n,...first.plan!.targets.find(t=>t.node_id===n.id)}));
 s.proposal.id='00000000-0000-4000-8000-000000000003';s.proposal.proposed_content_md=canonical('Spacing must be clear.','Preserve breathing room around typography.','- Crowded typography.');
 s.compiler_context.merge_block_text='\n\n## ACCEPTED ADMIN FEEDBACK — 2026-10-17\n'+s.proposal.proposed_content_md+'\n';
 s.compiler_context.projected_targets=s.targets.map((n:any)=>({...clone(n),content_md:n.content_md+s.compiler_context.merge_block_text}));
 assert.deepEqual(await buildCompatibleOwnerRulePlan(s),await buildOwnerRulePlan(s));
});
test('owner after agent-rule keeps full /4 provenance and effective compiled rules',async()=>{
 const s=await v4Fixture(), before=clone(s), r=await buildCompatibleOwnerRulePlan(s);
 assert(r.eligible,JSON.stringify(r.blockers));assert(r.plan);assert.deepEqual(s,before);
 assert.equal(r.plan_hash,await sha256(stableJson(r.plan)));assert.equal(r.visual_qc_performed,false);
 for(const target of r.plan.targets){
  const n=s.targets.find((n:any)=>n.id===target.node_id), old=n.metadata.creative_quality_contract;
  for(const [brand,b] of Object.entries(target.metadata.creative_quality_contract.contracts) as [string,any][]){
   assert.equal(b.schema_version,RULE_QUALITY_SCHEMA);assert.deepEqual(b.agent_rule_reviewed_supplemental_rules,old.contracts[brand].agent_rule_reviewed_supplemental_rules);
   assert.deepEqual(b.rules,old.contracts[brand].rules);assert.deepEqual(b.references,old.contracts[brand].references);assert.equal(b.owner_supplemental_rules.length,1);
  }
  const brand=s.compiler_context.brands.find((b:any)=>b.id===n.brand_id),dna=s.compiler_context.brand_dna_nodes.find((d:any)=>d.brand_id===n.brand_id);
  const c=await compileCompatibleQuality({brand,branch:{...n,...target},brand_dna:dna});assert.equal(c.status,'COMPILED');assert.equal(c.agent_rule_reviewed_supplemental_rules?.length,1);assert.equal(c.owner_supplemental_rules.length,1);
  assert.equal(c.contract_hash,r.compiled.find(x=>x.node_id===n.id)?.contract_hash);
 }
});
test('v4 malformed provenance, source drift, mirror divergence and projection tampering fail closed',async()=>{
 const changes=[
  (s:any)=>{for(const n of s.targets)n.metadata.creative_quality_contract.contracts.pawfecthouse.agent_rule_reviewed_supplemental_rules[0].visual_qc_performed=true;},
  (s:any)=>{for(const n of s.targets)n.metadata.creative_quality_contract.contracts.pawfecthouse.agent_rule_reviewed_supplemental_rules[0].source.canonical_text_hash='0'.repeat(64);},
  (s:any)=>{s.targets[1].metadata.unrelated='changed';},
  (s:any)=>{s.compiler_context.projected_targets[0].content_md+='unexpected';},
  (s:any)=>{for(const n of s.targets)n.metadata.creative_quality_contract.contracts.pawfecthouse.agent_rule_reviewed_supplemental_rules={};},
 ];
 for(const change of changes){const s=await v4Fixture();change(s);const r=await buildCompatibleOwnerRulePlan(s);assert.equal(r.eligible,false,JSON.stringify(r));assert.equal(r.plan,null);}
});
test('v4 combined supplement capacity and collision cannot be hidden by projection',async()=>{
 const s=await v4Fixture();s.proposal.id='00000000-0000-4000-8000-000000000001';
 const r=await buildCompatibleOwnerRulePlan(s);assert.equal(r.eligible,false);assert.equal(r.blockers[0].code,'owner_rule_id_collision');
 const full=await v4Fixture();
 for(const n of full.targets)for(const b of Object.values(n.metadata.creative_quality_contract.contracts) as any[]) {
  const base=b.agent_rule_reviewed_supplemental_rules[0];
  b.agent_rule_reviewed_supplemental_rules=await Promise.all(Array.from({length:16},async(_,i)=>{
   const id=`00000000-0000-4000-8000-${String(100+i).padStart(12,'0')}`,request=`00000000-0000-4000-8000-${String(200+i).padStart(12,'0')}`,attempt=request+':1';
   return {...clone(base),proposal_id:id,request_id:request,attempt_id:attempt,id:'agent-rule:'+attempt,source:{...base.source,locator:`agent-rule:${id}:${attempt}`}};
  }));
 }
 full.compiler_context.projected_targets=full.targets.map((n:any)=>({...clone(n),content_md:n.content_md+full.compiler_context.merge_block_text}));
 const cap=await buildCompatibleOwnerRulePlan(full);assert.equal(cap.eligible,false);assert.equal(cap.blockers[0].code,'supplement_capacity_exceeded');
});
test('full v4 bundle size remains bounded when stripped base fits and when only owner addition overflows',async()=>{
 for(const afterOnly of [false,true]) {
  const s=await v4Fixture();
  const initial=await buildCompatibleOwnerRulePlan(s);assert(initial.plan);
  for(const n of s.targets)for(const [brand,b] of Object.entries(n.metadata.creative_quality_contract.contracts) as [string,any][]) {
   b.retained_extension='';
   const grown=initial.plan.targets[0].metadata.creative_quality_contract.contracts[brand];
   const delta=stableJson(grown).length-stableJson(b).length;
   const targetSize=afterOnly?100000-Math.max(1,Math.floor(delta/2)):100001;
   b.retained_extension='x'.repeat(targetSize-stableJson(b).length);
   const stripped=clone(b);delete stripped.agent_rule_reviewed_supplemental_rules;stripped.schema_version='uid-creative-quality/1';
   assert(stableJson(stripped).length<100000);
   assert.equal(stableJson(b).length,targetSize);
  }
  s.compiler_context.projected_targets=s.targets.map((n:any)=>({...clone(n),content_md:n.content_md+s.compiler_context.merge_block_text}));
  const r=await buildCompatibleOwnerRulePlan(s);assert.equal(r.eligible,false);assert.equal(r.blockers[0].code,'quality_bundle_capacity_exceeded');
 }
});

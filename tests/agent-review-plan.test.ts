import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSync, transformSync } from 'esbuild';
import { buildAgentReviewedRulePlan, agentReviewCore } from '../supabase/functions/_shared/agent-review-plan.ts';
import { buildOwnerRulePlan, OWNER_RULE_PLAN_SCHEMA } from '../supabase/functions/_shared/owner-rule-plan.ts';
import { compileCreativeQuality, sourceHashes, sha256, stableJson, QUALITY_COMPILER, QUALITY_CATALOG_SCHEMA, QUALITY_SCHEMA, AGENT_REVIEW_EVALUATOR, type QualityRule } from '../supabase/functions/_shared/creative-quality.ts';
import { compileCreativeQuality as directOnlyCompiler } from './fixtures/creative-quality-owner-v1.fixture.ts';
import { buildOnepagePacket } from '../supabase/functions/_shared/onepage-packet.ts';
import { attachOnepageUiTemplate } from '../onepage-ui-template.ts';
import { attachResearch } from '../supabase/functions/_shared/product-research.ts';
const proposalId = '00000000-0000-4000-8000-000000000001';
const scope = 'STRUCTURAL content shared by PawfectHouse, GiftSoul and SoulPrise.';
const canonical = (generalized = 'Content titles must identify the current product or category.', expected = 'Write concise titles of two to four words using the correct product noun.', rejects = '- A generic title with no product noun.\n- The wrong product category.') => `## Generalized Rule\n${generalized}\n\n## Expected Behavior\n${expected}\n\n## Reject Conditions\n${rejects}\n\n## Scope\n${scope}\n\n## Rule Class\nSTRUCTURAL\n\n## Confidence\nHIGH`;
const categories: QualityRule['category'][] = ['content', 'typography', 'banner', 'proof', 'brand_style', 'delivery', 'workflow'];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const mirror = (metadata: any, brand: string) => ({ ...clone(metadata), active_brand: brand, onepage_master_brand: 'PawfectHouse', onepage_sync_mode: 'PAWFECTHOUSE_MASTER_100_PERCENT', cross_brand_onepage_structure: 'IDENTICAL_HARD', brand_difference_scope: 'BRAND_DNA_EXPRESSION_ONLY' });
async function ruleFixture(body = canonical()) {
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
const capability = () => ({ compiler_version: QUALITY_COMPILER, ...JSON.parse(spawnSync(process.execPath, ['scripts/compile-agent-review-plan.mjs','--print-manifest'], { encoding: 'utf8' }).stdout) });
async function reviewFixture(ruleContext?: any) {
  const context = ruleContext || await ruleFixture();
  const request = '00000000-0000-4000-8000-000000000055';
  const manifest = context.targets.flatMap((target: any, i: number) => ['source','baseline','candidate'].map(kind => ({
    evidence_id: `evidence-${i}-${kind}`, brand_id: target.brand_id, kind, locator: `https://example.test/${i}/${kind}.png`, record_version: `record-${i}-${kind}`, expected_content_sha256: null, object_version: null,
  })));
  const claim: any = { request_id: request, proposal_id: context.proposal.id, attempt_id: request + ':1', lease_version: 1,
    evaluator_version: AGENT_REVIEW_EVALUATOR, candidate_hash: context.candidate_hash, snapshot_hash: 'sha256:' + 'a'.repeat(64),
    leased_at: '2026-10-13T04:00:00Z', lease_expires_at: '2026-10-13T04:15:00Z', expires_at: '2026-10-14T04:00:00Z', lease_token: 'private-test-lease-token', owner_user_id: 'private-test-owner-id',
    snapshot: { proposal: context.proposal, candidate_hash: context.candidate_hash, targets: clone(context.targets), rule_context: context, compiler_capability: capability(), media_manifest: manifest } };
  const review: any = { schema_version: 'uid.agent-review.v1', decision: 'passed', review_note: 'Synthetic fixture only: pinned source and image review is complete.',
    media_receipts: manifest.map((m: any) => ({ evidence_id: m.evidence_id, locator: m.locator, record_version: m.record_version,
      content_sha256: 'b'.repeat(64), revalidated_sha256: 'b'.repeat(64), retrieved_at: '2026-10-13T04:01:00Z', revalidated_at: '2026-10-13T04:02:00Z',
      inspected: true, media_type: 'image/png', inspection_method: 'image', note: 'Synthetic test receipt, no real-world media inspection claimed.' })),
    findings: context.targets.flatMap((target: any) => ['product_truth','visual_quality','canonical_conflicts'].map(criterion => ({ brand_id: target.brand_id,
      criterion, result: 'passed', critical: false, note: 'Synthetic fixture finding with complete pinned evidence coverage.',
      evidence_ids: manifest.filter((m: any) => m.brand_id === target.brand_id).map((m: any) => m.evidence_id), canonical_node_ids: [target.id] }))),
  };
  return { claim, review, context };
}
function advanceContext(context: any, targets: any[], newId: string, text: string) {
  const next = clone(context); next.proposal.id = newId; next.proposal.proposed_content_md = canonical(text);
  next.targets = next.targets.map((t: any) => ({ ...t, ...clone(targets.find(x => x.node_id === t.id)), id: t.id }));
  next.compiler_context.merge_block_text = '\n\n## ACCEPTED ADMIN FEEDBACK — 2026-10-13\n' + next.proposal.proposed_content_md + '\n';
  next.compiler_context.projected_targets = next.targets.map((t: any) => ({ ...clone(t), content_md: t.content_md + next.compiler_context.merge_block_text }));
  return next;
}
async function mustBlock(claim: any, review: any, code?: string) {
  const result = await buildAgentReviewedRulePlan(claim, review);
  assert.equal(result.status,'BLOCKED'); assert.equal(result.compiler_plan,null); assert.equal(result.compiler_receipt,null);
  if (code) assert.ok(result.blockers.some(b => b.code === code), JSON.stringify(result.blockers));
}

test('agent-reviewed plan compiles exact scoped /3 guidance and never claims direct owner or future-output QC', async () => {
  const { claim, review, context } = await reviewFixture(); const before = clone({ claim, review });
  const result = await buildAgentReviewedRulePlan(claim, review); assert.equal(result.status,'COMPILED',JSON.stringify(result.blockers));
  assert.deepEqual({ claim, review },before);
  const receipt = result.compiler_receipt!; assert.equal(receipt.proof_scope,'DETERMINISTIC_COMPILATION_ONLY');
  assert.equal(receipt.review_hash,await sha256(stableJson(agentReviewCore(review))));
  assert.equal(receipt.plan_hash,await sha256(stableJson(result.compiler_plan))); assert.equal(receipt.compiled.length,3);
  assert.equal(JSON.stringify(result).includes('private-test-'),false); assert.equal(JSON.stringify(result).includes('example.test'),false);
  for (const [i,target] of result.compiler_plan!.targets.entries()) {
    const brand = context.compiler_context.brands[i];
    const bundle = target.metadata.creative_quality_contract.contracts[brand.slug];
    assert.equal(bundle.schema_version,'uid-creative-quality/3');
    assert.deepEqual(bundle.rules,context.targets[i].metadata.creative_quality_contract.contracts[brand.slug].rules);
    assert.deepEqual(bundle.references,context.targets[i].metadata.creative_quality_contract.contracts[brand.slug].references);
    const added = bundle.agent_reviewed_supplemental_rules[0];
    assert.equal(added.canonical_text,context.proposal.proposed_content_md);
    assert.equal(added.decision_kind,'owner_approved_agent_review'); assert.equal(added.attempt_id,claim.attempt_id);
    assert.equal(added.review_scope,'PINNED_EVIDENCE_ONLY_NOT_FUTURE_OUTPUT_GUARANTEE');
    assert.equal(Object.hasOwn(added,'visual_qc_performed'),false); assert.equal(Object.hasOwn(added,'owner_user_id'),false);
    const dna = { brand, branch: {...context.targets[i],...target}, brand_dna: context.compiler_context.brand_dna_nodes[i] };
    const compiled = await compileCreativeQuality(dna); assert.equal(compiled.status,'COMPILED');
    assert.deepEqual(compiled.source_hashes,receipt.compiled[i].source_hashes); assert.equal(compiled.contract_hash,receipt.compiled[i].contract_hash);
    assert.equal(compiled.gates.human_artistic_review,'REQUIRED');
    const packet = await buildOnepagePacket(dna);
    assert.equal(packet.agent_reviewed_supplemental_contract.rules[0].canonical_text,added.canonical_text);
    assert.equal(attachOnepageUiTemplate(packet,brand.name,'Onepage').quality_execution_guard.status,'COMPILED');
    assert.equal((await directOnlyCompiler(dna)).status,'BLOCKED','frozen direct /2 compiler must reject /3');
  }
});

test('direct uncompiled leaf append never becomes an agent compiler receipt or a fabricated catalog', async () => {
  for (const count of [1, 3]) {
    const context: any = await ruleFixture();
    context.targets = context.targets.slice(0, count).map((node: any) => {
      const copy = clone(node); copy.slug = 'ldp-system';
      delete copy.metadata.creative_quality_contract;
      return copy;
    });
    context.proposal.knowledge_node_id = context.targets[0].id;
    context.scope = { ...context.scope, branch_slug: 'ldp-system', cross_brand: count > 1, structural: count > 1,
      source_node_id: context.targets[0].id, target_node_ids: context.targets.map((node: any) => node.id) };
    context.direct_rule.owner_authorized = true; context.direct_rule.blockers = [];
    context.compiler_context.dependent_nodes = []; context.compiler_context.brand_dna_nodes = [];
    context.compiler_context.master_node_id = null; context.compiler_context.master_count = 0;
    context.compiler_context.projected_targets = context.targets.map((node: any) => ({ ...clone(node), content_md: node.content_md + context.compiler_context.merge_block_text }));
    const owner = await buildOwnerRulePlan(context);
    assert.equal(owner.eligible, true, JSON.stringify(owner.blockers));
    assert.equal(owner.plan_kind, 'canonical_append'); assert.equal(owner.compiler_version, null);
    assert.deepEqual(owner.compiled, []); assert.equal(owner.visual_qc_performed, false);
    for (const target of owner.plan!.targets) assert.equal(Object.hasOwn(target.metadata, 'creative_quality_contract'), false);
    const { claim, review } = await reviewFixture(context);
    const before = clone({ claim, review });
    await mustBlock(claim, review, 'catalog_required');
    assert.deepEqual({ claim, review }, before);
  }
});

test('missing, unknown, partial, mismatched or self-attested media review cannot produce a compiler receipt', async () => {
  for (const kind of ['blocked','missing','unknown','critical','self-attested','old-bytes','old-time','wrong-scope','wrong-attempt','wrong-capability','unstructured']) {
    const {claim,review} = await reviewFixture();
    if (kind==='blocked') review.decision='blocked';
    if (kind==='missing') review.media_receipts.pop();
    if (kind==='unknown') review.findings[0].result='unknown';
    if (kind==='critical') review.findings[0].critical=true;
    if (kind==='self-attested') review.manually_reviewed=true;
    if (kind==='old-bytes') review.media_receipts[0].revalidated_sha256='c'.repeat(64);
    if (kind==='old-time') review.media_receipts[0].retrieved_at='2026-10-12T04:00:00Z';
    if (kind==='wrong-scope') claim.snapshot.targets.pop();
    if (kind==='wrong-attempt') claim.attempt_id=claim.request_id+':2';
    if (kind==='wrong-capability') claim.snapshot.compiler_capability.compiler_version='old';
    if (kind==='unstructured') claim.snapshot.rule_context.proposal.proposed_content_md='Just use the feedback directly.';
    await mustBlock(claim,review);
  }
});

test('review hash excludes attached compiler fields and is stable across object key ordering', async () => {
  const {claim,review} = await reviewFixture(); const a=await buildAgentReviewedRulePlan(claim,review);
  const b=await buildAgentReviewedRulePlan(JSON.parse(stableJson(claim)),{...review,compiler_plan:{forged:'ignored'},compiler_receipt:{forged:'ignored'}});
  assert.deepEqual(a,b); assert.equal(Object.hasOwn(agentReviewCore(review),'compiler_plan'),false);
});

test('mixed owner then agent then owner history preserves all prior decisions and stays /3', async () => {
  const context=await ruleFixture(); const owner=await buildOwnerRulePlan(context); assert.equal(owner.eligible,true);
  const agentContext=advanceContext(context,owner.plan!.targets,'00000000-0000-4000-8000-000000000002','Content should answer a verified buyer question.');
  const {claim,review}=await reviewFixture(agentContext); const agent=await buildAgentReviewedRulePlan(claim,review); assert.equal(agent.status,'COMPILED',JSON.stringify(agent.blockers));
  const finalContext=advanceContext(agentContext,agent.compiler_plan!.targets,'00000000-0000-4000-8000-000000000003','Content should stay concise and useful.');
  const final=await buildOwnerRulePlan(finalContext); assert.equal(final.eligible,true,JSON.stringify(final.blockers));
  for(const [i,target] of final.plan!.targets.entries()) for(const brand of context.compiler_context.brands) {
    const b=target.metadata.creative_quality_contract.contracts[brand.slug];
    assert.equal(b.schema_version,'uid-creative-quality/3'); assert.equal(b.owner_supplemental_rules.length,2); assert.equal(b.agent_reviewed_supplemental_rules.length,1);
    assert.deepEqual(b.owner_supplemental_rules[0],owner.plan!.targets[i].metadata.creative_quality_contract.contracts[brand.slug].owner_supplemental_rules[0]);
    assert.deepEqual(b.agent_reviewed_supplemental_rules[0],agent.compiler_plan!.targets[i].metadata.creative_quality_contract.contracts[brand.slug].agent_reviewed_supplemental_rules[0]);
    assert.equal(b.owner_supplemental_rules[1].decision_kind,'owner_direct_rule');
  }
  const duplicate=advanceContext(agentContext,agent.compiler_plan!.targets,context.proposal.id,'Content changed text but reused an earlier proposal.');
  assert.equal((await buildOwnerRulePlan(duplicate)).eligible,false);
});

test('malformed attribution, schema downgrade, cross-kind duplicate and source drift fail closed in actual compiler', async () => {
  const {claim,review,context}=await reviewFixture(); const plan=await buildAgentReviewedRulePlan(claim,review); assert.equal(plan.status,'COMPILED');
  for(const kind of ['owner','token','attempt','scope','schema','source','hash','duplicate']) {
    const node:any={...clone(context.targets[0]),...clone(plan.compiler_plan!.targets[0])}; const b=node.metadata.creative_quality_contract.contracts.pawfecthouse,entry=b.agent_reviewed_supplemental_rules[0];
    if(kind==='owner')entry.decision_kind='owner_direct_rule'; if(kind==='token')entry.lease_token='should-never-be-public';
    if(kind==='attempt')entry.attempt_id='wrong'; if(kind==='scope')entry.review_scope='ALL_FUTURE_OUTPUTS';
    if(kind==='schema')b.schema_version='uid-creative-quality/2'; if(kind==='source')node.content_md=context.targets[0].content_md;
    if(kind==='hash')entry.review_hash='bad'; if(kind==='duplicate')b.agent_reviewed_supplemental_rules.push(clone(entry));
    const output=await compileCreativeQuality({brand:context.compiler_context.brands[0],branch:node,brand_dna:context.compiler_context.brand_dna_nodes[0]});
    assert.equal(output.status,'BLOCKED',kind); assert.deepEqual(output.agent_reviewed_supplemental_rules,[]);
  }
});

test('pinned standalone CLI runs without node_modules and refuses tampered source or invalid input', async () => {
  const {claim,review}=await reviewFixture(); const cap=claim.snapshot.compiler_capability;
  const temp=mkdtempSync(join(tmpdir(),'uid-agent-compiler-'));
  try {
    for(const item of cap.source_manifest) {const path=join(temp,item.path);mkdirSync(dirname(path),{recursive:true});copyFileSync(item.path,path);}
    const run=(input:any,args:string[]=[])=>spawnSync(process.execPath,['scripts/compile-agent-review-plan.mjs',...args],{cwd:temp,encoding:'utf8',input:typeof input==='string'?input:JSON.stringify(input)});
    const success=run({claim,review}); assert.equal(success.status,0,success.stdout+success.stderr);
    assert.deepEqual(JSON.parse(success.stdout),await buildAgentReviewedRulePlan(claim,review));
    const invalid=run('not JSON'); assert.equal(invalid.status,2); assert.equal(JSON.parse(invalid.stdout).status,'BLOCKED');
    writeFileSync(join(temp,'supabase/functions/_shared/creative-quality.ts'),'tampered source');
    const tampered=run({claim,review}); assert.equal(tampered.status,2);assert.equal(JSON.parse(tampered.stdout).blockers[0].code,'compiler_source_mismatch');
  } finally {rmSync(temp,{recursive:true,force:true});}
});

test('checked-in standalone compiler exactly matches the current vetted source build', () => {
  const rebuilt=buildSync({entryPoints:['supabase/functions/_shared/agent-review-plan.ts'],bundle:true,platform:'node',format:'esm',target:'node24',write:false});
  assert.equal(rebuilt.outputFiles[0].text,readFileSync('scripts/agent-review-compiler.bundle.mjs','utf8'));
});

test('combined owner and agent limit is fail-closed, with cross-kind duplicate proposals rejected', async () => {
  const context=await ruleFixture(); const owner=await buildOwnerRulePlan(context); assert.equal(owner.eligible,true);
  const afterOwner=advanceContext(context,owner.plan!.targets,'00000000-0000-4000-8000-000000000002','Content should answer a verified buyer question.');
  const f=await reviewFixture(afterOwner),agent=await buildAgentReviewedRulePlan(f.claim,f.review); assert.equal(agent.status,'COMPILED');
  const next=advanceContext(afterOwner,agent.compiler_plan!.targets,'00000000-0000-4000-8000-000000000003','Content should stay concise and useful.');
  for(const node of next.targets) for(const b of Object.values(node.metadata.creative_quality_contract.contracts) as any[]) {
    const o=b.owner_supplemental_rules[0],a=b.agent_reviewed_supplemental_rules[0];
    b.owner_supplemental_rules=Array.from({length:8},(_,i)=>{
      const id=`00000000-0000-4000-8000-${String(100+i).padStart(12,'0')}`;
      return {...clone(o),id:'owner:'+id,proposal_id:id,source:{...clone(o.source),locator:'owner-rule:'+id}};
    });
    b.agent_reviewed_supplemental_rules=Array.from({length:8},(_,i)=>{
      const id=`00000000-0000-4000-8000-${String(200+i).padStart(12,'0')}`,request=`00000000-0000-4000-8000-${String(300+i).padStart(12,'0')}`,attempt=request+':1';
      return {...clone(a),id:'agent-review:'+attempt,proposal_id:id,request_id:request,attempt_id:attempt,source:{...clone(a.source),locator:'agent-review:'+id+':'+attempt}};
    });
  }
  next.compiler_context.projected_targets=next.targets.map((t:any)=>({...clone(t),content_md:t.content_md+next.compiler_context.merge_block_text}));
  const full=await reviewFixture(next); await mustBlock(full.claim,full.review,'supplement_capacity_exceeded');
  const direct=await buildOwnerRulePlan(next); assert.equal(direct.eligible,false);assert.equal(direct.blockers[0].code,'supplement_capacity_exceeded');
  const node=clone(next.targets[0]),b=node.metadata.creative_quality_contract.contracts.pawfecthouse;
  b.agent_reviewed_supplemental_rules[0].proposal_id=b.owner_supplemental_rules[0].proposal_id;
  b.agent_reviewed_supplemental_rules[0].source.locator='agent-review:'+b.agent_reviewed_supplemental_rules[0].proposal_id+':'+b.agent_reviewed_supplemental_rules[0].attempt_id;
  const result=await compileCreativeQuality({brand:context.compiler_context.brands[0],branch:node,brand_dna:context.compiler_context.brand_dna_nodes[0]});
  assert.equal(result.status,'BLOCKED');assert.ok(result.errors.includes('DUPLICATE_SUPPLEMENT_PROPOSALS'));
});

test('real resolver and Onepage Edge handlers emit sanitized agent provenance, and gateway blocks malformed or old capability', async () => {
  const {claim,review,context}=await reviewFixture(),plan=await buildAgentReviewedRulePlan(claim,review);assert.equal(plan.status,'COMPILED');
  async function invoke(slug:string,dna:any,payload:any) {
    const code=transformSync(readFileSync(`supabase/functions/${slug}/index.ts`,'utf8').replace(/^import .*;\n/gm,''),{loader:'ts',format:'cjs',target:'es2022'}).code;
    let handler:(req:Request)=>Promise<Response>;
    const Deno={env:{get:(key:string)=>key==='SUPABASE_URL'?'https://example.test':key==='SUPABASE_SERVICE_ROLE_KEY'?'synthetic-only':undefined},serve:(fn:any)=>{handler=fn;}};
    const createClient=()=>({rpc:async()=>({data:clone(dna),error:null})});
    new Function('Deno','createClient','compileCreativeQuality','buildOnepagePacket','attachResearch',code)(Deno,createClient,compileCreativeQuality,buildOnepagePacket,attachResearch);
    const response=await handler!(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));
    assert.equal(response.status,200);return response.json();
  }
  for(const [i,target]of plan.compiler_plan!.targets.entries()) {
    const brand=context.compiler_context.brands[i],dna={brand,branch:{...context.targets[i],...target},brand_dna:context.compiler_context.brand_dna_nodes[i]};
    const resolved:any=await invoke('creative-dna-public',dna,{brand:brand.slug,branch:'Onepage'}),packet:any=await invoke('creative-dna-compile-onepage',dna,{brand:brand.slug});
    assert.equal(resolved.creative_quality_contract.contract_hash,packet.creative_quality_contract.contract_hash);
    assert.equal(packet.agent_reviewed_supplemental_contract.rules[0].canonical_text,context.proposal.proposed_content_md);
    for(const body of [resolved,packet]) {
      assert.equal(JSON.stringify(body).includes('private-test-'),false);assert.equal(JSON.stringify(body).includes('lease_token'),false);assert.equal(JSON.stringify(body).includes('owner_user_id'),false);
      assert.equal(attachOnepageUiTemplate(body,brand.name,'Onepage').quality_execution_guard.status,'COMPILED');
    }
    for(const type of ['old','malformed','copy']) {
      const bad=clone(packet);
      if(type==='old')bad.creative_quality_contract.compiler_version='2026-10-13-owner-supplement-v1';
      if(type==='malformed')bad.creative_quality_contract.owner_supplemental_rules=null;
      if(type==='copy')bad.agent_reviewed_supplemental_contract.rules=[];
      assert.equal(attachOnepageUiTemplate(bad,brand.name,'Onepage').quality_execution_guard.status,'BLOCKED');
    }
  }
});

test('staged gateway still accepts genuine direct-owner /2 output while rejecting agent guidance under old capability', async () => {
  const context=await ruleFixture(),plan=await buildOwnerRulePlan(context);assert.equal(plan.eligible,true);
  const dna={brand:context.compiler_context.brands[0],branch:{...context.targets[0],...plan.plan!.targets[0]},brand_dna:context.compiler_context.brand_dna_nodes[0]};
  const previous=await directOnlyCompiler(dna);assert.equal(previous.status,'COMPILED');assert.equal(previous.compiler_version,'2026-10-13-owner-supplement-v1');
  const data={resolved:{brand:'pawfecthouse',branch:'onepage-system'},creative_quality_contract:previous};
  assert.equal(attachOnepageUiTemplate(data,'PawfectHouse','Onepage').quality_execution_guard.status,'COMPILED');
  const injected:any=clone(data);injected.creative_quality_contract.agent_reviewed_supplemental_rules=[];
  assert.equal(attachOnepageUiTemplate(injected,'PawfectHouse','Onepage').quality_execution_guard.status,'BLOCKED');
});

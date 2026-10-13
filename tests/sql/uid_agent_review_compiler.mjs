/** SQL ↔ pinned standalone compiler parity, with real legacy/mirror triggers.
 * All records and inspection receipts are synthetic and transaction-rolled back.
 * Requires disposable localhost PG16 and Node24; never fetches external media.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {default:pg}=await import(process.env.UID_TEST_PG_MODULE || 'pg');
const host=process.env.PGHOST||'localhost';
if(!['localhost','127.0.0.1','::1'].includes(host)||process.env.DATABASE_URL) throw new Error('Disposable localhost PG* only');
const root=fileURLToPath(new URL('../../',import.meta.url));
const c=new pg.Client({host}); await c.connect();
const call=async(fn,args)=>(await c.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const owner='10000000-0000-0000-0000-000000000010';
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const nodes=async()=>(await c.query('select jsonb_agg(to_jsonb(n) order by id) value from public.knowledge_nodes n')).rows[0].value;
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const complete=(claim,review)=>call('uid_review_complete',[claim.request_id,owner,'dot',claim.lease_token,claim.lease_version,claim.candidate_hash,review]);
const compile=(claim,review)=>{
 const result=spawnSync(process.execPath,['scripts/compile-agent-review-plan.mjs'],{cwd:root,input:JSON.stringify({claim,review}),encoding:'utf8',maxBuffer:8_000_000});
 const output=JSON.parse(result.stdout); assert.equal(result.status,0,JSON.stringify(output)); assert.equal(output.status,'COMPILED'); return output;
};
try{
 // Reuse the exact live-inspected legacy function/trigger fixture and strict rule helpers.
 const direct=readFileSync(root+'tests/sql/uid_direct_rule_accept.sql','utf8');
 await c.query(direct.slice(0,direct.indexOf('-- Boundaries:')));
 const queue=readFileSync(root+'tests/sql/uid_agent_review_queue.sql','utf8');
 for(const [start,end] of [['create function pg_temp.record_candidates','select pg_temp.record_candidates'],['create function pg_temp.make_review','update state set review=']]){
  const at=queue.indexOf(start);await c.query(queue.slice(at,queue.indexOf(end,at+start.length)));
 }
 const catalogStart=direct.indexOf('  for target in select value',direct.indexOf('-- Compiled Onepage rules'));
 const catalogEnd=direct.indexOf('  c:=public.uid_rule_preflight',catalogStart);
 await c.query(`do $$ declare s record; catalog jsonb:='{"schema_version":"uid-creative-quality-catalog/1","contracts":{}}'; target jsonb; dna jsonb;rules jsonb;bundle jsonb;slug text;category text;begin select * into s from test_state;${direct.slice(catalogStart,catalogEnd)} end $$`);
 const originalCatalog=(await c.query("select metadata->'creative_quality_contract' value from public.knowledge_nodes where id=$1",[id(101)])).rows[0].value;
 // OWNER /2 first, then AGENT /3, then OWNER /3. No history may be dropped.
 await c.query('update test_state set context=public.uid_rule_preflight(proposal,actor)');
 await c.query("select pg_temp.accept_rule(proposal,actor,context->>'candidate_hash',context#>>'{direct_rule,rule_hash}') from test_state");
 const ownerCatalog=(await c.query("select metadata->'creative_quality_contract' value from public.knowledge_nodes where id=$1",[id(101)])).rows[0].value;
 assert.equal(ownerCatalog.contracts.pawfecthouse.schema_version,'uid-creative-quality/2');
 await c.query(`insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,raw_feedback,proposed_scope,evidence_summary)
 values($1,$2,$3,pg_temp.canonical('Use concise verified product context in every headline.'),'Synthetic agent rule','Shared Onepage structure','{"admin_overview":{"rule_class":"STRUCTURAL"}}')`,[id(202),id(101),id(1)]);
 await c.query(`insert into public.uid_governance_baselines(id,brand_id,branch_slug,case_key,source_brief,approved_output,expected_assertions,approved_by,approved_at)
 select ('10000000-0000-0000-0000-00000000030'||i)::uuid,('10000000-0000-0000-0000-00000000000'||i)::uuid,'onepage-system','compiler-case-'||i,
 jsonb_build_object('product','Verified shirt','source_image',jsonb_build_object('url','https://example.test/source-'||i||'.png','content_sha256',repeat('a',64),'object_version','source-v1')),
 jsonb_build_object('title','Verified shirt','product_id','sku-'||i,'image_url','https://example.test/approved-'||i||'.png'),
 '{"required_text":["Verified shirt"],"forbidden_text":["fake claim"],"required_keys":["title","image_url"],"immutable_fields":["product_id"]}',$1,clock_timestamp() from generate_series(1,3)i`,[owner]);
 await c.query('select pg_temp.record_candidates($1)',[id(202)]);
 const preflight=await call('uid_review_preflight',[id(202),owner]);
 assert.equal(preflight.targets.length,3);
 const request=await call('uid_review_enqueue',[id(202),owner,preflight.review_intent_hash]);
 assert.equal(request.status,'queued',JSON.stringify(request));
 const claim=await call('uid_review_claim',[owner,'dot']);assert.equal(claim.request_id,request.id);
 const review=(await c.query('select pg_temp.make_review($1::jsonb) value',[claim])).rows[0].value;
 const compiled=compile(claim,review);
 const passed={...review,compiler_plan:compiled.compiler_plan,compiler_receipt:compiled.compiler_receipt};
 // A separate SQL reconstruction must agree exactly with the actual standalone host output.
 const validated=(await c.query('select uid_rule_private.validate_agent_compiler(a,$2::jsonb) value from public.uid_review_attempts a where request_id=$1',[request.id,passed])).rows[0].value;
 assert.deepEqual(validated.plan,compiled.compiler_plan);assert.equal(validated.plan_hash,compiled.compiler_receipt.plan_hash);
 console.log('PASS actual PG16 snapshot ↔ pinned Node24 CLI exact plan, source and review hashes');
 const before=await nodes();
 const mutations=[
  ['missing compiler receipt',r=>delete r.compiler_receipt],
  ['null compiler receipt',r=>r.compiler_receipt=null],
  ['manual bypass',r=>r.manually_reviewed=true],
  ['false passed decision',r=>r.decision='blocked'],
  ['missing source receipt',r=>r.media_receipts.pop()],
  ['unknown criterion',r=>r.findings[0].result='unknown'],
  ['review changed after compilation',r=>r.review_note+=' changed'],
  ['wrong compiler bundle',r=>r.compiler_receipt.compiler_bundle_hash='0'.repeat(64)],
  ['wrong compiler version',r=>r.compiler_receipt.compiler_version='old'],
  ['null contract attestation',r=>r.compiler_receipt.compiled[0].contract_hash=null],
  ['missing compiled brand',r=>r.compiler_receipt.compiled.pop()],
  ['duplicate compiled brand',r=>r.compiler_receipt.compiled[0]=r.compiler_receipt.compiled[1]],
  ['source hash drift',r=>r.compiler_receipt.compiled[0].source_hashes.branch='0'.repeat(64)],
  ['wrong attempt',r=>r.compiler_receipt.attempt_id=request.id+':999'],
  ['wrong snapshot',r=>r.compiler_plan.snapshot_hash='sha256:'+'0'.repeat(64)],
  ['wrong plan hash',r=>r.compiler_receipt.plan_hash='0'.repeat(64)],
  ['extra receipt authority',r=>r.compiler_receipt.approved=true],
  ['remove hard rules',r=>r.compiler_plan.targets[0].metadata.creative_quality_contract.contracts.pawfecthouse.rules=[]],
  ['remove references',r=>r.compiler_plan.targets[0].metadata.creative_quality_contract.contracts.pawfecthouse.references=[]],
  ['change immutable schema',r=>r.compiler_plan.targets[0].input_schema={new_permission:true}],
  ['change content',r=>r.compiler_plan.targets[0].content_md='different'],
  ['wrong target count',r=>r.compiler_plan.targets.pop()],
  ['owner attribution',r=>r.compiler_plan.targets[0].metadata.creative_quality_contract.contracts.pawfecthouse.agent_reviewed_supplemental_rules[0].decision_kind='owner_direct_rule'],
  ['fake future guarantee',r=>r.compiler_plan.targets[0].metadata.creative_quality_contract.contracts.pawfecthouse.agent_reviewed_supplemental_rules[0].review_scope='ALL_OUTPUTS'],
  ['leaked lease token',r=>r.compiler_plan.targets[0].metadata.creative_quality_contract.contracts.pawfecthouse.agent_reviewed_supplemental_rules[0].lease_token=claim.lease_token],
 ];
 for(const [name,mutate] of mutations){
  await c.query('savepoint adversarial');const bad=clone(passed);mutate(bad);
  const result=await complete(claim,bad);assert.equal(result.status,'blocked',name+': '+JSON.stringify(result));
  assert.deepEqual(await nodes(),before,name+' cannot partially write canonical');
  assert.equal((await c.query('select count(*)::int n from public.uid_governance_snapshots where proposal_id=$1',[id(202)])).rows[0].n,0);
  await c.query('rollback to adversarial');
 }
 console.log(`PASS ${mutations.length} compiler/media/plan tampering cases leave zero canonical writes`);
 const result=await complete(claim,passed);assert.equal(result.status,'merged',JSON.stringify(result));
 assert.deepEqual(await complete(claim,passed),result,'same lease replay exactly reads committed result');
 const audit=(await c.query('select * from public.uid_agent_review_evaluations where request_id=$1',[request.id])).rows[0];
 assert.equal(audit.evaluation_status,'passed');assert.deepEqual(audit.compiler_plan,compiled.compiler_plan);assert.deepEqual(audit.compiler_receipt,compiled.compiler_receipt);
 assert.equal(audit.review_hash,compiled.compiler_receipt.review_hash);assert.equal(audit.compiler_plan_hash,compiled.compiler_receipt.plan_hash);
 assert.equal(audit.before_snapshot.length,3);assert.equal(audit.after_snapshot.length,3);
 assert.equal((await c.query('select count(*)::int n from public.uid_governance_snapshots where proposal_id=$1',[id(202)])).rows[0].n,6);
 const agentCatalog=(await c.query("select metadata->'creative_quality_contract' value from public.knowledge_nodes where id=$1",[id(101)])).rows[0].value;
 for(const brand of ['pawfecthouse','giftsoul','soulprise']){
  const b=agentCatalog.contracts[brand];assert.equal(b.schema_version,'uid-creative-quality/3');assert.equal(b.agent_reviewed_supplemental_rules.length,1);
  assert.deepEqual(b.owner_supplemental_rules,ownerCatalog.contracts[brand].owner_supplemental_rules);
  assert.deepEqual(b.rules,originalCatalog.contracts[brand].rules);assert.deepEqual(b.references,originalCatalog.contracts[brand].references);
  assert.equal(JSON.stringify(b.agent_reviewed_supplemental_rules).includes(owner),false);assert.equal(JSON.stringify(b.agent_reviewed_supplemental_rules).includes(claim.lease_token),false);
 }
 await c.query(`insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,raw_feedback,proposed_scope,evidence_summary)
 values($1,$2,$3,pg_temp.canonical('Keep verified content useful and easy to scan.'),'Synthetic subsequent owner rule','Shared Onepage structure','{"admin_overview":{"rule_class":"STRUCTURAL"}}')`,[id(203),id(101),id(1)]);
 const last=await call('uid_rule_preflight',[id(203),owner]);assert.equal(last.direct_rule.eligible,true,JSON.stringify(last.direct_rule));
 await c.query('select pg_temp.accept_rule($1,$2,$3,$4)',[id(203),owner,last.candidate_hash,last.direct_rule.rule_hash]);
 const finalCatalog=(await c.query("select metadata->'creative_quality_contract' value from public.knowledge_nodes where id=$1",[id(101)])).rows[0].value;
 for(const brand of ['pawfecthouse','giftsoul','soulprise']){
  const b=finalCatalog.contracts[brand];assert.equal(b.schema_version,'uid-creative-quality/3');assert.equal(b.owner_supplemental_rules.length,2);
  assert.deepEqual(b.agent_reviewed_supplemental_rules,agentCatalog.contracts[brand].agent_reviewed_supplemental_rules);assert.deepEqual(b.rules,originalCatalog.contracts[brand].rules);
 }
 await c.query('select public.uid_governance_rollback_proposal($1,$2)',[id(203),owner]);
 assert.deepEqual((await c.query("select metadata->'creative_quality_contract' value from public.knowledge_nodes where id=$1",[id(101)])).rows[0].value,agentCatalog);
 await c.query('select public.uid_governance_rollback_proposal($1,$2)',[id(202),owner]);
 assert.deepEqual((await c.query("select metadata->'creative_quality_contract' value from public.knowledge_nodes where id=$1",[id(101)])).rows[0].value,ownerCatalog);
 console.log('PASS live master/mirror finalization, exact 3 target snapshot pairs, immutable compiler audit, mixed owner→agent→owner /3 history and rollback');
 await c.query('rollback');
}finally{await c.query('rollback').catch(()=>{});await c.end();}

/** Disposable PostgreSQL owner-direct /4 integration and TS ↔ SQL parity.
 * node --import tsx tests/sql/uid_owner_rule_v4.mjs
 * Use localhost governance_test or UID_TEST_PGLITE_MODULE for an isolated
 * in-memory PostgreSQL runtime. Synthetic records only; all work rolled back.
 */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildCompatibleOwnerRulePlan} from '../../supabase/functions/_shared/owner-rule-compatible-plan.ts';
const root=fileURLToPath(new URL('../../',import.meta.url));
const migration='20261017033000_uid_owner_rule_catalog_v4.sql';
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const owner=id(10),master=id(101),proposal=id(201);
let db,exec;
if(process.env.UID_TEST_PGLITE_MODULE){
 const {PGlite}=await import(process.env.UID_TEST_PGLITE_MODULE);db=new PGlite();exec=sql=>db.exec(sql);
}else{
 const host=process.env.PGHOST||'localhost';
 if(!['localhost','127.0.0.1','::1'].includes(host)||process.env.DATABASE_URL||process.env.PGDATABASE!=='governance_test') throw Error('Disposable localhost governance_test required');
 const {default:pg}=await import(process.env.UID_TEST_PG_MODULE||'pg');db=new pg.Client({host});await db.connect();exec=sql=>db.query(sql);
}
const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
const call=(fn,args)=>value(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args);
const catalog=c=>c.targets[0].metadata.creative_quality_contract;
const canonical=generalized=>`## Generalized Rule\n${generalized}\n\n## Expected Behavior\nPreserve verified canonical product context.\n\n## Reject Conditions\n- Generic unsupported content.\n\n## Scope\nShared Onepage structure\n\n## Rule Class\nSTRUCTURAL\n\n## Confidence\nHIGH`;
function supplement(kind,n){
 const text=canonical(`Preserve distinct verified guidance number ${n}.`),request=id(600+n),attempt=request+':1',pid=id(700+n);
 const base={proposal_id:pid,canonical_text:text,declared_scope:'Shared Onepage structure',scope:{brands:['giftsoul','pawfecthouse','soulprise'],branches:['onepage-system']},rule_class:'STRUCTURAL',confidence:'HIGH',
  source:{node:'branch',locator:'',canonical_text_hash:hash(text)},accepted_source_hashes:{branch:'a'.repeat(64),brand_dna:'b'.repeat(64)},precedence:'SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH'};
 if(kind==='owner')return {...base,schema_version:'uid.owner-supplemental-rule.v1',id:'owner:'+pid,decision_kind:'owner_direct_rule',semantic_consistency:'NOT_PROVEN_BY_DETERMINISTIC_CHECKS',visual_qc_performed:false,source:{...base.source,locator:'owner-rule:'+pid}};
 const rule=kind==='rule',prefix=rule?'agent-rule:':'agent-review:';
 return {...base,schema_version:rule?'uid.agent-rule-reviewed-supplemental-rule.v1':'uid.agent-reviewed-supplemental-rule.v1',id:prefix+attempt,request_id:request,attempt_id:attempt,
  decision_kind:rule?'agent_rule_review':'owner_approved_agent_review',evaluator_version:rule?'dot-agent-v3-rule-semantics':'dot-agent-v1-source-media',snapshot_hash:'sha256:'+'c'.repeat(64),review_hash:'d'.repeat(64),
  review_scope:rule?'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC':'PINNED_EVIDENCE_ONLY_NOT_FUTURE_OUTPUT_GUARANTEE',...(rule?{visual_qc_performed:false}:{}),source:{...base.source,locator:prefix+pid+':'+attempt}};
}
const arrayFields=['owner_supplemental_rules','agent_reviewed_supplemental_rules','agent_rule_reviewed_supplemental_rules'];
const nodes=()=>value('select jsonb_agg(to_jsonb(n) order by id) value from public.knowledge_nodes n');
const permissions=()=>value("select jsonb_build_object('acl',proacl,'owner',proowner,'definer',prosecdef,'config',proconfig,'volatility',provolatile) value from pg_proc where oid='public.uid_rule_catalog_plan(jsonb)'::regprocedure");
async function stamp(c){
 const cat=catalog(c);
 for(const t of c.targets){
  const dna=c.compiler_context.brand_dna_nodes.find(n=>n.brand_id===t.brand_id);
  cat.contracts[t.brand_slug].source_hashes={branch:await call('uid_rule_source_hash',[t]),brand_dna:await call('uid_rule_source_hash',[dna])};
 }
 for(const t of [...c.targets,...c.compiler_context.projected_targets])t.metadata.creative_quality_contract=clone(cat);
 return c;
}
async function fixture(schema,{owners=[],media=[],rules=[]}={}){
 const c=clone(base),cat=catalog(c),all=[...owners,...media,...rules];
 for(const b of Object.values(cat.contracts)){
  b.schema_version=`uid-creative-quality/${schema}`;
  arrayFields.forEach(f=>delete b[f]);
  if(owners.length)b.owner_supplemental_rules=clone(owners);
  if(media.length)b.agent_reviewed_supplemental_rules=clone(media);
  if(rules.length)b.agent_rule_reviewed_supplemental_rules=clone(rules);
 }
 const suffix=all.map(r=>'\n\n'+r.canonical_text).join('');
 for(const t of c.targets)t.content_md+=suffix;
 for(const t of c.compiler_context.projected_targets){const original=c.targets.find(n=>n.id===t.id);t.content_md=original.content_md+c.compiler_context.merge_block_text;}
 return stamp(c);
}
async function parity(c){
 const compiled=await buildCompatibleOwnerRulePlan(c);
 assert.equal(compiled.eligible,true,JSON.stringify(compiled.blockers));
 const sql=await call('uid_rule_catalog_plan',[c]);
 for(const t of compiled.plan.targets)assert.deepEqual(t.metadata.creative_quality_contract,sql,'TS and SQL complete catalogs match');
 return {compiled,sql};
}
let base;
try{
 console.log('PostgreSQL:',await value("select version() value"));
 // This harness requires a fresh disposable database. Production connections
 // cannot be selected through DATABASE_URL or remote PGHOST.
 await exec(readFileSync(root+'tests/sql/governance_fixture.sql','utf8'));
 for(const file of readdirSync(root+'supabase/migrations').filter(f=>f.endsWith('.sql')&&f<migration).sort())await exec(readFileSync(root+'supabase/migrations/'+file,'utf8'));
 const beforeAcl=await permissions();
 const prior=readFileSync(root+'supabase/migrations/20261013044328_uid_agent_review_compiler_finalize.sql','utf8');
 const priorFunction=prior.slice(prior.indexOf('create or replace function public.uid_rule_catalog_plan'),prior.indexOf('revoke all on function public.uid_rule_catalog_plan'));
 // Keep the exact historical function for result regression, without changing
 // its production name or source files.
 await exec(priorFunction.replace('public.uid_rule_catalog_plan','pg_temp.uid_rule_catalog_plan_legacy'));
 await exec(readFileSync(root+'supabase/migrations/'+migration,'utf8'));
 assert.deepEqual(await permissions(),beforeAcl,'replacement retains exact ACL/owner/security/search path');
 const direct=readFileSync(root+'tests/sql/uid_direct_rule_accept.sql','utf8');
 await exec(direct.slice(0,direct.indexOf('-- Boundaries:')));
 const start=direct.indexOf('  for target in select value',direct.indexOf('-- Compiled Onepage rules')),end=direct.indexOf('  c:=public.uid_rule_preflight',start);
 await exec(`do $$ declare s record;catalog jsonb:='{"schema_version":"uid-creative-quality-catalog/1","contracts":{}}';target jsonb;dna jsonb;rules jsonb;bundle jsonb;slug text;category text;begin select * into s from test_state;${direct.slice(start,end)} end $$`);
 base=await call('uid_rule_preflight',[proposal,owner]);
 const oldOwner=supplement('owner',1),oldMedia=supplement('media',2),oldRule=supplement('rule',3);
 for(const [schema,history] of [[1,{}],[2,{owners:[oldOwner]}],[3,{owners:[oldOwner],media:[oldMedia]}],[3,{media:[oldMedia]}]]){
  const c=await fixture(schema,history),next=await call('uid_rule_catalog_plan',[c]);
  const previous=await value('select pg_temp.uid_rule_catalog_plan_legacy($1::jsonb) value',[c]);
  assert.equal(stable(next),stable(previous),`/${schema} exact historical JSON result`);await parity(c);
 }
 console.log('PASS /1-/3 exact historical SQL/TS output, ACL and security preservation');
 const valid=await fixture(4,{owners:[oldOwner],media:[oldMedia],rules:[oldRule]});
 const {compiled,sql}=await parity(valid);
 for(const [brand,b] of Object.entries(sql.contracts)){
  const original=catalog(valid).contracts[brand];assert.equal(b.schema_version,'uid-creative-quality/4');
  assert.deepEqual(b.rules,original.rules);assert.deepEqual(b.references,original.references);
  assert.deepEqual(b.owner_supplemental_rules.slice(0,-1),original.owner_supplemental_rules);
  assert.deepEqual(b.agent_reviewed_supplemental_rules,original.agent_reviewed_supplemental_rules);
  assert.deepEqual(b.agent_rule_reviewed_supplemental_rules,original.agent_rule_reviewed_supplemental_rules);
  const added=b.owner_supplemental_rules.at(-1);assert.equal(added.decision_kind,'owner_direct_rule');assert.equal(added.visual_qc_performed,false);
 }
 for(const history of [{rules:[oldRule]},{owners:[oldOwner],rules:[oldRule]},{media:[oldMedia],rules:[oldRule]}])await parity(await fixture(4,history));
 // Capacity is shared across all three immutable histories.
 await parity(await fixture(4,{owners:[oldOwner],media:[oldMedia],rules:Array.from({length:13},(_,i)=>supplement('rule',10+i))}));
 const full=await fixture(4,{owners:[oldOwner],media:[oldMedia],rules:Array.from({length:14},(_,i)=>supplement('rule',10+i))});
 assert.equal((await buildCompatibleOwnerRulePlan(full)).eligible,false);
 await exec('savepoint full_capacity');await assert.rejects(call('uid_rule_catalog_plan',[full]),/capacity/);await exec('rollback to full_capacity');
 const mutateBundle=(fn)=>c=>{for(const b of Object.values(catalog(c).contracts))fn(b);};
 const mutateRule=fn=>mutateBundle(b=>fn(b.agent_rule_reviewed_supplemental_rules[0],b));
 const attacks=[
  ['missing v4 history',mutateBundle(b=>delete b.agent_rule_reviewed_supplemental_rules)],
  ['empty legacy media capability',mutateBundle(b=>b.agent_reviewed_supplemental_rules=[])],
  ['empty legacy owner capability',mutateBundle(b=>{delete b.agent_reviewed_supplemental_rules;b.owner_supplemental_rules=[];})],
  ['empty v4 history',mutateBundle(b=>b.agent_rule_reviewed_supplemental_rules=[])],
  ['null v4 history',mutateBundle(b=>b.agent_rule_reviewed_supplemental_rules=null)],
  ['downgraded schema',mutateBundle(b=>b.schema_version='uid-creative-quality/3')],
  ['future schema',mutateBundle(b=>b.schema_version='uid-creative-quality/5')],
  ['duplicate prior ID',mutateBundle(b=>b.agent_rule_reviewed_supplemental_rules.push(clone(b.agent_rule_reviewed_supplemental_rules[0])))],
  ['cross-layer proposal collision',mutateRule((r,b)=>r.proposal_id=b.owner_supplemental_rules[0].proposal_id)],
  ['incoming proposal collision',mutateRule(r=>r.proposal_id=proposal)],
  ['unknown provenance property',mutateRule(r=>r.owner_approved=true)],
  ['missing property',mutateRule(r=>delete r.review_hash)],
  ['null request',mutateRule(r=>r.request_id=null)],
  ['invalid attempt',mutateRule(r=>r.attempt_id=r.request_id+':01')],
  ['attempt extra suffix',mutateRule(r=>r.attempt_id+=':2')],
  ['wrong evaluator',mutateRule(r=>r.evaluator_version='owner')],
  ['owner attribution',mutateRule(r=>r.decision_kind='owner_direct_rule')],
  ['false QC',mutateRule(r=>r.visual_qc_performed=true)],
  ['future-output guarantee',mutateRule(r=>r.review_scope='ALL_FUTURE_OUTPUTS')],
  ['broken hash',mutateRule(r=>r.source.canonical_text_hash='0'.repeat(64))],
  ['broken locator',mutateRule(r=>r.source.locator='owner-rule:'+r.proposal_id)],
  ['wildcard scope',mutateRule(r=>r.scope.brands.push('*'))],
  ['scope extra key',mutateRule(r=>r.scope.product_urls=['https://example.test'])],
  ['missing current brand',mutateRule(r=>r.scope.brands=['other'])],
  ['missing current branch',mutateRule(r=>r.scope.branches=['other'])],
  ['source hash extra key',mutateRule(r=>r.accepted_source_hashes.owner='yes')],
  ['null accepted hash',mutateRule(r=>r.accepted_source_hashes.branch=null)],
  ['canonical changed',mutateRule(r=>r.canonical_text+=' changed')],
  ['mismatched canonical class',mutateRule(r=>r.rule_class='WORKFLOW')],
  ['mismatched declared scope',mutateRule(r=>r.declared_scope='different')],
  ['prior owner QC changed',mutateBundle(b=>b.owner_supplemental_rules[0].visual_qc_performed=true)],
  ['prior media scope changed',mutateBundle(b=>b.agent_reviewed_supplemental_rules[0].review_scope='ALL_FUTURE_OUTPUTS')],
 ];
 const unchanged=await nodes();
 for(const [name,mutate] of attacks){
  const bad=clone(valid);mutate(bad);await stamp(bad);
  assert.equal((await buildCompatibleOwnerRulePlan(bad)).eligible,false,name+' TS rejection');
  await exec('savepoint attack');await assert.rejects(call('uid_rule_catalog_plan',[bad]),undefined,name+' SQL rejection');await exec('rollback to attack');
  assert.deepEqual(await nodes(),unchanged,name+' zero canonical writes');
 }
 for(const [name,mutate] of [
  ['current catalog drift',c=>c.targets[1].metadata.creative_quality_contract.contracts.pawfecthouse.agent_rule_reviewed_supplemental_rules[0].review_hash='e'.repeat(64)],
  ['projection catalog drift',c=>c.compiler_context.projected_targets[1].metadata.creative_quality_contract.contracts.pawfecthouse.agent_rule_reviewed_supplemental_rules[0].review_hash='e'.repeat(64)],
  ['stale source',c=>catalog(c).contracts.pawfecthouse.source_hashes.branch='0'.repeat(64)]]){
  const bad=clone(valid);mutate(bad);assert.equal((await buildCompatibleOwnerRulePlan(bad)).eligible,false,name);
  await exec('savepoint attack');await assert.rejects(call('uid_rule_catalog_plan',[bad]),undefined,name);await exec('rollback to attack');
 }
 console.log(`PASS /4 full SQL/TS catalog parity, all3 preservation/capacity, ${attacks.length+3} fail-closed tampering cases`);
 // Materialize a valid prior /4 into the disposable database, then exercise the
 // actual owner RPC, real master/mirror triggers, immutable audit and rollback.
 await db.query('update public.knowledge_nodes set content_md=$1,metadata=$2::jsonb where id=$3',[valid.targets[0].content_md,JSON.stringify(valid.targets[0].metadata),master]);
 const fresh=await call('uid_rule_preflight',[proposal,owner]);assert.equal(fresh.direct_rule.eligible,true,JSON.stringify(fresh.direct_rule));
 const result=await parity(fresh);const beforeWrite=await nodes();
 for(const [name,mutate] of [
  ['remove retained rule provenance',p=>{for(const t of p.targets)delete t.metadata.creative_quality_contract.contracts.pawfecthouse.agent_rule_reviewed_supplemental_rules;}],
  ['change retained hard rule',p=>{for(const t of p.targets)t.metadata.creative_quality_contract.contracts.pawfecthouse.rules[0].instruction='Changed';}],
  ['forge prior owner decision',p=>{for(const t of p.targets)t.metadata.creative_quality_contract.contracts.pawfecthouse.owner_supplemental_rules[0].canonical_text='Changed';}],
  ['overwrite target content',p=>p.targets[0].content_md='Changed'],
 ]){
  const bad=clone(result.compiled.plan);mutate(bad);await exec('savepoint reject_owner_plan');
  await assert.rejects(call('uid_rule_accept',[proposal,owner,fresh.candidate_hash,fresh.direct_rule.rule_hash,bad,hash(bad)]),/plan/i,name);
  await exec('rollback to reject_owner_plan');assert.deepEqual(await nodes(),beforeWrite,name+' zero partial writes');
  assert.equal(await value('select count(*)::int value from uid_rule_private.decisions'),0,name+' zero audit writes');
 }
 const merged=await call('uid_rule_accept',[proposal,owner,fresh.candidate_hash,fresh.direct_rule.rule_hash,result.compiled.plan,result.compiled.plan_hash]);
 assert.equal(merged.status,'merged',JSON.stringify(merged));
 assert.equal(await value('select count(*)::int value from uid_rule_private.decisions'),1);
 assert.equal(await value('select count(*)::int value from public.uid_agent_review_evaluations'),0,'owner decision is never media QC');
 for(const row of await nodes()){
  if(row.slug!=='onepage-system'){assert.deepEqual(row,beforeWrite.find(n=>n.id===row.id));continue;}
  assert.deepEqual(row.metadata.creative_quality_contract,result.sql);
  const plan=result.compiled.plan.targets.find(t=>t.node_id===row.id);assert.equal(row.content_md,plan.content_md);
 }
 assert.deepEqual(await call('uid_rule_accept',[proposal,owner,fresh.candidate_hash,fresh.direct_rule.rule_hash,result.compiled.plan,result.compiled.plan_hash]),merged,'exact replay');
 await call('uid_governance_rollback_proposal',[proposal,owner]);
 const restored=await nodes();
 assert.deepEqual(restored.map(({updated_at,...r})=>r),beforeWrite.map(({updated_at,...r})=>r),'rollback restores full /4 provenance');
 console.log('PASS actual owner acceptance, 3 master/mirror targets, exact replay, zero outside writes, immutable owner audit and full /4 rollback');
}finally{
 await exec('rollback').catch(()=>{});
 if(db.close)await db.close();else await db.end();
}

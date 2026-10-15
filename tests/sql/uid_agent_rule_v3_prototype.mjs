/** Disposable localhost PG16 only. Synthetic records and receipts, all rolled back.
 * This is compiler/SQL parity, never a real review or production approval. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {default:pg}=await import(process.env.UID_TEST_PG_MODULE||'pg');
const host=process.env.PGHOST||'localhost';
if(!['localhost','127.0.0.1','::1'].includes(host)||process.env.DATABASE_URL) throw Error('Disposable localhost PG only');
const root=fileURLToPath(new URL('../../',import.meta.url)),db=new pg.Client({host});await db.connect();
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(stable(v)).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const call=async(fn,args)=>(await db.query(`select uid_rule_v3_private.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const owner='10000000-0000-0000-0000-000000000010';const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const rules=JSON.parse(readFileSync(root+'tests/fixtures/agent-rule-pilot-policy.json','utf8'));
const manifest=JSON.parse(spawnSync('node',['scripts/compile-agent-rule-review-plan.mjs','--print-manifest'],{cwd:root,encoding:'utf8'}).stdout);
const complete=(c,r)=>call('complete',[c.request_id,owner,'dot',c.lease_token,c.lease_version,c.candidate_hash,r]);
const nodes=async()=>(await db.query('select jsonb_agg(to_jsonb(n) order by id) value from public.knowledge_nodes n')).rows[0].value;
async function review(claim){
 const c=claim.snapshot.rule_context,byId=new Map();
 for(const x of [{id:'rule-context',record:c},...c.targets,...c.compiler_context.brand_dna_nodes,...c.compiler_context.dependent_nodes]) byId.set(x.id,x);
 const records=[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id));
 await new Promise(r=>setTimeout(r,10));const checked=new Date().toISOString();
 return {schema_version:'uid.agent-rule-review.v1',decision:'passed',review_note:'Synthetic SQL parity fixture only; this is not a production source review.',visual_qc_performed:false,review_scope:'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC',
 source_receipts:records.map(x=>({node_id:x.id,record_sha256:hash(x),read_at:claim.leased_at,revalidated_at:checked,note:'Synthetic source read assertion used solely for the disposable SQL parity test.'})),
 findings:c.targets.flatMap(t=>['rule_semantics','scope_fidelity','canonical_conflicts'].map(criterion=>({node_id:t.id,criterion,result:'passed',note:'Synthetic semantic finding for deterministic test coverage; no real review is asserted.',source_node_ids:records.map(x=>x.id)})))};
}
function compile(claim,review){
 const r=spawnSync('node',['scripts/compile-agent-rule-review-plan.mjs'],{cwd:root,input:JSON.stringify({claim,review}),encoding:'utf8',maxBuffer:8_000_000});
 assert.equal(r.status,0,r.stdout+r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.status,'COMPILED');return {...review,compiler_plan:result.compiler_plan,compiler_receipt:result.compiler_receipt};
}
try{
 const direct=readFileSync(root+'tests/sql/uid_direct_rule_accept.sql','utf8');await db.query(direct.slice(0,direct.indexOf('-- Boundaries:')));
 for(const name of ['foundation','context','queue','finalize']) await db.query(readFileSync(root+`tests/sql/prototypes/uid_agent_rule_v3_${name}.sql`,'utf8'));
 const start=direct.indexOf('  for target in select value',direct.indexOf('-- Compiled Onepage rules')),end=direct.indexOf('  c:=public.uid_rule_preflight',start);
 await db.query(`do $$ declare s record; catalog jsonb:='{"schema_version":"uid-creative-quality-catalog/1","contracts":{}}'; target jsonb;dna jsonb;rules jsonb;bundle jsonb;slug text;category text;begin select * into s from test_state;${direct.slice(start,end)} end $$`);
 await db.query('insert into uid_rule_v3_private.release values(true,true,1,$1,$2,$3,$4)',['2026-10-15-agent-rule-general-v1',JSON.stringify(manifest.source_manifest),manifest.compiler_bundle_hash,'DISPOSABLE TEST ONLY']);
 await db.query('update public.knowledge_proposals set proposed_content_md=$1,proposed_scope=$2 where id=$3',[rules.operations[0].canonical_text,rules.scope,id(201)]);
 const preview=await call('preview',[id(201),owner]);
 const handoff=await call('handoff',[id(201),owner,preview.intent_hash,id(501)]);assert.equal(handoff.status,'queued');
 assert.deepEqual(await call('handoff',[id(201),owner,preview.intent_hash,id(501)]),handoff);
 const claim=await call('claim',[owner,'dot']);assert.ok(claim);assert.equal(await call('claim',[owner,'dot']),null,'live lease cannot be stolen');
 const passed=compile(claim,await review(claim));const before=await nodes();
 const attacks=[
 ['wrong review scope',r=>r.review_scope='OUTPUT_QC'],['fake visual QC',r=>r.visual_qc_performed=true],
 ['missing source',r=>r.source_receipts.pop()],['wrong source hash',r=>r.source_receipts[0].record_sha256='a'.repeat(64)],
 ['unknown finding',r=>r.findings[0].result='unknown'],['wrong plan',r=>r.compiler_plan.targets[0].content_md='overwrite'],
 ['wrong compiler',r=>r.compiler_receipt.compiler_bundle_hash='a'.repeat(64)],
 ['owner attribution',r=>r.compiler_plan.targets[0].metadata.creative_quality_contract.contracts.pawfecthouse.agent_rule_reviewed_supplemental_rules[0].decision_kind='owner_direct_rule'],
 ['drop hard rules',r=>r.compiler_plan.targets[0].metadata.creative_quality_contract.contracts.pawfecthouse.rules=[]],
 ];
 for(const [name,mutate] of attacks){await db.query('savepoint attack');const r=clone(passed);mutate(r);const out=await complete(claim,r);assert.equal(out.status,'blocked',name+JSON.stringify(out));assert.deepEqual(await nodes(),before,name);await db.query('rollback to attack');}
 const result=await complete(claim,passed);assert.equal(result.status,'merged',JSON.stringify(result));
 assert.deepEqual(await complete(claim,passed),result,'idempotent completion');
 const audit=(await db.query('select * from uid_rule_v3_private.audit where request_id=$1',[claim.request_id])).rows;
 assert.equal(audit.length,1);assert.equal(audit[0].visual_qc_performed,false);assert.equal(audit[0].decision_kind,'agent_rule_review');
 assert.equal((await db.query('select count(*)::int n from public.uid_agent_review_evaluations')).rows[0].n,0,'no fake media QC');
 assert.equal((await db.query('select count(*)::int n from uid_rule_private.decisions')).rows[0].n,0,'no owner-direct attribution');
 console.log('PASS first regression fixture SQL/Node parity, tamper rejection and idempotent completion');
 await db.query('insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,proposed_scope) values($1,$2,$3,$4,$5)',[id(202),id(101),id(1),rules.operations[1].canonical_text,rules.scope]);
 const next=await call('preview',[id(202),owner]);await call('handoff',[id(202),owner,next.intent_hash,id(502)]);
 const nextClaim=await call('claim',[owner,'dot']);const nextReview=compile(nextClaim,await review(nextClaim));
 const second=await complete(nextClaim,nextReview);assert.equal(second.status,'merged',JSON.stringify(second));
 const catalog=(await db.query("select metadata->'creative_quality_contract' c from public.knowledge_nodes where id=$1",[id(101)])).rows[0].c;
 for(const b of Object.values(catalog.contracts))assert.equal(b.agent_rule_reviewed_supplemental_rules.length,2);
 console.log('PASS second v4 addition preserves prior agent rule history across all brands');
 const arbitrary=rules.operations[0].canonical_text.replace(/## Generalized Rule\n[\s\S]*?\n\n## Expected Behavior/, '## Generalized Rule\nCategory section headings must express distinct shopping intents.\n\n## Expected Behavior');
 await db.query('insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,proposed_scope) values($1,$2,$3,$4,$5)',[id(203),id(101),id(1),arbitrary,rules.scope]);
 const general=await call('preview',[id(203),owner]);await call('handoff',[id(203),owner,general.intent_hash,id(503)]);
 const generalClaim=await call('claim',[owner,'dot']);assert.ok(generalClaim);
 const cancelled=await call('cancel',[id(203),owner,general.intent_hash,id(503)]);assert.equal(cancelled.status,'cancelled');
 const cancelledReview=compile(generalClaim,await review(generalClaim));
 await db.query('savepoint cancelled_completion');
 await assert.rejects(()=>complete(generalClaim,cancelledReview),/Matching live fenced lease/);
 await db.query('rollback to cancelled_completion');
 assert.equal((await call('handoff',[id(203),owner,general.intent_hash,id(503)])).status,'cancelled','old key must not renew cancelled intent');
 assert.equal((await call('handoff',[id(203),owner,general.intent_hash,id(504)])).status,'queued','new explicit key may re-delegate');
 await db.query('savepoint stale_cancel');
 await assert.rejects(()=>call('cancel',[id(203),owner,general.intent_hash,id(503)]),/Cancellation delegation changed/);
 await db.query('rollback to stale_cancel');
 const fresh=await call('claim',[owner,'dot']);assert.equal((await complete(fresh,compile(fresh,await review(fresh)))).status,'merged');
 console.log('PASS general creative rule, cancellation and explicit fresh handoff');

}finally{await db.query('rollback');await db.end();}

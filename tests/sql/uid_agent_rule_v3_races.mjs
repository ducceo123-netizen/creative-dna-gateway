/** Disposable localhost PG16 only. Synthetic records and receipts, committed only in disposable CI database.
 * This is compiler/SQL parity, never a real review or production approval. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {default:pg}=await import(process.env.UID_TEST_PG_MODULE||'pg');
const host=process.env.PGHOST||'localhost';
if((process.env.PGDATABASE||'')!=='governance_test') throw Error('Disposable governance_test database required');
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

 await db.query('commit');
 const clients=await Promise.all([1,2,3].map(async()=>{const c=new pg.Client({host});await c.connect();return c;}));
 const invoke=async(c,fn,args)=>(await c.query(`select uid_rule_v3_private.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const finish=(c,claim,r)=>invoke(c,'complete',[claim.request_id,owner,'dot',claim.lease_token,claim.lease_version,claim.candidate_hash,r]);
 const newProposal=async(n)=>{
  const text=rules.operations[0].canonical_text.replace('## Generalized Rule\n',`## Generalized Rule\nFixture ${n}: `);
  await db.query('insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,proposed_scope) values($1,$2,$3,$4,$5)',[id(n),id(101),id(1),text,rules.scope]);
  const p=await call('preview',[id(n),owner]);await call('handoff',[id(n),owner,p.intent_hash,id(n+500)]);return p;
 };
 try{
  const preview=await call('preview',[id(201),owner]);await call('handoff',[id(201),owner,preview.intent_hash,id(701)]);
  const claims=await Promise.all(clients.slice(0,2).map(c=>invoke(c,'claim',[owner,'dot'])));
  assert.equal(claims.filter(Boolean).length,1,'exactly one competing claimant');
  const claim=claims.find(Boolean),r=compile(claim,await review(claim));
  const results=await Promise.all(clients.slice(0,2).map(c=>finish(c,claim,r)));
  assert.ok(results.every(x=>x.status==='merged'));
  assert.equal((await db.query('select count(*)::int n from uid_rule_v3_private.audit where request_id=$1',[claim.request_id])).rows[0].n,1);
  console.log('PASS concurrent claims and idempotent concurrent completion');

  const p=await newProposal(204),cancelClaim=await call('claim',[owner,'dot']),cancelReview=compile(cancelClaim,await review(cancelClaim));
  await clients[2].query('begin');await clients[2].query('lock table public.knowledge_nodes in share row exclusive mode');
  const cancelPromise=invoke(clients[0],'cancel',[id(204),owner,p.intent_hash,id(704)]);
  const deadline=Date.now()+5000;
  while(true){
   const waiting=(await db.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'",[clients[0].processID])).rowCount;
   if(waiting)break;
   if(Date.now()>deadline)throw Error('Cancellation did not reach lock wait');
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  const completionPromise=finish(clients[1],cancelClaim,cancelReview);
  await clients[2].query('commit');
  const settled=await Promise.allSettled([cancelPromise,completionPromise]);
  const status=await call('get_request',[id(204),owner]);
  assert.equal(status.status,'cancelled','queued cancellation wins before waiting completion');
  assert.equal(settled[0].status,'fulfilled');assert.equal(settled[1].status,'rejected');
  assert.equal((await db.query('select count(*)::int n from uid_rule_v3_private.audit where request_id=$1',[cancelClaim.request_id])).rows[0].n,0);
  console.log('PASS cancellation waiting for canonical lock invalidates completion');

  const revoked=await newProposal(205),old=await call('claim',[owner,'dot']),oldReview=compile(old,await review(old));
  await db.query('update uid_rule_private.owner_config set enabled=false where singleton');
  await assert.rejects(()=>finish(clients[0],old,oldReview),/configured owner/);
  await db.query('update uid_rule_private.owner_config set enabled=true where singleton');
  const oldResult=await finish(clients[0],old,oldReview);assert.equal(oldResult.status,'superseded');
  const fresh=await call('handoff',[id(205),owner,revoked.intent_hash,id(805)]);assert.equal(fresh.status,'queued');
  await call('cancel',[id(205),owner,revoked.intent_hash,id(805)]);
  console.log('PASS owner revoke/re-enable fences old attempt and permits new explicit handoff');

  // Accelerate only this disposable function's lease duration, not production
  // SQL. The exact same expiry/reclaim/token branches run against wall clock.
  const claimDef=(await db.query("select pg_get_functiondef('uid_rule_v3_private.claim(uuid,text)'::regprocedure) d")).rows[0].d;
  await db.query(claimDef.replaceAll("interval '900 seconds'","interval '100 milliseconds'"));
  const short=await newProposal(206),expired=await call('claim',[owner,'dot']);
  await new Promise(resolve=>setTimeout(resolve,150));
  await assert.rejects(()=>finish(clients[0],expired,{decision:'blocked'}),/Lease expired/);
  await db.query(claimDef);
  const reclaimed=await call('claim',[owner,'dot']);assert.equal(reclaimed.request_id,expired.request_id);
  assert.equal(reclaimed.lease_version,expired.lease_version+1);assert.notEqual(reclaimed.lease_token,expired.lease_token);
  await assert.rejects(()=>finish(clients[0],expired,{decision:'blocked'}),/Matching live fenced lease/);
  await call('cancel',[id(206),owner,short.intent_hash,id(706)]);
  console.log('PASS accelerated disposable lease expiry/reclaim rejects prior token');

  const competingText=rules.operations[0].canonical_text.replace('## Generalized Rule\n','## Generalized Rule\nFixture 207: ');
  await db.query('insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,proposed_scope) values($1,$2,$3,$4,$5)',[id(207),id(101),id(1),competingText,rules.scope]);
  const v3=await call('preview',[id(207),owner]);
  const v2Hash=(await db.query('select public.uid_review_intent_hash($1,$2) h',[id(207),owner])).rows[0].h;
  const competing=await Promise.allSettled([
   invoke(clients[0],'handoff',[id(207),owner,v3.intent_hash,id(707)]),
   clients[1].query('select public.uid_review_enqueue($1,$2,$3)',[id(207),owner,v2Hash])
  ]);
  assert.equal(competing.filter(x=>x.status==='fulfilled').length,1,'one explicit route wins competing handoffs');
  const counts=(await db.query("select (select count(*) from uid_rule_v3_private.requests where proposal_id=$1 and status in ('queued','leased','blocked'))+(select count(*) from public.uid_review_requests where proposal_id=$1 and status in ('queued','leased','blocked')) n",[id(207)])).rows[0].n;
  assert.equal(Number(counts),1);console.log('PASS competing v2/v3 handoffs preserve one route');


 }finally{await Promise.all(clients.map(c=>c.end()));}
}finally{await db.end();}

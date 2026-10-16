/** Disposable localhost PG16/PG17 only. Synthetic records and receipts, committed only in disposable CI database.
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
 const serverVersion=(await db.query('show server_version_num')).rows[0].server_version_num;
 const serverMajor=Math.floor(Number(serverVersion)/10000);
 assert.ok([16,17].includes(serverMajor),'Disposable PostgreSQL 16 or 17 required');
 if(process.env.UID_TEST_PG_MAJOR) assert.equal(String(serverMajor),process.env.UID_TEST_PG_MAJOR,'CI matrix/server version mismatch');
 console.log(`Disposable PostgreSQL version: ${serverVersion} (major ${serverMajor})`);
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

  // A canonical merge changes an older blocked request's snapshot, making it
  // retryable before its cooldown. Untouched queued work must still go first.
  const blockedPreview=await newProposal(208),blockedClaim=await call('claim',[owner,'dot']);
  assert.equal(blockedClaim.proposal_id,id(208));
  const blockedReview={...await review(blockedClaim),decision:'blocked'};
  assert.equal((await complete(blockedClaim,blockedReview)).status,'blocked');
  assert.equal(await call('claim',[owner,'dot']),null,'unchanged blocked snapshot honors cooldown');
  await newProposal(209);
  const driftClaim=await call('claim',[owner,'dot']);assert.equal(driftClaim.proposal_id,id(209));
  const queuedPreviews=new Map();
  for(const n of [210,211,212])queuedPreviews.set(n,await newProposal(n));
  assert.equal((await complete(driftClaim,compile(driftClaim,await review(driftClaim)))).status,'merged');
  const blockedState=(await db.query(`select status,next_attempt_at>clock_timestamp() cooling_down
   from uid_rule_v3_private.requests where id=$1`,[blockedClaim.request_id])).rows[0];
  assert.deepEqual(blockedState,{status:'blocked',cooling_down:true});
  assert.equal((await call('preview',[id(208),owner])).intent_hash,blockedPreview.intent_hash,'unrelated merge preserves blocked intent');
  const driftedSnapshot=await call('snapshot',[await call('context',[id(208),owner]),owner]);
  assert.notEqual('sha256:'+hash(driftedSnapshot),blockedClaim.snapshot_hash,'canonical merge changes blocked snapshot');
  const queuedOrder=(await db.query(`select proposal_id from uid_rule_v3_private.requests
   where status='queued' and owner_user_id=$1 order by created_at,id`,[owner])).rows.map(x=>x.proposal_id);
  assert.deepEqual(queuedOrder,[210,211,212].map(id));
  const firstQueued=await call('claim',[owner,'dot']);
  assert.equal(firstQueued.proposal_id,id(210),'oldest queued request precedes older drifted blocked request');
  const queuedClaims=await Promise.all(clients.slice(0,2).map(c=>invoke(c,'claim',[owner,'dot'])));
  assert.deepEqual(queuedClaims.map(c=>c.proposal_id).sort(),[id(211),id(212)],'concurrent claimants drain queued work before retrying blocked work');
  const activeClaims=[firstQueued,...queuedClaims];
  assert.equal(new Set(activeClaims.map(c=>c.request_id)).size,3,'each queued request is claimed once');
  assert.equal(new Set(activeClaims.map(c=>c.lease_token)).size,3,'concurrent claims have distinct fenced tokens');
  assert.ok(activeClaims.every(c=>c.lease_version===1),'untouched queued requests receive their first lease');
  const blockedRetry=await call('claim',[owner,'dot']);
  assert.equal(blockedRetry.request_id,blockedClaim.request_id,'drifted blocked retry remains available once queue is drained');
  assert.equal(blockedRetry.lease_version,blockedClaim.lease_version+1);
  assert.notEqual(blockedRetry.lease_token,blockedClaim.lease_token);
  assert.notEqual(blockedRetry.snapshot_hash,blockedClaim.snapshot_hash);
  activeClaims.push(blockedRetry);
  const beforeLeases=(await db.query(`select id,lease_version,lease_token,lease_expires_at
   from uid_rule_v3_private.requests where id=any($1::uuid[]) order by id`,[activeClaims.map(c=>c.request_id)])).rows;
  assert.deepEqual(await Promise.all(clients.map(c=>invoke(c,'claim',[owner,'dot']))),[null,null,null],'no concurrent claimant may steal a live lease');
  assert.deepEqual((await db.query(`select id,lease_version,lease_token,lease_expires_at
   from uid_rule_v3_private.requests where id=any($1::uuid[]) order by id`,[activeClaims.map(c=>c.request_id)])).rows,beforeLeases);
  const attempts=(await db.query(`select request_id,count(*)::int n from uid_rule_v3_private.attempts
   where request_id=any($1::uuid[]) group by request_id`,[activeClaims.map(c=>c.request_id)])).rows;
  for(const c of activeClaims)assert.equal(attempts.find(a=>a.request_id===c.request_id).n,c.lease_version,'no extra attempts from competing claims');
  await call('cancel',[id(208),owner,blockedPreview.intent_hash,id(708)]);
  for(const [n,p] of queuedPreviews)await call('cancel',[id(n),owner,p.intent_hash,id(n+500)]);
  console.log('PASS queued-first after canonical drift, blocked retry after drain, concurrent unique claims and no live lease theft');

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

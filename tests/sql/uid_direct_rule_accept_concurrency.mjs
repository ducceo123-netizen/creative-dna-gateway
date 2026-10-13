// LOCAL disposable database only. Never accepts DATABASE_URL or remote hosts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const host=process.env.PGHOST||'127.0.0.1';
if(process.env.DATABASE_URL || !['localhost','127.0.0.1','::1'].includes(host))throw new Error('Disposable localhost database only');
const imported=await import(process.env.UID_TEST_PG_MODULE||'pg');
const {Client}=imported.default||imported;
const settings={host,port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD,database:process.env.PGDATABASE||'governance_test'};
const clients=Array.from({length:4},()=>new Client(settings));
const [setup,a,b,watch]=clients;
const owner='10000000-0000-0000-0000-000000000010';
const first='10000000-0000-0000-0000-000000000201';
const second='10000000-0000-0000-0000-000000000202';
const request=async(id)=>{
 const c=(await setup.query('select public.uid_rule_preflight($1,$2) c',[id,owner])).rows[0].c;
 const p=(await setup.query('select pg_temp.plan_for($1) p',[c])).rows[0].p;
 const h=(await setup.query("select encode(sha256(convert_to(public.uid_rule_stable_json($1),'UTF8')),'hex') h",[p])).rows[0].h;
 return [id,owner,c.candidate_hash,c.direct_rule.rule_hash,p,h];
};
const accept=(client,args)=>client.query('select public.uid_rule_accept($1,$2,$3,$4,$5,$6) result',args);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForLock(pid){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  const r=await watch.query('select wait_event_type from pg_stat_activity where pid=$1',[pid]);
  if(r.rows[0]?.wait_event_type==='Lock')return;
  await sleep(10);
 }
 throw new Error('Expected transaction lock wait was not observed');
}
try{
 for(const client of clients)await client.connect();
 const sql=fs.readFileSync(fileURLToPath(new URL('./uid_direct_rule_accept.sql',import.meta.url)),'utf8');
 await setup.query(sql.slice(0,sql.indexOf('-- Boundaries:'))+'\ncommit;');
 const bpid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 const args=await request(first);
 await a.query('begin');
 const firstResult=(await accept(a,args)).rows[0].result;
 const retry=accept(b,args);
 await waitForLock(bpid);await a.query('commit');
 assert.deepEqual((await retry).rows[0].result,firstResult);
 assert.equal((await setup.query('select count(*)::int n from uid_rule_private.decisions')).rows[0].n,1);
 assert.equal((await setup.query('select count(*)::int n from public.uid_governance_snapshots')).rows[0].n,6);
 console.log('PASS concurrent exact acceptance has one decision and byte-identical receipts');
 await setup.query("insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,raw_feedback,proposed_scope,evidence_summary) select $1,knowledge_node_id,brand_id,pg_temp.canonical('Use a second clear product-led headline content rule.'),raw_feedback,proposed_scope,evidence_summary from public.knowledge_proposals where id=$2",[second,first]);
 const nextArgs=await request(second);
 await a.query('begin');await a.query("update public.knowledge_nodes set content_md=content_md||E'\\nConcurrent source edit.' where id='10000000-0000-0000-0000-000000000101'");
 const stale=accept(b,nextArgs).then(()=>null,e=>e);
 await waitForLock(bpid);await a.query('commit');
 assert.match((await stale)?.message||'',/changed; refresh/);
 assert.equal((await setup.query('select count(*)::int n from uid_rule_private.decisions where proposal_id=$1',[second])).rows[0].n,0);
 console.log('PASS concurrent canonical edit makes displayed approval stale');
 const revocable=await request(second);
 await a.query('begin');await a.query('update public.creative_dna_team_members set is_active=false where user_id=$1',[owner]);
 const revoked=accept(b,revocable).then(()=>null,e=>e);
 await waitForLock(bpid);await a.query('commit');
 assert.match((await revoked)?.message||'',/verified owner Admin required/);
 await setup.query('update public.creative_dna_team_members set is_active=true where user_id=$1',[owner]);
 console.log('PASS concurrent membership revocation prevents merge');
 await a.query('begin');await a.query('update uid_rule_private.owner_config set enabled=false');
 const disabled=accept(b,revocable).then(()=>null,e=>e);
 await waitForLock(bpid);await a.query('commit');
 assert.match((await disabled)?.message||'',/verified owner Admin required/);
 assert.equal((await setup.query("select status from public.knowledge_proposals where id=$1",[second])).rows[0].status,'pending');
 console.log('PASS concurrent owner configuration revocation prevents merge');
 // A catalog-absent direct leaf still rejects newly active dependent children
 // under the same full canonical table lock and freshness identity.
 await setup.query('update uid_rule_private.owner_config set enabled=true');
 const leaf='10000000-0000-0000-0000-000000000198',child='10000000-0000-0000-0000-000000000197',leafProposal='10000000-0000-0000-0000-000000000203';
 await setup.query(`insert into public.knowledge_nodes(id,brand_id,slug,title,content_md,metadata,input_schema,version)
 values($1,'10000000-0000-0000-0000-000000000001','ldp-system','Synthetic leaf','Uncompiled leaf source','{"preserve":{"nested":[true,"original"]}}','{"required":["product"]}','2.7')`,[leaf]);
 await setup.query(`insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,raw_feedback,proposed_scope,evidence_summary)
 values($1,$2,'10000000-0000-0000-0000-000000000001',pg_temp.canonical('Use concise product-led LDP content.','Keep content tied to the supplied product.','Generic content.','LDP local','STRUCTURAL'),'Synthetic leaf approval','LDP local','{"admin_overview":{"rule_class":"STRUCTURAL"}}')`,[leafProposal,leaf]);
 const originalLeaf=(await setup.query('select to_jsonb(n) n from public.knowledge_nodes n where id=$1',[leaf])).rows[0].n;
 for(const scenario of ['insert','reactivate','reparent']){
  if(scenario!=='insert')await setup.query(`insert into public.knowledge_nodes(id,brand_id,parent_id,slug,title,status,metadata)
   values($1,'10000000-0000-0000-0000-000000000001',$2,'compiled-child','Synthetic dependency',$3,'{"creative_quality_contract":{"revision":"fixture"}}')`,[child,scenario==='reactivate'?leaf:null,scenario==='reactivate'?'inactive':'active']);
  const displayed=await request(leafProposal);assert.equal(displayed[4].targets.length,1);
  await a.query('begin');
  if(scenario==='insert')await a.query(`insert into public.knowledge_nodes(id,brand_id,parent_id,slug,title,metadata)
   values($1,'10000000-0000-0000-0000-000000000001',$2,'compiled-child','Synthetic dependency','{"creative_quality_contract":{"revision":"fixture"}}')`,[child,leaf]);
  else if(scenario==='reactivate')await a.query("update public.knowledge_nodes set status='active' where id=$1",[child]);
  else await a.query('update public.knowledge_nodes set parent_id=$2 where id=$1',[child,leaf]);
  const rejected=accept(b,displayed).then(()=>null,e=>e);
  await waitForLock(bpid);await a.query('commit');
  assert.match((await rejected)?.message||'',/changed; refresh/);
  const refreshed=(await setup.query('select public.uid_rule_preflight($1,$2) c',[leafProposal,owner])).rows[0].c;
  assert.equal(refreshed.direct_rule.eligible,false);assert.ok(refreshed.direct_rule.blockers.some(x=>x.code==='unsupported_dependency_scope'));
  assert.equal(refreshed.compiler_context.dependent_nodes.length,1);
  assert.deepEqual((await setup.query('select to_jsonb(n) n from public.knowledge_nodes n where id=$1',[leaf])).rows[0].n,originalLeaf);
  const counts=(await setup.query(`select
   (select count(*)::int from uid_rule_private.decisions where proposal_id=$1) decisions,
   (select count(*)::int from public.uid_governance_snapshots where proposal_id=$1) snapshots,
   (select count(*)::int from public.training_events where parsed_payload->>'proposal_id'=$1::text) events`,[leafProposal])).rows[0];
  assert.deepEqual(counts,{decisions:0,snapshots:0,events:0});
  assert.equal((await setup.query('select status from public.knowledge_proposals where id=$1',[leafProposal])).rows[0].status,'pending');
  await setup.query('delete from public.knowledge_nodes where id=$1',[child]);
  console.log('PASS uncompiled leaf child '+scenario+' wins against acceptance with zero canonical writes');
 }
 // Once the scope really is a leaf, exact concurrent direct retries still have
 // one append, one decision and one snapshot pair, with unchanged metadata.
 const leafArgs=await request(leafProposal);await a.query('begin');
 const leafResult=(await accept(a,leafArgs)).rows[0].result;
 const leafRetry=accept(b,leafArgs);await waitForLock(bpid);await a.query('commit');
 assert.deepEqual((await leafRetry).rows[0].result,leafResult);
 const finalLeaf=(await setup.query('select to_jsonb(n) n from public.knowledge_nodes n where id=$1',[leaf])).rows[0].n;
 assert.equal(finalLeaf.content_md,leafArgs[4].targets[0].content_md);
 const unchanged=n=>Object.fromEntries(Object.entries(n).filter(([k])=>!['content_md','updated_at'].includes(k)));
 assert.deepEqual(unchanged(finalLeaf),unchanged(originalLeaf));
 assert.equal((await setup.query('select count(*)::int n from uid_rule_private.decisions where proposal_id=$1',[leafProposal])).rows[0].n,1);
 assert.equal((await setup.query('select count(*)::int n from public.uid_governance_snapshots where proposal_id=$1',[leafProposal])).rows[0].n,2);
 console.log('PASS concurrent genuine leaf acceptance is an exact append once with preserved metadata');

} finally {
 for(const client of clients){try{await client.query('rollback');}catch{}try{await client.end();}catch{}}
}

// Disposable PostgreSQL only. Run after uid_direct_rule_accept_concurrency.mjs,
// which installs the inspected legacy merger/trigger fixture. No live URLs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const host=process.env.PGHOST||'127.0.0.1';
if(process.env.DATABASE_URL||!['localhost','127.0.0.1','::1'].includes(host)||process.env.PGDATABASE!=='governance_test')throw Error('Disposable localhost governance_test required');
const imported=await import(process.env.UID_TEST_PG_MODULE||'pg');const {Client}=imported.default||imported;
const settings={host,port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD,database:'governance_test'};
const clients=Array.from({length:5},()=>new Client(settings)),[setup,a,b,gate,watch]=clients;
const id=n=>'81000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=id(10),other=id(11),brand=id(1),p=n=>id(200+n),r=n=>id(800+n);
const value=async(client,sql,args=[])=>(await client.query(sql,args)).rows[0].value;
const call=(client,fn,args)=>value(client,`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args);
const recover=(client,proposal,recovery)=>call(client,'uid_rule_recover',[proposal,owner,recovery]);
const accept=(client,args,token)=>call(client,token===undefined?'uid_rule_accept':'uid_rule_accept_fenced',token===undefined?args:[...args,token]);
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
const canonical=(n)=>`## Generalized Rule\nUse product-specific hero headline content number ${n}.\n\n## Expected Behavior\nKeep the headline specific to supplied product facts.\n\n## Reject Conditions\n- Generic headings without product facts.\n\n## Scope\nHero local\n\n## Rule Class\nSTRUCTURAL\n\n## Confidence\nHIGH`;
const state=()=>value(setup,`select jsonb_build_object('nodes',(select jsonb_agg(to_jsonb(n) order by id) from public.knowledge_nodes n where brand_id=$1),'snapshots',(select count(*) from public.uid_governance_snapshots where proposal_id=any($2::uuid[])),'decisions',(select count(*) from uid_rule_private.decisions where proposal_id=any($2::uuid[])),'events',(select count(*) from public.training_events where parsed_payload->>'proposal_id'=any($3::text[]))) value`,[brand,Array.from({length:9},(_,n)=>p(n)),Array.from({length:9},(_,n)=>p(n))]);
async function request(proposal){
 const c=await call(setup,'uid_rule_preflight',[proposal,owner]);
 assert.equal(c.direct_rule.eligible,true,JSON.stringify(c.direct_rule.blockers));
 const plan=await value(setup,`select jsonb_build_object('schema_version','uid.owner-rule-plan.v1','candidate_hash',$1::jsonb->'candidate_hash','rule_hash',$1::jsonb#>'{direct_rule,rule_hash}','targets',(select jsonb_agg(jsonb_build_object('node_id',t->'id','content_md',t->'content_md','metadata',t->'metadata','version',t->'version','input_schema',t->'input_schema','status',t->'status','confidence',t->'confidence') order by t->>'id') from jsonb_array_elements($1::jsonb#>'{compiler_context,projected_targets}') t)) value`,[c]);
 const hash=await value(setup,"select encode(sha256(convert_to(public.uid_rule_stable_json($1),'UTF8')),'hex') value",[plan]);
 return [proposal,owner,c.candidate_hash,c.direct_rule.rule_hash,plan,hash];
}
async function waiting(pid){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){if(await value(watch,"select coalesce(wait_event_type='Lock',false) value from pg_stat_activity where pid=$1",[pid]))return;await new Promise(r=>setTimeout(r,10));}
 throw Error('Expected actual PostgreSQL transaction lock wait');
}
try{
 for(const c of clients)await c.connect();
 const bpid=await value(b,'select pg_backend_pid() value');
 await setup.query('insert into public.brands(id,slug,name) values($1,$2,$3)',[brand,'recovery-test','Recovery test']);
 await setup.query("insert into public.creative_dna_team_members(user_id,role,is_active) values($1,'admin',true),($2,'admin',true)",[owner,other]);
 await setup.query("update uid_rule_private.owner_config set owner_user_id=$1,enabled=true,verified_at=now(),verification_reference='Synthetic owner recovery test only'",[owner]);
 for(let n=0;n<9;n++){
  await setup.query("insert into public.knowledge_nodes(id,brand_id,slug,title,content_md,metadata) values($1,$2,$3,'Synthetic hero','Keep supplied product facts.','{}')",[id(100+n),brand,['home-hero','ldp-system','ldp-hero','ugc-image','recipient-image','seasonal-banner','shop-by-product-image','shop-by-categories','niche-product-combo'][n]]);
  await setup.query("insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,proposed_content_md,raw_feedback,proposed_scope,evidence_summary) values($1,$2,$3,$4,'Synthetic recovery test','Hero local','{\"admin_overview\":{\"rule_class\":\"STRUCTURAL\"}}')",[p(n),id(100+n),brand,canonical(n)]);
 }
 // Keep each exact legacy body as a test-only RPC. It contains NO early fence
 // check and models a call already executing before migration replacement.
 const source=readFileSync(new URL('../../supabase/migrations/20261013035848_uid_owner_direct_rule_accept.sql',import.meta.url),'utf8');
 let legacy=source.slice(source.indexOf('create function public.uid_rule_accept('),source.indexOf('revoke all on function public.uid_rule_accept('));
 legacy=legacy.replace('public.uid_rule_accept(','public.uid_rule_accept_legacy_inflight(');
 await setup.query(legacy);await setup.query('revoke all on function public.uid_rule_accept_legacy_inflight(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated');
 const paused=legacy.replaceAll('uid_rule_accept_legacy_inflight','uid_rule_accept_legacy_paused').replace(' lock table public.knowledge_nodes',' perform pg_advisory_xact_lock(817364);\n lock table public.knowledge_nodes');
 await setup.query(paused);await setup.query('revoke all on function public.uid_rule_accept_legacy_paused(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated');
 for(const c of [a,b])await c.query('set role service_role');
 for(const role of ['anon','authenticated'])for(const fn of ['uid_rule_recover(uuid,uuid,uuid)','uid_rule_accept_fenced(uuid,uuid,text,text,jsonb,text,uuid)'])
  assert.equal(await value(setup,'select has_function_privilege($1,$2,\'EXECUTE\') value',[role,'public.'+fn]),false);
 for(const table of ['recovery_fences','recovery_requests'])assert.equal(await value(setup,'select has_table_privilege(\'service_role\',$1,\'SELECT\') value',['uid_rule_private.'+table]),false);
 const before=await state();
 await a.query('begin isolation level repeatable read');
 await assert.rejects(recover(a,p(0),r(1)),/READ COMMITTED isolation/);await a.query('rollback');
 await assert.rejects(call(a,'uid_rule_recover',[p(0),other,r(1)]),/verified owner/);
 await assert.rejects(call(a,'uid_rule_recover',[p(0),owner,null]),/request id/);
 const initialArgs=await request(p(0));
 const first=await recover(a,p(0),r(1));assert.equal(first.status,'fenced_not_applied');
 assert.deepEqual(await recover(b,p(0),r(1)),first,'lost response replay returns exactly the same fence');
 const second=await recover(a,p(0),r(2));assert.notEqual(second.recovery_token,first.recovery_token);
 assert.equal((await recover(b,p(0),r(1))).status,'superseded','old recovery cannot rotate a newer fence');
 assert.equal(await value(setup,'select recovery_token::text value from uid_rule_private.recovery_fences where proposal_id=$1',[p(0)]),second.recovery_token);
 assert.deepEqual(await value(setup,'select result value from uid_rule_private.recovery_requests where recovery_id=$1',[r(1)]),first,'request ledger remains immutable');
 await assert.rejects(accept(b,initialArgs),/recovery fence/);
 await assert.rejects(accept(b,initialArgs,first.recovery_token),/recovery fence/);
 await assert.rejects(call(setup,'uid_rule_accept_legacy_inflight',initialArgs),/stale acceptance rolled back/);
 assert.deepEqual(await state(),before,'fencing and rejected legacy body have zero canonical/audit effects');
 await setup.query('begin isolation level repeatable read');
 await assert.rejects(call(setup,'uid_rule_accept_legacy_inflight',initialArgs),/READ COMMITTED isolation/);await setup.query('rollback');
 assert.deepEqual(await state(),before,'unsupported isolation cannot commit the original old body');
 const fresh=await request(p(0));const committed=await accept(a,fresh,second.recovery_token);
 assert.equal(committed.owner_user_id,owner);assert.deepEqual(await accept(b,fresh),committed,'committed exact retry precedes fence checks');
 const recovered=await recover(b,p(0),r(1));assert.equal(recovered.status,'merged');assert.deepEqual(recovered.receipt,committed,'recovery needs no lost client hashes');
 await assert.rejects(recover(b,p(1),r(1)),/Conflicting recovery request identity/);
 await assert.rejects(setup.query("update uid_rule_private.recovery_requests set result='{}' where recovery_id=$1",[r(1)]),/immutable/);
 console.log('PASS owner authorization, ACLs, immutable replay/supersession, legacy fence and committed receipt recovery');

 // Recovery must wait until an old approval actually commits before choosing
 // a terminal outcome. It cannot infer not-applied from an unlocked preview.
 await a.query('begin');const args1=await request(p(1)),done1=await accept(a,args1);
 const recoveryRace=outcome(recover(b,p(1),r(3)));await waiting(bpid);await a.query('commit');
 assert.deepEqual((await recoveryRace).value.receipt,done1);
 assert.equal(await value(setup,'select count(*)::int value from uid_rule_private.recovery_fences where proposal_id=$1',[p(1)]),0);
 console.log('PASS accept-first race returns the committed receipt after waiting');

 await a.query('begin');const args2=await request(p(2)),fence2=await recover(a,p(2),r(4));
 const delayed=outcome(accept(b,args2));await waiting(bpid);await a.query('commit');assert.match((await delayed).error?.message||'',/recovery fence/);
 assert.equal((await call(setup,'uid_rule_preflight',[p(2),owner])).recovery_token,fence2.recovery_token);
 console.log('PASS recovery-first race fences delayed legacy six-argument acceptance');

 // Start ORIGINAL old code before recovery, paused immediately before the
 // canonical table lock. Recovery commits first; late old-code writes roll back
 // at the immutable decision trigger rather than escaping the new fence.
 const args3=await request(p(3)),before3=await state();
 await gate.query('select pg_advisory_lock(817364)');
 const oldInFlight=outcome(call(setup,'uid_rule_accept_legacy_paused',args3));
 // setup is busy, so obtain its PID through pg_stat_activity by the known SQL.
 let oldPid;const until=Date.now()+10000;
 while(Date.now()<until){const rows=(await watch.query("select pid from pg_stat_activity where query like 'select public.uid_rule_accept_legacy_paused%' and wait_event_type='Lock'")).rows;if(rows.length){oldPid=rows[0].pid;break;}await new Promise(r=>setTimeout(r,10));}
 assert.ok(oldPid,'original old function is blocked before its table lock');
 await recover(b,p(3),r(5));await gate.query('select pg_advisory_unlock(817364)');
 assert.match((await oldInFlight).error?.message||'',/stale acceptance rolled back/);assert.deepEqual(await state(),before3);
 console.log('PASS deployment-window original in-flight body cannot commit after recovery');

 const f4=await recover(a,p(4),r(6)),args4=await request(p(4));await a.query('begin');const done4=await accept(a,args4,f4.recovery_token);
 const currentRace=outcome(recover(b,p(4),r(7)));await waiting(bpid);await a.query('commit');assert.deepEqual((await currentRace).value.receipt,done4);
 const f5=await recover(a,p(5),r(8)),args5=await request(p(5));await a.query('begin');await recover(a,p(5),r(9));
 const staleRace=outcome(accept(b,args5,f5.recovery_token));await waiting(bpid);await a.query('commit');assert.match((await staleRace).error?.message||'',/recovery fence/);
 console.log('PASS current token accept/recovery races resolve only to receipt or fenced rejection');

 await a.query('begin');const f6=await recover(a,p(6),r(10));const duplicate=outcome(recover(b,p(6),r(10)));await waiting(bpid);await a.query('commit');
 assert.deepEqual((await duplicate).value,f6);assert.equal(await value(setup,'select count(*)::int value from uid_rule_private.recovery_requests where recovery_id=$1',[r(10)]),1);
 console.log('PASS concurrent duplicate recovery preserves one immutable generation');
 for(const [n,status] of [[7,'rejected'],[8,'resolved']]){
  // The real schema couples resolved status to a non-null immutable resolution
  // audit. Supply synthetic audit data instead of weakening that constraint.
  await setup.query("update public.knowledge_proposals set status=$2,resolution=case when $2='resolved' then jsonb_build_object('synthetic_fixture',true,'resolution_kind','already_covered','covered_proposal_id',$3::text) else null end where id=$1",[p(n),status,p(0)]);
  const terminal=await recover(b,p(n),r(11+n));assert.equal(terminal.status,status);assert.equal(terminal.canonical_changed,false);
 }
 console.log('PASS closed proposals recover without approval or canonical writes');
}finally{
 try{await gate.query('select pg_advisory_unlock_all()');}catch{}
 for(const c of clients){try{await c.query('rollback');}catch{}try{await c.end();}catch{}}
}

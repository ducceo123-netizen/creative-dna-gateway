/** Disposable PostgreSQL only. Exact historical/new preflight output parity. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const migration='20261020052010_uid_review_preflight_reuse_context.sql';
let db,exec;
if(process.env.UID_TEST_PGLITE_MODULE){
 const {PGlite}=await import(process.env.UID_TEST_PGLITE_MODULE);db=new PGlite();exec=s=>db.exec(s);
 await exec(readFileSync(root+'tests/sql/governance_fixture.sql','utf8'));
 for(const f of readdirSync(root+'supabase/migrations').filter(f=>f.endsWith('.sql')&&f!==migration).sort())await exec(readFileSync(root+'supabase/migrations/'+f,'utf8'));
}else{
 const host=process.env.PGHOST||'localhost';
 if(!['localhost','127.0.0.1','::1'].includes(host)||process.env.DATABASE_URL||process.env.PGDATABASE!=='governance_test')throw Error('Disposable localhost governance_test required');
 const {default:pg}=await import(process.env.UID_TEST_PG_MODULE||'pg');db=new pg.Client({host});await db.connect();exec=s=>db.query(s);
}
const val=async(s,args=[])=>(await db.query(s,args)).rows[0].value;
const id=n=>'21000000-0000-0000-0000-'+String(n).padStart(12,'0');
const owner=id(10),other=id(11),proposal=id(201);
const permissions=()=>val("select jsonb_build_object('acl',proacl,'owner',proowner,'definer',prosecdef,'config',proconfig,'volatility',provolatile) value from pg_proc where oid='uid_rule_private.review_preflight_snapshot(uuid,uuid)'::regprocedure");
let comparisons=0;
async function compare(pid=proposal){
 // Both functions run in the same SQL statement, including expiration decisions.
 const r=(await db.query('select pg_temp.old_preflight($1,$2) old,uid_rule_private.review_preflight_snapshot($1,$2) new',[pid,owner])).rows[0];
 assert.deepEqual(r.new,r.old,'Complete preflight object and all nested hashes must remain identical');
 if(r.new){
  const intent=await val('select public.uid_review_digest(public.uid_review_intent($1,$2)) value',[pid,owner]);
  assert.equal(r.new.review_intent_hash,intent,'Current authoritative v2 intent digest');
  assert.deepEqual(r.new.scope.target_node_ids,r.old.scope.target_node_ids);
  assert.equal(r.new.direct_rule.rule_hash,r.old.direct_rule.rule_hash);
 }
 comparisons++;return r.new;
}
try{
 await exec('begin');
 const historical=readFileSync(root+'supabase/migrations/20261013043157_uid_review_configured_owner_boundary.sql','utf8');
 const old=historical.slice(historical.indexOf('create function uid_rule_private.review_preflight_snapshot'),historical.indexOf('revoke all on function uid_rule_private.review_preflight_snapshot')).replace('uid_rule_private.review_preflight_snapshot','pg_temp.old_preflight');
 await exec(old);
 const acl=await permissions();
 await exec(readFileSync(root+'supabase/migrations/'+migration,'utf8'));
 assert.deepEqual(await permissions(),acl,'CREATE OR REPLACE preserves owner/ACL/security/search_path/volatility');
 await db.query("insert into public.creative_dna_team_members(user_id,role,is_active) values($1,'admin',true),($2,'admin',true)",[owner,other]);
 await db.query("insert into uid_rule_private.owner_config(owner_user_id,verified_at,verification_reference,enabled) values($1,now(),'synthetic context-reuse test',true)",[owner]);
 for(const [n,slug,name] of [[1,'pawfecthouse','PawfectHouse'],[2,'giftsoul','GiftSoul'],[3,'soulprise','SoulPrise']]){
  await db.query('insert into public.brands(id,slug,name) values($1,$2,$3)',[id(n),slug,name]);
  await db.query("insert into public.knowledge_nodes(id,brand_id,slug,title,content_md,metadata) values($1,$2,'onepage-system','Synthetic Onepage',$3,$4)",[id(100+n),id(n),'Canonical content. Preserve desktop pretext.\n'.repeat(200),{untouched_fixture:'unchanged'.repeat(200)}]);
 }
 const rule='## Generalized Rule\nDo not add an independent subtitle.\n\n## Expected Behavior\nPreserve desktop pretext.\n\n## Reject Conditions\n- Independent subtitle.\n\n## Scope\nShared Onepage structure\n\n## Rule Class\nSTRUCTURAL\n\n## Confidence\nHIGH';
 await db.query('insert into public.knowledge_proposals(id,knowledge_node_id,brand_id,raw_feedback,proposed_scope,proposed_content_md) values($1,$2,$3,$4,$5,$6)',[proposal,id(101),id(1),'Synthetic subtitle feedback','Shared Onepage structure',rule]);
 let r=await compare();assert.equal(r.targets.length,3);
 await compare(id(999)); // Missing proposal keeps SQL NULL behavior.
 await db.query("update public.knowledge_nodes set status='inactive' where id=$1",[id(103)]);
 r=await compare();assert.equal(r.targets.length,3,'Inactive mirror retained in actual trigger closure');
 await db.query("update public.knowledge_nodes set status='active' where id=$1",[id(103)]);
 await db.query('update public.knowledge_proposals set proposed_content_md=null,raw_feedback=null,proposed_version=null,change_summary=null,brand_id=null where id=$1',[proposal]);
 await compare(); // JSON nulls stay hash-identical.
 await db.query('update public.knowledge_proposals set proposed_content_md=$1,raw_feedback=$2,brand_id=$3 where id=$4',[rule,'Synthetic subtitle feedback',id(1),proposal]);
 const intent=await val('select public.uid_review_digest(public.uid_review_intent($1,$2)) value',[proposal,owner]);
 await val('select public.uid_review_enqueue($1,$2,$3) value',[proposal,owner,intent]);
 r=await compare();assert.ok(r.review_request);
 await db.query("insert into public.knowledge_proposals select (jsonb_populate_record(null::public.knowledge_proposals,to_jsonb(p)||jsonb_build_object('id',$2::uuid))).* from public.knowledge_proposals p where id=$1",[proposal,id(202)]);
 // Synthetic expired initial request, only in this disposable rollback fixture.
 await db.query("select set_config('uid.review_action','enqueue',true)");
 await db.query("insert into public.uid_review_requests select (jsonb_populate_record(null::public.uid_review_requests,to_jsonb(q)||jsonb_build_object('id',$2::uuid,'proposal_id',$3::uuid,'intent',public.uid_review_intent($3,$4),'intent_hash',public.uid_review_digest(public.uid_review_intent($3,$4)),'status','blocked','expires_at',statement_timestamp()-interval '1 hour','created_at',statement_timestamp()-interval '2 hours'))).* from public.uid_review_requests q where q.id=$1",[r.review_request.id,id(301),id(202),owner]);
 await db.query("select set_config('uid.review_action','',true)");
 r=await compare(id(202));assert.equal(r.review_request.status,'expired');
 await db.query("update public.knowledge_nodes set slug='home-hero' where id=$1",[id(101)]);
 await db.query("update public.knowledge_proposals set proposed_scope='PawfectHouse home hero' where id=$1",[proposal]);
 r=await compare();assert.equal(r.targets.length,1,'Single-brand branch scope unchanged');
 for(const actor of [other,id(999)]){
  await exec('savepoint denial');
  await assert.rejects(db.query('select public.uid_review_preflight($1,$2)',[proposal,actor]),/Enabled verified configured owner required|Active admin required/);
  await exec('rollback to savepoint denial');
 }
 const source=readFileSync(root+'supabase/migrations/'+migration,'utf8');
 assert.equal((source.match(/context:=public\.uid_rule_context\(p_proposal_id\)/g)||[]).length,1);
 assert.ok(!source.includes('public.uid_review_intent('),'No nested context reconstruction');
 assert.ok(source.includes('public.uid_rule_eligibility(context,p_actor_user_id)'),'Full eligibility/compiler check retained');
 console.log(`PASS ${comparisons} complete historical/new preflight comparisons, exact intent/rule hashes, trigger closure, nulls, latest/expired request, owner denial, and unchanged function privileges`);
}finally{await exec('rollback');await db.close?.();await db.end?.();}

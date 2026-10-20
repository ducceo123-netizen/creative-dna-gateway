/** Isolated historical/new full eligibility parity and normalization cost. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const migration='20261020052603_uid_rule_cache_normalized_clauses.sql';
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
const owner='22000000-0000-0000-0000-000000000010';
const canonical=(generalized,expected='Maintain the current desktop pretext.')=>`## Generalized Rule\n${generalized}\n\n## Expected Behavior\n${expected}\n\n## Reject Conditions\n- Unsupported product claims.\n\n## Scope\nPawfectHouse hero\n\n## Rule Class\nSTRUCTURAL\n\n## Confidence\nHIGH`;
const context=(rule,text)=>({proposal:{id:'22000000-0000-0000-0000-000000000201',status:'pending',proposed_content_md:rule,proposed_scope:'PawfectHouse hero'},candidate_hash:'synthetic-candidate',scope:{branch_slug:'home-hero',cross_brand:false},targets:[{id:'22000000-0000-0000-0000-000000000101',brand_id:'22000000-0000-0000-0000-000000000001',brand_slug:'pawfecthouse',content_md:text}],compiler_context:{owner_user_id:owner,dependent_nodes:[]}});
let count=0;
async function compare(c,actor=owner){
 const r=(await db.query('select pg_temp.old_eligibility($1,$2) old,public.uid_rule_eligibility($1,$2) new',[c,actor])).rows[0];
 assert.deepEqual(r.new,r.old,'Full eligibility result, ordered blockers and rule hash must match');count++;return r.new;
}
try{
 await exec('begin');
 const historical=readFileSync(root+'supabase/migrations/20261013035848_uid_owner_direct_rule_accept.sql','utf8');
 await exec(historical.slice(historical.indexOf('create function public.uid_rule_eligibility'),historical.indexOf('revoke all on function public.uid_rule_eligibility')).replace('public.uid_rule_eligibility','pg_temp.old_eligibility'));
 const attrs="select jsonb_build_object('acl',proacl,'owner',proowner,'definer',prosecdef,'config',proconfig,'volatility',provolatile) value from pg_proc where oid='public.uid_rule_eligibility(jsonb,uuid)'::regprocedure";
 const before=await val(attrs);await exec(readFileSync(root+'supabase/migrations/'+migration,'utf8'));assert.deepEqual(await val(attrs),before);
 await db.query("insert into public.creative_dna_team_members(user_id,role,is_active) values($1,'admin',true)",[owner]);
 await db.query("insert into uid_rule_private.owner_config(owner_user_id,verified_at,verification_reference,enabled) values($1,now(),'synthetic normalization test',true)",[owner]);
 const positive='Preserve the verified main headline';
 for(const prefix of ['never ','do not ','must not ','không ']){
  for(const decoration of ['', '# * - ', '\n\n']){
   let r=await compare(context(canonical(positive),`${decoration}${prefix}${positive.toUpperCase()}   \n${prefix}${positive}.`));
   assert.equal(r.blockers.filter(x=>x.code==='canonical_conflict').length,1,'Duplicate prior conflicts add one blocker per candidate');
   r=await compare(context(canonical(prefix+positive),`${decoration}${positive}`));assert.ok(r.blockers.some(x=>x.code==='canonical_conflict'));
  }
 }
 for(const text of ['',null,' \t\n.\n','No contradictory text.','### preserve   the\tverified main headline.','never tiny.','KhÔnG GiỮ nguyên tiêu đề chính.']){
  await compare(context(canonical(positive),text));
 }
 let c=context(canonical(positive+'. '+positive,positive),`never ${positive}`);
 c.targets.push({...c.targets[0],id:'22000000-0000-0000-0000-000000000102',brand_id:'22000000-0000-0000-0000-000000000002'});
 let r=await compare(c);assert.equal(r.blockers.filter(x=>x.code==='canonical_conflict').length,6,'Repeated candidate clauses and targets preserve blocker multiplicity/order');
 await compare(context(canonical('tiny'),null));
 await compare(context('malformed canonical',positive));
 await compare(context(canonical(positive),positive),'22000000-0000-0000-0000-000000000099');
 await compare({...c,targets:[]});
 // Large canonical body and many candidate clauses expose repeated regex cost.
 const large=context(canonical(Array.from({length:20},(_,i)=>`Preserve distinct verified headline wording number ${i}`).join('. ')),('Canonical product context with ordinary whitespace.\n').repeat(1200));
 await compare(large);
 const t0=performance.now();await val('select pg_temp.old_eligibility($1,$2) value',[large,owner]);const oldMs=performance.now()-t0;
 const t1=performance.now();await val('select public.uid_rule_eligibility($1,$2) value',[large,owner]);const newMs=performance.now()-t1;
 console.log(`PASS ${count} exact eligibility comparisons and unchanged privileges; large fixture old=${oldMs.toFixed(1)}ms new=${newMs.toFixed(1)}ms`);
}finally{await exec('rollback');await db.close?.();await db.end?.();}

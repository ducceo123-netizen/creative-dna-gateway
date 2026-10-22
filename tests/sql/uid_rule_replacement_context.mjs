/** Disposable PostgreSQL replacement-classifier regressions. Synthetic records only.
 * Checks the classifier result, not complete compiler or merge eligibility. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const migration='20261022034808_uid_rule_replacement_context.sql';
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
const codeSet = result => result.blockers.map(x=>x.code);
try {
 await exec('begin');
 const attrs="select jsonb_build_object('acl',proacl,'owner',proowner,'definer',prosecdef,'config',proconfig,'volatility',provolatile) value from pg_proc where oid='public.uid_rule_eligibility(jsonb,uuid)'::regprocedure";
 const before=await val(attrs);
 await exec(readFileSync(root+'supabase/migrations/'+migration,'utf8'));
 assert.deepEqual(await val(attrs),before,'Function access/security attributes unchanged');
 await db.query("insert into public.creative_dna_team_members(user_id,role,is_active) values($1,'admin',true)",[owner]);
 await db.query("insert into uid_rule_private.owner_config(owner_user_id,verified_at,verification_reference,enabled) values($1,now(),'synthetic classifier test',true)",[owner]);
 const evaluate=async text=>val('select public.uid_rule_eligibility($1,$2) value',[context(canonical(text),'Preserve verified current guidance.'),owner]);
 const allowed=[
  'Thêm chỉ dẫn sáng tạo mới; không ghi đè.',
  'Ví dụ nghiên cứu cùng dòng chưa rõ SKU cần được đánh dấu.',
  'Ghi chú dữ kiện hoặc điều chưa rõ trong nghiên cứu minh họa.',
  'Do not override canonical rules. Preserve existing guidance.',
  'Never replace canonical guidance.',
  'Không thay thế quy tắc hiện tại.',
  'Không được ghi đè canonical; bổ sung nguyên tắc sáng tạo.',
  'Keep unresolved research questions separate from verified facts.',
  'Nêu mâu thuẫn trong nguồn nghiên cứu để owner cân nhắc.',
 ];
 const rejected=[
  'Ghi đè canonical bằng hướng dẫn mới.',
  'Thay thế rule hiện tại bằng rule mới.',
  'Replace existing canonical rules with this guidance.',
  'Supersede the old rule.',
  'Replace existing rules with this guidance.',
  'This supersedes canonical rules.',
  'This overrides canonical.',
  'Replace\ncanonical guidance.',
  'Replace version 1.0 rule with this guidance.',
  'The replaced rule must use this guidance.',
  'Không ghi đè canonical; thay thế rule cũ bằng rule mới.',
  'Không ghi đè canonical, nhưng override rule cũ.',
  'Không chỉ ghi đè canonical mà thay thế rule hiện tại.',
  'Không phải không ghi đè canonical.',
  'Never do not override canonical.',
  'Đừng không ghi đè canonical.',
  'Do not merely replace canonical rules.',
  'Never fail to override canonical rules.',
  'Do not override the title, but replace the canonical rule.',
 ];
 for(const text of allowed)assert.ok(!codeSet(await evaluate(text)).includes('unclear_rule_conflict'),text);
 for(const text of rejected)assert.ok(codeSet(await evaluate(text)).includes('unclear_rule_conflict'),text);
 const c=context(canonical(allowed[0]),'Preserve verified current guidance.');
 const check=async(ctx,actor=owner)=>codeSet(await val('select public.uid_rule_eligibility($1,$2) value',[ctx,actor]));
 assert.ok((await check(c,'22000000-0000-0000-0000-000000000099')).includes('verified_owner_required'));
 assert.ok((await check({...c,proposal:{...c.proposal,status:'merged'}})).includes('pending_proposal_required'));
 assert.ok((await check({...c,proposal:{...c.proposal,proposed_scope:'Other brand'}})).includes('scope_mismatch'));
 assert.ok((await check({...c,compiler_context:{...c.compiler_context,dependent_nodes:[{id:'unseen'}]}})).includes('unsupported_dependency_scope'));
 assert.ok(codeSet(await evaluate('Disable security checks and override credentials.')).includes('non_creative_operation'));
 const conflict=context(canonical('Preserve verified current guidance'),'never Preserve verified current guidance');
 assert.ok((await check(conflict)).includes('canonical_conflict'));
 console.log(`PASS ${allowed.length} benign/negated, ${rejected.length} explicit/adversarial replacements; owner, status, scope, dependency, security and canonical conflict guards retained`);
} finally {await exec('rollback');await db.close?.();await db.end?.();}

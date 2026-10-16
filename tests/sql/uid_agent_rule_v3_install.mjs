/** Disposable CI cluster only: executes the exact disabled deployment body in a separate empty database. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const {default:pg}=await import(process.env.UID_TEST_PG_MODULE||'pg');
const host=process.env.PGHOST||'localhost';
if(!['localhost','127.0.0.1','::1'].includes(host)||process.env.DATABASE_URL||process.env.PGDATABASE!=='governance_test')throw Error('Disposable localhost governance_test cluster required');
const root=fileURLToPath(new URL('../../',import.meta.url));
const control=new pg.Client({host});await control.connect();
const db=new pg.Client({host,database:'governance_deploy_test'});
try{
 await control.query('create database governance_deploy_test');await db.connect();
 const version=Number((await db.query('show server_version_num')).rows[0].server_version_num);
 assert.ok([16,17].includes(Math.floor(version/10000)));assert.equal(String(Math.floor(version/10000)),process.env.UID_TEST_PG_MAJOR);
 const fixture=readFileSync(root+'tests/sql/governance_fixture.sql','utf8').replace(/^create role (anon|authenticated|service_role)[^;]*;\n/gm,'');
 await db.query(fixture);
 for(const f of readdirSync(root+'supabase/migrations').filter(x=>x.endsWith('.sql')).sort())await db.query(readFileSync(root+'supabase/migrations/'+f,'utf8'));
 const owner='cf6721f5-86ce-46c2-8a1b-3c6ddabc64c6';
 await db.query("insert into public.creative_dna_team_members(user_id,role,is_active) values($1,'admin',true)",[owner]);
 await db.query("insert into uid_rule_private.owner_config(owner_user_id,verified_at,verification_reference,enabled) values($1,now(),'DISPOSABLE INSTALL TEST ONLY',true)",[owner]);
 const sql=readFileSync(root+'supabase/deploy/uid_rule_review_v3_install_disabled.sql','utf8');
 for(const n of ['foundation','context','queue','finalize']){
  const p=`tests/sql/prototypes/uid_agent_rule_v3_${n}.sql`,bytes=readFileSync(root+p);assert.ok(sql.includes(`-- SOURCE SHA256 ${createHash('sha256').update(bytes).digest('hex')} ${p}\n${bytes.toString()}`),'Install/prototype source drift');
 }
 await db.query(sql);
 assert.equal(Number((await db.query('select count(*) n from uid_rule_v3_private.release')).rows[0].n),0);
 assert.equal(Number((await db.query('select count(*) n from uid_rule_v3_private.requests')).rows[0].n),0);
 const acl=(await db.query("select p.oid::regprocedure::text fn,has_function_privilege('service_role',p.oid,'execute') server,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'uid_rule_review_v3_%'")).rows;
 assert.equal(acl.length,7);assert.ok(acl.every(x=>!x.server&&!x.anon&&!x.authenticated));
 assert.equal((await db.query("select has_schema_privilege('service_role','uid_rule_v3_private','usage') allowed")).rows[0].allowed,false);
 const before=(await db.query('select row_to_json(c) value from uid_rule_private.owner_config c')).rows[0].value;assert.equal(before.owner_user_id,owner);assert.equal(before.enabled,true);
 await assert.rejects(db.query(sql),/V3 already exists/);await db.query('rollback');
 console.log('PASS exact disabled installation transaction, source binding, empty release/queue, revoked facades and replay guard');
}finally{await db.end();await control.end();}

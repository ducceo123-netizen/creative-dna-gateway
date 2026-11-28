import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { OAUTH_TEST_ORIGIN, OAUTH_TEST_REF, parseOAuthActivation, prepareOAuthPolicy, oauthActivationConfiguration } from './oauth-activation.ts';
import type { PgPoolLike } from './postgres-store.ts';

const subject='11111111-1111-4111-8111-111111111111',clientId='22222222-2222-4222-8222-222222222222';
const callback='https://chatgpt.com/connector/oauth/synthetic-test-only';
const input={projectRef:OAUTH_TEST_REF,origin:OAUTH_TEST_ORIGIN,clients:[{clientId,redirectUris:[callback]}],members:{[subject]:{owner:'synthetic:test',role:'reviewer'}},requiredScopes:['openid'],requireRefresh:true};
const env={V2_MODE:'isolated-test',V2_DATABASE_PROJECT_REF:OAUTH_TEST_REF,V2_DATABASE_HOST:`db.${OAUTH_TEST_REF}.supabase.co`,V2_DATABASE_URL:`postgresql://postgres:synthetic-test@db.${OAUTH_TEST_REF}.supabase.co/postgres`,V2_DATABASE_CA_PEM:'-----BEGIN CERTIFICATE-----\nSYNTHETIC_LOCAL_ONLY\n-----END CERTIFICATE-----'};
function poolFor(db:PGlite):PgPoolLike{return {connect:async()=>({query:async(sql,values)=>{const r=values?await db.query(sql,values):(await db.exec(sql)).at(-1)!;return {rows:r.rows as Record<string,any>[]};},release:()=>{}}),end:async()=>{}};}
async function fixture(){
 const db=new PGlite();await db.exec(`CREATE ROLE supabase_auth_admin NOLOGIN;CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;CREATE ROLE uid_brands_v2_app NOLOGIN;CREATE SCHEMA auth;CREATE SCHEMA uid_brands_v2;CREATE TABLE uid_brands_v2.jobs(id text);CREATE TABLE auth.users(id uuid PRIMARY KEY,aud text,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz,encrypted_password text,is_anonymous boolean);CREATE TABLE auth.oauth_clients(id uuid PRIMARY KEY,redirect_uris text,grant_types text,deleted_at timestamptz);`);
 await db.query("INSERT INTO auth.users VALUES($1,'authenticated',NULL,NULL,now(),'synthetic-no-real-password',false)",[subject]);
 await db.query("INSERT INTO auth.oauth_clients VALUES($1,$2,'authorization_code,refresh_token',NULL)",[clientId,callback]);return db;
}
const event=(patch:Record<string,unknown>={},method='oauth_provider/authorization_code')=>({user_id:subject,authentication_method:method,metadata:{request_id:'synthetic'},claims:{sub:subject,iss:`https://${OAUTH_TEST_REF}.supabase.co/auth/v1`,aud:'authenticated',iat:1,exp:9999999999,role:'authenticated',client_id:clientId,scope:'openid offline_access',app_metadata:{preserve:'exactly'},...patch}});

test('optional OAuth input refuses production, invented callbacks, empty members and missing scopes',()=>{
 assert.equal(parseOAuthActivation(input).projectRef,OAUTH_TEST_REF);
 for(const patch of [{projectRef:'wuonwttmkadwsmefjukv'},{members:{}},{requiredScopes:[]},{requiredScopes:['profile']},{clients:[{clientId,redirectUris:['https://chatgpt.com/connector/oauth/{callback_id}']}]},{clients:[{clientId,redirectUris:['https://chatgpt.com/*']}]},{clients:[{clientId,redirectUris:['http://chatgpt.com/connector/oauth/example']}]},{clients:[{clientId,redirectUris:[callback,callback]}]}])assert.throws(()=>parseOAuthActivation({...input,...patch}));
 const config=oauthActivationConfiguration(input);assert.equal(config.runtimeEnvironment.V2_JWT_AUDIENCE,OAUTH_TEST_ORIGIN+'/api/mcp');assert.equal(config.authPatch.oauth_server_allow_dynamic_registration,false);assert.equal('V2_SUPABASE_PUBLISHABLE_KEY' in config.runtimeEnvironment,false);
});

test('optional setup is read-only by default and requires actual pre-existing users and clients',async()=>{
 const db=await fixture();try{
  const pool=poolFor(db);const dry=await prepareOAuthPolicy(pool,input,env);assert.equal(dry.applied,false);assert.equal((await db.query<{value:string|null}>("SELECT to_regclass('uid_brands_v2_oauth.policy') AS value")).rows[0].value,null);
  await db.query('UPDATE auth.users SET email_confirmed_at=NULL');await assert.rejects(prepareOAuthPolicy(pool,input,env,true),/confirmed password account/);assert.equal((await db.query<{value:string|null}>("SELECT to_regclass('uid_brands_v2_oauth.policy') AS value")).rows[0].value,null);
  await db.query('UPDATE auth.users SET email_confirmed_at=now()');await db.query("UPDATE auth.oauth_clients SET redirect_uris=redirect_uris||',https://evil.example/callback'");await assert.rejects(prepareOAuthPolicy(pool,input,env,true),/exactly match/);
  await assert.rejects(prepareOAuthPolicy(pool,input,{...env,V2_DATABASE_PROJECT_REF:'wuonwttmkadwsmefjukv'},true),/isolated/);
 }finally{await db.close();}
});

test('real local PostgreSQL hook preserves login, pins approved OAuth+refresh audience, denies other identity/client/scope and restricts privileges',async t=>{
 const db=await fixture();try{
  const pool=poolFor(db);const applied=await prepareOAuthPolicy(pool,input,env,true);assert.equal(applied.applied,true);assert.equal(applied.authConfigurationChanged,false);assert.equal((await prepareOAuthPolicy(pool,input,env,true)).replay,true);
  await assert.rejects(prepareOAuthPolicy(pool,{...input,requiredScopes:['openid','email']},env,true),/differs/);
  await db.exec('SET ROLE supabase_auth_admin');
  const invoke=async(value:unknown)=>(await db.query<{result:any}>('SELECT uid_brands_v2_oauth.custom_access_token_hook($1::jsonb) AS result',[JSON.stringify(value)])).rows[0].result;
  await t.test('login and all unrelated claims are preserved exactly',async()=>{
   const login=event({},'password');delete (login.claims as any).client_id;assert.deepEqual(await invoke(login),login);
   const original=event();const result=await invoke(original);assert.equal(result.claims.aud,OAUTH_TEST_ORIGIN+'/api/mcp');assert.deepEqual(result,{...original,claims:{...original.claims,aud:OAUTH_TEST_ORIGIN+'/api/mcp'}});
   assert.equal((await invoke(event({},'token_refresh'))).claims.aud,OAUTH_TEST_ORIGIN+'/api/mcp');
   assert.equal((await invoke(event({aud:['authenticated']}))).claims.aud,OAUTH_TEST_ORIGIN+'/api/mcp');
  });
  await t.test('unknown clients/subjects, malformed events, missing scope and foreign issuer fail closed',async()=>{
   for(const bad of [null,{},event({client_id:'unknown'}),event({client_id:'33333333-3333-4333-8333-333333333333'}),event({sub:'44444444-4444-4444-8444-444444444444'}),event({scope:'profile'}),event({scope:['openid']}),event({iss:'https://foreign.example'}),event({aud:OAUTH_TEST_ORIGIN+'/api/mcp'}),event({client_id:''})])assert.ok((await invoke(bad)).error);
  });
  await t.test('Auth role can read policy but cannot change it; app/anonymous roles cannot read or execute',async()=>{
   await assert.rejects(db.query('DELETE FROM uid_brands_v2_oauth.approved_clients'),/permission denied/);
   for(const role of ['anon','authenticated','service_role','uid_brands_v2_app']){await db.exec('RESET ROLE;SET ROLE '+role);await assert.rejects(invoke(event()),/permission denied/);await assert.rejects(db.query('SELECT * FROM uid_brands_v2_oauth.approved_subjects'),/permission denied/);}
   await db.exec('RESET ROLE');
  });
  await t.test('revoking a policy subject denies the next OAuth issuance',async()=>{
   await db.query('DELETE FROM uid_brands_v2_oauth.approved_subjects WHERE subject=$1',[subject]);await db.exec('SET ROLE supabase_auth_admin');assert.ok((await invoke(event())).error);await db.exec('RESET ROLE');
  });
 }finally{await db.close();}
});

test('raw optional migration refuses absent target guard and legacy application schema',async()=>{
 const db=await fixture();try{
  const sql=await readFile(new URL('./migrations/002_optional_oauth_hook.sql',import.meta.url),'utf8');await assert.rejects(db.exec(sql),/authorized isolated/);
  await db.exec('CREATE SCHEMA uid_task_private');await db.query("SELECT set_config('uid_brands_v2.oauth_project_ref',$1,false)",[OAUTH_TEST_REF]);await assert.rejects(db.exec(sql),/authorized isolated/);
 }finally{await db.close();}
});

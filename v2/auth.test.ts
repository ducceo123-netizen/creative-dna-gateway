import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from './core.ts';
import { testTokenVerifier, jwtVerifier, verifierFromEnv, PUBLIC_TEST_OWNER, PUBLIC_TEST_SUBJECT, PUBLIC_TEST_ORIGIN } from './auth.ts';
import { readConfig } from './config.ts';

test('authentication binds provisioned identity; rejects missing, wrong and V1-style JWT credentials',async()=>{
 const token='uidv2_'+randomBytes(32).toString('base64url');
 const verify=testTokenVerifier([{tokenSha256:hash(token),owner:'tenant:test',subject:'test-reviewer',role:'reviewer'}]);
 assert.deepEqual(await verify('Bearer '+token),{owner:'tenant:test',subject:'test-reviewer',role:'reviewer',auth:'test-token'});
 await assert.rejects(verify(),/credential/); await assert.rejects(verify('Bearer uidv2_'+randomBytes(32).toString('base64url')),/Invalid/);
 await assert.rejects(verify('Bearer '+['a'.repeat(30),'b'.repeat(30),'c'.repeat(30)].join('.')),/Invalid/);
 assert.throws(()=>jwtVerifier({issuer:'https://wuonwttmkadwsmefjukv.supabase.co/auth/v1',audience:'authenticated',jwksUrl:'https://wuonwttmkadwsmefjukv.supabase.co/auth/v1/.well-known/jwks.json',members:{}}),/separately/);
});
test('startup is fail-closed for production writes, origins and ephemeral Render disks',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'uid-v2-config-'))); const base={V2_MODE:'isolated-test',V2_DATA_DIR:dir};
 assert.equal(readConfig(base).database,join(dir,'v2.sqlite'));
 assert.throws(()=>readConfig({}),/isolated-test/);
 assert.throws(()=>readConfig({...base,SUPABASE_SERVICE_ROLE_KEY:'not-a-real-key'}),/Remove/);
 assert.throws(()=>readConfig({...base,V2_PUBLIC_ORIGIN:'https://uid-brands-gateway-preview.onrender.com'}),/distinct/);
 assert.throws(()=>readConfig({...base,RENDER:'true'}),/persistent/); rmSync(dir,{recursive:true});
});
test('cloud configuration needs explicit hashed principals and isolated Postgres selection',async()=>{
 const token='uidv2_'+randomBytes(32).toString('base64url');
 const env={V2_AUTH_MODE:'test-token',V2_TEST_PRINCIPALS_JSON:JSON.stringify([{tokenSha256:hash(token),owner:'v2-cloud-test',subject:'reviewer',role:'reviewer'}])};
 assert.equal((await verifierFromEnv(env)('Bearer '+token)).owner,'v2-cloud-test');
 assert.throws(()=>verifierFromEnv({...env,V2_TEST_PRINCIPALS_FILE:'/unused'}),/exactly one/);
 assert.throws(()=>verifierFromEnv({V2_AUTH_MODE:'test-token'}),/exactly one/);
 const config=readConfig({V2_MODE:'isolated-test',V2_STORE:'postgres',V2_PUBLIC_ORIGIN:'https://v2-test.example.com',RENDER:'true'});
 assert.equal(config.store,'postgres');assert.equal(config.database,undefined);
 assert.throws(()=>readConfig({V2_MODE:'isolated-test',V2_STORE:'unknown'}),/sqlite or postgres/);
});
test('origin aliases, non-HTTP loopback schemes, root data paths and plural secret bundles fail isolation',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'uid-v2-config-')));const base={V2_MODE:'isolated-test',V2_DATA_DIR:dir};
 assert.throws(()=>readConfig({...base,V2_PUBLIC_ORIGIN:'https://uid-brands-gateway-preview.onrender.com.'}),/distinct/);
 assert.throws(()=>readConfig({...base,V2_PUBLIC_ORIGIN:'ftp://localhost'}),/HTTPS/);
 assert.throws(()=>readConfig({...base,V2_DATA_DIR:'/'}),/not isolated/);
 assert.throws(()=>readConfig({...base,SUPABASE_SECRET_KEYS:'not-real'}),/Remove/);
 assert.throws(()=>jwtVerifier({issuer:'https://auth.example.test:8443',jwksUrl:'https://auth.example.test:8443/keys',audience:'v2',members:{}}),/separately/);
 rmSync(dir,{recursive:true});
});
test('public testing is explicit, sandbox-scoped and never falls back for a supplied credential',async()=>{
 const base={V2_AUTH_MODE:'public-test',V2_MODE:'isolated-test',V2_PUBLIC_ORIGIN:PUBLIC_TEST_ORIGIN};
 const verify=verifierFromEnv(base);
 assert.deepEqual(await verify(),{owner:PUBLIC_TEST_OWNER,subject:PUBLIC_TEST_SUBJECT,role:'reviewer',auth:'public-test'});
 for(const header of ['', ' ', 'Bearer invalid'])await assert.rejects(verify(header),e=>(e as any).status===401);
 for(const patch of [{V2_MODE:''},{V2_PUBLIC_ORIGIN:'https://uid-brands-gateway-preview.onrender.com'},{V2_PUBLIC_ORIGIN:PUBLIC_TEST_ORIGIN+'/'},{V2_OAUTH_UI_ENABLED:'true'}])assert.throws(()=>verifierFromEnv({...base,...patch}),/isolated/);
 assert.throws(()=>verifierFromEnv({...base,V2_AUTH_MODE:undefined}),/explicit/);
});
test('public namespace cannot alias a private principal and existing private bearer access remains separate',async()=>{
 const token='uidv2_'+randomBytes(32).toString('base64url');
 const principal={tokenSha256:hash(token),owner:'private-existing-test',subject:'private-reviewer',role:'reviewer'};
 const base={V2_AUTH_MODE:'public-test',V2_MODE:'isolated-test',V2_PUBLIC_ORIGIN:PUBLIC_TEST_ORIGIN,V2_TEST_PRINCIPALS_JSON:JSON.stringify([principal])};
 const verify=verifierFromEnv(base);
 assert.equal((await verify()).owner,PUBLIC_TEST_OWNER);
 assert.equal((await verify('Bearer '+token)).owner,principal.owner);
 assert.equal((await verify('Bearer '+token)).auth,'test-token');
 for(const header of ['', ' ', 'Bearer invalid', 'Bearer uidv2_'+randomBytes(32).toString('base64url')])await assert.rejects(verify(header),e=>(e as any).status===401);
 for(const collision of [{owner:PUBLIC_TEST_OWNER},{subject:PUBLIC_TEST_SUBJECT}])assert.throws(()=>verifierFromEnv({...base,V2_TEST_PRINCIPALS_JSON:JSON.stringify([{...principal,...collision}])}),/namespace/);
});

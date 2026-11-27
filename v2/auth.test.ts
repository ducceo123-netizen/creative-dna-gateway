import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from './core.ts';
import { testTokenVerifier, jwtVerifier } from './auth.ts';
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
test('origin aliases, non-HTTP loopback schemes, root data paths and plural secret bundles fail isolation',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'uid-v2-config-')));const base={V2_MODE:'isolated-test',V2_DATA_DIR:dir};
 assert.throws(()=>readConfig({...base,V2_PUBLIC_ORIGIN:'https://uid-brands-gateway-preview.onrender.com.'}),/distinct/);
 assert.throws(()=>readConfig({...base,V2_PUBLIC_ORIGIN:'ftp://localhost'}),/HTTPS/);
 assert.throws(()=>readConfig({...base,V2_DATA_DIR:'/'}),/not isolated/);
 assert.throws(()=>readConfig({...base,SUPABASE_SECRET_KEYS:'not-real'}),/Remove/);
 assert.throws(()=>jwtVerifier({issuer:'https://auth.example.test:8443',jwksUrl:'https://auth.example.test:8443/keys',audience:'v2',members:{}}),/separately/);
 rmSync(dir,{recursive:true});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { argumentsFor, authenticationHeaders, healthPolicy, beforeAuthMode, createClient, smokeIdempotencyKey, ALLOWED_ORIGIN } from './common.mjs';

const flags=['origin','auth-mode','token-file','output'];
function parse(extra=[]){const saved=process.argv;try{process.argv=['node','test','--origin',ALLOWED_ORIGIN,'--output','/new/report.json',...extra];return argumentsFor(flags);}finally{process.argv=saved;}}

test('public is the explicit token-free default; bearer requires deliberate credential selection',()=>{
 assert.equal(parse()['auth-mode'],'public');assert.equal(parse()['token-file'],undefined);
 assert.throws(()=>parse(['--token-file','/private/token.txt']),/INVALID_PUBLIC_MODE_TOKEN_FILE/);
 assert.throws(()=>parse(['--auth-mode','bearer']),/REQUIRED_BEARER_TOKEN_FILE/);
 assert.equal(parse(['--auth-mode','bearer','--token-file','/private/token.txt'])['token-file'],'/private/token.txt');
 assert.throws(()=>parse(['--auth-mode','automatic']),/INVALID_AUTH_MODE/);
});

test('public client sends no Authorization header, while bearer client remains explicit',async()=>{
 assert.deepEqual(authenticationHeaders(null),{});
 const saved=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{tools:[]}}),{status:200,headers:{'Content-Type':'application/json'}});};
 try{
  await createClient(ALLOWED_ORIGIN,null).rpc('tools/list');
  await createClient(ALLOWED_ORIGIN,'test-only-placeholder').rpc('tools/list');
  assert.equal(calls.length,2);assert.equal(calls[0].url,ALLOWED_ORIGIN+'/api/mcp');assert.equal(Object.hasOwn(calls[0].options.headers,'Authorization'),false);
  assert.equal(calls[1].options.headers.Authorization,'Bearer test-only-placeholder');
 }finally{globalThis.fetch=saved;}
});

test('health must confirm a shared public sandbox before anonymous tests can continue',()=>{
 const pub={authRequired:false,publicSandbox:true,authMode:'public-test'},privateHealth={authRequired:true,publicSandbox:false,authMode:'opaque-test'};
 assert.deepEqual(healthPolicy(pub,'public'),pub);assert.deepEqual(healthPolicy(pub,'bearer'),pub);assert.deepEqual(healthPolicy(privateHealth,'bearer'),privateHealth);
 assert.throws(()=>healthPolicy(privateHealth,'public'),/INVALID_ENDPOINT_NOT_PUBLIC_SANDBOX/);
 assert.throws(()=>healthPolicy({},'public'),/INVALID_HEALTH_AUTH_POLICY/);
 assert.throws(()=>healthPolicy({...pub,authRequired:true},'public'),/INVALID_HEALTH_AUTH_POLICY/);
 assert.throws(()=>healthPolicy({...pub,authMode:'opaque-test'},'public'),/INVALID_HEALTH_PUBLIC_MODE/);
});

test('recovery cannot silently change a historical private job into anonymous scope',()=>{
 assert.equal(beforeAuthMode({authMode:'public'},'public'),'public');assert.equal(beforeAuthMode({schemaVersion:'uid-v2.test-kit.smoke/1'},'bearer'),'bearer');
 assert.throws(()=>beforeAuthMode({schemaVersion:'uid-v2.test-kit.smoke/1'},'public'),/INVALID_BEFORE_AUTH_MODE/);
 assert.throws(()=>beforeAuthMode({authMode:'public'},'bearer'),/INVALID_BEFORE_AUTH_MODE/);
});

test('separate public invocations get fresh keys even for the same deployment',()=>{
 const source='a'.repeat(40),first=smokeIdempotencyKey('public',source),second=smokeIdempotencyKey('public',source);
 assert.notEqual(first,second);assert.match(first,/^test-kit-smoke-v2-public-[a-f0-9-]{36}-a{12}$/);
 assert.equal(smokeIdempotencyKey('bearer',source),smokeIdempotencyKey('bearer',source));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { createOAuthRouter, oauthRouterFromEnv, readOAuthUiConfig, type OAuthUiConfig } from './oauth.ts';
import { V2Error } from './core.ts';

const ref='abcdefghijklmnopqrst',issuer=`https://${ref}.supabase.co/auth/v1`,authorizationId='68be3452-5997-43fb-bdd8-c83d8b4d812c',subject='855ca77a-0fc4-49dd-940f-294ffbafbf29';
const config:OAuthUiConfig={origin:'https://v2.example.test',projectRef:ref,issuer,jwksUrl:issuer+'/.well-known/jwks.json',publishableKey:'sb_publishable_'+'a'.repeat(40),redirectUris:['https://client.example.test/exact-callback','https://client.example.test/second-callback']};
const env={V2_MODE:'isolated-test',V2_AUTH_MODE:'jwt',V2_OAUTH_UI_ENABLED:'true',V2_OAUTH_PROJECT_REF:ref,V2_JWT_ISSUER:issuer,V2_JWKS_URL:config.jwksUrl,V2_SUPABASE_PUBLISHABLE_KEY:config.publishableKey,V2_OAUTH_REDIRECT_URIS_JSON:JSON.stringify(config.redirectUris)};
const sourceDetails=()=>({authorization_id:authorizationId,user:{id:subject,email:'synthetic@example.test'},client:{id:'client-id',name:'Synthetic <script>alert(1)</script> client'},redirect_uri:config.redirectUris[0],scope:'openid email'});
async function fixture(){
 let mode='normal',verified=0;const calls:{url:string;headers:Headers;body:any}[]=[];
 const fetcher:typeof fetch=async(url,init)=>{calls.push({url:String(url),headers:new Headers(init?.headers),body:init?.body?JSON.parse(String(init.body)):null});assert.equal(init?.redirect,'error');assert.ok(String(url).startsWith(issuer+'/oauth/authorizations/'));if(mode==='http-error')return new Response('private upstream detail',{status:500});if(mode==='oversized')return new Response('x',{headers:{'content-length':'999999'}});if(mode==='redirect')return Response.json({redirect_url:'https://evil.example/callback?code=secret'});if(mode==='already')return Response.json({redirect_url:config.redirectUris[0]+'?code=previous&state=state'});if(String(url).endsWith('/consent')&&mode==='final-swap')return Response.json({redirect_url:config.redirectUris[1]+'?code=wrong-destination'});if(String(url).endsWith('/consent')&&mode==='denied-as-success')return Response.json({redirect_url:config.redirectUris[0]+'?code=wrong-decision'});if(String(url).endsWith('/consent'))return Response.json({redirect_url:config.redirectUris[0]+(JSON.parse(String(init?.body)).action==='approve'?'?code=code&state=state':'?error=access_denied&state=state')});const data=sourceDetails();if(mode==='wrong-user')data.user.id='other-user';if(mode==='wrong-id')data.authorization_id='other-id';if(mode==='wrong-callback')data.redirect_uri='https://evil.example/callback';if(mode==='changed')data.scope='openid email profile';return Response.json(data);};
 const app=express();app.use(createOAuthRouter(config,{fetcher,verifyLogin:async authorization=>{verified++;if(authorization!=='Bearer synthetic-login-jwt')throw new V2Error('UNAUTHORIZED','Blocked test identity.',401);return {owner:'synthetic',subject,role:'operator',auth:'jwt'};}}));app.use((_req,res)=>res.sendStatus(404));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const request=(path:string,body?:unknown,headers:Record<string,string>={})=>new Promise<Response>((resolve,reject)=>{
  const request=httpRequest(base+path,{method:body===undefined?'GET':'POST',headers:{Host:new URL(config.origin).host,Origin:config.origin,...(body===undefined?{}:{'Content-Type':'application/json',Authorization:'Bearer synthetic-login-jwt'}),...headers}},response=>{const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]))})));});request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));
 });
 return {calls,request,setMode:(value:string)=>{mode=value;},verified:()=>verified,close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
test('OAuth UI is opt-in JWT-only and excludes production issuer, private keys and arbitrary callbacks',()=>{
 assert.equal(oauthRouterFromEnv({V2_AUTH_MODE:'test-token'},config.origin),undefined);assert.deepEqual(readOAuthUiConfig(env,config.origin),config);
 for(const patch of [{V2_AUTH_MODE:'test-token'},{V2_OAUTH_PROJECT_REF:'wuonwttmkadwsmefjukv'},{V2_JWT_ISSUER:'https://other.example/auth/v1'},{V2_JWKS_URL:'https://other.example/keys'},{V2_SUPABASE_PUBLISHABLE_KEY:'sb_secret_private'},{V2_SUPABASE_PUBLISHABLE_KEY:'legacy-jwt-anon-key'},{V2_OAUTH_REDIRECT_URIS_JSON:'["https://client.example.test/callback?next=evil"]'},{V2_OAUTH_REDIRECT_URIS_JSON:'["http://client.example.test/callback"]'}])assert.throws(()=>readOAuthUiConfig({...env,...patch},config.origin));
 assert.throws(()=>oauthRouterFromEnv(env,config.origin),/membership/);
});
test('consent HTML uses hashed CSP and memory-only existing-account sign-in; no user creation or mail',async()=>{
 const f=await fixture();try{
  const r=await f.request('/oauth/consent?authorization_id='+authorizationId);assert.equal(r.status,200);const html=await r.text(),csp=r.headers.get('content-security-policy')!;
  assert.match(csp,/script-src 'sha256-/);assert.match(csp,/style-src 'sha256-/);assert.match(csp,/frame-ancestors 'none'/);assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval/);assert.match(csp,new RegExp('connect-src.*'+ref));
  for(const tag of ['script','style']){const source=html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))![1];assert.ok(csp.includes("'sha256-"+createHash('sha256').update(source).digest('base64')+"'"));if(tag==='script')assert.doesNotThrow(()=>new Function(source));}
  assert.match(html,/grant_type=password/);assert.match(html,/credentials:'omit'/);assert.match(html,/pagehide/);assert.doesNotMatch(html,/localStorage|sessionStorage|document\.cookie|signUp|signInWithOtp|refresh_token|shouldCreateUser/);assert.equal(r.headers.get('set-cookie'),null);
  assert.equal((await f.request('/oauth/consent?authorization_id='+authorizationId+'&redirect_uri=https://evil.example')).status,400);assert.equal((await f.request('/oauth/consent?authorization_id=bad')).status,400);assert.equal(f.calls.length,0);
 }finally{await f.close();}
});
test('member identity is verified before exact details and explicit hash-bound approve/deny requests',async()=>{
 const f=await fixture();try{
  const details=await (await f.request('/oauth/details',{authorizationId})).json();assert.equal(details.status,'CONSENT_REQUIRED');assert.equal(details.client.name,sourceDetails().client.name);assert.equal(f.verified(),1);
  for(const action of ['approve','deny']){const r=await f.request('/oauth/decision',{authorizationId,action,detailsHash:details.detailsHash});assert.equal(r.status,200);const payload=await r.json();assert.ok(payload.redirectUrl.startsWith(config.redirectUris[0]));}
  assert.deepEqual(f.calls.filter(c=>c.body).map(c=>c.body),[{action:'approve'},{action:'deny'}]);assert.ok(f.calls.every(c=>c.headers.get('authorization')==='Bearer synthetic-login-jwt'&&c.headers.get('apikey')===config.publishableKey));
  assert.equal(f.calls.length,5);assert.equal(f.verified(),3);
  const before=f.calls.length;assert.equal((await f.request('/oauth/details',{authorizationId},{Authorization:'Bearer inactive-member'})).status,401);assert.equal(f.calls.length,before);
  assert.equal((await f.request('/oauth/decision',{authorizationId,action:'approve',detailsHash:details.detailsHash},{Origin:'https://evil.example'})).status,403);assert.equal(f.calls.length,before);
  f.setMode('changed');assert.equal((await f.request('/oauth/decision',{authorizationId,action:'approve',detailsHash:details.detailsHash})).status,409);assert.equal(f.calls.filter(c=>c.body).length,2);
 }finally{await f.close();}
});
test('identity mismatch, callback swaps, oversize/upstream errors and prior grants fail or continue explicitly',async()=>{
 const f=await fixture();try{
  for(const mode of ['wrong-user','wrong-id','wrong-callback','redirect','http-error','oversized']){f.setMode(mode);const r=await f.request('/oauth/details',{authorizationId});assert.ok(r.status>=400);assert.doesNotMatch(await r.text(),/private upstream detail|code=secret/);}
  f.setMode('already');const r=await f.request('/oauth/details',{authorizationId}),data=await r.json();assert.equal(r.status,200);assert.equal(data.status,'PREVIOUSLY_AUTHORIZED');assert.ok(data.redirectUrl.startsWith(config.redirectUris[0]));assert.equal(f.calls.filter(c=>c.body).length,0);
  assert.equal((await f.request('/oauth/decision',{authorizationId,action:'approve',detailsHash:'0'.repeat(64)})).status,409);assert.equal(f.calls.filter(c=>c.body).length,0);
 }finally{await f.close();}
});

test('final authorization response stays bound to the exact reviewed callback and decision',async()=>{
 const f=await fixture();try{
  const details=await (await f.request('/oauth/details',{authorizationId})).json();
  f.setMode('final-swap');const swapped=await f.request('/oauth/decision',{authorizationId,action:'approve',detailsHash:details.detailsHash});assert.equal(swapped.status,400);assert.equal((await swapped.json()).error,'OAUTH_CALLBACK_BLOCKED');
  f.setMode('denied-as-success');const denied=await f.request('/oauth/decision',{authorizationId,action:'deny',detailsHash:details.detailsHash});assert.equal(denied.status,400);assert.equal((await denied.json()).error,'OAUTH_CALLBACK_BLOCKED');
 }finally{await f.close();}
});

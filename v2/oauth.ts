/** Isolated adaptation of uid-member-oauth.ts and src/oauth-consent.tsx.
 * Supabase remains the authorization server. This adapter never creates users,
 * sends login mail, issues OAuth tokens, or persists login/refresh credentials.
 * REST paths mirror the vetted auth-js get/approve/denyAuthorization methods.
 */
import express, { type Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isolatedHttps, jwtVerifier, PRODUCTION_PROJECT, type VerifyPrincipal } from './auth.ts';
import { hash, V2Error } from './core.ts';

export type OAuthUiConfig={origin:string;projectRef:string;issuer:string;jwksUrl:string;publishableKey:string;redirectUris:string[]};
const authorizationId=z.string().uuid();
const requestSchema=z.object({authorizationId}).strict();
const decisionSchema=requestSchema.extend({action:z.enum(['approve','deny']),detailsHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
function validateConfig(c:OAuthUiConfig):OAuthUiConfig{
  const origin=isolatedHttps(c.origin,'V2 consent origin');
  if(origin.origin!==c.origin||!/^[a-z]{20}$/.test(c.projectRef)||c.projectRef===PRODUCTION_PROJECT)throw new V2Error('OAUTH_CONFIG','Use an isolated V2 OAuth project and origin.');
  if(c.issuer!==`https://${c.projectRef}.supabase.co/auth/v1`||c.jwksUrl!==`${c.issuer}/.well-known/jwks.json`||origin.origin===new URL(c.issuer).origin)throw new V2Error('OAUTH_CONFIG','Consent issuer and JWKS must match the isolated project.');
  if(!/^sb_publishable_[A-Za-z0-9_-]{16,200}$/.test(c.publishableKey))throw new V2Error('OAUTH_CONFIG','Only an isolated project public publishable key is accepted.');
  if(!Array.isArray(c.redirectUris)||!c.redirectUris.length||c.redirectUris.length>10||new Set(c.redirectUris).size!==c.redirectUris.length)throw new V2Error('OAUTH_CONFIG','Explicit OAuth callback URIs are required.');
  for(const uri of c.redirectUris){const u=isolatedHttps(uri,'OAuth callback');if(u.href!==uri||u.origin===origin.origin)throw new V2Error('OAUTH_CONFIG','OAuth callback URI must be an exact external HTTPS URL.');}
  return structuredClone(c);
}
export function readOAuthUiConfig(env:NodeJS.ProcessEnv,origin:string):OAuthUiConfig|undefined{
  if(env.V2_OAUTH_UI_ENABLED!=='true')return undefined;
  if(env.V2_MODE!=='isolated-test'||env.V2_AUTH_MODE!=='jwt')throw new V2Error('OAUTH_CONFIG','Consent UI is available only with explicit isolated JWT authentication.');
  return validateConfig({origin,projectRef:env.V2_OAUTH_PROJECT_REF||'',issuer:env.V2_JWT_ISSUER||'',jwksUrl:env.V2_JWKS_URL||'',publishableKey:env.V2_SUPABASE_PUBLISHABLE_KEY||'',redirectUris:JSON.parse(env.V2_OAUTH_REDIRECT_URIS_JSON||'[]')});
}
/** Must be mounted before the MCP bearer middleware; routes authenticate their
 * own short-lived login JWT with the same explicit isolated membership map.
 */
export function oauthRouterFromEnv(env:NodeJS.ProcessEnv,origin:string):Router|undefined{
  const config=readOAuthUiConfig(env,origin);if(!config)return undefined;
  const verifyLogin=jwtVerifier({purpose:'login',issuer:config.issuer,audience:'authenticated',jwksUrl:config.jwksUrl,members:JSON.parse(env.V2_MEMBERS_JSON||'{}')});
  return createOAuthRouter(config,{verifyLogin});
}
function callbackUrl(value:unknown,c:OAuthUiConfig,expected?:{redirectUri:string;action:'approve'|'deny'}):string{
  if(typeof value!=='string'||value.length>8192)throw new V2Error('OAUTH_CALLBACK_BLOCKED','Issuer returned an invalid callback.');
  const u=new URL(value),base=u.origin+u.pathname;
  const keys=[...u.searchParams.keys()];
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!c.redirectUris.includes(base)||keys.some(k=>!['code','state','error','error_description','error_uri','iss'].includes(k))||keys.length!==new Set(keys).size||Boolean(u.searchParams.get('code'))===Boolean(u.searchParams.get('error')))throw new V2Error('OAUTH_CALLBACK_BLOCKED','Issuer callback is outside the explicitly allowed destination.');
  if(u.searchParams.has('iss')&&u.searchParams.get('iss')!==c.issuer)throw new V2Error('OAUTH_CALLBACK_BLOCKED','Issuer callback identity does not match.');
  if(expected&&(base!==expected.redirectUri||(expected.action==='approve'?!u.searchParams.get('code'):!u.searchParams.get('error'))))throw new V2Error('OAUTH_CALLBACK_BLOCKED','Issuer callback differs from the reviewed destination or decision.');
  return u.href;
}
async function boundedResponse(response:globalThis.Response){
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new V2Error('OAUTH_ISSUER_UNAVAILABLE','Authorization request could not be completed.',response.status===401||response.status===403?401:502);}
  if(!response.body||Number(response.headers.get('content-length')||0)>64*1024){await response.body?.cancel().catch(()=>{});throw new V2Error('OAUTH_RESPONSE_INVALID','Invalid authorization response.',502);}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{for(;;){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>64*1024)throw new V2Error('OAUTH_RESPONSE_INVALID','Authorization response exceeds limit.',502);chunks.push(r.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
export function createOAuthRouter(rawConfig:OAuthUiConfig,deps:{verifyLogin:VerifyPrincipal;fetcher?:typeof fetch}):Router{
  const c=validateConfig(rawConfig),fetcher=deps.fetcher??fetch,router=express.Router(),rate=new Map<string,{count:number;expires:number}>();
  router.use('/oauth',(req,res,next)=>{res.set({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});if(req.get('host')?.toLowerCase()!==new URL(c.origin).host||req.method!=='GET'&&req.get('origin')!==c.origin)return res.status(403).json({error:'OAUTH_ORIGIN_REQUIRED'});next();});
  router.get('/oauth/consent',(req,res)=>{
    const parsed=authorizationId.safeParse(req.query.authorization_id);if(!parsed.success||Object.keys(req.query).some(k=>k!=='authorization_id'))return res.status(400).type('text').send('Start a new OAuth connection from the MCP client.');
    const page=consentPage(c,parsed.data);res.set('Content-Security-Policy',page.csp).type('html').send(page.html);
  });
  router.use(['/oauth/details','/oauth/decision'],express.json({limit:'8kb',strict:true}));
  const upstream=async(id:string,bearer:string,action?:'approve'|'deny')=>boundedResponse(await fetcher(`${c.issuer}/oauth/authorizations/${encodeURIComponent(id)}${action?'/consent':''}`,{method:action?'POST':'GET',redirect:'error',cache:'no-store',headers:{apikey:c.publishableKey,Authorization:bearer,Accept:'application/json',...(action?{'Content-Type':'application/json'}:{})},...(action?{body:JSON.stringify({action})}:{}),signal:AbortSignal.timeout(8000)}));
  const details=(data:any,id:string,subject:string)=>{
    if(data?.redirect_url)return {status:'PREVIOUSLY_AUTHORIZED' as const,redirectUrl:callbackUrl(data.redirect_url,c)};
    if(data?.authorization_id!==id||data?.user?.id!==subject||typeof data?.client?.id!=='string'||typeof data?.client?.name!=='string'||data.client.name.length>500||typeof data?.scope!=='string'||data.scope.length>4000||!c.redirectUris.includes(data.redirect_uri))throw new V2Error('OAUTH_DETAILS_MISMATCH','Authorization identity or callback does not match.',403);
    const bound={authorizationId:id,subject,client:{id:data.client.id,name:data.client.name},scope:data.scope,redirectUri:data.redirect_uri};
    return {status:'CONSENT_REQUIRED' as const,client:bound.client,scope:bound.scope,redirectUri:bound.redirectUri,detailsHash:hash(bound)};
  };
  for(const path of ['/oauth/details','/oauth/decision'])router.post(path,async(req,res)=>{
    try{
      const input=path.endsWith('decision')?decisionSchema.parse(req.body):requestSchema.parse(req.body);
      const bearer=req.get('authorization'),principal=await deps.verifyLogin(bearer);if(principal.auth!=='jwt')throw new V2Error('UNAUTHORIZED','Isolated member login is required.',401);
      const now=Date.now();for(const [key,item] of rate)if(item.expires<now)rate.delete(key);if(rate.size>=1000&&!rate.has(principal.subject))throw new V2Error('RATE_LIMIT','Try again later.',429);
      const entry=rate.get(principal.subject)??{count:0,expires:now+60000};rate.set(principal.subject,entry);if(++entry.count>30)throw new V2Error('RATE_LIMIT','Try again later.',429);
      const current=details(await upstream(input.authorizationId,bearer!),input.authorizationId,principal.subject);
      if(!('action' in input))return res.json(current);
      const decision=decisionSchema.parse(input);
      if(current.status!=='CONSENT_REQUIRED'||current.detailsHash!==decision.detailsHash)throw new V2Error('OAUTH_DETAILS_CHANGED','Reload the authorization request before deciding.',409);
      const result=await upstream(input.authorizationId,bearer!,decision.action);return res.json({redirectUrl:callbackUrl(result?.redirect_url,c,{redirectUri:current.redirectUri,action:decision.action})});
    }catch(error){const code=error instanceof V2Error?error.code:error instanceof z.ZodError?'INVALID_OAUTH_REQUEST':'OAUTH_REQUEST_FAILED';res.status(error instanceof V2Error?error.status:error instanceof z.ZodError?400:502).json({error:code});}
  });
  router.use('/oauth',(error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error?.type==='entity.too.large'?413:400).json({error:'INVALID_OAUTH_REQUEST'}));
  return router;
}
function consentPage(c:OAuthUiConfig,id:string){
  const data=JSON.stringify({issuer:c.issuer,publishableKey:c.publishableKey,authorizationId:id}).replace(/[<>&\u2028\u2029]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));
  const script=`'use strict';
const config=JSON.parse(document.getElementById('config').textContent);let token='',detailsHash='',redirectUrl='';
const notice=document.getElementById('notice'),login=document.getElementById('login'),consent=document.getElementById('consent');
function clear(){token='';detailsHash='';redirectUrl='';document.getElementById('password').value='';consent.hidden=true;login.hidden=false;}
async function request(path,body){const r=await fetch(path,{method:'POST',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Authorization failed');return data;}
login.addEventListener('submit',async event=>{event.preventDefault();const button=document.getElementById('sign-in');button.disabled=true;notice.textContent='Signing in…';try{
const email=document.getElementById('email').value.trim(),password=document.getElementById('password').value;document.getElementById('password').value='';
const response=await fetch(config.issuer+'/token?grant_type=password',{method:'POST',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
if(!response.ok)throw Error('Sign-in failed. Use an existing approved V2 account.');const session=await response.json();if(typeof session.access_token!=='string')throw Error('Sign-in did not return a session.');token=session.access_token;
const data=await request('/oauth/details',{authorizationId:config.authorizationId});login.hidden=true;consent.hidden=false;
if(data.status==='PREVIOUSLY_AUTHORIZED'){redirectUrl=data.redirectUrl;document.getElementById('client').textContent='This client already has your issuer authorization.';document.getElementById('scope').textContent='Continue to the previously authorized client.';document.getElementById('approve').hidden=true;document.getElementById('deny').hidden=true;document.getElementById('continue').hidden=false;}
else{detailsHash=data.detailsHash;document.getElementById('client').textContent=data.client.name;document.getElementById('scope').textContent='Requested scopes: '+data.scope;document.getElementById('destination').textContent='Return to: '+data.redirectUri;document.getElementById('approve').hidden=false;document.getElementById('deny').hidden=false;document.getElementById('continue').hidden=true;}notice.textContent='';
}catch(error){clear();notice.textContent=error.message||'Authorization failed.';}finally{button.disabled=false;}});
for(const action of ['approve','deny'])document.getElementById(action).addEventListener('click',async()=>{document.getElementById('approve').disabled=true;document.getElementById('deny').disabled=true;try{const data=await request('/oauth/decision',{authorizationId:config.authorizationId,action,detailsHash});clear();location.assign(data.redirectUrl);}catch(error){clear();notice.textContent=error.message||'Authorization failed.';}finally{document.getElementById('approve').disabled=false;document.getElementById('deny').disabled=false;}});
document.getElementById('continue').addEventListener('click',()=>{const destination=redirectUrl;clear();if(destination)location.assign(destination);});document.getElementById('forget').addEventListener('click',()=>{clear();notice.textContent='Local login cleared.';});window.addEventListener('pagehide',clear);`;
  const style='*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;background:#f5f7f9;color:#17252b;margin:0;padding:40px 16px}main{max-width:520px;margin:auto;background:white;padding:28px;border:1px solid #dce3e8;border-radius:12px}h1{font-size:25px}label{display:block;margin:14px 0}input,button{font:inherit;padding:10px}input{display:block;width:100%}button{cursor:pointer;margin:6px 6px 6px 0}p{overflow-wrap:anywhere}[hidden]{display:none!important}#notice{color:#8d2c21}';
  const digest=(v:string)=>createHash('sha256').update(v).digest('base64');
  const csp=`default-src 'none'; script-src 'sha256-${digest(script)}'; style-src 'sha256-${digest(style)}'; connect-src 'self' ${new URL(c.issuer).origin}; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'`;
  return {csp,html:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UID Brands V2 authorization</title><style>${style}</style></head><body><main><h1>Connect UID Brands V2</h1><p>Sign in with your existing approved account in the isolated V2 project. Access covers your V2 jobs and artifacts. It does not grant production access, publishing or training.</p><form id="login"><label>Email<input id="email" type="email" autocomplete="username" maxlength="254" required></label><label>Password<input id="password" type="password" autocomplete="current-password" maxlength="4096" required></label><button id="sign-in" type="submit">Sign in</button></form><section id="consent" hidden><h2 id="client"></h2><p id="scope"></p><p id="destination"></p><button id="deny" type="button">Deny</button><button id="approve" type="button">Allow access</button><button id="continue" type="button" hidden>Continue</button><button id="forget" type="button">Clear local login</button></section><p id="notice" role="status"></p><p>Login is kept only in this page's memory. No account is created and no login email is sent.</p></main><script id="config" type="application/json">${data}</script><script>${script}</script></body></html>`};
}

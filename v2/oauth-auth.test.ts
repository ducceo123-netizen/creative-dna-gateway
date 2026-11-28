import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { jwtVerifier, verifierFromEnv } from './auth.ts';
const issuer='https://abcdefghijklmnopqrst.supabase.co/auth/v1',audience='https://v2-test.example.com/api/mcp';
const subject='11111111-1111-4111-8111-111111111111',clientId='22222222-2222-4222-8222-222222222222';
const members={[subject]:{owner:'synthetic:tenant',role:'reviewer' as const}};

test('signed JWTs bind resource audience, OAuth client, granted scopes and explicit real-principal mapping',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('ES256'),key={...await exportJWK(publicKey),kid:'synthetic-key',alg:'ES256'};
 const fetcher:typeof fetch=async(url)=>{assert.equal(String(url),issuer+'/.well-known/jwks.json');return new Response(JSON.stringify({keys:[key]}),{headers:{'Content-Type':'application/json'}});};
 const base={issuer,audience,jwksUrl:issuer+'/.well-known/jwks.json',members,clientIds:[clientId],requiredScopes:['openid']};
 const verify=jwtVerifier(base,{fetcher});const login=jwtVerifier({...base,purpose:'login',audience:'authenticated',clientIds:undefined,requiredScopes:undefined},{fetcher});
 const now=Math.floor(Date.now()/1000);
 const token=async(patch:Record<string,any>={})=>'Bearer '+await new SignJWT({sub:subject,iss:issuer,aud:audience,iat:now,exp:now+300,client_id:clientId,scope:'openid offline_access',...patch}).setProtectedHeader({alg:'ES256',kid:key.kid}).sign(privateKey);
 assert.equal((await verify(await token())).subject,subject);
 assert.equal((await verify(await token({aud:[audience]}))).subject,subject);
 for(const patch of [{aud:'authenticated'},{aud:[audience,'authenticated']},{client_id:undefined},{client_id:'33333333-3333-4333-8333-333333333333'},{scope:undefined},{scope:'profile'},{scope:['openid']},{sub:'44444444-4444-4444-8444-444444444444'},{iss:'https://foreign.example'},{exp:now-60},{iat:now+300},{is_anonymous:true}])await assert.rejects(verify(await token(patch)),/Invalid or inactive/);
 const loginToken=await token({aud:'authenticated',client_id:undefined,scope:undefined});assert.equal((await login(loginToken)).subject,subject);assert.equal((await login(await token({aud:['authenticated'],client_id:undefined,scope:undefined}))).subject,subject);await assert.rejects(verify(loginToken));await assert.rejects(login(await token()));await assert.rejects(login(await token({aud:'authenticated'})));
 assert.throws(()=>jwtVerifier({...base,clientIds:[]}),/approved OAuth clients/);assert.throws(()=>jwtVerifier({...base,requiredScopes:[]}),/approved OAuth clients/);
 assert.throws(()=>verifierFromEnv({V2_AUTH_MODE:'jwt',V2_PUBLIC_ORIGIN:'https://v2-test.example.com',V2_JWT_AUDIENCE:'authenticated'}),/exact V2 endpoint/);
});

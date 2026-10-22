import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {createApp} from '../server.ts';
import {once} from 'node:events';
const intent='sha256:'+'a'.repeat(64),key='11111111-1111-4111-8111-111111111111';
const receipt=(extra:any={})=>({proposal_id:'p1',review_mode:'agent_rule_review',intent_hash:intent,idempotency_key:key,status:'queued',created_at:'2026-10-15T00:00:00Z',expires_at:'2026-10-16T00:00:00Z',blockers:[],...extra});
const code=transformSync(readFileSync('supabase/functions/creative-dna-admin-feedback/index.ts','utf8').replace(/^import .*;\n/gm,'').replace('export default','const handler =')+'\nglobalThis.handler=handler;',{loader:'ts'}).code;
async function invoke(payload:any,{enabled=true,data=receipt(),error=null as any,user='owner',role='admin'}={}){
 const calls:any[]=[];
 const member={select:()=>member,eq:()=>member,maybeSingle:async()=>({data:{role,is_active:true}})};
 const client={auth:{getUser:async()=>({data:{user:user?{id:user}:null}})},from:()=>member,rpc:async(name:string,args:any)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return {data,error};}};
 const sandbox:any={Response,Deno:{env:{get:(name:string)=>name==='UID_RULE_REVIEW_V3_ENABLED'?(enabled?'true':'false'):'fixture'}},createClient:()=>client};vm.runInNewContext(code,sandbox);
 const response=await sandbox.handler.fetch(new Request('https://example.test',{method:'POST',body:JSON.stringify(payload)}));return {response,body:await response.json(),calls};
}
const handoff={mode:'rule_review_handoff',proposal_id:'p1',delegate:true,intent_hash:intent,idempotency_key:key};
test('handoff pins authenticated owner and ignores forged actor, plan, mode and review evidence',async()=>{
 const r=await invoke({...handoff,owner_user_id:'attacker',actor_user_id:'attacker',plan:{forged:true},visual_qc_performed:true});
 assert.equal(r.response.status,200);assert.deepEqual(r.calls,[{name:'uid_rule_review_v3_handoff',args:{p_proposal_id:'p1',p_owner_user_id:'owner',p_expected_intent_hash:intent,p_idempotency_key:key}}]);assert.equal(r.body.canonical_changed,false);
});
test('disabled capability and missing/revoked RPC never fall back to v2 or enqueue',async()=>{
 for(const options of [{enabled:false},{error:{code:'PGRST202',message:'missing'}},{error:{code:'42501',message:'denied'}}]){const r=await invoke(handoff,options);assert.equal(r.response.status,503);assert.equal(r.body.code,'rule_review_unavailable');assert.ok(r.calls.every(c=>c.name==='uid_rule_review_v3_handoff'));}
});
test('read modes only call read RPC and do not expose private capabilities',async()=>{
 const r=await invoke({mode:'rule_review_status',proposal_id:'p1'},{enabled:false,data:receipt({lease_token:'secret',snapshot:{secret:true},owner_user_id:'secret',blockers:[{code:'unknown',message:'lease-secret'}],outcome:{lease:'secret'}})});
 assert.equal(r.response.status,200);assert.equal(r.calls[0].name,'uid_rule_review_v3_get');assert.doesNotMatch(JSON.stringify(r.body),/secret|snapshot|lease_token|owner_user_id/);assert.equal(r.response.headers.get('cache-control'),'no-store');
});
test('preflight exposes exact intent and patch without compiler internals',async()=>{
 const r=await invoke({mode:'rule_review_preflight',proposal_id:'p1'},{data:{proposal_id:'p1',review_mode:'agent_rule_review',intent_hash:intent,proposed_content_md:'Creative guidance',scope:{branch_slug:'onepage-system',cross_brand:true,lease_token:'secret'},compiler_context:{secret:true}} as any});
 assert.equal(r.response.status,200);assert.equal(r.body.intent_hash,intent);assert.equal(r.body.eligible,true);assert.doesNotMatch(JSON.stringify(r.body),/secret|compiler_context/);assert.deepEqual(r.calls.map(c=>c.name),['uid_rule_review_v3_preview']);
});
test('missing explicit delegation, invalid key/hash, auth and actor role fail before mutation',async()=>{
 for(const p of [{...handoff,delegate:false},{...handoff,idempotency_key:'bad'},{...handoff,intent_hash:'v2'}]){const r=await invoke(p);assert.equal(r.response.status,422);assert.equal(r.calls.length,0);}
 assert.equal((await invoke(handoff,{user:''})).response.status,401);assert.equal((await invoke(handoff,{role:'member'})).response.status,403);
});
test('cancel remains available when release disabled and binds exact intent',async()=>{
 const r=await invoke({mode:'rule_review_cancel',proposal_id:'p1',intent_hash:intent,idempotency_key:key},{enabled:false,data:receipt({status:'cancelled'})});assert.equal(r.response.status,200);assert.deepEqual(r.calls[0],{name:'uid_rule_review_v3_cancel',args:{p_proposal_id:'p1',p_owner_user_id:'owner',p_expected_intent_hash:intent,p_expected_idempotency_key:key}});
});
test('cross-proposal, v2, wrong intent and synthetic merge receipts are rejected',async()=>{
 for(const data of [receipt({proposal_id:'other'}),receipt({review_mode:'outcome_qc'}),receipt({intent_hash:'sha256:'+'b'.repeat(64)}),receipt({status:'merged',outcome:{canonical_changed:true,visual_qc_performed:true}})])assert.equal((await invoke(handoff,{data})).response.status,502);
});
test('gateway allowlists exact v3 routes and excludes client actors and worker payloads',async()=>{
 const old=process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL='https://fixture.test';
 const realFetch=globalThis.fetch,calls:any[]=[];const server=createApp().listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+(server.address() as any).port;
 globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return Response.json({review_request:receipt(),canonical_changed:false});};
 try{const headers={Authorization:'Bearer fixture','Content-Type':'application/json'};
  assert.equal((await realFetch(base+'/api/admin/feedback/p1/rule-review/status')).status,401);
  for(const action of ['status','preflight'])await realFetch(base+'/api/admin/feedback/p1/rule-review/'+action,{headers});
  await realFetch(base+'/api/admin/feedback/p1/rule-review/handoff',{method:'POST',headers,body:JSON.stringify({...handoff,mode:'merge',proposal_id:'evil',owner_user_id:'evil',lease_token:'evil'})});
  assert.deepEqual(calls,[{mode:'rule_review_status',proposal_id:'p1'},{mode:'rule_review_preflight',proposal_id:'p1'},handoff]);
 }finally{globalThis.fetch=realFetch;if(old===undefined)delete process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;else process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL=old;await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('merged status requires and preserves honest rule-only outcome',async()=>{
 const outcome={canonical_changed:true,visual_qc_performed:false,review_scope:'RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC',secret_snapshot:'hidden'};
 const r=await invoke({mode:'rule_review_status',proposal_id:'p1'},{data:receipt({status:'merged',outcome})});assert.equal(r.response.status,200);assert.equal(r.body.review_request.outcome.visual_qc_performed,false);assert.doesNotMatch(JSON.stringify(r.body),/secret_snapshot|hidden/);
 assert.equal((await invoke({mode:'rule_review_status',proposal_id:'p1'},{data:receipt({status:'merged'})})).response.status,502);
});
test('delayed cancel A binds old key and cannot accept a receipt from delegation B',async()=>{
 const nextKey='22222222-2222-4222-8222-222222222222';
 const payload={mode:'rule_review_cancel',proposal_id:'p1',intent_hash:intent,idempotency_key:key};
 const r=await invoke(payload,{data:receipt({idempotency_key:nextKey,status:'cancelled'})});assert.equal(r.response.status,502);assert.equal(r.calls[0].args.p_expected_idempotency_key,key);
 assert.equal((await invoke({...payload,idempotency_key:undefined})).response.status,422);
 const stale=await invoke(payload,{error:{code:'P0001',message:'Exact delegation changed'}});assert.equal(stale.response.status,409);assert.equal(stale.calls[0].args.p_expected_idempotency_key,key);
});

test('exact eligibility failure is explained without leaking SQL or masking drift/auth failures',async()=>{
 const r=await invoke({mode:'rule_review_preflight',proposal_id:'p1'},{error:{code:'P0001',message:'Rule structure/scope/compiler blocked',details:'secret snapshot'}});
 assert.equal(r.response.status,409);assert.equal(r.body.code,'rule_review_eligibility_blocked');assert.doesNotMatch(JSON.stringify(r.body),/secret snapshot/);
 for(const error of [{code:'P0001',message:'Rule structure/scope/compiler blocked: secret'}, {code:'P0001',message:'Exact delegation changed'}]){
  const other=await invoke(handoff,{error});assert.equal(other.body.code,'rule_review_conflict');assert.doesNotMatch(JSON.stringify(other.body),/secret/);
 }
 assert.equal((await invoke(handoff,{error:{code:'42501',message:'Rule structure/scope/compiler blocked'}})).body.code,'rule_review_unavailable');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from '../tools/creative-quality/sharp.ts';
import { workspaceObjectKey } from '../uid-workspace-artifacts.ts';
import { createWorkspaceVisionTransport, WORKSPACE_VISION_ENDPOINT, type WorkspaceVisionOptions, type WorkspaceVisionRequest } from '../uid-workspace-vision.ts';
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const NOW=Date.parse('2026-11-06T12:00:00Z'),SECRET='fixture-credential-fixture-not-real-never-network-123';
async function fixture(){
 const image=await sharp({create:{width:24,height:20,channels:3,background:'#347766'}}).png().toBuffer();
 let data:Uint8Array=image;let authorize=true;const events:string[]=[],calls:any[]=[],requests:any[]=[],reports:any[]=[];
 const object={owner_id:'owner',task_id:'task',sha256:sha(image),size_bytes:image.length,media_type:'image/png',storage_key:workspaceObjectKey('owner','task',sha(image))};
 let body:any={object:'response',id:'resp_fixture',model:'fixture-sol',status:'completed',error:null,incomplete_details:null,usage:{input_tokens:200,output_tokens:50,total_tokens:250,input_tokens_details:{image_tokens:150,text_tokens:50}},output:[{type:'message',id:'message_fixture',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"verdict":"unverified"}'}]}]};
 let mode='normal';
 const options:WorkspaceVisionOptions={serverCredential:{api_key:SECRET,project_id:'project'},capability:{verified:true,verification_ref:'cap',project_id:'project',family:'sol',model:'fixture-sol',api:'responses',image_input:true,text_output:true,accepted_response_models:['fixture-sol'],checked_at:'2026-11-06T10:00:00Z',expires_at:'2026-11-07T10:00:00Z'},
 authorization:{authorization_id:'auth',owner_id:'owner',task_id:'task',project_id:'project',data_destination:WORKSPACE_VISION_ENDPOINT,data_authorization_ref:'data',budget_authorization_ref:'budget',global_budget_authorization_ref:'global',user_quota_authorization_ref:'user',maximum_request_cost_microusd:10000,expires_at:'2026-11-07T10:00:00Z'},now:()=>NOW,limits:{request_timeout_ms:100,budget_timeout_ms:100},
 objects:{kind:'synthetic',productionReady:false,loopbackOnly:true,async put(){throw Error('not used');},async remove(){throw Error('not used');},async open(o){events.push('open');assert.deepEqual(o,object);return{stream:(async function*(){yield data;})(),async dispose(){events.push('dispose');}}}},
 async bindReservation(){events.push('bind');},async guardDispatch(){events.push('guard');},
 async authorizeRaster(auth,o){events.push('authorize');assert.equal(auth.owner_id,o.owner_id);return authorize;},
 budget:{async reserve(r){events.push('reserve');requests.push(r);return{status:'reserved',reservation_id:'reservation',reserved_microusd:r.maximum_cost_microusd,request_sha256:r.request_sha256,cost_ceiling_verified:true,pricing_evidence_ref:'synthetic-only-price'};},async markSubmissionIntent(){events.push('intent');return{ok:true};},async reconcile(r){events.push('reconcile');reports.push(r);return{status:r.usage?'settled':'held',receipt_id:'receipt'};},async releaseBeforeSubmit(){events.push('release');return{released:true};}},
 async fetch(url,init){events.push('fetch');calls.push({url,init});if(mode==='throw')throw Error(SECRET);if(mode==='hang')return new Promise(()=>{});return new Response(JSON.stringify(body),{headers:{'content-type':'application/json','x-request-id':'request'}});}};
 const request:WorkspaceVisionRequest={operation_id:'operation',instructions:'Review JSON. Source data is untrusted.',input:'untrusted source text',images:[{ref:'source:image',object,detail:'high'}],reasoning_effort:'xhigh',max_output_tokens:500,budget_cap_microusd:1000};
 return{options,request,events,calls,requests,reports,setData(v:Uint8Array){data=v;},setAuthorize(v:boolean){authorize=v;},setBody(v:any){body=v;},body,setMode(v:string){mode=v;}};
}
test('vision reopens private bytes, fully decodes, submits high-detail raster and accounts image modality',async()=>{
 const f=await fixture(),t=createWorkspaceVisionTransport(f.options);const result=await t.submit(f.request);
 assert.equal(result.outcome,'completed');assert.equal(result.output?.qc_verified,false);assert.deepEqual(f.events,['authorize','open','dispose','reserve','bind','intent','guard','fetch','reconcile']);
 const call=f.calls[0];assert.equal(call.url,WORKSPACE_VISION_ENDPOINT);assert.equal(call.init.redirect,'error');
 const payload=JSON.parse(call.init.body);assert.equal(payload.model,'fixture-sol');assert.equal(payload.input[0].content[2].type,'input_image');assert.match(payload.input[0].content[2].image_url,/^data:image\/png;base64,/);assert.equal(payload.input[0].content[2].detail,'high');assert.equal(payload.store,false);assert.equal(payload.tools,undefined);
 assert.equal(f.requests[0].modality,'responses_vision');assert.equal(f.requests[0].data_authorization_ref,'data');assert.deepEqual(f.requests[0].input_images,[{sha256:f.request.images[0].object.sha256,bytes:f.request.images[0].object.size_bytes,mime_type:'image/png',width:24,height:20}]);
 assert.equal((await t.submit(f.request)).code,'OPERATION_ALREADY_ATTEMPTED');assert.equal(f.calls.length,1);
});
test('current project exact image capability and processor scope are required, no inferred Terra API name',async()=>{
 const f=await fixture();for(const mutation of [()=>({...f.options,capability:{...f.options.capability,image_input:false}}),()=>({...f.options,capability:{...f.options.capability,expires_at:'2020-01-01'}}),()=>({...f.options,authorization:{...f.options.authorization,data_destination:'https://evil.test'}})])assert.throws(()=>createWorkspaceVisionTransport(mutation() as any));
 f.options.capability={...f.options.capability,family:'terra',model:'operator-verified-terra-id',accepted_response_models:['operator-verified-terra-id']};f.setBody({...f.body,model:'operator-verified-terra-id'});
 assert.equal((await createWorkspaceVisionTransport(f.options).submit(f.request)).outcome,'completed');
});
test('URL injection, model switch, non-private/cross-user inputs cannot submit',async()=>{
 for(const mutation of [(r:any)=>r.model='other',(r:any)=>r.images[0].url='https://evil.test/image.png',(r:any)=>r.images[0].object.owner_id='other',(r:any)=>r.images[0].object.storage_key='https://evil.test',(r:any)=>r.images[0].detail='low',(r:any)=>r.images=[]]){
  const f=await fixture(),r=structuredClone(f.request);mutation(r);const result=await createWorkspaceVisionTransport(f.options).submit(r);assert.equal(result.submission,'not_submitted');assert.equal(f.calls.length,0);assert.equal(f.requests.length,0);
 }
});
test('denied data, changed private bytes, header-only and corrupted images fail before reservation',async()=>{
 const denied=await fixture();denied.setAuthorize(false);assert.equal((await createWorkspaceVisionTransport(denied.options).submit(denied.request)).code,'PRIVATE_RASTER_UNVERIFIED');assert.equal(denied.calls.length,0);
 const corrupt=await fixture();corrupt.setData(new Uint8Array([1,2,3]));assert.equal((await createWorkspaceVisionTransport(corrupt.options).submit(corrupt.request)).code,'PRIVATE_RASTER_UNVERIFIED');assert.equal(corrupt.requests.length,0);
 const truncated=await fixture();const bytes=Buffer.from('89504e470d0a1a0a0000000d4948445200000018000000140802000000','hex');truncated.setData(bytes);Object.assign(truncated.request.images[0].object,{size_bytes:bytes.length,sha256:sha(bytes),storage_key:workspaceObjectKey('owner','task',sha(bytes))});assert.equal((await createWorkspaceVisionTransport(truncated.options).submit(truncated.request)).code,'PRIVATE_RASTER_UNVERIFIED');assert.equal(truncated.requests.length,0);
});
test('unknown submission remains held, does not retry or expose secrets',async()=>{
 const f=await fixture();f.setMode('throw');const t=createWorkspaceVisionTransport(f.options),result=await t.submit(f.request);assert.equal(result.outcome,'unknown');assert.equal(result.reconciliation_required,true);assert.equal(result.accounting,'held');assert.equal(JSON.stringify(result).includes(SECRET),false);await t.submit(f.request);assert.equal(f.calls.length,1);
});
test('timeout, missing usage, refusal and changed model never become completed QC',async()=>{
 for(const change of [{usage:undefined},{model:'other'},{output:[{type:'message',id:'m',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'No'}]}]},{usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{image_tokens:4}}}]){
 const f=await fixture();f.setBody({...f.body,...change});const r=await createWorkspaceVisionTransport(f.options).submit(f.request);assert.notEqual(r.outcome,'completed');assert.equal(r.output,undefined);}
 const f=await fixture();f.setMode('hang');const r=await createWorkspaceVisionTransport(f.options).submit(f.request);assert.equal(r.outcome,'unknown');assert.equal(r.accounting,'held');
});
test('denied reservation and unsettled accounting cannot yield a usable completion',async()=>{
 const f=await fixture();f.options.budget.reserve=async()=>({status:'denied'});assert.equal((await createWorkspaceVisionTransport(f.options).submit(f.request)).code,'BUDGET_DENIED');assert.equal(f.calls.length,0);
 const g=await fixture();g.options.budget.reconcile=async()=>{throw Error('unavailable');};const r=await createWorkspaceVisionTransport(g.options).submit(g.request);assert.equal(r.reconciliation_required,true);assert.equal(r.accounting,'pending_reconciliation');
});
test('runner reservation binding and live dispatch guard are mandatory and fail before paid I/O',async()=>{
 const f=await fixture();assert.throws(()=>createWorkspaceVisionTransport({...f.options,bindReservation:undefined} as any));assert.throws(()=>createWorkspaceVisionTransport({...f.options,guardDispatch:undefined} as any));
 f.options.bindReservation=async()=>{throw Error('fenced');};let result=await createWorkspaceVisionTransport(f.options).submit(f.request);assert.equal(result.submission,'not_submitted');assert.equal(result.accounting,'released');assert.equal(f.calls.length,0);
 const g=await fixture();g.options.guardDispatch=async()=>{throw Error('revoked');};result=await createWorkspaceVisionTransport(g.options).submit(g.request);assert.equal(result.submission,'not_submitted');assert.equal(result.accounting,'released');assert.equal(g.calls.length,0);
});
test('request data snapshots cannot be changed while authorization is pending',async()=>{
 const f=await fixture();let release:()=>void=()=>{};f.options.authorizeRaster=async()=>{await new Promise<void>(resolve=>release=resolve);return true;};
 const pending=createWorkspaceVisionTransport(f.options).submit(f.request);f.request.instructions='injected replacement';f.request.images[0].ref='changed';release();const r=await pending;assert.equal(r.outcome,'completed');assert.match(JSON.parse(f.calls[0].init.body).instructions,/Review JSON/);
});
test('strict structured output requires current capability and safe bounded schema',async()=>{
 const f=await fixture();f.request.response_schema={name:'independent_qc',schema:{type:'object',additionalProperties:false,required:['verdict'],properties:{verdict:{type:'string',enum:['fail','unverified','pass']}}}};
 assert.equal((await createWorkspaceVisionTransport(f.options).submit(f.request)).code,'STRICT_SCHEMA_NOT_AUTHORIZED');assert.equal(f.calls.length,0);
 f.options.capability.structured_outputs=true;const result=await createWorkspaceVisionTransport(f.options).submit(f.request);assert.equal(result.outcome,'completed');const format=JSON.parse(f.calls[0].init.body).text.format;assert.equal(format.type,'json_schema');assert.equal(format.strict,true);
 const g=await fixture();g.options.capability.structured_outputs=true;g.request.response_schema={name:'unsafe',schema:{$ref:'https://evil.test/schema'}};assert.equal((await createWorkspaceVisionTransport(g.options).submit(g.request)).code,'STRICT_SCHEMA_NOT_AUTHORIZED');assert.equal(g.calls.length,0);
});

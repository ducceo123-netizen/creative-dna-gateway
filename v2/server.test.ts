import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { createV2App, BASELINE_COMMIT } from './server.ts';
import { SqliteStore } from './store.ts';
import { testTokenVerifier } from './auth.ts';
import { hash } from './core.ts';
import { OnepageOrchestrator } from './orchestrator.ts';
import { OBSERVED_EXECUTION } from './rules.ts';
import sharp from '../tools/creative-quality/sharp.ts';
import { writeStoredZip, readStoredZip } from './delivery-zip.ts';
import { PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
function fixture(input:any){return {resolved:{brand:input.brand,branch:'onepage-system'},dynamic_job:{source_url:input.source_url,source_type:input.source_type},execution:[...OBSERVED_EXECUTION],assets:[{slot:'banner_desktop',size:'2560x960'}],hard_gates:{product_physical_truth:'HARD'},creative_quality_contract:{status:'COMPILED',errors:[],rules:[{id:'synthetic:1',instruction:'Synthetic transport fixture. Never use as production creative knowledge.',sources:[],scope:{brands:[input.brand]}}]},research_validation:{status:'AWAITING_RESEARCH'}};}
async function setup(){
 const store=new SqliteStore(':memory:');let compilerCalls=0;
 const orchestrator=new OnepageOrchestrator({store,artifacts:{get:(o,j,h)=>store.getArtifact(o,j,h),put:(o,j,b,m)=>store.putArtifact(o,j,b,m)},compile:async input=>{compilerCalls++;return fixture(input);},baselineCommit:BASELINE_COMMIT});
 const tokens={a:'uidv2_'+randomBytes(32).toString('base64url'),b:'uidv2_'+randomBytes(32).toString('base64url')};
 const verify=testTokenVerifier(Object.entries(tokens).map(([k,v])=>({tokenSha256:hash(v),owner:'tenant:'+k,subject:'user:'+k,role:'operator'})));
 const deps={orchestrator,store,verify,origin:'http://127.0.0.1'};
 const app=createV2App(deps).listen(0,'127.0.0.1');await new Promise<void>(r=>app.once('listening',r));const origin=`http://127.0.0.1:${(app.address() as any).port}`;deps.origin=origin;
 let counter=0;
 async function rpc(method:string,params?:unknown,token=tokens.a,notification=false,protocol='2025-06-18'){
   const response=await fetch(origin+'/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':protocol,...(protocol==='2026-07-28'?{'Mcp-Method':method,...((params as any)?.name?{'Mcp-Name':(params as any).name}:{})}:{})},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:++counter}),method,...(params?{params}:{})})});
   const text=await response.text();let packet:any;
   if(text){const raw=text.startsWith('{')?text:text.split('\n').filter(x=>x.startsWith('data: ')).at(-1)?.slice(6);if(raw)packet=JSON.parse(raw);}
   return {response,packet,text};
 }
 const close=async()=>{await new Promise<void>((r,j)=>app.close(e=>e?j(e):r()));store.close();};
 return {store,orchestrator,tokens,origin,rpc,close,calls:()=>compilerCalls};
}
function payload(result:any){return JSON.parse(result.packet.result.content[0].text);}
test('real SDK HTTP initialize/discovery/notifications/reconnect and isolated task calls',async()=>{
 const f=await setup();try{
   const initialized=await f.rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'uid-v2-integration',version:'1'}});
   assert.equal(initialized.response.status,200);assert.equal(initialized.packet.result.serverInfo.name,'uid-brands-architecture-v2-test');
   const notified=await f.rpc('notifications/initialized',{},f.tokens.a,true);assert.ok([200,202,204].includes(notified.response.status));
   const list=await f.rpc('tools/list',{});const names=list.packet.result.tools.map((t:any)=>t.name);
   assert.equal(new Set(names).size,names.length);assert.equal(names.length,17);assert.equal(list.packet.result.nextCursor,undefined);
   assert.ok(names.every((name:string)=>name.startsWith('onepage_')));assert.ok(!names.some((n:string)=>/feedback|train|publish|admin/.test(n)));
   const args={brand:'pawfecthouse',brief:'Synthetic MCP test only',sourceUrl:'https://pawfecthouse.com/products/synthetic-test',idempotencyKey:'mcp-1',capabilities:{artifactTransfer:true,imageInspection:true}};
   const first=payload(await f.rpc('tools/call',{name:'onepage_start',arguments:args}));assert.ok(first.jobId);assert.equal(first.testMode,true);assert.equal(first.state,'READY');
   const resumed=payload(await f.rpc('tools/call',{name:'onepage_start',arguments:args}));assert.equal(first.jobId,resumed.jobId);assert.equal(f.calls(),1);
   const denied=await f.rpc('tools/call',{name:'onepage_get_state',arguments:{jobId:first.jobId}},f.tokens.b);assert.equal(denied.packet.result.isError,true);assert.equal(payload(denied).error.code,'NOT_FOUND');
   const blocked=payload(await f.rpc('tools/call',{name:'onepage_advance',arguments:{jobId:first.jobId,revision:0}}));assert.equal(blocked.state,'BLOCKED');
   const context=payload(await f.rpc('tools/call',{name:'onepage_get_stage_context',arguments:{jobId:first.jobId}}));assert.ok(context.receipt.bundleHash);
   const fallback=payload(await f.rpc('tools/call',{name:'onepage_get_full_context',arguments:{jobId:first.jobId}}));assert.deepEqual(fallback.packet.execution,[...OBSERVED_EXECUTION]);
   const approval=await f.rpc('tools/call',{name:'onepage_approve',arguments:{jobId:first.jobId,revision:context.storageRevision,kind:'final',expectedHash:'a'.repeat(64)}});assert.equal(payload(approval).error.code,'REVIEWER_REQUIRED');
   const unlock=await f.rpc('tools/call',{name:'onepage_revision',arguments:{jobId:first.jobId,revision:context.storageRevision,scope:'content',unlockApprovedCopy:true,reason:'Synthetic unauthorized operator unlock attempt'}});assert.equal(payload(unlock).error.code,'REVIEWER_REQUIRED');
   const again=await f.rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'reconnected',version:'1'}});assert.equal(again.response.status,200);
   const state=payload(await f.rpc('tools/call',{name:'onepage_get_state',arguments:{jobId:first.jobId}}));assert.equal(state.jobId,first.jobId);
   const telemetry=payload(await f.rpc('tools/call',{name:'onepage_get_telemetry',arguments:{jobId:first.jobId}}));assert.equal(telemetry.modelTokensAvailable,false);assert.ok(telemetry.events.some((e:any)=>e.fallback===true));
 }finally{await f.close();}
});
test('transport blocks unauthenticated calls, origin attacks, malformed input and write passthrough',async()=>{
 const f=await setup();try{
   const noauth=await fetch(f.origin+'/api/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noauth.status,401);
   const badOrigin=await fetch(f.origin+'/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+f.tokens.a,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(badOrigin.status,403);
   const badHost=await new Promise<{status:number;body:string}>((resolve,reject)=>{const req=request(f.origin+'/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+f.tokens.a,Host:'evil.example','Content-Type':'application/json'}},res=>{const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode!,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end('{}');});assert.equal(badHost.status,403);assert.equal(JSON.parse(badHost.body).error,'HOST_NOT_ALLOWED');
   const badJson=await fetch(f.origin+'/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+f.tokens.a,'Content-Type':'application/json'},body:'{'});assert.equal(badJson.status,400);
   const unknown=await f.rpc('tools/call',{name:'submit_training_feedback',arguments:{}});assert.ok(unknown.packet.error||unknown.packet.result?.isError);
   const malformed=await f.rpc('tools/call',{name:'onepage_get_state',arguments:{jobId:'../other'}});assert.ok(malformed.packet.error||malformed.packet.result?.isError);
   const ssrf=await f.rpc('tools/call',{name:'onepage_start',arguments:{brand:'pawfecthouse',brief:'x',sourceUrl:'file:///etc/passwd',idempotencyKey:'bad',capabilities:{artifactTransfer:true,imageInspection:true}}});
   // Test factory uses an injected compile fixture; production source allowlist is tested in rules.test.ts.
   assert.ok(ssrf.packet);assert.equal((await fetch(f.origin+'/api/tools/submit_training_feedback',{method:'POST',headers:{Authorization:'Bearer '+f.tokens.a}})).status,404);
   const health=await fetch(f.origin+'/healthz');assert.equal(health.status,200);assert.equal((await health.json()).creativeParity,'NOT_VERIFIED');
 }finally{await f.close();}
});
test('artifact transport decodes actual bytes, enforces stored MIME and isolates uploads/downloads by owner',async()=>{
 const f=await setup();try{
  const job=f.store.create('tenant:a','upload-job','upload-job',{});
  const bytes=await sharp({create:{width:16,height:16,channels:3,background:'#aa8844'}}).png().toBuffer();
  const upload=payload(await f.rpc('tools/call',{name:'onepage_upload_artifact',arguments:{jobId:job.jobId,mime:'image/png',base64:bytes.toString('base64')}}));
  assert.equal(upload.sha256,hash(bytes));assert.equal(upload.mime,'image/png');
  const retrieved=await f.rpc('tools/call',{name:'onepage_read_artifact',arguments:{jobId:job.jobId,sha256:upload.sha256}});
  assert.equal(retrieved.packet.result.content[0].mimeType,'image/png');assert.deepEqual(Buffer.from(retrieved.packet.result.content[0].data,'base64'),bytes);
  const wrongType=await f.rpc('tools/call',{name:'onepage_upload_artifact',arguments:{jobId:job.jobId,mime:'image/webp',base64:bytes.toString('base64')}});assert.equal(payload(wrongType).error.code,'ASSET_TYPE');
  const invalid=await f.rpc('tools/call',{name:'onepage_upload_artifact',arguments:{jobId:job.jobId,mime:'image/png',base64:Buffer.from('not pixels').toString('base64')}});assert.equal(invalid.packet.result.isError,true);
  const path=f.origin+'/v2/jobs/'+job.jobId+'/artifacts';
  const otherUpload=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+f.tokens.b,'Content-Type':'image/png'},body:bytes});assert.equal(otherUpload.status,404);
  const rawUpload=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+f.tokens.a,'Content-Type':'image/png'},body:bytes});assert.equal(rawUpload.status,201);assert.equal((await rawUpload.json()).sha256,hash(bytes));
  const rawInvalid=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+f.tokens.a,'Content-Type':'image/png'},body:'not pixels'});assert.equal(rawInvalid.status,422);
  const otherDownload=await fetch(path+'/'+upload.sha256,{headers:{Authorization:'Bearer '+f.tokens.b}});assert.equal(otherDownload.status,404);
  const download=await fetch(path+'/'+upload.sha256,{headers:{Authorization:'Bearer '+f.tokens.a}});assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'image/png');assert.equal(download.headers.get('content-disposition'),`attachment; filename="${upload.sha256}.png"`);assert.match(download.headers.get('content-security-policy')||'',/sandbox/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  const list=await f.rpc('tools/list');assert.equal(list.packet.result.tools.find((t:any)=>t.name==='onepage_read_artifact').inputSchema.properties.mime,undefined);
 }finally{await f.close();}
});
test('HTTP size and authenticated request-rate limits fail closed',async()=>{
 const f=await setup();try{
  const oversized=await fetch(f.origin+'/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+f.tokens.a,'Content-Type':'application/json'},body:JSON.stringify({huge:'x'.repeat(2*1024*1024)})});assert.equal(oversized.status,413);
  const responses=[];
  for(let i=0;i<121;i++){const r=await fetch(f.origin+'/missing',{headers:{Authorization:'Bearer '+f.tokens.b}});responses.push(r.status);await r.body?.cancel();}
  assert.equal(responses.filter(v=>v===404).length,120);assert.equal(responses.at(-1),429);
  assert.equal((await fetch(f.origin+'/healthz')).status,200);
 }finally{await f.close();}
});
test('authenticated MCP resources return actual HTML and ZIP bytes only to the artifact owner',async()=>{
 const f=await setup();try{
  const job=f.store.create('tenant:a','resource-job','resource-job',{});
  const html=Buffer.from('<!doctype html><html><body>Synthetic transport fixture</body></html>');
  const zip=writeStoredZip([{name:'synthetic-preview/index.html',bytes:html}]);
  const templates=await f.rpc('resources/templates/list',{});
  assert.ok(templates.packet.result.resourceTemplates.some((r:any)=>r.uriTemplate==='uid-v2://artifacts/{jobId}/{sha256}'));
  for(const [bytes,mime] of [[html,'text/html'],[zip,'application/zip']] as const){
   const artifact=f.store.putArtifact('tenant:a',job.jobId,bytes,mime);
   const link=await f.rpc('tools/call',{name:'onepage_read_artifact',arguments:{jobId:job.jobId,sha256:artifact.sha256}});
   const content=link.packet.result.content[0];assert.equal(content.type,'resource_link');assert.equal(content.mimeType,mime);assert.equal(content.size,bytes.length);
   assert.equal(content.uri,`uid-v2://artifacts/${job.jobId}/${artifact.sha256}`);
   const resource=await f.rpc('resources/read',{uri:content.uri});assert.equal(resource.response.status,200);
   const actual=resource.packet.result.contents[0];assert.equal(actual.uri,content.uri);assert.equal(actual.mimeType,mime);
   const decoded=Buffer.from(actual.blob,'base64');assert.deepEqual(decoded,bytes);assert.equal(hash(decoded),artifact.sha256);
   if(mime==='application/zip'){const entries=readStoredZip(decoded);assert.equal(entries[0].name,'synthetic-preview/index.html');assert.deepEqual(entries[0].bytes,html);}
   const denied=await f.rpc('resources/read',{uri:content.uri},f.tokens.b);
   assert.ok(denied.packet.error,'cross-owner resource read must fail as a JSON-RPC error');assert.equal(denied.packet.result,undefined);assert.ok(!denied.text.includes(bytes.toString('base64')));
  }
 }finally{await f.close();}
});
test('SDK serves current per-request envelopes and validates content negotiation and methods',async()=>{
 const f=await setup();try{
  const legacy=await f.rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'latest-legacy',version:'1'}});
  assert.equal(legacy.packet.result.protocolVersion,'2025-11-25');
  const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'modern-test',version:'1'},[CLIENT_CAPABILITIES_META_KEY]:{}};
  const mismatch=await f.rpc('tools/list',{_meta:meta});assert.equal(mismatch.response.status,400);assert.equal(mismatch.packet.error.code,-32020);
  const modern=await f.rpc('tools/list',{_meta:meta},f.tokens.a,false,'2026-07-28');assert.equal(modern.response.status,200,modern.text);assert.equal(modern.packet.result.tools.length,17);
  const noAccept=await fetch(f.origin+'/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+f.tokens.a,'Content-Type':'application/json',Accept:''},body:JSON.stringify({jsonrpc:'2.0',id:90,method:'tools/list',params:{}})});assert.equal(noAccept.status,406);
  const get=await fetch(f.origin+'/api/mcp',{headers:{Authorization:'Bearer '+f.tokens.a,Accept:'text/event-stream'}});assert.equal(get.status,405);await get.body?.cancel();
  const del=await fetch(f.origin+'/api/mcp',{method:'DELETE',headers:{Authorization:'Bearer '+f.tokens.a}});assert.equal(del.status,405);await del.body?.cancel();
 }finally{await f.close();}
});

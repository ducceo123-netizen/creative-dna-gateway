import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.ts';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('plugin discovery, MCP initialize/reference/validate and HTTP paths use the same Scale Brands workflow',async()=>{
 // Bun shares the server module and its production rate limiter across test files.
 // Isolate transport requests in Node; do not weaken/reset the production limit for tests.
 if(process.env.UID_SCALE_TRANSPORT_ISOLATED !== '1'){
  const env:NodeJS.ProcessEnv={...process.env,UID_SCALE_TRANSPORT_ISOLATED:'1'};
  delete env.NODE_TEST_CONTEXT;
  const child=spawnSync('node',['--import','tsx','--test','--test-reporter=tap',fileURLToPath(import.meta.url)],{env,encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stdout+'\n'+child.stderr);
  assert.match(child.stdout,/^# pass 1$/m);assert.match(child.stdout,/^# fail 0$/m);assert.match(child.stdout,/^# skipped 0$/m);
  assert.match(child.stdout,/UID_SCALE_TRANSPORT_ASSERTIONS_COMPLETED/);
  return;
 }
 const original=globalThis.fetch; const calls:any[]=[];
 globalThis.fetch=async(_url,options)=>{
  const input=JSON.parse(String(options?.body));calls.push(input);
  if(input.action==='routes')return Response.json({routes:['pawfecthouse','giftsoul','soulprise'].map(brand=>({brand,branch:'brand-dna'}))});
  assert.equal(input.action,'resolve');assert.equal(input.branch,'brand-dna');
  return Response.json({resolved:{brand:input.brand,branch:'brand-dna'},brand:{slug:input.brand},branch:{slug:'brand-dna',metadata:{source_urls:['https://'+input.brand+(input.brand==='giftsoul'?'.co':'.com')]},content_md:'Synthetic canonical test rules'}});
 };
 const app=createApp().listen(0,'127.0.0.1');await new Promise<void>(r=>app.once('listening',r));
 const base=`http://127.0.0.1:${(app.address() as any).port}`;
 let seq=0;
 const mcp=async(method:string,params:any)=>{
  const response=await original(base+'/api/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});
  const wire=await response.text(); const packet=JSON.parse(wire.startsWith('{')?wire:wire.split('\n').find(l=>l.startsWith('data: '))!.slice(6));
  assert.equal(packet.error,undefined,wire);return packet.result;
 };
 try{
  const discovery:any=await (await original(base+'/api/tools')).json();assert.ok(discovery.tools.some((t:any)=>t.name==='compile_scale_brands_job'));
  const routeCall=await mcp('tools/call',{name:'list_creative_dna_routes',arguments:{}});
  const routeData=JSON.parse(routeCall.content[0].text);
  assert.deepEqual(routeData.routes.filter((r:any)=>r.branch==='scale-brands').map((r:any)=>r.brand).sort(),['giftsoul','pawfecthouse','soulprise']);
  const httpRoutes:any=await (await original(base+'/api/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
  assert.equal(httpRoutes.routes.filter((r:any)=>r.branch==='scale-brands').length,3);
  const launcher=await mcp('tools/call',{name:'launch_creative_dna',arguments:{}});
  assert.match(JSON.stringify(launcher),/scale-brands/);
  const entry=await mcp('tools/call',{name:'resolve_creative_dna',arguments:{brand:'GiftSoul',branch:'Scale Brands'}});
  const entryData=JSON.parse(entry.content[0].text);
  assert.equal(entryData.entrypoint.tool,'compile_scale_brands_job');assert.equal(entryData.resolved.branch,'scale-brands');
  const routed=await mcp('tools/call',{name:'resolve_creative_dna',arguments:{brand:'GiftSoul',branch:'scale-brands',source_url:'https://giftsoul.co'}});
  assert.equal(JSON.parse(routed.content[0].text).status,'AWAITING_BASELINES');
  const listed=await mcp('tools/list',{});assert.ok(listed.tools.some((t:any)=>t.name==='get_scale_brands_reference'));
  for(const brand of ['pawfecthouse','giftsoul','soulprise']){
   const store='https://'+brand+(brand==='giftsoul'?'.co':'.com');
   const result=await mcp('tools/call',{name:'compile_scale_brands_job',arguments:{brand,store_url:store}});
   assert.equal(result.isError,false);assert.equal(result.structuredContent.status,'AWAITING_BASELINES');assert.equal(result.structuredContent.brand,brand);
   assert.equal(result.structuredContent.regions.length,5);assert.equal(result.structuredContent.ldp_workflow,undefined);
  }
  const reference=await mcp('tools/call',{name:'get_scale_brands_reference',arguments:{name:'pic-playbooks.md'}});
  assert.match(reference.structuredContent.content,/Candidate-common/);
  const bad=await mcp('tools/call',{name:'compile_scale_brands_job',arguments:{brand:'giftsoul',store_url:'https://pawfecthouse.com'}});
  assert.equal(bad.isError,true);assert.equal(bad.structuredContent.status,'STORE_BRAND_MISMATCH');
  const pending:any=await (await original(base+'/api/scale-brands/compile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brand:'giftsoul',store_url:'https://giftsoul.co'})})).json();
  const payload={brand:'giftsoul',store_url:'https://giftsoul.co',job:{schema_version:'uid-scale-brands/1',task_id:'transport-fixture',revision:'v1',canonical_snapshot:pending.canonical_snapshot,evidence:[],regions:pending.regions.map((r:any)=>({id:r.id}))}};
  const validation=await mcp('tools/call',{name:'compile_scale_brands_job',arguments:payload});assert.equal(validation.structuredContent.status,'INCOMPLETE');
  const invalid=await original(base+'/api/tools/compile_scale_brands_job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brand:'giftsoul',store_url:'https://giftsoul.co',secret:'not allowed'})});assert.equal(invalid.status,400);
  console.log('UID_SCALE_TRANSPORT_ASSERTIONS_COMPLETED');
  assert.ok(calls.every(c=>c.action==='routes'||c.action==='resolve')); // no writes and no LDP fallback
 }finally{globalThis.fetch=original;await new Promise<void>((resolve,reject)=>app.close(e=>e?reject(e):resolve()));}
});

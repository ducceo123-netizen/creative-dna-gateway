import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOnepageJob, resolveCreativeDna, createApp } from '../server.ts';
import { RESEARCH_VERSION } from '../supabase/functions/_shared/product-research.ts';
import { readFileSync } from 'node:fs';

const source='https://store.example/collections/gifts/products/mug';
test('gateway overlays research on every brand/material including virtual routes without canonical mutation',async()=>{
  const original=globalThis.fetch;
  const requests:any[]=[];
  try {
    globalThis.fetch=async(_url:any,init:any)=>{
      const request=JSON.parse(init.body);requests.push(request);
      return Response.json({brand:{slug:request.brand},branch:{slug:request.branch==='Onepage'?'onepage-system':request.branch,content_md:'Original canonical rules'},instruction:'Original rule guidance'});
    };
    for(const brand of ['PawfectHouse','GiftSoul','SoulPrise']) for(const branch of ['Home Hero','Onepage']) {
      const result=await resolveCreativeDna(brand,branch,{source_url:source});
      assert.equal(result.data.research_validation.status,'AWAITING_RESEARCH');
      assert.equal(result.data.research_contract.schema_version,RESEARCH_VERSION);
      assert.equal(result.data.research_validation.pdp_coverage,branch==='Onepage'?'REQUIRED_HOST_REPORTED_ONLY':'NOT_REQUIRED_FOR_THIS_ROUTE');
      assert.ok(['REQUIRES_RESEARCH','BLOCKED'].includes(result.data.readiness.content_authoring));
      assert.equal(result.data.branch.content_md,'Original canonical rules');
    }
    const combo=await resolveCreativeDna('PawfectHouse','Niche Product Combo',{source_url:source,research:{schema_version:RESEARCH_VERSION}});
    assert.equal(combo.data.research_validation.status,'NEEDS_EVIDENCE');
    assert.equal(combo.data.resolved.branch,'niche-product-combo');
    await compileOnepageJob('PawfectHouse',source,'auto','Gift',{schema_version:RESEARCH_VERSION});
    assert.deepEqual(requests.at(-1).research,{schema_version:RESEARCH_VERSION});
    assert.equal(requests.at(-1).source_url,source);
  } finally {globalThis.fetch=original;}
});

test('HTTP, MCP and Actions schemas preserve optional research intake and old initialization',async()=>{
  const app=createApp().listen(0,'127.0.0.1');await new Promise<void>(r=>app.once('listening',r));
  const origin=`http://127.0.0.1:${(app.address() as any).port}`, original=globalThis.fetch;
  try {
    globalThis.fetch=async(url:any,init:any)=>String(url).startsWith(origin)?original(url,init):Response.json({brand:{slug:'pawfecthouse'},branch:{slug:'home-hero',content_md:'unchanged'}});
    const post=async(path:string,body:any)=>(await original(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify(body)}));
    for(const path of ['/api/resolve','/api/tools/resolve_creative_dna']) {
      const init=await post(path,{brand:'PawfectHouse',branch:'Home Hero'});
      assert.equal(init.status,200);assert.equal((await init.json()).research_validation.status,'AWAITING_RESEARCH');
      const r=await post(path,{brand:'PawfectHouse',branch:'Home Hero',source_url:source,research:{schema_version:RESEARCH_VERSION}});
      const result=await r.json();assert.equal(result.research_validation.status,'NEEDS_EVIDENCE');assert.equal(result.readiness.content_authoring,'REQUIRES_RESEARCH');
    }
    const compile=await post('/api/tools/compile_onepage_job',{brand:'PawfectHouse',source_url:source,research:{schema_version:RESEARCH_VERSION}});
    assert.equal((await compile.json()).research_validation.status,'NEEDS_EVIDENCE');
    const schema=await (await original(origin+'/api/openapi.json')).json();
    const props=schema.paths['/api/resolve'].post.requestBody.content['application/json'].schema.properties;
    for(const key of ['source_url','source_type','research']) assert.ok(props[key],key);
    const listed=await post('/api/mcp',{jsonrpc:'2.0',id:1,method:'tools/list',params:{}});
    const wire=await listed.text();
    assert.match(wire,/research/);assert.match(wire,/compile_onepage_job/);
    const call=await post('/api/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'resolve_creative_dna',arguments:{brand:'PawfectHouse',branch:'Home Hero',source_url:source,research:{schema_version:RESEARCH_VERSION}}}});
    assert.match(await call.text(),/NEEDS_EVIDENCE/);
  } finally {globalThis.fetch=original;await new Promise<void>((r,j)=>app.close(e=>e?j(e):r()));}
});

test('launcher and shared continuation use one research policy without changing review UI controls',()=>{
  const launcher=readFileSync('uid-brands-workflow.ts','utf8'),actions=readFileSync('uid-brands-actions.ts','utf8');
  assert.match(launcher,/JSON.stringify\(RESEARCH_GUIDANCE\)/);
  assert.match(actions,/REVIEW_EXECUTION_GUIDANCE = RESEARCH_GUIDANCE/);
});

test('PDP coverage follows canonical resolver identity, not caller alias or override',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({resolved:{brand:'pawfecthouse',branch:'onepage-system'}});
  const alias=await resolveCreativeDna('PawfectHouse','Custom Onepage Alias',{source_url:source,require_pdp_coverage:false} as any);
  assert.equal(alias.data.research_validation.pdp_coverage,'REQUIRED_HOST_REPORTED_ONLY');
  globalThis.fetch=async()=>Response.json({branch:{slug:'home-hero'}});
  const other=await resolveCreativeDna('PawfectHouse','Onepage',{source_url:source,require_pdp_coverage:true} as any);
  assert.equal(other.data.research_validation.pdp_coverage,'NOT_REQUIRED_FOR_THIS_ROUTE');
 }finally{globalThis.fetch=original;}
});

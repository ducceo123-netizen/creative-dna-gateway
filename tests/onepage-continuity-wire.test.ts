import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp, compileOnepageJob} from '../server.ts';
import {createOnepageNamedProductSourceResolver} from '../uid-onepage-source-resolution.ts';

// Transport fixtures, not production research or pixel-inspection receipts.
const canonical = {
  resolved:{brand:'pawfecthouse',branch:'onepage-system',quality_revision:'unchanged-r1'},
  hard_gates:{content_approval:'AUTO_CONTINUE_NO_INTERMEDIATE_CONTENT_SIGNOFF',product_physical_truth:'HARD_MULTI_SOURCE'},
  content_to_materials_contract:{require_intermediate_content_approval:false,allow_explicit_user_review_first:true,final_outcome_review_required:true},
  creative_quality_contract:{status:'COMPILED',rules:[],contract_hash:'fixture-canonical-hash'},
  readiness:{asset_generation:'REQUIRES_PRODUCT_PIXEL_INSPECTION'},
  acquisition_contract:{min_verified_designs:4},
  clipo_reference_discovery:{attempted:true,status:'no_match',continue_task:true},
};
const product=(id:number,type:string)=>({id,title:'Oven Skirt '+id,handle:'fixture-'+id,product_type:type});

test('MCP, HTTP and resumed research preserve exact family, policy and nonterminal content semantics',async()=>{
  const app=createApp().listen(0,'127.0.0.1');
  await new Promise<void>(r=>app.once('listening',r));
  const origin=`http://127.0.0.1:${(app.address() as any).port}`;
  const original=globalThis.fetch, requests:any[]=[];
  let catalogMode:'valid'|'unavailable'|'no_match'='valid',catalogCalls=0;
  globalThis.fetch=async(url,init)=>{
    const address=String(url);
    if(address.startsWith(origin)) return original(url,init);
    if(address.includes('/creative-dna-compile-onepage')) {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json(structuredClone(canonical));
    }
    if(address.startsWith('https://pawfecthouse.com/products.json?')) {
      catalogCalls++;
      if(catalogMode==='unavailable') return new Response('Unavailable',{status:503});
      const page=Number(new URL(address).searchParams.get('page'));
      return Response.json({products:page===1?[product(1,catalogMode==='valid'?'Oven Skirt':'Apron'),product(2,catalogMode==='valid'?'Oven Skirt':'Apron'),product(3,'Poster')]:[]});
    }
    return Response.json({result:{content:[{type:'text',text:JSON.stringify({status:'no_match',matches:[]})}]}});
  };
  let id=0;
  const rpc=async(name:string,args:unknown)=>{
    const response=await original(origin+'/api/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})});
    assert.equal(response.status,200);
    const wire=await response.text();
    const result=(wire.startsWith('{')?JSON.parse(wire):JSON.parse(wire.split('\n').find(line=>line.startsWith('data: '))!.slice(6))).result;
    assert.equal(result.isError,false);
    return JSON.parse(result.content.find((item:any)=>item.type==='text'&&item.text.startsWith('{')).text);
  };
  try {
    const http=await original(origin+'/api/tools/compile_onepage_job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brand:'PawfectHouse',product_line:'Oven Skirt'})});
    assert.equal(http.status,200);
    const first=await http.json();
    const mcp=await rpc('compile_onepage_job',{brand:'PawfectHouse',product_line:'Oven Skirt'});
    for(const packet of [first,mcp]) {
      assert.equal(packet.named_product_scope.status,'RESOLVED');
      assert.deepEqual(packet.named_product_scope.product_ids,['1','2']);
      assert.equal(packet.named_product_scope.storefront_collection_url,null);
      assert.equal(packet.named_product_scope.pixels_inspected,false);
      assert.equal(packet.named_product_scope.catalog_complete,true);
      assert.equal(packet.named_product_scope.source_url,'https://pawfecthouse.com/products.json');
      assert.equal(packet.dynamic_job.product_line,'Oven Skirt');
      assert.deepEqual(packet.hard_gates,canonical.hard_gates);
      assert.deepEqual(packet.creative_quality_contract,canonical.creative_quality_contract);
      assert.equal(packet.content_plan_assessment.content_approval,'AUTO_CONTINUE_WITHIN_AUTHORIZED_SCOPE');
      assert.equal(packet.content_plan_assessment.status,'BLOCKED_BY_EXISTING_POLICY','minimal fixture must not evade template/canonical policy guards');
      assert.equal(packet.readiness.asset_generation,'REQUIRES_PRODUCT_PIXEL_INSPECTION');
    }
    assert.ok(requests.every(r=>r.source_url==='https://pawfecthouse.com/products.json'&&r.source_type==='collection'));
    const before=catalogCalls;
    await compileOnepageJob('PawfectHouse',first.named_product_scope.source_url,'collection',undefined,{},'Oven Skirt');
    assert.ok(catalogCalls>before,'catalog evidence URL on resubmission must not bypass exact family validation');
    const missingSelector=await compileOnepageJob('PawfectHouse',first.named_product_scope.source_url,'collection');
    assert.equal(missingSelector.data.source_execution_guard.status,'BLOCKED');
    assert.equal(missingSelector.data.named_product_scope.recovery.action,'CORRECT_INPUT');
    const after=catalogCalls;
    const pdp=await compileOnepageJob('PawfectHouse','https://pawfecthouse.com/products/explicit','product',undefined,undefined,'Oven Skirt');
    assert.equal(catalogCalls,after,'an explicit PDP does not expand into a named family');
    assert.equal(pdp.data.named_product_scope,undefined);
    assert.equal(requests.at(-1).source_url,'https://pawfecthouse.com/products/explicit');
    for(const mode of ['no_match','unavailable'] as const) {
      catalogMode=mode;
      const blocked=await compileOnepageJob('PawfectHouse',undefined,undefined,undefined,undefined,'Oven Skirt');
      assert.equal(blocked.data.source_execution_guard.status,'BLOCKED');
      assert.equal(blocked.data.readiness.asset_generation,'BLOCKED_NAMED_PRODUCT_SCOPE');
      assert.deepEqual(blocked.data.creative_quality_contract,canonical.creative_quality_contract);
      assert.equal(blocked.data.named_product_scope.recovery.action,mode==='no_match'?'CLARIFY_EXACT_PRODUCT_TYPE':'RETRY_CATALOG_SCAN');
    }
  } finally {
    globalThis.fetch=original;
    await new Promise<void>((r,j)=>app.close(e=>e?j(e):r()));
  }
});


test('compiler supplies executable existing-tool continuation, strips cursor from research and preserves policy',async()=>{
  const original=globalThis.fetch, requests:any[]=[];let unavailable=false;
  globalThis.fetch=async(url,init)=>{
    if(String(url).includes('/creative-dna-compile-onepage')) { requests.push(JSON.parse(String(init?.body)));if(unavailable)return Response.json({error:'fixture unavailable'},{status:503});return Response.json(structuredClone(canonical)); }
    return Response.json({result:{content:[{type:'text',text:'{"status":"no_match","matches":[]}'}]}});
  };
  const scanner=createOnepageNamedProductSourceResolver();
  const catalogFetch:typeof fetch=async url=>{
    const page=Number(new URL(String(url)).searchParams.get('page'));
    return Response.json({products:page<=2?[{...product(page,'Oven Skirt'),title:'x'.repeat(450)}]:[]});
  };
  const resolver:typeof scanner=input=>scanner(input,catalogFetch,{concurrency:1,maxTotalBytes:800});
  try {
    const first=await compileOnepageJob('PawfectHouse',undefined,undefined,'Theme',undefined,'Oven Skirt',undefined,resolver);
    assert.equal(first.data.source_execution_guard.status,'IN_PROGRESS');
    assert.equal(first.data.readiness.asset_generation,'BLOCKED_NAMED_PRODUCT_SCOPE');
    assert.equal(first.data.named_product_scope.catalog_complete,false);
    const next=first.data.source_execution_guard.next_action;
    assert.equal(next.tool,'compile_onepage_job');
    assert.equal(next.preserve_existing_research,true);
    assert.match(next.arguments.research.catalog_scan_id,/^[a-f0-9]{64}$/);
    const a=next.arguments;
    const final=await compileOnepageJob(a.brand,a.source_url,a.source_type,a.theme,a.research,a.product_line,undefined,resolver);
    assert.equal(final.data.named_product_scope.status,'RESOLVED');
    assert.deepEqual(final.data.named_product_scope.product_ids,['1','2']);
    assert.equal(final.data.source_execution_guard,undefined);
    assert.deepEqual(final.data.hard_gates,canonical.hard_gates);
    assert.ok(requests.every(r=>!r.research?.catalog_scan_id),'opaque read cursor must not become canonical research');
    const before=requests.length;
    const replay=await compileOnepageJob(a.brand,a.source_url,a.source_type,a.theme,{product_type:a.product_line,catalog_scan_id:final.data.named_product_scope.scan_id},undefined,undefined,resolver);
    assert.equal(replay.data.named_product_scope.status,'RESOLVED');
    assert.equal(requests.length,before+1,'canonical rules still refresh on completed catalog reuse');
    const independent=createOnepageNamedProductSourceResolver();
    const recoveryResolver:typeof independent=input=>independent(input,catalogFetch,{concurrency:1,maxTotalBytes:800});
    unavailable=true;
    const failed=await compileOnepageJob('PawfectHouse',undefined,undefined,undefined,undefined,'Oven Skirt',undefined,recoveryResolver);
    assert.equal(failed.ok,false);
    assert.match(failed.data.source_resolution_resume.catalog_scan_id,/^[a-f0-9]{64}$/);
    unavailable=false;
    const recovered=await compileOnepageJob('PawfectHouse',undefined,undefined,undefined,{catalog_scan_id:failed.data.source_resolution_resume.catalog_scan_id},'Oven Skirt',undefined,recoveryResolver);
    assert.equal(recovered.data.named_product_scope.status,'RESOLVED','upstream failure must not orphan the source scan');

  } finally {globalThis.fetch=original;}
});

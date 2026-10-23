import { attachResearch } from '../supabase/functions/_shared/product-research.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {compileCreativeQuality,sourceHashes,QUALITY_SCHEMA,QUALITY_COMPILER} from '../supabase/functions/_shared/creative-quality.ts';
import {buildOnepagePacket} from '../supabase/functions/_shared/onepage-packet.ts';
import {getOnepageUiTemplate,attachOnepageUiTemplate} from '../onepage-ui-template.ts';
async function invoke(slug:string, payload:unknown, data:unknown, method='POST') {
  const source=readFileSync(`supabase/functions/${slug}/index.ts`,'utf8').replace(/^import .*;\n/gm,'');
  const compiled=transformSync(source,{loader:'ts',format:'cjs',target:'es2022'}).code;
  let handler:(req:Request)=>Promise<Response>;
  const Deno={env:{get:(key:string)=>key==='SUPABASE_URL'?'https://example.supabase.co':key==='SUPABASE_SERVICE_ROLE_KEY'?'test-only':undefined},serve:(fn:any)=>{handler=fn}};
  const rpcCalls:any[]=[];
  const createClient=()=>({rpc:async(...args:any[])=>{rpcCalls.push(args);return {data,error:null}}});
  new Function('Deno','createClient','compileCreativeQuality','buildOnepagePacket','attachResearch',compiled)(Deno,createClient,compileCreativeQuality,buildOnepagePacket,attachResearch);
  const response=await handler!(new Request('https://example.test',{method,headers:{'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(payload)}:{})}));
  return {response,body:await response.json(),rpcCalls};
}
test('real edge handler paths share quality failure semantics without swallowing missing canonical state', async()=>{
  const dna={brand:{slug:'pawfecthouse'},branch:{slug:'onepage-system',content_md:'current',metadata:{}},brand_dna:{slug:'brand-dna',content_md:'brand',metadata:{}}};
  const resolver=await invoke('creative-dna-public',{brand:'PawfectHouse',branch:'Onepage'},dna);
  const compiler=await invoke('creative-dna-compile-onepage',{brand:'PawfectHouse'},dna);
  assert.equal(resolver.response.status,200);assert.equal(compiler.response.status,200);
  assert.equal(resolver.response.headers.get('cache-control'),'no-store');assert.equal(compiler.response.headers.get('cache-control'),'no-store');
  assert.equal(resolver.body.creative_quality_contract.contract_hash,compiler.body.creative_quality_contract.contract_hash);
  assert.deepEqual(compiler.body.creative_quality_contract.errors,['QUALITY_CONTRACT_MISSING']);
  assert.equal(compiler.body.readiness.content_authoring,'BLOCKED');
  assert.equal(compiler.rpcCalls[0][0],'resolve_creative_dna_alias');
  const invalid=await invoke('creative-dna-compile-onepage',{brand:'PawfectHouse',source_type:'bad'},dna);
  assert.equal(invalid.response.status,422);
});
test('packet has an explicit binding for every current template image slot, including mobile Details', async()=>{
  const dna={brand:{slug:'pawfecthouse'},branch:{slug:'onepage-system',content_md:'current',metadata:{}},brand_dna:{slug:'brand-dna',content_md:'brand',metadata:{}}};
  const packet=await buildOnepagePacket(dna);
  const slots=new Set(packet.assets.map(a=>a.slot));
  const aliases:Record<string,string>=packet.template_asset_bindings;
  for(const slot of getOnepageUiTemplate().asset_slots) assert.ok(slots.has(slot)||slots.has(aliases[slot]),slot);
  assert.equal(aliases.occasion_story_01_mobile,'detail_main');
});
test('resolver leaves non-Onepage routes without a curated contract unchanged', async()=>{
  const dna={api_version:'1.1',brand:{slug:'pawfecthouse'},branch:{slug:'ldp-system',content_md:'Existing LDP rules',metadata:{}},brand_dna:{slug:'brand-dna',content_md:'brand',metadata:{}}};
  const result=await invoke('creative-dna-public',{brand:'PawfectHouse',branch:'LDP'},dna);
  assert.equal(result.response.status,200);assert.equal(result.body.api_version,'1.1');
  assert.equal(result.body.creative_quality_contract,undefined);assert.equal(result.body.branch.content_md,'Existing LDP rules');
  assert.equal(result.body.resolved.branch,'ldp-system');
});


test('resolver, compiler and gateway preserve optional-reference readiness for all three brands',async()=>{
  for(const brand of ['pawfecthouse','giftsoul','soulprise']) {
    const dna={brand:{slug:brand},branch:{slug:'onepage-system',version:'1',content_md:'Verified product-led rules',metadata:{} as Record<string,unknown>},brand_dna:{slug:'brand-dna',version:'1',content_md:'Active brand expression',metadata:{}}};
    const scope={brands:[brand],branches:['onepage-system']};
    const rules=['content','typography','banner','proof','brand_style','delivery','workflow'].map(category=>({id:category,key:category==='brand_style'?'brand.active_expression':category,value:category,instruction:'Keep active '+category+' rule',category,scope,sources:[{node:category==='brand_style'?'brand_dna':'branch',locator:'approved canonical policy'}],reference_ids:category==='typography'?['optional-case']:[]}));
    dna.branch.metadata.creative_quality_contract={schema_version:QUALITY_SCHEMA,revision:'optional-library',source_hashes:await sourceHashes(dna),rules,references:[{id:'optional-case',role:'legacy_style',scope,required_for:['banner_desktop'],reference_id:'libfile_private',source:{node:'branch',locator:'case inspiration'}}]};
    const resolver=await invoke('creative-dna-public',{brand,branch:'Onepage'},dna);
    const compiler=await invoke('creative-dna-compile-onepage',{brand},dna);
    const quality=resolver.body.creative_quality_contract;
    assert.equal(quality.compiler_version,QUALITY_COMPILER);
    assert.equal(quality.contract_hash,compiler.body.creative_quality_contract.contract_hash);
    assert.equal(quality.status,'COMPILED');assert.equal(quality.gates.asset_generation,'REQUIRES_PRODUCT_PIXEL_INSPECTION');
    assert.equal(compiler.body.hard_gates.product_physical_truth,'HARD_MULTI_SOURCE');
    for(const body of [resolver.body,compiler.body]) {
      const attached=attachOnepageUiTemplate(body,brand,'Onepage');
      assert.equal(attached.quality_execution_guard.status,'COMPILED');
      assert.equal(attached.quality_execution_guard.gates.asset_generation,'REQUIRES_PRODUCT_PIXEL_INSPECTION');
    }
    assert.match(resolver.body.instruction,/unavailable example does not block creation/);
  }
});

test('edge resolver attaches research to legacy routes and compiler classifies nested PDPs before content',async()=>{
  for(const brand of ['pawfecthouse','giftsoul','soulprise']) {
    const dna={brand:{slug:brand},branch:{slug:'home-hero',content_md:'Unchanged legacy rules',metadata:{}},brand_dna:{slug:'brand-dna',content_md:'brand',metadata:{}}};
    const result=await invoke('creative-dna-public',{brand,branch:'Home Hero'},dna);
    assert.equal(result.body.research_validation.status,'AWAITING_RESEARCH');
    assert.equal(result.body.readiness.content_authoring,'REQUIRES_RESEARCH');
    assert.equal(result.body.branch.content_md,dna.branch.content_md);
  }
  const dna={brand:{slug:'pawfecthouse'},branch:{slug:'onepage-system',content_md:'rules',metadata:{}},brand_dna:{slug:'brand-dna',content_md:'brand',metadata:{}}};
  const packet=await invoke('creative-dna-compile-onepage',{brand:'PawfectHouse',source_url:'https://store.example/collections/gifts/products/mug'},dna);
  assert.equal(packet.body.dynamic_job.source_type,'product');
  assert.equal(packet.body.acquisition_contract.diversity_gate,'N/A_BY_SINGLE_PDP');
  assert.equal(packet.body.research_validation.status,'AWAITING_RESEARCH');
  assert.ok(packet.body.execution.indexOf('VALIDATE_RESEARCH_BEFORE_CONTENT')<packet.body.execution.indexOf('SELECT_INCREMENTAL_CUSTOMER_VALUE'));
  assert.ok(packet.body.execution.indexOf('SELECT_INCREMENTAL_CUSTOMER_VALUE')<packet.body.execution.indexOf('BUILD_CONTENT_MAP'));
  assert.equal(packet.body.insight_value_assessment.status,'NOT_ASSESSED');
  const unknown=await invoke('creative-dna-compile-onepage',{brand:'PawfectHouse',source_url:'https://store.example/custom-path'},dna);
  assert.equal(unknown.body.dynamic_job.source_type,'unknown');
  assert.equal(unknown.body.acquisition_contract.diversity_gate,'REQUIRES_SOURCE_CLASSIFICATION');
  const invalid=await invoke('creative-dna-public',{brand:'PawfectHouse',branch:'Onepage',research:{}},dna);
  assert.equal(invalid.body.research_validation.status,'NEEDS_EVIDENCE');
});

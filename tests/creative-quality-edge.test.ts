import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {compileCreativeQuality,sourceHashes,QUALITY_SCHEMA} from '../supabase/functions/_shared/creative-quality.ts';
import {buildOnepagePacket} from '../supabase/functions/_shared/onepage-packet.ts';
import {getOnepageUiTemplate} from '../onepage-ui-template.ts';
async function invoke(slug:string, payload:unknown, data:unknown, method='POST') {
  const source=readFileSync(`supabase/functions/${slug}/index.ts`,'utf8').replace(/^import .*;\n/gm,'');
  const compiled=transformSync(source,{loader:'ts',format:'cjs',target:'es2022'}).code;
  let handler:(req:Request)=>Promise<Response>;
  const Deno={env:{get:(key:string)=>key==='SUPABASE_URL'?'https://example.supabase.co':key==='SUPABASE_SERVICE_ROLE_KEY'?'test-only':undefined},serve:(fn:any)=>{handler=fn}};
  const rpcCalls:any[]=[];
  const createClient=()=>({rpc:async(...args:any[])=>{rpcCalls.push(args);return {data,error:null}}});
  new Function('Deno','createClient','compileCreativeQuality','buildOnepagePacket',compiled)(Deno,createClient,compileCreativeQuality,buildOnepagePacket);
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

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PINTEREST_VERSION,evaluatePinterestResearch} from '../supabase/functions/_shared/pinterest-research.ts';
const check=(v?:unknown)=>evaluatePinterestResearch(v,{source_url:"https://shop.example/products/ornament",now:Date.parse("2026-10-15T09:00:00Z")});
const fixture=():any=>({schema_version:PINTEREST_VERSION,scope:{source_url:"https://shop.example/products/ornament",product:'personalized ornament',theme_topic:'family Christmas',market:'US'},searches:[{query:'family Christmas ornament typography US',observed_at:'2026-10-15T08:00:00Z',status:'completed',limitations:[]}],references:[{id:'pin1',url:'https://www.pinterest.com/pin/12345/',observed_at:'2026-10-15T08:00:00Z',status:'inspected',relevance:'Relevant ornament typography',limitations:[],inspection_method:'image_view',observations:['Centered serif name below two illustrated stockings'],adaptation:'Original restrained lettering hierarchy with own product image'}]});
test('initialization does not claim research',()=>assert.equal(check().status,'AWAITING_RESEARCH'));
test('inspection is structural only and never performance/product evidence',()=>{const r=check(fixture());assert.equal(r.status,'STRUCTURALLY_COMPLETE');assert.equal(r.allowed_use,'visual_inspiration_only');assert.equal(r.source_authenticity,'NOT_SERVER_VERIFIED');assert.equal(r.market_fit,'HYPOTHESIS_ONLY');});
test('search snippets cannot claim image inspection',()=>{const f=fixture();f.references[0].inspection_method='search_snippet';assert.ok(check(f).issues.includes('VISUAL_INSPECTION_REQUIRED'));});
test('blocked access remains partial and permits no usable visual IDs',()=>{const f=fixture();f.searches[0].status='blocked';f.searches[0].limitations=['Login wall'];f.references=[];const r=check(f);assert.equal(r.status,'PARTIAL');assert.deepEqual(r.usable_visual_reference_ids,[]);});
test('blocked search needs explanation',()=>{const f=fixture();f.searches[0].status='blocked';assert.ok(check(f).issues.includes('SEARCH_LIMITATION_REQUIRED'));});
test('blocked references cannot supply visual claims',()=>{const f=fixture();f.references[0].status='blocked';f.references[0].limitations=['Unavailable'];assert.ok(check(f).issues.includes('UNINSPECTED_VISUAL_CLAIM'));});
test('partial references stay unusable',()=>{const f=fixture();Object.assign(f.references[0],{status:'partial',limitations:['Only thumbnail accessible'],observations:[]});assert.equal(check(f).status,'PARTIAL');assert.deepEqual(check(f).usable_visual_reference_ids,[]);});
test('zero results is honest partial research',()=>{const f=fixture();f.references=[];f.searches[0].status='not_found';f.searches[0].limitations=['No matches in bounded search'];assert.equal(check(f).status,'PARTIAL');});
test('reject search URLs, lookalike hosts, credentials, other protocol and redirects',()=>{for(const url of ['https://www.pinterest.com/search/pins/?q=x','https://pinterest.com.evil.test/pin/123/','https://x:y@pinterest.com/pin/123/','http://pinterest.com/pin/123/','https://pin.it/abc']){const f=fixture();f.references[0].url=url;assert.ok(check(f).issues.includes('INVALID_REFERENCE'),url);}});
test('deduplicate canonical Pin IDs across www and slash variants',()=>{const f=fixture();f.references.push({...f.references[0],id:'pin2',url:'https://pinterest.com/pin/12345'});assert.ok(check(f).issues.includes('DUPLICATE_REFERENCE'));});
test('missing brief relevance scope fails',()=>{const f=fixture();delete f.scope.theme_topic;assert.equal(check(f).status,'NEEDS_EVIDENCE');});
test('invalid dates fail',()=>{const f=fixture();f.references[0].observed_at='yesterday';assert.ok(check(f).issues.includes('INVALID_REFERENCE'));});
test('bounded evidence rejects excess records',()=>{const f=fixture();f.searches=Array(41).fill(f.searches[0]);assert.equal(check(f).status,'NEEDS_EVIDENCE');});

test('reject cross-task evidence reuse',()=>{const f=fixture();f.scope.source_url='https://other.example/products/foo';assert.ok(check(f).issues.includes('PIN_SCOPE_SOURCE_MISMATCH'));});
test('reject known theme mismatch',()=>{assert.ok(evaluatePinterestResearch(fixture(),{source_url:'https://shop.example/products/ornament',theme:'Wedding'}).issues.includes('PIN_SCOPE_THEME_MISMATCH'));});
test('future evidence cannot pass',()=>{const f=fixture();f.references[0].observed_at='2099-01-01T00:00:00Z';assert.ok(check(f).issues.includes('INVALID_REFERENCE'));});

import {attachResearch, RESEARCH_GUIDANCE, RESEARCH_CONTRACT} from '../supabase/functions/_shared/product-research.ts';
import {compileOnepageJob, resolveCreativeDna} from '../server.ts';
import {readFileSync} from 'node:fs';
test('visual ledger never replaces product research or approval gates',()=>{
 const r=attachResearch({readiness:{asset_generation:'REQUIRES_CONTENT_APPROVAL_AND_PRODUCT_PIXELS'}},{source_url:'https://shop.example/products/ornament',research:{pinterest_research:fixture()}});
 assert.equal(r.pinterest_validation.status,'STRUCTURALLY_COMPLETE');
 assert.equal(r.research_validation.status,'NEEDS_EVIDENCE');
 assert.equal(r.readiness.content_authoring,'REQUIRES_RESEARCH');
 assert.equal(r.readiness.asset_generation,'REQUIRES_CONTENT_APPROVAL_AND_PRODUCT_PIXELS');
 assert.ok(!RESEARCH_CONTRACT.source_categories.includes('pinterest' as any));
 assert.match(RESEARCH_GUIDANCE,/Research Pinterest/);
});
test('blocked policy still blocks Pinterest visual direction',()=>{
 const r=attachResearch({creative_quality_contract:{status:'BLOCKED'}},{source_url:'https://shop.example/products/ornament',research:{pinterest_research:fixture()}});
 assert.equal(r.readiness.pinterest_visual_direction,'BLOCKED');
});
test('both live gateway entry points expose contract and honest missing research',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({branch:{slug:'onepage-system',content_md:'Canonical stays unchanged'},resolved:{branch:'onepage-system'}});
  for(const r of [await resolveCreativeDna('PawfectHouse','Onepage',{source_url:'https://shop.example/products/ornament'}),await compileOnepageJob('PawfectHouse','https://shop.example/products/ornament','product','family Christmas')]){
   assert.equal(r.data.pinterest_contract.schema_version,PINTEREST_VERSION);
   assert.equal(r.data.pinterest_validation.status,'AWAITING_RESEARCH');
   assert.ok(['REQUIRES_PINTEREST_RESEARCH','BLOCKED'].includes(r.data.readiness.pinterest_visual_direction));
   assert.equal(r.data.branch.content_md,'Canonical stays unchanged');
  }
 }finally{globalThis.fetch=original;}
});
test('direct Onepage packet includes Pinterest before content map',()=>{
 const source=readFileSync(new URL('../supabase/functions/_shared/onepage-packet.ts',import.meta.url),'utf8');
 assert.match(source,/'RESEARCH_PINTEREST_PRODUCT_THEME_MARKET_REFERENCES'/);
 assert.match(source,/\.\.\.input, require_pdp_coverage:true/);
});

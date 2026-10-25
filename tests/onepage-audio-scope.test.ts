import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {AUDIO_SCOPE_CONTRACT as contract,AUDIO_SCOPE_MANIFEST as manifest,evaluateAudioScope} from '../supabase/functions/_shared/onepage-audio-scope.ts';
import {evaluateResearch,attachResearch,validatePdpCoverage} from '../supabase/functions/_shared/product-research.ts';
const NOW=Date.parse('2026-10-25T10:30:00Z');
// Synthetic fixtures, not observed media/review receipts. Never used as production evidence.
function fixture():any {
 const gallery=manifest.inventory.map(item=>({...item,status:'inspected',method:item.kind==='video'?'video_playback':'image_view',observation:'Synthetic structural observation; not a production inspection receipt.',...(item.kind==='video'?{audio_status:'excluded_by_owner',audio_reviewed:false,visual_review:{sha256:manifest.reels[item.url],revalidated_sha256:manifest.reels[item.url],started_at:'2026-10-25T10:29:00Z',revalidated_at:'2026-10-25T10:29:30Z',tool:'synthetic-test-playback',start_seconds:0,end_seconds:8,duration_seconds:8}}:{})}));
 return {schema_version:'uid-product-research/1',review_scope:{...contract.selection},scope:{source_url:manifest.source_url,source_type:'product',products:[{...manifest.product}],inventory_complete:true,coverage_note:'Synthetic contract regression only, not actual source inspection.'},sources:[{id:'target',url:manifest.source_url,kind:'target_pdp',status:'inspected',match:'exact',product_ids:[manifest.product.id],product_versions:{[manifest.product.id]:manifest.product.variant},observed_at:'2026-10-25T10:29:00Z',excerpts:['Synthetic source text.'],sections:['description','specifications','options','care_use'].map(name=>({name,status:'inspected',note:'Synthetic source text only.'})),pdp_coverage:{schema_version:'uid-pdp-coverage/1',inventory_complete:true,enumeration_note:'Synthetic fixed inventory for structural regression only.',gallery:{discovered_count:gallery.length,items:gallery},details:{discovered_count:1,items:[{id:'details',label:'Specifications',status:'inspected',method:'source_text',variant:manifest.product.variant,observation:'Synthetic specification text.'}]}}}],coverage:['target_pdp','target_reviews','marketplace','competitor','supplier'].map(category=>({category,status:category==='target_pdp'?'inspected':'not_found',source_ids:category==='target_pdp'?['target']:[],notes:'Synthetic limited coverage, not research.'})),claims:[{id:'fact',text:'Synthetic fact.',kind:'product_fact',scope:'sku',product_ids:[manifest.product.id],source_ids:['target'],qualified:false,evidence_items:[{source_id:'target',item_id:'details'}]}],analysis:{insights:[{concern:'Synthetic question',claim_ids:['fact'],implication:'Synthetic bounded answer',section:'Details'}],unknowns:[],conflicts:[]}};
}
const context=(r:any):any=>({source_url:manifest.source_url,require_pdp_coverage:true,resolved_brand:'pawfecthouse',research:r});
const scope=(r:any):any=>evaluateAudioScope(context(r),r,NOW);
const reel=(r:any):any=>r.sources[0].pdp_coverage.gallery.items[9];
test('approved release selection requires full honest structural playback receipt',()=>{assert.equal(scope(fixture()).active,true);});
for(const [name,mutate] of Object.entries({
 wrongScope:(r:any):any=>r.review_scope.scope_id='other', callerWaiver:(r:any):any=>r.review_scope.owner_approved=true,
 outputAudio:(r:any):any=>r.review_scope.output_audio='included',wrongProduct:(r:any):any=>r.scope.products[0].id='other',wrongVariant:(r:any):any=>r.scope.products[0].variant='other',wrongSource:(r:any):any=>r.scope.source_url+='&other=1',
 newMedia:(r:any):any=>reel(r).url+='?changed',changedGallery:(r:any):any=>r.sources[0].pdp_coverage.gallery.items[0].url+='?changed',missingReel:(r:any):any=>r.sources[0].pdp_coverage.gallery.items.pop(),
 frameSamples:(r:any):any=>reel(r).method='frame_samples',noPlayback:(r:any):any=>delete reel(r).visual_review,
 unheardAudio:(r:any):any=>reel(r).audio_reviewed=true,fakeNoAudio:(r:any):any=>reel(r).audio_status='verified_no_audio',staleBytes:(r:any):any=>reel(r).visual_review.sha256='0'.repeat(64),changedBytes:(r:any):any=>reel(r).visual_review.revalidated_sha256='0'.repeat(64),partialPlayback:(r:any):any=>reel(r).visual_review.end_seconds=7.75,
 invalidTime:(r:any):any=>reel(r).visual_review.started_at={toString:null},invalidCheckedTime:(r:any):any=>reel(r).visual_review.revalidated_at={toString:null},
 futureTime:(r:any):any=>reel(r).visual_review.revalidated_at='2026-10-25T11:00:00Z',staleTime:(r:any):any=>reel(r).visual_review.revalidated_at='2026-10-25T10:00:00Z',tooFast:(r:any):any=>reel(r).visual_review.revalidated_at=reel(r).visual_review.started_at,
 claimFromReel:(r:any):any=>r.claims[0].evidence_items[0].item_id='reel-1',
})) test(`fail closed: ${name}`,()=>{const r=fixture();mutate(r);assert.equal(scope(r).active,false);assert.ok(scope(r).issues.length);});
test('absent grant, other brand/material, expiry cannot create exception',()=>{
 const r=fixture();delete r.review_scope;assert.equal(scope(r).active,false);
 for(const override of [{resolved_brand:'giftsoul'},{require_pdp_coverage:false},{source_url:'https://other.example'}]) assert.equal(evaluateAudioScope({...context(r),...override},fixture(),NOW).active,false);
 assert.equal(evaluateAudioScope(context(r),fixture(),Date.parse(contract.expires_at)).active,false);
});
test('default stays strict; known AAC cannot falsely claim no audio',()=>{
 const r=fixture(),c=r.sources[0].pdp_coverage;
 assert.ok(validatePdpCoverage(c,[manifest.product.variant]).issues.length);
 for(const item of c.gallery.items.filter((i:any)=>i.kind==='video')){item.audio_status='verified_no_audio';}
 assert.ok(validatePdpCoverage(c,[manifest.product.variant]).issues.includes('PDP_AUDIO_COVERAGE_CONTRADICTION'));
 // Existing actually silent and reviewed-audio paths stay structurally compatible.
 c.gallery.items=c.gallery.items.slice(9);c.gallery.discovered_count=4;
 c.gallery.items.forEach((i:any,n:number)=>{i.url=`https://fixture.example/${n}.mp4`;i.position=n+1;});
 assert.deepEqual(validatePdpCoverage(c,[manifest.product.variant]).issues,[]);
 c.gallery.items.forEach((i:any)=>{delete i.audio_status;i.audio_reviewed=true;});
 assert.deepEqual(validatePdpCoverage(c,[manifest.product.variant]).issues,[]);
});
test('limited readiness preserves policy, approval and pixel gates; no receipt is fabricated',()=>{
 mock.timers.enable({apis:['Date'],now:NOW});
 try {
 const r=fixture(),before=structuredClone(r),validation=evaluateResearch(context(r));
 assert.equal(validation.status,'READY_WITH_LIMITATIONS');assert.ok(validation.limitations.includes('AUDIO_EXCLUDED_BY_OWNER'));
 const data={resolved:{brand:'pawfecthouse'},hard_gates:{content_approval:'HARD'},readiness:{asset_generation:'REQUIRES_PRODUCT_PIXELS'}};
 const result=attachResearch(data,context(r));assert.equal(result.readiness.asset_generation,'REQUIRES_PRODUCT_PIXELS');assert.equal(result.hard_gates.content_approval,'HARD');assert.equal(result.readiness.content_authoring,'REQUIRES_HOST_EVIDENCE_REVIEW');assert.deepEqual(r,before);
 assert.equal(attachResearch({...data,creative_quality_contract:{status:'BLOCKED'}},context(r)).readiness.content_authoring,'BLOCKED');
 assert.equal(attachResearch({...data,resolved:{brand:'giftsoul'}},context(r)).research_validation.status,'NEEDS_EVIDENCE');
 delete r.review_scope;assert.equal(evaluateResearch(context(r)).status,'NEEDS_EVIDENCE');
 }finally{mock.timers.reset();}
});

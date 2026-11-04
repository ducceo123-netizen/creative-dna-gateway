import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileScaleBrands, getScaleReference, REGION_IDS, SCALE_VERSION, scaleFingerprint} from '../uid-scale-brands.ts';
const store='https://giftsoul.co';
const hash='sha256:'+'a'.repeat(64), other='sha256:'+'b'.repeat(64);
const parts={anatomy:hash,behavior:hash,app_hooks:hash,store_configuration:hash,store_content:hash};
const canonical={resolved:{brand:'giftsoul',branch:'brand-dna'},brand:{slug:'giftsoul'},branch:{slug:'brand-dna',metadata:{source_urls:[store]},content_md:'current GiftSoul rules'}};
const deps={routes:async()=>({ok:true,data:{routes:[{brand:'giftsoul',branch:'brand-dna'}]}}),resolve:async(brand:string,branch:string)=>{assert.equal(brand,'giftsoul');assert.equal(branch,'brand-dna');return {ok:true,data:canonical};}};
async function fixture(){
 const init:any=await compileScaleBrands({brand:'GiftSoul',store_url:store},deps);
 const evidence=REGION_IDS.flatMap(region=>[...Object.keys(parts),'brand_style'].map(kind=>({id:region+'-'+kind,region,kind,source_url:store+'/pages/example',observed_at:'2026-10-29T00:00:00Z',locator:'.fixture',artifact_hash:hash,observation:'Synthetic test evidence, not live verification.'})));
 const regions=REGION_IDS.map(id=>({id,baseline:{status:'host_verified',store_url:store,protected:{...parts},evidence_ids:evidence.filter(e=>e.region===id&&e.kind!=='brand_style').map(e=>e.id)},output:{store_url:store,artifact_hash:hash,protected:{...parts}},adaptations:[{property:'font',value:'Brand font',status:'observed',evidence_ids:[id+'-brand_style'],rationale:'Keep target brand font.'}],qa:['visual_desktop','visual_mobile','functional'].map(kind=>({kind,status:'passed',output_hash:hash,artifact_reference:'fixture/local-report',artifact_hash:hash,details:'Synthetic isolated fixture.'})),limitations:[]}));
 return {brand:'GiftSoul',store_url:store,job:{schema_version:SCALE_VERSION,task_id:'fixture',revision:'v1',canonical_snapshot:init.canonical_snapshot,evidence,regions}};
}
test('initializes all five regions using actual brand DNA, never LDP',async()=>{
 const result:any=await compileScaleBrands({brand:'GiftSoul',store_url:store},deps);
 assert.equal(result.status,'AWAITING_BASELINES'); assert.equal(result.regions.length,5);
 assert.equal(result.canonical.branch.content_md,canonical.branch.content_md);
 assert.equal(result.workflow.source_skill,'website-brand-ui@1.3.0');
 assert.ok(result.input_schema.properties.regions);assert.equal(result.evidence_authority,'HOST_REPORTED_NOT_SERVER_VERIFIED');
});
test('routes and canonical identities fail closed',async()=>{
 for(const [override,status] of [
  [{routes:async()=>({ok:false,data:{}})},'ROUTES_UNAVAILABLE'],
  [{routes:async()=>({ok:true,data:{routes:[{brand:'pawfecthouse',branch:'ldp-system'}]}})},'BRAND_DNA_ROUTE_UNAVAILABLE'],
  [{resolve:async()=>({ok:false,data:{}})},'CANONICAL_UNAVAILABLE'],
  [{resolve:async()=>({ok:true,data:{...canonical,resolved:{brand:'pawfecthouse',branch:'brand-dna'}}})},'CANONICAL_IDENTITY_MISMATCH'],
 ] as const){assert.equal((await compileScaleBrands({brand:'GiftSoul',store_url:store},{...deps,...override})).status,status);}
 assert.equal((await compileScaleBrands({brand:'GiftSoul',store_url:'https://pawfecthouse.com'},deps)).status,'STORE_BRAND_MISMATCH');
});
test('host QA records never become server verification or production approval',async()=>{
 const result:any=await compileScaleBrands(await fixture(),deps);
 assert.equal(result.status,'HOST_REVIEW_RECORDED');assert.equal(result.ok,true);
 assert.match(result.workflow.limitations,/cannot authenticate evidence/);
 assert.match(result.next_action,/never grants production approval/);
});
test('protects every anatomy, behavior, hook, configuration and content fingerprint',async()=>{
 for(const part of Object.keys(parts)){
  const f=await fixture();(f.job.regions[0].output.protected as any)[part]=other;
  const result:any=await compileScaleBrands(f,deps);
  assert.equal(result.status,'BLOCKED');assert.ok(result.regions[0].issues.includes('PROTECTED_CHANGE:'+part));
 }
});
test('isolates missing baselines and untested QA without approving the complete task',async()=>{
 const f:any=await fixture();delete f.job.regions[1].baseline;f.job.regions[2].qa=[];
 const result:any=await compileScaleBrands(f,deps);
 assert.equal(result.status,'INCOMPLETE');assert.equal(result.regions[0].status,'HOST_REVIEW_RECORDED');
 assert.ok(result.regions[1].pending.includes('BASELINE_NOT_VERIFIED'));assert.equal(result.regions[2].pending.length,3);
});
test('rejects stale canonical, cross-store/region evidence, duplicate IDs and stale QA',async()=>{
 const cases:Array<[string,(f:any)=>void]>=[
 ['STALE_CANONICAL_SNAPSHOT',f=>f.job.canonical_snapshot=other],
 ['CROSS_STORE_EVIDENCE',f=>f.job.evidence[0].source_url='https://pawfecthouse.com'],
 ['DUPLICATE_EVIDENCE_ID',f=>f.job.evidence[1].id=f.job.evidence[0].id],
 ['ALL_FIVE_UNIQUE_REGIONS_REQUIRED',f=>f.job.regions[1].id=f.job.regions[0].id],
 ['WRONG_REGION_EVIDENCE',f=>f.job.evidence[0].region='cart_drawer'],
 ['STALE_QA',f=>f.job.regions[0].qa[0].output_hash=other],
 ['QA_EVIDENCE_REQUIRED',f=>delete f.job.regions[0].qa[0].artifact_hash],
 ['CROSS_STORE_OUTPUT',f=>f.job.regions[0].output.store_url='https://pawfecthouse.com'],
 ];
 for(const [expected,mutate] of cases){const f=await fixture();mutate(f);const r:any=await compileScaleBrands(f,deps);assert.equal(r.status,'BLOCKED',expected);assert.match(JSON.stringify([r.issues,r.regions]),new RegExp(expected));}
});
test('strict schema rejects structural adaptations, raw configuration and signed source URLs',async()=>{
 for(const mutate of [(f:any)=>f.job.regions[0].adaptations[0].property='app_hooks',(f:any)=>f.job.regions[0].baseline.secret='private',(f:any)=>f.store_url=store+'?token=secret']){
  const f=await fixture();mutate(f);assert.equal((await compileScaleBrands(f,deps)).status,'INVALID_INPUT');
 }
});
test('bundled source is byte-identical and runtime references retain the actual source schema',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../docs/scale-brands-source-manifest.json',import.meta.url),'utf8'));
 for(const [file,digest] of Object.entries(manifest.files)){
  const bytes=readFileSync(new URL('../.agents/skills/website-brand-ui/'+file,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),digest,file);
 }
 for(const name of ['workflow.md','brand-fidelity.md','pic-playbooks.md','new-brand-mapping.schema.json']){
  assert.equal(getScaleReference({name}).content,readFileSync(new URL('../.agents/skills/website-brand-ui/references/'+name,import.meta.url),'utf8'));
 }
 assert.throws(()=>getScaleReference({name:'../../.env'}));
 assert.equal(scaleFingerprint({a:1,b:2}),scaleFingerprint({b:2,a:1}));
});

test('discovers brands from material-only routes and supports explicit host store evidence when canonical URLs are absent',async()=>{
 const materialOnly={...deps,routes:async()=>({ok:true,data:{routes:[{brand:'giftsoul',branch:'home-hero'}]}})};
 assert.equal((await compileScaleBrands({brand:'GiftSoul',store_url:store},materialOnly)).status,'AWAITING_BASELINES');
 const withoutUrls={...materialOnly,resolve:async()=>({ok:true,data:{...canonical,branch:{slug:'brand-dna',content_md:'no source URL metadata'}}})};
 const init:any=await compileScaleBrands({brand:'GiftSoul',store_url:store},withoutUrls);assert.equal(init.store_identity,'UNVERIFIED');
 const f:any=await fixture();f.job.canonical_snapshot=init.canonical_snapshot;
 assert.ok((await compileScaleBrands(f,withoutUrls) as any).issues.includes('STORE_IDENTITY_UNVERIFIED'));
 f.store_identity_evidence={brand:'GiftSoul',source_url:store,artifact_reference:'fixture/store-identity',artifact_hash:hash,observation:'Synthetic observation of same-store brand identity.'};
 const valid:any=await compileScaleBrands(f,withoutUrls);assert.equal(valid.status,'HOST_REVIEW_RECORDED');assert.equal(valid.store_identity,'HOST_REPORTED');
 f.store_identity_evidence.brand='PawfectHouse';assert.equal((await compileScaleBrands(f,withoutUrls)).status,'BLOCKED');
});

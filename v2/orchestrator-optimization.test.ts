import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from '../tools/creative-quality/sharp.ts';
import { OnepageOrchestrator, type OnepageJob, type JobStore, type ArtifactStore } from './orchestrator.ts';
import { SqliteStore, type ArtifactReceipt } from './store.ts';
import { createSnapshot, OBSERVED_EXECUTION, stageContext } from './rules.ts';
import { hash, V2Error } from './core.ts';

const owner='synthetic:optimization-owner',baselineCommit='0'.repeat(40);
function packet(){return {resolved:{brand:'pawfecthouse',branch:'onepage-system'},execution:[...OBSERVED_EXECUTION],assets:[{slot:'banner_desktop',size:'2560x960'},{slot:'banner_mobile',size:'720x700'},{slot:'gtk_01',condition:'ONLY_WHEN_GTK_SELECTED'}],hard_gates:{physical_truth:'HARD'},
  creative_quality_contract:{status:'COMPILED',errors:[],revision:'synthetic:1',rules:[{id:'synthetic:one',instruction:'Exact synthetic rule remains visible.',sources:[],scope:{brands:['pawfecthouse']}}]},
  research_validation:{status:'AWAITING_RESEARCH'},future_unknown:{list:[null,7,'exact'],flag:false},
  ui_mapping_templates:{gtk:{id:'synthetic-gtk',future:'Exact GTK instruction'},faq:{id:'synthetic-faq',future:'Exact FAQ instruction'}},
};}
async function setup(){
  const store=new SqliteStore(':memory:');let reads=0,gets=0,denied=false,afterRead:(()=>void)|undefined,overrideBytes:Buffer|undefined;
  const jobs:JobStore={findByKey:(...a)=>store.findByKey(...a),create:(...a)=>store.create(...a),update:(...a)=>store.update(...a),read:(...a)=>{reads++;if(denied)throw new V2Error('NOT_FOUND','Job expired or is not available.',404);const result=store.read(...a);const callback=afterRead;afterRead=undefined;callback?.();return result;}};
  const artifacts:ArtifactStore={get:(...a)=>{gets++;const bytes=store.getArtifact(...a);return overrideBytes??bytes;},put:(...a)=>store.putArtifact(...a)};
  const orchestrator=new OnepageOrchestrator({store:jobs,artifacts,compile:async()=>packet(),baselineCommit});
  const id=(await orchestrator.start(owner,{brand:'pawfecthouse',brief:'Synthetic optimization checks only.',sourceUrl:'https://pawfecthouse.com/products/synthetic-optimization',idempotencyKey:'optimization',capabilities:{artifactTransfer:true,imageInspection:true}})).jobId;
  const read=()=>store.read(owner,id) as OnepageJob;
  return {store,orchestrator,artifacts,id,read,reads:()=>reads,gets:()=>gets,deny:()=>{denied=true;},afterRead:(fn:()=>void)=>{afterRead=fn;},overrideBytes:(bytes:Buffer)=>{overrideBytes=bytes;},change:(fn:(j:OnepageJob)=>OnepageJob)=>store.update(owner,id,read().storageRevision,j=>fn(j as OnepageJob))};
}

test('warm context cache still requires a fresh authorized live job for every external request',async()=>{
  const f=await setup();try{
    await f.orchestrator.getStageContext(owner,f.id);const reads=f.reads();
    await f.orchestrator.getStageContext(owner,f.id);assert.equal(f.reads(),reads+1);
    await assert.rejects(f.orchestrator.getStageContext('other-owner',f.id),/not found/);
    f.deny();await assert.rejects(f.orchestrator.getStageContext(owner,f.id),/expired/);
    await assert.rejects(f.orchestrator.state(owner,f.id),/expired/);
    await assert.rejects(f.orchestrator.advance(owner,f.id,f.read().storageRevision),/expired/);
  }finally{f.store.close();}
});

test('warm cached gate proofs reject altered receipts and verified canonical conflicts',async()=>{
  const f=await setup();try{
    const context=await f.orchestrator.getStageContext(owner,f.id);
    f.change(j=>{j.coverage[OBSERVED_EXECUTION[0]].ruleHashes['synthetic:one']='0'.repeat(64);return j;});
    const blocked=await f.orchestrator.advance(owner,f.id,f.read().storageRevision);
    assert.deepEqual(blocked.completedSteps,[]);assert.equal(blocked.blockers[0],'STALE_OR_INCOMPLETE_CONTEXT_COVERAGE');
    f.change(j=>{j.coverage[OBSERVED_EXECUTION[0]]=context.receipt;const changed=structuredClone(j.snapshot.packet);changed.creative_quality_contract.status='BLOCKED';j.snapshot=createSnapshot(changed,j.snapshot.provenance);return j;});
    await f.orchestrator.getStageContext(owner,f.id);
    const conflict=await f.orchestrator.advance(owner,f.id,f.read().storageRevision);
    assert.match(conflict.blockers[0],/CANONICAL_CONTEXT_CONFLICT/);assert.deepEqual(conflict.completedSteps,[]);
    assert.deepEqual(f.read().coverage[OBSERVED_EXECUTION[0]],stageContext(f.read().snapshot,'init').receipt);
  }finally{f.store.close();}
});

test('research verifies identical artifact bytes once per submission while retaining every item/reference check',async()=>{
  const f=await setup();try{
    const bytes=await sharp({create:{width:80,height:80,channels:3,background:'#558877'}}).png().toBuffer(),artifact=f.store.putArtifact(owner,f.id,bytes,'image/png'),now=new Date().toISOString();
    const research={sources:[{id:'source-a',pdp_coverage:{gallery:{items:[{id:'item-a'},{id:'item-b'}]}}}]};
    const inspections=['item-a','item-b'].map((itemId,index)=>({id:'inspection-'+index,sourceId:'source-a',itemId,artifactHash:artifact.sha256,method:'host_pixels',observations:'Synthetic image evidence for mechanical testing.',inspectedAt:now}));
    const reference={id:'ref-a',kind:'clipo',status:'inspected',sourceUrl:'https://example.com/synthetic-reference',artifactHash:artifact.sha256,observations:'Synthetic reference for mechanical testing.',permission:'public',observedAt:now};
    const input={research,inspections,references:[reference]};
    await f.orchestrator.submitResearch(owner,f.id,f.read().storageRevision,input);assert.equal(f.gets(),1);assert.equal(f.read().inspections.length,2);assert.equal(f.read().references.length,1);
    await f.orchestrator.submitResearch(owner,f.id,f.read().storageRevision,input);assert.equal(f.gets(),2); // No cross-request evidence cache.
    const before=f.read();
    await assert.rejects(f.orchestrator.submitResearch(owner,f.id,before.storageRevision,{...input,inspections:[inspections[0],{...inspections[1],itemId:'unmapped'}]}),/exact research media item/);
    assert.deepEqual(f.read(),before);
    await assert.rejects(f.orchestrator.submitResearch(owner,f.id,before.storageRevision,{...input,references:[{...reference,kind:'eo',brand:'giftsoul',originPageUrl:'https://giftsoul.co/products/synthetic',role:'icon'}]}),/same-brand/);
    await assert.rejects(f.orchestrator.submitResearch(owner,f.id,before.storageRevision,{...input,references:[{...reference,sourceUrl:undefined}]}),/actual bytes/);
    f.overrideBytes(Buffer.from('changed bytes after the prior successful request'));
    await assert.rejects(f.orchestrator.submitResearch(owner,f.id,before.storageRevision,input),/bytes do not match/);
    assert.deepEqual(f.read(),before);
  }finally{f.store.close();}
});

test('independent exact lookup batch keeps input order and JSON shapes from one authorized revision',async()=>{
  const f=await setup();try{
    f.change(j=>({...j,research:{sources:[{id:'source-a',version:1}],marker:1},researchHash:'1'.repeat(64)}));
    const paths=['job:plan','/future_unknown/list','/future_unknown/flag','rule:synthetic:one','evidence:source-a','job:research','qc-requirements:research'];
    const expected=await Promise.all(paths.map(path=>f.orchestrator.getRuleOrEvidence(owner,f.id,path)));
    const reads=f.reads();f.afterRead(()=>f.change(j=>({...j,research:{sources:[{id:'source-a',version:2}],marker:2},researchHash:'2'.repeat(64),contentRevision:9})));
    const result=await f.orchestrator.getRulesOrEvidence(owner,f.id,paths);
    assert.equal(f.reads(),reads+1);assert.deepEqual(result.entries,paths.map((path,index)=>({path,value:expected[index]})));
    assert.equal(f.read().research?.marker,2);
    assert.equal(result.entries[0].value,null);assert.deepEqual(result.entries[1].value,[null,7,'exact']);assert.equal(result.entries[2].value,false);
    (result.entries[5].value as any).marker=999;assert.equal(f.read().research?.marker,2);
  }finally{f.store.close();}
});

test('lookup batches enforce owner, exact paths and bounds; one invalid entry fails the whole batch',async()=>{
  const f=await setup();try{
    await assert.rejects(f.orchestrator.getRulesOrEvidence('other-owner',f.id,['job:research']),/not found/);
    for(const paths of [[],['job:research','job:research'],Array.from({length:13},(_,i)=>'/item'+i),[''],['x'.repeat(2049)]])await assert.rejects(f.orchestrator.getRulesOrEvidence(owner,f.id,paths),/unique exact lookup paths/);
    const before=f.read(),reads=f.reads();await assert.rejects(f.orchestrator.getRulesOrEvidence(owner,f.id,['/future_unknown/list','/__proto__/polluted']),/UNSAFE_CONTEXT_PATH/);assert.equal(f.reads(),reads+1);assert.deepEqual(f.read(),before);
    await assert.rejects(f.orchestrator.getRulesOrEvidence(owner,f.id,['job:research','evidence:missing']),/does not exist/);
  }finally{f.store.close();}
});

test('delivery artifact batches retain every slot and revision, share exact hashes and support sequential adapters',async()=>{
  const f=await setup();try{
    const one=f.store.putArtifact(owner,f.id,Buffer.from('synthetic-byte-one'),'image/webp'),two=f.store.putArtifact(owner,f.id,Buffer.from('synthetic-byte-two'),'image/webp');
    const j=f.read();j.plan={mode:'gtk',copy:{title:'Exact synthetic copy'},allocation:{}};
    for(const [index,slot]of j.snapshot.packet.assets.entries()){const artifact=index===2?two:one;j.assets[slot.slot]={sha256:artifact.sha256,width:1,height:1,format:'webp',planHash:'1'.repeat(64),contentRevision:index+1};}
    const sequential=await (f.orchestrator as any).deliveryInput(j);assert.equal(f.gets(),2);
    const calls:string[][]=[];f.artifacts.getMany=async(o,id,hashes)=>{assert.equal(o,owner);assert.equal(id,f.id);calls.push(hashes);return hashes.slice().reverse().map(sha256=>({...f.store.artifactInfo(o,id,sha256),bytes:f.store.getArtifact(o,id,sha256)}));};
    const batched=await (f.orchestrator as any).deliveryInput(j);assert.deepEqual(batched,sequential);assert.deepEqual(calls,[[one.sha256,two.sha256]]);assert.equal(f.gets(),2);
    assert.equal(batched.assets.banner_desktop.revision,1);assert.equal(batched.assets.banner_mobile.revision,2);assert.equal(batched.assets.gtk_01.revision,3);
    // These bytes deliberately are not real images: this tests fetching only, and
    // deterministic delivery still performs its original decoding/format gates.
  }finally{f.store.close();}
});

test('delivery fails closed for missing, duplicate, unexpected or corrupted batch results',async()=>{
  const f=await setup();try{
    const bytes=Buffer.from('synthetic-batch'),artifact=f.store.putArtifact(owner,f.id,bytes,'image/webp'),j=f.read();j.plan={mode:'faq',copy:{},allocation:{}};
    for(const slot of j.snapshot.packet.assets)j.assets[slot.slot]={sha256:artifact.sha256,width:1,height:1,format:'webp',planHash:'1'.repeat(64),contentRevision:1};
    const correct:ArtifactReceipt&{bytes:Buffer}={...artifact,bytes};
    for(const records of [[],[correct,correct],[{...correct,sha256:'0'.repeat(64)}],[{...correct,byteLength:bytes.length+1}],[{...correct,bytes:Buffer.from('corrupt')}]] as Array<Array<ArtifactReceipt&{bytes:Buffer}>>){
      f.artifacts.getMany=async()=>records;await assert.rejects((f.orchestrator as any).deliveryInput(j),/Artifact batch/);
    }
    assert.equal(hash(bytes),artifact.sha256);
  }finally{f.store.close();}
});

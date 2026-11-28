import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OnepageOrchestrator, type JobStore, type OnepageJob } from './orchestrator.ts';
import { SqliteStore } from './store.ts';
import { createSnapshot, OBSERVED_EXECUTION, stageContext } from './rules.ts';
import { V2Error } from './core.ts';

const owner='synthetic:context-owner';
const baselineCommit='87bf39d1f38eb1d0baee159b921efbd7e3aaf923';
function packet(){return {
  resolved:{brand:'pawfecthouse',branch:'onepage-system'},execution:[...OBSERVED_EXECUTION],assets:[],hard_gates:{product_physical_truth:'HARD'},
  creative_quality_contract:{status:'COMPILED',revision:'synthetic:1',errors:[],rules:[{id:'synthetic:context-rule',instruction:'Retain this complete synthetic instruction.',sources:[],scope:{brands:['pawfecthouse']}}]},
  owner_supplemental_contract:{instruction:'Retain this exact synthetic owner supplement.'},
  research_validation:{status:'AWAITING_RESEARCH'},
  ui_mapping_templates:{gtk:{id:'synthetic-gtk',version:'1',fixture_note:'Full GTK fixture guidance.'},faq:{id:'synthetic-faq',version:'1',fixture_note:'Full FAQ fixture guidance.'}},
  future_unclassified_contract:{instruction:'Unknown canonical fields remain visible verbatim.'},
};}
async function setup(asyncStorage=false){
  const store=new SqliteStore(':memory:');let writes=0;
  const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
  const jobs:JobStore={
    findByKey:(...args)=>store.findByKey(...args),create:(...args)=>store.create(...args),
    read:async(...args)=>{const record=store.read(...args);if(asyncStorage)await tick();return record;},
    update:async(...args)=>{if(asyncStorage)await tick();const record=store.update(...args);writes++;return record;},
  };
  const options={store:jobs,artifacts:{get:(o:string,id:string,h:string)=>store.getArtifact(o,id,h),put:(o:string,id:string,b:Buffer,m:string)=>store.putArtifact(o,id,b,m)},compile:async()=>packet(),baselineCommit};
  const orchestrator=new OnepageOrchestrator(options);
  const started=await orchestrator.start(owner,{brand:'pawfecthouse',brief:'Synthetic context mechanics only.',sourceUrl:'https://pawfecthouse.com/products/synthetic-context',idempotencyKey:'context-test',capabilities:{artifactTransfer:true,imageInspection:true}});
  const id=started.jobId,read=()=>store.read(owner,id) as OnepageJob;
  const change=(mutate:(j:OnepageJob)=>OnepageJob)=>store.update(owner,id,read().storageRevision,j=>mutate(j as OnepageJob));
  return {store,orchestrator,started,id,read,change,writes:()=>writes,restart:()=>new OnepageOrchestrator(options)};
}
function hasCode(code:string){return (error:unknown)=>error instanceof V2Error&&error.code===code;}

test('first context load persists complete group coverage; repeated loads return full identical bundles without writes',async()=>{
  const f=await setup();try{
    assert.deepEqual(f.started.context,{stage:'init',snapshotHash:f.read().snapshot.hash,templateMode:null,bundleHash:null,loaded:false});
    assert.match(f.started.nextAction,/Load stage context/);
    const first=await f.orchestrator.getStageContext(owner,f.id);
    assert.equal(first.storageRevision,1);assert.equal(f.writes(),1);
    for(const step of OBSERVED_EXECUTION.slice(0,3))assert.deepEqual(f.read().coverage[step],first.receipt);
    const before=f.read();
    const repeated=await f.orchestrator.getStageContext(owner,f.id);
    assert.deepEqual(repeated,first);assert.equal(JSON.stringify(repeated),JSON.stringify(first));
    assert.deepEqual(f.read(),before);assert.equal(f.writes(),1);
    const state=await f.orchestrator.state(owner,f.id);
    assert.deepEqual(state.context,{stage:'init',snapshotHash:first.snapshotHash,templateMode:null,bundleHash:first.receipt.bundleHash,loaded:true});
    assert.match(state.nextAction,/Use the issued stage context/);assert.match(state.nextAction,/lost or starting a new session/);
    assert.equal(repeated.data.future_unclassified_contract.instruction,'Unknown canonical fields remain visible verbatim.');
    assert.equal(repeated.data.owner_supplemental_contract.instruction,'Retain this exact synthetic owner supplement.');
    // A returned object is not a writable alias of stored coverage or the receipt cache.
    repeated.receipt.requiredRuleIds.length=0;repeated.data.future_unclassified_contract.instruction='caller changed object';
    const restored=await f.orchestrator.getStageContext(owner,f.id);
    assert.deepEqual(restored,first);assert.equal(f.writes(),1);
    // A fresh process instance verifies persisted coverage before advertising it.
    assert.deepEqual((await f.restart().state(owner,f.id)).context,state.context);
  }finally{f.store.close();}
});

test('same-group progress retains issued context; a new group requires its own full first load',async()=>{
  const f=await setup();try{
    const first=await f.orchestrator.getStageContext(owner,f.id);
    // Represent a persisted partial group transition without changing any canonical rules.
    f.change(j=>({...j,stepIndex:1,completed:[OBSERVED_EXECUTION[0]]}));
    const before=f.read(),state=await f.orchestrator.state(owner,f.id);
    assert.equal(state.context.loaded,true);assert.equal(state.context.bundleHash,first.receipt.bundleHash);
    const next=await f.orchestrator.getStageContext(owner,f.id);
    assert.equal(next.step,OBSERVED_EXECUTION[1]);assert.deepEqual(next.receipt,first.receipt);
    assert.equal(next.storageRevision,before.storageRevision);assert.equal(f.writes(),1);
    const advanced=await f.orchestrator.advance(owner,f.id,before.storageRevision);
    assert.equal(advanced.stage,'ACQUIRE_SOURCE');assert.deepEqual(advanced.completedSteps,OBSERVED_EXECUTION.slice(0,3));
    assert.equal(advanced.context.stage,'research');assert.equal(advanced.context.loaded,false);assert.equal(advanced.context.bundleHash,null);
    const research=await f.orchestrator.getStageContext(owner,f.id),count=f.writes();
    assert.equal(research.stage,'research');assert.ok(research.data.research_validation);
    assert.deepEqual(await f.orchestrator.getStageContext(owner,f.id),research);assert.equal(f.writes(),count);
  }finally{f.store.close();}
});

test('a missing or altered companion receipt is repaired, and modified current coverage is never reported as loaded',async()=>{
  const f=await setup();try{
    const first=await f.orchestrator.getStageContext(owner,f.id);
    f.change(j=>{delete j.coverage[OBSERVED_EXECUTION[2]];return j;});
    const revision=f.read().storageRevision;
    const repaired=await f.orchestrator.getStageContext(owner,f.id);
    assert.equal(repaired.storageRevision,revision+1);assert.equal(f.writes(),2);
    assert.deepEqual(f.read().coverage[OBSERVED_EXECUTION[2]],first.receipt);
    f.change(j=>{j.coverage[OBSERVED_EXECUTION[0]].ruleHashes['synthetic:context-rule']='0'.repeat(64);return j;});
    const state=await f.orchestrator.state(owner,f.id);
    assert.equal(state.context.loaded,false);assert.equal(state.context.bundleHash,null);
    const fixed=await f.orchestrator.getStageContext(owner,f.id);
    assert.deepEqual(fixed.receipt,first.receipt);assert.equal(f.writes(),3);
  }finally{f.store.close();}
});

test('canonical replacement and GTK/FAQ changes invalidate prior receipts without omitting new context',async()=>{
  const f=await setup();try{
    const first=await f.orchestrator.getStageContext(owner,f.id);
    f.change(j=>{const replacement=structuredClone(j.snapshot.packet);replacement.creative_quality_contract.rules[0].instruction='Revised complete synthetic instruction.';j.snapshot=createSnapshot(replacement,j.snapshot.provenance);return j;});
    assert.equal((await f.orchestrator.state(owner,f.id)).context.loaded,false);
    const replaced=await f.orchestrator.getStageContext(owner,f.id);
    assert.notEqual(replaced.snapshotHash,first.snapshotHash);assert.notEqual(replaced.receipt.bundleHash,first.receipt.bundleHash);
    assert.equal(replaced.data.creative_quality_contract.rules[0].instruction,'Revised complete synthetic instruction.');
    f.change(j=>({...j,stepIndex:22,plan:{mode:'gtk',copy:{},allocation:{}}}));
    assert.equal((await f.orchestrator.state(owner,f.id)).context.loaded,false);
    const gtk=await f.orchestrator.getStageContext(owner,f.id);
    assert.equal(gtk.data.ui_mapping_templates.gtk.id,'synthetic-gtk');assert.equal(gtk.data.ui_mapping_templates.faq,undefined);
    f.change(j=>({...j,plan:{...j.plan!,mode:'faq'}}));
    const state=await f.orchestrator.state(owner,f.id);
    assert.deepEqual(state.context,{stage:'mapping',snapshotHash:f.read().snapshot.hash,templateMode:'faq',bundleHash:null,loaded:false});
    const faq=await f.orchestrator.getStageContext(owner,f.id);
    assert.equal(faq.data.ui_mapping_templates.faq.id,'synthetic-faq');assert.equal(faq.data.ui_mapping_templates.gtk,undefined);
    assert.notEqual(faq.receipt.bundleHash,gtk.receipt.bundleHash);
    assert.deepEqual(faq.receipt,stageContext(f.read().snapshot,'BUILD_UI_MAPPING_PREVIEW',{templateMode:'faq'}).receipt);
    const count=f.writes();assert.deepEqual(await f.orchestrator.getStageContext(owner,f.id),faq);assert.equal(f.writes(),count);
  }finally{f.store.close();}
});

test('summary cache rejects tampered snapshot contents even when the supplied snapshot hash is unchanged',async()=>{
  const f=await setup();try{
    await f.orchestrator.getStageContext(owner,f.id);
    assert.equal((await f.orchestrator.state(owner,f.id)).context.loaded,true);
    f.change(j=>{j.snapshot.packet.future_unclassified_contract.instruction='Tampered without recomputing the pinned hash.';return j;});
    const before=f.read(),count=f.writes();
    assert.equal((await f.orchestrator.state(owner,f.id)).context.loaded,false);
    await assert.rejects(f.orchestrator.getStageContext(owner,f.id),/SNAPSHOT_HASH_MISMATCH/);
    assert.deepEqual(f.read(),before);assert.equal(f.writes(),count);
  }finally{f.store.close();}
});

test('read-only reuse keeps ownership and cancellation checks; concurrent async first loads retain CAS protection',async()=>{
  const f=await setup(true);try{
    await assert.rejects(f.orchestrator.getStageContext('synthetic:other-owner',f.id),hasCode('NOT_FOUND'));
    const results=await Promise.allSettled([f.orchestrator.getStageContext(owner,f.id),f.orchestrator.getStageContext(owner,f.id)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;
    assert.ok(hasCode('STALE_REVISION')(rejected.reason));assert.equal(f.writes(),1);
    const first=await f.orchestrator.getStageContext(owner,f.id),before=f.read();
    const repeated=await Promise.all([f.orchestrator.getStageContext(owner,f.id),f.orchestrator.getStageContext(owner,f.id)]);
    assert.deepEqual(repeated,[first,first]);assert.deepEqual(f.read(),before);assert.equal(f.writes(),1);
    await f.orchestrator.revise(owner,f.id,before.storageRevision,{scope:'cancel',reason:'Synthetic cancellation test.'});
    const cancelled=f.read(),count=f.writes();
    await assert.rejects(f.orchestrator.getStageContext(owner,f.id),hasCode('CANCELLED'));
    assert.deepEqual(f.read(),cancelled);assert.equal(f.writes(),count);
  }finally{f.store.close();}
});

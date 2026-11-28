import test from 'node:test';
import assert from 'node:assert/strict';
import { compactState, type CompactStateMetadata } from './wire-state.ts';

const hash = (digit:string) => digit.repeat(64);
const steps = Array.from({length:23},(_,index)=>`CANONICAL_EXECUTION_STEP_${index+1}`);
function fixture():Record<string,any> {
  return {
    jobId:'fac269fd-9915-41e3-8ea0-23fe59ae3b53',storageRevision:42,contentRevision:7,
    state:'BLOCKED',stage:'REVIEW',completedSteps:[...steps,'OVERALL_QC'],canonicalSteps:[...steps],
    canonicalHash:hash('a'),canonicalRevision:{brand:'pawfecthouse',dna_version:'test',quality_contract_hash:hash('b')},
    blockers:['FINAL_OUTCOME_APPROVAL_REQUIRED'],conflicts:[{id:'conflict-1',reason:'Synthetic unresolved policy'}],
    mode:'gtk',productLine:'Synthetic fixture',sourceUrl:'https://pawfecthouse.com/products/synthetic',
    namedScopeRequired:true,namedScopeIssues:['SOURCE_REVIEW_REQUIRED'],planHash:hash('c'),
    expectedSlots:['hero','detail'],assets:{hero:{sha256:hash('d'),width:1440,height:640,format:'webp'},detail:{sha256:hash('e'),width:900,height:900,format:'png',futureSourceHash:hash('f'),futureWarning:'retain this'}},
    render:{inputHash:hash('1'),desktop:{sha256:hash('2')},mobile:{sha256:hash('3')},visualQcPerformed:false,previewBundle:{sha256:hash('4')}},
    delivery:{sha256:hash('5'),inputHash:hash('1'),manifest:{files:[{sha256:hash('e')}]}},
    approvals:[{kind:'content',inputHash:hash('c'),reviewer:'synthetic-anonymous',identityVerified:false}],
    evidenceIds:['source-a'],referenceIds:['reference-a'],qcScopes:['research','asset:hero'],expiresAt:123456789,
    nextAction:'FINAL_OUTCOME_APPROVAL_REQUIRED',testMode:true,semanticInspection:'HOST_OR_HUMAN_REPORTED_NOT_SERVER_VISION',
    context:{snapshotHash:hash('a'),bundleHash:hash('6'),templateHash:hash('7'),coverageVersion:4},
    access:{sharedSandbox:true,identityVerified:false},futureSecurityGate:{status:'BLOCKED',currentHash:hash('8')},
  };
}
function freeze(value:any):any { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; }
function hashes(value:any):string[] { if(typeof value==='string')return /^[a-f0-9]{64}$/.test(value)?[value]:[];if(value&&typeof value==='object')return Object.values(value).flatMap(hashes);return []; }

test('projection preserves every exact hash, blocker, approval and unknown safety field without mutating full state',()=>{
  const full=fixture(),before=structuredClone(full);freeze(full);
  const compact=compactState(full) as Record<string,any>&CompactStateMetadata;
  assert.deepEqual(full,before);assert.notEqual(compact,full);
  assert.deepEqual(hashes(compact).sort(),hashes(full).sort());
  for(const key of Object.keys(full).filter(key=>!['canonicalSteps','completedSteps','assets'].includes(key)))assert.deepEqual(compact[key],full[key],key);
  assert.equal(Object.hasOwn(compact,'canonicalSteps'),false);assert.equal(Object.hasOwn(compact,'completedSteps'),false);
  assert.deepEqual(compact.assets.hero,{sha256:hash('d')});assert.deepEqual(compact.assets.detail,{sha256:hash('e'),futureSourceHash:hash('f'),futureWarning:'retain this'});
  assert.equal(compact.render.visualQcPerformed,false);assert.equal(compact.access.identityVerified,false);assert.equal(compact.approvals.length,1);
});

test('canonical progress excludes terminal additions and never implies final approval or total completion',()=>{
  const full=fixture(),compact=compactState(full) as Record<string,any>&CompactStateMetadata;
  assert.deepEqual(compact.progress,{canonicalCompleted:23,canonicalTotal:23,additionalCompleted:1});
  assert.equal(compact.state,'BLOCKED');assert.deepEqual(compact.blockers,['FINAL_OUTCOME_APPROVAL_REQUIRED']);
  assert.equal(Object.hasOwn(compact.progress,'percentComplete'),false);
  full.completedSteps=[...steps,'OVERALL_QC','REVIEW','PACKAGE'];full.state='COMPLETE';full.stage='COMPLETE';full.blockers=[];
  assert.deepEqual((compactState(full) as Record<string,any>).progress,{canonicalCompleted:23,canonicalTotal:23,additionalCompleted:3});
  full.completedSteps=[];full.stage=steps[0];full.state='READY';
  assert.deepEqual((compactState(full) as Record<string,any>).progress,{canonicalCompleted:0,canonicalTotal:23,additionalCompleted:0});
});

test('explicit full lookup targets the same job and every omitted value remains in the original',()=>{
  const full=fixture(),compact=compactState(full) as Record<string,any>&CompactStateMetadata;
  assert.equal(compact.fullStateAvailable,true);assert.deepEqual(compact.fullState,{tool:'onepage_get_state',arguments:{jobId:full.jobId,detail:'full'}});
  assert.equal(full.canonicalSteps.length,23);assert.equal(full.completedSteps.length,24);assert.equal(full.assets.hero.width,1440);assert.equal(full.assets.detail.height,900);assert.equal(full.assets.hero.format,'webp');
  assert.equal(Object.hasOwn(full,'fullState'),false);assert.equal(compactState(compact),compact);
});

test('invalid, non-summary and wrapper values return unchanged rather than losing unknown data',()=>{
  const full=fixture();
  const values:unknown[]=[null,undefined,4,'state',[],new Date(),{jobId:full.jobId},{state:full,validation:{status:'BLOCKED'}},
    {...full,canonicalHash:'invalid'},{...full,completedSteps:[steps[0],steps[0]]},{...full,canonicalSteps:[]},{...full,completedSteps:[hash('a')]},
    {...full,assets:{hero:{sha256:hash('d'),width:0,height:100,format:'png'}}},{...full,testMode:false}];
  for(const value of values)assert.equal(compactState(value),value);
  for(const key of ['progress','fullStateAvailable','fullState']){const value={...full,[key]:{future:'preserve'}};assert.equal(compactState(value),value);}
});

test('unknown asset formats and non-JSON summary shapes are not stripped or evaluated',()=>{
  const full=fixture();full.assets.future={sha256:hash('9'),width:500,height:300,format:'future-format',newRequiredGate:'BLOCKED'};
  assert.deepEqual((compactState(full) as Record<string,any>).assets.future,full.assets.future);
  let reads=0;const getter={...fixture()};Object.defineProperty(getter,'futureSafetyField',{get(){reads++;return 'blocked';},enumerable:true});
  assert.equal(compactState(getter),getter);assert.equal(reads,0);
  const hidden={...fixture()};Object.defineProperty(hidden,'hiddenSafetyField',{value:'preserve',enumerable:false});assert.equal(compactState(hidden),hidden);
});

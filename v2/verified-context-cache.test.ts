import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot, stageContext, assertCoverage, contentHash, OBSERVED_EXECUTION, type CanonicalSnapshot, type Packet } from './rules.ts';
import { VerifiedContextCache } from './verified-context-cache.ts';

function snapshot():CanonicalSnapshot {
  const packet:Packet={resolved:{brand:'pawfecthouse',branch:'onepage-system'},execution:[...OBSERVED_EXECUTION],assets:[],hard_gates:{physical_truth:'HARD'},
    creative_quality_contract:{status:'COMPILED',errors:[],revision:'synthetic:cache-1',rules:[
      {id:'synthetic:first',instruction:'Exact required café rule.\nEvery word remains visible.',sources:[{locator:'synthetic'}],scope:{brands:['pawfecthouse']},requires:['synthetic:dependency']},
      {id:'synthetic:dependency',instruction:'Exact dependency rule.',sources:[{locator:'synthetic'}],scope:{brands:['pawfecthouse']}},
    ]},future_unknown:{instruction:'Unknown rules remain visible.',nested:[null,3,{verbatim:true}]},
    ui_mapping_templates:{gtk:{id:'synthetic-gtk',future_rule:'GTK exact text'},faq:{id:'synthetic-faq',future_rule:'FAQ exact text'}}};
  return createSnapshot(packet,{sourceUrl:'synthetic:cache',observedAt:'2026-11-28T00:00:00Z',baselineCommit:'0'.repeat(40),visibility:'synthetic'});
}

test('cached full bundles and receipts exactly match all23 canonical steps and preserve hashes/text',()=>{
  const cache=new VerifiedContextCache(),s=snapshot();
  for(const mode of ['gtk','faq'] as const)for(const step of OBSERVED_EXECUTION){
    const expected=stageContext(s,step,{templateMode:mode}),actual=cache.get('owner-a','job-a',s,step,{templateMode:mode});
    assert.deepEqual(actual,expected);
    assert.deepEqual(actual.data.creative_quality_contract,s.packet.creative_quality_contract);
    assert.deepEqual(actual.data.future_unknown,s.packet.future_unknown);
    const {receipt,...base}=actual;assert.equal(contentHash(base),receipt.bundleHash);
    assert.equal(assertCoverage(s,step,receipt,{templateMode:mode}).status,'COVERED');
    assert.deepEqual(cache.proof('owner-a','job-a',s,step,{templateMode:mode}),{receipt:expected.receipt,conflicts:expected.conflicts});
  }
  assert.ok(cache.stats().hits>23);
  assert.ok(cache.stats().entries<=16);assert.ok(cache.stats().bytes<=8*1024*1024);
});

test('cache isolates owner/job/template and returns independent clones',()=>{
  const cache=new VerifiedContextCache(),s=snapshot(),expected=stageContext(s,'research');
  const returned=cache.get('owner-a','job-a',s,'research');
  returned.data.future_unknown.instruction='caller tampered';returned.receipt.requiredRuleIds=[];
  const proof=cache.proof('owner-a','job-a',s,'research');proof.receipt.ruleHashes['synthetic:first']='0'.repeat(64);proof.conflicts.push({code:'CALLER',paths:[],ruleIds:[],detail:'test',stages:['research']});
  assert.deepEqual(cache.get('owner-a','job-a',s,'research'),expected);assert.equal(cache.stats().builds,1);
  cache.get('owner-b','job-a',s,'research');cache.get('owner-a','job-b',s,'research');
  cache.get('owner-a','job-a',s,'research',{templateMode:'gtk'});cache.get('owner-a','job-a',s,'research',{templateMode:'faq'});
  assert.equal(cache.stats().builds,5);
  assert.throws(()=>cache.get('','job',s,'research'),/SCOPE_REQUIRED/);
});

test('packet, registry, conflicts, provenance and unknown-field tampering cannot reuse a retained hash',()=>{
  const cache=new VerifiedContextCache(),s=snapshot();cache.get('owner','job',s,'research');
  const mutations:Array<(candidate:CanonicalSnapshot)=>void>=[
    c=>{c.packet.future_unknown.instruction='corrupted';},
    c=>{c.registry[0].text='corrupted';},
    c=>{c.conflicts.push({code:'invented',paths:[],ruleIds:[],detail:'test',stages:['research']});},
    c=>{c.provenance.observedAt='not a date';},
  ];
  for(const mutate of mutations){
    const candidate=structuredClone(s);mutate(candidate);
    assert.throws(()=>cache.get('owner','job',candidate,'research'),/SNAPSHOT/);
    assert.throws(()=>cache.get('owner','job',candidate,'research'),/SNAPSHOT/);
    assert.equal(cache.stats().builds,1);assert.equal(cache.stats().entries,1);
  }
  const nonJson=structuredClone(s) as any;nonJson.extra=undefined;
  assert.throws(()=>cache.get('owner','job',nonJson,'research'),/NON_JSON/);
  const revisedProvenance=structuredClone(s);revisedProvenance.provenance.sourceUrl='synthetic:new-source';
  cache.get('owner','job',revisedProvenance,'research');assert.equal(cache.stats().builds,2);
  const futureMetadata=structuredClone(s) as any;futureMetadata.future_metadata={retained:true};
  cache.get('owner','job',futureMetadata,'research');assert.equal(cache.stats().builds,3);
});

test('absolute TTL, LRU count and serialized byte ceilings bound retained computation',()=>{
  const s=snapshot();let now=0;
  const ttl=new VerifiedContextCache({ttlMs:100,now:()=>now});
  ttl.get('owner','job',s,'research');now=99;ttl.get('owner','job',s,'research');assert.equal(ttl.stats().builds,1);
  now=100;ttl.get('owner','job',s,'research');assert.equal(ttl.stats().builds,2);
  const lru=new VerifiedContextCache({maxEntries:2});
  lru.get('owner','a',s,'research');lru.get('owner','b',s,'research');lru.get('owner','a',s,'research');lru.get('owner','c',s,'research');
  assert.equal(lru.stats().entries,2);lru.get('owner','a',s,'research');assert.equal(lru.stats().builds,3);lru.get('owner','b',s,'research');assert.equal(lru.stats().builds,4);
  const measured=new VerifiedContextCache();measured.get('owner','a',s,'research');
  const budget=measured.stats().bytes+1,limited=new VerifiedContextCache({maxBytes:budget});
  limited.get('owner','a',s,'research');limited.get('owner','b',s,'research');assert.equal(limited.stats().entries,1);assert.ok(limited.stats().bytes<=budget);
  const oversize=new VerifiedContextCache({maxBytes:1});oversize.get('owner','a',s,'research');oversize.get('owner','a',s,'research');assert.equal(oversize.stats().entries,0);assert.equal(oversize.stats().builds,2);
  for(const options of [{maxEntries:17},{maxEntries:0},{maxBytes:8*1024*1024+1},{ttlMs:300001}])assert.throws(()=>new VerifiedContextCache(options),/CONTEXT_CACHE_LIMIT/);
});

test('one operation fingerprints once, retains its immutable snapshot and still exposes canonical conflicts',()=>{
  const cache=new VerifiedContextCache(),s=snapshot(),original=structuredClone(s),operation=cache.operation('owner','job',s);
  s.packet.future_unknown.instruction='mutation after operation capture';
  for(const step of OBSERVED_EXECUTION.slice(3,12))assert.deepEqual(operation.proof(step),{receipt:stageContext(original,step).receipt,conflicts:[]});
  assert.equal(cache.stats().fingerprints,1);assert.equal(cache.stats().builds,1);
  const packet=structuredClone(original.packet);packet.creative_quality_contract.status='BLOCKED';const conflicted=createSnapshot(packet,original.provenance);
  const proof=cache.proof('owner','job',conflicted,'research');assert.ok(proof.conflicts.some(c=>c.code==='CANONICAL_POLICY_BLOCKED'));
  assert.throws(()=>assertCoverage(conflicted,'research',proof.receipt),/CANONICAL_CONTEXT_CONFLICT/);
  assert.deepEqual(cache.proof('owner','job',conflicted,'research'),proof);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from './store.ts';
import { hash } from './core.ts';
import { readStoredZip, writeStoredZip } from './delivery-zip.ts';

test('durable owner-bound CAS, immutable operation receipts and restart', () => {
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'uid-v2-'))); const path=join(dir,'state.sqlite');
 let store=new SqliteStore(path); const first=store.create('tenant:a','request-1','input-1',{state:'INIT'});
 assert.deepEqual(store.create('tenant:a','request-1','input-1',{state:'WRONG'}),first);
 assert.throws(()=>store.create('tenant:a','request-1','different',{}),/different request/);
 assert.throws(()=>store.read('tenant:b',first.jobId),/not found/);
 const changed=store.update('tenant:a',first.jobId,0,x=>({...x,state:'RESEARCH'}),{key:'mutation-1',requestHash:'mutation-hash'});
 assert.equal(changed.storageRevision,1);
 assert.throws(()=>store.update('tenant:a',first.jobId,0,x=>x),/changed/);
 assert.deepEqual(store.update('tenant:a',first.jobId,0,()=>{throw Error('must not run')},{key:'mutation-1',requestHash:'mutation-hash'}),changed);
 assert.throws(()=>store.update('tenant:a',first.jobId,1,x=>x,{key:'mutation-1',requestHash:'different'}),/different request/);
 store.close(); store=new SqliteStore(path); assert.equal(store.read('tenant:a',first.jobId).state,'RESEARCH');
 const second=new SqliteStore(path); store.update('tenant:a',first.jobId,1,x=>({...x,state:'PLAN'}));
 assert.throws(()=>second.update('tenant:a',first.jobId,1,x=>x),/changed/); second.close(); store.close(); rmSync(dir,{recursive:true});
});
test('artifacts are actual hashed bytes, scoped to job and owner; leases fence old workers',()=>{
 const store=new SqliteStore(':memory:'); const a=store.create('owner','a','a',{}),b=store.create('owner','b','b',{});
 const data=Buffer.from('bounded test bytes'); const receipt=store.putArtifact('owner',a.jobId,data,'image/webp');
 assert.equal(receipt.sha256,hash(data)); assert.deepEqual(store.getArtifact('owner',a.jobId,receipt.sha256),data);
 assert.deepEqual(store.artifactInfo('owner',a.jobId,receipt.sha256),receipt);
 assert.throws(()=>store.artifactInfo('other',a.jobId,receipt.sha256),/not found/);
 assert.throws(()=>store.getArtifact('other',a.jobId,receipt.sha256),/not found/);
 assert.throws(()=>store.getArtifact('owner',b.jobId,receipt.sha256),/not found/);
 const one=store.acquireLease('owner',a.jobId,'worker-1'); assert.throws(()=>store.acquireLease('owner',a.jobId,'worker-2'),/already running/);
 store.assertLease('owner',a.jobId,one); store.releaseLease('owner',a.jobId,one);
 const two=store.acquireLease('owner',a.jobId,'worker-2'); assert.ok(two.fence>one.fence);
 assert.throws(()=>store.assertLease('owner',a.jobId,one),/expired/); store.close();
});
test('verified ZIP bytes above 32 MiB roundtrip while non-archive artifact limits stay unchanged',()=>{
 const store=new SqliteStore(':memory:'),job=store.create('owner','large-archive','large-archive',{});
 try{
  const zip=writeStoredZip([{name:'mechanical-fixture-a.bin',bytes:Buffer.alloc(16*1024*1024,1)},{name:'mechanical-fixture-b.bin',bytes:Buffer.alloc(16*1024*1024,2)}]);
  assert.ok(zip.length>32*1024*1024);
  const receipt=store.putArtifact('owner',job.jobId,zip,'application/zip'),restored=store.getArtifact('owner',job.jobId,receipt.sha256);
  assert.equal(receipt.sha256,hash(zip));assert.ok(restored.equals(zip));assert.equal(readStoredZip(restored).length,2);
  for(const mime of ['image/png','image/webp','image/jpeg','text/html','text/css','application/json'])assert.throws(()=>store.putArtifact('owner',job.jobId,zip,mime),/format-specific byte limit/);
 }finally{store.close();}
});
test('database and parent-directory symlinks are rejected',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'uid-v2-links-'))),database=join(dir,'state.sqlite');
 const store=new SqliteStore(database);store.close();
 symlinkSync(database,join(dir,'alias.sqlite'));
 assert.throws(()=>new SqliteStore(join(dir,'alias.sqlite')),/symlink/);
 symlinkSync(dir,join(dir,'alias-dir'));
 assert.throws(()=>new SqliteStore(join(dir,'alias-dir','other.sqlite')),/symlink/);
 rmSync(dir,{recursive:true});
});
test('bounded data rejects prototype pollution and quota; exceptions rollback',()=>{
 const store=new SqliteStore(':memory:',{maxBytes:4000});
 assert.throws(()=>store.create('o','x','x',JSON.parse('{"__proto__":{"polluted":true}}')),/Unsafe/);
 const job=store.create('o','x','x',{});
 assert.throws(()=>store.update('o',job.jobId,0,()=>{throw Error('crash')}),/crash/);
 assert.equal(store.read('o',job.jobId).storageRevision,0);
 assert.throws(()=>store.putArtifact('o',job.jobId,Buffer.alloc(5000),'image/png'),/full/);
 assert.equal(({} as any).polluted,undefined); store.close();
});
test('quota uses UTF-8 bytes, and TTL/lease limits cannot be disabled with NaN',()=>{
 assert.throws(()=>new SqliteStore(':memory:',{ttlMs:NaN}),/TTL/);
 assert.throws(()=>new SqliteStore(':memory:',{maxBytes:NaN}),/positive integer/);
 const store=new SqliteStore(':memory:',{maxBytes:3100});
 const a=store.create('o','unicode','a',{note:'🎨'.repeat(200)});
 // Two persisted JSON records consume over 2 KiB even though SQLite text length is much lower.
 assert.throws(()=>store.putArtifact('o',a.jobId,Buffer.alloc(1200),'image/png'),/full/);
 assert.throws(()=>store.acquireLease('o',a.jobId,'worker',NaN),/Lease duration/);
 store.close();
});
test('expired jobs cannot be read and their data is pruned by TTL',()=>{
 const store=new SqliteStore(':memory:',{ttlMs:1000});
 const job=store.create('owner','ttl','ttl',{});
 const originalNow=Date.now;
 try {
  Date.now=()=>originalNow()+2000;
  assert.throws(()=>store.read('owner',job.jobId),/expired/);
  assert.equal(store.pruneExpired(),1);
 }finally{Date.now=originalNow;}
 assert.throws(()=>store.read('owner',job.jobId),/not found/);
 store.close();
});

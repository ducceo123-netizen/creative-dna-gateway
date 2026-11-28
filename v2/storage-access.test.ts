import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { SqliteStore } from './store.ts';
import { PgStore, migratePgStore, type PgPoolLike, type PgClientLike } from './postgres-store.ts';
import { hash, V2Error } from './core.ts';

const hasCode=(code:string)=>(error:unknown)=>error instanceof V2Error&&error.code===code;
class LocalPools {
  private tail=Promise.resolve();
  readonly queries:string[]=[];
  constructor(readonly db:PGlite){}
  pool(admin=false):PgPoolLike{return {connect:async()=>{
    const previous=this.tail;let unlock!:()=>void;this.tail=new Promise<void>(resolve=>{unlock=resolve;});await previous;
    try{await this.db.exec('RESET ROLE');if(!admin)await this.db.exec('SET ROLE uid_brands_v2_app');}catch(error){unlock();throw error;}
    let released=false;
    return {query:async(sql,values)=>{if(!admin)this.queries.push(sql);const result=values?await this.db.query(sql,values):(await this.db.exec(sql)).at(-1)!;return {rows:result.rows as Record<string,any>[],rowCount:result.affectedRows};},release:()=>{if(!released){released=true;unlock();}}} satisfies PgClientLike;
  },end:async()=>{}};}
  async admin(sql:string,values?:any[]){const client=await this.pool(true).connect();try{return await client.query(sql,values);}finally{client.release();}}
}
async function setup(kind:'sqlite'|'postgres'){
  if(kind==='sqlite'){
    const store=new SqliteStore(':memory:');const db=(store as any).db;
    return {store,queries:undefined as string[]|undefined,corrupt:async(id:string,sha:string)=>db.prepare('UPDATE artifacts SET bytes=? WHERE job=? AND hash=?').run(Buffer.from('corrupted fixture'),id,sha),expire:async(id:string)=>db.prepare('UPDATE jobs SET expires=0 WHERE id=?').run(id),close:async()=>store.close()};
  }
  const db=new PGlite(),pools=new LocalPools(db);await migratePgStore(pools.pool(true));
  const store=new PgStore(pools.pool());
  return {store,queries:pools.queries,corrupt:async(id:string,sha:string)=>pools.admin('UPDATE uid_brands_v2.artifacts SET bytes=$1 WHERE job=$2 AND hash=$3',[Buffer.from('corrupted fixture'),id,sha]),expire:async(id:string)=>pools.admin('UPDATE uid_brands_v2.jobs SET expires=0 WHERE id=$1',[id]),close:async()=>{await store.close();await db.close();}};
}

for(const kind of ['sqlite','postgres'] as const)test(`${kind}: combined and batch artifact reads preserve actual bytes, order, owner, expiry and corruption gates`,async()=>{
  const f=await setup(kind),store=f.store;try{
    const job=await store.create('owner:a','batch-job','batch-job',{snapshot:{synthetic:'x'.repeat(128*1024)}});
    const otherJob=await store.create('owner:a','other-job','other-job',{});
    const first=Buffer.from('Synthetic bytes one\0你好'),second=Buffer.from('Synthetic bytes two');
    const a=await store.putArtifact('owner:a',job.jobId,first,'application/zip'),b=await store.putArtifact('owner:a',job.jobId,second,'text/html');
    assert.deepEqual(await store.readArtifact('owner:a',job.jobId,a.sha256),{...a,bytes:first});
    assert.deepEqual(await store.getArtifact('owner:a',job.jobId,a.sha256),first);
    assert.deepEqual(await store.artifactInfo('owner:a',job.jobId,a.sha256),a);
    f.queries?.splice(0);
    const batch=await store.readArtifacts('owner:a',job.jobId,[b.sha256,a.sha256,b.sha256]);
    assert.deepEqual(batch,[{...b,bytes:second},{...a,bytes:first}]);
    if(f.queries){
      assert.equal(f.queries.length,6,'one role-checked identity-local transaction, one job precheck and one artifact batch query');
      assert.equal(f.queries.filter(sql=>sql.startsWith('SELECT a.hash,a.bytes,a.mime')).length,1);
      assert.ok(!f.queries.some(sql=>/\bdocument\b/.test(sql)),'artifact access must never fetch/parse the canonical job document');
      assert.equal(f.queries[0],'BEGIN');assert.equal(f.queries.at(-1),'COMMIT');
      assert.ok(f.queries.some(sql=>sql.includes('rolbypassrls')));assert.ok(f.queries.some(sql=>sql.includes("set_config('uid_brands_v2.owner'")));
    }
    assert.deepEqual(await store.readArtifacts('owner:a',job.jobId,[]),[]);
    await assert.rejects(async()=>store.readArtifacts('owner:b',job.jobId,[a.sha256]),hasCode('NOT_FOUND'));
    await assert.rejects(async()=>store.readArtifacts('owner:b',job.jobId,[]),hasCode('NOT_FOUND'));
    await assert.rejects(async()=>store.readArtifact('owner:a',otherJob.jobId,a.sha256),hasCode('NOT_FOUND'));
    await assert.rejects(async()=>store.readArtifacts('owner:a',job.jobId,[a.sha256,'0'.repeat(64)]),hasCode('NOT_FOUND'));
    await assert.rejects(async()=>store.readArtifacts('owner:a',job.jobId,['invalid']),hasCode('ASSET_HASH'));
    await assert.rejects(async()=>store.readArtifacts('owner:a',job.jobId,Array(25).fill(a.sha256)),hasCode('ASSET_BATCH_LIMIT'));
    assert.equal((await store.readArtifacts('owner:a',job.jobId,Array(24).fill(a.sha256))).length,1);
    await f.corrupt(job.jobId,b.sha256);
    await assert.rejects(async()=>store.readArtifacts('owner:a',job.jobId,[a.sha256,b.sha256]),hasCode('ASSET_CORRUPT'));
    await assert.rejects(async()=>store.artifactInfo('owner:a',job.jobId,b.sha256),hasCode('ASSET_CORRUPT'));
    // Failed reads have no side effects; unrelated intact bytes remain available.
    assert.deepEqual(await store.getArtifact('owner:a',job.jobId,a.sha256),first);
    const lease=await store.acquireLease('owner:a',job.jobId,'worker');
    await f.expire(job.jobId);
    for(const run of [
      ()=>store.readArtifact('owner:a',job.jobId,a.sha256),()=>store.readArtifacts('owner:a',job.jobId,[]),
      ()=>store.putArtifact('owner:a',job.jobId,first,'application/zip'),()=>store.recordTelemetry('owner:a',job.jobId,{operation:'expired'}),
      ()=>store.telemetry('owner:a',job.jobId),()=>store.acquireLease('owner:a',job.jobId,'another-worker'),
      ()=>store.assertLease('owner:a',job.jobId,lease),()=>store.releaseLease('owner:a',job.jobId,lease),
    ])await assert.rejects(async()=>run(),hasCode('NOT_FOUND'));
  }finally{await f.close();}
});

test('PostgreSQL metadata-only authorization avoids document loads for telemetry, artifact writes and all lease operations',async()=>{
  const f=await setup('postgres'),store=f.store;try{
    const job=await store.create('owner:a','metadata-job','metadata-job',{snapshot:{synthetic:'x'.repeat(256*1024)}});
    const original=await store.read('owner:a',job.jobId);f.queries!.splice(0);
    await store.recordTelemetry('owner:a',job.jobId,{operation:'synthetic',requestBytes:9,secret:'never retained'});
    assert.deepEqual(await store.telemetry('owner:a',job.jobId),[{operation:'synthetic',requestBytes:9}]);
    const lease=await store.acquireLease('owner:a',job.jobId,'worker');await store.assertLease('owner:a',job.jobId,lease);await store.releaseLease('owner:a',job.jobId,lease);
    await store.putArtifact('owner:a',job.jobId,Buffer.from('synthetic artifact'),'application/zip');
    assert.ok(!f.queries!.some(sql=>/\bdocument\b/.test(sql)));
    assert.equal(f.queries!.filter(sql=>sql.includes('store_usage WHERE singleton FOR UPDATE')).length,4,'quota/serialization locks remain on every mutation');
    for(const run of [
      ()=>store.recordTelemetry('owner:b',job.jobId,{operation:'denied'}),()=>store.telemetry('owner:b',job.jobId),
      ()=>store.acquireLease('owner:b',job.jobId,'worker'),()=>store.assertLease('owner:b',job.jobId,lease),
      ()=>store.releaseLease('owner:b',job.jobId,lease),()=>store.putArtifact('owner:b',job.jobId,Buffer.from('denied'),'text/html'),
    ])await assert.rejects(async()=>run(),hasCode('NOT_FOUND'));
    assert.deepEqual(await store.read('owner:a',job.jobId),original);
    assert.deepEqual(await store.telemetry('owner:a',job.jobId),[{operation:'synthetic',requestBytes:9}]);
  }finally{await f.close();}
});

test('PostgreSQL batched retrieval remains bounded at 24 distinct actual artifacts',async()=>{
  const f=await setup('postgres'),store=f.store;try{
    const job=await store.create('owner:a','max-batch','max-batch',{}),expected=[];
    for(let index=0;index<24;index++){
      const bytes=Buffer.from('distinct synthetic artifact '+index);const receipt=await store.putArtifact('owner:a',job.jobId,bytes,'application/zip');expected.push({...receipt,bytes});
    }
    f.queries!.splice(0);
    const result=await store.readArtifacts('owner:a',job.jobId,expected.map(row=>row.sha256).reverse());
    assert.deepEqual(result,[...expected].reverse());assert.equal(f.queries!.length,6);
    assert.ok(result.every(row=>hash(row.bytes)===row.sha256));
  }finally{await f.close();}
});

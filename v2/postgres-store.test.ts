import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PgStore, migratePgStore, readPgConnectionConfig, type PgPoolLike, type PgClientLike } from './postgres-store.ts';
import { hash, V2Error } from './core.ts';

/** PGlite is real PostgreSQL SQL/RLS/transactions in one WASM connection. This
 * pool adapter queues checkouts to model its single-connection constraint; it
 * does not claim to exercise network or multi-backend lock contention. */
class LocalPools {
  private tail=Promise.resolve();
  constructor(readonly db:PGlite){}
  pool(admin=false):PgPoolLike{return {connect:()=>this.connect(admin),end:async()=>{}};}
  private async connect(admin:boolean):Promise<PgClientLike>{
    const previous=this.tail;let unlock!:()=>void;this.tail=new Promise<void>(r=>{unlock=r;});await previous;
    try{await this.db.exec('RESET ROLE');if(!admin)await this.db.exec('SET ROLE uid_brands_v2_app');}catch(error){unlock();throw error;}
    let released=false;
    return {query:async(sql,values)=>{const result=values?await this.db.query(sql,values):(await this.db.exec(sql)).at(-1)!;return {rows:result.rows as Record<string,any>[],rowCount:result.affectedRows};},release:()=>{if(!released){released=true;unlock();}}};
  }
  async admin(sql:string,values?:any[]){const c=await this.connect(true);try{return await c.query(sql,values);}finally{c.release();}}
}
const code=(expected:string)=>(error:unknown)=>error instanceof V2Error&&error.code===expected;

test('PostgreSQL artifact validation permits ZIP above image size while retaining bounded images',async()=>{
 const unavailable:PgPoolLike={connect:async()=>{throw Error('PROBE_CONNECT');},end:async()=>{}};
 const store=new PgStore(unavailable);const bytes=Buffer.alloc(32*1024*1024+1);
 await assert.rejects(store.putArtifact('tenant:a','test-job',bytes,'application/zip'),/PROBE_CONNECT/);
 await assert.rejects(store.putArtifact('tenant:a','test-job',bytes,'image/png'),code('ASSET_SIZE_LIMIT'));
});

test('PostgreSQL guarded connection requires isolated exact host, restricted identity and verified TLS',()=>{
 const ref='abcdefghijklmnopqrst';const env={V2_MODE:'isolated-test',V2_DATABASE_HOST:`db.${ref}.supabase.co`,V2_DATABASE_PROJECT_REF:ref,V2_DATABASE_URL:`postgresql://uid_brands_v2_app:test%21password@db.${ref}.supabase.co:5432/postgres?sslmode=require`};
 const config=readPgConnectionConfig(env);assert.equal(config.user,'uid_brands_v2_app');assert.equal(config.password,'test!password');assert.equal(config.ssl.rejectUnauthorized,true);assert.equal('connectionString' in config,false);
 const pooler={...env,V2_DATABASE_HOST:'aws-1-ap-southeast-1.pooler.supabase.com',V2_DATABASE_URL:`postgresql://uid_brands_v2_app.${ref}:test@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres`};assert.equal(readPgConnectionConfig(pooler).port,6543);
 for(const patch of [
  {V2_MODE:'production'}, {V2_DATABASE_HOST:'another.example.com'}, {V2_DATABASE_PROJECT_REF:undefined}, {DATABASE_URL:'postgres://legacy'}, {NODE_TLS_REJECT_UNAUTHORIZED:'0'},
  {V2_DATABASE_URL:env.V2_DATABASE_URL.replace('uid_brands_v2_app:','postgres:')},
  {V2_DATABASE_URL:env.V2_DATABASE_URL.replace('require','disable')},
  {V2_DATABASE_URL:env.V2_DATABASE_URL+'&sslcert=external.pem'},
  {V2_DATABASE_HOST:'db.wuonwttmkadwsmefjukv.supabase.co',V2_DATABASE_PROJECT_REF:'wuonwttmkadwsmefjukv',V2_DATABASE_URL:'postgres://uid_brands_v2_app:test@db.wuonwttmkadwsmefjukv.supabase.co/postgres'},
  {V2_DATABASE_HOST:'127.0.0.1',V2_DATABASE_URL:'postgres://uid_brands_v2_app:test@127.0.0.1/postgres'},
 ])assert.throws(()=>readPgConnectionConfig({...env,...patch}),code('ISOLATION_REQUIRED'));
 assert.equal(readPgConnectionConfig({...env,V2_DATABASE_URL:env.V2_DATABASE_URL.replace('uid_brands_v2_app:','postgres:')},'migration').user,'postgres');
});

test('real local PostgreSQL preserves CAS, receipts, RLS, quotas, leases, expiry and restart',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'uid-v2-pg-'));let db=new PGlite(directory);let pools=new LocalPools(db);
 try{
  await migratePgStore(pools.pool(true));await migratePgStore(pools.pool(true));
  let store=new PgStore(pools.pool());const owner='tenant:a';
  const job=await store.create(owner,'initial','initial-hash',{text:'Actual durable Unicode: 你好',count:0});
  await t.test('idempotent concurrent creates, CAS winner and retry receipts are atomic',async()=>{
   const created=await Promise.all(Array.from({length:8},()=>store.create(owner,'race-create','same',{n:0})));assert.equal(new Set(created.map(j=>j.jobId)).size,1);
   await assert.rejects(store.create(owner,'race-create','different',{}),code('IDEMPOTENCY_CONFLICT'));
   const raced=await Promise.allSettled(Array.from({length:8},()=>store.update(owner,job.jobId,0,j=>({...j,count:j.count+1}))));assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);for(const r of raced)if(r.status==='rejected')assert.ok(code('STALE_REVISION')(r.reason));
   const receipt={key:'same-operation',requestHash:'same-request'};const updated=await store.update(owner,job.jobId,1,j=>({...j,count:j.count+1}),receipt);
   assert.deepEqual(await store.update(owner,job.jobId,1,()=>{throw Error('must not repeat');},receipt),updated);
   await assert.rejects(store.update(owner,job.jobId,2,j=>j,{...receipt,requestHash:'different'}),code('IDEMPOTENCY_CONFLICT'));
   const counts=await pools.admin('SELECT (SELECT count(*) FROM uid_brands_v2.history WHERE job=$1) AS history,(SELECT count(*) FROM uid_brands_v2.receipts WHERE job=$1) AS receipts',[job.jobId]);assert.equal(Number(counts.rows[0].history),3);assert.equal(Number(counts.rows[0].receipts),1);
   const before=await pools.admin('SELECT bytes FROM uid_brands_v2.store_usage');await assert.rejects(store.update(owner,job.jobId,2,j=>{j.count=99;throw Error('injected rollback');}),/injected rollback/);assert.equal((await store.read(owner,job.jobId)).count,2);assert.deepEqual(await pools.admin('SELECT bytes FROM uid_brands_v2.store_usage'),before);
  });
  await t.test('database RLS denies cross-owner rows even when application predicates are absent',async()=>{
   const other=await store.create('tenant:b','other','other',{secret:'other-tenant'});
   await assert.rejects(store.read(owner,other.jobId),code('NOT_FOUND'));
   const c=await pools.pool().connect();try{
    await c.query('BEGIN');await c.query("SELECT set_config('uid_brands_v2.owner',$1,true)",[owner]);
    assert.equal((await c.query('SELECT id FROM uid_brands_v2.jobs WHERE id=$1',[other.jobId])).rows.length,0);
    assert.equal((await c.query('UPDATE uid_brands_v2.jobs SET document=$1 WHERE id=$2 RETURNING id',['{}',other.jobId])).rows.length,0);
    await c.query('COMMIT');
    assert.equal((await c.query('SELECT id FROM uid_brands_v2.jobs')).rows.length,0,'identity must not leak between pooled transactions');
    await assert.rejects(c.query('CREATE TABLE uid_brands_v2.unapproved(value text)'),/permission denied/);
    await assert.rejects(c.query('DELETE FROM uid_brands_v2.jobs'),/permission denied/);
    await assert.rejects(c.query('UPDATE uid_brands_v2.history SET document=$1',['{}']),/permission denied/);
   }finally{c.release();}
   await assert.rejects(new PgStore(pools.pool(true)).read(owner,job.jobId),code('ISOLATION_REQUIRED'));
  });
  await t.test('actual byte artifacts are owner-bound and integrity-checked; telemetry filters payloads',async()=>{
   const bytes=Buffer.from('actual binary fixture\0你好');const receipt=await store.putArtifact(owner,job.jobId,bytes,'application/zip');assert.equal(receipt.sha256,hash(bytes));assert.deepEqual(await store.getArtifact(owner,job.jobId,receipt.sha256),bytes);assert.deepEqual(await store.artifactInfo(owner,job.jobId,receipt.sha256),receipt);
   assert.deepEqual(await store.putArtifact(owner,job.jobId,bytes,'application/zip'),receipt);await assert.rejects(store.putArtifact(owner,job.jobId,bytes,'text/html'),code('ASSET_TYPE'));await assert.rejects(store.getArtifact('tenant:b',job.jobId,receipt.sha256),code('NOT_FOUND'));
   await store.recordTelemetry(owner,job.jobId,{operation:'test',requestBytes:5,secret:'must not persist'});assert.deepEqual(await store.telemetry(owner,job.jobId),[{operation:'test',requestBytes:5}]);
   await pools.admin('UPDATE uid_brands_v2.artifacts SET bytes=$1 WHERE job=$2 AND hash=$3',[Buffer.from('corrupted'),job.jobId,receipt.sha256]);await assert.rejects(store.getArtifact(owner,job.jobId,receipt.sha256),code('ASSET_CORRUPT'));await pools.admin('UPDATE uid_brands_v2.artifacts SET bytes=$1 WHERE job=$2 AND hash=$3',[bytes,job.jobId,receipt.sha256]);
  });
  await t.test('global Unicode-byte quota cannot be exceeded by concurrent owners and rolls back',async()=>{
   const used=Number((await pools.admin('SELECT bytes FROM uid_brands_v2.store_usage')).rows[0].bytes);const limited=new PgStore(pools.pool(),{maxBytes:used+100});
   const writes=await Promise.allSettled([limited.putArtifact(owner,job.jobId,Buffer.alloc(70,1),'application/zip'),limited.putArtifact(owner,job.jobId,Buffer.alloc(70,2),'application/zip')]);assert.equal(writes.filter(r=>r.status==='fulfilled').length,1);assert.ok(writes.some(r=>r.status==='rejected'&&code('STORAGE_LIMIT')(r.reason)));
   const actual=await pools.admin('SELECT (SELECT coalesce(sum(octet_length(document)),0) FROM uid_brands_v2.jobs)+(SELECT coalesce(sum(octet_length(document)),0) FROM uid_brands_v2.history)+(SELECT coalesce(sum(octet_length(document)),0) FROM uid_brands_v2.receipts)+(SELECT coalesce(sum(octet_length(bytes)),0) FROM uid_brands_v2.artifacts)+(SELECT coalesce(sum(octet_length(event)),0) FROM uid_brands_v2.telemetry) AS actual,(SELECT bytes FROM uid_brands_v2.store_usage) AS tracked');assert.equal(Number(actual.rows[0].actual),Number(actual.rows[0].tracked));
   await assert.rejects(limited.recordTelemetry(owner,job.jobId,{operation:'你好'.repeat(100)}),code('STORAGE_LIMIT'));assert.equal((await store.telemetry(owner,job.jobId)).length,1);
  });
  await t.test('leases reject parallel workers and stale fences',async()=>{
   const outcomes=await Promise.allSettled([store.acquireLease(owner,job.jobId,'worker1'),store.acquireLease(owner,job.jobId,'worker2')]);const won=outcomes.find(r=>r.status==='fulfilled');assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.ok(won&&won.status==='fulfilled');const first=won.value;
   await store.assertLease(owner,job.jobId,first);await store.releaseLease(owner,job.jobId,first);const next=await store.acquireLease(owner,job.jobId,'worker3');assert.equal(next.fence,first.fence+1);await assert.rejects(store.assertLease(owner,job.jobId,first),code('LEASE_EXPIRED'));await store.releaseLease(owner,job.jobId,first);await store.assertLease(owner,job.jobId,next);
   await assert.rejects(store.acquireLease(owner,job.jobId,'worker4',NaN),code('LEASE_LIMIT'));
  });
  await t.test('migration refuses a database with existing public application data',async()=>{
   await pools.admin('CREATE TABLE public.existing_application_table(value text)');
   await assert.rejects(migratePgStore(pools.pool(true)),/separate new database/);
   await pools.admin('DROP TABLE public.existing_application_table');
   assert.equal((await store.read(owner,job.jobId)).count,2);
  });
  await t.test('persistent restart retains jobs and expiry cleanup cascades with exact quota accounting',async()=>{
   await store.close();await db.close();db=new PGlite(directory);pools=new LocalPools(db);store=new PgStore(pools.pool());assert.equal((await store.read(owner,job.jobId)).count,2);
   await pools.admin('UPDATE uid_brands_v2.jobs SET expires=0');await assert.rejects(store.read(owner,job.jobId),code('NOT_FOUND'));assert.equal(await store.pruneExpired(),3);assert.equal(Number((await pools.admin('SELECT bytes FROM uid_brands_v2.store_usage')).rows[0].bytes),0);
   for(const table of ['jobs','history','receipts','artifacts','leases','telemetry'])assert.equal(Number((await pools.admin(`SELECT count(*) AS n FROM uid_brands_v2.${table}`)).rows[0].n),0);
  });
 }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});

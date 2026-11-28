import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { boundedId, hash, safeJson, V2Error } from './core.ts';
import { MAX_ZIP_ARCHIVE_BYTES } from './delivery-zip.ts';
import { artifactBatchHashes, type StoredJob, type OperationKey, type ArtifactReceipt, type StoredArtifact } from './store.ts';

export interface PgQueryResult { rows: Record<string, any>[]; rowCount?: number | null }
export interface PgClientLike { query(sql: string, values?: any[]): Promise<PgQueryResult>; release(): void }
export interface PgPoolLike { connect(): Promise<PgClientLike>; end(): Promise<void> }
const SCHEMA = 'uid_brands_v2';
const APP_ROLE = 'uid_brands_v2_app';
const PRODUCTION_REF = 'wuonwttmkadwsmefjukv';
const MIME = ['image/png','image/webp','image/jpeg','text/html','text/css','application/zip','application/json'];

/** Parse explicit connection fields: pg connection-string SSL parameters cannot
 * override certificate verification. No production/default URL fallback exists. */
export function readPgConnectionConfig(env: NodeJS.ProcessEnv = process.env, purpose: 'runtime'|'migration' = 'runtime') {
  const fail = () => { throw new V2Error('ISOLATION_REQUIRED','Use an explicitly authorized isolated V2 database host, identity and verified TLS.'); };
  if(env.V2_MODE!=='isolated-test'||!env.V2_DATABASE_URL||!env.V2_DATABASE_HOST||env.DATABASE_URL||env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail();
  let url: URL; try{url=new URL(env.V2_DATABASE_URL!);}catch{return fail();}
  const host=env.V2_DATABASE_HOST!;
  if(!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(host)||isIP(host)||host.endsWith('.')||host.includes(PRODUCTION_REF)||host!==url.hostname||/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host)||/\.(?:localhost|local|internal)$/.test(host))fail();
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hash||!url.username||!url.password||!/^\/[A-Za-z0-9_-]+$/.test(url.pathname))fail();
  let user:string,password:string;try{user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);}catch{return fail();}
  if([host,user,url.pathname].some(s=>s.includes(PRODUCTION_REF)))fail();
  for(const [key,value] of url.searchParams)if(key!=='sslmode'||!['require','verify-full'].includes(value))fail();
  const port=Number(url.port||5432);if(!Number.isInteger(port)||port<1||port>65535)fail();
  const ref=env.V2_DATABASE_PROJECT_REF;
  if(host.endsWith('.supabase.co')||host.endsWith('.pooler.supabase.com')){
    if(!ref||!/^[a-z]{20}$/.test(ref)||ref===PRODUCTION_REF)fail();
    if(host.endsWith('.supabase.co')&&host!==`db.${ref}.supabase.co`)fail();
    if(host.endsWith('.pooler.supabase.com')&&!user!.endsWith('.'+ref))fail();
  }
  if(purpose==='runtime'&&user!==(host.endsWith('.pooler.supabase.com')?`${APP_ROLE}.${ref}`:APP_ROLE))fail();
  const ca=env.V2_DATABASE_CA_PEM;
  if(ca&&!/^-----BEGIN CERTIFICATE-----\r?\n[\s\S]+-----END CERTIFICATE-----\s*$/.test(ca))fail();
  return {host,port,database:url.pathname.slice(1),user:user!,password:password!,ssl:{rejectUnauthorized:true as const,...(ca?{ca}:{})},max:4,connectionTimeoutMillis:10_000,idleTimeoutMillis:30_000,statement_timeout:15_000,query_timeout:20_000,application_name:'uid-brands-v2-test'};
}

/** Explicit setup only, not startup. Call readPgConnectionConfig(env,'migration')
 * before constructing a real admin pool. Tests inject only local PGlite. */
export async function migratePgStore(pool: PgPoolLike) {
  const sql=await readFile(new URL('./migrations/001_isolated_v2_store.sql',import.meta.url),'utf8');
  const client=await pool.connect();
  try{await client.query('BEGIN');await client.query(sql);await client.query('COMMIT');}
  catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
}

/** Async PostgreSQL store. Every tenant operation has its own transaction-local
 * RLS identity. A singleton quota row serializes mutations across processes;
 * revision CAS, receipts, history and byte accounting commit atomically. */
export class PgStore {
  private ttlMs: number;
  private maxBytes: number;
  constructor(private pool: PgPoolLike,options:{ttlMs?:number;maxBytes?:number}={}){
    // Leave room for PostgreSQL indexes, WAL and platform data on a free test DB.
    this.ttlMs=options.ttlMs??7*86400_000;this.maxBytes=options.maxBytes??128*1024*1024;
    if(!Number.isSafeInteger(this.ttlMs)||this.ttlMs<1000||this.ttlMs>30*86400_000)throw new V2Error('TTL_LIMIT','TTL must be 1 second to 30 days.');
    if(!Number.isSafeInteger(this.maxBytes)||this.maxBytes<1)throw new V2Error('STORAGE_LIMIT','Storage capacity must be a positive integer byte count.');
  }
  private async transaction<T>(owner:string|undefined,write:boolean,run:(client:PgClientLike)=>Promise<T>):Promise<T>{
    if(owner!==undefined)boundedId(owner,'principal');
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const role=(await client.query("SELECT current_user AS name,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS has_memberships,has_schema_privilege(current_user,'uid_brands_v2','CREATE') AS can_create FROM pg_roles r WHERE rolname=current_user")).rows[0];
      if(!role||role.name!==APP_ROLE||role.rolsuper||role.rolbypassrls||role.rolcreatedb||role.rolcreaterole||role.rolreplication||role.has_memberships||role.can_create)throw new V2Error('ISOLATION_REQUIRED','Runtime database role must be the restricted V2 app role.');
      await client.query("SELECT set_config('uid_brands_v2.owner',$1,true)",[owner??'']);
      if(write&&(await client.query(`SELECT bytes FROM ${SCHEMA}.store_usage WHERE singleton FOR UPDATE`)).rows.length!==1)throw new V2Error('ISOLATION_REQUIRED','V2 quota state is missing.');
      const result=await run(client);await client.query('COMMIT');return result;
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  }
  private async allocate(c:PgClientLike,extra:number){
    const result=await c.query(`UPDATE ${SCHEMA}.store_usage SET bytes=bytes+$1 WHERE singleton AND bytes+$1 BETWEEN 0 AND $2 RETURNING bytes`,[extra,this.maxBytes]);
    if(result.rows.length!==1)throw new V2Error('STORAGE_LIMIT','Isolated store is full; expire test jobs before continuing.',507);
  }
  private async readRow(c:PgClientLike,owner:string,id:string){
    boundedId(id,'job');const row=(await c.query(`SELECT document,expires FROM ${SCHEMA}.jobs WHERE id=$1 AND owner=$2`,[id,owner])).rows[0];
    if(!row||Number(row.expires)<=Date.now())throw new V2Error('NOT_FOUND','Job not found or expired.',404);
    return JSON.parse(row.document) as StoredJob;
  }
  private async assertJob(c:PgClientLike,owner:string,id:string){
    boundedId(id,'job');const row=(await c.query(`SELECT expires FROM ${SCHEMA}.jobs WHERE id=$1 AND owner=$2`,[id,owner])).rows[0];
    if(!row||Number(row.expires)<=Date.now())throw new V2Error('NOT_FOUND','Job not found or expired.',404);
  }
  private async findRow(c:PgClientLike,owner:string,key:string,inputHash?:string){
    boundedId(key,'idempotency key');const row=(await c.query(`SELECT id,input_hash FROM ${SCHEMA}.jobs WHERE owner=$1 AND idem=$2`,[owner,key])).rows[0];
    if(!row)return undefined;
    if(inputHash!==undefined&&row.input_hash!==inputHash)throw new V2Error('IDEMPOTENCY_CONFLICT','Idempotency key belongs to a different request.',409);
    return this.readRow(c,owner,row.id);
  }
  async findByKey(owner:string,key:string,inputHash?:string):Promise<StoredJob|undefined>{return this.transaction(owner,false,c=>this.findRow(c,owner,key,inputHash));}
  async create(owner:string,idempotencyKey:string,inputHash:string,initial:Record<string,any>):Promise<StoredJob>{
    return this.transaction(owner,true,async c=>{
      const old=await this.findRow(c,owner,idempotencyKey,inputHash);if(old)return old;
      const now=Date.now(),record:StoredJob={...safeJson(initial),jobId:randomUUID(),owner,storageRevision:0,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),expiresAt:new Date(now+this.ttlMs).toISOString()};
      const doc=JSON.stringify(record);await this.allocate(c,Buffer.byteLength(doc)*2);
      await c.query(`INSERT INTO ${SCHEMA}.jobs(id,owner,idem,input_hash,revision,expires,document) VALUES($1,$2,$3,$4,$5,$6,$7)`,[record.jobId,owner,idempotencyKey,inputHash,0,now+this.ttlMs,doc]);
      await c.query(`INSERT INTO ${SCHEMA}.history(job,revision,document) VALUES($1,$2,$3)`,[record.jobId,0,doc]);return safeJson(record);
    });
  }
  async read(owner:string,id:string):Promise<StoredJob>{return this.transaction(owner,false,c=>this.readRow(c,owner,id));}
  async update(owner:string,id:string,expectedRevision:number,mutation:(job:StoredJob)=>Record<string,any>,operation?:OperationKey):Promise<StoredJob>{
    return this.transaction(owner,true,async c=>{
      const current=await this.readRow(c,owner,id);
      if(operation){boundedId(operation.key);const old=(await c.query(`SELECT request_hash,document FROM ${SCHEMA}.receipts WHERE job=$1 AND operation=$2`,[id,operation.key])).rows[0];if(old){if(old.request_hash!==operation.requestHash)throw new V2Error('IDEMPOTENCY_CONFLICT','Operation key belongs to a different request.',409);return JSON.parse(old.document);}}
      if(!Number.isInteger(expectedRevision)||expectedRevision!==current.storageRevision)throw new V2Error('STALE_REVISION','Job changed; reload state before retrying.',409);
      const mutated=mutation(safeJson(current));if(mutated&&typeof (mutated as any).then==='function')throw new V2Error('ASYNC_MUTATION','Job mutations must be pure synchronous transformations.');
      const next=safeJson(mutated),record:StoredJob={...next,jobId:id,owner,storageRevision:current.storageRevision+1,createdAt:current.createdAt,expiresAt:current.expiresAt,updatedAt:new Date().toISOString()};
      const doc=JSON.stringify(record);await this.allocate(c,Buffer.byteLength(doc)*(operation?3:2)-Buffer.byteLength(JSON.stringify(current)));
      const changed=await c.query(`UPDATE ${SCHEMA}.jobs SET revision=$1,document=$2 WHERE id=$3 AND owner=$4 AND revision=$5 RETURNING id`,[record.storageRevision,doc,id,owner,expectedRevision]);
      if(changed.rows.length!==1)throw new V2Error('STALE_REVISION','Concurrent job update.',409);
      await c.query(`INSERT INTO ${SCHEMA}.history(job,revision,document) VALUES($1,$2,$3)`,[id,record.storageRevision,doc]);
      if(operation)await c.query(`INSERT INTO ${SCHEMA}.receipts(job,operation,request_hash,document) VALUES($1,$2,$3,$4)`,[id,operation.key,operation.requestHash,doc]);return record;
    });
  }
  async acquireLease(owner:string,id:string,holder:string,ttlMs=30_000){
    boundedId(holder);if(!Number.isSafeInteger(ttlMs)||ttlMs<100||ttlMs>120_000)throw new V2Error('LEASE_LIMIT','Lease duration exceeds limit.');
    return this.transaction(owner,true,async c=>{await this.assertJob(c,owner,id);const row=(await c.query(`SELECT holder,expires,fence FROM ${SCHEMA}.leases WHERE job=$1`,[id])).rows[0];if(row&&Number(row.expires)>Date.now())throw new V2Error('LEASE_BUSY','A task operation is already running.',409);const lease={holder,fence:Number(row?.fence??0)+1,expires:Date.now()+ttlMs};await c.query(`INSERT INTO ${SCHEMA}.leases(job,holder,expires,fence) VALUES($1,$2,$3,$4) ON CONFLICT(job) DO UPDATE SET holder=excluded.holder,expires=excluded.expires,fence=excluded.fence`,[id,holder,lease.expires,lease.fence]);return lease;});
  }
  async assertLease(owner:string,id:string,lease:{holder:string;fence:number}){return this.transaction(owner,false,async c=>{await this.assertJob(c,owner,id);const row=(await c.query(`SELECT expires FROM ${SCHEMA}.leases WHERE job=$1 AND holder=$2 AND fence=$3`,[id,lease.holder,lease.fence])).rows[0];if(!row||Number(row.expires)<=Date.now())throw new V2Error('LEASE_EXPIRED','Task lease expired; discard this result.',409);});}
  async releaseLease(owner:string,id:string,lease:{holder:string;fence:number}){return this.transaction(owner,true,async c=>{await this.assertJob(c,owner,id);await c.query(`UPDATE ${SCHEMA}.leases SET expires=0 WHERE job=$1 AND holder=$2 AND fence=$3`,[id,lease.holder,lease.fence]);});}
  async putArtifact(owner:string,id:string,bytes:Buffer,mime:string):Promise<ArtifactReceipt>{
    const maximum=mime==='application/zip'?MAX_ZIP_ARCHIVE_BYTES:32*1024*1024;
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>maximum)throw new V2Error('ASSET_SIZE_LIMIT',`Artifact must contain 1 to ${maximum} bytes for its type.`,413);
    if(!MIME.includes(mime))throw new V2Error('ASSET_TYPE','Unsupported artifact type.');
    return this.transaction(owner,true,async c=>{await this.assertJob(c,owner,id);const sha256=hash(bytes),old=(await c.query(`SELECT mime FROM ${SCHEMA}.artifacts WHERE job=$1 AND hash=$2`,[id,sha256])).rows[0];if(old&&old.mime!==mime)throw new V2Error('ASSET_TYPE','Existing bytes have a different type.');if(!old){await this.allocate(c,bytes.length);await c.query(`INSERT INTO ${SCHEMA}.artifacts(job,hash,mime,bytes) VALUES($1,$2,$3,$4)`,[id,sha256,mime,bytes]);}return {sha256,byteLength:bytes.length,mime};});
  }
  async readArtifacts(owner:string,id:string,hashes:string[]):Promise<StoredArtifact[]>{
    return this.transaction(owner,false,async c=>{
      await this.assertJob(c,owner,id);const requested=artifactBatchHashes(hashes);if(!requested.length)return [];
      const rows=(await c.query(`SELECT a.hash,a.bytes,a.mime FROM ${SCHEMA}.artifacts a JOIN ${SCHEMA}.jobs j ON j.id=a.job WHERE a.job=$1 AND a.hash=ANY($2::text[]) AND j.owner=$3 AND j.expires>$4`,[id,requested,owner,Date.now()])).rows;
      const found=new Map(rows.map(row=>[String(row.hash),row]));
      if(requested.some(sha256=>!found.has(sha256)))throw new V2Error('NOT_FOUND','Artifact not found.',404);
      return requested.map(sha256=>{const row=found.get(sha256)!,bytes=Buffer.from(row.bytes);if(hash(bytes)!==sha256)throw new V2Error('ASSET_CORRUPT','Artifact bytes failed integrity validation.',409);return {sha256,byteLength:bytes.length,mime:String(row.mime),bytes};});
    });
  }
  async readArtifact(owner:string,id:string,sha256:string):Promise<StoredArtifact>{return (await this.readArtifacts(owner,id,[sha256]))[0];}
  async getArtifact(owner:string,id:string,sha256:string):Promise<Buffer>{return (await this.readArtifact(owner,id,sha256)).bytes;}
  async artifactInfo(owner:string,id:string,sha256:string):Promise<ArtifactReceipt>{const {bytes:_bytes,...receipt}=await this.readArtifact(owner,id,sha256);return receipt;}
  async recordTelemetry(owner:string,id:string,event:Record<string,unknown>){return this.transaction(owner,true,async c=>{await this.assertJob(c,owner,id);const allow=['operation','durationMs','requestBytes','responseBytes','inputTokens','outputTokens','reasoningTokens','cachedTokens','model','effort','provider','measurementSource','cost','fallback','imageCalls','completion','eoVerdict'];const doc=JSON.stringify(safeJson(Object.fromEntries(Object.entries(event).filter(([key])=>allow.includes(key))),4096));await this.allocate(c,Buffer.byteLength(doc));await c.query(`INSERT INTO ${SCHEMA}.telemetry(job,event,created) VALUES($1,$2,$3)`,[id,doc,Date.now()]);});}
  async telemetry(owner:string,id:string):Promise<unknown[]>{return this.transaction(owner,false,async c=>{await this.assertJob(c,owner,id);return (await c.query(`SELECT event FROM ${SCHEMA}.telemetry WHERE job=$1 ORDER BY id`,[id])).rows.map(row=>JSON.parse(row.event));});}
  async pruneExpired():Promise<number>{return this.transaction(undefined,false,async c=>Number((await c.query(`SELECT ${SCHEMA}.prune_expired() AS count`)).rows[0].count));}
  async close(){await this.pool.end();}
}

import express, { type Request, type Response } from 'express';
import { McpServer, ResourceTemplate, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { OnepageOrchestrator, StartSchema, ResearchSchema, PlanSchema, QcSchema } from './orchestrator.ts';
import { compileCanonical, validateCompileInput, CANONICAL_COMPILER_URL } from './compiler.ts';
import { SqliteStore } from './store.ts';
import { Pool } from 'pg';
import { PgStore, readPgConnectionConfig } from './postgres-store.ts';
import { verifierFromEnv, type Principal, type VerifyPrincipal } from './auth.ts';
import { readConfig } from './config.ts';
import { oauthRouterFromEnv } from './oauth.ts';
import { safeJson, V2Error } from './core.ts';
import { preflightAsset } from '../uid-asset-preflight.ts';
import { projectToolResult } from './wire-response.ts';

export const BASELINE_COMMIT='87bf39d1f38eb1d0baee159b921efbd7e3aaf923';
export type RuntimeStore={ [K in keyof SqliteStore]: SqliteStore[K] extends (...args:infer A)=>infer R ? (...args:A)=>R|Promise<R> : SqliteStore[K] };
export type AppDependencies={orchestrator:OnepageOrchestrator;store:RuntimeStore;verify:VerifyPrincipal;origin:string;publicTest?:boolean;issuer?:string;resourceScopes?:string[];oauthRouter?:express.Router};
const id=z.string().uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().min(0);
const job={jobId:id},change={...job,revision};
const detail=z.enum(['compact','full']).optional().describe('Default compact; full restores the original response fields.');
const artifactExtension=(mime:string)=>({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/zip':'zip','text/html':'html','text/css':'css','application/json':'json'}[mime]||'bin');
function safeError(error:unknown) {
  if(error instanceof V2Error)return {code:error.code,message:error.message,status:error.status};
  if(error instanceof z.ZodError)return {code:'INVALID_INPUT',message:'Input does not match the advertised schema.',status:400,issues:error.issues.map(x=>({path:x.path,code:x.code}))};
  // Only stable machine codes are safe to return; never raw upstream errors or input values.
  const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)?error.message:'OPERATION_BLOCKED';
  return {code,message:'Operation did not complete. Reload state and address the unmet contract or unavailable dependency.',status:422};
}
export function createV2Server(principal:Principal,deps:AppDependencies) {
  const o=deps.orchestrator;
  const publicSandbox=principal.auth==='public-test';
  const server=new McpServer({name:'uid-brands-architecture-v2-test',version:'0.2.0'},{instructions:'Isolated experimental Onepage backend. Load full pinned stage rules before creative work. Reuse them only while still available in your context and state.context identity is unchanged; reload after context loss, reconnect or identity change. State responses are compact; onepage_get_state detail=full restores audit fields. Context receipt.coverageRef points to complete coverage in the same response. Preserve research and actual visual inspection. Status never proves pixels inspected. Only explicit user review or package authorization permits approvals. No production writes, publishing or training tools exist.'+(publicSandbox?' Public test sandbox: no authentication. Jobs and artifacts in this namespace are shared test data, not private user data. Use a fresh unique idempotency key per task. Review records identify an anonymous test actor, not a verified person.':'')});
  function register(name:string,description:string,schema:Record<string,z.ZodType<any,any>>,readOnly:boolean,run:(args:any)=>unknown|Promise<unknown>,reviewer=false) {
    server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:name==='onepage_start'||name==='onepage_submit_research'}},async (args:any)=>{
      const started=performance.now();
      try{
        safeJson(args,2_000_000);
        if(reviewer&&principal.role!=='reviewer')throw new V2Error('REVIEWER_REQUIRED','A separately provisioned reviewer credential is required for approval.',403);
        // Rule/evidence values can be arrays, scalars, null, or canonical objects
        // with their own access field. Preserve their exact JSON shape and data.
        const result=projectToolResult(name,await run(args),args.detail);const text=JSON.stringify(publicSandbox&&name!=='onepage_get_rule_or_evidence'?{...result as object,access:{mode:'public-test',sharedSandbox:true,actor:principal.subject,identityVerified:false}}:result);
        if((args as any).jobId)try{await deps.store.recordTelemetry(principal.owner,(args as any).jobId,{operation:name,durationMs:performance.now()-started,requestBytes:Buffer.byteLength(JSON.stringify(args)),responseBytes:Buffer.byteLength(text),fallback:name==='onepage_get_full_context',measurementSource:'server_wire_payload',inputTokens:null,outputTokens:null,reasoningTokens:null,cachedTokens:null,model:null,effort:null,cost:null});}catch{/* Telemetry cannot reverse a committed task action. */}
        return {content:[{type:'text' as const,text}],isError:false};
      }catch(error){const e=safeError(error);return {content:[{type:'text' as const,text:JSON.stringify({testMode:true,error:e})}],isError:true};}
    });
  }
  register('onepage_start','Create or resume an isolated Onepage job by idempotency key. Declare actual host capabilities. Public-source canonical read only.',StartSchema.shape,false,a=>o.start(principal.owner,a));
  register('onepage_get_state','Read current state, blockers, exact asset hashes and context identity. detail=full includes all audit lists.',{...job,detail},true,a=>o.state(principal.owner,a.jobId));
  register('onepage_get_stage_context','Load all pinned stage rules. Unchanged coverage is not rewritten. Compact receipt references coverage in this response; detail=full restores duplicate receipt fields.',{...job,detail},false,a=>o.getStageContext(principal.owner,a.jobId));
  register('onepage_get_rule_or_evidence','Retrieve exact pinned rule, JSON-pointer path or evidence:<sourceId> without a new compile.',{...job,path:z.string().min(1).max(2048)},true,a=>o.getRuleOrEvidence(principal.owner,a.jobId,a.path));
  register('onepage_get_full_context','Lossless full-context fallback from the same pinned revision. Large response; use only when needed.',job,true,a=>o.getFullContext(principal.owner,a.jobId));
  register('onepage_submit_research','Submit public-source research and actual uploaded inspection evidence. Recompile read-only and atomically pin a revision; stale writes rejected.',{...change,...ResearchSchema.shape},false,a=>{const {jobId,revision,...data}=a;return o.submitResearch(principal.owner,jobId,revision,data);});
  register('onepage_submit_plan','Validate exact copy, evidence-based GTK/FAQ decision and all required product/artwork allocations.',{...change,...PlanSchema.shape},false,a=>{const {jobId,revision,...data}=a;return o.submitPlan(principal.owner,jobId,revision,data);});
  register('onepage_submit_asset','Bind previously uploaded actual WebP bytes to a canonical slot; validates bytes, dimensions, content revision and prerequisites.',{...change,slot:z.string().min(1).max(100),sha256:sha},false,a=>o.submitAsset(principal.owner,a.jobId,a.revision,{slot:a.slot,sha256:a.sha256}));
  register('onepage_submit_qc','Submit genuine host/human inspection findings tied to exact current hashes. Never claim inspection from flags or metadata.',{...change,...QcSchema.shape},false,a=>{const {jobId,revision,...data}=a;if(data.method==='human_visual'&&principal.role!=='reviewer')throw new V2Error('REVIEWER_REQUIRED','Human review requires the reviewer credential.',403);return o.submitQc(principal.owner,jobId,revision,data,principal.subject);});
  register('onepage_advance','Check canonical prerequisites, record completed substeps, and return the next action or exact blocker.',change,false,a=>o.advance(principal.owner,a.jobId,a.revision));
  register('onepage_revision','Invalidate the named scope and dependents, preserving unaffected asset bytes. Retries are bounded. Set unlockApprovedCopy only for an explicit user-authorized copy change.',{...change,scope:z.enum(['asset','content','research','cancel','retry']),slots:z.array(z.string().max(100)).max(24).optional(),unlockApprovedCopy:z.boolean().optional(),reason:z.string().min(1).max(4000)},false,a=>{if(a.unlockApprovedCopy&&principal.role!=='reviewer')throw new V2Error('REVIEWER_REQUIRED','Unlocking approved copy requires explicit user copy-change authorization and a reviewer credential.',403);return o.revise(principal.owner,a.jobId,a.revision,{scope:a.scope,slots:a.slots,reason:a.reason,unlockApprovedCopy:a.unlockApprovedCopy});});
  register('onepage_render','Render unchanged canonical GTK/FAQ templates from current validated bytes at desktop/mobile viewports. Visual review remains required.',change,false,a=>o.render(principal.owner,a.jobId,a.revision));
  register('onepage_approve','Record explicit user approval of the exact hash after review. Never call automatically. '+(publicSandbox?'Public sandbox records an anonymous test approval; no verified identity is claimed.':'Reviewer credential required.'),{...change,kind:z.enum(['content','final','package']),expectedHash:sha},false,a=>o.approve(principal.owner,a.jobId,a.revision,{kind:a.kind,expectedHash:a.expectedHash},principal.subject),true);
  register('onepage_package','After explicit package approval, create and reopen canonical ZIP, validate CRC, image decoding and current hashes.',{...change,productLineName:z.string().min(1).max(120),productSlug:z.string().min(1).max(120)},false,a=>o.package(principal.owner,a.jobId,a.revision,{productLineName:a.productLineName,productSlug:a.productSlug}));
  register('onepage_get_telemetry','Read measured server payload bytes/timings and unavailable model-token fields; payload savings are not token savings.',job,true,async a=>({events:await deps.store.telemetry(principal.owner,a.jobId),modelTokensAvailable:false}));
  // Bytes are never fetched from arbitrary URLs. MCP supports bounded base64 when REST file transfer is unavailable.
  register('onepage_upload_artifact','Transfer actual authorized PNG/JPEG/WebP source or output bytes into this job. Upload is not proof of visual inspection. For >1.5MiB use POST /v2/jobs/{jobId}/artifacts with the same access mode.',{...job,mime:z.enum(['image/png','image/webp','image/jpeg']),base64:z.string().min(4).max(2_000_000)},false,async a=>{
    await deps.store.read(principal.owner,a.jobId);
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.base64))throw new V2Error('INVALID_BASE64','Invalid byte encoding.');
    const bytes=Buffer.from(a.base64,'base64');const image=await preflightAsset(bytes);if('image/'+image.format!==a.mime)throw new V2Error('ASSET_TYPE','Declared type does not match decoded image bytes.');return deps.store.putArtifact(principal.owner,a.jobId,bytes,a.mime);
  });
  server.registerTool('onepage_read_artifact',{description:'Retrieve actual job image bytes for visual inspection or a job-scoped artifact download reference. Never treat retrieval alone as inspection.',inputSchema:{...job,sha256:sha},annotations:{readOnlyHint:true,openWorldHint:false}},async a=>{
    try{
      const info=await deps.store.artifactInfo(principal.owner,a.jobId,a.sha256);
      const bytes=await deps.store.getArtifact(principal.owner,a.jobId,a.sha256);
      if(info.mime.startsWith('image/')&&bytes.length<=8*1024*1024)return {content:[{type:'image' as const,data:bytes.toString('base64'),mimeType:info.mime}],isError:false};
      return {content:[{type:'resource_link' as const,uri:`uid-v2://artifacts/${a.jobId}/${a.sha256}`,name:a.sha256+'.'+artifactExtension(info.mime),mimeType:info.mime,size:bytes.length,description:'Actual current artifact bytes via MCP resources/read.'},{type:'text' as const,text:JSON.stringify({sha256:a.sha256,byteLength:bytes.length,downloadUrl:`${deps.origin}/v2/jobs/${a.jobId}/artifacts/${a.sha256}`,authentication:publicSandbox?'No authentication required for this public sandbox artifact.':'Same V2 bearer required; use MCP resources/read if the host cannot authenticate downloads. This is not a public share link.'})}],isError:false};
    }catch(error){return {content:[{type:'text' as const,text:JSON.stringify({error:safeError(error)})}],isError:true};}
  });
  server.registerResource('onepage-artifact',new ResourceTemplate('uid-v2://artifacts/{jobId}/{sha256}',{list:undefined}),{description:'Owner-scoped actual artifact bytes, including canonical ZIP and HTML preview bundle.'},async(uri,variables)=>{
    const jobId=id.parse(variables.jobId),digest=sha.parse(variables.sha256);
    const info=await deps.store.artifactInfo(principal.owner,jobId,digest);
    const bytes=await deps.store.getArtifact(principal.owner,jobId,digest);
    return {contents:[{uri:uri.href,mimeType:info.mime,blob:bytes.toString('base64')}]};
  });
  return server;
}
export function createV2App(deps:AppDependencies) {
  const app=express();app.disable('x-powered-by');
  const limits=new Map<string,{count:number;reset:number}>();
  app.use((req,res,next)=>{res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});if(req.get('host')?.toLowerCase()!==new URL(deps.origin).host.toLowerCase())return res.status(403).json({error:'HOST_NOT_ALLOWED'});const origin=req.get('origin');if(origin&&origin!==deps.origin)return res.status(403).json({error:'ORIGIN_NOT_ALLOWED'});next();});
  app.get('/healthz',(_req,res)=>res.json({status:'ok',server:'uid-brands-architecture-v2-test',testMode:true,baseline:BASELINE_COMMIT,authRequired:!deps.publicTest,publicSandbox:!!deps.publicTest,...(deps.publicTest?{publicReviewIdentityVerified:false}:{}),authMode:deps.publicTest?'public-test':deps.issuer?'jwt':'test-token',creativeParity:'NOT_VERIFIED'}));
  if(deps.issuer){const metadata={resource:deps.origin+'/api/mcp',authorization_servers:[deps.issuer],bearer_methods_supported:['header'],...(deps.resourceScopes?.length?{scopes_supported:deps.resourceScopes}:{})};app.get(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/api/mcp'],(_req,res)=>res.json(metadata));}
  if(deps.oauthRouter)app.use(deps.oauthRouter);
  app.use(async(req,res,next)=>{
    try{
      const principal=await deps.verify(req.get('authorization'));
      const now=Date.now();for(const [key,v] of limits)if(v.reset<now)limits.delete(key);
      if(limits.size>1000)throw new V2Error('RATE_LIMIT','Too many active clients.',429);
      const entry=limits.get(principal.subject)??{count:0,reset:now+60_000};entry.count++;limits.set(principal.subject,entry);
      if(entry.count>120)throw new V2Error('RATE_LIMIT','Request limit reached. Retry after the current minute.',429);
      res.locals.principal=principal;next();
    }catch(error){const e=safeError(error);if(e.status===401)res.set('WWW-Authenticate',deps.issuer?`Bearer resource_metadata="${deps.origin}/.well-known/oauth-protected-resource/api/mcp"`:'Bearer realm="uid-brands-v2-test"');res.status(e.status).json({error:e.code});}
  });
  app.post('/v2/jobs/:jobId/artifacts',express.raw({type:['image/png','image/webp','image/jpeg'],limit:'32mb'}),async(req,res)=>{
    try{await deps.store.read(res.locals.principal.owner,String(req.params.jobId));if(!Buffer.isBuffer(req.body))throw new V2Error('ASSET_TYPE','Only actual PNG/JPEG/WebP bytes are accepted.');const mime=req.get('content-type')!.split(';')[0];const image=await preflightAsset(req.body);if('image/'+image.format!==mime)throw new V2Error('ASSET_TYPE','Declared type does not match decoded image bytes.');const r=await deps.store.putArtifact(res.locals.principal.owner,String(req.params.jobId),req.body,mime);res.status(201).json(r);}catch(error){const e=safeError(error);res.status(e.status).json({error:e.code});}
  });
  app.get('/v2/jobs/:jobId/artifacts/:sha256',async(req,res)=>{
    try{const info=await deps.store.artifactInfo(res.locals.principal.owner,String(req.params.jobId),String(req.params.sha256));const bytes=await deps.store.getArtifact(res.locals.principal.owner,String(req.params.jobId),String(req.params.sha256));res.set({'Content-Type':info.mime,'Content-Disposition':`attachment; filename="${req.params.sha256}.${artifactExtension(info.mime)}"`,'Content-Security-Policy':"default-src 'none'; sandbox"});res.send(bytes);}catch(error){const e=safeError(error);res.status(e.status).json({error:e.code});}
  });
  app.use(express.json({limit:'2mb',strict:true}));
  app.all('/api/mcp',async(req:Request,res:Response)=>{
    const principal=res.locals.principal as Principal;
    const handler=createMcpHandler(()=>createV2Server(principal,deps),{legacy:'stateless'});
    try{await toNodeHandler(handler)(req,res,req.body);}catch{if(!res.headersSent)res.status(500).json({error:'MCP_TRANSPORT_FAILED'});}
  });
  app.use((_req,res)=>res.status(404).json({error:'NOT_FOUND'}));
  app.use((error:any,_req:Request,res:Response,_next:express.NextFunction)=>res.status(error?.type==='entity.too.large'?413:400).json({error:'INVALID_OR_OVERSIZED_REQUEST'}));
  return app;
}
export async function main(){
  const config=readConfig();const verify=verifierFromEnv(process.env);
  let store:RuntimeStore;
  if(config.store==='postgres'){
    const pool=new Pool(readPgConnectionConfig(process.env));
    // pg removes a failed idle client; keep the server alive for a fresh connection.
    // Never log the raw error, which can include connection details.
    pool.on('error',()=>process.stderr.write('V2 database idle connection closed; subsequent requests will reconnect.\n'));
    store=new PgStore(pool);
  }else store=new SqliteStore(config.database!);
  await store.pruneExpired();
  const orchestrator=new OnepageOrchestrator({store,artifacts:{get:(owner,id,sha)=>store.getArtifact(owner,id,sha),put:(owner,id,bytes,mime)=>store.putArtifact(owner,id,bytes,mime)},compile:input=>compileCanonical(validateCompileInput(input)),baselineCommit:BASELINE_COMMIT,sourceUrl:CANONICAL_COMPILER_URL});
  const app=createV2App({orchestrator,store,verify,origin:config.origin,publicTest:process.env.V2_AUTH_MODE==='public-test',issuer:process.env.V2_AUTH_MODE==='jwt'?process.env.V2_JWT_ISSUER:undefined,resourceScopes:process.env.V2_AUTH_MODE==='jwt'?JSON.parse(process.env.V2_OAUTH_REQUIRED_SCOPES_JSON||'[]'):undefined,oauthRouter:oauthRouterFromEnv(process.env,config.origin)});
  const server=app.listen(config.port,'0.0.0.0',()=>process.stdout.write(JSON.stringify({server:'uid-brands-architecture-v2-test',port:config.port,testMode:true})+'\n'));
  const timer=setInterval(()=>{void Promise.resolve(store.pruneExpired()).catch(()=>{});},60_000);timer.unref();
  let stopping=false;const stop=()=>{if(stopping)return;stopping=true;clearInterval(timer);server.close(()=>{void Promise.resolve(store.close()).finally(()=>process.exit(0));});setTimeout(()=>process.exit(1),25_000).unref();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('V2 startup blocked: verify isolated authentication, durable state and configuration.\n');process.exitCode=1;});

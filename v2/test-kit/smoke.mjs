/** Dependency-free Node 24 test. Creates/resumes one isolated synthetic job and
 * uploads the labelled fixture. Never invokes approval, deployment or production. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {argumentsFor,privateToken,reportWriter,createClient,sha256,BASELINE_COMMIT,healthPolicy,smokeIdempotencyKey,safeFailure,setupFailure} from './common.mjs';
async function main(){
 const args=argumentsFor(['origin','auth-mode','token-file','output','source-commit']);const authMode=args['auth-mode'],token=authMode==='bearer'?privateToken(args['token-file']):null;
 const save=reportWriter(args.output,args['token-file']?[args['token-file']]:[]),checks={},operations=[];
 const report={schemaVersion:'uid-v2.test-kit.smoke/2',observedAt:new Date().toISOString(),origin:args.origin,sourceCommitLabel:args['source-commit']??null,authMode,auth:authMode==='public'?'anonymous shared public sandbox':'explicit independent opaque credential',checks,operations,creativeCompletion:false,pixelInspection:false,gptConnection:false,productionWrites:false,limitations:['Source commit is a caller-supplied label, not deployment attestation.','Public sandbox data is intentionally shared. Bearer mode keeps a separate private identity; this script does not prove all cross-owner boundaries.','Reconnect checks recovery across HTTP initialization, not a service restart.','Protocol and byte transfer are tested; creative EO, visual inspection and real GPT connection are not assessed.']};
 const {request,rpc,tool,authHeaders}=createClient(args.origin,token,operations);
 async function expectStatus(path,options,status){const response=await request(path,options);assert.equal(response.status,status);await response.body?.cancel();}
 try{
  const health=await request('/healthz');assert.equal(health.status,200);const data=await health.json();assert.equal(data.server,'uid-brands-architecture-v2-test');assert.equal(data.testMode,true);assert.equal(data.baseline,BASELINE_COMMIT);const policy=healthPolicy(data,authMode);checks.health={status:200,baseline:data.baseline,...policy};
  if(policy.publicSandbox){const anonymous=createClient(args.origin,null);const discovered=await anonymous.rpc('tools/list');assert.equal(discovered.tools.length,17);checks.publicSandboxDiscovery=true;}else await expectStatus('/api/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},401);
  await expectStatus('/api/mcp',{method:'POST',headers:{Authorization:'Bearer uidv2_'+randomBytes(32).toString('base64url'),'Content-Type':'application/json'},body:'{}'},401);
  await expectStatus('/api/mcp',{method:'POST',headers:{Authorization:'','Content-Type':'application/json'},body:'{}'},401);
  await expectStatus('/api/mcp',{method:'POST',headers:{...authHeaders,Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'},403);checks.authentication={missingAuthorization:policy.publicSandbox?200:401,invalidProvidedCredential:401,emptyProvidedCredential:401,foreignOrigin:403};
  const initialized=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'uid-v2-test-kit',version:'1'}});assert.equal(initialized.serverInfo.name,'uid-brands-architecture-v2-test');
  await rpc('notifications/initialized',{},{notification:true});const list=await rpc('tools/list');assert.equal(list.tools.length,17);assert.ok(list.tools.every(t=>t.name.startsWith('onepage_')));assert.equal(new Set(list.tools.map(t=>t.name)).size,17);checks.discovery={tools:17,protocol:'2025-06-18',toolSchemaBytes:Buffer.byteLength(JSON.stringify(list.tools))};
  const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'uid-v2-test-kit',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}};
  assert.equal((await rpc('tools/list',{_meta:meta},{version:'2026-07-28'})).tools.length,17);checks.modernEnvelope='2026-07-28';
  await expectStatus('/api/mcp',{headers:{...authHeaders,Accept:'text/event-stream'}},405);
  await expectStatus('/api/mcp',{method:'DELETE',headers:{...authHeaders}},405);
  await expectStatus('/api/mcp',{method:'POST',headers:{...authHeaders,'Content-Type':'application/json',Accept:''},body:JSON.stringify({jsonrpc:'2.0',id:999,method:'tools/list',params:{}})},406);
  await expectStatus('/api/tools/submit_training_feedback',{method:'POST',headers:{...authHeaders}},404);checks.transportNegative={get:405,delete:405,noAccept:406,legacyWriteProxy:404};
  const start={brand:'pawfecthouse',sourceUrl:'https://pawfecthouse.com/collections/all',sourceType:'collection',brief:'Standalone V2 transport test; synthetic fixture only. No creative research or completion claimed.',idempotencyKey:smokeIdempotencyKey(authMode,args['source-commit']),capabilities:{artifactTransfer:true,imageInspection:false}};
  const job=await tool('onepage_start',start);assert.ok(job.jobId);assert.equal(job.testMode,true);report.jobId=job.jobId;report.idempotencyKey=start.idempotencyKey;
  const context=await tool('onepage_get_stage_context',{jobId:job.jobId});assert.ok(context.receipt?.bundleHash);
  const full=await tool('onepage_get_full_context',{jobId:job.jobId});assert.equal(full.snapshotHash,job.canonicalHash);assert.equal(full.packet.execution.length,23);assert.deepEqual(full.packet.execution,job.canonicalSteps);checks.canonical={executionSteps:23,snapshotHash:full.snapshotHash,receiptIssued:true,fullFallback:true};
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'uid-v2-test-kit-reconnect',version:'1'}});const resumed=await tool('onepage_start',start);assert.equal(resumed.jobId,job.jobId);assert.equal(resumed.canonicalHash,job.canonicalHash);const state=await tool('onepage_get_state',{jobId:job.jobId});assert.equal(state.jobId,job.jobId);checks.resume={sameJob:true,state:state.state,storageRevision:state.storageRevision};
  const bytes=readFileSync(new URL('./fixtures/synthetic-transport.png',import.meta.url)),sha=sha256(bytes);
  const upload=await tool('onepage_upload_artifact',{jobId:job.jobId,mime:'image/png',base64:bytes.toString('base64')});assert.equal(upload.sha256,sha);assert.equal(upload.byteLength,bytes.length);
  const image=(await rpc('tools/call',{name:'onepage_read_artifact',arguments:{jobId:job.jobId,sha256:sha}})).content[0];assert.equal(image.type,'image');assert.equal(image.mimeType,'image/png');assert.equal(sha256(Buffer.from(image.data,'base64')),sha);
  const uri=`uid-v2://artifacts/${job.jobId}/${sha}`,resource=(await rpc('resources/read',{uri})).contents[0];assert.equal(resource.uri,uri);assert.equal(resource.mimeType,'image/png');assert.equal(sha256(Buffer.from(resource.blob,'base64')),sha);
  const rawUpload=await request(`/v2/jobs/${job.jobId}/artifacts`,{method:'POST',headers:{...authHeaders,'Content-Type':'image/png'},body:bytes});assert.equal(rawUpload.status,201);assert.equal((await rawUpload.json()).sha256,sha);
  const rawDownload=await request(`/v2/jobs/${job.jobId}/artifacts/${sha}`,{headers:{...authHeaders}});assert.equal(rawDownload.status,200);assert.equal(rawDownload.headers.get('content-type'),'image/png');assert.equal(rawDownload.headers.get('x-content-type-options'),'nosniff');assert.match(rawDownload.headers.get('content-disposition')||'',/^attachment;/);assert.equal(sha256(Buffer.from(await rawDownload.arrayBuffer())),sha);
  const anonymousStatus=authMode==='public'?200:policy.publicSandbox?404:401;
  if(authMode==='public'){const anonymous=await request(`/v2/jobs/${job.jobId}/artifacts/${sha}`);assert.equal(anonymous.status,200);assert.equal(sha256(Buffer.from(await anonymous.arrayBuffer())),sha);}else await expectStatus(`/v2/jobs/${job.jobId}/artifacts/${sha}`,{},anonymousStatus);
  checks.artifacts={synthetic:true,sha256:sha,bytes:bytes.length,mime:'image/png',mcpUpload:true,mcpImageBytes:true,resourceRead:true,restUpload:true,restDownload:true,anonymousReadStatus:anonymousStatus,anonymousDenied:authMode==='bearer',anonymousBytesVerified:authMode==='public'};
  const invalidMime=await rpc('tools/call',{name:'onepage_upload_artifact',arguments:{jobId:job.jobId,mime:'image/webp',base64:bytes.toString('base64')}},{allowError:true});assert.equal(invalidMime.packet.result.isError,true);assert.equal(JSON.parse(invalidMime.packet.result.content[0].text).error.code,'ASSET_TYPE');checks.mimeMismatchRejected=true;
  const telemetry=await tool('onepage_get_telemetry',{jobId:job.jobId});assert.equal(telemetry.modelTokensAvailable,false);assert.ok(telemetry.events.some(e=>e.fallback===true));checks.telemetry={events:telemetry.events.length,modelTokensAvailable:false,fallbackRecorded:true};
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=safeFailure(error);process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();save(report);console.log(JSON.stringify({status:report.status,reportFile:args.output,credentialsPrinted:false}));}
}
main().catch(setupFailure);

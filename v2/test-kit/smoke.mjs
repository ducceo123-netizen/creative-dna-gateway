/** Dependency-free Node 24 test. Creates/resumes one isolated synthetic job and
 * uploads the labelled fixture. Never invokes approval, deployment or production. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {argumentsFor,privateToken,reportWriter,createClient,sha256,BASELINE_COMMIT,safeFailure,setupFailure} from './common.mjs';
async function main(){
 const args=argumentsFor(['origin','token-file','output','source-commit']);const token=privateToken(args['token-file']);
 const save=reportWriter(args.output,[args['token-file']]),checks={},operations=[];
 const report={schemaVersion:'uid-v2.test-kit.smoke/1',observedAt:new Date().toISOString(),origin:args.origin,sourceCommitLabel:args['source-commit']??null,auth:'explicit independent opaque credential',checks,operations,creativeCompletion:false,pixelInspection:false,gptConnection:false,productionWrites:false,limitations:['Source commit is a caller-supplied label, not deployment attestation.','One provisioned identity is used; this test does not establish cross-owner authenticated isolation.','Reconnect checks recovery across HTTP initialization, not a service restart.','Protocol and byte transfer are tested; creative EO, visual inspection and real GPT connection are not assessed.']};
 const {request,rpc,tool}=createClient(args.origin,token,operations);
 async function expectStatus(path,options,status){const response=await request(path,options);assert.equal(response.status,status);await response.body?.cancel();}
 try{
  const health=await request('/healthz');assert.equal(health.status,200);const data=await health.json();assert.equal(data.server,'uid-brands-architecture-v2-test');assert.equal(data.testMode,true);assert.equal(data.baseline,BASELINE_COMMIT);checks.health={status:200,baseline:data.baseline};
  await expectStatus('/api/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},401);
  await expectStatus('/api/mcp',{method:'POST',headers:{Authorization:'Bearer uidv2_'+randomBytes(32).toString('base64url'),'Content-Type':'application/json'},body:'{}'},401);
  await expectStatus('/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'},403);checks.authNegative={missing:401,randomCredential:401,foreignOrigin:403};
  const initialized=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'uid-v2-test-kit',version:'1'}});assert.equal(initialized.serverInfo.name,'uid-brands-architecture-v2-test');
  await rpc('notifications/initialized',{},{notification:true});const list=await rpc('tools/list');assert.equal(list.tools.length,17);assert.ok(list.tools.every(t=>t.name.startsWith('onepage_')));assert.equal(new Set(list.tools.map(t=>t.name)).size,17);checks.discovery={tools:17,protocol:'2025-06-18',toolSchemaBytes:Buffer.byteLength(JSON.stringify(list.tools))};
  const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'uid-v2-test-kit',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}};
  assert.equal((await rpc('tools/list',{_meta:meta},{version:'2026-07-28'})).tools.length,17);checks.modernEnvelope='2026-07-28';
  await expectStatus('/api/mcp',{headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'}},405);
  await expectStatus('/api/mcp',{method:'DELETE',headers:{Authorization:'Bearer '+token}},405);
  await expectStatus('/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:''},body:JSON.stringify({jsonrpc:'2.0',id:999,method:'tools/list',params:{}})},406);
  await expectStatus('/api/tools/submit_training_feedback',{method:'POST',headers:{Authorization:'Bearer '+token}},404);checks.transportNegative={get:405,delete:405,noAccept:406,legacyWriteProxy:404};
  const start={brand:'pawfecthouse',sourceUrl:'https://pawfecthouse.com/collections/all',sourceType:'collection',brief:'Standalone V2 transport test; synthetic fixture only. No creative research or completion claimed.',idempotencyKey:'test-kit-smoke-v1'+(args['source-commit']?'-'+args['source-commit'].slice(0,12):''),capabilities:{artifactTransfer:true,imageInspection:false}};
  const job=await tool('onepage_start',start);assert.ok(job.jobId);assert.equal(job.testMode,true);report.jobId=job.jobId;report.idempotencyKey=start.idempotencyKey;
  const context=await tool('onepage_get_stage_context',{jobId:job.jobId});assert.ok(context.receipt?.bundleHash);
  const full=await tool('onepage_get_full_context',{jobId:job.jobId});assert.equal(full.snapshotHash,job.canonicalHash);assert.equal(full.packet.execution.length,23);assert.deepEqual(full.packet.execution,job.canonicalSteps);checks.canonical={executionSteps:23,snapshotHash:full.snapshotHash,receiptIssued:true,fullFallback:true};
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'uid-v2-test-kit-reconnect',version:'1'}});const resumed=await tool('onepage_start',start);assert.equal(resumed.jobId,job.jobId);assert.equal(resumed.canonicalHash,job.canonicalHash);const state=await tool('onepage_get_state',{jobId:job.jobId});assert.equal(state.jobId,job.jobId);checks.resume={sameJob:true,state:state.state,storageRevision:state.storageRevision};
  const bytes=readFileSync(new URL('./fixtures/synthetic-transport.png',import.meta.url)),sha=sha256(bytes);
  const upload=await tool('onepage_upload_artifact',{jobId:job.jobId,mime:'image/png',base64:bytes.toString('base64')});assert.equal(upload.sha256,sha);assert.equal(upload.byteLength,bytes.length);
  const image=(await rpc('tools/call',{name:'onepage_read_artifact',arguments:{jobId:job.jobId,sha256:sha}})).content[0];assert.equal(image.type,'image');assert.equal(image.mimeType,'image/png');assert.equal(sha256(Buffer.from(image.data,'base64')),sha);
  const uri=`uid-v2://artifacts/${job.jobId}/${sha}`,resource=(await rpc('resources/read',{uri})).contents[0];assert.equal(resource.uri,uri);assert.equal(resource.mimeType,'image/png');assert.equal(sha256(Buffer.from(resource.blob,'base64')),sha);
  const rawUpload=await request(`/v2/jobs/${job.jobId}/artifacts`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'image/png'},body:bytes});assert.equal(rawUpload.status,201);assert.equal((await rawUpload.json()).sha256,sha);
  const rawDownload=await request(`/v2/jobs/${job.jobId}/artifacts/${sha}`,{headers:{Authorization:'Bearer '+token}});assert.equal(rawDownload.status,200);assert.equal(rawDownload.headers.get('content-type'),'image/png');assert.equal(rawDownload.headers.get('x-content-type-options'),'nosniff');assert.match(rawDownload.headers.get('content-disposition')||'',/^attachment;/);assert.equal(sha256(Buffer.from(await rawDownload.arrayBuffer())),sha);
  await expectStatus(`/v2/jobs/${job.jobId}/artifacts/${sha}`,{},401);checks.artifacts={synthetic:true,sha256:sha,bytes:bytes.length,mime:'image/png',mcpUpload:true,mcpImageBytes:true,resourceRead:true,restUpload:true,restDownload:true,anonymousDenied:true};
  const invalidMime=await rpc('tools/call',{name:'onepage_upload_artifact',arguments:{jobId:job.jobId,mime:'image/webp',base64:bytes.toString('base64')}},{allowError:true});assert.equal(invalidMime.packet.result.isError,true);assert.equal(JSON.parse(invalidMime.packet.result.content[0].text).error.code,'ASSET_TYPE');checks.mimeMismatchRejected=true;
  const telemetry=await tool('onepage_get_telemetry',{jobId:job.jobId});assert.equal(telemetry.modelTokensAvailable,false);assert.ok(telemetry.events.some(e=>e.fallback===true));checks.telemetry={events:telemetry.events.length,modelTokensAvailable:false,fallbackRecorded:true};
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=safeFailure(error);process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();save(report);console.log(JSON.stringify({status:report.status,reportFile:args.output,credentialsPrinted:false}));}
}
main().catch(setupFailure);

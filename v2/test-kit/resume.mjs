/** Read existing state and bytes only. Does not restart or deploy a service. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {argumentsFor,privateToken,reportWriter,createClient,sha256,safeFailure,setupFailure} from './common.mjs';
async function main(){
 const args=argumentsFor(['origin','token-file','output','before','deployment','source-commit']);
 if(!args.before||!args.deployment||args.deployment.length>200||!/^[A-Za-z0-9_.:@/ -]+$/.test(args.deployment))throw Error('REQUIRED_BEFORE_AND_DEPLOYMENT_LABEL');
 const before=JSON.parse(readFileSync(args.before,'utf8'));if(before.status!=='PASS'||before.origin!==args.origin||!before.jobId||!before.checks?.artifacts?.synthetic)throw Error('INVALID_BEFORE_REPORT');
 const token=privateToken(args['token-file']),save=reportWriter(args.output,[args['token-file'],args.before]),operations=[];
 const report={schemaVersion:'uid-v2.test-kit.resume/1',observedAt:new Date().toISOString(),origin:args.origin,priorSmokeAt:before.finishedAt,priorJobId:before.jobId,sourceCommitLabel:args['source-commit']??null,operatorReportedDeployment:args.deployment,verification:'Existing job and artifact recovery; deployment or restart must be independently confirmed by the operator.',operations,productionWrites:false,creativeCompletion:false,gptConnection:false};
 const {rpc,tool}=createClient(args.origin,token,operations);
 try{
  const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'uid-v2-test-kit-recovery',version:'1'}});assert.equal(init.serverInfo.name,'uid-brands-architecture-v2-test');
  const state=await tool('onepage_get_state',{jobId:before.jobId});assert.equal(state.jobId,before.jobId);assert.equal(state.canonicalHash,before.checks.canonical.snapshotHash);assert.equal(state.storageRevision,before.checks.resume.storageRevision);
  const artifact=before.checks.artifacts,uri=`uid-v2://artifacts/${before.jobId}/${artifact.sha256}`;const resource=(await rpc('resources/read',{uri})).contents[0];assert.equal(resource.uri,uri);assert.equal(resource.mimeType,artifact.mime);const bytes=Buffer.from(resource.blob,'base64');assert.equal(bytes.length,artifact.bytes);assert.equal(sha256(bytes),artifact.sha256);
  Object.assign(report,{status:'PASS',state:state.state,storageRevision:state.storageRevision,canonicalHash:state.canonicalHash,artifact:{sha256:artifact.sha256,bytes:artifact.bytes,mime:artifact.mime,synthetic:true,bytesVerified:true}});
 }catch(error){report.status='FAIL';report.failure=safeFailure(error);process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();save(report);console.log(JSON.stringify({status:report.status,reportFile:args.output,credentialsPrinted:false}));}
}
main().catch(setupFailure);

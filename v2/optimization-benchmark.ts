/** Offline wire projection benchmark. Uses the same pinned packet on both sides;
 * it never invokes a model, a compiler endpoint, or a creative/approval tool. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSnapshot, stageContext, fullContext, type Packet } from './rules.ts';
import { compactStageContext, expandStageContext } from './wire-context.ts';
import { compactState } from './wire-state.ts';
import { OnepageOrchestrator } from './orchestrator.ts';
import { SqliteStore } from './store.ts';
import { CANONICAL_COMPILER_URL } from './compiler.ts';

const baselineCommit='87bf39d1f38eb1d0baee159b921efbd7e3aaf923';
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
const sizes=(before:unknown,after:unknown)=>({beforeBytes:bytes(before),afterBytes:bytes(after),reductionPercent:100*(1-bytes(after)/bytes(before))});
export async function benchmarkOptimization(packet:Packet){
 const snapshot=createSnapshot(packet,{sourceUrl:CANONICAL_COMPILER_URL,observedAt:'2026-11-28T00:00:00.000Z',baselineCommit,visibility:'public'});
 const stages=['init','research','references','content','allocation','materials','qc','mapping','review','packaging'].map(stage=>{
  const original=stageContext(snapshot,stage,{templateMode:'gtk'}),compact=compactStageContext(original);
  assert.deepEqual(expandStageContext(compact),original);
  assert.deepEqual(compact.data,original.data);assert.deepEqual(compact.templateContextRecords,original.templateContextRecords);
  return {stage,...sizes(original,compact),ruleCount:original.coverage.requiredRuleIds.length,fullRulesUnchanged:true,losslessRoundtrip:true};
 });
 assert.deepEqual(fullContext(snapshot),packet);
 const store=new SqliteStore(':memory:');
 try{
  const o=new OnepageOrchestrator({store,compile:async()=>packet,baselineCommit,artifacts:{get:(owner,id,h)=>store.getArtifact(owner,id,h),put:(owner,id,b,m)=>store.putArtifact(owner,id,b,m)}});
  const owner='synthetic:optimization';
  const job=await o.start(owner,{brand:packet.resolved.brand,brief:'Synthetic transport benchmark only.',sourceUrl:'https://'+({pawfecthouse:'pawfecthouse.com',giftsoul:'giftsoul.co',soulprise:'soulprise.co'} as Record<string,string>)[packet.resolved.brand]+'/collections/all',sourceType:'collection',idempotencyKey:'offline-optimization',capabilities:{artifactTransfer:true,imageInspection:false}});
  const first=await o.getStageContext(owner,job.jobId),before=store.read(owner,job.jobId);
  for(let i=0;i<5;i++)assert.deepEqual(await o.getStageContext(owner,job.jobId),first);
  assert.deepEqual(store.read(owner,job.jobId),before);
  const state=await o.state(owner,job.jobId);
  return {brand:packet.resolved.brand,snapshotHash:snapshot.hash,executionStepCount:packet.execution.length,stages,stateProjection:{...sizes(state,compactState(state)),comparison:'same current full state vs compact wire projection'},repeatContext:{calls:5,previousBehaviorAdditionalJobWrites:5,measuredAdditionalJobWrites:0,fullRulePayloadReturnedEveryCall:true},fullPacketPreserved:true};
 }finally{store.close();}
}
async function main(){
 const directory=process.argv[2];if(!directory)throw Error('Provide authorized snapshot directory.');
 const results=[];for(const brand of ['pawfecthouse','giftsoul','soulprise'])results.push(await benchmarkOptimization(JSON.parse(await readFile(resolve(directory,brand+'.json'),'utf8'))));
 console.log(JSON.stringify({schemaVersion:'uid-brands-v2.optimization-benchmark/1',measuredAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform},results,actualInputTokens:null,actualOutputTokens:null,reasoningTokens:null,cachedTokens:null,cost:null,creativeEO:'NOT_RUN',endToEndLatency:'NOT_MEASURED',limitations:['Wire bytes are not token usage or billing.','No creative outputs or blinded EO reviews were executed.','Avoided context calls require actual host retention; this benchmark never assumes it.','Repeated-context optimization avoids job/history writes; telemetry can still write.','State comparison uses the same current full response; live before/after is reported separately.']},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});

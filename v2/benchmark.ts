/** Offline packet benchmark. Reads authorized snapshots; emits only sizes/hashes, never private contents. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createSnapshot, fullContext, compactPacket, restorePacket, stageContext, type Packet } from './rules.ts';
import { CANONICAL_COMPILER_URL } from './compiler.ts';

export function benchmarkPacket(packet:Packet,baselineCommit:string) {
  const begin=performance.now();
  const snapshot=createSnapshot(packet,{sourceUrl:CANONICAL_COMPILER_URL,observedAt:new Date().toISOString(),baselineCommit,visibility:'public'});
  const full=JSON.stringify(packet),compact=compactPacket(packet),compressed=JSON.stringify(compact);
  if(!isDeepStrictEqual(restorePacket(compact),packet)||!isDeepStrictEqual(fullContext(snapshot),packet))throw new Error('LOSSLESS_ROUNDTRIP_FAILED');
  const measurements=['init','research','references','content','allocation','materials','qc','mapping','review','packaging'].map(stage=>{
    const bundle=stageContext(snapshot,stage,{templateMode:'gtk'}),serialized=JSON.stringify(bundle);
    return {stage,characters:serialized.length,bytes:Buffer.byteLength(serialized),bytesReductionPercent:100*(1-Buffer.byteLength(serialized)/Buffer.byteLength(full)),requiredRuleCount:bundle.coverage.requiredRuleIds.length,conflictCount:bundle.conflicts.length};
  });
  const faq=JSON.stringify(stageContext(snapshot,'mapping',{templateMode:'faq'}));
  return {brand:packet.resolved?.brand,snapshotHash:snapshot.hash,canonicalRevision:packet.creative_quality_contract?.revision,
    executionStepCount:packet.execution.length,hardGateCount:Object.keys(packet.hard_gates).length,manifestDefinitionCount:packet.assets.length,
    full:{characters:full.length,bytes:Buffer.byteLength(full)},compact:{characters:compressed.length,bytes:Buffer.byteLength(compressed),bytesReductionPercent:100*(1-Buffer.byteLength(compressed)/Buffer.byteLength(full)),aliases:Object.keys(compact.aliases).length},
    stageMeasurements:measurements,faqMapping:{characters:faq.length,bytes:Buffer.byteLength(faq)},roundtrip:true,
    elapsedMs:performance.now()-begin,
    measuredTokens:null,model:null,reasoningEffort:null,cost:null,completedOnepages:0,creativeEO:'NOT_RUN',
    limitations:['Payload sizes are not model usage or cost.','Universal canonical rules remain visible in every stage; conservative initial scoping.','Repeated bundles/fallbacks must be included in real workflow measurements.','No creative completion, pixel inspection or EO non-regression implied.']};
}
async function main(){
  const directory=process.argv[2];
  if(!directory)throw new Error('Usage: node --import tsx v2/benchmark.ts /absolute/path/to/authorized-snapshots [baseline-commit]');
  const baseline=process.argv[3]||'87bf39d1f38eb1d0baee159b921efbd7e3aaf923';
  const results=[];
  for(const brand of ['pawfecthouse','giftsoul','soulprise'])results.push(benchmarkPacket(JSON.parse(await readFile(resolve(directory,brand+'.json'),'utf8')),baseline));
  console.log(JSON.stringify({schemaVersion:'uid-brands-v2.payload-benchmark/1',environment:{node:process.version,platform:process.platform,architecture:process.arch},baselineCommit:baseline,results},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});

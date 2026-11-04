// Explicit opt-in: real read-only canonical calls through local MCP, no storefront actions.
import {createApp} from '../server.ts';
if(!process.argv.includes('--live'))throw new Error('Use --live to allow read-only current canonical network calls.');
const server=createApp().listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${(server.address() as any).port}`;
try{
 for(const [brand,store_url] of [['pawfecthouse','https://pawfecthouse.com'],['giftsoul','https://giftsoul.co'],['soulprise','https://soulprise.co']]){
  const response=await fetch(base+'/api/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:brand,method:'tools/call',params:{name:'compile_scale_brands_job',arguments:{brand,store_url}}})});
  const wire=await response.text();
  const packet=JSON.parse(wire.startsWith('{')?wire:wire.split('\n').find(line=>line.startsWith('data: '))!.slice(6));
  const result=packet.result?.structuredContent;
  console.log(JSON.stringify({brand,http_status:response.status,status:result?.status??'TRANSPORT_ERROR',store_identity:result?.store_identity,region_count:result?.regions?.length,canonical_snapshot:result?.canonical_snapshot,source_skill:result?.workflow?.source_skill}));
  if(result?.status!=='AWAITING_BASELINES')process.exitCode=1;
 }
}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}

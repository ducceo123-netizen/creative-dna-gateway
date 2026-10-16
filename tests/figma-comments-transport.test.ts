import {test} from 'node:test';
import assert from 'node:assert/strict';

test('real HTTP MCP isolates current session and never accepts a tool-argument identity',async()=>{
 const original=globalThis.fetch;
 const id='11111111-1111-4111-8111-111111111111';
 process.env.UID_FIGMA_READ_TOKEN='fixture-token';
 process.env.UID_FIGMA_AUTH_PUBLISHABLE_KEY='fixture-publishable';
 process.env.UID_FIGMA_FILE_ACCESS_JSON=JSON.stringify({[id]:['fileA']});
 const identities:string[]=[];
 globalThis.fetch=async(url,options)=>{
  const path=String(url), auth=new Headers(options?.headers).get('Authorization');
  if(path.endsWith('/auth/v1/user')) { identities.push(auth||''); return auth==='Bearer good.user.jwt'?Response.json({id,role:'authenticated',email_confirmed_at:'now'}):new Response('',{status:401}); }
  if(path.includes('/rest/v1/'))return Response.json([{user_id:id,role:'viewer',is_active:true}]);
  if(path.startsWith('https://api.figma.com/'))return Response.json({comments:[]});
  throw new Error('Unexpected destination');
 };
 const {createApp}=await import('../server.ts');
 const app=createApp().listen(0,'127.0.0.1');await new Promise<void>(r=>app.once('listening',r));
 const origin=`http://127.0.0.1:${(app.address() as any).port}`;
 let sequence=0;
 const call=async(auth?:string,args:Record<string,unknown>={file_key:'fileA'})=>{
  const response=await original(origin+'/api/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(auth?{Authorization:auth}:{})},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name:'read_ldp_figma_comments',arguments:args}})});
  assert.match(response.headers.get('cache-control')||'',/no-store/);
  const wire=await response.text();const packet=JSON.parse(wire.startsWith('{')?wire:wire.split('\n').find(l=>l.startsWith('data: '))!.slice(6));
  return packet.result;
 };
 try {
  assert.equal((await call('Bearer good.user.jwt')).structuredContent.status,'OK');
  assert.equal((await call()).structuredContent.status,'AUTHENTICATION_REQUIRED');
  const results=await Promise.all([call('Bearer good.user.jwt'),call('Bearer bad.user.jwt')]);
  assert.equal(results[0].structuredContent.status,'OK');assert.equal(results[1].structuredContent.status,'AUTHENTICATION_REQUIRED');
  assert.deepEqual(identities.sort(),['Bearer bad.user.jwt','Bearer good.user.jwt','Bearer good.user.jwt']);
  assert.equal((await call(undefined,{file_key:'fileA',token:'fixture-token'})).isError,true);
 }finally{globalThis.fetch=original;await new Promise<void>((r,j)=>app.close(e=>e?j(e):r()));delete process.env.UID_FIGMA_READ_TOKEN;delete process.env.UID_FIGMA_AUTH_PUBLISHABLE_KEY;delete process.env.UID_FIGMA_FILE_ACCESS_JSON;}
});

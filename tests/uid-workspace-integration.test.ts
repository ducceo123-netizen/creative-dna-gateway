import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceGateway as createApp } from '../uid-workspace-gateway.ts';
import { MemoryWorkspaceStore } from '../uid-workspace-store.ts';
async function server(options:any,run:(base:string)=>Promise<void>){const app=createApp({workspace:options});const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));try{await run(`http://127.0.0.1:${(server.address() as any).port}`)}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}}
test('workspace integration is closed by default while canonical MCP remains available',async()=>{
 await server({environment:'test'},async base=>{
  const config=await fetch(base+'/api/workspace/config');assert.equal(config.status,200);const c:any=await config.json();assert.equal(c.creation_supported,false);assert.equal(c.execution.ready,false);assert.equal(config.headers.get('access-control-allow-origin'),null);
  const privateResponse=await fetch(base+'/api/workspace/tasks');assert.equal(privateResponse.status,503);assert.match(privateResponse.headers.get('cache-control')!,/no-store/);
  const template=await fetch(base+'/api/onepage-ui-template/2026-10-11.v3/manifest.json');assert.equal(template.status,200);assert.equal(template.headers.get('access-control-allow-origin'),'*');
  const rpc=await fetch(base+'/api/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});assert.equal(rpc.status,200);assert.match(await rpc.text(),/get_onepage_ui_template/);
 });
});
test('workspace smaller body limit and CORS cannot fall through legacy public middleware',async()=>{
 await server({environment:'test',store:new MemoryWorkspaceStore(),verifyToken:async()=>({id:'user-1'}),verifyMembership:async()=>({active:true,role:'contributor'})},async base=>{
  const preflight=await fetch(base+'/api/workspace/tasks',{method:'OPTIONS',headers:{Origin:'https://untrusted.example','Access-Control-Request-Method':'POST'}});assert.equal(preflight.status,403);assert.equal(preflight.headers.get('access-control-allow-origin'),null);
  const large=await fetch(base+'/api/workspace/tasks',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer a.b.c'},body:JSON.stringify({data:'x'.repeat(70000)})});assert.equal(large.status,413);assert.equal((await large.json() as any).error.code,'REQUEST_TOO_LARGE');
 });
});


test('case-insensitive Express mounts retain private parser and CORS boundaries',async()=>{
 await server({environment:'test',store:new MemoryWorkspaceStore(),verifyToken:async()=>({id:'user-1'}),verifyMembership:async()=>({active:true,role:'contributor'})},async base=>{
  for(const prefix of ['/API/WORKSPACE','/Api/WorkSpace','/api/workspace']){
   const preflight=await fetch(base+prefix+'/tasks',{method:'OPTIONS',headers:{Origin:'https://untrusted.example','Access-Control-Request-Method':'POST'}});assert.equal(preflight.status,403,prefix);assert.equal(preflight.headers.get('access-control-allow-origin'),null);
   const body=JSON.stringify({idempotency_key:'test-key-123',brief:{brand:'PawfectHouse',material:'onepage',source_url:'https://example.com/product'}})+' '.repeat(70000);
   const response=await fetch(base+prefix+'/tasks',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer a.b.c'},body});assert.equal(response.status,413,prefix);assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
 });
});
test('workspace unknown routes terminate privately without changing unrelated legacy API routing',async()=>{
 await server({environment:'test'},async base=>{
  for(const route of ['/api/workspace/missing','/API/WORKSPACE/missing']){
   const response=await fetch(base+route);assert.equal(response.status,404);assert.equal(response.headers.get('access-control-allow-origin'),null);
   assert.equal((await response.json() as any).error.code,'WORKSPACE_ROUTE_NOT_FOUND');
  }
  const legacy=await fetch(base+'/api/workspace-unrelated');assert.equal(legacy.status,404);assert.equal(legacy.headers.get('access-control-allow-origin'),'*');
  assert.equal((await legacy.json() as any).error,'Not Found');
 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayJson, gatewayBudget, parseRetryAfter } from '../uid-gateway-upstream.ts';
import { loadLauncherData, submitTrainingFeedback, sanitizePublicError, createApp } from '../server.ts';

const url = 'https://example.test/upstream';
async function mockFetch(mock: typeof fetch, work: () => Promise<void>) {
  const original = globalThis.fetch; globalThis.fetch = mock;
  try { await work(); } finally { globalThis.fetch = original; }
}
test('deadline covers stalled headers and stalled body even when fetch ignores abort', async () => {
  for (const body of [false, true]) {
    let signal: AbortSignal | undefined;
    await mockFetch(async (_url, init) => {
      signal = init?.signal as AbortSignal;
      return body ? new Response(new ReadableStream({ start() {} })) : await new Promise<Response>(() => {});
    }, async () => {
      const started = Date.now();
      const result = await gatewayJson(url, {}, {operation: 'routes', timeoutMs: 30, readOnly: true});
      assert.equal(result.status, 504); assert.equal(result.data.code, 'UPSTREAM_TIMEOUT');
      assert.equal(result.data.recovery.action, 'retry_read'); assert.ok(signal?.aborted);
      assert.ok(Date.now() - started < 500); assert.match(result.data.request_id, /^[0-9a-f-]{36}$/);
    });
  }
});
test('malformed JSON and HTTP 200 error payloads cannot report success', async () => {
  for (const response of [new Response('{bad'), Response.json({error: 'secret token https://private.internal'})]) {
    await mockFetch(async () => response, async () => {
      const result = await gatewayJson(url, {}, {operation:'resolve', timeoutMs:100, readOnly:true,maxAttempts:1});
      assert.equal(result.ok,false); assert.equal(result.status,502);
      assert.doesNotMatch(JSON.stringify(result), /secret token|private.internal/);
    });
  }
});
test('Retry-After beyond total budget returns actionable 429 without a second request', async () => {
  let calls = 0;
  await mockFetch(async () => { calls++; return new Response('not JSON', {status:429,headers:{'Retry-After':'60'}}); }, async () => {
    const result = await gatewayJson(url, {}, {operation:'routes', timeoutMs:50, readOnly:true});
    assert.equal(result.status,429); assert.equal(result.data.recovery.retry_after_ms,60_000); assert.equal(calls,1);
  });
  assert.equal(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT', Date.parse('Wed, 21 Oct 2015 07:27:59 GMT')),1000);
});
test('transient reads retry at most twice with one correlation ID; expired budget sends nothing', async () => {
  const ids: string[] = [];
  await mockFetch(async (_url,init) => { ids.push(new Headers(init?.headers).get('X-Request-ID')!); return Response.json({error:'down'},{status:503,headers:{'Retry-After':'0'}}); },async () => {
    const result=await gatewayJson(url,{}, {operation:'routes',timeoutMs:300,readOnly:true,maxAttempts:9});
    assert.equal(result.status,503); assert.equal(ids.length,2);assert.equal(ids[0],ids[1]); assert.equal(result.data.request_id,ids[0]);
    const expired=await gatewayJson(url,{}, {operation:'routes',timeoutMs:300,readOnly:true,budget:gatewayBudget(-1)});
    assert.equal(expired.status,504);assert.equal(ids.length,2);
  });
});
test('Train transport timeout never retries and marks outcome unknown',async()=>{
  let calls=0;
  await mockFetch(async()=>{calls++;return new Response(new ReadableStream({start(){}}));},async()=>{
    const result=await gatewayJson(url,{method:'POST'}, {operation:'train',timeoutMs:25,maxAttempts:2});
    assert.equal(calls,1);assert.equal(result.data.recovery.outcome,'unknown');assert.equal(result.data.recovery.retryable,false);
    assert.equal(result.data.recovery.action,'verify_before_retry');
  });
});
test('actual Train gateway never resends after connection loss or HTTP 503',async()=>{
  for(const fail of [true,false]) {
    let calls=0;
    await mockFetch(async()=>{calls++;if(fail)throw new Error('connection lost');return Response.json({error:'bad'},{status:503});},async()=>{
      const result=await submitTrainingFeedback('PawfectHouse','LDP','Improve product hierarchy','Exact Member');
      assert.equal(calls,1);assert.equal(result.ok,false);assert.equal(result.data.recovery.outcome,'unknown');
    });
  }
});
test('launcher does not fetch unused guides; failed routes do not appear ready',async()=>{
  let guideCalls=0;
  for(const routesOk of [true,false]) {
    await mockFetch(async(url)=>String(url).includes('branch_visual_guides') ? (guideCalls++, await new Promise<Response>(()=>{})) : Response.json(routesOk?{routes:[{brand:'PawfectHouse',branch:'LDP'}]}:{error:'down'},{status:routesOk?200:503,headers:{'Retry-After':'0'}}),async()=>{
      const start=Date.now(); const result=await loadLauncherData();
      assert.ok(Date.now()-start<500);assert.equal(guideCalls,0);assert.equal(result.ok,routesOk);assert.deepEqual(result.data.guides,[]);
      if(!routesOk){assert.deepEqual(result.data.routes,[]);assert.equal(result.data.code,'UPSTREAM_HTTP_ERROR');}
    });
  }
});
test('malformed route shape fails while unavailable optional guides cannot affect valid routes',async()=>{
  await mockFetch(async(url)=>String(url).includes('branch_visual_guides')?Response.json({error:'down'},{status:503}):Response.json({}),async()=>{
    const result=await loadLauncherData();assert.equal(result.ok,false);assert.equal(result.data.code,'UPSTREAM_INVALID_RESPONSE');
  });
  await mockFetch(async(url)=>String(url).includes('branch_visual_guides')?Response.json({error:'down'},{status:503}):Response.json({routes:[]}),async()=>{
    const result=await loadLauncherData();assert.equal(result.ok,true);assert.deepEqual(result.data.guides,[]);
  });
});
test('oversized preview failure is actionable without disclosing raw exceptions',()=>{
  assert.match(sanitizePublicError(new Error('Oversized object')),/size limit/);
  assert.doesNotMatch(sanitizePublicError(new Error('secret')),/secret/);
});

test('HTTP and MCP expose safe recovery details instead of claiming launcher readiness',async()=>{
  const app=createApp().listen(0,'127.0.0.1'); await new Promise<void>(r=>app.once('listening',r));
  const original=globalThis.fetch;
  const origin=`http://127.0.0.1:${(app.address() as any).port}`;
  try {
    globalThis.fetch=async()=>Response.json({error:'secret upstream detail'},{status:503,headers:{'Retry-After':'0'}});
    const routes=await original(origin+'/api/routes');const payload=await routes.json();
    assert.equal(routes.status,503);assert.equal(payload.recovery.action,'retry_read');assert.ok(payload.request_id);
    const mcp=await original(origin+'/api/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'launch_creative_dna',arguments:{navigation_id:'navigation-test'}}})});
    const wire=await mcp.text(); assert.match(wire,/"isError":true/);assert.match(wire,/navigation-test/);assert.match(wire,/retry_read/);assert.doesNotMatch(wire,/launcher ready|secret upstream/);
  } finally { globalThis.fetch=original;await new Promise<void>((r,j)=>app.close(e=>e?j(e):r())); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createApp } from '../server.ts';
test('preview response isolates direct navigation and keeps only nonce-authorized sizing script', async () => {
  const originalFetch=globalThis.fetch;
  const calls:any[]=[];
  const app=createApp();const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+(server.address() as any).port;
  try {
    globalThis.fetch=(async(url,init)=>{calls.push({url:String(url),init});return new Response('<html><head></head><body><section id="hero">Visible section<img src="x" onerror="steal()"><script>steal()</script><iframe srcdoc="bad"></iframe></section></body></html>');}) as typeof fetch;
    const response=await originalFetch(base+'/api/branch-preview?url='+encodeURIComponent('https://example.myshopify.com/page')+'&selector=%23hero');
    assert.equal(response.status,200);
    const csp=response.headers.get('Content-Security-Policy')!, html=await response.text();
    assert.match(csp,/sandbox allow-scripts;/);assert.ok(!csp.includes('allow-same-origin'));assert.match(csp,/frame-src 'none'/);assert.match(csp,/connect-src 'none'/);
    const nonce=/script-src 'nonce-([a-f0-9]+)'/.exec(csp)?.[1];assert.ok(nonce);assert.ok(html.includes('<script nonce="'+nonce+'">'));assert.ok(!html.includes('<script>steal()'));
    assert.ok(html.includes('Visible section'));assert.ok(html.includes('uid-branch-preview-height'));
    assert.equal(calls[0].init.redirect,'error');assert.ok(calls[0].init.signal);
    assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
    const bad=await originalFetch(base+'/api/branch-preview?url='+encodeURIComponent('https://user:password@example.myshopify.com:444/page')+'&selector=%23hero');assert.equal(bad.status,400);assert.equal(calls.length,1);
  } finally {globalThis.fetch=originalFetch;await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('temporarily removed Live Preview has no iframe, sizing listener or guide fetch on dashboard', () => {
  const source=readFileSync('src/App.tsx','utf8');
  assert.doesNotMatch(source, /<iframe|uid-branch-preview-height|api\/branch-preview|api\/branch-guides/);
  assert.match(source,/Output chính/);assert.match(source,/Input thường cần/);
});

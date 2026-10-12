import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { museOpenApi, museBootstrap, registerMuseRoutes } from '../uid-muse.ts';
import { createApp, CANONICAL_PRODUCTION_ORIGIN } from '../server.ts';
import { getOnepageUiTemplate } from '../onepage-ui-template.ts';

async function start(app: express.Application) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  return { origin: `http://127.0.0.1:${(server.address() as any).port}`, close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())) };
}

test('Muse schema advertises exactly four reads, no credentials, writes, launcher, or MCP promises', () => {
  const schema = museOpenApi('https://gateway.example');
  assert.equal(schema.openapi, '3.1.0');
  assert.deepEqual(schema.security, []);
  assert.deepEqual(schema.servers, [{ url: 'https://gateway.example' }]);
  assert.deepEqual(Object.keys(schema.paths), ['/api/muse/routes', '/api/muse/resolve', '/api/muse/compile', '/api/muse/template']);
  for (const path of Object.values(schema.paths)) {
    assert.deepEqual(Object.keys(path), ['get']);
    assert.equal(path.get['x-read-only'], true);
    assert.ok(path.get.responses[429].headers['Retry-After']);
  }
  assert.doesNotMatch(JSON.stringify(schema), /submit_training|\/api\/mcp|window\.openai|supabase|service.role|api.key/i);
  assert.match(schema.info.description, /has not been verified/);
});

test('bootstrap contains complete browser test, source provenance and honest compatibility limits', () => {
  const html = museBootstrap('https://gateway.example');
  for (const route of ['/api/muse/routes', '/api/muse/resolve?', '/api/muse/compile?', '/api/muse/template', '/api/muse/openapi.json']) assert.ok(html.includes(route));
  assert.match(html, /BLOCKED/);
  assert.match(html, /revision\/hash/);
  assert.match(html, /Chưa xác minh/);
  assert.doesNotMatch(html, /<script/);
  assert.ok(museBootstrap('https://example.test/?x="<unsafe>').includes('&quot;&lt;unsafe&gt;'));
});

test('GET adapter preserves canonical results and blocking gates, validates input, and never dispatches writes', async () => {
  const app = express();
  const calls: any[] = [];
  const packet = { resolved: { brand: 'pawfecthouse', branch: 'onepage-system' }, creative_quality_contract: { status: 'BLOCKED', revision: 'r1', contract_hash: 'abc' }, quality_execution_guard: { status: 'BLOCKED', reason: 'REQUIRED_REFERENCE_UNAVAILABLE' }, template_policy_compatibility: { status: 'BLOCKED_QUALITY_CONTRACT' } };
  let failing = false;
  registerMuseRoutes(app, {
    origin: 'https://gateway.example',
    routes: async () => { calls.push(['routes']); return { status: 200, ok: true, data: { routes: [{ brand: 'pawfecthouse', branch: 'onepage-system', title: 'Onepage', private_id: 'hidden' }], internal: 'hidden' } }; },
    sanitizeRoutes: data => ({ routes: data.routes.map(({ brand, branch, title }: any) => ({ brand, branch, title })) }),
    resolve: async (...args) => { calls.push(['resolve', ...args]); return { status: failing ? 404 : 200, ok: !failing, data: failing ? { error: 'secret https://private.example/path' } : packet }; },
    compile: async (...args) => { calls.push(['compile', ...args]); if (failing) throw new Error('secret https://private.example/path'); return { status: 200, ok: true, data: packet }; },
  });
  const server = await start(app);
  const get = (path: string, init?: RequestInit) => fetch(`${server.origin}${path}`, init);
  try {
    const routes = await get('/api/muse/routes');
    assert.deepEqual(await routes.json(), { mode: 'canonical_read_only', routes: [{ brand: 'pawfecthouse', branch: 'onepage-system', title: 'Onepage' }] });
    const resolve = await get('/api/muse/resolve?brand=%20PawfectHouse%20&branch=Onepage');
    assert.equal(resolve.status, 200);
    assert.deepEqual(await resolve.json(), packet);
    const compile = await get('/api/muse/compile?brand=PawfectHouse&source_url=https%3A%2F%2Fexample.com%2Fp&source_type=product&theme=Christmas');
    assert.equal(compile.headers.get('cache-control'), 'no-store');
    assert.equal(compile.headers.get('referrer-policy'), 'no-referrer');
    assert.deepEqual(await compile.json(), packet);
    assert.deepEqual(calls, [['routes'], ['resolve', 'PawfectHouse', 'Onepage'], ['compile', 'PawfectHouse', 'https://example.com/p', 'product', 'Christmas']]);
    const template = await get('/api/muse/template');
    assert.deepEqual(await template.json(), getOnepageUiTemplate());
    assert.equal((await get('/api/muse/template?version=missing')).status, 404);
    for (const path of [
      '/api/muse/routes?action=write', '/api/muse/resolve?brand=PawfectHouse',
      '/api/muse/resolve?brand=A&brand=B&branch=Onepage', '/api/muse/resolve?brand[x]=PawfectHouse&branch=Onepage',
      `/api/muse/resolve?brand=${'a'.repeat(101)}&branch=Onepage`,
      '/api/muse/compile?brand=PawfectHouse&source_type=invalid', '/api/muse/compile?brand=PawfectHouse&action=submit_training_feedback',
      '/api/muse/compile?brand=PawfectHouse&source_url=not-a-url',
      '/api/muse/compile?brand=PawfectHouse&source_url=http%3A%2F%2Fexample.com',
      '/api/muse/compile?brand=PawfectHouse&source_url=https%3A%2F%2Fuser%3Apassword%40example.com',
      '/api/muse/template?format=source',
    ]) assert.equal((await get(path)).status, 400, path);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const denied = await get('/api/muse/compile?brand=PawfectHouse', { method });
      assert.equal(denied.status, 405);
      assert.match(denied.headers.get('allow')!, /GET/);
    }
    assert.equal(calls.length, 3, 'invalid inputs and mutation methods cannot call the canonical service');
    failing = true;
    const missing = await get('/api/muse/resolve?brand=PawfectHouse&branch=unknown');
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Unable to resolve Creative DNA' });
    const failure = await get('/api/muse/compile?brand=PawfectHouse');
    assert.equal(failure.status, 502);
    assert.deepEqual(await failure.json(), { error: 'Unable to compile Onepage job' });
  } finally { await server.close(); }
});

test('real application mounts Muse behind existing security/rate limits without altering ChatGPT discovery', async () => {
  const server = await start(createApp());
  try {
    const bootstrap = await fetch(`${server.origin}/muse`);
    assert.equal(bootstrap.status, 200);
    assert.match(bootstrap.headers.get('content-type')!, /text\/html/);
    assert.match(bootstrap.headers.get('content-security-policy')!, /default-src 'none'/);
    const schemaResponse = await fetch(`${server.origin}/api/muse/openapi.json`);
    assert.equal(schemaResponse.headers.get('ratelimit-limit'), '120');
    assert.equal(schemaResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(await schemaResponse.json(), museOpenApi(CANONICAL_PRODUCTION_ORIGIN));
    assert.equal((await fetch(`${server.origin}/api/muse/admin`)).status, 404);
    const discovery: any = await (await fetch(`${server.origin}/api/tools`)).json();
    assert.ok(discovery.tools.some((tool: any) => tool.name === 'launch_creative_dna'));
    assert.ok(discovery.tools.some((tool: any) => tool.name === 'submit_training_feedback'));
    assert.equal(discovery.mcpEndpoint, `${CANONICAL_PRODUCTION_ORIGIN}/api/mcp`);
  } finally { await server.close(); }
});

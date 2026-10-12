import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createApp } from '../server.ts';

// Exercise the actual edge-function preflight with synthetic auth/role results.
// No real session, database, credentials, or canonical mutations are used.
const edgeCode = transformSync(readFileSync('supabase/functions/creative-dna-admin-feedback/index.ts', 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default', 'const handler =') + '\nglobalThis.handler = handler;', { loader: 'ts' }).code;
for (const scenario of [
  { name: 'anonymous', user: null, member: null, status: 401 },
  { name: 'nonadmin member', user: { id: 'synthetic-member' }, member: { role: 'member', is_active: true }, status: 403 },
  { name: 'inactive admin', user: { id: 'synthetic-admin' }, member: { role: 'admin', is_active: false }, status: 403 },
]) {
  test(`admin feedback edge preflight blocks ${scenario.name} before protected data access`, async () => {
    const tables: string[] = [];
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: scenario.member }) };
    const context: any = { Response, Deno: { env: { get: () => 'synthetic' } }, createClient: () => ({
      auth: { getUser: async () => ({ data: { user: scenario.user } }) },
      from: (table: string) => { tables.push(table); assert.equal(table, 'creative_dna_team_members'); return chain; },
    }) };
    vm.runInNewContext(edgeCode, context);
    for (const mode of ['list', 'governance_list', 'review_preflight', 'resolve_covered', 'governance_evaluate']) {
      const response = await context.handler.fetch(new Request('https://example.test/admin', { method: 'POST', body: JSON.stringify({ mode }) }));
      assert.equal(response.status, scenario.status);
    }
    assert.ok(tables.every(table => table === 'creative_dna_team_members'));
  });
}

test('configured admin proxy forwards caller JWT and preserves upstream role denial and readable queue', async () => {
  const originalUrl = process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;
  process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL = 'https://synthetic-admin.example.test/feedback';
  const realFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  const app = createApp();
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as any).port;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(String(url), 'https://synthetic-admin.example.test/feedback');
    const authorization = new Headers(init?.headers).get('Authorization');
    if (authorization === 'Bearer synthetic.nonadmin') return Response.json({ error: 'Admin required' }, { status: 403 });
    assert.equal(authorization, 'Bearer synthetic.admin');
    return Response.json({ proposals: [{ id: 'synthetic-pending', status: 'pending', submitted_by_name: 'Test Member' }] });
  };
  try {
    assert.equal((await realFetch(base + '/api/admin/feedback')).status, 401);
    assert.equal((await realFetch(base + '/api/admin/governance/governance_list', { method: 'POST' })).status, 401);
    assert.equal(calls.length, 0);
    for (const [path, init] of [
      ['/api/admin/feedback', {}],
      ['/api/admin/governance/governance_list', { method: 'POST' }],
    ] as const) {
      const response = await realFetch(base + path, { ...init, headers: { Authorization: 'Bearer synthetic.nonadmin' } });
      assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'Admin required' });
    }
    const response = await realFetch(base + '/api/admin/feedback', { headers: { Authorization: 'Bearer synthetic.admin' } });
    assert.equal(response.status, 200); assert.equal((await response.json()).proposals[0].id, 'synthetic-pending');
    assert.deepEqual(calls.map(call => JSON.parse(String(call.init?.body)).mode), ['list', 'governance_list', 'list']);
  } finally {
    globalThis.fetch = realFetch;
    if (originalUrl === undefined) delete process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL; else process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL = originalUrl;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

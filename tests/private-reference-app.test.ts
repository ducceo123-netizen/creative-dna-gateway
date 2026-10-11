import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.ts';


test('real createApp exposes private routes, bounds raw payloads and preserves public discovery', async () => {
  const realFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  let app;
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response('{}', { status: 403 }); };
    app = createApp();
  } finally { globalThis.fetch = realFetch; }
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as any).port;
  const reference = { id: 'reference.test', mime_type: 'image/webp', byte_length: 3 };
  try {
    assert.equal((await realFetch(base + '/api/member/creative-references/' + reference.id)).status, 401);
    const privateResponse = await realFetch(base + '/api/admin/creative-references/' + reference.id, { method: 'POST', headers: { Authorization: 'Bearer test.user.jwt', 'Content-Type': reference.mime_type }, body: new Uint8Array(reference.byte_length) });
    assert.equal(privateResponse.status, 403); assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/wuonwttmkadwsmefjukv\.supabase\.co\/functions\/v1\/creative-dna-reference-ingest\?reference_id=/);
    assert.equal(calls[0].init?.method, 'POST');
    const large = await realFetch(base + '/api/admin/creative-references/' + reference.id, { method: 'POST', headers: { Authorization: 'Bearer test.user.jwt', 'Content-Type': reference.mime_type }, body: new Uint8Array(262145) });
    assert.equal(large.status, 413); assert.deepEqual(await large.json(), { error: 'INVALID_REFERENCE_PAYLOAD' });
    assert.equal(calls.length, 1);
    const discovery = await realFetch(base + '/.well-known/ai-plugin.json');
    assert.equal(discovery.status, 200); assert.equal((await discovery.json()).auth.type, 'none');
    const tools = await realFetch(base + '/api/tools'); assert.equal(tools.status, 200);
    const text = await tools.text(); assert.ok(!text.includes('creative-dna-references')); assert.ok(!text.includes('creative-dna-reference-ingest'));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

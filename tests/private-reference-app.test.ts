import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.ts';
import { png } from './fixtures/reference-synthetic.ts';
import { encodeLibraryNotes, sanitizeLibraryNotes, MAX_LIBRARY_IMAGE_BYTES } from '../supabase/functions/_shared/reference-library-contract.ts';


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
  const reference = { id: '12345678-1234-4234-8234-123456789abc', mime_type: 'image/png', byte_length: png.length };
  try {
    assert.equal((await realFetch(base + '/api/member/creative-references/' + reference.id)).status, 401);
    const privateResponse = await realFetch(base + '/api/admin/creative-references/' + reference.id, { method: 'POST', headers: { Authorization: 'Bearer test.user.jwt', 'Content-Type': reference.mime_type, 'X-Reference-Metadata': encodeLibraryNotes(sanitizeLibraryNotes({filename:'test.png'})) }, body: png });
    assert.equal(privateResponse.status, 403); assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/wuonwttmkadwsmefjukv\.supabase\.co\/functions\/v1\/creative-dna-reference-ingest\?reference_id=/);
    assert.equal(calls[0].init?.method, 'POST');
    const large = await realFetch(base + '/api/admin/creative-references/' + reference.id, { method: 'POST', headers: { Authorization: 'Bearer test.user.jwt', 'Content-Type': reference.mime_type, 'X-Reference-Metadata': encodeLibraryNotes(sanitizeLibraryNotes({filename:'test.png'})) }, body: new Uint8Array(MAX_LIBRARY_IMAGE_BYTES + 1) });
    assert.equal(large.status, 413); assert.deepEqual(await large.json(), { error: 'INVALID_REFERENCE_PAYLOAD' });
    assert.equal(calls.length, 1);
    const discovery = await realFetch(base + '/.well-known/ai-plugin.json');
    assert.equal(discovery.status, 200); assert.equal((await discovery.json()).auth.type, 'none');
    const tools = await realFetch(base + '/api/tools'); assert.equal(tools.status, 200);
    const text = await tools.text(); assert.ok(!text.includes('creative-dna-references')); assert.ok(!text.includes('creative-dna-reference-ingest'));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

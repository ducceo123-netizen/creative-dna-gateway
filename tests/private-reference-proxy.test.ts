import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { registerPrivateReferenceRoutes } from '../uid-private-reference-proxy.ts';
import { digestReference } from '../supabase/functions/_shared/private-reference-access.ts';
import { APPROVED_PRIVATE_REFERENCES, type PrivateReference } from '../supabase/functions/_shared/private-reference-catalog.ts';
import { parsePrivateReferenceManifest } from '../uid-private-reference-manifest.ts';
import { readFileSync } from 'node:fs';
import { png } from './fixtures/reference-synthetic.ts';
import { encodeLibraryNotes, sanitizeLibraryNotes } from '../supabase/functions/_shared/reference-library-contract.ts';
const referenceId = '12345678-1234-4234-8234-123456789abc';
const metadata = encodeLibraryNotes(sanitizeLibraryNotes({ filename: 'test.png' }));

async function fixture(status = 200, responseBytes = png) {
  const bytes = png;
  const reference: PrivateReference = { id: referenceId, filename: 'test.webp', mime_type: 'image/png', byte_length: png.length, object_path: 'fixed.webp', width: 1, height: 1, sha256: await digestReference(bytes), source_sha256: await digestReference(bytes), source_library_id: 'test' };
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    if (status !== 200) return new Response('UPSTREAM_SECRET_ERROR', { status, headers: { Location: 'https://evil.test/secret' } });
    if (init?.method === 'POST' && (init.body as Uint8Array).byteLength !== png.length) return new Response('{}', { status: 400 });
    if (init?.method === 'POST') return Response.json({ status: 'STORED_AND_VERIFIED', reference_id: reference.id, unexpected_secret: 'hidden' }, { status: 201 });
    return new Response(responseBytes as BodyInit, { headers: { 'Content-Type': 'image/png', 'X-Content-SHA256': reference.sha256 } });
  };
  const app = express(); app.use(express.json()); registerPrivateReferenceRoutes(app, fetcher as typeof fetch);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as any).port;
  return { base, calls, bytes, reference, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
test('proxy denies missing authorization, unknown reference and arbitrary queries before network', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.base + '/api/member/creative-references/12345678-1234-4234-8234-123456789abc')).status, 401);
    assert.equal((await fetch(f.base + '/api/member/creative-references/!bad', { headers: { Authorization: 'Bearer valid.user.jwt' } })).status, 404);
    assert.equal((await fetch(f.base + '/api/member/creative-references/12345678-1234-4234-8234-123456789abc?url=https://evil.test', { headers: { Authorization: 'Bearer valid.user.jwt' } })).status, 404);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
test('proxy relays only member bearer to fixed origin and independently validates exact image', async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.base + '/api/member/creative-references/12345678-1234-4234-8234-123456789abc', { headers: { Authorization: 'Bearer valid.user.jwt', 'X-User-Id': 'forged', Cookie: 'ignored' } });
    assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.bytes);
    assert.equal(f.calls[0].url, 'https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/creative-dna-references?reference_id=12345678-1234-4234-8234-123456789abc');
    assert.deepEqual(f.calls[0].init.headers, { Authorization: 'Bearer valid.user.jwt' }); assert.equal(f.calls[0].init.redirect, 'error');
    assert.match(response.headers.get('Cache-Control') || '', /no-store/); assert.equal(response.headers.get('Location'), null);
  } finally { await f.close(); }
});
test('proxy bounds response bytes and rejects a lying SHA header', async () => {
  for (const bytes of [new Uint8Array([3, 2, 1]), new Uint8Array([1, 2, 3, 4])]) {
    const f = await fixture(200, bytes);
    try { assert.equal((await fetch(f.base + '/api/member/creative-references/12345678-1234-4234-8234-123456789abc', { headers: { Authorization: 'Bearer valid.user.jwt' } })).status, 503); }
    finally { await f.close(); }
  }
});
test('proxy preserves access denial without relaying upstream error details or redirects', async () => {
  for (const status of [401, 403, 404, 503, 302]) {
    const f = await fixture(status);
    try {
      const response = await fetch(f.base + '/api/member/creative-references/12345678-1234-4234-8234-123456789abc', { headers: { Authorization: 'Bearer valid.user.jwt' } });
      assert.equal(response.status, status === 302 ? 502 : status); assert.equal(response.headers.get('Location'), null); assert.ok(!(await response.text()).includes('UPSTREAM_SECRET_ERROR'));
    } finally { await f.close(); }
  }
});
test('raw image ingestion coexists with JSON parser and returns only bounded receipt', async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.base + '/api/admin/creative-references/12345678-1234-4234-8234-123456789abc', { method: 'POST', headers: { Authorization: 'Bearer valid.user.jwt', 'Content-Type': 'image/png', 'X-Reference-Metadata': metadata }, body: f.bytes });
    assert.equal(response.status, 201); assert.deepEqual(await response.json(), { status: 'STORED_AND_VERIFIED', reference_id: referenceId });
    assert.equal(f.calls[0].init.method, 'POST'); assert.match(f.calls[0].url, /creative-dna-reference-ingest\?reference_id=12345678-1234-4234-8234-123456789abc$/);
    assert.equal((await fetch(f.base + '/api/admin/creative-references/12345678-1234-4234-8234-123456789abc', { method: 'POST', headers: { Authorization: 'Bearer valid.user.jwt', 'Content-Type': 'image/png', 'X-Reference-Metadata': metadata }, body: new Uint8Array([1]) })).status, 400);
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test('UI uses authenticated flexible library, bounded image staging and revocable previews', () => {
  assert.deepEqual(APPROVED_PRIVATE_REFERENCES, []);
  const panel = readFileSync('src/components/PrivateReferencePanel.tsx', 'utf8');
  assert.ok(panel.includes("request('/api/member/creative-references'"));
  assert.ok(panel.includes("request('/api/member/creative-references/")); assert.ok(panel.includes("request('/api/admin/creative-references/"));
  assert.ok(!/sessionStorage|localStorage|serviceKey|signedUrl|storage\/v1|data:image/.test(panel));
  assert.ok(panel.indexOf('inspectLibraryImage(new Uint8Array(bytes), file.type)') < panel.indexOf("request('/api/admin/creative-references/"));
  assert.ok(panel.includes('createImageBitmap')); assert.ok(panel.includes('URL.revokeObjectURL')); assert.ok(panel.includes('running.current'));
  assert.ok(!panel.includes('references.find(r => r.filename === file.name)'));
  assert.ok(panel.includes('Reference Library')); assert.ok(panel.includes('case_title')); assert.ok(panel.includes('why_good'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateReferenceIngestHandler, type PrivateIngestDeps } from '../supabase/functions/_shared/private-reference-ingest.ts';
import { digestReference, type ReferenceAudit } from '../supabase/functions/_shared/private-reference-access.ts';
import { privateReferenceUploader } from '../supabase/functions/_shared/private-reference-runtime.ts';
import type { PrivateReference } from '../supabase/functions/_shared/private-reference-catalog.ts';

const userId = '00000000-0000-4000-8000-000000000001';
const user = { id: userId, role: 'authenticated', is_anonymous: false, email_confirmed_at: '2026-10-01T00:00:00Z' };
async function fixture(overrides: Partial<PrivateIngestDeps> = {}) {
  const bytes = new Uint8Array([1, 2, 3]);
  const reference: PrivateReference = { id: 'reference.test', filename: 'test.webp', mime_type: 'image/webp', byte_length: bytes.length,
    object_path: 'approved-seven/fixed.webp', width: 1, height: 1, sha256: await digestReference(bytes), source_sha256: await digestReference(bytes), source_library_id: 'test' };
  const events: ReferenceAudit[] = []; const calls: string[] = []; let stored: Uint8Array | null = null;
  const deps: PrivateIngestDeps = {
    verifyUser: async () => { calls.push('auth'); return user; },
    findMembership: async () => { calls.push('member'); return { user_id: userId, role: 'admin', is_active: true }; },
    bucketIsPrivate: async () => { calls.push('private'); return true; },
    download: async () => { calls.push('download'); return stored; },
    upload: async (_reference, data) => { calls.push('upload'); stored = data; return true; },
    audit: event => { events.push(event); }, ...overrides,
  };
  const handler = createPrivateReferenceIngestHandler(deps, [reference]);
  const request = (body = bytes, auth: string | null = 'Bearer valid.user.jwt', query = '?reference_id=reference.test', mime = 'image/webp', method = 'POST') => handler(new Request('https://example.com/ingest' + query, { method, headers: { ...(auth ? { Authorization: auth } : {}), 'Content-Type': mime }, body: method === 'POST' ? body as BodyInit : undefined }));
  return { request, calls, events, bytes, reference };
}
test('ingestion rejects absent/invalid auth without reading storage', async () => {
  for (const auth of [null, 'Bearer sb_publishable_key', 'Bearer invalid']) {
    const f = await fixture(); assert.equal((await f.request(f.bytes, auth)).status, 401); assert.deepEqual(f.calls, []);
  }
});
test('ingestion denies nonmember, viewer, contributor and inactive admin before storage writes', async () => {
  for (const member of [null, { user_id: userId, role: 'viewer', is_active: true }, { user_id: userId, role: 'contributor', is_active: true }, { user_id: userId, role: 'admin', is_active: false }]) {
    const f = await fixture({ findMembership: async () => member });
    assert.equal((await f.request()).status, 403); assert.ok(!f.calls.includes('private')); assert.ok(!f.calls.includes('upload'));
  }
});
test('ingestion rejects any unapproved ID, query, MIME, length or byte hash', async () => {
  const f = await fixture();
  assert.equal((await f.request(f.bytes, 'Bearer valid.user.jwt', '?reference_id=other')).status, 404);
  assert.equal((await f.request(f.bytes, 'Bearer valid.user.jwt', '?reference_id=reference.test&url=https://evil.test')).status, 400);
  assert.equal((await f.request(f.bytes, 'Bearer valid.user.jwt', '?reference_id=reference.test', 'image/svg+xml')).status, 415);
  assert.equal((await f.request(new Uint8Array([3, 2, 1]))).status, 400);
  assert.equal((await f.request(new Uint8Array([1, 2, 3, 4]))).status, 400);
  assert.equal((await f.request(new Uint8Array([1, 2]))).status, 400);
  assert.equal((await f.request(f.bytes, 'Bearer valid.user.jwt', '?reference_id=reference.test', 'image/webp', 'GET')).status, 405);
  assert.ok(!f.calls.includes('upload'));
});
test('active admin uploads exact hash once then verifies stored bytes; repeat is idempotent', async () => {
  const f = await fixture(); const response = await f.request();
  assert.equal(response.status, 201); assert.equal((await response.json()).status, 'STORED_AND_VERIFIED');
  const repeat = await f.request(); assert.equal(repeat.status, 200); assert.equal((await repeat.json()).status, 'ALREADY_STORED');
  assert.equal(f.calls.filter(c => c === 'upload').length, 1);
  assert.deepEqual(f.calls.slice(0, 6), ['auth', 'member', 'private', 'download', 'upload', 'download']);
  assert.ok(!JSON.stringify(f.events).includes('valid.user.jwt'));
});
test('public bucket, immutable-object mismatch and unverified write never claim successful ingestion', async () => {
  let f = await fixture({ bucketIsPrivate: async () => false });
  assert.equal((await f.request()).status, 503); assert.ok(!f.calls.includes('upload'));
  f = await fixture({ download: async () => new Uint8Array([3, 2, 1]) });
  assert.equal((await f.request()).status, 409); assert.ok(!f.calls.includes('upload'));
  f = await fixture({ upload: async () => true });
  const response = await f.request(); assert.equal(response.status, 503); assert.equal((await response.json()).status, 'STORAGE_WRITE_NOT_VERIFIED');
});
test('uncertain write is checked once without replaying or leaking upstream errors', async () => {
  let reads = 0, uploads = 0;
  const f = await fixture({ download: async () => ++reads === 1 ? null : new Uint8Array([1, 2, 3]), upload: async () => { uploads++; throw new Error('secret'); } });
  const response = await f.request(); assert.equal(response.status, 200); assert.equal(uploads, 1); assert.equal(reads, 2);
  assert.equal((await response.json()).status, 'STORED_AND_VERIFIED_AFTER_RECHECK');
});
test('uploader uses fixed bucket/path, no overwrite and modern key headers', async () => {
  let seenUrl = '', seenInit: RequestInit = {};
  const fetcher = async (url: any, init?: RequestInit) => { seenUrl = String(url); seenInit = init || {}; return new Response('{}', { status: 200 }); };
  const upload = privateReferenceUploader({ supabaseUrl: 'https://wuonwttmkadwsmefjukv.supabase.co', publishableKey: 'sb_publishable_key', serviceKey: 'sb_secret_key' }, fetcher as typeof fetch);
  const f = await fixture(); assert.equal(await upload(f.reference, f.bytes), true);
  assert.equal(seenUrl, 'https://wuonwttmkadwsmefjukv.supabase.co/storage/v1/object/creative-dna-references/approved-seven/fixed.webp');
  assert.equal(seenInit.method, 'POST'); assert.equal(seenInit.redirect, 'error');
  const headers = seenInit.headers as Record<string, string>; assert.equal(headers['x-upsert'], 'false'); assert.equal(headers.Authorization, undefined); assert.equal(headers.apikey, 'sb_secret_key');
});

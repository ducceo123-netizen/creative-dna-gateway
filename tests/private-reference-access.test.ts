import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateReferenceHandler, digestReference, type PrivateReferenceDeps, type ReferenceAudit } from '../supabase/functions/_shared/private-reference-access.ts';
import { privateReferenceRuntime } from '../supabase/functions/_shared/private-reference-runtime.ts';
import { APPROVED_PRIVATE_REFERENCES, PRIVATE_REFERENCE_BUCKET, type PrivateReference } from '../supabase/functions/_shared/private-reference-catalog.ts';
import { readFileSync } from 'node:fs';

const userId = '00000000-0000-4000-8000-000000000001';
const user = { id: userId, role: 'authenticated', is_anonymous: false, email_confirmed_at: '2026-10-01T00:00:00Z' };
const token = 'valid.user.jwt';
async function fixture(overrides: Partial<PrivateReferenceDeps> = {}) {
  const bytes = new Uint8Array([1, 2, 3]);
  const reference: PrivateReference = { id: 'reference.test', filename: 'test.webp', mime_type: 'image/webp', byte_length: bytes.length,
    object_path: 'approved-seven/fixed.webp', width: 1, height: 1, sha256: await digestReference(bytes), source_sha256: await digestReference(bytes), source_library_id: 'test' };
  const events: ReferenceAudit[] = []; const calls: string[] = [];
  const deps: PrivateReferenceDeps = {
    verifyUser: async () => { calls.push('auth'); return user; },
    findMembership: async () => { calls.push('member'); return { user_id: userId, role: 'viewer', is_active: true }; },
    bucketIsPrivate: async () => { calls.push('private'); return true; },
    download: async () => { calls.push('download'); return bytes; },
    audit: event => { events.push(event); }, ...overrides,
  };
  const handler = createPrivateReferenceHandler(deps, [reference]);
  const request = (query = '?reference_id=reference.test', authorization: string | null = `Bearer ${token}`, method = 'GET') => handler(new Request('https://example.com/private' + query, { method, headers: authorization ? { Authorization: authorization } : {} }));
  return { request, calls, events, bytes, reference };
}
test('missing, API-key, malformed and query-only tokens deny before any data access', async () => {
  for (const auth of [null, 'Bearer sb_publishable_public', 'Bearer anon', 'Basic valid.user.jwt', 'Bearer valid.user.jwt extra']) {
    const f = await fixture(); const response = await f.request('?reference_id=reference.test&token=valid.user.jwt', auth);
    assert.equal(response.status, 401); assert.deepEqual(f.calls, []); assert.equal(f.events[0].actor_user_id, null);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  }
});
test('invalid, anonymous, unconfirmed, service-role and forged-user identities deny', async () => {
  for (const result of [null, { ...user, is_anonymous: true }, { ...user, email_confirmed_at: '' }, { ...user, role: 'service_role' }, { ...user, id: 'forged-id' }]) {
    const f = await fixture({ verifyUser: async () => result });
    assert.equal((await f.request()).status, 401); assert.ok(!f.calls.includes('member')); assert.ok(!f.calls.includes('download'));
  }
});
test('authenticated nonmembers, inactive members, unknown roles and mismatched IDs deny', async () => {
  for (const member of [null, { user_id: userId, role: 'viewer', is_active: false }, { user_id: userId, role: 'owner', is_active: true }, { user_id: 'other', role: 'admin', is_active: true }]) {
    const f = await fixture({ findMembership: async () => member });
    assert.equal((await f.request()).status, 403); assert.ok(!f.calls.includes('private')); assert.ok(!f.calls.includes('download'));
  }
});
test('active viewer, contributor and admin can read exact bytes without a URL', async () => {
  for (const role of ['viewer', 'contributor', 'admin']) {
    const f = await fixture({ findMembership: async () => ({ user_id: userId, role, is_active: true }) });
    const response = await f.request(); assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.bytes);
    assert.equal(response.headers.get('Location'), null); assert.equal(response.headers.get('X-Content-SHA256'), f.reference.sha256);
    assert.match(response.headers.get('Content-Disposition') || '', /^attachment;/);
    assert.equal(response.headers.get('Vary'), 'Authorization'); assert.match(response.headers.get('Content-Security-Policy') || '', /sandbox/);
    assert.deepEqual(f.calls, ['auth', 'private', 'download']); assert.equal(f.events[0].result, 'ALLOWED');
    assert.ok(!JSON.stringify(f.events).includes(token));
  }
});
test('membership is revalidated on every request and revocation takes effect immediately', async () => {
  let active = true, reads = 0;
  const f = await fixture({ findMembership: async () => ({ user_id: userId, role: 'viewer', is_active: active }), download: async () => { reads++; return new Uint8Array([1, 2, 3]); } });
  assert.equal((await f.request()).status, 200); active = false;
  assert.equal((await f.request()).status, 403); assert.equal(reads, 1);
});
test('no general path, URL, duplicate ID or write surface exists', async () => {
  for (const query of ['?other=reference.test', '?reference_id=reference.test&reference_id=reference.test', '?reference_id=reference.test&url=https://evil.test', '?reference_id=reference.test&access_token=secret']) {
    const f = await fixture(); assert.equal((await f.request(query)).status, 400); assert.ok(!f.calls.includes('download'));
  }
  const f = await fixture(); assert.equal((await f.request('?reference_id=../other-bucket/file')).status, 404);
  assert.equal((await f.request('?reference_id=reference.test', `Bearer ${token}`, 'POST')).status, 405);
  assert.ok(!f.calls.includes('download'));
});
test('a public/missing bucket, missing bytes, wrong hash and upstream exceptions fail closed', async () => {
  for (const overrides of [{ bucketIsPrivate: async () => false }, { download: async () => null }, { download: async () => new Uint8Array([3, 2, 1]) }, { verifyUser: async () => { throw new Error('SECRET_API_KEY'); } }]) {
    const f = await fixture(overrides); const response = await f.request();
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('SECRET_API_KEY'));
  }
});
test('runtime never sends server credential to Auth/membership or follows redirects', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const mock = async (input: any, init: RequestInit) => {
    seen.push({ url: String(input), init });
    if (String(input).includes('/auth/v1/')) return Response.json(user);
    if (String(input).includes('/rest/v1/')) return Response.json([{ user_id: userId, role: 'viewer', is_active: true }]);
    return Response.json({ id: PRIVATE_REFERENCE_BUCKET, public: false });
  };
  const deps = privateReferenceRuntime({ supabaseUrl: 'https://wuonwttmkadwsmefjukv.supabase.co', publishableKey: 'public', serviceKey: 'server-secret' }, mock as typeof fetch);
  await deps.verifyUser(token); await deps.findMembership(token, userId); await deps.bucketIsPrivate();
  for (const request of seen) assert.equal(request.init.redirect, 'error');
  assert.ok(!JSON.stringify(seen.slice(0, 2)).includes('server-secret'));
  assert.ok(JSON.stringify(seen[2]).includes('server-secret'));
  assert.throws(() => privateReferenceRuntime({ supabaseUrl: 'https://evil.test', publishableKey: 'public', serviceKey: 'server-secret' }));
});
test('runtime bounds object bytes even with absent or false length header', async () => {
  const mock = async () => new Response(new Uint8Array([1, 2, 3, 4]));
  const deps = privateReferenceRuntime({ supabaseUrl: 'https://wuonwttmkadwsmefjukv.supabase.co', publishableKey: 'public', serviceKey: 'server-secret' }, mock as typeof fetch);
  const f = await fixture(); await assert.rejects(() => deps.download(f.reference), /Oversized/);
});
test('modern server keys stay in apikey while legacy service JWTs retain bearer auth', async () => {
  for (const serviceKey of ['sb_secret_modern', 'legacy.service.jwt']) {
    let observed: Record<string, string> = {};
    const fetcher = async (_input: any, init?: RequestInit) => { observed = init?.headers as Record<string, string>; return Response.json({ id: PRIVATE_REFERENCE_BUCKET, public: false }); };
    const deps = privateReferenceRuntime({ supabaseUrl: 'https://wuonwttmkadwsmefjukv.supabase.co', publishableKey: 'sb_publishable_example', serviceKey }, fetcher as typeof fetch);
    assert.equal(await deps.bucketIsPrivate(), true);
    assert.equal(observed.apikey, serviceKey);
    assert.equal(observed.Authorization, serviceKey.startsWith('sb_secret_') ? undefined : `Bearer ${serviceKey}`);
  }
});
test('public source contains an empty fail-closed catalog and no production asset metadata', () => {
  assert.deepEqual(APPROVED_PRIVATE_REFERENCES, []);
  const code = readFileSync('supabase/functions/creative-dna-references/index.ts', 'utf8');
  assert.ok(!/payload|upload|bootstrap/i.test(code));
});
test('catalog metadata requires live membership and never reveals Library IDs or object paths', async () => {
  const f = await fixture(); const response = await f.request(''); assert.equal(response.status, 200);
  const catalog = await response.json(); assert.equal(catalog.references[0].id, 'reference.test');
  assert.deepEqual(Object.keys(catalog.references[0]).sort(), ['byte_length', 'filename', 'id', 'mime_type', 'sha256']);
  assert.ok(!f.calls.includes('private')); assert.ok(!f.calls.includes('download'));
  const noAuth = await fixture(); assert.equal((await noAuth.request('', null)).status, 401);
  const nonmember = await fixture({ findMembership: async () => null }); assert.equal((await nonmember.request('')).status, 403);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { png, jpeg, webp } from './fixtures/reference-synthetic.ts';
import { createReferenceLibraryHandler, type LibraryDeps } from '../supabase/functions/_shared/reference-library.ts';
import { digestReference } from '../supabase/functions/_shared/private-reference-access.ts';
import { decodeLibraryNotes, encodeLibraryNotes, inspectLibraryImage, MAX_LIBRARY_IMAGE_BYTES, parseLibraryPage, parseLibraryRecord, sanitizeLibraryNotes, type LibraryRecord } from '../supabase/functions/_shared/reference-library-contract.ts';
const id = '12345678-1234-4234-8234-123456789abc', userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const notes = sanitizeLibraryNotes({ filename: 'fixture.png', case_title: 'Good outcome', why_good: 'Clear product focus' });
const request = (method='GET', query='', bytes=png, mime='image/png') => new Request('https://example.test/references'+query, { method, headers: { Authorization: 'Bearer user.valid.jwt', ...(method === 'POST' ? { 'Content-Type': mime, 'X-Reference-Metadata': encodeLibraryNotes(notes) } : {}) }, ...(method === 'POST' ? { body: bytes as BodyInit } : {}) });
async function fixture(role = 'admin') {
  const records = new Map<string,LibraryRecord>(), objects = new Map<string,Uint8Array>(), audits: any[] = [];
  const calls = { uploads: 0, reads: 0, lists: 0, bucket: 0 };
  const deps: LibraryDeps = {
    verifyUser: async () => ({ id: userId, role: 'authenticated', email_confirmed_at: 'now' }),
    findMembership: async () => ({ user_id: userId, role, is_active: true }),
    bucketIsPrivate: async () => { calls.bucket++; return true; },
    list: async () => { calls.lists++; return { references: [...records.values()], next_offset: null }; },
    find: async id => records.get(id) || null,
    download: async record => { calls.reads++; return objects.get(record.id) || null; },
    upload: async (record, bytes) => { calls.uploads++; records.set(record.id, record); objects.set(record.id, bytes); return true; },
    audit: event => audits.push(event),
  };
  return { deps, calls, records, objects, audits, read: createReferenceLibraryHandler(deps), write: createReferenceLibraryHandler(deps,true) };
}
test('library accepts an empty catalog and has no required fixed seed count', async () => {
  const f = await fixture(); const response = await f.read(request());
  assert.equal(response.status,200); const page = parseLibraryPage(await response.json());
  assert.deepEqual(page.references,[]); assert.equal(page.can_upload,true); assert.equal(page.next_offset,null);
});
test('only verified active existing members may read; only active admins upload', async () => {
  for (const role of ['viewer','contributor','admin']) {
    const f = await fixture(role); assert.equal((await f.read(request())).status,200);
    assert.equal((await f.write(request('POST','?reference_id='+id))).status,role==='admin'?201:403);
  }
  for (const change of [
    (f: any) => f.deps.verifyUser = async () => null,
    (f: any) => f.deps.verifyUser = async () => ({ id:userId,role:'authenticated',is_anonymous:true,email_confirmed_at:'now' }),
    (f: any) => f.deps.verifyUser = async () => ({ id:userId,role:'authenticated' }),
    (f: any) => f.deps.findMembership = async () => null,
    (f: any) => f.deps.findMembership = async () => ({user_id:userId,role:'admin',is_active:false}),
    (f: any) => f.deps.findMembership = async () => ({user_id:id,role:'admin',is_active:true}),
  ]) {
    const f = await fixture(); change(f);
    assert.ok([401,403].includes((await f.read(request())).status)); assert.ok([401,403].includes((await f.write(request('POST','?reference_id='+id))).status));
    assert.equal(f.calls.bucket,0); assert.equal(f.calls.uploads,0);
  }
});
test('uploads arbitrary validated rasters with sanitized notes then reads exact private bytes', async () => {
  for (const [mime,bytes] of [['image/png',png],['image/jpeg',jpeg],['image/webp',webp]] as const) {
    const f = await fixture(); const response = await f.write(request('POST','?reference_id='+id,bytes,mime));
    assert.equal(response.status,201); assert.equal((await response.json()).status,'STORED_AND_VERIFIED');
    const stored = f.records.get(id)!; assert.equal(stored.sha256,await digestReference(bytes)); assert.equal(stored.width,2); assert.equal(stored.height,2);
    const read = await f.read(request('GET','?reference_id='+id)); assert.equal(read.status,200); assert.deepEqual(new Uint8Array(await read.arrayBuffer()),bytes);
    assert.match(read.headers.get('Cache-Control')!,/no-store/); assert.equal(read.headers.get('Location'),null);
  }
});
test('same operation is idempotent and mismatched replay cannot overwrite', async () => {
  const f = await fixture(); assert.equal((await f.write(request('POST','?reference_id='+id))).status,201);
  assert.equal((await f.write(request('POST','?reference_id='+id))).status,200); assert.equal(f.calls.uploads,1);
  assert.equal((await f.write(request('POST','?reference_id='+id,jpeg,'image/jpeg'))).status,409); assert.equal(f.calls.uploads,1);
});
test('uncertain upload is verified by read without automatic replay', async () => {
  const f = await fixture(); const upload = f.deps.upload;
  f.deps.upload = async (r,b) => { await upload(r,b); throw new Error('uncertain'); };
  const response = await f.write(request('POST','?reference_id='+id)); assert.equal(response.status,200); assert.equal(f.calls.uploads,1);
  const empty = await fixture(); empty.deps.upload = async () => { empty.calls.uploads++; throw new Error('uncertain'); };
  assert.equal((await empty.write(request('POST','?reference_id='+id))).status,503); assert.equal(empty.calls.uploads,1);
});
test('rejects missing token, arbitrary paths, URL query input, duplicate IDs and oversized images', async () => {
  const f = await fixture(); assert.equal((await f.read(new Request('https://example.test'))).status,401);
  for (const query of ['?reference_id=../escape','?reference_id='+id+'&reference_id='+id,'?url=https://evil.test','?offset=1&offset=2','?offset=1000001']) assert.ok([400,404].includes((await f.read(request('GET',query))).status));
  assert.equal((await f.write(request('POST','?reference_id='+id,new Uint8Array(MAX_LIBRARY_IMAGE_BYTES+1)))).status,400);
  assert.equal(f.calls.uploads,0);
});
test('invalid signatures, truncated containers, spoofed MIME and large dimensions fail closed', () => {
  for (const [bytes,mime] of [[png,'image/jpeg'],[new TextEncoder().encode('<svg onload="alert(1)"/>'),'image/png'],[png.subarray(0,30),'image/png'],[jpeg.subarray(0,jpeg.length-1),'image/jpeg'],[webp.subarray(0,webp.length-1),'image/webp']] as const) assert.throws(()=>inspectLibraryImage(bytes,mime));
  const huge = png.slice(); new DataView(huge.buffer).setUint32(16,13000); assert.throws(()=>inspectLibraryImage(huge,'image/png'));
});
test('notes are bounded plain text; unknown fields cannot control paths or privileges', () => {
  const cleaned = sanitizeLibraryNotes({ filename:'../test.png',case_title:'<Case>\n\u202eA',brand:'B' });
  assert.equal(cleaned.filename,'_test.png'); assert.equal(cleaned.case_title,'CaseA');
  assert.throws(()=>sanitizeLibraryNotes({filename:'x',object_path:'evil'})); assert.throws(()=>sanitizeLibraryNotes(JSON.parse('{"constructor":"no"}'))); assert.throws(()=>sanitizeLibraryNotes(JSON.parse('{"__proto__":{"admin":true}}'))); assert.throws(()=>sanitizeLibraryNotes({filename:'x',admin:true}));
  assert.throws(()=>decodeLibraryNotes('%oops')); assert.throws(()=>sanitizeLibraryNotes({why_good:'a'.repeat(1001)}));
  assert.deepEqual(decodeLibraryNotes(encodeLibraryNotes(cleaned)),cleaned);
});
test('public bucket, corrupt stored bytes and upstream errors never release image or secrets', async () => {
  const f = await fixture(); await f.write(request('POST','?reference_id='+id));
  f.deps.bucketIsPrivate = async()=>false; assert.equal((await f.read(request('GET','?reference_id='+id))).status,503);
  f.deps.bucketIsPrivate = async()=>true; f.objects.set(id,jpeg); assert.equal((await f.read(request('GET','?reference_id='+id))).status,503);
  f.deps.find = async()=>{throw new Error('secret token storage path');}; const response = await f.read(request('GET','?reference_id='+id)); assert.ok(!(await response.text()).includes('secret'));
  assert.ok(!JSON.stringify(f.audits).includes('user.valid.jwt')); assert.ok(!JSON.stringify(f.audits).includes('Good outcome'));
});
test('catalog parsing strips unexpected fields and keeps optional metadata', async () => {
  const f = await fixture(); await f.write(request('POST','?reference_id='+id)); const record = f.records.get(id)!;
  assert.ok(!JSON.stringify(parseLibraryRecord({...record,object_path:'private'})).includes('private'));
  assert.throws(()=>parseLibraryPage({schema:'uid-reference-library/1',references:[record,record],can_upload:true,next_offset:null}));
});
test('rejects synthetic parser attacks, bad PNG CRC and contradictory WebP dimensions', () => {
  const fakeJpeg = Uint8Array.from([255,216,255,192,0,8,8,0,1,0,1,0,255,218,0,0,255,217]);
  assert.throws(()=>inspectLibraryImage(fakeJpeg,'image/jpeg'));
  const badPng=png.slice();badPng[29]^=255;assert.throws(()=>inspectLibraryImage(badPng,'image/png'));
  const badWebp=new Uint8Array(webp.length+18);badWebp.set(webp.subarray(0,12));badWebp.set(new TextEncoder().encode('VP8X'),12);new DataView(badWebp.buffer).setUint32(16,10,true);badWebp.set(webp.subarray(12),30);
  const view=new DataView(badWebp.buffer);view.setUint32(4,badWebp.length-8,true);view.setUint16(44,16383,true);view.setUint16(46,16383,true);
  assert.throws(()=>inspectLibraryImage(badWebp,'image/webp'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceLibraryRuntime } from '../supabase/functions/_shared/reference-library-runtime.ts';
import { digestReference } from '../supabase/functions/_shared/private-reference-access.ts';
import { sanitizeLibraryNotes, type LibraryRecord } from '../supabase/functions/_shared/reference-library-contract.ts';
import { png } from './fixtures/reference-synthetic.ts';
const id = '12345678-1234-4234-8234-123456789abc';
const config = {supabaseUrl:'https://wuonwttmkadwsmefjukv.supabase.co',publishableKey:'test-public',serviceKey:'sb_secret_synthetic-test-only'};
async function record(): Promise<LibraryRecord> { return { ...sanitizeLibraryNotes({filename:'Ảnh.png',case_title:'Case đẹp'}),id,mime_type:'image/png',sha256:await digestReference(png),byte_length:png.length,width:2,height:2,created_at:'2026-10-11T00:00:00.000Z' }; }
test('runtime uploads immutable image with Unicode notes through documented custom metadata', async () => {
  const calls: any[]=[]; const r=await record();
  const runtime=referenceLibraryRuntime(config,(async(url,init)=>{calls.push({url:String(url),init});return Response.json({});}) as typeof fetch);
  assert.equal(await runtime.upload(r,png),true); const {url,init}=calls[0];
  assert.equal(url,config.supabaseUrl+'/storage/v1/object/creative-dna-references/library/v1/'+id);
  assert.equal(init.method,'POST'); assert.equal(init.redirect,'error'); assert.equal(init.headers['x-upsert'],'false');
  assert.equal(init.headers.apikey,config.serviceKey); assert.equal(init.headers.Authorization,undefined);
  assert.deepEqual(JSON.parse(Buffer.from(init.headers['x-metadata'],'base64').toString()),r); assert.deepEqual(init.body,png);
});
test('runtime reads provider info shape without exposing provider identifiers', async () => {
  const r=await record();
  const runtime=referenceLibraryRuntime(config,(async()=>Response.json({name:'library/v1/'+id,bucket_id:'creative-dna-references',size:png.length,content_type:'image/png',metadata:r,id:'provider-id'})) as typeof fetch);
  assert.deepEqual(await runtime.find(id),r); await assert.rejects(()=>runtime.find('../secret'));
});
test('runtime rejects inconsistent metadata paths, size, MIME and malformed IDs', async () => {
  const r=await record(), base={name:'library/v1/'+id,bucket_id:'creative-dna-references',size:png.length,content_type:'image/png',metadata:r};
  for (const patch of [{name:'other/path'},{bucket_id:'public-bucket'},{size:999},{content_type:'image/svg+xml'},{metadata:{...r,id:'../bad'}}]) {
    const runtime=referenceLibraryRuntime(config,(async()=>Response.json({...base,...patch})) as typeof fetch); await assert.rejects(()=>runtime.find(id));
  }
});
test('runtime treats only explicit missing objects as absent; other failures fail closed', async () => {
  for (const response of [new Response('{}',{status:404}),Response.json({statusCode:'404'},{status:400}),Response.json({error:'not_found'},{status:400})]) {
    const runtime=referenceLibraryRuntime(config,(async()=>response) as typeof fetch); assert.equal(await runtime.find(id),null);
  }
  const runtime=referenceLibraryRuntime(config,(async()=>Response.json({error:'denied'},{status:403})) as typeof fetch); await assert.rejects(()=>runtime.find(id));
});
test('runtime paginates fixed private prefix and bounds metadata and image responses', async () => {
  const r=await record(), calls:any[]=[];
  const runtime=referenceLibraryRuntime(config,(async(url,init)=>{ calls.push({url:String(url),init});
    if(String(url).includes('/object/list/'))return Response.json([{name:id}]);
    if(String(url).includes('/object/info/'))return Response.json({name:'library/v1/'+id,bucket_id:'creative-dna-references',size:png.length,content_type:'image/png',metadata:r});
    return new Response(png as BodyInit);
  }) as typeof fetch);
  assert.deepEqual(await runtime.list(20),{references:[r],next_offset:null});
  assert.deepEqual(JSON.parse(calls[0].init.body),{prefix:'library/v1',limit:21,offset:20,sortBy:{column:'created_at',order:'desc'}});
  assert.deepEqual(await runtime.download(r),png);
  const lying=referenceLibraryRuntime(config,(async()=>new Response(new Uint8Array(png.length+1))) as typeof fetch);await assert.rejects(()=>lying.download(r));
});
test('runtime cannot change project host and never follows redirects', () => {
  assert.throws(()=>referenceLibraryRuntime({...config,supabaseUrl:'https://evil.test'}));
});

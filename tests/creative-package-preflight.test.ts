import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { readBoundedPackageFile, packagePath } from '../scripts/quality/bounded-file.ts';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflightAsset } from '../uid-asset-preflight.ts';
import { compileBrandColors } from '../uid-brand-colors.ts';
import { preflightCreativePackage } from '../scripts/preflight-creative-package.ts';
import { getOnepageUiTemplate } from '../onepage-ui-template.ts';
const image = () => sharp({create:{width:600,height:300,channels:4,background:{r:20,g:60,b:90,alpha:0.5}}}).png().toBuffer();
const spec = {product_id:'TEST-PRODUCT-NOT-SUPPLIER-APPROVAL',source_url:'https://example.com/test-spec',evidence_sha256:'a'.repeat(64),minimum_ppi:150,verification:'unverified' as const};

test('color compiler permits exact opaque color tokens, never layout/CSS/custom selectors', () => {
  const out = compileBrandColors({cart_text:'#FFFFFF',preview_background:'#b45b34'});
  assert.equal(out.css,'#teeAtcButton{color:#ffffff !important;}\n.tee-btn--preview{background-color:#b45b34 !important;}');
  for (const bad of [{},[],{font:'Arial'},{layout:'new'},{cart_text:'red'},{cart_text:'#fff;display:none'},{cart_text:'var(--evil)'},{cart_text:'#ffffffff'},JSON.parse('{"__proto__":{"x":1}}')]) assert.throws(()=>compileBrandColors(bad));
  assert.equal(out.visual_qc_performed,false);
});

test('Sharp fully decodes bytes, ignores density as PPI and never certifies visual or print readiness',async()=>{
  const bytes=await image();const result=await preflightAsset(bytes);
  assert.equal(result.decode,'FULL_PIXEL_DECODE_PASSED');assert.equal(result.width,600);assert.equal(result.has_alpha,true);
  assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.visual_qc_performed,false);assert.equal(result.print_ready,false);
  const print=await preflightAsset(bytes,{placement:{width_inches:8,height_inches:4},supplier_spec:spec});
  assert.equal(print.effective_ppi?.minimum,75);
  assert.deepEqual(print.blockers,['SUPPLIER_SPEC_NOT_VERIFIED','INSUFFICIENT_EFFECTIVE_PPI']);
  const crop=await preflightAsset(bytes,{placement:{width_inches:4,height_inches:2,crop:{left:0,top:0,width:300,height:150}},supplier_spec:{...spec,verification:'verified'}});
  assert.equal(crop.effective_ppi?.minimum,75);assert.equal(crop.supplier_evidence_independently_verified,false);
  assert.deepEqual((await preflightAsset(bytes,{placement:{width_inches:4,height_inches:2}})).blockers,['SUPPLIER_SPEC_MISSING']);
});

test('invalid/truncated image, wrong hash, invalid placement and crop fail closed',async()=>{
 const bytes=await image();
 for(const b of [Buffer.from('not an image'),bytes.subarray(0,60)])await assert.rejects(preflightAsset(b));
 await assert.rejects(preflightAsset(bytes,{expected_sha256:'0'.repeat(64)}),/HASH_MISMATCH/);
 for(const n of [0,-1,NaN,Infinity])await assert.rejects(preflightAsset(bytes,{placement:{width_inches:n,height_inches:1}}),/PLACEMENT/);
 await assert.rejects(preflightAsset(bytes,{placement:{width_inches:1,height_inches:1,crop:{left:500,top:0,width:200,height:30}}}),/CROP/);
 await assert.rejects(preflightAsset(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')),/UNSUPPORTED/);
});

test('EXIF rotation is applied before placement math and oversized decode is rejected',async()=>{
 const bytes=await sharp({create:{width:60,height:30,channels:3,background:'#aabbcc'}}).withMetadata({orientation:6}).jpeg().toBuffer();
 const r=await preflightAsset(bytes,{placement:{width_inches:1,height_inches:2}});assert.equal(r.width,30);assert.equal(r.height,60);assert.equal(r.effective_ppi?.minimum,30);
 const oversized=await sharp({create:{width:6000,height:6000,channels:3,background:'#ffffff'}}).png().toBuffer();
 await assert.rejects(preflightAsset(oversized),/pixel limit/i);
});

test('package pipeline re-reads bytes and binds genuine Onepage only to fully decoded slot inventory',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'uid-quality-'));
 try {
  const bytes=await image();await writeFile(join(dir,'asset.png'),bytes);
  const t=getOnepageUiTemplate();
  const manifest:any={schema_version:'uid.creative-package-input.v1',assets:t.asset_slots.map(id=>({id,path:'asset.png'})),onepage:{template_version:t.version,bindings:{text:Object.fromEntries(t.text_slots.map(s=>[s,'Test '+s])),assets:Object.fromEntries(t.asset_slots.map(s=>[s,'asset.png']))}}};
  const path=join(dir,'manifest.json');await writeFile(path,JSON.stringify(manifest));
  const r=await preflightCreativePackage(path);assert.equal(r.onepage?.status,'BOUND_REQUIRES_VISUAL_QA');assert.equal(r.receipts.length,t.asset_slots.length);assert.ok(r.receipts.every(x=>x.revalidated_at>=x.read_at));
  manifest.onepage.bindings.text.occasion_heading='Invented';await writeFile(path,JSON.stringify(manifest));await assert.rejects(preflightCreativePackage(path),/UI_COPY/);
  delete manifest.onepage.bindings.text.occasion_heading;manifest.assets[0].placement={width_inches:20,height_inches:10};await writeFile(path,JSON.stringify(manifest));const blocked=await preflightCreativePackage(path);assert.equal(blocked.status,'BLOCKED');assert.equal(blocked.onepage,null);
  manifest.assets=[{id:'outside',path:'../asset.png'}];delete manifest.onepage;await writeFile(path,JSON.stringify(manifest));await assert.rejects(preflightCreativePackage(path),/UNSAFE_PACKAGE_REFERENCE/);
  await symlink(join(dir,'asset.png'),join(dir,'link.png'));manifest.assets=[{id:'link',path:'link.png'}];await writeFile(path,JSON.stringify(manifest));await assert.rejects(preflightCreativePackage(path),/SYMLINK/);
 }finally{await rm(dir,{recursive:true,force:true});}
});


test('all reads reject nonregular/oversized/symlink files and URL-ambiguous names',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'uid-bounded-'));
 try {
  await writeFile(join(dir,'good.json'),'{}');
  await symlink(join(dir,'good.json'),join(dir,'manifest.json'));
  await assert.rejects(preflightCreativePackage(join(dir,'manifest.json')),/SYMLINK/);
  await assert.rejects(readBoundedPackageFile(dir,'good.json',1),/OVERSIZE/);
  for(const name of ['../bad','./good.json','a/../good.json','good.json?x','good.json#x','%67ood.json','a\\b','white space.png','a//b'])assert.throws(()=>packagePath(dir,name),/UNSAFE_PACKAGE_REFERENCE/);
  await symlink(dir,join(dir,'linkdir'));await assert.rejects(readBoundedPackageFile(dir,'linkdir/good.json',100),/SYMLINK/);
  if(process.platform!=='win32') { const result=spawnSync('mkfifo',[join(dir,'pipe')]);assert.equal(result.status,0);await assert.rejects(readBoundedPackageFile(dir,'pipe',100),/NONREGULAR/); }
 }finally{await rm(dir,{recursive:true,force:true});}
});

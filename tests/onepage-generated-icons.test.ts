import test from 'node:test';
import assert from 'node:assert/strict';
import { packageOnepageReview } from '../public/onepage-review-pack.mjs';
const checksum='sha256:'+'a'.repeat(64);
const base=()=>({schema_version:'uid-onepage-preview/1',identity_type:'task',task_id:'task-test',content_version:'v1',brand:'PawfectHouse',template_version:'2026-10-11.v3',asset_manifest:[{slot:'occasion_icon_01',asset_id:'generated-01',file_url:'assets/occasion_icon_01.webp',checksum}]});
const html=(src='assets/occasion_icon_01.webp')=>'<html><body><img data-asset-slot="occasion_icon_01" src="'+src+'"></body></html>';
test('preview binds the exact generated icon image',()=>{ const r=packageOnepageReview(html(),base(),'console.log(1);','body{}'); assert.match(r.html,/assets\/occasion_icon_01\.webp/);assert.equal(r.manifest.asset_manifest[0].asset_id,'generated-01');});
test('preview refuses SVG and silently substituted icons',()=>{for(const src of ['assets/system-icon.svg','assets/other-image.webp','data:image/svg+xml;base64,abcd']) assert.throws(()=>packageOnepageReview(html(src),base(),'console.log(1);','body{}'),/OCCASION_ICON_ASSET_MISMATCH/);const m=base();m.asset_manifest[0].file_url='assets/system-icon.svg';assert.throws(()=>packageOnepageReview(html('assets/system-icon.svg'),m,'console.log(1);','body{}'),/OCCASION_ICON_NOT_GENERATED_RASTER/);});
test('preview refuses declared icons missing from HTML',()=>{assert.throws(()=>packageOnepageReview('<html><body>No icon</body></html>',base(),'console.log(1);','body{}'),/OCCASION_ICON_NOT_RENDERED/);});
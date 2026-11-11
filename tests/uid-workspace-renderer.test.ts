import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from '../tools/creative-quality/sharp.ts';
import {buildWorkspacePreview} from '../uid-workspace-preview.ts';
import {getOnepageUiTemplate} from '../onepage-ui-template.ts';
import {createWorkspaceTask} from '../uid-workspace-task.ts';
import {buildWorkspaceCaptureDocument,createWorkspaceBrowserRenderer,type WorkspaceCaptureBrowser} from '../uid-workspace-renderer.ts';
import type {WorkspaceStageContext} from '../uid-workspace-runner.ts';
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
async function fixture(){
 const png=await sharp({create:{width:20,height:12,channels:3,background:'#346655'}}).png().toBuffer();const source=getOnepageUiTemplate();
 const aliases:Record<string,string>={occasion_story_01:'occasion_01',occasion_story_02:'occasion_02',occasion_story_01_mobile:'detail_main'};
 const slots=Object.fromEntries(source.text_slots.map(slot=>[slot,'Synthetic test '+slot]));
 const preview=buildWorkspacePreview({task_id:'task',content_revision:'copy',canonical_hash:'a'.repeat(64),text:slots,artifacts:Object.fromEntries(source.asset_slots.map(slot=>[slot,{canonical_slot:aliases[slot]??slot,artifact_revision:'revision',sha256:sha(png),mime_type:'image/png',bytes:png}]))});
 const controller=new AbortController();
 const context={owner_id:'owner',signal:controller.signal,record:{owner_id:'owner',task:createWorkspaceTask('task',{snapshot_id:'snapshot',canonical_version:'canonical',content_revision:'copy',content_digest:'digest',assets:[]}),content:{revision:'copy',slots},review_manifest:preview.manifest,artifacts:[{artifact_id:'image',revision_id:'revision',kind:'image',verification:'verified',sha256:sha(png),media_type:'image/png',content_revision:'copy',size_bytes:png.length}],actions:[],events:[]},run:{run_id:'run'},action:{}} as unknown as WorkspaceStageContext;
 return{preview,context,controller};
}
function browserFixture(mode:'normal'|'overflow'|'wrong_pixels'|'network'|'hang'='normal'){
 const contexts:any[]=[];const writes:any[]=[];let closed=0;let launches=0;
 const browser:WorkspaceCaptureBrowser={async close(){closed++;},async newContext(options){
  contexts.push(options);let handler:((route:{abort():Promise<void>})=>Promise<void>)|undefined;
  return{async close(){},async newPage(){return{
   async route(_pattern,callback){handler=callback;},setDefaultTimeout(){},async setContent(html){assert.match(html,/script-src 'none'/);assert.doesNotMatch(html,/<script\b/);if(mode==='network')await handler!({async abort(){}});},
   async evaluate<T>(){if(mode==='hang')return new Promise<T>(()=>{});return{width:options.viewport.width+(mode==='overflow'?1:0),height:options.viewport.height,viewport:options.viewport.width,images:[{width:20,height:12,complete:true}],font_status:'loaded',font_families:['Arial']} as T;},
   async screenshot(){return sharp({create:{width:options.viewport.width+(mode==='wrong_pixels'?1:0),height:options.viewport.height,channels:3,background:'#445566'}}).png().toBuffer();},
  };}};
 }};
 const renderer=createWorkspaceBrowserRenderer({writeRunArtifact:async(_context,identity,bytes)=>{const chunks=[];for await(const part of bytes)chunks.push(part);const data=Buffer.concat(chunks);assert.equal(sha(data),identity.sha256);writes.push({identity,data});return identity;}},{browser:{sandboxed:true,review_ref:'reviewed-test-browser',launch:async options=>{launches++;assert.deepEqual(options,{headless:true,chromiumSandbox:true,args:[]});return browser;}},timeoutMs:1000});
 return{renderer,contexts,writes,closed:()=>closed,launches:()=>launches};
}
test('renderer is disabled by default and does not discover or launch browsers',()=>{
 assert.equal(createWorkspaceBrowserRenderer({} as any).readiness().ready,false);
});
test('capture document is reconstructed from fixed bindings and hash-verified bytes, not supplied scripts',async()=>{
 const f=await fixture();f.preview.html=f.preview.html.replace('</body>','<script>fetch("https://bad.example")</script></body>');
 const document=buildWorkspaceCaptureDocument(f.context,f.preview);assert.doesNotMatch(document.html,/<script\b/);assert.match(document.html,/img-src data:/);
 assert.ok(document.source_rasters.length>=1);
 f.preview.canonical.html+='<p>tampered layout</p>';assert.throws(()=>buildWorkspaceCaptureDocument(f.context,f.preview),/RENDER_CANONICAL_MISMATCH/);
});
test('capture rejects stale copy/index and wrong private raster metadata before browser launch',async()=>{
 const f=await fixture();const b=browserFixture();(f.context.record.content!.slots as any).title_01='Changed';
 await assert.rejects(b.renderer.renderMapping(f.context,f.preview),/RENDER_COPY_CHANGED/);assert.equal(b.launches(),0);
 const g=await fixture();g.context.record.artifacts[0].size_bytes++;assert.throws(()=>buildWorkspaceCaptureDocument(g.context,g.preview),/RENDER_RASTER_MISMATCH/);
});
test('renderer captures all four exact viewports with sandbox/network protections and durable PNG evidence',async()=>{
 const f=await fixture(),b=browserFixture();const result=await b.renderer.renderMapping(f.context,f.preview);
 assert.deepEqual(b.contexts.map(c=>c.viewport.width),[1440,390,798,799]);assert.ok(b.contexts.every(c=>c.javaScriptEnabled===false&&c.bypassCSP===false&&c.serviceWorkers==='block'&&c.acceptDownloads===false&&c.deviceScaleFactor===1));
 assert.equal(b.writes.length,5);assert.equal(result.captures.length,4);assert.deepEqual(result.bytes,b.writes[0].data);assert.match(result.evidence_refs[0],/^render:[a-f0-9]{64}:\d+$/);
 const receipt=JSON.parse(b.writes.at(-1).data);assert.equal(receipt.eo_parity,false);assert.equal(receipt.semantic_qc,false);assert.equal(receipt.render_hash,f.preview.manifest.render_hash);assert.equal(receipt.captures.length,4);assert.ok(b.closed()>0);
});
for(const [mode,error] of [['overflow','RENDER_LAYOUT_NOT_READY'],['wrong_pixels','RENDER_CAPTURE_MISMATCH'],['network','RENDER_EXTERNAL_REQUEST_BLOCKED']] as const)test('renderer fails closed on '+mode,async()=>{
 const f=await fixture(),b=browserFixture(mode);await assert.rejects(b.renderer.renderMapping(f.context,f.preview),new RegExp(error));assert.equal(b.writes.length,0);assert.ok(b.closed()>0);
});
test('renderer closes browser on deadline and never emits a mapping receipt',async()=>{
 const f=await fixture(),b=browserFixture('hang');await assert.rejects(b.renderer.renderMapping(f.context,f.preview),/RENDER_DEADLINE_EXCEEDED/);assert.equal(b.writes.length,0);assert.ok(b.closed()>0);
});
test('renderer refuses already cancelled input before browser work or artifact writes',async()=>{
 const f=await fixture(),b=browserFixture();f.controller.abort();await assert.rejects(b.renderer.renderMapping(f.context,f.preview),/RENDER_CANCELLED/);assert.equal(b.launches(),0);assert.equal(b.writes.length,0);
});

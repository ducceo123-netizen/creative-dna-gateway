import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { buildWorkspacePreview, type WorkspacePreviewInput } from '../uid-workspace-preview.ts';
import { getOnepageUiTemplate } from '../onepage-ui-template.ts';
import { resolveWorkspaceElementFeedback } from '../uid-workspace-review.ts';
const hash = (b:Uint8Array|string) => createHash('sha256').update(b).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=','base64');
function fixture(faq=false):WorkspacePreviewInput {
 const source=getOnepageUiTemplate(faq?'2026-10-19.faq.v1':undefined);
 const aliases:Record<string,string>={occasion_story_01:'occasion_01',occasion_story_02:'occasion_02',occasion_story_01_mobile:'detail_main'};
 return {task_id:'t1',content_revision:'c1',canonical_hash:'a'.repeat(64),template_version:source.version,
 text:Object.fromEntries(source.text_slots.map(slot=>[slot,slot+' approved copy'])),...(faq?{faq_count:1}:{}),
 artifacts:Object.fromEntries(source.asset_slots.map(slot=>[slot,{canonical_slot:aliases[slot]??slot,artifact_revision:'a1',sha256:hash(png),mime_type:'image/png',bytes:png}]))};
}
test('preview binds exact canonical bytes and exposes six canonical selection groups',()=>{
 const input=fixture(); const p=buildWorkspacePreview(input);
 assert.equal(p.status,'PREVIEW_REQUIRES_VISUAL_QA');
 assert.equal(p.manifest.elements.filter(e=>e.kind==='image').length,19);
 assert.equal(p.manifest.elements.filter(e=>e.kind==='text').length,26);
 assert.deepEqual(p.manifest.elements.filter(e=>e.kind==='section').map(e=>e.id).sort(),['section:banner','section:benefits','section:details','section:gtk','section:occasion_icons','section:occasion_media']);
 assert.equal(p.canonical.css,(getOnepageUiTemplate(undefined,'source') as {css:string}).css);
 assert.ok(p.html.includes('data:image/png;base64,'));
 assert.ok(!p.html.includes('href="styles.css"')); assert.ok(!/(?:src|href|srcset)="https?:/.test(p.html));
 assert.ok(p.html.includes("connect-src 'none'")); assert.ok(p.html.includes("img-src data:"));
 assert.ok(!p.canonical.html.includes('data-workspace-')); assert.ok(!p.canonical.html.includes('<script'));
});
test('FAQ exact slot map selects FAQ rows without inventing GTK assets',()=>{
 const p=buildWorkspacePreview(fixture(true));
 assert.ok(p.manifest.elements.some(e=>e.id==='section:faq'));
 assert.ok(!p.manifest.elements.some(e=>e.id==='section:gtk'));
 assert.ok(p.manifest.elements.some(e=>e.id==='text:faq_question_01'));
});
test('copy stays escaped, embedded runtime parses, random channel does not change render identity',()=>{
 const input=fixture(); input.text.title_01='</script><img src=x onerror=alert(1)>';
 const a=buildWorkspacePreview(input),b=buildWorkspacePreview(input);
 assert.equal(a.manifest.render_hash,b.manifest.render_hash); assert.equal(a.manifest.index_id,b.manifest.index_id);
 assert.notEqual(a.channel_nonce,b.channel_nonce); assert.ok(a.html.includes('&lt;/script&gt;'));
 const runtime=a.html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)![1];
 assert.doesNotThrow(()=>new vm.Script(runtime));
 assert.equal((a.html.match(/<script\b/g)||[]).length,1);
});
test('missing, unexpected or mismatched verified bytes cannot produce preview',()=>{
 for(const mutate of [
  (i:WorkspacePreviewInput)=>{delete i.artifacts.banner_desktop},
  (i:WorkspacePreviewInput)=>{i.artifacts.fake=i.artifacts.banner_desktop},
  (i:WorkspacePreviewInput)=>{i.artifacts.banner_desktop.sha256='f'.repeat(64)},
  (i:WorkspacePreviewInput)=>{i.artifacts.banner_desktop.mime_type='image/webp'},
  (i:WorkspacePreviewInput)=>{i.artifacts.banner_desktop.canonical_slot='detail_main'},
  (i:WorkspacePreviewInput)=>{i.artifacts.occasion_story_01_mobile.artifact_revision='a2'},
 ]){const input=fixture();mutate(input);assert.throws(()=>buildWorkspacePreview(input));}
});
test('direct section feedback resolves exact text/images and immutable alias once',()=>{
 const p=buildWorkspacePreview(fixture()); const m=p.manifest;
 const r=resolveWorkspaceElementFeedback(m,{task_id:m.task_id,content_revision:m.content_revision,render_hash:m.render_hash,index_id:m.index_id,groups:[{instruction:'Chỉ sửa phần hình này',element_ids:['section:occasion_media'],viewport_width:390}]});
 assert.equal(r.groups[0].text_slots.length,0);
 assert.deepEqual(r.groups[0].assets.map(x=>x.canonical_slot).sort(),['occasion_01','occasion_02']);
});
test('changed content or image version invalidates prior rendered feedback',()=>{
 const input=fixture(),a=buildWorkspacePreview(input); input.text.title_01+=' revised'; const b=buildWorkspacePreview(input);
 assert.notEqual(a.manifest.index_id,b.manifest.index_id);
 assert.throws(()=>resolveWorkspaceElementFeedback(b.manifest,{task_id:'t1',content_revision:'c1',render_hash:a.manifest.render_hash,index_id:a.manifest.index_id,groups:[{instruction:'old',element_ids:['text:title_01'],viewport_width:1280}]}),/STALE_PREVIEW/);
});


test('responsive detail alias belongs to actual Product Details ancestry in GTK and FAQ',()=>{
 for(const faq of [false,true]){
  const p=buildWorkspacePreview(fixture(faq));
  const details=p.manifest.elements.find(e=>e.id==='section:details');
  const occasion=p.manifest.elements.find(e=>e.id==='section:occasion_media');
  assert.ok(details?.kind==='section' && details.children.includes('image:occasion_story_01_mobile'));
  assert.ok(occasion?.kind==='section' && !occasion.children.includes('image:occasion_story_01_mobile'));
  // Every marked leaf is contained by its claimed actual canonical DIV section.
  const stack:(string|undefined)[]=[];const actual=new Map<string,string|undefined>();
  for(const match of p.html.matchAll(/<\/?[a-z][^>]*>/gi)){
   const tag=match[0];if(/^<\/div\s*>$/i.test(tag)){stack.pop();continue;}
   if(/^<div(?:\s|>)/i.test(tag))stack.push(tag.match(/data-workspace-section="([^"]+)"/)?.[1]??stack.at(-1));
   const element=tag.match(/data-workspace-element="([^"]+)"/)?.[1];if(element)actual.set(element,stack.at(-1));
  }
  for(const section of p.manifest.elements.filter(e=>e.kind==='section'))for(const child of section.children)assert.equal(actual.get(child),section.id,child);
 }
});


test('runtime mobile source selection stays visibly outlined after IMG processing and resize',()=>{
 const p=buildWorkspacePreview(fixture());const runtime=p.html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)![1];
 const listeners:Record<string,Function>={},domListeners:Record<string,Function>={};const sent:any[]=[];let mobile=true;
 class FakeElement{style:any={};dataset:any={};tagName='';media='';closest(selector:string):any{return selector==='picture'?picture:this;}}
 const source=new FakeElement();source.tagName='SOURCE';source.media='(max-width: 799px)';source.dataset.workspaceElement='image:banner_mobile';
 const image=new FakeElement();image.tagName='IMG';image.dataset.workspaceElement='image:banner_desktop';
 const picture={querySelectorAll:()=>[source]};const parent={postMessage:(data:any)=>sent.push(data)};
 vm.runInNewContext(runtime,{parent,Element:FakeElement,innerWidth:390,matchMedia:()=>({matches:mobile}),ResizeObserver:class{observe(){}},
  document:{documentElement:{scrollHeight:100},addEventListener:(type:string,fn:Function)=>domListeners[type]=fn,querySelectorAll:()=>[source,image]},
  addEventListener:(type:string,fn:Function)=>listeners[type]=fn});
 listeners.message({source:parent,data:{type:'uid-workspace-highlight',channel_nonce:p.channel_nonce,element_ids:['image:banner_mobile']}});
 assert.equal(image.style.outline,'3px solid #4f46e5');
 domListeners.click({target:image,preventDefault(){},stopPropagation(){}});assert.equal(sent.at(-1).element_id,'image:banner_mobile');
 mobile=false;listeners.resize();assert.equal(image.style.outline,'');
 domListeners.click({target:image,preventDefault(){},stopPropagation(){}});assert.equal(sent.at(-1).element_id,'image:banner_desktop');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/onepage-review.js',import.meta.url),'utf8');
// Event/validation unit harness only. Real browser/layout checks are tests/browser/onepage-review.py.
function harness(change?: (m:any,n:any)=>void, clipboardFails=false) {
 const nodes:Record<string,any>={}; let listener:any, observer:any, copied='';
 class El {
  tagName:string; id=''; dataset:any={}; children:any[]=[]; parentElement:any; textContent=''; value=''; disabled=false; checked=true; open=false; style={}; attrs:any={}; currentSrc=''; src=''; onclick:any; onchange:any; oninput:any;
  constructor(tag='div'){this.tagName=tag.toUpperCase();}
  get outerHTML(){return JSON.stringify([this.tagName,this.id,this.dataset,this.textContent,this.attrs,this.children.map(n=>n.outerHTML)]);}
  set innerHTML(html:string){for(const match of html.matchAll(/id="([^"]+)"/g)){const n=new El();n.id=match[1];nodes[n.id]=n;}nodes.kind.value='element';}
  append(n:any){this.children.push(n);n.parentElement=this;}
  attachShadow(){return {append:(n:any)=>{},getElementById:(id:string)=>nodes[id]};}
  setAttribute(k:string,v:string){this.attrs[k]=v;}
  getAttribute(k:string){return this.attrs[k]??null;}
  replaceChildren(...a:any[]){this.children=a;}
  contains(n:any):boolean{return n===this||this.children.some(c=>c.contains(n));}
  closest(selector:string):any{if(selector==='picture')return this.tagName==='PICTURE'?this:this.parentElement?.closest(selector);if(this.dataset.textSlot||this.dataset.assetSlot)return this;return this.parentElement?.closest(selector);}
  querySelector(selector:string){return this.children.find(c=>c.tagName==='IMG');}
  getBoundingClientRect(){return {left:0,top:0,width:200,height:50};}
  focus(){} select(){}
 }
 const root=new El(),section=new El(),title=new El('h2'),picture=new El('picture'),img=new El('img'),mobile=new El('source');
 root.append(section);section.append(title);section.append(picture);picture.append(mobile);picture.append(img);
 title.dataset.textSlot='title';title.textContent='Actual title';img.dataset.assetSlot='desktop';img.attrs.src='https://assets.test/desktop.png';img.src=img.currentSrc=img.attrs.src;mobile.dataset.assetSlot='mobile';mobile.attrs.srcset='https://assets.test/mobile.png';mobile.attrs.media='(max-width:799px)';
 const m:any={schema_version:'uid-onepage-preview/1',task_id:'task1',content_version:'v2',render_hash:'hash',brand:'brand',template_version:'template1',asset_manifest:[{slot:'desktop',asset_id:'a1',file_url:img.src,checksum:'sha1'},{slot:'mobile',asset_id:'a2',file_url:mobile.attrs.srcset,checksum:'sha2'}]};
 const manifest=new El('script'); nodes['onepage-review-manifest']=manifest;
 const inventory={root,section,title,img,mobile};change?.(m,inventory);manifest.textContent=JSON.stringify(m);
 const doc:any={readyState:'complete',baseURI:'https://preview.test/',currentScript:{src:'https://preview.test/onepage-review.js',dataset:{}},body:new El('body'),createElement:(tag:string)=>new El(tag),getElementById:(id:string)=>nodes[id],querySelectorAll:(selector:string)=>selector==='#onepage-review-manifest'?[manifest]:selector==='[data-text-slot]'?[title]:selector==='[data-asset-slot]'?[img,mobile]:selector==='[data-onepage-review-section]'?[]:selector==='.uid-product-content-container'?[root]:[],addEventListener:(_e:string,fn:any)=>{listener=fn;}};
 const context:any={document:doc,URL,innerWidth:1200,innerHeight:900,devicePixelRatio:1,addEventListener:()=>{},MutationObserver:class{constructor(fn:any){observer=fn;}observe(){}},navigator:{clipboard:{writeText:async(s:string)=>{if(clipboardFails)throw Error('no permission');copied=s;}}}};
 context.matchMedia=()=>({matches:context.innerWidth<=799});
 vm.runInNewContext(source,context);
 const click=(target:any)=>listener({target,composedPath:()=>[target],preventDefault(){},stopImmediatePropagation(){}});
 const add=(text:string)=>{nodes.feedback.value=text;nodes.add.onclick();};
 return {nodes,inventory,click,add,context,observer,manifest,get copied(){return copied;}};
}
test('actual IDs and exact asset mappings are preserved in separate viewport groups',async()=>{
 const h=harness();h.click(h.inventory.title);h.click(h.inventory.img);h.add('Align these');
 h.context.innerWidth=390;h.inventory.img.currentSrc=h.inventory.mobile.attrs.srcset;h.click(h.inventory.img);h.add('Mobile crop');await h.nodes.copy.onclick();
 const packet=JSON.parse(h.copied.slice(h.copied.indexOf('{')));
 assert.equal(packet.schema_version,'uid-onepage-preview-feedback/1');assert.equal(packet.task_id,'task1');assert.equal(packet.render_hash,'hash');
 assert.deepEqual(packet.groups[0].element_ids,['text:title','image:desktop']);assert.equal(packet.groups[0].elements[1].asset_id,'a1');
 assert.deepEqual(packet.groups[1].element_ids,['image:mobile']);assert.equal(packet.groups[1].elements[0].checksum,'sha2');assert.equal(packet.groups[1].viewport_width,390);
});
test('section selection includes exact actual descendant text and image inventory',()=>{
 const h=harness();h.nodes.kind.value='section';h.click(h.inventory.title);h.add('Spacing');const packet=JSON.parse(h.nodes.prompt.value.slice(h.nodes.prompt.value.indexOf('{')));
 assert.deepEqual(packet.groups[0].element_ids,['section:1']);assert.equal(packet.groups[0].section_elements.length,3);
});
test('missing mapping, duplicated mapping and stale context fail closed',()=>{
 for(const mutate of [(m:any)=>m.asset_manifest.pop(),(m:any)=>m.asset_manifest.push(m.asset_manifest[0]),(m:any)=>m.current_context={render_hash:'stale'},(m:any)=>m.schema_version='invalid']){
  const h=harness(mutate);assert.equal(h.nodes.copy.disabled,true);assert.match(h.nodes.status.textContent,/Không thể/);
 }
});
test('post-capture mutation blocks even same-turn copy and clears manual prompt',async()=>{
 for(const mutate of [(h:any)=>h.inventory.title.textContent='new title',(h:any)=>h.inventory.img.attrs.src='https://assets.test/new.png',(h:any)=>h.manifest.textContent=h.manifest.textContent.replace('task1','task2')]){
  const h=harness();h.click(h.inventory.title);h.add('Edit');mutate(h);await h.nodes.copy.onclick();assert.equal(h.copied,'');assert.equal(h.nodes.prompt.value,'');assert.equal(h.nodes.copy.disabled,true);
 }
});
test('unfinished feedback is not copied; clipboard denial exposes manual fallback',async()=>{
 const h=harness(undefined,true);h.click(h.inventory.title);h.add('Edit');h.click(h.inventory.img);await h.nodes.copy.onclick();assert.equal(h.copied,'');h.nodes.clear.onclick();await h.nodes.copy.onclick();assert.equal(h.nodes['prompt-details'].open,true);assert.match(h.nodes.status.textContent,/Clipboard/);
});
test('review styles are shadow-only and runtime contains no network or auto-submit calls',()=>{
 const css=readFileSync(new URL('../public/onepage-review.css',import.meta.url),'utf8');assert.match(source,/attachShadow/);assert.match(css,/:host/);assert.doesNotMatch(css,/(?:^|\n)(?:body|main|\.uid-product)/);assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);assert.doesNotMatch(source,/\.submit\(/);
});

test('shared desktop/mobile URL still identifies the actual media-qualified source slot',()=>{
 const h=harness((m,n)=>{m.asset_manifest[1].file_url=m.asset_manifest[0].file_url;n.mobile.attrs.srcset=n.img.src;});
 h.click(h.inventory.img);h.add('Desktop');h.context.innerWidth=390;h.click(h.inventory.img);h.add('Mobile');
 const p=JSON.parse(h.nodes.prompt.value.slice(h.nodes.prompt.value.indexOf('{')));assert.deepEqual(p.groups.map((g:any)=>g.element_ids),[['image:desktop'],['image:mobile']]);
});

test('outcome identity is exact and never rewritten as a fabricated task ID',()=>{
 const outcome=(m:any)=>{delete m.task_id;m.identity_type='outcome';m.outcome_id='library-real-artifact';};
 const h=harness(outcome);h.click(h.inventory.title);h.add('Edit outcome');
 const p=JSON.parse(h.nodes.prompt.value.slice(h.nodes.prompt.value.indexOf('{')));assert.equal(p.identity_type,'outcome');assert.equal(p.outcome_id,'library-real-artifact');assert.equal(p.task_id,undefined);
 const bad=harness(m=>{outcome(m);m.current_context={outcome_id:'other'};});assert.equal(bad.nodes.copy.disabled,true);
 const noId=harness(m=>{delete m.task_id;});assert.equal(noId.nodes.copy.disabled,true);
});

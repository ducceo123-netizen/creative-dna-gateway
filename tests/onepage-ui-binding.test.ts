import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bindOnepageUiTemplate, getOnepageUiTemplate } from '../onepage-ui-template.ts';
import { createApp, TOOL_DEFINITIONS } from '../server.ts';
const fixture = (faqCount?: number) => {
  const version = faqCount ? getOnepageUiTemplate().variants.faq : getOnepageUiTemplate().version;
  const template = getOnepageUiTemplate(version, 'source') as any;
  const slots = faqCount ? [...template.text_slots.filter((s: string) => !/^faq_(question|answer)_/.test(s)), ...Array.from({length: faqCount}, (_, i) => String(i + 1).padStart(2, '0')).flatMap(n => [`faq_question_${n}`, `faq_answer_${n}`])] : template.text_slots;
  return { version, template, bindings: { text: Object.fromEntries(slots.map((s: string) => [s, `Approved ${s}`])), assets: Object.fromEntries(template.asset_slots.map((s: string) => [s, `assets/${s}.webp`])), ...(faqCount ? {faq_count: faqCount} : {}) } };
};

test('binding preserves GTK source structure/CSS exactly while filling declared slots only', () => {
  const f = fixture();
  const result = bindOnepageUiTemplate(f.version, f.bindings);
  const values = {...f.bindings.assets,...f.bindings.text};
  assert.equal(result.html, f.template.html.replace(/\{\{([a-z0-9_]+)\}\}/g, (_: string, slot: string) => values[slot]));
  assert.equal(result.css, f.template.css);
  assert.equal(result.status, 'BOUND_REQUIRES_VISUAL_QA');
  assert.equal(result.visual_qc_performed, false);
  assert.equal(result.sha256.html, createHash('sha256').update(result.html).digest('hex'));
  assert.deepEqual(result.template_sha256, f.template.sha256);
  assert.doesNotMatch(result.html, /\{\{/);
});

test('caller copy is escaped text, never markup or replacement code', () => {
  const f = fixture();
  f.bindings.text.title_07 = '<h2>A Gift For Their Moments</h2> & "$&" {{title_01}}';
  f.bindings.assets.occasion_story_01 = 'https://assets.example/image.webp?x="&y=<svg>';
  const r = bindOnepageUiTemplate(f.version, f.bindings);
  assert.ok(r.html.includes('&lt;h2&gt;A Gift For Their Moments&lt;/h2&gt; &amp; &quot;$&amp;&quot; {{title_01}}'));
  assert.ok(r.html.includes('image.webp?x=&quot;&amp;y=&lt;svg&gt;'));
  assert.doesNotMatch(r.html, /<h2>A Gift/);
});

test('unmapped copy, missing slots, HTML/CSS input, fixed UI and bad asset references fail closed', () => {
  for (const change of [
    (b: any) => {b.text.occasion_heading='A Gift For Their Moments';},
    (b: any) => {b.text.occasion_support='Invented support';},
    (b: any) => {b.text.product_details_heading='New heading';},
    (b: any) => {delete b.text.title_07;},
    (b: any) => {b.text.title_07=' ';},
    (b: any) => {b.text.title_07={html:'<p>Markup</p>'};},
    (b: any) => {b.html='<h2>Extra</h2>';},
    (b: any) => {b.css='*{display:none}';},
    (b: any) => {b.faq_count=2;},
    (b: any) => {b.assets.ui_checkmark='bad.svg';},
    (b: any) => {delete b.assets.detail_main;},
    (b: any) => {b.assets=null;},
  ]) { const f=fixture(); change(f.bindings); assert.throws(()=>bindOnepageUiTemplate(f.version,f.bindings)); }
  for(const url of ['javascript:alert(1)','data:image/svg+xml,test','file:///tmp/a','//evil.example/a','/absolute/path','https://user:pass@example.test/a','https:\\evil.example/a','https://example.test/a\n']) {
    const f=fixture();f.bindings.assets.detail_main=url;assert.throws(()=>bindOnepageUiTemplate(f.version,f.bindings),url);
  }
  const f=fixture(); f.bindings.text=JSON.parse('{"__proto__":"malicious"}'); assert.throws(()=>bindOnepageUiTemplate(f.version,f.bindings));
});

test('FAQ repeats only source rows with unique IDs and all answers expanded; other sections remain byte exact', () => {
  const f=fixture(3); const r=bindOnepageUiTemplate(f.version,f.bindings);
  assert.equal((r.html.match(/data-faq-item=/g)||[]).length,3);
  assert.equal((r.html.match(/checked aria-label="Toggle FAQ answer"/g)||[]).length,3);
  for(const n of ['01','02','03']) {assert.ok(r.html.includes(`id="uid-faq-${n}"`));assert.ok(r.html.includes(`for="uid-faq-${n}"`));assert.ok(r.html.includes(`data-text-slot="faq_answer_${n}"`));}
  assert.doesNotMatch(r.html,/data-asset-slot="gtk_|uid-product-good-to-know|\{\{/);
  const marker='<div class="uid-product-content-faqs"';
  const values={...f.bindings.assets,...f.bindings.text};
  assert.equal(r.html.slice(0,r.html.indexOf(marker)),f.template.html.slice(0,f.template.html.indexOf(marker)).replace(/\{\{([a-z0-9_]+)\}\}/g,(_:string,s:string)=>values[s]));
  for(const count of [undefined,0,NaN,1.5,101]) assert.throws(()=>bindOnepageUiTemplate(f.version,{...f.bindings,faq_count:count}));
  assert.throws(()=>bindOnepageUiTemplate(f.version,{...f.bindings,text:{...f.bindings.text,title_11:'GTK leak'}}));
});

test('existing REST and MCP tool execute strict binding; legacy reads stay unchanged', async () => {
  const f=fixture();const app=createApp();const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try {
    const origin=`http://127.0.0.1:${(server.address() as any).port}`;
    const post=(path:string,input:any)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify(input)});
    const old=await post('/api/tools/get_onepage_ui_template',{}); assert.deepEqual(await old.json(),getOnepageUiTemplate());
    const good=await post('/api/tools/get_onepage_ui_template',{version:f.version,bindings:f.bindings});assert.equal(good.status,200);assert.equal((await good.json()).html,bindOnepageUiTemplate(f.version,f.bindings).html);
    const bad={...f.bindings,text:{...f.bindings.text,occasion_heading:'A Gift For Their Moments'}};
    assert.equal((await post('/api/tools/get_onepage_ui_template',{version:f.version,bindings:bad})).status,400);
    assert.equal((await post('/api/tools/get_onepage_ui_template',{format:'invalid',bindings:f.bindings})).status,400);
    const rpc=await post('/api/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_onepage_ui_template',arguments:{version:f.version,bindings:f.bindings}}});
    const body=await rpc.text();assert.ok(body.includes('BOUND_REQUIRES_VISUAL_QA'));assert.ok(body.includes('Approved title_07'));
    const denied=await post('/api/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_onepage_ui_template',arguments:{version:f.version,bindings:bad}}});assert.match(await denied.text(),/isError\\?":true/);
    const discovery:any=TOOL_DEFINITIONS.find(t=>t.name==='get_onepage_ui_template'); assert.ok(discovery.inputSchema.properties.bindings);assert.equal(discovery.inputSchema.properties.bindings.additionalProperties,false);
  } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

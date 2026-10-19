import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { attachOnepageUiTemplate, getOnepageUiTemplate, getTemplateFile, ONEPAGE_TEMPLATE_VERSION } from '../onepage-ui-template.ts';
import { compileOnepageJob, resolveCreativeDna, createApp } from '../server.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test('complete versioned template includes matching hashes, fonts, slots and fixed checkmarks', () => {
  const manifest = getOnepageUiTemplate();
  const source = getOnepageUiTemplate(undefined, 'source') as ReturnType<typeof getOnepageUiTemplate> & { html: string; css: string };
  assert.equal(sha(source.html), manifest.sha256.html);
  assert.equal(sha(source.css), manifest.sha256.css);
  assert.equal(manifest.asset_slots.length, 19);
  assert.equal(manifest.text_slots.length, 26);
  assert.ok(source.css.includes('data:font/woff2;base64,'));
  assert.ok(source.css.includes('border-radius: 100%'));
  assert.ok(source.css.includes('max-width: 798px'));
  assert.ok(source.html.includes('href="styles.css"'));
  assert.equal((source.html.match(/data-asset-slot="ui_checkmark"/g) || []).length, 3);
  assert.ok(source.html.includes('data:image/svg+xml;base64,'));
  assert.ok(!source.html.includes('assets/'));
  assert.ok(!JSON.stringify(manifest).includes('libfile_'));
  assert.equal(manifest.verification.pixel_parity, 'not_yet_verified');
  for (const slot of [...manifest.asset_slots, ...manifest.text_slots]) assert.ok(source.html.includes(`{{${slot}}}`), slot);
  assert.equal(getTemplateFile('missing', 'styles.css'), null);
  assert.equal(getTemplateFile(ONEPAGE_TEMPLATE_VERSION, '../server.ts'), null);
  assert.throws(() => getOnepageUiTemplate('missing'));
});

test('new canvas spacing retains the immutable original template and internal structure', () => {
  const old = getOnepageUiTemplate('2026-10-03.v1', 'source') as any;
  const current = getOnepageUiTemplate(undefined, 'source') as any;
  assert.equal(current.version, '2026-10-11.v3');
  const previous = getOnepageUiTemplate('2026-10-03.v2', 'source') as any;
  assert.equal(current.html, previous.html);
  assert.equal(current.css, previous.css);
  assert.match(current.qa, /onepage_\{product_slug\}-overall\.png/);
  assert.match(previous.qa, /WebP mapping/);
  assert.deepEqual(current.canvas_gutter, { desktop_px: 32, mobile_px: 16, mobile_max_width_px: 798 });
  assert.equal(current.html.replace('<body><div class="onepage-mapping-canvas">', '<body>').replace('</div></body>', '</body>'), old.html);
  assert.ok(current.css.startsWith(old.css));
  assert.equal(sha(old.html), old.sha256.html);
  assert.equal(sha(old.css), old.sha256.css);
  assert.equal(old.canvas_gutter, null);
  assert.equal(getTemplateFile('2026-10-03.v1', 'template.html')!.hash, old.sha256.html);
});

test('template attaches only to successful supported Onepage routes without overwriting product rules', () => {
  for (const brand of ['PawfectHouse', 'GiftSoul', 'SoulPrise']) {
    const original = { instruction: 'Keep product truth', hard_gates: ['exact product'] };
    const result = attachOnepageUiTemplate(original, brand, 'Onepage');
    assert.equal(result.ui_mapping_template.version, ONEPAGE_TEMPLATE_VERSION);
    assert.equal(result.hard_gates, original.hard_gates);
    assert.ok(result.instruction.includes('Keep product truth'));
    assert.equal(attachOnepageUiTemplate(original, brand, 'Home Hero'), original);
  }
  const unknown = { instruction: 'unchanged' };
  assert.equal(attachOnepageUiTemplate(unknown, 'UnknownBrand', 'Onepage'), unknown);
});

test('compiler and resolver include executable template; upstream errors stay errors', async () => {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  try {
    globalThis.fetch = async (_url: any, init: any) => {
      requests.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ resolved: { brand: 'pawfecthouse', branch: 'onepage-system' }, hard_gates: { product_truth: 'HARD' } }), { status: 200 });
    };
    const compiled = await compileOnepageJob('PawfectHouse', 'https://example.com/product', 'product', 'Christmas');
    assert.equal(compiled.data.ui_mapping_template.version, ONEPAGE_TEMPLATE_VERSION);
    assert.equal(requests[0].source_type, 'product');
    assert.equal(compiled.data.quality_execution_guard.reason, 'UPSTREAM_QUALITY_CONTRACT_MISSING');
    const resolved = await resolveCreativeDna('PawfectHouse', 'Onepage');
    assert.equal(resolved.data.ui_mapping_template.version, ONEPAGE_TEMPLATE_VERSION);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'upstream unavailable' }), { status: 503 });
    const failed = await compileOnepageJob('PawfectHouse');
    assert.equal(failed.status, 503);
    assert.equal(failed.ok, false);
    assert.equal(failed.data.ui_mapping_template, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('anonymous member HTTP and MCP template paths work without Library access or datastore calls', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const base = `${origin}/api/onepage-ui-template/${ONEPAGE_TEMPLATE_VERSION}`;
  try {
    const manifestResponse = await fetch(`${base}/manifest.json`);
    assert.equal(manifestResponse.status, 200);
    const manifest: any = await manifestResponse.json();
    const html = await fetch(`${base}/template.html`);
    assert.equal(html.status, 200);
    assert.equal(sha(await html.text()), manifest.sha256.html);
    assert.ok(html.headers.get('content-disposition')?.includes('attachment'));
    const cached = await fetch(`${base}/template.html`, { headers: { 'If-None-Match': html.headers.get('etag')! } });
    assert.equal(cached.status, 304);
    const css = await fetch(`${base}/styles.css`);
    assert.equal(css.status, 200);
    assert.equal(sha(await css.text()), manifest.sha256.css);
    const bundle: any = await (await fetch(`${base}/bundle.json`)).json();
    assert.ok(bundle.html && bundle.css);
    assert.equal((await fetch(`${origin}/api/onepage-ui-template/missing/template.html`)).status, 404);
    assert.equal((await fetch(`${base}/unknown.json`)).status, 404);
    const rpc = await fetch(`${origin}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    assert.equal(rpc.status, 200);
    assert.ok((await rpc.text()).includes('get_onepage_ui_template'));
    const call = await fetch(`${origin}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_onepage_ui_template', arguments: {} } }) });
    assert.equal(call.status, 200);
    assert.ok((await call.text()).includes(ONEPAGE_TEMPLATE_VERSION));
    const tool = await fetch(`${origin}/api/tools/get_onepage_ui_template`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(tool.status, 200);
    assert.equal((await tool.json() as any).version, ONEPAGE_TEMPLATE_VERSION);
    const invalid = await fetch(`${origin}/api/tools/get_onepage_ui_template`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"format":"invalid"}' });
    assert.equal(invalid.status, 400);
  } finally { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
});

test('future changed delivery policy cannot silently conflict with immutable current template metadata', () => {
  const data={resolved:{brand:'pawfecthouse',branch:'onepage-system'},creative_quality_contract:{schema_version:'uid-creative-quality/1',compiler_version:'2026-10-11-v2',revision:'test',route:{brand:'pawfecthouse',branch:'onepage-system'},contract_hash:'a'.repeat(64),status:'COMPILED',rules:[{id:'delivery',key:'delivery.mapping_format',instruction:'approved',value:'WEBP'}],errors:[],gates:{content_authoring:'READY_WITH_SOURCE_RESEARCH',asset_generation:'REQUIRES_PRODUCT_AND_REFERENCE_PIXEL_INSPECTION',human_artistic_review:'REQUIRED',identical_pixels_guaranteed:false},reference_gate:{status:'NO_REQUIRED_STYLE_REFERENCES'}}};
  const attached=attachOnepageUiTemplate(data,'PawfectHouse','Onepage');
  assert.equal(attached.template_policy_compatibility.status,'BLOCKED_POLICY_TEMPLATE_MISMATCH');
  assert.equal(attached.template_policy_compatibility.stage,'mapping');
});

test('gateway blocks malformed, partial, unsupported and wrong-route quality envelopes', () => {
  for (const contract of [
    {schema_version:'uid-creative-quality/1',contract_hash:''},
    {schema_version:'uid-creative-quality/1',contract_hash:'a'.repeat(64),status:'COMPILED'},
    {schema_version:'uid-creative-quality/next',contract_hash:'a'.repeat(64),status:'COMPILED'},
    {schema_version:'uid-creative-quality/1',rules:{}},
    {schema_version:'uid-creative-quality/1',rules:'bad'},
    {schema_version:'uid-creative-quality/1',rules:[null]},
  ]) {
    const attached=attachOnepageUiTemplate({creative_quality_contract:contract},'PawfectHouse','Onepage');
    assert.equal(attached.quality_execution_guard.status,'BLOCKED');assert.equal(attached.quality_execution_guard.reason,'UPSTREAM_QUALITY_CONTRACT_INVALID');
  }
});

test('FAQ variant has matching source hashes and no GTK assets or hidden answers', () => {
  const gtk = getOnepageUiTemplate(undefined, 'source') as any;
  const faq = getOnepageUiTemplate(gtk.variants.faq, 'source') as any;
  assert.equal(faq.post_story_section, 'faq');
  assert.equal(sha(faq.html), faq.sha256.html);
  assert.equal(sha(faq.css), faq.sha256.css);
  assert.equal(faq.css, gtk.css, 'reuse the captured responsive store CSS');
  assert.ok(faq.html.includes('uid-product-content-faqs'));
  assert.ok(!faq.html.includes('uid-product-good-to-know'));
  assert.ok(!faq.asset_slots.some((s: string) => s.startsWith('gtk_')));
  assert.ok(!faq.html.includes('data-asset-slot="ui_checkmark"'));
  for (const slot of [...faq.asset_slots, ...faq.text_slots]) assert.ok(faq.html.includes(`{{${slot}}}`), slot);
  assert.ok(faq.faq_binding);
  assert.match(JSON.stringify(faq.faq_binding), /expanded/i);
  assert.equal(gtk.post_story_section, 'gtk');
  assert.ok(gtk.html.includes('uid-product-good-to-know'));
  assert.equal(getTemplateFile(faq.version, 'template.html')!.hash, faq.sha256.html);
});

test('FAQ capability clears only the legacy missing-template gate, preserving decision and research gates', () => {
  const original = { post_story_section: { decision: 'PRODUCT_ADAPTIVE_GTK_OR_FAQ', faq_template_status: 'REQUIRED_NOT_YET_DEPLOYED', faq_mapping_gate: 'BLOCK_MAPPING_UNTIL_VERIFIED_FAQ_VARIANT_AVAILABLE', faq_answers: 'ALL_EXPANDED_FOR_REVIEW', rule: 'Choose from actual buyer questions' }, readiness: { content_authoring: 'BLOCKED' } };
  const out = attachOnepageUiTemplate(original, 'PawfectHouse', 'Onepage');
  assert.equal(out.post_story_section.faq_template_status, 'AVAILABLE_IN_GATEWAY');
  assert.equal(out.post_story_section.decision, original.post_story_section.decision);
  assert.equal(out.post_story_section.faq_answers, 'ALL_EXPANDED_FOR_REVIEW');
  assert.equal(out.readiness.content_authoring, 'BLOCKED');
  assert.equal(out.quality_execution_guard.status, 'BLOCKED');
  assert.equal(out.template_policy_compatibility.status, 'BLOCKED_QUALITY_CONTRACT');
  assert.equal(out.ui_mapping_templates.faq.post_story_section, 'faq');
  assert.equal(out.ui_mapping_templates.gtk.post_story_section, 'gtk');
  assert.equal(original.post_story_section.faq_template_status, 'REQUIRED_NOT_YET_DEPLOYED');
});

test('FAQ version is retrievable through HTTP and MCP without any schema or write change', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const version = getOnepageUiTemplate().variants.faq;
  try {
    for (const file of ['template.html', 'styles.css', 'bundle.json', 'manifest.json']) assert.equal((await fetch(`${origin}/api/onepage-ui-template/${version}/${file}`)).status, 200);
    const result = await fetch(`${origin}/api/tools/get_onepage_ui_template`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({version}) });
    assert.equal((await result.json() as any).post_story_section, 'faq');
    const call = await fetch(`${origin}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_onepage_ui_template',arguments:{version}}}) });
    assert.equal(call.status, 200); assert.match(await call.text(), /post_story_section/);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

test('FAQ replacement preserves every byte outside the post-story block and all legacy hashes', async () => {
  const {replacePostStorySection} = await import('../onepage-faq-template.ts');
  const old = getOnepageUiTemplate('2026-10-03.v1', 'source') as any;
  const gtk = getOnepageUiTemplate(undefined, 'source') as any;
  const faq = getOnepageUiTemplate(gtk.variants.faq, 'source') as any;
  assert.equal(old.sha256.html, 'cc9bf2273b1ef6884d971e88de2be60e6f9e4626a9a4353e5968cf8aa3deaba1');
  assert.equal(old.sha256.css, '64fabb02eb74140007830642cbb590b042b5fb256761cddc764c976b1cea770f');
  assert.equal(gtk.sha256.html, 'fdab769e0b48f1b49abf1b558b4230eb36cc12b0e2b2e4264bf5a03478bbb4ad');
  assert.equal(gtk.sha256.css, '4671a41229fe5b3704d2825661f5ef1f7087500e513ddd2eb21eea3877291154');
  const marker = '<div class="uid-product-good-to-know">';
  const prefix = gtk.html.slice(0, gtk.html.indexOf(marker));
  assert.ok(faq.html.startsWith(prefix));
  const withMarker = replacePostStorySection(gtk.html, '<!-- post-story -->');
  const suffix = withMarker.slice(withMarker.indexOf('<!-- post-story -->') + '<!-- post-story -->'.length);
  assert.ok(faq.html.endsWith(suffix));
  assert.throws(() => replacePostStorySection('<div>no section</div>', ''), /Expected one/);
  assert.throws(() => replacePostStorySection(marker + marker + '</div></div>', ''), /Expected one/);
  assert.throws(() => replacePostStorySection(marker + '<div>', ''), /Unbalanced/);
  assert.match(faq.html, /type="checkbox" hidden[^>]*checked/);
  assert.match(faq.css, /product-tabs__radio:checked \+ \.uid-faqs-question \+ \.uid-faqs-answer\s*\{\s*display: block/);
  assert.equal(faq.verification.source_capture, 'reconstructed_from_verified_store_css');
  assert.equal(faq.verification.pixel_parity, 'not_claimed_no_live_faq_dom_found');
});

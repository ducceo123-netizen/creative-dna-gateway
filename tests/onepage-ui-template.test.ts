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

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PREVIEW_SCRIPT} from '../uid-ldp-html-preview.ts';
const html=readFileSync(new URL('../public/ldp-feedback-demo.html',import.meta.url),'utf8');
test('public demo is labelled synthetic, self-contained and uses current copy-only interaction script',()=>{
 assert.ok(html.includes('SYNTHETIC INTERACTION DEMO ONLY'));
 assert.ok(html.includes('Not approved brand layout or real task'));
 const embedded=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
 // Bun rewrites non-ASCII String.raw literals; guard exact source on every runtime,
 // and exact generated production bytes on Node (Render runtime).
 const source=readFileSync(new URL('../uid-ldp-html-preview.ts',import.meta.url),'utf8');
 const raw=source.match(/export const PREVIEW_SCRIPT=String.raw`([\s\S]*?)`;/)![1];
 assert.equal(embedded,raw);
 if(!process.versions.bun)assert.equal(embedded,PREVIEW_SCRIPT);
 assert.ok(html.includes("img-src data:"));
 assert.ok(html.includes("connect-src 'none'"));
 assert.equal(/<img[^>]+src="https?:/i.test(html),false);
 assert.equal(/<script[^>]+src=/i.test(html),false);
 assert.equal(/href="https?:/i.test(html),false);
 const json=html.match(/<script type="application\/json" id="manifest">([\s\S]*?)<\/script>/)![1];const manifest=JSON.parse(json);
 assert.match(manifest.task_id,/synthetic/);
 assert.equal(manifest.renderer_version,'uid-ldp-html-renderer/1');
 assert.equal(new Set(manifest.elements.map((e:any)=>e.id)).size,manifest.elements.length);
 assert.ok(manifest.asset_manifest.every((a:any)=>a.file_url.startsWith('https://assets.example/')));
});

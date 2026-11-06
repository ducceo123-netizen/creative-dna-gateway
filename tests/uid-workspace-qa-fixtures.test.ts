import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from '../tools/creative-quality/sharp.ts';
import { createQaPng, QA_SLOTS } from '../scripts/quality/workspace-browser-qa-assets.mjs';
test('portable synthetic QA PNGs are valid deterministic real rasters with explicit synthetic slots', async () => {
  assert.equal(QA_SLOTS.length,18);
  for (const slot of ['banner_desktop','banner_mobile','occasion_icon_01']) {
    const bytes = createQaPng(slot,'current'); assert.deepEqual(bytes,createQaPng(slot,'current')); assert.notDeepEqual(bytes,createQaPng(slot,'before'));
    const {info} = await sharp(bytes,{failOn:'warning'}).raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,slot==='banner_desktop'?1280:640); assert.equal(info.height,slot==='banner_desktop'?600:slot==='banner_mobile'?760:640);
    assert.ok(bytes.length < 100_000);
  }
  assert.throws(()=>createQaPng('../private','current'),/INVALID_SYNTHETIC_FIXTURE/);
  assert.throws(()=>createQaPng('detail_main','live'),/INVALID_SYNTHETIC_FIXTURE/);
});

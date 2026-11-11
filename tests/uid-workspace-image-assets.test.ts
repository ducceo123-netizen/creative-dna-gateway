import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from '../tools/creative-quality/sharp.ts';
import { createWorkspaceOnepageImageAssets, type WorkspaceAssetSizingStrategy, type WorkspaceImageAssetsOptions } from '../uid-workspace-image-assets.ts';
import { createWorkspaceOperationJournal } from '../uid-workspace-operations.ts';
import { MemoryWorkspaceStore, type WorkspaceRecord } from '../uid-workspace-store.ts';
import { createWorkspaceTask } from '../uid-workspace-task.ts';
import { workspaceContentDigest, type WorkspaceStageContext } from '../uid-workspace-runner.ts';
import { workspaceObjectKey, type WorkspaceObjectIdentity, type WorkspacePrivateObjectStore } from '../uid-workspace-artifacts.ts';
import { ONEPAGE_DELIVERY_ROLES } from '../supabase/functions/_shared/onepage-packaging.ts';
import type { WorkspaceOnepageOptions } from '../uid-workspace-onepage.ts';
import type { WorkspaceImageRequest } from '../uid-workspace-image.ts';
import { NOW, before, later, sha } from './helpers/workspace-provider-fixture.ts';
type Input = Parameters<NonNullable<WorkspaceOnepageOptions['generateAssets']>>[1];
// Synthetic product/policy/provider data. Uses real byte decode/private read and
// the actual child journal; does NOT establish live quality, pricing or EO.
async function fixture(feedback = true, size = '256x256') {
  const store = new MemoryWorkspaceStore(), data = new Map<string, Uint8Array>(), calls: WorkspaceImageRequest[] = [];
  const source = new Uint8Array(await sharp({ create: { width: 256, height: 256, channels: 3, background: '#aa5500' } }).png().toBuffer());
  const old = new Uint8Array(await sharp({ create: { width: 256, height: 256, channels: 3, background: '#aa0000' } }).webp().toBuffer());
  const content = { revision: 'content-one', slots: { title_01: 'Verified fixture product', description_01: 'Approved fixture copy' } };
  let task = createWorkspaceTask('task-one', { snapshot_id: 'snapshot-one', canonical_version: 'canonical-fixture', content_revision: content.revision, content_digest: workspaceContentDigest(content.slots), assets: feedback ? [{ asset_id: 'asset-detail', canonical_slot: 'detail_main', revision_id: 'old-revision', content_revision: content.revision, label: 'Detail main' }] : [] });
  task = { ...task, approval: { content_revision: content.revision, content_digest: task.snapshot.content_digest } as typeof task.approval };
  const oldIdentity = { owner_id: 'alice', task_id: 'task-one', storage_key: workspaceObjectKey('alice', 'task-one', sha(old)), sha256: sha(old), size_bytes: old.length, media_type: 'image/webp' }; data.set(oldIdentity.storage_key, old);
  const action = { action_id: 'action-one', idempotency_key: 'test-action-one', fingerprint: 'test', type: feedback ? 'feedback' : 'approve_content', payload: {}, status: 'running', expected_state_version: task.state_version, content_revision: content.revision, created_at: before, actor_id: 'alice' } as WorkspaceRecord['actions'][number];
  const run: WorkspaceStageContext['run'] = { run_id: 'run-one', action_id: action.action_id, stage: feedback ? 'asset_feedback' : 'assets', operation_id: 'stage-operation', expected_state_version: task.state_version, snapshot_id: task.snapshot.snapshot_id, content_revision: content.revision, fence: 1, status: 'in_flight', lease_owner: 'fixture', lease_expires_at: later, created_at: before, updated_at: before };
  const record: WorkspaceRecord = { owner_id: 'alice', task, content, brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://store.example/product' }, created_at: before, updated_at: before, actions: [action], events: [], artifacts: feedback ? [{ ...oldIdentity, artifact_id: 'old-artifact', revision_id: 'old-revision', filename: 'detail.webp', kind: 'image', verification: 'verified', content_revision: content.revision, width: 256, height: 256 }] : [], preview: null, review_manifest: null, quality: [], runs: [run] };
  await store.transaction('alice', state => { state.tasks.push(structuredClone(record)); });
  const c: WorkspaceStageContext = { owner_id: 'alice', record, action, run, signal: new AbortController().signal, ...(feedback ? { feedback: { groups: [{ instruction: 'Keep product exact. Make the scene warmer.', assets: [{ canonical_slot: 'detail_main', artifact_revision: 'old-revision', sha256: sha(old) }], text_slots: [] }] } } : {}) };
  const scope = { owner_id: c.owner_id, task_id: task.task_id, canonical_version: task.snapshot.canonical_version, source_url: record.brief.source_url, snapshot_id: task.snapshot.snapshot_id, state_version: task.state_version, content_revision: content.revision, operation_id: 'research-operation', stage: 'research' };
  const objects: WorkspacePrivateObjectStore = { kind: 'fixture', productionReady: false, loopbackOnly: true, async put(o, bytes) { const parts = []; for await (const b of bytes) parts.push(Buffer.from(b)); data.set(o.storage_key, Buffer.concat(parts)); }, async open(o) { const b = data.get(o.storage_key); return b ? { stream: (async function*() { yield Uint8Array.from(b); })(), async dispose() {} } : null; }, async remove() {} };
  const operations = createWorkspaceOperationJournal({ store, authorizeOwner: async () => true, now: () => NOW });
  const slots = Object.keys(ONEPAGE_DELIVERY_ROLES).filter(s => !s.startsWith('gtk_'));
  const input = { packet: { creative_quality_contract: { status: 'COMPILED', contract_hash: 'a'.repeat(64), rules: [] }, dynamic_job: { source_url: record.brief.source_url }, acquisition_contract: { min_verified_designs: 1 }, assets: slots.map(slot => ({ slot, size: slot === 'detail_main' ? size : '256x256', role: 'fixture' })), hard_gates: { product_physical_truth: 'HARD' } }, content,
    slots: feedback ? ['detail_main'] : slots,
    research: { product_line_name: 'Fixture Product', product_slug: 'fixture_product', acquisition_refs: ['research:fixture'], source_bindings: [{ source_id: 'pdp-one', evidence_ref: 'research:pdp-one', sha256: 'b'.repeat(64), item_ids: ['photo-one'] }], research: {
      scope: { products: [{ id: 'product-one' }] }, sources: [{ id: 'pdp-one', kind: 'target_pdp', match: 'exact', status: 'inspected', product_ids: ['product-one'], pdp_coverage: { gallery: { items: [{ id: 'photo-one', status: 'inspected' }] }, details: { items: [] } } }],
      claims: [{ id: 'claim-one', text: 'Fixture verified claim', product_ids: ['product-one'] }], analysis: { content_plan: { post_story: { mode: 'faq' }, details: { anchor_product_id: 'product-one' } } },
    } } } as unknown as Input;
  const config: WorkspaceImageAssetsOptions = { objects, operations, budgetCapMicrousd: 5000, sizingStrategies: [], async writeRunArtifact(ctx, identity, stream) { assert.equal(ctx.owner_id, identity.owner_id); const parts = []; for await (const bytes of stream) parts.push(Buffer.from(bytes)); const buffer = Buffer.concat(parts); assert.equal(sha(buffer), identity.sha256); data.set(identity.storage_key, buffer); return identity; },
    async reopenResearchEvidence() { return { sources: [{ evidence_ref: 'source:photo-one', sha256: sha(source), size_bytes: source.length, media_type: 'image/png', scope, requested_url: 'https://store.example/photo.png', final_url: 'https://store.example/photo.png', captured_at: before, semantic_inspection: 'not_performed', bytes: source }], bindings: [{ ...input.research.source_bindings[0], items: [{ item_id: 'photo-one', evidence_ref: 'source:photo-one', sha256: sha(source) }] }], envelopes: [] }; },
    async submit(ctx, request) {
      calls.push(structuredClone({ ...request, signal: undefined })); const fingerprint = sha(request.prompt);
      await ctx.bindProviderOperation!({ provider: 'openai-images', reservation_id: 'reservation:' + calls.length, request_sha256: fingerprint }); await operations.guardDispatch(ctx);
      const [width, height] = request.size.split('x').map(Number); const bytes = new Uint8Array(await sharp({ create: { width, height, channels: 3, background: '#0055aa' } }).webp().toBuffer());
      return { outcome: 'completed', submission: 'submitted', code: 'COMPLETED_UNTRUSTED', accounting: 'settled', reconciliation_required: false, request_sha256: fingerprint, reservation_id: 'reservation:' + calls.length, budget_receipt_id: 'receipt:' + calls.length, provider_request_id: 'provider:' + calls.length,
        output: { bytes, sha256: sha(bytes), mime_type: 'image/webp', width, height, trust: 'untrusted_model_output', qc_verified: false } };
    } };
  return { c, input, config, calls, data, store, old, source, adapter: createWorkspaceOnepageImageAssets(config) };
}

test('feedback is exact original-first image edit with retained PDP pixels and verbatim group instructions', async () => {
  const f = await fixture(), result = await f.adapter.generateAssets(f.c, f.input); assert.deepEqual(result.map(a => a.canonical_slot), ['detail_main']); assert.equal(f.calls.length, 1); const request = f.calls[0];
  assert.equal(request.operation, 'edit'); assert.equal(request.output_format, 'webp'); assert.equal(request.n, 1); assert.equal(request.source_images[0].sha256, sha(f.old)); assert.equal(request.source_images[1].sha256, sha(f.source)); assert.ok(request.prompt.includes(f.c.feedback!.groups[0].instruction));
  const children = await f.store.read('alice', state => state.tasks[0].runs![0].child_operations!); assert.equal(children.length, 1); assert.equal(children[0].status, 'completed'); assert.ok(children[0].report!.evidence_refs.some(ref => ref.startsWith('image-receipt:'))); assert.equal(children[0].provider_binding!.provider, 'openai-images');
});
test('full FAQ inventory creates independent slot operations; mobile sees actual desktop creative', async () => {
  const f = await fixture(false); const result = await f.adapter.generateAssets(f.c, f.input); assert.equal(result.length, 15); assert.equal(f.calls.length, 15); assert.equal(new Set(f.calls.map(c => c.operation_id)).size, 15); assert.ok(!result.some(a => a.canonical_slot.startsWith('gtk_')));
  const mobile = f.calls.find(c => c.prompt.includes('"target_slot":"banner_mobile"'))!; const desktop = result.find(a => a.canonical_slot === 'banner_desktop')!; assert.equal(mobile.source_images.at(-1)!.sha256, sha(desktop.bytes));
  assert.ok(f.data.size >= 16, 'Paid output and per-slot receipt retained before continuing');
});
test('missing canonical sizing strategy blocks entire batch before spending', async () => {
  const f = await fixture(false, '950x950'); await assert.rejects(() => f.adapter.generateAssets(f.c, f.input), /ASSET_REVIEWED_FITTING_STRATEGY_REQUIRED/); assert.equal(f.calls.length, 0);
});
test('reviewed same-aspect downscale yields exact canonical WebP without crop', async () => {
  const f = await fixture(true, '950x950'); const sizing: WorkspaceAssetSizingStrategy = { evidence_ref: 'reviewed-fitting', canonical_contract_sha256: 'a'.repeat(64), canonical_slot: 'detail_main', canonical_size: '950x950', provider_size: '1024x1024', mode: 'same_aspect_downscale' };
  const output = await createWorkspaceOnepageImageAssets({ ...f.config, sizingStrategies: [sizing] }).generateAssets(f.c, f.input); const meta = await sharp(output[0].bytes).metadata(); assert.equal(meta.width, 950); assert.equal(meta.height, 950); assert.equal(meta.format, 'webp'); assert.equal(f.calls[0].size, '1024x1024');
});
test('crop, stretch, upscale, wrong pinned contract and missing icon display evidence are blocked', async () => {
  for (const [target, provider] of [['950x950', '1536x1024'], ['950x950', '512x512']]) {
    const f = await fixture(true, target), strategy: WorkspaceAssetSizingStrategy = { evidence_ref: 'review', canonical_contract_sha256: 'a'.repeat(64), canonical_slot: 'detail_main', canonical_size: target, provider_size: provider, mode: 'same_aspect_downscale' };
    await assert.rejects(() => createWorkspaceOnepageImageAssets({ ...f.config, sizingStrategies: [strategy] }).generateAssets(f.c, f.input), /ASSET_CROP_STRETCH_UPSCALE_FORBIDDEN/); assert.equal(f.calls.length, 0);
  }
  const f = await fixture(false); f.input.packet.assets.find(a => a.slot === 'occasion_icon_01')!.size = '3x_UI_DISPLAY_SIZE'; await assert.rejects(() => f.adapter.generateAssets(f.c, f.input), /ASSET_ICON_DISPLAY_EVIDENCE_REQUIRED/); assert.equal(f.calls.length, 0);
});
test('exact slot inventory, approved content and selected original identity are mandatory', async () => {
  const a = await fixture(); a.input.slots.push('detail_01'); await assert.rejects(() => a.adapter.generateAssets(a.c, a.input), /ASSET_EXACT_SLOT_SCOPE_REQUIRED/);
  const b = await fixture(); b.input.content.slots.title_01 = 'unapproved'; await assert.rejects(() => b.adapter.generateAssets(b.c, b.input), /ASSET_APPROVED_CONTENT_REQUIRED/);
  const c = await fixture(); c.c.feedback!.groups[0].assets![0].sha256 = '0'.repeat(64); await assert.rejects(() => c.adapter.generateAssets(c.c, c.input), /ASSET_FEEDBACK_ORIGINAL_REQUIRED/);
  assert.equal(a.calls.length + b.calls.length + c.calls.length, 0);
});
test('corrupt/missing actual product pixels and overlarge inputs never degrade to text-only generation', async () => {
  const f = await fixture(), open = f.config.reopenResearchEvidence; const adapter = createWorkspaceOnepageImageAssets({ ...f.config, async reopenResearchEvidence(...args) { const e = await open(...args); e.sources[0].bytes = new Uint8Array([0]); return e; } });
  await assert.rejects(() => adapter.generateAssets(f.c, f.input), /ASSET_RETAINED_SOURCE_SCOPE|ASSET_SOURCE_INTEGRITY/); assert.equal(f.calls.length, 0);
});
test('unsettled image accounting stops entire batch and never creates an approved artifact', async () => {
  const f = await fixture(false), submit = f.config.submit; const adapter = createWorkspaceOnepageImageAssets({ ...f.config, async submit(...args) { const result = await submit(...args); return { ...result, accounting: 'held', reconciliation_required: true }; } });
  await assert.rejects(() => adapter.generateAssets(f.c, f.input), /ASSET_PROVIDER_OPERATION_UNSETTLED/); assert.equal(f.calls.length, 1);
  const children = await f.store.read('alice', state => state.tasks[0].runs![0].child_operations!); assert.equal(children[0].status, 'unknown'); assert.equal(children[0].report?.accounting, 'held');
});
test('provider output dimension mismatch is held as unknown after raw bytes retained, without retry', async () => {
  const f = await fixture(), submit = f.config.submit; const adapter = createWorkspaceOnepageImageAssets({ ...f.config, async submit(ctx, request) { return submit(ctx, { ...request, size: '512x512' }); } });
  await assert.rejects(() => adapter.generateAssets(f.c, f.input), /ASSET_PROVIDER_OPERATION_UNSETTLED/); assert.equal(f.calls.length, 1); assert.ok(f.data.size > 1);
  await assert.rejects(() => adapter.generateAssets(f.c, f.input), /ASSET_PROVIDER_OPERATION_UNSETTLED/); assert.equal(f.calls.length, 1);
});
test('cancelled work submits no images', async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort(); await assert.rejects(() => f.adapter.generateAssets({ ...f.c, signal: controller.signal }, f.input), /ASSET_GENERATION_CANCELLED/); assert.equal(f.calls.length, 0);
});

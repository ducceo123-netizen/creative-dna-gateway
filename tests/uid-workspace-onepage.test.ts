import test from 'node:test';
import { createWorkspaceOperationJournal } from '../uid-workspace-operations.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from '../tools/creative-quality/sharp.ts';
import { createWorkspaceOnepageAdapters, type WorkspaceOnepageOptions, type WorkspaceOnepageResearch } from '../uid-workspace-onepage.ts';
import { createWorkspaceTask } from '../uid-workspace-task.ts';
import { createWorkspaceRunner, type WorkspaceStageContext, type WorkspaceRunnerStage } from '../uid-workspace-runner.ts';
import { MemoryWorkspaceStore, type WorkspaceRecord, type WorkspaceActionRecord } from '../uid-workspace-store.ts';
import { sourceHashes, QUALITY_SCHEMA, type QualityRule } from '../supabase/functions/_shared/creative-quality.ts';
import { workspaceObjectKey } from '../uid-workspace-artifacts.ts';
import type { WorkspaceRuntimeServices } from '../uid-workspace-runtime.ts';
import { WorkspaceResearchError } from '../uid-workspace-research.ts';

// All sources, provider replies and QC approvals below are SYNTHETIC test doubles.
// They test local orchestration, bytes and fail-closed boundaries, not live EO.
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const date = '2026-10-01T12:00:00Z', url = 'https://store.example/products/a';
async function dna() {
  const resolved = { brand: { slug: 'pawfecthouse' }, branch: { slug: 'onepage-system', version: 'test', content_md: 'Synthetic canonical test rule source.', metadata: {} as Record<string, unknown> }, brand_dna: { slug: 'brand-dna', version: 'test', content_md: 'Synthetic warm factual style.', metadata: {} } };
  const categories: QualityRule['category'][] = ['content', 'typography', 'banner', 'proof', 'brand_style', 'delivery', 'workflow'];
  const rules: QualityRule[] = categories.map(category => ({ id: 'rule-' + category, key: category === 'brand_style' ? 'brand.active_expression' : category, value: category, instruction: 'Synthetic ' + category, category, scope: { brands: ['pawfecthouse'], branches: ['onepage-system'] }, sources: [{ node: category === 'brand_style' ? 'brand_dna' : 'branch', locator: 'test' }] }));
  const delivery = rules.find(r => r.category === 'delivery')!; delivery.key = 'delivery.mapping_format'; delivery.value = 'PNG';
  rules.push({ ...delivery, id: 'final-package', key: 'delivery.final_package', value: 'WEBP_ASSETS_PLUS_ONE_PNG_MAPPING' });
  resolved.branch.metadata.creative_quality_contract = { schema_version: QUALITY_SCHEMA, revision: 'test-1', source_hashes: await sourceHashes(resolved), rules, references: [] };
  return resolved;
}
function research(mode: 'gtk' | 'faq' = 'gtk'): WorkspaceOnepageResearch {
  const claims = ['material', 'fit', 'care'].map(id => ({ id, text: `Synthetic ${id} fact.`, kind: 'product_fact', scope: 'sku', product_ids: ['a'], source_ids: ['pdp'], evidence_items: [{ source_id: 'pdp', item_id: 'detail' }], qualified: false }));
  return { product_line_name: 'Travel Case', product_slug: 'travel_case', acquisition_refs: ['test-source:1'], source_bindings: [{ source_id: 'pdp', evidence_ref: 'test-source:1', sha256: sha('synthetic source bytes'), item_ids: ['detail'] }], ...(mode === 'faq' ? { faq_count: 2 } : {}), research: {
    schema_version: 'uid-product-research/1', scope: { source_url: url, source_type: 'product', products: [{ id: 'a', url, variant: 'selected' }], inventory_complete: true, coverage_note: 'Synthetic exact product.' }, claims,
    sources: [{ id: 'pdp', url, kind: 'target_pdp', status: 'inspected', observed_at: date, product_ids: ['a'], match: 'exact', product_versions: { a: 'selected' }, excerpts: ['Synthetic source.'],
      sections: ['description', 'specifications', 'options', 'care_use'].map(name => ({ name, status: 'inspected', note: 'Synthetic section.' })),
      pdp_coverage: { schema_version: 'uid-pdp-coverage/1', inventory_complete: true, enumeration_note: 'Synthetic full enumeration.', gallery: { discovered_count: 0, items: [] }, details: { discovered_count: 1, items: [{ id: 'detail', label: 'Specs', variant: 'selected', status: 'inspected', method: 'source_text', observation: 'Synthetic detail facts.' }] } } }],
    coverage: ['target_pdp', 'target_reviews', 'marketplace', 'competitor', 'supplier'].map(category => ({ category, status: category === 'target_pdp' ? 'inspected' : 'not_found', source_ids: category === 'target_pdp' ? ['pdp'] : [], notes: 'Synthetic bounded source coverage.' })),
    pinterest_research: { schema_version: 'pinterest-visual-research/1', scope: { source_url: url, product: 'Travel Case', theme_topic: 'Travel', market: 'US' }, searches: [{ query: 'Travel case', observed_at: date, status: 'not_found', limitations: ['Synthetic no result.'] }], references: [] },
    reddit_research: { schema_version: 'reddit-customer-research/1', scope: { source_url: url, product: 'Travel Case', buyer: 'unknown', recipient: 'unknown', occasion: 'Travel', market: 'US' }, searches: [{ id: 'reddit-1', query: 'Travel case pros cons', observed_at: date, status: 'not_found', sort_order: 'unknown', filters: [], threads_inspected: 0, comments_inspected: 0, limitations: ['Synthetic no result.'] }], observations: [], insights: [] },
    analysis: { unknowns: [], conflicts: [], insights: claims.map(c => ({ concern: `How does ${c.id} affect selection?`, implication: `Consider verified ${c.id}.`, claim_ids: [c.id], section: mode })), content_plan: {
      schema_version: 'uid-onepage-content-plan/1', banner: { product_keyword: 'Travel Case', keyword_source_ids: ['pdp'], desktop_title: 'Travel Case', mobile_title: 'Travel Case', desktop_support: 'A separate synthetic sentence.', mobile_support: '', subtitle: '' },
      post_story: { mode, rationale: 'Three grounded practical facts support this selected section.', alternative_rejected_reason: 'The alternative would repeat facts without meaningful extra explanation.', source_ids: ['pdp'], insight_indexes: mode === 'gtk' ? [0, 1, 2] : [0, 1] },
      details: { anchor_product_id: 'a', items: claims.map((c, i) => ({ slot: `detail_0${i + 1}`, claim_ids: [c.id], visible_proof: `Distinct ${c.id} closeup.` })) },
    } },
  } };
}
let sequence = 0;
function addAction(record: WorkspaceRecord, type: WorkspaceActionRecord['type'], payload: unknown = {}) {
  const action: WorkspaceActionRecord = { action_id: 'action-' + ++sequence, idempotency_key: 'key-' + sequence, fingerprint: 'fp-' + sequence, type, payload, status: 'queued', expected_state_version: record.task.state_version, content_revision: record.task.snapshot.content_revision, created_at: date, actor_id: record.owner_id };
  record.actions.push(action); record.task = { ...record.task, state_version: record.task.state_version + 1 }; return action;
}
function record(): WorkspaceRecord {
  const r: WorkspaceRecord = { owner_id: 'owner-1', task: createWorkspaceTask('task-1', { snapshot_id: 'brief-1', canonical_version: 'unresolved', content_revision: 'brief-1', content_digest: sha('brief'), assets: [] }), brief: { brand: 'PawfectHouse', material: 'onepage', source_url: url }, created_at: date, updated_at: date, actions: [], events: [], artifacts: [], review_manifest: null, preview: null, content: null, quality: [] };
  addAction(r, 'start'); return r;
}
function context(r: WorkspaceRecord, stage: WorkspaceRunnerStage): WorkspaceStageContext {
  return { owner_id: r.owner_id, record: structuredClone(r), action: r.actions.at(-1)!, run: { run_id: 'run-' + ++sequence, action_id: r.actions.at(-1)!.action_id, stage, operation_id: 'operation-' + sequence, expected_state_version: r.task.state_version, snapshot_id: r.task.snapshot.snapshot_id, content_revision: r.task.snapshot.content_revision, fence: 1, status: 'in_flight', lease_owner: 'test', lease_expires_at: date, created_at: date, updated_at: date }, signal: new AbortController().signal };
}
async function fixture(mode: 'gtk' | 'faq' = 'gtk') {
  const store = new MemoryWorkspaceStore(); await store.transaction('owner-1', state => { state.tasks.push(record()); });
  const bytes = new Map<string, Uint8Array>(), reviews = new Map<string, string>();
  const calls = { submit: 0, generated: 0, mapping: 0, resolve: 0 };
  let rawOutput: string | undefined, rejectReview = false, corruptRead = false;
  const artifacts: NonNullable<WorkspaceRuntimeServices['artifacts']> = {
    async putArtifact(owner, task, value) { const sha256 = sha(value), storage_key = workspaceObjectKey(owner, task, sha256); bytes.set(storage_key, new Uint8Array(value)); return { storage_key, sha256, size_bytes: value.length }; },
    async readArtifact(r, a) { assert.ok(r.artifacts.some(item => item.artifact_id === a.artifact_id)); const value = bytes.get(a.storage_key); assert.ok(value); return corruptRead ? new Uint8Array([0]) : new Uint8Array(value); },
    async putArtifactStream() { throw new Error('Not used by bounded fixture'); },
  };
  const services: Pick<WorkspaceRuntimeServices, 'artifacts' | 'submitText' | 'writeRunArtifact' | 'operations'> = { operations: createWorkspaceOperationJournal({ store, authorizeOwner: async () => true }), artifacts, async writeRunArtifact(c, identity, stream) {
    assert.equal(identity.owner_id, c.owner_id); assert.equal(identity.task_id, c.record.task.task_id);
    const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); const value = Buffer.concat(chunks);
    assert.equal(sha(value), identity.sha256); assert.equal(value.length, identity.size_bytes); bytes.set(identity.storage_key, new Uint8Array(value)); return identity;
  }, async submitText(c, request) {
    calls.submit++; assert.equal(request.operation_id, c.provider_operation!.operation_id); assert.equal(request.expect_json_object, true); assert.equal(request.reasoning_effort, 'xhigh');
    await c.bindProviderOperation!({ provider: 'openai-responses', reservation_id: 'reservation-' + request.operation_id, request_sha256: sha(request.input) });
    const input = JSON.parse(request.input);
    return { outcome: 'completed', submission: 'submitted', code: 'COMPLETED_UNTRUSTED', accounting: 'settled', reconciliation_required: false, response_id: 'response-1', reservation_id: 'reservation-' + request.operation_id, request_sha256: sha(request.input), budget_receipt_id: 'budget-1', output: { trust: 'untrusted_model_output', qc_verified: false,
      text: rawOutput ?? JSON.stringify({ slots: Object.fromEntries(input.slots.map((slot: string) => [slot, 'Synthetic ' + slot + (input.feedback ? ' revised' : '')])), claims_by_slot: Object.fromEntries(input.slots.map((slot: string) => [slot, ['material']])) }) } };
  } };
  const resolved = await dna(), source = research(mode);
  const options: WorkspaceOnepageOptions = { contentBudgetCapMicrousd: 100000, async resolveCanonical() { calls.resolve++; return structuredClone(resolved); }, async acquireResearch() { return structuredClone(source); }, quality: {
    async assess(_c, request) { const evidence_ref = 'test-qc:' + request.subject_sha256; reviews.set(evidence_ref, request.subject_sha256); return { evidence_ref, subject_sha256: request.subject_sha256, passed: !rejectReview }; },
    async verify(_c, request, assessment) { return !rejectReview && reviews.get(assessment.evidence_ref) === request.subject_sha256; },
  }, async generateAssets(_c, input) { calls.generated++; return Promise.all(input.slots.map(async canonical_slot => {
    const size = input.packet.assets.find(a => a.slot === canonical_slot)?.size;
    const [width, height] = size && /^\d+x\d+$/.test(size) ? size.split('x').map(Number) : [240, 240];
    const color = '#' + sha(canonical_slot).slice(0, 6);
    return { canonical_slot, bytes: new Uint8Array(await sharp({ create: { width, height, channels: 3, background: color } }).webp().toBuffer()) };
  })); }, async renderMapping() { calls.mapping++; return { bytes: new Uint8Array(await sharp({ create: { width: 64, height: 128, channels: 3, background: '#123456' } }).png().toBuffer()), evidence_refs: ['test-browser:desktop-mobile'] }; } };
  const pipeline = () => createWorkspaceOnepageAdapters(services, options);
  const read = () => store.read('owner-1', state => state.tasks[0]);
  const run = () => createWorkspaceRunner({ store, adapters: pipeline().adapters, executionReadiness: () => pipeline().readiness(), authorizeOwner: async () => true, environment: 'test', timeoutMs: 60000, leaseMs: 90000 }).drainOwner('owner-1');
  const approveContent = () => store.transaction('owner-1', state => { const r = state.tasks[0]; addAction(r, 'approve_content', { approval_source: 'authenticated_user', snapshot_id: r.task.snapshot.snapshot_id, content_digest: r.task.snapshot.content_digest }); });
  const approveArtwork = () => store.transaction('owner-1', state => { const r = state.tasks[0]; addAction(r, 'approve_artwork', { approval_source: 'authenticated_user', snapshot_id: r.task.snapshot.snapshot_id, content_digest: r.task.snapshot.content_digest, review_index_id: r.review_manifest!.index_id, render_hash: r.review_manifest!.render_hash,
    assets: r.task.snapshot.assets.map(a => ({ asset_id: a.asset_id, canonical_slot: a.canonical_slot, revision_id: a.revision_id, sha256: r.artifacts.find(f => f.revision_id === a.revision_id)!.sha256 })) }); });
  return { pipeline, services, options, source, resolved, calls, store, read, run, approveContent, approveArtwork, setOutput: (value: string) => { rawOutput = value; }, setReject: () => { rejectReview = true; }, corruptRead: () => { corruptRead = true; }, bytes };
}

test('construction is inert and reports every unconfigured independent capability', async () => {
  const p = createWorkspaceOnepageAdapters({ writeRunArtifact: async () => { throw new Error('must not write'); }, submitText: async () => { throw new Error('must not call'); } });
  assert.equal(p.readiness().ready, false); assert.equal(p.readiness().blockers.length, 8);
  const result = await p.adapters.draft.execute(context(record(), 'draft'));
  assert.deepEqual(result, { outcome: 'blocked', code: 'ONEPAGE_CANONICAL_RESOLVER_NOT_CONFIGURED' });
});
for (const mode of ['gtk', 'faq'] as const) test(`real deterministic ${mode} pipeline chains only to approval, then renders fixed template and reopens ZIP`, async () => {
  const f = await fixture(mode);
  await f.run(); let r = await f.read(); assert.equal(r.task.stage, 'content_review', JSON.stringify(r.events.at(-1)));
  assert.equal(f.calls.submit, 1); assert.equal(f.calls.generated, 0); assert.equal(r.preview, null); assert.ok(r.receipts?.length === 3);
  // New factory/runner instances reopen retained documents: no process-global cache.
  await f.run(); assert.equal(f.calls.submit, 1);
  await f.approveContent(); await f.run(); r = await f.read(); assert.equal(r.task.stage, 'review', JSON.stringify(r.events.at(-1)));
  assert.equal(r.task.snapshot.assets.length, mode === 'gtk' ? 18 : 15); assert.ok(r.review_manifest);
  const preview = await f.pipeline().renderPreview(r); assert.equal(preview.manifest.index_id, r.review_manifest!.index_id); assert.match(preview.html, /Content-Security-Policy/);
  assert.equal(preview.manifest.elements.some(e => e.kind === 'text' && e.slot === 'faq_question_02'), mode === 'faq');
  await f.approveArtwork(); await f.run(); r = await f.read(); assert.equal(r.task.stage, 'completed', JSON.stringify(r.events.at(-1)));
  assert.equal(f.calls.mapping, 1); assert.ok(r.artifacts.some(a => a.kind === 'package' && a.filename === 'onepage-travel_case.zip'));
  assert.equal(f.calls.resolve, 1, 'never silently re-resolve canonical during a pinned run');
});
test('canonical compilation rejects wrong brand and stale source hashes', async () => {
  const f = await fixture(); f.resolved.brand.slug = 'giftsoul';
  assert.equal((await f.pipeline().adapters.draft.execute(context(record(), 'draft')) as any).code, 'ONEPAGE_CANONICAL_BRAND_MISMATCH');
  f.resolved.brand.slug = 'pawfecthouse'; f.resolved.branch.content_md += ' changed without a new canonical contract';
  assert.equal((await f.pipeline().adapters.draft.execute(context(record(), 'draft')) as any).code, 'ONEPAGE_CANONICAL_BLOCKED');
});
test('missing acquisition evidence or research coverage cannot advance or spend', async () => {
  for (const change of [(f: Awaited<ReturnType<typeof fixture>>) => { f.source.acquisition_refs = []; }, (f: Awaited<ReturnType<typeof fixture>>) => { (f.source.research as any).sources[0].pdp_coverage.inventory_complete = false; }, (f: Awaited<ReturnType<typeof fixture>>) => { delete (f.source.research as any).pinterest_research; }]) {
    const f = await fixture(); change(f); await f.run(); assert.equal((await f.read()).task.stage, 'blocked'); assert.equal(f.calls.submit, 0);
  }
});
test('independent semantic/source rejection blocks rather than model self-approving', async () => {
  const f = await fixture(); f.setReject(); await f.run(); assert.equal((await f.read()).task.stage, 'blocked'); assert.equal(f.calls.submit, 0);
});
test('known canonical variant limitation is blocked while other research errors remain unknown', async () => {
  const known = await fixture();
  known.options.acquireResearch = async () => { throw new WorkspaceResearchError('RESEARCH_MULTI_VARIANT_CANONICAL_UNSUPPORTED', ['PDP_SCOPE_DRIFT'], 'research:retained-diagnostic'); };
  await known.run(); const result = await known.read();
  assert.equal(result.task.stage, 'blocked');
  assert.equal(result.runs!.at(-1)!.reason, 'RESEARCH_MULTI_VARIANT_CANONICAL_UNSUPPORTED');
  assert.equal(known.calls.submit, 0);
  const unknown = await fixture();
  unknown.options.acquireResearch = async () => { throw new WorkspaceResearchError('RESEARCH_CANCELLED_OR_TIMED_OUT'); };
  await unknown.run(); assert.equal((await unknown.read()).task.stage, 'unknown');
  assert.equal(unknown.calls.submit, 0);
});
test('content provider extra fields, wrong slots, fabricated claim IDs and broken JSON cannot become content', async () => {
  for (const response of ['not json', JSON.stringify({ slots: { wrong_slot: 'Test' }, claims_by_slot: {} }), JSON.stringify({ slots: {}, claims_by_slot: {}, approved: true })]) {
    const f = await fixture(); f.setOutput(response); await f.run(); assert.equal((await f.read()).task.stage, 'blocked'); assert.equal((await f.read()).content, null);
  }
});
test('retained receipt bytes, output digest, owner and operation bindings are rechecked', async () => {
  const f = await fixture(), c = context(record(), 'draft'), adapter = f.pipeline().adapters.draft;
  const outcome = await adapter.execute(c); assert.equal(outcome.outcome, 'completed'); if (outcome.outcome !== 'completed') return;
  assert.ok(await adapter.verifyEvidence(c, outcome.output));
  const forged = structuredClone(outcome.output); forged.receipt = { ...forged.receipt, snapshot: { ...forged.receipt.snapshot!, canonical_version: 'forged' } };
  assert.equal(await adapter.verifyEvidence(c, forged), null);
  assert.equal(await adapter.verifyEvidence({ ...c, owner_id: 'other-owner' }, outcome.output), null);
  assert.equal(await adapter.verifyEvidence({ ...c, run: { ...c.run, operation_id: 'other-operation' } }, outcome.output), null);
  const added = structuredClone(outcome.output); added.artifacts!.push({ ...added.artifacts![0], artifact_id: 'extra-artifact' });
  assert.equal(await adapter.verifyEvidence(c, added), null);
  f.corruptRead(); assert.equal(await adapter.verifyEvidence(c, outcome.output), null);
});
test('missing generator and malformed actual image bytes cannot pass assets', async () => {
  const f = await fixture(); await f.run(); await f.approveContent();
  // Use configured readiness for runner, but simulate capability disappearance at stage call.
  f.options.generateAssets = async () => [{ canonical_slot: 'banner_desktop', bytes: new Uint8Array([1, 2, 3]) }];
  await f.run(); assert.equal((await f.read()).task.stage, 'blocked'); assert.equal((await f.read()).review_manifest, null);
});

test('source binding must cover every inspected PDP item and the exact acquisition reference', async () => {
  for (const mutate of [(r: WorkspaceOnepageResearch) => { r.source_bindings = []; }, (r: WorkspaceOnepageResearch) => { r.source_bindings[0].item_ids = []; }, (r: WorkspaceOnepageResearch) => { r.source_bindings[0].evidence_ref = 'unrelated-source'; }]) {
    const f = await fixture(); mutate(f.source); await f.run(); assert.equal((await f.read()).task.stage, 'blocked'); assert.equal(f.calls.submit, 0);
  }
});
test('partial content feedback preserves all other slots then reuses exact approved asset bytes', async () => {
  const f = await fixture(); await f.run(); await f.approveContent(); await f.run();
  const before = await f.read(), slot = 'title_01';
  await f.store.transaction('owner-1', state => {
    const r = state.tasks[0]; addAction(r, 'feedback', { task_id: r.task.task_id, content_revision: r.task.snapshot.content_revision, index_id: r.review_manifest!.index_id, render_hash: r.review_manifest!.render_hash,
      groups: [{ instruction: 'Revise this exact title only.', text_slots: [{ slot, text_hash: sha(r.content!.slots[slot]) }], assets: [] }] });
  });
  await f.run(); let after = await f.read(); assert.equal(after.task.stage, 'content_review', JSON.stringify(after.events.at(-1)));
  assert.notEqual(before.content!.slots[slot], after.content!.slots[slot]);
  for (const key of Object.keys(before.content!.slots)) if (key !== slot) assert.equal(before.content!.slots[key], after.content!.slots[key]);
  assert.equal(f.calls.generated, 1);
  await f.approveContent(); await f.run(); after = await f.read(); assert.equal(after.task.stage, 'review', JSON.stringify(after.events.at(-1)));
  assert.equal(f.calls.generated, 1, 'reuse must not invoke creative generation');
  assert.deepEqual(after.task.snapshot.assets.map(a => a.revision_id), before.task.snapshot.assets.map(a => a.revision_id));
  assert.notEqual(after.review_manifest!.render_hash, before.review_manifest!.render_hash);
  for (const old of before.artifacts.filter(a => a.kind === 'image')) {
    const rebound = after.artifacts.find(a => a.kind === 'image' && a.revision_id === old.revision_id && a.content_revision === after.content!.revision);
    assert.ok(rebound); assert.equal(rebound.sha256, old.sha256); assert.equal(rebound.storage_key, old.storage_key); assert.notEqual(rebound.artifact_id, old.artifact_id);
  }
});
test('selected asset feedback cannot regenerate or change unselected assets', async () => {
  const f = await fixture(); await f.run(); await f.approveContent(); await f.run();
  const before = await f.read(), selected = before.task.snapshot.assets.find(a => a.canonical_slot === 'detail_01')!;
  const old = before.artifacts.find(a => a.kind === 'image' && a.revision_id === selected.revision_id)!;
  const generate = f.options.generateAssets!;
  f.options.generateAssets = async (c, input) => {
    assert.deepEqual(input.slots, ['detail_01']);
    const generated = await generate(c, input);
    generated[0].bytes = new Uint8Array(await sharp({ create: { width: 240, height: 240, channels: 3, background: '#987654' } }).webp().toBuffer());
    return generated;
  };
  await f.store.transaction('owner-1', state => { const r = state.tasks[0]; addAction(r, 'feedback', { task_id: r.task.task_id, content_revision: r.task.snapshot.content_revision, index_id: r.review_manifest!.index_id, render_hash: r.review_manifest!.render_hash,
    groups: [{ instruction: 'Change this detail only.', text_slots: [], assets: [{ canonical_slot: selected.canonical_slot, artifact_revision: selected.revision_id, sha256: old.sha256 }] }] }); });
  await f.run(); const after = await f.read(); assert.equal(after.task.stage, 'review', JSON.stringify(after.events.at(-1)));
  assert.notEqual(after.task.snapshot.assets.find(a => a.canonical_slot === selected.canonical_slot)!.revision_id, selected.revision_id);
  for (const a of before.task.snapshot.assets.filter(a => a.canonical_slot !== selected.canonical_slot)) assert.deepEqual(after.task.snapshot.assets.find(b => b.canonical_slot === a.canonical_slot), a);
});


test('failed-before-submit with uncertain budget accounting stays UNKNOWN and cannot be retried', async () => {
  const f = await fixture();
  f.services.submitText = async () => { f.calls.submit++; return { outcome: 'failed_before_submit', submission: 'not_submitted', code: 'BUDGET_RESERVATION_UNCONFIRMED', accounting: 'pending_reconciliation', reconciliation_required: true }; };
  await f.run(); const r = await f.read();
  assert.equal(r.task.stage, 'unknown'); assert.equal(r.runs?.at(-1)?.status, 'unknown');
  await f.run(); assert.equal(f.calls.submit, 1);
});


test('all exact slots with one invented claim ID are rejected before independent content approval', async () => {
  const f = await fixture(), submit = f.services.submitText;
  f.services.submitText = async (c, req) => { const result = await submit(c, req); const body = JSON.parse(result.output!.text); body.claims_by_slot.title_01 = ['invented-claim']; result.output!.text = JSON.stringify(body); return result; };
  await f.run(); assert.equal((await f.read()).task.stage, 'blocked'); assert.equal((await f.read()).content, null);
});
test('exact generated inventory with corrupt image bytes never receives an asset receipt', async () => {
  const f = await fixture(), generate = f.options.generateAssets!;
  f.options.generateAssets = async (c, input) => { const assets = await generate(c, input); assets[0].bytes = new Uint8Array([0, 1, 2]); return assets; };
  await f.run(); await f.approveContent(); await f.run(); const r = await f.read();
  assert.equal(r.task.stage, 'unknown', 'provider has already run, so thrown decode failure is conservative UNKNOWN');
  assert.equal(r.review_manifest, null); assert.ok(!r.receipts?.some(item => item.kind === 'assets_complete'));
});
test('a stored QC reference is not a pass after the independent reviewer revokes it', async () => {
  const f = await fixture(); await f.run(); const r = await f.read();
  f.setReject(); const outcome = await f.pipeline().adapters.content_authoring.execute(context(r, 'content_authoring'));
  assert.equal(outcome.outcome, 'blocked'); assert.equal(f.calls.submit, 1, 'revoked research cannot trigger new authoring');
});


test('historical preview freezes original canonical/research dependencies and excludes later documents', async () => {
  const f = await fixture(); await f.run(); await f.approveContent(); await f.run(); const before = await f.read();
  await f.store.transaction('owner-1', state => { const r = state.tasks[0]; addAction(r, 'feedback', { task_id: r.task.task_id, content_revision: r.task.snapshot.content_revision, index_id: r.review_manifest!.index_id, render_hash: r.review_manifest!.render_hash,
    groups: [{ instruction: 'Revise only this title.', text_slots: [{ slot: 'title_01', text_hash: sha(r.content!.slots.title_01) }], assets: [] }] }); });
  await f.run(); await f.approveContent(); await f.run(); const current = await f.read(), revision = current.revision_history![0];
  assert.ok(revision.artifact_ids.some(id => current.artifacts.find(a => a.artifact_id === id)?.filename.startsWith('onepage-evidence-draft-')));
  assert.ok(revision.artifact_ids.some(id => current.artifacts.find(a => a.artifact_id === id)?.filename.startsWith('onepage-evidence-research-')));
  const futureDoc = current.artifacts.find(a => a.filename.startsWith('onepage-evidence-content_feedback-'))!;
  assert.ok(futureDoc); assert.ok(!revision.artifact_ids.includes(futureDoc.artifact_id));
  // Reproduce the API's exact immutable history filter, rather than broadening it.
  const historical: WorkspaceRecord = { ...current, task: { ...current.task, snapshot: revision.snapshot }, content: revision.content, review_manifest: revision.review_manifest,
    preview: revision.preview, artifacts: current.artifacts.filter(a => revision.artifact_ids.includes(a.artifact_id)), actions: [], runs: [], revision_plan: undefined };
  const preview = await f.pipeline().renderPreview(historical);
  assert.equal(preview.manifest.index_id, before.review_manifest!.index_id);
  assert.notEqual(preview.manifest.index_id, current.review_manifest!.index_id);
  f.bytes.set(futureDoc.storage_key, Buffer.from('corrupt later document'));
  assert.equal((await f.pipeline().renderPreview(historical)).manifest.index_id, before.review_manifest!.index_id);
  historical.artifacts = historical.artifacts.filter(a => !a.filename.startsWith('onepage-evidence-draft-'));
  await assert.rejects(f.pipeline().renderPreview(historical), /RETAINED_DRAFT_REQUIRED/);
});

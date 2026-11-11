import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceOnepageProductionPipeline, type WorkspaceOnepageProductionOptions } from '../uid-workspace-production.ts';
import { createWorkspaceRuntime, type WorkspaceRuntimeServices } from '../uid-workspace-runtime.ts';
import { createWorkspaceOperationJournal } from '../uid-workspace-operations.ts';
import { MemoryWorkspaceStore } from '../uid-workspace-store.ts';
import { journalPool } from './helpers/workspace-journal-pool.ts';
import { pricing, NOW, before, later } from './helpers/workspace-provider-fixture.ts';
function fixture() {
  let io = 0; const never = async (): Promise<any> => { io++; throw new Error('NO_EXTERNAL_WORK_EXPECTED'); };
  const objects = { kind: 'fixture-only', productionReady: false, loopbackOnly: true, put: never, open: never, remove: never };
  const store = new MemoryWorkspaceStore();
  const services: WorkspaceRuntimeServices = { store, operations: createWorkspaceOperationJournal({ store, authorizeOwner: never }), writeRunArtifact: never, submitText: never };
  const options: WorkspaceOnepageProductionOptions = { objects, providers: {}, sources: { authorize: never },
    research: { budgets: { semantic_cap_microusd: 1000, vision_cap_microusd: 1000, total_cap_microusd: 10000 } }, resolveCanonical: never, renderer: {},
    review: { reviewer_id: 'fixture-reviewer', model: 'gpt-6.1-sol', budgetCapMicrousd: 1000, authorizeReviewer: never }, images: { budgetCapMicrousd: 1000, sizingStrategies: [] }, content: { budgetCapMicrousd: 1000 } };
  return { services, options, count: () => io };
}
test('production composition installs actual Onepage stages but construction never starts work or infers capabilities', () => {
  const f = fixture(); const pipeline = createWorkspaceOnepageProductionPipeline(f.services, f.options);
  assert.equal(f.count(), 0); assert.deepEqual(Object.keys(pipeline.adapters).sort(), ['asset_feedback','assets','assets_reuse','content_authoring','content_feedback','draft','packaging','research','review']);
  assert.equal(typeof pipeline.renderPreview, 'function'); assert.equal(pipeline.readiness().ready, false); assert.equal(f.count(), 0);
  const codes = pipeline.readiness().blockers.map(value => value.code);
  for (const code of ['RESEARCH_RENDERED_INVENTORY_NOT_CONFIGURED','MULTIMODAL_BUDGET_NOT_CONFIGURED','VISION_CAPABILITY_NOT_CONFIGURED','IMAGE_CAPABILITY_NOT_CONFIGURED','SANDBOXED_BROWSER_NOT_CONFIGURED','INVENTORY_EVIDENCE_REOPENER_REQUIRED','REVIEW_STRUCTURED_OUTPUT_CAPABILITY_REQUIRED','CANONICAL_IMAGE_FITTING_REVIEW_REQUIRED','PRODUCTION_PRIVATE_SOURCE_CUSTODY_REQUIRED']) assert.ok(codes.includes(code), code);
  assert.equal(new Set(codes).size, codes.length);
});
test('reviewed inventory hook presence does not hide browser/provider/storage/budget gaps', () => {
  const f = fixture(); f.options.research.inspectInventory = async () => { throw new Error('not exercised'); };
  f.options.review.reopenInventoryEvidence = async () => { throw new Error('not exercised'); };
  const result = createWorkspaceOnepageProductionPipeline(f.services, f.options).readiness();
  assert.equal(result.ready, false); assert.ok(!result.blockers.some(value => value.code === 'INVENTORY_EVIDENCE_REOPENER_REQUIRED')); assert.equal(f.count(), 0);
});
test('runtime refuses provider budget on a different table or with no legacy shared budget', () => {
  const fake = journalPool(), providerBudget = { schemaReviewed: true as const, schemaVersion: 'uid-workspace-budget-v1' as const, qualifiedTable: 'private.other_budget', pricing: [pricing], verifiedBounds: [], now: () => NOW };
  const ownerStore = { schemaReviewed: true as const, schemaVersion: 'uid-workspace-owner-state-v1' as const, qualifiedTable: 'private.owner_state' };
  assert.throws(() => createWorkspaceRuntime({ database: { pool: fake.pool, ownerStore, providerBudget } }), /PROVIDER_SHARED_BUDGET_SCOPE_REQUIRED/);
  const budget = { schemaReviewed: true as const, schemaVersion: 'uid-workspace-budget-v1' as const, qualifiedTable: 'private.shared_budget', now: () => NOW,
    pricing: { model: 'gpt-6.1-sol' as const, evidence_ref: 'fixture-price', verified_at: before, expires_at: later, max_input_tokens_per_utf8_byte: 1, protocol_input_token_overhead: 100, max_input_tokens: 10000, max_output_tokens: 1000,
      tiers: [{ through_input_tokens: 10000, input_microusd_per_million: 1000000, output_microusd_per_million: 1000000 }] } };
  assert.throws(() => createWorkspaceRuntime({ database: { pool: fake.pool, ownerStore, budget, providerBudget } }), /PROVIDER_SHARED_BUDGET_SCOPE_REQUIRED/);
  let services: WorkspaceRuntimeServices | undefined;
  createWorkspaceRuntime({ database: { pool: fake.pool, ownerStore, budget, providerBudget: { ...providerBudget, qualifiedTable: budget.qualifiedTable } }, createAdapters(value) { services = value; return {}; } });
  assert.ok(services!.budget); assert.ok(services!.providerBudget); assert.equal(services!.providerBudget!.readiness().bounds_ready, false); assert.equal(fake.statements.length, 0);
});

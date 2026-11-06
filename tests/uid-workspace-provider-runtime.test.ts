import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from '../tools/creative-quality/sharp.ts';
import { stableJson } from '../supabase/functions/_shared/creative-quality.ts';
import { MemoryWorkspaceStore, type WorkspaceRecord } from '../uid-workspace-store.ts';
import { createWorkspaceTask } from '../uid-workspace-task.ts';
import { workspaceObjectKey } from '../uid-workspace-artifacts.ts';
import { createWorkspaceOperationJournal, type WorkspaceChildReport } from '../uid-workspace-operations.ts';
import { createWorkspaceProviderRuntime, type WorkspaceProviderRuntimeConfig } from '../uid-workspace-provider-runtime.ts';
import { createWorkspaceRuntime, type WorkspaceRuntimeServices } from '../uid-workspace-runtime.ts';
import { PostgresWorkspaceProviderBudget, type WorkspaceProviderProjectState } from '../uid-workspace-provider-budget.ts';
import { decodeWorkspaceImage, WORKSPACE_IMAGE_GENERATE_ENDPOINT, WORKSPACE_IMAGE_EDIT_ENDPOINT, type WorkspaceImageResult, type WorkspaceImageRequest } from '../uid-workspace-image.ts';
import { WORKSPACE_VISION_ENDPOINT, type WorkspaceVisionRequest, type WorkspaceVisionResult } from '../uid-workspace-vision.ts';
import { WORKSPACE_OPENAI_MODEL } from '../uid-workspace-openai.ts';
import { workspaceSourceScope } from '../uid-workspace-providers.ts';
import type { WorkspaceResearchOperationRequest } from '../uid-workspace-research.ts';
import type { WorkspaceStageContext } from '../uid-workspace-runner.ts';
import { journalPool } from './helpers/workspace-journal-pool.ts';
import { TABLE, NOW, before, later, capability, pricing, boundFor, fixtureState, budgetRequest, imageRequest, encodedBody, sha } from './helpers/workspace-provider-fixture.ts';

// Offline composition tests only: invented prices/grants, a SQL-protocol fake,
// actual local raster decoding and actual MemoryWorkspaceStore child journaling.
// These fixtures do not establish provider access, production SQL safety or EO QC.
const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
const textPricing = { evidence_ref: 'fixture-text-pricing', model: WORKSPACE_OPENAI_MODEL, verified_at: before, expires_at: later,
  max_input_tokens_per_utf8_byte: 1, protocol_input_token_overhead: 100, max_input_tokens: 10000, max_output_tokens: 1000,
  tiers: [{ through_input_tokens: 10000, input_microusd_per_million: 2_000_000, output_microusd_per_million: 8_000_000 }] };
async function fixture() {
  const store = new MemoryWorkspaceStore(), sql = journalPool(), controller = new AbortController();
  let allowed = true, hook: (() => Promise<void>) | undefined, failFetch = false, textCalls = 0;
  const calls: Array<{ url: string; body: any }> = [], opened: string[] = [];
  const bytes = new Uint8Array(await sharp({ create: { width: 256, height: 256, channels: 3, background: '#345678' } }).png().toBuffer());
  const object = { owner_id: 'alice', task_id: 'task-one', sha256: sha(bytes), size_bytes: bytes.length, media_type: 'image/png', storage_key: workspaceObjectKey('alice', 'task-one', sha(bytes)) };
  const task = createWorkspaceTask('task-one', { snapshot_id: 'snapshot-one', canonical_version: 'canonical-one', content_revision: 'content-one', content_digest: sha('copy'), assets: [] });
  const action: WorkspaceRecord['actions'][number] = { action_id: 'action-one', idempotency_key: 'action-one', fingerprint: sha('action'), type: 'start', status: 'running', expected_state_version: task.state_version, content_revision: 'content-one', created_at: before, actor_id: 'alice', payload: {} };
  const run: NonNullable<WorkspaceRecord['runs']>[number] = { run_id: 'run-one', action_id: action.action_id, operation_id: 'root-operation', stage: 'research', expected_state_version: task.state_version, snapshot_id: 'snapshot-one', content_revision: 'content-one', fence: 1, status: 'in_flight', lease_owner: 'worker-one', lease_expires_at: later, created_at: before, updated_at: before };
  const record: WorkspaceRecord = { owner_id: 'alice', task, brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://pawfecthouse.com/products/fixture' }, created_at: before, updated_at: before, actions: [action], runs: [run], events: [], artifacts: [], content: null, preview: null, review_manifest: null, quality: [] };
  run.artifact_intents = [{ ...object, status: 'verified', created_at: before, updated_at: before }];
  await store.transaction('alice', state => { state.tasks.push(record); });
  const context: WorkspaceStageContext = { owner_id: 'alice', record: structuredClone(record), action: structuredClone(action), run: structuredClone(run), signal: controller.signal };
  const operations = createWorkspaceOperationJournal({ store, authorizeOwner: async () => allowed, now: () => NOW });
  const state = fixtureState(); state.tasks[0].provider_authorizations!.push({ ...state.tasks[0].provider_authorizations![0], modality: 'responses_vision', endpoint: WORKSPACE_VISION_ENDPOINT, model: 'fixture-sol', capability_verification_ref: 'vision-capability', data_authorization_ref: 'approved-vision-data' });
  sql.seed(TABLE, 'project-one', state);
  const services: WorkspaceRuntimeServices = { store, operations, async writeRunArtifact() { throw Error('Not used'); }, async submitText(c, request) {
    textCalls++;
    const request_sha256 = sha(stableJson({ instructions: request.instructions, input: request.input })), reservation_id = 'fixture:text-reservation';
    await c.bindProviderOperation!({ provider: 'openai-responses', reservation_id, request_sha256 }); await operations.guardDispatch(c);
    return { outcome: 'completed', submission: 'submitted', code: 'COMPLETED_UNTRUSTED', accounting: 'settled', reconciliation_required: false,
      response_id: 'response:text', response_model: WORKSPACE_OPENAI_MODEL, request_sha256, reservation_id, budget_receipt_id: 'budget:text', output: { text: '{"fixture":true}', trust: 'untrusted_model_output', qc_verified: false } };
  } };
  const config: WorkspaceProviderRuntimeConfig = {
    image: { serverCredential: { api_key: 'synthetic-not-real', project_id: 'project-one' }, capability, decodeImage: decodeWorkspaceImage, now: () => NOW,
      fetch: async (url, init) => { calls.push({ url: String(url), body: JSON.parse(String(init?.body)) }); if (failFetch) throw Error('Synthetic lost response');
        return new Response(JSON.stringify({ created: NOW / 1000, output_format: 'png', size: '256x256', quality: 'high', data: [{ b64_json: Buffer.from(bytes).toString('base64') }], usage }), { headers: { 'content-type': 'application/json' } }); } },
    vision: { serverCredential: { api_key: 'synthetic-not-real', project_id: 'project-one' }, capability: { verified: true, verification_ref: 'vision-capability', project_id: 'project-one', family: 'sol', model: 'fixture-sol', api: 'responses', image_input: true, text_output: true, accepted_response_models: ['fixture-sol'], checked_at: before, expires_at: later }, now: () => NOW,
      objects: { kind: 'offline-fixture', productionReady: false, loopbackOnly: true, async put() { throw Error('Not used'); }, async remove() { throw Error('Not used'); }, async open(o) { opened.push(o.storage_key); assert.deepEqual(o, object); return { stream: (async function* () { yield bytes; })(), async dispose() {} }; } },
      fetch: async (url, init) => { calls.push({ url: String(url), body: JSON.parse(String(init?.body)) }); if (failFetch) throw Error('Synthetic lost response');
        return new Response(JSON.stringify({ object: 'response', id: 'response:vision', model: 'fixture-sol', status: 'completed', error: null, incomplete_details: null, usage,
          output: [{ type: 'message', id: 'message:vision', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"fixture":true}' }] }] }), { headers: { 'content-type': 'application/json' } }); } },
  };
  function budgetFor(request: WorkspaceImageRequest | WorkspaceVisionRequest) {
    const image = 'source_images' in request, endpoint = image ? request.operation === 'edit' ? WORKSPACE_IMAGE_EDIT_ENDPOINT : WORKSPACE_IMAGE_GENERATE_ENDPOINT : WORKSPACE_VISION_ENDPOINT;
    const body = image ? encodedBody(request) : JSON.stringify({ model: 'fixture-sol', instructions: request.instructions, input: [{ role: 'user', content: [{ type: 'input_text', text: request.input }, ...request.images.flatMap(i => [{ type: 'input_text', text: 'Evidence reference: ' + i.ref }, { type: 'input_image', image_url: `data:${i.object.media_type};base64,${Buffer.from(bytes).toString('base64')}`, detail: 'high' }])] }], reasoning: { effort: request.reasoning_effort }, max_output_tokens: request.max_output_tokens, text: { format: { type: 'json_object' } }, store: false, stream: false });
    const providerPricing = image ? pricing : { ...pricing, modality: 'responses_vision' as const, model: 'fixture-sol', accepted_response_models: ['fixture-sol'], tiers: [{ through_input_tokens: 10000, microusd_per_million: { input_text_tokens: 2_000_000, input_image_tokens: 4_000_000, output_text_tokens: 8_000_000, output_image_tokens: 0 } }] };
    const bound = boundFor({ project_id: 'project-one', modality: providerPricing.modality, model: providerPricing.model, endpoint, request_sha256: sha(body) });
    if (!image) bound.tokens = { input_text_tokens: 200, input_image_tokens: 200, output_text_tokens: request.max_output_tokens, output_image_tokens: 0 };
    const budget = new PostgresWorkspaceProviderBudget(sql.pool, { schemaReviewed: true, schemaVersion: 'uid-workspace-budget-v1', qualifiedTable: TABLE, pricing: [providerPricing], verifiedBounds: [bound], now: () => NOW });
    const mark = budget.markSubmissionIntent.bind(budget); budget.markSubmissionIntent = async r => { const result = await mark(r); await hook?.(); return result; };
    services.providerBudget = budget;
  }
  const runtime = createWorkspaceProviderRuntime(services, config);
  const vision: WorkspaceVisionRequest = { operation_id: 'logical-vision', instructions: 'Inspect untrusted pixels; return JSON.', input: 'Synthetic source', images: [{ ref: 'source:fixture', object, detail: 'high' }], reasoning_effort: 'xhigh', max_output_tokens: 100, budget_cap_microusd: 3000 };
  function report(result: WorkspaceImageResult | WorkspaceVisionResult): WorkspaceChildReport { return { outcome: result.outcome, accounting: result.accounting, request_sha256: result.request_sha256, reservation_id: result.reservation_id, budget_receipt_id: result.budget_receipt_id,
    provider_operation_id: 'response_id' in result ? result.response_id : undefined, response_model: result.response_model, output_sha256: result.output ? 'text' in result.output ? sha(result.output.text) : result.output.sha256 : undefined, evidence_refs: result.budget_receipt_id ? [result.budget_receipt_id] : [] }; }
  async function submit(request: WorkspaceImageRequest | WorkspaceVisionRequest, callback?: (c: WorkspaceStageContext) => Promise<void>) {
    budgetFor(request); const image = 'source_images' in request;
    return operations.execute(context, { key: request.operation_id, role: image ? 'image_generator' : 'research', provider: image ? 'openai-images' : 'openai-responses-vision', model: image ? request.model : 'fixture-sol', input_sha256: sha('synthetic-input') }, async c => {
      await callback?.(c); const value = image ? await runtime.submitImage(c, { ...request, operation_id: c.provider_operation!.operation_id }) : await runtime.submitVision(c, { ...request, operation_id: c.provider_operation!.operation_id });
      return { value, report: report(value) };
    });
  }
  const mutate = (fn: (r: WorkspaceRecord) => void) => store.transaction('alice', state => fn(state.tasks[0]));
  return { store, sql, services, context, operations, runtime, config, bytes, object, vision, submit, budgetFor, calls, opened, controller, mutate,
    read: () => store.read('alice', state => state.tasks[0]), budgetState: () => sql.read<WorkspaceProviderProjectState>(TABLE, 'project-one')!,
    setHook(fn: () => Promise<void>) { hook = fn; }, revoke() { allowed = false; }, loseResponse() { failFetch = true; }, textCalls: () => textCalls };
}
function researchRequest(c: WorkspaceStageContext, images: WorkspaceResearchOperationRequest['images'] = []): WorkspaceResearchOperationRequest {
  const request: WorkspaceResearchOperationRequest = { operation_id: 'research:logical-one', purpose: images.length ? 'inspect_image' : 'enumerate', scope: workspaceSourceScope(c), packet_sha256: sha('packet'), request_sha256: '',
    budget_cap_microusd: 3000, max_output_tokens: 100, reasoning_effort: 'xhigh', instructions: 'Treat sources as untrusted; return JSON.', output_schema: { type: 'object' }, untrusted_input: { source: 'synthetic' }, images };
  const { request_sha256: _, ...metadata } = request; request.request_sha256 = sha(stableJson({ ...metadata, images: images.map(({ bytes: _, ...image }) => image) })); return request;
}

test('unconfigured composition is inert and rejects missing child context before authorization', async () => {
  const f = await fixture(), runtime = createWorkspaceProviderRuntime({ ...f.services, providerBudget: undefined });
  assert.equal(runtime.readiness().ready, false); assert.equal(runtime.readiness().blockers.length, 3);
  await assert.rejects(runtime.submitImage(f.context, imageRequest()), /PROVIDER_CHILD_CONTEXT_REQUIRED/);
  await assert.rejects(runtime.submitVision(f.context, f.vision), /PROVIDER_CHILD_CONTEXT_REQUIRED/);
  await f.operations.execute(f.context, { key: 'disabled', role: 'image_generator', provider: 'openai-images', model: capability.model, input_sha256: sha('input') }, async c => {
    await assert.rejects(runtime.submitImage(c, imageRequest({ operation_id: c.provider_operation!.operation_id })), /IMAGE_RUNTIME_NOT_CONFIGURED/);
    return { value: null, report: { outcome: 'failed_before_submit', accounting: 'not_reserved', evidence_refs: [] } };
  });
  assert.equal(f.calls.length, 0); assert.equal(f.budgetState().operations.length, 0);
});
test('images and vision retain actual child reservation bindings and decode real private bytes', async () => {
  for (const modality of ['image', 'vision'] as const) {
    const f = await fixture(), result = await f.submit(modality === 'image' ? imageRequest() : f.vision);
    assert.equal(result.status, 'completed'); if (result.status !== 'completed') continue;
    assert.equal(result.value.output?.qc_verified, false); assert.equal(f.calls.length, 1);
    const child = (await f.read()).runs![0].child_operations![0], charged = f.budgetState().operations[0];
    assert.equal(child.status, 'completed'); assert.equal(child.report!.accounting, 'settled'); assert.equal(child.operation_id, charged.request.operation_id);
    assert.equal(child.provider_binding!.reservation_id, charged.reservation_id); assert.equal(child.provider_binding!.request_sha256, charged.request.request_sha256);
    assert.equal((await f.read()).runs![0].provider_binding, undefined); assert.equal(charged.state, 'settled');
    if (modality === 'vision') { assert.deepEqual(f.opened, [f.object.storage_key]); assert.equal(f.calls[0].body.input[0].content[2].detail, 'high'); }
    else assert.deepEqual((result.value as WorkspaceImageResult).output?.bytes, f.bytes);
  }
});
test('source capture intent authorizes exact image-edit bytes without publishing an artifact', async () => {
  const f = await fixture(), request = imageRequest({ operation: 'edit', source_images: [{ bytes: f.bytes, sha256: f.object.sha256, mime_type: 'image/png', width: 256, height: 256 }] });
  assert.equal((await f.read()).artifacts.length, 0); assert.equal((await f.submit(request)).status, 'completed');
  assert.equal(f.calls[0].url, WORKSPACE_IMAGE_EDIT_ENDPOINT); assert.equal(f.calls[0].body.images[0].image_url, 'data:image/png;base64,' + Buffer.from(f.bytes).toString('base64'));
});
for (const changed of ['unknown', 'unverified', 'owner', 'task', 'size', 'type', 'key'] as const) test(`private capture rejects ${changed} journal identity before provider dispatch`, async () => {
  const f = await fixture(); await f.mutate(r => { const a = r.runs![0].artifact_intents![0];
    if (changed === 'unknown') r.runs![0].artifact_intents = []; else if (changed === 'unverified') a.status = 'reserved'; else if (changed === 'owner') a.owner_id = 'bob'; else if (changed === 'task') a.task_id = 'other-task'; else if (changed === 'size') a.size_bytes++; else if (changed === 'type') a.media_type = 'image/jpeg'; else a.storage_key = workspaceObjectKey('bob', 'task-one', a.sha256); });
  assert.notEqual((await f.submit(f.vision)).status, 'completed'); assert.equal(f.calls.length, 0); assert.equal(f.budgetState().operations.length, 0);
});
test('foreign private object owner/task and removed reference cannot be authorized by a local matching hash', async () => {
  for (const dimension of ['owner_id', 'task_id'] as const) {
    const f = await fixture(); f.vision.images[0].object = { ...f.object, [dimension]: 'foreign' };
    assert.notEqual((await f.submit(f.vision)).status, 'completed'); assert.equal(f.opened.length, 0); assert.equal(f.calls.length, 0);
  }
  const f = await fixture(); await f.mutate(r => { r.runs![0].artifact_intents = []; r.references = [{ ...f.object, reference_id: 'removed', purpose: 'brief', removed_at: before } as any]; });
  assert.notEqual((await f.submit(f.vision)).status, 'completed'); assert.equal(f.calls.length, 0);
});
for (const modality of ['image', 'vision'] as const) for (const fence of ['cancel', 'member', 'lease', 'snapshot', 'abort'] as const) test(`${modality} rechecks ${fence} after durable submission intent but before I/O`, async () => {
  const f = await fixture(); f.setHook(async () => {
    if (fence === 'member') f.revoke(); else if (fence === 'abort') f.controller.abort(); else await f.mutate(r => {
      if (fence === 'cancel') r.actions.push({ ...r.actions[0], action_id: 'cancel', type: 'cancel', status: 'queued' });
      if (fence === 'lease') r.runs![0].lease_expires_at = before;
      if (fence === 'snapshot') r.task = { ...r.task, snapshot: { ...r.task.snapshot, snapshot_id: 'replacement' } };
    });
  });
  const result = await f.submit(modality === 'image' ? imageRequest() : f.vision); assert.notEqual(result.status, 'completed'); assert.equal(f.calls.length, 0);
  const operation = f.budgetState().operations[0]; assert.equal(operation.state, 'submission_intent');
  assert.equal((await f.read()).runs![0].child_operations![0].status, 'unknown');
});
test('task-specific modality grant is required and never inferred from legacy text permission', async () => {
  const f = await fixture(); const state = f.budgetState(); state.tasks[0].provider_authorizations = []; f.sql.seed(TABLE, 'project-one', state);
  assert.notEqual((await f.submit(imageRequest())).status, 'completed'); assert.equal(f.calls.length, 0); assert.equal(f.budgetState().operations.length, 0);
});
test('lost provider response stays unknown, holds accounting and fences later children', async () => {
  const f = await fixture(); f.loseResponse(); assert.equal((await f.submit(imageRequest())).status, 'unknown');
  assert.equal((await f.submit(f.vision)).status, 'unknown'); assert.equal(f.calls.length, 1); assert.equal(f.budgetState().operations[0].state, 'held');
});
test('research separates logical request identity from actual durable child and provider response', async () => {
  const f = await fixture(), request = researchRequest(f.context), result = await f.runtime.research.execute(f.context, request);
  assert.equal(result.receipt.operation_id, request.operation_id); assert.match(result.receipt.provider_operation_id, /^child:/); assert.notEqual(result.receipt.provider_operation_id, result.receipt.response_id);
  assert.equal(result.receipt.output_sha256, sha(result.output_json)); assert.equal(await f.runtime.research.verify(f.context, result.receipt, request), true);
  assert.equal(await createWorkspaceProviderRuntime(f.services).research.verify(f.context, result.receipt, request), true);
  await assert.rejects(f.runtime.research.execute(f.context, request), /RESEARCH_OPERATION_BLOCKED/); assert.equal(f.textCalls(), 1);
  for (const field of ['operation_id', 'provider_operation_id', 'request_sha256', 'response_id', 'budget_receipt_id', 'output_sha256'] as const) assert.equal(await f.runtime.research.verify(f.context, { ...result.receipt, [field]: field.endsWith('sha256') ? sha('other') : 'other' }, request), false, field);
  await f.mutate(r => { r.runs![0].child_operations![0].status = 'unknown'; }); assert.equal(await f.runtime.research.verify(f.context, result.receipt, request), false);
});
test('research rejects modified payload metadata or image bytes before creating a child', async () => {
  const f = await fixture(), request = researchRequest(f.context); request.instructions = 'changed';
  await assert.rejects(f.runtime.research.execute(f.context, request), /RESEARCH_REQUEST_BINDING_MISMATCH/);
  const image = researchRequest(f.context, [{ evidence_ref: 'source:fixture', media_type: 'image/png', sha256: f.object.sha256, bytes: f.bytes.slice() }]); image.images[0].bytes[0] ^= 1;
  await assert.rejects(f.runtime.research.execute(f.context, image), /RESEARCH_IMAGE_HASH_MISMATCH/); assert.equal(f.textCalls(), 0); assert.equal((await f.read()).runs![0].child_operations, undefined);
});
test('research vision uses the same private-object and child reservation composition', async () => {
  const f = await fixture(), request = researchRequest(f.context, [{ evidence_ref: 'source:fixture', media_type: 'image/png', sha256: f.object.sha256, bytes: f.bytes }]);
  const input = stableJson({ output_schema: request.output_schema, untrusted_input: request.untrusted_input, scope: request.scope, canonical_packet_sha256: request.packet_sha256, images: request.images.map(({ bytes: _, ...image }) => image) });
  f.budgetFor({ ...f.vision, instructions: request.instructions, input }); const result = await f.runtime.research.execute(f.context, request);
  assert.equal(await f.runtime.research.verify(f.context, result.receipt, request), true); assert.equal(f.textCalls(), 0); assert.equal(f.calls.length, 1); assert.equal(f.budgetState().operations[0].request.operation_id, result.receipt.provider_operation_id);
});
test('runtime creates legacy and multimodal accounting on the exact shared pool/table', async () => {
  const owners = journalPool(), budgetSql = journalPool(), state = fixtureState(5000); budgetSql.seed(TABLE, 'project-one', state);
  let services: WorkspaceRuntimeServices | undefined;
  const request = budgetRequest();
  const database = { pool: owners.pool, budgetPool: budgetSql.pool, ownerStore: { schemaReviewed: true as const, schemaVersion: 'uid-workspace-owner-state-v1' as const, qualifiedTable: 'private.owner_state' },
    budget: { schemaReviewed: true as const, schemaVersion: 'uid-workspace-budget-v1' as const, qualifiedTable: TABLE, pricing: textPricing, now: () => NOW },
    providerBudget: { schemaReviewed: true as const, schemaVersion: 'uid-workspace-budget-v1' as const, qualifiedTable: TABLE, pricing: [pricing], verifiedBounds: [boundFor(request)], now: () => NOW } };
  createWorkspaceRuntime({ database, createAdapters(s) { services = s; return {}; } });
  assert.ok(services?.budget); assert.ok(services?.providerBudget);
  assert.equal((await services.providerBudget.reserve(request)).status, 'reserved');
  assert.equal((await services.budget.reserve({ authorization_id: 'alice-task-one-auth', owner_id: 'alice', task_id: 'task-one', project_id: 'project-one', operation_id: 'text-one', request_sha256: sha('text'), client_request_id: 'text-request', model: WORKSPACE_OPENAI_MODEL, maximum_cost_microusd: 3000, request_bytes: 400, input_utf8_bytes: 200, max_output_tokens: 100, reasoning_effort: 'high', budget_authorization_ref: 'task-one-budget', global_budget_authorization_ref: 'global-approved', user_quota_authorization_ref: 'alice-quota', capability_verification_ref: 'text-capability' })).status, 'denied');
  assert.equal(owners.statements.length, 0); assert.equal(budgetSql.read<WorkspaceProviderProjectState>(TABLE, 'project-one')!.operations.length, 1);
  assert.ok(budgetSql.statements.filter(s => s.sql.startsWith('SELECT pg_advisory')).every(s => s.values[0] === 'uid-workspace-budget:project-one'));
  assert.throws(() => createWorkspaceRuntime({ database: { ...database, budget: undefined } }), /PROVIDER_SHARED_BUDGET_SCOPE_REQUIRED/);
  assert.throws(() => createWorkspaceRuntime({ database: { ...database, providerBudget: { ...database.providerBudget, qualifiedTable: 'private.separate_budget' } } }), /PROVIDER_SHARED_BUDGET_SCOPE_REQUIRED/);
});

test('private image inputs are snapshotted before asynchronous grant lookup', async () => {
  for (const modality of ['image', 'vision'] as const) {
    const f = await fixture();
    const request = modality === 'image' ? imageRequest({ operation: 'edit', source_images: [{ bytes: f.bytes.slice(), sha256: f.object.sha256, mime_type: 'image/png', width: 256, height: 256 }] }) : structuredClone(f.vision);
    const result = await f.submit(request, async () => {
      const authorize = f.services.providerBudget!.authorizationFor.bind(f.services.providerBudget);
      f.services.providerBudget!.authorizationFor = async (...args) => {
        const authorized = await authorize(...args);
        if ('source_images' in request) { request.source_images[0].bytes.fill(0); request.source_images[0].sha256 = sha(request.source_images[0].bytes); }
        else request.images[0].object = { ...request.images[0].object, owner_id: 'bob' };
        return authorized;
      };
    });
    assert.equal(result.status, 'completed', modality); assert.equal(f.calls.length, 1);
    if (modality === 'image') assert.equal(f.calls[0].body.images[0].image_url, 'data:image/png;base64,' + Buffer.from(f.bytes).toString('base64'));
  }
});
for (const field of ['snapshot_id', 'state_version', 'canonical_version', 'content_revision', 'source_url', 'operation_id', 'stage'] as const) test(`research request cannot substitute current capture scope ${field}`, async () => {
  const f = await fixture(), request = researchRequest(f.context);
  request.scope = { ...request.scope, [field]: field === 'state_version' ? request.scope.state_version + 1 : field === 'source_url' ? 'https://different.example/product' : 'different' };
  const { request_sha256: _, ...metadata } = request; request.request_sha256 = sha(stableJson(metadata));
  await assert.rejects(f.runtime.research.execute(f.context, request), /RESEARCH_REQUEST_BINDING_MISMATCH/);
  assert.equal(f.textCalls(), 0); assert.equal((await f.read()).runs![0].child_operations, undefined);
});

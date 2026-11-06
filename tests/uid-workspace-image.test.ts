import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from '../tools/creative-quality/sharp.ts';
import { createWorkspaceImageTransport, decodeWorkspaceImage, WORKSPACE_IMAGE_GENERATE_ENDPOINT, WORKSPACE_IMAGE_EDIT_ENDPOINT, type WorkspaceImageOptions, type WorkspaceImageRequest } from '../uid-workspace-image.ts';
import { PostgresWorkspaceProviderBudget, type WorkspaceProviderOperation, type WorkspaceProviderBudgetAdapter } from '../uid-workspace-provider-budget.ts';
import { TABLE, NOW, before, capability, authorization, budgetRequest, fixtureBudget, imageRequest, encodedBody, sha } from './helpers/workspace-provider-fixture.ts';
const SECRET = 'fixture-credential-not-real';
const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { text_tokens: 60, image_tokens: 40 }, output_tokens_details: { text_tokens: 0, image_tokens: 20 } };
async function png(size = 256) { return new Uint8Array(await sharp({ create: { width: size, height: size, channels: 3, background: { r: 30, g: 80, b: 140 } } }).png().toBuffer()); }
function payload(bytes: Uint8Array, overrides: Record<string, unknown> = {}) { return { created: Math.floor(NOW / 1000), output_format: 'png', size: '256x256', quality: 'high', data: [{ b64_json: Buffer.from(bytes).toString('base64') }], usage, ...overrides }; }
function setup(request: WorkspaceImageRequest, response: unknown, overrides: Partial<WorkspaceImageOptions> = {}) {
  const endpoint = request.operation === 'edit' ? WORKSPACE_IMAGE_EDIT_ENDPOINT : WORKSPACE_IMAGE_GENERATE_ENDPOINT;
  const r = budgetRequest({ request_sha256: sha(encodedBody(request)), endpoint }); const s = fixtureBudget([r]);
  const calls: Array<{ url: string; init: RequestInit }> = [], order: string[] = [];
  const options: WorkspaceImageOptions = { serverCredential: { api_key: SECRET, project_id: 'project-one' }, capability, authorization: authorization(endpoint), budget: s.budget, decodeImage: decodeWorkspaceImage,
    bindReservation: async binding => { order.push('bind'); assert.equal(s.state().operations[0].state, 'reserved'); assert.equal(binding.request_sha256, r.request_sha256); },
    guardDispatch: async () => { order.push('guard'); assert.equal(s.state().operations[0].state, 'submission_intent'); }, now: () => NOW,
    fetch: async (url, init) => { order.push('fetch'); calls.push({ url: String(url), init: init! }); return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'provider-fixture' } }); }, ...overrides };
  return { ...s, options, calls, order, transport: createWorkspaceImageTransport(options) };
}
function wrapping(budget: WorkspaceProviderBudgetAdapter, overrides: Partial<WorkspaceProviderBudgetAdapter>): WorkspaceProviderBudgetAdapter { return { reserve: budget.reserve.bind(budget), markSubmissionIntent: budget.markSubmissionIntent.bind(budget), reconcile: budget.reconcile.bind(budget), releaseBeforeSubmit: budget.releaseBeforeSubmit.bind(budget), ...overrides }; }

test('real generate request -> streamed JSON -> full PNG decode -> shared journal settlement without network', async () => {
  const bytes = await png(), request = imageRequest(), s = setup(request, payload(bytes)); const result = await s.transport.submit(request);
  assert.equal(result.outcome, 'completed'); assert.equal(result.accounting, 'settled'); assert.equal(result.reconciliation_required, false); assert.equal(result.output?.sha256, sha(bytes)); assert.deepEqual(result.output?.bytes, bytes);
  assert.equal(result.output?.qc_verified, false); assert.deepEqual(s.order, ['bind', 'guard', 'fetch']); assert.equal(s.calls.length, 1); assert.equal(s.calls[0].url, WORKSPACE_IMAGE_GENERATE_ENDPOINT);
  const init = s.calls[0].init; assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.body, encodedBody(request));
  const body = JSON.parse(init.body as string); assert.equal(body.n, 1); assert.equal(body.model, capability.model); assert.equal(body.quality, 'high'); assert.equal(body.size, '256x256'); assert.equal(body.output_format, 'png'); assert.equal(body.max_output_tokens, undefined); assert.equal(body.max_cost, undefined);
  assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + SECRET); assert.equal(new Headers(init.headers).get('OpenAI-Project'), 'project-one');
  const op = s.state().operations[0] as WorkspaceProviderOperation; assert.equal(op.state, 'settled'); assert.equal(op.charged_microusd, 440); assert.deepEqual(op.report?.usage, usage); assert.ok(!JSON.stringify(s.state()).includes(SECRET));
});
test('edit sends exact actual source bytes through official JSON images data URIs, in order', async () => {
  const first = await png(), second = await png(512), output = await png(); const request = imageRequest({ operation: 'edit', source_images: [first, second].map((bytes, i) => ({ bytes, sha256: sha(bytes), mime_type: 'image/png', width: i ? 512 : 256, height: i ? 512 : 256 })) });
  const s = setup(request, payload(output)); const result = await s.transport.submit(request); assert.equal(result.outcome, 'completed'); assert.equal(s.calls[0].url, WORKSPACE_IMAGE_EDIT_ENDPOINT);
  const body = JSON.parse(s.calls[0].init.body as string); assert.equal(body.images.length, 2); body.images.forEach((item: { image_url: string }, i: number) => assert.deepEqual(Buffer.from(item.image_url.split(',')[1], 'base64'), Buffer.from([first, second][i])));
  const op = s.state().operations[0] as WorkspaceProviderOperation; assert.deepEqual(op.request.input_images.map(v => v.sha256), [sha(first), sha(second)]);
});
test('snapshot prevents async mutation of prompt/options/source bytes', async () => {
  const source = await png(), out = await png(), request = imageRequest({ operation: 'edit', source_images: [{ bytes: source, sha256: sha(source), mime_type: 'image/png', width: 256, height: 256 }] }); const body = encodedBody(request);
  const s = setup(request, payload(out), { decodeImage: async (bytes, mime) => { request.prompt = 'mutated'; request.operation_id = 'changed'; request.source_images[0].bytes.fill(0); return decodeWorkspaceImage(bytes, mime); } });
  const result = await s.transport.submit(request); assert.equal(result.outcome, 'completed'); assert.equal(s.calls[0].init.body, body); assert.equal(s.state().operations[0].request.operation_id, 'image-one');
});
test('input hashes, decoded dimensions, truncation, URLs and missing edit images are rejected before reservation', async () => {
  const bytes = await png();
  const candidates = [imageRequest({ operation: 'edit' }), imageRequest({ source_images: [{ bytes, sha256: sha(bytes), mime_type: 'image/png', width: 256, height: 256 }] }),
    imageRequest({ operation: 'edit', source_images: [{ bytes, sha256: '0'.repeat(64), mime_type: 'image/png', width: 256, height: 256 }] }),
    imageRequest({ operation: 'edit', source_images: [{ bytes, sha256: sha(bytes), mime_type: 'image/png', width: 512, height: 256 }] }),
    imageRequest({ operation: 'edit', source_images: [{ bytes: bytes.slice(0, 50), sha256: sha(bytes.slice(0, 50)), mime_type: 'image/png', width: 256, height: 256 }] })];
  for (const r of candidates) { const s = setup(r, payload(bytes)); assert.equal((await s.transport.submit(r)).submission, 'not_submitted'); assert.equal(s.calls.length, 0); assert.equal(s.state().operations.length, 0); }
  const request = imageRequest(); const s = setup(request, payload(bytes)); assert.equal((await s.transport.submit({ ...request, image_url: 'https://unapproved.test/image.png' } as never)).code, 'INVALID_IMAGE_REQUEST');
});
test('no independent exact cost ceiling -> zero dispatch, even when image request seems cheap', async () => {
  const bytes = await png(), r = imageRequest(), s = setup(r, payload(bytes)); const budget = new PostgresWorkspaceProviderBudget(s.pool, { ...s.config, verifiedBounds: [] });
  const result = await createWorkspaceImageTransport({ ...s.options, budget }).submit(r); assert.equal(result.code, 'BUDGET_DENIED'); assert.equal(s.calls.length, 0); assert.equal(s.state().operations.length, 0);
});
test('wrong endpoint, expired capability, different project and non-explicit request options fail closed', async () => {
  const r = imageRequest(), bytes = await png(), s = setup(r, payload(bytes));
  for (const patch of [{ n: 2 }, { quality: 'auto' }, { size: 'auto' }, { model: 'gpt-image-1' }, { output_format: 'svg' }, { budget_cap_microusd: 10001 }]) assert.equal((await s.transport.submit({ ...r, ...patch } as never)).code, 'INVALID_IMAGE_REQUEST');
  assert.equal((await createWorkspaceImageTransport({ ...s.options, authorization: authorization(WORKSPACE_IMAGE_EDIT_ENDPOINT) }).submit(r)).code, 'IMAGE_DESTINATION_NOT_AUTHORIZED');
  assert.throws(() => createWorkspaceImageTransport({ ...s.options, capability: { ...capability, expires_at: before } }), /INVALID_EXECUTION_ATTESTATION/);
  assert.throws(() => createWorkspaceImageTransport({ ...s.options, serverCredential: { api_key: SECRET, project_id: 'other' } }), /INVALID_EXECUTION_ATTESTATION/);
  assert.equal(s.calls.length, 0);
});
test('local and durable restart fences reject duplicates and changed prompts without another paid call', async () => {
  const r = imageRequest(), s = setup(r, payload(await png())); await s.transport.submit(r);
  assert.equal((await s.transport.submit(r)).code, 'OPERATION_ALREADY_ATTEMPTED'); assert.equal((await s.transport.submit({ ...r, prompt: 'changed' })).code, 'OPERATION_ID_CONFLICT');
  assert.equal((await createWorkspaceImageTransport(s.options).submit(r)).code, 'BUDGET_OPERATION_NOT_NEW'); assert.equal(s.calls.length, 1);
});
test('binding failure releases pre-intent reserve, but rejected dispatch after intent holds permanently', async () => {
  const r = imageRequest(), data = payload(await png());
  const a = setup(r, data, { bindReservation: async () => { throw new Error('fail'); } }); const bound = await a.transport.submit(r); assert.equal(bound.code, 'CHILD_BINDING_UNCONFIRMED'); assert.equal(bound.accounting, 'released'); assert.equal(a.calls.length, 0);
  const b = setup(r, data, { guardDispatch: async () => { throw new Error('revoked'); } }); const rejected = await b.transport.submit(r); assert.equal(rejected.code, 'CHILD_DISPATCH_REJECTED'); assert.equal(rejected.accounting, 'pending_reconciliation'); assert.equal(b.calls.length, 0); assert.equal(b.state().operations[0].state, 'submission_intent');
});
test('lost budget or intent acknowledgment never submits or blindly retries', async () => {
  const r = imageRequest(), data = payload(await png()); const a = setup(r, data); a.loseNextCommit(); const result = await a.transport.submit(r); assert.equal(result.code, 'BUDGET_RESERVATION_UNCONFIRMED'); assert.equal(a.calls.length, 0);
  const b = setup(r, data); const adapter = wrapping(b.budget, { markSubmissionIntent: async input => { await b.budget.markSubmissionIntent(input); throw new Error('lost-ack'); } });
  assert.equal((await createWorkspaceImageTransport({ ...b.options, budget: adapter }).submit(r)).code, 'SUBMISSION_INTENT_UNCONFIRMED'); assert.equal(b.calls.length, 0); assert.equal(b.state().operations[0].state, 'submission_intent');
});
test('timeout and non-JSON upstream failures retain full hold and unknown outcome', async () => {
  const r = imageRequest();
  const a = setup(r, {}, { fetch: async () => new Promise(() => {}), limits: { request_timeout_ms: 10 } }); const timed = await a.transport.submit(r); assert.equal(timed.code, 'PROVIDER_TIMEOUT_UNKNOWN'); assert.equal(timed.outcome, 'unknown'); assert.equal(timed.accounting, 'held');
  const b = setup(r, {}, { fetch: async () => new Response('gateway broke', { status: 502, headers: { 'content-type': 'text/plain' } }) }); const result = await b.transport.submit(r); assert.equal(result.outcome, 'unknown'); assert.equal(result.accounting, 'held');
});
test('response bytes actually streamed are bounded even if Content-Length lies', async () => {
  const r = imageRequest(); const s = setup(r, {}, { limits: { response_bytes: 256 }, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(257))); controller.close(); } }), { headers: { 'content-type': 'application/json', 'content-length': '1' } }) });
  const result = await s.transport.submit(r); assert.equal(result.outcome, 'unknown'); assert.equal(result.accounting, 'held'); assert.equal(result.output, undefined);
});
test('invalid output bytes/dimensions/type fail technical validation while known usage still settles', async () => {
  const bytes = await png(); const invalid = [payload(bytes.slice(0, 50)), payload(await png(512)), payload(bytes, { output_format: 'jpeg' }), payload(bytes, { data: [{ b64_json: '%%%%' }] }), payload(bytes, { data: [{ b64_json: Buffer.from(bytes).toString('base64'), url: 'https://unapproved.test/output' }] })];
  for (const data of invalid) { const r = imageRequest(), s = setup(r, data), result = await s.transport.submit(r); assert.equal(result.outcome, 'known_failure'); assert.equal(result.output, undefined); assert.equal(result.accounting, 'settled'); assert.deepEqual(result.usage, usage); }
});
test('missing usage/model mismatch retain hold; valid usage survives malformed image response', async () => {
  for (const data of [payload(await png(), { usage: undefined }), payload(await png(), { model: 'other-model' }), payload(await png(), { data: [] })]) {
    const r = imageRequest(), s = setup(r, data), result = await s.transport.submit(r); assert.equal(result.outcome, 'unknown'); assert.equal(result.accounting, 'held'); assert.equal(result.output, undefined);
  }
});
test('429 with no usage stays held; no retry despite Retry-After', async () => {
  let calls = 0; const r = imageRequest(), s = setup(r, {}, { fetch: async () => { calls++; return new Response(JSON.stringify({ error: { message: SECRET } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } }); } });
  const result = await s.transport.submit(r); assert.equal(result.outcome, 'known_failure'); assert.equal(result.accounting, 'held'); assert.equal(result.code, 'PROVIDER_REQUEST_REJECTED'); assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes(SECRET));
});
test('invalid usage cannot become accounting success; output and error payloads cannot leak key', async () => {
  const r = imageRequest(); const s = setup(r, payload(await png(), { usage: { ...usage, [SECRET]: 1 } })); const result = await s.transport.submit(r); assert.equal(result.usage, undefined); assert.equal(result.output, undefined); assert.equal(result.accounting, 'held'); assert.ok(!JSON.stringify(result).includes(SECRET));
  const bad = setup(r, {}, { fetch: async () => { throw new Error(SECRET); } }); assert.ok(!JSON.stringify(await bad.transport.submit(r)).includes(SECRET));
});
test('caller cancellation before submit has no effects; cancellation after fetch never retries', async () => {
  const controller = new AbortController(); controller.abort(); const r = imageRequest({ signal: controller.signal }), s = setup(r, {}); assert.equal((await s.transport.submit(r)).code, 'CANCELLED_BEFORE_SUBMIT'); assert.equal(s.state().operations.length, 0);
  const c = new AbortController(), r2 = imageRequest({ signal: c.signal }); const b = setup(r2, {}, { fetch: async () => { queueMicrotask(() => c.abort()); return new Promise(() => {}); } });
  const result = await b.transport.submit(r2); assert.equal(result.code, 'PROVIDER_CANCELLED_UNKNOWN'); assert.equal(result.accounting, 'held');
});
test('lost settlement receipt exposes pending reconciliation, never fake success', async () => {
  const r = imageRequest(), s = setup(r, payload(await png())); const adapter = wrapping(s.budget, { reconcile: async report => { await s.budget.reconcile(report); throw new Error('lost-ack'); } });
  const result = await createWorkspaceImageTransport({ ...s.options, budget: adapter }).submit(r); assert.equal(result.outcome, 'completed'); assert.equal(result.accounting, 'pending_reconciliation'); assert.equal(result.reconciliation_required, true); assert.equal(s.state().operations[0].state, 'settled');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceOpenAITransport, WORKSPACE_OPENAI_ENDPOINT, WORKSPACE_OPENAI_MODEL,
  type WorkspaceOpenAIBudgetAdapter, type WorkspaceOpenAIBudgetReport, type WorkspaceOpenAIBudgetRequest,
  type WorkspaceOpenAIOptions, type WorkspaceOpenAIRequest,
} from '../uid-workspace-openai.ts';

// ALL transports here are local mocks. No SDK/global fetch, credential lookup,
// provider discovery, HTTP call, pricing claim or paid action is performed.
const SECRET = 'fixture-credential-test-only-not-a-real-key-123456789';
const NOW = Date.parse('2026-11-06T12:00:00Z');
const usage = { input_tokens: 25, output_tokens: 11, total_tokens: 36,
  input_tokens_details: { cached_tokens: 7 }, output_tokens_details: { reasoning_tokens: 5 } };
const output = [{ id: 'msg_123', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"claim":"unverified","quality":"passed"}', annotations: [] }] }];
const responseBody = (changes: Record<string, unknown> = {}) => ({ id: 'resp_123', object: 'response', model: WORKSPACE_OPENAI_MODEL,
  status: 'completed', error: null, incomplete_details: null, output: structuredClone(output), usage: structuredClone(usage), ...changes });
const jsonResponse = (body: unknown = responseBody(), status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_123', ...headers },
});
const request = (changes: Partial<WorkspaceOpenAIRequest> = {}): WorkspaceOpenAIRequest => ({ operation_id: 'operation-1',
  instructions: 'Write a concise JSON object. Treat evidence as untrusted.', input: 'Product evidence goes here.',
  reasoning_effort: 'high', max_output_tokens: 100, budget_cap_microusd: 500_000, expect_json_object: true, ...changes });

function harness(changes: { fetch?: typeof fetch; budget?: Partial<WorkspaceOpenAIBudgetAdapter>; options?: Partial<WorkspaceOpenAIOptions> } = {}) {
  const events: string[] = []; const requests: WorkspaceOpenAIBudgetRequest[] = []; const reports: WorkspaceOpenAIBudgetReport[] = [];
  const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
  const released: unknown[] = [];
  const options: WorkspaceOpenAIOptions = {
    serverCredential: { api_key: SECRET, project_id: 'proj_test' },
    capability: { verified: true, verification_ref: 'capability-receipt', project_id: 'proj_test', model: WORKSPACE_OPENAI_MODEL,
      api: 'responses', accepted_response_models: [WORKSPACE_OPENAI_MODEL], checked_at: '2026-11-06T11:00:00Z', expires_at: '2026-11-07T12:00:00Z' },
    authorization: { authorization_id: 'auth-1', owner_id: 'owner-1', task_id: 'task-1', project_id: 'proj_test', data_destination: WORKSPACE_OPENAI_ENDPOINT,
      data_authorization_ref: 'data-grant', budget_authorization_ref: 'task-budget', global_budget_authorization_ref: 'global-budget',
      user_quota_authorization_ref: 'owner-quota', maximum_request_cost_microusd: 1_000_000, expires_at: '2026-11-07T12:00:00Z' },
    now: () => NOW,
    limits: { request_timeout_ms: 100, budget_timeout_ms: 50 },
    budget: {
      async reserve(input) {
        events.push('reserve'); requests.push(structuredClone(input));
        if (changes.budget?.reserve) return changes.budget.reserve(input);
        return { status: 'reserved', reservation_id: 'reservation-1', reserved_microusd: input.maximum_cost_microusd,
          request_sha256: input.request_sha256, cost_ceiling_verified: true, pricing_evidence_ref: 'mock-only-price-receipt' };
      },
      async markSubmissionIntent(input) { events.push('intent'); return changes.budget?.markSubmissionIntent?.(input) ?? { ok: true }; },
      async reconcile(input) {
        events.push('reconcile'); reports.push(structuredClone(input));
        return changes.budget?.reconcile?.(input) ?? { status: input.usage ? 'settled' : 'held', receipt_id: 'budget-receipt-1' };
      },
      async releaseBeforeSubmit(input) { events.push('release'); released.push(input); return changes.budget?.releaseBeforeSubmit?.(input) ?? { released: true }; },
    },
    fetch: async (url, init) => { events.push('fetch'); calls.push({ url, init }); return changes.fetch ? changes.fetch(url, init) : jsonResponse(); },
    ...changes.options,
  };
  return { transport: createWorkspaceOpenAITransport(options), options, calls, events, requests, reports, released };
}

test('fixed Responses payload, server credential and pre-submit durable reservation; output is never QC', async () => {
  const h = harness(); const result = await h.transport.submit(request());
  assert.deepEqual(h.events, ['reserve', 'intent', 'fetch', 'reconcile']);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, WORKSPACE_OPENAI_ENDPOINT);
  const init = h.calls[0].init!; const headers = new Headers(init.headers);
  assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
  assert.equal(headers.get('authorization'), `Bearer ${SECRET}`); assert.equal(headers.get('openai-project'), 'proj_test');
  assert.deepEqual(JSON.parse(init.body as string), { model: WORKSPACE_OPENAI_MODEL, instructions: request().instructions, input: request().input,
    reasoning: { effort: 'high' }, max_output_tokens: 100, store: false, stream: false });
  assert.equal(headers.get('x-client-request-id'), result.client_request_id); assert.equal(headers.get('idempotency-key'), result.client_request_id);
  assert.equal(result.outcome, 'completed'); assert.equal(result.submission, 'submitted'); assert.equal(result.accounting, 'settled');
  assert.equal(result.reconciliation_required, false); assert.equal(result.output?.trust, 'untrusted_model_output'); assert.equal(result.output?.qc_verified, false);
  assert.deepEqual(result.usage, usage); assert.equal(result.provider_request_id, 'req_123'); assert.equal(result.response_id, 'resp_123');
  assert.deepEqual(h.reports[0].usage, usage); assert.equal(JSON.stringify(h.reports).includes(SECRET), false);
  assert.equal(h.requests[0].owner_id, 'owner-1'); assert.equal(h.requests[0].task_id, 'task-1'); assert.equal(h.requests[0].project_id, 'proj_test');
  assert.equal(h.requests[0].global_budget_authorization_ref, 'global-budget'); assert.equal(h.requests[0].user_quota_authorization_ref, 'owner-quota');
  assert.equal(h.requests[0].maximum_cost_microusd, 500_000); // Full user-set cap, no invented token-cost estimate.
});

test('factory requires current verified capability, matching project, task data and user/global budget grants', () => {
  const { options } = harness();
  for (const change of [
    { serverCredential: { ...options.serverCredential, project_id: 'proj_wrong' } },
    { serverCredential: { api_key: '', project_id: 'proj_test' } },
    { capability: { ...options.capability, verified: false } },
    { capability: { ...options.capability, model: 'gpt-other' } },
    { capability: { ...options.capability, accepted_response_models: ['gpt-other'] } },
    { capability: { ...options.capability, checked_at: '2030-01-01' } },
    { capability: { ...options.capability, expires_at: '2020-01-01' } },
    { authorization: { ...options.authorization, data_destination: 'https://evil.test' } },
    { authorization: { ...options.authorization, global_budget_authorization_ref: '' } },
    { authorization: { ...options.authorization, user_quota_authorization_ref: '' } },
    { authorization: { ...options.authorization, expires_at: '2020-01-01' } },
    { authorization: { ...options.authorization, maximum_request_cost_microusd: 0 } },
    { fetch: undefined }, { budget: undefined }, { limits: { request_timeout_ms: 120_001 } },
  ]) assert.throws(() => createWorkspaceOpenAITransport({ ...options, ...change } as WorkspaceOpenAIOptions));
});

test('transport refuses browser runtime even when a caller supplies a credential', () => {
  const { options } = harness(); const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    assert.throws(() => createWorkspaceOpenAITransport(options), /SERVER_ONLY_TRANSPORT/);
  } finally { if (old) Object.defineProperty(globalThis, 'window', old); else delete (globalThis as unknown as Record<string, unknown>).window; }
});

test('no caller host/model/headers/tools/provider options or secret prompt can reach the network', async () => {
  for (const extra of [{ model: 'gpt-other' }, { host: 'https://evil.test' }, { baseURL: 'https://evil.test' }, { headers: { Authorization: 'other' } },
    { api_key: SECRET }, { temperature: 1 }, { tools: [] }, { retries: 3 }, { store: true }, { input: SECRET }, { instructions: SECRET },
    { reasoning_effort: 'ultra' }, { max_output_tokens: 50_000 }, { budget_cap_microusd: 1_000_001 }, { input: 'x'.repeat(300_000) }]) {
    const h = harness(); const result = await h.transport.submit({ ...request(), ...extra } as WorkspaceOpenAIRequest);
    assert.equal(result.outcome, 'failed_before_submit'); assert.equal(h.calls.length, 0); assert.equal(h.requests.length, 0);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test('request-byte limit counts encoded JSON rather than only raw input characters', async () => {
  const h = harness({ options: { limits: { request_bytes: 300 } } });
  const result = await h.transport.submit(request({ input: '\\'.repeat(100), instructions: 'Return JSON' }));
  assert.equal(result.code, 'REQUEST_TOO_LARGE'); assert.equal(h.calls.length, 0);
});

test('reserve denied or thrown cannot submit, reflect adapter errors, or retry automatically', async () => {
  for (const reserve of [async () => ({ status: 'denied' as const }), async () => { throw new Error(SECRET); }]) {
    const h = harness({ budget: { reserve } }); const result = await h.transport.submit(request());
    assert.equal(result.outcome, 'failed_before_submit'); assert.equal(h.calls.length, 0); assert.equal(h.requests.length, 1);
    assert.equal(JSON.stringify(result).includes(SECRET), false); assert.equal(h.reports.length, 0);
  }
});

test('reservation must match the exact fingerprint and full cap and attest a verified conservative bound', async () => {
  for (const mutation of [{ reserved_microusd: 1 }, { request_sha256: 'wrong' }, { cost_ceiling_verified: false }, { pricing_evidence_ref: '' }, { reservation_id: SECRET }]) {
    const h = harness({ budget: { reserve: async input => ({ status: 'reserved', reservation_id: 'r1', reserved_microusd: input.maximum_cost_microusd,
      request_sha256: input.request_sha256, cost_ceiling_verified: true, pricing_evidence_ref: 'mock-price', ...mutation }) as Awaited<ReturnType<WorkspaceOpenAIBudgetAdapter['reserve']>> } });
    const result = await h.transport.submit(request());
    assert.equal(result.code, 'INVALID_BUDGET_RESERVATION'); assert.equal(h.calls.length, 0); assert.equal(result.reconciliation_required, true);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test('durable duplicate/conflict/unknown reservation is never resubmitted by another instance', async () => {
  for (const status of ['duplicate', 'conflict', 'unknown'] as const) {
    const h = harness({ budget: { reserve: async () => ({ status }) } });
    const result = await h.transport.submit(request()); assert.equal(result.code, 'BUDGET_OPERATION_NOT_NEW');
    assert.equal(h.calls.length, 0); assert.equal(result.reconciliation_required, true);
  }
});

test('submission intent failure is before-submit but retains budget for reconciliation', async () => {
  for (const markSubmissionIntent of [async () => ({ ok: false }), async () => { throw new Error(SECRET); }]) {
    const h = harness({ budget: { markSubmissionIntent } }); const result = await h.transport.submit(request());
    assert.equal(result.submission, 'not_submitted'); assert.equal(result.reconciliation_required, true);
    assert.equal(h.calls.length, 0); assert.equal(h.released.length, 0); assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test('pre-abort does not reserve; cancellation during reservation safely releases before fetch', async () => {
  const signal1 = new AbortController(); signal1.abort(); const first = harness();
  assert.equal((await first.transport.submit(request({ signal: signal1.signal }))).code, 'CANCELLED_BEFORE_SUBMIT'); assert.equal(first.requests.length, 0);
  const signal2 = new AbortController();
  const second = harness({ budget: { reserve: async input => {
    signal2.abort(); return { status: 'reserved', reservation_id: 'r1', reserved_microusd: input.maximum_cost_microusd, request_sha256: input.request_sha256,
      cost_ceiling_verified: true, pricing_evidence_ref: 'mock-price' };
  } } });
  const result = await second.transport.submit(request({ signal: signal2.signal }));
  assert.equal(result.accounting, 'released'); assert.equal(result.reconciliation_required, false); assert.equal(second.calls.length, 0); assert.equal(second.released.length, 1);
});

test('authorization expiration after reservation cannot send and releases only before submission', async () => {
  let now = NOW;
  const h = harness({ options: { now: () => now }, budget: { markSubmissionIntent: async () => { now += 3 * 86400_000; return { ok: true }; } } });
  const result = await h.transport.submit(request()); assert.equal(result.code, 'AUTHORIZATION_EXPIRED');
  assert.equal(result.accounting, 'released'); assert.equal(h.calls.length, 0);
});

test('duplicate and concurrent operation invocations execute at most once and changed payload conflicts', async () => {
  const h = harness(); const [first, second] = await Promise.all([h.transport.submit(request()), h.transport.submit(request())]);
  assert.equal(first.outcome, 'completed'); assert.equal(second.code, 'OPERATION_ALREADY_ATTEMPTED'); assert.equal(h.calls.length, 1);
  assert.equal((await h.transport.submit(request({ input: 'Changed input' }))).code, 'OPERATION_ID_CONFLICT'); assert.equal(h.calls.length, 1);
});

test('capacity is bounded, including retained operation fences', async () => {
  const h = harness({ options: { limits: { max_operations_per_instance: 1 } } });
  await h.transport.submit(request()); const next = await h.transport.submit(request({ operation_id: 'op-2' }));
  assert.equal(next.code, 'LOCAL_CAPACITY_EXCEEDED'); assert.equal(h.calls.length, 1);
  let unlock!: () => void; const barrier = new Promise<void>(resolve => { unlock = resolve; });
  const parallel = harness({ options: { limits: { max_in_flight: 1 } }, fetch: async () => { await barrier; return jsonResponse(); } });
  const pending = parallel.transport.submit(request());
  const blocked = await parallel.transport.submit(request({ operation_id: 'op-2' }));
  assert.equal(blocked.code, 'LOCAL_CAPACITY_EXCEEDED'); unlock(); assert.equal((await pending).outcome, 'completed');
});

test('exact reported usage including cached/reasoning and unknown numeric details is retained, never estimated', async () => {
  const exact = { ...usage, input_tokens_details: { cached_tokens: 7, future_detail: 2 }, output_tokens_details: { reasoning_tokens: 5, future_count: null } };
  const h = harness({ fetch: async () => jsonResponse(responseBody({ usage: exact })) }); const result = await h.transport.submit(request());
  assert.deepEqual(result.usage, exact); assert.deepEqual(h.reports[0].usage, exact);
  assert.equal('cost' in result, false); assert.equal('estimated_tokens' in result, false);
});

test('missing/malformed usage withholds completion and full reservation; a model cannot invent usage', async () => {
  for (const bad of [undefined, null, { ...usage, total_tokens: 500 }, { ...usage, input_tokens: -1 }, { ...usage, output_tokens: 1.2 },
    { ...usage, input_tokens_details: { cached_tokens: 26 } }, { ...usage, output_tokens_details: { reasoning_tokens: 12 } }, { ...usage, secret: SECRET }]) {
    const h = harness({ fetch: async () => jsonResponse(responseBody({ usage: bad })) }); const result = await h.transport.submit(request());
    assert.equal(result.outcome, 'unknown'); assert.equal(result.output, undefined); assert.equal(result.usage, undefined);
    assert.equal(result.accounting, 'held'); assert.equal(h.reports[0].usage, undefined); assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test('wrong provider model, invalid IDs and non-response envelope cannot be accepted', async () => {
  for (const bad of [{ model: 'gpt-cheap-fallback' }, { id: SECRET }, { id: 'https://evil.test' }, { object: 'chat.completion' }, { status: 'in_progress' }]) {
    const h = harness({ fetch: async () => jsonResponse(responseBody(bad)) }); const result = await h.transport.submit(request());
    assert.equal(result.outcome, 'unknown'); assert.equal(result.output, undefined); assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test('incomplete/failed/cancelled provider result is a known failure, not partial output or free usage', async () => {
  for (const status of ['incomplete', 'failed', 'cancelled']) {
    const h = harness({ fetch: async () => jsonResponse(responseBody({ status, error: { message: SECRET } })) });
    const result = await h.transport.submit(request()); assert.equal(result.outcome, 'known_failure'); assert.equal(result.output, undefined);
    assert.deepEqual(result.usage, usage); assert.equal(result.accounting, 'settled'); assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test('only one complete assistant text message is accepted, never tool calls/refusals/empty/partial content', async () => {
  for (const bad of [[], [{ ...output[0], status: 'in_progress' }], [{ ...output[0], role: 'user' }], [output[0], output[0]],
    [{ type: 'function_call', arguments: '{}' }, output[0]], [{ ...output[0], content: [{ type: 'refusal', refusal: 'no' }] }],
    [{ ...output[0], content: [{ type: 'output_text', text: '' }] }], [{ ...output[0], content: [{ type: 'output_text', text: SECRET }] }]]) {
    const h = harness({ fetch: async () => jsonResponse(responseBody({ output: bad })) }); const result = await h.transport.submit(request());
    assert.equal(result.outcome, 'known_failure'); assert.equal(result.output, undefined); assert.equal(result.accounting, 'settled');
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test('local JSON contract rejects syntactically broken, primitive and array answers without claiming schema validation', async () => {
  for (const text of ['{"incomplete":', '[]', 'null', 'false', '```json\n{}\n```']) {
    const h = harness({ fetch: async () => jsonResponse(responseBody({ output: [{ ...output[0], content: [{ type: 'output_text', text }] }] })) });
    const result = await h.transport.submit(request()); assert.equal(result.outcome, 'known_failure'); assert.equal(result.output, undefined);
  }
  const text = 'Ordinary text answer'; const h = harness({ fetch: async () => jsonResponse(responseBody({ output: [{ ...output[0], content: [{ type: 'output_text', text }] }] })) });
  assert.equal((await h.transport.submit(request({ expect_json_object: false }))).output?.text, text);
});

test('reasoning item is not exposed or treated as quality evidence', async () => {
  const h = harness({ fetch: async () => jsonResponse(responseBody({ output: [{ type: 'reasoning', id: 'rs_123', summary: [] }, ...output] })) });
  const result = await h.transport.submit(request()); assert.equal(result.outcome, 'completed'); assert.equal(result.output?.qc_verified, false);
  assert.equal(JSON.stringify(result).includes('rs_123'), false);
});

test('HTTP rejection is a known failure, server uncertainty stays unknown, and neither retries nor releases budget', async () => {
  for (const status of [400, 401, 403, 429, 500, 502, 503, 504]) {
    const h = harness({ fetch: async () => jsonResponse({ error: { message: SECRET } }, status, { 'retry-after': '0' }) });
    const result = await h.transport.submit(request());
    assert.equal(result.outcome, status < 500 ? 'known_failure' : 'unknown'); assert.equal(h.calls.length, 1); assert.equal(result.accounting, 'held');
    assert.equal(result.http_status, status); assert.equal(result.provider_request_id, 'req_123'); assert.equal(h.released.length, 0);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test('malformed JSON/UTF-8/MIME or redirected response is unknown and cannot yield text', async () => {
  const badResponses = [new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
    Object.assign(jsonResponse(), { }),
  ];
  Object.defineProperty(badResponses[3], 'redirected', { value: true });
  for (const response of badResponses) {
    const h = harness({ fetch: async () => response }); const result = await h.transport.submit(request());
    assert.equal(result.outcome, 'unknown'); assert.equal(result.output, undefined); assert.equal(result.accounting, 'held');
  }
});

test('response size is bounded for both Content-Length and streamed bytes; oversize reader is cancelled', async () => {
  const declared = harness({ options: { limits: { response_bytes: 32 } }, fetch: async () => jsonResponse(responseBody(), 200, { 'content-length': '1000' }) });
  assert.equal((await declared.transport.submit(request())).outcome, 'unknown');
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
  const streamed = harness({ options: { limits: { response_bytes: 32 } }, fetch: async () => new Response(stream, { headers: { 'content-type': 'application/json' } }) });
  const result = await streamed.transport.submit(request());
  assert.equal(result.outcome, 'unknown'); assert.equal(cancelled, true); assert.equal(streamed.calls.length, 1);
});

test('deadline bounds a fetch that ignores abort; outcome is unknown and same operation never retries', async () => {
  const h = harness({ options: { limits: { request_timeout_ms: 15 } }, fetch: async () => new Promise<Response>(() => {}) });
  const result = await h.transport.submit(request()); assert.equal(result.code, 'PROVIDER_TIMEOUT_UNKNOWN'); assert.equal(result.submission, 'submitted');
  assert.equal(result.accounting, 'held'); assert.equal(h.calls.length, 1); assert.equal(h.released.length, 0);
  assert.equal((await h.transport.submit(request())).code, 'OPERATION_ALREADY_ATTEMPTED'); assert.equal(h.calls.length, 1);
});

test('deadline also bounds a never-ending response body after headers arrive', async () => {
  let cancelled = false;
  const h = harness({ options: { limits: { request_timeout_ms: 15 } }, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }),
    { headers: { 'content-type': 'application/json', 'x-request-id': 'req_partial' } }) });
  const result = await h.transport.submit(request()); assert.equal(result.code, 'PROVIDER_TIMEOUT_UNKNOWN');
  assert.equal(result.provider_request_id, 'req_partial'); assert.equal(result.outcome, 'unknown'); assert.equal(cancelled, true);
});

test('a late response after timeout is cancelled and never changes the recorded unknown outcome or settles twice', async () => {
  let arrive!: (response: Response) => void; let cancelled = false;
  const h = harness({ options: { limits: { request_timeout_ms: 10 } }, fetch: async () => new Promise<Response>(resolve => { arrive = resolve; }) });
  const result = await h.transport.submit(request()); assert.equal(result.outcome, 'unknown');
  arrive(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, true); assert.equal(h.reports.length, 1); assert.equal(h.reports[0].outcome, 'unknown');
  assert.equal(h.reports[0].usage, undefined); assert.equal(result.output, undefined); assert.equal(h.calls.length, 1);
});

test('caller abort after fetch is unknown and keeps reservation', async () => {
  const controller = new AbortController();
  const h = harness({ fetch: async () => { controller.abort(); return new Promise<Response>(() => {}); } });
  const result = await h.transport.submit(request({ signal: controller.signal })); assert.equal(result.code, 'PROVIDER_CANCELLED_UNKNOWN');
  assert.equal(result.submission, 'submitted'); assert.equal(result.accounting, 'held'); assert.equal(h.released.length, 0);
});

test('transport and error bodies cannot leak secrets even via provider IDs or thrown errors', async () => {
  const thrown = harness({ fetch: async () => { throw new Error(`Fetch failed Authorization: Bearer ${SECRET}`); } });
  const result = await thrown.transport.submit(request()); assert.equal(result.outcome, 'unknown'); assert.equal(JSON.stringify(result).includes(SECRET), false);
  const echoed = harness({ fetch: async () => jsonResponse(responseBody({ error: { message: SECRET } }), 500, { 'x-request-id': SECRET }) });
  const second = await echoed.transport.submit(request()); assert.equal(second.provider_request_id, undefined); assert.equal(JSON.stringify(second).includes(SECRET), false);
});

test('settlement uses only real usage; settlement failure retains evidence and requires reconciliation', async () => {
  const h = harness({ budget: { reconcile: async () => { throw new Error(SECRET); } } });
  const result = await h.transport.submit(request()); assert.equal(result.outcome, 'completed'); assert.equal(result.accounting, 'pending_reconciliation');
  assert.equal(result.reconciliation_required, true); assert.deepEqual(result.usage, usage); assert.equal(result.response_id, 'resp_123');
  assert.equal(result.output?.qc_verified, false); assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal((await h.transport.submit(request())).code, 'OPERATION_ALREADY_ATTEMPTED'); assert.equal(h.calls.length, 1);
  const zero = harness({ fetch: async () => jsonResponse(responseBody({ usage: null })), budget: { reconcile: async () => ({ status: 'settled', receipt_id: 'false-settlement' }) } });
  const rejected = await zero.transport.submit(request()); assert.equal(rejected.accounting, 'pending_reconciliation'); assert.equal(rejected.budget_receipt_id, undefined);
});

test('budget adapter deadlines do not submit or pretend a late reservation was rolled back', async () => {
  const h = harness({ options: { limits: { budget_timeout_ms: 10 } }, budget: { reserve: async () => new Promise(() => {}) } });
  const result = await h.transport.submit(request()); assert.equal(result.code, 'BUDGET_RESERVATION_UNCONFIRMED');
  assert.equal(result.accounting, 'pending_reconciliation'); assert.equal(h.calls.length, 0); assert.equal(h.released.length, 0);
});

test('unresponsive settlement is bounded without losing real usage or releasing the reservation', async () => {
  const h = harness({ options: { limits: { budget_timeout_ms: 10 } }, budget: { reconcile: async () => new Promise(() => {}) } });
  const result = await h.transport.submit(request()); assert.equal(result.outcome, 'completed'); assert.deepEqual(result.usage, usage);
  assert.equal(result.accounting, 'pending_reconciliation'); assert.equal(result.reconciliation_required, true); assert.equal(h.released.length, 0);
});

test('mutable caller request/options cannot change submission after reservation', async () => {
  let unlock!: () => void; const barrier = new Promise<void>(resolve => { unlock = resolve; });
  const h = harness({ budget: { markSubmissionIntent: async () => { await barrier; return { ok: true }; } } });
  const submitted = request(); const pending = h.transport.submit(submitted);
  submitted.input = 'attacker content'; submitted.operation_id = 'attacker-op'; submitted.expect_json_object = false;
  h.options.authorization.owner_id = 'another-user'; h.options.serverCredential.api_key = 'changed';
  h.options.capability.accepted_response_models.push('gpt-other'); unlock();
  const result = await pending; assert.equal(result.outcome, 'completed');
  assert.equal(JSON.parse(h.calls[0].init!.body as string).input, request().input); assert.equal(h.requests[0].owner_id, 'owner-1');
  assert.equal(h.requests[0].operation_id, 'operation-1'); assert.equal(new Headers(h.calls[0].init!.headers).get('authorization'), `Bearer ${SECRET}`);
});

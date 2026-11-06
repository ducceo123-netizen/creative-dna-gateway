# Images and modality-aware shared budget (server only)

## Implemented, not enabled

`uid-workspace-image.ts` implements actual OpenAI Images API request construction,
bounded streaming JSON, exact edit input bytes, complete raster decode and output
hashing. `uid-workspace-provider-budget.ts` implements multimodal accounting on the
**existing** `uid-workspace-budget-v1` project row. There is no live network call,
credential lookup, SQL migration, config installation or commercial-price default.

Fixtures inject a fake HTTP transport, synthetic images, invented prices and explicit
synthetic bound evidence. They prove request/response/accounting logic, not project
access, billing guarantees, real generation quality or EO improvement.

## Concrete API

- Model: explicit `gpt-image-2.5-flare`, never implicit model fallback.
- Generation: POST `https://api.openai.com/v1/images/generations`.
- Editing: POST `https://api.openai.com/v1/images/edits`, JSON `images` array with
  exact base64 data URIs. Actual source bytes are copied, SHA-256 checked, MIME
  checked and fully decoded before reserve. No external image URLs or file IDs.
- Explicit `n:1`, `quality`, `size`, `output_format`, `stream:false`. No tools, GIF,
  SVG, preview-only features, masks or prompt rewriting. Only a conservative
  supported subset of dimensions and qualities is exposed, further restricted by
  current per-project capability evidence.
- JSON byte SHA binds every provider parameter and every input image byte. Stable
  client/request headers are correlation, **not proof of provider idempotency**.
- Exact decoded output size and MIME are checked against the request. Encoded,
  streamed and decoded sizes are independently bounded; Content-Length is not
  trusted. Full `sharp.stats()` decode is required, not header sniffing alone.
- Output remains `untrusted_model_output`, `qc_verified:false`. Byte validation
  does not prove product fidelity, artistic quality, factual correctness or EO.

## Binding and failure boundaries

The trusted composition supplies server-only credential, current project capability,
exact task/data/budget authorization, real budget, fetch, full decoder,
`bindReservation(binding)` and `guardDispatch()`.

Order: validate/snapshot/decode inputs -> shared reserve -> durable child binding ->
durable single-use submission intent -> current runtime dispatch guard -> one HTTP
request -> retain usage -> settle/hold. The guard is wired to the parent's child
operation journal and checks current member/action/lease/cancellation.

No retry follows duplicate/conflict, timeout, crash, unknown response, lost commit,
missing usage or unknown reconciliation. Only reservations with no durable intent
can be released. After intent, even a local cancellation or guard failure retains
its fence and hold. Non-2xx responses do not imply zero billed usage. Numeric usage
is retained even if image decoding fails. Invalid bytes cannot become artifacts.

## No fabricated image cost guarantee

The reviewed API references do not document `max_cost` or an Images output-token
ceiling. An application cap, timeout, response-byte limit or advertised typical
per-image price **does not bound provider charges**.

The generic journal therefore requires an independently reviewed exact-request
`WorkspaceProviderVerifiedBound`, including project, endpoint, model, modality,
request SHA, source evidence, reviewer, expiry and all four token ceilings. It is
an immutable trusted operator collection, never request/model input. No entries
are installed by this code. Without one, reserve denies before HTTP.

Before any live enablement an operator must establish that the independent evidence
really bounds *all* billed tokens for that exact request, including image input,
framing and output behavior. `reviewed_exhaustive_upper_bound` is an evidence
contract, not a mathematical guarantee supplied by this module. Do not populate
it with an estimate or make fixture evidence production configuration. If no
independent defensible ceiling exists, leave Images execution disabled.

## Shared ledger and authorization

`PostgresWorkspaceProviderBudget` uses the same qualified table, version, project
row, RLS scope and `uid-workspace-budget:<project>` advisory lock as
`PostgresWorkspaceBudget`. Both see the same `operations[]`, global/member/task
caps, frozen state and owner/task/operation fences. No separate modality pool.

Existing grants do not implicitly authorize a new modality. A task grant needs
explicit `provider_authorizations[]` for endpoint, model, modality, data evidence,
capability evidence, request ceiling and validity. Parent grant revocation, expiry,
changed admission policy and reduced caps are rechecked before dispatch. No grant
provisioning happens here. Text reconcile explicitly rejects modality rows; the
provider journal rejects legacy rows. Current SQL/RLS integration still requires
real PostgreSQL review/testing; the tests use a deterministic SQL-protocol fake.

Pricing is separate text-input/image-input/text-output/image-output microusd per
million tokens, with conservative reachable context tiers. Cached input is charged
at normal rate. Usage without a modality split is conservatively charged at the
highest applicable input/output rate, never priced as cheap text by default.
Usage exceeding a verified bucket or reservation freezes the **shared** project.
Unknown outcomes retain the full hold, and any reported cost is still retained.
Later exact reconciliation can settle once; conflicting reports cannot rewrite it.

## Runtime integration

Create transport inside the reviewed child operation's server submit adapter.
Use `context.provider_operation.operation_id` as request operation ID. Wire
`bindReservation` to `context.bindProviderOperation({provider:'openai-images', ...})`
and `guardDispatch` to `services.operations.guardDispatch(context)`.
Return the transport's normalized IDs/accounting to the child journal. Do not
accept image bytes when `accounting !== 'settled'` or reconciliation is required.
Retain output bytes privately before progressing to independent pixel QC.

Responses vision uses the same budget interface with `modality:'responses_vision'`,
fixed Responses endpoint, actual image manifest (up to 96), explicit max output
text tokens and independently reviewed exact input bound. Images remain max16.
No text-only token estimator is reused for image inputs.

## Validation

`node --import tsx --test tests/uid-workspace-image.test.ts tests/uid-workspace-provider-budget.test.ts`

Coverage: real PNG decode; edit source ordering/integrity; immutable request
snapshot; MIME/dimension/truncation failures; byte limits despite false headers;
exact-bound denial; project/data/endpoint scope; mixed legacy/provider concurrency
and quota sums; durable restart/conflict fences; lost commit acknowledgments;
intent/binding/guard ordering; cancellation; timeout; 429; usage retention;
settlement failures; overrun freeze; vision usage buckets. No paid calls.

## Official sources reviewed 2026-11-06

- https://developers.openai.com/api/docs/models/gpt-image-2.5-flare
- https://developers.openai.com/api/reference/resources/images/methods/generate
- https://developers.openai.com/api/reference/resources/images/methods/edit

These establish documented request/response shapes, not this project's current
model entitlement or a hard billing ceiling.

### Reviewed dynamic bound resolver

For future automatic briefs, an operator may inject `boundResolver`, a reviewed
non-spending algorithm with pinned independent evidence, reviewer, review ref and
expiry. `resolveVerifiedBound(request)` executes outside SQL; it returns an exact
request bound or null. The journal rechecks its origin, exact SHA/project/endpoint/
model, expiry and current pricing inside the atomic reserve. Exceptions, estimates,
wrong evidence origin or mismatches deny. There is no built-in algorithm, no
LLM-derived guarantee and no fallback to a caller cap. This is a composition seam
for independently verified bounding methods, not proof that such an Images API
method exists today.

`readiness()` reports current pricing/bound infrastructure and precise missing
conditions. It explicitly does not attest task authorization or any specific
request bound. A key/capability alone cannot produce budget readiness.

# Onepage semantic research adapter

`uid-workspace-research.ts` is a reusable **server-only** implementation of
`WorkspaceOnepageOptions.acquireResearch`. It is not wired to production by
importing the module. No constructor discovers credentials, opens sockets,
submits a model request, modifies canonical rules or changes the ChatGPT/MCP path.

## Implemented execution

1. Verify the authenticated owner/task/run snapshot and exact Onepage canonical
   version, including the current GTK/FAQ template hashes. Bind every operation to
   the complete packet digest and source URL.
2. Capture the brief URL using `WorkspacePublicSourceProvider`, reopen its retained
   document, check the original bytes/hash/scope, and enforce document limits.
3. If a trusted discovery adapter exists, read its bounded search attempt receipts
   and exact candidate URLs. Otherwise record which discovery capabilities are
   unavailable. Collection input requires discovered exact target PDPs and a
   known discovered-product count; it cannot pass as one representative product.
4. Ask an injected budgeted semantic operation to extract each document into a
   strict, closed schema. Quotes must occur in the actual reopened document; media
   URLs must resolve from literal document locators. IDs, variants, source and
   canonical bindings, section/detail references and review sample counts are
   checked in code. Source content stays in `untrusted_input`, never instructions.
5. Require a separate trusted inventory adapter for target-PDP completeness.
   Compare the exact ordered media list and detail IDs with its scoped retained
   inspection receipt. HTTP bytes, a model declaration, HTML metadata and an image
   decoder are not proof that lazy loading, variants or accordions were explored.
6. Consume the exact retained full-image captures returned by the inventory,
   reopen and decode those originals through the source provider, then send the
   same immutable image bytes to the vision operation. Research never refetches
   an image URL already captured by that inventory. Mark an item `image_view` only after an exact bound vision
   result with concrete observations and a consistent product identity. A failed
   capture stays unavailable. Unsupported video stays unsupported. Missing
   inventory/media blocks synthesis and retains an honest diagnostic envelope.
7. Ask a semantic assembly operation for product-line naming, evidence-linked
   claims, buyer insights and the FAQ-versus-GTK content plan. It cannot rewrite
   scope, source coverage, social findings or source receipts. Validate every
   claimed source/item, product identity, collection count and source-grounded
   banner keyword.
8. Run the existing product research, Pinterest, Reddit and Onepage content-plan
   evaluators unchanged. Their structural results are not semantic or visual QC.
   Independent review, actual product/render inspection and user content approval
   still apply downstream.

The product and collection fixtures demonstrate this chain with original HTML
bytes and real decodable PNG bytes. Fixture semantic/vision responses and browser
inventory declarations are **synthetic test doubles**. They do not establish
live-source completeness, product truth, visual quality or comparative quality
above the current ChatGPT workflow.

## Composition

Construct `createWorkspaceResearchAdapter` with:

- `sources`: the safe public provider's `capture` and `reopen` methods.
- `objects`: the same private object custody store for exact retained reads.
- `writeRunArtifact`: the runtime's durable, owner/task/run-fenced writer. The
  research module never calls a raw object-store `put`.
- `operations.execute`: the reviewed semantic/vision bridge. The existing
  `createWorkspaceProviderRuntime(...).research` implements this integration with
  the durable child-operation journal and budgeted transports.
- `operations.verify`: independent verification against that durable journal,
  required immediately after dispatch and when retained evidence is reopened.
- `budgets`: positive semantic-call, vision-call and total maximum-exposure caps
  in integer micro-USD. This local ceiling supplements, never replaces, provider
  task/user/global budget reservation and settlement.
- Optional `timeoutMs`: the whole acquisition deadline in integer milliseconds,
  default `120000`, valid range `1..1800000` (30 minutes maximum).
- Optional `reopenTimeoutMs`: a separate whole evidence-reopening deadline,
  default `120000`, valid range `1..300000` (5 minutes maximum). Extending acquisition
  does not extend reopening.
- Optional `discover` and `inspectInventory`: trusted integrations described
  below. No model or incoming HTTP payload may install or implement these ports.

Include `adapter.readiness()` in composition readiness (inventory absence is a blocker; unavailable discovery/social/video capabilities stay explicit). This is configuration readiness, not proof of authorization or live quality.

`adapter.timeouts` and `adapter.readiness().timeouts` expose the same frozen,
scalar-only `{ acquisition_timeout_ms, reopen_timeout_ms }` metadata. The settings
are snapshotted at construction and reject zero, negative, fractional, nonfinite,
coerced or out-of-range values. They belong to reviewed server composition, never
brief/model input. Align the parent research-stage deadline and worker lease with
these values plus final receipt/commit overhead. An earlier parent abort still
wins. Source acquisition and provider transports keep their own per-call limits;
increasing the overall allowance never removes those limits or retries a call.

Pass `adapter.acquireResearch` to Onepage options, and pass
`adapter.reopenResearchEvidence` to the independent quality provider's research
reopener. The latter resolves original documents/pixels plus all exact envelope
and item bindings, not just generated summaries.

### Operation contract

`WorkspaceResearchOperationRequest` contains:

- logical `operation_id`, purpose `enumerate | inspect_image | assemble`;
- the authenticated `scope`, `packet_sha256` and `request_sha256`;
- the maximum cost, maximum output tokens and `xhigh` reasoning setting;
- fixed trusted instructions, strict JSON Schema and `untrusted_input`;
- image descriptors with their actual immutable bytes, when applicable.

The request hash is stable JSON of the complete request except `request_sha256`
and image bytes. Image descriptors contain the actual SHA-256; the bridge must
verify the provided bytes. The journal's child identity and provider HTTP request
hash are distinct from this logical request identity.

`execute` returns exact `output_json` plus a receipt with logical `operation_id`,
actual durable child `provider_operation_id`, logical `request_sha256`, provider
`response_id`, `budget_receipt_id`, `accounting: settled` and `output_sha256`.
`verify(context, receipt, { operation_id, request_sha256 })` must verify completed,
settled, same-task child history, role, logical intent, actual provider response,
budget receipt and output digest. Checking a receipt against itself is not a
production verifier.

Every request has a distinct deterministic child key. This adapter does not retry
paid calls, manufacture success after a timeout, switch models or downgrade an
uncertain provider outcome into an unavailable source. The durable journal must
reject repeated or conflicting dispatch across retries/restarts. Post-submission
uncertainty requires reconciliation; callers must not blanket-map thrown errors
into freely retryable stage failures.

### Discovery and inventory contracts

Discovery returns bounded candidate URL/category/source IDs and actual attempt
receipts (query, status, time, limitations and retained evidence refs). Each
candidate must be linked by a completed/partial attempt in its matching category.
Capturing a candidate still requires the safe source provider's exact current
origin authorization. A denial is not bypassed or relabeled as zero results.

An inventory receipt binds the source ID, document SHA, full authenticated scope
hash, ordered media URL/variant/kind list, detail IDs, completeness, method,
limitations, retained evidence refs and required `images: WorkspaceCapturedSource[]`.
`images` contains one exact original capture per requested image URL, including
its source-manifest ref, byte hash/size, MIME, raster metadata, original scope,
requested/final URLs and capture time. Research independently reopens each ref
through the safe source provider and checks all metadata against actual retained
bytes. A descriptor alone is never sufficient. Complete inventory must supply
the exact image URL set; partial inventory's missing images remain unavailable
without a speculative refetch.

The semantic image receipt and retained source record bind the same capture
metadata as `inventory.images`. Reopening verifies this equality again. Separate
PDP inventory inspections may capture the same URL more than once; equal bytes
retain their exact source-specific evidence identities. Conflicting bytes at one
URL within the research run fail with `RESEARCH_INVENTORY_IMAGE_CONFLICT`, rather
than reusing stale pixels, silently switching identities or accepting a changed
CDN image. A later CDN change cannot change previously retained originals.

A production integration must establish
these through actual permitted rendered-page/platform inspection, including
lazy-loaded media, variant changes and detail accordions. It must retain the
underlying browser/platform evidence for the independent reviewer. The adapter
checks receipt structure and exact item matching; it cannot manufacture that
browser capability or prove the semantic authenticity of an arbitrary injected
port.

### Explicit multi-variant canonical limit

Extraction and the inventory preserve separate variant/item identities, even
when natural/red states share one image URL. The inventory can deduplicate those
original bytes without dropping either state. However, the unchanged shared
product evaluator requires exactly one `scope.products` identity for a PDP
(`PDP_SCOPE_DRIFT`) and forbids repeated gallery URLs, even across variants
(`INVALID_PDP_GALLERY_ITEM:<source-id>`).

Research therefore retains the real multi-variant extraction/inventory and stops
before vision/synthesis with `RESEARCH_MULTI_VARIANT_CANONICAL_UNSUPPORTED`, an
evidence ref and the exact applicable canonical issues. It does not relabel
distinct variants as one fictitious universal product, drop a shared-URL gallery
entry or weaken the legacy evaluator. End-to-end multi-variant PDP support needs
a separately reviewed canonical representation/evaluator change. This limit is
also exposed in readiness metadata; it does not imply arbitrary dynamic-page
support.

## Custody and independent reopening

Acquisition refs intentionally have two forms:

- `source:<manifest-sha256>:<size>` from the source capture provider;
- `research:<envelope-sha256>:<size>` for discovery, per-source semantic/vision
  provenance and final assembly envelopes.

Each `source_bindings` hash addresses its complete per-source research envelope,
not just its HTML. That envelope connects the actual source capture, extraction,
inventory receipt and every inspected image to exact operation receipts and raw
model output bytes.

`reopenResearchEvidence(context, research, expectedPacketSha256?)` returns the
exported `WorkspaceResearchResolvedEvidence`:

- `sources`: original `WorkspaceReopenedSource[]`, including actual pixels/text;
- `bindings`: source bindings plus every inspected item mapped to its original
  capture ref/hash;
- `envelopes`: exact retained refs/hashes/kinds/payloads.

The resolver rechecks scope/integrity, compares the returned research and complete
binding/ref set with the final retained assembly, verifies logical/raw-output
hashes and durable operation receipts again, and reopens original captures under
current origin policy. Later QC may read an earlier research snapshot for the
same owner/task/source/canonical version. Revoked grants, missing objects, altered
bytes, foreign scope, changed research or revoked journal verification fail.

This is provenance verification, **not an independent quality pass**. The quality
provider must independently interpret original source text/pixels, verify actual
inventory evidence, review unsupported claims and inspect final render evidence.

## Deliberate limitations and production prerequisites

1. Configure verified model/project capabilities, authorized data destinations,
   task/user/global budget grants, the durable operation journal and actual
   private custody. No credentials, grants, live SQL, paid calls or deployment were
   configured or performed in this implementation task.
2. Wire real authorized discovery and rendered inventory adapters. Without them,
   optional categories remain unavailable and a target PDP lacking completeness
   proof cannot advance. The default is intentionally not fake readiness.
3. Pinterest/Reddit full-content research is **not implemented here**. Actual
   provided search attempts are preserved, but there are no invented visual
   references or customer observations. Without a permitted route, statuses are
   explicitly blocked and disclose that no remote query was performed. A completed
   search without inspected content becomes partial. This module rejects direct
   social URLs as ordinary candidate fetches. A future social adapter needs a
   permitted route, retained contextual/pixel evidence, deletion handling and
   dedicated validation; no scraping, login bypass, direct API integration or
   background collection is authorized by this code.
4. Video playback/audio inspection is not implemented. A discovered video remains
   unsupported, so required PDP coverage blocks. No still image or metadata is
   substituted for playback.
5. Public static captures are bounded: at most 12 documents and 48 images, 128 KiB
   per document, 48 MiB aggregate captured bytes, 180,000 output bytes per operation
   and 2 MiB per evidence envelope. The escaped text request is checked against a
   240 KiB limit before dispatch, below the existing transport's 256 KiB default.
   Text synthesis uses at most 16,000 output tokens; image inspection uses 3,000.
   Oversized pages/requests fail visibly, never silently truncate. Larger/dynamic
   pages need a reviewed bounded capture/extraction integration, not a bypass.
6. Acquisition defaults to 120 seconds but production composition can explicitly
   configure a reviewed bounded deadline up to 30 minutes to accommodate multiple
   real sequential vision/extraction calls. Reopening independently defaults to
   120 seconds and can be configured up to 5 minutes. Production stage deadlines,
   worker leases, supported task sizes and provider latencies must be reviewed
   together. This change configures no live worker and does not change default
   call grouping, quality gates, budgets or provider limits.
7. This module does not replace independent semantic/pixel review, human artistic
   judgment, user content approval, final browser QC or EO acceptance. No actual
   browser QC or live comparative quality evaluation was performed by this task.

## Optional batching design, not implemented

If EO timing and quality benchmarks justify it, a future opt-in inspector could
group a small bounded set of full images from the same source/variant into one
vision call. Every output would still require an exact per-item source ID, image
hash, status and concrete observations, with the same canonical and independent
review gates. Request-byte/image/token ceilings and aggregate budget reservation
would apply to the entire batch. Partial/unknown outcomes would require durable
per-item reconciliation; a group receipt could not imply every item passed.

No batching is enabled by this implementation. Establish a representative
single-image EO baseline and compare fidelity, embedded-text reading, omissions,
latency and cost before selecting any batch size or changing default grouping.

## Offline checks

Run:

```sh
node --import tsx --test tests/uid-workspace-research.test.ts
npm run lint
```

Coverage includes GTK/FAQ/collection assembly, full-image byte transmission,
actual isolated decoding, original-byte reopening, strict schemas, prompt-injection
separation, fabricated quotes/URLs/items rejection, canonical/source/variant
mismatches, complete inventory requirements, unavailable images, unsupported video,
budget caps, provider uncertainty without retries, receipt verification/revocation,
foreign/corrupt evidence, aborts and preservation of honest social limitations.
Focused deadline tests also cover default/boundary settings, immutable metadata,
invalid/unbounded configuration, earlier parent cancellation, independent
reopening deadlines and disposal of object streams that open after cancellation.

Composed regressions use the real safe capture provider, inventory adapter, its
fixed DOM evaluator, research orchestration and retained evidence reopening. They
prove that single-PDP and collection semantic inspection uses inventory originals,
a CDN change does not cause a second research fetch, differing same-URL captures
fail closed, and repeated-URL multi-variant coverage retains truthful diagnostics
instead of claiming canonical compatibility. The offline DOM tree is the same
tree serialized into the retained HTML, with tree-based selector matching. It is
still a browser/model test double, not proof of HTML parsing, CSS layout, actual
Chromium rendering or production EO parity.

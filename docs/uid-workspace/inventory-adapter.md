# Reviewed static inventory capture and reopening

`uid-workspace-inventory.ts` implements both of these existing ports:

- `research.inspectInventory(context, { source, source_id, extraction })`
- `quality.reopenInventoryEvidence(context, evidenceRef, documentSha256)`

It is a real retained-document DOM/screenshot adapter with an injected sandboxed Chromium implementation, not a function that returns `inventory_complete: true` from a model or configuration boolean. Construction performs no I/O. There is no default browser, executable search, installation, credential discovery, imported session, arbitrary JavaScript tool, or live browser navigation.

## Deliberately narrow supported mode

The supported mode is `retained_static_document`. An audited platform/theme policy must establish that the **exact retained source document** contains all relevant static/pre-rendered variant panels, gallery media, and product details. Policies are trusted deployment configuration selected by `resolvePlan`, not HTTP, brief, model, or page output.

A policy is pinned to:

- Exact authorized requested PDP URL and resolved URL.
- Exact retained source-document SHA-256.
- A review reference, platform identifier and policy identifier.
- Expected template signature, product identity text and static inventory closure marker.
- A DOM variant registry whose unique IDs must exactly equal the configured state IDs.
- Each static state's root, gallery selectors with expected counts, and detail IDs/selectors.
- The complete exact image-URL allowlist. The actually observed gallery must match it; it is not a wildcard origin list.

Completion requires the observed registry, signature, identity, closure marker, counts, loaded/visible images, supported interactions, all root media, disjoint media-node identities and detail visibility to agree. Visibility uses native `checkVisibility` when available, checks effective opacity and hidden state along at most 128 ancestors, and intersects nested overflow/scroll clipping bounds. Effective opacity at or below 1% and unsupported masks, filters or clip paths conservatively make coverage partial. Merely being outside the current viewport does not exclude a node from full-page evidence. The extracted gallery list must exactly match the DOM list and each extracted detail quote must occur in the corresponding DOM block. An extraction mismatch fails rather than dropping newly discovered content to preserve a false success.

A collection brief may pass its previously captured member PDPs to this adapter. The capture and grant retain the **original brief/collection scope URL** along with the exact owner/task/canonical/research-run scope. The reviewed policy instead binds the member PDP's **requested and final URLs**, both of whose origins must be authorized. The opener preserves the same distinction. This supports per-member PDP inspection only; it does not discover members or establish collection-wide completeness. Foreign or rewritten scopes remain rejected.

Unknown policy or source-document drift fails before browser launch. A `partial` policy always returns incomplete evidence. Missing registry/signature/closure, hidden/unloaded media, unaccounted-for media, unsupported interaction outcomes, frames or any video make the retained result incomplete. Video is not played or fetched. Current visible loaded images do not by themselves establish completeness.

**Not supported:** JavaScript-driven variant selection, external product JSON APIs, infinite scroll, lazy galleries populated by source scripts, collection-wide enumeration, interactive video inspection, site stylesheets/fonts, and live-theme visual fidelity. Setting `select_native` changes only an actual native select value without events or source JavaScript. It cannot prove a dynamic variant state. A new source hash needs an independently reviewed matching policy; no code here automatically converts an arbitrary website into a trusted policy.

## Browser and network boundaries

The deployment must supply `browser: { review_ref, sandboxed: true, launch }`. The adapter passes only `{ headless: true, chromiumSandbox: true, args: [] }`. This is a prerequisite for a reviewed launcher, not proof that a dishonest launcher actually honors Chromium's sandbox. The launcher is not discovered from environment variables, and this adapter cannot download or install Chromium.

Every capture uses a fresh nonpersistent context:

- JavaScript disabled, service workers blocked, downloads disallowed.
- Empty permissions, normal certificate verification, no CSP bypass.
- No storage state, credentials, cookies, session import, proxy or custom executable arguments.
- All context-level browser requests are aborted. No request is continued or routed directly to a remote origin.
- The hash-verified original HTML is passed to `setContent` under a restrictive CSP. Script, frame, object, font, form, base and connection use are blocked. Only inline styles and data-URI images are permitted.

Real gallery acquisition is separate: only exact reviewed image URLs observed in the DOM are passed to the existing `WorkspacePublicSourceProvider`. The current owner/task/source/canonical grant and exact allowed origins are checked before the browser starts. The source provider independently enforces its exact-origin grants, public DNS/peer pinning, redirect checks, no credentials/referrers/cookies, byte limits and full raster decode. Reopened image bytes must match the source capture and source scope before embedding. The result exposes these exact immutable originals as `images: WorkspaceCapturedSource[]`, unique by requested URL, including evidence reference, source scope, final redirected URL, hash, byte size and raster metadata. Research must reopen and reuse these original bytes for vision rather than fetch the gallery URL again. Shared-URL variant entries keep separate labels but refer to the same captured bytes. Conflicting bytes for a URL across source snapshots must be rejected or explicitly modeled, never silently switched. There is no raw browser request proxy and no model-selected network target.

The fixed DOM evaluator accepts only a validated small CSS grammar, image maps built by the adapter, and these bounded native operations: open a native `<details>`, select an existing enabled native `<option>` without events, or scroll a selected element into view. It never evaluates source strings, clicks controls, submits forms, dispatches events or plays media. All selected text/markup remains untrusted evidence for downstream reviewers.

External source CSS/fonts are deliberately absent from the snapshot. Screenshots therefore demonstrate retained DOM/media coverage, **not** faithful website styling or independent visual QA.

## Private evidence and run binding

All artifacts use `services.writeRunArtifact`; direct unjournaled object writes are not used. Each write must return the exact requested owner/task/content-addressed identity and is read back and SHA-256 verified.

Evidence consists of:

1. One JSON DOM observation per state, including the retained root markup, observed gallery/details, variant registry, supported-action results and layout dimensions. Embedded raster data is replaced with a custody marker to avoid duplicating image bytes inside the DOM log.
2. One actual full-page PNG per state, fully decoded with the native image preflight and checked against exact observed dimensions.
3. One JSON manifest binding the original source metadata/hash, owner, task, canonical snapshot, research operation/run, grant ID, browser review, policy hash, original gallery captures, observations, member identities and explicit limitations.

Refs are `inventory:<manifest-sha256>:<manifest-size>:<member-index>`. Index zero is the manifest; the other indices identify the retained DOM/PNG members. A two-state capture has five evidence refs. No public storage URL is returned.

The opener verifies the private manifest hash/size, owner/task/canonical/source, exact source-document hash, pinned policy, and a matching retained research run. The current research run can reopen its own capture; later review stages require the matching original research run in the server-owned record with `in_flight` or `succeeded` status. It reopens and verifies the original source document. Manifest reopening also reopens and verifies each original gallery capture. DOM and PNG members are independently hash checked; PNGs are fully decoded again and checked against retained observed dimensions. Cross-task, cross-owner, stale-canonical, missing research-run or corrupt-byte evidence fails closed.

This is source-custody and technical enumeration evidence. The manifest explicitly records `semantic_inspection: not_performed`, `visual_qc: false` and `eo_parity: false`. The existing independent semantic/pixel reviewer still has to inspect and cite the source and inventory evidence.

## Bounds and failure behavior

- At most eight static states, 48 gallery entries/images, 100 details and 12 supported interactions per state.
- At most 17 inventory evidence refs, below the quality adapter's 20-ref limit.
- 1280 × 800 viewport; full-page dimensions capped at 16 million pixels with no horizontal overflow.
- 1 MiB DOM objects, 512 KiB manifest, 8 MiB per PNG/source image, 48 MiB aggregate capture-byte budget.
- Default whole-operation deadline 120 seconds, maximum configurable deadline 300 seconds. Existing caller cancellation is combined with it.
- One capture at a time per adapter instance. Production still needs cross-instance worker/egress/storage quotas.
- Storage reads are bounded and integrity-checked. Late opens are disposed; late browser/context launches are closed. Browser/session shutdown is bounded. The adapter does not retry uncertain launches or writes.

A failure after a verified member write may leave an unreferenced immutable private artifact. It emits no final manifest/reference set and performs no deletion or unapproved recovery. Existing authorized retention policy should handle unreferenced objects.

## Composition

`createWorkspaceInventoryAdapter(options)` accepts the existing private objects, run-artifact writer and public source provider, plus trusted `authorize`, `resolvePlan`, and reviewed browser capabilities. It returns `readiness()`, `inspectInventory`, and `reopenInventoryEvidence`.

Readiness only means the required capabilities are supplied. It does not prove a particular source has a reviewed policy or that a browser deployment has been tested. The readiness result explicitly reports `mode: retained_static_document` and `live_dynamic_supported: false`.

The production composer can construct this adapter once and pass its two returned ports to research and quality together. Do not mix a capture implementation with an unrelated evidence opener. Production operation additionally requires the existing authenticated/fenced run-artifact writer, approved durable private object store, production source provider, reviewed sandboxed browser deployment and per-source audited policy.

## Verification and remaining production gap

Focused command:

```sh
node --import tsx --test tests/uid-workspace-inventory.test.ts
```

The tests execute the actual fixed evaluator in an isolated offline fixture element tree and use real Sharp-encoded/fully-decoded synthetic PNG bytes. Source HTML is serialized from the same tree, and fixture selectors walk that tree rather than returning canned matches; gallery wrappers, native selects, variants and detail nodes therefore appear in both representations. The fixture does not parse HTML or perform browser CSS layout: its rectangles/styles are explicit simulations, so these tests do not establish real DOM-to-source or pixel-render fidelity. They cover multi-variant evidence, native action bounds, partial/unrecognized variants, video, opacity and ancestor clipping/hidden-state failures, below-viewport full-page visibility, exact shared-URL retained image identities, signature/media/decode gaps, malicious model URLs/claims, unauthorized origins, exact source and grant binding, capture/readback tampering, collection-member PDP inspection with the original collection scope, foreign-scope/unauthorized-member-origin rejection, later-stage reopening, cancellation, late launch cleanup, concurrency, and cross-owner/task/canonical/run isolation.

These fixtures are not a Chromium integration test, source-network test, real website inventory audit, independent visual review or EO parity evidence. No browser binary, actual website, source network, paid model or source-provider call was executed by this task. Live browser execution remains blocked in the current cloud environment; the previously reported desktop input-transfer incompatibility was not retried or bypassed. A supported sandboxed Chromium integration and real audited static PDP fixture must pass in an authorized environment before production activation. General dynamic/live PDP enumeration remains a separate production capability gap.

# Concrete source provider and remaining Onepage provider work

Validated locally on 2026-11-06. No live source fetch, AI call, credential discovery, spend, deployment, or external mutation was performed. Existing gateway/ChatGPT/MCP behavior is unchanged.

## Implemented code

`uid-workspace-providers.ts` exports a real server-side `WorkspacePublicSourceProvider`, not a mock-fetch interface. Its default transport uses Node HTTPS with certificate verification, DNS address pinning, exact peer verification, no proxy agent, and no automatic redirect handling. Construction performs no I/O. An injected test network explicitly prevents `productionReady` from being true.

The deployment supplies:

- Its existing private, create-only `WorkspacePrivateObjectStore`.
- `authorize(scope)`, which reads a current server policy for the authenticated owner/task, canonical pin, and exact brief source URL. The policy lists exact HTTPS origins, including every permitted redirect/CDN origin, and expires. There is no authorization inferred from possessing a shared API key.
- The isolated, installed `tools/creative-quality` runtime for image decode. `creativeQualityDirectory` can specify its absolute deployment path. The default is this package under the server working directory. The resolver requires `./node_modules/sharp` at that package, never ambient/global Sharp. Install that package through the repository's supported deployment process; this module never installs anything. Both ESM and the supported CJS bundle are regression tested.

Call `capture(context, { url, kind: 'document' | 'image' })`. Retain its result in the research record. `evidence_ref` addresses a private immutable manifest; `sha256` identifies the actual acquired source bytes. The manifest binds owner, task, source, canonical pin, snapshot, state version, content revision, operation, stage, captured time, redirect chain, public socket peers, MIME, and byte identity. All objects are written and read back before a capture is returned.

Call `reopen(context, evidence_ref, captured.scope)` to read the retained bytes. This never refetches the source URL. Later research/content/asset QC can explicitly reopen a prior capture scope within the same authenticated owner, task, source and canonical pin. Any changed operation/snapshot in the expected retained scope fails. Current origin authorization still applies. The manifest and body are hash/size checked, and images are fully decoded again.

## Enforced acquisition limits

- HTTPS default port only; no credentials, fragments, IP-literal hosts, local/internal host suffixes, wildcard origins, or common signed/login/credential query parameters.
- Every DNS answer must be public unicast, including all answers in a mixed result. IPv4 private/special-use ranges, IPv4-mapped IPv6, NAT64, Teredo, 6to4, documentation/local/multicast ranges are rejected conservatively.
- The connection uses the checked address without a second DNS lookup. The hostname remains the TLS SNI and certificate name. The response socket peer must match that checked address.
- At most three redirects. Every next origin and DNS result is rechecked before another request; redirect bodies are not consumed. Cookies, credentials and referrers are never forwarded.
- Maximum 8 KiB response headers; 2 MiB document bodies; 8 MiB image bodies. Content-Length and streamed bytes are checked. Compressed responses are rejected instead of decompressed. Empty/truncated or invalid UTF-8 documents fail.
- Twenty-second acquisition/reopen deadline, three-second DNS deadline, five-second socket idle deadline, and five-second native image-decode deadline. The decoder is a killable process with a 64 MiB JS heap limit, no inherited secrets/environment, a 16-million-input-pixel limit, a 16,384-pixel edge limit, one frame, and one native decode thread. The parent caps concurrent capture/reopen operations at two per provider instance. Native memory is additionally bounded by input pixels but is not claimed to be a kernel memory sandbox.
- PNG/JPEG/WebP only for images. MIME sniffing plus full native decode is required. SVG/GIF/HTML cannot masquerade as an inspected source image.
- Aborted responses are disposed; a storage stream whose open resolves after cancellation is also disposed. Put failures are never treated as success without reopening exact immutable bytes.

The operator still needs normal deployment-level egress rules, worker-instance concurrency limits, acquisition-count/rate and retention policies. The per-instance limits are not a cross-replica quota. Captures that stop after a private object write can leave an unreferenced immutable object; routine authorized storage retention should handle these. There is no public URL proxy endpoint in this module.

## Honest integration with `WorkspaceOnepageOptions`

This provider supplies the acquisition and durable-evidence layer. It deliberately does **not** populate a fake `acquireResearch` result or claim that downloaded/decoded pixels were seen by an independent reviewer.

`acquireResearch` still needs a concrete semantic research implementation that:

1. Chooses a bounded source/search inventory and uses this acquisition service for every source/media URL.
2. Inspects actual text and media through an authorized capable model/reviewer; marks blocked/unavailable pages and incomplete galleries honestly.
3. Produces the canonical product-research, content-plan, Pinterest and Reddit structures with actual observations rather than invented search attempts.
4. Retains each capture result/scope and maps its exact content hash and reference to `source_bindings`. `item_ids` must be observed evidence inventory, not discovered URL count. A source binding does not by itself satisfy `quality.assess`/`verify`.

Capture results say `semantic_inspection: 'not_performed'`. Raster records additionally say `technical_validation: 'full_decode_passed'` and `visual_inspection: 'not_performed'`. These facts must not be promoted to “research complete,” product fidelity, artistic quality, or EO success.

Remaining independent ports/code:

- `quality.assess` and `verify`: a concrete independent semantic/pixel reviewer with retained source access, exact subject binding, durable reports, and honest failures. Model self-approval and image decode are not substitutes.
- `generateAssets`: a concrete paid image/edit transport plus task/source/content-bound generation plan, real reference-image inputs where needed, transactional image-aware accounting, and durable provider identity/reconciliation. The current text-only transport cannot do this.
- `renderMapping`: a sandboxed real browser renderer of the fixed HTML with desktop/mobile/breakpoint evidence, no external fetches, retained full PNG and exact render/subject binding. Implemented separately in `uid-workspace-renderer.ts`; actual approved sandboxed Chromium deployment and pixel validation remain pending.

No API, runtime, runner, Onepage implementation, existing budget, or live service was changed to enable these missing ports.

## Official image API investigation and unresolved hard ceiling

Official sources were fetched on 2026-11-06:

- [Image API reference](https://developers.openai.com/api/reference/resources/images/methods/generate): `POST /v1/images/generations`, GPT Image 2.5 example, base64 image response, explicit format/size/quality, prompt limit 32,000 characters. Use a fixed `n=1`, no streaming/partial output and no `auto` for a future bounded adapter. The reference does not expose a maximum output-token/cost parameter.
- [GPT Image 2.5 Flare model](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare): model pricing and capabilities. Account/project availability must still be independently verified; this is not evidence that this user's project can call it.
- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation): the fixed-size/quality output-token calculator is explicitly an **estimate**, not a published maximum. The older-model token table cannot be applied to 2.5/2.6. No guaranteed output-token maximum was established from the fetched current guide/model/reference pages.
- [API pricing](https://developers.openai.com/api/docs/pricing): separate image/token rates. The fetched 2.5 standard rates are $5 per million text-input tokens, $8 per million image-input tokens, and $30 per million image-output tokens. Runtime pricing must be verified, expiring server configuration, not these documentation notes copied as a permanent constant.

The current `PostgresWorkspaceBudget` validates only `gpt-6.1-sol` text pricing and text-token usage. Reusing it unchanged for an image model would silently misprice image input/output. A prompt/byte limit and fixed dimensions alone do not establish a guaranteed dollar cap. An observed sample cost or calculator estimate must not be relabeled a verified maximum.

Before implementing/enabling the image transport, code must extend transactional project/owner/task reservation and reconciliation with verified image/text usage dimensions, explicit model/size/quality/input bounds, a supported conservative token ceiling, and a pre-submission durable intent. Uncertain/aborted submissions must hold the reservation and reconcile the original provider identity without automatic regeneration. Paid output is untrusted until the separate pixel/source review passes. If verified capability, data authorization, pricing/ceiling or task budget is absent, generation must remain blocked before network submission.

Thus the missing image path is **not merely a missing key**: image accounting/transport and independent visual-review code remain outstanding, and the fetched docs did not establish the required conservative per-request cost bound. No artificial success or arbitrary estimated “hard cap” was implemented.

## Verification

`node --import tsx --test tests/uid-workspace-providers.test.ts` passes all 31 focused tests, including a CJS-bundled source capture with actual isolated Sharp decode. `npm run lint` passes. Network responses and source DNS are test doubles; no real-provider access, model availability, search completeness, or EO outcome is claimed from these tests.

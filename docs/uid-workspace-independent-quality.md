# Independent Onepage quality and Responses vision

Status: implementation and synthetic regression coverage. No paid provider call, real browser capture, production activation, or EO comparison was performed for this change. Passing fixtures prove fail-closed mechanics, not artistic quality, truth, parity with the current workflow, or improvement over ChatGPT.

## New modules

- `uid-workspace-vision.ts`: server-only, explicitly injected Responses image-input transport. The existing `uid-workspace-openai.ts` remains text-only.
- `uid-workspace-quality.ts`: concrete `WorkspaceOnepageQualityProvider` and `createWorkspaceQualityRenderResolver` composition.
- Tests: `tests/uid-workspace-vision.test.ts`, `tests/uid-workspace-quality.test.ts`.

## Vision boundary

The server supplies an exact verified model ID and accepted response IDs, project, expiry, image-input/text-output capability, and optional verified structured-output capability. `family: sol | terra` is an operator routing label, not a claim that a model ID exists or the account can use it. No default model, capability probe, fallback model or automatic escalation is supplied. A different model requires an explicitly authorized new operation.

Only private owner/task-scoped immutable raster objects are accepted. The transport reopens and hashes bytes, enforces byte bounds, and fully decodes PNG/JPEG/WebP through the existing sharp boundary. Metadata headers alone do not pass. It sends high-detail data-URI inputs, never arbitrary external URLs or storage credentials. Every raster requires current exact-object data authorization. Source text/HTML remains untrusted data, and the transport supplies no tools or network-following mechanism.

Bounds: up to 96 rasters, at most 32 MiB each and 64 MiB total; 1 MiB combined instruction/input text; default 96 MiB encoded request, maximum 128 MiB; bounded output tokens, response bytes, timeouts and concurrency. Oversized evidence is rejected, never silently omitted, downscaled, summarized or switched to a weaker modality. For a larger legitimate task, implement an explicitly budgeted multi-review plan and aggregate every required check; there is no implicit slicing fallback here.

Quality requests use strict `json_schema` only when `capability.structured_outputs === true`. Schemas are restricted to a small bounded subset with no remote refs, descriptive instructions or open object properties. JSON-only transport results remain untrusted. Quality always performs independent strict local schema and evidence checks.

Budgeting uses `uid-workspace-provider-budget.ts`, the same project/member/task ceilings and durable operation fences as text/image work. The request records modality `responses_vision`, actual image hashes/dimensions/byte sizes, output-token cap and all data/capability authorization references. A caller's dollar cap is not a cost estimate or proof of a ceiling: independently verified exact-request pricing/bound evidence is mandatory. All actual image/reasoning/context costs must be covered. Missing/unknown usage, submission uncertainty or failed accounting keep the reservation held and block further work. There are no automatic retries.

Mandatory `bindReservation` and `guardDispatch` hooks connect the reservation and final dispatch to the parent child-operation journal. Hook failures stop before I/O. Credentials stay injected server-side; a shared API key never establishes owner identity or creates a quota pool.

## Independent quality evidence

The quality provider:

1. Validates authenticated owner/task/current snapshot and recomputes the exact Onepage subject digest.
2. Reopens the current reviewer role and generator/author identities. The reviewer cannot be a generator. Model configuration is separate from reviewer identity; matching a model label alone is not independence.
3. Reopens original acquired source text AND product image bytes. For the new research adapter, inject `reopenResearchEvidence`; it resolves mixed `source:`/`research:` refs, exact source-envelope hashes, item-to-original-capture bindings and durable research operation evidence. The simpler `reopenSource` path rejects research envelopes rather than pretending their summaries are raw sources. If source envelopes declare enumeration evidence, `reopenInventoryEvidence` must reopen actual browser/platform screenshots or DOM logs bound to the source document; absent that port, review blocks before spending. Receipt prose alone cannot establish lazy-load/variant coverage.
4. Reopens exact current candidate artifacts. It checks revisions, SHA/size/full decode, current text hashes, canonical aliases, inventory and manifest, then reconstructs the fixed canonical preview. No generator-supplied image or HTML pass is accepted.
5. Reopens full desktop 1440, mobile 390, and breakpoint 798/799 PNG captures, with exact scope/manifest/render/document identity and decoded dimensions. Mapping must equal the retained desktop PNG.
6. Sends original sources, actual image inputs and explicit required checks to a separate reviewer child operation. All prose, excerpts, research summaries, image text and feedback remain data rather than instructions or authority.
7. Validates a strict per-kind result: exact subject/check inventory, observed explanations, real evidence citations and no contradictory pass. Product/claim judgments must cite original source pixels/text, not only derived summaries. Every candidate image must be cited by a pixel/artistic check; responsive findings cite all four captures. Missing, failed or ambiguous evidence cannot become a pass.
8. Retains a private immutable report with reviewer identity/authority, exact evidence digest, logical and actual provider operation IDs, raw output text and hash, decision, provider model/response/request and settled budget receipt. It registers the exact report through the server attestation registry backed by the child journal.
9. `verify()` first checks report authority, reopens original/current bytes and current role/human approval, validates raw output against the retained decision, and rechecks the attestation. It does not re-run an AI request or recapture the browser. Checksums are custody checks, never independent judgments by themselves.

The required AI checks cover source coverage/claims/conflicts, product identity, semantics, product fidelity, content/asset compatibility, artistic quality, typography, canonical layout, responsive rendering and mapping consistency as appropriate. They do not replace deterministic compiler checks or human approval. `fail`/`unverified` decisions can be retained for diagnosis but cannot advance the Onepage gate. Every retained report explicitly has `eo_parity_established: false`.

## Human artistic approval

Review and mapping additionally reopen the persisted authenticated `approve_artwork` action. Evidence binds the human actor/action to the exact snapshot, content digest, manifest index/render hash and all approved asset IDs/revisions/hashes. A model cannot supply this approval or change its audience/scope. This records the user's explicit approval of the exact preview; it does **not** claim the user opened or inspected four screenshot files. Automated visual review inspects those captures separately. Changed preview/assets, revoked or missing action evidence block completion.

## Concrete render composition

Use `createWorkspaceQualityRenderResolver(services, rendererOptions)` as `resolveRenderEvidence`. Quality passes the reopened/rebound candidate context and preview as a third argument. The factory uses `createWorkspaceBrowserRenderer` with the explicitly reviewed sandboxed browser configuration. Candidate-snapshot capture and current-run storage authority are deliberately separate: private writes use the original active run context, not the uncommitted candidate snapshot. This prevents weakening the runner fence to support a new image candidate.

Assessment captures when required; its report retains the returned `render:` reference. Verification reopens those exact captures and never re-renders. Mapping uses the capture reference already supplied by packaging. Browser technical success still says `PASSED_NOT_VISUAL_QC`; the independent reviewer and human gate remain separate.

## Production prerequisites

Keep execution disabled until all are present and reviewed:

- Current exact model/project image + structured-output capability, legal data-processing authority, per-raster data scope, and task/member/global budget grants and independently verified bound/pricing evidence.
- Private owner-scoped storage, immutable artifact writer, parent operation journal, current membership and dispatch fencing, reconciliation support, and durable QC attestation registry. Constants returning `true` are not implementations of these authorities.
- Research original-capture resolver, independent receipt verification and actual inventory-enumeration evidence reopener; no bare public URLs, self-asserted acquisition coverage or summaries used as source truth.
- Reviewed real sandboxed Chromium, deterministic canonical capture and installed full-decode dependency. Browser mocks do not satisfy this prerequisite.
- Current independent reviewer role and complete generator provenance; authenticated exact-preview human approval reader.
- Real task fixtures exercised end-to-end with consent and budget, then blinded EO evaluation against the existing Onepage workflow, including product/claim correctness, actual visual quality, small typography, mobile crops, latency, total image/reasoning spend and human ratings. No EO claim is available before that evaluation.

Focused commands: `node --import tsx --test tests/uid-workspace-vision.test.ts tests/uid-workspace-quality.test.ts`; `npx tsc --noEmit`.

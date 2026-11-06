# UID Brands Web Workspace

Status: local workspace implementation under integration, 2026-11-06. Nothing in this document means production execution, credential setup, database migration, or quality acceptance has happened.

## Goal

Run UID Brands as a complete browser workspace alongside its existing ChatGPT integration. The user supplies a product or collection URL once, then the server automatically orchestrates the authorized workflow. The user follows visible progress, reviews real outcomes when needed, gives grouped visual feedback, and downloads the verified Onepage package. The server uses the current UID Brands rules and an authorized API runtime. Every web action executes through the backend, never by copying prompts back to ChatGPT. Preserve the existing ChatGPT flow unchanged.

Latest explicit requirements: web actions execute directly; the flow runs automatically from input; the ChatGPT flow remains. A stage stepper is a progress display, not a demand that the user click every stage. Only actual approval gates, missing permission, budget limits, essential input or verified blockers pause the orchestrator. Previously granted exact-scope approval must not be requested again.

## Verified baseline

- Repository: `ducceo123-netizen/creative-dna-gateway`, inspected main commit `3bbcf7bb78b6b12fdf931a310f535062836263e7`.
- The existing stack is React 19, Vite, TypeScript, Express, and Supabase edge functions. Reuse it; a separate framework migration is unnecessary.
- The intended deployment is a reviewed composition alongside the existing gateway. Repository deployment files are not proof of current hosting configuration; verify the target independently before activation.
- The public gateway already resolves canonical brand/material rules, compiles Onepage task packets, binds exact versioned UI templates, validates research structures, indexes feedback targets, checks product/asset metadata, and builds review/package artifacts.
- Its current React home is a route/rule browser and ChatGPT prompt helper. `/onepage-panel.html` is explicitly copy-only, has no execution bridge, and does not persist tasks. `/muse` is a public read-only auxiliary entry.
- No OpenAI inference adapter, general creative-task runtime, durable execution worker, or image-generation service was found in the inspected main tree. The `@google/genai` dependency is not evidence of an implemented provider.
- Reconcile the existing checkpoint foundation with the proposed task/action/run lifecycle before creating tables. Checkpoint persistence is not by itself a running execution app; reuse ownership/CAS/idempotency concepts without assuming activation or widening access.
- Existing checkpoint artifacts are limited to 8 MiB and PNG/JPEG/WebP/PDF/TXT/JSON. They do not support the requested ZIP/HTML deliverables or a full automatic event/job lifecycle. Expanding or activating this private capability needs a reviewed access/storage design. Existing metadata was inspected without changing flags, functions, permissions, rows, or files.
- Admin login and private-reference access exist. They are not a ready-made general task permission system. Public CORS/rate limits must not be treated as authenticated task access.
- Live read-only PawfectHouse compile on 2026-11-06 returned a compiled 25-rule quality contract, but content still required research, assets required product pixel inspection, and human artistic review remained required. A compiled contract is not a completed or approved Onepage.
- Trustpilot research PR #125 and Scale Brands PR #124 are separate, pending work. This workspace starts on main, does not edit their checkouts, and must rebase/retest after their relevant changes land.
- Some README/SECURITY prose describes an earlier strictly read-only gateway. Actual code now includes admin and feedback routes; those documents must be reconciled before release, not taken as the current security model.

## API and account boundary

Official documentation confirms `gpt-6.1-sol` is available through the API and requires Responses API for tool calling. Standard short-context token prices are $2 input and $10 output per million tokens. Image generation, search, storage, compute, and retries have separate costs or usage. A 100K-input/20K-output text request is approximately $0.40 before those extras and is an illustration, not a Onepage estimate.

Eligible paid Pro and Business subscriptions can claim API credits by linking an owned API organization. Account eligibility, balance, model entitlement and project credentials must be verified independently.

Sign in with ChatGPT can optionally authorize plan usage, but the documented public flow is for open-source/local apps; remotely hosted or paid apps require the separate interest/approval path. The documented preview excludes image generation, hosted MCP/connectors, Code Interpreter, and native computer use. It also does not expose ChatGPT conversations or account context. Therefore it is not a drop-in solution for the requested hosted Onepage app.

Recommended first runtime: a user-authorized OpenAI API project, server-only credential, Responses adapter for `gpt-6.1-sol`, and a separately verified image-generation adapter. Do not copy ChatGPT session tokens, assume subscription limits are API credits, or claim the application inherits personal memory or connected plugins automatically. Recreate approved task knowledge from canonical UID data and explicit task evidence. Model availability must be checked under the actual project before enabling execution.

Sources checked on 2026-11-06:

- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/chatgpt-api-credits
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations

## Architecture decision

Keep the current MCP behavior and public rule routes unchanged. Add a separate `/workspace` browser surface and authenticated `/api/workspace/*` API. Ship behind a disabled execution feature flag until infrastructure and account prerequisites are verified.

1. **Browser workspace:** React panels for task intake, source evidence, content, asset gallery, revision feedback, quality status, and delivery. Persist server-side task state. Local storage may remember harmless UI preferences, never be the source of truth for approval or completion.
2. **Workspace API:** authenticates the user and membership, checks task ownership, validates inputs and revision preconditions, records user action intent, and returns a durable action receipt. It does not hold an HTTP request open throughout generation.
3. **Durable task store:** Supabase/Postgres stores task/revision/action/run/event records. Private object storage holds input/output bytes. Reuse the existing Supabase project only after a reviewed additive schema/access plan is approved; no live grants or service-role expansion are part of the offline foundation.
4. **Worker:** claims durable jobs using a fenced lease, assembles the exact canonical/task context, invokes bounded tools and the API provider, validates receipts, and appends progress events. Long runs survive browser closure and process restarts. The current free web instance alone is not a reliable durable job runner.
5. **Tool adapters:** canonical compilation, permitted public research/browser retrieval, actual media inspection, image generation/editing, image-format conversion, template binding, desktop/mobile rendering, QA, and package verification. No arbitrary admin tools or credential access are exposed to the model.
6. **Artifact delivery:** task-owned immutable versions with hashes and short-lived access. Generated HTML is sandboxed and cannot call gateway APIs. Current public hosted-review bundles are suitable only for deliberately published non-private artifacts; task uploads must not be copied into `public/`.

The first version uses the existing same-origin gateway for its UI/API and an independently runnable worker entry. It does not require changing the ChatGPT integration. A managed Agents API may later replace parts of the worker, but only after tool availability, artifact recovery, cost, and the same authorization/quality gates are proven under the real account.

### Automation + AI division

Use code for deterministic work so agents spend context and time on judgment:

- **Code:** task state/CAS/idempotency; readiness and budget checks; source inventory and fetch receipts; deduplication and checksums; canonical rule/template lookup and version validation; allowed text/asset-slot schemas; exact responsive aliases; asset dimensions/format/transparency; current-revision selection and feedback grouping; sandboxed preview assembly; deterministic template binding; image conversion; ZIP names/inventory/CRC; private downloads; event replay and recovery.
- **AI/tool-assisted judgment:** interpret actual product and review evidence; distinguish facts from hypotheses; choose buyer value and GTK/FAQ mode; write nonredundant copy; art direction; image generation/editing; actual pixel and typography critique; resolve ambiguous feedback; evaluate product fidelity and brand expression.
- **Combined gates:** code verifies the receipt, scope, provenance and freshness; a qualified visual/semantic review supplies the judgment evidence; the user provides approvals where required. Never turn a model's self-reported `passed` or a deterministic metadata check into proof of EO.

Cache immutable canonical/template bundles by hash and normalized research evidence with explicit freshness rules. Rebind only changed text/assets and rerender affected previews; reuse unchanged approved asset bytes. Re-run dependent QC when copy, artifact, source or template changes. Parallelize independent asset slots with bounded concurrency, while preserving paired-banner/variant dependencies. Do not reload full canonical prose for every slot or regenerate layout with a model.

## Persistence contract

Recommended logical entities, mapped onto the existing disabled checkpoint schema where safe rather than created as duplicate tables:

- `workspace_tasks`: owner/team, brand/material, brief, active revision, state, created/updated timestamps.
- `workspace_revisions`: immutable content, research snapshot, canonical revision/hash, source identities, template version, and parent revision. Changing content or evidence invalidates dependent approvals and QA.
- `workspace_actions`: unique `(task_id, idempotency_key)`, authenticated actor, expected revision, canonical action payload hash, status, result references. Reusing a key with another payload is a conflict.
- `workspace_runs`: action/provider IDs, stage, attempt, lease/fencing token, usage reservation, measured usage, cancel state, and provider outcome. Timeouts after submission are `unknown`, not `failed-before-submit`.
- `workspace_events`: append-only sequence per task for progress/reconnect and audit.
- `workspace_assets`: stable logical slot plus immutable version/hash, object key, actual dimensions/type, provenance and QA receipts. File IDs/URLs alone never mean pixels were inspected.
- `workspace_approvals`: authenticated action bound to exact task/content/asset revision and scope. Approval is not inferred from model text or a stored flag supplied by a browser.
- `workspace_feedback`: separate instruction blocks linked to the current review index and exact selected asset IDs. Unselected slots retain the same versions/hashes.
- `workspace_deliveries`: package inventory, checksums, opened-ZIP validation receipt, mapping-preview version, and delivered state.

Creation, state transition, action deduplication, and job enqueue must commit in one transaction. Read and mutation access must be task-scoped; opaque IDs alone are insufficient. Role revocation and logout must stop future access. Worker privileges are separate from owner canonical-rule privileges.

## User flow

1. **Create:** brand/material, exact PDP or collection URL, optional theme and requirements. A single Start action records the authorized end-to-end task and begins automatic orchestration. Show provider readiness and budget before accepting a paid run. If API credentials or required infrastructure are absent, disable the paid action with the exact prerequisite; never simulate execution. If a complete brief is supplied, do not force an extra prompt-writing step.
2. **Research:** show actual inspected source/media counts, source links, supported facts, limitations, and next required input. Distinguish fetched text, viewed pixels, and video/audio coverage. Trustpilot, Pinterest, Reddit, and comparator attempts retain their real access limits. Never synthesize inspection receipts.
3. **Content:** review copy in actual canonical slots, visual proof intent, GTK/FAQ choice, source support, and missing/failed checks. The primary action is directly below the result. A clear approval starts its authorized next stage once, without a confirmation loop.
4. **Assets:** stream verified per-slot progress and actual thumbnails. Provide visible numbers/names/groups while keeping technical correlation IDs internal. Desktop/mobile banner pair and product variants stay linked.
5. **Feedback:** click the actual rendered image, text or section directly, group targets, and enter one instruction per group. Bind stable element IDs to canonical slots, current task/content/review index, artifact revision and render hash. Resolve responsive aliases to the same logical asset rather than creating duplicate edits. Reject stale feedback with a clear reselect path that keeps the draft. A single Apply feedback action starts a durable async revision job, shows its real progress and before/after result, revises only selected slots, and regenerates dependent mapping/QA. Ordinary feedback must never become Train implicitly.
6. **Quality:** show separate source, semantic, product-fidelity, technical-image, layout, and human-review status. A green structural check cannot imply semantic or pixel pass.
7. **Delivery:** once required approvals and checks pass, automatically continue within the original authorized scope. Generate exact canonical file names, standalone asset bytes and mapping PNG; open the actual ZIP, check inventory/CRC/dimensions/hashes, and provide verified downloads. Keep previous versions accessible to authorized users.

The task sidebar shows resumable tasks and real states. Closing a panel does not cancel work; cancel is explicit. Back/Forward, refresh, reconnect, duplicate clicks, expired login and older tabs must not restart paid calls or change target selection silently. Show unknown outcome and reconcile action/provider state before permitting a retry. Advance eligible stages from committed worker events, not from browser polling side effects. Optional pause/review controls may add user checkpoints, but never replace the automatic default with mandatory manual stage progression.

### Preview and file experience

Use a light three-region desktop layout: collapsible task navigation, central preview/gallery, and contextual feedback drawer. Mobile switches these regions without discarding drafts. Offer actual desktop/mobile canvases, image zoom, responsive-pair comparison, and before/after revision inspection. Keep one main action next to/below the outcome instead of separate Select and Send buttons with the same label.

The preview's trusted element manifest comes from the canonical bound document, not model-generated labels. Each selection includes task/revision/render identity, element kind, exact text slot or asset slot, section, and current artifact checksum where applicable. Sandbox iframe messages are validated against the expected frame, one-time channel nonce, current manifest and bounded schema. A message is selection data, not permission to mutate. Server resolution uses its stored latest manifest, never the iframe's claimed authority. Section selection expands to explicitly listed descendants; layout changes are separate scope and cannot be inferred from text feedback.

The file drawer lists actual stored bytes with names, formats, dimensions, sizes, revisions and QA state. Download an individual file, selected set, or validated canonical ZIP without a ChatGPT attachment intermediary. Show packaging as queued/running/verified/failed; enable the package link only after actual ZIP validation and storage receipt. Never deploy a public site per task merely to display a preview. Keep private previews and downloads behind task access, and avoid accidentally broadening storage to serve executable user HTML.

## Onepage EO quality contract

The API model name is only one input to quality. Preserve the compiler's source-of-truth rules, scoped supplemental guidance, research requirements, content approval, actual product/reference pixel inspection, image generation method, exact template bindings, and human artistic judgment.

Hard release gates:

- Correct SKU/variant or declared collection coverage; no cross-product claims, invented dimensions/materials/features, fake testimonials, or unsupported guarantees.
- Exact content slot contract and user text locks. Correct product keyword banner title; approved desktop support and mobile restrictions; reasoned nonredundant GTK/FAQ selection.
- Proof-oriented WYL, real Product Details closeups, coherent Occasion moments, approved casting and variant allocation, and responsive banner continuity.
- Actual generated bytes inspected for product shape, design, text, hands/anatomy, shadows, composition, and crop. Exact final dimensions and file formats checked mechanically.
- Source template hashes and fixed headings/order retained; no invented Occasion blocks. Bind approved content/assets using the existing deterministic binder.
- Actual desktop/mobile render review and package reopen checks. No placeholder assets, fabricated completions, or QC inferred from status text.

Build a golden evaluation set from user-approved outcomes and explicit failure cases, retaining their reference pixels and approval provenance. Include at least: one single PDP, one varied collection, one FAQ choice, one GTK choice, a complex personalized product, and a revision-only task. Blind side-by-side review measures truthfulness, canonical compliance, useful distinct copy, product fidelity, visual quality, and revision preservation. Require zero hard-gate violations and user acceptance before describing quality as comparable to the ChatGPT workflow. Stochastic outputs need not be identical pixels.

Report evaluation evidence per case: exact source/canonical/template/model versions, viewed input pixels, produced artifact hashes, copy/claim checks, desktop/mobile screenshots, independent visual findings, user acceptance and cost/latency. Do not average a product-fidelity failure away with good typography scores. A packaging pass cannot compensate for unverified product facts or poor artistic output. Earlier delivered files with later corrections are not valid goldens until the final accepted versions are identified and inspected.

## Security and cost requirements

- API keys only on the server, never in `VITE_*`, browser state, URLs, logs, generated files, or model context. Credential creation/configuration requires the appropriate approval/secure setup flow.
- Authenticate every task/event/artifact request, verify actor on the server, deny cross-user IDs, and avoid exposing existing admin tokens to the new worker.
- Treat source pages, OCR, feedback from third parties, and model tool arguments as untrusted data. Tool invocation is subject to server authorization independent of the model.
- Public source acquisition needs HTTPS allowlisting/validation, redirect checks, DNS/private-address protections, byte/time limits, MIME validation, and no ambient credentials. Respect access restrictions and supported retrieval routes.
- Private media remains private, with exact authorized recipients/processors and retention controls. Strip unsafe metadata where appropriate, record provenance, and never put signed access URLs in durable prompts.
- Bound per-run tokens/tool calls/images/retries and concurrency. Reserve budget transactionally before provider submission; reconcile actual usage and show it to users. Provider dashboard limits alone are not a reliable per-task application cap.
- No silent fallback to a cheaper/different model or lower-quality method. Report the blocked prerequisite; preserve completed work.
- Unknown provider outcomes block automatic retry. Retrying a known failed-before-submit action uses a new explicit attempt under the same authorized task and cost limits.

## Build and rollout sequence

### A. Offline foundation, no new access

Implement pure task/revision/action rules and adversarial tests. Build the real React workspace against an explicit test adapter, visibly marked as local/test, then swap to a durable authenticated adapter. Do not expose sample outputs as generated production work. Reuse actual canonical contracts rather than copying static UI slots into a second policy source.

### B. Authenticated persistence

Review the task schema, task membership, private artifact access, worker role, deletion/retention and session approach. Apply only after the required approval. Test isolation, stale revisions, concurrent actions, restart/reconnect, interrupted uploads and privilege revocation.

### C. Bounded live vertical slice

Verify API project/model access, authorized data destination, image capability, and spending limit. Run a single real PDP end to end: research → content → exact approval → assets → semantic/pixel/technical QA → canonical mapping → opened ZIP. Record real API receipts and cost. Never enable full execution while the UI is backed by mocks or incomplete adapters.

### D. EO evaluation and broader workflows

Compare golden cases with approved ChatGPT outcomes. Fix failures without weakening gates. Add collection/batch/revision recovery and remaining brand/material workflows only once their own contracts and tools are supported. Do not present a PawfectHouse-only renderer as a universal brand renderer.

### E. Release

Rebase after concurrent UID changes, run lint/build/full Node+Bun tests and browser tests on the exact final commit, review access/security and cost controls, then obtain the user's content acceptance. Only then use the authorized merge/deploy workflow. Verify exact deployed commit, authenticated smoke test, cancellation/reconnect, artifact access and rollback. Keep existing ChatGPT/MCP regression checks mandatory.

## Prerequisites still requiring a decision or verification

1. Which OpenAI API organization/project will fund the app, and what trial/per-task/monthly ceiling is authorized? Do not ask for a secret in chat.
2. User decided existing UID members should sign in and use a shared API key. Implement current-membership verification on every request and worker stage, per-user private tasks and quotas, and a shared total cost cap. No shared key may reach browser code. Member access is not authority to read another member's private task.
3. Approve the additive persistent-store/worker access plan and any paid hosting change before applying it. Current free web service is sufficient for a UI preview, not evidence of durable production capacity.
4. Confirm the approved sample outcomes to use for quality acceptance. Existing private task files may be read for this work, but sharing them with new processors or making artifacts public needs the applicable authorization.

No paid request, OAuth registration, credential change, live migration, permission grant, merge, or deployment has been performed. No real sign-in, provider request, or key transfer was used during local tests.

## Local implementation status

The implementation now extends beyond the initial domain foundation. See `docs/uid-web-workspace-validation.md` for exact test evidence and remaining release gates. New surfaces are `/workspace` and `/api/workspace/*`; no existing ChatGPT MCP tool behavior is intentionally changed.

- Task/review modules enforce revision-bound actions, canonical pins, receipt scopes, stale-feedback rejection and selected-output preservation.
- Express APIs provide actual configured UID login, current-member verification, private owner-scoped tasks/actions/events/artifacts, structured content feedback and exact visual acceptance. All production capabilities default to unconfigured rather than simulating execution.
- Development filesystem persistence is private/loopback-only. An injected Postgres adapter serializes owner transactions, but its schema/access design remains unapplied and unverified against real PostgreSQL.
- The worker runner chains stages through trusted execution/evidence adapters, waits for exact content/artwork approval, and fences expired or ambiguous attempts. No real creative provider, scheduler, worker credential or cloud task store is configured.
- Canonical preview binds existing GTK/FAQ templates and real raster bytes, produces stable text/image/section selection metadata, and isolates the selection runtime. Browser-origin restrictions keep private asset requests out of the frame.
- The package builder creates actual canonical ZIP bytes, reopens and validates CRC/hash/inventory, and decodes actual image bytes using the existing isolated Sharp runtime. This is technical validation, not EO/visual acceptance.
- The browser UI uses official Polaris 2 Web Components within the existing React 19 app. Its app-owned shell follows read-only measurements from the user's actual refreshed Shopify Admin. It keeps UID identity and does not imply Shopify affiliation or embedded Shopify app authorization. Exact visual parity remains unverified.
- The OpenAI transport is server-only and requires verified capability/budget adapters; its tests must use mocked requests only. Transport readiness does not mean account entitlement, image generation, source acquisition, EO quality or whole-workflow readiness.

## Remaining implementation and release limits

- Production SQL migration/access review, genuine multi-user RLS/concurrency tests, private artifact storage/streamed delivery, deployment-safe scheduler and worker membership read access are not configured.
- The authenticated session is short-lived; refresh/remember-device, self-signup, invitation/admin member management and shared-task collaboration are not part of the current slice.
- Private upload intake, immutable historical preview delivery and before/after controls now have local implementations. They remain disabled without configured private storage and still require real authenticated browser/infrastructure verification.
- Mixed text/image feedback now uses a revision plan retaining original group scope and instructions, with content approval and exact asset reuse/revalidation boundaries. The UI explicitly scopes private feedback references. Real creative providers, EO acceptance and end-to-end browser validation remain release gates.
- Actual research, semantic writing, image generation/editing, retained pixel inspection, independent EO verification, browser screenshots and real render-worker adapters remain required. A provider transport by itself is not a creative agent.
- Production preview bytes must be read from private immutable artifact references, not stored inline in the bounded owner-state row. Current download adapter caps are smaller than the maximum technically valid ZIP; oversized files must remain unavailable until a reviewed streaming adapter exists.
- Current UI/API material support is Onepage for the three established brands. Reconcile new Scale Brands canonical routes and other materials after related main changes; do not describe this slice as every UID material already executable.
- No claims of EO parity, browser visual pass, live sign-in success, real provider cost, or completed user Onepage outcome are supported yet. All test fixtures are explicitly synthetic and never exposed as production output.

# Executable Onepage stage adapters

`uid-workspace-onepage.ts` supplies the server-only pipeline returned by
`createWorkspaceOnepageAdapters(services, options)`. Plug this into runtime
`createPipeline`, not into browser requests or the legacy ChatGPT workflow.
Imports and construction do not fetch sources, discover credentials, start workers,
or spend money. Production remains blocked until every real capability and runtime
release gate is configured.

## Implemented deterministic behavior

- Draft compiles the supplied canonical `ResolvedDna` using the existing compiler,
  checks the exact brief brand/Onepage branch and current delivery contract, then
  pins its hash together with both deployed template versions and HTML/CSS hashes.
  Later stages recompile the retained source, never silently replace the pin.
- Research uses existing PDP/claim, content-plan, Pinterest and Reddit validators.
  Every inspected source binds a retained acquisition reference and source hash;
  every inspected PDP item must be covered. Partial Pinterest/Reddit attempts are
  allowed with recorded limits. They cannot be invented as inspected results.
- GTK versus FAQ comes from the validated research content plan. There is no brand
  default. FAQ count is explicit. Neither mode may invent slots or modify layout.
- Content uses `services.submitText` once per run operation. The server's budgeted
  Responses transport handles authorization, request binding and accounting.
  Output must be a JSON object containing exactly `slots` and `claims_by_slot`.
  Unsupported claim IDs, extra/missing slots and expanded feedback scope fail.
  Source prose is untrusted data, and the text-only author cannot inspect uploads.
- Content feedback updates only selected slots, requires fresh user approval, and
  then reuses the exact original image bytes with new revision bindings. Independent
  compatibility review is mandatory. Mixed/asset feedback generates selected slots
  only. Unchanged selected pixel bytes are rejected as a no-op.
- Actual WebP bytes are fully decoded and hashed. Canonical numeric dimensions are
  enforced. Fixed-template rendering applies exact copy and image aliases including
  `occasion_story_01_mobile -> detail_main`. Production persists the review manifest;
  the private preview route rebuilds it from retained source bytes.
- Artwork review is separate from authenticated user acceptance. Both are needed.
  Packaging consumes a real full-page browser PNG, uses the existing deterministic
  ZIP writer, reopens/decodes the actual ZIP, and verifies inventory, CRC and hashes.
- All writes use `services.writeRunArtifact`: exact object identity is journaled
  under the live fenced run before writing, then reopened/hashed. Ambiguous writes
  retain their intent for reconciliation and do not trigger blind storage retries.
- Each stage retains an immutable JSON evidence document in the private artifact
  store. Receipt verification reloads those bytes and binds owner/task, run operation,
  snapshot, state, output, source pin and independent QC report. This survives a new
  factory/worker process; no process-memory evidence registry is used.
- Accounting uncertainty wins over `failed_before_submit`: held/pending reservations
  stay UNKNOWN and require reconciliation. No blind provider retry occurs.

## Required real deployment ports

`WorkspaceOnepageOptions` is explicit trusted server configuration:

- `resolveCanonical`: authorized canonical resolver read returning actual ResolvedDna.
- `acquireResearch`: actual permitted source acquisition, source/media viewing and
  semantic research. HTTP download or a source URL alone is not inspection.
- `quality.assess` / `quality.verify`: an independent reviewer which retains real
  reports and reopens source/content/pixel/render evidence for the exact subject
  digest. A generator's assertion, fabricated reference or deterministic checksum
  never substitutes for semantic truth or EO.
- `generateAssets`: actual configured creative image provider. It must bind durable
  submission intent, destination authorization and budget before submission. Missing
  configuration cannot substitute blank, drawn or text-generated images.
- `renderMapping`: sandboxed fixed-template browser capture, with retained desktop,
  mobile and breakpoint evidence and the exact full-page desktop PNG.
- `contentBudgetCapMicrousd`: positive per-call cap, bounded by the transport's real
  task/owner/project budget. Model, credentials, entitlement and pricing remain in
  reviewed runtime configuration, never this module.

The independent provider must be able to read private candidate artifacts supplied
in the review subject under the exact owner/task scope. `source_bindings` references
and hashes establish identity, not proof of viewing. The browser renderer must retain
its screenshots so the mapping reviewer can read the bytes identified by its report.
The application artifact/runner limit currently remains 32 MiB per artifact, including
ZIPs; larger deliverables must not be silently truncated or claimed delivered.

## Verification and remaining acceptance

`node --import tsx --test tests/uid-workspace-onepage.test.ts` exercises real local
compiler, templates, WebP decode, preview and ZIP bytes using **synthetic** source,
model, image and independent-QC doubles. It covers GTK/FAQ end-to-end approval gates,
restart, scoped feedback and byte reuse, malformed content, source coverage/bindings,
canonical drift, evidence corruption/replay, missing capabilities and uncertain
budget recovery. These tests do not establish production provider access, live
source authenticity, genuine model vision, browser-pixel parity or EO acceptance.

No external provider request, production key setup, migration, live DB mutation,
merge, deployment or change to the existing ChatGPT path is performed here.

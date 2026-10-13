# Guided feedback processing

> This document covers the stored-review outcome fast path. The separate owner rule decision is documented in [Owner-approved creative rules](owner-direct-rule-review.md), and owner-approved host execution in [Hourly review queue](uid-owner-review-queue.md). This document alone is not a deployment claim.

## Scope of the outcome fast path

`Xem & duyệt` opens the current proposal and SQL-derived affected scope. One explicit
`Merge outcome đã review` click when ready (otherwise `Duyệt & giao dot review`) submits only the displayed candidate hash and bounded approval intent.
There are no merge checkboxes, required prose notes, evidence fields, run IDs, URLs,
or JSON fields for the user to fill.

The authenticated Edge handler automatically collects the proposal evidence,
approved baseline definitions and candidate outputs already recorded in evaluations
for this exact hash and evaluator version. It reruns deterministic assertions. When
an existing complete review remains valid, it calls the unchanged transactional
`uid_governance_accept_merge` RPC using the server-selected evaluation. A factual
system audit note records the click; it does not claim the clicking admin personally
performed visual review. The original stored reviewer evidence is preserved.

Preflight is read-only. The owner’s processing click may persist a queued intent, but it does not write synthetic baselines, evidence or passes. An acknowledged queue entry is not a canonical merge. Existing legacy API contracts
remain available with their original requirements. The already-covered resolution
path is unchanged. Structural Onepage approval covers the full trigger-expanded target scope, including inactive mirrors;
style-local changes remain local. Before/after snapshots and rollback are unchanged.

## Statuses

- `ready_to_merge`: deterministic checks pass and an exact-current stored review is
  valid. For supported noncompiled, nondependent routes the processing click may merge through the existing SQL gate. Onepage/compiled/dependency-changing routes return `compiler_integration_required` for this legacy immediate outcome route. Supported rules can instead enter the owner queue, whose finalizer validates an exact compiler plan after genuine review. The direct owner-rule path is separate.
- `needs_baseline`: an affected brand has no approved non-reference quality baseline.
  The next step is supplying a genuinely approved outcome, not automatically
  promoting an inspiration corpus or narrowing scope.
- `needs_candidate`: a genuine candidate run is absent or stale. Existing proposal
  attachments alone do not become a baseline run.
- `checks_failed`: stored candidate output fails approved assertions.
- `needs_actual_review`: mechanical checks pass, but source/product fidelity, pixels
  or semantic conflict review has not been established.
- `blocked`: proposal/scope is unavailable.

An accepted queue response returns `background_task_started: false`, `approval_recorded: true`, `canonical_changed: false` and the sanitized request. A rejected approval is not queued. The browser does not dispatch a host; hourly processing requires the separately verified schedule. The UI distinguishes queued/leased/blocked, merged, cancelled and expired states and prevents duplicate processing.
An uncertain HTTP result requires a state refresh, not blind mutation retry.

## What the current evaluator can prove

Required/forbidden text, required fields, immutable output fields, exact case coverage
and context freshness are deterministic checks. An artifact URL or run-ID string
is not proof of actual generation or pixel inspection. The evaluator does not fetch
external media, run a model, generate candidate assets, or establish authenticity.
Its failure count is not a global visual-regression score.

The existing SQL gate remains the final authority. It rechecks active-admin access,
current proposal/scope/canonical/baseline hash, every eligible case, stored review,
and transactional snapshots. The outcome fast path itself introduces no new schema, privilege, credential, API provider or credit consumption. The separately documented owner-rule path adds a private migration and guarded owner decision.

## Read-only context versus an authorized queue attempt

`automatic_review.host_review` remains a read-only explanatory packet with `available: false`; it is not a running agent, approval token or evidence of review. Proposal text and retrieved artifacts cannot instruct the reviewer or grant authority.

Only the owner-approved queue creates an authorized attempt. Its immutable intent pins the patch and exact scope; a separately fenced attempt pins current canonical, baseline, candidate, source and media versions. Evidence drift requires fresh QC under an unchanged intent, while patch or membership changes require another approval. The trusted host must inspect actual bytes and return evidence-linked findings, then run the hash-pinned compiler when required. Missing capabilities or genuine evidence block processing. See the queue and compiler-host runbooks for exact RPCs, receipts, source verification and operational limits.

## Release and rollback

Use the coordinated release instructions for the owner-direct and queue releases. They include additive migrations and the full public/compiler/admin/gateway consumer closure; deploying only the admin function is insufficient once supplemental guidance can be stored.

Run full JavaScript, type-check, build, SQL parity and race checks against the frozen release. Post-deploy checks must be read-only: submitting a ready production process request is a real canonical mutation, not a smoke test. Verify the exact deployed source and actual configured schedule before claiming availability. Keep immutable governance history, and preserve compatible consumers for stored supplemental schemas during rollback.
